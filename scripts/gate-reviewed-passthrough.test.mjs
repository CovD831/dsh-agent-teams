#!/usr/bin/env node
/**
 * ── t9：`reviewed` 在 `create_task` 工具侧链路上的**透传** ──────────────────────────
 *
 * ── 这一格为什么存在（用户原话，逐字）────────────────────────────────────────────
 *
 *   「因为有的任务是自动生成的，有的任务是需要问过我之后再生成、再派发的。
 *     对于问过我、我裁决过的任务，在生成计划时就没有走自动生成的那一步，
 *     也就没有『已审查』的字段，**那它就需要被审查一遍**。」
 *
 * ⇒ ★ 路由规则：带 `reviewed` ⇒ 放行；不带 ⇒ **派之前必须先审一遍**。
 *   而本任务负责的是：**让那一格能从工具调用一路走到 team.json**。
 *
 * ── ★★★ 而本文件最要紧的一格，是那条【连接不成立】的读数 ────────────────────────
 *
 * ★ 本任务实测出一条**类型层的循环**：
 *
 *     t11 deps = [t9]                       ⇒ t11 等 t9 的调用点
 *     t9 的"第三站"（把值交给 validateCreateTask） ⇒ 等 t11 在 `CreateTaskInput` 上的声明
 *
 *   ⇒ 于是 `tsc` 在 `src/tools/create-task.ts` 那一行报
 *       `TS2353: 'reviewed' does not exist in type 'CreateTaskInput'`
 *   ⇒ ★ 而**那不是"这一行写错了"** —— 它是类型系统在说「接收方还没声明这一格」。
 *
 * ★★ 而这意味着：**本任务不能交一个 typecheck 全绿的树**，除非去改 t11 的文件。
 *   那条路在手边（加一行即可全绿），而它是「邻近不是许可」。
 *   ⇒ 所以本文件的臂**必须把这件事如实测出来**：
 *     一条"红着交"的交付，若没有一个读数说清**红在哪、为什么、谁还要做什么**，
 *     它与"没做完"在观测上同形。
 *
 * ── 而下面四类臂各自钉一件事 ────────────────────────────────────────────────
 *
 *   臂 1  schema 声明了 reviewed，且它**不是必填**（读源码字面 —— 见"为什么读源码"）
 *   臂 2  落盘那一站：缺席则**一个键都不写**；在场则**逐字**写进 team.json
 *   臂 3  ★ 那条【等待中的连接】：第三站在源码里、而它在等 t11 —— 且**它一旦能编译就不必再改**
 *   臂 4  反向半边：`reviewedTaskId` 那一族**没被动过**（沿用它，而不是改它）
 *
 * Run: node --test scripts/gate-reviewed-passthrough.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'src', 'tools', 'create-task.ts')
const GATES_SOURCE = join(ROOT, 'src', 'quality-gates.ts')

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1：schema 声明了它，且**不是必填**
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：schema 里声明了 `reviewed`，而它**不是** required（必填会让手工裁决的任务建不出来）', () => {
  /**
   * ── 契约逐字：「★ 不带 `reviewed` 建任务**照常成功**（它不许变成必填）」────────────
   *
   * ★★ 而这一条**读源码字面**，不读运行时的推断值 —— 理由与 t2 的臂 2 同源：
   *   "它是不是必填"这件事的**权威处**是 schema 的声明，而不是某一次调用的结果。
   *   ★ 而一个"运行时恰好没拒绝"的实现，与"声明里就是可选的"在读数上不同形。
   */
  const source = readFileSync(SOURCE, 'utf8')

  /** ① `reviewed` 那一格在 schema 里（`reviewed: {` 那一行）。 */
  assert.match(source, /^\s*reviewed: \{$/mu, '★ schema 里必须声明 `reviewed` 这一格')

  /**
   * ★★ ② 而它**不带** `required: true` —— 这是本臂的核心。
   *   ★ 用一个**窄**的锚点读它：`reviewed` 那一格的开头几行里不许出现 `required: true`
   *     （宽匹配会把别的字段的 required 也算进来，那会让本臂恒真）。
   */
  const block = /^\s*reviewed: \{([\s\S]*?)\n\s*\},$/mu.exec(source)
  assert.notEqual(block, null, '★ 读不到 `reviewed` 那一格的正文 —— 本臂无法成立（而"读不到就跳过"是恒真写法）')
  assert.equal(
    /required:\s*true/u.test(block[1].split('properties:')[0]),
    false,
    '★★ `reviewed` 那一格自己【不许】是 required —— 缺席是"还没审"的正常状态，不是错误',
  )

  /**
   * ★ ③ 而它的**内部**三个字段**必须**是 required —— 那是另一层必填（形状完整）。
   *   ★★ 两层必填说两件事：「这条任务登记了没有」与「那个登记全不全」。
   *     ⇒ 少了 ③ 会让 schema 推出全可选的形状，而那与 `ReviewedStamp` 不匹配（tsc 会指出）。
   */
  const inner = block[1]
  for (const field of ['at', 'by', 'checks']) {
    assert.match(
      inner, new RegExp(`^\\s*${field}: \\{[^}]*required: true`, 'mu'),
      `★ 内部字段 \`${field}\` 必须是 required（一旦这格在场，它的三个字段就不许缺）`,
    )
  }
  /** ★ 而 `checks[]` 的元素也必须具名且必填（逐条 verdict 是判据要读的东西）。 */
  for (const field of ['id', 'verdict']) {
    assert.match(inner, new RegExp(`${field}: \\{ type: 'string', required: true`), `★ check 里的 \`${field}\` 必须 required`)
  }

  /**
   * ★★ ④ 而 `additionalProperties: false` 必须在 —— MEASURED：不加它，
   *   schema 会推出一版**认不出**的形状，而 tsc 会报
   *   `Type 'reviewed' is incompatible with ReviewedStamp`。
   *   ⇒ 它是"这一格是**封闭形状**"的声明，而不是装饰。
   */
  assert.match(inner, /additionalProperties:\s*false/u, '★★ 嵌套 object 必须 `additionalProperties: false`（不加会让推断出的形状与 ReviewedStamp 不匹配）')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2：落盘那一站 —— 缺席不写、在场逐字写
// ═════════════════════════════════════════════════════════════════════════════

test('★★★★ 臂 2：落盘用「缺席就不写」的形态 —— 而不是写 `reviewed: undefined`', () => {
  /**
   * ── 契约逐字：「带 `reviewed` 时 `{at, by, checks[]}` 逐字落进 team.json」─────────
   *
   * ★★ 而"缺席"那一半同等要紧：一个写 `reviewed: undefined` 的实现，
   *   在 `JSON.stringify` 之后会**消失**（undefined 不入 JSON），
   *   而一个写 `reviewed: null` 的实现会**留下一个在场却是空的**格子 ——
   *   ⇒ 于是"没审"与"审了但是空的"在读取方眼里同形。
   *   ★ 所以本臂钉的是**那个形态**（`=== undefined ? {} : {…}`），
   *     它是"缺席与在场不同形"在**落盘这一层**的落点。
   */
  const source = readFileSync(SOURCE, 'utf8')
  assert.match(
    source,
    /\.\.\.input\.reviewed === undefined \? \{\} : \{ reviewed: input\.reviewed \}/u,
    '★★ 落盘必须是「缺席 ⇒ 不写键；在场 ⇒ 写值」—— 不许写 undefined/null（那会让"没审"与"空审"同形）',
  )
  /** ★ 反向：不许出现把它无条件写下去的形态（那会让缺席变成"在场但为空"）。 */
  assert.equal(
    /^\s*reviewed: input\.reviewed,\s*$/mu.test(source.split('fresh.tasks.push')[0].split('const task =')[1] ?? ''),
    false,
    '★ `task` 对象里不许无条件写 `reviewed`（那会让缺席的每一次建任务都带上一个空气泡）',
  )
})

test('★★★★ 臂 2b（反向半边）：`reviewedTaskId` 那一族**没被动过** —— 沿用它而不是改它', () => {
  /**
   * ★ 边界逐字：「不改 `reviewedTaskId`（它与 `reviewed` 是两件不同的事）」
   *
   * ★★ 反半边的用处：一个"顺手把两者合并"的实现会让
   *   "**哪一条**任务被审过"（`reviewedTaskId`）与"**审的结果**"（`reviewed`）合成一格，
   *   而它们的**缺席含义相反**（前者缺席 = 没指明对象；后者缺席 = 还没审）。
   */
  const source = readFileSync(SOURCE, 'utf8')
  // ① 那三站（schema / 入参 / 落盘）里，`reviewedTaskId` 都还在。
  assert.match(source, /reviewedTaskId: \{ type: 'string'/u, '★ schema 里 reviewedTaskId 必须仍在')
  assert.match(source, /reviewedTaskId: input\.reviewedTaskId,/u, '★ 入参里必须仍在')
  assert.match(
    source,
    /\.\.\.input\.reviewedTaskId === undefined \? \{\} : \{ reviewedTaskId: input\.reviewedTaskId \}/u,
    '★ 落盘里必须仍在（且沿用同一形态）',
  )
  // ② ★ 而 `reviewed` 的三站里**没有一处**碰 `reviewedTaskId`（逐条按锚点查）。
  const schemaBlock = /^\s*reviewed: \{([\s\S]*?)\n\s*\},$/mu.exec(source)?.[1] ?? ''
  assert.equal(
    /reviewedTaskId/u.test(schemaBlock), false,
    '★★ `reviewed` 那一格里不许出现 `reviewedTaskId` —— 两者是两件不同的事',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 3：★ 那条【等待中的连接】—— 而它必须说清"谁还要做什么"
// ═════════════════════════════════════════════════════════════════════════════

test('★★★★★ 臂 3：第三站那行【在源码里】，而它等的是 t11 —— 且那条等待**可核**', () => {
  /**
   * ── 为什么要一条臂来钉"一条编译不过的行"────────────────────────────────────────
   *
   * ★★★ 因为 (丙) 裁定下本任务**红着交**，而"红着交"有一个致命形态：
   *   **它与"没做完"在观测上同形** —— 除非有一个读数说清**红在哪、为什么、谁还要做什么**。
   *   ⇒ 所以本臂把那条等待写成**可执行的**，而不是一句注释。
   *
   * ★ 它钉三件事：
   *   ① 第三站那一行**在源码里**（它是对的；缺的是接收方声明）
   *   ② 接收方（`CreateTaskInput`）**确实还没声明** —— 而那是 t11 的写域
   *   ③ ★ 而 `ReviewedStamp`（t2 落的）**已经可得** —— 所以 t11 那一步是**纯声明**
   */
  const source = readFileSync(SOURCE, 'utf8')
  const gates = readFileSync(GATES_SOURCE, 'utf8')

  /** ① 第三站在（而它只能有一处 —— 多一处说明有人复制粘贴了）。 */
  const occurrences = (source.match(/^\s*reviewed: input\.reviewed,\s*$/gmu) ?? []).length
  assert.equal(
    occurrences, 1,
    `★★ 第三站（把 reviewed 交给 validateCreateTask）必须【恰好一处】—— 现为 ${occurrences} 处`,
  )

  /**
   * ★★ ② 而那条等待**现在是真的**：接收方还没声明。
   *   ★ 这一条断言是**可判真假的**（不是"我读一眼觉得"）：
   *     若 t11 已经声明了 `reviewed?: ReviewedStamp`，本臂**当场红** ——
   *     而那正是它该做的事：**等到了就说明这一格该删了**。
   */
  const declared = /^\s*reviewed\?: ReviewedStamp\s*$/mu.test(gates)
  assert.equal(
    declared, false,
    '★★ 接收方（`CreateTaskInput`）已经声明了 `reviewed` —— 那说明 t11 落地了，'
    + '而本任务那条"等待中的连接"应当被复核（本条臂随之该被删掉或改成"已连接"）',
  )

  /** ③ ★ 而"t11 要做什么"是**可核的两处**，不是一句"去接一下"。 */
  assert.match(
    gates, /^\} from '\.\/types\.ts'$/mu,
    '★ t11 要在那一份 `from \'./types.ts\'` 的 import 里加 `type ReviewedStamp`（实测：它现在不在那份清单里）',
  )
  assert.equal(
    /ReviewedStamp/u.test(gates), false,
    '★ 实测：`ReviewedStamp` 现在**不在** quality-gates.ts 里 —— 所以 t11 要做的是【两行】而不是一行',
  )

  /**
   * ★★ ④ 而那一步是**纯声明**（不改行为）—— 而这是可核的：
   *   `ReviewedStamp` 与 `TeamTask.reviewed` 都**已经存在**于 `src/types.ts`（t2 落的）。
   *   ⇒ 所以 t11 不需要新造任何形状，只需要让接收方**认得出**它。
   */
  const types = readFileSync(join(ROOT, 'src', 'types.ts'), 'utf8')
  assert.match(types, /^export interface ReviewedStamp \{/mu, '★ `ReviewedStamp` 必须已存在于 src/types.ts（t2 落的）')
  assert.match(types, /^\s*reviewed\?: ReviewedStamp\s*$/mu, '★ `TeamTask.reviewed` 也必须已存在')
})

test('★★★★★ 臂 3b：那条等待写在【源码里】（注释指着 t11），而不只在提交说明里', () => {
  /**
   * ★ 理由：**提交说明会随提交消失，而源码不会。**
   *   ⇒ 下一个打开这个文件的人，要在**那一行旁边**看到"它在等什么"。
   *
   * ★★ 而本臂要求的措辞是**可核的**：注释里要点名
   *   ① 它等的那个类型（`CreateTaskInput`）
   *   ② 它在谁的写域（t11）
   *   ③ ★ 而它落地之后**这里不用再改**（那条读数决定了"谁还要做一件事"）
   */
  const source = readFileSync(SOURCE, 'utf8')
  const idx = source.search(/^\s*reviewed: input\.reviewed,\s*$/mu)
  assert.notEqual(idx, -1, '★ 读不到第三站那一行')
  /** ★ 只取那一行【上面】的一段（紧跟它的注释块）。 */
  const before = source.slice(Math.max(0, idx - 3000), idx)
  assert.match(before, /CreateTaskInput/u, '★ 注释必须点名它等的是 `CreateTaskInput`')
  assert.match(before, /t11/u, '★ 注释必须点名那是 t11 的写域（否则读的人不知道该找谁）')
  assert.match(
    before, /不需要再改|自动变绿|不用再改/u,
    '★★ 注释必须说清"接收方声明之后这里不用再改" —— 那条读数决定了"谁还要做一件事"',
  )

  /**
   * ── ★★ 一条关于本臂自身的 MEASURED（免得下一个人把"突变没打红"读成"臂没守住"）──────
   *
   * ★ 我验这条臂时第一次的突变是**只把第一处 `t11` 改掉** —— 而它**没红**。
   *   ★★ 原因不是臂没守住，而是**那个突变太弱**：`t11` 在那一段里出现 **6 次**，
   *     改掉一处之后，上面那三条 `assert.match` 仍然命中剩下的。
   *   ⇒ ★ 改掉**全部** 6 处之后，本臂**当场红**（pass 4 / fail 1）。
   *
   * ★ 而那是一件值得写下来的事：**"突变没打红"有两个成因** ——
   *   「臂没守住」与「突变没改到该改的」—— 而它们在读数上**同形**。
   *   ⇒ 所以做定向突变时，要**先确认那个突变真的把被断言的东西拆掉了**
   *     （我当时就应该断言 `grep -c t11` 变成 0，而不是假定一次 `replace` 就够）。
   */
})
