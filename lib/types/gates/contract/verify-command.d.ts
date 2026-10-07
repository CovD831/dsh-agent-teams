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
import type { CtxPaths } from '../requires.ts';
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
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 本条判据正是上一轮五次缺口里的**第三次「执行器缺席」**。而它在这一轮里
 *   提供的是一条与 `build-artifact-scope` **相反的**口径 —— 两条合起来才完整：
 *
 *     build-artifact-scope：判据【可选地】读的东西 ⇒ 不进 requires
 *     verify-command      ：判据【需要它才说得出话】的东西 ⇒ 必须进 requires
 *
 * ── 为什么 `execVerifyCommand` 是必填格，尽管它在类型上是可选的 ────────────────
 *
 * `execVerifyCommand?:` 的"可选"是**类型层的**（判据不许 import I/O，它只能拿到
 * 调用方注入的东西，所以类型上不能强制）。但它在**语义上不是可选的**：
 *
 *     注入   ⇒ 真的跑一次 ⇒ 结论是**观察**（"这条命令退出 3"），可被独立复核
 *     不注入 ⇒ 只有静态分析 ⇒ 结论降级成 `unmeasured`（见 gate 里那段注释）
 *
 * ⇒ 而 `unmeasured` 在本插件里**等于拒绝**（`rejectOnContractGates` 对 unmeasured
 *   抛错）。这正是 t17/t18 实测过的形态：
 *
 *     contract 的两个调用点都没注入 ⇒ `contract.verify-command` 在生产路径上
 *     永远 `unmeasured` ⇒ **implementation / repair 这类必须验的契约连
 *     create_task 都过不去**（一道永远关着的门）。
 *
 * ⇒ 所以这一格【必须】进 requires：它缺席不是"这条判据安静一点"，而是
 *   "这条判据说不出它唯一想说的事"。核对层报出它，与判据自己报 `unmeasured`
 *   是**同一句话的两种说法** —— 它们必须一致（否则就是新的静默失效）。
 *
 * ── 那为什么不干脆声明 `'task'` 就收工 ─────────────────────────────────────────
 *
 * 因为那样会让"执行器没接线"这件事**退回人眼审查**：`task` 在场时判据照常跑、
 * 照常返回一句读起来与"没能测量"同形的 unmeasured —— 而**没有人**能从读数里
 * 看出那是"调用方漏了一行注入"。这正是本轮要消灭的东西：
 * 「判据要的这一格 ctx 没接上」必须变成一次机械核对，而不是一次阅读。
 *
 * ── 边界：`creating` / `task.verify` 为什么不进 ─────────────────────────────────
 *
 * 与 `build-artifact-scope` 同一条口径（见那份声明的长注释）：
 *   · `creating` —— 本条判据**根本不读它**（`gate()` 里没有 `ctx.creating` 的
 *     任何一处使用；它是契约位置两个调用点的共同事实，不是这条判据的输入）。
 *     声明一个判据不读的格子，会让核对层替它说一句它自己不会说的话。
 *   · `task.verify` —— 判据**可选地**读它，而且"缺席"正是它的一条裁决分支
 *     （verify 整个缺席 ⇒ **ok**，t17 的收口）。声明它 = 给每个 `kind=work`
 *     的普通任务制造假告警。它的与未测量臂的对应关系见下面 `appliesTo` 一节。
 *
 * ★ 与未测量臂的一致性（本任务验收 ②）—— 逐条对齐如下：
 *
 *     判据的 unmeasured 分支                          它读的格           进 requires?
 *     ──────────────────────────────────────────────  ─────────────────  ──────────
 *     "no executor was injected …"                    execVerifyCommand  ✔ 是
 *     "the contract declares a verify value that
 *      is not a list"                                 task               ✔ 是
 *     "declares an empty verify list"                 task.verify        ✘ 否（可选）
 *     "running … raised / returned a non-integer"     ——                 ✔（由前者保证）
 *     "the contract could not be judged"（exec 抛错）  ——                 ✔（同上）
 *
 * ⇒ 唯一的"缺 X 就 unmeasured 而 X 不在 requires 里"是 `task.verify`，而它**不是
 *   遗漏**：它的缺席是一条**合法裁决**（t17：verify 缺席 ⇒ ok，不是 unmeasured），
 *   它由 gate 自己的分支持有，并有三条夹具臂钉住（不适用臂 / 未测量臂 / 三态不同形）。
 */
export declare const requires: CtxPaths<VerifyCommandContext>[];
/**
 * ── ★★★ 规则表：从【代码】挪到【运行时可读的数据】（t53）─────────────────────────
 *
 * ── 它兑现的是"插件能不能自我迭代"这个问题的**唯一可行答案** ────────────────────
 *
 * 用户问：「无法自动重载的话，插件就不能做自我迭代了？」
 * ⇒ 可判定的原则：**改【它读的东西】⇒ 不必重载；改【跑着的那段代码】⇒ 要换进程。**
 *
 * ★★ 而"数据"这个词本身骗人 —— 它有两个含义（我实测出来的三分类）：
 *
 *     改【跑着的代码】（.ts 的逻辑）        ⇒ 要 build + 重载
 *     改【被内联进 lib 的数据】（静态 import）⇒ ★ 要 build + 重载（只省了"懂 TS"）
 *     改【运行时读盘的数据】（调用方每次读）  ⇒ ★ 不 build、不重载 ← **只有这一条兑现**
 *
 *   MEASURED：静态 `import rules from './…json'` 在本仓库**连编译都过不去** ——
 *     `error TS1543: Importing a JSON file into an ECMAScript module requires a
 *     'type: "json"' import attribute when 'module' is set to 'NodeNext'`；
 *     而即便打开 `resolveJsonModule`，JSON 也会被 `tsc` **内联进 `lib/`**
 *     ⇒ 改数据仍要 build ⇒ 仍要重载。
 *   ★ 所以中间那一类**看起来像数据**，而它在运行时与代码同命。
 *
 * ⇒ 因此规则表**不由本模块读**（判据不许 import I/O，`verify-gates-integration` ④
 *   逐行检查 import 子句）—— 而是与 `execVerifyCommand` **同一条路：由调用方注入**，
 *   且调用方**每次调用时读盘**。于是"改数据 ⇒ 立刻生效"成立。
 *
 * ── ★★★ 表与逻辑的边界（这是最容易做错的地方）────────────────────────────────────
 *
 *   ★ **表**（进数据）：哪些【命令名】是恒真的 / 恒红的、哪些命令【本可断言】、
 *     哪一族命令的成败可能取决于另一个命令的输出。
 *   ★ **逻辑**（留在本文件）：怎么用那张表判断、三态怎么分、tokenize、
 *     "有算子就不算恒真"这条推理、措辞怎么生成。
 *
 *   ⇒ 我**没有**为了数据化而把逻辑搬进数据 —— 那会造出一个**不可测的解释器**
 *     （本队记账的"过度设计"形态：一个能表达逻辑的数据文件无法被静态复核）。
 *
 * ── ★★ 而它必须【可校验】：三态不同形 ──────────────────────────────────────────
 *
 *     `loaded`   —— 读到了、且形状对
 *     `absent`   —— 读不到（文件不在 / 读失败）
 *     `malformed`—— 读到了但形状坏（不是对象 / 缺关键字段 / 字段类型不对）
 *     `empty`    —— 读到了、形状对，但**一条规则都没有**
 *
 *   ★ 四者**互不同形**，且**绝不静默退化成"没有规则"** ——
 *     那会把「没能测量」变成「测了，没问题」（本队记账最久的那条界线）。
 *   ⇒ 读不到/坏/空 ⇒ 本判据的静态部分降级成 `unmeasured`（不是"没有恒真命令"）。
 */
export type RulesLoad = {
    status: 'loaded';
    rules: VerifyCommandRules;
} | {
    status: 'absent';
    reason: string;
} | {
    status: 'malformed';
    reason: string;
} | {
    status: 'empty';
    reason: string;
};
/** 规则表的形状 —— **只放表，不放逻辑**。 */
export interface VerifyCommandRules {
    /** 以这些命令起头 ⇒ 恒绿（`true`）。 */
    constantGreenCommands: readonly string[];
    /** 以这些命令起头 ⇒ 恒红（`false`）。 */
    constantRedCommands: readonly string[];
    /** 恒绿的**别名**（`:` / `!false`）—— 与上面同一类事实，只是写法不同。 */
    constantGreenAliases: readonly string[];
    /** 本可断言、但在某些形状下断言不了的命令（`test` / `[`）。 */
    assertionCommands: readonly string[];
    /** 这一族命令的成败可能取决于另一个命令的输出（`grep` / `egrep` / `fgrep`）。 */
    processSubstitutionReaders: readonly string[];
    /** 整行匹配的长开关（`--line-regexp`）。 */
    wholeLineSwitches: readonly string[];
    /** 整行匹配的短选项形状（正则源码字符串）。 */
    wholeLineShortPattern: string;
}
/**
 * 把调用方交进来的**未校验数据**解析成规则表。
 *
 * ★ 它是**纯函数**（不读盘）："读"由调用方做，"信不信它"由本函数判。
 *   ⇒ 于是"文件读不到"与"文件里写的是垃圾"在**判据层**是两个不同的读数
 *     （前者调用方说 `absent`，后者这里说 `malformed`）。
 *
 * ★ 为什么严格校验**每一个**字段：一个缺了 `constantRedCommands` 的表会静默地
 *   让 `false` 不再被识别为恒红 —— 而那**看起来像"这条命令没问题"**。
 *   ⇒ 缺字段必须是 `malformed`，不能是"那个字段就当空数组"。
 */
export declare function parseRules(raw: unknown): RulesLoad;
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
    /**
     * ── ★★★ 规则表的**运行时**来源（t53）──────────────────────────────────────────
     *
     * ★ 由调用方注入，且调用方**每次调用时读盘** —— 那正是"改数据不必重载"成立的条件。
     *   ★ 判据**不读盘**（不许 import I/O）⇒ 它只能拿到调用方交进来的这一份。
     *
     * ★ 三种"没得读"的情形由调用方区分（`absent` = 读不到；本文件自己判 `malformed`
     *   与 `empty`）⇒ 四态不同形，且**绝不静默退化成"没有规则"**。
     */
    /**
     * ★ 返回 `RulesLoad` **或它的 Promise**：读盘天然是异步的，而"读"这件事
     *   由调用方做 ⇒ 判据必须接受一个异步的读取器，否则调用方只能同步读盘
     *   （那会把它自己锁进 `readFileSync`，并在大文件上阻塞事件循环）。
     *   ★ 而 `gate()` 已经是 `async` ⇒ 多 await 一步不改变任何既有语义。
     */
    loadRules?: () => RulesLoad | Promise<RulesLoad>;
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
export declare function verifyCommandProblems(command: string, rules: VerifyCommandRules): VerifyCommandProblem[];
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
