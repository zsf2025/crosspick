import type { ScoreDimension } from '@/types/product'

/** 阈值档位：指标值 >= at 时取 score，从上往下匹配第一个命中的 */
export interface Tier {
  at: number
  score: number
}

export interface ScoringRules {
  id: string
  name: string
  weights: Record<ScoreDimension, number>
  /** 竞品评论总数 → 市场容量分 */
  market: { tiers: Tier[] }
  /** 毛利率 → 利润空间分 */
  margin: { tiers: Tier[] }
  /** 竞争强度：base - 竞品数 × perCompetitor - (均分 - 3) × ratingFactor */
  competition: { base: number; perCompetitor: number; ratingFactor: number }
  /** 差异化：base + 负面痛点数 × perPainPoint，上限 max */
  differentiation: { base: number; perPainPoint: number; max: number }
  /** 趋势：base + 命中趋势词数 × perHit，词表可编辑 */
  trend: { base: number; perHit: number; keywords: string[] }
}

export const DEFAULT_RULES_ID = 'default'

export const DEFAULT_RULES: ScoringRules = {
  id: DEFAULT_RULES_ID,
  name: '默认策略',
  weights: {
    market: 1,
    competition: 1,
    differentiation: 1,
    margin: 1.5,
    trend: 0.5,
  },
  market: {
    tiers: [
      { at: 50000, score: 90 },
      { at: 20000, score: 75 },
      { at: 5000, score: 60 },
      { at: 1, score: 40 },
    ],
  },
  margin: {
    tiers: [
      { at: 0.7, score: 95 },
      { at: 0.5, score: 80 },
      { at: 0.3, score: 60 },
      { at: -Infinity, score: 30 },
    ],
  },
  competition: { base: 100, perCompetitor: 10, ratingFactor: 20 },
  differentiation: { base: 20, perPainPoint: 25, max: 100 },
  trend: {
    base: 50,
    perHit: 15,
    keywords: ['wireless', 'silicone', 'resistance', 'portable', 'rechargeable'],
  },
}

/** 保守策略：更看重利润与竞争温和度，弱化市场容量 */
export const CONSERVATIVE_RULES: ScoringRules = {
  ...DEFAULT_RULES,
  id: 'conservative',
  name: '保守策略',
  weights: {
    market: 0.5,
    competition: 1.5,
    differentiation: 1,
    margin: 2,
    trend: 0.5,
  },
}

/** 激进策略：看重市场容量与趋势，容忍激烈竞争 */
export const AGGRESSIVE_RULES: ScoringRules = {
  ...DEFAULT_RULES,
  id: 'aggressive',
  name: '激进策略',
  weights: {
    market: 2,
    competition: 0.5,
    differentiation: 1,
    margin: 1,
    trend: 1.5,
  },
}

export const RULE_PRESETS: ScoringRules[] = [
  DEFAULT_RULES,
  CONSERVATIVE_RULES,
  AGGRESSIVE_RULES,
]

/** 按降序档位匹配，未命中返回 null（表示数据不足） */
export function matchTier(tiers: Tier[], value: number): number | null {
  for (const t of tiers) {
    if (value >= t.at) return t.score
  }
  return null
}

export function cloneRules(r: ScoringRules): ScoringRules {
  return {
    ...r,
    weights: { ...r.weights },
    market: { tiers: r.market.tiers.map(t => ({ ...t })) },
    margin: { tiers: r.margin.tiers.map(t => ({ ...t })) },
    competition: { ...r.competition },
    differentiation: { ...r.differentiation },
    trend: { ...r.trend, keywords: [...r.trend.keywords] },
  }
}

/** 权重归一化校验：全零时退回等权，避免出现除零 */
export function normalizeWeights(weights: Record<ScoreDimension, number>) {
  const sum = Object.values(weights).reduce((s, w) => s + Math.max(0, w), 0)
  if (sum <= 0) {
    return { market: 1, competition: 1, differentiation: 1, margin: 1, trend: 1 }
  }
  return weights
}
