import type { Tool } from '../core/tool'
import { suggestPricing, bestProfitPoint } from '@/domain/pricing'
import type { PricingSuggestion } from '@/types/agent'

export const priceTool: Tool = {
  name: 'price',
  description: '对指定商品做定价与利润测算，输出建议售价、盈亏平衡价和利润曲线',
  args: { targetId: '可选，商品 id；不传则按用户问题定位' },
  async run(args, ctx) {
    const id = typeof args.targetId === 'string' ? args.targetId : null
    const target =
      (id ? ctx.candidates.find(c => c.id === id) : null) ??
      ctx.resolveTarget(ctx.query) ??
      ctx.candidates[0] ??
      null

    if (!target) {
      return { message: '', warnings: ['未找到要定价的商品，请明确商品名称'] }
    }
    const pricing: PricingSuggestion = suggestPricing(target, ctx.fba)
    const best = bestProfitPoint(pricing)
    const parts = [
      `建议售价 $${pricing.suggestedPrice}`,
      `盈亏平衡 $${pricing.breakEvenPrice}`,
    ]
    if (best) parts.push(`利润峰值出现在 $${best.price}`)
    return { message: `${target.name}：${parts.join('，')}`, pricing }
  },
}
