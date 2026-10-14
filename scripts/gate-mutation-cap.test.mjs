/**
 * ── 变异配额的【有界性】与它的【读数】（`completion.mutation` 的两条闸门）──────────
 *
 * ── 它防的是什么失效（MEASURED，本仓 2026-10-12 的 t34 事故）────────────────────
 *
 * `completion.mutation` 是**唯一**让 `agent_teams_update_task` 永不返回的那条路径：
 * 实测 914 次调用里 completed 分支 p90 = 127.7 s、max = 3215.6 s（53 分钟）。
 *
 * 时长 = O(改动行数 × 算子数 × 套件耗时)，而改动前**只有最后一项有界**：
 *
 *     13 个算子 × `maxPerOperator` 25 × 每个改动文件 = 上限 325 条/文件，
 *     而每条都要重跑一遍杀手套件（本仓实测 24.6 s）⇒ 2.2 小时/次 attempt。
 *
 * 而更要紧的是那两条闸门的**接线状态**：
 *
 *   · `maxMutants` 只出现在类型声明里（`MutationContext`），`gate()` 里**零使用点**
 *     ⇒ "参数在、效果不在"，而它与"没有这个参数"在**每一次运行的读数上完全同形**；
 *   · `maxPerOperator` 收在 `generateMutants` 里，值 25。
 *
 * ── 本夹具为什么【不起子进程】──────────────────────────────────────────────────
 *
 * 配额与"套件强不强"正交：它只决定**跑了几条**、**丢了哪几条**。⇒ 执行器用一个
 * 恒绿的替身就够，而这样做的收益是**确定性**：没有真实 runner、没有子进程环境、
 * 没有随机耗时。判据看到的接口（readFile / writeFile / runTest / readSuite）与
 * 生产一致，只有"跑得动不动"被固定住。
 *
 * ★ 需要真实子进程的臂在别的夹具里：跑得快慢与"哪些算子的变异体会被真实套件杀"
 *   由 `scripts/gate-mutation.test.mjs`（三臂 + 两个真实套件）负责。
 *
 * ── ★★ 一条更值钱的读数：带抽样的杀伤率，其含义随样本量漂移（本轮实测）────────────
 *
 *     配额缺省 25/200 ⇒ considered 26、killed 24 ⇒ score 0.923
 *     配额缺省  4/40 ⇒ considered 18、killed 16 ⇒ score 0.889   ← 存活体【同两条】
 *
 * 同一份实现、同一批存活体，只因分母从 26 缩到 18，判据的结论就翻了面。
 * ⇒ 那正是"门禁不可复现"，而门禁的全部价值就在可复现。
 * ★ 本文件不试图修它（那需要"分数 + 样本量"一起读的判据，是另一个决定），
 *   而是把它**钉成一条读数**（臂 6），让下一次有人调配额时先看到这个后果。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gate, appliesTo, id, point } from '../lib/gates/completion/mutation.js'
import {
  capMutants,
  DEFAULT_MAX_MUTANTS,
  DEFAULT_MAX_PER_OPERATOR,
} from '../lib/mutation.js'
import { kindRequirementsTable } from './kind-requirements-table.mjs'
import { parseKindRequirements } from '../lib/gates/completion/r5.js'

const TABLE = kindRequirementsTable(parseKindRequirements)

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：一份"改动行很多、算子很密"的实现 + 一个恒绿的执行器替身
// ─────────────────────────────────────────────────────────────────────────────

const SUT_FILE = 'mutation-cap-sut.mjs'

function sutSource(branches = 15) {
  const lines = ['/** 配额夹具的实现（只存在于内存里）。 */', 'export function probe(a, b, c, d) {']
  for (let index = 0; index < branches; index += 1) {
    lines.push(`  if (a > ${index} && b < ${index} || c === ${index}) { d = a + ${index} }`)
    lines.push(`  if (d >= ${index} && a !== ${index}) { b = d - ${index} }`)
  }
  lines.push('  return d')
  lines.push('}')
  return lines.join('\n')
}

const SUT = sutSource()
const SUT_LINES = SUT.split('\n')

/**
 * 替身执行器的**两次回答** —— 判据自己会先跑一次基线，再逐条跑变异体。
 *
 *   ① 基线（第一次调用，原文，没有变异）：必须**绿**。判据有一条硬闸门
 *      "套件在变异前就不绿 ⇒ unmeasured"（`gates/completion/mutation.ts` 约 365 行），
 *      理由是一个本来就红的套件对任何变异体都"红"，那不能归功于变异体。
 *   ② 变异体（其后每次）：必须**红**。`classifyRun` 里"存活"要求
 *      `fail === 0 且 exitCode === 0`，所以恒绿的替身会让每条变异体都存活
 *      ⇒ 分数 0 ⇒ 判据给 `blocked` ⇒ 那些 `expectOk` 的臂就变成在测
 *      "装饰性判据"，而不是在测配额。
 *
 * ★ 顺序是契约的一部分：基线是**第一次**调用（它在变异循环之前，见上面那个文件的
 *   350 行附近）。替身按调用序号回答，而不是按命令文本 —— 命令两处同形。
 *
 * ★ 红的那一行必须点名一个 `*.test.mjs`：`failingFiles` 从**文本**里抽文件名，
 *   抽不到就等于"变红了但不知道是谁红的" ⇒ `newlyRed` 为空 ⇒ 不是 kill。
 */
const BASELINE_GREEN = {
  exitCode: 0,
  stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n',
  stderr: '',
}
const MUTANT_RED = {
  exitCode: 1,
  stdout: '✖ mutation-cap-sut.test.mjs (1 test failed)\nℹ tests 1\nℹ pass 0\nℹ fail 1\n',
  stderr: '',
}

/**
 * 首跑绿、其后按 `killCount` 红的替身。★ 每个 context 一份新的计数器。
 *
 * ★ 基线默认交回「每一行都执行了」。缺这份覆盖时整批是 unmeasured，
 *   而本文件前面的臂测的是配额，不是覆盖。`executedLines === null` 表示
 *   调用方明确不交覆盖（未测量臂用）。
 * ★ 这里不交 `testsByLine`：配额臂必须仍跑整份套件，不许被收窄成某一条测试。
 */
function makeRunTest(killCount = Number.POSITIVE_INFINITY, executedLines) {
  let calls = 0
  const coverage = executedLines === undefined
    ? { [SUT_FILE]: SUT_LINES.map((_, index) => index + 1) }
    : executedLines
  return async () => {
    calls += 1
    if (calls === 1) {
      const baseline = { ...BASELINE_GREEN }
      if (coverage !== null) baseline.executedLines = coverage
      return baseline
    }
    return calls - 1 <= killCount ? { ...MUTANT_RED } : { ...BASELINE_GREEN }
  }
}

function context(overrides = {}, killCount = Number.POSITIVE_INFINITY) {
  /** 内存沙箱：writeFile 与 readFile 必须一致，否则"还原"这条会被误判。 */
  const disk = new Map([[SUT_FILE, SUT]])
  return {
    loadKindRequirements: () => TABLE,
    task: { id: 't-cap-fixture', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedFiles: [SUT_FILE],
    changedLines: SUT_LINES.map((_, index) => index + 1),
    /**
     * ★ 读文件与读套件【分开注入】：`readFile` 收 workspace 相对路径，
     *   `readSuite` 收命令模板里的路径。混用会把一次读取失败伪装成
     *   "套件够不到" —— 见 `probeReach` 的注释。
     */
    readFile: (path) => {
      const text = disk.get(path)
      if (text === undefined) throw new Error(`no such file in the fixture sandbox: ${path}`)
      return text
    },
    readSuite: () => `import './${SUT_FILE}'`,
    writeFile: (path, contents) => { disk.set(path, contents) },
    runTest: makeRunTest(killCount),
    testCommand: 'node --test *',
    killerSuites: [{ id: `./${SUT_FILE}`, files: [`./${SUT_FILE}`] }],
    ...overrides,
  }
}

function expectOk(verdict) {
  if (verdict.ok !== true) {
    throw new Error(`expected an ok verdict, got ${JSON.stringify(verdict).slice(0, 400)}`)
  }
  return verdict
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 纯函数臂：等距抽样 vs 取前 N —— 两者在【条数】上同形，在【覆盖】上不同
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 抽样臂：`capMutants` 截断时取【等距】而不是取前 N 条', () => {
  const items = Array.from({ length: 100 }, (_, index) => index)

  const sample = capMutants(items, 10)
  assert.equal(sample.length, 10, '★ 截断后条数必须恰好等于上限')

  /** 严格递增 —— 抽样不许把同一个位置取两次（那会让某些位置被重复测量）。 */
  for (let index = 1; index < sample.length; index += 1) {
    assert.ok(sample[index] > sample[index - 1], `★ 样本必须严格递增：${sample.join(',')}`)
  }

  /**
   * ★★★ 这一条是判别力所在：**取前 N**（`items.slice(0, 10)`）也满足"恰好 10 条 +
   *   严格递增"，而它把 90% 的候选**一条都不看**，且丢掉的恰好是**算子表里靠后**
   *   那些算子的全部变异体 ⇒ "某个算子的变异体全存活"这件事永远看不到。
   *
   *   ⇒ 断言样本**伸到了尾部**：末个样本必须落在后 10% 之内。
   */
  assert.ok(
    sample[sample.length - 1] >= items.length - 10,
    `★ 等距抽样必须覆盖到尾部：末个样本 ${sample[sample.length - 1]}，队列长 ${items.length}`,
  )
  assert.ok(
    sample[0] === 0,
    `★ 起点必须是第一条（否则"第一条就没测"与"采样没采到它"同形）：${sample[0]}`,
  )

  /** 换一种上限：覆盖性必须跟着缩放，而不是只在 10 这一个值上对。 */
  const small = capMutants(items, 3)
  assert.equal(small.length, 3)
  assert.ok(small[2] >= items.length - Math.ceil(items.length / 3), `★ 3 条也要铺到尾部：${small.join(',')}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★ 边界臂：三条边界各对应一种"看不出来"的坏法
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 边界臂：上限 ≤0 / 非有限 ⇒ 原样返回，**绝不**裁成空集', () => {
  const items = [1, 2, 3, 4, 5]

  /**
   * ★ "没有上限"与"一条都不测"在 `totals.considered === 0` 上**同形** ——
   *   而两者是相反的读数（前者什么都没丢，后者什么都没测）。
   *   ⇒ 一个把 `max <= 0` 读成"空集"的实现会在这里红。
   */
  for (const weird of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
    const got = capMutants(items, weird)
    assert.equal(got.length, items.length, `★ max=${weird} 必须原样返回（不是空集）：得到 ${got.length} 条`)
  }

  /** 长度不超过上限 ⇒ 顺序与内容一个字都不许动（顺序本身就是一种读数）。 */
  const same = capMutants(items, 5)
  assert.deepEqual(same, items, '★ 不截断时顺序必须原样保留')

  const untouched = capMutants(items, 99)
  assert.deepEqual(untouched, items, '★ 上限大于长度时同上')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★★ 接线臂：两条闸门必须在 `gate()` 里【真的被读】
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★★★ 接线臂：`gate()` 必须真的读 `ctx.maxMutants` / `ctx.maxPerOperator`', async () => {
  /**
   * ★ 这条臂的全部内容就是"参数在、效果也在"。
   *
   *   改动前：`gate()` 里**零使用点**，而 `plans` 是无条件全跑的
   *   ⇒ 无论传什么都跑同样多 ⇒ 这条臂会红（`batch` 这个读数当时也不存在）。
   *
   * ★ 两条闸门必须**分别**被读，不能只留一条：只读总量时，一个文件里的高频符号
   *   会把配额吃光；只读分布时，10 个改动文件仍会跑到 10 × 13 × k 条。
   */
  const defaults = expectOk(await gate(context()))
  assert.equal(defaults.batch?.maxMutants, DEFAULT_MAX_MUTANTS, '★ 缺省总量上限必须被读出来（不是 undefined）')
  assert.equal(defaults.batch?.maxPerOperator, DEFAULT_MAX_PER_OPERATOR, '★ 缺省分布上限同上')

  /** 显式传值 ⇒ 读数必须跟着变。这排除了"读数恒为缺省"那种假接线。 */
  const explicit = expectOk(await gate(context({ maxMutants: 30, maxPerOperator: 2 })))
  assert.equal(explicit.batch.maxMutants, 30, '★ 显式 maxMutants 必须进读数')
  assert.equal(explicit.batch.maxPerOperator, 2, '★ 显式 maxPerOperator 必须进读数')

  /** ★ 分布闸门真的收窄了分母：1/算子 必须严格少于 4/算子。 */
  const tight = expectOk(await gate(context({ maxPerOperator: 1, maxMutants: 1000 })))
  const loose = expectOk(await gate(context({ maxPerOperator: 4, maxMutants: 1000 })))
  assert.ok(
    tight.batch.considered < loose.batch.considered,
    `★ maxPerOperator 没接线：1/算子=${tight.batch.considered} 条、4/算子=${loose.batch.considered} 条（应当严格小于）`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★★ 截断臂：总量上限生效，且丢弃数必须进【裁决文本】
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★★★ 截断臂：总量上限截断，且"跑了多少 / 丢了多少"进裁决文本', async () => {
  /**
   * ★ 分布闸门放宽到 100，使**只有总量闸门**在起作用 —— 这样这条臂测的是
   *   `maxMutants` 一条，而不是两条混在一起的效果。
   * ★ 上限取 30（≥ 样本下限），因为低于下限的跑批会被判 `unmeasured` ——
   *   那是臂 6b 的事，不是这条。
   */
  const verdict = expectOk(await gate(context({ maxPerOperator: 100, maxMutants: 30 })))

  assert.ok(
    verdict.batch.considered > 30,
    `★ 夹具必须真的产出多于上限的候选（否则这条臂什么都没测）：considered=${verdict.batch.considered}`,
  )
  assert.equal(verdict.batch.ran, 30, '★ 跑了的条数必须恰好等于总量上限')
  assert.equal(
    verdict.batch.truncated,
    verdict.batch.considered - verdict.batch.ran,
    '★ `truncated` 必须等于被丢弃的条数（不是布尔、不是 0/1）',
  )

  /**
   * ★★★ 本臂最要紧的一半：**读数必须进【裁决文本】**，而不是只挂在返回对象上。
   *
   *   理由与 R1（只变异改动行）逐字同源：分母的大小**改变这条分数的含义**。
   *   "30 条里杀掉 9 条"是 0.3，"325 条里杀掉 9 条"是 0.03 —— 而只看分数时同形。
   *   读裁决的人（被拒的成员）必须能看到"这个分数是在一个抽样上量的"。
   */
  assert.match(verdict.scope, /truncated by its own total cap/, '★ 截断必须被点名')
  assert.match(verdict.scope, /30 of \d+ candidate/, '★ 必须写出"跑了几条 / 共几条"')
  assert.match(verdict.scope, /sample, not over every changed line/, '★ 必须说清这是抽样，不是全量')
})

test('臂 4b ★ 不截断臂：`truncated` 必须**缺席**，而不是 0（两者不同形）', async () => {
  const verdict = expectOk(await gate(context({ maxPerOperator: 100, maxMutants: 10_000 })))
  assert.equal(verdict.batch.truncated, undefined, '★ 没截断时不许出现 truncated')
  assert.ok(
    !Object.hasOwn(verdict.batch, 'truncated'),
    '★ 用 `in` / `hasOwn` 判定：一个把 truncated 恒设为 0 的实现会在这里红',
  )
  assert.ok(!/truncated by its own total cap/.test(verdict.scope), '★ 没截断时裁决文本不许提截断')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ 一致性臂：截断后跑的分母与报告里的分母必须是同一件事
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 ★ 一致性臂：截断后 `totals.considered` 必须等于**真的跑了**的条数', async () => {
  /**
   * ★ 探针射程那一句循环此前读的是 `plans`（**全部候选**）而跑的是 `plans` ——
   *   两者同源所以看不出来。现在跑的是 `selected`，若那一句仍读 `plans`，
   *   "某个文件的变异体一条都没跑（被截断）"会被读成"它的探针够不到"
   *   ⇒ 一份关于**分片**的事实被报成一份关于**探针**的事实。
   */
  const verdict = expectOk(await gate(context({ maxPerOperator: 100, maxMutants: 30 })))
  assert.equal(
    verdict.mutationReport.totals.considered,
    verdict.batch.ran,
    '★ 报告里的分母必须就是真的跑了的那批',
  )
  assert.equal(verdict.killed + verdict.survived, verdict.batch.ran, '★ 杀了 + 活了 = 跑了的条数')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★★★ 翻面臂：同一份实现，只看配额，判据的结论就能翻面
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★★★ 翻面臂：同一份实现 + 同一个套件，配额不同 ⇒ 结论从 ok 翻成 blocked', async () => {
  /**
   * ★★ 这条臂记录的是本轮**实测**的一个后果，而不是一个设计偏好。
   *
   *   先记下第一层（我自己踩的）：改动前缺省 25/200 ⇒ considered 26 ⇒ 2 条存活
   *   ⇒ 0.923（过）；本次把缺省下调到 4/40 ⇒ considered 18 ⇒ 同样 2 条存活
   *   ⇒ 0.889（不过）。**存活体是同样两条**，变的只是分母。
   *
   *   再记第二层，也就是本臂要钉的这一层：既然分数是分母的函数，那么**只要改配额
   *   就能改结论**。这里让替身封杀前 18 条、其余存活：
   *
   *     配额 30   ⇒ 18/30  = 0.600 ⇒ **ok**（阈值是 `<`，等于不减）
   *     配额 10000 ⇒ 18/135 = 0.133 ⇒ **blocked**
   *
   *   ⇒ 同一份实现、同一个套件、同一批被杀死的变异体，**只有我们的配额在动**，
   *     而判据一边放行一边拒绝。★ 那意味着"这个实现过不过"**不可复现** ——
   *     门禁的全部价值就在可复现。
   *
   * ★ 本臂不试图修它。修法需要"分数 + 样本量"一起读的判据（区间估计 / 样本下限
   *   随分母缩放），那是另一个决定；本臂的作用是把它**钉成一条永久的读数**：
   *   下一次有人调配额，这两条断言会当场告诉他"你正在改的不是成本，是结论"。
   */
  const killCount = 18
  const narrow = expectOk(await gate(context({ maxPerOperator: 100, maxMutants: 30 }, killCount)))
  const wide = await gate(context({ maxPerOperator: 100, maxMutants: 10_000 }, killCount))

  assert.equal(narrow.batch.ran, 30)
  assert.ok(narrow.mutationScore >= 0.6, `★ 窄配额下分数应当过线：${narrow.mutationScore}`)
  assert.equal(wide.ok, false, '★ 宽配额下同一份实现必须被拒 —— 两个结论必须不同')

  /**
   * ★ 读 blocked 那一侧只能在【裁决文本】里读，因为 `batch` 这个结构化读数
   *   **只挂在 ok 路径上**（`gate()` 的 `blocked([...])` 那一支不产出它）。
   *   ★ 这是一处真实的不对称：被拒的成员正是需要知道样本量的人。好在截断那句
   *     已经被并进 `scope`、而 `scope` 在 blockers 里，所以关键读数没丢；
   *     丢的是"配额生效值"这半格。本臂只用 blocked 路径上确实存在的东西断言。
   */
  const wideText = wide.blockers.join('\n')
  assert.match(wideText, /mutation score 0\.1/, '★ 宽配额一侧必须报出远低于阈值的分数')
  assert.match(wideText, /\/135 mutant\(s\) survived/, '★ 且必须报出分母 —— 否则两个同形分数无法被追溯')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6b ★★★ 下限臂：小样本**不许**靠运气放行（这是本次实测到的假通过）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6b ★★★ 下限臂：被截断到样本下限之下 ⇒ unmeasured，不是 ok（堵一个假通过）', async () => {
  /**
   * MEASURED（本轮，方向是**放行** —— 最贵的方向）：
   *
   *     截断到 6 条、杀 5 条 ⇒ 0.833 ≥ 0.6 ⇒ 若没有下限就会是 **ok**
   *     同一份实现不截断（135 条里杀 5 条）⇒ 0.037 ⇒ blocked
   *
   * ⇒ 一个 n=6 的点估计被**直接**拿去和固定阈值比，没有任何样本量意识，
   *   而"n=6 时 0.833"完全可以是运气。★ 这条臂就是那个假通过的钉子。
   */
  const verdict = await gate(context({ maxPerOperator: 100, maxMutants: 6 }, 5))

  assert.equal(verdict.ok, false, '★ 小样本绝不许放行')
  assert.ok(
    typeof verdict.unmeasured === 'string',
    `★ 必须是 unmeasured（"这份跑批没能给读数"），而不是 blocked（"成员的测试是装饰性的"）`
    + ` —— 两者的补救动作相反。实际：${JSON.stringify(verdict).slice(0, 300)}`,
  )
  assert.match(verdict.unmeasured, /floor/, '★ 必须点名"样本低于下限"')
  assert.match(verdict.unmeasured, /by luck/, '★ 必须说清为什么：这个分数可以是运气')

  /**
   * ★ 反向臂：**同样的分数，但候选本来就只有那么多** ⇒ 不受下限约束。
   *   若下限被写成"分数低于 N 就拒"（不看有没有截断），这条会红 ——
   *   而那样会把每一次诚实的小改动都判成"说不清"。
   */
  const honest = expectOk(await gate(context({ maxPerOperator: 1, maxMutants: 10_000 })))
  assert.ok(
    honest.batch.considered <= 20,
    `★ 反向臂要的是"候选本来就少"：considered=${honest.batch.considered}`,
  )
  assert.ok(!Object.hasOwn(honest.batch, 'truncated'), '★ 反向臂必须没有被截断')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7 ★ 注册面臂：本判据的 id / 位置没被这次改动挪动
// ─────────────────────────────────────────────────────────────────────────────

test('臂 7 ★ 注册面臂：`completion.mutation` 的 id 与位置不变', () => {
  assert.equal(id, 'completion.mutation')
  assert.equal(point, 'completion')
  assert.equal(typeof appliesTo, 'function')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8 ★ 行覆盖（t5）+ 逐测试收窄（只在基线点了名时）
// ─────────────────────────────────────────────────────────────────────────────

const NARROW_FILE = 'narrow-sut.mjs'
const NARROW_SOURCE = 'export function probe(x) {\n  return x > 0\n  return x > 1\n}\n'
const HIT_TEST = 'hit.test.mjs'
const MISS_TEST = 'miss.test.mjs'
const FIRST_TEST = 'first.test.mjs'
const SECOND_TEST = 'second.test.mjs'

function narrowHarness(baseline, options = {}) {
  const disk = new Map([[NARROW_FILE, NARROW_SOURCE]])
  const commands = []
  let calls = 0
  const suites = options.suites ?? [
    { id: HIT_TEST, files: [HIT_TEST] },
    { id: MISS_TEST, files: [MISS_TEST] },
  ]
  const ctx = {
    loadKindRequirements: () => TABLE,
    task: { id: 't-narrow', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedFiles: [NARROW_FILE],
    changedLines: options.changedLines ?? [2, 3],
    readFile: (path) => {
      const text = disk.get(path)
      if (text === undefined) throw new Error(`no such file in the fixture sandbox: ${path}`)
      return text
    },
    readSuite: () => `import './${NARROW_FILE}'\n`,
    writeFile: (path, contents) => { disk.set(path, contents) },
    runTest: async (command) => {
      calls += 1
      commands.push(command)
      if (calls === 1) return baseline
      if (options.onMutant !== undefined) return options.onMutant(command, calls)
      return { ...MUTANT_RED }
    },
    testCommand: 'node --test *',
    killerSuites: suites,
    maxMutants: 10_000,
    maxPerOperator: 100,
    minKillRate: options.minKillRate ?? 0,
  }
  return { ctx, commands, calls: () => calls }
}

test('臂 8 ★ 有逐测试覆盖时，没碰到该行的测试不被调用', async () => {
  const harness = narrowHarness({
    ...BASELINE_GREEN,
    executedLines: { [NARROW_FILE]: [1, 2, 3] },
    testsByLine: { [NARROW_FILE]: { 2: [HIT_TEST], 3: [HIT_TEST] } },
  })
  const verdict = expectOk(await gate(harness.ctx))
  const mutantCommands = harness.commands.slice(1)

  assert.ok(mutantCommands.length > 0, '★ 执行到的行必须真的跑了变异体')
  assert.ok(
    harness.commands[0].includes(HIT_TEST) && harness.commands[0].includes(MISS_TEST),
    `★ 基线仍是整份套件，实际 ${harness.commands[0]}`,
  )
  for (const command of mutantCommands) {
    assert.ok(command.includes(HIT_TEST), `★ 碰到该行的测试必须被调用：${command}`)
    assert.equal(command.includes(MISS_TEST), false, `★ 没碰到该行的测试不许被调用：${command}`)
  }
  assert.equal(verdict.mutationReport.totals.killed, mutantCommands.length)
})

test('臂 9 ★ 有逐测试覆盖且中途被杀时，early-stop.skipped 大于 0', async () => {
  const harness = narrowHarness(
    {
      ...BASELINE_GREEN,
      executedLines: { [NARROW_FILE]: [1, 2, 3] },
      testsByLine: { [NARROW_FILE]: { 2: [FIRST_TEST, SECOND_TEST], 3: [FIRST_TEST, SECOND_TEST] } },
    },
    {
      suites: [
        { id: FIRST_TEST, files: [FIRST_TEST] },
        { id: SECOND_TEST, files: [SECOND_TEST] },
      ],
      onMutant: (command) => {
        if (command.includes(SECOND_TEST)) throw new Error(`second test ran after a kill: ${command}`)
        return { ...MUTANT_RED }
      },
    },
  )
  const verdict = expectOk(await gate(harness.ctx))
  const mutantCommands = harness.commands.slice(1)

  assert.ok(mutantCommands.length > 0)
  assert.ok(mutantCommands.every((command) => command.includes(FIRST_TEST)))
  assert.equal(
    mutantCommands.some((command) => command.includes(SECOND_TEST)),
    false,
    `★ 第一条已经杀死，第二条不许再跑：${mutantCommands.join(' | ')}`,
  )
  assert.ok(
    verdict['early-stop'].skipped > 0,
    `★ early-stop.skipped 必须大于 0，实际 ${JSON.stringify(verdict['early-stop'])}`,
  )
  assert.equal(verdict['early-stop'].skipped, mutantCommands.length, '★ 每个被杀的变异体都省下了后面那一条')
})

test('臂 10 ★ 没有逐测试覆盖时保持 t5：整份套件照跑，不猜一条测试；没执行到的行 runTest 为 0', async () => {
  const harness = narrowHarness({
    ...BASELINE_GREEN,
    executedLines: { [NARROW_FILE]: [1, 2] },
  }, {
    suites: [
      { id: 'a.test.mjs', files: ['a.test.mjs'] },
      { id: 'b.test.mjs', files: ['b.test.mjs'] },
    ],
  })
  const verdict = expectOk(await gate(harness.ctx))
  const mutantCommands = harness.commands.slice(1)

  assert.equal(mutantCommands.length, 1, `★ 只有执行到的那一行跑套件；实际 ${mutantCommands.length} 次（${mutantCommands.join(' | ')}）`)
  assert.ok(mutantCommands[0].includes('a.test.mjs'), `★ 整份套件必须含 a：${mutantCommands[0]}`)
  assert.ok(mutantCommands[0].includes('b.test.mjs'), `★ 整份套件必须含 b，不许猜成只有 a：${mutantCommands[0]}`)
  assert.equal(verdict.mutationReport.totals.uncovered, 1, '★ 没执行到的那条计为未覆盖')
  assert.equal(verdict.mutationReport.totals.survived, 0, '★ 未覆盖不进 survived')
  assert.equal(verdict['early-stop'].skipped, 0, '★ 没点名逐测试时不许假装早停')
  assert.ok(
    verdict.mutationScore < 1,
    `★ 把未覆盖剔出分母会得到 1：${verdict.mutationScore}`,
  )
})

test('臂 10b ★ 采不到覆盖 ⇒ 整批 unmeasured，不假装全存活或全未覆盖', async () => {
  const harness = narrowHarness({ ...BASELINE_GREEN })
  const verdict = await gate(harness.ctx)

  assert.equal(harness.calls(), 1, `★ 指不出覆盖时不许再跑变异套件；实际 ${harness.calls()}`)
  assert.equal(typeof verdict.unmeasured, 'string', `★ 必须是 unmeasured，实际 ${JSON.stringify(verdict).slice(0, 300)}`)
  assert.match(verdict.unmeasured, /not "everything survived"/)
  assert.match(verdict.unmeasured, /not "everything uncovered"/)
})

test('臂 10c ★ 报告对得上的文件照跑；没提到的文件单独 unmeasured，不取消已对上文件的 runTest', async () => {
  const missed = 'lib/missed.js'
  const executed = 'lib/ran.js'
  const source = 'export function probe(x) {\n  return x > 0\n}\n'
  const report = [
    'ℹ tests 1',
    'ℹ pass 1',
    'ℹ fail 0',
    'ℹ start of coverage report',
    'ℹ file | line % | branch % | funcs % | uncovered lines',
    `ℹ lib | | | | `,
    'ℹ  ran.js | 100.00 | 100.00 | 100.00 | ',
    'ℹ all files | 100.00 | 100.00 | 100.00 | ',
    'ℹ end of coverage report',
    '',
  ].join('\n')
  const disk = new Map([[missed, source], [executed, source]])
  const commands = []
  let calls = 0
  const verdict = expectOk(await gate({
    loadKindRequirements: () => TABLE,
    task: { id: 't-partial', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    /** ★ missed 放在前面：见到「报告没提到」就整批返回的话，已对上的文件不会再 runTest。 */
    changedFiles: [missed, executed],
    changedLines: [2],
    readFile: (path) => {
      const text = disk.get(path)
      if (text === undefined) throw new Error(`no such file in the fixture sandbox: ${path}`)
      return text
    },
    readSuite: () => `import './${executed}'\n`,
    writeFile: (path, contents) => { disk.set(path, contents) },
    runTest: async (command) => {
      calls += 1
      commands.push(command)
      if (calls === 1) return { exitCode: 0, stdout: report, stderr: '' }
      return { ...MUTANT_RED }
    },
    testCommand: 'node --test *',
    killerSuites: [{ id: HIT_TEST, files: [HIT_TEST] }],
    maxMutants: 10_000,
    maxPerOperator: 100,
    minKillRate: 0,
  }))

  assert.ok(calls > 1, `★ 已对上的文件必须继续 runTest；实际 ${calls}`)
  assert.deepEqual(verdict.coverageUnmeasured, [missed], '★ 报告没提到的文件单独记 unmeasured')
  assert.equal(verdict.mutationReport.totals.uncovered, 0, '★ 漏掉的文件不得记成 uncovered')
  assert.equal(verdict.survived, 0, '★ 也不得记成 survived')
  assert.ok(verdict.killed > 0, '★ 已对上的文件照常计入杀死')
})

test('臂 10d ★ 同名 basename 用目录前缀匹配，不把整批当成 ambiguous', async () => {
  const executed = 'lib/mutation.js'
  const other = 'src/gates/completion/mutation.js'
  const source = 'export function probe(x) {\n  return x > 0\n}\n'
  const report = [
    'ℹ tests 1',
    'ℹ pass 1',
    'ℹ fail 0',
    'ℹ start of coverage report',
    'ℹ file | line % | branch % | funcs % | uncovered lines',
    'ℹ lib | | | | ',
    'ℹ  mutation.js | 100.00 | 100.00 | 100.00 | ',
    'ℹ src | | | | ',
    'ℹ  gates | | | | ',
    'ℹ   completion | | | | ',
    'ℹ    mutation.js | 50.00 | 100.00 | 100.00 | 2',
    'ℹ all files | 75.00 | 100.00 | 100.00 | ',
    'ℹ end of coverage report',
    '',
  ].join('\n')
  const disk = new Map([[other, source], [executed, source]])
  let calls = 0
  const verdict = expectOk(await gate({
    loadKindRequirements: () => TABLE,
    task: { id: 't-basename', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedFiles: [other, executed],
    changedLines: [2],
    readFile: (path) => {
      const text = disk.get(path)
      if (text === undefined) throw new Error(`no such file in the fixture sandbox: ${path}`)
      return text
    },
    readSuite: () => `import './${executed}'\nimport './${other}'\n`,
    writeFile: (path, contents) => { disk.set(path, contents) },
    runTest: async () => {
      calls += 1
      if (calls === 1) return { exitCode: 0, stdout: report, stderr: '' }
      return { ...MUTANT_RED }
    },
    testCommand: 'node --test *',
    killerSuites: [{ id: HIT_TEST, files: [HIT_TEST] }],
    maxMutants: 10_000,
    maxPerOperator: 100,
    minKillRate: 0,
  }))

  assert.ok(calls > 1, `★ 目录前缀对上的 lib/mutation.js 必须跑；整批 ambiguous 时这里会停在基线。实际 ${calls}`)
  assert.equal(verdict.coverageUnmeasured.length, 0, `★ 两个文件都被点了名：${verdict.coverageUnmeasured.join(', ')}`)
  assert.ok(verdict.killed > 0, '★ 执行到的那个 mutation.js 被杀掉')
  assert.ok(verdict.mutationReport.totals.uncovered > 0, '★ 另一个 mutation.js 的未覆盖行不跑，留在 uncovered')
  assert.equal(verdict.mutationReport.totals.survived, 0)
})
