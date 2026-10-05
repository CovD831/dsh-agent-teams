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
 * 只对【声明了 changedPaths】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来：
 *   · 没声明 changedPaths ⇒ 没有可核对的东西（work/review 等类别本就不填它）；
 *   · 只有 implementation/repair 的契约要求 changedPaths（见 scheduler 的派发提示），
 *     对其余类别做核对会把"本就不该填"误判成"漏报"。
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
