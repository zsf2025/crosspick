import type { ProductCandidate } from './product'

export type AgentAction =
  | 'score'
  | 'price'
  | 'review'
  | 'compare'
  | 'report'
  | 'mutate'
  | 'clarify'

/** 结构化输出的定价建议 */
export interface PricingSuggestion {
  productId: string
  productName: string
  suggestedPrice: number
  priceRange: [number, number]
  breakEvenPrice: number
  targetMargin: number
  currency: 'USD'
  costBreakdown: {
    purchase: number
    inbound: number
    fbaFee: number
    referralRate: number
  }
  points: Array<{ price: number; sales: number; profit: number }>
}

/** ReAct 循环中的一步，同时用于 UI 思考链展示 */
export interface TraceStep {
  kind: 'thought' | 'action' | 'observation' | 'warning' | 'final'
  label: string
  detail?: string
  at: string
}

export interface ToolCallRecord {
  tool: string
  args: Record<string, unknown>
  ok: boolean
  durationMs: number
}

/** 评论洞察的结构化输出 */
export interface ReviewAnalysis {
  productId: string
  productName: string
  painPoints: Array<{ text: string; mentions: number }>
  positives: string[]
  suggestions: string[]
  modelSummary?: string
  degraded: boolean
}

export interface ComparisonRow {
  productId: string
  name: string
  avgPrice: number
  cost: number
  marginPct: number | null
  competitorCount: number
  totalReviews: number
  totalScore: number | null
}

export interface ComparisonResult {
  rows: ComparisonRow[]
  winnerId: string | null
  notes: string[]
}

export interface ReportSection {
  heading: string
  body: string
}

export interface AgentOutput {
  id: string
  createdAt: string
  query: string
  action: AgentAction
  /** 路由命中方式：rule=关键词规则, llm=模型兜底, fallback=异常降级 */
  routedBy: 'rule' | 'llm' | 'fallback'
  /**
   * 本轮定位到的目标商品 id。
   * 用途：UI 把选中项同步到用户实际在问的那个品——
   * 否则用户问"第一个品"，评分重排后雷达图还停在旧选中项上。
   */
  targetId?: string | null
  reasoning: string[]
  /**
   * 模型看着本轮真实结果补的一句话结论。
   * 与 reasoning 的区别：reasoning 是确定性工具拼出来的事实，summary 是模型的话。
   * 模型不可用或失败时为 undefined——它是增益项，不是必需项。
   */
  summary?: string
  candidates: ProductCandidate[]
  pricing?: PricingSuggestion
  review?: ReviewAnalysis
  comparison?: ComparisonResult
  report?: ReportSection[]
  /** 本轮对候选品的变更意图（淘汰/打标签/改状态） */
  mutations?: Array<{ productId: string; kind: string; value: string }>
  warnings: string[]
  trace: TraceStep[]
  toolCalls: ToolCallRecord[]
  /** 观察—反思循环的实际开销，关闭自主时为 undefined */
  reflection?: { rounds: number; addedTools: string[] }
  /** 用户中途取消时为 true；输出是取消那一刻已产生的部分结果 */
  aborted?: boolean
  /** 命中提示词注入等护栏告警的标签（输入侧检测，喂给模型前已中和） */
  guardrails?: string[]
  /**
   * 质量评估（LLM-as-judge）：模型按 rubric 对本轮回答打分，模型不可用则回退启发式。
   * 与 summary 一样是增益项——算不出来也不影响主结果。
   */
  eval?: AgentEval
  usage?: { llmCalls: number; promptChars: number; completionChars: number }
}

/** 质量评估的单个维度得分（0-100）与权重 */
export interface EvalDimension {
  key: string
  label: string
  /** 该维度得分 0-100 */
  score: number
  /** 该维度在总分里的权重（所有维度权重和为 1） */
  weight: number
}

/**
 * 质量评估结果（LLM-as-judge）。
 * - method='heuristic'：纯函数离线打分，无需模型，始终可用；
 * - method='llm'：模型按 rubric 打分，模型不可用或解析失败时回退 heuristic。
 */
export interface AgentEval {
  /** 加权总分 0-100 */
  total: number
  /** 等级：A(≥85) / B(≥70) / C(≥55) / D(<55) */
  grade: 'A' | 'B' | 'C' | 'D'
  dimensions: EvalDimension[]
  method: 'heuristic' | 'llm'
  /** 改进建议（中文） */
  notes: string[]
}

export function emptyUsage() {
  return { llmCalls: 0, promptChars: 0, completionChars: 0 }
}
