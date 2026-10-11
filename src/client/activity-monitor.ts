/** Shared, demand-driven state for the AgentTeams browser monitor. */

/**
 * The three-way classification of a `failed` task: why it stopped.
 *
 * Its values mirror the host's `FailureKind` (`src/state.ts` `failureKindOf`) and
 * are deliberately NOT renamed here, so a third vocabulary cannot appear.
 * This is the presentation-side mirror of a server fact, not a second source of
 * truth: the client never recomputes the rules, only renders the value it got.
 */
export type TaskFailureKind = 'inconclusive' | 'failed_delivery' | 'failed_context'

/** Every classification the client can render for a task's terminal state. */
export type TaskFailureTone = TaskFailureKind | 'unknown'

/**
 * Render-facing classification of a terminal failure.
 *
 * ★ `unknown` is load-bearing, not a default to be styled away: an absent or
 *   unrecognised `failureKind` means "the host did not measure this", which must
 *   never be drawn as any of the three measured kinds. It falls back to today's
 *   single `failed` behaviour instead — see {@link taskFailureTone}.
 */
export const TASK_FAILURE_TONES: readonly TaskFailureTone[] = [
  'inconclusive', 'failed_delivery', 'failed_context', 'unknown',
]

/** Task shape needed to classify a failure (the optional kind field plus status). */
export interface FailureKindTask {
  readonly status: string
  /** Published by the host only for a task whose status is `failed`. */
  readonly failureKind?: string
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
export function failureToneOf(task: FailureKindTask): TaskFailureTone {
  if (task.status !== 'failed') return 'unknown'
  const kind = task.failureKind
  if (kind === 'inconclusive' || kind === 'failed_delivery' || kind === 'failed_context') return kind
  /**
   * ★ Fall back rather than guess. An absent `failureKind` is "not measured",
   *   and the conservative render is today's undifferentiated failure — never
   *   an amber "found problems" that nobody actually found.
   */
  return 'unknown'
}

/**
 * Whether this terminal task should read as amber convergence rather than red.
 * True only when the host MEASURED that the review/repair loop did its job.
 */
export function isConsultativeFailure(task: FailureKindTask): boolean {
  return failureToneOf(task) === 'inconclusive'
}

/** Whether this terminal task carries measured evidence that the work broke. */
export function isBrokenFailure(task: FailureKindTask): boolean {
  return failureToneOf(task) === 'failed_delivery'
}

/** Whether nothing was measured either way — neither red nor green. */
export function isUnmeasuredFailure(task: FailureKindTask): boolean {
  return failureToneOf(task) === 'failed_context'
}

/** One member row of a host snapshot. */
export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly executionPrompt?: string
  readonly status?: 'idle' | 'working' | 'removed'
  readonly activity: 'working' | 'idle' | 'unknown'
  /**
   * Session-liveness state published by the host: whether the member's session
   * is still alive at all. ★ Distinct from `activity`, which is a durable field
   * that keeps saying `working` after the session dies; absent on older hosts.
   */
  readonly liveness?: string
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  readonly unread: number
}

/** One task row of a host snapshot. */
export interface ActivityTask {
  readonly id: string
  readonly subject: string
  readonly description?: string
  readonly status: string
  readonly state: 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled'
  readonly assignee: string
  readonly model?: string
  readonly dependencies: readonly string[]
  readonly depth: number
  readonly kind?: string
  readonly round?: number
  readonly verdict?: string
  /**
   * Why a `failed` task stopped, as classified by the host (see TaskFailureKind).
   * ★ Optional: older snapshots and non-failed tasks omit it, and the UI must
   *   then fall back to the undifferentiated failure rather than guessing.
   */
  readonly failureKind?: string
  /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
  readonly updatedAt?: number
}

/** One captain-inbox preview row. */
export interface ActivityMessage {
  readonly from: string
  readonly content: string
}

/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly phase: 'staged' | 'running'
  readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  readonly halted?: boolean
  readonly members: readonly ActivityMember[]
  readonly tasks: readonly ActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly ActivityMessage[]
}

/** A successfully-created conversation card that currently needs updates. */
export interface ActivityMonitorTarget {
  readonly key: string
  readonly sessionId: string
  readonly teamId: string
}

/** Latest shared response data for both the floater and conversation cards. */
export interface ActivitySnapshots {
  readonly teams: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
}

interface RegisteredTarget extends ActivityMonitorTarget {
  refs: number
  active: boolean
}

const targets = new Map<string, RegisteredTarget>()
const targetListeners = new Set<() => void>()
const snapshotListeners = new Set<() => void>()
let targetSnapshot: readonly ActivityMonitorTarget[] = []
let activitySnapshots: ActivitySnapshots = { teams: [], archivedTeams: [] }

function targetKey(sessionId: string, teamId: string): string {
  return `${sessionId}\u0000${teamId}`
}

function publishTargets(): void {
  targetSnapshot = [...targets.values()]
    .filter((target) => target.active)
    .map(({ key, sessionId, teamId }) => ({ key, sessionId, teamId }))
  for (const listener of targetListeners) listener()
}

/** Subscribe to the active monitor-target list (React external-store shape). */
export function subscribeActivityMonitorTargets(listener: () => void): () => void {
  targetListeners.add(listener)
  return () => { targetListeners.delete(listener) }
}

/** Read the stable active-target snapshot. */
export function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[] {
  return targetSnapshot
}

/**
 * Register one successful AgentTeams card as a monitoring demand.
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export function monitorAgentTeam(sessionId: string, teamId: string): () => void {
  const owner = sessionId.trim()
  const id = teamId.trim()
  if (owner === '' || id === '') return () => {}
  const key = targetKey(owner, id)
  const existing = targets.get(key)
  if (existing === undefined) {
    targets.set(key, { key, sessionId: owner, teamId: id, refs: 1, active: true })
    publishTargets()
  } else {
    existing.refs += 1
    if (!existing.active) {
      existing.active = true
      publishTargets()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const current = targets.get(key)
    if (current === undefined) return
    current.refs -= 1
    if (current.refs <= 0) {
      targets.delete(key)
      if (current.active) publishTargets()
    }
  }
}

/** Stop polling targets whose final archived snapshot has been captured. */
export function settleActivityMonitorTargets(keys: ReadonlySet<string>): void {
  let changed = false
  for (const key of keys) {
    const target = targets.get(key)
    if (target?.active !== true) continue
    target.active = false
    changed = true
  }
  if (changed) publishTargets()
}

/** Subscribe to the shared live/archive snapshot. */
export function subscribeActivitySnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/** Read the stable shared live/archive snapshot. */
export function getActivitySnapshotsSnapshot(): ActivitySnapshots {
  return activitySnapshots
}

/**
 * ── ★★★ t31：两个 snapshot 载荷**按内容**相等吗（而不是按对象身份）──────────────
 *
 * ── 它修的是什么（MEASURED，captain 实测）──────────────────────────────────────
 *
 * `updateActivitySnapshots` 此前用**引用**比较做闸门：
 *
 *     if (next.teams === activitySnapshots.teams
 *         && next.archivedTeams === activitySnapshots.archivedTeams) return
 *
 * ★ 而派发那一段每次都用 `response.json()` 造载荷（`JSON.parse` 的语义）——
 *   它**每次都新建一个对象图**。⇒ 两次**逐字节相同**的响应是两个不同的对象：
 *
 *     JSON.parse(s).teams === JSON.parse(s).teams   ⇒   **false**
 *
 * ⇒ 那个闸门**永远不成立** ⇒ 每一次成功的轮询都通知**每一个**订阅者 ⇒
 *   每秒一次全量重渲染（`ACTIVITY_POLL_MS = 1000`），即使一个字节都没变。
 *
 * ★ 用户的框定就是需求本身：**这是一层 projection** —— 它应该在
 *   **有东西变了**的时候重渲染，且只在那时候。
 *
 * ── ★★★ 为什么是"逐字段 + 只在字段真的被带上时才算" ─────────────────────────────
 *
 * `next` 是**合并**出来的（`update.teams ?? activitySnapshots.teams`）——
 * ⇒ 一次只带 `archivedTeams` 的调用，会让 `next.teams` **就是**旧的那个引用。
 *   于是"两个字段都按内容比"会把这种调用读成"没变"。那是对的，但**理由要写清**：
 *
 *     调用方交上来的那个字段           ⇒ 与旧值**按内容**比
 *     调用方**没**交上来的那个字段      ⇒ 沿用旧值 ⇒ **按定义没有变**（不是"比出来相等"）
 *
 * ★★ 这两条必须分开，否则会撞上两个相反方向的错：
 *   · 把"没交上来"也拿去按内容比 ⇒ 白比一次（结论相同，但语义不清）；
 *   · 把"交上来了但内容相同"当成变了 ⇒ **这正是本任务要修的那个 bug 的另一半**
 *     （只不过判据从"引用不同"换成"内容不同"而已）。
 *
 * ── ★★ 归档路径**不许**被这条去重削弱（验收第 5 条）─────────────────────────────
 *
 * 归档载荷走的是**另一个字段**（`archivedTeams`），而上面这条逐字段比较天然
 * 把它们分开：
 *
 *     归档变了、活的那个没变  ⇒ `archivedTeams` 那一半不等 ⇒ **通知**（正确）
 *     只有活的那个变了        ⇒ `archivedTeams` 沿用旧值   ⇒ 仍按活的那半判（正确）
 *
 * ⇒ 两个字段各自独立判定，**任一**按内容不等即通知。
 *   ★ 而"合成一个字符串再比"是**更坏**的写法（见下 `contentEquals` 的注释）。
 */
function contentEquals(a: unknown, b: unknown): boolean {
  /**
   * ① 引用相等 ⇒ 内容必然相等（快路径，且它让"沿用旧值"这一情形零成本）。
   */
  if (a === b) return true
  /**
   * ── ★★ 为什么**不**用 `JSON.stringify(a) === JSON.stringify(b)` ────────────────
   *
   * 它是这一格里最显眼、也最坏的写法，理由是决定性的：它**对键序敏感**。
   *
   *     JSON.stringify({x:1,y:2}) === JSON.stringify({y:2,x:1})   ⇒   **false**
   *
   * ★ 而这些载荷来自 `JSON.parse` —— 键序跟随**响应体**的字节序，而响应体由
   *   宿主那边对象的属性顺序决定。⇒ 一次纯粹的服务端重构（字段顺序变了、
   *   内容一字未变）会让这里报"变了" ⇒ **每次轮询都重渲染**，即本 bug 原样复发 ——
   *   只不过这次它藏在"我已经修了去重"的错觉底下。
   *   ★ 那是本队记账最久的那条形态：**修好的那一半把没修的那一半盖住了。**
   *
   * ⇒ 用**结构化**比较：递归、键序无关、数组按序。
   */
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  /**
   * ② 数组：**按序**逐项比（顺序在这里是内容的一部分 —— 轮次/成员的次序是
   *   宿主刻意给的，重排就是一次真的变化）。
   */
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!contentEquals(a[index], b[index])) return false
    }
    return true
  }
  /**
   * ③ 普通对象：键集合相等（**不看顺序**），且每个键的值按内容相等。
   */
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    /**
     * ★ `Object.hasOwn` 而不是 `key in right`：后者会把**原型链**上的名字
     *   （`constructor`、`toString`…）读成"有这个键"—— 而一个来自
     *   `JSON.parse` 的载荷**不可能**有那些自有键。用 `in` 会让
     *   `{constructor: 1}` 与 `{}` 在这一格里同形。
     */
    if (!Object.hasOwn(right, key)) return false
    if (!contentEquals(left[key], right[key])) return false
  }
  return true
}

/**
 * Publish one or both successful state-route responses.
 *
 * ★★★ 通知的条件是【**内容**变了】，不是【对象换了】（t31）。
 *   判据见 {@link contentEquals}；"为什么引用比较在这里恒不成立"也写在那一格。
 */
export function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void {
  const next = {
    teams: update.teams ?? activitySnapshots.teams,
    archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams,
  }
  /**
   * ★ 逐字段判定，且**只在调用方真的带上那个字段时**才比 —— 见函数头那段：
   *   "没交上来"是**按定义**没变，不是"比出来相等"。
   */
  const teamsChanged = update.teams !== undefined && !contentEquals(next.teams, activitySnapshots.teams)
  const archivedChanged = update.archivedTeams !== undefined
    && !contentEquals(next.archivedTeams, activitySnapshots.archivedTeams)
  /**
   * ★★★ 这条 `return` 就是本任务的全部目的：一个逐字节相同的轮询在这里停下，
   *   订阅者**一次都不被通知** ⇒ 不重渲染。
   */
  if (!teamsChanged && !archivedChanged) return
  activitySnapshots = next
  for (const listener of snapshotListeners) listener()
}

/** Poll cadence for the live host snapshot route. */
export const ACTIVITY_POLL_MS = 1000
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped agent_teams_create) without turning
 * every ordinary session into a one-second filesystem scan.
 */
export const ACTIVITY_PROBE_MS = 5000
/** Host route serving live and archived team snapshots. */
export const ACTIVITY_STATE_URL = '/plugins/dsh-agent-teams/state'
export const ACTIVITY_HALT_URL = '/plugins/dsh-agent-teams/halt'

interface ActivityFetchResponse {
  readonly ok: boolean
  json(): Promise<unknown>
}

/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
  /** Connection health for views; never clears the last successful snapshot. */
  readonly onStatus?: (status: 'ready' | 'error') => void
  /**
   * Current captain session to discover after a cold client/host restart.
   * This one-time scope restores teams whose older conversation log has no
   * AgentTeams card capable of registering an explicit monitor target.
   */
  readonly discoverySessionId?: string
  readonly fetchState?: (
    url: string,
    init: { readonly cache: 'no-store'; readonly signal: AbortSignal },
  ) => Promise<ActivityFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void
  readonly settleTargets?: (keys: ReadonlySet<string>) => void
}

/** Handle returned by one current-session polling loop. */
export interface ActivityPollingController {
  /** The immediate first pass, exposed so offline verification can await it. */
  readonly firstTick: Promise<void>
  /** Idempotently stop the timer and abort the current request. */
  stop(): void
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
export function startActivityPolling(
  monitorTargets: readonly ActivityMonitorTarget[],
  runtime: ActivityPollingRuntime = {},
): ActivityPollingController {
  const discoverySessionId = runtime.discoverySessionId?.trim()
  if (monitorTargets.length === 0 && (discoverySessionId === undefined || discoverySessionId === '')) {
    return { firstTick: Promise.resolve(), stop: () => {} }
  }
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots
  const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets
  let cancelled = false
  let inFlight = false
  // Explicit card targets are demanded work: start at the live cadence. A
  // discovery session starts probing low-frequency and upgrades on detection.
  let hot = monitorTargets.length > 0
  let discoveryComplete = false
  let discoveredLiveKeys = new Set<string>()
  let controller: AbortController | undefined
  let timer: unknown
  const intervalMs = (): number => (hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS)
  const reschedule = (): void => {
    cancel(timer)
    timer = schedule(() => { void tick() }, intervalMs())
  }
  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    controller = new AbortController()
    try {
      const liveResponse = await fetchState(ACTIVITY_STATE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!liveResponse.ok) throw new Error('Activity unavailable')
      const body = (await liveResponse.json()) as { teams?: unknown }
      if (cancelled) return
      if (!Array.isArray(body.teams)) throw new Error('Invalid activity response')
      runtime.onStatus?.('ready')
      const liveTeams = body.teams as readonly ActivityTeam[]
      publishSnapshots({ teams: liveTeams })
      const previousDiscoveredKeys = discoveredLiveKeys
      discoveredLiveKeys = new Set(discoverySessionId === undefined || discoverySessionId === ''
        ? []
        : liveTeams
          .filter((team) => team.captainSessionId === discoverySessionId)
          .map((team) => team.teamId))
      // A discovery session found its first team: upgrade from the low-frequency
      // probe to the live cadence for the rest of the controller lifetime.
      if (!hot && discoveredLiveKeys.size > 0) {
        hot = true
        reschedule()
      }
      const discoveredTeamArchived = [...previousDiscoveredKeys]
        .some((teamId) => !discoveredLiveKeys.has(teamId))
      const missing = monitorTargets.filter((target) => !liveTeams.some((team) =>
        team.captainSessionId === target.sessionId && team.teamId === target.teamId,
      ))
      const needsDiscoveryArchive = discoverySessionId !== undefined
        && discoverySessionId !== ''
        && !discoveryComplete
      if (missing.length === 0 && !needsDiscoveryArchive && !discoveredTeamArchived) return

      // Archives are immutable per team generation. A successful fallback
      // retires every missing explicit target, including legacy cards whose
      // host archive no longer exists; a discovery session that already
      // upgraded keeps polling, and a still-probing one keeps probing, so a
      // team created later in the same session stays discoverable.
      const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!archivedResponse.ok) throw new Error('Archive unavailable')
      const archivedBody = (await archivedResponse.json()) as { teams?: unknown }
      if (cancelled) return
      if (!Array.isArray(archivedBody.teams)) throw new Error('Invalid archive response')
      publishSnapshots({ archivedTeams: archivedBody.teams as readonly ActivityTeam[] })
      discoveryComplete = true
      settleTargets(new Set(missing.map((target) => target.key)))
    } catch (error: unknown) {
      if ((error as { name?: unknown })?.name === 'AbortError') return
      if (!cancelled) runtime.onStatus?.('error')
      // Host restarting; keep the last snapshot and retry on the next tick.
    } finally {
      inFlight = false
    }
  }
  const firstTick = tick()
  if (timer === undefined) timer = schedule(() => { void tick() }, intervalMs())
  return {
    firstTick,
    stop: () => {
      if (cancelled) return
      cancelled = true
      controller?.abort()
      cancel(timer)
    },
  }
}
