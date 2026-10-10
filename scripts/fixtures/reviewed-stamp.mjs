/**
 * ── 夹具共用：一个能过 `plan-reviewed` 门的 `reviewed` 戳 ────────────────────────
 *
 * ── 为什么需要它（2026-10-10 实测）──────────────────────────────────────────────
 *
 * 八个夹具在跑 `agent_teams_create_task` 时被同一条门拒绝：
 *
 *     [dispatch.plan-reviewed] this plan has not been reviewed:
 *     no `reviewed` stamp is attached, and dispatch requires one
 *
 * ★ 而那些夹具测的**都不是**这件事 —— 它们测的是"输入面接线"、
 *   "五个位置挂没挂判据"、"requires 机制自己有没有被验证"。
 *   ⇒ 它们是被这条门**意外挡住**的（门在夹具之后上线/改行为）。
 *
 * ── ★ 时间线（可核）─────────────────────────────────────────────────────────────
 *
 *     scripts/gate-input-wiring.test.mjs     2026-10-08 00:18
 *     src/gates/dispatch/plan-reviewed.ts    2026-10-09 19:40  ← 晚于夹具
 *
 * ⇒ 这是**夹具过时**，不是机制错。处置是让夹具跟上门的契约。
 *
 * ── ★★ 为什么造一个共用件，而不是在八个文件里各写一遍 ────────────────────────────
 *
 * 那个戳的形状由 `REVIEW_QUESTION_IDS` 决定（五问逐条），而它是**判据层的导出**。
 * 八个拷贝会在"五问改名/加一问"那天分叉 —— 而分叉的表现是**八个夹具同时红**，
 * 读起来像"八个机制同时坏了"。共用件让那一格只有一处。
 *
 * ★ 而这里**不硬编码五个问题名**：从判据层 import，与 `gate-plan-reviewed.test.mjs`
 *   用的是同一个来源。改判据 ⇒ 这里自动跟上（或编译期就报错）。
 */

import { REVIEW_QUESTION_IDS } from '../../lib/gates/dispatch/plan-reviewed.js'

/**
 * 一个**五问全 pass** 的 `reviewed` 戳。
 *
 * @param overrides 可选的覆盖（夹具要测"审不过"的情形时用得上）。
 * @returns 直接可传给 `agent_teams_create_task` 的 `reviewed` 参数。
 */
export function reviewedStamp(overrides = {}) {
  return {
    at: 1_700_000_000_123,
    by: 'adversarial',
    checks: REVIEW_QUESTION_IDS.map((questionId) => ({
      id: questionId,
      verdict: 'pass',
      why: `${questionId} checked by the fixture`,
    })),
    ...overrides,
  }
}

/**
 * ★ 一句话解释这条门为什么在这里，方便下一个读到失败的人。
 *   （它出现在夹具的注释里，而不是让下一个人重新推导一遍。）
 */
export const REVIEWED_STAMP_WHY =
  'plan-reviewed 门要求 reviewed 戳；本夹具测的不是那条门，所以盖一个全 pass 的戳让它过'
