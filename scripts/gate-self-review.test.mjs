#!/usr/bin/env node
/**
 * ── ★★★ 「谁实现的不许自己判过」—— 协议第 7 条的硬半边 ───────────────────────────
 *
 * 由来（本夹具钉的那条缝）：
 *
 * 队长协议第 7 条逐字：
 *   `Never approve your own implementation or ask for a deliberate failure.`
 * 而 `src/` 里 grep `selfReview` 与 `self-review` 曾经**零命中** ——
 * 它是那 21 个可判据点里「形态上完全可判、却零校验」的三条之一。
 *
 * MEASURED（本轮，盘上全部 team.json）：可判的 13 条审查任务里 **4 条是真自审**，
 * 且**全部**判 `verdict=pass`：
 *   mutation-quality | t4  | reviewer=ledger | impl=ledger | pass
 *   mutation-quality | t8  | reviewer=ledger | impl=ledger | pass
 *   mutation-quality | t12 | reviewer=ledger | impl=ledger | pass
 *   mutation-quality | t14 | reviewer=ledger | impl=ledger | pass
 * ⇒ 不是"可能被违反"，是**已被违反四次、每次都过了**。
 *
 * ── ★ 本夹具的分工 ─────────────────────────────────────────────────────────────
 *
 * 臂 1–5：`judgeSelfReview` 的**判据语义**（纯函数，三态各占一格）
 * 臂 6  ：**真的**跑 update_task ⇒ 自审被拒（行为臂，不是源码文本臂）
 * 臂 7  ：反向 —— 换一个身份审同一条 ⇒ 放行
 * 臂 8  ：反向 —— 自审说 needs_revision ⇒ 放行（禁的是"给自己盖章"，不是"提意见"）
 *
 * ★★ 臂 6/7/8 是不可省的：本仓反复记录过「测试与生产跑的不是同一条路」——
 *   `gate-r5` 的臂 4 就是源码文本臂，它读的是 `output:` 出现次数，
 *   于是「捕获了却写空串」这种真缺陷打不红（见过夜报告 §九）。
 *   这里至少要有**一条**臂真跑工具、读返回值。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { judgeSelfReview } from '../lib/quality-gates.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readTeamSync } from '../lib/state.js'

const cleanups = []
process.on('exit', () => {
  for (const path of cleanups) {
    try { rmSync(path, { recursive: true, force: true }) } catch {}
  }
})

/** 一支两成员的队，任务记录由本夹具手工构造（判据只读 `executions`）。 */
function stateWith(tasks, members = [{ name: 'dev' }, { name: 'rev' }]) {
  return {
    id: 'fixture',
    name: 'fixture',
    workspace: '/tmp/fixture',
    phase: 'running',
    createdAt: 0,
    captainSessionId: 'captain',
    members: members.map((m) => ({ ...m, id: m.name, status: 'active' })),
    tasks,
    taskSeq: tasks.length,
  }
}

const implCompleted = (by) => ({
  id: 't2',
  subject: 'implementation',
  status: 'completed',
  dependencies: [],
  kind: 'implementation',
  executions: [{ at: 1, attempt: 1, status: 'completed', by }],
})

const reviewOf = (reviewedTaskId, extra = {}) => ({
  id: 't4',
  subject: 'review-round-1',
  status: 'in_progress',
  dependencies: ['t2'],
  kind: 'review',
  reviewedTaskId,
  ...extra,
})

test('臂 1 ★ 自审必须被拒，且错误里点名【同一身份】与【被审任务】', () => {
  const team = stateWith([implCompleted('ledger'), reviewOf('t2')])
  const result = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'ledger' })
  assert.equal(result.ok, false, '★ 同一身份既实现又审查 ⇒ 必须拒')
  assert.match(result.error ?? '', /ledger/, '错误必须点名那个身份')
  assert.match(result.error ?? '', /t2/, '错误必须点名被审的那条任务')
  assert.match(result.error ?? '', /cannot pass/, '★ 拒的是"通过"，不是"这条任务本身不许存在"')
})

test('臂 2 ★ 反向半边：审查者 ≠ 实现者 ⇒ 放行（13 条里的 9 条是这种）', () => {
  const team = stateWith([implCompleted('dev'), reviewOf('t2')])
  const result = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'rev' })
  assert.equal(result.ok, true)
  assert.equal(result.undecidable, undefined, '★ 判得了就是判得了，不许挂一个 undecidable')
})

test('臂 3 ★ 三态：判不了时 ok=true【且】必须带 undecidable（与"通过"不同形）', () => {
  /* ① 没声明审谁 */
  {
    const team = stateWith([implCompleted('dev'), reviewOf(undefined)])
    const result = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'rev' })
    assert.equal(result.ok, true)
    assert.equal(typeof result.undecidable, 'string', '★ 判不了必须可读，不许静默通过')
  }
  /* ② 指向的任务不在队里 */
  {
    const team = stateWith([implCompleted('dev'), reviewOf('nope')])
    const result = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'rev' })
    assert.equal(result.ok, true)
    assert.match(result.undecidable ?? '', /not in this team/)
  }
  /* ③ 被审任务没有一条 completed 的 execution ⇒ 实现者未知 */
  {
    const notDone = { ...implCompleted('dev'), status: 'in_progress', executions: [] }
    const team = stateWith([notDone, reviewOf('t2')])
    const result = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'dev' })
    assert.equal(result.ok, true)
    assert.match(result.undecidable ?? '', /implementer is unknown/)
  }
})

test('臂 4 ★ 自审自己（reviewedTaskId === task.id）⇒ 拒，而不是"判不了"', () => {
  const team = stateWith([implCompleted('dev'), reviewOf('t4')])
  const result = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'dev' })
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /reviews itself/)
})

test('臂 5 ★ 实现者读的是【最近一次 completed 的 by】，不是 executions 末尾、也不是 assignee', () => {
  const target = {
    ...implCompleted('dev'),
    assignee: 'someone-who-was-just-assigned',
    executions: [
      { at: 1, attempt: 1, status: 'completed', by: 'dev' },
      /* ★ 完成之后又被重开过 —— 末尾这一条不是 completed */
      { at: 2, attempt: 2, status: 'in_progress', by: 'rev' },
    ],
  }
  const team = stateWith([target, reviewOf('t2')])
  const byDev = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'dev' })
  assert.equal(byDev.ok, false, '★ 实现者 = 最近一次 completed 的 by（dev）')
  const byRev = judgeSelfReview({ team, task: team.tasks[1], reviewerName: 'rev' })
  assert.equal(byRev.ok, true, '★ 末尾那条 in_progress 不构成"实现了它"')
})

/* ── 臂 6/7/8：真跑工具 ─────────────────────────────────────────────────── */

function pluginFixture(workspace) {
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      async sendMessage() { return 'm' },
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'm',
    },
    agents: { list() { return [] }, get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
    llm: { resolveCallConfig: async (c) => ({ ...c }), listModels: async () => [] },
  }
  const capability = {
    id: 'captain-session',
    status: 'idle',
    session: { header: { cwd: workspace }, events: [], requestHeader() { return { config: { provider: 'p', model: 'm' } } } },
    options: { provider: 'p', model: 'm' },
    steer() {},
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  return {
    call: (name, args) => tools.get(name).execute(args, { agent: capability, signal: new AbortController().signal }),
    tools,
  }
}

async function stagedTeam(workspace) {
  const { call } = pluginFixture(workspace)
  await call('agent_teams_create', {
    name: 'SelfReviewTeam',
    approval: 'required',
    plan: {
      members: [{ name: 'dev' }, { name: 'rev' }],
      tasks: [
        {
          id: 'impl',
          subject: 'do the work',
          assignee: 'dev',
          kind: 'implementation',
          objective: 'Do the work.',
          acceptance: ['it is done'],
          inScope: ['src/'],
          verify: ['node --version'],
        },
        {
          id: 'judge',
          subject: 'judge the work',
          assignee: 'rev',
          dependencies: ['impl'],
          kind: 'review',
          reviewedTaskId: 'impl',
          objective: 'Judge the work.',
          acceptance: ['verdict given'],
        },
      ],
    },
  })
  await call('agent_teams_approve', { team_id: 'selfreviewteam', confirmation: 'go' })
  return { call }
}

/**
 * 把 `impl` 推到 completed，执行者由参数指定。
 *
 * ★ 为什么直接改盘而不是用工具：本夹具没有成员会话，而"实现者是 `dev`"这件事
 *   只能由一次真的成员完成产生。臂 6/7 要证的是**拒斥发生在 update_task 里**，
 *   前置状态由谁造出来无关 —— 真实盘上那四条自审就是这么存在的。
 * ★★ 而 `executions[].by` 正是判据读的那一格（不是 `assignee`）。
 */
async function markImplCompletedBy(workspace, by) {
  const { readTeamSync: read, writeTeam } = await import('../lib/state.js')
  const root = join(workspace, '.agent-teams')
  const team = read(root, 'selfreviewteam')
  const impl = team.tasks.find((t) => t.subject === 'do the work')
  impl.status = 'completed'
  impl.executions = [{ at: 1, attempt: 1, status: 'completed', by }]
  /* ★ review 的 assignee 是 rev；captain 要动手必须先把它交给自己（生产流程也是这条） */
  const review = team.tasks.find((t) => t.subject === 'judge the work')
  review.assignee = 'captain'
  /**
   * ★ `pending → completed` 会被状态机拒（`quality-gates.ts:1686`），
   *   而那不是本臂要测的东西。先把它推到 `in_progress`（生产上这正是成员 claim 之后的状态）。
   */
  review.status = 'in_progress'
  await writeTeam(root, team)
  return { implId: impl.id, reviewId: review.id }
}

test('臂 6 ★★ 行为臂：captain 实现了它、又想自己判过 ⇒ update_task 当场拒', async () => {
  /**
   * ★★ 这是本夹具**唯一**一条真跑工具、读返回值的臂 —— 其余都可省，它不可省。
   *   本仓反复记录过「测试与生产跑的不是同一条路」（`gate-r5` 的臂 4 读源码文本，
   *   于是"捕获了却写空串"这种真缺陷打不红）。这里必须真的走一遍。
   */
  const workspace = mkdtempSync(join(tmpdir(), 'self-review-'))
  cleanups.push(workspace)
  const { call } = await stagedTeam(workspace)
  const { implId, reviewId } = await markImplCompletedBy(workspace, 'captain')

  await assert.rejects(
    () => call('agent_teams_update_task', {
      task_id: reviewId,
      status: 'completed',
      verdict: 'pass',
    }),
    (error) => {
      assert.match(String(error.message), /self-review is not allowed/, '★ 必须由自审判据拒，不是别的')
      assert.match(String(error.message), /both implemented/, '★ 错误必须说清是谁既实现又审查')
      assert.match(String(error.message), new RegExp(implId), '错误必须点名被审的那条')
      return true
    },
  )

  /* ★ 而盘上**不许**留下 `verdict=pass` —— 拒斥发生在赋值之前，不是"记了再撤"。 */
  const after = readTeamSync(join(workspace, '.agent-teams'), 'selfreviewteam')
  assert.notEqual(after.tasks.find((t) => t.id === reviewId)?.verdict, 'pass',
    '★ 被拒的判决不许落盘（判据在 task.verdict 赋值之前）')
})

test('臂 7 ★ 反向半边：实现者是 dev、captain 来判 ⇒ 自审判据【不】拦', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'self-review-ok-'))
  cleanups.push(workspace)
  const { call } = await stagedTeam(workspace)
  const { reviewId } = await markImplCompletedBy(workspace, 'dev')

  /**
   * ★ 判据的方向性：实现者 `dev` ≠ 判者 `captain` ⇒ 这一条放行。
   *   而这次调用仍可能因**别的**判据失败（review 要 acceptanceResults 等）——
   *   ⇒ 断言的是"错误里不含自审的措辞"，而不是"这次调用必须成功"。
   *   ★ 那正是"这条判据没有误伤"的读数；若要求它成功，本臂会变成在测别的判据。
   */
  try {
    await call('agent_teams_update_task', { task_id: reviewId, status: 'completed', verdict: 'pass' })
  } catch (error) {
    assert.doesNotMatch(String(error.message), /both implemented/,
      '★ dev 实现、captain 判 —— 自审判据不许拦这条路')
  }
})

test('臂 8 ★ 反向半边：自审说 needs_revision ⇒ 放行（禁的是"给自己盖章"）', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'self-review-needs-'))
  cleanups.push(workspace)
  const { call } = await stagedTeam(workspace)
  const { implId, reviewId } = await markImplCompletedBy(workspace, 'captain')

  /**
   * ★★ 协议禁的是 "approve"，**不是**"给自己提意见"。
   *   一条自审给 needs_revision 是**安全方向**：它触发 repair + 下一轮审查，
   *   而下一轮仍然被这条判据盯着。
   *   ⇒ 若这里也拒，判据就变成了"同一身份不许参与自己的收敛循环"，
   *     而那会把一批合法的单人队堵死。
   */
  try {
    await call('agent_teams_update_task', {
      task_id: reviewId,
      status: 'failed',
      verdict: 'needs_revision',
      findings: [{ id: 'F1', severity: 'high', problem: 'x', requiredFix: 'y' }],
    })
  } catch (error) {
    assert.doesNotMatch(String(error.message), /both implemented/,
      '★ 自审说 needs_revision 必须放行 —— 禁的是 approve，不是提意见')
  }
  /* ★ 而 pass 那条仍然被拒（同一条任务、同一个身份） */
  await assert.rejects(
    () => call('agent_teams_update_task', { task_id: reviewId, status: 'completed', verdict: 'pass' }),
    /both implemented|already|terminal/i,
  )
})
