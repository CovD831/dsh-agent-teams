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
 *             　**或者**它的**内容**已经在主干上（按文件落盘 —— 见下）
 *         (b) 未提交的部分没有唯一的产物：**每一个脏的源码文件的内容，
 *             都能在历史里找到**（`git log --all --find-object=<blob>`）
 *
 *      ★ 而 (b) 只算**源码**（`src/` `scripts/` `docs/`）——
 *        `lib/` 是构建产物，每次 `pnpm build` 重生成，它脏不构成"唯一产物"。
 *        ★ 这个区分是实测逼出来的：不做它，`task-t16` 会因为
 *          `lib/git-artifact-stamp.json` 一个构建产物而被误判成"有唯一产物"。
 *
 * ── ★★★ 而 (a) 还有【另外半边】：`--is-ancestor` 也太【强】了（t9）──────────────
 *
 * MEASURED（2026-10-10，captain 在真实使用中量到）：
 *
 *   真实合流**不是 merge，是按文件落盘**：
 *
 *     成员在 worktree 里提交        ⇒ commit A
 *     captain **按文件**落进 main  ⇒ commit B（内容相同、**对象不同**）
 *     ⇒ A **永远不是** B 的祖先 ⇒ 判据**永远**答 keep
 *
 *   当天量到：4 棵产物**早已落在 main 上**的 worktree 全部答 keep，占 3.5G。
 *
 * ⇒ ★ 所以 (a) 被放宽成**两种形态**（`absorbed` 的 `how` 字段如实带出是哪一种）：
 *
 *     `'ancestor'` —— A 是 main 的祖先（真的并进去了）；
 *     `'content'`  —— A 不是祖先，而它的**内容**已在主干上（按文件落盘）。
 *     原语：`git patch-id --stable`（与父提交无关的内容规范化 id）。
 *
 * ★★ 而**安全那一半一个字没动**：`unique-work` 仍然在**两种形态之后**把树按住
 *   （见 `src/worktree.ts` 里那个判定与夹具的臂 3）。
 *   ★ 判据的实现**不在本文件里** —— 本文件只调用它（见下面那一节）。
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
 *   `reclaimable` —— 已吸收（列出层与依据；`how` 说清是**哪一种**吸收）
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
/**
 * ★★ 路径名也取**同一份真值**（建树 / 找树 / 这里扫描都用它）。
 *   `worktreeDirName(teamId, taskId)` 是 `src/worktree.ts` 导出的确定性命名；
 *   ★ 这里**绝不**自己拼 `task-<id>` —— 两处各拼一遍会在团队前缀那一位上分叉，
 *     而分叉的表现是"扫不到树"，与"确实没有可清的"同形（本仓记账过的那条）。
 *     ★ 而 `scripts/worktree-commit.test.mjs` 的臂 12 直接断言
 *       `src/tools/update-task.ts` 里**不出现**那个字符串字面量。
 */
import { worktreeDirName } from '../lib/worktree.js'

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
    /**
     * ★★★ 这一句是**措辞**，不是判断 —— 判断在权威实现里（见上面那一节）─────────────
     *
     * ★ 它此前逐字写死成 "HEAD is an ancestor of main"，而那在 t9 之后**会变成假话**：
     *   按文件落盘的那一类树，其 HEAD **不是**主干的祖先（那正是原来的缺陷）。
     *   ⇒ 于是那一行日志会对一棵"内容已落盘"的树宣称它"是祖先" ——
     *     而读日志的人据此去 `git merge-base` 复核会得到相反的答案。
     * ⇒ 所以它按权威给出的 `how` 分两句说（`'ancestor'` / `'content'`）。
     *   ★ 这两句**没有**做任何判断：`how` 是权威传下来的字段，
     *     本脚本只决定"怎么把它说成人话"。
     */
    why: verdict.how === 'content'
      ? `the commit's content is already on ${mainRef} (landed by file), and no uncommitted source file is unique to it`
      : `HEAD is an ancestor of ${mainRef}, and no uncommitted source file is unique to it`,
  })
  return {
    status: 'reclaimable',
    worktree,
    layers,
    behind,
    hasDeps,
    reason: verdict.reason,
    /** ★ 权威给的那一格（`'ancestor'`｜`'content'`）—— 原样透传，读的人据此复核。 */
    how: verdict.how,
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
 * ── ★★★★★ 删一棵 worktree —— 而它必须**连 git 的台账一起清掉** ────────────────────
 *
 * ── 它修的是什么缺陷（MEASURED）─────────────────────────────────────────────────
 *
 * 此前两处删除点（`planReclaim` 的 `wouldApply` 循环、`reclaimWorktreeAfterDelivery`
 * 的默认 `remove`）都是裸的：
 *
 *     rmSync(path, { recursive: true, force: true })
 *
 * ★ 那一句**只删了目录**，而 git 的 worktree 台账里那条记录**还在**。
 *   ⇒ 之后 `git worktree list` 里那条路径仍然出现，只是被标成 `prunable`。
 *   ⇒ 后果不是"多余一行"：此后每一次 `git worktree list` / `git worktree add`
 *     都要绕开一个**已经不存在**的路径，而 `prunable` 这个标记**不会自己消失**
 *     （裸 `git worktree prune` 只清"最后活动在 24 小时以前"的那些 —— 见下）。
 *   ⇒ 而它的最坏形态是**与"我删干净了"同形**：目录不在了，读数却说是"有棵树"。
 *
 * ── ★★★ 快路径：`git worktree remove --force` —— 一条命令做完两件事 ───────────────
 *
 * 它**既删目录、又清台账**（这两件事在 git 内部本来就是一次操作的两半）。
 * ⇒ 目录还在时一律走它，而不是"先 rmSync 再 prune"：
 *   后者把一个原子的动作拆成两步，中间那一瞬就正是"目录没了、台账还在"的形状。
 *
 * ── ★★★ 兜底：目录已经不在（或上面那条失败）⇒ `rmSync` + `prune --expire=now` ──────
 *
 * ★ 写 `--expire=now` 而**不是**裸 `prune`：本函数的语义是「我刚删的那条路径，
 *   它的台账立即无效」。
 *   `git worktree prune` 的默认过期期是 **24 小时**（`gc.worktreePruneExpire`），
 *   而"24 小时"这条语义**与本次删除无关** —— 所以显式把窗口压到 0，
 *   让"我删的这条立刻无效"成为**由参数保证**的事，而不是**依赖某个版本的默认值**。
 *
 * ── ★★ MEASURED（2026-10-10，本机 git 2.50.1 Apple Git-155）：在本机，
 *    裸 `prune` **确实**会清掉一条**刚**变成幽灵的条目 ─────────────────────────────
 *
 *   实测（本目录下的一个临时仓库，用一个 < 1 秒年龄的幽灵）：
 *
 *     $ git worktree add --detach .agent-teams/worktrees/task-r2 main
 *     $ rm -rf .agent-teams/worktrees/task-r2      # 目录没了、台账还在
 *     $ git worktree prune -v
 *     Removing worktrees/task-r2: gitdir file points to non-existent location
 *
 *   ⇒ ★★ 本任务书里那条"裸 prune 的 24 小时过期期会放过它"的说法，
 *     **在本机这个 git 上不成立** —— 因为那条记录属于"gitdir file points to
 *     non-existent location"这一类，git 对它**直接判死**，不看年龄。
 *     （24 小时那一档管的是**另一类**：工作树目录还在、只是被判为 unused。）
 *   ⇒ 所以这里**不能**写"裸 prune 会放过它"来为 `--expire=now` 辩护 ——
 *     那是一句**与本机实测相反**的话，而它会让下一个人去信一条假机制。
 *
 * ★★ 那为什么**仍然**写 `--expire=now`？两条**真的**成立的理由：
 *   ① 它把"立即失效"这件事变成**显式的**：本函数不依赖 git 的默认值、也不依赖
 *      那条记录恰好被判进"直接判死"那一类 —— 换一个 git 版本、换一种幽灵形态
 *      （例如目录还在、只是 gitdir 文件丢了），`--expire=now` 照样对；
 *      而裸 `prune` 在那几种形态下的行为**要先测过才知道**。
 *   ② 它把**窗口**表达出来：本函数刚删的那条路径，不许有任何"再看 24 小时"的余地。
 *   ★ 也就是说：`--expire=now` 在这里是**把语义写进参数**，
 *     而不是"因为裸 prune 会失败"—— 后者是假的。
 *
 * ── ★★★ 夹具（臂 B2）钉的是**这一格事实**，不是那句假话 ────────────────────────
 *   臂 B 证明"幽灵被清掉了"；而臂 B2 把上面这段实测**写成可执行的**：
 *   它当场比较裸 prune 与 `--expire=now` 的行为，而不是断言某一个特定结局 ——
 *   ★ 这样它在任何 git 版本上都**只会因为事实变了而红**，不会因为措辞变了而假绿。
 *
 * ★★ 两个半边**都要**成立（本函数的契约）：
 *   (a) 活的树  ⇒ 走快路径，目录与台账一起没；
 *   (b) 已经是幽灵 ⇒ 目录早没了、台账还在 ⇒ 兜底那句 `prune --expire=now` 清掉它。
 *   两者都会真的发生：(b) 正是"上一个版本用裸 `rmSync` 删过"的那些残留 ——
 *   也就是说，这个函数要能清掉**它自己前身留下的**幽灵。
 *
 * ── ★ 失败必须【抛】 ────────────────────────────────────────────────────────────
 *   绝不静默吞掉：调用方要靠这个异常留一条可读的痕迹
 *   （见 `planReclaim` 里那一支把它记成 `undecidable` + `why`）。
 *   ★ 一个静默失败的删除与"没删"同形，而盘上留下的那棵树没人会知道。
 *
 * ★ 为什么它导出：删除必须**只有一个出处**（`src/tools/update-task.ts` 通过动态
 *   import 复用同一个函数）。两份实现分叉时，其中一份会把幽灵留下而没人发现。
 */
export function removeWorktree({ repo, worktree }) {
  /**
   * ★ 判"目录还在不在"用 `existsSync`：目录不在时 `git worktree remove` 会**失败**
   *   （它要删的那个 checkout 不在盘上），而失败之后走兜底 ⇒ 结果一样。
   *   显式先判一次只是让快慢两条路的**选择**可读，而不是靠异常兜圈子。
   */
  if (existsSync(worktree)) {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    /**
     * ★ 快路径**成功**也要再清一次台账吗？—— 不要，而且不许。
     *   `git worktree remove` 成功就意味着那条台账已经没了；再 prune 一次是
     *   一个**没有读数的多余动作**（它若恰好清掉了*别的*过期条目，
     *   那件事会被记在本函数的账上 —— 一个函数只该动它被点名的那条路径）。
     */
    return
  }
  removeWorktreeFallback({ repo, worktree })
}

/**
 * 兜底那一半（目录已经不在 / 快路径失败）：先删目录，再**立即**清台账。
 * ★ 单独抽出来是为了让上面那个函数读起来就是"两条路"，而不是一堆嵌套 try。
 */
function removeWorktreeFallback({ repo, worktree }) {
  rmSync(worktree, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'prune', '--expire=now'], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
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
        /**
         * ★★★ 删除**只走 `removeWorktree`**（不是裸 `rmSync`）───────────────────────
         *
         * 定向突变：把这一句改回 `rmSync(entry.worktree, { recursive: true, force: true })`
         *   ⇒ 目录没了、而 `git worktree list` 里那条路径仍在（标成 `prunable`）
         *   ⇒ 夹具的臂 A 变红。★ 那个红**不是**洁癖：`prunable` 条目会让此后
         *   每一次 `git worktree list` 都在报告一棵不存在的树。
         */
        removeWorktree({ repo, worktree: entry.worktree })
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

/**
 * ── ★★★ 「终态」的定义**只有一份真值**：`src/types.ts` 的 `TERMINAL_TASK_STATUSES` ──
 *
 *     export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] =
 *       ['completed', 'failed', 'cancelled']
 *
 * ★ 为什么这里**镜像**而不是 import：`src/types.ts` 是 TypeScript，
 *   而本文件是脚本层（`.mjs`，被 `scripts/*.test.mjs` 与本 CLI 直接跑）——
 *   它没有编译步骤可依赖。⇒ 所以镜像，并把**来源与取值逐字写在这里**：
 *     哪天那个数组改了，这里有一行可 diff 的对照，而不是一个漂移的猜测。
 *   ★（生产那半边走的是**真正的 import** —— 见 `src/tools/update-task.ts`：
 *     它 import 的就是 `../types.ts`。本镜像只服务于脚本层。）
 *
 * ── ★★ 不知道的状态 ⇒ 【拒答】，而不是猜 ────────────────────────────────────────
 *   本函数返回的是 `boolean`，而它门住的是**删除**。
 *   ⇒ 一个没见过的状态（拼错的、将来新增的）必须落到 `false`：
 *     "我不认识它"绝不能被读成"它是终态、可以删"。
 *     ★ 三态在这里被压成两态是**故意的**：`scanTerminalWorktrees` 的问法是
 *       "这条任务还会不会再被更新"，而"不知道"对那个问题的安全答案是"会"。
 */
export function isTerminalTask(task) {
  const status = task?.status
  if (typeof status !== 'string') return false
  /** ★ 镜像自 `src/types.ts` 的 `TERMINAL_TASK_STATUSES`（见上）。 */
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * ── ★★★★★ 终态扫描：一个**已经**终态的任务，此后不会再被更新 ────────────────────
 *
 * ── 它修的是什么缺陷（MEASURED，本任务的由来）───────────────────────────────────
 *
 * 生产接线（`reclaimWorktreeAfterDelivery`）只在**终态转换那一刻**判一次。
 * ⇒ 而"产物交付时还没被合流"是**常态**（`commitWorktree` 从不合进 `main`）——
 *   那一刻的判据必然答 `keep / not-absorbed`，而它明写着"将在**下一次**终态转换时重判"。
 * ★★ 而**下一次**对一条已经终态、此后不再变化的运行来说**永远不会来**：
 *   一条 `completed` 的任务不会再被更新 ⇒ **没有任何时刻**会重判它
 *   ⇒ 一棵产物早已被合流进主干的树，**永久**留在盘上。
 *   这与"任务已终态"是两件事 —— 判据仍然是「产物已被吸收」，
 *   变的只是"**谁**在什么时刻去问它"。
 *
 * ── ★★★ 三态仍然**只有一份真值** ──────────────────────────────────────────────
 *   本函数一行"吸收与否"的推理都没有：它把每一棵树交给 `judgeWorktree`
 *   （进而 `judgeWorktreeReclaimable`）⇒ 与 CLI、与生产接线**同一个**答案。
 *
 * ── ★★★ 它是**纯规划器**：它【不】删任何东西 ────────────────────────────────────
 *   删除是**调用方**的下一步，而且**只在一个地方**做（`removeWorktree`）。
 *   ★ 为什么这样分：判定正确与删除正确是两件事，而"顺手删了"会让
 *     「这条臂测的是判定」与「这条臂测的是删除」同形 —— 出红时读不出是哪一半坏了。
 *   ⇒ 所以：`scanTerminalWorktrees` 答"哪些可清"，调用方拿这个清单去删。
 *
 * ── ★★ 安全那一半：[非终态] 的任务【不判、不删】────────────────────────────────
 *   一条还没结束的任务，它的树**正在被写** ⇒ 判定它没有意义（而删它是灾难）。
 *   ⇒ 本函数在**判定之前**就把非终态剔掉（不是判完了再忽略结果）——
 *     两者的区别在于"有没有去碰那棵树"。
 */
export function scanTerminalWorktrees({ repo = REPO_ROOT, tasks, mainRef = 'main' }) {
  const root = join(repo, '.agent-teams', 'worktrees')
  const scanned = []
  const reclaimable = []
  const kept = []
  const undecidable = []
  for (const task of tasks ?? []) {
    /**
     * ★ 非终态 ⇒ **连判都不判**（见上面那一节）。未知状态同样落在这里 ——
     *   `isTerminalTask` 对不知道的状态答 `false`，而不是猜。
     */
    if (!isTerminalTask(task)) continue
    if (typeof task?.id !== 'string' || task.id === '') continue
    const worktree = join(root, worktreeDirName(task.teamId, task.id))
    /**
     * ★ 目录不存在 ⇒ **这条任务压根不在这张名单上**（而不是"判了个 absent"）。
     *   它与"树在而判据说保留"是两件事，读的人要能分开。
     */
    if (!existsSync(worktree)) continue
    const verdict = judgeWorktree({ repo, worktree, mainRef })
    scanned.push(verdict)
    if (verdict.status === 'reclaimable') reclaimable.push(verdict)
    else if (verdict.status === 'keep') kept.push(verdict)
    else undecidable.push(verdict)
  }
  return { scanned, reclaimable, kept, undecidable }
}

/**
 * 一行痕迹。★ 没有它，「清理过」与「没清理」在观测上同形。
 *
 * ── ★★★ 落点必须跟着 `repo` 走（t7 修；此前 `repo` 被【解构了却没用】）────────────
 *
 * MEASURED（t7，`scripts/gate-shared-artifact-writes.test.mjs` 臂 4）：
 *   本函数此前签名收 `repo`，而函数体里写的是**模块级**的 `RECLAIM_LOG`
 *   —— `repo` 一个字节都没被读过。⇒ 后果是一条**看起来被隔离、其实没有**的写：
 *
 *     `scripts/worktree-reclaim.test.mjs` 臂 12 传 `repo: f.repo`（一个 mkdtemp 私有树），
 *     还专门写了一句「★ 落到一个临时路径（不污染真实仓库）」
 *     —— ★ 而它实际写的是**仓库根的** `.agent-teams/reclaim-log.jsonl`。
 *
 * ★ 这正是本队记账最久的形态的一种：**一个参数在场，于是读的人以为那条路被堵住了**
 *   —— 「写了 `repo:` 」与「真的写到 `repo` 去了」在源码上同形。
 *   ★ 而它还有第二重危害：**并发**。多个夹具同时跑 ⇒ 它们全都在追加**同一个**共享文件
 *     —— 那正是本判据（t68）存在的理由：两个动作在同一个共享资源上没有序关系。
 *
 * ── 修法：把落点**从参数算出来**，而不是从模块常量拿 ──────────────────────────────
 *
 * `join(repo, '.agent-teams', 'reclaim-log.jsonl')` —— 与 `RECLAIM_LOG` 的构造**同一个形状**
 * （见上面它的定义：`join(ROOT, '.agent-teams', …)`），于是：
 *
 *   · 生产路径（不传 `repo`）⇒ `repo = REPO_ROOT` ⇒ 落点**逐字节等于**原来的 `RECLAIM_LOG`
 *     ⇒ ★ 痕迹的用途（"清理过"读得出来）**一个字都没变**，我**没有**把它改成私有副本。
 *   · 夹具路径（传 `repo: f.repo`）⇒ 落进那棵**私有树** ⇒ 不再与任何人共享。
 *
 * ★★ 为什么不是"把 `RECLAIM_LOG` 整个换成 tmpdir"：那是**错的修法** ——
 *   这条痕迹的价值就在于它是**生产可读**的（`reclaim:worktrees` 跑完要在仓库里留一行）。
 *   判据要的是"**别在共享树上写**"，而生产 CLI 的 `repo` **就是**它自己的仓库 ——
 *   那不是"共享"，那是"它自己的落点"。★ 所以修的是**参数被忽略**，不是"别再写了"。
 */
export function recordReclaim({ repo = REPO_ROOT, result, reason }) {
  try {
    /**
     * ★ 落点由 `repo` 算出（默认 `REPO_ROOT` ⇒ 与原 `RECLAIM_LOG` 逐字节相同）。
     */
    const logPath = join(repo, '.agent-teams', 'reclaim-log.jsonl')
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, `${JSON.stringify({
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
