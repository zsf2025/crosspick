import type { ProductCandidate } from '@/types/product'
import type { AgentOutput, ToolCallRecord } from '@/types/agent'
import type { ScoringRules } from '@/domain/rules'
import { DEFAULT_RULES } from '@/domain/rules'
import type { FbaConfig } from '@/domain/fba'
import { DEFAULT_FBA_CONFIG } from '@/domain/fba'
import { Tracer } from './core/trace'
import { ConversationMemory } from './core/memory'
import { ToolRegistry } from './core/registry'
import type { ToolContext } from './core/tool'
import { createDefaultRegistry } from './tools'
import { route, resolveTargetId } from './router'
import { buildDigest, summarize } from './summary'
import { rulePlan, llmPlan, executePlan } from './core/loop'
import type { LLMProvider } from './core/llm'
import { NullProvider } from './core/llm'

export function genId(prefix = 'a'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface RunOptions {
  query: string
  candidates: ProductCandidate[]
  rules?: ScoringRules
  fba?: FbaConfig
  llm?: LLMProvider
  memory?: ConversationMemory
  registry?: ToolRegistry
  /** 打开后由模型决定工具序列；默认关闭，保证小模型下结果稳定 */
  useLlmPlanner?: boolean
  /** 打开观察—反思循环：执行完让模型判断是否答足，不够则补调工具；默认关闭 */
  reflect?: boolean
  /** 反思循环最多补几轮，默认 2 */
  maxRounds?: number
  /**
   * 收尾总结：所有工具跑完后让模型看着真实结果补一句话结论。默认开启。
   * 模型不可用时会安静跳过，不影响主结果。
   */
  summarize?: boolean
  /** 流式回调，透传给工具 */
  onDelta?: (chunk: string) => void
  /** 总结专用流式回调：与工具输出分开，避免两种流混在同一个缓冲区 */
  onSummaryDelta?: (chunk: string) => void
}

export interface RunOutcome {
  output: AgentOutput
  mutations: Array<{ productId: string; kind: string; value: string }>
  memory: ConversationMemory
}

const CLARIFY_HINT =
  '没太理解，可以试试：给所有候选品打分 / 给台灯定价 / 分析台灯的评论 / 对比这几个品 / 生成选品报告'

export async function runAgent(opts: RunOptions): Promise<RunOutcome> {
  const id = genId('run')
  const createdAt = new Date().toISOString()
  const query = opts.query.trim()
  const tracer = new Tracer()
  const memory = opts.memory ?? new ConversationMemory()
  const llm = opts.llm ?? new NullProvider()
  const registry = opts.registry ?? createDefaultRegistry()
  const rules = opts.rules ?? DEFAULT_RULES
  const fba = opts.fba ?? DEFAULT_FBA_CONFIG

  const mutations: Array<{ productId: string; kind: string; value: string }> = []

  tracer.thought('解析用户意图', query)

  const routed = await route(query, opts.candidates, llm, memory)
  tracer.observation(
    `意图：${routed.action}`,
    `路由方式：${routed.routedBy}${routed.targetId ? `，目标 ${routed.targetId}` : ''}`,
  )

  if (routed.action === 'clarify') {
    tracer.final('需要用户补充信息')
    return {
      output: {
        id,
        createdAt,
        query,
        action: 'clarify',
        routedBy: routed.routedBy,
        targetId: routed.targetId,
        reasoning: ['无法确定意图，需要追问'],
        candidates: opts.candidates,
        warnings: [CLARIFY_HINT],
        trace: tracer.steps,
        toolCalls: tracer.toolCalls,
        usage: tracer.usage,
      },
      mutations,
      memory,
    }
  }

  const ctx: ToolContext = {
    query,
    candidates: opts.candidates,
    rules,
    fba,
    llm,
    tracer,
    resolveTarget: (q: string) => {
      const tid = resolveTargetId(q, opts.candidates, memory)
      return tid ? opts.candidates.find(c => c.id === tid) ?? null : null
    },
    mutate: (productId: string, kind: string, value: string) => {
      mutations.push({ productId, kind, value })
    },
    onDelta: opts.onDelta,
  }

  const plan = opts.useLlmPlanner
    ? await llmPlan(routed.action, ctx, registry, memory)
    : { steps: rulePlan(routed.action, routed.targetId), planner: 'rule' as const }

  tracer.thought('生成执行计划', plan.steps.map(s => s.tool).join(' → ') || '（无需调用工具）')

  const executed = await executePlan(plan.steps, ctx, registry, plan.planner, {
    reflect: opts.reflect,
    maxRounds: opts.maxRounds,
  })

  const reasoning = executed.merged.message
    ? executed.merged.message.split('\n').filter(Boolean)
    : [`已执行 ${plan.steps.length} 个工具`]

  // 收尾总结：确定性结果已经齐了，再让模型说一句人话。
  // 放在最后是因为它要看到全部产出；失败也无所谓，主结果不受影响。
  let modelSummary: string | undefined
  if (opts.summarize !== false) {
    const finalCandidates = executed.merged.candidates ?? opts.candidates
    const digest = buildDigest({
      query,
      action: routed.action,
      message: executed.merged.message,
      candidates: finalCandidates,
      targetId: routed.targetId,
      pricing: executed.merged.pricing,
      review: executed.merged.review,
      comparison: executed.merged.comparison,
      report: executed.merged.report,
    })
    modelSummary =
      (await summarize(query, digest, {
        llm,
        tracer,
        onDelta: opts.onSummaryDelta,
      })) ?? undefined
  }

  if (executed.merged.candidates?.length) {
    tracer.final('完成', `${executed.merged.candidates.length} 个候选品`)
  }

  memory.push({ query, action: routed.action, targetId: routed.targetId })

  return {
    output: {
      id,
      createdAt,
      query,
      action: routed.action,
      routedBy: routed.routedBy,
      targetId: routed.targetId,
      reasoning,
      summary: modelSummary,
      candidates: executed.merged.candidates ?? opts.candidates,
      pricing: executed.merged.pricing,
      review: executed.merged.review,
      comparison: executed.merged.comparison,
      report: executed.merged.report,
      mutations,
      warnings: executed.warnings,
      reflection: executed.reflection,
      trace: tracer.steps,
      toolCalls: executed.toolCalls as ToolCallRecord[],
      usage: tracer.usage,
    },
    mutations,
    memory,
  }
}

