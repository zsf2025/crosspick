import { describe, it, assert, eq, near } from './harness'
import type { ProductCandidate, ScoreRow, ScoreSnapshot, ScoreDimension } from '@/types/product'
import { DIMENSIONS } from '@/types/product'
import { DEFAULT_RULES, cloneRules } from '@/domain/rules'
import {
  outcomeOf,
  isSuccess,
  collectSamples,
  predict,
  mse,
  fitRules,
  fitAndReport,
  MIN_SAMPLES,
  type LearnSample,
} from '@/domain/learning'

function row(dimension: ScoreDimension, score: number, available = true): ScoreRow {
  return { dimension, score, available, reason: 't' }
}
function snap(rows: ScoreRow[], actual?: ScoreSnapshot['actual']): ScoreSnapshot {
  return { id: 's', createdAt: '', ruleId: 'default', totalScore: null, rows, actual }
}
function cand(snapshots: ScoreSnapshot[]): ProductCandidate {
  return {
    id: 'x', name: 'x', category: 'c', cost: 0, weightKg: 0,
    keywords: [], competitors: [], reviewInsights: [], status: 'active', tags: [],
    snapshots,
  }
}

describe('学习 · 成功度标签', () => {
  it('无任何实际信号时返回 null', () => {
    eq(outcomeOf(undefined), null)
    eq(outcomeOf({ note: '还行' }), null)
  })

  it('仅月销时按达标比例映射 0–100', () => {
    near(outcomeOf({ monthlySales: 0 })!, 0, 1e-9)
    near(outcomeOf({ monthlySales: 300 })!, 100, 1e-9)
    near(outcomeOf({ monthlySales: 150 })!, 50, 1e-9)
  })

  it('仅评分时按 (rating-3)/2 映射，并夹紧到 0–100', () => {
    near(outcomeOf({ rating: 3 })!, 0, 1e-9)
    near(outcomeOf({ rating: 5 })!, 100, 1e-9)
    near(outcomeOf({ rating: 1 })!, 0, 1e-9)
  })

  it('月销与评分齐备时加权（0.6/0.4）', () => {
    // 月销达标 100 分、评分 4 分(=50)；期望 0.6*100+0.4*50=80
    near(outcomeOf({ monthlySales: 300, rating: 4 })!, 80, 1e-9)
  })

  it('成功度 ≥ 60 判为成功', () => {
    assert(isSuccess(60))
    assert(!isSuccess(59))
    assert(!isSuccess(null))
  })
})

describe('学习 · 样本采集', () => {
  it('没有回填实际表现的快照不产生样本', () => {
    const cs = [cand([snap([row('market', 80)])])]
    eq(collectSamples(cs).length, 0)
  })

  it('只取可用维度作为特征，忽略 available=false 的行', () => {
    const cs = [cand([snap([row('market', 80), row('margin', 90, false)], { monthlySales: 300 })])]
    const s = collectSamples(cs)
    eq(s.length, 1)
    eq(s[0].features.margin, undefined)
    eq(s[0].features.market, 80)
  })

  it('全部维度都缺数据时该快照被跳过', () => {
    const cs = [cand([snap([row('market', 0, false), row('margin', 0, false)], { monthlySales: 100 })])]
    eq(collectSamples(cs).length, 0)
  })
})

describe('学习 · 预测与误差', () => {
  it('predict 是可用维度的加权平均分', () => {
    near(predict({ market: 100, margin: 0 }, { market: 1, margin: 1, competition: 1, differentiation: 1, trend: 1 }), 50, 1e-9)
  })

  it('缺维度不参与加权（分母同步缩小）', () => {
    near(predict({ market: 100 }, { market: 1, margin: 99, competition: 1, differentiation: 1, trend: 1 }), 100, 1e-9)
  })

  it('mse 为预测误差平方的均值', () => {
    const s: LearnSample[] = [
      { features: { market: 100 }, target: 100 },
      { features: { market: 0 }, target: 0 },
    ]
    near(mse(s, { market: 1, margin: 1, competition: 1, differentiation: 1, trend: 1 }), 0, 1e-9)
    near(mse([{ features: { market: 100 }, target: 0 }], { market: 1, margin: 1, competition: 1, differentiation: 1, trend: 1 }), 10000, 1e-9)
  })
})

describe('学习 · 拟合', () => {
  it('不修改入参的权重', () => {
    const base = cloneRules(DEFAULT_RULES)
    const before = { ...base.weights }
    const samples: LearnSample[] = [
      { features: { market: 90, margin: 80 }, target: 85 },
      { features: { market: 40, margin: 30 }, target: 35 },
    ]
    fitRules(samples, base)
    for (const d of DIMENSIONS) near(base.weights[d], before[d], 1e-12)
  })

  it('确定性：相同输入产出相同权重', () => {
    const samples: LearnSample[] = [
      { features: { market: 90, margin: 80 }, target: 85 },
      { features: { market: 40, margin: 30 }, target: 35 },
      { features: { market: 70, margin: 60 }, target: 65 },
    ]
    const a = fitRules(samples, DEFAULT_RULES)
    const b = fitRules(samples, DEFAULT_RULES)
    for (const d of DIMENSIONS) near(a.weights[d], b.weights[d], 1e-12)
  })

  it('学到强预测维度：只有 margin 携带目标信息，则 margin 权重最大且误差下降', () => {
    // 其他维度恒为常量（不携带信息），目标完全由 margin 决定 → 最优解必把权重压到 margin
    const samples: LearnSample[] = []
    for (let i = 0; i < 12; i++) {
      const target = 10 + i * 7 // 10..81
      samples.push({
        features: { market: 50, competition: 50, differentiation: 50, trend: 50, margin: target },
        target,
      })
    }
    const fitted = fitRules(samples, DEFAULT_RULES)
    let maxDim: ScoreDimension = 'margin'
    for (const d of DIMENSIONS) if (fitted.weights[d] > fitted.weights[maxDim]) maxDim = d
    eq(maxDim, 'margin')
    const before = mse(samples, DEFAULT_RULES.weights)
    const after = mse(samples, fitted.weights)
    assert(after <= before + 1e-6, `拟合后误差应下降 (before=${before}, after=${after})`)
  })

  it('权重非负、有限、总和 > 0', () => {
    const samples: LearnSample[] = [
      { features: { market: 90, margin: 80 }, target: 85 },
      { features: { market: 40, margin: 30 }, target: 35 },
    ]
    const w = fitRules(samples, DEFAULT_RULES).weights
    let sum = 0
    for (const d of DIMENSIONS) {
      assert(Number.isFinite(w[d]), `${d} 应为有限数`)
      assert(w[d] >= 0, `${d} 应非负`)
      sum += w[d]
    }
    assert(sum > 0, '权重总和应 > 0')
  })

  it('退化输入（目标全相等）不产生 NaN', () => {
    const samples: LearnSample[] = [
      { features: { market: 100, margin: 20 }, target: 70 },
      { features: { market: 10, margin: 90 }, target: 70 },
      { features: { market: 50, margin: 50 }, target: 70 },
    ]
    const w = fitRules(samples, DEFAULT_RULES).weights
    for (const d of DIMENSIONS) assert(Number.isFinite(w[d]), `${d} 不应为 NaN`)
  })

  it('极端目标（0 与 100）仍稳定', () => {
    const samples: LearnSample[] = [
      { features: { market: 100, margin: 0 }, target: 100 },
      { features: { market: 0, margin: 100 }, target: 0 },
    ]
    const w = fitRules(samples, DEFAULT_RULES).weights
    for (const d of DIMENSIONS) assert(Number.isFinite(w[d]), `${d} 不应为 NaN`)
  })
})

describe('学习 · 冷启动与报告', () => {
  it('样本数 < MIN_SAMPLES 时 fitAndReport 返回 null', () => {
    const few: LearnSample[] = [
      { features: { market: 90 }, target: 85 },
      { features: { market: 40 }, target: 35 },
    ]
    assert(few.length < MIN_SAMPLES)
    eq(fitAndReport(few, DEFAULT_RULES, 't'), null)
  })

  it('足够样本时产出前后误差对比报告', () => {
    const samples: LearnSample[] = []
    for (let i = 0; i < MIN_SAMPLES + 3; i++) {
      const t = 20 + i * 7
      samples.push({ features: { market: t, margin: t }, target: t })
    }
    const rep = fitAndReport(samples, DEFAULT_RULES, '学习规则 #1')
    assert(rep !== null, '应返回报告')
    eq(rep!.name, '学习规则 #1')
    near(rep!.mseBefore, 0, 1e-9)
    near(rep!.mseAfter, 0, 1e-9)
    assert(rep!.improved)
  })
})
