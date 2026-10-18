/**
 * ── t19：每一次执行都留在历史里（`executions[]`）────────────────────────────────
 *
 * 借自 `@linxin666/dsh-web-all` 的 task-board：那边渲染 `task.executions.length`
 * 作为"跑了几次" —— 于是**一次运行是历史里的一个元素，而不是一次状态转换**。
 *
 * ── ★★★ 它修的是什么（MEASURED，本轮真实发生的那件事）──────────────────────────
 *
 * 本插件此前把每一次尝试**塌缩成一个当前状态**：一次 `needs_revision` 的审查
 * 落成 `status: 'failed'`，而"它是那个收敛循环里的第 2 轮"**从记录里消失了**。
 * ⇒ 用户原话：「一个收敛的循环，读成一串互不相干的红色失败」。
 *
 * ── ★★★ 本文件的臂与它们各自防的坏法 ────────────────────────────────────────────
 *
 *   臂 1  ★★ 真入口：**失败两次然后通过** ⇒ 历史里三个元素，按顺序
 *   臂 2  ★★★ 对照臂：**只失败一次就停住** ⇒ 与臂 1 **不同形**
 *   臂 3  ★★ 轮次臂：终态之后**轮次仍然读得出来**（单值字段被覆盖了，历史没被覆盖）
 *   臂 4  ★★★ 持久臂：重读 `team.json` ⇒ 历史**真的落盘了**（不是内存里的）
 *   臂 5  ★ 三态臂：从未跑到终态 ⇒ **缺席**，不许被读成"一次就成"
 *   臂 6  ★★★ 定向突变：把"只追加"改成"只留最后一次" ⇒ 臂 1/2 必须红
 *   臂 7  ★ 同源臂：`FailureKindName` 与 `state.ts` 的 `FAILURE_KINDS` 逐字相同
 *   臂 8  ★★ 不伪造：不是 `failed` 的元素**不许**带 `failureKind`（假事实）
 *
 * ── ★ 为什么臂 1/2 必须走**真工具** ──────────────────────────────────────────────
 *
 * 一个只测 `appendExecution` 的夹具测的是**纯函数**，不是**接线**。
 * 本仓反复记账：判据写对了而它的输入面没接上，在断言层面与"没判据"同形。
 * ⇒ 所以这里走 `agent_teams_update_task`，并**从盘上重读** `team.json`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendExecution, summariseExecutions, FAILURE_KIND_NAMES } from '../lib/types.js'
import { FAILURE_KINDS } from '../lib/state.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 读这个夹具自己工作区里的团队记录（**不读主树那份**）。 */
function teamOf(stateRoot) {
  return JSON.parse(readFileSync(join(stateRoot, 'team', 'team.json'), 'utf8'))
}

/**
 * 一个最小可信的团队 + 一条 `work` 类任务。
 *
 * ★ 用 `work` 而不是质量类：质量类会被完工判据拦（那会引入一堆与本任务无关的
 *   前置条件），而本任务要测的是**终态落定那一刻的记账**。
 * ★ 用 `review`/`repair` 那类会需要 findings/verdict 的完整形状 ——
 *   而"收敛循环"那件事由臂 3 直接对 `round`/`verdict` 断言覆盖。
 */
async function fixture({ taskOverrides = {} } = {}) {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const workspace = mkdtempSync(join(tmpdir(), 'exec-hist-'))
  const stateRoot = join(workspace, '.agent-teams')
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { list: () => [], get() { return undefined } },
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  await createTeamDir(stateRoot, {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'x', kind: 'work', status: 'in_progress', assignee: 'worker',
      dependencies: [], attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1,
      ...taskOverrides,
    }],
  })
  const member = {
    id: 'm1', status: 'working', steer() {},
    session: { header: { cwd: workspace, id: 'sess-m1' }, events: [], ownEvents() { return [] } },
  }
  const call = (args) => tools.get('agent_teams_update_task').execute(
    { task_id: 't1', attempt_id: 'a1', ...args },
    { agent: member, signal: new AbortController().signal },
  ).then(() => 'ok', (error) => String(error.message))
  return { workspace, stateRoot, call, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★★★ 真入口臂）：失败两次然后通过 ⇒ 三个有序元素
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1：**失败两次然后通过** ⇒ 历史里三个元素，按发生顺序，末次是 completed', async () => {
  const f = await fixture()
  try {
    /**
     * ★★★ 这就是用户抱怨的那个循环，逐步做出来。
     *   ★ 每一步之后都**从盘上重读** —— 断言的是**持久化的事实**，
     *     而不是工具在内存里改了什么（本仓 t19/C1 那次的教训：
     *     一个只在内存里成立的状态，与"没写"在盘上同形）。
     */
    const steps = [
      { status: 'failed', output: 'attempt 1 broke' },
      { status: 'failed', output: 'attempt 2 broke again' },
      { status: 'completed', output: 'attempt 3 passed' },
    ]
    for (const step of steps) {
      const outcome = await f.call(step)
      /**
       * ★ 前置：这一步必须**真的**被放行（否则下面读的是一个没发生过的终态）。
       *   ★ 用 `work` 类 + 不带质量证据 ⇒ 完工判据不拦（它对本 kind 只有那一条路）。
       */
      assert.equal(outcome, 'ok', `★ 前置：这一步必须落得下（status=${step.status}）。实测：${outcome.slice(0, 240)}`)
      /** ★ 每次都要把任务重新放回可更新的态（终态任务只收证据）。 */
      const team = teamOf(f.stateRoot)
      const task = team.tasks.find((item) => item.id === 't1')
      if (task.status !== 'completed') {
        task.status = 'in_progress'
        task.attempt = (task.attempt ?? 1) + 1
        writeFileSync(join(f.stateRoot, 'team', 'team.json'), `${JSON.stringify(team, null, 2)}\n`, 'utf8')
      }
    }

    const history = teamOf(f.stateRoot).tasks.find((item) => item.id === 't1').executions
    assert.ok(Array.isArray(history), '★★ 历史必须是一条**数组**（而不是一个当前状态）')
    assert.equal(
      history.length, 3,
      '★★★ 三次终态 ⇒ **三个**历史元素。若只有 1 个，说明它被塌缩回"一个当前状态"了 —— '
      + ' 而那正是本任务要修的那件事',
    )
    assert.deepEqual(
      history.map((entry) => entry.status), ['failed', 'failed', 'completed'],
      '★★★ 而**顺序**必须如实：失败、失败、通过。'
      + ' 反过来（先通过后失败）在读数上是一串**不同的事实**，而排序依据就是 `at`',
    )
    /** ★ 排序依据必须真的在场且单调 —— 否则"有序"这句话没有证据。 */
    const times = history.map((entry) => entry.at)
    assert.ok(times.every((t) => typeof t === 'number'), '★ 每个元素必须有 `at`（墙钟）')
    assert.deepEqual(
      [...times].sort((a, b) => a - b), times,
      '★★ 「有序数组」必须**真的有序**：`at` 逐个不减。一个不排序的数组读不出"先失败后通过"',
    )
    /** ★ 而"它收敛了"这句结论必须从历史里**读得出来**。 */
    const summary = summariseExecutions({ executions: history })
    assert.equal(summary.rounds, 3, '★ 跑了几次 = 历史长度')
    assert.equal(summary.failures, 2, '★ 失败过几次')
    assert.equal(
      summary.outcome, 'converged',
      '★★★ 「失败两次然后通过」必须被读成 `converged` —— 这是用户要的那句结论',
    )
  } finally { f.cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 对照臂）：只失败一次就停住 ⇒ 与臂 1 **不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（对照臂）：**失败一次就停住** ⇒ 与"失败两次然后通过"**不同形**', async () => {
  /**
   * ── ★ 为什么这一条是控制臂 ────────────────────────────────────────────────────
   *
   * 契约要求「A converged loop is distinguishable from a task that failed once and stopped」。
   *
   * ★★ 而一个"凡有历史就报 converged"的实现会让臂 1**全绿** ——
   *   它报得比正确实现还宽。⇒ 唯一能把"真的在分辨"与"它什么都报成收敛"
   *   分开的，就是喂它一条**没有收敛**的历史并要求它**说出另一种结果**。
   *   （本仓那条一般形式：「正向臂只喂『该被拒』的输入，所以它测不出『一律拒绝』」。）
   */
  const f = await fixture()
  try {
    const outcome = await f.call({ status: 'failed', output: 'broke once' })
    assert.equal(outcome, 'ok', `★ 前置：这一步必须落得下。实测：${outcome.slice(0, 240)}`)
    const history = teamOf(f.stateRoot).tasks.find((item) => item.id === 't1').executions
    assert.equal(history.length, 1, '★ 只跑了一次 ⇒ 一个元素（不是"没有历史"）')

    const summary = summariseExecutions({ executions: history })
    assert.equal(
      summary.outcome, 'still-failing',
      '★★★ 末次失败 ⇒ **还没收敛**。★ 它不许被并进 `converged`：'
      + ' 那会把"还没修好"读成"修好了"，方向反了',
    )
    /** ★★★ 而这一条与臂 1 的结论必须**不同形**（否则本臂没有分辨力）。 */
    assert.notEqual(
      summary.outcome, 'converged',
      '★★★ 对照对：唯一的自变量是"末次成没成" ⇒ 结论必须不同形',
    )
    /** ★ 而"一次就成"是**第三种**结果 —— 三态不许合流。 */
    const firstPass = summariseExecutions({ executions: [{ at: 1, attempt: 1, status: 'completed' }] })
    assert.equal(firstPass.outcome, 'first-pass', '★ 一次就成 ⇒ `first-pass`')
    assert.notEqual(firstPass.outcome, summary.outcome, '★★ first-pass 与 still-failing 必须不同形')
    assert.notEqual(firstPass.outcome, 'converged', '★★ first-pass 与 converged 必须不同形')
  } finally { f.cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 轮次臂）：终态之后**轮次仍然读得出来**
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3：**轮次信息在终态之后仍然存在** —— 单值字段被覆盖了，历史没被覆盖', () => {
  /**
   * ── ★ 契约原话：「Round information survives: the record shows how many rounds
   *   occurred even after the task is terminal」────────────────────────────────
   *
   * ★★ 而这一条**只能**靠历史满足：`TeamTask.round` / `verdict` 是**单值** ——
   *   第 2 轮会把第 1 轮覆盖掉。⇒ 判据是机械的：**同一个 `round` 出现两次**时，
   *   单值字段只剩一个，而历史里**两个都在**。
   */
  const task = { id: 't1', attempt: 3, round: 3, verdict: 'pass' }
  const history = []
  for (const [round, verdict, status] of [[1, 'needs_revision', 'failed'], [2, 'needs_revision', 'failed'], [3, 'pass', 'completed']]) {
    appendExecution(task, { at: round, attempt: round, status, round, verdict })
  }
  assert.equal(history.length, 0, '★ 前置：那个空数组是夹具自己的（appendExecution 改的是 task）')
  assert.equal(task.executions.length, 3, '★ 三次都进了历史')
  assert.deepEqual(
    task.executions.map((entry) => entry.round), [1, 2, 3],
    '★★★ 三个轮次都在 —— 而 `task.round` 只剩最后一个（3）',
  )
  assert.equal(task.round, 3, '★ 单值字段如实只剩末值（这正是它答不了"跑了几轮"的原因）')
  assert.deepEqual(
    task.executions.map((entry) => entry.verdict), ['needs_revision', 'needs_revision', 'pass'],
    '★★★ 每一轮的裁决都在。★ 这一格是"收敛"与"一串事故"的分水岭：'
    + ' `needs_revision` 落成 `status: failed` 时会**看起来像一次失败**，'
    + ' 而它其实是那一步**成功地产出了一个否定结论**',
  )
  const summary = summariseExecutions(task)
  assert.equal(summary.rounds, 3, '★ 「跑了几轮」这个问句现在有答案了')
  assert.equal(summary.maxRound, 3, '★ 而最大轮次号也读得出来')
  assert.equal(summary.outcome, 'converged', '★ 末次通过 + 此前失败过 ⇒ 收敛')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★★ 持久臂）：重读 `team.json` ⇒ 历史**真的落盘了**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4：历史**从盘上读得回来**（不是内存里的），所以它活得过一次重载', async () => {
  /**
   * ── ★ 契约原话：「The history is derived from durable records rather than
   *   reconstructed by the UI, so it survives a reload」───────────────────────
   *
   * ★★ 而"它活得过一次重载"这件事**必须被机械地读出来**，不能靠"我写到盘上了"。
   *   ⇒ 做法：走真工具落一次终态，然后**重新解析 `team.json` 的字节**
   *     （`JSON.parse(readFileSync(...))`）—— 那正是重载会做的事。
   *   ★ 而且它必须是**可序列化的**：一个含函数/循环引用的 `executions` 会让
   *     `JSON.stringify` 抛错或静默丢掉那几格，而"丢掉"与"没记"同形。
   */
  const f = await fixture()
  try {
    const outcome = await f.call({ status: 'failed', output: 'broke' })
    assert.equal(outcome, 'ok', `★ 前置：这一步必须落得下。实测：${outcome.slice(0, 240)}`)

    /** ★ 从**字节**重读（模拟一次重载/换进程）。 */
    const raw = readFileSync(join(f.stateRoot, 'team', 'team.json'), 'utf8')
    const reloaded = JSON.parse(raw)
    const history = reloaded.tasks.find((item) => item.id === 't1').executions
    assert.ok(Array.isArray(history) && history.length === 1, '★★★ 历史必须在盘上（重读之后仍然在）')
    const [entry] = history
    assert.equal(entry.status, 'failed', '★ 而它记的是**当时**落下的终态')
    assert.equal(typeof entry.at, 'number', '★ 排序依据也落盘了')
    assert.equal(entry.attempt, 1, '★ 第几次也落盘了')
    /**
     * ★★ 可序列化性的**反向半边**：不许出现 `undefined` 之外的不可表达值。
     *   判据：把重读出来的那份**再序列化一次**，两次必须逐字相同
     *   （若第一份里丢了什么，第二次就会不同 —— 或者它其实是个非 JSON 值）。
     */
    const roundTrip = JSON.stringify(reloaded.tasks.find((item) => item.id === 't1').executions)
    assert.equal(
      JSON.stringify(history), roundTrip,
      '★★ 历史必须**可无损往返** JSON —— 否则"落盘了"只是内存里的一个说法',
    )
    /** ★ 而 `failureKind` 也必须在场（`failed` 的那一次）—— 见臂 8。 */
    assert.equal(
      entry.failureKind, FAILURE_KINDS.includes(entry.failureKind) ? entry.failureKind : entry.failureKind,
      '★ 前置：这一格在场（具体取值由 `failureKindOf` 决定）',
    )
    assert.ok(
      FAILURE_KINDS.includes(entry.failureKind),
      '★★ 而它必须取自**既有的那一套**（与 failureKindOf 同源），而不是这里编的。实测：' + JSON.stringify(entry.failureKind),
    )
  } finally { f.cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 三态臂）：从未跑到终态 ⇒ **缺席**，不许被读成"一次就成"
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（三态）：从未跑到终态 ⇒ 历史**缺席**，而不许被读成「一次就成」', () => {
  /**
   * ★★ 三态（与全仓纪律同源）：
   *   · 有元素 —— 跑到过终态，N 次
   *   · **缺席** —— ★ **一次都还没跑到终态**（还在第一次里）
   *   · 空数组 —— ★ **不出现**（`appendExecution` 只在追加时建立它）
   *
   * ★ 为什么"缺席"不许被读成 `first-pass`：后者说的是**跑过一次而且成了** ——
   *   而"一次都还没跑完"是**另一件事**。把前者读成后者，会让每一条刚建出来的任务
   *   都带着一句"它一次就通过了"。
   */
  const never = summariseExecutions({})
  assert.equal(never.rounds, 0, '★ 缺席 ⇒ 0 次')
  assert.equal(
    never.outcome, undefined,
    '★★★ 从未跑到终态 ⇒ 结论**缺席**。★ 不许是 `first-pass` —— 那是在说一件没发生的事',
  )
  assert.notEqual(never.outcome, 'first-pass', '★★ 与"跑过一次且成了"必须不同形')

  /** ★ 而**空数组**（不该出现，但万一出现）也必须落"缺席"，而不是"一次就成"。 */
  const empty = summariseExecutions({ executions: [] })
  assert.equal(empty.outcome, undefined, '★ 空数组同样不许读成 first-pass')
  assert.equal(empty.rounds, 0)

  /** ★ 反向半边：`appendExecution` **不制造**空数组 —— 它只在追加时建立。 */
  const fresh = { id: 't9' }
  assert.equal(fresh.executions, undefined, '★ 前置：一条新任务**没有** executions 这一格')
  appendExecution(fresh, { at: 1, attempt: 1, status: 'failed' })
  assert.ok(Array.isArray(fresh.executions) && fresh.executions.length === 1, '★ 追加之后它才出现，且长度是 1')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★★ 定向突变臂）："只留最后一次" ⇒ 臂 1/2 必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6（定向突变）：把"只追加"改成"只留最后一次" ⇒ 历史塌缩，臂必须红', () => {
  /**
   * ── ★ 为什么"有断言"与"断言在起作用"是两件事 ──────────────────────────────────
   *
   * 臂 1 断言"三次 ⇒ 三个元素"。而**一个把历史当成单值写的实现**
   * （每次覆盖，只留最后一次）会让历史长度恒为 1 ⇒ 臂 1 **红**，臂 2 **绿**。
   * ⇒ 所以本臂**当场施加突变、当场跑、当场读回**，而不是声称"它会长红"
   *   （那是关于动作的猜想，本仓 §6 经验 F 记过）。
   *
   * ── 突变体：`appendExecution` 改成**覆盖**（`task.executions = [execution]`）─────
   *   ★ 打在**产物**上（`lib/types.js`，合法 JS）：对源码 `.ts` 做突变要自己剥类型，
   *     而那条管线会腐烂、并以"突变体加载不了"的形式红 —— 与"突变被逮住"同形
   *     （本仓 t22 那条臂实测过这个坑）。
   */
  const libPath = join(REPO_ROOT, 'lib', 'types.js')
  const built = readFileSync(libPath, 'utf8')
  /**
   * ★ 按**内容**定位（不按行号猜）—— 本仓记过"夹具用 indexOf 应用变异体、
   *   打到别的行 + 基线红"那四个坏读数。找不到就**当场红**。
   */
  const pushExpr = /const history = task\.executions \?\? \[\];\s*\n\s*history\.push\(execution\);\s*\n\s*task\.executions = history;/u
  assert.match(
    built, pushExpr,
    '★ 突变臂前置：要在产物里找到"追加进历史"那三句（找不到就不能声称"施加了突变"）',
  )
  const mutated = built.replace(pushExpr, 'task.executions = [execution];')

  const dir = mkdtempSync(join(tmpdir(), 'exec-hist-mutant-'))
  try {
    /**
     * ★★ 复制**整棵 `lib/`**（3.3 MB 的 JS 产物，不是 1.6 GB 的 node_modules）——
     *   本仓 t22 实测过：只复制一个文件会让它的相对 import 找不到，
     *   而那个红（`ERR_MODULE_NOT_FOUND`）与"突变被逮住"同形。
     * ★ 复制而不是软链：软链会被 Node 解成 realpath ⇒ 突变体在盘上而无人读它
     *   （t3 那次实测的静默坏法：读数与未突变**逐字相同**）。
     */
    cpSync(join(REPO_ROOT, 'lib'), join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'types.js'), mutated, 'utf8')

    const probe = join(dir, 'probe.mjs')
    writeFileSync(probe, [
      `const m = await import('file://${join(dir, 'lib', 'types.js').replace(/\\/gu, '/')}')`,
      `const task = { id: 't1' }`,
      `for (const n of [1, 2, 3]) m.appendExecution(task, { at: n, attempt: n, status: n === 3 ? 'completed' : 'failed' })`,
      `process.stdout.write(JSON.stringify({ length: task.executions.length, summary: m.summariseExecutions(task).outcome }))`,
      '',
    ].join('\n'), 'utf8')

    /** ── 读数 ①（前置）：**未突变**时三次 ⇒ 长度 3、结论 converged ─────────────── */
    const controlProbe = join(dir, 'control.mjs')
    writeFileSync(controlProbe, readFileSync(probe, 'utf8')
      .replace(`file://${join(dir, 'lib', 'types.js').replace(/\\/gu, '/')}`, `file://${libPath.replace(/\\/gu, '/')}`), 'utf8')
    const control = spawnSync('node', [controlProbe], { encoding: 'utf8', cwd: dir })
    assert.equal(control.status, 0, `★ 前置：未突变的探针必须跑得起来。实测 stderr=${String(control.stderr).slice(0, 400)}`)
    const controlReading = JSON.parse(control.stdout)
    assert.equal(controlReading.length, 3, '★ 前置：未突变时三次 ⇒ 三个元素（这就是臂 1）')
    assert.equal(controlReading.summary, 'converged', '★ 前置：未突变时结论是 converged')

    /** ── 读数 ②（★ 交付读数）：突变体塌缩成 1 ⇒ 结论也不同 ─────────────────────── */
    const mutant = spawnSync('node', [probe], { encoding: 'utf8', cwd: dir })
    assert.equal(mutant.status, 0, `★★ 突变体探针必须跑得起来。实测 stderr=${String(mutant.stderr).slice(0, 500)}`)
    const mutantReading = JSON.parse(mutant.stdout)
    assert.equal(
      mutantReading.length, 1,
      '★★★ 定向突变：把"只追加"改成"只留最后一次"之后，历史**必须**塌缩成 1 —— '
      + '若它仍是 3，说明探针读到的不是突变体（本仓记过：突变体在盘上而无人读它）',
    )
    assert.notDeepEqual(
      mutantReading, controlReading,
      '★★★ 对照对：唯一的自变量是那三句 ⇒ 读数必须不同形 —— 否则本臂证明不了"只追加在起作用"',
    )
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（★ 同源臂）：两份 `FailureKind` 取值逐字相同
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7：`FailureKindName` 与 `state.ts` 的 `FAILURE_KINDS` **逐字相同**', () => {
  /**
   * ── ★ 为什么这一格需要一条臂 ──────────────────────────────────────────────────
   *
   * `types.ts` **不许** import `state.ts`（它是零 import 的叶子，见 t24；
   * 而 `state.ts` 反过来 import 它 ⇒ 会成环）。⇒ 于是"失败成因的取值"
   * 在**两处**各写了一份字面量。
   *
   * ★★ 而"两份字面量"正是一个**会漂移的东西**。⇒ 它必须有一条**机械的**保障，
   *   而不是靠"记得同步"（那是一条靠记忆的规则，本仓反复证明这类规则会腐烂）。
   *   ⇒ 这一条就是那个保障：两处分叉的那一天，本臂当场红。
   */
  assert.deepEqual(
    [...FAILURE_KIND_NAMES], [...FAILURE_KINDS],
    '★★★ `types.ts` 的 FAILURE_KIND_NAMES 与 `state.ts` 的 FAILURE_KINDS 必须逐字相同 —— '
    + ' 分叉会让"这条失败是哪一种"在两个读取端给出两个答案',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（★★ 不伪造臂）：不是 `failed` 的元素**不许**带 `failureKind`
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 8：不是 `failed` 的终态**不许**带 `failureKind` —— 那是假事实', async () => {
  /**
   * ── ★ 这一条防的是"顺手填一个"──────────────────────────────────────────────────
   *
   * `failureKindOf(task)` 对**非 failed** 的任务也返回一个值（它有一个缺省）。
   * ⇒ 若把它的返回值无条件抄进历史，那么一条 `completed` 的执行也会带着
   *   `failureKind: 'failed_context'` —— 而那是一条**假事实**：
   *   读的人会去查一个根本没发生的失败。
   *
   * ★ 本仓反复记账的形态：**一个读数在它分辨不了的地方被当成了结论。**
   *   ⇒ 判据是机械的：`failureKind` 只在 `status === 'failed'` 的**那一次**在场。
   */
  const f = await fixture()
  try {
    const outcome = await f.call({ status: 'completed', output: 'finished' })
    assert.equal(outcome, 'ok', `★ 前置：这一次必须落得下。实测：${outcome.slice(0, 240)}`)
    const history = teamOf(f.stateRoot).tasks.find((item) => item.id === 't1').executions
    assert.equal(history.length, 1, '★ 前置：一个元素')
    assert.equal(history[0].status, 'completed', '★ 而它是一次**成功**的终态')
    assert.equal(
      history[0].failureKind, undefined,
      '★★★ 成功的那一次**不许**带 `failureKind` —— `failureKindOf` 对它也给一个值，'
      + ' 而抄进来会是一条假事实（读的人会去查一个没发生的失败）',
    )
    assert.ok(
      !Object.hasOwn(history[0], 'failureKind'),
      '★★ 而且这一格必须**整个不在**（不是 `undefined`）：'
      + ' 挂一个 `undefined` 属性会让"没有失败成因"与"有、只是没填"在 `Object.hasOwn` 这层同形',
    )
  } finally { f.cleanup() }
})
