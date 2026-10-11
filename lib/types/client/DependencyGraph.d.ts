/**
 * Screen two: the task dependency graph, and nothing else.
 *
 * ── ★★★ R3：这是**纯搬运** + 一次**减法**（用户原话）─────────────────────────────
 *
 *   · "screen two probably only needs to keep the dependency graph"
 *   · "the dependency graph can stay collapsed by default, because most of the
 *      time you do not want to look at that thing"
 *   · 「整个东西挺冗余的，比如它做一些 badge 之类的东西」
 *
 * ⇒ 这个文件只做两件事：**装下那张图**，以及**默认把它收起来**。
 *   搬过来的每一行、每一个 `data-*` 探针、每一句文案都原样保留 ——
 *   于是"搬丢了什么"可以被**集合比对**抓住（见 workspace-activity.test.mjs 的 R3 符号臂）。
 *
 * ★ 收起是一个**值**（`useState(false)`），不是一条缺席分支：一次新渲染不可能
 *   顺手把它打开。展开后的悬停/键盘行为、`Escape` 取消固定、`aria-expanded` 全部照旧。
 * @module dsh-agent-teams/client/dependency-graph
 */
import type { ActivityMember, ActivityTask } from './activity-monitor.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/**
 * Disclosure chevron — the ONE definition, shared with the panel.
 *
 * ★ 它原来长在 `ActivityPanel.tsx` 里；R3 把图搬出来之后，两边都要它。
 *   放在这里并导出，于是**只有一份**（抄一份就是同一件事的第二个实现）。
 */
export declare function Chevron({ open }: {
    readonly open: boolean;
}): import("react").JSX.Element;
/** Animated "this task is running" glyph — likewise the ONE definition. */
export declare function WorkGlyph({ active }: {
    readonly active: boolean;
}): import("react").JSX.Element;
export declare function DependencyGraph({ tasks, members, t, discarded, workspace, onSelectTask }: {
    readonly tasks: readonly ActivityTask[];
    readonly members: readonly ActivityMember[];
    readonly t: AgentTeamsTranslate;
    readonly discarded?: boolean;
    readonly workspace?: boolean;
    readonly onSelectTask?: (id: string | null) => void;
}): import("react").JSX.Element;
