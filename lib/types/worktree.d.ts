/**
 * ── worktree 隔离：给每个任务一个干净、独立的工作目录 ────────────────────────────
 *
 * ── 它解决的是什么问题（★ 与「归属」是两件事）────────────────────────────────
 *
 * `dispatch/changed-paths` 判据已经解决了【归属】：哪些文件是哪个成员改的
 * （走会话事件的 `meta.diffs`）。
 *
 * 但 R5（红前绿后）/ 变异测试需要的是【版本】：一个可 checkout 的父版本，
 * 让新测试在上面必须变红。会话事件给不了这个 —— 它给的是
 * `{ path, oldText, newText }`，是【一次编辑的前后文本】，
 * 拼不出可信的父版本。**父版本只能来自 git 历史。**
 *
 * ⇒ 本模块提供那个"可 checkout 的历史"。
 *
 * ── 它为什么不是"改 cwd"（START-HERE §5②）────────────────────────────────────
 *
 * 子会话的 cwd 硬编码继承父会话（dsh-subagent 的 childSessionMeta），
 * **改不了**。所以隔离【不靠改 cwd】，而靠：
 *   ① 给这个任务准备一个独立目录；
 *   ② 在派发提示里把该目录【告诉成员】（`worktreePromptLine`）。
 *
 * ── 已实测的 git worktree 边界（2026-10-05，不是猜的）──────────────────────────
 *
 *   ① 同一分支不能检出到两个 worktree
 *      ⇒ 并行成员必须用 `--detach`（否则第二个直接失败）
 *   ② 新 worktree 是干净的 HEAD
 *      ⇒ 主工作区未提交的改动不会带过去 —— 这正是 R5 要的"父版本"
 *   ③ worktree 里没有 gitignore 的文件（如 node_modules）
 *      ⇒ 在里面跑 pnpm test 会因缺依赖失败 ⇒ 我们把它【报出来】
 *   ④ worktree 里的写入对主工作区完全隔离
 *
 * ── 三态纪律 ────────────────────────────────────────────────────────────────
 *
 * 建不出来时返回 `{ ok:false, reason }`，且 reason 必须说清是"隔不了"
 * （不是 git 仓库、没有提交）—— **不能与"不需要隔离"同形**（契约 §3.4）。
 */
export interface WorktreeResult {
    ok: true;
    /** Absolute path of the isolated working directory. */
    path: string;
    /** Branch/commit the worktree is parked at (detached). */
    base: string;
    /**
     * ★ gitignore'd top-level entries that exist in the repo but NOT in the
     * worktree (typically `node_modules`). Reported so the caller can tell the
     * member, instead of letting it discover a broken `pnpm test` by surprise.
     */
    missingIgnored: string[];
    /**
     * ── ★★★ 这一次的基线【是从哪儿来的】（t5）──────────────────────────────────────
     *
     * 它把"基线"从一个**位置**（永远是主树 HEAD）变成一个**有出处的读数**：
     * 哪条上游提交了、哪条没提交、哪条读不到，逐条在这里。缺席即沉默，而沉默
     * 正是这次要消灭的形态（见 `docs/WORKTREE-BASE-DEFECT.md`）。
     */
    baseline: BaselineResolution;
}
/**
 * ── ★★★ 一条上游依赖的基线读数 —— 三态（t5）────────────────────────────────────
 *
 * `docs/WORKTREE-BASE-DEFECT.md`：依赖边只表达顺序、不表达可见性。修法是让
 * 建树时把上游的 `deliverableCommit` 当成基线。★ 而"上游提交了没有"本身是
 * **三态**，把它压成一个 `string | undefined` 会让下面两件事同形：
 *
 *   · 上游**还没提交**（没做出东西 / 不是会提交的 kind）⇒ 退回主树 HEAD 是**对的**；
 *   · 上游**提交了、而那个 commit 现在读不到**（树被回收，提交成了不可达对象）
 *     ⇒ 退回主树 HEAD 是**将就**，读的人必须看得出"这不是上游的成品"。
 *
 * ⇒ 三态各自有名，且读不到那一态必须带 `why`。
 */
export type UpstreamBaselineReading = 
/** 上游提交了，且那个 commit 在这个仓库里解析得出。 */
{
    readonly kind: 'committed';
    readonly taskId: string;
    readonly commit: string;
}
/** 上游没有 `deliverableCommit` —— 它没提交（或它的 kind 本来就不建树）。 */
 | {
    readonly kind: 'not-committed';
    readonly taskId: string;
}
/** 上游声称有产物，**读不到**：commit 解析不出 / 连任务记录都不在。 */
 | {
    readonly kind: 'unreadable';
    readonly taskId: string;
    readonly why: string;
};
/** 建树基线的出处。 */
export interface BaselineResolution {
    /** 实际拿来当起点的 commit（`git worktree add --detach` 的那一格）。 */
    readonly base: string;
    /**
     * 这个起点是**哪来的**：
     *   `trunk`    —— 主树 HEAD（没有可用的上游产物时的正确回退）
     *   `upstream` —— 某条上游的产物 commit（或它的后代）
     *   `existing` —— ★ 树**本来就在**，这一格是它当前 HEAD 的**读数**，不是我们选的
     *
     * ── ★ 为什么第三格必须存在（否则这一层会说谎）────────────────────────────────
     *
     * 复用分支（`existsSync(join(path,'.git'))`）**不重新对齐**已经建好的树 ——
     * `docs/WORKTREE-BASE-DEFECT.md` 的补充段实测过：一棵在旧 trunk 上建的树，
     * 之后无论 trunk 怎么走，它都停在原地。
     *
     * ★ 于是"我算出来的基线"与"这棵树实际的 HEAD"可以是**两个不同的 commit**。
     *   把前者当成后者的读数，就是本仓记账最久的形态：**读数与实际不同形**。
     *   ⇒ 复用分支返回的是实际 HEAD，且 `source: 'existing'` 明说"这不是我选的"。
     */
    readonly source: 'trunk' | 'upstream' | 'existing';
    /** 主树 HEAD。★ **总是**解析出来 —— 它是回退项，必须随时可读。 */
    readonly trunk: string;
    /** 逐条上游读数，顺序与入参一致（没有依赖边 ⇒ 空数组）。 */
    readonly upstream: readonly UpstreamBaselineReading[];
    /**
     * ── ★ 上游产物【不在】这条基线的历史里（从基线到达不了它们）───────────────
     *
     * 对 `source: 'upstream'` 而言这是"别的上游与基线分叉了"；
     * 对 `source: 'existing'` 而言这是"这棵树建立之后上游才提交，而它没重新对齐"
     * —— 后者是**更常见**的一格，且它正是缺陷文档里那个"mtime 证明不了树里有提交"。
     */
    readonly diverged: readonly {
        readonly taskId: string;
        readonly commit: string;
    }[];
}
/**
 * 一条上游依赖的输入：只有两格，因为**只有这两格能影响基线**。
 *
 * ★ 刻意**不**收整个 `TeamTask`：这层只需要"有没有产物 commit"，
 *   收全集会让它顺手去读 kind / status / inScope —— 那些是**别处**的真值，
 *   在这里再判一次就是第二份真相（本仓记账过多次的形态）。
 */
export interface UpstreamTaskInput {
    readonly taskId: string;
    /**
     * 上游的产物 commit（`TeamTask.deliverableCommit`）。**缺席 = 上游没提交** ——
     * 而不是"我不知道"。三态的中间那一格由调用方用缺席表达，读不到用别的方式表达
     * （见 `UpstreamBaselineReading.unreadable`：它是本层真的去 `rev-parse` 之后
     * 才敢下的结论，不是调用方的猜测）。
     */
    readonly deliverableCommit?: string;
    /**
     * 调用方**已经知道**读不到时用它（例如任务记录根本不在队里）。
     * ★ 有它就不再尝试解析 —— 一个假 commit 会解析成假基线。
     */
    readonly unreadable?: string;
}
export interface WorktreeRefusal {
    ok: false;
    /** ★ Must say "could not isolate" — never "isolation was unnecessary". */
    reason: string;
    /**
     * ── ★ 这次拒绝是【哪一种】────────────────────────────────────────────────────
     *
     * 调用方必须能区分下面两件事，而它们的区别**不是措辞、是后果**：
     *
     *   `'unsupported'` —— 这个仓库【根本没有】隔离能力（不是 git 仓库）。
     *       这不是异常，是环境。⇒ 调用方应当降级派发，并把"未隔离"如实记进
     *       任务记录。★ 若把它也当成拒绝派发，成员会在共享目录里干活、任务却
     *       永远回 pending、调度器再踢再失败 ⇒ **无限循环，任务永久卡死**
     *       （实测：非 git 项目里所有 implementation/repair 任务全卡死）。
     *
     *   `'failed'`      —— 是 git 仓库，但这次建不出来（没有提交、权限、磁盘…）。
     *       这是真异常。⇒ 调用方应当拒绝派发，因为"本该能隔离却没有"意味着
     *       环境坏了，而它下一次可能就好了 —— 重试是合理的。
     *
     * ★ 为什么是【结构化字段】而不是让调用方去匹配 `reason` 的字符串：
     *   字符串匹配是脆的 —— 改一个标点、加一层 git 版本差异的措辞，判别就会
     *   静默翻转，而翻转的后果正是上面那个无限循环。这里把判别放在【产生它的
     *   地方】（我们刚刚亲自问了 git），调用方只读一个枚举。
     */
    unsupported?: boolean;
}
/**
 * 能不能在这个仓库里做隔离。**只读检查**，不建任何东西。
 *
 * ★ 返回拒绝时带 reason —— 调用方要能区分"这个仓库不支持"与"我们没试"。
 * ★ 并且带 `unsupported` —— 调用方还要能区分"这个仓库不支持"（⇒ 降级）
 *   与"本该能、这次没成"（⇒ 拒绝派发）。见 `WorktreeRefusal.unsupported`。
 */
export declare function detectWorktreeSupport(repo: string): {
    ok: true;
    base: string;
} | WorktreeRefusal;
/**
 * ── ★★★ 主干引用**从哪来**（W1：一个会过期的字符串不许再当缺省）─────────────────
 *
 * ── 它修的是什么（MEASURED，本任务的由来）───────────────────────────────────────
 *
 *   判据此前的签名是 `mainRef?: string`，而实现里写着 `mainRef = 'main'`。
 *   两处**生产**调用点（`src/tools/update-task.ts` 的交付后回收、终态扫描）
 *   都没传它 ⇒ 判据永远在跟一个**字面量** `'main'` 比。
 *   而本仓的集成**不在** `main` 上：实测 `main` 落后集成分支 HEAD **209 个提交**
 *   （`git rev-list --count main..HEAD` = 209，2026-10-20 读数）。
 *   ⇒ 同一个判据、同一棵树，把引用从 `'main'` 换成集成分支，
 *     8 棵树的裁决从 `keep` 翻成 `reclaimable`。
 *   ⇒ 这就是"磁盘 95% 满而 worktree 占 9.8G"的成因：**不是判据错了，是它读错了引用**。
 *
 * ── ★★★ 为什么**不能**只是把缺省从 `'main'` 改成集成分支的名字 ──────────────────
 *
 *   那是把"写死一个会过期的字符串"换成"写死**另一个**会过期的字符串"。
 *   分支名会变（本仓本轮就从 `main` 换到 `task-mutation-integrate`，
 *   下一次可能是别的）；写死它只是把同一个缺陷的复发时间往后推。
 *   ⇒ 所以缺省**不是**一个名字，而是**一个问法**：主树自己检出在哪条分支上。
 *
 * ── 声明式来源（按优先级）───────────────────────────────────────────────────────
 *
 *   ① `'explicit'` —— 调用方给了。★ 生产接线走的就是这一条：调用方先问
 *      `resolveTrunkRef(workspace)`，再把 `.ref` **显式**传进判据
 *      ⇒ 判据本身不再有"我猜一个"的余地。
 *   ② `'main-worktree-branch'` —— 从 `git worktree list --porcelain` 的**第一块**
 *      读主树检出的分支。★ 为什么是它：主树（captain 的工作区）就是"集成发生在哪"
 *      的那个地方 —— 成员在 detached 的隔离树里干活，产出被落盘到主树所在的
 *      分支上。**主树检出的分支 = 本仓此刻认定的主干**，这件事 git 自己知道，
 *      不需要我们再抄一遍常量。
 *
 * ── ★★★ 而"读到了名字"**不等于**"读到了引用"（这一步是可辩论的那一半）──────────
 *
 *   MEASURED：`git update-ref -d refs/heads/main`（HEAD 仍符号指向 main）之后，
 *   `git worktree list --porcelain` **照旧**打印 `branch refs/heads/main`（退出码 0），
 *   `git symbolic-ref --quiet --short HEAD` **照旧**答 `main` ——
 *   而此时 `git rev-parse --verify --quiet 'main^{commit}'` **失败**（rc=1）。
 *   ⇒ 若不核实就把那个名字当成主干，判据会拿着一个**解析不出来的引用**去比，
 *     而那必须落到 `undecidable`（判不了 ≠ 可以清）。
 *   ⇒ 所以下面**先拿到名字、再核验它 resolve 成 commit**；核验失败 ⇒ `unresolved`。
 *
 * ── 三态，且三者不同形 ─────────────────────────────────────────────────────────
 *
 *   `resolved`   —— 带 `ref`（给人看/给日志念）、`commit`（判据真正用的那个）、`source`
 *   `unresolved` —— 带 `why`。★ **绝不**退回一个字面量：没有主干就"无从比较"，
 *                  而那与"比过了、一样"是两件事。
 */
export type TrunkRefResolution = {
    status: 'resolved';
    /** 人读的引用名（`'task-mutation-integrate'`）。★ 判据**不**用它去跑 git。 */
    ref: string;
    /** ★ 判据真正拿去比较的那个 commit sha —— 已核验可解析。 */
    commit: string;
    /** 这个引用是怎么来的（读日志的人据此判断这次比较可信不可信）。 */
    source: 'explicit' | 'main-worktree-branch';
} | {
    status: 'unresolved';
    why: string;
};
/**
 * 解读主树（`git worktree list` 的第一块）检出的分支名。
 *
 * ★ 单独抽出来是为了可单测：`porcelain` 的格式是"块之间空行、块内 `key value`"，
 *   而块**顺序**有意义（第一块恒是主工作树）。
 * @returns 分支短名（`refs/heads/x` ⇒ `x`）；detached / 读不到 ⇒ `undefined`。
 */
export declare function mainWorktreeBranch(porcelain: string): string | undefined;
/**
 * 解析"这一次判据该拿哪个引用当主干"。
 *
 * @param repo - 主仓库根（任意一个 worktree 的公共目录所在仓库都行）。
 * @param explicit - 调用方显式给出的引用名。★ 给了就**只用它** ——
 *   调用方说比谁就比谁，本函数不替它改主意（那会让"我显式传了这个"变得不可信）。
 * @returns 三态。★ `unresolved` 由调用方各自决定怎么处置
 *   （判据 ⇒ `undecidable`；规划器 ⇒ 报出来而不是删）。
 */
export declare function resolveTrunkRef(repo: string, explicit?: string): TrunkRefResolution;
export interface CreateWorktreeOptions {
    /** The repository (captain workspace) the worktree is cut from. */
    repo: string;
    /** Task id — used to name the directory so parallel members never collide. */
    taskId: string;
    /**
     * ── ★★★ 团队 id —— 路径名的一部分（2026-10-10 实测加的）───────────────────────
     *
     * 缺省时可省略（老调用方/夹具），但**生产调用方必须给** —— 见
     * {@link worktreeDirName} 上面那段：任务 id 按团队重新计数，
     * 只用 `task-<id>` 会让新团队命中上一轮的树。
     */
    teamId?: string;
    /** Where worktrees live; defaults to `<repo>/.agent-teams/worktrees`. */
    root?: string;
    /**
     * ── ★★★ 本任务的**上游依赖**（t5）────────────────────────────────────────────
     *
     * 给了它，基线就**不再**无条件取主树 HEAD：`resolveWorktreeBaseline` 会挑其中
     * 最早那个可用的产物 commit（见那里的拓扑理由）。缺省 ⇒ 退回主树 HEAD，
     * 而那是**没有上游时的正确行为**，不是"不知道"。
     *
     * ★ 缺省**不是**静默缺省：`baseline.source` 会如实写 `'trunk'`，
     *   而 `baseline.upstream` 是空数组（"这条任务没有依赖边"是可读的读数）。
     */
    upstream?: readonly UpstreamTaskInput[];
}
/**
 * ── ★★★ 一棵任务 worktree 的目录名 ───────────────────────────────────────────────
 *
 * MEASURED（2026-10-10，两条链独立报出同一个现象）：
 *
 *   新团队 merge-e2e 的 t1/t2，成员拿到的树里**没有任务的靶子文件**。
 *   实测：
 *     task-t1 HEAD = d623cbd   ← 上一轮 integrate-probe2 的链 A 产物 commit
 *     task-t2 HEAD = 451c06d   ← 上一轮 integrate-probe2 的链 B 产物 commit
 *     而当前 HEAD = c70cf12
 *
 * ── 根因：任务 id 按团队【重新计数】，而路径名只用 taskId ──────────────────────────
 *
 *   每个团队的 t1 都叫 `t1` ⇒ 都想要目录 `task-t1`。
 *   而 `delete` 一个团队**不清理 worktree**（目录留着），
 *   于是新团队的同名任务命中复用分支 ⇒ **拿到上一轮那棵树**。
 *
 * ★★ 而它在读数上完全正常：`ok: true`、`base` 有值、目录在、`missingIgnored`
 *   也算得出来 —— **"复用了对的树"与"复用了别人的树"同形。**
 *
 * ── 修法：把 teamId 编进路径（在【根上】避免重名，而不是事后检测）───────────────
 *
 *   `task-<teamId>-<taskId>` ⇒ 两个团队的同名任务天然落到不同目录。
 *   ★ 为什么不做"事后校验归属"：那需要在树里再存一份归属记录，
 *     而**多一份会漂移的拷贝**正是本仓记账过多次的形态。
 *     名字本身就能分清的，不要再存一遍。
 *
 * ★ `safe()` 对两段都做：teamId 可能带用户输入的形状（它来自团队名/id）。
 */
export declare function worktreeDirName(teamId: string | undefined, taskId: string): string;
/**
 * ── ★★★ 建树基线：从「永远是主树 HEAD」改成「按上游产物定」（t5）──────────────────
 *
 * MEASURED（`docs/WORKTREE-BASE-DEFECT.md`）：`createTaskWorktree` 从
 * `detectWorktreeSupport(repo).base`（= 主树 HEAD）建树，而"任务 B 依赖任务 A"
 * **不**让 B 的树包含 A 的提交 ⇒ 下游在**旧代码**上干活，且两者写域重叠时
 * 下游会**整文件覆盖**掉上游的修复。真实语料：94 条实现→实现边里 60 条（63.8%）
 * 写域重叠、47 条（50%）上游真的提交了。
 *
 * ── 为什么挑【最早】那个可用产物，而不是最后一个 ────────────────────────────────
 *
 * 依赖的产物各自是一条 commit，它们**未必**在同一条历史里（各自从主干切出去）。
 * 拿"最后一条"会让基线**只**含那一条上游，其余的仍然看不见；而任何一个 commit
 * 的后代都**含**它自己 ⇒ 取最早者（拓扑上的最上游）能让**它自己**被包含。
 * ★ 更要紧的是：这样取到的基线与"上游全都看得见"之间**不画等号** ——
 *   所以 `diverged` 会把"某条上游与基线不在同一条历史"如实报出来，而不是假装
 *   它们已经合并了。真正的合并（integrator）是 t16 的事，这里**不做**。
 *
 * ── 反向半边：上游没提交 ⇒ 退回主树 HEAD（这是**对的**，不是降级）───────────────
 *
 * 上游没提交 = 它没产出可看的东西 ⇒ 主树 HEAD 就是当前可见的最新代码。
 * ★ 因此这一格**绝不**拒绝建树：一个"上游还没做完"的状态不该让下游连树都建不出来
 *   （那会把一次正常排序变成一次卡死，正是本仓记账过的 infinite-loop 形态）。
 *
 * ── 三态（逐条上游，不是整体一个布尔）────────────────────────────────────────
 *
 *   `committed`     —— 有 `deliverableCommit` 且在这个仓库里解析得出
 *   `not-committed` —— 没有 `deliverableCommit`（没提交 / kind 本来不建树）
 *   `unreadable`    —— 声称有产物，而 commit 解析不出（树被回收成不可达对象等）
 *
 * ★ 第三种**必须**与第二种不同形：前者是"上游没东西可看"，后者是"上游说有、
 *   而我读不到" —— 后者的补救动作是去查为什么读不到，不是继续在旧代码上干活。
 *
 * ★ 本函数**只读**：不建树、不写盘、不改任何任务记录。判据与派发都能安全地调它。
 */
export declare function resolveWorktreeBaseline(options: {
    repo: string;
    /** 主树 HEAD（`detectWorktreeSupport` 已解析出来的那一格，避免重复读 git）。 */
    trunk: string;
    upstream?: readonly UpstreamTaskInput[];
}): BaselineResolution;
/**
 * 给一个任务建一个 detached worktree。
 *
 * ★ 为什么 `--detach`：实测边界① —— 同一个分支不能检出到两个 worktree，
 *   而并行成员必然都在同一分支上。detach 之后每个任务各有一个独立 HEAD，
 *   互不冲突；R5 需要的父/修复版本切换在 detach 状态下照样能做。
 *
 * ★ t5：基线**不再**无条件取主树 HEAD —— 见 {@link resolveWorktreeBaseline}。
 *   给了 `options.upstream` 就按上游产物定，回退项仍是主树 HEAD。
 */
export declare function createTaskWorktree(options: CreateWorktreeOptions): WorktreeResult | WorktreeRefusal;
/**
 * ── ★ 一句话说清基线是怎么定的（日志与派发文本共用，不各写一份）───────────────────
 *
 * 三态必须**读得出是哪一种**：上游已提交 / 上游没提交 / 读不到上游。
 * 一个"基线：abc1234"的读数把三件事压成了同一行。
 */
export declare function describeBaseline(resolution: BaselineResolution): string;
export interface ProvisionOptions {
    /** The repository (captain workspace) the dependencies are copied from. */
    repo: string;
    /** The task worktree the dependencies are copied into. */
    worktree: string;
    /**
     * Top-level entries to copy (typically `<repo>/node_modules` — the ones
     * `missingIgnored` reported). Relative, but `..` and absolute paths are
     * refused: provisioning must never reach outside either root.
     */
    entries: readonly string[];
    /**
     * ── ★★ 硬链接原语（可注入）—— 让"退化到拷贝"那条路**可被夹具直接走到**───────
     *
     * 缺省是 {@link defaultHardLinkTree}（`cp -al`）。存在的理由不是"为了好测"，
     * 而是一条**可达性**问题：
     *
     *   ★ 生产那条退化路的**后半段**在真实环境里不一定造得出来，而最经典的那个原因
     *     ——跨设备 EXDEV——在这台机器上就造不出来：它要求源与目标真的在两个文件系统上
     *     （macOS 上 `/tmp` 是 `/private/tmp`，与工作区**同一个**卷）。
     *   一条"只能靠运气触发"的分支，等于一条**没被走通的**分支：它坏了也没人知道。
     *
     *   ★ 说清楚这里补的是**哪一半**：让 `cp -al` **失败**本身是可达的（源不存在、
     *     目标的父级是普通文件……），那些走 {@link defaultHardLinkTree} 的**真身**，
     *     夹具可以真跑。本缝补的是另一半 —— `{ok:false}` **返回之后**那段处置
     *     （退化到 `cpSync` + 把理由落进两条读数）。
     *
     * ⇒ 于是这里留一格**诚实的缝**：夹具可以注入一个"必然报失败"的原语，
     *   断言【退化真的发生了、理由真的被报出来了】，而**不需要**在这台机器上
     *   硬造一个第二文件系统（伪造一个跨设备场景比测不到更坏）。
     *   ★ 注入什么理由由夹具自己定 —— 它**不必**是 EXDEV，因为生产那条路本来
     *     也不区分 errno（见 {@link defaultHardLinkTree}）。
     *
     * ★ 生产调用方**不要**传它 —— 缺省那条就是真的 `cp -al`。
     */
    link?: HardLinkTree;
}
/**
 * 一棵树硬链接进另一棵：**普通文件硬链接、软链原样重建**（`cp -al` 的语义）。
 * ★ 返回读数而不是抛异常 —— "这个文件系统不支持硬链接"是**预期内的**一条路，
 *   不是异常（异常留给真的意外）。
 */
export type HardLinkTree = (source: string, target: string) => {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/**
 * ── 缺省硬链接原语：`cp -al <source> <target>` ────────────────────────────────
 *
 * ★ 为什么是 `cp -al` 而不是自己递归 `linkSync`：
 *   · `-a`（= `-dR --preserve=all`）里的 `-d` 正是"**不 dereference**、软链原样
 *     重建" —— 与旧代码 `cpSync(..., {dereference:false})` 逐条同义；
 *   · `-l` 是"能硬链接就硬链接"；
 *   · 权限位、时间戳、包内部那些 pnpm 的相对软链，全部按 `cp -a` 的既有语义走 ——
 *     手写一遍只会多出一堆自己造的边界。
 *
 * ★ 为什么走 `spawnSync` + **argv 数组**、绝不是 shell 字符串：源与目标都是
 *   调用方给的路径，拼进 shell 就是把注入点交给文件名（本仓对这条有明确纪律）。
 *
 * ★ 为什么把 stderr **原样**交出去（而不是把它归类成某个 errno）：本原语**不做**
 *   errno 级别的判别 —— 它只读 `exit status`，非 0 就是失败。
 *
 *     · 判据只有一条：`status === 0` ⇒ `{ok:true}`；否则 ⇒ `{ok:false, reason}`。
 *     · `reason` 里带的是 `cp` **自己的 stderr 原文**（含它写出的路径与错误串）。
 *
 *   ⇒ 于是"退化"这条路的触发面**比 EXDEV 宽**：任何让 `cp -al` 失败的原因
 *     （跨设备、**路径写错**、目标父级不是目录、权限不足、文件系统不支持硬链接……）
 *     都会落到同一条退化路上。这是**故意**的：真正决定"能不能硬链接"的不是
 *     我们，而是 `cp` 与文件系统 —— 我们只读它的结论。
 *
 *   ★ 而诚实性来自**不翻译**：理由原文照转 ⇒ "路径写错"报出来就是"路径写错"，
 *     绝不会被我们改写成"跨设备"。一个自作聪明的 errno 判别反而会把
 *     "`cp` 为什么失败"这件事盖掉（而本仓的纪律是：读数不许被加工成好听的形状）。
 */
export declare const defaultHardLinkTree: HardLinkTree;
/**
 * 一件依赖是【怎么】进的 worktree —— ★ 三态，不许并成一个布尔。
 *
 *   · `linked` —— 硬链接进去的：与源【共用同一份物理数据】（inode 相同）。
 *     ★ 这是常态，也是"多棵 worktree 只占一份磁盘"的来源。
 *   · `copied` —— 退回到了真拷贝（跨设备 / 硬链接不可用）。★ 它是**次好**的
 *     结果：依赖在场、调用方可以照常开工，但它**没有**省下磁盘，所以必须
 *     与 `linked` 分得开 —— 否则"这次占了双倍磁盘"这件事在读日志时消失。
 *   · `existed` —— 目标已经在场，本次【什么都没做】（幂等分支）。
 *     ★ 它与前两者不同形：前两者是"我动手了"，它是"早就在了"。
 *
 * ★ 为什么不并成一个 `copied: boolean`：本仓记账过的那条 ——
 *   "链接成功"与"退化成拷贝"在读数上同形时，磁盘为什么没省下来永远不会被发现。
 */
export type ProvisionMode = 'linked' | 'copied' | 'existed';
export interface ProvisionResult {
    /** Entries that are now present in the worktree. */
    copied: string[];
    /**
     * ★ 没能准备的那一件 + 原因。**必须报出来**：一件"没准备好"如果静默通过，
     *   成员会在里面跑命令、因缺依赖失败，然后把一次"环境没准备好"误报成
     *   "工作没做出来"（两者不同形）。
     */
    failed: Array<{
        entry: string;
        reason: string;
    }>;
    /**
     * ── ★★★ 逐条读数：这一件是【怎么】进场的 ──────────────────────────────────────
     *
     * `copied` 只回答"在不在场"，回答不了"省没省磁盘"。而后者正是这次改动的
     * 【全部目的】（46 棵树 × 1.6G = 23G ⇒ 并发被磁盘卡在 ~6，而不是被
     * `maxActiveSubagents` 卡住）。所以它必须是一条**自己的**读数。
     *
     * ★ 三态见 {@link ProvisionMode}：`linked` / `copied` / `existed`。
     *   **"退化成真拷贝"不是失败**（依赖确实在场），所以它【不】进 `failed` ——
     *   但也不能因此消失，它在这里，并带一条可读的 `reason`。
     */
    entries: Array<{
        entry: string;
        mode: ProvisionMode;
        reason?: string;
    }>;
    /**
     * ── ★ 退化发生过吗：所有**真拷贝**的理由（硬链接没成 —— 跨设备只是其中一种）───
     *
     * ★ 它就是调度器要落进任务记录的那一条 —— "这棵树的依赖占了双倍磁盘，
     *   因为 <cp 的 stderr 原文>"。★ 原文里是**真正的原因**：可能是 `EXDEV`（跨设备），
     *   也可能是路径写错 / 目标父级不是目录 / 权限不足 —— 本函数不替 `cp` 归类。
     *   空数组 = 每一件都是硬链接（或早已在场）。
     */
    linkFallbacks: Array<{
        entry: string;
        reason: string;
    }>;
    /**
     * ── ★★ 硬链接语义的诚实边界（不是免责声明，是一条必须被读到的读数）─────────────
     *
     * 硬链接 = 同一个 inode 的**又一个名字**。于是：
     *
     *   · **替换**一个文件（写新文件 + `rename`，也就是 `pnpm install` 做的事）
     *     ⇒ 只有做替换的那棵树换了 inode，另一棵树仍指向旧 inode
     *     ⇒ **两棵树各验证各的**这条前提成立。
     *   · **就地改写**（`writeFileSync` / `>>` / `sed -i` 不带 rename）
     *     ⇒ ★ **两棵树同时看见** —— 硬链接去掉了软链的"目录结构写穿"，
     *       但**去不掉共享 inode 本身**。这条必须明说，不能声称一个已经不成立的隔离。
     *
     * ★ 所以本字段在【注入之后】如实给出这条边界，调用方/成员能读到它，
     *   而不是从一个"复制品"的旧结论里去推断一个已经不成立的性质。
     */
    hardLinkCaveat: string;
}
/**
 * ── 依赖按需注入：把测试需要的包【硬链接】进 worktree ──────────────────────────
 *
 * worktree 是干净的检出，gitignore 的 `node_modules` 不在里面（实测边界③）。
 * 成员要在隔离目录里跑验证命令，就必须有依赖。四条路的实测结论：
 *
 *   · 软链（symlink）⇒ ★ **会被写穿**：worktree 里的写入顺着链改到主检出的
 *     依赖树。一条被共享、可被任意改写的依赖树，会让"两个成员各自验证"
 *     在日志里同形，而出问题时无从归因。
 *   · 只读锁（chmod / lockfile）⇒ 不阻止写穿，只把成员换成另一种失败方式。
 *   · 复制品（copy）  ⇒ 互不影响，代价是**磁盘**：1.6 GiB/棵 ⇒ 46 棵树 = 23 GiB
 *     ⇒ ★ **并发被磁盘卡在 ~6，而不是被 `maxActiveSubagents` 卡住**。
 *   · 硬链接（hard link）⇒ ★ 本函数现在的做法。**同一份物理数据的又一个名字**：
 *         - inode **相同**、`nlink` > 1 ⇒ N 棵树合起来只占**一棵**的大小；
 *         - 包内部自带的**相对软链原样保留**（`cp -al` 的语义与
 *           `dereference:false` 一致：硬链接文件、重建软链）；
 *         - **替换**文件（新文件 + rename，`pnpm install` 所做的）只影响做过
 *           替换的那棵树 ⇒ "两个成员各自验证"成立；
 *         - ★ 但**就地改写**会穿到另一棵树 —— 硬链接去掉了软链的写穿*路径*，
 *           **去不掉共享 inode 本身**。这条写在 `hardLinkCaveat` 里，不藏着。
 *
 * ── ★★★ 硬链接不成：退化，但【不是静默】─────────────────────────────────────────
 *
 * 硬链接过不了设备边界（源与目标在同一个文件系统上才可能）—— **跨设备 EXDEV 是
 * 这条路上最经典的那个原因，但不是唯一的一个**：路径写错、目标父级不是目录、
 * 权限不足、文件系统不支持硬链接……都会让 `cp -al` 失败，而本原语**只看 exit
 * status**（见 {@link defaultHardLinkTree}），不区分 errno ⇒ 它们**都**落到这条
 * 退化路上。这是有意的：**判据归 `cp` 与文件系统，我们只读结论**。
 *
 * 不论**哪一种**原因，处置是同一条：退回**本函数原来的** `cpSync` —— 依赖确实
 * 在场 ⇒ **不算 failed**（失败是"没准备好"，那是另一种形）。但"这次没省下磁盘"
 * 必须留下**可读的理由** ⇒ 进 `entries[].mode = 'copied'` + `reason`，并汇总进
 * `linkFallbacks`；`reason` 是 `cp` 的 **stderr 原文**，于是读日志的人看到的是
 * **真正的原因**（写错路径就报写错路径），而不是一句笼统的"跨设备"。
 * ★ 不许静默退化：静默之后"说好的共享"与"实际各占一份"在读日志时同形。
 *
 * ★ 为什么是选项而【不是】自动执行：注入一棵 node_modules 很贵，静默地做会把
 *   "派发很快"变成"派发很慢"。调用方（调度器）显式要求才做，本函数不猜。
 *
 * ★ 为什么 entries 必须显式给出：我们不读 `.gitignore` 的语义（那是 git 的事），
 *   调用方拿 `missingIgnored` 的结论来喂它 —— 于是"要注入什么"有唯一来源。
 */
export declare function provisionWorktreeDependencies(options: ProvisionOptions): ProvisionResult;
/**
 * ★ 派发提示里告诉成员"在哪干活"的那一行。
 *
 * 这是隔离能否真正生效的关键：cwd 改不了（§5②），所以**只能靠提示告诉成员**。
 * 不给出路径时返回空串 —— **绝不产出一个伪造的指令**。
 */
export declare function worktreePromptLine(path: string | undefined): string;
/**
 * ── ★★★ 把一棵 worktree 上的改动【提交】成一个 commit ────────────────────────────
 *
 * ── 它补的是什么（2026-10-10 实测出来的缺口）────────────────────────────────────
 *
 * 在此之前，本插件**只建树、不提交**：
 *
 *     scheduler.ts:839  createTaskWorktree(...)     ← 建了
 *     （成员在里面干活）
 *     （……没有任何地方 commit）
 *
 * MEASURED（2026-10-10，用 48 棵 worktree 普查）：
 *     46 棵 worktree 里，目标文件**一个都没有** —— 因为 worktree 是 checkout
 *     产物，只含**已提交**内容，而成员改动从未被提交。
 * ⇒ ★ 后果：integrator **没有任何东西可合**。
 *   「合并 ≥2 棵 worktree」这个承诺在机制上**无法成立** —— 不是没做，是没有载体。
 *
 * ── ★ 为什么"改动没提交"是一个静默的缺口 ────────────────────────────────────────
 *
 * 它不报错、不失败、每一项读数都正常：
 *   · 成员在树里改了文件 ⇒ `git status` 在**那棵树里**看得见；
 *   · 任务可以照常 completed（判据读的是成员自报的 changedPaths）；
 *   · 而**从外面看**（主仓、integrator、下游）什么都看不到。
 *
 * ⇒ 与本仓记过的那条同族：**"我改了"与"改动在版本控制里"是两件事**，
 *   而两者在"任务 completed"这个读数上同形。
 *
 * ── 三条设计约束（各自都有理由）─────────────────────────────────────────────────
 *
 * ① **只提交，不推送、不合并。** 合流是 integrator 的事（它要看到**多棵**树
 *    才能发现"各自自洽、合起来冲突"的那一类问题）。这里只负责让产物**有载体**。
 * ② **没有改动 ⇒ 不产出空 commit。** 空 commit 会让"这次什么都没改"与
 *    "改了但被提交了"同形 —— 而 integrator 会把它当成一条真实的产物去合。
 * ③ **失败要能说出是哪一种失败**（三态）：没有改动 / 提交成功 / 提交失败（带原因）。
 *    把它们合成一个布尔，就是本仓反复记账的那个合流。
 */
export type CommitWorktreeResult = 
/** 提交成功，`commit` 是新 commit 的短 id。 */
{
    ok: true;
    commit: string;
    filesChanged: number;
}
/** 树里没有改动 ⇒ **不产出空 commit**（这不是失败，是一个结论）。 */
 | {
    ok: true;
    commit: undefined;
    filesChanged: 0;
    reason: 'no changes to commit';
}
/** 提交失败，带原因（调用方据此上报，不许静默）。 */
 | {
    ok: false;
    reason: string;
};
export interface CommitWorktreeOptions {
    /** worktree 的绝对路径。 */
    worktree: string;
    /** 任务 id —— 进 commit message，让产物**可归属**到是哪一条任务造的。 */
    taskId: string;
    /**
     * 归属信息（可选）。★ 有它才能回答"这个 commit 是哪一次尝试造的" ——
     * 而 `attempt_id` 是 capability，它一换代，旧 commit 的归属就说不清了。
     * ⇒ 缺省时不编造，直接不写这一行。
     */
    attemptId?: string;
    /** 谁干的（成员名 / 临时工标识）。同样：缺省不编。 */
    author?: string;
}
/**
 * 提交一棵 worktree 上的全部改动。
 *
 * ★ 用 `git add -A`（含新增与删除）。**不**只加 tracked 文件 ——
 *   实测过的形态：新建文件是任务产物里最常见的一类，而 `git add -u`
 *   会静默漏掉它们，于是"提交成功"与"提交了个空"同形。
 */
export declare function commitWorktree(options: CommitWorktreeOptions): CommitWorktreeResult;
/** 一个便于诊断的单行描述。 */
export declare function describeWorktree(result: WorktreeResult): string;
/**
 * ── ★★★ 回收一个 worktree 是否安全：判据是「产物已被主树吸收」（t89）──────────────
 *
 * 用户原话：「不能每次都让我手动清理，得有一个自动清理的机制。」
 *
 * 上面那个 `provisionWorktreeDependencies` 是**装**，而这里补的是它的对面 ——
 * **收**。而两半必须成对：只有装没有收，就是今晚的 4.6G。
 *
 * ── ★★ 判据**不是**「任务已终态」────────────────────────────────────────────────
 *
 *   ① 一个 worktree 在【它的产物并入主树之前】不能删 —— 否则那份工作就丢了。
 *      ★ 今晚 t39 那次正是靠 worktree 找回的。
 *   ② 成员常常需要【重跑一次】（例如收口时再跑护栏）——
 *      若依赖已被清掉，那次重跑要重新 install，而那比保留更贵。
 *
 * ── ★★★ 而 `--is-ancestor` 【一条不够】—— 这是实测出来的 ────────────────────────
 *
 *   MEASURED（2026-10-08，本仓 50+ 个 worktree）：
 *
 *     `git merge-base --is-ancestor <wt HEAD> main` 成立 ⇒ **37 个**
 *     ★ 而那 37 个里 **35 个有未提交的改动**；再往里查，**7 个**持有
 *       【内容在整个历史里都不存在】的源码 —— `task-t64` 有 7 个源码文件
 *       （68KB / 69KB 级）只存在于那里。
 *
 *   ⇒ ★ 只看它会删掉**唯一的那份产物**，而那正是本能力承诺不会发生的事。
 *
 * ── ★ 所以是**两个条件的合取** ─────────────────────────────────────────────────
 *
 *   (a) 已提交的：`--is-ancestor <wt HEAD> main`
 *   (b) 未提交的：**每一个脏的源码文件的内容都能在历史里找到**
 *       ★ 只算源码（`src/` `scripts/` `docs/`）—— `lib/` 是构建产物，每次 build
 *         重生成，它脏不构成"唯一产物"。这个区分是实测逼出来的：
 *         不做它，`task-t16` 会因为一个 stamp 文件被误判成"有唯一产物"。
 *
 * ── ★★★ 而 `--is-ancestor` 【一条也不够】—— 反方向的那一半（t9）──────────────────
 *
 * MEASURED（2026-10-10，captain 在真实使用中量到）：
 *
 *   真实的合流流程**不是 merge，是按文件落盘**：
 *
 *     成员在自己的 worktree 里提交          ⇒ commit A
 *     captain **按文件**把它落进 main      ⇒ commit B（内容相同、**对象不同**）
 *     ⇒ A **永远不是** B 的祖先
 *     ⇒ 判据**永远**答 keep ⇒ 那棵 worktree 永远不会被回收
 *
 *   当天量到：4 棵**产物早已落在 main 上**的 worktree，全部答 `keep`，占 3.5G。
 *
 * ⇒ ★ 所以 (a) 必须被**放宽**成「已提交的部分被吸收了」的**两种形态**：
 *
 *     形态 Ⅰ（原来的那一条）：A 是 `main` 的祖先 —— 即真的并进去了。
 *     形态 Ⅱ（本次新增）：A 的**内容**已经在 `main` 里，即使 A 这个对象
 *        从来不是它的祖先 —— 即"按文件落盘"那种合流。
 *
 * ── ★★ 形态 Ⅱ 用的是什么 git 原语，以及它**不**覆盖什么 ──────────────────────────
 *
 *   用的是 `git patch-id --stable`：把一次提交的 `git show` 输出**规范化**成
 *   一个与父提交无关的 id（它把 hunk 的行号/偏移那类上下文抹掉，只留
 *   "改了什么内容"）。
 *
 *     `git show <A> | git patch-id --stable`   →  id_A
 *     `git show <main> | git patch-id --stable` →  id_main
 *
 *   而 `id_A === id_main` ⇒ **A 这次提交的改动，与主干顶端那次提交的改动
 *   逐内容等价**（即使两条提交的对象、父提交、时间戳都不同）。
 *   ⇒ 而"按文件落盘"产生的 B 正是这个形状：同样的内容、不同的对象。
 *
 * ★ 为什么**不**用 per-file 的树比较（`git diff --quiet <tree> main`）——
 *   它看着更简单，但**在本仓会恒不成立**。MEASURED（2026-10-10，本仓：
 *   `main` 里 3 个未跟踪的工作文件，`.agent-teams/` 未被 gitignore）：
 *
 *     树比较是**全树相等**，而它与"按文件落盘"的合流**不是同一个东西**：
 *     captain 落盘只落**产物那几个文件**，主干上**同时还有**别的工作
 *     ⇒ 两棵树从那一刻起就不可能相等 ⇒ 判据退化成**恒不删**。
 *   ⇒ 而 patch-id 比较的是**这一次提交的改动**，不是两棵树的快照
 *     ⇒ 它正是"按文件落盘"的那个形状。
 *
 * ── ★★★ 部分落盘 ⇒ **保留**（本模块明确裁定的边界）──────────────────────────────
 *
 *   判据问的是「**这棵树的这次提交**被吸收了吗」，而它只有两种答案：
 *   `id_A` 命中主干上**某一条**提交 ⇒ 吸收；一条都不命中 ⇒ 未吸收。
 *   ⇒ 「一半落盘、一半没落」在这个判据下**不**是一格单独的读数 ——
 *     它落到"未吸收"那一格（那条被落盘的提交**不是** A 的 patch-id）。
 *
 *   ★ 而即使将来有人把它写成"逐文件部分命中"，答案也**必须**是 keep：
 *     `absorbed` 是**删除的准入**，而"删掉它"会连带扔掉**没落盘的那一半**。
 *     判据宁可少删（保留一棵多余的树，成本是磁盘），也不能多删
 *     （扔掉一份只存在于那里的工作，成本是那份工作**本身**）。
 *   ★ 而"部分落盘"真的会发生：captain 落盘时**挑文件**是常态，
 *     所以这条边界不是假想的。
 *
 * ── ★★ 新增的这半边**没有**放松安全那一半 ──────────────────────────────────────
 *
 *   (b) 一个字没动，而且它仍然是**合取**里的一员 ——
 *   即使 (a) 两种形态**都**命中（真的并进去了、或内容已落盘），
 *   `unique-work` 照样能把一棵树**按住**（臂 3 与臂 T25-2 钉的就是这一格）。
 *   ⇒ 形态 Ⅱ 只是把 (a) 的**准入面**放宽了一格，**没有**动"什么算唯一产物"。
 */
export type WorktreeReclaimability = {
    status: 'reclaimable';
    reason: 'absorbed';
    /** ★ 这一次**拿谁比的**（W1）：读日志的人据此判断这次裁决可不可信。 */
    trunk: TrunkReading;
    /**
     * ★ 是**哪一种**吸收（三种形态**不是**同一件事，读的人要能分开）：
     *   `'ancestor'` —— 提交对象真的并进了主干（形态 Ⅰ）；
     *   `'content'`  —— 提交对象不是祖先，而**这次提交的改动**与主干顶端那次
     *                   逐内容等价（形态 Ⅱ，patch-id 命中，例如 cherry-pick）；
     *   `'files'`    —— ★ t34 新增（**更强**的那一格）：提交对象不是祖先、patch-id 也不命中，
     *                   而**这次提交碰过的每一个文件**在主干**顶端**上都存在且逐字节相同
     *                   （形态 Ⅲ，**手工按文件落盘且主干此后没再动过那些文件**）。
     *   `'contained'` —— ★ t34 新增（**更弱**的那一格，但覆盖面更大）：
     *                   两者都不命中，而这次提交碰过的**每一个文件的内容**
     *                   都在主干**历史**里（按可达性核对过 —— 见 `containedAbsorbed`）。
     *                   ▲ 它与 `'files'` **是两种不同的诊断，不许合流**：
     *                     `'files'` 说"主干今天拿着的就是这份内容"（更强的事实）；
     *                     `'contained'` 说"这份内容在主干的历史里被并进去过，
     *                     而主干顶端可能已经又变过"（例如 t28：并进一个 merge 提交，
     *                     此后主干前进过若干提交）。
     * ★ 三态共用 `status: 'reclaimable'` **是故意的**：裁决只有"能清/不能清"两种，
     *   "它是怎么被吸收的"是**依据**，不是第四种裁决 —— 把它做成第四种 status
     *   会让下游每一处读 status 的代码都要多认识一格，而那一格没有行为差别。
     * ★★ 而"依据"**必须可读**（契约明写的一条）：读的人要能分辨
     *   "它真的并进去了" / "它的内容被 cherry-pick 了" / "它的文件被手工落盘了"——
     *   三者的**复核动作不同**（查 merge、查 cherry-pick、逐文件比对）。
     */
    how: 'ancestor' | 'content' | 'files' | 'contained';
    behind: number | undefined;
} | {
    status: 'keep';
    reason: 'not-absorbed' | 'unique-work';
    trunk: TrunkReading;
    behind: number | undefined;
    detail: string;
    orphaned?: string[];
} | {
    status: 'undecidable';
    why: string;
};
/**
 * ── ★★★ 「这次裁决拿谁比的」必须**随裁决一起交出去**（W1）─────────────────────────
 *
 * ── 为什么它是一个字段，而不是只写进日志 ────────────────────────────────────────
 *
 *   本缺陷的原始形态是：判据**照常**给出裁决（`keep`），而那个 `keep` 是拿
 *   一个落后 209 个提交的引用比出来的。⇒ **裁决本身看不出它读错了引用**：
 *   一个"我比错了对象"的 keep 与一个"产物真的没被吸收"的 keep **完全同形**。
 *
 *   ⇒ 所以把"比的是谁、从哪来"做成**裁决的一部分**：
 *     `source` 说清这个引用是怎么来的，读的人（以及臂）据此能分辨
 *     "显式给了" / "从主树检出的分支推出来的"，而不必去猜。
 *
 * ── ★★ 而它**不是**第四种 status ────────────────────────────────────────────────
 *   它不改变裁决（判断仍然是「产物被吸收了吗」），只让那次判断**可复核**。
 *   三态之间的字段仍有区分（`undecidable` 没有它 —— 没比成，自然没有"比的谁"）。
 */
export interface TrunkReading {
    /** 人读的引用名（`'task-mutation-integrate'`）。 */
    readonly ref: string;
    /** 已核验可解析的那个 commit sha —— 判据真正拿去比的是它。 */
    readonly commit: string;
    /** 这一次的引用从哪来。★ `'explicit'` 与 `'main-worktree-branch'` 是两种可信度。 */
    readonly source: 'explicit' | 'main-worktree-branch';
}
/**
 * 判一个 worktree 能不能回收。
 *
 * @param repo - 主仓库根。
 * @param worktree - 那个检出目录。
 * @param mainRef - ★ 主干引用。**没有缺省值** —— 不给就走
 *   `resolveTrunkRef` 的**声明式来源**（主树自己检出在哪条分支上）。
 *   断言：本参数的类型里**没有** `= 'main'` 这种兜底；一个会过期的字面量
 *   不许再冒充"主干"。见 `resolveTrunkRef` 的文档（含 MEASURED 的 209 个提交）。
 * @returns 三态。★ 三者**不同形**：可清的带 `reason: 'absorbed'` 与 `how`
 *   （`'ancestor'`｜`'content'`，见 `WorktreeReclaimability`）；
 *   不可清的带 `reason` 与 `detail`（以及可能的 `orphaned`）；
 *   判不了的带 `why`。没有任何两个共用同一组字段。
 *
 * ── ★★★ 顺序（这是本判据可辩论的那一半）─────────────────────────────────────────
 *
 *   ① `undecidable`（读不到 HEAD / 读不到主干引用）—— **在一切之前**返回。
 *      判不了 ≠ 可以清，所以它**绝不**往下走到任何"吸收"的判断。
 *   ② 已提交的部分**是否被吸收** —— `--is-ancestor` 与"内容落盘"是**或**：
 *      形态 Ⅰ 命中就**短路**（不去跑 patch-id，省一次 `git show`）；
 *      形态 Ⅰ 不命中才跑形态 Ⅱ。★ 而两者**都不是旁路** ——
 *      它们只决定 `absorbed` 这个布尔值，之后的检查**照跑**。
 *   ③ ★ `unique-work` —— **吸收之后、reclaimable 之前**。
 *      它是把树按住的最后一道，且**对两种吸收形态一视同仁**：
 *      "内容已落盘"**不能**绕过它（臂 3 / 臂 T25-2 / 定向突变臂钉的就是这一格）。
 *   ④ `reclaimable`。
 */
export declare function judgeWorktreeReclaimable(options: {
    repo: string;
    worktree: string;
    /** ★ 显式给出就只比它；不给 ⇒ `resolveTrunkRef` 的声明式来源。**没有字面量兜底。** */
    mainRef?: string;
}): WorktreeReclaimability;
/** 把那个判定说成一句人话。★ 三态各有各的措辞（不许同形）。 */
export declare function describeReclaimability(verdict: WorktreeReclaimability): string;
/** 读一个文件是否是 worktree 指针（诊断用；不判断存在性）。 */
export declare function isWorktreePointer(file: string): boolean;
