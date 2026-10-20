/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * task turns and step-boundary messages, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * queues its next turn through {@link deliverToMember}, it works through its turn
 * (updating team state through the `agent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `agent_teams_status`.
 * @module dsh-agent-teams/members
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import { type TeamMember, type TeamState, type TeamTask } from './types.ts';
/**
 * ── ★★★ #176（乙）：lead 身份收口（t98）───────────────────────────────────────────
 * ★ 本模块**不再**自己写 `captainSessionId === <id>`。
 */
import { type LiveSessionRef, type TeamIdentity } from './lineage.ts';
/** Persona snapshot of a profile protocol; the full text lives on team.json. */
export declare const PERSONA_PROTOCOL_MAX_CHARS = 400;
/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
    /** Registered `ctx.subagents` provider name (must support continuable + persona). */
    provider: string;
    /** Child delegation depth cap (0 forbids delegation entirely). */
    maxDepth?: number;
    /** Plugin-wide execution prompt. */
    executionPrompt?: string;
    /** Plugin-wide fallback route. */
    fallback?: {
        provider: string;
        model: string;
    };
}
/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
    /** Registered LLM provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
    reasoningEffort?: string;
    /** Configured second-choice route. */
    fallback?: {
        provider: string;
        model: string;
    };
}
/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
    /** Explicit LLM provider route; requires an explicit model. */
    provider?: string;
    /** Explicit model id; otherwise the plugin default or captain model is used. */
    model?: string;
    /** Plugin-level member model default. */
    defaultModel?: string;
    /** Explicit reasoning effort; "default" selects the target model's default effort. */
    reasoningEffort?: string;
    /** Configured fallback route. */
    fallback?: {
        provider: string;
        model: string;
    };
}
/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
    /** Trusted fresh-child admission, before the durable member id is written. */
    isPendingMember(agent: Agent): boolean;
    /**
     * Make one selection visible while Harness materializes the fresh child.
     *
     * @param setup - child-scoped persona/tool restriction for hosts whose
     *   activation no longer carries them in the request. Installed by the
     *   synchronous child setup before the first request.
     */
    withPending<T>(parentSessionId: string, label: string, selection: MemberLlmSelection, operation: () => Promise<T>, setup?: TeamMember['runtimeSetup']): Promise<T>;
}
/**
 * Validate a resolved roster against every provider catalog before any child
 * session is created. Catalogs are advisory when empty (some adapters accept
 * dynamic model ids), but a non-empty catalog is authoritative enough to
 * catch a typo that would otherwise boot a child and fail on its first turn.
 */
export declare function validateMemberLlmSelections(ctx: Context, selections: readonly MemberLlmSelection[], signal?: AbortSignal): Promise<void>;
export declare function isFallbackFailureCode(code: string): boolean;
/** Pure state transition used by the request-error handler and TDD tests. */
export declare function selectFallbackRoute(current: {
    provider: string;
    model: string;
}, fallback: {
    provider: string;
    model: string;
} | undefined, failureCode: string, alreadySwitched: boolean): {
    retry: boolean;
    switched: boolean;
    selection: {
        provider: string;
        model: string;
    };
};
/** Deliver a durable member report to the live captain at its next model step. */
export declare function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string, receipt?: string): boolean;
interface FailedMemberAttempt {
    readonly captainSessionId: string;
    readonly memberId: string;
    readonly task?: Pick<TeamTask, 'id' | 'attempt' | 'attemptId'>;
}
/** Record a final turn failure, never an intermediate request retry. */
export declare function failMemberOpenAttempt(ctx: Context, stateRoot: string, teamId: string, memberName: string, failure: {
    readonly code: string;
    readonly message: string;
}, fallbackSession: Session, observed: FailedMemberAttempt): Promise<boolean>;
/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. When provider or model
 * changes, effort is intentionally omitted so the target model materializes
 * its own default instead of receiving an adapter-owned id from another route.
 * An explicit effort overrides either policy; the sentinel "default" also
 * selects the target model's default. The final effort is validated against
 * the target model before a child is created.
 */
export declare function resolveMemberLlmSelection(ctx: Context, captain: Agent, request: MemberLlmSelectionRequest, signal?: AbortSignal): Promise<MemberLlmSelection>;
/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export declare function installMemberSelectionRuntime(ctx: Context, stateDir: string, onFailureSettled?: (workspace: string, teamId: string, memberName: string) => Promise<void>): MemberSelectionRuntime;
/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * Frozen at spawn: draft must already carry the Team goal and profile protocol.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 */
export declare function memberPersona(team: TeamState, member: TeamMember, stateDir: string, executionPrompt?: string): string;
/**
 * The initial user message delivered when the member is created.
 * Counts non-terminal tasks already assigned to this member on the in-memory draft.
 * @param team - the team the member joined.
 * @param memberName - canonical member name used to count assigned pending work.
 */
export declare function memberWelcome(team: TeamState, memberName: string): string;
/**
 * Spawn one member as a durable continuable subagent of the captain and fill
 * `member.id` with its child session id. On failure nothing is persisted.
 * @param ctx - the plugin context (injects `subagents`).
 * @param config - member runtime knobs.
 * @param selections - fresh/cold child model-selection bridge.
 * @param llmSelection - resolved provider/model/reasoning snapshot.
 * @param captain - the exact live captain agent (the calling agent).
 * @param team - the team record (read-only here).
 * @param member - the member draft whose `id` is filled on success.
 * @param stateDir - configured state directory (for the persona).
 * @param signal - caller cancellation, forwarded to the start.
 */
export declare function spawnMember(ctx: Context, config: MemberRuntimeConfig, selections: MemberSelectionRuntime, llmSelection: MemberLlmSelection, captain: Agent, team: TeamState, member: TeamMember, stateDir: string, signal: AbortSignal, initialPrompt?: string): Promise<void>;
/**
 * Deliver one message to a member as its next FIFO turn. Best effort: a
 * failure (member gone or not continuable) is logged and reported as `false`
 * so the caller can decide (mailbox delivery still happened).
 *
 * Any team sender can route through this helper: the captain is the direct
 * parent of every member, and the caller passes the captain's live Agent
 * (its own when the captain calls, the registry-resolved one when a member
 * sends) — mirroring the Claude Code mailbox model where the writer writes
 * the target's inbox and the target picks it up on its own.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's direct parent).
 * @param childId - the member's durable child session id.
 * @param text - the message content.
 * @param signal - caller cancellation, forwarded to the delivery.
 * @returns whether the member inbox accepted the message.
 */
export declare function deliverToMember(ctx: Context, captain: Agent, childId: string, text: string, signal: AbortSignal, mode?: 'queue' | 'steer'): Promise<boolean>;
/**
 * ── ★★★ 投递的【带成因】版本 —— 因为 `false` 与"没票可送"在读法上同形（t43）────
 *
 * MEASURED（2026-10-10 00:1x，captain 实测）：
 *   派发链上前面每一格都是好的（闸门不扣 · 成员 idle · `nextReadyTask` 找得到 ·
 *   任务过门 · captain 能解析），★ 而票【仍然送不出去】。
 *   而那一格是：
 *   ```js
 *   catch (error) { ctx.logger.warn(…); return false }   // ★ 只写日志，不写记录
 *   ```
 *   ⇒ ★ 调用方 `if (accepted) {…}` ⇒ 不进 ⇒ **静默回滚**（attempt 退回、status 回 pending）
 *   ⇒ ★ 而 team.json 上：任务仍 pending · attempt 不推进 · 成员 idle
 *   ⇒ ★ **与"根本没人触发派发"完全同形。**
 *
 * ★★ 后果（本会话实测）：captain 反复"重派"、反复"调 status"、反复让用户"重启" ——
 *   而每一次【失败的方式都一样】，而每一次【都看不见】。
 *
 * ⇒ 所以本函数把成因【交出来】，而调用方负责把它写进【别人读得到的地方】。
 *   ★ 三态：ok / failed{reason} —— 而"失败"与"未尝试"因此不同形。
 */
export declare function deliverToMemberDetailed(ctx: Context, captain: Agent, childId: string, text: string, signal: AbortSignal, mode?: 'queue' | 'steer'): Promise<{
    ok: true;
} | {
    ok: false;
    reason: string;
}>;
/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export declare function interruptMember(ctx: Context, captain: Agent, childId: string): void;
/**
 * Install the missing per-child retirement boundary above Harness rc.6.
 *
 * Upstream `interrupt()` deliberately preserves continuable sessions and the
 * upstream seam exposes no targeted forget/retire method. The durable
 * AgentTeams index therefore rejects every inbox delivery before it can cold-resume a
 * retired member. Catalog rows deliberately remain discoverable: Harness rc.8
 * uses the direct-child catalog to authorize historical transcript reads and
 * `openSubagent()`, so filtering those rows would make an archived member's
 * persisted conversation inaccessible. Exact ids keep unrelated subagents
 * untouched while the delivery boundary still prevents further model turns.
 */
export declare function installRetiredMemberGuard(ctx: Context, stateDir: string): void;
/** Bound all descendant creation, including renamed tools and code-runtime calls. */
export declare function installMemberDelegationGuard(ctx: Context, stateDir: string, maxDepth: number): void;
/**
 * Snapshot the real driver activity for durable member ids.
 *
 * The team record is the membership authority, so this path intentionally no
 * longer depends on `listChildren()`'s versioned projection shape. Harness
 * rc.8 changed those rows to branded `SessionId` values plus residency-only
 * `activity`; neither is needed to answer whether the live Agent driver is
 * running, idle, or absent/ready.
 * @param ctx - the plugin context (injects `agents`).
 * @param memberIds - child ids restored from the durable team record.
 * @returns child id → live activity.
 */
export declare function memberActivity(ctx: Context, memberIds: readonly string[]): Map<string, 'running' | 'idle' | 'ready'>;
/**
 * ── ★★★ 这一格修的是什么（DISPATCH-RULES §39，MEASURED）─────────────────────────
 *
 * 用户说「没有成员在跑」，而检测器说「在推进（成员 working: pipeline-author,
 * decompose-author, wire-author）」—— 两种读数矛盾，而**用户是对的**。
 *
 * 判别的过程逐字是：
 *
 *   ① team.json 说三个 member `status = working`
 *   ② 而他们的 inbox 15+ 分钟没写
 *   ③ 而三条任务都停在 claimed、9–33 分钟无更新
 *   ④ 队长发探针给 pipeline-author ⇒ **`active teammate not found`**
 *   ⇒ 所以【那个会话不在了】，而 team.json 里的 `working` 是**残留**。
 *
 * ── 为什么它此前【结构上】看不见 ────────────────────────────────────────────────
 *
 * 检测器已有的信号是「成员被占着」：`member.status === 'idle'` 而名下有未完成。
 * 而残留 `working` 是**反过来**的：`status === 'working'` 而**会话不在了**。
 * ⇒ `team.json` 里**没有**任何一格表示「那个会话还活着」，所以检测器在结构上
 *   看不到它。原文：唯一可靠的判据是**能不能给那个成员发消息**。
 *
 * ── ★★ 而"发探针"不能是队长【手工】做的那件事 ─────────────────────────────────
 *
 * 手工探针有两个致命性质，缺一条都够：
 *   · 它**要求队长已经怀疑**了。而"我该不该怀疑"正是这一格要回答的问题 ——
 *     那是循环：要发现问题必须先发现它。
 *   · 它**在发出去那一刻改变系统**（一条真实的消息进了成员的 inbox，冷启动一个
 *     会话、消耗一次模型调用）。一个会改变被观测对象的观测不是一次读数。
 *
 * ⇒ 这一个读数是**旁路的**：它只问"这个插件进程里还有没有那个 Agent 驱动" ——
 *   `ctx.agents.get(id)`。那正是 `deliverToMemberDetailed` 会走的那条路
 *   （投递失败的时刻就是 `active teammate not found`），只是**不投递**。
 *   ⇒ 队长一个键都不用按。
 *
 * ── ★★★ 三态，且"判不了"绝不并进"在跑"（本队反复记账的那条）────────────────────
 *
 * ```
 * working            —— 驱动在场且 running。**只有这一态**支持"它在跑"这个读法。
 * not-live           —— 驱动【不在场】。会话没了。（探针会答 active teammate not found）
 * could-not-measure  —— 驱动在场，但它的生命周期状态不是 running/idle 两态之一
 *                       ⇒ 说不出它到底在不在跑。★ 不许圆成 working。
 * ```
 *
 * ★ 三种"没在跑"的理由**各自不同形**，因为它们要人去修的东西不同：
 *
 *   `never-spawned` ⇒ 等依赖 / 看 `spawnError`（**不是**一次故障）
 *   `not-live`      ⇒ 那个成员死了 ⇒ **抢救它 worktree 里的产物**（§39.2）
 *   `could-not-measure` ⇒ 这个插件的驱动状态面变了 ⇒ 去看 Harness 边界
 *
 * ── ★★ 它【为什么不能】拒绝一个任务（验收第 3 条）────────────────────────────────
 *
 * 见下面 {@link LivenessReadout} 的两条纪律：`rejects` 恒为 `false` 字面量，
 * 且 `readout` 是 `never` —— 于是**类型系统**保证它进不了任何拒绝路径。
 * 那不是"约定上不许用"，是"用它当拒绝理由的代码**编译不过**"。
 */
export type MemberLiveness = {
    readonly state: 'working';
    readonly readout: 'live-running';
    readonly rejects: false;
} | {
    readonly state: 'idle';
    readonly readout: 'live-idle';
    readonly rejects: false;
} | {
    readonly state: 'not-live';
    readonly readout: 'driver-absent';
    readonly rejects: false;
} | {
    readonly state: 'never-spawned';
    readonly readout: 'never-spawned';
    readonly rejects: false;
} | {
    readonly state: 'could-not-measure';
    readonly readout: 'driver-status-unreadable';
    /** ★ 说清**是什么**读不到 —— 一句"未能测量"没有成因就是一句空话。 */
    readonly reason: string;
    readonly rejects: false;
};
/**
 * ── ★★ 一条"只报告"的读数在类型上的写法 ────────────────────────────────────────
 *
 * `rejects: false` 是一个**字面量类型**，不是 `boolean`。于是：
 *
 *   · 生产者写不出 `rejects: true`（编译不过）；
 *   · 消费者若写 `if (liveness.rejects)`，那个分支的类型是 `never` ——
 *     即"这一支在类型上不可达"，而不是"这一支运行时不会走到"。
 *
 * ★ 与"约定"的区别是决定性的：约定只在**写的时候**有效，而类型在**改的时候**
 *   也有效 —— 下一次有人想让存活读数参与拒绝，他会在 `pnpm build` 那一步被拦住，
 *   而不是在被拒绝的那个成员那边被发现。
 *
 * ★ 与 `deployment` / `reload` 那两格同一条纪律（见 `src/tools/status.ts`）：
 *   它们是**读数**，不是**判据**；让它们有否决权会把"我去看一眼"变成"你这次失败"。
 */
export interface LivenessReadout {
    readonly rejects: false;
}
/** 拿不到 `agent.status` 两态时的成因（诊断面，不改变裁决）。 */
export declare const DRIVER_STATUS_UNREADABLE = "the live Agent driver is present but reports a lifecycle status that is neither \"running\" nor \"idle\"";
/** `never-spawned` 的成因：它**没有**起来过，与"起来了又死了"必须不同形。 */
export declare const MEMBER_NEVER_SPAWNED = "this member was never spawned (no child session id), so whether it is alive is not a question that can be asked of it";
/**
 * 读一个成员的**会话存活**（t4）。
 *
 * @param ctx - 插件上下文（注入 `agents`）。
 * @param member - 成员的持久记录（只要 `id` 与 `spawnError`）。
 * @returns 五态读数。★ 没有任何一态是"拒绝"。
 *
 * ── ★ 为什么它不读 `member.status` ───────────────────────────────────────────────
 *
 * **这正是本格的全部意义**：`member.status` 是**持久记录**，它会在成员死掉之后
 * 继续写 `working`（残留）。若这个函数读它，它读到的就是那个残留 —— 而它与
 * "真的在跑"同形。⇒ 这里只问**驱动在不在**，而 `member.status` 由调用方
 * **并列**交出去，两格合起来读的人才能看见「记录说 working，而驱动不在」。
 */
export declare function memberLiveness(ctx: Context, member: {
    readonly id: string;
    readonly spawnError?: string;
}): MemberLiveness;
/**
 * 一个成员**名下在飞、而那个会话已经不在了** —— 也就是 §39 那个残留状态。
 *
 * ── ★★ 为什么"在飞"要用【任务】判，而不是用 `member.status` ──────────────────────
 *
 * 因为 `member.status` 正是那个**会残留**的东西。用它当自变量，等于拿被质疑的
 * 读数去解释它自己。而任务记录是**另一份**数据：一个停在 `claimed`/`in_progress`
 * 的任务 + 一个不在场的驱动 = 有一份工作被悬在半空。
 *
 * ★ 而在飞的任务还**指得出**它悬在哪棵树里 —— 那是抢救的落点（§39.4 ①）。
 */
export declare function strandedWork(liveness: MemberLiveness, openTasks: readonly string[]): boolean;
/**
 * ── ★★★ 残留 `working` 的**后果面**：产物冻在 worktree 里（§39.2）───────────────
 *
 * §39.2 逐字记着那个代价：
 *
 *     t39 的树: 12 个文件未提交（含 create-task.ts + update-task.ts 的 300 行改动）
 *     t28 的树:  7 个文件未提交
 *     ⇒ 而若我按 "working" 当它在跑而等着 ⇒ 那些改动会【永远冻在那儿】
 *
 * ── ★ 为什么"会话没了"还不够，必须同时报出这一格 ─────────────────────────────────
 *
 * 「那个成员死了」这句事实本身**不改变任何人的下一步** —— 队长会想"那我重派一次"，
 * 而**重派救不回那棵树的产物**：新会话从当前 HEAD 起，那个 worktree 里的未提交
 * 改动仍然只有那一棵树上有。⇒ 真正决定下一步动作的是**"有没有东西会因此丢掉"**。
 *
 * ★ 而这正是本队那条纪律的又一次实例：
 *   **一个读数只有在它能改变【下一步动作】时才有价值。**
 *   `not-live` 说"出事了"，这一格说"去抢救 /tmp/salvage-<时间>/ 之前别动它"。
 *
 * ── ★★ 三态，且"读不到"绝不并进"没有产物" ──────────────────────────────────────
 *
 * ```
 * { status: 'frozen', worktrees: [...] }       —— 有活儿的树冻着，逐棵报出
 * { status: 'clear' }                          —— 读了：没有任何处于该状态的树
 * { status: 'could-not-measure', reason }      —— 读不到（git 缺席 / 目录不可读）
 * ```
 *
 * ★ 后两态**必须不同形**：`clear` 是"我去看过了，没有"，`could-not-measure` 是
 *   "我没能去看"。把后者读成前者，会让一次 git 故障变成一句"没有东西会丢"——
 *   而那句话正是抢救那一步的唯一依据（§39.4 ①）。
 *
 * ── ★ 诚实边界：它只说"这一棵树在【此刻】是脏的" ─────────────────────────────────
 *
 * 它**不说**这些改动是那个死掉的成员写的（git 不知道是谁改的 —— 与
 * `gitChangedPaths` 的诚实边界逐字相同）。它说的是："这几棵树上有未落盘的改动，
 * 而它们所属的成员已经不在了 ⇒ 没有任何人会把它们提交上来。"
 * ⇒ 归属仍由会话事件回答，两格合起来才完整。
 */
export type StrandedWorktrees = {
    readonly status: 'clear';
    readonly checked: number;
} | {
    readonly status: 'frozen';
    readonly checked: number;
    readonly worktrees: readonly FrozenWorktree[];
} | {
    readonly status: 'could-not-measure';
    readonly reason: string;
};
/** 一棵冻着的树：路径 + 有几个路径脏了。★ 不报文件名 —— 那可能很长，且抢救要的是整棵树。 */
export interface FrozenWorktree {
    /** 那棵树的绝对路径（抢救的落点）。 */
    readonly path: string;
    /** 它相对工作区的名字（`task-t39` 那一格，人读的）。 */
    readonly name: string;
    /** 脏路径的条数。★ `0` 的树**不会**出现在这里（见下）。 */
    readonly dirty: number;
}
/** 一棵**可能的**冻树：它的成员名 + 它的绝对路径（由调用方算出，见下）。 */
export interface FrozenCandidate {
    /** 处于 `not-live` 且名下有在飞任务的那个成员。 */
    readonly member: string;
    /** 那棵树的绝对路径。★ 目录名由调用方用 `worktreeDirName` 算 —— 见下。 */
    readonly path: string;
    /** 它在磁盘上的名字（`task-<team>-<id>`），人读的。 */
    readonly name: string;
}
/**
 * 找出**冻着的树**：某一棵成员 worktree 里有未提交改动，而它的成员已经不在了。
 *
 * @param candidates - 处于 `not-live` 且名下有在飞任务的成员，连同它们各自的树路径。
 * @param dirtyOf - 树路径 → 脏路径条数（**由调用方注入**，见下）。
 *
 * ── ★★ 为什么路径由调用方给出，而不是这里用成员名拼 ────────────────────────────
 *
 * MEASURED（本函数第一版，实测打红）：我按**成员名**去拼
 * `.agent-teams/worktrees/<memberName>` —— 而真实的目录名是
 * `worktreeDirName(teamId, taskId)` = `task-<team>-<task>`（见 `src/worktree.ts`）。
 * ⇒ 于是每一棵**真的存在的**树都读不到，而整个格子恒报 `could-not-measure`。
 *
 * ★ 这正是本队记账的形态：**一个拼错的路径会让"读不到"与"没有东西"同形** ——
 *   而这一格的 `could-not-measure` 救了它（没有圆成 `clear`），所以它当场可见。
 *   ⇒ 修法是让**唯一知道那个名字的人**（调用方，它已经 import 了
 *     `worktreeDirName`）把路径算好，而不是在这里再拼一份**第二份真相**。
 *
 * ── ★ 为什么 `dirtyOf` 也由调用方注入 ──────────────────────────────────────────
 *
 * 本文件（`members.ts`）到目前为止**不碰 git**：它管的是子代理生命周期。
 * 而"哪棵树脏了"是一次**文件系统查询**（`git status --porcelain`，可能慢、
 * 可能失败）。把它合进来会让"读一个成员的存活"这件事需要一次 git 调用 ——
 * 而存活读数会**在每一次 `status` 上对每一个成员**跑一遍。
 * ⇒ 注入让调用方决定**要不要**付这笔钱、以及**付几次**。
 *
 * ★ 这与 `mutation-guard.ts` 的划分逐字同源：那里也是"纯数据变换留在模块里，
 *   读文件/跑 git 全部由调用方注入"。
 */
export declare function strandedWorktrees(candidates: readonly FrozenCandidate[], dirtyOf: (worktreePath: string) => number | undefined): StrandedWorktrees;
/** 把那一格说成一句人话（含**补救动作** —— 只说"冻着"不改变任何人的下一步）。 */
export declare function describeStrandedWorktrees(readout: StrandedWorktrees): string;
/**
 * ── ★★★ 这一格修的是什么 ───────────────────────────────────────────────────────
 *
 * 用户的要求是明确的：**第一屏显示持久成员，点开一个成员要能看到它底下正在跑的
 * 子代理**（连同轮次信息）。而 MEASURED（本任务开工时的普查）：
 *
 *     grep -n "subagent|childSession|parentSession" src/snapshot.ts
 *     ⇒ 只命中两处**注释**，一处代码都没有。
 *
 * ⇒ 于是那次"重建"会有一个**空的展开层**，而那正是本仓已经撞过两次的
 *   **「做出来了但没接上」**（shipped inert）形状：旋钮在、线没接。
 *
 * ── ★★ 为什么读得到（都不需要新机制）──────────────────────────────────────────
 *
 *   ① `ctx.agents.list()` —— 枚举**活的**会话。`src/capabilities.ts` 已经在用
 *      （`for (const agent of ctx.agents.list()) attach(agent)`），所以它是在
 *      **真实宿主**上验证过的入口，不是猜的。
 *   ② `session.header.parentSession` —— 把一个子会话连到它的父会话。
 *   ③ `foldSubagentDescriptor(sessionOwnEvents(child.session))` —— 交出描述符，
 *      它的 `label` 带着身份。
 *
 * ── ★★★ 只读（验收第 4 条）──────────────────────────────────────────────────────
 *
 * 本函数**不** spawn、**不** steer、**不** `whenIdle`、**不**投递、**不**写团队文件。
 * 它只调三个**纯读**入口：`agents.list()`（文档明说返回"a fresh array"）、
 * `session.header`（一个已存在的字段）、`sessionOwnEvents`（读日志）。
 * ⇒ 这一点由一条臂**机械地**钉住（用一个"碰一下就抛"的 ctx 去跑投影），
 *   而不是靠"我记得没写"。
 *
 * ── ★★★ 三态，且"读不到"绝不圆成"它没有子代理"（验收第 3 条）────────────────────
 *
 * ```
 * { status: 'observed', subagents: [...] }   —— 读了；这些就是此刻活着的子代理
 *                                            （**空数组** = 真的一个都没有，可判定）
 * { status: 'could-not-measure', reason }    —— 读不到（宿主没提供那个入口）
 * ```
 *
 * ★ 后两态**必须不同形**。一个"枚举入口不存在就把数组当空"的实现，会让
 *   **面板永远显示"没有子代理"** —— 而那与"确实没有"在读者眼里一模一样。
 *   这正是本任务点名要防的形态（同 `strandedWorktrees` 的 `clear` vs
 *   `could-not-measure`、`memberLiveness` 的 `never-spawned` vs `could-not-measure`）。
 *
 * ── ★ 为什么"父会话定不下来"的子代理**单独成一态**（验收第 2 条）─────────────────
 *
 * 一个活着的会话，如果它的 `parentSession` **在成员名单里找不到**，有几种可能：
 * 一个一次性委派、一个本队之外的子代理、或一个父会话已经不在的孤儿。
 * ★ 而这几种情形里**唯一不能做**的事就是**随便挑一个成员挂上去** ——
 *   那会让面板把一个**别人的**子代理画在这个成员底下，而读的人无从分辨
 *   （"归属错了"与"归属对了"在界面上同形，且错的那个看起来更"有内容"）。
 * ⇒ 它们被放在**自己的一格**（`unattributed`）里如实交出去，而不是被丢掉、
 *   更不是被硬塞给某个成员。
 */
export interface LiveSubagent {
    /** 子会话 id（`agent.id`）。 */
    readonly id: string;
    /** 描述符的 `label`（缺席 ⇒ `''`，见下注）。 */
    readonly label: string;
    /** 描述符的 `mode`；读不到描述符 ⇒ 缺席（**不是**编一个 `one-shot`）。 */
    readonly mode?: 'one-shot' | 'continuable';
    /** 它此刻的驱动状态（`running` / `idle` / …）—— 原样交出，不翻译。 */
    readonly status: string;
    /**
     * ── ★ 父会话 id（**归组的输入**，不是输出）──────────────────────────────────────
     *
     * 它是"谁生了它"，而归属是"它算谁的" —— 两者在**父不是本队成员**时**不同**：
     * 那时归属落在 `unattributed`，而父会话是那件事的**证据**。
     * ⇒ 这一格留着，读的人（与夹具）才分得出"它没有父"与"它的父不是我们的人"。
     */
    readonly parentSession?: string;
}
/** 三态：读了 / 读不到。★ `observed` 里**空数组**是"真的没有"，与 `could-not-measure` 不同形。 */
export type SubagentProjection = {
    readonly status: 'observed';
    readonly subagents: readonly LiveSubagent[];
} | {
    readonly status: 'could-not-measure';
    readonly reason: string;
};
/**
 * 一个成员底下的子代理（面板展开层的一行）。
 *
 * ★ `round` **不在**这里：轮次挂在**任务**上（`TeamTask.round`），而子代理挂的是
 *   会话。两格由**调用方**按自己的口径合起来（见 `snapshot.ts` 里那段）——
 *   在这里猜一个轮次就是造第二份真相。
 */
export interface MemberSubagents {
    readonly status: SubagentProjection['status'];
    /** `observed` 时在场：这个成员名下的活子代理（**空数组** = 真的没有）。 */
    readonly subagents: readonly LiveSubagent[];
    /** `could-not-measure` 时在场。 */
    readonly reason?: string;
}
/** 宿主没有可用的会话枚举入口时的成因。 */
export declare const AGENT_ENUMERATION_UNAVAILABLE = "the host exposes no live-session enumeration, so whether a member has subagents cannot be read";
/**
 * 从**活的会话清单**里读出"谁的子代理是谁"。
 *
 * ── ★★ 为什么入参是"一份会话清单"而不是 `ctx` ────────────────────────────────────
 *
 * 判据是**纯数据变换**：输入（父 id → 子会话）→ 输出（归属）。把 `ctx.agents`
 * 整个交进来会让这个函数**有能力**去 spawn/steer —— 而"它只读"就变成了
 * "我记得它只读"。★ 只收一份已经取好的**值的数组**，等于在**签名上**证明
 * 它不可能改变任何会话（它拿不到任何能改变东西的句柄）。
 *
 * ★ 同 `strandedWorktrees(candidates, dirtyOf)` 的分工：I/O 由调用方做，
 *   纯变换留在这里。
 * ★ 这也就是 {@link attributeSubagents} 只收 `LiveSubagent[]` 而不是收 `ctx` 的理由。
 */
/**
 * 枚举 `ctx.agents.list()`，并把它折成 {@link LiveSubagent} 的清单。
 *
 * ★ 这是**唯一**碰宿主对象的地方（`ctx.agents`），而它只**读**。
 * @param ctx - 插件上下文（注入 `agents`）。
 * @returns 三态：读了（可能为空）/ 读不到。
 */
export declare function liveSessionRefs(ctx: Context): SubagentProjection;
/** 一个已被枚举的会话的父会话 id（顶层会话缺席）。 */
export declare function parentSessionOf(entry: unknown): string | undefined;
/**
 * ── ★★★ #176（乙）：把 `ctx` 的活会话清单折成 `lineage` 要的形状（t98）───────────────
 *
 * ★ 它是**唯一**碰 `ctx.agents` 的地方（经 `liveSessionRefs`），而那个函数只**读**。
 * ★★ 拿不到枚举入口时返回 **`[]`** —— 而不是抛：那会让"枚举不可用"变成
 *   **每个调用点的崩溃**。★ 返回 `[]` ⇒ 链走不动 ⇒ `sessionLeadsTeam` 落到
 *   `unmeasured` ⇒ 按 `'exact'` 策略**退回今天的行为**（精确相等）。
 *   ⇒ ★ 即"枚举不可用"与今天**同结论**，而那是**对的**：本任务只加一条路，
 *     不该让"枚举坏了"改变任何既有裁决。
 */
export declare function liveRefsOf(ctx: Context): readonly LiveSessionRef[];
/** 把一个 team 记录折成本模块要的那两格身份面（**只读**；口径与 `state.ts` 的同名助手一致）。 */
export declare function identityOfTeam(team: TeamState): TeamIdentity;
/**
 * 把一份活会话清单**按父会话**归组，然后交给每个成员。
 *
 * @param refs - 已经读到的活会话（含它们各自的父会话 id）。
 * @param memberIds - 本队的成员会话 id（**成员**才可能是父）。
 * @returns 成员会话 id → 它名下的子代理；外加 `unattributed`（父定不下来的那些）。
 *
 * ── ★★ 为什么 `unattributed` 是一格**而不是一个错误** ────────────────────────────
 *
 * "父会话不在本队成员名单里"是一个**可判定的事实**，不是一次读取失败：
 * 那个会话确实活着、确实有父、而那个父不是我们的成员。把它并进
 * `could-not-measure` 会让"一个外来子代理"看起来像"基础设施坏了"，
 * 而它的补救动作完全不同（前者无需动作，后者要去查宿主）。
 *
 * ★ 而它**绝不**被并进某个成员：见上面 `MemberSubagents` 那段 ——
 *   随便挂一个会让"归属错了"与"归属对了"在界面上同形。
 */
export interface SubagentAttribution {
    /** 成员会话 id → 它名下的活子代理（**每个成员都有键**，缺席 ⇒ 空数组）。 */
    readonly byMember: ReadonlyMap<string, readonly LiveSubagent[]>;
    /** 父会话定不下来的活会话。★ 如实交出去，不丢、不硬塞。 */
    readonly unattributed: readonly LiveSubagent[];
}
/**
 * 归组算法。★ 顺序无关、不重排（调用方交进来的顺序就是它读得出的顺序）。
 *
 * ★ 一个父会话 id **只**在它真的是本队成员时才算归属 —— 这就是"随意归属"的
 *   唯一防线（`memberIds` 是那张白名单，且它来自**持久记录**，不是猜的）。
 */
export declare function attributeSubagents(refs: readonly LiveSubagent[], memberIds: readonly string[]): SubagentAttribution;
/**
 * 一个成员底下的子代理读数 —— **面板要的那一格**。
 *
 * @param ctx - 插件上下文（注入 `agents`），只用它的**读**入口。
 * @param memberId - 那个成员的会话 id（`''` ⇒ 它根本没起来 ⇒ 确定没有子代理）。
 * @param attribution - {@link attributeSubagents} 的结果（由调用方算一次、全员共用）。
 * @returns 三态读数。★ `subagents: []` 是"读了，真的没有"，与 `could-not-measure` 不同形。
 */
export declare function memberSubagents(ctx: Context, memberId: string, attribution: SubagentAttribution | undefined, projectionReason?: string): MemberSubagents;
/**
 * ── ★★★ 一个成员**派出过几个临时 sub-agent**（2026-10-20，`shape` 的执行判据）──
 *
 * ── 它补的是什么（上一轮形态验证实测出来的缺口）────────────────────────────────
 *
 * `shape: 'dispatch'` 只声明了**意图**：这个队的成员是持久派工点，每任务拉一个临时
 * worker。而"意图有没有被执行"**没有任何机械读数** ——
 * 一个 `shape: 'dispatch'` 的队如果成员全都自己干活，今天没有任何判据会红。
 *
 * MEASURED（`docs/SHAPE-VERIFICATION-PROBE-1.md` §3.2）：
 * ```
 *   $ grep -n "subagentCount\|dispatches\|childSessions" src/types.ts   ⇒ 零命中
 * ```
 * ⇒ 那一轮验证"形态真的在用吗"靠的是**队长手工看会话文件**，而那**不是判据**。
 *
 * ── ★★ 数据源是真的存在，只是本插件从没读过它 ──────────────────────────────────
 *
 * 宿主在父会话里追加一条 `subagent/catalog` 事件，逐字长这样（实测，
 * 见 `14f0a67e-…` 的 `session.v4.jsonl.zstd` 第 45 条）：
 * ```
 *   { type: 'subagent/catalog', data: { version: 0, childId: '48403c6f-…',
 *     childCreatedAt: 1792475600384, mode: 'continuable',
 *     label: 'Build dispatch-shape readout script' } }
 * ```
 * ⇒ **每派一个 worker 就多一条**。因此"派出过几个"是一个**可数的历史**，
 *   而不是靠"当前有几个活着的子代理"去猜 —— 后者漏掉"派过又结束了"，
 *   而那恰好是 dispatch 形态的常态（worker 用完即弃）。
 *
 * ★ 为什么**不**在 `team.json` 里加一个计数器：那需要一个新的**写**路径，
 *   而写路径会引入"谁来写、什么时候写、写失败怎么办"三个新问题；而证据
 *   已经由宿主落在会话里、且**只追加**。读侧推导不制造第二份真相。
 *
 * ── 三态，且**缺席不许并进 0** ─────────────────────────────────────────────────
 *
 *   `read`        —— 读到了；`dispatched` 是**累计**派出的 worker 数
 *   `unmeasured`  —— 这个成员的会话读不出来（**不是**"它没派过"）
 *   `not-started` —— 它还没有会话 id（没起来过）⇒ 它不可能派过
 *
 * ★★ 为什么 `unmeasured` 不许并进 0：那会让"我没能读它"与"它确实一个都没派"
 *   在读数上同形 —— 而前者是**要人去查**的，后者是**形态没被执行**的证据。
 *   本仓记了十几次的那条合流，这一格是它最新的一次机会。
 */
export type MemberDispatchReadout = {
    readonly status: 'read';
    /** 累计派出过的 worker 数（`subagent/catalog` 事件条数）。 */
    readonly dispatched: number;
    /**
     * ★ 形状坏掉的 catalog 条数（有 `subagent/catalog` 而 `childId` 读不出）。
     *   它**不在** `dispatched` 里，但也不被静默丢掉 —— 于是
     *   "读到 3 个 + 2 条读不出"与"读到 5 个"不同形。
     */
    readonly unreadableEvents: number;
    /** 最近一次派出的 worker；没派过 ⇒ 缺席（**不是**编一个空对象）。 */
    readonly latest?: {
        readonly childId: string;
        readonly createdAt?: number;
        readonly label?: string;
    };
}
/** 成员的会话读不到 ⇒ 判不了。★ 与"一个都没派"不同形。 */
 | {
    readonly status: 'unmeasured';
    readonly reason: string;
}
/** 成员还没有会话 id（没起来过）⇒ 它不可能派过。★ 与上面两者不同形。 */
 | {
    readonly status: 'not-started';
};
/** 读不出会话事件时的成因（诊断面，不改变裁决）。 */
export declare const DISPATCH_EVENTS_UNREADABLE = "this member carries no readable session event log, so how many temporary workers it dispatched cannot be counted";
/**
 * 从**一个成员自己的会话事件**里数出它派出过几个 sub-agent。
 *
 * ★ 纯函数：不碰 `ctx`、不做 I/O。I/O 由调用方做（与 `attributeSubagents` /
 *   `summariseExecutions` 同一条纪律）。
 *
 * ★ `undefined` 与 `[]` 必须不同形：前者是"读不到日志"（`unmeasured`），
 *   后者是"读到了，确实一条 catalog 都没有"（`read` + `dispatched: 0`）。
 */
export declare function dispatchReadoutOf(events: readonly unknown[] | undefined): MemberDispatchReadout;
/**
 * 读一个成员的**派工读数**（`shape` 的执行判据的输入面）。
 *
 * ★ I/O 在这里、判断在 {@link dispatchReadoutOf}：与 `memberLiveness` /
 *   `memberSubagents` 同一分工。★ 读会话事件走的是 `sessionOwnEvents` ——
 *   与 `observedChangedPaths` / `observedSpoke` 同一个入口（不是新造的读法）。
 */
export declare function memberDispatchReadout(ctx: Context, member: {
    readonly id: string;
}): MemberDispatchReadout;
/**
 * ── ★★★ 一行派工读数：**这个成员干过活吗、以及它派过人吗** ────────────────────
 *
 * 两格**并列而不合并**，因为它们是两个不同的事实来源：
 *   · `executedTasks` —— 读 `team.json` 的任务（谁名下有过跑到终态的任务）
 *   · `dispatch`     —— 读**会话事件**（它派出过几个 worker）
 *
 * ★★ 合并成一个布尔会让三种完全不同的情形同形：
 *     「干过活、也派过」 / 「干过活、一个都没派（形态没被执行）」 / 「我没能读到它的派工」
 *   而它们的补救动作分别是：无需动作 / 去让人按形态派 / 去查为什么读不到。
 */
export interface MemberDispatchRow {
    readonly name: string;
    /** 它名下跑到过终态的任务数（= 它**确实干过活**的可判定证据）。 */
    readonly executedTasks: number;
    /** 派工读数（三态之一，见 {@link MemberDispatchReadout}）。 */
    readonly dispatch: MemberDispatchReadout;
}
/**
 * 从**团队记录 + 一份派工读数函数**算出每行的派工读数。
 *
 * ★ 纯函数：`readoutOf` 由调用方注入（与 `strandedWorktrees(candidates, dirtyOf)`、
 *   `attributeSubagents(refs, memberIds)` 同一分工）。⇒ 夹具可以在**不造会话**的前提下
 *   把三态逐条喂进来 —— 那是这一格能被钉住的前提。
 *
 * @param members - 团队名册（`removed` 的成员不计：它们不会再被派活）。
 * @param tasks - 团队任务（用来看谁**真的**干过活）。
 * @param readoutOf - 成员 → 派工读数。
 */
export declare function memberDispatchRows(members: readonly Pick<TeamMember, 'name' | 'status'>[], tasks: readonly Pick<TeamTask, 'assignee' | 'status'>[], readoutOf: (name: string) => MemberDispatchReadout): MemberDispatchRow[];
/**
 * ── ★★★ `shape: 'dispatch'` 的**执行读数**：这个队的成员真的在派临时 worker 吗 ──
 *
 * 上一轮形态验证的结论（`docs/SHAPE-VERIFICATION-PROBE-1.md` §4）：
 * **`shape` 是一条声明，而"声明有没有被执行"今天没有读数。**
 * 一个 `shape: 'dispatch'` 的队如果成员全都自己干活，**没有任何一条臂会红**。
 *
 * ── 三态（缺席不许并进任何一种）────────────────────────────────────────────────
 *
 *   `not-applicable` —— 这个队不是 dispatch 形态（`shape` 是 `'flat'` 或**缺席**）
 *                      ★ 缺席是存量队的合法状态，**不是** unmeasured：这一格对它们
 *                        根本没有"该不该派"可言（见 `TeamState.shape` 的三态纪律）。
 *   `measured`       —— 读了；`violations` 是**干过活却一个都没派**的成员名
 *   `unmeasured`     —— 该说法的输入面读不到（有的成员派工读不出来）
 *                      ★ 与"零违规"不同形：后者才能说"形态被执行了"
 */
export type ShapeExecutionReadout = {
    readonly status: 'not-applicable';
    readonly reason: string;
} | {
    readonly status: 'measured';
    /** 干过活却一个临时 worker 都没派的成员名（**空数组 = 读了、确实没有违规**）。 */
    readonly violations: readonly string[];
    /** 参与判定的成员行（读的人要能复核每一行，而不是只读一个结论）。 */
    readonly rows: readonly MemberDispatchRow[];
} | {
    readonly status: 'unmeasured';
    readonly reason: string;
    readonly rows: readonly MemberDispatchRow[];
};
/**
 * 把派工行折成"这个队的形态被执行了吗"。
 *
 * ★ 纯函数（行由调用方算）。★ 判定只读两格：`executedTasks > 0` 且 `dispatch.dispatched === 0`。
 *   一个**没干过活**的成员不算违规 —— 它没有机会派工，把它算进去会让
 *   "队里有一个还没开工的成员"读成"形态没被执行"。
 */
/**
 * 一个队的 `shape` 执行读数 —— **I/O 在这里，判断在 {@link shapeExecutionOf}**。
 *
 * ★ 只有 `shape === 'dispatch'` 才去读会话：一个 flat / 缺席的队没有"该不该派工"
 *   可言，读它只是白跑一轮 `ctx.agents` 枚举（面板是轮询的）。
 *
 * ★ 名册里查不到行 ⇒ 那一行走 `unmeasured`（**不**静默跳过）：
 *   跳过会让"这个成员我没读到"与"这个成员没违规"同形。
 */
export declare function shapeExecutionFor(ctx: Context, team: TeamState): ShapeExecutionReadout;
/**
 * ── ★★★ 把 `shape` 的**声明**与**执行**读成一句人能读的话（2026-10-20）───────
 *
 * `src/capabilities.ts:185` 与 `src/types.ts:1273` 早就引用了这个名字，而它
 * **此前不存在** —— 那正是本仓记账的那类形态：注释里写好了去向，代码里没有那一步。
 * ⇒ 现在它是真的，并且由 `agent_teams_status` 的 `team_shape` 那一格接上。
 *
 * ── ★★ 为什么"声明"与"执行"必须**两句话** ─────────────────────────────────────
 *
 * 上一轮形态验证的结论是：**声明有没有被执行，此前没有读数。**
 * 把两者合成一句（例如"这是一个 dispatch 队，运作正常"）会让
 * "声明了、也照做了"与"声明了、全员自己干"读起来一样。
 *
 * 三态 × 三态 = 九格，而以下四种**必须两两不同形**：
 *
 *   ① 声明 dispatch，执行合规（`dispatched > 0` 的人多于零）    ⇒ 「按形态在跑」
 *   ② 声明 dispatch，全员自己干（`violations` 非空）             ⇒ 「形态没被执行」
 *   ③ 声明 dispatch，读不到派工（`unmeasured`）                   ⇒ 「判不了」
 *   ④ 未声明（存量队）/ `flat`                                   ⇒ 「没有这个说法」
 */
export declare function describeTeamShape(shape: TeamState['shape'] | undefined, execution: ShapeExecutionReadout): string;
export declare function shapeExecutionOf(shape: TeamState['shape'] | undefined, rows: readonly MemberDispatchRow[]): ShapeExecutionReadout;
export {};
