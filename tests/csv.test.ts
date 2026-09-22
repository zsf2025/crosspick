import { describe, it, assert, eq, near } from './harness'
import { parseCsvDetailed, parseCsvProducts, CSV_TEMPLATE_WIDE } from '@/adapters/csv'

const WIDE = [
  {
    id: 'p1',
    name: 'LED Desk Lamp',
    category: 'Home & Office',
    cost: '8.5',
    weightKg: '0.6',
    keywords: 'desk lamp|usb lamp',
    competitorPriceAvg: '26.32',
    competitorReviewTotal: '42500',
    competitorCount: '3',
    competitorRatingAvg: '4.2',
    reviewPainPoints: '充电底座发热|342；亮度档位少|128',
    reviewPositivePoints: '外观有质感|890',
  },
]

const LONG = [
  {
    id: 'p1',
    name: 'LED Desk Lamp',
    category: 'Home',
    cost: '8.5',
    weightKg: '0.6',
    keywords: 'desk lamp',
    asin: 'B0X1',
    price: '25.99',
    rating: '4.3',
    reviewCount: '12400',
    monthlySales: '3200',
    reviewPainPoints: '发热|342',
  },
  {
    id: 'p1',
    name: 'LED Desk Lamp',
    category: 'Home',
    cost: '8.5',
    weightKg: '0.6',
    keywords: 'desk lamp',
    asin: 'B0X2',
    price: '32.99',
    rating: '4.6',
    reviewCount: '8100',
    monthlySales: '1800',
    reviewPainPoints: '亮度不足|128',
  },
]

describe('CSV 宽表', () => {
  it('按竞品数量展开出对应条数', () => {
    const res = parseCsvDetailed(WIDE)
    eq(res.mode, 'wide')
    eq(res.candidates.length, 1)
    eq(res.candidates[0].competitors.length, 3)
  })

  it('评论总数按比例分摊到各竞品', () => {
    const c = parseCsvDetailed(WIDE).candidates[0]
    const sum = c.competitors.reduce((s, i) => s + i.reviewCount, 0)
    near(sum, 42500, 3)
  })

  it('解析带提及次数的痛点', () => {
    const c = parseCsvDetailed(WIDE).candidates[0]
    const neg = c.reviewInsights.filter(i => i.sentiment === 'negative')
    eq(neg.length, 2)
    eq(neg[0].painPoint, '充电底座发热')
    eq(neg[0].mentionCount, 342)
    eq(c.reviewInsights.filter(i => i.sentiment === 'positive').length, 1)
  })

  it('缺竞品数量时给出警告而不是静默造数', () => {
    const res = parseCsvDetailed([{ ...WIDE[0], competitorCount: '' }])
    eq(res.candidates[0].competitors.length, 0)
    assert(res.warnings.length > 0, '应提示缺少竞品数据')
  })

  it('补齐默认字段', () => {
    const c = parseCsvDetailed(WIDE).candidates[0]
    eq(c.status, 'active')
    assert(Array.isArray(c.tags), 'tags 应为数组')
    assert(Array.isArray(c.snapshots), 'snapshots 应为数组')
  })
})

describe('CSV 长表', () => {
  it('同一商品的多行竞品会被归并', () => {
    const res = parseCsvDetailed(LONG)
    eq(res.mode, 'long')
    eq(res.candidates.length, 1)
    eq(res.candidates[0].competitors.length, 2)
  })

  it('保留每个竞品的独立数值', () => {
    const c = parseCsvDetailed(LONG).candidates[0]
    eq(c.competitors[0].asin, 'B0X1')
    eq(c.competitors[1].asin, 'B0X2')
    near(c.competitors[0].price, 25.99, 1e-9)
  })

  it('合并多行里的痛点且去重', () => {
    const c = parseCsvDetailed(LONG).candidates[0]
    eq(c.reviewInsights.length, 2)
  })

  it('月度销量缺省时按评论数折算', () => {
    const res = parseCsvDetailed([
      { ...LONG[0], monthlySales: '', reviewCount: '1000' },
    ])
    eq(res.candidates[0].competitors[0].monthlySales, 250)
  })
})

describe('CSV 边界', () => {
  it('空输入返回 empty', () => {
    eq(parseCsvDetailed([]).mode, 'empty')
  })

  it('跳过没有名字的行', () => {
    const res = parseCsvDetailed([{ name: '' }, ...WIDE])
    eq(res.candidates.length, 1)
  })

  it('兼容旧入口签名', () => {
    eq(parseCsvProducts(WIDE).length, 1)
  })

  it('内置模板可被正确解析', () => {
    const lines = CSV_TEMPLATE_WIDE.trim().split('\n')
    const headers = lines[0].split(',')
    const row: Record<string, string> = {}
    lines[1].split(',').forEach((v, i) => {
      row[headers[i]] = v
    })
    const res = parseCsvDetailed([row])
    eq(res.candidates.length, 1)
    eq(res.candidates[0].competitors.length, 3)
  })
})
