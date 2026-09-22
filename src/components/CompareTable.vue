<script setup lang="ts">
import type { ComparisonResult } from '@/types/agent'

defineProps<{ comparison: ComparisonResult }>()
</script>

<template>
  <div>
    <el-table
      :data="comparison.rows"
      border
      stripe
      size="small"
      :row-class-name="({ row }) => (row.productId === comparison.winnerId ? 'winner-row' : '')"
    >
      <el-table-column prop="name" label="商品" min-width="180" show-overflow-tooltip />
      <el-table-column label="竞品均价" width="100" align="right">
        <template #default="{ row }">${{ row.avgPrice }}</template>
      </el-table-column>
      <el-table-column label="成本" width="80" align="right">
        <template #default="{ row }">${{ row.cost }}</template>
      </el-table-column>
      <el-table-column label="毛利率" width="90" align="right">
        <template #default="{ row }">
          <span v-if="row.marginPct === null">N/A</span>
          <span v-else :style="{ color: row.marginPct >= 40 ? '#67c23a' : '#e6a23c' }">
            {{ row.marginPct }}%
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="competitorCount" label="竞品数" width="80" align="center" />
      <el-table-column prop="totalReviews" label="评论总量" width="100" align="right" />
      <el-table-column label="综合分" width="90" align="center">
        <template #default="{ row }">
          <el-tag
            v-if="row.totalScore !== null"
            size="small"
            :type="row.totalScore >= 70 ? 'success' : row.totalScore >= 50 ? 'warning' : 'danger'"
          >
            {{ row.totalScore }}
          </el-tag>
          <span v-else>N/A</span>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="comparison.notes.length" class="notes">
      <div v-for="(n, i) in comparison.notes" :key="i">{{ n }}</div>
    </div>
  </div>
</template>

<style scoped>
.notes { margin-top: 8px; font-size: 12px; color: #909399; }
:deep(.winner-row) { background: #f0f9eb !important; }
</style>
