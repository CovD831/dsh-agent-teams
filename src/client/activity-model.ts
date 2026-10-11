/** Pure relationship projections used by the AgentTeams activity panel. */

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

/** A live team the current captain still owns and has not halted. */
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
  if (team.tasks.length === 0) return { working: 0, detail: '' }
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
export function taskLoopTone(task: LoopTask): LoopTone {
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

/** Whether a review/repair loop exists: ≥2 rounds, the shape a single run never has. */
export function hasReviewLoop<T extends LoopTask>(tasks: readonly T[]): boolean {
  return reviewLoop(tasks).rounds.length >= 2
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Member clock: how long this member has been on its current task
 * ───────────────────────────────────────────────────────────────────────────── */

/** What one member's elapsed readout means. */
export type MemberClockKind =
  /** The member's own session is live and working; the clock counts real progress. */
  | 'running'
  /** Work is still open but nothing is driving it; the clock counts abandonment, not work. */
  | 'stale'
  /** Nothing open to time. */
  | 'none'

/** Complete elapsed readout for one member row. */
export interface MemberClock {
  readonly kind: MemberClockKind
  readonly ms: number
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
  const owned = tasks.filter((task) => task.assignee === member.name)
  const open = owned.filter((task) => !taskIsTerminal(task.status))
  if (open.length === 0) return { kind: 'none', ms: 0 }
  const current = member.currentTask === undefined || member.currentTask === ''
    ? undefined
    : open.find((task) => task.id === member.currentTask)
  const timed = current ?? open.reduce((latest, task) => {
    const stamp = durableStamp(task.updatedAt)
    const best = durableStamp(latest.updatedAt)
    return stamp !== undefined && (best === undefined || stamp > best) ? task : latest
  }, open[0]!)
  const stamp = durableStamp(timed.updatedAt)
  if (stamp === undefined) return { kind: 'none', ms: 0 }
  const ms = Math.max(0, now - stamp)
  return { kind: memberIsDriving(member) ? 'running' : 'stale', ms }
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
