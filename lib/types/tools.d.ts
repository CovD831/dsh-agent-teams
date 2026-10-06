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
/**
 * ── ★★ 父版本的解析：内存 → 落盘 → 明确说"没有"（t18）─────────────────────────────
 *
 * MEASURED（point-dev 定位；无 worktree 的任务恒不可收口）：`baseline` 原本只由
 * {@link worktreeBaseOf} 推 —— 一个**内存 Map**，只在派发建出 worktree 时写入。
 * ⇒ 两类任务恒拿不到父版本，而它们是**不同的两件事**：
 *
 *   (i)  **没有 worktree**（在主树干活的、captain 接管的）⇒ 从未登记过；
 *   (ii) **进程重启** ⇒ 内存 Map 清空（★ 与"旧模块"同族）。
 *
 * ── 解析顺序（captain 裁定 C+D）────────────────────────────────────────────────
 *
 *   ① 内存里有 ⇒ 用它（派发那一刻亲眼拿到的，最新鲜）；
 *   ② 内存里没有、但任务记录里有 `baseRevision` ⇒ 用它（C：**记下来的事实**）；
 *   ③ 两者都没有 ⇒ 返回 `absent`，且**带上成因**（D：明确说"没有"，不猜一个）。
 *
 * ★ 为什么 ③ 必须带成因、且两种成因不同形：
 *   本队纪律「unmeasured 的不同成因不应同形」。`no-worktree` 是"**这类任务本就
 *   没有父版本可归因**"（无隔离 ⇒ 无从比较）；`not-recorded` 是"**我本该有却丢了**"
 *   （进程重启 / 内存态丢失）。前者接近"不适用"，后者是一条**要去看一眼的信号** ——
 *   合成一个 undefined，读日志的人分不出"设计如此"与"我们丢了一个事实"。
 *
 * ★ 绝不回退成 HEAD：HEAD 可能**已经含了本次改动** ⇒ "改动前"与"改动后"同版本
 *   ⇒ 回测恒绿（本队记账的恒真写法）。伪造的基准会让"在错误的基础上比较"
 *   读成"比较过了"。
 */
export type BaseRevisionResolution = {
    kind: 'resolved';
    revision: string;
    from: 'memory' | 'record';
} | {
    kind: 'absent';
    reason: 'no-worktree' | 'not-recorded';
};
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
/**
 * ── ★★ 「本进程持有的模块是不是旧的」—— 一个**可检测、可上报**的读数（t23）────────
 *
 * ── 它修的是什么（MEASURED，本轮五次拦截）──────────────────────────────────────
 *
 * 本队今晚被同一个东西拦了 **5 次**（t14 / t17 / t19 / t22 / t23 开工），而每一次
 * 的**表面理由都不同**：
 *
 *     · dispatch.changed-paths 说"你虚报改动"
 *     · completion.backtest    说"基准不可得"
 *     · claim_task             说"依赖未满足"
 *
 * ⇒ 而真相只有一个：**进程加载的是构建前的模块**。
 *   ★ 形态：**一个机制级的失效，伪装成一条业务规则**。成员看到判据拒绝会去查代码、
 *     去查数据、去怀疑自己的申报 —— 而不是去重载。这个伪装是它最贵的地方：
 *     它把成本从"重载一次"转成了"每一轮都重新误诊一次"。
 *
 * ── 为什么 ESM 让这件事必然发生（机制级解释，不是现象描述）───────────────────────
 *
 * `import { f } from './state.ts'` 建立的是**命名绑定**，它在**模块求值时**建立，
 * 之后**永远指向同一个函数对象**。⇒ 盘上的 `.js` 被 `pnpm build` 覆盖之后，
 * 进程里那个函数**还是旧的** —— 因为函数的**闭包环境**也是旧的。
 *
 * ★ 所以"每次调用时求值"这句话**不精确**：函数体确实每次跑，但它**本身**是从旧模块
 *   实例拿来的。⇒ **任何静态 import 的东西都不会更新**，不只是 schema 类。
 *
 * ── 本读数回答什么、不回答什么（边界必须写清）──────────────────────────────────
 *
 *   回答：**该不该重载**（stamp 不一致 ⇒ 重载）。
 *   **不**回答：哪一段是旧的。
 *      （后者需要模块图内省，做不干净；而 5 次拦截里真正需要的判断是前者。）
 *   ★ 已知边界：即使 stamp 一致，也可能有段落是旧的（见上面对 ESM 的解释）。
 *     这一格**测不了** —— 把它写成边界，而不是假装覆盖了它（本队纪律）。
 *
 * ── ★ 三态，且「读不到」与「一致」必须不同形 ────────────────────────────────────
 *
 *   `unknown`     —— 读不到 stamp（还没 build / 文件被删 / 解析失败）⇒ **没能测量**
 *   `current`     —— 读到了，且与加载时一致
 *   `stale`       —— 读到了，且与加载时**不一致** ⇒ 明确报"请重载"
 *
 * ★ 把 `unknown` 读成 `current` 会让"我没能检查"伪装成"检查过了，是新的" ——
 *   而那正是本任务要消灭的那个形态的又一次出现。
 */
export type ModuleFreshness = {
    status: 'current';
    loaded: string;
    onDisk: string;
} | {
    status: 'stale';
    loaded: string;
    onDisk: string;
} | {
    status: 'unknown';
    loaded?: string;
    reason: string;
};
/**
 * 这个进程持有的模块是新的还是旧的。
 *
 * ★ **不参与裁决**：它是部署状态的读数，判据不许因为它拒绝（先软后硬）。
 *   调用方把它挂在**记录**上（人读得到），而不是并进 `blockers`。
 */
export declare function moduleFreshness(): ModuleFreshness;
/**
 * 一句人话（供工具记录与控制台读）。
 *
 * ★ 措辞必须**不用**业务语气：不能读起来像"你的申报有问题"。
 *   它要说的是"**这个进程该重载了**" —— 那正是它要消灭的那个伪装。
 */
export declare function moduleFreshnessMessage(freshness?: ModuleFreshness): string;
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
    lastPolledActivityAt?: number;
    lastOutputKey?: string;
    activityCount: number;
}>;
/**
 * 等待**窗口**的快照（与 `waitRecordSnapshot` 同形态：进程级状态必须有只读出口）。
 *
 * ★ 它回答的是"这个任务这一次等待从哪里开始、上次何时被探活" —— 与记录表
 *   （"这一代读到过什么"）是**两个作用域**。夹具要分辨"换代没重置窗口"，
 *   唯一的办法就是把这两张表都读出来。
 */
export declare function waitWindowSnapshot(): ReadonlyArray<{
    teamId: string;
    taskId: string;
    memberName: string;
    startedAt: number;
    lastPollAt?: number;
    lastPolledActivityAt?: number;
    touchedAt: number;
}>;
/** 清空等待记录（★ 只给夹具用：进程级状态会跨用例残留，而残留会让"第一次探活"变形）。 */
export declare function resetWaitRecords(): void;
export declare function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): AgentTeamsRuntime;
export declare function applyQualityFollowUp(team: TeamState, closed: TeamTask): {
    created: TeamTask[];
    escalated: boolean;
};
