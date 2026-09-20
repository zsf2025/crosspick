import type { ProductCandidate } from '@/types/product'

/**
 * 期望 CSV 表头（扁平宽表，一个商品一行）：
 * id,name,category,cost,weightKg,keywords,competitorPriceAvg,competitorReviewTotal,competitorCount,reviewPainPoints
 * keywords 用 | 分隔；reviewPainPoints 用 ； 分隔
 */
export function parseCsvProducts(rows: Record<string, string>[]): ProductCandidate[] {
  return rows.filter(r => r.name?.trim()).map((r, i) => ({
    id: r.id?.trim() || `csv-${i}`,
    name: r.name.trim(),
    category: r.category?.trim() || 'Uncategorized',
    cost: parseFloat(r.cost) || 0,
    weightKg: parseFloat(r.weightKg) || 0,
    keywords: (r.keywords || '').split('|').map(s => s.trim()).filter(Boolean),
    competitors: [
      {
        asin: `c-${i}-1`,
        title: '竞品均值',
        price: parseFloat(r.competitorPriceAvg) || 0,
        rating: 4.2,
        reviewCount: parseInt(r.competitorReviewTotal) || 0,
        monthlySales: Math.round((parseInt(r.competitorReviewTotal) || 0) * 0.25),
      },
    ],
    reviewInsights: (r.reviewPainPoints || '')
      .split('；')
      .map(s => s.trim())
      .filter(Boolean)
      .map(t => ({ painPoint: t, mentionCount: 1, sentiment: 'negative' as const })),
  }))
}