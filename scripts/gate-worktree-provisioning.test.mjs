/**
 * ── ★★★ t24：依赖按需注入的【接线】—— 候选不是清单，而排除必须带理由 ─────────────
 *
 * ── 本文件钉的是什么（以及【不】钉什么）────────────────────────────────────────
 *
 *   被测的**不是** `provisionWorktreeDependencies` 的语义（复制而非软链那条是
 *   一个有理由的决定，t24 边界：不改它），而是**那一格接线**：
 *
 *     ① 调度器建完 worktree 之后、派发之前，**真的去注入了**
 *     ② 注入的集合来自 `missingIgnored`（唯一来源），而它是**候选**
 *     ③ 候选里那些**不该进 worktree 的**被排除，**且说得出理由**
 *     ④ 三态不同形：注成了 / 没注成（指名 + 为什么）/ 没需要注
 *
 * ── ★★ 为什么"候选 ≠ 清单"（MEASURED，t24，captain 工作区实测）─────────────────
 *
 * `missingIgnored` 恰好交出这四个：
 *
 *     .DS_Store        12K
 *     .agent-teams    4.7G   ← ★ 本仓自己的运行时状态，且它内含**所有 worktree**
 *     .pnpm-store     1.1G   ← 共享包仓
 *     node_modules    1.6G   ← 唯一真正该注入的那一件
 *     ─────────────────────
 *     合计            ~6.9G/棵      而当时磁盘可用仅 **8.2G**
 *
 * ⇒ ★ **照 `missingIgnored` 原样接上去会立刻爆盘** —— 而它逐条看都说得通：
 *   一个"把缺的补上"的循环。**合起来**是自我复制 + 撑爆磁盘。
 *   ⇒ 所以"注入集合必须先被验证"是一条**必需**的纪律，不是谨慎。
 *
 * ── ★★ 为什么排除必须【带理由】（不是静默 filter）──────────────────────────────
 *
 *   静默 filter 之后，「我决定不注入它」与「它不在候选里」**在读数上同形** ——
 *   于是"排除清单写错了"永远不会被发现。这个形状与本队记账过的那条同源。
 *
 * ── ★ 定向突变（打红本文件的几条路）────────────────────────────────────────────
 *
 *   a) 不过滤直接复制（`entries: created.missingIgnored`）⇒ 臂 2 / 臂 3 红
 *   b) 静默过滤（把 `.agent-teams` 从结果里删掉而不产生 excluded 理由）⇒ 臂 3 红
 *   c) 把注入点挪到**建树之前** ⇒ 臂 1 红（那时 created.path 还不存在）
 *   d) 把排除清单整个删掉（默认全注入）⇒ 臂 2 / 臂 3 红
 *   e) 默认排除（改成白名单，只放行 node_modules）⇒ 臂 5 红
 *
 * Run: node --test scripts/gate-worktree-provisioning.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { planDependencyInjection } from '../lib/scheduler.js'
import { createTaskWorktree, provisionWorktreeDependencies } from '../lib/worktree.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 一个真的 git 仓库，带一个 gitignore 的顶层条目 —— 与 gate-worktree-arrival 同构。 */
function makeRepo() {
  const repo = track(mkdtempSync(join(tmpdir(), 't24-repo-')))
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 't@t'])
  git(repo, ['config', 'user.name', 't'])
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.agent-teams/\n.pnpm-store/\n')
  writeFileSync(join(repo, 'README.md'), 'x\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'init'])
  mkdirSync(join(repo, 'node_modules'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'pkg.txt'), 'dep\n')
  mkdirSync(join(repo, '.agent-teams'), { recursive: true })
  writeFileSync(join(repo, '.agent-teams', 'team.json'), '{}\n')
  mkdirSync(join(repo, '.pnpm-store'), { recursive: true })
  writeFileSync(join(repo, '.pnpm-store', 'blob'), 'x\n')
  return repo
}

// ── 臂 1 ★★★ 规划器：候选里的危险条目被排除，而 node_modules 留下 ────────────────
test('臂 1 ★★★ 规划器：候选 ⇒ 清单 —— node_modules 留下，运行时状态与共享仓被排除', () => {
  const plan = planDependencyInjection(['.DS_Store', '.agent-teams', '.pnpm-store', 'node_modules'])

  assert.deepEqual(plan.injected, ['node_modules'],
    '★★ 只有 node_modules（1.6G）该被注入。'
    + '★ 而 .agent-teams（4.7G）与 .pnpm-store（1.1G）必须被排除 ——'
    + '照候选原样注入合计 ~6.9G/棵，而磁盘可用仅 8.2G ⇒ 会立刻爆盘。')

  const excludedNames = plan.excluded.map(item => item.entry).sort()
  assert.deepEqual(excludedNames, ['.DS_Store', '.agent-teams', '.pnpm-store'],
    '★ 三件都必须在 excluded 里现身 —— 静默丢掉会让"我决定不注入"与"它不在候选里"同形。')
})

// ── 臂 2 ★★★ 排除必须【带理由】，且理由要指名到那件事 ────────────────────────────
test('臂 2 ★★★ 排除项带【可读的理由】—— 不是静默 filter，且理由指名那件东西', () => {
  const plan = planDependencyInjection(['.agent-teams', '.pnpm-store', 'node_modules'])

  assert.equal(plan.excluded.length, 2, '★ 两件被排除，逐条带理由')
  for (const item of plan.excluded) {
    assert.equal(typeof item.reason, 'string', `★ ${item.entry} 必须带一条理由`)
    assert.ok(item.reason.trim().length > 0, `★ ${item.entry} 的理由不得为空`)
    /** ★ 理由里必须出现该条目自己的名字 —— 否则它不可归因（"哪一条被排除了"读不出来）。 */
    assert.match(item.reason, /refused:/u,
      `★ ${item.entry} 的理由必须以 refused: 开头（与其余读数同一形状）`)
  }

  /** ★ 而 .agent-teams 那条理由必须说出【为什么】——它是自我复制，不是"太大了"。 */
  const agentTeams = plan.excluded.find(item => item.entry === '.agent-teams')
  assert.ok(agentTeams !== undefined, '★ .agent-teams 必须在排除清单里')
  assert.match(agentTeams.reason, /runtime state|self-replication|contains every worktree/iu,
    '★★ 它的理由必须说清【自我复制 / 运行时状态 / 内含所有 worktree】这一件事实 ——'
    + '而"太大了"不是理由（大不是不该注入的原因；被写穿与自我复制才是）。')
})

// ── 臂 3 ★★★ 静默过滤会被打红：excluded 不许为空 ────────────────────────────────
test('臂 3 ★★★ 反向半边：若把危险条目静默丢弃（excluded 空）⇒ 本条与臂 1 一起红', () => {
  const plan = planDependencyInjection(['.agent-teams', '.pnpm-store', 'node_modules'])

  /**
   * ★ 这一条钉的是【读数本身】：一个"只保留 node_modules"的实现（静默 filter）
   *   会给出同样的 `injected`，而 `excluded` 为空 —— 那时"我排除了它"与
   *   "它从来不在候选里"不可分。
   */
  assert.ok(plan.excluded.length > 0,
    '★★★ `excluded` 不许为空：一个静默 filter 会给出同样的 injected 而没有 excluded，'
    + '于是"我决定不注入它"与"它不在候选里"在读数上同形 —— 排除清单写错了永远不会被发现。')
  assert.equal(plan.injected.length + plan.excluded.length,
    new Set(['.agent-teams', '.pnpm-store', 'node_modules']).size,
    '★ 候选里的每一条都必须落进 injected 或 excluded 之一（不许有第三种去向 = 静默丢弃）')
})

// ── 臂 4 ★★ 默认注入：候选里的新条目不认识 ⇒ 试图注入（不是静默排除）──────────────
test('臂 4 ★★ 默认注入（不是默认排除）：候选里出现新条目 ⇒ 它进 injected', () => {
  const plan = planDependencyInjection(['node_modules', 'some-new-dep'])

  assert.deepEqual(plan.injected, ['node_modules', 'some-new-dep'],
    '★★ 默认必须是"注入"：一个"默认排除"的白名单会让下一个依赖【静默地不在 worktree 里】——'
    + '而那正是本机制要消灭的失败（成员因缺依赖失败，却读成"工作没做出来"）。')
  assert.deepEqual(plan.excluded, [], '★ 不认识的新条目不该被排除')
})

// ── 臂 5 ★★★ 端到端：建树之后 node_modules 真的在场 ─────────────────────────────
test('臂 5 ★★★ 端到端（接线臂）：建 worktree ⇒ 按规划注入 ⇒ node_modules 真在场', () => {
  const repo = makeRepo()
  const created = createTaskWorktree({ repo, taskId: 'task-t24-e2e' })
  assert.equal(created.ok, true, `★ 前置：worktree 建得起来（${created.ok === true ? '' : created.reason}）`)

  /** ★ 候选由 `createTaskWorktree` 给出（唯一来源）—— 本文件不另读 .gitignore。 */
  assert.ok(Array.isArray(created.missingIgnored), '★ 候选必须是 createTaskWorktree 的产物')

  /**
   * ★★★ 顺序臂：注入点必须在【建树之后】。
   *   本臂在 `created.path` 存在之后才注入 —— 而"接在建树之前"会让
   *   worktree 参数不存在（见文件头突变 c）。
   */
  assert.equal(existsSync(created.path), true, '★★ 注入之前 worktree 必须已经存在（否则接错位置）')

  const plan = planDependencyInjection(created.missingIgnored)
  const result = provisionWorktreeDependencies({
    repo, worktree: created.path, entries: plan.injected,
  })

  /** ★ 真的在场：不是"复制被调用了"，而是那个文件读得到。 */
  const provisioned = join(created.path, 'node_modules', 'pkg.txt')
  assert.equal(existsSync(provisioned), true,
    '★★★ 注入之后 node_modules 必须在【隔离检出里】真的存在（读得到内容，不是"调用过"）。'
    + `\n    copied=${JSON.stringify(result.copied)} failed=${JSON.stringify(result.failed)}`)
  assert.equal(readFileSync(provisioned, 'utf8'), 'dep\n', '★ 而内容必须真的来自源')

  /** ★ 而危险条目必须【没有】被复制进去。 */
  assert.equal(existsSync(join(created.path, '.agent-teams')), false,
    '★★ .agent-teams 绝不能被复制进 worktree（那是自我复制：它内含所有 worktree）')
  assert.equal(existsSync(join(created.path, '.pnpm-store')), false,
    '★★ .pnpm-store 绝不能被复制进 worktree（共享包仓，注入无意义）')

  /** ★ 复制品是【独立 inode】：两个检出真的互不影响（软链那条约定的落点）。 */
  const copiedStat = statSync(provisioned)
  const sourceStat = statSync(join(repo, 'node_modules', 'pkg.txt'))
  assert.notEqual(copiedStat.ino, sourceStat.ino,
    '★ 必须是复制品而不是软链：inode 不同 ⇒ worktree 里的写入不会穿到主检出')
})

// ── 臂 6 ★★ 三态不同形：注成了 / 没注成 / 没需要注 ──────────────────────────────
test('臂 6 ★★ 三态不同形：copied 非空 / failed 非空 / 两者皆空 —— 三种读数分得开', () => {
  const repo = makeRepo()

  /** ① 注成了。 */
  const created = createTaskWorktree({ repo, taskId: 'task-t24-tristate' })
  assert.equal(created.ok, true)
  const done = provisionWorktreeDependencies({
    repo, worktree: created.path, entries: ['node_modules'],
  })
  assert.deepEqual(done.copied, ['node_modules'], '① 注成了 ⇒ copied 非空')
  assert.deepEqual(done.failed, [], '① 而 failed 必须为空')

  /** ② 没注成：源不存在 ⇒ failed 里【指名 + 为什么】，而 copied 为空。 */
  const missing = provisionWorktreeDependencies({
    repo, worktree: created.path, entries: ['never-existed'],
  })
  assert.deepEqual(missing.copied, [], '② 没注成 ⇒ copied 为空')
  assert.equal(missing.failed.length, 1, '② 而 failed 必须非空（不许静默）')
  assert.equal(missing.failed[0].entry, 'never-existed', '★ 必须【指名】是哪一件')
  assert.ok(missing.failed[0].reason.trim().length > 0, '★ 必须【说出为什么】')

  /** ★ 两态不同形：① 的 failed 为空而 ② 的 failed 非空 —— 读得出是哪一种。 */
  assert.notDeepEqual(done.failed, missing.failed, '★ ①与②必须不同形')

  /** ③ 没需要注：entries 为空 ⇒ 两处都空（"没发生什么"本身是一条读数）。 */
  const nothing = provisionWorktreeDependencies({ repo, worktree: created.path, entries: [] })
  assert.deepEqual(nothing.copied, [], '③ 没需要注 ⇒ copied 为空')
  assert.deepEqual(nothing.failed, [], '③ 而 failed 也为空 —— 与②不同形')
  assert.notDeepEqual(nothing.failed, missing.failed, '★ ②与③必须不同形（没注成 ≠ 没需要注）')
})

// ── 臂 7 ★★ 幂等：已经在了 ⇒ 跳过复制，但它【不是】"没发生什么" ────────────────
test('臂 7 ★★ 已存在 ⇒ 跳过复制并留下读数（不复制 ≠ 没发生什么）', () => {
  const repo = makeRepo()
  const created = createTaskWorktree({ repo, taskId: 'task-t24-idem' })
  assert.equal(created.ok, true)

  const first = provisionWorktreeDependencies({ repo, worktree: created.path, entries: ['node_modules'] })
  assert.deepEqual(first.copied, ['node_modules'], '★ 前置：第一次真的复制了')

  const second = provisionWorktreeDependencies({ repo, worktree: created.path, entries: ['node_modules'] })
  assert.deepEqual(second.copied, ['node_modules'],
    '★★ 第二次必须【仍然把它报在 copied 里】—— 它是"这一件已经就位"，'
    + '而那与"这一件没被处理"不同形。一个空数组会让重试读成"什么都没做"。')
  assert.deepEqual(second.failed, [], '★ 而它不是失败')
})

// ── 臂 8 ★★ 排除清单可检：出现 4.2G 级别的运行时目录时，拒绝并指名它 ─────────────
test('臂 8 ★★ 排除清单可检：候选里出现运行时目录 ⇒ 拒绝并【指名】它', () => {
  /**
   * ★ 这一条是本任务验收第 3 条：**排除清单本身可检**。
   *   做法是拿一个"看起来像运行时状态"的名字进候选，断言它被排除且被指名。
   */
  const plan = planDependencyInjection(['.agent-teams', 'node_modules'])

  const refused = plan.excluded.find(item => item.entry === '.agent-teams')
  assert.ok(refused !== undefined,
    '★★ 候选里出现 .agent-teams（本仓运行时状态，4.7G 级）⇒ 必须拒绝并【指名】它。'
    + '★ 而"指名"是与"静默过滤"的分界线：读日志的人要能回答"哪一件没被注入、为什么"。')
  assert.equal(plan.injected.includes('.agent-teams'), false, '★ 它不得出现在注入清单里')
})

// ── 臂 10 ★★★ C 的半边：provision【不】检测错的目标 ⇒ 顺序只能由接线保证 ────────
test('臂 10 ★★★ C 的半边：对一个不存在的目标注入 ⇒ 它会报成功（所以顺序是接线的责任）', () => {
  /**
   * ★★★ MEASURED（t24）：把注入接到**建树之前**时，`worktree` 那一格不存在 ——
   *   而 `provisionWorktreeDependencies` **不会**告诉你这件事：
   *
   *     provisionWorktreeDependencies({ repo, worktree: '/tmp/<不存在>', entries: ['node_modules'] })
   *     ⇒ copied: ['node_modules'], failed: []
   *
   *   ★ 原因：它 `mkdirSync(dirname(target), { recursive: true })` —— 于是它
   *     **顺手把那个路径造出来**，然后如实报告"复制成功"。
   *
   * ⇒ ★★ 所以"注入点必须在建树之后"这一条**不能**由 provision 自己保证 ——
   *   它只能由**接线**保证（见臂 5 的顺序断言）。
   *   ★ 而本臂把这件事变成一条读数：**一个错的目标会以成功的形状返回。**
   *     那正是"位置接错了"与"位置对了"在读数上同形的那种形态。
   */
  const repo = makeRepo()
  const bogusTarget = join(track(mkdtempSync(join(tmpdir(), 't24-bogus-'))), 'never-created-by-a-worktree')

  assert.equal(existsSync(bogusTarget), false, '★ 前置：这个目标确实不存在')

  const result = provisionWorktreeDependencies({ repo, worktree: bogusTarget, entries: ['node_modules'] })

  assert.deepEqual(result.failed, [],
    '★★ 关键读数：它**不报错** —— provision 不检测"这棵树还没被建"')
  assert.deepEqual(result.copied, ['node_modules'],
    '★★ 而它报"复制成功"。⇒ 一个接错位置的注入看起来完全正常，'
    + '所以顺序必须由接线（臂 5）钉住，不能指望 provision 自己发现。')
})

// ── 臂 9 ★★ 不许另读 .gitignore：候选让"要注入什么"有唯一来源 ────────────────────
test('臂 9 ★★ 唯一来源：规划器的输入就是候选，它不读盘、不读 .gitignore', () => {
  /**
   * ★ 本臂钉的是**纯度**：同一个输入两次给出同一个结果，且与仓库内容无关。
   *   若规划器去读 `.gitignore`，那么两棵内容不同的仓库会给同一个候选不同的结论 ——
   *   而"要复制什么"就有两个来源了（本任务边界明说：不许另读）。
   */
  const a = planDependencyInjection(['node_modules', '.agent-teams'])
  const b = planDependencyInjection(['node_modules', '.agent-teams'])
  assert.deepEqual(a, b, '★ 规划器必须是纯函数 —— 同一个候选给出同一个结论')

  /** ★ 而它也不该受"这个条目在盘上到底存不存在"影响（那是 provision 的事）。 */
  const c = planDependencyInjection(['nonexistent-thing'])
  assert.deepEqual(c.injected, ['nonexistent-thing'],
    '★ 规划器不判断存在性：它只做"候选 ⇒ 该注入的清单"这一步；'
    + '存在性由 provisionWorktreeDependencies 报进 failed（两件事不同形）。')

  /** ★ 而输入数组不许被就地改动（调用方还会用那份候选）。 */
  const input = ['node_modules', '.agent-teams']
  const frozen = [...input]
  planDependencyInjection(input)
  assert.deepEqual(input, frozen, '★ 不许就地改调用方的数组')
})
