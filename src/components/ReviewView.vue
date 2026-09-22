<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useSettingsStore } from '@/stores/settings'
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
</script>

<template>
  <div class="rv">
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
.rv { max-width: 880px; margin: 0 auto; }
.picker { width: 220px; }
</style>
