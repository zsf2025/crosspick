export type ScoreDimension =
  | 'market'
  | 'competition'
  | 'differentiation'
  | 'margin'
  | 'trend'

export type CandidateStatus = 'active' | 'watching' | 'rejected'

export interface Competitor {
  asin: string
  title: string
  price: number // USD
  rating: number // 0-5
  reviewCount: number
  monthlySales: number // 估算月销
}

export interface ReviewInsight {
  painPoint: string
  mentionCount: number
  sentiment: 'positive' | 'negative' | 'neutral'
}

/**
 * 单维度评分结果。
 * available=false 表示输入数据不足以支撑该维度，UI 应显示 N/A 而不是 0 分。
 */
export interface ScoreRow {
  dimension: ScoreDimension
  score: number // 0-100，available 为 false 时恒为 0
  available: boolean
  reason: string
}

/** 决策复盘用：某次评分的快照 + 后续回填的实际表现 */
export interface ScoreSnapshot {
  id: string
  createdAt: string
  ruleId: string
  totalScore: number | null
  rows: ScoreRow[]
  actual?: {
    monthlySales?: number
    rating?: number
    note?: string
  }
}

export interface ProductCandidate {
  id: string
  name: string
  category: string
  cost: number // 采购成本 USD
  weightKg: number
  keywords: string[]
  competitors: Competitor[]
  reviewInsights: ReviewInsight[]
  status: CandidateStatus
  tags: string[]
  // —— 分析后填充 ——
  scores?: ScoreRow[]
  totalScore?: number | null
  snapshots?: ScoreSnapshot[]
}

export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  market: '市场容量',
  competition: '竞争强度',
  differentiation: '差异化空间',
  margin: '利润空间',
  trend: '趋势',
}

export const DIMENSIONS: ScoreDimension[] = [
  'market',
  'competition',
  'differentiation',
  'margin',
  'trend',
]

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  active: '在跟',
  watching: '观察',
  rejected: '已淘汰',
}

export function createCandidate(partial: Partial<ProductCandidate>): ProductCandidate {
  return {
    id: partial.id ?? '',
    name: partial.name ?? '',
    category: partial.category ?? 'Uncategorized',
    cost: partial.cost ?? 0,
    weightKg: partial.weightKg ?? 0,
    keywords: partial.keywords ?? [],
    competitors: partial.competitors ?? [],
    reviewInsights: partial.reviewInsights ?? [],
    status: partial.status ?? 'active',
    tags: partial.tags ?? [],
    scores: partial.scores,
    totalScore: partial.totalScore,
    snapshots: partial.snapshots ?? [],
  }
}
