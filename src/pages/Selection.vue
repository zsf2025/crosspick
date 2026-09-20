<script setup lang="ts">
import { ref } from 'vue'
import Papa from 'papaparse'
import type { ProductCandidate } from '@/types/product'
import { mockProducts } from '@/adapters/mock'
import { parseCsvProducts } from '@/adapters/csv-adapter'
import { chat, health } from '@/agent/client'

const list = ref<ProductCandidate[]>([])

async function ping() {
  const ok = await health()
  if (!ok) return ElMessage.error('Ollama 未启动，请执行 ollama serve')
  const reply = await chat([{ role: 'user', content: '用一句话回答：跨境电商选品最看重的三个指标是什么？' }])
  console.log(reply)
  ElMessage.success('模型响应正常')
}

function loadMock() {
  list.value = mockProducts()
  ElMessage.success(`已载入 ${list.value.length} 个候选品`)
}

function onFile(file: File) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      const parsed = parseCsvProducts(res.data as Record<string, string>[])
      if (!parsed.length) return ElMessage.warning('未解析到有效数据，请检查表头')
      list.value = parsed
      ElMessage.success(`已导入 ${parsed.length} 个候选品`)
    },
    error: () => ElMessage.error('CSV 解析失败'),
  })
}

function avgPrice(c: ProductCandidate) {
  const n = c.competitors.length || 1
  return (c.competitors.reduce((s, i) => s + i.price, 0) / n).toFixed(2)
}
</script>

<template>
  <div class="page">
    <header class="toolbar">
      <h2>CrossPick · 智能选品</h2>
      <div class="actions">
        <button @click="loadMock">载入 Mock 数据</button>
        <label class="upload-btn">
          导入 CSV
          <input type="file" accept=".csv" hidden @change="e => { const f = (e.target as HTMLInputElement).files?.[0]; f && onFile(f) }">
        </label>
        <button @click="ping">测试模型</button>
      </div>
    </header>

    <el-table v-if="list.length" :data="list" border stripe style="width: 100%">
      <el-table-column prop="name" label="商品" min-width="200" show-overflow-tooltip />
      <el-table-column prop="category" label="类目" width="140" />
      <el-table-column label="采购成本" width="100" align="right">
        <template #default="{ row }">${{ row?.cost || 0 }}</template>
      </el-table-column>
      <el-table-column label="竞品均价" width="100" align="right">
        <template #default="{ row }">${{ avgPrice(row as ProductCandidate) }}</template>
      </el-table-column>
      <el-table-column label="竞品数" width="90" align="center">
        <template #default="{ row }">{{ row?.competitors?.length || 0 }}</template>
      </el-table-column>
      <el-table-column label="用户痛点" min-width="220">
        <template #default="{ row }">
          <el-tag v-for="p in (row as ProductCandidate).reviewInsights.filter(i => i.sentiment === 'negative').slice(0, 2)" :key="p.painPoint" size="small" type="danger" style="margin-right: 4px">
            {{ p.painPoint }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-else description="暂无数据，请先载入 Mock 或导入 CSV" :image-size="120" />
  </div>
</template>

<style scoped>
.page { padding: 24px; max-width: 1200px; margin: 0 auto; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.actions { display: flex; gap: 10px; }
button, .upload-btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #dcdfe6; background: #fff; cursor: pointer; }
.upload-btn { display: inline-block; }
</style>