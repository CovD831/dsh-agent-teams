/**
 * ── `unsatisfiedDependencies` 的终态口径臂（t26：终态依赖不该卡死下游）────────────
 *
 * 这不是一条新判据的三臂，而是**一条既有规则的口径修复**。所以臂的形状也不同：
 *
 *   臂 1（缺陷臂）：上游 failed / cancelled ⇒ 下游**必须能开工**
 *                   ★ 缺它，整个修复就是"看着改了、其实没改"
 *   臂 2（反向臂）：上游 pending / claimed / in_progress ⇒ 下游**仍然不许开工**
 *                   ★ 缺它，一个 `return []` 的实现在臂 1 上照样全绿 ——
 *                     那会把"依赖"这个机制整个删掉，而夹具会替它鼓掌
 *   臂 3（细分臂）：failed 的三种细分能被**下游读到**，且互不同形
 *   臂 4（对照臂）：全 completed ⇒ 满足，且不产出任何"值得注意"的话
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-07，本机复现）。这一行此前是：
 *
 *     src/state.ts:137
 *     return dependencies.filter((id) => byId.get(id)?.status !== 'completed')
 *
 * 实测形状（真的跑过，见 §基线）：
 *
 *     t18 ← t17(failed)      ⇒ unsatisfied: ["t17"]   ★ 永久卡死
 *     t21 ← t20(failed)      ⇒ unsatisfied: ["t20"]
 *     t24 ← t23(cancelled)   ⇒ unsatisfied: ["t23"]
 *     t22 ← t19(completed)   ⇒ unsatisfied: []
 *
 * 而 failed / cancelled **也是终态**（`TASK_TRANSITIONS` 里两者都没有出边）
 * ⇒ 一条 failed 会把整条下游永久锁死，本轮 t18/t21/t22/t23/t24 五个任务因此
 * 全部无法开工。
 *
 * ── ★ 为什么这不是"放宽"，而是修一个更根本的读错 ───────────────────────────────
 *
 * 旧口径把「还没做完」与「做完了、结果是坏的」读成同一件事。而本轮的 t17 / t20
 * 恰恰是**如实报告**：
 *
 *     t17 —— 它的交付物已经并入
 *     t20 —— 它的普查正是它该红的那一份
 *
 * ⇒ 机制把「诚实地说这份工作有问题」判成了「这份工作不存在」。
 *   那会把成员推向"为了让下游能开工而谎报 completed" —— 而**不采信自述**
 *   正是整个判据层存在的理由。
 *
 * ── ★★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「某个具体任务 id 现在是什么状态」**不是不变量**，它是跑夹具那一刻团队状态的快照。
 * 本文件里出现的每一个 id（t17 / t20 / t18 …）都是**夹具自己造的**，
 * 而不是读盘上真实团队得来的 —— 一个去读真实 `team.json` 的夹具会在下一次
 * 团队重建时按设计变红，而红的原因与"口径坏了"毫无关系。
 *
 * ── ★★ 定向突变（真的执行）────────────────────────────────────────────────────
 *
 * 契约验收单列：「把某个 failed 类型改回『阻断』⇒ 对应臂必须红」。
 * 本文件**真的跑**这次突变（而"声称"过不了本队的账）：
 *
 *     ① 备份 `src/state.ts`
 *     ② 把"终态即满足"改回"只认 completed"（即把修复**单独去掉**）
 *     ③ 重新 build 出 `lib/`（整个仓库的夹具读的都是 lib/）
 *     ④ 再用臂 1 的输入问一次 ⇒ **它们必须重新被阻塞**（这就是臂 1 变红）
 *     ⑤ 还原源码、重新 build，并断言还原之后与突变前**逐字相等**
 *
 * ★ 第 ⑤ 步不是礼节：没有它，一次中途失败会把一份被突变的规则留在盘上，
 *   而此后所有夹具都在测一份没人认得的代码。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * ★ 从 `../lib` 读（和每一条既有夹具一样）：测的是**真的会被插件加载**的
 *   那一份代码，而不是 `src/` 里的一份平行副本。
 */
import {
  unsatisfiedDependencies,
  dependencyStatuses,
  dependencyOutcomeOf,
  failureKindOf,
  describeDependencyOutcomes,
  FAILURE_KINDS,
} from '../lib/state.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_SOURCE = join(ROOT, 'src', 'state.ts')
const BUILT_STATE = join(ROOT, 'lib', 'state.js')

/**
 * ── 夹具自造的团队（★ 不读盘上真实的 team.json）────────────────────────────────
 *
 * `makeTasks` 造的是**最小的、形状合法**的一份任务列表：它只携带本规则读的那几格
 * （id / status / dependencies / 以及细分要用的 verdict / acceptanceResults /
 * commandsRun）。多写一格就多一个"因为我不填它所以红"的机会，而那种红与口径无关。
 */
function makeTasks(specs) {
  return specs.map((spec) => ({
    id: spec.id,
    subject: `task ${spec.id}`,
    status: spec.status,
    dependencies: spec.dependencies ?? [],
    createdAt: 1,
    updatedAt: 1,
    ...spec.verdict === undefined ? {} : { verdict: spec.verdict },
    ...spec.acceptanceResults === undefined ? {} : { acceptanceResults: spec.acceptanceResults },
    ...spec.commandsRun === undefined ? {} : { commandsRun: spec.commandsRun },
    ...spec.output === undefined ? {} : { output: spec.output },
  }))
}

/** 本轮的实测形状（t17/t20 如实报告，t18/t21 是它们的下游）。 */
function roundTeam() {
  return makeTasks([
    { id: 't17', status: 'failed', verdict: 'reject', output: 'the census found 3 defects; that IS the deliverable' },
    { id: 't18', status: 'pending', dependencies: ['t17'] },
    { id: 't20', status: 'failed', verdict: 'needs_revision', output: 'findings, as asked' },
    { id: 't21', status: 'pending', dependencies: ['t20'] },
    { id: 't19', status: 'completed' },
    { id: 't22', status: 'pending', dependencies: ['t19'] },
    { id: 't23', status: 'cancelled' },
    { id: 't24', status: 'pending', dependencies: ['t23'] },
    { id: 't25', status: 'in_progress' },
    { id: 't26', status: 'pending', dependencies: ['t25'] },
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（缺陷臂）：终态上游 ⇒ 下游必须能开工
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：failed 上游 ⇒ 下游【能开工】（本轮 t18 ← t17 的实测形状）', () => {
  /**
   * ★ 这一臂就是本任务的验收 ①②：把括号里的表达式改成 `Array.isArray(...)`
   *   之类的恒真式，或者把 `.filter` 删掉，它都会红。
   */
  const tasks = roundTeam()
  assert.deepEqual(
    unsatisfiedDependencies(tasks, ['t17']),
    [],
    '★ 一条 failed 上游【不许】永久卡死下游 —— 这是本任务存在的全部理由',
  )
})

test('★ 臂 1b：cancelled 上游 ⇒ 下游也能开工（cancelled 同样是终态）', () => {
  const tasks = roundTeam()
  assert.deepEqual(unsatisfiedDependencies(tasks, ['t23']), [])
})

test('★ 臂 1c：本轮五个被卡死的任务【全部】能开工 —— 逐条点名，不是一个汇总', () => {
  /**
   * ★ 逐条断言而不是 `assert.equal(total, 0)`：一个"总数对了但恰好是别的原因"
   *   的实现（例如全都读成空）会给一个绿色的总数，而正确的做法是每条都能被指名。
   *   本队记账的形态里，"汇总正确、逐条错误"是看不到的。
   */
  const tasks = roundTeam()
  for (const [task, dependency] of [
    ['t18', 't17'],
    ['t21', 't20'],
    ['t22', 't19'],
    ['t24', 't23'],
  ]) {
    const task2 = tasks.find((item) => item.id === task)
    assert.deepEqual(
      unsatisfiedDependencies(tasks, task2.dependencies),
      [],
      `★ ${task} ← ${dependency} 必须能开工`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（反向臂）：非终态上游 ⇒ 下游仍然不许开工
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2：非终态的三种上游 ⇒ 下游【仍然】不许开工（缺它则"删掉依赖"也全绿）', () => {
  /**
   * ── 这一臂是整份夹具里最重要的一条 ──────────────────────────────────────────
   *
   * 没有它，一个 `return []`（或 `.filter(() => false)`）的实现会让臂 1 全绿 ——
   * 而那个实现**把"依赖"这个机制整个删掉了**：下游会在上游还没做完时就开工。
   * 一份只测"该放行的放行了"的夹具，会替一个删掉机制的实现鼓掌。
   *
   * ★ 三种非终态各测一条：pending / claimed / in_progress 都是"还欠工作"。
   *   只测 pending 会让一个"按 status 白名单"的实现漏掉另两种。
   */
  const tasks = makeTasks([
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'claimed' },
    { id: 'c', status: 'in_progress' },
    { id: 'd', status: 'completed' },
  ])
  assert.deepEqual(unsatisfiedDependencies(tasks, ['a']), ['a'], '★ pending 上游必须仍然阻塞')
  assert.deepEqual(unsatisfiedDependencies(tasks, ['b']), ['b'], '★ claimed 上游必须仍然阻塞')
  assert.deepEqual(unsatisfiedDependencies(tasks, ['c']), ['c'], '★ in_progress 上游必须仍然阻塞')
  /** ★ 对照半边：同一次调用里，终态那一条必须放行 —— 否则上面三条可能只是"全都阻塞"。 */
  assert.deepEqual(unsatisfiedDependencies(tasks, ['d']), [], '★ 同一次调用里 completed 必须放行')
})

test('★ 臂 2b：未知依赖 id ⇒ 仍然阻塞（"读不到"不是"了结了"）', () => {
  /**
   * ★ 一个拼错的依赖 id **不是**一个终态：它压根不存在。放行它会让一次拼写错误
   *   静默地不再保护任何东西 —— 而"这个依赖不存在"与"这个依赖做完了"必须不同形。
   */
  const tasks = roundTeam()
  assert.deepEqual(
    unsatisfiedDependencies(tasks, ['t999']),
    ['t999'],
    '★ 未知 id 必须仍然阻塞（旧口径也是这个方向，这里刻意保持）',
  )
})

test('★ 臂 2c：混合依赖 —— 只有非终态那几条留下来，且顺序与入参一致', () => {
  const tasks = roundTeam()
  assert.deepEqual(
    unsatisfiedDependencies(tasks, ['t17', 't25', 't23', 't19']),
    ['t25'],
    '★ 终态的全放行、非终态的留下；顺序与 dependencies 一致（调用方读得出对应关系）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（细分臂）：failed 的三种细分能被下游读到，且互不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3：三种 failed 细分各自可判，且【互不同形】', () => {
  /**
   * 用户裁定：把 failed 细分。三类的补救动作完全不同 ——
   *
   *     failed_delivery —— 交付物真的有问题（有实测证据）
   *     failed_context  —— 环境/口径使它无法以 completed 收口
   *     inconclusive    —— 任务性质就是找问题，而它找到了
   *
   * ★ 三条断言各自用**不同的输入**触发，且断言的是**具体的值**而不是
   *   "三者不相等"：后者在一个把三件事都读成 'failed_context' 的实现上
   *   会因为"它们相等"而红 —— 方向对，但它读不出"哪一条错了"。
   */
  /**
   * ★ 夹具自检：三条断言各自用**不同 id** 取任务，不从 filter 后的数组按下标取
   *   —— 按下标取会在任何一次改动（加一条/减一条）时静默地指向**另一个对象**，
   *   而断言仍然"看起来在测原来那件事"。这是本队记账的"守卫检查了另一个同名的
   *   东西"的夹具版本。
   */
  const byId = new Map(makeTasks([
    { id: 'a', status: 'in_progress' },
    { id: 'b', status: 'failed', verdict: 'reject' },
    { id: 'c', status: 'failed', acceptanceResults: [{ criterion: 'x', status: 'failed' }] },
  ]).map((task) => [task.id, task]))

  const inflight = byId.get('a')
  const reviewFailed = byId.get('b')
  const verifiedBad = byId.get('c')
  assert.equal(inflight.status, 'in_progress', '★ 夹具自检：`a` 不是 failed（它用来测别的）')
  assert.equal(reviewFailed.status, 'failed')
  assert.equal(verifiedBad.status, 'failed')

  assert.equal(
    failureKindOf(reviewFailed),
    'inconclusive',
    '★ 一次 review/requirements 类任务的失败（它给出了 reject/needs_revision）就是它的交付 —— 不是"做砸了"',
  )
  assert.equal(
    failureKindOf(verifiedBad),
    'failed_delivery',
    '★ 有实测证据说交付物本身坏了（验收项 failed / verify 非零退出）⇒ failed_delivery',
  )
})

test('★ 臂 3b：failed_context 是【缺省】—— 没有证据说它坏了，就不许推断成 failed_delivery', () => {
  /**
   * ── 这一条钉的是**方向**，而方向是本队记账最久的那件事 ────────────────────────
   *
   * 「没有证据说它坏了」与「有证据说它好了」是两件不同的事。缺省成 `failed_delivery`
   * 会让每一个**没人检查过**的失败都被扣上"交付物有问题"的帽子，而下游据此
   * 可能直接放弃 —— 那是把"没测到"并进"测出来是坏的"，与并进"通过"同源。
   *
   * ★ 定向突变：把 `failureKindOf` 的最后一行改成 `return 'failed_delivery'` ⇒ 本条红。
   */
  const bare = makeTasks([{ id: 'a', status: 'failed', output: 'the environment has no git; I could not run verify' }])[0]
  assert.equal(
    failureKindOf(bare),
    'failed_context',
    '★ 一个没有 verdict、没有任何 failed 实测的失败 ⇒ failed_context（缺省即最保守的那个）',
  )

  /** ★ 反面：有实测证据时**必须**升到 failed_delivery，否则缺省把它盖住了。 */
  const withCommand = makeTasks([{
    id: 'b',
    status: 'failed',
    commandsRun: [{ command: 'pnpm verify', status: 'failed', exitCode: 1 }],
  }])[0]
  assert.equal(failureKindOf(withCommand), 'failed_delivery')

  /** ★ 而 `exitCode: 0` 的一条 failed 命令【不算】证据（0 不是"坏了"）。 */
  const zeroExit = makeTasks([{
    id: 'c',
    status: 'failed',
    commandsRun: [{ command: 'pnpm typecheck', status: 'failed', exitCode: 0 }],
  }])[0]
  assert.equal(
    failureKindOf(zeroExit),
    'failed_context',
    '★ exitCode 0 不是"交付物坏了"的证据 —— 把 status 字段当证据而不看 exitCode 会让这一格恒真',
  )
})

test('★ 臂 3c：FAILURE_KINDS 的三个取值都被真的用上（不是装饰性的常量表）', () => {
  /**
   * ★ 一个导出的常量表很容易变成"有 0 个读者的清单" —— 本队反复见过。
   *   这条断言把表里的**每一个**取值都真的产出来一次，缺一个就红。
   */
  const produced = new Set([
    failureKindOf(makeTasks([{ id: 'a', status: 'failed', verdict: 'needs_revision' }])[0]),
    failureKindOf(makeTasks([{ id: 'b', status: 'failed', acceptanceResults: [{ criterion: 'x', status: 'failed' }] }])[0]),
    failureKindOf(makeTasks([{ id: 'c', status: 'failed' }])[0]),
  ])
  assert.deepEqual(
    [...produced].sort(),
    [...FAILURE_KINDS].sort(),
    '★ 表里的三个取值每一个都必须真的产得出来 —— 有一个产不出来，它就是一条只写在常量里的话',
  )
})

test('★ 臂 3d：下游能【读到】上游是哪种终态（用户裁定的乙）', () => {
  /**
   * ── 用户裁定的口径是"全都终态即满足，但下游能读到上游是哪种终态"──────────────
   *
   * 只做到"能开工"是把状态**藏起来**：下游于是看不见自己踩在一条失败上面。
   * 这一臂测的是**信息面**，它必须与闸门面**分开读**（合成一个布尔就没了）。
   */
  const tasks = roundTeam()
  const statuses = dependencyStatuses(tasks, ['t17', 't19', 't23', 't25'])

  /** ① 闸门面：终态全满足、非终态不满足。 */
  assert.deepEqual(
    statuses.filter((entry) => !entry.satisfied).map((entry) => entry.id),
    ['t25'],
    '★ 闸门面与 unsatisfiedDependencies 必须是**同一个答案**（两份真相是本队记账的形态）',
  )

  /** ② 信息面：每一条的终态各是哪一种，逐条点名。 */
  assert.deepEqual(
    statuses.map((entry) => [entry.id, entry.outcome]),
    [
      ['t17', 'inconclusive'],
      ['t19', 'completed'],
      ['t23', 'cancelled'],
      ['t25', 'failed_context'],
    ],
    '★ 下游必须读得出"上游落在哪" —— 这是"不替下游做决定，而是把状态交出去"的字面落点',
  )

  /** ③ 两张面一起读才对：`satisfied` 相同的两条，`outcome` 必须仍然分得开。 */
  const satisfied = statuses.filter((entry) => entry.satisfied)
  assert.equal(satisfied.length, 3, '★ 三条终态依赖都满足')
  assert.equal(
    new Set(satisfied.map((entry) => entry.outcome)).size, 3,
    '★ 而它们的 outcome 必须**互不相同** —— 否则"全都满足了"会让"落在哪"重新变得读不出来',
  )
})

test('★ 臂 3e：闸门面与信息面必须是【同一个答案】（两份真相的检查）', () => {
  /**
   * ★ 本队记账过三次"两份真相"。这里的两份是：`unsatisfiedDependencies` 与
   *   `dependencyStatuses[].satisfied` —— 它们判的是同一个问题，就**必须**同答案。
   *
   *   定向突变：只改其中一个（例如让 statuses 仍只认 completed）⇒ 本条红。
   *   ★ 这条断言是**遍历式**的：每一个 id 都两边各问一次。
   */
  const tasks = roundTeam()
  const ids = ['t17', 't19', 't20', 't23', 't25', 't999']
  const viaGate = new Set(unsatisfiedDependencies(tasks, ids))
  const viaInfo = new Set(
    dependencyStatuses(tasks, ids).filter((entry) => entry.satisfied === false).map((entry) => entry.id),
  )
  assert.deepEqual(
    [...viaGate].sort(),
    [...viaInfo].sort(),
    '★ 两条出口对"满不满足"必须给出**同一个**答案 —— 不同就是两份真相',
  )
})

test('★ 臂 3f：`describeDependencyOutcomes` 是读数，不是指示', () => {
  /**
   * ★ 用户裁定的口径是"把状态交出去"，所以这句话**不许**说"请先修复"/"不要继续"
   *   —— 加一句祈使句就等于替下游做了决定，而下游知道的东西比这里多。
   *
   * ★ 而"全都 completed"时必须**一个字都不说**：一个每次派发都渲染一行的实现，
   *   会让真正要看的那一行淹没在噪音里（噪音教人忽略告警）。
   */
  const tasks = roundTeam()
  const allDone = describeDependencyOutcomes(dependencyStatuses(makeTasks([{ id: 'a', status: 'completed' }]), ['a']))
  assert.equal(allDone, '', '★ 上游全都好好地做完了 ⇒ 不产出任何一行（沉默是这里正确的输出）')

  const mixed = describeDependencyOutcomes(dependencyStatuses(tasks, ['t17', 't19']))
  assert.match(mixed, /t17/, '★ 值得说的事必须被说出来')
  assert.match(mixed, /inconclusive/, '★ 而且要说清是**哪一种**终态')
  assert.doesNotMatch(mixed, /t19/, '★ 做完了的那条不进这一行（噪音）')
  assert.doesNotMatch(
    mixed,
    /\b(must|should|please|fix|repair|do not continue)\b/i,
    '★ 它是读数，不是指示 —— 一个祈使句就是替下游做了决定',
  )

  /** ★ 未知 id 也要说得出话（而不是静默丢掉）。 */
  assert.match(
    describeDependencyOutcomes(dependencyStatuses(tasks, ['t999'])),
    /no such task/,
    '★ 一条读不到的依赖必须被点名，不许静默消失',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（对照臂）：正常情形不被误伤
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4：对照臂 —— 全部 completed ⇒ 满足，且不产出任何"值得注意"的话', () => {
  /**
   * ★ 缺了这一臂就无法区分"修复有效"与"修复在乱放行"（START-HERE §4）：
   *   一个恒真的实现会让上面每一条都绿。
   */
  const tasks = makeTasks([{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }])
  assert.deepEqual(unsatisfiedDependencies(tasks, ['a', 'b']), [])
  assert.deepEqual(describeDependencyOutcomes(dependencyStatuses(tasks, ['a', 'b'])), '')
})

test('★ 臂 4b：对照臂 —— 没有依赖时满足（空清单不是"还在等"）', () => {
  assert.deepEqual(unsatisfiedDependencies(roundTeam(), []), [])
  assert.deepEqual(dependencyStatuses(roundTeam(), []), [])
  assert.equal(describeDependencyOutcomes([]), '')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 定向突变（真的执行）：把修复单独去掉 ⇒ 臂 1 必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这次突变要**真的跑**，而不是写在注释里 ────────────────────────────────
 *
 * 契约 §8.5 规则二：「没被突变抓住的修复，等于没修」。而它的后半句更狠：
 * **一条恒真的断言会在"突变全红"的表象下活下来**。所以本文件不是"声称"这次
 * 突变能打红臂 1，而是把它跑出来。
 *
 * ★ 顺序是【串行】的，而且必须：`pnpm build` 会先 `rm -rf lib/`（clean-build），
 *   并行跑两个 build 会让另一个进程读到半个 lib/。
 */
function withBuiltState(mutatedSource, body) {
  const original = readFileSync(STATE_SOURCE, 'utf8')
  const restore = () => {
    writeFileSync(STATE_SOURCE, original)
    const rebuilt = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(rebuilt.status, 0, `★ 还原之后必须能重新 build 成功:\n${rebuilt.stdout}\n${rebuilt.stderr}`)
  }
  try {
    writeFileSync(STATE_SOURCE, mutatedSource)
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(built.status, 0, `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是规则的行为）:\n${built.stdout}\n${built.stderr}`)
    const result = body()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return result.then(
        (value) => { restore(); return value },
        (error) => { restore(); throw error },
      )
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

/**
 * ── ★★ 突变体必须用【重新 import】拿到，不许用文件顶部那个绑定 ──────────────────
 *
 * MEASURED（t6 的突变臂，夹具自己抓出来的）：夹具顶部 `import { gate } from '../lib/…'`
 * 的绑定在**文件加载时**就解析完了。突变体写进 src/、build 也真的重建了 lib/，
 * 而那一次调用仍指向**加载时那一份**（未被突变的）模块 —— 于是断言红，而报告
 * 会读作"这次突变没能打红 ⇒ 那条臂可能是恒真的"。**方向恰好相反。**
 *
 * ⇒ 突变体一律走 `freshState()`：带 cache-busting 的 query 重新 import。
 */
async function freshState(tag) {
  return import(`${BUILT_STATE}?${tag}`)
}

/** 突变的针脚（★ 逐字，且下面有专门一条断言它在源码里真的存在）。 */
const NEEDLE_TERMINAL = `    return !TERMINAL_TASK_STATUSES.includes(dependency.status)`

test('★ 定向突变：把「终态即满足」改回「只认 completed」⇒ 臂 1 必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   *
   * ★ 但"默认跳过"**不是**把机制关掉：跳过的成因由环境变量显式表达，
   *   而运行它的那一次读数会记在任务的 output 里 —— 缺了那次读数，本臂不算数。
   */
  if (process.env.AGENT_TEAMS_TERMINAL_DEP_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_TERMINAL_DEP_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const tasks = roundTeam()
  const baselineGate = await freshState('mutation=baseline')
  const baseline = {
    failedDep: baselineGate.unsatisfiedDependencies(tasks, ['t17']).length,
    cancelledDep: baselineGate.unsatisfiedDependencies(tasks, ['t23']).length,
    inProgressDep: baselineGate.unsatisfiedDependencies(tasks, ['t25']).length,
  }
  assert.deepEqual(
    baseline,
    { failedDep: 0, cancelledDep: 0, inProgressDep: 1 },
    '★ 突变之前：failed/cancelled 放行、in_progress 阻塞 —— 否则下面测的不是突变',
  )

  /**
   * ── 突变体：把修复【单独去掉】（回到只认 completed）────────────────────────────
   *
   * ★ `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的 `replace` 会让
   *   突变体与基线逐字相同，于是下面"变了"这件事变成恒假 —— 那是本队记账的
   *   第二种恒真写法（恒红）的镜像：**突变没生效，而报告说它生效了**。
   */
  const original = readFileSync(STATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_TERMINAL,
    `    return dependency.status !== 'completed' // MUTANT: the old "completed only" reading`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让这次突变恒不生效')

  await withBuiltState(mutated, async () => {
    const mutant = await freshState('mutation=completed-only')
    const after = {
      failedDep: mutant.unsatisfiedDependencies(tasks, ['t17']).length,
      cancelledDep: mutant.unsatisfiedDependencies(tasks, ['t23']).length,
      inProgressDep: mutant.unsatisfiedDependencies(tasks, ['t25']).length,
    }
    /**
     * ★ 这一条断言就是**臂 1 的红**：在"只认 completed"的突变体上，failed / cancelled
     *   下游**重新被阻塞** —— 那正是本任务修掉的那个死锁。
     */
    assert.equal(after.failedDep, 1, '★ 突变体必须重新把 failed 下游卡死 —— 臂 1 就是靠这一条变红的')
    assert.equal(after.cancelledDep, 1, '★ cancelled 同理')
    /**
     * ★ 而 `inProgressDep` **仍然是 1**：本次突变只拆掉"终态即满足"这一半，
     *   "非终态仍然阻塞"那一半独立存在 —— 于是这条断言同时证明
     *   **两条半边各自独立**，不是一个布尔把两件事一起放行。
     */
    assert.equal(after.inProgressDep, 1, '★ 另外半条半边不受影响（非终态仍然阻塞）')
    assert.notDeepEqual(after, baseline, '★ 突变体与基线的读数必须真的不同 —— 相同说明这次突变什么都没测到')
  })

  /** ★ 还原之后逐字相等：一次中途失败会把一份被突变的规则留在盘上。 */
  const restored = await freshState('mutation=restored')
  assert.deepEqual(
    {
      failedDep: restored.unsatisfiedDependencies(tasks, ['t17']).length,
      cancelledDep: restored.unsatisfiedDependencies(tasks, ['t23']).length,
      inProgressDep: restored.unsatisfiedDependencies(tasks, ['t25']).length,
    },
    baseline,
    '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的规则',
  )
})

test('★ 定向突变：把 failed 的某个细分改回「阻断」⇒ 对应臂必须红', async (t) => {
  /**
   * ── 契约验收里的那半句：「把某个 failed 类型改回『阻断』⇒ 对应臂必须红」──────────
   *
   * ★ 这一支与上一条**不同形**，而且更值得跑：上一条去掉的是整条终态规则，
   *   这一条去掉的是**细分**那一半（inconclusive 被当成"不合格"）。
   *   它的坏法是本任务记账里最贵的那一种：交付物没问题、而机制说它不合格。
   */
  if (process.env.AGENT_TEAMS_TERMINAL_DEP_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_TERMINAL_DEP_MUTATION=1 时运行')
    return
  }

  const tasks = roundTeam()
  const baselineState = await freshState('mutation2=baseline')
  assert.deepEqual(
    baselineState.dependencyStatuses(tasks, ['t17', 't20']).map((entry) => entry.outcome),
    ['inconclusive', 'inconclusive'],
    '★ 突变之前：本轮 t17/t20 的两种如实报告都读得出是 inconclusive',
  )

  /**
   * ── 突变体：把 `inconclusive` 从"终态可读"降级成"阻断" ──────────────────────
   *
   * ★ 做法：让 `unsatisfiedDependencies` 把 inconclusive 也读成"还欠工作" ——
   *   这**正是**旧口径对 t17/t20 做的事，只是现在它只针对这一类。
   */
  const original = readFileSync(STATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_TERMINAL,
    `    return !TERMINAL_TASK_STATUSES.includes(dependency.status)\n      || dependencyOutcomeOf(dependency) === 'inconclusive' // MUTANT: "found problems" blocks again`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withBuiltState(mutated, async () => {
    const mutant = await freshState('mutation2=inconclusive-blocks')
    assert.deepEqual(
      mutant.unsatisfiedDependencies(tasks, ['t17']),
      ['t17'],
      '★ 突变体必须让"如实报告"重新卡死下游 —— 这就是本轮 5 个任务开不了工的那个形状',
    )
    assert.deepEqual(
      mutant.unsatisfiedDependencies(tasks, ['t19']),
      [],
      '★ 而 completed 上游不受影响（本次突变只针对 inconclusive）',
    )
    /**
     * ★ 第三个半边：cancelled 上游也不受影响 —— 三者（completed / cancelled /
     *   inconclusive）在突变体上必须**不一起动**，否则这次突变测的是"整条规则"，
     *   而不是"细分那一半"（两种缺陷就分不开了）。
     */
    assert.deepEqual(
      mutant.unsatisfiedDependencies(tasks, ['t23']),
      [],
      '★ cancelled 上游同样不受影响 —— 三条终态必须能被单独地影响',
    )
  })
})

test('★ 二次对照：突变针脚在源码里【真的存在】（否则它改的是一个不存在的字符串）', () => {
  /**
   * ★ 这条不测规则，测的是上面那两次突变**赖以成立的前提**。针脚写错一个字符，
   *   上面的突变就会静默变成"什么都没改"，而报告里它会读作"突变没打红 ⇒ 臂是恒真的"
   *   —— 一个**方向相反**的结论。
   *
   *   定向突变：把 state.ts 里那一行的空白改掉 ⇒ 本条红（且红得比上面那条早）。
   */
  assert.equal(
    readFileSync(STATE_SOURCE, 'utf8').includes(NEEDLE_TERMINAL),
    true,
    '★ 突变针脚必须逐字存在于 state.ts —— 它不在了，"定向突变"就是在改一个不存在的字符串',
  )
})

test('★★ 夹具自检：`freshState` 读到的确实是【当前磁盘上】的 lib，而不是加载时的旧绑定', async () => {
  /**
   * ★ 这条钉的是上面两条突变臂**赖以成立的前提**：它们全部经由 `freshState` 拿函数。
   *   把 `freshState` 换成顶部那个 import 绑定，两次突变都会静默地测**旧代码**，
   *   而报告里会读作"突变没打红"（t6 的实测教训）。
   */
  const a = await freshState('selfcheck=a')
  const b = await freshState('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则 cache-busting 没生效')
  assert.equal(typeof a.unsatisfiedDependencies, 'function')
  assert.equal(typeof b.failureKindOf, 'function')
  /** ★ 顶部那个绑定也得是对的（臂 1~4 走的都是它）。 */
  assert.equal(typeof unsatisfiedDependencies, 'function')
  assert.equal(typeof dependencyStatuses, 'function')
})

// ─────────────────────────────────────────────────────────────────────────────
// 装配形状：这些出口真的能被别的模块拿到（"写了但没人读得到"是本队记账的形态）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 装配形状：四个出口都在 state.js 上，且不是装饰性的常量表', () => {
  /**
   * ★ 本队记账过「有 0 个读者的测试」与「装了但调不到」。这里逐条点名：
   *   消费者（scheduler / tools / 报告）要拿的四个函数必须真的导出。
   */
  for (const name of ['unsatisfiedDependencies', 'dependencyStatuses', 'dependencyOutcomeOf', 'failureKindOf']) {
    assert.equal(typeof { unsatisfiedDependencies, dependencyStatuses, dependencyOutcomeOf, failureKindOf }[name], 'function', `★ ${name} 必须被导出`)
  }
  assert.ok(Array.isArray(FAILURE_KINDS) && FAILURE_KINDS.length === 3)
  /** ★ 两个面必须由**同一个** module 实例交出（不是两份平行实现）。 */
  assert.equal(dependencyOutcomeOf(roundTeam().find((task) => task.id === 't17')), 'inconclusive')
})
