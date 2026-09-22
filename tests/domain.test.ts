import { describe, it, assert, eq, near } from './harness'
import { mockProducts } from '@/adapters/mock'
import {
  scoreCandidates,
  scoreCandidate,
  aggregateScore,
  totalReviews,
  grossMargin,
  avgPrice,
} from '@/domain/scoring'
import { DEFAULT_RULES, CONSERVATIVE_RULES, matchTier, cloneRules, normalizeWeights } from '@/domain/rules'
import {
  breakEvenPrice,
  unitProfit,
  priceForMargin,
  fbaFulfillmentFee,
  DEFAULT_FBA_CONFIG,
} from '@/domain/fba'
import { suggestPricing, estimateSales, bestProfitPoint } from '@/domain/pricing'

const products = mockProducts()
const p1 = products.find(p => p.id === 'p1')!
const empty = products.find(p => p.id === 'p5')!

describe('评分 · 基础指标', () => {
  it('竞品评论总数求和正确', () => {
    eq(totalReviews(p1), 42500)
  })

  it('竞品均价正确', () => {
    near(avgPrice(p1), (25.99 + 32.99 + 19.99) / 3, 1e-9)
  })

  it('毛利率按 (均价-成本)/均价 计算', () => {
    const m = grossMargin(p1)
    assert(m !== null, '不应为空')
    near(m!, ((25.99 + 32.99 + 19.99) / 3 - 8.5) / ((25.99 + 32.99 + 19.99) / 3), 1e-9)
  })

  it('缺成本或均价时毛利率为 null', () => {
    eq(grossMargin(empty), null)
  })
})

describe('评分 · 五维', () => {
  it('市场容量按评论总数取档', () => {
    const rows = scoreCandidate(p1, DEFAULT_RULES)
    eq(rows.find(r => r.dimension === 'market')!.score, 75)
  })

  it('竞争强度随竞品数与评分下降', () => {
    const rows = scoreCandidate(p1, DEFAULT_RULES)
    // 100 - 3*10 - (4.3-3)*20 = 44
    eq(rows.find(r => r.dimension === 'competition')!.score, 44)
  })

  it('差异化按负面痛点数累加', () => {
    const rows = scoreCandidate(p1, DEFAULT_RULES)
    // 20 + 2*25 = 70
    eq(rows.find(r => r.dimension === 'differentiation')!.score, 70)
  })

  it('利润空间按毛利率取档', () => {
    const rows = scoreCandidate(p1, DEFAULT_RULES)
    // 毛利率 ≈ 0.677，落在 0.5 档
    eq(rows.find(r => r.dimension === 'margin')!.score, 80)
  })

  it('趋势命中趋势词加分', () => {
    const rows = scoreCandidate(p1, DEFAULT_RULES)
    // 命中 wireless，50 + 15 = 65
    eq(rows.find(r => r.dimension === 'trend')!.score, 65)
  })

  it('空数据商品的所有维度都不可用', () => {
    const rows = scoreCandidate(empty, DEFAULT_RULES)
    eq(rows.length, 5)
    assert(rows.every(r => !r.available), '五个维度都应标记为不可用')
    assert(rows.every(r => r.reason.length > 0), '每个维度都要给出缺失原因')
  })

  it('全缺数据时总分为 null 而不是 0', () => {
    eq(aggregateScore(scoreCandidate(empty, DEFAULT_RULES), DEFAULT_RULES), null)
  })

  it('部分缺失时按可用维度加权归一化', () => {
    const rows = scoreCandidate(p1, DEFAULT_RULES).map(r =>
      r.dimension === 'trend' ? { ...r, available: false, score: 0 } : r,
    )
    // 权重和 1+1+1+1.5 = 4.5，(75+44+70+120)/4.5 = 68.67 → 69
    eq(aggregateScore(rows, DEFAULT_RULES), 69)
  })

  it('默认规则下 p1 总分为 68', () => {
    const scored = scoreCandidates([p1], DEFAULT_RULES)
    eq(scored[0].totalScore, 68)
  })

  it('不同预设会得到不同排序权重', () => {
    const a = scoreCandidate(p1, DEFAULT_RULES)
    const b = scoreCandidate(p1, CONSERVATIVE_RULES)
    eq(
      aggregateScore(a, DEFAULT_RULES),
      68,
      '默认策略',
    )
    // 保守策略提高利润权重：(75*0.5+44*1.5+70*1+80*2+65*0.5)/5.5
    eq(aggregateScore(b, CONSERVATIVE_RULES), 67)
  })
})

describe('评分 · 排序与纯度', () => {
  it('有分的排在无分的前面', () => {
    const scored = scoreCandidates(products, DEFAULT_RULES)
    const firstNull = scored.findIndex(c => c.totalScore === null)
    const lastScored = scored.map(c => c.totalScore !== null).lastIndexOf(true)
    assert(firstNull === -1 || lastScored < firstNull, '无分的应排在最后')
  })

  it('不修改入参数组', () => {
    const input = mockProducts()
    const snapshot = input.map(c => c.totalScore)
    scoreCandidates(input, DEFAULT_RULES)
    eq(input.map(c => c.totalScore).join(','), snapshot.join(','))
  })
})

describe('规则配置', () => {
  it('档位按降序匹配', () => {
    eq(matchTier(DEFAULT_RULES.market.tiers, 60000), 90)
    eq(matchTier(DEFAULT_RULES.market.tiers, 6000), 60)
    eq(matchTier(DEFAULT_RULES.market.tiers, 0), null)
  })

  it('克隆出的规则是深拷贝', () => {
    const copy = cloneRules(DEFAULT_RULES)
    copy.trend.keywords.push('xx')
    assert(
      !DEFAULT_RULES.trend.keywords.includes('xx'),
      '修改副本不应影响原规则',
    )
  })

  it('权重全为 0 时退化为等权', () => {
    const w = normalizeWeights({ market: 0, competition: 0, differentiation: 0, margin: 0, trend: 0 })
    eq(w.market, 1)
    eq(w.trend, 1)
  })
})

describe('FBA 费用模型', () => {
  it('履约费按重量分档', () => {
    eq(fbaFulfillmentFee(0.2), 3.22)
    eq(fbaFulfillmentFee(0.6), 5.35)
    eq(fbaFulfillmentFee(1.5), 6.94)
    eq(fbaFulfillmentFee(3), 10.53)
  })

  it('盈亏平衡价求解含佣金方程', () => {
    const fixed = 8.5 + 0.6 * DEFAULT_FBA_CONFIG.inboundPerKg + 5.35
    near(breakEvenPrice(8.5, 0.6), fixed / 0.85, 1e-9)
  })

  it('在盈亏平衡价上利润为 0', () => {
    const be = breakEvenPrice(8.5, 0.6)
    near(unitProfit(be, 8.5, 0.6), 0, 1e-9)
  })

  it('高于平衡价才有正利润', () => {
    assert(unitProfit(30, 8.5, 0.6) > 0, '应有正利润')
    assert(unitProfit(10, 8.5, 0.6) < 0, '应亏损')
  })

  it('目标毛利价保证利润率达标', () => {
    const p = priceForMargin(8.5, 0.6, 0.4)
    const revenue = p * (1 - DEFAULT_FBA_CONFIG.referralRate)
    const profit = unitProfit(p, 8.5, 0.6)
    near(profit / revenue, 0.4, 1e-9)
  })
})

describe('定价模拟', () => {
  it('建议价不低于盈亏平衡价', () => {
    const s = suggestPricing(p1)
    assert(s.suggestedPrice >= s.breakEvenPrice, `建议价 ${s.suggestedPrice} 应 ≥ 平衡价 ${s.breakEvenPrice}`)
  })

  it('输出成本构成', () => {
    const s = suggestPricing(p1)
    eq(s.costBreakdown.purchase, 8.5)
    eq(s.costBreakdown.fbaFee, 5.35)
    near(s.costBreakdown.inbound, 0.96, 1e-9)
  })

  it('价格扫描点覆盖竞品价格带', () => {
    const s = suggestPricing(p1)
    assert(s.points.length >= 10, '扫描点数量不足')
    assert(s.points[0].price < s.points[s.points.length - 1].price, '价格应升序')
    assert(s.priceRange[0] <= s.suggestedPrice, '建议价不应低于最低竞品价太多')
  })

  it('销量随价格单调不增', () => {
    for (let i = 1; i < 5; i++) {
      assert(estimateSales(10 + i, 10, 30) <= estimateSales(9 + i, 10, 30), '价格越高销量不应上升')
    }
  })

  it('能找到利润峰值点', () => {
    const best = bestProfitPoint(suggestPricing(p1))
    assert(best !== null, '应能找到峰值')
    assert(best!.profit > 0, '峰值利润应为正')
  })

  it('无竞品数据时仍能给出基于成本的定价', () => {
    const s = suggestPricing(empty)
    eq(s.priceRange[0], 0)
    assert(s.suggestedPrice >= s.breakEvenPrice, '仍应保住盈亏平衡')
  })
})
