/**
 * ── `commitWorktree` 的夹具（`src/worktree.ts`）──────────────────────────────────
 *
 * ── 它防的是什么失效（2026-10-10 实测）──────────────────────────────────────────
 *
 * 在此之前本插件**只建树、不提交**：
 *
 *     scheduler.ts:839  createTaskWorktree(...)   ← 建了
 *     （成员在里面干活）
 *     （……没有任何地方 commit）
 *
 * ★★ MEASURED（48 棵 worktree 普查）：46 棵里目标文件**一个都没有** ——
 *    因为 worktree 是 checkout 产物，只含**已提交**内容，而成员的改动从未被提交。
 *    ⇒ integrator **没有东西可合**。「合并 ≥2 棵 worktree」在机制上不成立。
 *
 * ── 而这个缺口是【静默】的 ────────────────────────────────────────────────────
 *
 * 它不报错、不失败、每一项读数都正常：
 *   · 成员在那棵树里 `git status` 看得见改动；
 *   · 任务照常 completed（判据读的是成员自报的 changedPaths）；
 *   · 而**从外面看**（主仓、integrator、下游）什么都看不到。
 *
 * ⇒ 与本仓记过的那条同族：**"我改了"与"改动在版本控制里"是两件事**，
 *   而两者在"任务 completed"这个读数上同形。
 *
 * ── 三臂纪律（`docs/GATE-REGISTRY.md` §6）──────────────────────────────────────
 *
 *   臂 1（伪造臂）：树里没有改动 ⇒ **不许**产出空 commit
 *   臂 2（未测量臂）：不是一个 worktree ⇒ 说出"做不到"并带原因（不静默）
 *   臂 3（对照臂）：正常树 ⇒ commit 真的产生，且**内容真的在里面**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { commitWorktree } = await import(join(ROOT, 'lib', 'worktree.js'))

/** 跑 git 并取回 stdout（失败就抛，调用方负责）。 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * 造一个【真的 git 仓库 + 真的 worktree】。
 *
 * ★ 不 mock git：这个机制的全部内容就是"git 真的提交了没有"，
 *   而 mock 会让夹具测的是它自己的假设（本仓记账过的那条）。
 */
function scratchRepo() {
  const base = mkdtempSync(join(tmpdir(), 'commit-wt-'))
  const repo = join(base, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  git(repo, ['add', '-A'])
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'])

  const tree = join(base, 'worktree')
  git(repo, ['worktree', 'add', '--detach', tree, 'HEAD'])
  return { base, repo, tree, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 伪造臂 —— 没有改动 ⇒ 不许产出空 commit
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1（伪造臂）：树里没有改动 ⇒ 不产出空 commit，且说清是"没有改动"', () => {
  /**
   * ── 为什么这是最重要的一条 ────────────────────────────────────────────────────
   *
   * 一个"总是提交"的实现，会在**没有改动时**产出一个空 commit。
   * 而空 commit 会让两件**处置完全不同**的事同形：
   *
   *   · "这次什么都没改"    ⇒ integrator 应当跳过它
   *   · "改了，已提交"      ⇒ integrator 应当合它
   *
   * ★ integrator 看到的是一个 commit —— 它**没法从 commit 本身**分辨那个是空的。
   *   ⇒ 所以必须在**产出侧**就不产它。
   *
   * 定向突变：把 `if (lines.length === 0) return …` 那一句删掉 ⇒ 本臂红。
   */
  const { tree, cleanup } = scratchRepo()
  try {
    const before = git(tree, ['rev-parse', 'HEAD'])
    const r = commitWorktree({ worktree: tree, taskId: 't-clean' })

    assert.equal(r.ok, true, '★ "没有改动"不是失败')
    assert.equal(r.commit, undefined, '★★★ 不许产出空 commit')
    assert.equal(r.filesChanged, 0)
    assert.equal(r.reason, 'no changes to commit', '★ 必须说清是哪一种"ok"')

    const after = git(tree, ['rev-parse', 'HEAD'])
    assert.equal(after, before, '★★ HEAD 一动没动 —— 这才是"没有空 commit"的硬证据')
  } finally { cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 未测量臂 —— 不是一个 worktree ⇒ 带原因地说"做不到"
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（未测量臂）：路径不是一个 worktree ⇒ ok:false 且带原因（不静默）', () => {
  /**
   * ★ 「做不到」必须与「做到了但没有改动」**不同形** —— 两者都"没产出 commit"，
   *   而处置完全相反（一个去查环境，一个是正常结论）。
   *   定向突变：把 `.git` 检查去掉 ⇒ 本臂红（它会对一个非仓库路径报 no changes）。
   */
  const dir = mkdtempSync(join(tmpdir(), 'not-a-wt-'))
  try {
    const r = commitWorktree({ worktree: dir, taskId: 't-x' })
    assert.equal(r.ok, false, '★ 不是 worktree ⇒ 失败')
    assert.match(r.reason, /not a worktree/i, '★ 原因必须指向"这不是树"，而不是"没有改动"')

    const missing = commitWorktree({ worktree: join(dir, 'nope'), taskId: 't-y' })
    assert.equal(missing.ok, false, '★ 路径不存在同样失败')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 对照臂 —— 正常树 ⇒ commit 真的产生，且【内容真的在里面】
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（对照臂）：有改动 ⇒ 真的产生 commit，且改动内容在 git 里读得回来', () => {
  /**
   * ★★ 判据不是"返回了 ok" —— 而是**从 git 里把内容读回来**。
   *   一个只返回 `{ok:true}` 却不真提交的实现，会让这条臂在
   *   "返回值"这一层照样绿 ⇒ 必须落到 `git show`。
   */
  const { tree, cleanup } = scratchRepo()
  try {
    const countBefore = git(tree, ['rev-list', '--count', 'HEAD'])
    writeFileSync(join(tree, 'deliverable.txt'), 'the work\n')
    const r = commitWorktree({ worktree: tree, taskId: 't-done', attemptId: 'a-1', author: 'worker-1' })

    assert.equal(r.ok, true)
    assert.equal(typeof r.commit, 'string', '★ 必须回传短 id（integrator 要靠它寻址）')
    assert.equal(r.filesChanged, 1)

    /** ★ 硬证据：从 git 里把那个文件读回来。 */
    const content = git(tree, ['show', `HEAD:deliverable.txt`])
    assert.equal(content, 'the work', '★★★ 改动必须真的在 commit 里')

    /** ★ 归属行在场 —— 否则"这个 commit 是哪一次尝试造的"无从回答。 */
    const message = git(tree, ['log', '-1', '--format=%B'])
    assert.match(message, /task\(t-done\)/, '★ commit message 要能归属到任务')
    assert.match(message, /Attempt: a-1/, '★ 有 attemptId 时写进去')
    assert.match(message, /Author: worker-1/, '★ 有 author 时写进去')

    /**
     * ★ 而 HEAD 真的前进了 —— 用**读出来的基线**比，不用算出来的数。
     *
     * ★★ MEASURED（本臂第一版在这里红）：我写的期望是 `'2'` ——
     *   而 worktree 是从 HEAD **detach** 出来的，它一出生就带着主仓那
     *   **2 个** commit（init + base）⇒ 提交后是 **3**。
     *   ⇒ 教训：**基线要【读】，不要【算】** —— 算出来的那个数会把
     *     "我数漏了一个"伪装成"没提交"。
     */
    assert.equal(git(tree, ['rev-list', '--count', 'HEAD']), String(Number(countBefore) + 1),
      '★ commit 数必须正好 +1')
  } finally { cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ 新增文件臂 —— `git add -A` 必须收下【未跟踪】文件
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（新增文件臂）：未跟踪的新文件必须被收下（add -u 会静默漏掉它们）', () => {
  /**
   * ★ 新文件是任务产物里**最常见**的一类。
   *   而 `git add -u` 只加已跟踪的 ⇒ "提交成功"与"提交了个空"同形。
   *   定向突变：把 `add -A` 改成 `add -u` ⇒ 本臂红。
   */
  const { tree, cleanup } = scratchRepo()
  try {
    mkdirSync(join(tree, 'new-dir'), { recursive: true })
    writeFileSync(join(tree, 'new-dir', 'brand-new.ts'), 'export const x = 1\n')
    const r = commitWorktree({ worktree: tree, taskId: 't-new' })
    assert.equal(r.ok, true)
    assert.equal(git(tree, ['show', 'HEAD:new-dir/brand-new.ts']), 'export const x = 1',
      '★ 未跟踪的新文件必须进 commit')
  } finally { cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 删除臂 —— 删除也是一次改动
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（删除臂）：删掉一个已跟踪文件也必须被提交（删了 ≠ 没改动）', () => {
  /**
   * ★ 与臂 4 同族：`git add -u` 会收下删除，而一个"只看有没有新文件"的实现会漏。
   *   而"我删了它"与"我什么都没做"在 `git status` 上不同形，在 commit 里也必须不同形。
   */
  const { tree, cleanup } = scratchRepo()
  try {
    rmSync(join(tree, 'base.txt'))
    const r = commitWorktree({ worktree: tree, taskId: 't-del' })
    assert.equal(r.ok, true)
    assert.equal(r.filesChanged, 1)
    /** ★ 硬证据：那个文件在新的 HEAD 里【不存在】。 */
    let gone = false
    try { git(tree, ['show', 'HEAD:base.txt']) } catch { gone = true }
    assert.equal(gone, true, '★ 删除必须真的进 commit')
  } finally { cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★ 归属缺省臂 —— 没有 attemptId / author 时【不编造】
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（归属缺省臂）：未提供 attemptId/author ⇒ 那两行【不出现】，而不是写 unknown', () => {
  /**
   * ★ 与全仓三态纪律同源：**"我不知道归属"与"归属就是 unknown"必须不同形**。
   *   编一个 `Attempt: unknown` 会让下游把它当成一次真实的尝试。
   */
  const { tree, cleanup } = scratchRepo()
  try {
    writeFileSync(join(tree, 'x.txt'), 'x\n')
    commitWorktree({ worktree: tree, taskId: 't-noattr' })
    const message = git(tree, ['log', '-1', '--format=%B'])
    assert.doesNotMatch(message, /Attempt:/, '★ 没有 attemptId ⇒ 不写 Attempt 行')
    assert.doesNotMatch(message, /Author:/, '★ 没有 author ⇒ 不写 Author 行')
    assert.match(message, /task\(t-noattr\)/, '★ 而任务归属仍在（它总是已知的）')
  } finally { cleanup() }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★ 接线臂 —— `update_task` 落终态时真的调它
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7（接线臂）：`update_task` 在落终态时调用 commitWorktree，且路径是【推导】的', () => {
  /**
   * ★ 本仓记账最多的形态之一：「机制建好了，中间那一格没接上」。
   *   一个从不被调用的 commitWorktree 与"没有这个函数"在读数上同形。
   *
   * ★★ 而**路径推导**这一格是被 typecheck 逼出来的：
   *   `task.worktreePath` **不存在于 TeamTask**（它只活在派发时的内存 ticket 里），
   *   所以本层**拿不到**它。⇒ 改用 `createTaskWorktree` 的确定性命名推导。
   *   定向突变：把它改回 `task.worktreePath` ⇒ typecheck 红（TS2339）。
   */
  const src = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  /**
   * ★ 剥掉注释再搜 —— 否则**解释这个坑的那段注释**本身会被当成"还在依赖它"。
   *   MEASURED（本臂第一版就是这么红的）：我在实现里写了一段
   *   "`task.worktreePath` 不存在于 TeamTask" 的注释，
   *   而 `doesNotMatch(/task\.worktreePath/)` 命中了那句注释 ⇒ 假红。
   */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  assert.match(code, /import \{ commitWorktree(, worktreeDirName)? \} from '\.\.\/worktree\.ts'/, '★ import 要在场')
  assert.match(code, /commitWorktree\(\{/, '★ 必须真的被调用')
  /**
   * ★★ 路径由 `worktreeDirName` 算（**建树与找树共用那一份真值**）。
   *
   * MEASURED（本臂第二版在这里红）：第一版断言的是内联的
   *   ``join(workspace, '.agent-teams', 'worktrees', `task-${safeId}`)``,
   * 而后团队前缀那一位被抽出成 `worktreeDirName(fresh.id, task.id)` ——
   * **夹具跟着实现漂移了**。改成钉"用了那个共享函数"，而不是钉字面写法。
   *   定向突变：把它改回自己拼字符串 ⇒ 臂 12 红（而本臂也红）。
   */
  assert.match(
    code,
    /join\(workspace, '\.agent-teams', 'worktrees', worktreeDirName\(fresh\.id, task\.id\)\)/,
    '★ 路径必须由 repo + taskId 【推导】，且经 worktreeDirName（与建树共用一份真值）',
  )
  assert.doesNotMatch(code, /task\.worktreePath/, '★★ 不许依赖那个不存在的字段')
  /** ★ 而 deliverableCommit 要落进任务记录（否则产物不可寻址）。 */
  assert.match(code, /task\.deliverableCommit = committed\.commit/, '★ 提交 id 必须落进记录')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：★★★ 静默臂 —— 「本来不该建树」与「该建树而没建成」必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 9（静默臂）：「不该建树」不许盖住「该建树而没建成」', () => {
  /**
   * ── 这条是 e2e-worker 在真实任务上抓到的（它是对的）────────────────────────────
   *
   * MEASURED（2026-10-10）：本分支的第一版是裸的
   *     `if (existsSync(<worktree>/.git)) { …commit… }`
   * —— **条件为假时整段静默**：不产 commit，也**不产任何读数**。
   *
   * ★★ 而两件**处置完全相反**的事因此在读数上同形：
   *     · `work` / `review` / `requirements` ⇒ **设计如此**（不建树），什么都别做；
   *     · `implementation` 却没有树      ⇒ ★ **真缺陷**，要去查为什么没建。
   *
   * ⇒ 判据必须按 `needsWorktreeFor(task.kind)`（**应当**有树吗）分，
   *   而不是按"路径在不在"（实际有树吗）—— 后者把设计当成了故障。
   *
   * 定向突变：把 `else if (shouldHaveWorktree)` 那一支删掉 ⇒ 本臂红。
   */
  const src = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  assert.match(code, /import \{ needsWorktreeFor \} from '\.\.\/types\.ts'/,
    '★ 判据必须来自 types.ts 的单一来源（不在这里再写一份 kind 列表）')
  assert.match(code, /const shouldHaveWorktree = needsWorktreeFor\(task\.kind\)/,
    '★ 必须问「应当有树吗」，而不是「路径在不在」')
  assert.match(code, /else if \(shouldHaveWorktree\) \{/,
    '★★★ 该建树而没建成 ⇒ 必须有一支【独立的】读数（否则设计会盖住缺陷）')
  /** ★ 那一支要让"交付无法被 integrator 取到"这件事可读。 */
  assert.match(code, /could not be committed and cannot be reached by an integrator/,
    '★ 措辞必须说清后果：integrator 取不到')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★★ 纪律臂 —— 提交失败【不改判】
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 8（纪律臂）：提交失败不许把任务改判，且不得静默', () => {
  /**
   * ── 这条与「一次合格的交付」直接相关 ──────────────────────────────────────────
   *
   * 提交是**记账**，不是**裁决**。把"记账失败"读成"交付失败"，
   * 会让成员去**重做已经做对的工作** —— 而那正是本仓最贵的一类浪费。
   *
   * ★ 所以：失败走 `deliveryFailure`（一条**可读的**记录），
   *   而 `task.status` 保持调用方给的那个值。
   *   定向突变：把那一支改成 `throw` ⇒ 本臂红（拒绝会更坏：交付直接交不上）。
   */
  const src = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  const region = src.slice(src.indexOf('const landedTerminal'), src.indexOf('if (args.output !== undefined)'))
  assert.ok(region.length > 0, '前置：定位到那段')
  assert.match(region, /deliveryFailure = \{/, '★ 失败必须留痕')
  assert.match(region, /ctx\.logger\.warn/, '★ 且日志里有一条')
  assert.doesNotMatch(region, /throw new Error\(.*commit/i, '★★ 提交失败不许 throw（那会让交付交不上）')
  assert.doesNotMatch(region, /task\.status = 'failed'/, '★★ 不许改判')
  /** ★ 而"没有改动"与"失败"两支必须分开。 */
  assert.match(region, /had no worktree changes to commit/, '★ 没有改动是一支独立的话')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10-11：★★★ 任务 worktree 的【归属】（2026-10-10，两条链独立报出的缺陷）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这两条臂钉的是什么 ────────────────────────────────────────────────────────
 *
 * MEASURED：新团队 merge-e2e 的 t1/t2，成员拿到的树里**没有任务的靶子文件**。
 * 实测它们的 HEAD：
 *     task-t1 = d623cbd   ← 上一轮 integrate-probe2 的链 A 产物
 *     task-t2 = 451c06d   ← 上一轮 integrate-probe2 的链 B 产物
 *     而当时 HEAD = c70cf12
 *
 * ★ 根因：**任务 id 按团队重新计数**（每个团队的 t1 都叫 `t1`），
 *   而路径名只用 `task-<taskId>` ⇒ 新团队的同名任务命中
 *   `createTaskWorktree` 的「已建过 ⇒ 复用」分支 ⇒ **拿到上一轮那棵树**。
 *   而 `delete` 一个团队**不清理 worktree**（目录留着）。
 *
 * ★★ 最坏的地方是它在读数上完全正常：`ok: true`、`base` 有值、目录在 ——
 *   **"复用了对的树"与"复用了别人的树"同形。**
 *
 * ★ 修法：把 `teamId` 编进路径（在根上避免重名，而不是事后校验归属）。
 */

const { worktreeDirName } = await import(join(ROOT, 'lib', 'worktree.js'))

test('★★★ 臂 10（归属臂）：两个团队的同名任务必须落到【不同的】目录', () => {
  /**
   * ── 这一条就是那个缺陷的判据 ──────────────────────────────────────────────────
   *
   * 定向突变：把 `worktreeDirName` 里的 teamId 去掉（回到 `task-<taskId>`）
   *   ⇒ 两条断言都红。
   */
  const a = worktreeDirName('merge-e2e', 't1')
  const b = worktreeDirName('integrate-probe2', 't1')
  assert.notEqual(a, b, '★★★ 同名任务在不同团队下必须落到不同目录（否则会复用别人的树）')
  assert.match(a, /merge-e2e/, '★ 目录名必须带上 teamId（可读，人能从 ls 看出归属）')
  assert.match(b, /integrate-probe2/, '★ 另一个团队同理')

  /** ★ 而同一团队的同一任务必须**稳定** —— 否则重试会另建一棵树。 */
  assert.equal(a, worktreeDirName('merge-e2e', 't1'), '★ 同一 (team, task) 必须得到同一个名字')
})

test('★★ 臂 11（兼容臂）：不给 teamId 时保持旧形状 —— 且仍然是 task- 前缀', () => {
  /**
   * ★ 两件事都要：
   *   ① 缺省形状不变（夹具与老调用方依赖 `task-<id>`）；
   *   ② 仍以 `task-` 开头 —— 因为 `team-stall-check.mjs` 与 reclaim 的扫描
   *      用 `startsWith('task-')` 数盘上的树。改了前缀会让那些读数静默变成 0。
   */
  assert.equal(worktreeDirName(undefined, 't1'), 'task-t1', '★ 无 teamId ⇒ 保持旧形状')
  assert.equal(worktreeDirName('', 't1'), 'task-t1', '★ 空串同理（不编假前缀）')
  assert.ok(worktreeDirName('merge-e2e', 't1').startsWith('task-'),
    '★★ 新形状也必须以 task- 开头 —— 否则盘上 worktree 的扫描会静默变成 0')
})

test('★★ 臂 12（接线臂）：两个调用点都用【同一个】函数算路径', () => {
  /**
   * ★ 建树（scheduler）与找树（update_task 的自动提交）必须用同一份真值。
   *   两处各写一遍会在团队前缀那一位上分叉，而分叉的表现是"找不到树"——
   *   与"这条任务本来就不建树"同形（本仓记账过的那条）。
   */
  const scheduler = readFileSync(join(ROOT, 'src', 'scheduler.ts'), 'utf8')
  assert.match(scheduler, /createTaskWorktree\(\{ repo: workspace, taskId: ticket\.taskId, teamId: team\.id \}\)/,
    '★ scheduler 必须把 teamId 传给建树')

  const updateTask = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  assert.match(updateTask, /worktreeDirName\(fresh\.id, task\.id\)/,
    '★★ update_task 必须用【同一个】worktreeDirName 算路径，而不是自己拼字符串')
  assert.doesNotMatch(updateTask, /`task-\$\{safeId\}`/,
    '★★ 不许自己拼 task-<id>（那正是分叉的来源）')
})
