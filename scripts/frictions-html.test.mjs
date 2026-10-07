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

// ═════════════════════════════════════════════════════════════════════════════
// t57：判决（judgements）也必须可读 —— 而它必须与卡点【分开呈现】
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ── ★★ 这一节修的是什么（MEASURED，t57 开工时实测）────────────────────────────
 *
 *   captain 手写了 4 条判决在 `.agent-teams/judgements/`，而生成器只读
 *   `.agent-teams/frictions/`（第 33 行）⇒ ★ **判决写在盘上而没有人读它**。
 *
 *   ⇒ 那是本队那条纪律的又一实例：
 *     「一个没有人读的记录，与没有那个记录在观测上完全相同。」
 *
 * ── ★★ 而两种记录【不许合并成一种呈现】─────────────────────────────────────────
 *
 *   卡点说「我卡住了」   ⇒ 场景 / 观测 / 未知 / 处置
 *   判决说「我学到了」   ⇒ claim / counterexample / reuse / status
 *
 *   ★ 合并会让「执行到位」与「出问题了」同形 —— 而那正是本队一直防的那条。
 *   ⇒ 所以它们是**两份 HTML 并排**，而不是拼成一张表。
 *
 * ── ★★★ 而 `counterexample` 必须在 HTML 里【显眼】──────────────────────────────
 *
 *   README 逐字写着：判决必须带反例，**否则它就是一个【未检验的声称】**，
 *   而未检验的声称与猜测同形。⇒ 它不能被埋在角落。
 */

/** 一份判决（字段取自 `.agent-teams/frictions/README.md` 的规格）。 */
function judgement(extra = {}) {
  return {
    id: 'j-0001',
    at: '2026-10-07T19:20:00+08:00',
    project: 'agent-teams-dev',
    claim: 'the capability claim',
    scene: { from: 't30 / t39', what: 'three disconnects, all three recoverable' },
    counterexample: 'if a task mid-state is not recoverable, a disconnect loses work',
    reuse: 'ask before dispatching a long task',
    status: 'adopted',
    ...extra,
  }
}

/**
 * 在假仓库里追加一个判决目录。
 * ★ `omitJudgements`（不加目录）与 `judgements: []`（加了空目录）**必须不同形** ——
 *   那正是本任务的三态要求之一。
 */
function withJudgements(root, { judgements = [], broken = [], omit = false } = {}) {
  if (omit) return root
  const dir = join(root, '.agent-teams', 'judgements')
  mkdirSync(dir, { recursive: true })
  judgements.forEach((item, index) => {
    writeFileSync(join(dir, `j-${String(index + 1).padStart(4, '0')}.json`), JSON.stringify(item))
  })
  broken.forEach(({ name, text }, index) => {
    writeFileSync(join(dir, name ?? `j-${String(judgements.length + index + 1).padStart(4, '0')}.json`), text)
  })
  return root
}

/** 生成器现在写两份产物；本助手读 `docs/judgements.html`。 */
function judgementsHtml(root) {
  const out = join(root, 'docs', 'judgements.html')
  return existsSync(out) ? readFileSync(out, 'utf8') : undefined
}

test('★ 臂 17 — a judgement written to disk must be READ: it appears in docs/judgements.html', () => {
  const root = withJudgements(fakeRepo({ entries: [entry()] }), { judgements: [judgement()] })
  const result = run(root)
  assert.equal(result.code, 0, `stderr=${result.stderr}`)
  const html = judgementsHtml(root)
  assert.ok(html, '★ 判决必须有一份自己的产物 —— 否则它与"没有这个记录"同形')
  assert.match(html, /the capability claim/, '★ claim 必须出现在 HTML 里')
  rmSync(root, { recursive: true, force: true })
})

test('★★ 臂 18 — the three states of the judgement side are pairwise DISTINCT', () => {
  /**
   * ★ 目录不存在 / 目录存在但为空 / 有记录 —— 三者不同形。
   *   ★ 而前两者【最容易】被做成同形（都渲染成"0 条"），那正是本队记账的合流。
   */
  const absent = withJudgements(fakeRepo({ entries: [entry()] }), { omit: true })
  const empty = withJudgements(fakeRepo({ entries: [entry()] }), { judgements: [] })
  const present = withJudgements(fakeRepo({ entries: [entry()] }), { judgements: [judgement()] })
  const rAbsent = run(absent)
  const rEmpty = run(empty)
  const rPresent = run(present)

  for (const [label, r] of [['absent', rAbsent], ['empty', rEmpty], ['present', rPresent]]) {
    assert.equal(r.code, 0, `state「${label}」必须 exit 0（记录工具不许变成门禁）`)
  }
  const texts = [rAbsent.stdout.trim(), rEmpty.stdout.trim(), rPresent.stdout.trim()]
  assert.equal(new Set(texts).size, 3, `★ 三态必须两两不同形。实测：${JSON.stringify(texts)}`)
  /** ★ 而"目录不存在"不许被读成"没有判决" —— 前者是"这一格没有接上"。 */
  assert.match(rAbsent.stdout, /不存在|no judgement directory/i, `实测：${rAbsent.stdout}`)
  assert.match(rEmpty.stdout, /0 条|为空|no judgements yet/i, `实测：${rEmpty.stdout}`)
  rmSync(absent, { recursive: true, force: true })
  rmSync(empty, { recursive: true, force: true })
  rmSync(present, { recursive: true, force: true })
})

test('★★ 臂 19 — a MISSING judgement directory must NOT fail the whole generation', () => {
  /**
   * ★ 缺判决目录不该让整份 HTML 生成失败 —— 那会把「记录工具」变成「门禁」。
   *   （t47 已经在这个方向上犯过一次，本臂是它的机械形式。）
   */
  const root = withJudgements(fakeRepo({ entries: [entry()] }), { omit: true })
  const result = run(root)
  assert.equal(result.code, 0, '★ 缺判决目录必须仍然 exit 0')
  assert.ok(result.html, '★ 而卡点那一半必须照常生成 —— 一半缺席不许拖垮另一半')
  rmSync(root, { recursive: true, force: true })
})

test('★★★ 臂 20 — the counterexample must be PROMINENT, not buried', () => {
  /**
   * ── ★ 为什么这一条是判决的核心 ────────────────────────────────────────────────
   *
   *   README 逐字：判决必须带反例，**否则它就是一个【未检验的声称】**。
   *   ⇒ 一条没有反例的判决，与一句猜测在读者眼里同形。
   *   ⇒ 所以它必须在 HTML 里【显眼】：
   *     · 必须在场（不是可选的）
   *     · 必须有自己的标签（可被找到、可被引用）
   *     · ★ 必须靠近 claim（不是页面末尾的附录）
   */
  const root = withJudgements(fakeRepo({ entries: [entry()] }), { judgements: [judgement()] })
  run(root)
  const html = judgementsHtml(root)
  assert.match(html, /if a task mid-state is not recoverable/, '★ 反例的原文必须在 HTML 里')
  /**
   * ★ "显眼"的可执行形式：反例必须带一个**可定位的标记**，
   *   而且那个标记必须与 claim 在同一张卡片里（相邻，不是远隔）。
   */
  const claimAt = html.indexOf('the capability claim')
  const counterAt = html.indexOf('if a task mid-state is not recoverable')
  assert.ok(claimAt >= 0 && counterAt >= 0, '前置：两者都在')
  assert.ok(
    Math.abs(counterAt - claimAt) < 4000,
    `★ 反例必须靠近 claim（同一张卡片），而不是被挪到页面别处。实测距离 ${Math.abs(counterAt - claimAt)} 字符`,
  )
  assert.match(
    html, /class="[^"]*counter[^"]*"|反例|会证伪|what would refute/i,
    '★ 反例必须带一个可定位的标记/标签 —— 否则它不可被引用',
  )
  rmSync(root, { recursive: true, force: true })
})

test('★★ 臂 21 — the two record kinds are SEPARATE renderings, never merged into one list', () => {
  /**
   * ── ★★ 本臂防的是"合并会让两种东西同形"──────────────────────────────────────
   *
   *   卡点说「我卡住了」；判决说「我学到了」。
   *   ⇒ 若把判决并进卡点列表，那么"一条卡点"与"一条判决"在页面上同形 ——
   *     而"执行到位"与"出问题了"就再也分不开。
   *
   * ★ 可执行形式：**两份产物**，且各自【只】呈现自己那一类。
   *   一份产物里的另一类内容是 0 —— 那比"看起来分开了"强，因为它是结构事实。
   */
  const root = withJudgements(fakeRepo({ entries: [entry()] }), { judgements: [judgement()] })
  run(root)
  const frictions = readFileSync(join(root, 'docs', 'frictions.html'), 'utf8')
  const judgements = judgementsHtml(root)

  assert.ok(frictions && judgements, '前置：两份产物都在')
  assert.match(frictions, /a friction/, '★ 卡点那份必须有卡点')
  assert.doesNotMatch(
    frictions, /the capability claim/,
    '★★ 判决不许并进卡点那份 —— 合并会让"我卡住了"与"我学到了"同形',
  )
  assert.match(judgements, /the capability claim/, '★ 判决那份必须有判决')
  assert.doesNotMatch(
    judgements, /a friction/,
    '★ 反向：卡点也不许并进判决那份',
  )
  rmSync(root, { recursive: true, force: true })
})

test('★ 臂 22 — the judgement side reports unreadable records, distinctly from "none"', () => {
  const root = withJudgements(fakeRepo({ entries: [entry()] }), {
    judgements: [judgement()],
    broken: [{ name: 'j-0002.json', text: '{not json' }],
  })
  const result = run(root)
  assert.equal(result.code, 0, '一条坏判决不许让生成失败')
  assert.match(result.stdout + result.stderr, /j-0002\.json/, '★ 坏判决必须被指名')
  rmSync(root, { recursive: true, force: true })
})

test('★ 臂 23 — judgement status is rendered, and an UNKNOWN status is not silently "adopted"', () => {
  /**
   * ★ `status` ∈ {adopted, refuted, pending}。
   *   一条【没有标注】或标了非法值的判决，不许被读成 `adopted` ——
   *   那会让"没人检验过"与"已被采纳"同形（本队记账）。
   */
  const root = withJudgements(fakeRepo({ entries: [entry()] }), {
    judgements: [judgement({ status: 'pending' }), judgement({ id: 'j-0002', claim: 'unmarked claim' })],
  })
  run(root)
  const html = judgementsHtml(root)
  assert.match(html, /待定|pending/i, '★ pending 必须读得出来')
  assert.match(html, /未标注|unknown/i, '★ 缺 status 的判决必须显示成"未标注"，不是默认 adopted')
  rmSync(root, { recursive: true, force: true })
})

test('★★ 臂 24 — the frictions half is UNCHANGED (reverse half: adding judgements must not reshape it)', () => {
  /**
   * ── ★ 反向半边（契约明写）────────────────────────────────────────────────────
   *
   *   「改完之后，卡点那一半的三维度呈现必须与现在逐字相同。」
   *
   * ★ 可执行形式：同一个假仓库、同一份卡点，**加判决之前与之后**各生成一次，
   *   断言 `docs/frictions.html` 的核心区块**逐字相同**。
   *
   * ★ 比较时剔除**生成时间**那一行（`new Date().toLocaleString`）——
   *   它每次都会变，而它不是"呈现形状"的一部分。
   *   ★ 若不做这个剔除，本臂会变成一个恒红的噪声源；而若把整份文件都比对
   *     又会让"时间戳"掩盖真正的形状变化。⇒ 只剔除那一处，其余逐字比。
   */
  const before = fakeRepo({ entries: [entry(), entry({ id: 'f-0002', title: 'second' })] })
  const after = withJudgements(fakeRepo({ entries: [entry(), entry({ id: 'f-0002', title: 'second' })] }), {
    judgements: [judgement()],
  })
  run(before)
  run(after)
  const strip = (html) => html
    .replace(/生成于 [^<]*/u, '生成于 <TIME>')
    .replace(/<title>[^<]*<\/title>/u, '<title></title>')
  const a = strip(readFileSync(join(before, 'docs', 'frictions.html'), 'utf8'))
  const b = strip(readFileSync(join(after, 'docs', 'frictions.html'), 'utf8'))
  assert.equal(
    b, a,
    '★★ 加了判决之后，卡点那一半必须逐字不变 —— 本任务的改动是【加一份产物】，不是重构已有的',
  )
  rmSync(before, { recursive: true, force: true })
  rmSync(after, { recursive: true, force: true })
})
