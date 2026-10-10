#!/usr/bin/env node
/**
 * ── 机制地图生成器：它必须【从代码取真值】，且必须【诚实地说出缺口】──────────────
 *
 * ── 它防的是什么 ────────────────────────────────────────────────────────────
 *
 * `scripts/mechanisms-html.mjs` 这张页的价值**完全建立在**「它与代码不会分叉」上。
 * 而一个"看起来像清单"的页最容易坏的方式是：它变成了**第二份手写真相** ——
 * 于是它读起来权威、而内容过期，比没有这张页更坏。
 *
 * ⇒ 所以下面每一条臂钉的都是「它必须重新算，而不是抄」：
 *
 *   ① 判据数必须等于**注册表**的数（不是常数、不是 ALL_GATES 的字面长度）
 *   ② ★ 未接线的判据必须**真的被列出来**（这一格是本项目反复复发的病）
 *   ③ prompt 规则必须**直接从产品函数**取（加一条规则 ⇒ 页上必须多一条）
 *   ④ ★ 三态不同形：`mechanical` 不许吞掉 `partial` / `prose-only`
 *
 * ── ★ 第 ④ 条为什么是本文件最重要的断言 ──────────────────────────────────────
 *
 *   本项目最贵的那条合流是「把『没测到』并进『通过』」。
 *   这张页上同形的诱惑是：把 `partial` 与 `prose-only` 一并算成"有机制"，
 *   那样统计会很好看，而它恰好抹掉用户提出的那个问题 ——
 *   「有的机制只是 prompt 里的一句话」。⇒ 三态必须各自可数、且合计等于总数。
 *
 * Run: node --test scripts/mechanisms-html.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GEN = join(ROOT, 'scripts', 'mechanisms-html.mjs')

/** 跑生成器，返回 { out, html }。输出路径给临时目录，绝不覆盖 docs/。 */
function generate() {
  const dir = mkdtempSync(join(tmpdir(), 'mechanisms-html-'))
  const out = join(dir, 'mechanisms.html')
  const stdout = execFileSync(process.execPath, [GEN, out], { cwd: ROOT, encoding: 'utf8' })
  const html = existsSync(out) ? readFileSync(out, 'utf8') : ''
  rmSync(dir, { recursive: true, force: true })
  return { stdout, html }
}

/** 从生成器 stdout 里读回它自己报的计数（`key=value`，空格分隔）。 */
function parseCounts(stdout) {
  const line = stdout.split('\n').find((l) => l.includes('gates=')) ?? ''
  const out = {}
  for (const m of line.matchAll(/([A-Za-z][A-Za-z-]*)=(\d+)/g)) out[m[1]] = Number(m[2])
  return out
}

/** 真值：注册表里到底有多少条判据。★ 这是唯一允许用来比对的来源。 */
async function wiredGateCount() {
  const mod = await import(new URL('../lib/gates/index.js', import.meta.url).href)
  const listed = mod.buildRegistry().list()
  let n = 0
  for (const arr of Object.values(listed)) n += arr.length
  return { total: n, byPoint: listed }
}

test('臂 1 ★ 判据数来自注册表，而不是写死的常数', async () => {
  const { stdout, html } = generate()
  const counts = parseCounts(stdout)
  const truth = await wiredGateCount()
  assert.equal(counts.gates, truth.total,
    `生成的判据数(${counts.gates}) 必须等于注册表里的(${truth.total}) —— 否则这张页报的是一份过期真相`)
  // 页面上每一条已接线判据的 id 都必须出现
  for (const arr of Object.values(truth.byPoint)) {
    for (const g of arr) {
      assert.ok(html.includes(g.id), `页面上缺了已接线判据 ${g.id} —— 它会读起来像"没有这条机制"`)
    }
  }
})

test('臂 2 ★★ 未接线的判据必须真的出现在页面上（写了但没接线那一格）', async () => {
  const { stdout, html } = generate()
  const counts = parseCounts(stdout)
  const truth = await wiredGateCount()
  const wired = new Set()
  for (const arr of Object.values(truth.byPoint)) for (const g of arr) wired.add(g.id)

  // 走盘上找判据文件，凡不在注册表里的就是未接线
  const { readdirSync, statSync } = await import('node:fs')
  const dir = join(ROOT, 'src', 'gates')
  const unwired = []
  for (const point of readdirSync(dir)) {
    const p = join(dir, point)
    let isDir = false
    try { isDir = statSync(p).isDirectory() } catch { continue }
    if (!isDir) continue
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.ts')) continue
      const m = /export const id = '([^']+)'/.exec(readFileSync(join(p, f), 'utf8'))
      if (m && !wired.has(m[1])) unwired.push(m[1])
    }
  }

  assert.equal(counts.unwired, unwired.length,
    `生成器报的未接线数(${counts.unwired}) 必须等于盘上真实的(${unwired.length})`)
  for (const id of unwired) {
    assert.ok(html.includes(id),
      `未接线判据 ${id} 没有出现在页面上 —— 那会让"写了但没接线"读成"没有这条机制"（正是这张页要防的）`)
  }
  // ★ 而 0 条时也必须诚实：不出现"未接线"那一节，也不许硬编一个假数字
  if (unwired.length === 0) assert.equal(counts.unwired, 0)
})

test('臂 3 ★ prompt 规则直接从产品函数取 —— 规则数变了页上必须跟着变', async () => {
  const { stdout, html } = generate()
  const counts = parseCounts(stdout)
  const mod = await import(new URL('../lib/index.js', import.meta.url).href)
  const text = mod.usageSectionText('x', '')
  const body = text.split('Tools:')[0]
  const n = [...body.matchAll(/^(\d+)\.\s+/gm)].length
  assert.equal(counts.promptRules, n,
    `页上规则数(${counts.promptRules}) 必须等于 usageSectionText() 里的(${n})`)
  // 每条规则的正文片段必须在页面上（取前 40 字符做探针，避开转义差异）
  const rules = [...body.matchAll(/^(\d+)\.\s+(.*)$/gm)]
  for (const [, , ruleText] of rules.slice(0, 3)) {
    const probe = ruleText.slice(0, 40).replace(/["'&<>]/g, '')
    assert.ok(html.replace(/&quot;|&#39;|&amp;|&lt;|&gt;/g, '').includes(probe),
      `规则正文没有出现在页面上：「${probe}」`)
  }
})

test('臂 4 ★★ 三态不同形：mechanical / partial / prose-only 各自可数且合计等于总数', async () => {
  const { stdout, html } = generate()
  const c = parseCounts(stdout)
  assert.equal(c.mechanical + c.partial + c['prose-only'], c.promptRules,
    `三态合计(${c.mechanical}+${c.partial}+${c['prose-only']}) 必须等于规则总数(${c.promptRules}) `
    + '—— 一个规则只能落进一格，不许两处都算或两处都不算')
  // ★ 三个标签在页面上必须各自可见（否则人读不出这个区分）
  for (const label of ['有机械判据', '部分覆盖', '仅 prompt 一句话']) {
    assert.ok(html.includes(label), `页面上看不见三态标签「${label}」`)
  }
  // ★ 而"全部有机械判据"是可疑的：若 prose-only 恒为 0，说明分类退化成了恒真
  //   （与 gate-registry 里那条"verdictOf 恒为不可行"的臂同源）
  assert.ok(c['prose-only'] >= 1,
    'prose-only 为 0 ⇒ 要么真的每条规则都有判据（那要改这条臂并说明），要么分类器在恒报"有"')
})

test('臂 5 页是自包含的：不引外部资源、不带脚本（离线可看、无执行面）', () => {
  const { html } = generate()
  assert.ok(html.startsWith('<!doctype html>'), '必须是完整 HTML 文档')
  assert.ok(html.trim().endsWith('</html>'), '必须闭合')
  assert.ok(!/<script/i.test(html), '不许带脚本 —— 它是静态视图，不该有执行面')
  assert.ok(!/<link[^>]+href="https?:/i.test(html), '不许引外部样式/资源 —— 离线打开必须完整')
  assert.ok(!/src="https?:/i.test(html), '不许引外部脚本')
  assert.ok(!html.includes('undefined'), '渲染不许漏出 undefined')
  assert.ok(!html.includes('[object Object]'), '渲染不许漏出对象字面量')
})
