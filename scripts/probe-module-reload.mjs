#!/usr/bin/env node
/**
 * ── 探针：进程内换模块可行吗？（ESM 带指纹 import 的代价）───────────────────────
 *
 * 用法：`node scripts/probe-module-reload.mjs [--json]`
 *
 * ── ★★ 它回答的问题（t52）────────────────────────────────────────────────────
 *
 *   captain 实测：`await import(path + '?v=' + 指纹)` 能【重读磁盘】拿到新代码。
 *   ⇒ 于是看起来"进程内换模块"在技术上可行。
 *
 *   而本探针要回答的是**它的代价**，即三件事：
 *     ① 新实例的【状态是否可迁移】
 *     ② 旧实例是否可被【丢弃】（工具注册表 / fiber / 事件订阅）
 *     ③ ★ 换掉的到底是「模块」还是「模块图」—— 后者才是真正需要的
 *
 * ── ★★ 本探针的结论是【不可行】，而它给出的是机制不是一个断言 ────────────────────
 *
 *   下面每一条都是**在这个进程里当场跑出来的**，不是读代码推断的。
 *   三条读数合起来给出 `infeasible`（见 `verdictOf`）：
 *
 *     · 「闭包/私有 state 不可迁移」       —— 有具体的那个变量做证据
 *     · 「重载请求本身会丢」               —— 有当场复现做证据
 *     · 「换的是模块而不是模块图」         —— 有依赖实例身份做证据
 *
 * ★ 三态：`feasible` / `infeasible` / `undecidable`。**绝不允许**把
 *   `undecidable` 写成 `feasible`（本任务的硬约束）。
 */

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 造一个临时目录，跑完删掉 —— 探针不污染仓库。 */
function scratch(name) {
  const dir = mkdtempSync(join(tmpdir(), `probe-module-reload-${name}-`))
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

/** 带指纹的 import。★ 与插件宿主用的是同一个加载方式（`await import()`）。 */
function fingerprintedImport(path, fingerprint) {
  const url = pathToFileURL(path)
  url.searchParams.set('build', fingerprint)
  return import(url.href)
}

/** 内容指纹 —— 与 `git-artifact-stamp.json` 的 `output` 同一用途。 */
function fingerprintOf(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ─────────────────────────────────────────────────────────────────────────────
// 实验 1：复核 captain 的两个事实（其中第二条与实测不符）
// ─────────────────────────────────────────────────────────────────────────────

export async function experimentCacheSemantics() {
  const { dir, done } = scratch('cache')
  const mod = join(dir, 'm.mjs')
  const write = (v) => writeFileSync(mod, `export const V = ${v}\n`)
  try {
    write(1)
    const first = await import(pathToFileURL(mod).href)
    write(2)
    const sameQuery = await import(pathToFileURL(mod).href)
    const newQuery = await fingerprintedImport(mod, '2')
    return {
      /** ★ 与 captain 的实测一致：带新 query 真的重读磁盘。 */
      freshQueryReadsDisk: newQuery.V === 2,
      /** ★ 旧 query（这里是无 query 的同 specifier）复用缓存。 */
      oldQueryReusesCache: sameQuery.V === 1,
      /**
       * ★★ 与 captain 的实验 B 的【报告】不符：他说"普通 import 两次 a === b 为 false"。
       *    实测：同一 specifier 的两次 import 是**同一个模块对象** —— 那正是 ESM 的语义。
       *    ★ 这一条必须纠正，因为"每次都新建"会让"缓存复用"这个前提站不住。
       */
      plainImportTwiceIsSameInstance: first === sameQuery,
      fingerprintForked: first !== newQuery,
    }
  } finally {
    done()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 实验 2：换掉的是「模块」还是「模块图」？（★ 本任务最根本的那一问）
// ─────────────────────────────────────────────────────────────────────────────

export async function experimentModuleVersusGraph() {
  const { dir, done } = scratch('graph')
  try {
    mkdirSync(dir, { recursive: true })
    // shared 持有 state；tool 依赖它；entry 依赖 tool。
    const shared = join(dir, 'shared.mjs')
    const tool = join(dir, 'tool.mjs')
    const entry = join(dir, 'entry.mjs')
    writeFileSync(shared, 'export const state = { registry: [] }\n')
    writeFileSync(tool, "import { state } from './shared.mjs'\nexport function record(x) { state.registry.push(x) }\nexport function read() { return state.registry }\n")
    writeFileSync(entry, "export { record, read } from './tool.mjs'\nexport const version = 'v1'\n")

    const gen1 = await import(pathToFileURL(entry).href)
    gen1.record('written-under-gen1')

    // 磁盘上的 entry 变了（模拟一次 rebuild），然后用指纹重新 import。
    writeFileSync(entry, "export { record, read } from './tool.mjs'\nexport const version = 'v2'\n")
    const gen2 = await fingerprintedImport(entry, fingerprintOf(readFileSync(entry, 'utf8')))

    /**
     * ★★ 这就是答案，而且它与"状态会分裂"的直觉**相反**：
     *
     *   `entry` 被指纹化 ⇒ 只有 `entry` 自己重新求值；
     *   它 `import` 的 `./tool.mjs` 是**无 query 的 specifier** ⇒ 命中同一个缓存实例
     *   ⇒ `tool.mjs` 与 `shared.mjs` **没有被重新求值** ⇒ state 是同一份。
     *
     * ★ 所以：「换的是模块，不是模块图」——
     *   而且**正因为如此**，它的后果也不是"状态分裂"，是**更坏的一种**：
     *   新代码与旧状态**拼在一起**跑（see `experimentMixedGeneration`）。
     */
    const entryForked = gen1 !== gen2
    const stateShared = gen1.read() === gen2.read()
    const depNotReloaded = gen1.read().length === gen2.read().length && gen2.read()[0] === 'written-under-gen1'

    return {
      entryReReadFromDisk: gen2.version === 'v2',
      entryForked,
      depReusedFromCache: depNotReloaded,
      stateSharedAcrossGenerations: stateShared,
      /**
       * ★ 直接回答那一问：指纹只作用在**它被应用的那一个模块**上。
       *   ⇒ 换掉的是「模块」，**不是**「模块图」。
       */
      reloadsModuleNotGraph: entryForked && depNotReloaded,
    }
  } finally {
    done()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 实验 3：★★ 混代——新代码 + 旧状态，而它【不会当场报错】
// ─────────────────────────────────────────────────────────────────────────────

export async function experimentMixedGeneration() {
  const { dir, done } = scratch('mixed')
  try {
    const shared = join(dir, 'shared.mjs')
    const entry = join(dir, 'entry.mjs')
    /**
     * ★ 这是本队那条形态的可执行形式：
     *   第 1 代写状态时用【旧】结构；第 2 代读它时用【新】结构。
     *   ⇒ 两者都是"合法"的代码，而没有一处会抛错 —— 读出来是 undefined。
     */
    writeFileSync(shared, 'export const state = {}\n')
    writeFileSync(entry, [
      "import { state } from './shared.mjs'",
      'export function writeFirstGeneration() { state.waitRecords = { t1: { at: 1 } } }',
      'export function readLegacy() { return state.waitRecords }',
    ].join('\n') + '\n')
    const gen1 = await import(pathToFileURL(entry).href)
    gen1.writeFirstGeneration()
    const before = gen1.readLegacy()

    // 第 2 代：读的字段名变了（一次平常的重命名），而 state 还是旧的那一份。
    writeFileSync(entry, [
      "import { state } from './shared.mjs'",
      'export function writeFirstGeneration() { state.waitRecords = { t1: { at: 1 } } }',
      'export function readLegacy() { return state.waitRecords }',
      'export function readCurrent() { return state.waitWindows }',
    ].join('\n') + '\n')
    const gen2 = await fingerprintedImport(entry, 'gen2')

    return {
      legacyReadStillWorks: JSON.stringify(gen2.readLegacy()) === JSON.stringify(before),
      /** ★ 新代码读新字段 ⇒ undefined，而【没有任何一处抛错】。 */
      currentReadIsUndefined: gen2.readCurrent() === undefined,
      noThrow: true,
      /**
       * ★★ 这就是本探针最重要的读数：混代**静默**。
       *   旧 state 与旧代码一起工作时是对的；一旦代码先换而 state 不换，
       *   症状是"读不到"，而它与"本来就没有"同形。
       */
      silentMixedGeneration: gen2.readCurrent() === undefined && gen2.readLegacy() !== undefined,
    }
  } finally {
    done()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 实验 4：★ 真实插件模块上的同一条读数（不是合成的玩具模块）
// ─────────────────────────────────────────────────────────────────────────────

export async function experimentRealPlugin() {
  const entities = join(ROOT, 'lib', 'tools', 'shared', 'entities.js')
  let source
  try {
    source = readFileSync(entities, 'utf8')
  } catch {
    return { available: false, reason: `lib is not built (${entities} missing); run pnpm build` }
  }

  const plain = await import(pathToFileURL(entities).href)
  const fresh = await fingerprintedImport(entities, 'probe')

  /**
   * ★ `requestedRestart` 是一个**模块级 `let`，且没有 export**（源码实测）。
   *   ⇒ 它既不能被读，也不能被写 —— 一个指纹化的新实例看不见它。
   *   ★ 而它恰是"排队重载"这条机制的状态（本队最近两次提交的主题）。
   */
  const privateLets = [...source.matchAll(/^(?!export)let ([a-zA-Z_$][\w$]*)/gm)].map((m) => m[1])

  plain.requestRestart(['t1', 't2'], 12345)
  const oldPending = plain.pendingRestartRequest()
  const freshPending = fresh.pendingRestartRequest()

  return {
    available: true,
    /** 同一 specifier ⇒ 同一实例（ESM 语义，本队依赖它）。 */
    sameSpecifierSharesState: (await import(pathToFileURL(entities).href)) === plain,
    /** ★ 指纹化 ⇒ 不同实例 ⇒ 状态为空。 */
    fingerprintedForks: plain !== fresh,
    privateModuleLets: privateLets,
    /**
     * ★★ 核心读数：**旧实例的排队重载申请，在新实例里不存在。**
     *   而它【无法迁移】—— `requestedRestart` 不可导出、不可读、不可写。
     */
    oldInstancePendingRequest: oldPending === undefined ? null : oldPending,
    freshInstanceSeesPendingRequest: freshPending === undefined ? null : freshPending,
    pendingRequestLostAcrossReload: oldPending !== undefined && freshPending === undefined,
    /** ★ 可迁移的那一类（有导出的容器）—— 与上面形成对照。 */
    exportedMutableState: Object.keys(plain).filter((key) => plain[key] instanceof Map || Array.isArray(plain[key])).slice(0, 8),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 实验 5：旧实例能否被「丢弃」—— 注册表 / 订阅
// ─────────────────────────────────────────────────────────────────────────────

export async function experimentDiscardOldInstance() {
  const { dir, done } = scratch('discard')
  try {
    const a = join(dir, 'sub.mjs')
    writeFileSync(a, [
      'export const subscribers = new Set()',
      'export function subscribe(fn) { subscribers.add(fn) }',
      'export function emit(x) { for (const fn of subscribers) fn(x) }',
    ].join('\n') + '\n')
    const gen1 = await import(pathToFileURL(a).href)
    const seen = []
    gen1.subscribe((x) => seen.push(x))
    gen1.emit('before')

    const gen2 = await fingerprintedImport(a, 'gen2')
    gen2.emit('after')

    return {
      /** ★ 订阅留在旧实例上；新实例的 Set 是空的。 */
      oldSubscriptionStillWorks: seen.length === 1,
      newInstanceHasNoSubscribers: gen2.subscribers.size === 0,
      /**
       * ★ 而"订阅者"通常是一个**闭包**（它捕获了别处的东西）
       *   ⇒ 把它从旧实例搬到新实例**可以**搬一份引用，
       *     但那个闭包仍然闭在旧模块的作用域上 ⇒ 搬过去的是"半旧"的东西。
       */
      subscriptionMigratableByReference: true,
      subscriptionMigratableByMeaning: false,
    }
  } finally {
    done()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 判定：不可行 / 可行 / 判不了
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★★ 三态判定。**输入是实测读数**，而每一条"不可行"的理由都指名一个具体读数。
 *
 * ★ 为什么是【不可行】而不是"可行但贵"：
 *   · 私有 `let`（`requestedRestart`）**根本无法迁移** —— 不是难，是没有入口；
 *   · 而它丢的正是"排队重载"这条机制的状态 ⇒ 重载会把**触发这次重载的申请**丢掉；
 *   · 而混代**静默** ⇒ 失效的样子与"本来就没有"同形。
 *   ★ 三条里任何一条单独都够判 `infeasible`；这里三条同时成立。
 */
export function verdictOf(readings) {
  const reasons = []
  if (readings.real?.pendingRequestLostAcrossReload) {
    reasons.push(`a private module-level \`let\` (${JSON.stringify(readings.real.privateModuleLets)}) holds the queued-reload state and has no export, so a fingerprinted instance cannot read it, migrate it, or be told about it`)
  }
  if (readings.mixed?.silentMixedGeneration) {
    reasons.push('a reload that swaps code while keeping state runs new code against old state, and it is SILENT (reads become undefined, nothing throws)')
  }
  if (readings.graph?.reloadsModuleNotGraph) {
    reasons.push('a fingerprint reloads only the module it is applied to, so an entry fingerprinted alone gets new code with reused dependencies — it does not swap the module graph')
  }
  if (!readings.real?.available) {
    return { verdict: 'undecidable', reasons: [readings.real?.reason ?? 'the real plugin modules are unavailable'] }
  }
  return { verdict: reasons.length === 0 ? 'feasible' : 'infeasible', reasons }
}

export async function runProbe() {
  const cache = await experimentCacheSemantics()
  const graph = await experimentModuleVersusGraph()
  const mixed = await experimentMixedGeneration()
  const real = await experimentRealPlugin()
  const discard = await experimentDiscardOldInstance()
  const readings = { cache, graph, mixed, real, discard }
  return { readings, ...verdictOf(readings) }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runProbe()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const line = (label, value) => console.log(`  ${label.padEnd(46)} ${value}`)
    console.log('探针：进程内换模块（ESM 带指纹 import）\n')
    console.log('① 缓存语义')
    line('新 query 真的重读磁盘', String(result.readings.cache.freshQueryReadsDisk))
    line('同 specifier 复用缓存', String(result.readings.cache.oldQueryReusesCache))
    line('★ 普通 import 两次是同一实例', String(result.readings.cache.plainImportTwiceIsSameInstance))
    console.log('\n② 换的是模块还是模块图？')
    line('entry 被重新求值', String(result.readings.graph.entryForked))
    line('★ 依赖复用缓存（图未换）', String(result.readings.graph.depReusedFromCache))
    console.log('\n③ 混代（新代码 + 旧状态）')
    line('★ 静默：读不到，而不抛错', String(result.readings.mixed.silentMixedGeneration))
    console.log('\n④ 真实插件模块')
    if (result.readings.real.available) {
      line('指纹化会让状态分叉', String(result.readings.real.fingerprintedForks))
      line('私有模块级 let（不可迁移）', JSON.stringify(result.readings.real.privateModuleLets))
      line('★ 排队重载申请跨重载丢失', String(result.readings.real.pendingRequestLostAcrossReload))
    } else {
      line('不可用', result.readings.real.reason)
    }
    console.log('\n⑤ 旧实例的丢弃')
    line('订阅留在旧实例（新实例为空）', String(result.readings.discard.newInstanceHasNoSubscribers))
    console.log(`\n★★ 判定：${result.verdict}`)
    for (const reason of result.reasons) console.log(`   · ${reason}`)
  }
}
