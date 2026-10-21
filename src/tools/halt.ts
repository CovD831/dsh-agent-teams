// ── src/tools/halt.ts ─────────────────────────────────────────────────
//
// 2026-10-22：模型侧的**终止动作**（`docs/REQUIREMENTS.md` §12 的第三件 / R12.3）。
//
// MEASURED（开工对 17 个工具逐个数）：
//   agent_teams_halt    : false   ← 就是本文件补的那一格
//   agent_teams_resume  : true    ← 能清"超轮"的计划环，但清不了一个**运行中**的队
//   agent_teams_delete  : true    ← 能停，但它**归档**：不可逆
//
// ⇒ `haltTeamWork` 早就在生产上跑（`src/index.ts:467` 的 Web 路由、lifecycle-verify 都在用它），
//   而**模型侧一个入口都没有** —— 于是"循环执行者手里的终止动作"在工具面上不存在。
//   这并不是新造能力：本文件只是把**已有**的那个函数接到工具面上，
//   ★ 一个字符的处理逻辑都不重写（`haltTeamWork` 逐字复用）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { requireCaptain, requireCaptainTeam, stateRootOf, workspaceOf } from './shared/entities.ts'
import { haltTeamWork } from '../tools.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/**
 * ★★ 为什么本文件 `import { haltTeamWork } from '../tools.ts'` 而不是把它搬进来：
 *
 * 那是**唯一**一份实现，而它已经被两条生产路径调用（Web 路由 + 生命周期夹具）。
 * 搬进来会让"停下"这件事有两份判据 —— 而两份判据必然分叉，
 * 分叉之后"界面能停而模型停不了"或反过来，会成为一个更难查的不一致。
 * ★ 与 `src/tools/status.ts` 的 `NOT_EVALUATED_IN_STATUS` 同一条纪律的反面用法：
 *   **可以共享的，就该共享**；只有"这是某个调用点自己的知识"才该各写一份。
 */

/** 注册本文件的工具。 */
export function register(ctx: Context, config: ToolsConfig): void {
  ctx.tools.register(defineTool({
    name: 'agent_teams_halt',
    description: 'Stop a team without destroying it: every unfinished task is cancelled (not removed), members go idle, and the team stays where it is so `agent_teams_resume` can bring it back. Use this when work should pause; use `agent_teams_delete` only when the team is finished or explicitly abandoned, because delete archives it and cannot be undone.',
    parameters: {
      reason: {
        type: 'string',
        required: true,
        description: 'Why the team is being stopped. Recorded in the team event log, so a later reader can tell this apart from a crash.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_name: { type: 'string', required: true },
          /** ★ 已被取消的任务数（本次）。 */
          cancelled_tasks: { type: 'number', required: true },
          /** ★★ 三态之一：`stopped` / `already_halted`。 */
          status: { type: 'string', required: true },
          /** ★ 把「停下」与「删掉」的区别写进返回值，读的人不必去翻文档。 */
          resumable: { type: 'boolean', required: true },
        },
      },
      /**
       * ★★ 渲染面**必须**说出 `resumable`：
       *   一个只说"已停止"的返回值，会让人以为它与 delete 一样是终局。
       *   而它们相反 —— 一个能撤回，一个不能。这正是本仓记账最久的那条：
       *   **两个不同的事不许同形**。
       */
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'already_halted'
          ? `Team "${value.team_name}" was already halted; nothing changed. It is still resumable with agent_teams_resume.`
          : `Team "${value.team_name}" halted: ${value.cancelled_tasks} unfinished task(s) cancelled, members idle, team kept. ` +
            'This is NOT delete — the team still exists and agent_teams_resume can bring it back (cancelled tasks are not recreated).',
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      /**
       * ★ `reason` 是**必填**的，而它不是为了啰嗦：`haltTeamWork` 会把一次 halt 记进
       *   `agent-teams/team-halted` 事件。没有理由的 halt 在事后与"它自己崩了"同形 ——
       *   而两者的补救动作相反（一个去 resume，一个去查为什么崩）。
       *   ★ 与 `agent_teams_resume` 的 `reason` 同一条纪律（那里也是 required）。
       */
      const result = await haltTeamWork({
        ctx,
        stateRoot,
        teamId: team.id,
        captain,
        signal: exec.signal,
      })
      return {
        team_name: result.teamName,
        cancelled_tasks: result.cancelledTasks,
        status: result.alreadyHalted ? 'already_halted' : 'stopped',
        /** ★ 恒为 `true` —— 本工具**只做**可恢复的停止。归档是 `agent_teams_delete` 的事。 */
        resumable: true,
      }
    },
  }))
}
