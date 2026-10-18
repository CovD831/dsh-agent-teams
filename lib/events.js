/**
 * Durable AgentTeams session events and their emitter.
 *
 * Every team-state mutation appends one event to the captain's Session, so
 * the web client's Conversation Node mechanism can fold the tree view from
 * the session log deterministically (same mechanism as `tool-workflow`'s
 * `tool-workflow/*` record events). Events append to the captain's session
 * even when a member agent performed the mutation, so the captain's
 * conversation stream stays the single authoritative monitor surface.
 *
 * Types and the `SessionEventMap` merge live in `event-types.ts` (zero
 * imports) so the browser program can load them without host augmentations.
 * @module dsh-agent-teams/events
 */
import * as dshSession from '@deepseek-ai/dsh-session';
/** Event types already reported as unsupported, to avoid repetitive logs. */
const skippedEventTypes = new Set();
/**
 * Append one AgentTeams event to a Session, containing failures (a broken
 * durable record must never break team tool execution).
 * @param ctx - the plugin context (for logging).
 * @param session - the session to record into (the captain's, normally).
 * @param type - the event type.
 * @param data - the event payload.
 */
export function appendTeamEvent(ctx, session, type, data) {
    // Out-of-repo events are not in the harness's generated vocabulary today.
    // Mutating that ReadonlySet would make readability depend on which plugins
    // happen to be loaded. Until Session.append exposes the official
    // `ignorable: true` writer surface, omit these informational records unless
    // the running harness already recognizes them. Disk state remains the
    // authoritative source for the activity panel.
    const known = dshSession.KNOWN_SESSION_EVENT_TYPES;
    if (known?.has(type) !== true) {
        if (!skippedEventTypes.has(type)) {
            skippedEventTypes.add(type);
            ctx.logger.debug(`agent-teams: session event "${type}" omitted because this harness does not recognize it`);
        }
        return;
    }
    try {
        session.append(type, data);
    }
    catch (error) {
        ctx.logger.warn(`agent-teams: session record failed after ${type}: ${String(error)}`);
    }
}
/**
 * Read an agent by id, degrading to `undefined` when the reading context is
 * no longer active.
 *
 * ── ★★★ 为什么这一层必须存在（MEASURED，十几次，跨四个成员与队长自己）─────
 *
 * 在工具的**返回值算完之后**、或在一个已经结束的成员回合里调
 * `ctx.agents.get(...)`，会抛
 *   `cannot get required service "agents" in inactive context`
 * 而**落盘已经完成**。
 *
 * 机制在 host 的 cordis（`lib/index.js:688`）：取值器沿 fiber 树往上找
 * `fiber.store`，而 `store` **只在 fiber 处于 active 时存在**；本插件在顶层
 * `inject` 里声明了 `agents`（`src/index.ts:56`），于是当**本处理器所属的 fiber
 * 已经不在运行**时，取值器走到"我自己就声明了它"这一支 ⇒ **当场抛，不再往上找**。
 *
 * ★ 为什么它是**跨工具的系统性缺陷**而不是某一处：这个读取被
 *   `captainSessionOf` 用在**每一个工具**的事件记录路径上。于是"成员回合结束"
 *   这一个事件，会把每一次后续工具调用的返回值都变成本来不存在的"失败"——
 *   而调用方无法分辨"没做"与"做了但回执丢了"，于是重试，重试又成功又失败。
 *
 * ★ 只吞**这一种**：服务读不到。其余异常照旧往上抛 —— 一个 `catch` 若把
 *   "读不到会话"与"记录逻辑自己坏了"读成同一件事，就是把这一格修成一个更宽的盲区。
 * @param ctx - the plugin context (injects `agents`).
 * @param sessionId - durable session id to look up.
 * @returns the live agent, or `undefined` when it is not readable here.
 */
export function liveAgentOf(ctx, sessionId) {
    if (sessionId === '')
        return undefined;
    try {
        const agents = ctx.agents;
        return agents?.get?.(sessionId);
    }
    catch (error) {
        const message = String(error?.message ?? error);
        if (!message.includes('inactive context'))
            throw error;
        return undefined;
    }
}
/**
 * Resolve the captain's live Session for event recording. The captain agent
 * may be offline (its team outlives the session), in which case the caller's
 * own session is used as the fallback record target.
 *
 * ★ 这次读**必须**是尽力而为的：事件记录是旁路，不是任何终态转换的判据。
 *   让"读不到队长会话"把一次已经落盘的工具调用判成失败，是本仓记账最久的那一格
 *   （见 {@link liveAgentOf}）。
 * @param ctx - the plugin context (injects `agents`).
 * @param captainSessionId - the captain's durable session id.
 * @param fallback - the calling agent's session, used when the captain is not live.
 * @returns the session to record into.
 */
export function captainSessionOf(ctx, captainSessionId, fallback) {
    return liveAgentOf(ctx, captainSessionId)?.session ?? fallback;
}
