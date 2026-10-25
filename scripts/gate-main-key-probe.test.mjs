/**
 * ── ★★★ 最小实验①的判据：不绑会话的 `main` key 会不会出现（t103）───────────────
 *
 * 规格：`docs/UI-V5-SINGLE-ENTRY.md` §0。
 *
 * ── ★★ 为什么这些判据是【可编程的】──────────────────────────────────────────────
 *
 * 本机**没有视觉模型** ⇒ 不能"截个图看看"。
 * ⇒ 判据全部落在**可读的返回值**上：
 *   · 槽位的 `spec`（`kind` / `scope`）；
 *   · `register` 有没有抛；
 *   · `entriesOfSlot('main')` 折出来的 **cell key 列表**；
 *   · 探针组件的**渲染计数**（`probeRenderCount`）。
 *
 * ── ★★★ 实验结论（一句话）───────────────────────────────────────────────────────
 *
 * **注册得进去，但默认不会被选中** —— 即三态里的 **(b) `registered-but-hidden`**，
 * 而**不是** (c) 注册失败。
 * ⇒ ★ 官方那条「No surface without a session」**不管 `main` 的其它 key**：
 *   它管的是 **rightbar**（那条注释逐字写着 "shows nothing on the right"）。
 * ★ 但 `main` 有自己的**另一道门**：选择器 `MainPanel`
 *   `entryKey = activePanelId ?? "conversation"` ⇒ 无会话时 `activePanelId` 是 `null`
 *   ⇒ **落到 `conversation`**，我们的 key 注册成功却**不被渲染**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  FOLDERS_MAIN_KEY, PROBE_SLOT_NAME, RESERVED_CONVERSATION_KEY,
  classifyMainKeyProbe, probeRegistrationError, resetProbeCounts, resetProbeRegistrationError,
} from '../lib/client/folders-probe.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** ★ 真实的 slots 服务（不是复刻）—— 判据要落在**真实现**上。 */
const SLOTS = join(
  HERE, '..', 'node_modules', '.pnpm',
  '@deepseek-ai+dsh-client-ui-slots@0.2.1-rc.2_@deepseek-ai+cordis@4.0.5',
  'node_modules', '@deepseek-ai', 'dsh-client-ui-slots', 'lib', 'index.js',
)
const INDEX = join(HERE, '..', 'src', 'client', 'index.tsx')

/** ★ 起一个**真的** slots 服务（`SlotCore` 是官方导出）。 */
async function slotsCore() {
  const { SlotCore } = await import(SLOTS)
  const core = new SlotCore()
  /** ★ 声明 `main`，与官方 SlotMap 逐字一致：`{ kind: 'keyed', scope: 'root' }`。 */
  core.record('main').spec = { kind: 'keyed', scope: 'root' }
  return core
}

test('★★ 臂 1：`main` 的 spec 是 keyed + root（可多 key 且不绑会话）', async () => {
  const spec = (await slotsCore()).spec('main')
  /**
   * ★ `kind: 'keyed'` ⇒ 可以注册多个 key（一个工作区一个视图）。
   * ★ `scope: 'root'` ⇒ ★ **不绑会话** —— 这是 v5 方案的地基。
   * ★★ 两者都不是我断言的，是从官方的 `SlotMap` **读出来**再用**真服务**验的。
   */
  assert.equal(spec.kind, 'keyed')
  assert.equal(spec.scope, 'root')
})

test('★★ 臂 2（反向半边）：我们的 key 与官方保留 key 都注册得进去，且是两个 cell', async () => {
  const core = await slotsCore()
  core.register({ name: 'main', key: FOLDERS_MAIN_KEY }, () => 'probe')
  core.register({ name: 'main', key: RESERVED_CONVERSATION_KEY }, () => 'conversation')
  const keys = core.entriesOfSlot('main').map((entry) => entry.options.key)
  /**
   * ★★ 反向半边的**核心断言**：两者**行为不同形**。
   *   若我们的 key 注册被拒而 `conversation` 成功，那是 (c)；
   *   若两者完全一样，那说明**我们测的不是"其它 key"这件事**（测量本身是坏的）。
   * ★ 实测：**两者都注册成功**，且各占一个 cell ⇒ 槽位**真的接受**非会话 key。
   */
  assert.deepEqual(keys, [FOLDERS_MAIN_KEY, RESERVED_CONVERSATION_KEY])
  assert.notEqual(FOLDERS_MAIN_KEY, RESERVED_CONVERSATION_KEY, 'keys must be distinct cells')
})

test('★★★ 臂 3（决定性的那一步）：无会话时默认落到 conversation ⇒ 我们的 key 不被选中', async () => {
  const core = await slotsCore()
  core.register({ name: 'main', key: FOLDERS_MAIN_KEY }, () => 'probe')
  core.register({ name: 'main', key: RESERVED_CONVERSATION_KEY }, () => 'conversation')
  const keys = core.entriesOfSlot('main').map((entry) => entry.options.key)
  /**
   * ★ 官方选择器逐字（`dsh-client-ui-layout` 的 `MainPanel`）：
   *     `entryKey = usePanelInfo((info) => info.activePanelId) ?? "conversation"`
   *   ⇒ 无会话时 `activePanelId` 是 `null`（它是 store 的初值）
   *   ⇒ **`?? "conversation"` 把它折成 `conversation`**。
   */
  const pick = (activePanelId) => activePanelId ?? RESERVED_CONVERSATION_KEY
  assert.equal(pick(null), RESERVED_CONVERSATION_KEY)
  assert.notEqual(pick(null), FOLDERS_MAIN_KEY, 'without a session the default is conversation, not us')
  /* ★ 但我们的 key **确实在 cell 里** ⇒ 一旦被选中就有 occupant（⇒ 不是"注册失败"）。 */
  assert.ok(keys.includes(FOLDERS_MAIN_KEY), 'our key occupies a cell, so it IS registered')
})

test('★★ 臂 4：三态分类器 —— 缺一不可，且 (b) 与 (c) 不同形', () => {
  resetProbeCounts()
  resetProbeRegistrationError()
  /**
   * ★ (a) 我们的 key 渲染了、官方 key 没渲染 ⇒ **方案成立**。
   *   ★★ 两者的读数**不同** ⇒ `discriminates === true`（反向半边成立）。
   */
  const a = classifyMainKeyProbe({ ours: 3, reserved: 0 })
  assert.equal(a.outcome, 'appears-without-session')
  assert.equal(a.discriminates, true)
  /**
   * ★ (b) 注册成功但从未渲染 ⇒ **要退到 shell.overlay**。
   *   ★ 这是本实验的**实测结论**。
   */
  const b = classifyMainKeyProbe({ ours: 0, reserved: 1 })
  assert.equal(b.outcome, 'registered-but-hidden')
  assert.equal(b.discriminates, true, 'ours=0 vs reserved=1 still discriminates')
  /**
   * ★ (c) 注册那一步抛了 ⇒ **形状不对**（不是"不显示"，是"根本进不去"）。
   *   ★★ (b) 与 (c) **必须不同形** —— 补救动作相反：
   *      (b) 换槽位即可； (c) 换槽位也没用，要改方案。
   */
  const c = classifyMainKeyProbe({ ours: 0, reserved: 0, registrationError: 'slot rejected' })
  assert.equal(c.outcome, 'registration-failed')
  assert.equal(new Set([a.outcome, b.outcome, c.outcome]).size, 3, 'three states must be distinct')
})

test('★★ 臂 5（反向半边负向）：两者【同形】⇒ 判据自己报"测量是坏的"', () => {
  /**
   * ★ 这一条钉住**测量本身的可信度**：
   *   若我们的 key 与官方 key **行为一样**（都渲染了 / 都没渲染），
   *   那么"我们渲染了"**不承载信息** —— 一个"总是渲染任何 key"的实现也会让它为真。
   * ★⇒ `discriminates` 必须为 `false`，且那是**判据层的**结论，不是靠人看。
   */
  assert.equal(classifyMainKeyProbe({ ours: 2, reserved: 2 }).discriminates, false, 'same behaviour ⇒ cannot discriminate')
  assert.equal(classifyMainKeyProbe({ ours: 0, reserved: 0 }).discriminates, false)
  /* ★ 而"有差别的"那一侧仍然为真（证明上面不是恒假） */
  assert.equal(classifyMainKeyProbe({ ours: 1, reserved: 0 }).discriminates, true)
})

test('★★ 臂 6：接线 —— 探针真的注册进 `main`，且注册失败被【收下】而不是抛出', () => {
  const source = readFileSync(INDEX, 'utf8')
  /**
   * ★ 这一层防的是 t82/M6 形状：**函数写对了、接线忘了**。
   *   只测纯函数的话，把注册整段删掉，上面 5 条臂**依然全绿**。
   */
  assert.match(source, /name: PROBE_SLOT_NAME as 'main'/, 'the probe must register into `main`')
  assert.match(source, /key: FOLDERS_MAIN_KEY/, 'the probe must register under our own key')
  /**
   * ★★ 注册失败必须**被收下**（`noteProbeRegistrationError`），不许裸抛：
   *   抛出去会被外层 catch 吞掉 ⇒ "注册失败"与"注册了但没显示"**同形** ——
   *   而那正是三态里补救动作相反的两种。
   */
  assert.match(source, /noteProbeRegistrationError\(/, 'registration errors must be captured, not thrown away')
})

/* ══════════════════════════════════════════════════════════════════════════════
 * ── ★★★ t105 臂 7–11：调 `selectPanel` 之后真的渲染吗 ───────────────────────────
 *
 * t103 停在"注册成功但**默认不被选中**"。本节补上**最后一跳**。
 *
 * 真链条（每一环都从官方源码逐字核实）：
 *   ① `LayoutController.selectPanel(id)`：先过自己的守卫，再 `panels.selectPanel(id)`
 *   ② action：`d.panelInfo.activePanelId = panelId`
 *   ③ `MainPanel`：`entryKey = activePanelId ?? "conversation"`
 *   ④ renderer：`entriesOfSlot('main').find(e => e.options.key === entryKey)`
 *
 * ★★ 本节的臂把 ①②③④ **全拼起来跑**：`SlotCore` 是**真**的，
 *   动作与守卫**逐字照抄官方**，选择规则用**产品代码里的** `resolveEntryKey`。
 * ══════════════════════════════════════════════════════════════════════════════ */

import {
  classifySelectionOutcome, noteProbeSelection, noteProbeSelectionAccepted, noteProbeSelectionError,
  probeSelectionReadout, resetProbeSelection, resolveEntryKey, unregisteredPanelMessage,
} from '../lib/client/folders-probe.js'

/**
 * ★ 把官方那条链**照抄**成一个可跑的控制器（**不改产品代码**，只把它拼起来）。
 * ★ 每一行都注明官方出处，便于复核。
 */
async function harness() {
  const core = await slotsCore()
  /** 官方 store 初值：`panelInfo: { activePanelId: null }`（client.js:388）。 */
  const state = { activePanelId: null }
  /** 官方 action，逐字（client.js:401）。 */
  const selectPanelAction = (panelId) => { state.activePanelId = panelId }
  /** 官方守卫，逐字（client.js:595 的 `hasMainPanel`）。 */
  const hasMainPanel = (id) => core.entriesOfSlot('main').some((e) => e.options.key === id)
  /** 官方控制器语义，逐字（client.js:462-466）。 */
  const ctl = {
    selectPanel(panelId) {
      if (panelId !== null && !hasMainPanel(panelId)) {
        throw new Error(unregisteredPanelMessage(panelId))
      }
      selectPanelAction(panelId)
    },
  }
  /** 官方 renderer 的 keyed 选择，逐字（client.js:1154）+ 产品代码的 `resolveEntryKey`。 */
  const renderedKey = () => {
    const entryKey = resolveEntryKey(state.activePanelId)
    const entry = core.entriesOfSlot('main').find((e) => e.options.key === entryKey)
    return entry === undefined ? null : entry.options.key
  }
  core.register({ name: 'main', key: FOLDERS_MAIN_KEY }, () => 'probe')
  core.register({ name: 'main', key: RESERVED_CONVERSATION_KEY }, () => 'conversation')
  return { core, state, ctl, renderedKey }
}

test('★★★ 臂 7（本实验的核心）：调 selectPanel(我们的 key) ⇒ 它真的被选中并渲染', async () => {
  const h = await harness()
  /* ★ 调之前：t103 实测的那个默认仍然成立（不选 ⇒ 落 conversation） */
  assert.equal(h.renderedKey(), RESERVED_CONVERSATION_KEY)
  h.ctl.selectPanel(FOLDERS_MAIN_KEY)
  assert.equal(h.state.activePanelId, FOLDERS_MAIN_KEY, 'the action must record our id')
  /**
   * ★★ 判据：**渲染器会去找我们那个 key**，而不是 `conversation`。
   *   ⇒ ★ 这就是"最后一跳通了"的**可编程证据**。
   */
  assert.equal(h.renderedKey(), FOLDERS_MAIN_KEY, 'after selectPanel our key must be the rendered one')
})

test('★★ 臂 8（反向半边 A）：不调 selectPanel ⇒ 渲染的【不是】我们', async () => {
  const h = await harness()
  /**
   * ★★ 为什么必须测这一条：否则「**默认也渲染**」与「**调了才渲染**」**同形** ——
   *   而 t103 实测的默认是 `conversation`。
   *   ⇒ 本臂其实是在守「**我的接线没有意外改掉那个默认**」。
   */
  assert.equal(h.state.activePanelId, null, 'the store default must stay null')
  assert.equal(h.renderedKey(), RESERVED_CONVERSATION_KEY)
  assert.notEqual(h.renderedKey(), FOLDERS_MAIN_KEY, 'without selection our key must NOT be rendered')
})

test('★★ 臂 9（反向半边 B）：传未注册的 panelId ⇒ 必须抛，且报文是官方那条', async () => {
  const h = await harness()
  const bogus = 'no/such/panel'
  /**
   * ★★ 为什么这条**特别重要**：它证明我们调的是**真那个函数**，
   *   而不是"碰巧渲染了"。光看"渲染了"无法区分"我们选中的"与
   *   "某个'什么都渲染'的实现" —— 而**守卫的报文**能区分。
   */
  /**
   * ★★★ 这里**不许**用 `unregisteredPanelMessage(bogus)` 做期望值 —— 我第一版就是这么写的，
   *   而那是**恒真的**：harness 自己就是调那个函数拼报文的
   *   （`throw new Error(unregisteredPanelMessage(panelId))`）
   *   ⇒ 把它改掉时**两边一起变**，断言永远通过（实测：突变体 3 ⇒ pass 12 / fail 0）。
   * ⇒ 改成断言**官方逐字**的那条报文（`client.js:463`，独立写死在这里）。
   *   ★ 两个方向都有意义：既证明守卫存在，也证明它不是"随手编的报文"。
   */
  const OFFICIAL = 'layout.selectPanel: main panel "no/such/panel" is not registered'
  assert.throws(() => h.ctl.selectPanel(bogus), (error) => {
    assert.equal(error.message, OFFICIAL)
    return true
  })
  /* ★ 并单独钉住 `unregisteredPanelMessage` 与官方报文一致（两条独立断言，不是一条自证） */
  assert.equal(unregisteredPanelMessage(bogus), OFFICIAL)
  /* ★ 且被拒之后状态**没变**（守卫在赋值**之前**）—— 不许"抛了但已经改了一半" */
  assert.equal(h.state.activePanelId, null)
})

test('★★ 臂 10：三态不同形，且每一态各自可达', async () => {
  /* (a) 注册了 + 选了 ⇒ renders */
  const a = classifySelectionOutcome({ selected: true, registered: true })
  assert.equal(a.outcome, 'renders')
  /* (b) 注册了 + 没选 ⇒ hidden */
  const b = classifySelectionOutcome({ selected: false, registered: true })
  assert.equal(b.outcome, 'hidden')
  /* (c) 未注册 + 选了 ⇒ throws */
  const c = classifySelectionOutcome({ selected: true, registered: false })
  assert.equal(c.outcome, 'throws')
  /**
   * ★★ 三态**必须互不相同** —— 尤其 (b) 与 (c)：
   *   (b) 是"我们没事，只是没被选"（补救：把选择做出来）；
   *   (c) 是"你给了一个不存在的 panel"（补救：先注册）。
   *   合并会让"方案还没接完"与"调错了 id"变成同一句话。
   */
  assert.equal(new Set([a.outcome, b.outcome, c.outcome]).size, 3)
})

test('★★★ 臂 11（接线）：产品代码真的调了 `ctx.layout.selectPanel`，且失败不裸抛', () => {
  const raw = readFileSync(INDEX, 'utf8')
  /**
   * ★★★ **必须先剥掉注释** —— 这是我第一版的一个**真缺陷**：
   *   原来的正则 `/ctx\.layout\.selectPanel\(/` 在**注释里**也命中
   *   （本文件的 doc 注释里逐字写着 `ctx.layout.selectPanel(PANEL_ID) // ← 激活`）
   *   ⇒ 把**产品代码那一行整个删掉**，臂 11 **依然全绿**（实测：pass 12 / fail 0）。
   *   ★ 这正是本仓记账最久的形态：**"检查了"与"检查了但匹配到的是注释"** 同形。
   * ⇒ 剥注释后再匹配 ⇒ 突变体 1 立刻被检出。
   */
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//gu, '')   // 块注释
    .replace(/^\s*\/\/.*$/gmu, '')          // 行注释
  assert.match(source, /ctx\.layout\.selectPanel\(/, 'the probe must actually call selectPanel')
  /**
   * ★★ 且失败**不裸抛**：收进 `noteProbeSelectionError`。
   *   裸抛会被外层 `catch` 吞掉 ⇒ "选择被拒"与"没选"**同形**（补救动作相反）。
   */
  assert.match(source, /noteProbeSelectionError\(/, 'selection failures must be captured, not thrown away')
  assert.match(source, /noteProbeSelection\(/, 'the call itself must be recorded')
})

test('★★ 臂 12：选择阶段的三个读数各占一格（调用 / 接受 / 拒绝）', () => {
  resetProbeSelection()
  /* 初值：一次没调 ⇒ calls=0（★ 与"调了但被拒"不同形） */
  assert.deepEqual(probeSelectionReadout(), { calls: 0, accepted: 0, error: undefined })
  noteProbeSelection('x')
  noteProbeSelectionAccepted()
  assert.equal(probeSelectionReadout().accepted, 1)
  assert.equal(probeSelectionReadout().error, undefined, 'accepted ≠ rejected')
  noteProbeSelection('y')
  noteProbeSelectionError('boom')
  const after = probeSelectionReadout()
  assert.equal(after.calls, 2)
  assert.equal(after.error, 'boom', 'a rejection must be readable, not silent')
})

test('★★★ 臂 13：自动切面板必须**每个页面生命周期只切一次**（t117 → t118）', () => {
  /**
   * USER-REPORTED（两次，逐字）：
   * > 「是因为你一直在重启吗，怎么时不时就会被切到工作区那个页面，
   * >   很影响我在其他会话的工作，不应该时不时就切到工作区页面」
   * > 「为什么还是会不停地切到工作区，不要这样」
   *
   * ── ★★★ 第一版判据是【错的】，这条注释留着免得再犯 ─────────────────────────────
   *
   * t117 的判据是 `activePanelId === null` 时才切，理由写成"null ⇒ 用户不在任何面板上"。
   * 而 `dsh-client-ui-layout/lib/types/client/service.d.ts:18` 逐字：
   *   `null displays the current Conversation`
   * ⇒ **`null` 恰恰是"用户正在会话里"** —— 最常见的那种状态。
   *   守卫在最常见的场景下**恰好放行** ⇒ 等于没修 ⇒ 用户复测当场打回。
   *
   * ── ★ 正确的判据是【页面生命周期】──────────────────────────────────────────────
   *
   * 用户要的是"打开页面给我看一眼工作区，之后别再来打扰"。那件事的对象是
   * **这个浏览器标签页**，它的真值在 `sessionStorage`：
   *   · 刷新页面 ⇒ 还在（不重复切）· 关掉重开 ⇒ 空（该给的那眼还是给）
   *   · ★ **HMR 重载 ⇒ 不动它**（重载 ≠ 新的一页，这正是缺陷的成因）
   *
   * ★ 为什么不是模块级 `let firstLoad`：HMR 重载把模块状态全清 ⇒ 每次都是 true
   *   ⇒ **那正是缺陷本身**，不是解法。这条判据上我与自己的第一版相反，写下来供后人核。
   */
  const source = readFileSync(INDEX, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')

  /**
   * ★★ 反向半边之一：必须**读**这个标签页的标记，而不是读宿主的面板位置。
   *   读宿主位置是上一版失败的形态 —— 注释剥离之后这条断言能把它打红。
   */
  assert.match(
    source, /hasSelectedPanelThisPageVisit\(\)/,
    '★ 切之前必须问"这一页是否已经呈现过" —— 读宿主 activePanelId 是上一版的错（null = 正在会话里）',
  )
  /**
   * ★★ 收窄到**选择块之内**：`activePanelId` 在本文件另有两处合法用途
   *   （`:115` 的 `useLegacyPanelInfo` 桩、`:142` 的 `conversationVisible`），
   *   它们与"要不要切面板"无关。全文件级 `doesNotMatch` 会把它们一起打红 ——
   *   而那条臂就会因为一个**无关**的原因红，等于测错了东西。
   */
  const selectionBlock = /noteProbeSelection\(FOLDERS_MAIN_KEY\)([\s\S]*?)noteProbeSelectionAccepted\(\)/u.exec(source)?.[1] ?? ''
  assert.notEqual(selectionBlock, '', '★ 必须找得到那个选择块（找不到说明结构变了，本臂要重新对准）')
  assert.doesNotMatch(
    selectionBlock, /activePanelId/,
    '★★ 选择块里不许再拿 activePanelId 当守卫：null 表示"用户正在会话里"，而那是最常见的状态',
  )

  /**
   * ★★ 反向半边之二：`selectPanel` 必须在 `!hasSelected...` 的**守卫块**里。
   *   "读一下标记、然后照样无条件切" ⇒ 读数看着有、行为没变 ⇒ 用户还是被打断。
   */
  const guarded = /if\s*\(\s*!\s*hasSelectedPanelThisPageVisit\(\)\s*\)\s*\{[\s\S]*?ctx\.layout\.selectPanel\(/
  assert.match(source, guarded, '★ selectPanel 必须**只在**这一页还没呈现过时被调用')

  /**
   * ★★ 反向半边之三（防止修法退化成"永远不切"）：标记必须在**调用的同一次**里写下。
   *   只判"不切"的话，把整个块删掉也能全绿 —— 而那就把 v5 的入口功能删了。
   */
  /**
   * ★★★ 而"写了标记"必须在 `selectPanel` **之前**、在**同一个守卫块内** ——
   *   定向突变实测过：只断言 `/markPanelSelectedThisPageVisit\(\)/` 出现时，
   *   把那一行从守卫块里**挪到块外**（于是它无条件运行、`selectPanel` 却还在块内）
   *   迭代 13/13 **全绿**。★ 那是一个真缺陷：首次呈现的标记会在**没切**的情况下写下，
   *   而之后每次重载都读到它 ⇒ **这一页永远不再呈现**（功能静默消失）。
   *   ⇒ 判据收窄成"同一个守卫块里，先写标记、后切面板"。
   */
  const insideGuard = /if\s*\(\s*!\s*hasSelectedPanelThisPageVisit\(\)\s*\)\s*\{([\s\S]*?)\n    \}/u.exec(source)?.[1] ?? ''
  assert.notEqual(insideGuard, '', '★ 必须找得到那个守卫块')
  const markAt = insideGuard.indexOf('markPanelSelectedThisPageVisit()')
  const selectAt = insideGuard.indexOf('ctx.layout.selectPanel(')
  assert.notEqual(markAt, -1, '★ 标记必须在守卫块【之内】写（块外写 = 没切也记账 ⇒ 这一页永不呈现）')
  assert.ok(markAt < selectAt, '★ 先写标记、后切面板（反过来：切成功而记账失败时，下次重载会再切一次）')
  assert.match(
    source, /sessionStorage/,
    '★ 标记必须落在 sessionStorage：模块级变量会被 HMR 重载清空（那正是缺陷本身）',
  )
})
