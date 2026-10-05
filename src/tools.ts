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
import { appendTaskEvidence } from './quality-gates.ts'
import { registry } from './gates/index.ts'
import { observedChangedPaths, sessionOwnEvents } from './harness-compat.ts'
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

export { steerCaptainReport } from './members.ts'

/** Resolved plugin config consumed by the tools. */
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
  fallback?: import('./profiles.ts').TeamModelFallbackConfig
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Team size cap (members). */
  maxMembers: number
  /** Named team profiles from the active DSH profile. */
  profiles: Record<string, import('./profiles.ts').TeamProfileConfig>
}

/** Browser/UI mutations allowed while a plan is waiting for approval. */
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

/** Runtime bridge shared by model-facing tools and the Web staging surface. */
export interface AgentTeamsRuntime {
  isPendingMember(agent: Agent): boolean
  updateStagedPlan(captain: Agent, teamId: string, mutation: StagedPlanMutation, signal?: AbortSignal): Promise<TeamState>
  updateStagedPlanBatch(captain: Agent, teamId: string, mutations: readonly StagedPlanMutation[], signal?: AbortSignal): Promise<TeamState>
  approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{ teamId: string; members: number; tasks: number }>
  continueStagedPlanning(captain: Agent, teamId: string): Promise<{ teamId: string; alreadyWaiting: boolean }>
  discardStagedTeam(captain: Agent, teamId: string): Promise<{ teamId: string }>
}

/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec: ToolRunContext): Agent {
  if (!exec.agent) {
    throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)')
  }
  return exec.agent
}

/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

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
const VERIFY_COMMAND_TIMEOUT_MS = 120_000

async function runVerifyCommand(workspace: string, command: string): Promise<number> {
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
const taskWorktreeBase = new Map<string, string>()

/** 派发时登记基准；判据层在完成时读它。 */
export function rememberWorktreeBase(taskId: string, base: string): void {
  taskWorktreeBase.set(taskId, base)
}

/** 取该任务的基准；没有就返回 undefined（**不是** HEAD，也不是空串）。 */
function worktreeBaseOf(taskId: string): string | undefined {
  const base = taskWorktreeBase.get(taskId)
  return typeof base === 'string' && base.trim() !== '' ? base : undefined
}

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
async function runInDetachedRevision(options: {
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
async function deriveCoverageInput(options: {
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
async function runVerifyCommandCaptured(workspace: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

/**
 * 同步读一个 workspace 相对文件（变异判据的 `readFile` 契约是同步的）。
 * 抛错 ⇒ 判据内部按 unmeasured 处理；这里【不】吞掉它，也不返回空串 ——
 * 返回空串会让"读不到"伪装成"文件是空的"。
 */
function readWorkspaceFileSync(workspace: string, relativePath: string): string {
  return readFileSync(join(workspace, relativePath), 'utf8')
}

/**
 * 同步写一个 workspace 相对文件（变异判据的 `writeFile` 契约是同步的）。
 * ★ 只有变异判据用它，而它写的是【它自己刚读过的那个文件的变异体】，随后会还原；
 *   拒绝越界路径（`..` / 绝对路径）—— 与 worktree.ts 的 `guardedWrite` 同一条纪律。
 */
function writeWorkspaceFileSync(workspace: string, relativePath: string, contents: string): void {
  const target = join(workspace, relativePath)
  if (!target.startsWith(workspace.endsWith('/') ? workspace : `${workspace}/`)) {
    throw new Error(`refusing to write outside the workspace: ${relativePath}`)
  }
  writeFileSync(target, contents)
}

/**
 * 从改动文件推出扫描目录。
 *
 * ★ 这是 r5 的 `scanDirs`：它决定"去哪找测试文件"。推不出来（没有改动文件）
 *   ⇒ 返回 undefined ⇒ 不注入 ⇒ 判据 unmeasured，而不是注入一个猜测出来的目录。
 */
function deriveScanDirs(changedFiles: readonly string[]): string[] | undefined {
  const dirs = new Set<string>()
  for (const file of changedFiles) {
    const parts = file.split('/')
    if (parts.length <= 1) continue
    dirs.add(parts.slice(0, -1).join('/'))
  }
  return dirs.size === 0 ? undefined : [...dirs].sort()
}

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
async function changedLineNumbers(workspace: string, base: string | undefined): Promise<number[] | undefined> {
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

/**
 * 把判据层重跑的 CommandResult 并回成员提交的数组：同名命令以重跑为准
 * （exitCode 是判据层亲眼看到的），其余条目保留。
 */
function mergeRerunIntoCommandsRun(
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
    return rerun
  })
  for (const rerun of reruns) {
    if (!seen.has(rerun.command)) merged.push(rerun)
  }
  return merged
}

/** Resolved absolute state root. */
function stateRootOf(workspace: string, config: ToolsConfig): string {
  return join(workspace, config.stateDir)
}

/** Process-local lock key scoped by workspace state root and team id. */
function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

/** Process-local lock key enforcing one active team per captain session. */
function captainLockKey(stateRoot: string, captainId: string): string {
  return `captain:${stateRoot}:${captainId}`
}

/** The team this captain currently leads, or a loud failure. */
async function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState> {
  const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id)
  if (team === undefined) {
    throw new Error('you are not leading any team yet — call agent_teams_create first')
  }
  return team
}

/** The team this captain or active member currently participates in. */
async function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState> {
  const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id)
  if (team === undefined) {
    throw new Error('you do not lead or belong to any active team yet')
  }
  return team
}

type ParticipantIdentity =
  | { kind: 'captain'; name: typeof CAPTAIN_KEY }
  | { kind: 'member'; name: string }

/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined {
  if (team.captainSessionId === agentId) return { kind: 'captain', name: CAPTAIN_KEY }
  const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed')
  return member === undefined ? undefined : { kind: 'member', name: member.name }
}

/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (fresh === undefined) throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}

/** Fresh state with captain authorization rechecked inside the lock. */
async function requireFreshCaptainTeam(
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

/** Fresh state and caller identity rechecked inside the lock. */
async function requireFreshParticipant(
  stateRoot: string,
  teamId: string,
  callerId: string,
): Promise<{ team: TeamState; identity: ParticipantIdentity }> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  const identity = participantIdentityOf(fresh, callerId)
  if (identity === undefined) throw new Error(`you are no longer an active participant in team "${fresh.name}"`)
  return { team: fresh, identity }
}

/** Look up one live (non-removed) member by display name. */
function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed')
  if (member === undefined) {
    throw new Error(`no active member named "${name}" in team "${team.name}"`)
  }
  return member
}

/** Look up one task by id. */
function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) {
    throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`)
  }
  return task
}

function requireStagedTeam(team: TeamState): void {
  if (team.phase !== 'staged') {
    throw new Error(`team "${team.name}" is already running; its plan can no longer be edited`)
  }
  if (team.halted === true) throw new Error(`team "${team.name}" is halted, not awaiting plan approval`)
}

function trimmedOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
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

function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

function taskDetails(team: TeamState, task: TeamTask): string {
  return [task.subject, task.description ?? '',
    `Kind: ${task.kind ?? 'work'}`,
    `Objective: ${task.objective ?? ''}`,
    `In scope: ${(task.inScope ?? []).join(', ')}; Out of scope: ${(task.outOfScope ?? []).join(', ')}`,
    `Acceptance: ${(task.acceptance ?? []).join('; ')}`,
    `Verify: ${(task.verify ?? []).join('; ')}`,
    `Dependency results:\n${formatDependencyOutputs(collectCompletedDependencyOutputs(team.tasks, task.id))}`,
  ].join('\n')
}

/** Captain work is immediate, not a durable scheduler lane: allow one unfinished takeover at a time. */
function captainOpenTask(team: TeamState, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === CAPTAIN_KEY
    && !TERMINAL_TASK_STATUSES.includes(task.status))
}

/** Stop every currently-resident member activation for one halted team.
 *
 * Interrupt requests only cancel the member's current model turn and retain its
 * activation. Draining the selected direct children is the stronger lifecycle
 * boundary: it waits for the activation handles to release, so a child cannot
 * keep executing after the captain-chat Stop control has reported success.
 */
async function stopTeamMemberActivations(
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
const RUNTIME_GATE_LOG_LIMIT = 50
const runtimeGateLog: Array<{ at: number; event: string; outcome: string }> = []

/** 记一条运行记录（供 {@link evaluateRuntimeGates} 与夹具共用）。 */
function judgeRuntimeGates(event: string, outcome: string): void {
  runtimeGateLog.push({ at: Date.now(), event, outcome })
  if (runtimeGateLog.length > RUNTIME_GATE_LOG_LIMIT) runtimeGateLog.splice(0, runtimeGateLog.length - RUNTIME_GATE_LOG_LIMIT)
}

/** 运行记录的快照（控制台/夹具读它；返回副本，调用方改不动内部状态）。 */
export function runtimeGateLogSnapshot(): ReadonlyArray<{ at: number; event: string; outcome: string }> {
  return runtimeGateLog.map((entry) => ({ ...entry }))
}

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
 */
async function evaluateRuntimeGates(ctx: Context, event: string, context: unknown): Promise<JsonValue | undefined> {
  if (registry.count('runtime') === 0) return undefined
  let evaluation
  try {
    evaluation = await registry.evaluate('runtime' as never, { ...(context as object), event })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`agent-teams: the runtime gate threw on "${event}" (recorded, not thrown at the caller): ${reason}`)
    judgeRuntimeGates('runtime gate threw', reason)
    return { ok: false, threw: reason } as unknown as JsonValue
  }
  const outcome = evaluation.ok === false
    ? evaluation.unmeasured !== undefined ? `unmeasured: ${evaluation.unmeasured}` : `blocked: ${evaluation.blockers.join('; ')}`
    : evaluation.evaluated === 0 ? `ok (nothing evaluated: ${evaluation.registered} registered, all skipped)` : 'ok'
  judgeRuntimeGates(event, outcome)
  return { ...(evaluation as unknown as Record<string, unknown>), outcome } as unknown as JsonValue
}

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
 */
async function rejectOnContractGates(
  ctx: Context,
  context: Record<string, unknown>,
  what: string,
  inject: Record<string, unknown> = {},
): Promise<void> {
  const gates = await registry.evaluate('contract' as never, { ...context, ...inject })
  if (gates.ok === false) {
    if (gates.unmeasured !== undefined) {
      throw new Error(`${what} rejected: the contract gate could not measure (${gates.unmeasured})`)
    }
    throw new Error(`${what} rejected: ${gates.blockers.join('; ')}`)
  }
  /**
   * ★ 与 completion 位置同一条纪律（t13）：有判据却一条都没跑 ⇒ 只告警、不拒绝。
   *   拒绝会把"这个位置这一轮没有适用判据"（正常情形）变成流程卡死。
   */
  if (gates.evaluated === 0 && gates.registered > 0) {
    ctx.logger.warn(`agent-teams: ${what} reached the contract gate with no gate evaluated (${gates.registered} registered, all skipped); the contract was not checked`)
  }
}

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
type MemberConvergenceObservation = {
  name: string
  /** ★ 与判据 `MemberConvergenceInput['state']` 同一套取值（含 `never-spawned`）。 */
  state: 'idle' | 'reported' | 'working' | 'failed' | 'never-spawned' | 'unknown'
  spoke?: boolean
}

/**
 * 读一个成员会话里【最后一次 assistant 输出是不是空的】。
 *
 * ★ 返回值三态，与判据自己的 `spoke` 三态对齐：
 *   · `true`      —— 观察到了：最近一次输出非空
 *   · `false`     —— 观察到了：最近一次输出是空的（★ 这才是"空回复不是收敛"要抓的）
 *   · `undefined` —— **没能观察**（读不到会话日志 / 一条 assistant 消息都没有）
 */
function observedSpoke(session: unknown): boolean | undefined {
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

/**
 * 观察每个成员的收敛面。
 *
 * ★ 只有【真的读不到】才返回 `undefined`（调用方据此不注入 ⇒ 判据说 unmeasured）。
 *   "读不到"与"读到了一条**可判定的事实**"必须分开 —— 见下面未 spawn 成员那一支。
 */
function observeMemberConvergence(
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

export function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): AgentTeamsRuntime {
  installRetiredMemberGuard(ctx, config.stateDir)
  installMemberDelegationGuard(ctx, config.stateDir, config.memberMaxDepth ?? 0)
  installMailboxAdmission(ctx, config.stateDir)
  const scheduler = installTeamScheduler(ctx, {
    stateDir: config.stateDir,
    executionPrompt: config.executionPrompt,
    dispatch: dispatchMember,
    // ★ 把派发时拿到的隔离基准记下来，供 completion 位置的 r5 / 回测判据使用。
    onWorktree: (taskId, base) => rememberWorktreeBase(taskId, base),
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
     */
    onDispatched: (event) => { void evaluateRuntimeGates(ctx, 'member-dispatched', event) },
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
          } } },
          tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true, description: 'Local reference used by dependencies in this plan; the result maps it to a durable task id.' },
            subject: { type: 'string', required: true }, description: { type: 'string' }, assignee: { type: 'string' },
            dependencies: { type: 'array', items: { type: 'string' } },
          } } },
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
      const created = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
        const current = await findTeamByParticipant(stateRoot, captain.id)
        if (current !== undefined) {
          const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to'
          const guidance = current.captainSessionId === captain.id
            ? 'Use agent_teams_status and continue the existing team. Do not delete and recreate it merely to continue work. End it only when the user explicitly wants a separate new team.'
            : 'Continue your assigned member work and report to your captain; do not create a separate team.'
          throw new Error(`you already ${relationship} team "${current.name}" (id ${current.id}). ${guidance}`)
        }
        return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
          const existing = await readTeam(stateRoot, teamId)
          if (existing !== undefined) {
            throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`)
          }
          if (profileName === undefined && args.plan === undefined) {
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
            inlinePlan: args.plan,
            description: args.description,
            staged,
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
      if (snapshot.profile === undefined && args.plan === undefined) {
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
          return {
            action: 'add_task',
            subject,
            description: operation.description,
            assignee: operation.assignee,
            dependencies: operation.dependencies ?? [],
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
        dependencies: updated.tasks.reduce((sum, task) => sum + task.dependencies.length, 0),
        roster: updated.members.map((member) => `${member.name} (${member.role || 'member'}; ${member.provider ?? ''}/${member.model ?? ''})`),
        graph: updated.tasks.map((task) => `${task.id}: ${task.subject} -> ${task.assignee || 'shared'}${task.dependencies.length === 0 ? '' : `; depends on ${task.dependencies.join(', ')}`}`),
      }
    },
  }))

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

  ctx.tools.register(defineTool({
    name: 'agent_teams_add_member',
    description: 'Add a member to the team roster. Planning and idle roster rows do not call a model. After approval, the member session starts with its first ready task or explicit message and remains durable for later work.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
      role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
      provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
      model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
      reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
      executionPrompt: { type: 'string', description: 'Optional member-specific execution prompt. It remains editable while staged.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          member_id: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          reasoning_effort: { type: 'string' },
          status: { type: 'string', required: true },
          phase: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.phase === 'staged'
          ? `Member "${value.member_name}" added to the staged roster (${value.provider}/${value.model}); no child was spawned.`
          : `Member "${value.member_name}" added (session ${value.member_id || 'starts with first ready task'}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const memberName = args.name.trim()
        if (memberName === '') throw new Error('member name must not be empty')
        const memberKey = sanitizeKey(memberName)
        if (memberKey === CAPTAIN_KEY) {
          throw new Error(`member name "${args.name}" is reserved for the captain`)
        }
        if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
          throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`)
        }
        if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
          throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`)
        }
        const selection = await resolveMemberLlmSelection(ctx, captain, {
          provider: args.provider,
          model: args.model,
          defaultModel: config.memberModel,
          reasoningEffort: args.reasoning_effort,
          fallback: config.fallback,
        }, exec.signal)
        const member: TeamMember = {
          id: '',
          name: memberName,
          role: args.role,
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
          ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
          executionPrompt: trimmedOptional(args.executionPrompt),
          joinedAt: Date.now(),
          status: 'idle',
        }
        await validateMemberLlmSelections(ctx, [selection], exec.signal)
        fresh.members.push(member)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
          teamId: fresh.id,
          memberId: member.id,
          name: member.name,
          ...member.role !== undefined ? { role: member.role } : {},
        })
        return {
          member_name: member.name,
          member_id: member.id,
          provider: selection.provider,
          model: selection.model,
          ...selection.reasoningEffort === undefined
            ? {}
            : { reasoning_effort: selection.reasoningEffort },
          status: member.status,
          phase: fresh.phase ?? 'running',
        }
      })
      await scheduler.kickMember(workspace, team.id, created.member_name, captain)
      const latest = (await readTeam(stateRoot, team.id))?.members.find(member => member.name === created.member_name)
      return latest === undefined ? created : { ...created, member_id: latest.id, status: latest.status }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_remove_member',
    description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name of the member to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const member = fresh.members.find(item => item.name === args.name)
        if (member === undefined) throw new Error(`no member \"${args.name}\" in team \"${fresh.name}\"`)
        const requeued: string[] = []
        for (const task of fresh.tasks) {
          if (task.assignee !== member.name || task.status === 'completed') continue
          invalidateTaskAttempt(task)
          task.reassigning = false
          requeued.push(task.id)
        }
        member.status = 'removed'
        await discardMailboxMessages(stateRoot, fresh.id, member.name, (await readUnreadMailbox(stateRoot, fresh.id, member.name)).map(message => message.id))
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
          teamId: fresh.id,
          memberId: member.id,
        })
        return { member: { ...member }, requeued }
      })
      if (revoked.member.id !== '') {
        await recordRetiredMemberIds(stateRoot, [revoked.member.id])
        await stopTeamMemberActivations(ctx, captain, [revoked.member], exec.signal)
      }
      await scheduler.kickTeam(workspace, team.id, captain)
      return {
        member_name: revoked.member.name,
        status: revoked.member.status,
        requeued_tasks: revoked.requeued,
      }
    },
  }))

  ctx.tools.register(defineTool({
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
        await rejectOnContractGates(ctx, { team: fresh, task, creating: true }, 'create_task', {
          execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
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
        })
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
          teamId: fresh.id,
          taskId: task.id,
          subject: task.subject,
          dependencies: task.dependencies,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.kind === undefined ? {} : { kind: task.kind },
          ...task.round === undefined ? {} : { round: task.round },
        })
        return {
          task_id: task.id,
          subject: task.subject,
          status: task.status,
          kind: taskKindOf(task),
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...contractRuntimeRecord === undefined ? {} : { runtime_gates: contractRuntimeRecord },
        }
      })
      await scheduler.kickTeam(workspace, team.id, captain)
      return created
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_reassign_task',
    description: 'Atomically retry, reassign, or let the captain take over one ready unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" only when you will finish that task in this turn; a captain can own only one unfinished takeover at a time, and an unfinished takeover returns to the member pool when the captain becomes idle.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
      assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
      reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          previous_assignee: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const target = args.assignee.trim()
      if (target === '') throw new Error('reassignment assignee must not be empty')

      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.status === 'completed') throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`)
        if (task.reassigning === true) {
          const previousMember = fresh.members.find(member => member.id === task.handoffFromMemberId && member.stopping === true)
          if (task.assignee !== target || previousMember === undefined) throw new Error(`task ${task.id} is already being reassigned`)
          return { previousAssignee: previousMember.name, previousMember: { ...previousMember }, handoffId: task.handoffId }
        }
        const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target)
        if (target === CAPTAIN_KEY) {
          const busy = captainOpenTask(fresh, task.id)
          if (busy !== undefined) {
            throw new Error(`captain is busy with ${busy.id}; complete or reassign it before taking over ${task.id}`)
          }
          const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
          if (pending.length > 0) {
            throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them before captain takeover`)
          }
        } else if (targetMember !== undefined) {
          const busy = memberOpenTask(fresh, targetMember.name, task.id)
          if (busy !== undefined) {
            throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`)
          }
        }
        const previousAssignee = task.assignee ?? ''
        const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
          || task.assignee === undefined || task.assignee === CAPTAIN_KEY
          ? undefined
          : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed')
        invalidateTaskAttempt(task, target, true)
        if (previousMember !== undefined) {
          previousMember.stopping = true
          task.handoffFromMemberId = previousMember.id
          await discardMailboxMessages(stateRoot, fresh.id, previousMember.name, (await readUnreadMailbox(stateRoot, fresh.id, previousMember.name)).map(message => message.id))
        }
        await writeTeam(stateRoot, fresh)
        return {
          previousAssignee,
          previousMember: previousMember === undefined ? undefined : { ...previousMember },
          handoffId: task.handoffId,
        }
      })

      let quiescenceError: unknown
      if (revoked.previousMember !== undefined) {
        try {
          await stopTeamMemberActivations(ctx, captain, [revoked.previousMember], exec.signal)
        } catch (error: unknown) {
          quiescenceError = error
        }
      }

      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
          throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`)
        }
        task.reassigning = quiescenceError !== undefined
        if (quiescenceError === undefined) {
          const previous = fresh.members.find(member => member.id === revoked.previousMember?.id)
          if (previous !== undefined) delete previous.stopping
          delete task.handoffFromMemberId
        }
        if (quiescenceError === undefined && target === CAPTAIN_KEY) {
          beginTaskAttempt(task, CAPTAIN_KEY)
          // The captain is already in the turn that requested takeover; there
          // is no later member claim handshake to move claimed -> in_progress.
          task.status = 'in_progress'
          task.updatedAt = Date.now()
        }
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
          ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
        })
      })
      if (quiescenceError !== undefined) throw quiescenceError
      if (target !== CAPTAIN_KEY) await scheduler.kickMember(workspace, team.id, target, captain)
      const current = await readTeam(stateRoot, team.id)
      const task = current === undefined ? undefined : requireTask(current, args.task_id)
      if (task === undefined) throw new Error(`team "${team.name}" ended during reassignment`)
      return {
        task_id: task.id,
        previous_assignee: revoked.previousAssignee,
        assignee: task.assignee ?? '',
        status: task.status,
        attempt: task.attempt ?? 0,
        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_claim_task',
    description: 'Members claim their own ready task or read their existing attempt_id. Captains must use reassign_task to assign and wake a member; claim_task does not dispatch work. A member cannot own a second unfinished task. The returned attempt_id is required for updates and becomes stale after retry/reassignment.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to claim.' },
      assignee: { type: 'string', description: 'Deprecated: claim_task only supports a member claiming its own task. Captains must use reassign_task.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
          task_details: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).\n${value.task_details}`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (task.reassigning === true) {
          throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`)
        }
        let assignee = task.assignee
        if (identity.kind === 'captain') {
          // A captain may read the capability of its already-started takeover,
          // but must never create a member claim without dispatching it (#125).
          if (args.assignee !== undefined || task.assignee !== CAPTAIN_KEY
              || (task.status !== 'claimed' && task.status !== 'in_progress')) {
            throw new Error('claim_task is for members claiming their own task; captains must use agent_teams_reassign_task to assign and wake a member')
          }
        } else {
          if (args.assignee !== undefined) {
            throw new Error('members cannot set assignee when claiming a task')
          }
          if (assignee !== undefined && assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${assignee}", not you`)
          }
          assignee = identity.name
        }
        // Authorization must happen before the idempotent return: another
        // member must not receive a false success for somebody else's task.
        if (task.status === 'claimed' || task.status === 'in_progress') {
          if (assignee === undefined || task.assignee !== assignee) {
            throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`)
          }
          return {
            task_details: taskDetails(fresh, task),
            task_id: task.id,
            status: task.status,
            assignee,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          }
        }
        const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
        if (pending.length > 0) {
          throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`)
        }
        const transition = transitionError(task.status, 'claimed')
        if (transition !== undefined) throw new Error(transition)
        if (assignee === undefined) {
          throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)')
        }
        const busy = memberOpenTask(fresh, assignee, task.id)
        if (busy !== undefined) {
          throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`)
        }
        const attemptId = beginTaskAttempt(task, assignee)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
        })
        return {
          task_details: taskDetails(fresh, task),
          task_id: task.id,
          status: task.status,
          assignee: task.assignee ?? '',
          attempt: task.attempt ?? 0,
          attempt_id: attemptId,
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_update_task',
    description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable, but owners and the captain can append acceptanceResults/commandsRun/evidence_note as attributed supplemental evidence, without reclaiming or changing the verdict. A captain must use reassign_task(assignee="captain") before updating active member-owned work.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to update.' },
      attempt_id: { type: 'string', description: 'Members must explicitly include the current attempt_id from their assignment/claim in EVERY update, including failed reviews with findings. If omitted, retry with the same current id; omission does not revoke the attempt.' },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed', 'cancelled'],
        description: 'New status (in_progress, completed, failed, cancelled).',
      },
      output: { type: 'string', description: 'Original result summary; immutable after completion/failure.' },
      evidence_note: { type: 'string', description: 'Append-only supplementary observation on a terminal task. Does not reopen work or change the original result.' },
      verdict: {
        type: 'string',
        enum: ['pass', 'needs_revision', 'reject'],
        description: 'Required for completing requirements/review. needs_revision and reject must fail the task.',
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'], required: true },
            problem: { type: 'string', required: true },
            requiredFix: { type: 'string', required: true },
            file: { type: 'string' },
            line: { type: 'number' },
            resolved: { type: 'boolean' },
          },
        },
        description: 'Structured review findings. Required when verdict is needs_revision or reject; each item needs id, severity, problem, and requiredFix.',
      },
      changedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Workspace-relative POSIX paths changed by this implementation/repair.',
      },
      acceptanceResults: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            criterion: { type: 'string', required: true },
            status: { type: 'string', enum: ['passed', 'failed'], required: true },
            evidence: { type: 'string' },
          },
        },
        description: 'Acceptance evidence in contract order: {criterion, status:"passed"|"failed", evidence?}. Supply one item per acceptance criterion.',
      },
      commandsRun: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', required: true },
            status: { type: 'string', enum: ['passed', 'failed'], required: true },
            exitCode: { type: 'number' },
            evidence: { type: 'string' },
          },
        },
        description: 'Verification evidence in contract order: {command, status:"passed"|"failed", exitCode?, evidence?}. Supply one item per verify command.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          output: { type: 'string' },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
          evidence_count: { type: 'number' },
          follow_up: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}${value.evidence_count === undefined ? '' : `\nSupplemental evidence records: ${value.evidence_count}. Original result unchanged.`}${value.follow_up ? `\n${value.follow_up}` : ''}`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      let followUpMessage: import('./types.ts').TeamMessage | undefined
      const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (identity.kind === 'captain'
          && task.assignee !== undefined
          && task.assignee !== CAPTAIN_KEY
          && !TERMINAL_TASK_STATUSES.includes(task.status)
          && !(args.status === 'cancelled' && task.status === 'pending' && (task.attempt ?? 0) === 0 && task.reassigning !== true)) {
          throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`)
        }
        if (identity.kind === 'member') {
          if (task.assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
          }
          if (task.attemptId !== undefined && (args.attempt_id === undefined || args.attempt_id.trim() === '')) {
            throw new Error(`missing attempt_id for task ${task.id}. Retry this update with attempt_id="${task.attemptId}" from your current assignment. This is a missing parameter, not a revoked attempt; do not restart the work or request reassignment.`)
          }
          if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
            throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`)
          }
        }
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          const appended = appendTaskEvidence(task, {
            ...args, findings: parseFindings(args.findings), changedPaths: normalizeBlankOptionalTaskFields(args).changedPaths,
            acceptanceResults: parseAcceptanceResults(args.acceptanceResults), commandsRun: parseCommandResults(args.commandsRun),
          }, identity.name)
          if (appended) await writeTeam(stateRoot, fresh)
          return {
            evidence_count: task.supplementalEvidence?.length ?? 0,
            task_id: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            ...task.output !== undefined ? { output: task.output } : {},
          }
        }
        if (args.evidence_note?.trim()) throw new Error('evidence_note is for terminal tasks; record active work with output and structured evidence')
        // Blank optional list entries (e.g. changedPaths:[""]) must not be
        // persisted: hasValidQualityTaskFields rejects them on reload and
        // would brick the whole team state (issue #105 class).
        const input = normalizeBlankOptionalTaskFields(args)
        const findings = parseFindings(args.findings)
        const acceptanceResults = parseAcceptanceResults(args.acceptanceResults)
        const commandsRun = parseCommandResults(args.commandsRun)
        /**
         * ── ★ 判据层（可插拔）────────────────────────────────────────────────────
         *
         * 这一段此前【硬编码】了"重跑 verify"这一条判据。现在它只是
         * `registry.evaluate('completion', ...)` 的一次调用 —— 编排层不知道
         * 那个位置挂了哪些判据、也不知道它们的语义（契约 `docs/GATE-REGISTRY.md` §8）。
         *
         * ⇒ 换/加/删判据 = 改 `src/gates/index.mjs` 的清单一行，**不碰本文件**。
         *
         * 执行器在这里注入（本文件是这一层唯一做 I/O 的地方；判据本身是纯数据变换）。
         * 只在【非终态 → completed】时给出执行器：终态补证据（issue159）不是新的
         * 完成裁决。判据自己 `appliesTo` 也会跳过那种情形 —— 两处都表达同一条边界，
         * 是因为执行器缺席这条路径也必须能被审计。
         */
        /**
         * ── ★ 归属证据：这个成员【真的写过】哪些文件 ─────────────────────────────
         *
         * `dispatch.changed-paths` 需要"自报的 changedPaths 与真实写入是否对得上"。
         * 真相来自该成员自己的会话事件（dsh-tool-fs 挂在 tool/result 上的 meta.diffs），
         * 经 `observedChangedPaths(caller.session)` 折叠成一组路径。
         *
         * ★ 这正是 START-HERE §5③ 那个"共同障碍"的解法：git 只知道工作区脏了，
         *   而会话事件是逐成员的 ⇒ 不需要 worktree，也不需要改 cwd（§5②）。
         *
         * ★ 队长代报（caller 是队长）时拿不到成员会话 ⇒ 观察缺席 ⇒ 判据 unmeasured，
         *   而不是被当成通过。这是刻意的：没能观察就不能声称它诚实。
         */
        const dispatchGates = await registry.evaluate('dispatch', {
          task,
          update: { changedPaths: input.changedPaths },
          observedChangedPaths: observedChangedPaths(caller.session),
        })
        /**
         * ── ★ runtime 位置（跨步骤的过程约束，契约 §5）───────────────────────────
         *
         * 成员开始干活 + 改契约/建任务之后，把"这一步发生过"交给 runtime 判据。
         * ★ 它返回任何裁决都【不得阻止流程】—— 上面 dispatch 位置的拒绝逻辑在本
         *   调用点之后照常执行，本调用点对控制流零影响。理由见 `evaluateRuntimeGates`。
         */
        let runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update', {
          task,
          update: { status: args.status, output: args.output, verdict: args.verdict as ReviewVerdict | undefined },
          updateGate: dispatchGates,
          wantsCompleted: args.status === 'completed',
        })
        if (dispatchGates.ok === false) {
          if (dispatchGates.unmeasured !== undefined) {
            /**
             * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
             *   看出"判据没能测量"，而不是"判据发现了问题"。
             */
            throw new Error(`update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`)
          }
          throw new Error(`update_task rejected: ${dispatchGates.blockers.join('; ')}`)
        }
        /**
         * ── ★ 注入面：让每条判据拿到它声明的输入（缺则缺席，不注入空值）─────────
         *
         * 每一项都只做【读】。拿不到 ⇒ 该字段不出现在 ctx 里 ⇒ 判据自己说
         * "我没能测量"。**绝不在这里替判据决定"那就算通过"。**
         */
        const changedFiles = input.changedPaths ?? task.changedPaths ?? []
        const worktreeBase = worktreeBaseOf(task.id)
        const [changedLines, observedFiles] = await Promise.all([
          changedLineNumbers(workspace, worktreeBase),
          Promise.resolve(observedChangedPaths(caller.session)),
        ])
        /**
         * `newTestFiles`：本任务【新增】的测试文件。
         *
         * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
         * 取那些"在声明范围内、且看起来是测试"的路径。
         * ★ 观察不到（`undefined`）⇒ 不注入 ⇒ r5 的 appliesTo 为假 ⇒ skipped。
         *   这与"观察到了、确实没有新测试"（`[]`）不同形 —— 后者仍是 skipped
         *   （没有测试就没有红前绿后可测），但成因不同，判据自己会表达。
         */
        /**
         * `newTestFiles`：本任务【新增】的测试文件。
         *
         * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
         * 取那些看起来是测试的路径。
         *
         * ★ 只在【这一次确实试图置为 completed】时注入 —— 这是刻意的调用方纪律，
         *   与 `execVerifyCommand` 的既有先例一致（那条也只在"非终态 → completed"
         *   时给出执行器）。
         *
         * 由来（MEASURED，2026-10-05，t7）：`completion.r5` 的 `appliesTo` 只问
         * `kind ∈ {implementation, repair}` 与 `newTestFiles` 是否为数组，**不看
         * 完成意图** —— 而它的三条兄弟判据（verify-rerun / mutation / backtest）
         * 都带 `wantsCompleted === true` 守卫。实测：
         *
         *     r5.appliesTo({ kind:'implementation', newTestFiles:[…], wantsCompleted:false }) ⇒ true
         *
         * 于是"成员开始干活"（in_progress）那一步也会被"红前绿后"审判，而那时
         * 父版本/扫描范围都还没有 ⇒ 一条【开始工作】的更新被 rejected。
         * 这个缺陷此前被"newTestFiles 永不注入"掩盖着（r5 恒 skipped），注入面一补齐
         * 就露出来。⇒ 在这里收口：不把"有没有新测试"这件事在非完成更新里提出去，
         * 于是 r5 在那些更新上按自己的契约 skipped，与三条兄弟判据行为一致。
         *
         * ★ 观察不到写入（`undefined`）⇒ 不注入（不是注入 `[]`）—— 缺席意味着
         *   "我没能观察"，而 `[]` 意味着"观察了、确实没有新测试"。两者不同形。
         */
        const isTestPath = (path: string): boolean =>
          /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
        /** 观察到的测试文件（杀变异体用）—— 与"本次新增"无关，既有的也算。 */
        const observedTestFiles = observedFiles === undefined ? undefined : observedFiles.filter(isTestPath)
        const newTestFiles = args.status !== 'completed' || observedTestFiles === undefined
          ? undefined
          : observedTestFiles
        /**
         * 基准 = 【在父版本上跑一遍任务的 verify 命令】的退出码。
         *
         * 不注入（返回 undefined）的两种情形，都保持"没测到"：
         *   · 任务没有声明 verify ⇒ 没有可跑的东西（回测的 L1 前置要求基准先绿）；
         *   · 跑不起来（工作区不是 git 仓库、版本取不到…）⇒ 不能拿 0 充数。
         */
        const baselineExit = async (revision: string): Promise<number | undefined> => {
          const commands = task.verify ?? []
          if (commands.length === 0) return undefined
          /**
           * ★ 基准 = 在【父版本】上跑一遍本任务的 verify 命令。
           *
           * 有一个必须说清的前提：本任务【新增的测试】在父版本上本来就是红的
           * （否则 R5 会说它是装饰性测试）。所以把整套命令原样搬到父版本上跑，
           * 基准必然不绿 ⇒ 回测说"无法归因、这红不是这次改动的错" ——
           * **那是判据在正确地工作**，不是缺陷。
           *
           * ⇒ 基准要问的是另一个问题：「在这次改动【之前】，这套测试是绿的吗」。
           *   也就是把命令里【本次新增的测试文件】剔掉，跑【改动前就存在的那部分】。
           *   两者是不同的问句：
           *     R5      ：新测试在父版本上红吗？      （它在不在证明什么）
           *     回测 L1 ：改动之前这里本来就是绿的吗？（红了能不能归因）
           *   把它们混成一条命令，两条判据就会互相打架 —— 而"打架"的表现是
           *   一个**永远无法归因**的基准，读起来像基础设施坏了。
           *
           * ★ 剔掉的只有【本次新增的测试】（`newTestFiles`）—— 既有的测试一条不少，
           *   也不去猜"哪些测试相关"。
           */
          const added = new Set(newTestFiles ?? [])
          const withoutNewTests = commands
            .map((command) => command.split(/\s+/).filter((token) => !added.has(token)).join(' '))
            .map((command) => command.trim())
            .filter((command) => command !== '')
          if (withoutNewTests.length === 0) return undefined
          const results = await Promise.all(withoutNewTests.map(async (command) => (
            runInDetachedRevision({ workspace, revision, command })
          )))
          if (results.some((code) => code === undefined)) return undefined
          // 基准取【最坏的一条】：任何一条在父版本上不绿 ⇒ 基准就不是绿的，
          // 而"基准不绿"时回测的正确结论是"无法归因"（判据自己会说）。
          return Math.max(...(results as number[]))
        }
        /**
         * ★ 基准的【声称】与它的【证据】必须分清：
         *   · label 有了（父版本 hash 可追溯，供人工追溯）；
         *   · exitCode 必须来自【真的在父版本上跑过一次】—— 见下面的 `baselineExit`。
         *   拿不到就跑不出退出码 ⇒ 保持 `undefined`：判据会说"基准没有退出码，
         *   所以它区分不了『绿』与『没测』"。**绝不能**在这里填一个 0 充数 ——
         *   那正是把"没测到"伪装成"基准是绿的"。
         */
        const baseline = worktreeBase === undefined
          ? undefined
          : { label: worktreeBase, exitCode: await baselineExit(worktreeBase) }
        /**
         * ★ 回测的依赖图 / 覆盖数据。与跑测试一样是 I/O，所以在这一层做；
         *   拿不到就【不注入】⇒ 判据说"没有依赖图数据"（不是"选了 0 条"）。
         */
        const coverageInput = await deriveCoverageInput({
          workspace,
          testFiles: observedTestFiles ?? [],
          knownTests: observedTestFiles ?? [],
        })
        const wantsCompleted = args.status === 'completed'
        const completionGates = await registry.evaluate('completion', {
          task,
          update: {
            status: args.status,
            output: args.output,
            verdict: args.verdict as ReviewVerdict | undefined,
            findings,
            changedPaths: input.changedPaths,
            acceptanceResults,
            commandsRun,
            ...newTestFiles === undefined ? {} : { newTestFiles },
          },
          wantsCompleted,
          taskNotTerminal: !TERMINAL_TASK_STATUSES.includes(task.status),
          execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
          // ── r5：父版本 + 扫描范围 + 在指定版本上跑一条测试的执行器
          ...worktreeBase === undefined ? {} : { parentRevision: worktreeBase },
          ...worktreeBase === undefined ? {} : { worktreePath: workspace },
          scanDirs: deriveScanDirs(changedFiles),
          /**
           * ★ 在【父版本 / 修复版本】上跑一条测试。
           *
           * 实现要点（每一条都是踩出来的）：
           *   · 成员的工作区通常是**脏的**（它刚改了文件）⇒ `git checkout` 会拒绝。
           *     所以用 `git worktree` 临时检出一个干净副本去跑，而不是在原地切换 ——
           *     原地切换既会因脏工作区失败，也可能把成员的改动弄丢。
           *   · 跑完必须把临时检出删掉（finally），否则每次完成都漏一个目录。
           *   · 拿不到整数退出码 ⇒ `exitCode: undefined` ⇒ 判据 unmeasured。
           *     **绝不**把跑不起来当成 0（"没测到"不得并进"通过"）。
           */
          runTestOnRevision: async (test: string, revision: string) => {
            /**
             * ★ `'working-tree'` 是 R5 约定的【修复版本】哨兵值 —— 表示"成员现在
             *   交出来的那份树"，而它**不是**一个 git 引用（`git worktree add`
             *   对它必然失败）。这是判据与调用方之间的一个约定，不是笔误。
             *   ⇒ 它跑在【工作区本身】上；只有父版本才需要检出到一个干净副本。
             */
            if (revision === 'working-tree') {
              return { exitCode: await runVerifyCommand(workspace, `node --test ${test}`) }
            }
            const exitCode = await runInDetachedRevision({
              workspace, revision, command: `node --test ${test}`,
            })
            return exitCode === undefined ? {} : { exitCode }
          },
          // ── mutation：三个执行器 + 只变异改动行
          readFile: (path: string): string => readWorkspaceFileSync(workspace, path),
          writeFile: (path: string, contents: string): void => writeWorkspaceFileSync(workspace, path, contents),
          /**
           * ★ 变异判据的 runTest 必须交回【输出】，不只是退出码：
           *   杀伤率 = 被杀的变异体 / 全部变异体，而"某次运行里有几条测试失败"只能从
           *   输出里读出来（判据用 parseTestSummary 解析 `ℹ pass N` / `# pass N`）。
           *   只给退出码 ⇒ 判据会说"套件没报告可读的摘要"⇒ unmeasured。
           */
          runTest: async (command: string) => await runVerifyCommandCaptured(workspace, command),
          ...changedLines === undefined ? {} : { changedLines },
          changedFiles,
          /**
           * ★ 杀手套件：变异判据【要求显式声明】，没有回退（见 mutation.ts 文件头
           *   —— 一个没被声明的套件会让"存活者"变成关于探针的事实，而不是关于测试
           *   的事实）。
           *
           * 这里声明的来源是【会话事件观察到的测试文件】—— 与 newTestFiles 同源，
           * 但语义不同、不能合并：
           *     newTestFiles  = 本次【新增】的测试（R5 拿它跑红前绿后）
           *     killerSuites  = 拿哪些测试去杀变异体（既有的测试也算）
           * 把后者写成前者，"这次没新增测试"就会变成"没有杀手套件"⇒ unmeasured。
           *
           * ★ 观察不到 ⇒ 不注入 ⇒ 判据 unmeasured。**不猜、不回退到全套。**
           */
          ...observedTestFiles === undefined || observedTestFiles.length === 0
            ? {}
            : { killerSuites: observedTestFiles.map((file) => ({ id: file, files: [file] })) },
          testCommand: 'node --test *',
          // ── backtest：基准 + 覆盖证据 + 两个执行器
          ...baseline === undefined ? {} : { baseline },
          ...coverageInput === undefined ? {} : { coverage: coverageInput },
          /**
           * ★ 回测的执行器收的是【一个标签】，不是一条 shell 命令：
           *   `'full'`（全量）与选测标签。它们的能力是"跑整套测试"，而**整套测试
           *   是哪些**由本层决定（判据不知道本仓库的测试怎么跑，那是调用方的知识）。
           *   ⇒ 直接把标签丢给 sh 会得到 127（command not found），而那会被读成
           *     "全量红了 ⇒ 这次改动弄坏了东西" —— 一次基础设施工况伪装成关于代码的结论。
           *
           * ★ 全量 = 任务声明的 verify 命令（那正是"本任务认为什么算全量"）。
           *   跑不起来 ⇒ 127（非零）⇒ 判据按"全量红"处理并拒绝。
           *   **不把跑不起来伪装成绿。**
           */
          execBacktestCommand: async (): Promise<number> => {
            const commands = task.verify ?? []
            if (commands.length === 0) return 127
            const codes = await Promise.all(commands.map((command) => runVerifyCommand(workspace, command)))
            return Math.max(...codes)
          },
          execSelectedCommand: async (): Promise<number> => {
            const commands = task.verify ?? []
            if (commands.length === 0) return 127
            const codes = await Promise.all(commands.map((command) => runVerifyCommand(workspace, command)))
            return Math.max(...codes)
          },
        })
        /**
         * ── ★ t13 的运行时出口：有判据、却一条都没跑 ────────────────────────────
         *
         * `evaluated === 0 && registered > 0` 意味着这一轮**没有任何判据真的检查过**
         * 这个完成动作，而 `ok` 仍为 true。**只告警、不拒绝** —— 拒绝会把"这个位置
         * 这一轮没有适用判据"（正常情形）变成流程卡死，那正是 t13 明确要求保住的边界。
         * 但它必须【可读】：否则一次静默全跳过只有 `ok: true` 留给读日志的人。
         */
        if (completionGates.evaluated === 0 && completionGates.registered > 0) {
          ctx.logger.warn(
            `agent-teams: update_task for task "${task.id}" reached completion with no gate evaluated (${completionGates.registered} registered, all skipped); this step was not checked`,
          )
        }
        if (completionGates.ok === false) {
          if (completionGates.unmeasured !== undefined) {
            /**
             * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
             *   看出"判据没能测量"，而不是"判据发现了问题"。
             */
            throw new Error(`update_task rejected: the completion gate could not measure (${completionGates.unmeasured})`)
          }
          throw new Error(`update_task rejected: ${completionGates.blockers.join('; ')}`)
        }
        /**
         * 判据【通过时】交出的产出：把判据层亲眼看到的 exitCode 并回 commandsRun，
         * 让落盘的是它看到的那个，而不是成员自报的。
         */
        const producedReruns = (completionGates.outputs['completion.verify-rerun']?.reruns ?? []) as CommandResult[]
        const mergedCommandsRun = producedReruns.length > 0
          ? mergeRerunIntoCommandsRun(commandsRun ?? task.commandsRun, producedReruns)
          : commandsRun
        const gate = evaluateQualityCompletion(task, {
          status: args.status,
          output: args.output,
          verdict: args.verdict as ReviewVerdict | undefined,
          findings,
          changedPaths: input.changedPaths,
          acceptanceResults,
          commandsRun: mergedCommandsRun ?? commandsRun,
        })
        if (!gate.ok) throw new Error(gate.error ?? 'update_task rejected by quality gates')
        if (args.status !== undefined) {
          const transition = transitionError(task.status, args.status)
          if (transition !== undefined) throw new Error(transition)
          task.status = args.status
        }
        if (args.output !== undefined) task.output = args.output
        if (args.verdict !== undefined) task.verdict = args.verdict as ReviewVerdict
        if (findings !== undefined) task.findings = findings
        if (input.changedPaths !== undefined) task.changedPaths = input.changedPaths
        if (acceptanceResults !== undefined) task.acceptanceResults = acceptanceResults
        if (commandsRun !== undefined) task.commandsRun = commandsRun
        task.updatedAt = Date.now()
        const priorDependencies = new Map(fresh.tasks.map(item => [item.id, [...item.dependencies]]))
        const followUp = (task.status === 'failed' && (task.verdict === 'needs_revision' || task.verdict === 'reject'))
          ? applyQualityFollowUp(fresh, task)
          : undefined
        let followUpSummary: string | undefined
        if ((followUp?.created.length ?? 0) > 0) {
          const rewired = fresh.tasks.filter(item => priorDependencies.has(item.id) && JSON.stringify(priorDependencies.get(item.id)) !== JSON.stringify(item.dependencies))
          followUpSummary = `Automatic quality follow-up for ${task.id}: ${followUp!.created.map(item => `${item.id} (${item.kind}, owner=${item.assignee ?? 'unassigned'}, deps=${item.dependencies.join(',') || 'none'})`).join('; ')}.${rewired.length ? ` Updated dependencies: ${rewired.map(item => `${item.id} -> ${item.dependencies.join(',')}`).join('; ')}.` : ''} Use these tasks; do not create duplicate repair/review work.`
          followUpMessage = createMessage(CAPTAIN_KEY, CAPTAIN_KEY, followUpSummary)
        }
        if (followUp?.escalated === true) {
          await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(
            CAPTAIN_KEY,
            CAPTAIN_KEY,
            `Quality-gate loop escalated after ${task.id} (${task.kind ?? 'review'} verdict=${task.verdict}). Automatic repair/review stopped.`,
          ))
        }
        await writeTeam(stateRoot, fresh)
        /**
         * ── ★ runtime 位置：这一步【做完了】（契约 §5）───────────────────────────
         *
         * 上面的调用点看的是"意图"（`args.status`），这里看的是"结果"（落盘后的 task）。
         * 两者不同形不是重复：一条运行判据可能想问"这个成员是不是在一个已超时的会话里
         * 报了完成"—— 而在意图那一刻还看不出来。仍然：**任何裁决都不阻止流程** ——
         * 状态已经写下去了，本调用点做的事只有记录。
         */
        runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update-settled', {
          task,
          update: { status: task.status, output: task.output, verdict: task.verdict },
          updateGate: completionGates,
          wantsCompleted,
        })
        if (followUpMessage !== undefined) await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, followUpMessage)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.output !== undefined ? { output: task.output } : {},
          ...task.verdict === undefined ? {} : { verdict: task.verdict },
          ...task.round === undefined ? {} : { round: task.round },
        })
        for (const created of followUp?.created ?? []) {
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-created', {
            teamId: fresh.id,
            taskId: created.id,
            subject: created.subject,
            dependencies: created.dependencies,
            ...created.assignee === undefined ? {} : { assignee: created.assignee },
            ...created.kind === undefined ? {} : { kind: created.kind },
            ...created.round === undefined ? {} : { round: created.round },
          })
        }
        return {
          ...followUpSummary === undefined ? {} : { follow_up: followUpSummary },
          task_id: task.id,
          status: task.status,
          attempt: task.attempt ?? 0,
          ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          ...task.output !== undefined ? { output: task.output } : {},
          /**
           * ★ runtime 位置的裁决【随返回值一起交出去】。
           *
           * 缺席（这个事件类型没有挂 runtime 判据）⇒ 字段不出现。**不是** `ok` ——
           * 把"这里没有过程约束"读成"过程约束通过了"，正是三态要防的那种合流。
           */
          ...runtimeGateRecord === undefined ? {} : { runtime_gates: runtimeGateRecord },
        }
      })
      if (followUpMessage !== undefined) {
        const captain = ctx.agents.get(team.captainSessionId as SessionId)
        if (captain !== undefined && steerCaptainReport(captain, CAPTAIN_KEY, followUpMessage.content, mailboxPrompt(team.id, CAPTAIN_KEY, [followUpMessage]))) {
          await withTeamLock(teamLockKey(stateRoot, team.id), () => markMailboxDelivered(stateRoot, team.id, CAPTAIN_KEY, [followUpMessage!.id]))
        }
      }
      await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined)
      return updated
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_amend_task',
    description: 'Captain-only controlled contract amendment for one non-terminal quality task: replace a wrong objective/acceptance/verify/inScope/outOfScope when the original contract makes honest completion impossible (for example a verify command that cannot pass, or an inScope that forbids the file the objective names). The amendment is appended to the task\'s revisions ledger with previous values and the reason, and is rejected once a review/requirements task has passed judgment on this task. Members cannot amend contracts; the implementer re-reads the amended contract before its next quality gate. Lists are full replacements, not deltas.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task whose contract is being amended.' },
      reason: { type: 'string', required: true, description: 'Why the current contract is wrong; recorded in the revisions ledger.' },
      objective: { type: 'string', description: 'Replacement objective.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'Replacement acceptance criteria (full list, not a delta).' },
      verify: { type: 'array', items: { type: 'string' }, description: 'Replacement verification commands (full list, not a delta).' },
      inScope: { type: 'array', items: { type: 'string' }, description: 'Replacement workspace-relative inScope paths (full list).' },
      outOfScope: { type: 'array', items: { type: 'string' }, description: 'Replacement workspace-relative outOfScope paths (full list).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          revised_fields: { type: 'string', required: true },
          revision_count: { type: 'number', required: true },
          contract: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} contract amended (${value.revised_fields}); ${value.revision_count} revision(s) on record, status ${value.status}. New contract: ${value.contract}`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const amended = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        const input: ContractAmendmentInput = {
          ...args.objective === undefined ? {} : { objective: args.objective },
          ...args.acceptance === undefined ? {} : { acceptance: args.acceptance },
          ...args.verify === undefined ? {} : { verify: args.verify },
          ...args.inScope === undefined ? {} : { inScope: args.inScope },
          ...args.outOfScope === undefined ? {} : { outOfScope: args.outOfScope },
        }
        const result = amendTaskContract(fresh, task, normalizeBlankOptionalTaskFields(input), CAPTAIN_KEY, args.reason)
        if (!result.ok || result.task === undefined) {
          throw new Error(result.error ?? 'amend_task rejected by quality gates')
        }
        Object.assign(task, result.task)
        task.updatedAt = Date.now()
        /**
         * ── ★ contract 位置（第二个切入点：「改契约」）─────────────────────────────
         *
         * 与建任务同一个位置、同一种叠加方式：`amendTaskContract` 先校验修订本身
         * （它不认识判据层），判据层再问"修订后的契约可判吗"。理由与建任务处相同 ——
         * 一条被改成不可判的 verify 命令（例如一个永远失败的 grep），若只在建任务时
         * 检查，就会从"改契约"这条路上溜过去。
         *
         * ★ 执行器（t18）：与 create_task 处同一个注入、同一个实现。**两条路都必须注入**
         *   —— 只修一条会让"改契约"变成绕过可判性检查的入口，而那正是本调用点存在的理由。
         */
        await rejectOnContractGates(ctx, {
          team: fresh,
          task,
          creating: false,
          amended: result.revision?.fields ?? [],
          reason: args.reason,
        }, 'amend_task', {
          execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
        })
        await writeTeam(stateRoot, fresh)
        return {
          taskId: task.id,
          status: task.status,
          fields: result.revision?.fields ?? [],
          revisionCount: task.revisions?.length ?? 0,
          contract: {
            ...task.objective === undefined ? {} : { objective: task.objective },
            ...task.acceptance === undefined ? {} : { acceptance: task.acceptance },
            ...task.verify === undefined ? {} : { verify: task.verify },
            ...task.inScope === undefined ? {} : { inScope: task.inScope },
            ...task.outOfScope === undefined ? {} : { outOfScope: task.outOfScope },
          },
        }
      })
      appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, captain.session), 'agent-teams/task-amended', {
        teamId: team.id,
        taskId: amended.taskId,
        fields: amended.fields,
        reason: args.reason,
      })
      return {
        task_id: amended.taskId,
        status: amended.status,
        revised_fields: amended.fields.join(', '),
        revision_count: amended.revisionCount,
        contract: JSON.stringify(amended.contract),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_send_message',
    description: 'Send coordination or current-task guidance directly to the captain or a teammate. A running recipient receives it at the next model step; an idle recipient wakes. Messages are durably retained until read. Use task creation/reassignment for a new unit of work, not repeated status nudges.',
    parameters: {
      source_task_id: { type: 'string', description: 'Sender task, NOT the recipient task. Members include it with source_attempt_id. Captains sending guidance normally omit both source fields.' },
      source_attempt_id: { type: 'string', description: 'Sender execution capability paired with source_task_id. Stale reports are rejected. Omit for ordinary captain guidance.' },
      to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
      content: { type: 'string', required: true, description: 'The message text.' },
      from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message_id: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), mailbox (durable inbox only), or duplicate (same message already retained).' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const to = args.to.trim()
      const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const from = identity.name
        // `from` may only be the caller's own identity: impersonating another
        // member (or the captain) would poison the mailbox and event records.
        if (args.from !== undefined && args.from !== from) {
          throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
        }
        const sourceTaskId = args.source_task_id?.trim() || undefined
        const sourceAttemptId = args.source_attempt_id?.trim() || undefined
        if ((sourceTaskId === undefined) !== (sourceAttemptId === undefined)) throw new Error('send_message requires source_task_id and source_attempt_id together')
        const source = sourceTaskId === undefined
          ? identity.kind === 'member' ? memberOpenTask(fresh, identity.name) ?? fresh.tasks.filter(item => item.assignee === identity.name && item.attemptId !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined
          : requireTask(fresh, sourceTaskId)
        if (sourceTaskId !== undefined && (source?.assignee !== identity.name || source.attemptId !== sourceAttemptId)) {
          throw new Error('stale or foreign source attempt; stop sending results from the revoked task')
        }
        const sourceFields = source?.attemptId === undefined ? {} : { sourceTaskId: source.id, sourceAttemptId: source.attemptId, sourceTaskStatus: source.status }
        const owned = to === CAPTAIN_KEY ? undefined : memberOpenTask(fresh, requireMember(fresh, to).name)
        const duplicate = (await readMailbox(stateRoot, fresh.id, to)).find(message => message.from === from
          && message.content === args.content && message.taskId === owned?.id && message.attemptId === owned?.attemptId
          && message.sourceTaskId === sourceFields.sourceTaskId && message.sourceAttemptId === sourceFields.sourceAttemptId && message.sourceTaskStatus === sourceFields.sourceTaskStatus
          && isCurrentMail(fresh, message) && (message.attemptId !== undefined || message.sourceAttemptId !== undefined || message.readAt === undefined))
        if (duplicate !== undefined) return { kind: 'duplicate' as const, message: duplicate, from }
        if (to === CAPTAIN_KEY) {
          const message = { ...createMessage(from, CAPTAIN_KEY, args.content), ...sourceFields, deliveryClaimedAt: Date.now() }
          await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
            teamId: fresh.id,
            messageId: message.id,
            from,
            to: CAPTAIN_KEY,
            content: args.content,
            ts: message.ts,
          })
          return { kind: 'captain' as const, fresh, identity, message, from }
        }
        if (fresh.halted === true) {
          throw new Error(`team "${fresh.name}" is halted; call agent_teams_resume before waking a member`)
        }
        const recipient = requireMember(fresh, to)
        const message = { ...createMessage(from, recipient.name, args.content), ...sourceFields, deliveryClaimedAt: Date.now(),
          ...owned?.attemptId === undefined ? {} : { taskId: owned.id, attemptId: owned.attemptId },
        }
        await appendMailbox(stateRoot, fresh.id, recipient.name, message)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
          teamId: fresh.id,
          messageId: message.id,
          from,
          to: recipient.name,
          content: args.content,
          ts: message.ts,
        })
        return { kind: 'member' as const, fresh, identity, message, from, recipient }
      })

      if (prepared.kind === 'duplicate') return { message_id: prepared.message.id, from: prepared.from, to: prepared.message.to, delivered: 'duplicate' }
      // Resolve the exact live captain only after releasing the state lock.
      // The plugin mailbox is already durable if live delivery cannot proceed.
      const captain = ctx.agents.get(prepared.fresh.captainSessionId as SessionId)
      if (prepared.kind === 'captain') {
        let delivered: 'live' | 'mailbox' = 'mailbox'
        if (captain !== undefined && prepared.identity.kind === 'member') {
          delivered = steerCaptainReport(captain, prepared.from, args.content, mailboxPrompt(prepared.fresh.id, CAPTAIN_KEY, [prepared.message])) ? 'live' : 'mailbox'
        }
        if (delivered === 'live') {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            markMailboxDelivered(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
          ))
        } else {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
          ))
        }
        return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered }
      }
      let delivered: 'wake' | 'mailbox' = 'mailbox'
      if (captain !== undefined) {
        const text = mailboxPrompt(prepared.fresh.id, prepared.recipient.name, [prepared.message])
        const accepted = await dispatchMember(captain, prepared.fresh.id, prepared.recipient.name, text, exec.signal, 'steer', prepared.message.attemptId)
        delivered = accepted ? 'wake' : 'mailbox'
        if (accepted) {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            markMailboxDelivered(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
          ))
        }
      }
      if (delivered === 'mailbox') {
        await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
          releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
        ))
      }
      return {
        message_id: prepared.message.id,
        from: prepared.from,
        to: prepared.recipient.name,
        delivered,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_status',
    description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Use after mailbox progress deliveries or for an explicit status request. After dispatch, end your turn while members work; do not repeatedly poll.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
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
      const deliveryEvaluation = await registry.evaluate('delivery' as never, deliveryContext)
      const runtimeRecord = await evaluateRuntimeGates(ctx, 'task-status', deliveryContext)
      const delivery = {
        ok: deliveryEvaluation.ok === false ? false : deliveryCheck.ok,
        blockers: [
          ...deliveryCheck.blockers,
          ...deliveryEvaluation.blockers,
          ...deliveryEvaluation.unmeasured === undefined ? [] : [`could not measure: ${deliveryEvaluation.unmeasured}`],
        ],
        /**
         * ★ 判据层有没有就交付说话。`false` 表示这个位置这一轮没有任何判据求值
         *   —— 与"判据都通过了"不同形（那正是本队反复强调的那条分界）。
         */
        gates_evaluated: deliveryEvaluation.evaluated,
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

  ctx.tools.register(defineTool({
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
       */
      const evaluation = await registry.evaluate('delivery' as never, deliveryContext)
      const loop = describeQualityLoop(team)
      /**
       * ★ `unmeasured` 与 `blockers` 必须【不同形】（契约 §3.4）：前者是"没能测量"，
       *   后者是"发现了问题"。合并成一句话会让读日志的人把"没测成"读成"查出了问题"。
       *   ——这正是既有 `rejectOnDeliveryGates` 的分法，这里与它同形。
       */
      if (evaluation.ok === false || deliveryCheck.ok === false) {
        if (evaluation.unmeasured !== undefined) {
          throw new Error(`declare_delivery rejected: the delivery gate could not measure (${evaluation.unmeasured})`)
        }
        throw new Error(`declare_delivery rejected: ${[
          ...deliveryCheck.blockers,
          ...evaluation.blockers,
        ].join('; ')}`)
      }
      if (evaluation.evaluated === 0 && evaluation.registered > 0) {
        ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with no gate evaluated (${evaluation.registered} registered, all skipped); delivery was not checked`)
      }
      await evaluateRuntimeGates(ctx, 'delivery-declared', deliveryContext)
      void stateRoot
      return {
        team_id: team.id,
        declared: true,
        blockers: [],
        gates_evaluated: evaluation.evaluated,
        loop_state: loop.state,
      }
    },
  }))

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

  ctx.tools.register(defineTool({
    name: 'agent_teams_delete',
    description: 'End and archive your team: interrupts members and moves the current tasks and mailboxes out of active state for later inspection. Use when the work is done or explicitly abandoned. A same-name archive replaces its previous generation.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          team_name: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" ended and archived.`,
      }],
    },
    async execute(_args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        // Include previously removed members so deleting a pre-fix team also
        // retires durable catalog entries left behind by remove_member.
        const roster = fresh.members.map(member => ({ ...member }))
        for (const member of fresh.members) {
          await discardMailboxMessages(stateRoot, fresh.id, member.name, (await readUnreadMailbox(stateRoot, fresh.id, member.name)).map(message => message.id))
          if (member.status === 'removed') continue
          member.status = 'removed'
          for (const task of fresh.tasks) {
            if (task.assignee === member.name && !TERMINAL_TASK_STATUSES.includes(task.status)) invalidateTaskAttempt(task)
          }
        }
        await writeTeam(stateRoot, fresh)
        return roster
      })
      await recordRetiredMemberIds(stateRoot, members.map(member => member.id))
      await stopTeamMemberActivations(ctx, captain, members, exec.signal)
      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
          teamId: fresh.id,
        })
        // Archive, not delete: tasks (with their dependency graph) and the
        // mailboxes stay on disk for later review and dependency rebuilds.
        await archiveTeamDir(stateRoot, fresh.id)
      })
      return { deleted: true, team_name: team.name }
    },
  }))
  return runtime
}

async function initializeProfileTeam(input: {
  ctx: Context
  config: ToolsConfig
  memberSelections: ReturnType<typeof installMemberSelectionRuntime>
  captain: Agent
  exec: ToolRunContext
  stateRoot: string
  teamName: string
  teamId: string
  profileName: string
  inlinePlan?: import('./profiles.ts').TeamProfileConfig
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

function parseFindings(value: unknown): ReviewFinding[] | undefined {
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

function parseAcceptanceResults(value: unknown): AcceptanceResult[] | undefined {
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

function parseCommandResults(value: unknown): CommandResult[] | undefined {
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
function renderStatus(value: JsonValue): string {
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
