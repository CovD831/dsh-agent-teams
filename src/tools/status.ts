// ── src/tools/status.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { registry } from '../gates/index.ts'
import { mailboxContent, readCurrentMailbox } from '../mailbox.ts'
import { TERMINAL_TASK_STATUSES } from '../types.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { ModuleFreshness, diagnosticFields, evaluateRuntimeGates, inputSurfaceOf, inputSurfaceSchema, moduleFreshness, moduleFreshnessMessage, observeMemberActivity, observeMemberConvergence, requireCaptain, requireFreshParticipant, requireParticipantTeam, stateRootOf, teamLockKey, throwWithSurface, workspaceOf } from './shared/entities.ts'
import { memberActivity } from '../members.ts'
import { CAPTAIN_KEY, acknowledgeMailbox, buildCoverageMatrix, canDeclareDelivery, describeQualityLoop, taskKindOf, withTeamLock } from '../state.ts'
import { AgentTeamsRuntime, renderStatus } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_status',
      description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Use after mailbox progress deliveries or for an explicit status request. After dispatch, end your turn while members work; do not repeatedly poll.',
      parameters: {},
      output: {
        /**
         * ── ★★ 这一格此前是 `additionalProperties: true, properties: {}`（t14 修）────
         *
         * MEASURED（2026-10-06，t14）：`agent_teams_status` 是**唯一**一个"看起来没坏"
         * 的工具 —— 上面那条臂跑到它的时候是绿的。而它绿的原因不是"声明对了"，
         * 是**它什么都没声明**：一个 `additionalProperties: true` 的空 schema
         * 接受任何对象，于是"字段加进去了"与"字段被声明了"在这里**同形**。
         *
         * ⇒ 这是同族缺陷的**另一种极端**，而且比 `additionalProperties: false` 那种
         *   更难发现：前者至少会当场炸（本任务就是被炸出来的），后者**永远安静**，
         *   直到有人真的想用 schema 读这份快照为止。
         *
         * ★ 修成闭合声明：`status` 的快照字段全部列出，四个诊断字段里它真的会返回的
         *   两格（`input_surface` / `runtime_gates`）由 `diagnosticFields` 取。
         * ★ 修成闭合声明。★ 而**这一版不是第一版**：第一版我手写了十来个"看起来该有"
         *   的属性，`scripts/capabilities.test.mjs` 当场在真实路径上炸了 ——
         *
         *     tool "agent_teams_status" returned invalid output:
         *     "value.halted" / "value.escalated" / "value.loop_state" /
         *     "value.loop_summary" / "value.deliverable" / "value.coverage" /
         *     "value.delivery" / "value.member_inbox" / "value.member_inboxes" /
         *     "value.mailbox_warnings" / "value.mailbox_warning_count"
         *     — not a declared property (additionalProperties: false)
         *
         *   ⇒ **同一个缺陷、同一个方向、同一个下午**：手写一份声明面，它必然落后于
         *     真实的产出面。把这一格改成 `additionalProperties: true` 会让我自己的
         *     夹具全绿，而那等于把 `status` 退回原样（"没声明"与"声明对了"再次同形）。
         *   ⇒ 所以下面这张属性表是**照着 `execute` 的返回对象逐个抄下来的**
         *     （见 `const result = { … }`），并由
         *     `scripts/gate-tool-output-schema.test.mjs` 的臂 4 逐工具核对。
         */
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            team_id: { type: 'string' },
            team_name: { type: 'string' },
            description: { type: 'string' },
            phase: { type: 'string' },
            /**
             * 质量循环的五个读数（`describeQualityLoop`）—— 第一版全漏了。
             * ★ 类型逐条对着 `QualityLoopSnapshot` 抄：`deliverable` 是 **boolean**
             *   （我第一版写成 string，TS2322 当场指出）—— 这正好说明"声明面必须与
             *   真实的产出面逐字一致"不是一句口号：类型系统在这里就是第一道臂。
             */
            halted: { type: 'boolean' },
            escalated: { type: 'boolean' },
            loop_state: { type: 'string' },
            loop_summary: { type: 'string' },
            deliverable: { type: 'boolean' },
            /**
             * ★ `coverage` 是**数组**（每条目标一条 `{goal_item, task_ids, status, evidence?}`），
             *   不是对象 —— 我第一版写成 object，TS2322 当场指出。逐条对着
             *   `canDeclareDelivery` 的返回抄。
             */
            coverage: { type: 'array' as const, items: { type: 'json' as const } },
            /**
             * ★ `delivery` 是**这一格自己的**嵌套：它的字段集由本文件产出，
             *   所以闭合声明。它的 `input_surface` 是 delivery 位置的核对结论
             *   —— 挂在这里而不是顶层，与 `execute` 里的落点逐字一致。
             */
            delivery: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean' },
                /**
                 * ── ★★ 这个位置的三态各有自己的字段（t35 / f-0017）────────────────────
                 *
                 * MEASURED（verifier6 的普查臂 1/2/3）：此前这里**只有** `blockers`，
                 * 而"没能测量"在 `execute` 里被**拼进 blockers 数组**
                 * （`could not measure: …`）。
                 *
                 * ⇒ 后果不是"措辞不够清楚"，是**结构上无处安放**：这个对象是
                 *   `additionalProperties: false`，字段集就是上面那几个 ——
                 *   于是"没能测量"**只能**挤进 `blockers`。
                 *
                 * ★ 而 `blockers` 的原意是「**测出来了、是坏的**」。把"没能测量"
                 *   并进去，等于把两种相反的事实放进同一个出口：
                 *
                 *     测到了问题  ⇒ 去修产物
                 *     没能测量    ⇒ 去接线 / 去看基础设施
                 *
                 * ★★ 而 `delivery` 今天**恒** unmeasured（`coverage` 与 `convergence`
                 *   两格在没有 goal 矩阵 / 没有成员观察时必报）⇒ 那是一条**每次都出现**
                 *   的假拒绝理由。一个恒常出现的假告警不会只是"多报一次"，它会教人
                 *   **永久忽略整个 `blockers` 字段** —— 那正是本队反复记账的代价。
                 *
                 * ⇒ 与**同位置的另一个入口** `declare_delivery` 同形：它早已用独立分支
                 *   （`throwWithSurface`）把 unmeasured 与 blockers 分开。两处的 ctx
                 *   逐字段相同（刻意设计）⇒ **ctx 相同保护不了消费方式**，
                 *   读法必须各自正确。
                 *
                 * ★ 缺席（`undefined`）与空串不同形：没产出这一格 ⇒ 属性不出现。
                 */
                unmeasured: { type: 'string' },
                blockers: { type: 'array', items: { type: 'string' } },
                gates_evaluated: { type: 'number' },
                input_surface: inputSurfaceSchema(),
              },
            },
            /**
             * ★ `runtime_gates` 是顶层那一格（`runtimeRecord`）；泛用名 `input_surface`
             *   **不在顶层** —— delivery 的核对结论挂在 `delivery.input_surface` 里。
             *   ⇒ 这里只取 `runtimeGates`，不取 `inputSurface`：
             *     声明一个它从不返回的字段，与漏声明一个是同一条错误的两个方向。
             */
            /**
             * ── ★★ 部署状态：**从插件进程**读到的构建新鲜度（t34 / f-0027）─────────────
             *
             * ── 它修的是什么 ──────────────────────────────────────────────────────────
             *
             * MEASURED（f-0027，captain 记的）：此前 captain 只能**用命令行**问检测器：
             *
             *     node -e "import('./lib/tools.js').then(m => m.moduleFreshness())"
             *
             * ★ 而那条命令**每次都起一个新进程**、加载**最新的** `lib/` ⇒
             *   它读到的 `loaded` 永远是它自己刚加载的那一份 ⇒ **必然报 `current`**。
             *   ⇒ 「重启后检测器说 current」那句话**从来没有测过插件进程**。
             *
             *   证据（他实测的两次读数）：`loaded` 从 `b2103754…` 变成 `670b5c22…`
             *   —— 而那是**两个命令行进程各自加载的**，不是插件进程变过。
             *
             * ★ 形态：**「读错位置的出口」的又一实例** ——
             *   从一个不属于那个位置的地方读了值。
             *
             * ── 为什么挂在 `status` 上 ───────────────────────────────────────────────────
             *
             *   `status` 是 captain **与成员**都会调的读取入口，而新鲜度是"这个进程"的属性
             *   —— 谁调它，读到的都是**同一个插件进程**的真相。
             *   ⇒ 一次 `status` 就能回答"我该不该重载"，不必再猜。
             *
             * ── ★ 三态不同形，且**不参与裁决** ─────────────────────────────────────────
             *
             *   `current` / `stale` / `unknown` 三态由 `ModuleFreshness` 给出，
             *   而**读不到**与**一致**必须不同形（`unknown` ≠ `current`）。
             *   ★ 它是**部署状态的读数**，不是判据结论 ⇒ **不得**让 `status` 因此拒绝。
             *     让它有否决权会把"这个进程旧了"变成"你这次读取失败"。
             */
            deployment: {
              type: 'object',
              additionalProperties: false,
              properties: {
                /** ★ 三态之一；**`unknown` 必须与 `current` 不同形**。 */
                status: { type: 'string', required: true },
                /** 加载时读到的那份指纹（`unknown` 且加载时也读不到 ⇒ 缺席）。 */
                loaded: { type: 'string' },
                /** 此刻盘上的指纹（`unknown` 且盘上也读不到 ⇒ 缺席）。 */
                on_disk: { type: 'string' },
                /** 未能测量时的成因（`unknown` 时在场）。 */
                reason: { type: 'string' },
                /** ★ 一句人话（含"该不该重载"）。 */
                message: { type: 'string', required: true },
                /**
                 * ── ★★ f-0026：两个 git 维的字段（与 `loaded` / `on_disk` 并列）──────
                 *
                 * ★ 它们**不合成一个布尔**：`output` 维问的是「盘上自本进程启动以来
                 *   有没有被 rebuild 过」，`commit` 维问的是「本进程加载的是哪个
                 *   commit 的代码」—— 两个问句，各自可读。
                 *
                 * ★ 这正是本任务要修的那一格：进程启动【之前】盘上就已经是当前版时，
                 *   两个 output 相等 ⇒ 旧读数恒报 `current`，而那时的代码仍可能是
                 *   更早 commit 的。⇒ 少了这一维，那个情形**没有任何出口报得出来**。
                 */
                built_commit: { type: 'string' },
                head: { type: 'string' },
                /** 落后的是哪一维（`stale` 时在场；`content` / `commit` / `both`）。 */
                stale_why: { type: 'string' },
                /** ★ 落后于哪个提交（只在 commit 维真的落后时在场）。 */
                behind: { type: 'string' },
              },
            },
            ...diagnosticFields({ runtimeGates: true }),
            profile: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
                protocol: { type: 'string' },
                task_planning: { type: 'string' },
              },
            },
            viewer: { type: 'string' },
            members: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            tasks: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            captain_inbox: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            /** ★ 成员视角的两格收件箱 + 两格告警 —— 第一版也全漏了。 */
            member_inbox: {
              type: 'array',
              items: { type: 'object', additionalProperties: true, properties: {} },
            },
            member_inboxes: { type: 'object', additionalProperties: true, properties: {} },
            mailbox_warnings: { type: 'array', items: { type: 'string' } },
            mailbox_warning_count: { type: 'number' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
      },
      async execute(_args, exec) {
        const caller = requireCaptain(exec)
        const workspace = workspaceOf(caller)
        const stateRoot = stateRootOf(workspace, config)
        const located = await requireParticipantTeam(workspace, config, caller)
        if (located.captainSessionId === caller.id) {
          await scheduler.kickTeam(workspace, located.id, caller)
        }
        const { team, identity } = await withTeamLock(
          teamLockKey(stateRoot, located.id),
          () => requireFreshParticipant(stateRoot, located.id, caller.id),
        )
        const activity = memberActivity(ctx, team.members.map((member) => member.id))
        const members = team.members
          .filter((member) => member.status !== 'removed')
          .map((member) => ({
            name: member.name,
            role: member.role ?? '',
            provider: member.provider ?? '',
            model: member.model ?? '',
            reasoning_effort: member.reasoningEffort ?? '',
            status: member.status,
            activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
            ...member.spawnError === undefined ? {} : { spawn_error: member.spawnError },
          }))
        const tasks = team.tasks.map((task) => ({
          id: task.id,
          subject: task.subject,
          status: task.status,
          assignee: task.assignee ?? '',
          dependencies: task.dependencies,
          attempt: task.attempt ?? 0,
          attempt_id: task.attemptId ?? '',
          reassigning: task.reassigning === true,
          kind: taskKindOf(task),
          ...task.round === undefined ? {} : { round: task.round },
          ...task.verdict === undefined ? {} : { verdict: task.verdict },
          ...task.supplementalEvidence === undefined ? {} : { supplemental_evidence: JSON.stringify(task.supplementalEvidence) },
          findings_open: (task.findings ?? []).filter((finding) => finding.resolved !== true).length,
          ...task.profileSeedId === undefined ? {} : { seed_id: task.profileSeedId },
          ...task.output !== undefined ? { output: task.output } : {},
        }))
        const mailboxWarnings: string[] = []
        let mailboxWarningCount = 0
        const reportMalformed = (agentKey: string) => (lineNumber: number): void => {
          mailboxWarningCount += 1
          if (mailboxWarnings.length < 10) {
            mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`)
          }
        }
        const captainInbox = identity.kind === 'captain'
          ? await readCurrentMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
          : []
        const ownInbox = identity.kind === 'member' ? (await readCurrentMailbox(stateRoot, team.id, identity.name)).slice(0, 10) : []
        const memberInboxes: Record<string, { count: number; latest: string }> = {}
        const visibleMembers = identity.kind === 'captain'
          ? members
          : members.filter((member) => member.name === identity.name)
        for (const member of visibleMembers) {
          const messages = await readCurrentMailbox(
            stateRoot,
            team.id,
            member.name,
            reportMalformed(member.name),
          )
          if (messages.length > 0) {
            memberInboxes[member.name] = {
              count: messages.length,
              latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
            }
          }
        }
        const coverage = buildCoverageMatrix(
          [...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))],
          team.tasks,
        ).map((row) => ({
          goal_item: row.goal_item,
          task_ids: [...row.task_ids],
          status: row.status,
          ...row.evidence === undefined ? {} : { evidence: row.evidence },
        }))
        const deliveryCheck = canDeclareDelivery(team)
        /**
         * ── ★ delivery 位置：**报告**在这里，**拒绝**在 declare_delivery（t18/B2）────
         *
         * MEASURED（2026-10-05，本队 t16/t17）：本工具此前直接调用拒绝逻辑
         * （`rejectOnDeliveryGates`），于是一个团队只要还没收敛，队长**连"现在什么情况"
         * 都读不到** —— 而读不到状态正是他判断"该不该让它收敛"的前提。**死结**：
         *
         *     想看状态 ⇒ 被拒（因为没收敛）
         *     想让成员收敛 ⇒ 得先看状态
         *
         * ★ 根因是**「唯一的读取点」被当成了「宣告点」**。它们是两件事：
         *     · 读取（本工具）—— 随时都该能发生，否则队长瞎着眼
         *     · 宣告（`agent_teams_declare_delivery`）—— 那才是该被拒绝的那一刻
         *
         * ⇒ 现在这里**只求值、只报告**：裁决并进返回值的 `delivery` 字段（连同判据层的
         *   blockers），流程照常。拒绝由新增的 `agent_teams_declare_delivery` 承载
         *   —— **delivery 判据仍然真的会拦，只是拦在它该拦的那一步**。
         */
        const memberConvergence = observeMemberConvergence(ctx, team)
        /**
         * ── ★ 调用点②（第三条入口）：读一次会话日志，看每个成员还在不在动 ─────────
         *
         * 这里是**最自然**的观察点，理由有两条，缺一条都不够：
         *
         *   ① 它本来就在读会话（`observeMemberConvergence` 已走同一个入口），所以多读
         *      一遍 `assistant/message` **不引入新的 I/O**；
         *   ② 它是探活的**驱动时刻**（用户已裁定：10 分钟探活一次）。判据只在被调用的
         *      那一刻才说话，而"被调用"发生在这里 —— 所以**观测与探活必须是同一刻**，
         *      否则判据读到的是一个上次探活留下的陈旧读数，而它看起来与新鲜读数同形。
         *
         * ★ 观察**先于**求值：本段在下面的 `evaluateRuntimeGates` 之前跑，于是这一次
         *   求值读到的 `lastActivityAt` 是刚刚观察到的。反过来会让一次探活永远是
         *   "上一次"的视图 —— 而那正是"两次探活读数没变 ⇒ 报警"的假阳性来源。
         *
         * ★ 对**每个**未结束任务的成员都观察，不只是当前忙的那些：一个成员可能刚刚
         *   产出、然后回到 idle，而"它动过"这件事必须留在记录里（否则下一次探活会
         *   把它读成"从派发到现在一直没动"）。
         */
        const now = clock()
        for (const task of team.tasks) {
          if (TERMINAL_TASK_STATUSES.includes(task.status)) continue
          if (task.assignee === undefined || task.assignee === CAPTAIN_KEY) continue
          const activeMember = team.members.find(candidate => candidate.name === task.assignee)
          if (activeMember === undefined || activeMember.id === '') continue
          observeMemberActivity(ctx, activeMember.id, task.attemptId, now)
        }
        const deliveryContext = {
          team,
          gate: deliveryCheck,
          coverage,
          ...memberConvergence === undefined ? {} : { members: memberConvergence },
        }
        /**
         * ★ 只报告：这里**不**抛错。`delivery` 字段要把【两边的结论】都交出去 ——
         *   上游 `canDeclareDelivery` 的 blockers 与判据层的裁决，缺一样读日志的人就
         *   分不出"是契约层面不允许"还是"是某条判据发现了问题"。
         */
        /**
         * ★ 输入面核对（t10）：求值之前，对着**同一个** ctx。这里与 `task-status`
         *   是**两个**调用点，各自核对一次 —— 不是因为会得到不同结论，而是因为
         *   "报告"与"宣告"这两个入口必须都读得出输入面缺没缺（只在一个入口核对，
         *   另一个入口的缺失就成了只能靠日志碰运气看见的东西）。
         */
        const deliveryInputSurface = inputSurfaceOf('delivery', deliveryContext)
        const deliveryEvaluation = await registry.evaluate('delivery' as never, deliveryContext)
        const runtimeRecord = await evaluateRuntimeGates(ctx, 'task-status', deliveryContext, clock)
        /**
         * ★★ t3：这条日志**保留**（给人看）；结构化出口挂在下面 `delivery` 字段里的
         *   `input_surface`。两条并存 —— 只留日志的出口在日志被截断时与"输入面齐"同形。
         */
        if (deliveryInputSurface !== undefined && deliveryInputSurface.incomplete > 0) {
          ctx.logger.warn(`agent-teams: the status read reached the delivery gate with an unfinished input surface (recorded, not rejected): ${deliveryInputSurface.missing.join('; ')}`)
        }
        const delivery = {
          ok: deliveryEvaluation.ok === false ? false : deliveryCheck.ok,
          /**
           * ── ★★ "没能测量"有**自己的**出口，不再拼进 blockers（t35 / f-0017）─────────
           *
           * MEASURED（verifier6 的普查臂 1/2/3）此前这里是：
           *
           *     blockers: [ ..., ...deliveryEvaluation.unmeasured === undefined
           *                    ? [] : [`could not measure: ${deliveryEvaluation.unmeasured}`] ]
           *
           * ⇒ 把「没能测量」写进了「测出来了、是坏的」那个数组。★ 而这不是措辞问题：
           *   读者按字段名判断**该去修什么**，而两种事实的补救动作相反：
           *
           *     测到了问题  ⇒ 去修产物（交付确实不合格）
           *     没能测量    ⇒ 去接线（这一格根本没被读到）
           *
           * ★★ 更贵的是它的**恒常性**：`delivery` 今天恒 unmeasured（`coverage` 与
           *   `convergence` 在没有 goal 矩阵 / 成员观察时必报）⇒ **每一次** status 都往
           *   `blockers` 里加一条。一个每次都出现的假告警，代价不是"多读一行"，
           *   是教人**永久忽略 `blockers`** —— 那时真正的问题也一起被忽略。
           *
           * ★ 与同位置的 `declare_delivery` 同形：它早就是独立分支（`throwWithSurface`
           *   带着 `could not measure` 的措辞拒绝），而 status 把它并进 blockers。
           *   两处 ctx 逐字段相同（刻意设计）⇒ **ctx 相同保护不了消费方式**。
           *
           * ★ `undefined` 与空串不同形：没产出 ⇒ 属性**不出现**（与 `input_surface`
           *   同一条纪律）。写一个 `unmeasured: undefined` 会让"没测到"与"有一个空的
           *   测量结果"在 `Object.hasOwn` 那一层同形。
           */
          ...deliveryEvaluation.unmeasured === undefined ? {} : { unmeasured: deliveryEvaluation.unmeasured },
          blockers: [
            ...deliveryCheck.blockers,
            ...deliveryEvaluation.blockers,
          ],
          /**
           * ★ 判据层有没有就交付说话。`false` 表示这个位置这一轮没有任何判据求值
           *   —— 与"判据都通过了"不同形（那正是本队反复强调的那条分界）。
           */
          gates_evaluated: deliveryEvaluation.evaluated,
          /**
           * ── ★★ t3：核对结论**随这次读取一起交出去**（与 runtime 同形）───────────
           *
           * ★ 挂在这里而不是 `result` 的顶层：它说的**就是**这次交付位置求值的输入面，
           *   而 `delivery` 已经是"这次交付裁决"的落点（`ok` / `blockers` /
           *   `gates_evaluated`）。顶层多一个同名字段会让"哪一份属于哪个位置"读不出来，
           *   而本队已经吃过"读错位置的出口"那一次（挂 A 位置却读 B 位置独有字段）。
           *
           * ★ 三态：都齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/ 这个位置这一轮
           *   没挂判据（**字段不出现** —— 不是 `ok`）。
           */
          ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },
        }
        const loop = describeQualityLoop(team)
        const result = {
          team_id: team.id,
          team_name: team.name,
          description: team.description ?? '',
          phase: team.phase ?? 'running',
          halted: loop.halted,
          escalated: loop.escalated,
          loop_state: loop.state,
          loop_summary: loop.summary,
          deliverable: loop.deliverable,
          coverage,
          delivery,
          ...team.profile === undefined ? {} : {
            profile: {
              name: team.profile.name,
              ...team.profile.protocol === undefined
                ? {}
                : { protocol: team.profile.protocol.slice(0, 240) },
              ...team.profile.taskPlanning === undefined ? {} : { task_planning: team.profile.taskPlanning },
            },
          },
          viewer: identity.name,
          ...runtimeRecord === undefined ? {} : { runtime_gates: runtimeRecord },
          /**
           * ── ★★ 从**这个插件进程**读到的构建新鲜度（t34 / f-0027）──────────────────
           *
           * 挂在 `status` 的返回值上，于是**一次 status 调用**就回答了
           * "我该不该重载" —— 而不是像此前那样用命令行去问一个**别的进程**
           * （那永远报 `current`，见 schema 里那段 MEASURED）。
           *
           * ★ 字段名用 `on_disk`（下划线）与其余工具字段一致；
           *   而内部的 `ModuleFreshness` 是 `onDisk`（驼峰）—— 这里做一次**显式映射**。
           *   ⇒ 同一个概念在两个命名空间各有一个拼法，而映射只写一次、只写在这里。
           *
           * ★ **恒在场**（读不到也算在场，值里带 `reason`）：与 `observed` / `outputs`
           *   同一条纪律 —— 调用方不必写 `?? …`，而"没能测量"由 `status: 'unknown'`
           *   表达，不靠**字段缺席**（缺席与"没有这个概念"同形）。
           */
          deployment: (() => {
            const freshness = moduleFreshness()
            /**
             * ★ 逐字段**显式映射**，不用展开运算符糊过去：
             *   `ModuleFreshness` 是三态联合，只有 `current` / `stale` 才有 `onDisk`。
             *   ⇒ 用展开写会命中 TS2339（我第一版就是）—— 而那恰好说明
             *     "三态在类型上真的不同形"，不是一句注释。
             */
            const base = {
              status: freshness.status,
              message: moduleFreshnessMessage(freshness),
              ...freshness.loaded === undefined ? {} : { loaded: freshness.loaded },
              /**
               * ★★ f-0026：两个 git 维的字段与 `loaded` / `on_disk` **并列**，
               *   不合成一个布尔 ——「内容变没变」与「代码落后没落后」是两个问句。
               *   ★ `behind` 只在 commit 维真的落后时出现；它指明落后于哪个提交，
               *     因为只说"旧了"仍然要人去猜从哪旧起。
               */
              ...freshness.commit === undefined ? {} : { built_commit: freshness.commit },
              ...freshness.head === undefined ? {} : { head: freshness.head },
            }
            if (freshness.status === 'unknown') return { ...base, reason: freshness.reason }
            return {
              ...base,
              on_disk: freshness.onDisk,
              ...freshness.status !== 'stale' ? {} : { stale_why: freshness.why },
              ...freshness.status !== 'stale' || freshness.behind === undefined ? {} : { behind: freshness.behind },
            }
          })(),
          members,
          tasks,
          captain_inbox: captainInbox.slice(0, 10).map((message) => ({
            from: message.from,
            content: mailboxContent(message),
            ts: message.ts,
          })),
          member_inbox: ownInbox.map(message => ({ from: message.from, content: mailboxContent(message), ts: message.ts })),
          member_inboxes: memberInboxes,
          mailbox_warnings: mailboxWarnings,
          mailbox_warning_count: mailboxWarningCount,
        }
        const acknowledged = identity.kind === 'captain'
          ? captainInbox.slice(0, 10).map(message => message.id)
          : ownInbox.map(message => message.id)
        if (acknowledged.length > 0) {
          await withTeamLock(teamLockKey(stateRoot, team.id), () => (
            acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)
          ))
        }
        return result
      },
    }))
}
