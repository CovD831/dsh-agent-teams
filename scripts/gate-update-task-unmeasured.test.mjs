#!/usr/bin/env node
/**
 * ── ★★★ 「没能检查」不是「拒绝」—— 两个位置、两种成因（t42）─────────────────────
 *
 * 由来（MEASURED 2026-10-09，`verifier` 在 t5 上给出**两个终态的拒绝原文**）：
 * ```
 * completed ⇒ rejected: the completion gate could not measure (…)
 * failed    ⇒ rejected: ★ 同一条，逐字相同
 * ```
 * ★ 而那条判据**在自己的措辞里**写着 "so it is reported rather than refused"
 *   ⇒ 判据说"我是报告，不是拒绝"，而调用方读成了 "rejected"。
 *
 * ★★ 这一格已经出现过三次，而每次只修了一半：
 * ```
 * t16  `skippedAll` 那一格（"一条判据都没跑"）
 * t14  `skippedAll` 那一格（dispatch / completion 两处）
 * t42  ★ `unmeasured` 那一格（"跑了而这一步测不成"）—— 本次
 * ```
 *
 * ★★★ 而本臂钉的是**两处同一口径**（只修一处 ⇒ 它们会分叉，
 *   而分叉后「哪一处放行」在日志里同形）。
 *
 * ★ 判据是源码文本（本脚本不 import 产品）—— 而它钉的是**结构**，不是措辞：
 *   `NotChecked` 的定义里必须【两种成因都在】，且**两个位置都要**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★★★ t39：这两个位置现在【分居两个文件】────────────────────────────────────────
 *
 * ★ 此前 `dispatchNotChecked` 与 `completionNotChecked` 都在 `update-task.ts` 里 ——
 *   因为 `dispatch` 那个插入点的求值**曾经挂在 `update_task` 上**。
 *
 * ★★ 而 t39 把 `dispatch` 搬到了 `create_task`（**真正的派发那一刻**：
 *   `kickTeam` 之前）—— 因为 `update_task` 的四种状态**没有一次是派发**
 *   （`in_progress` 是成员报到、`completed`/`failed` 收口、`cancelled` 撤销）。
 *   ⇒ 于是本夹具要读【两个文件】才能同时看到那两处。
 *
 * ★ 而那不是"跟着落点走"的将就 —— 它让本臂【不再依赖"两处在同一个文件里"】：
 *   它测的口径是「两个位置对"没能检查"的处理必须同形」，
 *   而那个口径与"它们住在哪个文件"**无关**。
 *
 * ★★★ 而"哪一处住在哪个文件"是【落点知识】：
 *     dispatch   ⇒ src/tools/create-task.ts（t39 之后）
 *     completion ⇒ src/tools/update-task.ts
 */
const SRC_DISPATCH = readFileSync(join(ROOT, 'src', 'tools', 'create-task.ts'), 'utf8')
const SRC_COMPLETION = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')

/** 剥掉注释 —— 否则【描述这条纪律的注释】会被当成【这条纪律在】。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const code = stripComments(SRC_COMPLETION)
/** ★ dispatch 那半读它的新家（`create-task.ts`）。 */
const codeDispatch = stripComments(SRC_DISPATCH)

test('★★★ 臂 1：dispatch 位置把 `unmeasured` 也算作「没能检查」', () => {
  /**
   * ★★ t39：读【它的新家】`create-task.ts` —— 而口径一个字没变。
   */
  assert.match(
    codeDispatch,
    /const dispatchNotChecked = [\s\S]{0,200}?dispatchGates\.unmeasured !== undefined/,
    '★ `dispatchNotChecked` 必须同时认 `skippedAll` 与 `unmeasured` —— 两者都是"我没能检查"'
    + ' ★ 而它现在住在 `create-task.ts`（t39 把 dispatch 求值搬到了真正的派发那一刻）',
  )
})

test('★★★ 臂 2：completion 位置同样（两处同一口径）', () => {
  assert.match(
    code,
    /const completionNotChecked = [\s\S]{0,200}?completionGates\.unmeasured !== undefined/,
    '★ `completionNotChecked` 必须与 dispatch 位置同形 —— 只改一处会让它们分叉',
  )
})

test('★★★ 臂 3：两处的定义【形状一致】—— 这是"同一口径"的可机械判读', () => {
  /**
   * ★ 判据：把两处的定义各取出来，比较【它们认了哪几种成因】。
   *   ★ 而不是比较文本（那会因为变量名不同而误报）。
   */
  /**
   * ★ 定义是**多行**的（`= x\n && (a || b)`）⇒ 正则必须跨行取到【闭合括号】，
   *   而不是取到第一个换行 —— 我第一版就是这样，于是它读到了半句。
   */
  const dispatch = /const dispatchNotChecked = ([\s\S]{0,300}?\)\n)/.exec(codeDispatch)
  const completion = /const completionNotChecked = ([\s\S]{0,300}?\)\n)/.exec(code)
  assert.ok(dispatch && completion, '★ 两处的定义都必须在（dispatch 在 create-task.ts、completion 在 update-task.ts）')
  for (const [label, body] of [['dispatch', dispatch[1]], ['completion', completion[1]]]) {
    assert.match(body, /skippedAll !== undefined/, `★ ${label} 必须认 skippedAll`)
    assert.match(body, /unmeasured !== undefined/, `★ ${label} 必须认 unmeasured`)
    assert.doesNotMatch(body, /blockers/, `★ ${label} 不许把 blockers 也算进"没能检查" —— 那一种才该拒`)
  }
})

test('★★★ 臂 4：`blockers` 仍然拒（那一半不许放宽）', () => {
  /**
   * ★ 反向半边：两个拒绝点仍须存在，且仍然只在 `!NotChecked && ok === false` 时触发。
   *   ★ 缺了它，本臂在"一律放过"的实现上照样绿 —— 而那正是最坏的形态。
   */
  /**
   * ★★ t39：两个拒绝点现在【分居两个文件】—— 所以各读各的，而不是在同一个字符串里数两处。
   */
  const dispatchRefusals = [...codeDispatch.matchAll(/if \(!dispatchNotChecked && (\w+)Gates\.ok === false\)/g)]
  const completionRefusals = [...code.matchAll(/if \(!completionNotChecked && (\w+)Gates\.ok === false\)/g)]
  assert.equal(dispatchRefusals.length, 1, `★ dispatch 的拒绝点必须在（在 create-task.ts，实测 ${dispatchRefusals.length} 处）`)
  assert.equal(completionRefusals.length, 1, `★ completion 的拒绝点必须在（在 update-task.ts，实测 ${completionRefusals.length} 处）`)
})

test('★★ 臂 5：那两种成因在【警告里可分辨】—— 而措辞不许都叫 rejected', () => {
  /**
   * ★ `verifier` 报的那条最难反驳的证据是：判据说 "reported rather than refused"，
   *   而**同一句话的谓语**是 `update_task rejected:`。
   *   ⇒ ★ 所以警告里必须说出**是哪种成因**，而不是笼统一句。
   */
  /** ★ t39：dispatch 那一支的措辞在 `create-task.ts`，completion 那一支在 `update-task.ts`。 */
  assert.match(codeDispatch, /could not be measured/, '★ dispatch 的 unmeasured 那一支要说"测不成"（在 create-task.ts）')
  assert.match(codeDispatch, /nothing was evaluated/, '★ dispatch 的 skippedAll 那一支要说"没跑"')
  assert.match(code, /could not be measured/, '★ completion 的 unmeasured 那一支要说"测不成"（在 update-task.ts）')
  assert.match(code, /nothing was evaluated/, '★ completion 的 skippedAll 那一支要说"没跑"')
  /**
   * ★ 而"rejected"只该出现在【真拒绝】那两处（dispatch / completion 各一处）。
   *   ★ 注释里的不算（那是描述这个动作的文字）—— 所以数的是**代码里**的模板字符串。
   */
  /**
   * ★★ t39：两个拒绝点的措辞前缀现在不同（各用自己的工具名）——
   *   而它们【仍然各只有一处】。
   *   ⇒ ★ 而"前缀不同"是【对的】：读日志的人要知道是哪一个工具拒的。
   */
  const updateRejected = [...code.matchAll(/`update_task rejected:/g)].length
  const createRejected = [...codeDispatch.matchAll(/`create_task rejected:/g)].length
  assert.equal(updateRejected, 1, `★ completion 的"rejected"只该有一处（实测 ${updateRejected}）`)
  assert.equal(createRejected, 1, `★ dispatch 的"rejected"只该有一处（实测 ${createRejected}）`)
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ 以下三级缺陷的臂（D1 / D2 / D3）—— 只许追加，不许把上面五条改掉
// ═════════════════════════════════════════════════════════════════════════════
//
// 本文件此前只钉「没能检查 ≠ 拒绝」这一条口径（臂 1–5）。
// ★ 而那条口径有两个**相邻的**缺口，它们都不是"措辞"，而是**判定本身**：
//
//   D1  `blockers` 与 `unmeasured` **同时**在场时，前者被后者掩盖 ⇒ 有 blocker 也放行
//   D2  `appendExecution` 抄的是**上一代**的 `verdict` / `acceptanceResults` / `commandsRun`
//   D3  `commandsRun[i].status` 与 `exitCode` 自相矛盾（`passed`+非 0、`failed`+0）时被接受
//
// ★ 判据仍然是**源码文本**（本脚本不 import 产品）—— 但下面几臂多做了一件事：
//   把取出来的**表达式**在夹具里求值。⇒ 判的不是"这行字在不在"，
//   而是「给定形态的聚合体，它算出什么」—— 而后者正是缺陷所在的那一层。

/** 把跨行表达式压成一行（只为断言可读，不改语义）。 */
function oneLine(text) {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * ★ 从剥过注释的源码里取出某个 `*NotChecked` 的**完整表达式**（三行都取到）。
 *
 * ★★ 而臂 3 那条正则只取到第一个 `)\n`（那是它的判据：看定义里认了哪几种成因）。
 *   本组要的是**整个合取式** —— 包括括号**之后**那个新的合取项。
 *   ⇒ 两条正则各管一件事，互不覆盖；★ 而它们都锚在同一个名字上，
 *     所以「定义被改名」会让两条同时红（那是对的：改名就是换口径）。
 */
function notCheckedExpression(source, name) {
  const pattern = new RegExp(`const ${name} = ([\\s\\S]*?)\\n\\s*if \\(${name}\\)`)
  const found = pattern.exec(source)
  assert.ok(found, `★ 前置：\`${name}\` 的定义必须在，且紧跟着 \`if (${name})\``)
  return found[1]
}

/**
 * ★★ 在夹具里**求值**那段表达式（喂一个假的聚合体）。
 *
 * ★ 只读 `<gates>.ok` / `.blockers` / `.skippedAll` / `.unmeasured` 四个字段 ——
 *   表达式里没有别的引用，所以这段求值是真的在跑**产品的那条判据**，
 *   而不是夹具自己写的一份"应该长这样"的重述。
 */
function evaluateNotChecked(source, name, gatesName, gates) {
  const expression = notCheckedExpression(source, name)
  // eslint-disable-next-line no-new-func
  return new Function(gatesName, `return (${expression})`)(gates)
}

/** 两个位置各自的读物：`[标签, 剥过注释的源码, 变量名, 变量名]`。 */
const POSITIONS = [
  ['dispatch', codeDispatch, 'dispatchNotChecked', 'dispatchGates'],
  ['completion', code, 'completionNotChecked', 'completionGates'],
]

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★★ D1 正向）：`blockers` 非空 ⇒ **必须拒**，即使同一次求值里另有 unmeasured
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6（D1）：`blockers` 非空时必须拒 —— 即使同一次求值里另有判据交 `unmeasured`', () => {
  /**
   * ── ★★★ 这一形态**真的可达**（MEASURED，`src/gates/registry.ts:982-987`）────────
   *
   * 聚合体在有 unmeasured 时**原样透出 `blockers`**：
   * ```
   * if (unmeasuredReasons.length > 0) return { ok: false, unmeasured: …, blockers, … }
   * ```
   * ★ 而 `scripts/gate-registry.test.mjs` 的测试 ③ 明确钉了这一点
   *   （"blockers 仍要保留：那条问题是真的，只是这一轮的可信度更低"）。
   *
   * ── ★★★ 而缺陷正是它：`completionNotChecked` 只问「有没有两种"没能检查"的成因之一」
   *
   * ⇒ 那一格里**带着一条真问题一起放行** —— 而它的补救动作与"没能检查"**相反**
   *   （前者去修那个问题，后者去补测量条件）。
   *
   * ★★ 所以本臂的判据是**求值**：给定 `{blockers:[…], unmeasured:…}`，它必须算出 `false`
   *   （`false` ⇒ 不落 `NotChecked` 那一支 ⇒ 走下面的拒绝点）。
   *
   * ── ★ 定向突变 ────────────────────────────────────────────────────────────────
   * 把 `&& …blockers.length === 0` 删掉，或把第三项并进括号里用 `||`（"重新合成一条 if"）
   * ⇒ `{blockers:[…], unmeasured:…}` 算出 `true` ⇒ 本臂**红**。
   */
  for (const [label, source, name, gatesName] of POSITIONS) {
    const both = evaluateNotChecked(source, name, gatesName, {
      ok: false,
      blockers: ['[a] this gate found a real problem'],
      unmeasured: '[b] this gate could not measure',
    })
    assert.equal(
      both, false,
      `★★★ ${label}：聚合体同时带 blockers 与 unmeasured 时**必须拒** —— `
      + '而此前它只问"有没有 unmeasured 的成因"，于是把一条真问题读成了"没能检查"',
    )
    /** ★ 反向：只有 blockers（没有 unmeasured）时必须拒 —— 这一半本来就在，不许被放宽。 */
    const blockersOnly = evaluateNotChecked(source, name, gatesName, {
      ok: false, blockers: ['[a] this gate found a real problem'],
    })
    assert.equal(blockersOnly, false, `★ ${label}：只有 blockers 时必须拒`)
    /** ★ 而 `blockers` 与 `skippedAll` 同时在场同样必须拒。 */
    const blockedAndSkipped = evaluateNotChecked(source, name, gatesName, {
      ok: false, blockers: ['[a] this gate found a real problem'], skippedAll: 'all gates were skipped',
    })
    assert.equal(blockedAndSkipped, false, `★ ${label}：blockers 与 skippedAll 同时在场时必须拒`)
    /**
     * ★★ 结构判据（求值之外的第二条）：`blockers` 那一项必须是**独立的合取项**，
     *   且落在括号**之后** —— 若它被并进括号里的 `||`，那句"只有 blockers 时拒"
     *   就不再由它负责，而读代码的人会以为它还在。
     */
    const expression = oneLine(notCheckedExpression(source, name))
    assert.match(
      expression, /&& [a-zA-Z]+\.blockers\.length === 0$/,
      `★ ${label}：blockers 必须是一个**独立的、最后的**合取项（\`&& …blockers.length === 0\`）`
      + ` ★ 实测：${expression}`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（★★★ D1 反向半边）：只有 unmeasured、没有 blockers ⇒ **仍放行**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 7（D1 反向半边）：只有 `unmeasured`（没有 `blockers`）时仍放行 —— 那一半不许收紧', () => {
  /**
   * ── ★★★ 为什么这一条必须是**独立**的一臂 ────────────────────────────────────────
   *
   * 臂 6 只喂"该被拒"的输入 ⇒ 它测不出「一律拒绝」。
   * ★ 而本仓那条一般形式在这里格外要命：把 `blockers` 那一项写成
   *   `&& completionGates.unmeasured === undefined` 或 `&& blockers.length > 0`
   *   会让"纯 unmeasured"也开始被拒 —— 那是把 t42 的结论**整个推翻**，
   *   而臂 6 **照样全绿**（它只关心有 blocker 的那一格）。
   *
   * ⇒ 所以反向半边必须**真的跑**：`{ok:false, blockers:[], unmeasured:…}` 必须算出 `true`。
   *
   * ── ★ 定向突变 ────────────────────────────────────────────────────────────────
   * 把纯 unmeasured 也拒掉（例如 `&& …blockers.length === 0 && …unmeasured === undefined`）
   * ⇒ 本臂**红**。
   */
  for (const [label, source, name, gatesName] of POSITIONS) {
    /** ★ 纯 unmeasured（`blockers: []`）⇒ 放行 + 告警，不许拒。 */
    const pureUnmeasured = evaluateNotChecked(source, name, gatesName, {
      ok: false, blockers: [], unmeasured: '[b] this gate could not measure',
    })
    assert.equal(
      pureUnmeasured, true,
      `★★★ ${label}：只有 unmeasured 时**必须放行**（"我没能检查"≠"它不行"）—— `
      + '把这一半收紧会把 t42 的结论整个推翻，而臂 6 发现不了',
    )
    /** ★ 纯 skippedAll（一条判据都没跑）⇒ 同样放行。 */
    const pureSkipped = evaluateNotChecked(source, name, gatesName, {
      ok: false, blockers: [], skippedAll: 'every gate was skipped',
    })
    assert.equal(pureSkipped, true, `★ ${label}：只有 skippedAll 时同样必须放行`)
    /** ★ 对照组：聚合体 ok ⇒ 不是"没能检查"（不许把它读成放行理由）。 */
    const healthy = evaluateNotChecked(source, name, gatesName, { ok: true, blockers: [] })
    assert.equal(healthy, false, `★ ${label}：聚合体 ok 时 \`${name}\` 必须是 false（那是正常，不是"没能检查"）`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（★★★ D3）：`commandsRun[i].status` 与 `exitCode` 自相矛盾 ⇒ 拒
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 8（D3）：`passed`+非 0 / `failed`+0 都必须拒，而 `exitCode` 缺席不算矛盾', () => {
  /**
   * ── ★★★ 缺陷（MEASURED，`src/tools/shared/entities.ts:5554-5591`）────────────────
   *
   * `parseCommandResults` 只做**形状**校验：`command` 非空、`status ∈ {passed, failed}`、
   * `exitCode` 是 number 就透传。★ 它**从不**把两者放在一起看。
   * ⇒ 于是一份自相矛盾的证据与一份自洽的证据**同形**落盘，而 `failureKindOf`
   *   恰恰**只看 exitCode**（`src/state.ts:316-326`）⇒ 两个格子在讲两个故事。
   *
   * ── ★ 为什么校验落在 `update_task` 而不是那个解析器 ─────────────────────────────
   *
   * `entities.ts` **不在**本任务的 inScope 里，而它还有别的调用方。
   * ★ 所以修法是"包一层"：`parseCommandResultsChecked` **先交给**既有解析器
   *   （于是 `status` 缺席那条既有必填校验**原样生效** —— 收窄它的形状不是本任务），
   *   再判 status × exitCode 的一致性。
   *
   * ── ★ 三态里第三态是"缺席"，不是"一致" ───────────────────────────────────────
   *   `exitCode === undefined` ⇒ **不判**。老数据只是没记这一格，不是矛盾 ——
   *   把"没记"当"矛盾"会拒掉历史。
   *
   * ── ★ 定向突变 ────────────────────────────────────────────────────────────────
   * 删掉任意一条一致性分支 ⇒ 本臂红；把 `continue` 那格删掉 ⇒ "缺席不算矛盾"红。
   */
  const conflict = /export function commandRunConflict\(([\s\S]*?)\n}\n/.exec(code)
  assert.ok(conflict, '★ 前置：`commandRunConflict` 必须在 update-task.ts 里（那是本工具的**接受面**）')
  const body = oneLine(conflict[1])
  /** ① `passed` ∧ 非 0 ⇒ 矛盾。 */
  assert.match(
    body, /if \(item\.status === 'passed' && item\.exitCode !== 0\)/,
    '★★★ `status="passed"` 而 `exitCode` 非 0 必须被判为矛盾（"跑通了"与"退出码 1"不能同时为真）',
  )
  /** ② `failed` ∧ 0 ⇒ 矛盾。 */
  assert.match(
    body, /if \(item\.status === 'failed' && item\.exitCode === 0\)/,
    '★★★ `status="failed"` 而 `exitCode === 0` 同样必须被判为矛盾（"它坏了"与"退出码 0"不能同时为真）',
  )
  /** ③ 缺席 ⇒ 不判（老数据只是没记）。 */
  assert.match(
    body, /if \(item\.exitCode === undefined\) continue/,
    '★★ 第三态是"缺席"：没记 `exitCode` 不是矛盾 —— 这一段被删掉会让历史数据全变成红的',
  )
  /**
   * ★★ ④ 接线：两个入口都必须走这个包一层的版本。
   *   本仓记账过的那条一般形式：判据写对了而输入面没接上，在断言层面与"没判据"同形。
   *   ⇒ 若有人把某一处改回 `parseCommandResults(...)`，那一处就又静默接受矛盾证据了。
   */
  const checkedCalls = [...code.matchAll(/parseCommandResultsChecked\(args\.commandsRun\)/g)].length
  assert.equal(checkedCalls, 2, `★ 两个入口（终态补证据 + 常规更新）都必须走一致性校验，实测 ${checkedCalls} 处`)
  const unchecked = [...code.matchAll(/parseCommandResults\(args\./g)].length
  assert.equal(unchecked, 0, `★ 不许任何入口绕过它直接调既有解析器，实测 ${unchecked} 处`)
  /**
   * ★★ ⑤ 而包装层**必须**先委托给既有解析器 —— 否则 `status` 缺席那条既有必填校验
   *   会一起被绕过（那是本次**不许动**的一条）。
   */
  assert.match(
    oneLine(/export function parseCommandResultsChecked\(([\s\S]*?)\n}\n/.exec(code)?.[1] ?? ''),
    /const parsed = parseCommandResults\(value\)/,
    '★★ 包装层必须先调既有的 `parseCommandResults` —— 既有那条 `commandsRun[i].status must be passed or failed` 必须原样生效',
  )
  /**
   * ★ ⑥ 既有那条必填校验**一个字符都没动**（它住在 inScope 之外的 `entities.ts`）。
   *   ⇒ 本格是"没越界"的可机械判读：那条措辞与它的判定条件仍在原处。
   */
  const entities = stripComments(readFileSync(join(ROOT, 'src', 'tools', 'shared', 'entities.ts'), 'utf8'))
  assert.match(
    entities, /raw\['status'\] !== 'passed' && raw\['status'\] !== 'failed'/,
    '★ 既有必填校验（status 缺席 ⇒ 拒）必须仍在 —— 本次只加一致性，不拆形状校验',
  )
  assert.match(
    entities, /commandsRun\[\$\{index\}\]\.status must be passed or failed/,
    '★ 既有那条错误措辞也必须仍在（拆掉它等于偷偷放宽了形状校验）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（★★★ D2）：`appendExecution` 写的必须是**本代**的归因
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 9（D2）：`appendExecution` 必须在本代的 verdict / acceptanceResults / commandsRun 落定**之后**', () => {
  /**
   * ── ★★★ 缺陷（MEASURED 在本树上）────────────────────────────────────────────────
   *
   * `appendExecution` 抄 `task.status` / `task.round` / `task.verdict` / `failureKindOf(task)`。
   * 而它此前住在 `task.status = args.status` 之后、`task.verdict = args.verdict`
   * **之前** ⇒ 历史元素的 `verdict` 与 `failureKind` 读的是**上一代**的值：
   * ```
   * 上一代 needs_revision ⇒ failureKind 'inconclusive'
   * 这一代 failed + acceptanceResults 里有一条 failed ⇒ 本该 'failed_delivery'
   * ```
   * ★ 而"归因记到上一代"在读取端与"这一代就是这么回事"**完全同形** ——
   *   两者都是一条合法形状的 `failureKind`，无人能分辨。
   *
   * ── ★ 判据：本代的四格都在 `appendExecution` **之前**赋值 ───────────────────────
   * `status`（本来就对，是对照组）· `verdict` · `acceptanceResults` · `commandsRun`。
   *
   * ★ `round` 不属于这一代（它由 `create_task` 定、本工具从不写）⇒ 不在判据里，
   *   但它在元素里与其余几格**一起**构成一代的读数。
   *
   * ── ★ 定向突变 ────────────────────────────────────────────────────────────────
   * 把这一块搬回 `task.verdict = args.verdict` 之前（即恢复原缺陷）⇒ 本臂**红**。
   */
  const appendCalls = [...code.matchAll(/appendExecution\(task, \{/g)]
  assert.equal(appendCalls.length, 1, `★ 必须只有一处 append（实测 ${appendCalls.length}）—— 两处会各写一半的代`)
  const appendAt = code.indexOf('appendExecution(task, {')
  assert.ok(appendAt > 0, '★ 前置：`appendExecution(task, {` 必须在')
  const ordered = [
    ['status', 'task.status = args.status'],
    ['verdict', 'task.verdict = args.verdict'],
    ['acceptanceResults', 'task.acceptanceResults = acceptanceResults'],
    ['commandsRun', 'task.commandsRun = commandsRun'],
  ]
  for (const [label, needle] of ordered) {
    const at = code.indexOf(needle)
    assert.ok(at > 0, `★ 前置：\`${needle}\` 必须在（本代 ${label} 的赋值点）`)
    assert.ok(
      at < appendAt,
      `★★★ ${label} 必须在 appendExecution **之前**落定 —— `
      + '否则历史元素抄的是**上一代**的值，而它在读取端与"这一代就是这么回事"同形',
    )
  }
  /**
   * ★★ 而"抄进去的是 task 上的现值"这一条也必须在：若有人改成
   *   `verdict: args.verdict` 或 `commandsRun: args.commandsRun`，那它就绕开了
   *   "这一代**最终**落定的是什么"（含规范化与默认值）⇒ 与任务的当前态分叉。
   */
  const block = code.slice(appendAt, appendAt + 1400)
  assert.match(block, /status: task\.status/, '★ 历史元素的 status 必须抄 `task.status`（本代落定值）')
  assert.match(block, /\{ failureKind: failureKindOf\(task\) \}/, '★ failureKind 必须由 **当时** 的 task 算出（现在它在本代赋值之后）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10（★★★ 行为臂）：两代历史 + commandsRun 一致性，走**真工具**与真落盘
// ─────────────────────────────────────────────────────────────────────────────
//
// ★ 上面几臂是**源码文本**判据（本文件的一贯风格：结构可机械判读，且不依赖构建产物）。
//   ★★ 而 D2 / D3 都有一半**只能从行为上读**：
//     · D2 的缺陷是"历史元素抄了上一代的值" —— 源码顺序对了不等于**抄对了**；
//     · D3 是一条**接受面**判据 —— 源码里有那个 if 不等于工具真的会拒。
//   ⇒ 所以这一臂走 `agent_teams_update_task`，并**从盘上重读** `team.json`
//     （判据写对了而输入面没接上，在断言层面与"没判据"同形 —— 本仓反复记账的那条）。
//
// ★ 它 import `../lib/`：与 `scripts/gate-execution-history.test.mjs` 同一条约定
//   （那个夹具也读 `../lib/tools.js`）。⇒ 本臂的前提是 `pnpm build` 已跑过。

test('★★★ 臂 10（行为臂）：两代历史的 `failureKind` 不同形 · `commandsRun` 矛盾被拒 · `status` 缺席仍拒', async () => {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  /** 一个最小可信的团队 + 一条 `work` 类任务（用 `work` 是为了不被完工判据前置条件挡住）。 */
  async function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), 'd1d2d3-'))
    const stateRoot = join(workspace, '.agent-teams')
    const tools = new Map()
    const ctx = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      tools: { register(tool) { tools.set(tool.name, tool) } },
      subagents: {
        getProvider() { return undefined }, list() { return [] },
        sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
      },
      agents: { list: () => [], get() { return undefined } },
      llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
      on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
    }
    registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
    await createTeamDir(stateRoot, {
      id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
      members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
      tasks: [{
        id: 't1', subject: 'x', kind: 'work', status: 'in_progress', assignee: 'worker',
        dependencies: [], attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1,
      }],
    })
    const member = {
      id: 'm1', status: 'working', steer() {},
      session: { header: { cwd: workspace, id: 'sess-m1' }, events: [], ownEvents() { return [] } },
    }
    const call = (args) => tools.get('agent_teams_update_task').execute(
      { task_id: 't1', attempt_id: 'a1', ...args },
      { agent: member, signal: new AbortController().signal },
    ).then(() => 'ok', (error) => String(error.message))
    const taskOf = () => JSON.parse(readFileSync(join(stateRoot, 'team', 'team.json'), 'utf8')).tasks.find((item) => item.id === 't1')
    const rewrite = (mutate) => {
      const team = JSON.parse(readFileSync(join(stateRoot, 'team', 'team.json'), 'utf8'))
      mutate(team.tasks.find((item) => item.id === 't1'))
      writeFileSync(join(stateRoot, 'team', 'team.json'), `${JSON.stringify(team, null, 2)}\n`, 'utf8')
    }
    return { workspace, call, taskOf, rewrite, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
  }

  // ── ① 两代历史：第 1 代 `failed_context`，本代（带 failed acceptanceResult）`failed_delivery` ──
  const f = await fixture()
  try {
    /** ★ 第 1 代：`failed` 而**没有任何**失败证据 ⇒ `failureKindOf` 落在 `failed_context`。 */
    assert.equal((await f.call({ status: 'failed', output: 'broke with no evidence' })), 'ok', '★ 前置：第 1 代必须落得下')
    /** ★ 重置成"新一代"（与 `gate-execution-history.test.mjs` 同一条手法）—— 并且**清掉上一代的证据**。 */
    f.rewrite((task) => {
      task.status = 'in_progress'
      task.attempt = (task.attempt ?? 1) + 1
      delete task.verdict
      delete task.acceptanceResults
      delete task.commandsRun
    })
    /** ★ 本代：`failed`，而 `acceptanceResults` 里有一条 `failed` ⇒ 应落 `failed_delivery`。 */
    assert.equal(
      (await f.call({ status: 'failed', output: 'broke with a failing acceptance result', acceptanceResults: [{ criterion: 'works', status: 'failed' }] })),
      'ok', '★ 前置：本代必须落得下',
    )
    const history = f.taskOf().executions
    assert.equal(history.length, 2, '★ 两代 ⇒ 两个历史元素')
    /**
     * ★★★ 本臂的要害：两代**不同形**。
     *   ★ 修前（`appendExecution` 在本代赋值之前）第 2 代会抄到第 1 代的值 ⇒ 两个都是 `failed_context`。
     */
    assert.deepEqual(
      history.map((entry) => entry.failureKind), ['failed_context', 'failed_delivery'],
      '★★★ 归因必须记【本代】：第 1 代没有失败证据（`failed_context`），'
      + '本代有一条 failed 的 acceptanceResult（`failed_delivery`）。'
      + ' ★ 两个都读成 `failed_context` ⇒ 归因抄的是上一代 —— 而它在读取端与"这一代就是这么回事"同形',
    )
    assert.notEqual(history[0].failureKind, history[1].failureKind, '★ 两代必须不同形（同形 = 归因没跟着这一代走）')
  } finally { f.cleanup() }

  // ── ② commandsRun 一致性：矛盾必须拒；缺席不触发；status 缺席仍由既有校验拒 ──
  const g = await fixture()
  try {
    const passedNonZero = await g.call({ status: 'completed', output: 'done', commandsRun: [{ command: 'pnpm test', status: 'passed', exitCode: 1 }] })
    assert.match(passedNonZero, /status="passed" but exitCode=1/, `★★★ passed + 非 0 必须拒。实测：${passedNonZero.slice(0, 200)}`)
    const failedZero = await g.call({ status: 'completed', output: 'done', commandsRun: [{ command: 'pnpm test', status: 'failed', exitCode: 0 }] })
    assert.match(failedZero, /status="failed" but exitCode=0/, `★★★ failed + 0 必须拒。实测：${failedZero.slice(0, 200)}`)
    /** ★ 反向半边：缺席 ⇒ **不判**（老数据只是没记，不是矛盾）。 */
    const absentExitCode = await g.call({ status: 'completed', output: 'done', commandsRun: [{ command: 'pnpm test', status: 'passed' }] })
    assert.equal(absentExitCode, 'ok', `★★ exitCode 缺席不算矛盾。实测：${absentExitCode.slice(0, 200)}`)
    /** ★★ 既有那条必填校验**保持原样**：`status` 缺席仍然拒（本次只加一致性，不拆形状校验）。 */
    const absentStatus = await g.call({ status: 'completed', output: 'done', commandsRun: [{ command: 'pnpm test' }] })
    assert.notEqual(absentStatus, 'ok', `★★ status 缺席仍须被拒。实测：${absentStatus.slice(0, 200)}`)
    /**
     * ★ MEASURED：这一条在**更早的一层**就拒了 —— 工具自己的 schema
     *   （`missing required property "commandsRun[0].status"`），还没走到
     *   `src/tools/shared/entities.ts:5565` 那条 `must be passed or failed`。
     *   ⇒ 两层都拒是**对的**（schema 是声明面、解析器是接受面），而本臂钉的是
     *     「**行为上**仍然拒」这件事 —— 本次的一致性校验**没有**把它变成放行。
     *   ★ 那条既有校验本身留在原处由臂 8 ⑥ 直接读源码钉住。
     */
    assert.match(absentStatus, /commandsRun\[0\]\.status/, `★★ 拒绝必须点名那一格。实测：${absentStatus.slice(0, 200)}`)
  } finally { g.cleanup() }
})
