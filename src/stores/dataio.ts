/**
 * 数据备份 / 迁移：把全部业务数据（候选品库 + 设置 + 学习规则 + 学习阈值）
 * 导出为单个 JSON 文件，并支持导入恢复。与底层存储（IndexedDB / localStorage）无关，
 * 因此换浏览器、清缓存后也能用导入把数据搬回来。
 */
import { useCatalogStore } from './catalog'
import { useSettingsStore } from './settings'
import type { ProductCandidate } from '@/types/product'
import type { AgentOutput } from '@/types/agent'
import type { ScoringRules } from '@/domain/rules'
import type { FbaConfig } from '@/domain/fba'
import type { LlmSettings, ModelProvider } from './settings'
import type { LearningConfig } from '@/domain/learning'

export const BACKUP_VERSION = 1

export interface CatalogBackup {
  candidates: ProductCandidate[]
  selectedId: string | null
  history: AgentOutput[]
}

export interface SettingsBackup {
  rules: ScoringRules
  fba: FbaConfig
  llm: LlmSettings
  learnedRules: ScoringRules[]
  learning: LearningConfig
}

export interface Backup {
  app: 'crosspick'
  version: number
  exportedAt: string
  catalog: CatalogBackup
  settings: SettingsBackup
}

export function buildBackup(): Backup {
  const catalog = useCatalogStore()
  const settings = useSettingsStore()
  return {
    app: 'crosspick',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    catalog: {
      candidates: catalog.candidates,
      selectedId: catalog.selectedId,
      history: catalog.history,
    },
    settings: {
      rules: settings.rules,
      fba: settings.fba,
      llm: settings.llm,
      learnedRules: settings.learnedRules,
      learning: settings.learning,
    },
  }
}

export interface ApplyResult {
  ok: boolean
  error?: string
}

/** 宽松校验，避免导入损坏文件把当前数据搞乱 */
function validate(b: unknown): b is Backup {
  if (!b || typeof b !== 'object') return false
  const o = b as Record<string, unknown>
  if (o.app !== 'crosspick') return false
  if (!o.catalog || !Array.isArray((o.catalog as { candidates?: unknown }).candidates)) return false
  if (!o.settings) return false
  return true
}

export function applyBackup(raw: unknown): ApplyResult {
  if (!validate(raw)) {
    return { ok: false, error: '文件格式不正确或不是 CrossPick 备份' }
  }
  const b = raw as Backup
  const catalog = useCatalogStore()
  const settings = useSettingsStore()

  catalog.setCandidates(
    (b.catalog.candidates as ProductCandidate[]).map(c => ({
      ...c,
      snapshots: c.snapshots ?? [],
      scores: c.scores,
      totalScore: c.totalScore,
    })),
  )
  if (b.catalog.selectedId) catalog.select(b.catalog.selectedId)
  catalog.history.splice(0, catalog.history.length, ...(b.catalog.history ?? []))

  settings.rules = b.settings.rules
  settings.fba = b.settings.fba
  settings.llm = normalizeLlm(b.settings.llm)
  settings.learnedRules = b.settings.learnedRules ?? []
  settings.learning = b.settings.learning ?? { salesTarget: 300, goodRating: 4.0 }

  // 导入后按新规则重算，保证分数与规则一致
  catalog.rescore(settings.rules)
  return { ok: true }
}

/** 兼容旧备份缺字段：补齐 provider 等默认值，避免 UI 绑到 undefined */
function normalizeLlm(llm: Partial<LlmSettings> | undefined): LlmSettings {
  const base: LlmSettings = {
    provider: 'ollama' as ModelProvider,
    baseUrl: 'http://127.0.0.1:11434/api',
    model: 'qwen2.5:1.5b',
    cloudBaseUrl: 'https://api.openai.com/v1',
    cloudApiKey: '',
    cloudModel: 'gpt-4o-mini',
    useLlmPlanner: false,
    preferFunctionCalling: true,
    stream: true,
    autonomous: false,
    maxRounds: 2,
    summarize: true,
  }
  return { ...base, ...(llm ?? {}) }
}

/** 浏览器环境：把备份下载为 JSON 文件（Node / 测试环境不调用） */
export function downloadBackup(): void {
  if (typeof document === 'undefined') return
  const data = buildBackup()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `crosspick-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
