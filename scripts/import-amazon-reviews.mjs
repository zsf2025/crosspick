#!/usr/bin/env node
/**
 * 从 Amazon Reviews 2023（McAuley Lab / HuggingFace）抽取一个类目，
 * 生成 crosspick 可直接导入的「长表」CSV（src/adapters/csv.ts 的 buildLong 格式）。
 *
 * 用法：
 *   node scripts/import-amazon-reviews.mjs --category All_Beauty --top 6
 *
 * 参数：
 *   --category       类目名（默认 All_Beauty），取值见数据集 all_categories.txt
 *   --top            每个细分类目取多少个候选（默认 6）
 *   --competitors    每个候选配多少个竞品（默认 4）
 *   --min-reviews    候选商品的全站评论数下限（默认 300，过滤冷门品）
 *   --max-reviews    评论文件最多扫描行数（默认 400000，到量即停）
 *   --cost-ratio     采购成本占位比例（默认 0.28，即售价的 28%）
 *   --out            输出路径（默认 data/amazon-<category>.csv）
 *
 * 流程：先扫元数据筛出热销品（含细分类目）→ 再扫评论只为这些商品攒痛点 → 按相似度配竞品。
 *
 * 数据来源与已知局限（务必先看）：
 *   1. 评论数据止于 2023-09。
 *   2. **采购成本拿不到**：用 售价 × cost-ratio 生成占位值，必须后续换成 1688 真实批发价。
 *   3. **月销量拿不到**：沿用项目既有启发式 reviewCount × 0.25，不是真实销量。
 *   4. 需求侧字段（评分/评论数/评论痛点）来自海外真实数据；供给侧字段（cost）只是估算。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const MIRROR = process.env.HF_MIRROR || 'https://hf-mirror.com'
const DATASET = 'McAuley-Lab/Amazon-Reviews-2023'

const argv = process.argv.slice(2)
function arg(name, dflt) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return dflt
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : dflt
}

const CATEGORY = arg('category', 'All_Beauty')
const TOP = Number(arg('top', 6))
const COMPETITORS = Number(arg('competitors', 4))
const MIN_REVIEW_COUNT = Number(arg('min-reviews', 100))
const MAX_REVIEWS = Number(arg('max-reviews', 1000000))
const COST_RATIO = Number(arg('cost-ratio', 0.28))
const MIN_SIM = Number(arg('min-sim', 0.08))
const OUT = resolve(process.cwd(), arg('out', `data/amazon-${CATEGORY}.csv`))
const KEEP_PER_LEAF = 120

const REVIEW_URL = `${MIRROR}/datasets/${DATASET}/resolve/main/raw/review_categories/${CATEGORY}.jsonl`
const META_URL = `${MIRROR}/datasets/${DATASET}/resolve/main/raw/meta_categories/meta_${CATEGORY}.jsonl`

const NEG_CUES = [
  'stopped working', 'doesn\'t work', 'didn\'t work', 'does not work', 'not work',
  'broke', 'broken', 'leak', 'leaking', 'crack', 'cracked', 'damaged', 'defective', 'faulty',
  'cheap', 'flimsy', 'fragile', 'waste', 'useless', 'disappointed', 'disappointing',
  'returned', 'returning', 'refund', 'smell', 'odor', 'stink', 'rash', 'irritation', 'irritated',
  'allergic', 'itchy', 'burning', 'burns', 'sticky', 'greasy', 'too dry', 'dry out',
  'hard to', 'difficult to', 'messy', 'clog', 'not as described', 'misleading',
  'fake', 'counterfeit', 'missing', 'too small', 'tiny', 'expensive', 'overpriced',
  'no effect', 'didn\'t help', 'doesn\'t last', 'faded', 'melted', 'arrived broken',
]

const POS_CUES = [
  'works well', 'works great', 'love it', 'love this', 'great', 'amazing', 'perfect',
  'soft', 'smooth', 'gentle', 'moisturizing', 'absorbs', 'hydrating', 'lightweight',
  'lasts long', 'long lasting', 'good value', 'worth', 'recommend', 'easy to',
  'effective', 'durable', 'sturdy', 'affordable', 'nice smell', 'smells great',
  'high quality', 'great quality', 'exactly as described',
]

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'on', 'to', 'by', 'is', 'are', 'this', 'that', 'it', 'its', 'from', 'as', 'at', 'be', 'pack', 'set', 'count'])

function tokens(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  )
}

/** 标题相似度：Jaccard，用于挑真正的同类竞品 */
function similarity(a, b) {
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

function countCues(texts, cues) {
  const low = texts.map(t => String(t).toLowerCase())
  const hits = []
  for (const cue of cues) {
    let n = 0
    for (const t of low) if (t.includes(cue)) n += 1
    if (n > 0) hits.push({ cue, n })
  }
  return hits.sort((a, b) => b.n - a.n)
}

/** 流式读取 JSONL：onLine 返回 false 即提前中断（不再下载剩余字节） */
async function streamJsonl(url, onLine, label) {
  const ctrl = new AbortController()
  const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${label} 请求失败：HTTP ${res.status}（${url}）`)
  const reader = res.body.getReader()
  const dec = new TextDecoder('utf-8')
  let buf = ''
  let bytes = 0
  let lines = 0
  let stop = false
  try {
    while (!stop) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        lines += 1
        if (onLine(line) === false) {
          stop = true
          break
        }
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* 已结束 */
    }
    ctrl.abort()
  }
  return { bytes, lines }
}

function parseWeightKg(details) {
  let d = details
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d)
    } catch {
      return 0
    }
  }
  if (!d || typeof d !== 'object') return 0
  for (const [k, v] of Object.entries(d)) {
    if (!/weight|dimension|size/i.test(k)) continue
    const s = String(v).toLowerCase()
    let m = s.match(/([\d.]+)\s*(pounds|lbs|lb)/)
    if (m) return Math.round(parseFloat(m[1]) * 0.4536 * 100) / 100
    m = s.match(/([\d.]+)\s*(ounces|oz)/)
    if (m) return Math.round(parseFloat(m[1]) * 0.02835 * 100) / 100
  }
  return 0
}

function parsePrice(v) {
  if (typeof v === 'number') return v
  const m = String(v ?? '').match(/[\d.]+/)
  return m ? parseFloat(m[0]) : 0
}

/** 取细分类目：categories 可能是 [["All Beauty","Hair Care",...]] 或 ["All Beauty",...] */
function leafCategory(cats, fallback) {
  if (!Array.isArray(cats) || !cats.length) return fallback
  let flat = cats
  if (Array.isArray(cats[0])) flat = cats.flat()
  const last = String(flat[flat.length - 1] ?? '')
  return last || fallback
}

const csvCell = v => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  console.log(`[1/4] 扫元数据：${CATEGORY}（筛评论数 ≥ ${MIN_REVIEW_COUNT} 的热销品）`)
  const byLeaf = new Map()
  const mStat = await streamJsonl(
    META_URL,
    line => {
      let o
      try {
        o = JSON.parse(line)
      } catch {
        return true
      }
      const asin = o.parent_asin || o.asin
      const rc = Number(o.rating_number) || 0
      const price = parsePrice(o.price)
      if (!asin || !(price > 0) || rc < MIN_REVIEW_COUNT) return true
      const leaf = leafCategory(o.categories, o.main_category || CATEGORY)
      const item = {
        asin,
        title: String(o.title ?? '').slice(0, 70).trim(),
        price,
        rating: Number(o.average_rating) || 0,
        reviewCount: rc,
        leaf,
        weightKg: parseWeightKg(o.details),
      }
      if (!item.title) return true
      const list = byLeaf.get(leaf) ?? []
      list.push(item)
      // 每个细分类目只保留最热的 KEEP_PER_LEAF 个，控制内存
      if (list.length > KEEP_PER_LEAF) {
        list.sort((a, b) => b.reviewCount - a.reviewCount)
        list.length = KEEP_PER_LEAF
      }
      byLeaf.set(leaf, list)
      return true
    },
    '元数据',
  )
  for (const list of byLeaf.values()) list.sort((a, b) => b.reviewCount - a.reviewCount)
  const allItems = [...byLeaf.values()].flat()
  console.log(
    `      下载 ${(mStat.bytes / 1e6).toFixed(1)} MB，解析 ${mStat.lines} 行 → ${allItems.length} 个热销品 / ${byLeaf.size} 个细分类目`,
  )
  if (!allItems.length) {
    console.error('没有筛出商品：可尝试调小 --min-reviews')
    process.exit(1)
  }

  const candidates = []
  for (const [leaf, list] of byLeaf) {
    if (list.length < 2) continue
    for (const item of list.slice(0, TOP)) candidates.push({ leaf, self: item, pool: list })
  }
  const targets = new Set(candidates.map(c => c.self.asin))

  console.log(`[2/4] 扫评论：只为 ${targets.size} 个候选攒痛点（最多 ${MAX_REVIEWS} 行）`)
  const agg = new Map()
  let scanned = 0
  let matched = 0
  const rStat = await streamJsonl(
    REVIEW_URL,
    line => {
      scanned += 1
      if (scanned > MAX_REVIEWS) return false
      let o
      try {
        o = JSON.parse(line)
      } catch {
        return true
      }
      const asin = o.parent_asin || o.asin
      if (!asin || !targets.has(asin)) return true
      matched += 1
      let p = agg.get(asin)
      if (!p) {
        p = { n: 0, neg: [], pos: [] }
        agg.set(asin, p)
      }
      p.n += 1
      const text = `${o.title ?? ''} ${o.text ?? ''}`
      const r = Number(o.rating) || 0
      if (r <= 3 && p.neg.length < 400) p.neg.push(text)
      else if (r >= 4 && p.pos.length < 400) p.pos.push(text)
      return true
    },
    '评论',
  )
  console.log(`      下载 ${(rStat.bytes / 1e6).toFixed(1)} MB，扫描 ${rStat.lines} 行，命中 ${matched} 条候选评论`)

  console.log(`[3/4] 按标题相似度配竞品`)
  const header =
    'id,name,category,cost,weightKg,keywords,asin,competitorTitle,price,rating,reviewCount,monthlySales,reviewPainPoints,reviewPositivePoints'
  const rows = [header]
  let emptyPain = 0
  let dropped = 0

  for (const { leaf, self, pool } of candidates) {
    const a = agg.get(self.asin)
    const neg = a
      ? countCues(a.neg, NEG_CUES)
          .slice(0, 3)
          .map(h => `${h.cue}|${h.n}`)
          .join('；')
      : ''
    const pos = a
      ? countCues(a.pos, POS_CUES)
          .slice(0, 2)
          .map(h => `${h.cue}|${h.n}`)
          .join('；')
      : ''
    if (!neg) emptyPain += 1

    const selfTokens = tokens(self.title)
    const rivals = pool
      .filter(x => x.asin !== self.asin)
      .map(x => ({ x, s: similarity(selfTokens, tokens(x.title)) }))
      .filter(r => r.s >= MIN_SIM)
      .sort((p, q) => q.s - p.s)
      .slice(0, COMPETITORS)
      .map(r => r.x)
    if (!rivals.length) {
      dropped += 1
      continue
    }

    const cost = Math.round(self.price * COST_RATIO * 100) / 100
    const kw = [...selfTokens].slice(0, 4).join('|')
    for (const r of rivals) {
      rows.push(
        [
          self.asin,
          self.title,
          leaf,
          cost,
          self.weightKg || 0.3,
          kw,
          r.asin,
          r.title,
          r.price,
          r.rating || 4.2,
          r.reviewCount,
          Math.round(r.reviewCount * 0.25),
          neg,
          pos,
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }

  console.log(`[4/4] 写出 CSV：${OUT}`)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, rows.join('\n') + '\n', 'utf-8')

  console.log(`\n完成：${candidates.length} 个候选 / ${rows.length - 1} 行竞品 → ${OUT}`)
  if (emptyPain) console.log(`提示：${emptyPain} 个候选没攒到足够差评，痛点列为空（可调大 --max-reviews）`)
  if (dropped) console.log(`提示：${dropped} 个候选因找不到相似度 ≥ ${MIN_SIM} 的同类竞品被丢弃（可调小 --min-sim）`)
  console.log(`\n⚠ 三条必须知道的局限：`)
  console.log(`  1. cost 是占位估算（售价 × ${COST_RATIO}），真实采购成本要换成 1688 批发价`)
  console.log(`  2. monthlySales 用项目既有启发式 reviewCount × 0.25，不是真实月销量`)
  console.log(`  3. 评论数据止于 2023-09，本次扫描 ${rStat.lines} 行评论`)
  console.log(`\n导入：应用内「导入 CSV」选该文件（长表格式，含 asin 列会自动识别）`)
}

main().catch(err => {
  console.error('失败：', err?.message ?? err)
  process.exit(1)
})
