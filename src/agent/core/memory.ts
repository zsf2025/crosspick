import type { AgentAction } from '@/types/agent'

export interface MemoryTurn {
  query: string
  action: AgentAction
  targetId: string | null
  at: string
}

const ORDINAL_MAP: Record<string, number> = {
  第一个: 0,
  第二个: 1,
  第三个: 2,
  第四个: 3,
  第五个: 4,
  第1个: 0,
  第2个: 1,
  第3个: 2,
  第4个: 3,
  第5个: 4,
}

const REFERENTIAL = ['它', '这个', '那个', '上面', '刚才', '上一个', '前者', '后者']

/**
 * 会话记忆：既服务于多轮对话，也服务于指代消解。
 * 内部只存索引与 id，不存整个商品对象，避免快照过期。
 */
export class ConversationMemory {
  readonly turns: MemoryTurn[] = []

  push(turn: Omit<MemoryTurn, 'at'>) {
    this.turns.push({ ...turn, at: new Date().toISOString() })
    if (this.turns.length > 50) this.turns.shift()
  }

  get lastTargetId(): string | null {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].targetId) return this.turns[i].targetId
    }
    return null
  }

  get lastAction(): AgentAction | null {
    return this.turns.length ? this.turns[this.turns.length - 1].action : null
  }

  /** "第二个" → 1；没有序数词返回 null */
  ordinalIndex(query: string): number | null {
    for (const [word, idx] of Object.entries(ORDINAL_MAP)) {
      if (query.includes(word)) return idx
    }
    return null
  }

  /** 是否包含指代词（它 / 这个 / 刚才那个…） */
  isReferential(query: string): boolean {
    return REFERENTIAL.some(w => query.includes(w))
  }

  /** 生成给 LLM 的会话摘要（只保留最近若干轮，控制 token） */
  summary(limit = 5): string {
    const recent = this.turns.slice(-limit)
    if (!recent.length) return ''
    return recent
      .map(t => `用户：${t.query}\n系统动作：${t.action}${t.targetId ? `（目标 ${t.targetId}）` : ''}`)
      .join('\n')
  }

  clear() {
    this.turns.length = 0
  }
}
