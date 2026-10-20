/**
 * ── 会话预算读数的臂（2026-10-20，补 t4）─────────────────────────────────────────
 *
 * ── 它补的是什么（MEASURED：插件推荐的动作必然失败）────────────────────────────
 *
 * 成员一旦 spawn 过，会话**永不重建**（`src/tools.ts` 逐字：
 * 「已生成会话的成员**永远不会再跑** `spawnMember`」），而重派走的是
 * `deliverToMember(…, member.id, …)` ⇒ **新任务进同一个已死的会话**。
 * ★ 对照：`self-iteration-3` 三个成员全部 `CONTEXT_WINDOW_EXCEEDED`。
 *
 * ── 三态 × 三态 ───────────────────────────────────────────────────────────────
 *
 *   读：`read` / `unmeasured` / `not-started`
 *   判：`ok` / `full`（拒绝）/ `unknown`（**不拒绝但留痕**）
 *
 * ★★ 最贵的一格：`unknown` **绝不并进** `ok` ——
 *   一个静默放行的 unknown 与 ok 同形，而那正是"重撞死"能一直发生的原因。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { judgeSessionBudget, contextWindowOf, sessionBudgetThresholdOf } = await import(join(ROOT, 'lib', 'members.js'))

const read = (peak) => ({ status: 'read', totalTokens: peak * 10, peakInputTokens: peak, steps: 100 })
const WINDOW = 1_000_000
const THRESHOLD = 0.85

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 伪造臂）：已经满了 ⇒ full（调用方据此拒绝）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（伪造臂）：会话已超阈值 ⇒ full，且成因说清"重派也没用"', () => {
  /**
   * 定向突变：把 `ratio >= threshold` 改成 `false` ⇒ 本臂红。
   */
  const verdict = judgeSessionBudget(read(912_117), WINDOW, THRESHOLD)
  assert.equal(verdict.verdict, 'full')
  assert.match(verdict.why ?? '', /never recreated/, '★★ 成因必须说清"会话永不重建" —— 否则读的人会去重派')
  assert.ok((verdict.ratio ?? 0) > 0.9, '★ 比例要交出去（"超了多少"是可行动的）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 未测量臂）：不知道窗口 ⇒ unknown，**绝不并进 ok**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（未测量臂）：**不知道窗口** ⇒ unknown（不是 ok）', () => {
  /**
   * ★★★ 这一格是本文件存在的理由。
   *   一个"拿不到窗口就当没满"的实现会让**每一次配置缺失**都伪装成通过。
   *   定向突变：把 `window === undefined` 那一支改成 `{ verdict: 'ok' }` ⇒ 本臂红。
   */
  const verdict = judgeSessionBudget(read(912_117), undefined, THRESHOLD)
  assert.equal(verdict.verdict, 'unknown', '★★ 不知道窗口 ⇒ 判不了，**不是**"没满"')
  assert.notEqual(verdict.verdict, 'ok', '★★★ 静默放行的 unknown 与 ok 同形')
  assert.match(verdict.why ?? '', /AGENT_TEAMS_CONTEXT_WINDOW/, '★ 成因必须说清**怎么配**')
  assert.match(verdict.why ?? '', /912117/, '★ 而它照旧把已知的用量报出来')
})

test('★★★ 臂 2b（未测量臂）：**读不到用量** ⇒ unknown，且措辞与臂 2 **不同**', () => {
  /**
   * ★ 两种 unknown 成因不同（"我知道用量、不知道窗口" vs "我连用量都不知道"），
   *   因为补救动作不同。定向突变：把这一支改成 `ok` ⇒ 本臂红。
   */
  const a = judgeSessionBudget({ status: 'unmeasured', reason: 'ENOENT' }, WINDOW, THRESHOLD)
  const b = judgeSessionBudget(read(1000), undefined, THRESHOLD)
  assert.equal(a.verdict, 'unknown')
  assert.notEqual(a.why, b.why, '★★ 两种"判不了"的成因措辞必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 对照臂）：还有空间 ⇒ ok
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（对照臂）：远低于阈值 ⇒ ok（反向半边）', () => {
  /**
   * ★ 一个"恒 full"的实现能过臂 1，而过不了本臂。
   */
  const verdict = judgeSessionBudget(read(300_000), WINDOW, THRESHOLD)
  assert.equal(verdict.verdict, 'ok')
  assert.ok(Math.abs((verdict.ratio ?? 0) - 0.3) < 0.001, '★ 比例要准确')
  assert.equal(verdict.why, undefined, '★ ok 时没有"成因"可言（那一格缺席）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★★ 那条"恒真"的反面）：用 peak 比，**不用**累计量比
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4：阈值比的是 **peakInputTokens**，不是累计 totalTokens', () => {
  /**
   * ── 为什么这一臂非有不可 ────────────────────────────────────────────────────
   *
   * `totalTokens` 是**累计**消耗（含缓存重读）—— 实测队长会话 **4.03 亿**，
   * 而窗口是 100 万。★ 拿它去比阈值会把**每一个跑过几轮的成员**都判成"满了"
   * ⇒ 那是一条**恒真**的判据（`full` 会在任何真实队伍上永远为真）。
   *
   * 定向突变：把 `readout.peakInputTokens` 改成 `readout.totalTokens` ⇒ 本臂红。
   */
  const heavy = { status: 'read', totalTokens: 403_347_892, peakInputTokens: 300_000, steps: 1222 }
  const verdict = judgeSessionBudget(heavy, WINDOW, THRESHOLD)
  assert.equal(
    verdict.verdict, 'ok',
    '★★★ 累计 4 亿、而峰值只 30 万 ⇒ 必须判 ok。拿累计量比阈值会让这条判据恒真',
  )
  assert.ok((verdict.ratio ?? 1) < 0.5, '★ 比例必须来自 peak（0.3），不是累计量')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 闸门臂）：窗口与阈值都是**可注入的**，缺省不猜
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：窗口缺省 ⇒ 不报比例；阈值可注入且有缺省', () => {
  /**
   * 定向突变：让 `contextWindowOf` 在缺省时返回一个写死的 1000000 ⇒ 本臂红。
   */
  assert.equal(contextWindowOf({}), undefined, '★ 没配 ⇒ **不猜**（拿不到就不报比例）')
  assert.equal(contextWindowOf({ AGENT_TEAMS_CONTEXT_WINDOW: '200000' }), 200_000)
  assert.equal(contextWindowOf({ AGENT_TEAMS_CONTEXT_WINDOW: 'abc' }), undefined, '★ 非法值 ⇒ 判不了，不猜')
  /** ★ 阈值同一条纪律：可注入 + 有缺省 + 非法值退回缺省。 */
  assert.ok(sessionBudgetThresholdOf({}) > 0, '★ 缺省阈值在场')
  assert.equal(sessionBudgetThresholdOf({ AGENT_TEAMS_SESSION_BUDGET_THRESHOLD: '0.5' }), 0.5)
  assert.equal(
    sessionBudgetThresholdOf({ AGENT_TEAMS_SESSION_BUDGET_THRESHOLD: '2' }),
    sessionBudgetThresholdOf({}),
    '★ 越界的阈值 ⇒ 退回缺省（不是"用 2 当比例"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★ 边界臂）：没起来过的成员 ⇒ ok（它不可能有消耗）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：`not-started` ⇒ ok（**可判定的事实**，不是"判不了"）', () => {
  /**
   * ★ `id === ''` ⇒ 它没起来过 ⇒ 不可能有消耗 —— 与 `unmeasured` 不同形
   *   （同 `memberLiveness` 的 `never-spawned` 口径）。
   */
  const verdict = judgeSessionBudget({ status: 'not-started' }, undefined, THRESHOLD)
  assert.equal(verdict.verdict, 'ok', '★ 没起来过 ⇒ 不拦（它不是"判不了"）')
  assert.equal(verdict.why, undefined)
})
