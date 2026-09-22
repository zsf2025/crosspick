import type { AgentAction, ComparisonResult, PricingSuggestion, ReviewAnalysis, ReportSection } from '@/types/agent'
import type { ProductCandidate } from '@/types/product'
import type { LLMProvider } from './core/llm'
import type { Tracer } from './core/trace'
import { SUMMARY_PROMPT, withSystem } from './prompts'

/**
 * 收尾总结：确定性工具跑完之后，让模型看着真实结果补一句人话结论。
 *
 * 为什么单独成模块：
 * - 它不是工具——工具之间看不到彼此的产出，而总结要看到全量结果；
 * - 它也不是计算——纯粹的语言组织，正是模型该干的活；
 * - 它必须能安静地失败——模型不在、超时、输出为空，就当没这一步。
 */

export interface DigestInput {
  query: string
  action: AgentAction
  message: string
  candidates: ProductCandidate[]
  targetId?: string | null
  pricing?: PricingSuggestion
  review?: ReviewAnalysis
  comparison?: ComparisonResult
  report?: ReportSection[]
}

/** 喂给模型的结果摘要（纯函数，可单测）。刻意只取前 3 名，控制 token */
export function buildDigest(input: DigestInput, top = 3): string {
  const lines: string[] = [`执行动作：${input.action}`]
  if (input.message) lines.push(`系统结论：${input.message}`)

  const ranked = input.candidates
    .filter(c => c.totalScore !== null)
    .slice(0, top)

  // 用户点名的商品放在最显眼处：
  // 摘要里排名第一的商品会抢走模型的注意力，不点名就会出现"问 A 答 B"
  const focus = input.targetId
    ? input.candidates.find(c => c.id === input.targetId) ?? null
    : null
  if (focus) {
    const rank = ranked.findIndex(c => c.id === focus.id)
    const rankText = rank >= 0 ? `，排名第 ${rank + 1}/${ranked.length}` : ''
    const scoreText = focus.totalScore === null ? '数据不足、无总分' : `${focus.totalScore} 分`
    lines.push(`用户问的商品：${focus.name}（${scoreText}${rankText}）`)
  }
  if (ranked.length) {
    lines.push(
      `评分排名：${ranked
        .map((c, i) => `${i + 1}. ${c.name} ${c.totalScore} 分`)
        .join('；')}`,
    )
  }
  const noScore = input.candidates.length - ranked.length
  if (noScore > 0) lines.push(`${noScore} 个候选品因数据不足没有总分`)

  if (input.pricing) {
    const p = input.pricing
    lines.push(
      `定价：${p.productName} 建议售价 $${p.suggestedPrice}，盈亏平衡 $${p.breakEvenPrice}，目标毛利率 ${(p.targetMargin * 100).toFixed(0)}%`,
    )
  }
  if (input.review) {
    const r = input.review
    lines.push(
      `评论：${r.productName} 主要痛点 ${r.painPoints
        .slice(0, 3)
        .map(p => p.text)
        .join('、') || '（无）'}`,
    )
    if (r.modelSummary) lines.push(`口碑总结：${r.modelSummary}`)
  }
  if (input.comparison) {
    const c = input.comparison
    const winner = c.rows.find(r => r.productId === c.winnerId)
    if (winner) lines.push(`对比最优：${winner.name}`)
    if (c.notes.length) lines.push(`对比要点：${c.notes.slice(0, 2).join('；')}`)
  }
  if (input.report?.length) {
    const last = input.report[input.report.length - 1]
    lines.push(`报告结论：${last.heading} — ${last.body}`)
  }

  return lines.join('\n')
}

/** 把模型输出收敛成一句话：去代码块、去换行、去首尾引号、限长（纯函数） */
export function normalizeSummary(raw: string | null | undefined, maxLen = 120): string | null {
  if (!raw) return null
  let text = raw.trim()
  const fenced = text.match(/```(?:json|text)?\s*([\s\S]*?)```/)
  if (fenced) text = fenced[1].trim()
  text = text.replace(/^["'“‘]+|["'”’]+$/g, '').trim()
  text = text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!text) return null
  // 截断在句子边界附近，避免半句话
  if (text.length > maxLen) {
    const cut = text.slice(0, maxLen)
    const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
    text = stop > maxLen * 0.5 ? cut.slice(0, stop + 1) : `${cut}…`
  }
  return text
}

export interface SummarizeOptions {
  llm: LLMProvider
  tracer: Tracer
  /** 流式回调：有则逐字返回，没有则一次性返回 */
  onDelta?: (chunk: string) => void
  /** 取消信号：透传给底层请求 */
  signal?: AbortSignal
}

/**
 * 生成收尾总结。任何异常都返回 null——总结是增益项，失败不应影响主结果。
 */
export async function summarize(
  query: string,
  digest: string,
  opts: SummarizeOptions,
): Promise<string | null> {
  if (!(await opts.llm.health())) {
    opts.tracer.thought('模型不可用，跳过收尾总结')
    return null
  }
  const messages = withSystem(SUMMARY_PROMPT(query, digest))
  try {
    const raw = opts.onDelta
      ? await opts.llm.stream(messages, { temperature: 0.3, signal: opts.signal }, opts.onDelta)
      : await opts.llm.chat(messages, { temperature: 0.3, signal: opts.signal })
    const text = normalizeSummary(raw)
    if (!text) {
      opts.tracer.warning('模型未给出可用总结', '已忽略')
      return null
    }
    opts.tracer.thought('模型给出收尾总结', text)
    return text
  } catch {
    opts.tracer.warning('收尾总结失败', '已忽略，不影响主结果')
    return null
  }
}
