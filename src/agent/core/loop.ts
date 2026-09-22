import type { AgentAction, ToolCallRecord } from '@/types/agent'
import type { ProductCandidate } from '@/types/product'
import type { ToolContext, ToolResult } from './tool'
import type { ToolRegistry } from './registry'
import { extractJson } from './llm'
import type { ConversationMemory } from './memory'
import { PLAN_PROMPT, REFLECT_PROMPT, withSystem } from '../prompts'

export interface Step {
  tool: string
  args: Record<string, unknown>
}

export interface PlanResult {
  steps: Step[]
  planner: 'rule' | 'llm'
}

export interface ExecuteResult {
  merged: ToolResult
  toolCalls: ToolCallRecord[]
  warnings: string[]
  planner: 'rule' | 'llm'
  /** 观察—反思循环的实际开销 */
  reflection?: { rounds: number; addedTools: string[] }
}

export interface ExecuteOptions {
  /**
   * 打开观察—反思循环：每轮结束后让模型判断结果是否答足，不够则补调工具。
   * 默认关闭——编排能覆盖的场景不需要自主，开了只会增加成本与不确定性。
   */
  reflect?: boolean
  /** 最多补多少轮，默认 2。这是防跑飞的主保险，不宜调大 */
  maxRounds?: number
}

/**
 * 不允许在反思阶段补调的工具。
 * mutate 会改数据（淘汰/打标签），重复执行等于把同一件事做两遍，必须由人显式触发。
 */
const REFLECT_BLOCKED = new Set(['mutate'])

/** 反思阶段单轮最多补几个工具，防止模型一口气把所有工具都点一遍 */
const MAX_NEXT_PER_ROUND = 2

/** 确定性规划：每个意图对应固定的工具序列 */
export function rulePlan(action: AgentAction, targetId: string | null): Step[] {
  const args = targetId ? { targetId } : {}
  switch (action) {
    case 'score':
      // 评分是对全量候选品的排序，但 targetId 要传给工具：
      // 用户点名问某个品时，结论里必须单独给出它的分数与排名，不能只报第一名
      return [{ tool: 'score', args }]
    case 'price':
      return [{ tool: 'price', args }]
    case 'review':
      return [{ tool: 'review', args }]
    case 'compare':
      return [{ tool: 'compare', args: {} }]
    case 'mutate':
      return [{ tool: 'mutate', args: {} }]
    case 'report':
      // 报告是典型的多步编排：先打分，再对比，再读评论，最后成文
      return [
        { tool: 'score', args: {} },
        { tool: 'compare', args: {} },
        { tool: 'review', args },
        { tool: 'report', args },
      ]
    default:
      return []
  }
}

/** LLM 规划：让模型输出步骤数组；任何异常都退回确定性规划 */
export async function llmPlan(
  action: AgentAction,
  ctx: ToolContext,
  registry: ToolRegistry,
  memory: ConversationMemory,
): Promise<PlanResult> {
  const fallback = rulePlan(action, memory.lastTargetId)
  if (!(await ctx.llm.health())) {
    ctx.tracer.thought('模型不可用，使用确定性规划')
    return { steps: fallback, planner: 'rule' }
  }
  const names = registry.names().join(', ')
  const prompt = PLAN_PROMPT(action, ctx.query, names, memory.summary())
  try {
    const raw = await ctx.llm.chatJson<{ steps?: Array<{ tool: string }> }>([
      { role: 'user', content: prompt },
    ], { temperature: 0 })
    const steps = Array.isArray(raw?.steps) ? raw.steps : null
    if (!steps || !steps.length) return { steps: fallback, planner: 'rule' }
    const valid = steps
      .filter(s => s && typeof s.tool === 'string' && registry.has(s.tool))
      // 规则路径会把 targetId 写进 args；模型规划路径丢过 args，这里补回来，保证两条路径行为一致
      .map(s => ({ tool: s.tool, args: ctx.targetId ? { targetId: ctx.targetId } : {} }))
    if (!valid.length) return { steps: fallback, planner: 'rule' }
    ctx.tracer.thought('模型给出执行计划', valid.map(s => s.tool).join(' → '))
    return { steps: valid, planner: 'llm' }
  } catch {
    return { steps: fallback, planner: 'rule' }
  }
}

/**
 * 顺序执行计划并合并结果。
 * 后一步能看到前一步产出的候选品（比如 report 依赖 score 的结果），
 * 这是多步编排与"并行调用一堆工具"的关键区别。
 */
export async function executePlan(
  steps: Step[],
  ctx: ToolContext,
  registry: ToolRegistry,
  planner: 'rule' | 'llm',
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const warnings: string[] = []
  let candidates: ProductCandidate[] = ctx.candidates
  const merged: ToolResult = { message: '' }
  const executed: ExecutedStep[] = []
  const addedTools: string[] = []

  /** 执行一步并合并产出；返回是否产生了新的结构化结果 */
  const runOne = async (step: Step): Promise<boolean> => {
    const scoped: ToolContext = { ...ctx, candidates }
    const res = await registry.invoke(step.tool, step.args, scoped)
    if (res.warnings?.length) warnings.push(...res.warnings)
    executed.push({ tool: step.tool, message: res.message ?? '' })
    if (!res.ok) return false
    let produced = false
    if (res.candidates) {
      candidates = res.candidates
      merged.candidates = res.candidates
      produced = true
    }
    if (res.pricing) {
      merged.pricing = res.pricing
      produced = true
    }
    if (res.review) {
      merged.review = res.review
      produced = true
    }
    if (res.comparison) {
      merged.comparison = res.comparison
      produced = true
    }
    if (res.report) {
      merged.report = res.report
      produced = true
    }
    if (res.message) {
      merged.message = merged.message ? `${merged.message}\n${res.message}` : res.message
    }
    return produced
  }

  for (const step of steps) await runOne(step)

  const maxRounds = opts.reflect ? Math.max(0, opts.maxRounds ?? 2) : 0
  let rounds = 0

  for (let round = 0; round < maxRounds; round++) {
    if (!(await ctx.llm.health())) {
      ctx.tracer.thought('模型不可用，结束反思循环')
      break
    }
    const decision = await reflectNext(ctx, registry, executed, buildReflectionDigest(merged, executed))
    if (decision.done || !decision.next.length) {
      ctx.tracer.thought('模型判定结果已答足', '不再补充工具')
      break
    }
    rounds += 1
    ctx.tracer.thought(`反思第 ${rounds} 轮`, decision.next.map(s => s.tool).join(' → '))

    let produced = false
    for (const step of decision.next) {
      addedTools.push(step.tool)
      if (await runOne(step)) produced = true
    }
    // 补了一轮却什么新结果都没有：再问模型大概率还是同样答案，提前收手
    if (!produced) {
      ctx.tracer.thought('补充步骤无新产出', '提前结束反思循环')
      break
    }
  }

  return {
    merged,
    toolCalls: ctx.tracer.toolCalls,
    warnings,
    planner,
    reflection: maxRounds > 0 ? { rounds, addedTools } : undefined,
  }
}

export interface ExecutedStep {
  tool: string
  message: string
}

/**
 * 把已产出的结构化结果压缩成模型能判断的摘要（纯函数）。
 * 反思只喂工具散文时，模型看不到 pricing/review/comparison 的真实数值，
 * 容易误判"答足了"而漏掉该补的步骤——这里把结构化结果也一并喂进去。
 */
function buildReflectionDigest(merged: ToolResult, executed: ExecutedStep[]): string {
  const lines = executed.map(
    (e, i) => `${i + 1}. ${e.tool} → ${e.message || '（无文字产出）'}`,
  )
  if (merged.pricing) {
    lines.push(`定价结果：${merged.pricing.productName} 建议售价 $${merged.pricing.suggestedPrice}`)
  }
  if (merged.review) {
    const r = merged.review
    lines.push(`评论结果：${r.productName} ${r.painPoints.length} 条痛点 / ${r.positives.length} 条好评`)
  }
  if (merged.comparison) {
    const c = merged.comparison
    const winner = c.rows.find(r => r.productId === c.winnerId)
    lines.push(`对比最优：${winner?.name ?? c.winnerId ?? '无'}`)
  }
  if (merged.report?.length) {
    lines.push(`报告：${merged.report.length} 节`)
  }
  return lines.join('\n')
}

/**
 * 让模型判断是否需要补调工具。
 * 任何异常、解析失败都返回"已完成"——拿不准就停在编排的结果上，这是安全方向。
 */
export async function reflectNext(
  ctx: ToolContext,
  registry: ToolRegistry,
  executed: ExecutedStep[],
  digestOverride?: string,
): Promise<ReflectionDecision> {
  const allowed = registry.names().filter(n => !REFLECT_BLOCKED.has(n))
  const digest =
    digestOverride ??
    executed.map((e, i) => `${i + 1}. ${e.tool} → ${e.message || '（无文字产出）'}`).join('\n')
  try {
    const raw = await ctx.llm.chat(
      withSystem(REFLECT_PROMPT(ctx.query, allowed.join(', '), digest)),
      { temperature: 0 },
    )
    return parseReflection(raw, allowed, executed.map(e => e.tool))
  } catch {
    return { done: true, next: [] }
  }
}

export interface ReflectionDecision {
  done: boolean
  next: Step[]
}

/**
 * 解析反思结果（纯函数，便于单测）。
 * 三重过滤：工具必须在注册表里、不能是被禁的副作用工具、不能是已执行过的。
 */
export function parseReflection(
  raw: string | null,
  allowed: string[],
  executed: string[],
  maxNext = MAX_NEXT_PER_ROUND,
): ReflectionDecision {
  if (!raw) return { done: true, next: [] }
  const parsed = extractJson(raw) as { done?: unknown; next?: unknown } | null
  if (!parsed || typeof parsed !== 'object') return { done: true, next: [] }
  if (parsed.done === true) return { done: true, next: [] }

  const list = Array.isArray(parsed.next) ? parsed.next : []
  const next: Step[] = []
  for (const item of list) {
    if (next.length >= maxNext) break
    const name = (item as { tool?: unknown } | null)?.tool
    if (typeof name !== 'string') continue
    if (!allowed.includes(name)) continue
    if (executed.includes(name)) continue
    if (next.some(s => s.tool === name)) continue
    next.push({ tool: name, args: {} })
  }
  return { done: next.length === 0, next }
}

/** 供 llmPlan 之外使用的工具：解析模型给出的步骤（可单测） */
export function parsePlanJson(raw: string, allowed: string[]): Step[] {
  const parsed = extractJson(raw) as { steps?: Array<{ tool?: string }> } | null
  if (!parsed || !Array.isArray(parsed.steps)) return []
  return parsed.steps
    .filter(s => typeof s?.tool === 'string' && allowed.includes(s.tool))
    .map(s => ({ tool: s.tool as string, args: {} }))
}
