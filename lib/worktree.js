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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function git(cwd, args) {
    return execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
function tryGit(cwd, args) {
    try {
        return { ok: true, value: git(cwd, args) };
    }
    catch (error) {
        const stderr = error.stderr;
        const message = typeof stderr === 'string' && stderr.trim() !== ''
            ? stderr.trim()
            : String(error?.message ?? error);
        return { ok: false, message };
    }
}
/**
 * 能不能在这个仓库里做隔离。**只读检查**，不建任何东西。
 *
 * ★ 返回拒绝时带 reason —— 调用方要能区分"这个仓库不支持"与"我们没试"。
 */
export function detectWorktreeSupport(repo) {
    const top = tryGit(repo, ['rev-parse', '--is-inside-work-tree']);
    if (!top.ok || top.value.trim() !== 'true') {
        return { ok: false, reason: `not a git repository (${top.ok ? 'unexpected rev-parse output' : top.message})` };
    }
    const head = tryGit(repo, ['rev-parse', '--verify', 'HEAD']);
    if (!head.ok) {
        return { ok: false, reason: `the repository has no commit to use as a parent revision (${head.message})` };
    }
    return { ok: true, base: head.value.trim() };
}
/** gitignore 的顶层条目（只取顶层名字，够用来提示 node_modules 这类）。 */
function ignoredTopLevel(repo) {
    const listed = tryGit(repo, ['status', '--ignored', '--porcelain']);
    if (!listed.ok)
        return [];
    const names = new Set();
    for (const line of listed.value.split('\n')) {
        if (!line.startsWith('!! '))
            continue;
        const path = line.slice(3).trim().replace(/\/$/, '');
        if (path === '')
            continue;
        const top = path.split('/')[0];
        if (top !== undefined && top !== '')
            names.add(top);
    }
    return [...names].sort();
}
/**
 * 给一个任务建一个 detached worktree。
 *
 * ★ 为什么 `--detach`：实测边界① —— 同一个分支不能检出到两个 worktree，
 *   而并行成员必然都在同一分支上。detach 之后每个任务各有一个独立的 HEAD，
 *   互不冲突；R5 需要的父/修复版本切换在 detach 状态下照样能做。
 */
export function createTaskWorktree(options) {
    const { repo, taskId } = options;
    const support = detectWorktreeSupport(repo);
    if (support.ok === false)
        return support;
    const root = options.root ?? join(repo, '.agent-teams', 'worktrees');
    const safeId = taskId.replace(/[^A-Za-z0-9._-]/g, '-');
    const path = join(root, `task-${safeId}`);
    if (!existsSync(root))
        mkdirSync(root, { recursive: true });
    // 已经建过 ⇒ 复用（重试一个任务的同一个 attempt 不该炸）
    if (existsSync(join(path, '.git'))) {
        const base = tryGit(path, ['rev-parse', 'HEAD']);
        return {
            ok: true,
            path,
            base: base.ok ? base.value.trim() : support.base,
            missingIgnored: missingIgnored(repo, path),
        };
    }
    const added = tryGit(repo, ['worktree', 'add', '--detach', path, support.base]);
    if (!added.ok) {
        return { ok: false, reason: `could not create an isolated worktree: ${added.message}` };
    }
    return { ok: true, path, base: support.base, missingIgnored: missingIgnored(repo, path) };
}
/**
 * 仓库里被 gitignore、但 worktree 里缺失的顶层条目。
 *
 * ★ 这是实测边界③的落点：worktree 是干净的检出，`node_modules` 这类
 *   不存在。**必须报出来**，否则成员会在里面跑命令、因缺依赖而失败，
 *   然后把一次"环境没准备好"误报成"工作没做出来"（两者不同形）。
 */
function missingIgnored(repo, worktreePath) {
    return ignoredTopLevel(repo).filter((name) => existsSync(join(repo, name)) && !existsSync(join(worktreePath, name)));
}
/**
 * ★ 派发提示里告诉成员"在哪干活"的那一行。
 *
 * 这是隔离能否真正生效的关键：cwd 改不了（§5②），所以**只能靠提示告诉成员**。
 * 不给出路径时返回空串 —— **绝不产出一个伪造的指令**。
 */
export function worktreePromptLine(path) {
    if (typeof path !== 'string' || path.trim() === '')
        return '';
    return `Working directory: ${path.trim()}\nWork only inside this directory: it is your isolated worktree (a clean checkout of the parent revision). Do not edit files in the captain's workspace.`;
}
/** 一个便于诊断的单行描述。 */
export function describeWorktree(result) {
    const ignored = result.missingIgnored.length === 0
        ? ''
        : ` (missing gitignored entries: ${result.missingIgnored.join(', ')} — install dependencies inside the worktree before running tests)`;
    return `${result.path} @ ${result.base.slice(0, 12)}${ignored}`;
}
/** 读一个文件是否是 worktree 指针（诊断用；不判断存在性）。 */
export function isWorktreePointer(file) {
    try {
        return readFileSync(file, 'utf8').startsWith('gitdir:');
    }
    catch {
        return false;
    }
}
