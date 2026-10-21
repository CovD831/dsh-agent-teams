/**
 * ── ★★★ 工作区 = 一个房间：**把状态投影成"房间里有什么"**（需求 §27，纯函数）────────────
 *
 * ── 这个文件的位置为什么是"纯函数在前、组件在后"──────────────────────────────────
 *
 * MEASURED（本仓既有纪律，`folders-panel.tsx` 的文件头逐字）：
 * **本机没有视觉模型** ⇒ "画对了没有"不能靠看，只能靠**可读的数据形状**。
 * ⇒ 所以房间的一切几何与站位都在这里算完，渲染层只负责把数字画成像素。
 *
 * ★★ 这与参照物（`ypyik0669/claude-web` 的 `web/src/features/cafe/`）的分工**同构**：
 * ```
 * sim.ts + map.ts   —— 状态机与地板图（纯函数，sim.test.ts / map.test.ts 单测）
 * render.ts         —— 只管画（一点一像素的小 canvas，再放大）
 * ```
 * 借的是这条分工，不是它的美术。
 *
 * ── ★★★ 已裁定（需求 §27.3，用户原话）──────────────────────────────────────────
 *
 * ```
 * 工作区 = 项目 = 一个房间
 * 团队   = 房间里的 1~N 个团队（"一般只有一个团队……也不排除有两个或几个"）
 * 成员   = 房间里的小人（一人一个工位）
 * ```
 * ★ 所以本文件的主输入是 `readonly ActivityTeam[]`（**同一个工作区的全部团队**），
 *   而不是"一个团队" —— 房间的尺寸与分区由团队数决定。
 *
 * ── ★★ 所有读数都来自**既有字段**，不新增数据通道（§27.4 的纪律）───────────────
 *
 * ```
 * 谁在干活        ← member.liveness.state === 'working'
 * 活儿是哪一条    ← member.currentTask（`snapshot.ts` 已有的投影）
 * 做到哪一步      ← member.done / member.total
 * 闲着 / 读不到   ← liveness 的五态（★ 不用活布尔：'could-not-measure' 不是 'idle'）
 * 卡住了          ← runtime.liveness 的 blocked（★ 已有判据，本文件**不另算一套**）
 * ```
 * ★ 而"画得好不好看"**不进任何判据** —— 那一格归人。
 *
 * @module dsh-agent-teams/client/room-plan
 */
import type { ActivityMember, ActivityTeam } from './activity-monitor.ts';
/** 一个小人在房间里做什么。★ 五态，两两不同形（本仓 §4 的纪律）。 */
export type RoomActorDoing = 
/** 在工位上干活（`liveness.state === 'working'`）*/
'working'
/** 空闲（`liveness.state === 'idle'`）*/
 | 'idle'
/** 还没被拉起（`never-spawned`）—— ★ 与 idle **不同形**：它连会话都没有 */
 | 'not-spawned'
/** 宿主里没有这个成员（`driver-absent`）*/
 | 'away'
/** ★ 读不到（`could-not-measure`）—— **不许**并进 idle */
 | 'unknown';
export interface RoomActor {
    /** 稳定键：同一个人跨轮询必须是同一个（否则动画会"重开"） */
    readonly key: string;
    readonly memberName: string;
    readonly role: string;
    readonly doing: RoomActorDoing;
    /** 当前任务的 id（`''` = 没有） */
    readonly currentTask: string;
    readonly done: number;
    readonly total: number;
    /** 工位（房间网格坐标，1-based 便于人读） */
    readonly seat: {
        readonly col: number;
        readonly row: number;
    };
    /** ★ 组号：同一个团队的成员坐在一起（团队 = 一排/一区） */
    readonly groupIndex: number;
    /** ★ 这个小人属于哪个团队 —— 房间里有多个团队时要能分出来 */
    readonly teamId: string;
}
export interface RoomPlan {
    /** 房间网格尺寸（格子数）*/
    readonly cols: number;
    readonly rows: number;
    readonly actors: readonly RoomActor[];
    /** 每个团队在房间里占哪几行（团队 = 一段区域）*/
    readonly teams: readonly {
        readonly teamId: string;
        readonly name: string;
        readonly fromRow: number;
        readonly toRow: number;
    }[];
    /** ★ 房间是空的（没有任何团队）—— 与"读不到"**不同形** */
    readonly empty: boolean;
}
/**
 * 一行放几个工位。
 *
 * ★★ MEASURED（2026-10-22，第二版截图）：先写了 4，画出来是**一条窄带** ——
 *   因为一行 4 格 × 16px = 64px 宽，而一个 24×24 的小人比一格还宽 1.5 倍。
 *   参照物用 **6**（`map.ts` 逐字 `SEATS_PER_ROW = 6`），且整间房 **34 列**。
 * ⇒ 改成 6：一行 6 格 = 96px，装得下 6 个并排的小人，且团队之间仍有过道可分。
 */
export declare const SEATS_PER_ROW = 6;
/**
 * 房间至少几排深。
 *
 * ★★ MEASURED（第三版截图）：写 3 时房间是"一条薄地板 + 一片墙"，不像房间。
 *   参照物 `MIN_DEPTH = 18`（它要放服务区与走道）—— 我们不要那么多，
 *   但**房间必须有纵深**，否则墙会压过地板、眼睛读到的是"一堵墙"。
 * ★ 8 是折中：两个团队（约 5 排）+ 走道之后仍有空余，看起来像一间屋子而不是一条走廊。
 */
export declare const MIN_ROWS = 8;
/** 读一个人的"在做什么"。★ 五态映射，**不许**把 could-not-measure 折进 idle。 */
export declare function doingOf(member: Pick<ActivityMember, 'liveness'>): RoomActorDoing;
/**
 * ── ★★★ 把一个工作区的**全部团队**投影成一间房间 ─────────────────────────────────
 *
 * @param teams - 同一个 workspace 下的团队（★ 传**这个工作区**的，不是全部工作区）
 * @returns 房间几何 + 每个小人的站位
 *
 * ★ 布局规则（可单测，不依赖渲染）：
 * ```
 * 每个团队占一段行（1 个团队 = 1 段）
 * 每行放 SEATS_PER_ROW 个人；团队人多就往下多吃几行
 * 团队之间留 1 行过道（否则"两个团队"看起来像"一个大队"）
 * ```
 * ★★ 为什么"团队 = 一段行"而不是"随便排"：用户裁定"房间里面一般只有一个团队"，
 *   而"也可能有两三个" ⇒ **分界必须看得出来**。★ 而分界只靠颜色是不够的
 *   （色弱看不出、截图也说不清），所以它落在**几何**上。
 */
export declare function roomPlanOf(teams: readonly ActivityTeam[]): RoomPlan;
/** 每个 `doing` 的可读标签（★ 渲染层与夹具都用这一份，不许各写一遍）。 */
export declare const DOING_LABEL: Readonly<Record<RoomActorDoing, string>>;
/**
 * ── ★★★ 一个工作区 = 一间房间：**挑队**的那两个函数 ───────────────────────────────
 *
 * ★ 它们住在这里而不是 `room-panel.tsx`，理由是**可测性**：
 *   `room-panel.tsx` import 了 `./room-panel.module.css`，而那个模块在 Node 里**不可 import**
 *   ⇒ 只要筛队函数住在那边，任何不跑浏览器的夹具都读不到它。
 *   MEASURED（本条的第一版红在这里）：臂 8 直接 `import lib/client/room-panel.js` ⇒
 *   `ERR_MODULE_NOT_FOUND: room-panel.module.css`。
 * ★★ 而"把纯逻辑挪进纯文件"是修**夹具**还是修**产品**？——修产品：
 *   §27.4 的纪律是"状态机与渲染分开"，而筛队逻辑属于状态机那一侧。
 *   夹具只是**迫使**那条纪律被真的遵守。
 */
/** 从快照里挑出某个工作区的全部**活**团队。 */
export declare function teamsOfWorkspace(teams: readonly ActivityTeam[] | undefined, workspace: string): readonly ActivityTeam[];
/** 快照里有哪些工作区（去重、保序）。★ 与 `foldersFromSnapshots` 同一条稳定序纪律。 */
export declare function workspacesOf(teams: readonly ActivityTeam[] | undefined): readonly string[];
