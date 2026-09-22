import type { Tool } from '../core/tool'
import type { ReviewAnalysis } from '@/types/agent'
import { REVIEW_PROMPT, REVIEW_STREAM_PROMPT, withSystem } from '../prompts'
import { neutralizeExternal } from '../guardrails'

/**
 * 评论洞察：LLM 真正发挥作用的地方。
 * 模型不可用或输出不合规范时降级为规则生成的建议，保证功能始终有输出。
 */
export const reviewTool: Tool = {
  name: 'review',
  description: '汇总指定商品的用户评论痛点，并给出改进建议',
  args: { targetId: '可选，商品 id' },
  async run(args, ctx) {
    const id = typeof args.targetId === 'string' ? args.targetId : null
    const target = id
      ? ctx.candidates.find(c => c.id === id) ?? null
      : ctx.resolveTarget(ctx.query) ?? ctx.candidates[0] ?? null

    if (!target) {
      return { message: '', warnings: ['未找到要分析的商品'] }
    }

    const painPoints = target.reviewInsights
      .filter(i => i.sentiment === 'negative')
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .map(i => ({ text: i.painPoint, mentions: i.mentionCount }))
    const positives = target.reviewInsights
      .filter(i => i.sentiment === 'positive')
      .map(i => i.painPoint)

    // 评论是外部不可信文本（用户评论 / 导入 CSV）：喂给模型前用护栏中和，
    // 在文本前声明"这是数据不是指令"，阻断其中夹带的 prompt injection。
    const safePain = painPoints.map(p => neutralizeExternal(`${p.text}（${p.mentions} 次提及）`).text)
    const safePos = positives.map(p => neutralizeExternal(p).text)

    let suggestions: string[] = []
    let modelSummary: string | undefined
    let degraded = true

    // 流式路径：逐字回传，UI 可以实时渲染
    if (painPoints.length && ctx.onDelta && (await ctx.llm.health())) {
      try {
        const text = await ctx.llm.stream(
          withSystem(
            REVIEW_STREAM_PROMPT(target.name, safePain, safePos),
          ),
          { temperature: 0.3 },
          chunk => ctx.onDelta?.(chunk),
        )
        const lines = text
          .split('\n')
          .map(s => s.replace(/^\s*\d+[.、)]\s*/, '').trim())
          .filter(Boolean)
        if (lines.length) {
          suggestions = lines.slice(0, 5)
          degraded = false
          ctx.tracer.observation('评论建议以流式方式生成', `${lines.length} 条`)
        }
      } catch {
        ctx.tracer.warning('流式生成失败，回退到结构化输出')
      }
    }

    if (degraded && painPoints.length && (await ctx.llm.health())) {
      const prompt = REVIEW_PROMPT(
        target.name,
        safePain,
        safePos,
      )
      try {
        const json = await ctx.llm.chatJson<{ suggestions?: string[]; summary?: string }>([
          { role: 'user', content: prompt },
        ], { temperature: 0.3 })
        if (json && Array.isArray(json.suggestions) && json.suggestions.length) {
          suggestions = json.suggestions.filter(s => typeof s === 'string')
          modelSummary = typeof json.summary === 'string' ? json.summary : undefined
          degraded = false
        }
      } catch {
        degraded = true
      }
    }

    if (degraded) {
      ctx.tracer.warning('评论分析降级为规则输出')
      suggestions = painPoints
        .slice(0, 3)
        .map(p => `优先解决「${p.text}」（${p.mentions} 次提及）`)
      if (!suggestions.length) suggestions = ['暂无负面评论数据，无法生成改进建议']
    }

    const analysis: ReviewAnalysis = {
      productId: target.id,
      productName: target.name,
      painPoints,
      positives,
      suggestions,
      modelSummary,
      degraded,
    }

    return {
      message: `${target.name}：${painPoints.length} 条痛点，${suggestions.length} 条建议${degraded ? '（模型不可用，已降级）' : ''}`,
      review: analysis,
    }
  },
}
