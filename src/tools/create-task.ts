// ── src/tools/create-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { captainOpenTask, diagnosticFields, evaluateRuntimeGates, memberOpenTask, rejectOnContractGates, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireMember, requireTask, runVerifyCommand, stateRootOf, stopTeamMemberActivations, throwWithSurface, teamLockKey, withInputSurfaceOnError, workspaceOf, loadVerifyCommandRules, } from './shared/entities.ts'
import { CAPTAIN_KEY, beginTaskAttempt, discardMailboxMessages, invalidateTaskAttempt, normalizeBlankOptionalTaskFields, readTeam, readUnreadMailbox, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, unsatisfiedDependencies, validateCreateTask, withTeamLock, writeTeam } from '../state.ts'
import { TaskKind, TeamTask } from '../types.ts'
import { registry } from '../gates/index.ts'
import { wireDispatch, type DispatchWiringInput } from './update-task/dispatch.ts'
import { AgentTeamsRuntime } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
      name: 'agent_teams_create_task',
      description: 'Create a task in your team\'s task list. Use kind=work (default) for research, repository audits and general tasks. kind=review is only a quality gate for an existing implementation/repair task via reviewedTaskId. Every call must include a non-empty subject, including verification and review tasks. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Required non-empty title for this task. Never omit it, including for verification or review tasks.' },
        description: { type: 'string', description: 'What needs to be done, in detail.' },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task ids this task depends on (must be completed before this task can be claimed).',
        },
        assignee: { type: 'string', description: 'Member name when an owner is specified. Omission puts this task in the shared pool; roles, subjects and descriptions do not assign an owner.' },
        kind: {
          type: 'string',
          enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
          description: 'Explicit task kind. Omission means work with no quality gates, even if the subject says implementation/review. Quality kinds require a contract. An implementation may be planned before requirements passes when its dependency chain includes that requirements task.',
        },
        round: { type: 'number', description: '1-based review / requirements / repair round.' },
        objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
        inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
        outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
        verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
        deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable paths or names.' },
        nonGoals: { type: 'array', items: { type: 'string' }, description: 'Explicit non-goals.' },
        reviewedTaskId: { type: 'string', description: 'Existing AgentTeams implementation/repair task id. Required for kind=review; an external repository audit is kind=work.' },
        /**
         * ── ★★★ t9：那份「已审查」的盖章 —— 而它**不是必填** ────────────────────────
         *
         * ★ 路由规则（`friction-triage` 的 `reviewStateOf`）：带 `reviewed` ⇒ 放行；
         *   不带 ⇒ **派之前必须先审一遍**。
         *   ⇒ 而"不带"**不是错误** —— 它是"这条路没走自动生成"（问过用户、用户裁决过的）的正规形态。
         *   ★★ 所以这里**不许**把它标 required：标了会让每一条手工裁决的任务都建不出来，
         *     而那一类任务正是这条规则要服务的那一类。
         *
         * ★ 形状是 `{ at, by, checks[] }`（t2 在 `src/types.ts` 落的 `ReviewedStamp`）——
         *   逐条 checks 而不是一个布尔：**一个 `reviewed: true` 与一个"逐条写着五问结果"的格子，
         *   在被路由程序读到的那一刻同形**，而它们的可信度完全不同。
         */
        reviewed: {
          type: 'object',
          additionalProperties: false,
          description: 'A review stamp: {at, by, checks[]}. Optional — its absence means "not reviewed yet", which is a normal state (a task the user ruled on did not go through auto-generation).',
          properties: {
            /**
             * ── ★★ 而 `at` / `by` / `checks` 三个都是【必填的 **内部** 字段】──────────────
             *
             * ★ 而"必填"在这里有**两层**，不许混：
             *     `reviewed` 这一格本身        ⇒ ★ **可选**（缺席 = 还没审，是正规状态）
             *     一旦它在场，它的三个内部字段 ⇒ ★ **必填**（一个只带 `{by}` 的章子是残缺的）
             *   ⇒ 而这两层各自说一件事：前者是"这条任务登记了没有"，后者是"那个登记全不全"。
             *
             * ★★ 而这一层必填**正是 t2 的 `ReviewedStamp` 的形态**（`at: number` /
             *   `by: string` / `checks: ReviewedCheck[]` 三个都非可选）——
             *   ⇒ 不写 `required: true` 会让 schema 推出**全可选**的形状，
             *     而那与 `ReviewedStamp` **不匹配**（tsc 会当场指出，见本文件 :169 的那条错的来历）。
             */
            at: { type: 'number', required: true, description: 'Epoch ms when the review was stamped.' },
            by: { type: 'string', required: true, description: 'Identity that performed the review (adversarial, captain, …).' },
            checks: {
              type: 'array',
              required: true,
              description: 'Per-question verdicts (pass / fail / unmeasured). A bare boolean would be indistinguishable from one here.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true, description: 'Question id (scope, prerequisite, move, acceptance, boundary, …).' },
                  verdict: { type: 'string', required: true, description: 'pass / fail / unmeasured. unmeasured must NOT be folded into pass.' },
                  why: { type: 'string', description: 'Why this verdict — the reading that produced it.' },
                },
              },
            },
          },
        },
        sourceTaskId: { type: 'string', description: 'Source implementation/artifact. Required for kind=repair.' },
        sourceFindingIds: { type: 'array', items: { type: 'string' }, description: 'Finding ids this repair must close.' },
        coverageOf: { type: 'array', items: { type: 'string' }, description: 'User-constraint / goal items this task covers.' },
        resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
        resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            /**
             * ── ★★★ t39：`dispatchInputSurface: true` —— 而它正是本队同族形态第 9 次的形状 ──
             *
             * ★ MEASURED（我这次接线当场撞到，由 `gate-tool-output-schema` 臂 1 抓住）：
             *   ```
             *   工具的返回值通不过自己的 output schema —— 加字段的调用点改了，
             *   而**声明它的地方（schema）**没跟上 …
             *   突变目标 "agent_teams_create_task.dispatch_input_surface" 不在真实 schema 里
             *   ```
             *   ⇒ ★ 我把 `dispatch_input_surface` 加进了**返回值**，却没加进 **schema** ⇒
             *     宿主会在 `createSuccessResult` 里抛 `ToolOutputError` ⇒ **这个工具每次调用都失败**。
             *
             * ★★ 而它值得记下来：**"返回值多一格"与"schema 多一格"是两个改动点，
             *   而漏掉后者的表现是【工具整个坏掉】，不是"少一个字段"。**
             *   ⇒ 它坏得比"少一格"严重，而发现它要靠**对照臂**（臂 1 拿 schema 去校验返回值）。
             */
            ...diagnosticFields({ inputSurface: true, runtimeGates: true, dispatchInputSurface: true }),
            task_id: { type: 'string', required: true },
            subject: { type: 'string', required: true },
            status: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            assignee: { type: 'string' },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}, kind ${value.kind}, ${value.assignee ? `assigned to ${value.assignee}` : 'unassigned shared pool'}).`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        // Some models materialize optional parameters as "" instead of omitting
        // them (issue #105). Normalize blank optional fields to omitted before
        // validation so a blank value can neither be rejected spuriously nor be
        // persisted into team.json, where it would brick the team on reload.
        const input = normalizeBlankOptionalTaskFields(args)
        const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
          const gate = validateCreateTask(fresh, {
            subject: input.subject,
            description: input.description,
            dependencies: input.dependencies,
            assignee: input.assignee,
            kind: input.kind as TaskKind | undefined,
            round: input.round,
            objective: input.objective,
            inScope: input.inScope,
            outOfScope: input.outOfScope,
            acceptance: input.acceptance,
            verify: input.verify,
            deliverables: input.deliverables,
            nonGoals: input.nonGoals,
            reviewedTaskId: input.reviewedTaskId,
            /**
             * ── ★★★ 这一行是"透传链的第三站"：把 `reviewed` **交给**校验 ──────────────
             *
             * ── ★★ 而它此刻**编译不过** —— 而那不是"这行写错了" ─────────────────────────
             *
             *       TS2353: 'reviewed' does not exist in type 'CreateTaskInput'
             *
             *   ★ 它是**类型系统在说「接收方还没声明这一格」**：
             *     `validateCreateTask(team, input: CreateTaskInput)` 是**按参数类型**收的，
             *     而 `CreateTaskInput`（`src/quality-gates.ts`）还没有 `reviewed` 那一格 ——
             *     那一格的声明权在 **t11 的写域**（它的题目逐字是"区分缺失与类型错"）。
             *
             * ── ★★★ 而这构成一条【类型层的循环】（本任务实测出来的）────────────────────
             *
             *     t11 deps = [t9]      ⇒ t11 等 t9 的调用点
             *     t9 的第三站           ⇒ 等 t11 的类型声明
             *   ⇒ 两边互等 —— 而**只有一方是"改代码"、另一方是"写对了正确的调用"**。
             *     本行属于后者：它**已经是对的**，只是接收方还没声明。
             *
             * ── ★ t11 落地时要做的是【两行】而不是一行（本任务逐条核实过）──────────────
             *
             *   ① `src/quality-gates.ts:15-24` 那份 `from './types.ts'` 的 import 里
             *      **加 `type ReviewedStamp`** —— MEASURED：它现在**不在**那份清单里
             *      （清单里有 `ReviewVerdict` / `TeamTask` / `TaskRevision` … 而没有 `ReviewedStamp`）。
             *   ② `CreateTaskInput` 里加 `reviewed?: ReviewedStamp`。
             *
             * ★★ 而两行都做完之后，**本行会自动变绿** —— 不需要再改本文件一个字。
             *   ⇒ 这正是本条注释该交出去的那条读数：**"谁还要做一件事"，以及"做完之后这里不用动"。**
             *
             * ── ★ 而它**不能**用本地收窄绕过（三条都实测过）──────────────────────────────
             *
             *     ① `input.reviewed as NonNullable<TeamTask['reviewed']>`
             *     ② 本地类型别名 + 传更宽的形状
             *     ③ 去掉本行（⇒ typecheck exit=0 · build exit=0，即前两站 + 落盘自洽）
             *   ⇒ ★ ①② 都仍报同一条错 —— TypeScript 的 excess-property 检查
             *     在【不改接收方】时必红。⇒ 所以本行**只能等** t11，没有第三条路。
             */
            reviewed: input.reviewed,
            sourceTaskId: input.sourceTaskId,
            sourceFindingIds: input.sourceFindingIds,
            coverageOf: input.coverageOf,
            resume: input.resume,
            resumeReason: input.resumeReason,
          })
          if (!gate.ok) throw new Error(gate.error ?? 'create_task rejected by quality gates')
          if (fresh.halted === true) {
            const resumed = resumeTeamState(fresh, args.resumeReason ?? '')
            if (resumed.status !== 'resumed' || resumed.team === undefined) {
              throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason')
            }
            fresh.halted = false
            fresh.haltedAt = undefined
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
              teamId: fresh.id,
              reason: args.resumeReason ?? '',
            })
          }
          const dependencies = args.dependencies ?? []
          for (const dependency of dependencies) {
            if (!fresh.tasks.some((task) => task.id === dependency)) {
              throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
            }
          }
          if (args.assignee !== undefined) requireMember(fresh, args.assignee)
          const kind = gate.kind ?? 'work'
          const objective = kind === 'review' || kind === 'requirements'
            ? sanitizeReviewObjective(input.objective)
            : input.objective
          const acceptance = kind === 'review' || kind === 'requirements'
            ? sanitizeReviewAcceptance(input.acceptance)
            : input.acceptance
          const task: TeamTask = {
            id: `t${fresh.taskSeq + 1}`,
            subject: args.subject,
            description: args.description,
            status: 'pending',
            assignee: args.assignee,
            dependencies,
            attempt: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            kind,
            ...args.round === undefined ? {} : { round: args.round },
            ...objective === undefined ? {} : { objective },
            ...input.inScope === undefined ? {} : { inScope: input.inScope },
            ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
            ...acceptance === undefined ? {} : { acceptance },
            ...input.verify === undefined ? {} : { verify: input.verify },
            ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
            ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
            ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
            /**
             * ── ★★★ 落盘：而"缺席"与"在场"必须**不同形** ────────────────────────────
             *
             * ★ 沿用同一形态（`=== undefined ? {} : {...}`）：缺席时**一个键都不写**，
             *   而不是写一个 `reviewed: undefined` / `reviewed: null`。
             *   ★★ 理由：`readTeamSync` 之后那些格子会被判"在场"，而一个"在场但是 null"
             *     与"审过了、逐条写着结果"在**读取方**眼里同形 —— 而那正是本任务要防的。
             *
             * ★ 而形状坏（非对象 / checks 非数组）**在这里不许被静默丢**：
             *   本任务把值**原样**写下去，于是坏形状会由校验（t11）拦下；
             *   若这里顺手"清洗"，坏形状就会变成"没有这一格" —— 两者不可分。
             */
            ...input.reviewed === undefined ? {} : { reviewed: input.reviewed },
            ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
            ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
            ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
          }
          fresh.taskSeq += 1
          fresh.tasks.push(task)
          /**
           * ── ★ contract 位置（契约 §1 ①：「建任务 / 改契约」）─────────────────────
           *
           * 位置是**既有契约校验之后**：`validateCreateTask` 已经先说了话（它不认识判据
           * 层），本调用点只叠加。于是"这条契约本身合法吗"的既有裁决一点没变，而
           * "这条契约可判吗"（例如 verify 命令能不能真的判定成功/失败）可以由判据层
           * 接着问 —— 那正是 t7 要挂在这个位置上的东西。
           *
           * ★ 传【任务草稿】而不是 `args`：判据该读的是契约本身（objective / acceptance /
           *   verify / inScope …），而 `args` 里混着工具参数（resume、round…）。
           *
           * ── ★ 注入执行器（t18，本队同一张验收表的第三格）─────────────────────────
           *
           * MEASURED（2026-10-05）：本调用点此前**没有** `execVerifyCommand`，于是
           * `contract.verify-command` 在生产路径上**永远**返回 `unmeasured`
           * （"no executor was injected … never actually run"）⇒ 调用方拒绝
           * ⇒ **implementation / repair 这类必须验的契约连 create 都过不去**。
           *
           * ★ 这与 t6 修过的 `completion.verify-rerun` 缺执行器**同源**，也与 t17 修过的
           *   "verify 缺席 ⇒ unmeasured"是同一格 —— 判据接进来了，而它的**输入面**没接。
           *   本仓库对这条纪律的说法见契约 §2 性质 1：**判据不 import I/O，执行器由调用方注入**。
           *
           * ★ 复用 `runVerifyCommand`，与 completion 位置**同一个实现、同一个超时口径**
           *   —— 不新造第二条"跑命令"的路径（两条路径会在超时/退出码语义上慢慢分叉，
           *   而它们在日志里同形，那种分叉最难归因）。
           */
          const contractGateSurface = await rejectOnContractGates(ctx, { team: fresh, task, creating: true }, 'create_task', stateRoot, {
            execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
            /**
             * ── ★★★ t53：规则表**每次调用时读**（"改数据 ⇒ 立刻生效"的成立条件）──
             *
             * ★ 不缓存：缓存会让"改数据"在下一次**进程重启**前不生效 ——
             *   而那正是本任务要消灭的东西（改它读的东西不该需要换进程）。
             * ★ 也不在构建时内联（静态 import 会被 tsc 嵌进 lib/ ⇒ 改数据仍要 build）。
             */
            loadRules: () => loadVerifyCommandRules(workspace),
          })
          await writeTeam(stateRoot, fresh)
          /**
           * ── ★ runtime 位置：跨步骤的过程约束 ──────────────────────────────────────
           * 只记录，不拒绝（契约 §5）。`created: true` 是给"运行判据"的判别面 ——
           * 一条判据可以只关心某些事件，判据层不替它猜。
           */
          const contractRuntimeRecord = await evaluateRuntimeGates(ctx, 'task-created', {
            team: fresh,
            task,
            created: true,
          }, clock)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
            teamId: fresh.id,
            taskId: task.id,
            subject: task.subject,
            dependencies: task.dependencies,
            ...task.assignee !== undefined ? { assignee: task.assignee } : {},
            ...task.kind === undefined ? {} : { kind: task.kind },
            ...task.round === undefined ? {} : { round: task.round },
          })
          /**
           * ── ★★★ t39：`dispatch` 插入点的【唯一求值处】────────────────────────────────
           *
           * 用户原话（这条规则存在的理由，逐字）：
           *   「带 `reviewed` ⇒ 放行；不带 ⇒ **派发【前】必须先审一遍**」
           *
           * ★★ 而"派发前"就是**这一刻**：锁外那一行 `scheduler.kickTeam(...)` 把这条活
           *   交给成员 —— 那是【队长 → 成员】的那一下。
           *
           * ── 为什么它从这里来（t39 的修法）────────────────────────────────────────────
           *
           * ★ 此前它求值在 `update_task` 里，而那里**没有任何一次**是派发：
           *     `in_progress` 是成员**报到**、`completed`/`failed` 收口、`cancelled` 撤销。
           *   ⇒ 于是每一次状态更新都过这道门，而本队 39 条任务里 0 条带 `reviewed`
           *     ⇒ "没审"是默认状态 ⇒ **每一次状态转换都被拒**（t10 实测 11 条误拒）。
           *
           * ★★★ 一般形式（本队今晚第五次，与 t4 同族）：
           * > 一条本意是"提醒"的规则，若落在【所有人都经过的求值点上】，
           * > 而它的默认状态在真实语料里是绝大多数 ⇒ 那么它的默认状态就成了【拒绝】。
           *   ⇒ ★ **判据没有错，落点错了。** 判据与它的三态一个字没动。
           *
           * ★ 而"那一半没被放宽"：一个真正被派发而没有 `reviewed` 的任务**仍然被拦** ——
           *   只是它现在拦在**派发**这一侧，而不是每一次状态更新上。
           */
          const dispatchWiring = await wireDispatch({
            /**
             * ── ★★★ 必须交【整条 task】，不是我挑几格拼的 ──────────────────────────────
             *
             * ★ 我第一版传的是 `{ id, reviewed }` —— 而那是**静默失效**，实测抓到的：
             *   ```
             *   dispatch surface = {"checked":0,"incomplete":0,"skipped":3,"missing":[]}
             *   ```
             *   ⇒ 三条 dispatch 判据**全部 skipped**。
             *
             * ★★ 逐条成因（两条来自"缺格"，一条更隐蔽）：
             *   · `changed-paths` / `worktree` 的 `appliesTo` 读 `ctx.task.kind`
             *     ⇒ 我漏了 `kind` ⇒ 它们对【每一条】任务都不适用
             *   · ★ `plan-reviewed` 的 `appliesTo` 读 `createdAt`（`predatesThisGate`）
             *     ⇒ 我漏了 `createdAt` ⇒ `predatesThisGate` 返回 **true**（"缺就读作早于本门"）
             *       ⇒ ★ 于是**连它自己也被跳过** ⇒ 我这次接线**一个字也没生效**
             *
             * ★★★ 而那条最值得记：**"漏传一格"的表现是【判据说"不适用"】，不是报错。**
             *   寄存器如实报 `skipped: 3`，而"跳过了"与"跑了而结论是通过"在本队
             *   记账里是【不同形】的两件事 —— 但那要靠人去看 `skipped` 才认得出来。
             *   ⇒ ★ 所以这里交**整条 task**：判据按它声明的 `requires` 自己去取，
             *     而不是由调用方【替它挑】哪几格够用。挑漏一格的代价是静默失效。
             */
            task,
            changedPaths: undefined,
            caller: captain as unknown as DispatchWiringInput['caller'],
            workspace,
            registry: registry as unknown as DispatchWiringInput['registry'],
          })
          const dispatchGates = dispatchWiring.gates
          const dispatchSurface = dispatchWiring.inputSurface as
            { checked: number; incomplete: number; skipped: number; missing: string[] } | undefined
          /**
           * ── ★★ 三态（与 `update_task` 原来那一套【逐字同源】，只是搬了地方）────────────
           *
           *   `blockers`                 ⇒ **拒绝**（"我检查了而它不行"）
           *   `unmeasured` / `skippedAll` ⇒ **放行 + 告警**（"我没能检查"≠"它不行"）
           *     ★ 而那正是 t42 那条口径：一个安全约束**不触发**时应当放行并留痕。
           */
          const dispatchNotChecked = dispatchGates.ok === false
            && (dispatchGates.skippedAll !== undefined || dispatchGates.unmeasured !== undefined)
          if (dispatchNotChecked) {
            const why = dispatchGates.unmeasured !== undefined
              ? `the dispatch step could not be measured (${dispatchGates.unmeasured})`
              : `nothing was evaluated (${dispatchGates.registered} registered, all skipped)`
            ctx.logger.warn(`agent-teams: create_task reached the dispatch gate and ${why}; the dispatch step was NOT checked — allowing it through, because "not checked" is not "refused"`)
          }
          if (dispatchSurface !== undefined && dispatchSurface.incomplete > 0) {
            ctx.logger.warn(`agent-teams: create_task reached the dispatch gate with an unfinished input surface (recorded, not rejected): ${dispatchSurface.missing.join('; ')}`)
          }
          if (!dispatchNotChecked && dispatchGates.ok === false) {
            /**
             * ── ★★ 措辞与 `update_task` 那处同源，而【抛出方式】也必须同源 ──────────────
             *
             * ★ 措辞同源（`… rejected: …`）：读日志的人要在两处认出**同一条判据**。
             *
             * ★★ 而用 `throwWithSurface` 而不是裸 `throw new Error` —— 理由是
             *   **FINDING-1 / t42** 那条：**拒绝恰恰是最需要读到"结论"的那一刻**。
             *   · 裸 `throw` ⇒ 异常上**不带** `agentTeamsInputSurface` ⇒
             *     工具边界搬不出结论 ⇒ 调用方只看到一句消息
             *   · `throwWithSurface` ⇒ 异常上带着它 ⇒ 边界把它搬到 `error.input_surface`
             *   ⇒ ★ 于是"是判据拒了它"与"是契约不合法"在调用方那一侧**不同形**。
             *
             * ★ 而本文件此前【没有】导入过 `throwWithSurface`（它整篇用裸
             *   `throw new Error`）—— 那对"契约校验"那类拒绝够用（它们没有"输入面结论"），
             *   但对**判据产生的拒绝**不够，因为判据的结论要交出去。
             */
            throwWithSurface(
              `create_task rejected: ${dispatchGates.blockers.join('; ')}`,
              dispatchSurface,
              'dispatch_input_surface',
            )
          }
          const dispatchVerdict = dispatchSurface === undefined ? {} : { dispatch_input_surface: dispatchSurface }
          return {
            task_id: task.id,
            subject: task.subject,
            status: task.status,
            kind: taskKindOf(task),
            /**
             * ★★ t3：contract 位置的核对结论**随记录交出去**（与 runtime 同形）。
             *   此前这里只有一个 `logger.warn` —— 日志被截断时，"报缺"与"输入面是齐的"
             *   在返回值上同形。★ 三态：齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/
             *   这个位置没判据（**字段不出现**，不是 `ok`）。
             */
            ...contractGateSurface === undefined ? {} : contractGateSurface,
            ...task.assignee !== undefined ? { assignee: task.assignee } : {},
            ...contractRuntimeRecord === undefined ? {} : { runtime_gates: contractRuntimeRecord },
            /**
             * ★★★ t39：`dispatch` 那一格的求值结论 —— 在**锁内**求值，随返回值交出去。
             *
             * ★ 为什么在锁内：判据读的是 `ctx.task.reviewed`，而那必须是**这一条任务
             *   刚写下去的那一格**（锁外读会与锁内的那一条分叉）。
             */
            ...dispatchVerdict,
          }
        })
        await scheduler.kickTeam(workspace, team.id, captain)
        return created
      },
    })))
}
