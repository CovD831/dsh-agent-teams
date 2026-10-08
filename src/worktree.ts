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

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
  /** Where worktrees live; defaults to `<repo>/.agent-teams/worktrees`. */
  root?: string
}

/**
 * 给一个任务建一个 detached worktree。
 *
 * ★ 为什么 `--detach`：实测边界① —— 同一个分支不能检出到两个 worktree，
 *   而并行成员必然都在同一分支上。detach 之后每个任务各有一个独立的 HEAD，
 *   互不冲突；R5 需要的父/修复版本切换在 detach 状态下照样能做。
 */
export function createTaskWorktree(options: CreateWorktreeOptions): WorktreeResult | WorktreeRefusal {
  const { repo, taskId } = options
  const support = detectWorktreeSupport(repo)
  if (support.ok === false) return support

  const root = options.root ?? join(repo, '.agent-teams', 'worktrees')
  const safeId = taskId.replace(/[^A-Za-z0-9._-]/g, '-')
  const path = join(root, `task-${safeId}`)

  if (!existsSync(root)) mkdirSync(root, { recursive: true })

  // 已经建过 ⇒ 复用（重试一个任务的同一个 attempt 不该炸）
  if (existsSync(join(path, '.git'))) {
    const base = tryGit(path, ['rev-parse', 'HEAD'])
    return {
      ok: true,
      path,
      base: base.ok ? base.value.trim() : support.base,
      missingIgnored: missingIgnored(repo, path),
    }
  }

  const added = tryGit(repo, ['worktree', 'add', '--detach', path, support.base])
  if (!added.ok) {
    return { ok: false, reason: `could not create an isolated worktree: ${added.message}` }
  }
  return { ok: true, path, base: support.base, missingIgnored: missingIgnored(repo, path) }
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
}

export interface ProvisionResult {
  /** Entries that are now present in the worktree. */
  copied: string[]
  /**
   * ★ 没能准备的那一件 + 原因。**必须报出来**：一件"没准备好"如果静默通过，
   *   成员会在里面跑命令、因缺依赖失败，然后把一次"环境没准备好"误报成
   *   "工作没做出来"（两者不同形）。
   */
  failed: Array<{ entry: string; reason: string }>
}

/**
 * ── 依赖按需注入：把测试需要的包【复制】进 worktree ────────────────────────────
 *
 * worktree 是干净的检出，gitignore 的 `node_modules` 不在里面（实测边界③）。
 * 成员要在隔离目录里跑验证命令，就必须有依赖。三条路的实测结论：
 *
 *   · 软链（symlink）⇒ ★ **会被写穿**：worktree 里的写入顺着链改到主检出的
 *     依赖树。一条被共享、可被任意改写的依赖树，会让"两个成员各自验证"
 *     在日志里同形，而出问题时无从归因。
 *   · 只读锁（chmod / lockfile）⇒ 不阻止写穿，只把成员换成另一种失败方式。
 *   · 复制品（copy）  ⇒ 代价是磁盘，换来的是【两个检出真的互不影响】。
 *
 * ★ 为什么是选项而【不是】自动执行：复制一棵 node_modules 很贵，静默地做会把
 *   "派发很快"变成"派发很慢"。调用方（调度器）显式要求才做，本函数不猜。
 *
 * ★ 为什么 entries 必须显式给出：我们不读 `.gitignore` 的语义（那是 git 的事），
 *   调用方拿 `missingIgnored` 的结论来喂它 —— 于是"要复制什么"有唯一来源。
 */
export function provisionWorktreeDependencies(options: ProvisionOptions): ProvisionResult {
  const { repo, worktree } = options
  const copied: string[] = []
  const failed: Array<{ entry: string; reason: string }> = []

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
      // 已经在了 ⇒ 不重复复制（重试一个 attempt 不该把依赖树再搬一遍）。
      copied.push(safe)
      continue
    }
    try {
      mkdirSync(dirname(target), { recursive: true })
      /**
       * ★ 普通复制，不是软链、不是 reflink —— 实测：软链会被写穿。
       *   `dereference: false` 保留包内部自带的相对软链（pnpm 大量使用它们），
       *   把它们变成真实拷贝会让 .pnpm 的相对结构失真。
       */
      cpSync(source, target, { recursive: true, dereference: false, force: false, errorOnExist: false })
    } catch (error) {
      failed.push({ entry: safe, reason: String((error as Error | undefined)?.message ?? error) })
      continue
    }
    copied.push(safe)
  }

  return { copied, failed }
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
 */
export type WorktreeReclaimability =
  | { status: 'reclaimable'; reason: 'absorbed'; behind: number | undefined }
  | { status: 'keep'; reason: 'not-absorbed' | 'unique-work'; behind: number | undefined; detail: string; orphaned?: string[] }
  | { status: 'undecidable'; why: string }

/**
 * 判一个 worktree 能不能回收。
 *
 * @param repo - 主仓库根。
 * @param worktree - 那个检出目录。
 * @param mainRef - 主干引用（默认 `main`）。
 * @returns 三态。★ 三者**不同形**：可清的带 `reason: 'absorbed'`；
 *   不可清的带 `reason` 与 `detail`（以及可能的 `orphaned`）；
 *   判不了的带 `why`。没有任何两个共用同一组字段。
 */
export function judgeWorktreeReclaimable(options: {
  repo: string
  worktree: string
  mainRef?: string
}): WorktreeReclaimability {
  const { repo, worktree, mainRef = 'main' } = options
  const headResult = tryGit(worktree, ['rev-parse', 'HEAD'])
  if (headResult.ok === false) {
    return { status: 'undecidable', why: 'HEAD could not be read (not a git checkout, or no commit yet)' }
  }
  const head = headResult.value.trim()
  const mainResult = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`])
  if (mainResult.ok === false) {
    return { status: 'undecidable', why: `the trunk ref "${mainRef}" could not be resolved in ${repo}` }
  }
  const mainHead = mainResult.value.trim()

  /**
   * ★ (a) 已提交的部分是否被吸收。
   *   ★ 用退出码判，**不用输出** —— `--is-ancestor` 成功时**没有输出**
   *     （空串），而 `tryGit` 对"退出 0、无输出"与"退出非 0"的区分
   *     只能靠抛不抛错 ⇒ 所以要 `try/catch` 而不是比字符串。
   *     ★ 若按输出判，`absorbed` 会恒为 **false** ⇒ 判据退化成**恒不删**
   *       （而那正是反向半边禁止的）。
   */
  const absorbed = (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', head, mainHead], {
        cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
      })
      return true
    } catch {
      return false
    }
  })()

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
      behind,
      detail: `its HEAD (${head.slice(0, 12)}…) is not an ancestor of ${mainRef} `
        + `(${mainHead.slice(0, 12)}…) — its committed work is not in the trunk yet`,
    }
  }
  if (orphaned.length > 0) {
    return {
      status: 'keep',
      reason: 'unique-work',
      behind,
      orphaned,
      detail: `${orphaned.length} uncommitted source file(s) exist ONLY here — their content appears in no commit`
        + ` (${orphaned.slice(0, 3).join(', ')}${orphaned.length > 3 ? ', …' : ''}); deleting this worktree would lose them`,
    }
  }
  return { status: 'reclaimable', reason: 'absorbed', behind }
}

/** 把那个判定说成一句人话。★ 三态各有各的措辞（不许同形）。 */
export function describeReclaimability(verdict: WorktreeReclaimability): string {
  if (verdict.status === 'reclaimable') {
    return `absorbed into the trunk${verdict.behind === undefined ? '' : ` (${verdict.behind} commit(s) behind)`} — safe to reclaim`
  }
  if (verdict.status === 'keep') {
    return `${verdict.reason === 'unique-work' ? 'HELD: unique work' : 'HELD: not absorbed'} — ${verdict.detail}`
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
