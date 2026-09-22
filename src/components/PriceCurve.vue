<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { PricingSuggestion } from '@/types/agent'

const props = defineProps<{ pricing: PricingSuggestion }>()

const option = computed(() => {
  const prices = props.pricing.points.map(p => p.price)
  const sales = props.pricing.points.map(p => p.sales)
  const profits = props.pricing.points.map(p => p.profit)
  const b = props.pricing.costBreakdown

  return {
    title: {
      text: `定价模拟 · ${props.pricing.productName}`,
      subtext: `建议售价 $${props.pricing.suggestedPrice} | 盈亏平衡 $${props.pricing.breakEvenPrice} | 成本构成 采购 $${b.purchase} + 头程 $${b.inbound} + FBA $${b.fbaFee}，佣金 ${(b.referralRate * 100).toFixed(0)}%`,
      left: 'center',
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['预估销量', '预估利润'], bottom: 0 },
    xAxis: { type: 'category', name: '售价 ($)', data: prices },
    yAxis: [
      { type: 'value', name: '销量', position: 'left' },
      { type: 'value', name: '利润 ($)', position: 'right' },
    ],
    series: [
      {
        name: '预估销量',
        type: 'line',
        yAxisIndex: 0,
        data: sales,
        smooth: true,
        itemStyle: { color: '#409EFF' },
        areaStyle: { color: 'rgba(64, 158, 255, 0.1)' },
      },
      {
        name: '预估利润',
        type: 'line',
        yAxisIndex: 1,
        data: profits,
        smooth: true,
        itemStyle: { color: '#67C23A' },
        markLine: {
          data: [
            {
              yAxis: 0,
              lineStyle: { color: '#F56C6C', type: 'dashed' },
              label: { formatter: '盈亏平衡', position: 'end' },
            },
          ],
        },
      },
    ],
  }
})
</script>

<template>
  <v-chart :option="option" style="width: 100%; height: 400px" autoresize />
</template>
