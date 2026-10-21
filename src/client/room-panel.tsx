/**
 * ── ★★★ 工作区 = 一个**房间**（需求 §27）──────────────────────────────────────────
 *
 * ── 用户两次裁定（逐字）────────────────────────────────────────────────────────
 *
 * 第一次（层级）：「一个工作区（或者说一个项目）就是一个**房间**……房间里面**一般只有一个团队**，
 *   当然也不排除有两个或几个团队，这样应该就不会显得很空吧。」
 *
 * 第二次（**画风**，在看到第一版之后）：「目前这个很显然**跟我想要的风格、跟我想的画面不一样**。
 *   我刚才不是让你去搜索东西吗？搜 deepseek bot，claude web 的前端画面，
 *   还有其他的一些**像素风经营游戏**或者是什么游戏的画面。」
 *
 * ── ★★★ 第一版错在哪（这条写下来，防止再犯）────────────────────────────────────
 *
 * ```
 * 第一版：一排排 div 方格 + 每格一个灰色方块 + 名字
 * 结果：  用户看到的是一张**表格**（他自己的截图：一片灰格子 + 一串截断的名字）
 *
 * ★ 差别不是"精美程度"，是**画法**：
 *   正投影方格 ⇒ 读起来像表格
 *   等距 + 有体积的物件 ⇒ 读起来像房间
 * ```
 * ⇒ 所以本版是**真画**：等距地板（16×8 菱形）+ 墙 + 桌椅（立方体）+ 显示器（亮着就滚代码）
 *   + 24×24 像素小人。**画法**取自参照物 `ypyik0669/claude-web` 的 `cafe/render.ts`
 *   （`box()` 三面法 / `toScreen()` 等距投影 / 一点一像素再放大）。
 *
 * ── ★★ 分工没变（这是本仓纪律，不是偏好）──────────────────────────────────────
 *
 * ```
 * room-plan.ts    纯函数：谁坐哪、在做什么            ← 9 条臂单测
 * room-iso.ts     纯数学：地板坐标 → 屏幕坐标          ← 可单测
 * room-sprite.ts  字符画：24×24 五态各一帧            ← 可单测（行数列数调色板键）
 * room-canvas.ts  画：只用上面的东西，不自己判断      ← 返回 drawn[] 供夹具核
 * 本文件           挂载 canvas、放大、hit test、标题
 * ```
 * ★ 判据落在**数据**上（`drawn[]` / `data-*`），不落在像素上 —— 本机没有视觉模型。
 *
 * @module dsh-agent-teams/client/room-panel
 */

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots, type ActivityTeam } from './activity-monitor.ts'
import { DOING_LABEL, roomPlanOf, teamsOfWorkspace, workspacesOf } from './room-plan.ts'
import { drawRoom } from './room-canvas.ts'
import css from './room-panel.module.css'

/** ★ 放大倍数：小 canvas 一点一像素地画，再整数倍放大 —— 那才是像素风。 */
const ZOOM = 3

/** 房间要显示的那个工作区（一个工作区 = 一个房间）。 */
export interface RoomPanelProps {
  /** 工作区名（来自 `/state` 的 `team.workspace`）。缺省 ⇒ 用第一个非空工作区。 */
  readonly workspace?: string
}

/**
 * 一间房间 = 一个工作区。
 *
 * ★ 三态（`undefined` / `empty` / 有内容），两两不同形：
 * ```
 * snapshots === undefined  ⇒ 「读不到」（store 还没发布过第一份）—— 去看 /state
 * plan.empty === true      ⇒ 「这个工作区还没有团队」—— 去建一个队
 * 有内容                    ⇒ 画房间
 * ```
 */
export function RoomPanel({ workspace }: RoomPanelProps = {}): JSX.Element {
  const snapshot = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const teams = snapshot?.teams
  const target = workspace ?? workspacesOf(teams)[0] ?? ''
  const scoped = teamsOfWorkspace(teams, target)
  const plan = roomPlanOf(scoped)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || plan.empty) return
    /**
     * ★★ 画在**一点一像素**的离屏尺寸上，再整数倍放大：
     *   若直接按 `ZOOM` 倍尺寸画，所有坐标都要乘 3 ⇒ 小数坐标会出现**半像素**，
     *   而半像素就是糊 —— 像素风死于插值。
     */
    const draw = (): void => {
      const context = canvas.getContext('2d')
      if (context === null) return
      /** ★ 先按 1:1 量一次尺寸（离屏），再设真实尺寸。 */
      const probe = document.createElement('canvas').getContext('2d')
      if (probe === null) return
      const frame = drawRoom(probe, plan, { now: Date.now() })
      canvas.width = frame.width * ZOOM
      canvas.height = frame.height * ZOOM
      canvas.style.width = `${frame.width * ZOOM}px`
      canvas.style.height = `${frame.height * ZOOM}px`
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      /** ★ 关掉平滑 —— 这一行是"像素风"的物理前提。 */
      ctx.imageSmoothingEnabled = false
      ctx.setTransform(ZOOM, 0, 0, ZOOM, 0, 0)
      ctx.fillStyle = '#0b0a10'
      ctx.fillRect(0, 0, frame.width, frame.height)
      drawRoom(ctx, plan, { now: Date.now() })
      /**
       * ★ 房间名画在**放大之后**的坐标系里（`setTransform(1,0,0,1,…)`），
       *   否则 3 倍放大下文字会变成一块一块的。参照物也是这么做的
       *   （「names, seat tags, bubbles and receipts are drawn after that at the page's own resolution」）。
       */
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.font = `${11 * ZOOM}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.fillStyle = '#ff6ad0'
      ctx.textBaseline = 'top'
      ctx.fillText(target === '' ? '(未命名工作区)' : target, 10 * ZOOM, 8 * ZOOM)
    }
    draw()
    /**
     * ★ 动画：屏幕上的"代码在滚"需要重画。
     * ★★ 而**只在有 working 的时候**开定时器 —— 一间全是闲人的房间不该每秒重画
     *   （那会让一个静态画面吃掉 CPU，而"没在动"本来就不需要帧）。
     */
    if (!plan.actors.some((actor) => actor.doing === 'working')) return
    const timer = setInterval(draw, 400)
    return () => clearInterval(timer)
  }, [plan, target])

  return (
    <section
      className={css.room}
      data-room={target}
      data-room-cols={plan.cols}
      data-room-rows={plan.rows}
      data-room-actors={plan.actors.length}
      data-room-teams={plan.teams.length}
      data-room-empty={plan.empty ? 'true' : 'false'}
      data-room-state={teams === undefined ? 'unknown' : plan.empty ? 'empty' : 'present'}
      data-room-zoom={ZOOM}
    >
      {teams === undefined ? (
        <p className={css.notice} data-room-notice="unknown">
          还没读到工作区数据（`/state` 尚未返回）。这不等于「这里没有团队」。
        </p>
      ) : plan.empty ? (
        <p className={css.notice} data-room-notice="empty">
          这个工作区还没有团队。建一个队，它的成员就会坐进这间屋子。
        </p>
      ) : (
        <div className={css.stage}>
          <canvas
            ref={canvasRef}
            className={css.canvas}
            data-room-canvas="true"
            /** ★ 无障碍：canvas 里没有可读文本，所以把读数同时放在 `aria-label` 里。 */
            aria-label={`工作区 ${target}：${plan.teams.length} 个团队、${plan.actors.length} 个成员`}
          />
        </div>
      )}

      {/* ★ 成员读数表：**画面上**是像素小人，**下面**是可读的名字与状态（两者互补，不重复）。 */}
      {plan.empty ? null : (
        <ul className={css.roster} data-room-roster={plan.actors.length}>
          {plan.actors.map((actor) => (
            <li
              key={actor.key}
              className={css.rosterItem}
              data-actor={actor.key}
              data-actor-doing={actor.doing}
              data-actor-task={actor.currentTask}
              data-actor-seat={`${actor.seat.col},${actor.seat.row}`}
              data-actor-team={actor.teamId}
              title={`${actor.memberName} · ${DOING_LABEL[actor.doing]}`
                + (actor.currentTask === '' ? '' : ` · ${actor.currentTask}`)}
            >
              <span className={css.actorName}>{actor.memberName}</span>
              <span className={css.actorDoing} data-doing-label={actor.doing}>{DOING_LABEL[actor.doing]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
