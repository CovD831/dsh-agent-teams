/**
 * ── 判据注册表 ────────────────────────────────────────────────────────────────
 *
 * 契约见 `docs/GATE-REGISTRY.md`。本文件**只做三件事**：register / evaluate / list。
 * 它**不含任何判据** —— 判据在 `gates/<point>/<id>.mjs`，一个判据一个文件。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────────────
 *
 * 上游把判据全放在一个 1233 行的文件里（34 个导出平铺）。想加一条判据就必须改
 * 那个文件 ⇒ 它一升级就冲突，而开发流程会变 ⇒ 冲突会反复发生。
 *
 * ⇒ 判据挪进注册表；编排层只认【插入点】，不认判据。
 *
 * ── 三个设计决定，都是为了"可插拔" ───────────────────────────────────────────
 *
 * ① 注册表【不认识】任何判据的名字与语义 —— 它只按 point 分组、按序求值。
 *    ⇒ 加/删判据不改编排，也不改本文件。
 *
 * ② 裁决有【三态】而不是两态：ok / blockers / unmeasured。
 *    上游只有两态，而两态正是我们今天验证过的漏洞的同源 —— 一个返回空回复的
 *    审查落进 "ok: true"，读起来像"审查通过、没发现问题"。
 *    ⇒ 判据必须能说"我没能测量"，而它与"我测了没问题"必须不同形（§3.4）。
 *
 * ③ 求值【不短路】：一条判据失败后继续跑其余的，收集全部 blocker。
 *    上游是遇错即返回（`return { ok:false, error }`）⇒ 修一个再跑又冒出一个。
 *    实测代价（2026-10-05）：`grep -qx 7` 与「绝对路径」是两个独立问题，
 *    串行发现花了三轮。 ⇒ 一次给全。
 */
/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true, ...产出 }`              —— 测了，没问题（可附带给出的结果）
 *  - `{ ok: false, blockers: [...] }`     —— 测了，发现问题
 *  - `{ ok: false, unmeasured: string }`  —— ★ 没能测量
 */
export type GateVerdict = {
    ok: true;
    [produced: string]: unknown;
} | {
    ok: false;
    blockers: string[];
} | {
    ok: false;
    unmeasured: string;
};
export type InsertionPoint = typeof INSERTION_POINTS[number];
export interface GateRunEntry {
    id: string;
    verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped';
    count?: number;
    produced?: boolean;
}
export interface GateEvaluation {
    ok: boolean;
    blockers: string[];
    unmeasured?: string;
    ran: GateRunEntry[];
    outputs: Record<string, Record<string, unknown>>;
}
/** 五个【位置】，不是五个判据。一个位置可挂零到多条。 */
export declare const INSERTION_POINTS: readonly string[];
/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true }`                        —— 测了，没问题
 *  - `{ ok: false, blockers: [...] }`      —— 测了，发现问题（必须说清为什么）
 *  - `{ ok: false, unmeasured: string }`   —— ★ 没能测量
 */
export declare function ok(): {
    ok: true;
};
export declare function blocked(...blockers: Array<string | string[]>): {
    ok: false;
    blockers: string[];
};
export declare function unmeasured(reason: string): {
    ok: false;
    unmeasured: string;
};
/**
 * 一个注册表实例。判据按 point 分组，组内按注册顺序求值（顺序稳定，便于复现）。
 */
export interface GateRegistration {
    id: string;
    point: InsertionPoint;
    description: string;
    appliesTo?: (context: any) => boolean;
    gate: (context: any) => GateVerdict | Promise<GateVerdict>;
}
export declare function createGateRegistry(): {
    /**
     * 注册一条判据。
     * ★ 重复 id ⇒ 抛错，**不静默覆盖** —— 静默覆盖会让"我换了一条判据"
     *   与"两条判据都在、后一条赢了"在日志里同形。
     */
    register(registration: GateRegistration): GateRegistration;
    unregister(id: string): boolean;
    /** 控制台读它。按 point 分组，组内保持注册顺序。 */
    list(): Record<InsertionPoint, Array<{
        id: string;
        description: string;
        hasAppliesTo: boolean;
    }>>;
    /** 该位置已注册的判据条数（控制台/测试用）。 */
    count(point: InsertionPoint): number;
    /**
     * 跑某个位置的全部判据并合并裁决。**不短路** —— 收集全部 blocker。
     *
     * ★ 合并规则（语义的一部分，见契约 §3）：
     *     任何一条 unmeasured  ⇒ 整体 unmeasured（未测量优先于通过）
     *     否则任一条 blockers  ⇒ 整体 blockers（全部收集）
     *     否则                 ⇒ ok
     *
     * ★ 为什么 unmeasured 优先：一条判据说"我发现问题"是一个测量结果，可以据此
     *   行动；一条判据说"我没测成"意味着【其余判据的通过也不可信】。后者更重。
     *
     * ★ 为什么非法的裁决形状要抛错而不是忽略：一个形状错误的裁决（比如返回
     *   `{ok:false}` 却不说原因）如果被当成通过，那这条判据就是【装上了但没生效】
     *   —— 那比没装更坏，因为它会让人以为检查过了。
     */
    evaluate(point: InsertionPoint, context: unknown): Promise<GateEvaluation>;
};
