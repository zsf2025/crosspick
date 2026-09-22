<script setup lang="ts">
import { ElTooltip } from 'element-plus'

withDefaults(
  defineProps<{
    tip: string
    placement?: 'top' | 'top-start' | 'top-end' | 'bottom' | 'left' | 'right'
  }>(),
  { placement: 'top' },
)
</script>

<template>
  <el-tooltip :content="tip" :placement="placement" effect="dark" :show-after="120" :hide-after="0">
    <span class="help-tip" tabindex="0" role="button" :aria-label="tip">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
        <path
          d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle cx="12" cy="17.2" r="1.25" fill="currentColor" />
      </svg>
    </span>
  </el-tooltip>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  color: var(--cp-text-3, #9aa3af);
  cursor: help;
  border-radius: 50%;
  vertical-align: -3px;
  transition:
    color 0.15s ease,
    transform 0.15s ease;
}
.help-tip:hover,
.help-tip:focus-visible {
  color: var(--cp-brand, #ff6a00);
  outline: none;
  transform: scale(1.08);
}
</style>
