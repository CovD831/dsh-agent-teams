/**
 * ── worktree 隔离：给每个任务一个干净、独立的工作目录 ────────────────────────────
 *
 * ── 它解决的是什么问题（★ 与「归属」是两件事）────────────────────────────────
 *
 * `dispatch/changed-paths` 判据已经解决了【归属】：哪些文件是哪个成员改的
 * （走会话事件的 `meta.diffs`）。
 *
 * 但 R5（红前绿后）/ 变异测试需要的是【版本】：一个可 checkout 的父版本，
 * 让新测试在上面必须变红。会话事件给不了这个 —— 它给的是
 * `{ path, oldText, newText }`，是【一次编辑的前后文本】，
 * 拼不出可信的父版本。**父版本只能来自 git 历史。**
 *
 * ⇒ 本模块提供那个"可 checkout 的历史"。
 *
 * ── 它为什么不是"改 cwd"（START-HERE §5②）────────────────────────────────────
 *
 * 子会话的 cwd 硬编码继承父会话（dsh-subagent 的 childSessionMeta），
 * **改不了**。所以隔离【不靠改 cwd】，而靠：
 *   ① 给这个任务准备一个独立目录；
 *   ② 在派发提示里把该目录【告诉成员】（`worktreePromptLine`）。
 *
 * ── 已实测的 git worktree 边界（2026-10-05，不是猜的）──────────────────────────
 *
 *   ① 同一分支不能检出到两个 worktree
 *      ⇒ 并行成员必须用 `--detach`（否则第二个直接失败）
 *   ② 新 worktree 是干净的 HEAD
 *      ⇒ 主工作区未提交的改动不会带过去 —— 这正是 R5 要的"父版本"
 *   ③ worktree 里没有 gitignore 的文件（如 node_modules）
 *      ⇒ 在里面跑 pnpm test 会因缺依赖失败 ⇒ 我们把它【报出来】
 *   ④ worktree 里的写入对主工作区完全隔离
 *
 * ── 三态纪律 ────────────────────────────────────────────────────────────────
 *
 * 建不出来时返回 `{ ok:false, reason }`，且 reason 必须说清是"隔不了"
 * （不是 git 仓库、没有提交）—— **不能与"不需要隔离"同形**（契约 §3.4）。
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TeamTask } from './types.ts'

export interface WorktreeResult {
  ok: true
  /** Absolute path of the isolated working directory. */
  path: string
  /** Branch/commit the worktree is parked at (detached). */
  base: string
  /**
   * ★ gitignore'd top-level entries that exist in the repo but NOT in the
   * worktree (typically `node_modules`). Reported so the caller can tell the
   * member, instead of letting it discover a broken `pnpm test` by surprise.
   */
  missingIgnored: string[]
  /**
   * ── ★★★ 这一次的基线【是从哪儿来的】（t5）──────────────────────────────────────
   *
   * 它把"基线"从一个**位置**（永远是主树 HEAD）变成一个**有出处的读数**：
   * 哪条上游提交了、哪条没提交、哪条读不到，逐条在这里。缺席即沉默，而沉默
   * 正是这次要消灭的形态（见 `docs/WORKTREE-BASE-DEFECT.md`）。
   */
  baseline: BaselineResolution
}

/**
 * ── ★★★ 一条上游依赖的基线读数 —— 三态（t5）────────────────────────────────────
 *
 * `docs/WORKTREE-BASE-DEFECT.md`：依赖边只表达顺序、不表达可见性。修法是让
 * 建树时把上游的 `deliverableCommit` 当成基线。★ 而"上游提交了没有"本身是
 * **三态**，把它压成一个 `string | undefined` 会让下面两件事同形：
 *
 *   · 上游**还没提交**（没做出东西 / 不是会提交的 kind）⇒ 退回主树 HEAD 是**对的**；
 *   · 上游**提交了、而那个 commit 现在读不到**（树被回收，提交成了不可达对象）
 *     ⇒ 退回主树 HEAD 是**将就**，读的人必须看得出"这不是上游的成品"。
 *
 * ⇒ 三态各自有名，且读不到那一态必须带 `why`。
 */
export type UpstreamBaselineReading =
  /**
   * 上游提交了，且那个 commit 在这个仓库里解析得出。
   *
   * ── ★★★ `landed`（2026-10-20 加）：**这份产物进主干了吗** ─────────────────────
   *
   * 三态，而三者**不同形**：
   *   `'landed'`      —— 主干**今天**拿着这份工作（四种吸收形态之一，见 `absorbPlanOf`）
   *   `'not-landed'`  —— 读到并核过，主干没有这份工作 ⇒ ★ **下游正在旧代码上干活**
   *   `'unreadable'`  —— 核不了（commit 读不出、主干读不到）
   *
   * ★★ 为什么它必须在这里（`docs/WORKTREE-BASE-DEFECT.md` 处置方向第 3 条）：
   *   此前调度器把上游 commit 当基线传下去，而**从不问它进没进主干**。
   *   实测（本仓 78 个产物）：`--is-ancestor` 只认出 4 个，而四态口径认出 46 个
   *   ⇒ 若按前者报"没合流"，那是 **42 份误报**。
   *   ★ 而这一格**只报告、不改基线**：改基线是另一条改动，而"先让事实可读"
   *     是本仓一贯的顺序（否则你无法判断那条改动到底修好了什么）。
   */
  | {
    readonly kind: 'committed'
    readonly taskId: string
    readonly commit: string
    readonly landed?: 'landed' | 'not-landed' | 'unreadable'
    /** `landed` 时的依据；`not-landed` / `unreadable` 时是成因。 */
    readonly how?: 'ancestor' | 'content' | 'files' | 'contained'
    readonly why?: string
  }
  /** 上游没有 `deliverableCommit` —— 它没提交（或它的 kind 本来就不建树）。 */
  | { readonly kind: 'not-committed'; readonly taskId: string }
  /** 上游声称有产物，**读不到**：commit 解析不出 / 连任务记录都不在。 */
  | { readonly kind: 'unreadable'; readonly taskId: string; readonly why: string }

/** 建树基线的出处。 */
export interface BaselineResolution {
  /** 实际拿来当起点的 commit（`git worktree add --detach` 的那一格）。 */
  readonly base: string
  /**
   * 这个起点是**哪来的**：
   *   `trunk`    —— 主树 HEAD（没有可用的上游产物时的正确回退）
   *   `upstream` —— 某条上游的产物 commit（或它的后代）
   *   `existing` —— ★ 树**本来就在**，这一格是它当前 HEAD 的**读数**，不是我们选的
   *
   * ── ★ 为什么第三格必须存在（否则这一层会说谎）────────────────────────────────
   *
   * 复用分支（`existsSync(join(path,'.git'))`）**不重新对齐**已经建好的树 ——
   * `docs/WORKTREE-BASE-DEFECT.md` 的补充段实测过：一棵在旧 trunk 上建的树，
   * 之后无论 trunk 怎么走，它都停在原地。
   *
   * ★ 于是"我算出来的基线"与"这棵树实际的 HEAD"可以是**两个不同的 commit**。
   *   把前者当成后者的读数，就是本仓记账最久的形态：**读数与实际不同形**。
   *   ⇒ 复用分支返回的是实际 HEAD，且 `source: 'existing'` 明说"这不是我选的"。
   */
  readonly source: 'trunk' | 'upstream' | 'existing'
  /** 主树 HEAD。★ **总是**解析出来 —— 它是回退项，必须随时可读。 */
  readonly trunk: string
  /** 逐条上游读数，顺序与入参一致（没有依赖边 ⇒ 空数组）。 */
  readonly upstream: readonly UpstreamBaselineReading[]
  /**
   * ── ★ 上游产物【不在】这条基线的历史里（从基线到达不了它们）───────────────
   *
   * 对 `source: 'upstream'` 而言这是"别的上游与基线分叉了"；
   * 对 `source: 'existing'` 而言这是"这棵树建立之后上游才提交，而它没重新对齐"
   * —— 后者是**更常见**的一格，且它正是缺陷文档里那个"mtime 证明不了树里有提交"。
   */
  readonly diverged: readonly { readonly taskId: string; readonly commit: string }[]
}

/**
 * 一条上游依赖的输入：只有两格，因为**只有这两格能影响基线**。
 *
 * ★ 刻意**不**收整个 `TeamTask`：这层只需要"有没有产物 commit"，
 *   收全集会让它顺手去读 kind / status / inScope —— 那些是**别处**的真值，
 *   在这里再判一次就是第二份真相（本仓记账过多次的形态）。
 */
export interface UpstreamTaskInput {
  readonly taskId: string
  /**
   * 上游的产物 commit（`TeamTask.deliverableCommit`）。**缺席 = 上游没提交** ——
   * 而不是"我不知道"。三态的中间那一格由调用方用缺席表达，读不到用别的方式表达
   * （见 `UpstreamBaselineReading.unreadable`：它是本层真的去 `rev-parse` 之后
   * 才敢下的结论，不是调用方的猜测）。
   */
  readonly deliverableCommit?: string
  /**
   * 调用方**已经知道**读不到时用它（例如任务记录根本不在队里）。
   * ★ 有它就不再尝试解析 —— 一个假 commit 会解析成假基线。
   */
  readonly unreadable?: string
}

export interface WorktreeRefusal {
  ok: false
  /** ★ Must say "could not isolate" — never "isolation was unnecessary". */
  reason: string
  /**
   * ── ★ 这次拒绝是【哪一种】────────────────────────────────────────────────────
   *
   * 调用方必须能区分下面两件事，而它们的区别**不是措辞、是后果**：
   *
   *   `'unsupported'` —— 这个仓库【根本没有】隔离能力（不是 git 仓库）。
   *       这不是异常，是环境。⇒ 调用方应当降级派发，并把"未隔离"如实记进
   *       任务记录。★ 若把它也当成拒绝派发，成员会在共享目录里干活、任务却
   *       永远回 pending、调度器再踢再失败 ⇒ **无限循环，任务永久卡死**
   *       （实测：非 git 项目里所有 implementation/repair 任务全卡死）。
   *
   *   `'failed'`      —— 是 git 仓库，但这次建不出来（没有提交、权限、磁盘…）。
   *       这是真异常。⇒ 调用方应当拒绝派发，因为"本该能隔离却没有"意味着
   *       环境坏了，而它下一次可能就好了 —— 重试是合理的。
   *
   * ★ 为什么是【结构化字段】而不是让调用方去匹配 `reason` 的字符串：
   *   字符串匹配是脆的 —— 改一个标点、加一层 git 版本差异的措辞，判别就会
   *   静默翻转，而翻转的后果正是上面那个无限循环。这里把判别放在【产生它的
   *   地方】（我们刚刚亲自问了 git），调用方只读一个枚举。
   */
  unsupported?: boolean
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function tryGit(cwd: string, args: readonly string[]): { ok: true; value: string } | { ok: false; message: string } {
  try {
    return { ok: true, value: git(cwd, args) }
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr
    const message = typeof stderr === 'string' && stderr.trim() !== ''
      ? stderr.trim()
      : String((error as Error | undefined)?.message ?? error)
    return { ok: false, message }
  }
}

/**
 * 能不能在这个仓库里做隔离。**只读检查**，不建任何东西。
 *
 * ★ 返回拒绝时带 reason —— 调用方要能区分"这个仓库不支持"与"我们没试"。
 * ★ 并且带 `unsupported` —— 调用方还要能区分"这个仓库不支持"（⇒ 降级）
 *   与"本该能、这次没成"（⇒ 拒绝派发）。见 `WorktreeRefusal.unsupported`。
 */
export function detectWorktreeSupport(repo: string): { ok: true; base: string } | WorktreeRefusal {
  const top = tryGit(repo, ['rev-parse', '--is-inside-work-tree'])
  if (!top.ok || top.value.trim() !== 'true') {
    return {
      ok: false,
      unsupported: true,
      reason: `not a git repository (${top.ok ? 'unexpected rev-parse output' : top.message})`,
    }
  }
  const head = tryGit(repo, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok) {
    // ★ 是 git 仓库、但没有提交 ⇒ 这是"本该能隔离却建不出来"，不是环境不支持。
    return {
      ok: false,
      unsupported: false,
      reason: `the repository has no commit to use as a parent revision (${head.message})`,
    }
  }
  return { ok: true, base: head.value.trim() }
}

/**
 * ── ★★★ 主干引用**从哪来**（W1：一个会过期的字符串不许再当缺省）─────────────────
 *
 * ── 它修的是什么（MEASURED，本任务的由来）───────────────────────────────────────
 *
 *   判据此前的签名是 `mainRef?: string`，而实现里写着 `mainRef = 'main'`。
 *   两处**生产**调用点（`src/tools/update-task.ts` 的交付后回收、终态扫描）
 *   都没传它 ⇒ 判据永远在跟一个**字面量** `'main'` 比。
 *   而本仓的集成**不在** `main` 上：实测 `main` 落后集成分支 HEAD **209 个提交**
 *   （`git rev-list --count main..HEAD` = 209，2026-10-20 读数）。
 *   ⇒ 同一个判据、同一棵树，把引用从 `'main'` 换成集成分支，
 *     8 棵树的裁决从 `keep` 翻成 `reclaimable`。
 *   ⇒ 这就是"磁盘 95% 满而 worktree 占 9.8G"的成因：**不是判据错了，是它读错了引用**。
 *
 * ── ★★★ 为什么**不能**只是把缺省从 `'main'` 改成集成分支的名字 ──────────────────
 *
 *   那是把"写死一个会过期的字符串"换成"写死**另一个**会过期的字符串"。
 *   分支名会变（本仓本轮就从 `main` 换到 `task-mutation-integrate`，
 *   下一次可能是别的）；写死它只是把同一个缺陷的复发时间往后推。
 *   ⇒ 所以缺省**不是**一个名字，而是**一个问法**：主树自己检出在哪条分支上。
 *
 * ── 声明式来源（按优先级）───────────────────────────────────────────────────────
 *
 *   ① `'explicit'` —— 调用方给了。★ 生产接线走的就是这一条：调用方先问
 *      `resolveTrunkRef(workspace)`，再把 `.ref` **显式**传进判据
 *      ⇒ 判据本身不再有"我猜一个"的余地。
 *   ② `'main-worktree-branch'` —— 从 `git worktree list --porcelain` 的**第一块**
 *      读主树检出的分支。★ 为什么是它：主树（captain 的工作区）就是"集成发生在哪"
 *      的那个地方 —— 成员在 detached 的隔离树里干活，产出被落盘到主树所在的
 *      分支上。**主树检出的分支 = 本仓此刻认定的主干**，这件事 git 自己知道，
 *      不需要我们再抄一遍常量。
 *
 * ── ★★★ 而"读到了名字"**不等于**"读到了引用"（这一步是可辩论的那一半）──────────
 *
 *   MEASURED：`git update-ref -d refs/heads/main`（HEAD 仍符号指向 main）之后，
 *   `git worktree list --porcelain` **照旧**打印 `branch refs/heads/main`（退出码 0），
 *   `git symbolic-ref --quiet --short HEAD` **照旧**答 `main` ——
 *   而此时 `git rev-parse --verify --quiet 'main^{commit}'` **失败**（rc=1）。
 *   ⇒ 若不核实就把那个名字当成主干，判据会拿着一个**解析不出来的引用**去比，
 *     而那必须落到 `undecidable`（判不了 ≠ 可以清）。
 *   ⇒ 所以下面**先拿到名字、再核验它 resolve 成 commit**；核验失败 ⇒ `unresolved`。
 *
 * ── 三态，且三者不同形 ─────────────────────────────────────────────────────────
 *
 *   `resolved`   —— 带 `ref`（给人看/给日志念）、`commit`（判据真正用的那个）、`source`
 *   `unresolved` —— 带 `why`。★ **绝不**退回一个字面量：没有主干就"无从比较"，
 *                  而那与"比过了、一样"是两件事。
 */
export type TrunkRefResolution =
  | {
      status: 'resolved'
      /** 人读的引用名（`'task-mutation-integrate'`）。★ 判据**不**用它去跑 git。 */
      ref: string
      /** ★ 判据真正拿去比较的那个 commit sha —— 已核验可解析。 */
      commit: string
      /** 这个引用是怎么来的（读日志的人据此判断这次比较可信不可信）。 */
      source: 'explicit' | 'main-worktree-branch'
    }
  | { status: 'unresolved'; why: string }

/**
 * 解读主树（`git worktree list` 的第一块）检出的分支名。
 *
 * ★ 单独抽出来是为了可单测：`porcelain` 的格式是"块之间空行、块内 `key value`"，
 *   而块**顺序**有意义（第一块恒是主工作树）。
 * @returns 分支短名（`refs/heads/x` ⇒ `x`）；detached / 读不到 ⇒ `undefined`。
 */
export function mainWorktreeBranch(porcelain: string): string | undefined {
  const lines = porcelain.split('\n')
  for (const line of lines) {
    if (line.trim() === '') break // 第一块结束
    const prefix = 'branch refs/heads/'
    if (line.startsWith(prefix)) {
      const name = line.slice(prefix.length).trim()
      return name === '' ? undefined : name
    }
  }
  return undefined
}

/**
 * 解析"这一次判据该拿哪个引用当主干"。
 *
 * @param repo - 主仓库根（任意一个 worktree 的公共目录所在仓库都行）。
 * @param explicit - 调用方显式给出的引用名。★ 给了就**只用它** ——
 *   调用方说比谁就比谁，本函数不替它改主意（那会让"我显式传了这个"变得不可信）。
 * @returns 三态。★ `unresolved` 由调用方各自决定怎么处置
 *   （判据 ⇒ `undecidable`；规划器 ⇒ 报出来而不是删）。
 */
export function resolveTrunkRef(repo: string, explicit?: string): TrunkRefResolution {
  const candidate = explicit !== undefined && explicit.trim() !== '' ? explicit.trim() : undefined
  /** ★ 核验：名字 → commit。**这一步不能省**（见上面 MEASURED 那段）。 */
  const resolve = (ref: string): string | undefined => {
    const result = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return result.ok ? result.value.trim() : undefined
  }
  if (candidate !== undefined) {
    const commit = resolve(candidate)
    if (commit === undefined) {
      return {
        status: 'unresolved',
        why: `the trunk ref "${candidate}" was given explicitly but does not resolve in ${repo}`,
      }
    }
    return { status: 'resolved', ref: candidate, commit, source: 'explicit' }
  }
  const listed = tryGit(repo, ['worktree', 'list', '--porcelain'])
  if (listed.ok === false) {
    return { status: 'unresolved', why: `git worktree list failed in ${repo} (${listed.message})` }
  }
  const branch = mainWorktreeBranch(listed.value)
  if (branch === undefined) {
    return {
      status: 'unresolved',
      why: `the main worktree in ${repo} is not on a branch (detached HEAD), `
        + 'so there is no declared trunk to compare against — pass one explicitly',
    }
  }
  const commit = resolve(branch)
  if (commit === undefined) {
    return {
      status: 'unresolved',
      /**
       * ★ 措辞上刻意**不出现** "deleted"：`undecidable` 的那句人话要和
       *   "删掉了什么"在读数上分开（臂 16 直接断言日志里不出现 `deleted `）。
       *   ★ 一个"判不了"的读数里混进删除的动词，读的人会以为发生过删除。
       */
      why: `the main worktree in ${repo} is on branch "${branch}", but that name does not `
        + 'resolve to a commit (the ref is gone, or the branch has no commit yet)',
    }
  }
  return { status: 'resolved', ref: branch, commit, source: 'main-worktree-branch' }
}

/** gitignore 的顶层条目（只取顶层名字，够用来提示 node_modules 这类）。 */
function ignoredTopLevel(repo: string): string[] {
  const listed = tryGit(repo, ['status', '--ignored', '--porcelain'])
  if (!listed.ok) return []
  const names = new Set<string>()
  for (const line of listed.value.split('\n')) {
    if (!line.startsWith('!! ')) continue
    const path = line.slice(3).trim().replace(/\/$/, '')
    if (path === '') continue
    const top = path.split('/')[0]
    if (top !== undefined && top !== '') names.add(top)
  }
  return [...names].sort()
}

export interface CreateWorktreeOptions {
  /** The repository (captain workspace) the worktree is cut from. */
  repo: string
  /** Task id — used to name the directory so parallel members never collide. */
  taskId: string
  /**
   * ── ★★★ 团队 id —— 路径名的一部分（2026-10-10 实测加的）───────────────────────
   *
   * 缺省时可省略（老调用方/夹具），但**生产调用方必须给** —— 见
   * {@link worktreeDirName} 上面那段：任务 id 按团队重新计数，
   * 只用 `task-<id>` 会让新团队命中上一轮的树。
   */
  teamId?: string
  /** Where worktrees live; defaults to `<repo>/.agent-teams/worktrees`. */
  root?: string
  /**
   * ── ★★★ 本任务的**上游依赖**（t5）────────────────────────────────────────────
   *
   * 给了它，基线就**不再**无条件取主树 HEAD：`resolveWorktreeBaseline` 会挑其中
   * 最早那个可用的产物 commit（见那里的拓扑理由）。缺省 ⇒ 退回主树 HEAD，
   * 而那是**没有上游时的正确行为**，不是"不知道"。
   *
   * ★ 缺省**不是**静默缺省：`baseline.source` 会如实写 `'trunk'`，
   *   而 `baseline.upstream` 是空数组（"这条任务没有依赖边"是可读的读数）。
   */
  upstream?: readonly UpstreamTaskInput[]
}

/**
 * ── ★★★ 一棵任务 worktree 的目录名 ───────────────────────────────────────────────
 *
 * MEASURED（2026-10-10，两条链独立报出同一个现象）：
 *
 *   新团队 merge-e2e 的 t1/t2，成员拿到的树里**没有任务的靶子文件**。
 *   实测：
 *     task-t1 HEAD = d623cbd   ← 上一轮 integrate-probe2 的链 A 产物 commit
 *     task-t2 HEAD = 451c06d   ← 上一轮 integrate-probe2 的链 B 产物 commit
 *     而当前 HEAD = c70cf12
 *
 * ── 根因：任务 id 按团队【重新计数】，而路径名只用 taskId ──────────────────────────
 *
 *   每个团队的 t1 都叫 `t1` ⇒ 都想要目录 `task-t1`。
 *   而 `delete` 一个团队**不清理 worktree**（目录留着），
 *   于是新团队的同名任务命中复用分支 ⇒ **拿到上一轮那棵树**。
 *
 * ★★ 而它在读数上完全正常：`ok: true`、`base` 有值、目录在、`missingIgnored`
 *   也算得出来 —— **"复用了对的树"与"复用了别人的树"同形。**
 *
 * ── 修法：把 teamId 编进路径（在【根上】避免重名，而不是事后检测）───────────────
 *
 *   `task-<teamId>-<taskId>` ⇒ 两个团队的同名任务天然落到不同目录。
 *   ★ 为什么不做"事后校验归属"：那需要在树里再存一份归属记录，
 *     而**多一份会漂移的拷贝**正是本仓记账过多次的形态。
 *     名字本身就能分清的，不要再存一遍。
 *
 * ★ `safe()` 对两段都做：teamId 可能带用户输入的形状（它来自团队名/id）。
 */
export function worktreeDirName(teamId: string | undefined, taskId: string): string {
  const safe = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, '-')
  const safeTask = safe(taskId)
  /**
   * ★ 不给 teamId 时**保持旧形状** —— 而不是编一个假前缀。
   *   夹具与老调用方依赖 `task-<id>`；而生产调用方（scheduler / update_task）
   *   都给 teamId ⇒ 真正的运行路径一律带前缀。
   */
  return teamId === undefined || teamId === ''
    ? `task-${safeTask}`
    : `task-${safe(teamId)}-${safeTask}`
}

/**
 * ── ★★★ 建树基线：从「永远是主树 HEAD」改成「按上游产物定」（t5）──────────────────
 *
 * MEASURED（`docs/WORKTREE-BASE-DEFECT.md`）：`createTaskWorktree` 从
 * `detectWorktreeSupport(repo).base`（= 主树 HEAD）建树，而"任务 B 依赖任务 A"
 * **不**让 B 的树包含 A 的提交 ⇒ 下游在**旧代码**上干活，且两者写域重叠时
 * 下游会**整文件覆盖**掉上游的修复。真实语料：94 条实现→实现边里 60 条（63.8%）
 * 写域重叠、47 条（50%）上游真的提交了。
 *
 * ── 为什么挑【最早】那个可用产物，而不是最后一个 ────────────────────────────────
 *
 * 依赖的产物各自是一条 commit，它们**未必**在同一条历史里（各自从主干切出去）。
 * 拿"最后一条"会让基线**只**含那一条上游，其余的仍然看不见；而任何一个 commit
 * 的后代都**含**它自己 ⇒ 取最早者（拓扑上的最上游）能让**它自己**被包含。
 * ★ 更要紧的是：这样取到的基线与"上游全都看得见"之间**不画等号** ——
 *   所以 `diverged` 会把"某条上游与基线不在同一条历史"如实报出来，而不是假装
 *   它们已经合并了。真正的合并（integrator）是 t16 的事，这里**不做**。
 *
 * ── 反向半边：上游没提交 ⇒ 退回主树 HEAD（这是**对的**，不是降级）───────────────
 *
 * 上游没提交 = 它没产出可看的东西 ⇒ 主树 HEAD 就是当前可见的最新代码。
 * ★ 因此这一格**绝不**拒绝建树：一个"上游还没做完"的状态不该让下游连树都建不出来
 *   （那会把一次正常排序变成一次卡死，正是本仓记账过的 infinite-loop 形态）。
 *
 * ── 三态（逐条上游，不是整体一个布尔）────────────────────────────────────────
 *
 *   `committed`     —— 有 `deliverableCommit` 且在这个仓库里解析得出
 *   `not-committed` —— 没有 `deliverableCommit`（没提交 / kind 本来不建树）
 *   `unreadable`    —— 声称有产物，而 commit 解析不出（树被回收成不可达对象等）
 *
 * ★ 第三种**必须**与第二种不同形：前者是"上游没东西可看"，后者是"上游说有、
 *   而我读不到" —— 后者的补救动作是去查为什么读不到，不是继续在旧代码上干活。
 *
 * ★ 本函数**只读**：不建树、不写盘、不改任何任务记录。判据与派发都能安全地调它。
 */
export function resolveWorktreeBaseline(options: {
  repo: string
  /** 主树 HEAD（`detectWorktreeSupport` 已解析出来的那一格，避免重复读 git）。 */
  trunk: string
  upstream?: readonly UpstreamTaskInput[]
}): BaselineResolution {
  const { repo, trunk } = options
  const requested = options.upstream ?? []
  const readings: UpstreamBaselineReading[] = []
  /** 可用的产物：`{ taskId, commit }`，按"能不能解析出 commit"筛过。 */
  const usable: { taskId: string; commit: string }[] = []

  for (const upstream of requested) {
    if (upstream.unreadable !== undefined) {
      readings.push({ kind: 'unreadable', taskId: upstream.taskId, why: upstream.unreadable })
      continue
    }
    const commit = upstream.deliverableCommit
    if (commit === undefined || commit.trim() === '') {
      readings.push({ kind: 'not-committed', taskId: upstream.taskId })
      continue
    }
    /**
     * ★ 解析一次，而不是信字符串：`deliverableCommit` 是**短 id**（`commitWorktree`
     *   写的是 `rev-parse --short`）⇒ 必须在这里换成完整对象名才可作基线。
     *   而解析失败**不等于**"上游没提交"—— 它是 `unreadable`（见上）。
     */
    const resolved = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${commit.trim()}^{commit}`])
    if (!resolved.ok) {
      readings.push({
        kind: 'unreadable',
        taskId: upstream.taskId,
        why: `its deliverable commit "${commit}" does not resolve in ${repo} (${resolved.message})`,
      })
      continue
    }
    const full = resolved.value.trim()
    /**
     * ── ★★★ 这一份产物**进主干了吗**（与 `judgeWorktreeReclaimable` **同一份判据**）──
     *
     * ★ 只报告、不改基线：`usable` 照旧收它 —— 一个"还没合流"的上游产物
     *   仍然是下游应当看见的最新代码（它比主干 HEAD 新）。★ 把它排除会导致
     *   下游在**更旧**的代码上干活，方向反了。
     */
    const plan = absorbPlanOf({ repo, commit: full, trunk })
    readings.push({
      kind: 'committed',
      taskId: upstream.taskId,
      commit: full,
      landed: plan.absorbed ? 'landed' : 'not-landed',
      ...plan.how === undefined ? {} : { how: plan.how },
      ...plan.absorbed ? {} : { why: 'its committed work is not in the trunk under any of the four absorption forms (ancestor / content / files / contained)' },
    })
    usable.push({ taskId: upstream.taskId, commit: full })
  }

  if (usable.length === 0) {
    /**
     * ★ 没有可用产物 ⇒ 主树 HEAD。`source: 'trunk'` 让读的人**看得出**这一步
     *   是"没有上游可看"，而不是"上游看了、都一样"（两者后果相反）。
     */
    return { base: trunk, source: 'trunk', trunk, upstream: readings, diverged: [] }
  }

  /**
   * ── ★★★ 先找"包含其余全部"的那一条（链的情形）────────────────────────────────
   *
   * 若上游之间是**链**（B 是 A 的后代，例如 t9 依赖 t6 而 t6 又依赖 t3），
   * 那么选**最早**那条会让下游看不见后来的上游 —— 那正是本任务要消灭的形态，
   * 只是换了一层皮：A 的改动在，B 的改动**不在**，而读数却说"基线是上游"。
   *
   * ⇒ 先问"有没有一条能到达其余全部"。有 ⇒ 选它（下游看见的**最多**，且
   *   `diverged` 自然为空）。没有 ⇒ 真分叉，退回按时间挑一条并逐条列 `diverged`。
   *
   * ★ 真实语料：6 个"下游有 ≥2 条 committed 上游"的情形**全部**是真分叉，
   *   所以这条分支在当前语料上不触发 —— 而它仍然必须有，否则一旦出现链，
   *   丢掉的将是**上游的提交**，且没有任何读数会说话。
   */
  const dominator = usable.find(candidate =>
    usable.every(other => other.commit === candidate.commit || isAncestorOrFail(repo, other.commit, candidate.commit)),
  )

  /**
   * ── 挑最早那个：按"提交时间"排序，同刻按拓扑（谁能到达谁）────────────────────
   *
   * ★ 为什么不用 `git rev-list` 的拓扑序：这些 commit **可能互不可达**，
   *   拓扑排序对不相交的分支没有唯一答案。而提交时间是每一条都有的读数。
   * ★ 同刻（同一秒内的批量提交，实测常见）⇒ 用 `--is-ancestor` 破平局：
   *   祖先比后代早。
   */
  const withTime = usable.map((entry) => {
    const stamp = tryGit(repo, ['show', '-s', '--format=%ct', entry.commit])
    const seconds = Number.parseInt(stamp.ok ? stamp.value.trim() : '', 10)
    return { ...entry, at: Number.isFinite(seconds) ? seconds : Number.MAX_SAFE_INTEGER }
  })
  withTime.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    if (a.commit === b.commit) return 0
    if (isAncestorOrFail(repo, a.commit, b.commit)) return -1
    if (isAncestorOrFail(repo, b.commit, a.commit)) return 1
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0
  })
  const chosen = dominator ?? withTime[0]!
  const diverged = usable
    .filter(entry => entry.commit !== chosen.commit)
    .filter(entry => !isAncestorOrFail(repo, entry.commit, chosen.commit))
    .map(entry => ({ taskId: entry.taskId, commit: entry.commit }))
  return { base: chosen.commit, source: 'upstream', trunk, upstream: readings, diverged }
}

/**
 * ★ 三态而不是布尔：`true` 是祖先、`false` 不是、`undefined` 是**问不出来**。
 *   把第三态并进前两态之一，就会在 git 抖动时静默给出一个错误的拓扑判断。
 */
function isAncestorOrFail(repo: string, maybeAncestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', maybeAncestor, descendant], {
      cwd: repo,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * 给一个任务建一个 detached worktree。
 *
 * ★ 为什么 `--detach`：实测边界① —— 同一个分支不能检出到两个 worktree，
 *   而并行成员必然都在同一分支上。detach 之后每个任务各有一个独立 HEAD，
 *   互不冲突；R5 需要的父/修复版本切换在 detach 状态下照样能做。
 *
 * ★ t5：基线**不再**无条件取主树 HEAD —— 见 {@link resolveWorktreeBaseline}。
 *   给了 `options.upstream` 就按上游产物定，回退项仍是主树 HEAD。
 */
export function createTaskWorktree(options: CreateWorktreeOptions): WorktreeResult | WorktreeRefusal {
  const { repo, taskId } = options
  const support = detectWorktreeSupport(repo)
  if (support.ok === false) return support

  const root = options.root ?? join(repo, '.agent-teams', 'worktrees')
  const path = join(root, worktreeDirName(options.teamId, taskId))

  if (!existsSync(root)) mkdirSync(root, { recursive: true })

  /**
   * ★ 基线在**建树之前**算：它与"树在不在"无关，而把它挪进两个分支里
   *   会造出两份口径（本仓记账过多次的形态）。
   */
  const baseline = resolveWorktreeBaseline({ repo, trunk: support.base, ...options.upstream === undefined ? {} : { upstream: options.upstream } })

  // 已经建过 ⇒ 复用（重试一个任务的同一个 attempt 不该炸）
  if (existsSync(join(path, '.git'))) {
    /**
     * ── ★★★ 复用分支：【不】重新对齐，且必须如实说"这不是我选的"──────────────
     *
     * `docs/WORKTREE-BASE-DEFECT.md` 补充段实测：一棵在旧 trunk 上建的树，
     * 之后 trunk 怎么走它都停在原地 —— 而 `mtime` 证明不了它含哪些提交。
     *
     * ★ 这里**不偷偷 ff**：重新对齐会动一棵成员可能正在里面干活的树，那是另一个
     *   决定（缺陷文档把它列为"需人拍板"的三态：clean-and-behind ⇒ ff、
     *   dirty ⇒ 拒绝派发、already-current ⇒ 用）。本任务只负责把**读数**给对。
     *
     * ⇒ 所以 `base`/`baseline.base` 取**实际 HEAD**，`source` 取 `'existing'`，
     *   并把"上游产物不在这个 HEAD 的历史里"逐条列进 `diverged`。
     *   ★ 这一格是**反向半边**在本层的体现：复用一棵旧树时，下游**仍然**看不见
     *     后来的上游提交 —— 而它现在**读得出来**，不再需要靠 mtime 去猜。
     */
    const head = tryGit(path, ['rev-parse', 'HEAD'])
    if (!head.ok) {
      /**
       * ★ HEAD 读不出来 ⇒ 这棵"树"是坏的。此前这里回退到 `support.base`
       *   —— 那是在**报告一个这棵树并没有的 commit**（最坏的一种假读数：
       *   调用方会以为下游看得见主树 HEAD）。
       *   现在退回 `support.base` 只用于 `git worktree add` 的既有语义不变，
       *   但 `baseline` 明白地说"读不出来"，且 `base` 仍回退（调用方需要它）。
       */
      return {
        ok: true,
        path,
        base: support.base,
        missingIgnored: missingIgnored(repo, path),
        baseline: {
          ...baseline,
          source: 'existing',
          base: support.base,
          diverged: committedOutside(repo, baseline.upstream, support.base),
        },
      }
    }
    const actual = head.value.trim()
    return {
      ok: true,
      path,
      base: actual,
      missingIgnored: missingIgnored(repo, path),
      baseline: {
        ...baseline,
        source: 'existing',
        base: actual,
        diverged: committedOutside(repo, baseline.upstream, actual),
      },
    }
  }

  const added = tryGit(repo, ['worktree', 'add', '--detach', path, baseline.base])
  if (!added.ok) {
    return { ok: false, reason: `could not create an isolated worktree: ${added.message}` }
  }
  return { ok: true, path, base: baseline.base, missingIgnored: missingIgnored(repo, path), baseline }
}

/**
 * 哪些上游产物 commit **从 `at` 到达不了**（等价于"这棵树里看不见它们"）。
 *
 * ★ 用"到达不了"而不是"不等于"：一条上游是 `at` 的祖先时，它的内容**在**
 *   这棵树里 —— 把它报成 diverged 会让正常的传递依赖变成噪音，而噪音会
 *   让人开始忽略这一整行（那时真的看不见的那条也一起被忽略）。
 */
function committedOutside(
  repo: string,
  readings: readonly UpstreamBaselineReading[],
  at: string,
): { taskId: string; commit: string }[] {
  const outside: { taskId: string; commit: string }[] = []
  for (const reading of readings) {
    if (reading.kind !== 'committed') continue
    if (!isAncestorOrFail(repo, reading.commit, at)) outside.push({ taskId: reading.taskId, commit: reading.commit })
  }
  return outside
}

/**
 * ── ★ 一句话说清基线是怎么定的（日志与派发文本共用，不各写一份）───────────────────
 *
 * 三态必须**读得出是哪一种**：上游已提交 / 上游没提交 / 读不到上游。
 * 一个"基线：abc1234"的读数把三件事压成了同一行。
 */
export function describeBaseline(resolution: BaselineResolution): string {
  const committed = resolution.upstream.filter(entry => entry.kind === 'committed')
  const notCommitted = resolution.upstream.filter(entry => entry.kind === 'not-committed')
  const unreadable = resolution.upstream.filter(entry => entry.kind === 'unreadable')
  const parts: string[] = []
  if (resolution.source === 'existing') {
    /**
     * ★ 复用分支：**不**声称"基线由上游定" —— 它没定。这棵树停在自己建立时的那一刻。
     *   读的人必须看得出"这是已有树的实际位置"，否则他会以为刚刚做了对齐。
     */
    parts.push(`baseline is where this existing worktree already sits (${resolution.base.slice(0, 12)}) — a worktree that was already there is NOT re-aligned, so it may predate its upstream`)
  } else if (resolution.source === 'upstream') {
    const names = committed.map(entry => `${entry.taskId}@${entry.commit.slice(0, 12)}`)
    parts.push(`baseline is upstream deliverable ${names.join(', ')}${notCommitted.length === 0 ? '' : ` (${notCommitted.length} upstream task(s) committed nothing, so only the committed ones are visible)`}`)
  } else if (resolution.upstream.length === 0) {
    parts.push('baseline is the captain\'s workspace HEAD (this task has no upstream dependency)')
  } else {
    parts.push(`baseline is the captain's workspace HEAD (${resolution.upstream.length} upstream task(s), none of them has a readable deliverable commit)`)
  }
  if (notCommitted.length > 0 && resolution.source !== 'trunk') {
    parts.push(`not committed: ${notCommitted.map(entry => entry.taskId).join(', ')}`)
  }
  if (unreadable.length > 0) {
    parts.push(`unreadable: ${unreadable.map(entry => entry.kind === 'unreadable' ? `${entry.taskId} (${entry.why})` : entry.taskId).join('; ')}`)
  }
  /**
   * ── ★★★ 上游产物**没进主干** ⇒ 必须说出来 ─────────────────────────────────────
   *
   * ★ 它与 `diverged` **不同形**（两者补救动作相反）：
   *   `diverged` 是"从这条基线**到达不了**那个上游"（历史分叉）；
   *   这一格是"**主干**上没有那份工作"（下游照着它干活是对的，而合流还没发生）。
   *   ⇒ 合成一句会让读的人去查历史，而真正该做的是去合流。
   */
  const notLanded = committed.filter(entry => entry.kind === 'committed' && entry.landed === 'not-landed')
  if (notLanded.length > 0) {
    parts.push(
      `NOT yet in the trunk: ${notLanded.map(entry => `${entry.taskId}@${entry.commit.slice(0, 12)}`).join(', ')}`
      + ' — its committed work has not been absorbed by the trunk under any of the four forms, so the trunk alone does not yet contain it',
    )
  }
  if (resolution.diverged.length > 0) {
    parts.push(`NOT visible from that baseline (diverged history): ${resolution.diverged.map(entry => `${entry.taskId}@${entry.commit.slice(0, 12)}`).join(', ')}`)
  }
  return parts.join(' — ')
}

/**
 * 仓库里被 gitignore、但 worktree 里缺失的顶层条目。
 *
 * ★ 这是实测边界③的落点：worktree 是干净的检出，`node_modules` 这类
 *   不存在。**必须报出来**，否则成员会在里面跑命令、因缺依赖而失败，
 *   然后把一次"环境没准备好"误报成"工作没做出来"（两者不同形）。
 */
function missingIgnored(repo: string, worktreePath: string): string[] {
  return ignoredTopLevel(repo).filter((name) => existsSync(join(repo, name)) && !existsSync(join(worktreePath, name)))
}

export interface ProvisionOptions {
  /** The repository (captain workspace) the dependencies are copied from. */
  repo: string
  /** The task worktree the dependencies are copied into. */
  worktree: string
  /**
   * Top-level entries to copy (typically `<repo>/node_modules` — the ones
   * `missingIgnored` reported). Relative, but `..` and absolute paths are
   * refused: provisioning must never reach outside either root.
   */
  entries: readonly string[]
  /**
   * ── ★★ 硬链接原语（可注入）—— 让"退化到拷贝"那条路**可被夹具直接走到**───────
   *
   * 缺省是 {@link defaultHardLinkTree}（`cp -al`）。存在的理由不是"为了好测"，
   * 而是一条**可达性**问题：
   *
   *   ★ 生产那条退化路的**后半段**在真实环境里不一定造得出来，而最经典的那个原因
   *     ——跨设备 EXDEV——在这台机器上就造不出来：它要求源与目标真的在两个文件系统上
   *     （macOS 上 `/tmp` 是 `/private/tmp`，与工作区**同一个**卷）。
   *   一条"只能靠运气触发"的分支，等于一条**没被走通的**分支：它坏了也没人知道。
   *
   *   ★ 说清楚这里补的是**哪一半**：让 `cp -al` **失败**本身是可达的（源不存在、
   *     目标的父级是普通文件……），那些走 {@link defaultHardLinkTree} 的**真身**，
   *     夹具可以真跑。本缝补的是另一半 —— `{ok:false}` **返回之后**那段处置
   *     （退化到 `cpSync` + 把理由落进两条读数）。
   *
   * ⇒ 于是这里留一格**诚实的缝**：夹具可以注入一个"必然报失败"的原语，
   *   断言【退化真的发生了、理由真的被报出来了】，而**不需要**在这台机器上
   *   硬造一个第二文件系统（伪造一个跨设备场景比测不到更坏）。
   *   ★ 注入什么理由由夹具自己定 —— 它**不必**是 EXDEV，因为生产那条路本来
   *     也不区分 errno（见 {@link defaultHardLinkTree}）。
   *
   * ★ 生产调用方**不要**传它 —— 缺省那条就是真的 `cp -al`。
   */
  link?: HardLinkTree
}

/**
 * 一棵树硬链接进另一棵：**普通文件硬链接、软链原样重建**（`cp -al` 的语义）。
 * ★ 返回读数而不是抛异常 —— "这个文件系统不支持硬链接"是**预期内的**一条路，
 *   不是异常（异常留给真的意外）。
 */
export type HardLinkTree = (source: string, target: string) => { ok: true } | { ok: false; reason: string }

/**
 * ── 缺省硬链接原语：`cp -al <source> <target>` ────────────────────────────────
 *
 * ★ 为什么是 `cp -al` 而不是自己递归 `linkSync`：
 *   · `-a`（= `-dR --preserve=all`）里的 `-d` 正是"**不 dereference**、软链原样
 *     重建" —— 与旧代码 `cpSync(..., {dereference:false})` 逐条同义；
 *   · `-l` 是"能硬链接就硬链接"；
 *   · 权限位、时间戳、包内部那些 pnpm 的相对软链，全部按 `cp -a` 的既有语义走 ——
 *     手写一遍只会多出一堆自己造的边界。
 *
 * ★ 为什么走 `spawnSync` + **argv 数组**、绝不是 shell 字符串：源与目标都是
 *   调用方给的路径，拼进 shell 就是把注入点交给文件名（本仓对这条有明确纪律）。
 *
 * ★ 为什么把 stderr **原样**交出去（而不是把它归类成某个 errno）：本原语**不做**
 *   errno 级别的判别 —— 它只读 `exit status`，非 0 就是失败。
 *
 *     · 判据只有一条：`status === 0` ⇒ `{ok:true}`；否则 ⇒ `{ok:false, reason}`。
 *     · `reason` 里带的是 `cp` **自己的 stderr 原文**（含它写出的路径与错误串）。
 *
 *   ⇒ 于是"退化"这条路的触发面**比 EXDEV 宽**：任何让 `cp -al` 失败的原因
 *     （跨设备、**路径写错**、目标父级不是目录、权限不足、文件系统不支持硬链接……）
 *     都会落到同一条退化路上。这是**故意**的：真正决定"能不能硬链接"的不是
 *     我们，而是 `cp` 与文件系统 —— 我们只读它的结论。
 *
 *   ★ 而诚实性来自**不翻译**：理由原文照转 ⇒ "路径写错"报出来就是"路径写错"，
 *     绝不会被我们改写成"跨设备"。一个自作聪明的 errno 判别反而会把
 *     "`cp` 为什么失败"这件事盖掉（而本仓的纪律是：读数不许被加工成好听的形状）。
 */
export const defaultHardLinkTree: HardLinkTree = (source, target) => {
  const result: SpawnSyncReturns<string> = spawnSync(
    'cp',
    ['-al', source, target],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, reason: `cp -al could not be started: ${String((result.error as Error).message ?? result.error)}` }
  }
  if (result.status === 0) return { ok: true }
  const stderr = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
  return {
    ok: false,
    reason: `cp -al could not hard-link this entry (exit ${String(result.status)}): ${stderr === '' ? 'no output' : stderr}`,
  }
}

/**
 * 一件依赖是【怎么】进的 worktree —— ★ 三态，不许并成一个布尔。
 *
 *   · `linked` —— 硬链接进去的：与源【共用同一份物理数据】（inode 相同）。
 *     ★ 这是常态，也是"多棵 worktree 只占一份磁盘"的来源。
 *   · `copied` —— 退回到了真拷贝（跨设备 / 硬链接不可用）。★ 它是**次好**的
 *     结果：依赖在场、调用方可以照常开工，但它**没有**省下磁盘，所以必须
 *     与 `linked` 分得开 —— 否则"这次占了双倍磁盘"这件事在读日志时消失。
 *   · `existed` —— 目标已经在场，本次【什么都没做】（幂等分支）。
 *     ★ 它与前两者不同形：前两者是"我动手了"，它是"早就在了"。
 *
 * ★ 为什么不并成一个 `copied: boolean`：本仓记账过的那条 ——
 *   "链接成功"与"退化成拷贝"在读数上同形时，磁盘为什么没省下来永远不会被发现。
 */
export type ProvisionMode = 'linked' | 'copied' | 'existed'

export interface ProvisionResult {
  /** Entries that are now present in the worktree. */
  copied: string[]
  /**
   * ★ 没能准备的那一件 + 原因。**必须报出来**：一件"没准备好"如果静默通过，
   *   成员会在里面跑命令、因缺依赖失败，然后把一次"环境没准备好"误报成
   *   "工作没做出来"（两者不同形）。
   */
  failed: Array<{ entry: string; reason: string }>
  /**
   * ── ★★★ 逐条读数：这一件是【怎么】进场的 ──────────────────────────────────────
   *
   * `copied` 只回答"在不在场"，回答不了"省没省磁盘"。而后者正是这次改动的
   * 【全部目的】（46 棵树 × 1.6G = 23G ⇒ 并发被磁盘卡在 ~6，而不是被
   * `maxActiveSubagents` 卡住）。所以它必须是一条**自己的**读数。
   *
   * ★ 三态见 {@link ProvisionMode}：`linked` / `copied` / `existed`。
   *   **"退化成真拷贝"不是失败**（依赖确实在场），所以它【不】进 `failed` ——
   *   但也不能因此消失，它在这里，并带一条可读的 `reason`。
   */
  entries: Array<{ entry: string; mode: ProvisionMode; reason?: string }>
  /**
   * ── ★ 退化发生过吗：所有**真拷贝**的理由（硬链接没成 —— 跨设备只是其中一种）───
   *
   * ★ 它就是调度器要落进任务记录的那一条 —— "这棵树的依赖占了双倍磁盘，
   *   因为 <cp 的 stderr 原文>"。★ 原文里是**真正的原因**：可能是 `EXDEV`（跨设备），
   *   也可能是路径写错 / 目标父级不是目录 / 权限不足 —— 本函数不替 `cp` 归类。
   *   空数组 = 每一件都是硬链接（或早已在场）。
   */
  linkFallbacks: Array<{ entry: string; reason: string }>
  /**
   * ── ★★ 硬链接语义的诚实边界（不是免责声明，是一条必须被读到的读数）─────────────
   *
   * 硬链接 = 同一个 inode 的**又一个名字**。于是：
   *
   *   · **替换**一个文件（写新文件 + `rename`，也就是 `pnpm install` 做的事）
   *     ⇒ 只有做替换的那棵树换了 inode，另一棵树仍指向旧 inode
   *     ⇒ **两棵树各验证各的**这条前提成立。
   *   · **就地改写**（`writeFileSync` / `>>` / `sed -i` 不带 rename）
   *     ⇒ ★ **两棵树同时看见** —— 硬链接去掉了软链的"目录结构写穿"，
   *       但**去不掉共享 inode 本身**。这条必须明说，不能声称一个已经不成立的隔离。
   *
   * ★ 所以本字段在【注入之后】如实给出这条边界，调用方/成员能读到它，
   *   而不是从一个"复制品"的旧结论里去推断一个已经不成立的性质。
   */
  hardLinkCaveat: string
}

/** 注入之后必须被读到的那条边界（见 {@link ProvisionResult.hardLinkCaveat}）。 */
const HARD_LINK_CAVEAT =
  'entries are HARD LINKS to the shared source: replacing a file (new file + rename, what pnpm install does) '
  + 'stays local to the tree that replaced it, but an IN-PLACE rewrite of a file is visible in every tree that '
  + 'shares that inode — hard links remove the symlink\'s write-through *path*, not the shared inode itself'

/**
 * ── 依赖按需注入：把测试需要的包【硬链接】进 worktree ──────────────────────────
 *
 * worktree 是干净的检出，gitignore 的 `node_modules` 不在里面（实测边界③）。
 * 成员要在隔离目录里跑验证命令，就必须有依赖。四条路的实测结论：
 *
 *   · 软链（symlink）⇒ ★ **会被写穿**：worktree 里的写入顺着链改到主检出的
 *     依赖树。一条被共享、可被任意改写的依赖树，会让"两个成员各自验证"
 *     在日志里同形，而出问题时无从归因。
 *   · 只读锁（chmod / lockfile）⇒ 不阻止写穿，只把成员换成另一种失败方式。
 *   · 复制品（copy）  ⇒ 互不影响，代价是**磁盘**：1.6 GiB/棵 ⇒ 46 棵树 = 23 GiB
 *     ⇒ ★ **并发被磁盘卡在 ~6，而不是被 `maxActiveSubagents` 卡住**。
 *   · 硬链接（hard link）⇒ ★ 本函数现在的做法。**同一份物理数据的又一个名字**：
 *         - inode **相同**、`nlink` > 1 ⇒ N 棵树合起来只占**一棵**的大小；
 *         - 包内部自带的**相对软链原样保留**（`cp -al` 的语义与
 *           `dereference:false` 一致：硬链接文件、重建软链）；
 *         - **替换**文件（新文件 + rename，`pnpm install` 所做的）只影响做过
 *           替换的那棵树 ⇒ "两个成员各自验证"成立；
 *         - ★ 但**就地改写**会穿到另一棵树 —— 硬链接去掉了软链的写穿*路径*，
 *           **去不掉共享 inode 本身**。这条写在 `hardLinkCaveat` 里，不藏着。
 *
 * ── ★★★ 硬链接不成：退化，但【不是静默】─────────────────────────────────────────
 *
 * 硬链接过不了设备边界（源与目标在同一个文件系统上才可能）—— **跨设备 EXDEV 是
 * 这条路上最经典的那个原因，但不是唯一的一个**：路径写错、目标父级不是目录、
 * 权限不足、文件系统不支持硬链接……都会让 `cp -al` 失败，而本原语**只看 exit
 * status**（见 {@link defaultHardLinkTree}），不区分 errno ⇒ 它们**都**落到这条
 * 退化路上。这是有意的：**判据归 `cp` 与文件系统，我们只读结论**。
 *
 * 不论**哪一种**原因，处置是同一条：退回**本函数原来的** `cpSync` —— 依赖确实
 * 在场 ⇒ **不算 failed**（失败是"没准备好"，那是另一种形）。但"这次没省下磁盘"
 * 必须留下**可读的理由** ⇒ 进 `entries[].mode = 'copied'` + `reason`，并汇总进
 * `linkFallbacks`；`reason` 是 `cp` 的 **stderr 原文**，于是读日志的人看到的是
 * **真正的原因**（写错路径就报写错路径），而不是一句笼统的"跨设备"。
 * ★ 不许静默退化：静默之后"说好的共享"与"实际各占一份"在读日志时同形。
 *
 * ★ 为什么是选项而【不是】自动执行：注入一棵 node_modules 很贵，静默地做会把
 *   "派发很快"变成"派发很慢"。调用方（调度器）显式要求才做，本函数不猜。
 *
 * ★ 为什么 entries 必须显式给出：我们不读 `.gitignore` 的语义（那是 git 的事），
 *   调用方拿 `missingIgnored` 的结论来喂它 —— 于是"要注入什么"有唯一来源。
 */
export function provisionWorktreeDependencies(options: ProvisionOptions): ProvisionResult {
  const { repo, worktree } = options
  const copied: string[] = []
  const failed: Array<{ entry: string; reason: string }> = []
  const readings: ProvisionResult['entries'] = []
  const linkFallbacks: ProvisionResult['linkFallbacks'] = []
  const link = options.link ?? defaultHardLinkTree

  for (const entry of options.entries) {
    const safe = safeRelativeEntry(entry)
    if (safe === undefined) {
      failed.push({ entry, reason: 'refused: only plain relative entries directly inside the repo may be provisioned' })
      continue
    }
    const source = join(repo, safe)
    const target = join(worktree, safe)
    if (!existsSync(source)) {
      failed.push({ entry: safe, reason: `not present in ${repo}` })
      continue
    }
    if (existsSync(target)) {
      // 已经在了 ⇒ 不重复注入（重试一个 attempt 不该把依赖树再搬一遍）。
      copied.push(safe)
      readings.push({ entry: safe, mode: 'existed', reason: 'the target already existed — nothing was injected again' })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    /**
     * ★★★ 先试硬链接（`cp -al`）—— 与 `cpSync(..., {dereference:false})` 的
     *   语义逐条对齐：普通文件**硬链接**，软链**重建为软链**（包内部那些
     *   pnpm 的相对软链必须原样保留，dereference 会把 .pnpm 的相对结构弄失真）。
     *
     * ★ 失败路径：`cpSync` 自己就是它自己的**兜底**（`-n` 不覆盖已存在的 ⇒
     *   `force:false`；`errorOnExist:false`）。所以半个目标不会把重试彻底卡死。
     */
    try {
      const linkedTree = link(source, target)
      if (linkedTree.ok) {
        copied.push(safe)
        readings.push({ entry: safe, mode: 'linked' })
        continue
      }
      /**
       * 硬链接不成 ⇒ 退回真拷贝，并**留下理由**。★ 触发它的**不**只有跨设备：
       * 本原语只看 `cp -al` 的 exit status（路径写错、权限不足都会落到这里，
       * 且理由里报的就是它们自己）——「跨设备」只是最常见的那一种，不是判据。
       */
      cpSync(source, target, { recursive: true, dereference: false, force: false, errorOnExist: false })
      const reason = linkedTree.reason
      copied.push(safe)
      linkFallbacks.push({ entry: safe, reason })
      readings.push({ entry: safe, mode: 'copied', reason })
    } catch (error) {
      failed.push({ entry: safe, reason: String((error as Error | undefined)?.message ?? error) })
      continue
    }
  }

  return { copied, failed, entries: readings, linkFallbacks, hardLinkCaveat: HARD_LINK_CAVEAT }
}

/** 只接受"直接位于根下的普通相对条目"——注入路径不能穿到根外。 */
function safeRelativeEntry(entry: string): string | undefined {
  const trimmed = entry.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.includes('/') || trimmed === '.' || trimmed.includes('..')) return undefined
  return trimmed
}

/**
 * ★ 派发提示里告诉成员"在哪干活"的那一行。
 *
 * 这是隔离能否真正生效的关键：cwd 改不了（§5②），所以**只能靠提示告诉成员**。
 * 不给出路径时返回空串 —— **绝不产出一个伪造的指令**。
 */
export function worktreePromptLine(path: string | undefined): string {
  if (typeof path !== 'string' || path.trim() === '') return ''
  return `Working directory: ${path.trim()}\nWork only inside this directory: it is your isolated worktree (a clean checkout of the parent revision). Do not edit files in the captain's workspace.`
}

/**
 * ── ★★★ 把一棵 worktree 上的改动【提交】成一个 commit ────────────────────────────
 *
 * ── 它补的是什么（2026-10-10 实测出来的缺口）────────────────────────────────────
 *
 * 在此之前，本插件**只建树、不提交**：
 *
 *     scheduler.ts:839  createTaskWorktree(...)     ← 建了
 *     （成员在里面干活）
 *     （……没有任何地方 commit）
 *
 * MEASURED（2026-10-10，用 48 棵 worktree 普查）：
 *     46 棵 worktree 里，目标文件**一个都没有** —— 因为 worktree 是 checkout
 *     产物，只含**已提交**内容，而成员改动从未被提交。
 * ⇒ ★ 后果：integrator **没有任何东西可合**。
 *   「合并 ≥2 棵 worktree」这个承诺在机制上**无法成立** —— 不是没做，是没有载体。
 *
 * ── ★ 为什么"改动没提交"是一个静默的缺口 ────────────────────────────────────────
 *
 * 它不报错、不失败、每一项读数都正常：
 *   · 成员在树里改了文件 ⇒ `git status` 在**那棵树里**看得见；
 *   · 任务可以照常 completed（判据读的是成员自报的 changedPaths）；
 *   · 而**从外面看**（主仓、integrator、下游）什么都看不到。
 *
 * ⇒ 与本仓记过的那条同族：**"我改了"与"改动在版本控制里"是两件事**，
 *   而两者在"任务 completed"这个读数上同形。
 *
 * ── 三条设计约束（各自都有理由）─────────────────────────────────────────────────
 *
 * ① **只提交，不推送、不合并。** 合流是 integrator 的事（它要看到**多棵**树
 *    才能发现"各自自洽、合起来冲突"的那一类问题）。这里只负责让产物**有载体**。
 * ② **没有改动 ⇒ 不产出空 commit。** 空 commit 会让"这次什么都没改"与
 *    "改了但被提交了"同形 —— 而 integrator 会把它当成一条真实的产物去合。
 * ③ **失败要能说出是哪一种失败**（三态）：没有改动 / 提交成功 / 提交失败（带原因）。
 *    把它们合成一个布尔，就是本仓反复记账的那个合流。
 */
export type CommitWorktreeResult =
  /** 提交成功，`commit` 是新 commit 的短 id。 */
  | { ok: true; commit: string; filesChanged: number }
  /** 树里没有改动 ⇒ **不产出空 commit**（这不是失败，是一个结论）。 */
  | { ok: true; commit: undefined; filesChanged: 0; reason: 'no changes to commit' }
  /** 提交失败，带原因（调用方据此上报，不许静默）。 */
  | { ok: false; reason: string }

export interface CommitWorktreeOptions {
  /** worktree 的绝对路径。 */
  worktree: string
  /** 任务 id —— 进 commit message，让产物**可归属**到是哪一条任务造的。 */
  taskId: string
  /**
   * 归属信息（可选）。★ 有它才能回答"这个 commit 是哪一次尝试造的" ——
   * 而 `attempt_id` 是 capability，它一换代，旧 commit 的归属就说不清了。
   * ⇒ 缺省时不编造，直接不写这一行。
   */
  attemptId?: string
  /** 谁干的（成员名 / 临时工标识）。同样：缺省不编。 */
  author?: string
}

/**
 * 提交一棵 worktree 上的全部改动。
 *
 * ★ 用 `git add -A`（含新增与删除）。**不**只加 tracked 文件 ——
 *   实测过的形态：新建文件是任务产物里最常见的一类，而 `git add -u`
 *   会静默漏掉它们，于是"提交成功"与"提交了个空"同形。
 */
export function commitWorktree(options: CommitWorktreeOptions): CommitWorktreeResult {
  const { worktree, taskId } = options
  if (!existsSync(join(worktree, '.git'))) {
    return { ok: false, reason: `not a worktree (no .git): ${worktree}` }
  }

  /** ① 先问"有没有改动" —— 没有就**不产出空 commit**（约束 ②）。 */
  const status = tryGit(worktree, ['status', '--porcelain'])
  if (!status.ok) return { ok: false, reason: `could not read the worktree status: ${status.message}` }
  const lines = status.value.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) {
    return { ok: true, commit: undefined, filesChanged: 0, reason: 'no changes to commit' }
  }

  const added = tryGit(worktree, ['add', '-A'])
  if (!added.ok) return { ok: false, reason: `git add -A failed: ${added.message}` }

  /**
   * ★ 归属行：**有才写，没有就不写**。编一个 `attempt=unknown` 会让
   *   "我不知道归属"与"归属就是 unknown"同形。
   */
  const trailer = [
    options.attemptId === undefined || options.attemptId === '' ? undefined : `Attempt: ${options.attemptId}`,
    options.author === undefined || options.author === '' ? undefined : `Author: ${options.author}`,
  ].filter((line): line is string => line !== undefined)

  const message = [
    `task(${taskId}): worktree deliverable`,
    '',
    'Committed by agent-teams when the task reached a terminal state.',
    '★ 这条 commit 是【那棵 worktree 上的原始产物】—— 合流由 integrator 负责，',
    '  它要看到多棵树才能发现"各自自洽、合起来冲突"的那一类问题。',
    ...trailer.length === 0 ? [] : ['', ...trailer],
  ].join('\n')

  const committed = tryGit(worktree, [
    '-c', 'user.name=agent-teams',
    '-c', 'user.email=agent-teams@localhost',
    'commit', '--no-verify', '-m', message,
  ])
  if (!committed.ok) return { ok: false, reason: `git commit failed: ${committed.message}` }

  const head = tryGit(worktree, ['rev-parse', '--short', 'HEAD'])
  if (!head.ok) {
    /**
     * ★ 提交**成功了**而读不到 id —— 这两件事必须分开。
     *   报 `ok:false` 会让调用方以为没提交，于是可能重复提交。
     */
    return { ok: false, reason: `the commit succeeded but its id could not be read: ${head.message}` }
  }
  return { ok: true, commit: head.value.trim(), filesChanged: lines.length }
}

/** 一个便于诊断的单行描述。 */
export function describeWorktree(result: WorktreeResult): string {
  const ignored = result.missingIgnored.length === 0
    ? ''
    : ` (missing gitignored entries: ${result.missingIgnored.join(', ')} — install dependencies inside the worktree before running tests)`
  return `${result.path} @ ${result.base.slice(0, 12)}${ignored}`
}

/**
 * ── ★★★ 回收一个 worktree 是否安全：判据是「产物已被主树吸收」（t89）──────────────
 *
 * 用户原话：「不能每次都让我手动清理，得有一个自动清理的机制。」
 *
 * 上面那个 `provisionWorktreeDependencies` 是**装**，而这里补的是它的对面 ——
 * **收**。而两半必须成对：只有装没有收，就是今晚的 4.6G。
 *
 * ── ★★ 判据**不是**「任务已终态」────────────────────────────────────────────────
 *
 *   ① 一个 worktree 在【它的产物并入主树之前】不能删 —— 否则那份工作就丢了。
 *      ★ 今晚 t39 那次正是靠 worktree 找回的。
 *   ② 成员常常需要【重跑一次】（例如收口时再跑护栏）——
 *      若依赖已被清掉，那次重跑要重新 install，而那比保留更贵。
 *
 * ── ★★★ 而 `--is-ancestor` 【一条不够】—— 这是实测出来的 ────────────────────────
 *
 *   MEASURED（2026-10-08，本仓 50+ 个 worktree）：
 *
 *     `git merge-base --is-ancestor <wt HEAD> main` 成立 ⇒ **37 个**
 *     ★ 而那 37 个里 **35 个有未提交的改动**；再往里查，**7 个**持有
 *       【内容在整个历史里都不存在】的源码 —— `task-t64` 有 7 个源码文件
 *       （68KB / 69KB 级）只存在于那里。
 *
 *   ⇒ ★ 只看它会删掉**唯一的那份产物**，而那正是本能力承诺不会发生的事。
 *
 * ── ★ 所以是**两个条件的合取** ─────────────────────────────────────────────────
 *
 *   (a) 已提交的：`--is-ancestor <wt HEAD> main`
 *   (b) 未提交的：**每一个脏的源码文件的内容都能在历史里找到**
 *       ★ 只算源码（`src/` `scripts/` `docs/`）—— `lib/` 是构建产物，每次 build
 *         重生成，它脏不构成"唯一产物"。这个区分是实测逼出来的：
 *         不做它，`task-t16` 会因为一个 stamp 文件被误判成"有唯一产物"。
 *
 * ── ★★★ 而 `--is-ancestor` 【一条也不够】—— 反方向的那一半（t9）──────────────────
 *
 * MEASURED（2026-10-10，captain 在真实使用中量到）：
 *
 *   真实的合流流程**不是 merge，是按文件落盘**：
 *
 *     成员在自己的 worktree 里提交          ⇒ commit A
 *     captain **按文件**把它落进 main      ⇒ commit B（内容相同、**对象不同**）
 *     ⇒ A **永远不是** B 的祖先
 *     ⇒ 判据**永远**答 keep ⇒ 那棵 worktree 永远不会被回收
 *
 *   当天量到：4 棵**产物早已落在 main 上**的 worktree，全部答 `keep`，占 3.5G。
 *
 * ⇒ ★ 所以 (a) 必须被**放宽**成「已提交的部分被吸收了」的**两种形态**：
 *
 *     形态 Ⅰ（原来的那一条）：A 是 `main` 的祖先 —— 即真的并进去了。
 *     形态 Ⅱ（本次新增）：A 的**内容**已经在 `main` 里，即使 A 这个对象
 *        从来不是它的祖先 —— 即"按文件落盘"那种合流。
 *
 * ── ★★ 形态 Ⅱ 用的是什么 git 原语，以及它**不**覆盖什么 ──────────────────────────
 *
 *   用的是 `git patch-id --stable`：把一次提交的 `git show` 输出**规范化**成
 *   一个与父提交无关的 id（它把 hunk 的行号/偏移那类上下文抹掉，只留
 *   "改了什么内容"）。
 *
 *     `git show <A> | git patch-id --stable`   →  id_A
 *     `git show <main> | git patch-id --stable` →  id_main
 *
 *   而 `id_A === id_main` ⇒ **A 这次提交的改动，与主干顶端那次提交的改动
 *   逐内容等价**（即使两条提交的对象、父提交、时间戳都不同）。
 *   ⇒ 而"按文件落盘"产生的 B 正是这个形状：同样的内容、不同的对象。
 *
 * ★ 为什么**不**用 per-file 的树比较（`git diff --quiet <tree> main`）——
 *   它看着更简单，但**在本仓会恒不成立**。MEASURED（2026-10-10，本仓：
 *   `main` 里 3 个未跟踪的工作文件，`.agent-teams/` 未被 gitignore）：
 *
 *     树比较是**全树相等**，而它与"按文件落盘"的合流**不是同一个东西**：
 *     captain 落盘只落**产物那几个文件**，主干上**同时还有**别的工作
 *     ⇒ 两棵树从那一刻起就不可能相等 ⇒ 判据退化成**恒不删**。
 *   ⇒ 而 patch-id 比较的是**这一次提交的改动**，不是两棵树的快照
 *     ⇒ 它正是"按文件落盘"的那个形状。
 *
 * ── ★★★ 部分落盘 ⇒ **保留**（本模块明确裁定的边界）──────────────────────────────
 *
 *   判据问的是「**这棵树的这次提交**被吸收了吗」，而它只有两种答案：
 *   `id_A` 命中主干上**某一条**提交 ⇒ 吸收；一条都不命中 ⇒ 未吸收。
 *   ⇒ 「一半落盘、一半没落」在这个判据下**不**是一格单独的读数 ——
 *     它落到"未吸收"那一格（那条被落盘的提交**不是** A 的 patch-id）。
 *
 *   ★ 而即使将来有人把它写成"逐文件部分命中"，答案也**必须**是 keep：
 *     `absorbed` 是**删除的准入**，而"删掉它"会连带扔掉**没落盘的那一半**。
 *     判据宁可少删（保留一棵多余的树，成本是磁盘），也不能多删
 *     （扔掉一份只存在于那里的工作，成本是那份工作**本身**）。
 *   ★ 而"部分落盘"真的会发生：captain 落盘时**挑文件**是常态，
 *     所以这条边界不是假想的。
 *
 * ── ★★ 新增的这半边**没有**放松安全那一半 ──────────────────────────────────────
 *
 *   (b) 一个字没动，而且它仍然是**合取**里的一员 ——
 *   即使 (a) 两种形态**都**命中（真的并进去了、或内容已落盘），
 *   `unique-work` 照样能把一棵树**按住**（臂 3 与臂 T25-2 钉的就是这一格）。
 *   ⇒ 形态 Ⅱ 只是把 (a) 的**准入面**放宽了一格，**没有**动"什么算唯一产物"。
 */
export type WorktreeReclaimability =
  | {
      status: 'reclaimable'
      reason: 'absorbed'
      /** ★ 这一次**拿谁比的**（W1）：读日志的人据此判断这次裁决可不可信。 */
      trunk: TrunkReading
      /**
       * ★ 是**哪一种**吸收（三种形态**不是**同一件事，读的人要能分开）：
       *   `'ancestor'` —— 提交对象真的并进了主干（形态 Ⅰ）；
       *   `'content'`  —— 提交对象不是祖先，而**这次提交的改动**与主干顶端那次
       *                   逐内容等价（形态 Ⅱ，patch-id 命中，例如 cherry-pick）；
       *   `'files'`    —— ★ t34 新增（**更强**的那一格）：提交对象不是祖先、patch-id 也不命中，
       *                   而**这次提交碰过的每一个文件**在主干**顶端**上都存在且逐字节相同
       *                   （形态 Ⅲ，**手工按文件落盘且主干此后没再动过那些文件**）。
       *   `'contained'` —— ★ t34 新增（**更弱**的那一格，但覆盖面更大）：
       *                   两者都不命中，而这次提交碰过的**每一个文件的内容**
       *                   都在主干**历史**里（按可达性核对过 —— 见 `containedAbsorbed`）。
       *                   ▲ 它与 `'files'` **是两种不同的诊断，不许合流**：
       *                     `'files'` 说"主干今天拿着的就是这份内容"（更强的事实）；
       *                     `'contained'` 说"这份内容在主干的历史里被并进去过，
       *                     而主干顶端可能已经又变过"（例如 t28：并进一个 merge 提交，
       *                     此后主干前进过若干提交）。
       * ★ 三态共用 `status: 'reclaimable'` **是故意的**：裁决只有"能清/不能清"两种，
       *   "它是怎么被吸收的"是**依据**，不是第四种裁决 —— 把它做成第四种 status
       *   会让下游每一处读 status 的代码都要多认识一格，而那一格没有行为差别。
       * ★★ 而"依据"**必须可读**（契约明写的一条）：读的人要能分辨
       *   "它真的并进去了" / "它的内容被 cherry-pick 了" / "它的文件被手工落盘了"——
       *   三者的**复核动作不同**（查 merge、查 cherry-pick、逐文件比对）。
       */
      how: 'ancestor' | 'content' | 'files' | 'contained'
      behind: number | undefined
    }
  | { status: 'keep'; reason: 'not-absorbed' | 'unique-work'; trunk: TrunkReading; behind: number | undefined; detail: string; orphaned?: string[] }
  | { status: 'undecidable'; why: string }

/**
 * ── ★★★ 「这次裁决拿谁比的」必须**随裁决一起交出去**（W1）─────────────────────────
 *
 * ── 为什么它是一个字段，而不是只写进日志 ────────────────────────────────────────
 *
 *   本缺陷的原始形态是：判据**照常**给出裁决（`keep`），而那个 `keep` 是拿
 *   一个落后 209 个提交的引用比出来的。⇒ **裁决本身看不出它读错了引用**：
 *   一个"我比错了对象"的 keep 与一个"产物真的没被吸收"的 keep **完全同形**。
 *
 *   ⇒ 所以把"比的是谁、从哪来"做成**裁决的一部分**：
 *     `source` 说清这个引用是怎么来的，读的人（以及臂）据此能分辨
 *     "显式给了" / "从主树检出的分支推出来的"，而不必去猜。
 *
 * ── ★★ 而它**不是**第四种 status ────────────────────────────────────────────────
 *   它不改变裁决（判断仍然是「产物被吸收了吗」），只让那次判断**可复核**。
 *   三态之间的字段仍有区分（`undecidable` 没有它 —— 没比成，自然没有"比的谁"）。
 */
export interface TrunkReading {
  /** 人读的引用名（`'task-mutation-integrate'`）。 */
  readonly ref: string
  /** 已核验可解析的那个 commit sha —— 判据真正拿去比的是它。 */
  readonly commit: string
  /** 这一次的引用从哪来。★ `'explicit'` 与 `'main-worktree-branch'` 是两种可信度。 */
  readonly source: 'explicit' | 'main-worktree-branch'
}


/**
 * ── ★★★ 「这份产物进主干了吗」—— 四选一的**吸收判据**（2026-10-20 从 `judgeWorktreeReclaimable` 抽出）
 *
 * ── 为什么要抽出来 ────────────────────────────────────────────────────────────
 *
 * 这条判据此前**只能通过一棵还在盘上的 worktree** 问（`judgeWorktreeReclaimable`
 * 读它的 HEAD 与 `git status`）。而 MEASURED（本仓 78 个 `deliverableCommit`）：
 * ```
 *   不是 HEAD 祖先的          74 个
 *   其中所属树**早已被回收**    绝大多数
 * ```
 * ⇒ 交付那一刻要问「哪些产物还没进主干」，而**那个命令对这些产物只能答
 *   "没有这棵树"** —— 那不是"这份产物在哪"的答案。
 *
 * ⇒ 抽成一个只吃 `{repo, commit, trunk}` 的入口：**树没了也能问**，
 *   而它**仍然是同一份判据**（`judgeWorktreeReclaimable` 现在调它，不是复制它）。
 *   ★ 这一条是硬约束：两份吸收判据必然分叉，而分叉之后
 *     "回收时算已吸收、交付时说没合流"会成为一个新的、更难查的不一致。
 *
 * ── 四种形态（逐一保留原判据的语义，一个字都没改）────────────────────────────
 *
 *   `'ancestor'`  —— `commit` 是主干的祖先（真的 merge 进去了）
 *   `'content'`   —— 不是祖先，而这次提交的改动与主干**顶端那次**逐内容等价（patch-id）
 *   `'files'`     —— 它碰过的每个文件在主干**顶端**都存在且逐字节相同（手工落盘）
 *   `'contained'` —— 它碰过的每个文件的内容都在主干**历史**里，且主干顶端那些文件还在
 *
 * ★ 四种**不是**同一件事，所以 `how` 会随裁决一起交出去（复核动作不同）。
 * ★★ 三态纪律：任一格**读不到** ⇒ 那一形态**不算命中**（绝不当成"通过"）。
 */
export function absorbPlanOf(options: {
  /** 主仓库根。 */
  repo: string
  /** 要问的那份产物（**完整对象名或能解析的短 id**）。 */
  commit: string
  /** 主干的那个 commit（`resolveTrunkRef` 已核验过的）。 */
  trunk: string
}): { absorbed: boolean; how?: 'ancestor' | 'content' | 'files' | 'contained' } {
  const repo = options.repo
  const head = options.commit
  const mainHead = options.trunk
  const isAncestor = (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', head, mainHead], {
        cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
      })
      return true
    } catch {
      return false
    }
  })()

  /**
   * ★★★ (a-Ⅱ) 已提交的部分**按内容**被吸收了（t9 新增的那一半）。
   *
   *   MEASURED 的缺陷：真实合流是**按文件落盘**（`cp` + 在主干上提交），
   *   而它产生的是**另一个对象** ⇒ `--is-ancestor` 永远答 false
   *   ⇒ 4 棵产物早已落盘的树全部被判 keep，占 3.5G。
   *
   * ── 这个原语比较的到底是什么 ──────────────────────────────────────────────────
   *
   *   `git patch-id --stable` 把一次提交的 `git show` 规范化成一个
   *   **与父提交无关**的 id：同样的内容改动 ⇒ 同样的 id。
   *
   *     git show <head> | git patch-id --stable   ⇒  同样的 (id, <head>)
   *     git show <main> | git patch-id --stable   ⇒  同样的 (id, <main>)
   *
   *   ⇒ `id` 相等就是"这次提交的改动与主干顶端那次提交逐内容等价"。
   *
   * ★ 为什么只比**主干顶端**（`mainHead`）而不是遍历整条主干历史：
   *   ① 本能力是**回收**，不是考古。真实的按文件落盘发生在**刚刚**，
   *      那条落盘提交就在 `main` 的顶端（captain 落完就完了）。
   *   ② 遍历会引入"两条不同的提交恰好 patch-id 相同"的老历史误命中，
   *      而漏判的代价只是**多留一棵树**（可再跑一次），误判的代价是**扔东西**。
   *   ③ ★ 它的**已知边界**（不藏着）：`main` 顶端此后又前进过 ⇒ 这一格答 false
   *      ⇒ 退回 keep。这是**保守**的错法，方向是对的。
   *
   * ★★ 而为什么必须【两边都真的读到了 id】才算命中：
   *   任一格读不到（空串、命令失败）⇒ **不算命中** ⇒ 退回 keep。
   *   把"没读到"当成"相等"会让判据**恒真**，而那正是本任务禁止的方向。
   */
  const contentAbsorbed = (() => {
    const patchId = (ref: string): string | undefined => {
      try {
        const shown = execFileSync('git', ['show', ref], {
          cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
        })
        const id = execFileSync('git', ['patch-id', '--stable'], {
          cwd: repo, encoding: 'utf8', input: shown, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim().split(/\s+/)[0]
        return id === undefined || id === '' ? undefined : id
      } catch {
        return undefined
      }
    }
    const headId = patchId(head)
    if (headId === undefined) return false
    const mainId = patchId(mainHead)
    return mainId !== undefined && mainId === headId
  })()

  /**
   * ── ★★★ (a-Ⅲ) 已提交的部分**逐文件**被吸收了（t34 新增的那一半）────────────────
   *
   * ── 它补的是哪一格（MEASURED，captain 做的受控对照）────────────────────────────
   *
   * 真实合流有两种，而**只有一个**被上面的两条判据覆盖：
   *
   *   · **cherry-pick**（保留 patch-id）⇒ 形态 Ⅱ 命中 ⇒ `t33` 当场被认出
   *     （"1 reclaimable, 1692.5 MiB"）。
   *   · **手工按文件落盘** ⇒ **两条都不命中** ⇒ `t18` 的 `src/web-routes.ts` 与
   *     `src/index.ts` 与主干**逐字节相同**，而裁决**仍然是** `not-absorbed`。
   *
   *   ⇒ 同一份代码、同一条判据、**相反的裁决**，唯一的差别是**落盘手法**。
   *     ⇒ 后果：sweep 报 "0 reclaimable, 26 kept"，而其中 **12GB** 的树
   *       内容**早已在主干上**。用户的话：手工落盘该是例外，但机制也必须
   *       认得出"内容已经被吸收了"。
   *
   * ── ★★ 判据是什么（机械的，且**不是**整树比较）──────────────────────────────────
   *
   *   **这棵树的 HEAD 相对它父提交改动的【每一个文件】，在主干上都存在、
   *     且内容逐字节相同。**
   *
   *   ★ 为什么**不是**整树比较（`git diff --quiet <tree> main`）——
   *     那份长注释里已经记过它会**恒不成立**，而 t34 再次实测确认：
   *     `t18` 与 `main` 在整树层面差 **109 个文件 / 22421 行**（主干同时还有别的工作），
   *     而**它自己那次提交碰过的 7 个文件**与主干**逐字节相同**。
   *     ⇒ 整树比较问的是"两棵树一样吗"，而我们要问的是
   *       "**这次提交的那份产物**落盘了吗" —— 两者不是同一个问题。
   *
   *   ★ 为什么是"它碰过的文件"而不是"整棵树里的每个文件"：
   *     后者等价于整树比较（主干上别的工作会让它恒不成立）。
   *     ⇒ 只问**这次提交意图改变的那些**，因为**那些才是它要交付的东西**。
   *
   * ── ★★★ 它**没有**放松安全那一半（契约硬要求）──────────────────────────────────
   *
   *   · 它是 (a) 的**第三条或项** —— 只决定 `absorbed` 这个布尔值。
   *   · `unique-work`（(b)）**一个字没动**，且仍然在它**之后**跑、仍然是合取里的一员
   *     ⇒ 即使这份产物逐文件都落盘了，任何**只存在于这里**的源码文件照样按得住。
   *   · ★ 而它**不会**把"改了文件但内容不同"判成吸收：那正是 t13 的形状
   *     （它那 1 个文件与主干 **DIFFERS**）⇒ 落 keep。
   *
   * ── ★★ 三态：读不到 ⇒ **不算命中** ──────────────────────────────────────────────
   *
   *   ① `HEAD^` 读不到（只有一个根提交）⇒ 不算命中（退回 keep）——
   *      `git diff` 失败时**不**把它当成"没有改动"（那会让空提交恒被判吸收）。
   *   ② 该文件在主干上**不存在** ⇒ 不算命中（那份产物没落盘）。
   *   ③ 文件列表为空（HEAD 与父提交完全相同）⇒ 不算命中 ——
   *      "这次提交什么都没改"不是"它的产物被吸收了"的证据。
   *   ⇒ 三条都退回 keep。★ 把任一格读成"通过"会让判据**恒真**，
   *     而那正是本任务与上一轮都明令禁止的方向。
   */
  const filesAbsorbed = (() => {
    let changed: string[]
    try {
      const out = execFileSync('git', ['diff', '--name-only', `${head}^`, head], {
        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      })
      changed = out.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    } catch {
      /** ★ 读不到父提交 ⇒ **不算命中**（见上面 ①）。 */
      return false
    }
    /** ★ 空列表 ⇒ 不算命中（见上面 ③）。 */
    if (changed.length === 0) return false
    /**
     * ★★ 与 `containedAbsorbed` **同一套口径**：构建产物不参与（见那里的长注释）——
     *   它内嵌路径、每次 build 重生成 ⇒ 要求它逐字节相同是**恒不成立**的条件。
     *   ★ 这里同样只在**源码**为空时不算命中。
     */
    const changedSource = changed.filter((path) => !path.startsWith('lib/') && !path.endsWith('git-artifact-stamp.json'))
    if (changedSource.length === 0) return false
    for (const path of changedSource) {
      const headBlob = (() => {
        try {
          return execFileSync('git', ['rev-parse', `${head}:${path}`], {
            cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }).trim()
        } catch {
          return undefined
        }
      })()
      if (headBlob === undefined || headBlob === '') return false
      const mainBlob = (() => {
        try {
          return execFileSync('git', ['rev-parse', `${mainHead}:${path}`], {
            cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }).trim()
        } catch {
          /** ★ 主干上没有这个文件 ⇒ 那份产物没落盘（见上面 ②）。 */
          return undefined
        }
      })()
      /**
       * ★★ 比的是 **blob 对象名**，不是文件内容本身 ——
       *   git 的 blob hash 由内容决定 ⇒ 相同的对象名**就是**逐字节相同。
       *   ★ 而它比读两份文件再比字节便宜得多，且**没有"编码/行尾被我规范化"的风险**。
       */
      if (mainBlob !== headBlob) return false
    }
    return true
  })()

  /**
   * ── ★★★ (a-Ⅳ) 已提交的部分**按内容被包含在主干里**（t34，本轮裁定的那一半）──────
   *
   * ── 它补的是 (a-Ⅱ) 够不到的那一格（MEASURED）──────────────────────────────────
   *
   * `contentAbsorbed` 比的是**两棵树各自顶端那一次提交**的 patch-id ⇒ 它只在一个
   * **干净的 cherry-pick**（顶端即同一个 patch、且无后续提交）上命中。
   *
   * ★★ 而真实的合流常常**多一条提交**：
   *
   *     captain 手工落盘（挑文件 / 顺手改一行）⇒ 顶端提交与 worktree 的不同；
   *     或者落盘时**解过冲突**，于是落盘那条提交之上还有一条解决提交。
   *   ⇒ patch-id 不命中，而**产物明明已经在主干上**。
   *
   * MEASURED（captain 的 t28）：它的顶端提交碰了 20 个文件，其中 **12 个与主干不同**——
   *   而那 12 个**正是它自己的交付物**（`src/client/activity-model.ts`、`locales.ts`、
   *   `ActivityPanel.tsx`、`scripts/workspace-activity.test.mjs`）。
   *   ★ 而它们的内容**确实在主干里**：那几个 blob 出现在 `2386323` 与
   *     **`3ce3e76`（"merge: land R3…"）**里，而后者**是主干的祖先**。
   *   ⇒ 「worktree 的 HEAD 的祖先关系」与「patch-id」**都不命中**，
   *     而"这份工作被并进主干了"**是真的**——它是在一个 **merge 提交**下被并进去的。
   *
   * ── ★★ 判据：这个 HEAD 碰过的**每一个**文件的内容，都在主干的**历史**里（按内容）────
   *
   *   对每个 `path`：存在一个**从主干可达**的提交 `c`，使得
   *   `c:path` 存在、**且其 blob 与 `head:path` 完全相同**。
   *
   * ── ★★★ 而"在历史里"**必须**配上可达性 —— 这是 captain 明令的限定，理由极硬 ─────
   *
   *   **被落盘、随后又被 revert 的内容，仍然存在于主干的历史里。**
   *   ⇒ 一个只扫历史的实现会把**被明确撤销的那份工作**读成"已吸收"
   *     ⇒ 于是它去删掉**唯一的一份副本**。
   *   ★★ 那正是本仓库存在的那个失效形态：**一个读起来像成功的读数，而东西已经没了。**
   *
   * ── ★★★ 为什么不用 `git log <tip> --find-object=<blob>`（captain 建议的那一条）─────
   *
   *   MEASURED（本任务，受控仓库实测）：`--find-object` **匹配删除也算命中** ——
   *   那条 revert 提交本身就在历史里，于是 `git log HEAD --find-object=<blob>`
   *   **照样**列出它。⇒ 它**不是**可达性判据，它是"这个对象在任何提交的树里出现过"，
   *   而"被删掉"也算"出现过"。
   *
   *   ⇒ 所以这里落到的判据是**逐提交、逐路径**的：
   *     那个 blob 必须在某个从主干可达的提交里，**在那个路径上作为内容存在**。
   *     ★ 于是 revert 之后它不再作为内容出现在任何主干可达的提交上（**除非有人又把它加回来**，
   *       而那恰恰就是"它又在主干上了"——那时判 absorbed 是**对的**）。
   *
   * ★★ 代价如实说出：这是**逐文件 × 逐提交**的，比一次 patch-id 贵。
   *   所以它排在**最后**（前面三条任一命中就短路），且只在 `--find-object` 给出候选
   *   提交之后才逐个核对路径与 blob —— 而候选通常只有两三条。
   *
   * ── ★★ 三态：读不到 ⇒ **不算命中** ──────────────────────────────────────────────
   *   · `HEAD^` 读不到 ⇒ false（同 `filesAbsorbed` 的①）
   *   · 改动列表为空 ⇒ false（同③）
   *   · 任一路径在 `HEAD` 上读不到 blob ⇒ false
   *   · 任一文件在主干历史里找不到**作为内容**的那一份 ⇒ false ⇒ 退回 keep
   */
  const containedAbsorbed = (() => {
    let changed: string[]
    try {
      const out = execFileSync('git', ['diff', '--name-only', `${head}^`, head], {
        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      })
      changed = out.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    } catch {
      return false
    }
    /**
     * ── ★★★ 构建产物**不参与**这一格 —— 而且这不是为了让它通过而放宽的 ──────────────
     *
     * MEASURED（本任务）：t28 的 20 个改动文件里，**19 个**的containment 都成立，
     * 唯一不成立的是 **`lib/client.js`** —— 而它是**构建产物**：
     *   · 它内嵌 worktree 路径（实测：正文里出现 4 次本树的名字）⇒ **每棵树的字节都不同**；
     *   · 每次 build 重生成。
     * ⇒ 要求它"内容在主干里存在"是**不可能满足**的，于是整棵树永远判 keep。
     *   ★ 那不是"严格"，那是一条**永远不能为真**的条件（本仓记过同形的缺陷）。
     *
     * ★★ 而这个排除**不是**新发明的口径：本文件的 (b) guard 早就按同一条规则
     *   排除了 `lib/`（见下面 `dirtyPaths` 那一行，原文：
     *   「`lib/` 是构建产物，每次 build 重生成」）。⇒ 两处**同一套口径**，
     *   而不是各写一份（两份会随下一次改动分叉）。
     *
     * ★ 为什么"排除了构建产物"**不会**削弱安全那一半：
     *   构建产物**不是唯一的工作** —— 它由源码重建。真正唯一的东西在 `src/`，
     *   而源码**一个都不排除**。⇒ 扔掉一棵树的 `lib/` 不会扔掉任何人的工作。
     */
    const isBuildProduct = (path: string): boolean =>
      path.startsWith('lib/') || path.endsWith('git-artifact-stamp.json')
    const sourceChanged = changed.filter((path) => !isBuildProduct(path))
    /**
     * ★ 改动里**一个源码文件都没有** ⇒ **不算命中**。
     *   ★ 为什么不是"空就算通过"：一次只改了构建产物的提交**没有交付任何源码工作**，
     *     于是"它的产物被吸收了吗"这个问句**没有对象** ⇒ 落在保守的 keep 上。
     *     （与 `filesAbsorbed` 的③同一条精神：空不是证据。）
     */
    if (sourceChanged.length === 0) return false
    for (const path of sourceChanged) {
      const headBlob = (() => {
        try {
          return execFileSync('git', ['rev-parse', `${head}:${path}`], {
            cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }).trim()
        } catch {
          return undefined
        }
      })()
      if (headBlob === undefined || headBlob === '') return false
      /**
       * ★ 候选提交：主干上"曾经见过这个对象"的那些（含把它删掉的那一次 ——
       *   所以**必须**再逐条核对路径与 blob，见上面的长注释）。
       */
      let candidates: string[]
      try {
        const out = execFileSync('git', ['log', mainHead, '--format=%H', `--find-object=${headBlob}`], {
          cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
        })
        candidates = out.split('\n').map((line) => line.trim()).filter((line) => line !== '')
      } catch {
        return false
      }
      /**
       * ── ★★★ 两条**都要**成立（而第二条是本任务实测补上的那一半）──────────────────
       *
       *   ① 主干**历史**里有一个提交，在那个路径上**就是这份内容**；
       *   ② ★ 而**主干顶端那个文件还在**（`mainHead:path` 读得到）。
       *
       * ── ★ 为什么②不能省（MEASURED：本任务第一版省掉了它，而它当场错了）───────────
       *
       *   「主干历史里有这份内容」**不等于**「主干上还有这份工作」——
       *   **被落盘、随后又被 revert 的内容，仍然在主干的历史里。**
       *
       *   MEASURED（受控仓库）：我造了"落盘 → 删除（revert）"那两步，第一版判据
       *   **照样**答 `reclaimable/contained` ⇒ 于是它要去删掉**唯一的一份副本**，
       *   而那份工作**已经被明确撤销**了。
       *   ★★ 那正是本仓库存在的那个失效形态：**一个读起来像成功的读数，而东西已经没了。**
       *     captain 在裁定里逐字要求这一格必须 HOLD。
       *
       * ── ★★ 而②为什么**不**会把 t28 那类误判成 keep ────────────────────────────────
       *
       *   t28 的文件在主干顶端**还在**（只是被**后续正常提交**推进过）⇒ ② 成立 ⇒ absorbed。
       *   被 revert 的那一份在主干顶端**不存在**（被删了）⇒ ② 不成立 ⇒ keep。
       *   ⇒ 两者的差别**不在**"字节是否相同"，而在**"主干今天还拿着这个文件吗"**。
       *     MEASURED：t28 是"还要着，且内容在此基础上前进过"；
       *     而 revert 是"不要了"。前者是吸收，后者是撤销。
       */
      const landedAsContent = candidates.some((commit) => {
        try {
          return execFileSync('git', ['rev-parse', `${commit}:${path}`], {
            cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }).trim() === headBlob
        } catch {
          /** ★ 那个提交在该路径上没有这个文件（例如它就是删除它的那一次）⇒ 不是证据。 */
          return false
        }
      })
      if (!landedAsContent) return false
      /** ② ★ 主干顶端那个文件**还在**吗（哪怕内容已被后续提交推进）？ */
      try {
        execFileSync('git', ['rev-parse', `${mainHead}:${path}`], {
          cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch {
        /** ★ 主干顶端**没有**这个文件 ⇒ 它被删掉/撤销了 ⇒ **保留**。 */
        return false
      }
    }
    return true
  })()

  /** ★ 四种形态的**合取**：任一命中即"已提交的部分被吸收了"。 */
  if (!isAncestor && !contentAbsorbed && !filesAbsorbed && !containedAbsorbed) {
    return { absorbed: false }
  }
  /**
   * ★ 顺序是**刻意的**（与原判据逐字相同）：`'files'`（顶端逐字节相同，**更强**的
   *   事实）排在 `'contained'`（历史里被并进去过，**更弱**）**之前**。
   */
  const how: 'ancestor' | 'content' | 'files' | 'contained' = isAncestor ? 'ancestor'
    : contentAbsorbed ? 'content'
      : filesAbsorbed ? 'files' : 'contained'
  return { absorbed: true, how }
}


/**
 * 判一个 worktree 能不能回收。
 *
 * @param repo - 主仓库根。
 * @param worktree - 那个检出目录。
 * @param mainRef - ★ 主干引用。**没有缺省值** —— 不给就走
 *   `resolveTrunkRef` 的**声明式来源**（主树自己检出在哪条分支上）。
 *   断言：本参数的类型里**没有** `= 'main'` 这种兜底；一个会过期的字面量
 *   不许再冒充"主干"。见 `resolveTrunkRef` 的文档（含 MEASURED 的 209 个提交）。
 * @returns 三态。★ 三者**不同形**：可清的带 `reason: 'absorbed'` 与 `how`
 *   （`'ancestor'`｜`'content'`，见 `WorktreeReclaimability`）；
 *   不可清的带 `reason` 与 `detail`（以及可能的 `orphaned`）；
 *   判不了的带 `why`。没有任何两个共用同一组字段。
 *
 * ── ★★★ 顺序（这是本判据可辩论的那一半）─────────────────────────────────────────
 *
 *   ① `undecidable`（读不到 HEAD / 读不到主干引用）—— **在一切之前**返回。
 *      判不了 ≠ 可以清，所以它**绝不**往下走到任何"吸收"的判断。
 *   ② 已提交的部分**是否被吸收** —— `--is-ancestor` 与"内容落盘"是**或**：
 *      形态 Ⅰ 命中就**短路**（不去跑 patch-id，省一次 `git show`）；
 *      形态 Ⅰ 不命中才跑形态 Ⅱ。★ 而两者**都不是旁路** ——
 *      它们只决定 `absorbed` 这个布尔值，之后的检查**照跑**。
 *   ③ ★ `unique-work` —— **吸收之后、reclaimable 之前**。
 *      它是把树按住的最后一道，且**对两种吸收形态一视同仁**：
 *      "内容已落盘"**不能**绕过它（臂 3 / 臂 T25-2 / 定向突变臂钉的就是这一格）。
 *   ④ `reclaimable`。
 */
export function judgeWorktreeReclaimable(options: {
  repo: string
  worktree: string
  /** ★ 显式给出就只比它；不给 ⇒ `resolveTrunkRef` 的声明式来源。**没有字面量兜底。** */
  mainRef?: string
}): WorktreeReclaimability {
  const { repo, worktree } = options
  const headResult = tryGit(worktree, ['rev-parse', 'HEAD'])
  if (headResult.ok === false) {
    return { status: 'undecidable', why: 'HEAD could not be read (not a git checkout, or no commit yet)' }
  }
  const head = headResult.value.trim()
  /**
   * ★★★ 主干引用**由解析器给**，不是由一个缺省参数给 ────────────────────────────
   *
   *   旧写法：`const { …, mainRef = 'main' } = options` ⇒ 调用方不传就静默比 `main`，
   *   而本仓的集成**不在** `main` 上（落后 209 个提交，见 `resolveTrunkRef`）
   *   ⇒ 判据读错了引用，而**它的输出看不出这一点**（读起来像一个正常的 keep）。
   *
   *   ⇒ 现在：解析器答 `unresolved` ⇒ 判据答 `undecidable`。
   *     ★ 这一个映射是刻意的：没有主干就**无从比较**，而"无从比较"
   *       与"比过了、没被吸收"必须不同形 —— 后者会被人拿去做删除决策的反向依据。
   */
  const trunkResolution = resolveTrunkRef(repo, options.mainRef)
  if (trunkResolution.status === 'unresolved') {
    return { status: 'undecidable', why: trunkResolution.why }
  }
  const mainHead = trunkResolution.commit
  /**
   * ★ 人读的引用名：解析器说 `'explicit'` 就念**调用方给的那个**，
   *   说 `'main-worktree-branch'` 就念**主树检出的那个分支**。
   *   （判据自己不去跑 git 解析它 —— `commit` 才是已经核验过的那个。）
   */
  const mainRef = trunkResolution.ref
  /** ★ 随裁决交出去的那一格（见 `TrunkReading`：让"这次比的是谁"可复核）。 */
  const trunk: TrunkReading = {
    ref: trunkResolution.ref,
    commit: trunkResolution.commit,
    source: trunkResolution.source,
  }

  /**
   * ★ (a-Ⅰ) 已提交的部分**真的**被吸收了。
   *   ★ 用退出码判，**不用输出** —— `--is-ancestor` 成功时**没有输出**
   *     （空串），而 `tryGit` 对"退出 0、无输出"与"退出非 0"的区分
   *     只能靠抛不抛错 ⇒ 所以要 `try/catch` 而不是比字符串。
   *     ★ 若按输出判，`absorbed` 会恒为 **false** ⇒ 判据退化成**恒不删**
   *       （而那正是反向半边禁止的）。
   */
  /**
   * ★★★ 2026-10-20：吸收判据**不再写在这里** —— 它被抽成 {@link absorbPlanOf}，
   *   于是"树还在盘上"与"树已被回收"两种情形问的是**同一份判据**。
   *   ★ 硬约束：两份判据必然分叉，而分叉之后"回收时算已吸收、交付时说没合流"
   *     会成为一个新的、更难查的不一致。
   */
  const absorbedPlan = absorbPlanOf({ repo, commit: head, trunk: mainHead })
  const absorbed = absorbedPlan.absorbed

  const behindResult = tryGit(repo, ['rev-list', '--count', `${head}..${mainHead}`])
  const behind = behindResult.ok === false ? undefined : Number.parseInt(behindResult.value.trim(), 10)

  /**
   * ★★ (b) 未提交的部分有没有【唯一的产物】。
   *   ★ `lib/` 不算：它是构建产物，每次 build 重生成。
   */
  const dirtyResult = tryGit(worktree, ['status', '--porcelain'])
  const dirty = (dirtyResult.ok ? dirtyResult.value : '').split('\n').filter((line) => line.trim() !== '')
  const dirtyPaths = dirty
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((path) => !path.startsWith('lib/') && !path.endsWith('git-artifact-stamp.json'))
  const orphaned: string[] = []
  for (const path of dirtyPaths) {
    if (!existsSync(join(worktree, path))) continue
    const blobResult = tryGit(worktree, ['hash-object', path])
    if (blobResult.ok === false) continue
    const foundResult = tryGit(repo, ['log', '--all', '--oneline', `--find-object=${blobResult.value.trim()}`])
    if (foundResult.ok === false || foundResult.value.trim() === '') orphaned.push(path)
  }

  if (!absorbed) {
    return {
      status: 'keep',
      reason: 'not-absorbed',
      trunk,
      behind,
      /**
       * ★ 这段措辞要能解释**三种**没被吸收的形状（否则读的人会以为"只有 merge 才算"）：
       *   ① 不是主干的祖先；② 这次提交的改动与主干顶端那次不等价（patch-id）；
       *   ③ ★ 而且**它碰过的每一个文件**也没有在主干上被逐字节落盘。
       *   ★★ t34：第 ③ 条是新增的 —— 不写它，读的人会去查 merge/patch-id 两处就收工，
       *     而**恰恰**漏掉"手工落盘"那一种（那是本任务补的一格）。
       */
      detail: `its HEAD (${head.slice(0, 12)}…) is neither an ancestor of ${mainRef} `
        + `(${mainHead.slice(0, 12)}…), nor content-equivalent to the tip commit there, `
        + `nor are the files it touched byte-identical at the tip, `
        + `nor is their content contained in ${mainRef}'s history — `
        + `its committed work is not in the trunk yet`,
    }
  }
  /**
   * ★★★ 安全那一半**在这里、且只在内容** ────────────────────────────────────────
   *
   *   `unique-work` 必须在**两种吸收形态之后**都仍然能把树按住：
   *   无论是"真的并进去了"还是"内容已按文件落盘"，只要有源码文件的内容
   *   **在整条历史里都不存在**，删掉它就会扔掉那份唯一的工作。
   *   ⇒ 它是**合取**里的一员，不是一个可以被 `contentAbsorbed` 绕过的旁路。
   */
  if (orphaned.length > 0) {
    return {
      status: 'keep',
      reason: 'unique-work',
      trunk,
      behind,
      orphaned,
      detail: `${orphaned.length} uncommitted source file(s) exist ONLY here — their content appears in no commit`
        + ` (${orphaned.slice(0, 3).join(', ')}${orphaned.length > 3 ? ', …' : ''}); deleting this worktree would lose them`,
    }
  }
  /**
   * ★ 三种形态**不是**同一件事，所以把"是哪一种"如实带出去 ——
   *   读的人要能分辨"它真的并进去了"、"它的改动被 cherry-pick 了"、
   *   与"它的文件被手工落盘了"（三者的**复核动作不同**）。
   *   ★ 顺序与上面 `absorbed` 的短路顺序**同一套**：先祖先、再 patch-id、最后逐文件。
   */
  /**
   * ★★ `how` 由 `absorbPlanOf` 一起给出 —— 那一段顺序（`'files'` 在 `'contained'`
   *   之前）本身就住在那份判据里，不在这里再抄一遍（两份顺序会分叉）。
   */
  const how = absorbedPlan.how ?? 'contained'
  return { status: 'reclaimable', reason: 'absorbed', trunk, how, behind }
}

/** 把那个判定说成一句人话。★ 三态各有各的措辞（不许同形）。 */
export function describeReclaimability(verdict: WorktreeReclaimability): string {
  if (verdict.status === 'reclaimable') {
    /**
     * ★ 三种吸收形态说成**三句不同的话**：它们的**依据**不同，
     *   而"依据"正是读的人要拿去复核的东西。
     *   ★★ 三句必须**互不同形** —— 否则"它真的并进去了"与"它的文件被手工落盘了"
     *     在读数上合流，而复核动作完全不同（查 merge / 逐文件比对）。
     */
    const how = verdict.how === 'ancestor'
      ? 'absorbed into the trunk'
      : verdict.how === 'content'
        /**
         * ★★ 措辞**必须同时**说清两件事（而这是既有臂 10b 钉住的）：
         *   ① 它**不是**祖先；② 它的**内容**已经在主干上。
         *   ★ MEASURED（t34）：我一度把它改成 "the same change landed there
         *     (cherry-picked)" —— 那句话**更准确**，却让臂 10b 的措辞断言变红。
         *     ★ 而那条断言是**对的**：读的人要能分辨"真的并进去了"与"内容已落盘"，
         *     所以"content already landed"这几个字是**承重的读数**，不是装饰。
         *   ⇒ 保留它，并把 cherry-pick 那层含义**补在后面**（而不是替换掉）。
         */
        ? 'its commit is not an ancestor of the trunk, but its content already landed there '
          + '(absorbed by file — the same patch-id is on the trunk, e.g. cherry-picked or equivalently reapplied)'
        : verdict.how === 'files'
          ? 'its commit is not an ancestor of the trunk and its patch-id is NOT on the trunk, '
            + 'but every file that commit touched is byte-identical at the trunk tip (landed by hand)'
          /**
           * ★★ 这一句必须与上一句**不同形**，且必须说清"主干此后可能又动过" ——
           *   否则读的人会以为主干**今天**就是这份内容（那是 `'files'` 那句话）。
           */
          : 'its commit is not an ancestor of the trunk and its patch-id is NOT on the trunk, '
            + 'but the content of every file that commit touched is contained in the trunk history '
            + '(its work was merged in — the trunk tip may have moved on since)'
    return `${how}${verdict.behind === undefined ? '' : ` (${verdict.behind} commit(s) behind)`} — safe to reclaim`
  }
  if (verdict.status === 'keep') {
    /**
     * ★★★ W1：`keep` 那一句**必须**带上"拿谁比的"────────────────────────────────
     *
     *   本缺陷的原始形态里，一个**比错了引用**的 keep 与一个"产物真的没被吸收"的
     *   keep **完全同形** —— 两者都说 "HELD: not absorbed"，而前者该修、后者该留。
     *   ⇒ 把 `trunk` 念出来：读的人据此能去 `git merge-base --is-ancestor <head> <trunk.commit>`
     *     复核，而不是相信一句无法证伪的话。
     *   ★ 而它**不改判**：措辞里多一个可复核的坐标，裁决仍然是那一个。
     */
    const compared = `[compared against ${verdict.trunk.ref} @ ${verdict.trunk.commit.slice(0, 12)}`
      + ` (${verdict.trunk.source === 'explicit' ? 'given explicitly' : 'the main worktree\'s checked-out branch'})]`
    return `${verdict.reason === 'unique-work' ? 'HELD: unique work' : 'HELD: not absorbed'} — ${verdict.detail} ${compared}`
  }
  return `whether this worktree can be reclaimed could NOT be determined (${verdict.why}) — that is "not measured", not "safe to delete"`
}

/** 读一个文件是否是 worktree 指针（诊断用；不判断存在性）。 */
export function isWorktreePointer(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').startsWith('gitdir:')
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 「哪些产物还没进主干」—— 交付那一刻要的那一格（2026-10-20）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 它补的是哪一格 ────────────────────────────────────────────────────────
 *
 * `deliverableCommit` **不是"零读者"**（`docs/WORKTREE-BASE-DEFECT.md` 那句已过期）：
 *   · `scheduler.ts` 的 `collectUpstreamBaselines` 把它交给下游当基线
 *   · `worktree.ts` 的 `resolveWorktreeBaseline` 把短 id 解析成完整对象名
 * ⇒ 缺的是**另一个问句**：**这个队的产物，有多少已经进了主干？**
 *
 * MEASURED（2026-10-20，本仓 78 个 `deliverableCommit`，可复跑）：
 * ```
 *   merge-base --is-ancestor <commit> HEAD          ⇒   4 个（5%）
 *   而按 absorbPlanOf 的四态口径                     ⇒  46 个（59%）
 *     其中：ancestor 4 · contained 42
 *   部分吸收 23 个 · 无源码改动 9 个
 * ```
 * ⇒ ★★ **只问"是不是祖先"会把 42 份早已落盘的工作报成"没合流"** —— 那不是保守，
 *   那是一句**关于没有发生过的事情的主张**，而读的人会去"重新合并"已经合进去的东西。
 *   ★ 这正是本仓记账最久的形态：**一次读数说「没合流」，而东西早就在了。**
 *
 * ── 为什么不能只靠 `pnpm reclaim:worktrees` 回答 ──────────────────────────────
 *
 * `judgeWorktreeReclaimable` 要**那棵树还在盘上**（它读 worktree 的 HEAD 与
 * `git status`）。而 74 个非祖先产物里，**绝大多数所属的树早已被回收** ——
 * 那个命令对它们的回答是"没有这棵树"，不是"这份产物在哪"。
 * ⇒ 交付那一刻要问的东西，**必须在树没了之后仍然答得出**。
 *    ★ 这就是 {@link absorbPlanOf} 被从 `judgeWorktreeReclaimable` 里抽出来的理由：
 *      **同一份判据**，而不是第二份。
 */
export type DeliverableLandingStatus = 'landed' | 'not-landed' | 'unreadable'

/** 一条产物（一个 `deliverableCommit`）的合流读数。 */
export interface DeliverableLanding {
  readonly taskId: string
  /** 任务记录里那个**短** id（原样交出：读的人要能拿去 `git show <id>`）。 */
  readonly commit: string
  readonly status: DeliverableLandingStatus
  /**
   * ★ `landed` 时：它是**怎么**被判为落盘的 —— 四种依据的复核动作不同
   *   （查 merge / 查 cherry-pick / 逐文件比对 / 查历史可达性），所以不许合流。
   */
  readonly how?: 'ancestor' | 'content' | 'files' | 'contained'
  /** `unreadable` / `not-landed` 时的成因（人话）。 */
  readonly why?: string
  /** 这次提交碰过的**源码**文件数（构建产物已排除）。 */
  readonly sourceFiles?: number
}

/** 一个队的产物合流读数（交付那一刻要的那一格）。 */
export interface DeliverableLandingReadout {
  /**
   * ★ 三态：
   *   `measured`   —— 读了（哪怕 `total: 0` 也是一个**结论**："这个队没有可交付的产物"）
   *   `unmeasured` —— 主干读不到 / 仓库读不到 ⇒ **整份判不了**（与"零条未合流"不同形）
   */
  readonly status: 'measured' | 'unmeasured'
  readonly total: number
  readonly landed: number
  readonly notLanded: number
  readonly unreadable: number
  /** 每一条的逐条读数（读的人要能复核，而不是只读三个数）。 */
  readonly entries: readonly DeliverableLanding[]
  /** `unmeasured` 时的成因。 */
  readonly why?: string
}

/**
 * 把逐条读数折成一份队的读数。
 *
 * ★ 纯函数：`entries` 由调用方算（与 `shapeExecutionOf` / `summariseDeliveries`
 *   同一条分工 —— I/O 在调用方，折数在这里）。
 *
 * ★★ 两个"零"**不同形**：
 *   · 主干读不到 ⇒ `unmeasured`（整份判不了）
 *   · 这个队**没有产物** ⇒ `measured` + `total: 0`（一个结论，不是一次失败）
 */
export function summariseDeliverableLanding(
  entries: readonly DeliverableLanding[],
  options: { readonly trunkUnreadable?: string } = {},
): DeliverableLandingReadout {
  if (options.trunkUnreadable !== undefined) {
    return {
      status: 'unmeasured',
      total: entries.length,
      landed: 0,
      notLanded: 0,
      unreadable: 0,
      entries: [...entries],
      why: options.trunkUnreadable,
    }
  }
  const landed = entries.filter((entry) => entry.status === 'landed').length
  const unreadable = entries.filter((entry) => entry.status === 'unreadable').length
  return {
    status: 'measured',
    total: entries.length,
    landed,
    notLanded: entries.length - landed - unreadable,
    unreadable,
    entries: [...entries],
  }
}

/**
 * 读一个队的**产物合流读数**（I/O 那一半）。
 *
 * ★ 逐条用 {@link absorbPlanOf}（**与回收判据同一份**），而不是另写一套。
 *
 * ★★ `unreadable` 与 `not-landed` **不同形**：
 *   · commit 解析不出（树被回收成不可达对象、gc 过）⇒ `unreadable`
 *   · 解析得出、读得到改动，而主干没有这份工作 ⇒ `not-landed`
 *   两者的补救动作相反：前者去查"这个 commit 怎么没了"，后者去合流。
 */
export function deliverableLandingFor(options: {
  readonly repo: string
  readonly tasks: readonly TeamTask[]
}): DeliverableLandingReadout {
  const { repo } = options
  const trunkResolution = resolveTrunkRef(repo)
  if (trunkResolution.status === 'unresolved') {
    return summariseDeliverableLanding([], { trunkUnreadable: trunkResolution.why })
  }
  const trunk = trunkResolution.commit
  const entries: DeliverableLanding[] = []
  for (const task of options.tasks) {
    const raw = task.deliverableCommit
    if (raw === undefined || raw.trim() === '') continue
    const commit = raw.trim()
    const resolved = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])
    if (resolved.ok === false) {
      entries.push({
        taskId: task.id,
        commit,
        status: 'unreadable',
        why: `the deliverable commit "${commit}" does not resolve in ${repo} (${resolved.message})`,
      })
      continue
    }
    const full = resolved.value.trim()
    const sourceFiles = sourceFilesTouchedBy(repo, full)
    if (sourceFiles === undefined) {
      entries.push({
        taskId: task.id,
        commit,
        status: 'unreadable',
        why: `the changed-file list of "${commit}" could not be read (its parent may be unreachable)`,
      })
      continue
    }
    /**
     * ★ 改动里**一个源码文件都没有**（只动构建产物 / 空提交）⇒ **不是 `landed`**，
     *   也不是 `unreadable` —— 它是一条**可判定的结论**：这次提交没有交付源码工作。
     *   ★ 与 `containedAbsorbed` 里"空不是证据"同一条精神：它落 `not-landed`，
     *     并把 `sourceFiles: 0` 交出去（读的人据此知道**为什么**没算落盘）。
     */
    const plan = absorbPlanOf({ repo, commit: full, trunk })
    entries.push({
      taskId: task.id,
      commit,
      status: plan.absorbed ? 'landed' : 'not-landed',
      ...plan.absorbed && plan.how !== undefined ? { how: plan.how } : {},
      sourceFiles,
      ...plan.absorbed
        ? {}
        : {
          why: sourceFiles === 0
            ? 'this commit touched no source file (only build products, or it is empty), so there is no delivered work to look for in the trunk'
            : 'its committed work is not in the trunk under any of the four absorption forms (ancestor / content / files / contained)',
        },
    })
  }
  return summariseDeliverableLanding(entries)
}

/**
 * 一次提交碰过的**源码**文件数（构建产物已排除）。
 *
 * ★ 与 `containedAbsorbed` / `filesAbsorbed` **同一套口径**：`lib/` 与
 *   `git-artifact-stamp.json` 是构建产物（内嵌路径、每次 build 重生成）
 *   ⇒ 要求它们"内容在主干里存在"是**恒不成立**的条件。
 * ★ 读不到父提交 ⇒ `undefined`（调用方据此落 `unreadable`，而不是当成"零个文件"）。
 */
function sourceFilesTouchedBy(repo: string, commit: string): number | undefined {
  const out = tryGit(repo, ['diff', '--name-only', `${commit}^`, commit])
  if (out.ok === false) return undefined
  return out.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((path) => !path.startsWith('lib/') && !path.endsWith('git-artifact-stamp.json'))
    .length
}

/**
 * ── ★★★ 回收一棵隔离树（2026-10-21，裁决 ①）─────────────────────────────────────
 *
 * ── 它补的是什么（MEASURED：5.0G / 6 棵，而 5 棵已无用）─────────────────────────
 *
 * `ls .agent-teams/worktrees/ | wc -l` ⇒ **6** · `du -sh` ⇒ **5.0G**
 * 而其中 **5 棵是干净的**（产物已交付或从未产生）。
 *
 * ★ 隔离的价值**已被一次真实事故证明**（`docs/WORKTREE-BASE-DEFECT.md` 记的 t39：
 *   靠它找回了 12 个文件未提交的改动）⇒ **不该去掉它**。
 *   而它的代价（磁盘）是**可控的** —— 只要"用完了就收"。
 *
 * ── ★★ 安全边界：**判据先说话，删除后执行** ──────────────────────────────────
 *
 * 本函数**自己不做判断** —— 它接受一个已经裁过的 `reclaimable`：
 *   · `judgeWorktreeReclaimable` 说 `reclaimable` ⇒ 才允许删
 *   · 说 `keep` / `undecidable` ⇒ **本函数直接返回 `skipped`**，一个字节都不动
 *
 * ★ 为什么把判断留在外面：那是**同一个判据**（`judgeWorktreeReclaimable`）
 *   `pnpm reclaim:worktrees` 也在用 —— 两份会分叉，而分叉之后
 *   "回收时算已吸收、终态时说没合流"会成为一个新的、更难查的不一致。
 *
 * ★★ 三态，且 `skipped` 与 `removed` **不同形**：
 *   `removed`  —— 真的删了
 *   `skipped`  —— 判据说不能删（`reason` 说清是 `keep` 还是 `undecidable`）
 *   `failed`   —— git 命令失败（**不是**"删了"）
 */
export type WorktreeReclaimOutcome =
  | { readonly status: 'removed' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string }

/**
 * 删掉一棵**已经被判为可回收**的隔离树。
 *
 * ★ `git worktree remove --force` 而不是 `rm -rf`：
 *   前者会让 git 的元数据（`.git/worktrees/<name>`）一起清掉；
 *   后者只删目录，留下一条**指向不存在的树的记录** —— 而 `git worktree list`
 *   会继续把它列出来（本仓记账过的那种"读数指向一个不存在的东西"）。
 */
export function removeReclaimableWorktree(options: {
  readonly repo: string
  readonly worktree: string
}): WorktreeReclaimOutcome {
  const removed = spawnSync('git', ['worktree', 'remove', '--force', options.worktree], {
    cwd: options.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (removed.status === 0) return { status: 'removed' }
  /**
   * ★ 失败**不抛** —— 它是收尾，不是裁决（与 `reclaim:worktrees` 的
   *   "清理失败不改结论"同一条纪律）。而它**必须如实报** `failed` + 成因。
   */
  const message = (removed.stderr ?? '').trim() || `git worktree remove exited ${String(removed.status)}`
  return { status: 'failed', reason: message }
}

/**
 * 一条任务落到终态之后，**试一次**回收它自己的树。
 *
 * ★★ 它**只在判据说 `reclaimable` 时**才删（见 `removeReclaimableWorktree` 的边界）。
 *
 * ★ 为什么挂在**终态那一跳**、而不是靠人跑 `pnpm reclaim:worktrees`：
 *   后者需要有人记得 —— 而本仓记账过"靠人记得的规则会被证伪"。
 *   ⇒ 挂在终态上是**结构性的**：每一条任务收口时就顺手清掉自己的树。
 *
 * ★★ 而它**不影响**那条任务的结果：任何失败都只是 `failed` 读数，
 *   不许让"清不掉临时目录"去改写"这条任务做成了没有"。
 */
export function reclaimTaskWorktreeAfterTerminal(options: {
  readonly repo: string
  readonly teamId: string
  readonly taskId: string
  readonly root?: string
  /** ★ 显式的主干引用（不给 ⇒ `resolveTrunkRef` 的声明式来源）。 */
  readonly mainRef?: string
}): WorktreeReclaimOutcome {
  const path = join(options.root ?? join(options.repo, '.agent-teams', 'worktrees'), worktreeDirName(options.teamId, options.taskId))
  /**
   * ★ 树不在 ⇒ 没有可回收的东西。
   *   ★★ 但**不是** `removed` —— "它本来就没有树"与"我把它删了"不同形。
   */
  if (!existsSync(path)) return { status: 'skipped', reason: 'this task has no worktree on disk' }
  const verdict = judgeWorktreeReclaimable({ repo: options.repo, worktree: path, ...options.mainRef === undefined ? {} : { mainRef: options.mainRef } })
  if (verdict.status !== 'reclaimable') {
    return {
      status: 'skipped',
      reason: verdict.status === 'keep'
        ? `the reclaim judge says keep (${verdict.reason}): ${verdict.detail}`
        : `the reclaim judge could not decide: ${verdict.why}`,
    }
  }
  return removeReclaimableWorktree({ repo: options.repo, worktree: path })
}
