export interface Competitor {
  asin: string
  title: string
  price: number        // USD
  rating: number       // 0-5
  reviewCount: number
  monthlySales: number // 估算月销
}

export interface ReviewInsight {
  painPoint: string
  mentionCount: number
  sentiment: 'positive' | 'negative' | 'neutral'
}

export interface ProductCandidate {
  id: string
  name: string
  category: string
  cost: number         // 采购成本 USD
  weightKg: number
  keywords: string[]
  competitors: Competitor[]
  reviewInsights: ReviewInsight[]
  // —— 分析后填充 ——
  scores?: ScoreRow[]
  totalScore?: number
}

export interface ScoreRow {
  dimension: 'market' | 'competition' | 'differentiation' | 'margin' | 'trend'
  score: number        // 0-100
  reason: string
}

export const DIMENSION_LABELS: Record<ScoreRow['dimension'], string> = {
  market: '市场容量',
  competition: '竞争强度',
  differentiation: '差异化空间',
  margin: '利润空间',
  trend: '趋势',
}