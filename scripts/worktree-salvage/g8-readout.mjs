#!/usr/bin/env node
/**
 * ── G8 读数：同一份判据，两条调用路径的安全性不同 ───────────────────────────────
 *
 * 缺陷原话（队长记账，`docs/DEFECT-*.md` G8）：
 *   `planReclaim` 扫的是**整棵** `.agent-teams/worktrees/`（`listWorktrees` = 裸目录枚举），
 *   **没有任务状态过滤** ⇒ 它会把一条 `in_progress` 任务的树判成 reclaimable 并删掉。
 *   而 `scanTerminalWorktrees` 在**判定之前**就用 `isTerminalTask` 剔除了非终态任务。
 *
 * ★ 为什么要有这个脚本而不是一句结论：
 *   「判据对」与「调用判据的那条路对」是两件事。判据本身答的是
 *   「产物被吸收了吗」—— 它对一棵 `in_progress` 的树答 `reclaimable` **不是错的**：
 *   树确实被吸收了。错的是**有人拿这个答案去删一棵正在被写的树**。
 *   ⇒ 一个恒真的读数（"判据说 reclaimable"）证明不了任何危险；
 *     必须有**两条路径对同一棵树给出不同处置**的对照读数。
 *
 * 复跑： node .agent-teams/worktree-salvage/g8-readout.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const root = mkdtempSync(join(tmpdir(), 'g8-readout-'))
let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

try {
  // ── 夹具：一个真实的小仓库，一棵**已吸收**的树，而它的任务**还在跑**──────────
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, ['init', '-q', '-b', 'main', '.'])
  git(repo, ['config', 'user.email', 'g8@example.test'])
  git(repo, ['config', 'user.name', 'g8'])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'one'])

  const worktreesDir = join(repo, '.agent-teams', 'worktrees')
  mkdirSync(worktreesDir, { recursive: true })
  const liveTree = join(worktreesDir, 'task-demo-t4')
  git(repo, ['worktree', 'add', '--quiet', '--detach', liveTree, 'HEAD'])
  // ★ 刻意让它**已吸收**：树 HEAD 正是主干 HEAD 的祖先（这里是相等）
  //   ⇒ 判据对它答 reclaimable。这不是判据的错，见文件头。
  const liveHead = git(liveTree, ['rev-parse', 'HEAD'])

  // 任务清单：这条任务**非终态**
  const tasks = [{ id: 't4', status: 'in_progress', teamId: 'demo' }]

  /**
   * ★ 相对本文件：`.agent-teams/worktree-salvage/` → 上两级 = 仓库根。
   *   （第一版写成上三级，报 `Cannot find module '/Users/abab/Desktop/scripts/…'`
   *    —— 一个**路径算错**会伪装成「脚本不存在」。）
   */
  const { judgeWorktree, planReclaim, scanTerminalWorktrees, listWorktrees } =
    await import('../../scripts/worktree-reclaim.mjs')

  // ── 前置：判据本身答 reclaimable（否则整个对照是空的）────────────────────────
  const verdict = judgeWorktree({ repo, worktree: liveTree, mainRef: 'main' })
  check('前置：判据对**已吸收**的树答 reclaimable（判据没错）', verdict.status === 'reclaimable',
    `status=${verdict.status} how=${verdict.how ?? '-'}`)

  // ── PATH A：planReclaim —— 裸目录枚举，无任务状态过滤 ────────────────────────
  const plan = planReclaim({ repo, mainRef: 'main' })
  const inPlan = plan.reclaimable.find((e) => e.worktree === liveTree)
  check('PATH A planReclaim：把这棵**正在被写**的树判成 reclaimable ⇒ --apply 会删它',
    inPlan !== undefined, `scanned=${plan.scanned} reclaimable=${plan.reclaimable.length}`)

  // ── PATH B：scanTerminalWorktrees —— 判定之前先剔非终态 ──────────────────────
  const scan = scanTerminalWorktrees({ repo, tasks, mainRef: 'main' })
  const judgedByB = scan.scanned.some((e) => e.worktree === liveTree)
  check('PATH B scanTerminalWorktrees：同一棵树**连判都不判**（非终态被先剔除）',
    judgedByB === false, `scanned=${scan.scanned.length}（任务 in_progress）`)

  // ── 对照：把任务改成终态，PATH B 才会看见它 ─────────────────────────────────
  const scanDone = scanTerminalWorktrees({ repo, tasks: [{ ...tasks[0], status: 'completed' }], mainRef: 'main' })
  const judgedWhenDone = scanDone.reclaimable.some((e) => e.worktree === liveTree)
  check('对照：同一任务改成 completed 后，PATH B 才判它 ⇒ 差异确实来自**任务状态**而不是别的',
    judgedWhenDone === true, `scanned=${scanDone.scanned.length} reclaimable=${scanDone.reclaimable.length}`)

  // ── 反向半边：一棵**未被吸收**的树，两条路径都必须拒绝 ─────────────────────
  const uniqueTree = join(worktreesDir, 'task-demo-t5')
  git(repo, ['worktree', 'add', '--quiet', '--detach', uniqueTree, 'HEAD'])
  writeFileSync(join(uniqueTree, 'src', 'unique.ts'), 'export const unique = true\n')
  git(uniqueTree, ['add', '-A'])
  git(uniqueTree, ['commit', '-q', '-m', 'unique work'])
  const uniqueHead = git(uniqueTree, ['rev-parse', 'HEAD'])
  const uniqueVerdict = judgeWorktree({ repo, worktree: uniqueTree, mainRef: 'main' })
  check('反向半边：**未吸收**的树判据答 keep（不许为了腾磁盘放宽成恒真）',
    uniqueVerdict.status === 'keep', `status=${uniqueVerdict.status} reason=${uniqueVerdict.reason ?? '-'}`)
  const plan2 = planReclaim({ repo, mainRef: 'main' })
  check('反向半边：PATH A 也不会删它',
    plan2.reclaimable.every((e) => e.worktree !== uniqueTree), `reclaimable=${plan2.reclaimable.length}`)

  void liveHead
  void uniqueHead
  void listWorktrees

  console.log('')
  console.log(failures === 0
    ? 'G8 读数成立：同一棵树，planReclaim 说「可删」，scanTerminalWorktrees 说「不判」。'
    : `G8 读数失败：${failures} 条不成立。`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

process.exit(failures === 0 ? 0 : 1)
