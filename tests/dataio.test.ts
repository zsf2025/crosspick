import { describe, it, assert, eq } from './harness'

// localStorage 由 tests/index.ts 统一注入为内存 shim

const { createPinia, setActivePinia } = await import('pinia')
const { useCatalogStore } = await import('@/stores/catalog')
const { useSettingsStore } = await import('@/stores/settings')
const { buildBackup, applyBackup } = await import('@/stores/dataio')

function fresh() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return { catalog: useCatalogStore(), settings: useSettingsStore() }
}

describe('数据备份/导入', () => {
  it('导出再导入可完整恢复候选品与设置', () => {
    const { catalog, settings } = fresh()
    catalog.loadMock()
    settings.applyPreset('aggressive')
    settings.learning = { salesTarget: 500, goodRating: 4.2 }

    const backup = buildBackup()
    eq(backup.catalog.candidates.length, 5)
    eq(backup.app, 'crosspick')
    eq(backup.settings.rules.id, 'aggressive')
    eq(backup.settings.learning.salesTarget, 500)

    // 覆盖当前数据后再导入恢复
    const { catalog: c2, settings: s2 } = fresh()
    c2.reset()
    s2.reset()
    eq(c2.candidates.length, 0)
    eq(s2.rules.id, 'default')

    const res = applyBackup(backup)
    assert(res.ok, '导入应成功')
    eq(c2.candidates.length, 5)
    eq(s2.rules.id, 'aggressive')
    eq(s2.learning.salesTarget, 500)
  })

  it('拒绝非 CrossPick 文件', () => {
    const { catalog } = fresh()
    catalog.reset()
    const res = applyBackup({ app: 'other', catalog: { candidates: [] }, settings: {} })
    assert(!res.ok, '应拒绝')
    eq(catalog.candidates.length, 0)
  })

  it('拒绝损坏/非对象输入', () => {
    const { catalog } = fresh()
    catalog.reset()
    eq(applyBackup(null).ok, false)
    eq(applyBackup('not-json').ok, false)
    eq(catalog.candidates.length, 0)
  })

  it('导入会按当前规则重算分数', () => {
    const { catalog } = fresh()
    catalog.loadMock()
    const backup = buildBackup()
    const { catalog: c2 } = fresh()
    c2.reset()
    applyBackup(backup)
    assert(
      c2.candidates.every(c => c.scores && c.scores.length === 5),
      '导入后每个候选品都应有五维评分',
    )
  })
})
