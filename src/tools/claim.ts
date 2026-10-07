// ── src/tools/claim.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { memberOpenTask, requireCaptain, requireFreshParticipant, requireParticipantTeam, requireTask, stateRootOf, taskDetails, teamLockKey, workspaceOf } from './shared/entities.ts'
import { CAPTAIN_KEY, beginTaskAttempt, transitionError, unsatisfiedDependencies, withTeamLock, writeTeam } from '../state.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_claim_task',
      description: 'Members claim their own ready task or read their existing attempt_id. Captains must use reassign_task to assign and wake a member; claim_task does not dispatch work. A member cannot own a second unfinished task. The returned attempt_id is required for updates and becomes stale after retry/reassignment.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'The task id to claim.' },
        assignee: { type: 'string', description: 'Deprecated: claim_task only supports a member claiming its own task. Captains must use reassign_task.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task_id: { type: 'string', required: true },
            status: { type: 'string', required: true },
            assignee: { type: 'string', required: true },
            attempt: { type: 'number', required: true },
            attempt_id: { type: 'string' },
            task_details: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).\n${value.task_details}`,
        }],
      },
      async execute(args, exec) {
        const caller = requireCaptain(exec)
        const workspace = workspaceOf(caller)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireParticipantTeam(workspace, config, caller)
        return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
          const task = requireTask(fresh, args.task_id)
          if (task.reassigning === true) {
            throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`)
          }
          let assignee = task.assignee
          if (identity.kind === 'captain') {
            // A captain may read the capability of its already-started takeover,
            // but must never create a member claim without dispatching it (#125).
            if (args.assignee !== undefined || task.assignee !== CAPTAIN_KEY
                || (task.status !== 'claimed' && task.status !== 'in_progress')) {
              throw new Error('claim_task is for members claiming their own task; captains must use agent_teams_reassign_task to assign and wake a member')
            }
          } else {
            if (args.assignee !== undefined) {
              throw new Error('members cannot set assignee when claiming a task')
            }
            if (assignee !== undefined && assignee !== identity.name) {
              throw new Error(`task ${task.id} is assigned to "${assignee}", not you`)
            }
            assignee = identity.name
          }
          // Authorization must happen before the idempotent return: another
          // member must not receive a false success for somebody else's task.
          if (task.status === 'claimed' || task.status === 'in_progress') {
            if (assignee === undefined || task.assignee !== assignee) {
              throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`)
            }
            return {
              task_details: taskDetails(fresh, task),
              task_id: task.id,
              status: task.status,
              assignee,
              attempt: task.attempt ?? 0,
              ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            }
          }
          const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
          if (pending.length > 0) {
            throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`)
          }
          const transition = transitionError(task.status, 'claimed')
          if (transition !== undefined) throw new Error(transition)
          if (assignee === undefined) {
            throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)')
          }
          const busy = memberOpenTask(fresh, assignee, task.id)
          if (busy !== undefined) {
            throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`)
          }
          const attemptId = beginTaskAttempt(task, assignee)
          await writeTeam(stateRoot, fresh)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
            teamId: fresh.id,
            taskId: task.id,
            status: task.status,
            assignee: task.assignee,
          })
          return {
            task_details: taskDetails(fresh, task),
            task_id: task.id,
            status: task.status,
            assignee: task.assignee ?? '',
            attempt: task.attempt ?? 0,
            attempt_id: attemptId,
          }
        })
      },
    }))
}
