/**
 * ── ★★★ t91：采集模块的**产出** —— 从信号到「提案」 ────────────────────────────────
 *
 * 规格：`docs/MODULE-IO-CONTRACTS.md` §1.2 / §1.3。
 *
 * ── ★ 本文件解决什么 ─────────────────────────────────────────────────────────
 *
 * MEASURED（t91 开工实测）：`src/evolution/` 此前的输出**只到"采不采"**
 * （`CollectionDecision = boolean | undefined`）——
 * ★ **没有"该怎么改"，也没有"结论"这个产出物本身。**
 *
 * ── ★★ 而本文件**不发明第二套语汇** ───────────────────────────────────────────────
 *
 * t88 补录的那 10 条**已经在用** `routing`（`decision` 三态 + `why` + `target` + `effect`）。
 * ⇒ ★ 本文件做的是把那个**已经在用的形状显式化**，并**补齐规格要的两态**
 *   （`contract` / `unmeasured`）—— 而不是另造一套。
 * ★★ 两条口径会漂移；一套不会。
 */
/**
 * ── ★★ 提案 id 的分配 —— ★ **从调用方给的既有 id 推进**（不在这里读盘）──────────────
 *
 * ★ 为什么不在本模块里扫文件：那会**与信号流的 `nextSignalId` 变成两处口径**
 *   （而 `nextSignalId` 刚刚被实测出**一个真缺陷**：它假设了单一的 JSON 序列化格式，
 *   于是 `"id": "e-0001"`（有空格）与 `"id":"e-0001"`（无空格）**被当成两个不同序列**，
 *   `max` 从 0 起算 ⇒ **覆盖了 e-0001..e-0003**）。
 * ⇒ ★ 本函数**只做纯计算**：给它已知的最大编号，返回下一个。
 *   **I/O 由调用方负责**，于是"怎么读既有编号"只有一处实现、只有一个口径。
 *
 * @param knownMax - 已知的最大编号（没有 ⇒ 0）。
 */
export function nextProposalId(knownMax) {
    const safe = Number.isFinite(knownMax) && knownMax > 0 ? Math.floor(knownMax) : 0;
    return `p-${String(safe + 1).padStart(4, '0')}`;
}
export function createTaskParamsOf(proposal) {
    const c = proposal.contract;
    return {
        subject: c.subject,
        /** ★ 只在**真的给了**时才带那一格 —— 缺席与"给了个空"必须不同形。 */
        ...c.kind === undefined ? {} : { kind: c.kind },
        objective: c.objective,
        acceptance: c.acceptance,
        ...c.verify === undefined ? {} : { verify: c.verify },
        ...c.inScope === undefined ? {} : { inScope: c.inScope },
        ...c.outOfScope === undefined ? {} : { outOfScope: c.outOfScope },
        ...c.nonGoals === undefined ? {} : { nonGoals: c.nonGoals },
    };
}
/**
 * ── ★★ `create_task` 的 schema 里**被我们的适配器覆盖到的**字段（可机读）──────────────
 *
 * ★ 为什么把这张表**写出来**而不是只写在注释里：反向半边 B 要对拍
 *   「适配器产出的键 ⊆ schema 认的键」—— 而**一张可机读的表**才能被断言。
 * ★★ 而它**手工维护**：`create_task` 的 schema 是源码里的字面量（不是可导入的数据），
 *   所以本表**必须**与它一致 —— ★ 一旦分叉，反向半边 B 会在对拍时红。
 */
export const CREATE_TASK_PARAM_KEYS = [
    'subject', 'kind', 'objective', 'acceptance', 'verify', 'inScope', 'outOfScope', 'nonGoals',
];
/**
 * ── ★★★ 反向半边 B 的**对拍器**：适配器的输出里**有没有 schema 不认的键**──────────────
 *
 * ★★ 与 t81 那次实测同一条纪律：**内部字段漏进工具返回值会被
 *   `additionalProperties: false` 打红**（那次是 `gates` 漏进了 `create_task` 的输出 schema）。
 * ⇒ 本函数把那次的事故变成**一次可跑的检查**。
 *
 * @returns 不被 schema 认的键（空数组 ⇒ 对得上）。
 */
export function unknownCreateTaskKeys(params) {
    return Object.keys(params).filter((key) => !CREATE_TASK_PARAM_KEYS.includes(key));
}
/**
 * ── ★★ 反向半边 A 的**构造器**：一条"判不了"的结论 ─────────────────────────────────
 *
 * ★★ 规格 §3.1 逐字：`unmeasured` ⇒ 「判不了（例如**"这需要产品决策"**）——
 *   **不许硬塞**」。
 *
 * ⇒ 本函数存在的理由：让"判不了"有一个**具名的构造入口**，
 *   而不是让每个调用方各自写 `modality: 'soft'` 把产品决策塞进"走软"里。
 * ★★ 而两者的**补救动作相反**：
 *   · `soft`       ⇒ 去改 prompt / profile（**我们决定了**）
 *   · `unmeasured` ⇒ 去**找人**（**我们没测出来**）
 *
 * @param why - ★ **必须说清"卡在哪一步的什么信息上"**，不许写"不知道"。
 */
export function unmeasuredDecision(why) {
    return { needChange: false, modality: 'unmeasured', why };
}
