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
 * ── ★★★ t74：一条判据【按什么认】—— 按导出形状，不按目录 ────────────────────────
 *
 * ── 缺陷（MEASURED，t69 归因）────────────────────────────────────────────────
 *
 * 本文件的普查原本**按目录扫**（`lib/gates/<point>/*.js` 每个文件都算一个判据模块）。
 * 而 t54 往 `src/gates/completion/` 里放了**两个不是判据的文件**：
 *
 *     kind-requirements.json    —— ★ 数据
 *     kind-requirements.ts      —— ★ 纯函数模块（导出 parseKindRequirements /
 *                                  gateRequirementFor / loadKindRequirementsOfHost）
 *
 * ⇒ 普查把两者都当成判据模块 ⇒ 对它们跑那套「必须有 id / point / description / gate」
 *   的三态检查 ⇒ 红。★ 而**判据本身一条都没错** —— 错的是普查认判据的方式。
 *
 * ── ★★ 而修法不是"把这两个文件加进白名单"─────────────────────────────────────
 *
 * 白名单要回答的问题是「**哪些非判据文件是允许的**」—— 而那正是错的问句：
 *
 *     按目录认 ⇒ 那个目录里将来放【任何】非判据的文件都会红。
 *              而 `gates/<point>/` 是一个**合理的家**：判据、它用的数据、
 *              它用的纯函数模块，都会长在这里。
 *     ★ 每一次新增都要改白名单 ⇒ 那是一条**靠人记得维护**的规则 ——
 *       而"凭经验/靠记得"正是本队从头到尾在消灭的东西。
 *
 * ⇒ 改成按【判据的定义】认：**一个判据模块 = 导出了那四个名字的模块**
 *   （`id` / `point` / `description` / `gate`，见 `src/gates/index.ts` 的
 *   装配契约 `GateModuleParts`）。
 *   ★ 于是：目录里多一个数据文件 ⇒ 它**不是判据** ⇒ 普查不看它 ⇒ **不红**。
 *     而目录里少一个 `gate` 导出 ⇒ 它**本应是判据而残了** ⇒ 普查**该红**。
 */
const GATE_DEFINING_EXPORTS = ['id', 'point', 'description', 'gate']

/**
 * ── 三态：是判据 / 不是判据（有理由）/ 无法判断 ──────────────────────────────────
 *
 * ★ 第二种（"不是判据，而它在这个目录里"）**必须【有理由可说】**，
 *   而不是被静默跳过 —— 否则"一个有意的非判据文件"与"一条被漏掉的真判据"
 *   在读数上同形。那是本队反复记的那个形态。
 *
 * ★ 三种各自的判据：
 *   · `gate`        —— 四个关键导出**都在** ⇒ 它是判据（或本应是）
 *   · `notAGate`    —— 一个都不在，**且**能说出它是什么（数据 / 纯函数模块）
 *   · `ambiguous`   —— 只导出了**一部分**关键名 ⇒ ★ 最危险的一种：
 *                     它可能是"一条残了的判据"（少了 `gate`），也可能是
 *                     "一个恰好有个叫 id 的纯模块"。⇒ 判不了 ⇒ `unmeasured`
 */
function classifyGateModule(module, file) {
  const present = GATE_DEFINING_EXPORTS.filter((key) => module[key] !== undefined)
  const missing = GATE_DEFINING_EXPORTS.filter((key) => module[key] === undefined)

  if (missing.length === 0) {
    /** ★ 四个都在 ⇒ 判据。而 `gate` 必须是函数（与装配层同一条纪律）。 */
    return typeof module.gate === 'function'
      ? { verdict: 'gate', present, missing }
      : { verdict: 'ambiguous', present, missing, why: `it exports "gate" but it is not a function (got ${typeof module.gate})` }
  }

  if (present.length === 0) {
    /**
     * ★ 一个关键导出都没有 ⇒ **不是判据**。而它必须**说得出它是什么** ——
     *   否则"一个有意的非判据文件"会与"一条被漏掉的真判据"同形。
     *   ⇒ 这里按**它导出了什么**给理由（而不是按文件名猜）。
     */
    const names = Object.keys(module).sort()
    const allFunctions = names.length > 0 && names.every((name) => typeof module[name] === 'function')
    const why = names.length === 0
      ? 'it exports nothing at all (a data-only module)'
      : allFunctions
        ? `it is a plain-function module: it exports ${names.join(', ')} — none of them is a gate definition`
        : `it exports ${names.join(', ')} — none of the four gate-defining names`
    return { verdict: 'notAGate', present, missing, why, exports: names }
  }

  /** ★ 只导出了一部分 ⇒ **判不了**（不许猜）。 */
  return {
    verdict: 'ambiguous',
    present, missing,
    why: `it exports ${present.join(', ')} but not ${missing.join(', ')} — that is either a gate that lost an export, or a module that happens to export one of those names`,
  }
}

/**
 * 盘上全部**判据模块**，按导出形状识别（不是按目录）。
 *
 * ★ `lib/` 不是 `src/`：见文件头。`lib/` 由 `pnpm build` 生成，
 *   而"改了 src 忘了 build"是本队实测过的窗口 —— 本文件读的必须是**真的会跑**的那一份。
 *
 * ★★ 返回**三类**，而不是一个数组 —— 因为"不是判据"那类**必须可读**
 *   （见 `classifyGateModule` 的三态）。只返回 gates 会把那类信息丢掉。
 */
async function loadGateModules() {
  const gates = []
  const notGates = []
  const ambiguous = []
  for (const dir of GATE_DIRS) {
    const full = join(ROOT, 'lib/gates', dir)
    if (!existsSync(full)) continue
    for (const name of readdirSync(full).sort()) {
      /**
       * ★ 只 import **`.js`**：目录里可能还有 `.json`（数据）与 `.d.ts`（类型），
       *   而它们既不是模块、也不该被 import。★ 这不是"按扩展名认判据"——
       *   扩展名只是**能不能 import** 的门槛；**是不是判据**由导出形状回答。
       */
      if (!name.endsWith('.js')) continue
      const mod = await import(new URL(`../lib/gates/${dir}/${name}`, import.meta.url).href)
      const file = `lib/gates/${dir}/${name}`
      const classified = classifyGateModule(mod, file)
      const entry = { file, dir, name, mod, ...classified }
      if (classified.verdict === 'gate') gates.push(entry)
      else if (classified.verdict === 'notAGate') notGates.push(entry)
      else ambiguous.push(entry)
    }
  }
  return { gates, notGates, ambiguous }
}

const CENSUS = await loadGateModules()
/** ★ 向下兼容：下面几条臂此前用 `MODULES`（全部文件）。现在它只含**判据**。 */
const MODULES = CENSUS.gates

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
  console.log(`    ℹ 磁盘上【是判据】的 ${MODULES.length} 个：${onDisk.sort().join(', ')}`)

  /**
   * ── ★★★ t74：三态必须都能读出来，且"不是判据"那类**必须带理由**───────────────
   *
   * 这是本任务的核心改动。旧口径**按目录**认判据 ⇒ 目录里放任何非判据文件都红。
   * 新口径**按导出形状**认 ⇒ 而"不是判据"这一类的目录必须**可读、带理由**，
   * 而不是被静默跳过 —— 否则它与"一条被漏掉的真判据"同形。
   */
  console.log(`    ℹ 在这个目录里但【不是判据】的 ${CENSUS.notGates.length} 个：`)
  for (const entry of CENSUS.notGates) {
    console.log(`       · ${entry.file}`)
    console.log(`         理由：${entry.why}`)
  }
  if (CENSUS.ambiguous.length > 0) {
    console.log(`    ℹ 【判不了】的 ${CENSUS.ambiguous.length} 个：`)
    for (const entry of CENSUS.ambiguous) console.log(`       · ${entry.file} —— ${entry.why}`)
  }

  /**
   * ★ 断言①：**"不是判据"这一类必须真的有理由**（不是空字符串、不是 `undefined`）。
   *   ★ 这一条把"静默跳过"堵死：一个被跳过的文件若说不出理由，那条断言就红。
   */
  for (const entry of CENSUS.notGates) {
    assert.equal(
      typeof entry.why, 'string',
      `★ ${entry.file} 被判成"不是判据"而【说不出理由】—— 那与"漏掉一条真判据"同形`,
    )
    assert.ok(
      entry.why.length > 10,
      `★ ${entry.file} 的"不是判据"理由太短（"${entry.why}"）—— 它要能让人复核那个判断`,
    )
  }

  /**
   * ★ 断言②：**判不了的必须显式存在，不许被并进前两类**。
   *   而当前它应当为 0（磁盘上每个文件都能被明确归类）—— 而**红的方式**是
   *   "它非空时逐条打印出来"，不是"断言它为 0"：
   *   ★ 一个新出现的 `ambiguous` 是一条**要人看一眼**的读数，而把它断言成 0
   *     会在队友合法地新增一个模块时按设计变红（t5 禁止的那种棘轮）。
   *   ⇒ 所以：非空时**打印并断言它非空**（让人看见），而不是断言它为空。
   */
  assert.ok(
    Array.isArray(CENSUS.ambiguous),
    '★ `ambiguous` 必须是数组（空也要在场）—— 缺席与空数组不同形',
  )

  /**
   * ★ 断言③（反向半边）：**真的判据一条都不许漏**——
   *   磁盘上"是判据"的那些，必须能覆盖注册表里每一条已接线的判据。
   *   ★ 这条数字（现在几条真判据）是契约点名要的读数。
   */
  const diskGateIds = new Set(MODULES.map((entry) => entry.mod.id))
  const missingFromDisk = [...listed].filter((id) => !diskGateIds.has(id))
  assert.deepEqual(
    missingFromDisk, [],
    '★ 注册表里有、而磁盘上【按导出形状认不出】的判据：\n'
    + missingFromDisk.map((id) => `  · ${id}`).join('\n')
    + '\n★ 那说明普查漏了它们（或它们的导出残了）—— 这是本任务的反向半边。',
  )
  console.log(`    ℹ 反向半边：注册表 ${listed.size} 条，磁盘按形状认出 ${diskGateIds.size} 条，漏 ${missingFromDisk.length} 条`)


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
    MODULES.length > 0,
    '★ 磁盘上一个判据都没认出来 —— 普查口径坏了（不是"没有判据"）',
  )
  /**
   * ★ 而这四条是**识别本身的证据**：`classifyGateModule` 说"这四个都在才算判据"，
   *   于是凡是进了 `MODULES` 的，必然四个都在。★ 若 `classifyGateModule` 被改坏
   *   （例如把 `missing.length === 0` 写成 `> 0`），这一圈立刻红。
   */
  for (const entry of MODULES) {
    for (const key of ['id', 'point', 'description', 'gate']) {
      assert.notEqual(
        entry.mod[key], undefined,
        `★ ${entry.file} 被认成了判据却缺少导出 "${key}" —— 识别口径与它自己的定义不一致`,
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
 *
 * ── ★★ t27：本臂从【单向】改成【双向】（这一节的由来）───────────────────────────
 *
 * 第一版是单向的：断言 `product.ok === swallowed.ok` —— 那编码的是【修前的事实】
 * （产品与"机制被拆掉"同形）。t25 修好之后，这一句按设计变红。
 *
 * ★ 而"变红"不是它的终点：一条只能对**一个时刻**说话的臂，在另一个时刻必然退化。
 *   ⇒ 改成**双向**：两支都保留，由【产品当前状态】选一支 ——
 *
 *       修后 ⇒ 产品与 propagate 同形（上游 unmeasured 被传递）＋ 不许与 swallow 同形
 *       修前 ⇒ 产品与 swallow  同形（未测量在传递中蒸发）＋ 它确实返回 ok
 *
 *   ⇒ 于是它对两侧都能说话，而**任一侧都不会退化成恒真**。
 *
 * ── ★ 两半成对（本臂最后那条断言）：它不是装饰 ────────────────────────────────
 *
 * 臂 1 说「这不该发生」，本臂说「产品落在哪一侧」。单独任一条都可能退化：
 *   · 只有臂 1 ⇒ 产品"恰好也拒绝、而原因与上游无关"时它也绿（测到了别的机制）；
 *   · 只有臂 3 ⇒ 它只描述"落在哪侧"，不说**该落在哪侧**。
 * ⇒ 本臂末尾把两者的结论**对拍**（`onPropagateSide === arm1ExpectsRejection`），
 *   任何一方被弱化/改成恒真，这条对拍立刻红。
 *
 * ── ★★ 实测（两次都真跑过）─────────────────────────────────────────────────────
 *
 *   ① 修后（当前产品）：
 *        臂 1 ✔ / 臂 3 ✔，且本臂打印「【修后】产品落在 propagate 一侧」 ——
 *        产品与"传播"同形、与"吞掉"不同形，且确实是 `unmeasured` 那一支。
 *
 *   ② 修前（★ 用**构建产物**模拟，不碰 src/ —— 见下）：
 *        在 `lib/gates/admission/convene.js` 里把 condition ④ 的整段三态分流短路
 *        （回到"压根没读 absorb"），跑本文件 ⇒
 *          本臂打印「【修前】产品落在 swallow 一侧」，
 *          且**臂 3 红在那条"两半成对"的对拍上**（臂 1 同次也红）。
 *        ⇒ 证明它落在 `===` 那一支时**不是恒真**：它真的在对着缺陷说话。
 *        跑完立即 `cp` 回备份，实测与备份逐字节相同、全仓可执行代码里
 *        `MUTANT|MUTATION|SIMULATED PRE-FIX` 命中为 0。
 *
 *   ★ 为什么用 lib/ 而不是 src/ 来模拟修前：本任务 inScope 只有这一个 scripts/ 文件，
 *     不许碰 src/；而 lib/ 是**构建产物**（gitignore 在仓库外，且随时可由
 *     `pnpm build` 再生）⇒ 在它上面做一次可还原的模拟，等价于"手工制造修前状态"，
 *     且不触碰任何源文件。★ 模拟完必须 `pnpm build` 或 cp 回备份 —— 两者都做了。
 */
test('臂 3 ★ 双向对照：产品落在【传播】一侧（修后）或【吞掉】一侧（修前），两句合起来才钉得住', async () => {
  const CP = 'admission.checkpoint'
  const AB = 'admission.absorb'
  const base = { producedDocuments: ['docs/PLAN.md'], openQuestions: [] }
  const absorbUnmeasured = { ok: false, unmeasured: 'the write history could not be observed' }

  /**
   * 对照 A：**传播**上游三态的实现（臂 1 期望产品落在这一侧）。
   * 对照 B：**吞掉**上游三态的实现（"把所有上游都当 ok"）—— 被拆掉机制的版本。
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

  /** ★ 两个对照必须**不同形** —— 否则下面无论断言哪一侧都是恒真（同义的两句话）。 */
  assert.equal(propagated.ok, false, '★ 传播上游 unmeasured 的实现**必须**拒绝 —— 这是机制在工作的形状')
  assert.equal(swallowed.ok, true, '★ 吞掉上游三态的实现返回 ok —— 这就是"机制被拆掉"之后的形状')
  assert.notEqual(
    propagated.ok, swallowed.ok,
    '★ 两个对照实现返回值相同 —— 那它们就不是"机制在工作"与"机制被拆掉"的两个端点，'
    + '下面的双向断言会退化成恒真（无论产品怎样都能命中一侧）',
  )

  const convene = MODULES.find((entry) => entry.mod.id === 'admission.convene')
  const product = await convene.mod.gate(ctx)

  /**
   * ── ★★ 双向断言：由【产品当前状态】选一支 ────────────────────────────────────
   *
   * 本臂的处境与别的臂不同：它在**修复前后都要有话说**，而"产品此刻在哪一侧"是一个
   * 会随修复改变的事实。⇒ 三条硬要求，缺一条它就会退化成恒真/恒假：
   *
   *   ① 两侧的断言必须**互斥且穷尽**（product.ok 只能等于 true 或 false）——
   *      一支说 `=== swallow.ok`，一支说 `!== swallow.ok`，恰好覆盖乘积空间；
   *   ② 选中的那一支必须**真的被断言**，而不是"哪支都行"；
   *   ③ 无论选中哪支，都必须**同时**钉住"另一支此刻不成立"——
   *      否则一次"产品返回值变成第三态"（例如抛错）会让两支都不执行而静默通过。
   *
   * ⇒ 实现：先算 `product` 落在哪一侧，再断言【选中支的正文】，并断言【另一支为假】。
   *   `side` 本身还要被断言为两者之一，这样"产品抛错/返回 undefined"不会被读成"选了某一支"。
   */
  const onSwallowSide = product.ok === swallowed.ok
  const onPropagateSide = product.ok === propagated.ok

  /**
   * ★ 第三支：产品与两个对照**都不同形**——理论上不可能（ok 只有两个值），
   *   但它必须被显式排除，而不是被 `if/else` 静默吞掉。
   */
  assert.ok(
    onSwallowSide || onPropagateSide,
    `★ 产品的 ok（${JSON.stringify(product.ok)}）与两个对照都对不上 —— `
    + '那不可能是"落在某一侧"，只可能是返回值形状变了（抛错 / undefined / 非布尔）。'
    + '把它读成"选了某一支"会让本臂在两支都不执行时静默通过。',
  )
  assert.notEqual(
    onSwallowSide, onPropagateSide,
    '★ 产品同时等于两侧 —— 两个对照本该不同形（上面的 notEqual 已钉），这里再钉一次乘积空间',
  )

  if (onPropagateSide) {
    /**
     * ── 【修后】分支：机制在工作 ──────────────────────────────────────────────
     *
     * 产品的返回值**与"传播"对照同形**、且与"吞掉"对照不同形 ⇒ 上游 absorb 的
     * unmeasured 真的被传递下去了。这是 t25 修复之后的正确形状。
     */
    assert.equal(
      product.ok, propagated.ok,
      '★ 【修后】产品必须落在【传播】一侧 —— 它此刻与"吞掉三态"同形，'
      + '说明上游 absorb 的未测量在传递中蒸发了（缺陷回来了）',
    )
    assert.notEqual(
      product.ok, swallowed.ok,
      '★ 【修后】产品不许与"吞掉三态"同形 —— 那与"机制被拆掉"无法区分',
    )
    /** ★ 且必须真的是**未测量**那一支，不是"恰好也拒绝"（两者报告强度不同）。 */
    assert.notEqual(
      product.unmeasured, undefined,
      '★ 【修后】产品落在传播一侧，却【不是】 unmeasured 那一支 —— '
      + '上游的"没能测量"被折成了 blocked 或别的形态，对策与补救动作完全不同',
    )
    console.log('    ℹ 臂 3 判定：【修后】产品落在 propagate 一侧（上游 unmeasured 被传递）')
  } else {
    /**
     * ── 【修前】分支：缺陷存在 ────────────────────────────────────────────────
     *
     * 产品的返回值与"吞掉"对照同形 ⇒ 它与"机制被拆掉"无法区分。
     * ★ 这一支**不是**"历史遗迹"：它是一条真实的、会红的断言 ——
     *   任何人把那三分支删掉（回到缺陷态），本支立刻接管并把事实钉死。
     */
    assert.equal(
      product.ok, swallowed.ok,
      '★ 【修前】产品与"吞掉三态"同形 —— 上游 absorb 的未测量在传递中蒸发了',
    )
    assert.equal(
      product.ok, true,
      '★ 【修前】产品返回 ok ⇒ 成团闸门拿着一个未知的吸收状态**自动成团**',
    )
    console.log('    ℹ 臂 3 判定：【修前】产品落在 swallow 一侧（上游 unmeasured 被吞掉）')
  }

  /**
   * ── ★ 两半成对：臂 1 与臂 3 必须【同向】──────────────────────────────────────
   *
   * 臂 1 说"这不该发生"（absorb 的 unmeasured 不许被读成 ok）；
   * 本臂说"产品落在哪一侧"。
   * 单独任何一条都可能退化：
   *   · 只有臂 1 ⇒ 它在"产品恰好也拒绝、但原因与上游无关"时也会绿（测到了别的机制）；
   *   · 只有臂 3 ⇒ 它只描述"落在哪侧"，不说**该落在哪侧**。
   * ⇒ 这里把两条的结论**对拍**：臂 1 的期望（产品该在 propagate 侧）必须与本臂
   *   实测的落点一致。不一致 ⇒ 两条臂在互相否认，必有一条在说谎。
   *
   * ★ 这条对拍**不依赖**产品修没修好：它只要求"臂 1 的断言"与"本臂的落点"相容。
   */
  const arm1ExpectsRejection = true
  assert.equal(
    onPropagateSide, arm1ExpectsRejection,
    '★ 臂 1 与臂 3 互相否认：臂 1 断言"该拒绝"，而本臂实测产品落在"吞掉"一侧 ⇒ '
    + '它们不再描述同一个事实。这是"两半成对"被破坏的形状（一条恒真或一条读错了位置）',
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

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 定向突变：识别口径【按形状】而不是【按目录】
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是 t74 的核心证据，而它用的是【装置的直接调用】──────────────────────────
 *
 * `classifyGateModule` 是纯函数，所以可以对**合成的模块**跑它 ——
 * 于是两个方向都能被钉住，而不必真的往 `lib/gates/` 里塞文件（那要 build）。
 *
 *   方向 A：目录里多一个**非判据**文件（数据 / 纯函数模块）⇒ 它**不该**被判成判据
 *           ★ 而那正是本任务修的：旧口径按目录 ⇒ 它对这种文件报"缺 id"
 *   方向 B：一条真判据**少了关键导出** ⇒ 它**该**被判成"不是判据"或"判不了"
 *           ★ 那是反向半边：缺导出必须仍然可见，不许静默放过
 */
test('臂 5 ★★ 定向突变：按形状识别 —— 多一个非判据不红，少一个关键导出要红', () => {
  /**
   * ── 方向 A：三种**真实存在**的非判据文件，每一个都必须被判"不是判据" ────────────
   *
   * ★ 三种形状取自本仓库的真实文件（t54 的 kind-requirements.ts / .json，
   *   以及一个纯数据模块）—— 而不是我编的。
   */
  const dataOnly = {}                                                        // .json 编译出来的样子：没有导出
  const plainFunctions = {                                                    // t54 的 kind-requirements.ts
    parseKindRequirements: () => {}, gateRequirementFor: () => {}, loadKindRequirementsOfHost: () => {},
  }
  const mixedNonGate = { helper: () => {}, CONSTANT: 1 }                      // 一个普通工具模块

  for (const [label, mod] of [['纯数据（无导出）', dataOnly], ['纯函数模块', plainFunctions], ['普通工具模块', mixedNonGate]]) {
    const verdict = classifyGateModule(mod, 'synthetic')
    console.log(`    ℹ 方向A ${label.padEnd(16)} ⇒ ${verdict.verdict}｜${verdict.why ?? ''}`)
    assert.equal(
      verdict.verdict, 'notAGate',
      `★ 「${label}」没有被判成"不是判据" —— 旧口径（按目录）正是栽在这里：`
      + '它会对这种文件报"缺 id"，而那让目录里**任何**非判据文件都变成红',
    )
    assert.equal(typeof verdict.why, 'string', `★ 「${label}」说不出为什么它不是判据`)
  }

  /**
   * ── 方向 B：真判据少一个关键导出 ⇒ **必须仍然可见**（不许静默放过）─────────────
   *
   * ★ 而这里要小心一件事：**少了 `gate` 的模块**与**一个恰好导出 `id` 的普通模块**
   *   在形状上**无法区分** ⇒ 所以那一类落 `ambiguous`（"判不了"），而不是 `notAGate`。
   *   ★ 那正是三态的第一与第三态之间的分界，而它必须**不同形**。
   */
  const completeGate = { id: 'x.y', point: 'contract', description: 'd', gate: () => ({ ok: true }) }
  assert.equal(classifyGateModule(completeGate, 'synthetic').verdict, 'gate', '★ 完整的判据模块必须被判成 gate')

  /** ① 少 `gate`（而其它三个在）⇒ `ambiguous`（可能是残了的判据）。 */
  const missingGate = { id: 'x.y', point: 'contract', description: 'd' }
  const v1 = classifyGateModule(missingGate, 'synthetic')
  console.log(`    ℹ 方向B 少 gate       ⇒ ${v1.verdict}｜${v1.why ?? ''}`)
  assert.equal(
    v1.verdict, 'ambiguous',
    '★ 一个"少了 gate 而其它三个都在"的模块被判成了非判据 —— 那会让一条**残了的真判据**静默消失。'
    + '它必须落 `ambiguous`（判不了），因为"残了的判据"与"恰好导出 id 的普通模块"在形状上无法区分。',
  )

  /** ② 只少 `point` ⇒ 同样是 `ambiguous`。 */
  assert.equal(classifyGateModule({ id: 'x.y', description: 'd', gate: () => {} }, 'synthetic').verdict, 'ambiguous')

  /** ③ `gate` 不是函数 ⇒ `ambiguous`（与装配层同一条纪律：非函数 gate 不许静默丢掉）。 */
  const badGate = { id: 'x.y', point: 'contract', description: 'd', gate: 'not-a-function' }
  const v3 = classifyGateModule(badGate, 'synthetic')
  console.log(`    ℹ 方向B gate 非函数   ⇒ ${v3.verdict}｜${v3.why ?? ''}`)
  assert.equal(v3.verdict, 'ambiguous', '★ gate 不是函数的模块被判成了判据 —— 装配层会当场抛错，而普查却说它好')

  /**
   * ── ★ 三态两两不同形（逐对断言，不循环）────────────────────────────────────
   */
  const shapeOf = (v) => JSON.stringify({ verdict: v.verdict, hasWhy: typeof v.why === 'string' })
  assert.notEqual(shapeOf(classifyGateModule(completeGate, 's')), shapeOf(classifyGateModule(plainFunctions, 's')), '★ gate 与 notAGate 必须不同形')
  assert.notEqual(shapeOf(classifyGateModule(plainFunctions, 's')), shapeOf(classifyGateModule(missingGate, 's')), '★ notAGate 与 ambiguous 必须不同形')
  assert.notEqual(shapeOf(classifyGateModule(completeGate, 's')), shapeOf(classifyGateModule(missingGate, 's')), '★ gate 与 ambiguous 必须不同形')

  /**
   * ── ★★ 而最后一条是**这个口径与旧口径的分水岭** ────────────────────────────────
   *
   * 旧口径的判据是"文件在这个目录里吗" ⇒ 一个**真实存在的文件**（数据/纯函数）
   * 会因为**它的位置**而被判成"残了的判据"。
   * 新口径的判据是"它导出了那四个名字吗" ⇒ 同一个文件被判成"不是判据，因为它是纯函数模块"。
   *
   * ★ 这两句话**指向不同的动作**：前者让人去"补一个 id 导出"（对一个数据文件毫无意义），
   *   后者让人什么都不做（它本来就对）。⇒ 而一条给出错误动作的红，是**最贵的红**。
   */
  const t54Module = classifyGateModule(plainFunctions, 'lib/gates/completion/kind-requirements.js')
  assert.equal(t54Module.verdict, 'notAGate', '★ t54 的 kind-requirements 必须是"不是判据"')
  assert.match(t54Module.why, /plain-function module/, '★ 而理由要指名它是**纯函数模块**（那是复核那个判断的依据）')
  console.log('    ℹ 分水岭：同一份 kind-requirements —— 旧口径说"缺 id"（让人去补一个无意义的导出），新口径说"不是判据"（什么都不用做）')
})
