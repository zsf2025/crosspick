import { describe, it, assert, eq } from './harness'
import { ruleRoute, resolveTargetId } from '@/agent/router'
import { ConversationMemory } from '@/agent/core/memory'
import { mockProducts } from '@/adapters/mock'

const products = mockProducts()

describe('意图路由 · 规则命中', () => {
  it('打分类', () => {
    eq(ruleRoute('给所有候选品打分'), 'score')
    eq(ruleRoute('这些品怎么排序'), 'score')
    eq(ruleRoute('帮我评估一下'), 'score')
  })

  it('定价类', () => {
    eq(ruleRoute('给台灯定价'), 'price')
    eq(ruleRoute('这个卖多少钱合适'), 'price')
    eq(ruleRoute('毛利率能到多少'), 'price')
  })

  it('评论类', () => {
    eq(ruleRoute('分析台灯的评论'), 'review')
    eq(ruleRoute('用户痛点有哪些'), 'review')
    eq(ruleRoute('这个品口碑怎么样'), 'review')
  })

  it('对比类', () => {
    eq(ruleRoute('对比这几个候选品'), 'compare')
    eq(ruleRoute('哪个更好'), 'compare')
  })

  it('报告类', () => {
    eq(ruleRoute('生成选品报告'), 'report')
    eq(ruleRoute('总结一下'), 'report')
  })

  it('修改类优先级最高', () => {
    eq(ruleRoute('把台灯淘汰掉'), 'mutate')
    eq(ruleRoute('这个品先观察'), 'mutate')
    eq(ruleRoute('给台灯打个标签'), 'mutate')
  })

  it('无法判定时返回 null 交给模型兜底', () => {
    eq(ruleRoute('帮我看看'), null)
  })

  it('大小写不敏感', () => {
    eq(ruleRoute('SCORE these items'), 'score')
  })
})

describe('目标定位', () => {
  it('按商品全名定位', () => {
    const id = resolveTargetId('给 LED Desk Lamp with Wireless Charger 定价', products)
    eq(id, 'p1')
  })

  it('按中文关键词定位', () => {
    eq(resolveTargetId('给台灯定价', products), 'p1')
    eq(resolveTargetId('分析榨汁机的差评', products), 'p4')
    eq(resolveTargetId('阻力带怎么样', products), 'p3')
  })

  it('按序数定位', () => {
    const mem = new ConversationMemory()
    eq(mem.ordinalIndex('第二个品怎么样'), 1)
    eq(resolveTargetId('第二个', products, mem), 'p2')
  })

  it('按上一轮指代定位', () => {
    const mem = new ConversationMemory()
    mem.push({ query: '给台灯定价', action: 'price', targetId: 'p1' })
    assert(mem.isReferential('给它定价'), '应识别为指代')
    eq(resolveTargetId('给它定价', products, mem), 'p1')
  })

  it('无明确目标时返回 null', () => {
    eq(resolveTargetId('给所有候选品打分', products), null)
  })

  it('只有一个候选品时直接选中', () => {
    eq(resolveTargetId('随便看看', [products[0]]), 'p1')
  })
})

describe('会话记忆', () => {
  it('记录并回放最近轮次', () => {
    const mem = new ConversationMemory()
    mem.push({ query: 'q1', action: 'score', targetId: null })
    mem.push({ query: 'q2', action: 'price', targetId: 'p3' })
    eq(mem.lastTargetId, 'p3')
    eq(mem.lastAction, 'price')
    assert(mem.summary().includes('q2'), '摘要应包含最近一轮')
  })

  it('摘要长度受限', () => {
    const mem = new ConversationMemory()
    for (let i = 0; i < 20; i++) mem.push({ query: `q${i}`, action: 'score', targetId: null })
    const s = mem.summary(3)
    assert(!s.includes('q0'), '不应包含最早的记录')
    assert(s.includes('q19'), '应包含最新的记录')
  })
})
