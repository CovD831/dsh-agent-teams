/**
 * ── 判据：liveness（探活 —— 卡死报警 + 定期告知）────────────────────────────────
 *
 * 插入点：`runtime`（跨步骤的过程约束，契约 §5）
 * id     ：`runtime.liveness`
 *
 * ── ★ 它不是「硬超时」，是「周期性探活」—— 这个区别是根本的 ────────────────────
 *
 * ```
 * 硬超时：t=30min ⇒ 判定失败 ⇒ 结束等待      与「任务本来要多久」【无关】
 * 探活：  t=10,20,30min ⇒ 每次问「还健康吗」
 *         · 健康 ⇒ 继续等，不打断
 *         · 异常 ⇒ 报警
 * ```
 *
 * 用户原话：「有的任务确实超过 30min，10min 或 5min 探活一次比较好」。
 * ⇒ 本判据【永不】因为"等了太久"而说一句话。它只问一个更窄、也更可判定的事实：
 *   **上一次探活与这一次探活之间，它动过没有。**
 *
 * 源项目的实测缺口（`~/Desktop/自动化开发插件/src/core/with-timeout.mjs` 的文件头）：
 * 六条等子代理的通道里一条有超时、一条没有 ⇒ 循环 **63 分钟零进展**，
 * 而**没有任何一句话说它在等什么**。本判据的两半正好对着这两件事：
 *
 *   ① 卡死了   —— 两次探活，最后活动时刻没变 ⇒ `blocked`（作为【告警】，不是拒绝）
 *   ③ 定期告知 —— 不判断健康，只报「还在跑，已 N 分钟」⇒ `ok` + 一份可读的产出
 *
 * ✗ 「没进展」【不做】（用户已裁定）。「思考很久」与「卡住」在观察上同形 ——
 *   一个在两次探活之间没产出的成员，可能只是在想。判它必然误报，而误报会教人
 *   忽略这条判据。本判据**只比较两端**：`lastActivityAt` 变了没有。
 *
 * ── ★ 它是【有状态】的（本插件第一条用到契约 §5 那个许可的判据）───────────────
 *
 * ```
 * 「超时了吗」只需要：等了多久 + 一个阈值
 * 「还健康吗」需要：  等了多久 + 它现在还在动吗 + ★ 上一次探查时它在哪
 * ```
 *
 * ★ 但状态【不放在本文件里】。放在这里的代价是实测过的：判据层是一个纯模块，
 *   它被五个不同的调用点（以及夹具、以及进程级单例）使用 —— 一份藏在模块作用域里
 *   的"上次探活记录"会让同一条等待在夹具之间互相污染，而那种缺陷只在长会话里出现。
 * ⇒ 状态由**调用方**持有（每条等待一份记录），经 `wait.previous` 注入；
 *   本文件对同一份输入【永远给同一个裁决】（纯函数），因此可测、可重放。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O，**不调 `Date.now()`**。时钟（`wait.now`）、
 *    等待起点（`wait.startedAt`）、最后活动时刻（`wait.lastActivityAt`）全部由
 *    调用方注入 —— 因为会话事件**不带时间戳**（`assistant/message` 只有内容），
 *    「最后活动时刻」只能在观察到产出的那一刻【记下来】，本判据无从自己读它。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 *
 * ── ★ 它不能拒绝任务（契约 §5 硬要求）─────────────────────────────────────────
 *
 * `runtime` 位置管的是"过程健不健康"，不是"这一步过不过"。`blocked` 在这里的语义是
 * **报警 + 证据**，它落进运行日志与工具结果的 `runtime_gates` 字段，供控制台与交付
 * 时判读；调用方【不得】据此拒掉任何任务。拒任务该由 `completion` 位置上的一条判据
 * 去读这条记录（§5 原话），而不是让过程约束当场把任务卡死。
 */
import { blocked, unmeasured } from "../registry.js";
export const id = 'runtime.liveness';
export const point = 'runtime';
export const description = '周期性探活：两次探活之间最后活动时刻没变 ⇒ 告警「卡死了」；还在活动 ⇒ 只报「还在跑，已 N 分钟」。永不因为等太久而说话（它是探活，不是硬超时），也不拒绝任务（契约 §5）';
/**
 * ── 输入面：`event` + ★ **`waits`** ──────────────────────────────────────────────
 *
 * ★ `waits` 是本轮那条「建好了但没接线」的**最佳样本**，也是把这类缺陷
 *   机械抓住的地方：`waitWindows`（`tools.ts`）是完整实现 —— 有界（LRU 200）、
 *   有陈旧界限（`WAIT_WINDOW_STALE_MS` = 3 个探活间隔）、注释写清了为什么 ——
 *   而它**一度从来没有被任何地方读出来喂给判据**。于是判据的"卡死"那一半
 *   永远算不出来，日志里却读着一切正常。
 *
 *   ⇒ 声明 `waits` 之后，"这张表被读出来了吗"变成一个**可核对的事实**：
 *     团队级调用点若哪天忘了注入它，核对层会指名报出 `runtime.liveness`
 *     缺 `waits` —— 而不是等一次真实的 63 分钟零进展。
 *
 * ── ★ 为什么 `waits` 敢声明（它是**位置相关**的一格，这里逐条核过）─────────────
 *
 *   只有 `task-status` / `runtime-liveness` 会让本判据开口（{@link LIVENESS_EVENTS}），
 *   而 `task-status` 那个调用点传的是 `deliveryContext`（`{team, gate, coverage, …}`）
 *   —— 它有 `team`（含 `id` 与 `tasks` 数组）⇒ `evaluateRuntimeGates` 的注入条件
 *   成立 ⇒ **`waits` 在它唯一真正会开火的位置上确实在场**。
 *   其余四个 runtime 调用点（`member-dispatched` / `task-created` / `task-update` /
 *   `task-update-settled`）结构性拿不到 `waits`，但它们**也**不在
 *   {@link LIVENESS_EVENTS} 里 ⇒ 本判据在那些点上 `appliesTo` 为假 ⇒
 *   核对层 `skipped`、**不报**（这正是 requires.ts 那条"不适用就不说话"的闸门）。
 *
 *   ★ 所以这一格是安全的：**"能开火的位置"与"waits 在场的位置"是同一批**。
 *     若将来有人把 `LIVENESS_EVENTS` 加长到一个没有 team 的调用点，
 *     核对层会立刻报缺 —— 那正是这条声明该做的事（把"闸门与输入面不再重合"
 *     这个事实变成机械可读的），不是噪音。
 *
 * ── ★ 不声明 `wait`（单数）与 `wait.*`：它们是**另一条**合法的输入路径 ─────────
 *
 *   `gate` 的复数面分支是"`waits` 在场就用它（哪怕空数组）"，单数面是
 *   "`waits` 缺席 ⇒ 退回 `wait`"。两条路径**互为合法的替代**：
 *   · 团队级（`task-status`）走 `waits`；
 *   · 单任务级（夹具、将来的显式探活入口）走 `wait`。
 *   ⇒ 把 `wait.now` 一类写进声明，会在团队级调用点上报一处判据**根本不需要**的
 *     缺失（它走的是 `waits` 那一支）—— 那是噪音，而噪音会教人忽略门禁。
 *
 *   ★ 而"单数面拿不到观察 ⇒ `unmeasured`"这条界线**不进 requires**：
 *     它是判据自己的缺省方向（`probeOne` 的第一条分支），由本判据的三臂夹具持有。
 *
 * ── ★ 声明了 `event`（闸门自己读的那一格）────────────────────────────────────────
 *
 *   与 `verify-rerun` 同一条理由：`appliesTo` 读的就是 `event`，若声明里不写，
 *   核对层就永远说不出"这条判据的**闸门自己**缺了输入"—— 而"闸门缺输入"与
 *   "这一轮本来不适用"在 `appliesTo` 的 `false` 里同形。声明出来之后，
 *   两者在核对结果里不同形：前者 `incomplete`，后者 `skipped`。
 *
 * ★ 类型参数是**本判据自己的** ctx 类型，于是 `'wait.typo'` 这类拼写在编译期
 *   就是 TS2322（已实测），而不是等到某次探活开火时才在运行时暴露。
 */
export const requires = ['event', 'waits'];
/** 探活间隔（毫秒）。用户裁定 10 分钟 —— 5 分钟对长任务太频繁、日志会被刷屏。 */
export const DEFAULT_LIVENESS_INTERVAL_MS = 10 * 60_000;
/**
 * ── ★ V3-1（blocker）：本判据此前【在所有真实路径上恒为 skipped】──────────────
 *
 * MEASURED（2026-10-06，verifier3 / t3 的独立验证）：六处调用点传的 event 是
 * `member-dispatched` / `task-created` / `task-update` / `task-update-settled` /
 * `task-status` / `delivery-declared`，**没有任何一处**是 `'runtime-liveness'`。
 * 而本判据此前只认后者 ⇒ 它挂上去了，却一次都没跑过：
 *
 *     evaluate('runtime', {event:'task-status'})  ⇒ ok, evaluated: 0, skipped: 1
 *
 * ⇒ 源项目那个「63 分钟零进展，而没有任何一句话说它在等什么」的缺口，
 *   在本插件里**原样存在**：判据写得对，但它的输入面没接上。
 *
 * ── 修法：判据自己按【事件白名单】决定说不说话 ─────────────────────────────────
 *
 * ★ 为什么不改调用点（把某处的 event 改成 `'runtime-liveness'`）：探活本质是
 *   **跨步骤的比较**，它需要在**每次有人来看状态时**求值 —— 而那正是 `task-status`。
 *   把判据钉死在一个事件上，等于把"周期性"这件事交给某一个调用点去记。
 *
 * ★ 而白名单是**硬约束**，不是"全都跑，跑不动就 unmeasured"：后者会让五个无关的
 *   调用点每次都报一句"我没能测量" —— 噪音盖过信号，而那正是"教人忽略门禁"的
 *   另一种形态。⇒ 不该发言的事件上，它必须明确地【不适用】（`appliesTo` 为假），
 *   而不是"跑了但测不成"。这两种必须不同形（GATE-REGISTRY §8.5 规则一）。
 *
 * ★ 为什么是 `task-status`（而不是另外五个）：它是**时刻驱动**的那一个 ——
 *   用户裁定的"10 分钟探活一次"就发生在查状态时。其余五个是"这件事发生了"的
 *   通知，不是"现在几点了"的探问；在那里比较"两次探活"没有意义（同一个事件在
 *   一次调用里至多发生一次）。
 *
 * ★ `'runtime-liveness'` 这个自造事件仍留在白名单里：夹具与将来的显式探活入口
 *   用它。删掉它会让一大批直接拷 ctx 的臂无谓地变成 skipped。
 *
 * ★ 它**不**在"能开口却缺输入"时闭嘴：那种情形由 `gate` 说 `unmeasured`
 *   （见下面的"缺省方向"）。**不适用**与**没能测量**必须不同形 —— 用 `appliesTo`
 *   去藏"我拿不到时钟"，就是把「没测到」并进「通过」的那条老路。
 */
export const LIVENESS_EVENTS = Object.freeze(['task-status', 'runtime-liveness']);
export function appliesTo(ctx) {
    return typeof ctx?.event === 'string' && LIVENESS_EVENTS.includes(ctx.event);
}
/**
 * ── ★ 间隔参数的解析：非法值【不加界】而不是抛错 ───────────────────────────────
 *
 * 源项目先例的原文理由（`with-timeout.mjs`）：
 *
 * > `ms` 非法时【不加界】而不是抛错 —— 一个因为参数没写对就炸的守卫，会在第一次
 * > 出问题时被关掉。
 *
 * ★ 而本判据里"不加界"的语义与源项目**不同形**，这是刻意的：源项目不加界 = 永远
 *   不超时（等待继续）；本判据不加界 = 探活永不触发（等待继续，且【没有人说话】）。
 *   两者都是"不打断"，而本判据本来就从不打断 —— 所以这一步只影响"多久问一次"。
 *
 * ★ 缺省方向是【能说的那一侧】：参数没写对 ≠ 判据失效。0 / NaN / 负数 / Infinity /
 *   `null` / 非数 一律落回 10 分钟，于是"间隔写错了"与"探活根本不发生"不同形。
 *
 * ★ 而【缺席】与【给了个坏值】不同形：缺席是正常（用缺省、不留痕迹），给了坏值
 *   要留下 `interval_ignored`（见 `gate` 的产出）。把两者合成一个标记，会让每一次
 *   正常运行都带着一句"参数被忽略" —— 而人就会学会忽略它。
 */
function resolveIntervalMs(value) {
    if (value === undefined)
        return { ms: DEFAULT_LIVENESS_INTERVAL_MS };
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return {
            ms: DEFAULT_LIVENESS_INTERVAL_MS,
            why: `the probe interval ${JSON.stringify(value)} is not a finite positive number; the wait stays unbounded (the probe never fires on its own) and the default interval of ${DEFAULT_LIVENESS_INTERVAL_MS} ms is used instead of throwing`,
        };
    }
    return { ms: value };
}
/** 一个可读的时长（探活是人读的告警，不是给机器的日志行）。 */
function minutes(ms) {
    return String(Math.round(ms / 60_000));
}
function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
/**
 * ── ★ V3-3：`blocked` / `unmeasured` 也必须交出证据 ────────────────────────────
 *
 * 契约 §5 说 runtime 的产物是「**告警 + 证据**」。而注册表的 `blocked(...)` /
 * `unmeasured(reason)` 只吃字符串 —— 这一条**不是**要改注册表（那是别的判据共用的
 * 接口，改它会波及所有人），而是说：**判据可以在它们上面叠字段**。
 *
 *     { ok: false, blockers: [...], ...证据 }
 *
 * ★ 为什么这是安全的（读过注册表才敢这么写，不是猜的）：
 *   · `assertVerdict` 只校验 `ok` 的类型、以及 `ok:false` 时**至少说出一种原因**
 *     （`blockers` 与 `unmeasured` 二选一，不许同时有）。多出来的字段它不看、不拒。
 *   · 合并时 `blockers` 与 `unmeasured` 被**原样取出**，其余字段只对 `ok:true` 的产出
 *     （`outputs`）收集 —— 所以叠上去的证据不会污染裁决本身。
 *   · 类型上 `GateVerdict` 的 `ok:false` 那两支没有多余字段的签名，因此这里显式
 *     标成 `GateVerdict`（结构兼容，只是把证据一起交出去）。
 *
 * ⇒ 于是"判据唯一会告警的那条分支恰好把证据全丢了"这件事不再可能：**证据是构造
 *   裁决的参数，而不是某个分支顺手记得带上的一段代码。**
 */
function blockedWith(blockers, evidence) {
    return { ...blocked(...blockers), ...evidence };
}
function unmeasuredWith(reason, evidence) {
    return { ...unmeasured(reason), ...evidence };
}
/**
 * 一条等待的【标签】：告警要能指名是哪个成员/哪个任务。
 *
 * ★ 它优先用 `wait` 自己带的身份（团队级调用点上有 N 条，`ctx.task` 是**不适用**的），
 *   只有在 `wait` 上也没有时才退回 `ctx.task`。用一个全局的 `ctx.task` 去标注
 *   每一条 `waits` 条目，会让 N 条告警全部指向同一个名字 —— 那比不说更坏。
 */
function whoOf(wait, ctx) {
    const named = wait.memberName !== undefined && wait.memberName !== ''
        ? `member "${wait.memberName}"`
        : wait.taskId !== undefined && wait.taskId !== ''
            ? `task ${wait.taskId}`
            : undefined;
    if (named !== undefined)
        return named;
    return ctx?.task?.assignee !== undefined && ctx.task.assignee !== ''
        ? `member "${ctx.task.assignee}"`
        : ctx?.task?.id !== undefined && ctx.task.id !== ''
            ? `task ${ctx.task.id}`
            : 'the waiting step';
}
/**
 * ── ★ 单数 / 复数：两种观察面，一个判据 ────────────────────────────────────────
 *
 * `gate` 只做**分派**，真正的探活在 {@link probeOne} 里。这样"哪些结论有证据"
 * 这类问题只有一处要读，而两个形状各自的分界（见下）也各自只有一处。
 */
export function gate(ctx) {
    const waits = ctx?.waits;
    /**
     * ★ 复数面【在场】时就用它（哪怕它是空数组）。
     *
     * 这与"单数缺席 ⇒ unmeasured"不冲突，因为它们是**两个不同的问题**：
     *   · `waits: []`  —— 观察了，这个队此刻没有人在等 ⇒ **不适用**（ok + skipped 标记）
     *   · `wait` 缺席  —— 有一个等待，而我没拿到它的观察 ⇒ **没能测量**（unmeasured）
     * 把前者读成后者，会让每一个没有等待的团队都背上一句"我没测成"；
     * 把后者读成前者，会让一次读取失败伪装成"没人卡住"。
     */
    if (Array.isArray(waits)) {
        if (waits.length === 0) {
            return {
                ok: true,
                skipped: 'no attempt is waiting in this team right now (the team was observed, and nobody is waiting)',
                probes: [],
                stuck_count: 0,
            };
        }
        const probes = waits.map((entry) => ({ entry, verdict: probeOne(entry, ctx) }));
        const stuck = probes.filter((probe) => probe.verdict.ok === false && Array.isArray(probe.verdict.blockers));
        /**
         * ★ 复数面【不短路、也不合并】**：每个等待各自是一个结论。
         *
         *   · 有任何一条卡死 ⇒ 整体 `blocked`，且**逐条**列出是谁 —— 一次只报一个
         *     会让人修完一个再等下一个（本队为"不短路"已经交过一次学费）；
         *   · 全都没卡死但有一条没测成 ⇒ `unmeasured`（未测量优先于通过，契约 §3）；
         *   · 全都没事 ⇒ `ok`。**"没人卡住"与"我测不了"必须不同形。**
         */
        if (stuck.length > 0) {
            return blockedWith(stuck.flatMap((probe) => probe.verdict.blockers), { probes: probes.map((probe) => probe.verdict), stuck_count: stuck.length, waited_count: waits.length });
        }
        const unmeasuredProbe = probes.find((probe) => probe.verdict.ok === false);
        if (unmeasuredProbe !== undefined) {
            return unmeasuredWith(unmeasuredProbe.verdict.unmeasured, { probes: probes.map((probe) => probe.verdict), waited_count: waits.length });
        }
        return {
            ok: true,
            probes: probes.map((probe) => probe.verdict),
            stuck_count: 0,
            waited_count: waits.length,
            message: `${waits.length} waiting attempt(s); none of them has been silent for a full probe interval`,
        };
    }
    return probeOne(ctx?.wait, ctx);
}
/** 一条等待的探活。`wait` 缺席 ⇒ 没能测量（见下面的缺省方向）。 */
function probeOne(wait, ctx) {
    const who = wait === undefined ? (ctx?.task?.assignee !== undefined && ctx.task.assignee !== ''
        ? `member "${ctx.task.assignee}"`
        : ctx?.task?.id !== undefined && ctx.task.id !== ''
            ? `task ${ctx.task.id}`
            : 'the waiting step') : whoOf(wait, ctx);
    /**
     * ── ★ 缺省方向：拿不到观察 ⇒ `unmeasured`，**不是** `ok` ───────────────────────
     *
     * MEASURED 的教训（本轮反复出现）：一条判据在拿不到它需要的观察时返回 `ok`，
     * 就是"装上了但从不生效"——比没装更坏，因为它会让人以为探过了。
     *
     * 这里的三项各自都是不可推断的：
     *   · `now`           —— 判据不读表（性质 ①），没有注入的时钟就没有"现在"
     *   · `startedAt`     —— 没有等待起点就说不出"已等 N 分钟"（第 ③ 种探活的最小面）
     *   · `lastActivityAt`—— 没有活动读数就无法比较两端（第 ① 种探活的最小面）
     *
     * ★ 它们【不】合成一句话：缺哪一项决定了这次探活能不能做，而"缺时钟"与
     *   "缺活动观察"是两种不同的基础设施缺失。
     */
    if (wait === undefined || wait === null) {
        return unmeasuredWith(`the liveness probe received no wait observation at all, so whether ${who} is still making progress could not be determined (this is not evidence that it is alive)`, 
        // ★ 连一份观察都没有 ⇒ 唯一诚实的证据是"缺的是什么"，绝不替没读到的项编值。
        { observation: 'none', interval_ms: resolveIntervalMs(undefined).ms });
    }
    const missing = [];
    if (!finite(wait.now))
        missing.push('the clock reading (wait.now)');
    if (!finite(wait.startedAt))
        missing.push('the start of the wait (wait.startedAt)');
    if (!finite(wait.lastActivityAt))
        missing.push('the last observed activity (wait.lastActivityAt)');
    if (missing.length > 0) {
        return unmeasuredWith(`the liveness probe is missing ${missing.join(' / ')}, so whether ${who} is still making progress could not be determined `
            + '(an unobserved wait is not a healthy one — and this is not evidence that it is stuck either)', 
        // ★ 把"缺的是哪几项"原文交出去；已经读到的项也照实交（它们是真的读到的）。
        { missing, interval_ms: resolveIntervalMs(wait.intervalMs).ms });
    }
    const now = wait.now;
    const startedAt = wait.startedAt;
    const lastActivityAt = wait.lastActivityAt;
    const { ms: intervalMs, why: intervalWhy } = resolveIntervalMs(wait.intervalMs);
    /**
     * ── ★ V3-3：证据必须【先于所有分支】建好，并在**每一条**返回路径上交出去 ──────
     *
     * MEASURED（2026-10-06，verifier3 / t3）：`wait_ms` / `startedAt` /
     * `lastActivityAt` / `previous_last_activity_at` / `updated_since_previous_probe` /
     * `interval_ms` / `interval_ignored` 此前**只出现在 `ok` 分支上**。契约 §5 说
     * runtime 的产物是「**告警 + 证据**」—— 而判据唯一会告警的那条分支恰好把证据
     * 全丢了，调用方只能去正则那段人话。**告警没有证据，就只是一句话。**
     *
     * ★ 所以这里把它拆成三个【很窄】的构造器，各自只放它那一格真正**测到过**的东西：
     *   · 连时钟/起点/活动读数都没拿全时，只交 `missing` 与 `interval_ms`
     *     —— 绝不为没读到的项编一个值（那会把"没测到"伪造成"测到了"）；
     *   · 拿到可比的两端之后，才交 `observed_span_ms` 与 `interval_complete`。
     * 几个构造器共用同一个起点，于是"哪个分支有哪些证据"这件事在源码里一眼可数。
     */
    /** 时间对齐与间隔：只要时钟与起点可用就能交，与有没有上一次探活无关。 */
    const timingEvidence = (span) => ({
        wait_ms: now - startedAt,
        startedAt,
        now,
        interval_ms: intervalMs,
        ...span === undefined ? {} : { observed_span_ms: span, interval_complete: span >= intervalMs },
    });
    /** 两端读数都在手的证据（`observedSpan` 由调用处给）。 */
    const comparisonEvidence = (observedSpan) => ({
        ...timingEvidence(observedSpan),
        lastActivityAt,
        ...previousActivityAt === undefined ? {} : { previous_last_activity_at: previousActivityAt },
    });
    /**
     * ── ★ 时钟回拨（`now < previousPollAt`）⇒ `unmeasured` ────────────────────────
     *
     * 一个往回走的时钟让「这 10 分钟里它动过没有」这个问题**无法回答**：
     * 时长是负的，而"负的时长里没有活动"既不是"卡死"也不是"健康"。
     *
     * ★ 两种都不能选，各自都有明确的坏处：
     *   · 读成"刚活动过"（`ok`）—— 把一次**没能测量**并进了「通过」，正是本判据
     *     存在的理由要防的那件事；
     *   · 读成"超时了"（`blocked`）—— 一次时钟抖动会变成一条**假警报**，
     *     而假警报会教人忽略这条判据（用户裁定的那条理由，逐字适用）。
     * ⇒ 唯一的诚实答案是 `unmeasured`，并说清是时钟的问题，不是成员的问题。
     *
     * ★ 顺序：这一条在"第一次探活"**之后**判（没有可比对象时，回拨本来就测不出来）。
     *   反过来写会让"第一次探活 + 时钟回拨"落进 `unmeasured`，而第一次探活本来
     *   就没有"两个读数不可比"这件事 —— 它只有一端。
     */
    const hasPreviousProbe = finite(wait.previousPollAt);
    if (hasPreviousProbe && now < wait.previousPollAt) {
        return unmeasuredWith(`the clock went backwards between the last liveness probe and this one for ${who} `
            + `(previous probe at ${wait.previousPollAt}, now ${now}); 'did anything happen in the last interval' cannot be answered from a negative interval `
            + '— this is a clock problem, not evidence that the member is stuck', 
        // ★ 负的间隔本身就是这条告警的证据（下一次探活要能读出"回拨了多少"）。
        { ...timingEvidence(now - wait.previousPollAt), previousPollAt: wait.previousPollAt });
    }
    const elapsed = now - startedAt;
    /**
     * ── ★ 「第一次探活」= 【没有任何上一次记录】，由字段缺席判定 ───────────────────
     *
     * 唯一的判据是 `previousPollAt` 在不在（t5 的约定）。**不是**计数值、也**不是**
     * "上一次的活动读数在不在"：后者只在观察面读不到时才缺席，把它当成"第一次"
     * 会让一次读不到的观察被读成"这是第一次探活"，而不是"这一次没能比较"。
     *
     * ★ 而"第二次但缺活动读数"是**可判定的未测量**（t5 的两种情形：还没观察到任何
     *   产出 / 会话读不到）—— 它不是"第一次"，两者在诊断上不同形，在这里也不同形。
     */
    const previousActivityAt = wait.previousLastActivityAt;
    const hasPreviousActivity = finite(previousActivityAt);
    /** 无论哪条路径都交出去的证据（判据的产物是【告警 + 证据】，契约 §5）。 */
    const evidence = {
        wait_ms: elapsed,
        startedAt,
        lastActivityAt,
        interval_ms: intervalMs,
        /**
         * ★ 上一次读到的活动时刻 —— 读不到就交 `null`，**不交 `undefined`**：
         *   `undefined` 在 JSON 里会整个字段消失，于是"我没有上一次的读数"与
         *   "这条判据不产出这个字段"同形。判据的产物要能被直接读。
         */
        previous_last_activity_at: hasPreviousActivity ? previousActivityAt : null,
        /**
         * ★ 这一次的活动对上一次是否有推进：
         *   `true` / `false` 是**测量结论**（比过了）；`null` 是**没能比较**
         *   （第一次探活，或这一次根本没拿到上一次的活动读数）。
         *   把 `null` 写成 `false` 会让"还没比过"读起来像"确认它没动" —— 那是假报警。
         */
        updated_since_previous_probe: hasPreviousActivity ? previousActivityAt !== lastActivityAt : null,
    };
    if (intervalWhy !== undefined)
        evidence['interval_ignored'] = intervalWhy;
    /**
     * ── ① 第一次探活：没有可比对象 ⇒ 只报「还在跑，已 N 分钟」─────────────────────
     *
     * ★ 「没有上一次」既不是"健康"也不是"卡死"。卡死是一个【比较】的结论，比较需要
     *   两端；只有一端时唯一诚实的话是"它在跑、等了多久"。这里给 `ok`（它是探活的
     *   常规状态，不是"没测到"），但同时交出 `first_probe: true`，好让读日志的人
     *   分得出"第一次探活"与"第二次探活、确认它还在动"—— ★ 两者必须不同形，
     *   否则"我等了 10 分钟还没看过它"会读起来像"我确认过它还活着"。
     */
    if (!hasPreviousProbe) {
        return {
            ok: true,
            ...evidence,
            ...comparisonEvidence(undefined),
            first_probe: true,
            alive: null,
            stuck: null,
            message: `${who} is still running: ${minutes(elapsed)} minute(s) of the ${minutes(intervalMs)}-minute probe interval have elapsed `
                + '(first probe — there is nothing to compare against yet, so this is not a health judgement)',
        };
    }
    /**
     * ── ★ 第二次探活、却拿不到上一次的活动读数 ⇒ `unmeasured`，不是"它还在跑" ──────
     *
     * t5 的两种情形都在这里落地：**还没观察到任何产出**（派发过、一条非空
     * `assistant/message` 都没有）与**读不到该成员的会话**（没有 live Agent / 成员
     * 从未 spawn）。两者在诊断上不同形，但在这个格子里是同一件事：没有可比的那一端。
     *
     * ★ 绝不能读成 `ok`（"它还在跑"）：那正是把「没能测量」并进「通过」的形态 ——
     *   而且是最难发现的一种，因为报告读起来完全正常（有 message、有 wait_ms）。
     */
    if (!hasPreviousActivity) {
        return unmeasuredWith(`this is the second liveness probe for ${who} but the last activity reading of the previous probe is missing `
            + '(the session was unreadable, or no output had been observed yet), so whether it has moved since then could not be determined '
            + '— an uncomparable probe is not a healthy member', { ...timingEvidence(now - wait.previousPollAt), lastActivityAt, previousPollAt: wait.previousPollAt });
    }
    const moved = previousActivityAt > lastActivityAt;
    const stuck = previousActivityAt === lastActivityAt;
    /**
     * ── ★ V3-4：告警的前提是【这个间隔真的过完了】，不只是"两端读数相同" ──────────
     *
     * MEASURED（2026-10-06，verifier3 / t3）：此前只推进了**半个间隔**、而活动读数
     * 没变，判据照样 `blocked`，措辞里却写着 "has not moved for a **full** 10-minute
     * probe interval"。**措辞与实际判据不符** —— 读日志的人会据此算错账。
     *
     * ★ 判据不是"只比两端"：`lastActivityAt` 相同只说"这之间没动过"，而"没动过多久"
     *   要看**这两次读数之间**到底隔了多久 —— 那是 `now - previousPollAt`，不是
     *   `now - startedAt`，也不是任何读数的差。
     *
     * ★ 为什么边界归**告警**这一侧：等待记录的 `lastPollAt` 是在上一次探活**交接时**
     *   写下的（见 `waitObservationFor`），所以两次探活之间的间隔**恒 >= intervalMs**
     *   —— 真实的 10 分钟探活节拍下，`observedSpan >= intervalMs` 永远成立。
     *   把它们写成 `>` 会让"正好 10 分钟"漏报，而那正是这条判据唯一要抓的形态。
     *   ⇒ `>=` 是刻意的：真实的抖动落在"大于"那一侧，边界留给等号。
     */
    const observedSpan = hasPreviousProbe ? now - wait.previousPollAt : undefined;
    const intervalElapsed = observedSpan !== undefined && observedSpan >= intervalMs;
    /**
     * ── ①【卡死了】一个完整间隔里最后活动时刻没变 ⇒ `blocked`（作为【告警】）───────
     *
     * 这是机器可判的确定性事实：真的没动就是没动。它【不】读 status、不读输出长度、
     * 不猜"它是不是在想"—— 那些都只在"没进展"那一种里才有位置，而那一种被明确砍掉了。
     *
     * ★ 措辞必须让人知道「这不会打断任何东西」：读到这条告警的人要去**看一眼**，
     *   而不是等任务被掐掉（本判据没有掐的能力，这是契约 §5 的设计）。
     */
    if (stuck && intervalElapsed) {
        return blockedWith([
            `${who} has been waiting ${minutes(elapsed)} minute(s) and its last observed activity has not moved for a full ${minutes(intervalMs)}-minute probe interval `
                + `(last activity ${lastActivityAt} at both probes, ${minutes(observedSpan)} minute(s) apart) — this is a liveness alarm, not a rejection: the task is not cancelled and nothing is unwound; `
                + 'check what it is waiting on',
            ...(intervalWhy === undefined ? [] : [intervalWhy]),
        ], {
            ...comparisonEvidence(observedSpan),
            ...evidence,
            first_probe: false,
            alive: false,
            stuck: true,
            updated_since_previous_probe: false,
            interval_complete: true,
        });
    }
    /**
     * ── ③【定期告知】⇒ `ok` + 一份可读的产出 ──────────────────────────────────────
     *
     * 这个分支**不判断健康**，它只让等待【有话说】：源项目的缺口原话正是
     * 「没有任何一句话说它在等什么」。
     *
     * ★ 它【不】产出第三态（例如 `verdict: 'still-running'`）：`GateVerdict` 的三态是
     *   `ok / blocked / unmeasured`，多一态在 `assertVerdict` 那层是**抛错**，不是通过。
     *   "还在跑"这件事由 `alive: true` + `message` 表达，它就是 `ok`。
     *
     * ★ 走到这里有两种情形，它们必须【不同形】（否则第二种会读起来像"它动了"）：
     *   · `moved`（读数倒退了）—— 观察面自己不自洽，照常报"还在跑"但留下
     *     `observation_inconsistent`；
     *   · `stuck && !intervalElapsed`（V3-4）—— **两端相同，但两次读数之间还不到一个
     *     间隔**。这不构成报警（"卡死"的定义是一个完整间隔里没动），也**不是**"它动过"。
     *     ⇒ 报"还在跑"，并把 `interval_complete: false` 交出来，让读日志的人知道
     *       这一次**还没到下结论的时候**。
     */
    const withinInterval = stuck && !intervalElapsed;
    return {
        ok: true,
        ...evidence,
        first_probe: false,
        alive: true,
        stuck: false,
        interval_complete: intervalElapsed,
        ...moved ? { observation_inconsistent: `the last observed activity moved backwards (${previousActivityAt} -> ${lastActivityAt}); the wait observation is not self-consistent, so this probe reports "still running" rather than a health judgement` } : {},
        message: withinInterval
            ? `${who} is still running: ${minutes(elapsed)} minute(s) elapsed, and its observed activity has not moved — but only ${minutes(observedSpan)} of the ${minutes(intervalMs)}-minute probe interval have passed since the last probe, so this is not yet a liveness judgement`
            : `${who} is still running: ${minutes(elapsed)} minute(s) elapsed and its observed activity moved within the last ${minutes(intervalMs)}-minute probe interval`,
    };
}
