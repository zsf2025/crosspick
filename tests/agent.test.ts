import { describe, it, assert, eq } from './harness'
import { runAgent } from '@/agent/run'
import { NullProvider } from '@/agent/core/llm'
import { Tracer } from '@/agent/core/trace'
import { ConversationMemory } from '@/agent/core/memory'
import { createDefaultRegistry, ALL_TOOLS } from '@/agent/tools'
import { ToolRegistry } from '@/agent/core/registry'
import { extractJson } from '@/agent/core/llm'
import { parsePlanJson } from '@/agent/core/loop'
import { mockProducts } from '@/adapters/mock'
import { DEFAULT_RULES } from '@/domain/rules'
import type { ProductCandidate } from '@/types/product'

const llm = new NullProvider()

async function run(query: string, candidates: ProductCandidate[], memory?: ConversationMemory) {
  return runAgent({
    query,
    candidates,
    rules: DEFAULT_RULES,
    llm,
    memory: memory ?? new ConversationMemory(),
    registry: createDefaultRegistry(),
  })
}

describe('Agent · 单步意图', () => {
  it('打分：所有候选品都拿到评分', async () => {
    const { output } = await run('给所有候选品打分', mockProducts())
    eq(output.action, 'score')
    eq(output.routedBy, 'rule')
    assert(output.candidates.length > 0, '应返回候选品')
    assert(
      output.candidates.some(c => c.scores && c.scores.length === 5),
      '每个候选品应有五维评分',
    )
    assert(output.trace.length > 0, '应产生思考链')
    assert(output.toolCalls.some(t => t.tool === 'score'), '应调用 score 工具')
  })

  it('打分：点名某个品时结论里给出它的分数与排名', async () => {
    const cands = mockProducts()
    const { output } = await run('帮我看看第一个品值不值得做', cands)
    eq(output.action, 'score')
    eq(output.targetId, cands[0].id, '应回传定位到的目标 id')
    const text = output.reasoning.join(' ')
    assert(text.includes(cands[0].name), `结论应点名该商品：${text}`)
    assert(/排名第 \d+\/\d+/.test(text), `结论应给出排名：${text}`)
  })

  it('打分：未点名任何商品时不回传 targetId', async () => {
    const { output } = await run('给所有候选品打分', mockProducts())
    eq(output.targetId ?? null, null, '无目标时不应回传 id')
  })

  it('定价：定位到商品并给出价格建议', async () => {
    const { output } = await run('给台灯定价', mockProducts())
    eq(output.action, 'price')
    assert(output.pricing !== undefined, '应返回定价结果')
    eq(output.pricing!.productId, 'p1')
    assert(output.pricing!.suggestedPrice >= output.pricing!.breakEvenPrice, '建议价应保住盈亏平衡')
  })

  it('评论：模型不可用时降级为规则输出', async () => {
    const { output } = await run('分析台灯的评论痛点', mockProducts())
    eq(output.action, 'review')
    assert(output.review !== undefined, '应返回评论分析')
    assert(output.review!.degraded, '模型不可用时应标记降级')
    assert(output.review!.suggestions.length > 0, '降级也要给出建议')
    assert(output.review!.painPoints.length > 0, '应汇总痛点')
  })

  it('对比：生成对比表并给出最优项', async () => {
    const { output } = await run('对比这几个候选品', mockProducts())
    eq(output.action, 'compare')
    assert(output.comparison !== undefined, '应返回对比结果')
    assert(output.comparison!.rows.length === 5, '应覆盖全部候选品')
    assert(output.comparison!.winnerId !== null, '应选出最优项')
  })

  it('淘汰：产生变更意图', async () => {
    const { output, mutations } = await run('把台灯淘汰掉', mockProducts())
    eq(output.action, 'mutate')
    eq(mutations.length, 1)
    eq(mutations[0].productId, 'p1')
    eq(mutations[0].value, 'rejected')
  })

  it('无法理解时追问而不是硬答', async () => {
    const { output } = await run('帮我看看', mockProducts())
    eq(output.action, 'clarify')
    assert(output.warnings.length > 0, '应给出可操作的提示')
  })
})

describe('Agent · 多步编排', () => {
  it('报告会串联多个工具', async () => {
    const { output } = await run('生成选品报告', mockProducts())
    eq(output.action, 'report')
    const tools = output.toolCalls.map(t => t.tool)
    assert(tools.includes('score'), '应包含打分')
    assert(tools.includes('compare'), '应包含对比')
    assert(tools.includes('report'), '应包含成文')
    assert(tools.length >= 3, `实际调用 ${tools.length} 个工具`)
    assert(output.report && output.report.length >= 3, '报告应有多段内容')
  })

  it('后续步骤能看到前序步骤的产出', async () => {
    const { output } = await run('生成选品报告', mockProducts())
    const overview = output.report!.find(s => s.heading === '概览')
    assert(overview !== undefined, '应有概览段')
    assert(/候选品共/.test(overview!.body), '概览应基于打分后的数据统计')
  })

  it('单个工具失败不中断整轮', async () => {
    const broken = new ToolRegistry()
    broken.register({
      name: 'score',
      description: '坏掉的工具',
      run: async () => {
        throw new Error('boom')
      },
    })
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      llm,
      registry: broken,
    })
    eq(output.action, 'score')
    assert(output.warnings.some(w => w.includes('boom')), '应记录工具失败')
    assert(output.candidates.length > 0, '仍应返回原始候选品')
  })
})

describe('Agent · 多轮与指代', () => {
  it('第二轮能接住"它"', async () => {
    const memory = new ConversationMemory()
    const first = await run('给台灯定价', mockProducts(), memory)
    eq(first.output.action, 'price')

    const second = await run('给它定价', mockProducts(), memory)
    eq(second.output.action, 'price')
    assert(second.output.pricing !== undefined, '第二轮应有定价结果')
    eq(second.output.pricing!.productId, 'p1')
  })

  it('会话记忆按顺序累积', async () => {
    const memory = new ConversationMemory()
    await run('给所有候选品打分', mockProducts(), memory)
    await run('对比这几个品', mockProducts(), memory)
    eq(memory.turns.length, 2)
    eq(memory.turns[0].action, 'score')
    eq(memory.turns[1].action, 'compare')
  })
})

describe('Agent · 可观测性', () => {
  it('思考链包含思考/行动/观察三类节点', async () => {
    const { output } = await run('给所有候选品打分', mockProducts())
    const kinds = new Set(output.trace.map(t => t.kind))
    assert(kinds.has('thought'), '应有思考节点')
    assert(kinds.has('action'), '应有行动节点')
    assert(kinds.has('observation'), '应有观察节点')
  })

  it('工具调用记录耗时', async () => {
    const { output } = await run('给所有候选品打分', mockProducts())
    for (const c of output.toolCalls) {
      assert(c.durationMs >= 0, '耗时应非负')
      assert(typeof c.ok === 'boolean', '应记录成功与否')
    }
  })

  it('usage 计数存在且初始为 0', async () => {
    const { output } = await run('给所有候选品打分', mockProducts())
    assert(output.usage !== undefined, '应有 usage')
    eq(output.usage!.llmCalls, 0)
  })
})

describe('工具注册表', () => {
  it('默认注册六个工具', () => {
    const r = createDefaultRegistry()
    eq(r.list().length, 6)
    for (const name of ['score', 'price', 'review', 'compare', 'report', 'mutate']) {
      assert(r.has(name), `应注册 ${name}`)
    }
  })

  it('describe 生成可读的工具清单', () => {
    const text = createDefaultRegistry().describe()
    assert(text.includes('score'), '清单应包含工具名')
    assert(text.includes('定价'), '清单应包含中文描述')
  })

  it('调用未注册的工具返回失败而不是抛错', async () => {
    const r = createDefaultRegistry()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = {
      query: '',
      candidates: mockProducts(),
      rules: DEFAULT_RULES,
      fba: undefined as never,
      llm,
      tracer: new Tracer(),
      resolveTarget: () => null,
      mutate: () => undefined,
    }
    const res = await r.invoke('nope', {}, ctx)
    eq(res.ok, false)
  })

  it('每个工具都有描述', () => {
    for (const t of ALL_TOOLS) {
      assert(t.description.length > 0, `${t.name} 缺少描述`)
    }
  })
})

describe('结构化输出解析', () => {
  it('纯 JSON 直接解析', () => {
    eq((extractJson('{"a":1}') as { a: number }).a, 1)
  })

  it('剥离代码块后解析', () => {
    const raw = '```json\n{"a":2}\n```'
    eq((extractJson(raw) as { a: number }).a, 2)
  })

  it('从混杂文本中提取首个对象', () => {
    const raw = '我觉得可以这样：{"steps":[{"tool":"score"}]} 以上'
    const v = extractJson(raw) as { steps: Array<{ tool: string }> }
    eq(v.steps[0].tool, 'score')
  })

  it('无法解析时返回 null', () => {
    eq(extractJson('完全不是 JSON'), null)
  })

  it('计划解析会过滤掉未注册的工具', () => {
    const steps = parsePlanJson('{"steps":[{"tool":"score"},{"tool":"evil"}]}', ['score'])
    eq(steps.length, 1)
    eq(steps[0].tool, 'score')
  })
})
