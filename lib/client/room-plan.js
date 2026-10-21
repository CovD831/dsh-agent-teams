/**
 * ── ★★★ 工作区 = 一个房间：**把状态投影成"房间里有什么"**（需求 §27，纯函数）────────────
 *
 * ── 这个文件的位置为什么是"纯函数在前、组件在后"──────────────────────────────────
 *
 * MEASURED（本仓既有纪律，`folders-panel.tsx` 的文件头逐字）：
 * **本机没有视觉模型** ⇒ "画对了没有"不能靠看，只能靠**可读的数据形状**。
 * ⇒ 所以房间的一切几何与站位都在这里算完，渲染层只负责把数字画成像素。
 *
 * ★★ 这与参照物（`ypyik0669/claude-web` 的 `web/src/features/cafe/`）的分工**同构**：
 * ```
 * sim.ts + map.ts   —— 状态机与地板图（纯函数，sim.test.ts / map.test.ts 单测）
 * render.ts         —— 只管画（一点一像素的小 canvas，再放大）
 * ```
 * 借的是这条分工，不是它的美术。
 *
 * ── ★★★ 已裁定（需求 §27.3，用户原话）──────────────────────────────────────────
 *
 * ```
 * 工作区 = 项目 = 一个房间
 * 团队   = 房间里的 1~N 个团队（"一般只有一个团队……也不排除有两个或几个"）
 * 成员   = 房间里的小人（一人一个工位）
 * ```
 * ★ 所以本文件的主输入是 `readonly ActivityTeam[]`（**同一个工作区的全部团队**），
 *   而不是"一个团队" —— 房间的尺寸与分区由团队数决定。
 *
 * ── ★★ 所有读数都来自**既有字段**，不新增数据通道（§27.4 的纪律）───────────────
 *
 * ```
 * 谁在干活        ← member.liveness.state === 'working'
 * 活儿是哪一条    ← member.currentTask（`snapshot.ts` 已有的投影）
 * 做到哪一步      ← member.done / member.total
 * 闲着 / 读不到   ← liveness 的五态（★ 不用活布尔：'could-not-measure' 不是 'idle'）
 * 卡住了          ← runtime.liveness 的 blocked（★ 已有判据，本文件**不另算一套**）
 * ```
 * ★ 而"画得好不好看"**不进任何判据** —— 那一格归人。
 *
 * @module dsh-agent-teams/client/room-plan
 */
/**
 * 一行放几个工位。
 *
 * ★★ MEASURED（2026-10-22，第二版截图）：先写了 4，画出来是**一条窄带** ——
 *   因为一行 4 格 × 16px = 64px 宽，而一个 24×24 的小人比一格还宽 1.5 倍。
 *   参照物用 **6**（`map.ts` 逐字 `SEATS_PER_ROW = 6`），且整间房 **34 列**。
 * ⇒ 改成 6：一行 6 格 = 96px，装得下 6 个并排的小人，且团队之间仍有过道可分。
 */
export const SEATS_PER_ROW = 6;
/**
 * 房间至少几排深。
 *
 * ★★ MEASURED（第三版截图）：写 3 时房间是"一条薄地板 + 一片墙"，不像房间。
 *   参照物 `MIN_DEPTH = 18`（它要放服务区与走道）—— 我们不要那么多，
 *   但**房间必须有纵深**，否则墙会压过地板、眼睛读到的是"一堵墙"。
 * ★ 8 是折中：两个团队（约 5 排）+ 走道之后仍有空余，看起来像一间屋子而不是一条走廊。
 */
export const MIN_ROWS = 8;
/** 读一个人的"在做什么"。★ 五态映射，**不许**把 could-not-measure 折进 idle。 */
export function doingOf(member) {
    /**
     * ★ 用**既有的** `liveness`（服务端 `MemberLiveness['state']` 的原值，五态），不重算。
     *
     * ★★ 而它在**线上**是 `string`（`ActivityMember.liveness?: string`）——
     *   因为客户端不 import 服务端类型。⇒ 这里必须**显式列出认识的五个值**，
     *   而不是 `switch` 一个宽字符串（那样拼错一个值会静默落进 `default`）。
     *   ★ 认不出 ⇒ `'unknown'`：**"读不到"不是"闲着"**（本仓记账最久的合流）。
     */
    const state = member.liveness;
    if (state === 'working')
        return 'working';
    if (state === 'idle')
        return 'idle';
    if (state === 'never-spawned')
        return 'not-spawned';
    if (state === 'not-live')
        return 'away';
    /** `could-not-measure` / 缺席 / 认不出的值 —— 三者都落 `unknown`（**都**是"读不到"）。 */
    return 'unknown';
}
/**
 * ── ★★★ 把一个工作区的**全部团队**投影成一间房间 ─────────────────────────────────
 *
 * @param teams - 同一个 workspace 下的团队（★ 传**这个工作区**的，不是全部工作区）
 * @returns 房间几何 + 每个小人的站位
 *
 * ★ 布局规则（可单测，不依赖渲染）：
 * ```
 * 每个团队占一段行（1 个团队 = 1 段）
 * 每行放 SEATS_PER_ROW 个人；团队人多就往下多吃几行
 * 团队之间留 1 行过道（否则"两个团队"看起来像"一个大队"）
 * ```
 * ★★ 为什么"团队 = 一段行"而不是"随便排"：用户裁定"房间里面一般只有一个团队"，
 *   而"也可能有两三个" ⇒ **分界必须看得出来**。★ 而分界只靠颜色是不够的
 *   （色弱看不出、截图也说不清），所以它落在**几何**上。
 */
export function roomPlanOf(teams) {
    const actors = [];
    const teamBands = [];
    let cursor = 1;
    for (const [groupIndex, team] of teams.entries()) {
        const members = team.members ?? [];
        const rowCount = Math.max(1, Math.ceil(members.length / SEATS_PER_ROW));
        const fromRow = cursor;
        for (const [index, member] of members.entries()) {
            const offsetRow = Math.floor(index / SEATS_PER_ROW);
            const offsetCol = index % SEATS_PER_ROW;
            actors.push({
                /** ★ 键里带 teamId：两个团队里同名的成员（`worker`）必须是两个不同的人。 */
                key: `${team.teamId}/${member.name}`,
                memberName: member.name,
                role: member.role ?? '',
                doing: doingOf(member),
                currentTask: member.currentTask ?? '',
                done: member.done ?? 0,
                total: member.total ?? 0,
                /** ★ 从第 **2** 列开始：第 1 列是贴墙的走道（否则第一排人贴着墙，像被塞进去的）。 */
                seat: { col: offsetCol + 2, row: fromRow + offsetRow },
                groupIndex,
                teamId: team.teamId,
            });
        }
        teamBands.push({ teamId: team.teamId, name: team.name, fromRow, toRow: fromRow + rowCount - 1 });
        /** ★ +1 是团队之间的**过道**；空团队也占一行（"这个团队一个人都没有"也是事实）。 */
        cursor = fromRow + rowCount + 1;
    }
    return {
        /**
         * 列数。
         *
         * ★★ 第一版直接用了 `SEATS_PER_ROW` ⇒ 房间是 4 格宽的**一条**，看起来像表格列。
         *   参照物 `COLS = 34`（它要放服务区、走道、VIP 房）—— 我们不要那么多家具，
         *   但**房间必须有"空的地方"**，否则它只是把工位框起来了。
         * ⇒ `SEATS_PER_ROW + 2`：左右各留一格**空地**（墙与第一排工位之间要能走人）。
         */
        cols: SEATS_PER_ROW + 2,
        /**
         * 排数。
         *
         * ★★ MEASURED（本行修之前）：`Math.max(MIN_ROWS, cursor - 1)` 把 8 排以下的
         *   结果**全压平** ⇒ 1 人、6 人、12 人、18 人、24 人**都是 8 排**。
         *   于是"房间随人数长"这句话在低人数区间**是假的**，而它测不出来
         *   （因为本仓真实语料是 35 人 / 8 队，正好落在压平区之外）。
         * ⇒ 改成**相加**：最小纵深是**底色**，团队区在它之上继续长。
         *   即 `MIN_ROWS + 团队实际吃掉的排数` —— 这样两个量各自可读，
         *   而"人多房间就高"在任何人数上都成立。
         */
        rows: MIN_ROWS + Math.max(0, cursor - 1),
        actors,
        teams: teamBands,
        /** ★ 没有任何团队 = 真·空房间。与 `roomPlanOf(undefined)` 不同形（那个根本不该被调用）。 */
        empty: teams.length === 0,
    };
}
/** 每个 `doing` 的可读标签（★ 渲染层与夹具都用这一份，不许各写一遍）。 */
export const DOING_LABEL = {
    working: '在干活',
    idle: '闲着',
    'not-spawned': '还没上岗',
    away: '不在房间',
    unknown: '读不到',
};
/**
 * ── ★★★ 一个工作区 = 一间房间：**挑队**的那两个函数 ───────────────────────────────
 *
 * ★ 它们住在这里而不是 `room-panel.tsx`，理由是**可测性**：
 *   `room-panel.tsx` import 了 `./room-panel.module.css`，而那个模块在 Node 里**不可 import**
 *   ⇒ 只要筛队函数住在那边，任何不跑浏览器的夹具都读不到它。
 *   MEASURED（本条的第一版红在这里）：臂 8 直接 `import lib/client/room-panel.js` ⇒
 *   `ERR_MODULE_NOT_FOUND: room-panel.module.css`。
 * ★★ 而"把纯逻辑挪进纯文件"是修**夹具**还是修**产品**？——修产品：
 *   §27.4 的纪律是"状态机与渲染分开"，而筛队逻辑属于状态机那一侧。
 *   夹具只是**迫使**那条纪律被真的遵守。
 */
/** 从快照里挑出某个工作区的全部**活**团队。 */
export function teamsOfWorkspace(teams, workspace) {
    if (teams === undefined)
        return [];
    return teams.filter((team) => team.workspace === workspace);
}
/** 快照里有哪些工作区（去重、保序）。★ 与 `foldersFromSnapshots` 同一条稳定序纪律。 */
export function workspacesOf(teams) {
    if (teams === undefined)
        return [];
    const seen = [];
    for (const team of teams)
        if (!seen.includes(team.workspace))
            seen.push(team.workspace);
    return seen;
}
