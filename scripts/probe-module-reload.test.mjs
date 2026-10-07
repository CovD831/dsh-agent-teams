#!/usr/bin/env node
/**
 * ── 探针的臂：进程内换模块（t52）────────────────────────────────────────────────
 *
 * ★ 本文件测的是【那条路可不可行】，而结论是一条**负结果**。
 *   ⇒ 所以这里有两条同样重要的东西：
 *     ① 正面读数（缓存语义、指纹真的重读磁盘）—— 证明"技术上它确实能换代码"
 *     ② 负面读数（私有 state 丢、混代静默、换的是模块不是图）—— 证明"代价不可接受"
 *   ★ 缺了 ①，"不可行"会被读成"做不到"；缺了 ②，会被读成"能成"。
 *
 * ── ★ 三态纪律（本任务的硬约束）────────────────────────────────────────────────
 *
 *   feasible / infeasible / undecidable —— ★ 绝不把 `undecidable` 写成 `feasible`。
 *   臂 10 与臂 11 是这一条的机械形式。
 *
 * Run: node --test scripts/probe-module-reload.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  runProbe,
  verdictOf,
  experimentCacheSemantics,
  experimentModuleVersusGraph,
  experimentMixedGeneration,
  experimentDiscardOldInstance,
} from './probe-module-reload.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// ① 缓存语义 —— captain 的两个事实，逐条复核
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 — a NEW query really re-reads the disk (captain’s fact ① holds)', async () => {
  const result = await experimentCacheSemantics()
  assert.equal(result.freshQueryReadsDisk, true, '带新 query 的 import 必须重读磁盘')
})

test('臂 2 — the OLD specifier reuses the cache (captain’s fact ② holds)', async () => {
  const result = await experimentCacheSemantics()
  assert.equal(result.oldQueryReusesCache, true, '旧 specifier 必须复用缓存')
})

test('★ 臂 3 — CORRECTION: plain import twice IS the same instance (captain’s experiment B misread)', async () => {
  /**
   * ── ★ 为什么要单独纠正这一条 ────────────────────────────────────────────────
   *
   * captain 报告：「普通 import 两次 ⇒ a === b 为 false（那说明每次都新建）」
   * ★ 实测为 **true** —— 同一 specifier 的两次 `import` 是**同一个模块对象**。
   *   那正是 ESM 的语义，而**整条"缓存复用"的前提就建立在它上面**。
   *
   * ★ 若"每次都新建"成立，那么"带指纹能拿到新实例"就毫无信息量
   *   （因为不带指纹也能拿到"新的"）。⇒ 这一条必须纠正，否则结论的根基是错的。
   */
  const result = await experimentCacheSemantics()
  assert.equal(
    result.plainImportTwiceIsSameInstance, true,
    '★ 同一 specifier 的两次 import 必须是【同一个模块对象】—— ESM 缓存语义',
  )
  assert.equal(result.fingerprintForked, true, '★ 而带指纹的那一次确实分叉了（这才是有信息量的对照）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ② 换的是「模块」还是「模块图」？（★ 最根本的那一问）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4 — the answer: it swaps a MODULE, not the MODULE GRAPH', async () => {
  /**
   * ── ★★ 本臂是全任务的核心读数 ────────────────────────────────────────────────
   *
   * 直觉是"带指纹重新 import ⇒ 整张图重新求值 ⇒ 状态分裂成每一代一份"。
   * ★ 实测【不是】：
   *
   *     entry 被指纹化 ⇒ 重新求值
   *     而 entry 内部的 `import './tool.mjs'` 是**无 query 的 specifier**
   *       ⇒ 命中同一个缓存实例 ⇒ tool 与 shared **没有重新求值**
   *     ⇒ 所以 state 是【同一份】，而新代码与旧状态【拼在一起】跑。
   *
   * ⇒ 换掉的是「模块」，**不是**「模块图」—— 而后者才是真正需要的。
   */
  const graph = await experimentModuleVersusGraph()
  assert.equal(graph.entryReReadFromDisk, true, '前置：entry 确实从磁盘重读了')
  assert.equal(graph.entryForked, true, '前置：entry 确实分叉了')
  assert.equal(
    graph.depReusedFromCache, true,
    '★ 依赖必须复用缓存 —— 这正是"换的是模块、不是图"的证据',
  )
  assert.equal(graph.reloadsModuleNotGraph, true)
})

test('★ 臂 5 — and therefore state is SHARED across generations, not split', async () => {
  /**
   * ★ 这一臂纠正一个**看起来更吓人、但不对**的说法：
   *   「带 query 重新 import 会让分裂从 N 份变成每一代构建一份」。
   *
   * ⇒ 实测：分裂**没有发生** —— 因为依赖没有跟着被指纹化。
   * ★ 而结论不是"所以没问题"，是**问题换了一个样子**：
   *   从"状态分裂"变成"新旧混代"（见臂 6）。★ 后者更坏，因为它是静默的。
   */
  const graph = await experimentModuleVersusGraph()
  assert.equal(
    graph.stateSharedAcrossGenerations, true,
    '★ 状态的实例是同一份 —— "每一代一份"的说法与实测不符',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ ★★ 混代：新代码 + 旧状态，而它静默
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6 — MIXED GENERATION is SILENT: new code reads old state, gets undefined, throws nothing', async () => {
  /**
   * ── ★★ 这是本探针最重要的一条，也是本队那条形态的直接实例 ─────────────────────
   *
   *   第 1 代的代码写字段 `state.waitRecords`；
   *   第 2 代的代码读字段 `state.waitWindows`（一次平常的重命名）；
   *   而 state 还是旧的那一份。
   *
   * ⇒ 新代码读出 `undefined`，而**没有任何一处抛错**。
   *   ⇒ 那个症状与"本来就没有这条记录"同形 ——
   *     正是 absorb-dev 在 t39 写的那句：
   *     「而那个症状与『这个成员确实没在动』同形。」
   */
  const mixed = await experimentMixedGeneration()
  assert.equal(mixed.silentMixedGeneration, true, '★★ 混代必须是静默的 —— 这正是它危险的地方')
  assert.equal(mixed.currentReadIsUndefined, true, '★ 新代码读新字段得到 undefined')
  assert.equal(mixed.legacyReadStillWorks, true, '★ 而旧字段仍然在 —— 所以"看起来"没坏')
})

// ─────────────────────────────────────────────────────────────────────────────
// ④ ★★ 真实插件：排队重载的申请会丢，且不可迁移
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7 — on the REAL plugin: a private module-level `let` makes the queued reload unrecoverable', async () => {
  const { readings } = await runProbe()
  const real = readings.real
  assert.equal(real.available, true, `前置：lib 必须已构建（${real.reason ?? ''}）`)

  /**
   * ★★ `requestedRestart` 是 `src/tools/shared/entities.ts` 里的一个
   *   **模块级 `let`，没有 export**（实测 grep）。
   *   ⇒ 指纹化的新实例：
   *      · 读不到它（没有导出）
   *      · 迁不了它（没有入口）
   *      · 而它恰是"排队重载"这条机制的状态
   *   ⇒ ★ 后果：**一次重载会把它自己的触发申请丢掉。**
   */
  assert.ok(
    real.privateModuleLets.includes('requestedRestart'),
    `★ 实测私有模块级 let：${JSON.stringify(real.privateModuleLets)}`,
  )
  assert.equal(
    real.pendingRequestLostAcrossReload, true,
    '★★ 排队重载的申请必须在跨重载时丢失 —— 这是"不可行"的第一条机制',
  )
  assert.equal(real.fingerprintedForks, true, '前置：指纹化确实分叉了实例')
})

test('★ 臂 8 — the CONTRAST: exported container state IS migratable (so the verdict is not blanket)', async () => {
  /**
   * ★ 这一臂防"一刀切"：不是因为"模块状态一律不能迁移"才判不可行。
   *   有导出的容器（`waitRecords` / `runtimeGateLog` …）**可以**逐条拷贝。
   *   ⇒ 判不可行的理由是**私有**那一格没有入口，而它恰好是承重的那一格。
   */
  const { readings } = await runProbe()
  assert.ok(
    readings.real.exportedMutableState.length > 0,
    `★ 应当存在可迁移的导出容器；实测：${JSON.stringify(readings.real.exportedMutableState)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 旧实例的丢弃
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9 — the old instance’s subscriptions do NOT follow the new one', async () => {
  /**
   * ★ 订阅留在旧实例上；新实例的 `Set` 是空的。
   *   ⇒ 而"按引用搬过去"是可行的（搬一份引用），
   *     但那个闭包**仍然闭在旧模块的作用域上** ⇒ 搬过去的是"半旧"的东西。
   *   ★ 本臂把这两个读数分开钉：`byReference` 为真、`byMeaning` 为假。
   *     把它们合成一个"能不能搬"会掩盖真正的困难。
   */
  const discard = await experimentDiscardOldInstance()
  assert.equal(discard.newInstanceHasNoSubscribers, true, '新实例的订阅集是空的')
  assert.equal(discard.oldSubscriptionStillWorks, true, '旧实例上的订阅仍在')
  assert.equal(discard.subscriptionMigratableByReference, true)
  assert.equal(
    discard.subscriptionMigratableByMeaning, false,
    '★ 按引用能搬，而按语义搬不动 —— 后者才是真正的问题',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ ★★ 三态：判定必须由【读数】推出，且 undecidable ≠ feasible
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 10 — the verdict is `infeasible`, and every reason names a concrete reading', async () => {
  const { verdict, reasons, readings } = await runProbe()
  assert.equal(verdict, 'infeasible', `★ 实测判定：${verdict}`)
  /**
   * ★ 每条理由都必须**指名一个读数**，而不是一句笼统的"代价太高"。
   *   没有具体读数的理由，无法被复核，也无法在被推翻时知道该改哪里。
   */
  assert.ok(reasons.length >= 3, `★ 至少三条机制级理由；实测 ${reasons.length}`)
  assert.ok(reasons.some((r) => r.includes('private module-level')), '① 私有状态不可迁移')
  assert.ok(reasons.some((r) => r.includes('SILENT')), '② 混代静默')
  assert.ok(reasons.some((r) => r.includes('module graph')), '③ 换的是模块不是图')
  /** ★ 而每条理由都真的由读数支撑（不是写死的文案）。 */
  assert.equal(readings.real.pendingRequestLostAcrossReload, true)
  assert.equal(readings.mixed.silentMixedGeneration, true)
  assert.equal(readings.graph.reloadsModuleNotGraph, true)
})

test('★★ 臂 11 — `undecidable` is a REAL third state and is NOT reported as `feasible`', async () => {
  /**
   * ── ★ 本任务的硬约束：绝不把「判不了」写成「可行」────────────────────────────
   *
   * ★ 做法：把"真实插件不可用"这一格喂进去 —— 那是真实会发生的
   *   （没 build / 没有 lib/）—— 断言它落 `undecidable`，
   *   而**不是**落 `feasible`（那会把"我没能测到"读成"这条路能走"）。
   */
  const undecidable = verdictOf({
    real: { available: false, reason: 'lib is not built' },
    mixed: { silentMixedGeneration: true },
    graph: { reloadsModuleNotGraph: true },
  })
  assert.equal(undecidable.verdict, 'undecidable', '"测不到"必须是第三种取值')
  assert.notEqual(undecidable.verdict, 'feasible', '★★ 绝不把判不了写成可行')

  /**
   * ★ 反向半边：没有那条缺口时，同样的读数必须落 `infeasible` ——
   *   证明 `undecidable` 不是"总是返回"的兜底分支（那会退化成恒真）。
   */
  const decidable = verdictOf({
    real: { available: true, pendingRequestLostAcrossReload: true, privateModuleLets: ['requestedRestart'] },
    mixed: { silentMixedGeneration: true },
    graph: { reloadsModuleNotGraph: true },
  })
  assert.equal(decidable.verdict, 'infeasible')
  assert.notEqual(undecidable.verdict, decidable.verdict, '两态必须不同形')

  /**
   * ★ 第三个对照：全部读数都"没问题"时必须落 `feasible` ——
   *   否则 `verdictOf` 会是一个**恒为不可行**的函数，而那种臂是恒真的。
   */
  const feasible = verdictOf({
    real: { available: true, pendingRequestLostAcrossReload: false, privateModuleLets: [] },
    mixed: { silentMixedGeneration: false },
    graph: { reloadsModuleNotGraph: false },
  })
  assert.equal(feasible.verdict, 'feasible', '★ 三态齐全：可行也必须是一个真会发生的取值')
  assert.equal(new Set([feasible.verdict, decidable.verdict, undecidable.verdict]).size, 3, '★ 三态两两不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 定向突变：把机制去掉 ⇒ 对应的臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 12 — DIRECTED MUTATION: drop the fingerprint and the new code never loads', async () => {
  /**
   * ★ 突变的是**探针赖以成立的那一步**：不带指纹去 import。
   *   ⇒ 那时拿到的仍是旧代码（缓存），于是"能不能换代码"这个前提本身为假。
   *   ★ 断言的是**对照确实存在**：带指纹 ⇒ 新；不带 ⇒ 旧。
   *     若这条对照不成立，臂 1/臂 4 都会变成没有对象的断言。
   */
  const dir = mkdtempSync(join(tmpdir(), 'probe-mutation-'))
  try {
    const mod = join(dir, 'm.mjs')
    writeFileSync(mod, 'export const V = 1\n')
    const gen1 = await import(pathToFileURL(mod).href)
    writeFileSync(mod, 'export const V = 2\n')

    // 突变：不带指纹（= 修法前的读法）
    const mutated = await import(pathToFileURL(mod).href)
    assert.equal(mutated.V, 1, '★ 不带指纹 ⇒ 仍是旧代码（这就是突变）')

    // 正解：带指纹
    const url = pathToFileURL(mod)
    url.searchParams.set('build', 'x')
    const fixed = await import(url.href)
    assert.equal(fixed.V, 2, '★ 带指纹 ⇒ 新代码')
    assert.notEqual(mutated.V, fixed.V, '★ 两者必须不同，否则"能换代码"没有证据')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('★ 臂 13 — DIRECTED MUTATION: the private `let` really is unreachable from outside', async () => {
  /**
   * ★ 臂 7 说"私有 let 不可迁移"。本臂把这个**不可达性**单独钉住：
   *   从模块对象上取 `requestedRestart` ⇒ 必须是 `undefined`（它没有导出）。
   *   ⇒ 于是"能不能把它拷到新实例上"这个问题的答案是"没有入口"，
   *     而不是"有入口但很麻烦"—— 两者不同形，而只有前者支撑"不可行"。
   */
  const entities = await import(pathToFileURL(join(ROOT, 'lib', 'tools', 'shared', 'entities.js')).href)
  assert.equal(
    entities.requestedRestart, undefined,
    '★ `requestedRestart` 不许出现在模块的导出面上（它就是那条没有入口的状态）',
  )
  /** ★ 而它的**读出口**存在 —— 所以能观测到"它丢了"，这正是臂 7 的证据来源。 */
  assert.equal(typeof entities.pendingRestartRequest, 'function', '★ 读出口必须在（否则连"丢了"都看不出来）')
  assert.equal(typeof entities.requestRestart, 'function', '写出口也在')
})

test('★ 臂 14 — the CLI entry point runs and exits 0 (the probe is runnable, not just importable)', async () => {
  /**
   * ★ 一个"只能在夹具里 import"的探针，与"人跑不了"同形 ——
   *   而本任务要的是一条能被复核的读数，不是一份内部函数。
   */
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'probe-module-reload.mjs')], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(out, /判定：infeasible/, `★ 人跑时也要给出判定。实测输出：\n${out}`)
  assert.match(out, /排队重载申请跨重载丢失/, '★ 而最要命的那条读数必须在人读的输出里')
})
