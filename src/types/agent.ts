import type { ProductCandidate } from './product'



export type AgentAction = 'score' | 'price' | 'review' | 'report' | 'clarify'

export interface AgentRequest {
  query: string
  candidates: ProductCandidate[]
}

export interface PricingSuggestion {
  suggestedPrice: number
  priceRange: [number, number]
  breakEvenPrice: number
  points: Array<{ price: number; sales: number; profit: number }>
}

export interface AgentOutput {
  id: string
  createdAt: string
  query: string
  action: AgentAction
  reasoning: string[]      // 思考链，用于时间线
  candidates: ProductCandidate[]
  pricing?: PricingSuggestion
  warnings: string[]
  raw?: unknown            // 调试用
}