import type { Competitor, ProductCandidate, ReviewInsight } from '@/types/product'
import { createCandidate } from '@/types/product'

/**
 * CSV 支持两种形态：
 *
 * 1. 长表（推荐，含 asin 列）：一个竞品一行，同一商品的多行会按 id/name 归并。
 *    列：id,name,category,cost,weightKg,keywords,asin,competitorTitle,price,rating,reviewCount,monthlySales,reviewPainPoints,reviewPositivePoints
 *
 * 2. 宽表（兼容旧格式）：一个商品一行，竞品用聚合字段描述。
 *    列：id,name,category,cost,weightKg,keywords,competitorPriceAvg,competitorReviewTotal,competitorCount,competitorRatingAvg,reviewPainPoints,reviewPositivePoints
 *
 * 宽表会把聚合值展开成 N 个竞品行，这样竞争强度维度才有意义——
 * 旧实现只造一个"竞品均值"占位，导致竞品数恒为 1、评分失真。
 */

export interface ParseResult {
  candidates: ProductCandidate[]
  warnings: string[]
  mode: 'long' | 'wide' | 'empty'
}

const num = (v: string | undefined, d = 0): number => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s]/g, ''))
  return Number.isFinite(n) ? n : d
}

function splitList(v: string | undefined, seps: string[]): string[] {
  if (!v) return []
  let parts = [v]
  for (const sep of seps) {
    parts = parts.flatMap(p => p.split(sep))
  }
  return parts.map(s => s.trim()).filter(Boolean)
}

/** 痛点格式支持 "文本" 或 "文本|提及次数" */
function parseInsights(v: string | undefined, sentiment: ReviewInsight['sentiment']): ReviewInsight[] {
  return splitList(v, ['；', ';', '｜']).map(raw => {
    const [text, count] = raw.split('|')
    return {
      painPoint: (text ?? raw).trim(),
      mentionCount: parseInt(count ?? '1', 10) || 1,
      sentiment,
    }
  })
}

function buildLong(rows: Record<string, string>[]): ParseResult {
  const byKey = new Map<string, ProductCandidate>()
  const warnings: string[] = []
  let index = 0

  for (const r of rows) {
    const name = (r.name ?? '').trim()
    if (!name) continue
    const key = (r.id ?? '').trim() || name
    let c = byKey.get(key)
    if (!c) {
      index += 1
      c = createCandidate({
        id: (r.id ?? '').trim() || `csv-${index}`,
        name,
        category: (r.category ?? '').trim() || 'Uncategorized',
        cost: num(r.cost),
        weightKg: num(r.weightKg),
        keywords: splitList(r.keywords, ['|', '、']),
        competitors: [],
        reviewInsights: [],
      })
      byKey.set(key, c)
    }
    const asin = (r.asin ?? '').trim()
    const price = num(r.price)
    const reviewCount = num(r.reviewCount)
    if (asin || price > 0) {
      const comp: Competitor = {
        asin: asin || `csv-${c.id}-${c.competitors.length + 1}`,
        title: (r.competitorTitle ?? '').trim() || `竞品 ${c.competitors.length + 1}`,
        price,
        rating: num(r.rating, 4.2),
        reviewCount,
        monthlySales: num(r.monthlySales) || Math.round(reviewCount * 0.25),
      }
      c.competitors.push(comp)
    }
    const merged = [
      ...parseInsights(r.reviewPainPoints, 'negative'),
      ...parseInsights(r.reviewPositivePoints, 'positive'),
    ]
    for (const ins of merged) {
      if (!c.reviewInsights.some(i => i.painPoint === ins.painPoint)) {
        c.reviewInsights.push(ins)
      }
    }
  }

  const candidates = [...byKey.values()]
  if (!candidates.length) return { candidates: [], warnings, mode: 'empty' }
  const noComp = candidates.filter(c => !c.competitors.length).length
  if (noComp) warnings.push(`${noComp} 个商品没有竞品数据，竞争强度维度将显示 N/A`)
  return { candidates, warnings, mode: 'long' }
}

function buildWide(rows: Record<string, string>[]): ParseResult {
  const warnings: string[] = []
  const candidates: ProductCandidate[] = []

  rows.forEach((r, i) => {
    const name = (r.name ?? '').trim()
    if (!name) return

    const count = Math.max(0, Math.round(num(r.competitorCount)))
    const avg = num(r.competitorPriceAvg)
    const reviews = num(r.competitorReviewTotal)
    const rating = num(r.competitorRatingAvg, 4.2)

    const competitors: Competitor[] =
      count > 0
        ? Array.from({ length: count }, (_, k) => ({
            asin: `csv-${i + 1}-${k + 1}`,
            title: `竞品 ${k + 1}`,
            price: avg,
            rating,
            reviewCount: Math.round(reviews / count),
            monthlySales: Math.round((reviews / count) * 0.25),
          }))
        : []

    candidates.push(
      createCandidate({
        id: (r.id ?? '').trim() || `csv-${i + 1}`,
        name,
        category: (r.category ?? '').trim() || 'Uncategorized',
        cost: num(r.cost),
        weightKg: num(r.weightKg),
        keywords: splitList(r.keywords, ['|', '、']),
        competitors,
        reviewInsights: [
          ...parseInsights(r.reviewPainPoints, 'negative'),
          ...parseInsights(r.reviewPositivePoints, 'positive'),
        ],
      }),
    )
  })

  if (!candidates.length) return { candidates: [], warnings, mode: 'empty' }
  const noComp = candidates.filter(c => !c.competitors.length).length
  if (noComp) warnings.push(`${noComp} 个商品缺少竞品数量，竞争强度维度将显示 N/A`)
  return { candidates, warnings, mode: 'wide' }
}

export function parseCsvDetailed(rows: Record<string, string>[]): ParseResult {
  if (!rows.length) return { candidates: [], warnings: ['文件为空'], mode: 'empty' }
  const headers = Object.keys(rows[0] ?? {})
  const isLong = headers.some(h => h.trim().toLowerCase() === 'asin')
  return isLong ? buildLong(rows) : buildWide(rows)
}

/** 兼容旧签名的简单入口 */
export function parseCsvProducts(rows: Record<string, string>[]): ProductCandidate[] {
  return parseCsvDetailed(rows).candidates
}

export const CSV_TEMPLATE_WIDE =
  'id,name,category,cost,weightKg,keywords,competitorPriceAvg,competitorReviewTotal,competitorCount,competitorRatingAvg,reviewPainPoints,reviewPositivePoints\n' +
  'p1,LED Desk Lamp,Home & Office,8.5,0.6,desk lamp|usb lamp,26.32,42500,3,4.2,充电底座发热|342；亮度档位少|128,外观有质感|890'

export const CSV_TEMPLATE_LONG =
  'id,name,category,cost,weightKg,keywords,asin,competitorTitle,price,rating,reviewCount,monthlySales,reviewPainPoints\n' +
  'p1,LED Desk Lamp,Home & Office,8.5,0.6,desk lamp|usb lamp,B0X1,Desk Lamp A,25.99,4.3,12400,3200,充电底座发热|342\n' +
  'p1,LED Desk Lamp,Home & Office,8.5,0.6,desk lamp|usb lamp,B0X2,Desk Lamp B,32.99,4.6,8100,1800,亮度档位少|128'
