// ── src/tools/delivery.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { registry } from '../gates/index.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { diagnosticFields, evaluateRuntimeGates, inputSurfaceOf, observeMemberConvergence, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, stateRootOf, teamLockKey, throwWithSurface, withInputSurfaceOnError, workspaceOf } from './shared/entities.ts'
import { buildCoverageMatrix, canDeclareDelivery, describeQualityLoop, resumeTeamState, withTeamLock, writeTeam } from '../state.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, clock: any, config: ToolsConfig): void {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
      name: 'agent_teams_declare_delivery',
      /**
       * ★ 这是 delivery 位置的【宣告点】（t18/B2）。
       *
       * 为什么必须单独存在一个工具：delivery 位置的判据（coverage / convergence）是
       * **裁决**，而裁决需要一个名副其实的落点。此前它挂在 `agent_teams_status` 上
       * —— 那是个**读取**操作，于是一个还没收敛的团队连"现在什么情况"都读不到，
       * 队长瞎着眼修不了任何东西。**「唯一的读取点」不等于「宣告点」。**
       *
       * ⇒ 读取（status）随时能发生、只报告；宣告（本工具）才被拒绝。
       */
      description: 'Captain-only delivery declaration: asks the delivery insertion point whether this team may be reported to the user as delivered, and REFUSES when it may not (uncovered goals, members that never converged, unfinished quality gates). Use it right before telling the user the work is done. agent_teams_status only REPORTS the same verdict without refusing, so reading team state never blocks.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...diagnosticFields({ inputSurface: true }),
            team_id: { type: 'string', required: true },
            declared: { type: 'boolean', required: true },
            blockers: { type: 'array', items: { type: 'string' }, required: true },
            gates_evaluated: { type: 'number', required: true },
            loop_state: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.declared
            ? `Delivery declared for team ${value.team_id} (${value.gates_evaluated} delivery gate(s) evaluated).`
            : `Delivery refused for team ${value.team_id}: ${value.blockers.join('; ')}`,
        }],
      },
      async execute(_args, exec) {
        const caller = requireCaptain(exec)
        const workspace = workspaceOf(caller)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, caller)
        const coverage = buildCoverageMatrix(
          [...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))],
          team.tasks,
        )
        const deliveryCheck = canDeclareDelivery(team)
        const memberConvergence = observeMemberConvergence(ctx, team)
        const deliveryContext = {
          team,
          gate: deliveryCheck,
          coverage,
          ...memberConvergence === undefined ? {} : { members: memberConvergence },
        }
        /**
         * ★ 与 status 用【同一个】求值面：报告与宣告必须读同一份事实，否则
         *   "status 说能交、declare 说不能"会成为一个新的、更难查的不一致。
         *
         * ★ 输入面核对（t10）：同样在求值之前、对着同一个 ctx。★ 它**不参与**下面
         *   的拒绝 —— 核对报缺时这条宣告照常走完（先软后硬）。一个自己还没被验证过
         *   的新机制当场否决交付，正是本队反复踩的形态。
         */
        const deliveryInputSurface = inputSurfaceOf('delivery', deliveryContext)
        const evaluation = await registry.evaluate('delivery' as never, deliveryContext)
        const loop = describeQualityLoop(team)
        /**
         * ★ `unmeasured` 与 `blockers` 必须【不同形】（契约 §3.4）：前者是"没能测量"，
         *   后者是"发现了问题"。合并成一句话会让读日志的人把"没测成"读成"查出了问题"。
         *   ——这正是既有 `rejectOnDeliveryGates` 的分法，这里与它同形。
         *
         * ★★ t3：两处拒绝都改成 `throwWithSurface` —— 被拒的宣告里，
         *   "是交付本身不允许"与"是这个位置的输入面没接完"必须**同时读得到**。
         */
        /**
         * ── ★★★ t64：先区分「没检查」与「真的被拒」─────────────────────────────────
         *
         * MEASURED（t58 第一半之后，本任务的实测）：
         *
         *     `registry.evaluate('delivery', {})` ⇒ `ok:false` + `skippedAll` 在场
         *       （该位置挂了 2 条判据，而这一轮一条都没适用）
         *     ⇒ 而下面那一行读 `ok === false` 就拒 ⇒ **把"没检查"变成了"假拒绝"**。
         *
         * ★ 而基线（t58 之前）这里是 `ok:true`（放行）——
         *   所以这是 t58 带来的**新**后果，而它是**不可接受**的：
         *   一个安全约束**不触发**时，正确的形状不是「拒绝一切」，而是
         *   「放行，并留下它没被检查的痕迹」。
         *
         * ── 三态（契约要求：三者不同形）──────────────────────────────────────────
         *
         *     ① 没检查（`ok:false` + `skippedAll`）    ⇒ **放行** + 告警（不拒绝）
         *     ② 检查了而通过（`ok:true`）              ⇒ 放行，不告警
         *     ③ 检查了而拒绝（blockers / unmeasured）  ⇒ 拒绝（下面的分支不变）
         *
         * ★ 而 `unmeasured`（判据跑了、说它测不了）**仍然拒绝** ——
         *   那是既有语义，本任务不动它。它与①的差别是 `evaluated`：① 是
         *   `evaluated === 0`（一条都没跑），`unmeasured` 是 `evaluated >= 1`。
         *   ⇒ 两者**不同形**，而这条区分由注册表保证（t58 第一半）。
         *
         * ★ 为什么用 `skippedAll` 而不是 `evaluated === 0` 作为判据：
         *   `skippedAll` 是注册表**显式**产出的那个说明（"这一步没被检查"）；
         *   而 `evaluated === 0` 在空位置（`registered === 0`）上也成立 ——
         *   那时它是"这里本来就没有判据"，是正常情形。⇒ 用前者更精确。
         */
        const notChecked = evaluation.ok === false && evaluation.skippedAll !== undefined
        if (notChecked) {
          ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with nothing evaluated (${evaluation.registered} registered, all skipped); delivery was NOT checked — allowing it through, because "not checked" is not "refused"`)
        }
        if (!notChecked && (evaluation.ok === false || deliveryCheck.ok === false)) {
          if (evaluation.unmeasured !== undefined) {
            throwWithSurface(`declare_delivery rejected: the delivery gate could not measure (${evaluation.unmeasured})`, deliveryInputSurface)
          }
          throwWithSurface(`declare_delivery rejected: ${[
            ...deliveryCheck.blockers,
            ...evaluation.blockers,
          ].join('; ')}`, deliveryInputSurface)
        }
        /**
         * ★ t64：这条告警**上移进了 `notChecked` 分支**（见上面那段）。
         *   ★ 合并而不是保留两处：同一件事报两遍会让"这两条日志说的是不是同一件事"
         *     变成一个要读两处才能回答的问题 —— 而它们是同一件事。
         *   ★ 而措辞变了：新的一句把**判定**也说出来（"allowing it through,
         *     because not-checked is not refused"），旧的那句只说"was not checked"。
         *     ⇒ 一个只说"没检查"而裁决却是"拒绝"的告警，正是 t64 要修的那个矛盾。
         */
        /**
         * ★★ t3：这条日志**保留**（给人看）；结构化出口在下面返回值的 `input_surface`。
         */
        if (deliveryInputSurface !== undefined && deliveryInputSurface.incomplete > 0) {
          ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with an unfinished input surface (recorded, not rejected): ${deliveryInputSurface.missing.join('; ')}`)
        }
        await evaluateRuntimeGates(ctx, 'delivery-declared', deliveryContext, clock)
        void stateRoot
        return {
          team_id: team.id,
          declared: true,
          blockers: [],
          gates_evaluated: evaluation.evaluated,
          loop_state: loop.state,
          /**
           * ★★ 与 `agent_teams_status` 完全同一个形状（同一个构造点、同一个字段名）：
           *   那两个入口是同一份核对的两个时刻，"报告"与"宣告"读到的结论必须可机械比对，
           *   否则"status 说输入面齐、declare 说有缺格"会成为一个新的、更难查的不一致。
           *   三态同前：齐（0）/ 有缺格（N + 名单）/ 这个位置没判据（字段不出现）。
           */
          ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },
        }
      },
    })))
}
