import { describe, it, assert, eq } from './harness'
import type { ChatMessage, ChatOptions, LLMProvider, ToolCallDef, ToolCallResult } from '@/agent/core/llm'
import { NullProvider } from '@/agent/core/llm'
import { Tracer } from '@/agent/core/trace'
import { defaultContext } from '@/agent/core/tool'
import { createRegistry } from '@/agent/core/registry'
import { isAbort } from '@/agent/core/errors'
import { executePlan } from '@/agent/core/loop'
import { runAgent } from '@/agent/run'
import { mockProducts } from '@/adapters/mock'

/** 记录每次调用收到的 options（含 signal），用于验证信号透传 */
class RecProvider implements LLMProvider {
  readonly name = 'rec'
  calls: ChatOptions[] = []
  health() {
    return Promise.resolve(true)
  }
  async chat(_m: ChatMessage[], o?: ChatOptions) {
    this.calls.push(o ?? {})
    return 'score'
  }
  async chatJson<T>(_m: ChatMessage[], o?: ChatOptions) {
    this.calls.push(o ?? {})
    return { steps: [{ tool: 'score' }] } as T
  }
  async chatTools(_m: ChatMessage[], _t: ToolCallDef[], o?: ChatOptions) {
    this.calls.push(o ?? {})
    return { tool: { name: 'run_plan', args: { steps: ['score'] } } } as ToolCallResult
  }
  async stream(_m: ChatMessage[], o: ChatOptions, _cb: (c: string) => void) {
    this.calls.push(o)
    return ''
  }
}

describe('Agent 中断/取消', () => {
  it('signal 透传到规划阶段的模型调用', async () => {
    const provider = new RecProvider()
    const signal = new AbortController().signal
    await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts().slice(0, 1),
      llm: provider,
      useLlmPlanner: true,
      summarize: false,
      signal,
    })
    const withSignal = provider.calls.filter(c => c.signal === signal)
    assert(withSignal.length > 0, `规划/总结阶段应把 signal 透传给模型调用，实际收到 ${provider.calls.length} 次调用`)
  })

  it('运行中已取消时返回部分结果且 output.aborted=true', async () => {
    const ac = new AbortController()
    ac.abort() // 一开始就处于取消态
    const out = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts().slice(0, 1),
      llm: new NullProvider(),
      signal: ac.signal,
    })
    eq(out.output.aborted, true)
    assert(out.output.candidates.length > 0, '取消后也应返回已载入的候选品')
    assert(out.output.warnings.some(w => w.includes('取消')), '取消应带提示')
  })

  it('executePlan 在每步前检查 signal，取消后不再执行后续工具', async () => {
    const ac = new AbortController()
    let secondCalled = false
    const reg = createRegistry([
      {
        name: 'first',
        description: '中止自身',
        run: () => {
          ac.abort()
          return { message: 'first' }
        },
      },
      {
        name: 'second',
        description: '不应被调用',
        run: () => {
          secondCalled = true
          return { message: 'second' }
        },
      },
    ])
    const tracer = new Tracer()
    const ctx = defaultContext({
      candidates: [],
      llm: new NullProvider(),
      tracer,
      resolveTarget: () => null,
      mutate: () => {},
    })
    ctx.signal = ac.signal

    let threw = false
    try {
      await executePlan(
        [{ tool: 'first' }, { tool: 'second' }],
        ctx,
        reg,
        'rule',
      )
    } catch (e) {
      threw = isAbort(e)
    }
    assert(threw, '取消信号应让 executePlan 抛出可识别的中止错误')
    eq(secondCalled, false, '后续工具不应在取消后执行')
  })
})
