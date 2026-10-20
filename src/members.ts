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

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
// Declaration merge only: makes ctx.subagents visible.
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { guardSubagentCreation, guardSubagentDelivery, installContinuableMemberSetup, memberToolFilter, queueMemberPrompt, restrictableToolNames, startMember, startMemberWithLenientFilter, steerMemberPrompt, sessionOwnEvents, splitZstdFrames, usesManagedActivations, type MemberStartSpec, type MemberToolFilter } from './harness-compat.ts'
import { markMailboxDelivered, appendMailbox, CAPTAIN_KEY, createMessage, readRetiredMemberIds, readTeamSync, readTeam, releaseMailboxDelivery, withTeamLock, writeTeam } from './state.ts'
import { mailboxPrompt } from './mailbox.ts'
import { appendTeamEvent, captainSessionOf, liveAgentOf } from './events.ts'
import { reloadJustBefore, type HmrReloadEntry } from './hmr-trace.ts'
import { TERMINAL_TASK_STATUSES, type TeamMember, type TeamState, type TeamTask } from './types.ts'
/**
 * ── ★★★ #176（乙）：lead 身份收口（t98）───────────────────────────────────────────
 * ★ 本模块**不再**自己写 `captainSessionId === <id>`。
 */
import { sessionLeadsTeam, type LiveSessionRef, type TeamIdentity } from './lineage.ts'

/** Persona snapshot of a profile protocol; the full text lives on team.json. */
export const PERSONA_PROTOCOL_MAX_CHARS = 400

/**
 * Restore the SessionId brand on a value that round-tripped through the
 * durable team file. The brand is erased by JSON serialization; the value
 * originated from `startContinuable`/`agent.id`, so this cast is the boundary
 * restoration, not a new assertion.
 */
function brandedSessionId(value: string): SessionId {
  return value as SessionId
}

/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
  /** Registered `ctx.subagents` provider name (must support continuable + persona). */
  provider: string
  /** Child delegation depth cap (0 forbids delegation entirely). */
  maxDepth?: number
  /** Plugin-wide execution prompt. */
  executionPrompt?: string
  /** Plugin-wide fallback route. */
  fallback?: { provider: string; model: string }
}

/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
  reasoningEffort?: string
  /** Configured second-choice route. */
  fallback?: { provider: string; model: string }
}

/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
  /** Explicit LLM provider route; requires an explicit model. */
  provider?: string
  /** Explicit model id; otherwise the plugin default or captain model is used. */
  model?: string
  /** Plugin-level member model default. */
  defaultModel?: string
  /** Explicit reasoning effort; "default" selects the target model's default effort. */
  reasoningEffort?: string
  /** Configured fallback route. */
  fallback?: { provider: string; model: string }
}

/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
  /** Trusted fresh-child admission, before the durable member id is written. */
  isPendingMember(agent: Agent): boolean
  /**
   * Make one selection visible while Harness materializes the fresh child.
   *
   * @param setup - child-scoped persona/tool restriction for hosts whose
   *   activation no longer carries them in the request. Installed by the
   *   synchronous child setup before the first request.
   */
  withPending<T>(
    parentSessionId: string,
    label: string,
    selection: MemberLlmSelection,
    operation: () => Promise<T>,
    setup?: TeamMember['runtimeSetup'],
  ): Promise<T>
}

/**
 * Validate a resolved roster against every provider catalog before any child
 * session is created. Catalogs are advisory when empty (some adapters accept
 * dynamic model ids), but a non-empty catalog is authoritative enough to
 * catch a typo that would otherwise boot a child and fail on its first turn.
 */
export async function validateMemberLlmSelections(
  ctx: Context,
  selections: readonly MemberLlmSelection[],
  signal?: AbortSignal,
): Promise<void> {
  const catalogs = new Map<string, Awaited<ReturnType<typeof ctx.llm.listModels>>>()
  for (const selection of selections) {
    if (signal?.aborted === true) throw signal.reason ?? new Error('member model validation was cancelled')
    let catalog = catalogs.get(selection.provider)
    if (catalog === undefined) {
      catalog = await ctx.llm.listModels(selection.provider)
      catalogs.set(selection.provider, catalog)
    }
    if (catalog.length === 0 || catalog.some((model) => model.id === selection.model)) continue
    const available = catalog.slice(0, 8).map((model) => model.id).join(', ')
    throw new Error(
      `unknown member model "${selection.model}" for provider "${selection.provider}"`
      + `${available === '' ? '' : ` (available: ${available}${catalog.length > 8 ? ', …' : ''})`}`,
    )
  }
}

const MEMBER_LABEL_PREFIX = 'agent-teams:'
const FALLBACK_FAILURE_CODES = new Set(['QUOTA', 'RATE_LIMIT', 'AUTH', 'MISSING_CREDENTIAL', 'NO_ADAPTER'])

export function isFallbackFailureCode(code: string): boolean {
  return FALLBACK_FAILURE_CODES.has(code)
}

/** Pure state transition used by the request-error handler and TDD tests. */
export function selectFallbackRoute(
  current: { provider: string; model: string },
  fallback: { provider: string; model: string } | undefined,
  failureCode: string,
  alreadySwitched: boolean,
): { retry: boolean; switched: boolean; selection: { provider: string; model: string } } {
  if (alreadySwitched || fallback === undefined || !isFallbackFailureCode(failureCode)) {
    return { retry: false, switched: alreadySwitched, selection: current }
  }
  return { retry: true, switched: true, selection: fallback }
}

/** Deliver a durable member report to the live captain at its next model step. */
export function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string, receipt?: string): boolean {
  try {
    captain.steer(createUserMessage({
      content: [{ type: 'text', text: receipt ?? `AgentTeams message from member ${from}:\n\n${content}` }],
      source: { kind: 'agent-teams' },
    }))
    return true
  } catch {
    return false
  }
}

interface FailedMemberAttempt {
  readonly captainSessionId: string
  readonly memberId: string
  readonly task?: Pick<TeamTask, 'id' | 'attempt' | 'attemptId'>
}

/**
 * ── ★★★ 这次失败是不是【一次重载造成的】，而不是一次工作失败？────────────────────
 *
 * 修的是 `docs/DEFECT-HMR-DURING-MEMBER-TURN.md` 那个缺陷：
 *
 *   本仓是 `link:` 装进 profile 的（`~/.dsh/profiles/desktop/package.json`），
 *   而 `cordis.patch.yml` 里 `@deepseek-ai/dsh-hmr` 的 `base` 指向本仓、
 *   `root: ["."]`、`debounce: 100` ⇒ **`lib/**` 一重写，宿主 100 ms 后重载本插件**。
 *   重载把本插件的 fiber 打散成 inactive，而成员回合还在跑 ⇒ 它下一次读
 *   `ctx.agents` 就抛 `cannot get required service "agents" in inactive context`
 *   ⇒ `agent/error` ⇒ 这里 ⇒ **一次构建把一条正在干活的活判成一次工作失败**。
 *
 * ★★ 为什么判据是"重载痕迹 + 时间窗"而不是"错误文本"：
 *
 *   拿 `message.includes('inactive context')` 当判据**判得出来但判错**——
 *   那条文本说的是「我这个 fiber 不活跃了」，而这既可能来自重载，
 *   也可能来自**回合本来就结束了**（`src/events.ts:71` 记的正是后者：
 *   落盘已经完成、只是回执读不到，那里把 `agents.get` 降级成 `undefined`）。
 *   两种情形下文本**逐字相同**，而补救动作相反：
 *   一种要"别把这次失败算到成员头上"，另一种要"这是记账问题，忽略即可"。
 *   ⇒ 判据必须落在**重载真的发生过**这个事实上，而不是落在那句报错上。
 *
 * ★ 为什么窗口从 `at` **往前**取：`hmr/reload` 事件在重载**开始时**写痕迹，
 *   而失败的报错在重载把 fiber 打散**之后**才出现（实测 6–538 ms）。
 *   ⇒ 反过来取"失败之后 N ms 内有重载"会把**下一次**构建算到这一次失败头上。
 *
 * @returns 命中的那一条重载记录；否则 `undefined`（⇒ 照常按工作失败处理）。
 */
function infrastructureFailureOf(
  stateRoot: string,
  failure: { readonly message: string },
): HmrReloadEntry | undefined {
  /**
   * ★ 只豁免**这一类**：服务读取失败。
   *
   * 少了这一道，窗口会变成"构建期间所有失败都不算"——
   * 一次真的把测试跑红的回合，只要它恰好落在构建窗口里，就会被记成基础设施故障。
   * 那与本缺陷正好是**同一件事的两个方向**（两头都会让"工作失败"读不出来）。
   * ★ 判据取 `src/events.ts:71` 用的同一个子串：全仓对这句报错的识别只有那一种写法。
   */
  if (!failure.message.includes('inactive context')) return undefined
  /**
   * ★★ 只认**本进程**写下的那一条（`process.pid`）。
   *
   * 痕迹文件是跨进程追加的（宿主重启、开两个窗口、跑一次 CLI 都往里写），
   * 而"别的进程刚重载过"与"我这一进程刚被重载"在"文件里有记录"这个读数上同形。
   * ★ 而它们**不可能**是同一件事：另一个进程的重载动不了本进程的 fiber，
   *   所以拿它的记录来解释本进程的一次 `inactive context` 是**归因错误**。
   * `readHmrTrace` 的 `sincePid` 参数就是为这一格存在的（见它的注释）。
   */
  return reloadJustBefore(stateRoot, Date.now(), process.pid)
}

/** Record a final turn failure, never an intermediate request retry. */
export async function failMemberOpenAttempt(
  ctx: Context,
  stateRoot: string,
  teamId: string,
  memberName: string,
  failure: { readonly code: string; readonly message: string },
  fallbackSession: Session,
  observed: FailedMemberAttempt,
): Promise<boolean> {
  const summary = `${failure.message} (code ${failure.code})`
  const lockKey = `team:${stateRoot}:${teamId}`
  const prepared = await withTeamLock(lockKey, async () => {
    const team = await readTeam(stateRoot, teamId)
    if (team === undefined || team.halted === true || team.captainSessionId !== observed.captainSessionId) return
    const member = team.members.find(candidate => candidate.name === memberName
      && candidate.id === observed.memberId && candidate.status !== 'removed')
    if (member === undefined) return
    const task = team.tasks.find(candidate => candidate.assignee === memberName
      && (candidate.status === 'claimed' || candidate.status === 'in_progress'))
    // A reassign, completion, or recreated member may win the lock while the
    // final error is queued. Only the capability observed at that event may fail.
    if (task?.id !== observed.task?.id || task?.attemptId !== observed.task?.attemptId
      || task?.attempt !== observed.task?.attempt) return
    if (task === undefined && member.status !== 'working') return
    /**
     * ── ★★★ 在落 `failed` **之前**先问一句：这次失败是不是重载造成的？────────────
     *
     * ★ 位置在这里而不是在 `agent/error` 监听器里的理由：
     *   ① 判据要用 `task` / `attemptId` 的三重相等校验**之后**的那个 `task`
     *     （监听器里那一份是 `readTeamSync` 的早期快照，可能已经过期）；
     *   ② 豁免之后**仍然**要写盘（把成员置 idle）⇒ 它和失败路径共用同一个锁、
     *     同一次 `writeTeam`，只是那两格（`status`/`output`）不写。
     *   监听到落账之间隔着一次 `await`（锁等待），在这里判，「现在」才是真的现在。
     *
     * ★★ 豁免**不是**"什么都不做"——那会让成员被一个永不结算的回合钉在 `working`，
     *   于是整队再也派发不到它。豁免 = **任务保持打开** + **成员回到 idle** +
     *   **队长收到一条明说是基础设施故障的消息**（不是"工作失败"）。
     *   三者缺一，读数就会与"成员悄悄死掉"同形。
     */
    const infrastructure = infrastructureFailureOf(stateRoot, failure)
    if (infrastructure !== undefined) {
      if (liveAgentOf(ctx, member.id)?.status !== 'running') member.status = 'idle'
      const gap = Math.max(0, Date.now() - infrastructure.at)
      const message = {
        ...createMessage(memberName, CAPTAIN_KEY, task === undefined
          ? `Member "${memberName}" was interrupted at ${new Date(infrastructure.at).toISOString()} by a plugin reload (${gap} ms before this error), not by its own work. No open attempt was owned; the member is idle again.`
          : `Infrastructure failure, not a work failure: member "${memberName}" was interrupted ${gap} ms after a plugin reload at ${new Date(infrastructure.at).toISOString()}. Task ${task.id} ("${task.subject}") is deliberately still ${task.status} — its attempt generation is unchanged (attempt ${String(task.attempt ?? 1)}), so the member can resume it. Root cause: ${summary}. Do not read this as failed work; re-dispatch or let the member continue.`),
        deliveryClaimedAt: Date.now(),
      }
      await writeTeam(stateRoot, team)
      await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
      appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, fallbackSession), 'agent-teams/message-sent', {
        teamId: team.id,
        messageId: message.id,
        from: memberName,
        to: CAPTAIN_KEY,
        content: message.content,
        ts: message.ts,
      })
      return { captainSessionId: team.captainSessionId, message }
    }
    if (task !== undefined) {
      task.status = 'failed'
      task.output = summary
      task.updatedAt = Date.now()
    }
    if (liveAgentOf(ctx, member.id)?.status !== 'running') member.status = 'idle'
    const message = {
      ...createMessage(memberName, CAPTAIN_KEY, task === undefined
        ? `Member "${memberName}" hit an unrecoverable turn failure: ${summary}. No open attempt was owned.`
        : `Member "${memberName}" hit an unrecoverable turn failure: ${summary}. Task ${task.id} ("${task.subject}") was marked failed; reassign it or retry when ready.`),
      deliveryClaimedAt: Date.now(),
    }
    await writeTeam(stateRoot, team)
    await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
    if (task !== undefined) {
      appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, fallbackSession), 'agent-teams/task-updated', {
        teamId, taskId: task.id, status: task.status, assignee: memberName, output: task.output,
      })
    }
    appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, fallbackSession), 'agent-teams/message-sent', {
      teamId: team.id,
      messageId: message.id,
      from: memberName,
      to: CAPTAIN_KEY,
      content: message.content,
      ts: message.ts,
    })
    return { captainSessionId: team.captainSessionId, message }
  })
  if (prepared === undefined) return false
  // Use the same lease/acknowledgment contract as send_message, outside the
  // team lock: steering can synchronously start another agent turn.
  const captain = liveAgentOf(ctx, prepared.captainSessionId)
  const delivered = captain !== undefined && steerCaptainReport(captain, memberName, prepared.message.content, mailboxPrompt(teamId, CAPTAIN_KEY, [prepared.message]))
  await withTeamLock(lockKey, () => delivered
    ? markMailboxDelivered(stateRoot, teamId, CAPTAIN_KEY, [prepared.message.id])
    : releaseMailboxDelivery(stateRoot, teamId, CAPTAIN_KEY, [prepared.message.id]))
  return true
}

async function updateFallbackState(
  stateRoot: string,
  teamId: string,
  memberName: string,
  fallback: { provider: string; model: string },
  ctx: Context,
): Promise<void> {
  await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
    const team = await readTeam(stateRoot, teamId)
    if (team === undefined) return
    const member = team.members.find(candidate => candidate.name === memberName)
    if (member === undefined) return
    member.activeProvider = fallback.provider
    member.activeModel = fallback.model
    member.fallbackActive = true
    await writeTeam(stateRoot, team)
  })
  void ctx
}

function pendingSelectionKey(parentSessionId: string, label: string): string {
  return `${parentSessionId}\u0000${label}`
}

function selectionFromMember(member: TeamMember | undefined): MemberLlmSelection | undefined {
  if (member?.provider === undefined || member.model === undefined) return undefined
  const provider = (member.activeProvider ?? member.provider).trim()
  const model = (member.activeModel ?? member.model).trim()
  if (provider === '' || model === '') return undefined
  // Effort ids belong to the original model. After a fallback, its own
  // provider default remains authoritative, including after cold recovery.
  const reasoningEffort = member.fallbackActive === true ? undefined : member.reasoningEffort?.trim()
  return {
    provider,
    model,
    ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort },
    ...member.fallback === undefined || member.fallbackActive === true ? {} : { fallback: member.fallback },
  }
}

function modelSelection(selection: MemberLlmSelection): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
  }
}

/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. When provider or model
 * changes, effort is intentionally omitted so the target model materializes
 * its own default instead of receiving an adapter-owned id from another route.
 * An explicit effort overrides either policy; the sentinel "default" also
 * selects the target model's default. The final effort is validated against
 * the target model before a child is created.
 */
export async function resolveMemberLlmSelection(
  ctx: Context,
  captain: Agent,
  request: MemberLlmSelectionRequest,
  signal?: AbortSignal,
): Promise<MemberLlmSelection> {
  const explicitProvider = request.provider?.trim()
  const explicitModel = request.model?.trim()
  const defaultModel = request.defaultModel?.trim()
  const explicitEffort = request.reasoningEffort?.trim()
  const fallback = request.fallback
  if (request.provider !== undefined && explicitProvider === '') {
    throw new Error('member LLM provider must not be empty')
  }
  if (request.model !== undefined && explicitModel === '') {
    throw new Error('member model must not be empty')
  }
  if (request.defaultModel !== undefined && defaultModel === '') {
    throw new Error('configured memberModel must not be empty')
  }
  if (request.reasoningEffort !== undefined && explicitEffort === '') {
    throw new Error('member reasoning effort must not be empty')
  }
  if (explicitProvider !== undefined && explicitModel === undefined) {
    throw new Error('an explicit member LLM provider requires an explicit member model')
  }

  const current = captain.session.requestHeader()?.config
  const currentProvider = current?.provider ?? captain.options.provider
  const currentModel = current?.model ?? captain.options.model
  const provider = explicitProvider ?? currentProvider
  const model = explicitModel ?? defaultModel ?? currentModel
  if (provider === undefined || model === undefined) {
    throw new Error('cannot resolve the member LLM route from the current captain session')
  }

  // Effort ids belong to one exact provider/model capability. Preserve the
  // captain's effort only on the same route; a changed route must resolve its
  // own default. Explicit effort still wins, while "default" forces that
  // target-default behavior even when the route did not change.
  const sameRoute = provider === currentProvider && model === currentModel
  const reasoningEffort = explicitEffort === undefined
    ? sameRoute
      ? current?.reasoningEffort
      : undefined
    : explicitEffort === 'default'
      ? undefined
      : ReasoningEffortId(explicitEffort)
  const resolved = await ctx.llm.resolveCallConfig({
    provider,
    model,
    ...reasoningEffort === undefined
      ? {}
      : { reasoningEffort },
  }, signal)
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(resolved.reasoningEffort) },
    ...fallback === undefined ? {} : { fallback },
  }
}

/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export function installMemberSelectionRuntime(
  ctx: Context,
  stateDir: string,
  onFailureSettled?: (workspace: string, teamId: string, memberName: string) => Promise<void>,
): MemberSelectionRuntime {
  const pending = new Map<string, MemberLlmSelection>()
  /**
   * ★★ 0.2.1 起，persona/toolFilter 不再随 activation 请求下发，也**不再写进
   *   宿主 descriptor**（`spawn` provider 把这两个能力位从 capabilities 里删了）。
   *   ⇒ 它们只能由**本插件**在子 ctx 上装，并且必须从两处取：
   *     · 刚 spawn 的那一次：spawn 侧放进 `pendingSetup`（子会话还没 id，按 label 键）；
   *     · 冷恢复/热重载：从 team.json 里该成员的 `runtimeSetup` 读。
   *   ★ 两处都没有 **且宿主 descriptor 里也没有** ⇒ 拒绝恢复：宁可报错，
   *     也不让一个成员在"无角色、无工具限制"的状态下继续跑（那等于提权）。
   */
  const pendingSetup = new Map<string, NonNullable<TeamMember['runtimeSetup']>>()
  installContinuableMemberSetup(ctx, (childCtx, child) => {
    const descriptor = foldSubagentDescriptor(sessionOwnEvents(child.session))
    if (descriptor?.mode !== 'continuable' || !descriptor.label.startsWith(MEMBER_LABEL_PREFIX)) {
      return () => undefined
    }

    const parentSessionId = child.session.header.parentSession
    if (parentSessionId === undefined) return () => undefined
    const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length)
    const separator = identity.indexOf(':')
    if (separator < 1 || separator === identity.length - 1) return () => undefined
    const teamId = identity.slice(0, separator)
    const memberName = identity.slice(separator + 1)
    const workspace = child.session.header.cwd ?? process.cwd()
    const stateRoot = join(workspace, stateDir)
    const key = pendingSelectionKey(parentSessionId, descriptor.label)
    // Internal settlement wakeups bypass the public delivery guard. Recheck
    // exact durable membership on every proposed step, including cold resume.
    const disposeAdmission = childCtx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent.id !== child.id) return next()
      const admitted = await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
        const team = await readTeam(stateRoot, teamId)
        /**
         * ── ★★★ #176（乙）：队长那一半走 fork 链（t98）─────────────────────────────
         * ★ `parentSessionId` 是**这个成员会话的父会话** —— 通常**就是队长**
         *   ⇒ 走链后仍命中（那种情形 `hops === 0`）。
         * ★★ 而若队长**在自己的 fork 里继续**，父会话就是那个 fork
         *   ⇒ 精确匹配会**认不出队长** ⇒ 这一步准入会**静默拒绝成员**。
         *   ⇒ 收口后走链仍认得到。
         * ★ **成员那一半照旧精确匹配**（下一行的 `team.members.some(...)`）——
         *   上游：「Membership keeps its exact id match」。
         */
        return team !== undefined && sessionLeadsTeam(parentSessionId, identityOfTeam(team), liveRefsOf(ctx))
          && team.phase !== 'staged' && team.halted !== true
          && team.members.some(member => member.id === child.id && member.name === memberName && member.status !== 'removed' && member.stopping !== true)
          && !team.tasks.some(task => task.reassigning === true && task.assignee === memberName)
      })
      if (!admitted) return { kind: 'reject' }
      return next()
    })
    /**
     * ── ★★★ managed activation 宿主：由插件自己装 persona / 工具限制 ──────────────
     *
     * ★ 为什么在这里装：这个回调是**同步**的子会话 setup（`onAgentReady`），
     *   在第一个 request 之前跑 —— persona section 与工具限制都必须在
     *   request 组装前就位，否则第一轮就已经越权跑完了。
     * ★ 为什么要先算 `savedMember`：`pending` 里有键 ⇒ 这是本进程刚 spawn 的，
     *   setup 在 `pendingSetup` 里；否则是冷恢复/热重载 ⇒ 只能从 team.json 读。
     *   ★ 两者都没有、宿主 descriptor 里也没有 ⇒ **拒绝恢复**：
     *     静默放行等于把一个成员克隆成"无限制成员"（工具限制是安全边界）。
     */
    const savedTeam = pending.has(key) ? undefined : readTeamSync(stateRoot, teamId)
    const savedMember = savedTeam?.captainSessionId === parentSessionId
      ? savedTeam.members.find(member => member.id === child.id && member.name === memberName)
      : undefined
    const setup = pendingSetup.get(key) ?? savedMember?.runtimeSetup
    if (usesManagedActivations(ctx.subagents) && savedMember !== undefined
      && setup === undefined && descriptor.toolFilter === undefined) {
      disposeAdmission()
      throw new Error('agent-teams: saved member runtime setup is missing; refusing an unrestricted resume')
    }
    let disposeSetup = (): void => undefined
    if (usesManagedActivations(ctx.subagents) && setup !== undefined) {
      try {
        const stopFilter = childCtx.tools.restrict(setup.toolFilter)
        try {
          const stopPersona = childCtx.systemPrompt.section({
            name: 'deployment:persona-prefix',
            order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
            text: setup.persona,
          })
          disposeSetup = () => { stopPersona(); stopFilter() }
        } catch (error) { stopFilter(); throw error }
      } catch (error) { disposeAdmission(); throw error }
    }
    const cleanupAdmission = (): void => { disposeSetup(); disposeAdmission() }
    let selection = pending.get(key)
    if (selection === undefined) {
      const team = readTeamSync(stateRoot, teamId)
      if (team?.captainSessionId !== parentSessionId) return cleanupAdmission
      const durableMember = team.members.find(member => member.name === memberName)
      selection = selectionFromMember(durableMember)
      if (selection !== undefined && (descriptor.agentProvider !== durableMember?.provider || descriptor.agentModel !== durableMember?.model)) {
        throw new Error(
          `agent-teams: saved model route for member "${memberName}" does not match its subagent descriptor`,
        )
      }
    }

    let lastFailedTurn: number | undefined
    // Harness emits agent/error only after request recovery is exhausted. In
    // particular, llm-retry's "always" policy calls downstream request-error
    // listeners before it retries; that waterfall cannot declare a turn dead.
    const disposeFailure = childCtx.on('agent/error', async (payload) => {
      if (payload.agent.id !== child.id || payload.turn === lastFailedTurn) return
      lastFailedTurn = payload.turn
      try {
        // Capture the attempt synchronously at the event, before any lock wait
        // can let a captain reassign it or replace the member/team generation.
        const snapshot = readTeamSync(stateRoot, teamId)
        if (snapshot?.captainSessionId !== parentSessionId) return
        const member = snapshot.members.find(item => item.id === child.id && item.name === memberName && item.status !== 'removed')
        if (member === undefined) return
        const task = snapshot.tasks.find(item => item.assignee === memberName
          && (item.status === 'claimed' || item.status === 'in_progress'))
        const failure = payload.error instanceof LlmError ? payload.error.failure : {
          code: 'UNKNOWN',
          message: payload.error instanceof Error ? payload.error.message : String(payload.error),
        }
        const recorded = await failMemberOpenAttempt(ctx, stateRoot, teamId, memberName, failure, child.session, {
          captainSessionId: parentSessionId, memberId: child.id, task,
        })
        if (!recorded) return
        // The final-error event precedes driver quiescence. Observe the real
        // lifecycle and kick explicitly even if its idle event was missed.
        // Never force an active Agent's status to idle or retry the failed task.
        await child.whenIdle()
        await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
          const team = await readTeam(stateRoot, teamId)
          const current = team?.members.find(item => item.id === child.id && item.name === memberName && item.status !== 'removed')
          if (team?.captainSessionId !== parentSessionId || current === undefined || child.status !== 'idle') return
          if (current.status !== 'idle') {
            current.status = 'idle'
            await writeTeam(stateRoot, team)
          }
        })
        await onFailureSettled?.(workspace, teamId, memberName)
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: failed to record member turn failure: ${String(error)}`)
      }
    })
    // Legacy teams still need failure reporting even without a saved route.
    if (selection === undefined) return () => { disposeFailure(); cleanupAdmission() }
    const selectionRef = { current: modelSelection(selection), assembled: undefined as ModelSelection | undefined }
    const disposeSelection = installModelSelection(childCtx, selectionRef)
    const fallback = selection.fallback
    let switched = false
    const disposeFallback = childCtx.on('agent/request-error', async (payload, next) => {
      if (payload.agent.id !== child.id || payload.signal.aborted) return next()
      const transition = selectFallbackRoute(selectionRef.current ?? { provider: selection.provider, model: selection.model }, fallback, payload.failure.code, switched)
      // selectFallbackRoute only retries when a fallback route exists; the
      // explicit guard narrows that fact for the compiler.
      if (fallback !== undefined && transition.retry) {
        switched = transition.switched
        selectionRef.current = transition.selection
        // Request recovery repeats buildRequest inside the current step; it
        // does not re-run prompt assembly. Override that captured route too,
        // otherwise the authorized retry would hit the failed primary again.
        selectionRef.assembled = transition.selection
        await updateFallbackState(stateRoot, teamId, memberName, fallback, ctx).catch((error: unknown) => {
          ctx.logger.warn(`agent-teams: failed to persist fallback route: ${String(error)}`)
        })
        ctx.logger.warn(`agent-teams: member ${child.id} switching to fallback ${fallback.provider}/${fallback.model} after ${payload.failure.code}`)
        return { kind: 'retry' as const }
      }
      return next()
    })
    return () => {
      disposeFallback()
      disposeSelection()
      disposeFailure()
      cleanupAdmission()
    }
  })

  return {
    isPendingMember(agent) {
      const parent = agent.session.header.parentSession
      const descriptor = foldSubagentDescriptor(sessionOwnEvents(agent.session))
      return parent !== undefined && descriptor?.mode === 'continuable'
        && pending.has(pendingSelectionKey(parent, descriptor.label))
    },
    async withPending<T>(
      parentSessionId: string,
      label: string,
      selection: MemberLlmSelection,
      operation: () => Promise<T>,
      setup?: TeamMember['runtimeSetup'],
    ): Promise<T> {
      const key = pendingSelectionKey(parentSessionId, label)
      if (pending.has(key)) {
        throw new Error(`member model selection is already pending for "${label}"`)
      }
      pending.set(key, selection)
      if (setup !== undefined) pendingSetup.set(key, setup)
      try {
        return await operation()
      } finally {
        pending.delete(key)
        pendingSetup.delete(key)
      }
    },
  }
}

function configuredExecutionPrompt(member: TeamMember, config: MemberRuntimeConfig): string | undefined {
  const prompt = member.executionPrompt?.trim() || config.executionPrompt?.trim()
  return prompt === undefined || prompt === '' ? undefined : prompt
}

function truncatedPersonaProtocol(protocol: string | undefined): string {
  if (protocol === undefined || protocol.trim() === '') return '(none)'
  if (protocol.length <= PERSONA_PROTOCOL_MAX_CHARS) return protocol
  return `${protocol.slice(0, PERSONA_PROTOCOL_MAX_CHARS)}… [truncated]`
}

function assignedNonTerminalCount(team: TeamState, memberName: string): number {
  return team.tasks.filter(task => (
    task.assignee === memberName && !TERMINAL_TASK_STATUSES.includes(task.status)
  )).length
}

/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * Frozen at spawn: draft must already carry the Team goal and profile protocol.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 */
export function memberPersona(team: TeamState, member: TeamMember, stateDir: string, executionPrompt?: string): string {
  const goal = team.description?.trim() || '(not provided)'
  const injectedPrompt = member.executionPrompt?.trim() || executionPrompt?.trim()
  const protocol = truncatedPersonaProtocol(team.profile?.protocol)
  return `You are ${member.name}, a member of the multi-agent team "${team.name}" running inside DeepSeek Harness AgentTeams. The captain leads the team; you are a worker member${member.role ? ` with the role: ${member.role}` : ''}.

Team context:
- Team id: ${team.id}
- Your name inside the team (use it as \`from\`/identity): ${member.name}
- Team goal: ${goal}
- Profile protocol: ${protocol}
${injectedPrompt === undefined || injectedPrompt === '' ? '' : `- Execution guidance:
${injectedPrompt}
`}- The team state lives under ${stateDir}/${team.id}/ (team.json and inbox/*.jsonl). You may inspect these files read-only for diagnostics, but never edit them directly; use the agent_teams_* tools so JSON escaping and concurrent updates stay safe.
- The captain and your teammates reach you through messages. Coordination arrives at your nearest model step. Apply it to your current attempt; a task assignment starts a separate turn.
When you receive a task, treat the assignment prompt's dependency results as source material. Do not ignore them.

Working rules:
1. When you receive a task assignment, call agent_teams_claim_task with the task id. Keep the returned attempt_id: include it in every agent_teams_update_task call for that execution attempt. Then mark the task in_progress.
2. Work thoroughly with your available tools; do not cut corners.
3. When finishing a task:
   - use status=completed only when the task's success criteria are satisfied;
   - use status=failed when blocking findings or validation failures mean downstream work must not proceed;
   - include a concise output in either case;
   - a stale-attempt rejection means the captain reassigned or took over the task; stop touching that task and wait for new work.
   claimed cannot jump to completed. Mark in_progress first, then completed or failed.
   Include attempt_id on every update. Then report once as described below and become idle.
4. Send one short report with agent_teams_send_message (to=captain) when you complete a task or hit a blocker. Include source_task_id and source_attempt_id in task reports; a stale source rejection means stop, never relabel an old result with a new attempt. The captain is also your parent: this single message satisfies both reporting duties. Do not repeat it through the native send_message tool or send acknowledgments that add no new information.
5. To ask a teammate something, use agent_teams_send_message with to=<teammate name>; the message lands in their mailbox and wakes them directly — teammates talk to each other without the captain in the loop. The same applies to the captain (to=captain).
6. After your turn becomes idle, the shared task scheduler may assign your next ready task automatically. Never claim a second task while you still own unfinished work.
7. If you already own an open attempt (claimed or in_progress) and receive mail, treat it as guidance for that same attempt_id unless the mail explicitly tells you to stop or fail. Do not claim a new task in that turn.
8. Do not start a teammate's assigned task. Do not privately tell the next-stage member to start; the scheduler assigns unlocked work after you become idle.
9. You are a worker: do not create or delete teams, reassign tasks, or add/remove members — that is the captain's job.
10. Quality-gate kinds carry a contract (kind, objective, inScope, acceptance, verify). Stay inside inScope. Do not mark your own implementation as review pass. Review/requirements complete only with verdict=pass; needs_revision/reject must fail with findings. Mail is not a formal next review. Completed work must not be repeated to attach late evidence: call update_task on the original task with its attempt_id and acceptanceResults/commandsRun/evidence_note; supplements are append-only and cannot change its verdict.`
}

/**
 * The initial user message delivered when the member is created.
 * Counts non-terminal tasks already assigned to this member on the in-memory draft.
 * @param team - the team the member joined.
 * @param memberName - canonical member name used to count assigned pending work.
 */
export function memberWelcome(team: TeamState, memberName: string): string {
  const assigned = assignedNonTerminalCount(team, memberName)
  return `You have joined the team "${team.name}" as a member. Wait for an automatic assignment or a captain message.
Current team status: ${team.tasks.length} task(s), ${assigned} pending task(s) assigned to you.
Do not start work until the scheduler or captain assigns a task in this turn.`
}

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
export async function spawnMember(
  ctx: Context,
  config: MemberRuntimeConfig,
  selections: MemberSelectionRuntime,
  llmSelection: MemberLlmSelection,
  captain: Agent,
  team: TeamState,
  member: TeamMember,
  stateDir: string,
  signal: AbortSignal,
  initialPrompt?: string,
): Promise<void> {
  // Fail loud at the first use: provider registration is a sibling plugin's
  // effect and may settle after this plugin mounts. Capability checks here
  // mirror what startContinuable would reject, with an actionable error.
  const provider = ctx.subagents.getProvider(config.provider)
  if (provider === undefined) {
    throw new Error(
      `agent-teams: no subagent provider "${config.provider}" is registered (available: ${ctx.subagents.list().join(', ') || 'none'}) — `
      + 'check that the subagent provider row (e.g. subagent-spawn) is mounted in the composition',
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new Error(`agent-teams: provider "${config.provider}" does not support continuable members`)
  }
  /**
   * ★★ 0.2.1 把 `persona` / `toolFilter` 两个能力位从 spawn provider 里删了
   *    （它们不再随 activation 下发，改由插件在子 ctx 上装）。
   *   ⇒ 只在**老宿主**（没有 managed activations）上做这两个检查；
   *     否则新宿主的每一次 spawn 都会在这里抛错，看上去像"provider 不支持"。
   *   ★ `capabilities` 的 TS 形状仍是旧世代 ⇒ 用结构断言读这两个可选位，
   *     不引入 `any`。
   */
  const legacyCapabilities = provider.capabilities as unknown as { persona?: boolean; toolFilter?: boolean }
  const managed = usesManagedActivations(ctx.subagents)
  if (!managed && !legacyCapabilities.persona) {
    throw new Error(`agent-teams: provider "${config.provider}" cannot apply a member persona`)
  }
  if (!managed && !legacyCapabilities.toolFilter) {
    throw new Error(`agent-teams: provider "${config.provider}" cannot restrict captain-only tools for members`)
  }
  const label = `${MEMBER_LABEL_PREFIX}${team.id}:${member.name}`
  const persona = memberPersona(team, member, stateDir, config.executionPrompt)
  // The exact filter the host accepted; kept as the durable member setup on
  // hosts where the descriptor no longer records it.
  let acceptedFilter: MemberToolFilter = memberToolFilter(config.maxDepth, restrictableToolNames(captain))
  const start = await startMemberWithLenientFilter(
    toolFilter => {
      acceptedFilter = toolFilter
      const request: MemberStartSpec['request'] = {
        prompt: [{ type: 'text', text: initialPrompt ?? memberWelcome(team, member.name) }],
        parent: captain,
        persona,
        // Depth deny entries name host tools; resolve them against the
        // running host's registry so a renamed delegation tool cannot abort
        // the spawn (see memberToolFilter). Depth is still enforced by the
        // parent-chain guard installed at plugin mount. A filter the host
        // still rejects is retried without the names it reported.
        toolFilter,
        agentOptions: {
          provider: llmSelection.provider,
          model: llmSelection.model,
          ...llmSelection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(llmSelection.reasoningEffort) },
        },
        // Harness request.maxDepth caps the absolute depth of THIS creation;
        // it is not inherited by later delegations. The guard below enforces
        // the configured member-relative descendant budget instead.
      }
      return selections.withPending(
        captain.id,
        label,
        llmSelection,
        () => startMember(ctx.subagents, { provider: config.provider, label, request, signal }),
        { persona, toolFilter },
      )
    },
    acceptedFilter,
  )
  member.id = start.childId
  if (managed) member.runtimeSetup = { persona, toolFilter: acceptedFilter }
}

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
export async function deliverToMember(
  ctx: Context,
  captain: Agent,
  childId: string,
  text: string,
  signal: AbortSignal,
  mode: 'queue' | 'steer' = 'queue',
): Promise<boolean> {
  return (await deliverToMemberDetailed(ctx, captain, childId, text, signal, mode)).ok
}

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
export async function deliverToMemberDetailed(
  ctx: Context,
  captain: Agent,
  childId: string,
  text: string,
  signal: AbortSignal,
  mode: 'queue' | 'steer' = 'queue',
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const content = [{ type: 'text' as const, text }]
    if (mode === 'steer') await steerMemberPrompt(ctx.subagents, captain, brandedSessionId(childId), content, signal, liveAgentOf(ctx, childId))
    else await queueMemberPrompt(ctx.subagents, captain, brandedSessionId(childId), content, signal)
    return { ok: true }
  } catch (error: unknown) {
    const reason = String(error)
    ctx.logger.warn(`agent-teams: prompt delivery to member ${childId} failed: ${reason}`)
    return { ok: false, reason }
  }
}

/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export function interruptMember(ctx: Context, captain: Agent, childId: string): void {
  try {
    ctx.subagents.interrupt(brandedSessionId(childId), { kind: 'ancestor', agent: captain })
  } catch (error: unknown) {
    ctx.logger.warn(`agent-teams: interrupt of member ${childId} failed: ${String(error)}`)
  }
}

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
export function installRetiredMemberGuard(ctx: Context, stateDir: string): void {
  guardSubagentDelivery(ctx, async (parent, childId) => {
    const retired = await readRetiredMemberIds(join(parent.session.header.cwd ?? process.cwd(), stateDir))
    return retired.has(childId)
  })
}

/** Bound all descendant creation, including renamed tools and code-runtime calls. */
export function installMemberDelegationGuard(ctx: Context, stateDir: string, maxDepth: number): void {
  let active = true
  const check = (parent: Agent): void => {
    if (!active) return
    let ancestor: Agent | undefined = parent
    let depth = 1
    while (ancestor !== undefined) {
      const descriptor = foldSubagentDescriptor(sessionOwnEvents(ancestor.session))
      if (descriptor?.label?.startsWith(MEMBER_LABEL_PREFIX)) {
        const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length)
        const separator = identity.indexOf(':')
        let team: ReturnType<typeof readTeamSync>
        try {
          team = readTeamSync(join(ancestor.session.header.cwd ?? process.cwd(), stateDir), identity.slice(0, separator))
        } catch (error: unknown) {
          // Distinguish "team state unreadable" (e.g. a corrupt team.json) from
          // the guarded rejections below: reject with an actionable message
          // instead of leaking the raw parse error through subagents.start.
          throw new Error(`AgentTeams delegation guard could not read the team state of "${identity.slice(0, separator)}" (its team.json may be corrupt or unreadable): ${String(error)}`)
        }
        const member = team?.members.find(item => item.id === ancestor!.id && item.name === identity.slice(separator + 1))
        if (member === undefined || member.status === 'removed' || member.stopping === true || team?.halted === true) throw new Error('AgentTeams member is no longer admitting delegated work')
        if (depth > maxDepth) throw new Error(`AgentTeams member delegation limit (${maxDepth}) reached; report to the captain instead of spawning another agent`)
        return
      }
      const parentId: SessionId | undefined = ancestor.session.header.parentSession
      ancestor = parentId === undefined ? undefined : liveAgentOf(ctx, parentId)
      depth++
    }
  }
  // Every creation API the host exposes is wrapped by harness-compat, so a
  // host that adds a third entry point (0.2.1 `startActivation`) stays bounded.
  guardSubagentCreation(ctx, check)
  ctx.effect(() => () => { active = false }, 'agent-teams: delegation guard lifetime')
}

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
export function memberActivity(
  ctx: Context,
  memberIds: readonly string[],
): Map<string, 'running' | 'idle' | 'ready'> {
  const activity = new Map<string, 'running' | 'idle' | 'ready'>()
  for (const id of memberIds) {
    if (id === '') continue
    const live = liveAgentOf(ctx, id)
    activity.set(id, live === undefined ? 'ready' : live.status)
  }
  return activity
}

// ─────────────────────────────────────────────────────────────────────────────
// 会话存活读数（t4）：`working` 是【残留状态】，而它此前没有任何出口
// ─────────────────────────────────────────────────────────────────────────────

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
export type MemberLiveness =
  | { readonly state: 'working'; readonly readout: 'live-running'; readonly rejects: false }
  | { readonly state: 'idle'; readonly readout: 'live-idle'; readonly rejects: false }
  | { readonly state: 'not-live'; readonly readout: 'driver-absent'; readonly rejects: false }
  | { readonly state: 'never-spawned'; readonly readout: 'never-spawned'; readonly rejects: false }
  | {
      readonly state: 'could-not-measure'
      readonly readout: 'driver-status-unreadable'
      /** ★ 说清**是什么**读不到 —— 一句"未能测量"没有成因就是一句空话。 */
      readonly reason: string
      readonly rejects: false
    }

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
  readonly rejects: false
}

/** 拿不到 `agent.status` 两态时的成因（诊断面，不改变裁决）。 */
export const DRIVER_STATUS_UNREADABLE = 'the live Agent driver is present but reports a lifecycle status that is neither "running" nor "idle"'

/** `never-spawned` 的成因：它**没有**起来过，与"起来了又死了"必须不同形。 */
export const MEMBER_NEVER_SPAWNED = 'this member was never spawned (no child session id), so whether it is alive is not a question that can be asked of it'

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
export function memberLiveness(
  ctx: Context,
  member: { readonly id: string; readonly spawnError?: string },
): MemberLiveness {
  /**
   * ★ `id === ''` 是**可判定的事实**（"它没起来过"），不是"没能测量"。
   *   把它并进 `could-not-measure` 会让"从未启动"看起来像一次基础设施故障 ——
   *   与 `observeMemberConvergence` 的 `never-spawned` 同一口径（那里早就分开了）。
   */
  if (member.id === '') {
    return { state: 'never-spawned', readout: 'never-spawned', rejects: false }
  }
  const live = liveAgentOf(ctx, member.id)
  /**
   * ★★ 这一支就是 §39 要抓的那一格：驱动不在场。
   *   `ctx.agents.get(id) === undefined` 正是 `deliverToMemberDetailed` 投递失败时
   *   那一次 `active teammate not found` 的同一条判据 —— 只是这里不投递。
   */
  if (live === undefined) {
    return { state: 'not-live', readout: 'driver-absent', rejects: false }
  }
  if (live.status === 'running') return { state: 'working', readout: 'live-running', rejects: false }
  if (live.status === 'idle') return { state: 'idle', readout: 'live-idle', rejects: false }
  /**
   * ★ 驱动在场、而它的状态不是那两态之一 ⇒ **说不出**。
   *   圆成 `working` 会让"不知道"与"在跑"同形 —— 而那正是本任务要消灭的形状；
   *   圆成 `not-live` 更坏（它会让一次 Harness 边界变化看起来像一整队成员死亡）。
   */
  return {
    state: 'could-not-measure',
    readout: 'driver-status-unreadable',
    reason: `${DRIVER_STATUS_UNREADABLE} (reported: ${JSON.stringify(String(live.status))})`,
    rejects: false,
  }
}

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
export function strandedWork(
  liveness: MemberLiveness,
  openTasks: readonly string[],
): boolean {
  /**
   * ★ 只有 `not-live` 算"悬空"。
   *   `could-not-measure` **不算** —— 那不是一条关于成员的事实，是一条关于我们
   *   读不到什么的诚实交代；拿它去报警会把一次基础设施故障伪装成一个结论。
   */
  return liveness.state === 'not-live' && openTasks.length > 0
}

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
export type StrandedWorktrees =
  | { readonly status: 'clear'; readonly checked: number }
  | { readonly status: 'frozen'; readonly checked: number; readonly worktrees: readonly FrozenWorktree[] }
  | { readonly status: 'could-not-measure'; readonly reason: string }

/** 一棵冻着的树：路径 + 有几个路径脏了。★ 不报文件名 —— 那可能很长，且抢救要的是整棵树。 */
export interface FrozenWorktree {
  /** 那棵树的绝对路径（抢救的落点）。 */
  readonly path: string
  /** 它相对工作区的名字（`task-t39` 那一格，人读的）。 */
  readonly name: string
  /** 脏路径的条数。★ `0` 的树**不会**出现在这里（见下）。 */
  readonly dirty: number
}

/** 一棵**可能的**冻树：它的成员名 + 它的绝对路径（由调用方算出，见下）。 */
export interface FrozenCandidate {
  /** 处于 `not-live` 且名下有在飞任务的那个成员。 */
  readonly member: string
  /** 那棵树的绝对路径。★ 目录名由调用方用 `worktreeDirName` 算 —— 见下。 */
  readonly path: string
  /** 它在磁盘上的名字（`task-<team>-<id>`），人读的。 */
  readonly name: string
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
export function strandedWorktrees(
  candidates: readonly FrozenCandidate[],
  dirtyOf: (worktreePath: string) => number | undefined,
): StrandedWorktrees {
  const worktrees: FrozenWorktree[] = []
  let checked = 0
  let couldNotReach = 0
  for (const candidate of candidates) {
    const dirty = dirtyOf(candidate.path)
    /**
     * ★ 某一棵树读不到 ⇒ 它**只是没被算进来**（与 `observeWorkspaces` 同一口径），
     *   而"一次都没能读"要被记下来 —— 见下面那个反向半边。
     */
    if (dirty === undefined) {
      couldNotReach += 1
      continue
    }
    checked += 1
    /**
     * ★ `dirty === 0` 的树**不报**：一棵干净的树没有东西会丢，报它只会让
     *   "有东西会丢"这件事被淹没在一串噪声里。而那正是本队记账的形态：
     *   一条每次都出现的告警会被永久忽略。
     */
    if (dirty === 0) continue
    worktrees.push({ path: candidate.path, name: candidate.name, dirty })
  }
  /**
   * ★★ 反向半边（防恒真）：**一次都没读到** ⇒ `could-not-measure`，不是 `clear`。
   *   缺了这一半，一个"永远返回 0"的注入器会让整格恒报"没有东西会丢"，
   *   而它看起来完全正常 —— 那正是抢救那一步最需要它的时候。
   *
   * ★ 而 `candidates` 为空时走的是 `clear`：那是**可判定的事实**（没有死掉的
   *   成员 ⇒ 没有树要抢救），与"我没能去读"必须不同形。
   */
  if (checked === 0 && candidates.length > 0 && couldNotReach > 0) {
    return {
      status: 'could-not-measure',
      reason: `${couldNotReach} worktree(s) of dead member(s) could not be read, so whether any uncommitted work is frozen there is unknown — that is "not measured", not "nothing to salvage"`,
    }
  }
  if (worktrees.length === 0) return { status: 'clear', checked }
  return { status: 'frozen', checked, worktrees }
}

/** 把那一格说成一句人话（含**补救动作** —— 只说"冻着"不改变任何人的下一步）。 */
export function describeStrandedWorktrees(readout: StrandedWorktrees): string {
  if (readout.status === 'could-not-measure') {
    return `whether uncommitted work is frozen in a dead member's worktree could NOT be measured (${readout.reason}) — salvage before touching those trees`
  }
  if (readout.status === 'clear') {
    return `no uncommitted work is frozen in a dead member's worktree (${readout.checked} tree(s) checked)`
  }
  const list = readout.worktrees.map((tree) => `${tree.name} (${tree.dirty} path(s))`).join(', ')
  return `${readout.worktrees.length} worktree(s) hold uncommitted work whose member session is gone: ${list} — `
    + 'nothing will commit them; salvage them (e.g. to /tmp/salvage-<time>/) before any branch switch or cleanup'
}

// ─────────────────────────────────────────────────────────────────────────────
// t27：把一个成员的**活子代理**投影出来（面板的展开层）
// ─────────────────────────────────────────────────────────────────────────────

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
  readonly id: string
  /** 描述符的 `label`（缺席 ⇒ `''`，见下注）。 */
  readonly label: string
  /** 描述符的 `mode`；读不到描述符 ⇒ 缺席（**不是**编一个 `one-shot`）。 */
  readonly mode?: 'one-shot' | 'continuable'
  /** 它此刻的驱动状态（`running` / `idle` / …）—— 原样交出，不翻译。 */
  readonly status: string
  /**
   * ── ★ 父会话 id（**归组的输入**，不是输出）──────────────────────────────────────
   *
   * 它是"谁生了它"，而归属是"它算谁的" —— 两者在**父不是本队成员**时**不同**：
   * 那时归属落在 `unattributed`，而父会话是那件事的**证据**。
   * ⇒ 这一格留着，读的人（与夹具）才分得出"它没有父"与"它的父不是我们的人"。
   */
  readonly parentSession?: string
}

/** 三态：读了 / 读不到。★ `observed` 里**空数组**是"真的没有"，与 `could-not-measure` 不同形。 */
export type SubagentProjection =
  | { readonly status: 'observed'; readonly subagents: readonly LiveSubagent[] }
  | { readonly status: 'could-not-measure'; readonly reason: string }

/**
 * 一个成员底下的子代理（面板展开层的一行）。
 *
 * ★ `round` **不在**这里：轮次挂在**任务**上（`TeamTask.round`），而子代理挂的是
 *   会话。两格由**调用方**按自己的口径合起来（见 `snapshot.ts` 里那段）——
 *   在这里猜一个轮次就是造第二份真相。
 */
export interface MemberSubagents {
  readonly status: SubagentProjection['status']
  /** `observed` 时在场：这个成员名下的活子代理（**空数组** = 真的没有）。 */
  readonly subagents: readonly LiveSubagent[]
  /** `could-not-measure` 时在场。 */
  readonly reason?: string
}

/** 宿主没有可用的会话枚举入口时的成因。 */
export const AGENT_ENUMERATION_UNAVAILABLE = 'the host exposes no live-session enumeration, so whether a member has subagents cannot be read'

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
export function liveSessionRefs(ctx: Context): SubagentProjection {
  /**
   * ── ★★★ 这一次读**必须在 try 里面**（2026-10-19，又一次实测之后）───────────
   *
   * MEASURED：`ctx.agents` 这个**属性读取本身**就会抛 —— 不是只有它的 `.get()` 会抛。
   *   机制在 cordis（`node_modules/@deepseek-ai/cordis/lib/index.js:684-690`）：
   *   取值器的 proxy trap 沿 fiber 树往上找 `fiber.store[prop]`，找不到时若
   *   `prop in fiber.inject` ⇒ 当场抛出 `cannot get required service "${prop}"
   *   in inactive context`，**不再往上找**。本插件在顶层 inject 里声明了 `agents`
   *   （`src/index.ts:56`）⇒ 任何一棵**已经不在运行**的 fiber 上读 `ctx.agents`
   *   都会抛，与读哪一个键无关。
   *
   * ★ 所以原来把 `const registry = ctx.agents` 放在 try **外面**，等于把一个必然
   *   会抛的属性访问放在了守卫之外：那个 try 只兜住了 `.list()` 的调用，兜不住
   *   走到 `.list()` 之前的那一步。⇒ 上一轮把七处 `ctx.agents.get(...)` 收进
   *   `liveAgentOf` 之后，**这一处成了新的裸奔点**，而它在工具的事件路径上
   *   （`liveRefsOf` → `scheduler.kickTeam` / `update_task` 的尾巴 / `status`）。
   *
   * ★ 三态不变：读不到仍是 `could-not-measure`，绝不圆成 `observed: []`
   *   （那会让面板永远显示"没有子代理"，与"真的没有"同形 —— 验收第 3 条钉的就是它）。
   * ★ 其余异常照旧往上抛（`inactive context` 之外的错误不该被这里吞掉）。
   */
  let registry: { list?: () => readonly unknown[] } | undefined
  try {
    registry = (ctx as unknown as { agents?: { list?: () => readonly unknown[] } }).agents
  }
  catch (error: unknown) {
    const message = String((error as { message?: unknown })?.message ?? error)
    if (!message.includes('inactive context')) throw error
    return { status: 'could-not-measure', reason: AGENT_ENUMERATION_UNAVAILABLE }
  }
  /**
   * ★★ 这一支是本任务的三态要害：**枚举入口不在** ⇒ `could-not-measure`。
   *   圆成 `{ status: 'observed', subagents: [] }` 会让面板**永远**显示"没有
   *   子代理" —— 而那与"真的没有"同形。验收第 3 条钉的就是它。
   */
  if (registry === undefined || typeof registry.list !== 'function') {
    return { status: 'could-not-measure', reason: AGENT_ENUMERATION_UNAVAILABLE }
  }
  let listed: readonly unknown[]
  try {
    listed = registry.list.call(registry)
  } catch (error: unknown) {
    return {
      status: 'could-not-measure',
      reason: `the live-session enumeration threw, so whether a member has subagents cannot be read: ${String(error)}`,
    }
  }
  if (!Array.isArray(listed)) {
    return {
      status: 'could-not-measure',
      reason: `the live-session enumeration returned ${typeof listed} instead of a list, so whether a member has subagents cannot be read`,
    }
  }
  const refs: LiveSubagent[] = []
  for (const entry of listed) {
    const id = agentIdOf(entry)
    if (id === undefined) continue
    /**
     * ── ★★ 一个会话读不出描述符**不许**掀翻整份快照 ──────────────────────────────
     *
     * MEASURED（本任务开工时，我自己的第一版探针当场撞上）：`sessionOwnEvents`
     * 在一个既没有 `ownEvents()`、也没有 legacy `events` 数组的会话上**抛错**
     * （`unsupported Harness subagent contract`，见 harness-compat 的 `unsupported`）。
     * 那是**刻意的** —— 它防的是"契约换了而插件装作没看见"。
     *
     * ★ 但这一格是**面板的读取路径**：一个形状不认识的会话不该让**整块面板**
     *   崩掉（那会把"某个会话读不出描述符"升级成"看不到任何团队"）。
     * ⇒ 逐条兜住，并把"这一条读不出身份"如实报成**缺 label/mode**，
     *   而**不是**从清单里删掉它：删掉会让它在面板上**消失**（读的人以为没有），
     *   而留着至少让它占一行、状态可读。
     */
    const descriptor = (() => {
      try {
        return foldSubagentDescriptor(sessionOwnEvents((entry as { session: never }).session))
      } catch {
        return undefined
      }
    })()
    const parent = parentSessionOf(entry)
    refs.push({
      id,
      /**
       * ★ `label: ''` 与"没有这一格"在**值**上同形，但这里没有更有信息量的选择：
       *   一个没有 label 的描述符（`one-shot` 可以不带 label）本来就**没有**身份标签，
       *   编一个会让人以为它在枚举里可辨认。`mode` 那一格才是"读不到"的出口。
       */
      label: descriptor?.label ?? '',
      ...descriptor === undefined ? {} : { mode: descriptor.mode },
      status: typeof (entry as { status?: unknown }).status === 'string'
        ? String((entry as { status: unknown }).status)
        : 'unknown',
      ...parent === undefined ? {} : { parentSession: parent },
    })
  }
  return { status: 'observed', subagents: refs }
}

/** 一个已被枚举的会话的父会话 id（顶层会话缺席）。 */
export function parentSessionOf(entry: unknown): string | undefined {
  const header = (entry as { session?: { header?: { parentSession?: unknown } } })?.session?.header
  const parent = header?.parentSession
  return typeof parent === 'string' && parent !== '' ? parent : undefined
}

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
export function liveRefsOf(ctx: Context): readonly LiveSessionRef[] {
  const projection = liveSessionRefs(ctx)
  if (projection.status !== 'observed') return []
  return projection.subagents.map((sub) => sub.parentSession === undefined
    ? { id: sub.id }
    : { id: sub.id, parentSession: sub.parentSession })
}

/** 把一个 team 记录折成本模块要的那两格身份面（**只读**；口径与 `state.ts` 的同名助手一致）。 */
export function identityOfTeam(team: TeamState): TeamIdentity {
  return {
    captainSessionId: team.captainSessionId,
    memberIds: team.members.filter((member) => member.status !== 'removed').map((member) => member.id),
  }
}

/** 一个已被枚举的会话自己的 id（读不到 ⇒ `undefined`，由调用方决定怎么报）。 */
function agentIdOf(entry: unknown): string | undefined {
  const id = (entry as { id?: unknown })?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

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
  readonly byMember: ReadonlyMap<string, readonly LiveSubagent[]>
  /** 父会话定不下来的活会话。★ 如实交出去，不丢、不硬塞。 */
  readonly unattributed: readonly LiveSubagent[]
}

/**
 * 归组算法。★ 顺序无关、不重排（调用方交进来的顺序就是它读得出的顺序）。
 *
 * ★ 一个父会话 id **只**在它真的是本队成员时才算归属 —— 这就是"随意归属"的
 *   唯一防线（`memberIds` 是那张白名单，且它来自**持久记录**，不是猜的）。
 */
export function attributeSubagents(
  refs: readonly LiveSubagent[],
  memberIds: readonly string[],
): SubagentAttribution {
  const members = new Set(memberIds.filter((id) => id !== ''))
  const byMember = new Map<string, LiveSubagent[]>()
  for (const id of members) byMember.set(id, [])
  const unattributed: LiveSubagent[] = []
  for (const ref of refs) {
    /**
     * ── ★★ 「它自己是成员」不是「一个定不下父的子代理」────────────────────────────
     *
     * MEASURED（本任务自己的臂当场撞上）：把一个**顶层的成员会话**（没有
     * `parentSession`）也丢进 `unattributed`，会让那一格报出 `m1` 这样的成员名 ——
     * 而读的人会以为"有一个外来子代理叫 m1"。它其实是**这张名单上的人**。
     *
     * ⇒ 成员自己**从 `unattributed` 里排除**：`unattributed` 的语义是
     *   「**子代理**，而它的父定不下来」，而一个成员不是它自己的子代理。
     * ★ 这**不是**把它丢掉：它已经作为 `members[]` 的一行被交出去了。
     */
    if (members.has(ref.id)) continue
    /**
     * ★ 子代理**自己也是**一个成员会话时（成员委派成员）不能被算成自己的子代理：
     *   父必须**不是**它自己。否则一个自环会把一个成员画在它自己底下。
     */
    const parent = ref.parentSession
    if (parent === undefined || parent === ref.id || !members.has(parent)) {
      unattributed.push(ref)
      continue
    }
    byMember.get(parent)?.push(ref)
  }
  return { byMember, unattributed }
}

/**
 * 一个成员底下的子代理读数 —— **面板要的那一格**。
 *
 * @param ctx - 插件上下文（注入 `agents`），只用它的**读**入口。
 * @param memberId - 那个成员的会话 id（`''` ⇒ 它根本没起来 ⇒ 确定没有子代理）。
 * @param attribution - {@link attributeSubagents} 的结果（由调用方算一次、全员共用）。
 * @returns 三态读数。★ `subagents: []` 是"读了，真的没有"，与 `could-not-measure` 不同形。
 */
export function memberSubagents(
  ctx: Context,
  memberId: string,
  attribution: SubagentAttribution | undefined,
  projectionReason?: string,
): MemberSubagents {
  /**
   * ★ 成员**没有会话 id** ⇒ "它没起来过"是一条**可判定的事实**：
   *   一个没有会话的东西不可能有活着的子代理 ⇒ 空数组，**不是** could-not-measure。
   *   （与 `memberLiveness` 的 `never-spawned` 同一条口径。）
   */
  if (memberId === '') return { status: 'observed', subagents: [] }
  /**
   * ★★ 归组读数**缺席** ⇒ 那是因为上层没能枚举（`liveSessionRefs` 报了
   *   `could-not-measure`）⇒ 这里如实转报，**绝不**圆成空数组。
   *   `attribution === undefined` 与"这个成员名下一个都没有"是两件事。
   *
   * ★★ 而**成因要原样传下去**（MEASURED：本任务自己的臂当场抓到）——
   *   固定回一句 `AGENT_ENUMERATION_UNAVAILABLE` 会把"枚举抛错了（registry
   *   exploded）"改写成"宿主没有枚举入口"，那是**两份不同的诊断**，
   *   而它们的补救动作完全不同（一个去查那个抛错的注册表，一个去看宿主版本）。
   *   ⇒ 调用方把上游的 `reason` 交进来，这里透传。
   */
  if (attribution === undefined) {
    return {
      status: 'could-not-measure',
      subagents: [],
      reason: projectionReason ?? AGENT_ENUMERATION_UNAVAILABLE,
    }
  }
  return { status: 'observed', subagents: attribution.byMember.get(memberId) ?? [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// `shape: 'dispatch'` 的**执行判据**：这个成员到底派过几个临时 worker
// ─────────────────────────────────────────────────────────────────────────────

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
export type MemberDispatchReadout =
  | {
    readonly status: 'read'
    /** 累计派出过的 worker 数（`subagent/catalog` 事件条数）。 */
    readonly dispatched: number
    /**
     * ★ 形状坏掉的 catalog 条数（有 `subagent/catalog` 而 `childId` 读不出）。
     *   它**不在** `dispatched` 里，但也不被静默丢掉 —— 于是
     *   "读到 3 个 + 2 条读不出"与"读到 5 个"不同形。
     */
    readonly unreadableEvents: number
    /** 最近一次派出的 worker；没派过 ⇒ 缺席（**不是**编一个空对象）。 */
    readonly latest?: { readonly childId: string; readonly createdAt?: number; readonly label?: string }
  }
  /** 成员的会话读不到 ⇒ 判不了。★ 与"一个都没派"不同形。 */
  | { readonly status: 'unmeasured'; readonly reason: string }
  /** 成员还没有会话 id（没起来过）⇒ 它不可能派过。★ 与上面两者不同形。 */
  | { readonly status: 'not-started' }

/** 读不出会话事件时的成因（诊断面，不改变裁决）。 */
export const DISPATCH_EVENTS_UNREADABLE = 'this member carries no readable session event log, so how many temporary workers it dispatched cannot be counted'

/**
 * 从**一个成员自己的会话事件**里数出它派出过几个 sub-agent。
 *
 * ★ 纯函数：不碰 `ctx`、不做 I/O。I/O 由调用方做（与 `attributeSubagents` /
 *   `summariseExecutions` 同一条纪律）。
 *
 * ★ `undefined` 与 `[]` 必须不同形：前者是"读不到日志"（`unmeasured`），
 *   后者是"读到了，确实一条 catalog 都没有"（`read` + `dispatched: 0`）。
 */
export function dispatchReadoutOf(events: readonly unknown[] | undefined): MemberDispatchReadout {
  if (events === undefined) return { status: 'unmeasured', reason: DISPATCH_EVENTS_UNREADABLE }
  const dispatched: Array<{ childId: string; createdAt?: number; label?: string }> = []
  let unreadableEvents = 0
  for (const raw of events) {
    const event = raw as { type?: unknown; data?: unknown } | null
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'subagent/catalog') continue
    const data = event.data as { childId?: unknown; childCreatedAt?: unknown; label?: unknown } | null
    const childId = typeof data?.childId === 'string' ? data.childId.trim() : ''
    /**
     * ★ 缺 `childId` 的 catalog **不算派出**，但**要计数** ——
     *   否则"一个坏事件把总数少算 1"与"它本来就少派了一个"同形。
     */
    if (childId === '') {
      unreadableEvents += 1
      continue
    }
    const createdAt = typeof data?.childCreatedAt === 'number' && Number.isFinite(data.childCreatedAt)
      ? data.childCreatedAt
      : undefined
    const label = typeof data?.label === 'string' && data.label.trim() !== '' ? data.label.trim() : undefined
    dispatched.push({ childId, ...createdAt === undefined ? {} : { createdAt }, ...label === undefined ? {} : { label } })
  }
  const latest = dispatched[dispatched.length - 1]
  return {
    status: 'read',
    dispatched: dispatched.length,
    unreadableEvents,
    ...latest === undefined ? {} : { latest },
  }
}

/**
 * 读一个成员的**派工读数**（`shape` 的执行判据的输入面）。
 *
 * ★ I/O 在这里、判断在 {@link dispatchReadoutOf}：与 `memberLiveness` /
 *   `memberSubagents` 同一分工。★ 读会话事件走的是 `sessionOwnEvents` ——
 *   与 `observedChangedPaths` / `observedSpoke` 同一个入口（不是新造的读法）。
 */
export function memberDispatchReadout(ctx: Context, member: { readonly id: string }): MemberDispatchReadout {
  /**
   * ★ `id === ''` 是**可判定的事实**（"它没起来过"）：一个没有会话的东西
   *   不可能派过 worker ⇒ `not-started`，与 `could-not-measure` 不同形。
   */
  if (member.id === '') return { status: 'not-started' }
  const live = liveAgentOf(ctx, member.id)
  if (live === undefined) return { status: 'unmeasured', reason: DISPATCH_EVENTS_UNREADABLE }
  let events: readonly unknown[]
  try {
    events = sessionOwnEvents(live.session) as readonly unknown[]
  } catch (error: unknown) {
    return { status: 'unmeasured', reason: `${DISPATCH_EVENTS_UNREADABLE}: ${String(error)}` }
  }
  if (!Array.isArray(events)) return { status: 'unmeasured', reason: DISPATCH_EVENTS_UNREADABLE }
  return dispatchReadoutOf(events)
}

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
  readonly name: string
  /** 它名下跑到过终态的任务数（= 它**确实干过活**的可判定证据）。 */
  readonly executedTasks: number
  /** 派工读数（三态之一，见 {@link MemberDispatchReadout}）。 */
  readonly dispatch: MemberDispatchReadout
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
export function memberDispatchRows(
  members: readonly Pick<TeamMember, 'name' | 'status'>[],
  tasks: readonly Pick<TeamTask, 'assignee' | 'status'>[],
  readoutOf: (name: string) => MemberDispatchReadout,
): MemberDispatchRow[] {
  return members
    .filter((member) => member.status !== 'removed')
    .map((member) => ({
      name: member.name,
      executedTasks: tasks.filter((task) => task.assignee === member.name && TERMINAL_TASK_STATUSES.includes(task.status)).length,
      dispatch: readoutOf(member.name),
    }))
}

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
export type ShapeExecutionReadout =
  | { readonly status: 'not-applicable'; readonly reason: string }
  | {
    readonly status: 'measured'
    /** 干过活却一个临时 worker 都没派的成员名（**空数组 = 读了、确实没有违规**）。 */
    readonly violations: readonly string[]
    /** 参与判定的成员行（读的人要能复核每一行，而不是只读一个结论）。 */
    readonly rows: readonly MemberDispatchRow[]
  }
  | { readonly status: 'unmeasured'; readonly reason: string; readonly rows: readonly MemberDispatchRow[] }

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
export function shapeExecutionFor(ctx: Context, team: TeamState): ShapeExecutionReadout {
  if (team.shape !== 'dispatch') return shapeExecutionOf(team.shape, [])
  const rows = memberDispatchRows(
    team.members,
    team.tasks,
    (name) => {
      const member = team.members.find((candidate) => candidate.name === name)
      return member === undefined
        ? { status: 'unmeasured', reason: `no roster row for "${name}"` }
        : memberDispatchReadout(ctx, member)
    },
  )
  return shapeExecutionOf(team.shape, rows)
}

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
export function describeTeamShape(
  shape: TeamState['shape'] | undefined,
  execution: ShapeExecutionReadout,
): string {
  const declaration = shape === 'dispatch'
    ? 'this team declared shape "dispatch" (each task is meant to run in a temporary worker)'
    : shape === 'flat'
      ? 'this team declared shape "flat" (its members do the work themselves)'
      : 'this team carries no shape declaration (created before the shape field existed), so its intended form is undecidable'
  /**
   * ★ `not-applicable` 的两支成因**已经在 `declaration` 那一句里说完了**（flat / 缺声明），
   *   再拼一遍 `reason` 会让同一句话读两遍（实测抓到的）。⇒ 这里只补一句"所以没有可查的"。
   */
  if (execution.status === 'not-applicable') return `${declaration} — so there is no dispatch claim to check against.`
  if (execution.status === 'unmeasured') {
    return `${declaration} — ★ but whether it is actually running that way could not be measured: ${execution.reason}.`
  }
  if (execution.violations.length === 0) {
    const checked = execution.rows.filter((row) => row.executedTasks > 0).length
    return checked === 0
      ? `${declaration} — no member has finished a task yet, so there is nothing to check against it.`
      : `${declaration} — held: all ${checked} member(s) that finished tasks also spawned temporary workers.`
  }
  return `${declaration} — ★★ NOT held: ${execution.violations.join(', ')} finished task(s) but spawned no temporary worker at all, so this team is doing the work itself while claiming the dispatch form.`
}

export function shapeExecutionOf(
  shape: TeamState['shape'] | undefined,
  rows: readonly MemberDispatchRow[],
): ShapeExecutionReadout {
  if (shape !== 'dispatch') {
    return {
      status: 'not-applicable',
      reason: shape === 'flat'
        ? 'this team declared shape "flat", so its members are expected to do the work themselves'
        : 'this team carries no shape declaration (older team), so "each task runs in a temporary worker" was never claimed about it',
    }
  }
  /**
   * ★ 有任何一行的派工**读不出来** ⇒ 整份读数 `unmeasured`。
   *   理由与 `delivery.coverage` 的那条一致：一个"我没能读它"的成员如果被跳过，
   *   那么"形态被执行了"这句话就包括了**没被检查过的人** —— 而它读起来完全正常。
   */
  const unreadable = rows.filter((row) => row.executedTasks > 0 && row.dispatch.status === 'unmeasured')
  if (unreadable.length > 0) {
    return {
      status: 'unmeasured',
      rows,
      reason: `the dispatch history of ${unreadable.map((row) => row.name).join(', ')} could not be read (${unreadable.map((row) => (row.dispatch as { reason?: string }).reason ?? 'no reason given').join('; ')}), so whether this dispatch team actually dispatched cannot be decided`,
    }
  }
  const violations = rows
    .filter((row) => row.executedTasks > 0 && row.dispatch.status === 'read' && row.dispatch.dispatched === 0)
    .map((row) => row.name)
  return { status: 'measured', violations, rows }
}

// ─────────────────────────────────────────────────────────────────────────────
// 会话预算读数（2026-10-20，补 t4）：这个成员的会话**还能不能干活**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 它补的是什么（MEASURED：插件推荐的动作必然失败）──────────────────────────
 *
 * 三段事实链（全部已核实）：
 *
 *   ① 成员一旦 spawn 过，会话**永不重建**。`src/tools.ts` 逐字：
 *      「已生成会话的成员**永远不会再跑** `spawnMember`」
 *   ② 下发路径是 `if (member.id !== '') return deliverToMember(...)`
 *      ⇒ 直接投递到那个**旧会话**
 *   ③ `src/tools/reassign.ts` 里**没有** `startMember`
 *
 * ⇒ ★ **一个已经烧穿上下文的成员被重派时，新任务进的是同一个已死的会话。**
 *   而本仓缺陷文档（`docs/DEFECT-VERIFY-RERUN-WRONG-CWD.md`）还推荐
 *   「reassign it or retry when ready」—— **插件推荐的动作必然失败**。
 *
 * 对照（真实发生）：`self-iteration-3` 三个成员**全部** `CONTEXT_WINDOW_EXCEEDED`
 *   （101.9 / 102.5 / 103.1 万 token）。
 *
 * ── ★★ 一个已记账的坑：Node 的 zstd 只解第一帧 ─────────────────────────────────
 *
 * `session.v4.jsonl.zstd` 是**多帧追加**的，而 Node 的 `zstdDecompressSync`
 * **静默只解第一帧**（不抛、不警告）。实测（本仓真实会话）：
 *
 *```
 *   Node 内建   ⇒ 290 字节 / 1 行
 *   zstd -dc    ⇒ 2,984,651 字节 / 1701 行      ← 差 1700 倍
 *```
 * ⇒ ★ 一个用它写的 token 计数器会得到**看起来像真的**的错数。
 *   本模块**复用** `scripts/dispatch-shape-readout.mjs` 的 `splitZstdFrames`
 *   （本仓唯一正确的实现，逐字节与 `zstd -dc` 对齐），而不是再写一遍 ——
 *   ★ 我为了这件事**真的重复实现过**一次，而它错了两次（见那个 export 的注释）。
 *
 * ── 三态，且**读不到不许写成 0** ──────────────────────────────────────────────
 *
 *   `read`       —— 读到了；`totalTokens` 是**累计**消耗（含缓存重读）
 *   `unmeasured` —— 会话读不出来（文件不在 / 帧遍历失败 / 没有可解析的记录）
 *   `not-started` —— 这个成员还没有会话 id ⇒ **它不可能有消耗**
 *
 * ★★ 而 `unmeasured` 与"消耗是 0"**绝不同形**：前者要人去查为什么读不到，
 *   后者是一个关于这个成员的结论。本仓记了十几次的那条合流。
 */
export type SessionBudgetReadout =
  | {
    readonly status: 'read'
    /** **累计**消耗（`Σ totalTokens`，含 cacheRead）—— ★ 不是当前窗口占用量。 */
    readonly totalTokens: number
    /** 见过的**最大单次 inputTokens** —— 那才接近"当前窗口占用了多少"。 */
    readonly peakInputTokens: number
    /** assistant 记录数（token 读数的分母：缺一条就是下界）。 */
    readonly steps: number
  }
  | { readonly status: 'unmeasured'; readonly reason: string }
  | { readonly status: 'not-started' }

/** 读不出会话时的成因（诊断面，不改变裁决）。 */
export const SESSION_BUDGET_UNREADABLE = 'this member\'s session log could not be read, so how much context it has already spent cannot be counted'

/**
 * ── ★ 窗口大小从哪来：**读不到就说"只报用量、不报剩余"** ────────────────────────
 *
 * ★ 刻意**不**硬编码一个 1,000,000：那个数取决于模型与部署，而写死它会让
 *   换模型之后这条判据**静默地**按错的窗口判（太宽松 = 不拦，太严 = 误拦）。
 *   ★ 本仓先例：`src/evaluator/effect.ts` 的 `GUESSED_MIN_OBSERVATION_MS`
 *     把它"是猜测"写进了名字里。这里更进一步：**拿不到就不报比例**。
 *
 * @returns 窗口上限；`undefined` ⇒ 调用方**只报用量**，不报"还剩多少"。
 */
/**
 * 读一个成员的**会话预算**（I/O 那一半）。
 *
 * ★ 数据源：`~/.dsh/sessions/<slug>/<sessionId>/session.v4.jsonl.zstd`。
 *   `slug` 是 cwd 的编码形式（`--Users-abab-Desktop-agent-teams-dev--`）——
 *   与 `scripts/dispatch-shape-readout.mjs` 的 `projectSlugFor` **同一口径**。
 *
 * ★★ 帧遍历用 `splitZstdFrames`（`harness-compat.ts`，本仓唯一正确的实现）——
 *   **不用** `zstdDecompressSync`：它静默只解第一帧（实测 1 行 vs 1701 行）。
 *
 * @param sessionId - 成员会话 id（`''` ⇒ `not-started`）。
 * @param workspace - 用来推会话目录（slug 由它编码而来）。
 */
export async function memberSessionBudget(
  sessionId: string,
  workspace: string,
): Promise<SessionBudgetReadout> {
  /**
   * ★ `id === ''` 是**可判定的事实**（"它没起来过"）⇒ 它不可能有消耗。
   *   与 `could-not-measure` 不同形（同 `memberLiveness` 的 `never-spawned` 口径）。
   */
  if (sessionId === '') return { status: 'not-started' }
  const slug = `--${workspace.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  const file = join(homedir(), '.dsh', 'sessions', slug, sessionId, 'session.v4.jsonl.zstd')
  let buffer: Buffer
  try {
    buffer = await readFile(file)
  } catch (error: unknown) {
    return { status: 'unmeasured', reason: `${SESSION_BUDGET_UNREADABLE}: ${String((error as { message?: unknown })?.message ?? error)}` }
  }
  let frames: Buffer[]
  try {
    frames = splitZstdFrames(buffer).frames
  } catch (error: unknown) {
    return { status: 'unmeasured', reason: `${SESSION_BUDGET_UNREADABLE}: frame walk failed: ${String((error as { message?: unknown })?.message ?? error)}` }
  }
  if (frames.length === 0) {
    return { status: 'unmeasured', reason: `${SESSION_BUDGET_UNREADABLE}: the session file contains no complete zstd frame` }
  }
  let text = ''
  for (const frame of frames) {
    try { text += zstdDecompressSync(frame).toString('utf8') } catch { /* 单帧失败 ⇒ 读数是下界，不掀翻整份 */ }
  }
  /**
   * ── 口径与 `scripts/dispatch-shape-readout.mjs` **逐字相同** ────────────────────
   *   `assistant/message` 的 `data.usage.totalTokens`（= in + out + cacheRead）
   *   ⇒ 它算的是**累计消耗**；而 `peakInputTokens` 才是"当前窗口占用"的近似。
   */
  let totalTokens = 0
  let peakInputTokens = 0
  let steps = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let record: { type?: unknown; data?: { usage?: { totalTokens?: unknown; inputTokens?: unknown } } }
    try { record = JSON.parse(line) } catch { continue }
    if (record.type !== 'assistant/message') continue
    const usage = record.data?.usage
    if (usage === undefined || typeof usage.totalTokens !== 'number') continue
    steps += 1
    totalTokens += usage.totalTokens
    if (typeof usage.inputTokens === 'number') peakInputTokens = Math.max(peakInputTokens, usage.inputTokens)
  }
  /**
   * ★ 一条 assistant 记录都没有 ⇒ **没能测量**（不是"消耗是 0"）——
   *   那正是本仓最贵的那条纪律，这里再钉一次。
   */
  if (steps === 0) {
    return { status: 'unmeasured', reason: `${SESSION_BUDGET_UNREADABLE}: no assistant/message record with usage was found in ${frames.length} frame(s)` }
  }
  return { status: 'read', totalTokens, peakInputTokens, steps }
}

/**
 * ── ★ 阈值（多少比例算"满了"）—— 与窗口同一纪律：**可注入的常量，不是魔法数** ──────
 *
 * ★ 0.85 是一个**选择**，不是测量：留 15% 给"这一轮任务的输入 + 输出"。
 *   ★★ 它与 `runtime.stall` 的 N 同一个形状 —— 一个写死的阈值在别的部署上
 *     要么永远不响、要么吵个不停，而**两种都读不出来**。
 *   ⇒ 环境变量可覆盖（`AGENT_TEAMS_SESSION_BUDGET_THRESHOLD`）。
 */
export const GUESSED_SESSION_BUDGET_THRESHOLD = 0.85

/** 从环境读阈值（缺省 ⇒ `GUESSED_SESSION_BUDGET_THRESHOLD`）。 */
export function sessionBudgetThresholdOf(
  env: { readonly AGENT_TEAMS_SESSION_BUDGET_THRESHOLD?: string } = process.env as never,
): number {
  const raw = (env as Record<string, string | undefined>)['AGENT_TEAMS_SESSION_BUDGET_THRESHOLD']
  if (raw === undefined || raw.trim() === '') return GUESSED_SESSION_BUDGET_THRESHOLD
  const value = Number.parseFloat(raw.trim())
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : GUESSED_SESSION_BUDGET_THRESHOLD
}

export function contextWindowOf(env: { readonly AGENT_TEAMS_CONTEXT_WINDOW?: string } = process.env as never): number | undefined {
  const raw = (env as Record<string, string | undefined>)['AGENT_TEAMS_CONTEXT_WINDOW']
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 会话预算的**判定**（纯函数）：这个成员还能不能接新活。
 *
 * ★ 纯函数：`totalTokens` / `window` 都由调用方给（与 `testFileBaselineOf` 同一条纪律）。
 *
 * ── 三态，且 `unknown` **不并进** `ok` ────────────────────────────────────────
 *
 *   `ok`      —— 读到了用量，且（若知道窗口）在阈值以内
 *   `full`    —— 读到了用量，且**已知**超过阈值 ⇒ 调用方**拒绝**下发
 *   `unknown` —— 读不到用量，或**不知道窗口** ⇒ ★ 不拒绝，但**留痕**
 *
 * ★★ 为什么 `unknown` 不拒绝：先软后硬 —— 本仓那条纪律是"新机制先别误伤"。
 *   而它**必须留痕**：一个静默放行的 unknown 与 ok 同形，
 *   那正是 t4 要防的东西（"重派必然撞死"之所以能一直发生，就是因为没有读数）。
 */
export type SessionBudgetVerdict = 'ok' | 'full' | 'unknown'

export interface SessionBudgetJudgement {
  readonly verdict: SessionBudgetVerdict
  /** 人话成因（`full` / `unknown` 时在场）。 */
  readonly why?: string
  /** 用量占窗口的比例（**只有**两样都知道时才有 —— 缺席不是 0）。 */
  readonly ratio?: number
}

/**
 * 判一个成员的会话**还能不能接新活**。
 *
 * @param readout - 会话预算读数（三态）。
 * @param window - 窗口上限；`undefined` ⇒ 不知道 ⇒ `unknown`（**不**猜一个数）。
 * @param threshold - 比例阈值（0–1）。★ 它是**可注入的**，理由同
 *   `runtime.stall` 的 N：一个写死的阈值在别的部署上要么永远不响、要么吵个不停，
 *   而两种都读不出来。
 */
export function judgeSessionBudget(
  readout: SessionBudgetReadout,
  window: number | undefined,
  threshold: number,
): SessionBudgetJudgement {
  if (readout.status === 'not-started') {
    return { verdict: 'ok' }
  }
  if (readout.status === 'unmeasured') {
    return {
      verdict: 'unknown',
      why: `the session budget could not be measured (${readout.reason}), so whether this member can take more work is not known`,
    }
  }
  /**
   * ★ 用 `peakInputTokens` 而不是 `totalTokens` 比阈值：
   *   `totalTokens` 是**累计**消耗（含缓存重读），它早就超过窗口了（实测队长 4 亿），
   *   而**窗口**限制的是**单次请求的 input**。
   *   ★★ 拿累计量去比阈值会把每一个跑过几轮的成员都判成"满了" —— 那是一条**恒真**的判据。
   */
  if (window === undefined) {
    return {
      verdict: 'unknown',
      why: `this member has spent ${readout.peakInputTokens} input tokens at its peak, but the context window size is not configured (set AGENT_TEAMS_CONTEXT_WINDOW), so whether it still fits cannot be decided`,
    }
  }
  const ratio = readout.peakInputTokens / window
  if (ratio >= threshold) {
    return {
      verdict: 'full',
      why: `this member's session has already reached ${readout.peakInputTokens} input tokens at its peak, which is ${(ratio * 100).toFixed(1)}% of the ${window}-token window (threshold ${(threshold * 100).toFixed(0)}%) — a member's session is never recreated, so new work would be delivered into a session that is already this full`,
      ratio,
    }
  }
  return { verdict: 'ok', ratio }
}
