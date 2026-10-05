/**
 * ── 判据的装配点：注册表 + 本仓库全部判据 ──────────────────────────────────────
 *
 * 这个文件是【唯一】知道"我们有哪些判据"的地方。编排层只调
 * `evaluateGate(point, context)`，不知道任何判据的名字或语义（契约 §8）。
 *
 * ★ 换一条判据 = 换这一份注册清单里的一行。
 * ★ 加一个位置 = 在 registry 的 INSERTION_POINTS 里加（那是流程形状的变化，
 *   属于上游，不属于这里）。
 */
/** 建一个装好全部判据的注册表。 */
export declare function buildRegistry(): {
    register(registration: import("./registry.ts").GateRegistration): import("./registry.ts").GateRegistration;
    unregister(id: string): boolean;
    list(): Record<import("./registry.ts").InsertionPoint, Array<{
        id: string;
        description: string;
        hasAppliesTo: boolean;
    }>>;
    count(point: import("./registry.ts").InsertionPoint): number;
    evaluate(point: import("./registry.ts").InsertionPoint, context: unknown): Promise<import("./registry.ts").GateEvaluation>;
};
/** 进程级单例：编排层用它。 */
export declare const registry: {
    register(registration: import("./registry.ts").GateRegistration): import("./registry.ts").GateRegistration;
    unregister(id: string): boolean;
    list(): Record<import("./registry.ts").InsertionPoint, Array<{
        id: string;
        description: string;
        hasAppliesTo: boolean;
    }>>;
    count(point: import("./registry.ts").InsertionPoint): number;
    evaluate(point: import("./registry.ts").InsertionPoint, context: unknown): Promise<import("./registry.ts").GateEvaluation>;
};
export { createGateRegistry } from './registry.ts';
export { ok, blocked, unmeasured, INSERTION_POINTS } from './registry.ts';
