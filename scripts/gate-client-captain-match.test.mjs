/**
 * ── 客户端认队长的臂（2026-10-21，裁决 ②）──────────────────────────────────────
 *
 * ── 它钉的是什么 ──────────────────────────────────────────────────────────────
 *
 * 服务端已经收口成 `sessionLeadsTeam`（`src/lineage.ts`，19 处调用）——
 * 它沿 `parentSession` 走 **fork 链**，于是"队长在自己的 fork 里继续"仍认得出。
 *
 * ★★ 而**客户端拿不到那条链**：`liveRefsOf(ctx)` 需要 `ctx.agents`，
 *   而客户端只有 team 记录与成员子代理的 `parentSession`
 *   （后者是**成员**的，不是队长会话的）。
 *   ⇒ (甲)「客户端也走 fork 链」在这里**结构上做不到**。
 *
 * ⇒ 裁决 ② 选的是 **(乙)**：客户端**如实**只做精确匹配，并把这个边界**写进代码**。
 *   ★ 因为静默漏认的后果是：面板把"队长 fork 之后"的队显示成"不属于任何人"，
 *     而**没有任何读数**能发现这件事。
 *
 * ── 三态（本夹具的全部内容）────────────────────────────────────────────────────
 *
 *   精确命中        ⇒ 返回那个队
 *   fork 之后        ⇒ `undefined`（★ **判不了**，不是"不属于"）
 *   halted 的队      ⇒ `undefined`（那是**另一个**理由：队停了）
 *
 * ★ 定向突变：把 `team.captainSessionId === owner` 改成恒 `true` ⇒ 臂 1 与臂 3 同时红。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { liveCaptainTeam } = await import(join(ROOT, 'lib', 'client', 'activity-model.js'))

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 对照臂）：精确命中 ⇒ 返回那个队
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（对照臂）：队长会话 id 精确相等 ⇒ 返回那个队', () => {
  const teams = [{ captainSessionId: 'cap-1', halted: false }, { captainSessionId: 'cap-2' }]
  const found = liveCaptainTeam(teams, 'cap-1')
  assert.equal(found?.captainSessionId, 'cap-1')
  /** ★ 反向半边：另一个队**不得**被返回 —— 否则这条臂测不出"在分辨"。 */
  assert.equal(liveCaptainTeam(teams, 'cap-2')?.captainSessionId, 'cap-2')
  assert.equal(liveCaptainTeam(teams, 'cap-3'), undefined, '★ 谁也不匹配 ⇒ undefined')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 边界臂）：fork 之后 ⇒ undefined，而那是**已知且显式**的
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2：**fork 之后**认不出 ⇒ undefined（判不了，不是"不属于"）', () => {
  /**
   * ── 这一条是裁决 ② 的全部内容 ────────────────────────────────────────────────
   *
   * ★★ 它**不是**一条"我们做到了"的臂 —— 它是一条**把已知边界钉住**的臂。
   *   它存在的理由是：**下一个人会想"顺手"让客户端也走 fork 链**，
   *   而在客户端那件事**结构上做不到**（拿不到 `ctx.agents`）。
   *   ⇒ 那条"顺手"会造出一个**看起来支持 fork、而冷链时静默失败**的东西。
   *
   * ★ 若哪天服务端把 fork 解析结果**投影**到客户端（一份已有的读数），
   *   这一条会**按设计变红** —— 那时正确动作是改它，并写明"现在支持了"。
   *   而不是让它一直绿着而代码已经变了。
   */
  const teams = [{ captainSessionId: 'cap-1', halted: false }]
  assert.equal(
    liveCaptainTeam(teams, 'cap-1-forked-session'),
    undefined,
    '★★★ 客户端只做精确匹配 —— fork 之后认不出，而这是**显式**的已知边界',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 独立理由臂）：halted 的队也不返回 —— 与"fork 认不出"**不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3：`halted` 的队不返回 —— 那是**另一个**理由（队停了，不是认不出）', () => {
  /**
   * ★ 两种 `undefined` 的成因不同：
   *   · fork 之后  ⇒ **判不了**（客户端没有那条链）
   *   · halted     ⇒ **判得了，而答案是"不要用这个队"**
   *   ⇒ 合成一个会让读的人去查错方向。
   */
  const halted = [{ captainSessionId: 'cap-1', halted: true }]
  assert.equal(liveCaptainTeam(halted, 'cap-1'), undefined, '★ halted ⇒ 不返回')
  /** ★ 而同一个队不 halted 时**必须**返回 —— 否则上一条可以靠"恒不返回"通过。 */
  assert.equal(
    liveCaptainTeam([{ captainSessionId: 'cap-1', halted: false }], 'cap-1')?.captainSessionId,
    'cap-1',
    '★ 同 id、不 halted ⇒ 必须返回（否则本条测不出"在分辨 halted"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 空输入臂）：空 id / 空名单 ⇒ undefined（不是崩）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4：空 sessionId / 空名单 ⇒ undefined（不崩、也不误命中）', () => {
  const teams = [{ captainSessionId: 'cap-1' }]
  assert.equal(liveCaptainTeam(teams, undefined), undefined, '★ 没有会话 id ⇒ 无从匹配')
  assert.equal(liveCaptainTeam(teams, '   '), undefined, '★ 全空白 ⇒ 同上（trim 之后为空）')
  assert.equal(liveCaptainTeam([], 'cap-1'), undefined, '★ 空名单 ⇒ 没有可返回的')
})
