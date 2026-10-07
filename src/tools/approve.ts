// ── src/tools/approve.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { requireCaptain, requireCaptainTeam, workspaceOf } from './shared/entities.ts'
import { AgentTeamsRuntime } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, approveStagedTeam: AgentTeamsRuntime['approveStagedTeam'], runtime: AgentTeamsRuntime, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_approve',
      description: 'Approve and start a staged team plan. Call this only in response to an explicit user approval in a new user turn; never call it during the turn that created or edited the plan. The Web Approve & Run button uses the same runtime directly.',
      parameters: {
        confirmation: { type: 'string', required: true, description: 'The user\'s explicit approval statement.' },
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
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Team ${value.team_id} approved and running (${value.members} members, ${value.tasks} tasks).`,
        }],
      },
      async execute(args, exec) {
        if (args.confirmation.trim() === '') throw new Error('explicit user approval text is required')
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const team = await requireCaptainTeam(workspace, config, captain)
        const approved = await approveStagedTeam(captain, team.id, exec.signal)
        return { status: 'running', team_id: approved.teamId, members: approved.members, tasks: approved.tasks }
      },
    }))
}
