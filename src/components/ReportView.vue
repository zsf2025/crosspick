<script setup lang="ts">
import { computed } from 'vue'
import type { ReportSection } from '@/types/agent'

const props = defineProps<{ report: ReportSection[] }>()

const markdown = computed(() =>
  props.report.map(s => `## ${s.heading}\n\n${s.body}`).join('\n\n'),
)

async function copy() {
  try {
    await navigator.clipboard.writeText(markdown.value)
    ElMessage.success('已复制 Markdown 报告')
  } catch {
    ElMessage.warning('浏览器拒绝了剪贴板访问，请手动复制')
  }
}

function download() {
  const blob = new Blob([markdown.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'crosspick-report.md'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div>
    <div class="actions">
      <el-button size="small" @click="copy">复制 Markdown</el-button>
      <el-button size="small" type="primary" @click="download">下载 .md</el-button>
    </div>
    <div v-for="(s, i) in report" :key="i" class="section">
      <h4>{{ s.heading }}</h4>
      <pre>{{ s.body }}</pre>
    </div>
  </div>
</template>

<style scoped>
.actions { display: flex; gap: 8px; margin-bottom: 12px; }
.section { margin-bottom: 14px; }
h4 { font-size: 14px; font-weight: 500; margin: 0 0 6px; color: #303133; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 13px; line-height: 1.7; color: #606266; font-family: inherit; }
</style>
