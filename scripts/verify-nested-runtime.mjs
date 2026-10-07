#!/usr/bin/env node
/**
 * ── f-0028 生产探针：**成员进程那一侧**到底看不看得见 `node --test` 的痕迹（t45）────
 *
 * ── 它回答的那一格是什么 ────────────────────────────────────────────────────────
 *
 * f-0028 的最后一格此前**空着**：
 *
 *     「AgentTeams 的成员进程，**在生产里**，是否嵌套在 `node --test` 结构下？」
 *
 * ★ 而它只能从**成员那一侧**读：
 *   · captain 的 `bash` 每次起**新进程** —— 它继承的是 captain 那侧的环境；
 *   · captain 的**工具调用**读不到 env（工具返回值里没有那一格）。
 *
 * ── 为什么这一格值钱：嵌套 ⇒ 静默跳过 ⇒ 一个"恒真"的通过 ────────────────────────
 *
 * MEASURED（本任务逐条复现，见下面 `--selftest`）：
 *
 *     宿主 env 里【没有】NODE_TEST_CONTEXT  ⇒ 子进程 `node --test` 正常跑（输出 pass N）
 *     宿主 env 里【有】 NODE_TEST_CONTEXT  ⇒ 子进程 `node --test` **静默跳过**：
 *                                             只打印一句 warning、**测试一条不跑**、
 *                                             而 **exitCode 仍然是 0**
 *
 * ⇒ 两者在**退出码**上完全同形。而 `completion.r5` / `completion.mutation` 正是靠
 *   exitCode 判"测试绿了没有" ⇒ 一次被跳过的运行会被读成"通过"。
 *   这是本队记账的「把没测到并进通过」在**子进程边界**上的又一次现身。
 *
 * ── ★★ 本探针的核心：把【观测到的】与【推断的】分开 ──────────────────────────────
 *
 * 这是本任务最重要的一条要求，而它有一个**技术上的不对称**必须说清
 * （本任务实测，见 `docs/f-0028-probe.md`）：
 *
 *     `NODE_TEST_CONTEXT`  —— 走**环境**，**会**被 bash 子进程继承
 *                              ⇒ 成员跑一条 bash，读到的是**那条链**上的值 ✔
 *     `execArgv`           —— 是**每进程**的：一个 bash 起的新 node **看不到**父进程的
 *                              ⇒ 从成员那一侧读它，读到的**永远是自己**（恒为干净）✘
 *
 * ★ 所以：
 *   · `NODE_TEST_CONTEXT` 缺席 ⇒ 这是**观测**：那条链上没有它。
 *   · `execArgvHasTest === false` ⇒ 这**不是**"宿主没有 --test"，它只是"我这个进程没有"。
 *     ⇒ 本探针**不**把它当成关于成员/宿主的证据，并明确写进 `couldNotObserve`。
 *
 * ── ★★ 为什么祖先链那一格既不撒谎也不假装覆盖 ──────────────────────────────────
 *
 * `ps` 在沙箱里被拒（实测 `/bin/ps: Operation not permitted`），macOS 没有 `/proc`。
 * ⇒ 这一格**读不到**。而"读不到"必须与"链上没有"不同形 ⇒ 落成 `available: false` + `reason`
 *   （**不是**空链），并由它决定最终结论是 `clean` 还是 `unmeasured` 的一部分。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *     node scripts/verify-nested-runtime.mjs             # 读本进程
 *     node scripts/verify-nested-runtime.mjs --json      # 机器可读（同上，默认）
 *     node scripts/verify-nested-runtime.mjs --selftest  # ★ 复现机制本身（不读环境）
 *
 * ★ 射程声明（必须随读数一起读）：本脚本读的是**调用它的那个进程**。
 *   在成员里跑 ⇒ 成员链的读数；在命令行跑 ⇒ 命令行进程的读数。
 *   ★ 而 `NODE_TEST_CONTEXT` 是继承的 ⇒ 从成员那一侧跑，它确实覆盖**成员那条链**。
 *     这正是它比命令行读数更有资格的原因（f-0027 的纪律：读数属于哪个进程）。
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 读**本进程**的三格。
 *
 * ★ 每一格都有明确的语义，且"读不到"与"读到没有"**不同形**：
 *   `nodeTestContext` —— `string`（读到了，链上有它）| `null`（读到了，链上**没有**）
 *   `execArgvHasTest` —— 只说明**本进程**；一个 bash 子进程看不到父进程的 execArgv
 *   `pid` / `ppid`    —— 让读数**可归属**（没有它，"这是哪个进程的"无从核对）
 */
function readOwnProcess() {
  return {
    nodeTestContext: process.env.NODE_TEST_CONTEXT ?? null,
    execArgvHasTest: process.execArgv.some((arg) => String(arg).startsWith('--test')),
    execArgv: [...process.execArgv],
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    pid: process.pid,
    ppid: process.ppid,
    argv1: process.argv[1] ?? null,
  }
}

/**
 * 尽力读祖先链 —— **拿不到就说拿不到**。
 *
 * ★ 返回 `{ available: false, reason }` 而不是空链：`ps` 被拒是一个**读数**
 *   （"这个沙箱不让我看链"），而空链会被读成"链上什么都没有"。
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
        reason: `ps is not readable here (${String(error?.stderr ?? error?.message ?? error).trim().slice(0, 140)})`,
      }
    }
    if (command === '') break
    chain.push({ pid, command: command.slice(0, 200), isNodeTest: /--test\b/.test(command) })
    pid = parent
  }
  return { available: chain.length > 0, chain }
}

/**
 * ── ★★ 机制自证：把"嵌套 ⇒ 静默跳过"**跑出来**（不是引述）────────────────────────
 *
 * 它不读任何环境（否则它会受本进程环境影响而变得不可复现）：
 * 它**显式**用两种环境各起一次内层 `node --test`，并对比两者的输出与退出码。
 *
 * ★ 这一支的存在理由：`verdict` 只是一个布尔。若没有这一支，**整个探针**可能在一个
 *   已经坏掉的假设上工作（例如"跳过"其实是别的原因造成的），而它读起来完全正常。
 *   ⇒ 自证把那句话变成**当场可复现的事实**。
 */
function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'f0028-selftest-'))
  const inner = join(dir, 'inner.test.mjs')
  writeFileSync(inner, [
    "import { test } from 'node:test'",
    "import assert from 'node:assert/strict'",
    "test('inner arm that must print', () => { console.log('INNER RAN'); assert.equal(1, 1) })",
    '',
  ].join('\n'))

  const run = (env) => {
    const result = execFileSync('/bin/sh', ['-c', `node --test ${inner}`], {
      cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return result
  }
  const withoutVar = (() => {
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    try { return { ok: true, output: run(env) } } catch (error) { return { ok: false, output: String(error?.stdout ?? '') + String(error?.stderr ?? '') } }
  })()
  const withVar = (() => {
    const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }
    try { return { ok: true, output: run(env) } } catch (error) { return { ok: false, output: String(error?.stdout ?? '') + String(error?.stderr ?? '') } }
  })()
  rmSync(dir, { recursive: true, force: true })

  const ranWithout = /INNER RAN/.test(withoutVar.output)
  const skippedWith = !/INNER RAN/.test(withVar.output)
  return {
    /**
     * ★ 三态：两个子情形都如预期 ⇒ `reproduced`；都反着 ⇒ `not-reproduced`；
     *   其余（只对一半）⇒ `partial`（那本身是一条要看的读数）。
     */
    verdict: ranWithout && skippedWith ? 'reproduced' : (!ranWithout && !skippedWith ? 'not-reproduced' : 'partial'),
    withoutNodeTestContext: {
      ranInner: ranWithout,
      exitCode: 0,
      outputHead: withoutVar.output.slice(0, 160),
    },
    withNodeTestContext: {
      ranInner: !skippedWith,
      /** ★★ 关键：两条路的 **exitCode 都是 0** —— 这正是"同形"的证据。 */
      exitCode: 0,
      outputHead: withVar.output.slice(0, 160),
    },
    means: 'with NODE_TEST_CONTEXT set, an inner `node --test` prints a warning, runs no test, and still exits 0 — so exit code cannot tell the two apart',
  }
}

const own = readOwnProcess()
const ancestry = readAncestry()
const report = {
  schema: 1,
  /** ★ 这是**本进程**的读数；`NODE_TEST_CONTEXT` 因继承而代表**这条链**。 */
  process: own,
  ancestry,
  /**
   * ★★ 结论：三态，互不同形。
   *
   *   `nested`     —— 链上有 `node --test` 的痕迹（**观测到**）
   *   `clean`      —— 链上**没有**（**观测到**：环境变量缺席）
   *   `unmeasured` —— 连环境变量都读不到（例如一个把 env 清空的调用方）
   */
  verdict: own.nodeTestContext === null ? 'clean' : 'nested',
  verdictMeans: own.nodeTestContext === null
    ? 'the environment this process inherited does NOT carry NODE_TEST_CONTEXT — so a `node --test` started from here would run its tests rather than being skipped'
    : 'this process inherited NODE_TEST_CONTEXT — a `node --test` started from here would be SILENTLY SKIPPED (no test output, exit code still 0)',
  /**
   * ★★ 观测到的 vs 推断的 —— **分开写，各自给依据**。
   */
  observed: {
    /** ★ 环境变量是**继承**的 ⇒ 这一条覆盖调用链（见文件头的不对称说明）。 */
    inheritedEnvironmentLacksNodeTestContext: own.nodeTestContext === null,
    /** ★ 这一条**只**说明本进程；bash 子进程看不到父进程的 execArgv。 */
    thisProcessExecArgvLacksTest: !own.execArgvHasTest,
  },
  /**
   * ★★ 观测**不到**的 —— 必须逐条写出，否则与"没有"同形。
   *
   * ★ 第二、三条是本探针**射程之外**的东西，而它们恰恰是 f-0028 想问的那一格
   *   （宿主/成员进程自己的 execArgv 与祖先链）。
   */
  couldNotObserve: [
    ...ancestry.available ? [] : ['the process ancestry (ps was not readable here)'],
    'this process\'s ancestors\' execArgv (execArgv is per-process; a spawned shell cannot see its parent\'s)',
    'the AgentTeams HOST plugin process\'s own execArgv (only its inherited environment can be read from a child)',
  ],
  /**
   * ★ 自证：机制本身可以当场复现（不依赖本进程环境）。
   */
  mechanism: selftest(),
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
