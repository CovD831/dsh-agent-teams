// ── src/tools/update-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { appendTeamEvent, captainSessionOf } from "../events.js";
/**
 * ── ★★★ kind 需求表的**同步**读取（t54）─────────────────────────────────────────
 *
 * ★ 为什么在这里而不在 `shared/entities.ts`：`update-task.ts` 是 completion 位置
 *   **唯一**的求值点（`registry.evaluate('completion', …)` 全仓只有一处），
 *   而 t54 的 inScope 正好包含它。
 *
 * ★ 为什么**同步**：`appliesTo` 是同步契约，而 kind 守卫住在那里
 *   （`verify-command` 的 `appliesTo` 不读表，所以它那格可以异步；这张表不行）。
 *
 * ★ 为什么**每次读、不缓存**：缓存会让"改表"在下一次**进程重启**前不生效 ——
 *   而那正是 t53/t54 要消灭的东西（改它读的东西不该需要换进程）。
 *
 * ★ 四态**互不同形**（`absent` / `malformed` 在这里判，`loaded` / `kind-unknown`
 *   由判据层判）⇒ 后三者让门降级成 `unmeasured`，**绝不静默退化成"不需要门"**。
 */
function loadKindRequirementsSync() {
    /**
     * ★★ MEASURED（我在夹具里当场撞到）：这里原本写的是 `__dirname` ——
     *   而它是 **CJS** 的变量，在 ESM 模块里**不存在** ⇒ 运行到这一行就
     *   `ReferenceError: __dirname is not defined`。
     *
     * ★ 形态：**它能编过、也能 build，只在真的执行到那一行时才炸** ——
     *   而那正好是"读表"这条路径 ⇒ 每一个走到它的任务都会失败。
     *   ⇒ 与 t53 那条 `loadVerifyCommandRules` 用的是同一条正确写法：
     *     `dirname(fileURLToPath(import.meta.url))`。
     */
    /**
     * ★★ MEASURED（第二个我只能靠【跑】才发现的错）：层数错了。
     *
     *   本文件是 `src/tools/update-task.ts` ⇒ 构建后是 `lib/tools/update-task.js`
     *   ⇒ `here = <root>/lib/tools`。
     *   ⇒ 到仓库根要 `..` **两次**（`lib/tools` → `lib` → 根），
     *     候选 2 到 `src/` 要**三次**。
     *
     *   ★ 而我第一版照抄了 t53 的层数 —— 那一条在 `lib/tools/shared/entities.js`
     *     （**深一层**）⇒ 它 `..` 两次到根，本文件 `..` 两次才到 `lib`。
     *     ⇒ **两条候选路径都不存在** ⇒ 读表恒 `absent` ⇒ 每条走到完工门的任务
     *       都会拿到 unmeasured（而不是它该得的裁决）。
     *
     * ★ 形态（与 `__dirname` 那条同类）：**编得过、build 得过、typecheck 过得** ——
     *   只有**真的执行到那一行**才现形。而"照抄一份看着一样的代码"是它的成因。
     * ★ 判别动作：**抄路径常量之前，先数一遍自己在哪一层。**
     */
    const here = dirname(fileURLToPath(import.meta.url));
    /**
     * ★★ 层数是**数出来**的，不是抄来的（见上面那段）：
     *
     *     here = <root>/lib/tools
     *     <root>/lib/gates/completion/…  ⇒ `..` × 1（tools → lib）
     *     <root>/src/gates/completion/…  ⇒ `..` × 2（tools → lib → root）
     *
     * ★ 而第一条**当下不存在**（`tsc` 不复制 `.json`，与 t53 的同一个事实）——
     *   它留在那里是为了"哪天构建把 JSON 带过来了"那一刻自动生效，
     *   而**第二条是此刻真正起作用的那条**。
     */
    const candidates = [
        join(here, '..', 'gates', 'completion', 'kind-requirements.json'),
        join(here, '..', '..', 'src', 'gates', 'completion', 'kind-requirements.json'),
        /**
         * ── ★★ 第三条：从 **cwd** 找（MEASURED，且它是第三个"只有跑才现形"的错）──────
         *
         * ★ 成因：`gate-readout-uniform` 把源码 **bundle 到一个临时目录**再 import ——
         *   于是 `import.meta.url` 指向那个临时目录，前两条候选**都不存在**
         *   ⇒ 表读成 `absent` ⇒ 三条门全 `appliesTo===false` ⇒ 位置级 `checked:0, skipped:4`。
         *
         * ★ 形态（与前两个同类，但这次是**位置被搬走**而不是算错）：
         *   「路径**相对谁**」这件事，在"文件被搬到别处运行"时会失效；
         *   而它编得过、build 得过，**只有那种运行方式**才现形。
         *
         * ★ 为什么 `cwd` 是对的补充（而不是"碰运气"）：数据文件是**插件自己的**，
         *   而插件的根就是**跑它的那个工作目录**（`pnpm test` / `node --test` 都从仓库根跑）。
         *   ★ 而它排在前两条**之后**：那两条是"跟着模块走"（更精确），
         *     这一条是"跟着调用方走"（更鲁棒）。⇒ 精确的优先，鲁棒的兜底。
         */
        join(process.cwd(), 'src', 'gates', 'completion', 'kind-requirements.json'),
    ];
    let lastError = '';
    for (const candidate of candidates) {
        try {
            return parseKindRequirements(JSON.parse(readFileSync(candidate, 'utf8')));
        }
        catch (error) {
            lastError = `${candidate}: ${String(error?.message ?? error)}`;
        }
    }
    return { status: 'absent', reason: `the kind-requirements table could not be read from any known location (${lastError})` };
}
/**
 * ── ★★ t67：问表「这个 kind 要求哪些门」—— 而**答不出来时返回 `undefined`** ──────
 *
 * 它是给 {@link traceEvidenceConsumer} 用的那一格输入。
 *
 * ★ `undefined` 的三种成因（表读不到 / 表坏 / 表里没有这个 kind）**都必须落 undefined**：
 *   "我问不出这个 kind 要什么门"与"它不要任何门"是**两件事** ——
 *   后者会让 `produced`（生产了、没人读）被误报成 `consumed`（有人读）。
 *   ⇒ 而那是一句**反过来的假结论**：把缺陷说成正常。
 *
 * ★ 而它与判据层那条纪律逐字对齐（`kind-requirements.ts` 的四态：
 *   `absent` / `malformed` / `kind-unknown` 让门降级成 `unmeasured`，
 *   **绝不静默退化成"不需要门"**）。
 */
function requiredGateIdsFor(kind) {
    const load = loadKindRequirementsSync();
    if (load.status !== 'loaded')
        return undefined;
    const requirement = typeof kind === 'string' ? load.requirements.byKind.get(kind) : undefined;
    if (requirement === undefined)
        return undefined;
    return requirement.requiredGates;
}
import { registry } from "../gates/index.js";
import { observedChangedPaths } from "../harness-compat.js";
import { mailboxPrompt } from "../mailbox.js";
import { appendTaskEvidence, repairCompletionVerdict, traceEvidenceConsumer } from "../quality-gates.js";
import { TERMINAL_TASK_STATUSES, appendExecution } from "../types.js";
/**
 * ★ `needsWorktreeFor`：判"这条任务**应当**有隔离树吗" —— 用来把
 *   「本来就不建树」与「该建树而没建成」分开（后者是一个真缺陷）。
 *   ★ 从 `types.ts` 取单一来源，**不在这里再写一份 kind 列表**。
 */
import { needsWorktreeFor } from "../types.js";
/**
 * ★ 落终态时把 worktree 的改动提交成 commit（见下面那一格的注释）。
 *   —— 缺口是实测出来的：只建树、不提交 ⇒ 46 棵 worktree 里目标文件一个都没有。
 */
import { commitWorktree, worktreeDirName } from "../worktree.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
/**
 * ★ t54：kind 需求表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 * ★ 方向不会成环：`r5.ts` 只 import `../registry.ts` / `../requires.ts`。
 */
import { parseKindRequirements } from "../gates/completion/kind-requirements.js";
import { changedLineNumbers, deriveScanDirs, diagnosticFields, evaluateRuntimeGates, mergeRerunIntoCommandsRun, observeMemberActivity, recordFriction, gateIdFromMessage, requireCaptain, requireFreshParticipant, requireParticipantTeam, requireTask, resolveBaseRevision, stateRootOf, teamLockKey, noteStall, clearStall, throwWithSurface, withInputSurfaceOnError, workspaceOf, } from "./shared/entities.js";
import { wireCompletion } from "./update-task/completion.js";
import { CAPTAIN_KEY, appendMailbox, createMessage, evaluateQualityCompletion, failureKindOf, markMailboxDelivered, normalizeBlankOptionalTaskFields, transitionError, withTeamLock, writeTeam } from "../state.js";
import { steerCaptainReport } from "../tools.js";
import { applyQualityFollowUp, parseAcceptanceResults, parseCommandResults, parseFindings } from "./shared/entities.js";
import { pathToFileURL } from 'node:url';
/**
 * ── ★★★ 可选地读队长会话：**绝不**让"读不到"变成"这次完成失败了" ────────────────
 *
 * MEASURED（本仓实测，十几次，跨四个成员与队长自己）：在工具的**返回值算完之后**
 * 调 `ctx.agents.get(...)`，会抛
 *   `cannot get required service "agents" in inactive context`
 * 而**落盘已经完成**。机制在 host 的 cordis（`lib/index.js:688`）：取值器沿 fiber
 * 树往上找 `fiber.store`，而 `store` **只在 fiber 处于 active 时存在**；本插件在
 * 顶层 `inject` 里声明了 `agents`（`src/index.ts:56`），于是当**本处理器所属的
 * fiber 已经不在运行**时，取值器走到"我自己就声明了它"这一支 ⇒ **当场抛，不再往上找**。
 *
 * ★ 而它为什么**有时不抛**：同一个处理器**先**返回结果、**后**执行这段投递，而
 *   "会话何时结束"与"这段代码何时跑"的先后决定了这一次成功还是抛错 —— 产物都一样已交付。
 *   ⇒ 同一句报错里混着"没做"与"做了但回执丢了"，调用方**无法分辨**，于是重试，
 *     而重试又成功又失败 ⇒ 整轮卡在 complete 上。这正是运行里反复出现的那一格。
 *
 * ★ 处置：**按需**读，且失败时返回 `undefined` 而不是抛。这里的读是"把跟进消息
 *   顺手推给队长"的**尽力而为投递**，不是终态转换的判据；消息仍在邮箱里，
 *   下一条 status 会看到，所以没有事实丢失。
 */
function readCaptainSession(ctx, sessionId) {
    if (sessionId === undefined || sessionId === '')
        return undefined;
    try {
        const agents = ctx.agents;
        return agents?.get?.(sessionId);
    }
    catch (error) {
        const message = String(error?.message ?? error);
        /**
         * ★ 只吞**这一种**：服务读不到。其余异常照旧往上抛 —— 一个 `catch` 若把
         *   "读不到队长会话"与"投递逻辑自己坏了"读成同一件事，就是把这一格修成
         *   一个更宽的盲区。
         */
        if (!message.includes('inactive context'))
            throw error;
        return undefined;
    }
}
/**
 * ★★ 本文件**不再** import `rmSync`（defect 1 的修法）：
 *   删除只有**一个**出处 —— `scripts/worktree-reclaim.mjs` 的 `removeWorktree`。
 *   留一句 `rmSync` 在这里就是第二份实现，而它会把 `git worktree list` 里
 *   那条记录留成 `prunable` 幽灵（目录没了、台账还在，且不会自己消失）。
 *   ★ 删掉这个 import 本身也是那条纪律的**可执行形式**：想让删除回来，
 *     就得先把这一行加回来 —— 而那一步看得见。
 */
import { pluginRoot } from "./shared/entities.js";
/**
 * ── ★★★ 交付完成后**按任务**回收它的那棵 worktree（t-concurrency-1-t2）───────────────
 *
 * ── 它防的是什么失效（MEASURED）─────────────────────────────────────────────────
 *
 * `scripts/worktree-reclaim.mjs` 与 `src/worktree.ts` 的 `judgeWorktreeReclaimable`
 * 都是**写好了的**，而**全仓零调用方**：
 *
 *     $ grep -rn "judgeWorktreeReclaimable" src/          ⇒ 只有定义处
 *     $ grep -rn "worktree-reclaim" src/                  ⇒ 0 处
 *
 * ⇒ 后果：`lib/` 里那份判定**从未在生产路径上被执行过一次**，
 *   而盘上 46 棵 worktree 只得靠人手动 `--apply` 清 —— 用户原话是
 *   「不能每次都让我手动清理，得有一个自动清理的机制」。
 * ★ 而"一条没接线的判据"与"一条不存在的判据"，在"该不该删"这件事上**没有区别**。
 *
 * ── ★★★ 判据只有一份真值：**本函数不自己判断能不能删** ─────────────────────────────
 *
 * 能不能回收由 `judgeWorktreeReclaimable`（权威实现，`src/worktree.ts:528`）
 * 说了算 —— 它是「已提交的部分被主干吸收」∧「未提交的源码没有一份是历史里不存在的」
 * 两个条件的合取。**这里一行 `git` 都不跑**：
 *
 *   · ★ 不许 `git merge-base --is-ancestor`（那只是上面 (a) 那一半）；
 *   · ★ 不许 `git status --porcelain` + 唯一 blob 的手写推理（那是 (b) 那一半）；
 *   · ★ 不许多一份"吸收/唯一工作"的实现 —— 两份实现分叉时**没有任何东西会发现**，
 *     而分叉的代价是删掉唯一的那份产物（本仓 `task-t64` 实测过：7 个源码文件
 *     68KB/69KB 级，内容不在任何提交里）。
 *
 * ⇒ 本函数只做四件事：**读开关 → 加载模块 → 拿它的裁决 → 只对 `reclaimable` 落地删除**。
 *
 * ── ★★★★★ 入口条件（round-2 修复的那一格，MEASURED）──────────────────────────────
 *
 * **调用方在每一次终态转换、只要那棵树在，就调用本函数** —— 与"这一轮提交成了没有"无关。
 *
 * ★ 为什么这一格曾经是错的（round-1 的 blocker，reviewer 两次实测）：`commitWorktree`
 *   **只在 worktree 里**提交、从**不**合进 `main` ⇒ 提交刚成功的那一刻，树 HEAD 是一个
 *   全新 commit，按定义**不是** `main` 的祖先 ⇒ 权威判据必然答 `keep / not-absorbed`。
 *   ⇒ 把入口设在"提交成功"那一支 = 把入口设在**唯一一个判据必然说不的时刻**。
 * ★ 而**唯一可达**的"已吸收"形状是**没有新改动**的那一次（`commit === undefined`）：
 *   产物早先已被合流、这次本来就没东西要提交 —— 它也**走不到**那个分支。
 * ⇒ 修正：**树在 ⇒ 就判**。今天判 `keep` 是**正确的中间态**（产物还没合流），
 *   而**下一次**这条任务落终态时会再判一次 —— 那时才删。
 *   ★ 判据仍然只有 `judgeWorktree` 一条；本层**不**新增任何"吸收与否"的推理。
 *
 * ── ★★ 为什么**不**用 `planReclaim`（它是同一个脚本里的另一条）────────────────────
 *
 * `planReclaim` 扫的是**整棵** `<repo>/.agent-teams/worktrees/`（`listWorktrees(repo)`）
 * ⇒ 它是"全仓大扫除"，它删的树与**这条任务**没有关系。
 * ★ 而这里要的是**按任务**回收：只动 `this task` 那一棵。
 * ⇒ 所以只用**纯裁决**那一半（`judgeWorktree`），删除由本函数自己对**那一条路径**做。
 *
 * ── ★★★ 只读裁决：判定这一步**不可能**删掉任何东西 ────────────────────────────────
 *
 * `judgeWorktree` 的可见副作用面**只有 `git` 的只读查询**：
 *   `rev-parse` / `merge-base --is-ancestor` / `rev-list --count` /
 *   `status --porcelain` / `hash-object` / `log --find-object`。
 * 它【不】调用 `rmSync`、不写文件、不改仓库状态 —— 删除**只**发生在下面那一处，
 * 且被 `verdict.status === 'reclaimable'` 门住。⇒ "判定"与"删除"是**两个**动作，
 * 而不是"一次调用顺手删了"。
 *
 * ── ★★ 三态不同形，且 `undecidable` 绝不并进 `reclaimable` ────────────────────────
 *
 *   `reclaimable` ⇒ 删，并记一条 info（含模块自己的人话）。
 *   `keep`       ⇒ **不删**，把模块自己的措辞记下来（`reason` / `detail` / `orphaned`）。
 *   `undecidable`⇒ **不删**，记 `why` —— 「判不了」是**没测到**，不是"可以删"。
 * ★ 任一情形都留下**一行可读的日志**：没有静默分支（那会让"没回收"与"没跑"同形）。
 *
 * ── ★★ 它【绝不】改判这条任务 ──────────────────────────────────────────────────
 *
 * 提交失败、模块加载不了、删除抛错 —— **一律只记 warn**，不 throw、不动 `task.status`、
 * 不写 `task.deliveryFailure`。★ 回收是**记账之外**的清理，不是裁决：
 * 把"清理没成"读成"交付失败"，会让成员去重做已经做对的工作（本仓记账过的那一类浪费）。
 *
 * @returns 一条**可读的**读数（也给夹具断言用）；任何失败都落在 `outcome: 'failed'`。
 */
export async function reclaimWorktreeAfterDelivery(options) {
    const { worktree, repo, taskId, status, logger } = options;
    const env = options.env ?? process.env;
    /**
     * ── ★★★ 默认删除器：**等模块加载完**再取它（这里先留一个占位）──────────────────
     *
     * ★ 为什么不能就地写成 `options.remove ?? ((p) => rmSync(...))`：
     *   删除的**唯一出处**是 `scripts/worktree-reclaim.mjs` 的 `removeWorktree`
     *   （它同时删目录与 git 台账条目 —— 见那个函数的文件头）。
     *   在这里再写一句 `rmSync` 就是**第二份实现**，而它会留下 `prunable` 幽灵
     *   （本任务修的 defect 1 正是这么来的）。
     *   ⇒ 所以默认值必须在拿到 `module` 之后才成立（见下面 `remove` 那一处赋值）。
     *
     * ★ 而 `options.remove` 这个注入点**签名不变**（`(path: string) => void`）：
     *   既有夹具臂照旧注入，它们测的是"删除会不会发生"，与出处无关。
     */
    let remove = options.remove;
    /**
     * ── ① 开关：`AGENT_TEAMS_NO_RECLAIM=1` ⇒ **什么都不做**（连模块都不加载）────────
     *
     * ★ 名字来自**模块的导出**（`RECLAIM_OFF_ENV`），不是在这里重打一遍字面量：
     *   两处各写一个字符串，改名那天会**静默分叉** —— 而分叉的表现是
     *   "开关拨了却没停"，那正是本机制最不能出的错（自动删除若不能停，误判不可逆）。
     *   ⇒ 所以在同一份 `import` 里把它取回来（见下面 `loadJudge`）。
     */
    let module;
    try {
        module = await (options.loadJudge ?? loadWorktreeReclaimModule)();
    }
    catch (error) {
        /**
         * ★ 模块加载不了 ⇒ 只记 warn，**不改判**。
         *   ★ 而措辞必须说清"没有回收"，否则它与"回收了"在日志里同形。
         */
        logger.warn(`agent-teams: could not reclaim the worktree for task "${taskId}" at ${worktree}: `
            + `the reclaim judge module could not be loaded (${describeError(error)}) — the tree was left untouched`);
        return { outcome: 'failed', worktree, why: 'module-unloadable' };
    }
    /**
     * ★ 开关读的是**模块导出的那个名字**。`'1'` / `'true'` 都算开（与 CLI 守卫逐字一致）。
     */
    const offSwitch = module.RECLAIM_OFF_ENV;
    const off = env[offSwitch] === '1' || env[offSwitch] === 'true';
    if (off) {
        logger.info(`agent-teams: worktree reclaim skipped for task "${taskId}" (${worktree}) because `
            + `${offSwitch}=${String(env[offSwitch])} is set — the tree was left untouched `
            + '(an automatic delete that cannot be stopped is irreversible when it misfires)');
        return { outcome: 'skipped-off-switch', worktree, why: `off:${offSwitch}` };
    }
    /**
     * ── ★★★ 默认删除器（现在可以定了）：模块里的 `removeWorktree` ────────────────────
     *
     * 它一条命令做完两件事：删目录、**清 git 的 worktree 台账**。
     * ★ 此前这里是裸 `rmSync` —— 它只删目录，而 `git worktree list` 里那一条
     *   会一直留着（标成 `prunable`），且**不会自己消失**。
     *   ⇒ 那不是洁癖：此后每一次 `git worktree list` 都在报告一棵不存在的树，
     *     而那与"我删干净了"在读数上同形。
     * ★★ 走**同一个函数引用**（不是"再写一遍同样的删除"）：两份实现分叉时，
     *   其中一份会把幽灵留下，而**没有任何东西会发现**（本仓记账过的形态）。
     */
    remove ??= (path) => module.removeWorktree({ repo, worktree: path });
    /**
     * ── ② 拿裁决 —— **只有**这一个来源（见上面"判据只有一份真值"）───────────────────
     *
     * ★ 它**不可能**删东西：`judgeWorktree` 里只有只读的 git 查询（见上面的逐条点名）。
     *   删除在本函数里**另起一处**，且只在 `reclaimable` 那一支。
     *
     * ★ 判据自己抛错（例如 git 不在 PATH）也**不改判**：那是"没能测量"，
     *   而不是"可以删"。⇒ 落 `failed` 并保持树不动。
     */
    let verdict;
    try {
        verdict = await module.judgeWorktree({ repo, worktree, ...options.mainRef === undefined ? {} : { mainRef: options.mainRef } });
    }
    catch (error) {
        logger.warn(`agent-teams: could not judge the worktree for task "${taskId}" at ${worktree} `
            + `(${describeError(error)}) — that is "not measured", not "safe to delete"; the tree was left untouched`);
        return { outcome: 'failed', worktree, why: 'judge-threw' };
    }
    /**
     * ★ 人话一律**取自模块**（`human` / `reason` / `why` / `detail`），不在这里另写一句 ——
     *   两处各说一遍会在模块改措辞时分叉，而分叉之后读日志的人分不出该做什么。
     */
    const spoken = verdict.human ?? verdict.reason ?? verdict.why ?? verdict.detail ?? '(the module gave no reason)';
    /**
     * ── ③ 三态：**只有 `reclaimable` 才删** ─────────────────────────────────────────
     */
    if (verdict.status === 'reclaimable') {
        try {
            remove(worktree);
            logger.info(`agent-teams: reclaimed the worktree for task "${taskId}" (${status}) — deleted ${worktree}; `
                + `the judge said: ${spoken}`);
            return { outcome: 'reclaimed', worktree, why: spoken };
        }
        catch (error) {
            /**
             * ★ 删不掉（占用、权限）⇒ 只记 warn。
             *   ★ 而它与"删掉了"必须**不同形** —— 否则盘上留着树、日志却说回收了。
             */
            logger.warn(`agent-teams: could not reclaim the worktree for task "${taskId}" at ${worktree} `
                + `(${describeError(error)}) — the judge said it was safe to delete, but the delete itself failed; `
                + 'the tree was left on disk and this does NOT change the task result');
            return { outcome: 'failed', worktree, why: 'delete-threw' };
        }
    }
    /**
     * ── ④ `keep` / `undecidable` ⇒ **不删**，把模块自己的话记下来 ────────────────────
     *
     * ★ 两态**不同形**（措辞分开），否则"有唯一产物被保住"与"根本判不了"同形。
     * ★ 也不并进 `reclaimable`：这三个词里只有一个允许删除。
     */
    const heldKind = verdict.status === 'keep'
        ? `held (${verdict.reason ?? 'unknown'})`
        : 'could NOT be decided (not measured — this is NOT "safe to delete")';
    /**
     * ★★ "今天保住"**不是**失效 —— 它是"产物还没被主树吸收"的**正确**读数。
     *
     * ★ 而它必须**说清下一次会怎样**，否则读的人会以为这条接线没生效：
     *   `keep / not-absorbed` 的成因是"那个 commit 还没被 integrator 合进主干"，
     *   而**下一次**这条任务落终态时会**再判一次** —— 那时它就成了 `reclaimable`。
     *   ⇒ 所以这一行里明写"将在下一次终态转换时重判"，而不是让它读起来像"没做"。
     * ★ 而 `undecidable` **不许**借这句话蒙混过去：它是"没测到"，
     *   与"吸收与否"是两件事 ⇒ 两者措辞分开（三态不同形）。
     */
    const outcomeNote = options.commitOutcome === undefined
        ? ''
        : options.commitOutcome === 'committed'
            ? ' (this transition committed the deliverable; the trunk has not absorbed it yet, so this is the expected answer until an integrator merges it — it will be judged again at the next terminal transition)'
            : options.commitOutcome === 'nothing-to-commit'
                ? ' (this transition had nothing to commit, so this is a re-judgement of an existing tree)'
                : ' (the deliverable commit did NOT succeed — that is a bookkeeping failure, and it does not by itself make this tree reclaimable)';
    logger.info(`agent-teams: worktree for task "${taskId}" at ${worktree} was NOT reclaimed: ${heldKind} — ${spoken}${outcomeNote}`);
    return { outcome: verdict.status === 'keep' ? 'kept' : 'undecidable', worktree, why: spoken };
}
/** 一行错误消息（★ 不许把异常对象直接塞进模板串 —— 那会打出 `[object Object]`）。 */
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * ── ★★★★★ 扫一遍**已经终态**的任务，把它们早已被吸收的树收掉（defect 2）─────────────
 *
 * ── 它修的是什么缺陷（MEASURED，本任务的由来）───────────────────────────────────
 *
 * {@link reclaimWorktreeAfterDelivery} 只在**终态转换那一刻**被判一次。而它的
 * `keep / not-absorbed` 那条读数里**自己写着**"将在下一次终态转换时重判"。
 *
 * ★★ 而对一条**已经**终态、此后不再更新的任务，那个"下一次"**永远不会来**：
 *   没有 `update_task` 调用 ⇒ 没有终态转换 ⇒ 没有任何时刻会重判它
 *   ⇒ 一棵产物早已被合流进主干的树，**永久**留在盘上，
 *     而盘上的读数与"这条任务还在跑"同形。
 *
 * ── ★★★ 判据仍然只有一份真值 ────────────────────────────────────────────────────
 *
 * 本函数**一行"吸收与否"的推理都没有**：它把每一棵终态任务的树交给模块的
 * `scanTerminalWorktrees`（它再交给 `judgeWorktree` → `judgeWorktreeReclaimable`）。
 * ⇒ 与 CLI、与逐任务那条接线，三条路的答案来自**同一个函数引用**。
 *
 * ── ★★ 它在**名单层面**就保证"非终态不判、不删"─────────────────────────────────
 *   `scanTerminalWorktrees` 在判定之前就把非终态剔掉（见模块里那一节）。
 *   本层**不重做**那个筛选 —— 再筛一遍就是第二个出处。
 *
 * ── ★★ 三态不同形：只有 `reclaimable` 被删 ──────────────────────────────────────
 *   `keep`（未吸收 / 有唯一产物）与 `undecidable`（没测到）**绝不**被删。
 *   ★ 而它把三者的**数量**如实交出去（`kept` / `undecidable`），
 *     否则"扫了 0 棵"与"扫了 20 棵但一棵都不该删"在读数上同形。
 *
 * ── ★★★ 它【不】改任何任务状态，而且【绝不】往外抛 ──────────────────────────────
 *
 * 模块加载失败、判据抛错、删除抛错 —— 一律只记一条**可读的 warn** 并记进读数。
 * ★ 理由与逐任务那条逐字相同：回收是**记账之外**的清理，不是裁决。
 *   把"清理没成"读成"交付失败"，会让成员去重做已经做对的工作。
 * ★ 而"删不掉"必须留下可读痕迹（`failures`）——一个静默失败的删除与"没删"同形，
 *   而盘上留下的那棵树没人会知道。
 *
 * @returns 一条**可读的**读数（也给夹具断言用）；任何失败都不改变它的返回形状。
 */
export async function reclaimTerminalWorktrees(options) {
    const { repo, tasks, teamId, logger } = options;
    const env = options.env ?? process.env;
    /** ★ 这条读数**只在开关拨上时**非空 —— 见下。 */
    const nothing = { scanned: 0, reclaimed: [], kept: 0, undecidable: 0 };
    /**
     * ── ① 开关：`AGENT_TEAMS_NO_RECLAIM=1` ⇒ **什么都不做**（连模块都不加载）────────
     *
     * ★ 名字来自**模块的导出**（`RECLAIM_OFF_ENV`），不是在这里重打一遍字面量：
     *   两处各写一个字符串，改名那天会**静默分叉** —— 而分叉的表现是
     *   "开关拨了却没停"，那正是本机制最不能出的错。
     * ★★ 所以这里要**先**把模块加载起来才读得到那个名字 —— 这是本函数唯一一次
     *   为了开关而加载模块的地方，而它是**必要**的（与逐任务那条同一个道理）：
     *   一个用猜测的字面量去读的开关，在名字改了之后**只会静默失效**。
     */
    let module;
    try {
        module = await (options.loadJudge ?? loadWorktreeReclaimModule)();
    }
    catch (error) {
        logger.warn('agent-teams: could not scan terminal tasks for reclaimable worktrees: '
            + `the reclaim judge module could not be loaded (${describeError(error)}) — nothing was deleted`);
        return { ...nothing, skipped: 'module-unloadable' };
    }
    const offSwitch = module.RECLAIM_OFF_ENV;
    const off = env[offSwitch] === '1' || env[offSwitch] === 'true';
    if (off) {
        /**
         * ★ 一行可读的话，然后**什么都不碰**。
         *   ★ 措辞必须说清"没有扫描"，否则"停了"与"扫了但没有可清的"同形 ——
         *     而后者会让人以为机制在正常工作。
          */
        logger.info(`agent-teams: terminal worktree scan skipped because ${offSwitch}=${String(env[offSwitch])} is set — `
            + 'no worktree was judged and nothing was deleted '
            + '(an automatic delete that cannot be stopped is irreversible when it misfires)');
        return { ...nothing, skipped: `off:${offSwitch}` };
    }
    /**
     * ── ② 纯规划：哪些终态的树**已被吸收** ─────────────────────────────────────────
     *
     * ★ 模块那一半是**纯规划器**（它不删）—— 删除是本函数下一步的事，且只有一处。
     * ★ 判据抛错 ⇒ 不删任何东西（一个"没测得"的扫描不许被读成"没有可清的"）。
     */
    let verdict = { scanned: [], reclaimable: [], kept: [], undecidable: [] };
    try {
        verdict = module.scanTerminalWorktrees({
            repo,
            tasks: tasks.map((task) => ({ id: task.id, status: task.status, ...teamId === undefined ? {} : { teamId } })),
            ...options.mainRef === undefined ? {} : { mainRef: options.mainRef },
        });
    }
    catch (error) {
        logger.warn('agent-teams: could not scan terminal tasks for reclaimable worktrees: '
            + `the judge threw (${describeError(error)}) — that is "not measured", not "nothing to reclaim"; nothing was deleted`);
        return { ...nothing, skipped: 'judge-threw' };
    }
    /**
     * ── ③ 只有 `reclaimable` 才删，而**每一条失败都要留痕** ────────────────────────
     *
     * ★ 路径取自判据自己的 `worktree` 那一格（**不重算** —— 重算就是第二个出处，
     *   而两份路径分叉时删的是另一棵树）。
     */
    const remove = options.remove ?? ((path) => module.removeWorktree({ repo, worktree: path }));
    const reclaimed = [];
    for (const entry of verdict.reclaimable) {
        const path = entry.worktree;
        if (typeof path !== 'string' || path === '') {
            logger.warn('agent-teams: a terminal worktree was judged reclaimable but the judge gave no path for it — '
                + 'it was left untouched (deleting a path this layer computed would be a second source of truth)');
            continue;
        }
        try {
            remove(path);
            reclaimed.push(path);
            logger.info(`agent-teams: reclaimed a terminal task's worktree at ${path} — the judge said: `
                + `${entry.human ?? entry.reason ?? entry.why ?? '(the module gave no reason)'}`);
        }
        catch (error) {
            /**
             * ★ 删不掉 ⇒ 只记 warn，**不改判任何任务**、**不往外抛**。
             *   ★ 而它与"删掉了"必须**不同形** —— 否则盘上留着树、日志却说回收了。
             */
            logger.warn(`agent-teams: could not reclaim the terminal worktree at ${path} (${describeError(error)}) — `
                + 'the judge said it was safe to delete, but the delete itself failed; '
                + 'the tree was left on disk and this does NOT change any task result');
        }
    }
    /**
     * ★ 扫了 0 棵也留一行 —— 否则"扫描跑了、没有可清的"与"扫描根本没跑"同形。
     */
    logger.info(`agent-teams: terminal worktree scan — judged ${verdict.scanned.length} terminal task tree(s): `
        + `reclaimed ${reclaimed.length}, kept ${verdict.kept.length}, undecidable ${verdict.undecidable.length}`);
    return {
        scanned: verdict.scanned.length,
        reclaimed,
        kept: verdict.kept.length,
        undecidable: verdict.undecidable.length,
        skipped: '',
    };
}
/**
 * ★ 默认装载：**动态 import + `pluginRoot()` 的运行时路径**
 *   （与 `loadFrictionTriageModule` 同一种做法）。
 *
 * ★ 为什么必须动态：`scripts/` **在 `tsconfig` 的 `rootDir: src` 之外**
 *   ⇒ 静态 `import '../../scripts/worktree-reclaim.mjs'` 会让 `tsc` 报
 *   "not under rootDir"。★ 而这条路径**跟着安装走**（`pluginRoot()` 是宿主交出的
 *   插件根），所以打包/搬目录之后仍然成立。
 *
 * ★★ 为什么**不** spawn `node scripts/worktree-reclaim.mjs --apply`：
 *   那个 CLI 会把**整棵** `.agent-teams/worktrees/` 扫一遍并真删 ——
 *   它会删掉**别的**任务的树（包括正在跑的那个团队自己）。
 *   ⇒ 这里只要那个**纯函数**，一个字节的删除动作都从这条 import 里拿不到。
 */
async function loadWorktreeReclaimModule() {
    const target = pathToFileURL(join(pluginRoot(), 'scripts', 'worktree-reclaim.mjs')).href;
    return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ target));
}
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, clock, runtime, scheduler, config) {
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
                        /**
                         * ── ★★★ 这条命令失败的【是哪几条测试】—— 而它让"新增失败"可判定 ────────
                         *
                         * MEASURED（2026-10-10，`verifier` 在 t40 上逐环查出）：
                         *   此 schema 是 `additionalProperties: false` 且**不含** `failures`
                         *   ⇒ ★ 就算成员想如实交出"哪几条红了"，也会【在建参数那一刻被拒】。
                         *   ⇒ 于是 t19 那条判据（"新增失败 vs 仓库存量红"）永远拿到 `undefined`
                         *     ⇒ 永远 `undecidable` ⇒ ★ **17 条任务仍然不可达 completed**。
                         *
                         * ★ 所以它是 t19 生效的【必要一环】，而不是可选的补充字段。
                         */
                        failures: { type: 'array', items: { type: 'string' } },
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
                    /**
                     * ── ★★★ t39：这里【只】声明 `completion_input_surface` ──────────────────────
                     *
                     * ★ t14 当时它挂**两格**位置名（`dispatch_input_surface` /
                     *   `completion_input_surface`），因为它是**唯一**穿过两个位置的工具。
                     *
                     * ★★ 而 t39 之后它**只穿过一个位置**（`completion`）——
                     *   `dispatch` 的求值搬到了 `create_task`（真正的派发那一刻）。
                     *   ⇒ ★ 所以我从这一格拿掉了 `dispatchInputSurface: true`。
                     *
                     * ── 而拿掉它，正是【本文件自己上面那条规则】要求的 ─────────────────────────
                     *
                     * ★ 逐字（它本来说的是 `input_surface`）：
                     *   「它**不挂**泛用的 `input_surface`：成功路径上这个工具从不产出它
                     *     ⇒ schema 也不许声明它，否则"这个工具会返回这个字段"与"它从来不返回"
                     *     在**声明面**同形 —— 而那正是本任务要消灭的形状。」
                     *   ⇒ ★★ 同一条规则，换一个字段：`dispatch_input_surface` 现在
                     *     **成功路径上永不产出** ⇒ 它也不许被声明。
                     *
                     * ★ 而抓到这件事的是 `gate-tool-output-schema` 的**对账臂**（臂 4）：
                     *   实测它报「`agent_teams_update_task`: 源码产出面里有
                     *   `dispatch_input_surface`，而参考表没登记它」—— ⇒ ★ 两个方向都查，
                     *   所以"表比源码宽"与"表比源码窄"都不会漏。
                     *
                     * ★ 而拒绝路径上边界**仍会**补一个泛用名（`input_surface`），
                     *   但那次调用已经失败了，走的是 `error` 而不是工具结果值 —— 与 t14 同。
                     */
                    ...diagnosticFields({ runtimeGates: true, completionInputSurface: true }),
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
                /**
                 * ── ★★★ t70：dispatch 那一整段已搬到 `./update-task/dispatch.ts` ────────────
                 * ★ 搬运**逐字**：`gate-update-task-injections` 逐条断言那 4 格注入仍在、
                 *   且**右侧表达式逐字相同**（★ 那条护栏第一次实战就抓到我改了右侧）。
                 */
                /**
                 * ── ★★★ t39：`dispatch` 只在【成员真的开工】那一刻求值 ───────────────────────
                 *
                 * 用户原话（这条规则存在的理由，逐字）：
                 *   「带 `reviewed` ⇒ 放行；不带 ⇒ **派发【前】必须先审一遍**」
                 *
                 * ★★ 而"派发前"是**一个时刻**，不是一个状态 —— 本队的注册表把它定义得很清楚
                 *   （`INSERTION_POINTS`，逐字）：
                 *     `'dispatch'  // ② 派发前（成员开工）`
                 *
                 * ── 而本处此前【无条件】求值它 ⇒ 每一次 update_task 都过这道门 ──────────────────
                 *
                 * MEASURED（t10 实测，两次重跑逐条相同）：
                 *   ```
                 *   基线    : 1181 tests / 1124 pass / 21 fail
                 *   接线后  : 1181 tests / 1103 pass / 42 fail
                 *   ★ 11 条新增红，报错逐字同一个 `update_task rejected: [dispatch.plan-reviewed] …`
                 *   ```
                 * ★ 而那 11 条拦的是【完成任务】与【夹具造的任务】—— 它们根本不在派发那一刻。
                 *
                 * ★★★ 而它的一般形式（本队今晚第五次，与 t4 同族）：
                 * > **一条本意是"提醒"的规则，若落在【所有人都经过的求值点上】，
                 * >   而它的默认状态在真实语料里是绝大多数 ⇒ 那么它的默认状态就成了【拒绝】。**
                 *   ⇒ 本队 **39 条任务里 0 条**带 `reviewed` ⇒ "没审"是默认状态 ⇒ 每一次
                 *     状态转换都被拒。**判据没有错，落点错了。**
                 *
                 * ── ★ 修的是【求值点】，不是【规则】────────────────────────────────────────────
                 *
                 * ★ 判据那一半【一个字没动】：不带 `reviewed` 仍然 `blocked`，仍然拦得住。
                 *   ⇒ 变的只是【它在哪一刻被问】。
                 *
                 * ★★ 而"成员开工那一刻"在本工具里就是 `args.status === 'in_progress'`：
                 *   `update_task` 的状态取值是 `in_progress / completed / failed / cancelled`，
                 *   而后三者都是【收口】—— 一个已完成 / 已失败 / 已取消的任务**不在派发那一刻**。
                 *
                 * ★ 而【没换状态】的那次调用（只改 output / verdict）也不求值它：
                 *   那是一次**汇报**，不是一次派发。⇒ 这正是本任务开头那 11 条误拒的成因。
                 *
                 * ★★★ 而边界：这里**不放弃**求值 —— 它只是**不再无条件**。
                 *   条件成立时，下面那段拒绝逻辑逐字照旧（`blockers` 仍然拒）。
                 */
                /**
                 * ── ★★★ 而修法是【把 `dispatch` 从 `update_task` 整个拿走】────────────────────
                 *
                 * ★ 我第一版收窄到 `args.status === 'in_progress'`（"成员开工"）—— 而那是**错的**，
                 *   理由是可核的：本队把一个任务交给成员，发生在 **`kickTeam`** 那一刻
                 *   （`create_task` 建完后调它，见那个文件里的 `await scheduler.kickTeam(...)`）。
                 *   ⇒ 而 `update_task(status='in_progress')` 是**成员报到说"我开工了"** ——
                 *     那是【成员→队长】的汇报，不是【队长→成员】的派发。
                 *
                 * ★★ 所以 `update_task` 里**没有任何一次**是"派发那一刻"：
                 *   `in_progress` 是报到、`completed` / `failed` 是收口、`cancelled` 是撤销。
                 *   ⇒ ★ 而用户那条规则问的是【派发前审过了吗】⇒ 它该问在派发的那一侧。
                 *
                 * ★★★ 而"这次调用不在派发那一刻"必须【可读】——
                 *   所以这里不是"跳过一次判据"，而是【这个工具不承载那个插入点】。
                 *   ⇒ 下面 `dispatchEvaluated` 为假时，整段既不求值、不拒绝、也不告警。
                 *
                 * ★ 而"那一半没被放宽"由 `create_task` 侧承接（见那里的接线）：
                 *   一个**真正被派发**而没有 `reviewed` 的任务仍然被拦。
                 */
                /**
                 * ★★ 注意：这里【不再有任何 `dispatch` 的局部量】。
                 *   我先留过 `dispatchWiring/Context/InputSurface/Gates = undefined` 四个占位 ——
                 *   而它们是**有代价的**：`gate-index-assembly` 的调用点扫描器按
                 *   `const (\w*[Dd]ispatch\w*) = … inputSurfaceOf(` 找出口，
                 *   ⇒ ★ 它会找到 `dispatchInputSurface` 这个名字，然后去找
                 *     `dispatchInputSurface.missing`（缺格日志的锚），而那个日志已经搬走了
                 *     ⇒ 于是它报「dispatch 位置不再写缺格日志了」。
                 *   ⇒ ★ 一个恒为 `undefined` 的占位量，会让"这个位置还在这里"看起来成立。
                 *     ★ 删掉它（连同下游那处 `void dispatchInputSurface`），而不是留着。
                 */
                /**
                 * ── ★ runtime 位置（跨步骤的过程约束，契约 §5）───────────────────────────
                 *
                 * 成员开始干活 + 改契约/建任务之后，把"这一步发生过"交给 runtime 判据。
                 * ★ 它返回任何裁决都【不得阻止流程】—— 上面 dispatch 位置的拒绝逻辑在本
                 *   调用点之后照常执行，本调用点对控制流零影响。理由见 `evaluateRuntimeGates`。
                 */
                /**
                 * ── ★★★ t39：这里【不再传 `updateGate`】──────────────────────────────────────
                 *
                 * ★ 它此前传的是 `dispatchGates` —— 而那个求值**已经搬到 `create_task`** 了
                 *   （`update_task` 的四种状态没有一次是派发）。⇒ 这一格在此**没有来源**。
                 *
                 * ★★ 而"没有来源"的正确处理是【整格缺席】，不是传一个 `undefined` ——
                 *   依据是本文件/本机制自己那条逐字的口径（`evaluateRuntimeGates` 上方）：
                 *   > 「★★ 读不到 ⇒ `wait` **整个字段缺席**，绝不是 `{}` 或半份观察。」
                 *   ⇒ ★ 同一条纪律：一个恒为 `undefined` 的注入格会让
                 *     "这个位置在这里"与"这个位置走了"在读数上同形。
                 *
                 * ★ 而下面 :961 那一处（`task-update-settled`）**仍然传** `completionGates` ——
                 *   因为 `completion` 那个位置**还在 `update_task` 上**（它没有搬）。
                 *   ⇒ 两处不同形是【对的】：它们承载的位置不同了。
                 *
                 * ★ 而"没人读它"这件事我核过：`grep -rn updateGate src/gates/` = 空，
                 *   而 `runtime/liveness` 的 `requires` 是 `['event', 'waits']` —— 不含它。
                 *   ⇒ 所以省略它**不改任何裁决**，只去掉一个误导性的在场。
                 */
                let runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update', {
                    team: fresh,
                    task,
                    update: { status: args.status, output: args.output, verdict: args.verdict },
                    wantsCompleted: args.status === 'completed',
                }, clock);
                /**
                 * ── ★★ t14：三态，且 `skippedAll` 是判据 —— 与 `delivery.ts:118-130` 逐字同形 ──
                 *
                 * MEASURED（t13 实测撞上）：`ok:false` 有**两种**成因，而本处此前只读
                 * `ok === false` 就拒绝 ⇒ 全跳过那一支落进 `blockers.join('; ')` ⇒
                 * `[]` 拼出空串 ⇒ **抛出一句没有谓语的拒绝**：
                 *
                 *     update_task rejected:            ← ★ 拒绝后面是空的
                 *
                 * ★ 而成因是 t58 把全跳过从 `ok:true` 翻成了 `ok:false`（那是对的：
                 *   "没被检查"不该读成"通过了"）。但**调用方**把它读成了"被拒绝" ——
                 *   于是每一次「这个位置这一轮没有适用判据」（**正常情形**）都变成了假拒绝。
                 *
                 * ⇒ 正确的形状不是"把空串填上内容"，而是**整个拒绝逻辑都不进**：
                 *   一个安全约束**不触发**时，应当放行并留下"它没被检查"的痕迹，
                 *   而不是拒绝一切（`delivery.ts:96-100` 记的正是同一条）。
                 *
                 *     notChecked = ok:false && skippedAll 在场  ⇒ **放行** + warn（不拒绝）
                 *     ok:true                                    ⇒ 放行，不告警
                 *     blockers / unmeasured                      ⇒ 拒绝（下面的分支不变）
                 *
                 * ★ `unmeasured`（判据跑了、说测不了）**仍然拒绝** —— 它与全跳过的差别是
                 *   `evaluated`：① 是 0（一条都没跑），`unmeasured` 是 >= 1。两者不同形。
                 *
                 * ★ 为什么判据用 `skippedAll` 而不是 `evaluated === 0`：后者在**空位置**
                 *   （`registered === 0`）上也成立，而那是"这里本来就没有判据"，是正常情形。
                 *   `skippedAll` 才是注册表**显式**说的"这一步没被检查"。
                 */
                /**
                 * ── ★★★ "这一步没能被检查"有两种成因，而【两种都不该是拒绝】（t42）──────────
                 *
                 * MEASURED（2026-10-09，`verifier` 在 t5 上给出【两个终态的拒绝原文】）：
                 *   ```
                 *   completed ⇒ rejected: the completion gate could not measure (…)
                 *   failed    ⇒ rejected: ★ 同一条，逐字相同
                 *   ```
                 *   ⇒ ★ 而那条判据**在自己的措辞里**写着 "so it is reported rather than refused"。
                 *   ⇒ 判据说"我是报告，不是拒绝"，而调用方读成了"rejected"。
                 *
                 * ★★ 两种成因（而旧代码只认第一种）：
                 *   · `skippedAll` —— 一条判据都没跑（"这里本来就没检查"）
                 *   · `unmeasured` —— 跑了而**这一步测不成**（"我试了，测不出来"）
                 *   ⇒ ★ 两者都是「我没能检查」，而不是「我检查了而它不行」。
                 *
                 * ★★★ 而"我检查了而它不行"是 `blockers` —— ★ 只有那一种才拒。
                 *   与 `delivery.ts:96-100` 的口径**逐字同源**：
                 *   「一个安全约束【不触发】时，应当【放行】并留下痕迹，而不是拒绝。」
                 */
                /**
                 * ── ★★ t39：`undefined` 在这里【不是】"没被检查" ───────────────────────────────
                 *
                 * ★ `dispatchGates === undefined` 的唯一成因是【这一步不在派发那一刻】
                 *   （上面 `reachesDispatch` 为假）—— 而那是**正确的跳过**，
                 *   不是"我试着检查而检查不了"。
                 *
                 * ★★ 所以它不落 `dispatchNotChecked` 那一支（那是给"跑了而没测成"准备的），
                 *   而是**整段不求值**：既不拒绝、也不告警。
                 *   ⇒ ★ 给它发一条"没能被检查"的告警会让每一次状态更新都留一条噪音，
                 *     而那会把"派发这一步没到"读成"派发这一步检查失败了" —— 两者不同形。
                 */
                /**
                 * ── ★★★ t39：`dispatch` 那一整段求值【从这里拿走了】────────────────────────────
                 *
                 * ★ 而这里【不再有任何】拒绝逻辑 —— 不是"放宽了判据"，是**这个工具不承载
                 *   那个插入点**（判据与它的三态一个字没动，见 `create_task` 侧的新接线）。
                 *
                 * ── 为什么 `update_task` 从来不是"派发那一刻"（逐条可核）─────────────────────
                 *
                 *   交活给成员发生在 **`kickTeam`**：`create_task` 建完后调它
                 *     ⇒ ★ 那是【队长 → 成员】的那一下。
                 *   `update_task` 的四种状态**各是另一件事**：
                 *     `in_progress`  ⇒ ★ 成员**报到**说"我开工了"（成员 → 队长）
                 *     `completed`    ⇒ 收口（成员 → 队长）
                 *     `failed`       ⇒ 收口
                 *     `cancelled`    ⇒ 撤销
                 *   ⇒ ★ 四次都不是派发。
                 *
                 * ── 而"无条件求值"的代价（t10 实测，两次重跑逐条相同）────────────────────────
                 *
                 *   ```
                 *   基线    : 1181 tests / 1124 pass / 21 fail
                 *   接线后  : 1181 tests / 1103 pass / 42 fail
                 *   ★ 11 条新增红，逐字都是 `update_task rejected: [dispatch.plan-reviewed] …`
                 *   ```
                 *   ★ 而它们拦的是【完成任务】与【夹具造的任务】。
                 *
                 * ★★ 一般形式（本队今晚第五次，与 t4 同族）：
                 * > 一条本意是"提醒"的规则，若落在【所有人都经过的求值点上】，
                 * > 而它的默认状态在真实语料里是绝大多数 ⇒ 那么它的默认状态就成了【拒绝】。
                 *   ⇒ 本队 39 条任务里 0 条带 `reviewed` ⇒ "没审"是默认 ⇒ 每一次状态转换都被拒。
                 *
                 * ── ★★ 而"没被检查"与"检查了而它不行"在这里**都不再需要**分辨 ──────────────────
                 *
                 * ★ t42 那段（`dispatchNotChecked` + 两态成因）在此**整体不再适用**，因为
                 *   这里已经没有任何 `dispatchGates` 可读。它没有丢 —— 它随插入点一起
                 *   搬到了 `create_task` 侧（那里现在才是那个位置唯一的求值处）。
                 *
                 * ★ 而本处下游那段【输入面缺格只说、不拒】的逻辑仍在，且仍以
                 *   `dispatchInputSurface` 为条件 —— 而它现在是 `undefined`
                 *   ⇒ ★ 那一条分支自然不跑（correct by construction），而不是被开关关掉。
                 */
                /**
                 * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬）。它放在上面的拒绝逻辑【之后】，
                 *   不是为了顺序好看：放在之前会让"核对报缺"看起来像拒绝的理由，
                 *   而本机制的裁决权是零。措辞与判据的 `unmeasured` 不同形 ——
                 *   那是"判据测不了"，这是"调用方没把这一格交出去"。
                 *
                 * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
                 *   `input_surface` 里（`dispatchInputSurface`）。两条并存，缺一不可。
                 */
                /**
                 * ── ★ 注入面：让每条判据拿到它声明的输入（缺则缺席，不注入空值）─────────
                 *
                 * 每一项都只做【读】。拿不到 ⇒ 该字段不出现在 ctx 里 ⇒ 判据自己说
                 * "我没能测量"。**绝不在这里替判据决定"那就算通过"。**
                 */
                const changedFiles = input.changedPaths ?? task.changedPaths ?? [];
                /**
                 * ★ t18：这里与 `baseline` 用**同一个解析**（内存 → 落盘 → 明确没有）。
                 *   理由：`parentRevision` 喂给 R5（红前绿后），它与回测问的是同一件事
                 *   ——"改动之前的那个版本是什么"。两处若用不同来源，会出现
                 *   「R5 说父版本是 A、回测说基线是 B」这种自相矛盾，而它在日志里同形。
                 */
                const baseResolutionForLines = resolveBaseRevision(task);
                const worktreeBase = baseResolutionForLines.kind === 'resolved' ? baseResolutionForLines.revision : undefined;
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
                 * ── ★★ 判别力证据：把 t31 的修法接到真实路径（t33 / f-0020 的最后一格）─────
                 *
                 * ── 缺口是什么（integrator6 报，captain 核实）─────────────────────────────
                 *
                 * `repairEvidenceFiles` / `repairCompletionVerdict`（`quality-gates.ts`）
                 * 修好了一件事：**repair 的判别力证据来自"改动过的既有夹具"，而不是"新增的测试"**
                 * —— 对 repair 而言后者恒为空集，于是 r5 恒报
                 * `none of the 0 reported file(s)` ⇒ **恒 unmeasured ⇒ repair 永远交不出终态**。
                 *
                 * ★ 但那两个函数**零调用方**（除它们自己的夹具外）。integrator6 的原话：
                 *   「**一个没有调用方的修法，与没有修法在观测上完全相同。**」
                 *   ⇒ 它把缺口如实写成臂 9，而不是用"夹具 10/10 绿"冒充已修好。
                 *
                 * ── 接线的口径（**不是**"让 r5 变宽松"）──────────────────────────────────
                 *
                 * 判据问的仍然是同一个问题：「**这条夹具还能不能抓住缺陷**」。
                 * 变的只是**拿哪些文件去问**：
                 *
                 *     旧：本次【新增】的测试文件  ⇒ 对 repair 恒空 ⇒ 恒 unmeasured
                 *     新：本次【改动过的既有夹具】⇒ repair 的真实证据 ⇒ 可测量
                 *
                 * ★ 而"装饰性测试"这一路**一步都没让**：一条恒绿的既有夹具同样过不了 r5
                 *   （它在父版本上就绿 ⇒ `decorative test` 拒绝）。见夹具臂 3 与臂 4。
                 *
                 * ── 三态：与 `newTestFiles` 同一纪律 ──────────────────────────────────────
                 *
                 * ★ 只在【非终态 → completed】时给出（与 `execVerifyCommand` / `newTestFiles`
                 *   的既有先例一致）—— 否则"成员开始干活"那一步也会被"红前绿后"审判。
                 *
                 * ★★ 但它**不**以"会话观察到了写入"为条件 —— 这一点是本任务的要害（t33 实测）：
                 *
                 *   `repairEvidenceFiles` 读的是**任务契约**（`update.changedPaths` /
                 *   `task.changedPaths`），**不是**会话事件。⇒ 会话观察缺席时它照样答得出来，
                 *   而那**正是** f-0020 的场景：repair 的净改动落在既有夹具上，
                 *   而"这个成员写过它"这件事未必在会话事件里。
                 *
                 *   MEASURED（t33 第一版写错了）：我原先把它 guard 在
                 *   `observedFiles === undefined` 上 ⇒ 与 `newTestFiles` **同一个条件**
                 *   ⇒ 两者一起为空 ⇒ r5 仍报 "none of the 0 reported file(s)"
                 *   ⇒ **接线等于没接**（定向突变实测：去掉接线后臂照样绿）。
                 *   ★ 形态：把新口径挂到旧口径的闸门上，于是它继承了旧口径的盲区。
                 */
                const repairEvidence = args.status !== 'completed'
                    ? undefined
                    : repairCompletionVerdict({
                        task: { id: task.id, kind: task.kind, inScope: task.inScope, changedPaths: changedFiles },
                        update: {
                            changedPaths: input.changedPaths,
                            ...observedTestFiles === undefined ? {} : { newTestFiles: observedTestFiles },
                        },
                    });
                /**
                 * ★ 把两格**合并**成 r5 要的那一格，且合并规则是刻意的：
                 *   · `newTestFiles` 是"本次观察到的测试写入"（既有口径，**保留**）；
                 *   · `repairEvidence` 是"改动过的既有夹具里**还能判别**的那些"（新增口径）。
                 *   ⇒ 取**并集**并排序。取交集会让任一侧单独成立的情形丢失；
                 *     只取后者会让 implementation 类的既有行为改变（那不是本任务该动的）。
                 *
                 * ★ 而 `repairEvidenceFiles` **本身**已做筛选（是测试夹具、落在写域里、
                 *   去重排序），所以这里不再筛第二遍 —— 两处筛选会慢慢分叉，而分叉之后
                 *   "r5 看到的文件"与"quality-gates 认为的证据"不再同形。
                 */
                const discriminatingFiles = repairEvidence === undefined || repairEvidence.ok === false
                    ? newTestFiles
                    : observedTestFiles === undefined
                        ? repairEvidence.evidence
                        : [...new Set([...observedTestFiles, ...repairEvidence.evidence])].sort();
                /**
                 * ★ `repairEvidence.ok === false` 时**不把它并进拒绝**：它是 unmeasured
                 *   （"没能测量"），而本调用点的裁决由 r5/mutation 自己说 ——
                 *   在这里抢先拒绝会让"没测到"伪装成"发现了问题"（反向的同一类错误）。
                 */
                if (repairEvidence !== undefined && repairEvidence.ok === false) {
                    ctx.logger.warn(`agent-teams: repair completion evidence is unmeasured (recorded, not rejected): ${repairEvidence.unmeasured}`);
                }
                /**
                 * ── ★★★ t67：`killerSuites` 的文件清单 = 两条供给链的并集 ─────────────────
                 *
                 * MEASURED（本任务复现）：t54 之后，`discriminatingFiles` 的唯一消费者
                 * （r5）对 repair 不再生效 ⇒ 那条证据**没人读**；而 mutation（repair
                 * **要求**的门）读的 `killerSuites` 此前只来自 **会话事件**。
                 * 于是在 f-0020 那个形状里（会话观察缺席）：
                 *
                 *     repairEvidence  从**任务契约**读出了那份夹具 ⇒ 喂给 newTestFiles ⇒ 没人读
                 *     observedTestFiles 缺席                        ⇒ killerSuites 不注入 ⇒ mutation 空手
                 *
                 * ⇒ 证据落在没人读的那一格，而**该读它的那一格**空着。
                 *
                 * ── 三态，且**与原来那条纪律逐条对齐** ──────────────────────────────────
                 *
                 *   `undefined` —— ★ 两条链**都没能观察**（会话读不到 **且** 契约没给出）
                 *                  ⇒ 不注入 ⇒ mutation 自己报 unmeasured。**不猜、不回退到全套。**
                 *   `[]`        —— 两条链都观察到了、**确实没有**可用的套件
                 *                  ⇒ 不注入（理由同上：空清单不是"用一个空集去杀变异体"）
                 *   `[...]`     —— 并集，去重排序
                 *
                 * ★ 而"两条链都没能观察"与"确实没有"在这里**同形地被处理**（都不注入）——
                 *   那不是合流：判据那一侧对"没注入"给出的**是同一句话**（unmeasured），
                 *   而它是对的那句话（这两种情形下它都确实没有可杀的东西）。
                 *   ★ 真正的合流风险在**别处**，本任务把它留在它的原处：
                 *     `repairEvidence.ok === false` 的两种成因（没能观察 / 观察到了、确实没有）
                 *     在 `repairCompletionVerdict` 里是**两句不同的话**，而上面那条 warn 照旧打出。
                 */
                const killerSuiteFiles = observedTestFiles === undefined && (repairEvidence === undefined || repairEvidence.ok === false)
                    ? undefined
                    : [...new Set([
                            ...(observedTestFiles ?? []),
                            ...(repairEvidence !== undefined && repairEvidence.ok === true ? repairEvidence.evidence : []),
                        ])].sort();
                /**
                 * ── ★★★ t67：把"这份证据有没有人读"变成一条**可读的**读数 ─────────────────
                 *
                 * MEASURED：`discriminatingFiles` 被生产出来、而 t54 之后它在 repair 上
                 * **没有消费者** —— 而那是**沉默的**：没有任何一行日志会说这件事。
                 * ⇒ 下一个会话只会看到 `repairEvidence.ok === true`，然后以为一切正常。
                 *
                 * ★ 所以这里在**生产出证据的那一刻**问一次"谁会读它"，并把
                 *   `produced`（生产了、没人读）**记下来**。
                 *
                 * ★★ 而它**不拒绝任何东西**：证据没人读 ≠ 任务做错了（契约明说
                 *   "不会阻断任何任务"）。⇒ 它只 `warn` 一行，与上面那条 unmeasured 的
                 *   warn 同一形状。★ 把"没人读"当拒绝会让**每一个 repair 任务**都失败 ——
                 *   那是把一条**读数**当成了裁决。
                 *
                 * ★ 而这正是它要修的那件事的字面落点：**第二种状态必须可读**。
                 */
                if (discriminatingFiles !== undefined && discriminatingFiles.length > 0) {
                    const reading = traceEvidenceConsumer('newTestFiles', requiredGateIdsFor(task.kind));
                    if (reading.status === 'produced') {
                        ctx.logger.warn(`agent-teams: repair discriminating evidence was produced (${discriminatingFiles.length} file(s)) `
                            + `but nothing consumes it on kind=${task.kind ?? 'work'}: ${reading.detail}. `
                            + 'Recorded, not rejected — produced-and-unconsumed is a supply/consumer fact, not a failure of the work.');
                    }
                }
                /**
                 * ── ★★★ t70：completion 那一整段（271 行）已搬到
                 *    `./update-task/completion.ts` ─────────────────────────────────────────
                 *
                 * ★ 搬运**逐字**被钉住：`gate-update-task-injections` 逐条断言拆前那 17 格
                 *   注入仍在对的位置、且**右侧表达式逐字相同**。
                 *   MEASURED：那条护栏第一次实战就抓到了我自己（我把 dispatch 的
                 *   `changedPaths: input.changedPaths` 顺手改成了 `[...input.changedPaths]`）。
                 *   ⇒ **丢的不是格名，而是格的右侧。**
                 *
                 * ★ 而本段的边界是**数出来的**（271 行：从 `baselineExit` 到求值），
                 *   不是"看着像哪儿断了就在哪儿断"。
                 */
                const completionWiring = await wireCompletion({
                    workspace, task, input, args, changedFiles, changedLines,
                    discriminatingFiles, worktreeBase, repairEvidence, findings,
                    acceptanceResults, commandsRun, newTestFiles, observedTestFiles,
                    killerSuiteFiles, gate: evaluateQualityCompletion, resolveBaseRevision,
                    deriveScanDirs, loadKindRequirementsSync, registry,
                });
                const completionContext = completionWiring.context;
                const completionInputSurface = completionWiring.inputSurface;
                const completionGates = completionWiring.gates;
                /** ★ `wantsCompleted` 在段内算出、而段外还要用 ⇒ 由模块交出来。 */
                const wantsCompleted = completionWiring.wantsCompleted;
                /**
                 * ── ★★★ 2026-10-12：预算停止与变异恢复，必须【在日志里露头】───────────────
                 *
                 * ★ 这两条都是**基础设施**的事实，不是任何成员的工作结论。不报的话：
                 *   · 预算停止 ⇒ 判据报 unmeasured ⇒ 与"这些命令都超时了"同形，
                 *     而两者补救动作相反（调预算 / 查为什么慢 vs 去看代码）；
                 *   · 恢复发生 ⇒ 说明**上一次**崩在了就地变异中途，而这件事在
                 *     `team.json` 与会话里**一个字都没有**。
                 */
                const completionBudget = completionWiring.budget;
                if (completionBudget.exhausted) {
                    ctx.logger.warn(`agent-teams: the completion chain for task "${task.id}" hit its `
                        + `${Math.round(completionBudget.totalMs / 1000)}s wall-clock budget after ${completionBudget.calls} command(s) `
                        + `(${Math.round(completionBudget.elapsedMs / 1000)}s elapsed, stopped on: ${completionBudget.exhaustedBy.join(' | ') || 'n/a'}). `
                        + `The gates that could not run will report "could not measure" — that is a BUDGET stop, NOT a failing test.`);
                }
                const mutationRecovery = completionWiring.mutationRecovery;
                if (mutationRecovery !== undefined && mutationRecovery.restored.length > 0) {
                    ctx.logger.warn(`agent-teams: restored ${mutationRecovery.restored.length} file(s) that this task's mutation run left in a mutated state: `
                        + `${mutationRecovery.restored.join(', ')} — byte-for-byte back to their pre-mutation content`);
                }
                if (mutationRecovery !== undefined && (mutationRecovery.conflicts.length > 0 || mutationRecovery.failed.length > 0)) {
                    ctx.logger.error(`agent-teams: the mutation journal for task "${task.id}" could not be fully recovered — `
                        + `conflicts: ${mutationRecovery.conflicts.map((item) => item.file).join(', ') || 'none'}; `
                        + `failed: ${mutationRecovery.failed.map((item) => item.file).join(', ') || 'none'}. `
                        + `Those files were left EXACTLY as found, because rolling a conflict back would discard real work.`);
                }
                /**
                 * ── ★ t13 的运行时出口：有判据、却一条都没跑 ────────────────────────────
                 *
                 * ★★ t14：这条告警**已被下面的 `completionNotChecked` 取代** —— 见那里。
                 *   它此前用 `evaluated === 0 && registered > 0`，而那正是 t14 要消灭的那个
                 *   判据的"近似版"：它与 `skippedAll` 在**生产路径上**等价，但**在空位置以外的
                 *   场合不同形**（`registered === 0` 时它也成立，而那是正常情形）。
                 *   ★ 两条告警并存会让同一件事报两遍 —— 而"这两条日志说的是不是同一件事"
                 *     就变成一个要读两处才能回答的问题（`delivery.ts:132-137` 记的是同一条）。
                 */
                /**
                 * ── ★★ t14：三态，且 `skippedAll` 是判据 —— 与 `delivery.ts:118-130` 逐字同形 ──
                 *
                 * 理由与 dispatch 那一处**逐字相同**（见那里的长注释）：`ok:false` 有两种成因，
                 * 而"没被检查"必须**放行 + 留痕**，不是把空串填上内容再拒绝。
                 * ★ 两处逐字同形是刻意的：同一个事实在两个出口上用两句话，它们会随下一次
                 *   改动分叉，而分叉后的两次读数在断言层面同形。
                 */
                /**
                 * ★★★ 与 dispatch 位置**逐字同形**（t42：两处必须同一口径）——
                 *   只修一处会让它们分叉，而分叉后「哪一处放行」在日志里同形。
                 *   ★ 而成因同样是两种：`skippedAll`（一条都没跑）与 `unmeasured`（跑了而测不成）。
                 */
                const completionNotChecked = completionGates.ok === false
                    && (completionGates.skippedAll !== undefined || completionGates.unmeasured !== undefined);
                if (completionNotChecked) {
                    const why = completionGates.unmeasured !== undefined
                        ? `the completion step could not be measured (${completionGates.unmeasured})`
                        : `nothing was evaluated (${completionGates.registered} registered, all skipped)`;
                    ctx.logger.warn(`agent-teams: update_task for task "${task.id}" reached completion and ${why}; the completion step was NOT checked — allowing it through, because "not checked" is not "refused"`);
                }
                /**
                 * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬），放在拒绝逻辑**之前**是因为
                 *   它与下面三个分支讲的不是同一件事，而"这次完成本来会被拒"与"这次完成
                 *   的输入面没接完"必须都能读到 —— 只读到前者会让人以为是判据的结论。
                 *   ★ t14：原来那句「与 t13 那条（`evaluated === 0`）不同形」的对照**已失效** ——
                 *     t13 那条告警已并入上面的 `completionNotChecked`，现在它与**这一条**比：
                 *     那是"判据一条都没跑"（且**已放行**），这是"判据跑了、而它要的某一格
                 *     调用方没交"。两者仍然不同形。
                 *
                 * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
                 *   `input_surface` 里（`completionInputSurface`）。两条并存。
                 */
                if (completionInputSurface !== undefined && completionInputSurface.incomplete > 0) {
                    ctx.logger.warn(`agent-teams: update_task for task "${task.id}" reached completion with an unfinished input surface (recorded, not rejected): ${completionInputSurface.missing.join('; ')}`);
                }
                /**
                 * ★★★ 拒绝逻辑整体包进 `!completionNotChecked &&`。
                 *   与 dispatch 那处同一条纪律：`frictionMessage` 与 `recordFriction(...)`
                 *   **在里面** —— 它们记的是「卡点」，而成因必须是一次**真实的拒绝**。
                 */
                if (!completionNotChecked && completionGates.ok === false) {
                    /**
                     * ★★ t22：在卡点发生的此刻记账。★ 这一处尤其重要 —— 本轮被它拦住的
                     *   次数最多（三道完工门），而事后补的材料恰恰读不出"当时缺的是哪一格"。
                     */
                    /** ★ 同 dispatch 位置：只剩 `blockers` 一种成因（见那里的注释）。 */
                    const frictionMessage = `update_task rejected: ${completionGates.blockers.join('; ')}`;
                    /**
                     * ── ★★★ C1：判「任务停下来了」而不是「判据报错了」───────────────────────
                     *
                     * ★ 位置：**在锁里**，且 `task` 就是权威的那一份 ⇒ 读到的 `task.stall`
                     *   与下面写回去的**同源**（再读一次盘就会读到另一个时刻的事实）。
                     *
                     * ★★ 顺序是刻意的：先 `noteStall`（把这次的次数落盘），再 `recordFriction`
                     *   （按那个次数决定这条记录是哪一类）。反过来会让记录读到**上一次**的
                     *   数字 —— 于是"第二次拒绝"这条记录会说自己是第一次，而卡点永远差一拍。
                     */
                    const stall = noteStall(task, 'completion', gateIdFromMessage(frictionMessage), Date.now());
                    /**
                     * ── ★★★ C1：这一次拒绝的读数必须【当场落盘】—— 否则判据根本不成立 ────────
                     *
                     * MEASURED（本任务第一版就撞了）：`noteStall` 只改了内存里的 `task`，
                     * 而下面的 `throwWithSurface` 会**在 `writeTeam` 之前**抛出去 ⇒
                     * `team.json` 里从来没有 `stall` ⇒ 下一次拒绝读到的仍是 `undefined`
                     * ⇒ **第一次永远判成第一次** ⇒ `stalled` 这个状态**永不可达**。
                     *
                     * ★ 而它是最难发现的一种坏法：`observeStall` 本身是纯函数、单测全绿、
                     *   `recordFriction` 也照常落一条记录 —— 只是**每一条都是 `rejection`**。
                     *   也就是"改动看起来装上了，而行为与改动前逐字相同"（差别只在多了一格字段）。
                     *
                     * ★★ 所以这里显式落盘，且**在抛出之前**：本判据的全部意义就是"跨调用"，
                     *   而跨调用 = 上一次的事实真的在盘上。
                     * ★ 放在锁里（本函数就是锁体）⇒ 与正在写的那一份**同源**，
                     *   不会与别人的并发改动互相覆盖。
                     */
                    await writeTeam(stateRoot, fresh);
                    void recordFriction({
                        stateRoot,
                        point: 'completion',
                        message: frictionMessage,
                        context: completionContext,
                        mechanismState: { inputSurface: completionInputSurface, gates: completionGates },
                        stall,
                        session: caller.session,
                        taskId: task.id,
                        teamId: team.id,
                        tool: 'agent_teams_update_task',
                        /**
                         * ★★★ t91：这条是**自动记录**的 —— 本分支就是拒绝路径。
                         *   ⇒ 它没有 resolution.state 是设计如此（判据拒绝的那一下没人做过决定）。
                         *   ★ 而声明它让分诊器把它从「台账待回填」里分出去 ——
                         *     否则那个数字把"不需要回填"与"还没回填"算成同一类。
                         */
                        auto: {
                            tool: 'agent_teams_update_task',
                            point: 'completion',
                            ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) },
                        },
                        ...completionGates.unmeasured === undefined ? {} : { couldNotObserve: [String(completionGates.unmeasured)] },
                    }).then((id) => {
                        if (id === undefined)
                            ctx.logger.warn(`agent-teams: could not record the friction at the completion gate (${frictionMessage})`);
                    });
                    if (completionGates.unmeasured !== undefined) {
                        /**
                         * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
                         *   看出"判据没能测量"，而不是"判据发现了问题"。
                         */
                        throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface');
                    }
                    throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface');
                }
                /**
                 * 判据【通过时】交出的产出：把判据层亲眼看到的 exitCode 并回 commandsRun，
                 * 让落盘的是它看到的那个，而不是成员自报的。
                 */
                /**
                 * ── ★★★ C1：放行 ⇒ 忘掉那条 stall（与上面 `noteStall` **成对**）───────────
                 *
                 * ★ 不清它的后果是**单向**的：一条已经是 `stalled` 的记录留着，下一次
                 *   拒绝会读到 `count = 3 ≥ 2` ⇒ **第一次**拒绝就被判成卡点
                 *   ⇒ 于是每个任务最终都会变成卡点，而那正是本任务要消灭的
                 *   「把 82% 的事件算成卡点」的**计数版本**。
                 *
                 * ★ 位置：放在这里（判据放行之后、`evaluateQualityCompletion` 之前）——
                 *   它记的是「**这道门**放行了」这个事实，而不是"整条 update 成功"。
                 *   放在更后面会让后面任何一条拒绝都留下一个过期的 stall。
                 */
                clearStall(task);
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
                /**
                 * ── ★★★ t19：这一次执行发生了 ⇒ **记进历史**（有序、只追加）─────────────────
                 *
                 * 用户的原话（本格存在的理由）：
                 *   「一个收敛的循环，在用户眼里读成一串互不相干的红色失败」。
                 *
                 * ── ★★ 位置是刻意的：**在 `task.status` 已经落定之后** ──────────────────────
                 *
                 * ★ 若放在赋值**之前**，元素里记的就是**上一个**状态 —— 于是每一条历史
                 *   都比事实**晚一步**，而"它失败过两次然后通过了"这句话会读成
                 *   "它失败过三次"（收敛的那一次被记成前一次的重复）。
                 *   （与 C1 的 `noteStall` 必须排在 `recordFriction` 之前是同一条纪律，
                 *     只是方向相反：那里要的是**这一次**的次数，这里要的是**这一次**的结果。）
                 *
                 * ── ★ 为什么**只有落了终态**才追加 ─────────────────────────────────────────
                 *
                 * 一次 `in_progress` 的中间更新**不是一次执行** —— 它没有结论。
                 * ⇒ 若也记，历史里会塞满"还在跑"的元素，而"跑了几次"这个问句就废了
                 *   （它会等于"更新了几次"）。★ 判据是 `TERMINAL_TASK_STATUSES`。
                 *
                 * ── ★★ 而 `cancelled` 也记 ────────────────────────────────────────────────
                 *
                 * 一条被中止的任务**确实跑到过终态**，而"它被中止了、没通过"是一个
                 * 与"它还在跑"不同形的事实。⇒ 它进历史；读取端从 `status` 读得出它是中止。
                 */
                if (args.status !== undefined && TERMINAL_TASK_STATUSES.includes(args.status)) {
                    appendExecution(task, {
                        at: Date.now(),
                        /** ★ 与 `TeamTask.attempt` 同一套编号；缺省 0（还没开始任何一代）。 */
                        attempt: task.attempt ?? 0,
                        ...task.attemptId === undefined ? {} : { attemptId: task.attemptId },
                        status: task.status,
                        /**
                         * ★★ `round` / `verdict` / `failureKind` **抄进历史**，而不是让读取端
                         *   去读 `TeamTask` 上那一格 —— 因为那几格是**单值**，会被下一轮覆盖。
                         *   ⇒ 不同步抄的话，"第 1 轮是 needs_revision"这件事下一轮就没了，
                         *     而"它失败过两次然后通过"正是要靠这几格才读得出来。
                         */
                        ...task.round === undefined ? {} : { round: task.round },
                        ...task.verdict === undefined ? {} : { verdict: task.verdict },
                        /**
                         * ★ 成因分类用**既有的那一份**（`failureKindOf`），不在这里重算 ——
                         *   与 t12 的 status 出口**同源**，于是"这条失败是哪一种"只有一个答案。
                         * ★ 只在 `failed` 上算：其余终态没有"失败成因"可言（`failureKindOf`
                         *   对非 failed 任务给的是缺省，抄进来会是一条**假事实**）。
                         */
                        ...task.status === 'failed' ? { failureKind: failureKindOf(task) } : {},
                        ...identity.name === undefined ? {} : { by: identity.name },
                    });
                }
                /**
                 * ── ★★★ 落终态时，把 worktree 上的改动【提交】成一个 commit ──────────────
                 *
                 * MEASURED（2026-10-10）：在此之前本插件**只建树、不提交** ——
                 * 46 棵 worktree 里目标文件一个都没有（worktree 是 checkout 产物，
                 * 只含已提交内容）。⇒ integrator **没有东西可合**，
                 * 「合并 ≥2 棵 worktree」在机制上无法成立。
                 *
                 * ── ★ 为什么落在这里（而不是成员自己提交）────────────────────────────────
                 *
                 * ① 成员**不知道**自己那棵树的绝对路径 —— 它只知道提示里那一行；
                 * ② "提交"是**记账动作**，与 attempt 的归属绑在一起 ——
                 *    那正是 `update_task` 这一层已有的东西（`task.attemptId`）；
                 * ③ 放在这里 ⇒ **不需要改成员人格**（成员照常只报 changedPaths），
                 *    产物自动获得载体。
                 *
                 * ── ★★ 三条可靠性约束 ────────────────────────────────────────────────────
                 *
                 * · **只有终态才提交**：in_progress 时提交会让"中途快照"与"交付"同形；
                 * · **失败不改判**：提交失败**不许**把一次合格的交付变成失败（那是两回事）
                 *   ⇒ 它只记进日志与 `deliveryFailure`，任务状态照旧；
                 * · **树不存在就跳过**：review/requirements 这类 kind 不建树
                 *   ⇒ 路径不存在 ⇒ 什么都不做，且不产出任何"我试过了"的读数。
                 *
                 * ── ★★ 路径从哪来（这一格是实测逼出来的）──────────────────────────────────
                 *
                 * MEASURED：`task.worktreePath` **不存在于 `TeamTask`** —— 它只活在
                 * 派发那一刻的内存 ticket 里，从未写进 `team.json`。
                 * ⇒ 本层**拿不到**它（第一版这么写，typecheck 当场报 TS2339）。
                 *
                 * ★ 而它**不需要**被持久化：`createTaskWorktree` 的命名是确定的
                 *   （`<repo>/.agent-teams/worktrees/task-<safeId>`）⇒ **可推导**。
                 *   推导比持久化更稳：少一份会漂移的拷贝（本仓记账过多次的形态）。
                 */
                const landedTerminal = args.status !== undefined
                    && TERMINAL_TASK_STATUSES.includes(args.status)
                    && args.status !== 'cancelled';
                if (landedTerminal) {
                    /**
                     * ★ 路径必须用【同一个函数】算 —— `worktreeDirName` 是建树与找树
                     *   共用的那一份真值。两处各写一遍会在团队前缀那一位上分叉
                     *   （而分叉的表现是"找不到树"，与"这条任务本来就不建树"同形）。
                     */
                    const worktree = join(workspace, '.agent-teams', 'worktrees', worktreeDirName(fresh.id, task.id));
                    /**
                     * ── ★★★ 不建树的那一半【也要留读数】（2026-10-10 实测补的）─────────────
                     *
                     * MEASURED（由 e2e-worker 在 t1 上抓到，而它是对的）：
                     *   本分支此前是裸的 `if (existsSync(...)) { … }` —— **条件为假时整段静默**：
                     *   不产 commit，也**不产任何读数**。
                     *
                     * ★★ 而"这条任务本来就不建树"与"该建树而没建成"在**读数上完全同形** ——
                     *    两者都是"没有 commit、没有日志、没有字段"。而处置完全相反：
                     *      · 前者（`work` / `review` / `requirements`）⇒ **设计如此**，什么都不做；
                     *      · 后者（`implementation` 却没有树）⇒ ★ 一个**真缺陷**，去查为什么没建。
                     *
                     * ⇒ 所以判据必须是 `needsWorktreeFor(task.kind)`（**应当**有树吗），
                     *   而**不是**"路径在不在"（实际有树吗）—— 后者把设计当成了故障。
                     *
                     * ★ kind 列表来自 `types.ts` 的单一来源，不在这里再写一份。
                     */
                    const shouldHaveWorktree = needsWorktreeFor(task.kind);
                    if (existsSync(join(worktree, '.git'))) {
                        const committed = commitWorktree({
                            worktree,
                            taskId: task.id,
                            ...task.attemptId === undefined ? {} : { attemptId: task.attemptId },
                            ...identity.name === undefined ? {} : { author: identity.name },
                        });
                        if (committed.ok === true && committed.commit !== undefined) {
                            /** ★ 提交 id 落进任务记录 ⇒「这个产物在哪」是**可追溯**的。 */
                            task.deliverableCommit = committed.commit;
                            ctx.logger.info(`agent-teams: task "${task.id}" deliverable committed as ${committed.commit} `
                                + `(${committed.filesChanged} file(s)) in ${worktree}`);
                        }
                        else if (committed.ok === true) {
                            /** 没有改动 ⇒ 不产出空 commit。这也是一个**结论**，要能读出来。 */
                            ctx.logger.info(`agent-teams: task "${task.id}" had no worktree changes to commit`);
                        }
                        else {
                            /**
                             * ★ 提交失败**不改判**，而它**不静默**。
                             *   一次合格的交付不该因为记账失败而变成 failed ——
                             *   把前者读成后者，会让成员去重做已经做对的工作。
                             */
                            ctx.logger.warn(`agent-teams: could not commit the worktree for task "${task.id}": ${committed.reason}`);
                            task.deliveryFailure = {
                                at: Date.now(),
                                attempt: task.attempt ?? 1,
                                reason: `worktree commit failed: ${committed.reason}`,
                            };
                        }
                        /**
                         * ── ★★★★★ 每一次终态转换都判一次这棵树 —— **与"这次提交成了没有"无关** ────
                         *
                         * ── ★★★ 为什么它【不能】住在上面那三支里的任何一支（round-1 的 blocker）──
                         *
                         * MEASURED（reviewer 用 `reviewer-1/sequence.mjs` 与 `reviewer-1/refire.mjs`
                         *   两次实测，而 round-1 的实现确实是这样 —— 本条修复直接针对它）：
                         *
                         *   ① `commitWorktree` **只在 worktree 里**提交，它**从不**合进 `main`。
                         *      ⇒ 提交刚成功的那一刻，那棵树的 HEAD 是一个**全新**的 commit，
                         *        按定义**不是** `main` 的祖先 ⇒ 权威判据必然答 `keep / not-absorbed`。
                         *      ⇒ ★ 把回收挂在"提交成功"那一支上，等于把入口设在了
                         *        **唯一一个判据必然说"不"的时刻** ⇒ **删除在生产上不可达**。
                         *        （round-1 的夹具臂 12 之所以能绿，只因为它注入了一个 `post-commit`
                         *          钩子去**替 integrator 做合流** —— 而那是**产品从不做**的一步。
                         *          ★ 那条臂现在仍在，但它已被降级为"模拟**后续阶段**"，
                         *            而**发射**由无钩子的臂 15 证明。）
                         *
                         *   ② 而**唯一可达**的那种"已吸收"形状，恰恰是**没有新改动**的那一次
                         *      （`committed.commit === undefined`）：产物早先已被 integrator 合流，
                         *      而这次终态转换本来就没有东西要提交。
                         *      ⇒ ★ 藏在 `committed.commit !== undefined` 里 ⇒ 它也**永远走不到**。
                         *
                         * ⇒ 所以入口条件是：**树在 ⇒ 就判它**。
                         *   ★ 而"能不能删"**仍然只由 `judgeWorktree` 说** —— 本层一行 git 都不跑，
                         *     也**不**新增第二条判据（那正是本任务要消灭的形态）。
                         *
                         * ── ★★ 于是"今天不删"是一个**正确的中间态**，不是失效 ──────────────────
                         *
                         * 产物刚交付、还没合流 ⇒ 判据答 `keep / not-absorbed` ⇒ **今天不删**。
                         * 而这条接线在**下一次**这条任务落终态时会**再判一次** ——
                         * 那时 integrator 已经把那个 commit 合进 `main` ⇒ 判据答 `reclaimable`
                         * ⇒ **那一次**才删。
                         * ★ 这正是权威实现写在文件头的那条纪律：「判据不是『任务已终态』，
                         *   而是『产物已被主树吸收』」。⇒ 判据说留就留，重判是**下一次**的事。
                         *   MEASURED（臂 15）：一个**已合流**的树在落终态时被真的删掉；
                         *   而**没有**任何夹具注入的合流步骤参与那一臂。
                         *
                         * ── ★ 它**不改判**（这一格 round-1 通过了，不许回退）──────────────────
                         *
                         * 回收失败与交付失败是两件事：`reclaimWorktreeAfterDelivery` 只记日志，
                         * 这里**不** catch、**不**写 `deliveryFailure`、**不**动 `task.status`。
                         * ★ 而它的返回**不进任何字段**：读数是**日志**，
                         *   任务的真相仍然只有 `task` 那一份（改了它会与别处的记账分叉）。
                         */
                        const reclaimed = await reclaimWorktreeAfterDelivery({
                            worktree,
                            repo: workspace,
                            taskId: task.id,
                            status: String(args.status),
                            /**
                             * ★ 把"这一轮提交成了没有"如实交出去 —— 它**只影响日志措辞**
                             *   （"刚交付"与"没有新改动，只是重判"是两种不同的情形），
                             *   **绝不**影响能不能删：那件事只有 `judgeWorktree` 说了算。
                             */
                            commitOutcome: committed.ok === true
                                ? committed.commit === undefined ? 'nothing-to-commit' : 'committed'
                                : 'commit-failed',
                            logger: ctx.logger,
                        });
                        /** ★ 显式 `void` 掉：它只用于上面那一行的日志，**不进**任务记录（见上）。 */
                        void reclaimed;
                    }
                    else if (shouldHaveWorktree) {
                        /**
                         * ── ★★★ 该建树而树不在 ⇒ 这是一个【真缺陷】，不是"不需要"───────────────
                         *
                         * 与上面那支（本来就不该建树）**必须不同形** ——
                         * 否则"设计如此"会把"建树失败"永久盖住。
                         *
                         * ★ 而它同样**不改判**：任务是不是合格由判据说了算，
                         *   一次记账环境的问题不该把合格的交付变成 failed。
                         *   但它必须**可读**（日志 + `deliveryFailure`），否则没人会去查。
                         */
                        ctx.logger.warn(`agent-teams: task "${task.id}" is kind="${task.kind ?? 'work'}" (which should have an '
                + 'isolated worktree) but its worktree is missing at ${worktree}; `
                            + 'its deliverable could not be committed and cannot be reached by an integrator');
                        task.deliveryFailure = {
                            at: Date.now(),
                            attempt: task.attempt ?? 1,
                            reason: `no isolated worktree at ${worktree} for kind "${task.kind ?? 'work'}", so the deliverable was not committed (there is nothing for an integrator to merge)`,
                        };
                    }
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
                 * ── ★★★★★ 终态转换是**唯一**必然发生的时刻 ⇒ 在这里扫一遍已终态的任务（defect 2）──
                 *
                 * ── 它补的是上一段那根线的**缺口** ────────────────────────────────────────
                 *
                 * 逐任务那条回收（上面的 `reclaimWorktreeAfterDelivery`）只判**这条**任务、
                 * 且只在它落终态的那一刻判。而它答 `keep / not-absorbed` 时**自己就写着**
                 * "将在**下一次**终态转换时重判"。
                 *
                 * ★★ 而对一条**已经**终态、此后不再被更新的任务，那个"下一次"**永远不会来**：
                 *   没有更新 ⇒ 没有终态转换 ⇒ 没有任何时刻会重判它 ⇒ 一棵产物早已被合流
                 *   进主干的树**永久**留在盘上。这与"任务已终态"是两件事 ——
                 *   判据仍然是「产物已被吸收」，变的只是"谁在什么时刻去问它"。
                 *
                 * ── ★ 为什么**必须**落在这里（`writeTeam` 之后）────────────────────────────
                 *
                 * 判据读的是**盘上**的 `team.json` 吗？不是 —— 它读的是**git**。
                 * 但"这条任务已终态"这件事是**本工具刚写下去的**，而扫描的输入就是它。
                 * ⇒ 放在 `writeTeam` **之前**会让"扫描看到的世界"与"落盘的世界"不一致
                 *   （一次崩溃之后，日志里说扫过、而盘上那条任务还没落终态）。
                 *   ⇒ 所以：**先落盘，再扫描**。
                 *
                 * ── ★★ 它【只】在终态转换时跑 ────────────────────────────────────────────────
                 *
                 * 一次全扫要判**每一条**终态任务的树（每条判据都是几次 git 查询）——
                 * 挂在**每一次** `update_task` 上会让一个高频动作变成一次全仓扫。
                 * ★ 而"刚刚发生了一次终态转换"正是**必然会发生**的那个时刻：
                 *   它是这件事被触发的唯一天然时机（与文件头那条"自动化必须挂在必然发生的
                 *   时刻"逐字一致）。
                 *
                 * ── ★★ 它【不】影响本工具的返回值，也【不】改任何任务记录 ────────────────────
                 *
                 * `void` 掉读数（与上面 `reclaimWorktreeAfterDelivery` 同一写法）；
                 * 传的是 `fresh.tasks`（**已落盘**的那一份，不是调用前那份）；
                 * 而它自己保证不抛、不写 `task.status` / `task.deliveryFailure`。
                 * ★ 少一样，一次清理就会变成一次**改判** —— 那是本仓记过的那类最贵的浪费。
                 */
                if (landedTerminal) {
                    /**
                     * ── ★★★ 回收扫描**不许挂在完成路径上** ──────────────────────────────────
                     *
                     * MEASURED（本仓实测）：这一扫要 **19.6 秒**（29 棵 worktree × 约 37 个
                     * git 子进程 —— `execFileSync` 是**同步**的），而它原来写的是
                     * `const scan = await reclaimTerminalWorktrees(…)` 紧跟一句 `void scan`。
                     *
                     * ★ 那个 `void` 是**症状**：写它的人**想要**"发了就不管"，而 `await`
                     *   让它在**返回之前**跑完。`void` 在这里没有任何作用 —— 一个 `await`
                     *   过的值再 `void`，只是把一句"我本想异步"的意图留在了代码里。
                     *
                     * ★ 后果就是用户看到的那一幕：`complete` / `update_task` **卡住十几秒**
                     *   甚至更久，而 **team.json 早就写完了**。调用方以为失败、去重试，
                     *   而每次重试**再付一次 19.6 秒** ⇒ 看起来就是"卡在 complete 上"。
                     *   ★ 而它还持有团队的写锁窗口，所以别的成员一起被拖慢。
                     *
                     * ★ 处置：**真的**不阻塞 —— 扫描在后台跑，完成路径立刻返回。
                     *   它本来就不产出完成所必需的任何读数（唯一的消费是那句 `void scan`），
                     *   所以推迟它**不改变任何裁决**，只改变"谁等谁"。
                     *   ★ 而失败必须**被记下来**而不是被吞掉：一个静默失败的后台任务
                     *     与"没有后台任务"同形，那正是本仓反复记过的形态。
                     */
                    const scanTask = reclaimTerminalWorktrees({
                        repo: workspace,
                        tasks: fresh.tasks,
                        teamId: fresh.id,
                        logger: ctx.logger,
                    });
                    void scanTask.catch((error) => {
                        ctx.logger?.warn?.(`agent-teams: background terminal-worktree scan failed for team "${fresh.id}" — nothing was deleted: ${describeError(error)}`);
                    });
                }
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
                     *
                     * ★★ t39：这里【去掉了 `dispatch_input_surface`】那一行 ——
                     *   它此前是 `...dispatchInputSurface === undefined ? {} : …`，而
                     *   `dispatchInputSurface` 现在是恒 `undefined`（求值搬走了）
                     *   ⇒ ★ 那一行**永远展开成 `{}`** ⇒ 它是一行**死代码**。
                     *   ⇒ 而"一行永远不会产出的代码"与"一行产出对了的代码"在读数上同形
                     *     ⇒ ★ 删掉它，而不是留着（留着会让下一个人以为这个工具仍产出那一格）。
                     */
                    ...completionInputSurface === undefined ? {} : { completion_input_surface: completionInputSurface },
                };
            });
            if (followUpMessage !== undefined) {
                /**
                 * ── ★★★ 这一段会抛，而抛在**写入之后** ────────────────────────────────────
                 *
                 * MEASURED（本仓实测，十几次）：`ctx.agents.get(...)` 在这里抛
                 *   `cannot get required service "agents" in inactive context`
                 * 而**紧接着的落盘已经完成**。于是调用方看到"失败"，去重试，
                 * 而重试**又成功又失败**，来回几次之后整轮就卡在 complete 上。
                 *
                 * ★ 机制在 host 的 cordis（`lib/index.js:688`）：取值器沿 fiber 树往上找，
                 *   而 `fiber.store` **只在 fiber 处于 active 时存在**。本插件在顶层
                 *   `inject` 里声明了 `agents`（`src/index.ts:56`），所以当**本处理器所属的
                 *   fiber 已经不在运行时**，取值器走到"我自己就声明了它"这一支 ⇒ 当场抛，
                 *   **不再往上找**。
                 *
                 * ★ 而更关键的是**为什么它有时不抛**：本处理器**先**返回结果、**后**执行这一段。
                 *   会话结束与这段代码谁先谁后，决定了这一次是成功还是抛错 —— 而**产物已经交付**。
                 *   ⇒ 一句"失败"里混着"没做"与"做了但回执丢了"两件事，而调用方无法分辨。
                 *
                 * ★ 处置：把这次读取**降级成可选**（见 `readCaptainSession`）。它做的事是
                 *   "把跟进消息顺手推给队长"—— 是**尽力而为的投递**，不是这次终态转换的判据。
                 *   读不到就**跳过**，并把"没投递"如实记进日志，**绝不让它把一次已经落盘的
                 *   完成判成失败**。消息本身仍在邮箱里（下一条 status 会看到），没有事实丢失。
                 */
                const captain = readCaptainSession(ctx, team.captainSessionId);
                if (captain !== undefined && steerCaptainReport(captain, CAPTAIN_KEY, followUpMessage.content, mailboxPrompt(team.id, CAPTAIN_KEY, [followUpMessage]))) {
                    await withTeamLock(teamLockKey(stateRoot, team.id), () => markMailboxDelivered(stateRoot, team.id, CAPTAIN_KEY, [followUpMessage.id]));
                }
                else if (captain === undefined) {
                    ctx.logger?.info?.(`agent-teams: follow-up steer for team "${team.id}" was NOT delivered — the captain session could not be read in this context `
                        + '(cannot get required service "agents" in inactive context). The completion itself HAS landed; the message is still in the mailbox '
                        + 'and will be delivered by the next status read. This is a delivery miss, not a completion failure.');
                }
            }
            await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined);
            return updated;
        },
    })));
}
