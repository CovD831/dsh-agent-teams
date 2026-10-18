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
import { guardSubagentCreation, guardSubagentDelivery, installContinuableMemberSetup, memberToolFilter, queueMemberPrompt, restrictableToolNames, startMember, startMemberWithLenientFilter, steerMemberPrompt, sessionOwnEvents, usesManagedActivations, type MemberStartSpec, type MemberToolFilter } from './harness-compat.ts'
import { markMailboxDelivered, appendMailbox, CAPTAIN_KEY, createMessage, readRetiredMemberIds, readTeamSync, readTeam, releaseMailboxDelivery, withTeamLock, writeTeam } from './state.ts'
import { mailboxPrompt } from './mailbox.ts'
import { appendTeamEvent, captainSessionOf, liveAgentOf } from './events.ts'
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
  const registry = (ctx as unknown as { agents?: { list?: () => readonly unknown[] } }).agents
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
