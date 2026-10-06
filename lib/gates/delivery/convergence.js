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
import { blocked, unmeasured } from "../registry.js";
export const id = 'delivery.convergence';
export const point = 'delivery';
export const description = '交付时每个成员都必须处在收敛态；working / unknown / 空白回复都不是收敛 ⇒ 拒绝（idle ≠ converged，空回复不是收敛）';
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
export const requires = ['team'];
/**
 * 生效条件：调用点把团队传进来了（"这一步就是交付判读"的信号）。
 *
 * ★ 本判据**不**用 `appliesTo` 排除"没有成员"的情形：那正是对照臂要表达的 `ok`，
 *   写进 `appliesTo` 会让它落进 `skipped` —— 而 `skipped`（判据没跑）与
 *   `unmeasured`（判据跑了说测不了）必须不同形（t9 已经为观察模式钉过这条界线）。
 */
export function appliesTo(ctx) {
    return ctx?.team !== undefined;
}
/** 收敛态的白名单 —— 只有这两个是"收敛"。其余一律拒绝（★ 白名单而不是黑名单：见 gate 的说明）。 */
const CONVERGED_STATES = ['idle', 'reported'];
/** 读不懂的一行。 */
function isMalformed(entry) {
    return entry !== null && typeof entry === 'object' && !Array.isArray(entry);
}
export function gate(ctx) {
    const observations = ctx?.members;
    /**
     * ★ 拿不到成员状态 ⇒ `unmeasured`，不是 `ok` —— 这一点由验收专门钉住：
     *   "拿不到成员状态 ⇒ unmeasured，不得当成收敛"。
     *
     *   为什么它与 `members: []` 必须不同形：一次读取失败会让**每一个**成员都消失，
     *   而"这个团队确实没有成员"是正常的。把两者合流，就等于用一次基础设施故障
     *   宣布"全队都收敛了"。
     */
    if (observations === undefined || observations === null) {
        return unmeasured('the members\' convergence state was not observed (no member observations were provided to the delivery position), '
            + 'so "every member has converged" could not be established — an unobserved team is not a converged team');
    }
    if (!Array.isArray(observations)) {
        return unmeasured(`the member convergence observations are not a list (got ${typeof observations}), so whether every member has converged could not be determined`);
    }
    /**
     * ── 读不懂的行：未测量，且【不静默跳过】──────────────────────────────────────
     *
     * 一行读不懂可能是**任意**一个成员 —— 而"我没能读某个成员的状态"与"那个成员收敛了"
     * 在交付裁决上完全相反。所以这里不是"跳过这一行"，是"这场交付测不成"。
     *
     * ★ 但"观察了一个没有名字的成员"是另一回事：名字只是标签，状态才是判据要读的东西。
     *   所以缺 name 不算读不懂（下面按 `member[<i>]` 指代），缺/坏 state 才算。
     */
    const malformed = [];
    const seen = [];
    observations.forEach((entry, index) => {
        const label = `member[${index}]`;
        if (!isMalformed(entry)) {
            malformed.push(`${label} is not an object (got ${JSON.stringify(entry)})`);
            return;
        }
        const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : label;
        const state = entry.state;
        if (typeof state !== 'string' || state.trim() === '') {
            malformed.push(`${name} has no observed state (got ${JSON.stringify(state)})`);
            return;
        }
        if (entry.spoke !== undefined && typeof entry.spoke !== 'boolean') {
            malformed.push(`${name} reports spoke=${JSON.stringify(entry.spoke)}, which is neither true nor false`);
            return;
        }
        seen.push({
            name,
            state: state,
            ...entry.spoke === undefined ? {} : { spoke: entry.spoke },
            ...typeof entry.error === 'string' && entry.error.trim() !== '' ? { error: entry.error } : {},
        });
    });
    if (malformed.length > 0) {
        return unmeasured(`the member states could not be read in full (${malformed.join('; ')}), so a member that never converged could be hiding in the unreadable rows`);
    }
    /**
     * ★ `spoke` 缺席 ⇒ 未测量，**且必须在任何通过之前判定**。
     *
     *   这是"空回复不是收敛"落到形状上的那一半：一条没有观察过输出的成员，
     *   与一个"明确说了没有别的事"的成员，不能给出同一条裁决。
     *   （判定顺序与 `mutation-guard` 同构：没能测量先于"干净"被判定。）
     *
     * ★★ 但 `never-spawned` 是例外，且这个例外是本判据的**语义**而不是宽松（t15）：
     *
     *   一个从未 spawn 的成员**本来就没有会话**，所以"它最后说了什么"这一位
     *   **不存在**——不是"没能读到"。要求它必须有 `spoke`，等于要求调用方为一个
     *   没起来过的成员编一份发言记录；而那正是 t15 要消灭的形状。
     *
     *   ⇒ 对这类成员，`spoke` 的有无**不影响裁决**：它已经在【可判定】的那条路上
     *     （下面白名单分支里它必然落进 unresolved ⇒ blocked）。
     *     这与"空回复"不同形：那里是"读到并且是空的"，这里是"根本没有这一段"。
     */
    const unmeasuredSpokes = seen.filter((member) => member.spoke === undefined && member.state !== 'never-spawned');
    if (unmeasuredSpokes.length > 0) {
        return unmeasured(`whether ${unmeasuredSpokes.map((member) => member.name).join(', ')} last said anything was not observed, `
            + 'so "this member converged" could not be told apart from "this member went quiet" '
            + '(a silent member and a converged member look identical without that observation)');
    }
    /**
     * ── 白名单而不是黑名单 ──────────────────────────────────────────────────────
     *
     * 只把 `idle` / `reported` 当成收敛，其余一律拒绝。理由：上游的活动枚举今天是
     * `running | idle | ready`，而**未来多一个取值时**，黑名单会把它读成"不是 working
     * ⇒ 收敛"（静默放行），白名单会当场拒绝（可见）。这与 `evaluate()` 里那句
     * "非法形状抛错而不是被当成通过"是同一条纪律：**一个新的、没见过的状态值，
     * 缺省方向必须是拒绝，不是放行。**
     */
    const unresolved = [];
    for (const member of seen) {
        if (member.state === 'reported')
            continue;
        if (member.state === 'idle') {
            /**
             * ★ `idle` + `spoke === false`（最近一次输出是空的）⇒ **不是收敛**。
             *   这正是本判据存在的全部理由：上游只看得见 `idle`，而"空回复"落进
             *   `idle` 之后看起来与"做完了"完全一样。
             */
            if (member.spoke === false)
                unresolved.push(member);
            continue;
        }
        unresolved.push(member);
    }
    if (unresolved.length > 0) {
        return blocked(unresolved.map((member) => {
            const why = member.state === 'never-spawned'
                /**
                 * ★ 「它从未起来过」是一条**可判定的事实**，所以拒绝的措辞必须说这件事本身，
                 *   而不是笼统的"不是收敛态"。读日志的人据此知道下一步该查依赖/派发，
                 *   而不是去查状态读取 —— 两件事的动作完全不同（t15 验收专门钉住这条）。
                 */
                ? 'it was never started (its session id is empty: a dependency was unsatisfied or the start was refused), and a member that never ran has returned nothing'
                : member.state === 'idle' && member.spoke === false
                    ? 'its last reply was empty, and an empty reply is not a convergence (it may simply have gone quiet)'
                    : member.state === 'working'
                        ? 'it is still working'
                        : member.state === 'failed'
                            ? 'it reported a failure'
                            : member.state === 'reported'
                                ? 'it reported a convergence that was contradicted by an empty reply'
                                : `its observed state "${member.state}" is not a convergence state (only "idle" and "reported" are)`;
            return `member "${member.name}" has not converged: ${why}${member.error === undefined ? '' : ` (${member.error})`}`;
        }));
    }
    /**
     * ★ 通过时交出产出：让交付记录里留着【门禁亲眼看过的成员状态】，
     *   而不是只留一句"都收敛了"。空团队也在产出里说明白 —— 于是
     *   "这个团队没有成员"与"这个团队所有成员都收敛了"在记录里不同形。
     */
    return {
        ok: true,
        converged_members: seen.map((member) => member.name),
        ...seen.length === 0 ? { converged_note: 'the team has no members to converge (observed, not assumed)' } : {},
    };
}
