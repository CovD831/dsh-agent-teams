/** Pure relationship projections used by the AgentTeams activity panel. */

import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'

/**
 * Statuses after which a task no longer moves; every other status is open work.
 * ★ Single source for this fact: both the loop projection and the member clock
 *   read it from here, so a second list cannot drift out of step.
 */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'] as const

/** Whether a task stopped for good, independent of why. */
export function taskIsTerminal(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status)
}

/**
 * ── ★★★ t82：一个成员名下**还有没有活开着** ────────────────────────────────────
 *
 * ── 为什么需要它（缺陷：已完成的成员仍显示琥珀）────────────────────────────────
 *
 * 两条注释（`ActivityPanel.module.css:2053` 与 `MemberRow.tsx:126-127`）**逐字**
 * 都写了同一个条件：那是「**死会话 + 活还开着**」才会有的琥珀 ——
 *   · CSS：「a dead session **with open work** is a thing to act on」
 *   · TS ：「A member whose session is gone **while its work is still open**」
 *
 * ★★ 而实现里 `liveness === 'not-live'` **无条件**返回 `'stalled'`，且
 *   `MemberDotContext` 只有 `{discarded, stopped, staged, historic}` 四格 ——
 *   **"活还开着"这个条件在实现里根本无法表达**。
 * ⇒ 一个刚**成功交付**、会话被正常回收的成员，被画成"需要你去处理"的琥珀。
 * ★ 而琥珀是本仓唯一的"待处理"色 ⇒ "干完了"与"卡住了"同色 ⇒ 那个色不再是信号。
 *
 * ── 纯派生 ─────────────────────────────────────────────────────────────────
 *
 * ★ 从**已有的** `owned`（该成员名下全部任务）算，**不新开数据通道** ——
 *   终态判定复用本文件既有的 {@link taskIsTerminal}，与轮次投影、成员时钟**同一份**来源。
 *
 * ★★ **缺席语义（`owned` 为 undefined）＝ `true`（按"有活"处理）**，理由是**保守**：
 *   · 误判成琥珀 ⇒ 一个人去多看一眼（**代价小**）；
 *   · 误判成 idle ⇒ 一个**真的卡住**的成员被画成"收工了"（**代价是一个没人看的卡点**）。
 *   ⇒ 两边代价不对称时取代价小的那一侧；而"没人看的卡点"正是本仓记账最久的那一类。
 * @param owned - every task assigned to this member, or undefined when unavailable.
 * @returns true when at least one owned task is not terminal.
 */
export function memberHasOpenWork(owned: readonly { readonly status: string }[] | undefined): boolean {
  if (owned === undefined) return true
  return owned.some((task) => !taskIsTerminal(task.status))
}

/** Minimum task shape needed to derive dependency relationships. */
export interface RelationshipTask {
  readonly id: string
  readonly dependencies: readonly string[]
  readonly depth: number
}

/** One dependency-depth stage in stable display order. */
export interface RelationshipStage<T extends RelationshipTask> {
  readonly depth: number
  readonly tasks: readonly T[]
}

/** Geometry used by the compact task DAG in the activity panel. */
export interface CompactDagNode<T extends RelationshipTask> {
  readonly task: T
  readonly x: number
  readonly y: number
}

/** One dependency edge routed between two compact DAG nodes. */
export interface CompactDagEdge {
  readonly from: string
  readonly to: string
  readonly path: string
}

/** Complete, scrollable compact DAG projection. */
export interface CompactDagLayout<T extends RelationshipTask> {
  readonly width: number
  readonly height: number
  readonly nodes: readonly CompactDagNode<T>[]
  readonly edges: readonly CompactDagEdge[]
}

/** Reference-panel geometry: narrow nodes with enough room for curved edges. */
export const COMPACT_DAG_NODE_WIDTH = 92
export const COMPACT_DAG_NODE_HEIGHT = 30
export const COMPACT_DAG_COLUMN_GAP = 26
export const COMPACT_DAG_ROW_GAP = 8

/** Compact `provider/model` route, or just the model when the provider is absent. */
export function memberRouteLabel(member: { readonly provider?: string; readonly model?: string } | undefined): string {
  if (member === undefined) return ''
  const provider = member.provider?.trim() ?? ''
  const model = member.model?.trim() ?? ''
  if (provider !== '' && model !== '') return `${provider}/${model}`
  return model
}

/**
 * Compact route shown on a running task. Prefer the task's own snapshot
 * field; fall back to the assignee member when older hosts omit it.
 */
export function taskModelLabel(
  task: { readonly model?: string; readonly assignee: string },
  members: readonly { readonly name: string; readonly provider?: string; readonly model?: string }[],
): string {
  const direct = task.model?.trim() ?? ''
  if (direct !== '') return direct
  return memberRouteLabel(members.find((candidate) => candidate.name === task.assignee))
}

/** Short model id for tight DAG/chip surfaces (`openai/gpt-5.6-sol` → `gpt-5.6-sol`). */
export function compactModelLabel(route: string): string {
  const trimmed = route.trim()
  if (trimmed === '') return ''
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * ── ★★★ 客户端认队长的**唯一**入口（2026-10-21，裁决 ②）────────────────────────────
 *
 * A live team the current captain still owns and has not halted.
 *
 * ── ★★★ 一条**必须写在代码里**的边界：客户端只做**精确匹配**，认不出 fork ────────────
 *
 * 服务端已经收口成 `sessionLeadsTeam`（`src/lineage.ts`，19 处调用）——
 * 它沿 `parentSession` 走 fork 链，于是"队长在自己的 fork 里继续"仍认得出。
 *
 * ★★ 而**客户端拿不到那条链**：`liveRefsOf(ctx)` 需要 `ctx.agents`，
 *   而客户端只有 team 记录与成员子代理的 `parentSession`（后者是**成员**的，
 *   不是队长会话的）。⇒ (甲)「客户端也走 fork 链」在这里**结构上做不到**。
 *
 * ⇒ 所以本函数**如实**只做精确匹配，并把这件事**写在这里**，
 *   而不是让它静默地漏认 —— 静默漏认的后果是：
 *     · 面板把"队长 fork 之后"的队显示成"不属于任何人"
 *     · 而**没有任何读数**能发现这件事
 *
 * ★ 这是裁决 ② 的 **(乙)**：不造一个"看起来支持 fork"的假象，
 *   而是让这一格**显式地**说它判不了 fork。
 *   ★★ 若哪天真要在客户端支持 fork，正确做法是**服务端把解析结果投影过来**
 *     （一份已有的读数），而不是让客户端自己再算一遍链 ——
 *     那会是本仓最贵的**第二份实现**。
 *
 * @param teams - 客户端手上那份 team 记录（**没有** fork 链）。
 * @param sessionId - 当前会话 id。
 * @returns 精确匹配到的队；fork 之后的情形 ⇒ `undefined`（**判不了**，不是"不属于"）。
 */
export function liveCaptainTeam<T extends { readonly captainSessionId: string; readonly halted?: boolean }>(
  teams: readonly T[],
  sessionId: string | undefined,
): T | undefined {
  const owner = sessionId?.trim() ?? ''
  if (owner === '') return undefined
  return teams.find((team) => team.captainSessionId === owner && team.halted !== true)
}

/** Minimal member shape needed to order the delegation list (issue #192). */
export interface MemberListEntry {
  readonly name: string
  readonly activity?: string
  readonly status?: string
}

/** Minimal task shape needed to derive a member's finish time (issue #192). */
export interface MemberFinishTask {
  readonly assignee: string
  readonly status: string
  readonly updatedAt?: number
}

/**
 * Latest terminal-task `updatedAt` owned by one member.
 * @param memberName - member whose owned tasks are scanned.
 * @param tasks - team tasks carrying durable `updatedAt` stamps.
 * @returns the newest terminal stamp, or undefined when the member owns none.
 */
export function memberFinishedAt(
  memberName: string,
  tasks: readonly MemberFinishTask[],
): number | undefined {
  let latest: number | undefined
  for (const task of tasks) {
    if (task.assignee !== memberName) continue
    if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') continue
    const stamp = task.updatedAt
    if (typeof stamp !== 'number' || !Number.isFinite(stamp)) continue
    if (latest === undefined || stamp > latest) latest = stamp
  }
  return latest
}

/** Whether a member still has live work (running activity or an open task). */
function memberIsRunning(
  member: MemberListEntry,
  tasks: readonly MemberFinishTask[],
): boolean {
  if (member.activity === 'working' || member.status === 'working') return true
  return tasks.some((task) => task.assignee === member.name
    && (task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'))
}

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
export function orderDelegationMembers<TMember extends MemberListEntry>(
  members: readonly TMember[],
  tasks: readonly MemberFinishTask[],
): readonly TMember[] {
  const running: { member: TMember; index: number }[] = []
  const finishedStamped: { member: TMember; index: number; finishedAt: number }[] = []
  const finishedUnstamped: { member: TMember; index: number }[] = []
  members.forEach((member, index) => {
    if (memberIsRunning(member, tasks)) {
      running.push({ member, index })
      return
    }
    const finishedAt = memberFinishedAt(member.name, tasks)
    if (finishedAt === undefined) finishedUnstamped.push({ member, index })
    else finishedStamped.push({ member, index, finishedAt })
  })
  finishedStamped.sort((left, right) => right.finishedAt - left.finishedAt || left.index - right.index)
  return [
    ...running,
    ...finishedStamped,
    ...finishedUnstamped,
  ].map((entry) => entry.member)
}

/** Whether the captain chat should keep showing the in-progress banner. */
export function teamIsActive(team: {
  readonly phase?: string
  readonly halted?: boolean
  readonly members: readonly { readonly status?: string; readonly activity?: string }[]
  readonly tasks: readonly { readonly status: string }[]
}): boolean {
  if (team.halted === true || team.phase === 'staged') return false
  if (team.members.some((member) => member.activity === 'working' || member.status === 'working')) return true
  if (team.tasks.some((task) => task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress')) return true
  return team.members.length > 0 && team.tasks.length === 0
}

/** Compact banner copy: running members, otherwise the current planning state. */
export function teamProgressSummary(
  team: {
    readonly members: readonly { readonly name: string; readonly status?: string; readonly activity?: string; readonly currentTask?: string }[]
    readonly tasks: readonly { readonly id: string; readonly subject: string; readonly status: string }[]
  },
  separator: string,
): { readonly working: number; readonly detail: string } {
  const workingMembers = team.members.filter((member) => member.activity === 'working' || member.status === 'working')
  const runningTasks = team.tasks.filter((task) => task.status === 'claimed' || task.status === 'in_progress')
  const labels = runningTasks.map((task) => task.subject.trim() || task.id).filter((label) => label !== '')
  if (workingMembers.length > 0 || labels.length > 0) {
    return {
      working: Math.max(workingMembers.length, labels.length),
      detail: labels.slice(0, 2).join(separator),
    }
  }
  return { working: 0, detail: '' }
}

/** Use a fill-width grid when the task graph has no real dependency edges. */
export function usesParallelTaskGrid<T extends RelationshipTask>(tasks: readonly T[]): boolean {
  if (tasks.length === 0) return false
  const taskIds = new Set(tasks.map((task) => task.id))
  return tasks.every((task) => task.dependencies.every((dependency) => !taskIds.has(dependency)))
}

/**
 * Whether an expanded activity panel still belongs to the current session.
 *
 * The panel is mounted in the root-scoped shell overlay, so React does not
 * remount it when the conversation route changes. Ownership keeps an expanded
 * panel from leaking onto the new-session screen (or another conversation)
 * while its local open state is being reset.
 */
export function activityPanelExpandedForSession(
  open: boolean,
  owner: string | undefined,
  current: string | undefined,
): boolean {
  return open && owner !== undefined && owner === current
}

/** Inputs for deciding whether genuinely new live work may expand the panel. */
export interface ActivityPanelAutoExpandInput {
  readonly alreadyAutoOpened: boolean
  readonly pageSettled: boolean
  readonly restoreComplete: boolean
  readonly previousLiveTeamIds: ReadonlySet<string>
  readonly currentLiveTeamIds: readonly string[]
}

/**
 * Auto-expand only for live teams that appear after the current session's
 * initial restore pass. Replayed cards, archived teams, and live teams restored
 * while reopening a conversation must remain behind the collapsed badge.
 */
export function activityPanelShouldAutoExpand({
  alreadyAutoOpened,
  pageSettled,
  restoreComplete,
  previousLiveTeamIds,
  currentLiveTeamIds,
}: ActivityPanelAutoExpandInput): boolean {
  return !alreadyAutoOpened
    && pageSettled
    && restoreComplete
    && currentLiveTeamIds.some((teamId) => !previousLiveTeamIds.has(teamId))
}

/**
 * Resolve the task whose dependency chain should be highlighted.
 *
 * A pinned task is an explicit user choice. Keyboard focus takes precedence
 * over delayed pointer intent so an older hover timer cannot steal the active
 * chain from someone navigating the task map with the keyboard.
 */
export function dependencyFocusTaskId(
  pinnedTaskId: string | null,
  keyboardTaskId: string | null,
  hoverTaskId: string | null,
): string | null {
  return pinnedTaskId ?? keyboardTaskId ?? hoverTaskId
}

/** Minimal task shape needed to classify a failure outcome for rendering. */
export interface LoopTask {
  readonly id: string
  readonly status: string
  readonly round?: number
  /** The host's classification when `status` is `failed`; absent on older hosts. */
  readonly failureKind?: string
}

/** Presentation tone for one terminal outcome, including the undifferentiated fallback. */
export type LoopTone = 'converging' | 'failed' | 'unmeasured' | 'blocked' | 'open' | 'running' | 'completed' | 'cancelled'

/**
 * Render-facing tone of one terminal task.
 *
 * ★ This is the one place the three outcomes become three UI states. The
 *   distinction is the whole point: a review that returned `needs_revision`
 *   (inconclusive) did its job and must read as convergence; a broken
 *   deliverable must stay red; an unmeasured stop is neither.
 */
export function taskLoopTone(task: { readonly status: string; readonly failureKind?: string }): LoopTone {
  if (task.status === 'cancelled') return 'cancelled'
  if (task.status === 'completed') return 'completed'
  if (task.status !== 'failed') return task.status === 'in_progress' ? 'running' : 'open'
  const kind = task.failureKind
  if (kind === 'inconclusive') return 'converging'
  if (kind === 'failed_delivery') return 'failed'
  if (kind === 'failed_context') return 'unmeasured'
  /** No classification ⇒ today's undifferentiated failure, never a guessed one. */
  return 'failed'
}

/** How long one review/repair round has been reported as running. */
export interface RoundElapsed {
  readonly round: number
  readonly ms: number
}

/**
 * One review/repair round: its durable index, its tasks, and its tone.
 *
 * ★ The tone is the round's, not any single task's: a round where the review
 *   found problems is converging even while its repair is still running, so the
 *   marker stays amber instead of flipping through every task's own colour.
 */
export interface LoopRound<T extends LoopTask> {
  readonly round: number
  readonly tasks: readonly T[]
  readonly tone: LoopTone
}

/** Complete, display-ordered review/repair loop projection. */
export interface ReviewLoop<T extends LoopTask> {
  readonly rounds: readonly LoopRound<T>[]
  /** Durable task ids carrying an explicit round index. */
  readonly tracked: number
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
export function roundTone<T extends LoopTask>(tasks: readonly T[]): LoopTone {
  const tones = tasks.map((task) => taskLoopTone(task))
  if (tones.includes('failed')) return 'failed'
  if (tones.includes('converging')) return 'converging'
  if (tones.includes('unmeasured')) return 'unmeasured'
  if (tones.includes('running') || tones.includes('open') || tones.includes('blocked')) return 'running'
  if (tones.includes('completed')) return 'completed'
  return 'cancelled'
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Disclosure: state-driven, and reconstructible from durable facts
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * How abnormal a loop is, derived only from the durable round tones.
 *
 * ★ `abnormal` includes `converging` on purpose. The first-party rule opens
 *   abnormal levels so the marker can be seen; a collapsed amber marker is
 *   invisible, and invisible is indistinguishable from absent — which would
 *   quietly turn "the gate found problems" back into "nothing happened".
 */
export type LoopMode = 'abnormal' | 'running' | 'clean'

/** Durable facts about a loop, with no UI state mixed in. */
export interface LoopFacts {
  readonly mode: LoopMode
  /** Count of tracked round tasks; a new round changes this. */
  readonly count: number
}

/** Disclosure state: durable facts plus the user's explicit choice. */
export interface LoopDisclosure extends LoopFacts {
  readonly open: boolean
  /** True once the user toggled; their choice then outranks the derived default. */
  readonly userSet: boolean
}

/**
 * Derive a loop's disclosure facts from durable data.
 *
 * @param loop - the loop projection.
 * @param discarded - a discarded plan has no outcomes, only "never ran".
 */
export function loopFacts<T extends LoopTask>(loop: ReviewLoop<T>, discarded = false): LoopFacts {
  const tones = loop.rounds.map((entry) => (discarded ? 'cancelled' : entry.tone))
  const mode: LoopMode = tones.includes('failed') || tones.includes('converging') || tones.includes('cancelled')
    ? 'abnormal'
    : tones.includes('running') || tones.includes('open') || tones.includes('blocked')
      ? 'running'
      : 'clean'
  return { mode, count: loop.tracked }
}

/** Ordering used to decide whether the loop escalated. */
const LOOP_MODE_RANK: Readonly<Record<LoopMode, number>> = { clean: 0, running: 1, abnormal: 2 }

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
export function nextLoopDisclosure(
  current: LoopDisclosure | undefined,
  facts: LoopFacts,
): LoopDisclosure {
  if (current === undefined) return { ...facts, open: facts.mode !== 'clean', userSet: false }
  const escalated = LOOP_MODE_RANK[facts.mode] > LOOP_MODE_RANK[current.mode]
  if (escalated || facts.count !== current.count) {
    return { ...facts, open: true, userSet: current.userSet }
  }
  if (current.userSet) return current
  return { ...facts, open: current.open, userSet: false }
}

/** Apply one explicit user toggle; the result is a user choice from then on. */
export function toggleLoopDisclosure(current: LoopDisclosure): LoopDisclosure {
  return { ...current, open: !current.open, userSet: true }
}

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
export function reviewLoop<T extends LoopTask>(tasks: readonly T[]): ReviewLoop<T> {
  const byRound = new Map<number, T[]>()
  let tracked = 0
  for (const task of tasks) {
    const value = task.round
    if (value === undefined || !Number.isFinite(value)) continue
    tracked += 1
    const round = Math.max(1, Math.floor(value))
    const group = byRound.get(round) ?? []
    group.push(task)
    byRound.set(round, group)
  }
  const rounds = [...byRound.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, group]) => ({
      round,
      tasks: group.slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })),
      tone: roundTone(group),
    }))
  return { rounds, tracked }
}

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
export function memberRound(tasks: readonly LoopTask[]): LoopRound<LoopTask> | undefined {
  const rounds: LoopRound<LoopTask>[] = []
  for (const round of new Set(tasks.map((task) => task.round).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))) {
    const group = tasks.filter((task) => task.round === round)
    rounds.push({ round: Math.max(1, Math.floor(round)), tasks: group, tone: roundTone(group) })
  }
  if (rounds.length === 0) return undefined
  rounds.sort((left, right) => left.round - right.round)
  return rounds[rounds.length - 1]
}

/** Minimal task shape needed to tell "finished" apart from "never started" (D12). */
export interface MemberHistoryTask {
  readonly id: string
  readonly status: string
  readonly state?: string
  readonly updatedAt?: number
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
export function memberHistoryState(owned: readonly MemberHistoryTask[]): 'open' | 'failed' | 'finished' | 'never' {
  const open = owned.filter((task) => !isTerminalTask(task))
  if (open.length > 0) return 'open'
  const terminal = owned.filter((task) => isTerminalTask(task))
  if (terminal.length === 0) return 'never'
  const latest = latestOwnedTask(terminal)
  if (latest !== undefined && latest.status === 'failed') return 'failed'
  /** ★ 只有"确实完成过"才算 finished：一条 cancelled 的残留不是"干完了"。 */
  return terminal.some((task) => task.status === 'completed') ? 'finished' : 'never'
}

/** Whether a task has stopped for good (`state`, falling back to `status`). */
function isTerminalTask(task: MemberHistoryTask): boolean {
  const state = task.state ?? task.status
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

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
export function latestOwnedTask<T extends { readonly updatedAt?: number }>(tasks: readonly T[]): T | undefined {
  if (tasks.length === 0) return undefined
  let best = tasks[tasks.length - 1]!
  for (const task of tasks) {
    const stamp = task.updatedAt
    if (typeof stamp !== 'number' || !Number.isFinite(stamp)) continue
    const bestStamp = best.updatedAt
    if (typeof bestStamp !== 'number' || !Number.isFinite(bestStamp) || stamp >= bestStamp) best = task
  }
  return best
}

/** One status tail value: which durable task states map to which tail text. */
export type RoundTailCountKey = 'converging' | 'failed' | 'unmeasured' | 'running' | 'completed'

/** Locale key of one round-tail count. */
export type RoundTailKey = `round.tail.${RoundTailCountKey}`

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
export function roundTailCounts<T extends LoopTask>(
  tasks: readonly T[],
  t: (key: string, params?: Record<string, unknown>) => string,
  separator: string,
): string {
  const count = (tone: LoopTone): number => tasks.filter((task) => taskLoopTone(task) === tone).length
  const active = (['converging', 'failed', 'unmeasured', 'running'] as const)
    .filter((tone) => count(tone) > 0)
  const order: readonly RoundTailCountKey[] = active.length === 0
    ? ['completed']
    : active.includes('converging') && count('completed') > 0
      ? ['completed', ...active]
      : active
  return order.map((tone) => `${t(ROUND_TAIL_LABEL[tone], { count: count(tone) })}`).join(separator)
}

/**
 * Locale keys for one round-tail count.
 *
 * These reuse the pre-existing `task.status.*` vocabulary on purpose: adding a
 * parallel `round.*` dictionary would be a second source of truth for the same
 * words, and the two sets would drift the moment one of them is edited.
 */
export const ROUND_TAIL_LABEL: Readonly<Record<RoundTailCountKey, string>> = {
  converging: 'task.status.failed',
  failed: 'task.status.failed',
  unmeasured: 'task.status.notRun',
  running: 'task.status.inProgress',
  completed: 'task.status.completed',
}

/**
 * ── ★★★ R3：任务着色读数（从 ActivityPanel.tsx 搬来，逐字未改）───────────────────
 *
 * ★ 这里保留的是原来那段**逐字的**判据：`taskTone` 是旧行为，而
 *   `taskTerminalTone` 是 t13 引入的三态修正（"评审发现了问题"读成琥珀而不是红）。
 *   `DependencyGraph.tsx` 与面板都要用它，所以它必须在两边都能 import 的地方 ——
 *   而**不是**各留一份。
 */
/** Badge/bar coloring key: visual state, widened for terminal statuses. */
function taskTone(state: string, status: string): string {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return state
}

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
export function taskTerminalTone(task: { readonly status: string; readonly state: string; readonly failureKind?: string }): string {
  if (task.status === 'cancelled') return 'cancelled'
  if (task.status !== 'failed') return taskTone(task.state, task.status)
  return taskLoopTone(task)
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ R3：任务面的**纯**展示读数（从 ActivityPanel.tsx 搬来，逐字未改）──────
 *
 * 这些函数原来长在面板里，而 R3 把依赖图搬进 `DependencyGraph.tsx` 之后，
 * **两个文件都要用它们**。留在任一边都会造成两件事之一：
 *   · 让 `DependencyGraph` 反向 import 面板 ⇒ 循环依赖（面板要 import 图）；
 *   · 或者抄一份 ⇒ 同一句文案的第二份实现，一定会漂移。
 *
 * ⇒ 搬到本模块（两边都已经在 import 它），于是**各只有一份定义**。
 *   ★ 这是纯粹的搬家：函数体一个字都没改，所以"搬丢了什么"能被集合比对抓住。
 * ───────────────────────────────────────────────────────────────────────────── */

/** Badge text follows the raw task status (finer than the 4 visual states). */
const TASK_STATUS_LABEL: Readonly<Record<string, AgentTeamsLocaleKey>> = {
  pending: 'task.status.pending',
  claimed: 'task.status.claimed',
  in_progress: 'task.status.inProgress',
  completed: 'task.status.completed',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled',
}

/** Human label for one raw task status, falling back to the status itself. */
export function taskStatusLabel(status: string, t: AgentTeamsTranslate): string {
  const key = TASK_STATUS_LABEL[status]
  return key === undefined ? status : t(key)
}

/** One-line task description used as a `title` tooltip (`id · subject · extras`). */
export function taskTitle(
  task: { readonly id: string; readonly subject: string; readonly kind?: string; readonly round?: number; readonly verdict?: string },
  model: string,
): string {
  const extras = [
    task.kind,
    task.round === undefined ? undefined : `r${task.round}`,
    task.verdict,
    model === '' ? undefined : model,
  ].filter((item): item is string => item !== undefined)
  return extras.length === 0 ? `${task.id} · ${task.subject}` : `${task.id} · ${task.subject} · ${extras.join(' · ')}`
}

/** Compact task label for the tight DAG nodes. */
export function compactTaskLabel(subject: string): string {
  const withoutVerb = subject.replace(/^开发\s*/u, '').replace(/^\d+[-_.、\s]*/u, '')
  const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb
  return head.length > 18 ? `${head.slice(0, 17)}…` : head
}

/** Joined task-id list using the locale's list separator. */
export function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string {
  return ids.join(t('format.listSeparator'))
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Member clock: how long this member has been on its current task
 * ───────────────────────────────────────────────────────────────────────────── */

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
export function memberClockTicks(kind: MemberClockKind): boolean {
  return kind === 'running'
}

/* ─────────────────────────────────────────────────────────────────────────────
 * R2: the inline subagent layer under one member row
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * One live subagent as the panel reads it off /state.
 *
 * ★ Declared structurally rather than imported from the host half: the payload
 *   crosses the wire as JSON, and a client that typed it from `src/members.ts`
 *   would make a server-side refactor a browser-only breakage.
 */
export interface MemberSubagent {
  readonly id: string
  readonly label: string
  readonly mode?: 'one-shot' | 'continuable'
  readonly status: string
  readonly parentSession?: string
}

/** What a member's subagent layer can say: measured, or not measured. */
export type MemberSubagentState = 'observed' | 'could-not-measure'

/** The per-member subagent readout as it reaches the panel. */
export interface MemberSubagentReadout {
  readonly state: MemberSubagentState
  readonly subagents: readonly MemberSubagent[]
  readonly reason?: string
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
export function memberSubagentReadout(member: {
  readonly subagents?: string
  readonly liveSubagents?: readonly MemberSubagent[]
  readonly subagentsReason?: string
}): MemberSubagentReadout {
  const state = member.subagents
  if (state !== 'observed' && state !== 'could-not-measure') {
    return {
      state: 'could-not-measure',
      subagents: [],
      reason: 'the host published no subagent reading for this member',
    }
  }
  const subagents = Array.isArray(member.liveSubagents) ? member.liveSubagents : []
  if (state === 'observed') return { state, subagents }
  return {
    state,
    subagents: [],
    reason: typeof member.subagentsReason === 'string' && member.subagentsReason !== ''
      ? member.subagentsReason
      : 'the host could not measure this member\'s subagents',
  }
}

/**
 * Presentation tone of one subagent's own status.
 *
 * ★ `unknown` is a real third answer, not a default to be styled away: the host
 *   hands the raw session status through (`running` / `idle` / anything), and a
 *   value we do not recognise must not be rounded to "working".
 */
export type SubagentTone = 'working' | 'idle' | 'unknown'

/**
 * Classify one live subagent's status for rendering.
 * @param status - the raw session status as the host reported it.
 * @returns `working`, `idle`, or `unknown` for anything unrecognised.
 */
export function subagentTone(status: string): SubagentTone {
  if (status === 'running' || status === 'working') return 'working'
  if (status === 'idle' || status === 'ready') return 'idle'
  return 'unknown'
}

/* ─────────────────────────────────────────────────────────────────────────────
 * R2: per-member expansion, collapsed by default and surviving re-renders
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * One member row's disclosure state.
 *
 * ★ The map is keyed by member id (falling back to name for pre-spawn rows) so a
 *   poll that reorders the roster cannot hand one member's expansion to another.
 */
export type MemberExpansion = ReadonlyMap<string, boolean>

/** Stable key for one member row's expansion slot. */
export function memberRowKey(member: { readonly id?: string; readonly name: string }): string {
  const id = member.id?.trim() ?? ''
  return id !== '' ? id : `name:${member.name}`
}

/**
 * Whether one member row is expanded.
 *
 * ★ Collapsed by default is a *value*, not an absent branch: an unmapped row
 *   reads `false`, so a fresh render can never accidentally open every row.
 * @param expansion - the panel's expansion store.
 * @param key - the row's stable key (see {@link memberRowKey}).
 */
export function memberRowExpanded(expansion: MemberExpansion, key: string): boolean {
  return expansion.get(key) === true
}

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
export function toggleMemberRow(expansion: MemberExpansion, key: string): MemberExpansion {
  const next = new Map(expansion)
  if (next.get(key) === true) next.delete(key)
  else next.set(key, true)
  return next
}

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
export function pruneMemberRows(expansion: MemberExpansion, keys: readonly string[]): MemberExpansion {
  const live = new Set(keys)
  let changed = false
  const next = new Map<string, boolean>()
  for (const [key, open] of expansion) {
    if (live.has(key)) next.set(key, open)
    else changed = true
  }
  return changed ? next : expansion
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Member clock: how long this member has been on its current task
 * ───────────────────────────────────────────────────────────────────────────── */

/** What one member's elapsed readout means. */
export type MemberClockKind =
  /** The member's own session is live and working; the clock counts real progress. */
  | 'running'
  /** Work is still open but nothing is driving it; the clock counts abandonment, not work. */
  | 'stale'
  /** Nothing open to time: the member is genuinely idle. A real readout, not a blank cell. */
  | 'idle'
  /** Open work exists but its stamp is unreadable: could-not-measure, never rounded to idle. */
  | 'unknown'

/** Complete elapsed readout for one member row. */
export interface MemberClock {
  readonly kind: MemberClockKind
  readonly ms: number
  /**
   * The durable stamp `ms` was measured from.
   * ★ Present only for `running` / `stale` — the two readings whose duration
   *   actually advances. The ticking component re-derives `ms` from it.
   */
  readonly stamp?: number
}

/** Minimal member shape the clock needs (matches one snapshot member row). */
export interface ClockMember {
  readonly name: string
  readonly activity?: string
  /** Session-liveness state when the host publishes it; absent on older snapshots. */
  readonly liveness?: string
  readonly currentTask?: string
}

/** Minimal task shape the clock needs. */
export interface ClockTask {
  readonly id: string
  readonly assignee: string
  readonly status: string
  /** Durable last-write stamp written by the host on every durable change. */
  readonly updatedAt?: number
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
export function memberClock(
  member: ClockMember,
  tasks: readonly ClockTask[],
  now: number,
): MemberClock {
  const driving = memberIsDriving(member)
  /**
   * ── ★★★ 空闲与"等待"必须分开，而**不再都塌成 `none`** ──────────────────────────
   *
   * MEASURED（用户 2026-10-11 实测，见下）：此前这里对两者都返回 `kind:'none'`，
   * 于是面板**整格空白** —— 而"这一格没东西"与"这个成员没事做"在界面上同形。
   *
   * ★ 三态的口径（用户原话：「要么显示已工作多长时间，要么显示已等待多长时间」）：
   *   · 有活而且在跑   ⇒ `running`：**已工作**多久（它确实在推进）
   *   · 有活而没在跑   ⇒ `stale`  ：**已等待**多久（没人推进它 —— 这才是要看的数）
   *   · 没有活         ⇒ `idle`   ：**空闲**，一个明确的中性读数（不是空白）
   *
   * ★ 而"有活"不含还没开始的任务（用户 2026-10-13：「任务还没开始怎么已经有时间」）。
   *   `pending` 的 `updatedAt` 是创建时间，拿它走表等于把"还没开工"显示成已工作/已等待。
   *   认领（`claimed`）和进行中才算已经开始。
   */
  const timed = timedTask(member, tasks)
  if (timed === undefined) return { kind: 'idle', ms: 0 }
  const stamp = durableStamp(timed.updatedAt)
  /**
   * ★ 拿不到戳 ⇒ `could-not-measure`，**不塌进 `idle`**。
   *   一个"读不出时间"与一个"它没事做"必须不同形（本仓三态纪律）。
   */
  if (stamp === undefined) return { kind: 'unknown', ms: 0 }
  const ms = Math.max(0, now - stamp)
  return { kind: driving ? 'running' : 'stale', ms, stamp }
}

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
export function memberClockStamp(member: ClockMember, tasks: readonly ClockTask[]): number | undefined {
  const timed = timedTask(member, tasks)
  return timed === undefined ? undefined : durableStamp(timed.updatedAt)
}

/**
 * The task a member's clock is allowed to time.
 *
 * ★ `pending` is assigned but not started. Its durable stamp is the create
 *   time, so counting from it draws a duration before any work exists.
 *   Claimed and in-progress are the statuses that have actually begun.
 */
function timedTask(member: ClockMember, tasks: readonly ClockTask[]): ClockTask | undefined {
  const started = tasks.filter((task) => task.assignee === member.name && taskHasStarted(task.status))
  if (started.length === 0) return undefined
  const current = member.currentTask === undefined || member.currentTask === ''
    ? undefined
    : started.find((task) => task.id === member.currentTask)
  return current ?? started.reduce((latest, task) => {
    const stamp = durableStamp(task.updatedAt)
    const best = durableStamp(latest.updatedAt)
    return stamp !== undefined && (best === undefined || stamp > best) ? task : latest
  }, started[0]!)
}

/** Whether this status has left "not started". Pending has not. */
function taskHasStarted(status: string): boolean {
  return status === 'claimed' || status === 'in_progress'
}

/** Wall-clock stamps from a hostile JSON source must be finite numbers to be read. */
function durableStamp(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Whether something is actually driving this member right now.
 *
 * ★ `liveness` wins when the host publishes it: `activity` is a durable field
 *   that keeps saying `working` after the session is gone (the residual reading
 *   t4 exists to surface). Without `liveness` we fall back to `activity`, which
 *   is exactly today's behaviour rather than an invented one.
 */
function memberIsDriving(member: ClockMember): boolean {
  const liveness = member.liveness
  if (liveness !== undefined && liveness !== '') return liveness === 'working'
  return member.activity === 'working'
}

/** Compact elapsed copy for one row: `4s`, `12m`, `1h 5m`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

/** Group tasks by their precomputed dependency depth. */
export function taskStages<T extends RelationshipTask>(tasks: readonly T[]): readonly RelationshipStage<T>[] {
  const byDepth = new Map<number, T[]>()
  for (const task of tasks) {
    const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0
    const stage = byDepth.get(depth) ?? []
    stage.push(task)
    byDepth.set(depth, stage)
  }
  return [...byDepth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([depth, stageTasks]) => ({
      depth,
      tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })),
    }))
}

/**
 * Lay tasks out as the reference panel's compact left-to-right DAG.
 *
 * Columns are dependency-depth stages. Rows are stable task-id order within
 * each stage. Edges use cubic curves so fan-in remains readable without
 * turning every task into a large card.
 */
export function compactDagLayout<T extends RelationshipTask>(tasks: readonly T[], dimensions?: {
  readonly nodeWidth: number; readonly nodeHeight: number; readonly columnGap: number; readonly rowGap: number
}): CompactDagLayout<T> {
  const nodeWidth = dimensions?.nodeWidth ?? COMPACT_DAG_NODE_WIDTH
  const nodeHeight = dimensions?.nodeHeight ?? COMPACT_DAG_NODE_HEIGHT
  const columnGap = dimensions?.columnGap ?? COMPACT_DAG_COLUMN_GAP
  const rowGap = dimensions?.rowGap ?? COMPACT_DAG_ROW_GAP
  const stages = taskStages(tasks)
  const positions = new Map<string, { x: number; y: number }>()
  const nodes: CompactDagNode<T>[] = []
  for (const [column, stage] of stages.entries()) {
    for (const [row, task] of stage.tasks.entries()) {
      const x = column * (nodeWidth + columnGap)
      const y = row * (nodeHeight + rowGap)
      positions.set(task.id, { x, y })
      nodes.push({ task, x, y })
    }
  }
  const edges: CompactDagEdge[] = []
  for (const task of tasks) {
    const target = positions.get(task.id)
    if (target === undefined) continue
    for (const dependency of task.dependencies) {
      const source = positions.get(dependency)
      if (source === undefined) continue
      const x1 = source.x + nodeWidth
      const y1 = source.y + nodeHeight / 2
      const x2 = target.x
      const y2 = target.y + nodeHeight / 2
      edges.push({
        from: dependency,
        to: task.id,
        path: `M${x1} ${y1}C${x1 + 14} ${y1},${x2 - 14} ${y2},${x2} ${y2}`,
      })
    }
  }
  const rows = Math.max(1, ...stages.map((stage) => stage.tasks.length))
  return {
    width: stages.length === 0
      ? 0
      : stages.length * nodeWidth + (stages.length - 1) * columnGap,
    height: stages.length === 0
      ? 0
      : rows * nodeHeight + (rows - 1) * rowGap,
    nodes,
    edges,
  }
}

/**
 * Return the complete upstream/downstream chain around one task.
 *
 * Traversal uses both dependency directions and remains cycle-safe, so the UI
 * can highlight every handoff related to the focused task even if malformed
 * durable data contains a cycle.
 */
export function relatedTaskIds(taskId: string, tasks: readonly RelationshipTask[]): ReadonlySet<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  if (!byId.has(taskId)) return new Set()
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      const targets = dependents.get(dependency) ?? []
      targets.push(task.id)
      dependents.set(dependency, targets)
    }
  }
  const related = new Set<string>()
  const upstreamSeen = new Set<string>()
  const downstreamSeen = new Set<string>()
  const visitUpstream = (id: string): void => {
    if (upstreamSeen.has(id)) return
    upstreamSeen.add(id)
    related.add(id)
    for (const dependency of byId.get(id)?.dependencies ?? []) visitUpstream(dependency)
  }
  const visitDownstream = (id: string): void => {
    if (downstreamSeen.has(id)) return
    downstreamSeen.add(id)
    related.add(id)
    for (const dependent of dependents.get(id) ?? []) visitDownstream(dependent)
  }
  visitUpstream(taskId)
  visitDownstream(taskId)
  return related
}

/* ─────────────────────────────────────────────────────────────────────────────
 * S3: per-member gate verdicts (compact layer + full detail on expand)
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * One judged constraint as the panel reads it off `/state`.
 *
 * ★ Declared structurally rather than imported from the host half (same reason
 *   as {@link MemberSubagent}): the payload crosses the wire as JSON, and a
 *   client typed from `src/types.ts` would make a server refactor a
 *   browser-only breakage.
 */
export interface GateRunView {
  readonly id: string
  readonly verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped'
  readonly count?: number
  readonly produced?: boolean
  /** Fired but its verdict was waived by observe mode; absent = not that case. */
  readonly observed?: boolean
}

/** The gate record for one task, as it reaches the panel. */
export interface GateEvaluationView {
  readonly ok: boolean
  readonly blockers: readonly string[]
  readonly unmeasured?: string
  readonly ran: readonly GateRunView[]
  readonly evaluated: number
  readonly skipped: number
  readonly registered: number
  readonly skippedAll?: string
  readonly observedBlockers?: number
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
export type MemberGateReadout =
  | { readonly state: 'absent' }
  | { readonly state: 'empty'; readonly registered: number; readonly skippedAll?: string }
  | { readonly state: 'verdict'; readonly verdict: MemberGateVerdict; readonly evaluation: GateEvaluationView }

/** How many `ran[]` entries carry one verdict. */
function verdictTally(entries: readonly GateRunView[], verdict: GateRunView['verdict']): number {
  return entries.filter((entry) => entry.verdict === verdict).length
}

/**
 * The verdict for every task a member owns, keyed by task id.
 *
 * ★ Purely derived: one `Map` walk, no host calls, so it is testable from the
 *   compiled `lib/client/activity-model.js` without a browser.
 */
export function memberGateReadouts(
  tasks: readonly { readonly id: string; readonly gateEvaluation?: unknown }[],
): ReadonlyMap<string, MemberGateReadout> {
  const out = new Map<string, MemberGateReadout>()
  for (const task of tasks) {
    const raw = task.gateEvaluation
    // ★ Absent / unreadable ⇒ 'absent'. This branch is the whole reason an
    //   unread tape must not look like a clean run.
    if (raw === undefined || raw === null || raw === '') {
      out.set(task.id, { state: 'absent' })
      continue
    }
    const evaluation = readGateEvaluation(raw)
    if (evaluation === undefined) {
      out.set(task.id, { state: 'absent' })
      continue
    }
    if (Array.isArray(evaluation.ran) && evaluation.ran.length === 0) {
      out.set(task.id, {
        state: 'empty',
        registered: evaluation.registered,
        ...evaluation.skippedAll === undefined ? {} : { skippedAll: evaluation.skippedAll },
      })
      continue
    }
    out.set(task.id, { state: 'verdict', verdict: memberGateVerdict(evaluation), evaluation })
  }
  return out
}

/**
 * Normalise one task's gate field into a record, whether it arrived serialised
 * or as an object. `undefined` = **unreadable**, which stays its own answer.
 */
function readGateEvaluation(raw: unknown): GateEvaluationView | undefined {
  if (typeof raw === 'string') return parseGateEvaluation(raw)
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Partial<GateEvaluationView>
  if (!Array.isArray(record.ran)) return undefined
  return {
    ok: record.ok === true,
    blockers: Array.isArray(record.blockers) ? record.blockers as string[] : [],
    ran: record.ran as GateRunView[],
    evaluated: typeof record.evaluated === 'number' ? record.evaluated : 0,
    skipped: typeof record.skipped === 'number' ? record.skipped : 0,
    registered: typeof record.registered === 'number' ? record.registered : 0,
    ...record.unmeasured === undefined ? {} : { unmeasured: record.unmeasured },
    ...record.skippedAll === undefined ? {} : { skippedAll: record.skippedAll },
    ...record.observedBlockers === undefined ? {} : { observedBlockers: record.observedBlockers },
  }
}

/** Parse the stringified record the status tool emits; undefined when unreadable. */
function parseGateEvaluation(raw: string): GateEvaluationView | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Partial<GateEvaluationView>
    if (!Array.isArray(record.ran)) return undefined
    return {
      ok: record.ok === true,
      blockers: Array.isArray(record.blockers) ? record.blockers as string[] : [],
      ran: record.ran as GateRunView[],
      evaluated: typeof record.evaluated === 'number' ? record.evaluated : 0,
      skipped: typeof record.skipped === 'number' ? record.skipped : 0,
      registered: typeof record.registered === 'number' ? record.registered : 0,
      ...record.unmeasured === undefined ? {} : { unmeasured: record.unmeasured },
      ...record.skippedAll === undefined ? {} : { skippedAll: record.skippedAll },
      ...record.observedBlockers === undefined ? {} : { observedBlockers: record.observedBlockers },
    }
  } catch {
    // ★ Malformed text is "cannot read", NOT "read and clean". Same shape rule.
    return undefined
  }
}

/** The one symbol for a member's compact verdict band. */
export type MemberGateVerdict = 'ok' | 'blocked' | 'unmeasured' | 'observed'

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
export function memberGateVerdict(evaluation: GateEvaluationView): MemberGateVerdict {
  if (typeof evaluation.unmeasured === 'string' && evaluation.unmeasured !== '') return 'unmeasured'
  /**
   * ★ 全跳过：`ran` 非空（全是 `skipped`），而 `skippedAll` 在场。
   * ⇒ 它是"判据没跑"，**不是**"跑过且通过"。两者在界面上必须不同形。
   */
  if (typeof evaluation.skippedAll === 'string' && evaluation.skippedAll !== '') return 'unmeasured'
  const observed = evaluation.ran.filter((entry) => entry.observed === true)
  if (observed.length > 0 || (evaluation.observedBlockers ?? 0) > 0) return 'observed'
  const abnormal = verdictTally(evaluation.ran, 'blocked') + verdictTally(evaluation.ran, 'unmeasured')
  if (abnormal > 0) return 'blocked'
  return 'ok'
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ v4（甲）：六个**阶段**、六种**判据状态**，以及它们到两行式的投影 ──────────
 *
 * 用户要看的只有两件：
 *   ① 他在哪个阶段   ② 他在做什么测试
 * 而"测试信息"必须**可插拔** —— 换掉一条判据（改 `src/gates/**`）⇒
 * UI 里连 `id` 带 `description` 一起变，**不用改 UI 代码**。
 *
 * ── ★★ 甲方案的边界（MEASURED，不许越过）────────────────────────────────────
 *
 * 只有 completion 段的判据结果**落盘**（`update-task.ts:1842` 写
 * `task.gateEvaluation`）；`contract` / `dispatch` / `delivery` / `runtime`
 * 求值了但**不落盘**。
 * ⇒ 所以那几段**只能显示"已通过（间接痕迹）"**，**绝不许假装有逐条裁决** ——
 *   把"我没读"画成"读到了"正是本仓记账最久的形态。
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * ★★★ t100：这里本来是一份**手抄**的 `FLOW_STAGES` 清单，注释逐字写着
 *   「Mirrors the host's `INSERTION_POINTS`」。
 *
 * ── 它为什么被删掉（MEASURED，队长实测）──────────────────────────────────────────
 *
 * · 主机加第七个位置 `collection` 时，它**没跟着加** ⇒ ★ 两份分叉
 * · ★★ 而**没有任何东西会红** —— 它是 `as const` 数组，不是类型错误
 * · ★★★ 后果：`MemberRow` 用它当**白名单**，于是主机交上来的 `collection` 段
 *   裁决被**静默丢掉** —— 而"丢掉了"与"主机没交"在界面上同形
 *
 * ── 现在的位置清单从哪来 ──────────────────────────────────────────────────────────
 *
 * ★ `snapshot.ts` 的 `gateCatalogForUi()` 按 `INSERTION_POINTS.map(...)` 生成，
 *   而那份 catalog **每份快照都带**（`TeamActivitySnapshot.gateCatalog`）。
 * ⇒ ★★ 所以客户端【不需要】一份自己的清单：它读主机给的那份。
 *
 * ★ 而 `FlowStage` 仍保留为**字符串别名**：它是"主机给的某个位置名"，
 *   不再是"这六个之一"。★ 这样主机加位置时，这里【不需要改】。
 */
export type FlowStage = string

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
export function taskStage(status: string, hasEvaluation: boolean): FlowStage | undefined {
  if (status === 'pending' || status === 'claimed') return 'dispatch'
  if (status === 'in_progress') return 'completion'
  if (status === 'completed') return hasEvaluation ? 'delivery' : undefined
  return undefined
}

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
export type GateState = 'passed' | 'skipped' | 'running' | 'registered' | 'pending' | 'observed'

/**
 * ── ★★★ t81：一段"**没有裁决**"的成因 —— ★ **四种必须不同形** ──────────────────────
 *
 * 本仓记账最久的形态是「**没找到**」与「**确实没有**」合流。而在判据分段这件事上，
 * 「这一段没有裁决」有**四种成因**，它们的补救动作**完全不同**：
 *
 * | 成因 | 什么情况 | 补救动作 |
 * |---|---|---|
 * | {@link SegmentAbsence.noGate} | ★ **该段取不到任务级裁决**（`admission` 已注册 3 条判据，但**生产零求值点**；`registered > 0` 而任务级拿不到） | 判据该接线，或把它从任务级面上撤掉 —— **不是**任务的问题 |
 * | {@link SegmentAbsence.teamLevel} | ★ **不是任务级事实**（`delivery` 团队级 / `runtime` 事件级） | 去团队级/事件级的读数里看 —— **永远**不会出现在任务上 |
 * | {@link SegmentAbsence.notReached} | 任务**还没走到**那一段 | 等 —— 它会自己出现 |
 * | {@link SegmentAbsence.notRecorded} | 走了，但**这一代没记**（retry 清过） | ★ 想知道上一代说了什么 ⇒ 看**历史**（`executions[]`） |
 *
 * ★★ 四者混成同一个 `○` 就是那个最久的形态。⇒ 本类型是**送进渲染层**的判别面，
 *   而 `GateState`（`○`/`⊘`/`✓`…）只回答"形状"，不回答"为什么"。
 */
export type SegmentAbsence =
  /** ★ 该段**真的没有判据**（`registered === 0`）—— `admission` 是唯一确定的一例。 */
  | 'noGate'
  /** ★ 该段不是**任务级**事实 —— `delivery`（团队级）/ `runtime`（事件级）。**永不落盘**。 */
  | 'teamLevel'
  /** ★ 任务**还没走到**这一段。 */
  | 'notReached'
  /** ★ 走到了，但**这一代没记**（`clearAttemptResult` 清过）—— ★ 与"没走到"不同形。 */
  | 'notRecorded'

/**
 * ── ★★★ t81：段落的**层级** —— 决定它能不能出现在任务上 ──────────────────────────
 *
 * ★★ `delivery` / `runtime` **永不落盘到 task**（团队级 / 事件级）：
 *   · `delivery` —— `src/tools/delivery.ts`：**整个团队**宣布交付，不是某条任务的事实；
 *   · `runtime`  —— `evaluateRuntimeGates`：**跨步骤**的过程约束（告警，不直接拒任务）。
 *   ⇒ ★ **不许为了"凑齐六段"给它们编一个 per-task 裁决** —— 那会造出一个**错误的事实**。
 *     这与 `admission` 的"真的 0 条"是**两件不同的事**（一个是没判据，一个是不属于任务）。
 */
export function segmentLevel(stage: FlowStage): 'task' | 'team' | 'event' | 'empty' {
  if (stage === 'delivery') return 'team'
  if (stage === 'runtime') return 'event'
  /**
   * ★ `admission` **已注册 3 条判据，但生产零求值点**（全仓无 `evaluate('admission', …)`）。
   *   ⇒ 它落在任务级面上、而永远拿不到裁决。
   * ★ 代码判的是 `registered === 0`（来自 `catalog` 的静态清单），**不写死**任何段名 ——
   *   所以这三条判据哪天真接上了线，这里**不需要改**。
   */
  return 'task'
}

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
export function segmentAbsence(
  stage: FlowStage,
  registered: number,
  reached: boolean,
): SegmentAbsence {
  /**
   * ★ 顺序是刻意的：**层级**先判 —— 因为它与"走到没走到"**无关**。
   *   `delivery`/`runtime` 哪怕任务明明走到了那一步（交付、运行中），
   *   它们的裁决也**不在任务上** ⇒ 报"团队级"，而不是"还没走到"。
   *   ★ 这正是反向半边 C：不许说"还没到"，也不许编一个裁决。
   */
  const level = segmentLevel(stage)
  if (level === 'team' || level === 'event') return 'teamLevel'
  /** ★ 真的没判据（空段）—— 与"没走到"不同形。 */
  if (registered === 0) return 'noGate'
  /** ★ 有判据、但这条任务还没走到那一段。 */
  if (!reached) return 'notReached'
  /** ★ 走到了、有判据，而这一代没记（retry 清过 / 求值路径没落）。 */
  return 'notRecorded'
}

/** The single glyph for each state. ★ 每个都不一样 —— 这是本模块存在的理由。 */
export const GATE_GLYPH: Readonly<Record<GateState, string>> = {
  passed: '✓',
  skipped: '⊘',
  running: '●',
  registered: '○',
  pending: '·',
  observed: '✗',
}

/** One criterion as the expanded panel draws it. */
export interface GateRowView {
  readonly id: string
  readonly description: string
  readonly state: GateState
  /** Fired but waived by observe mode; only meaningful with a reading. */
  readonly observing: boolean
}

/** One stage group as the expanded panel draws it. */
export interface StageGroupView {
  readonly stage: FlowStage
  /** How the stage as a whole reads, for its own glyph. */
  readonly state: GateState
  /**
   * ★ 该段有没有**真的**逐条裁决。
   * ★★ t81：**不再是"只有 completion"** —— 现在 contract / dispatch / completion
   *   三个任务级段都可能真的有（它们在服务端落盘）。
   */
  readonly hasVerdicts: boolean
  /**
   * ── ★★★ t81：这段**没有裁决**的成因（有裁决时缺席）─────────────────────────────
   *
   * ★★ 四者**不同形**（见 {@link SegmentAbsence}）：`noGate`（真的没判据）/
   *   `teamLevel`（不是任务级事实）/ `notReached`（还没走到）/ `notRecorded`（这一代没记）。
   *   ★ 混成一个 `○` 就是本仓记账最久的形态。
   * ★ `state === 'pending'`（空段，`rows` 为空）时也**给** `absence`：
   *   空段的成因（`noGate` vs `teamLevel`）恰恰是读的人最需要知道的。
   */
  readonly absence?: SegmentAbsence
  readonly rows: readonly GateRowView[]
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
export function stageGateRows(
  stage: FlowStage,
  catalog: readonly { readonly id: string; readonly description: string; readonly observing: boolean }[],
  evaluation: GateEvaluationView | undefined,
  /**
   * ── ★★ t81：该段的**按段落盘裁决**（`gateEvaluations[stage]`）────────────────────
   *
   * ★ 传入前的**优先级**（由 `stageGroups` 定）：按段字段优先，`evaluation`
   *   （S1 的单段 `gateEvaluation`）只作 **completion 段的兼容来源**。
   * ★ 缺席 ⇒ 该段这一代没有裁决（成因由 {@link segmentAbsence} 再细分）。
   */
  stageVerdicts?: GateEvaluationView,
): GateRowView[] {
  /**
   * ★★ t81：**不再是** `stage === 'completion' ? evaluation : undefined`。
   *   现在三个任务级段（contract / dispatch / completion）都可能**真的**有裁决
   *   （它们在服务端落盘，见 `TeamTask.gateEvaluations`）。
   *   ★ 而 `delivery` / `runtime` **仍然永远没有** —— 那**不是**因为"没走到"，
   *     而是因为它们**不是任务级事实**。见 {@link segmentLevel}。
   *   ★ 这里**不**为它们编一个裁决：`stageVerdicts` 对面那两段恒为 `undefined`，
   *     调用方也会用 {@link segmentAbsence} 把它们显示成「团队级」。
   */
  const verdicts = segmentLevel(stage) === 'task'
    ? (stageVerdicts ?? (stage === 'completion' ? evaluation : undefined))
    : undefined
  if (verdicts === undefined) {
    return catalog.map((gate) => ({ id: gate.id, description: gate.description, state: 'registered', observing: gate.observing }))
  }
  const byId = new Map(verdicts.ran.map((entry) => [entry.id, entry]))
  return catalog.map((gate) => {
    const entry = byId.get(gate.id)
    if (entry === undefined) {
      /** ★ 注册了但这一轮的 `ran[]` 里没有它 ⇒ ○（"没跑"），**不是** ✓。 */
      return { id: gate.id, description: gate.description, state: 'registered', observing: gate.observing }
    }
    return {
      id: gate.id,
      description: gate.description,
      state: gateRunState(entry, verdicts),
      observing: gate.observing,
    }
  })
}

/**
 * One `ran[]` entry's state.
 *
 * ★★ `skippedAll` 在场 ⇒ **整段都是 `skipped`（⊘）**，与逐条的 `verdict` 无关。
 *   这是 `c4cbeaf` 的判据在**逐条**这一层的对应物：全跳过时 `ran[]` 里
 *   **有**条目（每条 `verdict:'skipped'`），只按 `verdict` 分会让"跳过"落在
 *   "不是 blocked/unmeasured" ⇒ 读成通过。
 */
function gateRunState(entry: GateRunView, evaluation: GateEvaluationView): GateState {
  if (typeof evaluation.skippedAll === 'string' && evaluation.skippedAll !== '') return 'skipped'
  if (entry.verdict === 'skipped') return 'skipped'
  if (entry.verdict === 'ok') return entry.observed === true ? 'observed' : 'passed'
  return 'observed'
}

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
export function stageGroupState(
  stage: FlowStage,
  rows: readonly GateRowView[],
  evaluation: GateEvaluationView | undefined,
  /** ★★ t81：该段的按段落盘裁决（与 `stageGateRows` 同一入参、同一优先级）。 */
  stageVerdicts?: GateEvaluationView,
): GateState {
  if (rows.length === 0) return 'pending'
  const verdicts = segmentLevel(stage) === 'task'
    ? (stageVerdicts ?? (stage === 'completion' ? evaluation : undefined))
    : undefined
  if (verdicts === undefined) return 'registered'
  if (typeof verdicts.skippedAll === 'string' && verdicts.skippedAll !== '') return 'skipped'
  /** ★ 一段里有任何一条不是"通过"，整段就不是"通过" —— 优先报最需要人看的那个。 */
  if (rows.some((row) => row.state === 'observed')) return 'observed'
  if (rows.some((row) => row.state === 'running')) return 'running'
  if (rows.some((row) => row.state === 'skipped')) return 'skipped'
  if (rows.every((row) => row.state === 'passed')) return 'passed'
  if (rows.some((row) => row.state === 'passed')) return 'running'
  return 'registered'
}

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
export function doingLineCandidates(
  round: number | undefined,
  stage: FlowStage | undefined,
  testLabel: string,
): readonly string[] {
  const roundText = round !== undefined && Number.isFinite(round)
    ? `第 ${Math.max(1, Math.floor(round))} 轮`
    : ''
  const stageText = stage === undefined ? '' : `${stage} 段`

  /** 三段按**优先级从高到低**：轮次 > 阶段 > 测试。截断就是从这个列表的**尾部**丢。 */
  const byPriority = [roundText, stageText, testLabel].filter((part) => part !== '')
  /** ★ 从最全到最省：每丢一次尾部的"测试"、再丢一次"阶段"。 */
  const candidates: string[] = []
  for (let keep = byPriority.length; keep >= 1; keep -= 1) {
    candidates.push(byPriority.slice(0, keep).join(' · '))
  }
  return candidates.length > 0 ? candidates : ['']
}

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
export function memberGateTone(
  stage: FlowStage | undefined,
  groups: readonly StageGroupView[],
): 'absent' | 'skipped' | 'ok' | 'blocked' | 'unmeasured' | 'observed' {
  if (stage === undefined) return 'absent'
  const group = groups.find((candidate) => candidate.stage === stage)
  if (group === undefined) return 'absent'
  switch (group.state) {
    case 'passed': return 'ok'
    case 'skipped': return 'skipped'
    case 'observed': return 'observed'
    case 'running': return 'unmeasured'
    /** ★ `registered` / `pending` 都是"还没有任何裁决" ⇒ `absent`（不是 `ok`）。 */
    default: return 'absent'
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ B5：字符宽度是一等公民（零依赖的内联表）────────────────────────────────
 *
 * ── 为什么不用库（B0.6 已把代价实测完，照它做，不重新论证）──────────────────────
 *
 * 1. 「引库会违反 client externals 约束」**不成立** —— purity gate 只查
 *    `@deepseek-ai/*`，`CLIENT_EXTERNALS` 只有 7 个平台模块；
 * 2. ★★ **真代价**是：`package.json` **根本没有 `dependencies` 键** ⇒ 引库等于
 *    **新增运行时依赖 + lockfile 变更**；而体积进的是 **`lib/client.js`**
 *    （用户要下载的那一份）⇒ 对"极简"是**反向**取舍；
 * 3. 而**全覆盖要三个库**（width + bidi + emoji），5 个候选**全不在依赖树**。
 * ⇒ 采用**零依赖内联常量表**（B0.6 逐字给的方案）。
 *
 * ── ★★ 已知边界（必须在代码里说明，不许假装它完备）──────────────────────────────
 *
 * ★ 本表**只回答 B5 问的那个问题**：一个字符占 **1 列** 还是 **2 列**。
 *   · **不**处理 bidi（方向混排）—— 那需要 `bidi-js`，本任务不做；
 *   · **不**处理 emoji 的 ZWJ 序列 / 变体选择符 —— 那需要 `emoji-regex`，本任务不做；
 *   · ★ 而**代理对已处理**：`charColumns` 按**码点**走（`for…of`），
 *     `isWideCode` 吃 `codePointAt` 的结果 ⇒ 补充平面的 CJK（U+20000+）与 emoji
 *     都能落到正确的区间里。★ 这一点是对拍臂抓出来的（见那里）。
 *
 * ── 它为什么仍然够用 ────────────────────────────────────────────────────────
 *
 * UI 要的是"这行文字在 360px 容器里放不放得下"。放不下时的处置是**折行/省略号**，
 * 而不是像素级排版 ⇒ 判据是**列数**，不是渲染宽度。
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Half-width characters that must **not** be counted as wide.
 *
 * ★ 这些码位是 CJK 兼容区里的**半宽形式**（Unicode `East_Asian_Width=Halfwidth`），
 *   实际只占 1 列：半宽片假名（`ｱｲｳ`，U+FF61–U+FF9F）与半宽谚文（U+FFA0–U+FFDC）。
 *
 * ── ★★★ 状态如实标注：**这一段现在是冗余的**（对拍臂 M2 的实测）───────────────
 *
 * MEASURED（变异体实测）：把 `inHalfwidthSpans` 那一行**删掉**，27 条断言**全绿**
 * —— 因为下面 `WIDE_SPANS` 里没有任何区间覆盖 `0xFF61–0xFF9F`／`0xFFA0–0xFFDC`
 * （全角那一段是 `0xFF00–0xFF60`，**到 FF60 就停了**）⇒ 这个例外**从不触发**。
 *
 * ★ 那为什么还留着：**它是一道防将来改错的护栏**。若有人为了让某个码位变宽而把
 *   全角区间写成 `[0xFF00, 0xFF60]` → `[0xFF00, 0xFFEF]`（"把 FF 段都算宽"），
 *   这一行就会**立刻承重**，而那些半宽字符不会被静默算成 2 列。
 * ★★ 而不许写一条"测得到它"的断言：**当前的实现里没有任何输入能区分开它**，
 *   硬造一条只会是自证。⇒ 如实记成"现在是护栏、不是主路径"。
 */
const HALFWIDTH_SPANS: readonly (readonly [number, number])[] = [
  [0xFF61, 0xFF9F], // Halfwidth Katakana  ｡｢｣､･ｦｧ…ﾟ
  [0xFFA0, 0xFFDC], // Halfwidth Hangul    ﾠﾡﾢ…ﾜ
]

/**
 * Codepoint ranges that occupy **2 columns** (`East_Asian_Width` W or F).
 *
 * ★ 分区依据是 Unicode 的 East Asian Width 属性，**按区间独立写**；
 *   对拍臂（见 `cjkWidthTableCrossCheck`）把它与另一条独立实现的算法逐字比对。
 */
const WIDE_SPANS: readonly (readonly [number, number])[] = [
  [0x1100, 0x115F], // Hangul Jamo init.
  [0x2E80, 0x303E], // CJK Radicals · Kangxi · CJK Symbols & Punctuation
  [0x3041, 0x33FF], // Hiragana · Katakana · Bopomofo · Hangul Compat · CJK Compat
  [0x3400, 0x4DBF], // CJK Ext A
  [0x4E00, 0x9FFF], // CJK Unified Ideographs
  [0xA000, 0xA4CF], // Yi
  [0xAC00, 0xD7A3], // Hangul Syllables
  [0xF900, 0xFAFF], // CJK Compat Ideographs
  [0xFE10, 0xFE19], // Vertical forms
  [0xFE30, 0xFE6F], // CJK Compat Forms · Small Form Variants
  [0xFF00, 0xFF60], // Fullwidth Forms
  [0xFFE0, 0xFFE6], // Fullwidth signs
  [0x1F300, 0x1F64F], // Emoji (approximated: most are Wide)
  [0x1F900, 0x1F9FF],
  [0x20000, 0x2FFFD], // CJK Ext B…
  [0x30000, 0x3FFFD],
]

/** Whether one codepoint is in a halfwidth span (checked **before** the wide table). */
function inHalfwidthSpans(code: number): boolean {
  return HALFWIDTH_SPANS.some(([start, end]) => code >= start && code <= end)
}

/**
 * Whether one **codepoint** occupies two columns.
 * @param code - a Unicode codepoint (from `codePointAt`, **not** `charCodeAt`).
 *
 * ★★ 必须吃**码点**：补充平面（U+10000 以上）的字在 UTF-16 里是**代理对**，
 *   `charCodeAt` 给的是代理码元（U+D800–U+DFFF）⇒ 表里查不到 ⇒ 会被算成 1 列。
 *   ★ 这一点是**对拍臂抓出来的**（见文件里 `cjkWidthTableCrossCheck` 的注释）：
 *     我第一版用 `charCodeAt`，`😀` 与 `𠀀` 两条对不上，臂报 disagree=2。
 */
export function isWideCode(code: number): boolean {
  if (inHalfwidthSpans(code)) return false
  return WIDE_SPANS.some(([start, end]) => code >= start && code <= end)
}

/**
 * ── ★★★ B5：这段文字的**列数**（不是字符数）────────────────────────────────────
 *
 * ★ 为什么需要它：`role` 是**自由文本**（队长写进去的是 106–209 字符的英文长句），
 *   而将来它可以由成员定义给出**中文**。中文字占 **2 列** ⇒
 *   **同样的字符数，中文占的宽度约两倍** ⇒ 用"字符数"判"放不放得下"会**判错**。
 *
 * ★ 逐**码元**累加（`charCodeAt`）：BMP 之外的字按两个码元各算 1 列，
 *   与"一个补充平面字符"的差异见文件头那段**已知边界**。
 * @param text - the text to measure.
 * @returns the number of terminal columns the text occupies.
 */
export function charColumns(text: string): number {
  let columns = 0
  for (const char of text) {
    /** ★ `for…of` 按**码点**迭代（自动合并代理对）—— 与 `charCodeAt` 的关键区别。 */
    columns += isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
  }
  return columns
}

/**
 * ── ★★★ B5 的对拍臂（B0.6 逐字要求「若采用，必须先出一条对拍臂」）────────────────
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────────
 *
 * 上面那张表**是我手写的**，而 B0.6 逐字记着「该内联表的准确度**未验证**」。
 * ⇒ 一张手写的表必须与一个**独立来源**对拍，否则它就是**自证**
 *   （"我自己写的表说我算对了" —— 本仓记账最久的那一类）。
 *
 * ── 对拍源怎么选的（★ 关键：它必须与上表**独立**）─────────────────────────────
 *
 * ★ **不许把"我自己写的表"当对拍源**（那是自证）。这里用的是**另一条独立性质**：
 *   对每个被测码位，**用 `codePointAt` 取码点**（而不是 `charCodeAt` 的码元），
 *   然后按**区间表之外的独立判据**分类：
 *
 *     ① `toLowerCase`/`toUpperCase` 能改变它（拉丁/希腊/西里尔等字母）⇒ **窄**；
 *     ② 它是 ASCII 可打印字符 ⇒ **窄**；
 *     ③ 它在半宽片假名/半宽谚文区间 ⇒ **窄**；
 *     ④ 其余 ⇒ 按 Unicode **East_Asian_Width=W/F** 的区间表（**另一份独立的表**，见下）判。
 *
 * ★★ 而这里**必须诚实标注它证明了什么**：它证明的是
 *   「**两张独立写成的区间表在样本上一致**」，**不是**「这两张表等于 Unicode 全文」。
 *   真正的权威是 Unicode 的 `EastAsianWidth.txt` —— 而**引它就是一个依赖**，
 *   这正是 B0.6 要避免的。⇒ 判据的强度如实写在返回值里（`authority` 字段）。
 * @param samples - the codepoints to cross-check.
 * @returns per-sample verdicts plus an honest statement of what the check proves.
 */
export interface CrossCheckRow {
  readonly code: number
  readonly char: string
  /** What the inline table says. */
  readonly table: 1 | 2
  /** What the independent classifier says. */
  readonly independent: 1 | 2
  readonly agrees: boolean
}

export function cjkWidthTableCrossCheck(samples: readonly number[]): {
  readonly rows: readonly CrossCheckRow[]
  readonly agree: number
  readonly disagree: number
  /** ★ 这条臂**能证明什么**、**不能证明什么** —— 不许让读者以为它验了全部 Unicode。 */
  readonly authority: string
} {
  const rows = samples.map((code) => {
    const char = String.fromCodePoint(code)
    const table: 1 | 2 = isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
    const independent = independentWidthOf(code)
    return { code, char, table, independent, agrees: table === independent }
  })
  const agree = rows.filter((row) => row.agrees).length
  return {
    rows,
    agree,
    disagree: rows.length - agree,
    authority:
      'proves: two INDEPENDENTLY WRITTEN range tables agree on these samples. '
      + 'does NOT prove: that either table equals the full Unicode EastAsianWidth.txt '
      + '(importing that file would be a dependency, which B0.6 rejects).',
  }
}

/**
 * The **independent** classifier used only by the cross-check arm.
 *
 * ★ 它与上面的 `WIDE_SPANS` **分别写成**（不是同一个数组的两处引用）——
 *   否则"对拍"就退化成"自己与自己比"。
 * ★ 它按**码点**（`codePointAt` 的语义）判，而上表按**码元** ⇒ 两条路真的不同。
 */
function independentWidthOf(code: number): 1 | 2 {
  // ① 半宽形式 ⇒ 窄（Unicode: Halfwidth）
  if (code >= 0xFF61 && code <= 0xFF9F) return 1
  if (code >= 0xFFA0 && code <= 0xFFDC) return 1
  // ② ASCII 可打印 + Latin-1 补充 ⇒ 窄（Unicode: Na/N）
  if (code >= 0x20 && code <= 0x7E) return 1
  if (code >= 0xA0 && code <= 0x024F) return 1
  // ③ 希腊 / 西里尔 / 希伯来 / 阿拉伯 / 泰 / 天城文 ⇒ 窄（Unicode: N）
  if (code >= 0x0370 && code <= 0x0FFF && !(code >= 0x0E00 && code <= 0x0E7F)) return 1
  if (code >= 0x1E00 && code <= 0x1FFF) return 1
  if (code >= 0x2000 && code <= 0x2BFF) return 1
  // ④ CJK 各区间 ⇒ 宽（Unicode: W/F）—— 与上表**分别写**，区间边界刻意取不同粒度
  if (code >= 0x1100 && code <= 0x115F) return 2
  if (code >= 0x2E80 && code <= 0x303E) return 2
  if (code >= 0x3041 && code <= 0x33FF) return 2
  if (code >= 0x3400 && code <= 0x4DBF) return 2
  if (code >= 0x4E00 && code <= 0x9FFF) return 2
  if (code >= 0xA000 && code <= 0xA4CF) return 2
  if (code >= 0xAC00 && code <= 0xD7A3) return 2
  if (code >= 0xF900 && code <= 0xFAFF) return 2
  if (code >= 0xFE10 && code <= 0xFE19) return 2
  if (code >= 0xFE30 && code <= 0xFE6F) return 2
  if (code >= 0xFF00 && code <= 0xFF60) return 2
  if (code >= 0xFFE0 && code <= 0xFFE6) return 2
  if (code >= 0x1F300 && code <= 0x1F64F) return 2
  if (code >= 0x1F900 && code <= 0x1F9FF) return 2
  if (code >= 0x20000 && code <= 0x2FFFD) return 2
  if (code >= 0x30000 && code <= 0x3FFFD) return 2
  // 其余按"窄"（Unicode 的 Ambiguous/Neutral 在等宽 CJK 字体下多为窄）
  return 1
}

/**
 * ── ★★★ B6：把一行长文本**按列数**折成若干行（不是按字符数）────────────────────
 *
 * ★ 用 `charColumns` 而不是 `length`：`role` 里一旦出现中文，
 *   按字符数折行会让**中文行比英文行宽一倍** ⇒ 溢出。
 *
 * ★ 折行点优先取**空格**（英文长句不断词），中文没有空格 ⇒ 按**列**硬折。
 * @param text - the text to wrap.
 * @param maxColumns - the container's usable column count.
 * @returns the wrapped lines, at most `maxLines`.
 */
export function wrapByColumns(text: string, maxColumns: number, maxLines = Number.POSITIVE_INFINITY): readonly string[] {
  if (maxColumns <= 0) return [text]
  const lines: string[] = []
  let current = ''
  let currentColumns = 0
  /** ★ 记录"最近一个空格的位置"，于是英文可以**在词间断**而不是断在词中。 */
  let lastSpace = -1
  for (const char of text) {
    const charCols = isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
    if (currentColumns + charCols > maxColumns) {
      if (lastSpace >= 0) {
        lines.push(current.slice(0, lastSpace))
        current = current.slice(lastSpace + 1)
      } else {
        lines.push(current)
        current = ''
      }
      currentColumns = charColumns(current)
      lastSpace = -1
      if (lines.length >= maxLines) return lines.slice(0, maxLines)
    }
    current += char
    currentColumns += charCols
    if (char === ' ') lastSpace = current.length - 1
  }
  if (current !== '') lines.push(current)
  return lines.slice(0, maxLines === Number.POSITIVE_INFINITY ? undefined : maxLines)
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ 读数槽位读端（readout-panel，2026-10-24）：把 `readouts` 那一格读成五态 ──
 *
 * 三条读数线（evidence / pairing / backends）已经把数据写进 `team.readouts`，
 * 但此前**没有任何 UI 读它**（`grep -rn "readouts" src/client/` 仅 `activity-monitor.ts`
 * 一处声明）。本函数是那一半读端：纯函数、不碰 `ActivityTeam` 的字段
 * （只通过结构类型读 `readouts`），把每个槽位收敛成**不同形**的读端状态。
 *
 * ★ 五态必须不同形（整个产品最在意的一条）：
 *   · 整个 `readouts` 缺席 / 不是对象        ⇒ 三格全 `not-wired`
 *   · 键缺席（容器在，但那格没有这个键）    ⇒ 那一格 `not-wired`
 *     （**不是** measured 空数组，也**不是** unmeasured）
 *   · 值是 `{ unmeasured: '...' }`           ⇒ `unmeasured`，reason 原样带出
 *     （**不许**截断成"测不了"三个字）
 *   · 值本身测到了、但**嵌了一层** `{ unmeasured }` ⇒ `partial`，`unknown` 只放路径
 *     （如 `backends.capability.<id>.unmeasured`：后端读到了，但能力位那块没测成）
 *     ★ 这是今晚一直在防的假阳性：它若被吞成 `measured`，界面会显示"1 项"而那块其实是未知。
 *     ★ `partial` 的 `unknown` **只放路径**（`capability.claude`），原因不许拍平成 measured 的附注。
 *   · 全测到了                            ⇒ `measured`
 *
 * ★ 槽位专属分流（evidence / pairing 各有一层）：
 *   · evidence.reverified：`'yes'|'no'|'unknown'`，**无记录 = unknown**（不是 no）
 *     ⇒ unknown 必须显式「自述·未复核」，不许单独以"measured / N 项"出现
 *     （审计实测补证据可一次 update_task 伪造，全仓无判据读它）。
 *   · pairing.discrimination：`'none'` ⇒ `no-discrimination`（"22 项，本读数无判别力" + why 原样），
 *     **不许**渲染成绿色"22 项成对"；`'full'` ⇒ 才可按条显示；无该键（旧形状）⇒ 不猜，
 *     走 measured 并加注「缺 discrimination 标记（旧形状）」，不许静默当 full。
 *
 * ★ 为什么逐层收窄而不写 `as any`：容器把四线各自的结构塞进 `unknown`，任何一处
 *   `as any` 都会把"形状不对"静默吞掉 —— 而那正是"读不到"与"确实没有"同形这条老漏洞的来源。
 * @module dsh-agent-teams/client/activity/readout-summary
 */

export type ReadoutSlot =
  | { readonly kind: 'not-wired' }
  | { readonly kind: 'unmeasured'; readonly reason: string }
  | { readonly kind: 'measured'; readonly summary: string; readonly detail: readonly string[] }
  | { readonly kind: 'partial'; readonly summary: string; readonly unknown: readonly string[] }
  | { readonly kind: 'no-discrimination'; readonly summary: string; readonly why: string }

export interface ReadoutSummary {
  readonly evidence: ReadoutSlot
  readonly pairing: ReadoutSlot
  readonly backends: ReadoutSlot
}

const NOT_WIRED: ReadoutSlot = { kind: 'not-wired' }

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 收值里"嵌了 `{ unmeasured: '…' }`"的所有位置（≤2 层，足够覆盖
 * `capability.<id>.unmeasured` 这种形状）。只收**路径**（如 `capability.claude`），
 * 不把原因拍平进来——原因会被读成"补充说明"，而不是"这块没测成"。
 *
 * @returns 相对槽位值的点分隔路径数组，如 `['capability.claude']`。
 */
function nestedUnmeasuredPaths(value: unknown, depthLeft: number, base: readonly string[]): string[] {
  if (depthLeft <= 0 || !isPlainRecord(value)) return []
  const out: string[] = []
  for (const [key, child] of Object.entries(value)) {
    if (!isPlainRecord(child)) continue
    if (typeof child.unmeasured === 'string') {
      out.push([...base, key].join('.'))
    } else {
      out.push(...nestedUnmeasuredPaths(child, depthLeft - 1, [...base, key]))
    }
  }
  return out
}

/**
 * 把"一个槽位的原始值"收敛成读端状态（五态之一）。
 *
 * @param value - `readouts[key]` 的原始值；键缺席时调用方传 `undefined`。
 * @param slot - 槽位名，用于 evidence 的 `reverified` / pairing 的 `discrimination` 专属分流。
 */
function slotOf(value: unknown, slot: 'evidence' | 'pairing' | 'backends'): ReadoutSlot {
  // 键缺席 ⇒ not-wired（不是 measured 空、也不是 unmeasured）
  if (value === undefined) return NOT_WIRED

  if (isPlainRecord(value)) {
    // 顶层 `{ unmeasured: '...' }` ⇒ unmeasured，reason 原样带出（不许截断成"测不了"）
    if (typeof value.unmeasured === 'string') {
      return { kind: 'unmeasured', reason: value.unmeasured }
    }

    // ── pairing 专属：discrimination ───────────────────────────────────────────
    if (slot === 'pairing') {
      const disc = value.discrimination
      if (disc === 'none') {
        // 恒真式：不许渲染成绿色"N 项成对"，明确说"无判别力" + why 原样带出
        const n = entriesCount(value.entries)
        const why = typeof value.why === 'string' ? value.why : ''
        return { kind: 'no-discrimination', summary: `${n} 项，本读数无判别力`, why }
      }
      if (disc === undefined) {
        // 旧形状（未换 discrimination 标记）：不猜，走 measured 并加注；不许静默当 full
        const m = measuredOf(value)
        return { kind: 'measured', summary: m.summary, detail: [...m.detail, '缺 discrimination 标记（旧形状）'] }
      }
      // disc === 'full' ⇒ 按条显示，落到下面的 measured / partial
    }

    // ── evidence 专属：reverified ─────────────────────────────────────────────
    if (slot === 'evidence') {
      const rev = value.reverified
      const revState = rev === 'yes' || rev === 'no' ? rev : 'unknown' // 无记录 = unknown（不是 no）
      if (revState === 'unknown') {
        // 判据（写进注释，防止下次又把计数吞掉）：
        //   "0 条" 是【查过了没有】⇒ measured
        //   "没接线" 是【没查】      ⇒ not-wired
        //   "N 条但没复核" ⇒ unmeasured，且必须带 N
        //   三者不许同形，且谁也不许把对方的数字吃掉。
        const n = entriesCount(value.entries) // 复用已有的 entriesCount
        if (n === 0) {
          // "查过了，确实没有" —— 这是一次真实测量，不是"没测"
          return { kind: 'measured', summary: '0 条证据（已读两条流，确无）', detail: ['evidence 流为空'] }
        }
        return { kind: 'unmeasured', reason: `自述·未复核：${n} 条；补证据可被一次 update_task 调用伪造，全仓无判据读它` }
      }
      // 'yes' | 'no' ⇒ 落到下面的 measured / partial
    }

    // ── 嵌套 unmeasured 探测（≤2 层，覆盖 capability.<id>.unmeasured）──────────
    // 顶层已在上面判过；这里只收更深一层，它们是会被 measured 吞掉的假阳性。
    const unknownPaths = nestedUnmeasuredPaths(value, 2, [])
    if (unknownPaths.length > 0) {
      // summary 仍给规模；unknown 只放路径，不许把原因拍平成 measured 的附注
      return { kind: 'partial', summary: summarizeMeasured(value), unknown: unknownPaths }
    }

    // 其余 ⇒ measured
    return measuredOf(value)
  }

  // 数组 / 原始值 ⇒ measured
  return measuredOf(value)
}

/** 把"全测到了"的值收敛成 measured（summary + detail）。 */
type MeasuredSlot = { readonly kind: 'measured'; readonly summary: string; readonly detail: readonly string[] }
function measuredOf(value: unknown): MeasuredSlot {
  return { kind: 'measured', summary: summarizeMeasured(value), detail: buildDetail(value) }
}

/** 从 pairing 的 `entries` 字段取规模（数组看 length、记录看键数、数字直接用）。 */
function entriesCount(entries: unknown): number | string {
  if (Array.isArray(entries)) return entries.length
  if (isPlainRecord(entries)) return Object.keys(entries).length
  if (typeof entries === 'number') return entries
  return '?'
}

/**
 * 槽位徽标文案：五态各一字；evidence 的 unmeasured 显式写成「自述·未复核」
 * （审计实测补证据可一次 update_task 伪造，全仓无判据读它）。
 * 这是 UI 渲染路径的纯函数化，便于测试断言徽标文案。
 */
export function readoutBadgeLabel(kind: ReadoutSlot['kind'], name: string): string {
  if (kind === 'not-wired') return '未接线'
  if (kind === 'unmeasured') return name === 'evidence' ? '自述·未复核' : '未测成'
  if (kind === 'measured') return '已测'
  if (kind === 'partial') return '部分未测'
  return '无判别力'
}

/** 单行摘要：空表必须明说为 0，非空则给出规模。 */
function summarizeMeasured(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} 项`
  if (!isPlainRecord(value)) return String(value)
  const entries = Object.entries(value)
  if (entries.length === 0) return '0 项'
  // 空表启发式：每个条目都是空集合（空数组 / 空对象）→ 视为空
  if (entries.every(([, v]) => isEmptyCollection(v))) return '0 项'
  // 优先报数组字段的规模（后端 providers、证据流等主集合都是数组）
  const arrays = entries.filter(([, v]) => Array.isArray(v))
  if (arrays.length > 0) {
    return arrays.map(([k, v]) => `${k}: ${(v as readonly unknown[]).length} 项`).join('，')
  }
  return `${entries.length} 项`
}

/** 一个值是否为"空集合"（空数组或空对象）—— 用于空表启发式。 */
function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (isPlainRecord(value)) return Object.keys(value).length === 0
  return false
}

/** 细节：展示读数长什么样（键名 + 值的一行摘要），但不塞整个 JSON，超 6 条写 `…+N`。 */
function buildDetail(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    const head = value.slice(0, 6)
    const lines = head.map((item, index) => `#${index}: ${oneLine(item)}`)
    if (value.length > head.length) lines.push(`…+${value.length - head.length}`)
    return lines
  }
  if (isPlainRecord(value)) {
    const entries = Object.entries(value)
    const head = entries.slice(0, 6)
    const lines = head.map(([key, val]) => `${key}: ${oneLine(val)}`)
    if (entries.length > head.length) lines.push(`…+${entries.length - head.length}`)
    return lines
  }
  return [oneLine(value)]
}

/** 值的单行摘要（不递归展开对象/数组，避免把整个 JSON 塞进 detail）。 */
function oneLine(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[…${value.length}]`
  if (isPlainRecord(value)) return `{${Object.keys(value).length} 键}`
  return String(value)
}

/**
 * ── ★★ 读数读端主入口 ─────────────────────────────────────────────────────────
 *
 * 接受 `{ readouts?: … }` 的结构类型（即 `ActivityTeam`），**只读**那一格。
 * 不修改、不新增 `ActivityTeam` 的字段。
 *
 * @returns 三个已接线槽位（evidence / pairing / backends）各自的四态读端。
 */
export function readoutSummaryOf(team: {
  readonly readouts?: Readonly<Record<string, unknown>>
}): Readonly<ReadoutSummary> {
  const readouts = team.readouts
  if (readouts === undefined || !isPlainRecord(readouts)) {
    // 整个容器缺席 ⇒ 三格全 not-wired（与"接了但空"不同形）
    return { evidence: NOT_WIRED, pairing: NOT_WIRED, backends: NOT_WIRED }
  }
  return {
    evidence: slotOf(readouts.evidence, 'evidence'),
    pairing: slotOf(readouts.pairing, 'pairing'),
    backends: slotOf(readouts.backends, 'backends'),
  }
}
