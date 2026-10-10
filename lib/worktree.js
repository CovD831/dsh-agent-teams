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
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * ★ 并且带 `unsupported` —— 调用方还要能区分"这个仓库不支持"（⇒ 降级）
 *   与"本该能、这次没成"（⇒ 拒绝派发）。见 `WorktreeRefusal.unsupported`。
 */
export function detectWorktreeSupport(repo) {
    const top = tryGit(repo, ['rev-parse', '--is-inside-work-tree']);
    if (!top.ok || top.value.trim() !== 'true') {
        return {
            ok: false,
            unsupported: true,
            reason: `not a git repository (${top.ok ? 'unexpected rev-parse output' : top.message})`,
        };
    }
    const head = tryGit(repo, ['rev-parse', '--verify', 'HEAD']);
    if (!head.ok) {
        // ★ 是 git 仓库、但没有提交 ⇒ 这是"本该能隔离却建不出来"，不是环境不支持。
        return {
            ok: false,
            unsupported: false,
            reason: `the repository has no commit to use as a parent revision (${head.message})`,
        };
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
export function worktreeDirName(teamId, taskId) {
    const safe = (value) => value.replace(/[^A-Za-z0-9._-]/g, '-');
    const safeTask = safe(taskId);
    /**
     * ★ 不给 teamId 时**保持旧形状** —— 而不是编一个假前缀。
     *   夹具与老调用方依赖 `task-<id>`；而生产调用方（scheduler / update_task）
     *   都给 teamId ⇒ 真正的运行路径一律带前缀。
     */
    return teamId === undefined || teamId === ''
        ? `task-${safeTask}`
        : `task-${safe(teamId)}-${safeTask}`;
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
    const path = join(root, worktreeDirName(options.teamId, taskId));
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
export const defaultHardLinkTree = (source, target) => {
    const result = spawnSync('cp', ['-al', source, target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error !== undefined && result.error !== null) {
        return { ok: false, reason: `cp -al could not be started: ${String(result.error.message ?? result.error)}` };
    }
    if (result.status === 0)
        return { ok: true };
    const stderr = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    return {
        ok: false,
        reason: `cp -al could not hard-link this entry (exit ${String(result.status)}): ${stderr === '' ? 'no output' : stderr}`,
    };
};
/** 注入之后必须被读到的那条边界（见 {@link ProvisionResult.hardLinkCaveat}）。 */
const HARD_LINK_CAVEAT = 'entries are HARD LINKS to the shared source: replacing a file (new file + rename, what pnpm install does) '
    + 'stays local to the tree that replaced it, but an IN-PLACE rewrite of a file is visible in every tree that '
    + 'shares that inode — hard links remove the symlink\'s write-through *path*, not the shared inode itself';
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
export function provisionWorktreeDependencies(options) {
    const { repo, worktree } = options;
    const copied = [];
    const failed = [];
    const readings = [];
    const linkFallbacks = [];
    const link = options.link ?? defaultHardLinkTree;
    for (const entry of options.entries) {
        const safe = safeRelativeEntry(entry);
        if (safe === undefined) {
            failed.push({ entry, reason: 'refused: only plain relative entries directly inside the repo may be provisioned' });
            continue;
        }
        const source = join(repo, safe);
        const target = join(worktree, safe);
        if (!existsSync(source)) {
            failed.push({ entry: safe, reason: `not present in ${repo}` });
            continue;
        }
        if (existsSync(target)) {
            // 已经在了 ⇒ 不重复注入（重试一个 attempt 不该把依赖树再搬一遍）。
            copied.push(safe);
            readings.push({ entry: safe, mode: 'existed', reason: 'the target already existed — nothing was injected again' });
            continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        /**
         * ★★★ 先试硬链接（`cp -al`）—— 与 `cpSync(..., {dereference:false})` 的
         *   语义逐条对齐：普通文件**硬链接**，软链**重建为软链**（包内部那些
         *   pnpm 的相对软链必须原样保留，dereference 会把 .pnpm 的相对结构弄失真）。
         *
         * ★ 失败路径：`cpSync` 自己就是它自己的**兜底**（`-n` 不覆盖已存在的 ⇒
         *   `force:false`；`errorOnExist:false`）。所以半个目标不会把重试彻底卡死。
         */
        try {
            const linkedTree = link(source, target);
            if (linkedTree.ok) {
                copied.push(safe);
                readings.push({ entry: safe, mode: 'linked' });
                continue;
            }
            /**
             * 硬链接不成 ⇒ 退回真拷贝，并**留下理由**。★ 触发它的**不**只有跨设备：
             * 本原语只看 `cp -al` 的 exit status（路径写错、权限不足都会落到这里，
             * 且理由里报的就是它们自己）——「跨设备」只是最常见的那一种，不是判据。
             */
            cpSync(source, target, { recursive: true, dereference: false, force: false, errorOnExist: false });
            const reason = linkedTree.reason;
            copied.push(safe);
            linkFallbacks.push({ entry: safe, reason });
            readings.push({ entry: safe, mode: 'copied', reason });
        }
        catch (error) {
            failed.push({ entry: safe, reason: String(error?.message ?? error) });
            continue;
        }
    }
    return { copied, failed, entries: readings, linkFallbacks, hardLinkCaveat: HARD_LINK_CAVEAT };
}
/** 只接受"直接位于根下的普通相对条目"——注入路径不能穿到根外。 */
function safeRelativeEntry(entry) {
    const trimmed = entry.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (trimmed === '' || trimmed.startsWith('/') || trimmed.includes('/') || trimmed === '.' || trimmed.includes('..'))
        return undefined;
    return trimmed;
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
/**
 * 提交一棵 worktree 上的全部改动。
 *
 * ★ 用 `git add -A`（含新增与删除）。**不**只加 tracked 文件 ——
 *   实测过的形态：新建文件是任务产物里最常见的一类，而 `git add -u`
 *   会静默漏掉它们，于是"提交成功"与"提交了个空"同形。
 */
export function commitWorktree(options) {
    const { worktree, taskId } = options;
    if (!existsSync(join(worktree, '.git'))) {
        return { ok: false, reason: `not a worktree (no .git): ${worktree}` };
    }
    /** ① 先问"有没有改动" —— 没有就**不产出空 commit**（约束 ②）。 */
    const status = tryGit(worktree, ['status', '--porcelain']);
    if (!status.ok)
        return { ok: false, reason: `could not read the worktree status: ${status.message}` };
    const lines = status.value.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) {
        return { ok: true, commit: undefined, filesChanged: 0, reason: 'no changes to commit' };
    }
    const added = tryGit(worktree, ['add', '-A']);
    if (!added.ok)
        return { ok: false, reason: `git add -A failed: ${added.message}` };
    /**
     * ★ 归属行：**有才写，没有就不写**。编一个 `attempt=unknown` 会让
     *   "我不知道归属"与"归属就是 unknown"同形。
     */
    const trailer = [
        options.attemptId === undefined || options.attemptId === '' ? undefined : `Attempt: ${options.attemptId}`,
        options.author === undefined || options.author === '' ? undefined : `Author: ${options.author}`,
    ].filter((line) => line !== undefined);
    const message = [
        `task(${taskId}): worktree deliverable`,
        '',
        'Committed by agent-teams when the task reached a terminal state.',
        '★ 这条 commit 是【那棵 worktree 上的原始产物】—— 合流由 integrator 负责，',
        '  它要看到多棵树才能发现"各自自洽、合起来冲突"的那一类问题。',
        ...trailer.length === 0 ? [] : ['', ...trailer],
    ].join('\n');
    const committed = tryGit(worktree, [
        '-c', 'user.name=agent-teams',
        '-c', 'user.email=agent-teams@localhost',
        'commit', '--no-verify', '-m', message,
    ]);
    if (!committed.ok)
        return { ok: false, reason: `git commit failed: ${committed.message}` };
    const head = tryGit(worktree, ['rev-parse', '--short', 'HEAD']);
    if (!head.ok) {
        /**
         * ★ 提交**成功了**而读不到 id —— 这两件事必须分开。
         *   报 `ok:false` 会让调用方以为没提交，于是可能重复提交。
         */
        return { ok: false, reason: `the commit succeeded but its id could not be read: ${head.message}` };
    }
    return { ok: true, commit: head.value.trim(), filesChanged: lines.length };
}
/** 一个便于诊断的单行描述。 */
export function describeWorktree(result) {
    const ignored = result.missingIgnored.length === 0
        ? ''
        : ` (missing gitignored entries: ${result.missingIgnored.join(', ')} — install dependencies inside the worktree before running tests)`;
    return `${result.path} @ ${result.base.slice(0, 12)}${ignored}`;
}
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
export function judgeWorktreeReclaimable(options) {
    const { repo, worktree, mainRef = 'main' } = options;
    const headResult = tryGit(worktree, ['rev-parse', 'HEAD']);
    if (headResult.ok === false) {
        return { status: 'undecidable', why: 'HEAD could not be read (not a git checkout, or no commit yet)' };
    }
    const head = headResult.value.trim();
    const mainResult = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`]);
    if (mainResult.ok === false) {
        return { status: 'undecidable', why: `the trunk ref "${mainRef}" could not be resolved in ${repo}` };
    }
    const mainHead = mainResult.value.trim();
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
            });
            return true;
        }
        catch {
            return false;
        }
    })();
    const behindResult = tryGit(repo, ['rev-list', '--count', `${head}..${mainHead}`]);
    const behind = behindResult.ok === false ? undefined : Number.parseInt(behindResult.value.trim(), 10);
    /**
     * ★★ (b) 未提交的部分有没有【唯一的产物】。
     *   ★ `lib/` 不算：它是构建产物，每次 build 重生成。
     */
    const dirtyResult = tryGit(worktree, ['status', '--porcelain']);
    const dirty = (dirtyResult.ok ? dirtyResult.value : '').split('\n').filter((line) => line.trim() !== '');
    const dirtyPaths = dirty
        .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
        .filter((path) => !path.startsWith('lib/') && !path.endsWith('git-artifact-stamp.json'));
    const orphaned = [];
    for (const path of dirtyPaths) {
        if (!existsSync(join(worktree, path)))
            continue;
        const blobResult = tryGit(worktree, ['hash-object', path]);
        if (blobResult.ok === false)
            continue;
        const foundResult = tryGit(repo, ['log', '--all', '--oneline', `--find-object=${blobResult.value.trim()}`]);
        if (foundResult.ok === false || foundResult.value.trim() === '')
            orphaned.push(path);
    }
    if (!absorbed) {
        return {
            status: 'keep',
            reason: 'not-absorbed',
            behind,
            detail: `its HEAD (${head.slice(0, 12)}…) is not an ancestor of ${mainRef} `
                + `(${mainHead.slice(0, 12)}…) — its committed work is not in the trunk yet`,
        };
    }
    if (orphaned.length > 0) {
        return {
            status: 'keep',
            reason: 'unique-work',
            behind,
            orphaned,
            detail: `${orphaned.length} uncommitted source file(s) exist ONLY here — their content appears in no commit`
                + ` (${orphaned.slice(0, 3).join(', ')}${orphaned.length > 3 ? ', …' : ''}); deleting this worktree would lose them`,
        };
    }
    return { status: 'reclaimable', reason: 'absorbed', behind };
}
/** 把那个判定说成一句人话。★ 三态各有各的措辞（不许同形）。 */
export function describeReclaimability(verdict) {
    if (verdict.status === 'reclaimable') {
        return `absorbed into the trunk${verdict.behind === undefined ? '' : ` (${verdict.behind} commit(s) behind)`} — safe to reclaim`;
    }
    if (verdict.status === 'keep') {
        return `${verdict.reason === 'unique-work' ? 'HELD: unique work' : 'HELD: not absorbed'} — ${verdict.detail}`;
    }
    return `whether this worktree can be reclaimed could NOT be determined (${verdict.why}) — that is "not measured", not "safe to delete"`;
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
