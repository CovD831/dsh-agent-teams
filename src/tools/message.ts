// ── src/tools/message.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { isCurrentMail, mailboxPrompt } from '../mailbox.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { memberOpenTask, requireCaptain, requireFreshParticipant, requireMember, requireParticipantTeam, requireTask, stateRootOf, teamLockKey, workspaceOf } from './shared/entities.ts'
import { CAPTAIN_KEY, appendMailbox, createMessage, markMailboxDelivered, readMailbox, releaseMailboxDelivery, withTeamLock } from '../state.ts'
import { steerCaptainReport } from '../tools.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, dispatchMember: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_send_message',
      description: 'Send coordination or current-task guidance directly to the captain or a teammate. A running recipient receives it at the next model step; an idle recipient wakes. Messages are durably retained until read. Use task creation/reassignment for a new unit of work, not repeated status nudges.',
      parameters: {
        source_task_id: { type: 'string', description: 'Sender task, NOT the recipient task. Members include it with source_attempt_id. Captains sending guidance normally omit both source fields.' },
        source_attempt_id: { type: 'string', description: 'Sender execution capability paired with source_task_id. Stale reports are rejected. Omit for ordinary captain guidance.' },
        to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
        content: { type: 'string', required: true, description: 'The message text.' },
        from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message_id: { type: 'string', required: true },
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
            delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), mailbox (durable inbox only), or duplicate (same message already retained).' },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
        }],
      },
      async execute(args, exec) {
        const caller = requireCaptain(exec)
        const workspace = workspaceOf(caller)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireParticipantTeam(workspace, config, caller)
        const to = args.to.trim()
        const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
          const from = identity.name
          // `from` may only be the caller's own identity: impersonating another
          // member (or the captain) would poison the mailbox and event records.
          if (args.from !== undefined && args.from !== from) {
            throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
          }
          const sourceTaskId = args.source_task_id?.trim() || undefined
          const sourceAttemptId = args.source_attempt_id?.trim() || undefined
          if ((sourceTaskId === undefined) !== (sourceAttemptId === undefined)) throw new Error('send_message requires source_task_id and source_attempt_id together')
          const source = sourceTaskId === undefined
            ? identity.kind === 'member' ? memberOpenTask(fresh, identity.name) ?? fresh.tasks.filter(item => item.assignee === identity.name && item.attemptId !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined
            : requireTask(fresh, sourceTaskId)
          if (sourceTaskId !== undefined && (source?.assignee !== identity.name || source.attemptId !== sourceAttemptId)) {
            throw new Error('stale or foreign source attempt; stop sending results from the revoked task')
          }
          const sourceFields = source?.attemptId === undefined ? {} : { sourceTaskId: source.id, sourceAttemptId: source.attemptId, sourceTaskStatus: source.status }
          const owned = to === CAPTAIN_KEY ? undefined : memberOpenTask(fresh, requireMember(fresh, to).name)
          const duplicate = (await readMailbox(stateRoot, fresh.id, to)).find(message => message.from === from
            && message.content === args.content && message.taskId === owned?.id && message.attemptId === owned?.attemptId
            && message.sourceTaskId === sourceFields.sourceTaskId && message.sourceAttemptId === sourceFields.sourceAttemptId && message.sourceTaskStatus === sourceFields.sourceTaskStatus
            && isCurrentMail(fresh, message) && (message.attemptId !== undefined || message.sourceAttemptId !== undefined || message.readAt === undefined))
          if (duplicate !== undefined) return { kind: 'duplicate' as const, message: duplicate, from }
          if (to === CAPTAIN_KEY) {
            const message = { ...createMessage(from, CAPTAIN_KEY, args.content), ...sourceFields, deliveryClaimedAt: Date.now() }
            await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
              teamId: fresh.id,
              messageId: message.id,
              from,
              to: CAPTAIN_KEY,
              content: args.content,
              ts: message.ts,
            })
            return { kind: 'captain' as const, fresh, identity, message, from }
          }
          if (fresh.halted === true) {
            throw new Error(`team "${fresh.name}" is halted; call agent_teams_resume before waking a member`)
          }
          const recipient = requireMember(fresh, to)
          const message = { ...createMessage(from, recipient.name, args.content), ...sourceFields, deliveryClaimedAt: Date.now(),
            ...owned?.attemptId === undefined ? {} : { taskId: owned.id, attemptId: owned.attemptId },
          }
          await appendMailbox(stateRoot, fresh.id, recipient.name, message)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
            teamId: fresh.id,
            messageId: message.id,
            from,
            to: recipient.name,
            content: args.content,
            ts: message.ts,
          })
          return { kind: 'member' as const, fresh, identity, message, from, recipient }
        })

        if (prepared.kind === 'duplicate') return { message_id: prepared.message.id, from: prepared.from, to: prepared.message.to, delivered: 'duplicate' }
        // Resolve the exact live captain only after releasing the state lock.
        // The plugin mailbox is already durable if live delivery cannot proceed.
        const captain = ctx.agents.get(prepared.fresh.captainSessionId as SessionId)
        if (prepared.kind === 'captain') {
          let delivered: 'live' | 'mailbox' = 'mailbox'
          if (captain !== undefined && prepared.identity.kind === 'member') {
            delivered = steerCaptainReport(captain, prepared.from, args.content, mailboxPrompt(prepared.fresh.id, CAPTAIN_KEY, [prepared.message])) ? 'live' : 'mailbox'
          }
          if (delivered === 'live') {
            await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
              markMailboxDelivered(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
            ))
          } else {
            await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
              releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
            ))
          }
          return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered }
        }
        let delivered: 'wake' | 'mailbox' = 'mailbox'
        if (captain !== undefined) {
          const text = mailboxPrompt(prepared.fresh.id, prepared.recipient.name, [prepared.message])
          const accepted = await dispatchMember(captain, prepared.fresh.id, prepared.recipient.name, text, exec.signal, 'steer', prepared.message.attemptId)
          delivered = accepted ? 'wake' : 'mailbox'
          if (accepted) {
            await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
              markMailboxDelivered(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
            ))
          }
        }
        if (delivered === 'mailbox') {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
          ))
        }
        return {
          message_id: prepared.message.id,
          from: prepared.from,
          to: prepared.recipient.name,
          delivered,
        }
      },
    }))
}
