import type { Tool } from '../core/tool'
import type { CandidateStatus } from '@/types/product'

const REJECT_WORDS = ['淘汰', '放弃', '不做', '排除', '删掉', '去掉']
const WATCH_WORDS = ['观察', '观望', '待定', '再看看']
const RESTORE_WORDS = ['恢复', '重新考虑', '重启', '加回来']

export function detectStatus(query: string): CandidateStatus | null {
  if (REJECT_WORDS.some(w => query.includes(w))) return 'rejected'
  if (WATCH_WORDS.some(w => query.includes(w))) return 'watching'
  if (RESTORE_WORDS.some(w => query.includes(w))) return 'active'
  return null
}

/** 从"给 X 打上 Y 标签"这类说法里提取标签名 */
export function detectTag(query: string): string | null {
  const patterns = [
    /(?:打上|打个|加上|加个|标记|打|加)\s*([^\s，,。]+?)\s*标签/,
    /标签[：: ]\s*([^\s，,。]+)/,
  ]
  for (const re of patterns) {
    const m = query.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}

export const mutateTool: Tool = {
  name: 'mutate',
  description: '按用户指令修改候选品状态（淘汰 / 观察 / 恢复）或打标签',
  args: {},
  async run(_args, ctx) {
    const target = ctx.resolveTarget(ctx.query)
    if (!target) {
      return { message: '', warnings: ['没听出要操作哪个商品，请说明商品名称'] }
    }
    const status = detectStatus(ctx.query)
    const tag = detectTag(ctx.query)
    if (!status && !tag) {
      return {
        message: '',
        warnings: ['无法识别要做的修改，可试试"把台灯淘汰掉"或"给台灯打上旺季标签"'],
      }
    }
    if (status) ctx.mutate(target.id, 'status', status)
    if (tag) ctx.mutate(target.id, 'tag', tag)
    return {
      message: `已更新「${target.name}」${[status ? `状态为${status}` : '', tag ? `标签 ${tag}` : ''].filter(Boolean).join('，')}`,
    }
  },
}
