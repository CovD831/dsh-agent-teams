/**
 * ── 判据：声明的工作必须【真的】落在 worktree 里，且没落到主检出 ─────────────────
 *
 * 插入点：`dispatch`（成员即将开工 / 即将以完成态汇报时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05，本机复现）：worktree 此前是【提示】而不是机制 ——
 * `src/scheduler.ts` 的 `kickMember` 在 `needsWorktree` 的 kind 上建失败时
 * 只 `logger.warn` 一句就照常派发：
 *
 *     ctx.logger.warn(`... no isolated worktree for task "t1" (...); the member
 *                      will work in the shared workspace`)
 *     ⇒ 成员于是【在共享工作区里干活】—— 这是唯一能让工作落到主树的入口。
 *
 * ★ 本判据检查的是【运行时的另一侧】：即使派发环节说了"该在 worktree 里"，
 *   也【没有人核对】成员的工作是否真的到了那里。机制化（拒绝派发）堵住了入口，
 *   本判据给出可核对的到达证据 —— 两者是不同的失效，缺一不可。
 *
 * ── 最窄形式：检查【声明路径】，不是"worktree 脏了" ────────────────────────────
 *
 * MEASURED 的设计取舍：一个成员【可以合法地】在 worktree 里留下未声明的文件
 * （草稿、临时输出、跑测试时生成的快照）。若判据因为"目录不整洁"就拒绝，
 * 守卫会立刻教会读者忽略它 —— 那正是我们要避免的失效。
 *
 * ⇒ 判据只问【两件最窄的事】：
 *     ① 声明的每条路径，在工作目录里【存在】吗；
 *     ② 同一条路径，在【主检出】里也出现吗（工作落到主树正是要堵的洞）。
 *
 * ── 三态，且 null 既不并进 false 也不并进 true ─────────────────────────────────
 *
 * `landed` 恰好是三值（契约 §2 的性质 3）：
 *
 *     landed: true   ⇒ 全部声明路径都在工作目录、且都不在主树        ⇒ ok
 *     landed: false  ⇒ 有路径没到达，或有路径落到了主树              ⇒ blocked（被伪造/没到达）
 *     landed: null   ⇒ 读不到该工作目录（没建出来 / EACCES / git 抖动）⇒ unmeasured
 *
 * ★ 为什么 "读不到" 不能当成 `false`：git 抖动会让一次读取失败伪装成
 *   "成员把工作落在主树了" —— 一个关于【代码在哪】的结论，是由一次 I/O 失败
 *   编出来的。那是把基础设施故障伪装成违规。
 * ★ 为什么 "读不到" 更不能当成 `true`：那等于【认证一份没人看过的工作】——
 *   判据会为它没测量过的到达背书，比没装更坏。
 *
 * ── 依赖按需注入（★ 复制品，不用只读锁，不用软链）──────────────────────────────
 *
 * worktree 是干净的检出，gitignore 的 `node_modules` 不在里面（实测边界③）。
 * 成员要在里面跑验证命令，就得有依赖。三条路的实测结论：
 *
 *   · 软链（symlink）  ⇒ **会被写穿**：在 worktree 里 `pnpm install` 会顺着链
 *                        改到主检出的 node_modules。复制品没这个问题。
 *   · 只读锁（lockfile/权限）⇒ 不能防写穿，只会让成员换一种方式失败。
 *   · 复制品（copy）   ⇒ 代价是磁盘，换来的是【两个仓库真的互不影响】。
 *
 * ⇒ `src/worktree.ts` 的 `provisionWorktreeDependencies` 只做复制；本判据不
 *   关心它怎么复制（判据是纯数据变换，I/O 由调用方注入）。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O（`../registry.ts` 会被打包进同一份
 *    lib，但那是裁决构造器，不是 I/O）。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */
import { blocked, unmeasured } from "../registry.js";
export const id = 'dispatch.worktree';
export const point = 'dispatch';
export const description = '核对声明的工作是否真的落在隔离 worktree 里、且没落到主检出；读不到 worktree 即"未测量"（防止隔离退化成提示）';
/**
 * 只对【声明了 changedPaths 的 implementation/repair】任务生效。
 *
 * ★ 与 `dispatch.changed-paths` 同一组条件，理由也同源：
 *   · 没声明 changedPaths ⇒ 没有可核对的东西；
 *   · 只有这两类 kind 的契约要求填 changedPaths。
 * ★ 无 worktree 路径时【不】在这里返回 false：那会让"没有隔离"看起来像
 *   "不需要隔离"。是否测量由 `gate` 用 unmeasured 表达。
 */
export function appliesTo(ctx) {
    const kind = ctx?.task?.kind;
    if (kind !== 'implementation' && kind !== 'repair')
        return false;
    return Array.isArray(ctx?.update?.changedPaths) && ctx.update.changedPaths.length > 0;
}
/** 声明路径的规整：只做比较，不做裁决（非法形状交给 dispatch.changed-paths）。 */
function declared(paths) {
    const out = [];
    for (const raw of paths) {
        if (typeof raw !== 'string')
            continue;
        const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
        if (trimmed === '' || trimmed.startsWith('/') || trimmed.split('/').includes('..'))
            continue;
        if (!out.includes(trimmed))
            out.push(trimmed);
    }
    return out;
}
export function gate(ctx) {
    const declaredPaths = declared(ctx?.update?.changedPaths ?? []);
    /**
     * ★ 没有隔离要求 ⇒ 这条判据【不适用】。
     *   返回 ok 而不是 unmeasured：它要说的不是"我测不了"，是"这里没有要测的东西"。
     *   （与 `verify-rerun` 的 `appliesTo` 同一套语义。）
     */
    if (typeof ctx?.worktreePath !== 'string' || ctx.worktreePath.trim() === '') {
        return { ok: true, landed: null, skipped: 'no worktree was declared for this task (either the kind does not need one, or dispatch was refused before isolation)' };
    }
    const arrival = ctx?.arrival;
    if (arrival === undefined || typeof arrival !== 'object') {
        return unmeasured(`no arrival probe was injected, so the ${declaredPaths.length} declared path(s) could not be located in the worktree ${ctx.worktreePath} (nor ruled out of the main checkout)`);
    }
    /**
     * ★ 读不到 worktree ⇒ `unmeasured`，【不是】 blocked。
     *   一次读取失败（worktree 被清掉、EACCES、git 抖动）不是"工作落到了主树"。
     */
    if (arrival.worktreeReadable !== true) {
        const note = (arrival.notes ?? []).join('; ');
        return unmeasured(`the worktree ${ctx.worktreePath} could not be read${note === '' ? '' : ` (${note})`}, so whether the ${declaredPaths.length} declared path(s) landed there is unknown — this is "not measured", not "did not land"`);
    }
    const absent = new Set(arrival.absentInWorktree ?? []);
    const missed = declaredPaths.filter((path) => absent.has(path));
    const blockers = [];
    for (const path of missed) {
        blockers.push(`"${path}" was declared as work for task "${ctx?.task?.id ?? '?'}" but does not exist in the task worktree ${ctx.worktreePath} (the work never arrived there)`);
    }
    /**
     * ★ 到达 = 工作到了 worktree **且** 没到主检出。
     *
     * ★ 为什么"落到主树"的读数【即使有 missed 也要算】：两条读数来自两个不同的
     *   观察面（worktree 的文件系统 / 主检出的索引），一次运行里可以【同时为真】
     *   —— 成员在主树里干了一部分、在 worktree 里什么也没留下，正是最该被看见的
     *   形态。只报前一条会把"这是怎么发生的"藏起来（注册表会把两条 blocker 都收集，
     *   所以这里是"一次给全"，与契约 §3 的不短路同源）。
     *
     * ★ 两个方向都必须有【自己的】读数：worktree 读得到、主检出读不到 ⇒ 现在也
     *   不能声称"没落到主树"，那是没有证据的通过 ⇒ 未测量。
     */
    if (arrival.mainReadable !== true) {
        if (blockers.length > 0)
            return blocked(blockers);
        const note = (arrival.notes ?? []).join('; ');
        return unmeasured(`the ${declaredPaths.length} declared path(s) are present in the worktree, but the main checkout ${ctx.workspace ?? '(unknown)'} could not be read${note === '' ? '' : ` (${note})`}, so "the work did not land in the main checkout" cannot be certified`);
    }
    const leaked = declaredPaths.filter((path) => (arrival.presentInMain ?? []).includes(path));
    for (const path of leaked) {
        blockers.push(`"${path}" is declared as work for task "${ctx?.task?.id ?? '?'}" but it also exists in the main checkout ${ctx.workspace ?? '(unknown)'} — the work landed in the shared workspace instead of the isolated worktree`);
    }
    if (blockers.length > 0)
        return blocked(blockers);
    /**
     * ★ 通过时也交出产出：让调用方能把【判据层亲眼看到的到达结论】落进记录，
     *   而不是只留"派发时说了一句"（与 changed-paths / verify-rerun 交回产出同构）。
     */
    return { ok: true, landed: true, arrivedIn: ctx.worktreePath, declaredPaths };
}
