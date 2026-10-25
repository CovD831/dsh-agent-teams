/**
 * The session-ID chip in the conversation header: shows the current session id
 * and copies it on click.
 *
 * ── ★★★ 为什么这个功能住在**本插件**里，而不是装一个社区插件 ────────────────────
 *
 * MEASURED（2026-10-12，在官方 desktop 0.2.0-rc.2 上实测）：
 *
 *   社区里确实有做这件事的插件（`dsh-session-id`、`@moon16u/dsh-plugin-session-id`），
 *   而**本插件已经持有这个位置需要的全部东西**：
 *
 *     · `conversation.session.header.actions` 槽位 —— `TeamChatEntry` 已注册在 :107；
 *     · `sessionId` 这个 prop —— 框架按 `scope: 'session'` **自动注入**，
 *       `TeamChatEntry` 的签名已经在消费它。
 *
 *   ⇒ 同一个槽位再加一格，成本是**一个文件**；而装一个社区包的成本是
 *     一个新依赖 + 一份版本约束 + 一条新的 HMR 面。
 *
 * ── ★ 为什么挂在 `utilities` 而不是 `actions` ──────────────────────────────────
 *
 * `actions` 是**标题旁**的会话动作区（"查看团队"按钮在那里，靠左）；
 * `utilities` 是**右对齐**的会话工具区。会话 ID 属于"关于这个会话的元信息"，
 * 与"这个会话里有什么"不是一回事 —— 两格并排会让用户把 ID 读成团队的一部分。
 *
 * ★ 而两个槽位的 owner props 是**同一个类型**（`ConversationHeaderActionOwnerProps`，
 *   见宿主 `dsh-client-ui-conversation` 的 `slots.d.ts:155/161`），
 *   所以 `PropsRuntime<'conversation.session.header.utilities'>` 拿到的
 *   `sessionId` 与 `actions` 那边**同源**，不需要额外的取值路径。
 *
 * ── ★★ 三态：这里没有"第四个状态"─────────────────────────────────────────────
 *
 *   · `idle`    —— 按钮显示截断的 ID（默认）
 *   · `copied`  —— 刚刚复制成功（短暂）
 *   · `failed`  —— 两条剪贴板路径都失败（短暂，且**说出来**）
 *
 * ★ `sessionId` 缺失时**整格返回 null**，而不是渲染一个空按钮：
 *   一个点了没反应的按钮与"功能坏了"同形，而"没有会话"本来就不该有这个控件。
 *
 * @module dsh-agent-teams/client/session-id-action
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { copySessionId, shortSessionId, type SessionIdClipboardEnv } from './session-id-chip.ts'
import { IconCheckOutline16, IconCopyOutline16 } from './icons.tsx'
import css from './SessionIdAction.module.css'

/**
 * How long the transient `copied` / `failed` label stays up, in milliseconds.
 *
 * ★ Exported so a fixture drives the SAME duration the browser uses instead of
 *   restating it (a fixture that hard-codes 1200 keeps passing after this
 *   number changes, which is how a stale assertion looks like a live one).
 */
export const SESSION_ID_FEEDBACK_MS = 1400

/** What the chip is currently saying. */
export type SessionIdChipStatus = 'idle' | 'copied' | 'failed'

/**
 * The two mechanisms this component will use, read from the real globals.
 *
 * ★ Kept as a separate exported function so the fallback path is reachable in a
 *   fixture without a browser: pass a fake env to {@link copySessionId} instead
 *   of monkey-patching globals.
 *
 * ★ `document.execCommand` is deprecated but still the only synchronous path in
 *   a non-secure context, so it is read defensively rather than assumed.
 * @returns the clipboard mechanisms this host actually exposes.
 */
export function sessionIdClipboardEnv(): SessionIdClipboardEnv {
  const doc = typeof document === 'undefined' ? undefined : document
  return {
    clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard,
    execCommand: doc === undefined ? undefined : (command: string) => doc.execCommand(command),
    createTextarea: doc === undefined
      ? undefined
      : () => {
        const area = doc.createElement('textarea')
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        doc.body.appendChild(area)
        return {
          get value() { return area.value },
          set value(text: string) { area.value = text },
          select: () => { area.select() },
          remove: () => { area.remove() },
        }
      },
  }
}

/**
 * One session-ID chip: truncated id by default, click to copy, transient
 * confirmation or failure.
 *
 * @param props.sessionId - framework-injected id for this header's session.
 * @param props.t - `agentTeams` locale lookup.
 */
export function SessionIdAction({ sessionId, t }: PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'agentTeams'>) {
  const [status, setStatus] = useState<SessionIdChipStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])

  const onCopy = useCallback(() => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    void copySessionId(sessionId, sessionIdClipboardEnv()).then(outcome => {
      setStatus(outcome === 'copied' ? 'copied' : 'failed')
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => { setStatus('idle') }, SESSION_ID_FEEDBACK_MS)
    })
  }, [sessionId])

  const shown = shortSessionId(sessionId)
  if (shown === '') return null
  const label = status === 'copied' ? t('sessionId.copied') : status === 'failed' ? t('sessionId.copyFailed') : shown
  return (
    <button
      className={css.sessionId}
      data-session-id-chip
      data-status={status}
      type="button"
      title={status === 'idle' ? t('sessionId.copyTitle', { id: sessionId }) : label}
      aria-label={t('sessionId.copyTitle', { id: sessionId })}
      onClick={onCopy}
    >
      {status === 'copied' ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
      <span className={css.text}>{label}</span>
    </button>
  )
}