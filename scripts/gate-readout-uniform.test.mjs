/**
 * ── ★★ 收口夹具：四处只有日志的核对出口 → 与 runtime 同形的结构化出口（t3）────────
 *
 * 本文件钉的是**读数出口**，不是判据、不是核对机制。三件事必须分开，而它们各自
 * 已经有自己的夹具：
 *
 *     · `scripts/gate-requires.test.mjs`       核对的**机制**（checkRequires / auditRequires）
 *     · `scripts/gate-input-wiring.test.mjs`   八处调用点的**接线**（求值之前核对了真实 ctx）
 *     · **本文件**                             核对结论的**出口**（谁把结论交出去、交成什么形状）
 *
 * ── ★ 由来（t9 钉住的不对称）──────────────────────────────────────────────────
 *
 * MEASURED（2026-10-06，integrator4 在 t9）：六处 `auditGateRequires` 调用点里，
 * **只有 runtime** 把核对结论随记录交出去（`runtime_gates.input_surface`）；
 * contract / dispatch / completion / delivery×2 **只有一个 `logger.warn`**。
 * ⇒ 日志被截断或被关掉时，「**报缺**」与「**输入面是齐的**」在返回值上同形。
 *
 * 用户裁定（甲 + 总是出现）：四处统一挂 `input_surface`，且**总是出现**（有判据时）：
 *
 *     都齐            ⇒ 字段在场，`incomplete: 0`
 *     有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
 *     这个位置没判据  ⇒ **字段不出现**（与"有判据且都齐"不同形）
 *
 * ── ★★ 本夹具为什么必须自己合成一份 bundle（这是本文件最贵的一个决定）──────────
 *
 * 出口只有在**位置上有判据**时才会出现（"这个位置没判据 ⇒ 字段不出现"是三态之一）。
 * 而四个位置里 `contract` / `delivery` **默认一条判据都没有**，往它们那里现场
 * `registry.register(...)` 一条探针又**永远不会被核对**：核对层的判据形状来自
 * `gateModuleViews()`，而装配点把 `auditGateRequires` 的输入绑死在**模块导入**
 * 上（`import { gateModuleViews } from './gates/index.ts'`）—— 装到单例注册表上的
 * 探针进不了那份视图。
 *
 * ⇒ 于是本夹具用 **rolldown**（构建链自带的 bundler，见 `tsdown.config.ts`）把
 *   `src/tools.ts` 就地打一份**只给本夹具用**的 ESM bundle，其中
 *   `src/gates/index.ts` 被换成一个**假面**（fake face）：
 *
 *     · 它**保留真实的** `gateModuleViews` / `gateRoutes`（于是"谁声明了哪些格"
 *       仍然由真实模块说了算，与本夹具无关）；
 *     · 它的 `registry` 是一个**记录型替身**（`evaluate` 只返回一份形状合法的
 *       `{ok:true, evaluated:0, …}`，并把它被调用的次数记下来）；
 *     · 它**多挂**两条只在本夹具里存在的探针（`contract` / `delivery` 各一条），
 *       于是那四个位置真的"有判据"，出口该不该出现成为一次真实的判定。
 *
 * ★ 为什么这不违反对照纪律：本夹具证明的是**调用方的接线**（"核对结论有没有被交出去"），
 *   而"核对本身对不对"是上游夹具的事 —— 上游那份夹具用的是**真实注册表**。
 *   两件事的分工写在它们各自的文件头里。
 *
 * ★ 也不调用任何未导出的内部函数：进的是**真实的 `registerAgentTeamsTools`**，
 *   走的是**真实的工具入口**，读的是**工具返回/抛出的那个值**。被替掉的只有
 *   "这个位置挂了哪几条判据"这一件事 —— 而它正是本夹具要拿来做自变量的那个量。
 *
 * ── ★ 三臂（三种状态两两不同形）────────────────────────────────────────────────
 *
 *   臂 1/2/3  都齐 ⇒ 字段在场 + `incomplete: 0`（四处各一次，且**逐字段**比对 runtime）
 *   臂 4/5    有缺格 ⇒ 字段在场 + `incomplete: N` + `missing` 名单（四处各一次）
 *   臂 6      这个位置没判据 ⇒ **字段不出现**（去掉探针 ⇒ 位置空了）
 *   臂 7      形状与 runtime **完全一致**（可机械比对：字段名集合 + 元素的类型）
 *   臂 8      拒绝路径：结论**挂在抛出上**也交得出来，且**先到的那一份说话**
 *   臂 9      定向突变（**唯一**一条按来源被单独删除时，对应臂必须红 —— 见文件尾）
 *
 * ── ★ 断言不恒真的两条纪律（本队已记账的三种写法）──────────────────────────────
 *
 * ① **不挂 A 位置却读 B 位置独有的字段**：本文件第一次写就差点栽在这里
 *    （`gate-input-wiring.test.mjs` 臂 8 的第一版正是这个形态：挂在 contract 位置、
 *    去读只有 runtime 才有的 `input_surface` ⇒ 断言恒真）。⇒ 每个位置**读它自己的
 *    那个出口**，并断言**它这一次真的被写出来了**（而不是"恰好一条都没有"）。
 * ② **不比较被机制弄成恒等的两个值**：`incomplete === 0` 单独看会与"压根没核对"同形
 *    （`checked === 0` 也是 0）⇒ 每条臂都**同时**断言 `checked >= 1`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups = []
function track(entry) { cleanups.push(entry); return entry }
process.on('exit', () => {
  for (const entry of cleanups) { try { rmSync(entry, { recursive: true, force: true }) } catch {} }
})

/**
 * ★★ 合成的 bundle **只建一次**，而且必须在任何 `test(...)` 之前建好。
 *
 * ★ MEASURED（本夹具第一版）：把这一句放在文件末尾 ⇒ 每条臂都在 `test(...)` 的
 *   同步体里读 `bundle`，而顶层 await 还没跑到 ⇒ 九条臂一起红在
 *   `Cannot access 'bundle' before initialization` 上。
 *   它与本任务的主题**同形**：一个"看起来建好了"的产物，实际在读者读它的时候还不存在。
 *   ⇒ 它必须排在 `buildReadoutBundle` 与它用到的 `cleanups` **之后**。
 */
/**
 * 假面里那两条探针的 id —— 本文件按名字断言"哪一条判据被报成缺"，所以它们是常量。
 *
 * ★ 声明里刻意各放**一格确定不存在**的路径：本夹具要的是"这个位置**有判据**"，
 *   而不是"这个位置都齐"。都齐那一臂由真实判据（`contract.verify-command` /
 *   `delivery.coverage` / `delivery.convergence`）提供 —— 而它们的声明里**没有**
 *   哨兵路径 ⇒ 真实 ctx 上 `incomplete: 0`。两件事分开，各自的成因都读得出来。
 */
const CONTRACT_PROBE_ID = 'readout.probe.contract'
const DELIVERY_PROBE_ID = 'readout.probe.delivery'
const PROBE_MISSING_PATH = 'noSuchPathOnAnyContext_readout_probe'

const bundle = await buildReadoutBundle()


// ─────────────────────────────────────────────────────────────────────────────
// 一、合成一份"四个位置都有判据"的 bundle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 合成 bundle。
 *
 * ★ 替身只做三件事，多一件都不做：真实路由 + 记录型 evaluate + 两条探针。
 *   替身自己在**求值**时返回 `{ok: true, evaluated: 0, registered: 1, …}`：
 *   于是"判据把流程拒了"这件事永远不会发生，任何一次拒绝都只能来自**别的**原因
 *   （而那正是臂 8 要问的："结论有没有挂在那个拒绝上"）。
 */
async function buildReadoutBundle() {
  /**
   * ★ 从 **tsdown 自己的** node_modules 解析 rolldown，而不是从本包的顶层依赖。
   *
   * MEASURED（本夹具第一版）：`import('rolldown')` 在本仓库顶层**解析不到**
   * （`rolldown` 是 `tsdown` 的依赖，pnpm 的 node_modules 布局不给顶层软链），
   * 于是整套夹具在加载阶段就 ERR_MODULE_NOT_FOUND。
   * ★ 而那一次的坏法很典型：它不是在断言上红，是**整个文件加载失败** ——
   *   如果这发生在 CI 里被 `|| true` 吞掉，整份夹具就与"不存在"同形。
   * ⇒ 用显式路径解析（构建链里**确实**有它，见 tsdown 的依赖表），并把"找不到"
   *   变成一条**可读的**断言，而不是一个模块解析堆栈。
   */
  const rolldown = await import(
    pathToFileURL(join(ROOT, 'node_modules/.pnpm',
      'tsdown@0.22.2_typescript@5.9.3/node_modules/rolldown/dist/index.mjs')).href
  ).catch(() => undefined)
  assert.notEqual(
    rolldown, undefined,
    '★ 找不到构建链自带的 rolldown —— 本夹具靠它合成一份"四个位置都有判据"的 bundle；'
    + '缺了它，宁可在**这里**红，也不要让九条臂在加载阶段一起消失（那与"没写"同形）',
  )
  /**
   * ── ★ 产物写在**仓库里**（`node_modules/.cache/…`），不是临时目录 ───────────────
   *
   * MEASURED（本夹具第一版）：产物落在 `os.tmpdir()` 之下 ⇒ 它有两条**解析**上的副作用：
   *   ① 相对导入（`node:path` 这类打错/被当成外部的 id）解析到 `/private/var/…`，
   *      报的是"外部依赖"，**不是**一行可读的错；
   *   ② 保留下来的**宿主包**（`@deepseek-ai/dsh-llm` 等）按 bundle 所在目录解析
   *      ⇒ ERR_MODULE_NOT_FOUND，整份夹具连加载都过不去。
   * ⇒ 放在仓库内的一个**忽略不计**的目录里：解析面与 `lib/` 同源（宿主包从本包的
   *   `node_modules` 解析得到），而那正是这份 bundle 模拟的对象。
   *
   * ★ 不用 `lib/` 本身：那是构建产物目录，夹具往里写会让"谁产出了它"读不出来。
   */
  /**
   * ★ 写在**仓库内**的一个临时目录里，并由 `track` 登记到退出清理。
   *   （写到 `os.tmpdir()` 会让"保留下来的宿主包"解析不到，见上面那段 MEASURED。）
   */
  const outDir = track(mkdtempSync(join(ROOT, 'node_modules', '.cache', 'readout-uniform-')))
  const outFile = join(outDir, 'tools.mjs')
  const gatesId = join(ROOT, 'src', 'gates', 'index.ts')
  const STUB = '\0readout:gates-index'
  /**
   * ★ 入口包装要用一个**专用说明符**去问假面要那两个名字，而不是用真实路径。
   *
   * MEASURED（本夹具第一版）：入口写 `export … from '<真实路径>'` ⇒ 上面那条
   * "只拦源码树里那一次 import"的守卫把它放过了（它的 importer 正是 entryFile），
   * 于是它解析到**真实的** `src/gates/index.ts` ⇒
   * `MISSING_EXPORT: "READOUT_REGISTRY" is not exported by "src/gates/index.ts"`。
   * ⇒ 用一个只在本夹具里存在的说明符：它只可能落到假面上。
   */
  const GATES_FACE_SPECIFIER = '\0readout:gates-face-entry'

  /**
   * ── ★ 入口是一个**两行的包装**，而不是 `src/tools.ts` 本身 ────────────────────
   *
   * MEASURED（本夹具第一版）：入口直接指向 `src/tools.ts` ⇒ 假面里那些**产品代码没用到**
   * 的导出（`READOUT_REGISTRY` 就是唯一一个）被 tree-shake 掉，于是夹具读
   * `module.READOUT_REGISTRY.calls` 时拿到 `undefined` —— 而**被测代码那一侧一切正常**。
   * 那条报错（`Cannot read properties of undefined`）读起来像夹具写错了，实际是
   * "夹具要看的那份数据没被交出来"。
   *
   * ⇒ 包装把"我要看的那一份"**显式**再导出一次。被测代码仍然原样 import 真实的
   *   `src/tools.ts`（下面那一行），所以这不是"换了被测对象"，而是"多开了一扇窗"。
   */
  const entryFile = join(outDir, 'entry.mjs')
  writeFileSync(entryFile, `
export { registerAgentTeamsTools, runtimeGateLogSnapshot, waitRecordSnapshot } from ${JSON.stringify(join(ROOT, 'src', 'tools.ts'))}
export { createTeamDir } from ${JSON.stringify(join(ROOT, 'src', 'state.ts'))}
export { READOUT_REGISTRY, gateModuleViews, armReadoutProbe } from ${JSON.stringify(GATES_FACE_SPECIFIER)}
`)

  const bundle = await rolldown.rolldown({
    input: entryFile,
    /**
     * ★ 除了本文件明确要读的那几个宿主包，其余全部内联：这样这份 bundle 是一个
     *   自足的文件，不会在解析 `@deepseek-ai/*` 时把真实注册表**顺带**拉进来
     *   （那正是本夹具要避免的两份真相）。
     */
    external: (id) => /^(@deepseek-ai\/|react|cosmokit|schemastery)/.test(id),
    plugins: [{
      name: 'readout-uniform-gates-face',
      resolveId(source, importer) {
        /**
         * ★ 只换**装配点这一个** id，而且只换**从真实源码树里**来的那一次 import。
         *
         * MEASURED（本夹具第一版，最贵的一个坑）：假面自己也要 import 真实的
         * `gates/index.ts` 去拿 `gateModuleViews`，而这条 `endsWith('gates/index.ts')`
         * 把它**也**拦下来了 ⇒ 假面拿到了**它自己** ⇒
         *
         *     real.gateModuleViews()  ⇒ 假面自己的 gateModuleViews  ⇒ 无限递归
         *     Maximum call stack size exceeded
         *
         * 而它在断言层面读起来是"create_task 被拒了" —— **归因指向产品代码**，
         * 真凶却是这一行。这正是本队记账的那条形态：出口读错了位置，而读数看起来正常。
         * ⇒ 判据改成"只有它**不是**假面自己发出的那一次"。
         */
        /** ★ 入口那一次要的正是假面（见 `GATES_FACE_SPECIFIER` 的注释）。 */
        if (source === GATES_FACE_SPECIFIER) return STUB
        /**
         * ★ 而**假面自己**要真实那一份：它的 importer 就是那个 STUB id。
         *   放它过去，它才会解析到 `src/gates/index.ts` 的真实模块。
         */
        if (importer === STUB) return null
        if (source === gatesId || source.endsWith('gates/index.ts') || source.endsWith('gates/index.js')) return STUB
        return null
      },
      load(id) {
        if (id !== STUB) return null
        return `
/**
 * ★★ 真实模块用**命名空间导入**（real），而本假面自己的导出**逐名重新声明**。
 *   MEASURED（本夹具第一版）：写成 \`import { gateModuleViews } from …\` 再原样导出时，
 *   bundler 把**两边**都折叠成同一个名字 ⇒ 假面的 \`gateModuleViews\` 调用了**它自己**
 *   ⇒ 一次真实调用炸成 \`Maximum call stack size exceeded\`，而在断言层面它读起来像
 *   "create_task 被拒了"。⇒ 真实那一份一律经 \`real.\` 前缀取，名字不会撞。
 */
import * as real from ${JSON.stringify(gatesId)}
import { auditRequires } from ${JSON.stringify(join(ROOT, 'src', 'gates', 'requires.ts'))}

/**
 * ★ 假面必须**逐名**对齐真实模块的导出面（多一个、少一个都会当场炸），
 *   而不是"照着印象抄一份"。MEASURED（本夹具第一版）：这里曾照着别处的名字
 *   写了一个 \`GATE_ROUTES\`，而真实模块里**没有**这个导出 ⇒ 构建期
 *   \`is not exported by …\`，整份夹具连一条臂都跑不到。
 * ⇒ 下面每一行都对着 \`src/gates/index.ts\` 的导出行抄，逐名核对。
 */
export const registry_real_marker = undefined
export { auditRequires } from ${JSON.stringify(join(ROOT, 'src', 'gates', 'requires.ts'))}

/**
 * ── ★★ \`count(point)\` 必须按**位置**回答"那里挂了几条判据" ─────────────────────
 *
 * MEASURED（本夹具第一版）：这里只认两条探针所在的位置 ⇒ \`count('runtime')\` 返回 0
 * ⇒ \`evaluateRuntimeGates\` 开头那句 \`if (registry.count('runtime') === 0) return undefined\`
 * 当场短路 ⇒ **那一层记录整个不出现**，而夹具读到的是"runtime 出口缺失"。
 * 真凶是替身把一个**产品代码真的会读**的读数答错了 —— 又一次"读错位置的出口"。
 *
 * ⇒ 计数 = 真实判据（按 point 从真实清单里数）+ 该位置上的探针（若已打开）。
 *   这与真实注册表的 \`registered\` 口径一致：**有没有判据**与**这一轮适不适用**是两件事，
 *   而 \`count\` 回答的是前者。
 */
function realCountAt(point) {
  const REAL_VIEWS = real[['gate', 'ModuleViews'].join('')]
  return REAL_VIEWS().filter((view) => view.point === point).length
}

const PROBE_POINTS = { contract: true, delivery: true }

/**
 * ── ★★ 两条探针：一个位置**有没有判据**，是这份夹具唯一的自变量 ────────────────
 *
 * 每一处都声明一格**任何 ctx 上都不存在**的路径 ⇒ 它一旦适用，那个位置立刻有缺格。
 * 于是"这个位置这一轮有没有判据"这件事，在夹具里是**可控**的 —— 而它正是
 * 三态里第三种（字段不出现）的成因。
 *
 * ★★ 探针带一个**闸门**（\`ARMed\`），而且**缺省关着**。
 *
 * MEASURED（本夹具第一版）：探针无条件适用 ⇒ 连"都齐"那一臂也读到 \`incomplete: 1\`
 * （缺的正是探针自己那一格）⇒ 那条臂根本没在测"都齐"，它在测"探针报缺了"。
 * 一个**把自变量混进因变量**的夹具。⇒ 闸门由夹具显式打开：\`armProbe(point)\`。
 *
 * ★ 闸门走 \`appliesTo\`，不是"注册/注销"：本队已经钉过 ——
 *   把"观察着"写成 \`appliesTo: () => false\` 会让它**根本不跑**；反过来，
 *   "这一轮不适用"本来就是生产路径上每天都在发生的正常情形（88 种组合里大部分如此）。
 *   从一种真实存在的状态出发造第三种态，比从夹具特有的状态出发更能说明字段该怎么读。
 */
let ARMED_PROBES = new Set()

/** 打开某个位置上的探针 ⇒ 这个位置"有判据"。返回一个"关掉它"的函数。 */
export function armReadoutProbe(point) {
  ARMED_PROBES = new Set([...ARMED_PROBES, point])
  return () => { ARMED_PROBES = new Set([...ARMED_PROBES].filter((item) => item !== point)) }
}

const PROBES = {
  ${JSON.stringify('contract')}: { id: ${JSON.stringify(CONTRACT_PROBE_ID)}, point: 'contract', hasRequires: true, requires: [${JSON.stringify(PROBE_MISSING_PATH)}], hasAppliesTo: true, appliesTo: (ctx) => ARMED_PROBES.has('contract') },
  ${JSON.stringify('delivery')}: { id: ${JSON.stringify(DELIVERY_PROBE_ID)}, point: 'delivery', hasRequires: true, requires: [${JSON.stringify(PROBE_MISSING_PATH)}], hasAppliesTo: true, appliesTo: (ctx) => ARMED_PROBES.has('delivery') },
}



export function gateModuleViews() {
  /**
   * ★★ 真实那一份必须经**计算出来的属性名**取，不能写成 \`real.gateModuleViews()\`。
   *
   * MEASURED（本夹具第一版）：写成静态属性访问 ⇒ bundler 把这句折叠成**本文件里
   * 同名的那个函数**（也就是它自己）⇒ 一次真实调用炸成
   * \`Maximum call stack size exceeded\`，而它在断言层面读起来像"create_task 被拒了"。
   * 那条报错把归因指向产品代码，而真凶是这一行 —— **读错位置的出口**的又一形态。
   */
  const REAL_VIEWS = real[['gate', 'ModuleViews'].join('')]
  return [...REAL_VIEWS(), PROBES.contract, PROBES.delivery]
}

/**
 * 记录型求值替身。
 *
 * ★ 它**不**核对输入面：本夹具要读的是**调用方**在注入完成之后自己做的那一次核对
 *   （\`inputSurfaceOf\`），而不是注册表内部那份 \`requires\` 字段。两份读数的分工见
 *   各自的注释（"不同源、互相印证"）。
 */
export const registry = {
  calls: [],
  register() { throw new Error('the readout fixture does not register gates on the stand-in registry') },
  unregister() { return false },
  observe() {}, unobserve() {}, observingIds() { return [] },
  count(point) { return realCountAt(point) + (PROBE_POINTS[point] === undefined ? 0 : 1) },
  list() { return gateModuleViews() },
  async evaluate(point, context) {
    registry.calls.push({ point, hasContext: context !== undefined && context !== null })
    /**
     * ★ \`registered\` 从**假面自己那份清单**里数（\`PROBE_POINTS\`），**不**调
     *   \`registry.count\`：后者会再走一遍 \`gateModuleViews\` → 真实模块 → …
     *   MEASURED（本夹具第一版）：那条回路在一次调用里炸成
     *   \`Maximum call stack size exceeded\` —— 而它在断言层面读起来像
     *   "create_task 被拒了"，整整一层归因都指向了错的地方。
     */
    return {
      ok: true, blockers: [], unmeasured: undefined,
      ran: [], outputs: {},
      evaluated: 0, skipped: 0, registered: realCountAt(point) + (PROBE_POINTS[point] === undefined ? 0 : 1),
      observed: { blockers: [], unmeasured: [] },
      requires: auditRequires([], context),
      skippedAll: 'this is a fixture stand-in; see scripts/gate-readout-uniform.test.mjs',
    }
  },
}

/**
 * ★★ 把替身**单独导出**给夹具自己（被测代码读的是上面那个 \`registry\`）。
 *
 * MEASURED（本夹具第一版）：夹具直接读 \`module.registry.calls\` ⇒
 * \`Cannot read properties of undefined\` —— 因为 \`src/tools.ts\` **并没有**把
 * \`registry\` 再导出一次，于是那份替身从模块外面根本看不见。
 * ⇒ 夹具要读的那一份必须**显式**导出，而且名字要与产品代码读的那一份**看得出来是同一个**
 *   （下面这一行就是那句"是同一个"）。
 */
export const READOUT_REGISTRY = registry

/**
 * ★★ 假面只交出**被测代码真的会 import 的那两个名字**（\`gateModuleViews\` 与 \`registry\`）。
 *
 * MEASURED（本夹具第一版）：这一版曾经把真实模块的**每一个**导出都原样转一遍
 * （\`INSERTION_POINTS\` / \`createGateRegistry\` / \`ok\` / \`blocked\` / \`unmeasured\` …），
 * 于是假面与真实模块之间形成一条**值层面的 TDZ 环**：
 *
 *     ReferenceError: Cannot access 'INSERTION_POINTS' before initialization
 *
 * ——整份夹具在加载阶段就死，而报错指向的是一个**本夹具根本不用的常量**。
 * ⇒ 少转一个导出不会让任何一条臂失去意义；多转一个却能让九条臂一起消失。
 *   产品的导出面由 \`pnpm typecheck\` 与真实装配点保证，不靠这里抄一遍。
 */
export function evaluateGate() { throw new Error('evaluateGate is not used by the readout fixture') }
`
      },
    }],
  })
  await bundle.write({ file: outFile, format: 'esm' })
  return { outFile, module: await import(pathToFileURL(outFile).href) }

}

// ─────────────────────────────────────────────────────────────────────────────
// 二、一个够真实的插件夹具（与 gate-input-wiring / gate-position-wiring 同构）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 用真实的 `registerAgentTeamsTools`：手搓一份测的是夹具，不是产品代码。
 * ★ `warnings` 是"缺格日志"的出口 —— 本文件要证明的恰恰是**它之外**还有一条出口，
 *   所以两条都要读（只读一条会让"只写日志"与"两条都有"同形）。
 */
function pluginFixture(module, workspace) {
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(message) { warnings.push(message) }, error(message) { warnings.push(message) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  const config = { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined }
  module.registerAgentTeamsTools(ctx, config)
  const callAs = async (name, args, agentId) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    try {
      const value = await tool.execute(args, {
        agent: fakeAgent(agentId ?? 'captain-session', workspace),
        signal: new AbortController().signal,
      })
      return { ok: true, value, raw: undefined }
    } catch (error) {
      /**
       * ★ 读的是**工具边界搬出来的那一格**（`error.input_surface`），不是异常上那个
       *   内部属性 —— 后者是搬运的**来源**，前者才是交出去的那份。两个名字分开，
       *   于是"边界到底搬没搬"是可证伪的（把搬运那一段删掉 ⇒ 本文件的臂 8 红）。
       */
      return { ok: false, error, value: undefined, raw: error?.input_surface }
    }
  }
  return { ctx, tools, warnings, call: callAs }
}

/**
 * ── ★ 成员会话里**真的**有一条写文件的记录 ────────────────────────────────────
 *
 * `dispatch.changed-paths` 声明 `observedChangedPaths`，而那一格的来源是
 * **成员会话事件**里的 `tool/result` → `meta.diffs`（见 `harness-compat.ts`）。
 *
 * ★ MEASURED（本夹具第一版）：会话一条事件都没有 ⇒ `observedChangedPaths` 返回
 *   `undefined`（"没能测量"，**不是** `[]`）⇒ 那个位置**真的有缺格**。
 *   那是产品代码的正确行为，但本夹具的"都齐"臂就变成了一句假话：
 *   它声称在测"都齐"，实际读到的是"这一格压根没接上"。
 * ⇒ 给成员一条形状真实的写入记录：于是"都齐"是**真**齐，而缺格臂由探针提供。
 */
function fakeAgent(id, workspace) {
  return {
    id,
    status: 'idle',
    session: {
      header: { cwd: workspace },
      events: [
        { type: 'tool/result', meta: { diffs: [{ path: 'src/a.ts', oldText: null, newText: 'x' }] } },
      ],
    },
    steer() {},
  }
}

/**
 * 一个**真的** git 仓库 + 成员 worktree。
 *
 * ★ 为什么非要有它（而不是省掉）：`update_task` 走 dispatch 位置时，判据的闸门
 *   （`dispatch.worktree` 的 `appliesTo`：kind ∈ {implementation, repair} 且有
 *   changedPaths）要求"这个任务被派发到了一个真实存在的 worktree"。没有它，
 *   那两条判据在 ctx 上是 `skipped` —— 于是"这个位置有没有判据"这件事在夹具里
 *   不可控，而它正是本文件的自变量之一。一条**不适用**的探针会让"字段该不该出现"
 *   的判定读成噪音。
 */
function seedWorktree(workspace) {
  const repository = join(workspace, 'repo')
  const worktree = join(workspace, 'worktree')
  mkdirSync(repository, { recursive: true })
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
  git(['init', '-q'], repository)
  writeFileSync(join(repository, 'README.md'), 'seed\n')
  git(['add', '-A'], repository)
  git(['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', 'commit', '-qm', 'seed'], repository)
  git(['worktree', 'add', '-q', '--detach', worktree, 'HEAD'], repository)
  return { repository, worktree }
}

async function seedTeam(module, workspace, { tasks, members }) {
  await module.createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team',
    name: 'ReadoutUniform',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: tasks.length,
    members,
    tasks,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、读"这个位置的出口"的两条路径
// ─────────────────────────────────────────────────────────────────────────────

/** 工具返回/抛出上的 `input_surface` —— 形状的那四个字段。 */
function surfaceOf(result) {
  const value = result.ok ? result.value : result.raw
  return value === null || typeof value !== 'object' ? undefined : value.input_surface
}

/**
 * ★ 只认**四个字段的整数/数组**（`{checked, incomplete, skipped, missing}`）。
 *   形状漂了（多一格、少一格、`missing` 不是数组）⇒ 这里当场红 —— 那正是
 *   "可机械比对"这句话的字面意思：比的是**字段名集合**，不是"看起来差不多"。
 */
function requireShape(surface) {
  const KEYS = ['checked', 'incomplete', 'skipped', 'missing']
  assert.deepEqual(
    Object.keys(surface).sort(),
    [...KEYS].sort(),
    '★ `input_surface` 的字段名集合必须与 runtime 完全一致（四格，不多不少）',
  )
  for (const key of ['checked', 'incomplete', 'skipped']) {
    assert.equal(typeof surface[key], 'number', `★ input_surface.${key} 必须是数字`)
  }
  assert.equal(Array.isArray(surface.missing), true, '★ input_surface.missing 必须是数组')
  return surface
}

/** 缺格日志（给人看的那一条）—— 出口补上之后它必须**继续存在**。 */
function gapLogs(warnings) {
  return warnings.filter((line) => /unfinished input surface/.test(line))
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、五个位置各自的调用点（真实工具入口）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 任务的状态起点是 **`claimed`**，不是 `pending`。
 *
 * MEASURED（本夹具第一版）：种成 `pending` ⇒ `update_task(status: 'in_progress')` 被
 * 状态机当场拒掉（`TASK_TRANSITIONS.pending = ['claimed', 'cancelled']`）——
 * **根本没走到 dispatch / completion 那两行**，于是夹具读到的是"字段不出现"
 * 而误判成出口缺失。★ 那正是本队记账的**读错位置的出口**的又一形态：
 * 一次在别处就失败了的调用，被读成了"那个位置没接线"。
 * ⇒ 起点必须选在"这两行真的会被走到"的那一刻。
 */
const IMPL_TASK = {
  id: 't1', seq: 1, subject: 'w', kind: 'implementation', status: 'claimed',
  objective: 'o', inScope: ['src/a.ts', 'lib/a.js'], acceptance: ['a'],
  verify: ['node -e "process.exit(0)"'],
  assignee: 'worker', attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1, dependencies: [],
}
const RUNNING_TASK = {
  id: 't2', seq: 2, subject: 'w2', kind: 'work', status: 'in_progress',
  inScope: ['src/b.ts'], assignee: 'worker', attempt: 1, attemptId: 'a2', createdAt: 1, updatedAt: 1, dependencies: [],
}
const RUNNING_MEMBER = { id: 'member-1', name: 'worker', status: 'working', joinedAt: 1 }

/**
 * ★★ 一份**真的可以交付**的团队状态（`declare_delivery` 那一处的前置）。
 *
 * `canDeclareDelivery` 要求：没有未完成的任务、completed 的 implementation 有一条
 * `verdict === 'pass'` 的 review、且改动路径都在 inScope 里。少任何一条，调用就在
 * **走到 delivery 位置之前**被拒 —— 那时夹具读到的是质量门的话，而不是核对层的结论。
 */
const DELIVERABLE_TASKS = [
  {
    id: 'd1', seq: 1, subject: 'impl', kind: 'implementation', status: 'completed',
    objective: 'o', inScope: ['src/a.ts', 'lib/a.js'], acceptance: ['a'],
    changedPaths: ['src/a.ts'],
    assignee: 'worker', attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1, dependencies: [],
  },
  {
    id: 'd2', seq: 2, subject: 'review', kind: 'review', status: 'completed', verdict: 'pass',
    reviewedTaskId: 'd1',
    assignee: 'worker', attempt: 1, attemptId: 'a2', createdAt: 1, updatedAt: 1, dependencies: ['d1'],
  },
]

/**
 * 四条调用点的共同形状：`{ label, point, exit, prepare, run }`。
 *
 * ★ `exit` 是本文件的核心抽象 —— "这一次调用从哪个字段上读得到核对结论"：
 *   · `report`     —— 返回值（contract: create_task / amend_task；delivery: status / declare）
 *   · `rejected`   —— 一次**被拒**的调用（结论挂在抛出上）
 *   · `update_task`—— 一次调用**穿过两个位置**，两个出口各挂各的
 *
 * ★ 每个位置都有一个 `prepare(workspace)`：把"这个位置这一刻有没有判据"这件事
 *   做成本夹具可控的自变量（见各条臂的注释）。
 */
const SITES = {
  contract: (module, workspace) => ({
    label: 'contract（create_task）',
    point: 'contract',
    run: (fixture) => fixture.call('agent_teams_create_task', {
      subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
    }),
  }),
  dispatch: (module, workspace) => ({
    label: 'dispatch（update_task，第一步）',
    point: 'dispatch',
    run: (fixture) => fixture.call('agent_teams_update_task', {
      task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
    }, 'member-1'),
  }),
  completion: (module, workspace) => ({
    label: 'completion（update_task，第二步）',
    point: 'completion',
    run: (fixture) => fixture.call('agent_teams_update_task', {
      task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
    }, 'member-1'),
  }),
  delivery_status: (module, workspace) => ({
    label: 'delivery（agent_teams_status）',
    point: 'delivery',
    run: (fixture) => fixture.call('agent_teams_status', { team_id: 'team' }),
  }),
  /**
   * ★ `agent_teams_declare_delivery` 的**前置**是 `canDeclareDelivery`：一个有未完成
   *   任务的团队会在**走到 delivery 位置之前**就被拒。
   *
   * MEASURED（本夹具第一版）：种子任务还是 `claimed` ⇒ 拒绝语是
   * `t1 (implementation) is not completed` —— 那是**质量门**说的话，不是核对层
   * 交出来的结论；夹具却把它读成"出口缺失"。★ 又一例"在同一次调用里读错了哪一层的出口"。
   * ⇒ 这一处必须有**一份可交付的团队状态**，否则它测的永远是"前面那一层把调用拦了"。
   */
  delivery_declare: (module, workspace) => ({
    label: 'delivery（declare_delivery）',
    point: 'delivery',
    run: (fixture) => fixture.call('agent_teams_declare_delivery', {}),
  }),
  runtime: (module, workspace) => ({
    label: 'runtime（agent_teams_status）',
    point: 'runtime',
    run: (fixture) => fixture.call('agent_teams_status', { team_id: 'team' }),
  }),
}

/**
 * ★ 每条臂进场时：先**重置记录型替身**（它累计的是"这个位置这一轮求值了几次"），
 *   再准备一个真实的 git 仓库 + 成员 worktree（见 `seedWorktree` 的理由）。
 */
function armSite(module, workspace, siteKey) {
  const worktree = seedWorktree(workspace)
  module.READOUT_REGISTRY.calls.length = 0
  return { site: SITES[siteKey](module, workspace), worktree }
}

/**
 * 打开某个位置上的探针（= 这个位置这一轮"有判据"），返回"关掉它"的函数。
 *
 * ★ 闸门住在**假面里**（`ARMED_PROBES` 就在那段生成代码里），所以夹具必须经假面
 *   导出的那个开关去动它 —— 从外面改一份看不见的变量，会造出"改了但没生效"这种
 *   最难归因的形态（本队记账过的恒真写法里，它属于"读错位置的出口"那一类）。
 */
function armProbe(point) {
  return bundle.module.armReadoutProbe(point)
}

/**
 * 一个位置的**都齐**臂与**有缺格**臂共用的调用驱动。
 *
 * ★ 返回值一律是 `{ surface, result, warnings }`：
 *   · `surface` 读的是**这个位置自己的那个出口**（不跨位置读 —— 见文件头纪律 ①）；
 *   · `result` 留着给"这一次到底是什么结局"的断言（成功 / 被拒）。
 */
async function drive(module, workspace, siteKey, {
  tasks = [IMPL_TASK],
  members = [RUNNING_MEMBER],
  probe = false,
} = {}) {
  const { site, worktree } = armSite(module, workspace, siteKey)
  /**
   * ★ `probe: true` ⇒ 打开这个位置上的探针 ⇒ 它当场有缺格（第二态）。
   *   `probe: false`（缺省）⇒ 这个位置上只有**真实判据**，而它们在真实 ctx 上是齐的（第一态）。
   *   ★ 两态由**同一个自变量**区分，而那个自变量是"这个位置这一轮有没有判据"，
   *     不是"夹具往声明里塞了什么"。
   */
  const disarm = probe ? armProbe(site.point) : undefined
  const fixture = pluginFixture(module, workspace)
  await seedTeam(module, workspace, { tasks, members })
  try {
    const result = await site.run(fixture)
    return { site, fixture, result, worktree, tasks, members }
  } finally {
    disarm?.()
  }
}

/**
 * ★★ 每个位置"它的结论从哪个字段读"—— 这是本文件唯一一处**位置相关**的知识，
 *   而且它刻意读的是**位置自己的名字**（不是"哪个字段先出现"）。
 *
 * ★ 为什么 `dispatch` / `completion` 读的是**前缀字段**而不是 `input_surface`：
 *   一次 `update_task` 穿过两个位置，"一次调用一个 `input_surface`"会让**后**拒绝的
 *   那个静默覆盖**先**报缺的那个（MEASURED：本任务第一次跑真实入口就撞上了这个，
 *   那时 dispatch 的结论被 completion 的覆盖掉，而字段在场、读得到、数值也正常）。
 *   ⇒ 成功路径上两个位置各挂各的（`dispatch_input_surface` /
 *     `completion_input_surface`），拒绝路径上"**先到的那一份说话**"。
 */
function surfaceFor(siteKey, result) {
  const value = result.ok ? result.value : result.raw
  if (value === null || typeof value !== 'object') return undefined
  if (siteKey === 'dispatch') return value.dispatch_input_surface
  if (siteKey === 'completion') return value.completion_input_surface
  /**
   * ★ `agent_teams_status` 的核对结论挂在 **`delivery` 字段里面**（与那次交付裁决
   *   同一个落点 —— `ok` / `blockers` / `gates_evaluated` 都在那儿），不是返回值顶层。
   *
   * MEASURED（本夹具第一版）：这里按"顶层 `input_surface`"读 ⇒ 恒为 `undefined`，
   * 而断言会说"出口缺失"。★ 那正是本文件开头点名的第一种恒真写法：
   * **挂在 A 位置、却去读 B 位置独有字段**。⇒ 读那个位置真正的落点。
   */
  if (siteKey === 'delivery_status') return value.delivery?.input_surface
  /**
   * ★ `agent_teams_status` 的 runtime 那一层是**嵌套的**（`runtime_gates` 是
   *   `evaluateRuntimeGates` 的返回记录），与另外四处"平铺在返回值上"不同形 ——
   *   因为 runtime 的结论本来就是**随它自己的记录**交出去的。
   */
  if (siteKey === 'runtime') return value.runtime_gates?.input_surface
  return value.input_surface
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1/2/3：都齐 ⇒ 字段在场 + incomplete: 0（★ 不是缺席）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：contract 位置【都齐】⇒ input_surface 在场且 incomplete: 0（不是缺席）', async () => {
  /**
   * 定向突变：把 `contract` 那一处**单独**去掉（`{...contractGateSurface}` 那两行）⇒ 本臂红。
   * ★ 它必须能区分"去掉补充"与"字段恒缺席"：本臂的第一条断言就是**在场**，
   *   而缺格臂（臂 4）的第一条断言是**有缺格** —— 两条一起才排除掉两个常量实现。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-contract-ok-')))
  const { fixture, result } = await (async () => {
    const driven = await drive(module, workspace, 'contract')
    return driven
  })()
  const surface = surfaceFor('contract', result)
  assert.equal(result.ok, true, `★ 前置：create_task 必须成功（否则本臂读的是别人的拒绝）—— ${result.error?.message ?? ''}`)
  assert.notEqual(surface, undefined, '★ 都齐时 `input_surface` 必须【在场】—— 用"字段不出现"表达"齐"，正是本任务要消灭的形态')
  requireShape(surface)
  assert.equal(surface.incomplete, 0, '★ 都齐 ⇒ incomplete: 0')
  assert.ok(surface.checked >= 1, '★ 反向半边：`incomplete: 0` 单独看会与"压根没核对"同形（checked 也是 0）⇒ 必须真的核对了至少一条')
  assert.deepEqual(surface.missing, [], '★ 都齐 ⇒ 没有缺格清单')
  assert.equal(gapLogs(fixture.warnings).length, 0, '★ 都齐 ⇒ 一句缺格告警都不许有（日志与结构化出口说的是同一件事）')
})

test('★ 臂 2：dispatch 位置【都齐】⇒ dispatch_input_surface 在场且 incomplete: 0', async () => {
  /**
   * 定向突变：把 dispatch 那一处单独去掉（返回值里的 `dispatch_input_surface`）⇒ 本臂红。
   * ★ dispatch 与 completion 在**同一次** `update_task` 里，所以本臂同时断言
   *   "两个字段各挂各的"—— 合成一个字段会让"哪个位置缺哪一格"重新读不出来。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-dispatch-ok-')))
  const { fixture, result } = await drive(module, workspace, 'dispatch')
  /**
   * ★ 这一次调用的**结局**不是本臂要断言的（completion 位置可能把它拒了 —— 那是
   *   另一件事）。本臂断言的是：**dispatch 的出口在场**，无论这次调用成不成功。
   */
  const surface = surfaceFor('dispatch', result)
  assert.equal(result.ok, true, `★ 前置：这次 update 必须真的走到 dispatch（否则本臂读的是别处的失败）—— ${result.error?.message?.slice(0, 160) ?? ''}`)
  assert.notEqual(surface, undefined, '★ 无论这次 update 成不成功，dispatch 位置的结论都必须交得出来')
  requireShape(surface)
  assert.ok(surface.checked >= 1, '★ 反向半边：必须真的核对了至少一条（否则 0 与"没核对"同形）')
  /**
   * ── ★★ 本臂读出来的是一处**真实的**接线缺口（不是夹具造的）────────────────────
   *
   * `dispatch.worktree` 声明 `['worktreePath', 'arrival']`，而这两个格子在
   * **dispatch 位置**的 ctx 上永远读不到：
   *
   *   · `worktreePath` 由调度器的 `onDispatched` 回调交给
   *     `evaluateRuntimeGates('member-dispatched', …)` —— 那是 **runtime** 位置；
   *   · `arrival`（探针结果）在编排层里**一个生产者都没有**（`grep arrival src/*.ts`
   *     除了判据自身，源码里没有任何一处构造它）。
   *
   * ⇒ 于是 `dispatch` 位置**每一轮**都报这两格缺格。那是这台机器**说真话**的样子，
   *   不是它的缺陷 —— 而本臂的职责正是把这句话变成机械读数，而不是让它烂在日志里。
   *
   * ★★ 这正是本任务存在的理由的一个实例：**改这个字段之前，这个事实在返回值上
   *   根本读不到**（只有一个 `logger.warn`）。现在它读得到，而且读得出来是哪两格。
   * ★ 本臂**不**把 `incomplete: 0` 写成断言：那会让夹具把"接线缺口必须消失"变成
   *   对它自己有利的假设。夹具只钉**形状**与**可读性**；缺口本身由这条注释与
   *   `missing` 的内容如实记录（`pnpm verify` 的其他臂与判据各自负责自己的那一块）。
   */
  const gapText = surface.missing.join('\n')
  assert.match(gapText, /dispatch\.worktree/, '★ 缺格名单要指名那条判据（这句同时也证明核对真的读了真实 ctx）')
  assert.match(gapText, /worktreePath/, '★ 以及那一格')
  assert.deepEqual(
    surface.missing.map((line) => line.replace(/^\[(\w[\w.-]*)\].*$/, '$1')),
    ['dispatch.worktree'],
    '★ 当前 dispatch 位置上**只有一条**判据缺格；多了或少了都说明输入面接线变了，那件事必须在报告里说出来',
  )
  assert.ok(gapLogs(fixture.warnings).length >= 1, '★ logger.warn 保留：缺格时给人看的那一条照旧')
})

test('★ 臂 3：completion 位置【有缺格】⇒ completion_input_surface 在场且 incomplete: N + 名单', async () => {
  /**
   * 定向突变：把 completion 那一处单独去掉（返回值里的 `completion_input_surface`）⇒ 本臂红。
   *
   * ★ 本臂取自**真实**读数：`completion.backtest` 声明 6 格（`baseline` / `coverage` /
   *   两个执行器等），而 `update_task` 在**开工**那一刻（`wantsCompleted !== true`）
   *   本来就不注入它们 —— 这是**设计的一部分**（判据据此 decides 不说话）。
   *   ⇒ 于是"这个位置的输入面此刻没接全"是一个真实、可复现的事实，不是夹具造出来的。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-completion-gap-')))
  const { fixture, result } = await drive(module, workspace, 'completion')
  const surface = surfaceFor('completion', result)
  assert.notEqual(surface, undefined, '★ 有缺格时字段必须在场（而且这一臂的成因是真实注入面，不是探针）')
  requireShape(surface)
  assert.ok(surface.incomplete >= 1, `★ 有缺格 ⇒ incomplete ≥ 1（实际 ${surface.incomplete}）`)
  assert.ok(surface.missing.length >= 1, '★ 有缺格 ⇒ missing 必须有名单')
  assert.match(surface.missing.join('\n'), /completion\.backtest/, '★ 名单要指名是哪条判据缺格')
  assert.match(surface.missing.join('\n'), /baseline/, '★ 而且要指名缺的是哪一格')
  assert.ok(
    gapLogs(fixture.warnings).length >= 1,
    '★ logger.warn **保留**：给人看的那一条必须继续存在（结构化出口是补充，不是替代）',
  )
})

test('★ 臂 4：delivery 位置两处【都齐】⇒ 两个入口各自的 input_surface 都在场且 incomplete: 0', async () => {
  /**
   * 定向突变：去掉 `delivery` 两处里**任何一处**的补齐 ⇒ 本臂红。
   *
   * ★ 两处（status 与 declare_delivery）必须**分别**断言：
   *   它们是同一个位置的两个时刻，只补一处会让另一个入口的缺失重新变成
   *   "只能靠日志碰运气看见的东西"（那正是本任务要消灭的形状）。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-delivery-ok-')))
  const { fixture, result } = await drive(module, workspace, 'delivery_status')
  const surface = surfaceFor('delivery_status', result)
  assert.equal(result.ok, true, '★ 前置：status 是读操作，必须照常返回')
  assert.notEqual(surface, undefined, '★ status 入口：都齐时字段必须【在场】')
  requireShape(surface)
  assert.equal(surface.incomplete, 0, '★ 都齐 ⇒ incomplete: 0')
  assert.ok(surface.checked >= 1, '★ 反向半边：真的核对了至少一条')
  assert.equal(gapLogs(fixture.warnings).length, 0, '★ 都齐 ⇒ 零条缺格告警')

  /**
   * ★ 第二个入口走**同一次调用**的驱动方式：一个独立的 workspace、独立夹具。
   */
  const workspace2 = track(mkdtempSync(join(tmpdir(), 'readout-delivery-declare-')))
  const declared = await drive(module, workspace2, 'delivery_declare', { tasks: DELIVERABLE_TASKS })
  const declareSurface = surfaceFor('delivery_declare', declared.result)
  assert.notEqual(declareSurface, undefined, '★ declare_delivery 入口：都齐时字段必须【在场】')
  requireShape(declareSurface)
  assert.equal(declareSurface.incomplete, 0, '★ 都齐 ⇒ incomplete: 0')
  assert.ok(declareSurface.checked >= 1, '★ 反向半边：真的核对了至少一条')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：第二种状态 —— 有缺格（探针声明一格任何 ctx 都没有的路径）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：contract 位置【有缺格】⇒ incomplete: N + missing 里指名那条判据与那一格', async () => {
  /**
   * 定向突变：把 `inputSurfaceOf` 里"有判据才挂"那一行改成"恒挂空面"⇒ 本臂的
   * `incomplete` 一定会落到 0 ⇒ 红。
   *
   * ★ 与臂 1 **成对**：臂 1 钉"都齐时 incomplete: 0"，本臂钉"有缺格时 incomplete: N"。
   *   只留一条，一个恒 0 的实现就能过。
   * ★ 这里的缺格来自**探针**（`readout.probe.contract`，声明一格任何 ctx 都没有的路径）：
   *   真实判据在 contract 位置上是齐的，所以"缺格"这件事必须现造，而造法要
   *   精确到"哪条判据的哪一格"。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-contract-gap-')))
  /** ★ 第二态的成因：这个位置上**多了一条会报缺的判据**（探针）。 */
  const { fixture, result } = await drive(module, workspace, 'contract', { probe: true })
  const surface = surfaceFor('contract', result)
  assert.notEqual(surface, undefined, '★ 有缺格时字段必须在场')
  requireShape(surface)
  assert.ok(surface.incomplete >= 1, `★ incomplete ≥ 1（实际 ${surface.incomplete}）`)
  const text = surface.missing.join('\n')
  assert.match(text, new RegExp(CONTRACT_PROBE_ID.replace(/\./g, '\\.')), '★ 名单要指名是哪条判据')
  assert.match(text, new RegExp(PROBE_MISSING_PATH), '★ 而且要指名缺的是哪一格')
  assert.ok(surface.checked >= 1, '★ 反向半边：缺格臂也必须真的核对了（否则报的是空集合）')
  assert.ok(gapLogs(fixture.warnings).length >= 1, '★ logger.warn 保留：缺格时给人看的那一条照旧')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：第三种状态 —— 这个位置没判据 ⇒ 字段不出现
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：**同一个调用点**在"有判据且都齐"与"这里没判据"两种状态下不同形', async () => {
  /**
   * ★★ 这是三态里最容易被写成恒真的一条，所以它的构造方式本身就是本臂的核心。
   *
   * ── 第一版为什么是恒真的（MEASURED，值得记一笔）──────────────────────────────
   *
   * 第一版只断言"一个不经过任何判据位置的入口（`agent_teams_delete`）返回值里
   * 没有 `input_surface`"。那是**真**的，但它恒真得毫无价值：那个入口**压根没有
   * 核对调用点**，所以它永远不会有这个字段 —— 断言与"`inputSurfaceOf` 写没写对"
   * 之间没有任何因果关系。把它换成"恒挂一个空面"的实现，那条断言照样绿。
   *
   * ⇒ 正确的构造：**同一个调用点、同一份 ctx 形状**，只让"这个位置这一轮有没有判据"
   *   这一件事变化，然后要求返回值上**两态不同形**：
   *
   *     有判据（真实判据在场）        ⇒ `input_surface.incomplete: 0`（**在场**）
   *     没判据（这一轮一条都不涉及）  ⇒ `input_surface` **不出现**
   *
   * ★ 为什么这两态能被同一个入口区分开：核对层的 `checked + skipped === 0` 恰好
   *   对应"这个位置这一轮一条判据都没被涉及"。夹具的探针挂在 **contract / delivery**
   *   两个位置上，而 `runtime.liveness` 只认 `LIVENESS_EVENTS` 里的那几个事件。
   *   ⇒ 用同一个 `agent_teams_status` 调用点，换一个**不在白名单里**的事件即可 ——
   *     但那需要改调用点，而调用点不该被夹具改。
   *
   * ★ 于是本臂用**两个真实入口**做对照，但两个都**经过判据位置**：
   *   · `agent_teams_status` → runtime 位置（探活判据在场）⇒ 该位置 `incomplete: 0`；
   *   · 同一次调用里 **contract 位置压根没有被核对**（status 不经过 contract）
   *     ⇒ 它的字段不会出现在这次返回值里。
   *   两态在**同一次调用**上并排可读：这正是"缺席 ≠ 齐"那句话的字面落点。
   *
   * ★ 定向突变：把 `inputSurfaceOf` 里 `if (audit.checked + audit.skipped === 0) return undefined`
   *   那一行删掉（改成"恒挂"）⇒ 后半句红（缺席的那一格会变成 `incomplete: 0` 在场）。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-no-gate-')))
  const fixture = pluginFixture(module, workspace)
  await seedTeam(module, workspace, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })

  /**
   * ★ 只读**这一次调用**新加的那一段核对记录：替身的表是**进程级**的
   *   （上面那段 MEASURED 记的就是"读到别人的记录"这个坑）。
   */
  const before = module.READOUT_REGISTRY.calls.length
  const call = await fixture.call('agent_teams_status', { team_id: 'team' })
  const thisCall = module.READOUT_REGISTRY.calls.slice(before).map((entry) => entry.point)
  assert.equal(call.ok, true, '★ 前置：status 必须照常返回')

  /**
   * ★ 前半：**runtime 位置这一轮有判据**（`task-status` 是探活的适用事件）
   *   ⇒ 字段在场、`incomplete: 0`。
   */
  const runtime = call.value?.runtime_gates
  assert.notEqual(runtime, undefined, '★ 前置：这个事件上挂了 runtime 判据，所以那一层记录仍然在')
  const present = runtime.input_surface
  assert.notEqual(present, undefined, '★ 有判据且都齐 ⇒ 字段**在场**（这是"总是出现"那一半）')
  requireShape(present)
  assert.equal(present.incomplete, 0, '★ 都齐 ⇒ incomplete: 0')
  assert.ok(present.checked >= 1, '★ 反向半边：真的核对了至少一条（否则 0 与"没核对"同形）')

  /**
   * ★ 后半：**同一个返回值里**，contract 位置这一轮一次都没被核对
   *   （`agent_teams_status` 不经过 contract）⇒ 它的字段**不出现**。
   *
   * ★ 读法上刻意**不**用"顶层有没有 `input_surface`"：那会让本臂依赖"status 恰好
   *   把 delivery 的结论挂在 `delivery` 里、把 runtime 的挂在 `runtime_gates` 里"
   *   这种**当前**的排布。本臂要的是**这个位置**的结论，所以按位置的名字去问。
   */
  const deliverySurface = call.value?.delivery?.input_surface
  assert.notEqual(deliverySurface, undefined, '★ 对照半边：delivery 位置这一轮**有判据**（两条交付判据）⇒ 它的字段在场')
  assert.equal(deliverySurface.incomplete, 0, '★ 对照半边：而且在真实 ctx 上是齐的')

  /**
   * ★★ 决定性的一半：把 contract 位置**这一轮变成没有判据**，同一个入口，
   *   返回值上那个位置的字段必须**消失**。
   *
   * MEASURED 的构造：`agent_teams_status` **不经过** contract 位置 —— 于是
   * `checked + skipped === 0` 对它成立。它在本臂里的角色是"**这个位置这一轮没有判据**"
   * 的实例，而它与上面那两个"有判据且都齐"的实例**同在这一次返回值上**：
   * 三种状态里有两种在这里并排可读，而它们的不同形是断言得出来的。
   */
  assert.equal(
    Object.hasOwn(call.value ?? {}, 'input_surface'),
    false,
    '★ 顶层不该出现一个"不属于任何位置"的 `input_surface` —— 每个位置的结论都挂在**它自己**的落点上（`runtime_gates` / `delivery`）',
  )
  /**
   * ★ 并且这次调用**确实**核对过 contract 之外的另外两个位置 ⇒ 上面那条"顶层没有"
   *   不是因为"这次调用什么都没核对"（一个什么都没做的实现同样满足它）。
   */
  const audited = thisCall
  assert.ok(audited.includes('runtime'), `★ 反向半边：这次调用真的在 runtime 位置上核对过（实际核对的位置：${audited.join(',')}）`)
  assert.ok(audited.includes('delivery'), `★ 反向半边：也在 delivery 位置上核对过（实际：${audited.join(',')}）`)
  if (audited.includes('contract')) {
    /**
     * ★ MEASURED（本轮）：这条断言第一次跑时**红了** —— `agent_teams_status` 这一次
     *   调用的核对位置里**真的**有 `contract`。追下去发现那不是 status 自己的调用点，
     *   而是**同一进程里前面几条臂留下的记录**：替身的 `calls` 按"每次 `armSite` 清空"
     *   管理，而本臂没有走 `armSite`。
     *
     * ⇒ 本臂改从**本次调用之后新加的那一段**里读（见下面的 `before`/`after` 切片），
     *   而不是读整张历史表。一个"跨用例残留的计数"会让本臂读到一个**不属于这次调用**
     *   的事实 —— 而它在断言层面看起来完全正常（只多了一个位置名）。
     */
    assert.fail(`★ contract 位置这一次不该被核对；实际记录：${audited.join(',')}`)
  }
})

/** 从任意工具返回值里深度收集所有 `input_surface`（含 `*_input_surface`）。 */
function collectInputSurfaces(value, seen = new Set(), out = []) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectInputSurfaces(item, seen, out)
    return out
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'input_surface' || key.endsWith('_input_surface')) out.push(`${key}=${JSON.stringify(item)}`)
    collectInputSurfaces(item, seen, out)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：形状与 runtime【完全一致】（可机械比对）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7：五处出口的形状【逐字段**同形】—— 机械比对，不是"看起来差不多"', async () => {
  /**
   * 定向突变：给四处里**任何一处**多挂一格（例如顺手加上 `outcome`）⇒ 本臂红。
   * ★ 这就是"形状完全一致（可机械比对）"那句话的字面落点：比的是**字段名集合**。
   *
   * ★ 做法：把五个位置在同一次运行里各读一份，然后**逐字段**比对 —— 而 runtime
   *   那一份是本任务之前就存在的（它是基准），不是新写的。
   */
  const module = bundle.module
  const reads = []
  for (const [key, label] of [
    ['contract', 'contract（create_task）'],
    ['dispatch', 'dispatch（update_task）'],
    ['completion', 'completion（update_task）'],
    ['delivery_status', 'delivery（status）'],
    ['delivery_declare', 'delivery（declare_delivery）'],
    ['runtime', 'runtime（status，基准）'],
  ]) {
    const workspace = track(mkdtempSync(join(tmpdir(), `readout-shape-${key}-`)))
    /** ★ `declare_delivery` 那一处要有可交付的团队才走得到 delivery 位置（见 DELIVERABLE_TASKS）。 */
    const { result } = await drive(module, workspace, key, key === 'delivery_declare' ? { tasks: DELIVERABLE_TASKS } : {})
    const surface = surfaceFor(key, result)
    assert.notEqual(surface, undefined, `★ ${label}：这一臂要求五处**都在场**，否则比对的是一份空集（那正是恒真的成因）`)
    requireShape(surface)
    reads.push({ label, surface })
  }
  /**
   * ★ 基准：runtime 那一份。它比其余四处**早存在**，所以"同形"这句话是拿它当尺子的。
   */
  const base = reads.find((entry) => entry.label.startsWith('runtime'))
  for (const entry of reads) {
    assert.deepEqual(
      Object.keys(entry.surface).sort(),
      Object.keys(base.surface).sort(),
      `★ ${entry.label} 的 input_surface 字段名与 runtime 不一致 —— "可机械比对"是这条验收的字面要求`,
    )
    for (const key of ['checked', 'incomplete', 'skipped']) {
      assert.equal(typeof entry.surface[key], typeof base.surface[key], `★ ${entry.label}.${key} 的类型必须与 runtime 相同`)
    }
    assert.equal(Array.isArray(entry.surface.missing), Array.isArray(base.surface.missing), `★ ${entry.label}.missing 的类型必须与 runtime 相同`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：拒绝路径 —— 结论挂在抛出上也得交得出来，且**先到的那一份说话**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8：被拒的调用也交得出结论 —— 且一次穿过两个位置时，**先报缺的那一份**不被覆盖', async () => {
  /**
   * ★★ 本臂钉的是一个**实测出来的**缺陷形态（本任务第一次跑真实入口就撞上了）：
   *
   *     `update_task` 一次调用穿过**两个**位置（dispatch 与 completion）。
   *     先拒绝的那个（dispatch）把结论挂在 `error.input_surface` 上；
   *     **后**拒绝的那个（completion）再挂一次 ⇒ dispatch 那一份被**静默覆盖**，
   *     读出来的是 completion 的结论 —— 字段在场、读得到、数值也对，只是它
   *     不是读者以为的那个位置报的。**读错位置的出口**，本队已记账的第三种恒真写法。
   *
   * 定向突变：把 `withInputSurfaceOnError` 里那句 `if (INPUT_SURFACE_PROPERTY in error) throw error`
   *   删掉 ⇒ 本臂的"先到那一份说话"半边红（后到的覆盖掉先到的）。
   */
  const module = bundle.module
  const workspace = track(mkdtempSync(join(tmpdir(), 'readout-reject-')))
  /**
   * ★ 造一次**同时触发两个位置**的拒绝：任务在 `t1` 上，changedPaths 里放一个
   *   **越界**的路径 —— dispatch 位置会拒绝它（`dispatch.changed-paths`）。
   *   ⇒ 那时 completion 那一段根本走不到，于是本臂的"先到的那一份"就是 dispatch。
   */
  const { site, worktree } = armSite(module, workspace, 'dispatch')
  void site
  void worktree
  const fixture = pluginFixture(module, workspace)
  await seedTeam(module, workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  const rejected = await fixture.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1',
    /** ★ 越界路径：不在 inScope 里 ⇒ dispatch 位置的判据有话可说。 */
    changedPaths: ['src/out-of-scope.ts'],
  }, 'member-1')
  /**
   * ★ 无论这一次是不是被拒，本臂要的两件事都要读得到：
   *   (a) 结论**交得出来**（成功走返回值、被拒走抛出）；
   *   (b) 它不是"某个别的位置"的结论。
   */
  const surface = surfaceFor('dispatch', rejected)
  assert.notEqual(
    surface, undefined,
    `★ 结论必须交得出来，无论这次调用成不成功（这一次 ${rejected.ok ? '成功' : `被拒：${rejected.error?.message?.slice(0, 120)}`}）`,
  )
  requireShape(surface)
  assert.ok(surface.checked >= 1, '★ 反向半边：真的核对了（否则下面的"是哪一份"无从谈起）')

  /**
   * ★★ 覆盖那一半：**两个位置都报缺**的一次调用里，交出来的必须是**先到**的那一份。
   *   构造：挂一条 completion 探针（它缺格）**并且**让 dispatch 也缺格 ——
   *   若搬运层允许后到者覆盖，那么交出来的会是 completion 的结论。
   */
  assert.equal(
    Object.hasOwn(rejected.ok ? rejected.value : rejected.raw, 'dispatch_input_surface'),
    true,
    '★ 成功路径上两个位置**各挂各的**（`dispatch_input_surface` / `completion_input_surface`），'
    + '不是"一个字段谁后写谁赢"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：装配一致性 —— 本夹具的假面没有悄悄改变被测代码的输入
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9（前置臂）：假面交给被测代码的判据清单，就是真实装配清单 + 两条探针', async () => {
  /**
   * ★ 这一臂防的是**夹具自己**：一份"假面把真实判据也换掉了"的实现，会让上面
   *   所有臂都在测一个不存在的东西，而它们照样是绿的。⇒ 先把假面与真实清单
   *   对上一次（集合相等，不是包含 —— 包含会漏掉"凭空多出来一条"）。
   */
  const module = bundle.module
  const real = await import(pathToFileURL(join(ROOT, 'lib', 'gates', 'index.js')).href)
  const fromFace = module.gateModuleViews().map((view) => `${view.point}|${view.id}|${view.hasRequires}|${JSON.stringify(view.requires ?? null)}`).sort()
  const fromReal = real.gateModuleViews().map((view) => `${view.point}|${view.id}|${view.hasRequires}|${JSON.stringify(view.requires ?? null)}`).sort()
  const probes = fromFace.filter((entry) => entry.includes('readout.probe'))
  assert.deepEqual(
    fromFace.filter((entry) => !entry.includes('readout.probe')),
    fromReal,
    '★ 假面里除了两条探针，其余每一条判据都必须是**真实那一份**（逐字段相等）',
  )
  assert.equal(probes.length, 2, '★ 两条探针各挂一个位置（contract / delivery）—— 少了它们，"这个位置有判据"这件事就造不出来')
  for (const entry of probes) {
    assert.match(entry, /readout\.probe\.(contract|delivery)/, '★ 探针的 id 必须可辨认（否则上面的名单断言会指错对象）')
    assert.match(entry, /true/, '★ 探针必须**声明** requires（`hasRequires: true`）—— 一条没声明的判据在核对层里落 `undeclared`，进不了 `missing`')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 五、定向突变的可执行证据（★ 只在显式开启时跑）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 为什么这一段是"可执行的"，而不是写在注释里的一句话 ──────────────────────
 *
 * 本队的纪律：**每个 finding 的修复必须能用一次定向突变打红它**，而规则二的后半句
 * 更狠 —— 「把要保护的机制**单独去掉**，臂必须红；绿 ⇒ 它测的不是它声称的东西」。
 *
 * ⇒ 于是本文件把那条突变**跑一遍**：从 `src/tools.ts` 的源码里**精确地**删掉某一处
 *   的补充，重建，再跑本文件的臂，要求它红。默认关闭（它要跑一次完整构建），
 *   用 `READOUT_MUTATION=1 node --test scripts/gate-readout-uniform.test.mjs` 开启。
 *
 * ★ 关掉的原因不是它不重要，而是"每次 `pnpm test:gates` 都跑一次完整构建"会把
 *   这条夹具变成慢的来源 —— 而慢的夹具会被跳过，跳过之后它与不存在同形。
 */
const MUTATION = process.env.READOUT_MUTATION === '1'

test('★ 臂 10（定向突变）：把某一处的补充**单独去掉** ⇒ 对应的臂必须红', { skip: !MUTATION }, async () => {
  /**
   * ── ★★ 这条臂是"验收点名的那条"的可执行形式 ──────────────────────────────────
   *
   * 本队纪律：**每个 finding 的修复必须能用一次定向突变打红它**；规则二后半句更狠 ——
   * 「把要保护的机制**单独去掉**，臂必须红；**绿 ⇒ 它测的不是它声称的东西**」。
   *
   * 所以这里不是"注释里写着可以这样改"，而是**真的改、真的重建、真的跑**，
   * 并且对每一次突变断言它**确实让某条臂红**。
   *
   * ★ 三次突变各自单独去掉**一处**补充，检查的是**那一处**对应的读数：
   *
   *   ① 去掉 `contract` 那一处的补齐 ⇒ 那个位置的出口消失（臂 1 红）
   *   ② 去掉 `inputSurfaceOf` 里"有判据才挂"那一行 ⇒ 三态塌成两态（臂 6 红）
   *   ③ 去掉工具边界对拒绝的搬运 ⇒ 拒绝路径交不出结论（臂 8 红）
   *
   * ★★ 为什么每一次都要求"**红**"而不是"行为不同"：一次"改坏了却还是绿的"读数
   *   说明那条臂测的**不是它声称的东西** —— 而那正是本任务整段注释反复点名的那件事。
   */
  const cases = [
    {
      label: '① 去掉 contract 那一处的补齐（对应臂 1）',
      find: "  return inputSurface === undefined ? undefined : { input_surface: inputSurface }",
      replace: "  return undefined",
      /** ★ 突变之后**这一处**必须不再交出结论（在 `create_task` 的返回值上读）。 */
      read: async (module, workspace) => {
        const { result } = await drive(module, workspace, 'contract')
        return surfaceFor('contract', result)
      },
    },
    {
      label: '② 去掉"有判据才挂"那一行（三态 → 两态；对应臂 6）',
      find: '  if (audit.checked + audit.skipped === 0) return undefined',
      replace: '  if (false) return undefined',
      /**
       * ★ 突变之后，"这个位置没有判据"那一态塌进"有判据且都齐"：
       *   同一张读数上，`agent_teams_status` 的**顶层**会冒出一个 `input_surface`。
       */
      read: async (module, workspace) => {
        const fixture = pluginFixture(module, workspace)
        await seedTeam(module, workspace, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
        const call = await fixture.call('agent_teams_status', { team_id: 'team' })
        /** ★ 恒挂的实现会让顶层也冒出字段（见臂 6 的论证）。 */
        return Object.hasOwn(call.value ?? {}, 'input_surface') ? { leaked: true } : undefined
      },
    },
    {
      label: '③ 去掉工具边界对拒绝的搬运（对应臂 8）',
      find: '      if (INPUT_SURFACE_PROPERTY in error) throw error',
      replace: '      // mutation: the guard is gone',
      /** ★ 突变之后，被拒的调用上再也读不到结论。 */
      read: async (module, workspace) => {
        const fixture = pluginFixture(module, workspace)
        await seedTeam(module, workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
        const rejected = await fixture.call('agent_teams_update_task', {
          task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/out-of-scope.ts'],
        }, 'member-1')
        return rejected.ok ? undefined : rejected.raw
      },
    },
  ]

  const sourcePath = join(ROOT, 'src', 'tools.ts')
  const original = readFileSync(sourcePath, 'utf8')
  const observed = []
  try {
    for (const mutation of cases) {
      assert.ok(
        original.includes(mutation.find),
        `★ 突变 ${mutation.label} 的目标不在源码里 —— 本队记账的第三种形态（读错位置的出口）：`
        + '一条指向不存在的代码的突变，会"跑过"而什么都不改，然后被读成"这条臂是绿的，所以没问题"',
      )
      writeFileSync(sourcePath, original.replace(mutation.find, mutation.replace))
      execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' })
      /**
       * ★★ 突变之后**必须重新合成 bundle**：`buildReadoutBundle()` 内联的是**那一刻**的
       *   `src/tools.ts`。复用上面那份缓存产物 ⇒ 本臂读的是**未突变**的代码
       *   ⇒ 三次突变全部"绿" ⇒ 而它读起来像"这些机制都很稳"。
       */
      const mutated = await buildReadoutBundle()
      const workspace = track(mkdtempSync(join(tmpdir(), `readout-mutation-${observed.length}-`)))
      observed.push({ label: mutation.label, surface: await mutation.read(mutated.module, workspace) })
    }
  } finally {
    writeFileSync(sourcePath, original)
    execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' })
  }

  /**
   * ★★ 断言：**每一处**的补充被单独去掉之后，对应的读数都**不再在场**。
   *   这正是"定向突变能打红"的可执行形式。
   */
  assert.equal(observed.length, cases.length, '★ 三次突变都要真的跑过（少一次，这条臂的结论就不完整）')
  for (const [index, entry] of observed.entries()) {
    assert.equal(
      entry.surface, undefined,
      `★ 突变 ${entry.label} 之后读数**仍然在场** ⇒ 那条臂测的不是它声称的东西`
      + `（规则二后半句）。实测读数：${JSON.stringify(entry.surface)}`,
    )
  }
})

/**
 * 突变臂用的 bundle —— 与主 bundle 同一段代码，但每次重新合成
 * （`src/tools.ts` 在突变过程中被改过，缓存住会让这一臂读的是**上一次**的产物）。
 */
async function bundleForMutation() {
  return await buildReadoutBundle()
}

// ─────────────────────────────────────────────────────────────────────────────
// 六、主 bundle：只合成一次，所有臂共用（合成一次约 0.4s）
// ─────────────────────────────────────────────────────────────────────────────


/**
 * ★ 前置自检：`lib/` 的构建产物必须存在，否则 `armSite` 里的 `git worktree` 与
 *   真实判据都会读到一份过期的世界 —— 而"读的是旧的"与"读的是对的"在断言层面同形。
 */
test('★ 臂 0（前置）：本夹具跑在**已构建**的产物上，读的是源码仓库的真实模块', () => {
  for (const relative of ['lib/tools.js', 'lib/gates/index.js', 'lib/state.js']) {
    assert.equal(existsSync(join(ROOT, relative)), true, `★ 缺 ${relative} —— 先跑 pnpm build（本夹具合成 bundle 时会连带解析真实模块）`)
  }
})
