import { describe, it, assert, eq } from './harness'
import type { LlmSettings } from '@/stores/settings'

const { OllamaProvider, CloudProvider, FallbackProvider, buildFromSettings } =
  await import('@/agent/core/llm')

function llm(partial: Partial<LlmSettings>): LlmSettings {
  return {
    provider: 'ollama',
    baseUrl: 'http://x',
    model: 'm',
    cloudBaseUrl: '',
    cloudApiKey: '',
    cloudModel: '',
    useLlmPlanner: false,
    stream: true,
    autonomous: false,
    maxRounds: 2,
    summarize: true,
    ...partial,
  }
}

describe('模型 Provider 构建', () => {
  it('provider=ollama 返回本地 Provider', () => {
    assert(buildFromSettings(llm({ provider: 'ollama' })) instanceof OllamaProvider)
  })

  it('provider=cloud 且填了 Key 返回云端 Provider', () => {
    const p = buildFromSettings(
      llm({ provider: 'cloud', cloudBaseUrl: 'https://api.y/v1', cloudApiKey: 'sk-123', cloudModel: 'gpt-4o-mini' }),
    )
    assert(p instanceof CloudProvider, '应为 CloudProvider')
  })

  it('provider=cloud 但没填 Key 退化为本地', () => {
    assert(buildFromSettings(llm({ provider: 'cloud' })) instanceof OllamaProvider, '无 Key 应退化本地')
  })

  it('provider=auto 返回兜底 Provider', () => {
    const p = buildFromSettings(
      llm({ provider: 'auto', cloudBaseUrl: 'https://api.y/v1', cloudApiKey: 'sk-123', cloudModel: 'gpt-4o-mini' }),
    )
    assert(p instanceof FallbackProvider, '应为 FallbackProvider')
  })

  it('auto 但无云端 Key 仍返回兜底 Provider（本地优先，不抛）', () => {
    const p = buildFromSettings(llm({ provider: 'auto' }))
    assert(p instanceof FallbackProvider, '应为 FallbackProvider（内部本地优先）')
  })
})
