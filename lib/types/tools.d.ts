/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type TeamState, type TeamTask } from './types.ts';
export { steerCaptainReport } from './members.ts';
/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
    /** State directory name under the captain's workspace. */
    stateDir: string;
    /** Member subagent provider name. */
    memberProvider: string;
    /** Optional member model override. */
    memberModel?: string;
    /** Prompt injected into member personas and assignments. */
    executionPrompt?: string;
    /** Plugin fallback route. */
    fallback?: import('./profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap. */
    memberMaxDepth?: number;
    /** Team size cap (members). */
    maxMembers: number;
    /** Named team profiles from the active DSH profile. */
    profiles: Record<string, import('./profiles.ts').TeamProfileConfig>;
    /**
     * ── ★ 时钟（t5）：探活判据唯一的读数来源 ─────────────────────────────────────
     *
     * 契约 §2 性质 1 说判据是纯数据变换、**I/O 与时钟由调用方注入**。所以
     * `src/gates/runtime/liveness.ts` 里没有 `Date.now()`，它读的是 ctx 里的
     * `wait.now` —— 而那个值来自这里。
     *
     * ★ 缺省 `Date.now` 是**生产**的缺省，不是夹具的。夹具注入假时钟才能在不真等
     *   10 分钟的情况下构造"两次探活之间成员一点产出都没有"。
     *   **一个测不了超时的探活判据等于没有探活** —— 而不注入时钟就只剩真等这一条路。
     *
     * ★ 不注入 ⇒ 判据按自己的契约报 unmeasured（缺 `now`），**不是**退回系统时钟。
     *   偷偷退回 `Date.now` 会让"夹具以为自己在控制时间"与"判据读了真实时间"
     *   在日志里同形 —— 那种缺陷只在跨零点或长会话里出现。
     */
    now?: () => number;
}
/** Browser/UI mutations allowed while a plan is waiting for approval. */
export type StagedPlanMutation = {
    action: 'update_member';
    memberName: string;
    role?: string | null;
    provider: string;
    model: string;
    reasoningEffort?: string | null;
    executionPrompt?: string | null;
} | {
    action: 'update_task';
    taskId: string;
    subject: string;
    description?: string | null;
    assignee?: string | null;
    dependencies: string[];
} | {
    action: 'add_task';
    subject: string;
    description?: string | null;
    assignee?: string | null;
    dependencies: string[];
} | {
    action: 'remove_task';
    taskId: string;
} | {
    action: 'remove_member';
    memberName: string;
};
/** Runtime bridge shared by model-facing tools and the Web staging surface. */
export interface AgentTeamsRuntime {
    isPendingMember(agent: Agent): boolean;
    updateStagedPlan(captain: Agent, teamId: string, mutation: StagedPlanMutation, signal?: AbortSignal): Promise<TeamState>;
    updateStagedPlanBatch(captain: Agent, teamId: string, mutations: readonly StagedPlanMutation[], signal?: AbortSignal): Promise<TeamState>;
    approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{
        teamId: string;
        members: number;
        tasks: number;
    }>;
    continueStagedPlanning(captain: Agent, teamId: string): Promise<{
        teamId: string;
        alreadyWaiting: boolean;
    }>;
    discardStagedTeam(captain: Agent, teamId: string): Promise<{
        teamId: string;
    }>;
}
/** 派发时登记基准；判据层在完成时读它。 */
export declare function rememberWorktreeBase(taskId: string, base: string): void;
export declare function haltTeamWork(input: {
    ctx: Context;
    stateRoot: string;
    teamId: string;
    captain: Agent;
    signal?: AbortSignal;
}): Promise<{
    teamName: string;
    cancelledTasks: number;
    alreadyHalted: boolean;
}>;
/** Web approval has no tool result in the captain's conversation. */
export declare function stagedPlanApprovedContext(teamName: string): string;
/** Context queued after the human rejects a staged plan. */
export declare function stagedPlanDiscardContext(teamName: string): string;
/** Model-facing continuation that turns the review UI back into a conversation. */
export declare function stagedPlanFeedbackContext(teamName: string): string;
/** 运行记录的快照（控制台/夹具读它；返回副本，调用方改不动内部状态）。 */
export declare function runtimeGateLogSnapshot(): ReadonlyArray<{
    at: number;
    event: string;
    outcome: string;
}>;
/**
 * 等待记录的快照（控制台/夹具读它；返回**深**副本）。
 *
 * ★ 与 {@link runtimeGateLogSnapshot} 同形态，理由也同：进程级状态必须有只读出口，
 *   否则夹具只能通过"跑一次探活、看它说了什么"来间接推断内部状态 —— 而那正是
 *   最容易被夹具自己写错的一层（"我以为它在记录里"与"记录里真的有"同形）。
 */
export declare function waitRecordSnapshot(): ReadonlyArray<{
    teamId: string;
    taskId: string;
    memberName: string;
    attemptId: string;
    startedAt: number;
    lastActivityAt?: number;
    lastPollAt?: number;
    lastOutputKey?: string;
    activityCount: number;
}>;
/** 清空等待记录（★ 只给夹具用：进程级状态会跨用例残留，而残留会让"第一次探活"变形）。 */
export declare function resetWaitRecords(): void;
export declare function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): AgentTeamsRuntime;
export declare function applyQualityFollowUp(team: TeamState, closed: TeamTask): {
    created: TeamTask[];
    escalated: boolean;
};
