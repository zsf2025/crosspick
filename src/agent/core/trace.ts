import type { TraceStep, ToolCallRecord } from '@/types/agent'
import { emptyUsage } from '@/types/agent'

/**
 * 一次 Agent 运行的可观测性收集器。
 * trace 用于 UI 思考链展示，usage 用于成本统计，两者都是 Agent 工程的必备件。
 */
export class Tracer {
  readonly steps: TraceStep[] = []
  readonly toolCalls: ToolCallRecord[] = []
  readonly usage = emptyUsage()

  private push(kind: TraceStep['kind'], label: string, detail?: string) {
    this.steps.push({ kind, label, detail, at: new Date().toISOString() })
  }

  thought(label: string, detail?: string) {
    this.push('thought', label, detail)
  }

  action(label: string, detail?: string) {
    this.push('action', label, detail)
  }

  observation(label: string, detail?: string) {
    this.push('observation', label, detail)
  }

  warning(label: string, detail?: string) {
    this.push('warning', label, detail)
  }

  final(label: string, detail?: string) {
    this.push('final', label, detail)
  }

  recordLlmCall(promptChars: number, completionChars: number) {
    this.usage.llmCalls += 1
    this.usage.promptChars += promptChars
    this.usage.completionChars += completionChars
  }

  recordToolCall(record: ToolCallRecord) {
    this.toolCalls.push(record)
  }

  /** 计时执行一个工具，异常在工具层已捕获时这里只负责记录耗时 */
  async measure<T>(tool: string, args: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const started = Date.now()
    let ok = true
    try {
      return await fn()
    } catch (e) {
      ok = false
      throw e
    } finally {
      this.recordToolCall({ tool, args, ok, durationMs: Date.now() - started })
    }
  }
}
