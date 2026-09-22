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

function load(): {
  rules: ScoringRules
  fba: FbaConfig
  llm: LlmSettings
  learnedRules: ScoringRules[]
} | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      rules: { ...cloneRules(DEFAULT_RULES), ...(parsed.rules ?? {}) },
      fba: { ...DEFAULT_FBA_CONFIG, ...(parsed.fba ?? {}) },
      llm: { ...DEFAULT_LLM, ...(parsed.llm ?? {}) },
      learnedRules: Array.isArray(parsed.learnedRules)
        ? parsed.learnedRules.map((r: ScoringRules) => cloneRules(r))
        : [],
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
  const learnedRules = ref<ScoringRules[]>(saved?.learnedRules ?? [])

  watch(
    [rules, fba, llm, learnedRules],
    () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            rules: rules.value,
            fba: fba.value,
            llm: llm.value,
            learnedRules: learnedRules.value,
          }),
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
  }

  return { rules, fba, llm, learnedRules, applyPreset, applyRules, addLearnedRules, reset }
})
