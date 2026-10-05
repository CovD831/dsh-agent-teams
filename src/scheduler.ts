/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when this process has not observed the durable owner settle its open attempt.
 * @module dsh-agent-teams/scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { deliverToMember } from './members.ts'
import { isCurrentMail, mailboxPrompt } from './mailbox.ts'
import { createTaskWorktree, worktreePromptLine } from './worktree.ts'
import {
  markMailboxDelivered,
  discardMailboxMessages,
  beginTaskAttempt,
  CAPTAIN_KEY,
  claimMailboxDelivery,
  findTeamByParticipant,
  invalidateTaskAttempt,
  readTeam,
  readPendingMailbox,
  releaseMailboxDelivery,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

/** Per-dependency output cap in the assignment prompt. */
export const DEPENDENCY_OUTPUT_MAX_CHARS = 2_000
/** Combined dependency-output budget in the assignment prompt. */
export const DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS = 12_000

export interface SchedulerConfig {
  readonly stateDir: string
  readonly executionPrompt?: string
  readonly dispatch?: (captain: Agent, teamId: string, memberName: string, text: string, signal: AbortSignal, mode: 'queue' | 'steer', attemptId?: string) => Promise<boolean>
  /**
   * 建出隔离检出时报告它的基准版本（`worktree.base`）。
   *
   * ★ 这是 R5 / 回测唯一的父版本来源。判据层在成员【汇报完成】时需要它，
   *   而那时派发已经结束 ⇒ 由调用方在这里记下来。
   *   不回调 ⇒ 判据说"我没能测量"（诚实），**不会**拿一个猜的版本去比较。
   */
  readonly onWorktree?: (taskId: string, base: string) => void
  /**
   * ── ★ runtime 位置的接线点：一个成员【真的被派发出去】了 ─────────────────────
   *
   * 契约 `docs/GATE-REGISTRY.md` §5 给 `runtime` 写的例子正是这一条：
   * 「在成员被派发时启动 / 超时 ⇒ 产生一条记录 / 它不直接拒任务」。所以本回调
   * **只能记录**：调度器不读它的返回值，也没有可读的返回值 ⇒ 过程约束无法
   * 拒绝派发（§5 硬要求）。
   *
   * ★ 时机：投递【被接受之后】才回调。投递失败会走下面那条回滚路径（任务回
   *   pending、成员回 idle），那一次不是"派发过"；把失败也记成一次派发，会让
   *   运行判据读到一个从未发生的事件。
   */
  readonly onDispatched?: (event: {
    readonly taskId: string
    readonly memberName: string
    readonly memberId: string
    readonly attempt: number
    readonly attemptId: string
    readonly kind: string
    readonly worktreePath?: string
    readonly worktreeUnavailable?: string
  }) => void
}

export interface TeamScheduler {
  /** Try to give every genuinely idle/ready member one unit of ready work. */
  kickTeam(workspace: string, teamId: string, captain?: Agent): Promise<void>
  /** Try to flush fallback mail or give one member one ready task. */
  kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent): Promise<void>
}

/** One completed recursive dependency shown to the assignee. */
export interface DependencyOutput {
  readonly id: string
  readonly subject: string
  readonly profileSeedId?: string
  readonly output?: string
}

export interface DispatchTicket {
  readonly taskId: string
  readonly memberName: string
  readonly memberId: string
  readonly attempt: number
  readonly attemptId: string
  readonly previousAssignee?: string
  /** True when this ticket rotates an unobserved durable open attempt. */
  readonly recoveredOwned: boolean
  /** Original task generation, used to restore a failed automatic recovery. */
  readonly previousStatus?: 'claimed' | 'in_progress'
  readonly previousAttempt?: number
  readonly previousAttemptId?: string
  readonly previousResult?: Pick<TeamTask, 'output' | 'verdict' | 'findings' | 'changedPaths' | 'acceptanceResults' | 'commandsRun'>
  readonly subject: string
  readonly description?: string
  readonly teamDescription?: string
  readonly profileProtocol?: string
  readonly profileSeedId?: string
  readonly dependencyOutputs: readonly DependencyOutput[]
  readonly executionPrompt?: string
  readonly kind?: string
  readonly round?: number
  readonly objective?: string
  readonly inScope?: readonly string[]
  readonly outOfScope?: readonly string[]
  readonly acceptance?: readonly string[]
  readonly verify?: readonly string[]
  readonly reviewedTaskId?: string
  /**
   * ★ 该任务的隔离工作目录（worktree 的绝对路径）。
   *   缺席 ⇒ 没有隔离 ⇒ 提示里【不】产出伪造的工作目录指令。
   */
  readonly worktreePath?: string
  /** 该 worktree 里缺失的 gitignore 条目（如 node_modules）—— 必须告诉成员。 */
  readonly worktreeMissingIgnored?: readonly string[]
  /**
   * ── ★【未隔离】这件事本身要留下痕迹 ──────────────────────────────────────────
   *
   * 降级派发（非 git 仓库）时带着它。理由：一次 `logger.warn` 不是一条记录 ——
   * 它随进程消失，而"这个任务是在没有隔离的地方做的"是一个【关于这份工作的
   * 事实】，读日志的人（以及依赖父版本的判据）必须能看见它。
   *
   * ★ 它与 `worktreePath === undefined` 必须【不同形】：
   *   `worktreeUnavailable` 有值 ⇒ 问过 git 了，这个仓库【不支持】隔离 ⇒ 成员
   *     应当知道，且 R5/变异那类判据会因此 unmeasured；
   *   两者都缺席 ⇒ 这个任务【本来就不需要】隔离（review/requirements 这类只读任务）。
   *   把这两件事混起来，一次"环境不支持"就会伪装成"这一步不需要"。
   */
  readonly worktreeUnavailable?: string
}

function taskProfileSeedId(task: TeamTask): string | undefined {
  const seed = task.profileSeedId?.trim()
  return seed === undefined || seed === '' ? undefined : seed
}

function teamProfileProtocol(team: TeamState): string | undefined {
  return team.profile?.protocol
}

/**
 * Recursively collect `status=completed` ancestors of `taskId` in topological
 * order (dependencies before dependents). Cycles stop that branch only.
 */
export function collectCompletedDependencyOutputs(
  tasks: readonly TeamTask[],
  taskId: string,
  warn?: (message: string) => void,
): DependencyOutput[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: TeamTask[] = []

  const walk = (id: string): void => {
    if (visiting.has(id)) {
      warn?.(`agent-teams: dependency cycle involving "${id}" while collecting outputs; stopping this branch`)
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    const task = byId.get(id)
    if (task !== undefined) {
      for (const dependency of task.dependencies) walk(dependency)
      if (id !== taskId) ordered.push(task)
    }
    visiting.delete(id)
    visited.add(id)
  }

  walk(taskId)
  return ordered
    .filter(task => task.status === 'completed')
    .map((task) => {
      const profileSeedId = taskProfileSeedId(task)
      return {
        id: task.id,
        subject: task.subject,
        ...profileSeedId === undefined ? {} : { profileSeedId },
        ...task.output === undefined ? {} : { output: task.output },
      }
    })
}

/** Format completed-dependency outputs with per-item and total truncation. */
export function formatDependencyOutputs(items: readonly DependencyOutput[]): string {
  if (items.length === 0) return '(none)'
  const formatted = items.map((item) => {
    const seed = item.profileSeedId === undefined ? '' : ` [${item.profileSeedId}]`
    const raw = item.output === undefined || item.output === ''
      ? '(no output recorded)'
      : item.output
    const truncated = raw.length > DEPENDENCY_OUTPUT_MAX_CHARS
    const body = truncated ? `${raw.slice(0, DEPENDENCY_OUTPUT_MAX_CHARS)} [truncated]` : raw
    return `- ${item.id}${seed} ${item.subject}:\n  ${body}`
  })
  let selected = formatted
  while (selected.length > 1 && selected.join('\n').length > DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS) {
    selected = selected.slice(1)
  }
  const last = selected[0]
  if (selected.length === 1 && last !== undefined && last.length > DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS) {
    selected = [`${last.slice(0, DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS)} [truncated]`]
  }
  return selected.join('\n')
}

function stateRootOf(workspace: string, config: SchedulerConfig): string {
  return join(workspace, config.stateDir)
}

function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

function liveCaptain(ctx: Context, captainSessionId: string, supplied?: Agent): Agent | undefined {
  if (supplied !== undefined && supplied.id === captainSessionId) return supplied
  return ctx.agents.get(captainSessionId as SessionId)
}

function liveMember(ctx: Context, member: TeamMember): Agent | undefined {
  return ctx.agents.get(member.id as SessionId)
}

function isMemberAvailable(ctx: Context, member: TeamMember): boolean {
  if (member.stopping === true) return false
  const live = liveMember(ctx, member)
  return live === undefined || live.status === 'idle'
}

function ownedOpenTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  return tasks.find(task => task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

function nextReadyTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  const ready = tasks.filter(task => task.status === 'pending'
    && task.reassigning !== true
    && unsatisfiedDependencies([...tasks], task.dependencies).length === 0)
  return ready.find(task => task.assignee === memberName)
    ?? ready.find(task => task.assignee === undefined)
}

export function assignmentPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string {
  const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`
  const seed = ticket.profileSeedId === undefined ? '' : ` [${ticket.profileSeedId}]`
  const goal = ticket.teamDescription?.trim() || '(not provided)'
  const protocol = ticket.profileProtocol?.trim() || '(none)'
  const executionPrompt = ticket.executionPrompt?.trim()
  const kind = ticket.kind?.trim() || 'work'
  /**
   * ── ★ 隔离工作目录：告诉成员"在哪干活" ────────────────────────────────────────
   *
   * 子会话的 cwd 硬编码继承父会话（START-HERE §5②），**改不了** ⇒ 隔离只能靠
   * "给一个独立目录 + 在提示里告诉成员"。没有路径时本块为空 ——
   * **绝不产出一个伪造的工作目录指令**（那会让成员以为有隔离，实际没有）。
   *
   * ★ 缺依赖必须明说：worktree 是干净的检出，gitignore 的 `node_modules`
   *   不在里面（实测边界③）。不说 ⇒ 成员跑 `pnpm test` 失败，然后把一次
   *   "环境没准备好"误报成"工作没做出来"——这两件事不同形（契约 §3.4）。
   */
  const worktreeLine = worktreePromptLine(ticket.worktreePath)
  const missingIgnored = ticket.worktreeMissingIgnored ?? []
  const worktreeBlock = worktreeLine === ''
    ? ''
    : `
${worktreeLine}${missingIgnored.length === 0 ? '' : `
Note: ${missingIgnored.join(', ')} exist in the captain's workspace but not in this worktree (they are gitignored, so a clean checkout does not carry them). Install/set them up inside the worktree before running verification commands, or a missing dependency will look like a failing test.`}
`
  /**
   * ── ★ 降级派发时必须【明说】没有隔离 ─────────────────────────────────────────
   *
   * 这里不产出工作目录指令（绝不伪造一个），但也不能沉默：成员会以为自己在一个
   * 隔离的检出里，而实际上它正和全队共用目录。措辞必须让"没隔离"与"不需要隔离"
   * 不同形 —— 前者是环境限制，后者是这一步本来就不涉及写文件。
   */
  const unavailableLine = typeof ticket.worktreeUnavailable === 'string' && ticket.worktreeUnavailable.trim() !== ''
    ? `
No isolated worktree: ${ticket.worktreeUnavailable.trim()}
Work directly in the shared workspace. Work that needs a parent revision (R5 red-then-green, mutation testing) cannot be measured here and will be reported as such rather than as passing.`
    : ''
  const contract = [
    `Kind: ${kind}${ticket.round === undefined ? '' : ` (round ${ticket.round})`}`,
    ticket.objective === undefined || ticket.objective === '' ? '' : `Objective: ${ticket.objective}`,
    ticket.inScope === undefined || ticket.inScope.length === 0 ? '' : `In scope: ${ticket.inScope.join(', ')}`,
    ticket.outOfScope === undefined || ticket.outOfScope.length === 0 ? '' : `Out of scope: ${ticket.outOfScope.join(', ')}`,
    ticket.acceptance === undefined || ticket.acceptance.length === 0 ? '' : `Acceptance: ${ticket.acceptance.join('; ')}`,
    ticket.verify === undefined || ticket.verify.length === 0 ? '' : `Verify: ${ticket.verify.join('; ')}`,
    ticket.reviewedTaskId === undefined ? '' : `Reviewed task: ${ticket.reviewedTaskId}`,
  ].filter((line) => line !== '').join('\n')
  const structuredCompletion = ['implementation', 'repair', 'verification', 'integration'].includes(kind)
    ? `
Structured completion payload (keep these arrays in contract order):
acceptanceResults: ${JSON.stringify((ticket.acceptance ?? []).map((criterion) => ({ criterion, status: 'passed', evidence: '<what proved it>' })))}
commandsRun: ${JSON.stringify((ticket.verify ?? []).map((command) => ({ command, status: 'passed', exitCode: 0, evidence: '<observed result>' })))}
${kind === 'implementation' || kind === 'repair' ? 'changedPaths: list the actual workspace-relative POSIX paths you changed.\n' : ''}`
    : ''
  return `AgentTeams automatic task assignment from the shared task list.

You are executing as configured member "${ticket.memberName}".
Do not start a teammate's assigned task.
${worktreeBlock}${unavailableLine}
Team goal:
${goal}

Profile protocol:
${protocol}
${executionPrompt === undefined || executionPrompt === '' ? '' : `
Execution guidance:
${executionPrompt}
`}
Completed dependency results:
${formatDependencyOutputs(ticket.dependencyOutputs)}

Task: ${ticket.taskId}${seed} — ${ticket.subject}${description}
${contract === '' ? '' : `\nContract:\n${contract}\n`}
${structuredCompletion}
Attempt: ${ticket.attempt}
Attempt id: ${ticket.attemptId}

Call agent_teams_claim_task for ${ticket.taskId}; it will return this same attempt_id. Include attempt_id=${ticket.attemptId} in every agent_teams_update_task call. If it is rejected as stale, stop work because the task was reassigned. claimed cannot jump to completed. Mark in_progress first, then completed or failed. Include attempt_id on every update. Then send_message to captain with source_task_id and source_attempt_id and become idle.
When finishing: use status=completed only when the task's success criteria are satisfied; use status=failed when blocking findings or validation failures mean downstream work must not proceed; include a concise output in either case. Quality kinds must submit structured fields: review/requirements need verdict=pass to complete (needs_revision/reject must fail with findings); implementation/repair/verification/integration need acceptanceResults and commandsRun, while implementation/repair also need in-scope changedPaths. Use status values "passed" or "failed" inside those arrays. After the work and verification finish, call agent_teams_update_task immediately; do not wait for captain confirmation and do not continue exploring. Do not approve your own implementation. Mail is not a formal next review. Completed work must not be repeated to attach late evidence: call update_task on the original task with its attempt_id and acceptanceResults/commandsRun/evidence_note; supplements are append-only and cannot change its verdict. Treat the dependency results above as source material. Do not ignore them. Work only this task and only its in-scope paths in this turn.

State policy: ${stateDir}/${teamId}/ is read-only diagnostics; mutate team state only through agent_teams_* tools.`
}

/** Install one scheduler and its member activity observer. */
export function installTeamScheduler(ctx: Context, config: SchedulerConfig): TeamScheduler {
  const memberQueues = new Map<string, Promise<unknown>>()
  // An idle edge in this process proves that the resident member ended its
  // turn while the current attempt was still open. Remember that capability
  // even after Harness disposes the continuable AgentHandle: later status or
  // graph kicks must keep it parked. A cold process starts with an empty map,
  // so durable open attempts are still recovered after restart.
  const parkedAttempts = new Map<string, string>()

  const memberQueueKey = (stateRoot: string, teamId: string, memberName: string): string => (
    `${stateRoot}\u0000${teamId}\u0000${memberName}`
  )

  const serializeMember = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = memberQueues.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    memberQueues.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (memberQueues.get(key) === tail) memberQueues.delete(key)
    }
  }

  const runtime: TeamScheduler = {
    async kickTeam(workspace, teamId, suppliedCaptain) {
      const stateRoot = stateRootOf(workspace, config)
      const team = await readTeam(stateRoot, teamId)
      if (team === undefined || team.halted === true || team.phase === 'staged') return
      const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
      if (captain === undefined) return
      for (const member of team.members) {
        if (member.status === 'removed') continue
        await runtime.kickMember(workspace, teamId, member.name, captain)
      }
    },

    async kickMember(workspace, teamId, memberName, suppliedCaptain) {
      const stateRoot = stateRootOf(workspace, config)
      const queueKey = memberQueueKey(stateRoot, teamId, memberName)
      await serializeMember(queueKey, async () => {
        let team = await readTeam(stateRoot, teamId)
        if (team === undefined || team.halted === true || team.phase === 'staged') return
        const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
        if (captain === undefined) return
        let member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
        if (member === undefined || !isMemberAvailable(ctx, member)) return

        // A mailbox-only fallback is real pending work. Deliver it before a
        // fresh task and acknowledge only after Harness accepts the follow-up.
        const unread = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined) return []
          const pending = await readPendingMailbox(stateRoot, fresh.id, member!.name)
          await discardMailboxMessages(stateRoot, fresh.id, member!.name, pending.filter(message => !isCurrentMail(fresh, message)).map(message => message.id))
          const current = pending.filter(message => isCurrentMail(fresh, message))
          await claimMailboxDelivery(stateRoot, fresh.id, member!.name, current.map(message => message.id))
          return current
        })
        if (unread.length > 0) {
          const prompt = mailboxPrompt(team.id, member.name, unread)
          const signal = new AbortController().signal
          const accepted = config.dispatch === undefined
            ? await deliverToMember(ctx, captain, member.id, prompt, signal, 'steer')
            : await config.dispatch(captain, team.id, member.name, prompt, signal, 'steer')
          if (accepted) {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              markMailboxDelivered(stateRoot, team!.id, member!.name, unread.map(message => message.id))
            ))
          } else {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              releaseMailboxDelivery(stateRoot, team!.id, member!.name, unread.map(message => message.id))
            ))
          }
          return
        }

        const ticket = await withTeamLock(teamLockKey(stateRoot, team.id), async (): Promise<DispatchTicket | undefined> => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined || fresh.halted === true || fresh.phase === 'staged') return undefined
          const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
          if (currentMember === undefined || !isMemberAvailable(ctx, currentMember)) return undefined
          const owned = ownedOpenTask(fresh.tasks, currentMember.name)
          // An idle edge observed by this scheduler parks the exact open
          // capability. Harness may dispose its AgentHandle after settlement,
          // so registry absence is not evidence that the owner was lost. Keep
          // the marker sticky across later kicks; only a durable attempt that
          // this process has not observed is eligible for one cold recovery.
          const parkedAttemptId = parkedAttempts.get(currentMember.id)
          const recoverOwned = owned !== undefined
            && (owned.attemptId === undefined || owned.attemptId !== parkedAttemptId)
          const task = recoverOwned ? owned : owned === undefined
            ? nextReadyTask(fresh.tasks, currentMember.name)
            : undefined
          if (task === undefined) {
            if (currentMember.status !== 'idle') {
              currentMember.status = 'idle'
              await writeTeam(stateRoot, fresh)
            }
            return undefined
          }
          const previousAssignee = task.assignee
          const previousStatus = recoverOwned ? task.status as 'claimed' | 'in_progress' : undefined
          const previousAttempt = recoverOwned ? task.attempt : undefined
          const previousAttemptId = recoverOwned ? task.attemptId : undefined
          const previousResult = recoverOwned ? {
            output: task.output, verdict: task.verdict, findings: task.findings,
            changedPaths: task.changedPaths, acceptanceResults: task.acceptanceResults, commandsRun: task.commandsRun,
          } : undefined
          const attemptId = beginTaskAttempt(task, currentMember.name)
          // A recovered generation is parked before delivery. This makes each
          // (member, attempt) recovery idempotent even if every status poll
          // sees a disposed handle. Fresh pending work remains unparked so a
          // genuinely lost first delivery can be recovered once.
          if (recoverOwned) parkedAttempts.set(currentMember.id, attemptId)
          else parkedAttempts.delete(currentMember.id)
          currentMember.status = 'working'
          await writeTeam(stateRoot, fresh)
          const profileSeedId = taskProfileSeedId(task)
          const protocol = teamProfileProtocol(fresh)
          return {
            taskId: task.id,
            memberName: currentMember.name,
            memberId: currentMember.id,
            attempt: task.attempt ?? 1,
            attemptId,
            previousAssignee,
            recoveredOwned: recoverOwned,
            ...previousResult === undefined ? {} : { previousResult },
            ...previousStatus === undefined ? {} : { previousStatus },
            ...previousAttempt === undefined ? {} : { previousAttempt },
            ...previousAttemptId === undefined ? {} : { previousAttemptId },
            subject: task.subject,
            description: task.description,
            teamDescription: fresh.description,
            ...protocol === undefined ? {} : { profileProtocol: protocol },
            ...profileSeedId === undefined ? {} : { profileSeedId },
            ...fresh.profile?.executionPrompt === undefined && config.executionPrompt === undefined
              ? {}
              : { executionPrompt: fresh.profile?.executionPrompt ?? config.executionPrompt },
            kind: task.kind ?? 'work',
            ...task.round === undefined ? {} : { round: task.round },
            ...task.objective === undefined ? {} : { objective: task.objective },
            ...task.inScope === undefined ? {} : { inScope: task.inScope },
            ...task.outOfScope === undefined ? {} : { outOfScope: task.outOfScope },
            ...task.acceptance === undefined ? {} : { acceptance: task.acceptance },
            ...task.verify === undefined ? {} : { verify: task.verify },
            ...task.reviewedTaskId === undefined ? {} : { reviewedTaskId: task.reviewedTaskId },
            dependencyOutputs: collectCompletedDependencyOutputs(
              fresh.tasks,
              task.id,
              (message) => ctx.logger.warn(message),
            ),
          }
        })
        if (ticket === undefined) return

        /**
         * ── ★ 建隔离工作目录（在锁外做：git 是 I/O，不该拖长持锁时间）─────────────
         *
         * 只给【会写文件的】任务建 —— review / requirements 这类只读任务不需要
         * 自己的检出，给它们建只会浪费磁盘并让清理面变大。
         *
         * ★ 建失败【拒绝派发】（见下面的分支）：隔离是"这个成员能不能在正确的
         *   地方干活"的前置条件，不是可选装饰。此前"warn 后继续"的写法把隔离
         *   变成了提示 —— 成员在共享工作区干活，而没有任何一步会拒绝它。
         */
        const needsWorktree = ticket.kind === 'implementation' || ticket.kind === 'repair'
        let worktreePath: string | undefined
        let worktreeMissingIgnored: readonly string[] | undefined
        let worktreeUnavailable: string | undefined
        if (needsWorktree) {
          const created = createTaskWorktree({ repo: workspace, taskId: ticket.taskId })
          if (created.ok !== true && created.unsupported === true) {
            /**
             * ── ★ 这个仓库【没有】隔离能力 ⇒ 降级派发，但留下痕迹 ──────────────
             *
             * MEASURED（2026-10-05）：此前这里对**所有**建不出来的情形都拒绝派发。
             * 而非 git 仓库不是"这次没成"，是"这里根本没有"：拒绝 ⇒ 任务回
             * pending、成员回 idle ⇒ `agent/status` 的 idle 边再踢一次 ⇒ 再拒绝
             * ⇒ **无限循环，任务永久卡死**（实测：非 git 项目里每一个
             * implementation/repair 任务都卡死，而只有一条 warn 说原因）。
             *
             * ★ 为什么降级是对的（而不是"再放宽一点"）：隔离是**能力**，
             *   不是**裁决**。没有能力时，该做的是【如实说没有】并让成员干活，
             *   而"没有隔离"这件事必须留下痕迹 —— 于是依赖父版本的判据
             *   （R5 / 变异 / 回测的基准）拿到的是"我测不了"，不是"通过了"。
             *   这正是"没测到不得并进通过"在调度层的同一条纪律。
             *
             * ★ 与下面 `failed` 分支的区别是本质的：那里是 git 仓库却建不出来，
             *   属于环境坏了，**重试是合理的**；这里重试一万次也还是同一个环境。
             *   一个"重试也不会有不同结果"的守卫，只会把任务卡死。
             */
            worktreeUnavailable = created.reason
            ctx.logger.warn(`agent-teams: task "${ticket.taskId}" has no isolated worktree (${created.reason}); dispatching into the shared workspace and recording the task as un-isolated`)
          } else if (created.ok !== true) {
            /**
             * ── ★ 机制化：本该能隔离却建不出来 ⇒ 拒绝派发 ────────────────────────
             *
             * 此前这里是 `logger.warn(...)` 之后【继续派发】。而"继续"的实际含义是
             * 成员在【共享工作区】里干活 —— 于是隔离从机制退化成提示：
             *
             *   ① 隔离目录从未被真正使用，`dispatch.worktree` 到达判据也拿不到
             *      任何可核对的东西（一次 warn 不是一条记录）；
             *   ② 依赖父版本的判据（R5 / 变异）在这条路径上永远只能 unmeasured；
             *   ③ 而"工作落到了主树"这件事【没有任何入口会拒绝】。
             *
             * ⇒ 现在:是 git 仓库却建不出来 ⇒ 该成员这一步【不派发】，工作回到
             *   共享任务池。没有 fallback。理由与"判据不得把未测量并进通过"同源：
             *   一个能被绕过的守卫等于没有守卫，而它还会让人以为有。
             *
             * ★ 回滚用与派发失败【同一条】路径 —— 那条路径已经处理了所有困难情形
             *   （恢复中的 attempt、被队长接管的 capability、并发交接）。这里再写
             *   一份"只把任务置回 pending"的轻量回滚，就会造出第二个语义不同的
             *   回滚，而两者在日志里看不出区别。
             */
            ctx.logger.warn(`agent-teams: refusing to dispatch task "${ticket.taskId}" to "${ticket.memberName}": no isolated worktree (${created.reason})`)
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
              const fresh = await readTeam(stateRoot, team!.id)
              if (fresh === undefined) return
              const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId)
              if (task?.attemptId !== ticket.attemptId) return
              if (ticket.recoveredOwned && ticket.previousStatus !== undefined && ticket.previousAttemptId !== undefined) {
                task.status = ticket.previousStatus
                task.assignee = ticket.previousAssignee
                task.attempt = ticket.previousAttempt
                task.attemptId = ticket.previousAttemptId
                Object.assign(task, ticket.previousResult)
                parkedAttempts.set(ticket.memberId, ticket.previousAttemptId)
              } else {
                task.status = 'pending'
                task.assignee = ticket.previousAssignee
                task.attemptId = undefined
                parkedAttempts.delete(ticket.memberId)
              }
              task.handoffId = undefined
              task.reassigning = false
              task.updatedAt = Date.now()
              const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName)
              if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
              await writeTeam(stateRoot, fresh)
            })
            return
          } else {
            worktreePath = created.path
            worktreeMissingIgnored = created.missingIgnored
            /**
             * ★ 把这个任务的【隔离基准】交回调用方。
             *
             * `base` 是 R5（红前绿后）与回测（baseline）唯一的父版本来源，而它只
             * 在这里可得（`createTaskWorktree` 的产物）。判据层在成员汇报完成时
             * 需要它，那时派发早已结束 ⇒ 必须在这里交出去。
             *
             * ★ 只有真的建出 worktree 才回调：没有隔离就没有父版本，判据应当
             *   说"我没能测量"，而不是拿一个猜出来的版本去比较。
             */
            config.onWorktree?.(ticket.taskId, created.base)
          }
        }
        const dispatched: DispatchTicket = {
          ...ticket,
          ...worktreePath === undefined ? {} : { worktreePath },
          ...worktreeMissingIgnored === undefined || worktreeMissingIgnored.length === 0
            ? {}
            : { worktreeMissingIgnored },
          ...worktreeUnavailable === undefined ? {} : { worktreeUnavailable },
        }

        const prompt = assignmentPrompt(dispatched, config.stateDir, team.id)
        const signal = new AbortController().signal
        const accepted = config.dispatch === undefined
          ? await deliverToMember(ctx, captain, ticket.memberId, prompt, signal)
          : await config.dispatch(captain, team.id, ticket.memberName, prompt, signal, 'queue', ticket.attemptId)
        if (accepted) {
          /**
           * ★ runtime 位置的接线（t6）：投递【被接受之后】才记录这次派发。
           *   只记录、不拒流程（契约 §5）—— 回调的返回值被有意忽略，因为一个
           *   过程约束不该、也不能改变派发结果。失败路径不记录（见下面的回滚）。
           */
          config.onDispatched?.({
            taskId: dispatched.taskId,
            memberName: dispatched.memberName,
            memberId: dispatched.memberId,
            attempt: dispatched.attempt,
            attemptId: dispatched.attemptId,
            kind: dispatched.kind as string,
            ...worktreePath === undefined ? {} : { worktreePath },
            ...worktreeUnavailable === undefined ? {} : { worktreeUnavailable },
          })
          return
        }

        // Roll back only our exact failed dispatch. A concurrent captain
        // handoff has already changed the capability and wins.
        await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined) return
          const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId)
          if (task?.attemptId !== ticket.attemptId) return
          if (ticket.recoveredOwned && ticket.previousStatus !== undefined && ticket.previousAttemptId !== undefined) {
            // Recovery delivery failed. Restore the durable generation instead
            // of returning it to pending, then keep it parked so later status
            // kicks cannot spend an unbounded sequence of fresh attempts.
            task.status = ticket.previousStatus
            task.assignee = ticket.previousAssignee
            task.attempt = ticket.previousAttempt
            task.attemptId = ticket.previousAttemptId
            Object.assign(task, ticket.previousResult)
            parkedAttempts.set(ticket.memberId, ticket.previousAttemptId)
          } else {
            task.status = 'pending'
            task.assignee = ticket.previousAssignee
            task.attemptId = undefined
            parkedAttempts.delete(ticket.memberId)
          }
          task.handoffId = undefined
          task.reassigning = false
          task.updatedAt = Date.now()
          const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName)
          if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
          await writeTeam(stateRoot, fresh)
        })
      })
    },
  }

  const syncMemberStatus = async (agent: Agent, status: AgentStatus): Promise<void> => {
    const workspace = agent.session.header.cwd ?? process.cwd()
    const stateRoot = stateRootOf(workspace, config)
    const located = await findTeamByParticipant(stateRoot, agent.id)
    if (located === undefined) {
      parkedAttempts.delete(agent.id)
      return
    }
    if (located.captainSessionId === agent.id) {
      // Captain takeover is scoped to the captain's current turn. Unlike a
      // durable member, the captain has no scheduler lane that can resume an
      // abandoned attempt later. Returning unfinished captain-owned work to
      // the shared pool on the idle edge prevents it from becoming a
      // permanently parked `claimed` task after the captain answers, is
      // interrupted, or the user switches conversations.
      if (status === 'running') return
      let requeued = false
      await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
        const fresh = await readTeam(stateRoot, located.id)
        if (fresh === undefined || fresh.captainSessionId !== agent.id) return
        for (const task of fresh.tasks) {
          if (task.assignee !== CAPTAIN_KEY
            || task.status === 'completed'
            || task.status === 'failed'
            || task.status === 'cancelled') continue
          invalidateTaskAttempt(task)
          task.reassigning = false
          requeued = true
        }
        if (requeued) await writeTeam(stateRoot, fresh)
      })
      if (requeued) await runtime.kickTeam(workspace, located.id, agent)
      return
    }
    const member = located.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
    if (member === undefined) {
      parkedAttempts.delete(agent.id)
      return
    }
    await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
      const fresh = await readTeam(stateRoot, located.id)
      const current = fresh?.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
      if (fresh === undefined || current === undefined) return
      const next = status === 'running' ? 'working' : 'idle'
      if (next === 'idle') {
        const owned = ownedOpenTask(fresh.tasks, current.name)
        if (owned?.attemptId === undefined) parkedAttempts.delete(agent.id)
        else parkedAttempts.set(agent.id, owned.attemptId)
      } else {
        parkedAttempts.delete(agent.id)
      }
      if (current.status === next) return
      current.status = next
      await writeTeam(stateRoot, fresh)
    })
    if (status === 'idle') await runtime.kickMember(workspace, located.id, member.name)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    void syncMemberStatus(agent, status).catch((error: unknown) => {
      ctx.logger.warn(`agent-teams: member status scheduling failed for ${agent.id}: ${String(error)}`)
    })
  })

  return runtime
}
