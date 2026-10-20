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
 * 臂 9  ：★★ requirements 也在范围内 —— 写需求的人不许自己盖章（`t?` 那条缝）
 * 臂 10 ：反向 —— 换一个**不会实现**它的身份盖章 ⇒ 放行
 * 臂 11 ：三态 —— 谁都不治理的 requirements ⇒ 判不了（**不是**通过）
 * 臂 12 ：★★ 行为臂 —— 真的跑 update_task，dev 盖 requirements 的 pass 当场被拒
 * 臂 13 ：定向突变 —— 把 requirements 那一支退回"恒通过" ⇒ 臂 9 的输入必须重新被放行
 *
 * ★★ 臂 6/7/8 是不可省的：本仓反复记录过「测试与生产跑的不是同一条路」——
 *   `gate-r5` 的臂 4 就是源码文本臂，它读的是 `output:` 出现次数，
 *   于是「捕获了却写空串」这种真缺陷打不红（见过夜报告 §九）。
 *   这里至少要有**一条**臂真跑工具、读返回值。
 *
 * ── ★★★ 臂 9–13 钉的那条缝（本次补的）───────────────────────────────────────────
 *
 * `canDeclareDelivery`（`quality-gates.ts:~2489`）对 requirements 的完成规则与 review
 * **逐字相同**：`(kind === 'review' || kind === 'requirements') && item.verdict !== 'pass'`。
 * 而 `judgeSelfReview` 此前对**任何**非 review 的 kind 直接返回
 * `{ ok: true, undecidable: 'task X is requirements, not a review' }`
 * ⇒ 于是"同一身份批准自己的产物"在 review 上被拒、在 requirements 上被放行。
 * ★ 而质量生成器默认 `analyst: spec.analyst ?? spec.implementer`（`src/tools/create.ts:438`）
 *   ⇒ **默认就由实现者写需求**，所以这不是理论上的可能，它是默认路径。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { judgeSelfReview } from '../lib/quality-gates.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readTeamSync } from '../lib/state.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'quality-gates.ts')

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

/**
 * ★ `sessionId` 缺省 `captain-session`（= `capability.id` 的既有取值，臂 6/7/8 依赖它）。
 *   臂 12 传成员会话 id 才能以**成员身份**真的调一次工具 —— 而成员身份是按会话 id
 *   精确匹配的（`participantIdentityOf`），所以那个 id 必须与盘上成员记录一致。
 */
function pluginFixture(workspace, sessionId = 'captain-session') {
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
    id: sessionId,
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
      shape: 'flat',
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

/* ── 臂 9–11：requirements 的判据语义（纯函数，三态各占一格）───────────────── */

/**
 * 一条 requirements 任务：它的产出是**契约本身**，所以它没有 `reviewedTaskId`。
 * ★ 这正是它此前被 `!== 'review'` 那一行放走的原因，也是本组臂存在的理由。
 */
const reqTask = (id, extra = {}) => ({
  id,
  subject: 'requirements-round-1',
  status: 'in_progress',
  dependencies: [],
  kind: 'requirements',
  assignee: 'dev',
  objective: 'Converge requirements.',
  acceptance: ['they are testable'],
  ...extra,
})

/**
 * 一条**被 requirements 治理**的实现任务（依赖闭包里有 `reqId`）。
 * ★ 默认是"还没跑过"（`pending` + 无 executions + 有 assignee）——
 *   那正是质量队建团那一刻的真实形状，也是判据必须能判的那一格。
 */
const governedImpl = (id, reqId, assignee, extra = {}) => ({
  id,
  subject: 'implementation',
  status: 'pending',
  dependencies: [reqId],
  kind: 'implementation',
  assignee,
  objective: 'Implement the approved requirements.',
  acceptance: ['it matches'],
  inScope: ['src/'],
  verify: ['pnpm test'],
  executions: [],
  ...extra,
})

test('臂 9 ★★ requirements：写需求的人也是实现它的人 ⇒ 不许自己盖章（点名同一身份 / 哪条需求 / 哪条实现）', () => {
  /**
   * ★ 判据读的是**被治理的实现**，不是 requirements 自己的 `executions`：
   *   一条 requirements 任务被 pass 的那一刻，它还没有 completed 的 execution
   *   （第一条 completed 就是这一次收口本身）；而它的 `assignee` 会因为
   *   "把 pass 交给另一个身份"而变化 ⇒ 用它当证据会让补救动作自毁。
   */
  const team = stateWith([
    reqTask('t1'),
    governedImpl('t2', 't1', 'dev', {
      status: 'completed',
      executions: [{ at: 1, attempt: 1, status: 'completed', by: 'dev' }],
    }),
  ])
  const result = judgeSelfReview({ team, task: team.tasks[0], reviewerName: 'dev' })
  assert.equal(result.ok, false, '★ 同一身份既写需求又将实现它 ⇒ 必须拒')
  assert.match(result.error ?? '', /dev/, '错误必须点名那个身份')
  assert.match(result.error ?? '', /t1/, '错误必须点名这条 requirements 任务')
  assert.match(result.error ?? '', /t2/, '★ 错误必须点名至少一条被治理的任务（否则读者不知道"哪些活"）')
  assert.match(result.error ?? '', /cannot pass/, '★ 拒的是"通过"，不是"这条任务不许存在"')
  /**
   * ★★★ 措辞臂：必须是 **identity**，不是 **name**。
   *   判的是"同一个身份"，而"同一个名字"会把下一个读到这里的人送去查改名表
   *   —— 那是一条不存在的补救路径。
   */
  assert.match(result.error ?? '', /same identity/, '★ 措辞必须是"the same identity"')
  assert.doesNotMatch(result.error ?? '', /same name/, '★ 不许退化成"the same name"')
})

test('臂 10 ★ 反向半边：盖章的不是那个将要实现它的人 ⇒ 放行（且不带 undecidable）', () => {
  const team = stateWith([
    reqTask('t1'),
    governedImpl('t2', 't1', 'dev', {
      status: 'completed',
      executions: [{ at: 1, attempt: 1, status: 'completed', by: 'dev' }],
    }),
  ])
  const result = judgeSelfReview({ team, task: team.tasks[0], reviewerName: 'rev' })
  assert.equal(result.ok, true, '★ rev 既不写需求也不实现它 ⇒ 这一支必须绿')
  assert.equal(result.undecidable, undefined, '★ 判得了就是判得了，不许挂一个 undecidable')
})

test('臂 11 ★★ 三态：这条 requirements 不治理任何实现 ⇒ 判不了（不许形状像通过）', () => {
  /**
   * ★ "没有对象" ≠ "对象合格"。队里若根本没有依赖它的实现，
   *   这条判据**没有东西可判** —— 它必须说"判不了"，而不是沉默地通过。
   *   ★ 同一个口径在本文件臂 3 里已经钉过（三态不同形），这里是 requirements 那一半。
   */
  const team = stateWith([
    reqTask('t1'),
    /* ★ 一条**不**依赖 t1 的实现：它在队里，但不被这条 requirements 治理。 */
    governedImpl('t9', 't1', 'dev', { id: 't9', dependencies: [] }),
  ])
  const result = judgeSelfReview({ team, task: team.tasks[0], reviewerName: 'dev' })
  assert.equal(result.ok, true, '★ 判不了时不许拒（那会拒掉一条没有问题的需求）')
  assert.equal(typeof result.undecidable, 'string', '★ 判不了必须可读 —— 与"通过"不同形')
  assert.match(result.undecidable ?? '', /governs no implementation/, '★ 理由必须说清"没有对象可判"')
})

/* ── 臂 12：真跑工具 ─────────────────────────────────────────────────────────── */

/**
 * 造一支带 requirements 的队，并把 requirements 推到 `in_progress`。
 *
 * ★ 为什么 requirements 的 assignee 写成调用者（`dev`）：`update_task` 对成员有一道
 *   "任务必须派给你"的检查（`src/tools/update-task.ts:970`），而本臂要证的是
 *   **自审判据**拒了它，不是别的判据拒了它。⇒ 前置状态必须让调用真的走到那一步。
 * ★ 为什么成员 `id` 要写成 `<name>-session`：成员身份是**按会话 id 精确匹配**的
 *   （`participantIdentityOf`），而 `plan.members` 落盘时 id 是空的（尚未 spawn）。
 *   ⇒ 本夹具把 id 补上，才能以 `dev` 的身份真的调一次工具。
 *   ★ 这不是绕过生产逻辑：生产里成员 spawn 之后 id 就是这个值。
 */
async function stagedRequirementsTeam(workspace) {
  const { call } = pluginFixture(workspace)
  await call('agent_teams_create', {
    name: 'ReqTeam',
    approval: 'required',
    plan: {
      shape: 'flat',
      members: [{ name: 'dev' }, { name: 'rev' }],
      tasks: [
        {
          id: 'req',
          subject: 'write the requirements',
          assignee: 'dev',
          kind: 'requirements',
          objective: 'Write the requirements.',
          acceptance: ['they are written and testable'],
        },
        {
          id: 'impl',
          subject: 'do the work',
          assignee: 'dev',
          dependencies: ['req'],
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
  await call('agent_teams_approve', { team_id: 'reqteam', confirmation: 'go' })

  const { writeTeam } = await import('../lib/state.js')
  const root = join(workspace, '.agent-teams')
  const team = readTeamSync(root, 'reqteam')
  for (const member of team.members) member.id = `${member.name}-session`
  const req = team.tasks.find((task) => task.kind === 'requirements')
  /**
   * ★ `pending → completed` 会被状态机拒（`evaluateQualityCompletion`），
   *   而那不是本臂要测的东西 ⇒ 先推到 `in_progress`（= 生产上成员 claim 之后的状态）。
   */
  req.status = 'in_progress'
  await writeTeam(root, team)
  return { call, reqId: req.id, implId: team.tasks.find((task) => task.kind === 'implementation').id }
}

test('臂 12 ★★★ 行为臂：dev 写了需求、又要自己盖 pass ⇒ update_task 当场拒，且盘上没有 verdict=pass', async () => {
  /**
   * ★★ 这是 requirements 那一半**唯一**一条真跑工具、读盘上结果的臂。
   *   源码文本臂能证明"那句判断在文本里"，证不了"它被接在 update_task 上"。
   */
  const workspace = mkdtempSync(join(tmpdir(), 'self-review-req-'))
  cleanups.push(workspace)
  const { reqId, implId } = await stagedRequirementsTeam(workspace)

  /**
   * ★ 调用者是 `dev`（成员身份），**不是** captain：
   *   一个 captain 去盖 requirements 的 pass 需要先把任务 reassign 给自己，
   *   而那样一来"谁写了需求"这件事会被那次 reassign 改掉 —— 本臂要证的是
   *   dev 的 patch 会撞上判据，所以用 dev 的身份直接调。
   */
  const { call } = pluginFixture(workspace, 'dev-session')
  await assert.rejects(
    () => call('agent_teams_update_task', { task_id: reqId, status: 'completed', verdict: 'pass' }),
    (error) => {
      assert.match(String(error.message), /self-review is not allowed/, '★ 必须由自审判据拒，不是别的')
      assert.match(String(error.message), new RegExp(implId), '★ 错误必须点名那条被治理的实现')
      assert.match(String(error.message), /same identity/, '★ 而措辞说的是同一身份')
      return true
    },
  )

  /* ★ 盘上**不许**留下 `verdict=pass`：拒斥发生在赋值之前，不是"记了再撤"。 */
  const after = readTeamSync(join(workspace, '.agent-teams'), 'reqteam')
  const record = after.tasks.find((task) => task.id === reqId)
  assert.notEqual(record?.verdict, 'pass', '★ 被拒的判决不许落盘')
  assert.notEqual(record?.status, 'completed', '★ 状态也不许落盘成 completed')

  /**
   * ── 反向半边：换一个**不会实现**它的身份 ⇒ 自审判据不拦 ────────────────────────
   *
   * ★ 用 captain：它不在被治理任务的 assignee 里，也不是 `dev`。
   *   生产上 captain 接管一条 pending 任务要先 reassign —— 本夹具直接改盘把 assignee
   *   交给 captain（与 `markImplCompletedBy` 同一种处置，理由也同源：前置状态由谁造无关）。
   * ★ 断言的是"错误里**不含**自审的措辞"，而不是"这次调用必须成功"：
   *   它仍可能因**别的**判据失败（例如契约/证据），而那正是"本条判据没有误伤"的读数。
   */
  const { writeTeam } = await import('../lib/state.js')
  const root = join(workspace, '.agent-teams')
  const team = readTeamSync(root, 'reqteam')
  const req = team.tasks.find((task) => task.id === reqId)
  req.assignee = 'captain'
  await writeTeam(root, team)

  const captainCall = pluginFixture(workspace).call
  try {
    await captainCall('agent_teams_update_task', { task_id: reqId, status: 'completed', verdict: 'pass' })
  } catch (error) {
    assert.doesNotMatch(String(error.message), /self-review is not allowed/,
      '★ dev 写需求、captain 盖章 —— 自审判据不许拦这条路')
  }
})

/* ── 臂 13：定向突变（真的执行；`pnpm build` 实测约 6 秒，所以它可以跑）────────── */

/**
 * ★★★ 本仓的收口纪律是**串行**（`pnpm build` 会先清 `lib/`），所以这一条由环境变量
 *   显式开启，默认跳过 —— 与 `scripts/friction-triage.test.mjs` 的写法同源。
 *
 * 突变：requirements 那一支**直接返回 `{ ok: true }`**（= 本任务修之前的行为）。
 * 期望：臂 9 的输入不再被拒（`ok === true`），而其余各臂的输入不变。
 *
 * ★ 为什么不是"改一句 if 让它恒假"：那样两种突变读数同形，而本臂要证的是
 *   **"requirements 被放走"这一件具体的事**。
 * ★ 为什么真的重建 `lib/`：本文件的臂全部 import `../lib/*.js` —— 只改 `src/`
 *   的话突变**从来没有被读到**，而报告会读作"突变没打红"（方向恰好相反）。
 *   ★ 那正是 `gate-admission-checkpoint` 里记过的那种事故，故这里一并重建。
 */
function withMutatedGate(mutatedSource, body) {
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const restore = () => {
    writeFileSync(GATE_SOURCE, original)
    const rebuilt = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(rebuilt.status, 0, `★ 还原之后必须能重新 build 成功:\n${rebuilt.stdout}\n${rebuilt.stderr}`)
    assert.equal(readFileSync(GATE_SOURCE, 'utf8'), original, '★ 源码必须逐字节还原（不是"差不多")')
  }
  try {
    writeFileSync(GATE_SOURCE, mutatedSource)
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(built.status, 0, `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是判据）:\n${built.stdout}\n${built.stderr}`)
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

test('★★★ 臂 13 定向突变：requirements 支退回"恒通过" ⇒ 臂 9 的输入必须重新被放行', async (t) => {
  if (process.env.AGENT_TEAMS_SELF_REVIEW_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_SELF_REVIEW_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  /**
   * 针脚 = requirements 那一支**唯一那条拒斥**（`ok: false` 那个返回对象）。
   *
   * ★★★ 为什么不是一行 `if (kind === 'requirements') {`：本文件里那个只写
   *   `if (...)` 的针脚**实测红过** —— `src/quality-gates.ts` 有**两处**
   *   字面相同的 `if (kind === 'requirements') {`（另一处在
   *   `planQualityFollowUp` 里），于是 `replaceAll` 会同时改到两处，
   *   而其中一处改完**编译不过**。夹具的读数是「突变体必须编译得过」= 断言失败
   *   —— 也就是说，**一次替换打到了不该到的地方**被读成了"突变没生效"，
   *   方向恰好相反。
   *
   * ★★ 而"在分支头插一句 `return { ok: true }`"也**实测红过**（两次，都是 `tsc`）：
   *   ① 直接删掉括号不配对 ⇒ `error TS1128`；
   *   ② 插入无条件 return ⇒ 后面那句 `identities.includes(reviewerName)` 的
   *      **类型收窄失效**（`reviewerName` 退回 `string | undefined`）⇒ `error TS2345`。
   *   ⇒ 两种都不是"突变生效了"，它们是"突变体编不过"。所以本臂的突变是
   *     **只把那一支的拒斥删掉**（`ok: false` 的返回块 → `ok: true`）：
   *     语法完整、类型收窄不变，而**判据的那一句判断真的没了** ——
   *     这正是本任务修之前的行为（非 review 的 kind 一律放行）。
   */
  const NEEDLE = [
    '    if (identities.includes(reviewerName)) {',
    '      return {',
    '        ok: false,',
    '        error: `requirements ${task.id} cannot pass: "${reviewerName}" would also implement `',
    '          + `the work these requirements specify (${governedIds})`',
    "          + ' — the same identity may not approve its own requirements (captain protocol rule 7)',",
    '      }',
    '    }',
  ].join('\n')
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const first = original.indexOf(NEEDLE)
  assert.notEqual(first, -1, '★ 突变针脚必须逐字存在（找不到针脚的突变恒不生效）')
  assert.equal(original.lastIndexOf(NEEDLE), first, '★ 针脚必须**唯一** —— 两处命中会把变异打到别的分支上')
  const mutated = original.replace(
    NEEDLE,
    '    if (identities.includes(reviewerName)) {\n'
      + '      return { ok: true } // MUTANT: the requirements rejection is deleted\n'
      + '    }',
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  const team = stateWith([
    reqTask('t1'),
    governedImpl('t2', 't1', 'dev', {
      status: 'completed',
      executions: [{ at: 1, attempt: 1, status: 'completed', by: 'dev' }],
    }),
  ])
  const baseline = judgeSelfReview({ team, task: team.tasks[0], reviewerName: 'dev' })
  assert.equal(baseline.ok, false, '★ 基线（未突变）必须拒 —— 否则本臂的对照失去意义')

  await withMutatedGate(mutated, async () => {
    /**
     * ★ 走带 cache-busting 的重新 import：顶部那个绑定在**文件加载时**就解析完了，
     *   突变体在它上面不可见 ⇒ 会读成"突变没生效"，方向恰好相反。
     */
    const mutant = await import(`../lib/quality-gates.js?mutation=requirements-unconditional`)
    const verdict = mutant.judgeSelfReview({ team, task: team.tasks[0], reviewerName: 'dev' })
    assert.equal(verdict.ok, true, '★ 突变体把 requirements 放过了 —— 臂 9 就是靠这一条变红的')
    assert.equal(verdict.error, undefined, '★ 而且它不再给出任何拒斥理由')
  })

  const restored = await import(`../lib/quality-gates.js?mutation=restored`)
  assert.equal(
    restored.judgeSelfReview({ team, task: team.tasks[0], reviewerName: 'dev' }).ok,
    false,
    '★ 还原之后必须重新拒 —— 否则被突变的 lib 被留在了盘上',
  )
})
