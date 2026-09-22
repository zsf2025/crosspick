import { describe, it, assert } from './harness'
import { ruleRoute, resolveTargetId } from '@/agent/router'
import { ConversationMemory } from '@/agent/core/memory'
import { mockProducts } from '@/adapters/mock'
import type { AgentAction } from '@/types/agent'

/**
 * Eval：路由准确率。
 * 这是判断 Agent 改动是变好还是变差唯一的量化手段——
 * 没有它，调 prompt 和调规则全靠感觉。
 */

const INTENT_CASES: Array<[string, AgentAction | null]> = [
  ['给所有候选品打分', 'score'],
  ['这些品怎么排序', 'score'],
  ['帮我评估一下这些品', 'score'],
  ['这个品值得做吗', 'score'],
  ['按综合分排个名', 'score'],
  ['哪些品得分最高', 'score'],
  ['帮我看看这些品怎么样', 'score'],
  ['给台灯定价', 'price'],
  ['这个卖多少钱合适', 'price'],
  ['利润空间有多大', 'price'],
  ['算一下盈亏平衡点', 'price'],
  ['毛利率能到多少', 'price'],
  ['价格定在多少最好', 'price'],
  ['分析台灯的评论', 'review'],
  ['用户痛点有哪些', 'review'],
  ['差评主要集中在哪', 'review'],
  ['这个品口碑怎么样', 'review'],
  ['买家反馈有什么问题', 'review'],
  ['对比这几个候选品', 'compare'],
  ['哪个更好', 'compare'],
  ['横向比较一下', 'compare'],
  ['这几个品哪个更值得做', 'compare'],
  ['生成选品报告', 'report'],
  ['给我一份报告', 'report'],
  ['总结一下这几个品', 'report'],
  ['出一份完整评估', 'report'],
  ['把台灯淘汰掉', 'mutate'],
  ['这个品先观察', 'mutate'],
  ['给台灯打个标签', 'mutate'],
  ['阻力带不做了', 'mutate'],
  ['帮我看看', null],
]

const TARGET_CASES: Array<[string, string | null]> = [
  ['给台灯定价', 'p1'],
  ['分析榨汁机的差评', 'p4'],
  ['阻力带怎么样', 'p3'],
  ['空气炸锅的利润如何', 'p2'],
  ['给所有候选品打分', null],
]

describe('Eval · 意图路由', () => {
  it(`规则路由准确率应 ≥ 90%（${INTENT_CASES.length} 条用例）`, () => {
    let hit = 0
    const misses: string[] = []
    for (const [q, expected] of INTENT_CASES) {
      const got = ruleRoute(q)
      if (got === expected) hit += 1
      else misses.push(`「${q}」期望 ${expected ?? 'null(交给模型)'}，实际 ${got}`)
    }
    const rate = hit / INTENT_CASES.length
    console.log(`        准确率 ${(rate * 100).toFixed(1)}%（${hit}/${INTENT_CASES.length}）`)
    for (const m of misses) console.log(`        ${m}`)
    assert(rate >= 0.9, `路由准确率仅 ${(rate * 100).toFixed(1)}%，低于 90% 门槛`)
  })

  it('每个意图都至少被两条用例覆盖', () => {
    const counts = new Map<string, number>()
    for (const [, expected] of INTENT_CASES) {
      if (!expected) continue
      counts.set(expected, (counts.get(expected) ?? 0) + 1)
    }
    for (const action of ['score', 'price', 'review', 'compare', 'report', 'mutate']) {
      assert((counts.get(action) ?? 0) >= 2, `${action} 的用例不足 2 条`)
    }
  })
})

describe('Eval · 目标定位', () => {
  it(`定位准确率应 ≥ 80%（${TARGET_CASES.length} 条用例）`, () => {
    const products = mockProducts()
    const memory = new ConversationMemory()
    let hit = 0
    const misses: string[] = []
    for (const [q, expected] of TARGET_CASES) {
      const got = resolveTargetId(q, products, memory)
      if (got === expected) hit += 1
      else misses.push(`「${q}」期望 ${expected ?? 'null'}，实际 ${got ?? 'null'}`)
    }
    const rate = hit / TARGET_CASES.length
    console.log(`        准确率 ${(rate * 100).toFixed(1)}%（${hit}/${TARGET_CASES.length}）`)
    for (const m of misses) console.log(`        ${m}`)
    assert(rate >= 0.8, `定位准确率仅 ${(rate * 100).toFixed(1)}%，低于 80% 门槛`)
  })
})
