/**
 * 单句探针：用真实 Ollama 跑一句话，打印路由 / 计划 / 反思 / 产出。
 * 用法：node scripts/probe-query.mjs "帮我看看第一个品值不值得做" [reflect]
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
register('./ts-hooks.mjs', pathToFileURL(here + '/').href)

const query = process.argv[2] ?? '帮我看看第一个品值不值得做'
const reflect = (process.argv[3] ?? 'off') === 'on'

const { runAgent } = await import(pathToFileURL(resolve(here, '..', 'src', 'agent', 'run.ts')).href)
const { OllamaProvider, DEFAULT_OLLAMA } = await import(
  pathToFileURL(resolve(here, '..', 'src', 'agent', 'core', 'llm.ts')).href
)
const { mockProducts } = await import(
  pathToFileURL(resolve(here, '..', 'src', 'adapters', 'mock.ts')).href
)
const { ruleRoute, resolveTargetId } = await import(
  pathToFileURL(resolve(here, '..', 'src', 'agent', 'router.ts')).href
)
const { rulePlan } = await import(
  pathToFileURL(resolve(here, '..', 'src', 'agent', 'core', 'loop.ts')).href
)

const llm = new OllamaProvider(DEFAULT_OLLAMA)
const candidates = mockProducts()

console.log('='.repeat(64))
console.log('输入：', query)
console.log('反思开关：', reflect ? '开' : '关')
console.log('-'.repeat(64))
console.log('规则路由命中：', ruleRoute(query))
console.log('规则定位目标：', resolveTargetId(query, candidates, undefined))
console.log('规则计划：', JSON.stringify(rulePlan(ruleRoute(query) ?? 'score', resolveTargetId(query, candidates, undefined))))
console.log('-'.repeat(64))

let summaryStream = ''
const { output } = await runAgent({
  query,
  candidates,
  llm,
  reflect,
  maxRounds: 3,
  onSummaryDelta: c => {
    summaryStream += c
  },
})

console.log('最终意图：', output.action, '| 路由方式：', output.routedBy, '| 目标 id：', output.targetId ?? '（无）')
console.log('工具调用：', output.toolCalls.map(t => `${t.tool}(${t.ok ? 'ok' : 'fail'} ${t.ms}ms)`).join(' → ') || '（无）')
console.log('反思：', output.reflection ? `${output.reflection.rounds} 轮，补调 [${output.reflection.addedTools.join(', ') || '无'}]` : '未开启')
console.log('结论：')
for (const r of output.reasoning.slice(0, 6)) console.log('  ·', r)
console.log('模型总结：', output.summary ?? '（无）')
console.log('总结流式分片：', summaryStream.length, '字符，与最终一致：', summaryStream === (output.summary ?? ''))
console.log('-'.repeat(64))
console.log('完整思考链：')
for (const s of output.trace) {
  console.log(`  [${s.kind}] ${s.text ?? ''}${s.detail ? ' — ' + s.detail : ''}`)
}
console.log('='.repeat(64))
