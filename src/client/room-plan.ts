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

/** 一行放几个工位。★ 参照物用 6；这里 4 —— 房间按**团队**分区，一行太长会让团队界限模糊。 */
export const SEATS_PER_ROW = 4

/** 房间至少几行（一个人也没有时也不画成一条线）。★ "空房间"与"没有房间"不同形。 */
export const MIN_ROWS = 3

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
        seat: { col: offsetCol + 1, row: fromRow + offsetRow },
        groupIndex,
        teamId: team.teamId,
      })
    }
    teamBands.push({ teamId: team.teamId, name: team.name, fromRow, toRow: fromRow + rowCount - 1 })
    /** ★ +1 是团队之间的**过道**；空团队也占一行（"这个团队一个人都没有"也是事实）。 */
    cursor = fromRow + rowCount + 1
  }

  return {
    /** ★ 列数固定为一行座位数 —— 房间往**下**长（与参照物 `rows` 的取舍一致）。 */
    cols: SEATS_PER_ROW,
    rows: Math.max(MIN_ROWS, cursor - 1),
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
