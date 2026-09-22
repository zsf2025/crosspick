<script setup lang="ts">
import { computed } from 'vue'
import type { TraceStep, ToolCallRecord } from '@/types/agent'

const props = defineProps<{
  trace: TraceStep[]
  toolCalls: ToolCallRecord[]
  usage?: { llmCalls: number; promptChars: number; completionChars: number }
}>()

type TimelineType = 'info' | 'primary' | 'success' | 'warning' | 'danger'

const KIND_META: Record<TraceStep['kind'], { label: string; type: TimelineType }> = {
  thought: { label: '思考', type: 'info' },
  action: { label: '行动', type: 'primary' },
  observation: { label: '观察', type: 'success' },
  warning: { label: '警告', type: 'warning' },
  final: { label: '结论', type: 'danger' },
}

const time = (iso: string) => iso.slice(11, 19)

const totalMs = computed(() => props.toolCalls.reduce((s, t) => s + t.durationMs, 0))
</script>

<template>
  <div class="trace">
    <div class="meta">
      <el-tag size="small">工具调用 {{ toolCalls.length }} 次</el-tag>
      <el-tag size="small" type="info">耗时 {{ totalMs }} ms</el-tag>
      <el-tag size="small" type="warning" v-if="usage">LLM {{ usage.llmCalls }} 次 · {{ usage.promptChars + usage.completionChars }} 字符</el-tag>
    </div>

    <el-timeline>
      <el-timeline-item
        v-for="(s, i) in trace"
        :key="i"
        :type="KIND_META[s.kind].type"
        :timestamp="time(s.at)"
        placement="top"
      >
        <div class="row">
          <span class="kind">{{ KIND_META[s.kind].label }}</span>
          <span class="label">{{ s.label }}</span>
        </div>
        <div v-if="s.detail" class="detail">{{ s.detail }}</div>
      </el-timeline-item>
    </el-timeline>

    <div v-if="toolCalls.length" class="calls">
      <div v-for="(c, i) in toolCalls" :key="i" class="call">
        <span class="dot" :class="c.ok ? 'ok' : 'bad'" />
        <code>{{ c.tool }}</code>
        <span class="ms">{{ c.durationMs }}ms</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace { font-size: 13px; }
.meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.row { display: flex; gap: 8px; align-items: baseline; }
.kind { font-weight: 500; color: #606266; flex: none; }
.label { color: #303133; }
.detail { color: #909399; font-size: 12px; margin-top: 2px; }
.calls { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #ebeef5; }
.call { display: flex; align-items: center; gap: 6px; color: #606266; font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot.ok { background: #67c23a; }
.dot.bad { background: #f56c6c; }
.ms { color: #c0c4cc; }
</style>
