import type { Tool } from '../core/tool'
import type { ComparisonResult, ComparisonRow } from '@/types/agent'
import { avgPrice, grossMargin, totalReviews, scoreCandidates } from '@/domain/scoring'

export const compareTool: Tool = {
  name: 'compare',
  description: '把多个候选品放在同一张表里横向对比，给出综合最优项',
  args: {},
  async run(_args, ctx) {
    if (ctx.candidates.length < 1) {
      return { message: '', warnings: ['没有可对比的候选品'] }
    }
    // 对比依赖评分，若上游没跑过 score 就在这里补一次
    const base = ctx.candidates.every(c => !c.scores)
      ? scoreCandidates(ctx.candidates, ctx.rules)
      : ctx.candidates

    const rows: ComparisonRow[] = base.map(c => {
      const margin = grossMargin(c)
      return {
        productId: c.id,
        name: c.name,
        avgPrice: Math.round(avgPrice(c) * 100) / 100,
        cost: c.cost,
        marginPct: margin === null ? null : Math.round(margin * 1000) / 10,
        competitorCount: c.competitors.length,
        totalReviews: totalReviews(c),
        totalScore: c.totalScore ?? null,
      }
    })

    const ranked = rows.filter(r => r.totalScore !== null)
    let winnerId: string | null = null
    if (ranked.length) {
      ranked.sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
      winnerId = ranked[0].productId
    } else if (rows.length) {
      // 没评分时退而求其次：毛利率最高的胜出
      const byMargin = [...rows].sort((a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity))
      winnerId = byMargin[0]?.marginPct !== null ? byMargin[0].productId : null
    }

    const notes: string[] = []
    if (ranked.length < rows.length) {
      notes.push(`${rows.length - ranked.length} 个商品因数据不足未参与排名`)
    }
    if (winnerId) {
      const w = rows.find(r => r.productId === winnerId)
      if (w) notes.push(`综合最优：${w.name}`)
    }

    const result: ComparisonResult = { rows, winnerId, notes }
    return {
      message: `对比了 ${rows.length} 个候选品${winnerId ? '，已选出综合最优' : ''}`,
      candidates: base,
      comparison: result,
    }
  },
}
