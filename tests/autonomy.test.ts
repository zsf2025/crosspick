import { describe, it, assert, eq } from './harness'
import { runAgent } from '@/agent/run'
import { NullProvider, extractJson } from '@/agent/core/llm'
import type { ChatMessage, LLMProvider } from '@/agent/core/llm'
import { parseReflection } from '@/agent/core/loop'
import { REFLECT_MARK } from '@/agent/prompts'
import { ConversationMemory } from '@/agent/core/memory'
import { createDefaultRegistry } from '@/agent/tools'
import { mockProducts } from '@/adapters/mock'
import { DEFAULT_RULES } from '@/domain/rules'

/**
 * 脚本化模型：按预设顺序返回文本，用完返回"已完成"。
 * 这样自主循环的每一轮行为都是确定的，测试才有意义。
 */
class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted'
  readonly prompts: string[] = []
  /** 只统计反思请求，避免被目标定位等其它调用干扰 */
  get reflectCalls(): number {
    return this.prompts.filter(p => p.includes(REFLECT_MARK)).length
  }

  constructor(
    private replies: string[],
    private healthy = true,
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const content = messages[messages.length - 1]?.content ?? ''
    this.prompts.push(content)
    // 非反思请求（如让模型挑目标商品）不消耗脚本，返回空即可
    if (!content.includes(REFLECT_MARK)) return ''
    return this.replies.shift() ?? '{"done":true}'
  }

  async chatJson<T>(messages: ChatMessage[]): Promise<T | null> {
    return extractJson(await this.chat(messages)) as T | null
  }

  async stream(): Promise<string> {
    return ''
  }

  async health(): Promise<boolean> {
    return this.healthy
  }
}

function runWith(query: string, llm: LLMProvider, reflect: boolean, maxRounds?: number) {
  return runAgent({
    query,
    candidates: mockProducts(),
    rules: DEFAULT_RULES,
    llm,
    memory: new ConversationMemory(),
    registry: createDefaultRegistry(),
    reflect,
    maxRounds,
  })
}

const CONTINUE = (tool: string) => `{"done":false,"next":[{"tool":"${tool}"}]}`

describe('自主能力 · 关闭时行为不变', () => {
  it('默认不反思，不产生额外工具调用', async () => {
    const llm = new ScriptedProvider([CONTINUE('compare')])
    const { output } = await runWith('给所有候选品打分', llm, false)
    eq(output.reflection, undefined)
    eq(output.toolCalls.map(t => t.tool).join(','), 'score')
    eq(llm.reflectCalls, 0, '关闭时不应向模型发反思请求')
  })

  it('模型不可用时直接跳过反思', async () => {
    const llm = new ScriptedProvider([CONTINUE('compare')], false)
    const { output } = await runWith('给所有候选品打分', llm, true)
    eq(output.reflection!.rounds, 0)
    eq(output.toolCalls.map(t => t.tool).join(','), 'score')
  })
})

describe('自主能力 · 观察与反思', () => {
  it('模型判定已答足则不再补调', async () => {
    const llm = new ScriptedProvider(['{"done":true}'])
    const { output } = await runWith('给所有候选品打分', llm, true)
    eq(output.reflection!.rounds, 0)
    eq(output.reflection!.addedTools.length, 0)
    eq(output.toolCalls.map(t => t.tool).join(','), 'score')
  })

  it('模型判定不足则补调工具并合并结果', async () => {
    const llm = new ScriptedProvider([CONTINUE('compare'), '{"done":true}'])
    const { output } = await runWith('给所有候选品打分', llm, true)
    const tools = output.toolCalls.map(t => t.tool)
    assert(tools.includes('score'), '应保留原计划')
    assert(tools.includes('compare'), '应补调 compare')
    eq(output.reflection!.rounds, 1)
    eq(output.reflection!.addedTools.join(','), 'compare')
    assert(output.comparison !== undefined, '补调的结果应合并进输出')
  })

  it('已经执行过的工具不会被重复调用', async () => {
    const llm = new ScriptedProvider([CONTINUE('score')])
    const { output } = await runWith('给所有候选品打分', llm, true)
    eq(output.reflection!.addedTools.length, 0)
    eq(output.toolCalls.filter(t => t.tool === 'score').length, 1)
  })

  it('有副作用的 mutate 不会在反思阶段被补调', async () => {
    const llm = new ScriptedProvider([CONTINUE('mutate')])
    const { output } = await runWith('给所有候选品打分', llm, true)
    eq(output.reflection!.addedTools.length, 0)
    assert(!output.toolCalls.some(t => t.tool === 'mutate'), 'mutate 绝不能自动补调')
  })

  it('轮次达到上限后停止', async () => {
    const llm = new ScriptedProvider([
      CONTINUE('compare'),
      CONTINUE('review'),
      CONTINUE('price'),
    ])
    const { output } = await runWith('给所有候选品打分', llm, true, 2)
    eq(output.reflection!.rounds, 2)
    eq(output.reflection!.addedTools.join(','), 'compare,review')
    assert(!output.toolCalls.some(t => t.tool === 'price'), '超出轮次的工具不应执行')
  })

  it('补调无新产出时提前收手', async () => {
    // 注册一个"什么都不产出"的工具，模拟模型补调了一个没用的步骤
    const registry = createDefaultRegistry()
    registry.register({
      name: 'noop',
      description: '测试用的空工具',
      run: async () => ({ message: '' }),
    })
    const llm = new ScriptedProvider([CONTINUE('noop'), CONTINUE('compare')])
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      rules: DEFAULT_RULES,
      llm,
      memory: new ConversationMemory(),
      registry,
      reflect: true,
      maxRounds: 3,
    })
    // 拿不到新结果就应立刻收手，而不是继续问模型直到轮次耗尽
    eq(llm.reflectCalls, 1, '只应反思一次')
    eq(output.reflection!.rounds, 1)
    assert(!output.toolCalls.some(t => t.tool === 'compare'), '不应继续补调')
  })

  it('反思过程写入思考链', async () => {
    const llm = new ScriptedProvider([CONTINUE('compare'), '{"done":true}'])
    const { output } = await runWith('给所有候选品打分', llm, true)
    assert(
      output.trace.some(s => s.label.includes('反思第 1 轮')),
      '思考链应能看到反思轮次',
    )
  })
})

describe('自主能力 · 解析兜底', () => {
  it('空输出视为已完成', () => {
    eq(parseReflection(null, ['score'], []).done, true)
  })

  it('非 JSON 输出视为已完成', () => {
    eq(parseReflection('我也不知道', ['score'], []).done, true)
  })

  it('done=true 时不产出后续步骤', () => {
    const d = parseReflection('{"done":true,"next":[{"tool":"score"}]}', ['score'], [])
    eq(d.done, true)
    eq(d.next.length, 0)
  })

  it('过滤不在白名单里的工具', () => {
    const d = parseReflection('{"done":false,"next":[{"tool":"evil"}]}', ['score'], [])
    eq(d.done, true)
  })

  it('过滤已执行过的工具', () => {
    const d = parseReflection('{"done":false,"next":[{"tool":"score"}]}', ['score'], ['score'])
    eq(d.done, true)
  })

  it('单轮补调数量受限', () => {
    const raw = '{"done":false,"next":[{"tool":"a"},{"tool":"b"},{"tool":"c"}]}'
    eq(parseReflection(raw, ['a', 'b', 'c'], [], 2).next.length, 2)
  })

  it('同一轮内不重复同一工具', () => {
    const raw = '{"done":false,"next":[{"tool":"a"},{"tool":"a"}]}'
    eq(parseReflection(raw, ['a'], []).next.length, 1)
  })
})

describe('自主能力 · 与降级路径共存', () => {
  it('NullProvider 下开启反思也不报错', async () => {
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      llm: new NullProvider(),
      registry: createDefaultRegistry(),
      reflect: true,
    })
    eq(output.action, 'score')
    eq(output.reflection!.rounds, 0)
  })
})
