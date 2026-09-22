import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { DEFAULT_RULES, RULE_PRESETS, cloneRules } from '@/domain/rules'
import type { ScoringRules } from '@/domain/rules'
import { DEFAULT_FBA_CONFIG } from '@/domain/fba'
import type { FbaConfig } from '@/domain/fba'
import { DEFAULT_OLLAMA } from '@/agent/core/llm'
import { DEFAULT_LEARNING } from '@/domain/learning'
import type { LearningConfig } from '@/domain/learning'
import { readJSON, writeJSON, STORAGE_BACKEND } from './persist'

const KEY = 'crosspick.settings.v1'
const isIdb = STORAGE_BACKEND === 'idb'

/** 模型来源：本地 Ollama / 云端 API / 自动（本地优先，失败回云端） */
export type ModelProvider = 'ollama' | 'cloud' | 'auto'

export interface LlmSettings {
  /** 模型来源选择 */
  provider: ModelProvider
  baseUrl: string
  model: string
  /** 云端兜底配置（OpenAI 兼容协议） */
  cloudBaseUrl: string
  cloudApiKey: string
  cloudModel: string
  useLlmPlanner: boolean
  stream: boolean
  /** 观察—反思循环：执行完让模型判断是否补调工具 */
  autonomous: boolean
  /** 反思循环最多补几轮 */
  maxRounds: number
  /** 收尾总结：工具跑完后让模型看着结果补一句话结论 */
  summarize: boolean
}

const DEFAULT_LLM: LlmSettings = {
  provider: 'ollama',
  baseUrl: DEFAULT_OLLAMA.baseUrl,
  model: DEFAULT_OLLAMA.model,
  cloudBaseUrl: 'https://api.openai.com/v1',
  cloudApiKey: '',
  cloudModel: 'gpt-4o-mini',
  useLlmPlanner: false,
  stream: true,
  autonomous: false,
  maxRounds: 2,
  summarize: true,
}

interface Persisted {
  rules: ScoringRules
  fba: FbaConfig
  llm: LlmSettings
  learnedRules: ScoringRules[]
  learning: LearningConfig
}

/** 同步首屏：仅 localStorage 后端可同步读取；IDB 后端留空，等异步 bootstrap 填充 */
function loadSync(): Persisted | null {
  if (isIdb) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      rules: { ...cloneRules(DEFAULT_RULES), ...(p.rules ?? {}) },
      fba: { ...DEFAULT_FBA_CONFIG, ...(p.fba ?? {}) },
      llm: { ...DEFAULT_LLM, ...(p.llm ?? {}) },
      learnedRules: Array.isArray(p.learnedRules)
        ? p.learnedRules.map((r: ScoringRules) => cloneRules(r))
        : [],
      learning: { ...DEFAULT_LEARNING, ...(p.learning ?? {}) },
    }
  } catch {
    return null
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = loadSync()
  const rules = ref<ScoringRules>(saved?.rules ?? cloneRules(DEFAULT_RULES))
  const fba = ref<FbaConfig>(saved?.fba ?? { ...DEFAULT_FBA_CONFIG })
  const llm = ref<LlmSettings>(saved?.llm ?? { ...DEFAULT_LLM })
  const learnedRules = ref<ScoringRules[]>(saved?.learnedRules ?? [])
  const learning = ref<LearningConfig>(saved?.learning ?? { ...DEFAULT_LEARNING })
  /** IDB 后端：首屏加载完成前禁止写入，避免空数据覆盖持久化内容 */
  const ready = ref(!isIdb)

  watch(
    [rules, fba, llm, learnedRules, learning],
    () => {
      if (isIdb && !ready.value) return
      const payload: Persisted = {
        rules: rules.value,
        fba: fba.value,
        llm: llm.value,
        learnedRules: learnedRules.value,
        learning: learning.value,
      }
      if (isIdb) {
        void writeJSON(KEY, payload)
      } else {
        try {
          localStorage.setItem(KEY, JSON.stringify(payload))
        } catch {
          /* 存储配额满时静默失败，不影响主流程 */
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
        rules.value = { ...cloneRules(DEFAULT_RULES), ...(d.rules ?? {}) }
        fba.value = { ...DEFAULT_FBA_CONFIG, ...(d.fba ?? {}) }
        llm.value = { ...DEFAULT_LLM, ...(d.llm ?? {}) }
        learnedRules.value = Array.isArray(d.learnedRules)
          ? d.learnedRules.map((r: ScoringRules) => cloneRules(r))
          : []
        learning.value = { ...DEFAULT_LEARNING, ...(d.learning ?? {}) }
      }
      ready.value = true
    })()
  }

  function applyPreset(id: string) {
    const preset = RULE_PRESETS.find(p => p.id === id)
    if (preset) rules.value = cloneRules(preset)
  }

  /** 切换到任意一套规则（内置预设或学习产物），不修改原预设 */
  function applyRules(r: ScoringRules) {
    rules.value = cloneRules(r)
  }

  /** 把一次拟合结果登记为可复用的学习规则（按 id 去重） */
  function addLearnedRules(r: ScoringRules) {
    const next = cloneRules(r)
    learnedRules.value = [...learnedRules.value.filter(x => x.id !== next.id), next]
  }

  function reset() {
    rules.value = cloneRules(DEFAULT_RULES)
    fba.value = { ...DEFAULT_FBA_CONFIG }
    llm.value = { ...DEFAULT_LLM }
    learnedRules.value = []
    learning.value = { ...DEFAULT_LEARNING }
  }

  return { rules, fba, llm, learnedRules, learning, applyPreset, applyRules, addLearnedRules, reset }
})
