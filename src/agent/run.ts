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
import type { ExecuteResult } from './core/loop'
import type { ChatMessage, ChatOptions, LLMProvider, ToolCallDef, ToolCallResult } from './core/llm'
import { NullProvider } from './core/llm'
import { sanitizeQuery, detectInjection } from './guardrails'
import { isAbort } from './core/errors'
import { evaluateOutput, llmEvaluate } from './eval'

export function genId(prefix = 'a'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 成本计数器包装器：把 LLM 的每次调用（chat / chatJson / stream）以"提示词 + 补全"字符数
 * 累加进 Tracer 的 usage。放在编排层而非 Provider 内部，是因为 usage 是"一次运行"的视图，
 * 而 Provider 是全局单例——计数必须由单次 runAgent 持有，才能准确反映这一轮花了多少。
 */
class CountingLLM implements LLMProvider {
  readonly name = 'counting'
  private inner: LLMProvider
  private tracer: Tracer

  constructor(inner: LLMProvider, tracer: Tracer) {
    this.inner = inner
    this.tracer = tracer
  }

  private tally(messages: ChatMessage[], completion: string) {
    this.tracer.recordLlmCall(
      messages.reduce((s, m) => s + m.content.length, 0),
      completion.length,
    )
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const text = await this.inner.chat(messages, { ...options, signal: options?.signal })
    this.tally(messages, text)
    return text
  }

  async chatJson<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T | null> {
    const json = await this.inner.chatJson<T>(messages, { ...options, signal: options?.signal })
    if (json !== null) this.tally(messages, JSON.stringify(json))
    return json
  }

  async stream(
    messages: ChatMessage[],
    options: ChatOptions,
    onDelta: (chunk: string) => void,
  ): Promise<string> {
    const text = await this.inner.stream(messages, { ...options, signal: options?.signal }, onDelta)
    this.tally(messages, text)
    return text
  }

  async chatTools(
    messages: ChatMessage[],
    tools: ToolCallDef[],
    options?: ChatOptions,
  ): Promise<ToolCallResult> {
    const res = await this.inner.chatTools(messages, tools, { ...options, signal: options?.signal })
    this.tally(messages, JSON.stringify(res))
    return res
  }

  health(): Promise<boolean> {
    return this.inner.health()
  }
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
  /** 取消信号：用户中止时立即停止编排与网络请求 */
  signal?: AbortSignal
  /** 质量评估（LLM-as-judge）：默认开启；模型不可用会安静回退到启发式打分 */
  evaluate?: boolean
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
  const rawQuery = opts.query.trim()
  const tracer = new Tracer()
  const memory = opts.memory ?? new ConversationMemory()
  // 用计数包装器包一层：这一轮所有的模型调用都被记进 tracer.usage，供 UI 展示成本
  const llm = new CountingLLM(opts.llm ?? new NullProvider(), tracer)
  const registry = opts.registry ?? createDefaultRegistry()
  const rules = opts.rules ?? DEFAULT_RULES
  const fba = opts.fba ?? DEFAULT_FBA_CONFIG

  const mutations: Array<{ productId: string; kind: string; value: string }> = []

  tracer.thought('解析用户意图', rawQuery)

  // 护栏：清洗输入并检测提示词注入（命中只告警、不拒绝，避免误杀正常选品词）
  const cleanQuery = sanitizeQuery(rawQuery)
  const guardFlags = detectInjection(cleanQuery)
  if (guardFlags.length) {
    tracer.warning('输入疑似包含提示词注入', guardFlags.join('、'))
  }
  const query = cleanQuery

  const routed = await route(query, opts.candidates, llm, memory, opts.signal)
  tracer.observation(
    `意图：${routed.action}`,
    `路由方式：${routed.routedBy}${routed.targetId ? `，目标 ${routed.targetId}` : ''}`,
  )

  if (routed.action === 'clarify') {
    tracer.final('需要用户补充信息')
    const clarified: AgentOutput = {
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
    }
    clarified.eval = evaluateOutput(clarified, { query, candidates: opts.candidates })
    return { output: clarified, mutations, memory }
  }

  const ctx: ToolContext = {
    query,
    // 路由已经定位过一次目标，这里直接透传，工具内部不再各自重新解析，
    // 既省一次模型调用，也保证"路由说 A、工具改做 B"的不一致不再发生
    targetId: routed.targetId,
    candidates: opts.candidates,
    rules,
    fba,
    llm,
    tracer,
    resolveTarget: (q: string) => {
      const tid = routed.targetId ?? resolveTargetId(q, opts.candidates, memory)
      return tid ? opts.candidates.find(c => c.id === tid) ?? null : null
    },
    mutate: (productId: string, kind: string, value: string) => {
      mutations.push({ productId, kind, value })
    },
    onDelta: opts.onDelta,
    signal: opts.signal,
  }

  const plan = opts.useLlmPlanner
    ? await llmPlan(routed.action, ctx, registry, memory)
    : { steps: rulePlan(routed.action, routed.targetId), planner: 'rule' as const }

  tracer.thought('生成执行计划', plan.steps.map(s => s.tool).join(' → ') || '（无需调用工具）')

  let executed: ExecuteResult = {
    merged: { message: '' },
    toolCalls: tracer.toolCalls,
    warnings: [],
    planner: plan.planner,
  }
  let modelSummary: string | undefined
  let aborted = false
  try {
    executed = await executePlan(plan.steps, ctx, registry, plan.planner, {
      reflect: opts.reflect,
      maxRounds: opts.maxRounds,
    })

    // 收尾总结：确定性结果已经齐了，再让模型说一句人话。
    // 放在最后是因为它要看到全部产出；失败也无所谓，主结果不受影响。
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
          signal: opts.signal,
        })) ?? undefined
    }
  } catch (e) {
    // 用户取消：返回中止那一刻已产生的部分结果，不抛出
    if (isAbort(e)) {
      aborted = true
      tracer.warning('已被用户取消，返回已产生的部分结果')
    } else {
      throw e
    }
  }

  const reasoning = executed.merged.message
    ? executed.merged.message.split('\n').filter(Boolean)
    : [`已执行 ${plan.steps.length} 个工具`]

  if (executed.merged.candidates?.length) {
    tracer.final('完成', `${executed.merged.candidates.length} 个候选品`)
  }

  memory.push({ query, action: routed.action, targetId: routed.targetId })

  const output: AgentOutput = {
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
    warnings: [...executed.warnings, ...(aborted ? ['已取消'] : [])],
    reflection: executed.reflection,
    aborted: aborted || undefined,
    guardrails: guardFlags.length ? guardFlags : undefined,
    trace: tracer.steps,
    toolCalls: executed.toolCalls as ToolCallRecord[],
    usage: tracer.usage,
  }

  // 质量评估（LLM-as-judge）：模型可用时让模型按 rubric 打分，失败/不可用则回退到
  // 纯函数启发式打分——它总能在没有模型的情况下给出质量分，是增益项而非必需项。
  output.eval =
    opts.evaluate !== false
      ? await llmEvaluate(query, output, opts.candidates, { llm, tracer, signal: opts.signal })
      : evaluateOutput(output, { query, candidates: opts.candidates })

  return { output, mutations, memory }
}

