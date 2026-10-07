// ── src/tools/delete.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
import { TERMINAL_TASK_STATUSES } from "../types.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, stateRootOf, stopTeamMemberActivations, teamLockKey, workspaceOf } from "./shared/entities.js";
import { archiveTeamDir, discardMailboxMessages, invalidateTaskAttempt, readUnreadMailbox, recordRetiredMemberIds, withTeamLock, writeTeam } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_delete',
        description: 'End and archive your team: interrupts members and moves the current tasks and mailboxes out of active state for later inspection. Use when the work is done or explicitly abandoned. A same-name archive replaces its previous generation.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    deleted: { type: 'boolean', required: true },
                    team_name: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Team "${value.team_name}" ended and archived.`,
                }],
        },
        async execute(_args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                // Include previously removed members so deleting a pre-fix team also
                // retires durable catalog entries left behind by remove_member.
                const roster = fresh.members.map(member => ({ ...member }));
                for (const member of fresh.members) {
                    await discardMailboxMessages(stateRoot, fresh.id, member.name, (await readUnreadMailbox(stateRoot, fresh.id, member.name)).map(message => message.id));
                    if (member.status === 'removed')
                        continue;
                    member.status = 'removed';
                    for (const task of fresh.tasks) {
                        if (task.assignee === member.name && !TERMINAL_TASK_STATUSES.includes(task.status))
                            invalidateTaskAttempt(task);
                    }
                }
                await writeTeam(stateRoot, fresh);
                return roster;
            });
            await recordRetiredMemberIds(stateRoot, members.map(member => member.id));
            await stopTeamMemberActivations(ctx, captain, members, exec.signal);
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
                    teamId: fresh.id,
                });
                // Archive, not delete: tasks (with their dependency graph) and the
                // mailboxes stay on disk for later review and dependency rebuilds.
                await archiveTeamDir(stateRoot, fresh.id);
            });
            return { deleted: true, team_name: team.name };
        },
    }));
}
