/**
 * ── 判据：循环够了没有 —— 三条都过 ⇒ 可以自动成团 ────────────────────────────────
 *
 * 插入点：`admission`（成团【之前】：这份需求 / 计划够不够格进场）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 用户对这一段的形态要求是原话：
 *
 *     「产物非空 + 无未审改动 + 无待确认问题 ⇒ 自动成团（用户明确不需要点头）」
 *
 * 而"要不要成团"在此之前是一条**靠人执行的规则**：主会话看着对话觉得"聊得差不多了"，
 * 就 `create({approval:'required'})`。用户的原话点破了它的性质：
 *
 *     「以前这些都是手动做的，什么时候触发也是凭我的个人经验。」
 *
 * ⇒ 本判据把"够了"换成一个**机械可判**的问题，三个条件各自有一格可观察的证据：
 *
 *     ① 产物存在且非空              —— 有没有东西可以成团（有一份需求 / 计划被写下来）
 *     ② 无未审改动                  —— 最后一次审查的版本 == 当前版本（**读前一条的结论**）
 *     ③ 无待确认问题                —— `open-questions.json` 里没有未回答的问题
 *
 * 三条全过 ⇒ `ok`（= 可自动成团，编排层据此调 approve）；
 * 缺哪条 ⇒ `blocked` 且**说清缺的是哪一条**（`unmeasured` 是第三态，见下）。
 *
 * ── ★★ 第 ② 条【读 checkpoint 的结论】，不重算 ───────────────────────────────
 *
 * 本队已记账的「两份真相」出现过三次，其中一次就是**同一个量被算了两次**。
 * 所以这里有一条硬纪律：
 *
 *     `admission.checkpoint` 判的是「产物相对上次审查的版本变了没有」
 *     本判据判的是「循环够了没有」—— 它**包含**第 ② 条
 *     ⇒ 读它的**裁决**，不自己再比对一次 git
 *
 * ★ 而"读它的裁决"这件事本身必须**可观测**，不能靠本判据自己回忆：
 * 调用方把上游两条判据的裁决**原样**注入（`upstream`），本判据只做三件事 ——
 * 看那两份裁决的**态**、把它们翻译成第 ①②③ 条的读数、给出成团裁决。
 *
 * ★★ "拿不到版本"与"没有未审改动"必须不同形（本任务最贵的一条）：
 *
 *     checkpoint 的结论是 `unmeasured`（拿不到版本）
 *       ⇒ 本判据的第 ② 条**跟着 unmeasured**，绝不是"没问题"
 *
 *   一个把 `unmeasured` 折成"那就当没改动"的实现，就是本队反复记账的
 *   「把没测到并进通过」—— 而它的坏法是**看起来最好**的那种：
 *   最需要成团判据说话的时刻（git 读不出来、没人接线），它放行。
 *
 * ── ★ 成员数上限兜底（用户裁定）──────────────────────────────────────────────
 *
 * 「判据全过 ⇒ 可自动成团，不需要用户点头」+「但设成员数上限兜底：
 *   超过上限 ⇒ 不自动，回到要人确认」。
 *
 * 理由（用户原话）：**成员名是不可回收的稀缺资源**（该项目 §22 实测过上限 8）。
 * 一个"够格"的团队若会撑破成员上限，它够格的只是**内容**，不是**规模** ——
 * 而规模这件事必须由人拍板，因为涨上去就退不回来。
 *
 * ★ 所以上限**不是第三条验收**，它是自动成团的**资格开关**：破了上限时裁决仍是
 *   `blocked`，但那一条 blocker 说的是"需要人确认"，而不是"循环没走完"。
 *   ★ 两者必须不同形 —— 它们的补救动作完全不同（去问人 vs 回去再审）。
 *
 * ★ 本判据**不**真的调 approve（那是编排层的事）：它只交出「能不能成团」的裁决
 *   与证据。本文件里没有一处 I/O。
 *
 * ── 三态，且后两者不同形（契约 §3.4）────────────────────────────────────────────
 *
 *   ok          —— 测成了：三条全过（且没破成员上限）⇒ 可自动成团
 *   blocked     —— ★ 测成了：缺了某一条（或破了上限）⇒ 说清缺什么、为什么不能自动
 *   unmeasured  —— ★ 没能测量：观察面没接上（没有产物表 / 没有上游裁决 / 没有提问表）
 *
 * ── ★ 四条已记账的恒真写法（本文件逐条避开）──────────────────────────────────
 *
 *   ① 恒真：三个条件**各自**是一次真的判别 —— 每一条都有自己的 blocked 臂
 *      （见夹具），而"三条都过 ⇒ ok"不许靠 `return ok()` 兜底（那是兜底恒真）。
 *   ② 恒红：三条中**任意一条**不过就 blocked —— ★ 但绝不能把三条合成一个布尔：
 *      那样"没产物"与"有问题没答"在日志里同形，而补救动作完全不同。
 *   ③ 读错位置的出口：第 ② 条读 `upstream['admission.checkpoint']` 的**态**，
 *      而**不是**读 `upstream` 上任意一个 `ok` 字段 —— 更不是读本判据自己的
 *      `documents` 去重算一遍版本比较（那正是"两份真相"）。
 *   ④ 守卫检查了另一个同名的东西：`producedDocuments` 缺席与 `[]` **不同形**；
 *      `openQuestions` 缺席与"空数组"**不同形**；`upstream` 里**没有**
 *      `admission.checkpoint` 这个键与"它在那儿、且是 ok"**不同形**。
 *      ★ 尤其：一个 `?? {}` 兜底会把"没人接线"读成"上游都说没问题" ⇒ 恒真。
 *
 * ── ★★ MEASURED（t13，本文件真的犯过一次第 ④ 种）──────────────────────────────
 *
 * 上面那句"`openQuestions` 缺席与空数组不同形"**写在这里**，而盘上的代码有一段时间
 * 违反它：`openQuestions` 缺席与 `[]` 返回**完全相同的 JSON**（都 `ok`、
 * 都 `noPendingQuestion: true`）——
 *
 *     调用方根本没接 `open-questions.json` ⇒ 判据说"问题都答完了" ⇒ 自动成团
 *
 * 成因不是条件 ③ 的逻辑写错了（`pendingQuestions` 一直正确地对缺席返回
 * `unmeasured`），而是**交付的源码里留着一个突变体**：定向突变臂的还原没有跑完，
 * 于是 `if (questions.state === 'unmeasured')` 被一条 `!MUTATED` 短路常量挡住。
 * ⇒ 两件事都记在这里，因为它们是同一个教训的两半：
 *
 *   ① 一条写在**注释里**的不变量不等于一条**被夹具钉住的**不变量 ——
 *      本文件头这段话当时一个字都没改，而代码已经违反它了。
 *   ② 突变臂的还原必须**在进程被任何方式终止时**都发生（`process.on('exit')`
 *      兜底 + 还原永不抛）。★ 而这次事故证明兜底**还不够**：会话中断（而非
 *      测试失败）也会把变异体留在盘上 —— 所以夹具里另有一条**总是运行**的
 *      二次对照，检查源码里**没有** `MUTANT` 标记（见
 *      `scripts/gate-admission-convene.test.mjs` 的"污染检查"）。
 */
import { blocked, unmeasured } from "../registry.js";
import { normalizeWorkspacePath } from "../../quality-gates.js";
export const id = 'admission.convene';
export const point = 'admission';
export const description = '自动成团的三条件：产物非空 + 无未审改动（读 admission.checkpoint 的结论）+ 无待确认问题（读 open-questions.json 的观察）；三条全过即 ok，缺哪条说哪条，成员数破上限则回到要人确认';
/**
 * ── 上游判据的 id（第 ② 条的证据来源）─────────────────────────────────────────
 *
 * ★ 写成常量而不是散在代码里的字符串：这两个名字同时出现在 `upstream` 的键上、
 *   出现在 blocker 的措辞里、也出现在夹具的输入里 —— 三处必须**逐字**一致，
 *   而"同一个东西有三个写法"正是本队记账过的缺陷形状。
 *
 * ★ 本判据**不 import** 那两条判据的模块：契约 §2 要求判据之间不互相调用。
 *   它们之间的耦合是**编排层**的事（调用方把上游裁决注入 `upstream`），
 *   不是判据之间的事 —— 这样"上游那条判据改了个措辞"不会让这条判据跟着变。
 */
const UPSTREAM_CHECKPOINT = 'admission.checkpoint';
const UPSTREAM_ABSORB = 'admission.absorb';
/**
 * ── 输入面声明（B 层，编译期）──────────────────────────────────────────────────
 *
 * ★ 与本队其余判据同一条纪律：这里声明的**不是"ctx 上有个字段"**，而是
 *   "**有人真的去看过**"。每一格都是【调用方注入的观察】：
 *
 *     `producedDocuments` —— 产物是哪几份（要读仓库才知道；判据不做 I/O）
 *     `upstream`          —— 上游两条判据真的裁决（要跑注册表才知道）
 *     `openQuestions`     —— `open-questions.json` 里读到了什么（要读盘才知道）
 *
 * ★ (a) 为什么 `openQuestions` 不进 requires：它是"没人接线"与"确实没有提问表"
 *   两件事的**共同入口** —— 而两者在本判据里**不同形**（前者 unmeasured、
 *   后者 ok 的第 ③ 条）。声明进 requires 会让"还没接 open-questions.json"
 *   在核对层上变成一条缺失，而那本该是判据自己说出来的事（并且说得更细）。
 *   ★ 与 `runtime.liveness` 把 `wait`（单数）排除在声明外是同一条口径：
 *     判据自己的缺省方向由判据与它的三臂夹具持有，不由 requires 持有。
 *
 * ★ (b) 为什么 `upstream` **进** requires：它是本判据第 ② 条【唯一**合法的**
 *   证据来源】—— 没有它，第 ② 条只能变成"我自己重算一遍"（两份真相）。
 *   所以"上游裁决没接上"必须被核对层读成**缺输入**，而不是让判据静默地
 *   落进 own 的重算分支。它是本判据与其余判据最不同的一格：**判据的输入
 *   是另一条判据的结论** —— 这条声明就是那件事的全部机械表达。
 */
export const requires = [
    'producedDocuments',
    'upstream',
];
function readUpstreamState(verdict) {
    if (verdict === null || typeof verdict !== 'object' || Array.isArray(verdict))
        return 'malformed';
    const v = verdict;
    if (v.ok === true)
        return 'ok';
    if (v.ok !== false)
        return 'malformed';
    const hasBlockers = Array.isArray(v.blockers) && v.blockers.length > 0;
    const hasUnmeasured = typeof v.unmeasured === 'string' && v.unmeasured.trim() !== '';
    /**
     * ★ 与注册表的 `assertVerdict` 同一条口径：两者都在场是**矛盾的裁决**
     *   （"发现问题"与"没能测量"是两个不同的主张），不是"随便挑一个读"。
     *   落 malformed ⇒ unmeasured，而不是挑一个看起来更严重的。
     */
    if (hasBlockers && hasUnmeasured)
        return 'malformed';
    if (hasUnmeasured)
        return 'unmeasured';
    if (hasBlockers)
        return 'blocked';
    /** `ok: false` 而两个出口都没有 —— 注册表自己会抛错，这里读作读不懂。 */
    return 'malformed';
}
/** 上游那一格的一句话（进 blocker / unmeasured 的理由；★ 不是裁决的替代品）。 */
function upstreamReason(verdict, state) {
    if (state !== 'blocked' && state !== 'unmeasured')
        return '';
    const v = verdict;
    const detail = state === 'blocked'
        ? v.blockers.filter((item) => typeof item === 'string').join('; ')
        : String(v.unmeasured);
    return detail;
}
/**
 * ── 条件 ③：把调用方交进来的那一格读成"还有没有未回答的问题" ─────────────────────
 *
 * 形状（★ 与 `absorb` / `checkpoint` 的规整同构）：
 *
 *     `undefined` / `null` / 非数组 / 含非法条目 ⇒ 没能测量 ⇒ unmeasured（**不是**"没有"）
 *     数组（可能为空）                  ⇒ 观察了；非空 ⇒ 条件 ③ 不过
 *
 * ★★ 而"没能测量"分**两种，且必须不同形**（本任务 t13 修的正是这里）：
 *
 *     缺席（`undefined` / `null`）⇒ 没人接线            ⇒ 去接线
 *     形状坏（非数组 / 含非法条目）⇒ 接了、交错了东西    ⇒ 去修调用方
 *
 *   此前两者由同一次读返回同一个 `{state:'unmeasured'}` 且**共用一句话**，
 *   而它们的补救动作完全不同。合成一句会让读日志的人按错的方向去修 ——
 *   与"把没测到并进通过"同族，只是这次被并进去的是**另一种没测到**。
 *   ⇒ 返回里多两格：`reason`（absent / malformed）与 `detail`（哪一格坏了）。
 *
 * ★★ 为什么"含非法条目"落 unmeasured 而不是"忽略它、看剩下的"：
 *   一个 `['q1', 42]` 的输入里，那个 `42` **可能**是一条真的未回答问题。
 *   静默丢掉它 ⇒ "有一条读不懂的问题"被读成"问题都答完了" —— 正是本任务
 *   要消灭的那个方向。★ 反过来（"看不懂就拒绝"）也不对：那会在一份**错的接线**
 *   上开火，而它的补救动作是去改调用方，不是回去回答问题。
 *   ⇒ 两难的正确落点是**第三态**：说清"我读不懂这一格，所以什么都没判"。
 */
function pendingQuestions(value) {
    if (value === undefined || value === null) {
        return { state: 'unmeasured', pending: [], reason: 'absent', detail: 'nothing was injected' };
    }
    if (!Array.isArray(value)) {
        return {
            state: 'unmeasured',
            pending: [],
            reason: 'malformed',
            detail: `a ${typeof value} was injected instead of a list`,
        };
    }
    const pending = [];
    for (const [index, item] of value.entries()) {
        /**
         * ★ 一条读不懂的条目 ⇒ 整格落"没能测量"（**不是**忽略它、看剩下的）：
         *   那个条目**可能**是一条真的未回答问题，静默丢掉它就是把"读不懂"
         *   读成"问题都答完了"。★ 反过来"看不懂就拒绝"也不对 —— 那会在一次
         *   **错的接线**上按"还有问题要问用户"开火，而补救动作是去改调用方。
         *   ⇒ 第三态是唯一准确的落点，且它**说清是哪一格**。
         */
        if (typeof item !== 'string' || item.trim() === '') {
            return {
                state: 'unmeasured',
                pending: [],
                reason: 'malformed',
                detail: `entry ${index} is ${typeof item === 'string' ? 'a blank string' : `a ${typeof item}`}, not a non-empty question string`,
            };
        }
        pending.push(item.trim());
    }
    return { state: 'read', pending, reason: 'absent', detail: '' };
}
/**
 * ── 成员数上限那一格：读成"还能不能收人" ────────────────────────────────────────
 *
 * 三态（★ 与其余几格同一条纪律，且"没有上限"与"上限读不出"不同形）：
 *
 *     `memberCap` 缺席 / 两格任一非整数    ⇒ 没能核对（证据里说一句，**不阻断**）
 *     `current <= max`                     ⇒ 没超 ⇒ 自动成团的资格成立
 *     `current > max`                      ⇒ ★ 破了上限 ⇒ 回到要人确认（blocked）
 *
 * ★ 用 `>` 而不是 `>=`：上限是**可以到达**的（`maxMembers: 8` 允许刚好 8 个）。
 *   写成 `>=` 会把每一个"刚好用满上限"的团队判成超标 —— 那是一次**误伤**，
 *   而本队那条跨层规则说误伤的代价比漏报更贵。
 */
function memberCapState(cap) {
    if (cap === undefined || cap === null || typeof cap !== 'object')
        return { state: 'unmeasured' };
    const current = cap.current;
    const max = cap.max;
    if (!Number.isInteger(current) || !Number.isInteger(max))
        return { state: 'unmeasured' };
    const c = current;
    const m = max;
    /** ★ 负数的上限是一个读坏了的配置，不是"上限很小"。 */
    if (m < 0 || c < 0)
        return { state: 'unmeasured' };
    return c > m ? { state: 'exceeded', current: c, max: m } : { state: 'within', current: c, max: m };
}
/**
 * ── 闸门：什么时候这条判据说话 ────────────────────────────────────────────────
 *
 * **永远说话。** 为什么这里不给闸门（与 `checkpoint` / `absorb` 不同）：
 *
 *   那两条判据问的是"某一件事发生了没有"（有没有未审改动 / 有没有声称吸收），
 *   而**没有那件事发生**时它们是"不适用"。本判据问的是**成团这个动作本身**的
 *   前置条件 —— 而"要不要成团"这个问题在**每一次成团尝试**上都被问起。
 *   一个"产物为空、什么都没接上"的 ctx 恰恰是它**最需要**开口的情形
 *   （那正是"凭感觉就成团"发生的时刻）。
 *
 * ★ 于是"没接线"在这里落 `unmeasured`、而不是 `skipped` —— 那不是噪音，
 *   那是本判据**唯一的正确读数**（它在设计上就不该被静默跳过）。
 *   ★ 本函数存在只是为了满足装配层的可选第五个导出，不是一个常量 `true` 的装饰：
 *     它显式声明"本判据对任何 ctx 都适用"，于是**没有**哪一天会被误当成
 *     "条件式判据"而在某个 kind 上被跳过（那会让成团检查在一部分任务上消失）。
 */
export function appliesTo(_ctx) {
    return true;
}
export function gate(ctx) {
    /**
     * ── ★ 先问"这次能不能观察"，而不是先判三个条件（与 absorb / checkpoint 同序）──
     *
     * 理由逐字相同：一个**什么都没接上**的 ctx 走到这里，正确答案是"我没能测量"，
     * 不是"条件 ① 不过（没有产物）"。后者会在一份完全合规但尚未接线的 ctx 上开火，
     * 而"你回去写需求文档"这个建议在那种情形下是**错的指引**。
     *
     * ★ 顺序：产物表 → 上游裁决 → 提问表。三格**各自独立**被判——
     *   一格没接上不掩盖另外两格的读数（下面 blocked 分支里一次给全）。
     */
    const upstream = ctx?.upstream;
    if (upstream === undefined || upstream === null || typeof upstream !== 'object' || Array.isArray(upstream)) {
        return unmeasured('the verdicts of the gates that must run before a team can convene (the review checkpoint and the absorption check) were not provided, so "has the loop run long enough" could not be measured — this is "not measured", not "the loop is done"');
    }
    /**
     * ── 条件 ①：产物存在且非空 ────────────────────────────────────────────────────
     *
     * `undefined` ⇒ unmeasured（没人接线 / 读不到产物表）
     * `[]`        ⇒ ★ **可判定的事实**：没有产物 ⇒ 条件 ① 不过（blocked）
     *
     * ★ 这一支与上面那条 unmeasured **不同形**：那是"我不知道产物是什么"，
     *   这是"产物集是空的"。把两者合成一个 `?? []`，会让"没人接线"与
     *   "确实没写需求"在日志里同形 —— 而它们的补救动作完全相反。
     */
    const documents = ctx?.producedDocuments;
    if (!Array.isArray(documents)) {
        return unmeasured('the requirement/plan documents for this run could not be observed (producedDocuments was not provided), so whether there is an artefact to convene a team for could not be measured');
    }
    const legalDocuments = [];
    const illegalDocuments = [];
    for (const raw of documents) {
        const normalized = typeof raw === 'string' ? normalizeWorkspacePath(raw) : undefined;
        if (normalized === undefined)
            illegalDocuments.push(String(raw));
        else if (!legalDocuments.includes(normalized))
            legalDocuments.push(normalized);
    }
    const blockers = [];
    const unmeasuredReasons = [];
    /** 证据（★ 只在 ok 时交出；与 absorb 的 `absorbReport`、checkpoint 的读数同构）。 */
    const evidence = [];
    /**
     * ── 逐份登记非法产物路径（不静默丢弃）────────────────────────────────────────
     *
     * ★ 它们**不是**条件 ① 的答案：一份绝对路径说明"这份产物比不了、也指不明"，
     *   而"有没有产物"这件事仍然由合法的那几份回答。把非法路径单独报出来，
     *   是为了让"这一份没被算进去"与"这一份不存在"不同形。
     */
    for (const path of illegalDocuments) {
        blockers.push(`"${path}" was listed as a produced requirement/plan document but is not a workspace-relative path, so it cannot be counted towards "there is an artefact to convene a team for" (absolute paths and ".." have no stable identity)`);
    }
    if (legalDocuments.length === 0 && illegalDocuments.length === 0) {
        blockers.push('condition ①: this run declares NO requirement/plan document at all — there is no artefact for a team to work from, so convening one now would be convening it on nothing');
    }
    else if (legalDocuments.length === 0) {
        /**
         * ★ 有产物、但**一份都没能认出路径** ⇒ 条件 ① **没能测量**，不是"没有产物"。
         *   这一支刻意与上一条不同形：上面的补救是"回去写需求"，这里的补救是
         *   "改调用方的路径书写"。★ 合成一个"反正都没产物 ⇒ blocked"会让一份
         *   **写法坏掉的**产物清单读起来像"还没写需求"。
         */
        unmeasuredReasons.push(`condition ①: none of the ${documents.length} declared document(s) is a workspace-relative path, so whether an artefact exists could not be measured (a malformed path is "not measured", not "no artefact")`);
    }
    else {
        evidence.push(`① ${legalDocuments.length} produced document(s): ${legalDocuments.map((p) => `"${p}"`).join(', ')}`);
    }
    /**
     * ── 条件 ②：无未审改动 —— ★ 读上游 checkpoint 的结论 ───────────────────────────
     *
     * 四态分流（★ 每一态都有自己的句子，互不折叠）：
     *
     *     键不在 `upstream` 里      ⇒ 上游没跑 ⇒ unmeasured（不是"没有未审改动"）
     *     state === 'ok'            ⇒ 条件 ② 过
     *     state === 'blocked'       ⇒ ★ 有未审改动 ⇒ blocked（把上游的 blocker 原文带上）
     *     state === 'unmeasured'    ⇒ ★★ 条件 ② **跟着 unmeasured**（拿不到版本 ≠ 没改动）
     *     state === 'malformed'     ⇒ unmeasured（上游裁决读不懂）
     *
     * ★★ 第 4 行是本任务验收里单列的那一条。它的反面（把 `unmeasured` 折成 ok）
     *   是本判据**最容易写、且错了以后看起来最好**的实现 —— 在一个 `?? 'ok'`
     *   的兜底里，三条判据全都"够格"了，而成团正是在 git 读不出来时最危险。
     */
    if (!(UPSTREAM_CHECKPOINT in upstream)) {
        unmeasuredReasons.push(`condition ②: the review checkpoint gate ("${UPSTREAM_CHECKPOINT}") did not run in this step, so "no unreviewed change" could not be measured — a gate that never spoke is not a gate that said "yes"`);
    }
    else {
        const checkpointVerdict = upstream[UPSTREAM_CHECKPOINT];
        const state = readUpstreamState(checkpointVerdict);
        if (state === 'ok') {
            evidence.push(`② no unreviewed change (per the "${UPSTREAM_CHECKPOINT}" verdict injected into this step)`);
        }
        else if (state === 'blocked') {
            const reason = upstreamReason(checkpointVerdict, state);
            blockers.push(`condition ②: the artefact has an UNREVIEWED change, so the loop has not run long enough — ${reason === '' ? `the "${UPSTREAM_CHECKPOINT}" verdict refused this step` : reason}`);
        }
        else if (state === 'unmeasured') {
            unmeasuredReasons.push(`condition ②: whether the artefact carries an unreviewed change could NOT be measured — the "${UPSTREAM_CHECKPOINT}" verdict was itself "not measured" (${upstreamReason(checkpointVerdict, state) || 'no reason given'}), and "could not read the revision" is not "the revision is unchanged"`);
        }
        else {
            unmeasuredReasons.push(`condition ②: the injected "${UPSTREAM_CHECKPOINT}" verdict is not a verdict at all (neither ok, nor blockers, nor unmeasured), so whether the artefact has an unreviewed change could not be measured`);
        }
    }
    /**
     * ── 条件 ③：无待确认问题（读 `open-questions.json` 的观察）──────────────────────
     *
     * ★ 为什么用户裁定它必须**结构化**（原话）：「否则第③条无法机械判定，又回到
     *   靠模型记得」。一个只存在于会话里的"我还有两个问题要问用户"是不可观察的，
     *   于是成团判据只能猜 —— 而"猜"就是这条判据要消灭的那个东西。
     */
    const questions = pendingQuestions(ctx?.openQuestions);
    if (questions.state === 'unmeasured') {
        /**
         * ── ★★ 缺席 与 形状坏 —— 两种"没能测量"必须**不同形** ────────────────────────
         *
         * MEASURED（本任务的修复，t13）：此前这一支是一句话，把"没人接
         * `open-questions.json`"与"接了、但读出来的形状不是一组非空字符串"合成同一句。
         * 而两者的**补救动作完全不同**：
         *
         *     缺席   ⇒ 去接线（编排层还没把这格交进来）
         *     形状坏 ⇒ 去修调用方（它交了东西，但交错了）
         *
         * 合成一句会让读日志的人按错误的方向去修。★ 这与本队那条跨层纪律同源：
         * "我不知道"与"我看了、看不懂"不是同一件事。
         *
         * ★ 而两半**都与 `[]`（读到、空的 ⇒ 条件 ③ 过）不同形** —— 后者才是
         * "问题都答完了"，它走的是下面那个 `else` 支。
         */
        unmeasuredReasons.push(questions.reason === 'absent'
            ? 'condition ③: the pending questions for this run could not be observed at all (no open-questions.json observation was injected), so "no unanswered question is waiting on the user" could not be measured — nobody wired this grid up, which is not the same as "the questions are all answered"'
            : `condition ③: the pending questions were injected in a shape that is not a list of non-empty question strings (${questions.detail}), so whether a question is still waiting on the user could not be measured — a malformed observation is "not measured", not "nothing is pending"`);
    }
    else if (questions.pending.length > 0) {
        blockers.push(`condition ③: ${questions.pending.length} question(s) are still waiting for the user — ${questions.pending.map((q) => `"${q}"`).join(', ')} — and a team that convenes with an open question has decided that question by default`);
    }
    else {
        evidence.push('③ no unanswered question (the pending-questions observation is present and empty)');
    }
    /**
     * ── ★ 成员数上限兜底（用户裁定）──────────────────────────────────────────────
     *
     * ★ 它**不是**第四条验收，所以它**只**在三条都过之后才说话：
     *   一条已经因为"有未审改动"被拒的 ctx，再多一句"而且人满了"会淹没前者 ——
     *   而读日志的人的第一动作是去修那条**内容**上的缺陷。
     *
     * ★ 而它**必须在三条都过时说话**：那时唯一的疑问是"要不要人点头"，
     *   而成员上限正是那个疑问的答案（用户裁定：超上限 ⇒ 不自动）。
     */
    const cap = memberCapState(ctx?.memberCap);
    const contentOk = blockers.length === 0 && unmeasuredReasons.length === 0;
    if (contentOk && cap.state === 'exceeded') {
        blockers.push(`the loop has run long enough (① ② ③ all hold) and this team could convene automatically, but it would have ${cap.current} members against a cap of ${cap.max} — member names are a non-renewable resource, so a team that exceeds the cap needs a person to confirm it rather than an automatic approval`);
    }
    if (contentOk && cap.state === 'unmeasured') {
        /**
         * ★ 没能核对上限 ⇒ **不阻断**，但这句话必须留下来（见 interface 的注释）：
         *   于是"上线了、只是没接规模"与"规模核对过了、没超"在**证据**上不同形。
         */
        evidence.push('the member cap could not be checked (no team size was injected), so the right to convene automatically rests on the three conditions alone');
    }
    else if (contentOk && cap.state === 'within') {
        evidence.push(`the member cap is respected (${cap.current} of ${cap.max})`);
    }
    /**
     * ── 三态的落点（★ 顺序即优先级，且理由是"可判定的事实"优先于"没能测量"）───────
     *
     *   ① 有 blocked   ⇒ blocked。**已经测到的问题**不许被"另外一格没测到"盖住 ——
     *      那会把一条可操作的结论（去审 / 去答）藏在一句"基础设施没接好"后面。
     *   ② 只剩 unmeasured ⇒ unmeasured（**不是 ok**）。
     *   ③ 都没有        ⇒ ok + 证据。
     *
     * ★ 不"短路"（与 checkpoint / changed-paths 同源）：一次给全 ——
     *   缺三条与缺一条的补救动作不同，而"只报第一条"会让人跑很多轮。
     */
    if (blockers.length > 0) {
        /** ★ 同时存在的"没能测量"如实附在后面，不被 blocked 吞掉（两者仍不同形）。 */
        const also = unmeasuredReasons.length > 0
            ? [`(separately, ${unmeasuredReasons.length} of the three condition(s) could not be measured: ${unmeasuredReasons.join('; ')})`]
            : [];
        return blocked([...blockers, ...also]);
    }
    if (unmeasuredReasons.length > 0) {
        return unmeasured(`the loop could not be certified as long enough, so this team is NOT automatically convenable: ${unmeasuredReasons.join('; ')}`);
    }
    /**
     * ★ 前面那个 `readUpstreamState` 的 `'unmeasured'` / `'malformed'` 两支、
     *   条件 ① 的两支、条件 ③ 的两支，合起来覆盖了全部输入形状 ——
     *   走到这一行时三条**都真的过**（不是"三份清单都空 ⇒ 大概没事"）。
     *
     *   ★ 这正是 checkpoint 那条 `臂 3d` 实测的教训在本判据上的落点：
     *     一个"清单都空 ⇒ ok"的兜底**看起来无懈可击**，而它在
     *     "没人接线 / 形状全坏"的 ctx 上会替整套准入检查背书。
     *     ⇒ 本判据的每一个 `unmeasured` 支都**先于**这一行返回，且各有自己的
     *       输入（夹具里逐支打红），所以这一行不是兜底，是**结论**。
     */
    return {
        ok: true,
        conveneReport: {
            /** ★ 三条各自的读数（逐条），让编排层与人能看见"凭什么说够了"。 */
            conditions: {
                artefactPresent: true,
                noUnreviewedChange: true,
                noPendingQuestion: true,
            },
            producedDocuments: [...legalDocuments],
            /**
             * ★ 上游两侧的态**原样交回**（不是折算成布尔）：编排层要能用同一份真值
             *   回答"是检查点说的、还是吸收说的" —— 与"两份真相"相对的那条纪律。
             */
            upstreamStates: {
                [UPSTREAM_CHECKPOINT]: readUpstreamState(upstream[UPSTREAM_CHECKPOINT]),
                ...(UPSTREAM_ABSORB in upstream
                    ? { [UPSTREAM_ABSORB]: readUpstreamState(upstream[UPSTREAM_ABSORB]) }
                    : {}),
            },
            /** 成员上限那一格（`unmeasured` 也如实交回：它是一份**证据**，不是裁决）。 */
            memberCap: cap.state === 'unmeasured'
                ? { state: 'unmeasured' }
                : { state: cap.state, current: cap.current, max: cap.max },
            /**
             * ★ `autoApprove: true` 的**语义**：够格自动成团（用户裁定不需要点头）。
             *   本判据**不**调 approve —— 它只把"能不能"这件事写成可机读的，
             *   由编排层决定动作。★ 它**不是**"已经成团了"：那是一个动作，
             *   而本判据是一个裁决。
             */
            autoApprove: true,
            evidence: [...evidence],
        },
    };
}
