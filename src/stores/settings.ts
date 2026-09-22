import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { DEFAULT_RULES, RULE_PRESETS, cloneRules } from '@/domain/rules'
import type { ScoringRules } from '@/domain/rules'
import { DEFAULT_FBA_CONFIG } from '@/domain/fba'
import type { FbaConfig } from '@/domain/fba'
import { DEFAULT_OLLAMA } from '@/agent/core/llm'

const KEY = 'crosspick.settings.v1'

export interface LlmSettings {
  baseUrl: string
  model: string
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
  baseUrl: DEFAULT_OLLAMA.baseUrl,
  model: DEFAULT_OLLAMA.model,
  useLlmPlanner: false,
  stream: true,
  autonomous: false,
  maxRounds: 2,
  summarize: true,
}

function load(): { rules: ScoringRules; fba: FbaConfig; llm: LlmSettings } | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      rules: { ...cloneRules(DEFAULT_RULES), ...(parsed.rules ?? {}) },
      fba: { ...DEFAULT_FBA_CONFIG, ...(parsed.fba ?? {}) },
      llm: { ...DEFAULT_LLM, ...(parsed.llm ?? {}) },
    }
  } catch {
    return null
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = load()
  const rules = ref<ScoringRules>(saved?.rules ?? cloneRules(DEFAULT_RULES))
  const fba = ref<FbaConfig>(saved?.fba ?? { ...DEFAULT_FBA_CONFIG })
  const llm = ref<LlmSettings>(saved?.llm ?? { ...DEFAULT_LLM })

  watch(
    [rules, fba, llm],
    () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ rules: rules.value, fba: fba.value, llm: llm.value }),
        )
      } catch {
        /* 存储配额满时静默失败，不影响主流程 */
      }
    },
    { deep: true },
  )

  function applyPreset(id: string) {
    const preset = RULE_PRESETS.find(p => p.id === id)
    if (preset) rules.value = cloneRules(preset)
  }

  function reset() {
    rules.value = cloneRules(DEFAULT_RULES)
    fba.value = { ...DEFAULT_FBA_CONFIG }
    llm.value = { ...DEFAULT_LLM }
  }

  return { rules, fba, llm, applyPreset, reset }
})
