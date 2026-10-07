// ── src/tools/members.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, stateRootOf, stopTeamMemberActivations, teamLockKey, trimmedOptional, workspaceOf } from './shared/entities.ts'
import { resolveMemberLlmSelection, validateMemberLlmSelections } from '../members.ts'
import { CAPTAIN_KEY, discardMailboxMessages, invalidateTaskAttempt, readTeam, readUnreadMailbox, recordRetiredMemberIds, sanitizeKey, withTeamLock, writeTeam } from '../state.ts'
import { TeamMember } from '../types.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_add_member',
      description: 'Add a member to the team roster. Planning and idle roster rows do not call a model. After approval, the member session starts with its first ready task or explicit message and remains durable for later work.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
        role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
        provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
        model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
        reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
        executionPrompt: { type: 'string', description: 'Optional member-specific execution prompt. It remains editable while staged.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            member_name: { type: 'string', required: true },
            member_id: { type: 'string', required: true },
            provider: { type: 'string', required: true },
            model: { type: 'string', required: true },
            reasoning_effort: { type: 'string' },
            status: { type: 'string', required: true },
            phase: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: value.phase === 'staged'
            ? `Member "${value.member_name}" added to the staged roster (${value.provider}/${value.model}); no child was spawned.`
            : `Member "${value.member_name}" added (session ${value.member_id || 'starts with first ready task'}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
          const memberName = args.name.trim()
          if (memberName === '') throw new Error('member name must not be empty')
          const memberKey = sanitizeKey(memberName)
          if (memberKey === CAPTAIN_KEY) {
            throw new Error(`member name "${args.name}" is reserved for the captain`)
          }
          if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
            throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`)
          }
          if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
            throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`)
          }
          const selection = await resolveMemberLlmSelection(ctx, captain, {
            provider: args.provider,
            model: args.model,
            defaultModel: config.memberModel,
            reasoningEffort: args.reasoning_effort,
            fallback: config.fallback,
          }, exec.signal)
          const member: TeamMember = {
            id: '',
            name: memberName,
            role: args.role,
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
            executionPrompt: trimmedOptional(args.executionPrompt),
            joinedAt: Date.now(),
            status: 'idle',
          }
          await validateMemberLlmSelections(ctx, [selection], exec.signal)
          fresh.members.push(member)
          await writeTeam(stateRoot, fresh)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
            teamId: fresh.id,
            memberId: member.id,
            name: member.name,
            ...member.role !== undefined ? { role: member.role } : {},
          })
          return {
            member_name: member.name,
            member_id: member.id,
            provider: selection.provider,
            model: selection.model,
            ...selection.reasoningEffort === undefined
              ? {}
              : { reasoning_effort: selection.reasoningEffort },
            status: member.status,
            phase: fresh.phase ?? 'running',
          }
        })
        await scheduler.kickMember(workspace, team.id, created.member_name, captain)
        const latest = (await readTeam(stateRoot, team.id))?.members.find(member => member.name === created.member_name)
        return latest === undefined ? created : { ...created, member_id: latest.id, status: latest.status }
      },
    }))
    ctx.tools.register(defineTool({
      name: 'agent_teams_remove_member',
      description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
      parameters: {
        name: { type: 'string', required: true, description: 'Name of the member to remove.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            member_name: { type: 'string', required: true },
            status: { type: 'string', required: true },
            requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
          const member = fresh.members.find(item => item.name === args.name)
          if (member === undefined) throw new Error(`no member \"${args.name}\" in team \"${fresh.name}\"`)
          const requeued: string[] = []
          for (const task of fresh.tasks) {
            if (task.assignee !== member.name || task.status === 'completed') continue
            invalidateTaskAttempt(task)
            task.reassigning = false
            requeued.push(task.id)
          }
          member.status = 'removed'
          await discardMailboxMessages(stateRoot, fresh.id, member.name, (await readUnreadMailbox(stateRoot, fresh.id, member.name)).map(message => message.id))
          await writeTeam(stateRoot, fresh)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
            teamId: fresh.id,
            memberId: member.id,
          })
          return { member: { ...member }, requeued }
        })
        if (revoked.member.id !== '') {
          await recordRetiredMemberIds(stateRoot, [revoked.member.id])
          await stopTeamMemberActivations(ctx, captain, [revoked.member], exec.signal)
        }
        await scheduler.kickTeam(workspace, team.id, captain)
        return {
          member_name: revoked.member.name,
          status: revoked.member.status,
          requeued_tasks: revoked.requeued,
        }
      },
    }))
}
