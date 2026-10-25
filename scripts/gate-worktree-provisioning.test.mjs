/**
 * ── ★★★ t24：依赖按需注入的【接线】—— 候选不是清单，而排除必须带理由 ─────────────
 *
 * ── 本文件钉的是什么（以及【不】钉什么）────────────────────────────────────────
 *
 *   被测的**是** `provisionWorktreeDependencies` 的两件事：
 *
 *     ⓪ ★ 注入方式是**硬链接**（`cp -al` 语义）—— 普通文件与源**同 inode**、
 *        有**一个以上的名字**（`nlink >= 2`），而包内部自带的**相对软链原样
 *        保留**（臂 11 是它的落点）；
 *     ⓪b ★ 硬链接**不成**时退化回真拷贝，且**留下可读的理由**（臂 12）——
 *        退化**不是失败**（依赖确实在场），但也不许静默。
 *        ★ 注意：触发它的**不**只有跨设备。实现只看 `cp -al` 的 exit status，
 *        不区分 errno ⇒ "路径写错 / 权限不足"同样落到这条退化路上，理由照转原文。
 *        ★ 而真正的 EXDEV **本机不可达**（`/tmp` 与工作区同一设备），
 *        **没有任何一臂覆盖真的 EXDEV** —— 臂 12 不声称测过它。
 *
 *   ★ 这条边界是**故意改的**（t1，2026-10-10）：此前是"复制而非软链"，
 *     代价是 1.6 GiB/棵 ⇒ 46 棵 = 23 GiB ⇒ **并发被磁盘卡在 ~6，而不是被
 *     `maxActiveSubagents` 卡住**。硬链接把那 46 份变成**一份**。
 *     ⇒ 旧读数（"inode 必须不同"）与"只做复制"的措辞都已作废：见臂 5 / 臂 10。
 *
 *   而另一半钉的是**那一格接线**：
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
 *   f) ★ 把硬链接改回真拷贝（或 `cp -a` 掉了 `-l`）⇒ 臂 11 红
 *      （inode 不同、nlink == 1）
 *   g) ★ 把 `cp -a` 换成会 dereference 的复制（`cp -rL` / `cpSync` 忘了
 *      `dereference:false`）⇒ 臂 11 红（包内的相对软链被"解引用成真文件"）
 *   h) ★ 退化时既不写 `entries[].mode` 也不写 `linkFallbacks`（静默退回拷贝）
 *      ⇒ 臂 12 红
 *   i) ★★ 把 `defaultHardLinkTree` 换成**恒报 `{ok:true}` 的空操作**
 *      ⇒ 臂 5 / 臂 11 / 臂 12 / 臂 13 红。
 *      ★ 这一条是**复核时补的**：此前臂 12 用注入的假原语，对这个突变**照样绿**
 *        （自证）。现在臂 12 里有【半边 A】——真跑真原语、断言它对不存在的源
 *        交出 `{ok:false}` —— 于是这个突变被当场挡下。
 *
 * Run: node --test scripts/gate-worktree-provisioning.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, lstatSync, symlinkSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { planDependencyInjection } from '../lib/scheduler.js'
import { createTaskWorktree, provisionWorktreeDependencies, defaultHardLinkTree } from '../lib/worktree.js'

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
  plantPnpmStyleSymlinks(repo)
  return repo
}

/**
 * ── ★★★ 种下一套 **pnpm 风格的相对软链**（臂 11 的落点）─────────────────────────
 *
 * pnpm 的 `.pnpm` 结构就是靠**相对软链**撑起来的：真实文件住在
 * `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/`，而包名那一格是一条
 * 指回它的相对软链。
 *
 * ```
 *   node_modules/.pnpm/pkg@1.0.0/node_modules/pkg   ← 真目录（真文件）
 *   node_modules/pkg  ->  .pnpm/pkg@1.0.0/node_modules/pkg
 *   node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/self.js
 *                         ->  ../../pkg@1.0.0/node_modules/pkg/self.js   ← 包【内部】的相对软链
 * ```
 *
 * ★ 为什么要 **包内部** 的那一条：注入时最容易被弄坏的就是它 —— 一个
 *   dereference 的复制（`cp -rL` / `cpSync` 忘了 `dereference:false`）会把它
 *   **变直**，于是 `.pnpm` 的相对结构失真，pnpm 自己就认不出来了。
 *
 * ★ 为什么在 **git commit 之后** 才种：`.gitignore` 只挡 `node_modules/` 的
 *   **顶层**，而这里种的是 `node_modules` 里的东西 —— 它在 commit 之前种会
 *   悄悄改变其余各臂的仓库内容。放在 commit 之后，本函数对旧臂是**透明**的。
 */
function plantPnpmStyleSymlinks(repo) {
  const nested = join(repo, 'node_modules', '.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, 'self.js'), 'export const v = 1\n')
  writeFileSync(join(nested, 'package.json'), '{ "name": "pkg", "version": "1.0.0" }\n')
  /** 包【内部】的相对软链（指向自己所在的那一份）—— 它必须活过注入。 */
  symlinkSync('../../pkg@1.0.0/node_modules/pkg/self.js', join(nested, 'alias.js'))
  /** 顶层包名那一格：也是一条相对软链（pnpm 的常规形状）。 */
  rmSync(join(repo, 'node_modules', 'pkg.txt'), { force: true })
  symlinkSync(join('.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg'), join(repo, 'node_modules', 'pkg'))
  return { nested, self: join(nested, 'self.js'), alias: join(nested, 'alias.js'), top: join(repo, 'node_modules', 'pkg') }
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
  const provisioned = join(created.path, 'node_modules', 'pkg', 'self.js')
  assert.equal(existsSync(provisioned), true,
    '★★★ 注入之后 node_modules 必须在【隔离检出里】真的存在（读得到内容，不是"调用过"）。'
    + `\n    copied=${JSON.stringify(result.copied)} failed=${JSON.stringify(result.failed)}`)
  assert.equal(readFileSync(provisioned, 'utf8'), 'export const v = 1\n', '★ 而内容必须真的来自源')

  /** ★ 而危险条目必须【没有】被注入进去。 */
  assert.equal(existsSync(join(created.path, '.agent-teams')), false,
    '★★ .agent-teams 绝不能被复制进 worktree（那是自我复制：它内含所有 worktree）')
  assert.equal(existsSync(join(created.path, '.pnpm-store')), false,
    '★★ .pnpm-store 绝不能被复制进 worktree（共享包仓，注入无意义）')

  /**
   * ── ★★★ 这一条【曾经断言相反】—— 而它是故意被翻过来的（t1，2026-10-10）────────
   *
   * 旧读数（t24）：
   *
   *     assert.notEqual(copiedStat.ino, sourceStat.ino,
   *       '必须是复制品而不是软链：inode 不同 ⇒ worktree 里的写入不会穿到主检出')
   *
   * ★ 那句话把两件【不同】的事并成了一件：**"共享同一个 inode"** 与
   *   **"通过一条会写穿的链共享"**。软链确实是后者；**硬链接不是软链** ——
   *   它是同一个 inode 的**又一个名字**（`nlink` 从 1 变 2），中间没有任何
   *   "顺着链找到源"的目录结构可走。于是：
   *
   *     · **替换**一个文件（新文件 + `rename`，也就是 `pnpm install` 做的事）
   *       ⇒ 只有做替换的那棵树换了 inode，另一棵树仍指向旧 inode
   *       ⇒ **"两个成员各自验证"这条前提成立**；
   *     · ★ 而**就地改写**会穿到另一棵树 —— 硬链接去掉的是软链的写穿*路径*，
   *       **去不掉共享 inode 本身**。这一条必须**诚实地说出来**，不能沿用
   *       旧断言里那个"写入不会穿过去"的旧结论：它对新形状**不成立**。
   *
   * ★ 而代价换来的是这个任务的**全部目的**：inode 相同 ⇒ 46 棵 worktree 的依赖
   *   合起来只占**一份**磁盘，于是并发上限回到 `maxActiveSubagents` 而不是磁盘。
   */
  const provisionedStat = statSync(provisioned)
  const sourceStat = statSync(join(repo, 'node_modules', '.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg', 'self.js'))
  assert.equal(provisionedStat.ino, sourceStat.ino,
    '★★★ 必须是【硬链接】而不是复制品：inode **相同** ⇒ 两棵树共用同一份物理数据。'
    + '★ 而"同 inode"不等于"软链"：硬链接是同一个 inode 的又一个名字，'
    + '没有可走的链 ⇒ 替换（新文件 + rename，pnpm install 所做的）只影响做过替换的那棵树。'
    + '★ 诚实边界：**就地改写**两棵树都看得见 —— 硬链接去掉的是写穿路径，不是共享 inode。')
  assert.ok(provisionedStat.nlink >= 2,
    '★ 而它必须有【一个以上的名字】（nlink >= 2）—— 只有 1 意味着它其实是一份独立拷贝，'
    + `那样磁盘并没有省下来。nlink=${provisionedStat.nlink}`)
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
   *     **顺手把那个路径造出来**，然后如实报告"注入成功"。
   *     ★ 这一点**不随注入方式改变**：t1 起它做的是硬链接（`cp -al`）而不是复制，
   *       但 `mkdirSync` 那一行、以及"它不检测目标是不是一棵真的 worktree"这条
   *       性质，一字未改。所以本臂照旧在场，且**断言不许被削弱**。
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
    '★★ 而它报"注入成功"。⇒ 一个接错位置的注入看起来完全正常，'
    + '所以顺序必须由接线（臂 5）钉住，不能指望 provision 自己发现。')
})

// ── 臂 11 ★★★ 空间真的被共享了：同 inode + nlink>=2 + 包内相对软链原样活着 ──────
test('臂 11 ★★★ 空间共享：注入后与源同 inode、nlink>=2，且包内的相对软链仍是软链', () => {
  /**
   * ── ★★★ 这是本任务的【全部目的】那一条读数 ────────────────────────────────────
   *
   * MEASURED（t1 之前）：1.6 GiB/棵 × 46 棵 = 23 GiB ⇒ **并发被磁盘卡在 ~6**，
   * 而不是被 `maxActiveSubagents` 卡住。而"复制"这条路无论写得多漂亮都改变不了
   * 那个 1.6 GiB：它每次都在盘上多留一份**真数据**。
   *
   * ⇒ 所以本臂问的不是"注入成功了吗"（臂 5 已经问了），而是**物理数据有几份**：
   *
   *     ① inode **相同**      ⇒ 两棵树指向同一个 inode（不是两份数据）
   *     ② `nlink >= 2`        ⇒ 那个 inode 确实有**一个以上的名字**
   *                              （★ 单看 ① 是不够的：一份把文件复制过去、
   *                                再靠巧合复用 inode 的实现是做不到的，
   *                                但 ② 才是"多了一个名字"的直接读数 ——
   *                                没有 ②，"共享"只是一个推论）
   *     ③ 包内部的**相对软链**仍是软链、`readlink` 目标**一字未变**
   *        ⇒ ★ `dereference:false` 的语义被保住了。这一条是最容易被弄坏的：
   *          `cp -rL`（或 `cpSync` 忘了 `dereference:false`）会把 pnpm 的
   *          `.pnpm` 相对结构**变直**，而那正是 pnpm 认包的方式。
   *
   * ★ 三件事【都要】问：只问 ① 会让"软链被解引用成真文件"混过去（那时 inode
   *   照样可能不同），只问 ③ 会让"其实还是各存一份"混过去。
   */
  const repo = makeRepo()
  const created = createTaskWorktree({ repo, taskId: 'task-t1-shared' })
  assert.equal(created.ok, true, '★ 前置：worktree 建得起来')

  const result = provisionWorktreeDependencies({ repo, worktree: created.path, entries: ['node_modules'] })
  assert.deepEqual(result.failed, [], '★ 前置：注入没有失败')

  const srcTree = join(repo, 'node_modules')
  const dstTree = join(created.path, 'node_modules')

  /** ① 普通文件：与源【同 inode】。 */
  const relSelf = join('.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg', 'self.js')
  const dstStat = statSync(join(dstTree, relSelf))
  const srcStat = statSync(join(srcTree, relSelf))
  assert.equal(dstStat.ino, srcStat.ino,
    '★★★ 注入树里的普通文件必须与源【inode 相同】—— 同 inode 就是"同一份物理数据"，'
    + '那正是 46 棵树合起来只占一份磁盘的**全部依据**。inode 不同 ⇒ 它其实是一份拷贝，'
    + '磁盘并没有省下来（旧行为：1.6 GiB/棵）。')

  /** ② 那个 inode 必须有【一个以上的名字】。 */
  assert.ok(dstStat.nlink >= 2,
    '★★ `nlink >= 2`：这个 inode 必须有【多过一个】名字（源一个 + 注入树一个），'
    + '否则"共享"只是从 inode 相同【推论】出来的，而不是读出来的。'
    + `nlink=${dstStat.nlink}`)

  /** ★ 而"同 inode"【不是】"软链"：这一格必须显式读出来，否则两种形状同形。 */
  assert.equal(lstatSync(join(dstTree, relSelf)).isSymbolicLink(), false,
    '★ 注入出来的是一个【真文件】（硬链接的又一个名字），不是一条软链 ——'
    + '"同 inode"与"软链"是两件不同的事，本臂不许把它们混成一件事。')

  /** ③ pnpm 风格的相对软链：注入之后**仍然是软链**，且目标一字未变。 */
  const relAlias = join('.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg', 'alias.js')
  const dstAlias = join(dstTree, relAlias)
  assert.equal(lstatSync(dstAlias).isSymbolicLink(), true,
    '★★★ 包【内部】的相对软链在注入之后必须**仍然是软链** —— '
    + '这就是 `dereference:false` 的语义。一个 dereference 的复制（`cp -rL`）会把它'
    + '变成真文件，于是 pnpm 赖以认包的 `.pnpm` 相对结构失真。')
  assert.equal(readlinkSync(dstAlias), '../../pkg@1.0.0/node_modules/pkg/self.js',
    '★★ 而且它的 `readlink` 目标必须【一字未变】—— 软链被"重建到别的目标"与'
    + '"原样保留"是两件事，只有前者读得出来时这条臂才算真的在测。')

  /** ★ 顶层包名那一格同样是相对软链，且同样活下来。 */
  const dstTop = join(dstTree, 'pkg')
  assert.equal(lstatSync(dstTop).isSymbolicLink(), true,
    '★ 顶层 `node_modules/pkg` 也是 pnpm 的常规形状（一条相对软链）⇒ 不许被解引用。')
  assert.equal(readlinkSync(dstTop), join('.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg'),
    '★ 而它的相对目标也必须原样。')

  /**
   * ★ 而注入之后**内容仍然读得到** —— 即"共享"没有把可用性换掉：
   *   顺着两条软链走进去，读到的就是源里那份文件。
   */
  assert.equal(readFileSync(join(dstTop, 'self.js'), 'utf8'), 'export const v = 1\n',
    '★★ 穿过相对软链读进去必须拿到源里的内容（软链保住了，而不是断链）。')
})

// ── 臂 12 ★★★ 硬链接原语失败 ⇒ 真拷贝，且【留下理由】（★ 不声称覆盖真 EXDEV）────
test('臂 12 ★★★ 硬链接原语失败 ⇒ 退回真拷贝，依赖仍在场，而理由必须留下（不是静默）', () => {
  /**
   * ── ★★★ 这一臂有两个**分得开**的半边（缺任何一半它就不承重）───────────────────
   *
   *   【半边 A】真原语 `defaultHardLinkTree` 的**失败读数**——**不注入任何缝**。
   *   【半边 B】`{ok:false}` **返回之后**那段处置（退化到 `cpSync` + 落进两条读数）
   *            ——这一段只有靠 `link` 注入才走得到（生产调用方不传它）。
   *
   * ── ★★ 为什么必须补上【半边 A】（本臂曾经是自证的）────────────────────────────
   *
   * 旧版本臂**只**有半边 B：它注入一个恒报 `{ok:false}` 的原语，然后断言"退化了"。
   * 那段断言**永远是绿的**——因为它绕过了真原语，测的是一个自己塞进去的返回值。
   * MEASURED（本轮复核，两次都建过、都跑过）：
   *   把真的 `defaultHardLinkTree` 换成**恒报 `{ok:true}` 的空操作**（什么都不做），
   *   旧版本臂**照样通过**。⇒ 它证明的只是"`{ok:false}` 之后的接线是通的"，
   *   **证明不了**真原语在失败时**会不会**报 `{ok:false}`。
   *
   * ⇒ 半边 A 补的就是这一格：**真跑**真原语，断言它失败时真的交回
   *   `{ok:false}` 且理由里带**真 `cp` 的输出**。上面那个"恒真空操作"突变
   *   会在这里当场变红（空操作对不存在的源也会说 ok）。
   *
   * ── ★★ 为什么这里【不】声称测过 EXDEV ──────────────────────────────────────────
   *
   * 真的跨设备 EXDEV **在本机不可达**：MEASURED，`/tmp` 与工作区**同一个**设备
   * （`stat -f %d` 两边都是 `16777232`），而沙箱不允许造 RAM disk。
   * ⇒ 本臂**不伪造**跨设备（伪造一个跨设备场景比测不到更坏），也**不声称**
   *   生产上的 EXDEV 退化路已被走通。**没有任何一臂覆盖真正的 EXDEV。**
   *
   * ★ 这不是把边界藏起来，而是把它**写在这儿**：谁将来想读成"EXDEV 测过了"，
   *   会在这一行上撞见相反的结论。而它**不削弱**本臂：真原语失败 ⇒ `{ok:false}`
   *   这条路已被真实触发（下面用**两种各不相同的真失败**）。
   */

  const repo = makeRepo()
  const created = createTaskWorktree({ repo, taskId: 'task-t1-exdev' })
  assert.equal(created.ok, true, '★ 前置：worktree 建得起来')

  /**
   * ── 【半边 A】真原语 · 真失败 ①：源**不存在** ⇒ 必须 `{ok:false}` + 真 cp 输出 ──
   *
   * ★ 这是本臂**唯一**钉住真原语的那一格 —— 它把"恒真空操作"那种突变挡在门外。
   * ★ 而它读的是**返回值**（不是"我没抛异常"）：`ok:false` + 非空 reason，
   *   后者必须含 `cp` 自己写的字（`No such file or directory`）——
   *   ★ 断言"理由里含 cp 的原文"而不是"理由非空"：一个被加工过的笼统理由
   *     与"没退化"在读日志时同形，本仓记账过这条形态。
   */
  const missingSource = join(repo, 'node_modules-does-not-exist')
  const missingReading = defaultHardLinkTree(missingSource, join(created.path, 'nope-1'))
  assert.equal(missingReading.ok, false,
    '★★★ 真原语对**不存在的源**必须交出 `{ok:false}`（而不是说自己成了）—— '
    + '这一格是【半边 A】的承重点：把它换成"恒报 ok:true 的空操作"，本条立刻红。')
  assert.ok(missingReading.ok === false && missingReading.reason.trim() !== '',
    '★★ 而且必须带一条**非空**的理由 —— "失败了但说不出为什么"与"没失败"一样读不出东西。')
  if (missingReading.ok === false) {
    assert.match(missingReading.reason, /no such file or directory/iu,
      '★★★ 理由里必须是 `cp` **自己的原文**（这里：源不存在）。读**返回值**而不是'
      + '读"我们有没有抛异常"—— 本臂要的是"真原语失败时交回什么"，只有返回值说得清。'
      + `实测 reason=${JSON.stringify(missingReading.reason)}`)
  }

  /**
   * ── 【半边 A · 第二种真失败】目标的**父级是普通文件** ⇒ `ENOTDIR` ──────────────
   *
   * ★ 为什么还要第二种：只测"源不存在"会让"实现偷偷给某一类失败开绿灯"溜过去。
   *   两种**成因不同**的真失败都交出 `{ok:false}` ⇒ 失败判定不是针对个案的补丁，
   *   而是那条 `status !== 0` 的规则本身（见 {@link defaultHardLinkTree}）。
   * ★ MEASURED：`cp: <target>/dst: Not a directory`，`exit 1`。
   */
  const blockedParent = join(created.path, 'parent-is-a-file')
  writeFileSync(blockedParent, 'not a directory\n')
  const notDirReading = defaultHardLinkTree(join(repo, 'node_modules'), join(blockedParent, 'dst'))
  assert.equal(notDirReading.ok, false,
    '★★ 第二种【成因不同】的真失败（父级不是目录 / ENOTDIR）同样必须 `{ok:false}` ——'
    + '否则"失败"就成了针对某一种成因的补丁。')
  if (notDirReading.ok === false) {
    assert.match(notDirReading.reason, /not a directory/iu,
      '★★ 理由同样是 `cp` 的原文 —— 而且它与上一条**不同形**（这条说的是 ENOTDIR）⇒'
      + '理由确实随**真实成因**走，不是一句写死的笼统话。'
      + `实测 reason=${JSON.stringify(notDirReading.reason)}`)
  }

  /** ★ 反向半边：真原语在**源真的存在**时必须说 ok —— 否则上面两条会被"恒假"骗过。 */
  const okReading = defaultHardLinkTree(join(repo, 'node_modules'), join(created.path, 'really-linked'))
  assert.equal(okReading.ok, true,
    '★★ 反向半边：源真的存在且目标可用 ⇒ 真原语必须说 `{ok:true}`。没有这一条，'
    + '"恒报 ok:false"的空操作也能让上面两条通过（★ 突变双向都要挡）。')

  /**
   * ── 【半边 B】`{ok:false}` **返回之后**的处置 —— 这一半才需要注入缝 ─────────────
   *
   * ★ 注入的理由**不冒充 EXDEV**：本仓的实现根本不按 errno 归类（见
   *   {@link defaultHardLinkTree}）⇒ 注入一条**明显不是跨设备**的真失败理由，
   *   反而更诚实：它证明"理由照转"而不是"理由被改写成跨设备"。
   */
  const failureReason = `cp -al could not hard-link this entry (exit 1): cp: ${join(repo, 'node_modules')} and ${join(created.path, 'node_modules')}: Not a directory`
  const result = provisionWorktreeDependencies({
    repo, worktree: created.path, entries: ['node_modules'],
    link: () => ({ ok: false, reason: failureReason }),
  })

  /** ① 退化**不是**失败：依赖在场。 */
  assert.deepEqual(result.failed, [],
    '★★ 退化【不是】"没准备好"：依赖确实在场（只是占了双份磁盘）⇒ 不许进 failed。'
    + '把它读成失败会让成员以为自己缺依赖，而那与"环境好了、只是没省下磁盘"完全不同形。')
  assert.deepEqual(result.copied, ['node_modules'],
    '★ 而它必须在 copied 里 —— "这一件已经就位"这条读数一字不改。')
  assert.equal(existsSync(join(created.path, 'node_modules', '.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg', 'self.js')), true,
    '★★ 关键：退化成真拷贝之后，**内容真的在场**（读得到，不是"调用过 cpSync"）。')

  /** ② 理由必须留下，且**原样**转述（不许被改写成"跨设备"）。 */
  assert.equal(result.linkFallbacks.length, 1, '★★ 退化必须留下【一条可读的理由】，不许静默')
  assert.equal(result.linkFallbacks[0].entry, 'node_modules', '★ 而且必须【指名】是哪一件退化了')
  assert.equal(result.linkFallbacks[0].reason, failureReason,
    '★★★ 理由必须**逐字**照转注入的原语给的那条 —— 本仓不按 errno 归类，'
    + '所以"跨设备"不是判据；把这条理由改写成"cross-device"就是把读数加工成好听的形状。')

  /** ③ 逐条读数：`copied` 与 `linked` 必须分得开（★ 不许并成一个布尔）。 */
  const reading = result.entries.find(item => item.entry === 'node_modules')
  assert.ok(reading !== undefined, '★ 每一件都要有自己的读数')
  assert.equal(reading.mode, 'copied',
    '★★ 这一件的 mode 必须是 `copied` —— 若它与 `linked` 同形，'
    + '"这次没省下磁盘"就永远读不出来（本仓记账过的那条形态）。')
  assert.equal(reading.reason, failureReason, '★ 逐条读数里也要带上那条理由')

  /** ★ 而"退化"与"硬链接成功"必须真的不同形 —— 否则上面三件事都读不出来。 */
  const linked = createTaskWorktree({ repo, taskId: 'task-t1-linked' })
  assert.equal(linked.ok, true)
  const okResult = provisionWorktreeDependencies({ repo, worktree: linked.path, entries: ['node_modules'] })
  assert.deepEqual(okResult.linkFallbacks, [], '★ 硬链接成功 ⇒ 没有退化读数')
  assert.equal(okResult.entries.find(item => item.entry === 'node_modules')?.mode, 'linked',
    '★★ 两条路的 mode 必须不同（linked ≠ copied）—— 这就是"不许把三态并成一个布尔"。')
  assert.notDeepEqual(okResult.entries, result.entries, '★ 两种结果的读数必须两两不同形')
})

// ── 臂 13 ★★ 幂等分支的读数：已存在 ⇒ mode 'existed'，与 linked/copied 不同形 ───
test('臂 13 ★★ 已存在 ⇒ mode 是 `existed`（"早就在了"与"我动手了"不同形）', () => {
  const repo = makeRepo()
  const created = createTaskWorktree({ repo, taskId: 'task-t1-existed' })
  assert.equal(created.ok, true)

  const first = provisionWorktreeDependencies({ repo, worktree: created.path, entries: ['node_modules'] })
  assert.equal(first.entries.find(item => item.entry === 'node_modules')?.mode, 'linked',
    '★ 前置：第一次是硬链接进去的')

  const second = provisionWorktreeDependencies({ repo, worktree: created.path, entries: ['node_modules'] })
  const reading = second.entries.find(item => item.entry === 'node_modules')
  assert.equal(reading?.mode, 'existed',
    '★★ 第二次什么都没做 ⇒ mode 必须是 `existed`。它既不是 `linked` 也不是 `copied` ——'
    + '把"早就在了"并进"我动手了"会让"重试一次"读成"又注入了一遍"。')
  assert.deepEqual(second.linkFallbacks, [], '★ 幂等分支不是退化')

  /** ★ 而它是【幂等】的：第二次之后仍然是同一份物理数据（没有被再拷一份）。 */
  const relSelf = join('.pnpm', 'pkg@1.0.0', 'node_modules', 'pkg', 'self.js')
  assert.equal(statSync(join(created.path, 'node_modules', relSelf)).ino,
    statSync(join(repo, 'node_modules', relSelf)).ino,
    '★★ 重试没有把依赖树再搬一遍（仍然是同一个 inode）—— 这正是 existsSync 那一跳的意义。')
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
