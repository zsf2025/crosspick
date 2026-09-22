<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { useCatalogStore } from '@/stores/catalog'
import PriceCurve from '@/components/PriceCurve.vue'
import TracePanel from '@/components/TracePanel.vue'
import CompareTable from '@/components/CompareTable.vue'
import ReportView from '@/components/ReportView.vue'

const emit = defineEmits<{ (e: 'navigate', v: 'catalog' | 'review' | 'settings'): void }>()

const catalog = useCatalogStore()
const { candidates, history, lastOutput, loading } = storeToRefs(catalog)

const query = ref('')
const streaming = ref('')
const streamingSummary = ref('')
const activeTab = ref('chat')

const ICON = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4-4"/></svg>',
  spark:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.85 5.4 5.4 1.85-5.4 1.85L12 17l-1.85-5.4-5.4-1.85 5.4-1.85L12 2.5z"/><path d="M18.6 15.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" opacity=".85"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/></svg>',
}

const EXAMPLES = [
  '给所有候选品打分',
  '给台灯定价',
  '分析台灯的评论痛点',
  '对比这几个候选品',
  '生成选品报告',
  '把台灯淘汰掉',
]

const ACTION_LABEL: Record<string, string> = {
  score: '评分',
  price: '定价',
  review: '评论洞察',
  compare: '对比',
  report: '报告',
  mutate: '变更',
  clarify: '澄清',
}
const actionLabel = computed(() => (lastOutput.value ? ACTION_LABEL[lastOutput.value.action] ?? lastOutput.value.action : ''))
const routeLabel = computed(() =>
  lastOutput.value
    ? lastOutput.value.routedBy === 'rule'
      ? '规则路由'
      : lastOutput.value.routedBy === 'llm'
        ? '模型路由'
        : '降级'
    : '',
)

/** 执行中显示流式总结，执行完显示落库的那句；两者不会同时出现 */
const summaryText = computed(() =>
  loading.value ? streamingSummary.value : lastOutput.value?.summary ?? '',
)

type JumpType = 'primary' | 'success' | 'warning' | 'danger' | 'info'
interface JumpItem {
  name: string
  label: string
  hint: string
  type: JumpType
}

/** 本轮产出的明细面板，用快捷入口代替自动跳转，确保能看到 Agent 结论与模型总结 */
const detailTabs = computed<JumpItem[]>(() => {
  const out = lastOutput.value
  if (!out) return []
  const list: JumpItem[] = []
  if (out.review) {
    list.push({
      name: 'review',
      label: '评论洞察',
      hint: `${out.review.painPoints.length} 条痛点 · ${out.review.suggestions.length} 条建议`,
      type: 'danger',
    })
  }
  if (out.pricing) {
    list.push({
      name: 'price',
      label: '定价模拟',
      hint: `建议售价 $${out.pricing.suggestedPrice.toFixed(2)}`,
      type: 'warning',
    })
  }
  if (out.comparison) {
    list.push({
      name: 'compare',
      label: '横向对比',
      hint: `${out.comparison.rows.length} 个候选品`,
      type: 'primary',
    })
  }
  if (out.report?.length) {
    list.push({
      name: 'report',
      label: '选品报告',
      hint: `${out.report.length} 个章节`,
      type: 'primary',
    })
  }
  list.push({ name: 'trace', label: '思考链', hint: `${out.toolCalls.length} 次工具调用`, type: 'info' })
  return list
})

const unviewed = ref<Record<string, boolean>>({})
function goTab(name: string) {
  activeTab.value = name
  unviewed.value = { ...unviewed.value, [name]: false }
}
watch(activeTab, v => {
  if (unviewed.value[v]) unviewed.value = { ...unviewed.value, [v]: false }
})

async function analyze() {
  if (!catalog.candidates.length) {
    ElMessage.warning('请先载入候选品')
    emit('navigate', 'catalog')
    return
  }
  if (!query.value.trim()) return ElMessage.warning('请输入分析指令')
  streaming.value = ''
  streamingSummary.value = ''
  activeTab.value = 'chat'
  const out = await catalog.run(
    query.value.trim(),
    chunk => {
      streaming.value += chunk
    },
    chunk => {
      streamingSummary.value += chunk
    },
  )
  if (!out) {
    ElMessage.error(catalog.lastError || 'Agent 执行失败')
    return
  }
  if (out.aborted) {
    ElMessage.info('已取消本轮分析')
    query.value = ''
    return
  }
  unviewed.value = Object.fromEntries(detailTabs.value.map(t => [t.name, true]))
  ElMessage.success(`完成：${actionLabel.value} · ${routeLabel.value}`)
  query.value = ''
}

function cancelRun() {
  catalog.cancel()
}

function pickExample(text: string) {
  query.value = text
}

const recentHistory = computed(() => history.value.slice(-6).reverse())
</script>

<template>
  <div class="wb">
    <!-- 英雄输入 -->
    <section class="hero">
      <div class="hero-glow" />
      <div class="hero-inner">
        <div class="hero-title">想了解哪个品？让 Agent 帮你分析</div>
        <div class="hero-sub">
          输入一句自然语言，Agent 自动调度工具：<b>打分</b> · <b>定价</b> · <b>评论洞察</b> ·
          <b>横向对比</b> · <b>选品报告</b>
        </div>

        <div class="hero-box" :class="{ 'is-busy': loading }">
          <span class="hero-box-ico" v-html="ICON.search"></span>
          <input
            v-model="query"
            class="hero-field"
            type="text"
            placeholder="例如：帮我看看第一个品值不值得做 / 给台灯定价 / 对比这几个候选品"
            :disabled="loading"
            @keyup.enter="analyze"
          />
          <button
            v-if="query"
            class="hero-clear"
            type="button"
            title="清空"
            @click="query = ''"
            v-html="ICON.close"
          ></button>
          <button v-if="!loading" class="hero-btn" type="button" :disabled="loading" @click="analyze">
            <span class="hero-btn-ico" v-html="ICON.spark"></span>
            开始分析
          </button>
          <button v-else class="hero-cancel" type="button" @click="cancelRun">
            <span class="hero-cancel-ico" v-html="ICON.close"></span>
            取消
          </button>
        </div>

        <div class="examples">
          <span class="examples-label">试试</span>
          <div class="examples-row">
            <button
              v-for="e in EXAMPLES"
              :key="e"
              class="example-chip"
              type="button"
              @click="pickExample(e)"
            >
              {{ e }}
            </button>
          </div>
        </div>

        <div v-if="!candidates.length" class="hero-tip">
          <span class="hero-tip-ico">!</span>
          <div class="hero-tip-body">
            尚未载入候选品，请先到
            <a class="hero-tip-link" @click="emit('navigate', 'catalog')">候选品库</a>
            导入 CSV 或载入示例数据，再回来让 Agent 分析。
          </div>
        </div>
      </div>
    </section>

    <!-- 分析结果 -->
    <section v-if="lastOutput || loading" class="cp-card result">
      <div class="cp-card-head">
        <div>
          <span class="t">分析结果</span>
          <span class="s">Agent 本轮产出</span>
        </div>
        <div class="meta" v-if="lastOutput">
          <el-tag size="small" type="primary">{{ actionLabel }}</el-tag>
          <el-tag size="small" type="info">{{ routeLabel }}</el-tag>
          <el-tag v-if="lastOutput.reflection" size="small" type="warning">
            反思 {{ lastOutput.reflection.rounds }} 轮
            <span v-if="lastOutput.reflection.addedTools.length">
              · 补调 {{ lastOutput.reflection.addedTools.join('、') }}
            </span>
          </el-tag>
        </div>
      </div>

      <div class="cp-card-body result-body">
        <el-tabs v-model="activeTab" class="cp-tabs">
          <el-tab-pane label="对话结果" name="chat">
            <div v-if="!lastOutput" class="running">
              <span class="running-tag">
                <i class="pulse" />
                执行中…
              </span>
              <div v-if="streaming" class="stream">{{ streaming }}</div>
            </div>
            <template v-else>
              <div v-if="loading && streaming" class="stream">{{ streaming }}</div>
              <div v-for="(r, i) in lastOutput.reasoning" :key="i" class="line">{{ r }}</div>
              <div v-if="summaryText" class="model-summary">
                <span class="model-summary-tag">模型总结</span>
                <span class="model-summary-txt">{{ summaryText }}</span>
              </div>
              <div v-if="lastOutput.warnings.length" class="warn">
                {{ lastOutput.warnings.join('；') }}
              </div>
              <div v-if="detailTabs.length" class="jump">
                <span class="jump-title">更多结果</span>
                <button
                  v-for="t in detailTabs"
                  :key="t.name"
                  class="jump-btn"
                  :class="`is-${t.type}`"
                  type="button"
                  @click="goTab(t.name)"
                >
                  <span class="jump-main">
                    <span class="jump-label">{{ t.label }}</span>
                    <span class="jump-hint">{{ t.hint }}</span>
                  </span>
                  <i v-if="unviewed[t.name]" class="dot"></i>
                </button>
              </div>
            </template>
          </el-tab-pane>

          <el-tab-pane v-if="lastOutput?.review" name="review">
            <template #label>
              <span class="tab-label">评论洞察<i v-if="unviewed.review" class="dot"></i></span>
            </template>
            <div v-if="streaming" class="stream">{{ streaming }}</div>
            <div class="sub-title">痛点</div>
            <el-tag
              v-for="p in lastOutput.review.painPoints"
              :key="p.text"
              size="small"
              type="danger"
              class="gap"
            >
              {{ p.text }}（{{ p.mentions }}）
            </el-tag>
            <div class="sub-title">正面反馈</div>
            <el-tag
              v-for="p in lastOutput.review.positives"
              :key="p"
              size="small"
              type="success"
              class="gap"
            >
              {{ p }}
            </el-tag>
            <div class="sub-title">改进建议</div>
            <ol class="sugg">
              <li v-for="(s, i) in lastOutput.review.suggestions" :key="i">{{ s }}</li>
            </ol>
            <div v-if="lastOutput.review.modelSummary" class="summary">
              {{ lastOutput.review.modelSummary }}
            </div>
            <div v-if="lastOutput.review.degraded" class="warn">
              模型不可用或输出不合规范，以上为规则降级结果
            </div>
          </el-tab-pane>

          <el-tab-pane v-if="lastOutput?.pricing" name="price">
            <template #label>
              <span class="tab-label">定价模拟<i v-if="unviewed.price" class="dot"></i></span>
            </template>
            <PriceCurve :pricing="lastOutput.pricing" />
          </el-tab-pane>

          <el-tab-pane v-if="lastOutput?.comparison" name="compare">
            <template #label>
              <span class="tab-label">横向对比<i v-if="unviewed.compare" class="dot"></i></span>
            </template>
            <CompareTable :comparison="lastOutput.comparison" />
          </el-tab-pane>

          <el-tab-pane v-if="lastOutput?.report?.length" name="report">
            <template #label>
              <span class="tab-label">选品报告<i v-if="unviewed.report" class="dot"></i></span>
            </template>
            <ReportView :report="lastOutput.report" />
          </el-tab-pane>

          <el-tab-pane v-if="lastOutput" name="trace">
            <template #label>
              <span class="tab-label">思考链<i v-if="unviewed.trace" class="dot"></i></span>
            </template>
            <TracePanel
              :trace="lastOutput.trace"
              :tool-calls="lastOutput.toolCalls"
              :usage="lastOutput.usage"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
    </section>

    <!-- 会话历史 -->
    <section v-if="recentHistory.length" class="cp-card history">
      <div class="cp-card-head">
        <div>
          <span class="t">会话历史</span>
          <span class="s">最近 {{ recentHistory.length }} 轮</span>
        </div>
        <el-button size="small" text @click="catalog.clearHistory()">清空</el-button>
      </div>
      <div class="cp-card-body">
        <div v-for="h in recentHistory" :key="h.id" class="hist" @click="catalog.select(h.targetId ?? null)">
          <span class="q">{{ h.query }}</span>
          <el-tag size="small" type="primary">{{ ACTION_LABEL[h.action] ?? h.action }}</el-tag>
          <el-tag size="small" type="info">{{ h.routedBy }}</el-tag>
          <span class="hist-go">查看 ›</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wb { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

/* —— 英雄输入 —— */
.hero {
  position: relative;
  border-radius: var(--cp-radius);
  background: linear-gradient(135deg, #fff7f0 0%, #fff 62%);
  border: 1px solid var(--cp-border);
  box-shadow: var(--cp-shadow-sm);
  overflow: hidden;
  padding: 30px 32px 26px;
}
.hero-glow {
  position: absolute;
  top: -120px;
  right: -80px;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(255, 106, 0, 0.18), transparent 70%);
  pointer-events: none;
}
.hero-inner { position: relative; }
.hero-title { font-size: 20px; font-weight: 700; color: var(--cp-text); letter-spacing: -0.2px; }
.hero-sub { margin-top: 6px; font-size: 13px; color: var(--cp-text-2); }
.hero-sub b { color: var(--cp-brand-dark); font-weight: 600; }

/* 自绘复合输入条：规避 Element Plus el-input-group__append 对按钮文字色的覆盖 */
.hero-box {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 7px 0 16px;
  background: #fff;
  border: 1px solid var(--cp-border-strong);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(20, 30, 60, 0.04), 0 12px 28px -18px rgba(255, 106, 0, 0.5);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.hero-box:focus-within {
  border-color: var(--cp-brand);
  box-shadow: 0 0 0 4px rgba(255, 106, 0, 0.12), 0 14px 30px -18px rgba(255, 106, 0, 0.6);
}
.hero-box.is-busy { background: #fffdfb; }
.hero-box-ico {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  color: var(--cp-text-3);
}
.hero-box-ico :deep(svg) { width: 18px; height: 18px; }
.hero-field {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  color: var(--cp-text);
}
.hero-field::placeholder { color: #b9bec8; }
.hero-field:disabled { cursor: not-allowed; }
.hero-clear {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 4px;
  border: 0;
  border-radius: 50%;
  background: #f0f2f6;
  color: var(--cp-text-3);
  cursor: pointer;
  display: inline-flex;
  transition: 0.16s;
}
.hero-clear :deep(svg) { width: 14px; height: 14px; }
.hero-clear:hover { background: #e6e9ef; color: var(--cp-text-2); }

.hero-btn {
  flex: 0 0 auto;
  height: 42px;
  padding: 0 22px;
  border: 0;
  border-radius: 11px;
  background: var(--cp-brand-grad);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 8px 18px -8px rgba(255, 106, 0, 0.85);
  transition: transform 0.16s, filter 0.16s, box-shadow 0.16s;
}
.hero-btn:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 10px 22px -8px rgba(255, 106, 0, 0.9);
}
.hero-btn:active:not(:disabled) { transform: translateY(0); }
.hero-btn:disabled { opacity: 0.75; cursor: not-allowed; }

.hero-cancel {
  flex: 0 0 auto;
  height: 42px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--cp-border-strong);
  border-radius: 11px;
  background: #fff;
  color: var(--cp-text-2);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.16s;
}
.hero-cancel:hover { border-color: var(--cp-danger); color: var(--cp-danger); background: #fff5f5; }
.hero-cancel-ico { display: inline-flex; width: 14px; height: 14px; }
.hero-cancel-ico :deep(svg) { width: 14px; height: 14px; }
.hero-btn-ico { display: inline-flex; width: 15px; height: 15px; }
.hero-btn-ico :deep(svg) { width: 15px; height: 15px; }
.hero-spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  animation: cp-spin 0.7s linear infinite;
}
@keyframes cp-spin { to { transform: rotate(360deg); } }

/* 示例胶囊：单行横滚，避免最后一个落单换行 */
.examples { margin-top: 16px; display: flex; align-items: center; gap: 10px; }
.examples-label { flex: 0 0 auto; font-size: 12px; color: var(--cp-text-3); }
.examples-row {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding: 1px 0;
  scrollbar-width: none;
}
.examples-row::-webkit-scrollbar { height: 0; }
.example-chip {
  flex: 0 0 auto;
  border: 1px solid var(--cp-border);
  background: #fff;
  color: var(--cp-text-2);
  border-radius: 999px;
  padding: 5px 12px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  transition: 0.18s;
}
.example-chip:hover {
  border-color: var(--cp-brand);
  color: var(--cp-brand-dark);
  background: var(--cp-brand-soft);
}

.hero-tip {
  margin-top: 16px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: #fffbf3;
  border: 1px solid #ffe6bd;
  border-radius: 10px;
  font-size: 13px;
  color: var(--cp-text-2);
}
.hero-tip-ico {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--cp-warning);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.hero-tip-link { color: var(--cp-brand-dark); font-weight: 600; cursor: pointer; }
.hero-tip-link:hover { text-decoration: underline; }

/* —— 结果卡 —— */
.result-body { padding-top: 6px; }
.meta { display: flex; gap: 6px; align-items: center; }
.cp-tabs :deep(.el-tabs__header) { margin: 0 0 14px; }
.cp-tabs :deep(.el-tabs__nav-wrap::after) { background: var(--cp-border); height: 1px; }
.cp-tabs :deep(.el-tabs__item) { font-size: 13px; }
.cp-tabs :deep(.el-tabs__item.is-active) { color: var(--cp-brand-dark); font-weight: 600; }
.cp-tabs :deep(.el-tabs__active-bar) { background: var(--cp-brand); }

.running { display: flex; flex-direction: column; gap: 10px; }
.running-tag {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--cp-brand-soft);
  color: var(--cp-brand-dark);
  font-size: 12px;
  font-weight: 600;
}
.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cp-brand);
  animation: cp-pulse 1s ease-in-out infinite;
}
@keyframes cp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.75); }
}

.line {
  display: flex;
  gap: 9px;
  font-size: 13px;
  color: var(--cp-text-2);
  line-height: 1.75;
  padding: 3px 0;
}
.line::before {
  content: '';
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  margin-top: 8px;
  border-radius: 50%;
  background: var(--cp-brand);
  opacity: 0.55;
}
.warn { margin-top: 10px; font-size: 12px; color: var(--cp-warning); }
.sub-title { font-size: 13px; font-weight: 600; margin: 14px 0 6px; color: var(--cp-text); }
.sugg { margin: 0; padding-left: 20px; font-size: 13px; color: var(--cp-text-2); line-height: 1.9; }
.summary { margin-top: 10px; font-size: 13px; color: var(--cp-text); background: #f0f9eb; padding: 8px 10px; border-radius: 8px; }
.stream { font-size: 13px; color: var(--cp-info); white-space: pre-wrap; margin-bottom: 10px; }

.model-summary {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 12px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #f2fbf4 0%, #f8fdfa 100%);
  border: 1px solid #d9f0de;
  border-left: 3px solid var(--cp-success);
  border-radius: 10px;
}
.model-summary-tag {
  flex: 0 0 auto;
  margin-top: 1px;
  padding: 1px 7px;
  border-radius: 5px;
  background: rgba(0, 180, 42, 0.12);
  color: #00891f;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.model-summary-txt { font-size: 13px; color: var(--cp-text); line-height: 1.7; }

.jump {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed var(--cp-border);
}
.jump-title { font-size: 12px; color: var(--cp-text-3); margin-right: 2px; }
.jump-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid var(--cp-border);
  background: #fff;
  border-radius: 999px;
  font-family: inherit;
  font-size: 12px;
  color: var(--cp-text-2);
  cursor: pointer;
  transition: 0.18s;
}
.jump-btn:hover { border-color: var(--cp-brand); color: var(--cp-brand-dark); background: var(--cp-brand-soft); }
.jump-main { display: inline-flex; align-items: baseline; gap: 6px; }
.jump-label { font-weight: 600; }
.jump-hint { font-size: 11px; color: var(--cp-text-3); }
.jump-btn:hover .jump-hint { color: var(--cp-brand-dark); opacity: 0.85; }
.jump-btn.is-danger .jump-label { color: var(--cp-danger); }
.jump-btn.is-warning .jump-label { color: var(--cp-warning); }
.jump-btn.is-info .jump-label { color: var(--cp-info); }
.tab-label { display: inline-flex; align-items: center; gap: 5px; }
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cp-danger);
}

/* —— 历史 —— */
.hist {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.16s;
}
.hist:hover { background: var(--cp-bg); box-shadow: inset 3px 0 0 var(--cp-brand); }
.q { flex: 1; color: var(--cp-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-go { color: var(--cp-brand-dark); font-size: 12px; }
</style>
