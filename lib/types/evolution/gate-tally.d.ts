/**
 * ── 门禁裁决的使用读数：把注册表的逐条裁决，变成飞轮的第一份真实原料 ──────────────
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-23，`grep -rn "UsageTally\|tallyAdopt\|tallyRecall" src` 排除
 * `confidence.ts` 本身 ⇒ **零命中**）：
 *
 * ```
 * 飞轮的读法（readFlywheel / confidenceOf / 四条件）—— 写对了、测过了
 * 而【写入端一行都不存在】⇒ 四个裁决从来没有真实数据喂进去过
 * ```
 *
 * ⇒ 本文件补的是**写入端**：把「某条判据在某次求值里得到什么裁决」记成一行。
 *   它不改变任何裁决，不参与任何门禁，**只记账**。
 *
 * ── ★★★ 两个计数各自的语义（这决定了本文件是否可信）─────────────────────────────
 *
 * | 计数 | 本文件怎么算 | 它到底在说什么 |
 * |---|---|---|
 * | `recalled` | 该判据**被求值**的行数（ok / blocked / unmeasured） | 「它进过视野几次」 |
 * | `upvoted` | 其中裁决为 **`blocked`** 的行数 | 「它的判断被执行过几次」 |
 *
 * ★★ **为什么 `skipped` 不计入 `recalled`**：
 *   被 `appliesTo` 跳过的判据**根本没跑**。把它记成"被看到过"，会让一条
 *   **从未适用**的判据伪装成"曝光很多但没人采纳" —— 于是飞轮会给它一个
 *   偏低的 confidence，最终把它**归档**。而那正是本仓记账最久的形态：
 *   **「没跑」与「跑了但没过」同形**。
 *
 * ★★ **`upvoted = blocked` 是一个近似，必须写明**：
 *   `blocked` 只证明「判据的判断被执行了」（任务被拦下），**不等于**「人同意了它」。
 *   真正的"采纳"应当是"被拦之后作者确实改了那处"。这一层今天观测不到。
 *   ⇒ 本文件**不声称**它是采纳率，只声称它是「起作用次数」；
 *     两者在数值上可能分叉，所以**不许**在文档或 UI 里把它叫成"采纳率"。
 *
 * ── ★ 存储：一行一个 JSON，追加写 ─────────────────────────────────────────────────
 *
 * 与 `appendSignal`（`src/evolution/collect.ts:286`）同一种做法：
 * `appendFile` 对同一路径在 `O_APPEND` 下是原子的（该文件 MEASURED：20 次并发 ⇒ 20/20 行可解析）。
 * ⇒ 不引锁、不读改写。
 *
 * ── ★ 绝不抛 ─────────────────────────────────────────────────────────────────────
 *
 * 本文件会被挂在**完工/派发这类热路径**上。写不进台账是旁路故障，
 * **绝不能**把"记账失败"变成"这次完工变成异常"（同 `appendSignal` 的纪律）。
 * ⇒ 一切失败返回 `0` / 空结果，由调用方决定要不要 `warn`。
 */
import type { GateRunEntry } from '../gates/registry.ts';
import type { UsageTally } from '../confidence.ts';
/**
 * 一行 = 一条判据在一次求值里的裁决。
 *
 * ★ 只记 `ok` / `blocked` / `unmeasured` 三态 —— `skipped` **不落盘**（见文件头）。
 */
export interface GateTallyRow {
    /** 这次求值发生的时间（epoch ms，由调用方注入，便于夹具复现）。 */
    readonly at: number;
    /** 插入点（`completion` / `dispatch` / …）。 */
    readonly point: string;
    /** 判据 id —— 它也同时是飞轮里"条目"的键。 */
    readonly gate: string;
    readonly verdict: 'ok' | 'blocked' | 'unmeasured';
    /** ★ 谁触发的（会话 id / 成员名）。★ 缺席 ⇒ 不知道，**不是**空串。 */
    readonly by?: string;
}
export declare function gateTallyPathOf(stateRoot: string): string;
/**
 * 把一次求值的逐条裁决追加到台账。
 *
 * @returns **实际写入的行数**；写失败返回 `0`（不抛）。
 *
 * ★ 只写 `ok/blocked/unmeasured`；`skipped` 被丢弃 —— 返回的行数也因此可能小于 `ran.length`。
 */
export declare function appendGateTallies(args: {
    readonly stateRoot: string;
    readonly point: string;
    readonly ran: readonly GateRunEntry[];
    readonly at: number;
    readonly by?: string;
}): Promise<number>;
export interface GateTallyLog {
    readonly rows: readonly GateTallyRow[];
    /**
     * ★ 解析失败的行数 —— **单列**，不并入 `rows.length`。
     *   「台账有 100 行」与「台账有 100 行、其中 3 行读不出来」是两件事。
     */
    readonly unreadable: number;
    /** 文件是否存在。★ 缺席 ⇒ `false`，与「存在但 0 行」不同形。 */
    readonly present: boolean;
}
/** 读回整份台账。坏行跳过并计数，**绝不**因为一行坏就整体失败。 */
export declare function readGateTallies(stateRoot: string): Promise<GateTallyLog>;
/**
 * 把行折成飞轮的输入：`Map<判据 id, UsageTally>`。
 *
 * ★ 三个映射都不是"随便定的"，见文件头。
 * ★ 没有任何行的判据**不出现在 Map 里** —— 缺席 ⇒ 飞轮判 `unmeasured`，
 *   而不是"0 次曝光"。这正是 `confidence.ts` 文件头那条「缺失 ≠ 0」。
 */
export declare function talliesFromRows(rows: readonly GateTallyRow[]): Map<string, UsageTally>;
