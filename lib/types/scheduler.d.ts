/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when this process has not observed the durable owner settle its open attempt.
 * @module dsh-agent-teams/scheduler
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TeamTask } from './types.ts';
/** Per-dependency output cap in the assignment prompt. */
export declare const DEPENDENCY_OUTPUT_MAX_CHARS = 2000;
/** Combined dependency-output budget in the assignment prompt. */
export declare const DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS = 12000;
export interface SchedulerConfig {
    readonly stateDir: string;
    readonly executionPrompt?: string;
    readonly dispatch?: (captain: Agent, teamId: string, memberName: string, text: string, signal: AbortSignal, mode: 'queue' | 'steer', attemptId?: string) => Promise<boolean>;
    /**
     * 建出隔离检出时报告它的基准版本（`worktree.base`）。
     *
     * ★ 这是 R5 / 回测唯一的父版本来源。判据层在成员【汇报完成】时需要它，
     *   而那时派发已经结束 ⇒ 由调用方在这里记下来。
     *   不回调 ⇒ 判据说"我没能测量"（诚实），**不会**拿一个猜的版本去比较。
     */
    readonly onWorktree?: (taskId: string, base: string) => void;
    /**
     * ── ★ runtime 位置的接线点：一个成员【真的被派发出去】了 ─────────────────────
     *
     * 契约 `docs/GATE-REGISTRY.md` §5 给 `runtime` 写的例子正是这一条：
     * 「在成员被派发时启动 / 超时 ⇒ 产生一条记录 / 它不直接拒任务」。所以本回调
     * **只能记录**：调度器不读它的返回值，也没有可读的返回值 ⇒ 过程约束无法
     * 拒绝派发（§5 硬要求）。
     *
     * ★ 时机：投递【被接受之后】才回调。投递失败会走下面那条回滚路径（任务回
     *   pending、成员回 idle），那一次不是"派发过"；把失败也记成一次派发，会让
     *   运行判据读到一个从未发生的事件。
     */
    readonly onDispatched?: (event: {
        readonly taskId: string;
        readonly memberName: string;
        readonly memberId: string;
        readonly attempt: number;
        readonly attemptId: string;
        readonly kind: string;
        readonly worktreePath?: string;
        readonly worktreeUnavailable?: string;
    }) => void;
}
export interface TeamScheduler {
    /** Try to give every genuinely idle/ready member one unit of ready work. */
    kickTeam(workspace: string, teamId: string, captain?: Agent): Promise<void>;
    /** Try to flush fallback mail or give one member one ready task. */
    kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent): Promise<void>;
}
/** One completed recursive dependency shown to the assignee. */
export interface DependencyOutput {
    readonly id: string;
    readonly subject: string;
    readonly profileSeedId?: string;
    readonly output?: string;
}
export interface DispatchTicket {
    readonly taskId: string;
    readonly memberName: string;
    readonly memberId: string;
    readonly attempt: number;
    readonly attemptId: string;
    readonly previousAssignee?: string;
    /** True when this ticket rotates an unobserved durable open attempt. */
    readonly recoveredOwned: boolean;
    /** Original task generation, used to restore a failed automatic recovery. */
    readonly previousStatus?: 'claimed' | 'in_progress';
    readonly previousAttempt?: number;
    readonly previousAttemptId?: string;
    readonly previousResult?: Pick<TeamTask, 'output' | 'verdict' | 'findings' | 'changedPaths' | 'acceptanceResults' | 'commandsRun'>;
    readonly subject: string;
    readonly description?: string;
    readonly teamDescription?: string;
    readonly profileProtocol?: string;
    readonly profileSeedId?: string;
    readonly dependencyOutputs: readonly DependencyOutput[];
    readonly executionPrompt?: string;
    readonly kind?: string;
    readonly round?: number;
    readonly objective?: string;
    readonly inScope?: readonly string[];
    readonly outOfScope?: readonly string[];
    readonly acceptance?: readonly string[];
    readonly verify?: readonly string[];
    readonly reviewedTaskId?: string;
    /**
     * ★ 该任务的隔离工作目录（worktree 的绝对路径）。
     *   缺席 ⇒ 没有隔离 ⇒ 提示里【不】产出伪造的工作目录指令。
     */
    readonly worktreePath?: string;
    /** 该 worktree 里缺失的 gitignore 条目（如 node_modules）—— 必须告诉成员。 */
    readonly worktreeMissingIgnored?: readonly string[];
    /**
     * ── ★【未隔离】这件事本身要留下痕迹 ──────────────────────────────────────────
     *
     * 降级派发（非 git 仓库）时带着它。理由：一次 `logger.warn` 不是一条记录 ——
     * 它随进程消失，而"这个任务是在没有隔离的地方做的"是一个【关于这份工作的
     * 事实】，读日志的人（以及依赖父版本的判据）必须能看见它。
     *
     * ★ 它与 `worktreePath === undefined` 必须【不同形】：
     *   `worktreeUnavailable` 有值 ⇒ 问过 git 了，这个仓库【不支持】隔离 ⇒ 成员
     *     应当知道，且 R5/变异那类判据会因此 unmeasured；
     *   两者都缺席 ⇒ 这个任务【本来就不需要】隔离（review/requirements 这类只读任务）。
     *   把这两件事混起来，一次"环境不支持"就会伪装成"这一步不需要"。
     */
    readonly worktreeUnavailable?: string;
}
/**
 * Recursively collect `status=completed` ancestors of `taskId` in topological
 * order (dependencies before dependents). Cycles stop that branch only.
 */
export declare function collectCompletedDependencyOutputs(tasks: readonly TeamTask[], taskId: string, warn?: (message: string) => void): DependencyOutput[];
/** Format completed-dependency outputs with per-item and total truncation. */
export declare function formatDependencyOutputs(items: readonly DependencyOutput[]): string;
export declare function assignmentPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string;
/** Install one scheduler and its member activity observer. */
export declare function installTeamScheduler(ctx: Context, config: SchedulerConfig): TeamScheduler;
