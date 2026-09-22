/**
 * Node 模块钩子：让 node 能直接执行 .ts 测试文件，并解析 @/ 别名。
 *
 * 沙箱里装不了 vitest / tsx，typescript 本身已在依赖里，
 * 用 transpileModule 做类型擦除（不做类型检查，类型检查交给 vue-tsc）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import ts from 'typescript'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = resolvePath(ROOT, 'src')

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  resolveJsonModule: true,
  isolatedModules: true,
}

/** 依次尝试 x.ts / x/index.ts / x 本身 */
function resolveFile(basePath) {
  if (existsSync(`${basePath}.ts`)) return `${basePath}.ts`
  if (existsSync(resolvePath(basePath, 'index.ts'))) return resolvePath(basePath, 'index.ts')
  if (existsSync(basePath)) return basePath
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const hit = resolveFile(resolvePath(SRC_DIR, specifier.slice(2)))
    if (hit) return nextResolve(pathToFileURL(hit).href, context)
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const url = new URL(specifier, context.parentURL)
    const hit = resolveFile(fileURLToPath(url))
    if (hit) return nextResolve(pathToFileURL(hit).href, context)
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const filename = fileURLToPath(url)
    const source = readFileSync(filename, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: COMPILER_OPTIONS,
      fileName: filename,
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
