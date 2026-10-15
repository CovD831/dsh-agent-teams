// ── src/tools/shared/entities.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的共享实体（含它们自身的传递依赖）。
// ★ 搬运规则：一个字符都不改 —— 「拆分不得改变行为」最直接的证据就是逐字相同。
// ★ 本文件【不允许】import src/tools.ts（会成环：tools.ts → 工具模块 → 本文件）。
// 它只 import 更底层的模块。
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { dirname, join } from 'node:path';
/**
 * ★ t53：规则表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 *   ★ 方向不会成环：`verify-command.ts` 只 import `registry.ts` / `requires.ts`，
 *     它不知道 tools 层存在。
 *   ★ 而校验与读盘分开是刻意的：读不到是**调用方**的事实（`absent`），
 *     形状坏是**数据本身**的事实（`malformed`）—— 两者不同形，由两个地方各自判。
 */
import { parseRules } from "../../gates/contract/verify-command.js";
/**
 * ★ 预算停止的记号住在 gates 层的**叶子**模块里，不是这里。
 *   理由：认出它的两个地方（`gates/registry.ts`、`gates/completion/mutation.ts`）
 *   都在 gates 层，而 `gates ↛ tools` 是本仓的纪律 —— 记号若定义在本文件，
 *   它们就必须反向 import，把判据框架绑死在工具层的一个实现细节上。
 *   本文件 import 它是**顺向**的（tools → gates 已经成立）。
 */
import { CompletionBudgetExceeded } from "../../gates/budget-stop.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFlywheel, } from "../../confidence.js";
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registry, gateModuleViews } from "../../gates/index.js";
import { resolveMemberLlmSelection, validateMemberLlmSelections } from "../../members.js";
import { resolveTeamProfile } from "../../profiles.js";
import { createTeamDir } from "../../state.js";
import { inScopeOverlap, planQualityFollowUp } from "../../quality-gates.js";
import { auditRequires } from "../../gates/requires.js";
import { TERMINAL_TASK_STATUSES } from "../../types.js";
/**
 * ★ t20：真值从 `types.ts` 取 —— 与 `scheduler.ts` **同一份**。
 *   （`types.ts` 是叶子模块：不 import 任何东西 ⇒ 两边共用不造环。）
 */
import { needsWorktreeFor } from "../../types.js";
/**
 * ── ★★ 为什么这里既有 `import` 又有下面的 `export … from` ────────────────────────
 *
 * 这是**必须**的两句，而不是重复：
 *   · `import { … }`      —— 让这几个名字在**本模块作用域里**可用
 *     （`noteStall` / `rejectOnContractGates` 要用它们）。
 *   · `export { … } from` —— 让**别人**仍然能从本文件拿到它们
 *     （C1 的调用点 import 的是本文件，那条路一个字都不改）。
 *
 * ★ MEASURED（本任务第一版）：只写重导出 ⇒ 本文件内部四处
 *   `Cannot find name 'observeStall' / 'stallRepeatThreshold'` ——
 *   重导出**不建立本地绑定**。这是一个只有编译期看得见的差别，
 *   而它在"搬家"这一步上恰好是最容易漏的一格。
 */
import { observeStall, stallRepeatThreshold } from "../../types.js";
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
            if (error === null || typeof error !== 'object')
                throw error;
            /**
             * ── ★★★ t5：这两份结论**各自独立**地搬，不许共用一句早退 ──────────────────────
             *
             * MEASURED（t5 实测，本函数的结构本身是一个陷阱）：
             *   上面那句原本是 `if (surface === undefined || error === null || …) throw error`
             *   —— 一个把**两件事**合起来的条件：类型守卫（`error` 不是对象 ⇒ 没法挂属性，
             *   这条必须留）与"没有输入面结论"（这条**与下面的搬运无关**）。
             *   ⇒ 若在这里早退，"判据说它测不了"的那份结论会被**静默吞掉** ——
             *     而它跟输入面在不在**没有任何关系**（契约位置的 unmeasured 恰恰
             *     经常与一条齐备的输入面同时出现）。
             *   ★ 这正是本队记账的形态：**一个条件里混了两种判定，于是其中一种的缺席
             *     变成了另一种的静默**。
             *
             * ⇒ 类型守卫留在上面（它是真的前置条件）；两份结论各自判自己的在场。
             *   ★ 顺序与耦合都变了，而**行为一个字没变**：`surface` 不在场时，
             *     `input_surface` 那一支照旧什么都不做。
             */
            const couldNotMeasure = contractUnmeasuredOf(error);
            if (couldNotMeasure !== undefined && !Object.hasOwn(error, 'contract_unmeasured')) {
                ;
                error.contract_unmeasured = couldNotMeasure;
            }
            if (surface === undefined)
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
/**
 * ── ★★★ 杀子进程：要杀【进程组】，不是杀那个 `sh`（2026-10-12）────────────────────
 *
 * MEASURED（本仓 t34 事故的现场取证）：`spawn('/bin/sh', ['-c', cmd])` 之后
 * `child.kill('SIGKILL')` **只杀掉 `sh` 本身** —— `sh` 派出去的那棵树
 * （`node --test`、`pnpm`、`tsc`…）不会被一起杀，于是它们变成 `ppid = 1` 的孤儿。
 *
 * 实测现场：4 个孤儿 node 进程，`cwd` 都是插件仓库、带 `--test-concurrency=0`、
 * **CPU 0%**、存活 5.7–6.5 小时，**跨了两次宿主重启都没被清理**。
 * ★ 它们的形态是最坏的一种：不报错、不占 CPU、只是**一直占着** ——
 *   于是"有过一次超时"与"这台机器上有一批不死的东西"在日志里完全不同形。
 *
 * ── 修法：`detached: true` + 杀 `-pid` ────────────────────────────────────────
 *
 *   `detached: true` 让子进程成为**新进程组的组长**（pgid = 它的 pid），
 *   于是 `process.kill(-pid, 'SIGKILL')` 杀的是**整组**。
 *   ★ `-pid` 里的负号是「进程组」这个语义本身，不是笔误。
 *
 * ★ 四条边界（每条都对着一种会把读数弄坏的写法）：
 *   · `detached` **不**去掉管道（`stdio: 'pipe'` 仍在），也**不** `unref` ——
 *     调用方照样等 `close`，对外行为一字未变；
 *   · 组已经不在了（`ESRCH`）⇒ 退回杀单个 pid；
 *   · 两种都失败 ⇒ **不再纠缠**：在超时路径上抛错会把一次"超时"变成一次
 *     "执行器抛错"，而那是**另一种读数**（判据对两者的措辞完全不同）；
 *   · 只在**超时**路径上调它。正常收尾时组已经空了，多杀一次是无意义的系统调用。
 */
export function killShellTree(child, signal = 'SIGKILL') {
    const pid = child.pid;
    if (typeof pid === 'number' && pid > 0) {
        try {
            /** ★ 负号 = 进程组。这一行才是"整组杀"的落点。 */
            process.kill(-pid, signal);
            return;
        }
        catch {
            // 组不在了（ESRCH），或它压根不是组长 ⇒ 退回单 pid。
        }
    }
    try {
        child.kill(signal);
    }
    catch {
        // 已经死了。这里**不抛** —— 见上面第二、三条边界。
    }
}
function resolveTimeoutMs(options) {
    const given = options?.timeoutMs;
    return typeof given === 'number' && Number.isFinite(given) && given > 0 ? given : VERIFY_COMMAND_TIMEOUT_MS;
}
export async function runVerifyCommand(workspace, command, options = {}) {
    const { spawn } = await import('node:child_process');
    const timeoutMs = resolveTimeoutMs(options);
    return await new Promise((resolve) => {
        const child = spawn('/bin/sh', ['-c', command], {
            cwd: workspace,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            /** ★ 组长身份 ⇒ 超时时可以整组杀。见 {@link killShellTree}。 */
            detached: true,
        });
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            killShellTree(child);
            resolve(125);
        }, timeoutMs);
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
     * ── ★★★ 两种"没有"必须分得开 —— 而**判据是【kind】，不是 `attempt`**（t20 修）────
     *
     * MEASURED（t20）：此前这里写的是
     *
     *     attempt > 0 ? 'not-recorded' : 'no-worktree'
     *
     * ★ 那是一个**按设计成立的恒不可达**（`decompose-author` 找到，captain 逐字复核）：
     *
     *     ① `scheduler.ts` 只给 `KINDS_NEEDING_WORKTREE`（implementation/repair）建树
     *        ⇒ 其余五种 kind（verification/review/integration/work/requirements）
     *        **永远不会**有 worktree ⇒ 基准**从来没有**存在过；
     *     ② 而它们一旦被重派（`attempt > 0`）⇒ 旧写法判 `'not-recorded'`（"本该有却丢了"）
     *        ⇒ `completion.backtest` 判 **blocked** ⇒ `update_task` 恒被拒
     *     ③ ⇒ **任何非 implementation/repair 的任务，只要被重派过一次，
     *        就再也无法提交终态** —— 而它被拒的理由描述的原因**从来没有发生过**。
     *
     * ★ 形态：这是三态纪律的**镜像**。
     *   三态纪律说「**没能测量**不得读成**测得了零**」；
     *   这里曾经是「**按设计不存在**被读成**本该存在却丢了**」——
     *   两个方向的合流同源：**把两种不同的"没有"合成一个 `undefined`**。
     *
     * ⇒ 正确的判据是 kind：**它会不会被派发到隔离 worktree**（那是"该不该有父版本"的
     *   唯一真值）。而它从 `needsWorktreeFor` 取 —— 与调度器**同一份真值**，
     *   不在这里另写一遍 `kind === 'implementation' || kind === 'repair'`
     *   （两份实现会分叉，而分叉之后"判据说它该有、而调度器从没建过"在日志里同形）。
     *
     * ★ `attempt` 在这一版里**不再参与判定**，而那是刻意的：
     *   "这个任务被派发过几次"与"这类任务该不该有父版本"是两件不相干的事。
     *   旧写法把它们绑在一起，于是**重派**（一个与基准无关的动作）会翻转诊断。
     *
     * ★ 而"从未派发过"与"按设计没有"**不再合并**（旧写法合并了）：两者都落
     *   `'no-worktree'`，因为它们对下游是**同一件事** —— 父版本**本就不该有**。
     *   ★ 而判据那边两种成因的措辞已经分得很清（`backtest.ts` 说的是
     *     "this task is not expected to have one"），所以合并的是**诊断**，不是**裁决**。
     */
    const expectWorktree = needsWorktreeFor(task.kind);
    return { kind: 'absent', reason: expectWorktree ? 'not-recorded' : 'no-worktree' };
}
export async function runInDetachedRevision(options) {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const scratch = await mkdtemp(join(tmpdir(), 'agent-teams-rev-'));
    const checkout = join(scratch, 'co');
    /**
     * ★ **清理**这一步（`worktree remove`）刻意**不**受预算约束：预算是"别再干重活"，
     *   而清理是"把已经开出去的临时树收回来"。让一个耗尽的预算把清理也挡掉，
     *   等于用一次超时换一个永久泄漏的 worktree —— 那是本仓 `reclaim` 脚本存在的理由。
     *   ⇒ 它用缺省的 120 s 单命令上限，与预算无关。
     */
    try {
        const added = await runVerifyCommand(options.workspace, `git worktree add --quiet --detach ${JSON.stringify(checkout)} ${options.revision}`, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
        if (added !== 0)
            return undefined;
        try {
            return await runVerifyCommand(checkout, options.command, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
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
export async function runVerifyCommandCaptured(workspace, command, options = {}) {
    const { spawn } = await import('node:child_process');
    const LIMIT = 256 * 1024;
    const timeoutMs = resolveTimeoutMs(options);
    return await new Promise((resolve) => {
        const child = spawn('/bin/sh', ['-c', command], {
            cwd: workspace, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
            /** ★ 与 `runVerifyCommand` 同一条：组长身份 + 超时整组杀。 */
            detached: true,
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
            killShellTree(child);
            resolve({ exitCode: 125, stdout, stderr });
        }, timeoutMs);
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
// ─────────────────────────────────────────────────────────────────────────────
// ★★★ completion 链的 wall-clock 总预算（2026-10-12）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * `VERIFY_COMMAND_TIMEOUT_MS = 120_000` **只是单条命令**的上限。整条 completion 链
 * （`verify-rerun` → `backtest`(full) → `r5` → `mutation`，判据**串行**求值）
 * 此前**没有任何总预算** —— 实测 914 次 `update_task` 的 completed 分支
 * p90 = 127.7 s、**max = 3215.6 s（53 分钟）**，而一次失败还会让 attempt 翻倍、
 * 于是整条链**从头再跑一遍**（t34 已 attempt 5）。
 *
 * ⇒ ★ 单命令超时在读数上会**冒充**总预算：看到代码里有 timeout 的人很容易得出
 *   "不可能挂"的结论，而那个 timeout 覆盖的只是一小段。
 *
 * ── 为什么预算是**调用方**的事实，而不是判据的 ────────────────────────────────
 *
 * 判据是纯数据变换（契约 §2 性质 1）：**它不读时钟**。所以"这一轮还剩多少时间"
 * 只能由调用方持有，并通过**执行器的超时**落到地上 —— 见 {@link runWithinBudget}。
 *
 * ★ 缺省给得宽（20 分钟）：它要挡的是**病态长尾**（53 分钟那一档），而不是正常
 *   路径（p90 才 2 分钟）。把缺省压到分钟级会让这条判据**常态性**报 unmeasured
 *   —— 那是"判据被自己的预算关掉了"，比慢更坏，而且它与"测试不够"在报告里同形。
 */
export const COMPLETION_BUDGET_MS = 20 * 60_000;
/** 用环境变量覆盖总预算。非正数 / 非法值 ⇒ 退回缺省（**没有"无限"这个档位**）。 */
export const COMPLETION_BUDGET_ENV = 'AGENT_TEAMS_COMPLETION_BUDGET_MS';
export function createCompletionBudget(totalMs) {
    const fromEnv = Number(process.env[COMPLETION_BUDGET_ENV]);
    const chosen = typeof totalMs === 'number' && Number.isFinite(totalMs) && totalMs > 0
        ? totalMs
        : (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : COMPLETION_BUDGET_MS);
    const startedAt = Date.now();
    const exhaustedBy = [];
    let calls = 0;
    return {
        totalMs: chosen,
        deadlineMs: startedAt + chosen,
        remainingMs: () => startedAt + chosen - Date.now(),
        elapsedMs: () => Date.now() - startedAt,
        noteExhausted: (label) => { if (!exhaustedBy.includes(label))
            exhaustedBy.push(label); },
        exhaustedBy: () => [...exhaustedBy],
        exhausted: () => Date.now() >= startedAt + chosen,
        calls: () => calls,
        noteCall: () => { calls += 1; },
    };
}
/**
 * ── ★ 把一次执行器调用包进预算 ────────────────────────────────────────────────
 *
 * 两条纪律：
 *
 * ① **超预算 ⇒ 抛一条自述的错误**，不返回一个"看起来像命令失败"的退出码。
 *    理由：判据对"执行器抛错"与"命令失败"的措辞**完全不同** —— 前者说
 *    "我没能跑它"，后者说"它跑了并且失败"。返回 125 会让一次**预算停止**
 *    被读成"这些命令都超时了"，也就是把基础设施的读数伪装成关于代码的读数。
 *
 * ② 传下去的超时是 `min(单命令上限, 剩余)` ⇒ **只收窄、不放宽**：单条命令最多
 *    120 s 这条既有纪律一个字没动，而累加起来整条链有界。
 */
export async function runWithinBudget(budget, label, run) {
    const remaining = budget.remainingMs();
    if (remaining <= 0) {
        budget.noteExhausted(label);
        /**
         * ★ 抛的是 {@link CompletionBudgetExceeded}，不是裸 `Error` —— 见 `gates/budget-stop.ts`。
         *   裸 `Error` 会让两个下游各自把它读成**自己的**东西：mutation 的逐条 catch 读成
         *   `outcome: 'error'`（不进分母 ⇒ 可能假通过），`registry.evaluate` 直接穿出去
         *   （绕过三态裁决）。两者都不是"这条链没能测量"。
         */
        throw new CompletionBudgetExceeded(`the completion chain exhausted its ${Math.round(budget.totalMs / 1000)}s wall-clock budget before "${label}" could run`
            + ` — this is a BUDGET stop, NOT a failing test; stopped call(s): ${budget.exhaustedBy().join(', ')}`);
    }
    budget.noteCall();
    return await run(Math.min(VERIFY_COMMAND_TIMEOUT_MS, remaining));
}
// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 变异日志：就地变异是【可恢复】的（2026-10-12）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * mutation 会【就地】改生产文件、跑测试、再改回来：
 *
 *     writeFile(target, mutated)
 *     try { runTests() } finally { writeFile(target, original) }
 *
 * `finally` 只覆盖**正常退出**。它不覆盖 SIGKILL / 宿主崩溃 / 关掉 App。
 *
 * MEASURED（本仓 2026-10-12，t34 事故**已兑现**的后果）：
 *   主仓库 `src/worktree.ts:366` 被留在变异态 —— `failed: Array<{…}>` 后面多了
 *   一个 `=`。它**不是手误**：没有任何人会自然写出 `}> =`，而 `gt-to-ge` 算子
 *   （`find:'>'` → `replace:'>='`）在改动行范围内唯一命中的位置正是那里。
 *   后果是 `pnpm build` **从此必失败**（2 s，exit 2），而 378 那行报错是**级联**。
 *
 * ★ 而 `src/mutation-guard.ts` 早就写好了"事后发现残留"的守卫
 *   （`checkMutationGuard`，三态 + git 证据）—— 但**全仓没有一个调用方**。
 *   于是"发现了"这件事本身也不存在。
 *
 * ── 本机制提供的是【恢复】，而不只是【发现】───────────────────────────────────
 *
 * 一个只报告残留的守卫能让人**知道**插件坏了；它不能让人**不必**手动修。而
 * "插件自己的 `pnpm build` 挂了"这条症状，与"某处代码写错了"在日志里同形。
 *
 * ── 机制：写之前先记日志；恢复时按【内容】判定，冲突就不动 ─────────────────────
 *
 *   条目（每个文件一条，落在 `<workspace>/.agent-teams/mutation-journal/`）：
 *
 *       { file, original, mutated, at }
 *         original —— 这一轮**第一次**写它之前的内容（`null` = 当时不存在）
 *         mutated  —— **最后一次**被写进去的、与 original 不同的内容
 *
 *   恢复逐条判定（四态，互不同形）：
 *
 *     ① current === original            ⇒ 干净（正常收尾过）        ⇒ 删条目
 *     ② current === mutated             ⇒ 残留确实是变异体写的      ⇒ **写回 original**
 *     ③ 两者都不是                       ⇒ **冲突**：崩溃之后有人
 *                                           动过这个文件 ⇒ **不动**，留条目报出来
 *     ④ 读不到 / 条目坏                  ⇒ 未测量 ⇒ **不动**，报出来
 *
 * ★ ③ 是这套机制里最要紧的一态，也是它**不做**自动覆盖的理由：崩溃之后成员完全
 *   可能合法地编辑过那个文件。把它写回"变异前的样子"会**丢掉一次真实的工作**，
 *   而那种损失在日志里与"恢复成功"同形。⇒ 只在内容**逐字等于**我们写进去的
 *   那一份时才回滚。
 *
 * ★ 顺序是【先记日志、再写文件】：于是"记完日志就崩"落在情形 ①（干净），
 *   而不是留下一个半截的条目。
 */
export const MUTATION_JOURNAL_STATE_DIR = '.agent-teams';
const MUTATION_JOURNAL_DIRNAME = 'mutation-journal';
export function mutationJournalDir(workspace, stateDir = MUTATION_JOURNAL_STATE_DIR) {
    return join(workspace, stateDir, MUTATION_JOURNAL_DIRNAME);
}
function journalEntryPath(workspace, relativePath, stateDir) {
    /** ★ 用 `encodeURIComponent` 而不是把 `/` 换掉：它是**单射**的，不会把两个不同路径映射成同名。 */
    return join(mutationJournalDir(workspace, stateDir), `${encodeURIComponent(relativePath)}.json`);
}
function readJournalEntryAt(path) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return undefined;
    }
    if (parsed === null || typeof parsed !== 'object')
        return undefined;
    const entry = parsed;
    if (typeof entry['file'] !== 'string' || entry['file'] === '')
        return undefined;
    const original = entry['original'];
    if (original !== null && typeof original !== 'string')
        return undefined;
    return {
        file: entry['file'],
        original,
        ...typeof entry['mutated'] === 'string' ? { mutated: entry['mutated'] } : {},
        at: typeof entry['at'] === 'string' ? entry['at'] : '',
    };
}
/**
 * 在一次【就地写】之前记账。
 *
 * ★ 由调用方在注入给判据的 `writeFile` 里调 —— 判据自己做不了这件事（它是纯的）。
 * ★ 幂等：同一个文件重复写只更新 `mutated`，`original` **永远是第一次那一份**
 *   （后面读到的都已经被污染了）。
 */
export function recordMutationWrite(workspace, relativePath, contents, stateDir = MUTATION_JOURNAL_STATE_DIR) {
    const path = journalEntryPath(workspace, relativePath, stateDir);
    const existing = readJournalEntryAt(path);
    if (existing === undefined) {
        mkdirSync(mutationJournalDir(workspace, stateDir), { recursive: true });
        let original = null;
        try {
            original = readFileSync(join(workspace, relativePath), 'utf8');
        }
        catch {
            /** 文件不存在 ⇒ `null`（恢复时"写回"等于删掉它）。**不是空串**：两者不同形。 */
            original = null;
        }
        const entry = {
            file: relativePath,
            original,
            ...contents === original ? {} : { mutated: contents },
            at: new Date().toISOString(),
        };
        /**
         * ★ 先记日志、**再**让调用方写文件（本函数只记账，不写目标）。
         *   顺序反了的话，"记完就崩"会留下一个 mutated 已更新而文件还没变的条目
         *   —— 那落在情形 ①（干净）里，仍然正确。所以两条路都安全，但这一条更直白。
         */
        writeFileSync(path, JSON.stringify(entry));
        return;
    }
    /** 还原写入（把 `original` 写回去）**不**更新 `mutated` —— 它正是"没有残留"的证据。 */
    if (contents === existing.original)
        return;
    if (existing.mutated === contents)
        return;
    writeFileSync(path, JSON.stringify({ ...existing, mutated: contents, at: new Date().toISOString() }));
}
/**
 * 扫一遍某个 workspace 的变异日志并恢复。
 *
 * ★ 两种调用时机，各有各的必要：
 *   · **插件启动时** —— 上一次崩溃留下的残留在这一步被修掉，而不是等下一次
 *     `update_task` 顺手修（那可能永远不来）；
 *   · **每条 completion 链的入口** —— 兜住"上一次没走完"的那一类。
 * ★ 正常收尾也走它：那时每个条目的 `current === original` ⇒ 只删条目、不动文件。
 *   所以它同时是"清理"，不需要另设一个 clear 函数（两个入口会分叉）。
 */
export function recoverMutationJournal(workspace, stateDir = MUTATION_JOURNAL_STATE_DIR) {
    const report = { restored: [], clean: [], conflicts: [], failed: [], touched: false };
    const dir = mutationJournalDir(workspace, stateDir);
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        /** ★ 目录不存在 = 从没跑过变异，或已经清干净。这是**正常**，不是"未测量"。 */
        return report;
    }
    for (const name of names) {
        if (!name.endsWith('.json'))
            continue;
        const entryPath = join(dir, name);
        const entry = readJournalEntryAt(entryPath);
        if (entry === undefined) {
            report.failed.push({ file: name, reason: 'the journal entry is not readable as {file, original, …}' });
            continue;
        }
        const target = join(workspace, entry.file);
        let current = null;
        try {
            current = readFileSync(target, 'utf8');
        }
        catch {
            current = null;
        }
        if (current === entry.original) {
            try {
                unlinkSync(entryPath);
                report.clean.push(entry.file);
            }
            catch (error) {
                report.failed.push({ file: entry.file, reason: `the entry could not be cleared: ${String(error)}` });
            }
            continue;
        }
        if (entry.mutated !== undefined && current === entry.mutated) {
            try {
                if (entry.original === null)
                    unlinkSync(target);
                else
                    writeFileSync(target, entry.original);
                const readBack = entry.original === null ? (existsSync(target) ? 'exists' : 'absent') : readFileSync(target, 'utf8');
                const identical = entry.original === null ? readBack === 'absent' : readBack === entry.original;
                if (!identical) {
                    report.failed.push({ file: entry.file, reason: 'the original was written back but did not read back identical' });
                    continue;
                }
                unlinkSync(entryPath);
                report.restored.push(entry.file);
                report.touched = true;
            }
            catch (error) {
                report.failed.push({ file: entry.file, reason: `restoring raised: ${String(error)}` });
            }
            continue;
        }
        report.conflicts.push({
            file: entry.file,
            reason: 'the file matches neither the pre-mutation original nor the last mutant written by mutation testing,'
                + ' so something edited it after the crash — it is left untouched, because rolling it back would discard that work',
        });
    }
    return report;
}
/**
 * ── ★★★ 启动时的收残留：扫【插件自己的树】以及它派出去的每一棵树 ─────────────────
 *
 * ★ 为什么"启动时"这一步不可省：`wireCompletion` 里那两次调用只在**下一次有人
 *   报完成**时才会发生。而本条机制要修的那个事故恰恰是 ——
 *   **插件自己的 `pnpm build` 从此必失败**（`src/worktree.ts:366` 的 `=`）。
 *   从崩溃到"下一个人报完成"之间，插件的构建一直是坏的，而那条症状
 *   （"某处代码写错了"）与真实的代码错误完全同形。
 *   ⇒ 必须有一个**与成员行为无关**的时点去修它，那就是挂载。
 *
 * ★ 扫两处、不只扫根：
 *   · `root` —— 队长的工作区**就是插件仓库**（实测：t34 的 `assignee` 是 captain，
 *     而 `workspaceOf(caller)` 给出的是 `session.header.cwd`，即插件根）
 *     ⇒ 事故就落在这里；
 *   · `root/.agent-teams/worktrees/*` —— 成员被派到隔离树里干活，那里同样会跑
 *     mutation（workspace = 那棵树）⇒ 同一类残留，只是位置不同。
 *
 * ★ 返回**逐棵树的读数**（而不是一个合并后的数组）："哪一棵树被修了"是这条读数
 *   的全部价值 —— 合并之后，一棵树的冲突会淹没在另一棵树的干净里。
 */
export function recoverMutationJournalsUnder(root, stateDir = MUTATION_JOURNAL_STATE_DIR) {
    const workspaces = [root];
    try {
        const worktreesDir = join(root, stateDir, 'worktrees');
        for (const name of readdirSync(worktreesDir)) {
            if (name.startsWith('.'))
                continue;
            const candidate = join(worktreesDir, name);
            try {
                if (existsSync(join(candidate, 'src')))
                    workspaces.push(candidate);
            }
            catch {
                // 读不到就跳过这一棵 —— 它是"没扫到"，不是"它干净"。
            }
        }
    }
    catch {
        /** 没有 worktrees 目录 ⇒ 只有根这一棵。这是正常情形。 */
    }
    return workspaces.map((workspace) => ({ workspace, report: recoverMutationJournal(workspace, stateDir) }));
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
        /**
         * ★★ 重跑条目【不带 `failures`】（`verify-rerun.ts` 的 reruns.push 只填
         *    command/status/exitCode/evidence），而本函数此前用 `return rerun`
         *    整条替换成员如实报的那条 ⇒ **失败明细在到达判据之前丢失**。
         *
         * MEASURED（2026-10-11，t3 实测钉死的链）：
         *   成员报了逐字的失败名 ⇒ verify-rerun 重跑同一条命令 ⇒ 本函数整条覆盖 ⇒
         *   `quality-gates.ts` 的 classifyVerifyFailures 看到 `failures` 缺席
         *   ⇒ 恒 undecidable（"reported no per-test failures"）
         *   ⇒ ★ 任何含已知红的任务都无法到达 completed —— 而 pin 清单扣减那条路
         *     需要 failures 才能走。
         *
         * ⇒ 修法（口径定在【这一处】——"这条红算不算新增"只能有一个答案）：
         *   重跑只更新 status/exitCode/evidence；成员报的 `failures` 若在，
         *   而 rerun 没带 ⇒ **保留 claimed 的**。
         */
        if (rerun.failures === undefined && item.failures !== undefined) {
            return { ...rerun, failures: item.failures };
        }
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
/**
 * ① 同一个路径同时在 inScope 与 outOfScope 里。
 * ★ 复用 `quality-gates.ts` 的 `inScopeOverlap`（**同一份**判据，不重写一份 —— 两份会漂移）。
 */
export function scopeContradictions(inScope, outOfScope) {
    const overlapping = inScopeOverlap(inScope, outOfScope);
    return overlapping.map((path) => ({
        check: 'contradiction',
        detail: `\`${path}\` appears in BOTH inScope and outOfScope — this task is unsatisfiable: `
            + 'the validator honours the out-of-scope side, so the file you must change is the file you are forbidden to change',
    }));
}
/**
 * ── ③（TOUCH）move 类任务：**源**必须也在 inScope 里 ──────────────────────────────
 *
 * ★ 机械判据（保守）：验收标准里出现下面这些动词之一 **且** 提到一个存在于
 *   `outOfScope` 的路径 ⇒ 那个路径是**源**，而它必须可改（否则搬不走）。
 */
const MOVE_VERBS = /\b(move|relocate|extract|extract(?:ing)?\s+out|migrate|搬迁|搬走|抽取|提取|移出|迁移)\b/iu;
export function scopeTouchGaps(acceptance, inScope, outOfScope) {
    const text = (acceptance ?? []).join('\n');
    if (!MOVE_VERBS.test(text))
        return [];
    const gaps = [];
    /**
     * ★ 只看**明确列在 outOfScope 里**的那些路径：它们是"必须搬走、而被禁止碰"的源。
     *   ★ 不做"从散文里猜路径"——那会在任何提到文件名的验收标准上误报。
     */
    for (const path of outOfScope ?? []) {
        if (!text.includes(path))
            continue;
        gaps.push({
            check: 'touch',
            detail: `the acceptance criteria describe MOVING \`${path}\`, so that file must be edited (at minimum an import and a re-export relay), `
                + 'but it is listed in outOfScope — a move always has a source and a destination, and only the destination can be changed here',
        });
    }
    return gaps;
}
/**
 * ── ★★★ ④（EMIT）构建产物的声明 —— 队长证据包里**最便宜、最可机械计算**的一条 ──────────
 *
 * 契约原话把它称为 *"the build-products rule, now proved twice and in both directions"*。
 * 两次实测：
 *
 *   · t24 写了 `lib/types.d.ts` —— 而本仓 `declarationDir` 是 `lib/types`
 *     ⇒ 那一路径**永远产不出来**（`lib/types/types.d.ts` 在，`lib/types.d.ts` 不在）。
 *   · t19 写了 `lib/types/types.d.ts` 而**漏了 `lib/types.js`** ——
 *     而后者才是**真正跑起来的那一个**（+61 行，夹具 import 的就是它）。
 *
 * ★★★ 而 t19 那一次的决定性证据是：**每一个别的列了 `src/types.ts` 的任务
 *   （t3 / t14 / t24）都已经声明了 `lib/types.js`**。
 *   ⇒ 所以那从来不是一次判断，**只是一次分叉** —— 而这正是本判据要消灭的东西。
 *
 * ── 规则（纯计算，不读盘、不猜）─────────────────────────────────────────────────
 *
 *     每一个 `src/X.ts` 在 inScope 里 ⇒ 产出集必须声明：
 *        `lib/X.js`              （tsc 的 outDir 产物 —— 真正被 import 的那一个）
 *        `lib/types/X.d.ts`      （declarationDir 产物 —— 类型面）
 *     ★ 见 `tsconfig.json`：`outDir: lib`、`declarationDir: lib/types`、`rootDir: src`。
 *     ⇒ 所以 `<root>/<rel>` 那张映射是**编译配置的直接后果**，不是约定。
 *
 * ★ 而 `lib/types.d.ts` 那种"把目录名当成文件名"的形状由 t23 的
 *   `structurallyImpossiblePath` 负责（它在 `quality-gates.ts`，不在这里）——
 *   本函数**只**管"漏了产出"，两条各司其职、不重叠。
 */
export function emittedProductGaps(inScope, 
/**
 * ── ★★★ 根目录**可注入**，而判据是"**这个文件真的在盘上吗**"（t26 实测的修正）──────
 *
 * MEASURED（t26）：第一版对**每一个** `src/*.ts` 都要求声明产物 ——
 * 而那当场打红了**九条既有的臂**，因为它们的夹具用的是**象征性路径**
 * （`src/a.ts` / `lib/a.js`，那些文件**根本不存在**，永远不会被 build 产出）。
 *
 * ★★ 而真正的缺陷（t19 漏 `lib/types.js`、t24 写 `lib/types.d.ts`）都发生在
 *   **真实存在的、被 git 跟踪的**源文件上。⇒ 判据是：
 *
 *     这个 `src/X.ts` **真的在盘上**（⇒ build 真的会为它产出东西）⇒ 要求声明产物
 *     它不在盘上（⇒ 这是一个**还没被创建**的文件，或一个**象征性**的夹具路径）
 *       ⇒ ★ 不报：产物**还不存在**是正常的，那不是"漏声明"
 *
 * ★ 这与 t23 的 (ii) 是**同一条纪律的两面**：
 *   那边管"inScope 里的路径**结构上不可能**产出来"，
 *   这边管"**真的会**产出来的那些，产物有没有被声明"。
 *   而两者都只对**能机械核对**的事实说话 —— 不猜。
 */
root = pluginRoot()) {
    const scope = new Set((inScope ?? []).map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '')));
    const gaps = [];
    for (const entry of scope) {
        /** ★ 只对 src 下的 TypeScript 文件说话：其余目录（docs · scripts · package.json…）没有这条强制同步关系。 */
        if (!entry.startsWith('src/') || !entry.endsWith('.ts'))
            continue;
        /** ★★ 只在**真的在盘上**时要求产物（见上面那段）—— 象征性路径与"还没建的文件"都不报。 */
        try {
            if (!existsSync(join(root, entry)))
                continue;
        }
        catch {
            continue;
        }
        const rel = entry.slice('src/'.length).replace(/\.ts$/, '');
        for (const product of [`lib/${rel}.js`, `lib/types/${rel}.d.ts`]) {
            if (scope.has(product))
                continue;
            gaps.push({
                check: 'emit',
                detail: `\`${entry}\` is in scope, so the build emits \`${product}\` from it, but that product is NOT declared — `
                    + 'this repository keeps lib/ in lockstep with src/ (tsconfig outDir=lib, declarationDir=lib/types), '
                    + 'so an undeclared product makes the task impossible to complete honestly',
            });
        }
    }
    return gaps;
}
/** 跑上面两条并合集 —— 建任务时调用一次，**逐条指名**。 */
export function scopeViolations(input) {
    return [
        ...scopeContradictions(input.inScope, input.outOfScope),
        ...emittedProductGaps(input.inScope),
        ...scopeTouchGaps(input.acceptance, input.inScope, input.outOfScope),
    ];
}
/**
 * ── ★★★ t26：成员收到的**任务说明**是从**被强制执行的那份记录**投影出来的 ─────────────
 *
 * 契约原话：*"the ASSIGNMENT TEXT handed to members has now diverged from the enforced
 * team.json list FIVE times"*（t22 / t13 / t16 / t24 / t19）—— 而 t13 那次
 * **差一点发出去一个 inert 的 UI**：真正喂面板的那个文件在**被强制**的清单里、
 * 却在**说明文字**里缺席。
 *
 * ── 本函数**就是**那句"assignment text" ─────────────────────────────────────────
 *
 * MEASURED（t26）：成员拿到的那段说明是 `taskDetails(...)` 的返回值，
 * 由 `src/tools/claim.ts` 在两处（首领 / 幂等重领）交给 `task_details`。
 * ⇒ 所以"说明文字"**不是一个单独维护的副本** —— 它就是这里的投影。
 *
 * ── ★★ 而"投影"必须**被核对过**，否则它只是"把存着的原样印出来" ────────────────────
 *
 * 此前它把两个列表原样拼成一行：
 *
 *     `In scope: …; Out of scope: …`
 *
 * ★ 于是**交集没人算**：一条 `src/types.ts` 同时在两边、从而**无解**的任务，
 *   在说明里读起来**完全正常**（t19 的实测形状）。
 * ⇒ 现在投影**先跑一遍那两条检查**，并把结果**写进那段说明本身**：
 *   一条有矛盾的任务**不许**以"看起来没问题"的样子交到成员手上。
 *
 * ★★★ 而它**不**在这里抛错：`taskDetails` 是一条**只读**的投影（成员在 claim 时拿到它），
 *   在那个时刻拒绝会**卡住一个已经在跑的任务** —— 而"已经在跑"与"该不该建"是两件事。
 *   ⇒ **拒绝**发生在**建任务时**（`create-task.ts` 调 `scopeViolations`）；
 *     投影这一侧的职责是**如实标出来**，而不是替它做那个决定。
 *   ★ 两者是同一个判据的两个出口：一个拦在门口，一个让已在里面的人看得见。
 */
export function taskDetails(team, task) {
    const violations = scopeViolations(task);
    return [task.subject, task.description ?? '',
        `Kind: ${task.kind ?? 'work'}`,
        `Objective: ${task.objective ?? ''}`,
        `In scope: ${(task.inScope ?? []).join(', ')}; Out of scope: ${(task.outOfScope ?? []).join(', ')}`,
        /**
         * ★★ 只在**真的有问题**时出现 —— 一个恒在场的告警栏会让它自己变成噪音，
         *   而噪音会教人忽略门禁（本队那条）。
         */
        ...violations.length === 0 ? [] : [
            `⚠ SCOPE PROBLEM (${violations.length}) — this task's scope may be unsatisfiable:`,
            ...violations.map((violation) => `  · [${violation.check}] ${violation.detail}`),
            '  ⇒ Do NOT guess a file set. Report this and ask the captain to amend the scope.',
        ],
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
     *
     * ★★★ 而 commit 维【不能】用 `!==` 判 —— 那会把"构建时的提交是 HEAD 的祖先"
     *   也读成落后（实测 2026-10-09：stamp=49894d0、HEAD=d457d9c，
     *   `git merge-base --is-ancestor` 为真，而那条门报了 stale）。
     *   ⇒ ★ 那构成一个循环：build 之后 commit 必然让 stamp 落后一格。
     *
     *   ★ 判据改成祖先关系；而 `undefined`（跑不了 git）时【保守】维持落后 ——
     *     因为"说不清"不得读成"没事"。
     */
    const contentChanged = loadedOutput !== onDiskOutput;
    /**
     * ★★★ 而这一格【我试过改成祖先关系，又改回来了】（2026-10-09）——
     *   而理由是：臂 9（f-0026 核心）有一条**有据的**要求，逐字是：
     *     「stamp 没变、而 HEAD 前进了一个提交 ⇒ 必须报 stale」
     *     而它的现实依据是"有人改了 src 又改回来 / amend / 只因别的原因动了历史"。
     *
     *   ★ 而我今晚踩到的情形（`build` 之后 `commit` ⇒ stamp 落后一格）与它**同形**：
     *     两者都是"构建于 A，而 A 是 HEAD 的祖先"。⇒ ★ 所以那不是两个需求，
     *     是【同一个判据的两种希望】—— 而它需要一个【第三维】才能分开
     *     （"那两个提交之间，有没有改动到构建的输入"）。
     *
     *   ⇒ ★ 所以本次【不改判据】，而是把那条区分立成一条任务。
     *     `builtCommitIsAncestorOfHead` 这个输入保留（它已可注入、有 5 条臂），
     *     但**暂不参与** `commitBehind` —— 等那条第三维的判据落地再接。
     *
     * ── ★★★ 2026-10-12：第三维落地了，而它比预想的窄 ─────────────────────────────
     *
     * MEASURED：臂 9 的构造里 `moduleFreshnessFrom` **只传 `loaded`/`onDisk`/`head`** ——
     * **没有**传 `builtCommitIsAncestorOfHead`。⇒ 那一格在臂 9 里是 `undefined`，
     * 而下面的保守规则把它当"落后"。
     *
     * ⇒ ★ 所以臂 9 钉住的其实是：
     *     「output 没变 + HEAD 前进 ⇒ stale，**且祖先关系未知**」
     *   而它**从未**钉住「祖先关系为真时也必须报 stale」——
     *   那一格是这条注释的前一版（和我）**读宽了**。
     *
     * ★ 而"祖先为真"在现实中是两种情形，臂 9 的构造只覆盖了第一种：
     *   · **有人动了历史**（改了又改回来 / amend / rebase）⇒ 该报 stale；
     *   · **build 之后 commit**（产物无法描述包含它自己的那个提交）⇒ **每轮都会发生**，
     *     而它**不是**"你手上的代码旧了" ⇒ 报 stale 就是一条**先于使用者存在的假红**。
     *
     * ★ 第三维因此是：**"这两个提交之间，构建的输入真的变了吗？"** —— 问 git
     *   `builtCommit..HEAD` 上的 `src/` 与构建配置。而这一问**只在确知是祖先时**才做：
     *   非祖先时 HEAD 已经移开，那一格本来就该报 stale，不必再问。
     *   ★ `undefined`（跑不了 git / 问不出来）⇒ **维持保守**：说不清不得读成"没事"。
     */
    const builtIsAncestor = input.builtCommitIsAncestorOfHead === true;
    /**
     * ★★ 只有**确知是祖先**且 git **明确回答"输入没变"**时才压掉 commit 这一维。
     *   `undefined` ⇒ **不压** —— 那正是臂 9 的构造（它不传这一格），它必须继续报 stale。
     */
    const commitBehind = builtCommit !== head
        && !(builtIsAncestor
            && builtCommit !== undefined && head !== undefined
            && buildInputsChangedBetween(builtCommit, head) === false);
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
    const head = currentHead();
    const rawCommit = readStamp(pluginRoot())?.commit;
    const builtCommit = typeof rawCommit === 'string' && rawCommit.trim() !== '' ? rawCommit : undefined;
    return moduleFreshnessFrom({
        loaded: loadedStamp(),
        onDisk: readStamp(pluginRoot()),
        head,
        /**
         * ★ 这里把"构建时的提交是不是 HEAD 的祖先"取出来 —— 而那正是
         *   `commitBehind` 该用的判据（见 `FreshnessInput` 的注释）。
         *   ★ 取不到（不是仓库 / 那条提交不在库里）⇒ `undefined` ⇒ 保守维持"落后"。
         */
        ...builtCommit !== undefined && head !== undefined && builtCommit !== head
            ? { builtCommitIsAncestorOfHead: isAncestorOf(builtCommit, head) }
            : {},
    });
}
/**
 * ── ★★★ 第三维：`from..to` 之间，**构建的输入**有没有真的变？─────────────────────
 *
 * MEASURED 的由来：`stamp.commit` 与 HEAD **必然**不同，而这是构造性的 ——
 * 产物无法描述包含它自己的那个提交（commit N 写 stamp{commit: N}，而包含它的提交是 N+1）。
 * ⇒ 若把"不相等"直接读成"落后"，那么**每提交一次**就产生一条
 *   **先于使用者存在的假红**。实测代价：`gate-stale-module` 的臂 1/4/6 同时变红，
 *   而三条标题里**都没有 "stamp" 这个词** ⇒ 读起来像"谁弄坏了三条不相干的臂"。
 *
 * ★ 而"祖先为真"其实有两种情形，补救动作相反：
 *   · **有人动了历史**（改了又改回来 / amend）⇒ 该报 stale；
 *   · **build 之后 commit** ⇒ 不该报。
 * 分开它们要问的正是这一格：**那两个提交之间，构建的输入变了吗？**
 *
 * ★ 三态，与全仓纪律同源：
 *   `true`      —— 输入变了（真的落后）
 *   `false`     —— **输入一个字没变** ⇒ 旧构建描述的就是当前代码 ⇒ 不算落后
 *   `undefined` —— 问不出来（跑不了 git / 那条提交不在库里）⇒ 调用方**保守处理**
 *
 * ★★ 为什么看的是**路径清单**而不是"摘要相等"：摘要需要重新计算整棵 `src/`，
 *   而这一问发生在**每一次状态读取**上（`moduleFreshness()` 是被高频调用的）。
 *   `git diff --name-only` 是 git 自己算的、与工作树无关，代价可忽略；而
 *   "清单为空"与"摘要相等"在这个问题上**等价**（输入一个字没变 ⇒ 摘要必然相同）。
 */
export function buildInputsChangedBetween(from, to, root = pluginRoot()) {
    try {
        /**
         * ★ 只问**构建输入**：`src/` 加构建配置。`docs/`、`scripts/`（除构建链）与
         *   `.agent-teams/` 变了**不影响产物**，把它们算进来会重新造出假红。
         */
        const changed = execFileSync('git', [
            'diff', '--name-only', from, to, '--',
            'src', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'tsdown.client.ts', 'package.json',
        ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        return changed !== '';
    }
    catch {
        /** ★ 问不出来 ⇒ `undefined`（**不是** `false`）—— 那会把"没能核对"说成"没变"。 */
        return undefined;
    }
}
/**
 * `ancestor` 是不是 `descendant` 的祖先（用 git 判，而不是用字符串比）。
 *
 * ★ 三态：`true` / `false` / `undefined`（**跑不了 git ⇒ 判不了**）。
 *   ★ 而"判不了"与"不是祖先"必须不同形 —— 前者的处置是"保守地当作落后"，
 *     后者是"真的换了线"。而调用方拿 `undefined` 时按保守处理。
 */
export function isAncestorOf(ancestor, descendant, root = pluginRoot()) {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
            cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return true;
    }
    catch (error) {
        /**
         * `git merge-base --is-ancestor` 用退出码表达答案：0 = 是，1 = 不是。
         * ⇒ ★ 所以 `1` 是【一个答案】，不是【一次失败】—— 而把它并进 `undefined`
         *   会让"不是祖先"与"判不了"同形（本队那条最贵的合流）。
         */
        const status = error?.status;
        if (status === 1)
            return false;
        return undefined;
    }
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
/**
 * 走一遍「卡点/判决 ⇒ 任务」：调 `friction-triage` 的 `triage` + `dispatchable`。
 *
 * @param options.frictionsDir 卡点目录（**由调用方注入** —— 判据层不猜路径）
 * @param options.judgementsDir 判决目录
 * @param options.occupied 已被占用的写域（避免派到别人的文件上）
 * @param options.loadModule ★ 注入点：默认走 `pluginRoot()` 动态 import；
 *   夹具可以换掉它（**而它只换装载，不换判据**）。
 */
export async function readExperienceDispatch(options = {}) {
    const load = options.loadModule ?? loadFrictionTriageModule;
    let module;
    try {
        module = await load();
    }
    catch (error) {
        /**
         * ★★ 模块引不进来 ⇒ `unmeasured`（**不是**"没有待派的"）。
         *   ★ 而它必须说清是**哪一步**不行：模块不在盘上 / 导出对不上，两者的补救不同。
         */
        return {
            state: 'unmeasured',
            unreadable: [],
            why: `the friction triage module could not be loaded: ${String(error?.message)}`,
        };
    }
    if (typeof module.triage !== 'function' || typeof module.dispatchable !== 'function') {
        return {
            state: 'unmeasured',
            unreadable: [],
            why: 'the friction triage module loaded but no longer exports `triage`/`dispatchable` '
                + `(saw: ${typeof module.triage}/${typeof module.dispatchable}) — the shape moved, so this reading means nothing`,
        };
    }
    const report = module.triage({
        ...options.frictionsDir === undefined ? {} : { frictionsDir: options.frictionsDir },
        ...options.judgementsDir === undefined ? {} : { judgementsDir: options.judgementsDir },
        ...options.occupied === undefined ? {} : { occupied: options.occupied },
    });
    const unreadable = [...(report.unreadable ?? [])];
    const dispatchable = module.dispatchable(report);
    const contracts = [];
    for (const entry of dispatchable.ready) {
        const contract = entry.contract;
        /**
         * ★ 没有契约的 `ready` 条目不进 `contracts` —— 而它**仍计入 `ready` 的条数**（如实）。
         *   ★ 两者不同形：`ready` 说"判据说它可以派"，`contracts` 说"我拿到了要建的那份契约"。
         *     一个 `ready` 而拿不到契约 ⇒ 那是**上游的一处缺口**，而它必须在读数里可见
         *     （把两者合成一个数字会让那种情况彻底消失）。
         */
        if (contract !== undefined && typeof contract === 'object') {
            contracts.push({
                ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
                ...(entry.tier?.tier === undefined ? {} : { tier: entry.tier.tier }),
                contract,
            });
        }
    }
    return {
        /** ★ 有一侧读不到 ⇒ `partial`（**不是** `ok`）—— 那正是"没能读"与"确实没有"分界的地方。 */
        state: unreadable.length === 0 ? 'ok' : 'partial',
        unreadable,
        readout: {
            ready: dispatchable.ready.length,
            awaitingRuling: dispatchable.awaitingRuling.length,
            rejected: dispatchable.rejected.length,
            cannotEmit: dispatchable.cannotEmit.length,
            decomposed: dispatchable.decomposed.length,
            notReadyBecause: dispatchable.notReadyBecause ?? {},
            contracts,
        },
    };
}
/**
 * ★ 默认装载：**动态 import + `pluginRoot()` 的运行时路径**（与 `quality-gates.ts` 读
 *   基线清单同一种做法）。静态 `import '../../scripts/…'` 会破 `tsc` 的 `rootDir`。
 */
async function loadFrictionTriageModule() {
    const target = pathToFileURL(join(pluginRoot(), 'scripts', 'friction-triage.mjs')).href;
    return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ target));
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
        /**
         * ★★★ 措辞的落点（t5 实测后 captain 采纳 `verifier` 的建议）：
         *
         *   此前这句是「…reload the plugin before trusting any judgement it makes」——
         *   **读起来像一条提醒**（"你手上的东西旧了"），而它没说出【要紧在哪】。
         *
         *   ★ 而 t5 实测出的形态是：陈旧构建会把【一条已经关掉的缺陷重新打开】——
         *     进程持有的 `ba32130` 仍在按 `attempt` 判别，而 HEAD 已改成按 `kind`（t20 修的）
         *     ⇒ 那条任务**两个终态都被拒**（completed 与 failed 走同一条判据）
         *     ⇒ ★ 而成员【连如实交失败都做不到】。
         *
         *   ⇒ 所以这句必须说出三件事：① 它旧掉的是哪一版 ② 它能让【两个方向】都被拒
         *     ③ 而正确的动作是【停下并报】，不是重试、不是改交付物、不是伪造一格。
         */
        /**
         * ★★ 而措辞里有两处【早先的臂就要求过的】字样，不能丢（实测 2026-10-09）：
         *   · `OLDER than the one on disk` —— 臂 10 钉它（那一态必须【明说自己旧】）
         *   · `reload the plugin`         —— 同上（必须【指向动作】）
         *   ⇒ ★ 我第一版改写把后者去掉了（换成了 "restart the host"），于是臂 10 红。
         *     而那正是"改一条消息时，要核【谁在读它】"的那一格。
         */
        return `this process is running an OLDER build than the one on disk (${detail}) `
            + '— a stale build does not merely warn: it can re-open a defect that is already fixed, '
            + 'and it blocks BOTH terminal states (a refusal here may be that old defect, not your work). '
            + 'Do not retry, do not alter the deliverable, and do not fabricate a field: stop and report. '
            + 'The fix is to reload the plugin (build, then restart the host).';
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
/**
 * 三态的**完整名单**（供"读不出来 ⇒ 不猜"的读取端复用）。
 *
 * ★ 明写成一列，而不是散在各处的 `=== 'solved' || === 'trying'` ——
 *   两处各写一遍，就会在加第四态时于其中一处漏掉（本仓反复记账的形态）。
 */
export const RESCUE_STATES = ['solved', 'cannot-solve', 'trying'];
/**
 * 从一条台账记录里读出救解三态 —— ★ **读不出来 ⇒ `undefined`，不猜**。
 *
 * ★★ 为什么**不**把缺席当 `trying`：缺席是"这条记录没有 rescue 读数"，
 *   而 `trying` 是"有人看过、判定还在自己解"。把前者读成后者会让
 *   **"没人标注过"伪装成"有人管着"** —— 本仓记账的正是这一形态
 *   （`frictions-html.mjs` 的 `statusOf` 对 `state` 做的正是同一件事）。
 *
 * ★ 而它**只认** {@link RESCUE_STATES} 里的取值：一个不认识的字符串
 *   （比如有人写了 `'fixed'`）⇒ `undefined`，与缺席同形 —— 而不是被猜成
 *   最接近的那一态（猜错的方向必然是"把要人管的读成不用管"）。
 */
export function rescueStateOf(record) {
    const state = record?.rescue?.state;
    return RESCUE_STATES.find((known) => known === state);
}
/**
 * ── ★★★ C2：从 C1 的 `stall` 读数给出**缺省救援读数** ────────────────────────────
 *
 * ★ 这里**不新建**一条生命周期：它把 C1 已经算出来的 `stall` 当作**唯一输入**，
 *   产出一条 `trying` 的缺省 rescue —— 也就是"**还没有人去救过它**"。
 *
 * ── ★★ 为什么缺省是 `trying`，而不是从 `stalled` 推出 `cannot-solve` ─────────────
 *
 * 契约逐字：「`stalled` 是**什么可能变成** `solved` 或 `cannot-solve`；
 *   **不要**发明一条并行的生命周期」。
 *
 * ⇒ 救援三态回答的是「**有人去救了吗、救成了吗**」，而"任务停没停"是**另一个问题**：
 *   一个任务可以停住而**还没有任何人**去救它。那正是 `trying`。
 *   ★ 若把 `stalled` 直接落成 `cannot-solve`，那 214 条会立刻回到上报池 ——
 *     本任务要消掉的缺陷换个入口就回来了。
 *   ★ 而若把 `stalled` 落成 `solved`，那是**谎报**（没人解过，而它读起来像解了）。
 *
 * ★★ 所以本函数**故意不读 `stall.state` 去分派** —— 因为 C1 的两态在这里
 *   **都不足以**推出 `solved` 或 `cannot-solve`（那两态要一次**真实的救援**才写得出来）。
 *   它唯一的用途是：给"被判据拒过、或从未被拒"的任务一个**显式的、可断言的**
 *   缺省读数，好让读取端不必各自 `?? 'trying'`（四处各写一遍就是四处会分叉）。
 *
 * ★ 而 `stall` **在场/缺席**这个差别**不**在这里丢掉：它由 `noteStall` / `clearStall`
 *   管着（C1 已钉），而 `class` / `resolution.blocking` 已经把它落进记录。
 *   ⇒ 本函数不重复编码那件事，也不假装它读了。
 */
export function defaultRescueForStall(stall) {
    /**
     * ★ `stall` 是入参而**不是**被忽略的：一条**从未被拒**的记录与一条
     *   **被拒过**的记录，缺省 rescue 都是 `trying`（都还没人救过），
     *   而调用方从 `stall` 拿到的正是"有没有被拒过"这件事 —— 它写进 C1 的
     *   `class` 那一格，而不是在这里被重新编码一遍。
     */
    void stall;
    return { state: 'trying' };
}
/**
 * ── ★★★ C2：**只有** `cannot-solve` 进"上报给人"的池子 ──────────────────────────
 *
 * 用户的原话：卡点的默认归宿是**自己解掉**；上报是例外。
 * 而实测的现状是反过来的 —— 214 条被默认推进了 `escalate`。
 *
 * ★ 判据是**机械的**（不是措辞判断）：池子由**救援三态**决定，一个函数，一处：
 *
 *     `solved`       ⇒ `self` —— 已经解掉了。★ 它**不进上报池**，而且它
 *                      **也不再是待办**（见 `actionForFriction` 的 no-action 分支）。
 *     `trying`       ⇒ `self` —— 还在自己解。★ 这是**默认**，也是绝大多数。
 *     `cannot-solve` ⇒ `escalate` —— **只有它**。
 *     `undefined`（没有 rescue 读数）⇒ ★ 这里**不猜**
 *
 * ── ★★ 为什么"没有 rescue 读数"**不**落 `escalate` ────────────────────────────────
 *
 * 那正是 214 条的成因：**缺省值**把"还没人标注过"读成了"要上报给人"。
 * ★ 而反过来落 `self` 也不是猜 —— 它**就是**用户裁定的默认（"默认目标是自己解"）。
 *   ⇒ 缺省落 `self` 是**按裁定取默认值**，而不是从缺数据里推断事实。
 *   ★ 而"这条有没有 rescue 读数"这件事**另外可见**（`rescueStateOf` 返回
 *     `undefined`，HTML 与分诊器都把它单独报出来）—— 于是"没人标注过"不会
 *     被藏起来，只是它不再自动等于"要人去管"。
 */
export function poolForRescue(state) {
    return state === 'cannot-solve' ? 'escalate' : 'self';
}
/**
 * ── ★★★ C2：三态**必须不同形** —— 这是"缺一即红"的那条判据 ──────────────────────
 *
 * 契约逐字：「The three rescue states are distinct in **shape**」。
 *
 * ★ 而"形状"不是措辞：一个把三态都写成 `{ state }` 的实现里，
 *   `solved` 与 `cannot-solve` 只有**一个字符串**不同 —— 于是读取端要判断
 *   "这条到底解没解掉"就**只能靠比那个字符串**，而那是代理读数。
 *
 * ⇒ 形状判据（可机械核，且**定向突变**打得红）：
 *
 *   `solved`       ⇒ 必须带 `solvedBy` **且** `howSolved`（谁解的 + 怎么解的）
 *   `cannot-solve` ⇒ 必须带 `whyCannotSolve`，且**不许**带 `solvedBy` / `howSolved`
 *   `trying`       ⇒ ★ 两者**都缺席**（没有人解过、也还没放弃）
 *
 * ★ 于是"它解掉了"这句话**在形状上**就与"它解不掉"不同：
 *   前者有"solved"那两格，后者有"为什么解不掉"那一格。这也是"缺一即红"的落点 ——
 *   一个写了 `state: 'solved'` 而没说**谁**解、**怎么**解的记录，
 *   与"有人声称它解了"同形（README：未检验的声称与猜测同形）。
 */
export function missingRescueEvidence(rescue) {
    const state = rescue?.state;
    if (state === 'solved') {
        const missing = [];
        if (typeof rescue?.solvedBy !== 'string' || rescue.solvedBy === '')
            missing.push('solvedBy');
        if (typeof rescue?.howSolved !== 'string' || rescue.howSolved === '')
            missing.push('howSolved');
        return missing;
    }
    if (state === 'cannot-solve') {
        return typeof rescue?.whyCannotSolve === 'string' && rescue.whyCannotSolve !== ''
            ? []
            : ['whyCannotSolve'];
    }
    /** ★ `trying` 与"没有 rescue 读数"都**不需要**证据 —— 它们没声称任何事。 */
    return [];
}
export function actionForFriction(rescue) {
    const state = rescue?.state;
    /**
     * ★ 先查"证据齐不齐" —— 这是 R1 与既有 `missingRescueEvidence` 的接缝。
     *   `solved` 缺 `solvedBy`/`howSolved`、`cannot-solve` 缺 `whyCannotSolve`
     *   ⇒ 都**降级为 `unknown`**（不是照它声称的那一态动作）。
     *   ★ 理由：一声称就照做，等于把"未检验的声称"当作事实 —— 而本仓对这条的立场是
     *     「未检验的声称与猜测同形」。
     */
    const gaps = missingRescueEvidence(rescue);
    if (gaps.length > 0) {
        return {
            kind: 'unknown',
            pool: 'self',
            because: `这条记录声称 rescue.state=${JSON.stringify(state)}，却缺 ${gaps.join(' / ')} —— `
                + '一声称就照做等于把未检验的声称当事实，所以降级为 unknown（不惊动人，但留痕）',
        };
    }
    if (state === 'solved') {
        return {
            kind: 'none',
            pool: 'self',
            because: `已由 ${String(rescue?.solvedBy)} 解掉（${String(rescue?.howSolved)}）⇒ 不再是待办`,
        };
    }
    if (state === 'cannot-solve') {
        return {
            kind: 'escalate',
            pool: 'escalate',
            because: '我们自己解不掉 ⇒ 请人进来（C2：只有这一态进上报池）',
            why: String(rescue?.whyCannotSolve),
        };
    }
    if (state === 'trying') {
        return {
            kind: 'self-resolve',
            pool: 'self',
            because: '有人看过、判定还在自己解 ⇒ 默认归宿是自己解（上报是例外）',
        };
    }
    return {
        kind: 'unknown',
        pool: 'self',
        because: '★ 这条记录**没有 rescue 读数** —— 没人标注过。'
            + '归宿按裁定取默认（自己解、不惊动人），但它**不是** trying：'
            + '"没人看过"与"有人管着"必须不同形，否则积压读不出来',
    };
}
/**
 * ★ 把两种入参形状**归一**成 `FrictionRescue | undefined`。
 *
 * 调用方有两种写法（都在本文件里出现过）：
 *   · {@link rescueStateOf} 那一路 —— 交**整条台账记录**（`{ rescue: { state } }`）；
 *   · {@link poolForRescue} 那一路 —— 交**已经拆出来的** `FrictionRescue`。
 * ⇒ 不归一的话，两条路各自要写一遍解包，而**写漏一格**（例如只取 `state`
 *   而丢掉 `whyCannotSolve`）会让"带证据的 cannot-solve"被读成"没标注过" ——
 *   t63 自测**实测踩到过这个错**（见 `rescueRatio` 里那段 MEASURED）。
 * ★ 归一只写一处 ⇒ 不存在"某一路忘了带证据"的第二种写法。
 */
function normalizeRescueInput(input) {
    if (input === undefined || input === null)
        return undefined;
    /** 已经是 `FrictionRescue`（平铺的 `state`）⇒ 原样交。 */
    if (typeof input.state === 'string') {
        const flat = input;
        return RESCUE_STATES.includes(flat.state) ? flat : undefined;
    }
    /** 台账记录形状 ⇒ 解包 `record.rescue`，且**保留它的全部字段**。 */
    const nested = input.rescue;
    if (nested === undefined || typeof nested.state !== 'string')
        return undefined;
    return RESCUE_STATES.includes(nested.state) ? nested : undefined;
}
export function classifyRescue(record) {
    const action = actionForFriction(normalizeRescueInput(record));
    if (action.kind === 'escalate')
        return 'escalate';
    /**
     * ★ 注意这里**不是** `rescue?.state === 'trying'` —— 一个证据不齐的 `solved`
     *   会被 `actionForFriction` 降级成 `unknown`，于是它落 `unnoticed`
     *   （"声称解了却说不出谁解的" = 还没被**核实**看过）⇒ 与 `self` 不同形。
     */
    if (action.kind === 'unknown')
        return 'unnoticed';
    return 'self';
}
export function rescueRatio(records) {
    let self = 0;
    let escalate = 0;
    let unnoticed = 0;
    let total = 0;
    let poolSelf = 0;
    let poolEscalate = 0;
    for (const record of records) {
        total += 1;
        /**
         * ★★ 必须把**整份 rescue** 交下去，不能只交 `{ state }`。
         *
         * MEASURED（t63 自测抓到的）：第一版写成 `classifyRescue({ state })` ——
         *   那**丢掉了** `solvedBy` / `howSolved` / `whyCannotSolve`，
         *   于是 `missingRescueEvidence` 如实报"证据缺口" ⇒ `solved` 与 `cannot-solve`
         *   **双双降级成 `unknown`**，被算进 `unnoticed`。
         *   ⇒ 读数会变成 "self 2 / escalate 0 / unnoticed 3"（真值 3/1/1）。
         *   ★ 这正是本仓记账的形态：一个**形状正确而语义丢了**的中间层，
         *     把"有证据的事实"读成"没标注过"。⇒ 交整份对象。
         */
        const cls = classifyRescue(record);
        if (cls === 'escalate')
            escalate += 1;
        else if (cls === 'self')
            self += 1;
        else
            unnoticed += 1;
        /**
         * ★ 第二个口径：**已归档的池子**。它是 376 条历史记录的唯一来源，
         *   所以"旧读数能不能复算出来"这条验收只能从这里回答。
         *   ★ 只认两个已知取值 —— 别的（含缺席）**不计入任何一边**，
         *     否则"没归档"会被算成 self，把自消化率抬高。
         */
        const pool = record.resolution?.pool;
        if (pool === 'escalate')
            poolEscalate += 1;
        else if (pool === 'self')
            poolSelf += 1;
    }
    const denom = self + escalate;
    return {
        byPool: { self: poolSelf, escalate: poolEscalate },
        byRescue: { self, escalate, unnoticed },
        self,
        escalate,
        unnoticed,
        total,
        /**
         * ★ 分母为 0 ⇒ `undefined`。**不许**返回 0 或 1：
         *   一条记录都没有时，"自消化 100%" 与 "没有任何可判的读数" 是两件事，
         *   而它们在同形之下会读成同一件（本仓的三态纪律）。
         */
        selfRatio: denom === 0 ? undefined : self / denom,
        summary: `台账 ${total} 条。`
            + `★ 旧口径（resolution.pool）self ${poolSelf} / escalate ${poolEscalate}`
            + `（自消化 ${poolSelf + poolEscalate === 0 ? '判不了' : `${((poolSelf / (poolSelf + poolEscalate)) * 100).toFixed(2)}%`}）；`
            + `★ 新口径（rescue 三态）self ${self} / escalate ${escalate}`
            + `（${denom === 0 ? '判不了 —— 没有一条带 rescue 读数（不是 0%，也不是 100%）' : `${((self / denom) * 100).toFixed(2)}%`}）；`
            + `★ 另 ${unnoticed} 条**没有 rescue 读数**（单列，不进分母）`,
    };
}
/**
 * 校验一批沉淀 —— ★ **每一条都能指出它变成了哪条机械判据，否则不算**。
 *
 * ★ 三态纪律的落点：返回的是**逐条结论**，不是一个布尔 ——
 *   一个整体布尔会让"20 条里 18 条是真判据"与"一条都不是"在读数上同形。
 */
export function auditSediment(entries) {
    const results = [];
    let settled = 0;
    let unsettled = 0;
    for (const entry of entries) {
        const problems = [];
        if (entry.kind !== 'gate') {
            problems.push(`kind=${entry.kind} —— ★ 用户原话「prompt 是软手段」；`
                + `只有 kind='gate'（一条会红、会拒的机械判据）才算沉淀`);
        }
        if (entry.kind === 'gate') {
            if (typeof entry.gate !== 'string' || entry.gate === '')
                problems.push('缺 gate（它变成了哪条判据）');
            if (typeof entry.at !== 'string' || !/^src\/.+:\d+$/.test(entry.at)) {
                problems.push(`at=${JSON.stringify(entry.at)} 不是 \`src/…:行号\` 的形状 —— 指不出行号的不算`);
            }
            if (typeof entry.because !== 'string' || entry.because === '') {
                problems.push('缺 because（为什么它是机械判据而不是劝告）');
            }
            /**
             * ★ ③ `gate` 与 `at` 必须指向**同一处** —— 否则"它变成了判据 X"与
             *   "行号在 Y"是两条互不相干的事实，而它们的合流正是"指错门"的形态。
             */
            if (typeof entry.at === 'string' && typeof entry.gate === 'string'
                && entry.gate !== '' && !entry.at.startsWith('src/')) {
                problems.push('at 必须以 src/ 开头');
            }
        }
        const ok = problems.length === 0;
        if (ok)
            settled += 1;
        else
            unsettled += 1;
        results.push({ from: entry.from, settled: ok, why: ok ? '真沉淀（机械判据）' : problems.join('；') });
    }
    return {
        results,
        settled,
        unsettled,
        summary: `沉淀 ${settled} 条 / 未沉淀 ${unsettled} 条`
            + (unsettled > 0 ? ' —— ★ 未沉淀的那些是 prompt/doc/convention，它们**不算**已解决' : ''),
    };
}
/**
 * 读一批沉淀条目的飞轮状态。
 *
 * @param entries 沉淀清单（t63 的形状）
 * @param tallies 每个 `from` 对应的使用读数 —— ★ **缺席 ⇒ 没有读数**（不是全 0）
 * @param now 当前时间（epoch ms），由调用方注入以便复现
 */
export function readSedimentFlywheel(entries, tallies, now) {
    const audit = auditSediment(entries);
    const settledByFrom = new Map(audit.results.map((r) => [r.from, r.settled]));
    const rows = [];
    for (const [from, settled] of settledByFrom) {
        /**
         * ★★ `tallies.get(from)` **可能返回 `undefined`** —— 那就是"没有使用读数"。
         *   ★ 这里**绝不**写成 `tallies.get(from) ?? { recalled: 0, upvoted: 0 }`：
         *     那个 `?? {0,0}` 正是腾讯点名要防的
         *     「**No missing metric is converted into a fabricated zero**」——
         *     补了零之后 `confidenceOf` 会算出 `0.5`（而非 `undefined`），
         *     于是"没人记过"这条**会伪装成一个中立的读数**，再往下就是"观察区"而不是"判不了"。
         */
        const tally = tallies.get(from);
        const reading = readFlywheel(tally ?? {}, now);
        rows.push({
            from,
            settled,
            verdict: reading.verdict,
            confidence: reading.confidence,
            reasons: reading.reasons,
        });
    }
    const counts = {
        promote: rows.filter((r) => r.verdict === 'promote').length,
        observe: rows.filter((r) => r.verdict === 'observe').length,
        archive: rows.filter((r) => r.verdict === 'archive').length,
        unmeasured: rows.filter((r) => r.verdict === 'unmeasured').length,
    };
    const unmeasured = counts.unmeasured;
    return {
        rows,
        counts,
        unmeasured,
        summary: `沉淀条目 ${rows.length} 条：可晋升 ${counts.promote} · 观察区 ${counts.observe} · `
            + `归档 ${counts.archive} · ★ **判不了** ${unmeasured}`
            + (unmeasured === rows.length && rows.length > 0
                ? '（全部 —— 即"热在数量、冷在质量信号"：飞轮还没转起来，此时做 reflect 是在没读数的库上反思）'
                : ''),
    };
}
/**
 * ── ★ 从拒绝原文里读出【是哪条判据】拒的（**单值，第一个**）──────────────────────
 *
 * 拒绝原文里判据 id 的形态是 `[… ]`（实测：`update_task rejected: [dispatch.changed-paths] "…"`）。
 * ★ 读不出来 ⇒ `undefined`（**不猜**）—— 编一个 id 会让"这条是谁拒的"变成一条**假事实**，
 *   而假的归因比没有归因坏：读的人会照着它去查那条判据。
 *
 * ── ★★★ t30：这个函数**只回答"第一个是谁"** —— 而那是**有意保留**的语义 ────────────
 *
 * MEASURED（t30 查明）：`.exec()` 只匹配第一个 ⇒ 一条含多个判据 id 的消息，
 *   第二个起**全部丢弃**。而这个函数的调用点里，**至少有一个在语义上就只要一个**：
 *
 *     `noteStall(task, point, gateIdFromMessage(msg), now)`   （update-task.ts:1494）
 *       ⇒ `noteStall` 把 `gate` 存成**标量**（`task.stall.gate`），
 *         而 `observeStall` 靠 `previous.gate === gate`（**标量相等**）判"同一个判据又拒了一次"。
 *       ⇒ ★ 若这里改成一个数组，那个相等判断**静默失效**（数组 !== 数组）
 *         ⇒ 跨调用计数恒为 1 ⇒ **没有任何拒绝会被判成卡点**（C1 的判据整个失效）。
 *
 * ⇒ 所以**不偷偷改这个函数的语义**。要全量的调用点走 `gateIdsFromMessage`。
 * ★ 一般形式：**同一个量有两类读者时，扩语义与保语义应当分成两个名字**，而不是让一个名字
 *   在无人察觉的情况下换形状（本仓反复记账的形态）。
 */
export function gateIdFromMessage(message) {
    const match = /\[([\w][\w.-]*)\]/u.exec(message);
    return match?.[1];
}
/**
 * ── ★★★ t30：从拒绝原文里读出【全部】判据 id（去重，保持出现次序）─────────────────
 *
 * 与 {@link gateIdFromMessage} 是**同一个正则**、同一份形态判据 —— 区别只有 `g` 旗标与去重。
 * ★ 而**去重是刻意的**：实测标题里同一个 id 会重复出现很多次
 *   （`f-0051` 的 `[dispatch.changed-paths]` 出现 **30 次** —— 那是判据逐条列举它拒绝了哪些路径）。
 *   ⇒ 去重之后"这条记录被哪些判据拒过"才是一个**集合**，而不是一份抱怨的重复计数。
 *
 * ★ 读不出来 ⇒ `[]`（**不是** `undefined`）—— 与单值版的 `undefined` 分工不同：
 *   单值版的 `undefined` 表示"**第一个读不出来**"（`observeStall` 拿它当第三态用）；
 *   而这一版要回答的是"**一共有哪些**"，"一个都没有"的天然形状就是空集。
 *   ★ 两个不同的问题各自有各自的"没有"，**不许合流**。
 */
export function gateIdsFromMessage(message) {
    const found = [];
    for (const match of message.matchAll(/\[([\w][\w.-]*)\]/gu)) {
        const id = match[1];
        if (id !== undefined && !found.includes(id))
            found.push(id);
    }
    return found;
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
/**
 * ── ★★★ 重放：把记录里的 ctx 还原成【能真的跑】的那一份（t79）────────────────────
 *
 * ── 它修的是什么失效（MEASURED，t69 报、t79 定位）──────────────────────────────
 *
 * `gate-friction-capture` 臂 4 自称「记录 vs 日志的分水岭」，而它红着：
 *
 *     · 记录里写的是 `[completion.mutation]`
 *     · 而重放得到的是 `[completion.verify-rerun]`
 *
 * ★ 根因（本任务实测，比"缺一格"更精确）：
 *
 *   `toReplayableSnapshot` 把**每一个函数**序列化成 `{ __absent: 'function' }`
 *   —— 而那是**忠实**的：函数确实进不了 JSON。实测记录里 8 个注入点是：
 *
 *       loadKindRequirements · loadRules · execVerifyCommand · runTestOnRevision
 *       readFile · runTest · scanDirs · （killerSuites 是数组，留下来了）
 *
 *   ⇒ 于是重放时的 ctx 里，那些位置上是**对象**而不是函数。
 *   ⇒ 而 `loadKindRequirementsOfHost` 判的是 `typeof ctx.loadKindRequirements === 'function'`
 *     ⇒ 它读到 `absent` ⇒ **kind 表不可用** ⇒ `mutation.appliesTo` 返回 `false`
 *       ⇒ ★ **门不说话（silently skipped）** ⇒ 裁决落到另一条分支上。
 *
 * ── ★★ 为什么"把缺什么记进记录"（②）不够 ──────────────────────────────────────
 *
 *   ★ 它**已经**记了：`{ __absent: 'function' }` 就是"这一格是个函数，而它没被带来"。
 *   ⇒ 而它没用：记录是诚实的，**撒谎的是重放** —— 重放拿着一个它兑现不了的
 *     ctx 照常跑，然后交出一个**属于另一条分支**的结论，而那个结论看起来完全正常。
 *
 * ⇒ 所以修法必须是 ①：**重放时把那些函数重新注入**（从宿主拿，而不是从 JSON 拿）。
 *   ★ 而这正是本函数做的事。
 *
 * ── 它怎么工作 ────────────────────────────────────────────────────────────────
 *
 * 把记录里的快照与一份**注入表**合并：
 *   · 注入表里有那一格的函数 ⇒ 用**宿主的**实现（与生产同形）
 *   · 注入表里没有         ⇒ ★ **如实标成不可兑现**，而不是留一个 `{__absent}` 让它
 *     在判据里被误读成"一个对象"（那正是"缺 loader 时四条门一起沉默"的成因）
 *
 * ★ 而"注入表里没有"这一态**必须与"注入成功"不同形**：
 *   前者的补救动作是"去把那一格接上"，后者是"无"（见 `replayCtx().unreplayable`）。
 */
export function rehydrateReplayCtx(snapshot, injections) {
    const ctx = {};
    const injected = [];
    const unreplayable = [];
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return { ctx, injected, unreplayable: ['the snapshot is not an object, so nothing could be replayed'] };
    }
    for (const [key, value] of Object.entries(snapshot)) {
        /**
         * ★ 只有【被序列化掉的那些格】需要重新注入 —— 而判法是看那个标记本身，
         *   而不是猜哪些键"像函数"。⇒ 于是本函数对快照的形状**不敏感**：
         *   记录里多一个函数注入点，它会自动要求重新注入那个名字。
         */
        const wasFunction = value !== null && typeof value === 'object'
            && value.__absent === 'function';
        if (!wasFunction) {
            ctx[key] = value;
            continue;
        }
        const supplied = injections[key];
        if (typeof supplied === 'function') {
            ctx[key] = supplied;
            injected.push(key);
            continue;
        }
        /**
         * ★★ 拿不到 ⇒ 把那一格**整个去掉**，并如实记下来。
         *
         * ★ 为什么去掉而不是留一个占位对象：判据们判的是 `typeof x === 'function'`
         *   ⇒ 留一个对象会让它们读成"有这一格、只是类型不对"，而那与"没有这一格"
         *     **在后果上相同、在读数上不同** —— 后者是可解释的（缺输入），
         *     前者会让人去查"为什么它不是函数"。
         *   ⇒ 去掉 = "这一格不在" = 判据自己那条"没能测量"的分支会如实说出它。
         */
        unreplayable.push(key);
    }
    return { ctx, injected, unreplayable };
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
/**
 * ── ★★★ C1：这一次拒绝之后，任务**有没有继续往下走** ───────────────────────────
 *
 * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
 *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
 * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被拒 ≥2 次 = 停住了**。
 *
 * ── ★★ 为什么"同一个判据"必须是键的一部分 ────────────────────────────────────
 *
 * 五个**不同**的判据各拒一次是**五件不同的事**（成员每次都在改，只是每次
 * 撞上另一条门）。把它们数成一个数字会让"每次都被不同的门拦"读成"卡在同一处"
 * —— 而那正好是本任务要消灭的那个合流（换成计数版本）。
 *
 * ── ★★ 为什么 N 是【可注入】的（本仓教训，逐字）───────────────────────────────
 *
 * `docs/PENDING-FRICTION-REFORM.md` §2：「`with-timeout` 那族缺陷连躲三次，
 * 根因都是『上限是硬编码常量，短测试复现不了』」⇒ N 必须能注入。
 * ★ 而注入的是**上限**，不是判据本身 —— 判据仍然只有一处实现。
 * ★ 注入口是环境变量（与 `restartEscapeHatchFromEnv` 同一形态：**明写的、可核的**），
 *   缺省 2（用户已确认）。★ 读不出数就**回落缺省**，而不是当成 0：
 *   一个坏值会让每一片拒绝都变成卡点（或一条都不变）。
 */
/**
 * ── ★★★ C1 的判据【搬了家】（t24）—— 而这里**只转交**，不留第二份实现 ────────────
 *
 * 本文件此前**自己实现**了 `observeStall` / `stallRepeatThreshold` /
 * `STALL_REPEAT_THRESHOLD` / `StallObservation`。它们搬去了 `src/types.ts` ——
 * 理由在那份长注释里（**判据层要用它，而本文件 import 了 `gates/index.ts`**，
 * ⇒ 判据要用它就只能复制或成环，两条都不可接受）。
 *
 * ── ★★ 为什么这里是 `export … from` 而不是 `import` + `export` ────────────────
 *
 * 两者在本文件里**读起来几乎一样**，而它们不是一回事：
 *   · `export { x } from './y'`  —— **纯转交**，本模块作用域里**没有** `x` 的绑定；
 *   · `import { x } …; export { x }` —— 多了一个**本地绑定**。
 *
 * ★ 而第一条路径还有一个更要紧的性质：它是**重导出**，读的人一眼看得出
 *   "这东西的真身在别处"。第二条长得像"它住在这里、只是从别处拿的"。
 *   ⇒ 本队反复记账的那条（**"声明的家"与"真身"必须同形**）在这里的落点是：
 *     谁将来在本文件里加第二个 `observeStall`，`export … from` 这种写法会当场
 *     报重复导出，而 `import` + `export` 不会那么明显地挡住他。
 *
 * ★★★ 而"**不许有第二份实现**"是一条**可断言**的性质，不是一句忠告：
 *   `scripts/gate-stall-leaf-home.test.mjs` 臂 3 扫全仓，断言
 *   "计数判据"这个词只在 `src/types.ts` 里被**实现**过一次。
 *
 * ── ★ 而 C1 的调用点**一个字都不用改** ─────────────────────────────────────────
 *
 * `src/tools/update-task.ts` import 的是 `'./shared/entities.ts'` 的那几个名字。
 * 重导出之后它们仍然从这里拿得到，且**类型与运行期绑定都不变**。
 * ⇒ 见 `scripts/gate-stall-leaf-home.test.mjs` 臂 1（搬家前后逐字同判）。
 */
export { STALL_REPEAT_THRESHOLD, stallRepeatThreshold, observeStall, } from "../../types.js";
/**
 * `rejection` 记录的标题前缀。
 *
 * ★ 它是**人**读那一份台账时唯一的判别面（`frictions-html`）——
 *   而机读那一份用 `class` 字段，不靠这个前缀（代理读数会随措辞漂）。
 */
export const REJECTION_TITLE_PREFIX = '[rejection — not a blocker] ';
/**
 * ── ★★★ C1：把这一次拒绝的读数【落进任务】，好让下一次拒绝能跟它比 ────────────────
 *
 * ★ 这是判据成立的全部理由：「这次拒绝之后，任务有没有继续往下走」这句话
 *   在**一次**拒绝的那一下无从判断 —— 唯一能回答它的是**下一次拒绝**
 *   （成员改字段再报 ⇒ 下一次不拒了 ⇒ 任务走了；同样的拒绝又来一次 ⇒ 停了）。
 *   ⇒ 所以判据必须是**跨调用**的，而跨调用就必须落盘。
 *
 * ── ★ 为什么改的是【同一格】而不是追加一条历史 ────────────────────────────────
 *
 * `stall` 回答的是"**现在**它停没停"，而不是"它历史上被拒过几次"。
 * 一个持续增长的数组会让读取端必须自己算"最近连续了几次" ——
 * 而那段算逻辑一旦在读取端出现第二份，两处就会分叉（本仓反复记账的形态）。
 *
 * ── ★★ 而【放行】必须清掉它 ────────────────────────────────────────────────────
 *
 * 这是本函数最容易写错的一格：若一条记录**已经**是 `stalled` 而任务随后被放行了，
 * 却**不**清掉它，那么下一次拒绝会读到 `count = 3 ≥ 2` ⇒ **第一次**拒绝就被
 * 判成卡点。⇒ 于是"每个任务最终都会变成卡点"，而那正是本任务要消灭的那个
 * 「把 82% 的事件算成卡点」的**计数版本**。
 * ⇒ 所以 {@link clearStall} 与 {@link noteStall} 是**成对的**，各自有调用点。
 */
export function noteStall(task, point, gate, now) {
    const stall = observeStall(task.stall, gate, point);
    task.stall = {
        ...gate === undefined ? {} : { gate },
        point,
        state: stall.stalled ? 'stalled' : 'trying',
        count: stall.count,
        at: now,
    };
    task.updatedAt = now;
    return stall;
}
/**
 * 放行 ⇒ 忘掉那条 stall。
 *
 * ★ 与 {@link noteStall} 成对：见那里的长注释（不清会让下一次的**第一次**拒绝
 *   就被判成卡点）。
 * ★ 只在**真的有一条**时才动 `updatedAt` —— 否则每一次放行都会让任务"看起来
 *   刚被改过"，而那会让"它什么时候真的动过"这条读数失去分辨力。
 */
export function clearStall(task) {
    if (task.stall === undefined)
        return;
    delete task.stall;
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
        /**
         * ── ★★★ C1：这条记录是【拒绝事件】还是【真卡点】───────────────────────────────
         *
         * 判据是机械的：这次的 `stall` 观察说任务停没停（见 {@link observeStall}）。
         *
         * ★ 缺席 ⇒ 按 `trying`（**不假设它停了**）：错的那一侧选"还没停" ——
         *   多记一条 rejection 不会误导人，少记一条真卡点才会。
         * ★★ 而 `class` 这一格本身是**可机读的判别面**：读取端不该靠标题措辞
         *   去猜这条记录是哪一类（那是代理读数，它会在有人改措辞时漂）。
         */
        const stall = capture.stall ?? { stalled: false, count: 1, basis: 'first' };
        const recordClass = stall.stalled ? 'blocker' : 'rejection';
        /**
         * ── ★★★ C2：拒下这一条时，**救援进行到哪一步** ─────────────────────────────
         *
         * ★ 它在这里就被算出来（**一处**），因为下面 `resolution.pool` 与顶层 `rescue`
         *   必须是**同一个读数**的两面 —— 两处各算一遍就会分叉，而分叉后
         *   "为什么这条进了上报池"要读两处才能回答。
         *
         * ★★ 拒绝路径上**还没有人**去救过 ⇒ 缺省 `trying`（默认目标是自己解）。
         *   见 {@link defaultRescueForStall} 的长注释：这不是"缺省 = 上报"。
         */
        const rescue = defaultRescueForStall(undefined);
        const record = {
            id,
            at: new Date().toISOString(),
            project: 'agent-teams-dev',
            /**
             * ── ★★★ 两类记录的**标题形态不同**（C1）──────────────────────────────────
             *
             * `rejection` —— ★ **加前缀**，因为它的正文是一句"某某被拒了"，而那**不是**
             *   卡点。前缀让它在整份台账里**一眼可辨**（人读那一份也吃这个前缀）。
             * `blocker`   —— 保持拒绝原文（它就是那次让任务停住的拒绝）。
             *
             * ★ 前缀里的判据 id 与正文里的**同一份**（`gateIdFromMessage` 只算一次）——
             *   两处各拼一遍就会分叉，而分叉后"这两个数字是不是一回事"要读两处才能回答。
             */
            title: recordClass === 'rejection'
                ? `${REJECTION_TITLE_PREFIX}${capture.message}`
                : capture.message,
            /** ★ 可机读的判别面（见上）。 */
            class: recordClass,
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
                ...stall.basis === 'unknown'
                    ? ['the gate id could not be read out of the rejection, so whether this task kept moving was not judged'
                            + ' — recorded as a rejection, not as a blocker']
                    : [],
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
            /**
             * ── ★★★ C1：两类记录的 `resolution` **不同形** —— 而这不是措辞上的不同 ────────
             *
             * ★ 用户的原话里，两类东西的补救动作**不同**：
             *
             *     `rejection` —— 判据拒了一下，而**任务继续走了** ⇒ **不需要任何人做任何事**。
             *                    它是**证据**（"这条门在拦这个"），不是待办。
             *                    ⇒ `blocking: false` + `pool: 'self'`（还在自己解）
             *     `blocker`   —— 任务**真的停住了** ⇒ **有人必须动**（主会话救援 / 上报）。
             *                    ⇒ `blocking: true` + `pool: 'escalate'`
             *
             * ★★ 而这一格正是"合并回一条 ⇒ 臂红"瞄准的那一格：把两类都写成
             *   `blocking: false` 会让**真卡点**读成"不需要动"（那是本轮要修的原始缺陷，
             *   21 条真卡点被淹在 253 条里的那一半）；反过来写 true 会让 207 条判据拒绝
             *   全部变成"要人来管"（用户抱怨的那一半）。
             *
             * ★ `whyPool` 只在 `escalate` 时在场：一条没有进上报池的记录**没有**"为什么
             *   进这个池子"要交代 —— 缺席与"写了一句空的"必须不同形（本仓记账的形态）。
             *
             * ── ★★★ C2：`pool` 现在由**救援三态**决定，而不再由 `class` 直接决定 ──────────
             *
             * ★ 这是 C2 与 C1 的接缝：C1 说"**停没停**"（`class` / `blocking`），
             *   C2 说"**解没解掉**"（`rescue` / `pool`）。
             *   ★ 两条轴**不同** —— 一个停住的任务在"有没有人救过"这件事上的答案是
             *     **`trying`（还没有人去试）**，而不是"要上报给人"。
             *     实测 214 条正是死在这个跳步上：**停住** ⇒ 直接 ⇒ **上报**，
             *     而中间那一步"我们先自己解解看"从来没有对应的字段。
             *
             * ★★ 所以 `pool` 走 {@link poolForRescue} 这一条路（**唯一**的判据点），
             *   而**只有** `cannot-solve` 会进 `escalate`。
             *   ★ 而 `whyPool` 那时**必须**说得出"为什么解不掉"（`whyCannotSolve`）——
             *     一个进上报池而没有理由的记录，正是 214 条的复现形态。
             */
            resolution: recordClass === 'blocker'
                ? rescue.state === 'cannot-solve'
                    ? {
                        blocking: true,
                        fix: 'unfixed: the task stopped here — the same gate rejected it again, per C1',
                        pool: poolForRescue(rescue.state),
                        whyPool: `★ 同一个判据（${stall.basis === 'repeated' ? String(capture.auto?.gate ?? capture.point) : capture.point}）`
                            + `拒绝了同一个任务 ${stall.count} 次，而**这次有人去解过、没解开**`
                            + `（${String(rescue.whyCannotSolve)}）⇒ 这才进上报池`
                            + '（C2：只有 cannot-solve 进这个池子）',
                    }
                    : {
                        blocking: true,
                        /**
                         * ★ 任务**确实停住了**（`blocking: true` 一个字不改 —— 那是 C1 的读数），
                         *   而它的**归宿是"我们自己解"**，不是"上报给人"。
                         *   ★ 于是这两格现在说的是两件不同的事，而它们**都对**：
                         *     停住 = 真的要有人动；`pool: 'self'` = 动的人**是我们**，不是用户。
                         */
                        fix: 'unfixed: the task stopped here — the same gate rejected it again, per C1'
                            + ' (C2: the default goal is to solve it ourselves, so it is NOT in the report-to-human pool)',
                        pool: poolForRescue(rescue.state),
                    }
                : {
                    blocking: false,
                    fix: 'not blocking: the task kept moving — one rejection is not a stall, per C1',
                    pool: poolForRescue(rescue.state),
                },
            /**
             * ── ★★★ C2：**那个阻塞**后来怎么了（与 `resolution` 不同轴，所以并列）─────────
             *
             * ★ `resolution` 回答「**这条台账记录**是怎么被处置的」；
             *   `rescue` 回答「**那个阻塞**是我们自己解掉的、还是解不掉的」。
             *   ⇒ 合成一格会让"没人回填台账"与"没人解过这个卡点"同形 ——
             *     而它们的补救动作相反（前者要人补 `state`，后者要人去**解**）。
             *
             * ★★ 三态**不同形**（见 {@link missingRescueEvidence}）：
             *   `solved` 有 `solvedBy` + `howSolved`；`cannot-solve` 有 `whyCannotSolve`；
             *   `trying` 两样都**没有** —— 它没有声称任何事，所以没有证据要交代。
             *
             * ★ 这里的缺省是 `trying`（`defaultRescueForStall`）：拒绝路径上**还没有人**
             *   去救过它 ⇒ "缺省 = 默认目标是自己解"，而不是"缺省 = 上报给人"
             *   （那正是 214 条的成因）。
             */
            rescue,
            /**
             * ── ★★★ t91：自动记录的**来源** —— 而它缺席就是"人记的" ───────────────────────
             *
             * ★ 写在**顶层**（与 `resolution` 并列），因为它回答的是"这条记录**是谁产生的**"，
             *   而不是"它后来怎么了"。两件事不同轴 ⇒ 不同格（本队反复记账的那条）。
             *
             * ★★ 而它**不取舍 `resolution`**：自动条目**仍然**带 `resolution`（那是"当时还没修"的事实），
             *   只是那个 `resolution` **没有 `state`** —— 而分诊器现在**看得懂这个缺省**
             *   （自动记录的 `state` 缺席是设计如此，人工记录的缺席才叫待回填）。
             *
             * ★ 内容一个字都不少：`message` / `context` / `mechanismState` 全部照旧 ⇒
             *   它们仍能在 HTML 里读、仍能被判据扫。变的只是"要不要人来补一个 state"。
             */
            ...capture.auto === undefined ? {} : {
                auto: {
                    tool: capture.auto.tool,
                    point: capture.auto.point,
                    ...capture.auto.gate === undefined ? {} : { gate: capture.auto.gate },
                    /**
                     * ★ t69：把**归属键**落盘（`capture.taskId` / `capture.teamId`）。
                     *   缺席语义与 `gate` 逐字相同 —— 空串/未给 ⇒ 不写这一格（不猜）。
                     */
                    ...typeof capture.taskId !== 'string' || capture.taskId.trim() === ''
                        ? {} : { taskId: capture.taskId },
                    ...typeof capture.teamId !== 'string' || capture.teamId.trim() === ''
                        ? {} : { teamId: capture.teamId },
                    /**
                     * ── ★★★ t30：全部判据 id（`gates`），与单值的 `gate` **并存**────────────
                     *
                     * ★ 为什么两格都写：`gate` 是**已在盘上的形状**（384 条旧记录都是它），
                     *   读取端（`gate-friction-capture.test.mjs` 那条臂、以及 HTML 报告）
                     *   现在读的就是它 ⇒ **不许为了"更整齐"把它撤掉**，那会让旧记录与新记录不同形。
                     * ★ 而这一格回答的是**另一个问题**：这条记录**一共**被哪些判据拒过。
                     *   ⇒ 只有一格时，18 条多值记录里非首位的判据在落盘端**永久消失**（t30 的缺陷）。
                     * ★ 单值 = `gates[0]`（实测：9 条有 `auto.gate` 的多值记录，`stored === first` 无一例外）
                     *   ⇒ 两格**冗余但一致**，而这正是"改形状要能与旧数据共处"的代价，值得付。
                     */
                    ...(() => {
                        const gates = gateIdsFromMessage(capture.message);
                        return gates.length === 0 ? {} : { gates };
                    })(),
                },
            },
            /**
             * ── ★★★ C1：判这条记录属于哪一类的**那个判据**，连同它的读数一起落盘 ───────────
             *
             * ★ 为什么判据本身也要写进记录（而不是只写结论 `class`）：
             *   "这条为什么算卡点"是**事后唯一读不出来**的东西。只写 `class: 'blocker'`
             *   会让读的人无从知道 N 是几、是哪条判据重复——而那正是下一次要复查的。
             *   ★ 与 `scene.ctx` 同一条纪律（f-0014）：结论要连同它的**测量装置**一起落地。
             *
             * ★★ 而 `threshold` **必须**一起记：N 是可注入的（见 `stallRepeatThreshold`），
             *   所以"count=2 为什么算停住"这个问题在不同 N 下答案不同 ——
             *   不记 N 的话，两条 count 相同的记录在读取端**同形**，而它们的结论相反。
             *   （这正是 `docs/PENDING-FRICTION-REFORM.md` §6 经验 A：一个数必须连同它的
             *   测量装置一起读，否则并把排就是伪造趋势。）
             */
            stall: {
                state: stall.stalled ? 'stalled' : 'trying',
                basis: stall.basis,
                count: stall.count,
                threshold: stallRepeatThreshold(),
            },
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
    /**
     * ── ★★★ t5：契约位置**仍然拒绝**「没能测量」，但它必须与「发现问题」不同形 ──────────
     *
     * ── 先记一条被驳回的第一版设计（它红了一条**绿着的**臂）─────────────────────────
     *
     * 本任务的第一版把这里改成"`unmeasured` 且 `blockers` 为空 ⇒ 放行"，
     * 依据是 `scripts/gate-task-atomicity.test.mjs` 臂 9 断言的那条 `ok === true`。
     *
     * ★ 而实测当场打红 `scripts/gate-position-wiring.test.mjs` 臂 2
     *   （"contract 位置上一条 unmeasured 判据 ⇒ 拒绝措辞与 blocked 不同形"）——
     *   那条臂在基线上是**绿的**（26/26），且它**不在** `baseline-known-failures.json` 里。
     *
     * ★★ 而驳回它的理由比"它红了一条臂"更硬：**契约位置拒绝 unmeasured 是刻意的**。
     *   `src/gates/contract/verify-command.ts:88-97` 早就把口径写死了：
     *
     *     注入   ⇒ 真的跑一次 ⇒ 结论是**观察**，可被独立复核
     *     不注入 ⇒ 只有静态分析 ⇒ 结论降级成 `unmeasured`
     *     ⇒ 而 `unmeasured` 在本插件里**等于拒绝**（`rejectOnContractGates` 对 unmeasured 抛错）
     *
     *   ⇒ ★ 它若放行，t17/t18 那段实测的**一道永远关着的门**会被读成"没检查"而放过去：
     *     **一个判不了契约的任务不许静默进入工作。**
     *   ★ 这与 `src/tools/update-task.ts` 的 completion 位置同一条纪律 ——
     *     那里的 `completionNotChecked` 也是把 `unmeasured` 当作"没能检查"而**不**当通过。
     *
     * ── 那么本任务真正要修的是什么（★ 比第一版窄，而它是可验证的那一半）───────────
     *
     * 不是"放行"，而是**三态在那个拒绝里必须仍然可分辨**：
     *
     *     ① `blockers` 非空  ⇒ 措辞说"判据发现了问题"（补救动作：去改契约）
     *     ② `unmeasured`     ⇒ 措辞说"判据没能测量"（补救动作：去补判据缺的那一格输入）
     *
     * ★ 把 ② 写成 ① 就是本队记账最久的合流（「没能测量」并进「没通过」）。
     *   两者的**补救动作相反**，所以读日志的人必须一眼分得出是哪一种。
     *
     * ★★ 而"拒绝"与"留痕"从来不是二选一：拒绝是**裁决**，留痕是**可读性**。
     *   一个被拒的契约位置同样必须能回答"当时到底是没测成，还是检查出了毛病"。
     *   ⇒ 见下面三条出口（拒绝措辞 / 台账 `couldNotObserve` / 结构化字段）。
     */
    const unmeasuredAtContract = gates.ok === false && gates.unmeasured !== undefined
        ? String(gates.unmeasured)
        : undefined;
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
         *
         * ── ★★★ t5：这一句三目**是**本任务保下来的东西，不是残留 ────────────────────
         *
         * 它把同一句 "rejected:" 分成**两种措辞**，而那不是装饰：
         *
         *     `unmeasured` ⇒ "the contract gate could not measure (…)"   ← 判据**说不出**
         *     `blockers`   ⇒ "<blockers 原文>"                            ← 判据**发现了问题**
         *
         * ★ 第一版 t5 把这个 `unmeasured` 支删掉了（因为当时想把这一态改成放行）。
         *   而 captain 裁定驳回放行（见上面那段长注释）⇒ **这一支必须原样回来**：
         *   它正是 `scripts/gate-position-wiring.test.mjs` 臂 2 钉的那条性质 ——
         *   "unmeasured must read as 'could not measure', never as 'found problems'"。
         * ★★ 而它**不是**"把拒绝说得好听"：两种措辞对应**相反的补救动作**。
         *   读的人从这一句就能知道该去补输入面，还是该去改契约。
         */
        const frictionMessage = gates.unmeasured !== undefined
            ? `${what} rejected: the contract gate could not measure (${gates.unmeasured})`
            : `${what} rejected: ${gates.blockers.join('; ')}`;
        /**
         * ── ★★★ C1：这一次拒绝之后，任务有没有继续往下走 ──────────────────────────────
         *
         * ★ 判据的信息**此刻全都在手边**：任务对象（`context.task`）里就有上一轮的
         *   `stall` 读数，而这次的判据 id 就在 `frictionMessage` 里。
         *   ⇒ 不需要为此多读一次盘（那会与调用方正在写的那一份不同源）。
         *
         * ★★ 而上一轮的 `stall` 是**调用方在写它之前**读到的 —— 见各调用点的
         *   `observeStall` 调用处（那里在锁里，读到的是权威的那一份）。
         */
        const contractTask = context.task;
        const stall = observeStall(contractTask?.stall, gateIdFromMessage(frictionMessage), 'contract');
        void recordFriction({
            stateRoot,
            point: 'contract',
            message: frictionMessage,
            context: { ...context, ...inject },
            mechanismState: { inputSurface, gates },
            stall,
            taskId: typeof context.task?.id === 'string'
                ? context.task.id : undefined,
            tool: what,
            /**
             * ★★★ t91：这条是**自动记录**的（本函数就是拒绝路径）⇒ 它没有 resolution 是设计如此。
             *   ⇒ 声明出来，分诊器才不会把它算进「台账待回填」。
             */
            auto: {
                tool: what,
                point: 'contract',
                ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) },
                /**
                 * ── ★★★ t30：同一个 `contract` 位置上**同样丢掉过非首位判据** ──────────────
                 * ★ 这一段与 `recordFriction` 里那一格**是两处独立的写入点**（同一份数据写两遍），
                 *   所以修复也必须是**两处** —— 只改一处会让"两个出口不同形"，而那正是本仓记账的形态。
                 * ★ `gateIdsFromMessage(frictionMessage)` 与上面单值那一行**同源**（同一个字符串），
                 *   故 `gates[0] === gate`（当 `gate` 在场时）—— 冗余但不分叉。
                 */
                ...(() => {
                    const gates = gateIdsFromMessage(frictionMessage);
                    return gates.length === 0 ? {} : { gates };
                })(),
            },
            /**
             * ★★★ t5：`couldNotObserve` 在**拒绝**这一支上**必须**带（第一版把它挪去了放行支，
             *   而那一支被驳回了）。
             *
             * ★ 它带来的东西是别处拿不回来的：判据说"我测不了"时，**那一句原文**要落进台账。
             *   否则事后读这条拒绝只能看到"被拒了"，而看不出**缺的是哪一格输入** ——
             *   于是补救动作变成了猜。
             * ★ 与告警、结构化出口**不同源**：那是"当下这一次调用"的读数，这是"事后能查"的记录。
             */
            ...gates.unmeasured === undefined ? {} : { couldNotObserve: [String(gates.unmeasured)] },
        }).then((id) => {
            if (id === undefined)
                ctx.logger.warn(`agent-teams: could not record the friction at the contract gate (${frictionMessage})`);
        });
        /**
         * ── ★★★ t5：三态在那个拒绝里必须**可分辨**，而三条出口都要活着 ──────────────────
         *
         * （下面那一段注释是给人读的；三条出口按"读得出来才算数"排。）
         *
         *     ① 拒绝措辞   —— `unmeasured` 说 "could not measure"（还带着判据原文），
         *                     `blockers` 说 "rejected: <blockers>"。**两者不同形**。
         *     ② 台账        —— `couldNotObserve` 带上原文（见上）。
         *     ③ 结构化出口  —— 走**抛出侧**（`throwWithSurface` 的 `field`），
         *                     与 dispatch / completion 两个位置既有的做法一致。
         *
         * ★★ 为什么 ③ 必须走抛出侧、而不能留在返回值上（这一条是 captain 裁定 (e)）：
         *   本函数在"没能测量"这一支**抛错**（那是刻意的裁决，见上面那段长注释），
         *   而抛出之后的 `return` **永远走不到** ⇒ 挂在那里的 `contract_unmeasured`
         *   就是一个**永远填不上的字段**。
         *   ⇒ ★ 而"看起来在场、实际永远是空的读数"正是本队要消灭的形态（一个读数若
         *     读不出内容，它与不存在必须不同形 —— 而"永远不存在"比"缺席"更坏，
         *     因为它会让读者以为**有一天**它会填上）。
         *   ⇒ 所以：**不放一个死的返回字段**；把这条事实交给抛出的那一条路径，
         *     它会随工具错误面一起到调用方手里（与另外三个位置同一条机制，不新造路径）。
         */
        throwWithSurface(frictionMessage, inputSurface, 
        /**
         * ★ 位置名与既有约定一致（contract 位置目前用泛用的 `input_surface`，
         *   见 `throwWithSurface` 的注释：contract / delivery 各只有一个入口）。
         */
        'input_surface', 
        /**
         * ★★ t5 新增的第五个实参：**「没能测量」的原文**。
         *   缺席 ⇒ 这次拒绝是"发现了问题"；在场 ⇒ 这次拒绝是"判据说不出"。
         *   ★ 两者在结构化出口上**不同形**，于是"哪一种拒绝"不靠读措辞去猜。
         */
        unmeasuredAtContract);
    }
    /**
     * ── ★★ t5：这里**没有**"放行"分支 —— 而它的缺席是刻意的、有据的 ──────────────────
     *
     * 本任务的第一版在这里写了一段 `if (unmeasuredAtContract !== undefined) { 告警 + 台账 }`，
     * 即"判据说测不了 ⇒ 放行，但留痕"。★ 它被 **captain 裁定驳回**，理由记在上面那段
     * 长注释里，而其中最硬的一条是：
     *
     *     `scripts/gate-position-wiring.test.mjs` 臂 2 钉的是"契约位置**拒绝** unmeasured"，
     *     而它在基线上是**绿的**、且**不在** `baseline-known-failures.json` 里。
     *     把它打红就是把一条约束当成可以随手拆掉的东西。
     *
     * ★★ 而正确的形态是"**拒绝 + 三态可分辨**"，不是"拒绝或留痕"二选一：
     *   裁决（拒绝）与可读性（留痕）是两件事，一个被拒的契约位置同样要能回答
     *   "当时是没测成，还是检查出了毛病"。⇒ 三条出口都在**拒绝那一支**里（见上）。
     *
     * ★ 留这段注释而不是把代码删干净就走：下一个读到这里的人会问"为什么 unmeasured
     *   没有自己的分支" —— 而一个**没有解释的缺席**与"忘了写"是同形的。
     */
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
    /**
     * ── ★★ t5：这里**不**挂 `contract_unmeasured` —— 而"不挂"是被裁定过的，不是漏写────
     *
     * 第一版在这里返回 `{ contract_unmeasured }`，作为"没能测量"的**结构化出口**。
     * ★ 而它在修好的形态下是**死的**：本函数在"没能测量"那一支**抛错**（那正是
     *   契约位置刻意的裁决）⇒ 抛出之后的这个 `return` **永远走不到** ⇒ 那个字段
     *   永远填不上。
     *
     * ⇒ ★★ 而"看起来在场、实际永远是空的读数"正是本队要消灭的形态。
     *   一个永远填不上的字段比"缺席"更坏：**缺席至少诚实**，而它会让读者以为
     *   有一天它会填上，于是没人再去看真正的那条路径。
     *   （captain 裁定 (e)：一个字段若永远无法被填充，要么接到**抛出侧**，要么删掉 ——
     *     不许带着它当死代码发布。这里选后者，因为抛出侧已经承载了它。）
     *
     * ★ 那条事实去哪了（三处，都不在这个返回值上）：
     *     ① 拒绝措辞 —— `rejected: the contract gate could not measure (…)`
     *     ② 台账      —— `couldNotObserve: [原文]`
     *     ③ 抛出侧    —— `throwWithSurface(…, unmeasuredAtContract)`，随工具错误面到调用方
     */
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
field = 'input_surface', 
/**
 * ── ★★★ t5：这次拒绝是**哪一种** —— 「判据说不出」的原文，缺席即"发现了问题"──────
 *
 * MEASURED（t5）：契约位置的拒绝有两种成因，而**它们的补救动作相反**：
 *
 *     `unmeasured`（本参数在场）  ⇒ 判据**没能测量** ⇒ 去补它缺的那一格输入
 *     `blockers`  （本参数缺席）  ⇒ 判据**发现了问题** ⇒ 去改契约
 *
 * ★ 为什么它必须走到**抛出侧**而不是留在返回值上：本函数是被**抛出**路径调用的，
 *   而抛出之后调用方拿到的只有这个异常 —— 于是"哪一种拒绝"如果不随异常走，
 *   它就在**唯一真正被读到的那个出口**上缺席。
 * ★★ 而它**不改变措辞**（`message` 已经把两种成因分开写了），它补的是**结构化**那一份：
 *   读的人不必去正则匹配一句英文，就能分出"没能测量"与"发现问题"。
 *   ★ 与 `field` 那条注释同一条纪律：**同一个事实必须在两条路径上同形**。
 * ★ 传 `undefined` ⇒ 字段**不出现**（而不是出现一个空串）。缺席与"空"必须不同形。
 */
unmeasured) {
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
    /**
     * ── ★★★ t5：这条拒绝是**哪一种成因** —— 随异常一起走 ────────────────────────────
     *
     * 与上面两条属性**完全同一个机制**（`defineProperty` + 可枚举、不可写）：
     *   ★ 不新造第二条通道，因为"同一个事实在两条路径上必须同形"。
     *
     * ★★ 为什么它必须挂在**异常**上，而不是留在 `rejectOnContractGates` 的返回值上：
     *   本函数被**抛出**路径调用，抛出之后调用方拿到的只有这个异常 ⇒
     *   挂在返回值上的那份**永远走不到**（t5 第一版就是这样，captain 裁定 (e) 驳回）。
     *   ⇒ 一个永远填不上的字段比"缺席"更坏：缺席至少诚实。
     *
     * ★ 三态在这里是**不同形**的（与 `surface` 那条同一纪律）：
     *
     *     属性不出现          ⇒ 这次拒绝是"判据发现了问题"（`blockers` 那一支）
     *     属性 = 原文          ⇒ 这次拒绝是"判据没能测量"（`unmeasured` 那一支）
     *     ★ 而不是"属性 = 空串" —— 缺席与空必须不同形。
     *
     * ★ 它**不改裁决**：异常类型、`name`、`message` 一个字节没变
     *   （措辞里的两种成因由调用方写进 `message`，见 `rejectOnContractGates`）。
     *   去掉这三行，没有任何一处裁决会翻面。
     */
    if (unmeasured !== undefined) {
        Object.defineProperty(error, CONTRACT_UNMEASURED_PROPERTY, {
            value: unmeasured,
            enumerable: true,
            writable: false,
            configurable: false,
        });
    }
    throw error;
}
/**
 * ★ t5：拒绝的**第三种**成因在结构化面上的字段名 —— "判据没能测量"。
 *
 * ★ 为什么与 `INPUT_SURFACE_PROPERTY` **分列**（不合流）：
 *   `inputSurface` 说的是"**调用方**少交了一格"（接线缺陷），
 *   本字段说的是"**判据**拿到齐的输入仍然说不出"（判据的能力边界）。
 *   两者的补救动作相反 ⇒ 合成一格就是本队记账最久的那个合流。
 */
export const CONTRACT_UNMEASURED_PROPERTY = 'agentTeamsContractUnmeasured';
export const INPUT_SURFACE_PROPERTY = 'agentTeamsInputSurface';
export const INPUT_SURFACE_FIELD_PROPERTY = 'agentTeamsInputSurfaceField';
/**
 * 读回"哪一种拒绝"—— 与 {@link inputSurfaceFieldOf} 同一形状的读数装置。
 * ★ 属性缺席 ⇒ `undefined`（**不是**空串）：缺席与"空"必须不同形。
 */
export function contractUnmeasuredOf(error) {
    if (error === null || typeof error !== 'object')
        return undefined;
    const value = error[CONTRACT_UNMEASURED_PROPERTY];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
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
    const bypassed = [];
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
         * ── ★★ 驱动不在场：不再把整份观察面扔掉（t46）──────────────────────────────
         *
         * MEASURED（2026-10-14，一次真实交付）：`ledger` 做完全部任务、`agent/status`
         * 已把它写回 `idle`，随后宿主卸掉了它的驱动（`drainContinuableChildren` →
         * `dispose`，这条路**不发任何事件**）。于是：
         *   · 旧写法在这里 `return undefined` ⇒ 整个交付位置 unmeasured ⇒ 恒拒绝；
         *   · 而用户看到的拒绝语是 `Delivery: blocked ()`（空括号，见渲染那段）。
         *
         * ★ 为什么不能读 `member.status` 补这一格：`src/members.ts:944` 记着
         *   「`member.status` 是持久记录，它会在成员死掉之后仍然写着 `working`」，
         *   而 `:990` 又补一句「在飞要用【任务】判，不能用 `member.status`」。
         *   拿一个自己会残留的字段当自变量，等于拿被质疑的当证据。
         *
         * ★ 为什么不能改判据让它放过：判据的白名单（`['idle','reported']`）与
         *   `spoke` 缺席 ⇒ unmeasured 是**契约**，由 `scripts/gate-delivery-coverage.test.mjs`
         *   的 24 条臂钉住。动它就是把"没测到"放行成"测过了"。
         *
         * ⇒ 此处只做一件事：该成员**不可观察** ⇒ 不进观察面，但记进旁路留名。
         *   「略过一个不可观察的成员」与「这个队没有成员」因此不同形。
         *   「会话死了但活还在」这一维这次确实不可用 —— 那是设计约束
         *   （`waitRecords` 是进程内 Map、冷启动即空），不是待修的 bug。
         */
        if (live === undefined) {
            bypassed.push({ name: member.name, reason: 'driver-absent' });
            continue;
        }
        const spoke = observedSpoke(live.session);
        out.push({
            name: member.name,
            /**
             * ★ 两个来源分开用，不合流：
             *   · `state` 来自 **live Agent**（它此刻忙不忙）—— 这是可观察的；
             *   · 持久记录 `member.status` **只用来跳过 `removed`**，绝不冒充收敛。
             * 于是"记录里写着 idle、而它其实没交回任何东西"这件事，由 `spoke: false` 抓住。
             */
            state: live.status === 'running' ? 'working' : live.status === 'idle' ? 'idle' : 'unknown',
            /**
             * ★ `spoke` 读不出 ⇒ 缺席（不是 `false`）：判据那头
             *   `convergence.ts:273` 的 `unmeasuredSpokes` 会**指名这个成员**报
             *   unmeasured，而其他成员的观察照常参与判定。
             *   ★ 这正是 t46 的第三步，而它**不需要改判据** —— 判据早已逐成员处理。
             */
            ...spoke === undefined ? {} : { spoke },
        });
    }
    return { observed: out, bypassed };
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
            /**
             * ── ★★★ `failures` 必须【透传】—— 否则 t19 那一格永远收不到数据 ────────────
             *
             * MEASURED（2026-10-10，`verifier` 在 t40 上逐环查出）：
             *   解析器只保留 command/status/exitCode/evidence ⇒ `failures` **既不读也不透传**
             *   ⇒ `classifyVerifyFailures` 拿到的永远是 `undefined` ⇒ 永远 `undecidable` ⇒ 永远拒。
             *   ★★ 而 schema 那一环也不暴露它（`additionalProperties: false` 且无 `failures`）
             *     ⇒ 就算传了也会在建参数时被拒。
             *   ⇒ ★ 于是"t19 修好了"与"t19 一点也没生效"在读数上同形 —— 因为那一格没有数据。
             *
             * ★ 而它只在【形状对】时透传：一条名字不像字符串的失败，在这里丢掉，
             *   而不是让下游拿一个半读得懂的数组（那会让"读不懂"与"没有新增"合流）。
             */
            ...Array.isArray(raw['failures'])
                ? { failures: raw['failures'].filter((name) => typeof name === 'string' && name.trim() !== '') }
                : {},
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
            /**
             * ── ★★ 三态在渲染层就分形（t46）──────────────────────────────────────────────
             *
             * MEASURED（2026-10-14，一次真实交付）：`declare_delivery` 被拒，原话是
             * 「the members' convergence state was not observed」；而 status 的渲染里
             * 只有一行 `Delivery: blocked ()` —— **括号是空的**。
             *
             * 两层叠加造成那个空括号：
             *   ① `blockers` 是空的（没能测量不写进 blockers，那是 t35/f-0017 的正确分法）；
             *   ② `unmeasured` 被渲染层丢掉了（这一行的类型里根本没有那一格）。
             *
             * ⇒ 于是「查出了问题」与「没测到」在读者眼里**同形**，而它们的下一步动作相反：
             *    前者去修产物，后者去接线。把 unmeasured 印出来，不是多加一行字，
             *    是让那个空括号不再骗人。
             *
             * ★ 三条形状互不相同，且 `ok` 优先：都齐时只说 ok，不啰嗦。
             */
            (() => {
                const delivery = team.delivery;
                if (delivery.ok)
                    return 'Delivery: ok';
                const measured = delivery.blockers.join('; ');
                if (measured !== '')
                    return `Delivery: blocked (${measured})`;
                if (typeof delivery.unmeasured === 'string' && delivery.unmeasured.trim() !== '') {
                    return `Delivery: unmeasured (${delivery.unmeasured})`;
                }
                /** 既没有查出的问题、也没能说出原因 —— 那是调用点自己的缺陷，不能印成 ok。 */
                return 'Delivery: blocked (no reason given)';
            })(),
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
