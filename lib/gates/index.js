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
import { createGateRegistry } from "./registry.js";
import * as verifyRerun from "./completion/verify-rerun.js";
import * as changedPaths from "./dispatch/changed-paths.js";
/**
 * 全部判据。**一条判据一个 import** —— 这样"换掉一条"就是换一个 import，
 * 而不是在一个大文件里找。
 */
const ALL_GATES = [
    verifyRerun,
    changedPaths,
];
/** 建一个装好全部判据的注册表。 */
export function buildRegistry() {
    const registry = createGateRegistry();
    for (const module of ALL_GATES) {
        registry.register({
            id: module.id,
            point: module.point,
            description: module.description,
            gate: module.gate,
            ...(typeof module.appliesTo === 'function' ? { appliesTo: module.appliesTo } : {}),
        });
    }
    return registry;
}
/** 进程级单例：编排层用它。 */
export const registry = buildRegistry();
export { createGateRegistry } from "./registry.js";
export { ok, blocked, unmeasured, INSERTION_POINTS } from "./registry.js";
