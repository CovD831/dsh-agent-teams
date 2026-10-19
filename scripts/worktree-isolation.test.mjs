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
import { dirname, join } from 'node:path'
import { createTaskWorktree, worktreePromptLine, detectWorktreeSupport, resolveWorktreeBaseline, describeBaseline } from '../lib/worktree.js'

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

// ── ★★★ t5：建树基线 —— 正向半边与反向半边，各自一个可复跑的读数 ──────────────
//
// `docs/WORKTREE-BASE-DEFECT.md`：依赖边只表达**顺序**，不表达**可见性** ⇒ 下游
// 在旧代码上干活，写域重叠时整文件覆盖上游的修复（实测 63.8% 的边重叠、50% 的
// 上游真的提交了）。
//
// ★ 这一组必须**成对**看：
//     · 正向 —— 有边 ⇒ 下游的树里**看得见**上游的提交；
//     · 反向 —— 没边 ⇒ 下游的树里**看不见**它（而这不是 bug，是"它们之间没有边"）。
//   只测正向会让"给所有树都塞上全部提交"也通过 —— 那会毁掉并行成员的独立性。

/** 在仓库里提交一个新文件，返回该提交的完整 sha。 */
function commitFile(repo, path, content, message) {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), content)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', message])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

/** `git merge-base --is-ancestor <commit> HEAD` 退出码 0 与否 —— 就是那条验收读数。 */
function isAncestorOfHead(worktree, commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: worktree, stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/** 同一读数，但第二个参数是**给定**的 commit（用于断言夹具前提，而不是断言产物）。 */
function isAncestorOfCommit(cwd, maybeAncestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', maybeAncestor, descendant], {
      cwd, stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

test('★★ 正向半边（t5）：上游有 deliverableCommit ⇒ 下游的树里【看得见】它', () => {
  const repo = track(makeRepo())
  /**
   * ★ 关键构造（第一版写错过，记在这里）：上游的产物必须**从主干到达不了**。
   *
   *   第一版把提交直接落在主干上，于是 `trunk == upstreamCommit` ——
   *   "看得见上游"这件事即使**完全不看基线**也成立，那条臂测的是恒真命题。
   *   改成"在 side 分支上提交、再切回主干"之后，看见了就**只可能**来自基线这一格：
   *   按旧口径（永远取主树 HEAD）建出来的树里**没有** `src/upstream.ts`。
   */
  const trunkHead = git(repo, ['rev-parse', 'HEAD']).trim()
  git(repo, ['checkout', '-q', '-b', 'upstream-work'])
  const upstreamCommit = commitFile(repo, 'src/upstream.ts', 'export const fromUpstream = 1\n', 'upstream work')
  git(repo, ['checkout', '-q', '-'])
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), trunkHead, '★ 主干停在原地')
  assert.equal(
    isAncestorOfCommit(repo, upstreamCommit, trunkHead), false,
    '★★ 前提：上游的产物【不】在主干的历史里 —— 否则"看得见"证明不了任何事',
  )

  const created = expectOk(createTaskWorktree({
    repo,
    taskId: 't-downstream',
    upstream: [{ taskId: 't-upstream', deliverableCommit: upstreamCommit }],
  }))
  track(created.path)

  assert.equal(created.baseline.source, 'upstream', '★ 基线的出处必须是 upstream，不是 trunk')
  assert.equal(created.baseline.base, upstreamCommit, '★ 基线就是那条上游产物（不是主树 HEAD）')
  assert.equal(
    isAncestorOfHead(created.path, upstreamCommit), true,
    '★★ 验收读数：git -C <worktree> merge-base --is-ancestor <upstream-commit> HEAD 必须退出 0',
  )
  assert.ok(
    existsSync(join(created.path, 'src', 'upstream.ts')),
    '★ 上游产出的文件必须真的在这棵树里（内容可见，不只是 sha 代数）',
  )
})

test('★★ 反向半边（t5）：没有依赖边 ⇒ 下游的树【看不见】它，且基线仍为主树 HEAD', () => {
  const repo = track(makeRepo())
  /**
   * ★ 这一格是**反向半边**的全部要害：上游的产物必须**不在主干上**。
   *
   *   第一版把提交直接落在主干上，于是"看不见"当场是假的（主树 HEAD 本来就含它）
   *   —— 那一版若通过，通过的将是一条**恒真**的判据。造一个 side 分支提交，
   *   才能让"看见了"只可能来自基线这一格。
   */
  const trunkHead = git(repo, ['rev-parse', 'HEAD']).trim()
  git(repo, ['checkout', '-q', '-b', 'parallel'])
  const parallelCommit = commitFile(repo, 'src/parallel.ts', 'export const parallel = 1\n', 'parallel work')
  git(repo, ['checkout', '-q', '-'])
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), trunkHead,
    '★ 主干必须【没有】往前走 —— 否则这条臂又在测恒真命题')
  assert.notEqual(parallelCommit, trunkHead)

  /**
   * ★ 这里**不**给 `upstream` —— 也就是"两条并行的任务之间没有边"。
   *   它与上一条臂的输入只差这一格，而期望**相反**。差别正是"可见性由边决定"。
   */
  const created = expectOk(createTaskWorktree({ repo, taskId: 't-parallel' }))
  track(created.path)

  assert.equal(created.baseline.source, 'trunk', '★ 没有边 ⇒ 基线是主树 HEAD（不是"随便挑一条上游"）')
  assert.deepEqual(created.baseline.upstream, [], '★ 没有边 ⇒ 逐条读数就是空数组，不是"有边但读不到"')
  assert.equal(
    isAncestorOfHead(created.path, parallelCommit), false,
    '★★ 反向读数：并行的那棵树里【不该】看得见彼此的产物 —— 否则"全都塞进去"也会通过正向臂',
  )
  assert.equal(
    existsSync(join(created.path, 'src', 'parallel.ts')), false,
    '★ 看不见就是真的看不见（文件层面也断言一次，防止 sha 代数与内容脱节）',
  )

  /**
   * ★★ 同一个仓库、同一个提交，只要**有那条边** ⇒ 立刻看得见。
   *   这一对比才是"判据不是恒真/恒假"的证明：两次输入只差 `upstream` 这一格。
   */
  const withEdge = expectOk(createTaskWorktree({
    repo,
    taskId: 't-now-visible',
    upstream: [{ taskId: 't-parallel', deliverableCommit: parallelCommit }],
  }))
  track(withEdge.path)
  assert.equal(isAncestorOfHead(withEdge.path, parallelCommit), true,
    '★★ 对照读数：加上那条边之后，同一个提交就看得见了 —— 两个读数只差一格输入')
})

test('★★ 三态（t5）：上游已提交 / 没提交 / 读不到 —— 三者必须不同形', () => {
  const repo = track(makeRepo())
  const committed = commitFile(repo, 'src/a.ts', 'export const a = 1\n', 'a')
  const resolution = resolveWorktreeBaseline({
    repo,
    trunk: git(repo, ['rev-parse', 'HEAD']).trim(),
    upstream: [
      { taskId: 't-committed', deliverableCommit: committed },
      { taskId: 't-not-committed' },
      { taskId: 't-gone', deliverableCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
      { taskId: 't-missing-record', unreadable: 'it is not in this team any more' },
    ],
  })

  assert.deepEqual(
    resolution.upstream.map(entry => [entry.taskId, entry.kind]),
    [
      ['t-committed', 'committed'],
      ['t-not-committed', 'not-committed'],
      ['t-gone', 'unreadable'],
      ['t-missing-record', 'unreadable'],
    ],
    '★ 逐条三态：四种输入各归其位（"声称有产物但解析不出"不许并进"没提交"）',
  )
  const gone = resolution.upstream.find(entry => entry.taskId === 't-gone')
  assert.match(gone.why, /does not resolve/, '★ 读不到必须带原因，而不是只说"读不到"')

  /**
   * ★ 措辞也要不同形：三件事在日志里必须读得出是哪一种。把"上游没提交"与
   *   "上游的产物读不到"写成同一句话，等于把一次**要人查**的状态伪装成正常。
   */
  const prose = describeBaseline({
    ...resolution,
    upstream: [{ taskId: 't-committed', kind: 'committed', commit: committed }],
    diverged: [],
  })
  assert.match(prose, /baseline is upstream deliverable/, '★ 已提交：说清是哪一条产物')

  const nothingProse = describeBaseline({
    repo, base: resolution.trunk, source: 'trunk', trunk: resolution.trunk,
    upstream: [{ taskId: 't-not-committed', kind: 'not-committed' }], diverged: [],
  })
  assert.match(nothingProse, /none of them has a readable deliverable commit/,
    '★ 没提交：说"没有可读的产物"——不是"上游看不见"')

  const unreadableProse = describeBaseline({
    repo, base: resolution.trunk, source: 'trunk', trunk: resolution.trunk,
    upstream: [{ taskId: 't-gone', kind: 'unreadable', why: 'the object is gone' }], diverged: [],
  })
  assert.match(unreadableProse, /unreadable: t-gone \(the object is gone\)/,
    '★ 读不到：必须指名是哪一条 + 为什么（这一句是三种措辞里唯一要人动手的）')

  /**
   * ★ 再钉一次"没有依赖边"与"有边但没提交"**不同形** —— 两者都是 `source:'trunk'`，
   *   若措辞也相同，读的人会以为后者是设计如此。
   */
  const noEdges = describeBaseline({
    repo, base: resolution.trunk, source: 'trunk', trunk: resolution.trunk, upstream: [], diverged: [],
  })
  assert.match(noEdges, /no upstream dependency/, '★ 没有边：说"这条任务没有上游依赖"')
  assert.notEqual(noEdges, nothingProse, '★★ 两者措辞必须不同 —— 否则"没依赖"与"上游没产出"在读数上同形')
})

test('★★ 复用已有树（t5 反向半边）：不重新对齐，且读数说得出"这不是我选的"', () => {
  const repo = track(makeRepo())
  const staleHead = git(repo, ['rev-parse', 'HEAD']).trim()
  const first = expectOk(createTaskWorktree({ repo, taskId: 't-reused' }))
  track(first.path)

  /**
   * 树建好之后，上游才提交 —— 而 `createTaskWorktree` 的复用分支**不**重新对齐
   * （`docs/WORKTREE-BASE-DEFECT.md` 补充段实测过：mtime 证明不了树里有提交）。
   */
  const laterCommit = commitFile(repo, 'src/later.ts', 'export const later = 1\n', 'later work')

  const second = expectOk(createTaskWorktree({
    repo,
    taskId: 't-reused',
    upstream: [{ taskId: 't-later', deliverableCommit: laterCommit }],
  }))

  assert.equal(second.path, first.path, '★ 复用同一棵树（不是又建一棵）')
  assert.equal(
    second.baseline.source, 'existing',
    '★★ 读数必须说"这棵树本来就在"，而不是假装刚刚按上游对齐过',
  )
  assert.equal(second.base, staleHead, '★ base 是**实际** HEAD（旧的那一格），不是算出来的理想基线')
  assert.equal(
    isAncestorOfHead(second.path, laterCommit), false,
    '★★ 反向读数：复用一棵旧树时，后来的上游提交**仍然**看不见 —— 而它现在读得出来（diverged）',
  )
  assert.deepEqual(
    second.baseline.diverged.map(entry => entry.taskId), ['t-later'],
    '★ 看不见的那条必须被指名 —— 不许让"没重新对齐"变成一次静默',
  )
})

test('★★ 多条上游真分叉（t5）：基线只能是其中一条，其余必须被【指名】为不可见', () => {
  /**
   * ── 真实语料读数（本队 9 个团队目录）──────────────────────────────────────────
   *
   * 下游有 ≥2 条 committed 上游的情形：6 例，其中 **6 例都是真分叉** ——
   * 没有任何一条上游的提交包含其余全部（`agent-teams-hardening t9 ← t6,t8` 等）。
   *
   * ★ 也就是说：**单 commit 基线在这种情况下结构上不可能包含全部上游**。
   *   这里是本任务的边界，不是可以糊过去的地方 ⇒ 选一条，其余逐条列进 `diverged`，
   *   措辞明说"从这条基线上看不见它们"。★ 把它们并进"看得见"才是最坏的做法：
   *   下游会以为自己拿到了 t8 的改动而实际上没有。
   *
   * ★★ 剩下那一半（把分叉的上游真正合起来）需要**集成者**角色 —— 那是 t16，
   *   不在本任务范围。本臂钉的是"分叉**不许静默**"。
   */
  const repo = track(makeRepo())
  const trunkHead = git(repo, ['rev-parse', 'HEAD']).trim()
  git(repo, ['checkout', '-q', '-b', 'left'])
  const leftCommit = commitFile(repo, 'src/left.ts', 'export const left = 1\n', 'left')
  git(repo, ['checkout', '-q', '-'])
  git(repo, ['checkout', '-q', '-b', 'right'])
  const rightCommit = commitFile(repo, 'src/right.ts', 'export const right = 1\n', 'right')
  git(repo, ['checkout', '-q', '-'])

  assert.equal(isAncestorOfCommit(repo, leftCommit, rightCommit), false, '★ 夹具前提：两者真分叉')
  assert.equal(isAncestorOfCommit(repo, rightCommit, leftCommit), false)
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), trunkHead, '★ 主干不含任何一条')

  const resolution = resolveWorktreeBaseline({
    repo, trunk: trunkHead,
    upstream: [
      { taskId: 't-left', deliverableCommit: leftCommit },
      { taskId: 't-right', deliverableCommit: rightCommit },
    ],
  })

  assert.equal(resolution.source, 'upstream', '★ 有可用产物 ⇒ 基线来自上游')
  assert.ok(
    [leftCommit, rightCommit].includes(resolution.base),
    '★ 基线必须是**其中一条**上游的完整 commit（不是主干，也不是编出来的）',
  )
  const loser = resolution.base === leftCommit ? 't-right' : 't-left'
  const loserCommit = resolution.base === leftCommit ? rightCommit : leftCommit
  assert.deepEqual(
    resolution.diverged.map(entry => entry.taskId), [loser],
    '★★ 另一条必须被【指名】—— 静默丢掉它，下游就会以为自己有它的改动',
  )
  assert.equal(
    isAncestorOfCommit(repo, loserCommit, resolution.base), false,
    '★ 而被指名的那条**确实**从基线上到达不了（这是读数，不是我猜的）',
  )

  /**
   * ★ 措辞必须把"看不见"说出来。一句"基线：abc1234"会把这件事整个抹掉。
   */
  const prose = describeBaseline(resolution)
  assert.match(prose, /NOT visible from that baseline \(diverged history\)/,
    '★★ 分叉必须在读数里出现 —— 否则"分叉"与"没分叉"在日志上同形')
  assert.ok(prose.includes(loser), '★ 并且要指名是哪一条')

  /**
   * ★★ 真正建出来的树里也断言一次：看不见就是看不见（内容层），
   *    与读数里的 `diverged` 一致。
   */
  const created = expectOk(createTaskWorktree({
    repo, taskId: 't-forked',
    upstream: [
      { taskId: 't-left', deliverableCommit: leftCommit },
      { taskId: 't-right', deliverableCommit: rightCommit },
    ],
  }))
  track(created.path)
  const loserFile = resolution.base === leftCommit ? 'src/right.ts' : 'src/left.ts'
  assert.equal(
    existsSync(join(created.path, loserFile)), false,
    '★★ 内容层再钉一次：被指名不可见的那条，它的文件**真的**不在这棵树里',
  )
})

test('★★ 多条上游成链（t5）：必须选【包含全部】的那条，不许选最早那条', () => {
  /**
   * ── 这条臂守的是"修了一半"的形态 ──────────────────────────────────────────────
   *
   * 两条上游成**链**（`t-late` 的提交是 `t-early` 的后代）。若基线按"最早"选，
   * 下游拿到的是 `t-early` —— `t-late` 的改动**不在**里面，而读数照样说
   * "基线是上游"。那与本任务要修的那个缺陷同形，只是换了一层皮。
   *
   * ★ 真实语料里 6 个多方上游的情形全是**真分叉**（见下一条臂），所以这条分支
   *   在今天的语料上不触发 —— 正因如此它更需要一条臂：没有臂，将来真出现链时
   *   丢掉的会是**上游的提交**，且没有任何读数会说话。
   */
  const repo = track(makeRepo())
  const trunkHead = git(repo, ['rev-parse', 'HEAD']).trim()
  git(repo, ['checkout', '-q', '-b', 'chained'])
  const earlyCommit = commitFile(repo, 'src/early.ts', 'export const early = 1\n', 'early work')
  const lateCommit = commitFile(repo, 'src/late.ts', 'export const late = 1\n', 'late work')
  git(repo, ['checkout', '-q', '-'])

  assert.equal(isAncestorOfCommit(repo, earlyCommit, lateCommit), true,
    '★ 夹具前提：这是**链**，不是分叉')
  assert.equal(isAncestorOfCommit(repo, lateCommit, earlyCommit), false)
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), trunkHead, '★ 主干不含任何一条')

  /**
   * ★ 入参顺序刻意把**早的放前面**：若实现选"第一条 / 最早那条"，它就会中招。
   *   这条臂因此区分得开"选最早"与"选包含全部"。
   */
  const resolution = resolveWorktreeBaseline({
    repo, trunk: trunkHead,
    upstream: [
      { taskId: 't-early', deliverableCommit: earlyCommit },
      { taskId: 't-late', deliverableCommit: lateCommit },
    ],
  })

  assert.equal(resolution.source, 'upstream')
  assert.equal(resolution.base, lateCommit,
    '★★ 必须选**包含全部**的那条（晚的），而不是最早那条 —— 否则下游看不见 t-late 的提交')
  assert.deepEqual([...resolution.diverged], [],
    '★ 链的情形没有"看不见的上游"：全部可达 ⇒ diverged 必须为空（不是把祖先列进去凑数）')

  /**
   * ★★ 内容层再钉一次：**两条**上游的文件都必须真的在这棵树里。
   *    只看 sha 代数会漏掉"基线对了但树建错了"。
   */
  const created = expectOk(createTaskWorktree({
    repo, taskId: 't-chained',
    upstream: [
      { taskId: 't-early', deliverableCommit: earlyCommit },
      { taskId: 't-late', deliverableCommit: lateCommit },
    ],
  }))
  track(created.path)
  assert.equal(existsSync(join(created.path, 'src', 'early.ts')), true, '★ 早的那条的产物也在')
  assert.equal(existsSync(join(created.path, 'src', 'late.ts')), true, '★ 晚的那条的产物在')
})
