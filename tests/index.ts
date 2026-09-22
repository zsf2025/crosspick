import { runAll } from './harness'

// 统一注入 localStorage 内存 shim：Node 无浏览器存储；放在所有 test 模块加载之后、
// runAll 之前，避免多个 test 文件各自定义并相互覆盖（否则写入与断言指向不同 Map）。
const _mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => _mem.get(k) ?? null,
  setItem: (k: string, v: string) => void _mem.set(k, v),
  removeItem: (k: string) => void _mem.delete(k),
  clear: () => _mem.clear(),
  key: () => null,
  length: 0,
}

import './domain.test'
import './router.test'
import './csv.test'
import './agent.test'
import './autonomy.test'
import './summary.test'
import './store.test'
import './eval.test'
import './learning.test'
import './dataio.test'
import './llm.test'

const code = await runAll()
process.exit(code)
