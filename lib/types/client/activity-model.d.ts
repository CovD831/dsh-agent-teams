/** Pure relationship projections used by the AgentTeams activity panel. */
import type { AgentTeamsTranslate } from './locales.ts';
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
export declare function taskLoopTone(task: {
    readonly status: string;
    readonly failureKind?: string;
}): LoopTone;
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
/** Minimal task shape needed to tell "finished" apart from "never started" (D12). */
export interface MemberHistoryTask {
    readonly id: string;
    readonly status: string;
    readonly state?: string;
    readonly updatedAt?: number;
}
/**
 * ── ★★★ What a member's *history* says, once it has no open work left (D12)─────
 *
 * MEASURED（用户截图）：一个**刚做完 12 件**的成员与一个**从没派过活**的成员，
 * 主行读出来是**同一句话**。而那两件事的处置**相反**：
 *   · 有历史 ⇒ 队长**欠它**一个任务（该派了）；
 *   · 无历史 ⇒ 它**还没参与过**（可能正常，也可能配置错了）。
 *
 * ★ 四种取值，且**两两不同形** —— 这正是本函数存在的理由：
 *   · `open`     —— 还有未终结任务 ⇒ 调用方去显示那个任务（不是本函数的兜底）。
 *   · `failed`   —— 最新的一条终结任务是失败 ⇒ 该**重派**。
 *   · `finished` —— 有已完成的任务、最新那条不是失败 ⇒ 该**派下一件**。
 *   · `never`    —— 名下一条任务都没有（或只有非终结且非完成的残留）⇒ 从未派工。
 *
 * ★ "最新"的判据必须是**确定**的：优先用宿主写的 `updatedAt`（唯一的持久时间戳），
 *   缺席时退回**传入顺序的最后一条** —— 快照顺序是稳定的，而"随机挑一条"会让
 *   同一份数据两次渲染给出不同的句子。
 *
 * ★ 反向半边：把 `failed` 与 `finished` 合流，或把 `finished` 与 `never` 合流，
 *   都会让"刚做完 12 件"与"从没派过活"重新同形 —— 即本轮要修的缺陷本身。
 * @param owned - the member's OWN tasks, in snapshot order.
 * @returns which of the four non-open situations this member is in.
 */
export declare function memberHistoryState(owned: readonly MemberHistoryTask[]): 'open' | 'failed' | 'finished' | 'never';
/**
 * The newest task by `updatedAt`, falling back to snapshot order.
 *
 * ★ 缺 `updatedAt` 时**不打乱**相对次序：早于该字段的宿主快照里，
 *   顺序是唯一可用的"先后"证据。
 * ★ 导出是给 D12 的两句文案取任务 id 用的（"tN 失败" / "已完成 tN"）——
 *   两处必须**同一口径**，否则两句话会指向不同的任务。
 * @param tasks - candidate tasks, in snapshot order.
 * @returns the newest one, or undefined for an empty list.
 */
export declare function latestOwnedTask<T extends {
    readonly updatedAt?: number;
}>(tasks: readonly T[]): T | undefined;
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
 * Terminal-outcome tone for every surface that colours a task.
 *
 * ★ This is the fix for "a review that found problems renders as a red failure".
 *   The three measured outcomes get three distinct tones: a consultative task
 *   whose job was to find problems renders AMBER (`converging`), a genuinely
 *   broken deliverable stays red, and an unmeasured stop renders as neither.
 *
 * ★ When the host has not published a classification, this returns the SAME
 *   value `taskTone` did before, so nothing regresses on an older snapshot —
 *   the new states only appear where they were actually measured.
 */
export declare function taskTerminalTone(task: {
    readonly status: string;
    readonly state: string;
    readonly failureKind?: string;
}): string;
/** Human label for one raw task status, falling back to the status itself. */
export declare function taskStatusLabel(status: string, t: AgentTeamsTranslate): string;
/** One-line task description used as a `title` tooltip (`id · subject · extras`). */
export declare function taskTitle(task: {
    readonly id: string;
    readonly subject: string;
    readonly kind?: string;
    readonly round?: number;
    readonly verdict?: string;
}, model: string): string;
/** Compact task label for the tight DAG nodes. */
export declare function compactTaskLabel(subject: string): string;
/** Joined task-id list using the locale's list separator. */
export declare function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string;
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
/**
 * One judged constraint as the panel reads it off `/state`.
 *
 * ★ Declared structurally rather than imported from the host half (same reason
 *   as {@link MemberSubagent}): the payload crosses the wire as JSON, and a
 *   client typed from `src/types.ts` would make a server refactor a
 *   browser-only breakage.
 */
export interface GateRunView {
    readonly id: string;
    readonly verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped';
    readonly count?: number;
    readonly produced?: boolean;
    /** Fired but its verdict was waived by observe mode; absent = not that case. */
    readonly observed?: boolean;
}
/** The gate record for one task, as it reaches the panel. */
export interface GateEvaluationView {
    readonly ok: boolean;
    readonly blockers: readonly string[];
    readonly unmeasured?: string;
    readonly ran: readonly GateRunView[];
    readonly evaluated: number;
    readonly skipped: number;
    readonly registered: number;
    readonly skippedAll?: string;
    readonly observedBlockers?: number;
}
/**
 * ★★★ What the member's verdict band can say — **four answer shapes, never
 * three**. This is the acceptance's core requirement and every list here is
 * deliberate:
 *
 *   `absent`      —— this task was **never evaluated** (the wire carried no
 *                    reading). Must read "cannot tell", **never** "all passed":
 *                    those two are opposite actions (re-run vs ship).
 *   `empty`       —— evaluated, but **no constraint ran** at all. Renders with
 *                    its own glyph (⊘) and wording, distinct from `pass`.
 *   `verdict`     —— evaluated with a real judgement (`ok` / `blocked` /
 *                    `unmeasured` / `observed`).
 *
 * ★ Note the two memberships that MUST NOT be collapsed:
 *   · a record present but `ran: []` is `empty`, **not** `verdict`/`pass`
 *     (an all-skipped run has `evaluated === 0` ⇒ it cannot be a `✓`);
 *   · a missing record is `absent`, **not** an empty pass.
 *
 * Deliberately **not** a boolean: a boolean would be exactly the collapse this
 * whole module exists to prevent.
 */
export type MemberGateReadout = {
    readonly state: 'absent';
} | {
    readonly state: 'empty';
    readonly registered: number;
    readonly skippedAll?: string;
} | {
    readonly state: 'verdict';
    readonly verdict: MemberGateVerdict;
    readonly evaluation: GateEvaluationView;
};
/**
 * The verdict for every task a member owns, keyed by task id.
 *
 * ★ Purely derived: one `Map` walk, no host calls, so it is testable from the
 *   compiled `lib/client/activity-model.js` without a browser.
 */
export declare function memberGateReadouts(tasks: readonly {
    readonly id: string;
    readonly gateEvaluation?: unknown;
}[]): ReadonlyMap<string, MemberGateReadout>;
/** The one symbol for a member's compact verdict band. */
export type MemberGateVerdict = 'ok' | 'blocked' | 'unmeasured' | 'observed';
/**
 * The one symbol for a member's compact verdict band.
 *
 * ★ `observed` (fired but waived) is its own answer — it must not read as `ok`
 *   ("gentle, nothing happened") nor as `blocked` ("it stopped the flow").
 *
 * ── ★★★ 队长修复（2026-10-16）：`skippedAll` 在场 ⇒ 绝不是 `ok` ──────────────
 *
 * MEASURED（实测）：全跳过时 `ran` 里**有**条目（每条 `verdict:'skipped'`），
 * 而修前这里只数 `blocked`/`unmeasured` ⇒ **返回 `ok`** ⇒ 界面画成 **✓**。
 *
 * ★★ 而注册表**逐字**说了它的本意（`registry.ts:884-886`）：
 *   「采用 ② 的本意：**让裁决不再无条件给 `ok`**，而不复用 `unmeasured`：
 *      `ok: false` + `blockers: []` + `unmeasured: undefined` + `skippedAll: <说明>`」
 *   ⇒ 即 **`skippedAll` 在场就是"不是 ok"的机械标志**。
 *
 * ⇒ 所以这一支**按注册表自己的判据**判，不发明新的：
 *   `skippedAll` 在场 ⇒ `unmeasured`（"没测到"，与它的同为"没测到"一族）。
 */
export declare function memberGateVerdict(evaluation: GateEvaluationView): MemberGateVerdict;
/** The six insertion points, in flow order. Mirrors the host's `INSERTION_POINTS`. */
export declare const FLOW_STAGES: readonly ["admission", "contract", "dispatch", "completion", "delivery", "runtime"];
/** One flow stage. */
export type FlowStage = typeof FLOW_STAGES[number];
/**
 * Which stage a task is in, **derived from its status** (spec §4).
 *
 *   `pending`      ⇒ `dispatch`   （等派工）
 *   `in_progress`  ⇒ `completion` （成员在做）
 *   `completed` + 判据在场 ⇒ `delivery`（待交付）
 *   `completed` 无判据     ⇒ 省略阶段（`undefined`）
 *
 * ★ `undefined` 与任何一段都**不同形**：省略是"这一格没有阶段可报"，
 *   而不是"它在第一段"。
 * @param status - the durable task status.
 * @param hasEvaluation - whether a gate record is on the task at all.
 * @returns the stage, or undefined when the spec says to omit it.
 */
export declare function taskStage(status: string, hasEvaluation: boolean): FlowStage | undefined;
/**
 * ── ★★★ 六种判据状态（本仓纪律：**两两不同形**）────────────────────────────────
 *
 *   `passed`   ✓  真的跑过且通过
 *   `skipped`  ⊘  跳过（`skippedAll` 在场）—— ★ **绝不是 `passed`**
 *   `running`  ●  正在跑
 *   `registered` ○ 注册了但本轮未跑
 *   `pending`  ·  未开始（本段还没轮到）
 *   `observed` ✗  失败 / 观察中开火
 *
 * ★★ `passed` / `registered` / `skipped` 三者必须可辨 ——
 *   分别是"通过了""没跑""跳过了"。把前两者合流，就是 `c4cbeaf` 修过的那个缺陷；
 *   把后两者合流，就是"我没问"读成"它没跑"。
 */
export type GateState = 'passed' | 'skipped' | 'running' | 'registered' | 'pending' | 'observed';
/**
 * ── ★★★ t81：一段"**没有裁决**"的成因 —— ★ **四种必须不同形** ──────────────────────
 *
 * 本仓记账最久的形态是「**没找到**」与「**确实没有**」合流。而在判据分段这件事上，
 * 「这一段没有裁决」有**四种成因**，它们的补救动作**完全不同**：
 *
 * | 成因 | 什么情况 | 补救动作 |
 * |---|---|---|
 * | {@link SegmentAbsence.noGate} | ★ **该段真的没有判据**（`admission` 是空段） | 判据自己该接线（或删掉）—— **不是**任务的问题 |
 * | {@link SegmentAbsence.teamLevel} | ★ **不是任务级事实**（`delivery` 团队级 / `runtime` 事件级） | 去团队级/事件级的读数里看 —— **永远**不会出现在任务上 |
 * | {@link SegmentAbsence.notReached} | 任务**还没走到**那一段 | 等 —— 它会自己出现 |
 * | {@link SegmentAbsence.notRecorded} | 走了，但**这一代没记**（retry 清过） | ★ 想知道上一代说了什么 ⇒ 看**历史**（`executions[]`） |
 *
 * ★★ 四者混成同一个 `○` 就是那个最久的形态。⇒ 本类型是**送进渲染层**的判别面，
 *   而 `GateState`（`○`/`⊘`/`✓`…）只回答"形状"，不回答"为什么"。
 */
export type SegmentAbsence = 
/** ★ 该段**真的没有判据**（`registered === 0`）—— `admission` 是唯一确定的一例。 */
'noGate'
/** ★ 该段不是**任务级**事实 —— `delivery`（团队级）/ `runtime`（事件级）。**永不落盘**。 */
 | 'teamLevel'
/** ★ 任务**还没走到**这一段。 */
 | 'notReached'
/** ★ 走到了，但**这一代没记**（`clearAttemptResult` 清过）—— ★ 与"没走到"不同形。 */
 | 'notRecorded';
/**
 * ── ★★★ t81：段落的**层级** —— 决定它能不能出现在任务上 ──────────────────────────
 *
 * ★★ `delivery` / `runtime` **永不落盘到 task**（团队级 / 事件级）：
 *   · `delivery` —— `src/tools/delivery.ts`：**整个团队**宣布交付，不是某条任务的事实；
 *   · `runtime`  —— `evaluateRuntimeGates`：**跨步骤**的过程约束（告警，不直接拒任务）。
 *   ⇒ ★ **不许为了"凑齐六段"给它们编一个 per-task 裁决** —— 那会造出一个**错误的事实**。
 *     这与 `admission` 的"真的 0 条"是**两件不同的事**（一个是没判据，一个是不属于任务）。
 */
export declare function segmentLevel(stage: FlowStage): 'task' | 'team' | 'event' | 'empty';
/**
 * 判定一段"没有裁决"的**成因**。
 *
 * ★ 调用前提：调用方已经确定**这一段没有裁决**（拿不到 `evaluation`）。
 *   ⇒ 本函数只回答"**为什么没有**"，不回答"有没有"。
 *
 * @param stage - 是哪一段。
 * @param registered - 这一段**注册了**几条判据（来自 `catalog`，是静态清单）。
 * @param reached - 这条任务**走到过**这一段吗（由落盘字段/状态推）。
 */
export declare function segmentAbsence(stage: FlowStage, registered: number, reached: boolean): SegmentAbsence;
/** The single glyph for each state. ★ 每个都不一样 —— 这是本模块存在的理由。 */
export declare const GATE_GLYPH: Readonly<Record<GateState, string>>;
/** One criterion as the expanded panel draws it. */
export interface GateRowView {
    readonly id: string;
    readonly description: string;
    readonly state: GateState;
    /** Fired but waived by observe mode; only meaningful with a reading. */
    readonly observing: boolean;
}
/** One stage group as the expanded panel draws it. */
export interface StageGroupView {
    readonly stage: FlowStage;
    /** How the stage as a whole reads, for its own glyph. */
    readonly state: GateState;
    /**
     * ★ 该段有没有**真的**逐条裁决。
     * ★★ t81：**不再是"只有 completion"** —— 现在 contract / dispatch / completion
     *   三个任务级段都可能真的有（它们在服务端落盘）。
     */
    readonly hasVerdicts: boolean;
    /**
     * ── ★★★ t81：这段**没有裁决**的成因（有裁决时缺席）─────────────────────────────
     *
     * ★★ 四者**不同形**（见 {@link SegmentAbsence}）：`noGate`（真的没判据）/
     *   `teamLevel`（不是任务级事实）/ `notReached`（还没走到）/ `notRecorded`（这一代没记）。
     *   ★ 混成一个 `○` 就是本仓记账最久的形态。
     * ★ `state === 'pending'`（空段，`rows` 为空）时也**给** `absence`：
     *   空段的成因（`noGate` vs `teamLevel`）恰恰是读的人最需要知道的。
     */
    readonly absence?: SegmentAbsence;
    readonly rows: readonly GateRowView[];
}
/**
 * ── ★★★ 一段的逐条投影 ──────────────────────────────────────────────────────
 *
 * ★★ **甲方案的边界就落在这个函数里**：`stage !== 'completion'` 时
 * **一律不看 `evaluation`**，因为那几个段的结果根本不落盘
 * ⇒ 逐条只能是 `registered` / `pending`，**不许**从别处推一个 `✓` 出来。
 *
 * ★ completion 段按 `evaluation.ran[]` 逐条对齐（**按注册顺序**，与注册表一致）：
 *   · `verdict: 'ok'`        ⇒ `passed`
 *   · `verdict: 'skipped'`   ⇒ ★ `skipped`（⊘）—— 而 `skippedAll` 在场时**整段**是 ⊘
 *   · `verdict: 'blocked'`   ⇒ `observed` 若是 observe 放过，否则 `observed`/✗
 *   · `verdict: 'unmeasured'`⇒ `observed`（"测不了"不是"通过"）
 *   · **不在 `ran[]` 里**     ⇒ `registered` ○（注册了但本轮没跑）
 *
 * ★★ **反向半边 A 的落点**：`evaluation` 缺席 ⇒ 每条都 `registered`（○），
 *   **一个 `✓` 都不许出现**。这条不是"顺手" —— 它是"从未跑过"与"跑过且干净"
 *   不同形的**唯一**保证。
 */
export declare function stageGateRows(stage: FlowStage, catalog: readonly {
    readonly id: string;
    readonly description: string;
    readonly observing: boolean;
}[], evaluation: GateEvaluationView | undefined, 
/**
 * ── ★★ t81：该段的**按段落盘裁决**（`gateEvaluations[stage]`）────────────────────
 *
 * ★ 传入前的**优先级**（由 `stageGroups` 定）：按段字段优先，`evaluation`
 *   （S1 的单段 `gateEvaluation`）只作 **completion 段的兼容来源**。
 * ★ 缺席 ⇒ 该段这一代没有裁决（成因由 {@link segmentAbsence} 再细分）。
 */
stageVerdicts?: GateEvaluationView): GateRowView[];
/**
 * ── ★★★ 整段的形状 ──────────────────────────────────────────────────────────
 *
 * ★ 一段的"状态"不是它第一条判据的状态：`skippedAll` 在场 ⇒ **整段** ⊘；
 *   一条 `✗` ⇒ 整段 ✗（这是要人看的那件事实）；全 `✓` ⇒ ✓；
 *   有 `●` ⇒ ●；否则 ○。
 *
 * ★ 甲方案：**非 completion 段**只报"有没有判据"，不报裁决 ——
 *   因为它们的结果不落盘，报裁决就是编。
 */
export declare function stageGroupState(stage: FlowStage, rows: readonly GateRowView[], evaluation: GateEvaluationView | undefined, 
/** ★★ t81：该段的按段落盘裁决（与 `stageGateRows` 同一入参、同一优先级）。 */
stageVerdicts?: GateEvaluationView): GateState;
/**
 * ── ★★★ 两行式的行 2：`第 N 轮 · 阶段 · 测试`，按优先级**截断**──────────────────
 *
 * 规格 §3：行 2 超出就**先省"测试"，再省"阶段"** —— **不许溢出**。
 * 所以返回的是**按优先级排好的候选清单**，从最全到最省；渲染层取**第一个放得下**的。
 *
 * ★ 为什么把"截断"做成**候选清单**而不是在渲染层现算：这样"放不下"这件事
 *   可以用纯函数测，不需要浏览器量宽度。
 * @param round - the member's round, or undefined when it has none.
 * @param stage - the derived stage, or undefined when the spec says to omit it.
 * @param testLabel - the "which test" text, or '' when there is none.
 * @returns candidates from fullest to sparsest; '' means "nothing to show".
 */
export declare function doingLineCandidates(round: number | undefined, stage: FlowStage | undefined, testLabel: string): readonly string[];
/**
 * ── ★★★ v4：一个成员的**裁决 tone**（旧的 `data-member-gate-tone` 词表）────────────
 *
 * ★ 这个词表是**已经存在**的（旧的"一句话裁决"band 用它）：`absent` / `skipped` /
 *   `ok` / `blocked` / `unmeasured` / `observed` —— 而 v4 把那句话换成了**阶段分组**，
 *   于是这个 tone 改由"当前那一段的形状"推出来。
 *
 * ★ **保留它的理由**：臂 27 逐条比对渲染出的 `data-*` 探针，一个都不许无声消失。
 *   事实没丢（"这个成员的判据现在什么形状"仍然可读），只是换了承载 ——
 *   所以这里给出**同名同词表**的读数，而不是让探针消失。
 *
 * ★★ 映射**不发明新词**：六态压进旧词表时，"没跑"与"跳过了"必须仍然不同形 ——
 *   `registered`/`pending` ⇒ `absent`（没有任何裁决），`skipped` ⇒ `skipped`，
 *   `passed` ⇒ `ok`，`observed` ⇒ `observed`，`running` ⇒ `unmeasured`
 *   （"还在跑"与"测不了"同属"还没有结论"这一族，且都不是 `ok`）。
 * @param stage - the stage the member's current task is in, or undefined.
 * @param groups - the stage groups derived for this row.
 * @returns the legacy tone, or 'absent' when there is no stage at all.
 */
export declare function memberGateTone(stage: FlowStage | undefined, groups: readonly StageGroupView[]): 'absent' | 'skipped' | 'ok' | 'blocked' | 'unmeasured' | 'observed';
