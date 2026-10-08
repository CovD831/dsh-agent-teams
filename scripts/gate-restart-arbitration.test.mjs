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
/**
 * ★ t49：排队状态机住在 `lib/tools/shared/entities.js` ——
 *   ★ 不是 `lib/tools/restart.js`：`gate-tool-split` 臂 3 禁止**工具模块之间互相 import**，
 *     而 `status.ts` 要读这份状态 ⇒ 它必须在 `shared/`。
 *     （我第一版把它放在 `restart.ts`，那条臂当场红了 —— 而它红得对。）
 *   ★ 而 `arbitrateRestart*` 仍由 `lib/tools.js` 转出：两者**不在同一个模块**。
 */
import { clearRestartRequest, requestRestart, restartQueueFrom, restartQueueMessage, restartQueueState } from '../lib/tools/shared/entities.js'
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

/**
 * 从 `from` 处的 `{` 起，按**大括号配平**取到配平的那一个 `}`。
 *
 * ★ 为什么不用 `indexOf('\n  }))\n')`：那个锚点写死了缩进，而同一个工具在
 *   `src/tools.ts`（顶层语句）与 `src/tools/restart.ts`（在 `register()` 里）
 *   **缩进不同** ⇒ 那个锚点只能匹配一种；另一种返回 -1，而 `slice(x, -1)`
 *   会**静默**取到一个几乎空的片段，三条断言全部落空（t49 实测）。
 *
 * ★ 配平取块对**缩进无关**，所以工具搬到哪一层都对。
 */
function balancedBlockFrom(source, from) {
  const open = source.indexOf('{', from)
  if (open < 0) return ''
  let depth = 0
  /**
   * ★★ MEASURED（t49）：第一版只数大括号，而它**把字符串里的括号也算进去了** ——
   *   `description: 'Captain-only: reload this plugin …'` 里没有括号，
   *   但同一段里 `'host-cannot-restart'` 之类的**引号内容**迟早会遇到
   *   （这里实测：块在 description 那一行就提前收尾，长度 918，
   *    而它**不含** `arbitrateRestartWithEscape` ⇒ 三条断言全部落空）。
   *
   * ★ 修法：跳过字符串与注释 —— 只有**代码里的**括号参与配平。
   *   ★ 形态与另一条同族：**"数括号"没数错，数的东西里混进了不该数的。**
   */
  let quote = null
  let lineComment = false
  let blockComment = false
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (lineComment) {
      if (ch === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1 }
      continue
    }
    if (quote !== null) {
      /**
       * ★★ MEASURED（t49，第二次修这一处）：转义判断此前写的是 `ch === '\\'`
       *   —— 那在**源码里**是"反斜杠"两个字面量，比较的是**两字符**的字符串，
       *   于是它对真正的单个 `\` **永远为假**。
       *
       *   ⇒ 后果：`'… Only \"passed\" is accepted …'` 这个单引号串里，
       *     那个被转义的 `\"` 被当成**收尾**，串提前结束 ⇒ 之后整段文本在
       *     "引号"与"代码"之间错位 ⇒ 大括号配平在 description 那一行就收尾
       *     （实测长度 918，且**不含** `execute(`）。
       *
       * ★ 修法：比较**单个反斜杠**（源码里写作 `'\\'`，值就是一个 `\`）。
       *   ★ 形态：**"比较的两边不是一个东西"** —— 它读起来完全正确。
       */
      if (ch === '\\' ) { i += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  return source.slice(from)
}

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
  /**
   * ── ★ t49：`body` 的**结束锚点**改了 ──────────────────────────────────────
   *
   * MEASURED：这行此前是 `source.indexOf('\n  }))\n', toolStart)` —— 它假定工具的
   *   `ctx.tools.register(defineTool({ … }))` 收在**两格缩进**处（`src/tools.ts` 里
   *   它是顶层语句）。
   *
   * ★ 而 t39 把工具搬进了 `src/tools/restart.ts`，那里整块在 `register()` 里
   *   ⇒ 缩进多了一级，`\n  }))\n` 再也匹配不到 ⇒ `indexOf` 返回 **-1**
   *   ⇒ `slice(toolStart, -1)` 取到一个**几乎空**的片段
   *   ⇒ 三条断言（① 调仲裁 ② 提前返回 ③ 顺序）全部落空 ⇒ 臂红。
   *
   * ★ 修法：按**大括号配平**取块，而不是猜一个缩进 —— 那样工具搬到哪一层都对。
   *   ★ 而判别力一个字没动：仍然断言那三件事，仍然对"绕过仲裁"报红。
   */
  /**
   * ★★ MEASURED（t49，第三次修这一处）：起点必须是 `defineTool({`，**不是** `name:`。
   *
   *   从 `name: 'agent_teams_restart'` 起取块，第一个 `{` 是 `parameters: {`
   *   ⇒ 配平在 **parameters 结束处**就归零（实测 offset 171950，长度 918）
   *   ⇒ 取到的块**不含** `execute()` ⇒ 三条断言全部落空。
   *
   * ★ 而这条与前面两条是同一族：
   *   · 第一次：锚点写死了缩进（换文件后失效）
   *   · 第二次：转义判断比较的两边不是一个东西
   *   · 第三次：**起点选在了一个内层对象上** —— 配平本身没错，起点错了
   * ⇒ 共同形态：**"我数的东西"与"我要的那个东西"不是同一个**。
   */
  const defineStart = source.lastIndexOf('defineTool(', toolStart)
  assert.ok(defineStart > 0, '★ 工具必须在 defineTool(…) 里注册')
  const body = balancedBlockFrom(source, defineStart)
  assert.ok(
    body.includes('arbitrateRestartWithEscape') || body.includes('execute('),
    `★ 取块失败（长度 ${body.length}）—— 它必须真的包含工具的实现`,
  )

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
  /**
   * ── ★★ t49：② 的判法从"400 字符内出现 return"换成【控制流】──────────────────────
   *
   * MEASURED：这一条此前写 `if (!arbitration.allowed)[\s\S]{0,400}?return \{`。
   *   ★ 而一个**字符距离**是"提前返回"的**代理**，不是它本身 ——
   *     t49 在拒绝分支里加了注释（说明"只有 work-in-flight 才排队"），
   *     距离变成 **1165** ⇒ 断言红，**而代码的控制流一个字没变**。
   *
   *   ⇒ 这正是本队记账的形态：**一个代理读数在它所代理的东西没变时也会变**。
   *     （判别动作：问「这个读数的变化，**是否只可能由我关心的那件事引起**？」）
   *
   * ★ 换成真的看控制流：把 `if (!arbitration.allowed) { … }` 的**整块**取出来
   *   （配平到它的 `}`），断言块内**确实有 `return`**，且整个 `if (!…allowed)`
   *   出现在 `fiber.restart()` **之前**。
   *   ★ 而那与②的本意逐字对齐：**不放行 ⇒ 在那条路上返回，不落到重载**。
   */
  const refusalIf = body.indexOf('if (!arbitration.allowed)')
  assert.ok(refusalIf >= 0, '★ 找不到仲裁闸门的分支')
  const refusalBlock = balancedBlockFrom(body, refusalIf)
  assert.match(
    refusalBlock, /return \{/,
    '★ ② 不放行时必须**提前返回**（继续往下就等于没挡）—— 这是控制流断言，不是字符距离断言',
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

// ─────────────────────────────────────────────────────────────────────────────
// t49：重载的【排队】通道
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 它修的是什么（用户实测的结构性矛盾，原话）────────────────────────────────
 *
 *   「不管是我手动重启，还是调用最新的 restart 去重启，都需要等待团队成员的工作完成。
 *     我对这个插件的想法是，它需要尽可能把并发打满，尽可能去做快速迭代。
 *     也就是说，如果有团队成员在工作，就不可能进行手动重启或 restart。
 *     只要是跟 restart、重载相关的线，都会被阻塞。」
 *
 * ★ 那个矛盾的精确形状：
 *
 *     重载需要【无进行中工作】  ∧  并发干活 ⇒ 永远有进行中工作
 *     ⇒ 两者**结构上互斥** ⇒ 旧模块永远换不掉
 *
 * ★ 而 captain 的实测给了它两条硬证据：
 *   ① 调 `agent_teams_restart` ⇒ 拒：「2 task(s) are in progress」
 *   ② **用户手动重启两次**（PID 52994 → 54529 → 18909），而 `[deployment]` 仍报 stale
 *      ⇒ ★ **换进程 ≠ 换模块**
 */

test('★★ 臂 9（排队三态）：未申请 / 已申请 / 已申请但等不到 —— 三态**互不同形**', () => {
  /**
   * ★ 三态为什么必须不同形：`waiting` 会自己收敛，`stuck` **不会**。
   *   写成同一形状，读的人会一直等一个不会发生的事
   *   —— 那是本队记过的「等不到与还在等同形」。
   */
  const none = restartQueueState({ waitingOn: [], knownTaskIds: ['t1'], inFlight: [] })
  const waiting = restartQueueState({ requestedAt: 7, waitingOn: ['t1'], knownTaskIds: ['t1'], inFlight: ['t1'] })
  const stuck = restartQueueState({ requestedAt: 7, waitingOn: ['t9'], knownTaskIds: ['t1'], inFlight: [] })

  assert.equal(none.status, 'none')
  assert.equal(waiting.status, 'waiting')
  assert.equal(stuck.status, 'stuck')

  /** ★ 三者两两不同形 —— 一个把后两者合并的实现会在这一行红。 */
  assert.equal(
    new Set([none.status, waiting.status, stuck.status]).size, 3,
    '★ 三态必须**两两不同形**（把 waiting 与 stuck 合并 = 让人一直等一个不会来的事）',
  )
  /** ★ 而 `stuck` 必须**说出成因**（`waiting` 没有 ⇒ 两态在形状上也分得开）。 */
  assert.equal('reason' in stuck, true, '★ `stuck` 必须说清"为什么等不到"')
  assert.equal('reason' in waiting, false, '★ `waiting` 不该有 `reason` —— 它没有成因要说')

  /** ★ 措辞也必须分形（读的人靠它决定"继续等"还是"叫人"）。 */
  assert.match(restartQueueMessage(stuck), /CANNOT converge/i)
  assert.doesNotMatch(restartQueueMessage(waiting), /CANNOT converge/i)
})

test('★ 臂 9b（收敛臂）：被等的任务收口 ⇒ 名单缩空（而**申请仍在**）', () => {
  /**
   * ★ 这一格是"自动重载"的判定依据：`waitingOn` 空 ⇒ 现在就是那一刻。
   *   ★ 而它**不是第四态**：一个已经等到的申请仍是"已申请"（还没被消费）。
   */
  const drained = restartQueueState({ requestedAt: 7, waitingOn: ['t1'], knownTaskIds: ['t1'], inFlight: [] })
  assert.equal(drained.status, 'waiting')
  assert.deepEqual(drained.waitingOn, [], '★ 收口后名单必须缩空 —— 那是"可以重载了"的可执行读数')

  /** ★ 反向半边：还在跑时名单**不许**空（否则会提前重载）。 */
  const stillRunning = restartQueueState({ requestedAt: 7, waitingOn: ['t1'], knownTaskIds: ['t1'], inFlight: ['t1'] })
  assert.deepEqual(stillRunning.waitingOn, ['t1'], '★ 还在跑 ⇒ 名单不许空')
})

test('★ 臂 9c（★ 只排"等得到"的那一种）：`no-passing-verdict` 不许进队列', () => {
  /**
   * ── ★★ 为什么这一条是结构性的，不是偏好 ──────────────────────────────────────
   *
   *     `work-in-flight` 会因**工作收口**而消失 ⇒ 等它有意义。
   *     `no-passing-verdict` **不会**因任何人收口而出现 ⇒ 排队永远是白等。
   *
   * ⇒ 让后者也排队，会把"**回去改代码**"伪装成"等一会儿就好了" ——
   *   而那正是本队记账的「把一个该行动的时刻伪装成一个该等待的时刻」。
   *
   * ★ 本臂读的是**源码的接线**：`requestRestart` 必须在 `work-in-flight` 分支里。
   */
  const source = toolsSource()
  const defineStart = source.lastIndexOf('defineTool(', source.indexOf("name: 'agent_teams_restart'"))
  const body = balancedBlockFrom(source, defineStart)
  const call = body.indexOf('requestRestart(')
  assert.ok(call > 0, '★ 重载工具必须调用 `requestRestart(` —— 否则排队通道没有接线')
  /**
   * ★ 而它必须在 `blockedBy === 'work-in-flight'` 的**判断之内**：
   *   取 `requestRestart(` 往前最近的那个条件。
   */
  const before = body.slice(0, call)
  const guard = before.lastIndexOf("blockedBy === 'work-in-flight'")
  assert.ok(
    guard > 0 && call - guard < 400,
    '★ `requestRestart(` 必须挂在 `blockedBy === \'work-in-flight\'` 的条件里 ——'
    + ' 让"没有通过的判决"也排队，等于把"回去改代码"伪装成"等一会儿就好了"',
  )
})

test('★ 臂 9d（★ 出口臂）：排队状态必须能被 `status` 读到', () => {
  /**
   * ★ 那是 captain 唯一的读数：「我现在该不该继续派发？」
   *   而在申请排队期间，答案必须是**不要** —— 每派发一个新任务就把闸门推得更远
   *   （用户的矛盾正是这样形成的）。
   *
   * ── ★★ 读数面：`toolsSource()`，不是写死的 `status.ts`（t90）────────────────────
   *
   * MEASURED（t87 的普查读出来的第二处，captain 核实）：
   *
   *     本行原先写 `readFileSync(join(ROOT, 'src', 'tools', 'status.ts'), 'utf8')`
   *
   * ★ 而那与 t39（15 处）与 t70（8 处）**断掉的形状完全一样** ——
   *   只不过 `status.ts` 恰好**还没**被拆进子目录，所以它现在还是绿的。
   *   ⇒ 一处"碰巧还没断"的写死路径，与一处"已经断了"的写死路径，
   *     在源码里**长得一模一样**；等到它断，红的是**这一臂**，
   *     而它想说的那句话（"排队状态必须能被 status 读到"）与文件名无关。
   *
   * ★★ 而**换的只是读数面，判据一个字没动**：
   *   下面那些断言问的是「**那段代码在不在**」，而不是「**它在哪个文件里**」。
   *   ⇒ 所以换 `toolsSource()` 之后，它们问的还是同一件事，
   *     只是**问了整个 `src/tools/**`**（它正是 `src/tools/**` 的递归）。
   *
   * ★ 反向半边（不许为了让它们绿而做的事）：
   *   · 不**放宽**断言（不许改成"找不到就跳过"—— 那正是本队记账的"把红变绿"）
   *   · 不**改期望值**（正则一个字未动）
   *   · 不**缩小**范围（`toolsSource()` 是更大的一张面，不是更小的）
   */
  const source = toolsSource()
  assert.match(source, /restartQueueFrom\(/, '★ `status` 必须读排队状态 —— 否则 captain 无从知道该不该继续派发')
  assert.match(source, /hold_dispatch/, '★ 而它必须给出 `hold_dispatch`（"不要继续派发"那个布尔）')
  /**
   * ★ 而"自动收口"必须**挂在那里**：`status` 是唯一每次收口后必然被读的出口。
   *   ★ 若它挂在别处（或没有），"收口 ⇒ 自动重载"就需要有人记得做一件事 ——
   *     而那正是用户那个矛盾的成因。
   */
  assert.match(
    source, /state\.waitingOn\.length === 0[\s\S]{0,600}?fiber\.restart\(\)/,
    '★ 自动重载必须挂在 `status` 上（唯一每次收口后必然被读的出口）',
  )
})

test('★★ 臂 10（定向突变）：把"已申请"做成**恒真** ⇒ 臂必须红', () => {
  /**
   * ★ 契约要求：「把『已申请』做成恒真 ⇒ 臂红」。
   *   一个恒 `waiting` 的实现会让**每一次** status 都说"别派发"
   *   ⇒ 团队永久停摆 —— 而它在读数上与"真的有一次申请在等"完全同形。
   */
  const none = restartQueueState({ waitingOn: [], knownTaskIds: ['t1'], inFlight: [] })
  assert.equal(
    none.status, 'none',
    '★ 没有申请时必须报 `none` —— 恒真的"已申请"会让团队永久停摆，而它与真的申请同形',
  )
  /**
   * ★ 反向半边：**真的**申请时不许报 `none`（否则它是恒假，同样没有分辨力）。
   */
  assert.equal(
    restartQueueState({ requestedAt: 1, waitingOn: ['t1'], knownTaskIds: ['t1'], inFlight: ['t1'] }).status,
    'waiting',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// t50：调度器**真的不派发**（持住 hold_dispatch 的那一半）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 它补的是 t49 缺的那一半 ──────────────────────────────────────────────────
 *
 * t49 让"被拒的重载"进入「已申请」，并把读数（`hold_dispatch`）交到 `status` 上。
 * 而**强制点**在 `src/scheduler.ts` 的派发判定里 —— 那不在 t49 的 inScope。
 *
 * ⇒ 于是形状是：captain **看得到**「不要派发」，而调度器**还不会自己拒绝**。
 *
 * ★★ 而"看得到"是不够的 —— 那正是用户那句话要消灭的东西：
 *
 *   「凭经验决定何时触发」= 靠人执行的规则，而该项目文档已证明这类规则会腐烂。
 *
 *   ⇒ 一条"captain 看到 `hold_dispatch` 后应当克制"的规则，**就是**靠人执行的规则：
 *     它今天成立，因为 captain 记得；而它会在某一次忙碌里失效，
 *     而失效的那一次**不留痕迹**（没有任何读数会说"你本该不派发"）。
 *
 * ── ★ 为什么这一节驱动**真的调度器**，而不是调用那个判定函数 ────────────────────
 *
 *   直接调 `dispatchHeldByReload` 只证明"这个函数判得对"，**不证明**"派发那一刻
 *   真的经过了它"。⇒ 本队记账的形态：**一个没有调用方的判定，与没有判定在观测上完全相同**。
 *   ⇒ 所以下面从 `installTeamScheduler(...).kickTeam` 进 —— 那是生产路径本身。
 */

/** 一个够真实的调度器夹具：真的 `installTeamScheduler` + 真的团队目录。 */
async function schedulerFixture(tasks) {
  const { installTeamScheduler } = await import('../lib/scheduler.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const workspace = mkdtempSync(join(tmpdir(), 'sched-hold-'))
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Hold', captainSessionId: 'captain-session',
    createdAt: 1, taskSeq: tasks.length,
    members: [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks,
  })

  /** ★ 投递记录：于是臂里能断言"派发真的发生过"，而不是只看"没报错"。 */
  const dispatches = []
  const agents = new Map([
    ['captain-session', { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} }],
    ['member-1', { id: 'member-1', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} }],
  ])
  /**
   * ★ t50：**收集调度器写出的那条日志** —— 它是"此刻为什么不派发"的唯一出口，
   *   而臂 12 必须读**它**（不是状态机那一侧的同名字段）。
   */
  const logged = []
  const ctx = {
    logger: { debug() {}, info(message) { logged.push(String(message)) }, warn(message) { logged.push(String(message)) }, error(message) { logged.push(String(message)) } },
    agents: { get(id) { return agents.get(id) } },
    /**
     * ★ 调度器在 install 时订阅 `agent/status`（成员从 working 回到 idle 时补投递）。
     *   ★ 本夹具**不驱动那条路**（它测的是派发闸门），但接口必须在 ——
     *     少一个它会在 install 那一刻抛错，而那与闸门坏了同形。
     */
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  const scheduler = installTeamScheduler(ctx, {
    stateDir: '.agent-teams',
    dispatch: async (_captain, _teamId, memberName, text) => {
      dispatches.push({ memberName, text: text.slice(0, 80) })
      return true
    },
  })
  return { workspace, stateRoot, scheduler, dispatches, logged }
}

const HOLD_TASK = {
  id: 't1', seq: 1, subject: 'w', kind: 'work', status: 'pending',
  inScope: ['src/a.ts'], createdAt: 1, updatedAt: 1, dependencies: [],
}

test('★★ 臂 11（★ 强制臂，t50）：排队 waiting 时，调度器**自己**不派发', async () => {
  /**
   * ★★ 这一臂是 t50 的全部内容：**机制自己拒绝**，不是 captain 看到读数后克制。
   *
   * ★ 反向半边（同一臂内）：**没有申请**时，同一个调度器**必须**派发 ——
   *   缺了这一半，"不派发"可能来自一个恒不派发的实现，
   *   而那会让团队永久停摆（★ 与"真的在排队"在读数上同形）。
   */
  const clean = await schedulerFixture([HOLD_TASK])
  clearRestartRequest()
  await clean.scheduler.kickTeam(clean.workspace, 'team')
  assert.equal(
    clean.dispatches.length, 1,
    `★ 反向半边：**没有申请**时调度器必须照常派发 —— 否则"不派发"是恒真的。实测 ${clean.dispatches.length}`,
  )

  /** ★ 而现在申请一次重载（任务 t1 仍在跑 ⇒ waiting）⇒ 同一个调度器必须沉默。 */
  const held = await schedulerFixture([{ ...HOLD_TASK, status: 'in_progress', assignee: 'worker', attempt: 1, attemptId: 'a1' }, {
    ...HOLD_TASK, id: 't2', seq: 2, status: 'pending',
  }])
  requestRestart(['t1'], Date.now())
  try {
    await held.scheduler.kickTeam(held.workspace, 'team')
    assert.equal(
      held.dispatches.length, 0,
      `★ 排队 waiting 期间调度器**不许派发** —— 每派发一个新任务就把闸门推得更远。实测派发 ${held.dispatches.length} 次`,
    )
  } finally {
    clearRestartRequest()
  }
})

test('★★ 臂 12（三态臂）：`stuck` 也必须不派发 —— 而它与 `waiting` **不同成因**', async () => {
  /**
   * ★ 两者都"不派发"，而只有 `stuck` 意味着**要人介入**。
   *   把它们合成一条会让"再等一会儿"与"叫人来"同形 —— 本队记过的那条。
   *
   * ★ 可执行形式：把申请指向一个**不在任务表里**的任务 ⇒ `stuck` ⇒ 仍不派发。
   */
  const stuck = await schedulerFixture([{ ...HOLD_TASK, status: 'pending' }])
  requestRestart(['t-does-not-exist'], Date.now())
  try {
    await stuck.scheduler.kickTeam(stuck.workspace, 'team')
    assert.equal(
      stuck.dispatches.length, 0,
      '★ `stuck` 期间**也不派发** —— 那一等不会有结果，而派发只会让它更不可收拾',
    )
    /**
     * ── ★★ 而它必须**可诊断** —— 而诊断的读数要从【调度器那一条】来 ──────────────
     *
     * ★ MEASURED（本臂第一版**没抓住**一次定向突变）：我原先断言的是
     *   `restartQueueFrom(...).status === 'stuck'` —— 那是**状态机**的输出。
     *   而"把 `stuck` 并入 `waiting`"这个突变改的是**调度器那一条**
     *   （`dispatchHeldByReload` 的 `state` 字段）⇒ 状态机仍然报 `stuck`
     *   ⇒ 本臂照绿，而调度器已经把"要人介入"说成了"再等一会儿"。
     *
     * ★ 形态（本队记账的那一条）：**守卫检查了另一个同名的东西** ——
     *   两个字段都叫 `state`，而它们是**两条不同的出口**。
     *
     * ⇒ 改成读**调度器真的写出来的那一条日志**（`kickTeam` 里的 info），
     *   因为那才是"此刻为什么不派发"这个问题的**唯一出口**。
     */
    const held = stuck.logged.join('\n')
    assert.match(held, /stuck/, `★ 调度器必须把成因报成 \`stuck\`（不是 \`waiting\`）。实测日志：${held.slice(0, 200)}`)
    assert.doesNotMatch(
      held, /held while a reload is queued \(waiting\)/,
      '★ `stuck` 不许被报成 `waiting` —— 那会让"叫人来"伪装成"再等一会儿"',
    )
    /** ★ 而状态机那一侧也照样钉（两条出口**各自**都要对）。 */
    const state = restartQueueFrom([{ id: 't1', status: 'pending' }])
    assert.equal(state.status, 'stuck')
    assert.equal('reason' in state, true, '★ 而它必须说出成因（`waiting` 没有 `reason`）')
  } finally {
    clearRestartRequest()
  }
})

test('★ 臂 13（★ 交叉臂）：`kickMember` 单独调用时**也**被挡住（不许有绕过闸门的路）', async () => {
  /**
   * ★ 为什么这一臂必须存在：`kickMember` 可以被**单独**调用（不是每次都经过
   *   `kickTeam`）⇒ 只挡 `kickTeam` 会让另一条路径成为**绕过闸门**的路。
   *
   * ★ 而它与臂 11 是**一对**：一个测"整队扫描被挡"，一个测"单成员派发被挡"。
   */
  const fixture = await schedulerFixture([{ ...HOLD_TASK, status: 'in_progress', assignee: 'worker', attempt: 1, attemptId: 'a1' }, {
    ...HOLD_TASK, id: 't2', seq: 2, status: 'pending',
  }])
  requestRestart(['t1'], Date.now())
  try {
    await fixture.scheduler.kickMember(fixture.workspace, 'team', 'worker')
    assert.equal(
      fixture.dispatches.length, 0,
      '★ 单成员派发路径也必须被挡住 —— 否则它是绕过排队闸门的那条路',
    )
  } finally {
    clearRestartRequest()
  }
})

test('★ 臂 14（★ 收口后放开）：被等的任务终态 ⇒ 调度器**恢复**派发', async () => {
  /**
   * ★ 这一格防的是"不派发**卡住**"：申请排队 ⇒ 不派发 ⇒ 而在被等的任务收口之后，
   *   闸门**必须**松开（否则团队永久停摆）。
   *
   * ★ 而它同时是"自动重载"的前提：收口 ⇒ 名单空 ⇒ `status` 触发重载并消费申请。
   *   这里只钉**派发面**的行为（重载面在 t49 的臂里）。
   */
  const fixture = await schedulerFixture([{ ...HOLD_TASK, status: 'in_progress', assignee: 'worker', attempt: 1, attemptId: 'a1' }, {
    ...HOLD_TASK, id: 't2', seq: 2, status: 'pending',
  }])
  requestRestart(['t1'], Date.now())
  try {
    /** 前置：此刻确实被挡（否则下面那条"放开"是在一个没关过的门上断言的）。 */
    await fixture.scheduler.kickTeam(fixture.workspace, 'team')
    assert.equal(fixture.dispatches.length, 0, '★ 前置：此刻必须被挡')

    /** ★ 把被等的任务改成终态 ⇒ 名单缩空 ⇒ `status` 的自动重载会消费申请。 */
    const { readTeam, writeTeam } = await import('../lib/state.js')
    const team = await readTeam(fixture.stateRoot, 'team')
    team.tasks[0].status = 'completed'
    await writeTeam(fixture.stateRoot, team)
    /**
     * ★ 消费申请 = "重载已经发生"。这里**手工**模拟那一步，
     *   因为真实的 `fiber.restart()` 会把本进程 dispose 掉（夹具做不到）。
     *   ★ 而那正是 `status` 的自动收口在真实路径上做的事。
     */
    clearRestartRequest()

    await fixture.scheduler.kickTeam(fixture.workspace, 'team')
    assert.equal(
      fixture.dispatches.length, 1,
      '★ 申请被消费之后调度器必须恢复派发 —— 否则"不派发"卡住了，团队永久停摆',
    )
  } finally {
    clearRestartRequest()
  }
})
