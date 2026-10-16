/**
 * ── ★★★ t100：信箱投影必须【九格】且必须读【全部】 ─────────────────────────────────────
 *
 * MEASURED（t100 开工实测）：
 * ```
 * 信箱 jsonl 有十个字段，而快照只转出两格（from / content）⇒ ★ 丢掉八个
 * 而快照读的是 readUnreadMailbox ⇒ ★★ 一旦读过，那条就从快照里消失
 * ⇒ ★★★ 后果：对话线程会自己变短 —— 而"消息没了"与"从来没发过"同形
 * ```
 * ★★ 后者正是本仓记账最久的形态，只是换了个入口。
 *
 * ── 三条反向半边（缺一不可）────────────────────────────────────────────────
 *   臂 1（A）：一条**已读**的消息 ⇒ 仍必须在投影里
 *   臂 2（B）：**截断有明确读数**（截了几条）
 *   臂 3（C）：**空信箱**与**读不到信箱**必须不同形
 *
 * ★ 本夹具**驱动真实的 `assembleTeamSnapshot`**（不是复算它的逻辑）——
 *   所以它测的是"装上去的那份"，而不是"我以为它写了什么"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { assembleTeamSnapshot, MAILBOX_PROJECTION_LIMIT } = await import('../lib/snapshot.js')

/** 最小的 ctx：只提供 `assembleTeamSnapshot` 真正会碰的两个成员。 */
const context = () => ({ agents: { list: () => [], get: () => undefined }, logger: { warn: () => {} } })

/** 一个最小的团队记录（只填本判据读到的那些格）。 */
const teamState = (id) => ({
  id, name: `team-${id}`, description: 'd', phase: 'running',
  members: [{ id: 'm1', name: 'alice', status: 'active' }],
  tasks: [], taskSeq: 0,
})

/** 在 `stateRoot/<teamId>/inbox/captain.jsonl` 写一封信箱。 */
const writeInbox = (stateRoot, teamId, messages) => {
  const dir = join(stateRoot, teamId, 'inbox')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'captain.jsonl'), messages.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8')
}

/** 一封信箱消息（`TeamMessage` 的形状，只填必要的格）。 */
const mail = (index, overrides = {}) => ({
  id: `msg-${index}`, from: 'alice', to: 'captain', content: `body ${index}`, ts: 1000 + index,
  ...overrides,
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★★ 反向半边 A：已读的消息仍必须在投影里
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1（反向半边 A）：一条【已读】的消息 ⇒ 仍必须在投影里（不许因为读过就消失）', async () => {
  const root = mkdtempSync(join(tmpdir(), 't100-a-'))
  try {
    /**
     * ★★ 一封**已读**（`readAt` 在场）与一封**未读** —— 两封都必须在。
     *   ★ 这正是缺陷的核心：改造前读的是 `readUnreadMailbox`，
     *     于是第一封**从投影里消失**，线程自己变短。
     */
    writeInbox(root, 't1', [
      mail(1, { readAt: 2000 }),
      mail(2),
    ])
    const snapshot = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t1'))
    const ids = snapshot.captainInbox.map((message) => message.id)
    assert.deepEqual(
      ids, ['msg-1', 'msg-2'],
      '★★ 已读的那封必须仍在 —— 否则"消息没了"与"从来没发过"在界面上同形',
    )
    /** ★ 而"已读/未读"这件事**没有丢**：它如实落在 `read` 那一格。 */
    const byId = Object.fromEntries(snapshot.captainInbox.map((message) => [message.id, message]))
    assert.equal(byId['msg-1'].read, true, '★ readAt 在场 ⇒ read=true')
    assert.equal(byId['msg-2'].read, false, '★ readAt 缺席 ⇒ read=false')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：截断必须有明确读数
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：超过上限 ⇒ 必须报出【截了几条】，不许静默截断', async () => {
  const root = mkdtempSync(join(tmpdir(), 't100-b-'))
  try {
    const total = MAILBOX_PROJECTION_LIMIT + 3
    writeInbox(root, 't1', Array.from({ length: total }, (_, index) => mail(index + 1)))
    const snapshot = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t1'))
    assert.equal(snapshot.captainInbox.length, MAILBOX_PROJECTION_LIMIT, '★ 投影按上限截断')
    /**
     * ★★ 而**必须报出截了几条** —— 静默截断会让"被截掉"与"没发过"同形，
     *   而那是本任务要修的**同一个形态**（只是换了个入口）。
     */
    assert.equal(snapshot.captainInboxOmitted, 3, '★★ 截了 3 条必须报出来')
    assert.equal(snapshot.captainInboxTotal, total, '★ 而总数也要在场（两个数一起读才完整）')

    /** ★ 反向：**没有超**时那两格**缺席**（不是 0）—— "截过但没超"与"没截过"不同形。 */
    const small = mkdtempSync(join(tmpdir(), 't100-b2-'))
    try {
      writeInbox(small, 't1', [mail(1)])
      const one = await assembleTeamSnapshot(context(), small, '/tmp', teamState('t1'))
      assert.equal(one.captainInboxOmitted, undefined, '★ 没超 ⇒ 这一格【缺席】（不是 0）')
    } finally { rmSync(small, { recursive: true, force: true }) }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 C：空信箱 与 读不到信箱 必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 C）：空信箱 ⇒ 与「读不到信箱」不同形（缺席 vs 空）', async () => {
  const root = mkdtempSync(join(tmpdir(), 't100-c-'))
  try {
    /** ① **空信箱**（文件不存在）⇒ `captainInbox: []` 且那一格**缺席**。 */
    mkdirSync(join(root, 't1'), { recursive: true })
    const empty = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t1'))
    assert.deepEqual(empty.captainInbox, [], '★ 空信箱 ⇒ 空数组')
    assert.equal(
      empty.captainInboxUnreadable, undefined,
      '★★ 空信箱 ⇒ 那一格【缺席】—— "确实没有"不是"读不到"',
    )

    /**
     * ② **读不到**（存在但不可读）⇒ 必须**在场**，且**整支队伍仍然在快照里**。
     *    ★★ 改造前：读失败会把异常抛到 `collectTeamsActivity` 的 catch，
     *      于是**整支队伍从列表里消失** ⇒ "这支队读不到"与"这支队不存在"同形。
     */
    writeInbox(root, 't2', [mail(1)])
    chmodSync(join(root, 't2', 'inbox', 'captain.jsonl'), 0o000)
    const unreadable = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t2'))
    /** ★ 若以 root 运行（权限位无效）⇒ 这一半无法构造，如实跳过而不是假装通过。 */
    if (unreadable.captainInboxUnreadable === undefined && unreadable.captainInbox.length > 0) {
      console.log('    ℹ 以特权用户运行（chmod 000 无效）⇒ 本半未构造出"读不到"，如实报出')
    } else {
      assert.equal(
        typeof unreadable.captainInboxUnreadable, 'string',
        '★★ 读不到 ⇒ 那一格必须在场（且给出原因）',
      )
      assert.deepEqual(
        unreadable.captainInbox, [],
        '★ 读不到时投影为空 —— 而"空"与那一格在场**一起**才读成"没能测量"',
      )
      /** ★★ 而**整支队伍仍在**（不是消失）—— 那是本半要挡的第二个形状。 */
      assert.equal(unreadable.teamId, 't2', '★★ 读不到信箱不 license 整支队消失')
    }
    console.log('    ℹ 空信箱 ⇒ 那一格缺席（"确实没有"）；读不到 ⇒ 那一格在场（"没能测量"）')
  } finally {
    /** ★ 先恢复权限位再删（否则 rmSync 删不掉）。 */
    try { chmodSync(join(root, 't2', 'inbox', 'captain.jsonl'), 0o600) } catch {}
    rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 九格齐全 + 分组键在场（线程能分组）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：投影是【九格】，且 `taskId`（分组键）真的带出来了', async () => {
  const root = mkdtempSync(join(tmpdir(), 't100-d-'))
  try {
    writeInbox(root, 't1', [
      /** ★ 一条"按任务"的消息：它带 sourceTaskId ⇒ 它属于某条线程。 */
      mail(1, { sourceTaskId: 't7', sourceAttemptId: 'a-1', sourceTaskStatus: 'in_progress', readAt: 3000 }),
      /** ★ 一条**不属于任何任务**的消息：那三格**整个缺席**（不是空串）。 */
      mail(2),
    ])
    const snapshot = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t1'))
    const [linked, loose] = snapshot.captainInbox

    /** ★ 九格齐全（对**有**那些格的那条逐格核）。 */
    for (const key of ['id', 'from', 'to', 'content', 'ts', 'read']) {
      assert.ok(key in linked, `★ 投影必须有 ${key} 那一格`)
    }
    assert.equal(linked.taskId, 't7', '★★ sourceTaskId ⇒ taskId（那条线程的分组键）')
    assert.equal(linked.attemptId, 'a-1')
    assert.equal(linked.taskStatus, 'in_progress')
    assert.equal(linked.ts, 1001, '★ ts 必须带出来（排序与显示都要它）')

    /** ★★ 而"不属于任何任务"⇒ 那三格**整个不出现**（缺席 ≠ 空串）。 */
    assert.ok(!('taskId' in loose), '★ 不属于任何任务 ⇒ taskId 整格缺席（不是空串）')
    assert.ok(!('attemptId' in loose) && !('taskStatus' in loose), '★ 另两格同样缺席')

    /**
     * ★★★ 分组的意义：**同一 `taskId` 的消息能聚成一条线程**，而
     *   "成员来的=提问 / captain 来的=裁决"天然成对。
     *   ★ 没有这一格，UI 只能把消息摊成一条**时间线**，分不出往返。
     */
    writeInbox(root, 't2', [
      mail(1, { sourceTaskId: 't9', from: 'alice' }),
      mail(2, { sourceTaskId: 't9', from: 'captain', to: 'alice' }),
    ])
    const threaded = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t2'))
    const grouped = new Map()
    for (const message of threaded.captainInbox) {
      if (message.taskId === undefined) continue
      grouped.set(message.taskId, [...(grouped.get(message.taskId) ?? []), message.from])
    }
    assert.deepEqual(grouped.get('t9'), ['alice', 'captain'], '★★ 同一 taskId 的两条能聚成一条线程（问/答）')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 「已读」留下 · 「已丢弃」不留 —— 两者的过滤意图不同
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：已读【留下】而已丢弃【不留】 —— 两种状态的过滤意图不同', async () => {
  const root = mkdtempSync(join(tmpdir(), 't100-e-'))
  try {
    writeInbox(root, 't1', [
      mail(1, { readAt: 2000 }),        // ★ 已读 —— 必须留下（本任务要修的）
      mail(2),                          // 未读 —— 当然留下
      mail(3, { discardedAt: 3000 }),   // ★★ 已丢弃 —— 必须**不**留
    ])
    const snapshot = await assembleTeamSnapshot(context(), root, '/tmp', teamState('t1'))
    const ids = snapshot.captainInbox.map((message) => message.id)
    /**
     * ★★ 这一条钉的是**我自己引入的回归**：
     *   MEASURED：`readMailbox` 不滤 `discardedAt`（只有 `readUnreadMailbox` 滤，滤两半），
     *   而本轮把调用从后者换成前者 ⇒ 会顺手把"已丢弃"的信放出来，
     *   而它们在九格里**没有对应的格** ⇒ 与普通消息**同形**。
     *   ★ 「已读」与「已丢弃」是**两种**状态，过滤意图不同 —— 不许一起放行。
     */
    assert.deepEqual(
      ids, ['msg-1', 'msg-2'],
      '★★ 已读的要留、已丢弃的要滤 —— 两者不同形（若无本臂，'
      + '把 readMailbox 换成"读全部"会静默放出已丢弃的信）',
    )
  } finally { rmSync(root, { recursive: true, force: true }) }
})
