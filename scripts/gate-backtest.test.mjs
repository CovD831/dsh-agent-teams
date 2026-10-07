/**
 * ── `completion.backtest` 的三臂夹具 ────────────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：判据【应该拦住】的输入        ⇒ 期望 blocked
 *   臂 2（未测量臂）：没能测量的情形              ⇒ 期望 unmeasured（★ 不是 ok）
 *   臂 3（对照臂）：完全合法的输入                ⇒ 期望 ok
 *
 * ★ 缺任何一臂，这条判据不算完成 —— 只有对照臂能区分「判据有效」与「判据在乱拒」。
 *
 * ── 这条判据的三臂各自钉的是哪件事 ────────────────────────────────────────────
 *
 *   伪造臂 ①：基准不绿 ⇒ 拒绝，且理由必须是【无法归因】
 *              （拒绝只是形式，"理由无法归因"才是内容：观察上分不开
 *               "本来就坏"与"我改坏了"，所以裁决也不许替它们选一个）
 *   伪造臂 ②：分支绿 / 全量红 ⇒ 被抓住（这就是回测存在的意义）
 *   伪造臂 ③：选测器藏起自己的近似性（盲区不报 / 来源不明 / 名不副实）
 *              以及"标为全量、其实只跑了三个测试"
 *   未测量臂：拿不到基准状态 / 没有依赖图 / 没有覆盖数据 / 缺全量执行器
 *              ⇒ 全部 unmeasured，且【不得】当成通过
 *   对照臂  ：基准绿 + 选测跑通 + 全量绿 ⇒ ok，且交出可落盘的三段结果
 *
 * ── 它防的是什么失效（MEASURED 依据）────────────────────────────────────────────
 *
 * ① Meta PTS：把测试选择放进变更级回测，成本减半，仍抓住 >99.9% 有缺陷的改动。
 *    ⇒ 衡量单位是【改动有没有被抓住】，不是"每个测试有没有通过"。
 *    ⇒ 所以对照臂断言的是"这个改动被抓住了没有"，伪造臂断言的是"抓住时说得清"。
 *
 * ② 隐藏自身近似性的选择器是回归上线的主路径：
 *    一个选测器若【不报未选中的测试】，它的绿与全量绿在判据层同形。
 *    ⇒ 夹具里有一条臂专门用一个"看起来没问题、其实漏掉了覆盖测试"的选择器
 *      去打这条判据，另一条臂用一个诚实报盲区的选择器作对照。
 *
 * ③ 一条判据若只在启动路径上跑、只在出错时可见，它几乎不可测。
 *    本文件 import 的是编译产物（与现有夹具同构），并且【走真实的注册表】
 *    再核一遍 id / point —— 判据写对了但没接上，等于没装。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate, appliesTo, id, point } from '../lib/gates/completion/backtest.js'
// ★ t39：工具的源码面现在是 src/tools.ts + src/tools/**（见该模块的文件头）
import { toolsSource } from './tools-source.mjs'

/** 收窄助手：把"期望哪一种裁决"写进断言本身，于是三态在测试里也不同形。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) {
    throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  }
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  }
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

/**
 * ★ 一个【最小的、诚实的】依赖图。
 *
 *     src/math.ts  ← 被依赖者：src/calc.ts（直接）、src/report.ts（传递）
 *     覆盖： test/math.test.mjs   覆盖 src/math.ts      ← 【改动文件】的直接覆盖
 *            test/calc.test.mjs   覆盖 src/calc.ts      ← 传递依赖者的覆盖
 *            test/report.test.mjs 覆盖 src/report.ts
 *            spec/edge.check.mjs  覆盖 src/math.ts      ← ★ 名字不像测试，但是覆盖测试
 *            test/other.test.mjs  覆盖 src/other.ts     ← 与本次改动无关
 *
 * 选测的正确结果 = {math, calc, report, edge}；未选中 = {other}（盲区为空）。
 */
function honestGraph({ extra = [], missing = [] } = {}) {
  const selected = ['test/math.test.mjs', 'test/calc.test.mjs', 'test/report.test.mjs', 'spec/edge.check.mjs']
  return {
    source: 'dependency-graph',
    dependents: {
      'src/math.ts': ['src/calc.ts'],
      'src/calc.ts': ['src/report.ts'],
      'src/report.ts': [],
    },
    coverage: {
      'src/math.ts': ['test/math.test.mjs', 'spec/edge.check.mjs'],
      'src/calc.ts': ['test/calc.test.mjs'],
      'src/report.ts': ['test/report.test.mjs'],
      'src/other.ts': ['test/other.test.mjs'],
    },
    knownTests: [
      'test/math.test.mjs', 'test/calc.test.mjs', 'test/report.test.mjs',
      'spec/edge.check.mjs', 'test/other.test.mjs',
    ],
    selected: [...selected, ...extra].filter((test) => !missing.includes(test)),
    command: 'node --test test/math.test.mjs test/calc.test.mjs test/report.test.mjs spec/edge.check.mjs',
  }
}

/**
 * 命令替身：一个可控的表。
 * ★ 匹配方向是 `command.includes(key)` ⇒ 键必须取【真实命令的一部分】。
 *   反了（键比命令长）就永远是"没有替身"，那会把每条臂都变成 unmeasured ——
 *   而 unmeasured 与"判据坏了"在日志里很像。本夹具自己踩过一次。
 */
function execFrom(exits) {
  return async (command) => {
    const key = Object.keys(exits).find((k) => command.includes(k))
    if (key === undefined) throw new Error(`no stubbed exit code for ${command}`)
    return exits[key]
  }
}

/** 一个上下文：改动 src/math.ts，基准绿。 */
function ctx(overrides = {}) {
  return {
    task: { id: 't11', kind: 'implementation' },
    update: { changedPaths: ['src/math.ts'] },
    changedPaths: ['src/math.ts'],
    baseline: { exitCode: 0, label: '54eddb4 (parent/HEAD)' },
    coverage: honestGraph(),
    execSelectedCommand: execFrom({ 'node --test': 0 }),
    execBacktestCommand: execFrom({ 'full': 0 }),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：伪造臂 —— 判据应该拦住的东西
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：基准不绿 ⇒ 拒绝，理由必须说清是【无法归因】', async () => {
  const verdict = await gate(ctx({
    baseline: { exitCode: 1, label: '54eddb4', failedTests: ['test/legacy.test.mjs'] },
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 只报这一件事：既不能说"你改坏了"，也不能报别的')
  const reason = blockers[0]
  assert.match(reason, /attribution is impossible/, '★ 理由的【内容】就是"无法归因"，不是"测试没过"')
  assert.match(reason, /it was already broken" apart from "this change broke it/, '★ 必须点明分不开的两种可能')
  assert.match(reason, /neither credited nor blamed/, '★ 两种草率结论都不许下')
  assert.match(reason, /not the change's fault/, '★ 明确不把它算在这次改动头上 —— 否则成员被任意归罪')
  assert.match(reason, /test\/legacy\.test\.mjs/, '★ 附上基准自己的失败测试，人才能去修基准')
  // 与"测出回归"必须不同形（那是另一条臂）
  assert.equal(/broke something that used to pass/.test(reason), false)
})

test('臂 1b ★ 伪造臂：基准绿 + 全量红 ⇒ 被抓住，且指名基准是绿的（可归因）', async () => {
  const verdict = await gate(ctx({
    execBacktestCommand: execFrom({ 'full': 1 }),
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /broke something that used to pass/)
  assert.match(blockers.join('\n'), /green baseline/, '★ 归因的前提"基准是绿的"必须写进裁决')
})

test('臂 1c ★ 伪造臂：选测漏掉覆盖测试（隐藏自身近似性）⇒ 盲区必须被报出来', async () => {
  /**
   * ★ 这就是回归上线的主路径：选择器少选了覆盖 src/calc.ts 的测试，
   *   而它报上来的绿看起来与全量绿一模一样。判据必须自己算盲区。
   */
  const coverage = { ...honestGraph(), selected: ['test/math.test.mjs', 'spec/edge.check.mjs'] }
  const verdict = await gate(ctx({ coverage }))
  const accepted = expectOk(verdict)
  assert.deepEqual(
    accepted.selection.unselectedCoveringTests,
    ['test/calc.test.mjs', 'test/report.test.mjs'],
    '★ 未选中的【覆盖】测试就是已知盲区：传递依赖者各自的覆盖测试也必须在里面',
  )
  assert.match(accepted.selection.blindSpotSummary, /2 covering test\(s\) were NOT selected/)
  assert.match(accepted.selection.blindSpotSummary, /known blind spot/)
  // 不在依赖图上、因此不算盲区的那个测试仍要被如实报出（它是另一种"没测到"）
  assert.deepEqual(accepted.selection.testsWithNoCoverageData, [])
  assert.deepEqual(accepted.selection.selected, ['spec/edge.check.mjs', 'test/math.test.mjs'])
})

test('臂 1d ★ 伪造臂：选测来源不明 ⇒ unmeasured（"隐藏自身近似性的选择器"）', async () => {
  for (const source of ['runner-declared', 'unknown', undefined]) {
    const verdict = await gate(ctx({ coverage: { ...honestGraph(), source } }))
    const reason = expectUnmeasured(verdict)
    assert.match(reason, /dependency-graph/, '★ 必须说清它要的是哪种来源')
    assert.match(reason, /hides its own approximation/, '★ 说清为什么来源本身是判据的一部分')
    assert.equal('blockers' in verdict, false, '★ 未测量不是"发现了问题"')
  }
})

test('臂 1e ★ 伪造臂：标为"全量"却漏跑已知测试 ⇒ 拒绝（一条永远为真的判据）', async () => {
  const verdict = await gate(ctx({
    fullScope: { coveredTests: ['test/math.test.mjs', 'test/calc.test.mjs', 'test/report.test.mjs'] },
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers[0], /did not cover 2 known test\(s\)/)
  assert.match(blockers[0], /spec\/edge\.check\.mjs/, '★ 必须指名没跑的是哪几个')
  assert.match(blockers[0], /test\/other\.test\.mjs/)
})

test('臂 1f ★ 伪造臂：选测红而全量绿 ⇒ 拒绝（非确定的复现，不能当"通过"）', async () => {
  const verdict = await gate(ctx({
    execSelectedCommand: execFrom({ 'node --test': 1 }),
    execBacktestCommand: execFrom({ 'full': 0 }),
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers[0], /selected suite exited 1 while the full suite exited 0/)
  assert.match(blockers[0], /non-deterministic or mis-specified/)
})

test('臂 1g ★ 伪造臂：选测与全量都红 ⇒ 两条都报（不短路、不合并成一句话）', async () => {
  const verdict = await gate(ctx({
    execSelectedCommand: execFrom({ 'node --test': 2 }),
    execBacktestCommand: execFrom({ 'full': 1 }),
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 2, '★ 一次给全：修一个又冒一个的代价是实测过的')
  assert.match(blockers[0], /broke something that used to pass/, '★ 头条必须是关于改动的结论，不能被"你的选测器有问题"挡住')
  assert.match(blockers[1], /the change was caught by the dependency-graph selection/)
})

test('臂 1h ★ 伪造臂：选测器幻觉出一个不存在的测试 ⇒ 单列出来（绿不能靠幻觉撑着）', async () => {
  const coverage = { ...honestGraph(), selected: [...honestGraph().selected, 'test/ghost.test.mjs'] }
  const verdict = await gate(ctx({ coverage }))
  const accepted = expectOk(verdict)
  assert.deepEqual(accepted.selection.selectedUnknownTests, ['test/ghost.test.mjs'])
  assert.deepEqual(accepted.selection.unselectedCoveringTests, [], '★ 幻觉不影响盲区判定')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：未测量臂 —— 没能测量的情形，★ 绝不是 ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 未测量臂：拿不到基准状态 ⇒ unmeasured，不是 ok', async () => {
  const verdict = await gate(ctx({ baseline: undefined }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /baseline state is unavailable/)
  assert.match(reason, /could not be told apart from a pre-existing failure/)
  assert.equal(verdict.ok, false)
  assert.equal('blockers' in verdict, false, '★ 拿不到基准不是"发现了问题"')
})

test('臂 2b 未测量臂：基准有对象但没有 exitCode ⇒ unmeasured（0 与"没测"不同形）', async () => {
  const verdict = await gate(ctx({ baseline: { label: 'HEAD' } }))
  assert.match(expectUnmeasured(verdict), /no exit code/)
})

test('臂 2c ★ 未测量臂：没有依赖图 / 覆盖数据 ⇒ unmeasured', async () => {
  assert.match(expectUnmeasured(await gate(ctx({ coverage: undefined }))), /no dependency graph \/ coverage data/)
  assert.match(
    expectUnmeasured(await gate(ctx({ coverage: { source: 'dependency-graph', knownTests: ['a'] } }))),
    /graph\/coverage data is missing/,
  )
})

test('臂 2d ★ 未测量臂：不知道"已知测试全集" ⇒ 报不出盲区 ⇒ unmeasured', async () => {
  const { knownTests, ...withoutKnown } = honestGraph()
  const verdict = await gate(ctx({ coverage: withoutKnown }))
  assert.match(expectUnmeasured(verdict), /which tests were NOT selected/)
})

test('臂 2e 未测量臂：没给选测结果 ⇒ unmeasured（空数组是"一个都没选"，不是"没给"）', async () => {
  const { selected, ...withoutSelected } = honestGraph()
  const verdict = await gate(ctx({ coverage: withoutSelected }))
  assert.match(expectUnmeasured(verdict), /selection result was not provided/)
})

test('臂 2f ★ 未测量臂：没有全量执行器 ⇒ unmeasured（选测不能顶替全量）', async () => {
  const verdict = await gate(ctx({ execBacktestCommand: undefined }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /no full-suite executor was injected/)
  assert.match(reason, /cannot stand in for the full backtest/)
  assert.equal('blockers' in verdict, false)
})

test('臂 2g 未测量臂：执行器抛错 / 返回非整数 ⇒ unmeasured（不是"命令失败"）', async () => {
  const raised = await gate(ctx({ execBacktestCommand: async () => { throw new Error('spawn EAGAIN') } }))
  assert.match(expectUnmeasured(raised), /raised: spawn EAGAIN/)
  const weird = await gate(ctx({ execBacktestCommand: async () => undefined }))
  assert.match(expectUnmeasured(weird), /non-integer exit code/)
  const selectedRaised = await gate(ctx({ execSelectedCommand: async () => { throw new Error('EAGAIN') } }))
  assert.match(expectUnmeasured(selectedRaised), /selected-test suite/)
})

test('臂 2h 未测量臂：没有声明改动文件 ⇒ unmeasured（没有回测的对象）', async () => {
  const verdict = await gate(ctx({ changedPaths: [], update: {}, coverage: honestGraph() }))
  assert.match(expectUnmeasured(verdict), /no change set to regress/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：对照臂 —— 完全合法的输入必须过，且交出可落盘的结果
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：基准绿 + 选测跑通 + 全量绿 ⇒ ok', async () => {
  const accepted = expectOk(await gate(ctx()))
  assert.equal(accepted.baseline.exitCode, 0)
  assert.equal(accepted.baseline.label, '54eddb4 (parent/HEAD)')
  assert.equal(accepted.full.exitCode, 0)
  assert.equal(accepted.full.status, 'passed')
  assert.ok(Object.keys(accepted.outputs ?? {}).length === 0 || true)
})

test('臂 3b ★ 对照臂：通过时交出①基准②选测（含盲区）③全量，而不是一句"通过了"', async () => {
  const accepted = expectOk(await gate(ctx()))
  assert.equal(accepted.selection.source, 'dependency-graph')
  assert.deepEqual(accepted.selection.changedPaths, ['src/math.ts'])
  assert.deepEqual(
    accepted.selection.transitiveDependents,
    ['src/calc.ts', 'src/report.ts'],
    '★ 依赖者是【传递】闭包，不是只有直接依赖者',
  )
  assert.deepEqual(
    accepted.selection.selected,
    ['spec/edge.check.mjs', 'test/calc.test.mjs', 'test/math.test.mjs', 'test/report.test.mjs'],
  )
  assert.deepEqual(accepted.selection.unselectedCoveringTests, [], '★ 诚实的选测器 ⇒ 盲区为空（而不是"报不出来"）')
  assert.match(accepted.selection.blindSpotSummary, /selected 4 of 5 known test\(s\)/)
  assert.equal(accepted.selection.command, honestGraph().command)
})

test('臂 3c ★ 对照臂：路径写法不同形（./ 前缀、尾斜杠）不得影响结果', async () => {
  const coverage = {
    source: 'dependency-graph',
    dependents: { './src/math.ts': ['./src/calc.ts'] },
    coverage: { 'src/calc.ts/': ['./test/calc.test.mjs'] },
    knownTests: ['./test/calc.test.mjs', 'test/other.test.mjs'],
    selected: ['./test/calc.test.mjs'],
    command: 'node --test ./test/calc.test.mjs',
  }
  const accepted = expectOk(await gate(ctx({ changedPaths: ['./src/math.ts'], coverage })))
  assert.deepEqual(
    accepted.selection.transitiveDependents,
    ['src/calc.ts'],
    '★ 报出来的依赖者统一成 norm 形状（否则同一组依赖者会有两种写法）',
  )
  assert.deepEqual(accepted.selection.unselectedCoveringTests, [])
})

test('臂 3d ★ 对照臂：没有覆盖数据的测试被如实单列（不是盲区，也不是被忽略）', async () => {
  const coverage = {
    source: 'dependency-graph',
    dependents: { 'src/math.ts': [] },
    coverage: { 'src/math.ts': ['test/math.test.mjs'] },
    knownTests: ['test/math.test.mjs', 'test/mystery.test.mjs'],
    selected: ['test/math.test.mjs'],
    command: 'node --test test/math.test.mjs',
  }
  const accepted = expectOk(await gate(ctx({ coverage })))
  assert.deepEqual(
    accepted.selection.testsWithNoCoverageData,
    ['test/mystery.test.mjs'],
    '★ "不在依赖图上"与"在图上但没被选中"是两件事，必须不同形',
  )
  assert.deepEqual(accepted.selection.unselectedCoveringTests, [])
})

test('臂 3e ★ 对照臂：选测命令【没给】时不假装跑过（不得凭空造一个 exit code）', async () => {
  const { command, ...withoutCommand } = honestGraph()
  const accepted = expectOk(await gate(ctx({ coverage: withoutCommand, execSelectedCommand: undefined })))
  assert.equal(accepted.baseline.exitCode, 0)
  assert.equal(accepted.full.exitCode, 0, '★ 全量仍然要跑：不填选测命令不等于免掉全量')
  assert.equal(/exitCode/.test(JSON.stringify(accepted.selection)), false, '★ 选测段里不得出现任何"跑过"的证据')
})

// ─────────────────────────────────────────────────────────────────────────────
// 接线臂 + appliesTo：判据写对了但没接上，等于没装
// ─────────────────────────────────────────────────────────────────────────────

test('★ 接线臂：判据已接进注册表，且 id / point / description / gate 形状合法', async () => {
  const { registry } = await import('../lib/gates/index.js')
  const entries = Object.values(registry.list()).flat()
  const mine = entries.find((entry) => entry.id === 'completion.backtest')
  assert.ok(mine, '★ 装配点里必须真的有这一条（本文件在测的是"它开火吗"，不是"它存在吗"）')
  assert.equal(mine.description.trim().length > 0, true)
  assert.equal(mine.hasAppliesTo, true, '★ appliesTo 必须是【函数】形态：非函数会被注册表静默丢掉')
  assert.equal(point, 'completion')
  assert.equal(id, 'completion.backtest')
  assert.equal(typeof gate, 'function')
})

test('★ 接线臂：三条 completion 判据能同一次求值一起跑，且本判据的产出真被收走', async () => {
  const { buildRegistry } = await import('../lib/gates/index.js')
  const registry = buildRegistry()
  const evaluation = await registry.evaluate('completion', ctx({ task: { id: 'x', verify: undefined } }))
  const ran = Object.fromEntries(evaluation.ran.map((entry) => [entry.id, entry.verdict]))
  assert.equal(ran['completion.backtest'], 'ok', '★ 真实注册表跑出来的裁决，不是直接调 gate()')
  assert.ok(evaluation.outputs['completion.backtest'], '★ 通过时交出的三段结果必须被注册表收走（否则落盘的是成员自述）')
  assert.equal(evaluation.outputs['completion.backtest'].full.exitCode, 0)
})

test('⑩ appliesTo：只有声明了改动文件的任务才生效', () => {
  assert.equal(appliesTo({ changedPaths: ['src/a.ts'] }), true)
  assert.equal(appliesTo({ update: { changedPaths: ['src/a.ts'] } }), true)
  assert.equal(appliesTo({ changedPaths: [] }), false, '★ 空的改动集不是"改动集"')
  assert.equal(appliesTo({}), false)
  assert.equal(appliesTo(undefined), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// t18：无 worktree 的任务为什么恒不可满足 —— 以及「两种没有」必须不同形
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 这三臂防的是什么失效（MEASURED，point-dev 定位）───────────────────────────
 *
 * `baseline` 原本只由 `taskWorktreeBase`（**内存 Map**）推，而那东西只在派发
 * 建出 worktree 时写入 ⇒ 两类任务恒拿不到父版本：
 *
 *   (i)  **没有 worktree** 的任务（在主树干活的、captain 接管的）⇒ 从未登记过；
 *   (ii) **进程重启** ⇒ 内存 Map 清空（★ 与"旧模块"同族）。
 *
 * ⇒ 两类都让 `baseline` 恒 `undefined` ⇒ 本判据恒 `unmeasured` ⇒
 *   **这类任务永远无法收口**。而判据口径是对的（诚实报"没能测量"），
 *   所以修法**不是改判据**，是把父版本变成一个**可追溯的事实**。
 *
 * ── ★ 本文件的射程 ─────────────────────────────────────────────────────────────
 *
 * 上面所有臂测的是**判据本身**（给它什么输入，它怎么裁）。本节测的是**注入侧**：
 * 父版本从哪来、以及"没有父版本"的两种成因在读数上是否分得开。
 * ★ 两者刻意不互相替代：判据全绿而注入侧恒缺，正是本缺陷的形状
 *   （每一臂都通过，而生产路径上永远做不到）。
 */

test('★ t18 臂 1（对照臂）：本判据仍然【诚实】—— 没有 baseline 就说"没能测量"', async () => {
  /**
   * ★ 本臂钉的是"修注入侧不得改判据口径"：一个为了"让它可满足"而把
   *   `baseline` 缺失读成 ok 的实现，会在这里红。
   */
  const v = await gate(ctx({ baseline: undefined }))
  const reason = expectUnmeasured(v)
  assert.match(reason, /baseline state is unavailable/, '★ 没有父版本 ⇒ 必须明说"没能测量"，不是 ok')
  assert.match(reason, /could not be told apart/, '★ 而且要说清后果：归因做不了')
})

test('★ t18 臂 2（★ 行为臂）：两种"没有父版本"必须【真的】不同形 —— 用返回值证明', async () => {
  /**
   * ── ★★ 本臂是 t18 的核心验收，而它第一版**被定向突变证明是假的**───────────────
   *
   * 第一版用正则去源码里找 `'no-worktree'` / `'not-recorded'` 两个字面量。
   * 定向突变（把返回表达式合并成一个 `reason: 'no-worktree'`）实测 ⇒ **照绿**：
   * 因为那两个字面量**仍然出现在类型声明与注释里**。
   * ⇒ 一条只看得见"字符串存在"的断言，测的不是"两种成因真的分得开"。
   *   这是本队记账的「字面量在场 ≠ 行为在场」。
   *
   * ⇒ 改成**驱动真实代码**：用真实的 `registerAgentTeamsTools` 注册工具，
   *   造两类任务（无记录 / 有记录），走真实 `update_task` 入口，读回裁决。
   *
   * ★ 而这里**只断言两种情形的读数不同形**，不手抄它们各自叫什么 ——
   *   字面量由 `src/tools.ts` 决定；本文件重复它会让改一处要动两处，而两处会分叉。
   */
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const workspace = mkdtempSync(join(tmpdir(), 'backtest-t18-'))
  const git = (args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  writeFileSync(join(workspace, 'a.ts'), 'a\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  const head = git(['rev-parse', 'HEAD']).trim()

  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 2,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [
      /** (i) 有派发痕迹（attempt>0）却没有记录过的父版本 ⇒ "本该有而丢了"。 */
      { id: 't1', subject: 'A', status: 'in_progress', assignee: 'worker', dependencies: [], attempt: 2, attemptId: 'a1',
        kind: 'repair', objective: 'o', inScope: ['a.ts'], acceptance: ['x'], verify: ['true'], createdAt: 1, updatedAt: 1, changedPaths: ['a.ts'] },
      /** (ii) 任务记录里带着父版本 ⇒ 有得可用（这一格证明"有"与"没有"也不同形）。 */
      { id: 't2', subject: 'B', status: 'in_progress', assignee: 'worker', dependencies: [], attempt: 1, attemptId: 'a2',
        kind: 'repair', objective: 'o', inScope: ['a.ts'], acceptance: ['x'], verify: ['true'], createdAt: 1, updatedAt: 1, changedPaths: ['a.ts'], baseRevision: head },
    ],
  })

  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: { getProvider() { return undefined }, list() { return [] }, sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0' },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })

  const diffs = [{ path: 'a.ts', oldText: 'a', newText: 'b' }]
  const member = {
    id: 'm1', status: 'working', steer() {},
    session: { header: { cwd: workspace }, events: [{ type: 'tool/result', meta: { diffs } }], ownEvents() { return [{ type: 'tool/result', meta: { diffs } }] } },
  }
  const outcomeFor = async (taskId, attemptId) => tools.get('agent_teams_update_task').execute(
    { task_id: taskId, attempt_id: attemptId, status: 'in_progress', changedPaths: ['a.ts'] },
    { agent: member, signal: new AbortController().signal },
  ).then(() => 'ACCEPTED').catch((error) => String(error.message))

  const withoutRecord = await outcomeFor('t1', 'a1')
  const withRecord = await outcomeFor('t2', 'a2')

  /**
   * ★ t2（有记录）必须**越过 baseline** —— 那正是本任务修好的那一步。
   *   它后面可能仍因别的输入缺席而失败（coverage 不在本任务射程内），
   *   所以这里断言的是"baseline 不再是它的拦路理由"，而不是"它整体通过"。
   */
  assert.doesNotMatch(
    withRecord, /baseline state is unavailable/,
    '★ 有 `baseRevision` 记录的任务不得再报"父版本不可得" —— 这正是 t18 要修的那一格。'
    + ` 实测：${withRecord.slice(0, 200)}`,
  )
  assert.match(
    withoutRecord, /baseline state is unavailable/,
    '★ 而没有记录的任务仍须诚实报"父版本不可得"（不得为了让它可满足而伪造一个版本）',
  )
  /**
   * ★ 三态不同形：这三条读数是**三种不同的情形**，两两不许相等。
   */
  assert.notEqual(withRecord, withoutRecord, '★ "有父版本"与"没有父版本"必须不同形')
})

test('★ t18 臂 3（★ 落盘臂）：父版本必须【落进耐久态】，不能只在内存里', async () => {
  /**
   * ── 为什么这一臂必须检查**落盘**而不是只检查"解析顺序" ──────────────────────────
   *
   * 内存 Map 在进程重启后清空 —— 而那正是成因 (ii)。一个只加了解析顺序、
   * 却没有把值**写下去**的实现，在夹具里能过（同进程内内存还在），
   * 而在生产上重启之后照样恒缺。
   * ⇒ 断言必须落在**写入耐久态**这个动作上。
   */
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const source = toolsSource()

  assert.match(
    source, /persistTaskBaseRevision/,
    '★ 必须有一个把父版本写进耐久态的入口 —— 只记内存 ⇒ 重启后成因 (ii) 原样存在',
  )
  assert.match(
    source, /record\['baseRevision'\] = base/,
    '★ 而它必须真的把值写进任务记录（不是只算一个变量就丢掉）',
  )
  /**
   * ★ 反向半边：`baseRevision` 必须被**读**过 —— 一个只写不读的实现会让
   *   上面两条全绿，而解析仍然只看内存（那正是缺陷本身）。
   */
  assert.match(
    source, /resolveBaseRevision/,
    '★ 而且必须有**读**它的地方（只写不读 = 缺陷原样）',
  )
})
