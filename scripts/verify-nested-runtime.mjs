#!/usr/bin/env node
/**
 * ── f-0028 运行时探针：**这个进程**的环境里有没有 `node --test` 的痕迹（t36）───────
 *
 * ── 它回答什么、不回答什么 ────────────────────────────────────────────────────
 *
 * 回答：**调用它的那个进程**身上，有没有 `NODE_TEST_CONTEXT` / `--test*` execArgv。
 * 不回答：那个进程的**祖先链**长什么样（`ps` 在沙箱里被拒、macOS 没有 `/proc`）。
 *
 * ★ 为什么要单独一个脚本：`node -e "…"` 也行，但那样每次都得手打一段代码，
 *   而手打的那份与测试里用的那份会**慢慢分叉**。一个文件 = 一处定义。
 *
 * ── ★★ 关键用法（决定读到的是不是"那个进程"）───────────────────────────────────
 *
 * 本脚本读的是**它自己**的环境。所以：
 *
 *     在【插件宿主进程】里跑它      ⇒ 读到的是宿主的
 *     `node scripts/verify-nested-runtime.mjs`（命令行）⇒ 读到的是**命令行进程**的
 *
 * ⇒ 这正是 f-0027 那条纪律：**读数属于哪个进程，取决于你在哪跑它**。
 *   命令行跑出来的 `current`/`clean` **不能**代表插件进程 —— 那正是本队
 *   记过的「读错位置的出口」。
 *
 * ★ 而本脚本因此有一条**自证**：它把自己的 `pid` 与 `ppid` 一并打出来，
 *   让读的人能核对"这到底是哪个进程的读数"。
 *
 * Run: node scripts/verify-nested-runtime.mjs
 */

import { execFileSync } from 'node:child_process'

/** 三格读数，各自都可以是 `null`（= 读不到），**不许**把"没有"写成"没测到"。 */
function readOwnProcess() {
  return {
    /** ★ Node 在 `--test` 子进程里设它（实测值 `child-v8`）；否则 unset。 */
    nodeTestContext: process.env.NODE_TEST_CONTEXT ?? null,
    /** ★ 每个进程自己的 execArgv —— `--test` 子进程会带一串 `--test*`。 */
    execArgvHasTest: process.execArgv.some((arg) => arg.startsWith('--test')),
    /** ★ 让读数可归属：没有它，"这是哪个进程的"就无从核对。 */
    pid: process.pid,
    ppid: process.ppid,
    argv1: process.argv[1],
  }
}

/**
 * 祖先链 —— **尽力而为**，拿不到就说拿不到。
 *
 * ★ 沙箱里 `ps` 被拒（实测 `/bin/ps: Operation not permitted`），
 *   而 macOS 没有 `/proc` ⇒ 这一格**很可能读不到**。
 *   ⇒ 返回 `{ available: false, reason }`，**不是**空数组
 *     —— "读不到祖先链"与"祖先链是空的"必须不同形。
 */
function readAncestry(limit = 6) {
  const chain = []
  let pid = process.ppid
  for (let depth = 0; depth < limit && pid > 1; depth += 1) {
    let command
    let parent
    try {
      command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
      parent = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
    } catch (error) {
      return {
        available: false,
        chain,
        reason: `ps is not readable here (${String(error?.stderr ?? error?.message ?? error).trim().slice(0, 120)})`,
      }
    }
    if (command === '') break
    chain.push({ pid, command: command.slice(0, 200), isNodeTest: /\bnode\b.*--test\b|--test\b/.test(command) })
    pid = parent
  }
  return { available: chain.length > 0, chain }
}

const own = readOwnProcess()
const ancestry = readAncestry()
const ancestryHasNodeTest = ancestry.available && ancestry.chain.some((entry) => entry.isNodeTest)

/**
 * ── ★★ 结论：三态，**互不同形** ────────────────────────────────────────────────
 *
 *   `nested`      —— 本进程自己在 `--test` 下（那意味着它起的 `node --test` 会被跳过）
 *   `clean`       —— 本进程**不在** `--test` 下（观测到了、确定不在）
 *   `unmeasured`  —— **没能判断**（判据的两个信号都读不到）
 *
 * ★ `clean` 与 `unmeasured` 必须不同形：把"我没能读"写成"它不在"，
 *   会让一次读取失败伪装成一个关于运行时的结论。
 */
const signals = [
  own.nodeTestContext !== null,
  own.execArgvHasTest,
]
const verdict = signals.some(Boolean) ? 'nested' : 'clean'

const report = {
  schema: 1,
  /** ★ 这是**本进程**的读数，不是祖先链的。 */
  process: own,
  ancestry,
  /**
   * ★ 由**观测**支撑的那条结论，以及它**只管到哪一层**。
   */
  verdict,
  /** ★ 措辞说清射程：它回答的是"本进程"，不是"整条链"。 */
  verdictMeans: verdict === 'nested'
    ? 'THIS process runs under `node --test`; a `node --test` it spawns would be silently skipped'
    : 'THIS process does not run under `node --test` (observed: both signals are absent)',
  /** ★ 观测**到**的（逐条给出依据）。 */
  observed: {
    ownProcessIsUnderNodeTest: signals.some(Boolean),
    ancestryHasNodeTest,
  },
  /** ★ 观测**不到**的 —— 必须写出来，否则与"没有"同形。 */
  couldNotObserve: [
    ...ancestry.available ? [] : ['the process ancestry (ps was not readable in this sandbox)'],
    'whether the AgentTeams HOST plugin process (not this process) runs under node --test',
  ],
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
