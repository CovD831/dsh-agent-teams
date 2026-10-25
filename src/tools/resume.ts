// ── src/tools/resume.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, stateRootOf, teamLockKey, workspaceOf } from './shared/entities.ts'
import { resumeTeamState, withTeamLock, writeTeam } from '../state.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, scheduler: any, config: ToolsConfig): void {
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
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        const result = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
          const resumed = resumeTeamState(fresh, args.reason)
          if (resumed.status === 'rejected') throw new Error(resumed.error ?? 'resume rejected')
          if (resumed.status === 'resumed') {
            fresh.halted = false
            fresh.haltedAt = undefined
            /**
             * ── ★★★ 2026-10-20：把**计划审查环的显式归零**真的写回盘 ──────────────────
             *
             * MEASURED（本仓实测，一个真实的死锁）：此前这里只写 `halted` / `haltedAt`，
             * 而 `resumeTeamState` 算出来的 `planReviewRounds: 0` / `planReviewEscalated: false`
             * **只存在于它的返回值里** —— 一个字节都没落盘。
             * ⇒ 于是 `approve` 那条闸（读盘上的 `rounds`）照样拒，而错误信息指着
             * `agent_teams_resume` 说"这是唯一出路" —— **那条出路在生产上不存在**。
             *
             * ★★ 为什么用 `resumed.clearedPlanReview` 而不是自己比 `fresh.planReviewRounds`：
             *   "只有超轮才归零"这条规则住在 `resumeTeamState` 里；在这里再比一次
             *   就是第二份真相，而两份真相会漂移。⇒ 让产生归零的那一方说出来。
             *
             * ★ 三态如实保留：没有归零（普通 halt/resume）⇒ 这两格一个字都不动
             *   （与"归零"不同形 —— 一次与计划无关的 halt 不该抹掉"改过几轮"）。
             */
            if (resumed.clearedPlanReview === true && resumed.team !== undefined) {
              fresh.planReviewRounds = resumed.team.planReviewRounds
              fresh.planReviewEscalated = resumed.team.planReviewEscalated
            }
            await writeTeam(stateRoot, fresh)
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
              teamId: fresh.id,
              reason: args.reason,
            })
          }
          return {
            status: resumed.status,
            team_id: fresh.id,
            reason: args.reason,
          }
        })
        if (result.status === 'resumed') await scheduler.kickTeam(workspace, team.id, captain)
        return result
      },
    }))
}
