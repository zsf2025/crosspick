import type { ProductCandidate, ScoreRow, ScoreDimension } from '@/types/product'
import { DIMENSIONS } from '@/types/product'
import { DEFAULT_RULES, matchTier, normalizeWeights } from './rules'
import type { ScoringRules } from './rules'

export function avgPrice(c: ProductCandidate): number {
  if (!c.competitors.length) return 0
  return c.competitors.reduce((s, i) => s + i.price, 0) / c.competitors.length
}

export function totalReviews(c: ProductCandidate): number {
  return c.competitors.reduce((s, i) => s + i.reviewCount, 0)
}

/** 毛利率 = (均价 - 成本) / 均价；数据不足返回 null */
export function grossMargin(c: ProductCandidate): number | null {
  const p = avgPrice(c)
  if (p <= 0 || c.cost <= 0) return null
  return (p - c.cost) / p
}

function row(
  dimension: ScoreDimension,
  value: number | null,
  reason: string,
): ScoreRow {
  if (value === null) {
    return { dimension, score: 0, available: false, reason }
  }
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return { dimension, score: clamped, available: true, reason }
}

export function scoreMarket(c: ProductCandidate, rules: ScoringRules): ScoreRow {
  const reviews = totalReviews(c)
  const hit = reviews > 0 ? matchTier(rules.market.tiers, reviews) : null
  return row(
    'market',
    hit,
    hit === null ? '缺少竞品评论数据' : `竞品评论总数 ${reviews}`,
  )
}

export function scoreCompetition(c: ProductCandidate, rules: ScoringRules): ScoreRow {
  const n = c.competitors.length
  if (n === 0) return row('competition', null, '缺少竞品数据')
  const avgRating = c.competitors.reduce((s, i) => s + i.rating, 0) / n
  const { base, perCompetitor, ratingFactor } = rules.competition
  const raw = base - n * perCompetitor - (avgRating - 3) * ratingFactor
  return row(
    'competition',
    raw,
    `${n} 个竞品，均分 ${avgRating.toFixed(1)}`,
  )
}

export function scoreDifferentiation(c: ProductCandidate, rules: ScoringRules): ScoreRow {
  if (!c.reviewInsights.length) {
    return row('differentiation', null, '缺少评论洞察数据')
  }
  const negatives = c.reviewInsights.filter(i => i.sentiment === 'negative')
  const { base, perPainPoint, max } = rules.differentiation
  return row(
    'differentiation',
    Math.min(max, base + negatives.length * perPainPoint),
    `${negatives.length} 条负面痛点`,
  )
}

export function scoreMargin(c: ProductCandidate, rules: ScoringRules): ScoreRow {
  const m = grossMargin(c)
  const hit = m === null ? null : matchTier(rules.margin.tiers, m)
  return row(
    'margin',
    hit,
    hit === null ? '缺少成本或竞品价格' : `毛利率 ${((m ?? 0) * 100).toFixed(0)}%`,
  )
}

export function scoreTrend(c: ProductCandidate, rules: ScoringRules): ScoreRow {
  if (!c.keywords.length) return row('trend', null, '缺少关键词')
  const kw = c.keywords.join(' ').toLowerCase()
  const hits = rules.trend.keywords.filter(w => kw.includes(w.toLowerCase())).length
  return row(
    'trend',
    rules.trend.base + hits * rules.trend.perHit,
    `命中 ${hits} 个趋势词`,
  )
}

export function scoreCandidate(
  c: ProductCandidate,
  rules: ScoringRules = DEFAULT_RULES,
): ScoreRow[] {
  return [
    scoreMarket(c, rules),
    scoreCompetition(c, rules),
    scoreDifferentiation(c, rules),
    scoreMargin(c, rules),
    scoreTrend(c, rules),
  ]
}

/**
 * 加权总分。只统计 available 的维度，并按其权重归一化。
 * 全部维度都缺数据时返回 null（而不是 0），避免"没数据=很差"的误判。
 */
export function aggregateScore(
  rows: ScoreRow[],
  rules: ScoringRules = DEFAULT_RULES,
): number | null {
  const weights = normalizeWeights(rules.weights)
  let sum = 0
  let wsum = 0
  for (const r of rows) {
    if (!r.available) continue
    const w = weights[r.dimension] ?? 0
    sum += r.score * w
    wsum += w
  }
  if (wsum <= 0) return null
  return Math.round(sum / wsum)
}

/** 返回新数组（不修改入参），按总分降序，无分的排最后 */
export function scoreCandidates(
  list: ProductCandidate[],
  rules: ScoringRules = DEFAULT_RULES,
): ProductCandidate[] {
  const scored = list.map(c => {
    const scores = scoreCandidate(c, rules)
    return { ...c, scores, totalScore: aggregateScore(scores, rules) }
  })
  return scored.sort((a, b) => {
    const ta = a.totalScore
    const tb = b.totalScore
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return tb - ta
  })
}

export function missingDimensions(c: ProductCandidate): ScoreDimension[] {
  return DIMENSIONS.filter(d => {
    const r = c.scores?.find(s => s.dimension === d)
    return !r || !r.available
  })
}
