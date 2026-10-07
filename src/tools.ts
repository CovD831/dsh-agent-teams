/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import {
  amendTaskContract,
  acknowledgeMailbox,
  markMailboxDelivered,
  discardMailboxMessages,
  appendMailbox,
  archiveTeamDir,
  beginTaskAttempt,
  CAPTAIN_KEY,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  cancelUnfinishedTask,
  invalidateTaskAttempt,
  readUnreadMailbox,
  readMailbox,
  recordRetiredMemberIds,
  releaseMailboxDelivery,
  readTeam,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
  validateCreateTask,
  evaluateQualityCompletion,
  planQualityFollowUp,
  resumeTeamState,
  buildCoverageMatrix,
  canDeclareDelivery,
  describeQualityLoop,
  sanitizeReviewAcceptance,
  sanitizeReviewObjective,
  normalizeBlankOptionalTaskFields,
  taskKindOf,
} from './state.ts'
import { appendTaskEvidence, repairCompletionVerdict } from './quality-gates.ts'
import { gateModuleViews, registry } from './gates/index.ts'
import { auditRequires } from './gates/requires.ts'
import type { GatePoint } from './gates/index.ts'
import { gitChangedPaths, observedChangedPaths, sessionOwnEvents } from './harness-compat.ts'
import type { ContractAmendmentInput } from './state.ts'
import type { AcceptanceResult, CommandResult, ReviewFinding, ReviewVerdict, TaskKind } from './types.ts'
import {
  deliverToMember,
  installRetiredMemberGuard,
  installMemberSelectionRuntime,
  installMemberDelegationGuard,
  memberActivity,
  resolveMemberLlmSelection,
  spawnMember,
  steerCaptainReport,
  validateMemberLlmSelections,
  type MemberRuntimeConfig,
} from './members.ts'
import { TERMINAL_TASK_STATUSES, type TeamMember, type TeamState, type TeamTask } from './types.ts'
import { collectCompletedDependencyOutputs, formatDependencyOutputs, installTeamScheduler } from './scheduler.ts'
import { installMailboxAdmission, isCurrentMail, mailboxContent, mailboxPrompt, readCurrentMailbox } from './mailbox.ts'
import { resolveTeamProfile } from './profiles.ts'
import { register as register_create } from './tools/create.ts'
import { register as register_edit_plan } from './tools/edit-plan.ts'
import { register as register_approve } from './tools/approve.ts'
import { register as register_members } from './tools/members.ts'
import { register as register_create_task } from './tools/create-task.ts'
import { register as register_reassign } from './tools/reassign.ts'
import { register as register_claim } from './tools/claim.ts'
import { register as register_update_task } from './tools/update-task.ts'
import { register as register_amend_task } from './tools/amend-task.ts'
import { register as register_message } from './tools/message.ts'
import { register as register_status } from './tools/status.ts'
import { register as register_delivery } from './tools/delivery.ts'
import { register as register_resume } from './tools/resume.ts'
import { register as register_delete } from './tools/delete.ts'
import { register as register_restart } from './tools/restart.ts'
import { AgentTeamsRuntime, INPUT_SURFACE_PROPERTY, RUNTIME_GATE_LOG_LIMIT, StagedPlanMutation, ToolsConfig, WaitRecord, WaitWindow, arbitrateRestart, auditGateRequires, diagnosticFields, evaluateRuntimeGates, forgetWaitWindow, inputSurfaceOf, judgeRuntimeGates, moduleFreshness, moduleFreshnessMessage, observeMemberActivity, observeMemberConvergence, observedSpoke, putWaitRecord, putWaitWindow, requireFreshCaptainTeam, requireMember, requireTask, runtimeGateLog, stateRootOf, stopTeamMemberActivations, taskWorktreeBase, teamLockKey, teamWaitObservations, throwWithSurface, trimmedOptional, waitRecords, waitWindowKey, waitWindows, workspaceOf, worktreeBaseOf } from './tools/shared/entities.ts'
// ── ★ t39：对外接口不变 ─────────────────────────────────────────────────────
// 这两个类型此前【声明在 tools.ts 里】，外部（src/index.ts）从这里 import。
// 拆分之后它们的家在 tools/shared/entities.ts —— 而【对外接口不许变】，
// 所以在这里原样再导出一次：调用方一行都不用改（契约第 4 条）。
// ── ★ t39：对外接口不变（契约第 4 条）──────────────────────────────────────────
//
// MEASURED（本任务）：拆分之后，下面这 14 个导出**从 tools.ts 上消失了** ——
// 它们的家搬到了 tools/shared/entities.ts，而外部（scripts/*.test.mjs、src/index.ts）
// 仍然是【从 tools.ts import】的。实测症状：
//
//     SyntaxError: The requested module '../lib/tools.js' does not provide
//                  an export named 'moduleFreshness'
//
// ★ 而那正是"拆分不得改变行为"在【接口】那一层的反面：
//   行为没变、而**接口变了** —— 两者在"跑夹具"时都会红，但成因完全不同。
// ⇒ 修法：在这里原样再导出一次。调用方一行都不用改。
export {
  RESTART_ESCAPE_HATCH_ENV,
  applyQualityFollowUp,
  arbitrateRestart,
  arbitrateRestartWithEscape,
  moduleFreshness,
  moduleFreshnessMessage,
  restartArbitrationMessage,
  restartEscapeHatchFromEnv,
} from './tools/shared/entities.ts'
export type {
  AgentTeamsRuntime,
  BaseRevisionResolution,
  ModuleFreshness,
  RestartArbitration,
  StagedPlanMutation,
  ToolsConfig,
} from './tools/shared/entities.ts'

export { steerCaptainReport } from './members.ts'

/**
 * ── ★★ 工具边界：核对结论**挂在拒绝上也要出得来**（t3）───────────────────────────
 *
 * 四处里的三处（contract / dispatch / completion）走**异常路径**：一次被拒的
 * `create_task` / `update_task` / `amend_task` / `declare_delivery` 不返回结果对象，
 * 而拒绝**恰恰是最需要读到核对结论**的那一刻 —— 那里最容易合流的正是
 * "这个动作本身不合法"与"判据要的那一格调用方没接上"。
 *
 * ★ 做法：`throwWithSurface` 把结论挂成 `Error` 的一个自有属性（见它的长注释），
 *   本函数在**工具边界**把它原样搬进工具结果的 `input_surface` 字段。
 *
 * ── ★★ 三条纪律，每条都来自一次实测 ────────────────────────────────────────────
 *
 *   ① **只在"还没被搬运过"时搬运**（`INPUT_SURFACE_PROPERTY in error`）。
 *      MEASURED（本任务第一次跑真实入口就撞上）：`update_task` 一次调用**穿过两个
 *      位置**（dispatch 与 completion）。先拒绝的那个（dispatch）已经把结论挂在
 *      `error.input_surface` 上了，而**后**拒绝的那个（completion）再挂一次 ——
 *      于是 dispatch 那一份被**静默覆盖**，读出来的是 completion 的结论。
 *      那正是本队记账的第三种恒真写法（**读错位置的出口**）：字段在场、读得到、
 *      数值也对，只是它不是读者以为的那个位置报的。
 *      ⇒ 第一个报缺的位置赢。**不合并、不覆盖** —— 合并会让"哪一个位置缺哪一格"
 *        重新变得读不出来，而那是本任务存在的理由。
 *
 *   ② **失败结果仍然是一条失败结果**：本函数**不改变任何裁决**。抛出物**原样**
 *      继续抛出去（同一个对象，`instanceof` 与 `message` 都不变，调用方原有的
 *      错误处理一个字都不用改），只是它身上多了一个自有属性。
 *
 *   ③ **没有结论时行为逐字节不变**（连抛出的对象都不动）。
 *
 * ★ 为什么必须包在 `execute` 的外面，而不是在各工具里各 `try/catch` 一次：
 *   四处 → 五处 `catch` 就是五处会慢慢分叉的地方（而分叉之后，"哪一处带得出来结论"
 *   在断言层面同形 —— 这正是本任务要消灭的形状）。边界只有一处。
 *
 * ★ 副作用为零的证据：本函数只在 `error` 上**多挂一个自有属性**。不写盘、不记日志、
 *   不改控制流；`instanceof Error` 与 `message` 都逐字不变。
 *
 * ★ 类型上刻意用**结构化**的最小形状（而不是某个具体的 tool 泛型）：这样它既能包住
 *   `defineTool(...)` 的返回值，又不引入任何新的类型依赖。运行期它只是一次转发。
 */

/** Resolved plugin config consumed by the tools. */

/** Browser/UI mutations allowed while a plan is waiting for approval. */

/** Runtime bridge shared by model-facing tools and the Web staging surface. */

/** The caller agent, or a loud failure for non-agent callers. */

/** The captain's workspace directory (team state root parent). */

/**
 * ── ★ 判据层执行 verify 命令的执行器 ────────────────────────────────────────────
 *
 * 在队长的 workspace 里跑一条 verify 命令，返回真实退出码。
 * 这是整个修复里唯一做 I/O 的新增点，被注入进纯函数 `rerunVerifyCommands`，
 * 让 quality-gates.ts 保持零 I/O 的纪律（它自己的 verify 全套都在无 I/O 下跑）。
 *
 * ★ 超时：命令挂死时返回非零而不是让 update_task 永远不返回。125 是 shell
 * 惯用的"命令超时"退出码，与被测命令自己的退出码空间区分开。
 */


/**
 * ── ★ 判据的注入口径：I/O 在这一层，判据本身是纯数据变换 ────────────────────────
 *
 * MEASURED（2026-10-05，t7）：`registry.evaluate('completion', …)` 此前**只**注入
 * `execVerifyCommand`，于是三条新判据在生产路径上永远拿不到输入：
 *
 *     completion.mutation  ⇒ 永远 unmeasured（缺 readFile / runTest / writeFile）
 *     completion.backtest  ⇒ 永远 unmeasured（缺 baseline / coverage / 执行器）
 *     completion.r5        ⇒ 永远 skipped（缺 newTestFiles ⇒ appliesTo 为假）
 *
 * ⇒ 后果不是"少测了一点"，而是**每一次 completed 都会被拒**：一个永远无法测成的
 *   判据等于一道永远关着的门。补齐注入面才是修它 —— **绝不能靠放宽判据**。
 *
 * ★ 注入的边界（这一节的全部纪律）：
 *   · 判据不 import I/O；这里（tools.ts）是唯一做 I/O 的地方。
 *   · 拿不到证据时**不注入该字段**（而不是注入一个空值）—— 缺席 ⇒ 判据说
 *     "我没能测量"，那是诚实的；注入空值会让判据把"没数据"读成"测了是零"。
 */

/**
 * ★ 任务 → 它的隔离检出基准（worktree 的 `base`）。
 *
 * 为什么是【进程内】而不是写进 TeamTask：`base` 是【这一次派发】的属性，不是任务的
 * 持久契约的一部分；把它落进 team.json 会让一个派生事实变成需要维护的状态
 * （而它随时可以由 git 重算）。与 scheduler 的 `parkedAttempts` 同一形态。
 *
 * ★ 缺席 ⇒ 不注入 `parentRevision` / `baseline` ⇒ r5 与 backtest 诚实地说
 *   "我没能测量"。**不会**回退成 `HEAD` 或任何猜测出来的版本 —— 一个伪造的基准
 *   会让"在错误的基础上比较"读成"比较过了"。
 */

/** 派发时登记基准；判据层在完成时读它。 */
export function rememberWorktreeBase(taskId: string, base: string): void {
  taskWorktreeBase.set(taskId, base)
}

/**
 * ── ★★ 把父版本落进耐久态（t18）─────────────────────────────────────────────────
 *
 * 与 {@link rememberWorktreeBase}（内存）是**同一次派发的两个去处**，而不是两份真相：
 * 值是同一个 `base`，只是「内存那份最新鲜、落盘那份最持久」。
 *
 * ★ 为什么要落盘：内存 Map 在进程重启后清空，而"改动发生【之前】的版本是什么"
 *   在改动发生之后就**再也推不出来**了（HEAD 已经含了改动）⇒ 那个事实只能记下来。
 *
 * ★ 为什么要查 workspace 下**所有**团队：`onWorktree` 的回调只拿到 `taskId`，
 *   而任务属于某个团队。团队目录在 `stateDir` 之下 ⇒ 逐个看。
 *   ★ 代价说清楚：任务数少（一个团队几十条），而这一步发生在**派发时刻**
 *     （不是每次调用），所以这个扫法是可接受的。
 */
async function persistTaskBaseRevision(taskId: string, base: string): Promise<void> {
  const root = STATE_DIR_FOR_BASE_PERSIST
  if (root === undefined) return
  const { readdir } = await import('node:fs/promises')
  let teamIds: string[]
  try {
    teamIds = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    /** 目录还不存在（第一个团队尚未落盘）⇒ 没有可写的目标，静默返回（内存那份仍在）。 */
    return
  }
  for (const teamId of teamIds) {
    await withTeamLock(teamLockKey(root, teamId), async () => {
      const fresh = await readTeam(root, teamId)
      if (fresh === undefined) return
      const task = fresh.tasks.find((candidate) => candidate.id === taskId)
      if (task === undefined) return
      /**
       * ★ 用**记录写入**而不是直接 `task.baseRevision = …`：`TeamTask` 的接口声明在
       *   `src/types.ts`，而它**不在本任务的 inScope 里**（outOfScope 明确列了
       *   `src/gates/`、`src/scheduler.ts`、`src/quality-gates.ts`；types 同样不该
       *   被顺手改动）。⇒ 这里按"耐久态是一个 JSON 记录"来写。
       *   ★ 代价如实说明：这个字段**没有类型检查**兜底；它的形状由
       *     `scripts/gate-backtest.test.mjs` 的臂与 `hasValidQualityTaskFields`
       *     的宽容度共同保证（后者不拒绝未知字段，所以它会被原样存下来）。
       */
      const record = task as unknown as Record<string, unknown>
      if (record['baseRevision'] === base) return
      record['baseRevision'] = base
      task.updatedAt = Date.now()
      await writeTeam(root, fresh)
    })
  }
}

/**
 * ★ `persistTaskBaseRevision` 需要知道 `stateDir` 的**绝对路径**，而 `onWorktree`
 *   的回调签名里没有它 ⇒ 在 `registerAgentTeamsTools` 装配时记一个模块级引用。
 *
 * ★ 为什么用模块级变量而不是改 `SchedulerConfig` 的签名：改签名要动
 *   `src/scheduler.ts`（本任务 **outOfScope**）。⇒ 代价如实说明：进程内只会有
 *   一个已装配的插件实例（本插件的既有约定），而这个变量只被 `onWorktree` 读。
 */
let STATE_DIR_FOR_BASE_PERSIST: string | undefined

/** 取该任务的基准；没有就返回 undefined（**不是** HEAD，也不是空串）。 */

/**
 * ── ★★ 父版本的解析：内存 → 落盘 → 明确说"没有"（t18）─────────────────────────────
 *
 * MEASURED（point-dev 定位；无 worktree 的任务恒不可收口）：`baseline` 原本只由
 * {@link worktreeBaseOf} 推 —— 一个**内存 Map**，只在派发建出 worktree 时写入。
 * ⇒ 两类任务恒拿不到父版本，而它们是**不同的两件事**：
 *
 *   (i)  **没有 worktree**（在主树干活的、captain 接管的）⇒ 从未登记过；
 *   (ii) **进程重启** ⇒ 内存 Map 清空（★ 与"旧模块"同族）。
 *
 * ── 解析顺序（captain 裁定 C+D）────────────────────────────────────────────────
 *
 *   ① 内存里有 ⇒ 用它（派发那一刻亲眼拿到的，最新鲜）；
 *   ② 内存里没有、但任务记录里有 `baseRevision` ⇒ 用它（C：**记下来的事实**）；
 *   ③ 两者都没有 ⇒ 返回 `absent`，且**带上成因**（D：明确说"没有"，不猜一个）。
 *
 * ★ 为什么 ③ 必须带成因、且两种成因不同形：
 *   本队纪律「unmeasured 的不同成因不应同形」。`no-worktree` 是"**这类任务本就
 *   没有父版本可归因**"（无隔离 ⇒ 无从比较）；`not-recorded` 是"**我本该有却丢了**"
 *   （进程重启 / 内存态丢失）。前者接近"不适用"，后者是一条**要去看一眼的信号** ——
 *   合成一个 undefined，读日志的人分不出"设计如此"与"我们丢了一个事实"。
 *
 * ★ 绝不回退成 HEAD：HEAD 可能**已经含了本次改动** ⇒ "改动前"与"改动后"同版本
 *   ⇒ 回测恒绿（本队记账的恒真写法）。伪造的基准会让"在错误的基础上比较"
 *   读成"比较过了"。
 */


/**
 * ★ 在一个【干净的、指定版本】的检出里跑一条命令，交回退出码。
 *
 * 为什么用临时 `git worktree` 而不是在原地 `git checkout <rev>`：
 *   · 成员的工作区通常是**脏的**（它刚改过文件）⇒ `git checkout` 直接拒绝，
 *     于是退出码变成"跑不起来"，而判据会（正确地）说"我没能测量"——
 *     一次**基础设施失败**会被读成"这个版本上没跑"，两者不同形，必须避免。
 *   · 原地切换还可能把成员的改动弄丢。
 * ⇒ 检出一个干净副本去跑，跑完删掉。
 *
 * ★ 拿不到退出码就返回 `undefined`，**不返回 0**：0 意味着"这个版本上是通过的"，
 *   而那是一个关于工作的结论；跑不起来不能伪装成它。
 */

/**
 * ── ★ 回测的依赖图 / 覆盖数据：从【真实 import】推出来 ──────────────────────────
 *
 * 回测的 L2 要求"选测器不能隐藏自身近似性"，所以它不采信选测器自报的 `selection`，
 * 只采信 `coverage`。那段数据**必须是真的** —— 一个编出来的图正是这条判据要抓的
 * 那种"隐藏自身近似性的选择器"，用它喂判据等于让判据给自己发通行证。
 *
 * ⇒ 这里读工作区里真实的测试文件与源码文件，用 `import ... from '…'` 语句建图：
 *
 *     coverage[源文件] = [覆盖它的测试文件…]
 *     dependents[源文件] = [直接 import 它的文件…]（判据自己会算传递闭包）
 *
 * ★ 拿不到（不是 git 仓库、读不到文件…）⇒ 返回 `undefined` ⇒ **不注入** ⇒ 判据
 *   说"没有依赖图数据"。**绝不**返回一个空图：空图会让"选了 0 条"与"选对了"
 *   在判据层同形，而那正是它存在的理由。
 */

/**
 * 读一个 workspace 相对文件。抛错 ⇒ 调用方不注入该字段 ⇒ 判据 unmeasured。 */
async function readWorkspaceFile(workspace: string, relativePath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return await readFile(join(workspace, relativePath), 'utf8')
}

/**
 * 跑一条命令并【捕获输出】。变异判据要从输出里解析测试摘要（`# pass 3` / `ℹ pass 3`），
 * 只有退出码是不够的 —— 退出码说得清"红/绿"，说不清"跑了几条、过了几条"，
 * 而杀手套件的杀伤率正是后者的函数。
 *
 * ★ 输出上限 256 KiB 且保留【尾部】：摘要行在尾部，截头部会让它消失。
 */

/**
 * 同步读一个 workspace 相对文件（变异判据的 `readFile` 契约是同步的）。
 * 抛错 ⇒ 判据内部按 unmeasured 处理；这里【不】吞掉它，也不返回空串 ——
 * 返回空串会让"读不到"伪装成"文件是空的"。
 */

/**
 * 同步写一个 workspace 相对文件（变异判据的 `writeFile` 契约是同步的）。
 * ★ 只有变异判据用它，而它写的是【它自己刚读过的那个文件的变异体】，随后会还原；
 *   拒绝越界路径（`..` / 绝对路径）—— 与 worktree.ts 的 `guardedWrite` 同一条纪律。
 */

/**
 * 从改动文件推出扫描目录。
 *
 * ★ 这是 r5 的 `scanDirs`：它决定"去哪找测试文件"。推不出来（没有改动文件）
 *   ⇒ 返回 undefined ⇒ 不注入 ⇒ 判据 unmeasured，而不是注入一个猜测出来的目录。
 */

/**
 * ★ `git diff --unified=0 <base>` 交出的【改动行号】（新文件侧）。
 *
 * 变异判据的 R1 是"只变异改动行范围"（见 mutation.ts 文件头）。它需要离散行号，
 * 而这不是能从 `changedPaths` 推出来的东西 —— 一个文件"被改了"不等于知道"哪几行"。
 * ⇒ 在这里用 git 问出来；缺席 ⇒ 该字段不注入 ⇒ 判据 unmeasured
 *   （★ 绝不退回全文件变异：那会把无关区域算进分母而扭曲分数）。
 *
 * 拿不到 base 时返回 undefined（**不是** []）：`[]` 会被判据读成"测了，确实没有
 * 可变异行"，而事实是"没能测量"—— 两者不同形，与 changedPaths 的 `undefined` vs `[]` 同源。
 */

/**
 * 把判据层重跑的 CommandResult 并回成员提交的数组：同名命令以重跑为准
 * （exitCode 是判据层亲眼看到的），其余条目保留。
 */

/** Resolved absolute state root. */

/** Process-local lock key scoped by workspace state root and team id. */

/** Process-local lock key enforcing one active team per captain session. */

/** The team this captain currently leads, or a loud failure. */

/** The team this captain or active member currently participates in. */


/** Re-derive a caller's role from fresh state while holding the team lock. */

/** Fresh state for a team that still exists; never falls back to stale lookup data. */

/** Fresh state with captain authorization rechecked inside the lock. */

/** Fresh state and caller identity rechecked inside the lock. */

/** Look up one live (non-removed) member by display name. */

/** Look up one task by id. */

function requireStagedTeam(team: TeamState): void {
  if (team.phase !== 'staged') {
    throw new Error(`team "${team.name}" is already running; its plan can no longer be edited`)
  }
  if (team.halted === true) throw new Error(`team "${team.name}" is halted, not awaiting plan approval`)
}


/** Validate references and cycles before a staged graph can be saved or run. */
function validateStagedGraph(team: TeamState, requireRunnable: boolean): void {
  const members = team.members.filter((member) => member.status !== 'removed')
  if (requireRunnable && members.length === 0) throw new Error('add at least one member before approving the plan')
  if (requireRunnable && team.tasks.length === 0) throw new Error('add at least one task before approving the plan')
  const memberNames = new Set(members.map((member) => member.name))
  const taskIds = new Set(team.tasks.map((task) => task.id))
  for (const task of team.tasks) {
    if (task.subject.trim() === '') throw new Error(`task "${task.id}" must have a subject`)
    if (task.assignee !== undefined && task.assignee !== CAPTAIN_KEY && !memberNames.has(task.assignee)) {
      throw new Error(`task "${task.id}" assignee "${task.assignee}" is not an active member`)
    }
    for (const dependency of task.dependencies) {
      if (dependency === task.id) throw new Error(`task "${task.id}" cannot depend on itself`)
      if (!taskIds.has(dependency)) throw new Error(`task "${task.id}" depends on unknown task "${dependency}"`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(team.tasks.map((task) => [task.id, task]))
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) throw new Error(`task dependency graph contains a cycle at "${taskId}"`)
    if (visited.has(taskId)) return
    visiting.add(taskId)
    for (const dependency of byId.get(taskId)?.dependencies ?? []) visit(dependency)
    visiting.delete(taskId)
    visited.add(taskId)
  }
  for (const task of team.tasks) visit(task.id)
}



/** Captain work is immediate, not a durable scheduler lane: allow one unfinished takeover at a time. */

/** Stop every currently-resident member activation for one halted team.
 *
 * Interrupt requests only cancel the member's current model turn and retain its
 * activation. Draining the selected direct children is the stronger lifecycle
 * boundary: it waits for the activation handles to release, so a child cannot
 * keep executing after the captain-chat Stop control has reported success.
 */

export async function haltTeamWork(input: {
  ctx: Context
  stateRoot: string
  teamId: string
  captain: Agent
  signal?: AbortSignal
}): Promise<{ teamName: string; cancelledTasks: number; alreadyHalted: boolean }> {
  const halted = await withTeamLock(teamLockKey(input.stateRoot, input.teamId), async () => {
    const fresh = await requireFreshCaptainTeam(input.stateRoot, input.teamId, input.captain.id)
    if (fresh.halted === true) {
      return {
        teamName: fresh.name,
        cancelledTasks: fresh.tasks.filter((task) => task.status === 'cancelled').length,
        alreadyHalted: true,
        members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
      }
    }
    const now = Date.now()
    let cancelledTasks = 0
    for (const task of fresh.tasks) {
      if (TERMINAL_TASK_STATUSES.includes(task.status)) continue
      cancelUnfinishedTask(task, 'Stopped from the captain chat.')
      cancelledTasks += 1
    }
    for (const member of fresh.members) {
      if (member.status === 'removed') continue
      member.status = 'idle'
    }
    fresh.halted = true
    fresh.haltedAt = now
    await writeTeam(input.stateRoot, fresh)
    appendTeamEvent(input.ctx, captainSessionOf(input.ctx, fresh.captainSessionId, input.captain.session), 'agent-teams/team-halted', {
      teamId: fresh.id,
      cancelledTasks,
    })
    return {
      teamName: fresh.name,
      cancelledTasks,
      alreadyHalted: false,
      members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
    }
  })
  // Persist the stop boundary first, then abort the Captain before draining
  // children. Otherwise its current model turn can observe `halted`, call
  // resume, and race the still-running HTTP stop request.
  input.captain.cancel({ kind: 'user' }, { keepInbox: true })
  await stopTeamMemberActivations(input.ctx, input.captain, halted.members, input.signal)
  // Interrupting a child emits a trailing subagent-settled notification. That
  // notification can start a fresh Captain turn after the first cancellation,
  // so close the stop boundary again once every child activation has drained.
  // Queued user input is preserved both times; only runtime-generated work is
  // prevented from silently resuming the halted team.
  input.captain.cancel({ kind: 'user' }, { keepInbox: true })
  return {
    teamName: halted.teamName,
    cancelledTasks: halted.cancelledTasks,
    alreadyHalted: halted.alreadyHalted,
  }
}

/** Web approval has no tool result in the captain's conversation. */
export function stagedPlanApprovedContext(teamName: string): string {
  return [
    `The user approved the staged AgentTeams plan "${teamName}" from the pre-run review UI.`,
    'Approval has committed; the scheduler owns dispatch of the approved team. Do not approve again, recreate the roster, or send messages merely to start assigned tasks.',
    'Acknowledge the approval and handle any reports or user work already pending. Yield only when waiting for members is the remaining action. Their reports will wake you automatically; do not busy-poll status or keep a turn running just to wait.',
    'On a report, inspect the result and coordinate the next necessary action. If work has since been halted, respect that state and resume only on an explicit user request.',
  ].join('\n')
}

/** Context queued after the human rejects a staged plan. */
export function stagedPlanDiscardContext(teamName: string): string {
  return [
    `The user discarded the staged AgentTeams plan "${teamName}" from the pre-run review UI.`,
    'That decision is final for this draft: it has been archived, no members were created, and no tasks may run.',
    'Do not call agent_teams_create, agent_teams_approve, or recreate a replacement team merely because the old team is no longer active.',
    'Wait for a later explicit user request. If the next user message is unrelated to AgentTeams, answer it normally and do not start a team.',
  ].join('\n')
}

/** Model-facing continuation that turns the review UI back into a conversation. */
export function stagedPlanFeedbackContext(teamName: string): string {
  return [
    `The user selected "Return to chat and revise" for the staged AgentTeams plan "${teamName}".`,
    'The existing staged plan is still the only draft. Do not create a replacement team, approve it, spawn members, edit the plan, or start work in this turn.',
    'Ask the user one concise, concrete question about what they want changed, then stop and wait for their answer.',
    'After the user answers, revise this same staged roster and DAG with one atomic agent_teams_edit_plan call, summarize the changes, and ask the user to review the updated plan again.',
  ].join('\n')
}

/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
/**
 * ── ★ runtime 位置：每一条裁决的【运行记录】（进程内，跨步骤）───────────────────
 *
 * `runtime` 是【过程】的插入点，不是一步的裁决（契约 §5）：它的产物是"记录"，
 * 供控制台与交付时判读；它**不得拒绝任务**。本文件里它有一个统一出口
 * {@link recordRuntimeGates}，被派发、建任务、改契约、成员汇报、状态快照五处调用 ——
 * 于是"这个进程里这些事发生过"这件事，与判据层是同一份记录。
 *
 * ★ 为什么必须有个上限：这个 Map 是进程级状态，一次长会话里成员每次汇报都推进去
 *   一条。无上限的增长是一种"只在最长的那些会话里出现"的缺陷 —— 最难复现，也最难
 *   归因。保留最近 {@link RUNTIME_GATE_LOG_LIMIT} 条，够控制台与交付时判读。
 *
 * ★ 为什么不是"写进 team.json"：运行记录是【这一次运行】的属性，不是团队契约的一
 *   部分（与 `taskWorktreeBase` 同一形态）。落盘会让一个派生事实变成需要维护和
 *   迁移的状态。
 */

/**
 * ── ★★ 「本进程持有的模块是不是旧的」—— 一个**可检测、可上报**的读数（t23）────────
 *
 * ── 它修的是什么（MEASURED，本轮五次拦截）──────────────────────────────────────
 *
 * 本队今晚被同一个东西拦了 **5 次**（t14 / t17 / t19 / t22 / t23 开工），而每一次
 * 的**表面理由都不同**：
 *
 *     · dispatch.changed-paths 说"你虚报改动"
 *     · completion.backtest    说"基准不可得"
 *     · claim_task             说"依赖未满足"
 *
 * ⇒ 而真相只有一个：**进程加载的是构建前的模块**。
 *   ★ 形态：**一个机制级的失效，伪装成一条业务规则**。成员看到判据拒绝会去查代码、
 *     去查数据、去怀疑自己的申报 —— 而不是去重载。这个伪装是它最贵的地方：
 *     它把成本从"重载一次"转成了"每一轮都重新误诊一次"。
 *
 * ── 为什么 ESM 让这件事必然发生（机制级解释，不是现象描述）───────────────────────
 *
 * `import { f } from './state.ts'` 建立的是**命名绑定**，它在**模块求值时**建立，
 * 之后**永远指向同一个函数对象**。⇒ 盘上的 `.js` 被 `pnpm build` 覆盖之后，
 * 进程里那个函数**还是旧的** —— 因为函数的**闭包环境**也是旧的。
 *
 * ★ 所以"每次调用时求值"这句话**不精确**：函数体确实每次跑，但它**本身**是从旧模块
 *   实例拿来的。⇒ **任何静态 import 的东西都不会更新**，不只是 schema 类。
 *
 * ── 本读数回答什么、不回答什么（边界必须写清）──────────────────────────────────
 *
 *   回答：**该不该重载**（stamp 不一致 ⇒ 重载）。
 *   **不**回答：哪一段是旧的。
 *      （后者需要模块图内省，做不干净；而 5 次拦截里真正需要的判断是前者。）
 *   ★ 已知边界：即使 stamp 一致，也可能有段落是旧的（见上面对 ESM 的解释）。
 *     这一格**测不了** —— 把它写成边界，而不是假装覆盖了它（本队纪律）。
 *
 * ── ★ 三态，且「读不到」与「一致」必须不同形 ────────────────────────────────────
 *
 *   `unknown`     —— 读不到 stamp（还没 build / 文件被删 / 解析失败）⇒ **没能测量**
 *   `current`     —— 读到了，且与加载时一致
 *   `stale`       —— 读到了，且与加载时**不一致** ⇒ 明确报"请重载"
 *
 * ★ 把 `unknown` 读成 `current` 会让"我没能检查"伪装成"检查过了，是新的" ——
 *   而那正是本任务要消灭的那个形态的又一次出现。
 */

/** 构建产物的指纹文件（`scripts/git-artifacts.mjs` 写的那一份）。 */

/** 读盘上当前的 stamp 的 `output` 摘要；拿不到 ⇒ `undefined`（**不是**空串）。 */

/**
 * 插件根目录 —— 与 `STATE_DIR_FOR_BASE_PERSIST` 同一种做法（`__dirname` 的上两级）。
 *
 * ★ 为什么不用 `process.cwd()`：插件的产物位置与**用户的工作目录**无关，
 *   而 stamp 在插件的 `lib/` 里。用 cwd 会在"用户在别处起会话"时读错地方，
 *   而那会**静默**把 `unknown` 变成常态（于是这条读数永远不报）。
 */

/** 加载时记下的 output 摘要（**进程级、只在模块求值时写一次** —— 这正是被检测的对象）。 */

/**
 * 读一次**加载时**的 stamp。
 *
 * ★ 它必须**只做一次**：这个函数的返回值代表"这个进程当初加载的是什么"，
 *   而那不是每次调用都该重新问的问题 —— 重复读会把它变成"每次调用时的读数"，
 *   于是**它永远与盘上一致**，这条检测就恒为 `current`（本队记账的恒真写法）。
 */

/**
 * 这个进程持有的模块是新的还是旧的。
 *
 * ★ **不参与裁决**：它是部署状态的读数，判据不许因为它拒绝（先软后硬）。
 *   调用方把它挂在**记录**上（人读得到），而不是并进 `blockers`。
 */

/**
 * 一句人话（供工具记录与控制台读）。
 *
 * ★ 措辞必须**不用**业务语气：不能读起来像"你的申报有问题"。
 *   它要说的是"**这个进程该重载了**" —— 那正是它要消灭的那个伪装。
 */

/**
 * ── ★★ 附在【每一次拒绝】上的那一行（t37 / f-0027 的预防）───────────────────────
 *
 * 与 {@link moduleFreshnessMessage} 分开，只因为它要带一个**前缀**：拒绝信息里那一行
 * 必须一眼看出"它是关于**部署状态**的"，而不是关于这次调用本身。
 * ★ 而正文一律来自 `moduleFreshnessMessage()` ——（本函数**不重写**那三态措辞）：
 *   两处各写一遍就会分叉，而分叉之后"同一件事有两句话"在下游同形。
 *
 * ★ 前缀刻意**不带业务语气**：它不能读起来像"你的申报有问题"。它要说的是
 *   「**你正在依据的这个进程可能不是你以为的那个**」—— 那正是 f-0027 的形状。
 *
 * ★ 为什么放在 `throwWithSurface`（而不是每个调用点各加一次）：
 *   那是**唯一的**拒绝出口。放在那里 ⇒ 六处调用点自动都有，而不会出现
 *   "某几处记得加、另几处忘了"（本队记账的"逐格手接 ⇒ 第 6 次一定来"）。
 */

/**
 * ── ★★ 重载的【仲裁闸门】（t24 / D）──────────────────────────────────────────────
 *
 * ── 它是什么、不是什么（用户裁定的框架，原话）──────────────────────────────────
 *
 *   「我们在做代码修改的时候，应该已经跑过这种蓝绿判决了。所以最后在需要仲裁的时候，
 *     判决其实已经跑完了，只是需要进行仲裁。在这种情况下，**确实只需要检测任务情况
 *     就行了**。」
 *
 * ⇒ 它是**仲裁**，不是**状态检查**：
 *     · **不**重新验证"新代码对不对" —— 那是**蓝绿判决**（`pnpm verify exit=0`）
 *       已经给出结论的事。在这里重跑一遍会让"判决"有两个来源，而两个来源会分叉。
 *     · **只**回答一件事：**此刻重载会不会打断正在进行的工作**。
 *
 * ── 两个前置，缺一不可 ─────────────────────────────────────────────────────────
 *
 *   ① `verdict: 'passed'` —— 有一份【已经通过的判决】。它的**形状**是一个布尔，
 *      而不是"我这里再跑一次测试"：本函数**不做 I/O**，判决由调用方交进来。
 *   ② `tasks` 里**没有 `in_progress`** —— 判定 = 每条任务要么终态、要么未开工。
 *
 * ── ★ 为什么"无 in_progress"这个口径是对的（而不是"无未完成任务"）──────────────
 *
 *   `pending` / `claimed` 的任务**没有正在跑的成员**：前者还没开工，后者只是被认领。
 *   重载会 dispose 插件，但**不会**杀掉成员会话（它们是宿主的 subagent），
 *   而插件重新激活时会重新调度。
 *   ⇒ 把它们也算作"会被打断"，会让闸门在**任何有任务的团队**上恒不满足 ——
 *     而那是"闸门永不打开"，与"没有闸门"在无人值守下同效（都需要人来）。
 *
 *   ★ 而 `in_progress` 是**真的有工作在跑**：那一刻 dispose 会让它失去插件的记录面。
 *     这一格必须挡住。
 *
 * ── ★ 这个读数**不参与判据裁决**，但它**参与一个动作的准入** ─────────────────────
 *
 *   与 `moduleFreshness` 不同：那一个是纯诊断；本函数是**一次动作的闸门**。
 *   ⇒ 它必须能说"不"，而说"不"时必须说清**是哪一条前置不满足**（三态可读）。
 */

/**
 * 仲裁：这一刻能不能重载。
 *
 * ★ **纯函数、零 I/O** —— 与判据层同一条纪律（`docs/GATE-REGISTRY.md` §2 性质 1）。
 *   "判决跑过了吗"由调用方回答（它才是真的跑过的那个），"有没有工作在跑"由调用方
 *   从耐久态读出来。本函数只做**判定**。
 */

/**
 * 一句人话（供工具结果与控制台读）。
 *
 * ★ 三态措辞必须**互不同形**：说清"能不能"、以及"不能的是哪一条"。
 */

/**
 * ── ★ 逃生口（f-0021 的闭环）─────────────────────────────────────────────────────
 *
 * MEASURED（point-dev 与 integrator6 从相反方向独立得出）：
 *
 *     旧模块 ⇒ 任务开不了工 ⇒ 任务做不完 ⇒ 一直有"进行中工作"
 *           ⇒ 闸门（无进行中工作）永不满足 ⇒ 永远重载不了 ⇒ 旧模块永不被换掉
 *
 * ⇒ 这是一个**互相锁死的一对**，而它意味着：无人值守在**没有外部干预**时
 *   【证明性地】无法自行解锁（只有用户手动重启）。
 *
 * ★ 用户的裁定：闸门需要一个**逃生口** —— 在"整条链都冻住"时仍能重载。
 * ★ 而它的**边界**是一个显式的、可关的开关（下面这个环境变量），
 *   **不是**把闸门悄悄放宽：默认关闭，打开时才生效，且**每一次使用都被记录**。
 *
 * ★ 为什么用环境变量而不是一个参数：与 `AGENT_TEAMS_OBSERVE_GATES` 同一条纪律
 *   （见注册表 §3.5）—— 关掉/打开它不该需要改代码，而改代码会带来
 *   "漏了 build ⇒ 装的位置跑的是旧代码"那条窗口（本队实测过，而且今晚正是它）。
 */

/** 逃生口是不是开着（**只读到字面量 `1`**；空串/其它值一律 = 关）。 */

/**
 * 带逃生口的仲裁：**闸门不变，只在它关闭时说清"还有一条路"**。
 *
 * ★ 它的语义是刻意的：逃生口**不改变判定**（`allowed` 仍由 {@link arbitrateRestart}
 *   给出），它只是把"明知有工作在跑仍然重载"变成一次**显式的、被记录的动作**。
 *   ⇒ 于是"闸门挡住了"与"我用逃生口过去了"在读数上**不同形**。
 */


/** 记一条运行记录（供 {@link evaluateRuntimeGates} 与夹具共用）。 */

/** 运行记录的快照（控制台/夹具读它；返回副本，调用方改不动内部状态）。 */
export function runtimeGateLogSnapshot(): ReadonlyArray<{ at: number; event: string; outcome: string }> {
  return runtimeGateLog.map((entry) => ({ ...entry }))
}

/**
 * 等待记录的快照（控制台/夹具读它；返回**深**副本）。
 *
 * ★ 与 {@link runtimeGateLogSnapshot} 同形态，理由也同：进程级状态必须有只读出口，
 *   否则夹具只能通过"跑一次探活、看它说了什么"来间接推断内部状态 —— 而那正是
 *   最容易被夹具自己写错的一层（"我以为它在记录里"与"记录里真的有"同形）。
 */
export function waitRecordSnapshot(): ReadonlyArray<{
  teamId: string
  taskId: string
  memberName: string
  attemptId: string
  startedAt: number
  lastActivityAt?: number
  lastPollAt?: number
  lastPolledActivityAt?: number
  lastOutputKey?: string
  activityCount: number
}> {
  return [...waitRecords.values()].map((record) => ({ ...record }))
}

/**
 * 等待**窗口**的快照（与 `waitRecordSnapshot` 同形态：进程级状态必须有只读出口）。
 *
 * ★ 它回答的是"这个任务这一次等待从哪里开始、上次何时被探活" —— 与记录表
 *   （"这一代读到过什么"）是**两个作用域**。夹具要分辨"换代没重置窗口"，
 *   唯一的办法就是把这两张表都读出来。
 */
export function waitWindowSnapshot(): ReadonlyArray<{
  teamId: string
  taskId: string
  memberName: string
  startedAt: number
  lastPollAt?: number
  lastPolledActivityAt?: number
  touchedAt: number
}> {
  return [...waitWindows.values()].map((window) => ({ ...window }))
}

/** 清空等待记录（★ 只给夹具用：进程级状态会跨用例残留，而残留会让"第一次探活"变形）。 */
export function resetWaitRecords(): void {
  waitRecords.clear()
  waitWindows.clear()
}

/**
 * ── ★★ runtime 位置的第一条判据（探活）需要的【输入面】─────────────────────────
 *
 * 契约 §5 给 `runtime` 举的例子是「在成员被派发时启动计时器；超时 ⇒ 记录」。而
 * 判据层要问的第一个问题是："这个成员【等了多久】，以及它【还在动吗】"。
 *
 * MEASURED（2026-10-06，开工前实测）：这两个观察**在插件里都不存在**。
 *
 *   · `ctx` 有 `{task, update, updateGate, …}`，**没有**"等了多久"；
 *   · 源码里 grep 不到 `startedAt` / `dispatchedAt`；
 *   · `onDispatched` 的 payload 有 taskId/attempt/attemptId/worktreePath，**没有时间戳**。
 *
 * ⇒ 判据接进来 ≠ 它的输入接进来。这就是本队反复踩过的那个形态（本轮之前已在
 *   `inScope` / `verify` / 执行器上踩了三次），所以输入面与判据是两次改动。
 *
 * ── ★ 为什么需要【一份记录】，而不是一个局部变量 ──────────────────────────────
 *
 * 最省事的写法是在 `onDispatched` 里记一个数、然后……给谁呢？`onDispatched` 是
 * **调度器**的回调，它只覆盖六个调用点里的**一个**（`member-dispatched`）。
 * 其余五个（task-created / task-update / task-update-settled / task-status /
 * delivery-declared）各建各的求值面 —— 一个记在闭包里的局部变量，它们**一个都看不见**。
 *
 * ⇒ 那五处要带 `wait` 的话，只能现编一个"起点 = 现在"。那就是**伪造一个时刻**。
 *   这正是契约 §5 说 `runtime` "**可以带状态**"的落点：跨步骤的过程约束，它的
 *   观察必须活得比一个步骤长。
 *
 * ── ★ 键是 attemptId，不是 taskId ─────────────────────────────────────────────
 *
 * 一次重派发会换 `attemptId`（`beginTaskAttempt`）⇒ 那是**新的一次等待**。
 * 用 `taskId` 做键，reassign 之后旧的 `startedAt` 会留在原地，判据读到的等待时长
 * 是**上一代尝试**的 —— 与"把失败归给一个从未发生的事件"同源（t6 已经为派发
 * 事件吃过一次：投递失败不算派发）。用 attemptId 做键，这件事在**形状上**不可能发生。
 *
 * ── ★ 有限、且不落盘 ─────────────────────────────────────────────────────────
 *
 * 与 {@link runtimeGateLog} 同形态：进程内、有上限、不写进 team.json。
 * "这一次运行里等过哪些成员"是**运行**的属性，不是团队契约的一部分；落盘会让一个
 * 派生事实变成需要维护和迁移的状态（与 `taskWorktreeBase` 同一判断）。
 */

/**
 * 一条等待记录：**"这个尝试等了多久"的观察**。
 *
 * ★ 三个字段的语义必须分开，因为它们各自能独立地缺席：
 *   · `startedAt`      —— 派发被接受的那一刻。**没有它就没有等待起点。**
 *   · `lastActivityAt` —— **观察到产出**的那一刻（不是事件自带的时间戳，见下）。
 *   · `lastPollAt`     —— 上一次把这份记录交给判据（探活）的时刻。
 */

/**
 * 进程内的等待记录表：`attemptId` → 记录。
 *
 * ★ 用 `Map` 的顺序当 LRU 用（`Map` 保证插入顺序，重插一个键不会换位置，所以
 *   更新时要先删再插）—— 有上限的进程级状态必须能淘汰，否则它就是一个"只在最长
 *   的那些会话里出现"的缺陷。
 */

/**
 * ── ★ V3-2（收口）：任务作用域的**等待窗口簿** ────────────────────────────────
 *
 * 键 `teamId + '\u0000' + taskId` → 这个任务**这一次开工**的窗口。
 *
 * ── 为什么需要它（而不是从记录表里"找上一代")────────────────────────────────
 *
 * MEASURED（2026-10-06）：`agent_teams_status` 在**同一次调用**里先 `kickTeam`
 * （换代）再求值（探活）。所以换代那一刻，上一代记录**也正要在同一次调用里**
 * 被戳上 `lastPollAt = now` —— 从记录表里读"上一代的戳"，读到的究竟是
 * 换代前还是换代后的值，取决于两者的先后顺序，而那是一个**说不清的口径**。
 * 我为此试过三种写法（继承戳 / 首次交接不写戳 / 出生即不写戳），每一种都是
 * 修好一条臂、弄红另一条 —— 因为它们都在同一个含糊的读法上打转。
 *
 * ⇒ 正确的做法是**把窗口本身变成一等对象**：它不属于任何一代 attempt，
 *   于是"换代"与"探活戳"不再需要互相推断。记录（per-attempt）只用来回答
 *   "这一代读到过什么"，窗口簿（per-task）回答"这一次等待从何时开始、上次何时探的"。
 *
 * ── ★ 继承必须有界（队长本轮明确要求的边界，且这里逐条钉住）────────────────
 *
 *   · **键含 teamId**：不同团队里同名的 taskId 不能互借窗口；
 *   · **换成员即换窗口**：`memberName` 不同 ⇒ 另一次等待（另一个人的命，不该
 *     继承前一个人的等待时长 —— 那会把"刚接手"读成"等了 40 分钟"）；
 *   · **任务进入终态即撤销**：`teamWaitObservations` 只喂未结束的任务，
 *     而 `forgetWaitWindow` 在任务离开未结束集合时被调用 ⇒ 窗口不再被继承；
 *   · **只继承"还活着"的窗口**：见 `claimWaitWindow` 的 `staleAfterMs` ——
 *     一个超过宽限期没有被任何探活碰过的窗口，不再会被下一代继承
 *     （否则"上一代已经结束的等待"会被当成还在跑，正是队长点出的那个风险）；
 *   · **LRU 上限**：与记录表同形态，进程级状态必须有界。
 */
/**
 * ── ★ 哪些事件是【一次探活】（V3-2 收口的最后一位）────────────────────────────
 *
 * 与判据层 `LIVENESS_EVENTS` 是**同一份成员**，但这里必须**独立地**写一遍：
 * 那一份是"判据该不该开口"，这一份是"调用方该不该推进探活戳" —— 两件事。
 * （判据层不 import 调用方，调用方也不 import 判据：契约 §2 性质 2 说的是
 * 判据之间不互调，而同一条分层纪律在这里同样适用。）
 *
 * ★ 只有 `task-status` 会在真实的 10 分钟节拍上反复发生 —— 用户裁定的
 *   "10 分钟探活一次"就发生在查状态时。`runtime-liveness` 是显式探活入口
 *   （夹具与将来的定时器用它），保留在名单里。
 */

/**
 * 一个窗口在多久没有被任何探活碰过之后，**不再被下一代继承**。
 *
 * ★ 取 3 个探活间隔（30 分钟）：正常的换代总是紧跟着探活（下一次 status 就会碰到它），
 *   所以真实路径上永远不会逼近这个界；而一个被遗忘的窗口（成员消失、任务悬停、
 *   记录被 LRU 淘汰）最迟 30 分钟后就再也继承不到 —— 于是"上一代已经结束的等待"
 *   不可能被无限期地当成还在跑。
 */
/**
 * 探活间隔的兜底值（与判据层的 `DEFAULT_LIVENESS_INTERVAL_MS` 同值）。
 *
 * ★ 这里**不 import 判据**（契约 §2 性质 2：判据之间不互相调用；反过来调用方
 *   直接 import 判据常量同样会把两层焊在一起）。这个数只用来给"窗口多久算陈旧"
 *   定一个界，它不参与任何裁决 —— 判据那边仍然自己持有它那份。
 */
const DEFAULT_PROBE_INTERVAL_MS_FALLBACK = 10 * 60_000
const WAIT_WINDOW_STALE_MS = 3 * DEFAULT_PROBE_INTERVAL_MS_FALLBACK


/** 窗口的键：队 + 任务 + 成员（★ 换成员即换窗口）。 */

/** 记一个等待窗口，并维持上限（与记录表同形态：有界的进程级状态）。 */

/**
 * 任务离开"未结束"集合时撤销它的窗口 —— **有界继承的最后一道**。
 *
 * ★ 队长点出的风险：*"否则上一代已经结束的等待会被当成还在跑"*。
 *   时间上的界（`WAIT_WINDOW_STALE_MS`）只能挡住"被遗忘的窗口"，
 *   挡不住"这个任务已经 completed/failed/cancelled，而它的窗口还新鲜"。
 *   ⇒ 终态是**语义上的界**，必须在任务真的结束那一刻把窗口撤掉。
 */

/** 记一条等待记录，并维持上限（最旧的先走）。 */

/**
 * ── ★ 调用点①：派发时刻（等待起点）────────────────────────────────────────────
 *
 * 与 t6 的 `onDispatched` **同形状**：不返回值、不改派发结果。它只往记录表里放
 * 一行"这个尝试从此刻开始等"。调度器不读它的返回值（`evaluateRuntimeGates` 的
 * 返回值在 tools.ts:1140 那里被 `void` 掉），所以 **runtime 位置仍然拒绝不了任务**。
 *
 * ★ 起点【不是】从 `attempt.attempt` 或 `task.updatedAt` 推出来的：那些是**别的
 *   用途的**时间戳（任务记录的最后修改），拿它们冒充"成员开始干活了"，会让探活
 *   把"队长刚改过任务描述"读成"成员刚开工"。
 */
function recordDispatchStart(event: {
  readonly teamId: string
  readonly taskId: string
  readonly memberName: string
  readonly attemptId: string
  /** ★ 这一次派发是第几代尝试（诊断用）。 */
  readonly attempt: number
  /** ★ 连续还是重来（见 {@link WaitWindow.continued}）。 */
  readonly continued: boolean
  readonly dispatchedAt: number
}): void {
  /**
   * ── ★ V3-2：换代时【继承】上一代的等待窗口起点 ────────────────────────────────
   *
   * 见 {@link WaitRecord.startedAt}。这里取的是"同一个 (team, task) 上最近一条
   * 记录"的起点：那一代与本代是**同一次等待**，只是 capability 被换掉了。
   *
   * ★ 只在起点**更早**时继承（`Math.min`）：一个更晚的起点会让窗口反而变短，
   *   而窗口是单调向前的（时间只会往前走）。用 `min` 让"继承"在任何到达顺序下
   *   都只可能延长窗口，不可能伪造出一个更早的过去。
   *
   * ★ 上一代**已经留了活动读数**时，一并继承 `lastActivityAt` / `lastOutputKey`：
   *   否则换代会让"它其实一直在动"这个已经观察到的事实凭空消失 ——
   *   那与"没观察到"同形，而探活正是靠这一点分辨卡死。
   */
  /**
   * ── ★ V3-2 收口：窗口用【任务作用域的簿】认领，不再从记录表里"找上一代" ────────
   *
   * 见 {@link waitWindows}。判定"这是不是同一次等待"的三个条件，逐条对应
   * 那条有界继承的边界：
   *   · 键里含 teamId / taskId / memberName ⇒ 换队、换任务、换成员都不会误借；
   *   · 窗口必须**还活着**（`touchedAt` 在 `WAIT_WINDOW_STALE_MS` 之内）
   *     ⇒ 一个已经结束/被遗忘的等待不会被下一代继承；
   *   · 窗口**只被认领一次**（认领即续命），于是"两个成员同时抢同一个窗口"不可能。
   */
  const key = waitWindowKey(event.teamId, event.taskId, event.memberName)
  const existing = waitWindows.get(key)
  /**
   * ★ 有界继承的**第三条界**：`attempt` 必须**没有跳号**（没跳 = 同一次等待的连续）。
   *   跳号 ⇒ 任务真的重来了 ⇒ 新窗口（这条与 t5 的臂 5 是同一件事）。
   */
  /**
   * ★ 连续 = 调度器说这是"给一个已经在等待的尝试补一次投递"（`continued`）。
   *   重来（`continued` 为假）⇒ 新窗口 —— 那条与 t5 的臂 5 是同一件事。
   */
  /**
   * ★ 上一代的产出指纹/计数：从中取（键与窗口同口径：队+任务+成员）。
   *   换代是**同一次等待**，所以"我看过它的哪一条输出"这件事跨代成立。
   */
  const previousRecord = [...waitRecords.values()]
    .filter((record) => record.teamId === event.teamId && record.taskId === event.taskId && record.memberName === event.memberName)
    .sort((a, b) => (b.lastPollAt ?? b.startedAt) - (a.lastPollAt ?? a.startedAt))[0]
  const previousOutputKey = previousRecord?.lastOutputKey
  const previousActivityCount = previousRecord?.activityCount ?? 0
  const continued = existing !== undefined && event.continued
  const alive = continued && event.dispatchedAt - existing.touchedAt <= WAIT_WINDOW_STALE_MS
  /**
   * ★ 起点取 `min`：窗口**只可能变长，不可能被伪造出一个更早的过去之外的形状**。
   *   一个更晚的起点会让"已等多久"缩水，而时间只会往前走。
   */
  const window: WaitWindow = {
    teamId: event.teamId,
    taskId: event.taskId,
    memberName: event.memberName,
    attempt: event.attempt,
    startedAt: alive ? Math.min(existing!.startedAt, event.dispatchedAt) : event.dispatchedAt,
    ...alive && existing!.lastPollAt !== undefined ? { lastPollAt: existing!.lastPollAt } : {},
    ...alive && existing!.lastPolledActivityAt !== undefined ? { lastPolledActivityAt: existing!.lastPolledActivityAt } : {},
    touchedAt: event.dispatchedAt,
  }
  putWaitWindow(key, window)
  /**
   * ── ★ 新记录**不**自带一个"刚观察过"的活动读数 ────────────────────────────────
   *
   * MEASURED：换代之后紧接着 `observeMemberActivity` 会跑一次（派发即观察），
   * 而它写的是"**现在**"——于是即使成员一句话都没说，新记录也会带上一个
   * 等于 `now` 的活动读数。判据下一次比较时看到"上一次读到的也是刚动过"
   * ⇒ **永远相等** ⇒ 静默成员不报警（或迟一次）。
   *
   * ⇒ 换代继承的是**上一代真的观察到的那个时刻**（窗口上的 `lastPolledActivityAt`
   *   或上一代记录的 `lastActivityAt`），而不是"现在"。这让"观察到产出"这件事
   *   只在**真的产出**时前进 —— 与"工具被调用不是产出"是同一条纪律。
   */
  const inheritedActivity = window.lastPolledActivityAt
  putWaitRecord({
    teamId: event.teamId,
    taskId: event.taskId,
    memberName: event.memberName,
    attemptId: event.attemptId,
    startedAt: window.startedAt,
    ...inheritedActivity === undefined ? {} : { lastActivityAt: inheritedActivity },
    /**
     * ── ★★ 产出指纹必须**跨代继承** —— 这是 V3-2 最后一位，也是整条链上最隐蔽的一处 ──
     *
     * MEASURED（2026-10-06，把窗口做成一等对象之后仍然差一格）：
     * `observeMemberActivity` 靠 `lastOutputKey` 判断"这条输出我是不是已经看过"
     * （`if (record.lastOutputKey === key) return false` —— 它不刷新活动时刻）。
     * 而换代产生的是**新记录**，那一代没有指纹 ⇒ 这条判断失效 ⇒ 派发时那次观察
     * **无条件**把 `lastActivityAt` 写成 `now`。
     *
     * ⇒ 后果：换代之后，探活读到的"最后活动时刻"永远是"刚刚"，
     *   于是「两次探活之间它动过没有」**永远相等** ⇒ 静默成员不报警
     *   （或只在换代停止之后才报一次）。这正是"迟一次探活"的根因，
     *   而它看起来完全不像缺陷 —— 观察是**合法**发生的，只是指纹丢了。
     *
     * ★ 与 `lastActivityAt` 一起继承是必须的：只继承时刻而不继承指纹，
     *   下一次观察仍会因为"没有指纹可比"而重新盖一次时间。
     */
    ...previousOutputKey === undefined ? {} : { lastOutputKey: previousOutputKey },
    activityCount: previousActivityCount,
  })
}

/**
 * ── ★ 调用点②：最后活动时刻（"它还在动吗"）─────────────────────────────────────
 *
 * 读法与 `observeMemberConvergence`（本文件 1030 行附近）**同源**：从该成员自己的
 * 会话日志里读 `assistant/message`。区别只有一处，而它是整件事的关键：
 *
 *     ★ 事件【不带时间戳】⇒ "什么时候说的"读不出来，
 *       必须【在观察到产出的那一刻，由我方取一次时钟】。
 *
 * ⇒ 所以本函数做两件事，且**顺序不能反**：
 *     1. 先读会话日志，看有没有 `assistant/message`；
 *     2. **只有真的看到了**，才向注入的时钟取一次时刻。
 *
 * ★ 反过来（先取时钟再看日志）会在"这次没看到产出"时白记一个时刻 —— 那会让
 *   "它没动"与"它刚动过"在记录里同形，而探活判据要分辨的正是这件事。
 *
 * ★ 三态与"记录 ≠ 观察"这条纪律（t12 的教训）：
 *   · 读到会话、且**看到了一条新的** `assistant/message` ⇒ 记下**当前时刻**
 *   · 读到会话、但一条都没有                      ⇒ **什么都不记**（"没观察到产出"，
 *                                                   不是"观察到零产出"）
 *   · 读不到会话（没有 live Agent / 日志炸了）    ⇒ **什么都不记**，且**不伪造**
 *
 * ── ★★ "看到输出"与"看到【新的】输出"不是一回事（这是本函数最容易写错的一处）──
 *
 * 成员会话里的 `assistant/message` **会一直留在那里**：它是一条历史日志。所以
 * 每次探活都"看得到输出" —— 若把"看得到"当成"它在动"，`lastActivityAt` 会随着
 * 每一次探活前进，于是"两次探活读数没变"**永远不成立**：
 *
 *     探活一次 ⇒ 读到历史输出 ⇒ 刷新时刻 ⇒ 看起来刚动过
 *     探活两次 ⇒ 同上         ⇒ 再刷新     ⇒ 看起来还是刚动过
 *     ⇒ **一个卡死的成员永远健康**，而这条判据**永远不报警**。
 *
 * ⇒ 所以记录里要留一个**已观察到的输出指纹**（`lastOutputKey`），只有指纹变了
 *   （＝真的又多了一条输出）才推进 `lastActivityAt`。这一位是判据能不能分辨
 *   "卡死"与"还在跑"的**全部**依据，而它必须落在记录里（跨步骤的状态）。
 *
 * ★ 指纹取"最后一条 assistant 消息的文本长度 + 条数"而不是全文：会话可以很长，
 *   而这里只需要分辨"有没有多一条"。★ 但它是**内容无关**的 —— 一个成员反复输出
 *   同样的话仍会推进（那是 `assistant/message` 条数变了），符合用户裁定的
 *   "以产出为准（有 assistant/message 才算在动）"。
 *
 * ★ 这三支的差别在于"有没有往记录里写一个时刻"，而不是在于返回值 —— 调用方
 * （`onDispatched` 与 `agent_teams_status`）都不需要读它。
 *
 * @returns 本次是否观察到了**新的**产出（供夹具与诊断使用；**不参与任何裁决**）。
 */

/**
 * 一个成员会话里【产出】的指纹：`undefined` 表示"没有可观察的产出"。
 *
 * ★ 与 `sessionSpokeWithContent` 同源、同一个读法，但回答的是不同问题：
 *   · `sessionSpokeWithContent` —— "它有没有说过非空的话"（布尔）
 *   · 本函数                   —— "**说的是哪一次**"（可比较的指纹）
 * 后者才是"最后活动时刻"能成立的前提：没有它，每次探活都会重新发现那条旧输出。
 */

/**
 * 读一个成员会话里【有没有非空的 assistant 输出】。
 *
 * ★ 与 `observedSpoke` 的关系：同源、不同问题。
 *   · `observedSpoke` 答"**最近一次**输出是不是空的"（收敛判据要的）；
 *   · 本函数答"**有没有过**输出"（探活要的）。
 *
 * 为什么探活不能直接复用 `observedSpoke`：它读的是**最后一条** assistant 消息，
 * 而"最后一条是空的"在一个还在干活的成员身上也会发生（例如它先说了句话、然后
 * 输出了一段空文本）。探活要问的是"它有没有真的动过"，那个问题对"最后一条"不敏感。
 */
function sessionSpokeWithContent(session: unknown): boolean {
  if (session === null || typeof session !== 'object') return false
  let events: readonly unknown[]
  try {
    events = sessionOwnEvents(session as never) as readonly unknown[]
  } catch {
    return false
  }
  if (!Array.isArray(events)) return false
  return events.some((event) => {
    if (event === null || typeof event !== 'object') return false
    if ((event as { type?: unknown }).type !== 'assistant/message') return false
    const content = (event as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) return false
    return content.some((block) => (
      block !== null && typeof block === 'object'
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
      && (block as { text: string }).text.trim() !== ''
    ))
  })
}

/**
 * ── ★ 调用点④：团队级观察（`task-status` / `delivery-declared` 共用）──────────────
 *
 * 这两个调用点【没有单个 task】—— 它们问的是"这个团队现在什么情况"。所以探活判据
 * 从它们那里拿到的是 `waits`（**每个未结束尝试一条**），而不是 `wait`。
 *
 * ★ `wait` 与 `waits` 不同形不是重复，是两种问题（与 t12 那条"记录 ≠ 观察"同源）：
 *     · `wait`  —— "**这个任务**等了多久"（发生在某一步的上下文里）
 *     · `waits` —— "**这个团队里**有谁在等、等了多久"（发生在快照/交付的时刻）
 *   把它们合成一个"wait 或 waits"的字段，会让"我知道这一个任务"与"我把队里所有
 *   等待都看了一遍"在判据里同形 —— 而后者才知道"谁卡住了"。
 *
 * ★★ 空数组与缺席必须不同形（本文件已经为 `members` 立过同一条界线）：
 *   · `waits: []`  —— 观察了：这个团队**此刻没有任何等待中的尝试**
 *   · `waits` 缺席 —— 没能观察（例如状态读取失败）⇒ 判据按自己的契约 unmeasured
 *
 * ★ 只有**未结束**的尝试才进来：一个已经 completed / failed / cancelled 的任务不在
 *   等任何人。把终结的任务也列进去，探活会为一个**早就结束**的尝试报"它卡住了"。
 */

/**
 * ── ★ 调用点③：把等待观察交给 runtime 判据（六个调用点共用）───────────────────
 *
 * 这是本模块**唯一**构造 `wait` 的地方。六处调用（member-dispatched /
 * task-created / task-update / task-update-settled / task-status /
 * delivery-declared）都经它取观察，于是"同一个尝试在不同步骤里读到不同的等待"
 * 这件事在**形状上**不可能发生。
 *
 * ★★ 读不到 ⇒ **不注入**，而不是注入一个默认值。
 *
 * 这是 t5 验收里那句"读不到时不得伪造 —— 不注入，让判据自己报 unmeasured"。
 * 具体地：没有匹配的等待记录 ⇒ 返回 `undefined` ⇒ `wait` 字段**不出现在 ctx 里**
 * ⇒ 判据按自己的契约说"我没能测量"。**调用方绝不在这里替判据决定"那就算通过"**
 * （本文件在 `inject` 那一段已经为这条纪律写过一段说明）。
 *
 * ★ 哪些情形"读不到"（每一种都必须不同形于"读到了"）：
 *   · 这个尝试没有派发记录（例如队长自己接管的任务）⇒ 没有起点 ⇒ 不注入；
 *   · `attemptId` 缺席（任务还没被派发过）⇒ 不注入；
 *   · 记录在，但起点不可用 ⇒ 不注入。
 *
 * ★ 每次交接都推进 `lastPollAt`：**"上一次探活"是这次探活产生的**，所以它属于
 *   交接这一步，而不是属于记录本身。判据不用它算"第几次"，只用它分辨
 *   「这是第一次探活」（字段缺席）与「上次探活在 T」（字段在）。
 */

/**
 * ── ★ 判据的输入面：A 层核对的【唯一】接线点（t10）────────────────────────────
 *
 * 这个函数是编排层对 `src/gates/requires.ts` 的全部使用。八处调用点一个不少地
 * 走它 —— 包括那六处 `runtime` 调用点，它们全部经 {@link evaluateRuntimeGates}
 * 进来，而那个入口是注入面（`wait` / `waits`）**唯一**的构造点。
 *
 * ── ★ 为什么必须逐格手接会输（这段话是本任务存在的理由）───────────────────────
 *
 * MEASURED（2026-10-05 复盘）：11 条判据的输入面**每一格都是手工单独接的**，而五次
 * 同形缺陷全部落在这一格上：
 *
 *     inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配 → 窗口表没接线
 *
 * 五次都不是判据写错，而是"判据要的那一格 ctx 没接上"。它们的共同形状是：
 * **判据照常跑、照常说话，只是它说的是"我没能测量"** —— 在日志里与"这一步没问题"
 * 同形。⇒ 判据自己声明 `requires`（B 层类型），编排层在这里按声明核对**真实 ctx**
 * （A 层实测），"接没接上"于是成为一次机械核对，而不是人眼审查。
 *
 * ── ★ 三条纪律，每条都对着一个已经踩过的坑 ────────────────────────────────────
 *
 * ① **先核对、再求值**。顺序是刻意的：核对读的是**调用方交出去的那份 ctx**，
 *    所以"判据要的格子在不在"这个问题必须在判据开口之前就回答。反过来（先求值
 *    再核对）会让核对结果依赖判据自己有没有副作用地补上某一格 —— 那时它核对的
 *    已经不是调用方的接线了。
 *
 * ② **不适用 ⇒ 不核对、不报**（`requires.ts` 的闸门）。11 条判据 × 8 个调用点
 *    = 88 种组合，**大部分本来就该"不适用"**：一条只在 `task-status` 上开口的
 *    探活判据，在 `task-created` 那一刻缺时钟，本来就是设计的一部分。在那些组合上
 *    喊"缺这缺那"正是"教人忽略门禁"的老路（本队已有实测：噪音与误报同样有害）。
 *    所以这里**原样转发**判据自己的 `appliesTo`，且用与注册表**同一份函数引用**
 *    —— 两份口径会分叉，而分叉的两次调用在日志里同形。
 *
 * ③ **核对不拒绝任何东西**（先软后硬，用户裁定）。本函数只**产出**一份旁路结果，
 *    它进求值结果的 `requires` 字段，与 `observed` 平级；它不参与
 *    `ok` / `blockers` / `unmeasured`，也不改 `evaluated` / `skipped` / `registered`
 *    任何一个计数。一个自己还没被验证过的新机制没有资格当场否决别人的任务 ——
 *    这正是本队"判据误伤的代价比漏报更贵"那条的同一个形态。
 *
 * ── ★ 三条边界，必须与注册表那一份对齐（否则核对会报出一个判据不认的结论）──────
 *
 *   · **核对谁**：`auditRequires(subjects, ctx)` 把 `applies` 交给
 *     `checkRequires` 去问 `subject.appliesTo` —— 与注册表求值时调的是**那个
 *     函数**，只不过它由审计层调一次、由注册表调一次（每轮各一次，纯读）。
 *     ⇒ 只有在 `appliesTo` 带副作用或自己读时间时两者才可能不同，而本仓库的
 *       11 条 `appliesTo` 全部是纯读（它们在 `src/gates/**` 里，本任务不改）。
 *     不适用的仍落在 `skipped`、不报缺失 —— 于是 `requires.checks` 与 `ran[]`
 *     按 id 一一对得上。
 *   · **`requires` 缺席**：`checkRequires` 给 `skipped` + `undeclared`，这**不是**
 *     噪音（它不进 `missing`）—— 它是"这条判据的输入面还没被声明"的覆盖率读数。
 *   · **`appliesTo` 抛错**：`checkRequires` **不捕获**（与注册表同口径）。一个
 *     "核对层能容错、求值层不能"的分叉会让那一刻的核对结果变成幻觉。
 */

/**
 * ── ★★ 核对结论的**结构化出口**（t3）：五处只有 `logger.warn` 的地方补齐 ──────────
 *
 * MEASURED（2026-10-06，integrator4 在 t9 钉住的不对称）：
 *
 *     六处 `auditGateRequires` 调用点里，**只有 runtime** 把核对结论随记录交出去
 *     （`runtime_gates.input_surface`）；contract / dispatch / completion / delivery×2
 *     **只有一个 `logger.warn`**。
 *
 * ⇒ 日志被截断或关掉时，「**报缺**」与「**输入面是齐的**」同形。这不是"日志不好"，
 *   是**同一个结论只有一条读取路径**时的固有弱点：本队已经栽过一次同名形态 ——
 *   `scripts/gate-input-wiring.test.mjs` 臂 8 的第一版挂在 contract 位置、却去读只有
 *   runtime 才有的 `input_surface` ⇒ 断言**恒真**（规则二点名的形态）。
 *
 * ── ★ 用户裁定（甲 + 总是出现）────────────────────────────────────────────────
 *
 * 四处统一挂 `input_surface`，且它**总是出现**（不省略）：
 *
 *     都齐            ⇒ 字段在场，`incomplete: 0`
 *     有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
 *     这个位置没判据  ⇒ **字段不出现**（与"有判据且都齐"不同形）
 *
 * ★ 为什么不能用「字段不出现」表达「齐」（乙方案被否的依据）：runtime 那边**既有**
 *   的注释（见 `evaluateRuntimeGates` 的返回处）已经写明过这条纪律 ——
 *   「缺席 ⇒ 字段不出现。**不是 `ok`**」。而「**有判据但都齐**」与「**这里没判据**」
 *   是**两件事**，必须不同形。
 *
 * ── ★ 形状与 runtime **完全一致**（可机械比对，不是"看起来差不多"）──────────────
 *
 *     { checked, incomplete, skipped, missing }
 *
 * ★ 只有 runtime 那处多一格 `outcome`（它回答的是另一个问题："判据跑了、说了什么"）。
 *   本函数**不**产出 `outcome`：那会让四处看起来也有一个"裁决"，而这个出口的
 *   语义只有一个 —— **输入面接没接全**。第四个字段也不加（`notApplicable` /
 *   `inputSurfaceAbsent` / `gateCellsUndeclared` / `checks` 都在 `RequiresAudit` 上）：
 *   多一格就多一处可以分叉的地方，而分叉之后两个 `input_surface` 在断言层面不同形。
 *
 * ── ★ 三态在两边的区分方式**刻意不同**，这不是分叉，是同一个决定的两种落点 ───────
 *
 *     runtime 调用点（六处）   核对结论是**它自己的返回记录**（`runtime_gates`）
 *                              ⇒ 包一层：`runtime_gates` 缺席 = 这个事件没挂判据
 *     contract/dispatch/…      核对没有自己的记录，结论只能挂在**调用方已经要交出去的**
 *                              那个对象上（`delivery` 字段 / 前置块声明的一次 `throw`）
 *                              ⇒ 那里没有"再包一层"的余地：`input_surface` 必须直接到场
 *
 *   ⇒ 于是本函数**只在有判据时**返回结果（`undefined` ⇒ 调用方挂不上字段）：
 *     字段缺席的唯一成因就是"这个位置这一轮没有挂判据的判据"。**它不是 `ok`** ——
 *     把"这里没有约束"读成"约束通过了"，正是三态要防的那种合流。
 *
 * ── ★ 末句：它不参与任何裁决 ───────────────────────────────────────────────────
 *
 * 与 {@link auditGateRequires} 同一条纪律（先软后硬）：本函数只**产出**一份读数。
 * 返回 `undefined` 的唯一后果是"少挂一个诊断字段"，**不是**拒绝、不是跳过、
 * 也不改任何既有控制流 —— 于是"补出口"这件事对生产路径的裁决零影响。
 */
/**
 * ── ★★ 诊断字段的【声明面】（t14）──────────────────────────────────────────────
 *
 * MEASURED（2026-10-06，captain 实调 `create_task` 时复现；本队同族形态第 9 次）：
 *
 *   15 个工具的 `output.schema` 全是 `additionalProperties: false`，而 t3/t7 的
 *   调用点接线往**返回值**里加了四个诊断字段（`input_surface` / `runtime_gates` /
 *   `dispatch_input_surface` / `completion_input_surface`）——
 *   **声明它们的地方（schema）没跟上**。⇒ 加了字段的返回值通不过自己的 schema，
 *   宿主在 `createSuccessResult` 里抛 `ToolOutputError`：
 *
 *       "value.input_surface" is not a declared property (additionalProperties: false)
 *
 *   ★ 这个缺陷的形状与前八次一模一样：**加了字段的地方改了，声明它的地方没改**。
 *     区别只在于这次的"声明它的地方"是 JSON Schema，而不是一个白名单数组。
 *
 * ── 修法：一个构造点，谁挂字段谁来取 ────────────────────────────────────────────
 *
 * 形状只有两族，且各自只有一个真值来源（下面这两个函数）。工具 schema 从这里
 * **取**片段，而不是各写一份字面量 —— 后者会在下一次加字段时重新分叉，
 * 而分叉之后"声明了的"与"实际返回的"在断言层面不再同形（那正是本任务的病根）。
 *
 * ★ 为什么是"按工具声明"而不是"给所有工具都加满四格"：那是一份**更大的**假声明 ——
 *   它会让"这个工具永远不会返回这个字段"与"它可能返回"在 schema 上同形，
 *   而本队的纪律是**空即空、不适用即不适用**（见 `INSERTION_POINTS` 的位置说明）。
 *   于是声明面必须与**真实的产出面**逐一对上，那条臂（见
 *   `scripts/gate-tool-output-schema.test.mjs`）逐工具核对的就是这件事。
 *
 * ★ 三态在这四个字段上同样成立，且 schema 必须容得下三态：
 *   · 字段**在场**且 `incomplete: 0`  ⇒ 都齐；
 *   · 字段**在场**且 `incomplete: N`  ⇒ 有缺格（`missing` 给出名单）；
 *   · 字段**缺席**                    ⇒ 这个位置这一轮没有判据（**不是** `ok`）。
 *   ⇒ `required` 一个字都不写：把"缺席"写成非法，就等于把第三种情形抹掉。
 */

/**
 * `runtime_gates` 的形状 = `registry.evaluate('runtime', …)` 的裁决 + `outcome`。
 *
 * ★ 为什么它比 `input_surface` 宽（多一层嵌套）：runtime 的结论是**它自己的求值
 *   记录**（`ok` / `blockers` / `unmeasured` / `ran` / `observed` / `counts` …），
 *   由 {@link evaluateRuntimeGates} 原样展开，再补一个 `input_surface` 与 `outcome`。
 *   ⇒ 它的字段集**不属于本文件**（判据注册表的裁决形状），所以这里声明它是一份
 *   **开放对象**：闭合它会再造一次"注册表加了字段、schema 没跟上"的同族缺陷。
 *   ★ 这是**刻意的**，不是偷懒：凡是形状属于另一层的嵌套对象，schema 用
 *     `additionalProperties: true` 表达"这一格是别人家的",而**本文件自己产出的
 *     字段**（四个诊断字段）一律**闭合声明**。
 */

/**
 * 一个工具可能挂上的四个诊断字段 —— **按工具取用**（见上面那段"为什么不是加满"）。
 *
 * ★ 用法：`properties: { …自己的字段, ...diagnosticFields({ inputSurface: true, runtimeGates: true }) }`
 *   ⇒ schema 里出现的就是它**真的会返回**的那几格。
 */


/**
 * ── ★★ 卡点台账：在【卡点发生时】自动落一条可重放的记录（t22 / f-0014）────────────
 *
 * ── 它修的是什么（MEASURED，本轮试跑）────────────────────────────────────────────
 *
 * 第一轮台账记了 12 条卡点，**12/12 条 `replayable: false`** —— 三样东西全是空的：
 *
 *     · `scene.ctx`               全为 null ⇒ **重建不出当时的输入**
 *     · `context.eventRefs`       指不到具体事件 ⇒ 原始观测存在但**不可定位**
 *     · `observed.mechanismState` 全为 null ⇒ 拿不到判据当时的**完整输出与内部状态**
 *
 * ★ 结论（f-0014 原话）：「记录必须在【卡点发生时】做，**事后补是补不上的**」。
 *   事后拿得到的只有任务 output（**已经过一轮解释**）与 git 历史（只有相关文件的
 *   revision）—— 而"判据当时读到的 ctx 是什么"在那个时刻之后就再也拿不回来了。
 *
 * ── 挂点：判据拒绝时 ───────────────────────────────────────────────────────────
 *
 * `throwWithSurface` 是**判据层拒绝的唯一出口**（contract / dispatch / completion /
 * delivery 全部经它）⇒ 在那里记，覆盖"判据说话并且拒绝了"这一类卡点。
 * ★ 而那个函数是**纯函数**（不读 ctx、不写盘）—— 那正是它的价值（可测、无副作用）。
 *   ⇒ 记录由**调用方**在它旁边做（调用方手里才有 ctx、会话、注册表）。
 *
 * ── ★★ 本记录自己的验收：**它必须能重放** ─────────────────────────────────────
 *
 * 这是本任务与"写日志"的分水岭：写完之后的判据是 —— **拿它去重跑那条判据，
 * 卡点必须能再发生一次**。要满足它，记录里必须含三样：
 *
 *     ① `scene.ctx`      —— ctx 的**结构化快照**（判据真的读到的那一份）
 *     ② `eventRefs`      —— 会话 id + 事件序号（把"当时"定位到具体事件）
 *     ③ `mechanismState` —— requires 核对结论 + 输入面三态 + 判据的完整输出
 *
 * ★ 形状对齐 `.agent-teams/frictions/README.md`（**不另发明一套**）：那条纪律是
 *   "记录【完整】、索引【可派生】"，键名与既有 12 条一致 —— 否则新旧记录在读取端
 *   要分两套解析，而两套会慢慢分叉。
 *
 * ── ★ 三态：记不下 与 "没有卡点" 必须不同形 ────────────────────────────────────
 *
 * 返回 `undefined` 表示**没能记**（拿不到 stateRoot / 写盘失败），而不是"没有卡点"。
 * 一个静默失败的台账会在最需要它的时候**看起来是空的**，而"空的台账"与"没有卡点"
 * 在读取端同形（与本队反复记账的形态同源）。
 */

/**
 * 把任意值压成**可重放**的形状：丢掉函数与循环引用，其余原样保留。
 *
 * ★ 为什么不用 `JSON.parse(JSON.stringify(x))`：
 *   · 循环引用直接抛错 ⇒ 一条**本该被记下的**卡点会因为"ctx 里有个环"而丢失，
 *     而丢的那一条与"没有卡点"在台账里同形；
 *   · `undefined` / 函数会被静默丢掉而不留痕 —— 那正是"记录不完整"的成因。
 *   ⇒ 这里逐层走一遍，把"丢掉了什么"**显式**记进对象，让"丢"这件事可见。
 */

/** 会话里的 `tool/result` 事件定位（台账 `context.eventRefs`）。 */

/**
 * 落一条卡点记录。
 *
 * ★ 路径：`<stateRoot>/frictions/<id>.json` —— 与既有 12 条**同一个目录、同一种形状**。
 *   `stateRoot` 的锚点与 `onWorktree` 的落盘共用 `STATE_DIR_FOR_BASE_PERSIST`。
 *
 * ★ 这一层只做 I/O，**不改任何裁决** —— 与 `inputSurfaceOf` 同一条纪律（旁路数据）。
 */

/**
 * 跑 `runtime` 位置，并且**无论它返回什么都继续**（契约 §5 硬要求）。
 *
 * ★ 三态 + 一个不同的第四种情形，四种在返回值里【互不同形】：
 *
 *   · 缺席（`undefined`）        —— 这个事件类型没有挂任何 runtime 判据。
 *                                  **不是** `ok`：把"这里没有约束"读成"约束通过了"
 *                                  正是本队要防的那种合流。
 *   · `ok`                       —— 判据跑了、没问题。
 *   · `blocked`                  —— 判据跑了、发现了问题（只记录，不拒流程）。
 *   · `unmeasured`               —— 判据跑了、说"我测不了"（★ 与 blocked 不同形）。
 *   · `threw`                    —— ★ 判据【自己抛了】。这是一条独立的结论：一条
 *                                  抛错的判据既不是"发现问题"也不是"没能测量"，
 *                                  而它在日志里与"通过"同形是最坏的形态。
 *
 * ★ 与调用点纪律的关系：只有调用方知道"这个事件是不是某条运行判据适用的事件"。
 *   本模块不读 context（不替判据猜），也不把"没跑"记成 `ok`。
 *
 * ★ `clock`（t5）：本入口是**唯一**给 runtime 判据注入时钟读数的地方。它由
 *   `registerAgentTeamsTools` 的 `config.now` 决定（缺省 `Date.now`），于是：
 *   · 生产路径上六处调用点读到的是同一个时钟；
 *   · 夹具注入一个假时钟，就能**不真的等待**地构造"两次探活之间没有任何产出"。
 *
 *   ★ 判据层绝不自己读时间（契约 §2 性质 1）—— 它拿到的是 ctx 里的 `wait.now`。
 */

/**
 * ── ★ 判据层：contract / delivery / runtime 三个位置的接线（t6）────────────────
 *
 * MEASURED（2026-10-05，t6）：注册表声明五个【位置】，此前只有 `dispatch`（1 处）
 * 与 `completion`（3 处）真的被调用。`contract` / `delivery` / `runtime` 三个位置
 * **没有任何 `registry.evaluate` 调用点** ⇒ 往那里挂判据永远不会跑。本队已经反复
 * 见过这个形态（"装了但调不到"），所以这三个位置的接线与 fixtures 是同一次改动。
 *
 * ★ 接线纪律（三条，都来自契约）：
 *
 *   ① **叠加，不替换**：新调用点一律落在既有检查【之后】。`contract` 在
 *      `validateCreateTask` / `amendTaskContract` 之后，`delivery` 在
 *      `canDeclareDelivery` 之后，`runtime` 在既有状态迁移之外。既有四个调用点的
 *      裁决顺序与语义一个字都没动。
 *
 *   ② **runtime 不得阻止流程**（契约 §5）：它返回任何裁决都只【记录】。拒任务该由
 *      `completion` / `delivery` 位置上的一条判据去读那条记录，而不是让过程约束
 *      当场把任务卡死。"过程"与"裁决"混在一处，正是契约 §5 要分开的东西。
 *
 *   ③ **缺席 ≠ 通过**：没有挂判据的位置保持今天的行为（不拦），但调用方拿到的
 *      返回值是 `undefined` 而不是 `{ok:true}` —— 两者必须不同形。
 */

/**
 * 在 `contract` 位置跑判据，并用与既有位置【完全同形】的方式拒绝。
 *
 * ★ 位置：`validateCreateTask`（建任务）与 `amendTaskContract`（改契约）**之后** ——
 *   契约层自己的校验先说话，判据层再叠加。这样"契约本身合法"这件事的既有裁决
 *   一点没变，而"契约是否可判"（例如 verify 命令能不能真的判定）可以后挂上来。
 *
 * ★ 为什么拒绝的措辞与 dispatch/completion 一致：读日志的人要能一眼看出"这是判据层
 *   拒的、拒的是哪个位置"，而三态的措辞必须分开（发现的问题 vs 没能测量）。
 *
 * ★ `inject`（t18）：判据需要的执行器由本层（唯一做 I/O 的地方）注入。此前两个
 *   contract 调用点都**没有**注入 `execVerifyCommand`，于是 `contract.verify-command`
 *   在生产路径上永远 `unmeasured` —— 见 create_task 处的详细说明。
 *
 * ── ★★ 返回值（t3）：本函数**交出**它这一次的核对结论 ──────────────────────────
 *
 * MEASURED（2026-10-06，t9）：本位置此前**只有一个 `logger.warn`** —— 日志被截断
 * 或被关掉时，「报缺」与「输入面是齐的」在返回值上同形。用户裁定：这四处统一挂
 * `input_surface`，形状与 runtime 完全一致（见 {@link inputSurfaceOf}）。
 *
 * ★ 它为什么是**返回值**而不是写进 `context` / 某个全局：成功路径上调用方
 *   （`create_task` / `amend_task`）本来就有一个要交出去的结果对象，核对结论挂在那里
 *   才与 `runtime_gates` 同一条纪律（"随记录交出去"）。返回 `undefined` ⇒ 这个位置
 *   这一轮没有挂判据 ⇒ **字段不出现**（三态里的第三种，不是 `ok`）。
 *
 * ★ 它与拒绝路径的关系**只有一个方向**：先算出结论，再交给 `rejectWithSurface` 包装
 *   任何一次真实的拒绝。⇒ 缺格的结论**永远到得了调用方**，而它一次也不曾参与裁决
 *   （"先软后硬"：核对报缺时流程照常走完，见 {@link auditGateRequires}）。
 */

/**
 * ── ★★ 「说出缺格」与「抛出拒绝」必须能同时发生（t3）────────────────────────────
 *
 * 这是本任务里唯一一处**形状上的**难点，值得写清楚它为什么是现在这样。
 *
 * 用户裁定四处都要挂 `input_surface`，而其中三处（contract / dispatch / completion）
 * 走的是**异常路径**：`create_task` / `update_task` 拒绝一次调用时不返回任何结果对象，
 * 只有一句 `throw new Error(...)`。于是"把结论交出去"在那里没有对象可挂 ——
 * 除非拒绝本身**带着**它走。
 *
 * ★ 为什么不是"先挂一个变量、让调用方去读"：那会让结论只在"读得到那个变量"的地方
 *   存在，而**拒绝路径**恰恰是最需要它的地方 —— 一次被拒的 create_task 里，
 *   "是契约本身不合法"与"是判据要的那一格没接上"正是最容易合流的两件事（前者是
 *   拒绝的理由，后者不是）。
 * ★ 也不是把结论并进 `error.message` 的那句话里：`missing` 的每一行本来就长，
 *   混进人话之后，"读字段"变成"解析字符串"，而那正是本任务要消灭的读取方式
 *   （"日志被截断时同形"）。
 *
 * ⇒ 结论挂成一个**结构化的自有属性**（`Error` 的自有可枚举属性，不经任何序列化）。
 *   钩子把它原样搬进工具结果的 `input_surface` 字段（见 `defineTool` 的返回处）。
 *   没有钩子的调用方（既有的测试、宿主）读不到它 —— 但那与"没挂"不同：属性在不在
 *   是**可判定**的，而"只写日志"在那些调用方那里根本无法判定。
 *
 * ★ 从 `throw new Error(...)` 改成 `throwWithSurface(...)` 是**行为等价**的：
 *   抛出的仍然是一个普通 `Error`（`instanceof Error` 与 `message` 逐字不变），
 *   只是多挂了一个自有属性。
 */

/**
 * 拒绝上挂的那一格叫什么。
 *
 * ★ 取一个**带命名空间前缀**的名字（而不是 `input_surface`）：它跟着一个异常对象
 *   走，而异常对象可能被宿主序列化、被日志打印。一个叫 `input_surface` 的自有属性
 *   会在任何一次 `{...error}` 里伪装成"工具结果的字段"，而它其实只在**工具边界**
 *   才被搬成那个字段（见 `defineTool` 的返回处）。两个名字分开，"挂在哪"读得出来。
 */

/**
 * 结论**应该落到哪个字段名**（见 {@link throwWithSurface} 的 `field` 参数）。
 *
 * ★ 与 `INPUT_SURFACE_PROPERTY` 分开的第二个名字：一个是"结论本体"，一个是"落点"。
 *   ★ 缺席 ⇒ 落点用缺省的 `input_surface`（那四个只有单一入口的位置）。
 */

/** 一次拒绝要落到工具结果的哪个字段上（缺省 `input_surface`）。 */

/**
 * 从一次抛出里取回核对结论（见 {@link throwWithSurface}）。
 *
 * ★ 三态之一"这个位置没有判据"与"这次抛出没带结论"在这里**合并成 `undefined`**，
 *   而且是刻意的：本函数的读者是**工具边界**，它问的是"这次调用有没有一份要交出去的
 *   核对结论"。至于"为什么没有" —— 那是*上面*那个结论自己回答的问题（字段在不在），
 *   边界没有资格替它回答，也不该发明第二种说法。
 */

/**
 * ── ★ 这里**没有*** `rejectOnDeliveryGates` 了（t18/B2）────────────────────────
 *
 * 它此前存在，并且被 `agent_teams_status` 调用 —— 那正是死结的来源：
 * **把一个读操作当成了宣告点**。一个还没收敛的团队于是连"现在什么情况"都读不到，
 * 而读不到状态正是队长判断"该不该让它收敛"的前提。
 *
 * ⇒ 现在交付位置分两处：
 *   · `agent_teams_status`  —— **只报告**（裁决并进返回值的 `delivery` 字段）
 *   · `agent_teams_declare_delivery` —— **承载拒绝**（本文件里那个工具）
 *
 * ★ 不保留一个"只在别处调用"的私有函数，是因为那会让人以为交付的拒绝逻辑有两条
 *   路径；而**两条路径会在措辞与合并口径上慢慢分叉，且它们在日志里同形**。
 *   拒绝逻辑只此一份，写在新工具的 execute 里。
 */

/**
 * ── ★ delivery 位置的输入面：成员【收敛】的观察 ────────────────────────────────
 *
 * MEASURED（2026-10-05，t12）：`delivery.convergence` 接进 delivery 位置之后，
 * 它的必需输入 `ctx.members` **没有被注入** ⇒ 它在任何真实路径上都返回 `unmeasured`。
 * 而注册表的合并规则是「未测量优先于 blockers」⇒ 它的 unmeasured **盖住**同一次求值里
 * 其他判据的 blocker ⇒ `declare_delivery` 永远返回「无法测量」。
 *
 * **一道永远关着的门** —— 与 t6 时 `completion.verify-rerun` 缺执行器同源：
 * 判据接进来了，但它的输入面没接。
 *
 * ── ★ 记录 ≠ 观察（这一节的纪律，也是 t12 验收专门钉住的一条）─────────────────
 *
 * 最省事的写法是把 `team.members[].status` 直接交出去。**那是错的**，而且错得很像对的：
 *
 *   · 那个字段是**持久记录**，由 `agent/status` 事件逐步写下来；
 *   · 一个被中断、崩溃、或压根没起来的成员，在记录里**仍然可能是 `idle`**；
 *   · 而它其实**没有交回任何东西** —— 正是收敛判据存在的理由（"空回复不是收敛"）。
 *
 * ⇒ 拿它冒充"观察到的收敛"，就是把**记录**当成**观察**：一次崩溃会读成"全队收敛"，
 *   而这个判据的全部价值恰恰在于分辨这两件事。
 *
 * ── 那么真正的观察从哪来 ────────────────────────────────────────────────────
 *
 * 成员是**持久 continuable subagent**，它的会话是一条**事件日志**。观察的入口就是
 * 那条日志本身（与 `observedChangedPaths` 读 `tool/result` 的 `meta.diffs` 是同一个
 * 先例、同一个取法）：
 *
 *   · `state` —— 用 **live Agent 的状态**（`ctx.agents.get(id).status`）。
 *                拿不到 live Agent（未 spawn / 已释放）⇒ **不注入**，而不是猜一个。
 *                ★ 注意这与 `memberActivity` 同源，但 `memberActivity` 会把
 *                "拿不到"折成 `'ready'` —— 那是给控制台看的**展示**口径；
 *                判据要的是**可判定**口径，两者不能合流。
 *   · `spoke` —— 从会话日志里读**最后一次 `assistant/message` 的内容是否为空**。
 *                没有 `assistant/message` ⇒ **不注入 spoke** ⇒ 判据按自己的契约
 *                unmeasured（"它有没有说过话没被观察到"与"它说了空的"不同形）。
 *
 * ★ 三种"没有可交的观察"要分开（t16 收口；这一节此前把前两种合流了）：
 *
 *     ① **不适用 / 可判定的事实**（成员从未 spawn）⇒ **如实交出去**
 *        ⇒ 判据判它不收敛（blocked）。这是本队那条跨层规则的调用方一侧：
 *        **「可判定的事实」不得写成「没能测量」**。
 *     ② **真的读不到**（有会话 id 但 live Agent 拿不到；或会话日志里读不出
 *        `spoke`）⇒ 不注入 ⇒ 判据 unmeasured。
 *     ③ 团队确实没有成员 ⇒ 注入 `[]`（"观察了，确实是零"，与①②都不同形）。
 *
 * ★ 原写法对①也 `return undefined`，于是**整个交付位置**只要队里有一个依赖未满足
 *   的成员就永远无法被测量 —— 同一道门从判据那边焊到了调用方这边。
 */

/**
 * 读一个成员会话里【最后一次 assistant 输出是不是空的】。
 *
 * ★ 返回值三态，与判据自己的 `spoke` 三态对齐：
 *   · `true`      —— 观察到了：最近一次输出非空
 *   · `false`     —— 观察到了：最近一次输出是空的（★ 这才是"空回复不是收敛"要抓的）
 *   · `undefined` —— **没能观察**（读不到会话日志 / 一条 assistant 消息都没有）
 */

/**
 * 观察每个成员的收敛面。
 *
 * ★ 只有【真的读不到】才返回 `undefined`（调用方据此不注入 ⇒ 判据说 unmeasured）。
 *   "读不到"与"读到了一条**可判定的事实**"必须分开 —— 见下面未 spawn 成员那一支。
 */

export function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): AgentTeamsRuntime {
  installRetiredMemberGuard(ctx, config.stateDir)
  installMemberDelegationGuard(ctx, config.stateDir, config.memberMaxDepth ?? 0)
  installMailboxAdmission(ctx, config.stateDir)
  /**
   * ★ 时钟（t5）：整个插件只从这一个地方读时间给判据用。
   *
   * 与 `judgeRuntimeGates` 里那个 `Date.now`（运行记录的**写入时刻**）是两个用途：
   * 那个是"这条记录是什么时候写的"，这个是"这次求值的观察时刻"。合流会让夹具
   * 推进假时钟时，运行记录上的时刻跟着跳 —— 而运行记录是给人看的审计，它必须
   * 反映真实墙上时间。
   */
  const clock = (): number => config.now?.() ?? Date.now()
  /**
   * ★ t18：`onWorktree` 的回调只拿得到 `taskId`，而把父版本**落盘**需要知道
   *   团队目录在哪。`stateDir` 是配置项（相对 workspace），而 workspace 在派发
   *   那一刻由调度器持有 —— 回调签名里没有它（改签名要动 `src/scheduler.ts`，
   *   那是本任务的 **outOfScope**）。
   *   ⇒ 在装配时记下 `stateDir` 的**绝对路径**，供 `onWorktree` 使用。
   *   ★ 代价如实说明：进程内只有一个已装配的插件实例（本插件的既有约定），
   *     而这个变量只被 `onWorktree` 读、只被这里写。
   */
  STATE_DIR_FOR_BASE_PERSIST = join(process.cwd(), config.stateDir ?? '.agent-teams')
  const scheduler = installTeamScheduler(ctx, {
    stateDir: config.stateDir,
    executionPrompt: config.executionPrompt,
    dispatch: dispatchMember,
    /**
     * ★ 时钟（t5）：调度器与判据层读**同一个**可注入时钟。
     *
     * 两处各读各的（调度器读 `Date.now`、判据读另一个）不会当场出错，但会让
     * "派发在 T 发生"与"探活在 T' 读到起点"之间没有一个共享的参照 —— 夹具
     * 推进假时钟时就会只推进一半，于是超时永远测不出来，而测试**看起来是绿的**
     * （因为没人真的等过）。
     */
    now: clock,
    /**
     * ★ 把派发时拿到的隔离基准记下来，供 completion 位置的 r5 / 回测判据使用。
     *
     * ── ★★ 为什么这里要写【两处】（t18）─────────────────────────────────────────
     *
     * MEASURED（point-dev 定位；无 worktree 的任务恒不可收口）：此前只写内存 Map
     * ⇒ 两类任务恒拿不到父版本：
     *
     *   (i)  **没有 worktree** 的任务（在主树干活的、captain 接管的）—— 这一支
     *        本来就不回调（`onWorktree` 只在真的建出 worktree 时触发）；
     *   (ii) **进程重启** ⇒ 内存 Map 清空（★ 与"旧模块"同族）。
     *
     * ⇒ 两类都让 `baseline` / `parentRevision` 恒缺席 ⇒ 回测判据恒 `unmeasured`
     *   ⇒ **这类任务永远无法收口**（而判据口径是对的，所以不能改判据）。
     *
     * ★ 修法不是改判据，是**把父版本变成一个可追溯的事实**：既记在内存（派发
     *   那一刻亲眼拿到，最新鲜），也**落进耐久态**（重启之后仍然读得到）。
     *   `base` 是一个 git 对象名，是否存在由 git 回答 —— 与用户已裁定的
     *   「上次审查的版本用 git 版本」同源，**不可伪造**。
     *
     * ★ `void` + catch：这是**旁路数据的持久化**，失败不该让派发本身失败
     *   （派发已经发生了）。而失败也**不静默**：日志里留下一条，读得到。
     *   ⇒ 内存那一份仍然生效，所以最坏情况退回 t18 之前的行为，不会更坏。
     */
    onWorktree: (taskId, base) => {
      rememberWorktreeBase(taskId, base)
      void persistTaskBaseRevision(taskId, base).catch((error: unknown) => {
        ctx.logger.warn(`agent-teams: could not persist the base revision for task "${taskId}": ${String(error)}`)
      })
    },
    /**
     * ★ runtime 位置：成员被【派发】这一刻。
     *
     * 契约 §5 的例子正是这一条：「在成员被派发时启动（计时器）；超时 ⇒ 产生一条
     * "这个成员超时了"的记录；它不直接拒任务」。所以这里只记录、不拒绝 ——
     * 拒绝派发是调度器自己的事（worktree 建不出来那条路径），不是过程约束的事。
     *
     * ★ 记录发生在【投递被接受之后】(`accepted === true`)。投递失败 ⇒ 任务回滚、
     *   成员没开工 ⇒ 那不是"派发过"。把失败的投递也记成一次派发，会让运行判据
     *   读到一个从未发生的事件。
     *
     * ★ t5 在这里做了两件事，**顺序有意义**：
     *   ① `recordDispatchStart` —— 把"这个尝试从此刻开始等"记进等待记录表。
     *      这是探活判据要的**等待起点**，而它只在这一刻可得（派发一结束，
     *      那个时刻就没有第二个来源了：任务记录上的 `updatedAt` 是别的用途，
     *      拿它冒充"成员开工了"会让"队长刚改过任务"读成"成员刚开工"）。
     *   ② `observeMemberActivity` —— 派发刚被接受时，成员**可能已经**产出过
     *      （冷恢复/接续的情形：会话里本来就有非空输出）。所以这里先观察一次，
     *      否则"它其实一直在动"会被读成"它一直没动"。
     *
     * ★ 返回值仍然被 `void` 掉：runtime **不得拒绝任务**（契约 §5 硬要求）。回调
     *   的签名是 `void`，没有可读的返回值，所以这条约束是**类型上**保证的，
     *   而不是靠纪律。
     */
    onDispatched: (event) => {
      recordDispatchStart(event)
      observeMemberActivity(ctx, event.memberId, event.attemptId, event.dispatchedAt)
      void evaluateRuntimeGates(ctx, 'member-dispatched', event, clock)
    },
  })
  const memberSelections = installMemberSelectionRuntime(ctx, config.stateDir, (workspace, teamId, memberName) => (
    scheduler.kickMember(workspace, teamId, memberName)
  ))

  async function dispatchMember(captain: Agent, teamId: string, memberName: string, text: string, signal: AbortSignal, mode: 'queue' | 'steer', attemptId?: string): Promise<boolean> {
    const root = stateRootOf(workspaceOf(captain), config)
    // Record why a member never started. The scheduler treats a failed dispatch as
    // "not now" and retries, so without this the captain only ever sees an
    // unexplained `unspawned` member and no diagnostic reaches any surface.
    const recordSpawnError = async (reason: string): Promise<void> => {
      try {
        await withTeamLock(teamLockKey(root, teamId), async () => {
          const fresh = await requireFreshCaptainTeam(root, teamId, captain.id)
          const failed = fresh.members.find(item => item.name === memberName && item.status !== 'removed')
          if (failed === undefined || failed.id !== '') return
          failed.spawnError = reason
          await writeTeam(root, fresh)
        })
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: could not record the member start failure for ${memberName}: ${String(error)}`)
      }
    }
    let orphan: TeamMember | undefined
    try {
      return await withTeamLock(teamLockKey(root, teamId), async () => {
        const team = await readTeam(root, teamId)
        if (team?.captainSessionId !== captain.id || team.halted === true || team.phase === 'staged') return false
        const member = team.members.find(item => item.name === memberName && item.status !== 'removed')
        if (member === undefined || member.stopping === true || team.tasks.some(task => task.reassigning === true && task.assignee === memberName)) return false
        if (attemptId !== undefined && !team.tasks.some(task => task.attemptId === attemptId && task.assignee === memberName && (task.status === 'claimed' || task.status === 'in_progress'))) return false
        if (member.id !== '') return deliverToMember(ctx, captain, member.id, text, signal, mode)
        const selection = await resolveMemberLlmSelection(ctx, captain, {
          provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort, fallback: member.fallback,
        }, signal)
        await spawnMember(ctx, memberRuntime(config), memberSelections, selection, captain, team, member, config.stateDir, signal, text)
        orphan = { ...member }
        delete member.spawnError
        await writeTeam(root, team)
        orphan = undefined
        return true
      })
    } catch (error: unknown) {
      if (orphan !== undefined) {
        await recordRetiredMemberIds(root, [orphan.id])
        await stopTeamMemberActivations(ctx, captain, [orphan])
      }
      // The stack carries the failing frame; the message alone rarely does.
      let reason = String(error)
      if (error instanceof Error && typeof error.stack === 'string' && error.stack !== '') reason = error.stack
      ctx.logger.warn(`agent-teams: member dispatch failed for ${memberName}: ${String(error)}`)
      await recordSpawnError(reason)
      return false
    }
  }

  const updatePlanBatch = async (captain: Agent, teamId: string, mutations: readonly StagedPlanMutation[], signal?: AbortSignal, allowPendingEdits = false): Promise<TeamState> => {
    if (mutations.length === 0) throw new Error('at least one staged plan operation is required')
    const workspace = workspaceOf(captain)
    const stateRoot = stateRootOf(workspace, config)
    return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id)
      const staged = fresh.phase === 'staged'
      if (!staged && !allowPendingEdits) requireStagedTeam(fresh)
      if (fresh.halted === true) throw new Error('team is halted; resume before editing tasks')
      if (!staged && mutations.some(mutation => mutation.action !== 'update_task')) {
        throw new Error('a running team only permits update_task edits to pending, never-started tasks; roster and removal edits require a staged plan')
      }
      for (const mutation of mutations) {
        if (mutation.action === 'update_member') {
          const member = requireMember(fresh, mutation.memberName)
          if (member.id !== '') throw new Error(`staged member "${member.name}" was already spawned`)
          const selection = await resolveMemberLlmSelection(ctx, captain, {
            provider: mutation.provider,
            model: mutation.model,
            reasoningEffort: trimmedOptional(mutation.reasoningEffort),
            fallback: member.fallback,
          }, signal)
          member.role = trimmedOptional(mutation.role)
          member.provider = selection.provider
          member.model = selection.model
          member.reasoningEffort = selection.reasoningEffort
          member.executionPrompt = trimmedOptional(mutation.executionPrompt)
        } else if (mutation.action === 'update_task') {
          const task = requireTask(fresh, mutation.taskId)
          if (task.status !== 'pending' || (task.attempt ?? 0) !== 0 || task.reassigning === true) {
            throw new Error(`task "${task.id}" has already started and cannot be edited`)
          }
          if (!staged && mutation.assignee === CAPTAIN_KEY) throw new Error('use reassign_task for captain takeover')
          const subject = mutation.subject.trim()
          if (subject === '') throw new Error('task subject must not be empty')
          task.subject = subject
          task.description = trimmedOptional(mutation.description)
          task.assignee = trimmedOptional(mutation.assignee)
          task.dependencies = [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))]
          task.updatedAt = Date.now()
        } else if (mutation.action === 'add_task') {
          const subject = mutation.subject.trim()
          if (subject === '') throw new Error('task subject must not be empty')
          fresh.taskSeq += 1
          const now = Date.now()
          fresh.tasks.push({
            id: `t${fresh.taskSeq}`,
            subject,
            description: trimmedOptional(mutation.description),
            status: 'pending',
            assignee: trimmedOptional(mutation.assignee),
            dependencies: [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))],
            attempt: 0,
            kind: 'work',
            createdAt: now,
            updatedAt: now,
          })
        } else if (mutation.action === 'remove_task') {
          const task = requireTask(fresh, mutation.taskId)
          const dependent = fresh.tasks.find((candidate) => candidate.dependencies.includes(task.id))
          if (dependent !== undefined) {
            throw new Error(`task "${task.id}" is still required by "${dependent.id}"; update that dependency before removing the task`)
          }
          fresh.tasks = fresh.tasks.filter((candidate) => candidate.id !== task.id)
        } else {
          const member = requireMember(fresh, mutation.memberName)
          if (member.id !== '') throw new Error(`staged member "${member.name}" was already spawned`)
          const owned = fresh.tasks.filter((task) => task.assignee === member.name)
          if (owned.length > 0) {
            throw new Error(`member "${member.name}" still owns planned tasks: ${owned.map((task) => task.id).join(', ')}; update or remove those tasks first`)
          }
          fresh.members = fresh.members.filter((candidate) => candidate !== member)
        }
      }
      validateStagedGraph(fresh, false)
      if (!staged) {
        for (const mutation of mutations) {
          if (mutation.action !== 'update_task') continue
          const task = requireTask(fresh, mutation.taskId)
          const validation = validateCreateTask({ ...fresh, tasks: fresh.tasks.filter(item => item.id !== task.id) }, task)
          if (!validation.ok) throw new Error(validation.error ?? 'edited task violates the quality contract')
        }
      } else fresh.planReviewState = 'awaiting_review'
      signal?.throwIfAborted()
      await writeTeam(stateRoot, fresh)
      return fresh
    })
  }

  // Browser review controls retain their staged-only contract.
  const updateStagedPlanBatch: AgentTeamsRuntime['updateStagedPlanBatch'] = (captain, teamId, mutations, signal) => (
    updatePlanBatch(captain, teamId, mutations, signal)
  )

  const updateStagedPlan: AgentTeamsRuntime['updateStagedPlan'] = async (captain, teamId, mutation, signal) => (
    updateStagedPlanBatch(captain, teamId, [mutation], signal)
  )

  const approveStagedTeam: AgentTeamsRuntime['approveStagedTeam'] = async (captain, teamId, signal) => {
    const workspace = workspaceOf(captain)
    const stateRoot = stateRootOf(workspace, config)
    const runSignal = signal ?? new AbortController().signal
    const approved = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id)
      requireStagedTeam(fresh)
      // A staged removal has no child session to retain in history. Drop those
      // placeholders before transitioning to the stricter running shape.
      fresh.members = fresh.members.filter((member) => member.status !== 'removed')
      validateStagedGraph(fresh, true)
      const selections = []
      for (const member of fresh.members) {
        const selection = await resolveMemberLlmSelection(ctx, captain, {
          provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort, fallback: member.fallback,
        }, runSignal)
        selections.push(selection)
        member.provider = selection.provider
        member.model = selection.model
        member.reasoningEffort = selection.reasoningEffort
      }
      await validateMemberLlmSelections(ctx, selections, runSignal)
      fresh.phase = 'running'
      delete fresh.planReviewState
      fresh.approvedAt = Date.now()
      await writeTeam(stateRoot, fresh)
      return { teamId: fresh.id, members: fresh.members.length, tasks: fresh.tasks.length }
    })
    try {
      await scheduler.kickTeam(workspace, teamId, captain)
    } catch (error: unknown) {
      // Approval is already durably committed. A transient wake-up failure is
      // recoverable by the next status/member lifecycle kick and must not make
      // the UI report that an already-running team failed to approve.
      ctx.logger.warn(`agent-teams: post-approval kick failed for "${teamId}": ${String(error)}`)
    }
    return approved
  }

  const continueStagedPlanning: AgentTeamsRuntime['continueStagedPlanning'] = async (captain, teamId) => {
    const workspace = workspaceOf(captain)
    const stateRoot = stateRootOf(workspace, config)
    const prepared = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id)
      requireStagedTeam(fresh)
      if (fresh.planReviewState === 'awaiting_feedback') {
        return { teamName: fresh.name, alreadyWaiting: true }
      }
      fresh.planReviewState = 'awaiting_feedback'
      await writeTeam(stateRoot, fresh)
      return { teamName: fresh.name, alreadyWaiting: false }
    })
    if (prepared.alreadyWaiting) return { teamId, alreadyWaiting: true }

    // End any planning turn that is still producing tool calls. A plugin
    // follow-up submitted after cancellation is queued as the next turn by the
    // Harness Agent contract, so it cannot race ahead and recreate the team.
    captain.cancel({ kind: 'user' }, { keepInbox: true })
    try {
      captain.followup(createUserMessage({
        content: [{ type: 'text', text: stagedPlanFeedbackContext(prepared.teamName) }],
        source: { kind: 'agent-teams' },
      }))
    } catch (error: unknown) {
      // Do not leave the durable UI in a false waiting state when the live
      // Captain disappeared between lookup and delivery.
      await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id)
        requireStagedTeam(fresh)
        if (fresh.planReviewState === 'awaiting_feedback') {
          fresh.planReviewState = 'awaiting_review'
          await writeTeam(stateRoot, fresh)
        }
      })
      throw error
    }
    return { teamId, alreadyWaiting: false }
  }

  const discardStagedTeam: AgentTeamsRuntime['discardStagedTeam'] = async (captain, teamId) => {
    const workspace = workspaceOf(captain)
    const stateRoot = stateRootOf(workspace, config)
    const discarded = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id)
      requireStagedTeam(fresh)
      appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/plan-discarded', {
        teamId: fresh.id,
      })
      // A staged plan owns no child sessions. Archiving releases the captain
      // immediately while retaining the rejected graph for later inspection.
      await archiveTeamDir(stateRoot, fresh.id)
      return { teamId: fresh.id, teamName: fresh.name }
    })
    // Preserve this control fact for the next genuine user turn, then abort the
    // still-running Captain turn. Without both operations a late model step can
    // observe the missing active team and incorrectly create it again.
    try {
      captain.inject(createUserMessage({
        content: [{ type: 'text', text: stagedPlanDiscardContext(discarded.teamName) }],
        source: { kind: 'agent-teams' },
      }))
    } catch (error: unknown) {
      // The archive is already authoritative. Cancellation still prevents a
      // late step from recreating work; failure to park extra context is only a
      // live-delivery warning and must not turn a successful discard into 409.
      ctx.logger.warn(`agent-teams: failed to inject discard context for "${discarded.teamId}": ${String(error)}`)
    }
    captain.cancel({ kind: 'user' }, { keepInbox: true })
    return { teamId: discarded.teamId }
  }

  const runtime: AgentTeamsRuntime = {
    isPendingMember: memberSelections.isPendingMember,
    updateStagedPlan,
    updateStagedPlanBatch,
    approveStagedTeam,
    continueStagedPlanning,
    discardStagedTeam,
  }
















  /**
   * ── t39：16 个工具各自注册（一个工具一个文件）────────────────────────────
   *
   * ★ 本函数现在【只剩装配】：建时钟/调度器/锁，然后把每个工具模块叫起来。
   * ★ 顺序仍然有意义（契约 §3）：同一位置内按注册顺序求值 —— 而下面这一份
   *   顺序与原 tools.ts 里 `ctx.tools.register(...)` 的书写顺序【逐条一致】。
   * ★ 共享实体由这里注入，而不是让子模块 import 本文件 —— 否则会成环。
   */
  register_create(ctx, memberSelections, scheduler, config)
  register_edit_plan(ctx, scheduler, updatePlanBatch, config)
  register_approve(ctx, approveStagedTeam, runtime, config)
  register_members(ctx, scheduler, config)
  register_create_task(ctx, clock, runtime, scheduler, config)
  register_reassign(ctx, scheduler, config)
  register_claim(ctx, config)
  register_update_task(ctx, clock, runtime, scheduler, config)
  register_amend_task(ctx, runtime, config)
  register_message(ctx, dispatchMember, config)
  register_status(ctx, clock, runtime, scheduler, config)
  register_delivery(ctx, clock, config)
  register_resume(ctx, scheduler, config)
  register_delete(ctx, config)
  register_restart(ctx, config)
  return runtime
}






/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config: ToolsConfig): MemberRuntimeConfig {
  return {
    provider: config.memberProvider,
    maxDepth: config.memberMaxDepth,
    executionPrompt: config.executionPrompt,
    fallback: config.fallback,
  }
}

/** Render the status snapshot as compact text for the model. */
