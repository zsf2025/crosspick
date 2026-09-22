/**
 * 测试入口：node scripts/run-tests.mjs
 * 走 ts-hooks 直接执行 tests/ 下的 TypeScript 用例。
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

register('./ts-hooks.mjs', pathToFileURL(here + '/').href)

await import(pathToFileURL(resolve(here, '..', 'tests', 'index.ts')).href)
