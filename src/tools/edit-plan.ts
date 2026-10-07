// ── src/tools/edit-plan.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { requireCaptain, requireCaptainTeam, requireMember, requireTask, workspaceOf } from './shared/entities.ts'
import { StagedPlanMutation } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'
import type { TeamMember, TeamTask } from '../types.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, scheduler: any, updatePlanBatch: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_edit_plan',
      description: 'Atomically revise an AgentTeams plan. While staged, edit tasks and roster without starting work. While running, only update_task is allowed, and only for pending tasks with no prior attempt: correct dependencies, assignees or descriptions before they start; newly ready work is scheduled after commit. Never edit active/finished attempts. Submit dependent edits in order. Never modify .agent-teams files directly.',
      parameters: {
        operations: {
          type: 'array',
          required: true,
          description: 'One atomic, ordered batch. Running teams allow only update_task for never-started pending tasks. If any operation is invalid, none of the edits are saved.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                required: true,
                enum: ['update_member', 'update_task', 'add_task', 'remove_task', 'remove_member'],
              },
              member_name: { type: 'string', description: 'Member name for update_member or remove_member.' },
              task_id: { type: 'string', description: 'Task id for update_task or remove_task.' },
              subject: { type: 'string', description: 'Required for add_task; optional replacement for update_task.' },
              description: { type: 'string', description: 'Optional task description.' },
              assignee: { type: 'string', description: 'Optional task assignee; an empty string moves it to the shared pool.' },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Complete replacement dependency list for a task.' },
              role: { type: 'string', description: 'Optional member role.' },
              provider: { type: 'string', description: 'Optional member provider; defaults to the current staged route.' },
              model: { type: 'string', description: 'Optional member model; defaults to the current staged route.' },
              reasoning_effort: { type: 'string', description: 'Optional member reasoning effort.' },
              execution_prompt: { type: 'string', description: 'Optional member-specific execution prompt.' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            team_id: { type: 'string', required: true },
            members: { type: 'number', required: true },
            tasks: { type: 'number', required: true },
            dependencies: { type: 'number', required: true },
            roster: { type: 'array', items: { type: 'string' }, required: true },
            graph: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.status === 'staged' ? 'Staged plan' : 'Pending task graph'} updated atomically (${value.members} members, ${value.tasks} tasks, ${value.dependencies} dependencies). ${value.status === 'staged' ? 'No members were spawned and no tasks were scheduled.' : 'The scheduler will dispatch any newly ready work.'}\n${value.graph.join('\n')}`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const team = await requireCaptainTeam(workspace, config, captain)
        if (args.operations.length === 0) throw new Error('at least one staged plan operation is required')

        const mutations: StagedPlanMutation[] = args.operations.map((operation, index) => {
          const label = `operation ${index + 1} (${operation.action})`
          if (operation.action === 'update_member') {
            const memberName = operation.member_name?.trim() ?? ''
            if (memberName === '') throw new Error(`${label} requires member_name`)
            const member = requireMember(team, memberName)
            return {
              action: 'update_member',
              memberName,
              role: operation.role ?? member.role,
              provider: operation.provider?.trim() || member.provider || '',
              model: operation.model?.trim() || member.model || '',
              reasoningEffort: operation.reasoning_effort ?? member.reasoningEffort,
              executionPrompt: operation.execution_prompt ?? member.executionPrompt,
            }
          }
          if (operation.action === 'update_task') {
            const taskId = operation.task_id?.trim() ?? ''
            if (taskId === '') throw new Error(`${label} requires task_id`)
            const task = requireTask(team, taskId)
            return {
              action: 'update_task',
              taskId,
              subject: operation.subject ?? task.subject,
              description: operation.description ?? task.description,
              assignee: operation.assignee ?? task.assignee,
              dependencies: operation.dependencies ?? task.dependencies,
            }
          }
          if (operation.action === 'add_task') {
            const subject = operation.subject?.trim() ?? ''
            if (subject === '') throw new Error(`${label} requires a non-empty subject`)
            return {
              action: 'add_task',
              subject,
              description: operation.description,
              assignee: operation.assignee,
              dependencies: operation.dependencies ?? [],
            }
          }
          if (operation.action === 'remove_task') {
            const taskId = operation.task_id?.trim() ?? ''
            if (taskId === '') throw new Error(`${label} requires task_id`)
            return { action: 'remove_task', taskId }
          }
          const memberName = operation.member_name?.trim() ?? ''
          if (memberName === '') throw new Error(`${label} requires member_name`)
          return { action: 'remove_member', memberName }
        })
        const updated = await updatePlanBatch(captain, team.id, mutations, exec.signal, true)
        if (updated.phase !== 'staged') await scheduler.kickTeam(workspace, team.id, captain)
        return {
          status: updated.phase ?? 'running',
          team_id: updated.id,
          members: updated.members.length,
          tasks: updated.tasks.length,
          dependencies: updated.tasks.reduce((sum: number, task: TeamTask) => sum + task.dependencies.length, 0),
          roster: updated.members.map((member: TeamMember) => `${member.name} (${member.role || 'member'}; ${member.provider ?? ''}/${member.model ?? ''})`),
          graph: updated.tasks.map((task: TeamTask) => `${task.id}: ${task.subject} -> ${task.assignee || 'shared'}${task.dependencies.length === 0 ? '' : `; depends on ${task.dependencies.join(', ')}`}`),
        }
      },
    }))
}
