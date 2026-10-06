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
import { type GateVerdict } from '../registry.ts';
import type { CtxPaths } from '../requires.ts';
export declare const id = "dispatch.worktree";
export declare const point = "dispatch";
export declare const description = "\u6838\u5BF9\u58F0\u660E\u7684\u5DE5\u4F5C\u662F\u5426\u771F\u7684\u843D\u5728\u9694\u79BB worktree \u91CC\u3001\u4E14\u6CA1\u843D\u5230\u4E3B\u68C0\u51FA\uFF1B\u8BFB\u4E0D\u5230 worktree \u5373\"\u672A\u6D4B\u91CF\"\uFF08\u9632\u6B62\u9694\u79BB\u9000\u5316\u6210\u63D0\u793A\uFF09";
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 本判据要的两格也都是【调用方注入的观察】，不是 ctx 上原生的字段：
 *
 *   · `worktreePath` —— 这个任务被派发到的隔离工作目录。它来自调度器的派发
 *     （`kickMember` 里 `createTaskWorktree(...).path`，经 `onDispatched` 回流），
 *     不是 ctx 里本来就有的东西。★ **它就是本判据的闸门**：缺席 ⇒ 判据返回
 *     `{ok:true, landed:null, skipped:'no worktree was declared …'}`，
 *     也就是"这里没有要测的东西"（不是"我测不了"）。
 *   · `arrival`      —— 探针（在 worktree / 主检出两侧各读了一遍）。判据自己不读
 *     文件系统，所以"有人真的去看过"这件事只能由这一格表达。
 *
 * ★ 为什么两格【都】声明，即使 `worktreePath` 缺席时判据并不 unmeasured：
 *   声明的是"这条判据需要哪些格才说得出话"，而不是"哪些格缺席会让它 unmeasured"。
 *   只声明 arrival 会让核对层在"没有隔离"的 ctx 上报出一格缺失，而那是
 *   **正常情形**（review/work 类别本就不需要 worktree）—— 噪音。两格都声明，
 *   核对层才有机会说清"这条判据要问的到达问题，连它的两个观察面都没注入"。
 *   代价是"没有隔离要求"的 ctx 也会被报成 incomplete，这是**已知且刻意**的
 *   取舍：那个读数在 `requires.checks` 里逐条可读，而在 `observe`（缺省）下
 *   它不改变任何裁决（见 requires.ts 的先软后硬一节）。
 *
 * ── ★ 每一格都与一条 `unmeasured` 臂逐条对齐（本判据有三条）────────────────────
 *
 *     ① `arrival` 缺席          ⇒ "no arrival probe was injected"      ⇒ 声明 arrival
 *     ② `arrival.worktreeReadable` 非真 ⇒ "the worktree … could not be read" ⇒ 声明 arrival
 *     ③ `arrival.mainReadable` 非真     ⇒ "… cannot be certified"       ⇒ 声明 arrival
 *
 *   三条都落在 `arrival` 这一格上：它是**整份探针**在不在，而不是它的某个读数。
 *   声明它一条就够（读数是判据自己的事，`readFile` 那种"执行器逐格声明"在这里
 *   没有对象 —— 判据不读文件系统，它读的是别人交上来的读数），但**必须**声明：
 *   否则"调用方忘了注入探针"会退回成一个静默的 unmeasured，而那正是本轮要消灭的。
 *
 * ★ `worktreePath` 也声明，尽管它缺席时判据走的是第三条路（"没有隔离要求"⇒ ok）：
 *   它是本判据的**闸门**，而闸门格与输入格在这条判据上无法用 appliesTo 分开
 *   （见下面 `appliesTo` 的注释：把"没有隔离"写成不适用，会让"不需要隔离"与
 *   "该隔离却没隔离"同形 —— worktree.ts 的 WorktreeRefusal 整整一段都在讲这个坑）。
 *   既然闸门留在 `gate()` 里，它就必须被声明，否则核对层永远说不出
 *   "这条判据连它的工作目录都没注入"。
 *
 * ★ 而 `worktreeUnavailable`（降级派发：非 git 仓库）**不声明**：缺席时判据照常
 *   按 landing 判定，它不是"这一格缺了就说不出话"的格。把它写成一条缺格会把
 *   正常情形读成缺陷 —— 那一事实由调度器自己记进任务记录（见 `src/scheduler.ts`
 *   的降级分支），不归这条判据。
 */
export declare const requires: CtxPaths<WorktreeContext>[];
/** 只读得到一半时的降级证据（例如目录在、主检出读不到）。 */
export interface WorktreeArrivalProbe {
    /** 工作目录里【存在】的路径（workspace 相对）。 */
    absentInWorktree: string[];
    /** ★ 是否真的读到了 worktree 本身（目录不存在 / 读不了 ⇒ false ⇒ 未测量）。 */
    worktreeReadable: boolean;
    /** 主检出里【存在】的路径（workspace 相对）。 */
    presentInMain: string[];
    /** ★ 是否真的读到了主检出。读不到它就不能声称"没落到主树"（那是没有证据的通过）。 */
    mainReadable: boolean;
    /** 造成降级的原始消息（供人判断是不是 git 抖动）。 */
    notes?: string[];
}
interface WorktreeContext {
    task?: {
        id?: string;
        kind?: string;
    };
    update?: {
        changedPaths?: string[];
    };
    /**
     * ★ 该任务被声明的工作目录（worktree 绝对路径）。
     *
     * `undefined` 与"读不到"必须不同形：
     *   undefined     ⇒ 这个任务根本没有隔离要求（work/review 类别）⇒ 不适用（skipped）
     *   有路径但读不到 ⇒ unmeasured
     */
    worktreePath?: string;
    /** 主检出（队长工作区）的绝对路径 —— 落地判定的另一半。 */
    workspace?: string;
    /** 由调用方注入的探针结果（判据自己不读文件系统）。 */
    arrival?: WorktreeArrivalProbe;
}
/**
 * 只对【声明了 changedPaths 的 implementation/repair】任务生效。
 *
 * ★ 与 `dispatch.changed-paths` 同一组条件，理由也同源：
 *   · 没声明 changedPaths ⇒ 没有可核对的东西；
 *   · 只有这两类 kind 的契约要求填 changedPaths。
 * ★ 无 worktree 路径时【不】在这里返回 false：那会让"没有隔离"看起来像
 *   "不需要隔离"。是否测量由 `gate` 用 unmeasured 表达。
 */
export declare function appliesTo(ctx: WorktreeContext | undefined): boolean;
export declare function gate(ctx: WorktreeContext): GateVerdict;
export {};
