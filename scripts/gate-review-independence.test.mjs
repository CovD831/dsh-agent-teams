/**
 * ── 「这次审查**独立**吗」的臂（2026-10-20，补 t6）───────────────────────────────
 *
 * ── 它补的是什么（MEASURED：一个静默的兜底）────────────────────────────────────
 *
 * `schedulableAssignee` 找不到可用的人时**返回 `undefined`**，而 `makeTask` 对
 * `assignee === undefined` 是**直接不写这一格** ⇒ 那条 review 任务落进**共享池**，
 * **谁都能领，包括刚写完它的实现者**。
 *
 * ⇒ 于是「这次审查其实是自审」这件事，在读数上**不可见**。
 *   ★ 而我们在 `unmeasured` 上极严（`registry.ts` 甚至为"判据开火了但被放过"
 *     专门加了 `observedBlockers`），却在这一格没有对应读数。
 *
 * ── 三态（★ 三者不同形，这是全部理由）──────────────────────────────────────────
 *
 *   `independent`     —— 生成时指到一个不是实现者的人
 *   `not-independent` —— 审查者就是实现者，**或生成时压根没指人**
 *     ★★ 后者是一个**结论**（"独立性没有被保证"），**不是**"判不了"
 *   `undecidable`     —— 读不出实现者是谁
 *
 * ★ 参考（外部，市场调研逐字）：`portable-dsh-multi-agent-plugin` 做不到独立时
 *   **命名拒绝** `INDEPENDENCE_REQUIRED`；`dsh-switchman` 声明 `DOWNGRADED`。
 *   ★★ **两者的共同点：降级必须可读。**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { independenceOf, planQualityFollowUp } = await import(join(ROOT, 'lib', 'quality-gates.js'))

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★★★ 伪造臂）：生成时没指人 ⇒ not-independent，**不是** undecidable
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1（伪造臂）：没人可指 ⇒ not-independent（一个**结论**，不是"判不了"）', () => {
  /**
   * ★★★ 这一臂是 t6 的核心。
   *   定向突变：把这一支改成 `undecidable` ⇒ 本臂红。
   *
   * ★★ 为什么这两者必须分开：`not-independent` 的补救动作是"给这条 review 指名
   *   一个别的成员"（或接受它不独立）；`undecidable` 的补救动作是"去查那条实现
   *   为什么没有 execution"。**合并会让人去做另一件事。**
   */
  const reading = independenceOf(undefined, 'impl')
  assert.equal(reading.status, 'not-independent', '★★ 缺席的审查者是一个**结论**：独立性没有被保证')
  assert.equal(reading.implementer, 'impl', '★ 必须交出实现者是谁（否则不知道"独立谁"）')
  assert.equal(reading.reviewer, undefined, '★ 而审查者**缺席**（不是空串 —— 两者在盘上不同形）')
  assert.match(reading.why ?? '', /shared pool/, '★ 成因必须说清"会进共享池、实现者能领"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 伪造臂）：审查者就是实现者 ⇒ not-independent
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（伪造臂）：审查者 = 实现者 ⇒ not-independent', () => {
  /**
   * 定向突变：把 `if (reviewer === implementer)` 那支改成 `independent` ⇒ 本臂红。
   */
  const reading = independenceOf('impl', 'impl')
  assert.equal(reading.status, 'not-independent')
  assert.equal(reading.reviewer, 'impl')
  assert.equal(reading.implementer, 'impl')
  assert.match(reading.why ?? '', /may not review its own work/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★★ 未测量臂）：读不出实现者 ⇒ undecidable，且**与独立不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（未测量臂）：读不出实现者 ⇒ undecidable（**绝不**读成 independent）', () => {
  /**
   * ★★★ 这条防的是**恒真**：一个"审查者 ≠ 未知的人 ⇒ 独立"的实现会在
   *   **每一个读不出实现者的任务上**报 independent —— 而那正好是最需要
   *   谨慎的那一格。
   *   定向突变：把这一支改成 `independent` ⇒ 本臂红。
   */
  const unknown = independenceOf('someone', undefined)
  assert.equal(unknown.status, 'undecidable', '★★ 读不出实现者 ⇒ 判不了，**不是**"独立"')
  assert.notEqual(unknown.status, 'independent', '★★★ 一个恒真的"独立"比没有读数更坏')
  assert.equal(unknown.reviewer, 'someone', '★ 已知的那一格照常交出去')
  assert.ok((unknown.why ?? '').length > 0, '★ 成因必说清')
})

test('★★★ 臂 3b（未测量臂）：**没有审查者**且**读不出实现者** ⇒ undecidable（顺序不能反）', () => {
  /**
   * ★★ 判据的顺序是刻意的：**先判"读不出实现者"**。
   *   反过来的话，`reviewer === undefined` 会先命中 `not-independent` ——
   *   而那把"不知道独立谁"读成了"不独立"（一个**断言**，而真相是"判不了"）。
   *   定向突变：把两个 if 的先后互换 ⇒ 本臂红。
   */
  const reading = independenceOf(undefined, undefined)
  assert.equal(reading.status, 'undecidable', '★★ 两边都不知道 ⇒ 判不了，不是"不独立"')
  assert.equal(reading.reviewer, undefined)
  assert.equal(reading.implementer, undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★ 对照臂）：真的独立 ⇒ independent
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（对照臂）：审查者另有其人 ⇒ independent', () => {
  /**
   * ★ 反向半边：一个"恒 not-independent"的实现能过臂 1/2，而过不了本臂。
   */
  const reading = independenceOf('other', 'impl')
  assert.equal(reading.status, 'independent')
  assert.equal(reading.reviewer, 'other')
  assert.equal(reading.implementer, 'impl')
  assert.equal(reading.why, undefined, '★ 独立时没有"成因"可言（那一格缺席，不是空串）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★★ 接线臂）：读数**真的落进任务记录**（不是只在返回值里）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 5（接线臂）：`planQualityFollowUp` 的生成物**带着**独立性读数', () => {
  /**
   * ── 为什么必须走生成器而不是只测 `independenceOf` ─────────────────────────────
   *
   * 上面四条钉的是**谓词**（纯函数）。而谓词全绿的时候，生成器**照样可以不调它** ——
   * 那就正是"判据写了但没接线"。本仓记账过不止一次。
   * ★★ 这一条问的是**接线**：一次真实的 review 循环生成，产物上必须带那一格。
   *
   * 定向突变：把评审任务里 `reviewIndependence:` 那一行删掉 ⇒ 本臂红。
   */
  const team = (members) => ({
    id: 't', name: 'T', captainSessionId: 'c', createdAt: 1, taskSeq: 3,
    members,
    tasks: [{
      id: 'impl-1', subject: 'i', status: 'completed', dependencies: [], createdAt: 1, updatedAt: 2,
      assignee: 'impl', kind: 'implementation', inScope: ['src/a.ts'],
    }],
  })
  const closed = {
    id: 'review-1', subject: 'r', status: 'failed', dependencies: ['impl-1'], createdAt: 1, updatedAt: 2,
    assignee: 'impl', kind: 'review', verdict: 'needs_revision', round: 1, reviewedTaskId: 'impl-1',
    findings: [{ id: 'F1', severity: 'high', problem: 'x', requiredFix: 'fix x' }],
  }

  /** ① 单人团队（没人可指）⇒ 那格必须是 `not-independent`。 */
  const solo = planQualityFollowUp(team([{ id: 'm1', name: 'impl', role: 'w', joinedAt: 1, status: 'idle' }]), closed)
  const soloReview = solo.tasks.find((task) => task.kind === 'review')
  assert.ok(soloReview !== undefined, '★ 前提：这条循环真的生成了 review')
  assert.equal(soloReview.assignee, undefined, '★ 前提：没人可指 ⇒ assignee 缺席（进共享池）')
  assert.equal(
    soloReview.reviewIndependence?.status, 'not-independent',
    '★★★ 生成时没指人 ⇒ 那一格必须落 not-independent（否则这个缺口在盘上不可见）',
  )

  /** ② 有第二个成员 ⇒ 指到别人，且那格是 `independent`。 */
  const duo = planQualityFollowUp(team([
    { id: 'm1', name: 'impl', role: 'w', joinedAt: 1, status: 'idle' },
    { id: 'm2', name: 'other', role: 'w', joinedAt: 1, status: 'idle' },
  ]), closed)
  const duoReview = duo.tasks.find((task) => task.kind === 'review')
  assert.equal(duoReview?.assignee, 'other', '★ 前提：指到了别人')
  assert.equal(duoReview?.reviewIndependence?.status, 'independent', '★ 那一格必须跟着变')
  assert.notEqual(
    soloReview.reviewIndependence?.status, duoReview?.reviewIndependence?.status,
    '★★ 两种情形必须给出**不同**的读数（否则这一格测不出"在分辨"）',
  )
})
