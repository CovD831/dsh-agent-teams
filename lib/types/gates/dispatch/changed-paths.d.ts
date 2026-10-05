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
import { type GateVerdict } from '../registry.ts';
export declare const id = "dispatch.changed-paths";
export declare const point = "dispatch";
export declare const description = "\u628A\u6210\u5458\u81EA\u62A5\u7684 changedPaths \u4E0E\u5B83\u4F1A\u8BDD\u91CC\u89C2\u5BDF\u5230\u7684\u771F\u5B9E\u5199\u5165\u6BD4\u5BF9\uFF1B\u865A\u62A5\u6216\u9690\u7792\u5373\u62D2\u7EDD\uFF08\u9632\u6B62\u4F2A\u9020\u6539\u52A8\u6E05\u5355\uFF09";
interface ChangedPathsContext {
    task?: {
        id?: string;
        kind?: string;
        inScope?: string[];
        outOfScope?: string[];
    };
    update?: {
        changedPaths?: string[];
    };
    /**
     * ★ 该成员会话里【实际发生过的】写入路径，由调用方从 `tool/result` 的
     *   `meta.diffs[].path` 折叠得到。
     *
     *   `undefined` 与 `[]` 必须不同形：
     *     undefined ⇒ 没能观察（没拿到会话事件）⇒ unmeasured
     *     []        ⇒ 观察了，确实没有写入   ⇒ 可以据此判定"虚报"
     */
    observedChangedPaths?: string[];
}
/**
 * 只对【声明了 changedPaths】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来：
 *   · 没声明 changedPaths ⇒ 没有可核对的东西（work/review 等类别本就不填它）；
 *   · 只有 implementation/repair 的契约要求 changedPaths（见 scheduler 的派发提示），
 *     对其余类别做核对会把"本就不该填"误判成"漏报"。
 */
export declare function appliesTo(ctx: ChangedPathsContext | undefined): boolean;
export declare function gate(ctx: ChangedPathsContext): GateVerdict;
export {};
