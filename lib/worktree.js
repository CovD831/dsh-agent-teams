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
     * ★ (a-Ⅰ) 已提交的部分**真的**被吸收了。
     *   ★ 用退出码判，**不用输出** —— `--is-ancestor` 成功时**没有输出**
     *     （空串），而 `tryGit` 对"退出 0、无输出"与"退出非 0"的区分
     *     只能靠抛不抛错 ⇒ 所以要 `try/catch` 而不是比字符串。
     *     ★ 若按输出判，`absorbed` 会恒为 **false** ⇒ 判据退化成**恒不删**
     *       （而那正是反向半边禁止的）。
     */
    const isAncestor = (() => {
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
        const patchId = (ref) => {
            try {
                const shown = execFileSync('git', ['show', ref], {
                    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
                });
                const id = execFileSync('git', ['patch-id', '--stable'], {
                    cwd: repo, encoding: 'utf8', input: shown, stdio: ['pipe', 'pipe', 'pipe'],
                }).trim().split(/\s+/)[0];
                return id === undefined || id === '' ? undefined : id;
            }
            catch {
                return undefined;
            }
        };
        const headId = patchId(head);
        if (headId === undefined)
            return false;
        const mainId = patchId(mainHead);
        return mainId !== undefined && mainId === headId;
    })();
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
        let changed;
        try {
            const out = execFileSync('git', ['diff', '--name-only', `${head}^`, head], {
                cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
            });
            changed = out.split('\n').map((line) => line.trim()).filter((line) => line !== '');
        }
        catch {
            /** ★ 读不到父提交 ⇒ **不算命中**（见上面 ①）。 */
            return false;
        }
        /** ★ 空列表 ⇒ 不算命中（见上面 ③）。 */
        if (changed.length === 0)
            return false;
        /**
         * ★★ 与 `containedAbsorbed` **同一套口径**：构建产物不参与（见那里的长注释）——
         *   它内嵌路径、每次 build 重生成 ⇒ 要求它逐字节相同是**恒不成立**的条件。
         *   ★ 这里同样只在**源码**为空时不算命中。
         */
        const changedSource = changed.filter((path) => !path.startsWith('lib/') && !path.endsWith('git-artifact-stamp.json'));
        if (changedSource.length === 0)
            return false;
        for (const path of changedSource) {
            const headBlob = (() => {
                try {
                    return execFileSync('git', ['rev-parse', `${head}:${path}`], {
                        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                    }).trim();
                }
                catch {
                    return undefined;
                }
            })();
            if (headBlob === undefined || headBlob === '')
                return false;
            const mainBlob = (() => {
                try {
                    return execFileSync('git', ['rev-parse', `${mainHead}:${path}`], {
                        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                    }).trim();
                }
                catch {
                    /** ★ 主干上没有这个文件 ⇒ 那份产物没落盘（见上面 ②）。 */
                    return undefined;
                }
            })();
            /**
             * ★★ 比的是 **blob 对象名**，不是文件内容本身 ——
             *   git 的 blob hash 由内容决定 ⇒ 相同的对象名**就是**逐字节相同。
             *   ★ 而它比读两份文件再比字节便宜得多，且**没有"编码/行尾被我规范化"的风险**。
             */
            if (mainBlob !== headBlob)
                return false;
        }
        return true;
    })();
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
        let changed;
        try {
            const out = execFileSync('git', ['diff', '--name-only', `${head}^`, head], {
                cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
            });
            changed = out.split('\n').map((line) => line.trim()).filter((line) => line !== '');
        }
        catch {
            return false;
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
        const isBuildProduct = (path) => path.startsWith('lib/') || path.endsWith('git-artifact-stamp.json');
        const sourceChanged = changed.filter((path) => !isBuildProduct(path));
        /**
         * ★ 改动里**一个源码文件都没有** ⇒ **不算命中**。
         *   ★ 为什么不是"空就算通过"：一次只改了构建产物的提交**没有交付任何源码工作**，
         *     于是"它的产物被吸收了吗"这个问句**没有对象** ⇒ 落在保守的 keep 上。
         *     （与 `filesAbsorbed` 的③同一条精神：空不是证据。）
         */
        if (sourceChanged.length === 0)
            return false;
        for (const path of sourceChanged) {
            const headBlob = (() => {
                try {
                    return execFileSync('git', ['rev-parse', `${head}:${path}`], {
                        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                    }).trim();
                }
                catch {
                    return undefined;
                }
            })();
            if (headBlob === undefined || headBlob === '')
                return false;
            /**
             * ★ 候选提交：主干上"曾经见过这个对象"的那些（含把它删掉的那一次 ——
             *   所以**必须**再逐条核对路径与 blob，见上面的长注释）。
             */
            let candidates;
            try {
                const out = execFileSync('git', ['log', mainHead, '--format=%H', `--find-object=${headBlob}`], {
                    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
                });
                candidates = out.split('\n').map((line) => line.trim()).filter((line) => line !== '');
            }
            catch {
                return false;
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
                    }).trim() === headBlob;
                }
                catch {
                    /** ★ 那个提交在该路径上没有这个文件（例如它就是删除它的那一次）⇒ 不是证据。 */
                    return false;
                }
            });
            if (!landedAsContent)
                return false;
            /** ② ★ 主干顶端那个文件**还在**吗（哪怕内容已被后续提交推进）？ */
            try {
                execFileSync('git', ['rev-parse', `${mainHead}:${path}`], {
                    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                });
            }
            catch {
                /** ★ 主干顶端**没有**这个文件 ⇒ 它被删掉/撤销了 ⇒ **保留**。 */
                return false;
            }
        }
        return true;
    })();
    /** ★ 四种形态的**合取**：任一命中即"已提交的部分被吸收了"。 */
    const absorbed = isAncestor || contentAbsorbed || filesAbsorbed || containedAbsorbed;
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
        };
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
            behind,
            orphaned,
            detail: `${orphaned.length} uncommitted source file(s) exist ONLY here — their content appears in no commit`
                + ` (${orphaned.slice(0, 3).join(', ')}${orphaned.length > 3 ? ', …' : ''}); deleting this worktree would lose them`,
        };
    }
    /**
     * ★ 三种形态**不是**同一件事，所以把"是哪一种"如实带出去 ——
     *   读的人要能分辨"它真的并进去了"、"它的改动被 cherry-pick 了"、
     *   与"它的文件被手工落盘了"（三者的**复核动作不同**）。
     *   ★ 顺序与上面 `absorbed` 的短路顺序**同一套**：先祖先、再 patch-id、最后逐文件。
     */
    const how = isAncestor ? 'ancestor'
        : contentAbsorbed ? 'content'
            /**
             * ★★ 顺序是**刻意的**：`'files'`（顶端逐字节相同，**更强**的事实）
             *   排在 `'contained'`（历史里被并进去过，**更弱**）**之前**。
             *   ⇒ 一棵主干顶端就拿着这份内容的树，报的是那个**更强**的依据；
             *     只有当真主顶端已经变过时，才落到 `'contained'`。
             */
            : filesAbsorbed ? 'files' : 'contained';
    return { status: 'reclaimable', reason: 'absorbed', how, behind };
}
/** 把那个判定说成一句人话。★ 三态各有各的措辞（不许同形）。 */
export function describeReclaimability(verdict) {
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
                        + '(its work was merged in — the trunk tip may have moved on since)';
        return `${how}${verdict.behind === undefined ? '' : ` (${verdict.behind} commit(s) behind)`} — safe to reclaim`;
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
