/**
 * ── ★★★ 最小实验①：不绑会话的 `main` key 在【无会话】时会不会出现 ──────────────────
 *
 * 规格：`docs/UI-V5-SINGLE-ENTRY.md` §0。
 *
 * ── 它验的是什么（v5 方案的地基）────────────────────────────────────────────────
 *
 * 官方有**两条**说明，而它们说的是**不同的槽位** —— 哪一条管我们，只有跑一次才知道：
 *
 *   ① `dsh-client-ui-sidebar-right` 的 Known Limitations：
 *      「No surface without a session. State is keyed by session id,
 *        so the hero screen shows nothing on the right.」      ← ★ 说的是 rightbar
 *   ② `dsh-client-ui-layout` 的 SlotMap for `'main'`：
 *      「Central panel selected by sidebar entry id. The reserved `conversation`
 *        key hosts the Conversation; ★ **other keys receive no Session binding.**」
 *                                                              ← ★ 说的是 main
 *
 * ── ★ 本组件刻意【不画界面】──────────────────────────────────────────────────────
 *
 * 硬边界：本实验只验「**能不能注册 + 无会话时出不出现**」，内容只要能辨识即可。
 * ⇒ 它渲染的是一个**可编程可辨识的标记**（`data-*` + 文本），不是界面。
 *
 * ── ★★ 判据必须是【可编程的】（本机没有视觉模型）────────────────────────────────
 *
 * 所以本组件的全部意义在于：**它每次被渲染都会往一个进程内计数器上加一**。
 * ⇒ 「出没出现」变成 **`rendered > 0`** 这个布尔读数，而不是"截个图看看"。
 */
/** ★ 记录一次渲染。导出是为了让夹具可以在**不重新 import** 的前提下读它。 */
export declare function noteProbeRender(key: string): number;
/** ★ 读一个 key 被渲染过几次。`0` ⇒ 从未出现（★ 与"渲染过"不同形）。 */
export declare function probeRenderCount(key: string): number;
/** ★ 清空（夹具在每条臂开始时复位，避免臂与臂互相污染）。 */
export declare function resetProbeCounts(): void;
/**
 * 我们要验的那个 key。
 *
 * ★ 命名空间化（`agent-teams/`）—— 与官方保留的 `conversation` 分开，
 *   否则我们的 key 会与宿主自己的面板**撞在同一个 cell** 上（keyed 槽一个 key 一个 cell）。
 */
export declare const FOLDERS_MAIN_KEY = "agent-teams/folders";
/**
 * 官方保留的 key —— ★ **反向半边**用的对照物。
 *
 * ★ 为什么需要它：若我们的 key 与 `conversation` **行为相同**，
 *   那么很可能我们**测的不是"main 的其它 key"这件事**，
 *   而是"main 这个槽本身总是会渲染"（例如根本没走到选择那一步）。
 *   ⇒ 两个读数**必须不同形**，否则测量本身是坏的。
 */
export declare const RESERVED_CONVERSATION_KEY = "conversation";
/** 本探针占用的槽位名（`main` 是 keyed + scope: 'root'，见 §0 的官方逐字）。 */
export declare const PROBE_SLOT_NAME = "main";
/**
 * ★ 可辨识的渲染标记。内容本身不重要 —— 重要的是**它被渲染过**这件事被计数了。
 *
 * ★ 无会话时若本函数被调用 ⇒ 那正是"方案成立"的直接证据。
 */
export declare const FOLDERS_PROBE_MARKER = "agent-teams/folders-probe";
/**
 * ── ★★ 纯判定函数：把两个计数折成一个三态结论 ──────────────────────────────────
 *
 * 三态**必须不同形**（任务书的硬要求）：
 *
 *   (a) `'appears-without-session'`  —— 我们的 key 被渲染了
 *                                      ⇒ ★ **方案成立**（不绑会话的 main key 能出现）
 *   (b) `'registered-but-hidden'`    —— 注册成功但**从未被渲染**
 *                                      ⇒ ★ **方案要退到 `shell.overlay`**
 *   (c) `'registration-failed'`      —— 注册那一步就抛了/被拒
 *                                      ⇒ ★ **形状不对**（不是"不显示"，是"根本进不去"）
 *
 * ★ 为什么 (b) 与 (c) 不能合并：补救动作**完全不同** ——
 *   (b) 是"槽支持但选择器没选到我们"（换槽位即可），
 *   (c) 是"这个槽根本不收我们的 key"（换槽位也没用，要改方案）。
 *
 * @param ours - 我们的 key 的渲染次数
 * @param reserved - 官方保留 key 的渲染次数（反向半边的对照物）
 * @param registrationError - 注册阶段捕获到的错误原文；`undefined` ⇒ 没抛
 */
export declare function classifyMainKeyProbe(input: {
    readonly ours: number;
    readonly reserved: number;
    readonly registrationError?: string;
}): {
    readonly outcome: 'appears-without-session' | 'registered-but-hidden' | 'registration-failed';
    /**
     * ★★ 反向半边读数：我们的 key 与官方保留 key **行为是否不同形**。
     *
     * `false` ⇒ ★ **测量本身是坏的**（两者一样 ⇒ 我们测的不是"main 的其他 key"）。
     *   ⇒ 那时 `outcome` 的两个非失败态**都不可信**。
     */
    readonly discriminates: boolean;
    /** 人话说明（★ 不是给机器判的，是给读报告的人判的）。 */
    readonly because: string;
};
/** ★ 记下注册阶段的错误原文（`undefined` ⇒ 没抛过）。 */
export declare function noteProbeRegistrationError(message: string): void;
/** ★ 读注册阶段是否抛过 —— `undefined` ⇒ **没抛**（★ 不是空字符串）。 */
export declare function probeRegistrationError(): string | undefined;
/** ★ 复位（夹具每条臂开始时调用）。 */
export declare function resetProbeRegistrationError(): void;
/**
 * ── ★★★ 探针组件本体：**不画界面** ──────────────────────────────────────────────
 *
 * 它只做两件事：
 *   ① 往计数器上 +1（**可编程判据的载体**）；
 *   ② 吐一个可辨识的标记（万一将来有人要人眼看，它认得出来）。
 *
 * ★ 没有 props、没有 store、没有 locale —— 因为实验只问"**它有没有被渲染**"。
 *   加任何依赖都会引入"渲染失败"这条**与实验无关**的失败路径，
 *   而那会让"没被选择器选中"与"渲染时崩了"**同形**。
 */
export declare function FoldersProbe(): string;
/**
 * ── ★★ 复算【官方那条选择规则】（纯函数，不碰 React）──────────────────────────────
 *
 * 逐字对应官方 `MainPanel`：
 *
 *     entryKey = usePanelInfo((info) => info.activePanelId) ?? "conversation"
 *
 * ★ 为什么把它做成**纯函数**：判据要能**脱离浏览器**读。
 *   本函数不"代替"官方实现 —— 它是官方的**同一段逻辑**，而夹具会把它与
 *   **真 `SlotCore` 的 `entriesOfSlot`** 拼起来验（见 `scripts/gate-main-key-probe.test.mjs`）。
 *
 * @param activePanelId - 当前选中的 panel id；`null` ⇒ 没选（store 初值）
 * @returns 渲染器会去找的那个 key（官方行为：`null` ⇒ 落回 `conversation`）
 */
export declare function resolveEntryKey(activePanelId: string | null): string;
/**
 * ── ★★ 三态判定：注册了+选了 / 注册了+没选 / 未注册+选了 ──────────────────────────
 *
 * ★ 三态**必须不同形**（任务书硬要求），且三者的**结论**完全不同：
 *
 *   `'renders'`      —— 注册了 + 选了 ⇒ ★ **方案成立**（最后一跳通了）
 *   `'hidden'`       —— 注册了 + 没选 ⇒ ★ 不渲染（☆ t103 已实测的那个**默认**）
 *   `'throws'`       —— 未注册 + 选了 ⇒ ★ **抛错**（`selectPanel` 自己的守卫）
 *
 * ★★ 为什么 `'throws'` 不能并进 `'hidden'`：
 *   `'hidden'` 是"**我们没事，只是没被选**"（补救：把选择做出来）；
 *   `'throws'` 是"**你给了一个不存在的 panel**"（补救：先注册）。
 *   合并会让"方案还没接完"与"调错了 id"变成同一句话 —— 而那是本仓记账最久的形态。
 *
 * @param selected - 是否真的调了 `selectPanel`（⇒ 官方那条写入口被走到）
 * @param registered - 那个 key 是否**已注册**（官方守卫 `hasMainPanel` 的输入）
 */
export declare function classifySelectionOutcome(input: {
    readonly selected: boolean;
    readonly registered: boolean;
}): {
    readonly outcome: 'renders' | 'hidden' | 'throws';
    readonly because: string;
};
/**
 * ── ★★ 反向半边 B：真守卫的错误原文 ──────────────────────────────────────────────
 *
 * 官方逐字（`client.js:463`）：
 *
 *     `layout.selectPanel: main panel "${panelId}" is not registered`
 *
 * ★ 为什么把**报文形状**也做成判据：它证明我们调的是**真那个函数**，
 *   而不是"碰巧渲染了"。光看"渲染计数 > 0"无法区分这两种情形 ——
 *   一个"任何 key 都渲染"的实现也会让它为真（那正是 t103 反向半边在防的事）。
 *
 * @param panelId - 传进去的那个**未注册**的 id
 * @returns 官方那条守卫会抛出的报文
 */
export declare function unregisteredPanelMessage(panelId: string): string;
/** ★ 记一次 `selectPanel` 调用。 */
export declare function noteProbeSelection(_panelId: string): void;
/** ★ 记一次**被接受**的选择（没抛）。 */
export declare function noteProbeSelectionAccepted(): void;
/** ★ 记一次**被拒**的选择（抛了），存原文。 */
export declare function noteProbeSelectionError(message: string): void;
/** ★ 读选择阶段的三个读数。 */
export declare function probeSelectionReadout(): {
    readonly calls: number;
    readonly accepted: number;
    readonly error: string | undefined;
};
/** ★ 复位选择阶段（夹具每条臂开始时调用）。 */
export declare function resetProbeSelection(): void;
