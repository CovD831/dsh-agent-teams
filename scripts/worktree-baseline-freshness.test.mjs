#!/usr/bin/env node
/**
 * ── worktree 的【基线过期】必须可观测（t80）─────────────────────────────────────
 *
 * ── ★★★ 它修的是什么（两个成员各自撞到，而两次都不是他们的错）────────────────────
 *
 *   · t72：它的 worktree 基线里【没有 t69 的修复】
 *          ⇒ 它读到 **28 条红**，而主树只有 **4 条**
 *   · t70：它的 worktree 基线里【没有 t69 修的那个「空理由」】
 *          ⇒ 它报了一条【已经修好】的缺口
 *
 *   ⇒ 两次都是「切分支的时点早于某个修复」，而两次都让成员在**不存在的问题**上
 *     花时间去查。
 *
 * ── ★★ 而在本仓，这不是偶发：它是常态（MEASURED，2026-10-08 开工时实测）────────
 *
 *     task-t13  61 个提交落后
 *     task-t14  61    task-t16  60    task-t19  56
 *     task-t24  44    task-t25  53    task-t26  53    task-t27  52
 *
 *   ⇒ ★ 一个落后 61 个提交的检出，会读到一整套**已经不存在**的失败。
 *
 * ── ★★ 形态（与本队今晚那条归纳同源）──────────────────────────────────────────
 *
 *   **worktree 相对主干的时序，没有任何东西在读。**
 *
 *   ★ 而它与"已提交但未并入主树那一段在观察面里不存在"同族 ——
 *     两者都是同一个量的两个方向：
 *
 *       ① 让**过时**可读（本任务）：我的基线比主干旧吗
 *       ② 让**已提交**可见（t71 那条）：我提交了而主干还没有的东西，算不算改动
 *
 *   ⇒ 共同形态：**worktree 与主干之间的【差】，没有任何东西在看。**
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ★★ 设计问题：① 还是 ② 还是 ③？（captain 要求择一说清理由）
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   ① 建 worktree 时记录基线 commit，交终态时检查它是否落后于主干
 *   ② 让观察面读 `git diff main...HEAD`（同时解决"已提交但未并入"）
 *   ③ 两者都做
 *
 * ── 我的答案：**①**，而理由是 ② 在本仓**测的不是那件事**（实测，不是推理）──────
 *
 *   MEASURED：在一个真实的落后 worktree（task-t13，落后 61 个提交）上：
 *
 *       git diff --name-only main...HEAD   ⇒  **0 个文件**
 *       git diff --name-only main..HEAD    ⇒  219 个文件
 *       git rev-list --count HEAD..main    ⇒  61
 *
 *   ★ 三点式（`main...HEAD`）问的是「**本分支**相对分叉点加了什么」——
 *     而落后的 worktree 往往**一个字都没提交**（它在脏工作树里干活）⇒ 它报 0。
 *     ⇒ ★ 所以 ② 那个写法**看不到过期**：它给出的 0 与"完全同步"的 0 **同形**。
 *
 *   ★ 两点式（`main..HEAD`）方向是**反的**：它列出的是"主干有而我没有"的 219 个文件 ——
 *     那是**过期量**，不是"本任务的改动"。
 *     ⇒ 把它塞进"观察面"会把**别人的**改动算成本次任务的改动，
 *       而那正是 `dispatch.changed-paths` 存在的理由要防的事。
 *
 *   ⇒ ★ 结论：② 把两个**不同**的问句混成一个名字。
 *     而过期的正确读数是 **`HEAD..main`**（主干有而我没有的提交数）——
 *     它是 ① 需要的那个量，而**不是**观察面该读的那个量。
 *
 * ── ★★ 所以本任务只做 ①，并把 ② 的缺口【留给它自己的任务】──────────────────────
 *
 *   ★ 而这不是"少做了一半"：① 与 ② 的性质不同（captain 原话），
 *     而 ② 若是可以合并的，它需要在**观察面**上做，那在 `src/tools.ts`（outOfScope）。
 *     ⇒ 本任务把它**写成已知边界**，而不是假装覆盖。
 *
 * ── ★★ 三态，且三者不同形 ──────────────────────────────────────────────────────
 *
 *   `current`      —— 基线就是主干的尖端（差 0 个提交）
 *   `behind`       —— 落后 N 个提交（★ 附 N，以及**落后于哪个尖端**）
 *   `undecidable`  —— 判不了（读不到主干尖端：不是仓库 / 没有 main 引用 / 没有 HEAD）
 *
 *   ★ 前两者都"读到了"，第三者"没读到" —— 而它们的补救动作不同：
 *     `behind` ⇒ 去重切分支或并入主干；`undecidable` ⇒ 去把 git 接上。
 *
 * ── ★★ 反向半边 ────────────────────────────────────────────────────────────────
 *
 *   不许退化成恒报过期：正常切出的 worktree（基线 == 主干尖端）必须报 `current`。
 *
 * Run: node --test scripts/worktree-baseline-freshness.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { worktreeBaselineFreshness, describeBaselineFreshness } from '../lib/harness-compat.js'

/** 在一个目录里跑一条 git 命令，返回 stdout（失败则抛）。 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * 造一个真仓库（带 `main` 引用），返回 { root, commit(msg), tipOfMain, worktreeAt(commit) }。
 *
 * ★ 用**真 git**，不用假的：本判据读的就是 git 本身告诉你的事实 ——
 *   一个假 git 会把我对"哪个引用是什么意思"的理解固化成夹具的假设。
 */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'wt-baseline-'))
  git(root, ['init', '-q', '-b', 'main', '.'])
  git(root, ['config', 'user.email', 't@t'])
  git(root, ['config', 'user.name', 't'])
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'one'])
  return {
    root,
    commit: (msg) => {
      writeFileSync(join(root, 'a.txt'), `${msg}\n`)
      git(root, ['add', '-A'])
      git(root, ['commit', '-qm', msg])
      return git(root, ['rev-parse', 'HEAD'])
    },
    head: () => git(root, ['rev-parse', 'HEAD']),
    mainTip: () => git(root, ['rev-parse', 'main']),
    /**
     * ★ 在这个仓库里切出一个**独立检出**（不是链接工作树）——
     *   与 `src/worktree.ts` 造出来的那种同构：各自的 `.git`，共享对象库。
     */
    worktreeAt: (revision) => {
      const path = mkdtempSync(join(tmpdir(), 'wt-checkout-'))
      rmSync(path, { recursive: true, force: true })
      git(root, ['worktree', 'add', '--quiet', '--detach', path, revision])
      return path
    },
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 态 ①：基线是主干的尖端 ⇒ current（反向半边）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（反向半边）：正常切出的 worktree（基线 == 主干尖端）⇒ current', async () => {
  /**
   * ★ 这一臂防的是**恒报过期**：一条永远说"你旧了"的判据会教人忽略它，
   *   而它红得看起来完全正常。
   */
  const r = repo()
  try {
    const wt = r.worktreeAt(r.mainTip())
    const freshness = await worktreeBaselineFreshness(wt)
    assert.equal(
      freshness.status, 'current',
      `★ 刚切出来的 worktree 不该被报成过期。实测：${JSON.stringify(freshness)}`,
    )
    assert.equal(freshness.behind, 0)
  } finally {
    r.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ②：基线落后 ⇒ behind（★ 本任务的核心）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（核心臂）：主干前进而 worktree 停在旧提交 ⇒ 必须报 behind，并给出落后几个', async () => {
  /**
   * ── ★★ 这是 t72 / t70 的可执行形式 ──────────────────────────────────────────
   *
   *   t72 的检出里没有 t69 的修复 ⇒ 它读到 28 条红，而主树 4 条。
   *   t70 的检出里没有 t69 修的那个"空理由" ⇒ 它报了一条已修好的缺口。
   *
   * ⇒ 判据必须答得出来："我这个检出，比主干旧了多少个提交。"
   */
  const r = repo()
  try {
    const wt = r.worktreeAt(r.mainTip())
    /** ★ 主干前进三个提交 —— 而 worktree 停在原处（那就是"切早了"）。 */
    r.commit('two')
    r.commit('three')
    const tip = r.commit('four')

    const freshness = await worktreeBaselineFreshness(wt)
    assert.equal(
      freshness.status, 'behind',
      `★★ 主干前进了而 worktree 没动 ⇒ 必须报 behind。实测：${JSON.stringify(freshness)}`,
    )
    assert.equal(freshness.behind, 3, `★ 必须给出【落后几个】。实测：${JSON.stringify(freshness)}`)
    /** ★ 而"落后于哪个尖端"也要能读出来 —— 否则无从核对。 */
    assert.equal(freshness.trunk, tip, '★ 必须交出主干的尖端，人才能去核对')
  } finally {
    r.done()
  }
})

test('★★ 臂 3：落后的【信息】要说得出口（不是只说一个数字）', async () => {
  const r = repo()
  try {
    const wt = r.worktreeAt(r.mainTip())
    r.commit('two')
    r.commit('three')
    const freshness = await worktreeBaselineFreshness(wt)
    const message = describeBaselineFreshness(freshness)
    assert.match(message, /behind|落后/i, `★ 必须说清是落后。实测：${message}`)
    assert.match(message, /\b2\b/, `★ 必须带那个数字。实测：${message}`)
    /**
     * ★ 而它必须说清【这意味着什么】—— 只报"落后 2 个提交"仍然要人去猜后果。
     *   后果是具体的：**你会读到已经不存在的缺口**。
     */
    assert.match(
      message, /already have been fixed|no longer|not here|不再|已经/i,
      `★ 必须点明后果（你读到的东西可能已经不在了）。实测：${message}`,
    )
  } finally {
    r.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ③：判不了 ⇒ undecidable（★ 与另两态不同形）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（三态臂）：读不到主干或 HEAD ⇒ undecidable，且与 current/behind 都不同形', async () => {
  /**
   * ★ 三种"读不到"都落 `undecidable`，而它们的补救动作与 ①② 都不同：
   *   ① 的补救 = 什么都不用做
   *   ② 的补救 = 重切分支 / 并入主干
   *   ③ 的补救 = **去把 git 接上**（这一格压根没被观察到）
   */
  const missing = await worktreeBaselineFreshness('/nonexistent-path-for-t80')
  assert.equal(missing.status, 'undecidable', `实测：${JSON.stringify(missing)}`)
  assert.equal(missing.behind, undefined, '★ 没测到时不许给出一个数字')

  /** ★ 而它不许与 `current` 同形 —— 把"没测到"读成"是新的"正是本队记账的那条。 */
  const r = repo()
  try {
    const current = await worktreeBaselineFreshness(r.worktreeAt(r.mainTip()))
    assert.equal(current.status, 'current')
    assert.notEqual(missing.status, current.status)
    assert.notEqual(
      describeBaselineFreshness(missing), describeBaselineFreshness(current),
      '★ 两态的措辞必须不同形',
    )
    /**
     * ★ 而它不许**声称**"是最新的" —— 注意 `current` 这个词会出现在
     *   "could NOT be determined" 里，所以这一格查的是**声称**那几处措辞。
     *   ★ 把它写成 `doesNotMatch(/current/)` 会让这一臂**恒红**（而恒红会被人忽略）。
     */
    assert.doesNotMatch(
      describeBaselineFreshness(missing), /at the trunk tip|is up to date|是最新的/i,
      '★ 「没能测量」不许读成「是最新的」',
    )
  } finally {
    r.done()
  }
})

test('★ 臂 5（三态不同形）：三态的读数两两不同形', async () => {
  const r = repo()
  try {
    const wt = r.worktreeAt(r.mainTip())
    const current = await worktreeBaselineFreshness(wt)
    r.commit('two')
    const behind = await worktreeBaselineFreshness(wt)
    const undecidable = await worktreeBaselineFreshness('/nonexistent-path-for-t80')

    assert.equal(new Set([current.status, behind.status, undecidable.status]).size, 3, '★ 三态两两不同形')
    assert.equal(current.behind, 0)
    assert.equal(behind.behind, 1)
    assert.equal(undecidable.behind, undefined)
  } finally {
    r.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 一条"读到了"的边界：worktree 自己提交了东西呢？
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（边界臂）：worktree 自己提交过、而它仍可能落后 ⇒ 两个数字必须分开', async () => {
  /**
   * ── ★ 这一格必须说清，否则判据会答错 ──────────────────────────────────────────
   *
   *   「我落后主干多少」与「我自己提交了多少」是【两个不同的量】：
   *     我提交了 2 个，而主干前进了 3 个 ⇒ 我落后 3 个（而那 2 个是我的）。
   *   ★ 把两者合成一个"差异数"，会让"我在主干之前"与"我在主干之后"同形。
   */
  const r = repo()
  try {
    const wt = r.worktreeAt(r.mainTip())
    /** ★ 主干前进 3 个。 */
    r.commit('main-2')
    r.commit('main-3')
    r.commit('main-4')
    /** ★ 而 worktree 在它**自己的**分支上提交 2 个。 */
    git(wt, ['checkout', '-q', '-b', 'mine'])
    writeFileSync(join(wt, 'b.txt'), 'mine\n')
    git(wt, ['add', '-A'])
    git(wt, ['commit', '-qm', 'my-1'])
    writeFileSync(join(wt, 'b.txt'), 'mine2\n')
    git(wt, ['add', '-A'])
    git(wt, ['commit', '-qm', 'my-2'])

    const freshness = await worktreeBaselineFreshness(wt)
    assert.equal(freshness.status, 'behind', JSON.stringify(freshness))
    assert.equal(
      freshness.behind, 3,
      `★ 落后数只算【主干有而我没有】的 —— 我自己的 2 个提交不许混进来。实测：${JSON.stringify(freshness)}`,
    )
  } finally {
    r.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 定向突变：把一个 worktree 的基线改成旧的 ⇒ 臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7（突变臂）：基线被改成旧的 ⇒ 判据必须从 current 翻成 behind', async () => {
  /**
   * ★ 突变就是**把检出停到主干之前**（= 切早了）。
   *   ⇒ 同一个 worktree 目录，同一个判据，读数必须改变。
   *   ★ 若两者相同，说明判据没在读"差"（而那是本任务的全部内容）。
   */
  const r = repo()
  try {
    const old = r.head()
    r.commit('two')
    r.commit('three')
    const fresh = r.worktreeAt(r.mainTip())
    const stale = r.worktreeAt(old)

    const a = await worktreeBaselineFreshness(fresh)
    const b = await worktreeBaselineFreshness(stale)
    assert.equal(a.status, 'current', `实测：${JSON.stringify(a)}`)
    assert.equal(b.status, 'behind', `★ 突变后必须报 behind。实测：${JSON.stringify(b)}`)
    assert.notEqual(a.status, b.status, '★ 两次读数必须不同 —— 否则判据没在读基线')
  } finally {
    r.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 对【真实仓库】跑一次并如实报出（契约要求；也是本任务证据的落点）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 8（真实读数臂）：对本仓的每一个 worktree 跑一次，如实报出落后情况', async () => {
  /**
   * ★ 契约明写"必须对当前仓库跑一次并如实报出来"。
   *   ★ 而它是一条**读数**，不是断言：某些 worktree 落后是**正常的**
   *     （它们已经交付完了）—— 判据不该让它们红，该让人**看见**。
   *
   * ★ 缺了这一臂，本任务就只是"一个能测过期的函数"，
   *   而**没有任何证据**说明它测的是真实存在的现象。
   */
  const { existsSync, readdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  /**
   * ★ 从本夹具往上找到仓库根。本文件住在
   *   `<repo>/.agent-teams/worktrees/task-t80/scripts/` ⇒ 往上 **4** 层。
   *   ★ 层数必须按"它该回到哪里"算，不是按"看起来像几层" ——
   *     本队为这件事付过一次学费（t39 的 pluginRoot 层数：×2 对、×3 错、×4 对）。
   */
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, '..', '..', '..', '..')
  const wtRoot = join(root, '.agent-teams', 'worktrees')
  if (!existsSync(wtRoot)) {
    // eslint-disable-next-line no-console
    console.log('\n[基线读数] 本检出看不到 .agent-teams/worktrees（干净 checkout）⇒ 跳过\n')
    return
  }
  const dirs = readdirSync(wtRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const rows = []
  for (const name of dirs) {
    const freshness = await worktreeBaselineFreshness(join(wtRoot, name))
    rows.push({ name, ...freshness })
  }
  const behind = rows.filter((row) => row.status === 'behind')
  const current = rows.filter((row) => row.status === 'current')
  const unknown = rows.filter((row) => row.status === 'undecidable')
  // eslint-disable-next-line no-console
  console.log(
    `\n[基线读数] 本仓 ${rows.length} 个 worktree：`
    + `current ${current.length} · behind ${behind.length} · undecidable ${unknown.length}`
    + (behind.length > 0
      ? `\n  落后示例：${behind.slice(0, 5).map((r) => `${r.name}(-${r.behind})`).join(' · ')}`
      : '')
    + '\n',
  )
  /** ★ 而它必须真的读到了东西 —— 一个"0 个 worktree"的读数与"扫描器什么都没扫到"同形。 */
  assert.ok(rows.length > 0, '★ 目录在就必须真的扫到 worktree')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 臂 9（接线缺口臂）：读数已建，而生产里还没有消费者 —— 必须被看见
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 9（接线缺口，如实记账）：`worktreeBaselineFreshness` 的生产消费者目前是【零】', async () => {
  /**
   * ── ★★★ 这一臂是**诚实的缺口声明**，不是"已经修好了"的证据 ────────────────────
   *
   * 本任务在 `src/harness-compat.ts` 里建了读数，而**没有任何生产代码调用它**：
   * 往哪接（成员被派发时？交终态时？）是一个设计决定，
   * 而它落在 `src/scheduler.ts` / `src/tools.ts` —— 都在 t80 的 outOfScope。
   *
   * ★ 本队那条纪律：**一个没有调用方的修法，与没有修法在观测上完全相同。**
   *   ⇒ 所以这里断言"此刻没有消费者"，并写清【翻转条件】。
   *
   * ★ 而它与臂 1-8 的分工：那些测**读数侧**的机制（已完成且可测），
   *   本条测**接线状态**（未完成，且在此 as-of 时刻是已知的）。
   */
  const { readFileSync: read, readdirSync: ls } = await import('node:fs')
  const { join: j, dirname: dn } = await import('node:path')
  const { fileURLToPath: f } = await import('node:url')
  const here = dn(f(import.meta.url))
  const repoRoot = j(here, '..', '..', '..', '..')
  const srcRoot = j(repoRoot, 'src')
  const walk = (dir) => ls(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = j(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
  /**
   * ★ 排除**定义它自己**的那个文件 —— 否则扫描器会在它的声明处找到它，
   *   而那正是「守卫检查了它自己的说明书」那条形态（t62 实测踩过一次）。
   */
  const defining = j(srcRoot, 'harness-compat.ts')
  const consumers = walk(srcRoot)
    .filter((file) => file !== defining)
    .filter((file) => read(file, 'utf8').includes('worktreeBaselineFreshness'))

  assert.deepEqual(
    consumers, [],
    '★★★ 生产里出现了 `worktreeBaselineFreshness` 的消费者 ⇒ **接线完成了**。'
    + '★ 那是好事 —— 而它意味着这一臂要**翻面**：把断言从"没有消费者"改成'
    + '"调用方真的把读数交给了成员（或拒绝了终态）"。'
    + `实测消费者：${JSON.stringify(consumers)}`,
  )
})
