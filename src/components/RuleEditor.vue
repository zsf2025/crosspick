<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ScoringRules } from '@/domain/rules'
import { RULE_PRESETS, cloneRules } from '@/domain/rules'
import { DIMENSIONS, DIMENSION_LABELS } from '@/types/product'
import { useSettingsStore } from '@/stores/settings'
import HelpTip from '@/components/HelpTip.vue'

const props = defineProps<{ rules: ScoringRules }>()
const emit = defineEmits<{ (e: 'update', rules: ScoringRules): void }>()

const settings = useSettingsStore()
/** 内置预设 + 从复盘学习出的规则，统一作为可切换预设展示 */
const presets = computed<ScoringRules[]>(() => [...RULE_PRESETS, ...settings.learnedRules])

const newKeyword = ref('')

/** 各评分维度的含义，供悬浮提示逐项解释 */
const DIM_TIPS: Record<string, string> = {
  market: '市场容量维度：按竞品评论总数估算盘子大小，越大越值得进入。',
  competition: '竞争强度维度：竞品越多越成熟，对抗越激烈，得分越低。',
  differentiation: '差异化维度：相对竞品能讲清的卖点，痛点越具体得分越高。',
  trend: '趋势热度维度：评论 / Listing 命中趋势词越多，得分越高。',
  margin: '利润空间维度：估算毛利率，越厚抗风险能力越强。',
}

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
  const p = presets.value.find(x => x.id === key)
  if (p) emit('update', cloneRules(p))
}
</script>

<template>
  <div class="editor">
    <div class="block">
      <div class="title">预设<HelpTip tip="内置三套默认规则，外加从复盘学习出的规则。切换预设会整体替换下方参数，可随时切回默认。" /></div>
      <el-radio-group :model-value="rules.id" @change="applyPreset">
        <el-radio-button v-for="p in presets" :key="p.id" :value="p.id">
          {{ p.name }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="block">
      <div class="title">维度权重<HelpTip tip="5 个维度在总分里的相对重要性（0–5）。权重越大，该维度对最终得分影响越强。建议合计保持合理比例，学习产物会自动调整这些值。" /></div>
      <div class="weights">
        <div v-for="d in DIMENSIONS" :key="d" class="weight">
          <span>{{ DIMENSION_LABELS[d] }}<HelpTip :tip="DIM_TIPS[d]" /></span>
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
      <div class="title">竞争强度参数<HelpTip tip="竞争维度的基础分，以及每个竞品、每单位评分带来的扣分。竞品越多、评分越高，竞争维度得分越低。" /></div>
      <div class="weights">
        <div class="weight">
          <span>基准分<HelpTip tip="竞争维度的起始分（中性起点）。值越高代表默认竞争越不激烈，通常 100 为中性。" /></span>
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
          <span>每个竞品扣分<HelpTip tip="竞品列表里每增加一个竞品，竞争维度扣的分。竞品越多，竞争越激烈、得分越低。" /></span>
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
          <span>评分系数<HelpTip tip="竞品平均评分对扣分的放大倍数。竞品评分越高（越成熟），相对竞争力越弱，扣分越多。" /></span>
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
      <div class="title">差异化参数<HelpTip tip="差异化维度的基础分，以及挖掘出的每条用户痛点带来的加分。痛点越具体，差异化得分越高。" /></div>
      <div class="weights">
        <div class="weight">
          <span>基础分<HelpTip tip="差异化维度的起始分。挖掘不到明确痛点时给的基础分。" /></span>
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
          <span>每条痛点加分<HelpTip tip="从评论 / 调研中挖掘出的每条具体用户痛点带来的加分。痛点越具体，差异化越突出、得分越高。" /></span>
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
      <div class="title">趋势词（命中即加分）<HelpTip tip="在评论/Listing 中命中这些词即视为有趋势热度，加趋势基础分并按命中数累加。按你的类目补充热词。" /></div>
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
          <span>趋势基础分<HelpTip tip="命中任一趋势词后给的基础分，代表有基本热度。" /></span>
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
          <span>每命中加分<HelpTip tip="评论 / Listing 中每多命中一个趋势词额外加的分，命中越多热度越高。" /></span>
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
      <div class="title">市场容量档位（评论总数 ≥ 阈值时取分）<HelpTip tip="按竞品评论总数划分市场容量等级：评论越多代表盘子越大。达到对应阈值即取该档得分，最后一行是兜底分。" placement="top-start" /></div>
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
      <div class="title">利润空间档位（毛利率 ≥ 阈值时取分）<HelpTip tip="按估算毛利率划分利润等级：毛利率越高得分越高。阈值用 0–1 小数（如 0.4 表示 40%），最后一行是兜底分。" placement="top-start" /></div>
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
