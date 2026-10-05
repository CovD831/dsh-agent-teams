/**
 * ── worktree 隔离的三臂夹具 ────────────────────────────────────────────────────
 *
 * 契约要求每条判据/机制自带三臂（`docs/GATE-REGISTRY.md` §6）。
 * 隔离是一套【机制】而不是一条判据，但同一套三臂纪律适用：
 *
 *   臂 1（伪造臂）：成员【没有收到】隔离工作目录，却在共享目录里干活
 *                   ⇒ 期望被识别出来（隔离不成立）
 *   臂 2（未测量臂）：拿不到 git 仓库 / 不能建 worktree
 *                     ⇒ 期望"隔不了"，且与"不需要隔离"不同形
 *   臂 3（对照臂）：正常仓库 ⇒ worktree 建得起来、路径对、干扰被挡住
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05，本机复现）：`assignmentPrompt` 里【没有任何工作目录指令】
 * —— 成员不知道也没被要求去一个隔离的地方干活，全队挤在队长的工作区里。
 *
 * ⇒ R5（红前绿后）需要"一个可 checkout 的父版本"，而那只能来自 git 历史；
 *   会话事件（`meta.diffs`）给的是 `{path, oldText, newText}`，
 *   是【一次编辑的前后文本】，拼不出可信的父版本。
 *   ⇒ 归属（已由 dispatch.changed-paths 解决）与版本（本夹具）是两件事。
 *
 * ── 已实测的 worktree 能力边界（不是猜的）──────────────────────────────────────
 *
 *   ① 同一分支不能检出到两个 worktree ⇒ 并行成员必须用 --detach
 *   ② 新 worktree 是【干净的 HEAD】⇒ 主工作区未提交的改动不会带过去
 *      （这正是 R5 要的"父版本"，但也意味着成员看不到队长未提交的工作）
 *   ③ worktree 里【没有】gitignore 的文件（如 node_modules）
 *      ⇒ 在里面直接跑 pnpm test 会因缺依赖失败，必须处理
 *   ④ worktree 里的写入对主工作区【完全隔离】
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTaskWorktree, worktreePromptLine, detectWorktreeSupport } from '../lib/worktree.js'

/** 收窄助手：把"期望哪一种结果"写进断言本身。 */
function expectOk(value) {
  if (value.ok !== true) throw new Error(`expected ok, got ${JSON.stringify(value)}`)
  return value
}
function expectRefused(value) {
  if (value.ok !== false) throw new Error(`expected a refusal, got ${JSON.stringify(value)}`)
  return value
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 造一个最小但真实的 git 仓库（带 gitignore 与一个已提交文件）。 */
function makeRepo({ withGitignore = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wt-repo-'))
  git(root, ['init', '-q', '.'])
  git(root, ['config', 'user.email', 'probe@test'])
  git(root, ['config', 'user.name', 'probe'])
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'parser.ts'), 'export const parse = () => null\n')
  if (withGitignore) writeFileSync(join(root, '.gitignore'), 'node_modules\n*.log\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'init'])
  return root
}

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

test('★ 对照臂：正常仓库 ⇒ worktree 建得起来，且是一个真实目录', () => {
  const repo = track(makeRepo())
  const result = expectOk(createTaskWorktree({ repo, taskId: 't1' }))
  track(result.path)
  assert.ok(existsSync(result.path), '★ worktree 目录必须真的存在')
  assert.ok(existsSync(join(result.path, 'src', 'parser.ts')), '★ 必须含有该提交的文件')
})

test('★ 对照臂：worktree 是干净的 HEAD（父版本可用）', () => {
  const repo = track(makeRepo())
  // 主工作区留一个未提交改动
  writeFileSync(join(repo, 'src', 'parser.ts'), 'export const parse = () => []  // uncommitted\n')
  const result = expectOk(createTaskWorktree({ repo, taskId: 't2' }))
  track(result.path)
  const inside = readFileSync(join(result.path, 'src', 'parser.ts'), 'utf8')
  assert.ok(!inside.includes('uncommitted'), '★ 未提交的改动【不得】带进 worktree（这正是"父版本"）')
})

test('★ 已实测边界③：worktree 里没有 gitignore 的文件 ⇒ 必须能看出并处理', () => {
  const repo = track(makeRepo())
  mkdirSync(join(repo, 'node_modules'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'x.js'), 'dep\n')
  const result = expectOk(createTaskWorktree({ repo, taskId: 't3' }))
  track(result.path)
  assert.equal(existsSync(join(result.path, 'node_modules')), false, '★ 已知边界：依赖不在 worktree 里')
  assert.deepEqual(result.missingIgnored, ['node_modules'], '★ 必须【报出来】，而不是让成员撞上去才发现')
})

test('★ 已实测边界①：并行任务各建一个 ⇒ 不能因同分支冲突而失败', () => {
  const repo = track(makeRepo())
  const a = expectOk(createTaskWorktree({ repo, taskId: 'ta' }))
  const b = expectOk(createTaskWorktree({ repo, taskId: 'tb' }))
  track(a.path); track(b.path)
  assert.notEqual(a.path, b.path)
  assert.ok(existsSync(a.path) && existsSync(b.path), '★ 两个并行 worktree 必须同时可用')
})

test('★ 隔离性：worktree 里的写入不影响主工作区', () => {
  const repo = track(makeRepo())
  const result = expectOk(createTaskWorktree({ repo, taskId: 't4' }))
  track(result.path)
  writeFileSync(join(result.path, 'src', 'parser.ts'), 'export const parse = () => []\n')
  const inRepo = readFileSync(join(repo, 'src', 'parser.ts'), 'utf8')
  assert.ok(inRepo.includes('null'), '★ 主工作区必须【没变】')
})

test('臂 2 ★ 未测量臂：不是 git 仓库 ⇒ 拒绝，且说清"隔不了"（不是"不需要"）', () => {
  const notRepo = track(mkdtempSync(join(tmpdir(), 'wt-norepo-')))
  const result = expectRefused(createTaskWorktree({ repo: notRepo, taskId: 't5' }))
  assert.match(result.reason, /not a git repository|git/i)
  assert.equal(result.reason.includes('not needed'), false, '★ "隔不了"与"不需要"必须不同形')
})

test('臂 2b ★ 未测量臂：仓库没有任何提交 ⇒ 拒绝（没有可作父版本的 HEAD）', () => {
  const empty = track(mkdtempSync(join(tmpdir(), 'wt-empty-')))
  git(empty, ['init', '-q', '.'])
  const result = expectRefused(createTaskWorktree({ repo: empty, taskId: 't6' }))
  assert.match(result.reason, /commit|HEAD/i)
})

test('臂 1 ★ 提示行：把工作目录写进派发文本（成员否则无从知道）', () => {
  const line = worktreePromptLine('/tmp/wt/task-t1')
  assert.match(line, /\/tmp\/wt\/task-t1/, '★ 必须含绝对路径')
  assert.match(line, /working directory|cwd/i, '★ 必须说清这是"在哪干活"')
})

test('臂 1b ★ 提示行：不给路径时【不】产出伪造的指令', () => {
  assert.equal(worktreePromptLine(undefined), '', '★ 没有隔离就不能假装有')
  assert.equal(worktreePromptLine(''), '')
})

test('检测支持：非 git 仓库时 support 为 false 且带原因', () => {
  const notRepo = track(mkdtempSync(join(tmpdir(), 'wt-sup-')))
  const support = detectWorktreeSupport(notRepo)
  assert.equal(support.ok, false)
  assert.ok(typeof support.reason === 'string' && support.reason.length > 0)
})

// ── ★ 接线臂：隔离必须【真的】出现在派发提示里 ────────────────────────────────
// 模块本身正确 ≠ 隔离生效。上一轮的教训：判据接不进去就等于没装。

test('★ 接线臂：assignmentPrompt 带上工作目录与缺依赖提示', async () => {
  const { assignmentPrompt } = await import('../lib/scheduler.js')
  const base = {
    taskId: 't1', memberName: 'builder', memberId: 'm1', attempt: 1, attemptId: 'a1',
    subject: '实现解析器', kind: 'implementation', dependencyOutputs: [],
    objective: '让 parser 接受空输入', inScope: ['src/parser.ts'], verify: ['pnpm test'],
  }
  const withWt = assignmentPrompt({ ...base, worktreePath: '/tmp/wt/task-t1', worktreeMissingIgnored: ['node_modules'] }, '.agent-teams', 'team-1')
  assert.match(withWt, /\/tmp\/wt\/task-t1/, '★ 成员必须看到自己的目录')
  assert.match(withWt, /node_modules/, '★ 缺依赖必须明说，否则环境问题会被误报成工作失败')
  const without = assignmentPrompt(base, '.agent-teams', 'team-1')
  assert.equal(without.includes('/tmp/wt/task-t1'), false, '★ 没有隔离就不能假装有')
})

test('★ 接线臂：没有隔离时，提示里【不】出现任何工作目录指令', async () => {
  const { assignmentPrompt } = await import('../lib/scheduler.js')
  const prompt = assignmentPrompt({
    taskId: 't2', memberName: 'builder', memberId: 'm1', attempt: 1, attemptId: 'a2',
    subject: 'x', kind: 'implementation', dependencyOutputs: [],
  }, '.agent-teams', 'team-1')
  assert.equal(/Working directory:/.test(prompt), false)
})
