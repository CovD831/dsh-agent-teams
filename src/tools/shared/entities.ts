// ── src/tools/shared/entities.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的共享实体（含它们自身的传递依赖）。
// ★ 搬运规则：一个字符都不改 —— 「拆分不得改变行为」最直接的证据就是逐字相同。
// ★ 本文件【不允许】import src/tools.ts（会成环：tools.ts → 工具模块 → 本文件）。
// 它只 import 更底层的模块。

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { dirname, join } from 'node:path'
/**
 * ★ t53：规则表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 *   ★ 方向不会成环：`verify-command.ts` 只 import `registry.ts` / `requires.ts`，
 *     它不知道 tools 层存在。
 *   ★ 而校验与读盘分开是刻意的：读不到是**调用方**的事实（`absent`），
 *     形状坏是**数据本身**的事实（`malformed`）—— 两者不同形，由两个地方各自判。
 */
import { parseRules, type RulesLoad } from '../../gates/contract/verify-command.ts'

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registry, gateModuleViews } from '../../gates/index.ts'
import type { GatePoint } from '../../gates/index.ts'
import { installMemberSelectionRuntime, resolveMemberLlmSelection, validateMemberLlmSelections } from '../../members.ts'
import { resolveTeamProfile } from '../../profiles.ts'
import { createTeamDir } from '../../state.ts'
import type { AcceptanceResult, ReviewFinding } from '../../types.ts'
import { planQualityFollowUp } from '../../quality-gates.ts'
import { auditRequires } from '../../gates/requires.ts'
import { TERMINAL_TASK_STATUSES } from '../../types.ts'
/**
 * ★ t20：真值从 `types.ts` 取 —— 与 `scheduler.ts` **同一份**。
 *   （`types.ts` 是叶子模块：不 import 任何东西 ⇒ 两边共用不造环。）
 */
import { needsWorktreeFor } from '../../types.ts'
import type { CommandResult, TeamMember, TeamState, TeamTask, TaskStall } from '../../types.ts'
import { collectCompletedDependencyOutputs, formatDependencyOutputs } from '../../scheduler.ts'
import { sessionOwnEvents } from '../../harness-compat.ts'
import { CAPTAIN_KEY, findTeamByCaptain, findTeamByParticipant, readTeam, withTeamLock } from '../../state.ts'

export function withInputSurfaceOnError<T extends { execute: (...args: never[]) => unknown }>(tool: T): T {
  const inner = tool.execute
  const wrapped = async function (this: unknown, ...args: never[]): Promise<unknown> {
    try {
      return await (inner as (...rest: never[]) => unknown).apply(this, args)
    } catch (error: unknown) {
      const surface = inputSurfaceFromThrown(error)
      if (error === null || typeof error !== 'object') throw error
      /**
       * ── ★★★ t5：这两份结论**各自独立**地搬，不许共用一句早退 ──────────────────────
       *
       * MEASURED（t5 实测，本函数的结构本身是一个陷阱）：
       *   上面那句原本是 `if (surface === undefined || error === null || …) throw error`
       *   —— 一个把**两件事**合起来的条件：类型守卫（`error` 不是对象 ⇒ 没法挂属性，
       *   这条必须留）与"没有输入面结论"（这条**与下面的搬运无关**）。
       *   ⇒ 若在这里早退，"判据说它测不了"的那份结论会被**静默吞掉** ——
       *     而它跟输入面在不在**没有任何关系**（契约位置的 unmeasured 恰恰
       *     经常与一条齐备的输入面同时出现）。
       *   ★ 这正是本队记账的形态：**一个条件里混了两种判定，于是其中一种的缺席
       *     变成了另一种的静默**。
       *
       * ⇒ 类型守卫留在上面（它是真的前置条件）；两份结论各自判自己的在场。
       *   ★ 顺序与耦合都变了，而**行为一个字没变**：`surface` 不在场时，
       *     `input_surface` 那一支照旧什么都不做。
       */
      const couldNotMeasure = contractUnmeasuredOf(error)
      if (couldNotMeasure !== undefined && !Object.hasOwn(error, 'contract_unmeasured')) {
        ;(error as { contract_unmeasured?: unknown }).contract_unmeasured = couldNotMeasure
      }
      if (surface === undefined) throw error
      /**
       * ★★ 纪律 ①：**先到的那一份说话**。已经搬过的那一份不许被覆盖。
       *
       * ── MEASURED（2026-10-06，verifier5 抓到的 blocker；本任务的 FINDING-1）────────
       *
       * 这里此前写的是 `if (INPUT_SURFACE_PROPERTY in error) throw error` —— 而那一句
       * **对每一次 `throwWithSurface` 抛出都为真**：`throwWithSurface` 刚把这个属性
       * 挂上去，它就是带着它抛出来的。⇒ 包装**当场放弃搬运**，下一行的搬运**永不执行**。
       *
       * ⇒ 后果不是"某一处少了个字段"，是**整条拒绝路径的出口失效**：
       *
       *      update_task { changedPaths: ['src/out-of-scope.ts'] }   ← 一次真实拒绝
       *        error.agentTeamsInputSurface = {checked:2,incomplete:1,…}  ← 结论在
       *        error.input_surface          = undefined                    ← 边界没搬
       *
       *   于是四处里只有**成功**路径补上了出口，一旦被拒就回到 t9 钉住的那个不对称
       *   （只剩一个 `logger.warn`）—— 而拒绝**恰恰是最需要读到输入面**的那一刻：
       *   一次真实拒绝里，"是契约本身不合法"与"是判据要的那一格没接上"正是最容易
       *   合流的两件事（前者是拒绝的理由，后者不是）。
       *
       * ── 为什么"检查错了属性"是特别难看见的一种错 ────────────────────────────
       *
       * 两个名字只差一点：`INPUT_SURFACE_PROPERTY`（**判据挂的内部属性**，
       * = `'agentTeamsInputSurface'`）与 `input_surface`（**工具结果的字段**）。
       * 守卫要判断的明明是后者（"这一跳搬过没有"），却写成了前者 ⇒ 它**恒真**。
       * ★ 一个永远为真的守卫不是"更严格"，是**不存在**。而它在断言层面读起来完全正常：
       *   属性在场、值也对，只是搬运从未发生。
       * ⇒ 本队把这记作「恒真写法」的**第四种**：**守卫检查了另一个同名的东西**。
       *
       * ── 修法：检查**搬运后的落点** ──────────────────────────────────────────
       *
       * `Object.hasOwn(error, 'input_surface')` 问的正是"这一跳搬过没有"。
       * ⇒ 「先到的那一份说话」这条语义**一个字没变**：第一个搬运的赢，后来的
       *   （例如一次 `update_task` 里 completion 位置在 dispatch 之后抛出）不许覆盖它。
       * ★ 用 `Object.hasOwn`（自有属性）而不是 `'input_surface' in error`：后者会把
       *   原型链上的同名属性也算进来 —— 而"从原型继承来的字段"与"我自己搬过"
       *   是两件事。
       */
      if (Object.hasOwn(error, 'input_surface')) throw error
      /**
       * ★ 只在这里搬一次：`input_surface` 是**工具结果**的字段名（与 runtime 那个
       *   出口逐字段同形），而异常上的那个自有属性叫 `agentTeamsInputSurface`
       *   （见 `INPUT_SURFACE_PROPERTY`）。两个名字分开，于是"挂在哪"读得出来。
       * ★ 上面那句守卫已经保证了"没搬过"，所以这里**直接赋值**，不再写一次
       *   `=== undefined` 判断 —— 同一个条件写两遍，就是两处会慢慢分叉的地方。
       *
       * ★★ 落到**哪个**字段名由抛出方决定（`inputSurfaceFieldOf`）：一次
       *   `update_task` 穿过两个位置，成功路径上它们各挂各的
       *   （`dispatch_input_surface` / `completion_input_surface`）⇒ **拒绝路径
       *   必须落到同一个名字上**，否则"同一个位置在两条路径上不同形"，而按位置名
       *   去找的读者会读不到（那与"这个位置没判据"同形）。
       */
      ;(error as Record<string, unknown>)[inputSurfaceFieldOf(error)] = surface
      /**
       * ★★ 拒绝路径**同时**挂泛用名（t4 修；MEASURED：verifier5 的臂 1/7 复跑暴露）──
       *
       * 一次 `update_task` 穿过两个位置，它们在成功路径上**各挂各的**
       * （`dispatch_input_surface` / `completion_input_surface`）。拒绝路径只挂位置名
       * 会造出一个新的不同形：**同一位置**在成功路径上读 `dispatch_input_surface`、
       * 在拒绝路径上就读不到（而它其实**有**结论）——"读不到"与"没有结论"同形。
       *
       * ⇒ 两条路都留：位置名（按位置去找的读者用）+ 泛用名（按"这次调用有没有交出
       *   结论"去找的读者用）。
       *
       * ★★ **它们是同一个对象的两个名字，不是两份真相。**（user 裁定已明确批准这个
       *   形状；这一句必须写在这里，因为下一个人看到两个字段名会以为那是两份独立数据。）
       *   实现上就是**同一行** `surface` 被赋给两个键 —— 中间没有任何一次重新计算：
       *
       *       const surface = inputSurfaceFromThrown(error)   // ← 唯一的那一份
       *       error[inputSurfaceFieldOf(error)] = surface     // ← 位置名
       *       error.input_surface               = surface     // ← 泛用名（同一个对象）
       *
       *   ⇒ 可机械核对：`JSON.stringify(error.input_surface) ===
       *      JSON.stringify(error.dispatch_input_surface)`。若哪天有人在两个键之间插入
       *      一次"重新算一遍"，这条相等立刻不成立 —— 而那时它们**真的**成了两份真相
       *      （本队反复见过的那种分叉）。
       *
       * ★ 泛用名只在**没人占**的时候写：一次调用穿过两个位置时，第一个拒绝的已经
       *   写过了 ⇒ 后来的不许覆盖（"先到的那一份说话"，与上面那句守卫同一条纪律）。
       */
      if (!Object.hasOwn(error, 'input_surface')) {
        ;(error as { input_surface?: unknown }).input_surface = surface
      }
      throw error
    }
  }
  return { ...tool, execute: wrapped } as unknown as T
}
export interface ToolsConfig {
  /** State directory name under the captain's workspace. */
  stateDir: string
  /** Member subagent provider name. */
  memberProvider: string
  /** Optional member model override. */
  memberModel?: string
  /** Prompt injected into member personas and assignments. */
  executionPrompt?: string
  /** Plugin fallback route. */
  fallback?: import('../../profiles.ts').TeamModelFallbackConfig
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Team size cap (members). */
  maxMembers: number
  /** Named team profiles from the active DSH profile. */
  profiles: Record<string, import('../../profiles.ts').TeamProfileConfig>
  /**
   * ── ★ 时钟（t5）：探活判据唯一的读数来源 ─────────────────────────────────────
   *
   * 契约 §2 性质 1 说判据是纯数据变换、**I/O 与时钟由调用方注入**。所以
   * `src/gates/runtime/liveness.ts` 里没有 `Date.now()`，它读的是 ctx 里的
   * `wait.now` —— 而那个值来自这里。
   *
   * ★ 缺省 `Date.now` 是**生产**的缺省，不是夹具的。夹具注入假时钟才能在不真等
   *   10 分钟的情况下构造"两次探活之间成员一点产出都没有"。
   *   **一个测不了超时的探活判据等于没有探活** —— 而不注入时钟就只剩真等这一条路。
   *
   * ★ 不注入 ⇒ 判据按自己的契约报 unmeasured（缺 `now`），**不是**退回系统时钟。
   *   偷偷退回 `Date.now` 会让"夹具以为自己在控制时间"与"判据读了真实时间"
   *   在日志里同形 —— 那种缺陷只在跨零点或长会话里出现。
   */
  now?: () => number
}
export type StagedPlanMutation =
  | {
      action: 'update_member'
      memberName: string
      role?: string | null
      provider: string
      model: string
      reasoningEffort?: string | null
      executionPrompt?: string | null
    }
  | {
      action: 'update_task'
      taskId: string
      subject: string
      description?: string | null
      assignee?: string | null
      dependencies: string[]
    }
  | {
      action: 'add_task'
      subject: string
      description?: string | null
      assignee?: string | null
      dependencies: string[]
    }
  | { action: 'remove_task'; taskId: string }
  | { action: 'remove_member'; memberName: string }
export interface AgentTeamsRuntime {
  isPendingMember(agent: Agent): boolean
  updateStagedPlan(captain: Agent, teamId: string, mutation: StagedPlanMutation, signal?: AbortSignal): Promise<TeamState>
  updateStagedPlanBatch(captain: Agent, teamId: string, mutations: readonly StagedPlanMutation[], signal?: AbortSignal): Promise<TeamState>
  approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{ teamId: string; members: number; tasks: number }>
  continueStagedPlanning(captain: Agent, teamId: string): Promise<{ teamId: string; alreadyWaiting: boolean }>
  discardStagedTeam(captain: Agent, teamId: string): Promise<{ teamId: string }>
}
export function requireCaptain(exec: ToolRunContext): Agent {
  if (!exec.agent) {
    throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)')
  }
  return exec.agent
}
export function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}
export const VERIFY_COMMAND_TIMEOUT_MS = 120_000
/**
 * ── ★★★ 规则表的**运行时**读取（t53）────────────────────────────────────────────
 *
 * ★ 为什么读盘这一件事必须在这里（而不是判据里）：
 *
 *   判据**不许 import 任何 I/O**（`scripts/verify-gates-integration.test.mjs` ④
 *   逐行检查 import 子句）⇒ 它只能拿到调用方交进去的东西。
 *   ⇒ 于是"改数据 ⇒ 立刻生效"这件事的**成立条件**就是：**调用方每次调用时读**。
 *
 * ★★ 而这正是那个三分类里**唯一**兑现"不必重载"的一类：
 *
 *     改【跑着的代码】（.ts 的逻辑）        ⇒ 要 build + 重载
 *     改【被内联进 lib 的数据】（静态 import）⇒ ★ 要 build + 重载（只省了"懂 TS"）
 *     改【运行时读盘的数据】（这里）        ⇒ ★ 不 build、不重载
 *
 *   MEASURED（t53）：静态 `import rules from './….json'` 在本仓库连编译都过不去
 *   （`TS1543 … requires a 'type: "json"' import attribute when 'module' is NodeNext`）；
 *   即便打开 `resolveJsonModule`，JSON 也会被 `tsc` 内联进 `lib/` ⇒ 改数据仍要 build。
 *   ★ 所以中间那一类**看起来像数据**，而它在运行时与代码同命。
 *
 * ★ 四态**互不同形**（`parseRules` 判后两者，这里判前两者）：
 *     loaded / absent（读不到）/ malformed（形状坏）/ empty（空表）
 *   ⇒ 后三者会让判据降级成 `unmeasured` —— **绝不静默退化成"没有规则"**。
 */
export async function loadVerifyCommandRules(workspace: string): Promise<RulesLoad> {
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  /**
   * ★ 数据文件**跟着源码走**（`src/gates/contract/verify-command-rules.json`），
   *   而不是跟着工作区 —— 它是**插件自己的**规则表，不是被审对象的属性。
   *   ★ 而它必须与 `verify-command.ts` 同一次构建一起被复制到 `lib/` 下
   *     （见 `scripts/git-artifacts.mjs` 的 copy 清单）——
   *     否则"读得到"在生产里会变成"读不到"，而那个失效是静默的。
   */
  const here = path.dirname(fileURLToPath(import.meta.url))
  /**
   * ★ 两份候选：**先看产物旁边**（`lib/gates/contract/…`，生产路径），
   *   再看源码旁边（`src/gates/contract/…`，夹具/开发路径）。
   *   ★ 顺序无关正确性（两者是同一份文件的两个副本），而它让"哪个都不在"
   *     与"读到了"分得开 —— 前者是 `absent`，后者是 `loaded`。
   */
  const candidates = [
    path.resolve(here, '..', '..', 'gates', 'contract', 'verify-command-rules.json'),
    path.resolve(here, '..', '..', '..', 'src', 'gates', 'contract', 'verify-command-rules.json'),
  ]
  let lastError = ''
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, 'utf8')
      return parseRules(JSON.parse(text))
    } catch (error) {
      lastError = `${candidate}: ${String((error as { message?: unknown })?.message ?? error)}`
    }
  }
  void workspace
  return { status: 'absent', reason: `the rule table could not be read from any known location (${lastError})` }
}

export async function runVerifyCommand(workspace: string, command: string): Promise<number> {
  const { spawn } = await import('node:child_process')
  return await new Promise<number>((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: workspace,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve(125)
    }, VERIFY_COMMAND_TIMEOUT_MS)
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(127)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code ?? 125)
    })
    // 排空输出，避免管道写满后子进程阻塞
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', () => {})
  })
}
export const taskWorktreeBase = new Map<string, string>()
export function worktreeBaseOf(taskId: string): string | undefined {
  const base = taskWorktreeBase.get(taskId)
  return typeof base === 'string' && base.trim() !== '' ? base : undefined
}
export type BaseRevisionResolution =
  | { kind: 'resolved'; revision: string; from: 'memory' | 'record' }
  | { kind: 'absent'; reason: 'no-worktree' | 'not-recorded' }
export function resolveBaseRevision(task: { id: string; attempt?: number; kind?: string }): BaseRevisionResolution {
  const fromMemory = worktreeBaseOf(task.id)
  if (fromMemory !== undefined) return { kind: 'resolved', revision: fromMemory, from: 'memory' }
  const rawRecord = (task as unknown as Record<string, unknown>)['baseRevision']
  const fromRecord = typeof rawRecord === 'string' && rawRecord.trim() !== ''
    ? rawRecord.trim()
    : undefined
  if (fromRecord !== undefined) return { kind: 'resolved', revision: fromRecord, from: 'record' }
  /**
   * ── ★★★ 两种"没有"必须分得开 —— 而**判据是【kind】，不是 `attempt`**（t20 修）────
   *
   * MEASURED（t20）：此前这里写的是
   *
   *     attempt > 0 ? 'not-recorded' : 'no-worktree'
   *
   * ★ 那是一个**按设计成立的恒不可达**（`decompose-author` 找到，captain 逐字复核）：
   *
   *     ① `scheduler.ts` 只给 `KINDS_NEEDING_WORKTREE`（implementation/repair）建树
   *        ⇒ 其余五种 kind（verification/review/integration/work/requirements）
   *        **永远不会**有 worktree ⇒ 基准**从来没有**存在过；
   *     ② 而它们一旦被重派（`attempt > 0`）⇒ 旧写法判 `'not-recorded'`（"本该有却丢了"）
   *        ⇒ `completion.backtest` 判 **blocked** ⇒ `update_task` 恒被拒
   *     ③ ⇒ **任何非 implementation/repair 的任务，只要被重派过一次，
   *        就再也无法提交终态** —— 而它被拒的理由描述的原因**从来没有发生过**。
   *
   * ★ 形态：这是三态纪律的**镜像**。
   *   三态纪律说「**没能测量**不得读成**测得了零**」；
   *   这里曾经是「**按设计不存在**被读成**本该存在却丢了**」——
   *   两个方向的合流同源：**把两种不同的"没有"合成一个 `undefined`**。
   *
   * ⇒ 正确的判据是 kind：**它会不会被派发到隔离 worktree**（那是"该不该有父版本"的
   *   唯一真值）。而它从 `needsWorktreeFor` 取 —— 与调度器**同一份真值**，
   *   不在这里另写一遍 `kind === 'implementation' || kind === 'repair'`
   *   （两份实现会分叉，而分叉之后"判据说它该有、而调度器从没建过"在日志里同形）。
   *
   * ★ `attempt` 在这一版里**不再参与判定**，而那是刻意的：
   *   "这个任务被派发过几次"与"这类任务该不该有父版本"是两件不相干的事。
   *   旧写法把它们绑在一起，于是**重派**（一个与基准无关的动作）会翻转诊断。
   *
   * ★ 而"从未派发过"与"按设计没有"**不再合并**（旧写法合并了）：两者都落
   *   `'no-worktree'`，因为它们对下游是**同一件事** —— 父版本**本就不该有**。
   *   ★ 而判据那边两种成因的措辞已经分得很清（`backtest.ts` 说的是
   *     "this task is not expected to have one"），所以合并的是**诊断**，不是**裁决**。
   */
  const expectWorktree = needsWorktreeFor((task as { kind?: string }).kind)
  return { kind: 'absent', reason: expectWorktree ? 'not-recorded' : 'no-worktree' }
}
export async function runInDetachedRevision(options: {
  workspace: string
  revision: string
  command: string
}): Promise<number | undefined> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const scratch = await mkdtemp(join(tmpdir(), 'agent-teams-rev-'))
  const checkout = join(scratch, 'co')
  try {
    const added = await runVerifyCommand(options.workspace, `git worktree add --quiet --detach ${JSON.stringify(checkout)} ${options.revision}`)
    if (added !== 0) return undefined
    try {
      return await runVerifyCommand(checkout, options.command)
    } finally {
      await runVerifyCommand(options.workspace, `git worktree remove --force ${JSON.stringify(checkout)}`)
    }
  } catch {
    return undefined
  } finally {
    try {
      await rm(scratch, { recursive: true, force: true })
    } catch {
      // 清理失败不影响裁决：它既不产生"通过"也不产生"拒绝"
    }
  }
}
export async function deriveCoverageInput(options: {
  workspace: string
  testFiles: readonly string[]
  knownTests: readonly string[]
}): Promise<Record<string, unknown> | undefined> {
  const { readFile, readdir } = await import('node:fs/promises')
  if (options.testFiles.length === 0 || options.knownTests.length === 0) return undefined
  const readText = async (relative: string): Promise<string | undefined> => {
    try {
      return await readFile(join(options.workspace, relative), 'utf8')
    } catch {
      return undefined
    }
  }
  /** 从一段源码里抽出它 import 的相对路径（解析成 workspace 相对、带扩展名）。 */
  const importsOf = (source: string, from: string): string[] => {
    const out: string[] = []
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec === undefined || !spec.startsWith('.')) continue
      const base = join(dirname(from), spec)
      const resolved = /\.[cm]?[jt]sx?$/.test(base) ? base : `${base}.ts`
      out.push(resolved.startsWith(options.workspace) ? resolved.slice(options.workspace.length + 1) : resolved)
    }
    return out
  }
  const listSourceFiles = async (directory: string): Promise<string[]> => {
    const found: string[] = []
    const walk = async (relative: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(join(options.workspace, relative), { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const child = relative === '' ? entry.name : `${relative}/${entry.name}`
        if (entry.isDirectory()) await walk(child)
        else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/(^|\/)(test|tests|__tests__)\//.test(child) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(child)) found.push(child)
      }
    }
    await walk(directory)
    return found.sort()
  }

  const coverage: Record<string, string[]> = {}
  const dependents: Record<string, string[]> = {}
  const sourceFiles = await listSourceFiles('')
  if (sourceFiles.length === 0) return undefined

  /** 测试 → 它（传递地）import 到的源文件。 */
  for (const test of options.knownTests) {
    const text = await readText(test)
    if (text === undefined) continue
    const seen = new Set<string>()
    const queue = importsOf(text, test)
    while (queue.length > 0) {
      const next = queue.shift() as string
      if (seen.has(next)) continue
      seen.add(next)
      const source = await readText(next)
      if (source === undefined) continue
      queue.push(...importsOf(source, next))
    }
    for (const file of seen) {
      if (!coverage[file]) coverage[file] = []
      coverage[file].push(test)
      if (!dependents[file]) dependents[file] = []
      dependents[file].push(test)
    }
  }
  /** 源文件 → 直接 import 它的源文件（判据自己算传递闭包）。 */
  for (const file of sourceFiles) {
    const text = await readText(file)
    if (text === undefined) continue
    for (const imported of importsOf(text, file)) {
      if (!dependents[imported]) dependents[imported] = []
      dependents[imported].push(file)
    }
  }
  if (Object.keys(coverage).length === 0) return undefined
  return {
    source: 'dependency-graph',
    dependents,
    coverage,
    knownTests: [...options.knownTests],
    /**
     * ★ `selected` = 【全部已知测试】。
     *
     * 读法要说清，否则它会看起来像"我们在假装有个选测器"：
     *   本仓库确实【没有】变更级选测器。判据要求"覆盖了改动却没被选中的测试"被
     *   逐条报出来（盲区）。既然没有选测器，诚实的做法是**全选**，于是
     *   `blind`（已覆盖但未选中）为空，而 `testsWithNoCoverageData` 仍然如实报出
     *   "哪些测试的覆盖数据我们压根没有" —— 那一条才是这里真正的未知。
     *
     * ★ 绝不把一个【子集】当成 selected：那会凭空造出一个盲区报告，读起来像
     *   "有个选测器漏掉了这些测试"，而事实是我们从没做选测。
     */
    selected: [...options.knownTests],
  }
}
export async function runVerifyCommandCaptured(workspace: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process')
  const LIMIT = 256 * 1024
  return await new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: workspace, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const push = (into: 'out' | 'err', chunk: string): void => {
      if (into === 'out') stdout = (stdout + chunk).slice(-LIMIT)
      else stderr = (stderr + chunk).slice(-LIMIT)
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve({ exitCode: 125, stdout, stderr })
    }, VERIFY_COMMAND_TIMEOUT_MS)
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: 127, stdout, stderr })
    })
    child.stdout?.on('data', (data) => push('out', String(data)))
    child.stderr?.on('data', (data) => push('err', String(data)))
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code ?? 125, stdout, stderr })
    })
  })
}
export function readWorkspaceFileSync(workspace: string, relativePath: string): string {
  return readFileSync(join(workspace, relativePath), 'utf8')
}
export function writeWorkspaceFileSync(workspace: string, relativePath: string, contents: string): void {
  const target = join(workspace, relativePath)
  if (!target.startsWith(workspace.endsWith('/') ? workspace : `${workspace}/`)) {
    throw new Error(`refusing to write outside the workspace: ${relativePath}`)
  }
  writeFileSync(target, contents)
}
export function deriveScanDirs(changedFiles: readonly string[]): string[] | undefined {
  const dirs = new Set<string>()
  for (const file of changedFiles) {
    const parts = file.split('/')
    if (parts.length <= 1) continue
    dirs.add(parts.slice(0, -1).join('/'))
  }
  return dirs.size === 0 ? undefined : [...dirs].sort()
}
export async function changedLineNumbers(workspace: string, base: string | undefined): Promise<number[] | undefined> {
  if (typeof base !== 'string' || base.trim() === '') return undefined
  const { execFile } = await import('node:child_process')
  const run = (args: readonly string[]): Promise<string> => new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd: workspace, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout))
    })
  })
  try {
    const diff = await run(['diff', '--unified=0', base.trim(), '--'])
    const lines = new Set<number>()
    for (const match of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(match[1])
      const count = match[2] === undefined ? 1 : Number(match[2])
      for (let offset = 0; offset < count; offset += 1) lines.add(start + offset)
    }
    return [...lines].sort((a, b) => a - b)
  } catch {
    return undefined
  }
}
export function mergeRerunIntoCommandsRun(
  claimed: readonly CommandResult[] | undefined,
  reruns: readonly CommandResult[],
): CommandResult[] {
  const byCommand = new Map(reruns.map((item) => [item.command, item]))
  const base = [...(claimed ?? [])]
  const seen = new Set<string>()
  const merged = base.map((item) => {
    const rerun = byCommand.get(item.command)
    if (rerun === undefined) return item
    seen.add(item.command)
    /**
     * ★★ 重跑条目【不带 `failures`】（`verify-rerun.ts` 的 reruns.push 只填
     *    command/status/exitCode/evidence），而本函数此前用 `return rerun`
     *    整条替换成员如实报的那条 ⇒ **失败明细在到达判据之前丢失**。
     *
     * MEASURED（2026-10-11，t3 实测钉死的链）：
     *   成员报了逐字的失败名 ⇒ verify-rerun 重跑同一条命令 ⇒ 本函数整条覆盖 ⇒
     *   `quality-gates.ts` 的 classifyVerifyFailures 看到 `failures` 缺席
     *   ⇒ 恒 undecidable（"reported no per-test failures"）
     *   ⇒ ★ 任何含已知红的任务都无法到达 completed —— 而 pin 清单扣减那条路
     *     需要 failures 才能走。
     *
     * ⇒ 修法（口径定在【这一处】——"这条红算不算新增"只能有一个答案）：
     *   重跑只更新 status/exitCode/evidence；成员报的 `failures` 若在，
     *   而 rerun 没带 ⇒ **保留 claimed 的**。
     */
    if (rerun.failures === undefined && item.failures !== undefined) {
      return { ...rerun, failures: item.failures }
    }
    return rerun
  })
  for (const rerun of reruns) {
    if (!seen.has(rerun.command)) merged.push(rerun)
  }
  return merged
}
export function stateRootOf(workspace: string, config: ToolsConfig): string {
  return join(workspace, config.stateDir)
}
export function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}
export function captainLockKey(stateRoot: string, captainId: string): string {
  return `captain:${stateRoot}:${captainId}`
}
export async function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState> {
  const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id)
  if (team === undefined) {
    throw new Error('you are not leading any team yet — call agent_teams_create first')
  }
  return team
}
export async function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState> {
  const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id)
  if (team === undefined) {
    throw new Error('you do not lead or belong to any active team yet')
  }
  return team
}
export type ParticipantIdentity =
  | { kind: 'captain'; name: typeof CAPTAIN_KEY }
  | { kind: 'member'; name: string }
export function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined {
  if (team.captainSessionId === agentId) return { kind: 'captain', name: CAPTAIN_KEY }
  const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed')
  return member === undefined ? undefined : { kind: 'member', name: member.name }
}
export async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (fresh === undefined) throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}
export async function requireFreshCaptainTeam(
  stateRoot: string,
  teamId: string,
  captainId: string,
): Promise<TeamState> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  if (fresh.captainSessionId !== captainId) {
    throw new Error(`only the captain of team "${fresh.name}" may perform this operation`)
  }
  return fresh
}
export async function requireFreshParticipant(
  stateRoot: string,
  teamId: string,
  callerId: string,
): Promise<{ team: TeamState; identity: ParticipantIdentity }> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  const identity = participantIdentityOf(fresh, callerId)
  if (identity === undefined) throw new Error(`you are no longer an active participant in team "${fresh.name}"`)
  return { team: fresh, identity }
}
export function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed')
  if (member === undefined) {
    throw new Error(`no active member named "${name}" in team "${team.name}"`)
  }
  return member
}
export function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) {
    throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`)
  }
  return task
}
export function trimmedOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}
export function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}
export function taskDetails(team: TeamState, task: TeamTask): string {
  return [task.subject, task.description ?? '',
    `Kind: ${task.kind ?? 'work'}`,
    `Objective: ${task.objective ?? ''}`,
    `In scope: ${(task.inScope ?? []).join(', ')}; Out of scope: ${(task.outOfScope ?? []).join(', ')}`,
    `Acceptance: ${(task.acceptance ?? []).join('; ')}`,
    `Verify: ${(task.verify ?? []).join('; ')}`,
    `Dependency results:\n${formatDependencyOutputs(collectCompletedDependencyOutputs(team.tasks, task.id))}`,
  ].join('\n')
}
export function captainOpenTask(team: TeamState, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === CAPTAIN_KEY
    && !TERMINAL_TASK_STATUSES.includes(task.status))
}
export async function stopTeamMemberActivations(
  ctx: Context,
  captain: Agent,
  members: readonly TeamMember[],
  signal?: AbortSignal,
): Promise<void> {
  const memberIds = members.filter(member => member.id !== '').map(member => member.id as SessionId)
  if (memberIds.length === 0) return
  // Every supported exact host has targeted recursive drain. Unlike interrupt,
  // it closes admission and clears queued work before awaiting descendants.
  signal?.throwIfAborted()
  await ctx.subagents.drainContinuableChildren(captain, memberIds)
}
export const RUNTIME_GATE_LOG_LIMIT = 50
export const runtimeGateLog: Array<{ at: number; event: string; outcome: string }> = []
/**
 * ── ★★ f-0026：三态里【两维各自可读】，不合成一个布尔 ────────────────────────────
 *
 * 这两维测的**不是同一件事**（本任务硬要求：两个都要，且各自可读）：
 *
 *   `output` 维（t23 起）：盘上自本进程启动以来，有没有被 rebuild 过？  —— 「内容变没变」
 *   `commit` 维（本任务）：本进程加载的是哪个 commit 的代码？            —— 「代码落后没落后」
 *
 * ★ 合成一个布尔会让 `{output 同, 提交落后}` 这种组合**消失** —— 而那正是
 *   f-0026 的全部内容：进程启动前盘上就是当前版 ⇒ 旧读数恒报 current。
 *
 * ★ `stale` 带一个可选的 `behind` / `aheadOf`（提交），**不是**可选的措辞：
 *   只说"旧了"仍然要人去猜从哪旧起，而那个猜测正是误诊开始的时刻。
 */
export type ModuleFreshness =
  | { status: 'current'; loaded: string; onDisk: string; commit?: string; head?: string }
  | { status: 'stale'; loaded: string; onDisk: string; commit?: string; head?: string; behind?: string; why: 'content' | 'commit' | 'both' }
  | { status: 'unknown'; loaded?: string; onDisk?: string; commit?: string; head?: string; reason: string }
export const BUILD_STAMP_FILE = 'git-artifact-stamp.json'
/** stamp 里与 git 有关的那一格。★ 缺省缺席（旧 stamp）⇒ `undefined`，不是空串。 */
export interface BuildStamp {
  schema?: unknown
  output?: unknown
  commit?: unknown
}
export function readStamp(root: string): BuildStamp | undefined {
  try {
    const raw = readFileSync(join(root, 'lib', BUILD_STAMP_FILE), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return undefined
    return parsed as BuildStamp
  } catch {
    return undefined
  }
}
export function readStampOutput(root: string): string | undefined {
  const parsed = readStamp(root)
  return typeof parsed?.output === 'string' && parsed.output.trim() !== '' ? parsed.output : undefined
}
/**
 * ── ★★ 「构建时的提交」从 stamp 读；「当前 HEAD」在【调用时】读 ─────────────────────
 *
 * ★ f-0025「按取值时机区分」的可执行形式：
 *
 *     「构建时的提交」 —— **常量**。它随 stamp 落盘，进程加载后不会变 ⇒ 加载时读一次即可。
 *     「当前 HEAD」    —— **每次调用都可能变**的量 ⇒ 必须在**调用时**重新取。
 *
 * ★ 把后者也做成"加载时读一次"，它就退化成与 `output` 同一个问句 ——
 *   而"答的是另一个问题"正是 f-0026 要修的那一格。
 */
export function stampCommitOf(stamp: BuildStamp | undefined): string | undefined {
  return typeof stamp?.commit === 'string' && /^[0-9a-f]{40}$/u.test(stamp.commit.trim())
    ? stamp.commit.trim()
    : undefined
}
/**
 * 读【此刻】的 HEAD。取不到 ⇒ `undefined`（**不是**空串）。
 *
 * ★ 三种"取不到"必须都是 `undefined`，而**成因写进 reason**（由调用方区分）：
 *   不是 git 仓库 / git 不可用 / 仓库还没有任何提交（`HEAD` 未出生）。
 *   ★ 而它与"读到了但内容为空"不同形 —— 后者不是一个合法 sha，也走不到这里。
 */
export function currentHead(root: string = pluginRoot()): string | undefined {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined
  } catch {
    return undefined
  }
}
/**
 * ── ★★ 新鲜度的【全部输入】都注入进来 —— 于是它可以被夹具精确驱动 ────────────────
 *
 * ★ 这条与 `r5` / `mutation` / `backtest` 同一纪律：判据本身是纯数据变换，
 *   I/O 由调用方注入。★ 而它有一个额外好处：**"取值时机"可以被测**——
 *   同一份 `loaded` 配两个不同的 `head`，必须给出两个不同的读数（臂 15）。
 */
export interface FreshnessInput {
  /** 进程加载时读到的 stamp（常量，只读一次）。 */
  loaded?: BuildStamp
  /** 此刻盘上的 stamp。 */
  onDisk?: BuildStamp
  /** 此刻的 HEAD。★ 由调用方在**调用时**取。 */
  head?: string
  /**
   * ── ★★★ 构建时那条提交【是不是 HEAD 的祖先】────────────────────────────────
   *
   * MEASURED（2026-10-09，captain 自己踩进去的）：
   *   `commitBehind = builtCommit !== head` 用【不相等】判【落后】——
   *   而"构建时的提交是 HEAD 的祖先"也被读成了落后
   *   （实测：stamp=`49894d0` 而 HEAD=`d457d9c`，`git merge-base --is-ancestor` 为**真**，
   *    即代码没有落后，只是 stamp 没更新）。
   *
   * ★★ 而它的后果是一个【循环】：`build` 之后 `commit`（提交 lib/ 与 stamp）
   *   必然让 stamp 落后 HEAD 一格 ⇒ 那条门【每轮都会说话】。
   *
   * ⇒ ★ 所以"落后"的正确判据是【祖先关系】：
   *   · 是祖先   ⇒ 构建基于更早的提交，而它在 HEAD 的历史里 ⇒ ★ 不是"你手上的代码旧了"
   *   · 不是祖先 ⇒ 构建基于一条【不在当前线上】的提交（换分支 / rebase）⇒ 那才是
   *
   * ★ 三态：`true`（是祖先 ⇒ 不算落后）· `false`（不是祖先 ⇒ 真落后）·
   *   `undefined`（**跑不了 git ⇒ 判不了**）⇒ ★ 而判不了时【保守】：维持"落后"。
   *   —— 因为"说不清"不得读成"没事"（本队那条三态纪律）。
   */
  builtCommitIsAncestorOfHead?: boolean
}
export function moduleFreshnessFrom(input: FreshnessInput): ModuleFreshness {
  const loadedOutput = typeof input.loaded?.output === 'string' && input.loaded.output.trim() !== ''
    ? input.loaded.output
    : undefined
  const onDiskOutput = typeof input.onDisk?.output === 'string' && input.onDisk.output.trim() !== ''
    ? input.onDisk.output
    : undefined
  const builtCommit = stampCommitOf(input.loaded)
  const onDiskCommit = stampCommitOf(input.onDisk)
  const head = typeof input.head === 'string' && /^[0-9a-f]{40}$/u.test(input.head) ? input.head : undefined

  /**
   * ★★ ① 「读不到」这一格的【两个成因必须不同形】（本队记账：三态不同形）。
   *
   *   两件事都落 `unknown`，但**措辞不同**：
   *     · 盘上读不到 stamp（还没 build / 文件被删 / 解析失败）⇒ 整个读数无从谈起
   *     · 读不到 HEAD（不是 git 仓库 / 没有提交）⇒ 只缺"落后没落后"这一维
   *   ★ 把它们写成同一句，会让"stamp 没记这一格"与"这个环境没有 git"同形。
   */
  if (onDiskOutput === undefined) {
    return {
      status: 'unknown',
      ...loadedOutput === undefined ? {} : { loaded: loadedOutput },
      reason: `no build stamp at lib/${BUILD_STAMP_FILE} (not built, or removed)`,
    }
  }
  if (loadedOutput === undefined) {
    return {
      status: 'unknown',
      onDisk: onDiskOutput,
      ...onDiskCommit === undefined ? {} : { commit: onDiskCommit },
      reason: `the build stamp was unreadable when this process loaded (lib/${BUILD_STAMP_FILE}); the one on disk now is ${onDiskOutput.slice(0, 12)}…`,
    }
  }
  /**
   * ★ ② commit 维读不到 ⇒ **unknown，不是 current**。
   *   这是本任务最容易做错的一格：把"没能比对提交"并进"是新的"，
   *   就是本任务要消灭的那个合流。★ 而它**不掩盖** output 维已经测出的事实。
   */
  if (builtCommit === undefined || head === undefined) {
    const which = builtCommit === undefined
      ? `this build's stamp records no git commit, so whether the loaded code is behind HEAD could not be measured`
      : `the current HEAD could not be read (not a git repository, or no commit yet), so whether the loaded code is behind it could not be measured`
    return { status: 'unknown', loaded: loadedOutput, onDisk: onDiskOutput, ...head === undefined ? {} : { head }, reason: which }
  }
  /**
   * ★★ ③ 两维【分别判定】，然后合成 `why` —— 而不是先合成再判定。
   *
   *   content 维：进程加载的 output vs 此刻盘上的 output（"盘上被 rebuild 过吗"）
   *   commit  维：构建时的提交 vs 此刻的 HEAD（"代码落后于当前提交吗"）
   *
   * ★★★ 而 commit 维【不能】用 `!==` 判 —— 那会把"构建时的提交是 HEAD 的祖先"
   *   也读成落后（实测 2026-10-09：stamp=49894d0、HEAD=d457d9c，
   *   `git merge-base --is-ancestor` 为真，而那条门报了 stale）。
   *   ⇒ ★ 那构成一个循环：build 之后 commit 必然让 stamp 落后一格。
   *
   *   ★ 判据改成祖先关系；而 `undefined`（跑不了 git）时【保守】维持落后 ——
   *     因为"说不清"不得读成"没事"。
   */
  const contentChanged = loadedOutput !== onDiskOutput
  /**
   * ★★★ 而这一格【我试过改成祖先关系，又改回来了】（2026-10-09）——
   *   而理由是：臂 9（f-0026 核心）有一条**有据的**要求，逐字是：
   *     「stamp 没变、而 HEAD 前进了一个提交 ⇒ 必须报 stale」
   *     而它的现实依据是"有人改了 src 又改回来 / amend / 只因别的原因动了历史"。
   *
   *   ★ 而我今晚踩到的情形（`build` 之后 `commit` ⇒ stamp 落后一格）与它**同形**：
   *     两者都是"构建于 A，而 A 是 HEAD 的祖先"。⇒ ★ 所以那不是两个需求，
   *     是【同一个判据的两种希望】—— 而它需要一个【第三维】才能分开
   *     （"那两个提交之间，有没有改动到构建的输入"）。
   *
   *   ⇒ ★ 所以本次【不改判据】，而是把那条区分立成一条任务。
   *     `builtCommitIsAncestorOfHead` 这个输入保留（它已可注入、有 5 条臂），
   *     但**暂不参与** `commitBehind` —— 等那条第三维的判据落地再接。
   */
  const commitBehind = builtCommit !== head
  if (!contentChanged && !commitBehind) {
    return { status: 'current', loaded: loadedOutput, onDisk: onDiskOutput, commit: builtCommit, head }
  }
  return {
    status: 'stale',
    loaded: loadedOutput,
    onDisk: onDiskOutput,
    commit: builtCommit,
    head,
    why: contentChanged && commitBehind ? 'both' : contentChanged ? 'content' : 'commit',
    ...commitBehind ? { behind: builtCommit } : {},
  }
}
export function moduleFreshness(): ModuleFreshness {
  const head = currentHead()
  const rawCommit = readStamp(pluginRoot())?.commit
  const builtCommit = typeof rawCommit === 'string' && rawCommit.trim() !== '' ? rawCommit : undefined
  return moduleFreshnessFrom({
    loaded: loadedStamp(),
    onDisk: readStamp(pluginRoot()),
    head,
    /**
     * ★ 这里把"构建时的提交是不是 HEAD 的祖先"取出来 —— 而那正是
     *   `commitBehind` 该用的判据（见 `FreshnessInput` 的注释）。
     *   ★ 取不到（不是仓库 / 那条提交不在库里）⇒ `undefined` ⇒ 保守维持"落后"。
     */
    ...builtCommit !== undefined && head !== undefined && builtCommit !== head
      ? { builtCommitIsAncestorOfHead: isAncestorOf(builtCommit, head) }
      : {},
  })
}
/**
 * `ancestor` 是不是 `descendant` 的祖先（用 git 判，而不是用字符串比）。
 *
 * ★ 三态：`true` / `false` / `undefined`（**跑不了 git ⇒ 判不了**）。
 *   ★ 而"判不了"与"不是祖先"必须不同形 —— 前者的处置是"保守地当作落后"，
 *     后者是"真的换了线"。而调用方拿 `undefined` 时按保守处理。
 */
export function isAncestorOf(ancestor: string, descendant: string, root: string = pluginRoot()): boolean | undefined {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch (error) {
    /**
     * `git merge-base --is-ancestor` 用退出码表达答案：0 = 是，1 = 不是。
     * ⇒ ★ 所以 `1` 是【一个答案】，不是【一次失败】—— 而把它并进 `undefined`
     *   会让"不是祖先"与"判不了"同形（本队那条最贵的合流）。
     */
    const status = (error as { status?: number } | undefined)?.status
    if (status === 1) return false
    return undefined
  }
}
/** ★ 加载时读一次的整份 stamp —— 「构建时的提交」是常量，与 `output` 同一时机。 */
export let LOADED_STAMP: BuildStamp | undefined
export let LOADED_STAMP_READ = false
export function loadedStamp(): BuildStamp | undefined {
  if (!LOADED_STAMP_READ) {
    LOADED_STAMP = readStamp(pluginRoot())
    LOADED_STAMP_READ = true
  }
  return LOADED_STAMP
}
export function pluginRoot(): string {
  /**
   * ── ★★ t39：层数 2 → 4 —— 而这是一个【拆分引入的真缺陷】，实测抓出来的 ──────────
   *
   * ★ 先说清它返回什么：**项目根**（`lib/` 的父目录）。
   *   调用方 `readStampOutput(root)` 会再拼 `join(root, 'lib', BUILD_STAMP_FILE)`
   *   —— 所以这里【不能】返回 `lib/` 本身。
   *
   * MEASURED（本任务实测）：它此前住在 `lib/tools.js` ⇒ `dirname ×2` 正好是项目根 ✓
   * 而 t39 把它搬进 `lib/tools/shared/entities.js` ⇒ **深了两层**。
   *
   * ★★ 而它失败的方式值得单独记：**它不是崩溃，是退化到 `unknown`**：
   *
   *     moduleFreshness() ⇒ { status: 'unknown',
   *                           reason: 'no build stamp at lib/git-artifact-stamp.json' }
   *
   *   ⇒ 而 `unknown` 是**诚实**的读数（"我没能测量"）——
   *     于是"路径算错"伪装成了"这一格测不出来"，
   *     5 条既有的 freshness 臂从"报 stale/current"变成"报 unknown"。
   *   ★ 这正是本队反复记账的那条：**没能测量与一个缺陷同形**。
   *
   * ★ 我第一次修成 `×3`，而它仍然是错的 —— 因为 `×3` 给的是 `lib/`，
   *   再拼一次 `lib` 就成了 `lib/lib/`。⇒ **层数必须按"它要返回什么"算，
   *   而不是按"它比原来深了几层"算。**
   *
   * ⇒ 现在：`lib/tools/shared/entities.js` ⇒ ×4 = 项目根。
   *   ★ 刻意【不】改成"向上找 stamp 文件"那种自适应写法：
   *     那会让产物布局与读它的代码之间多一条隐式耦合 ——
   *     而本队为"隐式耦合在重构时断掉"已经付过学费。
   *     层数是**结构事实**：`lib/tools/shared/x.js` ⇒ 四层到项目根。
   */
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}

/**
 * ── ★★★ 卡点/判决 ⇒ 任务：把 `friction-triage` 接上【生产调用方】（t26）───────────────
 *
 * ── 它接的是什么 ───────────────────────────────────────────────────────────────
 *
 * `scripts/friction-triage.mjs` 早已能把**卡点/判决**变成一份**审查过的、分好档的**
 * 任务契约（`triage` → `runPipeline` → `emitReviewedContract` → `dispatchable` 四态）。
 * ★ 而它此前**零生产调用方**：`src/` 里对它的引用**全部在注释里**，
 *   真正 `import` 它的只有 `scripts/*.test.mjs`。
 * ⇒ 于是盘上的卡点与判决**没有任何东西**把它们变成任务 ——
 *   「机制建好了，没有接线」的第 8 个实例。
 *
 * ── ★★★ 而它为什么需要【动态 import + `pluginRoot()`】─────────────────────────────
 *
 * `scripts/` 在 `tsconfig.json` 的 `rootDir = "src"` **之外** ⇒ 静态
 * `import '../../scripts/friction-triage.mjs'` 会落 `TS2307`（实测），
 * 且 `rootDir=src` 意味着 **`lib/` 里不会有 `scripts/`**。
 *
 * ★ 而这**不构成障碍**，因为本仓【已经在这么做】了：
 *   `src/quality-gates.ts` 读基线清单时走的是
 *   `readFileSync(join(pluginRoot(), 'scripts', 'fixtures', 'baseline-known-failures.json'))`
 *   —— ★ 运行时路径，不经 `tsc` 的 `rootDir`。
 * ⇒ 本条沿用**同一种做法**（裁定 A1），而不是新开一个先例。
 *
 * ★ 类型面由 `scripts/friction-triage.d.ts`（最小声明）给出 —— 而**不是**
 *   `@ts-expect-error`：后者会让「这个模块不存在」与「这个模块存在而导出改名了」
 *   读成同一件事，而那正是本仓那条最贵纪律的同形。
 *
 * ── ★★ 边界：本条**只加调用方**，不改 `friction-triage.mjs` 的判据语义 ────────────
 *
 * 分档（`tierOf`）、五问（`adversarialReview`）、四态（`dispatchable`）都是对的。
 * 用户 §38 那条判据由**它**实现，而本条只负责把它的结论**读出来并交出去**：
 *
 *     ✓ 小档 + 审查通过 + 契约完整  ⇒ 可派（`ready`）
 *     ✗ 大档（要拆解）/ 审不过 / 契约不全
 *       ⇒ 分别进 `awaitingRuling` / `rejected` / `cannotEmit`
 *
 * ★★★ 而 `awaitingRuling` 的**长度本身是一条读数**（用户 §38：
 *   「需要人拍板是**缺陷指标**，不是交付方式」）⇒ 它长了说明"能自己解决的事太少"，
 *   而那正是要消灭的那个指标。⇒ 所以下面把四个数字**分别**交出去，**不合并成一个**。
 */
export interface ExperienceDispatchReadout {
  /** ★ 四态的**各自条数**（不合并 —— 合并会抹掉"为什么没进 ready"）。 */
  readonly ready: number
  readonly awaitingRuling: number
  readonly rejected: number
  readonly cannotEmit: number
  /** 拆解那一栏（每条大活拆成了几条、各去哪）。 */
  readonly decomposed: number
  /** ★ 「为什么没进 ready」的分栏（主干的 stage → 那一栏的名字，只有一处映射）。 */
  readonly notReadyBecause: Record<string, number>
  /** ★ `ready` 里那些提案的**完整契约**（调用方拿它去建任务）。 */
  readonly contracts: readonly ExperienceDispatchCandidate[]
}

/** 一条**可派**的提案：它带着完整契约与来源。 */
export interface ExperienceDispatchCandidate {
  readonly sourceId?: string
  readonly tier?: string
  /** ★ 审查过的契约 —— `ready` 池里只可能是 `emitReviewedContract` 给的。 */
  readonly contract: Record<string, unknown>
}

/**
 * ── ★★ 三态（而它们**不同形**）──────────────────────────────────────────────────
 *
 *   `ok`          读到了卡点/判决（`unreadable` 为空）
 *   `partial`     ★ **有一侧读不到**（附是哪一侧）—— 而它**不是** `ok`
 *   `unmeasured`  ★ 整个 `friction-triage` 引不进来（模块不在 / 导出改名）
 *
 * ★★★ 而 `unreadable` 那格**绝不许**被读成"没有待派的"：
 *   「我没能读」与「我看了，确实没有」**不同形** —— 后者是"确实为空"，
 *   前者是"我根本不知道有多少"。合并它们会让"卡点目录写错了"伪装成"一切都好"。
 */
export type ExperienceDispatchState = 'ok' | 'partial' | 'unmeasured'

export interface ExperienceDispatchResult {
  readonly state: ExperienceDispatchState
  /** ★ 读不到的那几侧（空数组 = 都读到了）。 */
  readonly unreadable: readonly string[]
  /** 判据层给出的四态读数（`unmeasured` 时为 `undefined` —— 它没算出来）。 */
  readonly readout?: ExperienceDispatchReadout
  /** `unmeasured` 时说明**为什么**（模块不在 / 导出对不上）。 */
  readonly why?: string
}

/**
 * 走一遍「卡点/判决 ⇒ 任务」：调 `friction-triage` 的 `triage` + `dispatchable`。
 *
 * @param options.frictionsDir 卡点目录（**由调用方注入** —— 判据层不猜路径）
 * @param options.judgementsDir 判决目录
 * @param options.occupied 已被占用的写域（避免派到别人的文件上）
 * @param options.loadModule ★ 注入点：默认走 `pluginRoot()` 动态 import；
 *   夹具可以换掉它（**而它只换装载，不换判据**）。
 */
export async function readExperienceDispatch(options: {
  readonly frictionsDir?: string
  readonly judgementsDir?: string
  readonly occupied?: readonly unknown[]
  readonly loadModule?: () => Promise<FrictionTriageModule>
} = {}): Promise<ExperienceDispatchResult> {
  const load = options.loadModule ?? loadFrictionTriageModule
  let module: FrictionTriageModule
  try {
    module = await load()
  } catch (error) {
    /**
     * ★★ 模块引不进来 ⇒ `unmeasured`（**不是**"没有待派的"）。
     *   ★ 而它必须说清是**哪一步**不行：模块不在盘上 / 导出对不上，两者的补救不同。
     */
    return {
      state: 'unmeasured',
      unreadable: [],
      why: `the friction triage module could not be loaded: ${String((error as Error | undefined)?.message)}`,
    }
  }
  if (typeof module.triage !== 'function' || typeof module.dispatchable !== 'function') {
    return {
      state: 'unmeasured',
      unreadable: [],
      why: 'the friction triage module loaded but no longer exports `triage`/`dispatchable` '
        + `(saw: ${typeof module.triage}/${typeof module.dispatchable}) — the shape moved, so this reading means nothing`,
    }
  }

  const report = module.triage({
    ...options.frictionsDir === undefined ? {} : { frictionsDir: options.frictionsDir },
    ...options.judgementsDir === undefined ? {} : { judgementsDir: options.judgementsDir },
    ...options.occupied === undefined ? {} : { occupied: options.occupied },
  })
  const unreadable = [...(report.unreadable ?? [])]
  const dispatchable = module.dispatchable(report)

  const contracts: ExperienceDispatchCandidate[] = []
  for (const entry of dispatchable.ready) {
    const contract = entry.contract
    /**
     * ★ 没有契约的 `ready` 条目不进 `contracts` —— 而它**仍计入 `ready` 的条数**（如实）。
     *   ★ 两者不同形：`ready` 说"判据说它可以派"，`contracts` 说"我拿到了要建的那份契约"。
     *     一个 `ready` 而拿不到契约 ⇒ 那是**上游的一处缺口**，而它必须在读数里可见
     *     （把两者合成一个数字会让那种情况彻底消失）。
     */
    if (contract !== undefined && typeof contract === 'object') {
      contracts.push({
        ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
        ...(entry.tier?.tier === undefined ? {} : { tier: entry.tier.tier }),
        contract,
      })
    }
  }

  return {
    /** ★ 有一侧读不到 ⇒ `partial`（**不是** `ok`）—— 那正是"没能读"与"确实没有"分界的地方。 */
    state: unreadable.length === 0 ? 'ok' : 'partial',
    unreadable,
    readout: {
      ready: dispatchable.ready.length,
      awaitingRuling: dispatchable.awaitingRuling.length,
      rejected: dispatchable.rejected.length,
      cannotEmit: dispatchable.cannotEmit.length,
      decomposed: dispatchable.decomposed.length,
      notReadyBecause: dispatchable.notReadyBecause ?? {},
      contracts,
    },
  }
}

/** `scripts/friction-triage.mjs` 里**本调用方真正用到**的那两格（见 `scripts/friction-triage.d.ts`）。 */
interface FrictionTriageModule {
  readonly triage?: (options?: Record<string, unknown>) => {
    readonly unreadable?: readonly string[]
    readonly [key: string]: unknown
  }
  readonly dispatchable?: (report: unknown, options?: Record<string, unknown>) => {
    readonly ready: readonly {
      readonly sourceId?: string
      readonly tier?: { readonly tier?: string }
      /** ★ 契约**直接挂在条目上**（实测形状）—— 不是嵌在 `emitted` 里。 */
      readonly contract?: Record<string, unknown>
    }[]
    readonly awaitingRuling: readonly unknown[]
    readonly rejected: readonly unknown[]
    readonly cannotEmit: readonly unknown[]
    readonly decomposed: readonly unknown[]
    readonly notReadyBecause?: Record<string, number>
  }
}

/**
 * ★ 默认装载：**动态 import + `pluginRoot()` 的运行时路径**（与 `quality-gates.ts` 读
 *   基线清单同一种做法）。静态 `import '../../scripts/…'` 会破 `tsc` 的 `rootDir`。
 */
async function loadFrictionTriageModule(): Promise<FrictionTriageModule> {
  const target = pathToFileURL(join(pluginRoot(), 'scripts', 'friction-triage.mjs')).href
  return await import(/* @vite-ignore */ target) as FrictionTriageModule
}
export function moduleFreshnessMessage(freshness: ModuleFreshness = moduleFreshness()): string {
  if (freshness.status === 'current') return 'this process holds the current build'
  if (freshness.status === 'stale') {
    /**
     * ★★ 措辞按【是哪一维】分，因为两维的补救**动作不同**（f-0026）：
     *
     *     content 维旧 ⇒ 盘上被 rebuild 过 ⇒ 重载即可拿到新的
     *     commit  维旧 ⇒ 加载的代码落后于当前提交 ⇒ **重载之后才谈得上"用哪一版"**；
     *                  而它此前恒报 current，所以这一句从前**从来没人看到过**
     *
     * ★ 两维都旧时说清两件事，不说成一句笼统的"旧了"——
     *   笼统措辞会让读的人以为是其中一个原因，而修掉一个另一个还在。
     */
    const detail = freshness.why === 'commit'
      ? `this process loaded code built at ${String(freshness.commit).slice(0, 12)}…, but HEAD is now ${String(freshness.head).slice(0, 12)}…`
      : freshness.why === 'content'
        ? `loaded ${freshness.loaded.slice(0, 12)}…, on disk ${freshness.onDisk.slice(0, 12)}…`
        : `loaded ${freshness.loaded.slice(0, 12)}…, on disk ${freshness.onDisk.slice(0, 12)}…, and built at ${String(freshness.commit).slice(0, 12)}… while HEAD is ${String(freshness.head).slice(0, 12)}…`
    /**
     * ★★★ 措辞的落点（t5 实测后 captain 采纳 `verifier` 的建议）：
     *
     *   此前这句是「…reload the plugin before trusting any judgement it makes」——
     *   **读起来像一条提醒**（"你手上的东西旧了"），而它没说出【要紧在哪】。
     *
     *   ★ 而 t5 实测出的形态是：陈旧构建会把【一条已经关掉的缺陷重新打开】——
     *     进程持有的 `ba32130` 仍在按 `attempt` 判别，而 HEAD 已改成按 `kind`（t20 修的）
     *     ⇒ 那条任务**两个终态都被拒**（completed 与 failed 走同一条判据）
     *     ⇒ ★ 而成员【连如实交失败都做不到】。
     *
     *   ⇒ 所以这句必须说出三件事：① 它旧掉的是哪一版 ② 它能让【两个方向】都被拒
     *     ③ 而正确的动作是【停下并报】，不是重试、不是改交付物、不是伪造一格。
     */
    /**
     * ★★ 而措辞里有两处【早先的臂就要求过的】字样，不能丢（实测 2026-10-09）：
     *   · `OLDER than the one on disk` —— 臂 10 钉它（那一态必须【明说自己旧】）
     *   · `reload the plugin`         —— 同上（必须【指向动作】）
     *   ⇒ ★ 我第一版改写把后者去掉了（换成了 "restart the host"），于是臂 10 红。
     *     而那正是"改一条消息时，要核【谁在读它】"的那一格。
     */
    return `this process is running an OLDER build than the one on disk (${detail}) `
      + '— a stale build does not merely warn: it can re-open a defect that is already fixed, '
      + 'and it blocks BOTH terminal states (a refusal here may be that old defect, not your work). '
      + 'Do not retry, do not alter the deliverable, and do not fabricate a field: stop and report. '
      + 'The fix is to reload the plugin (build, then restart the host).'
  }
  return `whether this process holds an old build could NOT be determined (${freshness.reason}) — that is "not measured", not "up to date"`
}
export function freshnessLine(): string {
  return `[deployment] ${moduleFreshnessMessage()}`
}
export type RestartArbitration =
  /** 两个前置都满足 ⇒ 可以重载。 */
  | { allowed: true; reason: 'verdict-passed-and-no-work-in-flight' }
  /** 判决未通过（或被声明为未通过）⇒ 新代码对不对没有结论，不许换。 */
  | { allowed: false; blockedBy: 'no-passing-verdict'; detail: string }
  /** 有工作在跑 ⇒ 重载会打断它。 */
  | { allowed: false; blockedBy: 'work-in-flight'; detail: string; inFlight: string[] }
export function arbitrateRestart(input: {
  /** ★ 前置一：一份**已经通过**的判决。`false` / 缺席都表示"没有可用的结论"。 */
  verdictPassed: boolean
  /** ★ 前置二：当前全部任务（只读它们的 `status` 与 `id`）。 */
  tasks: ReadonlyArray<{ id: string; status: string }>
}): RestartArbitration {
  /**
   * ★ 顺序是刻意的：**先问判决**。
   *   理由：判决不过时，"有没有工作在跑"是一个**与结论无关**的问题 ——
   *   而先问它会让措辞变成"有工作在进行"，把真正的原因（判决没过）盖住。
   *   ⇒ 读者会去等工作结束，而该做的是回去改代码。
   */
  if (input.verdictPassed !== true) {
    return {
      allowed: false,
      blockedBy: 'no-passing-verdict',
      detail: 'a restart swaps the code every subsequent call runs on, so it needs a PASSING verdict first; '
        + 'run the full verification (pnpm verify) and hand its result in — this gate deliberately does not re-run it',
    }
  }
  const inFlight = input.tasks.filter((task) => task.status === 'in_progress').map((task) => task.id)
  if (inFlight.length > 0) {
    return {
      allowed: false,
      blockedBy: 'work-in-flight',
      detail: `${inFlight.length} task(s) are in progress; a restart would dispose the plugin while they are running `
        + '(their records would be left in a state nothing is maintaining)',
      inFlight,
    }
  }
  return { allowed: true, reason: 'verdict-passed-and-no-work-in-flight' }
}
export function restartArbitrationMessage(arbitration: RestartArbitration): string {
  if (arbitration.allowed) return 'the gate is open: a passing verdict exists and no task is in progress'
  if (arbitration.blockedBy === 'no-passing-verdict') {
    return `restart refused: there is no passing verdict to arbiter on. ${arbitration.detail}`
  }
  return `restart refused: work is in flight (${arbitration.inFlight.join(', ')}). ${arbitration.detail}`
}
export const RESTART_ESCAPE_HATCH_ENV = 'AGENT_TEAMS_RESTART_ESCAPE_HATCH'
export function restartEscapeHatchFromEnv(value: string | undefined): boolean {
  return value === '1'
}
export function arbitrateRestartWithEscape(
  input: Parameters<typeof arbitrateRestart>[0],
  escapeHatchOpen: boolean,
): RestartArbitration | { allowed: true; reason: 'escape-hatch'; bypassed: string } {
  const arbitration = arbitrateRestart(input)
  if (arbitration.allowed) return arbitration
  if (!escapeHatchOpen) return arbitration
  /**
   * ★ 逃生口**只对"有工作在跑"这一条有效**，对"没有通过的判决"**无效** ——
   *   因为后者是"新代码对不对没有结论"，而逃生口的理由是"链冻住了"，
   *   不是"我们不知道新代码行不行"。让它可以绕过判决，就等于把蓝绿判决作废。
   */
  if (arbitration.blockedBy === 'no-passing-verdict') return arbitration
  return { allowed: true, reason: 'escape-hatch', bypassed: arbitration.blockedBy }
}
export function judgeRuntimeGates(event: string, outcome: string): void {
  runtimeGateLog.push({ at: Date.now(), event, outcome })
  if (runtimeGateLog.length > RUNTIME_GATE_LOG_LIMIT) runtimeGateLog.splice(0, runtimeGateLog.length - RUNTIME_GATE_LOG_LIMIT)
}
export const WAIT_RECORD_LIMIT = 200
export interface WaitRecord {
  readonly teamId: string
  readonly taskId: string
  readonly memberName: string
  readonly attemptId: string
  /**
   * ── ★ V3-2：等待窗口的起点，**跨代继承** ────────────────────────────────────
   *
   * MEASURED（2026-10-06，verifier3 / t3）：`agent_teams_status` 每次都会 `kickTeam`，
   * 而 kick 会给一个非 `working` 的成员 `beginTaskAttempt` **换新一代 capability**。
   * 于是每次探活看到的都是一个**刚出生**的等待：`startedAt = 现在`、
   * `previousPollAt` 缺席 ⇒ 「两次探活之间它动过没有」这个前提**在真实路径上不成立**，
   * 探活退化成"每次都报第一次"。实测三次探活，记录从 1 条变 2 条、`startedAt`
   * 从 1600000 跳到 2200000。
   *
   * ⇒ 修法：`startedAt`（**窗口起点**）由"这个任务的等待从哪里开始"决定，
   *   而不是由"这一代 attempt 什么时候被创建"决定。换代时**继承上一代的起点**，
   *   于是窗口跨代连续，"两次探活之间"重新有意义。
   *
   * ★ 与"键用 attemptId"的关系（两者不矛盾，分工不同）：
   *   · **键**仍然是 `attemptId`（capability 是身份，换代就是另一次尝试）；
   *   · **窗口起点**是任务的属性，跨代继承。
   *   把键换成 taskId 才是错的（reassign 之后旧起点会留在原地），
   *   而把【起点】随换代重置同样错 —— 两个方向都会让读数不属于它声称的那段等待。
   *
   * ★ 继承是**有界**的：只在同一 (teamId, taskId) 上继承，且只在上一代记录仍在
   *   表里时继承（LRU 淘汰之后退回本代派发时刻 —— 那时"窗口从哪开始"确实无据可依，
   *   而这比编一个起点诚实）。
   */
  readonly startedAt: number
  /**
   * ── ★ 最近一次【观察到产出】的时刻 ─────────────────────────────────────────
   *
   * `undefined` 表示**还没有观察到任何产出**，它必须在形状上与"观察到了一次产出"
   * 不同 —— 判据据此分辨"这个成员一直在动"与"这个成员压根没动过"。
   *
   * ★★ 为什么不能从会话事件里读：**会话事件没有时间戳**。
   *
   * MEASURED（2026-10-06，与本队开工前实测一致）：`dsh-session` 的
   * `assistant/message` 事件只有 `message.content`，**没有 `at` / `ts`**。
   * 所以"最后活动时刻"**不是读出来的，是记下来的** —— 在【观察到产出的那一刻】
   * 由我方取一次时钟。这正是契约 §5 那句"runtime 可以带状态"。
   *
   * ⇒ 它的含义精确地是："**我们最后一次看见它说话**是在什么时候"。
   *   这与"它最后一次说话是什么时候"不同形，而后者在本 Harness 版本上**不可得**。
   *   判据与日志都必须按前者理解（措辞上的区别在这里是**语义**，不是文风）。
   */
  lastActivityAt?: number
  /** 上一次探活（求值）的时刻。缺席 ⇒ 这是第一次探活。 */
  lastPollAt?: number
  /**
   * ── ★ 上一次探活【读到的】活动时刻（V3-3 的输入面）─────────────────────────────
   *
   * 与 `lastActivityAt` 不同形，且**两个都要**：
   *   · `lastActivityAt`         —— 我们至今观察到的最新一次产出（**至今**）
   *   · `lastPolledActivityAt`   —— **上一次探活那一刻**看到的那个值（**快照**）
   *
   * 判据问的是"这两次探活之间它动过没有"，所以它要的是**两个快照**，
   * 而不是"最新值"与"某个别的值"。把两者合成一个字段，会让"上一次探活之后
   * 它才动过"这件事**无法表达** —— 而那恰好是"还在跑"与"卡死"的唯一分界。
   */
  lastPolledActivityAt?: number
  /**
   * ── ★ 已经**观察到**的那次产出的指纹（见 `sessionOutputKey`）───────────────
   *
   * ★ 它不是诊断字段，而是判据能不能工作的**前提**：成员会话里的
   *   `assistant/message` 是**历史日志**，会一直留在那里。没有这一位，
   *   每次探活都会"看见输出"⇒ 刷新 `lastActivityAt` ⇒ 一个卡死的成员
   *   看起来永远刚动过 ⇒ **这条判据永远不报警**。
   */
  lastOutputKey?: string
  /** 已经观察到的产出次数（诊断用；判据不用它判"第一次"，见下）。 */
  activityCount: number
}
export const waitRecords = new Map<string, WaitRecord>()
export const PROBE_EVENTS = Object.freeze(['task-status', 'runtime-liveness'])
export const waitWindows = new Map<string, WaitWindow>()
export const WAIT_WINDOW_LIMIT = 200
export interface WaitWindow {
  readonly teamId: string
  readonly taskId: string
  readonly memberName: string
  /** 这一次等待从何时开始（ms epoch）。★ 换代的语义是"这一轮重来"，但探活问的是"它还活着吗"—— 后者跨代成立。 */
  startedAt: number
  /** 上一次探活的时刻（窗口作用域，不属于任何一代 attempt）。 */
  lastPollAt?: number
  /** 上一次探活读到的活动时刻（窗口作用域）。 */
  lastPolledActivityAt?: number
  /** 最近一次被**任何**探活碰过的时刻（`lastPollAt` 的同义词，但即使还没探过也有值：建窗口那一刻）。 */
  touchedAt: number
  /**
   * ── ★ 这个窗口认的是第几代尝试（"连续 vs 重来"的判别面）─────────────────────
   *
   * MEASURED（2026-10-06，两种合法需求打起来的那一格）：
   *   · t5 的臂 5：**重派发**（任务回 pending、换 attempt）必须开一个**新窗口** ——
   *     否则一个刚开工的成员会被读成"等了 30 分钟"；
   *   · t3 的 V3-2：**换代**（status ⇒ kickTeam 给闲成员换 capability）必须
   *     **继承**窗口 —— 否则探活永远在"第一次"，静默成员永不报警。
   * 两者都对，区别只在"任务是不是真的重来了"。
   *
   * ⇒ 判别面用 `attempt` 计数：`beginTaskAttempt` 每次都会 `attempt += 1`，
   *   **重来一定跳号**；而 kickTeam 给已在等待的成员补一次派发时，那一代数与
   *   窗口记的相同 ⇒ 判为**连续**，继承窗口。
   *   两个方向都在夹具里各有一条臂（clock-dev 的臂 5 / 本文件的 V3-2 臂）。
   */
  attempt: number
}
export function waitWindowKey(teamId: string, taskId: string, memberName: string): string {
  return `${teamId}\u0000${taskId}\u0000${memberName}`
}
export function putWaitWindow(key: string, window: WaitWindow): void {
  waitWindows.delete(key)
  waitWindows.set(key, window)
  while (waitWindows.size > WAIT_WINDOW_LIMIT) {
    const oldest = waitWindows.keys().next().value
    if (oldest === undefined) break
    waitWindows.delete(oldest)
  }
}
export function forgetWaitWindow(teamId: string, taskId: string): void {
  for (const key of [...waitWindows.keys()]) {
    const window = waitWindows.get(key)
    if (window === undefined) continue
    if (window.teamId === teamId && window.taskId === taskId) waitWindows.delete(key)
  }
}
export function putWaitRecord(record: WaitRecord): void {
  waitRecords.delete(record.attemptId)
  waitRecords.set(record.attemptId, record)
  while (waitRecords.size > WAIT_RECORD_LIMIT) {
    const oldest = waitRecords.keys().next()
    if (oldest.done === true) break
    waitRecords.delete(oldest.value)
  }
}
export function observeMemberActivity(ctx: Context, memberId: string, attemptId: string | undefined, now: number): boolean {
  if (attemptId === undefined || memberId === '') return false
  const record = waitRecords.get(attemptId)
  if (record === undefined) return false
  const live = ctx.agents.get(memberId as SessionId)
  if (live === undefined) return false
  const key = sessionOutputKey(live.session)
  if (key === undefined) return false
  /**
   * ★ 指纹没变 ⇒ 这是**已经看过的那条输出**，不是新的活动。
   *
   *   这一支是"卡死能被发现"的唯一保证：不写时刻、也不改指纹。
   *   把它写成"看到了就刷新"，会让这条判据在最需要它的时候（成员彻底不动了）
   *   表现成"一切正常"。
   */
  if (record.lastOutputKey !== undefined && record.lastOutputKey === key) return false
  /**
   * ★ 时刻单调：一次观察不得把 `lastActivityAt` **往回拨**。
   *
   * 注入的时钟是可被夹具驱动的一个函数，而**观察的顺序与实际发生的顺序可以不一致**
   * （例如成员先产出、随后一个更早开始的探活才跑到）。允许回拨，等于允许"最后活动
   * 时刻"变成"随机某一个活动时刻"，而探活判据的全部推理都建在它的**单调性**上。
   */
  if (record.lastActivityAt !== undefined && record.lastActivityAt > now) return true
  putWaitRecord({ ...record, lastActivityAt: now, lastOutputKey: key, activityCount: record.activityCount + 1 })
  return true
}
export function sessionOutputKey(session: unknown): string | undefined {
  if (session === null || typeof session !== 'object') return undefined
  let events: readonly unknown[]
  try {
    events = sessionOwnEvents(session as never) as readonly unknown[]
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  let messages = 0
  let text = 0
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if ((event as { type?: unknown }).type !== 'assistant/message') continue
    const content = (event as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    const hasText = content.some((block) => (
      block !== null && typeof block === 'object'
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
      && (block as { text: string }).text.trim() !== ''
    ))
    if (!hasText) continue
    messages += 1
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      const value = (block as { text?: unknown }).text
      if (typeof value === 'string') text += value.length
    }
  }
  /**
   * ★ 一条非空输出都没有 ⇒ `undefined`（＝**没能观察**），而**不是** `'0:0'`。
   *   后者看起来是"观察到零条"，而"它还没说过话"与"它说了个空"是两件事
   *   （本文件在 `observedSpoke` 那里已经为这条分界写过一段说明）。
   */
  if (messages === 0) return undefined
  return `${messages}:${text}`
}
export function teamWaitObservations(
  team: TeamState,
  now: number,
  event: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const task of team.tasks) {
    /**
     * ★ 有界继承的**语义边界**（队长本轮点出的风险：*"否则上一代已经结束的等待
     *   会被当成还在跑"*）：任务进入终态那一刻，它的等待窗口立刻撤销。
     *   时间上的界（`WAIT_WINDOW_STALE_MS`）只能挡住被遗忘的窗口，
     *   挡不住"任务已经 completed 而窗口还新鲜" ⇒ 这一条是必须的。
     */
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      forgetWaitWindow(team.id, task.id)
      continue
    }
    if (task.assignee === undefined || task.assignee === CAPTAIN_KEY) continue
    const observation = waitObservationFor(team.id, task.id, task.attemptId, now, task.assignee, event)
    if (observation !== undefined) out.push(observation)
  }
  return out
}
export function waitObservationFor(
  teamId: string,
  taskId: string,
  attemptId: string | undefined,
  now: number,
  memberName: string | undefined,
  /**
   * ★ 这一次求值是不是**一次探活**（见 {@link PROBE_EVENTS}）。
   *   它决定窗口的探活戳要不要在这一次交接里推进 —— 换代不是探活。
   */
  event: string,
): Record<string, unknown> | undefined {
  if (attemptId === undefined) return undefined
  const record = waitRecords.get(attemptId)
  /**
   * ★ teamId / taskId 必须对得上：`attemptId` 是 capability，理论上唯一，但一条
   *   记录被 LRU 淘汰之后**同一个键可以指向另一次派发**。这里核对其余两个身份，
   *   于是"读了别人的等待"在形状上不可能发生。
   */
  if (record === undefined || record.teamId !== teamId || record.taskId !== taskId) return undefined
  /**
   * ── ★ V3-2 收口：窗口（per-task）是探活戳的权威来源，记录（per-attempt）只补读数 ──
   *
   * `startedAt` / `previousPollAt` / `previousLastActivityAt` 三个**跨代概念**
   * 一律从窗口簿读；`lastActivityAt` 这种"这一代读到过什么"从记录读。
   * 两者分开之后，"换代"不再需要从记录表里推断探活戳 —— 那正是我前三种写法
   * 反复失败的根因。
   */
  const windowKey = waitWindowKey(record.teamId, record.taskId, record.memberName)
  const window = waitWindows.get(windowKey)
  const observation: Record<string, unknown> = {
    taskId,
    memberName: record.memberName,
    attemptId,
    startedAt: window?.startedAt ?? record.startedAt,
    /** ★ 本次求值的时钟读数 —— 判据**绝不**自己读 `Date.now()`（契约 §2 性质 1）。 */
    now,
    ...record.lastActivityAt === undefined ? {} : { lastActivityAt: record.lastActivityAt },
    /**
     * ★ `previousPollAt` 取自**窗口**：它说的是"这一个任务这一次等待上一次被探活
     *   是何时"，与"这一代 attempt 是什么时候被创建的"无关。换代不重置它。
     */
    ...window?.lastPollAt === undefined ? {} : { previousPollAt: window.lastPollAt },
    /**
     * ── ★ V3-3 / V3-1 的另一半：上一次探活**读到的**活动时刻 ──────────────────
     *
     * MEASURED（2026-10-06，verifier3 / t3）：这个字段**从来没有被交出去过** ——
     * `WaitRecord` 里根本没有存它。于是判据的"卡死"那一条**永远算不出来**：
     * 它拿到 `previousPollAt`（知道"这不是第一次探活"），却拿不到"上一次它读到
     * 的活动时刻是哪个"，于是只能报 `unmeasured`
     * （"this is the second liveness probe … the last activity reading of the
     * previous probe is missing"）。
     *
     * ⇒ 这正是本队那个形态的又一次出现：**判据接进来了，而它需要的输入没接。**
     *   判据那侧写得没错 —— 它按契约拒绝了"没法比较"的那一格。
     *
     * ★ 时序：**先**把本次读到的东西放进观察，**再**推进 `lastPollAt` 与
     *   `lastPolledActivityAt`。反过来的话，第一次探活就会把"这一次的读数"
     *   冒充成"上一次的读数"，于是两次探活永远相等 ⇒ **每一次探活都报卡死**
     *   （假警报，而且是 100% 命中的那种）。
     */
    ...window?.lastPolledActivityAt === undefined ? {} : { previousLastActivityAt: window.lastPolledActivityAt },
  }
  /**
   * ★ 交接之后才推进 `lastPollAt`（而不是读之前）：两次读之间若发生异常，
   *   "上一次探活"必须仍然是**真的发生过**的那一次。
   *
   * ★ `lastPolledActivityAt` 记的是**这一次探活读到的活动时刻**（可能就是
   *   `undefined`：那一刻还没观察到产出）。它下一次会作为 `previousLastActivityAt`
   *   交出去，而判据拿它做两端比较 —— 那正是"这两次之间它动过没有"的全部依据。
   *
   * ── ★ V3-2 的最后一环：探活戳必须能【跨代延续】，且【刚出生】的那一代不许被戳 ──
   *
   * MEASURED（2026-10-06，继承 `startedAt` 与读数之后仍然不报警）：
   * `agent_teams_status` 在**同一次调用**里先派发、后求值。换代产生的新记录紧接着
   * 被这一次求值戳上 `lastPollAt = now` ⇒ 下一次探活读到 `previousPollAt === 自己
   * 的 now` ⇒ `observed_span_ms = 0` ⇒ 间隔永远"没走完" ⇒ **探活永远不报警**。
   * 而若改成"第一次交接一律不写戳"，换代又会让**每一代**都是第一次 ⇒ 同样不报警。
   *
   * ⇒ 正确的不变量是：**戳属于【这一次等待】，不属于某一代 attempt。**
   *   换代时它随 `startedAt` 一起被继承（见 `recordDispatchStart`），
   *   于是新一代一出生就带着"上一次探活发生在 T"这个真实读数；
   *   而**只有真的被交接过的**记录才会把戳推进到 `now`。
   *
   * ★ 三条互斥的情形，各自的行为都要能断言：
   *   · 记录带着继承来的戳 ⇒ 推进到 `now`（这一次比较真的发生了）；
   *   · 记录带着自己的旧戳   ⇒ 推进到 `now`（同上）；
   *   · 记录**没有**戳（首次交接）⇒ 不写 ⇒ 下一次它仍报"第一次探活"
   *     （判据报"没有可比对象"是**诚实**的，比一个"就是此刻"的假戳好得多）。
   */
  /**
   * ★★ V3-2 收口：**刚在一次调用里出生的记录，不由这一次调用写探活戳**。
   *
   * MEASURED（2026-10-06）：`agent_teams_status` 的同一次调用里，kickTeam 先换代、
   * 求值后发生。换代产生的新记录被**同一次**求值戳上 `lastPollAt = now` ⇒ 下一次
   * 探活读到 `previousPollAt === 自己的 now` ⇒ `observed_span_ms = 0` ⇒ 那一次
   * 探活**不比**（报 `ok`），报警整整迟到一次探活。
   *
   * ⇒ 规则：**戳属于"这一次等待"，而一次等待的第一次交接不算"上一次探活"。**
   *   新一代继承上一代的戳（见 `recordDispatchStart`），于是它一出生就带着
   *   "上一次探活发生在 T"；而**这一次**调用对它只做交接、不推进戳 ——
   *   因为这个戳说的是"上一代被探活的时刻"，不是"现在"。
   *
   * ★ 与"第一次探活"不同形：真·第一次交接时 `lastPollAt` 本来就缺席，
   *   判据报"没有可比对象"（诚实）；而这里传承的是**真实发生过的那一次探活**。
   */
  /**
   * ★ 探活戳推进在**窗口**上（跨代的那一份），记录上的那份只是镜像、供诊断。
   *   于是"这一次探活"与"上一代 attempt"彻底解耦 —— 换代不再可能把戳重置。
   */
  if (window !== undefined) {
    /**
     * ★★ 关键一位：刚认领的窗口**这一次不算"上一次探活"**。
     *
     * MEASURED：`status` 在同一次调用里先 kickTeam（认领窗口）再求值（探活）。
     * 若这一次就把 `lastPollAt` 写成 `now`，那么下一次探活读到的
     * `previousPollAt === 自己的 now` ⇒ `observed_span = 0` ⇒ 那一次不比
     * ⇒ 报警迟到一次探活。
     *
     * ⇒ 规则：**窗口的第一次交接是"开工"，不是"探活"。** 认领时只在
     *   `lastPollAt` 仍缺席的情况下**保持缺席**（`touchedAt` 照常续命，
     *   那是"窗口还活着"的证据，与"上次何时探活"不同形）。
     *   于是：认领之后的第一探报"第一次探活"（诚实），第二探开始才真的比较。
     */
    /**
     * ★★ 只有**探活事件**才推进窗口的探活戳 ─────────────────────────────────────
     *
     * MEASURED（2026-10-06，把窗口做成一等对象之后的一次实测，逐次调用读出来的）：
     * ```
     * status#2 的两次求值：member-dispatched ⇒ prevPoll=1600000  ← 对
     *                      task-status       ⇒ prevPoll=2200000  ← 错：被上一次求值吃掉了
     * ```
     * ⇒ `member-dispatched`（换代那一刻）**不**是一次探活，而它在那次调用里**先**
     *   跑；若它推进了戳，紧接着的 `task-status` 就只能读到"刚刚"，span=0，
     *   **判据那一次不比较** ⇒ 报警迟到一次探活。
     *
     * ⇒ 规则：**戳只由"问了一句'还活着吗'"的那次求值推进。** 换代不是探活，
     *   `task-created` / `task-update` 也不是。哪些事件算，由**导出白名单**
     *   决定（与判据侧的 `LIVENESS_EVENTS` 同一份成员），判据层与调用方不会再各说各话。
     */
    /**
     * ★ 探活事件**总是**推进窗口的探活戳。
     *
     * MEASURED（2026-10-06，最后一位）：我在这里加过一条"第一次交接不算探活"的
     * 守卫，结果是窗口永远拿不到 `lastPollAt` 的基线 —— status#1 只写下了
     * `lastPolledActivityAt`，于是 status#2 读到的 `previousPollAt` 缺席
     * ⇒ 判据把它读成"第一次探活"⇒ **比对根本不发生**。
     *
     * ⇒ 正确的不变量只有两条，各自都在别处钉住：
     *   ① **换代不推进戳**（`isProbe` 过滤掉 `member-dispatched` 等）；
     *   ② **认领时不覆盖戳**（`recordDispatchStart` 从 `existing` 继承，
     *      而不是从 `now` 新建）。
     *   有了 ②，这里就**必须**老老实实每次都推进 —— 否则基线永远不存在。
     */
    const isProbe = PROBE_EVENTS.includes(event)
    /**
     * ── ★★ 读到的读数取【换代前那一代】的，不是这一代的 ─────────────────────────
     *
     * MEASURED（2026-10-06，最后一位）：换代在同一次调用里生成一条**新记录**，
     * 它的 `lastActivityAt` 是"派发那一刻观察到的"（很可能就是 `now`）。
     * 若把这一代的值写进 `lastPolledActivityAt`，下一次探活读到的
     * `previousLastActivityAt` 就变成"上次也是刚动过" ⇒ **比较永远相等**
     * ⇒ 静默成员永不报警（或只在第三次才报，取决于换代次数）。
     *
     * ⇒ 探活要交出去的"上一次它读到什么"，只能是**这一次探活真正读到的那个值** ——
     *   而"这一次读到的"在换代口径下就是**新记录的 `lastActivityAt`**，
     *   它恰恰是"我们最后一次看见它说话"（不论哪一代记的）。
     *   所以这里取的是 `record.lastActivityAt`，但**判据那一侧**必须拿它跟
     *   `previousLastActivityAt` 比 —— 而后者记的是**上一次探活时的同一个量**。
     *   两者是同一口径，比较才成立。
     */
    putWaitWindow(windowKey, {
      ...window,
      ...isProbe ? { lastPollAt: now } : {},
      touchedAt: isProbe ? now : window.touchedAt,
      ...isProbe && record.lastActivityAt !== undefined ? { lastPolledActivityAt: record.lastActivityAt } : {},
    })
  }
  /**
   * ★ 记录上的那份只是**镜像**（供诊断），它同样只由探活事件推进 ——
   *   否则 `member-dispatched` 会在同一次调用里先把这一位推到 now，
   *   而紧接着的 `task-status` 正是要拿它当"上一次探活"来比较。
   */
  putWaitRecord({
    ...record,
    ...PROBE_EVENTS.includes(event) ? { lastPollAt: now } : {},
    ...PROBE_EVENTS.includes(event) && record.lastActivityAt !== undefined
      ? { lastPolledActivityAt: record.lastActivityAt }
      : {},
  })
  return observation
}
export function auditGateRequires(point: GatePoint, context: unknown) {
  /**
   * ★ 判据的形状从哪来：`gateModuleViews()` —— 而它的**唯一真值来源是注册表**
   *   （`registry.list()`），顺序 = 注册顺序。
   *
   * ★★ 不是在这里再写一份清单，也不是去读装配点的静态 `ALL_GATES`
   *   —— MEASURED（t10 第一版就写错了）：`ALL_GATES` 只有**装配时**那 11 条，
   *   运行期 `registry.register(...)` 加进来的判据（夹具探针、以及任何后来的
   *   插件）在核对层里**根本不存在** ⇒ 核对报出的是一份**关于别的判据**的结论，
   *   而它读起来完全正常（`incomplete: 0`，一切齐整）。
   *
   *   ⇒ 这是本任务要消灭的那个形状的另一种写法：**两份真相**。一份"谁需要哪些格"
   *     的表只能有一条来路，而它是注册表。
   *   ⇒ 顺带保证 `requires.checks` 与求值结果的 `ran[]` 按 id 一一对得上。
   */
  const subjects = gateModuleViews()
    .filter((module) => module.point === point)
    .map((module) => ({
      id: module.id,
      /**
       * ★ `requires` 与 `hasRequires` 是两件事（注册表的同一条纪律）：
       *   没声明 ⇒ 留 `undefined`（审计层给 `undeclared`，那是**没声明**的读数）；
       *   声明了空数组 ⇒ 交空数组（审计层给"核对过、不需要任何一格"）。
       *   合成 `?? []` 会让"没声明"伪装成"声明过、且不需要任何东西"，
       *   于是输入面接线覆盖率的读数会虚高 —— 而虚高正是本轮要消灭的那件事。
       */
      ...module.hasRequires ? { requires: module.requires ?? [] } : {},
      /**
       * ★ 适不适用由**判据自己的** `appliesTo` 回答，与注册表求值时调的是
       *   同一个函数引用（`registry.list()` 在 t10 起交出的就是那个函数本身）。
       *   核对层不许另建一套口径（那会让"注册表跳过了它、核对却报了缺失"
       *   这种自相矛盾的结论出现 —— 而它在日志里与正常情形同形）。
       */
      ...module.appliesTo === undefined ? {} : { appliesTo: module.appliesTo },
    }))
  return auditRequires(subjects, context)
}
export function inputSurfaceSchema() {
  return {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: {
      checked: { type: 'number' as const },
      incomplete: { type: 'number' as const },
      skipped: { type: 'number' as const },
      missing: { type: 'array' as const, items: { type: 'string' as const } },
    },
  }
}
export function runtimeGatesSchema() {
  /**
   * ★★ 为什么是 `{ type: 'json' }` 而不是 `{ type: 'object', … }`（船长实测过，我复现了）──
   *
   * `evaluateRuntimeGates` 的返回类型是 `JsonValue | undefined` —— 那一格里的东西
   * **不属于本文件**（它是判据注册表的裁决形状）。写成 `{ type: 'object',
   * additionalProperties: true }` 会让 TS 在这里推出另一个不兼容的类型，
   * 于是 33 条 TS2322 里又多一条 `TS2719: Two different types with this name exist`。
   *
   * ⇒ dsh-tools 为这种"这一格是任意 JSON"提供了一个专门的 spec：`{ type: 'json' }`
   *   （见 `JsonValueSchemaSpec`）。它既表达了"这一格是别人家的"，
   *   又与 `JsonValue` 的推断逐字一致。
   */
  return { type: 'json' as const }
}
export function diagnosticFields(which: {
  inputSurface?: boolean
  runtimeGates?: boolean
  dispatchInputSurface?: boolean
  completionInputSurface?: boolean
}): Record<string, unknown> {
  return {
    ...which.inputSurface === true ? { input_surface: inputSurfaceSchema() } : {},
    ...which.runtimeGates === true ? { runtime_gates: runtimeGatesSchema() } : {},
    ...which.dispatchInputSurface === true ? { dispatch_input_surface: inputSurfaceSchema() } : {},
    ...which.completionInputSurface === true ? { completion_input_surface: inputSurfaceSchema() } : {},
  }
}
export function inputSurfaceOf(point: GatePoint, context: unknown): {
  checked: number
  incomplete: number
  skipped: number
  missing: string[]
} | undefined {
  /**
   * ★ 有判据才挂：`checked + skipped === 0` ⇒ 这个位置这一轮**没有判据**
   *   （空位置，或者注册表里一条都没有）⇒ 字段不出现（三态里的第三种）。
   *
   * ★ 为什么不拿 `incomplete > 0` 当"挂不挂"的条件：那正好退回本任务要消灭的形态
   *   ——「没挂」与「有判据且都齐」在返回值上同形。**这一行是本任务的中心。**
   */
  const audit = auditGateRequires(point, context)
  if (audit.checked + audit.skipped === 0) return undefined
  return {
    checked: audit.checked,
    incomplete: audit.incomplete,
    skipped: audit.skipped,
    missing: audit.missing,
  }
}
export interface FrictionCapture {
  /** 判据位置（`contract` / `dispatch` / …）。 */
  point: string
  /** 拒绝的原话（判据说的那一句）。 */
  message: string
  /** ① 判据读到的那一份 ctx —— **结构化快照**，不是引用。 */
  context: unknown
  /** ③ 机制状态：这一轮输入面核对结论 + 判据裁决。 */
  mechanismState: unknown
  /** 会话（用来取事件定位）—— 拿不到 ⇒ `eventRefs` 缺席，并在 `unknown` 里写明。 */
  session?: unknown
  taskId?: string
  teamId?: string
  /** 工具名（台账 `scene.trigger.tool`）。 */
  tool?: string
  /**
   * ★★ 这个团队自己的 `stateRoot`（`workspaceOf(caller)` + stateDir）。
   *   **必须由调用方给**，不许用进程级单值 —— 见 `recordFriction` 里那段实测。
   */
  stateRoot?: string
  /** 这条调用路径上读到的**未能测量**原文；缺席表示这一轮不是"没能测量"。 */
  couldNotObserve?: readonly string[]
  /**
   * ★ t23：记这条卡点时，本进程持有的 build 与盘上是否一致。
   *   缺席 ⇒ 由 `recordFriction` 现读一次（生产路径不必显式传）。
   */
  moduleFreshness?: ModuleFreshness
  /**
   * ── ★★★ t91：这条卡点是【自动记录】的还是**人**记的 ─────────────────────────────
   *
   * MEASURED（t91 实测当前台账）：209 条里 **165 条是自动记录的拒绝**
   * （`update_task rejected…` / `create_task rejected…`），而它们**没有 resolution 是设计如此** ——
   * 自动记录发生在"判据拒绝那一下"，那时没有任何人做过决定。
   *
   * ★★ 而分诊器此前把它们算进「台账待回填」⇒ 那个数字是 **174**，
   *   而真正需要人看的是 **9**（人工记录且没有 state）。
   *   ⇒ 一个读数把两类东西算成同一类：**"不需要回填"与"还没回填"在它眼里同形。**
   *
   * ── ★ 为什么它是【调用方显式声明】的，而不是在这里猜 ──────────────────────────
   *
   * 本条的唯一调用方是拒绝路径（`throwWithSurface` 那两级），那里**知道**
   * 自己是不是一次自动拒绝。⇒ 由它声明；而 `recordFriction` **不替它猜** ——
   * 猜错的后果是单向的：**它会把人工记录算成"不需要回填"**，
   * 而那正是本任务要消掉的那个误导（只是方向反过来）。
   *
   * ★ 缺省 = 人工记录：一个"忘了声明"的自动条目会落回待回填（**显眼**），
   *   而不会伪装成"不需要人管"（**隐形**）。⇒ 错的那一侧选可见的那一侧。
   */
  auto?: FrictionAutoOrigin
  /**
   * ── ★★★ C1：这一次拒绝之后，任务**有没有继续往下走** ──────────────────────────
   *
   * 用户裁定：卡点 = **任务停下来了**（`docs/PENDING-FRICTION-REFORM.md` §0）。
   * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被同一个判据拒 ≥2 次**。
   *
   * ★ 「1 次」是正常的"填错了改一下"（实测那 207 条判据拒绝日志正是这一类）；
   *   「2 次」说明它卡在同一个地方了 ⇒ 任务**真的停住**。
   *
   * ★★ 为什么由**调用方**给，而不是在 `recordFriction` 里现读一次任务：
   *   与 `stateRoot` 同一条纪律 —— 调用方手里本来就有那份 `team.json`
   *   （而在锁里），再读一次既慢又会与它正在写的那一份**不同源**。
   *   ★ 缺席 ⇒ 按 `trying` 处理（**不假设它停了**）—— 错的那一侧选"还没停"：
   *     多记一条 rejection 不会误导人，少记一条真卡点才会。
   */
  stall?: StallObservation
}

/**
 * ── ★★ C1 的判据结论（三态里的两态 + 缺席）─────────────────────────────────────
 *
 * 由调用方的 {@link observeStall} 算出来，交给 {@link recordFriction} 决定
 * 落【哪一类记录】。
 */
export interface StallObservation {
  /** ★ 这是不是"任务已经停住"（= 同一 `(task, gate)` 被拒 ≥2 次）。 */
  stalled: boolean
  /** 这个 `(task, gate)` 被拒的次数（含这一次）。 */
  count: number
  /**
   * ★ 这个数字代表什么 —— **不许省略**。
   *
   *   `repeated`  —— 同一个判据重复拒绝（**这就是判据本身**）
   *   `first`     —— 第一次被拒（⇒ 还自己解得了）
   *   `unknown`   —— 判据 id 读不出来 ⇒ **判不了**
   *
   * ★ 第三态不许并进前两者：把 `unknown` 读成 `first` 会让"读不到 id"
   *   变成"它没停"（错的）；读成 `repeated` 会让每一条读不出 id 的拒绝
   *   都变成卡点（把 207 条又请回来）。
   *   ⇒ 落 `first`（保守：不惊动人）**并在记录里说清为什么判不了**。
   */
  basis: 'first' | 'repeated' | 'unknown'
}

/**
 * 自动记录的**来源**。★ 它不是一个布尔 —— 布尔只回答"是不是自动的"，
 * 而读台账的人接下来要问的是「**是哪条判据**把它拒了」。
 */
export interface FrictionAutoOrigin {
  /** 触发这条记录的工具（`agent_teams_update_task` / …）。 */
  tool: string
  /** 卡点位置（`completion` / `dispatch` / `contract` / …）。 */
  point: string
  /**
   * ★ 拒绝原文里的**判据 id**（`completion.backtest` 那一类），读得出来时才写。
   *   读不出来 ⇒ 缺席（**不猜**：编一个 id 会让"这条是谁拒的"变成一条假事实）。
   */
  gate?: string
}

/**
 * ── ★ 从拒绝原文里读出【是哪条判据】拒的 ────────────────────────────────────────
 *
 * 拒绝原文里判据 id 的形态是 `[… ]`（实测：`update_task rejected: [dispatch.changed-paths] "…"`）。
 * ★ 读不出来 ⇒ `undefined`（**不猜**）—— 编一个 id 会让"这条是谁拒的"变成一条**假事实**，
 *   而假的归因比没有归因坏：读的人会照着它去查那条判据。
 */
export function gateIdFromMessage(message: string): string | undefined {
  const match = /\[([\w][\w.-]*)\]/u.exec(message)
  return match?.[1]
}
export function toReplayableSnapshot(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return value
  /** ★ `undefined` / 函数 / symbol **显式**标出来，而不是让它们消失。 */
  if (type === 'undefined') return { __absent: 'undefined' }
  if (type === 'function') return { __absent: 'function' }
  if (type === 'symbol') return { __absent: 'symbol' }
  if (type === 'bigint') return { __absent: 'bigint', value: String(value) }
  if (depth > 8) return { __truncated: 'depth>8' }
  const object = value as object
  if (seen.has(object)) return { __truncated: 'circular' }
  seen.add(object)
  if (Array.isArray(value)) return value.map((item) => toReplayableSnapshot(item, depth + 1, seen))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toReplayableSnapshot(item, depth + 1, seen)
  }
  return out
}
/**
 * ── ★★★ 重放：把记录里的 ctx 还原成【能真的跑】的那一份（t79）────────────────────
 *
 * ── 它修的是什么失效（MEASURED，t69 报、t79 定位）──────────────────────────────
 *
 * `gate-friction-capture` 臂 4 自称「记录 vs 日志的分水岭」，而它红着：
 *
 *     · 记录里写的是 `[completion.mutation]`
 *     · 而重放得到的是 `[completion.verify-rerun]`
 *
 * ★ 根因（本任务实测，比"缺一格"更精确）：
 *
 *   `toReplayableSnapshot` 把**每一个函数**序列化成 `{ __absent: 'function' }`
 *   —— 而那是**忠实**的：函数确实进不了 JSON。实测记录里 8 个注入点是：
 *
 *       loadKindRequirements · loadRules · execVerifyCommand · runTestOnRevision
 *       readFile · runTest · scanDirs · （killerSuites 是数组，留下来了）
 *
 *   ⇒ 于是重放时的 ctx 里，那些位置上是**对象**而不是函数。
 *   ⇒ 而 `loadKindRequirementsOfHost` 判的是 `typeof ctx.loadKindRequirements === 'function'`
 *     ⇒ 它读到 `absent` ⇒ **kind 表不可用** ⇒ `mutation.appliesTo` 返回 `false`
 *       ⇒ ★ **门不说话（silently skipped）** ⇒ 裁决落到另一条分支上。
 *
 * ── ★★ 为什么"把缺什么记进记录"（②）不够 ──────────────────────────────────────
 *
 *   ★ 它**已经**记了：`{ __absent: 'function' }` 就是"这一格是个函数，而它没被带来"。
 *   ⇒ 而它没用：记录是诚实的，**撒谎的是重放** —— 重放拿着一个它兑现不了的
 *     ctx 照常跑，然后交出一个**属于另一条分支**的结论，而那个结论看起来完全正常。
 *
 * ⇒ 所以修法必须是 ①：**重放时把那些函数重新注入**（从宿主拿，而不是从 JSON 拿）。
 *   ★ 而这正是本函数做的事。
 *
 * ── 它怎么工作 ────────────────────────────────────────────────────────────────
 *
 * 把记录里的快照与一份**注入表**合并：
 *   · 注入表里有那一格的函数 ⇒ 用**宿主的**实现（与生产同形）
 *   · 注入表里没有         ⇒ ★ **如实标成不可兑现**，而不是留一个 `{__absent}` 让它
 *     在判据里被误读成"一个对象"（那正是"缺 loader 时四条门一起沉默"的成因）
 *
 * ★ 而"注入表里没有"这一态**必须与"注入成功"不同形**：
 *   前者的补救动作是"去把那一格接上"，后者是"无"（见 `replayCtx().unreplayable`）。
 */
export function rehydrateReplayCtx(
  snapshot: unknown,
  injections: Record<string, unknown>,
): { ctx: Record<string, unknown>; injected: string[]; unreplayable: string[] } {
  const ctx: Record<string, unknown> = {}
  const injected: string[] = []
  const unreplayable: string[] = []

  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ctx, injected, unreplayable: ['the snapshot is not an object, so nothing could be replayed'] }
  }

  for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
    /**
     * ★ 只有【被序列化掉的那些格】需要重新注入 —— 而判法是看那个标记本身，
     *   而不是猜哪些键"像函数"。⇒ 于是本函数对快照的形状**不敏感**：
     *   记录里多一个函数注入点，它会自动要求重新注入那个名字。
     */
    const wasFunction = value !== null && typeof value === 'object'
      && (value as { __absent?: unknown }).__absent === 'function'
    if (!wasFunction) {
      ctx[key] = value
      continue
    }
    const supplied = injections[key]
    if (typeof supplied === 'function') {
      ctx[key] = supplied
      injected.push(key)
      continue
    }
    /**
     * ★★ 拿不到 ⇒ 把那一格**整个去掉**，并如实记下来。
     *
     * ★ 为什么去掉而不是留一个占位对象：判据们判的是 `typeof x === 'function'`
     *   ⇒ 留一个对象会让它们读成"有这一格、只是类型不对"，而那与"没有这一格"
     *     **在后果上相同、在读数上不同** —— 后者是可解释的（缺输入），
     *     前者会让人去查"为什么它不是函数"。
     *   ⇒ 去掉 = "这一格不在" = 判据自己那条"没能测量"的分支会如实说出它。
     */
    unreplayable.push(key)
  }

  return { ctx, injected, unreplayable }
}

export function sessionEventRefs(session: unknown): { sessionId?: string; eventIndices: number[] } | undefined {
  if (session === null || typeof session !== 'object') return undefined
  const header = (session as { header?: { id?: unknown; sessionId?: unknown } }).header
  const sessionId = typeof header?.id === 'string' ? header.id
    : typeof header?.sessionId === 'string' ? header.sessionId : undefined
  let events: readonly unknown[]
  try {
    events = sessionOwnEvents(session as never) as readonly unknown[]
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  const eventIndices: number[] = []
  events.forEach((event, index) => {
    if (event === null || typeof event !== 'object') return
    const record = event as { type?: unknown; kind?: unknown }
    if (record.type === 'tool/result' || record.kind === 'tool/result') eventIndices.push(index)
  })
  /**
   * ── ★★ 一条事件都没有 ⇒ 【没能定位】，不是"定位到空" ────────────────────────
   *
   * MEASURED（本臂第一版）：这里原先直接返回 `{ eventIndices: [] }`，于是
   * `index.replayable` 被算成 `true` —— 而那条记录**指不到任何事件**
   * ⇒ 它声称可重放，实际拿不出当时的原始观测。
   *
   * ★ 形态：**空数组被当成了"定位成功"**。这与 README 第一条纪律直接冲突
   *   （记录要"可重放"），也与本队记了多次的那条同源：**"没有"与"空的"不同形**。
   *   一个空定位与"我没能读会话"在读取端必须不同形 —— 前者是"那一轮没有工具结果"，
   *   后者是"我压根没读到会话"，而后者才是要去看一眼的信号。
   */
  if (eventIndices.length === 0) return undefined
  return { ...sessionId === undefined ? {} : { sessionId }, eventIndices }
}
/**
 * ── ★★★ C1：这一次拒绝之后，任务**有没有继续往下走** ───────────────────────────
 *
 * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
 *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
 * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被拒 ≥2 次 = 停住了**。
 *
 * ── ★★ 为什么"同一个判据"必须是键的一部分 ────────────────────────────────────
 *
 * 五个**不同**的判据各拒一次是**五件不同的事**（成员每次都在改，只是每次
 * 撞上另一条门）。把它们数成一个数字会让"每次都被不同的门拦"读成"卡在同一处"
 * —— 而那正好是本任务要消灭的那个合流（换成计数版本）。
 *
 * ── ★★ 为什么 N 是【可注入】的（本仓教训，逐字）───────────────────────────────
 *
 * `docs/PENDING-FRICTION-REFORM.md` §2：「`with-timeout` 那族缺陷连躲三次，
 * 根因都是『上限是硬编码常量，短测试复现不了』」⇒ N 必须能注入。
 * ★ 而注入的是**上限**，不是判据本身 —— 判据仍然只有一处实现。
 * ★ 注入口是环境变量（与 `restartEscapeHatchFromEnv` 同一形态：**明写的、可核的**），
 *   缺省 2（用户已确认）。★ 读不出数就**回落缺省**，而不是当成 0：
 *   一个坏值会让每一片拒绝都变成卡点（或一条都不变）。
 */
export const STALL_REPEAT_THRESHOLD = 2
/**
 * ── ★★★ C1：两类记录的判别面 ───────────────────────────────────────────────────
 *
 *   `rejection` —— 一条**事件**：判据拒了一下，而任务**继续走了**。不是卡点。
 *   `blocker`   —— 一条**状态**：任务在这里**停住了**（同一个判据拒了 ≥N 次）。
 *
 * ★ 两者合流正是本轮要修的缺陷（实测 253 条里 207 条是判据拒绝日志，
 *   而真正让任务停下来的只有 21 条 —— 82% 不是卡点）。
 */
export type FrictionRecordClass = 'rejection' | 'blocker'
/**
 * `rejection` 记录的标题前缀。
 *
 * ★ 它是**人**读那一份台账时唯一的判别面（`frictions-html`）——
 *   而机读那一份用 `class` 字段，不靠这个前缀（代理读数会随措辞漂）。
 */
export const REJECTION_TITLE_PREFIX = '[rejection — not a blocker] '
export function stallRepeatThreshold(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AGENT_TEAMS_STALL_REPEAT_THRESHOLD
  if (raw === undefined || raw.trim() === '') return STALL_REPEAT_THRESHOLD
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return STALL_REPEAT_THRESHOLD
  return parsed
}

/**
 * ── ★★★ 算出这一次拒绝之后任务停没停（C1 的判据本体）────────────────────────────
 *
 * 输入：这个任务**上一次**的 `stall` 读数（`task.stall`，可能缺席）+ 这一次的判据 id。
 * 输出：三态观察（`first` / `repeated` / `unknown`）。
 *
 * ── ★ 为什么密钥是 `(gate, point)` 而不只是 `gate` ──────────────────────────────
 *
 * 判据 id 在注册表里**唯一**（`completion.mutation` 只有一个位置），所以
 * 只按 gate 判就已经够了。★ 而 `point` **也**要一起比，是因为判据 id 读不出来时
 * （`unknown` 那一态）`gate` 是 `undefined`：那时若只比 `undefined === undefined`，
 * **两条毫不相干的、都读不出 id 的拒绝**会被算成"同一个判据拒了两次"。
 * ⇒ 加上 `point`，两处都读不出来时也要求位置相同。
 *   ★ 而它仍然可能把同一个位置上的两条**不同**判据算成一条 —— 所以那条路上
 *     我们落的是 `unknown`（保守：不惊动人），而不是 `repeated`。
 */
export function observeStall(
  previous: TaskStall | undefined,
  gate: string | undefined,
  point: string,
  /** ★ 这一次之前这个 `(task, gate)` 已经被拒了几次（由任务级读出，可注入）。 */
  priorCount = 0,
  threshold: number = stallRepeatThreshold(),
): StallObservation {
  /**
   * ★ 判据 id 读不出来 ⇒ **判不了**（第三态）。★ 不许并进另外两态：
   *   并进 `first` 是把"读不到"说成"它没停"；并进 `repeated` 是把
   *   <b>每一条</b>读不出 id 的拒绝都变成卡点（那 207 条就全回来了）。
   */
  if (gate === undefined || gate.trim() === '') {
    return { stalled: false, count: priorCount + 1, basis: 'unknown' }
  }
  const sameGate = previous !== undefined
    && previous.gate === gate
    && previous.point === point
  const count = sameGate ? (previous.count ?? 0) + 1 : priorCount + 1
  const stalled = sameGate && count >= threshold
  return { stalled, count, basis: stalled ? 'repeated' : 'first' }
  /**
   * ★ 【时间】刻意**不**参与判定：用"过了多久"当判据会让**同一份输入**
   *   在快机器与慢机器上给出不同裁决，而那是本仓 `with-timeout` 那族缺陷的
   *   同一形态（`docs/PENDING-FRICTION-REFORM.md` §2 记的正是它）。
   *   判据只用**次数** —— 次数与机器速度无关。
   */
}

/**
 * ── ★★★ C1：把这一次拒绝的读数【落进任务】，好让下一次拒绝能跟它比 ────────────────
 *
 * ★ 这是判据成立的全部理由：「这次拒绝之后，任务有没有继续往下走」这句话
 *   在**一次**拒绝的那一下无从判断 —— 唯一能回答它的是**下一次拒绝**
 *   （成员改字段再报 ⇒ 下一次不拒了 ⇒ 任务走了；同样的拒绝又来一次 ⇒ 停了）。
 *   ⇒ 所以判据必须是**跨调用**的，而跨调用就必须落盘。
 *
 * ── ★ 为什么改的是【同一格】而不是追加一条历史 ────────────────────────────────
 *
 * `stall` 回答的是"**现在**它停没停"，而不是"它历史上被拒过几次"。
 * 一个持续增长的数组会让读取端必须自己算"最近连续了几次" ——
 * 而那段算逻辑一旦在读取端出现第二份，两处就会分叉（本仓反复记账的形态）。
 *
 * ── ★★ 而【放行】必须清掉它 ────────────────────────────────────────────────────
 *
 * 这是本函数最容易写错的一格：若一条记录**已经**是 `stalled` 而任务随后被放行了，
 * 却**不**清掉它，那么下一次拒绝会读到 `count = 3 ≥ 2` ⇒ **第一次**拒绝就被
 * 判成卡点。⇒ 于是"每个任务最终都会变成卡点"，而那正是本任务要消灭的那个
 * 「把 82% 的事件算成卡点」的**计数版本**。
 * ⇒ 所以 {@link clearStall} 与 {@link noteStall} 是**成对的**，各自有调用点。
 */
export function noteStall(task: TeamTask, point: string, gate: string | undefined, now: number): StallObservation {
  const stall = observeStall(task.stall, gate, point)
  task.stall = {
    ...gate === undefined ? {} : { gate },
    point,
    state: stall.stalled ? 'stalled' : 'trying',
    count: stall.count,
    at: now,
  }
  task.updatedAt = now
  return stall
}

/**
 * 放行 ⇒ 忘掉那条 stall。
 *
 * ★ 与 {@link noteStall} 成对：见那里的长注释（不清会让下一次的**第一次**拒绝
 *   就被判成卡点）。
 * ★ 只在**真的有一条**时才动 `updatedAt` —— 否则每一次放行都会让任务"看起来
 *   刚被改过"，而那会让"它什么时候真的动过"这条读数失去分辨力。
 */
export function clearStall(task: TeamTask): void {
  if (task.stall === undefined) return
  delete task.stall
}

export async function recordFriction(capture: FrictionCapture): Promise<string | undefined> {
  /**
   * ── ★★ 为什么 `stateRoot` 必须由调用方【显式传入】（t22 实测出来的缺陷）───────
   *
   * 第一版复用了 `STATE_DIR_FOR_BASE_PERSIST`（一个**进程级单值**，= cwd + stateDir）。
   * 而 `stateRoot` 是**每个团队各自的**（`workspaceOf(caller)` + stateDir）。
   * ⇒ 实测后果：夹具与成员各自的临时工作区里发生的卡点，**全部被写进了主树那份
   *   团队真台账** —— 一次夹具跑动就往真台账里塞 6 条假卡点，而它们在读取端
   *   与真卡点**同形**（只有 `scene.team` 是占位名才勉强看得出）。
   *
   * ★ 形态与 f-0022 同源：「夹具造出的东西与产品造出的东西在返回值上同形」——
   *   只不过这里是**写进同一个文件**。而台账是"记录"，记录被污染之后
   *   **不可重算**（README 第一条纪律：原始现象丢了就完了）。
   *
   * ⇒ 修法：`stateRoot` 由调用方传入（它手里本来就有）。**没有它就不记** ——
   *   记到别处比不记更坏。
   */
  const root = capture.stateRoot
  if (root === undefined || root === '') return undefined
  try {
    const { mkdir, readdir, writeFile } = await import('node:fs/promises')
    const frictionDir = join(root, 'frictions')
    await mkdir(frictionDir, { recursive: true })
    /**
     * ★ id 必须**单调且不与既有撞车**：读目录取现有最大编号 +1。
     *   用时间戳当 id 会让"同一秒内的两条"撞车，而撞车后一条覆盖另一条 ——
     *   被覆盖掉的卡点与"没发生过"在台账里同形。
     */
    let max = 0
    try {
      for (const name of await readdir(frictionDir)) {
        const matched = /^f-(\d+)\.json$/.exec(name)
        if (matched === null) continue
        max = Math.max(max, Number(matched[1]))
      }
    } catch {
      /** 目录刚建 ⇒ 从 1 开始。 */
    }
    const id = `f-${String(max + 1).padStart(4, '0')}`
    const refs = sessionEventRefs(capture.session)
    /**
     * ── ★★★ C1：这条记录是【拒绝事件】还是【真卡点】───────────────────────────────
     *
     * 判据是机械的：这次的 `stall` 观察说任务停没停（见 {@link observeStall}）。
     *
     * ★ 缺席 ⇒ 按 `trying`（**不假设它停了**）：错的那一侧选"还没停" ——
     *   多记一条 rejection 不会误导人，少记一条真卡点才会。
     * ★★ 而 `class` 这一格本身是**可机读的判别面**：读取端不该靠标题措辞
     *   去猜这条记录是哪一类（那是代理读数，它会在有人改措辞时漂）。
     */
    const stall: StallObservation = capture.stall ?? { stalled: false, count: 1, basis: 'first' }
    const recordClass: FrictionRecordClass = stall.stalled ? 'blocker' : 'rejection'
    const record = {
      id,
      at: new Date().toISOString(),
      project: 'agent-teams-dev',
      /**
       * ── ★★★ 两类记录的**标题形态不同**（C1）──────────────────────────────────
       *
       * `rejection` —— ★ **加前缀**，因为它的正文是一句"某某被拒了"，而那**不是**
       *   卡点。前缀让它在整份台账里**一眼可辨**（人读那一份也吃这个前缀）。
       * `blocker`   —— 保持拒绝原文（它就是那次让任务停住的拒绝）。
       *
       * ★ 前缀里的判据 id 与正文里的**同一份**（`gateIdFromMessage` 只算一次）——
       *   两处各拼一遍就会分叉，而分叉后"这两个数字是不是一回事"要读两处才能回答。
       */
      title: recordClass === 'rejection'
        ? `${REJECTION_TITLE_PREFIX}${capture.message}`
        : capture.message,
      /** ★ 可机读的判别面（见上）。 */
      class: recordClass,
      scene: {
        team: capture.teamId ?? '(unknown)',
        task: capture.taskId ?? '(unknown)',
        trigger: { tool: capture.tool ?? '(unknown)', args: {} },
        /** ① ★ 当时的 ctx 快照 —— 这一格就是"事后补不上"的那一格。 */
        ctx: toReplayableSnapshot(capture.context),
      },
      observed: {
        verdict: { ok: false, note: capture.message },
        /** ③ ★ 机制状态：输入面核对结论 + 判据裁决。 */
        mechanismState: toReplayableSnapshot(capture.mechanismState),
        ...capture.couldNotObserve === undefined ? {} : { couldNotObserve: [...capture.couldNotObserve] },
      },
      expected: {},
      context: {
        revisions: {},
        /** ② ★ 事件定位：会话 id + `tool/result` 的序号。 */
        eventRefs: refs === undefined
          ? ['(session events were not readable at capture time)']
          : [`session ${refs.sessionId ?? '(unknown)'}: tool/result at event indices ${refs.eventIndices.join(', ')}`],
      },
      /**
       * ★ `unknown` 是"让「没记」与「没发生」不同形"的那一格。
       *   拿不到的东西**必须写在这里**，而不是留空 —— 留空会在读取端读成"当时没有"。
       */
      unknown: [
        ...refs === undefined ? ['session events were not readable, so the original observation cannot be located'] : [],
        ...stall.basis === 'unknown'
          ? ['the gate id could not be read out of the rejection, so whether this task kept moving was not judged'
            + ' — recorded as a rejection, not as a blocker']
          : [],
        'the full list of "sufficient context" is still unknown (f-0014)',
      ],
      index: {
        component: capture.point,
        kind: ['unwired'],
        kindNone: false,
        /** ★ 只有拿到事件定位才算可重放 —— 不假装。 */
        replayable: refs !== undefined,
      },
      /**
       * ── ★★ 部署状态：这条卡点是在【什么 build】上发生的（t23）─────────────────
       *
       * MEASURED（本轮五次拦截）：本队被"进程持有旧模块"拦了 5 次，而每一次的
       * **表面理由都不同**（"你虚报改动" / "基准不可得" / "依赖未满足"）——
       * 一个机制级的失效，伪装成一条业务规则。
       *
       * ⇒ 每条卡点都带上"当时的 build 对不对得上盘"，于是**下一次**读台账的人
       *   一眼能看出"这条是不是在旧 build 上发生的"，而不是重新误诊一轮。
       * ★ 它**不参与裁决**（部署状态的读数），只是记录里的一格。
       */
      deployment: {
        moduleFreshness: capture.moduleFreshness ?? moduleFreshness(),
      },
      /**
       * ── ★★★ C1：两类记录的 `resolution` **不同形** —— 而这不是措辞上的不同 ────────
       *
       * ★ 用户的原话里，两类东西的补救动作**不同**：
       *
       *     `rejection` —— 判据拒了一下，而**任务继续走了** ⇒ **不需要任何人做任何事**。
       *                    它是**证据**（"这条门在拦这个"），不是待办。
       *                    ⇒ `blocking: false` + `pool: 'self'`（还在自己解）
       *     `blocker`   —— 任务**真的停住了** ⇒ **有人必须动**（主会话救援 / 上报）。
       *                    ⇒ `blocking: true` + `pool: 'escalate'`
       *
       * ★★ 而这一格正是"合并回一条 ⇒ 臂红"瞄准的那一格：把两类都写成
       *   `blocking: false` 会让**真卡点**读成"不需要动"（那是本轮要修的原始缺陷，
       *   21 条真卡点被淹在 253 条里的那一半）；反过来写 true 会让 207 条判据拒绝
       *   全部变成"要人来管"（用户抱怨的那一半）。
       *
       * ★ `whyPool` 只在 `escalate` 时在场：一条没有进上报池的记录**没有**"为什么
       *   进这个池子"要交代 —— 缺席与"写了一句空的"必须不同形（本仓记账的形态）。
       */
      resolution: recordClass === 'blocker'
        ? {
            blocking: true,
            fix: 'unfixed: the task stopped here — the same gate rejected it again, per C1',
            pool: 'escalate',
            whyPool: `★ 同一个判据（${stall.basis === 'repeated' ? String(capture.auto?.gate ?? capture.point) : capture.point}）`
              + `拒绝了同一个任务 ${stall.count} 次 ⇒ 任务没有继续往下走（判据是机械的：拒不拒绝，看它之后有没有动）`,
          }
        : {
            blocking: false,
            fix: 'not blocking: the task kept moving — one rejection is not a stall, per C1',
            pool: 'self',
          },
      /**
       * ── ★★★ t91：自动记录的**来源** —— 而它缺席就是"人记的" ───────────────────────
       *
       * ★ 写在**顶层**（与 `resolution` 并列），因为它回答的是"这条记录**是谁产生的**"，
       *   而不是"它后来怎么了"。两件事不同轴 ⇒ 不同格（本队反复记账的那条）。
       *
       * ★★ 而它**不取舍 `resolution`**：自动条目**仍然**带 `resolution`（那是"当时还没修"的事实），
       *   只是那个 `resolution` **没有 `state`** —— 而分诊器现在**看得懂这个缺省**
       *   （自动记录的 `state` 缺席是设计如此，人工记录的缺席才叫待回填）。
       *
       * ★ 内容一个字都不少：`message` / `context` / `mechanismState` 全部照旧 ⇒
       *   它们仍能在 HTML 里读、仍能被判据扫。变的只是"要不要人来补一个 state"。
       */
      ...capture.auto === undefined ? {} : {
        auto: {
          tool: capture.auto.tool,
          point: capture.auto.point,
          ...capture.auto.gate === undefined ? {} : { gate: capture.auto.gate },
        },
      },
      /**
       * ── ★★★ C1：判这条记录属于哪一类的**那个判据**，连同它的读数一起落盘 ───────────
       *
       * ★ 为什么判据本身也要写进记录（而不是只写结论 `class`）：
       *   "这条为什么算卡点"是**事后唯一读不出来**的东西。只写 `class: 'blocker'`
       *   会让读的人无从知道 N 是几、是哪条判据重复——而那正是下一次要复查的。
       *   ★ 与 `scene.ctx` 同一条纪律（f-0014）：结论要连同它的**测量装置**一起落地。
       *
       * ★★ 而 `threshold` **必须**一起记：N 是可注入的（见 `stallRepeatThreshold`），
       *   所以"count=2 为什么算停住"这个问题在不同 N 下答案不同 ——
       *   不记 N 的话，两条 count 相同的记录在读取端**同形**，而它们的结论相反。
       *   （这正是 `docs/PENDING-FRICTION-REFORM.md` §6 经验 A：一个数必须连同它的
       *   测量装置一起读，否则并把排就是伪造趋势。）
       */
      stall: {
        state: stall.stalled ? 'stalled' : 'trying',
        basis: stall.basis,
        count: stall.count,
        threshold: stallRepeatThreshold(),
      },
    }
    await writeFile(join(frictionDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    return id
  } catch {
    /** ★ 记不下 ⇒ `undefined`（不是"没有卡点"）。 */
    return undefined
  }
}
export async function evaluateRuntimeGates(
  ctx: Context,
  event: string,
  context: unknown,
  clock: () => number = Date.now,
): Promise<JsonValue | undefined> {
  if (registry.count('runtime') === 0) return undefined
  const source = context as Record<string, unknown>
  /**
   * ── ★ 输入面注入：六个调用点**共用**这一个构造点 ────────────────────────────
   *
   * 探活判据要问"这个成员等了多久 / 还在动吗"。这两个观察由本模块的等待记录表
   * （见 {@link waitObservationFor}）持有，而不是由每个调用点各自拼 ——
   * 四处拼同一个东西，就是四处会慢慢分叉的地方，而它们在日志里同形。
   *
   * ★★ 读不到 ⇒ `wait` **整个字段缺席**，绝不是 `{}` 或半份观察。
   *   这是 t5 验收里那句"读不到时不得伪造 —— 不注入，让判据自己报 unmeasured"。
   *   判据已经声明：`startedAt` / `now` 缺席 ⇒ unmeasured（不是 ok）。
   *
   * ★ 哪些事件带 `wait`：凡上下文里有 `team` + `task`（＝"这一步是关于某个具体
   *   任务的"）的，都能对上一条等待记录。`member-dispatched` 用的是回调 payload
   *   （没有嵌套的 `team`），所以它走下面那一支。
   */
  const teamId = (source.team as { id?: unknown } | undefined)?.id
    /**
     * ★ `member-dispatched` 这一支：调度器的回调 payload **不是**嵌套的
     *   `{team, task}` 形状，它就是 `{teamId, taskId, attemptId, …}` 本身。
     *   两个形状都要认 —— 否则派发那一刻（**探活的起点**）反而是唯一读不到
     *   等待观察的调用点，而它正是最需要的那个。
     */
    ?? (typeof source.teamId === 'string' ? source.teamId : undefined)
  const taskId = typeof (source.task as { id?: unknown } | undefined)?.id === 'string'
    ? (source.task as { id: string }).id
    : typeof source.taskId === 'string' ? source.taskId : undefined
  const attemptId = typeof (source.task as { attemptId?: unknown } | undefined)?.attemptId === 'string'
    ? (source.task as { attemptId: string }).attemptId
    : typeof source.attemptId === 'string' ? source.attemptId : undefined
  /**
   * ★ 成员名也要取到：窗口的键含它（换成员 = 另一次等待，见 {@link waitWindowKey}），
   *   而取错了键会让判据去读**另一个人的**窗口。两个形状都要认（与 teamId 同）。
   */
  const memberName = typeof (source.task as { assignee?: unknown } | undefined)?.assignee === 'string'
    ? (source.task as { assignee: string }).assignee
    : typeof source.memberName === 'string' ? source.memberName : undefined
  const wait = typeof teamId === 'string' && typeof taskId === 'string'
    ? waitObservationFor(teamId, taskId, attemptId, clock(), memberName, event)
    : undefined
  /**
   * ★ 团队级调用点（`task-status` / `delivery-declared`）拿不到单个 task ⇒ 给
   *   `waits`（每个未结束尝试一条）。判据据此能问"这个队里**有谁**卡住了" ——
   *   那是快照与交付时刻真正要问的问题。
   *
   * ★ 只在**上下文里真的有 team 对象**时注入。没有 team（例如一次纯派发事件）
   *   就整个字段缺席 ⇒ 判据 unmeasured，而不是拿到一个空的观察面被误读成
   *   "这个队一个人都没在等"。
   */
  const team = source.team as TeamState | undefined
  const waits = team !== undefined && typeof team === 'object' && Array.isArray(team.tasks) && typeof team.id === 'string'
    ? teamWaitObservations(team, clock(), event)
    : undefined
  /**
   * ── ★ 输入面：本入口是**六处** runtime 调用点唯一的求值点，所以核对也在这里 ────
   *
   * → 八处调用点里六处（`member-dispatched` / `task-created` / `task-update` /
   *   `task-update-settled` / `task-status` / `delivery-declared`）经本函数进来，
   *   而 `wait` / `waits` / `event` 三格**只在这里**被注入。⇒ 核对放在这里，
   *   六处调用点核对到的是**同一份**注入结果；放在调用点上会让六处各自拼一遍，
   *   而六处会慢慢分叉、且它们在日志里同形（本任务要消灭的正是这个形状）。
   *
   * ★ 顺序：**注入完成之后、求值之前**。核对读的是**交出去的那份 ctx** ——
   *   先求值再核对会让核对结果依赖判据有没有副作用地补上某一格。
   *
   * ★★ t3：这里改用 {@link inputSurfaceOf} —— 「形状四字段」与「有判据时总是出现」
   *   这两条纪律从此**只有一处实现**，contract / dispatch / completion / delivery
   *   四处照的就是它。写成五份字面量之后，任何一次只改一处的编辑都会让同一个
   *   核对结论在五个出口上分叉，而分叉的两次读数在断言层面同形。
   *   （`undefined` ⇒ 这个事件类型没挂任何 runtime 判据 ⇒ 下面那个字段不出现。）
   */
  const runtimeInputSurface = inputSurfaceOf('runtime', {
    ...source,
    ...wait === undefined ? {} : { wait },
    ...waits === undefined ? {} : { waits },
    event,
  })
  let evaluation
  try {
    evaluation = await registry.evaluate('runtime' as never, {
      ...source,
      ...wait === undefined ? {} : { wait },
      ...waits === undefined ? {} : { waits },
      event,
    })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`agent-teams: the runtime gate threw on "${event}" (recorded, not thrown at the caller): ${reason}`)
    judgeRuntimeGates('runtime gate threw', reason)
    return { ok: false, threw: reason } as unknown as JsonValue
  }
  /**
   * ★ 输入面缺格 ⇒ **只记录、不拒绝**（先软后硬 + 契约 §5 的双保险）。
   *   runtime 位置本来就不得拒绝任务，所以这里连"要不要拒"这个问题都不存在。
   *   措辞与"runtime 判据抛错"、"判据 unmeasured"**三者互不同形** —— 读日志的人
   *   要能一眼分出"调用方没接这一格"与"判据测不了"。
   */
  if (runtimeInputSurface !== undefined && runtimeInputSurface.incomplete > 0) {
    ctx.logger.warn(`agent-teams: the runtime gate on "${event}" has an unfinished input surface (recorded, not rejected): ${runtimeInputSurface.missing.join('; ')}`)
  }
  /**
   * ── ★★★ t66：运行记录必须能分出**三态**，而不是两态 ────────────────────────────
   *
   * MEASURED（t64 实测命中，2026-10-08）：
   *
   *     `evaluate('runtime', { event: 'task-created' })`
   *       ⇒ `{ ok: false, evaluated: 0, registered: 1, skippedAll: true }`
   *       （该位置挂着 1 条判据，而这一轮它被自己的 `appliesTo` 跳过）
   *
   *   而**旧的那两态映射**把它读成：
   *
   *     `ok === false` 且 `unmeasured === undefined` ⇒ `blocked: ${blockers.join('; ')}`
   *     ⇒ 因为 `blockers` 是**空数组**，记录里写出的是 **`"blocked: "`（后面什么都没有）**
   *
   *   ⇒ ★ **一个【没被检查】的步骤，在运行记录里读起来像【发现了一个 blocker】。**
   *     而这正是 t58 的副作用（全跳过现在是 `ok:false`），也是 t64 在**调用点**消灭的
   *     同一个合流 —— 只是换成了**运行记录**这个出口。
   *     一个空的 `blocked:` 是**没有对象的指控**：它说"有问题"，而"问题"那一栏是空的。
   *
   * ── 三态（本队纪律：三者必须都能从记录里读出来）─────────────────────────────
   *
   *     ① 没被检查（`ok:false` + `skippedAll`）      ⇒ **`notChecked: …`**
   *     ② 检查了而没发现 blocker（`ok:true`）          ⇒ `ok` / `ok (nothing evaluated: …)`
   *     ③ 检查了而发现 blocker（`blockers` 非空）      ⇒ `blocked: <原文>`
   *     另有：`unmeasured`（判据跑了、说它测不了）     ⇒ `unmeasured: <原文>`（既有语义不变）
   *
   * ★ 判据用 `skippedAll` 而不是 `evaluated === 0`：后者在**空位置**
   *   （`registered === 0`）上也成立 —— 而那是"这里本来就没有判据"，是正常情形。
   *   `skippedAll` 是注册表**显式**产出的那个说明（"这一步没被检查"）。
   *   ⇒ 与 t64 在三个调用点上用的是**同一条口径**（那条一致性是刻意的：
   *     同一个事实在两个出口上必须用同一个判据，否则它们会分叉）。
   *
   * ★ 顺序也是刻意的：`unmeasured` 排在 `skippedAll` **之前**。
   *   `unmeasured` 意味着判据**跑了**（`evaluated >= 1`），而 `skippedAll` 意味着
   *   一条都没跑 —— 两者不可能同时为真，但把更强的那个放前面能让"万一同时出现"
   *   读成"判据测不了"（关于测量的结论）而不是"这一步没被检查"。
   */
  const outcome = evaluation.ok === false
    ? evaluation.unmeasured !== undefined
      ? `unmeasured: ${evaluation.unmeasured}`
      : evaluation.skippedAll !== undefined
        ? `notChecked: ${evaluation.skippedAll}`
        : `blocked: ${evaluation.blockers.join('; ')}`
    : evaluation.evaluated === 0 ? `ok (nothing evaluated: ${evaluation.registered} registered, all skipped)` : 'ok'
  judgeRuntimeGates(event, outcome)
  /**
   * ── ★ 核对结论【随记录一起交出去】（`input_surface`）──────────────────────────
   *
   * ★ 为什么必须有一个可读的出口，而不是只写日志：本队对"观察"的纪律是
   *   **读得出来才算数**。一个只进日志的核对结论会在"日志没开/被截断"时与
   *   "输入面是齐的"同形 —— 而那正是本轮要消灭的形状。
   * ★ 它与 `requires`（注册表自己那份）**不同源、互相印证**：注册表在求值中
   *   核对的是它内部那份 ctx；这里是调用方在**注入完成的那一刻**核对的。
   *   两者都在场时，"同一个缺格被两条路径分别报出来"才说明接线真的通了。
   *
   * ★★ t3：这里改读 {@link inputSurfaceOf} 的那一份（与另外四处同一个构造点）。
   *   形状仍是 `{checked, incomplete, skipped, missing}` —— 可机械比对意味着
   *   **连来源也是同一个**，而不只是五个字面量今天恰好写得一样。
   *
   * ★ 它**只在有判据时**出现（`runtimeInputSurface === undefined` ⇒ 字段不出现）。
   *   三态：都齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/ 这个事件没挂判据
   *   （字段缺席）。第三种**不是** `ok`。
   */
  return {
    ...(evaluation as unknown as Record<string, unknown>),
    ...runtimeInputSurface === undefined ? {} : { input_surface: runtimeInputSurface },
    outcome,
  } as unknown as JsonValue
}
export async function rejectOnContractGates(
  ctx: Context,
  context: Record<string, unknown>,
  what: string,
  /** ★ t22：这个团队自己的 stateRoot（台账落点）。**不许用进程级单值**，见 recordFriction。 */
  stateRoot: string,
  inject: Record<string, unknown> = {},
): Promise<{ input_surface: ReturnType<typeof inputSurfaceOf> } | undefined> {
  /**
   * ★ 输入面核对（t10）：**求值之前**，按每条判据声明的 `requires` 核对这份真实 ctx。
   *   ★ 它是**旁路数据**：下面的拒绝逻辑一个字都不看它 —— 核对报缺时流程照常走完
   *   （先软后硬）。理由与「为什么不能先求值再核对」见 {@link auditGateRequires}。
   *
   * ★ t3：改读 {@link inputSurfaceOf}（与 runtime / dispatch / completion / delivery
   *   同一个构造点），于是"形状四字段 + 有判据时总是出现"只有一处实现。
   */
  const inputSurface = inputSurfaceOf('contract', { ...context, ...inject })
  const gates = await registry.evaluate('contract' as never, { ...context, ...inject })
  /**
   * ── ★★★ t5：契约位置**仍然拒绝**「没能测量」，但它必须与「发现问题」不同形 ──────────
   *
   * ── 先记一条被驳回的第一版设计（它红了一条**绿着的**臂）─────────────────────────
   *
   * 本任务的第一版把这里改成"`unmeasured` 且 `blockers` 为空 ⇒ 放行"，
   * 依据是 `scripts/gate-task-atomicity.test.mjs` 臂 9 断言的那条 `ok === true`。
   *
   * ★ 而实测当场打红 `scripts/gate-position-wiring.test.mjs` 臂 2
   *   （"contract 位置上一条 unmeasured 判据 ⇒ 拒绝措辞与 blocked 不同形"）——
   *   那条臂在基线上是**绿的**（26/26），且它**不在** `baseline-known-failures.json` 里。
   *
   * ★★ 而驳回它的理由比"它红了一条臂"更硬：**契约位置拒绝 unmeasured 是刻意的**。
   *   `src/gates/contract/verify-command.ts:88-97` 早就把口径写死了：
   *
   *     注入   ⇒ 真的跑一次 ⇒ 结论是**观察**，可被独立复核
   *     不注入 ⇒ 只有静态分析 ⇒ 结论降级成 `unmeasured`
   *     ⇒ 而 `unmeasured` 在本插件里**等于拒绝**（`rejectOnContractGates` 对 unmeasured 抛错）
   *
   *   ⇒ ★ 它若放行，t17/t18 那段实测的**一道永远关着的门**会被读成"没检查"而放过去：
   *     **一个判不了契约的任务不许静默进入工作。**
   *   ★ 这与 `src/tools/update-task.ts` 的 completion 位置同一条纪律 ——
   *     那里的 `completionNotChecked` 也是把 `unmeasured` 当作"没能检查"而**不**当通过。
   *
   * ── 那么本任务真正要修的是什么（★ 比第一版窄，而它是可验证的那一半）───────────
   *
   * 不是"放行"，而是**三态在那个拒绝里必须仍然可分辨**：
   *
   *     ① `blockers` 非空  ⇒ 措辞说"判据发现了问题"（补救动作：去改契约）
   *     ② `unmeasured`     ⇒ 措辞说"判据没能测量"（补救动作：去补判据缺的那一格输入）
   *
   * ★ 把 ② 写成 ① 就是本队记账最久的合流（「没能测量」并进「没通过」）。
   *   两者的**补救动作相反**，所以读日志的人必须一眼分得出是哪一种。
   *
   * ★★ 而"拒绝"与"留痕"从来不是二选一：拒绝是**裁决**，留痕是**可读性**。
   *   一个被拒的契约位置同样必须能回答"当时到底是没测成，还是检查出了毛病"。
   *   ⇒ 见下面三条出口（拒绝措辞 / 台账 `couldNotObserve` / 结构化字段）。
   */
  const unmeasuredAtContract = gates.ok === false && gates.unmeasured !== undefined
    ? String(gates.unmeasured)
    : undefined
  if (gates.ok === false) {
    /**
     * ── ★★ 卡点发生时【当场记账】（t22 / f-0014）────────────────────────────────
     *
     * 三条信息只有在**此刻**可得：判据读到的 ctx、这一轮的输入面核对结论、
     * 判据的完整裁决。事后补的三样材料（任务 output / git 历史 / 会话事件）
     * 都拿不回它们 ⇒ 必须在这里落。
     *
     * ★ 它**不改裁决**：记录是旁路动作，失败只写一条 warn。
     *   与 `inputSurfaceOf` 同一条纪律（先软后硬：核对与记录都不参与裁决）。
     * ★ 用 `void … .then(warn)`：拒绝路径**必须**立刻抛出去，
     *   不许因为"写台账慢"而把一次判据拒绝变成一次等待（那会改变可观测的时序）。
     *
     * ── ★★★ t5：这一句三目**是**本任务保下来的东西，不是残留 ────────────────────
     *
     * 它把同一句 "rejected:" 分成**两种措辞**，而那不是装饰：
     *
     *     `unmeasured` ⇒ "the contract gate could not measure (…)"   ← 判据**说不出**
     *     `blockers`   ⇒ "<blockers 原文>"                            ← 判据**发现了问题**
     *
     * ★ 第一版 t5 把这个 `unmeasured` 支删掉了（因为当时想把这一态改成放行）。
     *   而 captain 裁定驳回放行（见上面那段长注释）⇒ **这一支必须原样回来**：
     *   它正是 `scripts/gate-position-wiring.test.mjs` 臂 2 钉的那条性质 ——
     *   "unmeasured must read as 'could not measure', never as 'found problems'"。
     * ★★ 而它**不是**"把拒绝说得好听"：两种措辞对应**相反的补救动作**。
     *   读的人从这一句就能知道该去补输入面，还是该去改契约。
     */
    const frictionMessage = gates.unmeasured !== undefined
      ? `${what} rejected: the contract gate could not measure (${gates.unmeasured})`
      : `${what} rejected: ${gates.blockers.join('; ')}`
    /**
     * ── ★★★ C1：这一次拒绝之后，任务有没有继续往下走 ──────────────────────────────
     *
     * ★ 判据的信息**此刻全都在手边**：任务对象（`context.task`）里就有上一轮的
     *   `stall` 读数，而这次的判据 id 就在 `frictionMessage` 里。
     *   ⇒ 不需要为此多读一次盘（那会与调用方正在写的那一份不同源）。
     *
     * ★★ 而上一轮的 `stall` 是**调用方在写它之前**读到的 —— 见各调用点的
     *   `observeStall` 调用处（那里在锁里，读到的是权威的那一份）。
     */
    const contractTask = context.task as TeamTask | undefined
    const stall = observeStall(
      contractTask?.stall,
      gateIdFromMessage(frictionMessage),
      'contract',
    )
    void recordFriction({
      stateRoot,
      point: 'contract',
      message: frictionMessage,
      context: { ...context, ...inject },
      mechanismState: { inputSurface, gates },
      stall,
      taskId: typeof (context.task as { id?: unknown } | undefined)?.id === 'string'
        ? (context.task as { id: string }).id : undefined,
      tool: what,
      /**
       * ★★★ t91：这条是**自动记录**的（本函数就是拒绝路径）⇒ 它没有 resolution 是设计如此。
       *   ⇒ 声明出来，分诊器才不会把它算进「台账待回填」。
       */
      auto: {
        tool: what,
        point: 'contract',
        ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) as string },
      },
      /**
       * ★★★ t5：`couldNotObserve` 在**拒绝**这一支上**必须**带（第一版把它挪去了放行支，
       *   而那一支被驳回了）。
       *
       * ★ 它带来的东西是别处拿不回来的：判据说"我测不了"时，**那一句原文**要落进台账。
       *   否则事后读这条拒绝只能看到"被拒了"，而看不出**缺的是哪一格输入** ——
       *   于是补救动作变成了猜。
       * ★ 与告警、结构化出口**不同源**：那是"当下这一次调用"的读数，这是"事后能查"的记录。
       */
      ...gates.unmeasured === undefined ? {} : { couldNotObserve: [String(gates.unmeasured)] },
    }).then((id) => {
      if (id === undefined) ctx.logger.warn(`agent-teams: could not record the friction at the contract gate (${frictionMessage})`)
    })
    /**
     * ── ★★★ t5：三态在那个拒绝里必须**可分辨**，而三条出口都要活着 ──────────────────
     *
     * （下面那一段注释是给人读的；三条出口按"读得出来才算数"排。）
     *
     *     ① 拒绝措辞   —— `unmeasured` 说 "could not measure"（还带着判据原文），
     *                     `blockers` 说 "rejected: <blockers>"。**两者不同形**。
     *     ② 台账        —— `couldNotObserve` 带上原文（见上）。
     *     ③ 结构化出口  —— 走**抛出侧**（`throwWithSurface` 的 `field`），
     *                     与 dispatch / completion 两个位置既有的做法一致。
     *
     * ★★ 为什么 ③ 必须走抛出侧、而不能留在返回值上（这一条是 captain 裁定 (e)）：
     *   本函数在"没能测量"这一支**抛错**（那是刻意的裁决，见上面那段长注释），
     *   而抛出之后的 `return` **永远走不到** ⇒ 挂在那里的 `contract_unmeasured`
     *   就是一个**永远填不上的字段**。
     *   ⇒ ★ 而"看起来在场、实际永远是空的读数"正是本队要消灭的形态（一个读数若
     *     读不出内容，它与不存在必须不同形 —— 而"永远不存在"比"缺席"更坏，
     *     因为它会让读者以为**有一天**它会填上）。
     *   ⇒ 所以：**不放一个死的返回字段**；把这条事实交给抛出的那一条路径，
     *     它会随工具错误面一起到调用方手里（与另外三个位置同一条机制，不新造路径）。
     */
    throwWithSurface(
      frictionMessage,
      inputSurface,
      /**
       * ★ 位置名与既有约定一致（contract 位置目前用泛用的 `input_surface`，
       *   见 `throwWithSurface` 的注释：contract / delivery 各只有一个入口）。
       */
      'input_surface',
      /**
       * ★★ t5 新增的第五个实参：**「没能测量」的原文**。
       *   缺席 ⇒ 这次拒绝是"发现了问题"；在场 ⇒ 这次拒绝是"判据说不出"。
       *   ★ 两者在结构化出口上**不同形**，于是"哪一种拒绝"不靠读措辞去猜。
       */
      unmeasuredAtContract,
    )
  }
  /**
   * ── ★★ t5：这里**没有**"放行"分支 —— 而它的缺席是刻意的、有据的 ──────────────────
   *
   * 本任务的第一版在这里写了一段 `if (unmeasuredAtContract !== undefined) { 告警 + 台账 }`，
   * 即"判据说测不了 ⇒ 放行，但留痕"。★ 它被 **captain 裁定驳回**，理由记在上面那段
   * 长注释里，而其中最硬的一条是：
   *
   *     `scripts/gate-position-wiring.test.mjs` 臂 2 钉的是"契约位置**拒绝** unmeasured"，
   *     而它在基线上是**绿的**、且**不在** `baseline-known-failures.json` 里。
   *     把它打红就是把一条约束当成可以随手拆掉的东西。
   *
   * ★★ 而正确的形态是"**拒绝 + 三态可分辨**"，不是"拒绝或留痕"二选一：
   *   裁决（拒绝）与可读性（留痕）是两件事，一个被拒的契约位置同样要能回答
   *   "当时是没测成，还是检查出了毛病"。⇒ 三条出口都在**拒绝那一支**里（见上）。
   *
   * ★ 留这段注释而不是把代码删干净就走：下一个读到这里的人会问"为什么 unmeasured
   *   没有自己的分支" —— 而一个**没有解释的缺席**与"忘了写"是同形的。
   */
  /**
   * ★ 与 completion 位置同一条纪律（t13）：有判据却一条都没跑 ⇒ 只告警、不拒绝。
   *   拒绝会把"这个位置这一轮没有适用判据"（正常情形）变成流程卡死。
   */
  if (gates.evaluated === 0 && gates.registered > 0) {
    ctx.logger.warn(`agent-teams: ${what} reached the contract gate with no gate evaluated (${gates.registered} registered, all skipped); the contract was not checked`)
  }
  /**
   * ── ★ 输入面：缺格时**只说、不拒**（先软后硬）────────────────────────────────
   *
   * MEASURED（2026-10-05 复盘）：本仓库五次同形缺陷里，**四次**是"判据要的那一格
   * ctx 没接上"（inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配），
   * 而它们在日志里与"这一步没问题"同形。⇒ 这里把核对结论**说出来**，且说得
   * 与判据自己的 `unmeasured` 措辞**不同形**：那是"判据测不了"，这是
   * "**调用方没把这一格交出去**"。
   *
   * ★ 为什么不并进上面那个分支：它会改裁决，而用户已经裁定"先软后硬"。一个
   *   自己还没被验证过的新机制当场否决别人的任务，正是本队反复踩的形态。
   *
   * ★★ t3：这条日志**保留**（它是给人看的）。它**不是**结构化出口的替代 ——
   *   上面那个返回值才是"模型与控制台读得到"的那一份，两者并存。
   */
  if (inputSurface !== undefined && inputSurface.incomplete > 0) {
    ctx.logger.warn(`agent-teams: ${what} reached the contract gate with an unfinished input surface (recorded, not rejected): ${inputSurface.missing.join('; ')}`)
  }
  /**
   * ── ★★ t5：这里**不**挂 `contract_unmeasured` —— 而"不挂"是被裁定过的，不是漏写────
   *
   * 第一版在这里返回 `{ contract_unmeasured }`，作为"没能测量"的**结构化出口**。
   * ★ 而它在修好的形态下是**死的**：本函数在"没能测量"那一支**抛错**（那正是
   *   契约位置刻意的裁决）⇒ 抛出之后的这个 `return` **永远走不到** ⇒ 那个字段
   *   永远填不上。
   *
   * ⇒ ★★ 而"看起来在场、实际永远是空的读数"正是本队要消灭的形态。
   *   一个永远填不上的字段比"缺席"更坏：**缺席至少诚实**，而它会让读者以为
   *   有一天它会填上，于是没人再去看真正的那条路径。
   *   （captain 裁定 (e)：一个字段若永远无法被填充，要么接到**抛出侧**，要么删掉 ——
   *     不许带着它当死代码发布。这里选后者，因为抛出侧已经承载了它。）
   *
   * ★ 那条事实去哪了（三处，都不在这个返回值上）：
   *     ① 拒绝措辞 —— `rejected: the contract gate could not measure (…)`
   *     ② 台账      —— `couldNotObserve: [原文]`
   *     ③ 抛出侧    —— `throwWithSurface(…, unmeasuredAtContract)`，随工具错误面到调用方
   */
  return inputSurface === undefined ? undefined : { input_surface: inputSurface }
}
export function throwWithSurface(
  message: string,
  surface: ReturnType<typeof inputSurfaceOf>,
  /**
   * ★★ 这一次拒绝属于**哪个位置** —— 决定结论在工具结果上落到**哪个字段名**（t4 修）。
   *
   * MEASURED（2026-10-06，verifier5 的臂 1/7 复跑时暴露）：
   *   成功路径上，一次 `update_task` 的两个位置**各挂各的**
   *   （`dispatch_input_surface` / `completion_input_surface`）—— 那是刻意的，
   *   因为"哪一个位置缺哪一格"必须读得出来。
   *   而**拒绝路径**当时只有一格泛用的 `input_surface` ⇒ 同一个位置在两条路径上
   *   **字段名不同形**。读者按位置的名字去找（`dispatch_input_surface`）会读不到，
   *   而"读不到"与"这个位置没判据"在断言层面同形 —— 正是本任务要消灭的那件事。
   *
   * ⇒ 现在拒绝也带位置：`dispatch` ⇒ `dispatch_input_surface`，`completion` ⇒
   *   `completion_input_surface`，其余位置（contract / delivery 各只有一个入口）
   *   仍用泛用的 `input_surface`（与它们成功路径上的字段名一致）。
   */
  field = 'input_surface',
  /**
   * ── ★★★ t5：这次拒绝是**哪一种** —— 「判据说不出」的原文，缺席即"发现了问题"──────
   *
   * MEASURED（t5）：契约位置的拒绝有两种成因，而**它们的补救动作相反**：
   *
   *     `unmeasured`（本参数在场）  ⇒ 判据**没能测量** ⇒ 去补它缺的那一格输入
   *     `blockers`  （本参数缺席）  ⇒ 判据**发现了问题** ⇒ 去改契约
   *
   * ★ 为什么它必须走到**抛出侧**而不是留在返回值上：本函数是被**抛出**路径调用的，
   *   而抛出之后调用方拿到的只有这个异常 —— 于是"哪一种拒绝"如果不随异常走，
   *   它就在**唯一真正被读到的那个出口**上缺席。
   * ★★ 而它**不改变措辞**（`message` 已经把两种成因分开写了），它补的是**结构化**那一份：
   *   读的人不必去正则匹配一句英文，就能分出"没能测量"与"发现问题"。
   *   ★ 与 `field` 那条注释同一条纪律：**同一个事实必须在两条路径上同形**。
   * ★ 传 `undefined` ⇒ 字段**不出现**（而不是出现一个空串）。缺席与"空"必须不同形。
   */
  unmeasured?: string,
): never {
  /**
   * ── ★★ 把"本进程持有的构建 vs 盘上"**附到拒绝的那句话里**（t37 / f-0027 的预防）──
   *
   * ── 它防的是什么（captain 今天的两次实测错误）────────────────────────────────
   *
   *     ① 他两次**用命令行**去读插件进程的状态 —— 读到的都是**命令行那个进程**
   *     ② 而**成员**连位置都没有：读数不存在，或指向别处
   *
   * ★ 这两件事是**同一格的两种表现**：那个读数不属于"我"，而它读起来却像是属于我的。
   *
   * ── 为什么修法是"把读数放在现场"，而不是"提醒人小心"──────────────────────────
   *
   * 提醒是一条**靠人执行**的规则，而本项目已反复证明这类规则会腐烂。
   * 让错的那条路走不通的形态是：**成员撞上拦截的那一刻**，错误信息当场告诉它
   * "你正在依据的这个进程，持有的构建与盘上是否一致" —— 于是它**不需要去别处读**，
   * 也就不会读错位置。
   *
   * ★ 这与 f-0028（t33 报的那条）是同一件事的**正面版本**：
   *   "一个读数（exitCode 0）在它分辨不了的地方被当成了结论" —— 那里的毛病是
   *   **读数与结论隔得太远**；这里把有资格的读数**挪到结论旁边**。
   *
   * ── ★ 三态在这句话里也必须分形（与 `moduleFreshnessMessage` 同一套措辞）──────
   *
   *     current  ⇒ "this process holds the current build"（可省略，但明说更省事）
   *     stale    ⇒ **必须说**，且指向动作（reload）
   *     unknown  ⇒ **不得**说成 current —— 它是"没能测量"，不是"是新的"
   *
   * ★ 措辞一律用 `moduleFreshnessMessage()`（**不在这里另写一份**）：两处各写一遍
   *   就会分叉，而分叉之后"同一件事有两句话"在下游同形 —— 本队记账过的形态。
   *
   * ── ★ 它【不参与裁决】（先软后硬）─────────────────────────────────────────────
   *
   * 这一行**只是** `message` 的追加：`throwWithSurface` 抛的仍然是一条拒绝，
   *   拒绝的**理由**与措辞一个字节没变，`instanceof Error` 与 `name` 也没变。
   *   ★ 换句话说：**去掉这一行，没有任何一处裁决会翻面**（夹具臂 9 钉住它）。
   */
  const error = new Error(`${message}\n${freshnessLine()}`)
  /**
   * ★ 有判据才挂：`undefined` ⇒ 这个位置这一轮没有挂判据 ⇒ 属性不出现
   *   （三态里的第三种）。挂一个 `undefined` 属性会让"没判据"与"有判据"在
   *   `Object.hasOwn` 这一层同形。
   */
  if (surface !== undefined) {
    Object.defineProperty(error, INPUT_SURFACE_PROPERTY, {
      value: surface,
      /** 可枚举：它是一条**结论数据**，不是内部实现细节（宿主/夹具可以直接看见它）。 */
      enumerable: true,
      writable: false,
      configurable: false,
    })
    /**
     * ★ 位置名随结论一起走：工具边界据此把结论搬到**同一个**字段名上 ——
     *   于是"同一个位置在成功路径与拒绝路径上长得一样"。
     */
    Object.defineProperty(error, INPUT_SURFACE_FIELD_PROPERTY, {
      value: field,
      enumerable: true,
      writable: false,
      configurable: false,
    })
  }
  /**
   * ── ★★★ t5：这条拒绝是**哪一种成因** —— 随异常一起走 ────────────────────────────
   *
   * 与上面两条属性**完全同一个机制**（`defineProperty` + 可枚举、不可写）：
   *   ★ 不新造第二条通道，因为"同一个事实在两条路径上必须同形"。
   *
   * ★★ 为什么它必须挂在**异常**上，而不是留在 `rejectOnContractGates` 的返回值上：
   *   本函数被**抛出**路径调用，抛出之后调用方拿到的只有这个异常 ⇒
   *   挂在返回值上的那份**永远走不到**（t5 第一版就是这样，captain 裁定 (e) 驳回）。
   *   ⇒ 一个永远填不上的字段比"缺席"更坏：缺席至少诚实。
   *
   * ★ 三态在这里是**不同形**的（与 `surface` 那条同一纪律）：
   *
   *     属性不出现          ⇒ 这次拒绝是"判据发现了问题"（`blockers` 那一支）
   *     属性 = 原文          ⇒ 这次拒绝是"判据没能测量"（`unmeasured` 那一支）
   *     ★ 而不是"属性 = 空串" —— 缺席与空必须不同形。
   *
   * ★ 它**不改裁决**：异常类型、`name`、`message` 一个字节没变
   *   （措辞里的两种成因由调用方写进 `message`，见 `rejectOnContractGates`）。
   *   去掉这三行，没有任何一处裁决会翻面。
   */
  if (unmeasured !== undefined) {
    Object.defineProperty(error, CONTRACT_UNMEASURED_PROPERTY, {
      value: unmeasured,
      enumerable: true,
      writable: false,
      configurable: false,
    })
  }
  throw error
}
/**
 * ★ t5：拒绝的**第三种**成因在结构化面上的字段名 —— "判据没能测量"。
 *
 * ★ 为什么与 `INPUT_SURFACE_PROPERTY` **分列**（不合流）：
 *   `inputSurface` 说的是"**调用方**少交了一格"（接线缺陷），
 *   本字段说的是"**判据**拿到齐的输入仍然说不出"（判据的能力边界）。
 *   两者的补救动作相反 ⇒ 合成一格就是本队记账最久的那个合流。
 */
export const CONTRACT_UNMEASURED_PROPERTY = 'agentTeamsContractUnmeasured'
export const INPUT_SURFACE_PROPERTY = 'agentTeamsInputSurface'
export const INPUT_SURFACE_FIELD_PROPERTY = 'agentTeamsInputSurfaceField'
/**
 * 读回"哪一种拒绝"—— 与 {@link inputSurfaceFieldOf} 同一形状的读数装置。
 * ★ 属性缺席 ⇒ `undefined`（**不是**空串）：缺席与"空"必须不同形。
 */
export function contractUnmeasuredOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const value = (error as Record<string, unknown>)[CONTRACT_UNMEASURED_PROPERTY]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
export function inputSurfaceFieldOf(error: unknown): string {
  if (error === null || typeof error !== 'object') return 'input_surface'
  const field = (error as Record<string, unknown>)[INPUT_SURFACE_FIELD_PROPERTY]
  return typeof field === 'string' && field.trim() !== '' ? field : 'input_surface'
}
export function inputSurfaceFromThrown(error: unknown): ReturnType<typeof inputSurfaceOf> {
  if (error === null || typeof error !== 'object') return undefined
  const carried = (error as Record<string, unknown>)[INPUT_SURFACE_PROPERTY]
  if (carried === null || typeof carried !== 'object') return undefined
  return carried as ReturnType<typeof inputSurfaceOf>
}
export type MemberConvergenceObservation = {
  name: string
  /** ★ 与判据 `MemberConvergenceInput['state']` 同一套取值（含 `never-spawned`）。 */
  state: 'idle' | 'reported' | 'working' | 'failed' | 'never-spawned' | 'unknown'
  spoke?: boolean
}
export function observedSpoke(session: unknown): boolean | undefined {
  if (session === null || typeof session !== 'object') return undefined
  let events: readonly unknown[]
  try {
    events = sessionOwnEvents(session as never) as readonly unknown[]
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  const last = [...events].reverse().find((event) => (
    event !== null && typeof event === 'object'
    && (event as { type?: unknown }).type === 'assistant/message'
  )) as { message?: { content?: unknown } } | undefined
  if (last === undefined) return undefined
  const content = last.message?.content
  if (!Array.isArray(content)) return undefined
  return content.some((block) => (
    block !== null && typeof block === 'object'
    && (block as { type?: unknown }).type === 'text'
    && typeof (block as { text?: unknown }).text === 'string'
    && (block as { text: string }).text.trim() !== ''
  ))
}
export function observeMemberConvergence(
  ctx: Context,
  team: TeamState,
): MemberConvergenceObservation[] | undefined {
  const out: MemberConvergenceObservation[] = []
  for (const member of team.members) {
    if (member.status === 'removed') continue
    /**
     * ── ★ 未 spawn 的成员：如实交出这条观察，**不**丢掉整个观察面（t16）─────────
     *
     * `member.id === ''` 意味着它**从未起来过**（依赖未满足 / 启动被拒）——
     * 而那是**被设计期望的正常情形**（profile 团队第一步就长这样）。
     *
     * ★ 它不是"没能观察"：`id === ''` 是**这个调用方手上已有的数据**，是一条
     *   **可判定的事实**（"它没起来过"），而不是"我不知道它怎么了"。
     *   把它们合流正是本队那条规则的形态：**「可判定的事实」不得写成「没能测量」**
     *   —— 而 unmeasured 有一条危险的副作用：它让门**永久关闭**。
     *
     * ★ 原写法是 `return undefined`（把整份观察面扔掉）。那不只是"不注入一个成员"，
     *   而是让**整个交付位置**对其他成员也失去观察 —— 只要队里有一个依赖未满足的
     *   成员，交付就永远无法被测量。**同一道门，从判据那边焊到了调用方这边。**
     *
     * ★ 关于"不得改注入语义"：判据定义语义（t15 已让 `never-spawned` 可表达并被判
     *   为不收敛）；这里**只是如实报告一个已有字段**，没有替判据决定它意味着什么 ——
     *   裁决仍是判据给的（blocked），调用方一个 `if` 都不参与。
     */
    if (member.id === '') {
      out.push({
        name: member.name,
        state: 'never-spawned',
        /** 「它为什么没起来」是诊断上下文，不改变裁决（判据那侧同样这么用 `error`）。 */
        ...member.spawnError === undefined ? {} : { error: member.spawnError },
      })
      continue
    }
    const live = ctx.agents.get(member.id as SessionId)
    /**
     * ★ 这一支**才是**真的没能观察：成员有会话 id，而 live Agent 拿不到 ——
     *   它可能起来了、也可能已经释放，无从分辨 ⇒ 整份观察面缺席 ⇒ unmeasured。
     */
    if (live === undefined) return undefined
    const spoke = observedSpoke(live.session)
    if (spoke === undefined) return undefined
    out.push({
      name: member.name,
      /**
       * ★ 两个来源分开用，不合流：
       *   · `state` 来自 **live Agent**（它此刻忙不忙）—— 这是可观察的；
       *   · 持久记录 `member.status` **只用来跳过 `removed`**，绝不冒充收敛。
       * 于是"记录里写着 idle、而它其实没交回任何东西"这件事，由 `spoke: false` 抓住。
       */
      state: live.status === 'running' ? 'working' : live.status === 'idle' ? 'idle' : 'unknown',
      spoke,
    })
  }
  return out
}
export async function initializeProfileTeam(input: {
  ctx: Context
  config: ToolsConfig
  memberSelections: ReturnType<typeof installMemberSelectionRuntime>
  captain: Agent
  exec: ToolRunContext
  stateRoot: string
  teamName: string
  teamId: string
  profileName: string
  inlinePlan?: import('../../profiles.ts').TeamProfileConfig
  description?: string
  staged: boolean
}): Promise<{ committed: true; state: TeamState }> {
  const profile = resolveTeamProfile(input.inlinePlan === undefined ? input.config.profiles : { [input.profileName]: input.inlinePlan }, input.profileName, input.config.maxMembers)
  const selections: Awaited<ReturnType<typeof resolveMemberLlmSelection>>[] = []
  for (const template of profile.members) {
    selections.push(await resolveMemberLlmSelection(input.ctx, input.captain, {
      provider: template.provider,
      model: template.model,
      defaultModel: input.config.memberModel,
      reasoningEffort: template.reasoningEffort,
      fallback: template.fallback ?? profile.fallback ?? input.config.fallback,
    }, input.exec.signal))
  }
  await validateMemberLlmSelections(input.ctx, selections, input.exec.signal)
  const now = Date.now()
  const seedToActual = new Map(profile.tasks.map((template, index) => [template.id, `t${index + 1}`] as const))
  const draft: TeamState = {
    name: input.teamName,
    id: input.teamId,
    description: input.description,
    profile: {
      name: profile.name,
      ...profile.description === undefined ? {} : { description: profile.description },
      ...profile.protocol === undefined ? {} : { protocol: profile.protocol },
      ...profile.executionPrompt === undefined ? {} : { executionPrompt: profile.executionPrompt },
      ...profile.fallback === undefined ? {} : { fallback: profile.fallback },
      taskPlanning: profile.taskPlanning,
      ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
    },
    ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
    captainSessionId: input.captain.id,
    createdAt: now,
    ...input.staged ? { phase: 'staged' as const, planReviewState: 'awaiting_review' as const } : {},
    members: profile.members.map((template, index) => {
      const selection = selections[index]!
      return {
        id: '',
        name: template.name,
        role: template.role,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        executionPrompt: template.executionPrompt ?? profile.executionPrompt ?? input.config.executionPrompt,
        ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
        joinedAt: now,
        status: 'idle' as const,
      }
    }),
    tasks: profile.tasks.map((template, index) => ({
      id: `t${index + 1}`,
      profileSeedId: template.id,
      subject: template.subject,
      description: template.description,
      status: 'pending' as const,
      assignee: template.assignee,
      dependencies: template.dependencies.map((dependency) => seedToActual.get(dependency) ?? dependency),
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    })),
    taskSeq: profile.tasks.length,
  }
  // Roster creation is durable planning only. The scheduler starts each
  // member with its first actual task once its dependencies are satisfied.
  if (input.inlinePlan !== undefined) delete draft.profile
  await createTeamDir(input.stateRoot, draft)
  return { committed: true, state: draft }
}
export function parseFindings(value: unknown): ReviewFinding[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('findings must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`findings[${index}] must be an object`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw['id'] !== 'string' || raw['id'].trim() === '') throw new Error(`findings[${index}].id is required`)
    if (raw['severity'] !== 'low' && raw['severity'] !== 'medium' && raw['severity'] !== 'high' && raw['severity'] !== 'blocker') {
      throw new Error(`findings[${index}].severity is invalid`)
    }
    if (typeof raw['problem'] !== 'string' || raw['problem'].trim() === '') throw new Error(`findings[${index}].problem is required`)
    if (typeof raw['requiredFix'] !== 'string' || raw['requiredFix'].trim() === '') throw new Error(`findings[${index}].requiredFix is required`)
    return {
      id: raw['id'].trim(),
      severity: raw['severity'],
      problem: raw['problem'],
      requiredFix: raw['requiredFix'],
      // A blank optional file must be omitted, not persisted: durable-state
      // validation requires non-empty optional strings (issue #105 class).
      ...typeof raw['file'] === 'string' && raw['file'].trim() !== '' ? { file: raw['file'] } : {},
      ...typeof raw['line'] === 'number' ? { line: raw['line'] } : {},
      ...typeof raw['resolved'] === 'boolean' ? { resolved: raw['resolved'] } : {},
    }
  })
}
export function parseAcceptanceResults(value: unknown): AcceptanceResult[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('acceptanceResults must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`acceptanceResults[${index}] must be an object`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw['criterion'] !== 'string' || raw['criterion'].trim() === '') {
      throw new Error(`acceptanceResults[${index}].criterion is required`)
    }
    if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
      throw new Error(`acceptanceResults[${index}].status must be passed or failed`)
    }
    return {
      criterion: raw['criterion'],
      status: raw['status'],
      ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
    }
  })
}
export function parseCommandResults(value: unknown): CommandResult[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('commandsRun must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`commandsRun[${index}] must be an object`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw['command'] !== 'string' || raw['command'].trim() === '') {
      throw new Error(`commandsRun[${index}].command is required`)
    }
    if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
      throw new Error(`commandsRun[${index}].status must be passed or failed`)
    }
    return {
      command: raw['command'],
      status: raw['status'],
      ...typeof raw['exitCode'] === 'number' ? { exitCode: raw['exitCode'] } : {},
      ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
      /**
       * ── ★★★ `failures` 必须【透传】—— 否则 t19 那一格永远收不到数据 ────────────
       *
       * MEASURED（2026-10-10，`verifier` 在 t40 上逐环查出）：
       *   解析器只保留 command/status/exitCode/evidence ⇒ `failures` **既不读也不透传**
       *   ⇒ `classifyVerifyFailures` 拿到的永远是 `undefined` ⇒ 永远 `undecidable` ⇒ 永远拒。
       *   ★★ 而 schema 那一环也不暴露它（`additionalProperties: false` 且无 `failures`）
       *     ⇒ 就算传了也会在建参数时被拒。
       *   ⇒ ★ 于是"t19 修好了"与"t19 一点也没生效"在读数上同形 —— 因为那一格没有数据。
       *
       * ★ 而它只在【形状对】时透传：一条名字不像字符串的失败，在这里丢掉，
       *   而不是让下游拿一个半读得懂的数组（那会让"读不懂"与"没有新增"合流）。
       */
      ...Array.isArray(raw['failures'])
        ? { failures: raw['failures'].filter((name): name is string => typeof name === 'string' && name.trim() !== '') }
        : {},
    }
  })
}
export function applyQualityFollowUp(team: TeamState, closed: TeamTask): { created: TeamTask[]; escalated: boolean } {
  const planned = planQualityFollowUp(team, closed)
  if (planned.escalated === true) team.escalated = true
  const created: TeamTask[] = []
  const existing = [...team.tasks]
  const now = Date.now()
  const idBySubject = new Map<string, string>()
  for (const draft of planned.created) {
    team.taskSeq += 1
    const id = `t${team.taskSeq}`
    if (draft.id !== undefined) idBySubject.set(draft.id, id)
    if (draft.subject !== undefined) idBySubject.set(draft.subject, id)
    const dependencies = (draft.dependencies ?? []).map((dependency) => {
      if (team.tasks.some((item) => item.id === dependency)) return dependency
      return idBySubject.get(dependency) ?? dependency
    })
    const next: TeamTask = {
      id,
      subject: draft.subject ?? `${draft.kind}-round-${draft.round ?? 1}`,
      status: 'pending',
      assignee: draft.assignee,
      dependencies,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
      kind: draft.kind,
      ...draft.round === undefined ? {} : { round: draft.round },
      ...draft.objective === undefined ? {} : { objective: draft.objective },
      ...draft.inScope === undefined ? {} : { inScope: draft.inScope },
      ...draft.outOfScope === undefined ? {} : { outOfScope: draft.outOfScope },
      ...draft.acceptance === undefined ? {} : { acceptance: draft.acceptance },
      ...draft.verify === undefined ? {} : { verify: draft.verify },
      ...draft.sourceTaskId === undefined ? {} : { sourceTaskId: draft.sourceTaskId },
      ...draft.sourceFindingIds === undefined ? {} : { sourceFindingIds: draft.sourceFindingIds },
      ...draft.reviewedTaskId === undefined ? {} : { reviewedTaskId: idBySubject.get(draft.reviewedTaskId) ?? draft.reviewedTaskId },
    }
    team.tasks.push(next)
    created.push(next)
  }
  // A staged full delivery plan may already contain downstream integration
  // work that points at the first requirements/review gate. When that gate
  // opens an automatic revision loop, move only still-pending downstream
  // edges to the new terminal gate so the approved plan can continue after
  // the repair instead of waiting forever on an intentionally failed task.
  const replacement = created.at(-1)
  if (replacement !== undefined) {
    for (const task of existing) {
      if (task.status !== 'pending' || !task.dependencies.includes(closed.id)) continue
      task.dependencies = task.dependencies.map((dependency) => (
        dependency === closed.id ? replacement.id : dependency
      ))
      task.updatedAt = now
    }
  }
  return { created, escalated: planned.escalated === true }
}
export function renderStatus(value: JsonValue): string {
  const team = value as {
    team_name: string
    description?: string
    profile?: { name: string; protocol?: string; task_planning?: string }
    viewer: string
    members: {
      name: string
      role: string
      provider: string
      model: string
      reasoning_effort: string
      status: string
      activity: string
      spawn_error?: string
    }[]
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; attempt: number; attempt_id: string; reassigning: boolean; seed_id?: string; output?: string; kind?: string; round?: number; verdict?: string; findings_open?: number; supplemental_evidence?: string }[]
    captain_inbox: { from: string; content: string }[]
    member_inbox?: { from: string; content: string }[]
    member_inboxes: Record<string, { count: number; latest: string }>
    mailbox_warnings: string[]
    mailbox_warning_count: number
    halted?: boolean
    escalated?: boolean
    loop_state?: string
    loop_summary?: string
    deliverable?: boolean
    coverage?: { goal_item: string; status: string; task_ids: string[] }[]
    delivery?: { ok: boolean; blockers: string[] }
    /**
     * ★ 部署状态（t34 的格）。**必须渲染出来** —— 见下面那段 MEASURED。
     */
    deployment?: { status: string; message: string; loaded?: string; on_disk?: string }
  }
  const flags = [
    team.halted ? 'halted' : undefined,
    team.escalated ? 'escalated' : undefined,
    team.deliverable ? 'deliverable' : undefined,
    team.loop_state && team.loop_state !== 'running' && team.loop_state !== 'halted' && team.loop_state !== 'escalated'
      ? team.loop_state
      : undefined,
  ].filter((item): item is string => item !== undefined)
  const lines: string[] = [
    `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`,
    ...team.profile === undefined ? [] : [`Profile: ${team.profile.name}${team.profile.task_planning ? ` [${team.profile.task_planning}]` : ''}${team.profile.protocol ? ` — ${team.profile.protocol}` : ''}`],
    ...team.loop_summary ? [`Loop: ${team.loop_state ?? ''} — ${team.loop_summary}`.replace(/^Loop:  — /u, 'Loop: ')] : [],
    `Viewing as: ${team.viewer}`,
    `Members (${team.members.length}):`,
    ...team.members.map((member) => {
      const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : ''
      const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : ''
      const failure = member.spawn_error === undefined ? '' : `\n      start failed: ${member.spawn_error.slice(0, 400)}`
      return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}${failure}`
    }),
    `Tasks (${team.tasks.length}):`,
    ...team.tasks.map((task) => {
      const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : ''
      const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : ''
      const evidence = task.supplemental_evidence ? `\n      Supplemental observations (original verdict unchanged): ${task.supplemental_evidence}` : ''
      const handoff = task.reassigning ? ' (reassigning)' : ''
      const seed = task.seed_id === undefined || task.seed_id === '' ? '' : ` seed ${task.seed_id}`
      const kind = task.kind ? ` ${task.kind}` : ''
      const round = task.round === undefined ? '' : ` r${task.round}`
      const verdict = task.verdict === undefined ? '' : ` verdict ${task.verdict}`
      return `  - ${task.id} [${task.status}]${kind}${round}${verdict} attempt ${task.attempt}${handoff}${seed} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}${evidence}`
    }),
    ...team.coverage === undefined || team.coverage.length === 0 ? [] : [
      'Coverage:',
      ...team.coverage.map((row) => `  - ${row.goal_item}: ${row.status} (${row.task_ids.join(',') || 'none'})`),
    ],
    ...team.delivery === undefined ? [] : [
      `Delivery: ${team.delivery.ok ? 'ok' : `blocked (${team.delivery.blockers.join('; ')})`}`,
    ],
    /**
     * ── ★ 部署状态必须【渲染出来】（2026-10-07，一次代价很大的实测）─────────────
     *
     * MEASURED：t34 把 `deployment` 加进了 status 的【返回值】，而没有加进这里的
     * **渲染**。后果是我（captain）在整整一个下午里，反复把"渲染里没有"读成
     * "宿主进程没有那个字段"，并据此得出"宿主持旧模块"的结论 —— 而那个结论
     * 把整条链冻了几个小时。
     *
     * ⇒ 教训不是"要小心"，而是**这个字段的性质**：
     *   它的用途是回答「我该不该重载」，而那是一个【要被人看见】的问题。
     *   一个只在返回值里、而人看不见的读数，**与它不存在是同一件事** ——
     *   这正是 t31 那条「一个没有调用方的修法，与没有修法在观测上完全相同」
     *   在同一层上的又一版本。
     *
     * ★ 三态在渲染里也分形（不是只印一个字段）：
     *   `current` 说"本进程持的就是盘上那一份"；
     *   `stale` 【必须】说清它旧了、并指向动作（重载）；
     *   `unknown` 说"没能确定"，且【不得】读成 current ——
     *   与它未渲染时那种"看得见 current、看不见 unknown"的写法相反。
     */
    ...team.deployment === undefined ? [] : [`Deployment: ${team.deployment.message}`],
    `Captain inbox (${team.captain_inbox.length}):`,
    ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content}`),
    ...(team.member_inbox ?? []).map(message => `  - [${message.from}] ${message.content}`),
  ]
  for (const [name, inbox] of Object.entries(team.member_inboxes)) {
    lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`)
  }
  if (team.mailbox_warning_count > 0) {
    lines.push(
      `Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`,
      ...team.mailbox_warnings.map((warning) => `  - ${warning}`),
    )
  }
  return lines.join('\n')
}

/**
 * ── ★★ 重载的【排队】通道（t49）──────────────────────────────────────────────────
 *
 * ── 它修的是什么（用户实测的结构性矛盾，原话）──────────────────────────────────
 *
 *   「不管是我手动重启，还是调用最新的 restart 去重启，都需要等待团队成员的工作完成。
 *     我对这个插件的想法是，它需要尽可能把并发打满，尽可能去做快速迭代。
 *     也就是说，如果有团队成员在工作，就不可能进行手动重启或 restart。
 *     只要是跟 restart、重载相关的线，都会被阻塞。」
 *
 * ★ 那个矛盾的精确形状：
 *
 *     重载需要【无进行中工作】  ∧  并发干活 ⇒ 永远有进行中工作
 *     ⇒ 两者**结构上互斥** ⇒ 旧模块永远换不掉
 *
 * ★ 而 captain 的实测给了它两条硬证据：
 *   ① 调 `agent_teams_restart` ⇒ 拒：「2 task(s) are in progress」
 *   ② **用户手动重启两次**（PID 52994 → 54529 → 18909），而 `[deployment]` 仍报 stale
 *      ⇒ ★ **换进程 ≠ 换模块**（比 "reload ≠ restart" 更精确）
 *
 * ── 于是：被拒 ≠ 失败，而是**进入队列** ─────────────────────────────────────────
 *
 *   一次被拒的重载申请**不丢掉** —— 它变成「已申请」，并带来三件事：
 *     ① **不再派发新任务**（否则永远有新的工作在跑，闸门永远不满足）
 *     ② 当前在跑的**收口后自动重载**（不必让 captain 再调一次）
 *     ③ **能被 `status` 读到**（好让 captain 知道该不该继续派发）
 *
 * ── ★★ 三态不同形（本队反复学到的那条）──────────────────────────────────────────
 *
 *     `none`       —— 没有申请（重载仍走原闸门）
 *     `waiting`    —— 已申请，且**还等得到**（附「还要等哪些任务」）
 *     `stuck`      —— 已申请，但**等不到**（某个任务永不终态 ⇒ 要人工介入）
 *
 *   ★ 第三态为什么必须与第二态不同形：`waiting` 会自己收敛，`stuck` **不会**。
 *     把它们写成同一形状，读的人会一直等一个不会发生的事 ——
 *     而"等不到"与"还在等"在读数上同形，是本队记过的那条最贵的形态之一。
 *
 *   ★ 判定 `stuck` 的口径：**申请之后还有没有可能收敛**。
 *     一个任务的 status 若已经不可能再变（终态），它不该在等待名单里；
 *     而"等待名单非空、且其中某个任务**已经很久没有任何变化**"才是最可疑的信号。
 *     本实现用一条**可机械判定**的口径：等待名单里的任务若**不在当前任务表里**
 *     （被删了 / 从未存在）⇒ 它永远不会变成终态 ⇒ `stuck`。
 *
 *     ★ 为什么不用"超时"：超时需要一个时长阈值，而本队实测任务时长是
 *       **重尾分布**（最短 1.4 分钟、最长 767 分钟）⇒ 任何阈值都会误判。
 *       用户提的「预估时长后派发更短的」已被 captain 用 44 条真实数据否定，
 *       同一个理由在这里也成立：**不要给不可预测的东西设一个预测性的阈值**。
 */
export type RestartQueueState =
  | { status: 'none' }
  | { status: 'waiting'; requestedAt: number; waitingOn: string[] }
  | { status: 'stuck'; requestedAt: number; waitingOn: string[]; reason: string }

/**
 * 进程级的「已申请重载」状态。
 *
 * ★ 为什么是**进程级**而不是耐久态：重载是**这个进程**换掉自己的代码 ——
 *   它属于进程，不属于团队。而把它写进 `TeamState` 要改 `src/types.ts`
 *   与 `src/state.ts`（**都不在本任务 inScope**）。
 * ★ 而"进程级"不削弱它的用处：`status` 由**同一个进程**回答，
 *   而闸门与重载也都在这个进程里 ⇒ 三者看到的是**同一份**状态。
 *   ★ 反过来说清了它的**边界**：这个状态**不跨进程**（换进程就没了）——
 *     而那恰好是对的：换了进程，旧的申请本就该作废（新进程有新的模块）。
 */
let requestedRestart: { at: number; waitingOn: string[] } | undefined

/** 此刻的排队状态（**纯函数**：只读入参，不读模块状态 —— 便于夹具直接构造三态）。 */
export function restartQueueState(input: {
  requestedAt?: number
  waitingOn: readonly string[]
  /** 当前任务表里**存在**的任务 id（用来发现"等待一个不存在的任务"）。 */
  knownTaskIds: readonly string[]
  /** 当前仍在进行中的任务 id。 */
  inFlight: readonly string[]
}): RestartQueueState {
  if (input.requestedAt === undefined) return { status: 'none' }
  /**
   * ★★ 第三态：**等不到**。
   *
   *   等待名单里的某个任务**不在任务表里** ⇒ 它永远不会变成终态
   *   （它已经不在了，没有任何东西能让它收口）⇒ 这一等不会有结果。
   *
   *   ★ 而它必须与 `waiting` **不同形**：`waiting` 会自己收敛，`stuck` 不会。
   *     写成同一形状的后果是**读的人一直等**，而那正是本队记过的
   *     「等不到与还在等同形」。
   */
  const known = new Set(input.knownTaskIds)
  const vanished = input.waitingOn.filter((id) => !known.has(id))
  if (vanished.length > 0) {
    return {
      status: 'stuck',
      requestedAt: input.requestedAt,
      waitingOn: [...input.waitingOn],
      reason: `waiting on task(s) that are no longer in the team: ${vanished.join(', ')} — nothing can bring them to a terminal status, so this wait will never end`,
    }
  }
  /**
   * ★ 收口了：等待名单与进行中的交集为空 ⇒ 可以重载了。
   *   ★ 这里返回 `waiting` 且名单里可能**已经为空** —— 调用方据此决定是否重载。
   *     而"可重载"由 `waitingOn.length === 0` 表达，不是一个**独立的第四态**：
   *     一个已经等到的申请仍是"已申请"（它还没有被消费）。
   */
  return {
    status: 'waiting',
    requestedAt: input.requestedAt,
    waitingOn: input.waitingOn.filter((id) => input.inFlight.includes(id)),
  }
}

/** 记下一次申请（进程级）。 */
export function requestRestart(waitingOn: readonly string[], now: number): void {
  requestedRestart = { at: now, waitingOn: [...waitingOn] }
}

/** 读当前的申请（`undefined` = 没申请过）。 */
export function pendingRestartRequest(): { at: number; waitingOn: string[] } | undefined {
  return requestedRestart === undefined ? undefined : { at: requestedRestart.at, waitingOn: [...requestedRestart.waitingOn] }
}

/** 消费掉申请（重载真的发生了，或申请被放弃）。 */
export function clearRestartRequest(): void {
  requestedRestart = undefined
}

/**
 * 用**当前的任务表**算出排队状态（`restartQueueState` 的薄封装）。
 *
 * ★ 与闸门同一条纪律：输入从**耐久态**来（调用方读 team），不从这个模块缓存。
 */
export function restartQueueFrom(tasks: ReadonlyArray<{ id: string; status: string }>): RestartQueueState {
  const request = pendingRestartRequest()
  if (request === undefined) return { status: 'none' }
  const inFlight = tasks.filter((task) => task.status === 'in_progress').map((task) => task.id)
  return restartQueueState({
    requestedAt: request.at,
    waitingOn: request.waitingOn,
    knownTaskIds: tasks.map((task) => task.id),
    inFlight,
  })
}

/** 一句人话（供工具结果与 status 读）。★ 三态措辞必须互不同形。 */
export function restartQueueMessage(state: RestartQueueState): string {
  if (state.status === 'none') return 'no reload has been requested'
  if (state.status === 'waiting') {
    return state.waitingOn.length === 0
      ? `a reload was requested at ${state.requestedAt} and nothing is in flight any more — it can proceed`
      : `a reload was requested at ${state.requestedAt} and is waiting on ${state.waitingOn.join(', ')}`
  }
  return `a reload was requested at ${state.requestedAt} but CANNOT converge: ${state.reason}`
}

