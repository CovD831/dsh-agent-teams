// ── src/tools/resume.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, stateRootOf, teamLockKey, workspaceOf } from "./shared/entities.js";
import { resumeTeamState, withTeamLock, writeTeam } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, scheduler, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_resume',
        description: 'Explicitly resume a halted team. Requires a non-empty reason. Does not recreate cancelled tasks; only still-pending work is scheduled.',
        parameters: {
            reason: { type: 'string', required: true, description: 'Why the team is being resumed.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.status === 'already_running'
                        ? `Team ${value.team_id} is already running.`
                        : `Team ${value.team_id} resumed (${value.reason}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const result = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const resumed = resumeTeamState(fresh, args.reason);
                if (resumed.status === 'rejected')
                    throw new Error(resumed.error ?? 'resume rejected');
                if (resumed.status === 'resumed') {
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    await writeTeam(stateRoot, fresh);
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
                        teamId: fresh.id,
                        reason: args.reason,
                    });
                }
                return {
                    status: resumed.status,
                    team_id: fresh.id,
                    reason: args.reason,
                };
            });
            if (result.status === 'resumed')
                await scheduler.kickTeam(workspace, team.id, captain);
            return result;
        },
    }));
}
