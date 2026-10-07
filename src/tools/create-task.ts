// ── src/tools/create-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { captainOpenTask, diagnosticFields, evaluateRuntimeGates, memberOpenTask, rejectOnContractGates, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireMember, requireTask, runVerifyCommand, stateRootOf, stopTeamMemberActivations, teamLockKey, withInputSurfaceOnError, workspaceOf, loadVerifyCommandRules, } from './shared/entities.ts'
import { CAPTAIN_KEY, beginTaskAttempt, discardMailboxMessages, invalidateTaskAttempt, normalizeBlankOptionalTaskFields, readTeam, readUnreadMailbox, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, unsatisfiedDependencies, validateCreateTask, withTeamLock, writeTeam } from '../state.ts'
import { TaskKind, TeamTask } from '../types.ts'
import { AgentTeamsRuntime } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
      name: 'agent_teams_create_task',
      description: 'Create a task in your team\'s task list. Use kind=work (default) for research, repository audits and general tasks. kind=review is only a quality gate for an existing implementation/repair task via reviewedTaskId. Every call must include a non-empty subject, including verification and review tasks. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Required non-empty title for this task. Never omit it, including for verification or review tasks.' },
        description: { type: 'string', description: 'What needs to be done, in detail.' },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task ids this task depends on (must be completed before this task can be claimed).',
        },
        assignee: { type: 'string', description: 'Member name when an owner is specified. Omission puts this task in the shared pool; roles, subjects and descriptions do not assign an owner.' },
        kind: {
          type: 'string',
          enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
          description: 'Explicit task kind. Omission means work with no quality gates, even if the subject says implementation/review. Quality kinds require a contract. An implementation may be planned before requirements passes when its dependency chain includes that requirements task.',
        },
        round: { type: 'number', description: '1-based review / requirements / repair round.' },
        objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
        inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
        outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
        verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
        deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable paths or names.' },
        nonGoals: { type: 'array', items: { type: 'string' }, description: 'Explicit non-goals.' },
        reviewedTaskId: { type: 'string', description: 'Existing AgentTeams implementation/repair task id. Required for kind=review; an external repository audit is kind=work.' },
        sourceTaskId: { type: 'string', description: 'Source implementation/artifact. Required for kind=repair.' },
        sourceFindingIds: { type: 'array', items: { type: 'string' }, description: 'Finding ids this repair must close.' },
        coverageOf: { type: 'array', items: { type: 'string' }, description: 'User-constraint / goal items this task covers.' },
        resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
        resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...diagnosticFields({ inputSurface: true, runtimeGates: true }),
            task_id: { type: 'string', required: true },
            subject: { type: 'string', required: true },
            status: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            assignee: { type: 'string' },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}, kind ${value.kind}, ${value.assignee ? `assigned to ${value.assignee}` : 'unassigned shared pool'}).`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        // Some models materialize optional parameters as "" instead of omitting
        // them (issue #105). Normalize blank optional fields to omitted before
        // validation so a blank value can neither be rejected spuriously nor be
        // persisted into team.json, where it would brick the team on reload.
        const input = normalizeBlankOptionalTaskFields(args)
        const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
          const gate = validateCreateTask(fresh, {
            subject: input.subject,
            description: input.description,
            dependencies: input.dependencies,
            assignee: input.assignee,
            kind: input.kind as TaskKind | undefined,
            round: input.round,
            objective: input.objective,
            inScope: input.inScope,
            outOfScope: input.outOfScope,
            acceptance: input.acceptance,
            verify: input.verify,
            deliverables: input.deliverables,
            nonGoals: input.nonGoals,
            reviewedTaskId: input.reviewedTaskId,
            sourceTaskId: input.sourceTaskId,
            sourceFindingIds: input.sourceFindingIds,
            coverageOf: input.coverageOf,
            resume: input.resume,
            resumeReason: input.resumeReason,
          })
          if (!gate.ok) throw new Error(gate.error ?? 'create_task rejected by quality gates')
          if (fresh.halted === true) {
            const resumed = resumeTeamState(fresh, args.resumeReason ?? '')
            if (resumed.status !== 'resumed' || resumed.team === undefined) {
              throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason')
            }
            fresh.halted = false
            fresh.haltedAt = undefined
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
              teamId: fresh.id,
              reason: args.resumeReason ?? '',
            })
          }
          const dependencies = args.dependencies ?? []
          for (const dependency of dependencies) {
            if (!fresh.tasks.some((task) => task.id === dependency)) {
              throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
            }
          }
          if (args.assignee !== undefined) requireMember(fresh, args.assignee)
          const kind = gate.kind ?? 'work'
          const objective = kind === 'review' || kind === 'requirements'
            ? sanitizeReviewObjective(input.objective)
            : input.objective
          const acceptance = kind === 'review' || kind === 'requirements'
            ? sanitizeReviewAcceptance(input.acceptance)
            : input.acceptance
          const task: TeamTask = {
            id: `t${fresh.taskSeq + 1}`,
            subject: args.subject,
            description: args.description,
            status: 'pending',
            assignee: args.assignee,
            dependencies,
            attempt: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            kind,
            ...args.round === undefined ? {} : { round: args.round },
            ...objective === undefined ? {} : { objective },
            ...input.inScope === undefined ? {} : { inScope: input.inScope },
            ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
            ...acceptance === undefined ? {} : { acceptance },
            ...input.verify === undefined ? {} : { verify: input.verify },
            ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
            ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
            ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
            ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
            ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
            ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
          }
          fresh.taskSeq += 1
          fresh.tasks.push(task)
          /**
           * ── ★ contract 位置（契约 §1 ①：「建任务 / 改契约」）─────────────────────
           *
           * 位置是**既有契约校验之后**：`validateCreateTask` 已经先说了话（它不认识判据
           * 层），本调用点只叠加。于是"这条契约本身合法吗"的既有裁决一点没变，而
           * "这条契约可判吗"（例如 verify 命令能不能真的判定成功/失败）可以由判据层
           * 接着问 —— 那正是 t7 要挂在这个位置上的东西。
           *
           * ★ 传【任务草稿】而不是 `args`：判据该读的是契约本身（objective / acceptance /
           *   verify / inScope …），而 `args` 里混着工具参数（resume、round…）。
           *
           * ── ★ 注入执行器（t18，本队同一张验收表的第三格）─────────────────────────
           *
           * MEASURED（2026-10-05）：本调用点此前**没有** `execVerifyCommand`，于是
           * `contract.verify-command` 在生产路径上**永远**返回 `unmeasured`
           * （"no executor was injected … never actually run"）⇒ 调用方拒绝
           * ⇒ **implementation / repair 这类必须验的契约连 create 都过不去**。
           *
           * ★ 这与 t6 修过的 `completion.verify-rerun` 缺执行器**同源**，也与 t17 修过的
           *   "verify 缺席 ⇒ unmeasured"是同一格 —— 判据接进来了，而它的**输入面**没接。
           *   本仓库对这条纪律的说法见契约 §2 性质 1：**判据不 import I/O，执行器由调用方注入**。
           *
           * ★ 复用 `runVerifyCommand`，与 completion 位置**同一个实现、同一个超时口径**
           *   —— 不新造第二条"跑命令"的路径（两条路径会在超时/退出码语义上慢慢分叉，
           *   而它们在日志里同形，那种分叉最难归因）。
           */
          const contractGateSurface = await rejectOnContractGates(ctx, { team: fresh, task, creating: true }, 'create_task', stateRoot, {
            execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
            /**
             * ── ★★★ t53：规则表**每次调用时读**（"改数据 ⇒ 立刻生效"的成立条件）──
             *
             * ★ 不缓存：缓存会让"改数据"在下一次**进程重启**前不生效 ——
             *   而那正是本任务要消灭的东西（改它读的东西不该需要换进程）。
             * ★ 也不在构建时内联（静态 import 会被 tsc 嵌进 lib/ ⇒ 改数据仍要 build）。
             */
            loadRules: () => loadVerifyCommandRules(workspace),
          })
          await writeTeam(stateRoot, fresh)
          /**
           * ── ★ runtime 位置：跨步骤的过程约束 ──────────────────────────────────────
           * 只记录，不拒绝（契约 §5）。`created: true` 是给"运行判据"的判别面 ——
           * 一条判据可以只关心某些事件，判据层不替它猜。
           */
          const contractRuntimeRecord = await evaluateRuntimeGates(ctx, 'task-created', {
            team: fresh,
            task,
            created: true,
          }, clock)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
            teamId: fresh.id,
            taskId: task.id,
            subject: task.subject,
            dependencies: task.dependencies,
            ...task.assignee !== undefined ? { assignee: task.assignee } : {},
            ...task.kind === undefined ? {} : { kind: task.kind },
            ...task.round === undefined ? {} : { round: task.round },
          })
          return {
            task_id: task.id,
            subject: task.subject,
            status: task.status,
            kind: taskKindOf(task),
            /**
             * ★★ t3：contract 位置的核对结论**随记录交出去**（与 runtime 同形）。
             *   此前这里只有一个 `logger.warn` —— 日志被截断时，"报缺"与"输入面是齐的"
             *   在返回值上同形。★ 三态：齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/
             *   这个位置没判据（**字段不出现**，不是 `ok`）。
             */
            ...contractGateSurface === undefined ? {} : contractGateSurface,
            ...task.assignee !== undefined ? { assignee: task.assignee } : {},
            ...contractRuntimeRecord === undefined ? {} : { runtime_gates: contractRuntimeRecord },
          }
        })
        await scheduler.kickTeam(workspace, team.id, captain)
        return created
      },
    })))
}
