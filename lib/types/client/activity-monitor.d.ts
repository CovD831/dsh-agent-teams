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
/** One captain-inbox preview row. */
export interface ActivityMessage {
    readonly from: string;
    readonly content: string;
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
}
/** A successfully-created conversation card that currently needs updates. */
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
