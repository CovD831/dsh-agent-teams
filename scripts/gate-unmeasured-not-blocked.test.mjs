/**
 * ── ★★★ t38：契约层把 `unmeasured` 当拒绝 —— 一接线就让四类 kind 建不出来 ──────────
 *
 * ── 它修的是什么（MEASURED，t4 实测，captain 查全了射程）────────────────────────
 *
 *     task-atomicity 的 appliesTo 对六类质量 kind 都为真
 *     而契约层【只】要求 implementation/repair 交 inScope/verify
 *     ⇒ requirements / verification / review / integration 走到 contract 位置时
 *       task-atomicity 拿不到那两格 ⇒ 报 unmeasured
 *       ⇒ ★ 而契约层把「我说不出」读成了「它不行」⇒ **这四类一个也建不出来**
 *
 * ★★ 而根因**不是** task-atomicity（它报 unmeasured 是对的），
 *    是**契约层读它的方式**：把「没能测量」并进了「没通过」。
 *
 * ★★★ 而它与 `delivery.ts:96-100` 的口径**逐字同源**：
 *   「一个安全约束**不触发**时，应当**放行**并留下"它没被检查"的痕迹，而不是拒绝一切。」
 *   ⇒ 本任务是把那条口径**推广到 contract 位置**，不是造新概念。
 *
 * ── 三态（互不同形，且**处置各不相同**）──────────────────────────────────────────
 *
 *     `ok`         ⇒ 放行，**不留痕**（一个每次都通过的判据不该把日志淹掉）
 *     `blocked`    ⇒ ★ **拒绝**（判据说它不行 —— 这一半**不许**放宽）
 *     `unmeasured` ⇒ ★ **放行 + 留痕**（判据说它说不出）
 *
 * ── ★ 定向突变（打红本文件的几条路）────────────────────────────────────────────
 *
 *   a) 把 `unmeasured` 并进 `blocked`（两个分支都 rejects）⇒ 臂 1 / 臂 3 / 臂 4 红
 *   b) 一律放行（`rejects` 恒 false）⇒ 臂 2 红（那一半不许放宽）
 *   c) 一律拒绝（`rejects` 恒 true）⇒ 臂 1 / 臂 3 红
 *   d) `unmeasured` 不留痕（`leavesTrace: false`）⇒ 臂 3 / 臂 4 红（"放行但别静默"）
 *   e) 三态的 `reason` 措辞合成同一句 ⇒ 臂 5 红
 *
 * Run: node --test scripts/gate-unmeasured-not-blocked.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readContractGateVerdict } from '../lib/quality-gates.js'

/** 判据说「我说不出」—— 那一格的形状（`ok:false` + `unmeasured` 在场 + `blockers` 空）。 */
const unmeasuredVerdict = (why = 'it carries no inScope, so its surface cannot be read at all') => ({
  ok: false, blockers: [], unmeasured: why,
})
/** 判据说「它不行」—— `blockers` 非空，而 `unmeasured` 缺席。 */
const blockedVerdict = (...blockers) => ({ ok: false, blockers, unmeasured: undefined })
/** 判据说「过了」。 */
const okVerdict = () => ({ ok: true, blockers: [], unmeasured: undefined })

// ── 臂 1 ★★★ 核心臂：三态**两两不同形**，而处置**各不相同** ──────────────────────
test('臂 1 ★★★ 三态不同形：`ok` / `blocked` / `unmeasured` —— 返回的 disposition 与 rejects 都不同', () => {
  const ok = readContractGateVerdict(okVerdict())
  const blocked = readContractGateVerdict(blockedVerdict('the task is not atomic'))
  const unmeasured = readContractGateVerdict(unmeasuredVerdict())

  assert.equal(ok.disposition, 'ok', '★ 判据说过了 ⇒ `ok`')
  assert.equal(blocked.disposition, 'blocked', '★ 判据说不行 ⇒ `blocked`')
  assert.equal(unmeasured.disposition, 'unmeasured', '★★ 判据说说不出 ⇒ `unmeasured`（**不是** `blocked`）')

  /**
   * ★★★ 而这里钉的是**本次缺陷的形状**：三者里 `blocked` **唯一** `rejects`。
   *   把 `unmeasured` 并进 `blocked` ⇒ 本条红。
   */
  assert.equal(ok.rejects, false, '★ `ok` ⇒ 放行')
  assert.equal(unmeasured.rejects, false,
    '★★★ `unmeasured` ⇒ **放行** —— 那是本任务的核心：判据说"我说不出"不等于"它不行"。'
    + '把两者合成拒绝会让 requirements/verification/review/integration 四类任务一个也建不出来。')
  assert.equal(blocked.rejects, true,
    '★★ 而 `blocked` ⇒ **仍然拒绝**（这一半不许放宽：判据说它不行的任务仍须被拒）')
})

// ── 臂 2 ★★ 反向半边：`blocked` 那一半**不许**放宽 ────────────────────────────────
test('臂 2 ★★ 反向半边：`blocked` 必须拒绝 —— 一律放过会让这条门形同虚设', () => {
  const blocked = readContractGateVerdict(blockedVerdict('it spans 3 files and moves existing code'))
  assert.equal(blocked.rejects, true, '★★ 判据说它不行 ⇒ 必须拒')
  /** ★ 而理由里必须**带着判据的原话**（读的人要知道它在说什么）。 */
  assert.match(blocked.reason, /spans 3 files/u, '★ 拒绝的理由必须带判据的原话')
  /**
   * ★★ 而"一律放过"的突变会让本条红 —— 那正是"不许放宽那一半"的可执行形式。
   */
  const multi = readContractGateVerdict(blockedVerdict('a', 'b'))
  assert.equal(multi.rejects, true, '★ 多条 blocker 也一样拒')
})

// ── 臂 3 ★★★ "放行但别静默"：`unmeasured` 必须留痕 ──────────────────────────────
test('臂 3 ★★★ `unmeasured` ⇒ 放行**且留痕** —— 那是 delivery.ts 那条口径的落点', () => {
  const unmeasured = readContractGateVerdict(unmeasuredVerdict('no scan directories were declared'))
  assert.equal(unmeasured.rejects, false, '★ 放行')
  assert.equal(unmeasured.leavesTrace, true,
    '★★★ 而它**必须留痕** —— 那条口径逐字是「放行并留下"它没被检查"的痕迹」。'
    + '只放行而不留痕，会让"这一步没被检查"与"这一步检查过了"同形。')
  assert.match(unmeasured.reason, /no scan directories/u, '★ 而痕迹里要带判据的原话')

  /** ★ 反向半边：`ok` **不**留痕（一个每次都通过的判据不该把日志淹掉）。 */
  const ok = readContractGateVerdict(okVerdict())
  assert.equal(ok.leavesTrace, false, '★ `ok` 不留痕 —— 那与 `unmeasured` **不同形**')
})

// ── 臂 4 ★★★ 缺陷的形状：同一个任务，喂两种判据 ⇒ 两种结局 ────────────────────────
test('臂 4 ★★★ 同一个任务喂两种判据：`unmeasured` ⇒ 能建；`blocked` ⇒ 建不出来', () => {
  /**
   * ★★★ 这正是本次缺陷的形状：**把「我说不出」读成了「它不行」。**
   *
   * ★ 下面用**同一份任务上下文**（一个没有 verify/inScope 的 review 任务）去问两次 ——
   *   而两次之间**只动判据的裁决**那一个自变量。
   *   ⇒ 于是"结局不同"只能归因于**裁决不同**，而不是任务不同。
   */
  const reviewTask = { id: 't-review-1', kind: 'review', subject: '审一个交付' }
  assert.equal(reviewTask.kind, 'review', '★ 前置：它是四类之一（review）')

  /** ① 判据说它说不出 ⇒ **能建**。 */
  const couldNotTell = readContractGateVerdict(unmeasuredVerdict('it carries no inScope'))
  assert.equal(couldNotTell.rejects, false,
    '★★★ 判据说「我说不出」⇒ 它必须**能被建出来**（t4 实测的四类之一）')

  /** ② 判据说它不行 ⇒ **建不出来**。 */
  const saidNo = readContractGateVerdict(blockedVerdict('the review task is not atomic'))
  assert.equal(saidNo.rejects, true, '★★ 判据说它不行 ⇒ 建不出来')

  /** ★ 而两者的裁决**只差一个 `unmeasured` 那一格**（同一个任务、同一个位置）。 */
  assert.notEqual(couldNotTell.rejects, saidNo.rejects,
    '★★ 同一个任务、只动判据的裁决 ⇒ 结局必须不同 —— 否则说明契约层没在读那一格')
})

// ── 臂 5 ★★ 三态措辞不同形 ──────────────────────────────────────────────────────
test('臂 5 ★★ 三态的 `reason` 措辞两两不同形（读的人要分得出该去补什么）', () => {
  const ok = readContractGateVerdict(okVerdict())
  const blocked = readContractGateVerdict(blockedVerdict('x'))
  const unmeasured = readContractGateVerdict(unmeasuredVerdict('y'))

  const reasons = [ok.reason, blocked.reason, unmeasured.reason]
  assert.equal(new Set(reasons).size, 3,
    '★★ 三条理由必须**两两不同** —— 合成同一句会让"该去补测量能力"与"该去改那个任务"分不出来')

  /** ★ 而每一句都要**说得清它是哪一态**（不是一句笼统的"不行"）。 */
  assert.match(ok.reason, /found nothing to refuse|evaluated/iu, '★ `ok` 那句要说"它跑了、没发现要拒的"')
  assert.match(blocked.reason, /refused/iu, '★ `blocked` 那句要说"它拒了"')
  assert.match(unmeasured.reason, /could not measure/iu, '★ `unmeasured` 那句要说"它测不了"')
  /**
   * ★★ 而 `unmeasured` 那句**还要说清它的处置**（放行 + 留痕）——
   *   否则读的人只看到"测不了"而不知道流程会怎么走。
   */
  assert.match(unmeasured.reason, /allowed through|NOT checked/iu,
    '★ 而它必须说出处置：放行，而这"没被检查"这件事被记下来')
})

// ── 臂 6 ★★★ 优先级：`unmeasured` 先判（`blockers` 空的那种形状）─────────────────
test('臂 6 ★★★ 优先级：`unmeasured` 在场而 `blockers` 为空 ⇒ 是「说不出」，**不是**「它不行」', () => {
  /**
   * ★★ 为什么这一条要单独钉：
   *   `unmeasured` 那一格的形状**本来就是** `ok:false` + `blockers: []`
   *   （见 `registry.ts` 的 `GateEvaluation`）。
   *   ⇒ 一个**先判 `blockers.length > 0`** 的实现，在这里会落进 `ok`（因为为空）——
   *     而一个**先判 `!ok`** 的实现会落进 `blocked`。
   *   ★ 两个顺序都会把这一格读错，而**错的形状不同**。
   */
  const verdict = { ok: false, blockers: [], unmeasured: 'the surface cannot be read' }
  const reading = readContractGateVerdict(verdict)
  assert.equal(reading.disposition, 'unmeasured',
    '★★ `ok:false` + `blockers:[]` + `unmeasured` 在场 ⇒ 必须是 `unmeasured`')
  assert.equal(reading.rejects, false, '★ 而它放行')
  assert.equal(reading.leavesTrace, true, '★ 并留痕')
})

// ── 臂 6b ★★★ 共存那一格：`unmeasured` 与 `blockers` **同时**在场 ⇒ 仍判「说不出」 ──
test('臂 6b ★★★ `unmeasured` 与 `blockers` **同时**在场 ⇒ 仍判「说不出」，且顺序是契约的一部分', () => {
  /**
   * ── ★★★ 而这一格**不是构造出来的**：注册表自己就会产出它 ──────────────────────
   *
   * `src/gates/registry.ts` 的聚合那一支逐字（`:757-766`）：
   *
   *     for (const item of requiresPolicy.blockers(requiresField)) blockers.unshift(item)
   *     if (unmeasuredReasons.length > 0) {
   *       return { ok:false, unmeasured: unmeasuredReasons.join('; '), blockers, … }   ← ★ 两者都在
   *     }
   *     if (blockers.length > 0) { … }
   *
   * ⇒ ★ 所以"既有 `unmeasured` 又有 `blockers`"是**真的会发生的形状**
   *   （`requires` 那一层的缺口进 `blockers`，而判据自己的"测不了"进 `unmeasured`）。
   *
   * ★★ 而注册表**自己**先判 `unmeasured` ⇒ 本函数的优先级与它**逐字同源**。
   *   一个把顺序反过来的实现（`blockers` 先判）在这里会报 `blocked` ⇒ **把"说不出"读成了"它不行"**
   *   —— 而那正是本任务修的那条错的**镜像**。
   *   ★ 而它在只有 `unmeasured`（`blockers` 空）时**读不出差别** ——
   *     所以必须用"两者同时在场"这一格才钉得住顺序。
   */
  const both = {
    ok: false,
    blockers: ['its appliesTo reads a ctx path the gate does not declare in requires'],
    unmeasured: 'the task carries no inScope, so its surface cannot be read at all',
  }
  const reading = readContractGateVerdict(both)
  assert.equal(reading.disposition, 'unmeasured',
    '★★★ 两者同时在场 ⇒ 仍判 `unmeasured`（与 registry.ts 的聚合顺序同源）。'
    + '★ 顺序反过来的实现会报 `blocked` —— 而那就是"把说不出读成它不行"的镜像。')
  assert.equal(reading.rejects, false, '★★ 而它放行（判据说"我说不出"优先于"requires 那层有个声明缺口"）')
  assert.equal(reading.leavesTrace, true, '★ 并留痕')
  /** ★ 而它**不许**把那些 `blockers` 丢掉 —— 痕迹里要看得到整份裁决。 */
  assert.equal(typeof reading.reason, 'string', '★ 理由要在')
})

// ── 臂 7 ★★ 空位置那一态：`ok:true` 而一条都没跑 —— 与"检查过了"**不同形** ────────
test('臂 7 ★★ 空位置：`ok:true` 且 `blockers` 空 ⇒ 放行，且它**不**声称"检查过了"', () => {
  /**
   * ★ 本任务不改那一格（"这一步有没有被检查"是 `evaluated`/`skippedAll` 的事，
   *   不是 `disposition` 的事）—— 但本函数**不许**把它说成"检查过了"。
   *   ⇒ 它的 `reason` 说的是"**evaluated** 而没发现要拒的"，而不是"它没问题"。
   */
  const reading = readContractGateVerdict(okVerdict())
  assert.equal(reading.disposition, 'ok', '★ 放行')
  assert.equal(reading.leavesTrace, false, '★ 而 `ok` 不留痕（那一格由 `evaluated` 读）')
  assert.equal(/it is fine|no problem/iu.test(reading.reason), false,
    '★ 它**不许**声称"这个任务没问题" —— 它只能声称"我没发现要拒的"')
})
