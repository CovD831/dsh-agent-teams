/**
 * ── 「隔离能力」与「隔离裁决」的分界：三臂夹具 ──────────────────────────────────
 *
 * 契约要求每条机制自带三臂（`docs/GATE-REGISTRY.md` §6）。这里测的不是一条判据，
 * 而是【调度层面对"建不出 worktree"的两种处置】—— 而它们的区别不是措辞、
 * 是后果。
 *
 *   臂 1（伪造臂）：把"这个仓库根本不支持隔离"当成"这次建失败"
 *                   ⇒ 期望被识别为 **unsupported**（不是 failed）
 *   臂 2（未测量臂）：是 git 仓库但没有提交 ⇒ 期望 **unsupported:false**
 *                     ★ 它与臂 1 必须【不同形】—— 一个是环境、一个是异常
 *   臂 3（对照臂）：正常 git 仓库 ⇒ ok，且 base 是真实提交
 *
 * ── 它防的是什么失效（MEASURED，2026-10-05）────────────────────────────────────
 *
 * 拒绝派发的分支此前对**所有**失败原因一视同仁。于是非 git 仓库里：
 *
 *     createTaskWorktree ⇒ {ok:false, reason:'not a git repository'}
 *       ⇒ 拒绝派发 ⇒ 任务回 pending、成员回 idle
 *       ⇒ `agent/status` 的 idle 边再踢一次 ⇒ 再拒绝 ⇒ ★ 无限循环，任务永久卡死
 *
 * 用户在非 git 项目里用 AgentTeams，**每一个 implementation/repair 任务都会
 * 永久卡死**，而只有一条 warn 说原因。
 *
 * ★ 为什么"降级"不是"放宽"：隔离是【能力】不是【裁决】。没有能力时该做的是
 *   如实说没有、让成员干活，并让依赖父版本的判据拿到"我测不了"而不是"通过"。
 *   于是"未隔离"必须留下痕迹 —— 一次 warn 不是一条记录。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectWorktreeSupport, createTaskWorktree } from '../lib/worktree.js'
import { assignmentPrompt } from '../lib/scheduler.js'

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 一个真的是 git 仓库、但【一个提交都没有】的目录。 */
function makeEmptyRepo() {
  const root = track(mkdtempSync(join(tmpdir(), 'wt-empty-')))
  git(root, ['init', '-q', '.'])
  return root
}

/** 一个正常的 git 仓库（有一个提交）。 */
function makeRepo() {
  const root = track(mkdtempSync(join(tmpdir(), 'wt-ok-')))
  git(root, ['init', '-q', '.'])
  git(root, ['config', 'user.email', 'probe@test'])
  git(root, ['config', 'user.name', 'probe'])
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'init'])
  return root
}

/** 一个【不是】git 仓库的普通目录。 */
function makeNonRepo() {
  return track(mkdtempSync(join(tmpdir(), 'wt-nonrepo-')))
}

/** 收窄助手：把"期望哪一种"写进断言本身。 */
function expectUnsupported(value) {
  if (value.ok !== false || value.unsupported !== true) {
    throw new Error(`expected an unsupported refusal, got ${JSON.stringify(value)}`)
  }
  return value
}
function expectFailed(value) {
  if (value.ok !== false || value.unsupported === true) {
    throw new Error(`expected a "could not build it" refusal (unsupported must NOT be true), got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * ── 有一个最小团队/任务用于提示行断言 ─────────────────────────────────────────
 */
const team = { name: 'demo', id: 'demo', description: 'goal', captainSessionId: 'c', createdAt: 0, members: [], tasks: [], taskSeq: 0 }
const member = { name: 'worker', id: 'm', joinedAt: 0, status: 'idle' }

function ticket(extra) {
  return {
    taskId: 't1', memberName: 'worker', memberId: 'm', attempt: 1, attemptId: 'a',
    recoveredOwned: false, subject: 'Work', dependencyOutputs: [], kind: 'implementation',
    ...extra,
  }
}

test('臂 1 ★ 伪造臂：不是 git 仓库 ⇒ unsupported:true（它不是"这次没成"，是"这里根本没有"）', () => {
  const support = expectUnsupported(detectWorktreeSupport(makeNonRepo()))
  assert.match(support.reason, /not a git repository/)
  /**
   * ★ 这一条是全部修复的支点：调度层靠 `unsupported` 决定"降级"还是"拒绝"。
   *   如果它退化成 false/undefined，非 git 项目里的任务会重新开始永久卡死。
   */
  assert.equal(support.unsupported, true)
  // createTaskWorktree 必须把同一个判别【透传】出去（它在内部先调 detect）
  assert.equal(expectUnsupported(createTaskWorktree({ repo: makeNonRepo(), taskId: 't1' })).unsupported, true)
})

test('臂 2 ★ 未测量臂：是 git 仓库但没有提交 ⇒ unsupported 必须不是 true（与臂 1 不同形）', () => {
  const refusal = expectFailed(detectWorktreeSupport(makeEmptyRepo()))
  assert.match(refusal.reason, /no commit/)
  /**
   * ★ 这条臂的存在就是为了让"环境不支持"与"环境坏了"不同形。
   *   把两者混起来，非 git 仓库里的任务会被无限重试（永久卡死），
   *   而没有提交的仓库会被静默降级（本该拒绝的真异常被放过）。
   */
  assert.equal(refusal.unsupported, false)
  assert.equal(expectFailed(createTaskWorktree({ repo: makeEmptyRepo(), taskId: 't2' })).unsupported, false)
})

test('臂 3 ★ 对照臂：正常仓库 ⇒ ok，且 base 是真实提交（判别没有误伤能力正常的仓库）', () => {
  const repo = makeRepo()
  const support = detectWorktreeSupport(repo)
  assert.equal(support.ok, true)
  assert.match(support.base, /^[0-9a-f]{7,40}$/)
  const created = createTaskWorktree({ repo, taskId: 't3' })
  assert.equal(created.ok, true)
  track(created.path)
})

test('臂 3b ★ 对照臂：降级派发的提示必须【明说】没有隔离，而不是沉默或伪造一个目录', () => {
  const reason = 'not a git repository (fatal: not a git repository)'
  const prompt = assignmentPrompt(ticket({ worktreeUnavailable: reason }), '.agent-teams', 'demo')
  assert.match(prompt, /No isolated worktree:/, '★ 降级必须留下痕迹 —— 沉默会让成员以为自己在隔离检出里')
  assert.match(prompt, /not a git repository/, '★ 必须带上原因（读提示的人要能判断这是环境，不是这一步不需要）')
  assert.match(prompt, /could not be measured|will be reported as such|passed\.$|as passing/m, '★ 必须说清依赖父版本的判据在这里测不了，而不是让成员以为照常')
  assert.equal(
    /Working directory:/.test(prompt),
    false,
    '★ 绝不伪造一个工作目录指令 —— 那会让成员以为有隔离，而实际正和全队共用目录',
  )
})

test('臂 3c ★ 对照臂：有隔离 / 不需要隔离 / 无隔离 是【三种形状】，不可合并', () => {
  const withWorktree = assignmentPrompt(ticket({ worktreePath: '/tmp/wt/t1' }), '.agent-teams', 'demo')
  const readOnlyTask = assignmentPrompt(ticket({ kind: 'review' }), '.agent-teams', 'demo')
  const degraded = assignmentPrompt(ticket({ worktreeUnavailable: 'not a git repository' }), '.agent-teams', 'demo')

  assert.match(withWorktree, /Working directory: \/tmp\/wt\/t1/, '有隔离 ⇒ 给出目录')
  assert.equal(/Working directory:/.test(degraded), false, '无隔离 ⇒ 不给目录')
  assert.equal(
    /No isolated worktree:/.test(readOnlyTask),
    false,
    '★ 「这一步不需要隔离」不许带上"没有隔离"的记录 —— 否则 review 任务会被读成一个环境问题',
  )
  /**
   * ★ 三者的可分辨性就是这条臂的内容：把任意两者合并，读提示的人（或依赖父版本
   *   的判据）就无法区分"环境不支持"与"这一步不涉及"。
   */
  assert.notEqual(withWorktree, degraded)
  assert.notEqual(degraded, readOnlyTask)
})
