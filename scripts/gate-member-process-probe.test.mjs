/**
 * ── f-0028 生产探针的夹具（t45）：成员那一侧到底看不看得见 `node --test` ──────────────
 *
 * ── 这一份要证明的三件事 ────────────────────────────────────────────────────────
 *
 *   ① 机制：嵌套 ⇒ `node --test` **静默跳过**（不跑测试、而 exitCode 仍是 0）
 *      ★ 这一条是 f-0028 的**全部要害**：被跳过的运行与通过**在退出码上同形**
 *   ② 探针：`scripts/verify-nested-runtime.mjs` 能**区分**嵌套与不嵌套（三态互不同形）
 *   ③ 射程：探针**如实**说出它观测不到什么 —— 尤其是 `execArgv` 那条**不对称**
 *      （它不随 bash 子进程继承，所以从成员侧读它**读到的永远是自己**）
 *
 * ── ★ 为什么这些臂不能只"跑一下看输出"──────────────────────────────────────────
 *
 * 本任务要回答的是一个**关于生产的事实**，而夹具能提供的只有**机制**与**射程**。
 * ⇒ 本文件刻意不把"生产里是 clean"写死成断言：那取决于运行环境，而夹具**自己**
 *   就在 `node --test` 下跑 ⇒ 它读自己的环境只会读到嵌套，与生产无关。
 *   ★ 这正是 f-0027 的纪律（读数属于哪个进程），也是本任务要求区分【观测】与【推断】的落点。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = join(ROOT, 'scripts', 'verify-nested-runtime.mjs')

/** 一个最小的内层测试文件：它必须**打印**，否则"跳过"与"跑了但静默"分不开。 */
function innerFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'f0028-'))
  const file = join(dir, 'inner.test.mjs')
  writeFileSync(file, [
    "import { test } from 'node:test'",
    "import assert from 'node:assert/strict'",
    "test('inner arm that must print', () => { console.log('INNER RAN'); assert.equal(1, 1) })",
    '',
  ].join('\n'))
  return { dir, file }
}

/**
 * ── 起一次内层 `node --test`，把 **两个流** 与 **退出码** 都取回来 ──────────────────
 *
 * ★★ MEASURED（本臂第一版在这里红）：那句 `skipping running files` 的 warning
 *   走的是 **stderr**，而**被跳过的运行退出码是 0**。
 *
 *     `execFileSync` 在**成功时**只把 stdout 交出来（stderr 进不去返回值，因为没抛错）
 *     ⇒ 一个"成功时只读 stdout"的调用方**永远看不到那句话**。
 *
 * ★ 而这不是夹具的小毛病 —— 它是 f-0028 的**同一个形态**：
 *   唯一能把"跳过"与"通过"分开的信号，落在了一条**按成功路径就没人读**的通道上。
 *   ⇒ 所以这里用 `spawnSync`，**两个流都显式收下**，不依赖"失败了才有 stderr"。
 */
function runInner(file, cwd, env) {
  const result = spawnSync('/bin/sh', ['-c', `node --test ${file}`], { cwd, env, encoding: 'utf8' })
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    /** ★ 两个流都保留：`stdout` 里有测试的输出，`stderr` 里有那句"跳过"的 warning。 */
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    get output() { return `${this.stdout}${this.stderr}` },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 机制臂）：嵌套 ⇒ 内层**静默跳过**，而退出码仍是 0
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（机制臂）：NODE_TEST_CONTEXT 在场 ⇒ 内层 node --test 不跑测试，而 exitCode 仍是 0', () => {
  const { dir, file } = innerFixture()
  try {
    /** 对照：**没有**那一格 ⇒ 内层正常跑（否则下面的"跳过"没有参照）。 */
    const cleanEnv = { ...process.env }
    delete cleanEnv.NODE_TEST_CONTEXT
    const clean = runInner(file, dir, cleanEnv)

    const nestedEnv = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }
    const nested = runInner(file, dir, nestedEnv)

    assert.equal(clean.exitCode, 0, '★ 对照：干净的运行必须成功')
    assert.match(clean.output, /INNER RAN/, '★ 对照：干净运行时那条测试**必须真的跑**（否则本臂没有参照物）')

    assert.doesNotMatch(
      nested.output, /INNER RAN/,
      '★ NODE_TEST_CONTEXT 在场时，内层那条测试**一条都没跑** —— 这就是 f-0028 的静默跳过',
    )
    /**
     * ★★ 这一条是本臂的**核心断言**，也是整个 f-0028 的要害：
     *   被跳过的那次运行**退出码仍然是 0** ⇒ 与"通过"在退出码上**同形**。
     *   而 `completion.r5` / `mutation` 正是靠 exitCode 判绿的。
     */
    assert.equal(
      nested.exitCode, 0,
      '★ 被静默跳过的运行必须**仍然返回 0** —— 这正是"把没测到并进通过"在子进程边界上的现身',
    )
    /**
     * ★ 而它确实**说了一句话**（warning）——所以"完全没有任何输出"并不准确：
     *   准确的说法是"**测试的输出**完全没有"。这两者不同，写清楚免得下一个人
     *   拿"有输出"去论证"跑了测试"。
     */
    assert.match(
      nested.output, /skipping running files/i,
      '★ 跳过时应当留下那句 warning —— 它是唯一能把两者分开的**人话**（退出码分不开）',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 探针三态臂）：nested / clean 必须**不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（★ 探针三态臂）：探针对 NODE_TEST_CONTEXT 的有无给出**不同**的 verdict', () => {
  /**
   * ★ 这一臂测探针本身，而**不是**测生产。理由写在文件头：
   *   夹具自己在 `node --test` 下跑 ⇒ 它读自己的环境只会读到嵌套。
   *   ⇒ 要测探针的**分辨力**，必须**显式**给它两种环境。
   */
  const run = (env) => JSON.parse(execFileSync('node', [PROBE], { env, encoding: 'utf8' }))

  const cleanEnv = { ...process.env }
  delete cleanEnv.NODE_TEST_CONTEXT
  const clean = run(cleanEnv)
  const nested = run({ ...process.env, NODE_TEST_CONTEXT: 'child-v8' })

  assert.equal(clean.verdict, 'clean', '★ 环境里没有那一格 ⇒ 必须报 clean（观测到"不在"）')
  assert.equal(nested.verdict, 'nested', '★ 环境里有那一格 ⇒ 必须报 nested')
  assert.notEqual(clean.verdict, nested.verdict, '★ 两个结论必须不同形（否则探针是恒定的）')

  /**
   * ★★ 而两个结论的**措辞**也必须不同形 —— 一个只会印 verdict 的探针
   *   会让人以为两种情况说的是同一件事。★ 尤其：两者的**后果**完全不同。
   */
  assert.match(nested.verdictMeans, /SKIPPED/i, '★ nested 的措辞必须说清后果（会被跳过）')
  assert.match(clean.verdictMeans, /would run its tests/i, '★ clean 的措辞必须说清"从这儿起的内层会真的跑"')
  assert.notEqual(clean.verdictMeans, nested.verdictMeans)

  /** ★ 读数必须**可归属**（否则"这是哪个进程的读数"无从核对）。 */
  assert.equal(typeof clean.process.pid, 'number')
  assert.equal(typeof clean.process.ppid, 'number')
  assert.notEqual(clean.process.pid, nested.process.pid, '★ 两次运行是不同的进程 —— 读数各自属于自己那一个')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 射程臂）：探针必须**如实**说出它观测不到什么
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（★★ 射程臂）：观测到的与观测不到的必须分开，且 execArgv 的不对称要说清', () => {
  const cleanEnv = { ...process.env }
  delete cleanEnv.NODE_TEST_CONTEXT
  const report = JSON.parse(execFileSync('node', [PROBE], { env: cleanEnv, encoding: 'utf8' }))

  /**
   * ★ ① `NODE_TEST_CONTEXT` 走**环境**、会被 bash 子进程继承
   *   ⇒ 它是一条**覆盖整条调用链**的观测。这条断言钉住它被当成观测（而不是推断）。
   */
  assert.equal(report.observed.inheritedEnvironmentLacksNodeTestContext, true)

  /**
   * ★★ ② `execArgv` 是**每进程**的 —— 一个 bash 起的新 node **看不到**父进程的。
   *   探针必须把它标注成"只说明本进程"，并把**祖先的 execArgv** 列进 `couldNotObserve`。
   *   ★ 缺了这一条，读的人会把 `execArgvHasTest: false` 误读成"宿主没有 --test" ——
   *     而它**只是我这个进程没有**。那是本队记过的"读错位置的出口"。
   */
  assert.equal(report.observed.thisProcessExecArgvLacksTest, true)
  assert.ok(
    report.couldNotObserve.some((line) => /ancestors' execArgv/i.test(line)),
    '★★ 必须明说"祖先的 execArgv 观测不到" —— 否则一个 bash 子进程的 clean execArgv 会被当成宿主的证据',
  )
  assert.ok(
    report.couldNotObserve.some((line) => /HOST plugin process/i.test(line)),
    '★ 必须明说"宿主进程自己的 execArgv 观测不到"（那正是 f-0028 想问的那一格）',
  )

  /**
   * ★★ ③ 祖先链那一格：`ps` 在本沙箱被拒 ⇒ 必须落 `available: false` + `reason`，
   *   **不是**空链。★ 空链会被读成"链上什么都没有"，而那是一次**失败的读取**。
   */
  assert.equal(report.ancestry.available, false, '★ 本沙箱读不到祖先链（ps 被拒）')
  assert.match(report.ancestry.reason, /ps is not readable/i, '★ 而且必须说清**为什么**读不到')
  assert.ok(
    report.couldNotObserve.some((line) => /ancestry/i.test(line)),
    '★ 读不到的东西必须出现在 couldNotObserve 里 —— 否则与"没有"同形',
  )

  /**
   * ★ ④ 三态：`clean` 必须**同时**由"观测到"支撑，而不是把读不到当成读到了。
   */
  assert.equal(report.verdict, 'clean')
  assert.equal(
    report.observed.inheritedEnvironmentLacksNodeTestContext, true,
    '★ "clean" 必须由一条**观测**支撑（不是由一次失败的读取）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（对照臂）：探针里的**机制自证**必须成立
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（对照臂）：探针自带机制自证，且它**独立于本进程环境**', () => {
  /**
   * ★ 为什么需要它：`verdict` 只是一个字符串。若没有自证，整个探针可能建立在一个
   *   **已经坏掉的假设**上（比如"跳过"其实另有原因），而它读起来完全正常。
   *   ⇒ 自证把那句话变成**当场可复现**的事实。
   *
   * ★ 而它必须**不受本进程环境影响**（否则在嵌套环境里它就复现不出来）
   *   ⇒ 两种环境各跑一次，两次的自证都必须是 `reproduced`。
   */
  const read = (env) => JSON.parse(execFileSync('node', [PROBE], { env, encoding: 'utf8' })).mechanism

  const cleanEnv = { ...process.env }
  delete cleanEnv.NODE_TEST_CONTEXT
  const fromClean = read(cleanEnv)
  const fromNested = read({ ...process.env, NODE_TEST_CONTEXT: 'child-v8' })

  for (const [label, mechanism] of [['clean env', fromClean], ['nested env', fromNested]]) {
    assert.equal(
      mechanism.verdict, 'reproduced',
      `★ 机制自证在 ${label} 下必须成立（它不读环境，两处应一致）`,
    )
    assert.equal(mechanism.withoutNodeTestContext.ranInner, true, `★ ${label}：无那一格 ⇒ 内层必须真的跑`)
    assert.equal(mechanism.withNodeTestContext.ranInner, false, `★ ${label}：有那一格 ⇒ 内层必须被跳过`)
    /**
     * ★★ 而两条路的 **exitCode 都是 0** —— 这句话就是"同形"的可执行形式。
     */
    assert.equal(mechanism.withoutNodeTestContext.exitCode, 0)
    assert.equal(mechanism.withNodeTestContext.exitCode, 0)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（诚实边界臂）：本文件**不**断言生产里是 clean
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（诚实边界臂）：探针源码里**不许**把生产的结论写死', () => {
  /**
   * ── 这一臂是"区分观测与推断"在**源码层**的落点 ──────────────────────────────────
   *
   * 本任务要回答的是一个**关于生产的事实**。而它的读数取决于**运行环境**：
   *
   *     在成员里跑   ⇒ 成员那条链的读数（有资格）
   *     在命令行跑   ⇒ 命令行进程的读数（f-0027：**没有**资格替插件进程作证）
   *     在夹具里跑   ⇒ 夹具自己在 `node --test` 下 ⇒ 必然读到 nested
   *
   * ⇒ 一个把"生产 = clean"写进源码的探针，会在**任何**环境下都报同一个结论 ——
   *   而那正是本队记账的**恒真**写法。
   *
   * ★ 可执行形式：探针的结论必须**由读到的值算出来**（`process.env` / `execArgv`），
   *   而源码里**不许**出现一个写死的 `'clean'` 字面量。
   */
  const source = readFileSync(PROBE, 'utf8')
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  assert.match(code, /process\.env\.NODE_TEST_CONTEXT/, '★ 结论必须**读环境**得到，而不是写死')
  assert.match(code, /process\.execArgv/, '★ execArgv 那一格也必须来自读进程')
  /**
   * ★ 写死的 `verdict: 'clean'` 是这一格最可能的坏法（一个字面量就是恒真）。
   *   ★ 而 `'clean'` 作为**比较的右值**是合法的（`x === 'clean'`）⇒ 只禁"直接赋值"。
   */
  assert.doesNotMatch(
    code, /verdict\s*:\s*'clean'/,
    '★ 探针不许把 "clean" 写死成结论 —— 那会让它在任何环境下都报同一个答案（恒真）',
  )
  assert.doesNotMatch(
    code, /verdict\s*:\s*'nested'/,
    '★ 同理，不许把 "nested" 写死',
  )
})

test('★ 臂 6（★ 采样臂）：本夹具**自己**在 node --test 下 —— 记下这一格读数', async (t) => {
  /**
   * ★★ 这一臂把一件容易被忽略的事实留下痕迹：**本夹具运行在 `node --test` 里**。
   *
   * ⇒ 夹具**不能**用自己的环境去回答"生产里怎么样"（它必然读到 nested）。
   *   这不是缺陷，是射程：夹具能证的是**机制**与**探针的分辨力**，
   *   而**生产那一格**必须由一个成员在自己的进程里跑探针来回答。
   *
   * ★ 用 `t.diagnostic` 而不是断言一个值：本臂**故意**不对"自己是不是嵌套"下判断
   *   （那取决于宿主怎么跑它）—— 它只把读数**留下来**，让读日志的人自己看。
   */
  t.diagnostic(
    `f-0028 采样：NODE_TEST_CONTEXT=${process.env.NODE_TEST_CONTEXT ?? '<unset>'} · `
    + `execArgvHasTest=${process.execArgv.some((a) => String(a).startsWith('--test'))} · `
    + `pid=${process.pid}. `
    + '★ 这一格是【夹具进程】的，不是成员/宿主进程的 —— 见文件头关于射程的说明。',
  )
  assert.ok(true)
})
