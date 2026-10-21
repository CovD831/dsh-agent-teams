/**
 * ── ★★★ 工作区 = 一个**房间**（需求 §27，用户 2026-10-22 第二轮裁定）──────────────
 *
 * ── 用户原话（逐字）────────────────────────────────────────────────────────────
 *
 * 「一个工作区（或者说一个项目）就是一个**房间**，你可以参考一些**经营类或者像素游戏**
 *  的房间概念，去看看它的画面是怎么做的。」
 * 「房间里面**一般只有一个团队**，当然也不排除有两个或几个团队，**这样应该就不会显得很空吧**。」
 *
 * ── ★★★ 本文件**只负责画**：几何与站位全部由 `room-plan.ts` 算好 ────────────────
 *
 * MEASURED（本机没有视觉模型）⇒ "画对了没有"不能靠看图判。
 * ⇒ 分工与参照物（`ypyik0669/claude-web` 的 `cafe/`）同构：
 * ```
 * room-plan.ts   纯函数：团队 → 房间几何 + 每个小人坐哪 + 在做什么   ← 有 7 条单测
 * room-panel.tsx 本文件：把那些数字画成像素（**不做任何判断**）
 * ```
 * ★ 而它同时是本仓纪律的落点：**每一格都有 `data-*` 读数**，
 *   于是"这个格子的读数对不对"可编程判，"好不好看"归人。
 *
 * ── ★★ 它替换的是什么（用户明确否决的那一半）──────────────────────────────────
 *
 * `folders-panel.tsx` 画的是"一个像素文件夹 + 两行字" ⇒ 它表达了"有几个工作区"，
 * 而**没有表达"里面的人在干什么"**。用户原话：「**单纯的像素文件夹其实没有意义啊**」。
 * ⇒ 房间的第一性目的不是好看，是**一眼看出谁在干活、谁卡住了**。
 *
 * ── ★ 像素风的三条纪律（沿用 `folders-panel.module.css` 那一套，不引第二套）──────
 *
 * ```
 * ① 无圆角      ② 硬阴影（整像素偏移、0 blur）      ③ 等宽字体 + 整数间距
 * ```
 * ★ 美术全部是 **CSS 方块**，零位图、零新依赖（引位图 = 体积进 lib/client.js + 版权）。
 *
 * @module dsh-agent-teams/client/room-panel
 */

import { useSyncExternalStore, type CSSProperties } from 'react'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots, type ActivityTeam } from './activity-monitor.ts'
import { DOING_LABEL, roomPlanOf, teamsOfWorkspace, workspacesOf, type RoomActor, type RoomPlan } from './room-plan.ts'
import css from './room-panel.module.css'

/** 房间要显示的那个工作区（一个工作区 = 一个房间）。 */
export interface RoomPanelProps {
  /** 工作区名（来自 `/state` 的 `team.workspace`）。缺省 ⇒ 用第一个非空工作区。 */
  readonly workspace?: string
}

/**
 * 一个小人 —— **纯 CSS 方块**，不引位图。
 *
 * ★ 五态各有可辨识的形状 + `data-doing`（★ 形状给眼睛，读数给判据）：
 * ```
 * working     坐姿 + 屏幕亮（业务色方块）
 * idle        坐姿 + 屏幕暗
 * not-spawned 没有椅子（空心方块）—— 与 idle **不同形**
 * away        椅子空着（一个虚线框）
 * unknown     一个 `?`（★ 读不到，不是闲着）
 * ```
 */
function ActorSprite({ actor }: { actor: RoomActor }): JSX.Element {
  return (
    <span
      className={css.actor}
      /**
       * ★★ 座位坐标用**内联 CSS 变量**给（`--seat-col` / `--seat-row`），
       *   而它同时有一个 `data-actor-seat` 的**可读读数**。
       *   ⇒ 这是一个刻意的"两处"：变量给渲染（快、无重算），
       *     读数给判据（可编程核对）。★ 两者由**同一个** `actor.seat` 派生，
       *     所以"它们不一致"这件事在结构上写不出来。
       */
      style={{ '--seat-col': actor.seat.col, '--seat-row': actor.seat.row } as CSSProperties}
      data-actor={actor.key}
      data-actor-doing={actor.doing}
      data-actor-task={actor.currentTask}
      data-actor-seat={`${actor.seat.col},${actor.seat.row}`}
      data-actor-progress={actor.total === 0 ? '' : `${actor.done}/${actor.total}`}
      data-actor-team={actor.teamId}
      title={`${actor.memberName}${actor.role === '' ? '' : `（${actor.role}）`} · ${DOING_LABEL[actor.doing]}`
        + (actor.currentTask === '' ? '' : ` · ${actor.currentTask}`)
        + (actor.total === 0 ? '' : ` · ${actor.done}/${actor.total}`)}
    >
      {/* ★ 头部 + 身体：两个方块就够 —— 24×24 的角色在 16px 的格子里也是"一像素一个特征"。 */}
      <span className={css.actorHead} aria-hidden="true" />
      <span className={css.actorBody} aria-hidden="true" />
      {/* ★ 屏幕：`working` 时亮（这是"在干活"最一眼可见的信号）。 */}
      <span className={css.actorScreen} aria-hidden="true" />
      {/* ★ 名字：像素风里名字是**标签**，不是装饰。 */}
      <span className={css.actorName}>{actor.memberName}</span>
    </span>
  )
}

/** 房间的**地板格** —— 一格一个 `span`，于是"房间多大"在 DOM 上也是可读的。 */
function floorCells(plan: RoomPlan): JSX.Element[] {
  const cells: JSX.Element[] = []
  for (let row = 1; row <= plan.rows; row += 1) {
    for (let col = 1; col <= plan.cols; col += 1) {
      /**
       * ★ 同一团队的行段用同一底色（`data-team-row`）——
       *   而**分界主要靠几何**（团队之间留过道，见 `roomPlanOf`），颜色只是第二层提示。
       *   ★★ 只靠颜色分团队是错的：色弱看不出、截图也说不清。
       */
      const band = plan.teams.find((entry) => row >= entry.fromRow && row <= entry.toRow)
      cells.push(
        <span
          key={`${col}-${row}`}
          className={css.tile}
          data-tile={`${col},${row}`}
          data-tile-team={band?.teamId ?? ''}
        />,
      )
    }
  }
  return cells
}

/**
 * 一间房间 = 一个工作区。
 *
 * ★ 三态（`undefined` / `empty` / 有内容），且三者**两两不同形**：
 * ```
 * snapshots === undefined  ⇒ 「读不到」（store 还没发布过第一份）—— 查 /state
 * plan.empty === true      ⇒ 「这个工作区还没有团队」—— 去建一个队
 * 有内容                    ⇒ 画房间
 * ```
 * ★★ 合流它们的后果与 `folders-view` 那一格逐字相同：白屏与"读不到"同形。
 */
export function RoomPanel({ workspace }: RoomPanelProps = {}): JSX.Element {
  const snapshot = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const teams = snapshot?.teams
  const target = workspace ?? workspacesOf(teams)[0] ?? ''
  const scoped = teamsOfWorkspace(teams, target)
  const plan = roomPlanOf(scoped)

  return (
    <section className={css.room} data-room={target} data-room-cols={plan.cols} data-room-rows={plan.rows}
      data-room-actors={plan.actors.length} data-room-teams={plan.teams.length}
      data-room-empty={plan.empty ? 'true' : 'false'}
      /**
       * ★★ 这个读数把"读不到"与"空房间"分开：`unknown` 只在快照**从来没到过**时出现。
       *   与 `data-room-empty` 并列，因为两者的补救动作相反。
       */
      data-room-state={teams === undefined ? 'unknown' : plan.empty ? 'empty' : 'present'}
    >
      <header className={css.head}>
        <span className={css.title}>{target === '' ? '(未命名工作区)' : target}</span>
        {/* ★ 三个计数各自一格 —— 合起来会看不出"哪个是哪个"。 */}
        <span className={css.meta} data-room-team-count={plan.teams.length}>{plan.teams.length} 队</span>
        <span className={css.meta} data-room-people-count={plan.actors.length}>{plan.actors.length} 人</span>
        <span className={css.meta} data-room-working-count={plan.actors.filter((actor) => actor.doing === 'working').length}>
          {plan.actors.filter((actor) => actor.doing === 'working').length} 在干活
        </span>
      </header>

      {teams === undefined ? (
        /**
         * ★★ 读不到 ≠ 空房间。白屏与"还没读到"同形，而两者的补救动作相反
         *   （一个去看 /state，一个什么都不用做）。
         */
        <p className={css.notice} data-room-notice="unknown">
          还没读到工作区数据（`/state` 尚未返回）。这不等于「这里没有团队」。
        </p>
      ) : plan.empty ? (
        <p className={css.notice} data-room-notice="empty">
          这个工作区还没有团队。建一个队，它的成员就会出现在这间屋子里。
        </p>
      ) : (
        <div className={css.floor} style={{ gridTemplateColumns: `repeat(${plan.cols}, var(--room-tile))` }}>
          {/* ★ 地板格先铺（它是背景，小人压在上面）。 */}
          {floorCells(plan)}
          {/* ★ 小人绝对定位在地板之上 —— 用一个独立的层，避免与地板的 grid 打架。 */}
          <div className={css.actorLayer} aria-hidden="false">
            {plan.actors.map((actor) => <ActorSprite key={actor.key} actor={actor} />)}
          </div>
        </div>
      )}

      {/* ★ 团队图例：房间里有多个团队时，名字与行段要能对上（§27.3 的"一般一个，不排除两个"）。 */}
      {plan.teams.length > 1 ? (
        <ul className={css.legend} data-room-legend={plan.teams.length}>
          {plan.teams.map((entry) => (
            <li key={entry.teamId} className={css.legendItem} data-legend-team={entry.teamId}>
              <span className={css.legendName}>{entry.name}</span>
              <span className={css.legendRows} data-legend-rows={`${entry.fromRow}-${entry.toRow}`}>
                第 {entry.fromRow}{entry.toRow === entry.fromRow ? '' : `–${entry.toRow}`} 排
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
