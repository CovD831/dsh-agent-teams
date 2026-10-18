#!/usr/bin/env node
/**
 * ── `reviewed` 戳的【时间不可能】普查（C）──────────────────────────────────────────
 *
 * 用途：回答一个问题 —— **盘上的每个审查戳，有没有可能是真的？**
 *
 * ── 它测的是哪一件事 ────────────────────────────────────────────────────────────
 *
 * `reviewed` 是 `create_task` 的**输入参数**（`src/tools/create-task.ts:583`），
 * 也就是说：审查发生在**建任务之前**，然后由 captain 把那份 `{at, by, checks[]}`
 * 塞进建任务参数里。
 *
 * ⇒ ★ 于是【`reviewed.at < task.createdAt` 是正常形态】，不是异常。
 *   （我在上一轮把这条判反了，本文件的第一版就死在这个方向上。留着这句当路标。）
 *
 * 真正不可能的是另一侧：**`reviewed.at` 早于这道门【上线】的时刻。**
 *
 *   `PLAN_REVIEWED_GATE_ONLINE_AT = 2026-10-09T09:33:50 +0800`
 *
 * 理由：这道门上线之前，「派发前必须审过」这条路**还不存在**。
 *   一条早于它存在的戳，与"审过了"不同形 —— 它是**从别的团队/别的时刻带过来的**。
 *
 * ★ 而本工具**不裁决**它该不该被删：它只把"不可能"的那批**列出来并计数**。
 *   处置是另一件事，而处置需要先看见（本仓记账里最贵的一条：
 *   一次纯搬运少搬了"改动的可见面"，而没有任何东西报错）。
 *
 * ── 三条纪律（与 `scripts/mvp-failing-files.mjs` / `scripts/mvp-measure.mjs` 同源）──
 *
 * ① **它不裁决。** 输出里没有 ok / pass / fail。它只把戳分成两类并给出计数。
 * ② **三态不许并。** `ran: false`（没扫成）≠ `stamps: []`（扫了、零个戳）。
 *    扫不起来时它打印 `ran: false` 与原因，**绝不**打印一个空清单 ——
 *    那会让"没有不可能戳"与"根本没扫到"同形（REQUIREMENTS §4 的第九次事故形态）。
 * ③ **不读模型的自我陈述。** 只读 `team.json` 里的 `reviewed.at` 与
 *    `REVIEWED_GATE_ONLINE_AT` 这一个常量，两者一比就出结论。
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────────────
 *
 *   0  扫完了，清单已打印（★ 注意：**不代表干净** —— 有不可能戳也返回 0，它是读数工具不是闸）
 *   2  没能扫（状态目录不存在 / 一个 team.json 都读不出来）⇒ 调用方必须当成"未测到"
 *
 * 用法：
 *   node scripts/reviewed-stamp-census.mjs              # 人读
 *   node scripts/reviewed-stamp-census.mjs --json       # 机器读
 *   node scripts/reviewed-stamp-census.mjs --active     # 只扫描非 archive 的队
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ── ★★★ 这道门【何时上线】—— 与判据层的那一个常量**同源**（不是抄一份）──────────────
 *
 * 判据层从 `lib/gates/dispatch/plan-reviewed.js` 导出它。本工具**import** 那一个，
 * 而不是在这里重写一遍 —— 因为两处各写一遍的话，
 * 分叉之后"普查说它早于上线、而判据说它适用"会在日志里同形。
 *
 * ★ 而本文件被 `gate-plan-reviewed.test.mjs` 的臂 10 对着判据层的那一份核对。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { PLAN_REVIEWED_GATE_ONLINE_AT } = await import('../lib/gates/dispatch/plan-reviewed.js')

const STATE_DIR = join(ROOT, '.agent-teams')

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]
  const body = header
    .split('\n')
    .slice(1)
    .filter((line) => !line.startsWith('/**'))
    .map((line) => line.replace(/^ \* ?/, ''))
    .join('\n')
    .trim()
  process.stdout.write(`${body}\n`)
  process.exit(0)
}

const asJson = argv.includes('--json')
const activeOnly = argv.includes('--active')

/**
 * 找出所有 `team.json`。
 *
 * ★ 深度上限 3 是**有理由的**：`.agent-teams/<team>/team.json` 与
 *   `.agent-teams/archive/<team>/team.json` 都是两层 ⇒ 3 够用。
 *   再深就说明目录布局变了，而那时应当**明说没扫到**，不是默默少扫。
 */
export function findTeamFiles(dir, depth = 0) {
  if (depth > 3) return []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    /** ★ 跳过与"任务图"无关的大目录 —— 它们会让普查从秒级变成分钟级。 */
    if (['worktrees', 'node_modules', '.git', 'inbox', 'salvage'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...findTeamFiles(path, depth + 1))
    } else if (entry.name === 'team.json') {
      out.push(path)
    }
  }
  return out
}

/**
 * 一条戳的三态读数。
 *
 *   `impossible` —— `at` 是一个数，且**早于门上线时刻**（这条路当时还不存在）
 *   `plausible`  —— `at` 是一个数，且不早于门上线时刻
 *   `unreadable` —— `at` 不是有限数 ⇒ ★ **不能**读成"没问题"（那是"读不出"）
 */
export function classifyStamp(stamp) {
  const at = stamp?.at
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    return { verdict: 'unreadable', why: `reviewed.at is ${at === null ? 'null' : typeof at}, not a finite number` }
  }
  if (at < PLAN_REVIEWED_GATE_ONLINE_AT) {
    return {
      verdict: 'impossible',
      why: `stamped ${new Date(at).toISOString()}, which is before this gate existed (${new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString()})`,
    }
  }
  return { verdict: 'plausible' }
}

export function censusOf(stateDir, { activeOnly = false } = {}) {
  let stateStat
  try {
    stateStat = statSync(stateDir)
  } catch {
    return { ran: false, reason: `state directory does not exist: ${relative(ROOT, stateDir)}` }
  }
  if (!stateStat.isDirectory()) {
    return { ran: false, reason: `${relative(ROOT, stateDir)} is not a directory` }
  }

  const files = findTeamFiles(stateDir)
  if (files.length === 0) {
    /** ★ 一个 team.json 都没有 ⇒ 没扫成，而不是"零个戳"。 */
    return { ran: false, reason: 'no team.json found under the state directory' }
  }

  const teams = []
  const stamps = []
  for (const file of files) {
    const teamName = relative(stateDir, dirname(file))
    if (activeOnly && teamName.startsWith('archive/')) continue
    let team
    try {
      team = JSON.parse(readFileSync(file, 'utf8'))
    } catch (reason) {
      /** ★ 一个读不出来的 team.json 不中断整次普查，但**它要被记着**（否则"跳过"与"扫过"同形）。 */
      teams.push({ team: teamName, readable: false, why: String(reason) })
      continue
    }
    const tasks = Array.isArray(team.tasks) ? team.tasks : []
    let stamped = 0
    for (const task of tasks) {
      if (task?.reviewed === undefined || task.reviewed === null) continue
      stamped += 1
      const verdict = classifyStamp(task.reviewed)
      stamps.push({
        team: teamName,
        taskId: typeof task.id === 'string' ? task.id : '(no id)',
        at: task.reviewed.at,
        createdAt: task.createdAt,
        by: task.reviewed.by,
        ...verdict,
      })
    }
    teams.push({ team: teamName, readable: true, tasks: tasks.length, stamped })
  }

  const counts = { stamps: stamps.length, impossible: 0, plausible: 0, unreadable: 0 }
  for (const stamp of stamps) counts[stamp.verdict] += 1

  return {
    ran: true,
    gateOnlineAt: PLAN_REVIEWED_GATE_ONLINE_AT,
    gateOnlineAtIso: new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString(),
    teams,
    counts,
    impossible: stamps.filter((stamp) => stamp.verdict === 'impossible'),
    unreadable: stamps.filter((stamp) => stamp.verdict === 'unreadable'),
  }
}

/**
 * ── CLI ────────────────────────────────────────────────────────────────────────
 *
 * ★ 只在**直接运行**时执行（`friction-triage.mjs:2754` 的同一种守卫）。
 *   原因是本文件的三个函数要被 `scripts/gate-plan-reviewed.test.mjs` import 进去
 *   对**内存里的假状态目录**求值 —— 若顶层无条件跑 `main()`，
 *   一次 import 就会去扫真实的 `.agent-teams/`，测试会跟着磁盘变红变绿。
 */
function main() {
  const result = censusOf(STATE_DIR, { activeOnly })

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exit(result.ran ? 0 : 2)
  }

  if (!result.ran) {
    /**
     * ★★ 没扫成 ⇒ 打印 `ran: false` 与原因，**绝不**打印一个空清单。
     *   "扫了、零个不可能戳"与"根本没扫到"必须不同形。
     */
    process.stderr.write(`ran: false — ${result.reason}\n`)
    process.stderr.write('★ This is NOT "no impossible stamps": nothing was scanned.\n')
    process.exit(2)
  }

  process.stdout.write(`reviewed stamp census\n`)
  process.stdout.write(`  gate online at: ${result.gateOnlineAtIso}\n`)
  process.stdout.write(`  teams scanned : ${result.teams.length}\n`)
  process.stdout.write(`  stamps        : ${result.counts.stamps}\n`)
  process.stdout.write(`    impossible  : ${result.counts.impossible}   ← stamped before this gate existed\n`)
  process.stdout.write(`    plausible   : ${result.counts.plausible}\n`)
  process.stdout.write(`    unreadable  : ${result.counts.unreadable}   ← at is not a finite number\n`)

  if (result.counts.impossible > 0) {
    process.stdout.write(`\nimpossible stamps:\n`)
    for (const stamp of result.impossible) {
      process.stdout.write(`  ${stamp.team}/${stamp.taskId}  ${stamp.why}\n`)
    }
  }
  if (result.counts.unreadable > 0) {
    process.stdout.write(`\nunreadable stamps:\n`)
    for (const stamp of result.unreadable) {
      process.stdout.write(`  ${stamp.team}/${stamp.taskId}  ${stamp.why}\n`)
    }
  }

  /**
   * ★ 退出 0 —— 它是**读数工具，不是闸**。
   *   把"发现 95 条不可能"变成非零退出，会让它在任何 CI 里被当成"测试挂了"，
   *   而它与"测试挂了"是两件事：一个说"盘上有 95 条可疑记录"，另一个说"代码坏了"。
   */
  process.exit(0)
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (invokedDirectly) main()
