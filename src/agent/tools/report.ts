import type { Tool } from '../core/tool'
import type { ProductCandidate } from '@/types/product'
import type { ReportSection } from '@/types/agent'
import { scoreCandidates, missingDimensions } from '@/domain/scoring'
import { suggestPricing } from '@/domain/pricing'
import { DIMENSION_LABELS } from '@/types/product'
import { REPORT_PROMPT } from '../prompts'

function overview(candidates: ProductCandidate[]): string {
  const scored = candidates.filter(c => c.totalScore !== null)
  const avg = scored.length
    ? Math.round(scored.reduce((s, c) => s + (c.totalScore ?? 0), 0) / scored.length)
    : null
  return [
    `候选品共 ${candidates.length} 个，其中 ${scored.length} 个可给出综合评分。`,
    avg === null ? '当前数据不足以计算平均分。' : `平均综合得分 ${avg}。`,
  ].join('')
}

function ranking(candidates: ProductCandidate[]): string {
  const ranked = candidates
    .filter(c => c.totalScore !== null)
    .sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
  if (!ranked.length) return '暂无可排名的商品（数据不足）。'
  return ranked
    .slice(0, 3)
    .map((c, i) => `${i + 1}. ${c.name} — ${c.totalScore} 分`)
    .join('\n')
}

function risks(candidates: ProductCandidate[]): string {
  const lines: string[] = []
  for (const c of candidates) {
    const missing = missingDimensions(c)
    if (missing.length) {
      lines.push(`${c.name}：缺少 ${missing.map(d => DIMENSION_LABELS[d]).join('、')} 数据`)
    }
  }
  const fierce = candidates
    .filter(c => c.competitors.length >= 4)
    .map(c => c.name)
  if (fierce.length) lines.push(`竞争较激烈（竞品数 ≥ 4）：${fierce.join('、')}`)
  return lines.length ? lines.join('\n') : '未发现明显风险项。'
}

export const reportTool: Tool = {
  name: 'report',
  description: '汇总评分、对比与评论分析结果，生成一份选品报告',
  args: { targetId: '可选，重点分析的商品 id' },
  async run(args, ctx) {
    const base = ctx.candidates.every(c => !c.scores)
      ? scoreCandidates(ctx.candidates, ctx.rules)
      : ctx.candidates

    const id = typeof args.targetId === 'string' ? args.targetId : null
    const focus =
      (id ? base.find(c => c.id === id) : null) ??
      base.filter(c => c.totalScore !== null).sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))[0] ??
      base[0] ??

      null

    const sections: ReportSection[] = [
      { heading: '概览', body: overview(base) },
      { heading: '评分排名', body: ranking(base) },
      { heading: '风险与数据缺口', body: risks(base) },
    ]

    if (focus) {
      const pricing = suggestPricing(focus, ctx.fba)
      sections.push({
        heading: `重点商品：${focus.name}`,
        body: [
          `综合得分：${focus.totalScore ?? '数据不足'}`,
          `建议售价 $${pricing.suggestedPrice}，盈亏平衡 $${pricing.breakEvenPrice}（含 ${(pricing.costBreakdown.referralRate * 100).toFixed(0)}% 平台佣金与 FBA 履约费 $${pricing.costBreakdown.fbaFee}）`,
        ].join('\n'),
      })

      const notes = [
        `类目：${focus.category}`,
        `采购成本 $${focus.cost}，重量 ${focus.weightKg}kg`,
        `竞品 ${focus.competitors.length} 个，均价 $${pricing.priceRange[0]}–$${pricing.priceRange[1]}`,
      ]
      let conclusion = '数据不足，建议补齐竞品与评论数据后再决策。'
      const score = focus.totalScore ?? null
      if (score !== null) {
        conclusion = `综合得分 ${score}，${score >= 70 ? '建议推进' : score >= 50 ? '可作为备选，需进一步验证' : '建议放弃'}。`
        if (await ctx.llm.health()) {
          try {
            const text = await ctx.llm.chat(
              [{ role: 'user', content: REPORT_PROMPT(focus.name, score, notes) }],
              { temperature: 0.3 },
            )
            if (text && text.trim()) {
              conclusion = text.trim()
              ctx.tracer.observation('报告结论由模型生成')
            }
          } catch {
            ctx.tracer.warning('报告结论降级为模板输出')
          }
        }
      }
      sections.push({ heading: '结论与建议', body: conclusion })
    }

    return { message: `已生成 ${sections.length} 段报告`, candidates: base, report: sections }
  },
}
