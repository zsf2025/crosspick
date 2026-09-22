import type { AgentAction } from '@/types/agent'
import type { ProductCandidate } from '@/types/product'
import type { ChatMessage } from './core/llm'

/**
 * Prompt 集中管理。
 * 单独成文件的原因：prompt 是 Agent 里变更最频繁的部分，
 * 和逻辑混在一起会导致每次调 prompt 都要改代码、也无法做 eval 对比。
 */

/**
 * 共享人格（system 角色）。所有面向模型的请求都先带这一段，
 * 这样"身份 + 输出纪律"只在一处维护，各业务 prompt 不必重复声明，
 * 改人格也只需改这里一处。
 *
 * 说明：本项目的收益主要是「人格统一 + prompt 可维护性」，而非 token ——
 * Ollama 本地单轮不跨请求缓存 system，每次请求仍会带上这段；
 * 但它让每条业务 prompt 都无需再重复身份/约束句，改一处即可全局生效。
 */
export const AGENT_SYSTEM = `你是 CrossPick 的跨境电商 AI 选品助手。你的目标是通过数据帮助卖家完成选品决策，包括评分排序、定价测算、评论洞察、横向对比、生成选品报告、淘汰与标记候选品。

工作原则：
- 基于已给出的数据做判断，不要编造候选品列表或数字。
- 需要结构化结果时只输出合法 JSON，不要包含任何解释文字、Markdown 代码块或多余标点。
- 自由文本回答要简洁、直接给结论，不复述已给数据。
- 不确定或数据不足时，明确说明"数据不足"，不要为了完整而硬编。`

/** 把共享人格与业务指令组装成合法的 messages 数组 */
export function withSystem(userContent: string): ChatMessage[] {
  return [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: userContent },
  ]
}

export const CLASSIFY_PROMPT = (query: string, memorySummary: string) =>
  `请判断用户意图属于以下哪一类，只输出一个英文单词：
- score：对候选品进行评分或排序
- price：对某个商品进行定价或利润测算
- review：分析用户评论痛点
- compare：横向对比多个商品
- report：生成选品报告
- mutate：淘汰、标记或修改某个商品
- clarify：问题不清晰，需要追问
${memorySummary ? `\n此前的对话：\n${memorySummary}\n` : ''}
用户问题：${query}`

export const PLAN_PROMPT = (
  action: AgentAction,
  query: string,
  toolNames: string,
  memorySummary: string,
) =>
  `你要为选品助手安排执行步骤。可用工具：${toolNames}。
用户意图已被判定为：${action}
${memorySummary ? `此前对话：\n${memorySummary}\n` : ''}
用户问题：${query}

请只输出 JSON，格式：{"steps":[{"tool":"工具名"}]}
步骤按顺序执行，最多 4 步。只允许使用上面列出的工具名。`

export const REVIEW_PROMPT = (productName: string, painPoints: string[], positives: string[]) =>
  `以下是亚马逊商品「${productName}」的用户反馈。

负面反馈：
${painPoints.length ? painPoints.map((p, i) => `${i + 1}. ${p}`).join('\n') : '（无）'}

正面反馈：
${positives.length ? positives.map((p, i) => `${i + 1}. ${p}`).join('\n') : '（无）'}

请输出 JSON，不要有任何解释文字：
{"suggestions":["改进建议1","改进建议2","改进建议3"],"summary":"一句话总结该商品的用户口碑"}`

export const REVIEW_STREAM_PROMPT = (productName: string, painPoints: string[], positives: string[]) =>
  `你是亚马逊选品顾问。商品「${productName}」的用户反馈如下。

负面反馈：
${painPoints.length ? painPoints.map((p, i) => `${i + 1}. ${p}`).join('\n') : '（无）'}

正面反馈：
${positives.length ? positives.map((p, i) => `${i + 1}. ${p}`).join('\n') : '（无）'}

请直接给出 3 条可执行的改进建议，每行一条，不要编号以外的多余文字。`

export const REPORT_PROMPT = (name: string, score: number | null, notes: string[]) =>
  `请为选品决策写一段 100 字以内的结论。

商品：${name}
综合评分：${score === null ? '数据不足' : score}
关键事实：
${notes.join('\n')}

要求：直接给出"建议做 / 建议放弃 / 需补数据"的判断，并说明理由。`

/**
 * 观察—反思提示词：让模型判断现有结果是否答足，不够就补调工具。
 * 措辞刻意保守（"能回答就不要补"），因为小模型倾向于"再查一次"，
 * 不约束的话容易陷入无限补充。
 */
/** 反思提示词的特征串：测试据此识别"这是反思请求"，避免被目标定位等其它调用干扰 */
export const REFLECT_MARK = '已经执行过的步骤与产出'

export const REFLECT_PROMPT = (query: string, toolNames: string, done: string) =>
  `请判断当前结果是否已经能回答用户的问题。

用户问题：${query}

${REFLECT_MARK}：
${done || '（还没有执行任何步骤）'}

可用工具（只能用这些名字，不要重复已执行过的）：${toolNames}

请只输出 JSON，不要有任何解释文字：
- 现有结果已经足够回答：{"done":true}
- 还缺关键信息：{"done":false,"next":[{"tool":"工具名"}]}

补充步骤最多 2 个。判断要保守：能回答就判定完成，不要为了完美而补调。`

/** 收尾总结提示词的特征串：测试据此识别"这是总结请求" */
export const SUMMARY_MARK = '请基于以下已得出的分析结果'

/**
 * 收尾总结：所有确定性工具跑完之后，让模型看着真实结果补一句人话结论。
 * 与反思的区别——反思决定"还要不要再做"，总结只负责"把已有结果说清楚"。
 */
export const SUMMARY_PROMPT = (query: string, digest: string) =>
  `${SUMMARY_MARK}，用一句话给出你的判断和建议。

用户的原始问题：${query}

${digest}

要求：
- 只输出一句话，不要编号、不要列表、不要小标题
- 直接给结论（值不值得做 / 该定多少价 / 风险在哪），不要复述上面的数据
- 如果给出了"用户问的商品"，必须针对它下结论，不要被"评分排名"里的第一名带偏
- 不超过 60 个字`

/** 把候选品压缩成模型能消化的简短清单 */
export function briefCandidateList(list: ProductCandidate[], limit = 20): string {
  return list
    .slice(0, limit)
    .map((c, i) => `${i + 1}. ${c.name}（${c.category}，成本 $${c.cost}）`)
    .join('\n')
}

/**
 * 质量评估提示词（LLM-as-judge）：让模型扮演选品质检员，按 5 个维度给本轮回答打分。
 * 与收尾总结的区别——总结是"把结果说清楚"，评估是"结果好不好"，两者都只在主结果得出后做。
 * 触发词 EVAL_MARK 用于测试识别这是评估请求，避免与反思/总结混淆。
 */
export const EVAL_MARK = '质量质检员'

export const EVAL_PROMPT = (query: string, action: string, digest: string) =>
  `${EVAL_MARK}：请对选品助手本轮回答的质量按 5 个维度各打 0-100 分，并给出最多 3 条中文改进建议。

用户原始问题：${query}
助手判定的意图：${action}

助手本轮产出摘要：
${digest}

评分维度：
- relevance（切题度）：回答是否切中用户问题
- target（目标命中）：用户点名的商品（如有）是否被重点处理
- tooling（工具使用）：是否调用了合适的工具来获得数据
- groundedness（有据可依）：结论是否基于真实数据，而非空泛
- completeness（完整度）：回答是否完整、未被中断、告警少

只输出 JSON，不要任何解释文字：
{"dimensions":{"relevance":0,"target":0,"tooling":0,"groundedness":0,"completeness":0},"notes":["建议1","建议2"]}`
