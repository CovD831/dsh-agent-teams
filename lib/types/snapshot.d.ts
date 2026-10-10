/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */
import type { Context } from '@deepseek-ai/cordis';
import { type MemberLiveness, type StrandedWorktrees } from './members.ts';
import { type MemberStatus, type TeamState } from './types.ts';
/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled';
/** One member row of the activity snapshot. */
export interface TeamActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly executionPrompt: string;
    readonly status: MemberStatus;
    readonly activity: 'working' | 'idle' | 'unknown';
    /**
     * ── ★★★ t4：会话存活读数（与 `activity` **并列**，不是它的替代）──────────────
     *
     * `activity` 回答的是「这个驱动此刻忙不忙」；这一格回答的是「**还有没有**那个
     * 驱动」。MEASURED（DISPATCH-RULES §39）：后者缺席时，`activity` 会读成
     * `idle`（驱动不见 ⇒ `ready` ⇒ 面板画成"闲着"）—— 而"闲着"与"那个会话已经
     * 没了、它的产物冻在 worktree 里"在面板上**同形**。
     *
     * ★ 两格不合并的理由与顶层 `status` 那处逐字相同：它们要人做的动作不同
     *   （"忙不忙" ⇒ 等；"还活着吗" ⇒ 去抢救）。
     */
    readonly liveness: MemberLiveness['state'];
    readonly livenessReadout: MemberLiveness['readout'];
    /** ★ 未能测量时的成因（`could-not-measure` 时在场）。 */
    readonly livenessReason?: string;
    /** ★ 名下有在飞任务而会话已不在 ⇒ 有一份工作悬在半空。 */
    readonly stranded: boolean;
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    readonly unread: number;
}
/** One task row of the activity snapshot. */
export interface TeamActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly description: string;
    readonly status: string;
    readonly state: VisualTaskState;
    readonly assignee: string;
    readonly model: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    readonly kind?: string;
    readonly round?: number;
    readonly verdict?: string;
    /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
    readonly updatedAt: number;
}
/** One captain-inbox preview row. */
export interface TeamActivityMessage {
    readonly from: string;
    readonly content: string;
}
/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly phase: 'staged' | 'running';
    readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback';
    readonly halted?: boolean;
    readonly members: readonly TeamActivityMember[];
    readonly tasks: readonly TeamActivityTask[];
    /**
     * ── ★★★ t4：残留 `working` 的**后果面**（DISPATCH-RULES §39.2）───────────────
     *
     * t39 的树 12 个文件未提交（含 300 行改动），而"按 working 当它在跑而等着"
     * ⇒ 那些改动永远冻在那儿。这一格就是那句后果的出口。
     * ★ `clear` 与 `could-not-measure` **必须不同形**（见 `StrandedWorktrees`）。
     */
    readonly strandedWork: StrandedWorktrees;
    readonly messageCount: number;
    readonly captainInbox: readonly TeamActivityMessage[];
}
/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
    /** Historic review must retain members that were marked removed at shutdown. */
    readonly includeRemoved?: boolean;
    /** Archived teams have no meaningful live activity after their sessions stop. */
    readonly historic?: boolean;
}
/** Compact `provider/model` route for the activity panel, or just the model. */
export declare function memberModelRoute(member: {
    provider?: string;
    model?: string;
} | undefined): string;
/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export declare function assembleTeamSnapshot(ctx: Context, stateRoot: string, workspace: string, state: TeamState, options?: TeamSnapshotOptions): Promise<TeamActivitySnapshot>;
/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export declare function collectTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export declare function collectArchivedTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
