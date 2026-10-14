/**
 * ── completion 链的三件基础设施加固（2026-10-12）────────────────────────────────
 *
 * 本夹具覆盖三件，因为它们是**同一次事故**的三个环节 —— 拆开放会让每份夹具
 * 都要重述同一段背景：
 *
 *   ① **总预算**（`createCompletionBudget` / `runWithinBudget`）
 *      改动前：整条 completion（verify-rerun + backtest + r5 + mutation 判据串行）
 *      **没有任何总预算**，只有"单条命令 120 s"。实测长尾 53 分钟。
 *
 *   ② **预算停止是一个可辨认的记号**（`gates/budget-stop.ts`）
 *      这是 ① 的必要配套。加总预算时当场发现两个洞，后果**相反**：
 *        · 洞里 A（mutation）：预算抛出被逐条 catch 吞成 `outcome: 'error'`，
 *          而 `errored` **不进分母** ⇒ 分母塌缩 ⇒ 前几条恰好都被杀时
 *          `mutationScore` 会大于阈值 ⇒ **假通过**；
 *        · 洞里 B（registry）：`await reg.gate(context)` 没有 try/catch
 *          ⇒ 抛出**穿出整条 completion**，绕过三态裁决，成员收到异常而不是裁决。
 *      ⇒ 两处都改成"认出这一类 ⇒ `unmeasured`"，而**其余抛出照旧穿出去**。
 *
 *   ③ **变异日志与恢复**（`recordMutationWrite` / `recoverMutationJournal`）
 *      MEASURED（本仓已兑现）：就地变异被 SIGKILL 打断 ⇒ 生产文件永久留在变异态。
 *      主仓库 `src/worktree.ts:366` 因此多了一个 `=`，`pnpm build` 从此**必失败**
 *      （2 s，exit 2），而那条症状与"某处代码写错了"完全同形。
 *
 * ── 一份夹具里的三组臂为什么必须成对出现 ────────────────────────────────────────
 *
 * ①②③ 的每一组都有一条**反向臂**："这次不许做的事，别的地方照旧做"。
 * 一个"catch 一切"的加固会同时通过正向臂，而它把真实的开发期故障静默掉了 ——
 * 所以反向臂不是补充，是判别力的全部。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CompletionBudgetExceeded,
  COMPLETION_BUDGET_STOP_NAME,
  isCompletionBudgetStop,
} from '../lib/gates/budget-stop.js'
import { createGateRegistry, unmeasured } from '../lib/gates/registry.js'
import { asRegistration } from '../lib/gates/index.js'
import { gate } from '../lib/gates/completion/mutation.js'
import {
  COMPLETION_BUDGET_MS,
  createCompletionBudget,
  killShellTree,
  recordMutationWrite,
  recoverMutationJournal,
  runVerifyCommand,
  runWithinBudget,
  VERIFY_COMMAND_TIMEOUT_MS,
} from '../lib/tools/shared/entities.js'
import { kindRequirementsTable } from './kind-requirements-table.mjs'
import { parseKindRequirements } from '../lib/gates/completion/r5.js'

const TABLE = kindRequirementsTable(parseKindRequirements)

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

// ═════════════════════════════════════════════════════════════════════════════
// ① 总预算
// ═════════════════════════════════════════════════════════════════════════════

test('预算臂 1：预算耗尽后 `remainingMs() <= 0` 且 `exhausted()` 为真', async () => {
  const budget = createCompletionBudget(40)
  assert.equal(budget.totalMs, 40, '★ 显式传的总额必须被采用')
  assert.ok(budget.remainingMs() > 0, '★ 刚建好时必须有剩余')
  assert.equal(budget.exhausted(), false)

  await sleep(60)
  assert.ok(budget.remainingMs() <= 0, `★ 超时后剩余必须 ≤ 0：${budget.remainingMs()}`)
  assert.equal(budget.exhausted(), true)
  assert.equal(budget.calls(), 0, '★ 没发出过调用 ⇒ calls 必须是 0')
})

test('预算臂 2：非法总额回退到缺省 —— **没有"无限"这个档位**', () => {
  /**
   * ★ 0 / 负数 / 非数字 都回退到缺省：一个"0 表示无限"的档位会让
   *   "预算被关掉了"与"预算设成了 0 秒"同形，而后者是一条正常读数。
   */
  for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
    const budget = createCompletionBudget(bad)
    assert.equal(budget.totalMs, COMPLETION_BUDGET_MS, `★ totalMs=${bad} 必须回退到缺省`)
    assert.ok(budget.remainingMs() > 0)
  }
})

test('预算臂 3 ★★ 只收窄臂：传下去的超时是 `min(单命令上限, 剩余)`', async () => {
  /** 大预算 ⇒ 单条命令的上限一个字没动（120 s 这条既有纪律）。 */
  let wide = null
  const big = createCompletionBudget(10 * 60_000)
  const got = await runWithinBudget(big, 'wide', async (timeoutMs) => { wide = timeoutMs; return 'ok' })
  assert.equal(got, 'ok', '★ 包装必须把结果原样交回')
  assert.equal(wide, VERIFY_COMMAND_TIMEOUT_MS, `★ 大预算下必须恰好是单命令上限：${wide}`)
  assert.equal(big.calls(), 1, '★ 受预算约束的调用条数必须被记下来')

  /** 小预算 ⇒ 比单命令上限更窄（而不是更宽）。 */
  let narrow = null
  const small = createCompletionBudget(30_000)
  await runWithinBudget(small, 'narrow', async (timeoutMs) => { narrow = timeoutMs; return 'ok' })
  assert.ok(
    narrow > 0 && narrow < VERIFY_COMMAND_TIMEOUT_MS,
    `★ 剩余 30 s ⇒ 传下去的超时必须小于 120 s 且为正：${narrow}`,
  )
})

test('预算臂 4 ★★ 耗尽臂：抛一条**自述**的错误，而不是伪装成命令失败', async () => {
  const budget = createCompletionBudget(20)
  await sleep(40)

  let ran = false
  const error = await runWithinBudget(budget, 'stopped-call', async () => { ran = true; return 0 })
    .then(() => null, (thrown) => thrown)

  /**
   * ★ 必须是**抛**：返回一个像退出码的数字（125）会让一次预算停止被读成
   *   "这些命令都超时了" —— 把基础设施的读数伪装成关于代码的读数。
   * ★ 而且必须**没有真的跑**那次调用（否则"预算有界"只对一半）。
   */
  assert.ok(error instanceof Error, `★ 耗尽时必须抛，实际返回了 ${JSON.stringify(error)}`)
  assert.equal(ran, false, '★ 超预算的调用不许被执行')
  assert.match(error.message, /BUDGET stop/, '★ 必须自述这是预算停止')
  assert.match(error.message, /stopped-call/, '★ 必须说清是哪一次调用被挡下')
  assert.deepEqual(budget.exhaustedBy(), ['stopped-call'], '★ 被挡下的调用标签必须被留下')
})

// ═════════════════════════════════════════════════════════════════════════════
// ② 预算停止的记号（跨模块实例）
// ═════════════════════════════════════════════════════════════════════════════

test('记号臂 1 ★★★ 跨实例臂：按 `name` 认，按 `instanceof` 只作快路径', () => {
  assert.equal(isCompletionBudgetStop(new CompletionBudgetExceeded('x')), true, '★ 同实例快路径')

  /**
   * ★★★ 这条是跨实例路径：宿主的插件重载会**重新求值模块**（`src/hmr-trace.ts`
   *   记过这件事）⇒ 两个不同的类对象 ⇒ 父实例抛出的错误在子实例里 `instanceof`
   *   为 **false**。而这条判定的后果是"预算停止被读成普通错误"。
   */
  const foreign = Object.assign(new Error('x'), { name: COMPLETION_BUDGET_STOP_NAME })
  assert.equal(isCompletionBudgetStop(foreign), true, '★ 只带 name 的鸭子类型对象也必须被认出')
  assert.equal(foreign instanceof CompletionBudgetExceeded, false, '★ 前提：它确实不是本实例的类')
})

test('记号臂 2 ★★★ 反向臂：普通错误**绝不许**被认成预算停止', () => {
  /**
   * ★ 判别力所在。一个"catch 到什么算什么"的实现会通过所有正向臂，而它把
   *   判据里的真 bug（解引用 null、类型错）静默成"没能测量" —— 于是
   *   开发期故障不再吵。这一条就是那种实现的钉子。
   */
  assert.equal(isCompletionBudgetStop(new Error('boom')), false)
  assert.equal(isCompletionBudgetStop(new TypeError('boom')), false)
  assert.equal(isCompletionBudgetStop(Object.assign(new Error('x'), { name: 'Error' })), false)
  for (const notAnError of [null, undefined, 'budget', 0, {}, { name: 42 }]) {
    assert.equal(isCompletionBudgetStop(notAnError), false, `★ ${JSON.stringify(notAnError)} 不是预算停止`)
  }
})

test('记号臂 3 ★★★ registry 臂：预算停止 ⇒ unmeasured（不抛），普通抛出 ⇒ **照旧抛**', async () => {
  /** 隔离的注册表：不碰全局 `registry`，于是这条臂不影响同进程的别的夹具。 */
  function registryWith(gateFn) {
    const registry = createGateRegistry()
    registry.register(asRegistration({
      id: 'fixture.throwing-gate',
      point: 'completion',
      description: '夹具：一条会抛的判据',
      gate: gateFn,
    }))
    return registry
  }

  /** 正向：判据抛预算停止 ⇒ 位置级**不抛**，而是落成 `unmeasured` + `ran` 里如实记着。 */
  const budgeted = registryWith(async () => {
    throw new CompletionBudgetExceeded('the chain exhausted its budget before "verify: pnpm build" could run')
  })
  const evaluation = await budgeted.evaluate('completion', {})
  assert.equal(evaluation.ok, false, '★ 预算停止**不许**给通过')
  assert.match(String(evaluation.unmeasured), /BUDGET|exhausted its budget/, '★ 原因里必须带着那句话')
  assert.equal(evaluation.ran.length, 1)
  assert.equal(evaluation.ran[0].verdict, 'unmeasured', '★ 必须如实记成 unmeasured，而不是 ok/skipped')

  /**
   * ★★★ 反向：判据抛**普通**错误 ⇒ `evaluate` 必须**原样抛出去**。
   *   若这条不成立，说明实现是"catch 一切" —— 那会把判据里的真 bug 静默成
   *   "没能测量"，是本次加固最不能引入的后果。
   */
  const crashing = registryWith(async () => { throw new TypeError('fixture gate has a real bug') })
  await assert.rejects(
    () => crashing.evaluate('completion', {}),
    /fixture gate has a real bug/,
    '★ 普通抛出必须穿出去（不许被吞成 unmeasured）',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// ②b mutation 判据里的同一件事（洞 A：假通过）
// ═════════════════════════════════════════════════════════════════════════════

const SUT_FILE = 'hardening-sut.mjs'
const SUT = [
  '/** 加固夹具的实现。 */',
  'export function probe(a, b, c) {',
  '  if (a > 1 && b < 2 || c === 3) return a + 1',
  '  if (a >= 4 && b !== 5) return b - 4',
  '  return c',
  '}',
].join('\n')
const BASELINE_GREEN = { exitCode: 0, stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n', stderr: '' }

/**
 * ★ 基线必须同时交回**行覆盖**（2026-10-14）。
 *
 * MEASURED（t7 归因回退那次）：本文件两条洞 A 臂此前只交回 `BASELINE_GREEN`
 * —— 一份**没有行覆盖**的基线。判据在变异循环之前先解析覆盖，指不出覆盖就整批
 * `unmeasured` ⇒ 于是两条臂测的其实是"基线没交覆盖"，**根本没跑到它们要测的东西**：
 *   ① 预算停止与"测试失败"分不分得开；
 *   ② 执行器故障与预算停止是不是不同形。
 * 两条臂因此变红，而红的理由与洞 A 无关 —— 那正是"我造的输入不完整"。
 *
 * ★ 这里补上的是**输入**：套件真的跑过了 SUT 的每一行。测试与断言一字未动。
 */
const EXECUTED_ALL_LINES = { [SUT_FILE]: SUT.split('\n').map((_, index) => index + 1) }
const BASELINE_GREEN_WITH_COVERAGE = { ...BASELINE_GREEN, executedLines: EXECUTED_ALL_LINES }

function mutationContext(runTest) {
  const disk = new Map([[SUT_FILE, SUT]])
  return {
    loadKindRequirements: () => TABLE,
    task: { id: 't-hardening-fixture', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedFiles: [SUT_FILE],
    changedLines: SUT.split('\n').map((_, index) => index + 1),
    readFile: (path) => {
      const text = disk.get(path)
      if (text === undefined) throw new Error(`no such file in the fixture sandbox: ${path}`)
      return text
    },
    readSuite: () => `import './${SUT_FILE}'`,
    writeFile: (path, contents) => { disk.set(path, contents) },
    runTest,
    testCommand: 'node --test *',
    killerSuites: [{ id: `./${SUT_FILE}`, files: [`./${SUT_FILE}`] }],
    maxPerOperator: 100,
    maxMutants: 10_000,
  }
}

test('洞 A 臂 ★★★ 预算停止 ⇒ unmeasured，不许被读成"变异体出错"（那是假通过）', async () => {
  /**
   * MEASURED（本轮）：`scoreMutants` 里 `scored = killed | survived`，`error` **不进分母**。
   * ⇒ 若预算在半路跑光，剩下每条变异体立刻抛、全被记成 `error` ⇒ 分母塌缩成
   *   "还来得及跑的那几条" ⇒ 前几条若都被杀，`mutationScore` 会**大于阈值 ⇒ ok**。
   *   一次"那条链没跑完"于是被读成"这个成员的测试很强"。
   */
  let calls = 0
  const verdict = await gate(mutationContext(async () => {
    calls += 1
    if (calls === 1) return { ...BASELINE_GREEN_WITH_COVERAGE }
    throw new CompletionBudgetExceeded('the completion chain exhausted its 1200s wall-clock budget before "mutation suite" could run')
  }))

  assert.equal(verdict.ok, false, '★ 预算停止绝不许放行')
  assert.ok(
    typeof verdict.unmeasured === 'string',
    `★ 必须是 unmeasured（这份跑批没能给读数），实际：${JSON.stringify(verdict).slice(0, 300)}`,
  )
  assert.match(verdict.unmeasured, /BUDGET stop/, '★ 必须自述这是预算停止')
  assert.match(
    verdict.unmeasured,
    /不是测试失败/,
    '★ 必须与"测试失败"分得开 —— 两者的补救动作相反（调预算 vs 补测试）',
  )
})

test('洞 A 反向臂 ★★★ 执行器故障与预算停止必须**不同形**', async () => {
  /**
   * ★ 两条都可能落到 `unmeasured`（全都是 error 时 `scored === 0`，那也是一条
   *   unmeasured），所以判别力**不在 ok 字段上，而在措辞上**：
   *   普通抛出必须说"执行器抛了"，绝不许被贴上 BUDGET 的标签。
   */
  let calls = 0
  const verdict = await gate(mutationContext(async () => {
    calls += 1
    if (calls === 1) return { ...BASELINE_GREEN_WITH_COVERAGE }
    throw new Error('the executor exploded')
  }))

  const text = JSON.stringify(verdict)
  assert.equal(verdict.ok, false)
  /**
   * ★ 判别力在**措辞**上：普通抛出绝不许被贴上 BUDGET 标签。
   *
   * ★ 这条臂同时钉住 2026-10-12 修的那处：逐条运行的 `reason` **必须进裁决**。
   *   修之前裁决只说"9 条变异体的运行没有给出可解释的结果（id…）"，而
   *   "套件挂起" / "预算停止" / "汇总解析不出" / "exitCode 与 0 failing 矛盾"
   *   这四种**补救动作相反**的原因一个字都读不到。
   */
  assert.doesNotMatch(text, /BUDGET stop/, '★ 普通抛出绝不许被贴上 BUDGET 标签')
  assert.match(text, /running the killer suite raised: the executor exploded/, '★ 必须如实报出是谁抛的')
  assert.match(text, /没有一条可计分|没有给出可解释的结果/, '★ 必须用"没有可计分的变异体"这条口径解释自己')
})

// ═════════════════════════════════════════════════════════════════════════════
// ③ 变异日志与恢复
// ═════════════════════════════════════════════════════════════════════════════

const REL = 'src/probe.ts'
/** 刻意含：多字节字符、末尾换行、以及一个与变异只有一字之差的形态。 */
const ORIGINAL = 'export const x = 1\n// 中文注释，末尾有换行\n'
const MUTATED = 'export const x = 2\n// 中文注释，末尾有换行\n'

function journalWorkspace() {
  const workspace = tempDir('at-journal-')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, REL), ORIGINAL)
  return workspace
}

test('日志臂 1 ★★★ 恢复臂：残留被逐字节写回，条目被清掉', () => {
  const workspace = journalWorkspace()
  try {
    recordMutationWrite(workspace, REL, MUTATED)
    /** 模拟就地变异：判据写下变异体，然后被 SIGKILL（还原的 `finally` 跑不到）。 */
    writeFileSync(join(workspace, REL), MUTATED)

    const report = recoverMutationJournal(workspace)
    assert.deepEqual(report.restored, [REL], '★ 残留必须被认出来并还原')
    assert.equal(report.touched, true, '★ 真的动了盘')
    assert.equal(report.conflicts.length, 0)

    /** ★ 逐字节：多字节字符与末尾换行都必须一模一样（比较的是字符串本身）。 */
    assert.equal(readFileSync(join(workspace, REL), 'utf8'), ORIGINAL, '★ 必须逐字节还原')
    assert.equal(readFileSync(join(workspace, REL), 'utf8').length, ORIGINAL.length)

    /** 条目被清 ⇒ 再跑一次必须**什么都不做**（否则会被反复"恢复"）。 */
    const again = recoverMutationJournal(workspace)
    assert.deepEqual(again.restored, [])
    assert.equal(again.touched, false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('日志臂 2 ★ 干净臂：没被改过的文件只清条目，**不碰文件**', () => {
  const workspace = journalWorkspace()
  try {
    recordMutationWrite(workspace, REL, MUTATED)
    /** 不写变异体 ⇒ 盘上仍是原文（正常收尾就是这条路径）。 */
    const report = recoverMutationJournal(workspace)
    assert.deepEqual(report.clean, [REL], '★ 认成 clean')
    assert.deepEqual(report.restored, [])
    assert.equal(report.touched, false, '★ 没动过盘 ⇒ touched 必须是 false')
    assert.equal(readFileSync(join(workspace, REL), 'utf8'), ORIGINAL)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('日志臂 3 ★★★ 冲突臂：第三种内容 ⇒ 原样保留 + 条目不删（回滚会毁掉真活）', () => {
  const workspace = journalWorkspace()
  try {
    const THIRD = 'export const x = 3 // 崩溃之后又有人真改了它\n'
    recordMutationWrite(workspace, REL, MUTATED)
    writeFileSync(join(workspace, REL), MUTATED)
    /** ★ 崩溃之后有人真的编辑过它 —— 这是最关键的一种情形。 */
    writeFileSync(join(workspace, REL), THIRD)

    const report = recoverMutationJournal(workspace)
    assert.equal(report.restored.length, 0, '★ 冲突时绝不许"还原"')
    assert.ok(report.conflicts.length > 0, '★ 必须报成冲突，而不是静默')
    /** ★★★ 盘上必须**一个字节都没动**：回滚会把那个人真正的工作丢掉。 */
    assert.equal(readFileSync(join(workspace, REL), 'utf8'), THIRD, '★ 冲突文件必须原样保留')

    /** 条目必须**留着** —— 删了就再也查不出这里发生过什么。 */
    const again = recoverMutationJournal(workspace)
    assert.ok(again.conflicts.length > 0, '★ 冲突条目不许被清掉')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('日志臂 4 ★ 空臂：从没跑过变异 ⇒ 空报告、不动盘（这不是"未测量"）', () => {
  const workspace = tempDir('at-journal-empty-')
  try {
    const report = recoverMutationJournal(workspace)
    assert.deepEqual(report, { restored: [], clean: [], conflicts: [], failed: [], touched: false })
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('日志臂 5 ★ 新增文件臂：原文是"不存在" ⇒ 恢复时**删掉**它，而不是写成空串', () => {
  const workspace = tempDir('at-journal-newfile-')
  try {
    const rel = 'src/brand-new.ts'
    mkdirSync(join(workspace, 'src'), { recursive: true })
    recordMutationWrite(workspace, rel, MUTATED)
    writeFileSync(join(workspace, rel), MUTATED)
    const report = recoverMutationJournal(workspace)
    assert.deepEqual(report.restored, [rel])
    assert.equal(existsSync(join(workspace, rel)), false, '★ 原文不存在 ⇒ 恢复必须让它不存在（不是空文件）')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// ④ 进程组 kill（孤儿进程的来源）
// ═════════════════════════════════════════════════════════════════════════════

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('进程臂 1 ★★★ 整组杀臂：超时后【孙进程】也必须死（不是只死那个 sh）', async () => {
  /**
   * MEASURED（本仓 2026-10-12）：`spawn('/bin/sh', ['-c', cmd])` + 只 `kill('SIGKILL')`
   * 杀的是那个 `sh`，**不是进程组**。实测留下 4 个孤儿 node 进程（cwd = 插件仓库、
   * `ppid = 1`、存活 5.7–6.5 小时、CPU 0%），跨了两次宿主重启都没被清理。
   *
   * ★ 判别力：这条臂跑在"只杀 sh"的实现上会红 —— `sh` 死了，而后台那个
   *   `sleep` 活得好好的（它的 ppid 变成 1，没有任何东西会来收它）。
   */
  const workspace = tempDir('at-kill-')
  try {
    const pidFile = join(workspace, 'gpid')
    /** 后台起一个长命子进程并记下它的 pid，然后自己也长睡。 */
    const command = `sleep 30 & echo $! > ${pidFile}; sleep 30`
    const exitCode = await runVerifyCommand(workspace, command, { timeoutMs: 700 })
    assert.equal(exitCode, 125, '★ 超时必须收敛成既有的 125（不是 0、不是 1）')

    const grandchild = Number(readFileSync(pidFile, 'utf8').trim())
    assert.ok(Number.isSafeInteger(grandchild) && grandchild > 0, `★ 夹具没拿到孙进程 pid：${grandchild}`)
    assert.notEqual(grandchild, process.pid)

    /** 信号投递与 reap 有一瞬间的窗口 ⇒ 轮询，而不是 sleep 一个魔法数。 */
    let gone = false
    for (let attempt = 0; attempt < 40 && !gone; attempt += 1) {
      gone = !alive(grandchild)
      if (!gone) await sleep(50)
    }
    assert.equal(
      gone,
      true,
      `★ 孙进程 ${grandchild} 在超时后仍然活着 —— 这正是那批跨宿主重启的孤儿的来源`,
    )
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('进程臂 2 ★ 退化臂：`killShellTree` 对已经死掉的 pid 必须**不抛**', () => {
  /**
   * ★ 组装式锚点：`killShellTree` 的语义是"尽力杀掉整组"，
   *   而"它已经死了"与"杀失败"不该是同一个后果 —— 一次已经结束的调用
   *   不该因为收尾时报错而变成一条 error。
   */
  const dead = { pid: 999_999, kill: () => false }
  assert.doesNotThrow(() => killShellTree(dead))
  /** 连 pid 都没有（spawn 失败）也不能抛。 */
  assert.doesNotThrow(() => killShellTree({ pid: undefined, kill: () => false }))
  /** 组件式锚点：它仍然会调用那个 kill 作为退化路径。 */
  let called = false
  killShellTree({ pid: undefined, kill: () => { called = true; return true } })
  assert.equal(called, true, '★ 没有进程组可杀时必须退回单 pid 那条路')
})

// ═════════════════════════════════════════════════════════════════════════════
// ⑤ 组装式锚点：`unmeasured` 的既有形状没被这次改动挪动
// ═════════════════════════════════════════════════════════════════════════════

test('形状臂：`unmeasured()` 仍然产出 `{ok:false, unmeasured}`，且拒绝空原因', () => {
  assert.deepEqual(unmeasured('测不了'), { ok: false, unmeasured: '测不了' })
  assert.throws(() => unmeasured(''), '★ 空的"说不出"必须被拒 —— 它是无话可说，不是说不出')
})
