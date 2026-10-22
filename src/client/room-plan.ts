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

import type { ActivityMember, ActivityTeam } from './activity-monitor.ts'

/** 一个小人在房间里做什么。★ 五态，两两不同形（本仓 §4 的纪律）。 */
export type RoomActorDoing =
  /** 在工位上干活（`liveness.state === 'working'`）*/
  | 'working'
  /** 空闲（`liveness.state === 'idle'`）*/
  | 'idle'
  /** 还没被拉起（`never-spawned`）—— ★ 与 idle **不同形**：它连会话都没有 */
  | 'not-spawned'
  /** 宿主里没有这个成员（`driver-absent`）*/
  | 'away'
  /** ★ 读不到（`could-not-measure`）—— **不许**并进 idle */
  | 'unknown'

export interface RoomActor {
  /** 稳定键：同一个人跨轮询必须是同一个（否则动画会"重开"） */
  readonly key: string
  readonly memberName: string
  readonly role: string
  readonly doing: RoomActorDoing
  /** 当前任务的 id（`''` = 没有） */
  readonly currentTask: string
  readonly done: number
  readonly total: number
  /** 工位（房间网格坐标，1-based 便于人读） */
  readonly seat: { readonly col: number; readonly row: number }
  /** ★ 组号：同一个团队的成员坐在一起（团队 = 一排/一区） */
  readonly groupIndex: number
  /** ★ 这个小人属于哪个团队 —— 房间里有多个团队时要能分出来 */
  readonly teamId: string
}

export interface RoomPlan {
  /** 房间网格尺寸（格子数）*/
  readonly cols: number
  readonly rows: number
  readonly actors: readonly RoomActor[]
  /** 每个团队在房间里占哪几行（团队 = 一段区域）*/
  readonly teams: readonly { readonly teamId: string; readonly name: string; readonly fromRow: number; readonly toRow: number }[]
  /** ★ 房间是空的（没有任何团队）—— 与"读不到"**不同形** */
  readonly empty: boolean
}

/**
 * 一行放几个工位。
 *
 * ★★ MEASURED（2026-10-22，第二版截图）：先写了 4，画出来是**一条窄带**。
 *   参照物用 **6**（`map.ts` 逐字 `SEATS_PER_ROW = 6`）⇒ 一度照抄成 6。
 *
 * ── ★★★ 第四轮改回 3（这一条是本轮最关键的几何结论）────────────────────────────
 *
 * MEASURED（`node -e` 读数 + 第三版预览图）：
 * ```
 * 6 人排成一行 ⇒ 房间 20 列 × 12 排 ⇒ **下面 10 排全是空地板**
 *             ⇒ 画面读起来是"一排人贴在墙边"，而不是"一间办公室"
 * 参照物 pixtuoid：12 个工位排成 **3 列 × 4 排的方块**，房间被填满
 * ```
 * ★★ 所以 `SEATS_PER_ROW` 不该按"房间多宽"定，而该按**人排成什么形状**定：
 *   一行 6 个 ⇒ 一条线（看起来像表格）；一行 3 个 ⇒ 一个方块（看起来像办公区）。
 * ★ 而"房间显得空"的另一个来源是 `MIN_ROWS = 8` 的底色纵深 ——
 *   两者一起把 9 个人摊进 20×12 的场地里。改成 3 之后，同样 9 人占 20×13，
 *   但**人集中在中间三排**，看起来是一块工位区。
 */
export const SEATS_PER_ROW = 3

/**
 * ── ★★★ 一个工位占几个格子（**几何算出来的，不是调出来的**）────────────────────────
 *
 * MEASURED（2026-10-22 第四轮，`node -e` 读数）：
 * ```
 * 相邻工位（col 差 1）的屏幕间距 = TW/2 = 8px
 * 而小人是 24px 宽
 * ⇒ **相邻两个人重叠 16px** —— 即每个人有 2/3 被下一个人盖住
 * ```
 * ★★ 这就是"挤成一堆、看不出谁是谁"的**根因**，与配色、描边都无关。
 *
 * ```
 * 工位占 1 格 ⇒ 间距  8px ⇒ 重叠 16px（现状）
 * 工位占 2 格 ⇒ 间距 16px ⇒ 重叠  8px
 * 工位占 3 格 ⇒ 间距 24px ⇒ 重叠  0px  ← ★ 选这个：精灵宽 = 间距
 * ```
 * ★ 判据：`gate-room-plan` 臂 14 —— `SEAT_STRIDE * TW / 2 >= SPRITE_GRID`。
 *   谁把 `SEAT_STRIDE` 改小，那条臂立刻红，并报出重叠多少像素。
 */
export const SEAT_STRIDE = 3

/**
 * ── ★★★ 一个工位占几排（与 `SEAT_STRIDE` 同一条算法，只是换了个轴）──────────────────
 *
 * MEASURED（2026-10-22 第四轮）：
 * ```
 * 相邻两排（v 差 1）的屏幕位移 dy = TH/2 = 4px
 * 而桌子高 5px、显示器高 8px（`room-canvas.ts` 的 box 高度）
 * ⇒ **后排被前排完全挡住** —— 而"被挡住"与"这一排没人"在画面上同形
 * ```
 * ```
 * 占 1 排 ⇒ dy  4px ⇒ 挡死（现状）
 * 占 2 排 ⇒ dy  8px ⇒ 刚好等于显示器高，仍贴在一起
 * 占 3 排 ⇒ dy 12px ⇒ 桌椅之间有缝，能看出是"一排排工位"
 * ```
 * ★ 判据：`gate-room-plan` 臂 15 —— `SEAT_ROW_STRIDE * TH / 2 >= MONITOR_HEIGHT`。
 */
export const SEAT_ROW_STRIDE = 3

/**
 * 房间至少几排深。
 *
 * ★★ MEASURED（第三版截图）：写 3 时房间是"一条薄地板 + 一片墙"，不像房间。
 *   参照物 `MIN_DEPTH = 18`（它要放服务区与走道）—— 我们不要那么多，
 *   但**房间必须有纵深**，否则墙会压过地板、眼睛读到的是"一堵墙"。
 * ★ 8 是折中：两个团队（约 5 排）+ 走道之后仍有空余，看起来像一间屋子而不是一条走廊。
 */
export const MIN_ROWS = 8

/** 读一个人的"在做什么"。★ 五态映射，**不许**把 could-not-measure 折进 idle。 */
export function doingOf(member: Pick<ActivityMember, 'liveness'>): RoomActorDoing {
  /**
   * ★ 用**既有的** `liveness`（服务端 `MemberLiveness['state']` 的原值，五态），不重算。
   *
   * ★★ 而它在**线上**是 `string`（`ActivityMember.liveness?: string`）——
   *   因为客户端不 import 服务端类型。⇒ 这里必须**显式列出认识的五个值**，
   *   而不是 `switch` 一个宽字符串（那样拼错一个值会静默落进 `default`）。
   *   ★ 认不出 ⇒ `'unknown'`：**"读不到"不是"闲着"**（本仓记账最久的合流）。
   */
  const state = member.liveness
  if (state === 'working') return 'working'
  if (state === 'idle') return 'idle'
  if (state === 'never-spawned') return 'not-spawned'
  if (state === 'not-live') return 'away'
  /** `could-not-measure` / 缺席 / 认不出的值 —— 三者都落 `unknown`（**都**是"读不到"）。 */
  return 'unknown'
}

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
export function roomPlanOf(teams: readonly ActivityTeam[]): RoomPlan {
  const actors: RoomActor[] = []
  const teamBands: { teamId: string; name: string; fromRow: number; toRow: number }[] = []
  let cursor = 1

  for (const [groupIndex, team] of teams.entries()) {
    const members = team.members ?? []
    const rowCount = Math.max(1, Math.ceil(members.length / SEATS_PER_ROW))
    const fromRow = cursor
    for (const [index, member] of members.entries()) {
      const offsetRow = Math.floor(index / SEATS_PER_ROW)
      const offsetCol = index % SEATS_PER_ROW
      actors.push({
        /** ★ 键里带 teamId：两个团队里同名的成员（`worker`）必须是两个不同的人。 */
        key: `${team.teamId}/${member.name}`,
        memberName: member.name,
        role: member.role ?? '',
        doing: doingOf(member),
        currentTask: member.currentTask ?? '',
        done: member.done ?? 0,
        total: member.total ?? 0,
        /**
         * ★ 从第 **2** 列开始：第 1 列是贴墙的走道（否则第一排人贴着墙，像被塞进去的）。
         * ★★ 列步长是 `SEAT_STRIDE` 而不是 1 —— 见它的注释：1 格步长会让 24px 的小人
         *   重叠 16px（"挤成一堆"的真正根因）。
         */
        seat: { col: offsetCol * SEAT_STRIDE + 2, row: fromRow + offsetRow * SEAT_ROW_STRIDE },
        groupIndex,
        teamId: team.teamId,
      })
    }
    /** ★ 团队实际吃掉的排数按 `SEAT_ROW_STRIDE` 算（★ 不是 `rowCount` —— 后者是"几排工位"）。 */
    const spanRows = (rowCount - 1) * SEAT_ROW_STRIDE + 1
    teamBands.push({ teamId: team.teamId, name: team.name, fromRow, toRow: fromRow + spanRows - 1 })
    /** ★ +1 是团队之间的**过道**；空团队也占一行（"这个团队一个人都没有"也是事实）。 */
    cursor = fromRow + spanRows + 1
  }

  return {
    /**
     * 列数。
     *
     * ★★ 第一版直接用了 `SEATS_PER_ROW` ⇒ 房间是 4 格宽的**一条**，看起来像表格列。
     *   参照物 `COLS = 34`（它要放服务区、走道、VIP 房）—— 我们不要那么多家具，
     *   但**房间必须有"空的地方"**，否则它只是把工位框起来了。
     * ⇒ `SEATS_PER_ROW + 2`：左右各留一格**空地**（墙与第一排工位之间要能走人）。
     */
    cols: SEATS_PER_ROW * SEAT_STRIDE + 2,
    /**
     * 排数。
     *
     * ★★ MEASURED（本行修之前）：`Math.max(MIN_ROWS, cursor - 1)` 把 8 排以下的
     *   结果**全压平** ⇒ 1 人、6 人、12 人、18 人、24 人**都是 8 排**。
     *   于是"房间随人数长"这句话在低人数区间**是假的**，而它测不出来
     *   （因为本仓真实语料是 35 人 / 8 队，正好落在压平区之外）。
     * ⇒ 改成**相加**：最小纵深是**底色**，团队区在它之上继续长。
     *   即 `MIN_ROWS + 团队实际吃掉的排数` —— 这样两个量各自可读，
     *   而"人多房间就高"在任何人数上都成立。
     */
    rows: MIN_ROWS + Math.max(0, cursor - 1),
    actors,
    teams: teamBands,
    /** ★ 没有任何团队 = 真·空房间。与 `roomPlanOf(undefined)` 不同形（那个根本不该被调用）。 */
    empty: teams.length === 0,
  }
}

/** 每个 `doing` 的可读标签（★ 渲染层与夹具都用这一份，不许各写一遍）。 */
export const DOING_LABEL: Readonly<Record<RoomActorDoing, string>> = {
  working: '在干活',
  idle: '闲着',
  'not-spawned': '还没上岗',
  away: '不在房间',
  unknown: '读不到',
}

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
export function teamsOfWorkspace(
  teams: readonly ActivityTeam[] | undefined,
  workspace: string,
): readonly ActivityTeam[] {
  if (teams === undefined) return []
  return teams.filter((team) => team.workspace === workspace)
}

/** 快照里有哪些工作区（去重、保序）。★ 与 `foldersFromSnapshots` 同一条稳定序纪律。 */
export function workspacesOf(teams: readonly ActivityTeam[] | undefined): readonly string[] {
  if (teams === undefined) return []
  const seen: string[] = []
  for (const team of teams) if (!seen.includes(team.workspace)) seen.push(team.workspace)
  return seen
}
