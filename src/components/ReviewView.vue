<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { useCatalogStore } from '@/stores/catalog'
import { useSettingsStore } from '@/stores/settings'
import { DIMENSIONS, DIMENSION_LABELS } from '@/types/product'
import { cloneRules } from '@/domain/rules'
import {
  collectSamples,
  fitAndReport,
  MIN_SAMPLES,
  type FitReport,
} from '@/domain/learning'
import SnapshotPanel from '@/components/SnapshotPanel.vue'

const emit = defineEmits<{ (e: 'navigate', v: 'catalog'): void }>()

const catalog = useCatalogStore()
const settings = useSettingsStore()
const { candidates, selectedId, selected } = storeToRefs(catalog)

const candidateOptions = computed(() =>
  candidates.value.map(c => ({ value: c.id, label: c.name })),
)

function save() {
  if (selected.value) catalog.saveSnapshot(selected.value.id, settings.rules.id)
}
function fill(snapshotId: string, actual: { monthlySales?: number; rating?: number; note?: string }) {
  if (selected.value) catalog.fillActual(selected.value.id, snapshotId, actual)
}

// —— 从复盘学习：把"预测分 vs 实际表现"拟合为新权重 ——
const report = ref<FitReport | null>(null)
const sampleCount = computed(() => collectSamples(candidates.value).length)
const canLearn = computed(() => sampleCount.value >= MIN_SAMPLES)

function learn() {
  const samples = collectSamples(candidates.value)
  const rep = fitAndReport(samples, settings.rules, `学习规则 #${settings.learnedRules.length + 1}`)
  if (!rep) {
    ElMessage.warning(`有效样本不足（需 ≥ ${MIN_SAMPLES} 条），先多回填几条实际表现`)
    return
  }
  const learned = cloneRules(settings.rules)
  learned.id = `learned-${Date.now()}`
  learned.name = rep.name
  learned.weights = { ...rep.weights }
  settings.addLearnedRules(learned)
  settings.applyRules(learned)
  catalog.rescore(settings.rules)
  report.value = rep
  ElMessage.success(`已生成并启用 ${rep.name}`)
}
</script>

<template>
  <div class="rv">
    <section class="cp-card learn">
      <div class="cp-card-head">
        <div>
          <span class="t">从复盘学习</span>
          <span class="s">用已回填实际表现的快照，拟合更准的维度权重（只学参数，不换引擎）</span>
        </div>
      </div>
      <div class="cp-card-body">
        <p class="hint">
          已采集 <b>{{ sampleCount }}</b> 条有效样本（需 ≥ {{ MIN_SAMPLES }} 条方可学习）。
          学习产物是一套独立规则预设，可随时在「规则与模型」里切回默认。
        </p>

        <div v-if="report" class="result">
          <div class="res-title">
            上次结果：{{ report.name }}
            <el-tag size="small" :type="report.improved ? 'success' : 'warning'">
              {{ report.improved ? `预测误差下降 ${report.dropPct}%` : `误差上升 ${Math.abs(report.dropPct)}%（样本或偏噪，谨慎采用）` }}
            </el-tag>
          </div>
          <div class="weights">
            <div v-for="d in DIMENSIONS" :key="d" class="w">
              <span>{{ DIMENSION_LABELS[d] }}</span>
              <b>{{ report.weights[d] }}</b>
            </div>
          </div>
        </div>

        <el-button
          type="primary"
          :disabled="!canLearn"
          @click="learn"
        >
          学习为新规则
        </el-button>
        <el-button v-if="!canLearn" text @click="emit('navigate', 'catalog')">
          去回填实际表现
        </el-button>
      </div>
    </section>

    <section class="cp-card">
      <div class="cp-card-head">
        <div>
          <span class="t">决策复盘</span>
          <span class="s">把评分固化为快照，事后回填实际表现验证判断</span>
        </div>
        <el-select
          v-model="selectedId"
          placeholder="选择商品"
          size="small"
          class="picker"
          filterable
        >
          <el-option v-for="o in candidateOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>

      <div class="cp-card-body">
        <SnapshotPanel
          v-if="selected"
          :candidate="selected"
          :rule-id="settings.rules.id"
          @save="save"
          @fill="fill"
        />
        <el-empty v-else description="请先在上方选择一个候选品" :image-size="90">
          <el-button size="small" type="primary" @click="emit('navigate', 'catalog')">
            去候选品库
          </el-button>
        </el-empty>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rv { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.picker { width: 220px; }
.hint { font-size: 13px; color: var(--cp-text-2); margin: 0 0 14px; line-height: 1.6; }
.hint b { color: var(--cp-brand); }
.result {
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  background: var(--cp-surface-2);
  padding: 12px 14px;
  margin-bottom: 14px;
}
.res-title { font-size: 13px; font-weight: 600; color: var(--cp-text); margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
.weights { display: flex; flex-wrap: wrap; gap: 14px; }
.w { font-size: 13px; color: var(--cp-text-2); display: flex; align-items: center; gap: 6px; }
.w b { color: var(--cp-text); }
</style>
