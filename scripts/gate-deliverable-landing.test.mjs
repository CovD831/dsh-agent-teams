/**
 * ── 「哪些产物还没进主干」的臂（2026-10-20）────────────────────────────────────
 *
 * ── 它修的是什么 ──────────────────────────────────────────────────────────────
 *
 * `docs/WORKTREE-BASE-DEFECT.md` 曾记「`deliverableCommit` 只有两处：一处写、一处声明。
 * **零读者**」。★ 那句话**已经过期**：`scheduler.ts` 的 `collectUpstreamBaselines`
 * 把它交给下游当基线，`worktree.ts` 的 `resolveWorktreeBaseline` 把短 id 解析成
 * 完整对象名。⇒ 真正缺的是**另一个问句**：**这个队的产物，有多少已经进了主干？**
 *
 * MEASURED（2026-10-20，本仓 78 个 `deliverableCommit`）：
 * ```
 *   merge-base --is-ancestor <commit> HEAD   ⇒   4 个
 *   按 absorbPlanOf 的四态口径                ⇒  46 个
 * ```
 * ⇒ ★★ 只问"是不是祖先"会把 **42 份早已落盘的工作**报成"没合流"（93% 的误报）。
 *   那不是保守 —— 那是一句**关于没有发生过的事情的主张**。
 *
 * ── 三臂（契约 §6）在本文件里各自是什么 ───────────────────────────────────────
 *
 *   臂 1（伪造臂）：产物真的没进主干 ⇒ `not-landed`，且**不是** unreadable
 *   臂 2（未测量臂）：commit 解析不出 ⇒ `unreadable`，★ 与 `not-landed` 不同形
 *   臂 3（对照臂）：产物已合流 ⇒ `landed`，且 `how` 说清是**哪一种**吸收
 *   臂 4（★ 本文件最贵的一条）：**同一份判据** —— `absorbPlanOf` 与
 *          `judgeWorktreeReclaimable` 对同一棵树给出**同一个** `absorbed` 结论
 *   臂 5（接线臂）：`status` 真的把这一格交出去
 *
 * ★ 每一条都对着一次定向突变（写在各自注释里）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { deliverableLandingFor, summariseDeliverableLanding, absorbPlanOf, judgeWorktreeReclaimable } = await import(join(ROOT, 'lib', 'worktree.js'))

const cleanups = []
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

/** 一个一次性仓库：主干一个提交，产物分叉出去、再回到主干。 */
function repoFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'landing-'))
  cleanups.push(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'a@b'])
  git(repo, ['config', 'user.name', 'a'])
  writeFileSync(join(repo, 'src-a.ts'), 'base\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'init'])
  return repo
}

/** 一条带 `deliverableCommit` 的最小任务。 */
const taskWith = (id, commit) => ({ id, subject: id, status: 'completed', dependencies: [], createdAt: 1, updatedAt: 1, deliverableCommit: commit })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 伪造臂）：产物真的没进主干
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（伪造臂）：产物只在一条侧分支上 ⇒ not-landed，**不是** unreadable', () => {
  const repo = repoFixture()
  /** 侧分支上的一次提交（不在主干里）。 */
  git(repo, ['checkout', '-q', '-b', 'side'])
  writeFileSync(join(repo, 'src-b.ts'), 'side work\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'side only'])
  const side = git(repo, ['rev-parse', '--short', 'HEAD'])
  git(repo, ['checkout', '-q', '-'])

  const readout = deliverableLandingFor({ repo, tasks: [taskWith('t1', side)] })
  assert.equal(readout.status, 'measured', '★ 读得到 ⇒ measured')
  assert.equal(readout.total, 1)
  assert.equal(readout.notLanded, 1, '★ 它没进主干 ⇒ not-landed')
  assert.equal(readout.landed, 0)
  assert.equal(readout.unreadable, 0, '★★ 它**不是** unreadable —— 解析得出来，只是没落盘')
  assert.equal(readout.entries[0].status, 'not-landed')
  assert.equal(readout.entries[0].how, undefined, '★ 没落盘就没有"怎么落盘的"')
  assert.ok((readout.entries[0].why ?? '').length > 0, '★ 必须说清为什么不算落盘')
  assert.equal(readout.entries[0].sourceFiles, 1, '★ 源码文件数要说得出（构建产物已排除）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 未测量臂）：解析不出 ⇒ unreadable，与 not-landed 不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（未测量臂）：commit 解析不出 ⇒ unreadable，**绝不**并进 not-landed', () => {
  const repo = repoFixture()
  const readout = deliverableLandingFor({ repo, tasks: [taskWith('t1', 'deadbeefdeadbeef')] })
  assert.equal(readout.unreadable, 1, '★ 解析不出 ⇒ unreadable')
  assert.equal(readout.notLanded, 0, '★★ 它**不是** not-landed：两者补救动作相反（去查 vs 去合流）')
  assert.equal(readout.entries[0].status, 'unreadable')
  assert.match(readout.entries[0].why ?? '', /does not resolve/, '★ 成因必须说清')
})

test('★★★ 臂 2b（未测量臂）：主干读不到 ⇒ 整份 unmeasured，**不是**"零条未合流"', () => {
  /**
   * ★ 这一支防的是"读不到主干就当全都落盘了"：那会让交付那一刻的读数说
   *   "全部已合流"，而实际上**一次比较都没发生**。
   *   定向突变：把这一支改成 `summariseDeliverableLanding([])` ⇒ 本臂红。
   */
  const readout = summariseDeliverableLanding([], { trunkUnreadable: 'no trunk ref could be resolved' })
  assert.equal(readout.status, 'unmeasured')
  assert.match(readout.why ?? '', /no trunk ref/)
  /** ★ 而**没有产物**是完全不同的一格：measured + total 0。 */
  const empty = summariseDeliverableLanding([])
  assert.equal(empty.status, 'measured', '★ "这个队没有可交付的产物"是一个**结论**，不是一次读取失败')
  assert.equal(empty.total, 0)
  assert.notEqual(empty.status, readout.status, '★★ 两者必须不同形')
})

test('★★★ 臂 2c（未测量臂·真实路径）：主干解析不出 ⇒ `deliverableLandingFor` 答 unmeasured', () => {
  /**
   * ── ★ 为什么这一臂必须存在（它是**定向突变打出来的**）──────────────────────────
   *
   * 第一版只有 `summariseDeliverableLanding(…, {trunkUnreadable})` 那一条纯函数臂，
   * 而把 `deliverableLandingFor` 里"主干读不到 ⇒ 传 `trunkUnreadable`"那一支
   * 改成 `summariseDeliverableLanding([])` ⇒ **零条红**。
   *
   * ★★ 那次"突变不红"本身就是读数：那条臂测的是**折数函数**收不收到参数，
   *   而没测**调用方会不会传**它 —— 于是"主干读不到被当成零条未合流"这件事
   *   可以整体发生而全部臂仍绿。★ 这正是本仓记过的那类合流
   *   （"没测到"并进"通过"）在**测试层**的同一个形状。
   *
   * ⇒ 现在从**真实入口**进：一个不是 git 仓库的目录 ⇒ `resolveTrunkRef` 答 unresolved
   *   ⇒ 整份读数必须 `unmeasured`，而**不是**一个 `measured + total: 0`。
   */
  const notARepo = mkdtempSync(join(tmpdir(), 'landing-norepo-'))
  cleanups.push(notARepo)
  const readout = deliverableLandingFor({ repo: notARepo, tasks: [taskWith('t1', 'deadbeef')] })
  assert.equal(readout.status, 'unmeasured', '★★ 主干读不到 ⇒ 整份 unmeasured')
  assert.ok((readout.why ?? '').length > 0, '★ 必须说清为什么判不了')
  assert.equal(readout.landed, 0, '★ 而它不是"全都落盘了"')
  /**
   * ★★ 与"这个队没有产物"必须不同形：后者是 `measured` + `total: 0`。
   *   定向突变：把那一支改成 `summariseDeliverableLanding([])` ⇒ 本臂红。
   */
  assert.notEqual(readout.status, 'measured', '★★ "判不了"绝不许与"没有产物"同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 对照臂）：已合流 ⇒ landed + how
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（对照臂）：产物进了主干 ⇒ landed，且 `how` 说清**哪一种**吸收', () => {
  const repo = repoFixture()
  /** 侧分支上提交，然后**真 merge** 进主干 ⇒ how === 'ancestor'。 */
  git(repo, ['checkout', '-q', '-b', 'side'])
  writeFileSync(join(repo, 'src-b.ts'), 'side work\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'side work'])
  const side = git(repo, ['rev-parse', '--short', 'HEAD'])
  git(repo, ['checkout', '-q', '-'])
  git(repo, ['merge', '-q', '--no-ff', 'side', '-m', 'merge side'])

  const readout = deliverableLandingFor({ repo, tasks: [taskWith('t1', side)] })
  assert.equal(readout.landed, 1, '★ 真的并进去了 ⇒ landed')
  assert.equal(readout.notLanded, 0)
  assert.equal(readout.entries[0].how, 'ancestor', '★ 依据必须是 `ancestor`（复核动作：查 merge）')
})

test('★★ 臂 3b（对照臂）：**手工按文件落盘**（cherry-pick 式的另一种对象）⇒ 仍然 landed', () => {
  /**
   * ── ★★★ 这一臂是本文件的**全部理由** ──────────────────────────────────────────
   *
   * MEASURED：真实合流**不是 merge，是按文件落盘** —— commit 对象不同，
   * `--is-ancestor` 永远答 false。而本仓实测 78 个产物里 **42 个**正是这种形态。
   * ⇒ 一个只问 `--is-ancestor` 的实现会把它们全部报成"没合流"。
   *   定向突变：把 `absorbPlanOf` 里 `containedAbsorbed` 一项去掉 ⇒ 本臂红。
   */
  const repo = repoFixture()
  git(repo, ['checkout', '-q', '-b', 'side'])
  writeFileSync(join(repo, 'src-c.ts'), 'hand-lifted work\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'side work'])
  const side = git(repo, ['rev-parse', '--short', 'HEAD'])
  git(repo, ['checkout', '-q', '-'])
  /** ★ 手工落盘：同样的字节，**另一次提交**。 */
  writeFileSync(join(repo, 'src-c.ts'), 'hand-lifted work\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'hand-lifted'])

  const isAncestor = spawnSync('git', ['merge-base', '--is-ancestor', side, 'HEAD'], { cwd: repo, stdio: 'ignore' }).status === 0
  assert.equal(isAncestor, false, '★ 前提：它不是祖先（否则这一臂测不到要测的东西）')

  const readout = deliverableLandingFor({ repo, tasks: [taskWith('t1', side)] })
  assert.equal(readout.landed, 1, '★★ 手工落盘也是落盘 —— 不许报成"没合流"')
  assert.notEqual(readout.entries[0].how, 'ancestor', '★ 依据不是 ancestor（它不是祖先）')
  assert.ok(['content', 'files', 'contained'].includes(readout.entries[0].how), `★ 但必须是另外三种之一，实测：${readout.entries[0].how}`)
  /**
   * ── ★★★ 而"哪三种之一"**必须钉死**（定向突变打出来的第二条）───────────────
   *
   * 把 `how` 恒写成 `'ancestor'` ⇒ 上面三条**照样全绿**（`notEqual('ancestor')` 会红……
   * ★ 而第一版这里写的是 `notEqual`，所以它**确实**红了 —— 但只在**这一臂**上，
   *   而臂 4 那条"两条路径同一个 how"仍然是绿的，因为它只比 'ancestor'。
   * ⇒ 这一条把**这一格**也钉死。
   *
   * ★★ 而实测给出的答案是 `'content'`，**不是**我预期的 `'files'` —— 那是对的：
   *   这次"手工落盘"提交与侧分支那次提交**改动的字节完全相同**，于是
   *   `git patch-id --stable` 命中（形态 Ⅱ），而形态 Ⅱ 排在 Ⅲ 之前。
   *   ★ 我按**实测**改断言，而不是按预期改代码 —— 反过来做就是把"哪个更强"
   *     这件事交给我的印象，而它恰恰有一个机械答案。
   *   ★ 三种依据的**复核动作不同**（查 cherry-pick / 逐文件比对 / 查历史可达性），
   *     所以"是哪一种"必须读得出来。
   */
  assert.equal(
    readout.entries[0].how, 'content',
    "★★★ 改动字节相同 ⇒ patch-id 命中 ⇒ `content`（实测）。"
    + " 若哪天这里变成 `files`/`contained`，说明判据的**依据顺序**变了 —— 那要单独说明。",
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★★ 同一份判据臂）：抽出前后**同一个**结论
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4：`absorbPlanOf` 与 `judgeWorktreeReclaimable` 对同一棵树给**同一个**结论', () => {
  /**
   * ── ★ 为什么这一臂必须存在 ────────────────────────────────────────────────────
   *
   * 本任务把吸收判据从 `judgeWorktreeReclaimable` 里**抽出来**（好让树被回收之后
   * 也能问）。而"抽出来"最危险的错法是**抄一份**：两份判据必然分叉，分叉之后
   * 「回收时算已吸收、交付时说没合流」会成为一个新的、更难查的不一致。
   *
   * ⇒ 这一臂直接对拍两条路径：**同一棵树、同一个主干**，
   *   `judgeWorktreeReclaimable` 的 `absorbed` 与 `absorbPlanOf` 的 `absorbed`
   *   必须是**同一个值**，`how` 也必须**同一格**。
   * ★ 定向突变：把 `judgeWorktreeReclaimable` 改回内联一份判据 ⇒ 本臂仍然绿
   *   （两份此刻一致），**但**下一个人改一处就会红 —— 那正是这一臂的价值。
   */
  const repo = repoFixture()
  git(repo, ['checkout', '-q', '-b', 'side'])
  writeFileSync(join(repo, 'src-d.ts'), 'work\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'side'])
  const sideHead = git(repo, ['rev-parse', 'HEAD'])
  git(repo, ['checkout', '-q', '-'])
  /**
   * ── ★★★ 必须是**手工落盘**，不能是 merge（这一格是定向突变打出来的）───────
   *
   * 第一版这里写的是 `git merge --no-ff` ⇒ 产物真成了祖先 ⇒ 两条路径都答
   * `ancestor`。而把 `judgeWorktreeReclaimable` 改成"再与 `isAncestorOrFail` 取合取"
   * ⇒ **零条红**：在"是祖先"这一类上，任何**额外要求**都照样成立。
   *
   * ★★ 所以这一臂必须落在**不是祖先**的那一类上 —— 真实的 42/78 正是这一类，
   *   也是"抽出来的判据必须与原来同一份"唯一可能被打破的地方。
   *   手工落盘：同样的字节，**另一次提交**。
   */
  writeFileSync(join(repo, 'src-d.ts'), 'work\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'hand-lifted'])

  const worktree = mkdtempSync(join(tmpdir(), 'landing-wt-'))
  cleanups.push(worktree)
  git(repo, ['worktree', 'add', '--detach', worktree, sideHead])
  try {
    const verdict = judgeWorktreeReclaimable({ repo, worktree })
    assert.equal(verdict.status, 'reclaimable', `★ 前提：这条裁决必须是 reclaimable，实测 ${verdict.status}`)
    const plan = absorbPlanOf({ repo, commit: sideHead, trunk: git(repo, ['rev-parse', 'HEAD']) })
    assert.equal(plan.absorbed, true, '★ 两条路径必须同意"已吸收"')
    if (verdict.status === 'reclaimable') {
      assert.equal(plan.how, verdict.how, `★★ 连"哪一种"都必须同一格（实测 ${plan.how} vs ${verdict.how}）`)
    }
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo, stdio: 'ignore' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 接线臂）：`status` 真的把这一格交出去
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（接线臂）：`agent_teams_status` 真的交出 `deliverable_landing`', async () => {
  const { registerAgentTeamsTools } = await import(join(ROOT, 'lib', 'tools.js'))
  const { createTeamDir } = await import(join(ROOT, 'lib', 'state.js'))
  const workspace = mkdtempSync(join(tmpdir(), 'landing-status-'))
  cleanups.push(workspace)
  git(workspace, ['init', '-q'])
  git(workspace, ['config', 'user.email', 'a@b'])
  git(workspace, ['config', 'user.name', 'a'])
  writeFileSync(join(workspace, 'x.txt'), 'x\n')
  git(workspace, ['add', '-A'])
  git(workspace, ['commit', '-qm', 'init'])

  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'Landing', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 0,
    members: [{ id: '', name: 'w', role: 'w', joinedAt: 1, status: 'idle' }],
    tasks: [{ id: 't1', subject: 's', status: 'completed', dependencies: [], createdAt: 1, updatedAt: 1, kind: 'work', deliverableCommit: 'deadbeefdeadbeef' }],
  })
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: { getProvider() { return undefined }, list() { return [] }, sendMessage: async () => 'm', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'm' },
    agents: { list: () => [], get() { return undefined } }, on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const out = await tools.get('agent_teams_status').execute({}, {
    agent: { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
    signal: new AbortController().signal,
  })
  assert.ok(out.deliverable_landing !== undefined, '★ 这一格必须出现在返回值里（一个没人读的读数与没有它同形）')
  /**
   * ★ 它是 `JSON.stringify` 过的**文本**（与该文件 `gate_evaluation` 同一做法：
   *   interface 没有隐式索引签名，塞对象过不了 `Record<string, JsonValue>`）。
   *   ⇒ 要先解回来再断言，否则这一臂读的是一段字符串而"看起来对"。
   */
  assert.equal(typeof out.deliverable_landing, 'string', '★ 产出面是文本（与 gate_evaluation 同形）')
  const landing = JSON.parse(out.deliverable_landing)
  assert.equal(landing.status, 'measured', '★ 三态之一')
  assert.equal(landing.unreadable, 1, '★ 那个假 commit 必须落 unreadable（与 not-landed 不同形）')
  assert.equal(landing.notLanded, 0, '★★ 它**不是** not-landed —— 两者补救动作相反')
})
