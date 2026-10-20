// ── src/tools/create.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { captainLockKey, requireCaptain, stateRootOf, teamLockKey, workspaceOf } from './shared/entities.ts'
import { createTeamDir, findTeamByParticipant, readTeam, sanitizeKey, withTeamLock } from '../state.ts'
import { sessionLeadsTeam } from '../lineage.ts'
import { identityOfTeam, liveRefsOf } from '../members.ts'
import { TeamState, TASK_KINDS } from '../types.ts'
import { defaultQualityDeliveryGraph } from '../quality-gates.ts'
import { initializeProfileTeam } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, memberSelections: any, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_create',
      description: 'Create a team. Use approval=required for a two-phase plan: members and tasks remain unspawned/unclaimed until the user reviews the Web plan and explicitly approves it. Optional profiles expand their configured roster; seed profiles also expand template tasks, while captain profiles leave the graph for the Captain to design. approval=automatic preserves the legacy immediate-execution path.',
      parameters: {
        name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
        description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
        profile: { type: 'string', description: 'Optional configured profile name.' },
        plan: {
          type: 'object', additionalProperties: false,
          description: 'Optional complete ordinary-work roster and DAG in one atomic call, instead of separate add_member/create_task rounds. Mutually exclusive with profile. For quality gates use create_task with the explicit quality contract.',
          properties: {
            members: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              name: { type: 'string', required: true }, role: { type: 'string' },
              provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' },
              /**
               * ── ★★★ 这一格补的是「形态」的通路，不是又一件可选装饰 ─────────────────
               *
               * `TeamProfileMemberConfig` 早就有 `executionPrompt`（`profiles.ts:35-43`），
               * 而本工具的内联 plan 把它**挡在门外**了 —— 于是经 `agent_teams_create({plan})`
               * 建出来的队，成员只能拿到 name/role/provider/model/reasoning_effort 五格。
               *
               * ★ 实测后果（2026-10-18 夜里）：队长按 plan 建队时，**唯一能表达的形态**就是
               *   「扁平成员池 + 队长派活」—— 那是这个插件 10-05 的早期形态。而「持久记账点
               *   + 每任务拉一对临时 worker/reviewer」那个形态，只存在于 `mutation-quality`
               *   这类团队**手工写进 profile 的 executionPrompt 文本**里（`ledger` 与 `foreman`
               *   的 prompt 逐字写着「你拉起临时 subagent 去执行实现/修理任务」）。
               *   ⇒ 形态在语料里、在配置里，却**不在建队的 API 里** ⇒ 新队默认退回早期形态。
               *
               * ★ 这一格不新增语义：它只是把 profile 路径**已支持**的字段透到内联 plan 上。
               *   校验仍走 `normalizeMember`（`profiles.ts:531`），`MEMBER_KEYS` 已含此键。
               */
              executionPrompt: {
                type: 'string',
                description: 'Member-specific execution prompt. It remains editable while staged.',
              },
            } } },
            tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              id: { type: 'string', required: true, description: 'Local reference used by dependencies in this plan; the result maps it to a durable task id.' },
              subject: { type: 'string', required: true }, description: { type: 'string' }, assignee: { type: 'string' },
              dependencies: { type: 'array', items: { type: 'string' } },
              /**
               * ── ★★★ 质量契约字段（这一格修的是「协议与工具互相矛盾」）─────────────────
               *
               * 缺陷形态（我实测到的原文）：队长协议 rule 3 逐字写着
               *   `pass kind and assignee explicitly when the plan specifies them`
               * 而本 schema 只声明了 5 个键、`additionalProperties: false`，于是宿主校验器
               * （`@deepseek-ai/dsh-tools` `lib/index.js:467`）逐字拒绝：
               *   `"tasks[0].kind" is not a declared property (additionalProperties: false)`
               * ⇒ **提示词说可以，工具说不可以。** 而它就是 `defaultQualityDeliveryGraph()`
               *   （`quality-gates.ts:2520`）零调用方的机制原因 —— 那五条草稿的 `kind` /
               *   `objective` / `acceptance` / `inScope` / `verify` 无处可放。
               *
               * ★ 为什么整组一起放：`kind` 决定一条任务走不走质量门（`isQualityKind`），
               *   而质量门要求 objective+acceptance（implementation/repair 还要 inScope+verify）。
               *   只放 `kind` 会造出"质量 kind 缺契约"的任务 —— 那正好是
               *   `validateCreateTask` 会拒的形状，等于把错误推迟到派发时。
               *   ⇒ 整组放行，并在 `profiles.ts:normalizeTask` 里**当场按同一判据拒**。
               */
              kind: { type: 'string', enum: [...TASK_KINDS], description: 'Quality kind. Omit for ordinary work. A quality kind requires objective + acceptance (plus inScope + verify for implementation/repair/integration).' },
              objective: { type: 'string' },
              acceptance: { type: 'array', items: { type: 'string' } },
              verify: { type: 'array', items: { type: 'string' } },
              inScope: { type: 'array', items: { type: 'string' } },
              outOfScope: { type: 'array', items: { type: 'string' } },
              deliverables: { type: 'array', items: { type: 'string' } },
              nonGoals: { type: 'array', items: { type: 'string' } },
              coverageOf: { type: 'array', items: { type: 'string' } },
              round: { type: 'number' },
              /**
               * ★ 审查任务要审的是**哪一条种子任务**（本 plan 里的 `id`，不是 `tN`）。
               *
               * ★★ 不放这一格，"生成一张标准质量图"这条路就走不通：
               *   `defaultQualityDeliveryGraph()`（`quality-gates.ts:2539`）产出的图里
               *   review 必须带它，而 `validateCreateTask`（`:1052`）会逐字拒
               *   `review tasks require reviewedTaskId`。
               */
              reviewedTaskId: { type: 'string', description: 'For kind=review: the seed task id (from this plan) being reviewed.' },
              model: { type: 'string', description: 'The model that runs THIS task. Recorded on the task record so the result keeps a single, answerable attribution.' },
              reasoning_effort: { type: 'string' },
            } } },
            /**
             * ── ★★★ quality 模式：不手写五条任务，让**生成器**铺底图 ────────────────
             *
             * `quality` 与 `tasks` **恰好一个**。给了 `quality` ⇒ 本工具调
             * `defaultQualityDeliveryGraph()`（`quality-gates.ts:2539`）生成整张
             * requirements → implementation → verification → review-round-1 → integration，
             * 再走与 `tasks` **同一条**落盘路径。
             *
             * ── ★ 为什么必须有这一格 ─────────────────────────────────────────────────
             *
             * `defaultQualityDeliveryGraph` 此前**零调用方**：`grep -rn` 只命中定义本身。
             * 而它产出的正是队长协议第 8 条要求的那张图。零调用方的机制原因不是"没人想用"，
             * 是**它产出的形状放不进任何入口**（`kind` 无格、`reviewedTaskId` 无格、
             * `inScope: ['src/']` 是占位）。⇒ 光把格打开还不够：**能表达**与**会表达**
             * 之间还差这一步 —— 否则队长要自己逐条写五条任务，而那五条里的
             * `DEFAULT_REVIEW_OBJECTIVE` / `DEFAULT_REVIEW_ACCEPTANCE` / 依赖拓扑
             * 都是生成器已经知道的。
             *
             * ── ★★ 生成器的占位值必须被调用方**覆盖**，不许静默落盘 ──────────────────
             *
             * 生成器里 `inScope: ['src/']` 与 `verify: ['pnpm test']` 是**占位**，
             * 而 `qualityPlanningPrompt()` 第 4 条逐字要求
             * `never assume src/ or pnpm test` ⇒ 它**自相矛盾**。
             * ⇒ 本入口**强制**调用方传 `inScope` + `verify` 覆盖到 implementation 上；
             *   不传 ⇒ 当场拒，而不是把 `pnpm test` 落进一条真实的交付任务。
             */
            quality: {
              type: 'object', additionalProperties: false,
              description: 'Quality mode: generate the standard DAG instead of writing five tasks by hand. Mutually exclusive with tasks.',
              properties: {
                goal: { type: 'string', required: true },
                implementer: { type: 'string', required: true },
                reviewer: { type: 'string', required: true },
                analyst: { type: 'string' },
                tester: { type: 'string' },
                integrator: { type: 'string' },
                inScope: { type: 'array', required: true, items: { type: 'string' }, description: 'REQUIRED: replaces the generator placeholder. Derive from the real workspace.' },
                verify: { type: 'array', required: true, items: { type: 'string' }, description: 'REQUIRED: replaces the generator placeholder. Use commands that actually exist in this repo.' },
              },
            },
            /**
             * ── ★★★ 这个队是**什么形态**（2026-10-20，用户裁定乙方案）──────────────────
             *
             * 用户原话：「你这个建团 是用早期插件的形态建的 而不是后来我规定的形态
             *   而且关于这个问题 其实我已经做过修复了 但显然并没有起效」
             *
             * 规定形态：**队长持久，成员是持久的 dispatch 点，每一条任务用临时 worker 执行。**
             * ★ 而 `81d08df` 那笔修复只把"派临时工"从**不可能**变成**可能**
             *   （`executionPrompt` 通道 + 一句**条件式**提示），
             *   **没有人负责满足那个条件** ⇒ 默认路径仍然退回早期形态。
             *
             * ── 为什么是必填而不是可选 ────────────────────────────────────────────────
             *
             *   `'dispatch'` —— 持久记账点 + 每任务拉临时 worker（**规定的形态**）
             *   `'flat'`     —— 扁平成员池 + 队长派活（早期形态，合法，但要是**选择**）
             *
             * ★★ 必填的理由：一个**不声明**形态的队，其成员提示会落回条件式那条，
             *   而那正是"没起效"的那条路。⇒ 让"我没想过形态"变成一个**当场要回答**的问题，
             *   而不是一个能一路静默到成员上下文烧穿的默认值。
             *   ★ 这与 `requireExplicitKind`（t9）同一个形状：
             *     把"没人表过态"从**事后不可读**变成**当场拒绝**。
             *
             * ★ 它**不改变**成员的人设文本 —— 人设仍然由调用方逐条写。
             *   它只决定 `capabilities.ts` 发给成员的**那一段框架提示**用哪一条。
             */
            shape: {
              type: 'string',
              required: true,
              enum: ['dispatch', 'flat'],
              description: 'REQUIRED: "dispatch" = durable members spawn a one-shot worker per task (the specified form; avoids burning a member session on every task); "flat" = members implement their own tasks (the earlier form). This selects the framework prompt a member receives; personas are still written by the caller.',
            },
          },
        },
        approval: {
          type: 'string',
          enum: ['required', 'automatic'],
          description: 'required stages the plan for explicit user review; automatic starts immediately. Defaults to automatic for API compatibility.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            team_id: { type: 'string', required: true },
            team_name: { type: 'string', required: true },
            state_dir: { type: 'string', required: true },
            phase: { type: 'string', required: true },
            profile: { type: 'string' },
            task_planning: { type: 'string' },
            members: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { member_name: { type: 'string', required: true }, member_id: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, reasoning_effort: { type: 'string' }, status: { type: 'string', required: true } } } },
            tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', required: true }, seed_id: { type: 'string', required: true }, subject: { type: 'string', required: true }, status: { type: 'string', required: true }, kind: { type: 'string' }, assignee: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' }, required: true } } } },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: (value.phase === 'staged'
            ? `Team "${value.team_name}" plan created under ${value.state_dir}. It is staged: finish the roster and DAG, then wait for the user to edit and approve it. Do not start or approve it yourself.`
            : `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`)
            + (value.tasks === undefined ? '' : '\n' + value.tasks.map(task => `${task.task_id} [${task.seed_id}]: ${task.subject}; assignee=${task.assignee ?? 'unassigned'}; dependencies=${task.dependencies.join(',')}`).join('\n')),
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const teamName = args.name.trim()
        if (teamName === '') throw new Error('team name must not be empty')
        const teamId = sanitizeKey(teamName)
        const staged = args.approval === 'required'
        // Some models materialize optional parameters as "" instead of omitting
        // them (issue #99). The profile is optional, so treat a blank value
        // exactly like an omitted one instead of failing every create call.
        const profileName = args.profile !== undefined && args.profile.trim() !== ''
          ? args.profile.trim()
          : undefined
        if (profileName !== undefined && args.plan !== undefined) throw new Error('choose either a configured profile or an inline plan')
        /**
         * ── ★★★ quality 模式的两条入口判据（都在**建队那一刻**判）────────────────────
         *
         * ① `tasks` 与 `quality` **恰好一个** —— 两个都给会造出"生成器铺的图 + 手写的图"
         *    混在一起，而它没有一条可读的规则说谁赢。两个都不给 ⇒ 空队（合法，见 profile 路径）。
         * ② `inScope` + `verify` **必须由调用方给**，不许让生成器的 `['src/']` /
         *    `['pnpm test']` 静默落盘 —— 那两个是占位，而 `qualityPlanningPrompt()`
         *    第 4 条自己逐字写着 `never assume src/ or pnpm test`。
         */
        const qualitySpec = args.plan?.quality
        if (qualitySpec !== undefined && args.plan?.tasks !== undefined) {
          throw new Error('plan.tasks and plan.quality are mutually exclusive — provide exactly one')
        }
        /**
         * ── ★★★ `shape` 是**队伍属性**，不是 profile 的键（2026-10-20，乙方案）───────
         *
         * MEASURED（本任务自己做错一次）：第一版把 `args.plan` 整个传进
         * `initializeProfileTeam`，于是 `resolveTeamProfile` 当场抛
         *   `profiles.inline-plan.shape is unknown`
         * —— ★ 那不是"多一个可选键"，是**两个不同层次的字段混进了同一个对象**：
         *   `members` / `tasks` / `reviewPolicy` 描述**这个 plan 长什么样**；
         *   而 `shape` 描述**这个队平时怎么干活**。
         *   ⇒ 把它从 plan 里**取出来**，plan 原样传给 profile 解析。
         *
         * ★ 而"取出来"这件事必须在**两处**都做：`inlinePlan` 与 `initializeProfileTeam`
         *   的 `shape` 参数。只做一处会让 `shape` 在另一条路径上仍然被当成未知键。
         */
        const declaredShape = args.plan?.shape
        const planWithoutShape = args.plan === undefined
          ? undefined
          : (() => {
              const { shape: _shape, ...rest } = args.plan
              void _shape
              return rest as import('../profiles.ts').TeamProfileConfig
            })()
        const inlinePlan = qualitySpec === undefined
          ? planWithoutShape
          : buildQualityInlinePlan(planWithoutShape as import('../profiles.ts').TeamProfileConfig, qualitySpec as QualityPlanSpec)
        const created = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
          const current = await findTeamByParticipant(stateRoot, captain.id)
          if (current !== undefined) {
            /**
             * ── ★★★ #176（乙）：lead 身份收口（t98）───────────────────────────────
             * ★ 这两行**同源**（同一个布尔），所以**必须一起收口** ——
             *   ★★ 只改一行会让"关系"与"指引"分叉：它会说"你是 lead"
             *     却给出"作为一个成员继续"的指引（**同一份事实两个结论**）。
             */
            const isLeadOfCurrent = sessionLeadsTeam(captain.id, identityOfTeam(current), liveRefsOf(ctx))
            const relationship = isLeadOfCurrent ? 'lead' : 'belong to'
            const guidance = isLeadOfCurrent
              ? 'Use agent_teams_status and continue the existing team. Do not delete and recreate it merely to continue work. End it only when the user explicitly wants a separate new team.'
              : 'Continue your assigned member work and report to your captain; do not create a separate team.'
            throw new Error(`you already ${relationship} team "${current.name}" (id ${current.id}). ${guidance}`)
          }
          return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const existing = await readTeam(stateRoot, teamId)
            if (existing !== undefined) {
              throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`)
            }
            if (profileName === undefined && inlinePlan === undefined) {
              const state: TeamState = {
                name: teamName,
                id: teamId,
                description: args.description,
                captainSessionId: captain.id,
                createdAt: Date.now(),
                members: [],
                tasks: [],
                taskSeq: 0,
                ...staged ? { phase: 'staged' as const, planReviewState: 'awaiting_review' as const } : {},
              }
              await createTeamDir(stateRoot, state)
              return { committed: true as const, state }
            }
            return initializeProfileTeam({
              ctx,
              config,
              memberSelections,
              captain,
              exec,
              stateRoot,
              teamName,
              teamId,
              profileName: profileName ?? 'inline-plan',
              inlinePlan,
              description: args.description,
              staged,
              /**
               * ★★★ 形态从此**由建团的人声明**，而不是由成员人设的措辞暗示。
               *   `args.plan?.shape` 在 schema 里是必填的；这里仍然用 `?.` 是因为
               *   `plan` 只在非 profile 路径上存在 —— 而 profile 路径的形态由
               *   profile 自己带（见 `initializeProfileTeam` 的处置）。
               */
              ...declaredShape === undefined ? {} : { shape: declaredShape },
            })
          })
        })
        if (created.committed) {
          try {
            await scheduler.kickTeam(workspace, created.state.id, captain)
          } catch (error: unknown) {
            ctx.logger.warn(`agent-teams: post-create kick failed for "${created.state.id}": ${String(error)}`)
          }
          try {
            appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
              teamId: created.state.id,
              captainSessionId: captain.id,
              name: created.state.name,
              ...created.state.description !== undefined ? { description: created.state.description } : {},
              ...created.state.profile?.name === undefined ? {} : { profile: created.state.profile.name },
            })
            for (const member of created.state.members) {
              appendTeamEvent(ctx, captain.session, 'agent-teams/member-added', {
                teamId: created.state.id,
                memberId: member.id,
                name: member.name,
                ...member.role === undefined ? {} : { role: member.role },
              })
            }
            for (const task of created.state.tasks) {
              appendTeamEvent(ctx, captain.session, 'agent-teams/task-created', {
                teamId: created.state.id,
                taskId: task.id,
                subject: task.subject,
                dependencies: task.dependencies,
                ...task.assignee === undefined ? {} : { assignee: task.assignee },
              })
            }
          } catch (error: unknown) {
            ctx.logger.warn(`agent-teams: post-create events failed for "${created.state.id}": ${String(error)}`)
          }
        }
        const persisted = await readTeam(stateRoot, created.state.id).catch(() => undefined)
        const snapshot = persisted ?? created.state
        if (snapshot.profile === undefined && inlinePlan === undefined) {
          return {
            team_id: snapshot.id,
            team_name: snapshot.name,
            state_dir: join(stateRoot, snapshot.id),
            phase: snapshot.phase ?? 'running',
          }
        }
        return {
          team_id: snapshot.id,
          team_name: snapshot.name,
          state_dir: join(stateRoot, snapshot.id),
          phase: snapshot.phase ?? 'running',
          ...snapshot.profile === undefined ? {} : { profile: snapshot.profile.name },
          task_planning: snapshot.profile?.taskPlanning ?? 'seed',
          members: snapshot.members.map((member) => ({
            member_name: member.name,
            member_id: member.id,
            provider: member.provider ?? '',
            model: member.model ?? '',
            ...member.reasoningEffort === undefined ? {} : { reasoning_effort: member.reasoningEffort },
            status: member.status,
          })),
          tasks: snapshot.tasks.map((task) => ({
            task_id: task.id,
            seed_id: task.profileSeedId ?? '',
            subject: task.subject,
            status: task.status,
            ...task.kind === undefined ? {} : { kind: task.kind },
            ...task.assignee === undefined ? {} : { assignee: task.assignee },
            dependencies: task.dependencies,
          })),
        }
      },
    }))
}

/** `plan.quality` 的调用方输入（schema 已声明，这里只补类型）。 */
interface QualityPlanSpec {
  goal: string
  implementer: string
  reviewer: string
  analyst?: string
  tester?: string
  integrator?: string
  inScope: string[]
  verify: string[]
}

/**
 * ── ★★★ 把 `plan.quality` 折成一张**生成好的**种子图 ─────────────────────────────
 *
 * 生成器（`quality-gates.ts:2539`）知道拓扑、默认 objective/acceptance、
 * 以及 review 该审哪一条；调用方只需要说出**这棵树上的真值**：
 * 谁干什么、动哪些路径、跑哪些命令。
 *
 * ── ★★ 两处占位必须被覆盖（不给就拒，不许静默落盘）──────────────────────────────
 *
 * 生成器的 `inScope: ['src/']` 与 `verify: ['pnpm test']` 是占位值，而
 * `qualityPlanningPrompt()` 第 4 条逐字要求 `never assume src/ or pnpm test`。
 * 若让占位落进一条真实的交付任务，队长会得到一条**永远跑不过的 verify**，
 * 而它的表现是"这个工人不行"，不是"契约是占位的"。
 * ⇒ 这里**覆盖**，并把覆盖结果留在对象的注释可见处（不额外加字段：
 *   加一个"我覆盖过"的标记会让落盘形状多一格，而那一格没有任何读者）。
 */
function buildQualityInlinePlan(
  plan: import('../profiles.ts').TeamProfileConfig,
  spec: QualityPlanSpec,
): import('../profiles.ts').TeamProfileConfig {
  /**
   * ── ★★★ 三条**缺省回退**，每一条都对着生成器的一个真实缺口 ───────────────────────
   *
   *   ① `analyst` 默认 = `implementer` —— 这条回退**留着**，而它有两个各自独立的理由：
   *
   *      (a) `normalizeTask` 逐字拒一条没有 assignee 的 requirements 任务：
   *          `profile task "requirements-round-1" is missing an assignee`（实测）。
   *          生成器把 `analyst` 留成可选，于是"不给 analyst"这条最自然的写法会建不出队。
   *
   *      (b) `scripts/gate-plan-contract.test.mjs` 的臂 8 把这条回退**钉成绿的**
   *          （正向：不给 analyst ⇒ requirements 落在 implementer；反向：给了 ⇒ 用给的）。
   *          ⇒ 在这里改掉它，是去改一条别人已经裁定过的验收件。
   *
   *   ★★ 而 (a)(b) 只是"为什么不能改"，不是"这样安全"。**同一个身份**因此
   *      既写需求、又将要实现它们 —— 而那正是 `judgeSelfReview`
   *      （`quality-gates.ts`，requirements 那一支）现在**会拒绝**的形状。
   *      所以这个默认值把每个质量队都摆在"必须换一个人来盖章"的位置上。
   *
   *   ⇒ 补救不是悄悄改回退（那会同时推翻 (a) 与 (b)），而是把这条要求
   *     **写进生成出来的 requirements 任务的 `acceptance`**：
   *       · 它在**建团的那一刻**就可见（队长读 plan 就看得到），
   *       · 而不是等到人第一次 `update_task` 被拒才发现自己要换人。
   *     ★ 一个只写在判据错误里的要求，它的读者是"已经撞上它的人"；
   *       写进契约，读者才是"将要撞上它的人"。见下面的 `REQUIREMENTS_PASS_ACCEPTANCE`。
   *
   *   ② `tester` / ③ `integrator` 生成器已有回退（`tester ?? implementer`、
   *      `integrator ?? reviewer`）⇒ 这里**不重复**，重复会让两处回退漂移。
   */
  const base = defaultQualityDeliveryGraph({
    goal: spec.goal,
    implementer: spec.implementer,
    reviewer: spec.reviewer,
    analyst: spec.analyst ?? spec.implementer,
    ...spec.tester === undefined ? {} : { tester: spec.tester },
    ...spec.integrator === undefined ? {} : { integrator: spec.integrator },
  })
  /**
   * ── ★★★ 分析者与实现者是同一身份 ⇒ 在 requirements 的 acceptance 里明写"盖章要换人"──
   *
   * 判据（与 `judgeSelfReview` 的 requirements 支**逐字同源**）：需求写了、实现又要由
   * 那个人做 ⇒ 那个人的 `verdict=pass` 会被拒。而这个文件里 `analyst ?? implementer`
   * 正好把每支没点名 analyst 的队放进了这个形状。
   *
   * ★ 只追加**一行** acceptance，不动别的字段，也不改 `draft.acceptance` 的既有条目：
   *   这是把一条**已经在判据里生效**的要求前移到建团那一刻，不是新增规则。
   * ★ 三态：`spec.analyst` 显式给了且 ≠ implementer ⇒ 形状不成立 ⇒ **一个字都不加**
   *   （多加一句会变成一条没人要的告诫）。
   * ★ `acceptance` 是 `undefined` ⇒ **保持 undefined**（`?? []` 会把"生成器没给"
   *   变成"给了一个空数组"，而两者在下游读取方眼里不同形）。
   */
  const analystDefaultsToImplementer = spec.analyst === undefined || spec.analyst === spec.implementer
  /**
   * ★ 这一行的措辞刻意点出 `analyst defaults to the implementer`：让它自己解释
   *   "为什么这条要求出现在我的契约里"，而不是让读者去翻 `create.ts` 的注释。
   */
  const REQUIREMENTS_PASS_ACCEPTANCE = 'the pass on these requirements must be issued by an identity other than the one that will implement them (the analyst defaults to the implementer, so the author cannot approve its own requirements)'
  /**
   * ★ `id` 由**本工具**补，而不是让生成器产：生成器不知道调用方用什么 id 命名，
   *   而 `id` 是种子图内部的引用轴（`dependencies` / `reviewedTaskId` 都用它）。
   *   用 `subject` 作 id 是因为生成器的 subject 在本图内**唯一且可读**
   *   （`requirements-round-1` / `implementation` / …）。
   */
  const tasks: import('../profiles.ts').TeamProfileTaskConfig[] = base.map((draft) => ({
    ...draft,
    id: draft.subject,
    /**
     * ★ 只覆盖 implementation —— 那正是生成器写占位值的那一条。
     *   其余四条（requirements/verification/review/integration）本来就不带
     *   `inScope`/`verify`，凭空补上去会让它们多出生成器没打算有的契约格。
     */
    ...draft.kind === 'implementation' ? { inScope: [...spec.inScope], verify: [...spec.verify] } : {},
    /**
     * ★ 只有 requirements 那条、且只有"分析者 = 实现者"这个形状，才追加那一行。
     *   ★ 追加在**末尾**（既有条目保持原顺序）—— 一组既有验收标准被重排，
     *     会让逐条核对的读者以为内容也换了。
     */
    ...draft.kind === 'requirements' && analystDefaultsToImplementer && draft.acceptance !== undefined
      ? { acceptance: [...draft.acceptance, REQUIREMENTS_PASS_ACCEPTANCE] }
      : {},
  }))
  return { members: plan.members, tasks }
}
