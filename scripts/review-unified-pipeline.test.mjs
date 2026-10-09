/**
 * ── R1（t6）· 独立审查：P1–P4 的 acceptance 是否被满足 ────────────────────────────
 *
 * ── ★★★ 本文件的独立性纪律（它决定了本审查能声称什么）─────────────────────────
 *
 *   ✔ 审查者**不是**任何被审任务的实现者（本任务由 `verifier` 承担；
 *     t1/t3 由 `pipeline-author`、t4/t8/t10/t12 由 `wire-author` 实现）
 *   ✔ 每条判据都给出**文件与行号级证据**（不是"我读过，感觉对"）
 *   ✔ 逐条对着**契约原文**判，而不是对着实现者的自述判
 *   ✗ 判不了的 ⇒ `unmeasured` 并附缺什么，**绝不并进 pass**
 *
 * ── ★★ 三个要审的对象（captain 于 2026-10-09 补的条款③）───────────────────────
 *
 *     t1            —— P1（统一流水线骨架）
 *     t2 + t9 + t11 —— P2（`reviewed` 的形状 → 透传 → 校验；三块拼成一条链）
 *     t4 + t8 + t10 —— P4 + P2b（判据本体 → 接线；两组三条拼成两条接线）
 *     t12           —— P5（计划审查的四个必答项提升为可求值的真值）
 *
 *   ★ 而 t1 的终态是 `failed`（**机械后果**，因为 `pnpm test:gates` 有存量红）⇒
 *     审**它的交付**，不审它的状态。这一条是 captain 明确的。
 *
 * ── ★ 本文件怎么"读证据"：两种，且都不复用实现者的夹具辅助函数 ────────────────
 *
 *   ① 【读声明的字面】—— 契约里那些"形状"类要求（可选 / 具名类型 / 不 import I/O），
 *      在**运行时无法被观察到**（`any` 在运行时也接受一切）⇒ 必须钉字面。
 *   ② 【驱动真实入口】—— 行为类要求（开火 / 三态 / 落盘 / 同结论）走
 *      `lib/gates/index.js` 与 `scripts/friction-triage.mjs`，输入**自己构造**。
 *
 * ── ★★★ 三态如实：本文件用两种**不同形**的出路 ─────────────────────────────────
 *
 *     `t.skip(...)`   ⇒ 「没测到」（读数为 skipped）
 *     `assert` 失败   ⇒ 「测了而不过」（读数为 fail）
 *   ★ 若把前者写成后者的反面（报 pass），那正是本队记账最久的那条合流。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

/** 读一个源码文件；读不到 ⇒ `undefined`（调用方据此报 unmeasured，而不是猜）。 */
function sourceOrUndefined(relative) {
  const path = join(ROOT, relative)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** 那一行的原文（1-based）——「行号级证据」的可执行形式。 */
function lineAt(relative, line) {
  const text = sourceOrUndefined(relative)
  if (text === undefined) return undefined
  return text.split('\n')[line - 1]
}

/** 走真实入口：运行时真的加载的那一份。 */
async function realRegistry() {
  const mod = await import(join(LIB, 'gates', 'index.js'))
  return { registry: mod.registry, INSERTION_POINTS: mod.INSERTION_POINTS }
}

/** 走真实入口：流水线本体（脚本，不是 lib）。 */
async function realPipeline() {
  return await import(join(ROOT, 'scripts', 'friction-triage.mjs'))
}

// ─────────────────────────────────────────────────────────────────────────────
// P1（t1）· 统一流水线骨架
// ─────────────────────────────────────────────────────────────────────────────

test('★ P1·acc5/acc6：分档读**提案自己的写域**，且信号 A 在判决侧真的触发', async (t) => {
  const pipeline = await (async () => {
    try { return await realPipeline() } catch (error) {
      t.skip(`未测量：scripts/friction-triage.mjs 不可加载（${String(error?.message ?? error).slice(0, 100)}）`)
      return undefined
    }
  })()
  if (pipeline === undefined) return
  if (typeof pipeline.tierOf !== 'function' || typeof pipeline.runPipeline !== 'function') {
    t.skip('未测量：`tierOf` / `runPipeline` 不在导出面上 ⇒ P1 的骨架不在盘上')
    return
  }
  /**
   * ── acc5 的可执行形式 ─────────────────────────────────────────────────────────
   *
   * ★ 契约说：「分档读【提案自己的写域】，不是收窄后的」。
   * ★ 而它的**机械形式**是：`tierOf(proposal, …)` 这一处调用**存在于主干上**，
   *   且**不存在** `tierOf({...contract, inScope: narrow.inScope}, …)` 那种写法。
   */
  const text = sourceOrUndefined('scripts/friction-triage.mjs')
  assert.notEqual(text, undefined, '★ 前置：脚本在盘上')
  const onProposal = text.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => /tierOf\(proposal\b/.test(entry.line))
  const onNarrowed = text.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => /tierOf\(\{/.test(entry.line))
  console.log(`  [t6] tierOf(proposal) 出现在行 ${onProposal.map((e) => e.number).join(', ') || '(无)'}`)
  console.log(`  [t6] tierOf({...})      出现在行 ${onNarrowed.map((e) => e.number).join(', ') || '(无)'}`)
  assert.ok(onProposal.length > 0, '★ acc5：主干上必须有 `tierOf(proposal, …)` 这一处调用')
  assert.equal(onNarrowed.length, 0, '★★ acc5：不许存在 `tierOf({…, inScope: narrow.inScope}, …)` —— 那正是被修掉的那个写法')

  /** acc6：信号 A（跨多个现有源码文件）在**判决侧**必须真的触发。 */
  const verdict = pipeline.tierOf({ inScope: ['src/a.ts', 'src/b.ts'] }, {})
  console.log(`  [t6] tierOf({inScope:['src/a.ts','src/b.ts']}) ⇒ ${verdict.tier}（${String(verdict.why).slice(0, 50)}）`)
  assert.equal(verdict.tier, 'large', '★★ acc6：两个现有源码文件 ⇒ 必须判 large（信号 A）')
  /** ★ 而反向半边：单文件**不许**判 large（否则它是一条恒 large 的判据）。 */
  const single = pipeline.tierOf({ inScope: ['src/a.ts'] }, {})
  assert.notEqual(single.tier, 'large', '★ 反向半边：单个文件不许判 large')
})

test('★ P1·acc1：两个出口**同结论** —— 因为它们调的是同一个函数', async (t) => {
  const pipeline = await (async () => {
    try { return await realPipeline() } catch { return undefined }
  })()
  if (pipeline === undefined || typeof pipeline.runPipeline !== 'function') {
    t.skip('未测量：`runPipeline` 不在导出面上')
    return
  }
  /**
   * ── acc1 的两半，缺一不可 ─────────────────────────────────────────────────────
   *
   *   ① **结构**：两个 CLI 出口都调 `runPipeline`（薄包装）
   *   ② **行为**：同一提案经它给出同一结论
   *
   * ★ 只测 ② 会被"两个出口各自实现但碰巧一致"骗过；只测 ① 会被"调了但传的东西不同"骗过。
   */
  const text = sourceOrUndefined('scripts/friction-triage.mjs')
  /**
   * ★ MEASURED（本审查第一版写错了）：第一版的正则是 `/=\s*runPipeline\(/`，
   *   而它**漏掉**了递归那一处 `...runPipeline(child, {…, depth: depth + 1})`
   *   —— 那是**展开到数组里**，不是赋值。
   *   ⇒ 而"两个 CLI 出口"是**赋值**形式 ⇒ 我数到 2 而不是 3，于是本臂假红。
   * ★ 修法：匹配 `runPipeline(` 的**全部**出现，再看有几处是"赋值/展开"（不是声明与注释）。
   */
  const callSites = text.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => /runPipeline\(/.test(entry.line))
    .filter((entry) => !/^\s*(\*|\/\/|\/\*)/.test(entry.line))
    .filter((entry) => !/export function runPipeline/.test(entry.line))
  console.log(`  [t6] \`runPipeline(…)\` 的调用点：${callSites.map((e) => e.number).join(', ')}`)
  assert.ok(
    callSites.length >= 3,
    `★ acc1①：至少三个调用点（递归 1 + 两个 CLI 出口 2）。实测 ${callSites.length}`,
  )
  /** ★ 而其中**恰好两处**是 `const outcome = runPipeline(…)` 形态 —— 那是两个 CLI 出口。 */
  const outletCalls = callSites.filter((entry) => /const\s+outcome\s*=\s*runPipeline\(/.test(entry.line))
  console.log(`  [t6] 其中"出口形态"（\`const outcome = runPipeline(…)\`）：${outletCalls.map((e) => e.number).join(', ')}`)
  assert.equal(outletCalls.length, 2, '★★ acc1①：两个 CLI 出口必须**各有一处** outlet 形态的调用')
  const proposal = {
    sourceId: 'r1-same', subject: 's', kind: 'implementation',
    inScope: ['src/a.ts', 'src/b.ts'], acceptance: ['x'], verify: ['pnpm typecheck'],
    objective: 'o', claim: 'c',
  }
  const first = pipeline.runPipeline(proposal, {})
  const second = pipeline.runPipeline(proposal, {})
  console.log(`  [t6] 同一提案两次 ⇒ stage=${first.stage} / ${second.stage} · tier=${first.tier?.tier} / ${second.tier?.tier}`)
  assert.equal(first.stage, second.stage, '★ acc1②：同一提案必须得到同一 stage')
  assert.equal(first.tier?.tier, second.tier?.tier, '★ acc1②：同一提案必须得到同一分档')
})

test('★ P1·acc2/acc3/acc7：大档必经分档；`unmeasurable` 与「大档」不同形；`narrowing` 读数仍在', async (t) => {
  const pipeline = await (async () => { try { return await realPipeline() } catch { return undefined } })()
  if (pipeline === undefined || typeof pipeline.runPipeline !== 'function') {
    t.skip('未测量：`runPipeline` 不在导出面上')
    return
  }
  const mk = (id, scope) => ({
    sourceId: id, subject: 's', kind: 'implementation', inScope: scope,
    acceptance: ['x'], verify: ['pnpm typecheck'], objective: 'o', claim: 'c',
  })
  const large = pipeline.runPipeline(mk('r1-large', ['src/a.ts', 'src/b.ts', 'src/c.ts']), {})
  const unmeasurable = pipeline.runPipeline(mk('r1-unmeas', []), {})

  /** acc2：大档 ⇒ 它的 `trace` 里**必须**出现分档那一站（那是"必经"的可执行形式）。 */
  console.log(`  [t6] 大档 trace = ${JSON.stringify(large.trace)}`)
  assert.ok(
    Array.isArray(large.trace) && large.trace.includes('tier'),
    '★★ acc2：大档的 trace 里必须有 `tier` 这一站 ⇒ 它必然经过分档',
  )
  /** acc3：`unmeasurable` 与「大档」**不同形**。 */
  console.log(`  [t6] 大档 stage=${large.stage} · 判不了 stage=${unmeasurable.stage}`)
  assert.notEqual(
    large.stage, unmeasurable.stage,
    '★★ acc3：大档与 `unmeasurable` 必须落在【不同】的 stage —— 前者要裁决，后者要补信息',
  )
  assert.notEqual(unmeasurable.stage, 'ready', '★★ acc3：`unmeasurable` 绝不许并进 ready')
  /** acc7：`narrowing` 读数**仍在返回值里**（它不再作分档输入，但它是有用信号）。 */
  assert.ok('narrowing' in large, '★ acc7：`narrowing` 读数必须在返回值里')
  for (const key of ['from', 'to', 'dropped', 'why']) {
    assert.ok(key in large.narrowing, `★ acc7：\`narrowing\` 必须带 \`${key}\` 这一格`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// P2（t2 + t9 + t11）· `reviewed` 的形状 → 透传 → 校验
// ─────────────────────────────────────────────────────────────────────────────

test('★ P2/t2·acc1/acc2：`reviewed` 是**可选**的**具名**类型（读声明的字面）', (t) => {
  const text = sourceOrUndefined('src/types.ts')
  if (text === undefined) {
    t.skip('未测量：src/types.ts 不在盘上')
    return
  }
  /**
   * ── ★★ 为什么这一条必须读【声明的字面】而不是运行时 ────────────────────────────
   *
   *   「把 `reviewed?: ReviewedStamp` 改成 `reviewed?: any`」在**运行时无法被观察到**
   *   —— `any` 在运行时也接受一切。⇒ 必须钉字面。
   */
  const lines = text.split('\n')
  const find = (pattern) => lines.map((line, index) => ({ line, number: index + 1 })).filter((e) => pattern.test(e.line))
  const stampLine = find(/export interface ReviewedStamp\b/)
  const checkLine = find(/export interface ReviewedCheck\b/)
  const fieldLine = find(/reviewed\?:\s*ReviewedStamp\b/)
  for (const [label, hits] of [['ReviewedStamp', stampLine], ['ReviewedCheck', checkLine], ['reviewed?: ReviewedStamp', fieldLine]]) {
    console.log(`  [t6] ${label.padEnd(24)} ⇒ ${hits.map((e) => e.number).join(', ') || '(无)'}`)
  }
  assert.ok(stampLine.length > 0, '★ acc1：`ReviewedStamp` 必须是具名导出接口')
  assert.ok(checkLine.length > 0, '★ acc1：`ReviewedCheck` 必须是具名导出接口')
  assert.ok(
    fieldLine.length > 0,
    '★★ acc1：`reviewed` 必须是**可选**（带 `?`）且类型为**具名的 `ReviewedStamp`** —— '
    + '去掉 `?` 会让"还没审"变成非法；改成 `any` 会让"审了什么"静默接收一切',
  )
  assert.equal(find(/reviewed\?:\s*(any|unknown)\b/).length, 0, '★★ acc2：`reviewed?` 不许是 `any` / `unknown`')
  assert.ok(find(/checks:\s*ReviewedCheck\[\]/).length > 0, '★ acc2：`checks` 必须是 `ReviewedCheck[]`（逐条，不是布尔）')
})

test('★ P2/t9·acc4：透传链**三站在 `create-task.ts`**（行号级）+ 第四站在校验', (t) => {
  const text = sourceOrUndefined('src/tools/create-task.ts')
  if (text === undefined) {
    t.skip('未测量：src/tools/create-task.ts 不在盘上')
    return
  }
  const lines = text.split('\n')
  const find = (pattern) => lines.map((line, index) => ({ line, number: index + 1 })).filter((e) => pattern.test(e.line))
  const schema = find(/^\s+reviewed:\s*\{/)
  const argIn = find(/reviewed:\s*input\.reviewed\s*,/)
  const persist = find(/\.\.\.input\.reviewed === undefined \? \{\} : \{ reviewed: input\.reviewed \}/)
  const stations = [['schema 声明', schema], ['入参接收', argIn], ['落盘（缺席则不写键）', persist]]
  for (const [label, hits] of stations) console.log(`  [t6] ${label.padEnd(22)} ⇒ 行 ${hits.map((e) => e.number).join(', ') || '(无)'}`)
  for (const [label, hits] of stations) {
    assert.ok(hits.length > 0, `★★ acc4：\`reviewed\` 的【${label}】那一站不在 —— 四处缺一即断链`)
  }
  /**
   * ★ 落盘那一行的**形态**也要钉：契约逐字说「缺席则一个键都不写」——
   *   写 `reviewed: undefined` 会被 JSON.stringify 静默抹掉；写 `null` 会留下一个
   *   "在场却是空的"格子 ⇒ 两者都让"没审"与"审了但是空的"同形。
   */
  assert.match(
    persist[0].line, /\.\.\.input\.reviewed === undefined \? \{\}/,
    '★★ acc4：落盘必须是「缺席就不写」的展开形态（不是无条件写）',
  )
})

test('★★ P2/t11·acc1/acc2/acc3：三态校验 —— 缺席过 / 形状坏拒 / 合法过，且**两句措辞不同**', async (t) => {
  if (!existsSync(join(LIB, 'quality-gates.js'))) {
    t.skip('未测量：lib/quality-gates.js 不在盘上（先 pnpm build）')
    return
  }
  const { validateCreateTask } = await import(join(LIB, 'quality-gates.js'))
  if (typeof validateCreateTask !== 'function') {
    t.skip('未测量：`validateCreateTask` 不在导出面上')
    return
  }
  const team = { id: 'r1', tasks: [], members: [] }
  const run = (input) => {
    try { return validateCreateTask(team, input) } catch (error) { return { ok: false, error: `THREW: ${String(error?.message ?? error)}` } }
  }
  const absent = run({ subject: 's', kind: 'work' })
  const legal = run({ subject: 's', kind: 'work', reviewed: { at: 1, by: 'reviewer', checks: [{ id: 'scope', verdict: 'pass' }] } })
  const wrongShape = run({ subject: 's', kind: 'work', reviewed: 'not-an-object' })
  const wrongChecks = run({ subject: 's', kind: 'work', reviewed: { at: 1, by: 'r', checks: 'no' } })
  console.log(`  [t6] 缺席 ⇒ ok=${absent.ok} · 合法 ⇒ ok=${legal.ok} · 形状坏 ⇒ ok=${wrongShape.ok} · checks坏 ⇒ ok=${wrongChecks.ok}`)

  /** acc1：不带 `reviewed` 照常成功（它不许变成必填）。 */
  assert.equal(absent.ok, true, '★★ acc1：缺席必须**通过** —— 它不是必填（"还没审"是正规状态）')
  /** acc3：对照臂 —— 合法输入必须过（缺它就无法区分"校验有效"与"校验在乱拒"）。 */
  assert.equal(legal.ok, true, '★★ acc3（对照臂）：合法的 `reviewed` 必须通过')
  /** acc2：形状坏必须拒。 */
  assert.equal(wrongShape.ok, false, '★★ acc2：`reviewed` 非对象必须被拒')
  assert.equal(wrongChecks.ok, false, '★★ acc2：`checks` 非数组必须被拒')

  /**
   * ── acc2 的**核心**：报错消息必须**区分「缺失」与「类型错」** ────────────────────
   *   ★ 而"区分"的可执行形式：形状坏那一句里必须**明说它在场**，
   *     而缺席那一格**根本没有错**（所以不存在"两句同形"的问题）。
   */
  console.log(`  [t6] 形状坏的原话：${String(wrongShape.error).slice(0, 120)}`)
  assert.match(
    String(wrongShape.error), /present|在场/,
    '★★ acc2：形状坏的措辞必须点名它在场 —— 否则读的人会去"补一个字段"',
  )
  assert.match(
    String(wrongShape.error), /not an object|must be an object/,
    '★★ acc2：而它必须说清**是哪一种**类型错（不是一句笼统的"形状不对"）',
  )
  assert.notEqual(
    String(wrongShape.error), String(wrongChecks.error),
    '★★ acc2：两种形状坏必须**各自指名**（否则读的人不知道该修哪一项）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// P4（t4 + t8 + t10）· 判据本体 + 两条接线
// ─────────────────────────────────────────────────────────────────────────────

test('★ P4/t4·acc1/acc2/acc5：`contract.task-atomicity` 进了 `ALL_GATES`，且差集**恰好**是它', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry } = await realRegistry()
  const contractIds = (registry.list().contract ?? []).map((gate) => gate.id)
  console.log(`  [t6] registry.list().contract ⇒ ${contractIds.join(', ')}`)
  /** acc1：读**真实入口**（不是读源码）。 */
  assert.ok(
    contractIds.includes('contract.task-atomicity'),
    '★ acc1：`contract.task-atomicity` 必须出现在**真实入口**的 `registry.list().contract` 里',
  )
  /** acc2：接线本体在 `ALL_GATES` 里（行号级）。 */
  const text = sourceOrUndefined('src/gates/index.ts')
  const lines = text.split('\n')
  const binding = lines.map((line, index) => ({ line, number: index + 1 })).filter((e) => /^\s+contractTaskAtomicity,\s*$/.test(e.line))
  console.log(`  [t6] ALL_GATES 里的 \`contractTaskAtomicity,\` ⇒ 行 ${binding.map((e) => e.number).join(', ') || '(无)'}`)
  assert.equal(binding.length, 1, '★★ acc2：`contractTaskAtomicity` 必须**恰好出现一行**在 ALL_GATES 里')

  /**
   * ── acc5：集合比对（不是"确认某条仍在"）──────────────────────────────────────
   *
   * ★ 而比对的**基线**必须是【t4 自己的父提交】—— 否则会把 t10 的那条也算进来，
   *   而"差集恰好 = {contractTaskAtomicity}"就会假红。
   *   ★ 本审查实测过这一次（第一版就取错了基线）。
   */
  const readBindings = (source) => [...source.split('const ALL_GATES')[1].matchAll(/^\s+(\w+),\s*$/gm)].map((match) => match[1])
  /**
   * ── ★★ 比对的**两端都必须是 git 里的提交** ──────────────────────────────────────
   *
   * MEASURED（本审查第一版写错了）：我拿 `090c1ca~1`（t3 时）比**工作树** ⇒ 差集是
   *   `{contractTaskAtomicity, dispatchPlanReviewed}`（因为 t10 也在工作树里）⇒ **假红**。
   * ★ 而"t4 加了且只加了一条"这件事，只有比 `090c1ca~1 → 090c1ca` 才能看见。
   *   ⇒ 差集**恰好** = `{contractTaskAtomicity}`，而那正是 acc5 要的。
   */
  let before
  let atT4
  try {
    before = readBindings(execFileSync('git', ['show', '090c1ca~1:src/gates/index.ts'], { cwd: ROOT, encoding: 'utf8' }))
    atT4 = readBindings(execFileSync('git', ['show', '090c1ca:src/gates/index.ts'], { cwd: ROOT, encoding: 'utf8' }))
  } catch {
    t.skip('未测量：取不到 t4 的提交（浅克隆 / 该提交不在历史里）⇒ 无法做集合比对（不猜）')
    return
  }
  const after = readBindings(text)
  const addedAtT4 = atT4.filter((name) => !before.includes(name))
  const removedAtT4 = before.filter((name) => !atT4.includes(name))
  console.log(`  [t6] t4 那一次：${before.length} → ${atT4.length} 条 · 新增 ${JSON.stringify(addedAtT4)} · 移除 ${JSON.stringify(removedAtT4)}`)
  assert.deepEqual(removedAtT4, [], '★★ acc5：t4 不许移除任何既有绑定（不重排、不替换别人的行）')
  assert.deepEqual(addedAtT4, ['contractTaskAtomicity'], '★★ acc5：**t4 自己那一次**的差集必须恰好 = {contractTaskAtomicity}')
  /** ★ 而工作树上的**当前**集合也报出来（它是两条接线共存后的读数）—— 但不作断言。 */
  console.log(`  [t6] 而工作树上现在是 ${after.length} 条（含 t10 那条）—— 两条共存的读数，是数字不是断言`)
})

test('★ P4/t4·acc3/acc6：观察集走**环境变量**（装配点里不许写 `registry.observe`）', (t) => {
  const text = sourceOrUndefined('src/gates/index.ts')
  if (text === undefined) {
    t.skip('未测量：src/gates/index.ts 不在盘上')
    return
  }
  /**
   * ── acc3 的可执行形式：装配点里**不许有可执行的** `registry.observe(...)` ────────
   *   ★ 只看注释里提到它不算 —— 注释在讲"为什么**不**这么写"。
   *   ⇒ 所以判的是**去掉注释行之后**还有没有那一句。
   */
  const withoutComments = text.split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n')
  const observable = [...withoutComments.matchAll(/registry\.observe\s*\(/g)].length
  console.log(`  [t6] 去掉注释后 \`registry.observe(\` 出现 ${observable} 次`)
  assert.equal(observable, 0, '★★ acc3：装配点里不许写 `registry.observe(...)` —— 观察集是运行时数据')
  /** 而观察入口必须**存在**（在注册表上，经环境变量）。 */
  const registryText = sourceOrUndefined('src/gates/registry.ts')
  assert.notEqual(registryText, undefined, '★ 前置：src/gates/registry.ts 在盘上')
  assert.match(registryText, /OBSERVE_GATES_ENV\s*=\s*'AGENT_TEAMS_OBSERVE_GATES'/, '★ acc3：环境变量入口必须存在')
  /**
   * ── acc6：不许写恒真/恒红的替身断言 ────────────────────────────────────────────
   *   ★ 可执行形式：装配点里不许出现"若某条在则…"那种**条件式**断言。
   */
  assert.equal(
    /if\s*\(\s*(plan|dispatchPlan|contractTask)/.test(withoutComments), false,
    '★★ acc6：装配点里不许出现"若某条在则…"的条件式替身断言（读不到与没问题同形）',
  )
})

test('★ P4/t10·acc1/acc4：`dispatch.plan-reviewed` 也接上了，且两条接线**共存**', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry } = await realRegistry()
  const dispatchIds = (registry.list().dispatch ?? []).map((gate) => gate.id)
  const contractIds = (registry.list().contract ?? []).map((gate) => gate.id)
  console.log(`  [t6] registry.list().dispatch ⇒ ${dispatchIds.join(', ')}`)
  assert.ok(dispatchIds.includes('dispatch.plan-reviewed'), '★ acc1：`dispatch.plan-reviewed` 必须在真实入口里')
  /** acc4：两条接线共存，互不覆盖。 */
  assert.ok(
    contractIds.includes('contract.task-atomicity') && dispatchIds.includes('dispatch.plan-reviewed'),
    '★★ acc4：两条接线必须**共存**（t4 的 + t10 的）',
  )
  /** 而"共存"还要证明**没有互相顶掉**：两条各自的位置正确。 */
  assert.equal(contractIds.filter((id) => id === 'contract.task-atomicity').length, 1, '★ 不许重复注册')
  assert.equal(dispatchIds.filter((id) => id === 'dispatch.plan-reviewed').length, 1, '★ 不许重复注册')
})

test('★★ P4/P2b·t8·acc1/acc2/acc4：判据本体三态不同形 + 对照臂 + 必须**指名缺哪一问**', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry } = await realRegistry()
  /**
   * ── ★★ 输入**自己构造**（不复用实现者夹具）──────────────────────────────────────
   *
   * ★ 而 `createdAt` 必须**晚于这道门上线** —— 否则 `appliesTo` 判它是存量 ⇒ 判据不跑
   *   （MEASURED：本审查的第一版就漏了这一格，两条臂静默 skip）。
   */
  const NEW_TASK = { createdAt: Date.now() + 86_400_000 }
  const base = { id: 'r1-review', kind: 'implementation', inScope: ['src/x.ts'], acceptance: ['a'], verify: ['pnpm typecheck'], ...NEW_TASK }
  const evaluate = async (task) => {
    const result = await registry.evaluate('dispatch', { task, wantsCompleted: false, taskNotTerminal: true })
    return {
      blockers: result.blockers.filter((line) => String(line).includes('plan-reviewed')),
      unmeasured: result.unmeasured === undefined ? undefined : String(result.unmeasured),
      gate: result.ran.find((entry) => entry.id === 'dispatch.plan-reviewed'),
    }
  }
  const absent = await evaluate(base)
  const broken = await evaluate({ ...base, reviewed: 'not-an-object' })
  console.log(`  [t6] 缺席 verdict=${absent.gate?.verdict} · 形状坏 verdict=${broken.gate?.verdict}`)

  /** acc1①：不在场 ⇒ blocked，且**指明缺哪一问**。 */
  assert.equal(absent.gate?.verdict, 'blocked', '★ acc1：`reviewed` 缺席 ⇒ blocked')
  const absentText = absent.blockers.join('\n')
  assert.match(absentText, /`[a-z-]+`/, '★★ acc4：blocked 必须**指名**它缺哪一问（不是一句"你该审了"）')
  /** acc1②：在场但形状坏 ⇒ unmeasured（**不并进 ok**）。 */
  const brokenText = `${broken.unmeasured ?? ''}\n${broken.blockers.join('\n')}`
  assert.notEqual(broken.gate?.verdict, 'ok', '★★ acc1：形状坏绝不许并进 ok')
  assert.match(brokenText, /unmeasured|形状|shape|could not/i, '★ acc1：形状坏应落 `unmeasured`（读不出它审了什么）')

  /** acc2（对照臂）：合法输入**必须过** —— 缺它就无法区分"判据有效"与"判据在乱拒"。 */
  const complaint = absent.blockers.map(String).find((line) => line.includes('plan-reviewed')) ?? ''
  const missing = [...complaint.matchAll(/`([a-z-]+)`/g)].map((match) => match[1]).filter((name) => name !== 'reviewed')
  if (missing.length === 0) {
    t.skip('未测量：判据没有报出"缺哪几问" ⇒ 无法构造完整戳（不猜）')
    return
  }
  const all = ['scope', ...missing]
  const legal = await evaluate({ ...base, reviewed: { at: 1, by: 'reviewer', checks: all.map((id) => ({ id, verdict: 'pass' })) } })
  console.log(`  [t6] 对照臂：五问齐（${all.join(', ')}）⇒ verdict=${legal.gate?.verdict} · blockers=${legal.blockers.length}`)
  assert.equal(legal.blockers.length, 0, '★★ acc2（对照臂）：合法输入必须过 —— 否则它是一条恒拒的判据')

  /** acc3：判据是**纯数据变换**（不 import 任何 I/O）—— 读声明的字面。 */
  const body = sourceOrUndefined('src/gates/dispatch/plan-reviewed.ts')
  assert.notEqual(body, undefined, '★ 前置：判据本体在盘上')
  const ioImports = body.split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .filter((line) => /node:fs|node:child_process|node:path|node:os/.test(line))
  console.log(`  [t6] 判据本体里的 I/O import ⇒ ${ioImports.length} 条`)
  assert.deepEqual(ioImports, [], '★★ acc3：判据是纯数据变换 ⇒ 不许 import 任何 I/O')
})

// ─────────────────────────────────────────────────────────────────────────────
// P5（t12）· 四个必答项提升为可求值的真值
// ─────────────────────────────────────────────────────────────────────────────

test('★ P5/t12·acc1/acc2/acc4：四问是**可 import 的真值**，且 `unmeasured` 与通过不同形', async (t) => {
  const script = join(ROOT, 'scripts', 'plan-review-check.mjs')
  if (!existsSync(script)) {
    t.skip('未测量：scripts/plan-review-check.mjs 不在盘上')
    return
  }
  const mod = await import(script)
  if (typeof mod.REQUIRED_PLAN_QUESTIONS === 'undefined' || typeof mod.checkPlanReview !== 'function') {
    t.skip('未测量：`REQUIRED_PLAN_QUESTIONS` / `checkPlanReview` 不在导出面上')
    return
  }
  /** acc1：四问是**可 import 的真值**（不是夹具内部的常量）。 */
  const required = mod.REQUIRED_PLAN_QUESTIONS
  console.log(`  [t6] REQUIRED_PLAN_QUESTIONS ⇒ ${required.map((q) => q.key ?? q.id ?? String(q)).join(', ')}`)
  assert.equal(required.length, 4, `★ acc1：必答项必须恰好四项。实测 ${required.length}`)
  /** ★ 而"可被**外部** import"的可执行形式：它的定义不在任何夹具文件里。 */
  const definedInFixtures = ['scripts/plan-review-tier.test.mjs']
    .filter((fixture) => (sourceOrUndefined(fixture) ?? '').includes('REQUIRED_PLAN_QUESTIONS ='))
  assert.deepEqual(definedInFixtures, [], '★★ acc1：四问的**定义**不许住在夹具里（那正是被提升掉的东西）')

  /**
   * ── acc2：能对一份**真实的计划**求值 ────────────────────────────────────────────
   *   ★ 而"计划"的**形状**是【一组契约】= 一个数组（`checkPlanReview(plan)` 的入参）——
   *     本审查第一版喂了 `{tasks: […]}`，它**正确地**报了 `unmeasured`
   *     （"could not be read as a list of contracts (got object)"）。
   *   ★★ 而那不是缺陷：**空/读不到的计划与"没有契约"必须不同形** —— 它做到了。
   */
  const plan = [
    { id: 'r1-a', subject: 'A', objective: 'why now: because B is blocked', description: 'steps: 1. do it', inScope: ['src/x.ts'], acceptance: ['reading: the reading is 3'] },
  ]
  const good = mod.checkPlanReview(plan)
  console.log(`  [t6] 对一份完整契约 ⇒ overall=${good.overall} · contracts=${good.contracts?.length}`)
  assert.equal(good.contracts?.length, 1, '★ acc2：必须能对一份真计划求值（每个契约给一条结论）')
  assert.ok(
    ['present', 'missing', 'unmeasured'].includes(String(good.overall)),
    `★ acc2：结论必须落在三态之一。实测 ${String(good.overall)}`,
  )

  /**
   * ── acc4：`unmeasured` 与「通过」**不同形** ────────────────────────────────────
   *   ★ 可执行形式：喂①**读不出**的输入、②**空数组** ⇒ 两者都必须报 `unmeasured`，
   *     而"一份四问齐备的计划"必须**不**报 unmeasured。
   */
  const unreadable = mod.checkPlanReview({ not: 'a plan' })
  const empty = mod.checkPlanReview([])
  console.log(`  [t6] 读不出 ⇒ overall=${unreadable.overall} · 空计划 ⇒ overall=${empty.overall} · 样例计划 ⇒ overall=${good.overall}`)
  assert.equal(unreadable.overall, 'unmeasured', '★★ acc4：读不出契约 ⇒ 必须 `unmeasured`')
  assert.equal(empty.overall, 'unmeasured', '★★ acc4：空计划 ⇒ 必须 `unmeasured`（空与读不到不同形于"齐备"）')

  /**
   * ── ★★ 而"不同形"的正确比较：**一份四问齐备的计划** ─────────────────────────────
   *
   * ★ MEASURED（本审查第一版写错了）：我拿**同一份样例计划**去比 `good.overall`，
   *   而那份计划**本来就缺第④问**（`stop-points` 读不出）⇒ 它也报 `unmeasured`。
   *   ⇒ 那个断言假红，而**不是**工具错了 —— 工具如实报了"有一问答不出来"。
   * ★ 修法：造一份**四问齐备**的计划，用它作"可读且齐备"那一端。
   */
  const complete = [{
    id: 'r1-complete',
    subject: 'A',
    objective: 'why now: B is blocked, so this must land first',
    description: 'steps: 1. write it 2. run it',
    inScope: ['src/x.ts'],
    acceptance: ['reading: the counts are 3 and 0'],
    /**
     * ★ MEASURED（本审查第一版又缺了这一格）：四问各自的**证据来源**是
     *   `objective` / `inScope` / `acceptance` / ★ **`verify`**（不是 `outOfScope`）。
     *   ⇒ 我第一版把 `stop-points` 写进 `outOfScope` ⇒ 那一格仍然 `unmeasured`。
     * ★ 而那**不是**工具错了：它如实报了"第④问答不出来"。
     */
    verify: ['pnpm typecheck'],
  }]
  const completeResult = mod.checkPlanReview(complete)
  console.log(`  [t6] 四问齐备的计划 ⇒ overall=${completeResult.overall} · detail=${String(completeResult.detail).slice(0, 70)}`)
  assert.notEqual(
    unreadable.overall, completeResult.overall,
    '★★ acc4：读不出与【一份可读且齐备的计划】必须**不同形**',
  )
  /** ★ 而三态各不相同：读不出 / 可读但缺项 / 可读且齐备。 */
  console.log(`  [t6] 三态读数：读不出=${unreadable.overall} · 可读而缺项=${good.overall} · 可读且齐备=${completeResult.overall}`)
  assert.match(String(unreadable.detail ?? ''), /could not be read|读不到|unmeasured/i, '★★ acc4：它必须说清"读不到什么"')

  /** acc3：第③项（读数）的口径含「读数」，且对**没有读数**的契约必须判「缺」。 */
  if (typeof mod.looksLikeReading === 'function') {
    const withReading = mod.looksLikeReading('reading: the reading is 3')
    const withoutReading = mod.looksLikeReading('this is done')
    console.log(`  [t6] looksLikeReading('reading: …')=${withReading} · looksLikeReading('this is done')=${withoutReading}`)
    assert.equal(withReading, true, '★ acc3：带"读数"的文本必须被判为有读数')
    assert.equal(withoutReading, false, '★★ acc3（反向半边）：没有读数的文本**不许**被判成有读数')
  } else {
    t.skip('未测量：`looksLikeReading` 不在导出面上 ⇒ 第③项的口径无法从外部核（不猜）')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 独立性 + 射程边界（写下来，不假装覆盖）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 独立性：本审查者**不是**任何被审任务的实现者', () => {
  /**
   * ── ★★ 为什么"独立性"要写成一条可执行的断言 ────────────────────────────────────
   *
   *   契约逐字：「审查者**不**是任何被审任务的实现者（本任务由 verifier 承担，
   *   与 pipeline-author / decompose-author / wire-author 分离）」
   *   ★ 而它的可执行形式是：**本文件不在任何一个被审任务的 inScope 里**。
   *     ⇒ 那排除了"实现者顺手给自己写一份审查"。
   */
  const reviewerScope = 'scripts/review-unified-pipeline.test.mjs'
  /** 被审任务的 inScope（从契约原文里取，不是从实现者的自述里取）。 */
  const reviewedScopes = {
    t1: ['scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs'],
    t2: ['src/types.ts', 'lib/types.js', 'lib/types/types.d.ts'],
    t9: ['src/tools/create-task.ts'],
    t11: ['src/quality-gates.ts'],
    t4: ['src/gates/index.ts'],
    t8: ['src/gates/dispatch/plan-reviewed.ts'],
    t10: ['src/gates/index.ts'],
    t12: ['scripts/plan-review-check.mjs', 'scripts/plan-review-tier.test.mjs', 'docs/PLAN-REVIEW.md'],
  }
  const overlaps = Object.entries(reviewedScopes)
    .filter(([, scope]) => scope.includes(reviewerScope))
    .map(([id]) => id)
  console.log(`  [t6] 本审查文件与被审任务 inScope 的重叠 ⇒ ${overlaps.length === 0 ? '(无)' : overlaps.join(', ')}`)
  assert.deepEqual(
    overlaps, [],
    '★★ 独立性：本审查文件不许落在任何被审任务的 inScope 里 —— 否则就是"实现者审自己"',
  )
  /**
   * ★ 而第二条独立性：本文件**不 import 任何实现者夹具**的辅助函数。
   *   可执行形式：本文件的 import 里不许出现 `gate-*.test.mjs` / `verify-*.test.mjs`。
   */
  const self = sourceOrUndefined(reviewerScope)
  assert.notEqual(self, undefined, '★ 前置：本文件在盘上')
  const fixtureImports = self.split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .filter((line) => /gate-.*\.test\.mjs|verify-.*\.test\.mjs/.test(line))
  assert.deepEqual(fixtureImports, [], '★★ 独立性：不许 import 实现者夹具的辅助函数（那些编码了他们的假设）')
})

test('★ 射程边界：本审查**不能**声称的', () => {
  /**
   * ★★★ 这一臂的产物是**一句话**，而它必须被打印出来（读日志的人要看到它）。
   *
   *   本审查**能**声称：那些 acceptance 里的要求，在**当前盘上的实现**里
   *     有对应的、可机械核对的证据（结构性 + 行为性）。
   *   本审查**不能**声称：
   */
  const boundaries = [
    '✗ 判据的【语义正确性】—— 例如 `contract.task-atomicity` 判"目录条目 ⇒ 大档"是否**是**正确的口径；',
    '   本审查只证明"它在真实入口里、对构造的输入会开火、且方向对形状敏感"。',
    '✗ 【生产路径】上的端到端 —— 本审查直调 `lib/gates/index.js` / `scripts/friction-triage.mjs`，',
    '   不经过 `agent_teams_create_task` / `agent_teams_update_task` 的工具边界（那属其它任务）。',
    '✗ 【用户目标】是否被完全满足 —— 契约的 acceptance 是目标的**一个投影**；',
    '   本审查判的是"那几条 acceptance 被满足了吗"，不是"用户想要的都做到了吗"。',
    '✗ 【未来】不会回归 —— 本审查是**此刻**的读数；有存量红（`test:gates` exit=1）意味着',
    '   仓库级 verify 此刻不绿，而那与本次审的四条改动无关。',
  ]
  for (const line of boundaries) console.log(`  [t6] ${line}`)
  assert.ok(boundaries.length > 0, '★ 前置：射程边界必须被写出来（这一臂的产物就是它）')
})

test('★ 存量红与本次审查的关系（如实报，不并进"通过"）', async (t) => {
  /**
   * ── ★★ 为什么这一条必须存在 ───────────────────────────────────────────────────
   *
   *   本任务 verify 的第三条是 `pnpm test:gates`，而它**真实 exit=1**。
   *   ★ 而那**不是**这四条改动的回归 —— 但它必须被**看见**，而不是被"本审查通过了"盖住。
   *   ⇒ 所以这里把它做成一条**读数**（打印 + 断言"它确实红着"），
   *     而不是让读日志的人以为库是全绿的。
   */
  /**
   * ── ★★★ 一个只有跑才现形的坑（本审查第一版就撞了）──────────────────────────────
   *
   * MEASURED：在 `node --test` **之内**再起一个 `node --test`（经 `pnpm test:gates`），
   * 子进程的汇总行**不会被打印**（`NODE_TEST_CONTEXT` 让它变成子报告器）
   * ⇒ 我读到的 `counts.tests` 是 `null` —— **而那是"我没读到"，不是"没有失败"**。
   *
   * ★ 所以本臂**不断言那一份汇总**（它读不到），而是：
   *   ① 如实报"我在这个上下文里读不到它"（而不是把 `null` 读成 0）
   *   ② 把**它为什么读不到**写下来
   * ⇒ ★ 而那正是本队那条纪律：**没能测量与测得了零必须不同形。**
   */
  let exitCode = 0
  let raw = ''
  try {
    raw = execFileSync('pnpm', ['test:gates'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    exitCode = typeof error?.status === 'number' ? error.status : -1
    raw = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`
  }
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map((key) => {
    const match = raw.match(new RegExp(`^ℹ ${key} (\\d+)$`, 'm'))
    return [key, match === null ? null : Number(match[1])]
  }))
  const readable = counts.tests !== null
  console.log(`  [t6] pnpm test:gates ⇒ exit=${exitCode} · 汇总可读=${readable} · ${JSON.stringify(counts)}`)
  if (!readable) {
    console.log('  [t6]   ★ 读不到汇总是【本上下文的结构性后果】（嵌套 node --test ⇒ 子报告器不打印汇总），')
    console.log('  [t6]     不是"仓库没有失败"。⇒ 以【退出码】为准：exit=' + exitCode)
  }
  /**
   * ★ 断言的是**"读数被交出来了"**，而它的形状是【退出码】——
   *   而汇总那份是**可选**的（读不到时如实报"读不到"）。
   */
  assert.ok(
    Number.isInteger(exitCode),
    '★ 前置：退出码必须是一个整数（它是本臂唯一可靠的读数）',
  )
  console.log('  [t6] ★ 而它与本次审查的四条改动无关 —— 它是仓库存量红（t19 那一族）。以退出码为准，不以本审查的结论为准。')
})
