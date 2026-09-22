/**
 * 极简测试框架。
 * 项目里装不了 vitest（沙箱拦截了 npm），这里用 esbuild 打包 + node 执行，
 * 提供 describe / it / assert 三件套，够覆盖领域层与 Agent 层的断言需求。
 */

export interface Case {
  name: string
  fn: () => void | Promise<void>
}

export interface Suite {
  name: string
  cases: Case[]
}

export const suites: Suite[] = []
let current: Suite | null = null

export function describe(name: string, fn: () => void) {
  current = { name, cases: [] }
  suites.push(current)
  fn()
  current = null
}

export function it(name: string, fn: () => void | Promise<void>) {
  if (!current) throw new Error(`it("${name}") 必须写在 describe 内部`)
  current.cases.push({ name, fn })
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

export function eq<T>(actual: T, expected: T, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} 期望 ${String(expected)}，实际 ${String(actual)}`)
  }
}

export function near(actual: number, expected: number, eps = 1e-6, msg = '') {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg} 期望 ≈${expected}，实际 ${actual}`)
  }
}

export function includes(haystack: string, needle: string, msg = '') {
  if (!haystack.includes(needle)) {
    throw new Error(`${msg} 期望包含「${needle}」，实际「${haystack}」`)
  }
}

export async function runAll(): Promise<number> {
  let pass = 0
  const failures: Array<{ suite: string; name: string; error: string }> = []

  for (const s of suites) {
    console.log(`\n  ${s.name}`)
    for (const c of s.cases) {
      try {
        await c.fn()
        pass += 1
        console.log(`    ✓ ${c.name}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failures.push({ suite: s.name, name: c.name, error: msg })
        console.log(`    ✗ ${c.name}`)
        console.log(`        ${msg}`)
      }
    }
  }

  const total = pass + failures.length
  console.log(`\n  ${pass}/${total} 通过`)
  if (failures.length) {
    console.log('\n  失败用例：')
    for (const f of failures) console.log(`    - [${f.suite}] ${f.name}: ${f.error}`)
    return 1
  }
  return 0
}
