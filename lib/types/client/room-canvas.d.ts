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
    /**
     * ── ★★★ 三明度，一个光源（外部规范 `rules/71-isometric` rule 5）────────────────────
     *
     * 规范逐字：「Light from the upper left: **top lightest, left face middle, right face
     *   darkest.** Never flip it per object.」
     *
     * ★★ MEASURED（本条修之前）：桌子写的是 `deskLeft: '#362e40'`（更暗）、
     *   `deskRight: '#41374d'`（更亮）⇒ **左右反了**。单看一个物件不像错，
     *   **整间房光向不一致**才看得出来 —— 那正是规范说 "never flip it per object" 的原因。
     * ★ 而这条错误此前**没有任何判据会红**（房间能画出来、16 条臂全绿）。
     *   现在由 `scripts/gate-room-lighting.test.mjs` 臂 1 钉住：`top > left > right`。
     */
    /**
     * ── ★★★ 桌面的明度是**按对比度算出来的**，不是挑出来的（2026-10-22 第四轮）──────────
     *
     * MEASURED（`python3` 量参照图 + 量我们自己的调色板）：
     * ```
     * 参照物 agent-cockpit：桌面 #726c6e 亮度 0.154  vs 地板 0.013 ⇒ **3.3 : 1**
     * 我们（修之前）：      桌面 #5b4f69 亮度 0.088  vs 地板 0.017 ⇒ **2.1 : 1**
     *                                     vs 墙   0.037 ⇒ **1.6 : 1**  ← ★ 这一格最糟
     * ```
     * ★★ 而 1.6:1 就是"糊成一团"的**可测定义**：桌子与墙之间几乎分不出来。
     *   ⇒ 用户说"跟我想的画面不一样"时，这不是审美分歧，是一个能量出来的差距。
     *
     * 修法：把桌面提到 `vs 地板 ≥ 3:1`，**同时保持** `top > left > right`（一个光源）。
     * ```
     * top   #8a7a9e  亮度 0.218  vs 地板 4.00:1  vs 墙 3.07:1
     * left  #61556f  亮度 0.102  vs 地板 2.26:1
     * right #423b4c  亮度 0.048  vs 地板 1.46:1
     * ```
     * ★ 判据：`gate-room-furniture-contrast` —— 桌面 vs 地板 ≥ 3:1，且三面顺序不变。
     */
    readonly deskTop: "#8a7a9e";
    readonly deskLeft: "#61556f";
    readonly deskRight: "#423b4c";
    readonly chairTop: "#b93a44";
    readonly chairLeft: "#8f2530";
    readonly chairRight: "#6b1922";
    /**
     * ── ★★ 显示器机身：**不是黑的**（2026-10-22 第四轮实测）───────────────────────────
     *
     * MEASURED（参照物 agent-cockpit 的显示器区域）：机身是 `#58565b`（亮度 0.095），
     * 而**屏幕才是黑的**。我们此前把机身写成 `#0b0b10`（亮度 0.0035）
     * ⇒ 显示器成了一块**黑洞**，把刚提亮的桌面又遮回去。
     * ★ 而"机身比屏幕亮"是物理事实（塑料外壳反光，屏幕发光但画面暗）。
     */
    readonly monitorFrame: "#58565b";
    readonly monitorSide: "#3f3d42";
    readonly monitorTop: "#6a686e";
    /** ★ 屏幕亮着时的代码色（"在干活"最一眼可见的信号）。 */
    readonly screenCode: "#0f3b36";
    readonly screenIdle: "#15151c";
    readonly codeGlyph: "#4fe0c0";
    readonly neon: "#ff3cbe";
    readonly neonCool: "#3cdcff";
    readonly ghost: "rgba(190,200,220,0.35)";
    readonly unknownStripe: "#6b6478";
    /**
     * ── ★★★ 描边：每件家具外面一圈深色（参照物的**最关键**一条画法）────────────────────
     *
     * MEASURED（2026-10-22 第四轮，把参照物放大到 4× 后逐像素看）：
     * `agent-cockpit` 的桌子是一块浅灰 `#8d8f9e`，而它**外面有一圈 `#2e2a27`**；
     * 显示器更明显（黑框 + 浅色屏幕）。`pixtuoid` 的木桌同样有一圈深棕。
     *
     * ★★ 为什么它比"配色好不好看"重要：没有描边时，我们的
     *   ```
     *   桌子 #5b4f69（亮度 0.088）· 墙 #3a3348（0.037）· 地板 #26212f（0.017）
     *   ```
     *   三者**只有明度差、没有边界** ⇒ 深色主题下整间房是一团灰紫，
     *   眼睛分不出"哪是桌子、哪是墙"。而描边**先立住轮廓**，明度再去分面。
     * ★ 它与 `gate-room-lighting` 互补：那条管"三个面的明度顺序"，
     *   这条管"物件与背景之间有没有边界"。
     */
    readonly outline: "#0f0c14";
};
/** 一个可以被夹具核对的"画了什么"的物件记录。 */
export interface DrawnItem {
    readonly kind: 'floor' | 'wall' | 'desk' | 'monitor' | 'chair' | 'sprite' | 'ghost' | 'neon' | 'sign' | 'tag';
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
