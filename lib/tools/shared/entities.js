// ── src/tools/shared/entities.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的共享实体（含它们自身的传递依赖）。
// ★ 搬运规则：一个字符都不改 —— 「拆分不得改变行为」最直接的证据就是逐字相同。
// ★ 本文件【不允许】import src/tools.ts（会成环：tools.ts → 工具模块 → 本文件）。
// 它只 import 更底层的模块。
import { dirname, join } from 'node:path';
/**
 * ★ t53：规则表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 *   ★ 方向不会成环：`verify-command.ts` 只 import `registry.ts` / `requires.ts`，
 *     它不知道 tools 层存在。
 *   ★ 而校验与读盘分开是刻意的：读不到是**调用方**的事实（`absent`），
 *     形状坏是**数据本身**的事实（`malformed`）—— 两者不同形，由两个地方各自判。
 */
import { parseRules } from "../../gates/contract/verify-command.js";
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registry, gateModuleViews } from "../../gates/index.js";
import { resolveMemberLlmSelection, validateMemberLlmSelections } from "../../members.js";
import { resolveTeamProfile } from "../../profiles.js";
import { createTeamDir } from "../../state.js";
import { planQualityFollowUp } from "../../quality-gates.js";
import { auditRequires } from "../../gates/requires.js";
import { TERMINAL_TASK_STATUSES } from "../../types.js";
import { collectCompletedDependencyOutputs, formatDependencyOutputs } from "../../scheduler.js";
import { sessionOwnEvents } from "../../harness-compat.js";
import { CAPTAIN_KEY, findTeamByCaptain, findTeamByParticipant, readTeam } from "../../state.js";
export function withInputSurfaceOnError(tool) {
    const inner = tool.execute;
    const wrapped = async function (...args) {
        try {
            return await inner.apply(this, args);
        }
        catch (error) {
            const surface = inputSurfaceFromThrown(error);
            if (surface === undefined || error === null || typeof error !== 'object')
                throw error;
            /**
             * ★★ 纪律 ①：**先到的那一份说话**。已经搬过的那一份不许被覆盖。
             *
             * ── MEASURED（2026-10-06，verifier5 抓到的 blocker；本任务的 FINDING-1）────────
             *
             * 这里此前写的是 `if (INPUT_SURFACE_PROPERTY in error) throw error` —— 而那一句
             * **对每一次 `throwWithSurface` 抛出都为真**：`throwWithSurface` 刚把这个属性
             * 挂上去，它就是带着它抛出来的。⇒ 包装**当场放弃搬运**，下一行的搬运**永不执行**。
             *
             * ⇒ 后果不是"某一处少了个字段"，是**整条拒绝路径的出口失效**：
             *
             *      update_task { changedPaths: ['src/out-of-scope.ts'] }   ← 一次真实拒绝
             *        error.agentTeamsInputSurface = {checked:2,incomplete:1,…}  ← 结论在
             *        error.input_surface          = undefined                    ← 边界没搬
             *
             *   于是四处里只有**成功**路径补上了出口，一旦被拒就回到 t9 钉住的那个不对称
             *   （只剩一个 `logger.warn`）—— 而拒绝**恰恰是最需要读到输入面**的那一刻：
             *   一次真实拒绝里，"是契约本身不合法"与"是判据要的那一格没接上"正是最容易
             *   合流的两件事（前者是拒绝的理由，后者不是）。
             *
             * ── 为什么"检查错了属性"是特别难看见的一种错 ────────────────────────────
             *
             * 两个名字只差一点：`INPUT_SURFACE_PROPERTY`（**判据挂的内部属性**，
             * = `'agentTeamsInputSurface'`）与 `input_surface`（**工具结果的字段**）。
             * 守卫要判断的明明是后者（"这一跳搬过没有"），却写成了前者 ⇒ 它**恒真**。
             * ★ 一个永远为真的守卫不是"更严格"，是**不存在**。而它在断言层面读起来完全正常：
             *   属性在场、值也对，只是搬运从未发生。
             * ⇒ 本队把这记作「恒真写法」的**第四种**：**守卫检查了另一个同名的东西**。
             *
             * ── 修法：检查**搬运后的落点** ──────────────────────────────────────────
             *
             * `Object.hasOwn(error, 'input_surface')` 问的正是"这一跳搬过没有"。
             * ⇒ 「先到的那一份说话」这条语义**一个字没变**：第一个搬运的赢，后来的
             *   （例如一次 `update_task` 里 completion 位置在 dispatch 之后抛出）不许覆盖它。
             * ★ 用 `Object.hasOwn`（自有属性）而不是 `'input_surface' in error`：后者会把
             *   原型链上的同名属性也算进来 —— 而"从原型继承来的字段"与"我自己搬过"
             *   是两件事。
             */
            if (Object.hasOwn(error, 'input_surface'))
                throw error;
            error[inputSurfaceFieldOf(error)] = surface;
            /**
             * ★★ 拒绝路径**同时**挂泛用名（t4 修；MEASURED：verifier5 的臂 1/7 复跑暴露）──
             *
             * 一次 `update_task` 穿过两个位置，它们在成功路径上**各挂各的**
             * （`dispatch_input_surface` / `completion_input_surface`）。拒绝路径只挂位置名
             * 会造出一个新的不同形：**同一位置**在成功路径上读 `dispatch_input_surface`、
             * 在拒绝路径上就读不到（而它其实**有**结论）——"读不到"与"没有结论"同形。
             *
             * ⇒ 两条路都留：位置名（按位置去找的读者用）+ 泛用名（按"这次调用有没有交出
             *   结论"去找的读者用）。
             *
             * ★★ **它们是同一个对象的两个名字，不是两份真相。**（user 裁定已明确批准这个
             *   形状；这一句必须写在这里，因为下一个人看到两个字段名会以为那是两份独立数据。）
             *   实现上就是**同一行** `surface` 被赋给两个键 —— 中间没有任何一次重新计算：
             *
             *       const surface = inputSurfaceFromThrown(error)   // ← 唯一的那一份
             *       error[inputSurfaceFieldOf(error)] = surface     // ← 位置名
             *       error.input_surface               = surface     // ← 泛用名（同一个对象）
             *
             *   ⇒ 可机械核对：`JSON.stringify(error.input_surface) ===
             *      JSON.stringify(error.dispatch_input_surface)`。若哪天有人在两个键之间插入
             *      一次"重新算一遍"，这条相等立刻不成立 —— 而那时它们**真的**成了两份真相
             *      （本队反复见过的那种分叉）。
             *
             * ★ 泛用名只在**没人占**的时候写：一次调用穿过两个位置时，第一个拒绝的已经
             *   写过了 ⇒ 后来的不许覆盖（"先到的那一份说话"，与上面那句守卫同一条纪律）。
             */
            if (!Object.hasOwn(error, 'input_surface')) {
                ;
                error.input_surface = surface;
            }
            throw error;
        }
    };
    return { ...tool, execute: wrapped };
}
export function requireCaptain(exec) {
    if (!exec.agent) {
        throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)');
    }
    return exec.agent;
}
export function workspaceOf(agent) {
    return agent.session.header.cwd ?? process.cwd();
}
export const VERIFY_COMMAND_TIMEOUT_MS = 120_000;
/**
 * ── ★★★ 规则表的**运行时**读取（t53）────────────────────────────────────────────
 *
 * ★ 为什么读盘这一件事必须在这里（而不是判据里）：
 *
 *   判据**不许 import 任何 I/O**（`scripts/verify-gates-integration.test.mjs` ④
 *   逐行检查 import 子句）⇒ 它只能拿到调用方交进去的东西。
 *   ⇒ 于是"改数据 ⇒ 立刻生效"这件事的**成立条件**就是：**调用方每次调用时读**。
 *
 * ★★ 而这正是那个三分类里**唯一**兑现"不必重载"的一类：
 *
 *     改【跑着的代码】（.ts 的逻辑）        ⇒ 要 build + 重载
 *     改【被内联进 lib 的数据】（静态 import）⇒ ★ 要 build + 重载（只省了"懂 TS"）
 *     改【运行时读盘的数据】（这里）        ⇒ ★ 不 build、不重载
 *
 *   MEASURED（t53）：静态 `import rules from './….json'` 在本仓库连编译都过不去
 *   （`TS1543 … requires a 'type: "json"' import attribute when 'module' is NodeNext`）；
 *   即便打开 `resolveJsonModule`，JSON 也会被 `tsc` 内联进 `lib/` ⇒ 改数据仍要 build。
 *   ★ 所以中间那一类**看起来像数据**，而它在运行时与代码同命。
 *
 * ★ 四态**互不同形**（`parseRules` 判后两者，这里判前两者）：
 *     loaded / absent（读不到）/ malformed（形状坏）/ empty（空表）
 *   ⇒ 后三者会让判据降级成 `unmeasured` —— **绝不静默退化成"没有规则"**。
 */
export async function loadVerifyCommandRules(workspace) {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    /**
     * ★ 数据文件**跟着源码走**（`src/gates/contract/verify-command-rules.json`），
     *   而不是跟着工作区 —— 它是**插件自己的**规则表，不是被审对象的属性。
     *   ★ 而它必须与 `verify-command.ts` 同一次构建一起被复制到 `lib/` 下
     *     （见 `scripts/git-artifacts.mjs` 的 copy 清单）——
     *     否则"读得到"在生产里会变成"读不到"，而那个失效是静默的。
     */
    const here = path.dirname(fileURLToPath(import.meta.url));
    /**
     * ★ 两份候选：**先看产物旁边**（`lib/gates/contract/…`，生产路径），
     *   再看源码旁边（`src/gates/contract/…`，夹具/开发路径）。
     *   ★ 顺序无关正确性（两者是同一份文件的两个副本），而它让"哪个都不在"
     *     与"读到了"分得开 —— 前者是 `absent`，后者是 `loaded`。
     */
    const candidates = [
        path.resolve(here, '..', '..', 'gates', 'contract', 'verify-command-rules.json'),
        path.resolve(here, '..', '..', '..', 'src', 'gates', 'contract', 'verify-command-rules.json'),
    ];
    let lastError = '';
    for (const candidate of candidates) {
        try {
            const text = await readFile(candidate, 'utf8');
            return parseRules(JSON.parse(text));
        }
        catch (error) {
            lastError = `${candidate}: ${String(error?.message ?? error)}`;
        }
    }
    void workspace;
    return { status: 'absent', reason: `the rule table could not be read from any known location (${lastError})` };
}
export async function runVerifyCommand(workspace, command) {
    const { spawn } = await import('node:child_process');
    return await new Promise((resolve) => {
        const child = spawn('/bin/sh', ['-c', command], {
            cwd: workspace,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill('SIGKILL');
            resolve(125);
        }, VERIFY_COMMAND_TIMEOUT_MS);
        child.on('error', () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(127);
        });
        child.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(code ?? 125);
        });
        // 排空输出，避免管道写满后子进程阻塞
        child.stdout?.on('data', () => { });
        child.stderr?.on('data', () => { });
    });
}
export const taskWorktreeBase = new Map();
export function worktreeBaseOf(taskId) {
    const base = taskWorktreeBase.get(taskId);
    return typeof base === 'string' && base.trim() !== '' ? base : undefined;
}
export function resolveBaseRevision(task) {
    const fromMemory = worktreeBaseOf(task.id);
    if (fromMemory !== undefined)
        return { kind: 'resolved', revision: fromMemory, from: 'memory' };
    const rawRecord = task['baseRevision'];
    const fromRecord = typeof rawRecord === 'string' && rawRecord.trim() !== ''
        ? rawRecord.trim()
        : undefined;
    if (fromRecord !== undefined)
        return { kind: 'resolved', revision: fromRecord, from: 'record' };
    /**
     * ★ 两种"没有"必须分得开，而**判别的依据不是一个新猜测**：
     *   任务被派发过（`attempt > 0`）却查不到任何基准 ⇒ 那个事实本该存在而丢了
     *   （进程重启）；从未派发过 ⇒ 这类任务本来就没有 worktree。
     *
     * ★ 这条近似**写在这里而不是藏起来**：它是"两个都空"时唯一能读到的证据，
     *   而它的边界说清楚 —— 一个 `attempt > 0` 但**从来没有** worktree 的任务
     *   （无隔离环境）会被读成 `not-recorded`。那不是错的：在无隔离环境里，
     *   "本该有的父版本"确实没有存在过，而**要看一眼**正是我们想让人做的事。
     */
    return { kind: 'absent', reason: typeof task.attempt === 'number' && task.attempt > 0 ? 'not-recorded' : 'no-worktree' };
}
export async function runInDetachedRevision(options) {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const scratch = await mkdtemp(join(tmpdir(), 'agent-teams-rev-'));
    const checkout = join(scratch, 'co');
    try {
        const added = await runVerifyCommand(options.workspace, `git worktree add --quiet --detach ${JSON.stringify(checkout)} ${options.revision}`);
        if (added !== 0)
            return undefined;
        try {
            return await runVerifyCommand(checkout, options.command);
        }
        finally {
            await runVerifyCommand(options.workspace, `git worktree remove --force ${JSON.stringify(checkout)}`);
        }
    }
    catch {
        return undefined;
    }
    finally {
        try {
            await rm(scratch, { recursive: true, force: true });
        }
        catch {
            // 清理失败不影响裁决：它既不产生"通过"也不产生"拒绝"
        }
    }
}
export async function deriveCoverageInput(options) {
    const { readFile, readdir } = await import('node:fs/promises');
    if (options.testFiles.length === 0 || options.knownTests.length === 0)
        return undefined;
    const readText = async (relative) => {
        try {
            return await readFile(join(options.workspace, relative), 'utf8');
        }
        catch {
            return undefined;
        }
    };
    /** 从一段源码里抽出它 import 的相对路径（解析成 workspace 相对、带扩展名）。 */
    const importsOf = (source, from) => {
        const out = [];
        for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g)) {
            const spec = match[1];
            if (spec === undefined || !spec.startsWith('.'))
                continue;
            const base = join(dirname(from), spec);
            const resolved = /\.[cm]?[jt]sx?$/.test(base) ? base : `${base}.ts`;
            out.push(resolved.startsWith(options.workspace) ? resolved.slice(options.workspace.length + 1) : resolved);
        }
        return out;
    };
    const listSourceFiles = async (directory) => {
        const found = [];
        const walk = async (relative) => {
            let entries;
            try {
                entries = await readdir(join(options.workspace, relative), { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.'))
                    continue;
                const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
                if (entry.isDirectory())
                    await walk(child);
                else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/(^|\/)(test|tests|__tests__)\//.test(child) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(child))
                    found.push(child);
            }
        };
        await walk(directory);
        return found.sort();
    };
    const coverage = {};
    const dependents = {};
    const sourceFiles = await listSourceFiles('');
    if (sourceFiles.length === 0)
        return undefined;
    /** 测试 → 它（传递地）import 到的源文件。 */
    for (const test of options.knownTests) {
        const text = await readText(test);
        if (text === undefined)
            continue;
        const seen = new Set();
        const queue = importsOf(text, test);
        while (queue.length > 0) {
            const next = queue.shift();
            if (seen.has(next))
                continue;
            seen.add(next);
            const source = await readText(next);
            if (source === undefined)
                continue;
            queue.push(...importsOf(source, next));
        }
        for (const file of seen) {
            if (!coverage[file])
                coverage[file] = [];
            coverage[file].push(test);
            if (!dependents[file])
                dependents[file] = [];
            dependents[file].push(test);
        }
    }
    /** 源文件 → 直接 import 它的源文件（判据自己算传递闭包）。 */
    for (const file of sourceFiles) {
        const text = await readText(file);
        if (text === undefined)
            continue;
        for (const imported of importsOf(text, file)) {
            if (!dependents[imported])
                dependents[imported] = [];
            dependents[imported].push(file);
        }
    }
    if (Object.keys(coverage).length === 0)
        return undefined;
    return {
        source: 'dependency-graph',
        dependents,
        coverage,
        knownTests: [...options.knownTests],
        /**
         * ★ `selected` = 【全部已知测试】。
         *
         * 读法要说清，否则它会看起来像"我们在假装有个选测器"：
         *   本仓库确实【没有】变更级选测器。判据要求"覆盖了改动却没被选中的测试"被
         *   逐条报出来（盲区）。既然没有选测器，诚实的做法是**全选**，于是
         *   `blind`（已覆盖但未选中）为空，而 `testsWithNoCoverageData` 仍然如实报出
         *   "哪些测试的覆盖数据我们压根没有" —— 那一条才是这里真正的未知。
         *
         * ★ 绝不把一个【子集】当成 selected：那会凭空造出一个盲区报告，读起来像
         *   "有个选测器漏掉了这些测试"，而事实是我们从没做选测。
         */
        selected: [...options.knownTests],
    };
}
export async function runVerifyCommandCaptured(workspace, command) {
    const { spawn } = await import('node:child_process');
    const LIMIT = 256 * 1024;
    return await new Promise((resolve) => {
        const child = spawn('/bin/sh', ['-c', command], {
            cwd: workspace, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const push = (into, chunk) => {
            if (into === 'out')
                stdout = (stdout + chunk).slice(-LIMIT);
            else
                stderr = (stderr + chunk).slice(-LIMIT);
        };
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill('SIGKILL');
            resolve({ exitCode: 125, stdout, stderr });
        }, VERIFY_COMMAND_TIMEOUT_MS);
        child.on('error', () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ exitCode: 127, stdout, stderr });
        });
        child.stdout?.on('data', (data) => push('out', String(data)));
        child.stderr?.on('data', (data) => push('err', String(data)));
        child.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ exitCode: code ?? 125, stdout, stderr });
        });
    });
}
export function readWorkspaceFileSync(workspace, relativePath) {
    return readFileSync(join(workspace, relativePath), 'utf8');
}
export function writeWorkspaceFileSync(workspace, relativePath, contents) {
    const target = join(workspace, relativePath);
    if (!target.startsWith(workspace.endsWith('/') ? workspace : `${workspace}/`)) {
        throw new Error(`refusing to write outside the workspace: ${relativePath}`);
    }
    writeFileSync(target, contents);
}
export function deriveScanDirs(changedFiles) {
    const dirs = new Set();
    for (const file of changedFiles) {
        const parts = file.split('/');
        if (parts.length <= 1)
            continue;
        dirs.add(parts.slice(0, -1).join('/'));
    }
    return dirs.size === 0 ? undefined : [...dirs].sort();
}
export async function changedLineNumbers(workspace, base) {
    if (typeof base !== 'string' || base.trim() === '')
        return undefined;
    const { execFile } = await import('node:child_process');
    const run = (args) => new Promise((resolve, reject) => {
        execFile('git', [...args], { cwd: workspace, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
            if (error)
                reject(error);
            else
                resolve(String(stdout));
        });
    });
    try {
        const diff = await run(['diff', '--unified=0', base.trim(), '--']);
        const lines = new Set();
        for (const match of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
            const start = Number(match[1]);
            const count = match[2] === undefined ? 1 : Number(match[2]);
            for (let offset = 0; offset < count; offset += 1)
                lines.add(start + offset);
        }
        return [...lines].sort((a, b) => a - b);
    }
    catch {
        return undefined;
    }
}
export function mergeRerunIntoCommandsRun(claimed, reruns) {
    const byCommand = new Map(reruns.map((item) => [item.command, item]));
    const base = [...(claimed ?? [])];
    const seen = new Set();
    const merged = base.map((item) => {
        const rerun = byCommand.get(item.command);
        if (rerun === undefined)
            return item;
        seen.add(item.command);
        return rerun;
    });
    for (const rerun of reruns) {
        if (!seen.has(rerun.command))
            merged.push(rerun);
    }
    return merged;
}
export function stateRootOf(workspace, config) {
    return join(workspace, config.stateDir);
}
export function teamLockKey(stateRoot, teamId) {
    return `team:${stateRoot}:${teamId}`;
}
export function captainLockKey(stateRoot, captainId) {
    return `captain:${stateRoot}:${captainId}`;
}
export async function requireCaptainTeam(workspace, config, captain) {
    const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id);
    if (team === undefined) {
        throw new Error('you are not leading any team yet — call agent_teams_create first');
    }
    return team;
}
export async function requireParticipantTeam(workspace, config, caller) {
    const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id);
    if (team === undefined) {
        throw new Error('you do not lead or belong to any active team yet');
    }
    return team;
}
export function participantIdentityOf(team, agentId) {
    if (team.captainSessionId === agentId)
        return { kind: 'captain', name: CAPTAIN_KEY };
    const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed');
    return member === undefined ? undefined : { kind: 'member', name: member.name };
}
export async function requireFreshTeam(stateRoot, teamId) {
    const fresh = await readTeam(stateRoot, teamId);
    if (fresh === undefined)
        throw new Error(`team "${teamId}" is no longer active`);
    return fresh;
}
export async function requireFreshCaptainTeam(stateRoot, teamId, captainId) {
    const fresh = await requireFreshTeam(stateRoot, teamId);
    if (fresh.captainSessionId !== captainId) {
        throw new Error(`only the captain of team "${fresh.name}" may perform this operation`);
    }
    return fresh;
}
export async function requireFreshParticipant(stateRoot, teamId, callerId) {
    const fresh = await requireFreshTeam(stateRoot, teamId);
    const identity = participantIdentityOf(fresh, callerId);
    if (identity === undefined)
        throw new Error(`you are no longer an active participant in team "${fresh.name}"`);
    return { team: fresh, identity };
}
export function requireMember(team, name) {
    const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed');
    if (member === undefined) {
        throw new Error(`no active member named "${name}" in team "${team.name}"`);
    }
    return member;
}
export function requireTask(team, taskId) {
    const task = team.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) {
        throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`);
    }
    return task;
}
export function trimmedOptional(value) {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
export function memberOpenTask(team, memberName, exceptTaskId) {
    return team.tasks.find(task => task.id !== exceptTaskId
        && task.assignee === memberName
        && (task.status === 'claimed' || task.status === 'in_progress'));
}
export function taskDetails(team, task) {
    return [task.subject, task.description ?? '',
        `Kind: ${task.kind ?? 'work'}`,
        `Objective: ${task.objective ?? ''}`,
        `In scope: ${(task.inScope ?? []).join(', ')}; Out of scope: ${(task.outOfScope ?? []).join(', ')}`,
        `Acceptance: ${(task.acceptance ?? []).join('; ')}`,
        `Verify: ${(task.verify ?? []).join('; ')}`,
        `Dependency results:\n${formatDependencyOutputs(collectCompletedDependencyOutputs(team.tasks, task.id))}`,
    ].join('\n');
}
export function captainOpenTask(team, exceptTaskId) {
    return team.tasks.find(task => task.id !== exceptTaskId
        && task.assignee === CAPTAIN_KEY
        && !TERMINAL_TASK_STATUSES.includes(task.status));
}
export async function stopTeamMemberActivations(ctx, captain, members, signal) {
    const memberIds = members.filter(member => member.id !== '').map(member => member.id);
    if (memberIds.length === 0)
        return;
    // Every supported exact host has targeted recursive drain. Unlike interrupt,
    // it closes admission and clears queued work before awaiting descendants.
    signal?.throwIfAborted();
    await ctx.subagents.drainContinuableChildren(captain, memberIds);
}
export const RUNTIME_GATE_LOG_LIMIT = 50;
export const runtimeGateLog = [];
export const BUILD_STAMP_FILE = 'git-artifact-stamp.json';
export function readStamp(root) {
    try {
        const raw = readFileSync(join(root, 'lib', BUILD_STAMP_FILE), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object')
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
export function readStampOutput(root) {
    const parsed = readStamp(root);
    return typeof parsed?.output === 'string' && parsed.output.trim() !== '' ? parsed.output : undefined;
}
/**
 * ── ★★ 「构建时的提交」从 stamp 读；「当前 HEAD」在【调用时】读 ─────────────────────
 *
 * ★ f-0025「按取值时机区分」的可执行形式：
 *
 *     「构建时的提交」 —— **常量**。它随 stamp 落盘，进程加载后不会变 ⇒ 加载时读一次即可。
 *     「当前 HEAD」    —— **每次调用都可能变**的量 ⇒ 必须在**调用时**重新取。
 *
 * ★ 把后者也做成"加载时读一次"，它就退化成与 `output` 同一个问句 ——
 *   而"答的是另一个问题"正是 f-0026 要修的那一格。
 */
export function stampCommitOf(stamp) {
    return typeof stamp?.commit === 'string' && /^[0-9a-f]{40}$/u.test(stamp.commit.trim())
        ? stamp.commit.trim()
        : undefined;
}
/**
 * 读【此刻】的 HEAD。取不到 ⇒ `undefined`（**不是**空串）。
 *
 * ★ 三种"取不到"必须都是 `undefined`，而**成因写进 reason**（由调用方区分）：
 *   不是 git 仓库 / git 不可用 / 仓库还没有任何提交（`HEAD` 未出生）。
 *   ★ 而它与"读到了但内容为空"不同形 —— 后者不是一个合法 sha，也走不到这里。
 */
export function currentHead(root = pluginRoot()) {
    try {
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        return /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined;
    }
    catch {
        return undefined;
    }
}
export function moduleFreshnessFrom(input) {
    const loadedOutput = typeof input.loaded?.output === 'string' && input.loaded.output.trim() !== ''
        ? input.loaded.output
        : undefined;
    const onDiskOutput = typeof input.onDisk?.output === 'string' && input.onDisk.output.trim() !== ''
        ? input.onDisk.output
        : undefined;
    const builtCommit = stampCommitOf(input.loaded);
    const onDiskCommit = stampCommitOf(input.onDisk);
    const head = typeof input.head === 'string' && /^[0-9a-f]{40}$/u.test(input.head) ? input.head : undefined;
    /**
     * ★★ ① 「读不到」这一格的【两个成因必须不同形】（本队记账：三态不同形）。
     *
     *   两件事都落 `unknown`，但**措辞不同**：
     *     · 盘上读不到 stamp（还没 build / 文件被删 / 解析失败）⇒ 整个读数无从谈起
     *     · 读不到 HEAD（不是 git 仓库 / 没有提交）⇒ 只缺"落后没落后"这一维
     *   ★ 把它们写成同一句，会让"stamp 没记这一格"与"这个环境没有 git"同形。
     */
    if (onDiskOutput === undefined) {
        return {
            status: 'unknown',
            ...loadedOutput === undefined ? {} : { loaded: loadedOutput },
            reason: `no build stamp at lib/${BUILD_STAMP_FILE} (not built, or removed)`,
        };
    }
    if (loadedOutput === undefined) {
        return {
            status: 'unknown',
            onDisk: onDiskOutput,
            ...onDiskCommit === undefined ? {} : { commit: onDiskCommit },
            reason: `the build stamp was unreadable when this process loaded (lib/${BUILD_STAMP_FILE}); the one on disk now is ${onDiskOutput.slice(0, 12)}…`,
        };
    }
    /**
     * ★ ② commit 维读不到 ⇒ **unknown，不是 current**。
     *   这是本任务最容易做错的一格：把"没能比对提交"并进"是新的"，
     *   就是本任务要消灭的那个合流。★ 而它**不掩盖** output 维已经测出的事实。
     */
    if (builtCommit === undefined || head === undefined) {
        const which = builtCommit === undefined
            ? `this build's stamp records no git commit, so whether the loaded code is behind HEAD could not be measured`
            : `the current HEAD could not be read (not a git repository, or no commit yet), so whether the loaded code is behind it could not be measured`;
        return { status: 'unknown', loaded: loadedOutput, onDisk: onDiskOutput, ...head === undefined ? {} : { head }, reason: which };
    }
    /**
     * ★★ ③ 两维【分别判定】，然后合成 `why` —— 而不是先合成再判定。
     *
     *   content 维：进程加载的 output vs 此刻盘上的 output（"盘上被 rebuild 过吗"）
     *   commit  维：构建时的提交 vs 此刻的 HEAD（"代码落后于当前提交吗"）
     */
    const contentChanged = loadedOutput !== onDiskOutput;
    const commitBehind = builtCommit !== head;
    if (!contentChanged && !commitBehind) {
        return { status: 'current', loaded: loadedOutput, onDisk: onDiskOutput, commit: builtCommit, head };
    }
    return {
        status: 'stale',
        loaded: loadedOutput,
        onDisk: onDiskOutput,
        commit: builtCommit,
        head,
        why: contentChanged && commitBehind ? 'both' : contentChanged ? 'content' : 'commit',
        ...commitBehind ? { behind: builtCommit } : {},
    };
}
export function moduleFreshness() {
    return moduleFreshnessFrom({ loaded: loadedStamp(), onDisk: readStamp(pluginRoot()), head: currentHead() });
}
/** ★ 加载时读一次的整份 stamp —— 「构建时的提交」是常量，与 `output` 同一时机。 */
export let LOADED_STAMP;
export let LOADED_STAMP_READ = false;
export function loadedStamp() {
    if (!LOADED_STAMP_READ) {
        LOADED_STAMP = readStamp(pluginRoot());
        LOADED_STAMP_READ = true;
    }
    return LOADED_STAMP;
}
export function pluginRoot() {
    /**
     * ── ★★ t39：层数 2 → 4 —— 而这是一个【拆分引入的真缺陷】，实测抓出来的 ──────────
     *
     * ★ 先说清它返回什么：**项目根**（`lib/` 的父目录）。
     *   调用方 `readStampOutput(root)` 会再拼 `join(root, 'lib', BUILD_STAMP_FILE)`
     *   —— 所以这里【不能】返回 `lib/` 本身。
     *
     * MEASURED（本任务实测）：它此前住在 `lib/tools.js` ⇒ `dirname ×2` 正好是项目根 ✓
     * 而 t39 把它搬进 `lib/tools/shared/entities.js` ⇒ **深了两层**。
     *
     * ★★ 而它失败的方式值得单独记：**它不是崩溃，是退化到 `unknown`**：
     *
     *     moduleFreshness() ⇒ { status: 'unknown',
     *                           reason: 'no build stamp at lib/git-artifact-stamp.json' }
     *
     *   ⇒ 而 `unknown` 是**诚实**的读数（"我没能测量"）——
     *     于是"路径算错"伪装成了"这一格测不出来"，
     *     5 条既有的 freshness 臂从"报 stale/current"变成"报 unknown"。
     *   ★ 这正是本队反复记账的那条：**没能测量与一个缺陷同形**。
     *
     * ★ 我第一次修成 `×3`，而它仍然是错的 —— 因为 `×3` 给的是 `lib/`，
     *   再拼一次 `lib` 就成了 `lib/lib/`。⇒ **层数必须按"它要返回什么"算，
     *   而不是按"它比原来深了几层"算。**
     *
     * ⇒ 现在：`lib/tools/shared/entities.js` ⇒ ×4 = 项目根。
     *   ★ 刻意【不】改成"向上找 stamp 文件"那种自适应写法：
     *     那会让产物布局与读它的代码之间多一条隐式耦合 ——
     *     而本队为"隐式耦合在重构时断掉"已经付过学费。
     *     层数是**结构事实**：`lib/tools/shared/x.js` ⇒ 四层到项目根。
     */
    return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
export function moduleFreshnessMessage(freshness = moduleFreshness()) {
    if (freshness.status === 'current')
        return 'this process holds the current build';
    if (freshness.status === 'stale') {
        /**
         * ★★ 措辞按【是哪一维】分，因为两维的补救**动作不同**（f-0026）：
         *
         *     content 维旧 ⇒ 盘上被 rebuild 过 ⇒ 重载即可拿到新的
         *     commit  维旧 ⇒ 加载的代码落后于当前提交 ⇒ **重载之后才谈得上"用哪一版"**；
         *                  而它此前恒报 current，所以这一句从前**从来没人看到过**
         *
         * ★ 两维都旧时说清两件事，不说成一句笼统的"旧了"——
         *   笼统措辞会让读的人以为是其中一个原因，而修掉一个另一个还在。
         */
        const detail = freshness.why === 'commit'
            ? `this process loaded code built at ${String(freshness.commit).slice(0, 12)}…, but HEAD is now ${String(freshness.head).slice(0, 12)}…`
            : freshness.why === 'content'
                ? `loaded ${freshness.loaded.slice(0, 12)}…, on disk ${freshness.onDisk.slice(0, 12)}…`
                : `loaded ${freshness.loaded.slice(0, 12)}…, on disk ${freshness.onDisk.slice(0, 12)}…, and built at ${String(freshness.commit).slice(0, 12)}… while HEAD is ${String(freshness.head).slice(0, 12)}…`;
        return `this process holds a build OLDER than the one on disk (${detail}) — reload the plugin before trusting any judgement it makes`;
    }
    return `whether this process holds an old build could NOT be determined (${freshness.reason}) — that is "not measured", not "up to date"`;
}
export function freshnessLine() {
    return `[deployment] ${moduleFreshnessMessage()}`;
}
export function arbitrateRestart(input) {
    /**
     * ★ 顺序是刻意的：**先问判决**。
     *   理由：判决不过时，"有没有工作在跑"是一个**与结论无关**的问题 ——
     *   而先问它会让措辞变成"有工作在进行"，把真正的原因（判决没过）盖住。
     *   ⇒ 读者会去等工作结束，而该做的是回去改代码。
     */
    if (input.verdictPassed !== true) {
        return {
            allowed: false,
            blockedBy: 'no-passing-verdict',
            detail: 'a restart swaps the code every subsequent call runs on, so it needs a PASSING verdict first; '
                + 'run the full verification (pnpm verify) and hand its result in — this gate deliberately does not re-run it',
        };
    }
    const inFlight = input.tasks.filter((task) => task.status === 'in_progress').map((task) => task.id);
    if (inFlight.length > 0) {
        return {
            allowed: false,
            blockedBy: 'work-in-flight',
            detail: `${inFlight.length} task(s) are in progress; a restart would dispose the plugin while they are running `
                + '(their records would be left in a state nothing is maintaining)',
            inFlight,
        };
    }
    return { allowed: true, reason: 'verdict-passed-and-no-work-in-flight' };
}
export function restartArbitrationMessage(arbitration) {
    if (arbitration.allowed)
        return 'the gate is open: a passing verdict exists and no task is in progress';
    if (arbitration.blockedBy === 'no-passing-verdict') {
        return `restart refused: there is no passing verdict to arbiter on. ${arbitration.detail}`;
    }
    return `restart refused: work is in flight (${arbitration.inFlight.join(', ')}). ${arbitration.detail}`;
}
export const RESTART_ESCAPE_HATCH_ENV = 'AGENT_TEAMS_RESTART_ESCAPE_HATCH';
export function restartEscapeHatchFromEnv(value) {
    return value === '1';
}
export function arbitrateRestartWithEscape(input, escapeHatchOpen) {
    const arbitration = arbitrateRestart(input);
    if (arbitration.allowed)
        return arbitration;
    if (!escapeHatchOpen)
        return arbitration;
    /**
     * ★ 逃生口**只对"有工作在跑"这一条有效**，对"没有通过的判决"**无效** ——
     *   因为后者是"新代码对不对没有结论"，而逃生口的理由是"链冻住了"，
     *   不是"我们不知道新代码行不行"。让它可以绕过判决，就等于把蓝绿判决作废。
     */
    if (arbitration.blockedBy === 'no-passing-verdict')
        return arbitration;
    return { allowed: true, reason: 'escape-hatch', bypassed: arbitration.blockedBy };
}
export function judgeRuntimeGates(event, outcome) {
    runtimeGateLog.push({ at: Date.now(), event, outcome });
    if (runtimeGateLog.length > RUNTIME_GATE_LOG_LIMIT)
        runtimeGateLog.splice(0, runtimeGateLog.length - RUNTIME_GATE_LOG_LIMIT);
}
export const WAIT_RECORD_LIMIT = 200;
export const waitRecords = new Map();
export const PROBE_EVENTS = Object.freeze(['task-status', 'runtime-liveness']);
export const waitWindows = new Map();
export const WAIT_WINDOW_LIMIT = 200;
export function waitWindowKey(teamId, taskId, memberName) {
    return `${teamId}\u0000${taskId}\u0000${memberName}`;
}
export function putWaitWindow(key, window) {
    waitWindows.delete(key);
    waitWindows.set(key, window);
    while (waitWindows.size > WAIT_WINDOW_LIMIT) {
        const oldest = waitWindows.keys().next().value;
        if (oldest === undefined)
            break;
        waitWindows.delete(oldest);
    }
}
export function forgetWaitWindow(teamId, taskId) {
    for (const key of [...waitWindows.keys()]) {
        const window = waitWindows.get(key);
        if (window === undefined)
            continue;
        if (window.teamId === teamId && window.taskId === taskId)
            waitWindows.delete(key);
    }
}
export function putWaitRecord(record) {
    waitRecords.delete(record.attemptId);
    waitRecords.set(record.attemptId, record);
    while (waitRecords.size > WAIT_RECORD_LIMIT) {
        const oldest = waitRecords.keys().next();
        if (oldest.done === true)
            break;
        waitRecords.delete(oldest.value);
    }
}
export function observeMemberActivity(ctx, memberId, attemptId, now) {
    if (attemptId === undefined || memberId === '')
        return false;
    const record = waitRecords.get(attemptId);
    if (record === undefined)
        return false;
    const live = ctx.agents.get(memberId);
    if (live === undefined)
        return false;
    const key = sessionOutputKey(live.session);
    if (key === undefined)
        return false;
    /**
     * ★ 指纹没变 ⇒ 这是**已经看过的那条输出**，不是新的活动。
     *
     *   这一支是"卡死能被发现"的唯一保证：不写时刻、也不改指纹。
     *   把它写成"看到了就刷新"，会让这条判据在最需要它的时候（成员彻底不动了）
     *   表现成"一切正常"。
     */
    if (record.lastOutputKey !== undefined && record.lastOutputKey === key)
        return false;
    /**
     * ★ 时刻单调：一次观察不得把 `lastActivityAt` **往回拨**。
     *
     * 注入的时钟是可被夹具驱动的一个函数，而**观察的顺序与实际发生的顺序可以不一致**
     * （例如成员先产出、随后一个更早开始的探活才跑到）。允许回拨，等于允许"最后活动
     * 时刻"变成"随机某一个活动时刻"，而探活判据的全部推理都建在它的**单调性**上。
     */
    if (record.lastActivityAt !== undefined && record.lastActivityAt > now)
        return true;
    putWaitRecord({ ...record, lastActivityAt: now, lastOutputKey: key, activityCount: record.activityCount + 1 });
    return true;
}
export function sessionOutputKey(session) {
    if (session === null || typeof session !== 'object')
        return undefined;
    let events;
    try {
        events = sessionOwnEvents(session);
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(events))
        return undefined;
    let messages = 0;
    let text = 0;
    for (const event of events) {
        if (event === null || typeof event !== 'object')
            continue;
        if (event.type !== 'assistant/message')
            continue;
        const content = event.message?.content;
        if (!Array.isArray(content))
            continue;
        const hasText = content.some((block) => (block !== null && typeof block === 'object'
            && block.type === 'text'
            && typeof block.text === 'string'
            && block.text.trim() !== ''));
        if (!hasText)
            continue;
        messages += 1;
        for (const block of content) {
            if (block === null || typeof block !== 'object')
                continue;
            const value = block.text;
            if (typeof value === 'string')
                text += value.length;
        }
    }
    /**
     * ★ 一条非空输出都没有 ⇒ `undefined`（＝**没能观察**），而**不是** `'0:0'`。
     *   后者看起来是"观察到零条"，而"它还没说过话"与"它说了个空"是两件事
     *   （本文件在 `observedSpoke` 那里已经为这条分界写过一段说明）。
     */
    if (messages === 0)
        return undefined;
    return `${messages}:${text}`;
}
export function teamWaitObservations(team, now, event) {
    const out = [];
    for (const task of team.tasks) {
        /**
         * ★ 有界继承的**语义边界**（队长本轮点出的风险：*"否则上一代已经结束的等待
         *   会被当成还在跑"*）：任务进入终态那一刻，它的等待窗口立刻撤销。
         *   时间上的界（`WAIT_WINDOW_STALE_MS`）只能挡住被遗忘的窗口，
         *   挡不住"任务已经 completed 而窗口还新鲜" ⇒ 这一条是必须的。
         */
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
            forgetWaitWindow(team.id, task.id);
            continue;
        }
        if (task.assignee === undefined || task.assignee === CAPTAIN_KEY)
            continue;
        const observation = waitObservationFor(team.id, task.id, task.attemptId, now, task.assignee, event);
        if (observation !== undefined)
            out.push(observation);
    }
    return out;
}
export function waitObservationFor(teamId, taskId, attemptId, now, memberName, 
/**
 * ★ 这一次求值是不是**一次探活**（见 {@link PROBE_EVENTS}）。
 *   它决定窗口的探活戳要不要在这一次交接里推进 —— 换代不是探活。
 */
event) {
    if (attemptId === undefined)
        return undefined;
    const record = waitRecords.get(attemptId);
    /**
     * ★ teamId / taskId 必须对得上：`attemptId` 是 capability，理论上唯一，但一条
     *   记录被 LRU 淘汰之后**同一个键可以指向另一次派发**。这里核对其余两个身份，
     *   于是"读了别人的等待"在形状上不可能发生。
     */
    if (record === undefined || record.teamId !== teamId || record.taskId !== taskId)
        return undefined;
    /**
     * ── ★ V3-2 收口：窗口（per-task）是探活戳的权威来源，记录（per-attempt）只补读数 ──
     *
     * `startedAt` / `previousPollAt` / `previousLastActivityAt` 三个**跨代概念**
     * 一律从窗口簿读；`lastActivityAt` 这种"这一代读到过什么"从记录读。
     * 两者分开之后，"换代"不再需要从记录表里推断探活戳 —— 那正是我前三种写法
     * 反复失败的根因。
     */
    const windowKey = waitWindowKey(record.teamId, record.taskId, record.memberName);
    const window = waitWindows.get(windowKey);
    const observation = {
        taskId,
        memberName: record.memberName,
        attemptId,
        startedAt: window?.startedAt ?? record.startedAt,
        /** ★ 本次求值的时钟读数 —— 判据**绝不**自己读 `Date.now()`（契约 §2 性质 1）。 */
        now,
        ...record.lastActivityAt === undefined ? {} : { lastActivityAt: record.lastActivityAt },
        /**
         * ★ `previousPollAt` 取自**窗口**：它说的是"这一个任务这一次等待上一次被探活
         *   是何时"，与"这一代 attempt 是什么时候被创建的"无关。换代不重置它。
         */
        ...window?.lastPollAt === undefined ? {} : { previousPollAt: window.lastPollAt },
        /**
         * ── ★ V3-3 / V3-1 的另一半：上一次探活**读到的**活动时刻 ──────────────────
         *
         * MEASURED（2026-10-06，verifier3 / t3）：这个字段**从来没有被交出去过** ——
         * `WaitRecord` 里根本没有存它。于是判据的"卡死"那一条**永远算不出来**：
         * 它拿到 `previousPollAt`（知道"这不是第一次探活"），却拿不到"上一次它读到
         * 的活动时刻是哪个"，于是只能报 `unmeasured`
         * （"this is the second liveness probe … the last activity reading of the
         * previous probe is missing"）。
         *
         * ⇒ 这正是本队那个形态的又一次出现：**判据接进来了，而它需要的输入没接。**
         *   判据那侧写得没错 —— 它按契约拒绝了"没法比较"的那一格。
         *
         * ★ 时序：**先**把本次读到的东西放进观察，**再**推进 `lastPollAt` 与
         *   `lastPolledActivityAt`。反过来的话，第一次探活就会把"这一次的读数"
         *   冒充成"上一次的读数"，于是两次探活永远相等 ⇒ **每一次探活都报卡死**
         *   （假警报，而且是 100% 命中的那种）。
         */
        ...window?.lastPolledActivityAt === undefined ? {} : { previousLastActivityAt: window.lastPolledActivityAt },
    };
    /**
     * ★ 交接之后才推进 `lastPollAt`（而不是读之前）：两次读之间若发生异常，
     *   "上一次探活"必须仍然是**真的发生过**的那一次。
     *
     * ★ `lastPolledActivityAt` 记的是**这一次探活读到的活动时刻**（可能就是
     *   `undefined`：那一刻还没观察到产出）。它下一次会作为 `previousLastActivityAt`
     *   交出去，而判据拿它做两端比较 —— 那正是"这两次之间它动过没有"的全部依据。
     *
     * ── ★ V3-2 的最后一环：探活戳必须能【跨代延续】，且【刚出生】的那一代不许被戳 ──
     *
     * MEASURED（2026-10-06，继承 `startedAt` 与读数之后仍然不报警）：
     * `agent_teams_status` 在**同一次调用**里先派发、后求值。换代产生的新记录紧接着
     * 被这一次求值戳上 `lastPollAt = now` ⇒ 下一次探活读到 `previousPollAt === 自己
     * 的 now` ⇒ `observed_span_ms = 0` ⇒ 间隔永远"没走完" ⇒ **探活永远不报警**。
     * 而若改成"第一次交接一律不写戳"，换代又会让**每一代**都是第一次 ⇒ 同样不报警。
     *
     * ⇒ 正确的不变量是：**戳属于【这一次等待】，不属于某一代 attempt。**
     *   换代时它随 `startedAt` 一起被继承（见 `recordDispatchStart`），
     *   于是新一代一出生就带着"上一次探活发生在 T"这个真实读数；
     *   而**只有真的被交接过的**记录才会把戳推进到 `now`。
     *
     * ★ 三条互斥的情形，各自的行为都要能断言：
     *   · 记录带着继承来的戳 ⇒ 推进到 `now`（这一次比较真的发生了）；
     *   · 记录带着自己的旧戳   ⇒ 推进到 `now`（同上）；
     *   · 记录**没有**戳（首次交接）⇒ 不写 ⇒ 下一次它仍报"第一次探活"
     *     （判据报"没有可比对象"是**诚实**的，比一个"就是此刻"的假戳好得多）。
     */
    /**
     * ★★ V3-2 收口：**刚在一次调用里出生的记录，不由这一次调用写探活戳**。
     *
     * MEASURED（2026-10-06）：`agent_teams_status` 的同一次调用里，kickTeam 先换代、
     * 求值后发生。换代产生的新记录被**同一次**求值戳上 `lastPollAt = now` ⇒ 下一次
     * 探活读到 `previousPollAt === 自己的 now` ⇒ `observed_span_ms = 0` ⇒ 那一次
     * 探活**不比**（报 `ok`），报警整整迟到一次探活。
     *
     * ⇒ 规则：**戳属于"这一次等待"，而一次等待的第一次交接不算"上一次探活"。**
     *   新一代继承上一代的戳（见 `recordDispatchStart`），于是它一出生就带着
     *   "上一次探活发生在 T"；而**这一次**调用对它只做交接、不推进戳 ——
     *   因为这个戳说的是"上一代被探活的时刻"，不是"现在"。
     *
     * ★ 与"第一次探活"不同形：真·第一次交接时 `lastPollAt` 本来就缺席，
     *   判据报"没有可比对象"（诚实）；而这里传承的是**真实发生过的那一次探活**。
     */
    /**
     * ★ 探活戳推进在**窗口**上（跨代的那一份），记录上的那份只是镜像、供诊断。
     *   于是"这一次探活"与"上一代 attempt"彻底解耦 —— 换代不再可能把戳重置。
     */
    if (window !== undefined) {
        /**
         * ★★ 关键一位：刚认领的窗口**这一次不算"上一次探活"**。
         *
         * MEASURED：`status` 在同一次调用里先 kickTeam（认领窗口）再求值（探活）。
         * 若这一次就把 `lastPollAt` 写成 `now`，那么下一次探活读到的
         * `previousPollAt === 自己的 now` ⇒ `observed_span = 0` ⇒ 那一次不比
         * ⇒ 报警迟到一次探活。
         *
         * ⇒ 规则：**窗口的第一次交接是"开工"，不是"探活"。** 认领时只在
         *   `lastPollAt` 仍缺席的情况下**保持缺席**（`touchedAt` 照常续命，
         *   那是"窗口还活着"的证据，与"上次何时探活"不同形）。
         *   于是：认领之后的第一探报"第一次探活"（诚实），第二探开始才真的比较。
         */
        /**
         * ★★ 只有**探活事件**才推进窗口的探活戳 ─────────────────────────────────────
         *
         * MEASURED（2026-10-06，把窗口做成一等对象之后的一次实测，逐次调用读出来的）：
         * ```
         * status#2 的两次求值：member-dispatched ⇒ prevPoll=1600000  ← 对
         *                      task-status       ⇒ prevPoll=2200000  ← 错：被上一次求值吃掉了
         * ```
         * ⇒ `member-dispatched`（换代那一刻）**不**是一次探活，而它在那次调用里**先**
         *   跑；若它推进了戳，紧接着的 `task-status` 就只能读到"刚刚"，span=0，
         *   **判据那一次不比较** ⇒ 报警迟到一次探活。
         *
         * ⇒ 规则：**戳只由"问了一句'还活着吗'"的那次求值推进。** 换代不是探活，
         *   `task-created` / `task-update` 也不是。哪些事件算，由**导出白名单**
         *   决定（与判据侧的 `LIVENESS_EVENTS` 同一份成员），判据层与调用方不会再各说各话。
         */
        /**
         * ★ 探活事件**总是**推进窗口的探活戳。
         *
         * MEASURED（2026-10-06，最后一位）：我在这里加过一条"第一次交接不算探活"的
         * 守卫，结果是窗口永远拿不到 `lastPollAt` 的基线 —— status#1 只写下了
         * `lastPolledActivityAt`，于是 status#2 读到的 `previousPollAt` 缺席
         * ⇒ 判据把它读成"第一次探活"⇒ **比对根本不发生**。
         *
         * ⇒ 正确的不变量只有两条，各自都在别处钉住：
         *   ① **换代不推进戳**（`isProbe` 过滤掉 `member-dispatched` 等）；
         *   ② **认领时不覆盖戳**（`recordDispatchStart` 从 `existing` 继承，
         *      而不是从 `now` 新建）。
         *   有了 ②，这里就**必须**老老实实每次都推进 —— 否则基线永远不存在。
         */
        const isProbe = PROBE_EVENTS.includes(event);
        /**
         * ── ★★ 读到的读数取【换代前那一代】的，不是这一代的 ─────────────────────────
         *
         * MEASURED（2026-10-06，最后一位）：换代在同一次调用里生成一条**新记录**，
         * 它的 `lastActivityAt` 是"派发那一刻观察到的"（很可能就是 `now`）。
         * 若把这一代的值写进 `lastPolledActivityAt`，下一次探活读到的
         * `previousLastActivityAt` 就变成"上次也是刚动过" ⇒ **比较永远相等**
         * ⇒ 静默成员永不报警（或只在第三次才报，取决于换代次数）。
         *
         * ⇒ 探活要交出去的"上一次它读到什么"，只能是**这一次探活真正读到的那个值** ——
         *   而"这一次读到的"在换代口径下就是**新记录的 `lastActivityAt`**，
         *   它恰恰是"我们最后一次看见它说话"（不论哪一代记的）。
         *   所以这里取的是 `record.lastActivityAt`，但**判据那一侧**必须拿它跟
         *   `previousLastActivityAt` 比 —— 而后者记的是**上一次探活时的同一个量**。
         *   两者是同一口径，比较才成立。
         */
        putWaitWindow(windowKey, {
            ...window,
            ...isProbe ? { lastPollAt: now } : {},
            touchedAt: isProbe ? now : window.touchedAt,
            ...isProbe && record.lastActivityAt !== undefined ? { lastPolledActivityAt: record.lastActivityAt } : {},
        });
    }
    /**
     * ★ 记录上的那份只是**镜像**（供诊断），它同样只由探活事件推进 ——
     *   否则 `member-dispatched` 会在同一次调用里先把这一位推到 now，
     *   而紧接着的 `task-status` 正是要拿它当"上一次探活"来比较。
     */
    putWaitRecord({
        ...record,
        ...PROBE_EVENTS.includes(event) ? { lastPollAt: now } : {},
        ...PROBE_EVENTS.includes(event) && record.lastActivityAt !== undefined
            ? { lastPolledActivityAt: record.lastActivityAt }
            : {},
    });
    return observation;
}
export function auditGateRequires(point, context) {
    /**
     * ★ 判据的形状从哪来：`gateModuleViews()` —— 而它的**唯一真值来源是注册表**
     *   （`registry.list()`），顺序 = 注册顺序。
     *
     * ★★ 不是在这里再写一份清单，也不是去读装配点的静态 `ALL_GATES`
     *   —— MEASURED（t10 第一版就写错了）：`ALL_GATES` 只有**装配时**那 11 条，
     *   运行期 `registry.register(...)` 加进来的判据（夹具探针、以及任何后来的
     *   插件）在核对层里**根本不存在** ⇒ 核对报出的是一份**关于别的判据**的结论，
     *   而它读起来完全正常（`incomplete: 0`，一切齐整）。
     *
     *   ⇒ 这是本任务要消灭的那个形状的另一种写法：**两份真相**。一份"谁需要哪些格"
     *     的表只能有一条来路，而它是注册表。
     *   ⇒ 顺带保证 `requires.checks` 与求值结果的 `ran[]` 按 id 一一对得上。
     */
    const subjects = gateModuleViews()
        .filter((module) => module.point === point)
        .map((module) => ({
        id: module.id,
        /**
         * ★ `requires` 与 `hasRequires` 是两件事（注册表的同一条纪律）：
         *   没声明 ⇒ 留 `undefined`（审计层给 `undeclared`，那是**没声明**的读数）；
         *   声明了空数组 ⇒ 交空数组（审计层给"核对过、不需要任何一格"）。
         *   合成 `?? []` 会让"没声明"伪装成"声明过、且不需要任何东西"，
         *   于是输入面接线覆盖率的读数会虚高 —— 而虚高正是本轮要消灭的那件事。
         */
        ...module.hasRequires ? { requires: module.requires ?? [] } : {},
        /**
         * ★ 适不适用由**判据自己的** `appliesTo` 回答，与注册表求值时调的是
         *   同一个函数引用（`registry.list()` 在 t10 起交出的就是那个函数本身）。
         *   核对层不许另建一套口径（那会让"注册表跳过了它、核对却报了缺失"
         *   这种自相矛盾的结论出现 —— 而它在日志里与正常情形同形）。
         */
        ...module.appliesTo === undefined ? {} : { appliesTo: module.appliesTo },
    }));
    return auditRequires(subjects, context);
}
export function inputSurfaceSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            checked: { type: 'number' },
            incomplete: { type: 'number' },
            skipped: { type: 'number' },
            missing: { type: 'array', items: { type: 'string' } },
        },
    };
}
export function runtimeGatesSchema() {
    /**
     * ★★ 为什么是 `{ type: 'json' }` 而不是 `{ type: 'object', … }`（船长实测过，我复现了）──
     *
     * `evaluateRuntimeGates` 的返回类型是 `JsonValue | undefined` —— 那一格里的东西
     * **不属于本文件**（它是判据注册表的裁决形状）。写成 `{ type: 'object',
     * additionalProperties: true }` 会让 TS 在这里推出另一个不兼容的类型，
     * 于是 33 条 TS2322 里又多一条 `TS2719: Two different types with this name exist`。
     *
     * ⇒ dsh-tools 为这种"这一格是任意 JSON"提供了一个专门的 spec：`{ type: 'json' }`
     *   （见 `JsonValueSchemaSpec`）。它既表达了"这一格是别人家的"，
     *   又与 `JsonValue` 的推断逐字一致。
     */
    return { type: 'json' };
}
export function diagnosticFields(which) {
    return {
        ...which.inputSurface === true ? { input_surface: inputSurfaceSchema() } : {},
        ...which.runtimeGates === true ? { runtime_gates: runtimeGatesSchema() } : {},
        ...which.dispatchInputSurface === true ? { dispatch_input_surface: inputSurfaceSchema() } : {},
        ...which.completionInputSurface === true ? { completion_input_surface: inputSurfaceSchema() } : {},
    };
}
export function inputSurfaceOf(point, context) {
    /**
     * ★ 有判据才挂：`checked + skipped === 0` ⇒ 这个位置这一轮**没有判据**
     *   （空位置，或者注册表里一条都没有）⇒ 字段不出现（三态里的第三种）。
     *
     * ★ 为什么不拿 `incomplete > 0` 当"挂不挂"的条件：那正好退回本任务要消灭的形态
     *   ——「没挂」与「有判据且都齐」在返回值上同形。**这一行是本任务的中心。**
     */
    const audit = auditGateRequires(point, context);
    if (audit.checked + audit.skipped === 0)
        return undefined;
    return {
        checked: audit.checked,
        incomplete: audit.incomplete,
        skipped: audit.skipped,
        missing: audit.missing,
    };
}
export function toReplayableSnapshot(value, depth = 0, seen = new WeakSet()) {
    if (value === null)
        return null;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean')
        return value;
    /** ★ `undefined` / 函数 / symbol **显式**标出来，而不是让它们消失。 */
    if (type === 'undefined')
        return { __absent: 'undefined' };
    if (type === 'function')
        return { __absent: 'function' };
    if (type === 'symbol')
        return { __absent: 'symbol' };
    if (type === 'bigint')
        return { __absent: 'bigint', value: String(value) };
    if (depth > 8)
        return { __truncated: 'depth>8' };
    const object = value;
    if (seen.has(object))
        return { __truncated: 'circular' };
    seen.add(object);
    if (Array.isArray(value))
        return value.map((item) => toReplayableSnapshot(item, depth + 1, seen));
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        out[key] = toReplayableSnapshot(item, depth + 1, seen);
    }
    return out;
}
export function sessionEventRefs(session) {
    if (session === null || typeof session !== 'object')
        return undefined;
    const header = session.header;
    const sessionId = typeof header?.id === 'string' ? header.id
        : typeof header?.sessionId === 'string' ? header.sessionId : undefined;
    let events;
    try {
        events = sessionOwnEvents(session);
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(events))
        return undefined;
    const eventIndices = [];
    events.forEach((event, index) => {
        if (event === null || typeof event !== 'object')
            return;
        const record = event;
        if (record.type === 'tool/result' || record.kind === 'tool/result')
            eventIndices.push(index);
    });
    /**
     * ── ★★ 一条事件都没有 ⇒ 【没能定位】，不是"定位到空" ────────────────────────
     *
     * MEASURED（本臂第一版）：这里原先直接返回 `{ eventIndices: [] }`，于是
     * `index.replayable` 被算成 `true` —— 而那条记录**指不到任何事件**
     * ⇒ 它声称可重放，实际拿不出当时的原始观测。
     *
     * ★ 形态：**空数组被当成了"定位成功"**。这与 README 第一条纪律直接冲突
     *   （记录要"可重放"），也与本队记了多次的那条同源：**"没有"与"空的"不同形**。
     *   一个空定位与"我没能读会话"在读取端必须不同形 —— 前者是"那一轮没有工具结果"，
     *   后者是"我压根没读到会话"，而后者才是要去看一眼的信号。
     */
    if (eventIndices.length === 0)
        return undefined;
    return { ...sessionId === undefined ? {} : { sessionId }, eventIndices };
}
export async function recordFriction(capture) {
    /**
     * ── ★★ 为什么 `stateRoot` 必须由调用方【显式传入】（t22 实测出来的缺陷）───────
     *
     * 第一版复用了 `STATE_DIR_FOR_BASE_PERSIST`（一个**进程级单值**，= cwd + stateDir）。
     * 而 `stateRoot` 是**每个团队各自的**（`workspaceOf(caller)` + stateDir）。
     * ⇒ 实测后果：夹具与成员各自的临时工作区里发生的卡点，**全部被写进了主树那份
     *   团队真台账** —— 一次夹具跑动就往真台账里塞 6 条假卡点，而它们在读取端
     *   与真卡点**同形**（只有 `scene.team` 是占位名才勉强看得出）。
     *
     * ★ 形态与 f-0022 同源：「夹具造出的东西与产品造出的东西在返回值上同形」——
     *   只不过这里是**写进同一个文件**。而台账是"记录"，记录被污染之后
     *   **不可重算**（README 第一条纪律：原始现象丢了就完了）。
     *
     * ⇒ 修法：`stateRoot` 由调用方传入（它手里本来就有）。**没有它就不记** ——
     *   记到别处比不记更坏。
     */
    const root = capture.stateRoot;
    if (root === undefined || root === '')
        return undefined;
    try {
        const { mkdir, readdir, writeFile } = await import('node:fs/promises');
        const frictionDir = join(root, 'frictions');
        await mkdir(frictionDir, { recursive: true });
        /**
         * ★ id 必须**单调且不与既有撞车**：读目录取现有最大编号 +1。
         *   用时间戳当 id 会让"同一秒内的两条"撞车，而撞车后一条覆盖另一条 ——
         *   被覆盖掉的卡点与"没发生过"在台账里同形。
         */
        let max = 0;
        try {
            for (const name of await readdir(frictionDir)) {
                const matched = /^f-(\d+)\.json$/.exec(name);
                if (matched === null)
                    continue;
                max = Math.max(max, Number(matched[1]));
            }
        }
        catch {
            /** 目录刚建 ⇒ 从 1 开始。 */
        }
        const id = `f-${String(max + 1).padStart(4, '0')}`;
        const refs = sessionEventRefs(capture.session);
        const record = {
            id,
            at: new Date().toISOString(),
            project: 'agent-teams-dev',
            title: capture.message,
            scene: {
                team: capture.teamId ?? '(unknown)',
                task: capture.taskId ?? '(unknown)',
                trigger: { tool: capture.tool ?? '(unknown)', args: {} },
                /** ① ★ 当时的 ctx 快照 —— 这一格就是"事后补不上"的那一格。 */
                ctx: toReplayableSnapshot(capture.context),
            },
            observed: {
                verdict: { ok: false, note: capture.message },
                /** ③ ★ 机制状态：输入面核对结论 + 判据裁决。 */
                mechanismState: toReplayableSnapshot(capture.mechanismState),
                ...capture.couldNotObserve === undefined ? {} : { couldNotObserve: [...capture.couldNotObserve] },
            },
            expected: {},
            context: {
                revisions: {},
                /** ② ★ 事件定位：会话 id + `tool/result` 的序号。 */
                eventRefs: refs === undefined
                    ? ['(session events were not readable at capture time)']
                    : [`session ${refs.sessionId ?? '(unknown)'}: tool/result at event indices ${refs.eventIndices.join(', ')}`],
            },
            /**
             * ★ `unknown` 是"让「没记」与「没发生」不同形"的那一格。
             *   拿不到的东西**必须写在这里**，而不是留空 —— 留空会在读取端读成"当时没有"。
             */
            unknown: [
                ...refs === undefined ? ['session events were not readable, so the original observation cannot be located'] : [],
                'the full list of "sufficient context" is still unknown (f-0014)',
            ],
            index: {
                component: capture.point,
                kind: ['unwired'],
                kindNone: false,
                /** ★ 只有拿到事件定位才算可重放 —— 不假装。 */
                replayable: refs !== undefined,
            },
            /**
             * ── ★★ 部署状态：这条卡点是在【什么 build】上发生的（t23）─────────────────
             *
             * MEASURED（本轮五次拦截）：本队被"进程持有旧模块"拦了 5 次，而每一次的
             * **表面理由都不同**（"你虚报改动" / "基准不可得" / "依赖未满足"）——
             * 一个机制级的失效，伪装成一条业务规则。
             *
             * ⇒ 每条卡点都带上"当时的 build 对不对得上盘"，于是**下一次**读台账的人
             *   一眼能看出"这条是不是在旧 build 上发生的"，而不是重新误诊一轮。
             * ★ 它**不参与裁决**（部署状态的读数），只是记录里的一格。
             */
            deployment: {
                moduleFreshness: capture.moduleFreshness ?? moduleFreshness(),
            },
            resolution: { blocking: false, fix: 'unfixed: recorded at the moment it happened, per f-0014', pool: 'self' },
        };
        await writeFile(join(frictionDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        return id;
    }
    catch {
        /** ★ 记不下 ⇒ `undefined`（不是"没有卡点"）。 */
        return undefined;
    }
}
export async function evaluateRuntimeGates(ctx, event, context, clock = Date.now) {
    if (registry.count('runtime') === 0)
        return undefined;
    const source = context;
    /**
     * ── ★ 输入面注入：六个调用点**共用**这一个构造点 ────────────────────────────
     *
     * 探活判据要问"这个成员等了多久 / 还在动吗"。这两个观察由本模块的等待记录表
     * （见 {@link waitObservationFor}）持有，而不是由每个调用点各自拼 ——
     * 四处拼同一个东西，就是四处会慢慢分叉的地方，而它们在日志里同形。
     *
     * ★★ 读不到 ⇒ `wait` **整个字段缺席**，绝不是 `{}` 或半份观察。
     *   这是 t5 验收里那句"读不到时不得伪造 —— 不注入，让判据自己报 unmeasured"。
     *   判据已经声明：`startedAt` / `now` 缺席 ⇒ unmeasured（不是 ok）。
     *
     * ★ 哪些事件带 `wait`：凡上下文里有 `team` + `task`（＝"这一步是关于某个具体
     *   任务的"）的，都能对上一条等待记录。`member-dispatched` 用的是回调 payload
     *   （没有嵌套的 `team`），所以它走下面那一支。
     */
    const teamId = source.team?.id
        /**
         * ★ `member-dispatched` 这一支：调度器的回调 payload **不是**嵌套的
         *   `{team, task}` 形状，它就是 `{teamId, taskId, attemptId, …}` 本身。
         *   两个形状都要认 —— 否则派发那一刻（**探活的起点**）反而是唯一读不到
         *   等待观察的调用点，而它正是最需要的那个。
         */
        ?? (typeof source.teamId === 'string' ? source.teamId : undefined);
    const taskId = typeof source.task?.id === 'string'
        ? source.task.id
        : typeof source.taskId === 'string' ? source.taskId : undefined;
    const attemptId = typeof source.task?.attemptId === 'string'
        ? source.task.attemptId
        : typeof source.attemptId === 'string' ? source.attemptId : undefined;
    /**
     * ★ 成员名也要取到：窗口的键含它（换成员 = 另一次等待，见 {@link waitWindowKey}），
     *   而取错了键会让判据去读**另一个人的**窗口。两个形状都要认（与 teamId 同）。
     */
    const memberName = typeof source.task?.assignee === 'string'
        ? source.task.assignee
        : typeof source.memberName === 'string' ? source.memberName : undefined;
    const wait = typeof teamId === 'string' && typeof taskId === 'string'
        ? waitObservationFor(teamId, taskId, attemptId, clock(), memberName, event)
        : undefined;
    /**
     * ★ 团队级调用点（`task-status` / `delivery-declared`）拿不到单个 task ⇒ 给
     *   `waits`（每个未结束尝试一条）。判据据此能问"这个队里**有谁**卡住了" ——
     *   那是快照与交付时刻真正要问的问题。
     *
     * ★ 只在**上下文里真的有 team 对象**时注入。没有 team（例如一次纯派发事件）
     *   就整个字段缺席 ⇒ 判据 unmeasured，而不是拿到一个空的观察面被误读成
     *   "这个队一个人都没在等"。
     */
    const team = source.team;
    const waits = team !== undefined && typeof team === 'object' && Array.isArray(team.tasks) && typeof team.id === 'string'
        ? teamWaitObservations(team, clock(), event)
        : undefined;
    /**
     * ── ★ 输入面：本入口是**六处** runtime 调用点唯一的求值点，所以核对也在这里 ────
     *
     * → 八处调用点里六处（`member-dispatched` / `task-created` / `task-update` /
     *   `task-update-settled` / `task-status` / `delivery-declared`）经本函数进来，
     *   而 `wait` / `waits` / `event` 三格**只在这里**被注入。⇒ 核对放在这里，
     *   六处调用点核对到的是**同一份**注入结果；放在调用点上会让六处各自拼一遍，
     *   而六处会慢慢分叉、且它们在日志里同形（本任务要消灭的正是这个形状）。
     *
     * ★ 顺序：**注入完成之后、求值之前**。核对读的是**交出去的那份 ctx** ——
     *   先求值再核对会让核对结果依赖判据有没有副作用地补上某一格。
     *
     * ★★ t3：这里改用 {@link inputSurfaceOf} —— 「形状四字段」与「有判据时总是出现」
     *   这两条纪律从此**只有一处实现**，contract / dispatch / completion / delivery
     *   四处照的就是它。写成五份字面量之后，任何一次只改一处的编辑都会让同一个
     *   核对结论在五个出口上分叉，而分叉的两次读数在断言层面同形。
     *   （`undefined` ⇒ 这个事件类型没挂任何 runtime 判据 ⇒ 下面那个字段不出现。）
     */
    const runtimeInputSurface = inputSurfaceOf('runtime', {
        ...source,
        ...wait === undefined ? {} : { wait },
        ...waits === undefined ? {} : { waits },
        event,
    });
    let evaluation;
    try {
        evaluation = await registry.evaluate('runtime', {
            ...source,
            ...wait === undefined ? {} : { wait },
            ...waits === undefined ? {} : { waits },
            event,
        });
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.logger.warn(`agent-teams: the runtime gate threw on "${event}" (recorded, not thrown at the caller): ${reason}`);
        judgeRuntimeGates('runtime gate threw', reason);
        return { ok: false, threw: reason };
    }
    /**
     * ★ 输入面缺格 ⇒ **只记录、不拒绝**（先软后硬 + 契约 §5 的双保险）。
     *   runtime 位置本来就不得拒绝任务，所以这里连"要不要拒"这个问题都不存在。
     *   措辞与"runtime 判据抛错"、"判据 unmeasured"**三者互不同形** —— 读日志的人
     *   要能一眼分出"调用方没接这一格"与"判据测不了"。
     */
    if (runtimeInputSurface !== undefined && runtimeInputSurface.incomplete > 0) {
        ctx.logger.warn(`agent-teams: the runtime gate on "${event}" has an unfinished input surface (recorded, not rejected): ${runtimeInputSurface.missing.join('; ')}`);
    }
    /**
     * ── ★★★ t66：运行记录必须能分出**三态**，而不是两态 ────────────────────────────
     *
     * MEASURED（t64 实测命中，2026-10-08）：
     *
     *     `evaluate('runtime', { event: 'task-created' })`
     *       ⇒ `{ ok: false, evaluated: 0, registered: 1, skippedAll: true }`
     *       （该位置挂着 1 条判据，而这一轮它被自己的 `appliesTo` 跳过）
     *
     *   而**旧的那两态映射**把它读成：
     *
     *     `ok === false` 且 `unmeasured === undefined` ⇒ `blocked: ${blockers.join('; ')}`
     *     ⇒ 因为 `blockers` 是**空数组**，记录里写出的是 **`"blocked: "`（后面什么都没有）**
     *
     *   ⇒ ★ **一个【没被检查】的步骤，在运行记录里读起来像【发现了一个 blocker】。**
     *     而这正是 t58 的副作用（全跳过现在是 `ok:false`），也是 t64 在**调用点**消灭的
     *     同一个合流 —— 只是换成了**运行记录**这个出口。
     *     一个空的 `blocked:` 是**没有对象的指控**：它说"有问题"，而"问题"那一栏是空的。
     *
     * ── 三态（本队纪律：三者必须都能从记录里读出来）─────────────────────────────
     *
     *     ① 没被检查（`ok:false` + `skippedAll`）      ⇒ **`notChecked: …`**
     *     ② 检查了而没发现 blocker（`ok:true`）          ⇒ `ok` / `ok (nothing evaluated: …)`
     *     ③ 检查了而发现 blocker（`blockers` 非空）      ⇒ `blocked: <原文>`
     *     另有：`unmeasured`（判据跑了、说它测不了）     ⇒ `unmeasured: <原文>`（既有语义不变）
     *
     * ★ 判据用 `skippedAll` 而不是 `evaluated === 0`：后者在**空位置**
     *   （`registered === 0`）上也成立 —— 而那是"这里本来就没有判据"，是正常情形。
     *   `skippedAll` 是注册表**显式**产出的那个说明（"这一步没被检查"）。
     *   ⇒ 与 t64 在三个调用点上用的是**同一条口径**（那条一致性是刻意的：
     *     同一个事实在两个出口上必须用同一个判据，否则它们会分叉）。
     *
     * ★ 顺序也是刻意的：`unmeasured` 排在 `skippedAll` **之前**。
     *   `unmeasured` 意味着判据**跑了**（`evaluated >= 1`），而 `skippedAll` 意味着
     *   一条都没跑 —— 两者不可能同时为真，但把更强的那个放前面能让"万一同时出现"
     *   读成"判据测不了"（关于测量的结论）而不是"这一步没被检查"。
     */
    const outcome = evaluation.ok === false
        ? evaluation.unmeasured !== undefined
            ? `unmeasured: ${evaluation.unmeasured}`
            : evaluation.skippedAll !== undefined
                ? `notChecked: ${evaluation.skippedAll}`
                : `blocked: ${evaluation.blockers.join('; ')}`
        : evaluation.evaluated === 0 ? `ok (nothing evaluated: ${evaluation.registered} registered, all skipped)` : 'ok';
    judgeRuntimeGates(event, outcome);
    /**
     * ── ★ 核对结论【随记录一起交出去】（`input_surface`）──────────────────────────
     *
     * ★ 为什么必须有一个可读的出口，而不是只写日志：本队对"观察"的纪律是
     *   **读得出来才算数**。一个只进日志的核对结论会在"日志没开/被截断"时与
     *   "输入面是齐的"同形 —— 而那正是本轮要消灭的形状。
     * ★ 它与 `requires`（注册表自己那份）**不同源、互相印证**：注册表在求值中
     *   核对的是它内部那份 ctx；这里是调用方在**注入完成的那一刻**核对的。
     *   两者都在场时，"同一个缺格被两条路径分别报出来"才说明接线真的通了。
     *
     * ★★ t3：这里改读 {@link inputSurfaceOf} 的那一份（与另外四处同一个构造点）。
     *   形状仍是 `{checked, incomplete, skipped, missing}` —— 可机械比对意味着
     *   **连来源也是同一个**，而不只是五个字面量今天恰好写得一样。
     *
     * ★ 它**只在有判据时**出现（`runtimeInputSurface === undefined` ⇒ 字段不出现）。
     *   三态：都齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/ 这个事件没挂判据
     *   （字段缺席）。第三种**不是** `ok`。
     */
    return {
        ...evaluation,
        ...runtimeInputSurface === undefined ? {} : { input_surface: runtimeInputSurface },
        outcome,
    };
}
export async function rejectOnContractGates(ctx, context, what, 
/** ★ t22：这个团队自己的 stateRoot（台账落点）。**不许用进程级单值**，见 recordFriction。 */
stateRoot, inject = {}) {
    /**
     * ★ 输入面核对（t10）：**求值之前**，按每条判据声明的 `requires` 核对这份真实 ctx。
     *   ★ 它是**旁路数据**：下面的拒绝逻辑一个字都不看它 —— 核对报缺时流程照常走完
     *   （先软后硬）。理由与「为什么不能先求值再核对」见 {@link auditGateRequires}。
     *
     * ★ t3：改读 {@link inputSurfaceOf}（与 runtime / dispatch / completion / delivery
     *   同一个构造点），于是"形状四字段 + 有判据时总是出现"只有一处实现。
     */
    const inputSurface = inputSurfaceOf('contract', { ...context, ...inject });
    const gates = await registry.evaluate('contract', { ...context, ...inject });
    if (gates.ok === false) {
        /**
         * ── ★★ 卡点发生时【当场记账】（t22 / f-0014）────────────────────────────────
         *
         * 三条信息只有在**此刻**可得：判据读到的 ctx、这一轮的输入面核对结论、
         * 判据的完整裁决。事后补的三样材料（任务 output / git 历史 / 会话事件）
         * 都拿不回它们 ⇒ 必须在这里落。
         *
         * ★ 它**不改裁决**：记录是旁路动作，失败只写一条 warn。
         *   与 `inputSurfaceOf` 同一条纪律（先软后硬：核对与记录都不参与裁决）。
         * ★ 用 `void … .then(warn)`：拒绝路径**必须**立刻抛出去，
         *   不许因为"写台账慢"而把一次判据拒绝变成一次等待（那会改变可观测的时序）。
         */
        const frictionMessage = gates.unmeasured !== undefined
            ? `${what} rejected: the contract gate could not measure (${gates.unmeasured})`
            : `${what} rejected: ${gates.blockers.join('; ')}`;
        void recordFriction({
            stateRoot,
            point: 'contract',
            message: frictionMessage,
            context: { ...context, ...inject },
            mechanismState: { inputSurface, gates },
            taskId: typeof context.task?.id === 'string'
                ? context.task.id : undefined,
            tool: what,
            ...gates.unmeasured === undefined ? {} : { couldNotObserve: [String(gates.unmeasured)] },
        }).then((id) => {
            if (id === undefined)
                ctx.logger.warn(`agent-teams: could not record the friction at the contract gate (${frictionMessage})`);
        });
        throwWithSurface(frictionMessage, inputSurface);
    }
    /**
     * ★ 与 completion 位置同一条纪律（t13）：有判据却一条都没跑 ⇒ 只告警、不拒绝。
     *   拒绝会把"这个位置这一轮没有适用判据"（正常情形）变成流程卡死。
     */
    if (gates.evaluated === 0 && gates.registered > 0) {
        ctx.logger.warn(`agent-teams: ${what} reached the contract gate with no gate evaluated (${gates.registered} registered, all skipped); the contract was not checked`);
    }
    /**
     * ── ★ 输入面：缺格时**只说、不拒**（先软后硬）────────────────────────────────
     *
     * MEASURED（2026-10-05 复盘）：本仓库五次同形缺陷里，**四次**是"判据要的那一格
     * ctx 没接上"（inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配），
     * 而它们在日志里与"这一步没问题"同形。⇒ 这里把核对结论**说出来**，且说得
     * 与判据自己的 `unmeasured` 措辞**不同形**：那是"判据测不了"，这是
     * "**调用方没把这一格交出去**"。
     *
     * ★ 为什么不并进上面那个分支：它会改裁决，而用户已经裁定"先软后硬"。一个
     *   自己还没被验证过的新机制当场否决别人的任务，正是本队反复踩的形态。
     *
     * ★★ t3：这条日志**保留**（它是给人看的）。它**不是**结构化出口的替代 ——
     *   上面那个返回值才是"模型与控制台读得到"的那一份，两者并存。
     */
    if (inputSurface !== undefined && inputSurface.incomplete > 0) {
        ctx.logger.warn(`agent-teams: ${what} reached the contract gate with an unfinished input surface (recorded, not rejected): ${inputSurface.missing.join('; ')}`);
    }
    return inputSurface === undefined ? undefined : { input_surface: inputSurface };
}
export function throwWithSurface(message, surface, 
/**
 * ★★ 这一次拒绝属于**哪个位置** —— 决定结论在工具结果上落到**哪个字段名**（t4 修）。
 *
 * MEASURED（2026-10-06，verifier5 的臂 1/7 复跑时暴露）：
 *   成功路径上，一次 `update_task` 的两个位置**各挂各的**
 *   （`dispatch_input_surface` / `completion_input_surface`）—— 那是刻意的，
 *   因为"哪一个位置缺哪一格"必须读得出来。
 *   而**拒绝路径**当时只有一格泛用的 `input_surface` ⇒ 同一个位置在两条路径上
 *   **字段名不同形**。读者按位置的名字去找（`dispatch_input_surface`）会读不到，
 *   而"读不到"与"这个位置没判据"在断言层面同形 —— 正是本任务要消灭的那件事。
 *
 * ⇒ 现在拒绝也带位置：`dispatch` ⇒ `dispatch_input_surface`，`completion` ⇒
 *   `completion_input_surface`，其余位置（contract / delivery 各只有一个入口）
 *   仍用泛用的 `input_surface`（与它们成功路径上的字段名一致）。
 */
field = 'input_surface') {
    /**
     * ── ★★ 把"本进程持有的构建 vs 盘上"**附到拒绝的那句话里**（t37 / f-0027 的预防）──
     *
     * ── 它防的是什么（captain 今天的两次实测错误）────────────────────────────────
     *
     *     ① 他两次**用命令行**去读插件进程的状态 —— 读到的都是**命令行那个进程**
     *     ② 而**成员**连位置都没有：读数不存在，或指向别处
     *
     * ★ 这两件事是**同一格的两种表现**：那个读数不属于"我"，而它读起来却像是属于我的。
     *
     * ── 为什么修法是"把读数放在现场"，而不是"提醒人小心"──────────────────────────
     *
     * 提醒是一条**靠人执行**的规则，而本项目已反复证明这类规则会腐烂。
     * 让错的那条路走不通的形态是：**成员撞上拦截的那一刻**，错误信息当场告诉它
     * "你正在依据的这个进程，持有的构建与盘上是否一致" —— 于是它**不需要去别处读**，
     * 也就不会读错位置。
     *
     * ★ 这与 f-0028（t33 报的那条）是同一件事的**正面版本**：
     *   "一个读数（exitCode 0）在它分辨不了的地方被当成了结论" —— 那里的毛病是
     *   **读数与结论隔得太远**；这里把有资格的读数**挪到结论旁边**。
     *
     * ── ★ 三态在这句话里也必须分形（与 `moduleFreshnessMessage` 同一套措辞）──────
     *
     *     current  ⇒ "this process holds the current build"（可省略，但明说更省事）
     *     stale    ⇒ **必须说**，且指向动作（reload）
     *     unknown  ⇒ **不得**说成 current —— 它是"没能测量"，不是"是新的"
     *
     * ★ 措辞一律用 `moduleFreshnessMessage()`（**不在这里另写一份**）：两处各写一遍
     *   就会分叉，而分叉之后"同一件事有两句话"在下游同形 —— 本队记账过的形态。
     *
     * ── ★ 它【不参与裁决】（先软后硬）─────────────────────────────────────────────
     *
     * 这一行**只是** `message` 的追加：`throwWithSurface` 抛的仍然是一条拒绝，
     *   拒绝的**理由**与措辞一个字节没变，`instanceof Error` 与 `name` 也没变。
     *   ★ 换句话说：**去掉这一行，没有任何一处裁决会翻面**（夹具臂 9 钉住它）。
     */
    const error = new Error(`${message}\n${freshnessLine()}`);
    /**
     * ★ 有判据才挂：`undefined` ⇒ 这个位置这一轮没有挂判据 ⇒ 属性不出现
     *   （三态里的第三种）。挂一个 `undefined` 属性会让"没判据"与"有判据"在
     *   `Object.hasOwn` 这一层同形。
     */
    if (surface !== undefined) {
        Object.defineProperty(error, INPUT_SURFACE_PROPERTY, {
            value: surface,
            /** 可枚举：它是一条**结论数据**，不是内部实现细节（宿主/夹具可以直接看见它）。 */
            enumerable: true,
            writable: false,
            configurable: false,
        });
        /**
         * ★ 位置名随结论一起走：工具边界据此把结论搬到**同一个**字段名上 ——
         *   于是"同一个位置在成功路径与拒绝路径上长得一样"。
         */
        Object.defineProperty(error, INPUT_SURFACE_FIELD_PROPERTY, {
            value: field,
            enumerable: true,
            writable: false,
            configurable: false,
        });
    }
    throw error;
}
export const INPUT_SURFACE_PROPERTY = 'agentTeamsInputSurface';
export const INPUT_SURFACE_FIELD_PROPERTY = 'agentTeamsInputSurfaceField';
export function inputSurfaceFieldOf(error) {
    if (error === null || typeof error !== 'object')
        return 'input_surface';
    const field = error[INPUT_SURFACE_FIELD_PROPERTY];
    return typeof field === 'string' && field.trim() !== '' ? field : 'input_surface';
}
export function inputSurfaceFromThrown(error) {
    if (error === null || typeof error !== 'object')
        return undefined;
    const carried = error[INPUT_SURFACE_PROPERTY];
    if (carried === null || typeof carried !== 'object')
        return undefined;
    return carried;
}
export function observedSpoke(session) {
    if (session === null || typeof session !== 'object')
        return undefined;
    let events;
    try {
        events = sessionOwnEvents(session);
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(events))
        return undefined;
    const last = [...events].reverse().find((event) => (event !== null && typeof event === 'object'
        && event.type === 'assistant/message'));
    if (last === undefined)
        return undefined;
    const content = last.message?.content;
    if (!Array.isArray(content))
        return undefined;
    return content.some((block) => (block !== null && typeof block === 'object'
        && block.type === 'text'
        && typeof block.text === 'string'
        && block.text.trim() !== ''));
}
export function observeMemberConvergence(ctx, team) {
    const out = [];
    for (const member of team.members) {
        if (member.status === 'removed')
            continue;
        /**
         * ── ★ 未 spawn 的成员：如实交出这条观察，**不**丢掉整个观察面（t16）─────────
         *
         * `member.id === ''` 意味着它**从未起来过**（依赖未满足 / 启动被拒）——
         * 而那是**被设计期望的正常情形**（profile 团队第一步就长这样）。
         *
         * ★ 它不是"没能观察"：`id === ''` 是**这个调用方手上已有的数据**，是一条
         *   **可判定的事实**（"它没起来过"），而不是"我不知道它怎么了"。
         *   把它们合流正是本队那条规则的形态：**「可判定的事实」不得写成「没能测量」**
         *   —— 而 unmeasured 有一条危险的副作用：它让门**永久关闭**。
         *
         * ★ 原写法是 `return undefined`（把整份观察面扔掉）。那不只是"不注入一个成员"，
         *   而是让**整个交付位置**对其他成员也失去观察 —— 只要队里有一个依赖未满足的
         *   成员，交付就永远无法被测量。**同一道门，从判据那边焊到了调用方这边。**
         *
         * ★ 关于"不得改注入语义"：判据定义语义（t15 已让 `never-spawned` 可表达并被判
         *   为不收敛）；这里**只是如实报告一个已有字段**，没有替判据决定它意味着什么 ——
         *   裁决仍是判据给的（blocked），调用方一个 `if` 都不参与。
         */
        if (member.id === '') {
            out.push({
                name: member.name,
                state: 'never-spawned',
                /** 「它为什么没起来」是诊断上下文，不改变裁决（判据那侧同样这么用 `error`）。 */
                ...member.spawnError === undefined ? {} : { error: member.spawnError },
            });
            continue;
        }
        const live = ctx.agents.get(member.id);
        /**
         * ★ 这一支**才是**真的没能观察：成员有会话 id，而 live Agent 拿不到 ——
         *   它可能起来了、也可能已经释放，无从分辨 ⇒ 整份观察面缺席 ⇒ unmeasured。
         */
        if (live === undefined)
            return undefined;
        const spoke = observedSpoke(live.session);
        if (spoke === undefined)
            return undefined;
        out.push({
            name: member.name,
            /**
             * ★ 两个来源分开用，不合流：
             *   · `state` 来自 **live Agent**（它此刻忙不忙）—— 这是可观察的；
             *   · 持久记录 `member.status` **只用来跳过 `removed`**，绝不冒充收敛。
             * 于是"记录里写着 idle、而它其实没交回任何东西"这件事，由 `spoke: false` 抓住。
             */
            state: live.status === 'running' ? 'working' : live.status === 'idle' ? 'idle' : 'unknown',
            spoke,
        });
    }
    return out;
}
export async function initializeProfileTeam(input) {
    const profile = resolveTeamProfile(input.inlinePlan === undefined ? input.config.profiles : { [input.profileName]: input.inlinePlan }, input.profileName, input.config.maxMembers);
    const selections = [];
    for (const template of profile.members) {
        selections.push(await resolveMemberLlmSelection(input.ctx, input.captain, {
            provider: template.provider,
            model: template.model,
            defaultModel: input.config.memberModel,
            reasoningEffort: template.reasoningEffort,
            fallback: template.fallback ?? profile.fallback ?? input.config.fallback,
        }, input.exec.signal));
    }
    await validateMemberLlmSelections(input.ctx, selections, input.exec.signal);
    const now = Date.now();
    const seedToActual = new Map(profile.tasks.map((template, index) => [template.id, `t${index + 1}`]));
    const draft = {
        name: input.teamName,
        id: input.teamId,
        description: input.description,
        profile: {
            name: profile.name,
            ...profile.description === undefined ? {} : { description: profile.description },
            ...profile.protocol === undefined ? {} : { protocol: profile.protocol },
            ...profile.executionPrompt === undefined ? {} : { executionPrompt: profile.executionPrompt },
            ...profile.fallback === undefined ? {} : { fallback: profile.fallback },
            taskPlanning: profile.taskPlanning,
            ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
        },
        ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
        captainSessionId: input.captain.id,
        createdAt: now,
        ...input.staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : {},
        members: profile.members.map((template, index) => {
            const selection = selections[index];
            return {
                id: '',
                name: template.name,
                role: template.role,
                provider: selection.provider,
                model: selection.model,
                reasoningEffort: selection.reasoningEffort,
                executionPrompt: template.executionPrompt ?? profile.executionPrompt ?? input.config.executionPrompt,
                ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
                joinedAt: now,
                status: 'idle',
            };
        }),
        tasks: profile.tasks.map((template, index) => ({
            id: `t${index + 1}`,
            profileSeedId: template.id,
            subject: template.subject,
            description: template.description,
            status: 'pending',
            assignee: template.assignee,
            dependencies: template.dependencies.map((dependency) => seedToActual.get(dependency) ?? dependency),
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        })),
        taskSeq: profile.tasks.length,
    };
    // Roster creation is durable planning only. The scheduler starts each
    // member with its first actual task once its dependencies are satisfied.
    if (input.inlinePlan !== undefined)
        delete draft.profile;
    await createTeamDir(input.stateRoot, draft);
    return { committed: true, state: draft };
}
export function parseFindings(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('findings must be an array');
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`findings[${index}] must be an object`);
        }
        const raw = item;
        if (typeof raw['id'] !== 'string' || raw['id'].trim() === '')
            throw new Error(`findings[${index}].id is required`);
        if (raw['severity'] !== 'low' && raw['severity'] !== 'medium' && raw['severity'] !== 'high' && raw['severity'] !== 'blocker') {
            throw new Error(`findings[${index}].severity is invalid`);
        }
        if (typeof raw['problem'] !== 'string' || raw['problem'].trim() === '')
            throw new Error(`findings[${index}].problem is required`);
        if (typeof raw['requiredFix'] !== 'string' || raw['requiredFix'].trim() === '')
            throw new Error(`findings[${index}].requiredFix is required`);
        return {
            id: raw['id'].trim(),
            severity: raw['severity'],
            problem: raw['problem'],
            requiredFix: raw['requiredFix'],
            // A blank optional file must be omitted, not persisted: durable-state
            // validation requires non-empty optional strings (issue #105 class).
            ...typeof raw['file'] === 'string' && raw['file'].trim() !== '' ? { file: raw['file'] } : {},
            ...typeof raw['line'] === 'number' ? { line: raw['line'] } : {},
            ...typeof raw['resolved'] === 'boolean' ? { resolved: raw['resolved'] } : {},
        };
    });
}
export function parseAcceptanceResults(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('acceptanceResults must be an array');
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`acceptanceResults[${index}] must be an object`);
        }
        const raw = item;
        if (typeof raw['criterion'] !== 'string' || raw['criterion'].trim() === '') {
            throw new Error(`acceptanceResults[${index}].criterion is required`);
        }
        if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
            throw new Error(`acceptanceResults[${index}].status must be passed or failed`);
        }
        return {
            criterion: raw['criterion'],
            status: raw['status'],
            ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
        };
    });
}
export function parseCommandResults(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('commandsRun must be an array');
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`commandsRun[${index}] must be an object`);
        }
        const raw = item;
        if (typeof raw['command'] !== 'string' || raw['command'].trim() === '') {
            throw new Error(`commandsRun[${index}].command is required`);
        }
        if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
            throw new Error(`commandsRun[${index}].status must be passed or failed`);
        }
        return {
            command: raw['command'],
            status: raw['status'],
            ...typeof raw['exitCode'] === 'number' ? { exitCode: raw['exitCode'] } : {},
            ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
        };
    });
}
export function applyQualityFollowUp(team, closed) {
    const planned = planQualityFollowUp(team, closed);
    if (planned.escalated === true)
        team.escalated = true;
    const created = [];
    const existing = [...team.tasks];
    const now = Date.now();
    const idBySubject = new Map();
    for (const draft of planned.created) {
        team.taskSeq += 1;
        const id = `t${team.taskSeq}`;
        if (draft.id !== undefined)
            idBySubject.set(draft.id, id);
        if (draft.subject !== undefined)
            idBySubject.set(draft.subject, id);
        const dependencies = (draft.dependencies ?? []).map((dependency) => {
            if (team.tasks.some((item) => item.id === dependency))
                return dependency;
            return idBySubject.get(dependency) ?? dependency;
        });
        const next = {
            id,
            subject: draft.subject ?? `${draft.kind}-round-${draft.round ?? 1}`,
            status: 'pending',
            assignee: draft.assignee,
            dependencies,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
            kind: draft.kind,
            ...draft.round === undefined ? {} : { round: draft.round },
            ...draft.objective === undefined ? {} : { objective: draft.objective },
            ...draft.inScope === undefined ? {} : { inScope: draft.inScope },
            ...draft.outOfScope === undefined ? {} : { outOfScope: draft.outOfScope },
            ...draft.acceptance === undefined ? {} : { acceptance: draft.acceptance },
            ...draft.verify === undefined ? {} : { verify: draft.verify },
            ...draft.sourceTaskId === undefined ? {} : { sourceTaskId: draft.sourceTaskId },
            ...draft.sourceFindingIds === undefined ? {} : { sourceFindingIds: draft.sourceFindingIds },
            ...draft.reviewedTaskId === undefined ? {} : { reviewedTaskId: idBySubject.get(draft.reviewedTaskId) ?? draft.reviewedTaskId },
        };
        team.tasks.push(next);
        created.push(next);
    }
    // A staged full delivery plan may already contain downstream integration
    // work that points at the first requirements/review gate. When that gate
    // opens an automatic revision loop, move only still-pending downstream
    // edges to the new terminal gate so the approved plan can continue after
    // the repair instead of waiting forever on an intentionally failed task.
    const replacement = created.at(-1);
    if (replacement !== undefined) {
        for (const task of existing) {
            if (task.status !== 'pending' || !task.dependencies.includes(closed.id))
                continue;
            task.dependencies = task.dependencies.map((dependency) => (dependency === closed.id ? replacement.id : dependency));
            task.updatedAt = now;
        }
    }
    return { created, escalated: planned.escalated === true };
}
export function renderStatus(value) {
    const team = value;
    const flags = [
        team.halted ? 'halted' : undefined,
        team.escalated ? 'escalated' : undefined,
        team.deliverable ? 'deliverable' : undefined,
        team.loop_state && team.loop_state !== 'running' && team.loop_state !== 'halted' && team.loop_state !== 'escalated'
            ? team.loop_state
            : undefined,
    ].filter((item) => item !== undefined);
    const lines = [
        `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`,
        ...team.profile === undefined ? [] : [`Profile: ${team.profile.name}${team.profile.task_planning ? ` [${team.profile.task_planning}]` : ''}${team.profile.protocol ? ` — ${team.profile.protocol}` : ''}`],
        ...team.loop_summary ? [`Loop: ${team.loop_state ?? ''} — ${team.loop_summary}`.replace(/^Loop:  — /u, 'Loop: ')] : [],
        `Viewing as: ${team.viewer}`,
        `Members (${team.members.length}):`,
        ...team.members.map((member) => {
            const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : '';
            const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : '';
            const failure = member.spawn_error === undefined ? '' : `\n      start failed: ${member.spawn_error.slice(0, 400)}`;
            return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}${failure}`;
        }),
        `Tasks (${team.tasks.length}):`,
        ...team.tasks.map((task) => {
            const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : '';
            const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : '';
            const evidence = task.supplemental_evidence ? `\n      Supplemental observations (original verdict unchanged): ${task.supplemental_evidence}` : '';
            const handoff = task.reassigning ? ' (reassigning)' : '';
            const seed = task.seed_id === undefined || task.seed_id === '' ? '' : ` seed ${task.seed_id}`;
            const kind = task.kind ? ` ${task.kind}` : '';
            const round = task.round === undefined ? '' : ` r${task.round}`;
            const verdict = task.verdict === undefined ? '' : ` verdict ${task.verdict}`;
            return `  - ${task.id} [${task.status}]${kind}${round}${verdict} attempt ${task.attempt}${handoff}${seed} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}${evidence}`;
        }),
        ...team.coverage === undefined || team.coverage.length === 0 ? [] : [
            'Coverage:',
            ...team.coverage.map((row) => `  - ${row.goal_item}: ${row.status} (${row.task_ids.join(',') || 'none'})`),
        ],
        ...team.delivery === undefined ? [] : [
            `Delivery: ${team.delivery.ok ? 'ok' : `blocked (${team.delivery.blockers.join('; ')})`}`,
        ],
        /**
         * ── ★ 部署状态必须【渲染出来】（2026-10-07，一次代价很大的实测）─────────────
         *
         * MEASURED：t34 把 `deployment` 加进了 status 的【返回值】，而没有加进这里的
         * **渲染**。后果是我（captain）在整整一个下午里，反复把"渲染里没有"读成
         * "宿主进程没有那个字段"，并据此得出"宿主持旧模块"的结论 —— 而那个结论
         * 把整条链冻了几个小时。
         *
         * ⇒ 教训不是"要小心"，而是**这个字段的性质**：
         *   它的用途是回答「我该不该重载」，而那是一个【要被人看见】的问题。
         *   一个只在返回值里、而人看不见的读数，**与它不存在是同一件事** ——
         *   这正是 t31 那条「一个没有调用方的修法，与没有修法在观测上完全相同」
         *   在同一层上的又一版本。
         *
         * ★ 三态在渲染里也分形（不是只印一个字段）：
         *   `current` 说"本进程持的就是盘上那一份"；
         *   `stale` 【必须】说清它旧了、并指向动作（重载）；
         *   `unknown` 说"没能确定"，且【不得】读成 current ——
         *   与它未渲染时那种"看得见 current、看不见 unknown"的写法相反。
         */
        ...team.deployment === undefined ? [] : [`Deployment: ${team.deployment.message}`],
        `Captain inbox (${team.captain_inbox.length}):`,
        ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content}`),
        ...(team.member_inbox ?? []).map(message => `  - [${message.from}] ${message.content}`),
    ];
    for (const [name, inbox] of Object.entries(team.member_inboxes)) {
        lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`);
    }
    if (team.mailbox_warning_count > 0) {
        lines.push(`Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`, ...team.mailbox_warnings.map((warning) => `  - ${warning}`));
    }
    return lines.join('\n');
}
/**
 * 进程级的「已申请重载」状态。
 *
 * ★ 为什么是**进程级**而不是耐久态：重载是**这个进程**换掉自己的代码 ——
 *   它属于进程，不属于团队。而把它写进 `TeamState` 要改 `src/types.ts`
 *   与 `src/state.ts`（**都不在本任务 inScope**）。
 * ★ 而"进程级"不削弱它的用处：`status` 由**同一个进程**回答，
 *   而闸门与重载也都在这个进程里 ⇒ 三者看到的是**同一份**状态。
 *   ★ 反过来说清了它的**边界**：这个状态**不跨进程**（换进程就没了）——
 *     而那恰好是对的：换了进程，旧的申请本就该作废（新进程有新的模块）。
 */
let requestedRestart;
/** 此刻的排队状态（**纯函数**：只读入参，不读模块状态 —— 便于夹具直接构造三态）。 */
export function restartQueueState(input) {
    if (input.requestedAt === undefined)
        return { status: 'none' };
    /**
     * ★★ 第三态：**等不到**。
     *
     *   等待名单里的某个任务**不在任务表里** ⇒ 它永远不会变成终态
     *   （它已经不在了，没有任何东西能让它收口）⇒ 这一等不会有结果。
     *
     *   ★ 而它必须与 `waiting` **不同形**：`waiting` 会自己收敛，`stuck` 不会。
     *     写成同一形状的后果是**读的人一直等**，而那正是本队记过的
     *     「等不到与还在等同形」。
     */
    const known = new Set(input.knownTaskIds);
    const vanished = input.waitingOn.filter((id) => !known.has(id));
    if (vanished.length > 0) {
        return {
            status: 'stuck',
            requestedAt: input.requestedAt,
            waitingOn: [...input.waitingOn],
            reason: `waiting on task(s) that are no longer in the team: ${vanished.join(', ')} — nothing can bring them to a terminal status, so this wait will never end`,
        };
    }
    /**
     * ★ 收口了：等待名单与进行中的交集为空 ⇒ 可以重载了。
     *   ★ 这里返回 `waiting` 且名单里可能**已经为空** —— 调用方据此决定是否重载。
     *     而"可重载"由 `waitingOn.length === 0` 表达，不是一个**独立的第四态**：
     *     一个已经等到的申请仍是"已申请"（它还没有被消费）。
     */
    return {
        status: 'waiting',
        requestedAt: input.requestedAt,
        waitingOn: input.waitingOn.filter((id) => input.inFlight.includes(id)),
    };
}
/** 记下一次申请（进程级）。 */
export function requestRestart(waitingOn, now) {
    requestedRestart = { at: now, waitingOn: [...waitingOn] };
}
/** 读当前的申请（`undefined` = 没申请过）。 */
export function pendingRestartRequest() {
    return requestedRestart === undefined ? undefined : { at: requestedRestart.at, waitingOn: [...requestedRestart.waitingOn] };
}
/** 消费掉申请（重载真的发生了，或申请被放弃）。 */
export function clearRestartRequest() {
    requestedRestart = undefined;
}
/**
 * 用**当前的任务表**算出排队状态（`restartQueueState` 的薄封装）。
 *
 * ★ 与闸门同一条纪律：输入从**耐久态**来（调用方读 team），不从这个模块缓存。
 */
export function restartQueueFrom(tasks) {
    const request = pendingRestartRequest();
    if (request === undefined)
        return { status: 'none' };
    const inFlight = tasks.filter((task) => task.status === 'in_progress').map((task) => task.id);
    return restartQueueState({
        requestedAt: request.at,
        waitingOn: request.waitingOn,
        knownTaskIds: tasks.map((task) => task.id),
        inFlight,
    });
}
/** 一句人话（供工具结果与 status 读）。★ 三态措辞必须互不同形。 */
export function restartQueueMessage(state) {
    if (state.status === 'none')
        return 'no reload has been requested';
    if (state.status === 'waiting') {
        return state.waitingOn.length === 0
            ? `a reload was requested at ${state.requestedAt} and nothing is in flight any more — it can proceed`
            : `a reload was requested at ${state.requestedAt} and is waiting on ${state.waitingOn.join(', ')}`;
    }
    return `a reload was requested at ${state.requestedAt} but CANNOT converge: ${state.reason}`;
}
