<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { ScoreRow } from '@/types/product'
import { DIMENSION_LABELS } from '@/types/product'

const props = defineProps<{ scores: ScoreRow[] }>()

const BRAND = '#ff6a00'

const option = computed(() => {
  const indicator = props.scores.map(s => ({
    name: s.available ? DIMENSION_LABELS[s.dimension] : `${DIMENSION_LABELS[s.dimension]}(缺)`,
    max: 100,
  }))
  const data = props.scores.map(s => (s.available ? s.score : 0))

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(29, 33, 41, 0.92)',
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: () => {
        const lines = props.scores.map(
          s =>
            `${DIMENSION_LABELS[s.dimension]}：${
              s.available ? `${s.score}（${s.reason}）` : `N/A（${s.reason}）`
            }`,
        )
        return lines.join('<br/>')
      },
    },
    // 半径收窄到 58%，避免「差异化空间」这类长标签被容器裁掉
    radar: {
      indicator,
      radius: '58%',
      center: ['50%', '53%'],
      splitNumber: 4,
      axisName: { color: '#86909c', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e9ecf2' } },
      splitLine: { lineStyle: { color: '#eef1f6' } },
      splitArea: { show: true, areaStyle: { color: ['#ffffff', '#fbfcfe'] } },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 4,
        data: [
          {
            value: data,
            name: '五维评分',
            areaStyle: { color: 'rgba(255, 106, 0, 0.16)' },
            lineStyle: { color: BRAND, width: 2 },
            itemStyle: { color: BRAND, borderColor: '#fff', borderWidth: 1 },
          },
        ],
      },
    ],
  }
})
</script>

<template>
  <v-chart :option="option" style="width: 100%; height: 262px" autoresize />
</template>
