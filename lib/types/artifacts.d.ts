/**
 * ── ★★★ t97（吸收上游 #161 的 S1）：**工作区字节身份** ──────────────────────────────
 *
 * 本文件是插件里**唯一**从磁盘读产物字节的模块。
 *
 * ── 为什么需要它（上游 #161 逐字）──────────────────────────────────────────────
 *
 * > 「A **passing review was not bound to the revision it judged**……
 * >   it advertised "all gates passed" over **bytes that had since been edited
 * >   or deleted**.」
 *
 * MEASURED（t97 开工实测）：本仓此前有 `baseRevision`，而它是**git 对象名**
 *   （`tools.ts` 注释逐字：「base 是一个 git 对象名」）——
 *   ★ 它**回答不了"漂了没有"**：`cherry-pick` / `rebase` 会改那个名字而**字节没变**
 *     （T7 的教训），于是它在两个方向上都可能误判。
 * ⇒ 所以这里算的是**内容**摘要（`sha256` of the file bytes）。
 *
 * ── ★★ 安全规则（**一条都不许丢**）────────────────────────────────────────────
 *
 *   ① **目录遍历不跟符号链接**，而每一个**显式点名**的路径都用 `realpath` 解析，
 *      一旦**逃出工作区**就拒绝 —— 符号链接不得变成"读宿主机任意文件"，
 *      符号链接**环**也不得变成无限遍历；
 *   ② 一次**没能完整枚举**的读取（上限、读不了的目录/文件、非法路径）
 *      产出一条**显式的** {@link ArtifactScopeGap}，
 *      ★★ **而不是一份"看起来完整"的短清单**；
 *   ③ 「读不出来」与「不存在」**分开记**；
 *   ④ 插件状态与密钥**不得**因为一个宽范围而意外进入。
 *
 * ── ★★ 而判据层仍然是纯的 ────────────────────────────────────────────────────
 *
 * 本模块把 {@link ArtifactDigest} **值**交给判据层，而判据层**从不碰文件系统**
 * （`mutation-guard.ts` 是同一条先例：「读文件、跑 git、算指纹全部由调用方注入」）。
 *
 * ── ★ 本任务（S1）的边界 ────────────────────────────────────────────────────
 *
 * 只做：算摘要 + 记下来 + 能回答那三个问题。
 * ★ **不做**：`verdictDrift` / blocker-warning 分级 / blob 级 diff（那是 S3/S4）。
 */
import type { ArtifactDigest, ArtifactScopeGap } from './types.ts';
/**
 * 从**一个范围**展开出来的文件数上限。
 *
 * ★ 与上游同一个理由：判决是关于**一个修订**的，而对一棵大树做**无界**遍历
 *   会让每次关门都很慢 ⇒ 到这里停 —— **并且说出来**（产出一条 gap），
 *   因为**一份被静默截断的清单**会让清单之外的改动通过"未变"检查。
 */
export declare const MAX_EXPANDED_ARTIFACTS = 200;
/** 一次范围读取的结果：读到了什么，以及什么没能读完。 */
export interface ArtifactScopeRead {
    readonly artifacts: ArtifactDigest[];
    readonly gaps: ArtifactScopeGap[];
}
/**
 * ── ★★★ 把工作区里的**具体路径**算成摘要（上游 `digestWorkspacePaths`）──────────────
 *
 * @param workspace - 工作区根（**由调用方给**，不猜）。
 * @param paths - workspace 相对路径（POSIX）。
 *
 * ★★ 「读不出来」与「不存在」**分开记**：
 *   · 不存在（`ENOENT`）⇒ **不报 gap**，也不产出 digest。
 *     ★ 理由：一个**还没生成**的产物是正常状态（"这次还没跑"），
 *       把它报成"审计不完整"会让**每一次**审计都带缺口 ⇒ 缺口失去信息量。
 *     ★★ 而它**也不会**被静默当成"已绑定"：判决记的是**它当时读到的那些**
 *       ⇒ 后来出现了，那个文件**不在** `reviewedArtifacts` 里 ⇒ 由 S3 的
 *       范围展开去发现（那正是 `expandedScope` 那一格存在的理由）。
 *   · 别的读失败（权限、是目录、逃出工作区）⇒ **记 gap**（那是真的读不了）。
 */
export declare function digestWorkspacePaths(workspace: string, paths: readonly string[]): Promise<ArtifactScopeRead>;
/**
 * ── ★★ 把范围**模式**展开成它们**当前**覆盖的具体文件（上游 `expandScopePaths`）──────
 *
 * ★ 支持两种形态（与 `pathMatchesScope` 同族）：
 *   · 一个具体文件（`src/a.ts`）⇒ 它自己；
 *   · 一个**目录**（以 `/` 结尾，或它确实是个目录）⇒ **递归**它的文件。
 * ★★ 而递归**不跟符号链接**（`withFileTypes` + `isSymbolicLink()` 直接跳过）——
 *   否则符号链接环会变成无限遍历，而那是一条**安全**规则，不是性能优化。
 * ★ 超过 {@link MAX_EXPANDED_ARTIFACTS} ⇒ **停止并记一条 gap**（不静默截断）。
 */
export declare function expandScopePaths(workspace: string, patterns: readonly string[]): Promise<ArtifactScopeRead>;
/**
 * ── ★★★ S1 的**落点**：把一次判决**绑定**到当前范围 ────────────────────────────────
 *
 * 上游逐字：
 * > 「Reviews/requirements/verification now **snapshot their scope at claim**,
 * >   record the reviewed attempt, **the real digests** and the scope they bound at close」
 *
 * @returns `{ reviewedArtifacts, gaps }` —— ★ 而 `reviewedArtifacts` 的**在场/缺席**
 *   是那三个问题里第一个的答案（缺席 ⇒ 早于内容绑定）。
 */
export declare function snapshotReviewedArtifacts(workspace: string, patterns: readonly string[]): Promise<{
    readonly reviewedArtifacts: readonly ArtifactDigest[];
    readonly gaps: readonly ArtifactScopeGap[];
}>;
