/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { appendTeamEvent, captainSessionOf } from "./events.js";
import { amendTaskContract, acknowledgeMailbox, markMailboxDelivered, discardMailboxMessages, appendMailbox, archiveTeamDir, beginTaskAttempt, CAPTAIN_KEY, createMessage, createTeamDir, findTeamByCaptain, findTeamByParticipant, cancelUnfinishedTask, invalidateTaskAttempt, readUnreadMailbox, readMailbox, recordRetiredMemberIds, releaseMailboxDelivery, readTeam, sanitizeKey, transitionError, unsatisfiedDependencies, withTeamLock, writeTeam, validateCreateTask, evaluateQualityCompletion, planQualityFollowUp, resumeTeamState, buildCoverageMatrix, canDeclareDelivery, describeQualityLoop, sanitizeReviewAcceptance, sanitizeReviewObjective, normalizeBlankOptionalTaskFields, taskKindOf, } from "./state.js";
import { appendTaskEvidence } from "./quality-gates.js";
import { gateModuleViews, registry } from "./gates/index.js";
import { auditRequires } from "./gates/requires.js";
import { observedChangedPaths, sessionOwnEvents } from "./harness-compat.js";
import { deliverToMember, installRetiredMemberGuard, installMemberSelectionRuntime, installMemberDelegationGuard, memberActivity, resolveMemberLlmSelection, spawnMember, steerCaptainReport, validateMemberLlmSelections, } from "./members.js";
import { TERMINAL_TASK_STATUSES } from "./types.js";
import { collectCompletedDependencyOutputs, formatDependencyOutputs, installTeamScheduler } from "./scheduler.js";
import { installMailboxAdmission, isCurrentMail, mailboxContent, mailboxPrompt, readCurrentMailbox } from "./mailbox.js";
import { resolveTeamProfile } from "./profiles.js";
export { steerCaptainReport } from "./members.js";
/**
 * ── ★★ 工具边界：核对结论**挂在拒绝上也要出得来**（t3）───────────────────────────
 *
 * 四处里的三处（contract / dispatch / completion）走**异常路径**：一次被拒的
 * `create_task` / `update_task` / `amend_task` / `declare_delivery` 不返回结果对象，
 * 而拒绝**恰恰是最需要读到核对结论**的那一刻 —— 那里最容易合流的正是
 * "这个动作本身不合法"与"判据要的那一格调用方没接上"。
 *
 * ★ 做法：`throwWithSurface` 把结论挂成 `Error` 的一个自有属性（见它的长注释），
 *   本函数在**工具边界**把它原样搬进工具结果的 `input_surface` 字段。
 *
 * ── ★★ 三条纪律，每条都来自一次实测 ────────────────────────────────────────────
 *
 *   ① **只在"还没被搬运过"时搬运**（`INPUT_SURFACE_PROPERTY in error`）。
 *      MEASURED（本任务第一次跑真实入口就撞上）：`update_task` 一次调用**穿过两个
 *      位置**（dispatch 与 completion）。先拒绝的那个（dispatch）已经把结论挂在
 *      `error.input_surface` 上了，而**后**拒绝的那个（completion）再挂一次 ——
 *      于是 dispatch 那一份被**静默覆盖**，读出来的是 completion 的结论。
 *      那正是本队记账的第三种恒真写法（**读错位置的出口**）：字段在场、读得到、
 *      数值也对，只是它不是读者以为的那个位置报的。
 *      ⇒ 第一个报缺的位置赢。**不合并、不覆盖** —— 合并会让"哪一个位置缺哪一格"
 *        重新变得读不出来，而那是本任务存在的理由。
 *
 *   ② **失败结果仍然是一条失败结果**：本函数**不改变任何裁决**。抛出物**原样**
 *      继续抛出去（同一个对象，`instanceof` 与 `message` 都不变，调用方原有的
 *      错误处理一个字都不用改），只是它身上多了一个自有属性。
 *
 *   ③ **没有结论时行为逐字节不变**（连抛出的对象都不动）。
 *
 * ★ 为什么必须包在 `execute` 的外面，而不是在各工具里各 `try/catch` 一次：
 *   四处 → 五处 `catch` 就是五处会慢慢分叉的地方（而分叉之后，"哪一处带得出来结论"
 *   在断言层面同形 —— 这正是本任务要消灭的形状）。边界只有一处。
 *
 * ★ 副作用为零的证据：本函数只在 `error` 上**多挂一个自有属性**。不写盘、不记日志、
 *   不改控制流；`instanceof Error` 与 `message` 都逐字不变。
 *
 * ★ 类型上刻意用**结构化**的最小形状（而不是某个具体的 tool 泛型）：这样它既能包住
 *   `defineTool(...)` 的返回值，又不引入任何新的类型依赖。运行期它只是一次转发。
 */
function withInputSurfaceOnError(tool) {
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
/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec) {
    if (!exec.agent) {
        throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)');
    }
    return exec.agent;
}
/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent) {
    return agent.session.header.cwd ?? process.cwd();
}
/**
 * ── ★ 判据层执行 verify 命令的执行器 ────────────────────────────────────────────
 *
 * 在队长的 workspace 里跑一条 verify 命令，返回真实退出码。
 * 这是整个修复里唯一做 I/O 的新增点，被注入进纯函数 `rerunVerifyCommands`，
 * 让 quality-gates.ts 保持零 I/O 的纪律（它自己的 verify 全套都在无 I/O 下跑）。
 *
 * ★ 超时：命令挂死时返回非零而不是让 update_task 永远不返回。125 是 shell
 * 惯用的"命令超时"退出码，与被测命令自己的退出码空间区分开。
 */
const VERIFY_COMMAND_TIMEOUT_MS = 120_000;
async function runVerifyCommand(workspace, command) {
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
/**
 * ── ★ 判据的注入口径：I/O 在这一层，判据本身是纯数据变换 ────────────────────────
 *
 * MEASURED（2026-10-05，t7）：`registry.evaluate('completion', …)` 此前**只**注入
 * `execVerifyCommand`，于是三条新判据在生产路径上永远拿不到输入：
 *
 *     completion.mutation  ⇒ 永远 unmeasured（缺 readFile / runTest / writeFile）
 *     completion.backtest  ⇒ 永远 unmeasured（缺 baseline / coverage / 执行器）
 *     completion.r5        ⇒ 永远 skipped（缺 newTestFiles ⇒ appliesTo 为假）
 *
 * ⇒ 后果不是"少测了一点"，而是**每一次 completed 都会被拒**：一个永远无法测成的
 *   判据等于一道永远关着的门。补齐注入面才是修它 —— **绝不能靠放宽判据**。
 *
 * ★ 注入的边界（这一节的全部纪律）：
 *   · 判据不 import I/O；这里（tools.ts）是唯一做 I/O 的地方。
 *   · 拿不到证据时**不注入该字段**（而不是注入一个空值）—— 缺席 ⇒ 判据说
 *     "我没能测量"，那是诚实的；注入空值会让判据把"没数据"读成"测了是零"。
 */
/**
 * ★ 任务 → 它的隔离检出基准（worktree 的 `base`）。
 *
 * 为什么是【进程内】而不是写进 TeamTask：`base` 是【这一次派发】的属性，不是任务的
 * 持久契约的一部分；把它落进 team.json 会让一个派生事实变成需要维护的状态
 * （而它随时可以由 git 重算）。与 scheduler 的 `parkedAttempts` 同一形态。
 *
 * ★ 缺席 ⇒ 不注入 `parentRevision` / `baseline` ⇒ r5 与 backtest 诚实地说
 *   "我没能测量"。**不会**回退成 `HEAD` 或任何猜测出来的版本 —— 一个伪造的基准
 *   会让"在错误的基础上比较"读成"比较过了"。
 */
const taskWorktreeBase = new Map();
/** 派发时登记基准；判据层在完成时读它。 */
export function rememberWorktreeBase(taskId, base) {
    taskWorktreeBase.set(taskId, base);
}
/** 取该任务的基准；没有就返回 undefined（**不是** HEAD，也不是空串）。 */
function worktreeBaseOf(taskId) {
    const base = taskWorktreeBase.get(taskId);
    return typeof base === 'string' && base.trim() !== '' ? base : undefined;
}
/**
 * ★ 在一个【干净的、指定版本】的检出里跑一条命令，交回退出码。
 *
 * 为什么用临时 `git worktree` 而不是在原地 `git checkout <rev>`：
 *   · 成员的工作区通常是**脏的**（它刚改过文件）⇒ `git checkout` 直接拒绝，
 *     于是退出码变成"跑不起来"，而判据会（正确地）说"我没能测量"——
 *     一次**基础设施失败**会被读成"这个版本上没跑"，两者不同形，必须避免。
 *   · 原地切换还可能把成员的改动弄丢。
 * ⇒ 检出一个干净副本去跑，跑完删掉。
 *
 * ★ 拿不到退出码就返回 `undefined`，**不返回 0**：0 意味着"这个版本上是通过的"，
 *   而那是一个关于工作的结论；跑不起来不能伪装成它。
 */
async function runInDetachedRevision(options) {
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
/**
 * ── ★ 回测的依赖图 / 覆盖数据：从【真实 import】推出来 ──────────────────────────
 *
 * 回测的 L2 要求"选测器不能隐藏自身近似性"，所以它不采信选测器自报的 `selection`，
 * 只采信 `coverage`。那段数据**必须是真的** —— 一个编出来的图正是这条判据要抓的
 * 那种"隐藏自身近似性的选择器"，用它喂判据等于让判据给自己发通行证。
 *
 * ⇒ 这里读工作区里真实的测试文件与源码文件，用 `import ... from '…'` 语句建图：
 *
 *     coverage[源文件] = [覆盖它的测试文件…]
 *     dependents[源文件] = [直接 import 它的文件…]（判据自己会算传递闭包）
 *
 * ★ 拿不到（不是 git 仓库、读不到文件…）⇒ 返回 `undefined` ⇒ **不注入** ⇒ 判据
 *   说"没有依赖图数据"。**绝不**返回一个空图：空图会让"选了 0 条"与"选对了"
 *   在判据层同形，而那正是它存在的理由。
 */
async function deriveCoverageInput(options) {
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
/**
 * 读一个 workspace 相对文件。抛错 ⇒ 调用方不注入该字段 ⇒ 判据 unmeasured。 */
async function readWorkspaceFile(workspace, relativePath) {
    const { readFile } = await import('node:fs/promises');
    return await readFile(join(workspace, relativePath), 'utf8');
}
/**
 * 跑一条命令并【捕获输出】。变异判据要从输出里解析测试摘要（`# pass 3` / `ℹ pass 3`），
 * 只有退出码是不够的 —— 退出码说得清"红/绿"，说不清"跑了几条、过了几条"，
 * 而杀手套件的杀伤率正是后者的函数。
 *
 * ★ 输出上限 256 KiB 且保留【尾部】：摘要行在尾部，截头部会让它消失。
 */
async function runVerifyCommandCaptured(workspace, command) {
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
/**
 * 同步读一个 workspace 相对文件（变异判据的 `readFile` 契约是同步的）。
 * 抛错 ⇒ 判据内部按 unmeasured 处理；这里【不】吞掉它，也不返回空串 ——
 * 返回空串会让"读不到"伪装成"文件是空的"。
 */
function readWorkspaceFileSync(workspace, relativePath) {
    return readFileSync(join(workspace, relativePath), 'utf8');
}
/**
 * 同步写一个 workspace 相对文件（变异判据的 `writeFile` 契约是同步的）。
 * ★ 只有变异判据用它，而它写的是【它自己刚读过的那个文件的变异体】，随后会还原；
 *   拒绝越界路径（`..` / 绝对路径）—— 与 worktree.ts 的 `guardedWrite` 同一条纪律。
 */
function writeWorkspaceFileSync(workspace, relativePath, contents) {
    const target = join(workspace, relativePath);
    if (!target.startsWith(workspace.endsWith('/') ? workspace : `${workspace}/`)) {
        throw new Error(`refusing to write outside the workspace: ${relativePath}`);
    }
    writeFileSync(target, contents);
}
/**
 * 从改动文件推出扫描目录。
 *
 * ★ 这是 r5 的 `scanDirs`：它决定"去哪找测试文件"。推不出来（没有改动文件）
 *   ⇒ 返回 undefined ⇒ 不注入 ⇒ 判据 unmeasured，而不是注入一个猜测出来的目录。
 */
function deriveScanDirs(changedFiles) {
    const dirs = new Set();
    for (const file of changedFiles) {
        const parts = file.split('/');
        if (parts.length <= 1)
            continue;
        dirs.add(parts.slice(0, -1).join('/'));
    }
    return dirs.size === 0 ? undefined : [...dirs].sort();
}
/**
 * ★ `git diff --unified=0 <base>` 交出的【改动行号】（新文件侧）。
 *
 * 变异判据的 R1 是"只变异改动行范围"（见 mutation.ts 文件头）。它需要离散行号，
 * 而这不是能从 `changedPaths` 推出来的东西 —— 一个文件"被改了"不等于知道"哪几行"。
 * ⇒ 在这里用 git 问出来；缺席 ⇒ 该字段不注入 ⇒ 判据 unmeasured
 *   （★ 绝不退回全文件变异：那会把无关区域算进分母而扭曲分数）。
 *
 * 拿不到 base 时返回 undefined（**不是** []）：`[]` 会被判据读成"测了，确实没有
 * 可变异行"，而事实是"没能测量"—— 两者不同形，与 changedPaths 的 `undefined` vs `[]` 同源。
 */
async function changedLineNumbers(workspace, base) {
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
/**
 * 把判据层重跑的 CommandResult 并回成员提交的数组：同名命令以重跑为准
 * （exitCode 是判据层亲眼看到的），其余条目保留。
 */
function mergeRerunIntoCommandsRun(claimed, reruns) {
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
/** Resolved absolute state root. */
function stateRootOf(workspace, config) {
    return join(workspace, config.stateDir);
}
/** Process-local lock key scoped by workspace state root and team id. */
function teamLockKey(stateRoot, teamId) {
    return `team:${stateRoot}:${teamId}`;
}
/** Process-local lock key enforcing one active team per captain session. */
function captainLockKey(stateRoot, captainId) {
    return `captain:${stateRoot}:${captainId}`;
}
/** The team this captain currently leads, or a loud failure. */
async function requireCaptainTeam(workspace, config, captain) {
    const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id);
    if (team === undefined) {
        throw new Error('you are not leading any team yet — call agent_teams_create first');
    }
    return team;
}
/** The team this captain or active member currently participates in. */
async function requireParticipantTeam(workspace, config, caller) {
    const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id);
    if (team === undefined) {
        throw new Error('you do not lead or belong to any active team yet');
    }
    return team;
}
/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team, agentId) {
    if (team.captainSessionId === agentId)
        return { kind: 'captain', name: CAPTAIN_KEY };
    const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed');
    return member === undefined ? undefined : { kind: 'member', name: member.name };
}
/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot, teamId) {
    const fresh = await readTeam(stateRoot, teamId);
    if (fresh === undefined)
        throw new Error(`team "${teamId}" is no longer active`);
    return fresh;
}
/** Fresh state with captain authorization rechecked inside the lock. */
async function requireFreshCaptainTeam(stateRoot, teamId, captainId) {
    const fresh = await requireFreshTeam(stateRoot, teamId);
    if (fresh.captainSessionId !== captainId) {
        throw new Error(`only the captain of team "${fresh.name}" may perform this operation`);
    }
    return fresh;
}
/** Fresh state and caller identity rechecked inside the lock. */
async function requireFreshParticipant(stateRoot, teamId, callerId) {
    const fresh = await requireFreshTeam(stateRoot, teamId);
    const identity = participantIdentityOf(fresh, callerId);
    if (identity === undefined)
        throw new Error(`you are no longer an active participant in team "${fresh.name}"`);
    return { team: fresh, identity };
}
/** Look up one live (non-removed) member by display name. */
function requireMember(team, name) {
    const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed');
    if (member === undefined) {
        throw new Error(`no active member named "${name}" in team "${team.name}"`);
    }
    return member;
}
/** Look up one task by id. */
function requireTask(team, taskId) {
    const task = team.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) {
        throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`);
    }
    return task;
}
function requireStagedTeam(team) {
    if (team.phase !== 'staged') {
        throw new Error(`team "${team.name}" is already running; its plan can no longer be edited`);
    }
    if (team.halted === true)
        throw new Error(`team "${team.name}" is halted, not awaiting plan approval`);
}
function trimmedOptional(value) {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
/** Validate references and cycles before a staged graph can be saved or run. */
function validateStagedGraph(team, requireRunnable) {
    const members = team.members.filter((member) => member.status !== 'removed');
    if (requireRunnable && members.length === 0)
        throw new Error('add at least one member before approving the plan');
    if (requireRunnable && team.tasks.length === 0)
        throw new Error('add at least one task before approving the plan');
    const memberNames = new Set(members.map((member) => member.name));
    const taskIds = new Set(team.tasks.map((task) => task.id));
    for (const task of team.tasks) {
        if (task.subject.trim() === '')
            throw new Error(`task "${task.id}" must have a subject`);
        if (task.assignee !== undefined && task.assignee !== CAPTAIN_KEY && !memberNames.has(task.assignee)) {
            throw new Error(`task "${task.id}" assignee "${task.assignee}" is not an active member`);
        }
        for (const dependency of task.dependencies) {
            if (dependency === task.id)
                throw new Error(`task "${task.id}" cannot depend on itself`);
            if (!taskIds.has(dependency))
                throw new Error(`task "${task.id}" depends on unknown task "${dependency}"`);
        }
    }
    const visiting = new Set();
    const visited = new Set();
    const byId = new Map(team.tasks.map((task) => [task.id, task]));
    const visit = (taskId) => {
        if (visiting.has(taskId))
            throw new Error(`task dependency graph contains a cycle at "${taskId}"`);
        if (visited.has(taskId))
            return;
        visiting.add(taskId);
        for (const dependency of byId.get(taskId)?.dependencies ?? [])
            visit(dependency);
        visiting.delete(taskId);
        visited.add(taskId);
    };
    for (const task of team.tasks)
        visit(task.id);
}
function memberOpenTask(team, memberName, exceptTaskId) {
    return team.tasks.find(task => task.id !== exceptTaskId
        && task.assignee === memberName
        && (task.status === 'claimed' || task.status === 'in_progress'));
}
function taskDetails(team, task) {
    return [task.subject, task.description ?? '',
        `Kind: ${task.kind ?? 'work'}`,
        `Objective: ${task.objective ?? ''}`,
        `In scope: ${(task.inScope ?? []).join(', ')}; Out of scope: ${(task.outOfScope ?? []).join(', ')}`,
        `Acceptance: ${(task.acceptance ?? []).join('; ')}`,
        `Verify: ${(task.verify ?? []).join('; ')}`,
        `Dependency results:\n${formatDependencyOutputs(collectCompletedDependencyOutputs(team.tasks, task.id))}`,
    ].join('\n');
}
/** Captain work is immediate, not a durable scheduler lane: allow one unfinished takeover at a time. */
function captainOpenTask(team, exceptTaskId) {
    return team.tasks.find(task => task.id !== exceptTaskId
        && task.assignee === CAPTAIN_KEY
        && !TERMINAL_TASK_STATUSES.includes(task.status));
}
/** Stop every currently-resident member activation for one halted team.
 *
 * Interrupt requests only cancel the member's current model turn and retain its
 * activation. Draining the selected direct children is the stronger lifecycle
 * boundary: it waits for the activation handles to release, so a child cannot
 * keep executing after the captain-chat Stop control has reported success.
 */
async function stopTeamMemberActivations(ctx, captain, members, signal) {
    const memberIds = members.filter(member => member.id !== '').map(member => member.id);
    if (memberIds.length === 0)
        return;
    // Every supported exact host has targeted recursive drain. Unlike interrupt,
    // it closes admission and clears queued work before awaiting descendants.
    signal?.throwIfAborted();
    await ctx.subagents.drainContinuableChildren(captain, memberIds);
}
export async function haltTeamWork(input) {
    const halted = await withTeamLock(teamLockKey(input.stateRoot, input.teamId), async () => {
        const fresh = await requireFreshCaptainTeam(input.stateRoot, input.teamId, input.captain.id);
        if (fresh.halted === true) {
            return {
                teamName: fresh.name,
                cancelledTasks: fresh.tasks.filter((task) => task.status === 'cancelled').length,
                alreadyHalted: true,
                members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
            };
        }
        const now = Date.now();
        let cancelledTasks = 0;
        for (const task of fresh.tasks) {
            if (TERMINAL_TASK_STATUSES.includes(task.status))
                continue;
            cancelUnfinishedTask(task, 'Stopped from the captain chat.');
            cancelledTasks += 1;
        }
        for (const member of fresh.members) {
            if (member.status === 'removed')
                continue;
            member.status = 'idle';
        }
        fresh.halted = true;
        fresh.haltedAt = now;
        await writeTeam(input.stateRoot, fresh);
        appendTeamEvent(input.ctx, captainSessionOf(input.ctx, fresh.captainSessionId, input.captain.session), 'agent-teams/team-halted', {
            teamId: fresh.id,
            cancelledTasks,
        });
        return {
            teamName: fresh.name,
            cancelledTasks,
            alreadyHalted: false,
            members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
        };
    });
    // Persist the stop boundary first, then abort the Captain before draining
    // children. Otherwise its current model turn can observe `halted`, call
    // resume, and race the still-running HTTP stop request.
    input.captain.cancel({ kind: 'user' }, { keepInbox: true });
    await stopTeamMemberActivations(input.ctx, input.captain, halted.members, input.signal);
    // Interrupting a child emits a trailing subagent-settled notification. That
    // notification can start a fresh Captain turn after the first cancellation,
    // so close the stop boundary again once every child activation has drained.
    // Queued user input is preserved both times; only runtime-generated work is
    // prevented from silently resuming the halted team.
    input.captain.cancel({ kind: 'user' }, { keepInbox: true });
    return {
        teamName: halted.teamName,
        cancelledTasks: halted.cancelledTasks,
        alreadyHalted: halted.alreadyHalted,
    };
}
/** Web approval has no tool result in the captain's conversation. */
export function stagedPlanApprovedContext(teamName) {
    return [
        `The user approved the staged AgentTeams plan "${teamName}" from the pre-run review UI.`,
        'Approval has committed; the scheduler owns dispatch of the approved team. Do not approve again, recreate the roster, or send messages merely to start assigned tasks.',
        'Acknowledge the approval and handle any reports or user work already pending. Yield only when waiting for members is the remaining action. Their reports will wake you automatically; do not busy-poll status or keep a turn running just to wait.',
        'On a report, inspect the result and coordinate the next necessary action. If work has since been halted, respect that state and resume only on an explicit user request.',
    ].join('\n');
}
/** Context queued after the human rejects a staged plan. */
export function stagedPlanDiscardContext(teamName) {
    return [
        `The user discarded the staged AgentTeams plan "${teamName}" from the pre-run review UI.`,
        'That decision is final for this draft: it has been archived, no members were created, and no tasks may run.',
        'Do not call agent_teams_create, agent_teams_approve, or recreate a replacement team merely because the old team is no longer active.',
        'Wait for a later explicit user request. If the next user message is unrelated to AgentTeams, answer it normally and do not start a team.',
    ].join('\n');
}
/** Model-facing continuation that turns the review UI back into a conversation. */
export function stagedPlanFeedbackContext(teamName) {
    return [
        `The user selected "Return to chat and revise" for the staged AgentTeams plan "${teamName}".`,
        'The existing staged plan is still the only draft. Do not create a replacement team, approve it, spawn members, edit the plan, or start work in this turn.',
        'Ask the user one concise, concrete question about what they want changed, then stop and wait for their answer.',
        'After the user answers, revise this same staged roster and DAG with one atomic agent_teams_edit_plan call, summarize the changes, and ask the user to review the updated plan again.',
    ].join('\n');
}
/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
/**
 * ── ★ runtime 位置：每一条裁决的【运行记录】（进程内，跨步骤）───────────────────
 *
 * `runtime` 是【过程】的插入点，不是一步的裁决（契约 §5）：它的产物是"记录"，
 * 供控制台与交付时判读；它**不得拒绝任务**。本文件里它有一个统一出口
 * {@link recordRuntimeGates}，被派发、建任务、改契约、成员汇报、状态快照五处调用 ——
 * 于是"这个进程里这些事发生过"这件事，与判据层是同一份记录。
 *
 * ★ 为什么必须有个上限：这个 Map 是进程级状态，一次长会话里成员每次汇报都推进去
 *   一条。无上限的增长是一种"只在最长的那些会话里出现"的缺陷 —— 最难复现，也最难
 *   归因。保留最近 {@link RUNTIME_GATE_LOG_LIMIT} 条，够控制台与交付时判读。
 *
 * ★ 为什么不是"写进 team.json"：运行记录是【这一次运行】的属性，不是团队契约的一
 *   部分（与 `taskWorktreeBase` 同一形态）。落盘会让一个派生事实变成需要维护和
 *   迁移的状态。
 */
const RUNTIME_GATE_LOG_LIMIT = 50;
const runtimeGateLog = [];
/** 记一条运行记录（供 {@link evaluateRuntimeGates} 与夹具共用）。 */
function judgeRuntimeGates(event, outcome) {
    runtimeGateLog.push({ at: Date.now(), event, outcome });
    if (runtimeGateLog.length > RUNTIME_GATE_LOG_LIMIT)
        runtimeGateLog.splice(0, runtimeGateLog.length - RUNTIME_GATE_LOG_LIMIT);
}
/** 运行记录的快照（控制台/夹具读它；返回副本，调用方改不动内部状态）。 */
export function runtimeGateLogSnapshot() {
    return runtimeGateLog.map((entry) => ({ ...entry }));
}
/**
 * 等待记录的快照（控制台/夹具读它；返回**深**副本）。
 *
 * ★ 与 {@link runtimeGateLogSnapshot} 同形态，理由也同：进程级状态必须有只读出口，
 *   否则夹具只能通过"跑一次探活、看它说了什么"来间接推断内部状态 —— 而那正是
 *   最容易被夹具自己写错的一层（"我以为它在记录里"与"记录里真的有"同形）。
 */
export function waitRecordSnapshot() {
    return [...waitRecords.values()].map((record) => ({ ...record }));
}
/**
 * 等待**窗口**的快照（与 `waitRecordSnapshot` 同形态：进程级状态必须有只读出口）。
 *
 * ★ 它回答的是"这个任务这一次等待从哪里开始、上次何时被探活" —— 与记录表
 *   （"这一代读到过什么"）是**两个作用域**。夹具要分辨"换代没重置窗口"，
 *   唯一的办法就是把这两张表都读出来。
 */
export function waitWindowSnapshot() {
    return [...waitWindows.values()].map((window) => ({ ...window }));
}
/** 清空等待记录（★ 只给夹具用：进程级状态会跨用例残留，而残留会让"第一次探活"变形）。 */
export function resetWaitRecords() {
    waitRecords.clear();
    waitWindows.clear();
}
/**
 * ── ★★ runtime 位置的第一条判据（探活）需要的【输入面】─────────────────────────
 *
 * 契约 §5 给 `runtime` 举的例子是「在成员被派发时启动计时器；超时 ⇒ 记录」。而
 * 判据层要问的第一个问题是："这个成员【等了多久】，以及它【还在动吗】"。
 *
 * MEASURED（2026-10-06，开工前实测）：这两个观察**在插件里都不存在**。
 *
 *   · `ctx` 有 `{task, update, updateGate, …}`，**没有**"等了多久"；
 *   · 源码里 grep 不到 `startedAt` / `dispatchedAt`；
 *   · `onDispatched` 的 payload 有 taskId/attempt/attemptId/worktreePath，**没有时间戳**。
 *
 * ⇒ 判据接进来 ≠ 它的输入接进来。这就是本队反复踩过的那个形态（本轮之前已在
 *   `inScope` / `verify` / 执行器上踩了三次），所以输入面与判据是两次改动。
 *
 * ── ★ 为什么需要【一份记录】，而不是一个局部变量 ──────────────────────────────
 *
 * 最省事的写法是在 `onDispatched` 里记一个数、然后……给谁呢？`onDispatched` 是
 * **调度器**的回调，它只覆盖六个调用点里的**一个**（`member-dispatched`）。
 * 其余五个（task-created / task-update / task-update-settled / task-status /
 * delivery-declared）各建各的求值面 —— 一个记在闭包里的局部变量，它们**一个都看不见**。
 *
 * ⇒ 那五处要带 `wait` 的话，只能现编一个"起点 = 现在"。那就是**伪造一个时刻**。
 *   这正是契约 §5 说 `runtime` "**可以带状态**"的落点：跨步骤的过程约束，它的
 *   观察必须活得比一个步骤长。
 *
 * ── ★ 键是 attemptId，不是 taskId ─────────────────────────────────────────────
 *
 * 一次重派发会换 `attemptId`（`beginTaskAttempt`）⇒ 那是**新的一次等待**。
 * 用 `taskId` 做键，reassign 之后旧的 `startedAt` 会留在原地，判据读到的等待时长
 * 是**上一代尝试**的 —— 与"把失败归给一个从未发生的事件"同源（t6 已经为派发
 * 事件吃过一次：投递失败不算派发）。用 attemptId 做键，这件事在**形状上**不可能发生。
 *
 * ── ★ 有限、且不落盘 ─────────────────────────────────────────────────────────
 *
 * 与 {@link runtimeGateLog} 同形态：进程内、有上限、不写进 team.json。
 * "这一次运行里等过哪些成员"是**运行**的属性，不是团队契约的一部分；落盘会让一个
 * 派生事实变成需要维护和迁移的状态（与 `taskWorktreeBase` 同一判断）。
 */
const WAIT_RECORD_LIMIT = 200;
/**
 * 进程内的等待记录表：`attemptId` → 记录。
 *
 * ★ 用 `Map` 的顺序当 LRU 用（`Map` 保证插入顺序，重插一个键不会换位置，所以
 *   更新时要先删再插）—— 有上限的进程级状态必须能淘汰，否则它就是一个"只在最长
 *   的那些会话里出现"的缺陷。
 */
const waitRecords = new Map();
/**
 * ── ★ V3-2（收口）：任务作用域的**等待窗口簿** ────────────────────────────────
 *
 * 键 `teamId + '\u0000' + taskId` → 这个任务**这一次开工**的窗口。
 *
 * ── 为什么需要它（而不是从记录表里"找上一代")────────────────────────────────
 *
 * MEASURED（2026-10-06）：`agent_teams_status` 在**同一次调用**里先 `kickTeam`
 * （换代）再求值（探活）。所以换代那一刻，上一代记录**也正要在同一次调用里**
 * 被戳上 `lastPollAt = now` —— 从记录表里读"上一代的戳"，读到的究竟是
 * 换代前还是换代后的值，取决于两者的先后顺序，而那是一个**说不清的口径**。
 * 我为此试过三种写法（继承戳 / 首次交接不写戳 / 出生即不写戳），每一种都是
 * 修好一条臂、弄红另一条 —— 因为它们都在同一个含糊的读法上打转。
 *
 * ⇒ 正确的做法是**把窗口本身变成一等对象**：它不属于任何一代 attempt，
 *   于是"换代"与"探活戳"不再需要互相推断。记录（per-attempt）只用来回答
 *   "这一代读到过什么"，窗口簿（per-task）回答"这一次等待从何时开始、上次何时探的"。
 *
 * ── ★ 继承必须有界（队长本轮明确要求的边界，且这里逐条钉住）────────────────
 *
 *   · **键含 teamId**：不同团队里同名的 taskId 不能互借窗口；
 *   · **换成员即换窗口**：`memberName` 不同 ⇒ 另一次等待（另一个人的命，不该
 *     继承前一个人的等待时长 —— 那会把"刚接手"读成"等了 40 分钟"）；
 *   · **任务进入终态即撤销**：`teamWaitObservations` 只喂未结束的任务，
 *     而 `forgetWaitWindow` 在任务离开未结束集合时被调用 ⇒ 窗口不再被继承；
 *   · **只继承"还活着"的窗口**：见 `claimWaitWindow` 的 `staleAfterMs` ——
 *     一个超过宽限期没有被任何探活碰过的窗口，不再会被下一代继承
 *     （否则"上一代已经结束的等待"会被当成还在跑，正是队长点出的那个风险）；
 *   · **LRU 上限**：与记录表同形态，进程级状态必须有界。
 */
/**
 * ── ★ 哪些事件是【一次探活】（V3-2 收口的最后一位）────────────────────────────
 *
 * 与判据层 `LIVENESS_EVENTS` 是**同一份成员**，但这里必须**独立地**写一遍：
 * 那一份是"判据该不该开口"，这一份是"调用方该不该推进探活戳" —— 两件事。
 * （判据层不 import 调用方，调用方也不 import 判据：契约 §2 性质 2 说的是
 * 判据之间不互调，而同一条分层纪律在这里同样适用。）
 *
 * ★ 只有 `task-status` 会在真实的 10 分钟节拍上反复发生 —— 用户裁定的
 *   "10 分钟探活一次"就发生在查状态时。`runtime-liveness` 是显式探活入口
 *   （夹具与将来的定时器用它），保留在名单里。
 */
const PROBE_EVENTS = Object.freeze(['task-status', 'runtime-liveness']);
const waitWindows = new Map();
const WAIT_WINDOW_LIMIT = 200;
/**
 * 一个窗口在多久没有被任何探活碰过之后，**不再被下一代继承**。
 *
 * ★ 取 3 个探活间隔（30 分钟）：正常的换代总是紧跟着探活（下一次 status 就会碰到它），
 *   所以真实路径上永远不会逼近这个界；而一个被遗忘的窗口（成员消失、任务悬停、
 *   记录被 LRU 淘汰）最迟 30 分钟后就再也继承不到 —— 于是"上一代已经结束的等待"
 *   不可能被无限期地当成还在跑。
 */
/**
 * 探活间隔的兜底值（与判据层的 `DEFAULT_LIVENESS_INTERVAL_MS` 同值）。
 *
 * ★ 这里**不 import 判据**（契约 §2 性质 2：判据之间不互相调用；反过来调用方
 *   直接 import 判据常量同样会把两层焊在一起）。这个数只用来给"窗口多久算陈旧"
 *   定一个界，它不参与任何裁决 —— 判据那边仍然自己持有它那份。
 */
const DEFAULT_PROBE_INTERVAL_MS_FALLBACK = 10 * 60_000;
const WAIT_WINDOW_STALE_MS = 3 * DEFAULT_PROBE_INTERVAL_MS_FALLBACK;
/** 窗口的键：队 + 任务 + 成员（★ 换成员即换窗口）。 */
function waitWindowKey(teamId, taskId, memberName) {
    return `${teamId}\u0000${taskId}\u0000${memberName}`;
}
/** 记一个等待窗口，并维持上限（与记录表同形态：有界的进程级状态）。 */
function putWaitWindow(key, window) {
    waitWindows.delete(key);
    waitWindows.set(key, window);
    while (waitWindows.size > WAIT_WINDOW_LIMIT) {
        const oldest = waitWindows.keys().next().value;
        if (oldest === undefined)
            break;
        waitWindows.delete(oldest);
    }
}
/**
 * 任务离开"未结束"集合时撤销它的窗口 —— **有界继承的最后一道**。
 *
 * ★ 队长点出的风险：*"否则上一代已经结束的等待会被当成还在跑"*。
 *   时间上的界（`WAIT_WINDOW_STALE_MS`）只能挡住"被遗忘的窗口"，
 *   挡不住"这个任务已经 completed/failed/cancelled，而它的窗口还新鲜"。
 *   ⇒ 终态是**语义上的界**，必须在任务真的结束那一刻把窗口撤掉。
 */
function forgetWaitWindow(teamId, taskId) {
    for (const key of [...waitWindows.keys()]) {
        const window = waitWindows.get(key);
        if (window === undefined)
            continue;
        if (window.teamId === teamId && window.taskId === taskId)
            waitWindows.delete(key);
    }
}
/** 记一条等待记录，并维持上限（最旧的先走）。 */
function putWaitRecord(record) {
    waitRecords.delete(record.attemptId);
    waitRecords.set(record.attemptId, record);
    while (waitRecords.size > WAIT_RECORD_LIMIT) {
        const oldest = waitRecords.keys().next();
        if (oldest.done === true)
            break;
        waitRecords.delete(oldest.value);
    }
}
/**
 * ── ★ 调用点①：派发时刻（等待起点）────────────────────────────────────────────
 *
 * 与 t6 的 `onDispatched` **同形状**：不返回值、不改派发结果。它只往记录表里放
 * 一行"这个尝试从此刻开始等"。调度器不读它的返回值（`evaluateRuntimeGates` 的
 * 返回值在 tools.ts:1140 那里被 `void` 掉），所以 **runtime 位置仍然拒绝不了任务**。
 *
 * ★ 起点【不是】从 `attempt.attempt` 或 `task.updatedAt` 推出来的：那些是**别的
 *   用途的**时间戳（任务记录的最后修改），拿它们冒充"成员开始干活了"，会让探活
 *   把"队长刚改过任务描述"读成"成员刚开工"。
 */
function recordDispatchStart(event) {
    /**
     * ── ★ V3-2：换代时【继承】上一代的等待窗口起点 ────────────────────────────────
     *
     * 见 {@link WaitRecord.startedAt}。这里取的是"同一个 (team, task) 上最近一条
     * 记录"的起点：那一代与本代是**同一次等待**，只是 capability 被换掉了。
     *
     * ★ 只在起点**更早**时继承（`Math.min`）：一个更晚的起点会让窗口反而变短，
     *   而窗口是单调向前的（时间只会往前走）。用 `min` 让"继承"在任何到达顺序下
     *   都只可能延长窗口，不可能伪造出一个更早的过去。
     *
     * ★ 上一代**已经留了活动读数**时，一并继承 `lastActivityAt` / `lastOutputKey`：
     *   否则换代会让"它其实一直在动"这个已经观察到的事实凭空消失 ——
     *   那与"没观察到"同形，而探活正是靠这一点分辨卡死。
     */
    /**
     * ── ★ V3-2 收口：窗口用【任务作用域的簿】认领，不再从记录表里"找上一代" ────────
     *
     * 见 {@link waitWindows}。判定"这是不是同一次等待"的三个条件，逐条对应
     * 那条有界继承的边界：
     *   · 键里含 teamId / taskId / memberName ⇒ 换队、换任务、换成员都不会误借；
     *   · 窗口必须**还活着**（`touchedAt` 在 `WAIT_WINDOW_STALE_MS` 之内）
     *     ⇒ 一个已经结束/被遗忘的等待不会被下一代继承；
     *   · 窗口**只被认领一次**（认领即续命），于是"两个成员同时抢同一个窗口"不可能。
     */
    const key = waitWindowKey(event.teamId, event.taskId, event.memberName);
    const existing = waitWindows.get(key);
    /**
     * ★ 有界继承的**第三条界**：`attempt` 必须**没有跳号**（没跳 = 同一次等待的连续）。
     *   跳号 ⇒ 任务真的重来了 ⇒ 新窗口（这条与 t5 的臂 5 是同一件事）。
     */
    /**
     * ★ 连续 = 调度器说这是"给一个已经在等待的尝试补一次投递"（`continued`）。
     *   重来（`continued` 为假）⇒ 新窗口 —— 那条与 t5 的臂 5 是同一件事。
     */
    /**
     * ★ 上一代的产出指纹/计数：从中取（键与窗口同口径：队+任务+成员）。
     *   换代是**同一次等待**，所以"我看过它的哪一条输出"这件事跨代成立。
     */
    const previousRecord = [...waitRecords.values()]
        .filter((record) => record.teamId === event.teamId && record.taskId === event.taskId && record.memberName === event.memberName)
        .sort((a, b) => (b.lastPollAt ?? b.startedAt) - (a.lastPollAt ?? a.startedAt))[0];
    const previousOutputKey = previousRecord?.lastOutputKey;
    const previousActivityCount = previousRecord?.activityCount ?? 0;
    const continued = existing !== undefined && event.continued;
    const alive = continued && event.dispatchedAt - existing.touchedAt <= WAIT_WINDOW_STALE_MS;
    /**
     * ★ 起点取 `min`：窗口**只可能变长，不可能被伪造出一个更早的过去之外的形状**。
     *   一个更晚的起点会让"已等多久"缩水，而时间只会往前走。
     */
    const window = {
        teamId: event.teamId,
        taskId: event.taskId,
        memberName: event.memberName,
        attempt: event.attempt,
        startedAt: alive ? Math.min(existing.startedAt, event.dispatchedAt) : event.dispatchedAt,
        ...alive && existing.lastPollAt !== undefined ? { lastPollAt: existing.lastPollAt } : {},
        ...alive && existing.lastPolledActivityAt !== undefined ? { lastPolledActivityAt: existing.lastPolledActivityAt } : {},
        touchedAt: event.dispatchedAt,
    };
    putWaitWindow(key, window);
    /**
     * ── ★ 新记录**不**自带一个"刚观察过"的活动读数 ────────────────────────────────
     *
     * MEASURED：换代之后紧接着 `observeMemberActivity` 会跑一次（派发即观察），
     * 而它写的是"**现在**"——于是即使成员一句话都没说，新记录也会带上一个
     * 等于 `now` 的活动读数。判据下一次比较时看到"上一次读到的也是刚动过"
     * ⇒ **永远相等** ⇒ 静默成员不报警（或迟一次）。
     *
     * ⇒ 换代继承的是**上一代真的观察到的那个时刻**（窗口上的 `lastPolledActivityAt`
     *   或上一代记录的 `lastActivityAt`），而不是"现在"。这让"观察到产出"这件事
     *   只在**真的产出**时前进 —— 与"工具被调用不是产出"是同一条纪律。
     */
    const inheritedActivity = window.lastPolledActivityAt;
    putWaitRecord({
        teamId: event.teamId,
        taskId: event.taskId,
        memberName: event.memberName,
        attemptId: event.attemptId,
        startedAt: window.startedAt,
        ...inheritedActivity === undefined ? {} : { lastActivityAt: inheritedActivity },
        /**
         * ── ★★ 产出指纹必须**跨代继承** —— 这是 V3-2 最后一位，也是整条链上最隐蔽的一处 ──
         *
         * MEASURED（2026-10-06，把窗口做成一等对象之后仍然差一格）：
         * `observeMemberActivity` 靠 `lastOutputKey` 判断"这条输出我是不是已经看过"
         * （`if (record.lastOutputKey === key) return false` —— 它不刷新活动时刻）。
         * 而换代产生的是**新记录**，那一代没有指纹 ⇒ 这条判断失效 ⇒ 派发时那次观察
         * **无条件**把 `lastActivityAt` 写成 `now`。
         *
         * ⇒ 后果：换代之后，探活读到的"最后活动时刻"永远是"刚刚"，
         *   于是「两次探活之间它动过没有」**永远相等** ⇒ 静默成员不报警
         *   （或只在换代停止之后才报一次）。这正是"迟一次探活"的根因，
         *   而它看起来完全不像缺陷 —— 观察是**合法**发生的，只是指纹丢了。
         *
         * ★ 与 `lastActivityAt` 一起继承是必须的：只继承时刻而不继承指纹，
         *   下一次观察仍会因为"没有指纹可比"而重新盖一次时间。
         */
        ...previousOutputKey === undefined ? {} : { lastOutputKey: previousOutputKey },
        activityCount: previousActivityCount,
    });
}
/**
 * ── ★ 调用点②：最后活动时刻（"它还在动吗"）─────────────────────────────────────
 *
 * 读法与 `observeMemberConvergence`（本文件 1030 行附近）**同源**：从该成员自己的
 * 会话日志里读 `assistant/message`。区别只有一处，而它是整件事的关键：
 *
 *     ★ 事件【不带时间戳】⇒ "什么时候说的"读不出来，
 *       必须【在观察到产出的那一刻，由我方取一次时钟】。
 *
 * ⇒ 所以本函数做两件事，且**顺序不能反**：
 *     1. 先读会话日志，看有没有 `assistant/message`；
 *     2. **只有真的看到了**，才向注入的时钟取一次时刻。
 *
 * ★ 反过来（先取时钟再看日志）会在"这次没看到产出"时白记一个时刻 —— 那会让
 *   "它没动"与"它刚动过"在记录里同形，而探活判据要分辨的正是这件事。
 *
 * ★ 三态与"记录 ≠ 观察"这条纪律（t12 的教训）：
 *   · 读到会话、且**看到了一条新的** `assistant/message` ⇒ 记下**当前时刻**
 *   · 读到会话、但一条都没有                      ⇒ **什么都不记**（"没观察到产出"，
 *                                                   不是"观察到零产出"）
 *   · 读不到会话（没有 live Agent / 日志炸了）    ⇒ **什么都不记**，且**不伪造**
 *
 * ── ★★ "看到输出"与"看到【新的】输出"不是一回事（这是本函数最容易写错的一处）──
 *
 * 成员会话里的 `assistant/message` **会一直留在那里**：它是一条历史日志。所以
 * 每次探活都"看得到输出" —— 若把"看得到"当成"它在动"，`lastActivityAt` 会随着
 * 每一次探活前进，于是"两次探活读数没变"**永远不成立**：
 *
 *     探活一次 ⇒ 读到历史输出 ⇒ 刷新时刻 ⇒ 看起来刚动过
 *     探活两次 ⇒ 同上         ⇒ 再刷新     ⇒ 看起来还是刚动过
 *     ⇒ **一个卡死的成员永远健康**，而这条判据**永远不报警**。
 *
 * ⇒ 所以记录里要留一个**已观察到的输出指纹**（`lastOutputKey`），只有指纹变了
 *   （＝真的又多了一条输出）才推进 `lastActivityAt`。这一位是判据能不能分辨
 *   "卡死"与"还在跑"的**全部**依据，而它必须落在记录里（跨步骤的状态）。
 *
 * ★ 指纹取"最后一条 assistant 消息的文本长度 + 条数"而不是全文：会话可以很长，
 *   而这里只需要分辨"有没有多一条"。★ 但它是**内容无关**的 —— 一个成员反复输出
 *   同样的话仍会推进（那是 `assistant/message` 条数变了），符合用户裁定的
 *   "以产出为准（有 assistant/message 才算在动）"。
 *
 * ★ 这三支的差别在于"有没有往记录里写一个时刻"，而不是在于返回值 —— 调用方
 * （`onDispatched` 与 `agent_teams_status`）都不需要读它。
 *
 * @returns 本次是否观察到了**新的**产出（供夹具与诊断使用；**不参与任何裁决**）。
 */
function observeMemberActivity(ctx, memberId, attemptId, now) {
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
/**
 * 一个成员会话里【产出】的指纹：`undefined` 表示"没有可观察的产出"。
 *
 * ★ 与 `sessionSpokeWithContent` 同源、同一个读法，但回答的是不同问题：
 *   · `sessionSpokeWithContent` —— "它有没有说过非空的话"（布尔）
 *   · 本函数                   —— "**说的是哪一次**"（可比较的指纹）
 * 后者才是"最后活动时刻"能成立的前提：没有它，每次探活都会重新发现那条旧输出。
 */
function sessionOutputKey(session) {
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
/**
 * 读一个成员会话里【有没有非空的 assistant 输出】。
 *
 * ★ 与 `observedSpoke` 的关系：同源、不同问题。
 *   · `observedSpoke` 答"**最近一次**输出是不是空的"（收敛判据要的）；
 *   · 本函数答"**有没有过**输出"（探活要的）。
 *
 * 为什么探活不能直接复用 `observedSpoke`：它读的是**最后一条** assistant 消息，
 * 而"最后一条是空的"在一个还在干活的成员身上也会发生（例如它先说了句话、然后
 * 输出了一段空文本）。探活要问的是"它有没有真的动过"，那个问题对"最后一条"不敏感。
 */
function sessionSpokeWithContent(session) {
    if (session === null || typeof session !== 'object')
        return false;
    let events;
    try {
        events = sessionOwnEvents(session);
    }
    catch {
        return false;
    }
    if (!Array.isArray(events))
        return false;
    return events.some((event) => {
        if (event === null || typeof event !== 'object')
            return false;
        if (event.type !== 'assistant/message')
            return false;
        const content = event.message?.content;
        if (!Array.isArray(content))
            return false;
        return content.some((block) => (block !== null && typeof block === 'object'
            && block.type === 'text'
            && typeof block.text === 'string'
            && block.text.trim() !== ''));
    });
}
/**
 * ── ★ 调用点④：团队级观察（`task-status` / `delivery-declared` 共用）──────────────
 *
 * 这两个调用点【没有单个 task】—— 它们问的是"这个团队现在什么情况"。所以探活判据
 * 从它们那里拿到的是 `waits`（**每个未结束尝试一条**），而不是 `wait`。
 *
 * ★ `wait` 与 `waits` 不同形不是重复，是两种问题（与 t12 那条"记录 ≠ 观察"同源）：
 *     · `wait`  —— "**这个任务**等了多久"（发生在某一步的上下文里）
 *     · `waits` —— "**这个团队里**有谁在等、等了多久"（发生在快照/交付的时刻）
 *   把它们合成一个"wait 或 waits"的字段，会让"我知道这一个任务"与"我把队里所有
 *   等待都看了一遍"在判据里同形 —— 而后者才知道"谁卡住了"。
 *
 * ★★ 空数组与缺席必须不同形（本文件已经为 `members` 立过同一条界线）：
 *   · `waits: []`  —— 观察了：这个团队**此刻没有任何等待中的尝试**
 *   · `waits` 缺席 —— 没能观察（例如状态读取失败）⇒ 判据按自己的契约 unmeasured
 *
 * ★ 只有**未结束**的尝试才进来：一个已经 completed / failed / cancelled 的任务不在
 *   等任何人。把终结的任务也列进去，探活会为一个**早就结束**的尝试报"它卡住了"。
 */
function teamWaitObservations(team, now, event) {
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
/**
 * ── ★ 调用点③：把等待观察交给 runtime 判据（六个调用点共用）───────────────────
 *
 * 这是本模块**唯一**构造 `wait` 的地方。六处调用（member-dispatched /
 * task-created / task-update / task-update-settled / task-status /
 * delivery-declared）都经它取观察，于是"同一个尝试在不同步骤里读到不同的等待"
 * 这件事在**形状上**不可能发生。
 *
 * ★★ 读不到 ⇒ **不注入**，而不是注入一个默认值。
 *
 * 这是 t5 验收里那句"读不到时不得伪造 —— 不注入，让判据自己报 unmeasured"。
 * 具体地：没有匹配的等待记录 ⇒ 返回 `undefined` ⇒ `wait` 字段**不出现在 ctx 里**
 * ⇒ 判据按自己的契约说"我没能测量"。**调用方绝不在这里替判据决定"那就算通过"**
 * （本文件在 `inject` 那一段已经为这条纪律写过一段说明）。
 *
 * ★ 哪些情形"读不到"（每一种都必须不同形于"读到了"）：
 *   · 这个尝试没有派发记录（例如队长自己接管的任务）⇒ 没有起点 ⇒ 不注入；
 *   · `attemptId` 缺席（任务还没被派发过）⇒ 不注入；
 *   · 记录在，但起点不可用 ⇒ 不注入。
 *
 * ★ 每次交接都推进 `lastPollAt`：**"上一次探活"是这次探活产生的**，所以它属于
 *   交接这一步，而不是属于记录本身。判据不用它算"第几次"，只用它分辨
 *   「这是第一次探活」（字段缺席）与「上次探活在 T」（字段在）。
 */
function waitObservationFor(teamId, taskId, attemptId, now, memberName, 
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
/**
 * ── ★ 判据的输入面：A 层核对的【唯一】接线点（t10）────────────────────────────
 *
 * 这个函数是编排层对 `src/gates/requires.ts` 的全部使用。八处调用点一个不少地
 * 走它 —— 包括那六处 `runtime` 调用点，它们全部经 {@link evaluateRuntimeGates}
 * 进来，而那个入口是注入面（`wait` / `waits`）**唯一**的构造点。
 *
 * ── ★ 为什么必须逐格手接会输（这段话是本任务存在的理由）───────────────────────
 *
 * MEASURED（2026-10-05 复盘）：11 条判据的输入面**每一格都是手工单独接的**，而五次
 * 同形缺陷全部落在这一格上：
 *
 *     inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配 → 窗口表没接线
 *
 * 五次都不是判据写错，而是"判据要的那一格 ctx 没接上"。它们的共同形状是：
 * **判据照常跑、照常说话，只是它说的是"我没能测量"** —— 在日志里与"这一步没问题"
 * 同形。⇒ 判据自己声明 `requires`（B 层类型），编排层在这里按声明核对**真实 ctx**
 * （A 层实测），"接没接上"于是成为一次机械核对，而不是人眼审查。
 *
 * ── ★ 三条纪律，每条都对着一个已经踩过的坑 ────────────────────────────────────
 *
 * ① **先核对、再求值**。顺序是刻意的：核对读的是**调用方交出去的那份 ctx**，
 *    所以"判据要的格子在不在"这个问题必须在判据开口之前就回答。反过来（先求值
 *    再核对）会让核对结果依赖判据自己有没有副作用地补上某一格 —— 那时它核对的
 *    已经不是调用方的接线了。
 *
 * ② **不适用 ⇒ 不核对、不报**（`requires.ts` 的闸门）。11 条判据 × 8 个调用点
 *    = 88 种组合，**大部分本来就该"不适用"**：一条只在 `task-status` 上开口的
 *    探活判据，在 `task-created` 那一刻缺时钟，本来就是设计的一部分。在那些组合上
 *    喊"缺这缺那"正是"教人忽略门禁"的老路（本队已有实测：噪音与误报同样有害）。
 *    所以这里**原样转发**判据自己的 `appliesTo`，且用与注册表**同一份函数引用**
 *    —— 两份口径会分叉，而分叉的两次调用在日志里同形。
 *
 * ③ **核对不拒绝任何东西**（先软后硬，用户裁定）。本函数只**产出**一份旁路结果，
 *    它进求值结果的 `requires` 字段，与 `observed` 平级；它不参与
 *    `ok` / `blockers` / `unmeasured`，也不改 `evaluated` / `skipped` / `registered`
 *    任何一个计数。一个自己还没被验证过的新机制没有资格当场否决别人的任务 ——
 *    这正是本队"判据误伤的代价比漏报更贵"那条的同一个形态。
 *
 * ── ★ 三条边界，必须与注册表那一份对齐（否则核对会报出一个判据不认的结论）──────
 *
 *   · **核对谁**：`auditRequires(subjects, ctx)` 把 `applies` 交给
 *     `checkRequires` 去问 `subject.appliesTo` —— 与注册表求值时调的是**那个
 *     函数**，只不过它由审计层调一次、由注册表调一次（每轮各一次，纯读）。
 *     ⇒ 只有在 `appliesTo` 带副作用或自己读时间时两者才可能不同，而本仓库的
 *       11 条 `appliesTo` 全部是纯读（它们在 `src/gates/**` 里，本任务不改）。
 *     不适用的仍落在 `skipped`、不报缺失 —— 于是 `requires.checks` 与 `ran[]`
 *     按 id 一一对得上。
 *   · **`requires` 缺席**：`checkRequires` 给 `skipped` + `undeclared`，这**不是**
 *     噪音（它不进 `missing`）—— 它是"这条判据的输入面还没被声明"的覆盖率读数。
 *   · **`appliesTo` 抛错**：`checkRequires` **不捕获**（与注册表同口径）。一个
 *     "核对层能容错、求值层不能"的分叉会让那一刻的核对结果变成幻觉。
 */
function auditGateRequires(point, context) {
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
/**
 * ── ★★ 核对结论的**结构化出口**（t3）：五处只有 `logger.warn` 的地方补齐 ──────────
 *
 * MEASURED（2026-10-06，integrator4 在 t9 钉住的不对称）：
 *
 *     六处 `auditGateRequires` 调用点里，**只有 runtime** 把核对结论随记录交出去
 *     （`runtime_gates.input_surface`）；contract / dispatch / completion / delivery×2
 *     **只有一个 `logger.warn`**。
 *
 * ⇒ 日志被截断或关掉时，「**报缺**」与「**输入面是齐的**」同形。这不是"日志不好"，
 *   是**同一个结论只有一条读取路径**时的固有弱点：本队已经栽过一次同名形态 ——
 *   `scripts/gate-input-wiring.test.mjs` 臂 8 的第一版挂在 contract 位置、却去读只有
 *   runtime 才有的 `input_surface` ⇒ 断言**恒真**（规则二点名的形态）。
 *
 * ── ★ 用户裁定（甲 + 总是出现）────────────────────────────────────────────────
 *
 * 四处统一挂 `input_surface`，且它**总是出现**（不省略）：
 *
 *     都齐            ⇒ 字段在场，`incomplete: 0`
 *     有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
 *     这个位置没判据  ⇒ **字段不出现**（与"有判据且都齐"不同形）
 *
 * ★ 为什么不能用「字段不出现」表达「齐」（乙方案被否的依据）：runtime 那边**既有**
 *   的注释（见 `evaluateRuntimeGates` 的返回处）已经写明过这条纪律 ——
 *   「缺席 ⇒ 字段不出现。**不是 `ok`**」。而「**有判据但都齐**」与「**这里没判据**」
 *   是**两件事**，必须不同形。
 *
 * ── ★ 形状与 runtime **完全一致**（可机械比对，不是"看起来差不多"）──────────────
 *
 *     { checked, incomplete, skipped, missing }
 *
 * ★ 只有 runtime 那处多一格 `outcome`（它回答的是另一个问题："判据跑了、说了什么"）。
 *   本函数**不**产出 `outcome`：那会让四处看起来也有一个"裁决"，而这个出口的
 *   语义只有一个 —— **输入面接没接全**。第四个字段也不加（`notApplicable` /
 *   `inputSurfaceAbsent` / `gateCellsUndeclared` / `checks` 都在 `RequiresAudit` 上）：
 *   多一格就多一处可以分叉的地方，而分叉之后两个 `input_surface` 在断言层面不同形。
 *
 * ── ★ 三态在两边的区分方式**刻意不同**，这不是分叉，是同一个决定的两种落点 ───────
 *
 *     runtime 调用点（六处）   核对结论是**它自己的返回记录**（`runtime_gates`）
 *                              ⇒ 包一层：`runtime_gates` 缺席 = 这个事件没挂判据
 *     contract/dispatch/…      核对没有自己的记录，结论只能挂在**调用方已经要交出去的**
 *                              那个对象上（`delivery` 字段 / 前置块声明的一次 `throw`）
 *                              ⇒ 那里没有"再包一层"的余地：`input_surface` 必须直接到场
 *
 *   ⇒ 于是本函数**只在有判据时**返回结果（`undefined` ⇒ 调用方挂不上字段）：
 *     字段缺席的唯一成因就是"这个位置这一轮没有挂判据的判据"。**它不是 `ok`** ——
 *     把"这里没有约束"读成"约束通过了"，正是三态要防的那种合流。
 *
 * ── ★ 末句：它不参与任何裁决 ───────────────────────────────────────────────────
 *
 * 与 {@link auditGateRequires} 同一条纪律（先软后硬）：本函数只**产出**一份读数。
 * 返回 `undefined` 的唯一后果是"少挂一个诊断字段"，**不是**拒绝、不是跳过、
 * 也不改任何既有控制流 —— 于是"补出口"这件事对生产路径的裁决零影响。
 */
function inputSurfaceOf(point, context) {
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
/**
 * 跑 `runtime` 位置，并且**无论它返回什么都继续**（契约 §5 硬要求）。
 *
 * ★ 三态 + 一个不同的第四种情形，四种在返回值里【互不同形】：
 *
 *   · 缺席（`undefined`）        —— 这个事件类型没有挂任何 runtime 判据。
 *                                  **不是** `ok`：把"这里没有约束"读成"约束通过了"
 *                                  正是本队要防的那种合流。
 *   · `ok`                       —— 判据跑了、没问题。
 *   · `blocked`                  —— 判据跑了、发现了问题（只记录，不拒流程）。
 *   · `unmeasured`               —— 判据跑了、说"我测不了"（★ 与 blocked 不同形）。
 *   · `threw`                    —— ★ 判据【自己抛了】。这是一条独立的结论：一条
 *                                  抛错的判据既不是"发现问题"也不是"没能测量"，
 *                                  而它在日志里与"通过"同形是最坏的形态。
 *
 * ★ 与调用点纪律的关系：只有调用方知道"这个事件是不是某条运行判据适用的事件"。
 *   本模块不读 context（不替判据猜），也不把"没跑"记成 `ok`。
 *
 * ★ `clock`（t5）：本入口是**唯一**给 runtime 判据注入时钟读数的地方。它由
 *   `registerAgentTeamsTools` 的 `config.now` 决定（缺省 `Date.now`），于是：
 *   · 生产路径上六处调用点读到的是同一个时钟；
 *   · 夹具注入一个假时钟，就能**不真的等待**地构造"两次探活之间没有任何产出"。
 *
 *   ★ 判据层绝不自己读时间（契约 §2 性质 1）—— 它拿到的是 ctx 里的 `wait.now`。
 */
async function evaluateRuntimeGates(ctx, event, context, clock = Date.now) {
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
    const outcome = evaluation.ok === false
        ? evaluation.unmeasured !== undefined ? `unmeasured: ${evaluation.unmeasured}` : `blocked: ${evaluation.blockers.join('; ')}`
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
/**
 * ── ★ 判据层：contract / delivery / runtime 三个位置的接线（t6）────────────────
 *
 * MEASURED（2026-10-05，t6）：注册表声明五个【位置】，此前只有 `dispatch`（1 处）
 * 与 `completion`（3 处）真的被调用。`contract` / `delivery` / `runtime` 三个位置
 * **没有任何 `registry.evaluate` 调用点** ⇒ 往那里挂判据永远不会跑。本队已经反复
 * 见过这个形态（"装了但调不到"），所以这三个位置的接线与 fixtures 是同一次改动。
 *
 * ★ 接线纪律（三条，都来自契约）：
 *
 *   ① **叠加，不替换**：新调用点一律落在既有检查【之后】。`contract` 在
 *      `validateCreateTask` / `amendTaskContract` 之后，`delivery` 在
 *      `canDeclareDelivery` 之后，`runtime` 在既有状态迁移之外。既有四个调用点的
 *      裁决顺序与语义一个字都没动。
 *
 *   ② **runtime 不得阻止流程**（契约 §5）：它返回任何裁决都只【记录】。拒任务该由
 *      `completion` / `delivery` 位置上的一条判据去读那条记录，而不是让过程约束
 *      当场把任务卡死。"过程"与"裁决"混在一处，正是契约 §5 要分开的东西。
 *
 *   ③ **缺席 ≠ 通过**：没有挂判据的位置保持今天的行为（不拦），但调用方拿到的
 *      返回值是 `undefined` 而不是 `{ok:true}` —— 两者必须不同形。
 */
/**
 * 在 `contract` 位置跑判据，并用与既有位置【完全同形】的方式拒绝。
 *
 * ★ 位置：`validateCreateTask`（建任务）与 `amendTaskContract`（改契约）**之后** ——
 *   契约层自己的校验先说话，判据层再叠加。这样"契约本身合法"这件事的既有裁决
 *   一点没变，而"契约是否可判"（例如 verify 命令能不能真的判定）可以后挂上来。
 *
 * ★ 为什么拒绝的措辞与 dispatch/completion 一致：读日志的人要能一眼看出"这是判据层
 *   拒的、拒的是哪个位置"，而三态的措辞必须分开（发现的问题 vs 没能测量）。
 *
 * ★ `inject`（t18）：判据需要的执行器由本层（唯一做 I/O 的地方）注入。此前两个
 *   contract 调用点都**没有**注入 `execVerifyCommand`，于是 `contract.verify-command`
 *   在生产路径上永远 `unmeasured` —— 见 create_task 处的详细说明。
 *
 * ── ★★ 返回值（t3）：本函数**交出**它这一次的核对结论 ──────────────────────────
 *
 * MEASURED（2026-10-06，t9）：本位置此前**只有一个 `logger.warn`** —— 日志被截断
 * 或被关掉时，「报缺」与「输入面是齐的」在返回值上同形。用户裁定：这四处统一挂
 * `input_surface`，形状与 runtime 完全一致（见 {@link inputSurfaceOf}）。
 *
 * ★ 它为什么是**返回值**而不是写进 `context` / 某个全局：成功路径上调用方
 *   （`create_task` / `amend_task`）本来就有一个要交出去的结果对象，核对结论挂在那里
 *   才与 `runtime_gates` 同一条纪律（"随记录交出去"）。返回 `undefined` ⇒ 这个位置
 *   这一轮没有挂判据 ⇒ **字段不出现**（三态里的第三种，不是 `ok`）。
 *
 * ★ 它与拒绝路径的关系**只有一个方向**：先算出结论，再交给 `rejectWithSurface` 包装
 *   任何一次真实的拒绝。⇒ 缺格的结论**永远到得了调用方**，而它一次也不曾参与裁决
 *   （"先软后硬"：核对报缺时流程照常走完，见 {@link auditGateRequires}）。
 */
async function rejectOnContractGates(ctx, context, what, inject = {}) {
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
        if (gates.unmeasured !== undefined) {
            throwWithSurface(`${what} rejected: the contract gate could not measure (${gates.unmeasured})`, inputSurface);
        }
        throwWithSurface(`${what} rejected: ${gates.blockers.join('; ')}`, inputSurface);
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
/**
 * ── ★★ 「说出缺格」与「抛出拒绝」必须能同时发生（t3）────────────────────────────
 *
 * 这是本任务里唯一一处**形状上的**难点，值得写清楚它为什么是现在这样。
 *
 * 用户裁定四处都要挂 `input_surface`，而其中三处（contract / dispatch / completion）
 * 走的是**异常路径**：`create_task` / `update_task` 拒绝一次调用时不返回任何结果对象，
 * 只有一句 `throw new Error(...)`。于是"把结论交出去"在那里没有对象可挂 ——
 * 除非拒绝本身**带着**它走。
 *
 * ★ 为什么不是"先挂一个变量、让调用方去读"：那会让结论只在"读得到那个变量"的地方
 *   存在，而**拒绝路径**恰恰是最需要它的地方 —— 一次被拒的 create_task 里，
 *   "是契约本身不合法"与"是判据要的那一格没接上"正是最容易合流的两件事（前者是
 *   拒绝的理由，后者不是）。
 * ★ 也不是把结论并进 `error.message` 的那句话里：`missing` 的每一行本来就长，
 *   混进人话之后，"读字段"变成"解析字符串"，而那正是本任务要消灭的读取方式
 *   （"日志被截断时同形"）。
 *
 * ⇒ 结论挂成一个**结构化的自有属性**（`Error` 的自有可枚举属性，不经任何序列化）。
 *   钩子把它原样搬进工具结果的 `input_surface` 字段（见 `defineTool` 的返回处）。
 *   没有钩子的调用方（既有的测试、宿主）读不到它 —— 但那与"没挂"不同：属性在不在
 *   是**可判定**的，而"只写日志"在那些调用方那里根本无法判定。
 *
 * ★ 从 `throw new Error(...)` 改成 `throwWithSurface(...)` 是**行为等价**的：
 *   抛出的仍然是一个普通 `Error`（`instanceof Error` 与 `message` 逐字不变），
 *   只是多挂了一个自有属性。
 */
function throwWithSurface(message, surface, 
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
    const error = new Error(message);
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
/**
 * 拒绝上挂的那一格叫什么。
 *
 * ★ 取一个**带命名空间前缀**的名字（而不是 `input_surface`）：它跟着一个异常对象
 *   走，而异常对象可能被宿主序列化、被日志打印。一个叫 `input_surface` 的自有属性
 *   会在任何一次 `{...error}` 里伪装成"工具结果的字段"，而它其实只在**工具边界**
 *   才被搬成那个字段（见 `defineTool` 的返回处）。两个名字分开，"挂在哪"读得出来。
 */
const INPUT_SURFACE_PROPERTY = 'agentTeamsInputSurface';
/**
 * 结论**应该落到哪个字段名**（见 {@link throwWithSurface} 的 `field` 参数）。
 *
 * ★ 与 `INPUT_SURFACE_PROPERTY` 分开的第二个名字：一个是"结论本体"，一个是"落点"。
 *   ★ 缺席 ⇒ 落点用缺省的 `input_surface`（那四个只有单一入口的位置）。
 */
const INPUT_SURFACE_FIELD_PROPERTY = 'agentTeamsInputSurfaceField';
/** 一次拒绝要落到工具结果的哪个字段上（缺省 `input_surface`）。 */
function inputSurfaceFieldOf(error) {
    if (error === null || typeof error !== 'object')
        return 'input_surface';
    const field = error[INPUT_SURFACE_FIELD_PROPERTY];
    return typeof field === 'string' && field.trim() !== '' ? field : 'input_surface';
}
/**
 * 从一次抛出里取回核对结论（见 {@link throwWithSurface}）。
 *
 * ★ 三态之一"这个位置没有判据"与"这次抛出没带结论"在这里**合并成 `undefined`**，
 *   而且是刻意的：本函数的读者是**工具边界**，它问的是"这次调用有没有一份要交出去的
 *   核对结论"。至于"为什么没有" —— 那是*上面*那个结论自己回答的问题（字段在不在），
 *   边界没有资格替它回答，也不该发明第二种说法。
 */
function inputSurfaceFromThrown(error) {
    if (error === null || typeof error !== 'object')
        return undefined;
    const carried = error[INPUT_SURFACE_PROPERTY];
    if (carried === null || typeof carried !== 'object')
        return undefined;
    return carried;
}
/**
 * 读一个成员会话里【最后一次 assistant 输出是不是空的】。
 *
 * ★ 返回值三态，与判据自己的 `spoke` 三态对齐：
 *   · `true`      —— 观察到了：最近一次输出非空
 *   · `false`     —— 观察到了：最近一次输出是空的（★ 这才是"空回复不是收敛"要抓的）
 *   · `undefined` —— **没能观察**（读不到会话日志 / 一条 assistant 消息都没有）
 */
function observedSpoke(session) {
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
/**
 * 观察每个成员的收敛面。
 *
 * ★ 只有【真的读不到】才返回 `undefined`（调用方据此不注入 ⇒ 判据说 unmeasured）。
 *   "读不到"与"读到了一条**可判定的事实**"必须分开 —— 见下面未 spawn 成员那一支。
 */
function observeMemberConvergence(ctx, team) {
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
export function registerAgentTeamsTools(ctx, config) {
    installRetiredMemberGuard(ctx, config.stateDir);
    installMemberDelegationGuard(ctx, config.stateDir, config.memberMaxDepth ?? 0);
    installMailboxAdmission(ctx, config.stateDir);
    /**
     * ★ 时钟（t5）：整个插件只从这一个地方读时间给判据用。
     *
     * 与 `judgeRuntimeGates` 里那个 `Date.now`（运行记录的**写入时刻**）是两个用途：
     * 那个是"这条记录是什么时候写的"，这个是"这次求值的观察时刻"。合流会让夹具
     * 推进假时钟时，运行记录上的时刻跟着跳 —— 而运行记录是给人看的审计，它必须
     * 反映真实墙上时间。
     */
    const clock = () => config.now?.() ?? Date.now();
    const scheduler = installTeamScheduler(ctx, {
        stateDir: config.stateDir,
        executionPrompt: config.executionPrompt,
        dispatch: dispatchMember,
        /**
         * ★ 时钟（t5）：调度器与判据层读**同一个**可注入时钟。
         *
         * 两处各读各的（调度器读 `Date.now`、判据读另一个）不会当场出错，但会让
         * "派发在 T 发生"与"探活在 T' 读到起点"之间没有一个共享的参照 —— 夹具
         * 推进假时钟时就会只推进一半，于是超时永远测不出来，而测试**看起来是绿的**
         * （因为没人真的等过）。
         */
        now: clock,
        // ★ 把派发时拿到的隔离基准记下来，供 completion 位置的 r5 / 回测判据使用。
        onWorktree: (taskId, base) => rememberWorktreeBase(taskId, base),
        /**
         * ★ runtime 位置：成员被【派发】这一刻。
         *
         * 契约 §5 的例子正是这一条：「在成员被派发时启动（计时器）；超时 ⇒ 产生一条
         * "这个成员超时了"的记录；它不直接拒任务」。所以这里只记录、不拒绝 ——
         * 拒绝派发是调度器自己的事（worktree 建不出来那条路径），不是过程约束的事。
         *
         * ★ 记录发生在【投递被接受之后】(`accepted === true`)。投递失败 ⇒ 任务回滚、
         *   成员没开工 ⇒ 那不是"派发过"。把失败的投递也记成一次派发，会让运行判据
         *   读到一个从未发生的事件。
         *
         * ★ t5 在这里做了两件事，**顺序有意义**：
         *   ① `recordDispatchStart` —— 把"这个尝试从此刻开始等"记进等待记录表。
         *      这是探活判据要的**等待起点**，而它只在这一刻可得（派发一结束，
         *      那个时刻就没有第二个来源了：任务记录上的 `updatedAt` 是别的用途，
         *      拿它冒充"成员开工了"会让"队长刚改过任务"读成"成员刚开工"）。
         *   ② `observeMemberActivity` —— 派发刚被接受时，成员**可能已经**产出过
         *      （冷恢复/接续的情形：会话里本来就有非空输出）。所以这里先观察一次，
         *      否则"它其实一直在动"会被读成"它一直没动"。
         *
         * ★ 返回值仍然被 `void` 掉：runtime **不得拒绝任务**（契约 §5 硬要求）。回调
         *   的签名是 `void`，没有可读的返回值，所以这条约束是**类型上**保证的，
         *   而不是靠纪律。
         */
        onDispatched: (event) => {
            recordDispatchStart(event);
            observeMemberActivity(ctx, event.memberId, event.attemptId, event.dispatchedAt);
            void evaluateRuntimeGates(ctx, 'member-dispatched', event, clock);
        },
    });
    const memberSelections = installMemberSelectionRuntime(ctx, config.stateDir, (workspace, teamId, memberName) => (scheduler.kickMember(workspace, teamId, memberName)));
    async function dispatchMember(captain, teamId, memberName, text, signal, mode, attemptId) {
        const root = stateRootOf(workspaceOf(captain), config);
        // Record why a member never started. The scheduler treats a failed dispatch as
        // "not now" and retries, so without this the captain only ever sees an
        // unexplained `unspawned` member and no diagnostic reaches any surface.
        const recordSpawnError = async (reason) => {
            try {
                await withTeamLock(teamLockKey(root, teamId), async () => {
                    const fresh = await requireFreshCaptainTeam(root, teamId, captain.id);
                    const failed = fresh.members.find(item => item.name === memberName && item.status !== 'removed');
                    if (failed === undefined || failed.id !== '')
                        return;
                    failed.spawnError = reason;
                    await writeTeam(root, fresh);
                });
            }
            catch (error) {
                ctx.logger.warn(`agent-teams: could not record the member start failure for ${memberName}: ${String(error)}`);
            }
        };
        let orphan;
        try {
            return await withTeamLock(teamLockKey(root, teamId), async () => {
                const team = await readTeam(root, teamId);
                if (team?.captainSessionId !== captain.id || team.halted === true || team.phase === 'staged')
                    return false;
                const member = team.members.find(item => item.name === memberName && item.status !== 'removed');
                if (member === undefined || member.stopping === true || team.tasks.some(task => task.reassigning === true && task.assignee === memberName))
                    return false;
                if (attemptId !== undefined && !team.tasks.some(task => task.attemptId === attemptId && task.assignee === memberName && (task.status === 'claimed' || task.status === 'in_progress')))
                    return false;
                if (member.id !== '')
                    return deliverToMember(ctx, captain, member.id, text, signal, mode);
                const selection = await resolveMemberLlmSelection(ctx, captain, {
                    provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort, fallback: member.fallback,
                }, signal);
                await spawnMember(ctx, memberRuntime(config), memberSelections, selection, captain, team, member, config.stateDir, signal, text);
                orphan = { ...member };
                delete member.spawnError;
                await writeTeam(root, team);
                orphan = undefined;
                return true;
            });
        }
        catch (error) {
            if (orphan !== undefined) {
                await recordRetiredMemberIds(root, [orphan.id]);
                await stopTeamMemberActivations(ctx, captain, [orphan]);
            }
            // The stack carries the failing frame; the message alone rarely does.
            let reason = String(error);
            if (error instanceof Error && typeof error.stack === 'string' && error.stack !== '')
                reason = error.stack;
            ctx.logger.warn(`agent-teams: member dispatch failed for ${memberName}: ${String(error)}`);
            await recordSpawnError(reason);
            return false;
        }
    }
    const updatePlanBatch = async (captain, teamId, mutations, signal, allowPendingEdits = false) => {
        if (mutations.length === 0)
            throw new Error('at least one staged plan operation is required');
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            const staged = fresh.phase === 'staged';
            if (!staged && !allowPendingEdits)
                requireStagedTeam(fresh);
            if (fresh.halted === true)
                throw new Error('team is halted; resume before editing tasks');
            if (!staged && mutations.some(mutation => mutation.action !== 'update_task')) {
                throw new Error('a running team only permits update_task edits to pending, never-started tasks; roster and removal edits require a staged plan');
            }
            for (const mutation of mutations) {
                if (mutation.action === 'update_member') {
                    const member = requireMember(fresh, mutation.memberName);
                    if (member.id !== '')
                        throw new Error(`staged member "${member.name}" was already spawned`);
                    const selection = await resolveMemberLlmSelection(ctx, captain, {
                        provider: mutation.provider,
                        model: mutation.model,
                        reasoningEffort: trimmedOptional(mutation.reasoningEffort),
                        fallback: member.fallback,
                    }, signal);
                    member.role = trimmedOptional(mutation.role);
                    member.provider = selection.provider;
                    member.model = selection.model;
                    member.reasoningEffort = selection.reasoningEffort;
                    member.executionPrompt = trimmedOptional(mutation.executionPrompt);
                }
                else if (mutation.action === 'update_task') {
                    const task = requireTask(fresh, mutation.taskId);
                    if (task.status !== 'pending' || (task.attempt ?? 0) !== 0 || task.reassigning === true) {
                        throw new Error(`task "${task.id}" has already started and cannot be edited`);
                    }
                    if (!staged && mutation.assignee === CAPTAIN_KEY)
                        throw new Error('use reassign_task for captain takeover');
                    const subject = mutation.subject.trim();
                    if (subject === '')
                        throw new Error('task subject must not be empty');
                    task.subject = subject;
                    task.description = trimmedOptional(mutation.description);
                    task.assignee = trimmedOptional(mutation.assignee);
                    task.dependencies = [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))];
                    task.updatedAt = Date.now();
                }
                else if (mutation.action === 'add_task') {
                    const subject = mutation.subject.trim();
                    if (subject === '')
                        throw new Error('task subject must not be empty');
                    fresh.taskSeq += 1;
                    const now = Date.now();
                    fresh.tasks.push({
                        id: `t${fresh.taskSeq}`,
                        subject,
                        description: trimmedOptional(mutation.description),
                        status: 'pending',
                        assignee: trimmedOptional(mutation.assignee),
                        dependencies: [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))],
                        attempt: 0,
                        kind: 'work',
                        createdAt: now,
                        updatedAt: now,
                    });
                }
                else if (mutation.action === 'remove_task') {
                    const task = requireTask(fresh, mutation.taskId);
                    const dependent = fresh.tasks.find((candidate) => candidate.dependencies.includes(task.id));
                    if (dependent !== undefined) {
                        throw new Error(`task "${task.id}" is still required by "${dependent.id}"; update that dependency before removing the task`);
                    }
                    fresh.tasks = fresh.tasks.filter((candidate) => candidate.id !== task.id);
                }
                else {
                    const member = requireMember(fresh, mutation.memberName);
                    if (member.id !== '')
                        throw new Error(`staged member "${member.name}" was already spawned`);
                    const owned = fresh.tasks.filter((task) => task.assignee === member.name);
                    if (owned.length > 0) {
                        throw new Error(`member "${member.name}" still owns planned tasks: ${owned.map((task) => task.id).join(', ')}; update or remove those tasks first`);
                    }
                    fresh.members = fresh.members.filter((candidate) => candidate !== member);
                }
            }
            validateStagedGraph(fresh, false);
            if (!staged) {
                for (const mutation of mutations) {
                    if (mutation.action !== 'update_task')
                        continue;
                    const task = requireTask(fresh, mutation.taskId);
                    const validation = validateCreateTask({ ...fresh, tasks: fresh.tasks.filter(item => item.id !== task.id) }, task);
                    if (!validation.ok)
                        throw new Error(validation.error ?? 'edited task violates the quality contract');
                }
            }
            else
                fresh.planReviewState = 'awaiting_review';
            signal?.throwIfAborted();
            await writeTeam(stateRoot, fresh);
            return fresh;
        });
    };
    // Browser review controls retain their staged-only contract.
    const updateStagedPlanBatch = (captain, teamId, mutations, signal) => (updatePlanBatch(captain, teamId, mutations, signal));
    const updateStagedPlan = async (captain, teamId, mutation, signal) => (updateStagedPlanBatch(captain, teamId, [mutation], signal));
    const approveStagedTeam = async (captain, teamId, signal) => {
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        const runSignal = signal ?? new AbortController().signal;
        const approved = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            // A staged removal has no child session to retain in history. Drop those
            // placeholders before transitioning to the stricter running shape.
            fresh.members = fresh.members.filter((member) => member.status !== 'removed');
            validateStagedGraph(fresh, true);
            const selections = [];
            for (const member of fresh.members) {
                const selection = await resolveMemberLlmSelection(ctx, captain, {
                    provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort, fallback: member.fallback,
                }, runSignal);
                selections.push(selection);
                member.provider = selection.provider;
                member.model = selection.model;
                member.reasoningEffort = selection.reasoningEffort;
            }
            await validateMemberLlmSelections(ctx, selections, runSignal);
            fresh.phase = 'running';
            delete fresh.planReviewState;
            fresh.approvedAt = Date.now();
            await writeTeam(stateRoot, fresh);
            return { teamId: fresh.id, members: fresh.members.length, tasks: fresh.tasks.length };
        });
        try {
            await scheduler.kickTeam(workspace, teamId, captain);
        }
        catch (error) {
            // Approval is already durably committed. A transient wake-up failure is
            // recoverable by the next status/member lifecycle kick and must not make
            // the UI report that an already-running team failed to approve.
            ctx.logger.warn(`agent-teams: post-approval kick failed for "${teamId}": ${String(error)}`);
        }
        return approved;
    };
    const continueStagedPlanning = async (captain, teamId) => {
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        const prepared = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            if (fresh.planReviewState === 'awaiting_feedback') {
                return { teamName: fresh.name, alreadyWaiting: true };
            }
            fresh.planReviewState = 'awaiting_feedback';
            await writeTeam(stateRoot, fresh);
            return { teamName: fresh.name, alreadyWaiting: false };
        });
        if (prepared.alreadyWaiting)
            return { teamId, alreadyWaiting: true };
        // End any planning turn that is still producing tool calls. A plugin
        // follow-up submitted after cancellation is queued as the next turn by the
        // Harness Agent contract, so it cannot race ahead and recreate the team.
        captain.cancel({ kind: 'user' }, { keepInbox: true });
        try {
            captain.followup(createUserMessage({
                content: [{ type: 'text', text: stagedPlanFeedbackContext(prepared.teamName) }],
                source: { kind: 'agent-teams' },
            }));
        }
        catch (error) {
            // Do not leave the durable UI in a false waiting state when the live
            // Captain disappeared between lookup and delivery.
            await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
                requireStagedTeam(fresh);
                if (fresh.planReviewState === 'awaiting_feedback') {
                    fresh.planReviewState = 'awaiting_review';
                    await writeTeam(stateRoot, fresh);
                }
            });
            throw error;
        }
        return { teamId, alreadyWaiting: false };
    };
    const discardStagedTeam = async (captain, teamId) => {
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        const discarded = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/plan-discarded', {
                teamId: fresh.id,
            });
            // A staged plan owns no child sessions. Archiving releases the captain
            // immediately while retaining the rejected graph for later inspection.
            await archiveTeamDir(stateRoot, fresh.id);
            return { teamId: fresh.id, teamName: fresh.name };
        });
        // Preserve this control fact for the next genuine user turn, then abort the
        // still-running Captain turn. Without both operations a late model step can
        // observe the missing active team and incorrectly create it again.
        try {
            captain.inject(createUserMessage({
                content: [{ type: 'text', text: stagedPlanDiscardContext(discarded.teamName) }],
                source: { kind: 'agent-teams' },
            }));
        }
        catch (error) {
            // The archive is already authoritative. Cancellation still prevents a
            // late step from recreating work; failure to park extra context is only a
            // live-delivery warning and must not turn a successful discard into 409.
            ctx.logger.warn(`agent-teams: failed to inject discard context for "${discarded.teamId}": ${String(error)}`);
        }
        captain.cancel({ kind: 'user' }, { keepInbox: true });
        return { teamId: discarded.teamId };
    };
    const runtime = {
        isPendingMember: memberSelections.isPendingMember,
        updateStagedPlan,
        updateStagedPlanBatch,
        approveStagedTeam,
        continueStagedPlanning,
        discardStagedTeam,
    };
    ctx.tools.register(defineTool({
        name: 'agent_teams_create',
        description: 'Create a team. Use approval=required for a two-phase plan: members and tasks remain unspawned/unclaimed until the user reviews the Web plan and explicitly approves it. Optional profiles expand their configured roster; seed profiles also expand template tasks, while captain profiles leave the graph for the Captain to design. approval=automatic preserves the legacy immediate-execution path.',
        parameters: {
            name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
            description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
            profile: { type: 'string', description: 'Optional configured profile name.' },
            plan: {
                type: 'object', additionalProperties: false,
                description: 'Optional complete ordinary-work roster and DAG in one atomic call, instead of separate add_member/create_task rounds. Mutually exclusive with profile. For quality gates use create_task with the explicit quality contract.',
                properties: {
                    members: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
                                name: { type: 'string', required: true }, role: { type: 'string' },
                                provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' },
                            } } },
                    tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
                                id: { type: 'string', required: true, description: 'Local reference used by dependencies in this plan; the result maps it to a durable task id.' },
                                subject: { type: 'string', required: true }, description: { type: 'string' }, assignee: { type: 'string' },
                                dependencies: { type: 'array', items: { type: 'string' } },
                            } } },
                },
            },
            approval: {
                type: 'string',
                enum: ['required', 'automatic'],
                description: 'required stages the plan for explicit user review; automatic starts immediately. Defaults to automatic for API compatibility.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    team_id: { type: 'string', required: true },
                    team_name: { type: 'string', required: true },
                    state_dir: { type: 'string', required: true },
                    phase: { type: 'string', required: true },
                    profile: { type: 'string' },
                    task_planning: { type: 'string' },
                    members: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { member_name: { type: 'string', required: true }, member_id: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, reasoning_effort: { type: 'string' }, status: { type: 'string', required: true } } } },
                    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', required: true }, seed_id: { type: 'string', required: true }, subject: { type: 'string', required: true }, status: { type: 'string', required: true }, kind: { type: 'string' }, assignee: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' }, required: true } } } },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: (value.phase === 'staged'
                        ? `Team "${value.team_name}" plan created under ${value.state_dir}. It is staged: finish the roster and DAG, then wait for the user to edit and approve it. Do not start or approve it yourself.`
                        : `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`)
                        + (value.tasks === undefined ? '' : '\n' + value.tasks.map(task => `${task.task_id} [${task.seed_id}]: ${task.subject}; assignee=${task.assignee ?? 'unassigned'}; dependencies=${task.dependencies.join(',')}`).join('\n')),
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const teamName = args.name.trim();
            if (teamName === '')
                throw new Error('team name must not be empty');
            const teamId = sanitizeKey(teamName);
            const staged = args.approval === 'required';
            // Some models materialize optional parameters as "" instead of omitting
            // them (issue #99). The profile is optional, so treat a blank value
            // exactly like an omitted one instead of failing every create call.
            const profileName = args.profile !== undefined && args.profile.trim() !== ''
                ? args.profile.trim()
                : undefined;
            if (profileName !== undefined && args.plan !== undefined)
                throw new Error('choose either a configured profile or an inline plan');
            const created = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
                const current = await findTeamByParticipant(stateRoot, captain.id);
                if (current !== undefined) {
                    const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to';
                    const guidance = current.captainSessionId === captain.id
                        ? 'Use agent_teams_status and continue the existing team. Do not delete and recreate it merely to continue work. End it only when the user explicitly wants a separate new team.'
                        : 'Continue your assigned member work and report to your captain; do not create a separate team.';
                    throw new Error(`you already ${relationship} team "${current.name}" (id ${current.id}). ${guidance}`);
                }
                return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
                    const existing = await readTeam(stateRoot, teamId);
                    if (existing !== undefined) {
                        throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`);
                    }
                    if (profileName === undefined && args.plan === undefined) {
                        const state = {
                            name: teamName,
                            id: teamId,
                            description: args.description,
                            captainSessionId: captain.id,
                            createdAt: Date.now(),
                            members: [],
                            tasks: [],
                            taskSeq: 0,
                            ...staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : {},
                        };
                        await createTeamDir(stateRoot, state);
                        return { committed: true, state };
                    }
                    return initializeProfileTeam({
                        ctx,
                        config,
                        memberSelections,
                        captain,
                        exec,
                        stateRoot,
                        teamName,
                        teamId,
                        profileName: profileName ?? 'inline-plan',
                        inlinePlan: args.plan,
                        description: args.description,
                        staged,
                    });
                });
            });
            if (created.committed) {
                try {
                    await scheduler.kickTeam(workspace, created.state.id, captain);
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: post-create kick failed for "${created.state.id}": ${String(error)}`);
                }
                try {
                    appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
                        teamId: created.state.id,
                        captainSessionId: captain.id,
                        name: created.state.name,
                        ...created.state.description !== undefined ? { description: created.state.description } : {},
                        ...created.state.profile?.name === undefined ? {} : { profile: created.state.profile.name },
                    });
                    for (const member of created.state.members) {
                        appendTeamEvent(ctx, captain.session, 'agent-teams/member-added', {
                            teamId: created.state.id,
                            memberId: member.id,
                            name: member.name,
                            ...member.role === undefined ? {} : { role: member.role },
                        });
                    }
                    for (const task of created.state.tasks) {
                        appendTeamEvent(ctx, captain.session, 'agent-teams/task-created', {
                            teamId: created.state.id,
                            taskId: task.id,
                            subject: task.subject,
                            dependencies: task.dependencies,
                            ...task.assignee === undefined ? {} : { assignee: task.assignee },
                        });
                    }
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: post-create events failed for "${created.state.id}": ${String(error)}`);
                }
            }
            const persisted = await readTeam(stateRoot, created.state.id).catch(() => undefined);
            const snapshot = persisted ?? created.state;
            if (snapshot.profile === undefined && args.plan === undefined) {
                return {
                    team_id: snapshot.id,
                    team_name: snapshot.name,
                    state_dir: join(stateRoot, snapshot.id),
                    phase: snapshot.phase ?? 'running',
                };
            }
            return {
                team_id: snapshot.id,
                team_name: snapshot.name,
                state_dir: join(stateRoot, snapshot.id),
                phase: snapshot.phase ?? 'running',
                ...snapshot.profile === undefined ? {} : { profile: snapshot.profile.name },
                task_planning: snapshot.profile?.taskPlanning ?? 'seed',
                members: snapshot.members.map((member) => ({
                    member_name: member.name,
                    member_id: member.id,
                    provider: member.provider ?? '',
                    model: member.model ?? '',
                    ...member.reasoningEffort === undefined ? {} : { reasoning_effort: member.reasoningEffort },
                    status: member.status,
                })),
                tasks: snapshot.tasks.map((task) => ({
                    task_id: task.id,
                    seed_id: task.profileSeedId ?? '',
                    subject: task.subject,
                    status: task.status,
                    ...task.kind === undefined ? {} : { kind: task.kind },
                    ...task.assignee === undefined ? {} : { assignee: task.assignee },
                    dependencies: task.dependencies,
                })),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_edit_plan',
        description: 'Atomically revise an AgentTeams plan. While staged, edit tasks and roster without starting work. While running, only update_task is allowed, and only for pending tasks with no prior attempt: correct dependencies, assignees or descriptions before they start; newly ready work is scheduled after commit. Never edit active/finished attempts. Submit dependent edits in order. Never modify .agent-teams files directly.',
        parameters: {
            operations: {
                type: 'array',
                required: true,
                description: 'One atomic, ordered batch. Running teams allow only update_task for never-started pending tasks. If any operation is invalid, none of the edits are saved.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        action: {
                            type: 'string',
                            required: true,
                            enum: ['update_member', 'update_task', 'add_task', 'remove_task', 'remove_member'],
                        },
                        member_name: { type: 'string', description: 'Member name for update_member or remove_member.' },
                        task_id: { type: 'string', description: 'Task id for update_task or remove_task.' },
                        subject: { type: 'string', description: 'Required for add_task; optional replacement for update_task.' },
                        description: { type: 'string', description: 'Optional task description.' },
                        assignee: { type: 'string', description: 'Optional task assignee; an empty string moves it to the shared pool.' },
                        dependencies: { type: 'array', items: { type: 'string' }, description: 'Complete replacement dependency list for a task.' },
                        role: { type: 'string', description: 'Optional member role.' },
                        provider: { type: 'string', description: 'Optional member provider; defaults to the current staged route.' },
                        model: { type: 'string', description: 'Optional member model; defaults to the current staged route.' },
                        reasoning_effort: { type: 'string', description: 'Optional member reasoning effort.' },
                        execution_prompt: { type: 'string', description: 'Optional member-specific execution prompt.' },
                    },
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    members: { type: 'number', required: true },
                    tasks: { type: 'number', required: true },
                    dependencies: { type: 'number', required: true },
                    roster: { type: 'array', items: { type: 'string' }, required: true },
                    graph: { type: 'array', items: { type: 'string' }, required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `${value.status === 'staged' ? 'Staged plan' : 'Pending task graph'} updated atomically (${value.members} members, ${value.tasks} tasks, ${value.dependencies} dependencies). ${value.status === 'staged' ? 'No members were spawned and no tasks were scheduled.' : 'The scheduler will dispatch any newly ready work.'}\n${value.graph.join('\n')}`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const team = await requireCaptainTeam(workspace, config, captain);
            if (args.operations.length === 0)
                throw new Error('at least one staged plan operation is required');
            const mutations = args.operations.map((operation, index) => {
                const label = `operation ${index + 1} (${operation.action})`;
                if (operation.action === 'update_member') {
                    const memberName = operation.member_name?.trim() ?? '';
                    if (memberName === '')
                        throw new Error(`${label} requires member_name`);
                    const member = requireMember(team, memberName);
                    return {
                        action: 'update_member',
                        memberName,
                        role: operation.role ?? member.role,
                        provider: operation.provider?.trim() || member.provider || '',
                        model: operation.model?.trim() || member.model || '',
                        reasoningEffort: operation.reasoning_effort ?? member.reasoningEffort,
                        executionPrompt: operation.execution_prompt ?? member.executionPrompt,
                    };
                }
                if (operation.action === 'update_task') {
                    const taskId = operation.task_id?.trim() ?? '';
                    if (taskId === '')
                        throw new Error(`${label} requires task_id`);
                    const task = requireTask(team, taskId);
                    return {
                        action: 'update_task',
                        taskId,
                        subject: operation.subject ?? task.subject,
                        description: operation.description ?? task.description,
                        assignee: operation.assignee ?? task.assignee,
                        dependencies: operation.dependencies ?? task.dependencies,
                    };
                }
                if (operation.action === 'add_task') {
                    const subject = operation.subject?.trim() ?? '';
                    if (subject === '')
                        throw new Error(`${label} requires a non-empty subject`);
                    return {
                        action: 'add_task',
                        subject,
                        description: operation.description,
                        assignee: operation.assignee,
                        dependencies: operation.dependencies ?? [],
                    };
                }
                if (operation.action === 'remove_task') {
                    const taskId = operation.task_id?.trim() ?? '';
                    if (taskId === '')
                        throw new Error(`${label} requires task_id`);
                    return { action: 'remove_task', taskId };
                }
                const memberName = operation.member_name?.trim() ?? '';
                if (memberName === '')
                    throw new Error(`${label} requires member_name`);
                return { action: 'remove_member', memberName };
            });
            const updated = await updatePlanBatch(captain, team.id, mutations, exec.signal, true);
            if (updated.phase !== 'staged')
                await scheduler.kickTeam(workspace, team.id, captain);
            return {
                status: updated.phase ?? 'running',
                team_id: updated.id,
                members: updated.members.length,
                tasks: updated.tasks.length,
                dependencies: updated.tasks.reduce((sum, task) => sum + task.dependencies.length, 0),
                roster: updated.members.map((member) => `${member.name} (${member.role || 'member'}; ${member.provider ?? ''}/${member.model ?? ''})`),
                graph: updated.tasks.map((task) => `${task.id}: ${task.subject} -> ${task.assignee || 'shared'}${task.dependencies.length === 0 ? '' : `; depends on ${task.dependencies.join(', ')}`}`),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_approve',
        description: 'Approve and start a staged team plan. Call this only in response to an explicit user approval in a new user turn; never call it during the turn that created or edited the plan. The Web Approve & Run button uses the same runtime directly.',
        parameters: {
            confirmation: { type: 'string', required: true, description: 'The user\'s explicit approval statement.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    members: { type: 'number', required: true },
                    tasks: { type: 'number', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Team ${value.team_id} approved and running (${value.members} members, ${value.tasks} tasks).`,
                }],
        },
        async execute(args, exec) {
            if (args.confirmation.trim() === '')
                throw new Error('explicit user approval text is required');
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const team = await requireCaptainTeam(workspace, config, captain);
            const approved = await approveStagedTeam(captain, team.id, exec.signal);
            return { status: 'running', team_id: approved.teamId, members: approved.members, tasks: approved.tasks };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_add_member',
        description: 'Add a member to the team roster. Planning and idle roster rows do not call a model. After approval, the member session starts with its first ready task or explicit message and remains durable for later work.',
        parameters: {
            name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
            role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
            provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
            model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
            reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
            executionPrompt: { type: 'string', description: 'Optional member-specific execution prompt. It remains editable while staged.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    member_name: { type: 'string', required: true },
                    member_id: { type: 'string', required: true },
                    provider: { type: 'string', required: true },
                    model: { type: 'string', required: true },
                    reasoning_effort: { type: 'string' },
                    status: { type: 'string', required: true },
                    phase: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: value.phase === 'staged'
                        ? `Member "${value.member_name}" added to the staged roster (${value.provider}/${value.model}); no child was spawned.`
                        : `Member "${value.member_name}" added (session ${value.member_id || 'starts with first ready task'}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const memberName = args.name.trim();
                if (memberName === '')
                    throw new Error('member name must not be empty');
                const memberKey = sanitizeKey(memberName);
                if (memberKey === CAPTAIN_KEY) {
                    throw new Error(`member name "${args.name}" is reserved for the captain`);
                }
                if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
                    throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`);
                }
                if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
                    throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`);
                }
                const selection = await resolveMemberLlmSelection(ctx, captain, {
                    provider: args.provider,
                    model: args.model,
                    defaultModel: config.memberModel,
                    reasoningEffort: args.reasoning_effort,
                    fallback: config.fallback,
                }, exec.signal);
                const member = {
                    id: '',
                    name: memberName,
                    role: args.role,
                    provider: selection.provider,
                    model: selection.model,
                    reasoningEffort: selection.reasoningEffort,
                    ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
                    executionPrompt: trimmedOptional(args.executionPrompt),
                    joinedAt: Date.now(),
                    status: 'idle',
                };
                await validateMemberLlmSelections(ctx, [selection], exec.signal);
                fresh.members.push(member);
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
                    teamId: fresh.id,
                    memberId: member.id,
                    name: member.name,
                    ...member.role !== undefined ? { role: member.role } : {},
                });
                return {
                    member_name: member.name,
                    member_id: member.id,
                    provider: selection.provider,
                    model: selection.model,
                    ...selection.reasoningEffort === undefined
                        ? {}
                        : { reasoning_effort: selection.reasoningEffort },
                    status: member.status,
                    phase: fresh.phase ?? 'running',
                };
            });
            await scheduler.kickMember(workspace, team.id, created.member_name, captain);
            const latest = (await readTeam(stateRoot, team.id))?.members.find(member => member.name === created.member_name);
            return latest === undefined ? created : { ...created, member_id: latest.id, status: latest.status };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_remove_member',
        description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
        parameters: {
            name: { type: 'string', required: true, description: 'Name of the member to remove.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    member_name: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const member = fresh.members.find(item => item.name === args.name);
                if (member === undefined)
                    throw new Error(`no member \"${args.name}\" in team \"${fresh.name}\"`);
                const requeued = [];
                for (const task of fresh.tasks) {
                    if (task.assignee !== member.name || task.status === 'completed')
                        continue;
                    invalidateTaskAttempt(task);
                    task.reassigning = false;
                    requeued.push(task.id);
                }
                member.status = 'removed';
                await discardMailboxMessages(stateRoot, fresh.id, member.name, (await readUnreadMailbox(stateRoot, fresh.id, member.name)).map(message => message.id));
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
                    teamId: fresh.id,
                    memberId: member.id,
                });
                return { member: { ...member }, requeued };
            });
            if (revoked.member.id !== '') {
                await recordRetiredMemberIds(stateRoot, [revoked.member.id]);
                await stopTeamMemberActivations(ctx, captain, [revoked.member], exec.signal);
            }
            await scheduler.kickTeam(workspace, team.id, captain);
            return {
                member_name: revoked.member.name,
                status: revoked.member.status,
                requeued_tasks: revoked.requeued,
            };
        },
    }));
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_create_task',
        description: 'Create a task in your team\'s task list. Use kind=work (default) for research, repository audits and general tasks. kind=review is only a quality gate for an existing implementation/repair task via reviewedTaskId. Every call must include a non-empty subject, including verification and review tasks. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
        parameters: {
            subject: { type: 'string', required: true, description: 'Required non-empty title for this task. Never omit it, including for verification or review tasks.' },
            description: { type: 'string', description: 'What needs to be done, in detail.' },
            dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task ids this task depends on (must be completed before this task can be claimed).',
            },
            assignee: { type: 'string', description: 'Member name when an owner is specified. Omission puts this task in the shared pool; roles, subjects and descriptions do not assign an owner.' },
            kind: {
                type: 'string',
                enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
                description: 'Explicit task kind. Omission means work with no quality gates, even if the subject says implementation/review. Quality kinds require a contract. An implementation may be planned before requirements passes when its dependency chain includes that requirements task.',
            },
            round: { type: 'number', description: '1-based review / requirements / repair round.' },
            objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
            inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
            outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
            verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
            deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable paths or names.' },
            nonGoals: { type: 'array', items: { type: 'string' }, description: 'Explicit non-goals.' },
            reviewedTaskId: { type: 'string', description: 'Existing AgentTeams implementation/repair task id. Required for kind=review; an external repository audit is kind=work.' },
            sourceTaskId: { type: 'string', description: 'Source implementation/artifact. Required for kind=repair.' },
            sourceFindingIds: { type: 'array', items: { type: 'string' }, description: 'Finding ids this repair must close.' },
            coverageOf: { type: 'array', items: { type: 'string' }, description: 'User-constraint / goal items this task covers.' },
            resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
            resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    subject: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    assignee: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}, kind ${value.kind}, ${value.assignee ? `assigned to ${value.assignee}` : 'unassigned shared pool'}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            // Some models materialize optional parameters as "" instead of omitting
            // them (issue #105). Normalize blank optional fields to omitted before
            // validation so a blank value can neither be rejected spuriously nor be
            // persisted into team.json, where it would brick the team on reload.
            const input = normalizeBlankOptionalTaskFields(args);
            const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const gate = validateCreateTask(fresh, {
                    subject: input.subject,
                    description: input.description,
                    dependencies: input.dependencies,
                    assignee: input.assignee,
                    kind: input.kind,
                    round: input.round,
                    objective: input.objective,
                    inScope: input.inScope,
                    outOfScope: input.outOfScope,
                    acceptance: input.acceptance,
                    verify: input.verify,
                    deliverables: input.deliverables,
                    nonGoals: input.nonGoals,
                    reviewedTaskId: input.reviewedTaskId,
                    sourceTaskId: input.sourceTaskId,
                    sourceFindingIds: input.sourceFindingIds,
                    coverageOf: input.coverageOf,
                    resume: input.resume,
                    resumeReason: input.resumeReason,
                });
                if (!gate.ok)
                    throw new Error(gate.error ?? 'create_task rejected by quality gates');
                if (fresh.halted === true) {
                    const resumed = resumeTeamState(fresh, args.resumeReason ?? '');
                    if (resumed.status !== 'resumed' || resumed.team === undefined) {
                        throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason');
                    }
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
                        teamId: fresh.id,
                        reason: args.resumeReason ?? '',
                    });
                }
                const dependencies = args.dependencies ?? [];
                for (const dependency of dependencies) {
                    if (!fresh.tasks.some((task) => task.id === dependency)) {
                        throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`);
                    }
                }
                if (args.assignee !== undefined)
                    requireMember(fresh, args.assignee);
                const kind = gate.kind ?? 'work';
                const objective = kind === 'review' || kind === 'requirements'
                    ? sanitizeReviewObjective(input.objective)
                    : input.objective;
                const acceptance = kind === 'review' || kind === 'requirements'
                    ? sanitizeReviewAcceptance(input.acceptance)
                    : input.acceptance;
                const task = {
                    id: `t${fresh.taskSeq + 1}`,
                    subject: args.subject,
                    description: args.description,
                    status: 'pending',
                    assignee: args.assignee,
                    dependencies,
                    attempt: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    kind,
                    ...args.round === undefined ? {} : { round: args.round },
                    ...objective === undefined ? {} : { objective },
                    ...input.inScope === undefined ? {} : { inScope: input.inScope },
                    ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
                    ...acceptance === undefined ? {} : { acceptance },
                    ...input.verify === undefined ? {} : { verify: input.verify },
                    ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
                    ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
                    ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
                    ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
                    ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
                    ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
                };
                fresh.taskSeq += 1;
                fresh.tasks.push(task);
                /**
                 * ── ★ contract 位置（契约 §1 ①：「建任务 / 改契约」）─────────────────────
                 *
                 * 位置是**既有契约校验之后**：`validateCreateTask` 已经先说了话（它不认识判据
                 * 层），本调用点只叠加。于是"这条契约本身合法吗"的既有裁决一点没变，而
                 * "这条契约可判吗"（例如 verify 命令能不能真的判定成功/失败）可以由判据层
                 * 接着问 —— 那正是 t7 要挂在这个位置上的东西。
                 *
                 * ★ 传【任务草稿】而不是 `args`：判据该读的是契约本身（objective / acceptance /
                 *   verify / inScope …），而 `args` 里混着工具参数（resume、round…）。
                 *
                 * ── ★ 注入执行器（t18，本队同一张验收表的第三格）─────────────────────────
                 *
                 * MEASURED（2026-10-05）：本调用点此前**没有** `execVerifyCommand`，于是
                 * `contract.verify-command` 在生产路径上**永远**返回 `unmeasured`
                 * （"no executor was injected … never actually run"）⇒ 调用方拒绝
                 * ⇒ **implementation / repair 这类必须验的契约连 create 都过不去**。
                 *
                 * ★ 这与 t6 修过的 `completion.verify-rerun` 缺执行器**同源**，也与 t17 修过的
                 *   "verify 缺席 ⇒ unmeasured"是同一格 —— 判据接进来了，而它的**输入面**没接。
                 *   本仓库对这条纪律的说法见契约 §2 性质 1：**判据不 import I/O，执行器由调用方注入**。
                 *
                 * ★ 复用 `runVerifyCommand`，与 completion 位置**同一个实现、同一个超时口径**
                 *   —— 不新造第二条"跑命令"的路径（两条路径会在超时/退出码语义上慢慢分叉，
                 *   而它们在日志里同形，那种分叉最难归因）。
                 */
                const contractGateSurface = await rejectOnContractGates(ctx, { team: fresh, task, creating: true }, 'create_task', {
                    execVerifyCommand: (command) => runVerifyCommand(workspace, command),
                });
                await writeTeam(stateRoot, fresh);
                /**
                 * ── ★ runtime 位置：跨步骤的过程约束 ──────────────────────────────────────
                 * 只记录，不拒绝（契约 §5）。`created: true` 是给"运行判据"的判别面 ——
                 * 一条判据可以只关心某些事件，判据层不替它猜。
                 */
                const contractRuntimeRecord = await evaluateRuntimeGates(ctx, 'task-created', {
                    team: fresh,
                    task,
                    created: true,
                }, clock);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
                    teamId: fresh.id,
                    taskId: task.id,
                    subject: task.subject,
                    dependencies: task.dependencies,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.kind === undefined ? {} : { kind: task.kind },
                    ...task.round === undefined ? {} : { round: task.round },
                });
                return {
                    task_id: task.id,
                    subject: task.subject,
                    status: task.status,
                    kind: taskKindOf(task),
                    /**
                     * ★★ t3：contract 位置的核对结论**随记录交出去**（与 runtime 同形）。
                     *   此前这里只有一个 `logger.warn` —— 日志被截断时，"报缺"与"输入面是齐的"
                     *   在返回值上同形。★ 三态：齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/
                     *   这个位置没判据（**字段不出现**，不是 `ok`）。
                     */
                    ...contractGateSurface === undefined ? {} : contractGateSurface,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...contractRuntimeRecord === undefined ? {} : { runtime_gates: contractRuntimeRecord },
                };
            });
            await scheduler.kickTeam(workspace, team.id, captain);
            return created;
        },
    })));
    ctx.tools.register(defineTool({
        name: 'agent_teams_reassign_task',
        description: 'Atomically retry, reassign, or let the captain take over one ready unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" only when you will finish that task in this turn; a captain can own only one unfinished takeover at a time, and an unfinished takeover returns to the member pool when the captain becomes idle.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
            assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
            reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    previous_assignee: { type: 'string', required: true },
                    assignee: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const target = args.assignee.trim();
            if (target === '')
                throw new Error('reassignment assignee must not be empty');
            const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                if (task.status === 'completed')
                    throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`);
                if (task.reassigning === true) {
                    const previousMember = fresh.members.find(member => member.id === task.handoffFromMemberId && member.stopping === true);
                    if (task.assignee !== target || previousMember === undefined)
                        throw new Error(`task ${task.id} is already being reassigned`);
                    return { previousAssignee: previousMember.name, previousMember: { ...previousMember }, handoffId: task.handoffId };
                }
                const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target);
                if (target === CAPTAIN_KEY) {
                    const busy = captainOpenTask(fresh, task.id);
                    if (busy !== undefined) {
                        throw new Error(`captain is busy with ${busy.id}; complete or reassign it before taking over ${task.id}`);
                    }
                    const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies);
                    if (pending.length > 0) {
                        throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them before captain takeover`);
                    }
                }
                else if (targetMember !== undefined) {
                    const busy = memberOpenTask(fresh, targetMember.name, task.id);
                    if (busy !== undefined) {
                        throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`);
                    }
                }
                const previousAssignee = task.assignee ?? '';
                const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
                    || task.assignee === undefined || task.assignee === CAPTAIN_KEY
                    ? undefined
                    : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed');
                invalidateTaskAttempt(task, target, true);
                if (previousMember !== undefined) {
                    previousMember.stopping = true;
                    task.handoffFromMemberId = previousMember.id;
                    await discardMailboxMessages(stateRoot, fresh.id, previousMember.name, (await readUnreadMailbox(stateRoot, fresh.id, previousMember.name)).map(message => message.id));
                }
                await writeTeam(stateRoot, fresh);
                return {
                    previousAssignee,
                    previousMember: previousMember === undefined ? undefined : { ...previousMember },
                    handoffId: task.handoffId,
                };
            });
            let quiescenceError;
            if (revoked.previousMember !== undefined) {
                try {
                    await stopTeamMemberActivations(ctx, captain, [revoked.previousMember], exec.signal);
                }
                catch (error) {
                    quiescenceError = error;
                }
            }
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
                    throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`);
                }
                task.reassigning = quiescenceError !== undefined;
                if (quiescenceError === undefined) {
                    const previous = fresh.members.find(member => member.id === revoked.previousMember?.id);
                    if (previous !== undefined)
                        delete previous.stopping;
                    delete task.handoffFromMemberId;
                }
                if (quiescenceError === undefined && target === CAPTAIN_KEY) {
                    beginTaskAttempt(task, CAPTAIN_KEY);
                    // The captain is already in the turn that requested takeover; there
                    // is no later member claim handshake to move claimed -> in_progress.
                    task.status = 'in_progress';
                    task.updatedAt = Date.now();
                }
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    assignee: task.assignee,
                    ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
                });
            });
            if (quiescenceError !== undefined)
                throw quiescenceError;
            if (target !== CAPTAIN_KEY)
                await scheduler.kickMember(workspace, team.id, target, captain);
            const current = await readTeam(stateRoot, team.id);
            const task = current === undefined ? undefined : requireTask(current, args.task_id);
            if (task === undefined)
                throw new Error(`team "${team.name}" ended during reassignment`);
            return {
                task_id: task.id,
                previous_assignee: revoked.previousAssignee,
                assignee: task.assignee ?? '',
                status: task.status,
                attempt: task.attempt ?? 0,
                ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_claim_task',
        description: 'Members claim their own ready task or read their existing attempt_id. Captains must use reassign_task to assign and wake a member; claim_task does not dispatch work. A member cannot own a second unfinished task. The returned attempt_id is required for updates and becomes stale after retry/reassignment.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to claim.' },
            assignee: { type: 'string', description: 'Deprecated: claim_task only supports a member claiming its own task. Captains must use reassign_task.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    assignee: { type: 'string', required: true },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                    task_details: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).\n${value.task_details}`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const task = requireTask(fresh, args.task_id);
                if (task.reassigning === true) {
                    throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`);
                }
                let assignee = task.assignee;
                if (identity.kind === 'captain') {
                    // A captain may read the capability of its already-started takeover,
                    // but must never create a member claim without dispatching it (#125).
                    if (args.assignee !== undefined || task.assignee !== CAPTAIN_KEY
                        || (task.status !== 'claimed' && task.status !== 'in_progress')) {
                        throw new Error('claim_task is for members claiming their own task; captains must use agent_teams_reassign_task to assign and wake a member');
                    }
                }
                else {
                    if (args.assignee !== undefined) {
                        throw new Error('members cannot set assignee when claiming a task');
                    }
                    if (assignee !== undefined && assignee !== identity.name) {
                        throw new Error(`task ${task.id} is assigned to "${assignee}", not you`);
                    }
                    assignee = identity.name;
                }
                // Authorization must happen before the idempotent return: another
                // member must not receive a false success for somebody else's task.
                if (task.status === 'claimed' || task.status === 'in_progress') {
                    if (assignee === undefined || task.assignee !== assignee) {
                        throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`);
                    }
                    return {
                        task_details: taskDetails(fresh, task),
                        task_id: task.id,
                        status: task.status,
                        assignee,
                        attempt: task.attempt ?? 0,
                        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                    };
                }
                const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies);
                if (pending.length > 0) {
                    throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`);
                }
                const transition = transitionError(task.status, 'claimed');
                if (transition !== undefined)
                    throw new Error(transition);
                if (assignee === undefined) {
                    throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)');
                }
                const busy = memberOpenTask(fresh, assignee, task.id);
                if (busy !== undefined) {
                    throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`);
                }
                const attemptId = beginTaskAttempt(task, assignee);
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    assignee: task.assignee,
                });
                return {
                    task_details: taskDetails(fresh, task),
                    task_id: task.id,
                    status: task.status,
                    assignee: task.assignee ?? '',
                    attempt: task.attempt ?? 0,
                    attempt_id: attemptId,
                };
            });
        },
    }));
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_update_task',
        description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable, but owners and the captain can append acceptanceResults/commandsRun/evidence_note as attributed supplemental evidence, without reclaiming or changing the verdict. A captain must use reassign_task(assignee="captain") before updating active member-owned work.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to update.' },
            attempt_id: { type: 'string', description: 'Members must explicitly include the current attempt_id from their assignment/claim in EVERY update, including failed reviews with findings. If omitted, retry with the same current id; omission does not revoke the attempt.' },
            status: {
                type: 'string',
                enum: ['in_progress', 'completed', 'failed', 'cancelled'],
                description: 'New status (in_progress, completed, failed, cancelled).',
            },
            output: { type: 'string', description: 'Original result summary; immutable after completion/failure.' },
            evidence_note: { type: 'string', description: 'Append-only supplementary observation on a terminal task. Does not reopen work or change the original result.' },
            verdict: {
                type: 'string',
                enum: ['pass', 'needs_revision', 'reject'],
                description: 'Required for completing requirements/review. needs_revision and reject must fail the task.',
            },
            findings: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'], required: true },
                        problem: { type: 'string', required: true },
                        requiredFix: { type: 'string', required: true },
                        file: { type: 'string' },
                        line: { type: 'number' },
                        resolved: { type: 'boolean' },
                    },
                },
                description: 'Structured review findings. Required when verdict is needs_revision or reject; each item needs id, severity, problem, and requiredFix.',
            },
            changedPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Workspace-relative POSIX paths changed by this implementation/repair.',
            },
            acceptanceResults: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        criterion: { type: 'string', required: true },
                        status: { type: 'string', enum: ['passed', 'failed'], required: true },
                        evidence: { type: 'string' },
                    },
                },
                description: 'Acceptance evidence in contract order: {criterion, status:"passed"|"failed", evidence?}. Supply one item per acceptance criterion.',
            },
            commandsRun: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        command: { type: 'string', required: true },
                        status: { type: 'string', enum: ['passed', 'failed'], required: true },
                        exitCode: { type: 'number' },
                        evidence: { type: 'string' },
                    },
                },
                description: 'Verification evidence in contract order: {command, status:"passed"|"failed", exitCode?, evidence?}. Supply one item per verify command.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    output: { type: 'string' },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                    evidence_count: { type: 'number' },
                    follow_up: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}${value.evidence_count === undefined ? '' : `\nSupplemental evidence records: ${value.evidence_count}. Original result unchanged.`}${value.follow_up ? `\n${value.follow_up}` : ''}`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            let followUpMessage;
            const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const task = requireTask(fresh, args.task_id);
                if (identity.kind === 'captain'
                    && task.assignee !== undefined
                    && task.assignee !== CAPTAIN_KEY
                    && !TERMINAL_TASK_STATUSES.includes(task.status)
                    && !(args.status === 'cancelled' && task.status === 'pending' && (task.attempt ?? 0) === 0 && task.reassigning !== true)) {
                    throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`);
                }
                if (identity.kind === 'member') {
                    if (task.assignee !== identity.name) {
                        throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`);
                    }
                    if (task.attemptId !== undefined && (args.attempt_id === undefined || args.attempt_id.trim() === '')) {
                        throw new Error(`missing attempt_id for task ${task.id}. Retry this update with attempt_id="${task.attemptId}" from your current assignment. This is a missing parameter, not a revoked attempt; do not restart the work or request reassignment.`);
                    }
                    if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
                        throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`);
                    }
                }
                if (TERMINAL_TASK_STATUSES.includes(task.status)) {
                    const appended = appendTaskEvidence(task, {
                        ...args, findings: parseFindings(args.findings), changedPaths: normalizeBlankOptionalTaskFields(args).changedPaths,
                        acceptanceResults: parseAcceptanceResults(args.acceptanceResults), commandsRun: parseCommandResults(args.commandsRun),
                    }, identity.name);
                    if (appended)
                        await writeTeam(stateRoot, fresh);
                    return {
                        evidence_count: task.supplementalEvidence?.length ?? 0,
                        task_id: task.id,
                        status: task.status,
                        attempt: task.attempt ?? 0,
                        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                        ...task.output !== undefined ? { output: task.output } : {},
                    };
                }
                if (args.evidence_note?.trim())
                    throw new Error('evidence_note is for terminal tasks; record active work with output and structured evidence');
                // Blank optional list entries (e.g. changedPaths:[""]) must not be
                // persisted: hasValidQualityTaskFields rejects them on reload and
                // would brick the whole team state (issue #105 class).
                const input = normalizeBlankOptionalTaskFields(args);
                const findings = parseFindings(args.findings);
                const acceptanceResults = parseAcceptanceResults(args.acceptanceResults);
                const commandsRun = parseCommandResults(args.commandsRun);
                /**
                 * ── ★ 判据层（可插拔）────────────────────────────────────────────────────
                 *
                 * 这一段此前【硬编码】了"重跑 verify"这一条判据。现在它只是
                 * `registry.evaluate('completion', ...)` 的一次调用 —— 编排层不知道
                 * 那个位置挂了哪些判据、也不知道它们的语义（契约 `docs/GATE-REGISTRY.md` §8）。
                 *
                 * ⇒ 换/加/删判据 = 改 `src/gates/index.mjs` 的清单一行，**不碰本文件**。
                 *
                 * 执行器在这里注入（本文件是这一层唯一做 I/O 的地方；判据本身是纯数据变换）。
                 * 只在【非终态 → completed】时给出执行器：终态补证据（issue159）不是新的
                 * 完成裁决。判据自己 `appliesTo` 也会跳过那种情形 —— 两处都表达同一条边界，
                 * 是因为执行器缺席这条路径也必须能被审计。
                 */
                /**
                 * ── ★ 归属证据：这个成员【真的写过】哪些文件 ─────────────────────────────
                 *
                 * `dispatch.changed-paths` 需要"自报的 changedPaths 与真实写入是否对得上"。
                 * 真相来自该成员自己的会话事件（dsh-tool-fs 挂在 tool/result 上的 meta.diffs），
                 * 经 `observedChangedPaths(caller.session)` 折叠成一组路径。
                 *
                 * ★ 这正是 START-HERE §5③ 那个"共同障碍"的解法：git 只知道工作区脏了，
                 *   而会话事件是逐成员的 ⇒ 不需要 worktree，也不需要改 cwd（§5②）。
                 *
                 * ★ 队长代报（caller 是队长）时拿不到成员会话 ⇒ 观察缺席 ⇒ 判据 unmeasured，
                 *   而不是被当成通过。这是刻意的：没能观察就不能声称它诚实。
                 */
                /**
                 * ★ 输入面核对（t10）：**求值之前**，按每条判据声明的 `requires` 核对这份
                 *   真实 ctx。★ 它是**旁路数据** —— 下面的拒绝逻辑一个字都不看它：
                 *   核对报缺时流程照常走完（先软后硬，用户裁定）。见 {@link auditGateRequires}。
                 *
                 * ★ 这份 ctx 是【构造一次、用两次】的同一个对象（核对一次、求值一次）：
                 *   写成两份字面量会让"核对的 ctx"与"求值的 ctx"在多一次改动之后分叉，
                 *   而分叉之后核对结果会变成关于**另一份 ctx** 的结论 —— 它读起来完全正常。
                 */
                const dispatchContext = {
                    task,
                    update: { changedPaths: input.changedPaths },
                    observedChangedPaths: observedChangedPaths(caller.session),
                };
                const dispatchInputSurface = inputSurfaceOf('dispatch', dispatchContext);
                const dispatchGates = await registry.evaluate('dispatch', dispatchContext);
                /**
                 * ── ★ runtime 位置（跨步骤的过程约束，契约 §5）───────────────────────────
                 *
                 * 成员开始干活 + 改契约/建任务之后，把"这一步发生过"交给 runtime 判据。
                 * ★ 它返回任何裁决都【不得阻止流程】—— 上面 dispatch 位置的拒绝逻辑在本
                 *   调用点之后照常执行，本调用点对控制流零影响。理由见 `evaluateRuntimeGates`。
                 */
                let runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update', {
                    team: fresh,
                    task,
                    update: { status: args.status, output: args.output, verdict: args.verdict },
                    updateGate: dispatchGates,
                    wantsCompleted: args.status === 'completed',
                }, clock);
                if (dispatchGates.ok === false) {
                    if (dispatchGates.unmeasured !== undefined) {
                        /**
                         * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
                         *   看出"判据没能测量"，而不是"判据发现了问题"。
                         */
                        throwWithSurface(`update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`, dispatchInputSurface, 'dispatch_input_surface');
                    }
                    throwWithSurface(`update_task rejected: ${dispatchGates.blockers.join('; ')}`, dispatchInputSurface, 'dispatch_input_surface');
                }
                /**
                 * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬）。它放在上面的拒绝逻辑【之后】，
                 *   不是为了顺序好看：放在之前会让"核对报缺"看起来像拒绝的理由，
                 *   而本机制的裁决权是零。措辞与判据的 `unmeasured` 不同形 ——
                 *   那是"判据测不了"，这是"调用方没把这一格交出去"。
                 *
                 * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
                 *   `input_surface` 里（`dispatchInputSurface`）。两条并存，缺一不可。
                 */
                if (dispatchInputSurface !== undefined && dispatchInputSurface.incomplete > 0) {
                    ctx.logger.warn(`agent-teams: update_task reached the dispatch gate with an unfinished input surface (recorded, not rejected): ${dispatchInputSurface.missing.join('; ')}`);
                }
                /**
                 * ── ★ 注入面：让每条判据拿到它声明的输入（缺则缺席，不注入空值）─────────
                 *
                 * 每一项都只做【读】。拿不到 ⇒ 该字段不出现在 ctx 里 ⇒ 判据自己说
                 * "我没能测量"。**绝不在这里替判据决定"那就算通过"。**
                 */
                const changedFiles = input.changedPaths ?? task.changedPaths ?? [];
                const worktreeBase = worktreeBaseOf(task.id);
                const [changedLines, observedFiles] = await Promise.all([
                    changedLineNumbers(workspace, worktreeBase),
                    Promise.resolve(observedChangedPaths(caller.session)),
                ]);
                /**
                 * `newTestFiles`：本任务【新增】的测试文件。
                 *
                 * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
                 * 取那些"在声明范围内、且看起来是测试"的路径。
                 * ★ 观察不到（`undefined`）⇒ 不注入 ⇒ r5 的 appliesTo 为假 ⇒ skipped。
                 *   这与"观察到了、确实没有新测试"（`[]`）不同形 —— 后者仍是 skipped
                 *   （没有测试就没有红前绿后可测），但成因不同，判据自己会表达。
                 */
                /**
                 * `newTestFiles`：本任务【新增】的测试文件。
                 *
                 * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
                 * 取那些看起来是测试的路径。
                 *
                 * ★ 只在【这一次确实试图置为 completed】时注入 —— 这是刻意的调用方纪律，
                 *   与 `execVerifyCommand` 的既有先例一致（那条也只在"非终态 → completed"
                 *   时给出执行器）。
                 *
                 * 由来（MEASURED，2026-10-05，t7）：`completion.r5` 的 `appliesTo` 只问
                 * `kind ∈ {implementation, repair}` 与 `newTestFiles` 是否为数组，**不看
                 * 完成意图** —— 而它的三条兄弟判据（verify-rerun / mutation / backtest）
                 * 都带 `wantsCompleted === true` 守卫。实测：
                 *
                 *     r5.appliesTo({ kind:'implementation', newTestFiles:[…], wantsCompleted:false }) ⇒ true
                 *
                 * 于是"成员开始干活"（in_progress）那一步也会被"红前绿后"审判，而那时
                 * 父版本/扫描范围都还没有 ⇒ 一条【开始工作】的更新被 rejected。
                 * 这个缺陷此前被"newTestFiles 永不注入"掩盖着（r5 恒 skipped），注入面一补齐
                 * 就露出来。⇒ 在这里收口：不把"有没有新测试"这件事在非完成更新里提出去，
                 * 于是 r5 在那些更新上按自己的契约 skipped，与三条兄弟判据行为一致。
                 *
                 * ★ 观察不到写入（`undefined`）⇒ 不注入（不是注入 `[]`）—— 缺席意味着
                 *   "我没能观察"，而 `[]` 意味着"观察了、确实没有新测试"。两者不同形。
                 */
                const isTestPath = (path) => /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
                /** 观察到的测试文件（杀变异体用）—— 与"本次新增"无关，既有的也算。 */
                const observedTestFiles = observedFiles === undefined ? undefined : observedFiles.filter(isTestPath);
                const newTestFiles = args.status !== 'completed' || observedTestFiles === undefined
                    ? undefined
                    : observedTestFiles;
                /**
                 * 基准 = 【在父版本上跑一遍任务的 verify 命令】的退出码。
                 *
                 * 不注入（返回 undefined）的两种情形，都保持"没测到"：
                 *   · 任务没有声明 verify ⇒ 没有可跑的东西（回测的 L1 前置要求基准先绿）；
                 *   · 跑不起来（工作区不是 git 仓库、版本取不到…）⇒ 不能拿 0 充数。
                 */
                const baselineExit = async (revision) => {
                    const commands = task.verify ?? [];
                    if (commands.length === 0)
                        return undefined;
                    /**
                     * ★ 基准 = 在【父版本】上跑一遍本任务的 verify 命令。
                     *
                     * 有一个必须说清的前提：本任务【新增的测试】在父版本上本来就是红的
                     * （否则 R5 会说它是装饰性测试）。所以把整套命令原样搬到父版本上跑，
                     * 基准必然不绿 ⇒ 回测说"无法归因、这红不是这次改动的错" ——
                     * **那是判据在正确地工作**，不是缺陷。
                     *
                     * ⇒ 基准要问的是另一个问题：「在这次改动【之前】，这套测试是绿的吗」。
                     *   也就是把命令里【本次新增的测试文件】剔掉，跑【改动前就存在的那部分】。
                     *   两者是不同的问句：
                     *     R5      ：新测试在父版本上红吗？      （它在不在证明什么）
                     *     回测 L1 ：改动之前这里本来就是绿的吗？（红了能不能归因）
                     *   把它们混成一条命令，两条判据就会互相打架 —— 而"打架"的表现是
                     *   一个**永远无法归因**的基准，读起来像基础设施坏了。
                     *
                     * ★ 剔掉的只有【本次新增的测试】（`newTestFiles`）—— 既有的测试一条不少，
                     *   也不去猜"哪些测试相关"。
                     */
                    const added = new Set(newTestFiles ?? []);
                    const withoutNewTests = commands
                        .map((command) => command.split(/\s+/).filter((token) => !added.has(token)).join(' '))
                        .map((command) => command.trim())
                        .filter((command) => command !== '');
                    if (withoutNewTests.length === 0)
                        return undefined;
                    const results = await Promise.all(withoutNewTests.map(async (command) => (runInDetachedRevision({ workspace, revision, command }))));
                    if (results.some((code) => code === undefined))
                        return undefined;
                    // 基准取【最坏的一条】：任何一条在父版本上不绿 ⇒ 基准就不是绿的，
                    // 而"基准不绿"时回测的正确结论是"无法归因"（判据自己会说）。
                    return Math.max(...results);
                };
                /**
                 * ★ 基准的【声称】与它的【证据】必须分清：
                 *   · label 有了（父版本 hash 可追溯，供人工追溯）；
                 *   · exitCode 必须来自【真的在父版本上跑过一次】—— 见下面的 `baselineExit`。
                 *   拿不到就跑不出退出码 ⇒ 保持 `undefined`：判据会说"基准没有退出码，
                 *   所以它区分不了『绿』与『没测』"。**绝不能**在这里填一个 0 充数 ——
                 *   那正是把"没测到"伪装成"基准是绿的"。
                 */
                const baseline = worktreeBase === undefined
                    ? undefined
                    : { label: worktreeBase, exitCode: await baselineExit(worktreeBase) };
                /**
                 * ★ 回测的依赖图 / 覆盖数据。与跑测试一样是 I/O，所以在这一层做；
                 *   拿不到就【不注入】⇒ 判据说"没有依赖图数据"（不是"选了 0 条"）。
                 */
                const coverageInput = await deriveCoverageInput({
                    workspace,
                    testFiles: observedTestFiles ?? [],
                    knownTests: observedTestFiles ?? [],
                });
                const wantsCompleted = args.status === 'completed';
                /**
                 * ── ★ 输入面：这是**最长的一份 ctx**，也是历史缺陷最集中的一格 ────────────
                 *
                 * 上一轮五次同形缺陷里，`inScope 缺席` / `verify 缺席` / `执行器缺席` 三次
                 * 都落在本调用点上（本队实测记录）—— 判据照常跑、照常说"我没能测量"，
                 * 而那在日志里与"这一步没问题"同形。
                 *
                 * ⇒ 核对必须在**求值之前**、对着**同一份** ctx：所以下面把 ctx 提成一个
                 *   具名常量，核对与求值**共用它**。写两份字面量之后，任何一次只改一处的
                 *   编辑都会让核对结果变成关于**另一份 ctx** 的结论 —— 而它读起来完全正常。
                 */
                const completionContext = {
                    task,
                    update: {
                        status: args.status,
                        output: args.output,
                        verdict: args.verdict,
                        findings,
                        changedPaths: input.changedPaths,
                        acceptanceResults,
                        commandsRun,
                        ...newTestFiles === undefined ? {} : { newTestFiles },
                    },
                    wantsCompleted,
                    taskNotTerminal: !TERMINAL_TASK_STATUSES.includes(task.status),
                    execVerifyCommand: (command) => runVerifyCommand(workspace, command),
                    // ── r5：父版本 + 扫描范围 + 在指定版本上跑一条测试的执行器
                    ...worktreeBase === undefined ? {} : { parentRevision: worktreeBase },
                    ...worktreeBase === undefined ? {} : { worktreePath: workspace },
                    scanDirs: deriveScanDirs(changedFiles),
                    /**
                     * ★ 在【父版本 / 修复版本】上跑一条测试。
                     *
                     * 实现要点（每一条都是踩出来的）：
                     *   · 成员的工作区通常是**脏的**（它刚改了文件）⇒ `git checkout` 会拒绝。
                     *     所以用 `git worktree` 临时检出一个干净副本去跑，而不是在原地切换 ——
                     *     原地切换既会因脏工作区失败，也可能把成员的改动弄丢。
                     *   · 跑完必须把临时检出删掉（finally），否则每次完成都漏一个目录。
                     *   · 拿不到整数退出码 ⇒ `exitCode: undefined` ⇒ 判据 unmeasured。
                     *     **绝不**把跑不起来当成 0（"没测到"不得并进"通过"）。
                     */
                    runTestOnRevision: async (test, revision) => {
                        /**
                         * ★ `'working-tree'` 是 R5 约定的【修复版本】哨兵值 —— 表示"成员现在
                         *   交出来的那份树"，而它**不是**一个 git 引用（`git worktree add`
                         *   对它必然失败）。这是判据与调用方之间的一个约定，不是笔误。
                         *   ⇒ 它跑在【工作区本身】上；只有父版本才需要检出到一个干净副本。
                         */
                        if (revision === 'working-tree') {
                            return { exitCode: await runVerifyCommand(workspace, `node --test ${test}`) };
                        }
                        const exitCode = await runInDetachedRevision({
                            workspace, revision, command: `node --test ${test}`,
                        });
                        return exitCode === undefined ? {} : { exitCode };
                    },
                    // ── mutation：三个执行器 + 只变异改动行
                    readFile: (path) => readWorkspaceFileSync(workspace, path),
                    writeFile: (path, contents) => writeWorkspaceFileSync(workspace, path, contents),
                    /**
                     * ★ 变异判据的 runTest 必须交回【输出】，不只是退出码：
                     *   杀伤率 = 被杀的变异体 / 全部变异体，而"某次运行里有几条测试失败"只能从
                     *   输出里读出来（判据用 parseTestSummary 解析 `ℹ pass N` / `# pass N`）。
                     *   只给退出码 ⇒ 判据会说"套件没报告可读的摘要"⇒ unmeasured。
                     */
                    runTest: async (command) => await runVerifyCommandCaptured(workspace, command),
                    ...changedLines === undefined ? {} : { changedLines },
                    changedFiles,
                    /**
                     * ★ 杀手套件：变异判据【要求显式声明】，没有回退（见 mutation.ts 文件头
                     *   —— 一个没被声明的套件会让"存活者"变成关于探针的事实，而不是关于测试
                     *   的事实）。
                     *
                     * 这里声明的来源是【会话事件观察到的测试文件】—— 与 newTestFiles 同源，
                     * 但语义不同、不能合并：
                     *     newTestFiles  = 本次【新增】的测试（R5 拿它跑红前绿后）
                     *     killerSuites  = 拿哪些测试去杀变异体（既有的测试也算）
                     * 把后者写成前者，"这次没新增测试"就会变成"没有杀手套件"⇒ unmeasured。
                     *
                     * ★ 观察不到 ⇒ 不注入 ⇒ 判据 unmeasured。**不猜、不回退到全套。**
                     */
                    ...observedTestFiles === undefined || observedTestFiles.length === 0
                        ? {}
                        : { killerSuites: observedTestFiles.map((file) => ({ id: file, files: [file] })) },
                    testCommand: 'node --test *',
                    // ── backtest：基准 + 覆盖证据 + 两个执行器
                    ...baseline === undefined ? {} : { baseline },
                    ...coverageInput === undefined ? {} : { coverage: coverageInput },
                    /**
                     * ★ 回测的执行器收的是【一个标签】，不是一条 shell 命令：
                     *   `'full'`（全量）与选测标签。它们的能力是"跑整套测试"，而**整套测试
                     *   是哪些**由本层决定（判据不知道本仓库的测试怎么跑，那是调用方的知识）。
                     *   ⇒ 直接把标签丢给 sh 会得到 127（command not found），而那会被读成
                     *     "全量红了 ⇒ 这次改动弄坏了东西" —— 一次基础设施工况伪装成关于代码的结论。
                     *
                     * ★ 全量 = 任务声明的 verify 命令（那正是"本任务认为什么算全量"）。
                     *   跑不起来 ⇒ 127（非零）⇒ 判据按"全量红"处理并拒绝。
                     *   **不把跑不起来伪装成绿。**
                     */
                    execBacktestCommand: async () => {
                        const commands = task.verify ?? [];
                        if (commands.length === 0)
                            return 127;
                        const codes = await Promise.all(commands.map((command) => runVerifyCommand(workspace, command)));
                        return Math.max(...codes);
                    },
                    execSelectedCommand: async () => {
                        const commands = task.verify ?? [];
                        if (commands.length === 0)
                            return 127;
                        const codes = await Promise.all(commands.map((command) => runVerifyCommand(workspace, command)));
                        return Math.max(...codes);
                    },
                };
                const completionInputSurface = inputSurfaceOf('completion', completionContext);
                const completionGates = await registry.evaluate('completion', completionContext);
                /**
                 * ── ★ t13 的运行时出口：有判据、却一条都没跑 ────────────────────────────
                 *
                 * `evaluated === 0 && registered > 0` 意味着这一轮**没有任何判据真的检查过**
                 * 这个完成动作，而 `ok` 仍为 true。**只告警、不拒绝** —— 拒绝会把"这个位置
                 * 这一轮没有适用判据"（正常情形）变成流程卡死，那正是 t13 明确要求保住的边界。
                 * 但它必须【可读】：否则一次静默全跳过只有 `ok: true` 留给读日志的人。
                 */
                if (completionGates.evaluated === 0 && completionGates.registered > 0) {
                    ctx.logger.warn(`agent-teams: update_task for task "${task.id}" reached completion with no gate evaluated (${completionGates.registered} registered, all skipped); this step was not checked`);
                }
                /**
                 * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬），放在拒绝逻辑**之前**是因为
                 *   它与下面三个分支讲的不是同一件事，而"这次完成本来会被拒"与"这次完成
                 *   的输入面没接完"必须都能读到 —— 只读到前者会让人以为是判据的结论。
                 *   与 t13 那条（`evaluated === 0`）也**不同形**：那是"判据一条都没跑"，
                 *   这是"判据跑了、而它要的某一格调用方没交"。
                 *
                 * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
                 *   `input_surface` 里（`completionInputSurface`）。两条并存。
                 */
                if (completionInputSurface !== undefined && completionInputSurface.incomplete > 0) {
                    ctx.logger.warn(`agent-teams: update_task for task "${task.id}" reached completion with an unfinished input surface (recorded, not rejected): ${completionInputSurface.missing.join('; ')}`);
                }
                if (completionGates.ok === false) {
                    if (completionGates.unmeasured !== undefined) {
                        /**
                         * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
                         *   看出"判据没能测量"，而不是"判据发现了问题"。
                         */
                        throwWithSurface(`update_task rejected: the completion gate could not measure (${completionGates.unmeasured})`, completionInputSurface, 'completion_input_surface');
                    }
                    throwWithSurface(`update_task rejected: ${completionGates.blockers.join('; ')}`, completionInputSurface, 'completion_input_surface');
                }
                /**
                 * 判据【通过时】交出的产出：把判据层亲眼看到的 exitCode 并回 commandsRun，
                 * 让落盘的是它看到的那个，而不是成员自报的。
                 */
                const producedReruns = (completionGates.outputs['completion.verify-rerun']?.reruns ?? []);
                const mergedCommandsRun = producedReruns.length > 0
                    ? mergeRerunIntoCommandsRun(commandsRun ?? task.commandsRun, producedReruns)
                    : commandsRun;
                const gate = evaluateQualityCompletion(task, {
                    status: args.status,
                    output: args.output,
                    verdict: args.verdict,
                    findings,
                    changedPaths: input.changedPaths,
                    acceptanceResults,
                    commandsRun: mergedCommandsRun ?? commandsRun,
                });
                if (!gate.ok)
                    throw new Error(gate.error ?? 'update_task rejected by quality gates');
                if (args.status !== undefined) {
                    const transition = transitionError(task.status, args.status);
                    if (transition !== undefined)
                        throw new Error(transition);
                    task.status = args.status;
                }
                if (args.output !== undefined)
                    task.output = args.output;
                if (args.verdict !== undefined)
                    task.verdict = args.verdict;
                if (findings !== undefined)
                    task.findings = findings;
                if (input.changedPaths !== undefined)
                    task.changedPaths = input.changedPaths;
                if (acceptanceResults !== undefined)
                    task.acceptanceResults = acceptanceResults;
                if (commandsRun !== undefined)
                    task.commandsRun = commandsRun;
                task.updatedAt = Date.now();
                const priorDependencies = new Map(fresh.tasks.map(item => [item.id, [...item.dependencies]]));
                const followUp = (task.status === 'failed' && (task.verdict === 'needs_revision' || task.verdict === 'reject'))
                    ? applyQualityFollowUp(fresh, task)
                    : undefined;
                let followUpSummary;
                if ((followUp?.created.length ?? 0) > 0) {
                    const rewired = fresh.tasks.filter(item => priorDependencies.has(item.id) && JSON.stringify(priorDependencies.get(item.id)) !== JSON.stringify(item.dependencies));
                    followUpSummary = `Automatic quality follow-up for ${task.id}: ${followUp.created.map(item => `${item.id} (${item.kind}, owner=${item.assignee ?? 'unassigned'}, deps=${item.dependencies.join(',') || 'none'})`).join('; ')}.${rewired.length ? ` Updated dependencies: ${rewired.map(item => `${item.id} -> ${item.dependencies.join(',')}`).join('; ')}.` : ''} Use these tasks; do not create duplicate repair/review work.`;
                    followUpMessage = createMessage(CAPTAIN_KEY, CAPTAIN_KEY, followUpSummary);
                }
                if (followUp?.escalated === true) {
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(CAPTAIN_KEY, CAPTAIN_KEY, `Quality-gate loop escalated after ${task.id} (${task.kind ?? 'review'} verdict=${task.verdict}). Automatic repair/review stopped.`));
                }
                await writeTeam(stateRoot, fresh);
                /**
                 * ── ★★ 成员提交一次更新 ⇒ 顺手**读一遍它的会话日志**（这是第二个观察时刻）──
                 *
                 * ── 两个"看起来都行"、而只有一个是错的写法 ─────────────────────────────
                 *
                 * ✗ 错的：把**这次工具调用**当成一次产出（`args.output` 非空 ⇒ 记一次活动）。
                 *   它错得很像对的（"产出当场就在手上，何必去翻日志"），而后果是**关掉判据**：
                 *   一个卡死的成员，只要它的工具还在被调用（重试、心跳、空转），
                 *   `lastActivityAt` 就会被反复刷新 ⇒ 两次探活读数一直在变 ⇒ **永远不报警**。
                 *   而那正是探活存在的全部理由。用户已裁定活动的定义是
                 *   「**以产出为准（有 `assistant/message` 才算在动；`status` 可能因别的原因
                 *   抖动）**」—— 工具参数**不是** `assistant/message`。
                 *
                 * ✓ 对的：在这里**读一次该成员的会话日志**（`observeMemberActivity`），
                 *   与 `observeMemberConvergence` 同源、与探活同一个判据面。**产物仍然是
                 *   `assistant/message`**，所以它不会把"工具被调用"读成"在动"：一个只被
                 *   反复调用工具、却一句话都没说的成员，指纹不变 ⇒ 什么都不记。
                 *
                 * ── 为什么需要这第二个时刻（只留派发 + 探活是不够的）─────────────────────
                 *
                 * 观察时刻越多，活动时刻越**接近真实**。只留两个的话，最坏情形是：
                 *
                 *     成员在 T1..T2 之间一直在产出，而队长直到 T3 才查一次状态
                 *     ⇒ 判据在 T3 才第一次看见那些产出 ⇒ `lastActivityAt = T3`
                 *
                 * 这不是假报警（那一轮反而看不到"没动"），但它是**迟到的观察**：在 T1 与 T3
                 * 之间的任何一次探活，都会把"它其实一直在动"读成"它没动"。而
                 * `agent_teams_update_task` 是**成员每次交进展都会经过的那一步** ——
                 * 用它当观察时刻，代价是一次已有的会话读，换来的是探测精度。
                 *
                 * ★ 它**不能替代**探活时刻：一个成员可能长时间只在写文件、跑命令，
                 *   一条更新都不发 —— 那时只有 `agent_teams_status` 能观察到它。
                 *   两个时刻都要，因为探活问的是"它还在动吗"，而"动"发生在任何时刻。
                 */
                {
                    const activeMember = fresh.members.find(candidate => candidate.name === task.assignee);
                    if (identity.kind === 'member' && activeMember !== undefined && activeMember.id !== '') {
                        observeMemberActivity(ctx, activeMember.id, task.attemptId, clock());
                    }
                }
                /**
                 * ── ★ runtime 位置：这一步【做完了】（契约 §5）───────────────────────────
                 *
                 * 上面的调用点看的是"意图"（`args.status`），这里看的是"结果"（落盘后的 task）。
                 * 两者不同形不是重复：一条运行判据可能想问"这个成员是不是在一个已超时的会话里
                 * 报了完成"—— 而在意图那一刻还看不出来。仍然：**任何裁决都不阻止流程** ——
                 * 状态已经写下去了，本调用点做的事只有记录。
                 */
                runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update-settled', {
                    team: fresh,
                    task,
                    update: { status: task.status, output: task.output, verdict: task.verdict },
                    updateGate: completionGates,
                    wantsCompleted,
                }, clock);
                if (followUpMessage !== undefined)
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, followUpMessage);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.output !== undefined ? { output: task.output } : {},
                    ...task.verdict === undefined ? {} : { verdict: task.verdict },
                    ...task.round === undefined ? {} : { round: task.round },
                });
                for (const created of followUp?.created ?? []) {
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-created', {
                        teamId: fresh.id,
                        taskId: created.id,
                        subject: created.subject,
                        dependencies: created.dependencies,
                        ...created.assignee === undefined ? {} : { assignee: created.assignee },
                        ...created.kind === undefined ? {} : { kind: created.kind },
                        ...created.round === undefined ? {} : { round: created.round },
                    });
                }
                return {
                    ...followUpSummary === undefined ? {} : { follow_up: followUpSummary },
                    task_id: task.id,
                    status: task.status,
                    attempt: task.attempt ?? 0,
                    ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                    ...task.output !== undefined ? { output: task.output } : {},
                    /**
                     * ★ runtime 位置的裁决【随返回值一起交出去】。
                     *
                     * 缺席（这个事件类型没有挂 runtime 判据）⇒ 字段不出现。**不是** `ok` ——
                     * 把"这里没有过程约束"读成"过程约束通过了"，正是三态要防的那种合流。
                     */
                    ...runtimeGateRecord === undefined ? {} : { runtime_gates: runtimeGateRecord },
                    /**
                     * ── ★★ t3：**同一次 `update_task`** 走的是**两个**位置 ────────────────────
                     *
                     * 这一行之前，这两个位置的核对结论只有一个 `logger.warn`（见上面那两处
                     * 分支）。⇒ 一次 `update_task` 被拒或成功之后，"**这两个位置的输入面
                     * 接没接全**"在返回值里读不到 —— 而它们恰恰是历史上的缺陷集中地
                     * （`observedChangedPaths` / 三个执行器 / `parentRevision` 都缺过一次）。
                     *
                     * ★ 两处**各挂各的、不合并**：它们核对的是两份不同的 ctx（一个是
                     *   `{task, update, observedChangedPaths}`，一个是那份最长的 completion ctx），
                     *   合成一份会让"哪一个位置缺哪一格"重新变得读不出来 —— 那正是本任务
                     *   要消灭的形状。字段名相同（都与 runtime 同形），但挂的位置区分得开。
                     *
                     * ★ 三态（两处各自独立）：
                     *   · 都齐            ⇒ 字段在场，`incomplete: 0`
                     *   · 有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
                     *   · 这个位置没判据  ⇒ 字段不出现（**不是** `ok`）
                     */
                    ...dispatchInputSurface === undefined ? {} : { dispatch_input_surface: dispatchInputSurface },
                    ...completionInputSurface === undefined ? {} : { completion_input_surface: completionInputSurface },
                };
            });
            if (followUpMessage !== undefined) {
                const captain = ctx.agents.get(team.captainSessionId);
                if (captain !== undefined && steerCaptainReport(captain, CAPTAIN_KEY, followUpMessage.content, mailboxPrompt(team.id, CAPTAIN_KEY, [followUpMessage]))) {
                    await withTeamLock(teamLockKey(stateRoot, team.id), () => markMailboxDelivered(stateRoot, team.id, CAPTAIN_KEY, [followUpMessage.id]));
                }
            }
            await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined);
            return updated;
        },
    })));
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_amend_task',
        description: 'Captain-only controlled contract amendment for one non-terminal quality task: replace a wrong objective/acceptance/verify/inScope/outOfScope when the original contract makes honest completion impossible (for example a verify command that cannot pass, or an inScope that forbids the file the objective names). The amendment is appended to the task\'s revisions ledger with previous values and the reason, and is rejected once a review/requirements task has passed judgment on this task. Members cannot amend contracts; the implementer re-reads the amended contract before its next quality gate. Lists are full replacements, not deltas.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'Task whose contract is being amended.' },
            reason: { type: 'string', required: true, description: 'Why the current contract is wrong; recorded in the revisions ledger.' },
            objective: { type: 'string', description: 'Replacement objective.' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'Replacement acceptance criteria (full list, not a delta).' },
            verify: { type: 'array', items: { type: 'string' }, description: 'Replacement verification commands (full list, not a delta).' },
            inScope: { type: 'array', items: { type: 'string' }, description: 'Replacement workspace-relative inScope paths (full list).' },
            outOfScope: { type: 'array', items: { type: 'string' }, description: 'Replacement workspace-relative outOfScope paths (full list).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    revised_fields: { type: 'string', required: true },
                    revision_count: { type: 'number', required: true },
                    contract: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} contract amended (${value.revised_fields}); ${value.revision_count} revision(s) on record, status ${value.status}. New contract: ${value.contract}`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const amended = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                const input = {
                    ...args.objective === undefined ? {} : { objective: args.objective },
                    ...args.acceptance === undefined ? {} : { acceptance: args.acceptance },
                    ...args.verify === undefined ? {} : { verify: args.verify },
                    ...args.inScope === undefined ? {} : { inScope: args.inScope },
                    ...args.outOfScope === undefined ? {} : { outOfScope: args.outOfScope },
                };
                const result = amendTaskContract(fresh, task, normalizeBlankOptionalTaskFields(input), CAPTAIN_KEY, args.reason);
                if (!result.ok || result.task === undefined) {
                    throw new Error(result.error ?? 'amend_task rejected by quality gates');
                }
                Object.assign(task, result.task);
                task.updatedAt = Date.now();
                /**
                 * ── ★ contract 位置（第二个切入点：「改契约」）─────────────────────────────
                 *
                 * 与建任务同一个位置、同一种叠加方式：`amendTaskContract` 先校验修订本身
                 * （它不认识判据层），判据层再问"修订后的契约可判吗"。理由与建任务处相同 ——
                 * 一条被改成不可判的 verify 命令（例如一个永远失败的 grep），若只在建任务时
                 * 检查，就会从"改契约"这条路上溜过去。
                 *
                 * ★ 执行器（t18）：与 create_task 处同一个注入、同一个实现。**两条路都必须注入**
                 *   —— 只修一条会让"改契约"变成绕过可判性检查的入口，而那正是本调用点存在的理由。
                 */
                const amendContractSurface = await rejectOnContractGates(ctx, {
                    team: fresh,
                    task,
                    creating: false,
                    amended: result.revision?.fields ?? [],
                    reason: args.reason,
                }, 'amend_task', {
                    execVerifyCommand: (command) => runVerifyCommand(workspace, command),
                });
                await writeTeam(stateRoot, fresh);
                return {
                    taskId: task.id,
                    status: task.status,
                    fields: result.revision?.fields ?? [],
                    revisionCount: task.revisions?.length ?? 0,
                    ...amendContractSurface === undefined ? {} : amendContractSurface,
                    contract: {
                        ...task.objective === undefined ? {} : { objective: task.objective },
                        ...task.acceptance === undefined ? {} : { acceptance: task.acceptance },
                        ...task.verify === undefined ? {} : { verify: task.verify },
                        ...task.inScope === undefined ? {} : { inScope: task.inScope },
                        ...task.outOfScope === undefined ? {} : { outOfScope: task.outOfScope },
                    },
                };
            });
            appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, captain.session), 'agent-teams/task-amended', {
                teamId: team.id,
                taskId: amended.taskId,
                fields: amended.fields,
                reason: args.reason,
            });
            return {
                task_id: amended.taskId,
                status: amended.status,
                revised_fields: amended.fields.join(', '),
                revision_count: amended.revisionCount,
                /**
                 * ★★ t3：contract 位置的核对结论**随记录交出去**（与 runtime 同形）。
                 *   这是 contract 位置的**第二条路**（改契约）—— 两条路各挂各的：
                 *   只挂在建任务上，会让"改契约"这条路上的输入面缺失重新变成只能靠日志碰运气。
                 */
                ...amended.input_surface === undefined ? {} : { input_surface: amended.input_surface },
                contract: JSON.stringify(amended.contract),
            };
        },
    })));
    ctx.tools.register(defineTool({
        name: 'agent_teams_send_message',
        description: 'Send coordination or current-task guidance directly to the captain or a teammate. A running recipient receives it at the next model step; an idle recipient wakes. Messages are durably retained until read. Use task creation/reassignment for a new unit of work, not repeated status nudges.',
        parameters: {
            source_task_id: { type: 'string', description: 'Sender task, NOT the recipient task. Members include it with source_attempt_id. Captains sending guidance normally omit both source fields.' },
            source_attempt_id: { type: 'string', description: 'Sender execution capability paired with source_task_id. Stale reports are rejected. Omit for ordinary captain guidance.' },
            to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
            content: { type: 'string', required: true, description: 'The message text.' },
            from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    message_id: { type: 'string', required: true },
                    from: { type: 'string', required: true },
                    to: { type: 'string', required: true },
                    delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), mailbox (durable inbox only), or duplicate (same message already retained).' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            const to = args.to.trim();
            const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const from = identity.name;
                // `from` may only be the caller's own identity: impersonating another
                // member (or the captain) would poison the mailbox and event records.
                if (args.from !== undefined && args.from !== from) {
                    throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`);
                }
                const sourceTaskId = args.source_task_id?.trim() || undefined;
                const sourceAttemptId = args.source_attempt_id?.trim() || undefined;
                if ((sourceTaskId === undefined) !== (sourceAttemptId === undefined))
                    throw new Error('send_message requires source_task_id and source_attempt_id together');
                const source = sourceTaskId === undefined
                    ? identity.kind === 'member' ? memberOpenTask(fresh, identity.name) ?? fresh.tasks.filter(item => item.assignee === identity.name && item.attemptId !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined
                    : requireTask(fresh, sourceTaskId);
                if (sourceTaskId !== undefined && (source?.assignee !== identity.name || source.attemptId !== sourceAttemptId)) {
                    throw new Error('stale or foreign source attempt; stop sending results from the revoked task');
                }
                const sourceFields = source?.attemptId === undefined ? {} : { sourceTaskId: source.id, sourceAttemptId: source.attemptId, sourceTaskStatus: source.status };
                const owned = to === CAPTAIN_KEY ? undefined : memberOpenTask(fresh, requireMember(fresh, to).name);
                const duplicate = (await readMailbox(stateRoot, fresh.id, to)).find(message => message.from === from
                    && message.content === args.content && message.taskId === owned?.id && message.attemptId === owned?.attemptId
                    && message.sourceTaskId === sourceFields.sourceTaskId && message.sourceAttemptId === sourceFields.sourceAttemptId && message.sourceTaskStatus === sourceFields.sourceTaskStatus
                    && isCurrentMail(fresh, message) && (message.attemptId !== undefined || message.sourceAttemptId !== undefined || message.readAt === undefined));
                if (duplicate !== undefined)
                    return { kind: 'duplicate', message: duplicate, from };
                if (to === CAPTAIN_KEY) {
                    const message = { ...createMessage(from, CAPTAIN_KEY, args.content), ...sourceFields, deliveryClaimedAt: Date.now() };
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message);
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
                        teamId: fresh.id,
                        messageId: message.id,
                        from,
                        to: CAPTAIN_KEY,
                        content: args.content,
                        ts: message.ts,
                    });
                    return { kind: 'captain', fresh, identity, message, from };
                }
                if (fresh.halted === true) {
                    throw new Error(`team "${fresh.name}" is halted; call agent_teams_resume before waking a member`);
                }
                const recipient = requireMember(fresh, to);
                const message = { ...createMessage(from, recipient.name, args.content), ...sourceFields, deliveryClaimedAt: Date.now(),
                    ...owned?.attemptId === undefined ? {} : { taskId: owned.id, attemptId: owned.attemptId },
                };
                await appendMailbox(stateRoot, fresh.id, recipient.name, message);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
                    teamId: fresh.id,
                    messageId: message.id,
                    from,
                    to: recipient.name,
                    content: args.content,
                    ts: message.ts,
                });
                return { kind: 'member', fresh, identity, message, from, recipient };
            });
            if (prepared.kind === 'duplicate')
                return { message_id: prepared.message.id, from: prepared.from, to: prepared.message.to, delivered: 'duplicate' };
            // Resolve the exact live captain only after releasing the state lock.
            // The plugin mailbox is already durable if live delivery cannot proceed.
            const captain = ctx.agents.get(prepared.fresh.captainSessionId);
            if (prepared.kind === 'captain') {
                let delivered = 'mailbox';
                if (captain !== undefined && prepared.identity.kind === 'member') {
                    delivered = steerCaptainReport(captain, prepared.from, args.content, mailboxPrompt(prepared.fresh.id, CAPTAIN_KEY, [prepared.message])) ? 'live' : 'mailbox';
                }
                if (delivered === 'live') {
                    await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (markMailboxDelivered(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])));
                }
                else {
                    await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])));
                }
                return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered };
            }
            let delivered = 'mailbox';
            if (captain !== undefined) {
                const text = mailboxPrompt(prepared.fresh.id, prepared.recipient.name, [prepared.message]);
                const accepted = await dispatchMember(captain, prepared.fresh.id, prepared.recipient.name, text, exec.signal, 'steer', prepared.message.attemptId);
                delivered = accepted ? 'wake' : 'mailbox';
                if (accepted) {
                    await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (markMailboxDelivered(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])));
                }
            }
            if (delivered === 'mailbox') {
                await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])));
            }
            return {
                message_id: prepared.message.id,
                from: prepared.from,
                to: prepared.recipient.name,
                delivered,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_status',
        description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Use after mailbox progress deliveries or for an explicit status request. After dispatch, end your turn while members work; do not repeatedly poll.',
        parameters: {},
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
        },
        async execute(_args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireParticipantTeam(workspace, config, caller);
            if (located.captainSessionId === caller.id) {
                await scheduler.kickTeam(workspace, located.id, caller);
            }
            const { team, identity } = await withTeamLock(teamLockKey(stateRoot, located.id), () => requireFreshParticipant(stateRoot, located.id, caller.id));
            const activity = memberActivity(ctx, team.members.map((member) => member.id));
            const members = team.members
                .filter((member) => member.status !== 'removed')
                .map((member) => ({
                name: member.name,
                role: member.role ?? '',
                provider: member.provider ?? '',
                model: member.model ?? '',
                reasoning_effort: member.reasoningEffort ?? '',
                status: member.status,
                activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
                ...member.spawnError === undefined ? {} : { spawn_error: member.spawnError },
            }));
            const tasks = team.tasks.map((task) => ({
                id: task.id,
                subject: task.subject,
                status: task.status,
                assignee: task.assignee ?? '',
                dependencies: task.dependencies,
                attempt: task.attempt ?? 0,
                attempt_id: task.attemptId ?? '',
                reassigning: task.reassigning === true,
                kind: taskKindOf(task),
                ...task.round === undefined ? {} : { round: task.round },
                ...task.verdict === undefined ? {} : { verdict: task.verdict },
                ...task.supplementalEvidence === undefined ? {} : { supplemental_evidence: JSON.stringify(task.supplementalEvidence) },
                findings_open: (task.findings ?? []).filter((finding) => finding.resolved !== true).length,
                ...task.profileSeedId === undefined ? {} : { seed_id: task.profileSeedId },
                ...task.output !== undefined ? { output: task.output } : {},
            }));
            const mailboxWarnings = [];
            let mailboxWarningCount = 0;
            const reportMalformed = (agentKey) => (lineNumber) => {
                mailboxWarningCount += 1;
                if (mailboxWarnings.length < 10) {
                    mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`);
                }
            };
            const captainInbox = identity.kind === 'captain'
                ? await readCurrentMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
                : [];
            const ownInbox = identity.kind === 'member' ? (await readCurrentMailbox(stateRoot, team.id, identity.name)).slice(0, 10) : [];
            const memberInboxes = {};
            const visibleMembers = identity.kind === 'captain'
                ? members
                : members.filter((member) => member.name === identity.name);
            for (const member of visibleMembers) {
                const messages = await readCurrentMailbox(stateRoot, team.id, member.name, reportMalformed(member.name));
                if (messages.length > 0) {
                    memberInboxes[member.name] = {
                        count: messages.length,
                        latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
                    };
                }
            }
            const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))], team.tasks).map((row) => ({
                goal_item: row.goal_item,
                task_ids: [...row.task_ids],
                status: row.status,
                ...row.evidence === undefined ? {} : { evidence: row.evidence },
            }));
            const deliveryCheck = canDeclareDelivery(team);
            /**
             * ── ★ delivery 位置：**报告**在这里，**拒绝**在 declare_delivery（t18/B2）────
             *
             * MEASURED（2026-10-05，本队 t16/t17）：本工具此前直接调用拒绝逻辑
             * （`rejectOnDeliveryGates`），于是一个团队只要还没收敛，队长**连"现在什么情况"
             * 都读不到** —— 而读不到状态正是他判断"该不该让它收敛"的前提。**死结**：
             *
             *     想看状态 ⇒ 被拒（因为没收敛）
             *     想让成员收敛 ⇒ 得先看状态
             *
             * ★ 根因是**「唯一的读取点」被当成了「宣告点」**。它们是两件事：
             *     · 读取（本工具）—— 随时都该能发生，否则队长瞎着眼
             *     · 宣告（`agent_teams_declare_delivery`）—— 那才是该被拒绝的那一刻
             *
             * ⇒ 现在这里**只求值、只报告**：裁决并进返回值的 `delivery` 字段（连同判据层的
             *   blockers），流程照常。拒绝由新增的 `agent_teams_declare_delivery` 承载
             *   —— **delivery 判据仍然真的会拦，只是拦在它该拦的那一步**。
             */
            const memberConvergence = observeMemberConvergence(ctx, team);
            /**
             * ── ★ 调用点②（第三条入口）：读一次会话日志，看每个成员还在不在动 ─────────
             *
             * 这里是**最自然**的观察点，理由有两条，缺一条都不够：
             *
             *   ① 它本来就在读会话（`observeMemberConvergence` 已走同一个入口），所以多读
             *      一遍 `assistant/message` **不引入新的 I/O**；
             *   ② 它是探活的**驱动时刻**（用户已裁定：10 分钟探活一次）。判据只在被调用的
             *      那一刻才说话，而"被调用"发生在这里 —— 所以**观测与探活必须是同一刻**，
             *      否则判据读到的是一个上次探活留下的陈旧读数，而它看起来与新鲜读数同形。
             *
             * ★ 观察**先于**求值：本段在下面的 `evaluateRuntimeGates` 之前跑，于是这一次
             *   求值读到的 `lastActivityAt` 是刚刚观察到的。反过来会让一次探活永远是
             *   "上一次"的视图 —— 而那正是"两次探活读数没变 ⇒ 报警"的假阳性来源。
             *
             * ★ 对**每个**未结束任务的成员都观察，不只是当前忙的那些：一个成员可能刚刚
             *   产出、然后回到 idle，而"它动过"这件事必须留在记录里（否则下一次探活会
             *   把它读成"从派发到现在一直没动"）。
             */
            const now = clock();
            for (const task of team.tasks) {
                if (TERMINAL_TASK_STATUSES.includes(task.status))
                    continue;
                if (task.assignee === undefined || task.assignee === CAPTAIN_KEY)
                    continue;
                const activeMember = team.members.find(candidate => candidate.name === task.assignee);
                if (activeMember === undefined || activeMember.id === '')
                    continue;
                observeMemberActivity(ctx, activeMember.id, task.attemptId, now);
            }
            const deliveryContext = {
                team,
                gate: deliveryCheck,
                coverage,
                ...memberConvergence === undefined ? {} : { members: memberConvergence },
            };
            /**
             * ★ 只报告：这里**不**抛错。`delivery` 字段要把【两边的结论】都交出去 ——
             *   上游 `canDeclareDelivery` 的 blockers 与判据层的裁决，缺一样读日志的人就
             *   分不出"是契约层面不允许"还是"是某条判据发现了问题"。
             */
            /**
             * ★ 输入面核对（t10）：求值之前，对着**同一个** ctx。这里与 `task-status`
             *   是**两个**调用点，各自核对一次 —— 不是因为会得到不同结论，而是因为
             *   "报告"与"宣告"这两个入口必须都读得出输入面缺没缺（只在一个入口核对，
             *   另一个入口的缺失就成了只能靠日志碰运气看见的东西）。
             */
            const deliveryInputSurface = inputSurfaceOf('delivery', deliveryContext);
            const deliveryEvaluation = await registry.evaluate('delivery', deliveryContext);
            const runtimeRecord = await evaluateRuntimeGates(ctx, 'task-status', deliveryContext, clock);
            /**
             * ★★ t3：这条日志**保留**（给人看）；结构化出口挂在下面 `delivery` 字段里的
             *   `input_surface`。两条并存 —— 只留日志的出口在日志被截断时与"输入面齐"同形。
             */
            if (deliveryInputSurface !== undefined && deliveryInputSurface.incomplete > 0) {
                ctx.logger.warn(`agent-teams: the status read reached the delivery gate with an unfinished input surface (recorded, not rejected): ${deliveryInputSurface.missing.join('; ')}`);
            }
            const delivery = {
                ok: deliveryEvaluation.ok === false ? false : deliveryCheck.ok,
                blockers: [
                    ...deliveryCheck.blockers,
                    ...deliveryEvaluation.blockers,
                    ...deliveryEvaluation.unmeasured === undefined ? [] : [`could not measure: ${deliveryEvaluation.unmeasured}`],
                ],
                /**
                 * ★ 判据层有没有就交付说话。`false` 表示这个位置这一轮没有任何判据求值
                 *   —— 与"判据都通过了"不同形（那正是本队反复强调的那条分界）。
                 */
                gates_evaluated: deliveryEvaluation.evaluated,
                /**
                 * ── ★★ t3：核对结论**随这次读取一起交出去**（与 runtime 同形）───────────
                 *
                 * ★ 挂在这里而不是 `result` 的顶层：它说的**就是**这次交付位置求值的输入面，
                 *   而 `delivery` 已经是"这次交付裁决"的落点（`ok` / `blockers` /
                 *   `gates_evaluated`）。顶层多一个同名字段会让"哪一份属于哪个位置"读不出来，
                 *   而本队已经吃过"读错位置的出口"那一次（挂 A 位置却读 B 位置独有字段）。
                 *
                 * ★ 三态：都齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/ 这个位置这一轮
                 *   没挂判据（**字段不出现** —— 不是 `ok`）。
                 */
                ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },
            };
            const loop = describeQualityLoop(team);
            const result = {
                team_id: team.id,
                team_name: team.name,
                description: team.description ?? '',
                phase: team.phase ?? 'running',
                halted: loop.halted,
                escalated: loop.escalated,
                loop_state: loop.state,
                loop_summary: loop.summary,
                deliverable: loop.deliverable,
                coverage,
                delivery,
                ...team.profile === undefined ? {} : {
                    profile: {
                        name: team.profile.name,
                        ...team.profile.protocol === undefined
                            ? {}
                            : { protocol: team.profile.protocol.slice(0, 240) },
                        ...team.profile.taskPlanning === undefined ? {} : { task_planning: team.profile.taskPlanning },
                    },
                },
                viewer: identity.name,
                ...runtimeRecord === undefined ? {} : { runtime_gates: runtimeRecord },
                members,
                tasks,
                captain_inbox: captainInbox.slice(0, 10).map((message) => ({
                    from: message.from,
                    content: mailboxContent(message),
                    ts: message.ts,
                })),
                member_inbox: ownInbox.map(message => ({ from: message.from, content: mailboxContent(message), ts: message.ts })),
                member_inboxes: memberInboxes,
                mailbox_warnings: mailboxWarnings,
                mailbox_warning_count: mailboxWarningCount,
            };
            const acknowledged = identity.kind === 'captain'
                ? captainInbox.slice(0, 10).map(message => message.id)
                : ownInbox.map(message => message.id);
            if (acknowledged.length > 0) {
                await withTeamLock(teamLockKey(stateRoot, team.id), () => (acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)));
            }
            return result;
        },
    }));
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_declare_delivery',
        /**
         * ★ 这是 delivery 位置的【宣告点】（t18/B2）。
         *
         * 为什么必须单独存在一个工具：delivery 位置的判据（coverage / convergence）是
         * **裁决**，而裁决需要一个名副其实的落点。此前它挂在 `agent_teams_status` 上
         * —— 那是个**读取**操作，于是一个还没收敛的团队连"现在什么情况"都读不到，
         * 队长瞎着眼修不了任何东西。**「唯一的读取点」不等于「宣告点」。**
         *
         * ⇒ 读取（status）随时能发生、只报告；宣告（本工具）才被拒绝。
         */
        description: 'Captain-only delivery declaration: asks the delivery insertion point whether this team may be reported to the user as delivered, and REFUSES when it may not (uncovered goals, members that never converged, unfinished quality gates). Use it right before telling the user the work is done. agent_teams_status only REPORTS the same verdict without refusing, so reading team state never blocks.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    team_id: { type: 'string', required: true },
                    declared: { type: 'boolean', required: true },
                    blockers: { type: 'array', items: { type: 'string' }, required: true },
                    gates_evaluated: { type: 'number', required: true },
                    loop_state: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.declared
                        ? `Delivery declared for team ${value.team_id} (${value.gates_evaluated} delivery gate(s) evaluated).`
                        : `Delivery refused for team ${value.team_id}: ${value.blockers.join('; ')}`,
                }],
        },
        async execute(_args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, caller);
            const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))], team.tasks);
            const deliveryCheck = canDeclareDelivery(team);
            const memberConvergence = observeMemberConvergence(ctx, team);
            const deliveryContext = {
                team,
                gate: deliveryCheck,
                coverage,
                ...memberConvergence === undefined ? {} : { members: memberConvergence },
            };
            /**
             * ★ 与 status 用【同一个】求值面：报告与宣告必须读同一份事实，否则
             *   "status 说能交、declare 说不能"会成为一个新的、更难查的不一致。
             *
             * ★ 输入面核对（t10）：同样在求值之前、对着同一个 ctx。★ 它**不参与**下面
             *   的拒绝 —— 核对报缺时这条宣告照常走完（先软后硬）。一个自己还没被验证过
             *   的新机制当场否决交付，正是本队反复踩的形态。
             */
            const deliveryInputSurface = inputSurfaceOf('delivery', deliveryContext);
            const evaluation = await registry.evaluate('delivery', deliveryContext);
            const loop = describeQualityLoop(team);
            /**
             * ★ `unmeasured` 与 `blockers` 必须【不同形】（契约 §3.4）：前者是"没能测量"，
             *   后者是"发现了问题"。合并成一句话会让读日志的人把"没测成"读成"查出了问题"。
             *   ——这正是既有 `rejectOnDeliveryGates` 的分法，这里与它同形。
             *
             * ★★ t3：两处拒绝都改成 `throwWithSurface` —— 被拒的宣告里，
             *   "是交付本身不允许"与"是这个位置的输入面没接完"必须**同时读得到**。
             */
            if (evaluation.ok === false || deliveryCheck.ok === false) {
                if (evaluation.unmeasured !== undefined) {
                    throwWithSurface(`declare_delivery rejected: the delivery gate could not measure (${evaluation.unmeasured})`, deliveryInputSurface);
                }
                throwWithSurface(`declare_delivery rejected: ${[
                    ...deliveryCheck.blockers,
                    ...evaluation.blockers,
                ].join('; ')}`, deliveryInputSurface);
            }
            if (evaluation.evaluated === 0 && evaluation.registered > 0) {
                ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with no gate evaluated (${evaluation.registered} registered, all skipped); delivery was not checked`);
            }
            /**
             * ★★ t3：这条日志**保留**（给人看）；结构化出口在下面返回值的 `input_surface`。
             */
            if (deliveryInputSurface !== undefined && deliveryInputSurface.incomplete > 0) {
                ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with an unfinished input surface (recorded, not rejected): ${deliveryInputSurface.missing.join('; ')}`);
            }
            await evaluateRuntimeGates(ctx, 'delivery-declared', deliveryContext, clock);
            void stateRoot;
            return {
                team_id: team.id,
                declared: true,
                blockers: [],
                gates_evaluated: evaluation.evaluated,
                loop_state: loop.state,
                /**
                 * ★★ 与 `agent_teams_status` 完全同一个形状（同一个构造点、同一个字段名）：
                 *   那两个入口是同一份核对的两个时刻，"报告"与"宣告"读到的结论必须可机械比对，
                 *   否则"status 说输入面齐、declare 说有缺格"会成为一个新的、更难查的不一致。
                 *   三态同前：齐（0）/ 有缺格（N + 名单）/ 这个位置没判据（字段不出现）。
                 */
                ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },
            };
        },
    })));
    ctx.tools.register(defineTool({
        name: 'agent_teams_resume',
        description: 'Explicitly resume a halted team. Requires a non-empty reason. Does not recreate cancelled tasks; only still-pending work is scheduled.',
        parameters: {
            reason: { type: 'string', required: true, description: 'Why the team is being resumed.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.status === 'already_running'
                        ? `Team ${value.team_id} is already running.`
                        : `Team ${value.team_id} resumed (${value.reason}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const result = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const resumed = resumeTeamState(fresh, args.reason);
                if (resumed.status === 'rejected')
                    throw new Error(resumed.error ?? 'resume rejected');
                if (resumed.status === 'resumed') {
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    await writeTeam(stateRoot, fresh);
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
                        teamId: fresh.id,
                        reason: args.reason,
                    });
                }
                return {
                    status: resumed.status,
                    team_id: fresh.id,
                    reason: args.reason,
                };
            });
            if (result.status === 'resumed')
                await scheduler.kickTeam(workspace, team.id, captain);
            return result;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_delete',
        description: 'End and archive your team: interrupts members and moves the current tasks and mailboxes out of active state for later inspection. Use when the work is done or explicitly abandoned. A same-name archive replaces its previous generation.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    deleted: { type: 'boolean', required: true },
                    team_name: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Team "${value.team_name}" ended and archived.`,
                }],
        },
        async execute(_args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                // Include previously removed members so deleting a pre-fix team also
                // retires durable catalog entries left behind by remove_member.
                const roster = fresh.members.map(member => ({ ...member }));
                for (const member of fresh.members) {
                    await discardMailboxMessages(stateRoot, fresh.id, member.name, (await readUnreadMailbox(stateRoot, fresh.id, member.name)).map(message => message.id));
                    if (member.status === 'removed')
                        continue;
                    member.status = 'removed';
                    for (const task of fresh.tasks) {
                        if (task.assignee === member.name && !TERMINAL_TASK_STATUSES.includes(task.status))
                            invalidateTaskAttempt(task);
                    }
                }
                await writeTeam(stateRoot, fresh);
                return roster;
            });
            await recordRetiredMemberIds(stateRoot, members.map(member => member.id));
            await stopTeamMemberActivations(ctx, captain, members, exec.signal);
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
                    teamId: fresh.id,
                });
                // Archive, not delete: tasks (with their dependency graph) and the
                // mailboxes stay on disk for later review and dependency rebuilds.
                await archiveTeamDir(stateRoot, fresh.id);
            });
            return { deleted: true, team_name: team.name };
        },
    }));
    return runtime;
}
async function initializeProfileTeam(input) {
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
function parseFindings(value) {
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
function parseAcceptanceResults(value) {
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
function parseCommandResults(value) {
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
/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config) {
    return {
        provider: config.memberProvider,
        maxDepth: config.memberMaxDepth,
        executionPrompt: config.executionPrompt,
        fallback: config.fallback,
    };
}
/** Render the status snapshot as compact text for the model. */
function renderStatus(value) {
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
