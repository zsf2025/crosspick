<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '@/stores/settings'
import { useCatalogStore } from '@/stores/catalog'
import { downloadBackup, applyBackup } from '@/stores/dataio'
import RuleEditor from '@/components/RuleEditor.vue'

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
            <div><span class="t">模型连接</span><span class="s">本地 Ollama · 云端兜底</span></div>
          </div>
          <div class="cp-card-body">
            <div class="field">
              <label>模型来源</label>
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
                <label>本地服务地址</label>
                <el-input v-model="settings.llm.baseUrl" size="default" placeholder="http://127.0.0.1:11434/api" />
              </div>
              <div class="field">
                <label>本地模型</label>
                <el-input v-model="settings.llm.model" size="default" placeholder="qwen2.5:1.5b" />
              </div>
            </template>

            <template v-if="settings.llm.provider !== 'ollama'">
              <div class="field">
                <label>云端地址（/v1）</label>
                <el-input v-model="settings.llm.cloudBaseUrl" size="default" placeholder="https://api.openai.com/v1" />
              </div>
              <div class="field">
                <label>云端 API Key</label>
                <el-input v-model="settings.llm.cloudApiKey" size="default" type="password" show-password placeholder="sk-..." />
              </div>
              <div class="field">
                <label>云端模型</label>
                <el-input v-model="settings.llm.cloudModel" size="default" placeholder="gpt-4o-mini" />
              </div>
            </template>

            <div class="set-row">
              <div>
                <div class="set-label">流式输出</div>
                <div class="set-desc">边生成边显示结论</div>
              </div>
              <el-switch v-model="settings.llm.stream" />
            </div>
            <div class="set-row">
              <div>
                <div class="set-label">模型做规划</div>
                <div class="set-desc">关闭后由确定性规则生成执行计划，结果更稳定</div>
              </div>
              <el-switch v-model="settings.llm.useLlmPlanner" />
            </div>
          </div>
        </section>

        <section class="cp-card">
          <div class="cp-card-head">
            <div><span class="t">决策学习阈值</span><span class="s">把实际表现折算为成功度</span></div>
          </div>
          <div class="cp-card-body">
            <div class="field">
              <label>月销达标线</label>
              <el-input-number v-model="settings.learning.salesTarget" :min="1" :step="50" controls-position="right" />
              <span class="unit">件/月</span>
            </div>
            <div class="field">
              <label>评分达标线</label>
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
            <div><span class="t">自主与总结</span><span class="s">Agent 行为开关</span></div>
          </div>
          <div class="cp-card-body">
            <div class="set-row">
              <div>
                <div class="set-label">自主反思</div>
                <div class="set-desc">工具跑完后让模型判断是否补调（淘汰类工具不会自动补调）</div>
              </div>
              <el-switch v-model="settings.llm.autonomous" />
            </div>
            <div v-if="settings.llm.autonomous" class="field slider-field">
              <label>最多补几轮：<b>{{ settings.llm.maxRounds }}</b></label>
              <el-slider v-model="settings.llm.maxRounds" :min="1" :max="4" show-stops />
            </div>
            <div class="set-row">
              <div>
                <div class="set-label">收尾总结</div>
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
            <div><span class="t">数据管理</span><span class="s">备份与迁移</span></div>
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
