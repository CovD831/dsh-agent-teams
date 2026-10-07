// ── src/tools/create.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { captainLockKey, requireCaptain, stateRootOf, teamLockKey, workspaceOf } from './shared/entities.ts'
import { createTeamDir, findTeamByParticipant, readTeam, sanitizeKey, withTeamLock } from '../state.ts'
import { TeamState } from '../types.ts'
import { initializeProfileTeam } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, memberSelections: any, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_create',
      description: 'Create a team. Use approval=required for a two-phase plan: members and tasks remain unspawned/unclaimed until the user reviews the Web plan and explicitly approves it. Optional profiles expand their configured roster; seed profiles also expand template tasks, while captain profiles leave the graph for the Captain to design. approval=automatic preserves the legacy immediate-execution path.',
      parameters: {
        name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
        description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
        profile: { type: 'string', description: 'Optional configured profile name.' },
        plan: {
          type: 'object', additionalProperties: false,
          description: 'Optional complete ordinary-work roster and DAG in one atomic call, instead of separate add_member/create_task rounds. Mutually exclusive with profile. For quality gates use create_task with the explicit quality contract.',
          properties: {
            members: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              name: { type: 'string', required: true }, role: { type: 'string' },
              provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' },
            } } },
            tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              id: { type: 'string', required: true, description: 'Local reference used by dependencies in this plan; the result maps it to a durable task id.' },
              subject: { type: 'string', required: true }, description: { type: 'string' }, assignee: { type: 'string' },
              dependencies: { type: 'array', items: { type: 'string' } },
            } } },
          },
        },
        approval: {
          type: 'string',
          enum: ['required', 'automatic'],
          description: 'required stages the plan for explicit user review; automatic starts immediately. Defaults to automatic for API compatibility.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            team_id: { type: 'string', required: true },
            team_name: { type: 'string', required: true },
            state_dir: { type: 'string', required: true },
            phase: { type: 'string', required: true },
            profile: { type: 'string' },
            task_planning: { type: 'string' },
            members: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { member_name: { type: 'string', required: true }, member_id: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, reasoning_effort: { type: 'string' }, status: { type: 'string', required: true } } } },
            tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', required: true }, seed_id: { type: 'string', required: true }, subject: { type: 'string', required: true }, status: { type: 'string', required: true }, kind: { type: 'string' }, assignee: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' }, required: true } } } },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: (value.phase === 'staged'
            ? `Team "${value.team_name}" plan created under ${value.state_dir}. It is staged: finish the roster and DAG, then wait for the user to edit and approve it. Do not start or approve it yourself.`
            : `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`)
            + (value.tasks === undefined ? '' : '\n' + value.tasks.map(task => `${task.task_id} [${task.seed_id}]: ${task.subject}; assignee=${task.assignee ?? 'unassigned'}; dependencies=${task.dependencies.join(',')}`).join('\n')),
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const teamName = args.name.trim()
        if (teamName === '') throw new Error('team name must not be empty')
        const teamId = sanitizeKey(teamName)
        const staged = args.approval === 'required'
        // Some models materialize optional parameters as "" instead of omitting
        // them (issue #99). The profile is optional, so treat a blank value
        // exactly like an omitted one instead of failing every create call.
        const profileName = args.profile !== undefined && args.profile.trim() !== ''
          ? args.profile.trim()
          : undefined
        if (profileName !== undefined && args.plan !== undefined) throw new Error('choose either a configured profile or an inline plan')
        const created = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
          const current = await findTeamByParticipant(stateRoot, captain.id)
          if (current !== undefined) {
            const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to'
            const guidance = current.captainSessionId === captain.id
              ? 'Use agent_teams_status and continue the existing team. Do not delete and recreate it merely to continue work. End it only when the user explicitly wants a separate new team.'
              : 'Continue your assigned member work and report to your captain; do not create a separate team.'
            throw new Error(`you already ${relationship} team "${current.name}" (id ${current.id}). ${guidance}`)
          }
          return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const existing = await readTeam(stateRoot, teamId)
            if (existing !== undefined) {
              throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`)
            }
            if (profileName === undefined && args.plan === undefined) {
              const state: TeamState = {
                name: teamName,
                id: teamId,
                description: args.description,
                captainSessionId: captain.id,
                createdAt: Date.now(),
                members: [],
                tasks: [],
                taskSeq: 0,
                ...staged ? { phase: 'staged' as const, planReviewState: 'awaiting_review' as const } : {},
              }
              await createTeamDir(stateRoot, state)
              return { committed: true as const, state }
            }
            return initializeProfileTeam({
              ctx,
              config,
              memberSelections,
              captain,
              exec,
              stateRoot,
              teamName,
              teamId,
              profileName: profileName ?? 'inline-plan',
              inlinePlan: args.plan,
              description: args.description,
              staged,
            })
          })
        })
        if (created.committed) {
          try {
            await scheduler.kickTeam(workspace, created.state.id, captain)
          } catch (error: unknown) {
            ctx.logger.warn(`agent-teams: post-create kick failed for "${created.state.id}": ${String(error)}`)
          }
          try {
            appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
              teamId: created.state.id,
              captainSessionId: captain.id,
              name: created.state.name,
              ...created.state.description !== undefined ? { description: created.state.description } : {},
              ...created.state.profile?.name === undefined ? {} : { profile: created.state.profile.name },
            })
            for (const member of created.state.members) {
              appendTeamEvent(ctx, captain.session, 'agent-teams/member-added', {
                teamId: created.state.id,
                memberId: member.id,
                name: member.name,
                ...member.role === undefined ? {} : { role: member.role },
              })
            }
            for (const task of created.state.tasks) {
              appendTeamEvent(ctx, captain.session, 'agent-teams/task-created', {
                teamId: created.state.id,
                taskId: task.id,
                subject: task.subject,
                dependencies: task.dependencies,
                ...task.assignee === undefined ? {} : { assignee: task.assignee },
              })
            }
          } catch (error: unknown) {
            ctx.logger.warn(`agent-teams: post-create events failed for "${created.state.id}": ${String(error)}`)
          }
        }
        const persisted = await readTeam(stateRoot, created.state.id).catch(() => undefined)
        const snapshot = persisted ?? created.state
        if (snapshot.profile === undefined && args.plan === undefined) {
          return {
            team_id: snapshot.id,
            team_name: snapshot.name,
            state_dir: join(stateRoot, snapshot.id),
            phase: snapshot.phase ?? 'running',
          }
        }
        return {
          team_id: snapshot.id,
          team_name: snapshot.name,
          state_dir: join(stateRoot, snapshot.id),
          phase: snapshot.phase ?? 'running',
          ...snapshot.profile === undefined ? {} : { profile: snapshot.profile.name },
          task_planning: snapshot.profile?.taskPlanning ?? 'seed',
          members: snapshot.members.map((member) => ({
            member_name: member.name,
            member_id: member.id,
            provider: member.provider ?? '',
            model: member.model ?? '',
            ...member.reasoningEffort === undefined ? {} : { reasoning_effort: member.reasoningEffort },
            status: member.status,
          })),
          tasks: snapshot.tasks.map((task) => ({
            task_id: task.id,
            seed_id: task.profileSeedId ?? '',
            subject: task.subject,
            status: task.status,
            ...task.kind === undefined ? {} : { kind: task.kind },
            ...task.assignee === undefined ? {} : { assignee: task.assignee },
            dependencies: task.dependencies,
          })),
        }
      },
    }))
}
