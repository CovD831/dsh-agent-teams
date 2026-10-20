import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TeamState } from './types.ts';
export declare const TEAM_ACTIVATION_PROMPT = "AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.";
/**
 * ── ★★★ 成员提示词是**唯一**一处"成员能知道自己能派 subagent"的地方 ──────────────
 *
 * MEASURED（2026-10-18 夜里，这个缺口让我建出了一支**早期形态**的队）：
 *   · 实盘 `memberMaxDepth: 1`（`cordis.patch.yml:448`）⇒ 成员**确实能**派 subagent；
 *   · 但 `grep -c subagent` 在本文件与派发提示词里 = **0** ⇒ 权限给了、**没人告诉它**；
 *   · 而成员的工具出口只有 `send_message`（`scheduler.ts:643`）⇒ 它只会"汇报"。
 *   ⇒ 于是「持久记账点 + 每任务拉一对临时 worker/reviewer」那个形态，
 *     **只**存在于 `mutation-quality` 这类团队手工写进 `executionPrompt` 的文本里
 *     （`ledger` 逐字："memberMaxDepth 必须允许你派一层 sub-agent"）。
 *     没有那段文本的队，成员即使拿到 subagent 工具也不会用。
 *
 * ★ 措辞刻意**条件化**（"若你的人设把活派给帮手"），而不是"你可以派 subagent"：
 *   后者会让每个实现者成员都想把活再转包一层 —— 而那恰恰是**不**该发生的事
 *   （实现者的价值就是它自己在 worktree 里改文件）。
 *   这一段只把"人设说了要派"这件事从**不可能**变成**可能**。
 *
 * ★ 长度预算：本仓夹具 `scripts/capabilities.test.mjs` 断言 < 600 字节
 *   （`Buffer.byteLength(TEAM_MEMBER_PROMPT) < 600`），当前 544。
 *   ⇒ 这句话每加一个词都要重新量；把它写长会把那条断言撞红。
 */
export declare const TEAM_MEMBER_PROMPT = "You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement. If your persona delegates the work to helpers, spawn subagents for it rather than doing it yourself.";
/**
 * ── ★★★ `shape: 'dispatch'` 的成员提示（2026-10-20，用户裁定乙方案）────────────────
 *
 * ── 为什么需要**第二条**提示，而不是改上面那条 ──────────────────────────────────
 *
 * 上面那条的最后一句是**条件句**：`If your persona delegates the work to helpers…`。
 * 而本文件 `:24` 的注释自己写下了它的边界：「这一段只把"人设说了要派"
 * 这件事从【不可能】变成【可能】」。⇒ **条件的前件由谁提供？没有人负责。**
 *
 * MEASURED（用户指出 + 本队普查）：8 个队里只有 2 个的人设提到了派临时工，
 * 其余 5 个（含本轮那个）全是早期形态；而后果是**三个成员的会话先后烧穿
 * 100 万 token 上限**（`CONTEXT_WINDOW_EXCEEDED`，见
 * `docs/DEFECT-VERIFY-RERUN-WRONG-CWD.md` 的附录）。
 * ⇒ 那套形态存在的**理由**就是避免这场失败 —— 而默认路径没有走进去。
 *
 * ── 所以这一条是**命令式**的，不是条件式的 ────────────────────────────────────
 *
 * 当 `team.shape === 'dispatch'` 时，成员**确实是**派工点（用户已定的形态），
 * 于是这句话不需要等人设来开条件 —— 它直接说"你要拉临时 sub-agent"。
 *
 * ★ 而它**仍然尊重人设**：人设可以补充细节（拉几个、注入什么），
 *   但当 `shape` 明说这是派工点时，"做不做"不再由人设的措辞决定。
 *
 * ★ 为什么不在 `'flat'` 时也发这一条：扁平成员池里的成员**就是**实现者，
 *   对它说"别自己干、去拉临时工"会让每个实现者都转包一层 ——
 *   而那正是 `:24-27` 那段刻意避免的事。
 */
export declare const TEAM_DISPATCH_MEMBER_PROMPT = "You are an AgentTeams member and THIS TEAM IS A DISPATCH TEAM: your durable role is the dispatch point, not the implementer. For every implementation or repair task, spawn a fresh subagent, give it only that task's contract (objective, acceptance, inScope, outOfScope, verify) and the readings the contract names, then record what it returns. For review, spawn a fresh subagent too. Do not write or review the code yourself: a durable member that accumulates every task in one context eventually exceeds the context window, and that failure is indistinguishable from the work failing. Follow your persona for everything else (which tasks you own, what you check, how you report). Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates. Do not create, approve, edit or resume a team.";
interface CapabilityConfig {
    stateDir: string;
    isPendingMember: (agent: Agent) => boolean;
    captainPrompt: () => string;
    order?: number;
}
/**
 * ── ★★★ 按形态选成员提示（2026-10-20，用户裁定乙方案）────────────────────────────
 *
 * 抽成一个**导出的纯函数**而不是写在 `text` 回调里，理由与 `parseRules` 同一类：
 * **判据要有一个能被单独测到的落点**。
 *
 * MEASURED（本任务的定向突变）：第一版把这段三元写在回调里，于是"把选择逻辑短路成
 * 永远返回 `TEAM_MEMBER_PROMPT`"这个突变**零条红** —— 因为没有任何臂能穿过
 * 整个 `installTeamCapabilities` 去问"这一次发的是哪一条"。
 * ⇒ 抽出纯函数之后，那条突变当场被臂 6 抓到。
 *
 * ★ 三态（缺席 / dispatch / flat），**缺席落回今天的行为**：
 *   存量 8 个队里实测 5 个是早期形态，若缺席默认成 `'dispatch'`，
 *   它们的成员会突然被告知"别自己干" —— 一次静默的行为改写。
 *   ★ 而这也是 `TeamState.shape` 的注释里那条三态纪律的**执行点**：
 *     "判不了"退回已经跑过的行为，不猜一个新默认值。
 */
export declare function memberPromptFor(shape: TeamState['shape'] | undefined): string;
/** Call once, after all business definitions have registered. Never per member. */
export declare function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void;
export {};
