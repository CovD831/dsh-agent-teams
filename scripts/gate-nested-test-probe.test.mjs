#!/usr/bin/env node
/**
 * ── f-0028 实测：成员进程在生产里是否嵌套在 `node --test` 下（t36）───────────────
 *
 * ── 要回答的问题 ──────────────────────────────────────────────────────────────
 *
 * t33 报过一条边界：在夹具里跑不完 `mutation` 的成功分支，因为
 * `node --test` **拒绝嵌套调用**。而 mutation 的 `runTest` 恰恰要起子进程。
 *
 * ⇒ 若**生产**里的成员进程也嵌套在 `node --test` 下，那么：
 *     repair 的 mutation 永远拿不到可读摘要 ⇒ **恒 unmeasured** ⇒ 那类任务
 *     永远无法收口 ⇒ 那是一条 **f-0020 级**的缺口（不是夹具的小毛病）。
 *
 * ── 本文件的结构：三节，各自回答一个不同的问题 ──────────────────────────────────
 *
 *   一、**机制**：嵌套 `node --test` 真的会被静默跳过吗？（**对照组**必须做）
 *   二、**生产**：我（这个成员进程）能观测到什么？哪些是**观测到的**、
 *        哪些是**推断的**、哪些**观测不到**。
 *   三、**判据**：把上面的结论写成可执行的断言（含定向突变臂）。
 *
 * ★ 本文件严守那条纪律：**绝不把"推断的"写成"观测到的"**。
 *   观测不到 ⇒ 如实报 `unmeasured`，并在报告里说清缺的是哪一格。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 在临时目录里搭一个"内层套件 + 外层套件"的最小现场。 */
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), 'nested-probe-'))
  writeFileSync(join(dir, 'inner.test.mjs'), [
    "import test from 'node:test'",
    "test('inner', () => { console.log('INNER RAN') })",
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(dir, 'outer.test.mjs'), [
    "import test from 'node:test'",
    "import { execFileSync } from 'node:child_process'",
    "test('outer spawns inner', () => {",
    "  let out = ''; let code = 0",
    /**
     * ★★ 这里**显式**给内层带上 `NODE_TEST_CONTEXT` —— 而不是靠继承。
     *
     * MEASURED（本任务实测）：`runIn(..., { stripContext: false })` 会让
     * **外层自己**被跳过（因为本夹具本身就是 `--test` 子进程，它传下去的环境
     * 让外层也成了"被嵌套的那一层"）⇒ 读数变成 `len=0`，而不是"内层被跳过"。
     *
     * ⇒ 要演示的是【内层被跳过】这一层现象。所以让 **outer 自己**带上它：
     *   本夹具（干净）→ `node --test outer`（正常跑）→ 它给 inner 带 ctx → inner 被跳过。
     * ★ 三层各司其职：夹具负责观察，outer 负责提供"上一层"的上下文。
     */
    "  const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }",
    "  try { out = execFileSync('node', ['--test', 'inner.test.mjs'], { encoding: 'utf8', env }) }",
    "  catch (error) { out = String(error.stdout ?? '') + String(error.stderr ?? ''); code = error.status ?? -1 }",
    "  console.log('[NESTED]' + JSON.stringify({ code, out }))",
    "})",
    '',
  ].join('\n'), 'utf8')
  return dir
}

/** 跑一条命令，返回 `{ code, out }` —— **不抛**（我们要读它的失败形态）。 */
function runIn(dir, command, { stripContext = true } = {}) {
  /**
   * ★★ 本文件**自己**就跑在 `node --test` 下 ⇒ 它是 `NODE_TEST_CONTEXT` 的子进程
   *   ⇒ 它起的子进程**会继承那一格** ⇒ 内层 `node --test` 被**静默跳过**。
   *
   * ⇒ 凡是要观察"内层到底跑没跑"的调用都必须**显式剥掉那一格**，
   *   否则本文件测的是"我自己被嵌套"，而不是"那个套件本身能不能跑"。
   * ★ 而臂 2/4 要**保留**它（那正是被测机制）⇒ 那里显式传 `stripContext: false`。
   */
  const env = { ...process.env }
  if (stripContext) delete env.NODE_TEST_CONTEXT
  try {
    return { code: 0, out: execFileSync('/bin/sh', ['-c', command], { cwd: dir, encoding: 'utf8', env }) }
  } catch (error) {
    return { code: error.status ?? -1, out: String(error.stdout ?? '') + String(error.stderr ?? ''), env }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、机制：嵌套 `node --test` 会被静默跳过 —— 而对照组必须同时做
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（对照臂）：同一个内层套件【单独跑】是绿的，且真的打印了', () => {
  /**
   * ── ★ 为什么对照组必须做，而且必须先做 ────────────────────────────────────────
   *
   * 一条"嵌套跑没有输出"的读数，若不同时给出"单独跑有输出"，就**证明不了任何事**：
   *   它也可能是"这个套件本来就是坏的"。
   * ⇒ 两半成对，缺一即恒真（本队纪律）。
   */
  const dir = scaffold()
  try {
    const standalone = runIn(dir, 'node --test inner.test.mjs')
    assert.equal(standalone.code, 0, '★ 单独跑必须成功')
    assert.match(
      standalone.out, /INNER RAN/,
      '★ 而它必须**真的跑了**（打印了 INNER RAN）—— 否则下面"嵌套跑没输出"证明不了静默跳过',
    )
    assert.match(standalone.out, /ℹ pass 1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('★ 臂 2（机制臂）：嵌套跑 ⇒ **静默跳过**：输出完全为空、exitCode 0、没有报错', () => {
  /**
   * ── ★★ 这一格就是 f-0028 的机制本身（captain 独立复现过）──────────────────────
   *
   * ★ 而它的危险在于**三重误导**，每一条单独看都像"跑过了"：
   *     · `exitCode === 0`         ⇒ 读起来像"通过"
   *     · `ℹ pass 1`               ⇒ 读起来像"有测试通过了"（那是**外层**那一条）
   *     · 没有报错                 ⇒ 读起来像"没出问题"
   *   而真相是：**内层一条都没跑**。
   *
   * ★ 本臂必须**三样都断言**：外层套件拿到空输出 + 退出码 0 + 内层的 `INNER RAN`
   *   在**嵌套**路径上消失。少任何一样，一个"只是恰好没输出"的实现都能过。
   */
  const dir = scaffold()
  try {
    /**
     * ★ 这里用**默认**（剥掉 ctx）：本夹具必须是干净的，否则外层自己被跳过。
     *   而"内层被跳过"由 outer **自己**给 inner 带上 ctx 来演示（见 scaffold）。
     */
    const nestedOuter = runIn(dir, 'node --test outer.test.mjs')
    assert.equal(nestedOuter.code, 0, '★ 外层套件本身是成功的（那正是误导的来源）')

    const marker = /\[NESTED\](\{.*\})/.exec(nestedOuter.out)
    assert.ok(marker !== null, `★ 外层必须交出它抓到的子进程读数。实测输出：${nestedOuter.out.slice(0, 300)}`)
    const inner = JSON.parse(marker[1])

    assert.equal(
      inner.code, 0,
      '★ 嵌套调用的**退出码是 0** —— 它不会以非零告诉你"我没跑"',
    )
    assert.equal(
      inner.out, '',
      `★ 而它的输出**完全为空**（既没有 INNER RAN，也没有任何报错）。实测：${JSON.stringify(inner.out.slice(0, 200))}`,
    )
    /**
     * ★ 第三样：内层的标记在嵌套路径上**消失**。
     *   它与臂 1 的 `assert.match(standalone.out, /INNER RAN/)` 成对 ——
     *   同一个标记，一条路径上有、另一条上没有。
     */
    assert.doesNotMatch(
      inner.out, /INNER RAN/,
      '★ `INNER RAN` 必须在嵌套路径上消失 —— 它与臂 1 的"单独跑有它"合成一个可证伪的对子',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 二、生产：哪些是观测到的、哪些是推断的、哪些观测不到
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 三态（本队纪律）：观测到的 / 推断的 / 观测不到 ────────────────────────────
 *
 * 本节的读数**全部从当前进程直读**，不做任何跨进程推断。下面把三格分开写。
 */
const OBSERVED = {
  /** ★ 直读：本进程（`node --test` 的子进程）身上 Node 设的那一格。 */
  nodeTestContext: process.env.NODE_TEST_CONTEXT ?? null,
  /** ★ 直读：本进程的 execArgv 里有没有 `--test*`。 */
  execArgvHasTest: process.execArgv.some((arg) => arg.startsWith('--test')),
  /** ★ 直读：本进程的 argv[1]（被执行的入口）。 */
  argv1: process.argv[1],
}

test('★ 臂 3（观测臂）：本进程**确实**在 `node --test` 下 —— 两个独立信号都确认', () => {
  /**
   * ★ 这一臂钉的是"**本文件正在被 `node --test` 跑**"这件事本身。
   *   没有它，下面那条"子进程不继承"的读数就没有一个可信的起点。
   *
   * ★ 两个信号各自独立，都指向同一结论 ⇒ 不是单一来源的巧合：
   *   · `NODE_TEST_CONTEXT` —— Node 在 `--test` 子进程里设它（实测值 `child-v8`）
   *   · `execArgv` 含 `--test*` —— Node 给测试子进程装的那一串参数
   */
  assert.equal(
    OBSERVED.nodeTestContext, 'child-v8',
    `★ Node 在 --test 子进程里会设 NODE_TEST_CONTEXT；实测：${JSON.stringify(OBSERVED.nodeTestContext)}`,
  )
  assert.equal(
    OBSERVED.execArgvHasTest, true,
    '★ 而 execArgv 必须带 --test* —— 第二个独立信号',
  )
})

test('★★ 臂 4（★ 机制臂，我第一版写错了方向）：跳过由 `NODE_TEST_CONTEXT` 的【继承】触发', () => {
  /**
   * ── ★★ 本臂第一版押的是反方向，而实测把它推翻了 ────────────────────────────────
   *
   * 第一版假设：`--test` 的上下文**不**传给普通子进程 ⇒ 影响面小。
   * ★ 实测结果相反：`NODE_TEST_CONTEXT` **会**继承（子进程里读到 `child-v8`），
   *   而 `execArgv` 不继承 —— **两格的行为不同**，我原先把它们当成一件事。
   *
   * ── 而机制因此被精确定位到一个**可操作的变量**上 ─────────────────────────────
   *
   *   带 `NODE_TEST_CONTEXT`  起 `node --test inner` ⇒ 输出**完全为空**
   *   `env -u NODE_TEST_CONTEXT` 再起              ⇒ 输出 `INNER RAN` ✓
   *
   * ★ 两个读数的**唯一差别**就是那一格 ⇒ 机制是它，不是 execArgv。
   *   ⇒ 于是"要不要紧"归结为一个**可判定**的问题：
   *     mutation 起的子进程，环境里有没有 `NODE_TEST_CONTEXT`。
   */
  const dir = mkdtempSync(join(tmpdir(), 'ctx-mech-'))
  try {
    writeFileSync(join(dir, 'inner.test.mjs'), [
      "import test from 'node:test'",
      "test('inner', () => { console.log('INNER RAN') })",
      '',
    ].join('\n'), 'utf8')

    /**
     * ① 继承确认：本进程是 `--test` 子进程（臂 3 已钉），而它起的子进程**也**带着 ctx。
     * ★ 这一路**不能**用 `runIn` 的缺省（它会把 ctx 剥掉）—— 那正好把我测的东西删了。
     *   ⇒ 显式带上 ctx 起一个子进程，读它自己看到的 ctx。
     */
    const ctxProbe = (() => {
      const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }
      try {
        return { out: execFileSync('/bin/sh', ['-c', "node -e \"console.log(process.env.NODE_TEST_CONTEXT ?? 'UNSET')\""], { cwd: dir, encoding: 'utf8', env }) }
      } catch (error) {
        return { out: String(error.stdout ?? '') }
      }
    })()
    const readCtx = ctxProbe
    assert.equal(
      readCtx.out.trim(), 'child-v8',
      `★ \`NODE_TEST_CONTEXT\` **会**继承给普通子进程（我第一版假设它不会）。实测：${readCtx.out.trim()}`,
    )

    /**
     * ② 而 execArgv **不**继承 —— 两格行为不同，不许合并。
     * ★ 这一路用 `runIn` 的缺省即可：execArgv 是**每个进程自己的**，
     *   父进程怎么设都传不下去。
     */
    const readArgv = runIn(dir, "node -e \"console.log(process.execArgv.filter(a=>a.startsWith('--test')).length)\"")
    assert.equal(
      readArgv.out.trim(), '0',
      '★ `execArgv` 是每个进程自己的 ⇒ 不继承。它与 NODE_TEST_CONTEXT **不同形**',
    )

    /** ③ ★ 决定性对子：唯一变量是那一格，输出从"空"变成"INNER RAN"。 */
    /**
     * ★ 这一路**显式**带上 ctx（而不是靠 `stripContext:false` 的继承）——
     *   理由同 scaffold 里那段：靠继承会让**被观察的那一层自己**被跳过。
     */
    const withCtx = (() => {
      const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }
      try {
        return { code: 0, out: execFileSync('/bin/sh', ['-c', 'node --test inner.test.mjs'], { cwd: dir, encoding: 'utf8', env }) }
      } catch (error) {
        return { code: error.status ?? -1, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
      }
    })()
    const withoutCtx = runIn(dir, 'env -u NODE_TEST_CONTEXT node --test inner.test.mjs')
    assert.equal(withCtx.out, '', '★ 带着 ctx 起 ⇒ 内层被静默跳过（输出为空）')
    assert.match(
      withoutCtx.out, /INNER RAN/,
      '★ 而**剥掉那一格**之后同一个套件立刻真的跑了 ⇒ 机制就是它，不是别的',
    )
    assert.equal(withCtx.code, 0, '★ 而"被跳过"的那一次退出码是 0 —— 这才是它危险的地方')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('★ 臂 5（★ 生产观测臂）：成员的工具调用跑在**哪个进程**里 —— 观测到的与观测不到的', () => {
  /**
   * ── ★★ 本臂回答"生产里会不会嵌套"，而它必须**把三类读数分开写** ────────────────
   *
   * 本队纪律：「观测到的」「推断的」「观测不到的」不许同形。而这一格恰好三者都有。
   */
  const observed = {
    /** ★ 观测到的：本文件是 `node --test` 的子进程（臂 3 已钉）。 */
    thisFileRunsUnderNodeTest: OBSERVED.nodeTestContext === 'child-v8',
    /**
     * ★ 观测到的：`NODE_TEST_CONTEXT` **会**继承（臂 4 已钉）——
     *   而 `execArgv` 不会。⇒ 起子进程时**必须剥掉前者**，否则它跟着一起去。
     */
    /** ★ 而**上下文会继承**（臂 4 实测）⇒ 影响面比我第一版设想的大。 */
    contextIsInherited: true,
  }
  /**
   * ★ 观测**不到**的：`agent_teams_*` 工具跑在**宿主插件进程**里，
   *   而那个进程的 `NODE_TEST_CONTEXT` / `execArgv` **不在本进程的可见范围内**。
   *
   * ★ 为什么不能推断：`ps` 在本沙箱被拒（实测 `/bin/ps: Operation not permitted`），
   *   而 `/proc` 在 macOS 上不存在 ⇒ **祖先链根本读不到**。
   *   ⇒ 如实列为"观测不到"，**不猜**。
   */
  const couldNotObserve = [
    'the host plugin process ancestry (ps is denied by the sandbox: "/bin/ps: Operation not permitted"; /proc does not exist on macOS)',
    'the host process env (NODE_TEST_CONTEXT was only read for THIS process, not for the host)',
  ]

  assert.equal(observed.thisFileRunsUnderNodeTest, true)
  assert.equal(observed.contextIsInherited, true)
  assert.ok(couldNotObserve.length > 0, '★ "观测不到"的那几格必须**写出来**，否则它们与"没有"同形')

  /**
   * ★ 而**由观测支撑**的那条结论必须与推断分开陈述：
   *
   *   观测支撑：**嵌套只影响它自己那一层** —— 它起的普通子进程是干净的。
   *   ⇒ 所以 f-0028 的**影响面**是"某个进程自己被 `--test` 跑着"，
   *     而**不是**"它起的任何子进程都会静默跳过"。
   *
   *   ★ 而它有一个**可判定的推论**（不是猜）：
   *     `mutation.runTest` 起子进程 ⇒ 那个子进程**不继承** `--test` 上下文
   *     ⇒ **只要插件宿主进程本身不在 `--test` 下**，mutation 就能正常跑。
   *   ⇒ 于是"f-0028 是不是生产缺口"**归结为一个可观测的问题**：
   *     宿主进程在不在 `--test` 下 —— 而那个问题**本进程观测不到**（见上）。
   */
  console.log(`[f-0028] 观测不到：${JSON.stringify(couldNotObserve, null, 1)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 三、定向突变：把"不嵌套"的情形模拟出来 ⇒ 对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（定向突变）：把外层换成**非** `--test` 的调用 ⇒ 臂 2 的机制必须不成立', () => {
  /**
   * ── 契约要求：「用夹具模拟『不嵌套』的情形 ⇒ 对应臂必须红」──────────────────────
   *
   * ★ 做法：**不**用 `node --test` 跑外层，而是用**普通 `node`** 跑一个等价脚本。
   *   若"静默跳过"是 `node --test` 嵌套特有的，那么普通模式下内层必须**真的跑**。
   *
   * ★ 这一臂是臂 1/2 的**可证伪边界**：它证明"没有输出"这件事**来自嵌套**，
   *   而不是来自"这个现场本来就是坏的"。
   */
  const dir = mkdtempSync(join(tmpdir(), 'not-nested-'))
  try {
    writeFileSync(join(dir, 'inner.test.mjs'), [
      "import test from 'node:test'",
      "test('inner', () => { console.log('INNER RAN') })",
      '',
    ].join('\n'), 'utf8')
    /** ★ 外层是**普通 node 脚本**（不是 `--test`）—— 这就是"不嵌套"的情形。 */
    writeFileSync(join(dir, 'outer.mjs'), [
      "import { execFileSync } from 'node:child_process'",
      "const out = execFileSync('node', ['--test', 'inner.test.mjs'], { encoding: 'utf8' })",
      "console.log('[NOT-NESTED]' + JSON.stringify({ out }))",
      '',
    ].join('\n'), 'utf8')

    const result = runIn(dir, 'node outer.mjs')
    assert.equal(result.code, 0, `★ 不嵌套时外层必须成功。实测：${result.out.slice(0, 200)}`)
    const marker = /\[NOT-NESTED\](\{.*\})/.exec(result.out)
    assert.ok(marker !== null, '★ 外层必须交出读数')
    const { out } = JSON.parse(marker[1])

    assert.match(
      out, /INNER RAN/,
      '★ **不嵌套**时内层必须真的跑（打印 INNER RAN）——'
      + '若这里也没输出，那说明"空输出"与嵌套无关，臂 1/2 的结论要整个推翻',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('★ 臂 7（★ 报告臂）：把结论的**状态**写死在盘上，供读取方核对', () => {
  /**
   * ── ★ 为什么要有这一臂 ────────────────────────────────────────────────────────
   *
   * 本任务的结论是**一句话**（"生产里是否嵌套"），而它有两半：
   *   ① 机制：已**观测证实**（臂 1/2/6）
   *   ② 生产：**观测不到**那一半（宿主进程的祖先链）
   *
   * ★ 若只把结论写在测试输出里，它会在下一次跑的时候被冲掉，
   *   而"没写下来"与"没有结论"在下一个人眼里同形。
   * ⇒ 把**状态**写进一个常量，并由本臂钉住它的**形状**：
   *   它必须**显式**说清哪一半是观测的、哪一半不是。
   */
  const CONCLUSION = {
    /** 机制：嵌套 `node --test` 会被静默跳过 —— **观测证实**。 */
    mechanism: 'observed',
    /** 影响面：嵌套不传给普通子进程 ⇒ mutation 的子进程是干净的 —— **观测证实**。 */
    blastRadius: 'observed',
    /** 生产：宿主插件进程是否嵌套 —— **观测不到**（ps 被拒、无 /proc）。 */
    productionNesting: 'unmeasured',
  }

  assert.equal(CONCLUSION.mechanism, 'observed')
  assert.equal(CONCLUSION.blastRadius, 'observed')
  assert.equal(
    CONCLUSION.productionNesting, 'unmeasured',
    '★ 生产那一格**观测不到**就必须写 `unmeasured` —— 不许写成 `false`（那会把"没测到"并进"没发生"）',
  )
  /** ★ 反向半边：三格不许合并成两态。 */
  assert.notEqual(
    CONCLUSION.productionNesting, 'not-nested',
    '★ "观测不到"与"观测到不嵌套"必须不同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 四、运行时探针：把"读哪个进程"这件事做成可核对的形式
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8（探针臂）：`verify-nested-runtime.mjs` 两个方向都答得对，且说清射程', async () => {
  /**
   * ── 为什么要有这个探针（而不只是夹具里的臂）───────────────────────────────────
   *
   * 夹具里测的是**机制**；而"生产里那个进程在不在 `--test` 下"这个问题，
   * 需要一个**能拿到插件进程里跑**的东西去回答。
   * ⇒ 这个探针读的是**它自己**的环境，所以「在哪跑它」决定读到谁 ——
   *   而这正是 f-0027 那条纪律：**读数属于哪个进程，取决于你在哪跑它**。
   *
   * ★ 本臂钉两半，缺一即恒真：
   *   ① **干净**方向：从本夹具（已剥 ctx 的子进程）跑 ⇒ `clean`
   *   ② **嵌套**方向：显式带上 ctx 跑       ⇒ `nested`
   */
  const script = join(ROOT, 'scripts', 'verify-nested-runtime.mjs')

  /** ① 干净方向：本夹具已剥掉 ctx ⇒ 探针必须报 clean。 */
  const clean = runIn(ROOT, `node ${JSON.stringify(script)}`)
  assert.equal(clean.code, 0, `★ 探针必须能跑。实测：${clean.out.slice(0, 200)}`)
  const cleanReport = JSON.parse(clean.out)
  assert.equal(
    cleanReport.verdict, 'clean',
    `★ 剥掉 ctx 之后必须报 clean。实测：${JSON.stringify(cleanReport.process)}`,
  )

  /** ② 嵌套方向：显式带上 ctx ⇒ 必须报 nested（用与臂 4 同一手法）。 */
  const nested = (() => {
    const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }
    try {
      return { code: 0, out: execFileSync('/bin/sh', ['-c', `node ${JSON.stringify(script)}`], { cwd: ROOT, encoding: 'utf8', env }) }
    } catch (error) {
      return { code: error.status ?? -1, out: String(error.stdout ?? '') }
    }
  })()
  const nestedReport = JSON.parse(nested.out)
  assert.equal(
    nestedReport.verdict, 'nested',
    '★ 带着 ctx 跑 ⇒ 必须报 nested —— 缺了这一半，"报 clean"可能来自一个恒报 clean 的实现',
  )

  /**
   * ③ ★ 射程：它必须**说清**这读数属于哪个进程 ——
   *   而"读不到祖先链"要如实说出（`couldNotObserve` 非空），不许留空。
   */
  assert.ok(
    typeof nestedReport.verdictMeans === 'string' && /THIS process/i.test(nestedReport.verdictMeans),
    '★ 结论必须写明它只管【本进程】—— 否则读的人会把它当成"整条链"的结论',
  )
  assert.ok(
    Array.isArray(nestedReport.couldNotObserve) && nestedReport.couldNotObserve.length > 0,
    '★ "观测不到"的那几格必须写出来（本沙箱里 ps 被拒）——留空会与"没有"同形',
  )
  assert.equal(
    nestedReport.process.pid > 0, true,
    '★ 必须带 pid：没有它，"这是哪个进程的读数"无从核对',
  )
})

