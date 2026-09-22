import type { ProductCandidate, ScoreDimension } from '@/types/product'
import { DIMENSIONS } from '@/types/product'
import { cloneRules } from '@/domain/rules'
import type { ScoringRules } from '@/domain/rules'

/**
 * 决策自成长：从复盘快照里「预测分 vs 实际表现」喂回纯函数评分引擎，
 * 只学 `weights`（参数），不替换引擎本身——可解释、可逆、零外部依赖。
 *
 * 设计取舍：
 * - 不引入 Agent / LLM：拟合是确定性的离线计算，可单测、可复现。
 * - 只学权重不学档位：档位（tiers）是阈值型参数，小样本下极易过拟合，
 *   权重是线性组合系数，更适合最小二乘，且仍是人能看懂的"哪个维度更重要"。
 * - 冷启动不学：样本不足时返回 null，由调用方禁用按钮，避免噪声拟合。
 */

/** 把实际表现换算成 0–100 的「成功度」标签时需要的领域阈值 */
export interface LearningConfig {
  /** 月销达到该值视为达标 */
  salesTarget: number
  /** 评分达到该值视为达标 */
  goodRating: number
}

export const DEFAULT_LEARNING: LearningConfig = {
  salesTarget: 300,
  goodRating: 4.0,
}

/** 触发学习的最小有效样本数（防止小样本过拟合） */
export const MIN_SAMPLES = 5

export interface ActualPerformance {
  monthlySales?: number
  rating?: number
  note?: string
}

/** 一条学习样本：各维度可用分（0–100）+ 目标成功度（0–100） */
export interface LearnSample {
  features: Partial<Record<ScoreDimension, number>>
  target: number
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

/**
 * 把回填的实际表现映射成 0–100 的连续成功度。
 * 月销与评分各占权重，缺哪头就用另一头兜底（不给缺失项虚高权重）。
 * 无任何信号 → null（该快照不参与学习）。
 */
export function outcomeOf(
  actual: ActualPerformance | undefined,
  cfg: LearningConfig = DEFAULT_LEARNING,
): number | null {
  if (!actual) return null
  const hasSales = actual.monthlySales != null
  const hasRating = actual.rating != null
  if (!hasSales && !hasRating) return null

  const salesScore = hasSales
    ? clamp01((actual.monthlySales as number) / cfg.salesTarget) * 100
    : 50
  const ratingScore = hasRating
    ? clamp01(((actual.rating as number) - 3) / 2) * 100
    : 50

  if (hasSales && hasRating) return 0.6 * salesScore + 0.4 * ratingScore
  return hasSales ? salesScore : ratingScore
}

/** 成功度 ≥ 60 视为「判断成功」（仅用于展示，不参与拟合） */
export function isSuccess(outcome: number | null): boolean {
  return outcome != null && outcome >= 60
}

/**
 * 从候选品库的全部快照里采集有效样本：只取已回填实际表现、
 * 且至少有一个可用维度分的快照。
 */
export function collectSamples(
  candidates: ProductCandidate[],
  cfg: LearningConfig = DEFAULT_LEARNING,
): LearnSample[] {
  const out: LearnSample[] = []
  for (const c of candidates) {
    for (const snap of c.snapshots ?? []) {
      if (!snap.actual) continue
      const y = outcomeOf(snap.actual, cfg)
      if (y == null) continue
      const features: Partial<Record<ScoreDimension, number>> = {}
      for (const r of snap.rows) {
        if (r.available) features[r.dimension] = r.score
      }
      if (Object.keys(features).length === 0) continue
      out.push({ features, target: y })
    }
  }
  return out
}

/** 加权平均分（与 aggregateScore 同口径，但作用于任意 weights） */
export function predict(features: LearnSample['features'], weights: Record<ScoreDimension, number>): number {
  let num = 0
  let den = 0
  for (const d of DIMENSIONS) {
    const x = features[d]
    if (x == null) continue
    const w = weights[d] ?? 0
    num += x * w
    den += w
  }
  return den > 0 ? num / den : 0
}

/** 均方误差：预测成功度 vs 实际成功度，越低越好 */
export function mse(samples: LearnSample[], weights: Record<ScoreDimension, number>): number {
  if (samples.length === 0) return 0
  let s = 0
  for (const smp of samples) {
    const e = predict(smp.features, weights) - smp.target
    s += e * e
  }
  return s / samples.length
}

export interface FitOptions {
  /** 梯度下降步数（确定性，固定即可复现） */
  steps?: number
  /** 学习率 */
  lr?: number
}

/**
 * 用投影梯度下降做「非负最小二乘」拟合权重：
 * 固定步数、每步把权重投影到非负、再归一化到基准总权重，避免尺度漂移。
 * 返回 base 的克隆，仅 weights 被替换为学习结果。绝不修改入参。
 */
export function fitRules(
  samples: LearnSample[],
  base: ScoringRules,
  opts: FitOptions = {},
): ScoringRules {
  const steps = opts.steps ?? 600
  const lr = opts.lr ?? 0.05
  const n = samples.length
  const baseSum = DIMENSIONS.reduce((a, d) => a + (base.weights[d] ?? 0), 0)

  const w: Record<ScoreDimension, number> = { ...base.weights }
  if (n === 0 || baseSum <= 0) return cloneRules(base)

  for (let s = 0; s < steps; s++) {
    const grad: Record<ScoreDimension, number> = {
      market: 0,
      competition: 0,
      differentiation: 0,
      margin: 0,
      trend: 0,
    }
    for (const smp of samples) {
      const W = DIMENSIONS.reduce((a, d) => a + (smp.features[d] != null ? w[d] ?? 0 : 0), 0)
      if (W <= 0) continue
      const pred = DIMENSIONS.reduce(
        (a, d) => a + (smp.features[d] != null ? (w[d] ?? 0) * (smp.features[d] as number) : 0),
        0,
      ) / W
      const err = pred - smp.target
      for (const d of DIMENSIONS) {
        if (smp.features[d] == null) continue
        grad[d] += (err * ((smp.features[d] as number) - pred)) / W
      }
    }
    for (const d of DIMENSIONS) {
      w[d] = Math.max(0, w[d] - lr * ((2 / n) * grad[d]))
    }
    // 归一化到单位单纯形，保持尺度稳定、只优化权重比例
    const sum = DIMENSIONS.reduce((a, d) => a + (w[d] ?? 0), 0)
    if (sum > 0) {
      for (const d of DIMENSIONS) w[d] = (w[d] ?? 0) / sum
    }
  }

  const learned = cloneRules(base)
  for (const d of DIMENSIONS) {
    const v = Math.round((w[d] ?? 0) * baseSum * 100) / 100
    learned.weights[d] = v
  }
  return learned
}

export interface FitReport {
  name: string
  weights: Record<ScoreDimension, number>
  mseBefore: number
  mseAfter: number
  /** 误差下降百分比（0–100+），负数为变差 */
  dropPct: number
  improved: boolean
}

/**
 * 基于当前生效规则做拟合，并产出前后误差对比报告。
 * 调用方据此决定是否采用（样本噪声大时可能不降反升，需提示谨慎）。
 */
export function fitAndReport(
  samples: LearnSample[],
  base: ScoringRules,
  name: string,
  opts: FitOptions = {},
): FitReport | null {
  if (samples.length < MIN_SAMPLES) return null
  const before = mse(samples, base.weights)
  const fitted = fitRules(samples, base, opts)
  const after = mse(samples, fitted.weights)
  const dropPct = before > 0 ? Math.round((1 - after / before) * 100) : 0
  return {
    name,
    weights: { ...fitted.weights },
    mseBefore: before,
    mseAfter: after,
    dropPct,
    improved: after <= before,
  }
}
