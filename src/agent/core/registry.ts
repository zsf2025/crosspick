import type { Tool, ToolContext, ToolResult } from './tool'
import type { Tracer } from './trace'

/**
 * 工具注册表：Agent 的核心扩展点。
 * 新增一个产品功能 = 往这里注册一个 tool，引擎代码不用动。
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): Tool[] {
    return [...this.tools.values()]
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  /** 生成给 LLM 看的工具清单（function calling 的文本版） */
  describe(): string {
    return this.list()
      .map(t => {
        const args = t.args
          ? Object.entries(t.args)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : '无'
        return `- ${t.name}: ${t.description}（参数 ${args}）`
      })
      .join('\n')
  }

  /**
   * 执行工具并写入 trace。
   * 工具抛异常不向上冒泡，而是转成带 warning 的空结果——单个工具失败不应让整轮对话崩掉。
   */
  async invoke(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult & { ok: boolean }> {
    const tool = this.tools.get(name)
    const tracer: Tracer = ctx.tracer
    if (!tool) {
      tracer.warning(`未注册的工具：${name}`)
      return { ok: false, message: '', warnings: [`未注册的工具：${name}`] }
    }
    tracer.action(`调用工具 ${tool.name}`, JSON.stringify(args))
    const started = Date.now()
    try {
      const result = await tool.run(args, ctx)
      tracer.recordToolCall({
        tool: name,
        args,
        ok: true,
        durationMs: Date.now() - started,
      })
      tracer.observation(`${tool.name} 完成`, result.message)
      return { ...result, ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      tracer.recordToolCall({
        tool: name,
        args,
        ok: false,
        durationMs: Date.now() - started,
      })
      tracer.warning(`${tool.name} 执行失败`, msg)
      return { ok: false, message: '', warnings: [`${tool.name} 执行失败：${msg}`] }
    }
  }
}

export function createRegistry(tools: Tool[]): ToolRegistry {
  const r = new ToolRegistry()
  for (const t of tools) r.register(t)
  return r
}
