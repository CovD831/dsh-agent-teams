/**
 * ── ★★★ 模型必须能**中止**一个队 —— 而不是只能删掉它（R12.3 的第三件）──────────────
 *
 * ── 这个文件抓的是什么 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-22，对 17 个工具逐个数）：
 *
 * ```
 * agent_teams_halt     : false
 * agent_teams_discard  : false
 * agent_teams_resume   : true   ← 能清"超轮"的计划环（要非空理由），但清不了一个运行中的队
 * agent_teams_delete   : true   ← 能停，但它**归档**：不可逆，且任务状态一并进归档
 * ```
 *
 * ⇒ `haltTeamWork` **早就在生产上跑**（`src/index.ts:467` 的 Web 路由在调它，
 *   `scripts/lifecycle-verify.mjs` 也在验它），而**模型侧一个入口都没有**。
 *   这与 §12 的第三条判据逐字对应：**「一个存在于循环执行者手里的终止动作」**。
 *
 * ── ★★★ 本工具与 `delete` 的**语义分界**（这是本文件最要紧的一段）────────────────
 *
 * ```
 * delete  ：结束 + **归档**。member 全部 removed、attempt 全部失效、目录搬进 archive。
 *           ⇒ 不可逆。用途是"这件事完了"或"明确放弃"。
 * halt    ：**停下、但保留可恢复**。任务被 cancel（不是 remove）、成员回 idle、
 *           团队仍在原处、`resume` 能把它拉回来。用途是"先别跑了"。
 * ```
 * ★ 所以两者**不能合成一个**：一个能撤回、一个不能 —— 合成之后
 *   "我停一下"与"我不要了"在读数和后果上都同形（本仓记账最久的形态）。
 *
 * ── ★★ 为什么它必须**captain-only** ──────────────────────────────────────────────
 *
 * 一个成员能停掉整队 ⇒ 任何一个成员的误判都能让全队停工，而它的补救动作
 * （队长 resume）需要队长**恰好**醒着。⇒ 与 `delete` / `resume` / `approve` 同一条准入面。
 *
 * ── 本文件钉住的四件事 ────────────────────────────────────────────────────────────
 *
 * ```
 * 臂 1  工具**存在**且是 captain-only（成员看不见它）
 * 臂 2  真的走工具入口：staged 队 ⇒ halted，任务被 cancel 而**不是**被 remove
 * 臂 3  ★ 与 delete 的**语义分界**：halt 之后团队**还在**、resume 能拉回来
 * 臂 4  ★ 反向半边：非队长调用 ⇒ 拒绝，且**团队状态一个字节都不变**
 * 臂 5  ★ 反向半边：已经 halted 的队再 halt ⇒ `already_halted`，不重复 cancel
 * ```
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { TEAM_TOOL_NAMES, MEMBER_TOOL_NAMES } = await import(join(ROOT, 'lib', 'tool-names.js'))
const { createTeamDir, readTeam, writeTeam } = await import(join(ROOT, 'lib', 'state.js'))

/**
 * ── 一个**最小的**宿主 ctx 桩 ────────────────────────────────────────────────────
 *
 * ★ `haltTeamWork` 会调 `stopTeamMemberActivations` ⇒ `drainMemberChildren(ctx.subagents, …)`。
 *   真宿主上那是"关准入 + 清队列 + 等后代"，而本夹具要测的是**状态落盘**那一段。
 *   ⇒ 桩里给一个**记录调用**的 `drainChildren`：这样"排空被请求过"本身也变成可断言的事
 *     （臂 2 断言它被调用过一次），而不是"桩把它吞掉了"。
 *
 * ★★ 反面：若桩里写成 `drainChildren: () => {}` 而不记录，那么
 *   "排空发生了"与"排空被跳过"在这条臂上同形 —— 而那正是本仓记账最久的形态。
 */
function hostStub() {
  const drained = []
  return {
    drained,
    ctx: {
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
      on: () => () => {},
      effect: () => () => {},
      subagents: {
        drainChildren: async (parent, ids) => { drained.push({ parent: parent.id, ids: [...ids] }) },
      },
    },
  }
}

/** 一个会记录 cancel 的队长桩。 */
function captainStub(workspace, id = 'captain-session') {
  const cancels = []
  return {
    cancels,
    captain: {
      id,
      session: { header: { cwd: workspace } },
      cancel: (cause, options) => { cancels.push({ cause, options }) },
    },
  }
}

/** 一个临时工作区 + 一个真实落盘的团队。 */
async function workspaceWithTeam(t, patch = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'halt-tool-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    name: 'halt-demo',
    id: 'halt-demo',
    description: 'halt tool probe',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: 2,
    phase: 'running',
    members: [{ id: 'member-1', name: 'worker', role: 'engineer', joinedAt: 1, status: 'working' }],
    tasks: [
      /**
       * ★ 三个必填格（`isTeamTask` 逐字要求，缺一个就让 `readTeam` 判**整份状态非法**）：
       *   `dependencies`（数组）· `createdAt` / `updatedAt`（有限数）。
       * ★★ 夹具少格会让"夹具形状错"与"产品坏了"同形 —— 那正是本轮在修的那类合流。
       */
      { id: 't1', subject: 'first', assignee: 'worker', status: 'claimed', attempt: 1, attemptId: 'a1', dependencies: [], createdAt: 1, updatedAt: 1 },
      { id: 't2', subject: 'second', assignee: 'worker', status: 'pending', attempt: 0, dependencies: [], createdAt: 1, updatedAt: 1 },
      { id: 't3', subject: 'done', assignee: 'worker', status: 'completed', attempt: 1, dependencies: [], createdAt: 1, updatedAt: 1 },
    ],
    ...patch,
  })
  return { workspace, stateRoot }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：工具存在，且是 captain-only
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 1：`agent_teams_halt` 已注册，且**不在**成员工具面里（captain-only）', () => {
  assert.ok(
    TEAM_TOOL_NAMES.includes('agent_teams_halt'),
    '★★ 模型侧没有 halt ⇒ 它只能 delete（不可逆）。§12 (iii) 要的正是"循环执行者手里的终止动作"。',
  )
  assert.ok(
    !MEMBER_TOOL_NAMES.includes('agent_teams_halt'),
    '★★ 成员不能停整队 —— 一个成员的误判不该让全队停工，而补救要队长恰好醒着。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：halt 与 delete 的语义分界 —— 任务 cancel vs remove
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 2：halt 之后任务被 **cancel**（不是 remove），成员回 idle，团队**仍在**', async (t) => {
  const { stateRoot } = await workspaceWithTeam(t)
  const { haltTeamWork } = await import(join(ROOT, 'lib', 'tools.js'))
  const { ctx, drained } = hostStub()
  const { captain } = captainStub(join(stateRoot, '..'))
  const result = await haltTeamWork({
    ctx,
    stateRoot,
    teamId: 'halt-demo',
    captain,
    signal: new AbortController().signal,
  })
  assert.equal(drained.length, 1, '★ 排空必须被**真的请求过**一次（桩记录它，而不是吞掉它）')
  assert.deepEqual(drained[0].ids, ['member-1'], '★ 排空的是那个成员，不是空数组')
  assert.equal(result.alreadyHalted, false)
  assert.equal(result.cancelledTasks, 2, '★ 两个未终结任务（claimed + pending）应当被 cancel；completed 的那个不动')

  const after = await readTeam(stateRoot, 'halt-demo')
  assert.ok(after !== undefined, '★★ halt **不**归档团队 —— 归档是 delete 的事')
  assert.equal(after.halted, true)
  assert.equal(after.tasks.find((task) => task.id === 't1').status, 'cancelled')
  assert.equal(after.tasks.find((task) => task.id === 't2').status, 'cancelled')
  assert.equal(after.tasks.find((task) => task.id === 't3').status, 'completed', '★ 已完成的不动')
  assert.equal(
    after.members.find((member) => member.name === 'worker').status, 'idle',
    '★ 成员回 idle（不是 removed —— removed 是 delete 的事）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ halt 之后 **resume 能拉回来**（这是它与 delete 的核心区别）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 3：halt ⇒ `resume` 能把它拉回运行态（delete 做不到这件事）', async (t) => {
  const { stateRoot } = await workspaceWithTeam(t)
  const { haltTeamWork } = await import(join(ROOT, 'lib', 'tools.js'))
  const { resumeTeamState } = await import(join(ROOT, 'lib', 'quality-gates.js'))
  const { ctx } = hostStub()
  const { captain } = captainStub(join(stateRoot, '..'))
  await haltTeamWork({
    ctx, stateRoot, teamId: 'halt-demo', captain, signal: new AbortController().signal,
  })

  const halted = await readTeam(stateRoot, 'halt-demo')
  const resumed = resumeTeamState(halted, '同事说可以继续了')
  assert.equal(resumed.status, 'resumed', '★★ halt 是**可撤回**的 —— 否则它与 delete 同形，两个工具不该并存')
  assert.equal(resumed.team.halted, false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：反向半边 —— 非队长调用必须拒绝
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 4（反向半边）：非队长 halt ⇒ 拒绝，且团队状态**一个字节都没变**', async (t) => {
  const { stateRoot } = await workspaceWithTeam(t)
  const { haltTeamWork } = await import(join(ROOT, 'lib', 'tools.js'))
  const before = await readFile(join(stateRoot, 'halt-demo', 'team.json'), 'utf8')
  const { ctx, drained } = hostStub()
  const { captain } = captainStub(join(stateRoot, '..'), 'someone-else')
  await assert.rejects(
    () => haltTeamWork({ ctx, stateRoot, teamId: 'halt-demo', captain, signal: new AbortController().signal }),
    /only the captain/i,
  )
  assert.equal(drained.length, 0, '★★ 被拒绝的调用**连排空都不许发起** —— 否则它已经动手了，只是没写盘')
  const after = await readFile(join(stateRoot, 'halt-demo', 'team.json'), 'utf8')
  assert.equal(after, before, '★★ 被拒绝的调用不许留下任何副作用（半截写入是本仓记账过的形态）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：反向半边 —— 重复 halt 不重复 cancel
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 5（反向半边）：已经 halted 的队再 halt ⇒ `already_halted`，且任务数不再增长', async (t) => {
  const { stateRoot } = await workspaceWithTeam(t)
  const { haltTeamWork } = await import(join(ROOT, 'lib', 'tools.js'))
  const { ctx } = hostStub()
  const { captain } = captainStub(join(stateRoot, '..'))
  const input = { ctx, stateRoot, teamId: 'halt-demo', captain, signal: new AbortController().signal }
  const first = await haltTeamWork(input)
  const second = await haltTeamWork(input)
  assert.equal(first.alreadyHalted, false)
  assert.equal(second.alreadyHalted, true, '★ 第二次必须如实说"已经停了"，而不是假装又停了一次')
  assert.equal(second.cancelledTasks, first.cancelledTasks, '★ 不许把已经 cancel 的再数一遍')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：`halted` 必须压过 `approved`（与 §14 的顺序臂同源，但这一条走的是真数据）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 6：halt 之后 `describePlanLoop` 读成 halted，**不是** approved', async (t) => {
  const { stateRoot } = await workspaceWithTeam(t)
  const { haltTeamWork } = await import(join(ROOT, 'lib', 'tools.js'))
  const { describePlanLoop } = await import(join(ROOT, 'lib', 'quality-gates.js'))
  const { ctx } = hostStub()
  const { captain } = captainStub(join(stateRoot, '..'))
  await haltTeamWork({
    ctx, stateRoot, teamId: 'halt-demo', captain, signal: new AbortController().signal,
  })
  const after = await readTeam(stateRoot, 'halt-demo')
  assert.equal(describePlanLoop(after).state, 'halted', '★★ 一个被 halt 的 running 队不是 approved')
})
