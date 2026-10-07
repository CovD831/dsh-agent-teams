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
/**
 * ── ★★ 成员的 worktree 也是一个工作区（t41 / f-0023）─────────────────────────────
 *
 * ── 它修的是什么（今天拦了成员 4 次，含本任务作者本人）──────────────────────────
 *
 * {@link gitChangedPaths} 的入参是**队长的**工作区（`workspaceOf(captain)`）。
 * 而被派发了 worktree 的成员在**自己的检出目录**里干活 —— 那是另一棵树：
 *
 *     /repo                        ← 判据看的（队长的工作区）
 *     /repo/.agent-teams/worktrees/task-t41   ← 成员真正改的地方
 *
 * ⇒ 成员改了 worktree 里的文件、如实申报，判据两个观察面**都**看不到它：
 *
 *     `observedChangedPaths`  只看得见本 session 的写入（换过会话就没有）
 *     `gitChangedPaths`       问的是队长那棵树，那里确实没脏
 *
 * ⇒ 于是诚实的申报被判成虚报。原文（今天 4 次实例逐字相同）：
 *   `… reported as changed but no write to it was observed … and it is not a
 *    changed path in the working tree either`
 *
 * ── ★★ 为什么它比一般的缺陷更贵：成员**拿不到任何合法输入**──────────────────────
 *
 *     · 填真实路径（worktree 里真的改了）  ⇒ 被本条判据拒
 *     · 填空数组                          ⇒ 被 completion 门拒（r5/mutation：
 *                                            "no changed files, nothing to mutate"）
 *
 * ⇒ 两条判据**各自都对**，合起来**没有任何合法输入**（t32 上实测的双向死锁）。
 *   而它的代价是：每一次都要人手工并入 —— 那正是"无人值守"要消灭的形态。
 *
 * ── ★ 修法的选择：让观察面**对上**，而不是放宽判定 ────────────────────────────
 *
 * 可能的三条路（任务书列的）：
 *   ① 把该成员 worktree 的写入算进观察面   ② 观察面同时接受 worktree diff
 *   ③ 把两种拒绝的成因分开说
 *
 * ★ 选了 **①+②**（它们是同一件事：判据要问**成员实际在哪个树里干活**），
 *   并把 ③ 一起做了 —— 因为"没能观察"与"任何工作区里都没有"是两种事实，
 *   而它们现在共用一句话。
 *
 * ★★ 而**不选**"放宽判定"（例如"只要 worktree 存在就放行"）：那会让
 *   "零工作却自报改动"变得可接受，而那是本判据存在的**全部理由**。
 *   本函数只做一件事：**把该看的那些树都看一遍**，判定规则一个字不改。
 *
 * ── 三态与 {@link gitChangedPaths} 逐条对齐（绝不合并）──────────────────────────
 *
 *   `undefined` —— 连主工作区都读不到（不是 git 仓库 / git 不可达）⇒ 不参与判定
 *   `[...]`     —— 读了：主工作区 + 每一个能读到的 worktree 的脏路径**并集**
 *
 * ★ 为什么 worktree 读不到时**不**把整格置为 `undefined`：主工作区那一份仍然
 *   是**有效的观察**（"这些路径在主树里脏了"这句话依然成立）。把它整格作废会让
 *   一条本来能核实许多路径的证据变成"没有证据" —— 那是**把观察丢掉**，
 *   与"把没测到并进通过"是同一个方向上的错。
 *   ★ 而读不到的 worktree 不产生任何路径：它只意味着"那一棵树没被算进来"，
 *     于是判定退回"主树 + 会话事件"。**不是放宽** —— 少一格证据只会让判定更严。
 *
 * ★★ 归属仍然不由 git 回答（与 `gitChangedPaths` 的诚实边界一致）：本函数说
 *   「这些路径**在某一棵树里**确实脏了」，**不说**是谁改的。归属仍由会话事件回答。
 *   两格合起来才完整 —— 而这里补的正是"另一棵树也可以作证"。
 */
export declare function workspaceAndWorktreeChangedPaths(workspace: string): string[] | undefined;
/**
 * ── ★★★ 观察面 + **它到底看了几棵树**（t59 / j-0007）──────────────────────────────
 *
 * ── 它修的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（t59，本任务）：`dispatch.changed-paths` 的拒绝信息里写着
 *
 *     「… not in any of the [N] workspace(s) that were checked
 *        (the main workspace and every member worktree under it)」
 *
 * ★ 而那个 N 读的是 `ctx?.observedWorkspaces ?? 1` —— 而 `observedWorkspaces`
 *   **从来没有被任何地方赋过值**（全仓 grep：只有声明与读取，零个赋值点）。
 *   ⇒ 它恒为 `undefined` ⇒ `?? 1` 恒取 1。
 *
 * ⇒ ★ 于是那句话里，**数字是兜底值、名词是空头承诺**：
 *     · `1` 是一个**兜底值伪装成读数**（读起来像"算出来是 1"）
 *     · "every member worktree under it" 在当时还【没有调用方】——
 *       本函数的前身只在夹具里被调用过（见 t59 的因果链）
 *
 * ★★ 而这不只是措辞问题：**一个没有调用方的扫描，与没有扫描在观测上完全相同。**
 *
 * ── 修法：把"看了几棵树"变成【读数】，而不是【兜底】────────────────────────────
 *
 * 本函数把两条事实一起交出来：
 *
 *     paths       —— 并集（与从前逐字相同，**判定规则一个字不改**）
 *     workspaces  —— ★ **实际读到了**的工作区数（主工作区 + 每棵读到的 worktree）
 *
 * ★ 三态（与判据那一格逐条对齐，且**三者不同形**）：
 *
 *     ① `undefined`                    —— 连主工作区都读不到（不是 git 仓库 / git 不可达）
 *                                          ⇒ "没能观察"，判据那一格不参与判定
 *     ② `{ paths, workspaces: 1 }`     —— 读了：只有主工作区（没有 worktree，或全读不到）
 *     ③ `{ paths, workspaces: N>1 }`   —— 读了：主工作区 + N-1 棵读到的 worktree
 *
 * ★ 而 ② 与 ① **必须不同形**（它们的补救动作不同）：
 *     ① 的补救是"去把 git 接上 / 换个能读的工作区"
 *     ② 的补救是"读到了、确实只有一棵树" —— 那是**结论**，不是**失败**
 *   把两者合成一个 `?? 1`，正是本任务要消灭的那件事。
 *
 * ── ★★ 及物性：读不到的 worktree【不算进"检查过"】──────────────────────────────
 *
 * 与下面那个 `continue` 同一口径（它本来就"没被算进来"）。⇒ 于是 `workspaces`
 * 与 `paths` **出自同一次遍历、同一组事实** —— 而不是各算各的。
 * ★ 这一点是刻意的：两个来自不同遍历的计数会分叉，而分叉之后
 *   "扫了 5 棵"与"5 棵里只有 1 棵读到了"在读数上同形。
 * ★ 而"读不到"本身不失真：`memberWorktreesOf` 列出了目录里**存在**的 worktree，
 *   而 `workspaces` 数的是**真的读出了内容**的那些（`continue` 掉的不计）。
 */
export declare function observeWorkspaces(workspace: string): {
    paths: string[];
    workspaces: number;
} | undefined;
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
