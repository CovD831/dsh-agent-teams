/**
 * The audited Harness 0.1.2 / 0.1.5 / 0.1.7 subagent boundary. Keep version-specific shapes
 * here: API presence alone is not a promise of support for future versions.
 *
 * Alpha.2 owns followup/registerContinuableSetup; Alpha.5 and rc.1 own a
 * host-only FIFO queue; 0.1.5 uses a queue/steer deliverer. Both emit
 * synchronous agent/session-start with the explicit Agent. Their public
 * sendMessage instead steers a running Agent and must never carry team jobs.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
type Setup = (childCtx: Context, child: Agent) => () => void;
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'agent-teams': {
            readonly kind: 'agent-teams';
        };
    }
}
/**
 * 0.1.6 moved startup admission to serial agent/created. Older created events
 * have no source and precede session-start; ignore those until the old hook.
 * Keep the removed event's type confined to this audited compatibility seam.
 */
export declare function onAgentReady(ctx: Context, listener: (agent: Agent, vetoable: boolean) => void): () => void;
/** Read child-owned history, excluding any descriptor inherited from a parent. */
export declare function sessionOwnEvents(session: Session): readonly SessionEvent[];
/**
 * ── ★ 归属证据：这个成员【真的写过】哪些文件 ────────────────────────────────────
 *
 * `dsh-tool-fs` 给每次写入/编辑的 `tool/result` 挂 `meta.diffs`
 * （源码见 app.asar 内 `@deepseek-ai/dsh-tool-fs/lib/index.js`）：
 *
 *     meta.diffs: Array<{ path: string, oldText: string|null, newText: string }>
 *
 * `isFileDiff` 要求 `path: string`、`oldText` 为 null 或字符串、`newText` 为字符串；
 * `diffsFromMeta` 还要求数组非空且每一项都合法 —— 形状是实测的，不是猜的。
 *
 * ★ 为什么走【会话事件】而不是 cwd 或 git status：
 *   · START-HERE §5②：子会话 cwd 硬编码继承父会话 ⇒ 隔离不能靠 cwd；
 *   · START-HERE §5③：全队在同一目录 ⇒ git 只知道"工作区脏了"，不知道是谁改的。
 *   会话事件是**逐成员**的，所以它同时绕开这两条。
 *
 * ★ 返回 `undefined` 与 `[]` 必须不同形：
 *   · `undefined` ⇒ 没能读到事件（判据 ⇒ unmeasured）
 *   · `[]`        ⇒ 读到了，确实没有写入（判据 ⇒ 可以据此判定虚报）
 *
 * 形状不认识时返回 `undefined`（"没能测量"），**不是** `[]`（"测了是零"）——
 * 把这两件事混起来，会让一次读取失败伪装成一个关于工作的结论（契约 §3.4）。
 */
export declare function observedChangedPaths(session: Session): string[] | undefined;
/**
 * ── ★★ 第二个观察面：工作区里【确实脏了】的路径（t17）─────────────────────────────
 *
 * ── 它解决的是什么问题（MEASURED，三人独立复现，含 captain 本人）─────────────────
 *
 * `observedChangedPaths` 只看得见**本 session** 的写入。而 `[]` 有两种成因，
 * 它们在返回值上**同形**：
 *
 *   (i)  写入发生在**另一个 session** —— captain 用 `cp` 并入、成员被 retire 后
 *        换人。此时改动**真实存在于工作区**，而本 session 一条写入都没有。
 *        ⇒ 诚实申报被读成"虚报" ⇒ **每一个被重派/并入的 attempt 都交不出终态**。
 *   (ii) **零工作却自报改动** —— `dispatch.changed-paths` 存在的理由。
 *
 * ⇒ 要区分它们，需要一格"别处"的证据。工作区就是那个别处：**改动真的存在**这件事，
 *   git 知道，而它**与哪个 session 写的无关**。
 *
 * ── 三态（与 `observedChangedPaths` 逐条对齐，绝不合并）────────────────────────
 *
 *   `undefined` —— 没能读工作区（不是 git 仓库 / git 跑不起来）⇒ 不参与判定
 *   `[]`        —— 读了，工作区是干净的
 *   `[paths]`   —— 读了，这些路径确实脏
 *
 * ★ 为什么 `undefined` 与 `[]` 必须不同形：前者是"我没有证据"，
 *   后者是"证据表明没有改动"。把前者当成后者，会让一次 git 故障被读成一个
 *   关于成员工作的结论 —— 而那正是本文件反复强调的那条界线。
 *
 * ★ 为什么用 `git status --porcelain` 而不是 `git diff`：
 *   新建文件（untracked）在 `diff` 里不出现，而它是最常见的一类真实改动。
 *   `--porcelain` 同时覆盖 `??`（新增）与 ` M`（修改）。
 *
 * ★ 诚实边界：git 只知道"工作区脏了"，**不知道是谁改的**（全队共用一个目录，
 *   见 START-HERE §5③）。⇒ 本函数**不能**用来判定归属，它只回答
 *   「这些路径在工作区里确实变了吗」。归属仍由会话事件回答 —— 两格合起来才完整。
 */
export declare function gitChangedPaths(workspace: string): string[] | undefined;
/** Install before the first request, including cold resume, with HMR cleanup. */
export declare function installContinuableMemberSetup(ctx: Context, setup: Setup): void;
/** Queue a distinct host-authored turn; never substitute model-message steer. */
export declare function queueMemberPrompt(runtime: Context['subagents'], parent: Agent, childId: SessionId, content: ContentBlock[], signal: AbortSignal): Promise<MessageId>;
/** Coordination joins the nearest step, including waking an idle/cold child. */
export declare function steerMemberPrompt(runtime: Context['subagents'], parent: Agent, childId: SessionId, content: ContentBlock[], signal: AbortSignal, live?: Agent): Promise<MessageId>;
/** Guard all resumable delivery paths, preserving the native service receiver. */
export declare function guardSubagentDelivery(ctx: Context, isRetired: (sender: Agent, targetId: SessionId) => Promise<boolean>): void;
/**
 * Names the host's `tools.restrict()` would admit for this agent's layer
 * chain, or undefined when the host does not expose its registry view.
 * restrict() rejects unknown names with a hard error, so the spawn path must
 * check entries against this view before forwarding them. Source:
 * dsh-tools view()/restrict() in 0.1.5-rc.1; older Harness generations lack
 * the surface and keep the verbatim list.
 */
export declare function restrictableToolNames(agent: Agent): ReadonlySet<string> | undefined;
/**
 * Member `toolFilter` for one spawn. Captain-only names are registered by
 * this plugin itself and always resolvable; the depth-related entries name
 * HOST tools and are only known under some compositions, so they must be
 * resolved against the running host's registry: the delegation tool name is
 * host configuration (dsh-tool-subagent `toolName`, default `subagent`,
 * renamed per composition, e.g. `subagent_fork` in web-style profiles), and
 * forwarding a name the host dropped aborts every member spawn (#163, #164).
 * Depth enforcement itself does not depend on these names —
 * installMemberDelegationGuard bounds descendant creation by parent chain.
 */
export declare function memberToolFilter(maxDepth: number | undefined, knownTools: ReadonlySet<string> | undefined): {
    deny: string[];
};
/**
 * Start one member, dropping any filter name the host reports as unknown and
 * retrying.
 *
 * Resolving the filter against the registry view ({@link memberToolFilter})
 * only covers hosts that expose one. A rejected filter still leaves the member
 * without a session for the lifetime of the team, so the start must survive the
 * cases that resolution cannot see — no registry view, a name that is known but
 * not restrictable, a composition that mounted differently than expected. The
 * host names the offenders in its rejection, so they are removed and the start
 * retried; the retry only runs while the deny list strictly shrinks, and any
 * failure that is not an unknown-name report propagates untouched.
 * @param start - performs one start attempt for the given `toolFilter`.
 * @param filter - the filter to attempt first.
 * @returns the started member.
 */
export declare function startMemberWithLenientFilter<T>(start: (filter: {
    deny: string[];
}) => Promise<T>, filter: {
    deny: string[];
}): Promise<T>;
export {};
