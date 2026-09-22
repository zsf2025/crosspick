<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getLLM, OllamaProvider } from '@/agent/core/llm'
import WorkbenchView from '@/components/WorkbenchView.vue'
import CatalogView from '@/components/CatalogView.vue'
import ReviewView from '@/components/ReviewView.vue'
import SettingsView from '@/components/SettingsView.vue'

const settings = useSettingsStore()

type ViewKey = 'workbench' | 'catalog' | 'review' | 'settings'
const view = ref<ViewKey>('workbench')

const ICON = {
  workbench:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/></svg>',
  catalog:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>',
  review:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16l3-4 3 2 4-6"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>',
}

const NAV: { key: ViewKey; label: string; sub: string }[] = [
  { key: 'workbench', label: '选品工作台', sub: 'AI 分析与决策' },
  { key: 'catalog', label: '候选品库', sub: '商品与评分' },
  { key: 'review', label: '决策复盘', sub: '评分快照' },
  { key: 'settings', label: '规则与模型', sub: '评分 & 参数' },
]
const current = computed(() => NAV.find(n => n.key === view.value)!)

const modelOk = ref<boolean | null>(null)
async function ping() {
  const p = getLLM()
  if (p instanceof OllamaProvider) {
    p.configure({ baseUrl: settings.llm.baseUrl, model: settings.llm.model })
  }
  modelOk.value = await p.health()
}
const modelState = computed(() => (modelOk.value === null ? 'unknown' : modelOk.value ? 'ok' : 'off'))
const modelLabel = computed(() =>
  modelOk.value === null ? '模型状态未知' : modelOk.value ? '模型已连接' : '模型未连接',
)

function goWorkbench() {
  view.value = 'workbench'
}
function navigate(v: 'catalog' | 'review' | 'settings') {
  view.value = v
}
</script>

<template>
  <div class="cp">
    <!-- 侧边栏 -->
    <aside class="cp-side">
      <div class="cp-brand">
        <div class="cp-logo">CP</div>
        <div class="cp-brand-txt">
          <strong>CrossPick</strong>
          <span>跨境智能选品</span>
        </div>
      </div>

      <nav class="cp-nav">
        <button
          v-for="n in NAV"
          :key="n.key"
          class="cp-nav-item"
          :class="{ active: view === n.key }"
          @click="view = n.key"
        >
          <span class="cp-nav-ico" v-html="ICON[n.key]" />
          <span class="cp-nav-label">{{ n.label }}</span>
        </button>
      </nav>

      <div class="cp-side-foot">
        <button class="cp-model" :class="modelState" title="点击测试模型连接" @click="ping">
          <span class="cp-model-dot" />
          <span class="cp-model-txt">
            <b>{{ modelLabel }}</b>
            <small>{{ settings.llm.model }}</small>
          </span>
        </button>
        <div class="cp-foot-note">本地模型 · 数据不出端</div>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="cp-main">
      <header class="cp-top">
        <div class="cp-crumb">
          <span class="cp-crumb-title">{{ current.label }}</span>
          <span class="cp-crumb-sub">{{ current.sub }}</span>
        </div>
        <div class="cp-top-actions">
          <el-button @click="ping">
            <span class="btn-ico" v-html="ICON.refresh" />
            {{ modelOk ? '重新检测' : '测试模型' }}
          </el-button>
          <el-button type="primary" @click="goWorkbench">
            <span class="btn-ico" v-html="ICON.plus" />
            新建分析
          </el-button>
        </div>
      </header>

      <main class="cp-content">
        <WorkbenchView v-if="view === 'workbench'" @navigate="navigate" />
        <CatalogView v-else-if="view === 'catalog'" />
        <ReviewView v-else-if="view === 'review'" @navigate="navigate" />
        <SettingsView v-else-if="view === 'settings'" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.cp { display: flex; height: 100vh; width: 100%; background: var(--cp-bg); }

/* —— 侧边栏 —— */
.cp-side {
  width: 248px;
  flex: 0 0 248px;
  background: var(--cp-surface);
  border-right: 1px solid var(--cp-border);
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
}
.cp-brand { display: flex; align-items: center; gap: 12px; padding: 4px 8px 18px; }
.cp-logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--cp-brand-grad);
  color: #fff;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  letter-spacing: 0.5px;
  box-shadow: 0 6px 16px rgba(255, 106, 0, 0.35);
}
.cp-brand-txt { display: flex; flex-direction: column; line-height: 1.25; }
.cp-brand-txt strong { font-size: 17px; color: var(--cp-text); }
.cp-brand-txt span { font-size: 12px; color: var(--cp-text-3); }

.cp-nav { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; flex: 1; }
.cp-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border: none;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  color: var(--cp-text-2);
  font-size: 14px;
  text-align: left;
  transition: 0.18s;
}
.cp-nav-item:hover { background: var(--cp-bg); color: var(--cp-text); }
.cp-nav-item.active {
  background: var(--cp-brand-soft);
  color: var(--cp-brand-dark);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--cp-brand);
}
.cp-nav-ico { width: 20px; height: 20px; display: inline-flex; flex: 0 0 20px; }
.cp-nav-ico :deep(svg) { width: 20px; height: 20px; }

.cp-side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
.cp-model {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--cp-border);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: 0.18s;
}
.cp-model:hover { border-color: var(--cp-border-strong); }
.cp-model-dot { width: 9px; height: 9px; border-radius: 50%; background: #c9cdd4; flex: 0 0 auto; transition: 0.2s; }
.cp-model.ok .cp-model-dot { background: var(--cp-success); box-shadow: 0 0 0 3px rgba(0, 180, 42, 0.15); }
.cp-model.off .cp-model-dot { background: var(--cp-danger); box-shadow: 0 0 0 3px rgba(245, 63, 63, 0.15); }
.cp-model-txt { display: flex; flex-direction: column; line-height: 1.25; }
.cp-model-txt b { font-size: 13px; color: var(--cp-text); }
.cp-model-txt small { font-size: 11px; color: var(--cp-text-3); }
.cp-foot-note { font-size: 11px; color: var(--cp-text-3); text-align: center; }

/* —— 主区域 —— */
.cp-main { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100vh; }
.cp-top {
  height: 64px;
  flex: 0 0 64px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--cp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  position: sticky;
  top: 0;
  z-index: 10;
}
.cp-crumb { display: flex; align-items: baseline; gap: 10px; }
.cp-crumb-title { font-size: 18px; font-weight: 700; color: var(--cp-text); }
.cp-crumb-sub { font-size: 13px; color: var(--cp-text-3); }
.cp-top-actions { display: flex; gap: 10px; align-items: center; }
.cp-top-actions .btn-ico { display: inline-flex; width: 15px; height: 15px; margin-right: 5px; vertical-align: -2px; }
.cp-top-actions .btn-ico :deep(svg) { width: 15px; height: 15px; }

.cp-content { flex: 1; overflow-y: auto; padding: 24px 28px 44px; }

@media (max-width: 860px) {
  .cp-side { width: 72px; flex-basis: 72px; padding: 16px 10px; }
  .cp-brand-txt, .cp-nav-label, .cp-model-txt, .cp-foot-note { display: none; }
  .cp-nav-item { justify-content: center; }
  .cp-model { justify-content: center; }
  .cp-content { padding: 18px 14px 36px; }
  .cp-top { padding: 0 16px; }
}
</style>
