import type { Tool } from '../core/tool'
import { scoreCandidates } from '@/domain/scoring'

export const scoreTool: Tool = {
  name: 'score',
  description: '按当前评分规则对所有候选品做五维评分，并按加权总分排序',
  args: { targetId: '（可选）用户点名的商品 id，结论中额外给出它的分数与排名' },
  async run(args, ctx) {
    if (!ctx.candidates.length) {
      return { message: '', warnings: ['候选品列表为空，无法评分'] }
    }
    const scored = scoreCandidates(ctx.candidates, ctx.rules)
    const ranked = scored.filter(c => c.totalScore !== null)
    const missing = scored.length - ranked.length
    const parts = [`已对 ${scored.length} 个候选品评分`]
    if (ranked.length) {
      parts.push(`第一名：${ranked[0].name}（${ranked[0].totalScore} 分）`)
    }
    if (missing) parts.push(`${missing} 个因数据不足无法给出总分`)

    // 用户点名问了某个品：光报第一名是在答另一个问题，必须回落到他问的那个
    const targetId = typeof args?.targetId === 'string' ? args.targetId : null
    const focus = targetId ? scored.find(c => c.id === targetId) ?? null : null
    if (focus) {
      const rank = ranked.findIndex(c => c.id === focus.id)
      parts.push(
        focus.totalScore === null
          ? `其中「${focus.name}」数据不足，无法给出总分`
          : `其中「${focus.name}」${focus.totalScore} 分，排名第 ${rank + 1}/${ranked.length}`,
      )
    }

    return { message: parts.join('，'), candidates: scored }
  },
}
