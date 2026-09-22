/**
 * 集成检查：用真实 Ollama 跑一遍 Agent，验证 LLM 相关路径确实可用。
 * 单元测试用的是 NullProvider（不碰网络），这里补上真实模型链路。
 *
 *   node scripts/integration-check.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
register('./ts-hooks.mjs', pathToFileURL(`${here}/`).href)

const { OllamaProvider } = await import('../src/agent/core/llm.ts')
const { runAgent } = await import('../src/agent/run.ts')
const { ConversationMemory } = await import('../src/agent/core/memory.ts')
const { mockProducts } = await import('../src/adapters/mock.ts')
const { DEFAULT_RULES } = await import('../src/domain/rules.ts')

const llm = new OllamaProvider()
const ok = await llm.health()

if (!ok) {
  console.log('\n  Ollama 未启动（127.0.0.1:11434），跳过集成检查')
  console.log('  本地跑：ollama serve && ollama pull qwen2.5:1.5b\n')
  process.exit(0)
}

console.log('\n  Ollama 已连接，开始集成检查\n')

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`    ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`    ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const products = mockProducts()
const memory = new ConversationMemory()

// 1. 规则路由 + 真实模型做评论洞察（含流式）
{
  const chunks = []
  const { output } = await runAgent({
    query: '分析台灯的评论痛点',
    candidates: products,
    rules: DEFAULT_RULES,
    llm,
    memory,
    onDelta: c => chunks.push(c),
  })
  check('意图判定为 review', output.action === 'review', output.action)
  check('规则命中而非模型兜底', output.routedBy === 'rule', output.routedBy)
  check('定位到 p1', output.review?.productId === 'p1', String(output.review?.productId))
  check('产出改进建议', (output.review?.suggestions.length ?? 0) > 0, `${output.review?.suggestions.length ?? 0} 条`)
  check('流式回调收到数据', chunks.length > 0, `${chunks.length} 个分片`)
  if (output.review?.suggestions.length) {
    console.log(`        建议示例：${output.review.suggestions[0]}`)
  }
}

// 2. 规则未命中时由模型兜底判意图
{
  const { output } = await runAgent({
    query: '这个品到底有没有搞头',
    candidates: products,
    rules: DEFAULT_RULES,
    llm,
    memory,
  })
  check('模型兜底路由生效', output.routedBy === 'llm' || output.routedBy === 'fallback', output.routedBy)
  check('最终给出可执行动作或追问', ['score', 'price', 'review', 'compare', 'report', 'mutate', 'clarify'].includes(output.action), output.action)
  console.log(`        模型判定：${output.action}（${output.routedBy}）`)
}

// 3. 多轮指代依赖上一轮记忆
{
  const { output } = await runAgent({
    query: '给它定价',
    candidates: products,
    rules: DEFAULT_RULES,
    llm,
    memory,
  })
  check('指代"它"被解析到商品', output.pricing !== undefined, output.pricing?.productName ?? '未定位到')
}

// 4. 自主能力：开启反思后，模型可能补调工具，但必须受控
{
  const { output } = await runAgent({
    query: '帮我看看第一个品值不值得做，顺便给个定价建议',
    candidates: products,
    rules: DEFAULT_RULES,
    llm,
    memory,
    reflect: true,
    maxRounds: 2,
  })
  check('反思块被记录', output.reflection !== undefined)
  check('反思轮次不超过上限', (output.reflection?.rounds ?? 0) <= 2, `${output.reflection?.rounds ?? 0} 轮`)
  check(
    '补调的工具都是已注册的',
    (output.reflection?.addedTools ?? []).every(t =>
      ['score', 'price', 'review', 'compare', 'report'].includes(t),
    ),
    output.reflection?.addedTools.join('、') || '无补调',
  )
  check('副作用工具未被自动补调', !(output.reflection?.addedTools ?? []).includes('mutate'))
  console.log(`        反思 ${output.reflection?.rounds ?? 0} 轮，补调：${output.reflection?.addedTools.join('、') || '无'}`)
  console.log(`        工具序列：${output.toolCalls.map(t => t.tool).join(' → ')}`)
}

// 5. 直接探测反思判断：小模型通常偏保守，这里只验证链路通、输出可解析
{
  const { reflectNext } = await import('../src/agent/core/loop.ts')
  const { createDefaultRegistry } = await import('../src/agent/tools/index.ts')
  const { Tracer } = await import('../src/agent/core/trace.ts')
  const { DEFAULT_FBA_CONFIG } = await import('../src/domain/fba.ts')
  const ctx = {
    query: '这个品值不值得做，成本能不能Cover住',
    candidates: products,
    rules: DEFAULT_RULES,
    fba: DEFAULT_FBA_CONFIG,
    llm,
    tracer: new Tracer(),
    resolveTarget: () => null,
    mutate: () => undefined,
  }
  const decision = await reflectNext(ctx, createDefaultRegistry(), [
    { tool: 'score', message: '已对 5 个候选品评分，第一名 LED Desk Lamp（68 分）' },
  ])
  check('反思返回结构化判断', typeof decision.done === 'boolean', JSON.stringify(decision))
  console.log(`        模型判断：done=${decision.done}，补调 ${decision.next.map(s => s.tool).join('、') || '无'}`)
}

console.log('')
if (failures) {
  console.log(`  集成检查失败 ${failures} 项\n`)
  process.exit(1)
}
console.log('  集成检查全部通过\n')
