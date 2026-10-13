/**
 * Session-ID readout and clipboard write — the parts of the header chip that can
 * be judged without a browser.
 *
 * ── ★★★ 为什么把这两件事拆出组件（而不是写在 JSX 里）────────────────────────────
 *
 * 组件的 JSX 只能靠"渲染一遍看看"来判，而**渲染要一个真浏览器**。本仓的判据
 * 一律跑在 node 里（`scripts/*.test.mjs` → `lib/client/*.js`），所以凡是
 * **有分支的**逻辑都必须先落到一个纯模块，否则那条分支永远不会被自动跑到 ——
 * 而"没被跑到的分支"与"不存在的分支"在读数上同形（这正是本队记账多次的形态）。
 *
 * ⇒ 两个可判的分支搬到这里：
 *   ① **截断显示**：长 ID 截成 `前14…后8`，短 ID 原样；
 *   ② **剪贴板降级**：`navigator.clipboard` 可用则用它；不可用则退到
 *      `execCommand('copy')`；两条都失败才报失败。
 *
 * ── ★ 为什么必须有降级（而不是只写 clipboard）──────────────────────────────────
 *
 * `navigator.clipboard` **只在安全上下文里存在**。宿主 GUI 跑在
 * `http://127.0.0.1:19387`（非 https），而 localhost 属于安全上下文的**特例** ——
 * 也就是说：同一个插件，在 `127.0.0.1` 下能复制、在局域网 IP 下不能。
 * ★ 而"点了没反应"与"复制成功但没提示"在用户眼里不同形，所以失败必须**说出来**。
 *
 * @module dsh-agent-teams/client/session-id-chip
 */
/**
 * ── ★ 截断的两条边界（都是实测会踩的）────────────────────────────────────────
 *
 * `HEAD = 14` + `ELLIPSIS` + `TAIL = 8` = 23 个字符，加上 `'ID '` 前缀共 26 ——
 * 而 **26 是本仓两个候选社区插件的截断阈值**（`dsh-session-id` 用
 * `sessionId.length > 26`）。取同一个数字的理由不是抄它，是**可对照**：
 * 同一个 ID 在两个插件下宽度相同，读数才可比。
 */
export declare const SESSION_ID_HEAD = 14;
/** Trailing characters kept by the truncated readout (see {@link SESSION_ID_HEAD}). */
export declare const SESSION_ID_TAIL = 8;
/**
 * Shorten a session id for the header chip, keeping both ends.
 *
 * ★ 保留**尾部**而不是只取前缀：会话 ID 是 UUID，而 UUID 的**末尾**是
 *   区分度最高的部分（前缀是版本号与变体位，同一批会话里往往相同）。
 *   只取前缀会让两个会话显示成同一个字符串 —— 那与"这个按钮没用"同形。
 *
 * ★ 空串**原样返回空串**，不返回 `'…'`：调用方据此判断"没有 ID 可显示"，
 *   而一个只有省略号的按钮会看起来像坏了。
 *
 * @param sessionId - the raw session id, or undefined/empty when none is bound.
 * @returns the display string; never a lone ellipsis.
 */
export declare function shortSessionId(sessionId: string | undefined): string;
/** What a copy attempt did. Three states, because "not attempted" is not "failed". */
export type SessionIdCopyOutcome = 'copied' | 'failed';
/**
 * Narrow face of the two clipboard mechanisms, so a fixture can drive both arms.
 *
 * ★ 两个成员都**可选**：不是每个宿主都有 `navigator.clipboard`，而
 *   `document.execCommand` 是被标准废弃的（可能不存在、也可能返回 false）。
 */
export interface SessionIdClipboardEnv {
    /** Modern async clipboard; absent outside a secure context. */
    readonly clipboard?: {
        writeText(text: string): Promise<void>;
    } | undefined;
    /** Legacy synchronous fallback; absent in some embedded webviews. */
    readonly execCommand?: ((command: string) => boolean) | undefined;
    /** Creates the off-screen textarea the legacy path selects. */
    readonly createTextarea?: (() => {
        value: string;
        select(): void;
        remove(): void;
    }) | undefined;
}
/**
 * Write `text` to the clipboard, preferring the modern API and falling back to
 * `execCommand`.
 *
 * ★ 返回**三态里的两态**（`copied` / `failed`），因为"没试过"由调用方在
 *   进这个函数之前就排除了（没有 ID 时不渲染按钮）。把"没试过"也塞进来
 *   会让"复制失败"与"还没点"在类型上同形 —— 那正是本队在防的形状。
 *
 * ★ 现代路径**抛出**时也要退到旧路径，而不是直接报失败：
 *   `writeText` 在文档失焦、权限被拒、或非安全上下文下都会 reject，
 *   而 `execCommand` 在这些情形里**仍然可用**（它走的是用户手势）。
 *
 * @param text - the exact string to place on the clipboard.
 * @param env - the mechanisms available in this host.
 * @returns which path succeeded, or `failed` when every path was refused.
 */
export declare function copySessionId(text: string, env: SessionIdClipboardEnv): Promise<SessionIdCopyOutcome>;
