/**
 * ── ★★★ 摄像机：把**一间房**与**所有房**放进同一个世界坐标系（需求 §28.5）──────────────
 *
 * ── 用户裁定（逐字）──────────────────────────────────────────────────────────────
 *
 * > 「A 吧，就是可以调整视图大小，可以**放大到只有一个房间的视图**，
 * >  也可以**缩小到看到所有房间**的视图」
 *
 * ★★ 这句话定了**两件事**，而它们此前是矛盾的：
 * ```
 * 放大到一间房   ⇒ 现在的 RoomPanel 已经是这个尺度（它只画一个工作区）
 * 缩小到所有房   ⇒ ★ 我们**从来没有过**这个尺度 —— 因为"所有房间"没有共同的坐标系
 * ```
 * ⇒ 所以本文件的第一件事不是"加缩放"，而是**先把所有房间摆进一个世界**：
 * ```
 * 每个工作区 = 一间房（§27.3 的裁定）
 * 所有房 = 一条**横向排开**的街（每间房之间留过道）
 * 摄像机 = 世界上的一个矩形（x / y / 缩放）
 * ```
 *
 * ── 为什么这是**纯函数**（本仓纪律，不是偏好）────────────────────────────────────
 *
 * ```
 * 本机没有视觉模型 ⇒ "缩到能看见所有房间"不能靠看，只能靠**算**：
 *   世界包围盒（所有房的最小外接矩形）÷ 视口尺寸 ⇒ 一个**确定的**缩放值
 * 而"放大到一间房"同样是一个确定的矩形（那间房的包围盒）
 * ⇒ 两个尺度都是**算出来的**，于是可以断言（`gate-room-camera`）。
 * ```
 *
 * ── ★★ 一个容易写错的地方（写在这里防止再犯）────────────────────────────────────
 *
 * ```
 * 缩放不能是任意浮点数。像素风要求**整数倍**（否则放大后像素不是正方形 ⇒ 糊）。
 * ⇒ 缩到"能看见所有房间"时，必须**向下取整到整数倍**：
 *    宁可四周多一点空白，也不许出现 1.37 倍 —— 那会让像素大小不一致。
 * ```
 *
 * @module dsh-agent-teams/client/room-camera
 */
import type { RoomPlan } from './room-plan.ts';
/** 世界坐标里的一个矩形（像素）。 */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** 摄像机的状态：世界上的一个矩形 + 它的缩放。 */
export interface Camera {
    /** 视口左上角对应的**世界坐标**。 */
    readonly x: number;
    readonly y: number;
    /**
     * 缩放。★ 取值**必须**落在 `ZOOM_LADDER` 里（整数或整数分之一）——
     * `1` = 一点一像素；`3` = 每个像素画成 3×3；`1/2` = 每 2×2 源像素压成 1 个。
     */
    readonly zoom: number;
}
/**
 * 一间房在世界里的位置 + 它的尺寸。
 *
 * ★ `origin` 是这间房的**画布左上角**在世界里的坐标（不是它的地板原点）。
 */
export interface PlacedRoom {
    readonly workspace: string;
    readonly plan: RoomPlan;
    readonly origin: {
        readonly x: number;
        readonly y: number;
    };
    readonly frame: {
        readonly width: number;
        readonly height: number;
    };
}
/**
 * 房间之间留多宽的过道（世界像素）。
 *
 * ★★ MEASURED（为什么不是 0）：两间房紧贴时，右房的左墙会**盖住**左房的右边缘，
 *   而"两间房"与"一间很宽的房"在画面上同形 —— 那正是 §4 记账最久的那类合流。
 * ★ 而 24 是刻意取的：它等于一个精灵的宽度，视觉上是一条"能走人的街"。
 */
export declare const STREET_GAP = 24;
/**
 * 把所有房间**横向排成一条街**，返回世界尺寸与每间房的位置。
 *
 * ★★ 为什么是横向而不是网格：
 * ```
 * 用户要的是"缩小到看到所有房间"—— 那是一个**俯瞰一条街**的画面
 * 网格会让"第 2 行第 1 间"与"第 1 行第 2 间"在视觉上等价，而它们不是
 * ⇒ 一条街有**顺序**（与工作区的稳定序一致），网格没有
 * ```
 * ★ 而顺序**必须稳定**（`workspacesOf` 保证去重保序）—— 否则每次轮询房间会跳位置，
 *   而"跳位置"会摧毁本仓一直在守的那件事：位置记忆。
 */
export declare function layOutRooms(plans: readonly {
    readonly workspace: string;
    readonly plan: RoomPlan;
}[]): {
    readonly rooms: readonly PlacedRoom[];
    readonly world: Rect;
};
/**
 * ── ★★★ 允许的缩放阶梯（这一条是本文件最关键的取舍）────────────────────────────────
 *
 * ```
 * { 1/8, 1/6, 1/4, 1/3, 1/2, 1, 2, 3, 4 }
 * ```
 *
 * ★★★ **为什么不是"只能整数倍"**（我第一版就是那么写的，而它当场被判据推翻）：
 *
 * MEASURED（臂 2 红）：
 * ```
 * 4 个工作区的世界 = 920px 宽，而视口 900px
 * 需要的最小缩放 = 900/920 = 0.978
 * 而"向下取整到整数" ⇒ 0 ⇒ 被 `max(1, …)` 抬回 1 ⇒ **装不下**
 * ```
 * ⇒ **"缩小到看到所有房间"与"只能整数倍"直接冲突**：房间一多就必然要 < 1 倍。
 *
 * ★★ 而像素风的真实要求不是"整数倍"，是**像素大小均匀**：
 * ```
 * zoom = 3    ⇒ 1 个源像素 = 3×3 屏幕像素   ✅ 均匀
 * zoom = 1/2  ⇒ 2 个源像素 = 1 个屏幕像素   ✅ 仍然均匀（每个输出像素盖 2×2 源像素）
 * zoom = 1.37 ⇒ 有的源像素占 1 个屏幕像素、有的占 2 个  ❌ 大小不一 ⇒ 糊
 * ```
 * ⇒ 所以阶梯取**整数与整数分之一**，两头都保持均匀。
 * ★ 而它必须是**有限的阶梯**而不是连续值：连续值会让"缩放"不可断言。
 */
export declare const ZOOM_LADDER: readonly number[];
/**
 * 一个矩形**完整装进**视口所需的最大**合法**缩放（在 `ZOOM_LADDER` 里取）。
 *
 * ★ 取"能装下的最大那一档" —— 太小的缩放会浪费视口，而用户要的是"看到全部"，
 *   不是"看到全部但很小"。
 * ★ 而**下限是阶梯的最小一档**：连最小档都装不下时，如实返回最小档（画面会被切），
 *   而不是编一个更小的数 —— 那会让"装不下"看起来像"装下了"。
 */
export declare function fitZoom(rect: Rect, viewport: {
    readonly width: number;
    readonly height: number;
}): number;
/**
 * ★★★ 两个**具名的**尺度 —— 用户原话里的那两个。
 *
 * ```
 * 一间房   ⇒ zoom = 放大到那间房刚好装满视口
 * 所有房   ⇒ zoom = 缩小到整个世界刚好装进视口
 * ```
 * ★ 它们是**同一个函数** `fitTo()` 的两个调用，不是两套代码 ——
 *   两套代码会在下一次改动时分叉，而分叉的两个尺度不再是"同一个摄像机的两端"。
 */
export declare function fitTo(rect: Rect, viewport: {
    readonly width: number;
    readonly height: number;
}, 
/** ★ 上限：放大到一间房时不该无限放大（参照物 pixtuoid 的缩放上限是 2×）。 */
maxZoom?: number): Camera;
/**
 * 沿 `ZOOM_LADDER` 走**一档**。
 *
 * ★★ 为什么滚轮也要走阶梯：若滚轮给连续值（`zoom * 1.25`），
 *   用户滚两下就会得到 1.5625 —— 那**不是**均匀缩放，像素大小会跳。
 *   而"滚轮"恰恰是最容易被连续实现的地方。
 * ★ 走到两端就停住（不循环）—— 循环会让"放大到顶"变成"突然最小"，那是惊吓。
 */
export declare function stepZoom(current: number, direction: 1 | -1): number;
/** 某一间房的摄像机（"放大到只有一间房"）。 */
export declare function focusRoom(room: PlacedRoom, viewport: {
    readonly width: number;
    readonly height: number;
}, maxZoom?: number): Camera;
/** 整个世界的摄像机（"缩小到看到所有房间"）。 */
export declare function focusWorld(world: Rect, viewport: {
    readonly width: number;
    readonly height: number;
}, maxZoom?: number): Camera;
/**
 * 世界坐标 → 屏幕坐标（视口内的 CSS 像素）。
 *
 * ★ 摄像机只做**整数平移 + 整数缩放**，所以这个函数是**恒等可逆**的
 *   （见 `screenToWorld`）—— 否则 hit test（点某个小人）会与画面错位。
 */
export declare function worldToScreen(camera: Camera, point: {
    readonly x: number;
    readonly y: number;
}): {
    readonly x: number;
    readonly y: number;
};
/** 屏幕坐标 → 世界坐标。★ 它是 `worldToScreen` 的逆，hit test 靠它。 */
export declare function screenToWorld(camera: Camera, point: {
    readonly x: number;
    readonly y: number;
}): {
    readonly x: number;
    readonly y: number;
};
/**
 * 点在某间房里吗（世界坐标）。
 *
 * ★ 用于"点了哪间房" —— 缩小到所有房间时，用户会点某一间想放大进去。
 * ★★ 而它必须与 `focusRoom` 用**同一个矩形**（`origin` + `frame`），
 *   否则"点得中"与"放大到哪"会错开一格。
 */
export declare function roomAt(rooms: readonly PlacedRoom[], point: {
    readonly x: number;
    readonly y: number;
}): PlacedRoom | undefined;
/** 摄像机当前看到的**世界矩形**（★ 用于判"是不是真的看到了所有房间"）。 */
export declare function visibleRect(camera: Camera, viewport: {
    readonly width: number;
    readonly height: number;
}): Rect;
/** 这个矩形**完整包住**世界吗（"缩小到看到所有房间"的判据形状）。 */
export declare function coversWorld(camera: Camera, world: Rect, viewport: {
    readonly width: number;
    readonly height: number;
}): boolean;
