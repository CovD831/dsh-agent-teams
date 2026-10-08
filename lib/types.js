/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */
/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'];
export const DELIVERY_OUTCOMES = [
    'delivered_blocked',
    'not_delivered',
    'gate_fault',
];
export const TASK_KINDS = [
    'requirements',
    'implementation',
    'verification',
    'review',
    'repair',
    'integration',
    'work',
];
/**
 * ── ★★★ 哪些 kind 会被派发到一个【隔离的 worktree】────────────────────────────
 *
 * ★ 这是**唯一的一份真值**，两个读者从它取，而不是各自写一遍：
 *
 *     · `src/scheduler.ts` 的 `needsWorktree` —— **建不建**树（派发那一刻）
 *     · `src/tools/shared/entities.ts` 的 `resolveBaseRevision` —— 判"没有基准"
 *       是**按设计没有**还是**本该有却丢了**
 *
 * ── 为什么必须只有一份（MEASURED，本队记账最久的形态）──────────────────────────
 *
 * 两处各写一份 `kind === 'implementation' || kind === 'repair'` 会**分叉**，
 * 而分叉之后 `判据说它该有、而调度器从没建过` 在日志里同形 —— 那正是本任务修的那一格：
 *
 *     调度器：非 implementation/repair ⇒ 从不建树 ⇒ 基准**从来没有**存在过
 *     判据  ：`attempt > 0` 而没有基准 ⇒ 读成"本该有却丢了" ⇒ **拒绝**
 *     ⇒ ★ 任何非 implementation/repair 的任务，只要被重派过一次，就**再也交不上终态**
 *     ⇒ 而它被拒的理由，描述的原因**从来没有发生过**
 *
 * ★ 放在 `types.ts` 而不是别处，是因为它是**叶子模块**（不 import 任何东西），
 *   而 `scheduler.ts` 与 `tools/shared/entities.ts` **都已经** import 它
 *   ⇒ 两边共用它不会造出新的 import 环（环会让"改一个工具牵动另一个"，本仓库禁止）。
 *
 * ★ 它与 `completion.backtest` 的 `baselineAbsent` **一一对应**（判据不发明新词汇）：
 *     非本集合的 kind ⇒ `'no-worktree'` ⇒ 判据**报告而不拒绝**（环境不是工作的问题）
 *     本集合的 kind   ⇒ `'not-recorded'` ⇒ 判据**仍然拒绝**（本该有的丢了，要有人看）
 */
export const KINDS_NEEDING_WORKTREE = ['implementation', 'repair'];
/** 这个 kind 会不会被派发到隔离 worktree（⇒ 它有父版本可对照）。 */
export function needsWorktreeFor(kind) {
    return kind !== undefined && KINDS_NEEDING_WORKTREE.includes(kind);
}
export const REVIEW_VERDICTS = ['pass', 'needs_revision', 'reject'];
export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'blocker'];
