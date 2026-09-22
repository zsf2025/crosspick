import { describe, it, assert, eq } from './harness'
import { runAgent } from '@/agent/run'
import { ConversationMemory } from '@/agent/core/memory'
import { createDefaultRegistry } from '@/agent/tools'
import { mockProducts } from '@/adapters/mock'
import { DEFAULT_RULES } from '@/domain/rules'
import type { LLMProvider } from '@/agent/core/llm'

/**
 * Eval：工具选择正确性。
 * 在「意图路由准确率」(eval.test.ts) 之上，进一步验证 Agent 是否真的挑对了工具——
 * 路由判断的是"用户想干嘛"，这一步判断的是"该调哪些工具去干"。
 * 这是 LLM-as-judge 之外、对"Agent 选对工具没"最直接的量化手段。
 */

/** 安静模型：规划阶段不返回有效工具调用，loop 回退到确定性 rulePlan，便于断言工具选择 */
class QuietProvider implements LLMProvider {
  name = 'quiet'
  async chat(): Promise<string> {
    return ''
  }
  async chatJson<T>(): Promise<T | null> {
    return null
  }
  async stream(): Promise<string> {
    return ''
  }
  async health(): Promise<boolean> {
    return true
  }
  async chatTools(): Promise<{ tool: null; text: string }> {
    return { tool: null, text: '' }
  }
}

const CASES: Array<[string, string[]]> = [
  ['给所有候选品打分', ['score']],
  ['给台灯定价', ['price']],
  ['分析台灯的评论', ['review']],
  ['对比这几个候选品', ['compare']],
  ['把台灯淘汰掉', ['mutate']],
  ['生成选品报告', ['score', 'compare', 'review', 'report']],
]

function runSel(query: string) {
  return runAgent({
    query,
    candidates: mockProducts(),
    rules: DEFAULT_RULES,
    llm: new QuietProvider(),
    memory: new ConversationMemory(),
    registry: createDefaultRegistry(),
    reflect: false,
  })
}

describe('Eval · 工具选择正确性', () => {
  for (const [query, expected] of CASES) {
    it(`「${query}」应选中工具 [${expected.join(', ')}]`, async () => {
      const { output } = await runSel(query)
      eq(output.toolCalls.map(t => t.tool).join(','), expected.join(','))
    })
  }

  it('全用例工具选择无偏差（意图→工具映射稳定）', async () => {
    let miss = 0
    for (const [query, expected] of CASES) {
      const { output } = await runSel(query)
      const got = output.toolCalls.map(t => t.tool).join(',')
      if (got !== expected.join(',')) {
        console.log(`        偏差：「${query}」期望 ${expected.join(',')}，实际 ${got}`)
        miss += 1
      }
    }
    assert(miss === 0, `有 ${miss} 条工具选择偏差`)
  })
})
