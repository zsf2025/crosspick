import { describe, it, assert, eq } from './harness'
import { evaluateOutput, llmEvaluate } from '@/agent/eval'
import { runAgent } from '@/agent/run'
import { NullProvider } from '@/agent/core/llm'
import type { ChatMessage, ChatOptions, LLMProvider, ToolCallResult } from '@/agent/core/llm'
import { Tracer } from '@/agent/core/trace'
import { createDefaultRegistry } from '@/agent/tools'
import { mockProducts } from '@/adapters/mock'
import type { AgentOutput } from '@/types/agent'

/** 构造最小可用的 AgentOutput，其余字段给合理默认值 */
function makeOutput(partial: Partial<AgentOutput> = {}): AgentOutput {
  return {
    id: 't',
    createdAt: '',
    query: '',
    action: 'score',
    routedBy: 'rule',
    reasoning: [],
    candidates: mockProducts(),
    warnings: [],
    trace: [],
    toolCalls: [],
    usage: { llmCalls: 0, promptChars: 0, completionChars: 0 },
    ...partial,
  }
}

/** 脚本化评估模型：返回预设的 rubric JSON，可模拟不可用/异常 */
class FakeEvalProvider implements LLMProvider {
  readonly name = 'fake'
  private json: unknown | null
  private healthy: boolean
  private throwing: boolean
  constructor(json: unknown | null, healthy = true, throwing = false) {
    this.json = json
    this.healthy = healthy
    this.throwing = throwing
  }
  async chat(): Promise<string> {
    return ''
  }
  async chatJson<T>(): Promise<T | null> {
    if (this.throwing) throw new Error('boom')
    return this.json as T | null
  }
  async chatTools(): Promise<ToolCallResult> {
    return { text: '' }
  }
  async stream(): Promise<string> {
    return ''
  }
  async health(): Promise<boolean> {
    return this.healthy
  }
}

describe('质量评估 · 启发式不变量', () => {
  it('总分落在 0-100 且等级映射正确', () => {
    const good = evaluateOutput(
      makeOutput({ query: '给所有候选品打分', summary: '结论', toolCalls: [{ tool: 'score', ok: true, durationMs: 1 }] }),
      { query: '给所有候选品打分', candidates: mockProducts() },
    )
    assert(good.total >= 0 && good.total <= 100, `总分应 0-100，实际 ${good.total}`)
    eq(good.grade, good.total >= 85 ? 'A' : good.total >= 70 ? 'B' : good.total >= 55 ? 'C' : 'D')

    const bad = evaluateOutput(
      makeOutput({ query: '给台灯定价', action: 'score', toolCalls: [], aborted: true, reasoning: ['x'] }),
      { query: '给台灯定价', candidates: mockProducts() },
    )
    assert(bad.total >= 0 && bad.total <= 100, '低质样例总分也应 0-100')
  })

  it('rubric 权重和为 1', () => {
    const ev = evaluateOutput(makeOutput({}), { query: '', candidates: mockProducts() })
    const sum = ev.dimensions.reduce((s, d) => s + d.weight, 0)
    assert(Math.abs(sum - 1) < 1e-9, `权重和应为 1，实际 ${sum}`)
  })

  it('高质量样例得 A/B', () => {
    const ev = evaluateOutput(
      makeOutput({
        query: '给所有候选品打分',
        summary: '推荐做',
        toolCalls: [{ tool: 'score', ok: true, durationMs: 1 }],
      }),
      { query: '给所有候选品打分', candidates: mockProducts() },
    )
    assert(ev.total >= 85, `高质量样例应≥85，实际 ${ev.total}`)
    eq(ev.grade, 'A')
  })

  it('意图不符 + 未调工具 + 取消 得低分', () => {
    const ev = evaluateOutput(
      makeOutput({ query: '给台灯定价', action: 'score', toolCalls: [], aborted: true, reasoning: ['x'] }),
      { query: '给台灯定价', candidates: mockProducts() },
    )
    assert(ev.total < 55, `低质样例应<55，实际 ${ev.total}`)
    eq(ev.grade, 'D')
  })

  it('点名商品未被处理时目标维度扣分并给出建议', () => {
    const out = makeOutput({ query: '帮我看看第一个品', targetId: 'p1', action: 'score' })
    const ev = evaluateOutput(out, { query: '帮我看看第一个品', candidates: mockProducts() })
    const target = ev.dimensions.find(d => d.key === 'target')!
    assert(target.score < 100, '目标商品未被处理应扣分')
    assert(ev.notes.some(n => n.includes('目标')), '应给出目标定位相关建议')
  })
})

describe('质量评估 · 模型打分（LLM-as-judge）', () => {
  it('模型按 rubric 打分收敛为总分', async () => {
    const llm = new FakeEvalProvider({
      dimensions: { relevance: 90, target: 80, tooling: 70, groundedness: 85, completeness: 60 },
      notes: ['建议一'],
    })
    const out = makeOutput({ query: '给所有候选品打分' })
    const ev = await llmEvaluate('给所有候选品打分', out, mockProducts(), { llm, tracer: new Tracer() })
    eq(ev.method, 'llm')
    eq(ev.dimensions.length, 5)
    eq(ev.total, Math.round(90 * 0.3 + 80 * 0.2 + 70 * 0.2 + 85 * 0.15 + 60 * 0.15))
    assert(ev.notes.length > 0, '应有改进建议')
  })

  it('模型不可用时回退启发式', async () => {
    const llm = new FakeEvalProvider({ dimensions: { relevance: 90 } }, false)
    const ev = await llmEvaluate('给所有候选品打分', makeOutput({}), mockProducts(), { llm })
    eq(ev.method, 'heuristic')
  })

  it('模型返回非 rubric 结构时回退启发式', async () => {
    const llm = new FakeEvalProvider(null)
    const ev = await llmEvaluate('给所有候选品打分', makeOutput({}), mockProducts(), { llm })
    eq(ev.method, 'heuristic')
  })

  it('模型抛错时回退启发式', async () => {
    const llm = new FakeEvalProvider(null, true, true)
    const ev = await llmEvaluate('给所有候选品打分', makeOutput({}), mockProducts(), { llm })
    eq(ev.method, 'heuristic')
  })
})

describe('质量评估 · 接入 runAgent', () => {
  it('无模型时挂启发式质量分且不影响主结果', async () => {
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      llm: new NullProvider(),
      registry: createDefaultRegistry(),
    })
    assert(output.eval !== undefined, '应输出质量评估')
    eq(output.eval!.method, 'heuristic')
    assert(output.candidates.length > 0, '主结果仍正常')
  })
})
