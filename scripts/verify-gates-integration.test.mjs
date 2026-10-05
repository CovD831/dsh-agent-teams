/**
 * ── 独立验证：判据层的【接线可达性】与【三臂】────────────────────────────────────
 *
 * 这个文件不是实现者的夹具的复制品。它由 verifier 在【不看他们的夹具】的前提下
 * 自己构造输入，回答三个他们无法自答的问题：
 *
 *   ① 每条判据真的会在 evaluate(point, ctx) 时被跑到吗？
 *      —— 不是"文件存在"，也不是"注册表里列了"。要看 evaluate 的 ran[] 里
 *         它到底是 'ok'/'blocked'/'unmeasured'，还是 'skipped'（被 appliesTo 跳过）
 *         或者压根不在 ran 里（point 挂错位置 ⇒ 永远跑不到）。
 *
 *   ② 三臂是否真的成立？★ 最容易出的错：
 *      · 对照臂其实和伪造臂测的是同一件事（那对照臂是空转）；
 *      · 未测量臂返回了 ok（把"没测到"并进"通过"）。
 *      所以本文件对每条判据都断言：三态的【形状】互不相同，
 *      且 unmeasured 绝不等于 ok。
 *
 *   ③ ★ 缺省方向：什么都不注入时，留下的是拒绝/未测量，还是通过？
 *      一条只在被配置时才运行的检查，其缺省必须导致拒绝，而不是跳过。
 *
 * ── 与实现者夹具的关系 ────────────────────────────────────────────────────────
 * 他们的夹具证明"我写的这条判据按我想的跑"。本文件证明"判据层整体上
 * 真的会被调用、且它的缺省不是放行"——后者是装配与契约的性质，不是单条判据的。
 *
 * ── 为什么文件名不是 gate-*.test.mjs ─────────────────────────────────────────
 * 它是【集成/接线】验证，不是某一条判据的夹具。按仓库硬约束，不匹配 gate-* glob
 * 的测试必须显式列进 package.json 的 test:gates，否则是"有 0 个读者"的测试。
 * 本文件已显式列入。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRegistry, registry, INSERTION_POINTS } from '../lib/gates/index.js'

/** 每种裁决的【形状】—— 三态不同形的机械判据。 */
function shapeOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return `non-object:${JSON.stringify(verdict)}`
  if (verdict.ok === true) return 'ok'
  if (Array.isArray(verdict.blockers)) return 'blocked'
  if (typeof verdict.unmeasured === 'string') return 'unmeasured'
  return `malformed:${JSON.stringify(verdict)}`
}

/** 断言一条裁决是 blocked（且说清了为什么）。 */
function assertBlocked(verdict, why) {
  assert.equal(shapeOf(verdict), 'blocked', `${why}: expected blocked, got ${JSON.stringify(verdict)}`)
  assert.ok(verdict.blockers.length > 0, `${why}: blocked must say why`)
}
/** 断言一条裁决是 unmeasured（★ 且绝不是 ok）。 */
function assertUnmeasured(verdict, why) {
  assert.equal(shapeOf(verdict), 'unmeasured', `${why}: expected unmeasured, got ${JSON.stringify(verdict)}`)
  assert.ok(verdict.unmeasured.trim().length > 0, `${why}: unmeasured must say what could not be measured`)
}
/** 断言一条裁决是 ok。 */
function assertOk(verdict, why) {
  assert.equal(shapeOf(verdict), 'ok', `${why}: expected ok, got ${JSON.stringify(verdict)}`)
}

/** 从一次 evaluate 里取出某条判据的条目（没有 ⇒ undefined，这本身就是"跑不到"）。 */
function ranEntry(evaluation, id) {
  return evaluation.ran.find((entry) => entry.id === id)
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 接线可达性：每条判据在 evaluate 时都产生裁决，而不是被跳过
// ─────────────────────────────────────────────────────────────────────────────
//
// ★ 这一节用【我自己构造】的 ctx，它把每条判据需要的输入都注满（"什么都给"）。
//   一个 point 挂错的判据在这里会【根本不出现在 ran 里】—— 那是本节要抓的形态。

/** 一个"什么都注入"的 dispatch ctx（changed-paths + worktree 都能测）。 */
function fullyInjectedDispatchCtx() {
  return {
    task: { id: 't-x', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
    // dispatch.changed-paths
    observedChangedPaths: ['src/a.ts'],
    // dispatch.worktree
    worktreePath: '/tmp/wt-t-x',
    workspace: '/tmp/main',
    arrival: {
      worktreeReadable: true,
      absentInWorktree: [],
      mainReadable: true,
      presentInMain: [],
    },
  }
}

/** 一个"什么都注入"的 completion ctx（四条判据都能测）。 */
function fullyInjectedCompletionCtx() {
  return {
    wantsCompleted: true,
    taskNotTerminal: true,
    task: {
      id: 't-x',
      kind: 'implementation',
      inScope: ['src/'],
      verify: ['true'],
      changedPaths: ['src/a.ts'],
      commandsRun: [{ command: 'true', status: 'passed', exitCode: 0 }],
    },
    update: {
      status: 'completed',
      changedPaths: ['src/a.ts'],
      newTestFiles: ['scripts/gate-x.test.mjs'],
      commandsRun: [{ command: 'true', status: 'passed', exitCode: 0 }],
    },
    // completion.verify-rerun
    execVerifyCommand: async () => 0,
    // completion.r5
    parentRevision: 'parent-sha',
    scanDirs: ['scripts'],
    runTestOnRevision: async (_test, revision) => ({ exitCode: revision === 'parent-sha' ? 1 : 0 }),
    // completion.mutation
    readFile: () => 'const a = 1\n',
    writeFile: () => {},
    runTest: async () => ({ status: 'passed', exitCode: 0 }),
    changedFiles: ['src/a.ts'],
    changedLines: [1],
    killerSuites: [{ files: ['scripts/gate-x.test.mjs'], command: 'node --test scripts/gate-x.test.mjs' }],
    testCommand: 'node --test *',
    // completion.backtest
    changedPaths: ['src/a.ts'],
    baseline: { label: 'parent-sha', exitCode: 0 },
    coverage: {
      source: 'dependency-graph',
      dependents: { 'src/a.ts': ['src/b.ts'] },
      coverage: { 'src/a.ts': ['scripts/gate-x.test.mjs'] },
      knownTests: ['scripts/gate-x.test.mjs'],
      selected: ['scripts/gate-x.test.mjs'],
    },
    execSelectedCommand: async () => 0,
    execBacktestCommand: async () => 0,
    fullScope: { coveredTests: ['scripts/gate-x.test.mjs'] },
  }
}

test('① 接线：dispatch 位置的两条判据都会被 evaluate 跑到（不是 skipped、不是缺席）', async () => {
  const evaluation = await registry.evaluate('dispatch', fullyInjectedDispatchCtx())
  for (const id of ['dispatch.changed-paths', 'dispatch.worktree']) {
    const entry = ranEntry(evaluation, id)
    assert.ok(entry !== undefined, `"${id}" did not run at the dispatch point — it is registered somewhere else, or not registered at all`)
    assert.notEqual(entry.verdict, 'skipped', `"${id}" was skipped by appliesTo even though every input it needs was injected`)
  }
})

test('① 接线：completion 位置的四条判据都会被 evaluate 跑到（不是 skipped、不是缺席）', async () => {
  const evaluation = await registry.evaluate('completion', fullyInjectedCompletionCtx())
  for (const id of ['completion.verify-rerun', 'completion.r5', 'completion.mutation', 'completion.backtest']) {
    const entry = ranEntry(evaluation, id)
    assert.ok(entry !== undefined, `"${id}" did not run at the completion point — it is registered somewhere else, or not registered at all`)
    assert.notEqual(entry.verdict, 'skipped', `"${id}" was skipped by appliesTo even though every input it needs was injected`)
  }
  // ★ 四条都在同一个位置 ⇒ 顺序必须稳定且可预期（契约 §3）。
  const order = evaluation.ran.filter((e) => e.verdict !== 'skipped').map((e) => e.id)
  assert.deepEqual(
    order,
    ['completion.verify-rerun', 'completion.r5', 'completion.mutation', 'completion.backtest'],
    'the completion evaluation order changed; the contract pins it as cheap-mechanical first, process-spawning last',
  )
})

test('① 接线：注册清单里每条判据都能在它自己的位置上被求值（无死条目）', async () => {
  const list = registry.list()
  const dispatchCtx = fullyInjectedDispatchCtx()
  const completionCtx = fullyInjectedCompletionCtx()
  const contexts = { dispatch: dispatchCtx, completion: completionCtx }
  for (const point of INSERTION_POINTS) {
    const registered = list[point] ?? []
    if (registered.length === 0) continue
    // ★ 只在有 ctx 的两个位置上做可达性断言；其余位置本就没有判据，也没有编排入口。
    if (contexts[point] === undefined) continue
    const evaluation = await registry.evaluate(point, contexts[point])
    for (const { id } of registered) {
      assert.ok(
        ranEntry(evaluation, id) !== undefined,
        `"${id}" is listed under "${point}" but evaluate("${point}") never reached it`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ② 三臂：自己构造输入，断言三态（不看他们的夹具）
// ─────────────────────────────────────────────────────────────────────────────

test('② verify-rerun 三臂：伪造 ⇒ blocked / 无执行器 ⇒ unmeasured / 重跑一致 ⇒ ok', async () => {
  const { gate } = await import('../lib/gates/completion/verify-rerun.js')
  const base = () => ({
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { id: 't1', verify: ['node --test x.mjs'] },
    update: { commandsRun: [{ command: 'node --test x.mjs', status: 'passed', exitCode: 0 }] },
  })

  // 伪造臂：成员报 passed，重跑得到非零
  const fabricated = await gate({ ...base(), execVerifyCommand: async () => 1 })
  assertBlocked(fabricated, 'verify-rerun fabricated arm')

  // 未测量臂：没有执行器
  const unmeasuredArm = await gate({ ...base(), execVerifyCommand: undefined })
  assertUnmeasured(unmeasuredArm, 'verify-rerun unmeasured arm')

  // 对照臂：重跑与自报一致
  const control = await gate({ ...base(), execVerifyCommand: async () => 0 })
  assertOk(control, 'verify-rerun control arm')

  // ★ 三态互不相同 —— "未测到"绝不等于"通过"
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(control))
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(fabricated))
})

test('② changed-paths 三臂：虚报 ⇒ blocked / 无观察 ⇒ unmeasured / 完全对上 ⇒ ok', async () => {
  const { gate } = await import('../lib/gates/dispatch/changed-paths.js')
  const base = () => ({
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts', 'src/b.ts'] },
  })

  // 伪造臂：自报两个文件，会话里只观察到一个
  const fabricated = gate({ ...base(), observedChangedPaths: ['src/a.ts'] })
  assertBlocked(fabricated, 'changed-paths fabricated arm')

  // 未测量臂：拿不到会话事件（undefined，而不是 []）
  const unmeasuredArm = gate({ ...base(), observedChangedPaths: undefined })
  assertUnmeasured(unmeasuredArm, 'changed-paths unmeasured arm')

  // 对照臂：自报与观察完全一致
  const control = gate({ ...base(), observedChangedPaths: ['src/b.ts', 'src/a.ts'] })
  assertOk(control, 'changed-paths control arm')

  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(control))

  // ★ 附加：undefined 与 [] 必须不同形（观察了但没写 = 虚报；没观察到 = 未测量）
  const observedEmpty = gate({ ...base(), observedChangedPaths: [] })
  assertBlocked(observedEmpty, 'changed-paths "observed nothing" is a fabrication verdict, not an unmeasured one')
})

test('② worktree 三臂：没到达 ⇒ blocked / 读不到 ⇒ unmeasured / 到达且没落主树 ⇒ ok', async () => {
  const { gate } = await import('../lib/gates/dispatch/worktree.js')
  const base = () => ({
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    worktreePath: '/tmp/wt-t1',
    workspace: '/tmp/main',
  })

  // 伪造臂：声明的改动在 worktree 里不存在
  const fabricated = gate({
    ...base(),
    arrival: { worktreeReadable: true, absentInWorktree: ['src/a.ts'], mainReadable: true, presentInMain: [] },
  })
  assertBlocked(fabricated, 'worktree fabricated arm (never arrived)')

  // 伪造臂 2：工作落到了主检出
  const leaked = gate({
    ...base(),
    arrival: { worktreeReadable: true, absentInWorktree: [], mainReadable: true, presentInMain: ['src/a.ts'] },
  })
  assertBlocked(leaked, 'worktree fabricated arm (landed in main checkout)')

  // 未测量臂：worktree 读不到
  const unmeasuredArm = gate({
    ...base(),
    arrival: { worktreeReadable: false, absentInWorktree: [], mainReadable: true, presentInMain: [], notes: ['EACCES'] },
  })
  assertUnmeasured(unmeasuredArm, 'worktree unmeasured arm')

  // 对照臂：到达且没落主树
  const control = gate({
    ...base(),
    arrival: { worktreeReadable: true, absentInWorktree: [], mainReadable: true, presentInMain: [] },
  })
  assertOk(control, 'worktree control arm')

  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(control))
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(fabricated))
})

test('② r5 三臂：新测试在父版本也绿 ⇒ blocked / 没有父版本 ⇒ unmeasured / 父红修复绿 ⇒ ok', async () => {
  const { gate } = await import('../lib/gates/completion/r5.js')
  const base = () => ({
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { id: 't1', kind: 'implementation', inScope: ['scripts/'] },
    update: { newTestFiles: ['scripts/gate-x.test.mjs'] },
    parentRevision: 'parent-sha',
    scanDirs: ['scripts'],
  })

  // 伪造臂：新测试在父版本上也通过（装饰性测试）
  const fabricated = await gate({ ...base(), runTestOnRevision: async () => ({ exitCode: 0 }) })
  assertBlocked(fabricated, 'r5 fabricated arm (decorative test)')

  // 对照臂：父版本上红、修复版本上绿
  const control = await gate({
    ...base(),
    runTestOnRevision: async (_test, revision) => ({ exitCode: revision === 'parent-sha' ? 1 : 0 }),
  })
  assertOk(control, 'r5 control arm')

  // 未测量臂：拿不到父版本（没有 worktree 的 base）
  const unmeasuredArm = await gate({
    ...base(),
    parentRevision: undefined,
    runTestOnRevision: async (_test, revision) => ({ exitCode: revision === '' ? 1 : 0 }),
  })
  assertUnmeasured(unmeasuredArm, 'r5 unmeasured arm (no parent revision)')

  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(control))
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(fabricated))
})

test('② mutation 三臂：变异体存活 ⇒ blocked / 缺执行器 ⇒ unmeasured / 全套件杀死 ⇒ ok', async () => {
  const { gate } = await import('../lib/gates/completion/mutation.js')
  // ★ 源码里必须有可被 L1/L2 算子打中的东西（一个字符串字面量与一处比较）。
  const source = ['export function hi(name) {', '  if (name === "hello") return "hi"', '  return "bye"', '}', ''].join('\n')
  // ★ 套件文本必须【提及】被变异文件（探针射程的判据），否则判据会正确地说
  //   "这个套件够不到 a.ts"⇒ unmeasured。那句是"关于探针的事实"，不是缺陷。
  const suiteText = "import test from 'node:test'\nimport { hi } from '../src/a.ts'\ntest('x', () => { hi('hello') })\n"

  const base = () => ({
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { id: 't1', kind: 'implementation', changedPaths: ['src/a.ts'] },
    update: { status: 'completed', changedPaths: ['src/a.ts'] },
    changedFiles: ['src/a.ts'],
    changedLines: [2],
    testCommand: 'node --test *',
    killerSuites: [{ files: ['scripts/gate-x.test.mjs'], command: 'node --test scripts/gate-x.test.mjs' }],
    // 只声明源文件本身为镜像目标以免默认 src→lib 镜像把 lib 也拉进来。
    mirrors: [],
    minKillRate: 1,
  })

  const files = { 'src/a.ts': source, 'scripts/gate-x.test.mjs': suiteText }

  /**
   * ★ 判据把套件输出解析成摘要（`parseTestSummary`），所以一个只有 exitCode
   *   的假 run 会被判 unmeasured（"没报告可读摘要"）—— 那是我造的输入不完整，
   *   不是判据的缺陷。这里给出真实形状的 node:test spec 输出。
   */
  const runWith = (failed, failingFile) => async () => ({
    exitCode: failed > 0 ? 1 : 0,
    stdout: failed > 0
      ? `\n✖ ${failingFile} (1.2ms)\nℹ tests 1\nℹ pass 0\nℹ fail ${failed}\n`
      : `\n✔ ok (1.2ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n`,
  })

  // 对照臂：模拟的"套件"在源码被改动后失败（读到 mutated 文本 ⇒ 报红），
  // 且套件文本真的提及被变异文件 ⇒ 探针认为够得到 ⇒ 每个变异体都被杀死。
  let lastWritten = null
  const control = await gate({
    ...base(),
    readFile: (path) => (path === 'src/a.ts' && lastWritten !== null ? lastWritten : files[path]),
    readSuite: (path) => files[path] ?? files['scripts/gate-x.test.mjs'],
    writeFile: (path, contents) => {
      if (path === 'src/a.ts') lastWritten = contents === source ? null : contents
    },
    // 源码被注入变异体（≠ 原始文本）⇒ 测试失败 ⇒ 杀死。
    runTest: async () => (lastWritten === null
      ? { exitCode: 0, stdout: '\n✔ ok (1.2ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n' }
      : { exitCode: 1, stdout: '\n✖ src/a.ts (1.2ms)\nℹ tests 1\nℹ pass 0\nℹ fail 1\n' }),
  })

  // 未测量臂：缺 writeFile 执行器（★ 缺一即 unmeasured，不是 ok）
  const unmeasuredArm = await gate({
    ...base(),
    readFile: (path) => files[path],
    runTest: runWith(0, 'src/a.ts'),
    writeFile: undefined,
  })
  assertUnmeasured(unmeasuredArm, 'mutation unmeasured arm (no writeFile injected)')

  // 伪造臂：套件够得到、但注入后仍然通过 ⇒ 变异体存活 ⇒ 被拒（装饰性测试）
  const fabricated = await gate({
    ...base(),
    readFile: (path) => (path === 'src/a.ts' && lastWritten !== null ? lastWritten : files[path]),
    readSuite: (path) => files[path] ?? files['scripts/gate-x.test.mjs'],
    writeFile: (path, contents) => {
      if (path === 'src/a.ts') lastWritten = contents === source ? null : contents
    },
    runTest: runWith(0, 'src/a.ts'),
  })
  assert.equal(
    shapeOf(fabricated),
    'blocked',
    `a suite that keeps passing after every mutant is injected must be rejected as decorative, got ${JSON.stringify(fabricated).slice(0, 400)}`,
  )

  assert.equal(shapeOf(control), 'ok', `mutation control arm did not pass: ${JSON.stringify(control).slice(0, 500)}`)
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(control))
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(fabricated))
})

test('② backtest 三臂：全量红 ⇒ blocked / 没有基准 ⇒ unmeasured / 基准绿且全量绿 ⇒ ok', async () => {
  const { gate } = await import('../lib/gates/completion/backtest.js')
  const base = () => ({
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
    changedPaths: ['src/a.ts'],
    coverage: {
      source: 'dependency-graph',
      dependents: {},
      coverage: { 'src/a.ts': ['scripts/gate-x.test.mjs'] },
      knownTests: ['scripts/gate-x.test.mjs'],
      selected: ['scripts/gate-x.test.mjs'],
    },
    fullScope: { coveredTests: ['scripts/gate-x.test.mjs'] },
  })

  // 伪造臂：基准绿，但全量退出非零 ⇒ 这次改动弄坏了东西
  const fabricated = await gate({
    ...base(),
    baseline: { label: 'parent-sha', exitCode: 0 },
    execBacktestCommand: async () => 1,
  })
  assertBlocked(fabricated, 'backtest fabricated arm')

  // 伪造臂 2：基准本来就不绿 ⇒ 拒绝，理由是"无法归因"
  const redBaseline = await gate({
    ...base(),
    baseline: { label: 'parent-sha', exitCode: 1 },
    execBacktestCommand: async () => 0,
  })
  assertBlocked(redBaseline, 'backtest red-baseline arm')

  // 未测量臂：没有基准
  const unmeasuredArm = await gate({
    ...base(),
    baseline: undefined,
    execBacktestCommand: async () => 0,
  })
  assertUnmeasured(unmeasuredArm, 'backtest unmeasured arm')

  // 对照臂：基准绿、选测绿、全量绿、全量覆盖全部已知测试
  const control = await gate({
    ...base(),
    baseline: { label: 'parent-sha', exitCode: 0 },
    execSelectedCommand: async () => 0,
    execBacktestCommand: async () => 0,
  })
  assertOk(control, 'backtest control arm')

  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(control))
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(redBaseline))
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ ★ 缺省状态的方向：什么都不注入时，留下的是拒绝/未测量，还是通过？
// ─────────────────────────────────────────────────────────────────────────────
//
// ★ 本队最警惕的形态：一条只在被配置时才运行的检查，其缺省必须导致拒绝。
//   下面逐条走"什么都不注入"的情形，报告它返回什么。

test('③ 缺省方向：什么都不注入时，每条判据都不得留下"通过"', async () => {
  const report = []
  const offending = []

  const cases = [
    ['completion.verify-rerun', () => import('../lib/gates/completion/verify-rerun.js'), { wantsCompleted: true, taskNotTerminal: true, task: { id: 't1', verify: ['x'] } }],
    ['completion.r5', () => import('../lib/gates/completion/r5.js'), { wantsCompleted: true, taskNotTerminal: true, task: { id: 't1', kind: 'implementation' }, update: { newTestFiles: ['scripts/gate-x.test.mjs'] } }],
    ['completion.mutation', () => import('../lib/gates/completion/mutation.js'), { wantsCompleted: true, taskNotTerminal: true, task: { id: 't1', kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] } }],
    ['completion.backtest', () => import('../lib/gates/completion/backtest.js'), { task: { id: 't1', kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] } }],
    ['dispatch.changed-paths', () => import('../lib/gates/dispatch/changed-paths.js'), { task: { id: 't1', kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] } }],
    ['dispatch.worktree', () => import('../lib/gates/dispatch/worktree.js'), { task: { id: 't1', kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] }, worktreePath: '/tmp/wt-t1', workspace: '/tmp/main' }],
  ]

  for (const [id, load, ctx] of cases) {
    const module = await load()
    const verdict = await module.gate(ctx)
    const shape = shapeOf(verdict)
    report.push(`${id} ⇒ ${shape}`)
    if (shape === 'ok') {
      offending.push(`${id} returned ok with nothing injected: ${JSON.stringify(verdict)}`)
    }
  }

  // ★ 这是本文件最重要的一条断言。
  assert.deepEqual(
    offending,
    [],
    `a gate that passes with no input injected is worse than one that was never installed, ` +
    `because it makes people believe something was checked:\n${offending.join('\n')}\n` +
    `full report:\n${report.join('\n')}`,
  )

  // 至少要有 5 条真的落在了 unmeasured 上（第 6 条 worktree 的"没有隔离要求"是 ok，
  // 因为那是"这里没有要测的东西"，不是"我测不了" —— 见下面那条测试单独钉住它）。
  const unmeasuredCount = report.filter((line) => line.endsWith('unmeasured')).length
  assert.ok(unmeasuredCount >= 5, `expected at least 5 gates to default to unmeasured, got ${unmeasuredCount}:\n${report.join('\n')}`)
})

test('③ ★ 真实路径：tools.ts 注入的 ctx 缺执行器时，返回 unmeasured 而不是 ok（免费强证据）', async () => {
  /**
   * ── 这条测试的由来 ────────────────────────────────────────────────────────
   *
   * `node scripts/lifecycle-verify.mjs` 目前断在 `:814`，消息里含两个 `[id]`。
   * 队长指出那不是判据的缺陷，而是判据在诚实工作，并且**它恰好是验证项③ 的
   * 一个真实样本**。所以这里把那个样本【钉成一条断言】，让它以后不能悄悄变成 ok。
   *
   * ★ 输入形状是逐字抄自 `src/tools.ts:1838-1853` 的【真实生产调用】——
   *   不是我为测试构造的理想 ctx。这是它与上面那条合成测试的区别：
   *   上面证明"判据在缺输入时拒绝"，这条证明"生产路径当下就在缺输入，且它拒绝"。
   *
   * ★ 这条断言有一个明确的未来：t7 补齐执行器注入面之后，它会变红。
   *   那时正确的动作不是删掉它，而是把它改成断言"补齐后四条都在跑"——
   *   换句话说，它是 t7 的验收锚点。
   */
  const toolsCtx = {
    task: {
      id: 't9',
      kind: 'implementation',
      verify: ['node --test scripts/x.test.mjs'],
      changedPaths: ['src/a.ts'],
      commandsRun: [{ command: 'node --test scripts/x.test.mjs', status: 'passed', exitCode: 0 }],
    },
    update: {
      status: 'completed',
      changedPaths: ['src/a.ts'],
      commandsRun: [{ command: 'node --test scripts/x.test.mjs', status: 'passed', exitCode: 0 }],
    },
    wantsCompleted: true,
    taskNotTerminal: true,
    execVerifyCommand: async () => 0,
  }

  const evaluation = await registry.evaluate('completion', toolsCtx)

  // ★ 核心断言：缺输入 ⇒ 整体不是 ok，且是 unmeasured（不是 blocked）
  assert.equal(evaluation.ok, false, 'the production path returned ok with no executors injected — that is the "default = pass" failure this whole task exists to prevent')
  assert.equal(
    typeof evaluation.unmeasured,
    'string',
    'the production path must say it could NOT measure (unmeasured), not that it found problems (blockers)',
  )
  assert.ok(evaluation.unmeasured.length > 0)

  // ★ 两个 [id] 都在，且逐个都是 unmeasured
  assert.match(evaluation.unmeasured, /\[completion\.mutation\]/)
  assert.match(evaluation.unmeasured, /\[completion\.backtest\]/)
  const byId = Object.fromEntries(evaluation.ran.map((entry) => [entry.id, entry.verdict]))
  assert.equal(byId['completion.mutation'], 'unmeasured')
  assert.equal(byId['completion.backtest'], 'unmeasured')
  // verify-rerun 拿到了它需要的执行器 ⇒ 它真的测了（这条证明"不是所有判据都在摆烂"）
  assert.equal(byId['completion.verify-rerun'], 'ok')
  // r5 在 tools.ts 没注入 newTestFiles ⇒ 按自己的 appliesTo 跳过（不是 unmeasured 噪音）
  assert.equal(byId['completion.r5'], 'skipped')

  /**
   * ★ 断言这两条 blocker 集合为空：它们的裁决是"我没能测量"，不是"我发现了问题"。
   *   若它们被并进 blockers，读日志的人会把一次"基础设施缺失"读成"代码有问题"。
   */
  assert.equal(evaluation.blockers.length, 0, 'a "could not measure" verdict must not be reported as a blocker')
})

test('③ 缺省方向：整位置求值（什么都不注入）不得返回 ok', async () => {
  // ★ 单条判据的缺省方向对了，还要看装配后的整体方向。
  const emptyCompletion = await registry.evaluate('completion', {
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { id: 't1', kind: 'implementation', verify: ['x'] },
    update: { status: 'completed', changedPaths: ['src/a.ts'] },
  })
  assert.equal(emptyCompletion.ok, false, 'evaluating completion with nothing injected returned ok — the default direction is "pass"')
  assert.ok(
    typeof emptyCompletion.unmeasured === 'string' && emptyCompletion.unmeasured.length > 0,
    'a completion evaluation with no inputs injected must say it could not measure',
  )
})

test('③ worktree 的"没有隔离要求"是 ok 但【带 skipped 标记】，与"通过"不同形', async () => {
  // ★ 这一条是上面那条断言的例外，必须单独钉住：它说的是"这里没有要测的东西"，
  //   而不是"我测了没问题"。如果它与真通过同形，就无法区分"不需要隔离"与"隔离良好"。
  const { gate } = await import('../lib/gates/dispatch/worktree.js')
  const verdict = gate({ task: { id: 't1', kind: 'work' }, update: { changedPaths: [] } })
  assert.equal(shapeOf(verdict), 'ok')
  assert.equal(typeof verdict.skipped, 'string', 'a no-worktree verdict must carry a reason, otherwise "not needed" and "passed" look identical')
  assert.equal(verdict.landed, null)
})

// ─────────────────────────────────────────────────────────────────────────────
// ④ 一条判据一个文件、纯数据变换（import 子句集合）
// ─────────────────────────────────────────────────────────────────────────────

test('④ 每条判据的 import 子句集合里没有任何 I/O 模块', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const gatesDir = path.join(root, 'src', 'gates')

  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  await walk(gatesDir)
  // registry.ts 是注册表本身（不是判据），它同样不许有 I/O。
  assert.ok(files.length >= 7, `expected to find the gate files under src/gates, found ${files.length}`)

  const FORBIDDEN = [
    'node:fs', 'node:fs/promises', 'fs', 'node:child_process', 'child_process',
    'node:net', 'node:http', 'node:https', 'node:os', 'node:process',
  ]
  const offenders = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    // ★ 只看【真的 import 语句】，注释里提到这些名字不算（判据的注释里确实在讨论它们）。
    const importLines = text.split('\n').filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
    for (const line of importLines) {
      const specifier = line.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? line.match(/^\s*import\s+['"]([^'"]+)['"]/)?.[1]
      if (specifier === undefined) continue
      const base = specifier.replace(/^node:/, '')
      if (FORBIDDEN.includes(specifier) || FORBIDDEN.includes(base)) {
        offenders.push(`${path.relative(root, file)} imports "${specifier}"`)
      }
    }
  }
  assert.deepEqual(offenders, [], `gates must be pure data transformations — the caller injects I/O:\n${offenders.join('\n')}`)
})

test('④ 每条判据只 import registry.ts（或另一个纯函数模块），不 import 别的判据', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const gatesDir = path.join(root, 'src', 'gates')
  const GATE_FILES = [
    'completion/backtest.ts', 'completion/mutation.ts', 'completion/r5.ts', 'completion/verify-rerun.ts',
    'dispatch/changed-paths.ts', 'dispatch/worktree.ts',
  ]

  const offenders = []
  for (const rel of GATE_FILES) {
    const text = await readFile(path.join(gatesDir, rel), 'utf8')
    for (const line of text.split('\n')) {
      if (!/^\s*import\b/.test(line) && !/^\s*\}?\s*from\s+['"]/.test(line)) continue
      const specifier = line.match(/from\s+['"]([^'"]+)['"]/)?.[1]
      if (specifier === undefined) continue
      // 允许：同目录/上一级的 registry.ts，以及仓库里的纯函数模块。
      const allowed = specifier === '../registry.ts'
        || specifier === '../../registry.ts'
        || specifier === '../../mutation.ts'
        || specifier === '../../quality-gates.ts'
      if (!allowed) offenders.push(`${rel} imports "${specifier}"`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a gate may only import the registry (and explicitly-injected pure-function modules); ` +
    `importing another gate would make them call each other:\n${offenders.join('\n')}`,
  )

  // ★ 一条判据一个文件：每个判据 id 只在它自己的文件里被声明。
  for (const rel of GATE_FILES) {
    const text = await readFile(path.join(gatesDir, rel), 'utf8')
    assert.match(text, /export const id = '/, `${rel} does not export an id`)
    assert.match(text, /export const point = '/, `${rel} does not export a point`)
    assert.match(text, /export (async )?function gate\(/, `${rel} does not export a gate function`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ mutation-guard 不在注册表里 —— 确认这是设计而非遗漏
// ─────────────────────────────────────────────────────────────────────────────

test('⑤ mutation-guard 确实不在注册表里，且它可被独立调用（不是"写了但没接线"）', async () => {
  const list = registry.list()
  const allIds = Object.values(list).flat().map((entry) => entry.id)
  assert.ok(
    !allIds.some((id) => id.includes('mutation-guard')),
    `mutation-guard must not be a registered gate (it is a guard, not a completion criterion): ${allIds.join(', ')}`,
  )

  // ★ "不在注册表里"有两种可能：设计如此，或者压根没接线。
  //   区分办法：它会有一个真实的调用方，且它自己是一个可独立调用的纯函数。
  const guard = await import('../lib/mutation-guard.js')
  assert.equal(typeof guard.checkMutationGuard, 'function', 'mutation-guard must export a callable checker')

  // 它能独立给出裁决，且缺省方向同样是"不得放行"。
  const noEvidence = guard.checkMutationGuard({})
  assert.notEqual(shapeOf(noEvidence), 'ok', 'mutation-guard passed with no observation injected — a guard that defaults to pass is not a guard')

  // ★ 契约形状（从 src/mutation-guard.ts 读出来的，不是猜的）：
  //   baseline.digests: 文件 → 变异前指纹；observation.digests: 文件 → 现在的指纹。
  const digestOf = (text) => `sha256:${text.length}:${text}`
  const cleanText = 'export const a = 1\n'
  const mutatedText = 'export const a = 2\n'

  // 伪造臂：源码指纹与基线不符（变异体没被还原）⇒ 必须被拦
  const residues = guard.checkMutationGuard({
    baseline: { digests: { 'src/a.ts': digestOf(cleanText) } },
    observation: { digests: { 'src/a.ts': digestOf(mutatedText) }, gitReadable: true, gitStatus: [' M src/a.ts'] },
    targets: ['src/a.ts'],
  })
  assert.notEqual(shapeOf(residues), 'ok', 'mutation-guard did not block when the live source digest differs from the baseline')

  // 未测量臂：有基线、但拿不到现状（observation 缺席）⇒ unmeasured，不是"干净"
  const unmeasuredArm = guard.checkMutationGuard({
    baseline: { digests: { 'src/a.ts': digestOf(cleanText) } },
    targets: ['src/a.ts'],
  })
  assertUnmeasured(unmeasuredArm, 'mutation-guard unmeasured arm (no observation)')

  // 对照臂：源码与基线一致 ⇒ 放行
  const clean = guard.checkMutationGuard({
    baseline: { digests: { 'src/a.ts': digestOf(cleanText) } },
    observation: { digests: { 'src/a.ts': digestOf(cleanText) }, gitReadable: true, gitStatus: [] },
    targets: ['src/a.ts'],
  })
  assert.equal(shapeOf(clean), 'ok', `mutation-guard blocked a clean source: ${JSON.stringify(clean)}`)

  // ★ 三态不同形：残留（关于代码的结论）与未测量（关于测量的结论）必须分得开
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(clean))
  assert.notEqual(shapeOf(unmeasuredArm), shapeOf(residues))
})

test('⑤ mutation-guard 不被 registry.evaluate 的任何一个位置求值', async () => {
  // ★ 与上一条互补：上一条查"名单里没有"，这一条查"运行时也调不到"。
  for (const point of INSERTION_POINTS) {
    const evaluation = await registry.evaluate(point, {})
    for (const entry of evaluation.ran) {
      assert.ok(
        !entry.id.includes('mutation-guard'),
        `mutation-guard ran at the "${point}" point; it must not participate in gate verdicts`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 注册表级的不变量（与上面几节共用同一次独立构造）
// ─────────────────────────────────────────────────────────────────────────────

test('注册表：id 唯一、point 合法、单例与新建实例给出同一份清单', () => {
  const list = registry.list()
  const allIds = Object.values(list).flat().map((entry) => entry.id)
  assert.equal(new Set(allIds).size, allIds.length, `duplicate gate ids registered: ${allIds.join(', ')}`)

  const rebuilt = buildRegistry().list()
  assert.deepEqual(rebuilt, list, 'buildRegistry() and the process singleton disagree about what is installed')

  // 每条判据都必须在它声明的位置上出现（point 与 list 的分组一致）
  for (const point of INSERTION_POINTS) {
    for (const entry of list[point] ?? []) {
      assert.ok(entry.description.trim().length > 0, `"${entry.id}" has no description (the console renders it)`)
    }
  }
})

test('注册表：unmeasured 优先于 blockers 合并（一条没测到 ⇒ 整体不可信）', async () => {
  const reg = buildRegistry()
  const { ok, blocked, unmeasured } = await import('../lib/gates/index.js')
  reg.register({
    id: 'probe.blocked', point: 'runtime', description: 'probe',
    gate: () => blocked('a real problem'),
  })
  reg.register({
    id: 'probe.unmeasured', point: 'runtime', description: 'probe',
    gate: () => unmeasured('could not measure'),
  })
  const evaluation = await reg.evaluate('runtime', {})
  assert.equal(evaluation.ok, false)
  assert.ok(typeof evaluation.unmeasured === 'string' && evaluation.unmeasured.includes('probe.unmeasured'),
    'an unmeasured gate must dominate the merge — a pass by the others is not trustworthy')
  assert.ok(evaluation.blockers.some((item) => item.includes('probe.blocked')),
    'blockers must still be collected (no short-circuit)')
})
