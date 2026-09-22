import type { AgentAction } from '@/types/agent'
import type { ProductCandidate } from '@/types/product'
import type { LLMProvider } from './core/llm'
import type { ConversationMemory } from './core/memory'
import { CLASSIFY_PROMPT, briefCandidateList, withSystem } from './prompts'

/**
 * 意图路由：规则优先，模型兜底。
 *
 * 为什么不让 LLM 直接分类：五分类是确定性任务，规则又快又稳，
 * 还能在模型没启动时保证功能可用。LLM 只在规则没命中时介入。
 * 关键词按"特异性"从高到低排列，避免"打个分"被更宽泛的规则先吃掉。
 */
const RULES: Array<{ action: AgentAction; words: string[] }> = [
  { action: 'mutate', words: ['淘汰', '放弃', '不做', '排除', '删掉', '去掉', '观察', '待定', '标签', '打上', '标记'] },
  { action: 'price', words: ['定价', '售价', '卖多少钱', '利润', '盈亏', '毛利', 'price', '怎么定价', '价格', '定价在'] },
  { action: 'review', words: ['评论', '痛点', '差评', '反馈', '口碑', 'review', '用户说'] },
  { action: 'compare', words: ['对比', '比较', '哪个好', '横向', 'compare', '哪个更'] },
  { action: 'report', words: ['报告', '汇报', 'report', '出一份', '生成报告', '总结'] },
  { action: 'score', words: ['打分', '评分', '得分', '排序', '排名', '排个名', 'score', '评估', '值得做', '怎么样', '如何'] },
]

/** 纯函数，便于单测和 eval：命中返回意图，未命中返回 null */
export function ruleRoute(query: string): AgentAction | null {
  const q = query.toLowerCase()
  for (const rule of RULES) {
    if (rule.words.some(w => q.includes(w.toLowerCase()))) return rule.action
  }
  return null
}

/** 从用户问题里定位目标商品 id；找不到返回 null */
export function resolveTargetId(
  query: string,
  candidates: ProductCandidate[],
  memory?: ConversationMemory,
): string | null {
  if (!candidates.length) return null

  // 1. 序号："第二个"
  const ordinal = memory?.ordinalIndex(query) ?? null
  if (ordinal !== null && candidates[ordinal]) return candidates[ordinal].id

  // 2. 名称直接命中（双向包含，容忍"台灯"这类简称）
  const q = query.toLowerCase()
  const byName = candidates.find(c => {
    const name = c.name.toLowerCase()
    return name === q || q.includes(name) || name.includes(q)
  })
  if (byName) return byName.id

  // 3. 关键词命中
  const byKeyword = candidates.find(c =>
    c.keywords.some(k => !!k && q.includes(k.toLowerCase())),
  )
  if (byKeyword) return byKeyword.id

  // 4. 指代词："它 / 这个 / 刚才那个"
  if (memory?.isReferential(query) && memory.lastTargetId) {
    const exists = candidates.find(c => c.id === memory.lastTargetId)
    if (exists) return memory.lastTargetId
  }

  // 5. 只有一个候选品时不必再猜
  if (candidates.length === 1) return candidates[0].id

  return null
}

export interface RouteResult {
  action: AgentAction
  routedBy: 'rule' | 'llm' | 'fallback'
  targetId: string | null
}

/** 让模型在候选清单里挑目标商品的序号，用于中文简称这类规则匹配不到的场景 */
export async function llmPickTarget(
  query: string,
  candidates: ProductCandidate[],
  llm: LLMProvider,
  signal?: AbortSignal,
): Promise<string | null> {
  if (candidates.length <= 1 || !(await llm.health())) return null
  try {
    const picked = await llm.chat(
      withSystem(
        `候选商品：\n${briefCandidateList(candidates)}\n\n用户想针对哪一个提问？只输出序号数字，都不匹配输出 0。\n用户问题：${query}`,
      ),
      { temperature: 0, signal },
    )
    const idx = parseInt(picked.trim(), 10) - 1
    if (Number.isInteger(idx) && idx >= 0 && candidates[idx]) return candidates[idx].id
  } catch {
    /* 定位失败就交给调用方处理 */
  }
  return null
}

/** 模型兜底：先让 LLM 判意图，再让它在候选清单里挑目标 */
export async function llmRoute(
  query: string,
  candidates: ProductCandidate[],
  llm: LLMProvider,
  memory: ConversationMemory,
  signal?: AbortSignal,
): Promise<RouteResult | null> {
  if (!(await llm.health())) return null
  const VALID: AgentAction[] = ['score', 'price', 'review', 'compare', 'report', 'mutate', 'clarify']
  try {
    const raw = await llm.chat(
      [{ role: 'user', content: CLASSIFY_PROMPT(query, memory.summary()) }],
      { temperature: 0, signal },
    )
    const word = raw.trim().toLowerCase()
    const action = VALID.find(a => word === a || word.includes(a))
    if (!action) return null

    const targetId =
      resolveTargetId(query, candidates, memory) ??
      (await llmPickTarget(query, candidates, llm, signal))
    // 模型判"说不清"但已经锁定到某个商品时，默认按评估处理——
    // 用户提到具体商品却什么都不做，体验上比判错更糟。
    if (action === 'clarify' && targetId) {
      return { action: 'score', routedBy: 'llm', targetId }
    }
    return { action, routedBy: 'llm', targetId }
  } catch {
    return null
  }
}

export async function route(
  query: string,
  candidates: ProductCandidate[],
  llm: LLMProvider,
  memory: ConversationMemory,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const hit = ruleRoute(query)
  if (hit) {
    // 规则判定意图后仍可能定位不到商品（比如中文简称），这时只让模型补定位这一件事
    const targetId =
      resolveTargetId(query, candidates, memory) ??
      (await llmPickTarget(query, candidates, llm, signal))
    return { action: hit, routedBy: 'rule', targetId }
  }
  const fallback = await llmRoute(query, candidates, llm, memory, signal)
  if (fallback) return fallback
  return { action: 'clarify', routedBy: 'fallback', targetId: null }
}
