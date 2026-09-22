<script setup lang="ts">
import { ref } from 'vue'
import type { ProductCandidate } from '@/types/product'

const props = defineProps<{ candidate: ProductCandidate; ruleId: string }>()
const emit = defineEmits<{
  (e: 'save'): void
  (e: 'fill', snapshotId: string, actual: { monthlySales?: number; rating?: number; note?: string }): void
}>()

const activeId = ref<string | null>(null)
const form = ref<{ monthlySales?: number; rating?: number; note?: string }>({})

function open(snapshotId: string) {
  activeId.value = activeId.value === snapshotId ? null : snapshotId
  form.value = {}
}

function submit(snapshotId: string) {
  emit('fill', snapshotId, { ...form.value })
  activeId.value = null
  form.value = {}
}

const date = (iso: string) => iso.slice(0, 10)
</script>

<template>
  <div>
    <div class="head">
      <span class="name">复盘 · {{ candidate.name }}</span>
      <el-button size="small" @click="emit('save')" :disabled="!candidate.scores">
        保存当前评分为快照
      </el-button>
    </div>

    <el-empty v-if="!candidate.snapshots?.length" description="还没有快照" :image-size="60" />

    <div v-else class="list">
      <div v-for="s in candidate.snapshots" :key="s.id" class="item">
        <div class="line">
          <span class="d">{{ date(s.createdAt) }}</span>
          <el-tag size="small" :type="s.totalScore === null ? 'info' : s.totalScore >= 70 ? 'success' : 'warning'">
            {{ s.totalScore === null ? 'N/A' : s.totalScore }}
          </el-tag>
          <span class="rule">规则 {{ s.ruleId }}</span>
          <el-link type="primary" :underline="false" @click="open(s.id)">
            {{ activeId === s.id ? '收起' : s.actual ? '修改实际表现' : '回填实际表现' }}
          </el-link>
        </div>
        <div v-if="s.actual" class="actual">
          实际月销 {{ s.actual.monthlySales ?? '—' }} · 评分 {{ s.actual.rating ?? '—' }}
          <span v-if="s.actual.note"> · {{ s.actual.note }}</span>
        </div>
        <div v-if="activeId === s.id" class="form">
          <el-input-number v-model="form.monthlySales" :min="0" size="small" placeholder="月销" controls-position="right" />
          <el-input-number v-model="form.rating" :min="0" :max="5" :step="0.1" size="small" placeholder="评分" controls-position="right" />
          <el-input v-model="form.note" size="small" placeholder="备注" style="width: 180px" />
          <el-button size="small" type="primary" @click="submit(s.id)">保存</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.name { font-size: 14px; font-weight: 600; color: var(--cp-text); }
.list { display: flex; flex-direction: column; gap: 12px; }
.item {
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  padding: 12px 14px;
  background: var(--cp-surface-2);
  transition: 0.18s;
}
.item:hover { border-color: var(--cp-border-strong); box-shadow: var(--cp-shadow-sm); }
.line { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.d { color: var(--cp-text-3); }
.rule { color: #c0c4cc; font-size: 12px; }
.actual { margin-top: 8px; font-size: 12px; color: var(--cp-success); }
.form { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
</style>
