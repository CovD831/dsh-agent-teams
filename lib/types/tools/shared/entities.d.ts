import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
/**
 * ★ t53：规则表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 *   ★ 方向不会成环：`verify-command.ts` 只 import `registry.ts` / `requires.ts`，
 *     它不知道 tools 层存在。
 *   ★ 而校验与读盘分开是刻意的：读不到是**调用方**的事实（`absent`），
 *     形状坏是**数据本身**的事实（`malformed`）—— 两者不同形，由两个地方各自判。
 */
import { type RulesLoad } from '../../gates/contract/verify-command.ts';
import type { GatePoint } from '../../gates/index.ts';
import { installMemberSelectionRuntime } from '../../members.ts';
import type { AcceptanceResult, ReviewFinding } from '../../types.ts';
import type { CommandResult, TeamMember, TeamState, TeamTask } from '../../types.ts';
import { CAPTAIN_KEY } from '../../state.ts';
export declare function withInputSurfaceOnError<T extends {
    execute: (...args: never[]) => unknown;
}>(tool: T): T;
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
    fallback?: import('../../profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap. */
    memberMaxDepth?: number;
    /** Team size cap (members). */
    maxMembers: number;
    /** Named team profiles from the active DSH profile. */
    profiles: Record<string, import('../../profiles.ts').TeamProfileConfig>;
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
export declare function requireCaptain(exec: ToolRunContext): Agent;
export declare function workspaceOf(agent: Agent): string;
export declare const VERIFY_COMMAND_TIMEOUT_MS = 120000;
/**
 * ── ★★★ 规则表的**运行时**读取（t53）────────────────────────────────────────────
 *
 * ★ 为什么读盘这一件事必须在这里（而不是判据里）：
 *
 *   判据**不许 import 任何 I/O**（`scripts/verify-gates-integration.test.mjs` ④
 *   逐行检查 import 子句）⇒ 它只能拿到调用方交进去的东西。
 *   ⇒ 于是"改数据 ⇒ 立刻生效"这件事的**成立条件**就是：**调用方每次调用时读**。
 *
 * ★★ 而这正是那个三分类里**唯一**兑现"不必重载"的一类：
 *
 *     改【跑着的代码】（.ts 的逻辑）        ⇒ 要 build + 重载
 *     改【被内联进 lib 的数据】（静态 import）⇒ ★ 要 build + 重载（只省了"懂 TS"）
 *     改【运行时读盘的数据】（这里）        ⇒ ★ 不 build、不重载
 *
 *   MEASURED（t53）：静态 `import rules from './….json'` 在本仓库连编译都过不去
 *   （`TS1543 … requires a 'type: "json"' import attribute when 'module' is NodeNext`）；
 *   即便打开 `resolveJsonModule`，JSON 也会被 `tsc` 内联进 `lib/` ⇒ 改数据仍要 build。
 *   ★ 所以中间那一类**看起来像数据**，而它在运行时与代码同命。
 *
 * ★ 四态**互不同形**（`parseRules` 判后两者，这里判前两者）：
 *     loaded / absent（读不到）/ malformed（形状坏）/ empty（空表）
 *   ⇒ 后三者会让判据降级成 `unmeasured` —— **绝不静默退化成"没有规则"**。
 */
export declare function loadVerifyCommandRules(workspace: string): Promise<RulesLoad>;
export declare function runVerifyCommand(workspace: string, command: string): Promise<number>;
export declare const taskWorktreeBase: Map<string, string>;
export declare function worktreeBaseOf(taskId: string): string | undefined;
export type BaseRevisionResolution = {
    kind: 'resolved';
    revision: string;
    from: 'memory' | 'record';
} | {
    kind: 'absent';
    reason: 'no-worktree' | 'not-recorded';
};
export declare function resolveBaseRevision(task: {
    id: string;
    attempt?: number;
}): BaseRevisionResolution;
export declare function runInDetachedRevision(options: {
    workspace: string;
    revision: string;
    command: string;
}): Promise<number | undefined>;
export declare function deriveCoverageInput(options: {
    workspace: string;
    testFiles: readonly string[];
    knownTests: readonly string[];
}): Promise<Record<string, unknown> | undefined>;
export declare function runVerifyCommandCaptured(workspace: string, command: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}>;
export declare function readWorkspaceFileSync(workspace: string, relativePath: string): string;
export declare function writeWorkspaceFileSync(workspace: string, relativePath: string, contents: string): void;
export declare function deriveScanDirs(changedFiles: readonly string[]): string[] | undefined;
export declare function changedLineNumbers(workspace: string, base: string | undefined): Promise<number[] | undefined>;
export declare function mergeRerunIntoCommandsRun(claimed: readonly CommandResult[] | undefined, reruns: readonly CommandResult[]): CommandResult[];
export declare function stateRootOf(workspace: string, config: ToolsConfig): string;
export declare function teamLockKey(stateRoot: string, teamId: string): string;
export declare function captainLockKey(stateRoot: string, captainId: string): string;
export declare function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState>;
export declare function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState>;
export type ParticipantIdentity = {
    kind: 'captain';
    name: typeof CAPTAIN_KEY;
} | {
    kind: 'member';
    name: string;
};
export declare function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined;
export declare function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState>;
export declare function requireFreshCaptainTeam(stateRoot: string, teamId: string, captainId: string): Promise<TeamState>;
export declare function requireFreshParticipant(stateRoot: string, teamId: string, callerId: string): Promise<{
    team: TeamState;
    identity: ParticipantIdentity;
}>;
export declare function requireMember(team: TeamState, name: string): TeamMember;
export declare function requireTask(team: TeamState, taskId: string): TeamTask;
export declare function trimmedOptional(value: string | null | undefined): string | undefined;
export declare function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined;
export declare function taskDetails(team: TeamState, task: TeamTask): string;
export declare function captainOpenTask(team: TeamState, exceptTaskId?: string): TeamTask | undefined;
export declare function stopTeamMemberActivations(ctx: Context, captain: Agent, members: readonly TeamMember[], signal?: AbortSignal): Promise<void>;
export declare const RUNTIME_GATE_LOG_LIMIT = 50;
export declare const runtimeGateLog: Array<{
    at: number;
    event: string;
    outcome: string;
}>;
/**
 * ── ★★ f-0026：三态里【两维各自可读】，不合成一个布尔 ────────────────────────────
 *
 * 这两维测的**不是同一件事**（本任务硬要求：两个都要，且各自可读）：
 *
 *   `output` 维（t23 起）：盘上自本进程启动以来，有没有被 rebuild 过？  —— 「内容变没变」
 *   `commit` 维（本任务）：本进程加载的是哪个 commit 的代码？            —— 「代码落后没落后」
 *
 * ★ 合成一个布尔会让 `{output 同, 提交落后}` 这种组合**消失** —— 而那正是
 *   f-0026 的全部内容：进程启动前盘上就是当前版 ⇒ 旧读数恒报 current。
 *
 * ★ `stale` 带一个可选的 `behind` / `aheadOf`（提交），**不是**可选的措辞：
 *   只说"旧了"仍然要人去猜从哪旧起，而那个猜测正是误诊开始的时刻。
 */
export type ModuleFreshness = {
    status: 'current';
    loaded: string;
    onDisk: string;
    commit?: string;
    head?: string;
} | {
    status: 'stale';
    loaded: string;
    onDisk: string;
    commit?: string;
    head?: string;
    behind?: string;
    why: 'content' | 'commit' | 'both';
} | {
    status: 'unknown';
    loaded?: string;
    onDisk?: string;
    commit?: string;
    head?: string;
    reason: string;
};
export declare const BUILD_STAMP_FILE = "git-artifact-stamp.json";
/** stamp 里与 git 有关的那一格。★ 缺省缺席（旧 stamp）⇒ `undefined`，不是空串。 */
export interface BuildStamp {
    schema?: unknown;
    output?: unknown;
    commit?: unknown;
}
export declare function readStamp(root: string): BuildStamp | undefined;
export declare function readStampOutput(root: string): string | undefined;
/**
 * ── ★★ 「构建时的提交」从 stamp 读；「当前 HEAD」在【调用时】读 ─────────────────────
 *
 * ★ f-0025「按取值时机区分」的可执行形式：
 *
 *     「构建时的提交」 —— **常量**。它随 stamp 落盘，进程加载后不会变 ⇒ 加载时读一次即可。
 *     「当前 HEAD」    —— **每次调用都可能变**的量 ⇒ 必须在**调用时**重新取。
 *
 * ★ 把后者也做成"加载时读一次"，它就退化成与 `output` 同一个问句 ——
 *   而"答的是另一个问题"正是 f-0026 要修的那一格。
 */
export declare function stampCommitOf(stamp: BuildStamp | undefined): string | undefined;
/**
 * 读【此刻】的 HEAD。取不到 ⇒ `undefined`（**不是**空串）。
 *
 * ★ 三种"取不到"必须都是 `undefined`，而**成因写进 reason**（由调用方区分）：
 *   不是 git 仓库 / git 不可用 / 仓库还没有任何提交（`HEAD` 未出生）。
 *   ★ 而它与"读到了但内容为空"不同形 —— 后者不是一个合法 sha，也走不到这里。
 */
export declare function currentHead(root?: string): string | undefined;
/**
 * ── ★★ 新鲜度的【全部输入】都注入进来 —— 于是它可以被夹具精确驱动 ────────────────
 *
 * ★ 这条与 `r5` / `mutation` / `backtest` 同一纪律：判据本身是纯数据变换，
 *   I/O 由调用方注入。★ 而它有一个额外好处：**"取值时机"可以被测**——
 *   同一份 `loaded` 配两个不同的 `head`，必须给出两个不同的读数（臂 15）。
 */
export interface FreshnessInput {
    /** 进程加载时读到的 stamp（常量，只读一次）。 */
    loaded?: BuildStamp;
    /** 此刻盘上的 stamp。 */
    onDisk?: BuildStamp;
    /** 此刻的 HEAD。★ 由调用方在**调用时**取。 */
    head?: string;
}
export declare function moduleFreshnessFrom(input: FreshnessInput): ModuleFreshness;
export declare function moduleFreshness(): ModuleFreshness;
/** ★ 加载时读一次的整份 stamp —— 「构建时的提交」是常量，与 `output` 同一时机。 */
export declare let LOADED_STAMP: BuildStamp | undefined;
export declare let LOADED_STAMP_READ: boolean;
export declare function loadedStamp(): BuildStamp | undefined;
export declare function pluginRoot(): string;
export declare function moduleFreshnessMessage(freshness?: ModuleFreshness): string;
export declare function freshnessLine(): string;
export type RestartArbitration = 
/** 两个前置都满足 ⇒ 可以重载。 */
{
    allowed: true;
    reason: 'verdict-passed-and-no-work-in-flight';
}
/** 判决未通过（或被声明为未通过）⇒ 新代码对不对没有结论，不许换。 */
 | {
    allowed: false;
    blockedBy: 'no-passing-verdict';
    detail: string;
}
/** 有工作在跑 ⇒ 重载会打断它。 */
 | {
    allowed: false;
    blockedBy: 'work-in-flight';
    detail: string;
    inFlight: string[];
};
export declare function arbitrateRestart(input: {
    /** ★ 前置一：一份**已经通过**的判决。`false` / 缺席都表示"没有可用的结论"。 */
    verdictPassed: boolean;
    /** ★ 前置二：当前全部任务（只读它们的 `status` 与 `id`）。 */
    tasks: ReadonlyArray<{
        id: string;
        status: string;
    }>;
}): RestartArbitration;
export declare function restartArbitrationMessage(arbitration: RestartArbitration): string;
export declare const RESTART_ESCAPE_HATCH_ENV = "AGENT_TEAMS_RESTART_ESCAPE_HATCH";
export declare function restartEscapeHatchFromEnv(value: string | undefined): boolean;
export declare function arbitrateRestartWithEscape(input: Parameters<typeof arbitrateRestart>[0], escapeHatchOpen: boolean): RestartArbitration | {
    allowed: true;
    reason: 'escape-hatch';
    bypassed: string;
};
export declare function judgeRuntimeGates(event: string, outcome: string): void;
export declare const WAIT_RECORD_LIMIT = 200;
export interface WaitRecord {
    readonly teamId: string;
    readonly taskId: string;
    readonly memberName: string;
    readonly attemptId: string;
    /**
     * ── ★ V3-2：等待窗口的起点，**跨代继承** ────────────────────────────────────
     *
     * MEASURED（2026-10-06，verifier3 / t3）：`agent_teams_status` 每次都会 `kickTeam`，
     * 而 kick 会给一个非 `working` 的成员 `beginTaskAttempt` **换新一代 capability**。
     * 于是每次探活看到的都是一个**刚出生**的等待：`startedAt = 现在`、
     * `previousPollAt` 缺席 ⇒ 「两次探活之间它动过没有」这个前提**在真实路径上不成立**，
     * 探活退化成"每次都报第一次"。实测三次探活，记录从 1 条变 2 条、`startedAt`
     * 从 1600000 跳到 2200000。
     *
     * ⇒ 修法：`startedAt`（**窗口起点**）由"这个任务的等待从哪里开始"决定，
     *   而不是由"这一代 attempt 什么时候被创建"决定。换代时**继承上一代的起点**，
     *   于是窗口跨代连续，"两次探活之间"重新有意义。
     *
     * ★ 与"键用 attemptId"的关系（两者不矛盾，分工不同）：
     *   · **键**仍然是 `attemptId`（capability 是身份，换代就是另一次尝试）；
     *   · **窗口起点**是任务的属性，跨代继承。
     *   把键换成 taskId 才是错的（reassign 之后旧起点会留在原地），
     *   而把【起点】随换代重置同样错 —— 两个方向都会让读数不属于它声称的那段等待。
     *
     * ★ 继承是**有界**的：只在同一 (teamId, taskId) 上继承，且只在上一代记录仍在
     *   表里时继承（LRU 淘汰之后退回本代派发时刻 —— 那时"窗口从哪开始"确实无据可依，
     *   而这比编一个起点诚实）。
     */
    readonly startedAt: number;
    /**
     * ── ★ 最近一次【观察到产出】的时刻 ─────────────────────────────────────────
     *
     * `undefined` 表示**还没有观察到任何产出**，它必须在形状上与"观察到了一次产出"
     * 不同 —— 判据据此分辨"这个成员一直在动"与"这个成员压根没动过"。
     *
     * ★★ 为什么不能从会话事件里读：**会话事件没有时间戳**。
     *
     * MEASURED（2026-10-06，与本队开工前实测一致）：`dsh-session` 的
     * `assistant/message` 事件只有 `message.content`，**没有 `at` / `ts`**。
     * 所以"最后活动时刻"**不是读出来的，是记下来的** —— 在【观察到产出的那一刻】
     * 由我方取一次时钟。这正是契约 §5 那句"runtime 可以带状态"。
     *
     * ⇒ 它的含义精确地是："**我们最后一次看见它说话**是在什么时候"。
     *   这与"它最后一次说话是什么时候"不同形，而后者在本 Harness 版本上**不可得**。
     *   判据与日志都必须按前者理解（措辞上的区别在这里是**语义**，不是文风）。
     */
    lastActivityAt?: number;
    /** 上一次探活（求值）的时刻。缺席 ⇒ 这是第一次探活。 */
    lastPollAt?: number;
    /**
     * ── ★ 上一次探活【读到的】活动时刻（V3-3 的输入面）─────────────────────────────
     *
     * 与 `lastActivityAt` 不同形，且**两个都要**：
     *   · `lastActivityAt`         —— 我们至今观察到的最新一次产出（**至今**）
     *   · `lastPolledActivityAt`   —— **上一次探活那一刻**看到的那个值（**快照**）
     *
     * 判据问的是"这两次探活之间它动过没有"，所以它要的是**两个快照**，
     * 而不是"最新值"与"某个别的值"。把两者合成一个字段，会让"上一次探活之后
     * 它才动过"这件事**无法表达** —— 而那恰好是"还在跑"与"卡死"的唯一分界。
     */
    lastPolledActivityAt?: number;
    /**
     * ── ★ 已经**观察到**的那次产出的指纹（见 `sessionOutputKey`）───────────────
     *
     * ★ 它不是诊断字段，而是判据能不能工作的**前提**：成员会话里的
     *   `assistant/message` 是**历史日志**，会一直留在那里。没有这一位，
     *   每次探活都会"看见输出"⇒ 刷新 `lastActivityAt` ⇒ 一个卡死的成员
     *   看起来永远刚动过 ⇒ **这条判据永远不报警**。
     */
    lastOutputKey?: string;
    /** 已经观察到的产出次数（诊断用；判据不用它判"第一次"，见下）。 */
    activityCount: number;
}
export declare const waitRecords: Map<string, WaitRecord>;
export declare const PROBE_EVENTS: readonly string[];
export declare const waitWindows: Map<string, WaitWindow>;
export declare const WAIT_WINDOW_LIMIT = 200;
export interface WaitWindow {
    readonly teamId: string;
    readonly taskId: string;
    readonly memberName: string;
    /** 这一次等待从何时开始（ms epoch）。★ 换代的语义是"这一轮重来"，但探活问的是"它还活着吗"—— 后者跨代成立。 */
    startedAt: number;
    /** 上一次探活的时刻（窗口作用域，不属于任何一代 attempt）。 */
    lastPollAt?: number;
    /** 上一次探活读到的活动时刻（窗口作用域）。 */
    lastPolledActivityAt?: number;
    /** 最近一次被**任何**探活碰过的时刻（`lastPollAt` 的同义词，但即使还没探过也有值：建窗口那一刻）。 */
    touchedAt: number;
    /**
     * ── ★ 这个窗口认的是第几代尝试（"连续 vs 重来"的判别面）─────────────────────
     *
     * MEASURED（2026-10-06，两种合法需求打起来的那一格）：
     *   · t5 的臂 5：**重派发**（任务回 pending、换 attempt）必须开一个**新窗口** ——
     *     否则一个刚开工的成员会被读成"等了 30 分钟"；
     *   · t3 的 V3-2：**换代**（status ⇒ kickTeam 给闲成员换 capability）必须
     *     **继承**窗口 —— 否则探活永远在"第一次"，静默成员永不报警。
     * 两者都对，区别只在"任务是不是真的重来了"。
     *
     * ⇒ 判别面用 `attempt` 计数：`beginTaskAttempt` 每次都会 `attempt += 1`，
     *   **重来一定跳号**；而 kickTeam 给已在等待的成员补一次派发时，那一代数与
     *   窗口记的相同 ⇒ 判为**连续**，继承窗口。
     *   两个方向都在夹具里各有一条臂（clock-dev 的臂 5 / 本文件的 V3-2 臂）。
     */
    attempt: number;
}
export declare function waitWindowKey(teamId: string, taskId: string, memberName: string): string;
export declare function putWaitWindow(key: string, window: WaitWindow): void;
export declare function forgetWaitWindow(teamId: string, taskId: string): void;
export declare function putWaitRecord(record: WaitRecord): void;
export declare function observeMemberActivity(ctx: Context, memberId: string, attemptId: string | undefined, now: number): boolean;
export declare function sessionOutputKey(session: unknown): string | undefined;
export declare function teamWaitObservations(team: TeamState, now: number, event: string): Record<string, unknown>[];
export declare function waitObservationFor(teamId: string, taskId: string, attemptId: string | undefined, now: number, memberName: string | undefined, 
/**
 * ★ 这一次求值是不是**一次探活**（见 {@link PROBE_EVENTS}）。
 *   它决定窗口的探活戳要不要在这一次交接里推进 —— 换代不是探活。
 */
event: string): Record<string, unknown> | undefined;
export declare function auditGateRequires(point: GatePoint, context: unknown): import("../../gates/requires.ts").RequiresAudit;
export declare function inputSurfaceSchema(): {
    type: "object";
    additionalProperties: false;
    properties: {
        checked: {
            type: "number";
        };
        incomplete: {
            type: "number";
        };
        skipped: {
            type: "number";
        };
        missing: {
            type: "array";
            items: {
                type: "string";
            };
        };
    };
};
export declare function runtimeGatesSchema(): {
    type: "json";
};
export declare function diagnosticFields(which: {
    inputSurface?: boolean;
    runtimeGates?: boolean;
    dispatchInputSurface?: boolean;
    completionInputSurface?: boolean;
}): Record<string, unknown>;
export declare function inputSurfaceOf(point: GatePoint, context: unknown): {
    checked: number;
    incomplete: number;
    skipped: number;
    missing: string[];
} | undefined;
export interface FrictionCapture {
    /** 判据位置（`contract` / `dispatch` / …）。 */
    point: string;
    /** 拒绝的原话（判据说的那一句）。 */
    message: string;
    /** ① 判据读到的那一份 ctx —— **结构化快照**，不是引用。 */
    context: unknown;
    /** ③ 机制状态：这一轮输入面核对结论 + 判据裁决。 */
    mechanismState: unknown;
    /** 会话（用来取事件定位）—— 拿不到 ⇒ `eventRefs` 缺席，并在 `unknown` 里写明。 */
    session?: unknown;
    taskId?: string;
    teamId?: string;
    /** 工具名（台账 `scene.trigger.tool`）。 */
    tool?: string;
    /**
     * ★★ 这个团队自己的 `stateRoot`（`workspaceOf(caller)` + stateDir）。
     *   **必须由调用方给**，不许用进程级单值 —— 见 `recordFriction` 里那段实测。
     */
    stateRoot?: string;
    /** 这条调用路径上读到的**未能测量**原文；缺席表示这一轮不是"没能测量"。 */
    couldNotObserve?: readonly string[];
    /**
     * ★ t23：记这条卡点时，本进程持有的 build 与盘上是否一致。
     *   缺席 ⇒ 由 `recordFriction` 现读一次（生产路径不必显式传）。
     */
    moduleFreshness?: ModuleFreshness;
}
export declare function toReplayableSnapshot(value: unknown, depth?: number, seen?: WeakSet<object>): unknown;
export declare function sessionEventRefs(session: unknown): {
    sessionId?: string;
    eventIndices: number[];
} | undefined;
export declare function recordFriction(capture: FrictionCapture): Promise<string | undefined>;
export declare function evaluateRuntimeGates(ctx: Context, event: string, context: unknown, clock?: () => number): Promise<JsonValue | undefined>;
export declare function rejectOnContractGates(ctx: Context, context: Record<string, unknown>, what: string, 
/** ★ t22：这个团队自己的 stateRoot（台账落点）。**不许用进程级单值**，见 recordFriction。 */
stateRoot: string, inject?: Record<string, unknown>): Promise<{
    input_surface: ReturnType<typeof inputSurfaceOf>;
} | undefined>;
export declare function throwWithSurface(message: string, surface: ReturnType<typeof inputSurfaceOf>, 
/**
 * ★★ 这一次拒绝属于**哪个位置** —— 决定结论在工具结果上落到**哪个字段名**（t4 修）。
 *
 * MEASURED（2026-10-06，verifier5 的臂 1/7 复跑时暴露）：
 *   成功路径上，一次 `update_task` 的两个位置**各挂各的**
 *   （`dispatch_input_surface` / `completion_input_surface`）—— 那是刻意的，
 *   因为"哪一个位置缺哪一格"必须读得出来。
 *   而**拒绝路径**当时只有一格泛用的 `input_surface` ⇒ 同一个位置在两条路径上
 *   **字段名不同形**。读者按位置的名字去找（`dispatch_input_surface`）会读不到，
 *   而"读不到"与"这个位置没判据"在断言层面同形 —— 正是本任务要消灭的那件事。
 *
 * ⇒ 现在拒绝也带位置：`dispatch` ⇒ `dispatch_input_surface`，`completion` ⇒
 *   `completion_input_surface`，其余位置（contract / delivery 各只有一个入口）
 *   仍用泛用的 `input_surface`（与它们成功路径上的字段名一致）。
 */
field?: string): never;
export declare const INPUT_SURFACE_PROPERTY = "agentTeamsInputSurface";
export declare const INPUT_SURFACE_FIELD_PROPERTY = "agentTeamsInputSurfaceField";
export declare function inputSurfaceFieldOf(error: unknown): string;
export declare function inputSurfaceFromThrown(error: unknown): ReturnType<typeof inputSurfaceOf>;
export type MemberConvergenceObservation = {
    name: string;
    /** ★ 与判据 `MemberConvergenceInput['state']` 同一套取值（含 `never-spawned`）。 */
    state: 'idle' | 'reported' | 'working' | 'failed' | 'never-spawned' | 'unknown';
    spoke?: boolean;
};
export declare function observedSpoke(session: unknown): boolean | undefined;
export declare function observeMemberConvergence(ctx: Context, team: TeamState): MemberConvergenceObservation[] | undefined;
export declare function initializeProfileTeam(input: {
    ctx: Context;
    config: ToolsConfig;
    memberSelections: ReturnType<typeof installMemberSelectionRuntime>;
    captain: Agent;
    exec: ToolRunContext;
    stateRoot: string;
    teamName: string;
    teamId: string;
    profileName: string;
    inlinePlan?: import('../../profiles.ts').TeamProfileConfig;
    description?: string;
    staged: boolean;
}): Promise<{
    committed: true;
    state: TeamState;
}>;
export declare function parseFindings(value: unknown): ReviewFinding[] | undefined;
export declare function parseAcceptanceResults(value: unknown): AcceptanceResult[] | undefined;
export declare function parseCommandResults(value: unknown): CommandResult[] | undefined;
export declare function applyQualityFollowUp(team: TeamState, closed: TeamTask): {
    created: TeamTask[];
    escalated: boolean;
};
export declare function renderStatus(value: JsonValue): string;
/**
 * ── ★★ 重载的【排队】通道（t49）──────────────────────────────────────────────────
 *
 * ── 它修的是什么（用户实测的结构性矛盾，原话）──────────────────────────────────
 *
 *   「不管是我手动重启，还是调用最新的 restart 去重启，都需要等待团队成员的工作完成。
 *     我对这个插件的想法是，它需要尽可能把并发打满，尽可能去做快速迭代。
 *     也就是说，如果有团队成员在工作，就不可能进行手动重启或 restart。
 *     只要是跟 restart、重载相关的线，都会被阻塞。」
 *
 * ★ 那个矛盾的精确形状：
 *
 *     重载需要【无进行中工作】  ∧  并发干活 ⇒ 永远有进行中工作
 *     ⇒ 两者**结构上互斥** ⇒ 旧模块永远换不掉
 *
 * ★ 而 captain 的实测给了它两条硬证据：
 *   ① 调 `agent_teams_restart` ⇒ 拒：「2 task(s) are in progress」
 *   ② **用户手动重启两次**（PID 52994 → 54529 → 18909），而 `[deployment]` 仍报 stale
 *      ⇒ ★ **换进程 ≠ 换模块**（比 "reload ≠ restart" 更精确）
 *
 * ── 于是：被拒 ≠ 失败，而是**进入队列** ─────────────────────────────────────────
 *
 *   一次被拒的重载申请**不丢掉** —— 它变成「已申请」，并带来三件事：
 *     ① **不再派发新任务**（否则永远有新的工作在跑，闸门永远不满足）
 *     ② 当前在跑的**收口后自动重载**（不必让 captain 再调一次）
 *     ③ **能被 `status` 读到**（好让 captain 知道该不该继续派发）
 *
 * ── ★★ 三态不同形（本队反复学到的那条）──────────────────────────────────────────
 *
 *     `none`       —— 没有申请（重载仍走原闸门）
 *     `waiting`    —— 已申请，且**还等得到**（附「还要等哪些任务」）
 *     `stuck`      —— 已申请，但**等不到**（某个任务永不终态 ⇒ 要人工介入）
 *
 *   ★ 第三态为什么必须与第二态不同形：`waiting` 会自己收敛，`stuck` **不会**。
 *     把它们写成同一形状，读的人会一直等一个不会发生的事 ——
 *     而"等不到"与"还在等"在读数上同形，是本队记过的那条最贵的形态之一。
 *
 *   ★ 判定 `stuck` 的口径：**申请之后还有没有可能收敛**。
 *     一个任务的 status 若已经不可能再变（终态），它不该在等待名单里；
 *     而"等待名单非空、且其中某个任务**已经很久没有任何变化**"才是最可疑的信号。
 *     本实现用一条**可机械判定**的口径：等待名单里的任务若**不在当前任务表里**
 *     （被删了 / 从未存在）⇒ 它永远不会变成终态 ⇒ `stuck`。
 *
 *     ★ 为什么不用"超时"：超时需要一个时长阈值，而本队实测任务时长是
 *       **重尾分布**（最短 1.4 分钟、最长 767 分钟）⇒ 任何阈值都会误判。
 *       用户提的「预估时长后派发更短的」已被 captain 用 44 条真实数据否定，
 *       同一个理由在这里也成立：**不要给不可预测的东西设一个预测性的阈值**。
 */
export type RestartQueueState = {
    status: 'none';
} | {
    status: 'waiting';
    requestedAt: number;
    waitingOn: string[];
} | {
    status: 'stuck';
    requestedAt: number;
    waitingOn: string[];
    reason: string;
};
/** 此刻的排队状态（**纯函数**：只读入参，不读模块状态 —— 便于夹具直接构造三态）。 */
export declare function restartQueueState(input: {
    requestedAt?: number;
    waitingOn: readonly string[];
    /** 当前任务表里**存在**的任务 id（用来发现"等待一个不存在的任务"）。 */
    knownTaskIds: readonly string[];
    /** 当前仍在进行中的任务 id。 */
    inFlight: readonly string[];
}): RestartQueueState;
/** 记下一次申请（进程级）。 */
export declare function requestRestart(waitingOn: readonly string[], now: number): void;
/** 读当前的申请（`undefined` = 没申请过）。 */
export declare function pendingRestartRequest(): {
    at: number;
    waitingOn: string[];
} | undefined;
/** 消费掉申请（重载真的发生了，或申请被放弃）。 */
export declare function clearRestartRequest(): void;
/**
 * 用**当前的任务表**算出排队状态（`restartQueueState` 的薄封装）。
 *
 * ★ 与闸门同一条纪律：输入从**耐久态**来（调用方读 team），不从这个模块缓存。
 */
export declare function restartQueueFrom(tasks: ReadonlyArray<{
    id: string;
    status: string;
}>): RestartQueueState;
/** 一句人话（供工具结果与 status 读）。★ 三态措辞必须互不同形。 */
export declare function restartQueueMessage(state: RestartQueueState): string;
