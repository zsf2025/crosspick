/**
 * Agent 运行期错误类型。
 * 集中放这里是为了让"取消"在编排层、LLM 层、UI 层都能用同一个判定函数识别。
 */

/** 用户主动取消（AbortController.abort）时抛出/识别的错误 */
export class AgentAbortError extends Error {
  readonly name = 'AbortError'
  constructor(message = '已取消') {
    super(message)
  }
}

/**
 * 统一识别"这是一次取消"——来源可能是：
 * - 我们自己抛的 AgentAbortError；
 * - 浏览器/Node 原生的 DOMException（name === 'AbortError'）；
 * - axios 被 signal 中断时抛的 CanceledError（code === 'ERR_CANCELED'）。
 */
export function isAbort(e: unknown): boolean {
  if (e instanceof AgentAbortError) return true
  const anyE = e as { name?: string; code?: string } | null
  if (!anyE) return false
  if (anyE.name === 'AbortError') return true
  if (anyE.code === 'ERR_CANCELED') return true
  return false
}
