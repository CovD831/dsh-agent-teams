/** Pure relationship projections used by the AgentTeams activity panel. */
/**
 * Statuses after which a task no longer moves; every other status is open work.
 * ★ Single source for this fact: both the loop projection and the member clock
 *   read it from here, so a second list cannot drift out of step.
 */
export declare const TERMINAL_TASK_STATUSES: readonly ["completed", "failed", "cancelled"];
/** Whether a task stopped for good, independent of why. */
export declare function taskIsTerminal(status: string): boolean;
/** Minimum task shape needed to derive dependency relationships. */
export interface RelationshipTask {
    readonly id: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
}
/** One dependency-depth stage in stable display order. */
export interface RelationshipStage<T extends RelationshipTask> {
    readonly depth: number;
    readonly tasks: readonly T[];
}
/** Geometry used by the compact task DAG in the activity panel. */
export interface CompactDagNode<T extends RelationshipTask> {
    readonly task: T;
    readonly x: number;
    readonly y: number;
}
/** One dependency edge routed between two compact DAG nodes. */
export interface CompactDagEdge {
    readonly from: string;
    readonly to: string;
    readonly path: string;
}
/** Complete, scrollable compact DAG projection. */
export interface CompactDagLayout<T extends RelationshipTask> {
    readonly width: number;
    readonly height: number;
    readonly nodes: readonly CompactDagNode<T>[];
    readonly edges: readonly CompactDagEdge[];
}
/** Reference-panel geometry: narrow nodes with enough room for curved edges. */
export declare const COMPACT_DAG_NODE_WIDTH = 92;
export declare const COMPACT_DAG_NODE_HEIGHT = 30;
export declare const COMPACT_DAG_COLUMN_GAP = 26;
export declare const COMPACT_DAG_ROW_GAP = 8;
/** Compact `provider/model` route, or just the model when the provider is absent. */
export declare function memberRouteLabel(member: {
    readonly provider?: string;
    readonly model?: string;
} | undefined): string;
/**
 * Compact route shown on a running task. Prefer the task's own snapshot
 * field; fall back to the assignee member when older hosts omit it.
 */
export declare function taskModelLabel(task: {
    readonly model?: string;
    readonly assignee: string;
}, members: readonly {
    readonly name: string;
    readonly provider?: string;
    readonly model?: string;
}[]): string;
/** Short model id for tight DAG/chip surfaces (`openai/gpt-5.6-sol` → `gpt-5.6-sol`). */
export declare function compactModelLabel(route: string): string;
/** A live team the current captain still owns and has not halted. */
export declare function liveCaptainTeam<T extends {
    readonly captainSessionId: string;
    readonly halted?: boolean;
}>(teams: readonly T[], sessionId: string | undefined): T | undefined;
/** Minimal member shape needed to order the delegation list (issue #192). */
export interface MemberListEntry {
    readonly name: string;
    readonly activity?: string;
    readonly status?: string;
}
/** Minimal task shape needed to derive a member's finish time (issue #192). */
export interface MemberFinishTask {
    readonly assignee: string;
    readonly status: string;
    readonly updatedAt?: number;
}
/**
 * Latest terminal-task `updatedAt` owned by one member.
 * @param memberName - member whose owned tasks are scanned.
 * @param tasks - team tasks carrying durable `updatedAt` stamps.
 * @returns the newest terminal stamp, or undefined when the member owns none.
 */
export declare function memberFinishedAt(memberName: string, tasks: readonly MemberFinishTask[]): number | undefined;
/**
 * Order the delegation member list for issue #192.
 *
 * Running members keep their incoming relative order and come first; finished
 * members follow sorted by finish time, newest first. Members without a
 * derivable finish time keep their incoming relative order after the stamped
 * ones, so an older host that omits stamps never reorders them randomly.
 * @param members - delegation roster in snapshot order.
 * @param tasks - team tasks carrying durable `updatedAt` stamps.
 * @returns the members in display order.
 */
export declare function orderDelegationMembers<TMember extends MemberListEntry>(members: readonly TMember[], tasks: readonly MemberFinishTask[]): readonly TMember[];
/** Whether the captain chat should keep showing the in-progress banner. */
export declare function teamIsActive(team: {
    readonly phase?: string;
    readonly halted?: boolean;
    readonly members: readonly {
        readonly status?: string;
        readonly activity?: string;
    }[];
    readonly tasks: readonly {
        readonly status: string;
    }[];
}): boolean;
/** Compact banner copy: running members, otherwise the current planning state. */
export declare function teamProgressSummary(team: {
    readonly members: readonly {
        readonly name: string;
        readonly status?: string;
        readonly activity?: string;
        readonly currentTask?: string;
    }[];
    readonly tasks: readonly {
        readonly id: string;
        readonly subject: string;
        readonly status: string;
    }[];
}, separator: string): {
    readonly working: number;
    readonly detail: string;
};
/** Use a fill-width grid when the task graph has no real dependency edges. */
export declare function usesParallelTaskGrid<T extends RelationshipTask>(tasks: readonly T[]): boolean;
/**
 * Whether an expanded activity panel still belongs to the current session.
 *
 * The panel is mounted in the root-scoped shell overlay, so React does not
 * remount it when the conversation route changes. Ownership keeps an expanded
 * panel from leaking onto the new-session screen (or another conversation)
 * while its local open state is being reset.
 */
export declare function activityPanelExpandedForSession(open: boolean, owner: string | undefined, current: string | undefined): boolean;
/** Inputs for deciding whether genuinely new live work may expand the panel. */
export interface ActivityPanelAutoExpandInput {
    readonly alreadyAutoOpened: boolean;
    readonly pageSettled: boolean;
    readonly restoreComplete: boolean;
    readonly previousLiveTeamIds: ReadonlySet<string>;
    readonly currentLiveTeamIds: readonly string[];
}
/**
 * Auto-expand only for live teams that appear after the current session's
 * initial restore pass. Replayed cards, archived teams, and live teams restored
 * while reopening a conversation must remain behind the collapsed badge.
 */
export declare function activityPanelShouldAutoExpand({ alreadyAutoOpened, pageSettled, restoreComplete, previousLiveTeamIds, currentLiveTeamIds, }: ActivityPanelAutoExpandInput): boolean;
/**
 * Resolve the task whose dependency chain should be highlighted.
 *
 * A pinned task is an explicit user choice. Keyboard focus takes precedence
 * over delayed pointer intent so an older hover timer cannot steal the active
 * chain from someone navigating the task map with the keyboard.
 */
export declare function dependencyFocusTaskId(pinnedTaskId: string | null, keyboardTaskId: string | null, hoverTaskId: string | null): string | null;
/** Minimal task shape needed to classify a failure outcome for rendering. */
export interface LoopTask {
    readonly id: string;
    readonly status: string;
    readonly round?: number;
    /** The host's classification when `status` is `failed`; absent on older hosts. */
    readonly failureKind?: string;
}
/** Presentation tone for one terminal outcome, including the undifferentiated fallback. */
export type LoopTone = 'converging' | 'failed' | 'unmeasured' | 'blocked' | 'open' | 'running' | 'completed' | 'cancelled';
/**
 * Render-facing tone of one terminal task.
 *
 * ★ This is the one place the three outcomes become three UI states. The
 *   distinction is the whole point: a review that returned `needs_revision`
 *   (inconclusive) did its job and must read as convergence; a broken
 *   deliverable must stay red; an unmeasured stop is neither.
 */
export declare function taskLoopTone(task: LoopTask): LoopTone;
/** How long one review/repair round has been reported as running. */
export interface RoundElapsed {
    readonly round: number;
    readonly ms: number;
}
/**
 * One review/repair round: its durable index, its tasks, and its tone.
 *
 * ★ The tone is the round's, not any single task's: a round where the review
 *   found problems is converging even while its repair is still running, so the
 *   marker stays amber instead of flipping through every task's own colour.
 */
export interface LoopRound<T extends LoopTask> {
    readonly round: number;
    readonly tasks: readonly T[];
    readonly tone: LoopTone;
}
/** Complete, display-ordered review/repair loop projection. */
export interface ReviewLoop<T extends LoopTask> {
    readonly rounds: readonly LoopRound<T>[];
    /** Durable task ids carrying an explicit round index. */
    readonly tracked: number;
}
/**
 * The tone of one round as a whole.
 *
 * Precedence is deliberate: an unsettled outcome outranks a settled one, so a
 * round whose review found problems cannot be painted green by the completed
 * tasks riding alongside it. Within the unsettled group the order is
 * failed > converging > unmeasured > running, i.e. the most consequential
 * reading wins, and a round with nothing left to decide reads as completed.
 */
export declare function roundTone<T extends LoopTask>(tasks: readonly T[]): LoopTone;
/**
 * How abnormal a loop is, derived only from the durable round tones.
 *
 * ★ `abnormal` includes `converging` on purpose. The first-party rule opens
 *   abnormal levels so the marker can be seen; a collapsed amber marker is
 *   invisible, and invisible is indistinguishable from absent — which would
 *   quietly turn "the gate found problems" back into "nothing happened".
 */
export type LoopMode = 'abnormal' | 'running' | 'clean';
/** Durable facts about a loop, with no UI state mixed in. */
export interface LoopFacts {
    readonly mode: LoopMode;
    /** Count of tracked round tasks; a new round changes this. */
    readonly count: number;
}
/** Disclosure state: durable facts plus the user's explicit choice. */
export interface LoopDisclosure extends LoopFacts {
    readonly open: boolean;
    /** True once the user toggled; their choice then outranks the derived default. */
    readonly userSet: boolean;
}
/**
 * Derive a loop's disclosure facts from durable data.
 *
 * @param loop - the loop projection.
 * @param discarded - a discarded plan has no outcomes, only "never ran".
 */
export declare function loopFacts<T extends LoopTask>(loop: ReviewLoop<T>, discarded?: boolean): LoopFacts;
/**
 * Resolve the next disclosure state.
 *
 * ★ With no previous state the initial value is rebuilt from the durable facts,
 *   never remembered from a prior mount: a remount must not silently hide a
 *   loop that the facts say is abnormal.
 *
 * ★ Once `userSet`, an unchanged set of facts leaves the user's choice alone —
 *   that is what "the choice survives re-renders" means. But escalation or a
 *   new round reopens it: something happened, and hiding it would be the same
 *   defect as collapsing it in the first place.
 */
export declare function nextLoopDisclosure(current: LoopDisclosure | undefined, facts: LoopFacts): LoopDisclosure;
/** Apply one explicit user toggle; the result is a user choice from then on. */
export declare function toggleLoopDisclosure(current: LoopDisclosure): LoopDisclosure;
/** Whether a review/repair loop exists: ≥2 rounds, the shape a single run never has. */
export declare function hasReviewLoop<T extends LoopTask>(tasks: readonly T[]): boolean;
/**
 * Project the review/repair loop as ordered rounds with round markers.
 *
 * A review that returns `needs_revision` is not a failure: the host generates
 * the next round (`planQualityFollowUp` in src/quality-gates.ts). Reading that
 * as an unrelated red task is exactly what this projection exists to prevent,
 * so tasks are grouped by their durable `round` index instead of being listed
 * by id and hoping the reader notices `review-round-2` follows `review-round-1`.
 *
 * @param tasks - team tasks; only those carrying a `round` index participate.
 * @returns rounds ascending by index; the ascending order IS the loop.
 */
export declare function reviewLoop<T extends LoopTask>(tasks: readonly T[]): ReviewLoop<T>;
/**
 * ── ★★★ R2：把轮次搬到成员行上（用户原话：round data moves UP into screen one）──
 *
 * MEASURED（用户 2026-10-11）：轮次/收敛原本单占一块（`ReviewLoopSection`），
 * 而成员行上**一个字都没有**。于是"这个成员在第几轮、那一轮什么结果"要看第二处
 * 才知道 —— 而用户要的第一屏口径是"整队在不在动、谁在做什么"。
 *
 * ★ 口径是**成员自己的**轮次，不是全队的：一个成员名下带 `round` 的任务里最大的
 *   那一轮。缺席 ⇒ `undefined`（"没有轮次概念"），**不是** `0`（"第 0 轮"）——
 *   两者必须不同形（与 `TeamActivityMember.round` 同一条判据，且不在这里重算规则）。
 *
 * ★ 反向半边：同一批任务，只看**这个成员的**任务 —— 一个把全队最大轮次印到每个人
 *   身上的实现，会让没参与那一轮的成员也印着"第 N 轮"。
 * @param tasks - the member's OWN tasks.
 * @returns the member's highest round, or undefined when none carries one.
 */
export declare function memberRound(tasks: readonly LoopTask[]): LoopRound<LoopTask> | undefined;
/** One status tail value: which durable task states map to which tail text. */
export type RoundTailCountKey = 'converging' | 'failed' | 'unmeasured' | 'running' | 'completed';
/** Locale key of one round-tail count. */
export type RoundTailKey = `round.tail.${RoundTailCountKey}`;
/**
 * Format one round's status tail as counts per outcome.
 *
 * Statuses that need a decision come first and always list together, so a round
 * that found problems never reads as "everything finished". Completed rides
 * along only when the round is otherwise still open, mirroring the first-party
 * `phaseStatusSummary` ordering (completed leading when nothing is active).
 *
 * ★ The tail only ever counts outcomes the host actually measured: an
 *   unclassified failure falls back to `failed` inside {@link taskLoopTone},
 *   which is today's behaviour, so the tail never invents a fourth kind.
 */
export declare function roundTailCounts<T extends LoopTask>(tasks: readonly T[], t: (key: string, params?: Record<string, unknown>) => string, separator: string): string;
/**
 * Locale keys for one round-tail count.
 *
 * These reuse the pre-existing `task.status.*` vocabulary on purpose: adding a
 * parallel `round.*` dictionary would be a second source of truth for the same
 * words, and the two sets would drift the moment one of them is edited.
 */
export declare const ROUND_TAIL_LABEL: Readonly<Record<RoundTailCountKey, string>>;
/**
 * ── ★★★ R2：**谁该拥有秒表** ──────────────────────────────────────────────────
 *
 * MEASURED（R2 开工时）：秒表原本挂在 1599 行的 `TeamSection` 上 ——
 * `useElapsedNow` 一 tick，**整棵面板树重渲染**。而它每秒都在跑，
 * 哪怕队里只有一个人在动。
 *
 * ★ 判据（契约原句）："Only members that actually have a running clock
 *   subscribe to ticks; an idle or waiting member does not keep a timer alive."
 *
 * ★ 为什么只有 `running` 一格为真，另三格各自说清：
 *   · `running` ⇒ 时长**每秒都在变**（`now − updatedAt`）⇒ 必须有人 tick，否则读数不动。
 *   · `stale`   ⇒ 时长同样在变，但它数的是"没人推进它"——★ 而它是**告警**，
 *                 不是进度；让它每秒重排一次会把一个静态的坏消息画成"还在动"。
 *                 ⇒ 它读一次就够了（值本身就是"最后一次改动以来"）。
 *   · `idle`    ⇒ **不带时长**（`ms` 恒为 0）⇒ tick 只会重渲染一个不动的字符串。
 *   · `unknown` ⇒ 读不出戳 ⇒ 同样没有可更新的数字。
 *
 * ★ 反向半边（缺了它，一个"恒返回 true"的实现会让面板每秒重渲染每一行，
 *   而每一条断言照样绿）：本函数对四种读数**必须**给出**不同**的答案。
 * @param kind - the member's elapsed readout.
 * @returns whether a live per-second ticker is required for that readout.
 */
export declare function memberClockTicks(kind: MemberClockKind): boolean;
/**
 * One live subagent as the panel reads it off /state.
 *
 * ★ Declared structurally rather than imported from the host half: the payload
 *   crosses the wire as JSON, and a client that typed it from `src/members.ts`
 *   would make a server-side refactor a browser-only breakage.
 */
export interface MemberSubagent {
    readonly id: string;
    readonly label: string;
    readonly mode?: 'one-shot' | 'continuable';
    readonly status: string;
    readonly parentSession?: string;
}
/** What a member's subagent layer can say: measured, or not measured. */
export type MemberSubagentState = 'observed' | 'could-not-measure';
/** The per-member subagent readout as it reaches the panel. */
export interface MemberSubagentReadout {
    readonly state: MemberSubagentState;
    readonly subagents: readonly MemberSubagent[];
    readonly reason?: string;
}
/**
 * Read one member's subagent layer off the `/state` payload.
 *
 * ★★★ 三态不许塌：`observed` + 空数组是"**读了**，真的没有"；
 *   `could-not-measure` 是"**没读成**"。把后者圆成前者会让面板永远印着
 *   "没有子代理" —— 而那与"确实没有"在读者眼里**同形**（本仓三态纪律，
 *   也是 t27 立这一格的唯一理由）。
 *
 * ★ 缺省（老宿主根本没有这一格）同样归入 `could-not-measure`，而不是
 *   "这个成员没有子代理"：老宿主不是"测到了没有"，是"没这块数据"。
 * @param member - one member row from the snapshot (read structurally).
 * @returns the tri-state readout, with the host's own reason when it gave one.
 */
export declare function memberSubagentReadout(member: {
    readonly subagents?: string;
    readonly liveSubagents?: readonly MemberSubagent[];
    readonly subagentsReason?: string;
}): MemberSubagentReadout;
/**
 * Presentation tone of one subagent's own status.
 *
 * ★ `unknown` is a real third answer, not a default to be styled away: the host
 *   hands the raw session status through (`running` / `idle` / anything), and a
 *   value we do not recognise must not be rounded to "working".
 */
export type SubagentTone = 'working' | 'idle' | 'unknown';
/**
 * Classify one live subagent's status for rendering.
 * @param status - the raw session status as the host reported it.
 * @returns `working`, `idle`, or `unknown` for anything unrecognised.
 */
export declare function subagentTone(status: string): SubagentTone;
/**
 * One member row's disclosure state.
 *
 * ★ The map is keyed by member id (falling back to name for pre-spawn rows) so a
 *   poll that reorders the roster cannot hand one member's expansion to another.
 */
export type MemberExpansion = ReadonlyMap<string, boolean>;
/** Stable key for one member row's expansion slot. */
export declare function memberRowKey(member: {
    readonly id?: string;
    readonly name: string;
}): string;
/**
 * Whether one member row is expanded.
 *
 * ★ Collapsed by default is a *value*, not an absent branch: an unmapped row
 *   reads `false`, so a fresh render can never accidentally open every row.
 * @param expansion - the panel's expansion store.
 * @param key - the row's stable key (see {@link memberRowKey}).
 */
export declare function memberRowExpanded(expansion: MemberExpansion, key: string): boolean;
/**
 * Apply one explicit user toggle to the expansion store.
 *
 * ★ The result is a user choice from then on: it is stored, so the next poll's
 *   re-render reads it back rather than re-deriving a default. That is the whole
 *   of "a user's choice is not reset".
 * ★ Returns the SAME map when nothing changed, so a redundant toggle cannot
 *   invalidate every row on the next render.
 * @param expansion - the current store.
 * @param key - the row's stable key.
 * @returns the next store.
 */
export declare function toggleMemberRow(expansion: MemberExpansion, key: string): MemberExpansion;
/**
 * Drop expansion entries for members that are no longer on the team.
 *
 * ★ Without this, a store keyed by member id grows for the life of the panel —
 *   the panel is a shell-overlay singleton and outlives every conversation
 *   route change. Rows the user never touched are never added in the first
 *   place, so the pruning is only ever removing what a re-spawn replaced.
 * ★ Returns the same map when nothing was pruned.
 * @param expansion - the current store.
 * @param keys - every key the current roster defines.
 */
export declare function pruneMemberRows(expansion: MemberExpansion, keys: readonly string[]): MemberExpansion;
/** What one member's elapsed readout means. */
export type MemberClockKind = 
/** The member's own session is live and working; the clock counts real progress. */
'running'
/** Work is still open but nothing is driving it; the clock counts abandonment, not work. */
 | 'stale'
/** Nothing open to time: the member is genuinely idle. A real readout, not a blank cell. */
 | 'idle'
/** Open work exists but its stamp is unreadable: could-not-measure, never rounded to idle. */
 | 'unknown';
/** Complete elapsed readout for one member row. */
export interface MemberClock {
    readonly kind: MemberClockKind;
    readonly ms: number;
    /**
     * The durable stamp `ms` was measured from.
     * ★ Present only for `running` / `stale` — the two readings whose duration
     *   actually advances. The ticking component re-derives `ms` from it.
     */
    readonly stamp?: number;
}
/** Minimal member shape the clock needs (matches one snapshot member row). */
export interface ClockMember {
    readonly name: string;
    readonly activity?: string;
    /** Session-liveness state when the host publishes it; absent on older snapshots. */
    readonly liveness?: string;
    readonly currentTask?: string;
}
/** Minimal task shape the clock needs. */
export interface ClockTask {
    readonly id: string;
    readonly assignee: string;
    readonly status: string;
    /** Durable last-write stamp written by the host on every durable change. */
    readonly updatedAt?: number;
}
/**
 * Read how long a member has been on the task it is currently on.
 *
 * The stamp comes from the task's durable `updatedAt` — a fact the host writes
 * on every change — never from a timer started in the browser, which would be
 * a guess that resets on reload.
 *
 * ★ The clock distinguishes running from stale because a dead member's open
 *   task still carries a fresh-looking stamp. Counting that as elapsed work is
 *   precisely the reading task t4 removed, so it is rendered as stalled instead.
 *
 * @param member - the member row; `liveness` decides running vs stale when present.
 * @param tasks - the team's tasks, supplying the durable stamps.
 * @param now - observation instant, injected so this stays pure.
 */
export declare function memberClock(member: ClockMember, tasks: readonly ClockTask[], now: number): MemberClock;
/**
 * The durable stamp a member's clock is currently measured from.
 *
 * ★ Same picks as {@link memberClock}, returned as the raw stamp instead of a
 *   duration: the ticking component re-derives the duration each second from
 *   this stamp, so the panel never has to re-render to move the number.
 * @param member - the member row.
 * @param tasks - the team's tasks.
 * @returns the durable `updatedAt` being counted from, or undefined.
 */
export declare function memberClockStamp(member: ClockMember, tasks: readonly ClockTask[]): number | undefined;
/** Compact elapsed copy for one row: `4s`, `12m`, `1h 5m`. */
export declare function formatElapsed(ms: number): string;
/** Group tasks by their precomputed dependency depth. */
export declare function taskStages<T extends RelationshipTask>(tasks: readonly T[]): readonly RelationshipStage<T>[];
/**
 * Lay tasks out as the reference panel's compact left-to-right DAG.
 *
 * Columns are dependency-depth stages. Rows are stable task-id order within
 * each stage. Edges use cubic curves so fan-in remains readable without
 * turning every task into a large card.
 */
export declare function compactDagLayout<T extends RelationshipTask>(tasks: readonly T[], dimensions?: {
    readonly nodeWidth: number;
    readonly nodeHeight: number;
    readonly columnGap: number;
    readonly rowGap: number;
}): CompactDagLayout<T>;
/**
 * Return the complete upstream/downstream chain around one task.
 *
 * Traversal uses both dependency directions and remains cycle-safe, so the UI
 * can highlight every handoff related to the focused task even if malformed
 * durable data contains a cycle.
 */
export declare function relatedTaskIds(taskId: string, tasks: readonly RelationshipTask[]): ReadonlySet<string>;
