/**
 * ── S-B · 任务状态机（M4 从 `state.ts` 拆出）────────────────────────────────────
 *
 * 内容：`TASK_TRANSITIONS` 与那套「任务怎么从一态走到另一态」的动作
 * （`transitionError` / `activateTaskAttempt` / `beginTaskAttempt` /
 *  `cancelUnfinishedTask` / `invalidateTaskAttempt`，含私有 helper `clearAttemptResult`）。
 *
 * ★ 这是 M1 地图 §1 的 **S3**，落成 **S-B**（`docs/MODULE-MAP.md` 的 M4 一行）。
 * ★ **零外部依赖**：实测该块**不引用** `state.ts` 里任何其它顶层声明
 *   （脚本逐名核过），只需要 `TERMINAL_TASK_STATUSES` + `randomUUID` + 两个类型。
 *   ⇒ 搬出来不需要任何"内部耦合"的妥协。
 * ★ `state.ts` 仍**逐条再导出**它们 ⇒ 对外导出面不变（老消费者一字不改）。
 */

import { randomUUID } from 'node:crypto'
import { TERMINAL_TASK_STATUSES, type TaskStatus, type TeamTask } from '../types.ts'

/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current: TaskStatus, next: TaskStatus): string | undefined {
  if (current === next) return undefined
  if (!TASK_TRANSITIONS[current].includes(next)) {
    return `task status cannot move from "${current}" to "${next}"`
  }
  return undefined
}

/** Execution results belong to one attempt; a retry must produce its own evidence. */
function clearAttemptResult(task: TeamTask): void {
  task.output = undefined
  task.verdict = undefined
  task.findings = undefined
  task.changedPaths = undefined
  task.acceptanceResults = undefined
  task.commandsRun = undefined
}

/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task: TeamTask, assignee: string): string {
  const attemptId = randomUUID()
  task.status = 'claimed'
  task.assignee = assignee
  task.attemptId = attemptId
  task.handoffId = undefined
  task.reassigning = false
  clearAttemptResult(task)
  task.updatedAt = Date.now()
  return attemptId
}

/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task: TeamTask, assignee: string): string {
  task.attempt = (task.attempt ?? 0) + 1
  /**
   * ── ★★★ 新的一代开始 ⇒ 上一代那次投递失败【不再代表现在】（t43）──────────────
   *
   * ★ 清了它，`deliveryFailure` 在场就【一定】意味着【当前这一代没能送达】——
   *   而一条旧的失败原因与"现在仍然是坏的"必须不同形。
   *   ★ 而这里是唯一正确的清点：`attempt` 刚被推进，所以旧记录属于上一代。
   */
  delete task.deliveryFailure
  return activateTaskAttempt(task, assignee)
}

/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
/** Cancel one unfinished task without returning it to the ready pool. */
export function cancelUnfinishedTask(task: TeamTask, output?: string): void {
  if (TERMINAL_TASK_STATUSES.includes(task.status)) return
  task.status = 'cancelled'
  task.attemptId = undefined
  task.handoffId = undefined
  task.reassigning = false
  if (output !== undefined) task.output = output
  task.updatedAt = Date.now()
}

export function invalidateTaskAttempt(
  task: TeamTask,
  nextAssignee?: string,
  reassigning = false,
): void {
  task.attemptId = undefined
  task.handoffId = randomUUID()
  task.status = 'pending'
  task.assignee = nextAssignee
  task.reassigning = reassigning
  clearAttemptResult(task)
  task.updatedAt = Date.now()
}
