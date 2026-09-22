import { describe, it, assert, eq } from './harness'
import { buildDigest, normalizeSummary, summarize } from '@/agent/summary'
import { Tracer } from '@/agent/core/trace'
import type { LLMProvider, ChatMessage, ChatOptions } from '@/agent/core/llm'
import { SUMMARY_MARK } from '@/agent/prompts'
import { runAgent } from '@/agent/run'
import { mockProducts } from '@/adapters/mock'
import { DEFAULT_RULES } from '@/domain/rules'
import { scoreCandidates } from '@/domain/scoring'
import type { ProductCandidate } from '@/types/product'

class StubProvider implements LLMProvider {
  readonly name = 'stub'
  readonly prompts: string[] = []
  healthOk = true

  constructor(private reply: string) {}

  async chat(messages: ChatMessage[], _o?: ChatOptions): Promise<string> {
    this.prompts.push(messages[messages.length - 1]?.content ?? '')
    return this.reply
  }
  async chatJson<T>(messages: ChatMessage[], _o?: ChatOptions): Promise<T | null> {
    this.prompts.push(messages[messages.length - 1]?.content ?? '')
    return null
  }
  async stream(messages: ChatMessage[], _o: ChatOptions, onDelta: (c: string) => void): Promise<string> {
    this.prompts.push(messages[messages.length - 1]?.content ?? '')
    onDelta(this.reply)
    return this.reply
  }
  async health(): Promise<boolean> {
    return this.healthOk
  }
}

const base = (over: Partial<Parameters<typeof buildDigest>[0]> = {}) =>
  ({
    query: '帮我看看第一个品值不值得做',
    action: 'score' as const,
    message: '已对 5 个候选品评分',
    candidates: scoreCandidates(mockProducts(), DEFAULT_RULES) as ProductCandidate[],
    ...over,
  }) as Parameters<typeof buildDigest>[0]

describe('收尾总结 · 摘要构建', () => {
  it('包含动作、结论与评分排名', () => {
    const d = buildDigest(base())
    assert(d.includes('执行动作：score'), '应有动作')
    assert(d.includes('评分排名'), '应有排名')
    assert(/1\. .+ \d+ 分/.test(d), '排名应带分数')
  })

  it('用户点名的商品会被单独点出，避免模型答非所问', () => {
    const cands = scoreCandidates(mockProducts(), DEFAULT_RULES) as ProductCandidate[]
    const d = buildDigest(base({ candidates: cands, targetId: cands[0].id }))
    const line = d.split('\n').find(l => l.startsWith('用户问的商品')) ?? ''
    assert(line.includes(cands[0].name), `应点名目标商品：${line}`)
    assert(d.indexOf('用户问的商品') < d.indexOf('评分排名'), '目标应排在排名之前')
  })

  it('只取前 3 名以控制 token', () => {
    const d = buildDigest(base(), 3)
    const lines = d.split('\n').find(l => l.startsWith('评分排名')) ?? ''
    eq(lines.split('；').length, 3)
  })

  it('无总分商品会被单独说明', () => {
    const d = buildDigest(base())
    assert(/因数据不足没有总分/.test(d), '应提示数据不足')
  })

  it('定价与评论结果进入摘要', () => {
    const d = buildDigest(
      base({
        pricing: {
          productId: 'p1',
          productName: '台灯',
          suggestedPrice: 29.9,
          priceRange: [24, 36],
          breakEvenPrice: 21.5,
          targetMargin: 0.25,
          currency: 'USD',
          costBreakdown: { purchase: 10, inbound: 2, fbaFee: 6, referralRate: 0.15 },
          points: [],
        },
        review: {
          productId: 'p1',
          productName: '台灯',
          painPoints: [{ text: '亮度不足', mentions: 5 }],
          positives: [],
          suggestions: [],
          degraded: true,
        },
      }),
    )
    assert(d.includes('建议售价 $29.9'), '应含建议售价')
    assert(d.includes('亮度不足'), '应含痛点')
  })
})

describe('收尾总结 · 文本收敛', () => {
  it('去首尾引号与换行', () => {
    eq(normalizeSummary('  "建议做，但要控价"  '), '建议做，但要控价')
    eq(normalizeSummary('第一行\n第二行'), '第一行 第二行')
  })

  it('剥离代码块', () => {
    eq(normalizeSummary('```text\n值得做\n```'), '值得做')
  })

  it('空输出返回 null', () => {
    eq(normalizeSummary(''), null)
    eq(normalizeSummary(null), null)
    eq(normalizeSummary('   '), null)
  })

  it('超长时在句子边界截断', () => {
    const long = '可以推进。' + '补一句说明。'.repeat(30)
    const s = normalizeSummary(long, 40)!
    assert(s.length <= 42, `应被截断，实际 ${s.length}`)
    assert(s.endsWith('。') || s.endsWith('…'), '应在句子边界或省略号收尾')
  })
})

describe('收尾总结 · 调用与降级', () => {
  it('模型可用时返回一句话', async () => {
    const llm = new StubProvider('值得做，但先把价格压到 25 以下。')
    const tracer = new Tracer()
    const s = await summarize('q', 'digest', { llm, tracer })
    eq(s, '值得做，但先把价格压到 25 以下。')
    assert(llm.prompts[0].includes(SUMMARY_MARK), '应发送总结提示词')
    assert(tracer.steps.some(t => t.detail === s), '应写入思考链')
  })

  it('模型不可用时安静跳过', async () => {
    const llm = new StubProvider('x')
    llm.healthOk = false
    const tracer = new Tracer()
    eq(await summarize('q', 'digest', { llm, tracer }), null)
    eq(llm.prompts.length, 0, '不应发出请求')
    assert(tracer.steps.some(t => (t.label ?? '').includes('跳过')), '应记录跳过原因')
  })

  it('模型输出为空时不产生空总结', async () => {
    const llm = new StubProvider('```\n\n```')
    const tracer = new Tracer()
    eq(await summarize('q', 'digest', { llm, tracer }), null)
    assert(tracer.steps.some(t => t.kind === 'warning'), '应记录警告')
  })

  it('流式回调会被逐段调用', async () => {
    const llm = new StubProvider('值得做')
    const got: string[] = []
    const s = await summarize('q', 'digest', {
      llm,
      tracer: new Tracer(),
      onDelta: c => got.push(c),
    })
    eq(s, '值得做')
    eq(got.join(''), '值得做')
  })
})

describe('收尾总结 · 接入执行链路', () => {
  it('默认开启：输出里带模型总结', async () => {
    const llm = new StubProvider('值得做，优先做硅胶烤盘。')
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      rules: DEFAULT_RULES,
      llm,
    })
    eq(output.action, 'score')
    eq(output.summary, '值得做，优先做硅胶烤盘。')
    assert(output.reasoning.length > 0, '确定性结论仍然保留')
  })

  it('显式关闭时不产生总结也不请求模型', async () => {
    const llm = new StubProvider('x')
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      rules: DEFAULT_RULES,
      llm,
      summarize: false,
    })
    eq(output.summary, undefined)
    eq(llm.prompts.filter(p => p.includes(SUMMARY_MARK)).length, 0, '关闭时不应发总结请求')
  })

  it('模型不可用时主结果不受影响', async () => {
    const llm = new StubProvider('x')
    llm.healthOk = false
    const { output } = await runAgent({
      query: '给所有候选品打分',
      candidates: mockProducts(),
      rules: DEFAULT_RULES,
      llm,
    })
    eq(output.summary, undefined)
    assert(output.candidates.every(c => c.scores.length === 5), '评分照常完成')
  })

  it('追问意图不做总结', async () => {
    const llm = new StubProvider('x')
    const { output } = await runAgent({
      query: '嗯',
      candidates: mockProducts(),
      rules: DEFAULT_RULES,
      llm,
    })
    eq(output.action, 'clarify')
    eq(output.summary, undefined)
    eq(llm.prompts.filter(p => p.includes(SUMMARY_MARK)).length, 0, '没有结果可总结时不应发总结请求')
  })
})
