/** Shared, demand-driven state for the AgentTeams browser monitor. */
/**
 * The three-way classification of a `failed` task: why it stopped.
 *
 * Its values mirror the host's `FailureKind` (`src/state.ts` `failureKindOf`) and
 * are deliberately NOT renamed here, so a third vocabulary cannot appear.
 * This is the presentation-side mirror of a server fact, not a second source of
 * truth: the client never recomputes the rules, only renders the value it got.
 */
export type TaskFailureKind = 'inconclusive' | 'failed_delivery' | 'failed_context';
/** Every classification the client can render for a task's terminal state. */
export type TaskFailureTone = TaskFailureKind | 'unknown';
/**
 * Render-facing classification of a terminal failure.
 *
 * ★ `unknown` is load-bearing, not a default to be styled away: an absent or
 *   unrecognised `failureKind` means "the host did not measure this", which must
 *   never be drawn as any of the three measured kinds. It falls back to today's
 *   single `failed` behaviour instead — see {@link taskFailureTone}.
 */
export declare const TASK_FAILURE_TONES: readonly TaskFailureTone[];
/** Task shape needed to classify a failure (the optional kind field plus status). */
export interface FailureKindTask {
    readonly status: string;
    /** Published by the host only for a task whose status is `failed`. */
    readonly failureKind?: string;
}
/**
 * Classify one task's terminal state for rendering.
 *
 * Returned per task so the UI can render the three states distinctly AND so a
 * test can assert *why* without reading CSS.
 *
 * @param task - host task row; `failureKind` may be absent on older hosts.
 * @returns `'inconclusive'` (review found problems — the gate did its job),
 *   `'failed_delivery'` (the deliverable really broke),
 *   `'failed_context'` (no measured evidence), or `'unknown'`.
 */
export declare function failureToneOf(task: FailureKindTask): TaskFailureTone;
/**
 * Whether this terminal task should read as amber convergence rather than red.
 * True only when the host MEASURED that the review/repair loop did its job.
 */
export declare function isConsultativeFailure(task: FailureKindTask): boolean;
/** Whether this terminal task carries measured evidence that the work broke. */
export declare function isBrokenFailure(task: FailureKindTask): boolean;
/** Whether nothing was measured either way — neither red nor green. */
export declare function isUnmeasuredFailure(task: FailureKindTask): boolean;
/** One member row of a host snapshot. */
export interface ActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly executionPrompt?: string;
    readonly status?: 'idle' | 'working' | 'removed';
    readonly activity: 'working' | 'idle' | 'unknown';
    /**
     * Session-liveness state published by the host: whether the member's session
     * is still alive at all. ★ Distinct from `activity`, which is a durable field
     * that keeps saying `working` after the session dies; absent on older hosts.
     */
    readonly liveness?: string;
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    readonly unread: number;
}
/** One task row of a host snapshot. */
export interface ActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly description?: string;
    readonly status: string;
    readonly state: 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled';
    readonly assignee: string;
    readonly model?: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    readonly kind?: string;
    readonly round?: number;
    readonly verdict?: string;
    /**
     * Why a `failed` task stopped, as classified by the host (see TaskFailureKind).
     * ★ Optional: older snapshots and non-failed tasks omit it, and the UI must
     *   then fall back to the undifferentiated failure rather than guessing.
     */
    readonly failureKind?: string;
    /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
    readonly updatedAt?: number;
}
/**
 * One captain-inbox row, mirroring the host `TeamActivityMessage`
 * (`src/snapshot.ts`) field for field, in the same order.
 *
 * ★★ t102：这是**九格**，此前只有 `{from, content}` 两格 —— 而服务端在
 *   t100 已经扩到九格。两边**分叉**过一次（与 `FLOW_STAGES` 那次同形）：
 *   数据一直在载荷里，**类型只让调用方看见两格**。
 *   ⇒ 顺序与命名**必须**与服务端一致，否则下一个人要对着两份定义比。
 *
 * ★ 为什么 `id` / `ts` / `read` 不省略：
 *   · `id` —— 没有它，两行**同文**的消息无法区分（"同一条"与"两条一样的"同形）；
 *   · `ts` —— 排序键。★ 不是数组下标：截断之后下标会与时刻**分叉**；
 *   · `read` —— 「已读」是**一条事实**。★ 已读的消息**仍然在**投影里
 *     （t100 特意从 `readUnreadMailbox` 换成 `readMailbox`），
 *     否则线程会自己变短，而"消息没了"与"从来没发过"同形。
 */
export interface ActivityMessage {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly content: string;
    readonly ts: number;
    /** ★★ `sourceTaskId` —— **一条对话线程的分组键**。 */
    readonly taskId?: string;
    readonly attemptId?: string;
    readonly taskStatus?: string;
    /** ★ `readAt` 在场 ⇒ 已读。★★ 已读的消息**仍然**在投影里。 */
    readonly read: boolean;
}
/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly phase: 'staged' | 'running';
    readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback';
    readonly halted?: boolean;
    readonly members: readonly ActivityMember[];
    readonly tasks: readonly ActivityTask[];
    readonly messageCount: number;
    readonly captainInbox: readonly ActivityMessage[];
    /**
     * ── ★★★ t102：`captainInbox` 的**三态**（与那两格消息**并列**，不替换）──────
     *
     *     'absent'  —— 服务端**没给**（字段缺席 / 非数组）⇒ "读不到"
     *     'empty'   —— 服务端**给了空数组** ⇒ "确实没有"
     *     'present' —— 给了 N 条
     *
     * ★ 为什么它必须存在：没有它，「读不到」与「确实没有」在类型上**同形**，
     *   而补救动作相反（前者查服务端，后者什么都不用做）。
     */
    readonly captainInboxState: 'absent' | 'empty' | 'present';
    /** ★ 形状不对、读不出来的条目数 —— **不静默丢**（丢一条与"没有它"同形）。 */
    readonly captainInboxUnreadable: number;
}
/**
 * ── ★★★ t102：`captainInbox` 的第一个消费者 ──────────────────────────────────────
 *
 * ── 它修的是什么（MEASURED）────────────────────────────────────────────────────
 *
 * 改前全仓 `captainInbox` 只有两处（`grep -rn "captainInbox" src/client/`）：
 *
 *     activity-monitor.ts:143   readonly captainInbox: readonly ActivityMessage[]   ← 只有声明
 *     ActivityPanel.tsx:362     captainInbox: [],                                   ← 硬编码空
 *
 * 而**活的那条路**（`body.teams as readonly ActivityTeam[]`）是**纯类型断言**：
 * 服务端给什么就是什么 ⇒ `captainInbox` **没有任何东西保证它存在**。
 * ⇒ 服务端**没给**时 `team.captainInbox` 是 `undefined`，而类型说它是数组 ——
 *   ★ **「没给」与「给了空数组」在类型上同形**，而那正是本仓记账最久的形状。
 *
 * ── ★★ 三态（本函数的全部意义）─────────────────────────────────────────────────
 *
 *     'absent'    —— 服务端**没给**这个字段（字段缺席 / 不是数组 / `null`）
 *                    ★ 与"给了空数组"**不同形**：前者是"读不到"，后者是"确实没有"
 *     'empty'     —— 服务端**给了**，而且是空数组（真的没有消息）
 *     'present'   —— 服务端给了 N 条
 *
 * ★ 为什么 `'absent'` 不熔进 `'empty'`：那会让「**这支队读不到消息**」与
 *   「**这支队没有消息**」变成同一句话 —— 而补救动作相反（前者要查服务端，后者什么都不用做）。
 *
 * ── 为什么在**这里**做，而不是在渲染处 ──────────────────────────────────────────
 *
 * 渲染是形态决策（队长在等用户定 A/B/C），本任务边界是**让数据可读**。
 * ⇒ 这里只保证"读得到且三态可分"，不决定画在哪。
 *
 * @param raw - the raw payload field, of unknown shape.
 * @returns the readout, plus the rows themselves (empty unless present).
 */
export declare function readCaptainInbox(raw: unknown): {
    readonly state: 'absent' | 'empty' | 'present';
    readonly messages: readonly ActivityMessage[];
    /** ★ 只读得到形状、读不到的条目数：**不静默丢掉**（丢一条会让"少了一条"与"没有它"同形）。 */
    readonly unreadable: number;
};
export interface ActivityMonitorTarget {
    readonly key: string;
    readonly sessionId: string;
    readonly teamId: string;
}
/** Latest shared response data for both the floater and conversation cards. */
export interface ActivitySnapshots {
    readonly teams: readonly ActivityTeam[];
    readonly archivedTeams: readonly ActivityTeam[];
}
/** Subscribe to the active monitor-target list (React external-store shape). */
export declare function subscribeActivityMonitorTargets(listener: () => void): () => void;
/** Read the stable active-target snapshot. */
export declare function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[];
/**
 * Register one successful AgentTeams card as a monitoring demand.
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export declare function monitorAgentTeam(sessionId: string, teamId: string): () => void;
/** Stop polling targets whose final archived snapshot has been captured. */
export declare function settleActivityMonitorTargets(keys: ReadonlySet<string>): void;
/** Subscribe to the shared live/archive snapshot. */
export declare function subscribeActivitySnapshots(listener: () => void): () => void;
/** Read the stable shared live/archive snapshot. */
export declare function getActivitySnapshotsSnapshot(): ActivitySnapshots;
/**
 * Publish one or both successful state-route responses.
 *
 * ★★★ 通知的条件是【**内容**变了】，不是【对象换了】（t31）。
 *   判据见 {@link contentEquals}；"为什么引用比较在这里恒不成立"也写在那一格。
 */
export declare function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void;
/** Poll cadence for the live host snapshot route. */
export declare const ACTIVITY_POLL_MS = 1000;
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped agent_teams_create) without turning
 * every ordinary session into a one-second filesystem scan.
 */
export declare const ACTIVITY_PROBE_MS = 5000;
/** Host route serving live and archived team snapshots. */
export declare const ACTIVITY_STATE_URL = "/plugins/dsh-agent-teams/state";
export declare const ACTIVITY_HALT_URL = "/plugins/dsh-agent-teams/halt";
interface ActivityFetchResponse {
    readonly ok: boolean;
    json(): Promise<unknown>;
}
/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
    /** Connection health for views; never clears the last successful snapshot. */
    readonly onStatus?: (status: 'ready' | 'error') => void;
    /**
     * Current captain session to discover after a cold client/host restart.
     * This one-time scope restores teams whose older conversation log has no
     * AgentTeams card capable of registering an explicit monitor target.
     */
    readonly discoverySessionId?: string;
    readonly fetchState?: (url: string, init: {
        readonly cache: 'no-store';
        readonly signal: AbortSignal;
    }) => Promise<ActivityFetchResponse>;
    readonly schedule?: (callback: () => void, intervalMs: number) => unknown;
    readonly cancel?: (timer: unknown) => void;
    readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void;
    readonly settleTargets?: (keys: ReadonlySet<string>) => void;
}
/** Handle returned by one current-session polling loop. */
export interface ActivityPollingController {
    /** The immediate first pass, exposed so offline verification can await it. */
    readonly firstTick: Promise<void>;
    /** Idempotently stop the timer and abort the current request. */
    stop(): void;
}
/**
 * Start the single polling loop for the current session's requested targets.
 *
 * With neither targets nor a discovery session this is deliberately inert.
 * Explicit card targets poll at the live cadence from the start. A discovery
 * session performs an immediate live+archive restore pass, then — while it
 * still owns no team — probes on a low-frequency cadence, so a team created
 * later in that session (e.g. a run_code-wrapped agent_teams_create) is
 * discovered without a manual reload, without turning every ordinary session
 * into a one-second filesystem scan. The moment a team for the discovery
 * session appears, the controller upgrades to the live one-second cadence for
 * the rest of its lifetime. The caller — the session view, which stops the
 * controller when the session is no longer current — bounds the lifetime, and
 * archive state is refreshed when a target or a previously discovered live
 * team disappears.
 */
export declare function startActivityPolling(monitorTargets: readonly ActivityMonitorTarget[], runtime?: ActivityPollingRuntime): ActivityPollingController;
export {};
