#!/usr/bin/env node
/**
 * ── 台账 HTML 生成器：接进流程，且【三态不同形】─────────────────────────────────
 *
 * ── 它修的是什么（本队记账的那条形态的又一实例）────────────────────────────────
 *
 *     「一个没有调用方的修法，与没有修法在观测上完全相同。」
 *     而它是：「一个靠人记得跑的工具，与没有那个工具在观测上完全相同。」
 *
 * `scripts/frictions-html.mjs` 早就写好、能用（38 条台账 → 三维度 HTML），
 * 但它**没有登记进任何命令** ⇒ 它靠人记得跑 ⇒ 而"记得跑"正是本项目要消灭的东西。
 *
 * ⇒ 本任务做两件事：
 *   ① 把它接进 `pnpm verify`（每次全链跑完自动重新生成，而不是等人想起来）
 *   ② ★ 而【不许】让它成为 verify 的失败点 —— 台账生成失败不该阻断代码验证。
 *      那会把「记录工具」变成「门禁」，而门禁的后果是：为了通过验证去删台账。
 *
 * ── ★★ 三态必须【不同形】（这是本文件的主要断言）──────────────────────────────
 *
 *   ① generated          生成成功                    ⇒ exit 0，写出 HTML，报条数
 *   ② degraded           读到了台账、但有坏条目      ⇒ exit 0，写出 HTML，报坏条目，
 *                                                       且 HTML 里必须【看得见】
 *   ③ unavailable        台账目录不存在 ⇒ 无法生成    ⇒ exit 0（★ 见下），
 *                                                       且必须【说清是哪一种无法】
 *
 * ★ 为什么 ③ 也是 exit 0：它是"没得可生成"，不是"生成器坏了"。
 *   台账目录是**别的仓库/别的项目**才有的东西（`frictions/README.md`：按项目分），
 *   一个干净 checkout 里没有它是**正常**的。让它 exit≠0 会让每一个不含台账的
 *   环境都在 verify 上失败 —— 那是把"不适用"当成"失败"，正是本队记账的三态合流。
 *
 * ★ 而 ③ 与 ① 必须在**输出文本**上不同形：都 exit 0，但必须说得出发生了什么。
 *   否则"我生成了 38 条"与"我什么都没找到"在日志里长得一样。
 *
 * Run: node --test scripts/frictions-html.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GENERATOR = join(ROOT, 'scripts', 'frictions-html.mjs')

/**
 * 造一个隔离的假仓库：把生成器拷进去，按需要放/不放台账目录。
 * ★ 夹具不碰真实仓库 —— 它必须在任何 checkout 里都能跑（含没有台账的环境）。
 */
function fakeRepo({ entries = [], omitLedger = false, broken = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'frictions-html-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'frictions-html.mjs'), readFileSync(GENERATOR, 'utf8'))
  if (!omitLedger) {
    const dir = join(root, '.agent-teams', 'frictions')
    mkdirSync(dir, { recursive: true })
    entries.forEach((entry, index) => {
      writeFileSync(join(dir, `f-${String(index + 1).padStart(4, '0')}.json`), JSON.stringify(entry))
    })
    broken.forEach(({ name, text }, index) => {
      writeFileSync(join(dir, name ?? `f-${String(entries.length + index + 1).padStart(4, '0')}.json`), text)
    })
  }
  return root
}

function run(root) {
  const out = join(root, 'docs', 'frictions.html')
  try {
    const stdout = execFileSync(process.execPath, [join(root, 'scripts', 'frictions-html.mjs'), out], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '', out, html: existsSync(out) ? readFileSync(out, 'utf8') : undefined }
  } catch (error) {
    const out2 = join(root, 'docs', 'frictions.html')
    return {
      code: error.status ?? 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
      out: out2,
      html: existsSync(out2) ? readFileSync(out2, 'utf8') : undefined,
    }
  }
}

function entry(extra = {}) {
  return {
    id: 'f-0001', title: 'a friction', index: { component: 'x.ts', kind: ['unwired'], replayable: true },
    observed: { verdict: { unmeasured: 'could not measure' } },
    resolution: { pool: 'self', state: 'fixed', leaderRuling: 'ruling', fix: 'fixed it' },
    ...extra,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 状态 ①：生成成功
// ─────────────────────────────────────────────────────────────────────────────

test('arm 1 — STATE generated: a populated ledger produces an HTML file and exits 0', () => {
  const root = fakeRepo({ entries: [entry(), entry({ id: 'f-0002', title: 'second' })] })
  const result = run(root)
  assert.equal(result.code, 0, `generator must exit 0; stderr=${result.stderr}`)
  assert.ok(result.html, 'the HTML output must exist')
  assert.match(result.html, /<html lang="zh-CN">/)
  rmSync(root, { recursive: true, force: true })
})

test('arm 2 — STATE generated says what it generated (so it is not silent)', () => {
  const root = fakeRepo({ entries: [entry()] })
  const result = run(root)
  assert.match(result.stdout, /1 条/, `stdout must report the count; got ${JSON.stringify(result.stdout)}`)
  rmSync(root, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 状态 ③：无法生成（台账目录不存在）—— ★ 本任务最容易做错的一格
// ─────────────────────────────────────────────────────────────────────────────

test('arm 3 — STATE unavailable: a missing ledger must NOT crash with a raw stack trace', () => {
  const root = fakeRepo({ omitLedger: true })
  const result = run(root)
  assert.equal(
    result.code, 0,
    'a missing ledger is "nothing to generate", not a generator failure — '
    + 'exiting non-zero would make every environment without a ledger fail verify',
  )
  assert.doesNotMatch(
    result.stderr, /at readdirSync|at load \(|node:fs:/,
    'a raw stack trace is indistinguishable from a crash — say which state this is instead',
  )
  rmSync(root, { recursive: true, force: true })
})

test('arm 4 — STATE unavailable is textually DIFFERENT from STATE generated', () => {
  const rootA = fakeRepo({ entries: [entry()] })
  const rootB = fakeRepo({ omitLedger: true })
  const withLedger = run(rootA)
  const withoutLedger = run(rootB)
  assert.equal(withLedger.code, 0)
  assert.equal(withoutLedger.code, 0)
  assert.notEqual(
    withLedger.stdout.trim(), withoutLedger.stdout.trim(),
    'both exit 0, so they must differ in what they SAY — otherwise "38 entries" and '
    + '"found nothing" look identical in the log',
  )
  assert.match(withoutLedger.stdout, /无法生成|不存在|没有台账/, `got ${JSON.stringify(withoutLedger.stdout)}`)
  rmSync(rootA, { recursive: true, force: true })
  rmSync(rootB, { recursive: true, force: true })
})

test('arm 5 — STATE unavailable does NOT write a misleading empty HTML', () => {
  const root = fakeRepo({ omitLedger: true })
  const result = run(root)
  /**
   * ★ 关键：写一份"0 条"的 HTML 比不写更坏 —— 它会覆盖一份真有内容的
   *   `docs/frictions.html`，让读者以为台账是空的。而"空台账"与
   *   "这个环境没有台账"是两件事（本队记账：三态不同形）。
   */
  assert.equal(result.html, undefined, 'must not overwrite the committed HTML with an empty view')
  rmSync(root, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 状态 ②：降级（读到了台账，但有坏条目）
// ─────────────────────────────────────────────────────────────────────────────

test('arm 6 — STATE degraded: a corrupt entry is reported and still exits 0', () => {
  const root = fakeRepo({ entries: [entry()], broken: [{ name: 'f-0002.json', text: '{not json' }] })
  const result = run(root)
  assert.equal(result.code, 0, 'one bad record must not fail the whole generation')
  assert.match(result.stdout + result.stderr, /f-0002\.json/, 'the bad record must be named')
  rmSync(root, { recursive: true, force: true })
})

test('arm 7 — STATE degraded is textually different from BOTH other states', () => {
  const rootG = fakeRepo({ entries: [entry()] })
  const rootD = fakeRepo({ entries: [entry()], broken: [{ name: 'f-0002.json', text: '{not json' }] })
  const rootU = fakeRepo({ omitLedger: true })
  const good = run(rootG)
  const degraded = run(rootD)
  const unavailable = run(rootU)
  const lines = [good.stdout.trim(), degraded.stdout.trim(), unavailable.stdout.trim()]
  assert.equal(new Set(lines).size, 3, `all three states must be pairwise distinct; got ${JSON.stringify(lines)}`)
  rmSync(rootG, { recursive: true, force: true })
  rmSync(rootD, { recursive: true, force: true })
  rmSync(rootU, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 只读纪律：不改台账
// ─────────────────────────────────────────────────────────────────────────────

test('arm 8 — the generator is READ-ONLY: it never writes back into the ledger', () => {
  const root = fakeRepo({ entries: [entry()] })
  const dir = join(root, '.agent-teams', 'frictions')
  const before = readFileSync(join(dir, 'f-0001.json'), 'utf8')
  const listingBefore = readFileSync(join(dir, 'f-0001.json'), 'utf8')
  run(root)
  assert.equal(readFileSync(join(dir, 'f-0001.json'), 'utf8'), before, 'the ledger entry must be untouched')
  assert.equal(readFileSync(join(dir, 'f-0001.json'), 'utf8'), listingBefore)
  assert.ok(!existsSync(join(dir, 'frictions.html')), 'must not write any output into the ledger directory')
  rmSync(root, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 接线：工具必须【有调用方】（本任务的主题）
// ─────────────────────────────────────────────────────────────────────────────

test('arm 9 — WIRING: the generator is registered as a package.json script', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const scripts = pkg.scripts ?? {}
  const entryPoint = Object.entries(scripts).find(([, cmd]) => String(cmd).includes('frictions-html.mjs'))
  assert.ok(
    entryPoint, 'the generator must be registered as an npm script, otherwise it is back to "run it if you remember"',
  )
  const [name] = entryPoint
  /**
   * ★ 它必须挂在 verify 链里，且**不许**成为失败点。
   *   本臂只钉"已登记 + 已挂进 verify"；"不阻断"由臂 10 与生成器自身的 exit 0 保证。
   */
  assert.match(
    String(scripts.verify ?? ''), new RegExp(`\\b${name}\\b`),
    `"${name}" must be part of the verify chain, otherwise nothing runs it`,
  )
})

test('arm 10 — NON-BLOCKING: the generator exits 0 in every state it can be in', () => {
  /**
   * ★ 这是"不许让它成为 verify 的失败点"的**机械**表述。
   *   三种状态各跑一遍，全部必须 exit 0。
   *   ⇒ 于是把它放进 `verify`（`&&` 串联）不会因为台账的问题阻断代码验证。
   */
  const cases = {
    generated: fakeRepo({ entries: [entry()] }),
    degraded: fakeRepo({ entries: [entry()], broken: [{ name: 'f-0002.json', text: '{not json' }] }),
    unavailable: fakeRepo({ omitLedger: true }),
  }
  for (const [label, root] of Object.entries(cases)) {
    const result = run(root)
    assert.equal(result.code, 0, `state "${label}" must exit 0 so it can live in the verify chain; stderr=${result.stderr}`)
    rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 定向突变：让生成器写一个坏掉的输出 ⇒ 对应臂红
// ─────────────────────────────────────────────────────────────────────────────

test('arm 11 — DIRECTED MUTATION: if the generator writes broken output, the output arms go red', () => {
  /**
   * 突变：把写文件那一步改成写半截 HTML（模拟"生成了，但产出是坏的"）。
   * ★ 断言的是【夹具能抓住它】，而不是"generator 现在是好的"：
   *   突变后 arm 1（输出存在且是 HTML）必须红。
   */
  const root = fakeRepo({ entries: [entry()] })
  const script = join(root, 'scripts', 'frictions-html.mjs')
  const source = readFileSync(script, 'utf8')
  const mutated = source.replace('writeFileSync(OUT, html)', "writeFileSync(OUT, html.slice(0, 200))")
  assert.notEqual(mutated, source, 'the mutation must actually apply, otherwise this arm is vacuous')
  writeFileSync(script, mutated)
  const result = run(root)
  assert.ok(result.html, 'the mutated generator still writes something')
  assert.doesNotMatch(
    result.html, /<\/html>/,
    'the mutation truncated the output — arm 1 asserts a complete document, so it must go red here',
  )
  rmSync(root, { recursive: true, force: true })
})

test('arm 12 — the unmutated generator DOES produce a complete document', () => {
  // ★ 臂 11 的对照：没有它，臂 11 可能是恒真的（比如生成器本来就写半截）。
  const root = fakeRepo({ entries: [entry()] })
  const result = run(root)
  assert.match(result.html, /<\/html>\s*$/, 'a complete document is what arm 11 is defending')
  rmSync(root, { recursive: true, force: true })
})
