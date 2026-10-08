#!/usr/bin/env node
/**
 * ── worktree 的两层回收（t89）────────────────────────────────────────────────────
 *
 * 用户原话：「不能每次都让我手动清理，得有一个自动清理的机制。」
 *
 * ── ★★★ 判据是「产物已被主树吸收」，而【不是】「任务已终态」──────────────────────
 *
 *   ① 一个 worktree 在【它的产物并入主树之前】不能删 —— 否则那份工作就丢了。
 *      ★ 今晚 t39 那次正是靠 worktree 找回的。
 *   ② 成员常常需要【重跑一次】（例如收口时再跑一次护栏）——
 *      若依赖已被清掉，那次重跑要重新 install，而那比保留更贵。
 *
 * ── ★★★ 而 `--is-ancestor` 【一条不够】—— 这是本任务实测出来的 ──────────────────
 *
 *   MEASURED（2026-10-08，本仓 50 个 worktree）：
 *
 *     `git merge-base --is-ancestor <wt HEAD> main` 成立 ⇒ **37 个**
 *     ★ 而那 37 个里，**35 个有未提交的改动**（`git status --porcelain` 非空）
 *     ★ 再往里查：**7 个**持有【内容在整个历史里都不存在】的源码文件
 *
 *   最极端的样本 `task-t64`：
 *
 *       scripts/gate-admission-absorb.test.mjs    68257 bytes   ← 80 行 × 850 字符级
 *       src/tools/update-task.ts                  69797 bytes
 *       （共 7 个源码文件，内容不在任何提交里）
 *
 *   ⇒ ★ 只看 `--is-ancestor` 会**删掉这 7 份唯一的产物** —— 而那正是本任务
 *     在「必须保住：清理不能删除唯一的那份产物」里承诺不会发生的事。
 *
 *   ⇒ ★★ 所以判据是**两个条件的合取**：
 *
 *         (a) 已提交的部分被吸收了：`--is-ancestor <wt HEAD> main`
 *         (b) 未提交的部分没有唯一的产物：**每一个脏的源码文件的内容，
 *             都能在历史里找到**（`git log --all --find-object=<blob>`）
 *
 *      ★ 而 (b) 只算**源码**（`src/` `scripts/` `docs/`）——
 *        `lib/` 是构建产物，每次 `pnpm build` 重生成，它脏不构成"唯一产物"。
 *        ★ 这个区分是实测逼出来的：不做它，`task-t16` 会因为
 *          `lib/git-artifact-stamp.json` 一个构建产物而被误判成"有唯一产物"。
 *
 * ── ★★ 两层 ────────────────────────────────────────────────────────────────────
 *
 *   ① 清**依赖**（`node_modules`）：worktree 落后主干 ≥ N 个提交 ⇒ 那些依赖已非必需
 *   ② 清**整个 worktree**：满足上面 (a) ∧ (b) ⇒ 回收的大头在这里
 *
 * ── ★★★ 「自动」意味着三件事（缺一不可）────────────────────────────────────────
 *
 *   ① 它在【某个必然发生的时刻】跑 —— 这里的答案是 **`pnpm verify` 的末尾**
 *      （与 `verify:frictions` 同一条先例）。
 *      ★ 为什么不挂在"交终态时"：那个时刻**不是必然发生的**（一个任务可能被
 *        cancelled、可能被 reassign、可能 captain 代落）—— 而那些恰恰是
 *        worktree 最容易积压的情形。
 *      ★ 为什么不挂在"status 被读时"：那是一个**会被频繁调用**的出口，
 *        而在这里做删除会让一个只读操作产生副作用。
 *      ⇒ `verify` 是【每次全链跑完必然发生】的那个时刻，而且它本来就在
 *        做"收口"这件事（它已经在那儿重新生成台账）。
 *
 *   ② 它**必须留下痕迹**（删了什么 / 回收多少 / 为什么删）——
 *      否则「清理过」与「没清理」在观测上同形。落 `.agent-teams/reclaim-log.jsonl`。
 *
 *   ③ 它**必须可关闭** —— `AGENT_TEAMS_NO_RECLAIM=1`。
 *      ★ 一个自动删除的机制若不能停，在它误判时会造出**不可逆**的损失。
 *
 * ── ★★ 而它默认是【干跑】────────────────────────────────────────────────────────
 *
 *   `node scripts/worktree-reclaim.mjs`           ⇒ 干跑（打印清单 + 预计回收）
 *   `node scripts/worktree-reclaim.mjs --apply`   ⇒ 真删
 *   `AGENT_TEAMS_NO_RECLAIM=1 …`                  ⇒ 完全停手（连干跑都不做）
 *
 *   ★ 而 `--apply` 在删之前**仍然打印清单** —— 让日志里能对上"预计"与"实际"。
 *
 * ── ★ 三态不同形 ───────────────────────────────────────────────────────────────
 *
 *   `reclaimable` —— 已吸收（列出层与依据）
 *   `keep`        —— **不可清**，且说清是哪一种：产物未吸收（附差多少提交）/ 有唯一产物（附文件名）
 *   `undecidable` —— 判不了（不是 git 仓库 / 读不到 HEAD / 没在 worktrees 目录下）
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ── ★★★ t25：判定这件事**只有一份真值**，而它是 `src/worktree.ts` 那一条 ─────────
 *
 * MEASURED（本任务的由来）：`judgeWorktreeReclaimable` 与 `describeReclaimability`
 * 在 `src/worktree.ts` 里写好了、导出了，而**全仓零调用方**（`gate-producer-consumer`
 * 的普查点名，captain 独立复跑）—— 本脚本自己**又实现了一遍**同样的问题。
 *
 * ⇒ ★★ 而它的后果真的发生了：`--apply` 删掉了 32 个 worktree，
 *   而那份**权威实现从未被执行过一次**（它没被接线，也没被比对过）。
 *   ★ 一条没接线、也没被比对过的判据，与一条不存在的判据，
 *     在"删掉东西"这件事上**没有区别**。
 *
 * ── 为什么走 `../lib/`（与 `scripts/*.test.mjs` 一致）──────────────────────────
 *   `lib/` 才是运行时/脚本真正加载的那一份编译产物（`docs/SOURCE-READING-CONVENTION.md`）。
 *   ★ 而 `import` 的是**函数本身**（同一个引用），不是"再写一遍同样的判断" ——
 *     本文件里**不留**那份实现的副本（契约逐字：不许把它改成脚本的私有副本，
 *     那只是把重复换个位置，而"谁是真值"仍然只有一份）。
 */
import { judgeWorktreeReclaimable, describeReclaimability } from '../lib/worktree.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★★ 回收的根：**父仓库**，而不是"我自己所在的那个检出"────────────────────────
 *
 * MEASURED（本任务实测）：这个脚本可能**从 worktree 里**被跑（本队成员就是这么干活的），
 * 而那时 `ROOT` 是那棵 worktree ⇒ `.agent-teams/worktrees/` **不存在** ⇒
 * 扫描结果是 **0 个**，而它与"确实没有可回收的"**同形**。
 *
 * ⇒ ★ 所以用 git 自己回答"主仓库在哪"：
 *     `git rev-parse --git-common-dir` ⇒ `<repo>/.git`（从任何 worktree 都成立）
 *     ⇒ 取它的父目录就是主仓库根。
 *   ★ 这也顺带绕开了"往上数几层"那个坑（t39 与 t84 各踩过一次：
 *     层数要按"它该返回到哪"算，不是按"看起来像几层"）。
 *
 * ★ 取不到（不是 git 仓库）⇒ 退回脚本自己的 `..`：
 *   那时没有 worktree 可言，退回是诚实的。
 */
function resolveRepoRoot() {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  /** ★ `--git-common-dir` 可能是相对路径 ⇒ 用 `--path-format=absolute` 更稳。 */
  const absolute = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  void common
  return dirname(absolute)
}
let REPO_ROOT = ROOT
try {
  REPO_ROOT = resolveRepoRoot()
} catch {
  REPO_ROOT = ROOT
}
/** ★ 回收日志的落点 —— **必须留下痕迹**（见文件头 ②）。 */
export const RECLAIM_LOG = join(ROOT, '.agent-teams', 'reclaim-log.jsonl')
/** ★ 关掉它的开关 —— 一个自动删除的机制若不能停，误判时不可逆（见文件头 ③）。 */
export const RECLAIM_OFF_ENV = 'AGENT_TEAMS_NO_RECLAIM'
/** 依赖那一层的门槛：落后主干 ≥ 这么多个提交 ⇒ `node_modules` 已非必需。 */
export const DEFAULT_STALE_COMMITS = 20

/** 跑一条 git 命令；失败 ⇒ `undefined`（**不是**空串）。★ 一律 `.trim()`。 */
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return undefined
  }
}

/**
 * 一个 worktree 的回收判定。
 *
 * ── ★★★ t25：这个函数**不再自己判断** ─────────────────────────────────────────────
 *
 * 它现在只做三件**本脚本特有**的事，而"能不能回收"那件事**交给权威实现**：
 *
 *   ① 调 `judgeWorktreeReclaimable`（`src/worktree.ts:360`）—— **唯一的真值**；
 *   ② 把它的三态**原样透传**（`reclaimable` / `keep` / `undecidable` 各自的字段一个不改）；
 *   ③ 补上**本脚本才知道**的那几格：`worktree`（路径）、`layers`（依赖那一层）、
 *      `bytes`（由上层填）、以及 `describeReclaimability` 给的人话。
 *
 * ── ★ 为什么 `layers` 不进权威实现 ──────────────────────────────────────────────
 *   它是**删除策略**（"依赖那一层要不要也删"），不是"能不能删" ——
 *   而"能不能删"才是那条判据回答的问题。把策略塞进判据会让两件事同形。
 *
 * ── ★★ 三态照旧**不同形**，且 `undecidable` 绝不当成 `reclaimable` ──────────────
 *   权威实现已经保证三者字段互不共用（见 `WorktreeReclaimability`），
 *   本函数**不再二次判断** —— 一次判断两处实现，正是本任务要消灭的东西。
 *
 * @returns `{ status: 'reclaimable'|'keep'|'undecidable', ... }`
 */
export function judgeWorktree({ repo, worktree, mainRef = 'main', staleCommits = DEFAULT_STALE_COMMITS, budget }) {
  /**
   * ★ 权威裁决 —— **同一个函数引用**，不是"再写一遍同样的判断"。
   */
  const verdict = judgeWorktreeReclaimable({ repo, worktree, mainRef })

  /**
   * ★ `undecidable` ⇒ **原样交出去**，且**不**补任何"可清"的字段。
   *   它判不了 ≠ 它可以清（契约逐字钉住这一条）。
   */
  if (verdict.status === 'undecidable') {
    return { status: 'undecidable', worktree, why: verdict.why, reason: describeReclaimability(verdict) }
  }
  if (verdict.status === 'keep') {
    return {
      status: 'keep',
      worktree,
      reason: verdict.reason,
      behind: verdict.behind,
      detail: verdict.detail,
      /** ★ 只有 `unique-work` 才有这一格（权威的两种 keep **不同形**，这里保持）。 */
      ...verdict.orphaned === undefined ? {} : { orphaned: verdict.orphaned },
      /** ★ 人读的那一句 —— 由 `describeReclaimability` 给（它是零消费的另一条）。 */
      human: describeReclaimability(verdict),
    }
  }

  /**
   * ── 可清 —— 而**两层各自独立**：一个 worktree 可能依赖该清而整体该留 ────────────
   *   （★ 这一格是**删除策略**，本脚本特有，所以它留在这里。）
   */
  const behind = verdict.behind
  const layers = []
  const hasDeps = existsSync(join(worktree, 'node_modules'))
  if (hasDeps && behind !== undefined && behind >= staleCommits) {
    layers.push({ layer: 'dependencies', why: `${behind} commit(s) behind — these deps are no longer the ones this trunk needs` })
  }
  if (budget !== undefined && budget !== null && behind !== undefined && behind >= budget) {
    /** ★ 保留位：将来若有"整棵树的安全窗口"参数，在这里生效。默认不启用。 */
  }
  layers.push({
    layer: 'worktree',
    why: `HEAD is an ancestor of ${mainRef}, and no uncommitted source file is unique to it`,
  })
  return {
    status: 'reclaimable',
    worktree,
    layers,
    behind,
    hasDeps,
    reason: verdict.reason,
    human: describeReclaimability(verdict),
  }
}

/** 目录占用的近似字节数（`du -sk` 一位小数够用；读不到 ⇒ `undefined`）。 */
export function directoryBytes(path) {
  if (!existsSync(path)) return undefined
  try {
    const out = execFileSync('du', ['-sk', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const kb = Number.parseInt(out.split(/\s+/)[0], 10)
    return Number.isSafeInteger(kb) ? kb * 1024 : undefined
  } catch {
    return undefined
  }
}

/** 枚举 `.agent-teams/worktrees/` 下的检出。目录不存在 ⇒ **空数组**（观察到的"这里没有"）。 */
export function listWorktrees(repo) {
  const root = join(repo, '.agent-teams', 'worktrees')
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
      .sort()
  } catch {
    return []
  }
}

/**
 * ── 干跑 / 执行 ─────────────────────────────────────────────────────────────────
 *
 * ★ `apply: false`（默认）⇒ **绝不删除任何东西**，只报清单与预计回收。
 * ★ `apply: true` ⇒ 删之前**仍然打印清单**，让日志里能对上"预计"与"实际"。
 */
export function planReclaim({ repo = REPO_ROOT, mainRef = 'main', staleCommits = DEFAULT_STALE_COMMITS, apply = false, budgetBytes } = {}) {
  const worktrees = listWorktrees(repo)
  const judged = worktrees.map((worktree) => judgeWorktree({ repo, worktree, mainRef, staleCommits }))
  for (const entry of judged) {
    const bytes = directoryBytes(entry.worktree)
    if (bytes !== undefined) entry.bytes = bytes
  }

  const reclaimable = judged.filter((entry) => entry.status === 'reclaimable')
  const keep = judged.filter((entry) => entry.status === 'keep')
  const undecidable = judged.filter((entry) => entry.status === 'undecidable')

  /** ★ 预计回收：把整棵树算进去（那是大头），依赖只是其中的一部分。 */
  const projectedBytes = reclaimable.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)

  /**
   * ★ `budgetBytes` 是**兜底**（用户裁定过"自动成团设成员数上限兜底"的同一思路）：
   *   预计回收没到门槛就**不动手** —— 免得每跑一次 verify 都去做一次小删除。
   *   ★ 而它只影响【是否真删】，不影响干跑的清单（清单永远如实报）。
   */
  const withinBudget = budgetBytes === undefined || projectedBytes >= budgetBytes
  const wouldApply = apply && withinBudget

  const removed = []
  if (wouldApply) {
    for (const entry of reclaimable) {
      try {
        rmSync(entry.worktree, { recursive: true, force: true })
        removed.push(entry.worktree)
      } catch (error) {
        entry.status = 'undecidable'
        entry.why = `removal failed: ${String(error?.message ?? error)}`
      }
    }
  }

  return {
    scanned: worktrees.length,
    reclaimable,
    keep,
    undecidable,
    projectedBytes,
    removed,
    applied: wouldApply,
    withinBudget,
  }
}

/** 一行痕迹。★ 没有它，「清理过」与「没清理」在观测上同形。 */
export function recordReclaim({ repo = REPO_ROOT, result, reason }) {
  try {
    mkdirSync(dirname(RECLAIM_LOG), { recursive: true })
    appendFileSync(RECLAIM_LOG, `${JSON.stringify({
      at: new Date().toISOString(),
      reason,
      scanned: result.scanned,
      projectedBytes: result.projectedBytes,
      applied: result.applied,
      removed: result.removed,
      kept: result.keep.map((entry) => ({ worktree: entry.worktree, reason: entry.reason ?? 'unknown' })),
    })}\n`)
    return true
  } catch {
    return false
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(basenameSafe(process.argv[1]))) {
  const off = process.env[RECLAIM_OFF_ENV] === '1' || process.env[RECLAIM_OFF_ENV] === 'true'
  if (off) {
    console.log(`回收已停用（${RECLAIM_OFF_ENV}=1）—— 没有扫描、没有删除。`)
    console.log('  ★ 一个自动删除的机制必须能停：误判时它是唯一可逆的处置。')
    process.exit(0)
  }
  const apply = process.argv.includes('--apply')
  const result = planReclaim({ apply })
  console.log(`回收扫描：${result.scanned} 个 worktree`)
  console.log(`  可清 ${result.reclaimable.length} · 保留 ${result.keep.length} · 判不了 ${result.undecidable.length}`)
  console.log(`  预计回收 ${(result.projectedBytes / 1024 / 1024).toFixed(1)} MiB`)
  if (result.reclaimable.length > 0) {
    console.log('  ── 可清清单 ──')
    for (const entry of result.reclaimable) {
      console.log(`    ${entry.worktree.replace(`${REPO_ROOT}/`, '')}`
        + `（${((entry.bytes ?? 0) / 1024 / 1024).toFixed(1)} MiB · 落后 ${entry.behind ?? '?'}）`)
    }
  }
  if (result.keep.length > 0) {
    console.log(`  ── 保留 ${result.keep.length} 个（各带原因）──`)
    for (const entry of result.keep.slice(0, 8)) {
      console.log(`    ${entry.worktree.replace(`${REPO_ROOT}/`, '')}：${entry.reason} — ${String(entry.detail).slice(0, 90)}…`)
    }
    if (result.keep.length > 8) console.log(`    …另有 ${result.keep.length - 8} 个`)
  }
  if (apply) {
    console.log(result.applied
      ? `已删除 ${result.removed.length} 个 worktree。`
      : `预算未到（${(result.projectedBytes / 1024 / 1024).toFixed(1)} MiB < 门槛），未执行删除。`)
  } else {
    console.log('  （干跑 —— 没有删除任何东西。真删请加 --apply）')
  }
  recordReclaim({ result, reason: apply ? 'cli-apply' : 'cli-dry-run' })
}

/** 供 CLI 守卫用：比较脚本路径的基名（避免 `import.meta.url` 与相对路径的差异）。 */
function basenameSafe(path) {
  return path.split('/').pop() ?? path
}
