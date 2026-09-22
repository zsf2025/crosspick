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
  /** 本轮路由已解析出的目标商品 id——优先于 query 重新解析，避免工具各自再算一遍 */
  targetId?: string | null
  candidates: ProductCandidate[]
  rules: ScoringRules
  fba: FbaConfig
  llm: LLMProvider
  tracer: Tracer
  /** 从 query 中定位目标商品（名称匹配 / 序号 / 上一轮指代）；若 ctx.targetId 已就绪则直接返回它 */
  resolveTarget: (query: string) => ProductCandidate | null
  /** 流式回调：模型每产出一段文本就回传一次，用于逐字渲染 */
  onDelta?: (chunk: string) => void
  /** 允许工具修改候选品（淘汰、打标签） */
  mutate: (productId: string, kind: string, value: string) => void
  /** 取消信号：编排层在每步前检查，用户中止时立即停手 */
  signal?: AbortSignal
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
    targetId: partial.targetId ?? null,
    candidates: partial.candidates,
    rules: partial.rules ?? DEFAULT_RULES,
    fba: partial.fba ?? DEFAULT_FBA_CONFIG,
    llm: partial.llm,
    tracer: partial.tracer,
    resolveTarget: partial.resolveTarget,
    mutate: partial.mutate,
  }
}
