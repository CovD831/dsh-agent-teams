#!/usr/bin/env node
/**
 * ── 判据：lead 身份沿【活的 fork 链】解析，且成员**永不**被认成 lead（t98）───────────
 *
 * ── 它防的是什么（上游 `38a84b9` 逐字）────────────────────────────────────────────
 *
 * > 「team identity now resolves through the durable fork chain … so a captain that
 * >   continues in its fork **still leads its team**」
 *
 * ★ 今天的行为是**精确 id 相等**（`team.captainSessionId === <会话 id>`）。
 *   而队长**在自己的 fork 里继续**时那个 fork 是**另一个会话 id**
 *   ⇒ ★★ **它认不出自己带的队**。
 *
 * ── ★★★ 而本文件最要紧的一条是反向半边 B ─────────────────────────────────────────
 *
 * 上游逐字警告：
 * > 「a member is a subagent child of its captain, **so its parent chain also
 * >   contains the captain and must never be read as lead identity**.
 * >   ★ Only a **top-level** conversation may inherit lead identity from an ancestor.」
 *
 * ★★ ⇒ 若判据只看"祖先里有没有队长"，**每个成员都会被算成队长**
 *   ⇒ 那一格的后果不是"多认了一个"，而是**谁都是队长**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { leadIdentityOf, sessionLeadsTeam, isLeadSession } = await import('../lib/lineage.js')

/** 造一份活会话清单：`{ id: parent }` ⇒ `LiveSessionRef[]`（顶层不给 parent）。 */
const live = (map) => Object.entries(map).map(([id, parent]) => (parent === undefined ? { id } : { id, parentSession: parent }))

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 1：★★ 反向半边 A —— **fork 出来的队长仍认得到它带的队**（核心修复）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 1（反向半边 A）：fork 出来的会话 ⇒ 仍能认到它带的队', () => {
  /**
   * ★ 形状：`CAP` 是队长；`FORK` 是它 fork 出来的会话（`FORK.parentSession === CAP`）。
   *   ★★ 今天 `FORK !== CAP` ⇒ **认不出来**（= 上游那句 "stops matching the team it leads"）。
   */
  const team = { captainSessionId: 'CAP', memberIds: [] }
  const sessions = live({ CAP: undefined, FORK: 'CAP' })

  const identity = leadIdentityOf('FORK', team, sessions)
  assert.equal(identity.kind, 'lead',
    '★ 一个**队长 fork 出来的**会话必须仍被认成 lead —— 这正是 #176 要修的那一格。'
    + `实测 ${identity.kind}：${identity.reason ?? ''}`)
  assert.equal(identity.viaSessionId, 'CAP',
    '★ 它是**沿链认到 CAP** 的（`viaSessionId` 必须是 CAP，而不是 FORK 自己）')
  assert.equal(identity.hops, 1, '★ 隔了 1 跳（读的人据此知道"这就是队长的那一代"）')

  /** ★ 而收口用的布尔版本也必须给出 true（9 处调用点用的是它）。 */
  assert.equal(sessionLeadsTeam('FORK', team, sessions), true,
    '★ `sessionLeadsTeam` 是同一条判断的布尔收口 —— 两处不许分叉')
})

test('★★ 臂 2（多级 fork）：`FORK2 → FORK → CAP` ⇒ 隔两代也认得到', () => {
  /**
   * ★ 上游逐字：「including a cold parent chain and **multi-level forks**」。
   *   ★ 我们**不支持冷链**（见臂 6），但**多级活链必须支持** —— 那是它的另一半。
   */
  const team = { captainSessionId: 'CAP', memberIds: [] }
  const sessions = live({ CAP: undefined, FORK: 'CAP', FORK2: 'FORK' })

  const identity = leadIdentityOf('FORK2', team, sessions)
  assert.equal(identity.kind, 'lead', `★ 隔两代也必须认得到（实测 ${identity.kind}）`)
  assert.equal(identity.hops, 2, '★ 跳数必须是 2（不是 1，也不是 0）')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 3：★★★ 反向半边 B —— **成员不许被认成 lead**（本文件最要紧的一条）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★★ 臂 3（反向半边 B）：成员会话的父链**也含队长** ⇒ 但**不许**被认成 lead', () => {
  /**
   * ★★ 这正是上游警告的那个形状：`MEM.parentSession === CAP` ——
   *   **成员的父链里也有队长**。若判据只看"祖先里有没有队长"，这里会给出 `lead`。
   *   ⇒ 后果不是"多认了一个"，而是**每个成员都是队长**。
   */
  const team = { captainSessionId: 'CAP', memberIds: ['MEM'] }
  const sessions = live({ CAP: undefined, MEM: 'CAP' })

  const identity = leadIdentityOf('MEM', team, sessions)
  assert.equal(identity.kind, 'not-lead',
    '★★ 成员**永远不是** lead —— 即使它的父链里含队长。'
    + `实测 ${identity.kind}：${identity.reason ?? ''}`)
  assert.notEqual(identity.kind, 'lead',
    '★★★ 若这里给 lead，那 9 处收口会让**每个成员都能以队长身份行事**')

  /** ★ 而布尔收口也必须给 false（两处不许分叉）。 */
  assert.equal(sessionLeadsTeam('MEM', team, sessions), false, '★ `sessionLeadsTeam` 同步为 false')
  assert.equal(isLeadSession('MEM', team, sessions), false, '★ `isLeadSession` 同步为 false')
})

test('★★ 臂 4（成员判据的**精确性**）：`memberIds` 用**精确相等** ⇒ "fork 出来的成员"不算成员', () => {
  /**
   * ★ 上游同一条纪律：「Membership **keeps** its exact id match」——
   *   **成员身份的判定不做 fork 解析**。
   *   ★ 所以一个"fork 出来的成员会话"（`MFORK.parentSession === MEM`）：
   *     · 它**不在** `memberIds` 里 ⇒ 不是成员
   *     · 但它也**不是**自上而下的顶层会话继承 ⇒ **落到 `not-lead`**
   *   ⇒ ★ 那是**对的**：它既不该以成员身份进队，也不该以队长身份行事。
   */
  const team = { captainSessionId: 'CAP', memberIds: ['MEM'] }
  const sessions = live({ CAP: undefined, MEM: 'CAP', MFORK: 'MEM' })

  const identity = leadIdentityOf('MFORK', team, sessions)
  assert.equal(identity.kind, 'not-lead',
    '★ 一个"fork 出来的成员"既不是成员、也不是队长 ⇒ 必须是 not-lead。'
    + `实测 ${identity.kind}`)
  /** ★ 关键：它**不许**因为"沿链会走到 CAP"而被认成 lead（那一支必须被成员判据挡住）。 */
  assert.equal(sessionLeadsTeam('MFORK', team, sessions), false,
    '★★ 它的祖先里**有** CAP，但它不是自上而下的顶层继承 ⇒ 不许继承 lead 身份')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 5：★ 既有行为**必须保留**：自己就是队长 ⇒ lead（`hops === 0`）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 5（不许改语义）：会话**自己**就是队长 ⇒ lead，且 `hops === 0`', () => {
  /**
   * ★ 本任务是**加**一条通向 lead 的路，**不是**换掉原来那条。
   *   ⇒ 原来成立的（自己就是队长），现在仍必须成立。
   *   ★ 没有这一臂，"我把 == 换成链解析"可能**顺手改掉**既有语义，而没人发现。
   */
  const team = { captainSessionId: 'CAP', memberIds: [] }
  const sessions = live({ CAP: undefined })
  const identity = leadIdentityOf('CAP', team, sessions)
  assert.equal(identity.kind, 'lead', '★ 自己就是队长 ⇒ 必须仍是 lead（既有行为）')
  assert.equal(identity.hops, 0, '★ `hops === 0` 标记"就是它自己"，而不是沿链认到的')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 6：★★ 反向半边 C —— 父会话**不驻留** ⇒ `unmeasured`（不是 not-lead）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 6（反向半边 C）：父会话**不驻留** ⇒ 必须 `unmeasured`，不许静默当成 not-lead', () => {
  /**
   * ★★ 这是本任务**刻意划下的边界**：上游靠 `sessionPersistence.stat` 读**存储的**父链，
   *   而那个东西**我们拿不到**（实测 0 命中）。
   *   ⇒ 一个不驻留的父会话 ⇒ 我们**说不出**它是不是队长。
   *   ★ 判"不是队长"会让「**测不了**」与「**确实不是**」**同形**。
   */
  const team = { captainSessionId: 'CAP', memberIds: [] }
  /** ★ `ORPHAN.parentSession === GONE`，而 `GONE` **不在**活清单里。 */
  const sessions = live({ ORPHAN: 'GONE' })

  const identity = leadIdentityOf('ORPHAN', team, sessions)
  assert.equal(identity.kind, 'unmeasured',
    '★ 链断在一个不驻留的会话上 ⇒ 必须 `unmeasured`（不是 `not-lead`）。'
    + `实测 ${identity.kind}`)
  assert.notEqual(identity.kind, 'not-lead',
    '★★ 静默判成 `not-lead` 会让"冷链测不了"与"它确实不是队长"**同形** —— '
    + '而那正是本仓记账最久的形态')
  /** ★ 而 `reason` 必须**说清是哪一环断的**（不许只说"测不了"）。 */
  assert.match(String(identity.reason), /GONE/,
    '★ `unmeasured` 必须点名**断在哪一环**（不然读的人不知道该去查谁）')
  assert.match(String(identity.reason), /sessionPersistence/,
    '★ 而它必须点名**根因**（缺 `sessionPersistence`）—— 否则那是一条没有出口的读数')
})

test('★ 臂 7：顶层会话（**在清单里**、父为空）⇒ `not-lead`（可判定，与臂 6 不同形）', () => {
  /**
   * ★★ 臂 6 与臂 7 是**必须分开的一对**：
   *   · 父**为空且在清单里** ⇒ 链**走到了头** ⇒ `not-lead`（可判定）
   *   · 父**不驻留**            ⇒ 链**断了** ⇒ `unmeasured`（判不了）
   *   ★ 若两者都给 `not-lead`，"到底了"与"断了"**同形**。
   */
  const team = { captainSessionId: 'CAP', memberIds: [] }
  const sessions = live({ LONER: undefined })

  const identity = leadIdentityOf('LONER', team, sessions)
  assert.equal(identity.kind, 'not-lead',
    '★ 顶层会话（没有父）是一个**可判定**的链头 ⇒ `not-lead`')
  assert.ok(sessions.some((ref) => ref.id === 'LONER'),
    '★ 前置：它**在**活清单里（这正是与臂 6 的区别 —— 那边断在清单外）')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 8：★★ `unmeasured` 的退让策略是**显式**的（不许静默）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 8：`unmeasured` ⇒ `sessionLeadsTeam` 按**显式策略**退让（不许静默当 false）', () => {
  const team = { captainSessionId: 'CAP', memberIds: [] }
  const sessions = live({ ORPHAN: 'GONE' })

  /** ★ `'exact'`（缺省）：回退到**今天的行为** = 精确相等 ⇒ ORPHAN ≠ CAP ⇒ false。 */
  assert.equal(sessionLeadsTeam('ORPHAN', team, sessions, 'exact'), false,
    '★ `exact` 策略下退回到精确相等（ORPHAN ≠ CAP ⇒ false）')
  /** ★ 而**若 subject 恰好就是队长**，`exact` 策略必须给 true —— 否则"退让"变成了"误拒"。 */
  const orphanIsCap = live({ CAP: 'GONE' })
  assert.equal(sessionLeadsTeam('CAP', team, orphanIsCap, 'exact'), true,
    '★ `exact` 策略的关键：**当 subject 就是队长时，即使链断了也必须放行** —— '
    + '否则冷链会让**队长自己**失去自己的队（那比原缺陷更坏）')
  /** ★ `'false'` 策略：不放行（另一个调用点可能这么选）。 */
  assert.equal(sessionLeadsTeam('ORPHAN', team, sessions, 'false'), false,
    '★ `false` 策略 ⇒ 不放行')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 9：★ 前提臂 —— **环**不许让函数永不返回
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 9（前提）：父链成环 ⇒ 不许永不返回（走满上限 ⇒ `unmeasured`）', () => {
  /**
   * ★ 会话图理论上可以有环（数据被手改过），而**无上限的 while 在环上会永不返回**。
   *   ★ 而本函数在**调度器的热路径**上 ⇒ 转圈比失败更坏（t89 的 `ATTEMPTS = 64`
   *     为同一取舍记过一笔）。
   */
  const team = { captainSessionId: 'CAP', memberIds: [] }
  const sessions = live({ A: 'B', B: 'A' })
  const identity = leadIdentityOf('A', team, sessions)
  assert.equal(identity.kind, 'unmeasured',
    '★ 成环 ⇒ `unmeasured`（**不是**永不返回，也不是 `not-lead`）')
  assert.match(String(identity.reason), /cycle|did not terminate/,
    '★ 而它必须说明"可能是环"，而不是一句笼统的"测不了"')
})
