/**
 * ── 重载的【仲裁闸门】（t24 / D）────────────────────────────────────────────────
 *
 * 契约：`docs/` 里那条用户裁定 —— 闸门是**仲裁**，不是**状态检查**。原话：
 *
 *   「我们在做代码修改的时候，应该已经跑过这种蓝绿判决了。所以最后在需要仲裁的时候，
 *     判决其实已经跑完了，只是需要进行仲裁。在这种情况下，**确实只需要检测任务情况
 *     就行了**。」
 *
 * ── 它防的是什么失效（MEASURED，本轮五次拦截）──────────────────────────────────
 *
 * 本队今晚被"进程持有旧模块"拦了 **5 次**（t14/t17/t19/t22/t23 开工），而每一次的
 * **表面理由都不同**（"你虚报改动" / "基准不可得" / "依赖未满足"）。
 * t23 把"持有旧模块"变成了**可检测**的读数；本任务把它变成**可处理**的动作。
 *
 * ★ 而没有它，无人值守**必然**退化成"每改一次判据就等用户重载一次"。
 *
 * ── ★★ f-0021 的闭环（point-dev 与 integrator6 从相反方向独立得出）─────────────
 *
 *     旧模块 ⇒ 任务开不了工 ⇒ 任务做不完 ⇒ 一直有"进行中工作"
 *           ⇒ 闸门（无进行中工作）永不满足 ⇒ 永远重载不了 ⇒ 旧模块永不被换掉
 *
 * ⇒ 用户裁定：闸门需要一个**逃生口**（在"整条链都冻住"时仍能重载），
 *   而它的**边界**必须是一个**显式的、可关的开关**，不是把闸门悄悄放宽。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ★ t39：工具的源码面现在是 src/tools.ts + src/tools/**（见该模块的文件头）
import { toolsSource } from './tools-source.mjs'
import {
  RESTART_ESCAPE_HATCH_ENV,
  arbitrateRestart,
  arbitrateRestartWithEscape,
  restartArbitrationMessage,
  restartEscapeHatchFromEnv,
} from '../lib/tools.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 一份"没有工作在跑"的任务表（终态 + 未开工，都不是 in_progress）。 */
const IDLE_TASKS = [
  { id: 't1', status: 'completed' },
  { id: 't2', status: 'failed' },
  { id: 't3', status: 'cancelled' },
  { id: 't4', status: 'pending' },
]

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：两个前置都满足 ⇒ 放行
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：有通过的判决 + 没有进行中的工作 ⇒ 闸门打开', () => {
  const arbitration = arbitrateRestart({ verdictPassed: true, tasks: IDLE_TASKS })
  assert.equal(arbitration.allowed, true, `实测：${JSON.stringify(arbitration)}`)

  /**
   * ★ 反向半边（防恒真）：**同一批任务**、只把判决翻成 false ⇒ 必须关闭。
   *   缺了这一半，"闸门打开"可能来自一个恒开的实现。
   */
  assert.equal(
    arbitrateRestart({ verdictPassed: false, tasks: IDLE_TASKS }).allowed, false,
    '★ 同一批任务下，判决没过 ⇒ 必须关闭（否则这一臂对"闸门恒开"没有分辨力）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 前置一）：没有"已通过的判决" ⇒ 拒绝，且说清是这一条
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 前置一：判决未通过（或缺席）⇒ 拒绝，且指名是「没有通过的判决」', () => {
  for (const verdictPassed of [false]) {
    const arbitration = arbitrateRestart({ verdictPassed, tasks: IDLE_TASKS })
    assert.equal(arbitration.allowed, false)
    assert.equal(
      arbitration.blockedBy, 'no-passing-verdict',
      '★ 被挡的**成因**必须指名 —— 否则读者会去等一个与结论无关的东西',
    )
  }
  /**
   * ★ 措辞必须说清"**本闸门不重跑判决**"（那是用户裁定的分界）。
   *   一条读起来像"我再帮你验一遍"的措辞，会让调用方以为这里会跑测试。
   */
  const message = restartArbitrationMessage(arbitrateRestart({ verdictPassed: false, tasks: IDLE_TASKS }))
  assert.match(message, /refused/i)
  assert.match(
    message, /does not re-run|deliberately does not/i,
    `★ 措辞要说清它不重跑判决（仲裁 ≠ 状态检查）。实测：${message}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 前置二）：有进行中的工作 ⇒ 拒绝，且**指名是哪几条**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 前置二：有 in_progress ⇒ 拒绝，且列出是哪几条任务', () => {
  const arbitration = arbitrateRestart({
    verdictPassed: true,
    tasks: [...IDLE_TASKS, { id: 't9', status: 'in_progress' }],
  })
  assert.equal(arbitration.allowed, false)
  assert.equal(arbitration.blockedBy, 'work-in-flight')
  assert.deepEqual(
    arbitration.inFlight, ['t9'],
    '★ 必须指名**哪几条**在进行中 —— "有工作在跑"不指名，读者无法行动',
  )
  assert.match(restartArbitrationMessage(arbitration), /t9/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 口径臂）：pending / claimed **不算**"进行中的工作"
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（口径）：未开工与已认领**不算**进行中 —— 否则闸门在有任何任务时恒不满足', () => {
  /**
   * ── ★ 这一格是本任务最容易做错的地方 ──────────────────────────────────────────
   *
   * 把"无未完成任务"当成闸门口径 ⇒ **任何有任务的团队**都过不去 ⇒ 闸门恒关
   * ⇒ 与"没有闸门"在无人值守下同效（都需要人来）。
   *
   * ★ 而 `pending` / `claimed` 确实**没有正在跑的工作**：
   *   · `pending` 还没开工；
   *   · `claimed` 只是被认领，任务本身没在跑。
   *   重载会 dispose 插件，但**不杀成员会话**（它们是宿主的 subagent），
   *   重新激活时会重新调度。
   */
  const arbitration = arbitrateRestart({
    verdictPassed: true,
    tasks: [
      { id: 't1', status: 'pending' },
      { id: 't2', status: 'claimed' },
      { id: 't3', status: 'completed' },
    ],
  })
  assert.equal(
    arbitration.allowed, true,
    '★ pending / claimed 不许挡住重载 —— 否则闸门在"有任何任务"时恒关，等于没有无人值守',
  )

  /**
   * ★ 反向半边：`in_progress` **必须**挡（上面臂 3 已钉），两者合起来才有分辨力。
   *   ⇒ 本臂与臂 3 是**一对**：一个说"这两个状态放行"，一个说"那个状态拦住"。
   */
  assert.equal(arbitrateRestart({ verdictPassed: true, tasks: [{ id: 't1', status: 'in_progress' }] }).allowed, false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 顺序臂）：判决先于工作被问 —— 否则读者会去等一个无关的东西
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（顺序）：判决与工作**同时**不满足时，报的是「没有通过的判决」', () => {
  /**
   * ★ 顺序是刻意的，而它有一个可观测的后果：
   *   若先问"有没有工作在跑"，那么一个**判决没过**且**有工作在跑**的团队
   *   会收到"等它跑完再试"——而正确动作是**回去改代码**。
   *   ⇒ 那个措辞会把人引向一个永远不会解决问题的方向。
   */
  const both = arbitrateRestart({
    verdictPassed: false,
    tasks: [{ id: 't1', status: 'in_progress' }],
  })
  assert.equal(
    both.blockedBy, 'no-passing-verdict',
    '★ 两个前置都不满足时，报**判决**那一条 —— 它才是要先解决的那个',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★ 定向突变臂）：绕过闸门直接重载 ⇒ 必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（定向突变）：把闸门【单独】拿掉 ⇒ 本文件的臂必须红', () => {
  /**
   * ── 规则二后半句的可执行形式 ──────────────────────────────────────────────────
   *
   * 契约要求：「定向突变能打红：**绕过闸门直接重载** ⇒ 对应臂红」。
   *
   * ★ 做法：用**真实的仲裁函数**，构造"两个前置都不满足"的输入，
   *   断言它**不**放行。若有人把闸门改成恒开（例如 `return { allowed: true }`），
   *   本臂立刻红。
   *
   * ★ 为什么这条臂读的是**行为**而不是源码：行为才是它要保护的东西。
   *   下面另有 arm 7 读源码钉住"重载确实经仲裁"（行为测不到那一半）。
   */
  for (const input of [
    { verdictPassed: false, tasks: IDLE_TASKS },
    { verdictPassed: true, tasks: [{ id: 't1', status: 'in_progress' }] },
    { verdictPassed: false, tasks: [{ id: 't1', status: 'in_progress' }] },
  ]) {
    assert.equal(
      arbitrateRestart(input).allowed, false,
      `★ 闸门被绕过了：这份输入必须被拒。实测：${JSON.stringify(input)} ⇒ ${JSON.stringify(arbitrateRestart(input))}`,
    )
  }
})

test('★ 臂 7（接线臂）：重载动作必须**真的经过**仲裁 —— 不许有一条绕过它的路', () => {
  /**
   * ── 为什么必须有这一臂（行为臂测不到它）───────────────────────────────────────
   *
   * 臂 1-6 测的是 `arbitrateRestart` 这个**函数**。而"工具在执行前调用了它"
   * 是另一件事 —— **一个没有调用方的闸门与没有闸门在观测上完全相同**
   * （这正是 integrator6 在 t31 报的那条，也是 t33 修的那条）。
   *
   * ⇒ 所以这里读源码，钉住三件事，缺一即红：
   *     ① 工具里调用了 `arbitrateRestartWithEscape`；
   *     ② 不放行时**提前返回**（而不是继续往下重载）；
   *     ③ 真正调用 `fiber.restart()` 的那一行**在**那个返回**之后**。
   */
  const source = toolsSource()
  const toolStart = source.indexOf("name: 'agent_teams_restart'")
  assert.ok(toolStart > 0, '★ 找不到 agent_teams_restart —— 锚点失效，本臂必须跟着看清新形状')
  const body = source.slice(toolStart, source.indexOf('\n  }))\n', toolStart))

  /**
   * ★★ MEASURED（本臂第一版被抓出恒真）：我原先只断言 `arbitrateRestartWithEscape(`
   *   这个**标识符出现在文本里**。定向突变把调用换成一个恒真的字面量
   *   （`const arbitration = { allowed: true, … }; void arbitrateRestartWithEscape(…)`）
   *   之后，标识符**仍在文本里** ⇒ 本臂照绿。
   *   ⇒ 而那条突变恰好就是"有闸门、但没真的用它"—— 本臂存在的**唯一理由**。
   *
   * ★ 形态：**「标识符在场」与「它被用于判定」是两件事**。
   *   与 t23 那次（字面量在类型/注释里也算数）同源。
   * ⇒ 改成断言**赋值形状**：仲裁的结果必须是**被赋给那个变量**的，
   *   而不是在同一行被 `void` 掉、变量另行硬编码。
   */
  assert.match(
    body, /const arbitration = arbitrateRestartWithEscape\(/,
    '★ ① 仲裁的结果必须**被赋给 `arbitration`** —— 光提到这个函数名不算（那可以同行走一次 `void` 而不使用它）',
  )
  assert.match(
    body, /if \(!arbitration\.allowed\)[\s\S]{0,400}?return \{/,
    '★ ② 不放行时必须**提前返回**（继续往下就等于没挡）',
  )
  const refusalAt = body.search(/if \(!arbitration\.allowed\)/)
  const restartAt = body.search(/fiber\.restart\(\)|\.restart\(\)\.catch/)
  assert.ok(
    restartAt > refusalAt && refusalAt >= 0,
    `★ ③ 真正重载的那一步必须在仲裁返回**之后**（实测 refusal@${refusalAt} restart@${restartAt}）—— `
    + '顺序反了就是"先重载再问该不该"，而它在读数上与"经仲裁"同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（★ 逃生口）：f-0021 的闭环需要一个显式的、可关的出口
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8（逃生口）：默认关闭；打开时只放行"有工作在跑"，**不**放行"判决没过"', () => {
  /**
   * ── 这一格来自 f-0021（两个缺口互相锁死）───────────────────────────────────────
   *
   *     旧模块 ⇒ 任务冻住 ⇒ 一直有 in_progress ⇒ 闸门永不满足 ⇒ 永远重载不了
   *
   * ⇒ 没有出口的话，无人值守在**没有外部干预**时【证明性地】无法自行解锁。
   *
   * ★ 而出口的**边界**必须精确，否则它就是"把闸门拆了"：
   */
  const busy = { verdictPassed: true, tasks: [{ id: 't1', status: 'in_progress' }] }

  /** ① 默认关闭 ⇒ 与"没有出口"完全一样。 */
  assert.equal(arbitrateRestartWithEscape(busy, false).allowed, false)

  /** ② 打开 ⇒ 放行，且**留下痕迹**（`reason: 'escape-hatch'` + 被绕过的是哪一条）。 */
  const escaped = arbitrateRestartWithEscape(busy, true)
  assert.equal(escaped.allowed, true)
  assert.equal(
    escaped.reason, 'escape-hatch',
    '★ 用出口过去的那一次必须与"闸门本来就开着"**不同形** —— 否则没人能看出它被用过',
  )
  assert.equal(escaped.bypassed, 'work-in-flight')

  /**
   * ③ ★★ 关键边界：出口**不许**放行"判决没过"。
   *   理由：出口的理由是"**链冻住了**"，不是"我们不知道新代码行不行"。
   *   让它可以绕过判决，就等于把蓝绿判决作废 —— 而那正是用户裁定的第一前置。
   */
  assert.equal(
    arbitrateRestartWithEscape({ verdictPassed: false, tasks: [] }, true).allowed, false,
    '★ 逃生口不得绕过「没有通过的判决」—— 那会让一次未经裁决的代码换上去',
  )
})

test('★ 臂 8b（开关臂）：环境变量**只认字面量 `1`**，其余一律等于关', () => {
  /**
   * ★ 与 `AGENT_TEAMS_OBSERVE_GATES` 同一条纪律：**缺省必须是不放宽**。
   *   一个"非空即开"的读法会让一个随手设成 `"false"` 的环境变量
   *   **打开**出口，而它在日志里读起来像"我关掉了"。
   */
  assert.equal(RESTART_ESCAPE_HATCH_ENV, 'AGENT_TEAMS_RESTART_ESCAPE_HATCH')
  assert.equal(restartEscapeHatchFromEnv('1'), true)
  for (const value of [undefined, '', '   ', 'true', 'yes', '0', 'false', '2']) {
    assert.equal(
      restartEscapeHatchFromEnv(value), false,
      `★ ${JSON.stringify(value)} 必须等于"关"（只认字面量 "1"）`,
    )
  }
})
