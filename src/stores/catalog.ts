import { defineStore } from 'pinia'
import { computed, markRaw, ref, watch } from 'vue'
import type { AgentOutput, ReportSection } from '@/types/agent'
import type { ProductCandidate, ScoreSnapshot } from '@/types/product'
import { createCandidate } from '@/types/product'
import { mockProducts } from '@/adapters/mock'
import { parseCsvDetailed } from '@/adapters/csv'
import { scoreCandidates } from '@/domain/scoring'
import { ConversationMemory } from '@/agent/core/memory'
import { runAgent, genId } from '@/agent/run'
import { getLLM } from '@/agent/core/llm'
import { useSettingsStore } from './settings'
import { readJSON, writeJSON, STORAGE_BACKEND } from './persist'

const KEY = 'crosspick.catalog.v1'
const HISTORY_LIMIT = 20
const isIdb = STORAGE_BACKEND === 'idb'

interface Persisted {
  candidates: ProductCandidate[]
  selectedId: string | null
  history: AgentOutput[]
}

/** 同步首屏：仅 localStorage 后端可同步读取；IDB 后端留空，等异步 bootstrap 填充 */
function loadSync(): Persisted | null {
  if (isIdb) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      candidates: Array.isArray(p.candidates) ? p.candidates : [],
      selectedId: p.selectedId ?? null,
      history: Array.isArray(p.history) ? p.history.slice(-HISTORY_LIMIT) : [],
    }
  } catch {
    return null
  }
}

export const useCatalogStore = defineStore('catalog', () => {
  const saved = loadSync()
  const candidates = ref<ProductCandidate[]>(saved?.candidates ?? [])
  const selectedId = ref<string | null>(saved?.selectedId ?? null)
  const history = ref<AgentOutput[]>(saved?.history ?? [])
  const loading = ref(false)
  const lastError = ref('')
  /** IDB 后端：首屏加载完成前禁止写入，避免空数据覆盖持久化内容 */
  const ready = ref(!isIdb)

  /** 用 id 记录选中项而不是数组下标：评分会重排列表，下标会错位 */
  const memory = markRaw(new ConversationMemory())

  watch(
    [candidates, selectedId, history],
    () => {
      if (isIdb && !ready.value) return
      const payload: Persisted = {
        candidates: candidates.value,
        selectedId: selectedId.value,
        history: history.value.slice(-HISTORY_LIMIT),
      }
      if (isIdb) {
        void writeJSON(KEY, payload)
      } else {
        try {
          localStorage.setItem(KEY, JSON.stringify(payload))
        } catch {
          /* 忽略配额错误 */
        }
      }
    },
    { deep: true },
  )

  // IDB 后端：异步首屏加载，完成后解锁写入
  if (isIdb) {
    void (async () => {
      const d = await readJSON<Persisted>(KEY)
      if (d) {
        candidates.value = Array.isArray(d.candidates) ? d.candidates : []
        selectedId.value = d.selectedId ?? null
        history.value = Array.isArray(d.history) ? d.history.slice(-HISTORY_LIMIT) : []
      }
      ready.value = true
    })()
  }

  const selected = computed(
    () => candidates.value.find(c => c.id === selectedId.value) ?? null,
  )
  const activeCandidates = computed(() =>
    candidates.value.filter(c => c.status !== 'rejected'),
  )
  const lastOutput = computed(() => history.value[history.value.length - 1] ?? null)

  function select(id: string | null) {
    selectedId.value = id
  }

  function setCandidates(list: ProductCandidate[]) {
    candidates.value = list
    if (!list.some(c => c.id === selectedId.value)) {
      selectedId.value = list[0]?.id ?? null
    }
  }

  function loadMock() {
    setCandidates(mockProducts())
    return candidates.value.length
  }

  function importCsv(rows: Record<string, string>[]) {
    const res = parseCsvDetailed(rows)
    if (res.candidates.length) setCandidates(res.candidates)
    return res
  }

  function addCandidate(partial: Partial<ProductCandidate>) {
    const c = createCandidate({ ...partial, id: partial.id || genId('p') })
    candidates.value = [...candidates.value, c]
    selectedId.value = c.id
    return c
  }

  function patchCandidate(id: string, patch: Partial<ProductCandidate>) {
    candidates.value = candidates.value.map(c => (c.id === id ? { ...c, ...patch } : c))
  }

  function removeCandidate(id: string) {
    candidates.value = candidates.value.filter(c => c.id !== id)
    if (selectedId.value === id) selectedId.value = candidates.value[0]?.id ?? null
  }

  /** 应用 Agent 产生的变更意图 */
  function applyMutations(mutations: Array<{ productId: string; kind: string; value: string }>) {
    for (const m of mutations) {
      const target = candidates.value.find(c => c.id === m.productId)
      if (!target) continue
      if (m.kind === 'status') {
        patchCandidate(m.productId, { status: m.value as ProductCandidate['status'] })
      } else if (m.kind === 'tag') {
        const tags = target.tags.includes(m.value) ? target.tags : [...target.tags, m.value]
        patchCandidate(m.productId, { tags })
      }
    }
  }

  /** 评分快照：把当前评分结果固化下来，供后续回填实际表现做复盘 */
  function saveSnapshot(candidateId: string, ruleId: string): ScoreSnapshot | null {
    const c = candidates.value.find(x => x.id === candidateId)
    if (!c || !c.scores) return null
    const snap: ScoreSnapshot = {
      id: genId('snap'),
      createdAt: new Date().toISOString(),
      ruleId,
      totalScore: c.totalScore ?? null,
      rows: c.scores.map(s => ({ ...s })),
    }
    patchCandidate(candidateId, { snapshots: [...(c.snapshots ?? []), snap] })
    return snap
  }

  function fillActual(
    candidateId: string,
    snapshotId: string,
    actual: { monthlySales?: number; rating?: number; note?: string },
  ) {
    const c = candidates.value.find(x => x.id === candidateId)
    if (!c?.snapshots) return
    patchCandidate(candidateId, {
      snapshots: c.snapshots.map(s => (s.id === snapshotId ? { ...s, actual: { ...s.actual, ...actual } } : s)),
    })
  }

  function rescore(rules = useSettingsStore().rules) {
    candidates.value = scoreCandidates(candidates.value, rules)
  }

  async function run(
    query: string,
    onDelta?: (chunk: string) => void,
    onSummaryDelta?: (chunk: string) => void,
  ): Promise<AgentOutput | null> {
    if (!query.trim()) return null
    if (!candidates.value.length) {
      lastError.value = '请先载入候选品'
      return null
    }
    const settings = useSettingsStore()
    const provider = getLLM(settings.llm)

    loading.value = true
    lastError.value = ''
    try {
      const outcome = await runAgent({
        query,
        candidates: candidates.value,
        rules: settings.rules,
        fba: settings.fba,
        llm: provider,
        memory,
        useLlmPlanner: settings.llm.useLlmPlanner,
        reflect: settings.llm.autonomous,
        maxRounds: settings.llm.maxRounds,
        summarize: settings.llm.summarize,
        onDelta: settings.llm.stream ? onDelta : undefined,
        onSummaryDelta: settings.llm.stream ? onSummaryDelta : undefined,
      })
      if (outcome.output.candidates?.length) {
        candidates.value = outcome.output.candidates
      }
      // 把选中项同步到用户实际在问的那个品。
      // 评分会重排列表，若沿用旧下标/旧选中项，雷达图会指向另一个商品。
      const tid = outcome.output.targetId
      if (tid && candidates.value.some(c => c.id === tid)) {
        selectedId.value = tid
      }
      applyMutations(outcome.mutations)
      history.value = [...history.value, outcome.output].slice(-HISTORY_LIMIT)
      return outcome.output
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      loading.value = false
    }
  }

  function clearHistory() {
    history.value = []
    memory.clear()
  }

  function reset() {
    candidates.value = []
    selectedId.value = null
    history.value = []
    memory.clear()
  }

  return {
    candidates,
    selectedId,
    selected,
    activeCandidates,
    history,
    lastOutput,
    loading,
    lastError,
    memory,
    select,
    setCandidates,
    loadMock,
    importCsv,
    addCandidate,
    patchCandidate,
    removeCandidate,
    applyMutations,
    saveSnapshot,
    fillActual,
    rescore,
    run,
    clearHistory,
    reset,
  }
})

export type CatalogStore = ReturnType<typeof useCatalogStore>
export type { ReportSection }
