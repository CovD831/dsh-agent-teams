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
export interface WorktreeResult {
    ok: true;
    /** Absolute path of the isolated working directory. */
    path: string;
    /** Branch/commit the worktree is parked at (detached). */
    base: string;
    /**
     * ★ gitignore'd top-level entries that exist in the repo but NOT in the
     * worktree (typically `node_modules`). Reported so the caller can tell the
     * member, instead of letting it discover a broken `pnpm test` by surprise.
     */
    missingIgnored: string[];
}
export interface WorktreeRefusal {
    ok: false;
    /** ★ Must say "could not isolate" — never "isolation was unnecessary". */
    reason: string;
}
/**
 * 能不能在这个仓库里做隔离。**只读检查**，不建任何东西。
 *
 * ★ 返回拒绝时带 reason —— 调用方要能区分"这个仓库不支持"与"我们没试"。
 */
export declare function detectWorktreeSupport(repo: string): {
    ok: true;
    base: string;
} | WorktreeRefusal;
export interface CreateWorktreeOptions {
    /** The repository (captain workspace) the worktree is cut from. */
    repo: string;
    /** Task id — used to name the directory so parallel members never collide. */
    taskId: string;
    /** Where worktrees live; defaults to `<repo>/.agent-teams/worktrees`. */
    root?: string;
}
/**
 * 给一个任务建一个 detached worktree。
 *
 * ★ 为什么 `--detach`：实测边界① —— 同一个分支不能检出到两个 worktree，
 *   而并行成员必然都在同一分支上。detach 之后每个任务各有一个独立的 HEAD，
 *   互不冲突；R5 需要的父/修复版本切换在 detach 状态下照样能做。
 */
export declare function createTaskWorktree(options: CreateWorktreeOptions): WorktreeResult | WorktreeRefusal;
/**
 * ★ 派发提示里告诉成员"在哪干活"的那一行。
 *
 * 这是隔离能否真正生效的关键：cwd 改不了（§5②），所以**只能靠提示告诉成员**。
 * 不给出路径时返回空串 —— **绝不产出一个伪造的指令**。
 */
export declare function worktreePromptLine(path: string | undefined): string;
/** 一个便于诊断的单行描述。 */
export declare function describeWorktree(result: WorktreeResult): string;
/** 读一个文件是否是 worktree 指针（诊断用；不判断存在性）。 */
export declare function isWorktreePointer(file: string): boolean;
