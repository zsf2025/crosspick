<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '@/stores/settings'
import { useCatalogStore } from '@/stores/catalog'
import { downloadBackup, applyBackup } from '@/stores/dataio'
import RuleEditor from '@/components/RuleEditor.vue'
import HelpTip from '@/components/HelpTip.vue'

const settings = useSettingsStore()
const catalog = useCatalogStore()
const fileInput = ref<HTMLInputElement | null>(null)

function rescore() {
  catalog.rescore(settings.rules)
  ElMessage.success('已按当前规则重算')
}

function onExport() {
  downloadBackup()
  ElMessage.success('已导出备份文件')
}

function onImport(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      const res = applyBackup(parsed)
      if (res.ok) ElMessage.success('已从备份恢复数据')
      else ElMessage.error(res.error ?? '导入失败')
    } catch {
      ElMessage.error('文件解析失败，请确认是有效的 JSON 备份')
    } finally {
      input.value = ''
    }
  }
  reader.readAsText(file)
}
</script>

<template>
  <div class="st">
    <div class="st-grid">
      <!-- 评分规则 -->
      <section class="cp-card">
        <div class="cp-card-head">
          <div>
            <span class="t">评分规则</span>
            <HelpTip tip="评分引擎的参数：5 个维度的权重、竞争/差异化/趋势的计算系数，以及市场容量与利润空间的档位阈值。改动后点右下角「按当前规则重算」可立即刷新所有候选品得分。" />
            <span class="s">维度权重 · 竞争 · 差异化 · 趋势 · 档位</span>
          </div>
          <el-button size="small" text @click="settings.reset()">恢复默认</el-button>
        </div>
        <div class="cp-card-body">
          <RuleEditor :rules="settings.rules" @update="r => (settings.rules = r)" />
        </div>
      </section>

      <!-- 模型与自主 -->
      <div class="st-side">
        <section class="cp-card">
          <div class="cp-card-head">
            <div>
              <span class="t">模型连接</span>
              <HelpTip tip="选择让 Agent 用哪类模型服务：本地（本机 Ollama）、云端（OpenAI 兼容接口）或自动兜底（本地优先，不可用时自动切云端）。" />
              <span class="s">本地 Ollama · 云端兜底</span>
            </div>
          </div>
          <div class="cp-card-body">
            <div class="field">
              <label>模型来源<HelpTip tip="本地：仅用本机 Ollama，需先安装并启动；云端：直连 OpenAI 兼容接口；自动兜底：优先本地，本地不可用（未安装/未启动）时自动切到云端，无需手动切换。" /></label>
              <el-radio-group v-model="settings.llm.provider">
                <el-radio-button value="ollama">本地</el-radio-button>
                <el-radio-button value="cloud">云端</el-radio-button>
                <el-radio-button value="auto">自动兜底</el-radio-button>
              </el-radio-group>
            </div>
            <p v-if="settings.llm.provider === 'auto'" class="prov-hint">
              优先用本地 Ollama，检测到不可用（未安装/未启动）时自动切到云端。
            </p>
            <p v-else-if="settings.llm.provider === 'cloud' && !settings.llm.cloudApiKey" class="prov-hint warn">
              使用云端需填写 API Key（OpenAI 兼容协议）。
            </p>

            <template v-if="settings.llm.provider !== 'cloud'">
              <div class="field">
                <label>本地服务地址<HelpTip tip="本机 Ollama 的 API 地址，默认 http://127.0.0.1:11434/api。需先安装并启动 Ollama 才能连接。" /></label>
                <el-input v-model="settings.llm.baseUrl" size="default" placeholder="http://127.0.0.1:11434/api" />
              </div>
              <div class="field">
                <label>本地模型<HelpTip tip="本地运行的模型名称，如 qwen2.5:1.5b。需已通过 ollama pull 拉取到本机。" /></label>
                <el-input v-model="settings.llm.model" size="default" placeholder="qwen2.5:1.5b" />
              </div>
            </template>

            <template v-if="settings.llm.provider !== 'ollama'">
              <div class="field">
                <label>云端地址（/v1）<HelpTip tip="OpenAI 兼容的接口基地址，通常形如 https://xxx/v1。用于自动兜底或纯云端模式调用。" /></label>
                <el-input v-model="settings.llm.cloudBaseUrl" size="default" placeholder="https://api.openai.com/v1" />
              </div>
              <div class="field">
                <label>云端 API Key<HelpTip tip="云端服务的密钥。仅在云端或自动兜底模式、且本地不可用时使用，保存在本机浏览器，不会上传到本项目。" /></label>
                <el-input v-model="settings.llm.cloudApiKey" size="default" type="password" show-password placeholder="sk-..." />
              </div>
              <div class="field">
                <label>云端模型<HelpTip tip="云端调用的模型名，如 gpt-4o-mini。" /></label>
                <el-input v-model="settings.llm.cloudModel" size="default" placeholder="gpt-4o-mini" />
              </div>
            </template>

            <div class="set-row">
              <div>
                <div class="set-label">流式输出<HelpTip tip="开启后模型边生成边逐字显示；关闭则等全部生成完再一次性展示。" /></div>
                <div class="set-desc">边生成边显示结论</div>
              </div>
              <el-switch v-model="settings.llm.stream" />
            </div>
            <div class="set-row">
              <div>
                <div class="set-label">模型做规划<HelpTip tip="开启时由大模型生成工具调用计划（更灵活、能应对开放问题）；关闭时由确定性规则生成计划（更稳定、可复现）。" /></div>
                <div class="set-desc">关闭后由确定性规则生成执行计划，结果更稳定</div>
              </div>
              <el-switch v-model="settings.llm.useLlmPlanner" />
            </div>
            <div class="set-row">
              <div>
                <div class="set-label">原生 function calling<HelpTip tip="开启时优先让模型走工具协议（tool_calls）选出要调用的工具，输出更规范；关闭则强制用「文本 JSON 解析」替代工具协议。部分本地小模型不支持 tool_calls，开启后会自动回退到文本解析——若你发现本地模型规划偶发失败，可关闭此项改用更稳的文本解析。" /></div>
                <div class="set-desc">关闭则强制文本 JSON 解析，对不支持 tool_calls 的小模型更稳</div>
              </div>
              <el-switch v-model="settings.llm.preferFunctionCalling" />
            </div>
          </div>
        </section>

        <section class="cp-card">
          <div class="cp-card-head">
            <div>
              <span class="t">决策学习阈值</span>
              <HelpTip tip="回填实际表现后，「从复盘学习」会把月销与评分按下面两条阈值折算成 0–100 的成功度，作为权重拟合的目标。阈值越贴近你的真实类目，学出的权重越准。" />
              <span class="s">把实际表现折算为成功度</span>
            </div>
          </div>
          <div class="cp-card-body">
            <div class="field">
              <label>月销达标线<HelpTip tip="判定该品「成功」的月销量门槛（件/月）。回填的实际月销达到此值计满分，用于折算成功度。按你类目的正常水平填写。" /></label>
              <el-input-number v-model="settings.learning.salesTarget" :min="1" :step="50" controls-position="right" />
              <span class="unit">件/月</span>
            </div>
            <div class="field">
              <label>评分达标线<HelpTip tip="判定「成功」的最低买家评分（1–5 分）。低于此值会拉低成功度，配合月销一起决定复盘学习的目标值。" /></label>
              <el-input-number v-model="settings.learning.goodRating" :min="1" :max="5" :step="0.1" :precision="1" controls-position="right" />
              <span class="unit">分</span>
            </div>
            <p class="prov-hint">
              回填实际表现后，「从复盘学习」会把月销/评分折算成 0–100 成功度作为拟合目标。
              阈值越贴近你的真实类目，学出的权重越准。
            </p>
          </div>
        </section>

        <section class="cp-card">
          <div class="cp-card-head">
            <div>
              <span class="t">自主与总结</span>
              <HelpTip tip="控制 Agent 在执行工具之后的自主行为：是否自行判断补调工具、以及最后是否补一句结论。都属于「增强解释」能力，不改变评分结果。" />
              <span class="s">Agent 行为开关</span>
            </div>
          </div>
          <div class="cp-card-body">
            <div class="set-row">
              <div>
                <div class="set-label">自主反思<HelpTip tip="开启后，工具执行完会由模型判断是否需要补调其他工具（如看到差评再补查评价洞察）。淘汰类工具不会被自动补调，避免误删候选。" /></div>
                <div class="set-desc">工具跑完后让模型判断是否补调（淘汰类工具不会自动补调）</div>
              </div>
              <el-switch v-model="settings.llm.autonomous" />
            </div>
            <div v-if="settings.llm.autonomous" class="field slider-field">
              <label>最多补几轮：<b>{{ settings.llm.maxRounds }}</b><HelpTip tip="自主反思最多自动追加的轮数，防止模型无限循环补调工具。" placement="top-start" /></label>
              <el-slider v-model="settings.llm.maxRounds" :min="1" :max="4" show-stops />
            </div>
            <div class="set-row">
              <div>
                <div class="set-label">收尾总结<HelpTip tip="所有工具跑完后，让模型针对结果补一句总结性结论，便于快速抓住重点。" /></div>
                <div class="set-desc">工具结束后让模型看着结果补一句结论</div>
              </div>
              <el-switch v-model="settings.llm.summarize" />
            </div>
          </div>
          <div class="card-foot">
            <el-button size="small" @click="settings.reset()">恢复默认</el-button>
            <el-button size="small" type="primary" @click="rescore">按当前规则重算</el-button>
          </div>
        </section>

        <section class="cp-card">
          <div class="cp-card-head">
            <div>
              <span class="t">数据管理</span>
              <HelpTip tip="所有数据（候选品、规则、学习产物）都存在本机浏览器的 IndexedDB，清缓存或换设备会丢失。建议定期导出备份，需要时再用导入恢复。" />
              <span class="s">备份与迁移</span>
            </div>
          </div>
          <div class="cp-card-body">
            <p class="prov-hint">
              数据存在浏览器本地（IndexedDB）。导出可备份到文件，换设备或清缓存后用导入恢复。
            </p>
            <div class="data-acts">
              <el-button size="default" @click="onExport">导出备份</el-button>
              <el-button size="default" type="primary" @click="fileInput?.click()">导入备份</el-button>
              <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onImport" />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.st { max-width: 1180px; margin: 0 auto; }
.st-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
.st-side { display: flex; flex-direction: column; gap: 20px; }
.field { margin-bottom: 14px; }
.field > label { display: block; font-size: 13px; color: var(--cp-text-2); margin-bottom: 6px; font-weight: 500; }
.field .unit { margin-left: 8px; font-size: 12px; color: var(--cp-text-3); }
.prov-hint { font-size: 12px; color: var(--cp-text-3); line-height: 1.6; margin: 4px 0 14px; }
.prov-hint.warn { color: var(--cp-warn, #e6a23c); }
.data-acts { display: flex; gap: 10px; }
.slider-field { margin-top: 6px; }
.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-top: 1px solid var(--cp-border);
}
.set-row:first-child { border-top: none; padding-top: 0; }
.set-label { font-size: 14px; font-weight: 500; color: var(--cp-text); }
.set-desc { font-size: 12px; color: var(--cp-text-3); margin-top: 5px; line-height: 1.5; max-width: 230px; }
.card-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--cp-border); }

@media (max-width: 980px) {
  .st-grid { grid-template-columns: 1fr; }
}
</style>
