import type { ProductCandidate } from '@/types/product'
import type { PricingSuggestion } from '@/types/agent'
import { avgPrice } from './scoring'
import {
  DEFAULT_FBA_CONFIG,
  breakEvenPrice,
  inboundCost,
  fbaFulfillmentFee,
  priceForMargin,
  unitProfit,
} from './fba'
import type { FbaConfig } from './fba'

const round2 = (n: number) => Math.round(n * 100) / 100

/** 需求曲线近似：价格越低销量越高，线性插值，区间外做截断 */
export function estimateSales(price: number, min: number, max: number): number {
  if (!(max > min)) return 1000
  const ratio = Math.max(0, Math.min(1, 1 - (price - min) / (max - min)))
  return Math.round(500 + ratio * 2000)
}

export function suggestPricing(
  c: ProductCandidate,
  cfg: FbaConfig = DEFAULT_FBA_CONFIG,
): PricingSuggestion {
  const prices = c.competitors.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b)
  const min = prices[0] ?? 0
  const max = prices[prices.length - 1] ?? 0
  const marketAvg = avgPrice(c)

  const be = breakEvenPrice(c.cost, c.weightKg, cfg)
  const floor = priceForMargin(c.cost, c.weightKg, cfg.targetMargin, cfg)

  // 建议价：贴近市场均价略低，但不低于目标毛利地板价
  let suggested = marketAvg > 0 ? marketAvg * 0.95 : floor
  if (suggested < floor) suggested = floor
  if (suggested < be) suggested = be

  // 价格扫描区间：覆盖竞品价格带并向两端各扩 15%
  const lo = min > 0 ? min * 0.85 : Math.max(be * 0.8, 1)
  const hi = max > 0 ? max * 1.15 : Math.max(be * 1.5, lo + 1)
  const steps = 12
  const bandMin = Math.min(lo, be * 0.9)
  const bandMax = Math.max(hi, floor * 1.2)
  const points: Array<{ price: number; sales: number; profit: number }> = []
  for (let i = 0; i <= steps; i++) {
    const p = round2(bandMin + ((bandMax - bandMin) * i) / steps)
    const sales = estimateSales(p, bandMin, bandMax)
    points.push({ price: p, sales, profit: round2(unitProfit(p, c.cost, c.weightKg, cfg) * sales) })
  }

  return {
    productId: c.id,
    productName: c.name,
    suggestedPrice: round2(suggested),
    priceRange: [round2(min), round2(max)],
    breakEvenPrice: round2(be),
    targetMargin: cfg.targetMargin,
    currency: 'USD',
    costBreakdown: {
      purchase: round2(c.cost),
      inbound: round2(inboundCost(c.weightKg, cfg)),
      fbaFee: round2(fbaFulfillmentFee(c.weightKg, cfg)),
      referralRate: cfg.referralRate,
    },
    points,
  }
}

/** 找利润最大化的价格点，用于和"跟均价"策略做对比 */
export function bestProfitPoint(p: PricingSuggestion) {
  if (!p.points.length) return null
  return p.points.reduce((best, cur) => (cur.profit > best.profit ? cur : best))
}
