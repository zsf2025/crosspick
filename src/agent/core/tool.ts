import type { ProductCandidate } from '@/types/product'
import type {
  PricingSuggestion,
  ReviewAnalysis,
  ComparisonResult,
  ReportSection,
} from '@/types/agent'
import type { ScoringRules } from '@/domain/rules'
import { DEFAULT_RULES } from '@/domain/rules'
import type { FbaConfig } from '@/domain/fba'
import { DEFAULT_FBA_CONFIG } from '@/domain/fba'
import type { LLMProvider } from './llm'
import type { Tracer } from './trace'

export interface ToolContext {
  query: string
  candidates: ProductCandidate[]
  rules: ScoringRules
  fba: FbaConfig
  llm: LLMProvider
  tracer: Tracer
  /** 从 query 中定位目标商品（名称匹配 / 序号 / 上一轮指代） */
  resolveTarget: (query: string) => ProductCandidate | null
  /** 流式回调：模型每产出一段文本就回传一次，用于逐字渲染 */
  onDelta?: (chunk: string) => void
  /** 允许工具修改候选品（淘汰、打标签） */
  mutate: (productId: string, kind: string, value: string) => void
}

export interface ToolResult {
  message: string
  candidates?: ProductCandidate[]
  pricing?: PricingSuggestion
  review?: ReviewAnalysis
  comparison?: ComparisonResult
  report?: ReportSection[]
  warnings?: string[]
}

export interface Tool<A = Record<string, unknown>> {
  name: string
  description: string
  /** 参数说明，用于生成给 LLM 的工具清单 */
  args?: Record<string, string>
  run(args: A, ctx: ToolContext): Promise<ToolResult>
}

export const EMPTY_RESULT: ToolResult = { message: '' }

export function defaultContext(partial: Partial<ToolContext> & Pick<ToolContext, 'candidates' | 'llm' | 'tracer' | 'resolveTarget' | 'mutate'>): ToolContext {
  return {
    query: partial.query ?? '',
    candidates: partial.candidates,
    rules: partial.rules ?? DEFAULT_RULES,
    fba: partial.fba ?? DEFAULT_FBA_CONFIG,
    llm: partial.llm,
    tracer: partial.tracer,
    resolveTarget: partial.resolveTarget,
    mutate: partial.mutate,
  }
}
