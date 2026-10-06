/**
 * ── 判据：成员自报的 changedPaths 必须与【它会话里真实发生过的写入】对得上 ──────────
 *
 * 插入点：`dispatch`（成员即将开工 / 即将以完成态汇报时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05，本机复现）：`changedPaths` 是【成员自己填的一串字符串】。
 * 上游只校验它的【形状】（是否 workspace 相对、是否落在 inScope/outOfScope 内），
 * 从不校验它是否对应【任何真实发生过的写入】。实测：
 *
 *     零真实工作 + 自报 changedPaths:['src/a.ts','src/b.ts']
 *       ⇒ evaluateQualityCompletion 返回 {"ok": true}      ← 漏洞
 *     classifyChangedPath('src/a.ts', ['src/'])  ⇒  'in_scope'  ← 只问"它算不算数"
 *
 * ⇒ 一个成员可以零工作、自报一组漂亮的 inScope 路径，而判据层无从分辨。
 *   这与 `completion.verify-rerun` 堵住的那个洞【同源】：把判据的输入交给被判的一方。
 *
 * ★ 它不是 verify-rerun 的重复：verify-rerun 问「命令真的跑了吗」，
 *   本判据问「文件真的是这个成员动的吗」。一个成员可以真跑命令、却虚报改动清单。
 *
 * ── 归属证据从哪来（★ 这也是它不需要 worktree 的原因）──────────────────────────
 *
 * `dsh-tool-fs` 给每次写入/编辑的 `tool/result` 挂 `meta.diffs`：
 *
 *     meta.diffs: Array<{ path: string, oldText: string|null, newText: string }>
 *
 * （已从 app.asar 抽出该包源码核实：`isFileDiff` 要求 `path: string`；
 *   `diffsFromMeta` 校验数组非空且每项合法 —— 形状是实测的，不是猜的。）
 *
 * 而这些事件可以由插件【已有的】入口 `sessionOwnEvents(memberAgent.session)` 读到
 * （`src/harness-compat.ts` 已在用同一入口读 subagent descriptor）。
 *
 * ⇒ 归因走【会话事件】，不走 cwd ⇒ **绕开 START-HERE §5②「子会话 cwd 硬编码继承父会话」
 *   这条已知约束**，也不需要 worktree 及其两个坑（gitignore 夹具、未提交的工作）。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O。调用方把【观察到的事实】传进来；
 *    缺席时返回 `unmeasured`（★ 不是 `ok`）—— 没能观察就不能声称它诚实。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */
import { blocked, unmeasured } from "../registry.js";
import { normalizeWorkspacePath } from "../../quality-gates.js";
export const id = 'dispatch.changed-paths';
export const point = 'dispatch';
export const description = '把成员自报的 changedPaths 与它会话里观察到的真实写入比对；虚报或隐瞒即拒绝（防止伪造改动清单）';
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 本判据的输入【不是 ctx 上的一个普通字段】，而是【调用方注入的一次观察】：
 *   它要的不是"ctx 里有个 diff 数组"，而是"有人真的去看过这个成员的会话"。
 *   这两件事不同形 —— 前者是字段在场，后者是**观察真的发生过**。
 *
 * `observedChangedPaths` 由 `src/tools.ts` 用 `observedChangedPaths(caller.session)`
 * 从 `tool/result` 的 `meta.diffs[].path` 折叠出来，**调用方自己去看了**才有值。
 * 队长代报（caller 是队长）时拿不到成员会话 ⇒ 这一格缺席 ⇒ 判据 unmeasured。
 *
 * ★ 三条共同声明 `task.kind` 的理由：`appliesTo` 读的就是它（见下），
 *   声明出来之后，核对层至少能把"要审一份改动清单，而这条 ctx 不知道是什么 kind"
 *   这种自相矛盾报出来 —— 否则那件事与"这一轮本来不适用"在返回里同形。
 */
/**
 * ── ★ 每一格都与本判据的一条 `unmeasured` 臂逐条对齐 ────────────────────────────
 *
 * 判据说「缺 X 就 unmeasured」，X 就必须出现在这里。本判据的未测量臂只有一条：
 *
 *     `observedChangedPaths` 不是数组 ⇒ "the member's write history could not be
 *                                        observed (no session events were available)"
 *
 * ⇒ 声明 `observedChangedPaths`（`gate()` 那道 `Array.isArray` 闸门读的就是它）。
 *
 * ★ 而 `task.kind` / `update.changedPaths` **不进 requires**，这不是省事，是刻意的：
 *   它们缺席时 `appliesTo` 为假 ⇒ 注册表直接跳过这条判据（`status: 'skipped'`），
 *   `gate()` 根本不会被调用。"这一轮没有要审的东西"与"我要审、但它没接上"
 *   是两件事，合成一件会让每一次 review/work 类的派发都产出一份缺格清单 ——
 *   而噪音会教人忽略门禁（requires.ts 的闸门那一节）。
 *
 *   两处的边界因此是：**appliesTo 管"说不说话"，requires 管"说话时缺不缺输入"。**
 *   一条判据的 requires 里列上门的那几格，等于把"不适用"也报成"缺输入"。
 *
 * ★ 认的是那条【注入的观察】在场，不是它的形状：`[]` 也算在场 ——
 *   "观察了、确实没有写入"与"没能观察"必须不同形（见文件头 ② 与夹具臂 2）。
 */
export const requires = ['observedChangedPaths'];
/**
 * 只对【声明了 changedPaths】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来：
 *   · 没声明 changedPaths ⇒ 没有可核对的东西（work/review 等类别本就不填它）；
 *   · 只有 implementation/repair 的契约要求 changedPaths（见 scheduler 的派发提示），
 *     对其余类别做核对会把"本就不该填"误判成"漏报"。
 *
 * ★ 这两格**不进 `requires`**，是刻意的：它们缺席时本函数为假 ⇒ 注册表跳过这条
 *   判据 ⇒ "这条判据这一轮不说话"，与"它说话了、但输入面缺一格"不同形。
 *   把闸门声明进 requires 会让每一次不适用的调用都产出一份缺格清单 —— 噪音。
 *   （`appliesTo` 的三格与 `requires` 的一格必须在**语义上**对齐：闸门管说话与否，
 *     requires 管说话时缺不缺输入。）
 */
export function appliesTo(ctx) {
    const kind = ctx?.task?.kind;
    if (kind !== 'implementation' && kind !== 'repair')
        return false;
    return Array.isArray(ctx?.update?.changedPaths) && ctx.update.changedPaths.length > 0;
}
/** 把一组路径规整成一个可比较的集合；非法路径单独交出来（不静默丢弃）。 */
function bucket(paths) {
    const legal = new Set();
    const illegal = [];
    for (const path of paths) {
        const normalized = normalizeWorkspacePath(path);
        if (normalized === undefined)
            illegal.push(path);
        else
            legal.add(normalized);
    }
    return { legal, illegal };
}
export function gate(ctx) {
    const observed = ctx?.observedChangedPaths;
    /**
     * ★ 没能拿到观察 ⇒ `unmeasured`，不是 `ok`。
     *   一个无法观察的判据如果返回 ok，就是"装上了但从不生效"——比没装更坏，
     *   因为它会让人以为核对过了。
     */
    if (!Array.isArray(observed)) {
        return unmeasured(`the member's write history could not be observed (no session events were available), so the ${ctx?.update?.changedPaths?.length ?? 0} reported changedPaths could not be checked against reality`);
    }
    const reported = bucket(ctx?.update?.changedPaths ?? []);
    const seen = bucket(observed);
    const fabricated = [...reported.legal].filter((path) => !seen.legal.has(path));
    const concealed = [...seen.legal].filter((path) => !reported.legal.has(path));
    const blockers = [];
    for (const path of fabricated) {
        blockers.push(`"${path}" was reported as changed but no write to it was ever observed in this member's session`);
    }
    for (const path of concealed) {
        blockers.push(`"${path}" was observed as changed in this member's session but was not reported (not reported)`);
    }
    // ★ 非法路径仍要报：它是"无法审计的路径"，这正是上游拒绝它的理由（START-HERE §5①）。
    for (const path of reported.illegal) {
        blockers.push(`"${path}" is not a workspace-relative path (absolute paths and ".." can never match scope patterns)`);
    }
    if (blockers.length > 0)
        return blocked(blockers);
    /**
     * ★ 通过时也交出产出：让调用方能把【判据层亲眼核对的集合】落进记录，
     *   而不是只留成员填的那一份（与 verify-rerun 交回 reruns 同构）。
     */
    return { ok: true, verifiedChangedPaths: [...seen.legal] };
}
