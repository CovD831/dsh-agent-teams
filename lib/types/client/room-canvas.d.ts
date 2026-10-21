/**
 * ── ★★★ 把房间**画出来**：等距地板 + 墙 + 桌椅 + 屏幕上滚动的代码 + 小人 ──────────────
 *
 * ── 这个方法从哪来（不是我的发明）────────────────────────────────────────────────
 *
 * 参照物 `ypyik0669/claude-web` 的 `web/src/features/cafe/render.ts` 的**画法**：
 * ```
 * ① 整间房间先画在一张**一点一像素**的小 canvas 上（`TW = 16`、`TH = 8` 的菱形格）
 * ② 画完再**无平滑放大**到页面尺寸（`imageSmoothingEnabled = false`）⇒ 硬边
 * ③ 顺序：地板 → 墙 → 站着的东西（按 u+v 从远到近）→ 光照 → 文字
 * ④ 每个物件都是一个**立方体**（顶面 + 左面 + 右面三个多边形）
 * ```
 * ★★ 第 ④ 条是关键：**整个房间只有一种基元**（`box`），桌椅、显示器、柜子都是它的实例。
 *   一个立方体就够画出"有体积的房间" —— 这比"给每个东西画一张图"便宜一个数量级。
 *
 * ── ★ 本文件只画，不判断 ────────────────────────────────────────────────────────
 *
 * 谁坐哪、在做什么，全部来自 `room-plan.ts`；本文件只接收一个 `RoomPlan` 与一张位置表。
 * ★ 而它**必须**有一个"画对了"的读数（本机没有视觉模型）：
 *   ⇒ 每个物件在绘制时把 `[kind, u, v]` 记进 `drawn[]`，由 `drawRoom` 返回。
 *     于是"桌上有没有显示器""人是不是坐在椅子上"可以**编程核对**。
 *
 * @module dsh-agent-teams/client/room-canvas
 */
import type { RoomActorDoing, RoomPlan } from './room-plan.ts';
/** 房间的调色板。★ **夜晚**——参照物也是夜晚（那是"人在加班干活"的语境）。 */
export declare const ROOM_PALETTE: {
    /**
     * ★★ 地板**必须比墙暗**（MEASURED，第四版截图：地板比墙亮 ⇒ 看起来像"挖开的坑"，
     *   因为亮面在上、暗面在下是重力的语言，反过来就是塌陷）。
     *   参照物的取值也是这个方向：地板 `#3a3344`、墙 `#3e3550`（墙略亮）。
     */
    readonly floorA: "#26212f";
    readonly floorB: "#2a2533";
    /** ★ 每个团队的地板色不同 —— 但**分界主要靠几何**（团队之间留过道）。 */
    readonly teamA: "#302641";
    readonly teamB: "#233040";
    readonly teamC: "#332b26";
    readonly teamD: "#26332d";
    readonly wallBack: "#3a3348";
    readonly wallSide: "#2e2838";
    readonly wallBase: "#1e1a26";
    readonly deskTop: "#564a63";
    readonly deskLeft: "#362e40";
    readonly deskRight: "#41374d";
    readonly chairTop: "#b93a44";
    readonly chairLeft: "#7f1f2a";
    readonly chairRight: "#962533";
    readonly monitorFrame: "#0b0b10";
    /** ★ 屏幕亮着时的代码色（"在干活"最一眼可见的信号）。 */
    readonly screenCode: "#0f3b36";
    readonly screenIdle: "#15151c";
    readonly codeGlyph: "#4fe0c0";
    readonly neon: "#ff3cbe";
    readonly neonCool: "#3cdcff";
    readonly ghost: "rgba(190,200,220,0.35)";
    readonly unknownStripe: "#6b6478";
};
/** 一个可以被夹具核对的"画了什么"的物件记录。 */
export interface DrawnItem {
    readonly kind: 'floor' | 'wall' | 'desk' | 'monitor' | 'chair' | 'sprite' | 'ghost' | 'neon' | 'sign';
    readonly u: number;
    readonly v: number;
    readonly teamId?: string;
    readonly doing?: RoomActorDoing;
    readonly actorKey?: string;
}
/**
 * 把一间房间画到 `ctx` 上。
 *
 * @param ctx - 目标画布上下文（**已经是** 1:1 的像素坐标；放大由调用方做）
 * @param plan - `roomPlanOf` 的产出（谁在哪）
 * @param options - `mainBusy`：主会话在跑（墙上大屏就滚代码）；`now`：动画时刻
 * @returns **画了什么**的清单（★ 判据靠它，不靠看图）
 */
export declare function drawRoom(ctx: CanvasRenderingContext2D, plan: RoomPlan, options?: {
    readonly mainBusy?: boolean;
    readonly now?: number;
}): {
    readonly drawn: readonly DrawnItem[];
    readonly width: number;
    readonly height: number;
    readonly ox: number;
    readonly oy: number;
};
/** ★ 供夹具与调试：一帧的 `TW/TH` 常量（产物里读得到，避免"猜"）。 */
export declare const ISO: {
    readonly TW: 16;
    readonly TH: 8;
};
