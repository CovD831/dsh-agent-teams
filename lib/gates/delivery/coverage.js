/**
 * ── 判据：每个目标都有人认领（交付时的【无人认领】检查）──────────────────────────
 *
 * 插入点：`delivery`（团队宣布交付 —— 契约 §1 ④）
 * id     ：`delivery.coverage`
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * `canDeclareDelivery` 检查的是**任务列表**："每个任务都完成了吗、review 通过了吗、
 * 有没有未入账的越界路径"。它从来不问一个更前面的问题：
 *
 *     用户提的那些目标，**有没有任何一条任务声称覆盖了它**？
 *
 * 而一个没有任何任务 `coverageOf` 它的目标，在任务列表里【不留痕迹】——
 * 任务全绿、review 全 pass、`canDeclareDelivery` 返回 `{ok:true}`。
 * 于是交付那一刻读起来是"全队的目标都完成了"，而实际上**有一个目标从来没人碰过**。
 * 这是"没测到"并进"通过"的同一形态，只不过被并进去的是【整个目标】。
 *
 * ★ 上游已经算了 `coverage`（矩阵，`buildCoverageMatrix`），但**没人据此拒交付** ——
 *   它只出现在 `agent_teams_status` 的输出里，供人肉读。一条只被人读的结论，
 *   在一次匆忙的交付里与不存在同形。
 *
 * ★ 为什么这条判据不是"重算 coverage"：矩阵由调用方提供（`ctx.coverage`），
 *   本文件只做【数据变换】—— 契约 §2 性质 1：判据不 import I/O。
 *
 * ── 它不做什么（刻意的边界）────────────────────────────────────────────────────
 *
 * · **不检查任务完成度**：那是 `canDeclareDelivery` 的事。这里只报 `missing`
 *   （没有任务认领），并把 `blocked`（有任务但失败了）说清楚 —— 后者上游已经在拒。
 * · **不猜目标清单**：拿不到 `coverage` ⇒ `unmeasured`。一个"没拿到目标清单"
 *   与"目标全都有人认领"在交付裁决上必须不同形，否则一次读取失败就伪装成
 *   "全都覆盖了"。
 * · **不在没有目标条目时拒绝**：用户目标拆不出条目是**正常情形**（普通 work 团队
 *   根本没有 goal 概念）。此时 `coverage` 是空数组 ⇒ `ok`，那是一个测量结论
 *   （"看过了，没有条目需要认领"），不是"没测到"。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O（连 `quality-gates.ts` 也不 import ——
 *    `CoverageRow` 在这里按形状本地声明，好让"覆盖矩阵是调用方给的观察"这件事
 *    在 import 列表上一眼可见）。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */
import { blocked, unmeasured } from "../registry.js";
export const id = 'delivery.coverage';
export const point = 'delivery';
export const description = '用户目标的每个条目都必须有任务声称覆盖它；有目标无人认领 ⇒ 交付时拒绝（其余任务全绿会让"没人做的目标"看起来像都完成了）';
/**
 * ── 矩阵的两半：读得到的、和读不懂的 ──────────────────────────────────────────
 *
 * ★ 为什么不是"传一个 `CoverageRow[]`，不是数组就 unmeasured"：
 *
 *   调用方是**人写的**装配代码，而"矩阵里混进了一行读不懂的东西"与"矩阵里少了一行"
 *   是两种不同的失效。前者说"有一行我看不懂"（局部未测量），后者说"我压根没拿到
 *   矩阵"（整体未测量）。把它们合成一个 `unmeasured` 是安全的（都是未能测量），
 *   但把它们合成【静默跳过那一行】就是"没测到并进通过"：那一行的目标可能正是
 *   没人认领的那一条。
 *
 * ⇒ 读不懂的行【单独交出来】，由 gate 决定怎么处理（这里：整条判据 unmeasured）。
 */
function partitionRows(rows) {
    const good = [];
    const malformed = [];
    rows.forEach((row, index) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
            malformed.push(`coverage[${index}] is not an object (got ${JSON.stringify(row)})`);
            return;
        }
        const candidate = row;
        const goal = candidate['goal_item'];
        if (typeof goal !== 'string' || goal.trim() === '') {
            malformed.push(`coverage[${index}] has no goal_item (got ${JSON.stringify(goal)})`);
            return;
        }
        const status = candidate['status'];
        if (status !== 'missing' && status !== 'in_progress' && status !== 'passed' && status !== 'blocked') {
            malformed.push(`coverage[${index}] ("${goal}") has an unknown status ${JSON.stringify(status)}`);
            return;
        }
        const taskIds = candidate['task_ids'];
        good.push({
            goal_item: goal,
            task_ids: Array.isArray(taskIds) ? taskIds.filter((item) => typeof item === 'string') : [],
            status,
            ...typeof candidate['evidence'] === 'string' ? { evidence: candidate['evidence'] } : {},
        });
    });
    return { rows: good, malformed };
}
/**
 * ── 目标条目从哪来 ───────────────────────────────────────────────────────────
 *
 * 矩阵的**行**就是目标清单（`buildCoverageMatrix(goalItems, tasks)` 的输出）。
 * 所以"拿不到矩阵" = "拿不到目标清单"，这就是未测量臂的输入。
 *
 * ★ 那 `team.profile.protocol` 是什么：profile 的 protocol 文本里写着这次交付的
 *   硬约束（本轮就是），而覆盖矩阵是按**用户目标**建的 —— 一个 profile 团队若
 *   真把目标写进了 protocol，那条目标会因为没人 `coverageOf` 它而**在矩阵里
 *   根本不出现**。所以 protocol 里出现的目标条目要按【缺席】处理，而不是让它
 *   静默消失。这需要调用方也把它列进 `goalItems`（矩阵是调用方建的，本判据
 *   不替它猜）—— 于是协议文本与矩阵不一致时，这里回到 `ok` 或 `unmeasured`，
 *   两个方向都不是"悄悄地放过"。
 *
 * ⇒ 本函数返回**目标清单的来源**（给人读的一句话），gate 只把它放进产出里，
 *   不据此改变裁决。它存在的意义是：交付时能从 `outputs` 看出
 *   "这次的门禁是拿哪份清单量出来的"。
 */
function goalItemsOf(rows) {
    return rows.length === 0
        ? 'the coverage matrix carries no goal item (a team with no declared user-constraint items)'
        : `the coverage matrix carries ${rows.length} goal item(s): ${rows.map((row) => `"${row.goal_item}"`).join(', ')}`;
}
/**
 * 生效条件：`team` 被传进来了（"这一步就是交付判读"的信号）。
 *
 * ★ 为什么【不】按 kind / 按有没有目标收窄：
 *   · "没有目标条目"正是对照臂要表达的东西（⇒ `ok`），把它写成 `appliesTo: () => false`
 *     会让它落进 `skipped`，而 `skipped` 与"这条判据不适用"同形 —— 于是
 *     "这次交付一个目标都没有" 永远不会有人说。这与 `contract` 位置那条
 *     "未测量 ≠ 不适用"是同一个道理。
 *   · 一个**没有目标**的团队（普通 work 团队）必须照常交付 —— 但那件事由
 *     `gate` 用 `ok` 说，不是由 `appliesTo` 把它藏起来。
 *
 * ★ 也【不】要求 `coverage` 在场：矩阵缺席恰恰就是未测量臂的输入。
 *   一条"输入不全 ⇒ 我不跑"的 `appliesTo` 会让"没测到"与"不适用"同形 ——
 *   而那正是本判据最不该犯的错（它的整个存在理由就是不让"没测到"并进"通过"）。
 */
export function appliesTo(ctx) {
    return ctx?.team !== undefined;
}
export function gate(ctx) {
    const matrix = ctx?.coverage;
    /**
     * ★ 拿不到矩阵 ⇒ `unmeasured`，不是 `ok`。
     *
     *   `coverage` 缺席说明调用点没能提供"用户目标清单"——
     *   一个无法读到目标清单的判据若返回 ok，就是"装上了但从不生效"：交付时读起来
     *   像"每个目标都有人认领"，而它其实连有哪些目标都不知道。
     *
     * ★ 与"矩阵是空数组"必须不同形：空数组是一个**测量结论**（看过了，没有条目），
     *   缺席是一个**关于测量的结论**（没看成）。两者在交付裁决上完全不同。
     */
    if (matrix === undefined || matrix === null) {
        return unmeasured('the goal coverage matrix was not provided to the delivery position, so whether every goal item has a task claiming it could not be determined (no goal list was observed — this is not evidence that all goals are covered)');
    }
    if (!Array.isArray(matrix)) {
        return unmeasured(`the goal coverage matrix is not a list of rows (got ${typeof matrix}), so whether every goal item has a task claiming it could not be determined`);
    }
    const { rows, malformed } = partitionRows(matrix);
    /**
     * ★ 有一行读不懂 ⇒ 整条判据未测量，且把那几行【原文】交出来。
     *
     *   静默跳过它会让"这一行的目标没人认领"变成"这一行不存在" —— 而那正是本判据
     *   要抓的那个形态（一个没人做的目标看起来像做完了）。宁可说"这场交付测不成"，
     *   也不要说"覆盖没问题"。
     */
    if (malformed.length > 0) {
        return unmeasured(`the coverage matrix could not be read in full (${malformed.join('; ')}), so a goal item with no claiming task could be hiding in the unreadable rows`);
    }
    const uncovered = rows.filter((row) => row.status === 'missing');
    const failed = rows.filter((row) => row.status === 'blocked' && row.task_ids.length === 0);
    if (uncovered.length > 0) {
        /**
         * ★ blocker 必须【指名哪个目标】没有任务覆盖 —— 只说"有目标没人认领"的拒绝
         *   是不可行动的：读到它的人得自己去把两份清单差出来，而那正是这条判据该做的
         *   工作。目标条目原文照抄（不改写、不截断），因为它是用户的话。
         */
        return blocked(uncovered.map((row) => (`goal item "${row.goal_item}" has no task claiming it (no task declares coverageOf it), `
            + 'so the team is about to deliver without anyone having worked on it — '
            + 'declare coverage on a task, or say explicitly that this goal is a non-goal')));
    }
    if (failed.length > 0) {
        return blocked(failed.map((row) => (`goal item "${row.goal_item}" is marked blocked with no task on it, so it is not covered by any finished work`)));
    }
    /**
     * ★ 通过时也交出产出：让交付记录里留着【门禁亲眼看过的那份清单】，
     *   而不是只留调用方的一句话（与 verify-rerun 交回 reruns 同构）。
     */
    const covered = rows.filter((row) => row.status === 'passed').map((row) => row.goal_item);
    const inProgress = rows.filter((row) => row.status === 'in_progress').map((row) => row.goal_item);
    return {
        ok: true,
        goal_items: rows.map((row) => row.goal_item),
        covered_goal_items: covered,
        ...inProgress.length === 0 ? {} : { in_progress_goal_items: inProgress },
        coverage_source: goalItemsOf(rows),
    };
}
