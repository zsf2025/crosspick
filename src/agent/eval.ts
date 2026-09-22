import type { AgentAction, AgentEval, AgentOutput, EvalDimension } from '@/types/agent'
import type { ProductCandidate } from '@/types/product'
import type { LLMProvider } from './core/llm'
import type { Tracer } from './core/trace'
import { ruleRoute } from './router'
import { buildDigest } from './summary'
import { withSystem, EVAL_PROMPT } from './prompts'

/**
 * 质量评估（LLM-as-judge）。
 *
 * 设计原则（与 summary / guardrails 一致，都是"增益项"）：
 * - 不依赖模型也能给出质量分——纯函数启发式评估永远可用，模型只是锦上添花；
 * - 模型打分失败（不可用 / 输出不合规范 / 抛错）一律安静回退到启发式，不影响主结果；
 * - rubric 与打分逻辑集中在此文件，便于 eval 对比与调权重，也便于单测复现。
 */

/** 评分 rubric：5 个维度，权重和为 1 */
const RUBRIC: Array<{ key: string; label: string; weight: number }> = [
  { key: 'relevance', label: '切题度', weight: 0.3 },
  { key: 'target', label: '目标命中', weight: 0.2 },
  { key: 'tooling', label: '工具使用', weight: 0.2 },
  { key: 'groundedness', label: '有据可依', weight: 0.15 },
  { key: 'completeness', label: '完整度', weight: 0.15 },
]

interface RubricScores {
  relevance: number
  target: number
  tooling: number
  groundedness: number
  completeness: number
}

export interface EvalInput {
  query: string
  candidates: ProductCandidate[]
}

function gradeOf(total: number): AgentEval['grade'] {
  if (total >= 85) return 'A'
  if (total >= 70) return 'B'
  if (total >= 55) return 'C'
  return 'D'
}

/** 各维度纯函数打分——离线可评，不调模型 */

function scoreRelevance(query: string, action: AgentAction): number {
  const expected = ruleRoute(query)
  if (expected === null) return 85 // 规则覆盖不到（如指代"它"），给中性偏高，不误伤
  return expected === action ? 100 : 40
}

function scoreTarget(out: AgentOutput, candidates: ProductCandidate[]): number {
  if (!out.targetId) return 100 // 用户没点名，不适用
  const exists = candidates.some(c => c.id === out.targetId)
  if (!exists) return 100 // 目标已不在清单里，不扣分
  if (out.action === 'price') return out.pricing?.productId === out.targetId ? 100 : 50
  if (out.action === 'review') return out.review?.productId === out.targetId ? 100 : 50
  const scored = out.candidates.some(c => c.id === out.targetId && typeof c.totalScore === 'number')
  const inCompare = out.comparison?.rows.some(r => r.productId === out.targetId)
  return scored || inCompare ? 100 : 50
}

function scoreTooling(out: AgentOutput): number {
  if (out.action === 'clarify') return 100 // 澄清无需工具
  return out.toolCalls.length > 0 ? 100 : 0
}

function scoreGroundedness(out: AgentOutput): number {
  const hasData =
    out.candidates.some(c => typeof c.totalScore === 'number') ||
    !!out.pricing ||
    !!out.review ||
    !!out.comparison ||
    !!out.report?.length
  return out.reasoning.length > 0 || out.summary || hasData ? 100 : 45
}

function scoreCompleteness(out: AgentOutput): number {
  let s = 80
  if (out.aborted) s -= 35
  s -= Math.min(out.warnings.length, 3) * 10
  if (out.guardrails?.length) s -= 10
  if (out.summary) s += 12
  return Math.max(0, Math.min(100, s))
}

function buildNotes(raw: RubricScores, out: AgentOutput): string[] {
  const notes: string[] = []
  if (raw.relevance < 60) notes.push('回答与用户意图不太一致，可能是路由判断有偏差')
  if (raw.target < 100) notes.push('用户点名的商品没有被重点处理，建议确认目标定位')
  if (raw.tooling < 60) notes.push('本轮未调用工具，结论缺乏数据支撑')
  if (raw.groundedness < 60) notes.push('结论缺乏真实数据依据，建议先执行评分/对比等工具')
  if (raw.completeness < 70) {
    if (out.aborted) notes.push('用户中途取消了本轮分析')
    else if (out.warnings.length) notes.push('存在告警信息，结果需谨慎对待')
  }
  if (!notes.length) notes.push('本轮回答质量良好')
  return notes
}

function dimensionsOf(raw: RubricScores): EvalDimension[] {
  return RUBRIC.map(r => ({
    key: r.key,
    label: r.label,
    weight: r.weight,
    score: raw[r.key as keyof RubricScores],
  }))
}

function totalOf(dimensions: EvalDimension[]): number {
  return Math.round(dimensions.reduce((s, d) => s + d.score * d.weight, 0))
}

/**
 * 纯函数启发式评估：不依赖模型，离线即可给出质量分。
 * 是 llmEvaluate 的兜底，也是无模型环境下 runAgent 默认挂的质量分。
 */
export function evaluateOutput(out: AgentOutput, input: EvalInput): AgentEval {
  const raw: RubricScores = {
    relevance: scoreRelevance(input.query, out.action),
    target: scoreTarget(out, input.candidates),
    tooling: scoreTooling(out),
    groundedness: scoreGroundedness(out),
    completeness: scoreCompleteness(out),
  }
  const dimensions = dimensionsOf(raw)
  return {
    total: totalOf(dimensions),
    grade: gradeOf(totalOf(dimensions)),
    dimensions,
    method: 'heuristic',
    notes: buildNotes(raw, out),
  }
}

function clampScore(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return Math.max(0, Math.min(100, v))
}

export interface LlmEvalOptions {
  llm: LLMProvider
  tracer?: Tracer
  signal?: AbortSignal
}

/**
 * 模型质量评估：模型按 EVAL_PROMPT 的 rubric 给 5 维打分，收敛成总分。
 * 任何失败（模型不可用 / 解析不出 dimensions / 抛错）都回退到 evaluateOutput，
 * 保证 runAgent 末尾总能挂上一个质量分，且不影响主结果。
 */
export async function llmEvaluate(
  query: string,
  out: AgentOutput,
  candidates: ProductCandidate[],
  opts: LlmEvalOptions,
): Promise<AgentEval> {
  const fallback = evaluateOutput(out, { query, candidates })
  if (!(await opts.llm.health())) return fallback

  const digest = buildDigest({
    query,
    action: out.action,
    message: out.reasoning.join('\n'),
    candidates: out.candidates,
    targetId: out.targetId,
    pricing: out.pricing,
    review: out.review,
    comparison: out.comparison,
    report: out.report,
  })
  const messages = withSystem(EVAL_PROMPT(query, out.action, digest))

  try {
    const res = await opts.llm.chatJson<{
      dimensions?: Partial<RubricScores>
      notes?: string[]
    }>(messages, { temperature: 0, signal: opts.signal })
    if (!res || !res.dimensions) return fallback

    const raw: RubricScores = {
      relevance: clampScore(res.dimensions.relevance),
      target: clampScore(res.dimensions.target),
      tooling: clampScore(res.dimensions.tooling),
      groundedness: clampScore(res.dimensions.groundedness),
      completeness: clampScore(res.dimensions.completeness),
    }
    const dimensions = dimensionsOf(raw)
    const total = totalOf(dimensions)
    const notes = (res.notes ?? [])
      .filter((n): n is string => typeof n === 'string' && !!n)
      .slice(0, 4)
    opts.tracer?.thought('模型质量评估', `等级 ${gradeOf(total)} · ${total}/100`)
    return {
      total,
      grade: gradeOf(total),
      dimensions,
      method: 'llm',
      notes: notes.length ? notes : fallback.notes,
    }
  } catch {
    return fallback
  }
}
