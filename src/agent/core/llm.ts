import axios from 'axios'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface UsageCounter {
  llmCalls: number
  promptChars: number
  completionChars: number
}

export interface LLMProvider {
  readonly name: string
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>
  chatJson<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T | null>
  stream(
    messages: ChatMessage[],
    options: ChatOptions,
    onDelta: (chunk: string) => void,
  ): Promise<string>
  health(): Promise<boolean>
}

export interface OllamaConfig {
  baseUrl: string
  model: string
  timeoutMs: number
}

export const DEFAULT_OLLAMA: OllamaConfig = {
  baseUrl: 'http://127.0.0.1:11434/api',
  model: 'qwen2.5:1.5b',
  timeoutMs: 180000,
}

/** 从模型输出里剥离 ```json 代码块，再做一次 JSON.parse 尝试 */
export function extractJson(raw: string): unknown | null {
  const text = raw.trim()
  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim())
      } catch {
        /* 落到下面的裸对象提取 */
      }
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama'
  private cfg: OllamaConfig
  private usage: UsageCounter | undefined
  private healthCache: { ok: boolean; at: number } | null = null

  constructor(cfg: OllamaConfig = DEFAULT_OLLAMA, usage?: UsageCounter) {
    this.cfg = cfg
    this.usage = usage
  }

  configure(patch: Partial<OllamaConfig>) {
    this.cfg = { ...this.cfg, ...patch }
    this.healthCache = null
  }

  get config(): OllamaConfig {
    return this.cfg
  }

  private countPrompt(messages: ChatMessage[]) {
    if (!this.usage) return
    this.usage.llmCalls += 1
    this.usage.promptChars += messages.reduce((s, m) => s + m.content.length, 0)
  }

  private countCompletion(text: string) {
    if (this.usage) this.usage.completionChars += text.length
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    this.countPrompt(messages)
    const resp = await axios.post(
      `${this.cfg.baseUrl}/chat`,
      {
        model: this.cfg.model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: options.maxTokens ?? 2048,
          num_ctx: 8192,
        },
      },
      { timeout: this.cfg.timeoutMs },
    )
    const text = (resp.data?.message?.content ?? '') as string
    this.countCompletion(text)
    return text
  }

  async stream(
    messages: ChatMessage[],
    options: ChatOptions = {},
    onDelta: (chunk: string) => void,
  ): Promise<string> {
    const resp = await axios.post(
      `${this.cfg.baseUrl}/chat`,
      {
        model: this.cfg.model,
        messages,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: options.maxTokens ?? 2048,
          num_ctx: 8192,
        },
      },
      {
        timeout: this.cfg.timeoutMs,
        responseType: 'stream',
        adapter: 'fetch',
      } as never,
    )
    const reader = (resp.data as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let full = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          const delta = obj?.message?.content ?? ''
          if (delta) {
            full += delta
            onDelta(delta)
          }
        } catch {
          /* 忽略半行 */
        }
      }
    }
    return full
  }

  /** 结构化输出：解析失败会带着"只输出 JSON"的指令重试一次，仍失败返回 null */
  async chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T | null> {
    const first = await this.chat(messages, {
      temperature: options.temperature ?? 0,
      maxTokens: options.maxTokens ?? 1024,
    })
    const parsed = extractJson(first)
    if (parsed !== null) return parsed as T

    const retry = await this.chat(
      [
        ...messages,
        { role: 'system', content: '请只输出合法的 JSON，不要包含任何解释文字或代码块标记。' },
      ],
      { temperature: 0, maxTokens: options.maxTokens ?? 1024 },
    )
    const parsed2 = extractJson(retry)
    return (parsed2 as T) ?? null
  }

  async health(): Promise<boolean> {
    const now = Date.now()
    if (this.healthCache && now - this.healthCache.at < 10000) {
      return this.healthCache.ok
    }
    try {
      await axios.get(`${this.cfg.baseUrl}/tags`, { timeout: 3000 })
      this.healthCache = { ok: true, at: now }
      return true
    } catch {
      this.healthCache = { ok: false, at: now }
      return false
    }
  }
}

/** 无模型环境下的替身：让路由降级路径可测、可演示 */
export class NullProvider implements LLMProvider {
  readonly name = 'null'
  async chat(): Promise<string> {
    return ''
  }
  async chatJson<T>(): Promise<T | null> {
    return null
  }
  async stream(
    _m: ChatMessage[],
    _o: ChatOptions,
    _cb: (chunk: string) => void,
  ): Promise<string> {
    return ''
  }
  async health(): Promise<boolean> {
    return false
  }
}

let current: LLMProvider = new OllamaProvider()

export function getLLM(): LLMProvider {
  return current
}

export function setLLM(p: LLMProvider) {
  current = p
}

export function createOllamaProvider(cfg?: Partial<OllamaConfig>, usage?: UsageCounter) {
  return new OllamaProvider({ ...DEFAULT_OLLAMA, ...cfg }, usage)
}
