/**
 * ── ★★★ 工作区 = 一条**街**上的房间，摄像机可以缩放（需求 §28.5）──────────────────────
 *
 * ── 用户裁定（逐字）──────────────────────────────────────────────────────────────
 *
 * > 「A 吧，就是可以调整视图大小，可以**放大到只有一个房间的视图**，
 * >  也可以**缩小到看到所有房间**的视图」
 *
 * ★★ 这句话把本面板的**结构**改了，不只是加一个缩放按钮：
 * ```
 * 改之前：只画**一个**工作区的一间房（别的房间根本没有坐标）
 * 改之后：所有工作区 = 一条街上的房间（`layOutRooms`）· 摄像机在世界里取景（`room-camera.ts`）
 * ```
 * ⇒ 没有"所有房间在同一个世界"这件事，"缩小到看到所有房间"就**无法实现** ——
 *   它不是渲染问题，是**坐标系**问题。
 *
 * ── ★★★ 分工（本仓纪律，不是偏好）────────────────────────────────────────────────
 *
 * ```
 * room-plan.ts    纯函数：团队 → 一间房的几何与站位
 * room-camera.ts  纯函数：所有房 → 世界 + 摄像机（两个尺度都是算出来的）
 * room-canvas.ts  画：只画一间房，返回 drawn[] 供夹具核
 * 本文件           挂载 canvas、**按摄像机逐个画每间房**、hit test、缩放交互
 * ```
 * ★ 判据落在**数据**上（`data-room-zoom` / `data-room-scale` / `drawn[]`），不落在像素上。
 *
 * ── ★★ 缩放交互（照参照物 pixtuoid 的三条）──────────────────────────────────────────
 *
 * ```
 * 滚轮         缩放（以**光标为锚点**，否则放大会把看的东西推出视野）
 * 双击         在「一间房」与「所有房间」之间切换
 * 点某间房     放大到那一间（缩小视图下才有意义）
 * ```
 *
 * @module dsh-agent-teams/client/room-panel
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from './activity-monitor.ts'
import { DOING_LABEL, roomPlanOf, teamsOfWorkspace, workspacesOf } from './room-plan.ts'
import { drawRoom } from './room-canvas.ts'
import {
  focusRoom, focusWorld, layOutRooms, roomAt, screenToWorld, stepZoom,
  type Camera, type PlacedRoom,
} from './room-camera.ts'
import css from './room-panel.module.css'

/** 视口的默认尺寸（真尺寸由 ResizeObserver 给）。★ 只用于首帧，之后一律读实测。 */
const FALLBACK_VIEWPORT = { width: 900, height: 600 }

/** 房间要显示的那个工作区（一个工作区 = 一个房间）。 */
export interface RoomPanelProps {
  /** 工作区名（来自 `/state` 的 `team.workspace`）。缺省 ⇒ 看**所有**房间（用户要的"缩小视图"）。 */
  readonly workspace?: string
}

/**
 * 摄像机状态。
 *
 * ★★ 为什么 `undefined` 与 `'world'` 要分开：
 * ```
 * undefined  ⇒ 还没量到视口尺寸，也还没被用户动过 —— 用默认的"所有房间"
 * 'world'    ⇒ 用户明确要求看所有房间
 * 'room'     ⇒ 用户明确要求看某一间（`focus` 记住是哪一间）
 * ```
 * ★ 把两者合成一个值，会让"还没算出来"看起来像"用户选了所有房间" —— 而那是两件事。
 */
type ViewMode =
  | { readonly kind: 'world' }
  | { readonly kind: 'room'; readonly workspace: string }

export function RoomPanel({ workspace }: RoomPanelProps = {}): JSX.Element {
  const snapshot = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const teams = snapshot?.teams
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT)
  /**
   * ★ 默认视图：
   * ```
   * 传了 workspace  ⇒ 放大到那一间（调用方明确要一间房）
   * 没传            ⇒ **所有房间**（用户要的是"缩到看到所有房间"）
   * ```
   */
  const [mode, setMode] = useState<ViewMode>(() => (workspace === undefined
    ? { kind: 'world' }
    : { kind: 'room', workspace }))
  /**
   * ★ 用户手动操作（滚轮缩放 / 拖拽）之后的摄像机；`undefined` = 跟随 `mode` 的自动取景。
   * ★★ 存**整个摄像机**而不是只存 zoom：缩放要以光标为锚点，而锚点会改变 `x/y`。
   *   只存 zoom 的话，缩放永远以**左上角**为锚点 —— 而那不是用户指的"那里"。
   */
  const [manual, setManual] = useState<Camera | undefined>(undefined)

  /** 所有工作区 ⇒ 一条街上的房间。★ 顺序来自 `workspacesOf`（去重保序 ⇒ 位置稳定）。 */
  const plans = workspacesOf(teams).map((name) => ({ workspace: name, plan: roomPlanOf(teamsOfWorkspace(teams, name)) }))
  const { rooms, world } = layOutRooms(plans)
  const empty = rooms.length === 0

  /** 当前摄像机：由 `mode` + 视口 + 手动缩放算出（★ 不存进 state，避免三份真相）。 */
  const baseCamera: Camera = mode.kind === 'room'
    ? focusRoom(
      rooms.find((room) => room.workspace === mode.workspace) ?? rooms[0] ?? EMPTY_ROOM,
      viewport,
    )
    : focusWorld(world, viewport)
  const camera: Camera = manual ?? baseCamera

  /** ★ 视口实测：`ResizeObserver`，而不是假设一个尺寸（面板会随窗口变）。 */
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box === undefined) return
      setViewport({ width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  /** 把世界里的每间房**按摄像机**画到同一张画布上。 */
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || empty) return
    const draw = (): void => {
      const probe = document.createElement('canvas').getContext('2d')
      const ctx = canvas.getContext('2d')
      if (probe === null || ctx === null) return
      /**
       * ★★★ 先把每间房按 **1:1** 画进离屏探针，量出它的大小；
       *   再按摄像机把它**整块**贴到画布上 —— 而不是"按缩放改所有坐标"。
       * ```
       * 按缩放改坐标 ⇒ 小数坐标出现半像素 ⇒ 糊（像素风死于插值）
       * 整块贴（imageSmoothingEnabled=false）⇒ 源像素是整数块，缩放仍均匀
       * ```
       * ★ 而"贴"的缩放值是 `ZOOM_LADDER` 里的档 ⇒ 每个源像素占**同样多**的屏幕像素。
       */
      const frames = rooms.map((room) => {
        const scratch = document.createElement('canvas')
        const frame = drawRoom(probe, room.plan, { now: Date.now() })
        scratch.width = frame.width
        scratch.height = frame.height
        const scratchCtx = scratch.getContext('2d')
        if (scratchCtx !== null) {
          scratchCtx.fillStyle = '#0b0a10'
          scratchCtx.fillRect(0, 0, frame.width, frame.height)
          drawRoom(scratchCtx, room.plan, { now: Date.now() })
        }
        return { room, scratch }
      })

      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      /** ★ 关掉平滑 —— 这一行是"像素风"的物理前提。 */
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#0b0a10'
      ctx.fillRect(0, 0, viewport.width, viewport.height)
      for (const { room, scratch } of frames) {
        const dx = Math.round((room.origin.x - camera.x) * camera.zoom)
        const dy = Math.round((room.origin.y - camera.y) * camera.zoom)
        const dw = Math.round(room.frame.width * camera.zoom)
        const dh = Math.round(room.frame.height * camera.zoom)
        ctx.drawImage(scratch, 0, 0, room.frame.width, room.frame.height, dx, dy, dw, dh)
      }
    }
    draw()
    /**
     * ★ 动画：屏幕上的"代码在滚"需要重画。
     * ★★ 而**只在有 working 的时候**开定时器 —— 一间全是闲人的房间不该每秒重画。
     */
    const anyWorking = rooms.some((room) => room.plan.actors.some((actor) => actor.doing === 'working'))
    if (!anyWorking) return
    const timer = setInterval(draw, 400)
    return () => clearInterval(timer)
  }, [rooms, camera, viewport, empty])

  /**
   * ★★ 滚轮缩放：**以光标为锚点**。
   *   不做锚点的话，放大时看到的东西会被推出视野 —— 那是"缩放到光标处"与
   *   "缩放到中心"的差别，而用户能立刻感觉到。
   */
  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    /** ★ 光标下的**世界坐标**（缩放前后它必须停在同一个屏幕位置）。 */
    const anchor = screenToWorld(camera, pointer)
    const next = stepZoom(camera.zoom, event.deltaY < 0 ? 1 : -1)
    /**
     * ★★★ 锚点换算：让 `anchor` 这个世界点在新的缩放下的屏幕位置**不变**。
     * ```
     * 屏幕位置 = (world - camera) * zoom
     * 要求 (anchor - camera') * next === (anchor - camera) * zoom
     * ⇒ camera' = anchor - (anchor - camera) * zoom / next
     * ```
     */
    const x = anchor.x - (anchor.x - camera.x) * (camera.zoom / next)
    const y = anchor.y - (anchor.y - camera.y) * (camera.zoom / next)
    setManual({ x: Math.round(x), y: Math.round(y), zoom: next })
  }, [camera])

  /** ★ 双击：在「一间房」与「所有房间」之间切换（参照物 pixtuoid 的做法）。 */
  const onDoubleClick = useCallback(() => {
    setManual(undefined)
    setMode((current) => (current.kind === 'world'
      ? { kind: 'room', workspace: rooms[0]?.workspace ?? '' }
      : { kind: 'world' }))
  }, [rooms])

  /** ★ 点某间房 ⇒ 放大到那一间（只在缩小视图下有意义）。 */
  const onClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode.kind !== 'world') return
    const rect = event.currentTarget.getBoundingClientRect()
    const worldPoint = screenToWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    const hit = roomAt(rooms, worldPoint)
    if (hit === undefined) return
    setManual(undefined)
    setMode({ kind: 'room', workspace: hit.workspace })
  }, [camera, mode, rooms])

  const focusedRoom = mode.kind === 'room' ? rooms.find((room) => room.workspace === mode.workspace) : undefined
  /** ★ 读数用：当前视图里"被聚焦的那间房"（所有房间视图下为 `undefined`）。 */
  const rosterActors = focusedRoom?.plan.actors ?? rooms.flatMap((room) => room.plan.actors)

  return (
    <section
      className={css.room}
      data-room={workspace ?? ''}
      data-room-rooms={rooms.length}
      /**
       * ★★ 每间房的几何**逐个报出来**（`工作区:列×排`）。
       *   它取代了单房间时代的 `data-room-cols` / `data-room-rows` ——
       *   而现在"一间房"不再唯一，只报一个数会让判据读不到第二间房。
       * ★ 值**全部从 `room.plan` 取**（`roomPlanOf` 算的），渲染层不重算几何。
       */
      data-room-geometry={rooms.map((room) => `${room.workspace}:${room.plan.cols}x${room.plan.rows}`).join(',')}
      data-room-actors={rosterActors.length}
      data-room-teams={focusedRoom === undefined
        ? rooms.reduce((sum, room) => sum + room.plan.teams.length, 0)
        : focusedRoom.plan.teams.length}
      data-room-scale={mode.kind}
      data-room-zoom={camera.zoom}
      data-room-world={`${world.width}x${world.height}`}
      data-room-empty={empty ? 'true' : 'false'}
      data-room-state={teams === undefined ? 'unknown' : empty ? 'empty' : 'present'}
      data-room-focused={focusedRoom?.workspace ?? ''}
    >
      {teams === undefined ? (
        <p className={css.notice} data-room-notice="unknown">
          还没读到工作区数据（`/state` 尚未返回）。这不等于「这里没有团队」。
        </p>
      ) : empty ? (
        <p className={css.notice} data-room-notice="empty">
          这个工作区还没有团队。建一个队，它的成员就会坐进这间屋子。
        </p>
      ) : (
        <div className={css.stage} ref={stageRef}>
          <canvas
            ref={canvasRef}
            className={css.canvas}
            data-room-canvas="true"
            onWheel={onWheel}
            onDoubleClick={onDoubleClick}
            onClick={onClick}
            /** ★ 无障碍：canvas 里没有可读文本，所以把读数同时放进 `aria-label` 里。 */
            aria-label={`${rooms.length} 间房，当前${mode.kind === 'world' ? '所有房间' : `只看 ${focusedRoom?.workspace ?? ''}`}，缩放 ${camera.zoom}`}
          />
          <p className={css.hint} data-room-hint="controls">
            滚轮缩放 · 双击切换「一间房 / 所有房间」{mode.kind === 'world' ? ' · 点某间房放大进去' : ''}
          </p>
        </div>
      )}

      {/* ★ 成员读数表：**画面上**是像素小人，**下面**是可读的名字与状态（两者互补，不重复）。 */}
      {empty ? null : (
        <ul className={css.roster} data-room-roster={rosterActors.length}>
          {rosterActors.map((actor) => (
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

/** ★ 一间"空房"，用于 `rooms` 暂时为空时让 `focusRoom` 有个可算的输入（不画它）。 */
const EMPTY_ROOM: PlacedRoom = {
  workspace: '',
  plan: { cols: 1, rows: 1, actors: [], teams: [], empty: true },
  origin: { x: 0, y: 0 },
  frame: { width: 1, height: 1 },
}
