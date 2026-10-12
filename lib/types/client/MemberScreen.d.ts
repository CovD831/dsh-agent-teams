/**
 * Screen one: the members, and what each of them is doing.
 *
 * ── ★★★ R4：这块内容原来内联在 `TeamSection` 的返回体里（纯搬运）─────────────────
 *
 * 用户对第一屏的口径（R2 立的）：「the first screen should show durable roles,
 * and clicking one expands to show the subagents working underneath it, together
 * with round information」。
 *
 * ★ 而它此前**没有自己的模块**：`TeamSection` 同时渲染两块屏，于是"第一屏由什么
 *   组成"只能靠读一个 1171 行的文件回答；两块屏共用一层容器网格，正是
 *   `docs/T30-LAYOUT-FINDING.md` 记下的那个布局缺陷的温床。
 *
 * ★ 这是**纯搬运**：队长行、终态提示、进度读数、成员开关与成员列表，逐块照搬，
 *   一个 `data-*` 探针、一句文案都没改。R4 的集合臂会机械核对这一点。
 * @module dsh-agent-teams/client/member-screen
 */
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts';
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { AgentTeamsTranslate } from './locales.ts';
/** The captain's members, and the state each one is in. */
export type MemberScreenProps = {
    readonly team: ActivityTeam;
    readonly modelDirectory?: ModelDirectory;
    readonly onNavigateMember: (childId: string) => void;
    readonly onSelectTask: (id: string | null) => void;
    readonly t: AgentTeamsTranslate;
    readonly historic?: boolean;
    readonly workspace?: boolean;
    readonly discarded: boolean;
    readonly stopped: boolean;
    /** `staged` plans have not been created yet, so their copy is its own case. */
    readonly staged: boolean;
    readonly awaitingFeedback: boolean;
    readonly captainBusy: boolean;
    readonly busyCount: number;
    readonly allCompleted: boolean;
    readonly allSettled: boolean;
    readonly assignedCount: number;
    readonly captainTaskIds: string;
};
/**
 * Render screen one.
 *
 * ★ 成员的展开状态**留在这里**（而不是提到面板）：它是一个"这一屏看得怎么样"的
 *   本地读数，面板不需要知道它。而它按**成员 id** 存 —— 轮询会重排名册，
 *   按位置存会把一个成员的展开状态交给另一个成员。
 */
export declare function MemberScreen({ team, modelDirectory, onNavigateMember, onSelectTask, t, historic, workspace, discarded, stopped, staged, awaitingFeedback, captainBusy, busyCount, allCompleted, allSettled, assignedCount, captainTaskIds, }: MemberScreenProps): import("react").JSX.Element;
/** Re-exported so the panel keeps one import surface for the member row's types. */
export type { ActivityMember, ActivityTask };
