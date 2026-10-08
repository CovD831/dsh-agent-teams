/**
 * ── `dispatch.changed-paths` 那条【拒绝措辞】的夹具（t59）───────────────────────
 *
 * ── 它测的是什么 ──────────────────────────────────────────────────────────────
 *
 * 拒绝信息里有这么一句：
 *
 *     「… not in any of the [N] workspace(s) that were checked
 *        (the main workspace and every member worktree under it)」
 *
 * ★ 本夹具测的不是判据的裁决（那在 `gate-changed-paths.test.mjs`），而是
 *   **那句话里的每一个数字和每一个名词，能不能指出它的来源**（j-0007）。
 *
 * ── ★★★ 它防的是什么失效（MEASURED，t59）──────────────────────────────────────
 *
 *   ① 那个 N 读的是 `ctx?.observedWorkspaces ?? 1`，而 `observedWorkspaces`
 *      **从来没有被任何地方赋过值**（全仓 grep：零个赋值点）⇒ 恒取 1。
 *      ⇒ ★ 那是一个**兜底值伪装成读数** —— 它读起来像"算出来是 1"。
 *
 *   ② 而同一天查出第二处：括号里的「every member worktree under it」当时
 *      **在产线里**也是假的 —— `workspaceAndWorktreeChangedPaths` 没有调用方。
 *      ⇒ ★ 那句话里，**数字是兜底值、名词是空头承诺**。
 *
 * ── 三态（★ 两两不同形，因为补救动作不同）──────────────────────────────────────
 *
 *   ① 工作区面整个缺席        ⇒ "没有第二个面可核对"（补救：去把观察面接上）
 *   ② 计数没被喂（而面在场）  ⇒ 断言照旧，但★【不声称数字】（补救：去把那一格接上）
 *   ③ 计数在场                ⇒ 说清【看了几棵树】、以及是哪几棵
 *
 * ── ★★ 反向半边（缺它的话"修好了"与"放宽了"同形）───────────────────────────────
 *
 *   一个**真的**在 worktree 里改了文件的申报 ⇒ 那条拒绝【不该再出现】。
 *   而一个**零工作却自报路径**的申报 ⇒ 那条拒绝【必须仍然出现】。
 *   ★ 两者合起来才说明：观察面变宽了，而**判定规则一个字没改**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/** ★ t86：统一口径（t39 建立）—— 见那条断言处的长注释。 */
import { toolsSource } from './tools-source.mjs'

const { gate } = await import('../lib/gates/dispatch/changed-paths.js')
const { gitChangedPaths, observeWorkspaces } = await import('../lib/harness-compat.js')

/** 收窄助手：把"这条断言期望哪一种裁决"写进断言本身（三态必须不同形）。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

/** 一个最小 ctx：只给这条臂要测的那几格。 */
function ctx(overrides = {}) {
  return {
    task: { id: 't59', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/member-only.ts'] },
    observedChangedPaths: [],
    ...overrides,
  }
}

/**
 * 一个**真实布局**：主工作区 + 其下一棵成员 worktree，而成员只在自己的树里改了一个文件。
 * ★ 与 `gate-changed-paths.test.mjs` 的 `realLayoutFixture` 同构（那份属 t41 的夹具）。
 */
function realLayoutFixture() {
  const main = mkdtempSync(join(tmpdir(), 't59-main-'))
  const git = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  git(main)(['init', '-q', '.'])
  mkdirSync(join(main, 'src'), { recursive: true })
  writeFileSync(join(main, 'src', 'shared.ts'), 'base\n')
  git(main)(['add', '-A'])
  git(main)(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  const worktree = join(main, '.agent-teams', 'worktrees', 'task-t59')
  mkdirSync(worktree, { recursive: true })
  git(worktree)(['init', '-q', '.'])
  mkdirSync(join(worktree, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'member-only.ts'), 'base\n')
  git(worktree)(['add', '-A'])
  git(worktree)(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  /** ★ 成员在**自己的**树里改一个文件 —— 主工作区那一份不动。 */
  writeFileSync(join(worktree, 'src', 'member-only.ts'), 'changed by the member\n')
  return { main, worktree }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 那个数字【真的算出来】—— 喂 1 ⇒ 报 1；喂 5 ⇒ 报 5
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 读数臂：那句措辞里的数字【跟着喂进去的值走】—— 不是兜底的 1', async () => {
  /**
   * ★ 定向突变：把 `typeof observedCount === 'number'` 那一支去掉、换回 `?? 1`
   *   ⇒ 喂 5 时那句话仍然报 1 ⇒ 本臂红。
   */
  const one = expectBlocked(await gate(ctx({ observedChangedPaths: [], gitChangedPaths: [], observedWorkspaces: 1 })))
  assert.equal(one.length, 1, '★ 只该有一条结论')
  assert.match(one[0], /not in any of the 1 workspace\(s\)/, '★ 喂 1 ⇒ 报 1')
  assert.match(
    one[0], /the main workspace — no member worktree could be read/,
    '★ 而"1 棵"要能读出来是哪一棵 —— 否则读者无法判断它到底看了什么',
  )

  const five = expectBlocked(await gate(ctx({ observedChangedPaths: [], gitChangedPaths: [], observedWorkspaces: 5 })))
  assert.match(
    five[0], /not in any of the 5 workspace\(s\)/,
    '★ 喂 5 ⇒ 必须报 5。若这里报 1，说明那个数又回到兜底值了（定向突变）',
  )
  assert.match(
    five[0], /the member worktree\(s\) under it that could be read/,
    '★ 而"5 棵"要读得出含成员 worktree —— 否则"数字跟上了、名词还是空头"',
  )
  assert.notDeepEqual(one[0], five[0], '★ 两条措辞必须不同形（否则"跟着走"是恒真的）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 计数缺席 ⇒ 【不声称数字】（而不是兜底成 1）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2 三态臂：计数没被喂 ⇒ 那句话【不声称数字】，而不是兜底成 1', async () => {
  /**
   * ★★ 这是本任务的核心：`?? 1` 的问题不是"1 这个值不对"，而是
   *   **一个兜底值伪装成读数**。⇒ 修法不是换一个更好的兜底值，
   *   而是**让那句话在不被告知时【不声称数字】**。
   *
   * ★ 定向突变：把这一支并回 `?? 1` ⇒ 本臂红（那句话会开始声称 1）。
   */
  const notFed = expectBlocked(await gate(ctx({ observedChangedPaths: [], gitChangedPaths: [] })))
  assert.equal(notFed.length, 1)
  assert.equal(
    /\bnot in any of the \d+ workspace/.test(notFed[0]), false,
    '★ ★ 计数没被喂时，那句话【不许】出现"N workspace(s)" —— '
    + ' 那是兜底值伪装成读数。定向突变：把这一支换回 `?? 1`，它就会开始声称 1',
  )
  assert.match(
    notFed[0], /did not report how many workspaces were read/,
    '★ 而它必须【说清为什么没有数字】—— 沉默会让"没喂"与"喂了 0"同形',
  )
  assert.match(notFed[0], /not in any workspace that was checked/, '★ 而"看过的地方都没有"这个结论仍然要说得出来')

  /**
   * ★ 而它与"工作区面整个缺席"【必须不同形】—— 两者的补救动作不同：
   *   前者去接"计数"那一格，后者去接"观察面"本身。
   */
  const noSurface = expectBlocked(await gate(ctx({ observedChangedPaths: [], gitChangedPaths: undefined })))
  assert.match(noSurface[0], /no workspace could be read either/, '★ 面缺席 ⇒ 说"没有第二个面可核对"')
  assert.notDeepEqual(
    notFed[0], noSurface[0],
    '★ "面缺席"与"面在场、只是计数没喂"必须不同形 —— 合成一句会让两种补救动作同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 反向半边 A —— 真的在 worktree 里改了 ⇒ 那条拒绝【不该再出现】
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3 反向半边 A：真的在 worktree 里改过的路径 ⇒ 【不】再被那条拒绝挡住', async () => {
  /**
   * ── 这一臂同时钉住两件事 ────────────────────────────────────────────────────
   *
   *   ① 观察面**真的看到了** worktree（否则断言 ② 在一个瞎的观察面上通过）
   *   ② 判据对那条申报【放行】—— 而那句拒绝不再出现
   *
   * ★ 定向突变：把调用点改回 `gitChangedPaths(workspace)`（t39 干过的那件事）
   *   ⇒ 观察面看不到 worktree ⇒ ② 红。
   */
  const { main } = realLayoutFixture()

  /** ★ 前置：这确实是 f-0023 的布局 —— 主工作区那一份没改。 */
  const mainOnly = gitChangedPaths(main)
  assert.notEqual(mainOnly, undefined, '★ 前置：主工作区是真实仓库 ⇒ 必须有观察')
  assert.equal(
    mainOnly.includes('src/member-only.ts'), false,
    '★ 前置：主工作区里那一份【必须】干净 —— 否则这测的不是"只在 worktree 里改"',
  )

  const observed = observeWorkspaces(main)
  assert.notEqual(observed, undefined, '★ 前置：主工作区读得到 ⇒ 这一格必须有观察')
  assert.equal(
    observed.paths.includes('src/member-only.ts'), true,
    `★ 观察面看不到 worktree 里的改动 —— 那正是 f-0023。实测：${JSON.stringify(observed.paths)}`,
  )
  assert.equal(observed.workspaces, 2, '★ 读了【主工作区 + 1 棵 worktree】= 2 —— 而它必须真的算出来')

  /** ★★ 而它必须让判据放行（端到端，不是"函数返回了对的东西"）。 */
  const verdict = expectOk(await gate(ctx({
    /** ★ 注意：判据读的是 `update.changedPaths`，不是顶层 —— 见 `ctx()`。 */
    update: { changedPaths: ['src/member-only.ts'] },
    observedChangedPaths: [],
    gitChangedPaths: observed.paths,
    observedWorkspaces: observed.workspaces,
  })))
  assert.ok(
    Array.isArray(verdict.verifiedChangedPaths) && verdict.verifiedChangedPaths.includes('src/member-only.ts'),
    '★ 判据必须把那条路径记成【亲眼核实过】的（否则"放行"可能只是没开火）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 反向半边 B —— 零工作却自报路径 ⇒ 【必须仍然红】
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4 反向半边 B（对照）：零工作却自报路径 ⇒ 仍然被拒 —— 观察面变宽【不等于】放宽', async () => {
  /**
   * ── 为什么必须有这一臂 ───────────────────────────────────────────────────────
   *
   *   臂 3 证明"那条拒绝不再出现"。★ 而**取消判据**也能让那条拒绝不出现。
   *   ⇒ 缺了这一臂，"修好了"与"放宽了"在读数上**同形**。
   *
   * ★ 判法：同一个（变宽之后的）观察面，喂一条**它确实没有**的路径 ⇒ 必须红。
   * ★ 定向突变：把 `fabricated` 那个比较去掉（一律放行）⇒ 本臂红。
   */
  const { main } = realLayoutFixture()
  const observed = observeWorkspaces(main)
  assert.notEqual(observed, undefined)

  const blockers = expectBlocked(await gate(ctx({
    /**
     * ★ 这条路径**哪棵树里都没有** —— 它是零工作的典型申报。
     * ★ 而"喂进去的字段名"本身是一个陷阱（见下）：`ctx()` 的默认值在
     *   `update.changedPaths` 里，而顶层那个 `changedPaths` 判据**根本不读**。
     */
    update: { changedPaths: ['src/never-touched-anywhere.ts'] },
    observedChangedPaths: [],
    gitChangedPaths: observed.paths,
    observedWorkspaces: observed.workspaces,
  })))
  assert.equal(blockers.length, 1, '★ 只该报那一条虚构的路径')
  assert.match(blockers[0], /never-touched-anywhere/, '★ 必须指名是哪个文件')
  assert.match(
    blockers[0], /not in any of the 2 workspace\(s\)/,
    '★ 而它报的树数必须是【真的算出来的 2】—— 观察面变宽了，而这句话如实说了看了几棵',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 及物性 —— 读不到的 worktree【不算进"检查过"】
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5 及物臂：读不到的 worktree【不算进"检查过"】—— 计数与路径出自同一次遍历', async () => {
  /**
   * ── 契约那一句的落点 ────────────────────────────────────────────────────────
   *
   *   「读不到的 worktree 不算进『检查过』的（与 :311 的 continue 同一口径）」
   *
   * ★ 为什么：若把"目录存在但读不到"也算进计数，那句话会声称"我检查过它"，
   *   而它其实**没有** —— 又是一次兜底/空头承诺，只是换了个位置。
   *
   * ★ 造法：在主工作区下放一个**不是 git 仓库**的目录当作 worktree ⇒
   *   `gitChangedPaths` 对它返回 `undefined` ⇒ 它必须【不计入】。
   */
  const main = mkdtempSync(join(tmpdir(), 't59-unreadable-'))
  const git = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(main)(['init', '-q', '.'])
  mkdirSync(join(main, 'src'), { recursive: true })
  writeFileSync(join(main, 'src', 'a.ts'), 'x\n')
  git(main)(['add', '-A'])
  git(main)(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  /**
   * ★★ 而"读不到"必须造得【真的读不到】（第一版这里我写错了，实测抓出来）────────
   *
   * MEASURED（本任务）：我第一版放了一个**空目录**当作"读不到的 worktree"，
   * 而实测 `gitChangedPaths` 对它返回 `[]` —— 因为 git 会**向上找到父仓库**。
   * ⇒ 那个目录其实**是可读的**（它真的继承着主仓库）⇒ 把它算进"检查过"是【对的】。
   * ⇒ ★ 所以那不是产线缺陷，是**我的夹具假设错了**。
   *
   * ⇒ 真正的"读不到"要造得 git 确实读不出来：`chmod 000`。
   */
  const brokenWorktree = join(main, '.agent-teams', 'worktrees', 'task-broken')
  mkdirSync(brokenWorktree, { recursive: true })
  execFileSync('chmod', ['000', brokenWorktree])

  try {
    assert.equal(
      gitChangedPaths(brokenWorktree), undefined,
      '★ 前置：这棵 worktree 必须【真的读不到】—— 否则本臂测的是另一件事',
    )
    const observed = observeWorkspaces(main)
    assert.notEqual(observed, undefined, '★ 主工作区读得到')
    assert.equal(
      observed.workspaces, 1,
      '★ 那棵读不到的 worktree 【不许】计入 —— 否则那句话声称"我检查过它"，而它没有。'
      + ` 实测 workspaces=${observed.workspaces}`,
    )
  } finally {
    /** ★ 还原权限，别让临时目录带着 000 留给系统清理。 */
    execFileSync('chmod', ['755', brokenWorktree])
  }

  /**
   * ★★ 及物性的另一半：**权限一还回来，同一棵 worktree 就被计入了** ──────────────
   *
   * MEASURED（本任务，夹具当场抓出来的）：我第一版把这条断言写在 `finally`【之后】，
   * 而那时权限已经还原 ⇒ 那棵 worktree 变得可读 ⇒ 计数是 2 而不是 1。
   * ⇒ ★ 那不是产线缺陷，是**我把断言放在了"另一个状态下"** ——
   *   而它与"计数器算错了"在读数上同形。
   *
   * ★ 所以口径改成**差分**：同一个目录，权限关掉时不计入、还回来时计入。
   *   ⇒ 这样它测的是"读不到 ⇒ 不计入"这个**规则**，而不是某个瞬时快照。
   */
  const restored = observeWorkspaces(main)
  assert.notEqual(restored, undefined)
  assert.equal(
    restored.workspaces, 2,
    '★ 权限还回来之后，同一棵 worktree 必须【被计入】—— 与上面 1 形成差分：'
    + ' 计数的变化只可能来自"它能不能读到"',
  )

  /**
   * ★★ 而"连主工作区都读不到"必须与上面**不同形**：
   *   前者是 `undefined`（补救：接观察面），后者是 `{workspaces: N}`（补救：无）。
   */
  const notARepo = mkdtempSync(join(tmpdir(), 't59-notrepo-'))
  assert.equal(
    observeWorkspaces(notARepo), undefined,
    '★ 不是 git 仓库 ⇒ `undefined`（"没能观察"）—— 而它【绝不】等价于 `{workspaces: 1}`',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★ j-0007 的机械形式 —— 源码里【不许】再有"兜底成 1"那个形状
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6 结构臂（j-0007）：那句话里的数字【不再有兜底值】', async () => {
  /**
   * ── 这一臂判的是【形状】，不是"这次的值对不对" ────────────────────────────────
   *
   *     `ctx?.observedWorkspaces ?? 1` 的形状是：**一个读数位置上放着兜底常量**。
   *     ★ 而它在源码里是可辨认的 —— 于是判据可以是"那种形状还在不在"，
   *       而不是"今天那句话报的数对不对"。
   *
   * ★ 定向突变：把 `?? 1` 加回去 ⇒ 本臂红。
   */
  const { readFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const raw = readFileSync(join(root, 'src', 'gates', 'dispatch', 'changed-paths.ts'), 'utf8')
  /**
   * ★★ 必须先剥注释（第一版没剥，实测抓出来）────────────────────────────────────
   *
   * 这条判据的**说明文字本身**就引用了 `?? 1` 那个形状（作为"它是什么"的示例），
   * ⇒ 不剥注释的话，本臂会在**它自己写下的解释**上变红。
   * ★ 而那正是本队记过的那种误报：**断言测到了注释，而不是代码。**
   */
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  assert.equal(
    /observedWorkspaces\s*\?\?\s*\d/.test(source), false,
    '★ 源码里不许再有 `observedWorkspaces ?? <数字>` —— 那是"兜底值伪装成读数"的形状本身。'
    + ' 而它与"算出来是那个数"在措辞上同形（j-0007）',
  )
  assert.match(
    source, /typeof observedCount === 'number'/,
    '★ 而它必须改成【先问在不在场，再决定说不说数字】—— 那才是"读数"的形态',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★★ 接线臂 —— 调用点用的【必须】是 worktree-aware 的那一个
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 7 接线臂：调用点喂进来的观察面【必须】是 worktree-aware 的 —— 而不是只读主树', async () => {
  /**
   * ── ★★★ 为什么必须有这一臂（它是本任务最贵的一条教训）────────────────────────
   *
   * MEASURED（t59，实测）：上面臂 1~6 全部是**手工喂 ctx** 的 ——
   *   它们证明"判据拿到正确的数就会说对话"，
   *   ★ 而它们【看不见调用点到底喂的是哪一个扫描】。
   *
   *   实测证据：把 `src/tools/update-task.ts` 的那一行改回
   *   `gitChangedPaths(workspace)`（★ 也就是 t39 干过的那件事），
   *   运行本文件的六条臂 ⇒ **6/6 全绿**。
   *
   * ★ 而那是一条真实的覆盖缺口：本任务修的那个缺陷正是
   *   「机制写好了，而**没有调用方**」—— 而"有没有调用方"这件事，
   *   只有【读调用点的源码】或【走真实入口】才看得见。
   *
   * ★★ 而更值得记的是它的形状：
   *     臂 1~6 验证的是【判据】，而那条缺陷在【判据之外的那一行接线】上。
   *   ⇒ **"验证一个单元"与"验证那个单元被用上了"是两件事。**
   *
   * ★ 定向突变：把调用点改回 `gitChangedPaths(workspace)` ⇒ 本臂红（已实测）。
   */
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')

  /**
   * ── ★★★ t86：读数面换成 t39 的**统一口径** ──────────────────────────────────
   *
   * MEASURED：本行此前硬读 `src/tools/update-task.ts`。而 t70 把那个文件拆了 ——
   * ★ 这两条断言要找的两行现在住在 **`src/tools/update-task/dispatch.ts:108/114`**。
   *
   * ★ `toolsSource()` 是 **`src/tools/**` 的递归** ⇒ 自动涵盖拆分后的新文件
   *   ⇒ 下面三条断言**原样通过**（它们问的东西一个字没变）。
   * ★★ 而**不许**改成硬读 `dispatch.ts`：那会把"同一件事"钉死在某个文件里，
   *   下一次拆分又会失效 —— 而那正是本任务的反向半边禁掉的。
   */
  const caller = toolsSource()

  assert.match(
    caller, /gitChangedPaths:\s*observed\?\.paths/,
    '★ 调用点必须喂【worktree-aware 观察面的 paths】。'
    + ' 若它是 `gitChangedPaths(workspace)`，那只读队长那一棵树 ——'
    + ' 而那正是 t39 把 t41 的接线搬回旧版之后的状态（实测：手工喂 ctx 的六条臂全都看不见它）',
  )
  assert.match(
    caller, /observedWorkspaces:\s*observed\?\.workspaces/,
    '★ 而"看了几棵树"必须由【同一次遍历】交出来 —— 两处各算各的会分叉',
  )
  assert.match(
    caller, /observeWorkspaces\(workspace\)/,
    '★ 而那两个值必须来自同一个 `observeWorkspaces(workspace)` 调用（一次遍历、两个事实）',
  )

  /**
   * ★★ 反向半边：**不许**再出现"只读主树"的那个调用。
   *
   *   ★ 而这里必须剥注释 —— 上面那些解释文字里也写着 `gitChangedPaths(workspace)`
   *     （作为"它曾经是什么"的示例），不剥的话本臂会在自己的说明上变红。
   *     ★ 那正是我在臂 6 上踩过一次的同一个坑。
   */
  const code = caller.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(
    /gitChangedPaths:\s*gitChangedPaths\(/.test(code), false,
    '★ 调用点的源码里不许再有 `gitChangedPaths: gitChangedPaths(...)` —— '
    + '那是"只看主树"的形状本身，而它会让那句「every member worktree under it」再次变成空头承诺',
  )
})
