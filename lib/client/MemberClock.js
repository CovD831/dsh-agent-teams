import { jsx as _jsx } from "react/jsx-runtime";
/**
 * One member's elapsed readout — and the ONLY thing that owns its timer.
 *
 * ── ★★★ Why this is its own component (MEASURED, R2 开工时) ────────────────────
 *
 * 秒表原本长在 1599 行的面板里（`useElapsedNow` 挂在 `TeamSection` 上）：
 * 它一 tick，`TeamSection` 连同**整棵面板树**重渲染。而它每秒都在跑，哪怕
 * 队里只有一个人在动。
 *
 * ★ 契约的原话是"the per-second timer lives inside a small component that owns
 *   only the elapsed text, so a tick re-renders that component and not the panel
 *   tree"，而且它是一条**可测**的要求。
 *
 * ⇒ 修法就是这个文件：把 `useState(now)` 与 `setInterval` 都关在这里，
 *   对外只交出一行字。父组件**不持有** `now`，所以它没有任何理由跟着 tick 重渲染。
 *
 * ★ 而"关在这里"还不够：一个每秒 setState 的组件会重渲染它**自己**的子树，
 *   所以这一格必须尽量小（一行 span），并且只在**真的在跑**时才起表
 *   （见 `memberClockTicks`）。
 *
 * ★ 第三种读数必须不同形：读不出时长时，这一格印"时间未知"，**不是空白**。
 *   用户实测过空白格："Integrator 前面是一个空白的显示，这说明显示就不对。"
 * @module dsh-agent-teams/client/member-clock
 */
import { useEffect, useState } from 'react';
import { formatElapsed, memberClockTicks, } from "./activity-model.js";
import css from './ActivityPanel.module.css';
/**
 * Per-second tick, in milliseconds.
 *
 * ★ Exported so the isolation arm drives the SAME cadence the browser uses
 *   instead of guessing a number that could drift from this one.
 */
export const MEMBER_CLOCK_TICK_MS = 1000;
/**
 * The observation instant, ticking only while `active`.
 *
 * ★ `active` is derived from the readout (`memberClockTicks`), and the effect
 *   tears the interval down the moment it goes false — "an idle or waiting
 *   member does not keep a timer alive" is therefore a property of the effect,
 *   not of a comment.
 * ★ `frozenNow` replaces the ticking instant entirely (and creates no interval),
 *   so a fixture can render a determinate number.
 * @param active - whether this readout actually needs a live clock.
 * @param frozenNow - a caller-supplied instant that replaces the ticking one.
 * @returns the instant this readout should be measured against.
 */
export function useMemberClockNow(active, frozenNow) {
    const [now, setNow] = useState(() => frozenNow ?? Date.now());
    useEffect(() => {
        if (!active || frozenNow !== undefined)
            return;
        const timer = setInterval(() => { setNow(Date.now()); }, MEMBER_CLOCK_TICK_MS);
        return () => { clearInterval(timer); };
    }, [active, frozenNow]);
    return frozenNow ?? now;
}
/**
 * Render-facing copy for one elapsed readout.
 *
 * ★ Split out of the component so the four readings are asserted as *strings*
 *   rather than by reading CSS: a blank cell was the reported defect, and a
 *   blank is exactly what a missing branch produces.
 * ★ Every branch returns a non-empty string by construction — the fallthrough is
 *   the `running` copy, not `''`.
 * @param clock - the member's elapsed readout.
 * @param t - locale lookup.
 * @returns the line to print; never the empty string.
 */
export function memberClockText(clock, t) {
    if (clock.kind === 'idle')
        return t('member.clock.idle');
    if (clock.kind === 'unknown')
        return t('member.clock.unknown');
    const elapsed = formatElapsed(clock.ms);
    return clock.kind === 'stale'
        ? t('member.clock.waiting', { elapsed })
        : t('member.clock.working', { elapsed });
}
/**
 * One member's elapsed state: `worked N` / `waiting N` / `idle` / `unknown`.
 *
 * ★ This component owns the timer and NOTHING else: exactly one `<span>` goes
 *   out, and no other fact about the row passes through here.
 *
 * ★ `stamp` is the member's durable `updatedAt`, and the duration is recomputed
 *   from it against the ticking instant *inside this component*. That is why a
 *   tick cannot require a parent render: the parent's props never change.
 * @param props.kind - the readout's meaning (running / stale / idle / unknown).
 * @param props.stamp - durable last-write stamp, present for running/stale.
 * @param props.active - when false, no timer is created at all.
 * @param props.frozenNow - a fixed instant for deterministic rendering.
 */
export function MemberClock({ kind, stamp, active, frozenNow, t }) {
    const ticks = active ?? memberClockTicks(kind);
    const now = useMemberClockNow(ticks, frozenNow);
    /**
     * ★ The duration is derived HERE, from the durable stamp and the ticking
     *   instant, so `now` never becomes a prop of the row or of the panel.
     */
    const clock = kind === 'idle' || kind === 'unknown' || stamp === undefined
        ? { kind, ms: 0 }
        : { kind, ms: Math.max(0, now - stamp) };
    return (_jsx("span", { className: css.memberClock, "data-kind": kind, "data-ticks": ticks ? 'true' : 'false', title: memberClockText(clock, t), children: memberClockText(clock, t) }));
}
