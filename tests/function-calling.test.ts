import { describe, it, eq } from './harness'
import { runAgent } from '@/agent/run'
import { ConversationMemory } from '@/agent/core/memory'
import { createDefaultRegistry } from '@/agent/tools'
import { mockProducts } from '@/adapters/mock'
import { DEFAULT_RULES } from '@/domain/rules'
import type { ChatMessage, LLMProvider, ToolCallDef, ToolCallResult } from '@/agent/core/llm'

/**
 * 原生 function calling 开关：验证 RunOptions.preferFunctionCalling 真的改变规划路径。
 * 思路：构造一个"两条路径返回不同工具"的模型——
 *   chatTools 返回 [review]（错），chatJson 返回 [score]（对）。
 * - 开启（默认）→ 走 chatTools → 选中 review；
 * - 关闭 → 跳过 chatTools，走文本 JSON → 选中 score。
 */

class SplitProvider implements LLMProvider {
  name = 'split'
  async chat(): Promise<string> {
    return ''
  }
  async chatJson<T>(): Promise<T | null> {
    // 文本解析路径：故意返回"正确"的 score 计划
    return { steps: [{ tool: 'score' }] } as T
  }
  async stream(): Promise<string> {
    return ''
  }
  async health(): Promise<boolean> {
    return true
  }
  async chatTools(_m: ChatMessage[], _t: ToolCallDef[]): Promise<ToolCallResult> {
    // 工具协议路径：故意返回"错误"的 review 计划，用来区分两条路径
    return { tool: { name: 'run_plan', args: { steps: ['review'] } }, text: '' }
  }
}

function runSel(prefer: boolean) {
  return runAgent({
    query: '给所有候选品打分',
    candidates: mockProducts(),
    rules: DEFAULT_RULES,
    llm: new SplitProvider(),
    memory: new ConversationMemory(),
    registry: createDefaultRegistry(),
    useLlmPlanner: true,
    reflect: false,
    preferFunctionCalling: prefer,
  })
}

describe('原生 function calling 开关', () => {
  it('默认（开启）优先走 chatTools 路径', async () => {
    const { output } = await runSel(true)
    eq(output.toolCalls.map(t => t.tool).join(','), 'review')
  })

  it('关闭后跳过 chatTools，强制文本 JSON 解析', async () => {
    const { output } = await runSel(false)
    eq(output.toolCalls.map(t => t.tool).join(','), 'score')
  })
})
