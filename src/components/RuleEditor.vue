<script setup lang="ts">
import { ref } from 'vue'
import type { ScoringRules } from '@/domain/rules'
import { RULE_PRESETS, cloneRules } from '@/domain/rules'
import { DIMENSIONS, DIMENSION_LABELS } from '@/types/product'

const props = defineProps<{ rules: ScoringRules }>()
const emit = defineEmits<{ (e: 'update', rules: ScoringRules): void }>()

const newKeyword = ref('')

function patch(fn: (r: ScoringRules) => void) {
  const next = cloneRules(props.rules)
  fn(next)
  emit('update', next)
}

function setWeight(d: (typeof DIMENSIONS)[number], v: number | undefined) {
  patch(r => {
    r.weights[d] = Number.isFinite(v) ? Math.max(0, v as number) : 0
  })
}

function addKeyword() {
  const k = newKeyword.value.trim()
  if (!k) return
  patch(r => {
    if (!r.trend.keywords.includes(k)) r.trend.keywords.push(k)
  })
  newKeyword.value = ''
}

function removeKeyword(k: string) {
  patch(r => {
    r.trend.keywords = r.trend.keywords.filter(x => x !== k)
  })
}

function applyPreset(id: unknown) {
  const key = typeof id === 'string' ? id : String(id ?? '')
  const p = RULE_PRESETS.find(x => x.id === key)
  if (p) emit('update', cloneRules(p))
}
</script>

<template>
  <div class="editor">
    <div class="block">
      <div class="title">预设</div>
      <el-radio-group :model-value="rules.id" @change="applyPreset">
        <el-radio-button v-for="p in RULE_PRESETS" :key="p.id" :value="p.id">
          {{ p.name }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="block">
      <div class="title">维度权重</div>
      <div class="weights">
        <div v-for="d in DIMENSIONS" :key="d" class="weight">
          <span>{{ DIMENSION_LABELS[d] }}</span>
          <el-input-number
            :model-value="rules.weights[d]"
            :min="0"
            :max="5"
            :step="0.5"
            size="small"
            controls-position="right"
            @update:model-value="v => setWeight(d, v)"
          />
        </div>
      </div>
    </div>

    <div class="block">
      <div class="title">竞争强度参数</div>
      <div class="weights">
        <div class="weight">
          <span>基准分</span>
          <el-input-number
            :model-value="rules.competition.base"
            :min="0"
            :max="200"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.competition.base = v ?? 100))"
          />
        </div>
        <div class="weight">
          <span>每个竞品扣分</span>
          <el-input-number
            :model-value="rules.competition.perCompetitor"
            :min="0"
            :max="50"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.competition.perCompetitor = v ?? 10))"
          />
        </div>
        <div class="weight">
          <span>评分系数</span>
          <el-input-number
            :model-value="rules.competition.ratingFactor"
            :min="0"
            :max="50"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.competition.ratingFactor = v ?? 20))"
          />
        </div>
      </div>
    </div>

    <div class="block">
      <div class="title">差异化参数</div>
      <div class="weights">
        <div class="weight">
          <span>基础分</span>
          <el-input-number
            :model-value="rules.differentiation.base"
            :min="0"
            :max="100"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.differentiation.base = v ?? 20))"
          />
        </div>
        <div class="weight">
          <span>每条痛点加分</span>
          <el-input-number
            :model-value="rules.differentiation.perPainPoint"
            :min="0"
            :max="50"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.differentiation.perPainPoint = v ?? 25))"
          />
        </div>
      </div>
    </div>

    <div class="block">
      <div class="title">趋势词（命中即加分）</div>
      <div class="kws">
        <el-tag
          v-for="k in rules.trend.keywords"
          :key="k"
          closable
          size="small"
          @close="removeKeyword(k)"
        >
          {{ k }}
        </el-tag>
        <el-input
          v-model="newKeyword"
          size="small"
          placeholder="添加趋势词"
          style="width: 140px"
          @keyup.enter="addKeyword"
        />
      </div>
      <div class="weights">
        <div class="weight">
          <span>趋势基础分</span>
          <el-input-number
            :model-value="rules.trend.base"
            :min="0"
            :max="100"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.trend.base = v ?? 50))"
          />
        </div>
        <div class="weight">
          <span>每命中加分</span>
          <el-input-number
            :model-value="rules.trend.perHit"
            :min="0"
            :max="50"
            size="small"
            controls-position="right"
            @update:model-value="v => patch(r => (r.trend.perHit = v ?? 15))"
          />
        </div>
      </div>
    </div>

    <div class="block">
      <div class="title">市场容量档位（评论总数 ≥ 阈值时取分）</div>
      <el-table :data="rules.market.tiers" size="small" border>
        <el-table-column label="阈值" width="140">
          <template #default="{ row, $index }">
            <el-input-number
              v-if="$index < rules.market.tiers.length - 1"
              :model-value="row.at"
              :min="0"
              :step="1000"
              size="small"
              controls-position="right"
              @update:model-value="v => patch(r => (r.market.tiers[$index].at = v ?? 0))"
            />
            <span v-else>兜底</span>
          </template>
        </el-table-column>
        <el-table-column label="得分">
          <template #default="{ row, $index }">
            <el-input-number
              :model-value="row.score"
              :min="0"
              :max="100"
              size="small"
              controls-position="right"
              @update:model-value="v => patch(r => (r.market.tiers[$index].score = v ?? 0))"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="block">
      <div class="title">利润空间档位（毛利率 ≥ 阈值时取分）</div>
      <el-table :data="rules.margin.tiers" size="small" border>
        <el-table-column label="阈值" width="140">
          <template #default="{ row, $index }">
            <el-input-number
              v-if="Number.isFinite(row.at)"
              :model-value="row.at"
              :min="-1"
              :max="1"
              :step="0.1"
              size="small"
              controls-position="right"
              @update:model-value="v => patch(r => (r.margin.tiers[$index].at = v ?? 0))"
            />
            <span v-else>兜底</span>
          </template>
        </el-table-column>
        <el-table-column label="得分">
          <template #default="{ row, $index }">
            <el-input-number
              :model-value="row.score"
              :min="0"
              :max="100"
              size="small"
              controls-position="right"
              @update:model-value="v => patch(r => (r.margin.tiers[$index].score = v ?? 0))"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; gap: 16px; }
.block {
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  padding: 14px 16px;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cp-text);
  margin-bottom: 12px;
  padding-left: 10px;
  border-left: 3px solid var(--cp-brand);
  line-height: 1;
}
.weights { display: flex; flex-wrap: wrap; gap: 14px; }
.weight { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--cp-text-2); }
.kws { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; align-items: center; }
</style>
