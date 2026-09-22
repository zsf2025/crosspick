import { describe, it, assert, eq } from './harness'

// localStorage 由 tests/index.ts 统一注入为内存 shim（避免多个 test 文件各自覆盖导致写入/断言错位）

const { useCatalogStore } = await import('@/stores/catalog')
const { useSettingsStore } = await import('@/stores/settings')
const { createPinia, setActivePinia } = await import('pinia')
const { nextTick } = await import('vue')
const { NullProvider, setLLM } = await import('@/agent/core/llm')

setLLM(new NullProvider())

function fresh() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return { catalog: useCatalogStore(), settings: useSettingsStore() }
}

describe('Store · 候选品', () => {
  it('载入 Mock 后自动选中第一项', () => {
    const { catalog } = fresh()
    const n = catalog.loadMock()
    eq(n, 5)
    eq(catalog.candidates.length, 5)
    assert(catalog.selectedId !== null, '应自动选中')
    eq(catalog.selected?.id, catalog.selectedId)
  })

  it('导入 CSV 会替换列表', () => {
    const { catalog } = fresh()
    const res = catalog.importCsv([
      {
        name: 'Test Item',
        cost: '5',
        competitorPriceAvg: '20',
        competitorCount: '2',
        competitorReviewTotal: '1000',
      },
    ])
    eq(res.candidates.length, 1)
    eq(catalog.candidates.length, 1)
    eq(catalog.candidates[0].competitors.length, 2)
  })

  it('删除后选中项不会悬空', () => {
    const { catalog } = fresh()
    catalog.loadMock()
    const first = catalog.selectedId
    catalog.removeCandidate(first!)
    assert(catalog.selectedId !== first, '选中项应切换')
    assert(
      catalog.candidates.some(c => c.id === catalog.selectedId),
      '选中项应仍存在于列表中',
    )
  })

  it('状态与标签变更生效', () => {
    const { catalog } = fresh()
    catalog.loadMock()
    catalog.patchCandidate('p1', { status: 'rejected', tags: ['季节性'] })
    eq(catalog.candidates.find(c => c.id === 'p1')!.status, 'rejected')
    eq(catalog.activeCandidates.length, 4)
  })
})

describe('Store · Agent 执行', () => {
  it('打分后所有候选品都有评分', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    const out = await catalog.run('给所有候选品打分')
    assert(out !== null, '应有输出')
    eq(out!.action, 'score')
    assert(
      catalog.candidates.every(c => c.scores && c.scores.length === 5),
      '所有候选品都应有五维评分',
    )
  })

  it('评分重排后选中项仍指向同一商品（回归 bug）', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    catalog.select('p5')
    await catalog.run('给所有候选品打分')
    eq(catalog.selectedId, 'p5')
    eq(catalog.selected?.name, 'No-Data Sample (空数据样例)')
  })

  it('点名问某个品时选中项会切到该品（回归：焦点不跟随）', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    catalog.select('p3')
    const out = await catalog.run('帮我看看第一个品值不值得做')
    eq(out!.action, 'score')
    eq(catalog.selectedId, 'p1', '选中项应跟随用户点名的商品')
    eq(catalog.selected?.id, 'p1')
  })

  it('淘汰指令会真正改到数据', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    await catalog.run('把台灯淘汰掉')
    eq(catalog.candidates.find(c => c.id === 'p1')!.status, 'rejected')
  })

  it('打标签指令会追加标签', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    await catalog.run('给台灯打个旺季标签')
    const p1 = catalog.candidates.find(c => c.id === 'p1')!
    assert(p1.tags.length > 0, '应有标签')
  })

  it('历史记录被保留且有上限', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    for (let i = 0; i < 25; i++) await catalog.run('给所有候选品打分')
    assert(catalog.history.length <= 20, `历史应被截断，实际 ${catalog.history.length}`)
    assert(catalog.lastOutput !== null, '应有最近一次输出')
  })

  it('候选品为空时给出错误而不是崩溃', async () => {
    const { catalog } = fresh()
    catalog.reset()
    const out = await catalog.run('给所有候选品打分')
    eq(out, null)
    eq(catalog.lastError, '请先载入候选品')
  })
})

describe('Store · 复盘快照', () => {
  it('保存快照后可回填实际表现', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    await catalog.run('给所有候选品打分')
    const snap = catalog.saveSnapshot('p1', 'default')
    assert(snap !== null, '应能保存快照')
    const id = snap!.id
    catalog.fillActual('p1', id, { monthlySales: 1200, rating: 4.4, note: '表现符合预期' })
    const saved = catalog.candidates.find(c => c.id === 'p1')!.snapshots!.find(s => s.id === id)!
    eq(saved.actual?.monthlySales, 1200)
    eq(saved.actual?.rating, 4.4)
  })

  it('没有评分结果时无法保存快照', () => {
    const { catalog } = fresh()
    catalog.loadMock()
    eq(catalog.saveSnapshot('p1', 'default'), null)
  })
})

describe('Store · 设置与持久化', () => {
  it('切换预设会替换整套规则', () => {
    const { settings } = fresh()
    settings.applyPreset('aggressive')
    eq(settings.rules.id, 'aggressive')
    settings.reset()
    eq(settings.rules.id, 'default')
  })

  it('规则变更会写入 localStorage', async () => {
    const { settings } = fresh()
    settings.applyPreset('conservative')
    await new Promise(r => setTimeout(r, 0))
    assert(
      localStorage.getItem('crosspick.settings.v1') !== null,
      '设置应被持久化',
    )
  })

  it('重新创建 store 时从 localStorage 恢复', () => {
    const { catalog } = fresh()
    catalog.loadMock()
    const before = catalog.candidates.length
    const { catalog: restored } = fresh()
    eq(restored.candidates.length, before)
  })

  it('清空历史会同时清掉会话记忆', async () => {
    const { catalog } = fresh()
    catalog.loadMock()
    await catalog.run('给所有候选品打分')
    assert(catalog.memory.turns.length > 0, '应有会话记录')
    catalog.clearHistory()
    eq(catalog.memory.turns.length, 0)
    eq(catalog.history.length, 0)
  })
})
