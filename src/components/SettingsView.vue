<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '@/stores/settings'
import { useCatalogStore } from '@/stores/catalog'
import RuleEditor from '@/components/RuleEditor.vue'

const settings = useSettingsStore()
const catalog = useCatalogStore()

function rescore() {
  catalog.rescore(settings.rules)
  ElMessage.success('已按当前规则重算')
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
            <div><span class="t">模型连接</span><span class="s">本地 Ollama</span></div>
          </div>
          <div class="cp-card-body">
            <div class="field">
              <label>服务地址</label>
              <el-input v-model="settings.llm.baseUrl" size="default" placeholder="http://127.0.0.1:11434/api" />
            </div>
            <div class="field">
              <label>模型</label>
              <el-input v-model="settings.llm.model" size="default" placeholder="qwen2.5:1.5b" />
            </div>
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
