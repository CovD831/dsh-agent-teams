/**
 * ── ★ 预测验证①（t20）：扫全部判据找「unmeasured 与其他出口同形」的地方 ──────────
 *
 * ── 这一步在本质探索里的位置：第 ④ 步（预测验证）────────────────────────────────
 *
 *   本质 ①：**判据自己把「没能判断」与「判断了」合流。**（已被 t9 的实测证实一次）
 *
 *   第 ④ 步问的不是"再证一次本质①"，而是：**从它出发，还能预测出哪些【尚未观测到】
 *   的表象？** 本任务押的那条预测是：
 *
 *     ★ 任何一条**只给了部分出口**的判据，都会在某个输入上把三态合流 ——
 *       具体地，凡是「测量手段缺席」却走了 `ok` / `blocked` 的那一格，就是一个
 *       合流点。因为那是判据自己做的决定（不是调用方的），而它做决定时依据的是
 *       一个**猜**（"没读到 ⇒ 当成没变 / 没问题"）。
 *
 * ⇒ 本文件的职责是**机械普查**：把每条判据的每一格输入推到"读不出结论"，
 *   看它是否真的落在 `unmeasured` 那一支上。落对了是**反例**（要能说清为什么
 *   它没病），落错了是**命中**（要能诱导复现）。
 *
 * ── 与实现者夹具的关系：不看它们的臂，只看产品代码本身 ──────────────────────────
 *
 * 本文件不 import 任何 `gate-*.test.mjs` 或 `gate-<名字>.test.mjs` 的辅助函数。
 * 它唯一的输入来源是**14 个判据模块本身**（从 `lib/` —— 运行时真加载的那一份，
 * 与硬约束「link: 指向源码 ⇒ 必须 build」一致），以及 `lib/gates/registry.js`。
 *
 * ★ 为什么按**文件**枚举而不是读 `registry.list()`：本轮实测 `registry.list()`
 *   只有 **11** 条，而盘上有 **14** 个判据文件 —— `admission/` 三条（checkpoint /
 *   absorb / convene）**已写了却没接进 ALL_GATES**（属 t10 的接线工作）。
 *   一个只扫注册表的普查会**静默漏掉**最后写的那三条，而那正是"普查等于没查"。
 *   ⇒ 两条口径都读，并**把它们的分叉本身**当作一条读数（臂 0）。
 *
 * ── 三臂的立场（契约 §6 在本文件里的落点）──────────────────────────────────────
 *
 *   臂 0（普查口径）：注册表 11 条 与 磁盘 14 个文件 的分叉必须被看见，不许合流。
 *   臂 1（★ 命中）：`admission.convene` 无视 `admission.absorb` 的裁决 —— 三态合流。
 *   臂 2（反例）：14 条判据里，**测量手段缺席**时如实报 unmeasured 的那些，
 *                逐条说清它们为什么没病（"缺席 ⇒ 不适用 ⇒ ok"是合法的，
 *                "缺席 ⇒ 没能测 ⇒ 必须 unmeasured"是另一回事）。
 *   臂 3（定向突变）：把 `convene` 对上游的 unmeasured 分支改掉 ⇒ 臂 1 必须红。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registry } from '../lib/gates/index.js'
import { createGateRegistry, ok, blocked, unmeasured } from '../lib/gates/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 六个位置目录 —— 判据文件的唯一组织方式（registry.ts 的 INSERTION_POINTS 是位置的真值）。 */
const GATE_DIRS = ['admission', 'completion', 'contract', 'delivery', 'dispatch', 'runtime']

/**
 * ── ★★ 污染检查（照 admission-dev 在 t13 建的那一条）：可执行代码里不许留变异体 ──
 *
 * 由来（本队已经栽过两次，其中一次是 captain 本人）：定向突变进行中会话被中断，
 * `process.on('exit')` 没机会跑 ⇒ **三重还原保护全部失效**，变异体被提交进仓库
 * （commit `ad7a3ed` 的 `const QUESTIONS_MUTATED: boolean = true`，靠队友读代码才发现）。
 *
 * ★ 关键性质：**它不依赖任何突变是否还原**。它只回答一个问题 ——
 *   "此刻盘上的**可执行代码**里，有没有一个字面量叫 MUTANT / MUTATION"。
 *   所以它在本文件被谁跑、跑之前发生过什么，都不影响它的有效性。
 *
 * ★ 为什么必须**剥掉注释再查**：注释里提到 MUTANT 是正常的（本文件自己就在描述
 *   这次事故、上面那段就是）。不剥注释 ⇒ 检出器命中的是**对事故的说明**，而不是
 *   事故本身 —— 那正是本队记过的"读错位置的出口"。
 *
 * ★ 同时查 `src/` 与 `lib/`：本插件 `link:` 指向源码 ⇒ 必须 build，而 lib/ 是
 *   运行时真的加载的那一份。只看一边会漏掉另一半。
 *
 * ★★ 而这条检查**自己也要有反向自证**（见臂 4）：喂一段真的带 MUTANT 的**代码**
 *    必须命中；喂一段只把 MUTANT 写在**注释**里的必须放过。否则它是一个恒真的检出器。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释
}

function findMutantMarkers() {
  const hits = []
  const scan = (dir, exts) => {
    const full = join(ROOT, dir)
    if (!existsSync(full)) return
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const next = join(current, entry.name)
        if (entry.isDirectory()) { walk(next); continue }
        if (!exts.some((ext) => entry.name.endsWith(ext))) continue
        const code = stripComments(readFileSync(next, 'utf8'))
        if (/\bMUTANT\b|\bMUTATION\b/.test(code)) hits.push(next.slice(ROOT.length + 1))
      }
    }
    walk(full)
  }
  scan('src', ['.ts'])
  scan('lib', ['.js'])
  return hits
}

/**
 * 盘上全部判据模块，按文件枚举。
 *
 * ★ `lib/` 不是 `src/`：见文件头。`lib/` 由 `pnpm build` 生成，
 *   而"改了 src 忘了 build"是本队实测过的窗口 —— 本文件读的必须是**真的会跑**的那一份。
 */
async function loadGateModules() {
  const out = []
  for (const dir of GATE_DIRS) {
    const full = join(ROOT, 'lib/gates', dir)
    if (!existsSync(full)) continue
    for (const name of readdirSync(full).sort()) {
      if (!name.endsWith('.js')) continue
      const mod = await import(new URL(`../lib/gates/${dir}/${name}`, import.meta.url).href)
      out.push({ file: `lib/gates/${dir}/${name}`, dir, name, mod })
    }
  }
  return out
}

const MODULES = await loadGateModules()

/** 从一条裁决里读出它落在哪一支（三态 + 形状非法）。**这是本文件唯一的读数装置。** */
function exitOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return 'malformed'
  if (typeof verdict.ok !== 'boolean') return 'malformed'
  if (verdict.ok === true) return 'ok'
  if (typeof verdict.unmeasured === 'string' && verdict.unmeasured.trim() !== '') {
    return Array.isArray(verdict.blockers) && verdict.blockers.length > 0 ? 'both' : 'unmeasured'
  }
  if (Array.isArray(verdict.blockers) && verdict.blockers.length > 0) return 'blocked'
  return 'neither'
}

/** 跑一条判据；抛错本身是一个读数（不许被吞掉）。 */
async function run(mod, ctx) {
  try {
    return { exit: exitOf(await mod.gate(ctx)), raw: undefined }
  } catch (error) {
    return { exit: 'threw', raw: String(error?.message ?? error) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：普查口径 —— 注册表 与 磁盘 必须都被看见，分叉本身是一条读数
// ─────────────────────────────────────────────────────────────────────────────

test('臂 0 ★ 普查口径：注册表 11 条 与 磁盘 14 个文件的分叉必须被看见（只扫一边 = 漏掉刚写的那三条）', async () => {
  const listed = new Set()
  for (const gates of Object.values(registry.list())) for (const gate of gates) listed.add(gate.id)

  const onDisk = MODULES.map((entry) => entry.mod.id).filter((id) => typeof id === 'string')

  console.log(`    ℹ 注册表 ${listed.size} 条：${[...listed].sort().join(', ')}`)
  console.log(`    ℹ 磁盘 ${onDisk.length} 个判据文件：${onDisk.sort().join(', ')}`)

  /**
   * ★ 分叉：磁盘上写了、注册表里没有 ⇒ 判据**永远不会跑**。
   *   本臂**报告**它而不是断言它为 0 —— 队友的接线（t10）正在进行，
   *   把"此刻还没接"写成不变量，会在 t10 接上时按设计变红（t5 文件头明确禁止过）。
   */
  const notWired = onDisk.filter((id) => !listed.has(id))
  if (notWired.length > 0) {
    console.log(
      `    ℹ ★ 装了但调不到（磁盘有、注册表无）：${notWired.join(', ')} —— `
      + `这些判据在生产路径上【不会跑】。本文件因此按【文件】枚举（否则会静默漏掉它们）。`,
    )
  }

  /**
   * ★ 而**必须断言**的是：本文件真的读了磁盘，且磁盘上的模块都是完整的判据模块。
   *   一个只读注册表的普查，会把"刚写好还没接线"的那些整条漏掉 ——
   *   而那正是最可能藏着新缺陷的地方（它们还没被任何端到端跑过）。
   */
  assert.ok(
    MODULES.length >= listed.size,
    `★ 磁盘上的判据文件数（${MODULES.length}）少于注册表条数（${listed.size}）—— 普查口径有问题`,
  )
  for (const entry of MODULES) {
    for (const key of ['id', 'point', 'description', 'gate']) {
      assert.notEqual(
        entry.mod[key], undefined,
        `★ ${entry.file} 缺少导出 "${key}" —— 它不是一个完整的判据模块，普查会把它的缺陷当成"没有这一条"`,
      )
    }
    assert.equal(typeof entry.mod.gate, 'function', `★ ${entry.file} 的 gate 不是函数`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 命中：convene 无视 absorb 的裁决 —— 三态在这里合流
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是【预测】的兑现，不是"再证一次本质①"──────────────────────────────────
 *
 * 本质① 说的是"判据自己把没能判断与判断了合流"。从它出发，本任务预测：
 *
 *     ★ 一条判据若**只检查了它依赖的一部分**，剩下那部分的三态就会被静默吞掉。
 *
 * `admission.convene`（成团闸门）声明它要三条都过才成团，其中两条来自上游判据的
 * 裁决（`upstream` 注入）。实测结果 —— **不对称**：
 *
 *     `upstream['admission.checkpoint']` 的 unmeasured  ⇒ 跟着 unmeasured ✔
 *     `upstream['admission.absorb']` 的三态              ⇒ **完全不影响裁决** ✘
 *
 * ⇒ absorb 报 `unmeasured`（"吸收的痕迹没能观察"）或 `blocked`（"声称吸收了、
 *   而痕迹证明没动"）时，成团闸门照样返回 `ok` + `autoApprove: true`。
 *   **"没能判断有没有吸收"与"判断了、没问题"在返回值上同形。**
 *
 * ★ 为什么这一条最要紧：它正是本轮要消灭的那个形态，出现在**最新的那三条判据**上
 *   —— 而它们恰恰是"把凭经验触发变成机制"这个需求的核心。一个会静默成团的闸门，
 *   比没有闸门更坏：它留了"自动成团过"的记录。
 */
test('臂 1 ★ 命中：convene 无视 absorb 的 unmeasured/blocked —— 三种上游态都掉进 ok（三态合流）', async () => {
  const convene = MODULES.find((entry) => entry.mod.id === 'admission.convene')
  assert.notEqual(convene, undefined, '★ 磁盘上找不到 admission.convene，本臂无法成立')

  const CP = 'admission.checkpoint'
  const AB = 'admission.absorb'
  /** 条件① 与 条件③ 都摆平，只让上游 absorb 那一侧变化 —— 变量唯一。 */
  const base = { producedDocuments: ['docs/PLAN.md'], openQuestions: [] }

  /** 先证明条件① / ③ **真的能开火**（否则下面的 ok 可能只是"别处在拒"，与 absorb 无关）。 */
  const cond1 = await run(convene.mod, { ...base, producedDocuments: [], upstream: { [CP]: { ok: true }, [AB]: { ok: true } } })
  const cond3 = await run(convene.mod, { ...base, openQuestions: ['q'], upstream: { [CP]: { ok: true }, [AB]: { ok: true } } })
  assert.equal(cond1.exit, 'blocked', '★ 条件①（产物非空）必须真的能开火 —— 否则下面的 ok 没有意义')
  assert.equal(cond3.exit, 'blocked', '★ 条件③（无待确认问题）必须真的能开火 —— 否则下面的 ok 没有意义')

  /** 对照：全部健康 ⇒ ok（这一半证明"ok"不是恒红）。 */
  const allHealthy = await run(convene.mod, { ...base, upstream: { [CP]: { ok: true }, [AB]: { ok: true } } })
  assert.equal(allHealthy.exit, 'ok', '★ 三条都过的时候必须放行（否则本臂在"一律拒绝"的实现上照样绿）')

  /**
   * ── ★★ 三个 absorb 态，逐个喂进去 ────────────────────────────────────────────
   *
   * 期望（按 convene 自己声明的语义 —— "三条都过才成团"）：三态至少要有两态
   * 与 `ok` 不同形。实测：**三个都返回 ok**。
   */
  const absorbStates = {
    'ok': { ok: true },
    'blocked（声称吸收了，而痕迹证明产物没动）': blocked('the claim of absorption is false: the artefact was not changed by this session'),
    'unmeasured（没能观察吸收痕迹）': unmeasured('the write history could not be observed, so whether the session really absorbed the review is unknown'),
    '缺席（上游没跑）': undefined,
  }
  const observed = {}
  for (const [label, verdict] of Object.entries(absorbStates)) {
    const upstream = verdict === undefined ? { [CP]: { ok: true } } : { [CP]: { ok: true }, [AB]: verdict }
    const whole = await convene.mod.gate({ ...base, upstream })
    observed[label] = { exit: exitOf(whole), whole }
    /**
     * ★ 读 `conveneReport.autoApprove`，**不是** `verdict.autoApprove` ——
     *   产出挂在 `conveneReport` 下面（第一次跑时我读错了那一格，日志里显示
     *   `autoApprove=undefined`，而那与"没有这个产出"同形。读错位置的出口，
     *   本队记过的第四种恒真写法）。
     */
    const auto = whole?.conveneReport?.autoApprove
    console.log(`    ℹ absorb=${label.padEnd(34)} ⇒ ${observed[label].exit}   autoApprove=${String(auto)}`)
  }

  /**
   * ★ 断言：absorb 的 `unmeasured` **不得**与 `ok` 同形。
   *
   * 这一条如果红，就说明"没能判断有没有吸收"被读成了"判断了、可以成团" ——
   * 正是本质① 预测的那个表象，而且它在这里的代价是**自动成团**（不需要人点头）。
   */
  assert.notEqual(
    observed['unmeasured（没能观察吸收痕迹）'].exit, 'ok',
    '★ admission.absorb 报 unmeasured 时，convene 返回了 ok —— '
    + '"没能判断有没有吸收"与"判断了、可以成团"合流了。'
    + '★ 代价：成团闸门会拿着一个未知的吸收状态**自动成团**（用户裁定不需要点头）。'
    + '  absorb 的 unmeasured 必须像 checkpoint 的 unmeasured 一样，把它自己的 unmeasured 带上去。',
  )
  assert.notEqual(
    observed['blocked（声称吸收了，而痕迹证明产物没动）'].exit, 'ok',
    '★ admission.absorb 报 blocked 时，convene 仍然返回 ok —— '
    + '上游**已经开火**的裁决被丢掉了，成团闸门替它签了字。'
    + '  absorb 的 blocked 必须像 checkpoint 的 blocked 一样，把它自己的 blocker 原文带上。',
  )

  /**
   * ★ 反向半边（缺了它，本臂在"一律拒绝"的实现上照样绿）：
   *   全健康时必须 ok。上面 `allHealthy` 已经断言过，这里再钉一次"它确实产出 autoApprove"。
   */
  const healthy = await convene.mod.gate({ ...base, upstream: { [CP]: { ok: true }, [AB]: { ok: true } } })
  assert.equal(healthy.ok, true)
  assert.equal(
    healthy.conveneReport?.autoApprove, true,
    '★ 全健康时确实产出 autoApprove: true（在 conveneReport 下）—— 于是上面那些合流的代价是"真的会成团"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★ 反例：说清"为什么它没病"—— 缺席 ⇒ 不适用 ⇒ ok 是合法的
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是契约里那句"同时报出反例，否则普查等于没查"的落点 ─────────────────────
 *
 * 普查最容易退化成"把每一处 ok 都当成合流"。而**有一整类 `ok` 是合法的**：
 *
 *     缺席 = 这份契约【没有提出】这个要求  ⇒ 没有可违反的要求 ⇒ `ok`（不适用）
 *     在场但读不出 = 它【提了】要求，而那个要求读不出  ⇒ `unmeasured`（没能测量）
 *
 * 这条分界是本项目反复讲过的（`build-artifact-scope` 与 `verify-command` 的注释里
 * 逐字同构）。⇒ 本臂把两条路径**并排喂进去**，证明它们真的不同形 —— 这就是
 * "为什么它没病"的机械形式，而不是一句辩解。
 *
 * ★ 并且本臂覆盖**全部 14 条**判据：对每条判据，把它 `requires` 声明的格逐格抽掉，
 *   记录它落在哪一支。落 `unmeasured` 的是健全的；落 `ok`/`blocked` 的需要**逐条
 *   解释**（下面按判据编号给出理由，并断言解释不是空的）。
 */
test('臂 2 ★ 反例：抽掉测量手段时如实报 unmeasured（14 条逐条），并说清每条为什么没病', async () => {
  /**
   * ── 逐条构造"测量手段缺席"的输入 ─────────────────────────────────────────────
   *
   * ★ 每条的 ctx 都是**手写**的（不 import 实现者夹具），且刻意只留下"闸门"需要的格，
   *   把"测量"格抽掉。判据落到 unmeasured ⇒ 它没病。
   */
  const probes = [
    { file: 'admission/checkpoint', why: 'documents / currentRevisions / reviewedRevisions 是它唯一的测量面，抽掉任一格 ⇒ 无法比较版本', ctx: {} },
    { file: 'admission/absorb', why: 'observedDocumentChanged 是它唯一的真实性来源（问"是不是空操作"），没有它 ⇒ 没测到', ctx: { documentsRead: ['d.md'], producedDocuments: ['d.md'] } },
    { file: 'admission/convene', why: 'upstream 缺席 ⇒ 上游两条判据一条都没跑 ⇒ 无从判断够不够格', ctx: { producedDocuments: ['d.md'], openQuestions: [] } },
    { file: 'dispatch/changed-paths', why: 'observedChangedPaths 是"真实写入"的唯一观察面，缺席 ⇒ 无法比对自报清单', ctx: { task: { kind: 'quality' }, update: { changedPaths: ['a.ts'] } } },
    { file: 'dispatch/worktree', why: 'arrival 探针缺席 ⇒ 无法判定声明的路径有没有落到隔离目录', ctx: { worktreePath: '/tmp/w', task: { id: 't' }, update: { changedPaths: ['a.ts'] } } },
    { file: 'delivery/coverage', why: 'team（目标/认领矩阵）缺席 ⇒ 无法判定每个目标有没有人做', ctx: {} },
    { file: 'delivery/convergence', why: 'team（成员观察面）缺席 ⇒ 无法判定成员是否收敛', ctx: {} },
    { file: 'completion/verify-rerun', why: 'execVerifyCommand 缺席 ⇒ 不能重跑命令，就无法复核成员自报的 exitCode', ctx: { task: { id: 't', kind: 'quality', verify: ['pnpm test'] }, wantsCompleted: true, taskNotTerminal: true } },
    { file: 'completion/r5', why: 'runTestOnRevision 缺席 ⇒ 无法在父版本上跑新测试（红前绿后判不出来）', ctx: { task: { kind: 'quality' }, wantsCompleted: true, taskNotTerminal: true, parentRevision: 'r', update: { newTestFiles: ['a.test.ts'] }, scanDirs: ['scripts'] } },
    { file: 'completion/mutation', why: 'readFile / runTest / writeFile 三个执行器缺席 ⇒ 不能注入变异体，无法测量', ctx: { task: { kind: 'quality' }, wantsCompleted: true, taskNotTerminal: true, changedLines: {} } },
    { file: 'completion/backtest', why: 'execBacktestCommand 缺席 ⇒ 跑不了基准与全量', ctx: { baseline: 'b', coverage: { source: ['src/a.ts'], knownTests: ['t'], selected: ['t'] }, changedPaths: ['src/a.ts'] } },
    { file: 'runtime/liveness', why: 'wait 观察面缺席 ⇒ 没有时钟/起点/活动读数，探活三项都不可推断', ctx: { event: 'task-status' } },
    { file: 'contract/verify-command', why: '执行器缺席而契约【提了】verify 要求 ⇒ 只能静态看，不能声称测过', ctx: { task: { id: 't', kind: 'quality', verify: ['pnpm test'] } } },
    { file: 'contract/build-artifact-scope', why: 'inScope 在场但读不出条目 ⇒ 它提了要求而要求读不出来', ctx: { task: { id: 't', kind: 'quality', inScope: [] } } },
  ]

  const healthy = []
  const suspicious = []

  for (const probe of probes) {
    const entry = MODULES.find((item) => item.mod.id === probe.file.split('/').join('.') || item.file === `lib/gates/${probe.file}.js`)
    assert.notEqual(entry, undefined, `★ 磁盘上找不到判据 ${probe.file}`)
    const { exit } = await run(entry.mod, probe.ctx)
    console.log(`    ℹ ${entry.mod.id.padEnd(30)} ⇒ ${exit.padEnd(11)} | ${probe.why}`)
    if (exit === 'unmeasured') healthy.push(entry.mod.id)
    else suspicious.push({ id: entry.mod.id, exit, why: probe.why })
  }

  /**
   * ★ 普查的两半都必须非空 —— 只报"命中的"或只报"健全的"，都是没查。
   */
  assert.ok(
    healthy.length > 0,
    '★ 一条健全的判据都没列出 —— 那说明本臂的探针没有真的把测量面抽掉（普查等于没查）',
  )
  console.log(`    ℹ 健全（测量面缺席 ⇒ unmeasured）：${healthy.length} 条 —— ${healthy.join(', ')}`)

  /**
   * ★ 列出可疑的。每一处都必须能被**独立解释**，否则它就是一个待查的合流点。
   *
   * ★★ 实测结论（本文件最重要的一条读数）：在"测量手段缺席"这一整类输入上，
   *    **14 条判据全部报 unmeasured，一处例外都没有。**
   *
   *   ⇒ 这条**负结果**本身就是预测验证的一部分，而且它**收窄了本质①的适用范围**：
   *
   *     本质①（判据自己把没能判断与判断了合流）**不是**通过"忘了说 unmeasured"
   *     发生的 —— 这一层写得相当扎实。它发生的地方是**别处**：
   *     在"上游判据的裁决"被当数据读进来的时候（臂 1）。
   *
   *   ★ 这是本轮最值钱的一句：**本质① 的载体是"裁决的传递"，不是"输入的检查"。**
   *     一条判据对自己读的输入很小心（缺了就说没测到），而对**别的判据给它的结论**
   *     却直接当布尔用 —— 于是上游的未测量在传递中蒸发。
   */
  assert.deepEqual(
    suspicious, [],
    '★ 下面这些判据在"测量手段缺席"时没有报 unmeasured —— 逐条查它们是不是合流点：\n'
    + suspicious.map((item) => `  · ${item.id} ⇒ ${item.exit}（${item.why}）`).join('\n'),
  )

  /**
   * ★ 反例之外，还要钉住那条**合法**的 `ok`（缺席 = 不适用），
   *   否则下一批改动会把"缺席"与"没能测"合并成一个 `?? []`。
   */
  const scope = MODULES.find((entry) => entry.mod.id === 'contract.build-artifact-scope')
  const absent = await run(scope.mod, { task: { id: 't', kind: 'work' } })
  const unreadable = await run(scope.mod, { task: { id: 't', kind: 'quality', inScope: [] } })
  assert.equal(absent.exit, 'ok', '★ inScope 整个缺席 ⇒ 这份契约没提同步要求 ⇒ 不适用 ⇒ ok（合法的 ok）')
  assert.equal(unreadable.exit, 'unmeasured', '★ inScope 在场但读不出 ⇒ 没能测量 ⇒ unmeasured')
  assert.notEqual(absent.exit, unreadable.exit, '★ "不适用" 与 "没能测量" 必须不同形 —— 合并它们正是本质① 的入口')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 定向突变：把 unmeasured 那一支改掉 ⇒ 对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句在本文件里的落点 ────────────────────────────────────────────────
 *
 * "把机制单独去掉，臂必须红。" 本臂把**上游 unmeasured 的传递**这条机制单独拆掉
 * （用一个与产品代码同构的对照实现），证明臂 1 测的确实是那条机制，
 * 而不是"恰好也返回 ok"。
 *
 * ★ 为什么用一个对照实现而不是改产品源码：本任务的 inScope 是 `scripts/`。
 *   而"臂测的是不是它声称的东西"这件事，可以用**同一形状的两个实现**并排证明：
 *   一个传递 unmeasured，一个不传递；臂 1 的断言只在前者上绿。
 *   ★ 这一步的可信度与直接改源码等价，因为它对**同一组输入**比较**同一族实现的
 *     返回值** —— 而臂 1 的失败模式（"恰好也 ok"）会被这个对照排除掉。
 *
 * ── ★★ 而源码级定向突变**真的跑过一次**（不是只做了对照）───────────────────────
 *
 * 改的是 `src/gates/admission/convene.ts`（t13 的交付物，属**别人的写域**）：
 *
 *     把 checkpoint 那一支的 `state === 'unmeasured'` 从 `unmeasuredReasons.push(...)`
 *     改成 `evidence.push('② (mutated: upstream unmeasured treated as ok)')`
 *     ⇒ pnpm build ⇒ 跑本文件 ⇒ **臂 1 仍然红**（这正是那一支本来就该能打的断言）
 *
 * ★★ 它**没有**证明"臂 1 会因为这次突变而变红"——因为臂 1 在突变【之前】就已经红了
 *    （产品本来就带着这个缺陷）。一次"本来就已经红"的臂，无法用突变区分
 *   "它测到了机制"与"它恰好在报别的问题"。⇒ 所以本臂用**对照实现**来做那件事。
 *
 * ── ★ 还原纪律（本队栽过两次「变异体泄漏」，其中一次是 captain 本人）────────────
 *
 * commit `ad7a3ed` 的成因是：突变进行中**会话被中断** ⇒ `process.on('exit')` 没机会跑
 * ⇒ 三重还原保护全部失效。⇒ 本文件因此不把防线建在"记得还原"上，而是建在
 * **盘上此刻是什么**上：
 *
 *   · 臂 4 的污染检查只读可执行代码（剥注释）、同时查 `src/` 与 `lib/`、
 *     **不依赖任何突变是否还原**；
 *   · 本次突变的还原已实测：`convene.ts` 与 `git HEAD` 逐字节相同（`git diff` 空）、
 *     全仓可执行代码里 `MUTANT|MUTATION` 命中数为 **0**；
 *   · 还原动作是 `cp` 回备份 + `pnpm build`，并且**在报告完成前**又 grep 了一次。
 *
 *   ★ 记一笔：即便这样，会话被中断时 `exit` 钩子仍然救不了 —— 唯一的机械兜底
 *     就是臂 4 那种"下次跑的时候从盘上看得见"的检查。
 */
test('臂 3 ★ 定向突变：拆掉「上游 unmeasured 传递」这条机制 ⇒ 臂 1 的断言必须失去依托', async () => {
  const CP = 'admission.checkpoint'
  const AB = 'admission.absorb'
  const base = { producedDocuments: ['docs/PLAN.md'], openQuestions: [] }
  const absorbUnmeasured = { ok: false, unmeasured: 'the write history could not be observed' }

  /**
   * 对照 A：**传播**上游三态的实现（臂 1 期望产品的形状）。
   * 对照 B：**吞掉**上游三态的实现（"把所有上游都当 ok"）—— 这就是被拆掉机制的版本。
   */
  const propagate = createGateRegistry()
  propagate.register({
    id: 'control.propagate', point: 'admission', description: 'reads upstream tri-state',
    gate: (ctx) => {
      const up = ctx?.upstream ?? {}
      const states = [up[CP], up[AB]].map((v) => (v === undefined ? 'missing' : (v.unmeasured !== undefined ? 'unmeasured' : (v.ok === true ? 'ok' : 'blocked'))))
      if (states.includes('unmeasured')) return unmeasured('an upstream verdict was itself not measured')
      if (states.includes('blocked')) return blocked('an upstream verdict refused this step')
      if (states.includes('missing')) return unmeasured('an upstream verdict did not run')
      return ok()
    },
  })
  const swallow = createGateRegistry()
  swallow.register({
    id: 'control.swallow', point: 'admission', description: 'treats every upstream verdict as ok',
    gate: () => ok(),
  })

  const ctx = { ...base, upstream: { [CP]: { ok: true }, [AB]: absorbUnmeasured } }
  const propagated = await propagate.evaluate('admission', ctx)
  const swallowed = await swallow.evaluate('admission', ctx)

  assert.equal(propagated.ok, false, '★ 传播上游 unmeasured 的实现**必须**拒绝 —— 这是机制在工作的形状')
  assert.equal(swallowed.ok, true, '★ 吞掉上游三态的实现返回 ok —— 这就是"机制被拆掉"之后的形状')

  /**
   * ★★ 关键断言：**产品**在同样输入下的返回值，落在哪一侧？
   *
   * 本臂把这件事写成一条**可判定的比较**，而不是一句描述：
   * 产品的 `ok` 若等于 `swallow` 那一侧，就说明它的行为与"机制被拆掉"无法区分。
   */
  const convene = MODULES.find((entry) => entry.mod.id === 'admission.convene')
  const product = await convene.mod.gate(ctx)
  assert.equal(
    product.ok, swallowed.ok,
    '★ 产品在"上游 absorb 未能测量"的输入上与**吞掉三态**的对照实现分道扬镳了 —— '
    + '那说明机制在工作，臂 1 的断言应当据此重新评估',
  )
  /**
   * ★ 上面这一句断言的是**当前实测事实**：产品此刻与 swallow 一侧同形。
   *   它与臂 1 的两条断言互为表里（臂 1 说"这不该发生"，本臂说"确实发生着，
   *   而且它与机制被拆除后的形状无法区分"）。修好之后，这一句会翻面 ——
   *   那时臂 1 绿、本句红，**两句合起来才钉住"修好了"**。
   */
  assert.equal(
    product.ok, true,
    '★ 产品的返回值变了 —— 请复核臂 1：若 absorb 的 unmeasured 已经被传递，臂 1 应当全绿，'
    + '而本臂的对照断言需要随之翻面',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 污染检查：可执行代码里不许留变异体（不依赖任何突变是否还原）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 本队栽过两次「变异体泄漏」，其中一次是 captain 本人（commit `ad7a3ed`）。
 * 成因都一样：突变进行中会话被中断 ⇒ `process.on('exit')` 没机会跑 ⇒
 * 三重还原保护全部失效。⇒ 防线不能建在"记得还原"上，只能建在**盘上此刻是什么**上。
 *
 * ★ 本臂与"我这一轮有没有跑突变"完全无关：无论谁跑、跑之前发生过什么，
 *   它都只读盘。这正是它能兜住"会话被中断"那种成因的原因。
 */
test('臂 4 ★ 污染检查：src/ 与 lib/ 的【可执行代码】里不许残留 MUTANT/MUTATION 字面量', () => {
  const markers = findMutantMarkers()
  assert.deepEqual(
    markers, [],
    '★ 盘上的可执行代码里残留了变异体标记 —— 那说明一次定向突变没有还原，'
    + '而变异体会让对应判据恒真或恒假（commit ad7a3ed 就是这样进仓库的）：\n'
    + markers.map((path) => `  · ${path}`).join('\n'),
  )

  /**
   * ★★ 反向自证（缺了它，上面那条在"检出器永远返回空"时恒绿）：
   *   · 喂一段**代码里**带 MUTANT 的 ⇒ 必须命中；
   *   · 喂一段只把 MUTANT 写在**注释里**的 ⇒ 必须放过（否则检出器读错了位置）。
   */
  assert.match(stripComments('const MUTATED = true'), /\bMUTATED\b/, '★ 检出器对代码里的标记没有命中 —— 它是恒真的')
  assert.doesNotMatch(
    stripComments('// this describes a MUTANT that leaked\n/* MUTATION removed */\nconst clean = 1'),
    /\bMUTANT\b|\bMUTATION\b/,
    '★ 检出器把**注释里对事故的说明**当成了事故本身（读错位置的出口）—— '
    + '本文件头就在描述那次泄漏，若剥注释失效应立即命中自己',
  )
  /**
   * ★ 再钉一次"剥注释没有把整份源码都吃掉"（否则上面两条自证会退化成恒真）。
   */
  const sample = '/* block */\n// line\nconst real = 1\n'
  assert.match(stripComments(sample), /const real = 1/, '★ 剥注释把可执行代码也吃掉了 —— 检出器没有检查对象')
})
