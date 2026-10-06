/**
 * ── 判据：idle ≠ converged（团队宣布交付时，成员到底收敛了没有）──────────────────
 *
 * 插入点：`delivery`（团队宣布交付 —— 契约 §1 ④）
 * id     ：`delivery.convergence`
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * "成员此刻不忙"有**两种成因，而它们在观察上同形**：
 *
 *     ① 收敛了   —— 它做完了，并且明确地报告了"没有别的事"
 *     ② 没声了   —— 它被问了一个问题，回了一个空回复 / 压根没回
 *
 * 上游只看得到 `activity: 'idle'`。而"空回复不是收敛"是本项目反复吃过的那口亏：
 * 一个返回空回复的审查落进 `{ok:true}`，读起来像"审查通过、没发现问题"。
 * 交付这一刻是同一个形态的最后一道门：**成员沉默着，团队宣布交付。**
 *
 * ★ 与本队"三态"纪律的关系：这里不是"两态 + 一个例外"，是**三条互不同形的结论**：
 *
 *     ok         —— 拿得到状态，且每个成员都处在收敛态（reported / idle + 说过话）
 *     blocked    —— 拿得到状态，且有人**明确地**没有收敛（working / unknown /
 *                   failed / 报过错 / ★ **从未 spawn**）
 *     unmeasured —— **拿不到成员状态**（调用方没能观察）
 *
 * ★ 验收里那句"convergence 的未测量形态必须与『已收敛』不同形"就是这张表的第三行：
 *   拿不到状态时返回 `ok`，等于用一次读取失败宣布"全队都收敛了"—— 那正是
 *   "没测到并进通过"。反过来，把 unknown 也算成"未测量"会让一条无法分辨成因的
 *   结论进裁决，所以两者分开：**成因可分辨 ⇒ blocked；连状态都拿不到 ⇒ unmeasured。**
 *
 * ── ★★ 「从未 spawn」是可判定的事实，**不是**没能测量（t15）─────────────────────
 *
 * MEASURED（2026-10-05，本队）：一个**依赖未满足**的成员不会 spawn —— 它的
 * `id` 是空串。而那是**被设计期望的正常情形**（`lifecycle-verify.mjs` 有一条
 * check 明确断言这种成员不 spawn），不是异常。
 *
 * 最初的实现把"id 为空"甩给了调用方（`observeMemberConvergence` 返回 `undefined`），
 * 于是判据收到的是"没能观察"⇒ `unmeasured` ⇒ **只要队里有一个依赖未满足的成员，
 * 整个交付位置就永远无法被测量**。**一道永远关着的门**，而且是被这条判据自己焊上的。
 *
 * ⇒ 正确的分界不是"能不能读到那个成员的会话"，而是**"这件事到底可不可判定"**：
 *
 *     · 从未 spawn    —— **可判定的事实**：它没起来过，也就没交回任何东西
 *                         ⇒ 交付时必须**阻止**（"我起不来"不是"我不知道"）
 *     · 会话读不出来  —— **没能测量**：它可能起来了、也可能没起来
 *                         ⇒ `unmeasured`（这一次确实测不成）
 *
 * ★ 这与本队那条归纳是同一条纪律：**「可判定的事实」不得写成「没能测量」** ——
 *   unmeasured 有一条危险的副作用，它让门**永久关闭**。不适用（kind=work 没有
 *   inScope）、可判定的事实（成员从未 spawn）、测了是零，各有各的正确表达；
 *   把它们都塞进 unmeasured，会让正常情形读起来像基础设施故障。
 *
 * ── 为什么按【成员状态】判，而不是按"有没有报告"判 ────────────────────────────
 *
 * 报告（mailbox）会被基线污染：一个成员可能留着一堆更早的回复，"最近一条是空"
 * 与"它在任务开始之前就说完了"长得一样 —— 那正是"把失败归给一个从未发生的事件"
 * 的镜像（t6 已经为派发事件吃过一次：投递失败不算派发）。所以判据**不数报告**，
 * 它只读调用方给出的【观察】：每个成员当前处在哪个终态，以及它最后有没有说话。
 *
 * ★ 但"它最后有没有说话"这一位是**被测量的、不是被猜的**：调用方注入
 *   `spoke`（true = 最近一次输出非空，false = 输出为空），缺席 = 没能观察 ⇒ 未测量。
 *   本判据不 import mailbox / 不读 JSONL —— I/O 由调用方注入（契约 §2 性质 1）。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形 —— ★ 见上面的三行表。
 */
import { type GateVerdict } from '../registry.ts';
import type { CtxPaths } from '../requires.ts';
export declare const id = "delivery.convergence";
export declare const point = "delivery";
export declare const description = "\u4EA4\u4ED8\u65F6\u6BCF\u4E2A\u6210\u5458\u90FD\u5FC5\u987B\u5904\u5728\u6536\u655B\u6001\uFF1Bworking / unknown / \u7A7A\u767D\u56DE\u590D\u90FD\u4E0D\u662F\u6536\u655B \u21D2 \u62D2\u7EDD\uFF08idle \u2260 converged\uFF0C\u7A7A\u56DE\u590D\u4E0D\u662F\u6536\u655B\uFF09";
/**
 * ── 输入面：只声明 `team`，★ **不**声明 `members` ────────────────────────────────
 *
 * ★ 这条判据的整个存在理由，就是把**三种**东西分开（见文件头那张三行表）：
 *
 *     blocked    —— 拿得到状态，而有人**明确地**没收敛（含 ★「从未 spawn」）
 *     unmeasured —— **拿不到成员状态**
 *     ok         —— 拿得到状态，且都在收敛态
 *
 *   ⇒ `members` 缺席**恰好就是** `unmeasured` 那一行的输入，它是判据的合法输入。
 *     把它写进 `requires`，核对层会在同一个事实上报第二遍，而硬化之后会把
 *     这条**正确**的未测量裁决拦成"接线缺陷"—— 与 `coverage` 那一格同形。
 *
 * ── ★ 「从未 spawn」不得被写成缺失（本任务的点名要求）───────────────────────────
 *
 *   `state: 'never-spawned'` 是一个**可判定的事实**（它没起来过、也就没交回任何
 *   东西）⇒ 判据据此 `blocked`。它**不是**"没能测量"。
 *
 *   ★ 而它与 `requires` 的关系有一处必须说清，否则下一个人会顺手写错：
 *     `never-spawned` 说的是**数组里某个成员的状态**，而 `requires` 声明的是
 *     **ctx 上的路径**。两者不在同一层 —— 所以"从未 spawn"这件事**根本不该**
 *     出现在 `requires` 里，既不能声明成"必须有 `members[].spoke`"，也不能
 *     声明成别的缺失。它由 `gate` 的白名单分支持有（`never-spawned` ⇒ blocked），
 *     且 `spoke` 对这类成员**不求值**（见 `gate` 里 `unmeasuredSpokes` 的 filter）。
 *
 *   ⇒ 若把 `members[].spoke` 之类写进声明，核对层会把"一个从未 spawn 的成员
 *     没有发言记录"报成缺格 —— 那正是 t15 要消灭的形状：
 *     把一个**正确裁决**（我起不来 ⇒ 阻止交付）误报成**接线缺陷**。
 *
 * ★ 同 `coverage`：`team` 声明但不写子路径 —— `appliesTo` 读 `ctx.team` 是否存在，
 *   而 `team.members` 只在 `members` 缺席时用来判断"这个队有没有成员"，
 *   它缺席不影响本判据的裁决。
 */
export declare const requires: CtxPaths<ConvergenceContext>[];
/**
 * 成员的收敛状态。**除了 `reported` / `idle` 之外的每一种都必须指名成员拒绝交付。**
 *
 * 那个可选的 `error` 字段（`failed` / `unknown` 上可能有）**不改变裁决**，只让
 * blocker 更可行动：上游早就学会了把"成员为什么没起来"写进 `spawnError`，
 * 否则队长只看到一个无解释的 `unspawned`。同一个道理 —— 一条只说"成员 X 没收敛"
 * 的拒绝，与一条说"成员 X 起不来：provider 拒绝"的拒绝，代价差一个往返。
 */
export interface MemberConvergenceInput {
    /** 成员名（或 id —— 判据只把它当标签用）。 */
    name: string;
    /**
     * 观察到的收敛态：
     *   · `idle`     —— 它的 Agent 不忙（这是"不忙"，★ 不是"收敛"，见下）
     *   · `reported` —— 它明确报告了"没有别的事"（收敛）
     *   · `working`  —— 它此刻还在忙
     *   · `failed`   —— 它报过失败
     *   · `never-spawned` —— ★ **它从未起来过**（id 为空：依赖未满足 / 启动被拒）
     *   · `unknown`  —— 观察到了，但无法归入上面任何一类
     *
     * ★ `never-spawned` 与"拿不到这个成员"是**两件不同的事**：前者是一个可判定的
     *   事实（判据据此**阻止**交付），后者是没能测量（判据据此 `unmeasured`）。
     *   把它合进 `unknown` 也能得到 blocked，但会**丢掉成因**：读日志的人分不出
     *   "它没起来"与"起来了但状态读不懂"，而这两件事的下一步动作完全不同
     *   （前者去查依赖/派发，后者去查状态读取）。
     */
    state: 'idle' | 'reported' | 'working' | 'failed' | 'never-spawned' | 'unknown';
    /**
     * ★ "它最后有没有说话"这一位。
     *   true  = 最近一次输出非空       false = 空回复
     *   缺席  = **没能观察**（⇒ 整条判据 unmeasured，而不是把它当 true）
     */
    spoke?: boolean;
    /** 它为什么没起来 / 为什么这一位读不到（+context，不改变裁决）。 */
    error?: string;
}
/** 一条成员状态的观察。★ 数组里的一行读不懂 ⇒ 未测量，绝不静默跳过（见 gate）。 */
export interface MemberConvergenceObservation {
    name?: string;
    state?: string;
    spoke?: boolean;
    error?: string;
}
export interface ConvergenceContext {
    /** 团队状态。只在 `members` 缺席时用来判断"这个团队有没有成员"。 */
    team?: {
        id?: string;
        members?: readonly unknown[];
    };
    /**
     * ★ 调用方观察到的成员状态。
     *
     * **缺席 ≠ 空数组**（本判据的关键区分，两条未测量臂分别钉住它们）：
     *   · `members` 缺席      ⇒ 没能观察 ⇒ `unmeasured`（★ 绝不当成"都收敛了"）
     *   · `members: []`       ⇒ 观察了：这个团队没有成员 ⇒ `ok`
     */
    members?: readonly MemberConvergenceObservation[];
}
/**
 * 生效条件：调用点把团队传进来了（"这一步就是交付判读"的信号）。
 *
 * ★ 本判据**不**用 `appliesTo` 排除"没有成员"的情形：那正是对照臂要表达的 `ok`，
 *   写进 `appliesTo` 会让它落进 `skipped` —— 而 `skipped`（判据没跑）与
 *   `unmeasured`（判据跑了说测不了）必须不同形（t9 已经为观察模式钉过这条界线）。
 */
export declare function appliesTo(ctx: ConvergenceContext | undefined): boolean;
export declare function gate(ctx: ConvergenceContext): GateVerdict;
