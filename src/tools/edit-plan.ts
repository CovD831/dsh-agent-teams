// ── src/tools/edit-plan.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { requireCaptain, requireCaptainTeam, requireMember, requireTask, workspaceOf } from './shared/entities.ts'
import { StagedPlanMutation } from './shared/entities.ts'
/**
 * ── ★★★ t22：契约"看着在、其实是空的"必须被拒 ─────────────────────────────────────
 *
 * ★★ 这两个判据**来自既有的那一份**，而不是本文件新造一份：
 *   `isQualityKind`（这个 kind 要不要 objective/acceptance）与
 *   `WRITE_KINDS`（要不要 inScope/verify）在 `validateCreateTask` 里已经写着，
 *   而那条路是 `create_task`。⇒ 本文件**借**它，形成一个判据一处实现。
 *
 * ★ 为什么不能在本文件里重写一遍那两个判断：`create_task` 与 `edit_plan` 是
 *   **同一件事的两个入口**，而两份规则会随下一次改动分叉 —— 分叉之后
 *   "从哪个入口建的任务要求更松"这件事**在读数上同形**（都读作"建成功了"）。
 *   （本仓反复记账的形态：一个判据两处实现 ⇒ 第二处是第二个真相。）
 */
import { isQualityKind } from '../quality-gates.ts'
import { TASK_KINDS } from '../types.ts'
import type { TaskKind } from '../types.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'
import type { TeamMember, TeamTask } from '../types.ts'

/**
 * ── ★★★ 哪种 kind 要求哪些契约格（t22）────────────────────────────────────────────
 *
 * ★★ 与 `validateCreateTask` **同源**：那一条是质量 kind 要 `objective`+`acceptance`、
 *   写类 kind 要 `inScope`+`verify`。这里把**同一套判据**按"缺哪几格"的形状返回。
 *
 * ★ 为什么返回的是**清单**而不是一个布尔：
 *   验收要求"拒绝时**指名**缺的是哪几格"。一个只说"契约不完整"的拒绝会让下一个人
 *   去猜 —— 而"猜"在这里的后果是**编一个文件集合**（t1 那位成员正确地拒绝了去猜）。
 */
export const WRITE_KINDS: readonly TaskKind[] = ['implementation', 'repair']

/**
 * 契约的四个格（`objective` / `acceptance` / `inScope` / `verify`）。
 * ★ 与 `quality-gates.ts` 里那两条谓词**同源**：哪些 kind 要哪几格只有一处实现，
 *   而这里只是把它们**列出来**给"四格全空"那条判据用。
 */
const CONTRACT_FIELDS = ['objective', 'acceptance', 'inScope', 'verify'] as const

export interface ContractRequirement {
  /** 这个 kind 要求哪些格（空数组 = 明确不要求）。 */
  required: readonly string[]
  /** ★ 缺了的那几格（人类可读的名字）。空数组 = 齐的。 */
  missing: string[]
  /**
   * ── ★★★ t22：第三态的**处置** —— 一条"判不了"且**四格全空**的任务必须被挡 ────────
   *
   * MEASURED（t22 实测，真工具入口）：
   *
   *     edit_plan { action:'update_task', task_id:'t1', assignee:'worker' }
   *       t1 = { subject:'a staged-plan task', status:'pending' }   ← kind 缺席、四格全空
   *     ⇒ **ALLOWED**，而那条任务随后仍然处在**可认领**状态
   *
   * ★ 那正是本任务要修的那个缺陷的**原始形状**（t1 本尊）：
   *   `contractRequirement(undefined, {})` 交回 `missing: []`
   *   ⇒ 上面那道 `requirement.missing.length > 0` 的闸门**不会开火**
   *   ⇒ 于是"判不了"被**静默**读成了"没问题"。
   *
   * ★★ 而这与第三态那条纪律**不矛盾**，恰恰是它的落实：
   *   "判不了"**不许**并进"明确不要求"（那会让缺陷隐身），
   *   也**不许**并进"要求且缺格"（那会去报一个它其实不知道的格名）。
   *   ⇒ 它有**自己的**处置：**拒绝**，并如实说"这条任务没声明 kind，
   *     而它的契约是空的 —— 我判不了它需不需要契约，所以不让它进工作"。
   *
   * ── 判据（机械）：`kind` 缺席 **且** 四格**全空** ─────────────────────────────
   *
   * ★ 为什么是"全空"而不是"任意一格空"：一条 `kind` 缺席却**填了** objective 的任务
   *   （真实的中间态：人先写了个目标、还没定 kind）**不是**这个缺陷 ——
   *   它有内容可读，认领的人看得出它在说什么。★ 本判据只挡**四格全空**那一种，
   *   因为那一种与"契约在途中丢了"**完全同形**，而那正是 t1 那位成员读到的形状。
   */
  unjudgeableEmpty: boolean
}

/** 一格算不算"填了"：非空字符串（列表则要求至少一个非空项）。 */
function filled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.some((item) => typeof item === 'string' && item.trim() !== '')
  return value !== undefined && value !== null
}

/**
 * 一个 kind 要求哪些契约格。
 *
 * ★★★ 三态，而**第三态不许并进另外两个**：
 *
 *   `kind` 在场且是质量/写类 ⇒ 要求那几格（`required` 非空）
 *   `kind` 在场且是 `work`/`requirements` 等 ⇒ **明确不要求**（`required` 为空，
 *     而这是表里写明的决定，不是默认 —— `kind-requirements.json` 的 `work` 那条
 *     `because` 逐字写着"deliberately does not require a verify list or an inScope at all"）
 *   ★ `kind` **缺席** ⇒ **判不了**（`kind` 为 `undefined`）。它不是"不要求"：
 *     `taskKindOf` 把缺席读成 `work`（那是**运行时**的容错缺省），
 *     而"这条任务没声明 kind"是一件**没接线**的事 —— 与"它声明了 work"不同形。
 *     ⇒ 这里不替它选，如实交出去（见 `checkContract`）。
 */
export function contractRequirement(kind: TaskKind | undefined, task: Record<string, unknown>): ContractRequirement & { unknownKind: boolean } {
  if (kind === undefined) {
    /**
     * ★ 缺席 ⇒ **没能测量**。`required` 空 + `unknownKind` 真 ——
     *   读取端据此能把它与"明确不要求"分开。
     *
     * ★★★ 而 t22 补上的是它的**处置**（见 `unjudgeableEmpty` 那段）：
     *   `kind` 缺席 **且** 四格全空 ⇒ 拒绝。
     */
    const allBlank = CONTRACT_FIELDS.every((field) => !filled(task[field]))
    return { required: [], missing: [], unknownKind: true, unjudgeableEmpty: allBlank }
  }
  const required: string[] = []
  if (isQualityKind(kind)) required.push('objective', 'acceptance')
  if (WRITE_KINDS.includes(kind)) required.push('inScope', 'verify')
  const missing = required.filter((field) => !filled(task[field]))
  return { required, missing, unknownKind: false, unjudgeableEmpty: false }
}


/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, scheduler: any, updatePlanBatch: any, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_edit_plan',
      description: 'Atomically revise an AgentTeams plan. While staged, edit tasks and roster without starting work. While running, only update_task is allowed, and only for pending tasks with no prior attempt: correct dependencies, assignees or descriptions before they start; newly ready work is scheduled after commit. Never edit active/finished attempts. Submit dependent edits in order. Never modify .agent-teams files directly.',
      parameters: {
        operations: {
          type: 'array',
          required: true,
          description: 'One atomic, ordered batch. Running teams allow only update_task for never-started pending tasks. If any operation is invalid, none of the edits are saved.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                required: true,
                enum: ['update_member', 'update_task', 'add_task', 'remove_task', 'remove_member'],
              },
              member_name: { type: 'string', description: 'Member name for update_member or remove_member.' },
              task_id: { type: 'string', description: 'Task id for update_task or remove_task.' },
              subject: { type: 'string', description: 'Required for add_task; optional replacement for update_task.' },
              description: { type: 'string', description: 'Optional task description.' },
              assignee: { type: 'string', description: 'Optional task assignee; an empty string moves it to the shared pool.' },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Complete replacement dependency list for a task.' },
              /**
               * ── ★★★ t9：`kind` 这条通道必须**先开出来**，否则后面全是空话 ──────────
               *
               * MEASURED（t9 修前，宿主校验器逐字）：本 items 是
               * `additionalProperties: false` 而没有 `kind` 属性，于是
               *
               *     { action:'add_task', subject:'x', dependencies:[], kind:'work' }
               *       ⇒ REJECTED: "operations[0].kind" is not a declared property
               *
               * ★★ ⇒ 修前的 `add_task` **不是**"显式传 work 能通"，而是**连传都传不进去**。
               *   所以验收里那条"反向半边"在修前是 **refuted 不是 confirmed** ——
               *   本任务的形状不是"保住一个现有行为"，是**先开出通道、再证明显式通过**。
               *
               * ★ `enum` 取自 `TASK_KINDS`（值导入，`../types.ts:158`），**不在这里抄一份**
               *   —— 抄一份就是同一条枚举的两个副本，而副本会分叉（本队记账最贵的那类）。
               */
              kind: {
                type: 'string',
                enum: [...TASK_KINDS],
                description: 'Required for add_task: the task kind must be declared explicitly — this route must not silently create a "work" task. A quality kind additionally requires objective + acceptance; implementation/repair also require inScope + verify.',
              },
              /**
               * ── ★★ 契约四格：显式声明 quality kind 之后，这四格必须传得进来 ────────────
               *
               * ★ 否则 `validateCreateTask` 会要求它们而 schema 传不进 ⇒
               *   quality kind 被 **100% 拒绝**。那不是"校验接上了"，是"这条路被关死了"。
               * ★ 形状照抄 `src/tools/create.ts` 的同一组（那一处已是"整组放行"的先例）。
               */
              objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
              inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change. Required for implementation/repair.' },
              acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
              verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
              role: { type: 'string', description: 'Optional member role.' },
              provider: { type: 'string', description: 'Optional member provider; defaults to the current staged route.' },
              model: { type: 'string', description: 'Optional member model; defaults to the current staged route.' },
              reasoning_effort: { type: 'string', description: 'Optional member reasoning effort.' },
              execution_prompt: { type: 'string', description: 'Optional member-specific execution prompt.' },
            },
          },
        },
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
            dependencies: { type: 'number', required: true },
            roster: { type: 'array', items: { type: 'string' }, required: true },
            graph: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.status === 'staged' ? 'Staged plan' : 'Pending task graph'} updated atomically (${value.members} members, ${value.tasks} tasks, ${value.dependencies} dependencies). ${value.status === 'staged' ? 'No members were spawned and no tasks were scheduled.' : 'The scheduler will dispatch any newly ready work.'}\n${value.graph.join('\n')}`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const team = await requireCaptainTeam(workspace, config, captain)
        if (args.operations.length === 0) throw new Error('at least one staged plan operation is required')

        const mutations: StagedPlanMutation[] = args.operations.map((operation, index) => {
          const label = `operation ${index + 1} (${operation.action})`
          if (operation.action === 'update_member') {
            const memberName = operation.member_name?.trim() ?? ''
            if (memberName === '') throw new Error(`${label} requires member_name`)
            const member = requireMember(team, memberName)
            return {
              action: 'update_member',
              memberName,
              role: operation.role ?? member.role,
              provider: operation.provider?.trim() || member.provider || '',
              model: operation.model?.trim() || member.model || '',
              reasoningEffort: operation.reasoning_effort ?? member.reasoningEffort,
              executionPrompt: operation.execution_prompt ?? member.executionPrompt,
            }
          }
          if (operation.action === 'update_task') {
            const taskId = operation.task_id?.trim() ?? ''
            if (taskId === '') throw new Error(`${label} requires task_id`)
            const task = requireTask(team, taskId)
            /**
             * ── ★★★ t22：`update_task` 也可能把一条任务改成"质量形状而契约是空的"──────
             *
             * ★ 这一条与 `add_task` 那一条**不是同一个入口的两个副本** ——
             *   它们是两个**不同的**离开口（一个建、一个改），而缺陷在**两个口**上都存在：
             *   `update_task` 可以改 subject/description/assignee/dependencies，
             *   却**改不了** kind 与那几格契约（结构所限）⇒ 若一条任务已经是质量类
             *   而契约是空的，从这里更新一下就会让它**看起来像刚被人打理过**。
             *
             * ★★ 而这一格的判据与 `validateCreateTask` **同源**（借那两个谓词），
             *   于是"哪种 kind 要哪些格"只有**一处**实现。
             */
            const requirement = contractRequirement(task.kind, task as unknown as Record<string, unknown>)
            if (requirement.missing.length > 0) {
              throw new Error(
                `${label}: task ${taskId} is kind "${String(task.kind)}", which requires a non-empty `
                + `${requirement.required.join(' and ')} — but ${requirement.missing.join(' and ')} `
                + `${requirement.missing.length === 1 ? 'is' : 'are'} empty. This is NOT "a task that needs no contract": `
                + `that kind requires one. Edit the contract with create_task/amend before it can be claimed.`,
              )
            }
            /**
             * ── ★★★ t22：**第三态的处置** —— "判不了"且四格全空 ⇒ 拒绝 ─────────────────
             *
             * MEASURED（t22，真工具入口，修前）：一条 `kind` 缺席、四格全空的任务
             * （t1 本尊的形状）走 `update_task` 是 **ALLOWED** 的，随后仍然可认领。
             * 因为 `contractRequirement(undefined, {})` 交回 `missing: []`
             * ⇒ 上面那道闸门不开火 ⇒ "判不了"被静默读成了"没问题"。
             *
             * ★★ 而它的措辞**必须**与上面那一支不同形（验收第 2 条）：
             *   上面说的是"这个 kind **要求**契约而它是空的"；
             *   这一支说的是"**我判不了**它需不需要契约，而它的契约是空的"。
             *   两者的补救动作相反：一个去补具体那几格，一个先去**声明 kind**。
             */
            if (requirement.unjudgeableEmpty) {
              throw new Error(
                `${label}: task ${taskId} has no declared kind AND an entirely empty contract `
                + `(objective, acceptance, inScope and verify are all absent or blank). `
                + `This is NOT "a task that needs no contract": I cannot tell WHICH it is, because the kind that `
                + `would decide it was never declared. An empty contract on an unjudgeable task is indistinguishable `
                + `from a contract that was lost in transit — which is exactly the shape a member cannot act on. `
                + `Declare the kind (create_task/amend) and write its contract, or state why this task needs none.`,
              )
            }
            return {
              action: 'update_task',
              taskId,
              subject: operation.subject ?? task.subject,
              description: operation.description ?? task.description,
              assignee: operation.assignee ?? task.assignee,
              dependencies: operation.dependencies ?? task.dependencies,
            }
          }
          if (operation.action === 'add_task') {
            const subject = operation.subject?.trim() ?? ''
            if (subject === '') throw new Error(`${label} requires a non-empty subject`)
            /**
             * ── ★★★ t22：这一条**就是本任务修的那个缺陷** ──────────────────────────────
             *
             * MEASURED（本任务，在真入口上复现）：`add_task` 此前**只**要求 subject
             * 非空，于是它产出的任务**一个契约格都没有** —— 而那条任务仍然
             * `status: 'pending'`、**可被认领**。
             *
             * ★★ 而它的真实后果不是"成员少拿了几格"，是**成员分不出这两种情形**：
             *     「这条任务不需要契约」        （合法：`work` 类按表就是不要求，见下）
             *     「这条任务的契约丢了」        （缺陷：t1 就是这样）
             *   两者在认领时的载荷上**同形**（都是空的）。t1 的持有者正确地**拒绝猜** ——
             *   而"正确地拒绝"的代价是一次完整的派工往返；一个不那么小心的成员会
             *   **编一个文件集合**出来（要么占掉别人的在飞工作，要么什么都不提交）。
             *
             * ── ★★ 修法为什么是"说清它属于哪一种"而不是"一律要求契约" ─────────────────
             *
             * ★ 因为 `add_task` **结构上给不出契约**：它的 `StagedPlanMutation`
             *   （`shared/entities.ts:216`）只有 subject/description/assignee/dependencies，
             *   而 `tools.ts:1970` 把它的 kind **写死成 `'work'`**。
             *   ⇒ 而 `work` 在**表里**明确写着"不要求 verify、不要求 inScope"
             *     （`gates/completion/kind-requirements.json` 的 `work.because`，逐字：
             *      "work is the kind whose contract deliberately does not require a
             *       verify list or an inScope at all"）。
             *   ⇒ 所以"一律要求契约"会**违反表的决定**，会把每一个 work 任务挡死 ——
             *     而那条要求是**有理由的**空的（"empty array WITH a reason, not a default"）。
             *
             * ★★★ 于是判据是：**这条任务是不是被当成质量任务在用？**
             *   三个来源可以被判断，而第三个**判不了**：
             *
             *   ① `kind` 在场且是质量/写类 ⇒ 要求契约 ⇒ 缺了就拒（指名缺哪几格）
             *   ② `kind` 在场且是 `work`（`add_task` 的常态）⇒ **明确不要求**
             *      ⇒ 放行，而**如实把"它为什么不需要"说出来**（见下面的 note）
             *   ③ `kind` 缺席 ⇒ **判不了** —— 而 `add_task` 恰恰**总是**这一态之前的
             *      第 ② 态（`tools.ts` 写死 'work'），所以这里不会假装判过。
             *
             * ── ★★★ t9 推翻的正是上面「结构上给不出」那一句 ────────────────────────
             *
             * ★ 上面整段（t22 写的）的**推理是对的，前提已经过期**："结构上给不出契约"
             *   曾经成立，而 t9 把 `kind` 与契约四格开进了 `StagedPlanMutation`
             *   与下面这份 schema ⇒ 第 ③ 态（kind 缺席）在本入口**不再产生**，
             *   于是"判不了"这一支在这里成为**不可达** —— 而那是**好事**：
             *   它把"没人声明过类型"从一件事后判不了的事，变成了一件**当场就拒**的事。
             *
             * ★★ 保留整段原文而不删，是因为它是**第 ③ 态为什么曾经必须存在**的唯一记录。
             *   删掉它，下一个人会以为 `contractRequirement(undefined, …)` 那一支
             *   从来没必要 —— 而它恰恰是 t22 在**另一条入口**（`update_task`）上
             *   仍然生效的判据（那条路仍可以遇到历史遗留的无 kind 任务）。
             */
            /**
             * ── ★★★ t9：kind 必须**显式声明**，不许在这里补 'work' ──────────────────
             *
             * ★★ 判据的形状：`kind` 缺席 ⇒ **拒绝**，并**指名**"kind 未声明"。
             *   不是写 `'work'`（那是修前的静默造值），也不是落一个"键缺席的标记"
             *   （实测：`work` / `verification` / `review` / `undefined` 在完工位置上
             *   读数**逐字相同** ⇒ 一个缺席的键在裁决面上零信息量）。
             *
             * ★ 而它是**双层拒的第一层**（调用点这一层）。第二层在
             *   `src/tools.ts` 的 add_task 分支上 —— 两层防的是**不同的事**：
             *     这一层防"一个走工具进来的计划操作没声明类型"；
             *     那一层防"某个绕过本 mapper 的调用方（HTTP 路由、内部调用）"。
             *   ⇒ 删一层不删另一层，等于只关了一扇门。
             */
            const kind = operation.kind as TaskKind | undefined
            if (kind === undefined) {
              throw new Error(
                `${label} requires an explicit kind for add_task: `
                + 'the plan route must not silently create a "work" task. '
                + 'Declare kind ("work" for ordinary work, or a quality kind such as "implementation"). '
                + '★ An undeclared kind and a kind of "work" are indistinguishable at the adjudication '
                + 'surface, so "nobody declared this" cannot be recovered after the fact — it has to be refused here.',
              )
            }
            /**
             * ★★ 契约读**真的那个 kind**（不再是硬编码的 `'work'`）——
             *   于是质量类的主张在这里就要求契约，缺了就当场指名缺哪几格。
             */
            const requirement = contractRequirement(kind, {
              subject,
              description: operation.description,
              assignee: operation.assignee,
              objective: operation.objective,
              inScope: operation.inScope,
              acceptance: operation.acceptance,
              verify: operation.verify,
            })
            /**
             * ★ **明确不要求**（`work`）⇒ 放行，但把这件事**记进描述**，
             *   好让认领的人**读得到"它为什么没有契约"**，而不是只能看到一个空形状。
             *
             * ★★ 为什么不放进 payload 的字段里：`StagedPlanMutation` 的结构不在
             *   本任务 scope 内。而**描述**是那条任务的自由文本格，它本来就是
             *   给成员读的 —— 把它写在那里，是**在既有形状里**把这个事实说清楚，
             *   而不是去改一个别的任务拥有的结构。
             */
            const whyNoContract = requirement.required.length === 0
              ? `This task is kind "${kind}", which by the kind-requirements table deliberately requires `
                + 'no objective/acceptance/inScope/verify. An empty contract here is INTENDED, not lost. '
                + 'If this task actually needs quality gates, file it as a quality kind instead.'
              : undefined
            return {
              action: 'add_task',
              subject,
              description: whyNoContract === undefined
                ? operation.description
                : [operation.description?.trim(), `[contract note] ${whyNoContract}`].filter(Boolean).join('\n\n'),
              assignee: operation.assignee,
              dependencies: operation.dependencies ?? [],
              /**
               * ★★ t9：kind 与契约四格**逐格转发** —— 漏转一格就等于把那条验收做成了空话。
               *   （本仓记账过的形状：判据写对了而输入面没接上，在断言层面与"没判据"同形。）
               */
              kind,
              objective: operation.objective,
              inScope: operation.inScope,
              acceptance: operation.acceptance,
              verify: operation.verify,
            }
          }
          if (operation.action === 'remove_task') {
            const taskId = operation.task_id?.trim() ?? ''
            if (taskId === '') throw new Error(`${label} requires task_id`)
            return { action: 'remove_task', taskId }
          }
          const memberName = operation.member_name?.trim() ?? ''
          if (memberName === '') throw new Error(`${label} requires member_name`)
          return { action: 'remove_member', memberName }
        })
        const updated = await updatePlanBatch(captain, team.id, mutations, exec.signal, true)
        if (updated.phase !== 'staged') await scheduler.kickTeam(workspace, team.id, captain)
        return {
          status: updated.phase ?? 'running',
          team_id: updated.id,
          members: updated.members.length,
          tasks: updated.tasks.length,
          dependencies: updated.tasks.reduce((sum: number, task: TeamTask) => sum + task.dependencies.length, 0),
          roster: updated.members.map((member: TeamMember) => `${member.name} (${member.role || 'member'}; ${member.provider ?? ''}/${member.model ?? ''})`),
          graph: updated.tasks.map((task: TeamTask) => `${task.id}: ${task.subject} -> ${task.assignee || 'shared'}${task.dependencies.length === 0 ? '' : `; depends on ${task.dependencies.join(', ')}`}`),
        }
      },
    }))
}
