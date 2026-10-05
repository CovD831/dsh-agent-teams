/**
 * ── 判据：契约里的 verify 命令【真的可判】吗 ────────────────────────────────────
 *
 * 插入点：`contract`（建任务 / 改契约 —— 契约 §1 ①）
 *
 * ── 它防的是什么失效（MEASURED，2026-10-05）────────────────────────────────────
 *
 * 契约的 `verify` 是【一个命令字符串列表】。任何进了这份清单的命令都必须是
 * **可判的**：它要能因为"工作做出来了"而变成 0，因为"工作没做出来"而变成非 0。
 * 一条做不到这件事的命令会让整个任务无法诚实地完成 —— 而它在清单里看起来
 * 与别的命令一模一样。
 *
 * 本轮实测的形状（START-HERE §6③ 的原话）：
 *
 *     grep -qx 7 <(wc -l < file)
 *
 * `wc -l` 的输出带前导空格（`      7`），而 `grep -x` 要求【整行】匹配 ⇒ 拿
 * `7` 去比 `"      7"` 永远不匹配 ⇒ 这条命令**永远非零**。于是：
 *
 *     · 任务做对了 ⇒ 命令仍然红 ⇒ 成员无法诚实地宣告完成；
 *     · 而它与"我的工作做错了"在退出码上同形 —— 判据层读不出这两者的区别。
 *
 * 更坏的一层：一条【永远失败】的 verify 会让"伪造 completed"成为唯一出路
 * （那正是 `completion.verify-rerun` 堵的洞）。契约本身不可判，会把成员推向
 * 伪造。所以这条判据的位置是 `contract` —— **在建任务那一刻就说**。
 *
 * ── 它问的是【三条】问题，不是一条（同一个失效有三个来源）──────────────────────
 *
 *   ① **空命令**：`"   "` 与 `""` 不是命令。它们跑起来退出码 0（`test -n ''` 为假
 *      会被读成"通过"）—— 于是它给不出任何信息，却占着 verify 清单的一个位置。
 *   ② **永远失败 / 永远成功**：命令里写死了一个不可能满足的匹配，或者它压根不
 *      依赖任何可变的产物（`true` / `false`）。一个字面量常量没有任何可判性。
 *   ③ **目标是过程替换**（`grep -x PATTERN <(…)`）：PATTERN 要去匹配一个**命令的
 *      输出**，而那条输出有没有前导空白取决于它是什么命令 —— 静态不可判。
 *      ★ 这一条正是本次实测的那条命令的形状。它不是一个错别字，是一个**类别**。
 *
 * ── 判据是【纯数据变换】：I/O 由调用方注入 ────────────────────────────────────
 *
 * 本文件不 import 任何 I/O（`scripts/verify-gates-integration.test.mjs` ④ 会逐行
 * 检查 import 子句）。它需要的唯一"实测"是**真的跑一次那条命令**：
 *
 *     ctx.execVerifyCommand?: (command: string) => Promise<number>
 *
 * ★ 注入与不注入的差别不是"多测一点"，而是**结论的性质**：
 *
 *     不注入 ⇒ 静态分析说"这条命令可以变成 0，也可以变成非 0" ⇒ 但没人真的跑过它
 *              ⇒ `unmeasured`。★ 绝不能返回 ok：那等于声称"我验过了"。
 *     注入   ⇒ 真的跑一次，命令与退出码一起给出 ⇒ 这个结论可以被独立复核。
 *
 * 复跑**判定"永远失败"**是真的要跑：一条命令永远非零，只有跑过才知道。
 * 这也是为什么这条判据在【建任务/改契约】那一刻只做一次（见 `appliesTo` 的说明）。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import I/O；要跑命令时由调用方注入执行器。
 * ② 不调用别的判据（`completion.verify-rerun` 也读 verify 清单，但两者不互相调用）。
 * ③ 三态：ok / blocked([原因]) / unmeasured(为什么没测成)，后两者不同形。
 */
import { type GateVerdict } from '../registry.ts';
export declare const id = "contract.verify-command";
export declare const point = "contract";
export declare const description = "\u5951\u7EA6\u91CC\u58F0\u660E\u7684 verify \u547D\u4EE4\u5FC5\u987B\u53EF\u5224\uFF08\u65E2\u80FD\u4E3A\u505A\u5BF9\u7684\u5DE5\u4F5C\u53D8\u7EFF\u3001\u4E5F\u80FD\u4E3A\u505A\u9519\u7684\u5DE5\u4F5C\u53D8\u7EA2\uFF09\uFF1A\u7A7A\u547D\u4EE4\u3001\u5199\u6B7B\u7684\u771F/\u5047\u3001\u4EE5\u53CA\u62FF -x \u53BB\u6BD4\"\u547D\u4EE4\u8F93\u51FA\"\uFF08\u5982 grep -qx N <(wc -l \u2026)\uFF0C\u524D\u5BFC\u7A7A\u683C\u8BA9\u6574\u884C\u5339\u914D\u6C38\u8FDC\u4E0D\u6210\u7ACB\uFF09\u90FD\u4F1A\u5728\u3010\u5EFA\u4EFB\u52A1\u90A3\u4E00\u523B\u3011\u88AB\u8BF4\u6E05\u695A";
/**
 * 这个 id 的另一半用途：**调用方可以按它决定要不要注入执行器**。
 *
 * ★ 为什么把一个判据的 id 导出在这里：`tools.ts` 的注入口径是"缺什么就不注入什么
 *   （而不是注入一个空值）"—— 见 tools.ts 的注入口径一节。要在 create_task /
 *   amend_task 上按需注入，调用方必须能问出"contract 位置有没有一条判据需要跑命令"，
 *   而**注册表不认识判据的名字与语义**（契约 §8），所以能回答这个问题的只有判据自己。
 */
export declare const VERIFY_COMMAND_GATE_ID = "contract.verify-command";
interface VerifyCommandContext {
    /**
     * 待建 / 待改的任务契约。取自 `create_task` 的任务草稿或 `amend_task` 修订后的任务。
     *
     * `verify` **缺席**（非质量类任务、或契约没写 verify）⇒ `unmeasured`：
     * **没拿到清单不等于清单是对的**（与 `contract.build-artifact-scope` 对 inScope
     * 的口径一致）。
     */
    task?: {
        id?: string;
        kind?: string;
        verify?: string[];
    };
    /** true = 建任务，false = 改契约。两者都在契约位置求值。 */
    creating?: boolean;
    /**
     * ★ 真的跑一次这条命令。**可选**：缺席 ⇒ 静态分析照做，但结论降级成 `unmeasured`。
     *
     * 与 `completion.verify-rerun` 的 `execVerifyCommand` 同名同形，因为它们是同一个
     * 执行器（`tools.ts` 的 `runVerifyCommand`）—— 两个位置注入同一个东西，不是两种东西。
     */
    execVerifyCommand?: (command: string) => Promise<number>;
}
export interface VerifyCommandProblem {
    /** 机器可读的原因分类（断言与日志都按它分组，不靠措辞）。 */
    kind: 'empty' | 'always-red' | 'always-green' | 'non-judgeable';
    /** ★ 说清【错在哪】的一句人话：读到它的人必须能自己去复核这条命令。 */
    message: string;
}
/** 拆词（只按空白切；引号里的空白**不**切 —— 一个带空格的模式是一个词）。 */
export declare function shellTokens(command: string): string[];
/**
 * 一条命令的静态问题；没有 ⇒ `undefined`（"看过这条命令，它看起来可判"）。
 *
 * ★ `undefined` 说的是【静态可判性】，不是"它一定通过"。两者不能混：
 *   一条命令看起来可判，但它在当前工作区里到底跑成什么，只有真的跑一次才知道。
 */
export declare function verifyCommandProblems(command: string): VerifyCommandProblem[];
/**
 * 只对【真的带着契约】的上下文生效。
 *
 * ★ `appliesTo` **不**排除"没有 verify"的情形：那正是未测量臂要表达的东西
 *   （拿不到清单 ⇒ `unmeasured`，不是 `ok`，也不是 `skipped`）。把"没有 verify"
 *   写成 `appliesTo: () => false` 会让它落进 `skipped`，而 `skipped` 在日志里与
 *   "这条判据不适用"同形 —— 于是"契约里根本没写 verify"这件事永远不会有人说。
 *   （与 t9 的"观察模式不是 appliesTo"同一个道理：**不适用**与**没能测量**不同形。）
 *
 * ★ 收窄在 `gate` 里按【事实】做，不在这里按 kind 收窄（与 t11 的 build-artifact-scope
 *   同构）：判据不猜哪些 kind "应该"有 verify —— 它进 gate 之后看手上这份契约
 *   有没有提出可判性要求。
 *
 * ★ MEASURED（2026-10-05，t17 收口）：本判据此前对「整个 verify 缺席」报 `unmeasured`，
 *   而调用方把 unmeasured 读成拒绝 ⇒ **所有 `kind=work` 的普通任务都建不出来**
 *   （实测打红 `scripts/stress-verify.mjs`）。依据在 `src/quality-gates.ts:510`：
 *   `if (kind === 'work') return { ok: true }` —— work 类**本就没有 verify 要求**。
 *   ⇒ 「不适用」被写成了「没能测量」，而那正是本队那条跨层规则禁止的形状。
 */
export declare function appliesTo(ctx: VerifyCommandContext | undefined): boolean;
export declare function gate(ctx: VerifyCommandContext): Promise<GateVerdict>;
export {};
