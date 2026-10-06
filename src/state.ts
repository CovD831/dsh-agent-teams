/**
 * Team state persistence and pure team-logic rules.
 *
 * State lives on disk under `<workspace>/<stateDir>/<teamId>/`:
 * - `team.json` — the durable {@link TeamState} record
 * - `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a
 *   member name), mirroring the Claude Code AgentTeams mailbox layout
 *
 * All mutations run through an in-process per-team queue so read-modify-write
 * stays serial; `fs/promises` is used directly because the plugin owns this
 * bookkeeping (host-plane state, like session persistence) and the abstract
 * `fs` service offers no directory deletion.
 * @module dsh-agent-teams/state
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TERMINAL_TASK_STATUSES, type TaskStatus, type TeamMember, type TeamMessage, type TeamProfileSnapshot, type TeamState, type TeamTask } from './types.ts'
import { hasValidQualityTaskFields, isReviewPolicy, normalizeBlankOptionalTaskFields } from './quality-gates.ts'

export {
  amendTaskContract,
  buildCoverageMatrix,
  canDeclareDelivery,
  classifyChangedPath,
  collectChangedPaths,
  defaultQualityDeliveryGraph,
  describeQualityLoop,
  evaluateQualityCompletion,
  hasValidQualityTaskFields,
  isQualityKind,
  isTaskRevision,
  normalizeBlankOptionalTaskFields,
  pathMatchesScope,
  planQualityFollowUp,
  qualityPlanningPrompt,
  resumeTeamState,
  sanitizeReviewAcceptance,
  sanitizeReviewObjective,
  taskKindOf,
  validateCreateTask,
} from './quality-gates.ts'
export type { ContractAmendmentInput } from './quality-gates.ts'

/** Mailbox key of the captain. */
export const CAPTAIN_KEY = 'captain'
/** A crashed live-delivery attempt becomes retryable after this interval. */
const MAILBOX_DELIVERY_LEASE_MS = 60_000
/** Durable deny-list for AgentTeams members that must never be resumed. */
const RETIRED_MEMBERS_FILE = 'retired-members.json'

/** In-process per-team mutation queues (promise chains). */
const locks = new Map<string, Promise<unknown>>()

/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export async function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  locks.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    // Drop this key's queue entry once we are still its tail, so settled
    // teams do not leave one resolved promise chained forever (the same
    // cleanup discipline as the scheduler's serializeMember). A successor
    // that already appended itself owns the map slot; keep its entry.
    if (locks.get(key) === tail) locks.delete(key)
  }
}

/**
 * Keys with an in-process lock queue (held or waiting), snapshot for
 * diagnostics and leak checks. The queue promises themselves stay private.
 */
export function teamLockQueueKeys(): readonly string[] {
  return [...locks.keys()]
}

/** Longest key emitted before truncating and appending a digest. */
const MAX_KEY_LENGTH = 48

/** Short stable digest, used to keep otherwise-colliding keys distinct. */
function keyDigest(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 8)
}

/**
 * Fold a free-form name into a safe path/key segment.
 *
 * Unicode letters and digits survive, so CJK/Cyrillic/Greek names stay
 * distinct and readable; everything else — spaces, punctuation, path
 * separators, control characters — folds to `-`. An ASCII-only whitelist
 * mapped *every* non-Latin name onto one shared fallback, which silently
 * merged their mailboxes and rejected the second such member as a duplicate.
 *
 * A name with no letters or digits at all (pure emoji or punctuation) cannot
 * yield a readable key, so it gets a digest rather than a shared constant.
 * Over-long names are truncated with a digest appended, so names sharing a
 * long prefix stay distinct and the result stays within filesystem limits
 * (CJK costs 3 bytes per character in UTF-8).
 *
 * @param name - any user-supplied name.
 * @returns a non-empty key safe as a single path segment.
 */
export function sanitizeKey(name: string): string {
  const cleaned = name.normalize('NFC').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned === '') return `k-${keyDigest(name)}`
  const points = [...cleaned]
  if (points.length > MAX_KEY_LENGTH) {
    return `${points.slice(0, MAX_KEY_LENGTH).join('')}-${keyDigest(name)}`
  }
  return cleaned
}

/**
 * ── ★★ 依赖是否满足：判「终态」，不是判「completed」──────────────────────────────
 *
 * MEASURED（2026-10-07，本机复现）：这一行此前是
 *
 *     return dependencies.filter((id) => byId.get(id)?.status !== 'completed')
 *
 * 它把「还没做完」与「做完了、结果是坏的」读成同一件事。而 failed / cancelled
 * **也是终态**（`TASK_TRANSITIONS` 里两者都没有出边）⇒ 一条 failed 的上游会把
 * 整条下游【永久】锁死：
 *
 *     t18 ← t17(failed)   ⇒ t18 永远不 ready，永远不会被派发
 *     t21 ← t20(failed)   ⇒ 同上
 *
 * 而本轮的 t17 / t20 恰恰是**如实报告**：t17 的交付物已经并入、t20 的普查
 * 正是它该红的那一份。机制把「诚实地说这份工作有问题」判成了「这份工作不存在」，
 * 于是【如实报告会受到惩罚】—— 那会把成员推向"为了让下游能开工而谎报 completed"，
 * 而那条路正是整个判据层存在的理由（不采信自述）。
 *
 * ── ★ 「终态即满足」不是放宽，是换一个更准的问题 ────────────────────────────────
 *
 *     「上游做完了吗」        —— 旧口径读不出来（failed 与 pending 同形）
 *     「上游还欠不欠工作」    —— 新口径：终态 = 不再欠工作 = 依赖这件事已经了结
 *
 * 依赖要的是**因果上的了结**，不是**结果上的赞许**。上游失败了，下游要做的
 * 不是"等一个永远不会到来的 completed"，而是"带着这个事实往下走"。
 *
 * ── ★★ 但"能开工"不等于"下游不知道发生了什么" ──────────────────────────────────
 *
 * 全都放行会带来一个新风险：**下游看不见上游是哪种终态**。用户裁定的是乙：
 * 不替下游做决定，而是把状态交出去 —— 也就是**在这里只回答"欠不欠工作"**，
 * 把"上游最后落在哪"交给 {@link dependencyOutcomes}（同一个文件、同一条口径）。
 *
 * ★ 两条出口必须分开读，不许合成一个布尔：合成之后"上游全做完了"与
 * "上游全失败了但都了结了"在调用方眼里同形，而它们的补救动作完全不同
 * （继续往下 vs 先看那份失败报告）。
 *
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that are still unsatisfied, empty when claimable.
 */
export function unsatisfiedDependencies(tasks: TeamTask[], dependencies: string[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return dependencies.filter((id) => {
    const dependency = byId.get(id)
    /**
     * ★ 未知依赖 id ⇒ 仍然阻塞。它**不是**终态 —— 它压根不存在。
     *   把它放行会让一个拼错的依赖 id 静默地不再保护任何东西
     *   （旧口径也是这个方向，这里刻意保持）。
     */
    if (dependency === undefined) return true
    return !TERMINAL_TASK_STATUSES.includes(dependency.status)
  })
}

/**
 * ── ★★ 一个依赖【最后落在哪】—— 把上游的终态原样交给下游 ─────────────────────────
 *
 * 用户裁定的口径（乙）：**全都终态即满足，但下游能读到上游是哪种终态。**
 * 判据层不替下游决定"这份失败要不要紧"，它只负责**不把那个事实藏起来**。
 *
 * ── 为什么失败要细分（用户裁定）────────────────────────────────────────────────
 *
 * 一个裸 `failed` 把三件不同的事压成一件，而它们的补救动作完全不同：
 *
 *     failed_delivery —— 交付物【真的有问题】（判据抓到了伪造 / 测试没红 / 工作没到）
 *     failed_context  —— 环境或口径使它无法以 completed 收口（缺依赖、非 git、
 *                        契约本身自相矛盾）—— ★ 交付物不一定有问题
 *     inconclusive    —— 任务的性质就是"找问题"，而它【找到了】
 *                        （一次普查报出缺陷、一次审查给出 needs_revision）
 *                        —— ★ 这正是 "failed" 这个词最不该覆盖的那一类
 *
 * ★ 本轮的 t17 / t20 都落第三类：它们的"失败"就是它们的交付。
 *   不细分，下游（和读日志的人）只能看到一个 failed，于是【如实报告】
 *   与【真的做砸了】永远同形 —— 而那是本队记账最久的那个形态。
 *
 * ── 分类器刻意是「纯函数 + 只读已有的字段」────────────────────────────────────
 *
 * 它不改变任何任务的 status、不写任何东西、不认识工具层。它只是把一条已经
 * 发生的终态**读成一个可比较的值**，好让下游与报告都能问"这是哪一种"。
 * ★ 缺席（老记录、工作区里的历史任务）落 `failed_context` 而不是编一个
 *   `failed_delivery`：**读不到的成因不许推断成"交付物坏了"** ——
 *   那个方向会给一个没人检查过的任务扣上最重的帽子。
 */

/** 一条依赖最后落在哪。★ 三态 + 两种汇总，不是两个布尔。 */
export type DependencyOutcome =
  | 'completed'
  | 'failed_delivery'
  | 'failed_context'
  | 'inconclusive'
  | 'cancelled'

/**
 * 一次 failed 的细分。★ 取值与 `output` / `verdict` 上的既有事实**一一对应**，
 * 不引入新的写入口（本轮不改 `src/tools.ts`）。
 */
export const FAILURE_KINDS = ['failed_delivery', 'failed_context', 'inconclusive'] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

/**
 * 把一条终态任务读成 {@link DependencyOutcome}。
 *
 * ★ 它只读**已经写在任务上**的事实（`status` / `verdict` / `acceptanceResults` /
 *   `commandsRun`），不读时钟、不读盘、不调用任何判据 —— 所以它可以在任何
 *   消费者（调度器、报告、下游提示）里被同一个引用调用，而不会有两份真相。
 *
 * @param task - the dependency task. `undefined` ⇒ 未知 id，如实报 `'failed_context'`
 *   （"这条依赖我读不到"不是"它做完了"）。
 */
export function dependencyOutcomeOf(task: TeamTask | undefined): DependencyOutcome {
  if (task === undefined) return 'failed_context'
  if (task.status === 'completed') return 'completed'
  if (task.status === 'cancelled') return 'cancelled'
  if (task.status !== 'failed') {
    /**
     * ★ 非终态走到这里 = 调用方问早了。**不编一个终态**：如实按"还没法收口"
     *   报 `failed_context`，而这个值在调用方那侧的正确用法是"它还不满足"。
     *   把 pending/claimed/in_progress 读成任何一种"做完了"都是本队记账的
     *   「把没测到并进通过」。
     */
    return 'failed_context'
  }
  return failureKindOf(task)
}

/**
 * 细分一次 `failed`。**顺序即优先级**（下面三条各自排除前面那些）。
 *
 * ★ 判据的顺序是从"最确定"到"最保守"：
 *
 *   ① `inconclusive` —— 有 `verdict` 的失败，是 review/requirements 类的**结论型**任务，
 *      它的失败**就是**它查出了问题（`needs_revision` / `reject`）。这一类任务的性质
 *      是"找问题"，找到即交付 ⇒ 这不是"做砸了"。
 *   ② `failed_delivery` —— 有**实测证据**说交付物本身是坏的：验收项里有 failed，
 *      或 verify 命令里有非 0 退出。这是可指名的、可复核的"东西不对"。
 *   ③ `failed_context` —— 上面两条都不成立：没有结论、没有一条实测说交付物坏了。
 *      ⇒ 最保守的读法，也是**缺省**（见下面那段实测记录）。
 *
 * ★★ 为什么 `failed_context` 是缺省而不是 `failed_delivery`（这条是刻意的）：
 *   「没有证据说它坏了」与「有证据说它好了」是两件事。缺省成 failed_delivery
 *   会让每一个**没人检查过**的失败都被扣上"交付物有问题"，而下游据此可能
 *   直接放弃 —— 那是把"没测到"并进"测出来是坏的"，与并进"通过"同源。
 */
export function failureKindOf(task: TeamTask): FailureKind {
  const verdict = task.verdict
  if (verdict === 'needs_revision' || verdict === 'reject') return 'inconclusive'
  if (verdict === 'pass') return 'failed_delivery'
  const acceptanceFailed = (task.acceptanceResults ?? [])
    .some((result) => result?.status === 'failed')
  const commandFailed = (task.commandsRun ?? [])
    .some((command) => typeof command?.exitCode === 'number' && command.exitCode !== 0)
  if (acceptanceFailed || commandFailed) return 'failed_delivery'
  return 'failed_context'
}

/**
 * ── ★★ 依赖的全貌：每一条依赖的 id + 终态 + 是否已经了结 ─────────────────────────
 *
 * 这是 {@link unsatisfiedDependencies} 的**信息面**版本，两个问题一起回答：
 *
 *     「下游能不能开工」        —— `satisfied`
 *     「上游最后落在哪」        —— `outcome`
 *
 * ★ 它**不**取代 `unsatisfiedDependencies`，两者必须都能被读到：
 *   前者是闸门（调度器用它决定派不派），后者是证据（下游与报告用它决定
 *   "带着什么往下走"）。合成一个"能开工 + 一个布尔"会让第二件事消失。
 *
 * ★ 顺序与 `dependencies` 一致（不是重排、不是去重）：调用方交进来的顺序
 *   就是它读得出的顺序，一个"顺手按 id 排序"的实现会让两份读数对不上。
 */
export interface DependencyStatus {
  /** 依赖的任务 id，原样交回。 */
  id: string
  /** 这条依赖最后落在哪。★ 未知 id / 非终态都落 `failed_context`（见上）。 */
  outcome: DependencyOutcome
  /** ★ 这条依赖**已经了结**吗 —— 与 `unsatisfiedDependencies` 判的是同一个问题。 */
  satisfied: boolean
  /** 任务在盘上的状态；未知 id 缺席（不是编一个 `pending`）。 */
  status?: TaskStatus
}

/**
 * 把一组依赖读成 {@link DependencyStatus} 的清单。
 *
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 */
export function dependencyStatuses(tasks: readonly TeamTask[], dependencies: readonly string[]): DependencyStatus[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return dependencies.map((id) => {
    const task = byId.get(id)
    return {
      id,
      outcome: dependencyOutcomeOf(task),
      satisfied: task !== undefined && TERMINAL_TASK_STATUSES.includes(task.status),
      ...task === undefined ? {} : { status: task.status },
    }
  })
}

/**
 * 下游一句话能读到的"上游怎么了"。
 *
 * ★ 只在**有值得说的事**时产出内容：全 completed 时返回空串。
 *   一个把"上游全都好好地做完了"也渲染成一行的实现，会让真正需要看的那一行
 *   （上游失败了、而它是哪一种）淹没在每次派发都出现的噪音里 ——
 *   而噪音会教人忽略告警（requires.ts 那一条的同源）。
 *
 * ★ 它**不**决定下游该怎么做（不写"请先修复"、"请不要继续"）。用户裁定的口径是
 *   "把状态交出去"：这句话是**读数**，不是指示。加一句祈使句就等于替下游做了决定，
 *   而下游知道的东西比这里多（它知道自己的 objective）。
 */
export function describeDependencyOutcomes(statuses: readonly DependencyStatus[]): string {
  const noteworthy = statuses.filter((entry) => entry.outcome !== 'completed')
  if (noteworthy.length === 0) return ''
  const lines = noteworthy.map((entry) => {
    const where = entry.status === undefined ? 'no such task' : entry.status
    return `- ${entry.id} (${where}): ${entry.outcome}`
  })
  return [
    'Dependency outcomes (terminal = satisfied, so work may proceed; read before you start):',
    ...lines,
  ].join('\n')
}

/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current: TaskStatus, next: TaskStatus): string | undefined {
  if (current === next) return undefined
  if (!TASK_TRANSITIONS[current].includes(next)) {
    return `task status cannot move from "${current}" to "${next}"`
  }
  return undefined
}

/** Execution results belong to one attempt; a retry must produce its own evidence. */
function clearAttemptResult(task: TeamTask): void {
  task.output = undefined
  task.verdict = undefined
  task.findings = undefined
  task.changedPaths = undefined
  task.acceptanceResults = undefined
  task.commandsRun = undefined
}

/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task: TeamTask, assignee: string): string {
  const attemptId = randomUUID()
  task.status = 'claimed'
  task.assignee = assignee
  task.attemptId = attemptId
  task.handoffId = undefined
  task.reassigning = false
  clearAttemptResult(task)
  task.updatedAt = Date.now()
  return attemptId
}

/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task: TeamTask, assignee: string): string {
  task.attempt = (task.attempt ?? 0) + 1
  return activateTaskAttempt(task, assignee)
}

/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
/** Cancel one unfinished task without returning it to the ready pool. */
export function cancelUnfinishedTask(task: TeamTask, output?: string): void {
  if (TERMINAL_TASK_STATUSES.includes(task.status)) return
  task.status = 'cancelled'
  task.attemptId = undefined
  task.handoffId = undefined
  task.reassigning = false
  if (output !== undefined) task.output = output
  task.updatedAt = Date.now()
}

export function invalidateTaskAttempt(
  task: TeamTask,
  nextAssignee?: string,
  reassigning = false,
): void {
  task.attemptId = undefined
  task.handoffId = randomUUID()
  task.status = 'pending'
  task.assignee = nextAssignee
  task.reassigning = reassigning
  clearAttemptResult(task)
  task.updatedAt = Date.now()
}

/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
export async function createTeamDir(stateRoot: string, state: TeamState): Promise<void> {
  const dir = join(stateRoot, state.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await atomicWriteText(join(dir, 'team.json'), JSON.stringify(state, null, 2))
}

/**
 * Read one team record; `undefined` when absent.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export async function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  try {
    const raw = await readFile(join(stateRoot, teamId, 'team.json'), 'utf8')
    const value: unknown = JSON.parse(stripLeadingBom(raw))
    const team = coerceTeamState(value, teamId)
    if (team === undefined) {
      throw new Error(`invalid AgentTeams state in team "${teamId}"`)
    }
    return team
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export function readTeamSync(stateRoot: string, teamId: string): TeamState | undefined {
  try {
    const raw = readFileSync(join(stateRoot, teamId, 'team.json'), 'utf8')
    const value: unknown = JSON.parse(stripLeadingBom(raw))
    const team = coerceTeamState(value, teamId)
    if (team === undefined) {
      throw new Error(`invalid AgentTeams state in team "${teamId}"`)
    }
    return team
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
export async function writeTeam(stateRoot: string, state: TeamState): Promise<void> {
  await atomicWriteText(join(stateRoot, state.id, 'team.json'), JSON.stringify(state, null, 2))
}

/** Read the durable set of member session ids retired by remove/delete. */
function parseRetiredMemberIds(raw: string): Set<string> {
  const parsed: unknown = JSON.parse(stripLeadingBom(raw))
  if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string' || value === '')) {
    throw new Error('invalid AgentTeams retired member index')
  }
  return new Set(parsed)
}

/** Synchronous role hydration before the host's first prompt assembly. */
export function readRetiredMemberIdsSync(stateRoot: string): Set<string> {
  try { return parseRetiredMemberIds(readFileSync(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

export async function readRetiredMemberIds(stateRoot: string): Promise<Set<string>> {
  try {
    return parseRetiredMemberIds(await readFile(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8'))
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set()
    }
    throw error
  }
}

/** Atomically add session ids to the durable retired-member deny-list. */
export async function recordRetiredMemberIds(stateRoot: string, memberIds: readonly string[]): Promise<void> {
  const additions = memberIds.filter(id => id !== '')
  if (additions.length === 0) return
  await withTeamLock(`retired-members:${stateRoot}`, async () => {
    const retired = await readRetiredMemberIds(stateRoot)
    for (const id of additions) retired.add(id)
    await mkdir(stateRoot, { recursive: true })
    await atomicWriteText(
      join(stateRoot, RETIRED_MEMBERS_FILE),
      `${JSON.stringify([...retired].sort(), null, 2)}\n`,
    )
  })
}

/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @returns the team record, or undefined when the captain leads no team.
 */
export async function findTeamByCaptain(
  stateRoot: string,
  captainSessionId: string,
): Promise<TeamState | undefined> {
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const team = await readTeam(stateRoot, entry.name)
    if (team?.captainSessionId === captainSessionId) {
      if (found !== undefined && found.id !== team.id) {
        throw new Error(`captain session leads multiple active teams ("${found.id}", "${team.id}"); archive one before continuing`)
      }
      found = team
    }
  }
  return found
}

/**
 * Find the team in which one session is an active participant.
 * Captains match `captainSessionId`; members match their durable child session
 * id. Removed members no longer have access to team-scoped tools.
 * @param stateRoot - resolved absolute state root directory.
 * @param agentSessionId - calling captain/member session id.
 * @returns the team record, or undefined when the caller belongs to no team.
 */
export async function findTeamByParticipant(
  stateRoot: string,
  agentSessionId: string,
): Promise<TeamState | undefined> {
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const team = await readTeam(stateRoot, entry.name)
    const participates = team?.captainSessionId === agentSessionId
      || team?.members.some((member) => member.id === agentSessionId && member.status !== 'removed') === true
    if (participates && team !== undefined) {
      if (found !== undefined && found.id !== team.id) {
        throw new Error(`agent session belongs to multiple active teams ("${found.id}", "${team.id}"); the target team is ambiguous`)
      }
      found = team
    }
  }
  return found
}

/** Build a fresh message record. */
export function createMessage(from: string, to: string, content: string): TeamMessage {
  return { id: randomUUID(), from, to, content, ts: Date.now() }
}

/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export async function appendMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  message: TeamMessage,
): Promise<void> {
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  await mkdir(join(stateRoot, teamId, 'inbox'), { recursive: true })
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }
  const separator = existing !== '' && !existing.endsWith('\n') ? '\n' : ''
  await atomicWriteText(file, `${existing}${separator}${JSON.stringify(message)}\n`)
}

/**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export async function readMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  onMalformedLine?: (lineNumber: number, error: unknown) => void,
): Promise<TeamMessage[]> {
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  try {
    const raw = await readFile(file, 'utf8')
    const messages: TeamMessage[] = []
    for (const [index, rawLine] of raw.split('\n').entries()) {
      const line = stripLeadingBom(rawLine)
      if (line.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        onMalformedLine?.(index + 1, new Error('invalid JSON'))
        continue
      }
      if (!isTeamMessage(value)) {
        onMalformedLine?.(index + 1, new Error('invalid message shape'))
        continue
      }
      messages.push(value)
    }
    return messages
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/** Read only messages that have not been acknowledged by their recipient. */
export async function readUnreadMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  onMalformedLine?: (lineNumber: number, error: unknown) => void,
): Promise<TeamMessage[]> {
  return (await readMailbox(stateRoot, teamId, agentKey, onMalformedLine))
    .filter(message => message.readAt === undefined && message.discardedAt === undefined)
}

/** Pending delivery is distinct from delivered-but-not-yet-read input. */
export async function readPendingMailbox(stateRoot: string, teamId: string, agentKey: string): Promise<TeamMessage[]> {
  const now = Date.now()
  return (await readUnreadMailbox(stateRoot, teamId, agentKey))
    .filter(message => message.deliveredAt === undefined
      && (message.deliveryClaimedAt === undefined
        || now - message.deliveryClaimedAt >= MAILBOX_DELIVERY_LEASE_MS))
}

async function mutateMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
  mutate: (message: TeamMessage) => TeamMessage,
): Promise<void> {
  if (messageIds.length === 0) return
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const selected = new Set(messageIds)
  const lines = raw.split('\n').map((rawLine) => {
    const line = stripLeadingBom(rawLine)
    if (line.trim() === '') return rawLine
    try {
      const value: unknown = JSON.parse(line)
      if (!isTeamMessage(value) || !selected.has(value.id)) return rawLine
      return JSON.stringify(mutate(value))
    } catch {
      return rawLine
    }
  })
  await atomicWriteText(file, lines.join('\n'))
}

/** Lease selected fallback messages to one delivery path. */
export async function claimMailboxDelivery(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, message => ({
    ...message,
    deliveryClaimedAt: now,
  }))
}

/** Release a failed delivery lease so the scheduler can retry it later. */
export async function releaseMailboxDelivery(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
    const { deliveryClaimedAt: _claimed, ...released } = message
    return released
  })
}

/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export async function acknowledgeMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
    const { deliveryClaimedAt: _claimed, ...rest } = message
    return {
      ...rest,
      deliveredAt: message.deliveredAt ?? now,
      readAt: message.readAt ?? now,
    }
  })
}

/** Acceptance by Harness is not evidence that a model step consumed input. */
export async function markMailboxDelivered(stateRoot: string, teamId: string, agentKey: string, ids: readonly string[]): Promise<void> {
  await mutateMailbox(stateRoot, teamId, agentKey, ids, (message) => {
    const { deliveryClaimedAt: _claimed, ...rest } = message
    return { ...rest, deliveredAt: message.deliveredAt ?? Date.now() }
  })
}

export async function discardMailboxMessages(stateRoot: string, teamId: string, agentKey: string, ids: readonly string[]): Promise<void> {
  await mutateMailbox(stateRoot, teamId, agentKey, ids, message => ({ ...message, discardedAt: message.discardedAt ?? Date.now() }))
}

/** Remove the optional UTF-8 BOM some editors prepend to JSON text. */
function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

/** Rename attempts before falling back to a direct overwrite. */
const ATOMIC_RENAME_RETRIES = 3
/** Pause between rename attempts, giving a briefly-locking owner time to finish. */
const ATOMIC_RENAME_RETRY_DELAY_MS = 50
/**
 * Rename error codes worth retrying before the direct-write fallback. On
 * Windows, replacing an existing file whose target is momentarily held open
 * without FILE_SHARE_DELETE surfaces as EPERM (or EACCES/EBUSY variants);
 * EEXIST/ENOTEMPTY cover other "target busy" edge shapes.
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY'])

function isRetryableRenameError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && RETRYABLE_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Filesystem primitives used by {@link replaceFileAtomicOrDirect}; injectable for tests. */
export interface AtomicReplacePrimitives {
  rename: (from: string, to: string) => Promise<void>
  writeFile: (file: string, content: string) => Promise<void>
  remove: (file: string) => Promise<void>
}

/** Tuning knobs for {@link replaceFileAtomicOrDirect} (defaults match production). */
export interface AtomicReplaceOptions {
  /** Rename attempts before the direct-write fallback (default 3). */
  retries?: number
  /** Delay between rename attempts in ms (default 50). */
  retryDelayMs?: number
}

/**
 * Replace `file` with `content`, preferring an atomic same-directory rename of
 * an already-written temp file.
 *
 * On Windows, `rename(tmp, file)` over an existing target throws EPERM while
 * any other process keeps the target open without FILE_SHARE_DELETE (editors,
 * indexers, antivirus scans, preview panes). By that point the payload has
 * already been fully written to the temp file, so a direct overwrite of the
 * target is a content-equivalent degraded path: retry the rename a few times
 * (transient locks clear quickly), then write the target in place. Every path
 * removes the temp file; when both the atomic rename and the direct write
 * fail, the combined error surfaces as an {@link AggregateError}.
 *
 * @returns nothing once the file has been replaced by one of the two paths.
 */
export async function replaceFileAtomicOrDirect(
  temporary: string,
  file: string,
  content: string,
  primitives: AtomicReplacePrimitives,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  const retries = options.retries ?? ATOMIC_RENAME_RETRIES
  const retryDelayMs = options.retryDelayMs ?? ATOMIC_RENAME_RETRY_DELAY_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      await primitives.rename(temporary, file)
      return
    } catch (error: unknown) {
      if (isRetryableRenameError(error) && attempt < retries) {
        await sleep(retryDelayMs)
        continue
      }
      let fallbackError: unknown
      try {
        await primitives.writeFile(file, content)
      } catch (writeError: unknown) {
        fallbackError = writeError
      }
      await primitives.remove(temporary).catch(() => undefined)
      if (fallbackError !== undefined) {
        throw new AggregateError(
          [error, fallbackError],
          `failed to replace "${file}" atomically (${String(error)}) or by direct write (${String(fallbackError)})`,
        )
      }
      return
    }
  }
}

/**
 * Atomically replace one UTF-8 state file from a same-directory temp file,
 * degrading to a direct overwrite when the atomic rename cannot proceed
 * (see {@link replaceFileAtomicOrDirect} for the Windows EPERM rationale).
 */
async function atomicWriteText(file: string, content: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  await replaceFileAtomicOrDirect(temporary, file, content, {
    rename: (from, to) => rename(from, to),
    writeFile: (target, payload) => writeFile(target, payload, 'utf8'),
    remove: (path) => rm(path, { force: true }),
  })
}

/** Whether a parsed JSON value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is an optional string. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

/** Whether a value is a finite timestamp/counter number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate one member record at the durable JSON boundary. */
function isTeamMember(value: unknown): value is TeamMember {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['role'])
    && (value['stopping'] === undefined || typeof value['stopping'] === 'boolean')
    && isOptionalString(value['provider'])
    && isOptionalString(value['model'])
    && isOptionalString(value['reasoningEffort'])
    && isOptionalString(value['activeProvider'])
    && isOptionalString(value['activeModel'])
    && isOptionalString(value['spawnError'])
    && (value['executionPrompt'] === undefined || typeof value['executionPrompt'] === 'string')
    && (value['fallback'] === undefined || (isRecord(value['fallback']) && typeof value['fallback']['provider'] === 'string' && typeof value['fallback']['model'] === 'string'))
    && (value['fallbackActive'] === undefined || typeof value['fallbackActive'] === 'boolean')
    && isFiniteNumber(value['joinedAt'])
    && (value['status'] === 'idle' || value['status'] === 'working' || value['status'] === 'removed')
}

/** Validate one task record at the durable JSON boundary. */
function isTeamProfileSnapshot(value: unknown): value is TeamProfileSnapshot {
  return isRecord(value)
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['description'])
    && isOptionalString(value['protocol'])
    && (value['executionPrompt'] === undefined || typeof value['executionPrompt'] === 'string')
    && (value['fallback'] === undefined || (isRecord(value['fallback']) && typeof value['fallback']['provider'] === 'string' && typeof value['fallback']['model'] === 'string'))
    && (value['taskPlanning'] === undefined || value['taskPlanning'] === 'captain' || value['taskPlanning'] === 'seed')
    && (value['reviewPolicy'] === undefined || isReviewPolicy(value['reviewPolicy']))
}

function coerceProfileSnapshot(value: unknown): TeamProfileSnapshot | undefined {
  if (typeof value === 'string') {
    const name = value.trim()
    return name === '' ? undefined : { name }
  }
  if (!isRecord(value)) return undefined
  if (!isTeamProfileSnapshot(value)) return undefined
  return {
    name: value.name.trim(),
    ...value.description === undefined ? {} : { description: value.description },
    ...value.protocol === undefined ? {} : { protocol: value.protocol },
    ...value.taskPlanning === undefined ? {} : { taskPlanning: value.taskPlanning },
  }
}

function coerceTeamState(value: unknown, expectedId: string): TeamState | undefined {
  if (!isRecord(value)) return undefined
  if (value['profile'] !== undefined && !isTeamProfileSnapshot(value['profile']) && typeof value['profile'] !== 'string') {
    const next = { ...value }
    delete next['profile']
    value = next
  } else if (typeof value['profile'] === 'string') {
    const upgraded = coerceProfileSnapshot(value['profile'])
    value = upgraded === undefined
      ? (() => {
        const next = { ...value as Record<string, unknown> }
        delete next['profile']
        return next
      })()
      : { ...value, profile: upgraded }
  }
  if (!isRecord(value) || !Array.isArray(value['tasks'])) {
    return isTeamState(value, expectedId) ? value : undefined
  }
  const tasks = (value['tasks'] as unknown[]).map((task) => {
    if (!isRecord(task)) return task
    // Tolerate legacy dirty records instead of bricking the whole team on
    // reload: blank optional fields written by older builds (or by models that
    // materialize optionals as "") are normalized to omitted, matching the
    // profileSeedId handling below and the tool-input normalization.
    const cleaned = normalizeBlankOptionalTaskFields(task)
    if (cleaned['profileSeedId'] !== undefined && (typeof cleaned['profileSeedId'] !== 'string' || cleaned['profileSeedId'].trim() === '')) {
      const next = { ...cleaned }
      delete next['profileSeedId']
      return next
    }
    return cleaned
  })
  const coerced = { ...value, tasks }
  return isTeamState(coerced, expectedId) ? coerced : undefined
}

export function isTeamTask(value: unknown): value is TeamTask {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && isOptionalString(value['profileSeedId'])
    && (value['profileSeedId'] === undefined || value['profileSeedId'].trim() !== '')
    && typeof value['subject'] === 'string'
    && isOptionalString(value['description'])
    && (value['status'] === 'pending'
      || value['status'] === 'claimed'
      || value['status'] === 'in_progress'
      || value['status'] === 'completed'
      || value['status'] === 'failed'
      || value['status'] === 'cancelled')
    && isOptionalString(value['assignee'])
    && Array.isArray(value['dependencies'])
    && value['dependencies'].every((dependency) => typeof dependency === 'string')
    && isOptionalString(value['output'])
    && (value['attempt'] === undefined
      || (Number.isSafeInteger(value['attempt']) && (value['attempt'] as number) >= 0))
    && isOptionalString(value['attemptId'])
    && isOptionalString(value['handoffId'])
    && isOptionalString(value['handoffFromMemberId'])
    && (value['reassigning'] === undefined || typeof value['reassigning'] === 'boolean')
    && isFiniteNumber(value['createdAt'])
    && isFiniteNumber(value['updatedAt'])
    && hasValidQualityTaskFields(value)
}

/** Validate the full team record before it can participate in authorization. */
function isTeamState(value: unknown, expectedId: string): value is TeamState {
  if (!isRecord(value)) return false
  const validShape = value['id'] === expectedId
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['description'])
    && (value['profile'] === undefined || isTeamProfileSnapshot(value['profile']))
    && typeof value['captainSessionId'] === 'string'
    && value['captainSessionId'] !== ''
    && isFiniteNumber(value['createdAt'])
    && Array.isArray(value['members'])
    && value['members'].every(isTeamMember)
    && Array.isArray(value['tasks'])
    && value['tasks'].every(isTeamTask)
    && Number.isSafeInteger(value['taskSeq'])
    && (value['taskSeq'] as number) >= 0
    && (value['phase'] === undefined || value['phase'] === 'staged' || value['phase'] === 'running')
    && (value['planReviewState'] === undefined
      || value['planReviewState'] === 'awaiting_review'
      || value['planReviewState'] === 'awaiting_feedback')
    && (value['approvedAt'] === undefined || isFiniteNumber(value['approvedAt']))
    && (value['halted'] === undefined || typeof value['halted'] === 'boolean')
    && (value['haltedAt'] === undefined || isFiniteNumber(value['haltedAt']))
    && (value['reviewPolicy'] === undefined || isReviewPolicy(value['reviewPolicy']))
    && (value['escalated'] === undefined || typeof value['escalated'] === 'boolean')
  if (!validShape) return false

  const members = value['members'] as TeamMember[]
  const tasks = value['tasks'] as TeamTask[]
  const memberIds = new Set<string>()
  const memberKeys = new Set<string>()
  for (const member of members) {
    const key = sanitizeKey(member.name)
    if (key === CAPTAIN_KEY || memberKeys.has(key)) return false
    if (member.id !== '') {
      if (memberIds.has(member.id)) return false
      memberIds.add(member.id)
    }
    memberKeys.add(key)
  }
  const taskIds = new Set<string>()
  for (const task of tasks) {
    if (task.id === '' || taskIds.has(task.id)) return false
    taskIds.add(task.id)
  }
  return true
}

/** Validate a mailbox record so later rendering cannot crash on `{}`/`null`. */
function isTeamMessage(value: unknown): value is TeamMessage {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['from'] === 'string'
    && typeof value['to'] === 'string'
    && typeof value['content'] === 'string'
    && isFiniteNumber(value['ts'])
    && (value['deliveryClaimedAt'] === undefined || isFiniteNumber(value['deliveryClaimedAt']))
    && (value['deliveredAt'] === undefined || isFiniteNumber(value['deliveredAt']))
    && (value['readAt'] === undefined || isFiniteNumber(value['readAt']))
    && (value['discardedAt'] === undefined || isFiniteNumber(value['discardedAt']))
    && (value['taskId'] === undefined || typeof value['taskId'] === 'string')
    && (value['attemptId'] === undefined || typeof value['attemptId'] === 'string')
    && (value['sourceTaskId'] === undefined || typeof value['sourceTaskId'] === 'string')
    && (value['sourceAttemptId'] === undefined || typeof value['sourceAttemptId'] === 'string')
    && (value['sourceTaskStatus'] === undefined || ['pending', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled'].includes(value['sourceTaskStatus'] as string))
}

/**
 * Remove a team's whole directory (members should be interrupted first).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function removeTeamDir(stateRoot: string, teamId: string): Promise<void> {
  await rm(join(stateRoot, teamId), { recursive: true, force: true })
}

/**
 * `rename` with the same transient retry policy as the state-file atomic
 * write, for paths (like archiving a whole team directory) where there is no
 * content-equivalent direct-write degradation on Windows. A short-lived
 * delete-sharing lock on any file below the renamed path is retried a few
 * times before the error propagates.
 * @param from - source path.
 * @param to - destination path.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error: unknown) {
      if (isRetryableRenameError(error) && attempt < ATOMIC_RENAME_RETRIES) {
        await sleep(ATOMIC_RENAME_RETRY_DELAY_MS)
        continue
      }
      throw error
    }
  }
}

/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/<teamId>/` so later sessions can review how tasks were
 * planned and rebuild dependency relationships. The archive directory has no
 * team.json of its own, so the live activity scan skips it naturally.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function archiveTeamDir(stateRoot: string, teamId: string): Promise<void> {
  const archiveRoot = join(stateRoot, 'archive')
  await mkdir(archiveRoot, { recursive: true })
  const source = join(stateRoot, teamId)
  const target = join(archiveRoot, teamId)
  const previous = join(archiveRoot, `.${teamId}.previous-${randomUUID()}`)
  let displaced = false
  try {
    // The same Windows EPERM-on-rename applies at the directory boundary: a
    // delete-sharing violation on any file below `target` blocks the move, so
    // retry the transient-lock case before giving up.
    await renameWithRetry(target, previous)
    displaced = true
  } catch (error: unknown) {
    // Only ENOENT means there was nothing to displace; any other failure
    // (including a persistent EPERM lock) surfaces to the caller.
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }

  try {
    await renameWithRetry(source, target)
  } catch (error: unknown) {
    if (displaced) {
      try {
        await renameWithRetry(previous, target)
      } catch (restoreError: unknown) {
        throw new AggregateError(
          [error, restoreError],
          `failed to archive team "${teamId}" and restore its previous archive`,
        )
      }
    }
    throw error
  }

  // The new generation is authoritative. A failed cleanup only leaves a
  // hidden recovery directory, which archive discovery deliberately ignores.
  if (displaced) await rm(previous, { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Read one archived team (already moved under `archive/`), or undefined when
 * it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function readArchivedTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  return readTeam(join(stateRoot, 'archive'), teamId)
}

/**
 * List every archived team id under the state root.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export async function listArchivedTeamIds(stateRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(stateRoot, 'archive'), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// ── activity snapshot (server-side, like the Claude Code desktop watcher) ──

/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `failed`/`cancelled` when terminal without success, `blocked`
 * while any dependency is unfinished, else `open`.
 */
export function taskVisualState(
  status: string,
  dependencies: readonly string[],
  tasks: readonly TeamTask[],
): VisualTaskState {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'in_progress') return 'running'
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const openDependency = dependencies.some((dependencyId) => {
    const dependency = byId.get(dependencyId)
    return dependency !== undefined && dependency.status !== 'completed'
  })
  return openDependency ? 'blocked' : 'open'
}

/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export function taskDepthsById(tasks: readonly TeamTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    const task = byId.get(taskId)
    if (task === undefined) return 0
    visiting.add(taskId)
    const dependencies = task.dependencies
      .filter((dependencyId) => byId.has(dependencyId))
      .sort()
    const depth = dependencies.length === 0
      ? 0
      : 1 + Math.max(...dependencies.map(depthOf))
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return depths
}
