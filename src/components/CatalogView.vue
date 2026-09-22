<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import Papa from 'papaparse'
import { useCatalogStore } from '@/stores/catalog'
import { CSV_TEMPLATE_WIDE } from '@/adapters/csv'
import { DIMENSION_LABELS, STATUS_LABELS } from '@/types/product'
import type { CandidateStatus, ProductCandidate, ScoreRow } from '@/types/product'
import ScoreRadar from '@/components/ScoreRadar.vue'

const catalog = useCatalogStore()
const { candidates, selectedId, selected } = storeToRefs(catalog)

const fileInput = ref<HTMLInputElement | null>(null)

function loadMock() {
  const n = catalog.loadMock()
  ElMessage.success(`已载入 ${n} 个候选品`)
}

function onFile(file: File) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: res => {
      const parsed = catalog.importCsv(res.data as Record<string, string>[])
      if (!parsed.candidates.length) {
        return ElMessage.warning(parsed.warnings[0] || '未解析到有效数据，请检查表头')
      }
      ElMessage.success(`已导入 ${parsed.candidates.length} 个候选品（${parsed.mode === 'long' ? '长表' : '宽表'}）`)
      for (const w of parsed.warnings) ElMessage.warning(w)
    },
    error: () => ElMessage.error('CSV 解析失败'),
  })
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE_WIDE], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'crosspick-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function setStatus(id: string, status: 'active' | 'watching' | 'rejected') {
  catalog.patchCandidate(id, { status })
}
function remove(id: string) {
  catalog.removeCandidate(id)
}

const statusTagType = (s: CandidateStatus): 'success' | 'warning' | 'info' =>
  s === 'active' ? 'success' : s === 'watching' ? 'warning' : 'info'
function statusLabel(s: CandidateStatus) {
  return STATUS_LABELS[s]
}
function negativeInsights(row: unknown): { painPoint: string }[] {
  const c = row as ProductCandidate
  return (c?.reviewInsights ?? []).filter(i => i.sentiment === 'negative').slice(0, 2)
}

const totalScored = computed(() => candidates.value.filter(c => c.totalScore != null).length)

/** 侧栏分数条宽度：无数据时归零，避免出现 0 分被画成满条 */
function barWidth(s: ScoreRow) {
  if (!s.available) return '0%'
  return `${Math.max(3, Math.min(100, s.score))}%`
}
function scoreLevel(v?: number | null) {
  if (v === null || v === undefined) return ''
  return v >= 70 ? 'good' : v >= 50 ? 'mid' : 'low'
}
</script>

<template>
  <div class="cat">
    <section class="cp-card">
      <div class="cp-card-head">
        <div>
          <span class="t">候选品库</span>
          <span class="s">{{ candidates.length }} 个商品 · {{ totalScored }} 个已评分</span>
        </div>
        <div class="actions">
          <el-button size="small" @click="loadMock">载入 Mock</el-button>
          <el-button size="small" type="primary" @click="fileInput?.click()">导入 CSV</el-button>
          <input
            ref="fileInput"
            type="file"
            accept=".csv"
            hidden
            @change="e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onFile(f); (e.target as HTMLInputElement).value = '' }"
          />
          <el-button size="small" text @click="downloadTemplate">下载模板</el-button>
        </div>
      </div>

      <div class="cat-body">
        <div class="grid">
          <div class="grid-main">
            <el-table
              v-if="candidates.length"
              :data="candidates"
              border
              stripe
              size="small"
              highlight-current-row
              :current-row-key="selectedId ?? ''"
              row-key="id"
              class="cat-table"
              @row-click="row => catalog.select(row.id)"
            >
              <el-table-column prop="name" label="商品" min-width="180" show-overflow-tooltip />
              <el-table-column prop="category" label="类目" width="110" />
              <el-table-column label="成本" width="78" align="right">
                <template #default="{ row }">${{ row.cost }}</template>
              </el-table-column>
              <el-table-column label="状态" width="84" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="标签" width="130">
                <template #default="{ row }">
                  <el-tag v-for="t in row.tags" :key="t" size="small" class="gap">{{ t }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="总分" width="76" align="center">
                <template #default="{ row }">
                  <el-tag
                    v-if="row.totalScore !== null && row.totalScore !== undefined"
                    size="small"
                    :type="row.totalScore >= 70 ? 'success' : row.totalScore >= 50 ? 'warning' : 'danger'"
                  >
                    {{ row.totalScore }}
                  </el-tag>
                  <span v-else class="na">N/A</span>
                </template>
              </el-table-column>
              <el-table-column label="痛点" min-width="160">
                <template #default="{ row }">
                  <el-tag
                    v-for="p in negativeInsights(row)"
                    :key="p.painPoint"
                    size="small"
                    type="danger"
                    class="gap"
                  >
                    {{ p.painPoint }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="148" align="center" fixed="right">
                <template #default="{ row }">
                  <div class="row-acts">
                    <button
                      class="act"
                      type="button"
                      :disabled="row.status === 'watching'"
                      @click.stop="setStatus(row.id, 'watching')"
                    >
                      观察
                    </button>
                    <button
                      class="act is-danger"
                      type="button"
                      :disabled="row.status === 'rejected'"
                      @click.stop="setStatus(row.id, 'rejected')"
                    >
                      淘汰
                    </button>
                    <button class="act is-muted" type="button" @click.stop="remove(row.id)">删除</button>
                  </div>
                </template>
              </el-table-column>
            </el-table>

            <el-empty v-else description="暂无候选品，点击「载入 Mock」或「导入 CSV」开始" :image-size="90" />
          </div>

          <aside class="grid-side">
            <template v-if="selected">
              <div class="side-head">
                <div class="side-head-main">
                  <div class="side-title">{{ selected.name }}</div>
                  <div class="side-sub">{{ selected.category }} · 成本 ${{ selected.cost }}</div>
                </div>
                <span
                  v-if="selected.totalScore !== null && selected.totalScore !== undefined"
                  class="side-total"
                  :class="scoreLevel(selected.totalScore)"
                >
                  {{ selected.totalScore }}
                </span>
              </div>

              <template v-if="selected.scores?.length">
                <ScoreRadar :scores="selected.scores" />
                <div class="score-rows">
                  <div v-for="s in selected.scores" :key="s.dimension" class="score-row">
                    <span class="dim">{{ DIMENSION_LABELS[s.dimension] }}</span>
                    <span class="bar"><i :class="{ off: !s.available }" :style="{ width: barWidth(s) }"></i></span>
                    <span class="val" :class="{ na: !s.available }">
                      {{ s.available ? s.score : 'N/A' }}
                    </span>
                  </div>
                </div>
                <div class="side-note">评分依据：竞争品评论量 / 均价 / 毛利率 / 搜索趋势</div>
              </template>

              <div v-else class="side-empty">
                该商品尚未评分，去
                <b>选品工作台</b>
                让它跑一次打分。
              </div>
            </template>

            <el-empty v-else description="选中一个商品查看五维评分" :image-size="80" />
          </aside>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cat { max-width: 1180px; margin: 0 auto; }
.actions { display: flex; gap: 8px; align-items: center; }
.cat-body { padding: 8px 16px 16px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.grid-main { min-width: 0; }

/* —— 表格 —— */
.cat-table {
  --el-table-border-color: var(--cp-border);
  --el-table-row-hover-bg-color: #f7f9fc;
}
.cat-table :deep(.el-table__header th.el-table__cell) {
  background: var(--cp-surface-2);
  color: var(--cp-text-2);
  font-weight: 600;
}
.cat-table :deep(.el-table__cell) { padding: 9px 0; }
.cat-table :deep(.el-table__row) { cursor: pointer; }
.cat-table :deep(.el-table__row--striped td.el-table__cell) { background: #fafbfd; }
.cat-table :deep(.el-table__body tr.current-row > td.el-table__cell) { background: var(--cp-brand-soft); }

/* 操作列：自绘紧凑按钮组，避免 el-button 自带 12px 外边距把「删除」挤到第二行 */
.row-acts { display: flex; align-items: center; justify-content: center; gap: 2px; white-space: nowrap; }
.act {
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  color: var(--cp-text-2);
  padding: 5px 7px;
  border-radius: 6px;
  cursor: pointer;
  transition: 0.16s;
}
.act:hover:not(:disabled) { background: #eef1f6; color: var(--cp-text); }
.act.is-danger { color: var(--cp-danger); }
.act.is-danger:hover:not(:disabled) { background: #fef0f0; }
.act.is-muted { color: var(--cp-text-3); }
.act:disabled { opacity: 0.4; cursor: not-allowed; }

.gap { margin-right: 4px; margin-bottom: 2px; }
.na { color: var(--cp-text-3); font-size: 12px; }

/* —— 侧栏评分 —— */
.grid-side {
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  padding: 14px;
  position: sticky;
  top: 16px;
}
.side-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 4px; }
.side-head-main { min-width: 0; flex: 1; }
.side-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side-sub { font-size: 11px; color: var(--cp-text-3); margin-top: 5px; line-height: 1.4; }
.side-total {
  flex: 0 0 auto;
  min-width: 34px;
  height: 24px;
  padding: 0 7px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.side-total.good { background: rgba(0, 180, 42, 0.12); color: #00891f; }
.side-total.mid { background: rgba(255, 125, 0, 0.14); color: #d9660a; }
.side-total.low { background: rgba(245, 63, 63, 0.12); color: #d32020; }

.score-rows { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; }
.score-row {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 3px 0;
}
.dim { color: var(--cp-text-2); }
.bar { height: 6px; border-radius: 999px; background: #eaeef4; overflow: hidden; }
.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--cp-brand-grad);
  transition: width 0.35s ease;
}
.bar i.off { background: #dfe3ea; }
.val {
  text-align: right;
  font-weight: 600;
  color: var(--cp-text);
  font-variant-numeric: tabular-nums;
}
.val.na { font-weight: 500; color: var(--cp-text-3); }

.side-note { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--cp-border); font-size: 11px; color: var(--cp-text-3); line-height: 1.6; }
.side-empty { padding: 18px 4px; text-align: center; font-size: 12px; color: var(--cp-text-3); line-height: 1.7; }
.side-empty b { color: var(--cp-brand-dark); }

@media (max-width: 980px) {
  .grid { grid-template-columns: 1fr; }
  .grid-side { position: static; }
}
</style>
