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
  /**
   * ★★ MEASURED（t85 的判据抓出来的，captain 2026-10-08 修）：
   *
   * 这里此前是 `join(here, '..', '..', '..', '..')` —— 一个【决定的】量。
   * ★ 而它只在恰好一种深度下对：main tree 里 here=<root>/scripts ⇒ ..×4 指向 /Users，
   *   worktree 里 here=<root>/.agent-teams/worktrees/<id>/scripts ⇒ ..×4 恰好对。
   * ★ 而它旁边就写着那次学费（"层数必须按它该回到哪里算，不是按看起来像几层"）——
   *   而它仍然是一个写死的层数。
   *
   * ⇒ 改成【发现的】量：向上找到含 package.json 的那一层。
   *   它不假设布局，它【问】布局 ⇒ 浅树深树都对。
   */
  const root = (() => {
    let dir = here
    for (let i = 0; i < 6; i += 1) {
      try {
        if (existsSync(join(dir, 'package.json'))) return dir
      } catch { /* 继续上溯 */ }
      dir = join(dir, '..')
    }
    throw new Error('cannot locate the repo root from ' + here)
  })()
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

test('★★★ 臂 9（接线臂，已翻面）：status 真的把 worktree 基线读数交出去了', async () => {
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
  const { readFileSync: read, readdirSync: ls, existsSync } = await import('node:fs')
  const { join: j, dirname: dn } = await import('node:path')
  const { fileURLToPath: f } = await import('node:url')
  const here = dn(f(import.meta.url))
  /**
   * ★★ MEASURED（captain 2026-10-08）：层数错了 —— 而它只在【主树】里现形。
   *
   * 本文件住在 `scripts/`，所以 here = <root>/scripts ⇒ 到仓库根只需 .. 一次。
   * ★ 而 ..×4 在【worktree】里恰好对（那里路径更深：
   *   <root>/.agent-teams/worktrees/<id>/scripts）
   *   ⇒ 于是它在作者的 worktree 里【全绿】，而在主树里指向 /Users ⇒ ENOENT。
   * ★ 判别动作（与 t39/t54 那两次同一条）：层数要按「它该返回什么」算，
   *   不是按「在作者那棵树里深几层」算。
   * ⇒ 正确做法：从 here 向上找到【含 package.json 的那一层】——
   *   而那让它在【任何深度】都对，且不依赖一个数出来的常量。
   */
  const repoRoot = (() => {
    let dir = here
    for (let i = 0; i < 6; i += 1) {
      try {
        if (existsSync(j(dir, 'package.json'))) return dir
      } catch { /* 继续上溯 */ }
      dir = j(dir, '..')
    }
    throw new Error('cannot locate the repo root from ' + here)
  })()
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

  /**
   * ── ★★★ 已翻面（captain 2026-10-08）───────────────────────────────────────────
   *
   * 上面那段"接线缺口"的声明【按它自己写下的翻转条件】被翻面了：
   *   t84 把它接进了 status.deployment.worktree ⇒ 生产里【有】消费者了。
   * ★ 而本臂红的那一刻就是"缺口真正关闭"的证据 —— 那正是它当初的设计。
   *   （★ 与 t76 的臂 12、t83 的臂 18 同一手法 —— 今晚第三次闭环。）
   *
   * ⇒ 新口径：生产里【必须】有消费者，且它必须真的把读数交到一个出口上。
   */
  assert.ok(
    consumers.length > 0,
    '★★★ 生产里【没有】worktreeBaselineFreshness 的消费者 ⇒ 接线断了（回到了 t80 那条形态：'
    + '读数已建而没有人读它）',
  )
  const exporting = consumers.filter((file) => read(file, 'utf8').includes('worktree'))
  assert.ok(
    exporting.length > 0,
    '★★★ 有人 import 了它，而【没有任何地方把它交到一个出口上】'
    + '⇒ 那仍然是没有调用方的读数。实测消费者：' + JSON.stringify(consumers),
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// t84：这个读数接到哪 —— 从【status 出口】读得到（而不是只能从函数读）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ── ★★★ 设计问题（本任务开工前必须先答的）────────────────────────────────────
 *
 *   **部署读数属不属于【成员能看见的面】？而它与 `status.deployment` 是什么关系？**
 *
 * ── 我的答案：**属于，而它与 `deployment` 是【两个并列的问句】，不是同一个**──────
 *
 *   MEASURED（同一时刻、同一进程里同时读两个）：
 *
 *       PROCESS  (moduleFreshness)        ⇒ stale | behind = "58bd7e93fd84…"（**一个 hash**）
 *       WORKTREE (worktreeBaselineFreshness) ⇒ current | behind = 0          （**一个计数**）
 *
 *   ★ 两个答案同时成立 —— 而它们说的是**两件独立的事**：
 *
 *       `deployment`  问的是「**这个进程**手里的是旧代码吗」（主体 = 进程）
 *       `worktree`    问的是「**这个检出**比主干旧吗」    （主体 = 目录）
 *
 *   ⇒ ★ 它们可以**任意组合**：进程可以是当前版而检出落后 61 个提交；
 *     检出可以在尖端而进程持有旧构建。
 *     ⇒ 所以**不能合并** —— 合并会让"我该重启"与"我该重切分支"同形，
 *       而那两个补救动作完全不同。
 *
 * ── ★★ 而它们**同名**：两处都有 `behind`，而类型不同 ───────────────────────────
 *
 *       deployment.behind   ⇒ **string**（那个 hash：我是在哪个提交上构建的）
 *       worktree.behind     ⇒ **number**（落后几个提交）
 *
 *   ★ 这正是本队记账的「守卫检查了另一个同名的东西」的**近亲**：
 *     两个读数同名而不同义 ⇒ 读的人会拿错。
 *   ⇒ 所以接进出口时，**名字必须能分开**（下面臂 T2 钉住这一条）。
 *
 * ── ★★ 接法：扩 `deployment` 那一格，不新开通路 ────────────────────────────────
 *
 *   理由（t34 的先例，而它在这里同样成立）：
 *     `status` 是【每次收口后必然被读】的那个出口 —— 而"我这个检出旧不旧"
 *     恰恰是**每个 worktree worker 收口时**最需要知道的事（t72/t70 都栽在它上面）。
 *   ★ 而**不新开一条通路**的理由是决定性的：本队那条纪律 ——
 *     一个没有人读的读数，与没有那个读数在观测上完全相同。
 *     新开一格的代价是它可能永远没人读；而扩一个**已经在被读**的格子不会。
 *
 *   ★ 而它**不**走 t76/t83 那条"由调用方注入"的路 —— 那是给**判据**读的
 *     （判据不读盘），而这一格是给**人和成员**读的。两个方向，两个出口。
 */

/** 一个最小但够真的插件实例（与 `gate-stale-module` 同一手法）。 */
async function statusFixture() {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const ws = mkdtempSync(join(tmpdir(), 't84-status-'))
  /**
   * ★★ 必须 `.trim()` —— MEASURED（本臂实测踩过）：
   *   不 trim 时 `git rev-parse HEAD` 会带回一个**尾换行**，
   *   而那个带着换行的字符串拿去 `git switch --detach` 会报
   *   `fatal: invalid reference` / `unknown revision`。
   *
   *   ★ 而那个报错的形状【与"这段代码没生效"同形】——
   *     我第一反应是去查 git 的 ref 语义，而真因只是少了一个 `.trim()`。
   *   ★ 文件顶部那个 `git()` 助手是 trim 的，而这个局部的不是 ⇒ **两个助手不同口径**，
   *     而那正是本队记账的「同一个名字，两处不同实现」。
   */
  const git = (args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q', '-b', 'main', '.'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(ws, 'a.txt'), 'one\n')
  git(['add', '-A'])
  git(['commit', '-qm', 'one'])
  await createTeamDir(join(ws, '.agent-teams'), {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [],
  })
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const captain = { id: 'cap', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} }
  const status = async () => tools.get('agent_teams_status').execute({}, { agent: captain, signal: new AbortController().signal })
  return { ws, git, status, tool: tools.get('agent_teams_status') }
}

/**
 * ── ★★ 一个【真的落后】的检出 + 一个活着的团队（给出口臂用）────────────────────
 *
 * ★ 顺序是决定性的（见臂 T1 里那三个坑）：**先动检出，最后建团队**。
 *   因为 `git switch` 会清掉挡路的未跟踪内容（把 `team.json` 弄没），
 *   而"检出移动"与"团队存在"是两件独立的事 —— 我要测的是前者对读数的影响。
 */
async function staleWorktreeFixture() {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const ws = mkdtempSync(join(tmpdir(), 't84-stale-'))
  /** ★ 与 `statusFixture` 同一口径：`.trim()` —— 少它会让 SHA 带上尾换行。 */
  const git = (args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q', '-b', 'main', '.'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(ws, 'a.txt'), 'one\n')
  git(['add', '-A'])
  git(['commit', '-qm', 'one'])
  /** ★ ① 记下"切分支的时点"（主干还没前进）。 */
  const cutAt = git(['rev-parse', 'HEAD'])
  /** ★ ② 主干前进两个提交。 */
  for (const msg of ['two', 'three']) {
    writeFileSync(join(ws, 'a.txt'), `${msg}\n`)
    git(['add', '-A'])
    git(['commit', '-qm', msg])
  }
  /** ★ ③ 检出退回到切点 ⇒ 真的落后 2 个。 */
  git(['switch', '-q', '--detach', cutAt])
  /** ★ ④ **最后**才建团队（否则上一步会把它清掉）。 */
  await createTeamDir(join(ws, '.agent-teams'), {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [],
  })
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const captain = { id: 'cap', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} }
  const status = async () => tools.get('agent_teams_status').execute({}, { agent: captain, signal: new AbortController().signal })
  return { ws, git, cutAt, status }
}

test('★★★ 臂 T1（出口臂）：三态必须能【从 status 出口】读出来 —— 不是只能从函数读', async () => {
  /**
   * ★ 本任务的全部意义：**读数要能被读到**。
   *   一个只在 `lib/harness-compat.js` 里存在的读数，与没有它同形（t80 的臂 9 记着）。
   */
  /**
   * ── ★★ 臂 T1 的构造（实测踩了三个坑，逐条留在这里）────────────────────────────
   *
   * MEASURED（本臂第一版）：
   *   ① `git rev-list --max-parents=0 HEAD` 取"第一个提交"当旧基线 ⇒
   *      `switch --detach` 报 `fatal: invalid reference`。
   *      ★ 真因不是 ref 语义，而是夹具里那个**局部的 `git()` 助手没 `.trim()`** ——
   *        `rev-parse` 的输出带着一个尾换行，而带换行的 SHA 不是 SHA。
   *        ★ 而那个报错的形状【与"这段代码没生效"同形】，所以我先去查了 git 的语义。
   *   ② 修好 trim 之后仍然失败，而这次是真因：
   *      **`git switch` 会把 `.agent-teams/team/team.json` 弄没**
   *      （它是未跟踪的，而 checkout 会清掉挡路的未跟踪内容）。
   *      ⇒ 于是 `status()` 报 "you do not lead or belong to any active team yet"。
   *
   * ⇒ ★ 所以构造顺序是**决定性的**：先让主干前进、再把检出退到切点、
   *   **最后才建团队** —— 因为"检出移动"与"团队存在"是两件独立的事，
   *   而我要测的是前者对读数的影响。
   */
  const { ws, cutAt, status } = await staleWorktreeFixture()
  void ws
  void cutAt

  const result = await status()
  const deployment = result.deployment
  assert.ok(deployment, '★ `status` 必须带 `deployment`')
  /**
   * ★★ 三态要从出口读得出来：`behind`（计数）与 `current` 两者之一，
   *   而"落后几个"必须是那个出口上的一个**计数**。
   */
  assert.equal(
    deployment.worktree?.status, 'behind',
    `★★ 真的落后 ⇒ 出口必须报 behind。实测：${JSON.stringify(deployment, null, 1)}`,
  )
  assert.equal(
    typeof deployment.worktree?.behind, 'number',
    `★ 而落后数必须是【一个计数】（不是 hash）。实测：${JSON.stringify(deployment.worktree)}`,
  )
  assert.ok(deployment.worktree.behind > 0, JSON.stringify(deployment.worktree))
})

test('★★ 臂 T2（同名不同义臂）：`deployment.worktree.behind` 与 `deployment.behind` 必须可分辨', async () => {
  /**
   * ── ★★ 这一臂钉的是那个**名字冲突**（本任务实测发现）────────────────────────────
   *
   *   两处都有 `behind`：
   *     `deployment.behind`            ⇒ **string**（那个 hash）—— 进程在哪构建的
   *     `deployment.worktree.behind`   ⇒ **number**（一个计数）—— 落后几个提交
   *
   * ⇒ ★ 若把它们放在**同一层**（都叫 `behind`），读的人会拿错 ——
   *   而那正是「守卫检查了另一个同名的东西」的近亲。
   * ⇒ 所以 worktree 那一组必须**有自己的对象**，而不是把字段摊平进 deployment。
   */
  const { status } = await statusFixture()
  const result = await status()
  const deployment = result.deployment
  assert.ok(deployment.worktree, '★ 必须是一个**嵌套对象**，不是摊平的两个 behind')
  assert.notEqual(
    typeof deployment.worktree.behind, typeof deployment.behind,
    `★ 两个 behind 的类型必须不同形（一个是计数、一个是 hash）。`
    + `实测：worktree.behind=${typeof deployment.worktree.behind} · deployment.behind=${typeof deployment.behind}`,
  )
})

test('★★ 臂 T3（反向半边）：当前是尖端时，出口必须报 current（不许恒报 behind）', async () => {
  const { status } = await statusFixture()
  const result = await status()
  assert.equal(
    result.deployment.worktree?.status, 'current',
    `★ 检出不落后时不许报 behind。实测：${JSON.stringify(result.deployment?.worktree)}`,
  )
  assert.equal(result.deployment.worktree.behind, 0)
})

test('★★ 臂 T4（★ 不变 · 两个问句独立）：进程那一支的读数【一字不改】', async () => {
  /**
   * ★ 本任务只**扩** deployment，不改变它已有的那一支。
   *   ⇒ moduleFreshness 的字段（status / message / loaded / on_disk / built_commit …）
   *     必须原样还在。
   */
  const { status } = await statusFixture()
  const result = await status()
  const deployment = result.deployment
  for (const key of ['status', 'message']) {
    assert.ok(key in deployment, `★ 进程那一支的 "${key}" 必须还在。实测：${JSON.stringify(Object.keys(deployment))}`)
  }
  /** ★ 而"进程"那个 status 是**顶层**的 —— 它没有被 worktree 那一支顶掉。 */
  assert.ok(
    ['current', 'stale', 'unknown'].includes(deployment.status),
    `★ 顶层 status 仍说【进程】那一件事。实测：${deployment.status}`,
  )
})

test('★ 臂 T5（schema 对齐臂）：出口 schema 必须声明新字段（否则自己拒绝自己）', async () => {
  /**
   * ★ t14 形态的预防：`deployment` 是 `additionalProperties: false`，
   *   而产出里多出来的键会**当场**让 status 拒绝自己。
   * ★ 按**性质**断言（产出里有的键，schema 里必须有），而不是抄一份字段名单。
   */
  const { status, tool } = await statusFixture()
  const declared = Object.keys(tool.output.schema.properties.deployment.properties ?? {})
  const result = await status()
  for (const key of Object.keys(result.deployment)) {
    assert.ok(
      declared.includes(key),
      `★ deployment 产出了 "${key}"，而 schema 只声明了 ${JSON.stringify(declared)} —— `
      + 'additionalProperties:false 会当场拒绝自己（t14 形态）',
    )
  }
  assert.ok(declared.includes('worktree'), `★ schema 必须声明 "worktree"。实测：${JSON.stringify(declared)}`)
})
