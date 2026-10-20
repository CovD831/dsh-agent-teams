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
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { VERDICT_KINDS } from "./types.js";
/**
 * 从**一个范围**展开出来的文件数上限。
 *
 * ★ 与上游同一个理由：判决是关于**一个修订**的，而对一棵大树做**无界**遍历
 *   会让每次关门都很慢 ⇒ 到这里停 —— **并且说出来**（产出一条 gap），
 *   因为**一份被静默截断的清单**会让清单之外的改动通过"未变"检查。
 */
export const MAX_EXPANDED_ARTIFACTS = 200;
/** `absolute`（已解析）在工作区根里吗？ */
function isInsideRoot(root, absolute) {
    const rel = relative(root, absolute);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
/**
 * ★ `true` ⇒ 在里面；`false` ⇒ 逃出工作区；`undefined` ⇒ 解析不出来。
 * ★★ 三态而异形：`realpath` 抛错（不存在/坏链接）与"确实在外面"是**两件事** ——
 *   前者可能是**还没生成**（那是正常的），后者是**越界**（那必须拒）。
 */
async function resolveInsideRoot(root, candidate) {
    try {
        const real = await realpath(candidate);
        return isInsideRoot(root, real);
    }
    catch {
        return undefined;
    }
}
/** `sha256` 的 hex。★ 内容摘要 —— 与 git 修订标识无关。 */
function digestOf(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
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
export async function digestWorkspacePaths(workspace, paths) {
    let root;
    try {
        root = await realpath(workspace);
    }
    catch {
        /** ★ 连工作区都解析不出来 ⇒ 整次读取都不成立 ⇒ 一条总缺口。 */
        return { artifacts: [], gaps: [{ ref: workspace, why: 'the workspace root itself could not be resolved' }] };
    }
    const artifacts = [];
    const gaps = [];
    for (const path of paths) {
        const absolute = join(root, path);
        /** ★ ① 逃出工作区 ⇒ 拒（符号链接不得变成读宿主机任意文件）。 */
        const inside = await resolveInsideRoot(root, absolute);
        if (inside === false) {
            gaps.push({ ref: path, why: 'resolves outside the workspace (a symlink must not become a read of host files)' });
            continue;
        }
        if (inside === undefined) {
            /** ★ 解析不出来 ⇒ 看它到底是不存在，还是别的原因（**分开记**）。 */
            try {
                await stat(absolute);
            }
            catch (reason) {
                const code = reason?.code;
                if (code === 'ENOENT')
                    continue; // ★ 还没生成 —— 正常，不报 gap
                gaps.push({ ref: path, why: `could not be read: ${String(reason?.message ?? reason)}` });
                continue;
            }
            gaps.push({ ref: path, why: 'could not be resolved inside the workspace' });
            continue;
        }
        try {
            const bytes = await readFile(absolute);
            artifacts.push({ path, digest: digestOf(bytes) });
        }
        catch (reason) {
            const code = reason?.code;
            /** ★ `EISDIR` 等：点名了一个目录 ⇒ 那是**调用方**的问题，如实说。 */
            if (code === 'ENOENT')
                continue;
            gaps.push({ ref: path, why: `could not be read: ${String(reason?.message ?? reason)}` });
        }
    }
    return { artifacts, gaps };
}
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
export async function expandScopePaths(workspace, patterns) {
    let root;
    try {
        root = await realpath(workspace);
    }
    catch {
        return { artifacts: [], gaps: [{ ref: workspace, why: 'the workspace root itself could not be resolved' }] };
    }
    const paths = [];
    const gaps = [];
    const walk = async (absolute, display) => {
        let entries;
        try {
            entries = await readdir(absolute, { withFileTypes: true });
        }
        catch (reason) {
            const code = reason?.code;
            if (code === 'ENOENT')
                return true; // ★ 还没生成 ⇒ 不报 gap
            gaps.push({ ref: display, why: `could not be enumerated: ${String(reason?.message ?? reason)}` });
            return true;
        }
        for (const entry of entries) {
            if (paths.length >= MAX_EXPANDED_ARTIFACTS) {
                gaps.push({
                    ref: display,
                    why: `expansion stopped at the ${MAX_EXPANDED_ARTIFACTS}-file cap; the list below is NOT complete,`
                        + ' so a change outside it must not read as "unchanged"',
                });
                return false;
            }
            /** ★★ ① 不跟符号链接（安全规则，不是优化）。 */
            if (entry.isSymbolicLink())
                continue;
            const child = join(absolute, entry.name);
            const childDisplay = `${display.replace(/\/$/, '')}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!await walk(child, childDisplay))
                    return false;
            }
            else if (entry.isFile()) {
                paths.push(childDisplay);
            }
        }
        return true;
    };
    for (const pattern of patterns) {
        if (paths.length >= MAX_EXPANDED_ARTIFACTS)
            break;
        const trimmed = pattern.replace(/\/$/, '');
        if (trimmed === '' || trimmed.startsWith('/') || trimmed.startsWith('..')) {
            gaps.push({ ref: pattern, why: 'not a workspace-relative path' });
            continue;
        }
        const absolute = join(root, trimmed);
        const inside = await resolveInsideRoot(root, absolute);
        if (inside === false) {
            gaps.push({ ref: pattern, why: 'resolves outside the workspace' });
            continue;
        }
        if (inside === undefined) {
            /** ★ 不存在 ⇒ 正常（还没生成），不报 gap。 */
            continue;
        }
        let info;
        try {
            info = await stat(absolute);
        }
        catch {
            continue;
        }
        if (info.isDirectory()) {
            if (!await walk(absolute, trimmed))
                break;
        }
        else if (info.isFile()) {
            paths.push(trimmed);
        }
    }
    const read = await digestWorkspacePaths(workspace, [...new Set(paths)]);
    return { artifacts: read.artifacts, gaps: [...gaps, ...read.gaps] };
}
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
export async function snapshotReviewedArtifacts(workspace, patterns) {
    const read = await expandScopePaths(workspace, patterns);
    return { reviewedArtifacts: read.artifacts, gaps: read.gaps };
}
/**
 * ── ★★★ t99（S1 接线）：为**交付那一刻**构造一份审计 ──────────────────────────────
 *
 * ── 它补的是哪一根断线（t97 自己报的原文）────────────────────────────────────────
 *
 * > 「★★ `DeliveryResult.verdictBindings`【只在传了 `audit` 时出现】，
 * >   而【当前没有任何生产调用方传它】…… ⇒ ★ **S1 交了"能回答"的能力，
 * >   但那条线还没接上**，而同 t87 记过的形态一样：**机制建好了 ≠ 接线了**。」
 *
 * ★ 实测（t99 开工）：**三处**调用点（`status.ts` · `delivery.ts` · `quality-gates.ts:2600`）
 *   全都写的是 `canDeclareDelivery(team)` —— ★ **一个都不传 `audit`**。
 *
 * ── ★★ 审计读的是**哪批字节**：判决自己绑过的那批（不是全仓）──────────────────────
 *
 * ★ 判据是"**它对哪些字节负责**"，而那正是每条判决任务落盘时记下的
 *   `reviewedArtifacts[].path`（`update-task.ts` 在判决落盘那一刻用
 *   `snapshotReviewedArtifacts` 拍的）。
 * ⇒ 所以这里的输入是**那些路径的并集**，而**不是** `inScope` 或 `changedPaths`：
 *   ★ 读多了会把**没人审过的字节**算进审计（于是 drifted/unbound 都失真）；
 *   ★ 读少了会让**绑过的字节**读不到 ⇒ 落到 `drifted`（假警报）。
 *
 * ── ★ 为什么"没有判决绑定过任何路径" ⇒ 返回 `undefined` 而不是空审计 ──────────────
 *
 * ★ 空审计（`{artifacts: [], gaps: []}`）会被 `canDeclareDelivery` 当成**做过审计**，
 *   于是它会给每条判决算出 `unbound` —— 而真相是**这次没有可审的对象**。
 * ⇒ ★ 两者不同形：`undefined` = "**这次没做审计**"（`verdictBindings` 整格缺席），
 *   空审计 = "审计了、但一条都没读到"。
 * ★ 依据：`quality-gates.ts:2298` 的逐字注释 ——
 *   「缺席 ⇒ `verdictBindings` **缺席**（"这次没审计"与"审计了、全有效"必须不同形）」。
 *
 * @param workspace - 工作区根（审计的边界；逃出它的路径由 `digestWorkspacePaths` 拒并记 gap）。
 * @param team - 要审计的队（读它那些判决任务绑过的路径）。
 * @returns 一份 `DeliveryAudit`；**没有任何判决绑过路径** ⇒ `undefined`。
 */
export async function deliveryAuditFor(workspace, team) {
    /**
     * ★ 只收**判决类任务**（`VERDICT_KINDS`）的绑定 —— 与 `canDeclareDelivery` 里
     *   算 `verdictBindings` 的那个 filter **同源**（`status === 'completed'` + 同类）。
     *   ★★ 两处若不同源，会出现"审计读了 A 的路径、而读数在问 B 的路径"
     *     ⇒ 每条都会报 `drifted`（而那是假的）。
     */
    const boundPaths = new Set();
    for (const item of team.tasks) {
        if (item.status !== 'completed')
            continue;
        if (!VERDICT_KINDS.includes(taskKindOf(item)))
            continue;
        for (const artifact of item.reviewedArtifacts ?? [])
            boundPaths.add(artifact.path);
    }
    /** ★ 没有任何判决绑过路径 ⇒ **这次没有可审的对象** ⇒ 整格缺席（见上面那段）。 */
    if (boundPaths.size === 0)
        return undefined;
    /**
     * ★ 读的是**当前**字节（"交付那一刻工作区长什么样"）—— 与判决落盘时拍的那份比。
     *   ★ 这就是 S1 的全部内容：`artifactBindingOf(绑过的摘要, 现在的摘要)` 三态。
     */
    const read = await digestWorkspacePaths(workspace, [...boundPaths]);
    return { artifacts: read.artifacts, gaps: read.gaps };
}
/** ★ 任务类别（与 `quality-gates.ts` 的 `taskKindOf` 同口径；本文件只需它一格）。 */
function taskKindOf(task) {
    return task.kind ?? 'work';
}
/**
 * ── ★★★ 工作区里【已存在的】测试文件（2026-10-20，补 t5）────────────────────────
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────────
 *
 * `testFileBaselineOf` 要的是"开工那一刻这些测试文件是什么字节"。
 * 而"这些"必须**先被枚举出来** —— 于是这一格回答：**哪些是测试文件**。
 *
 * ── ★ 两条口径，刻意写死在这里（而不是散在三处调用点）─────────────────────────
 *
 *   ① **只收已存在的文件**（`readdirSync` + `statSync`，不递归 symlink）
 *      ⇒ 快照里**不会**出现"还没写的测试" ⇒ 于是**新写的测试不算 weakened**
 *        （那是**加**，不是减 —— 见 `testFileBaselineOf` 的反面一节）
 *   ② **按路径排序** ⇒ 同一棵树两次调用得到**逐字节相同**的清单
 *      （不排序会让"清单顺序变了"看起来像"测试变了"）
 *
 * ── ★★ 边界：它扫的是【工作区的测试目录】，不是整个仓库 ──────────────────────────
 *
 *   实测本仓的测试全在 `scripts/**\/*.test.mjs`，没有别的形态。
 *   ⇒ 扫 `scripts/` 一层浅递归，遇到目录就进、遇到 `*.test.mjs` 就收。
 *   ★ 扫描上限与 `MAX_EXPANDED_ARTIFACTS` 同一纪律：**到界要报**，不静默截断。
 */
export async function enumerateTestFiles(workspace, limit = 2000) {
    const out = [];
    let truncated = false;
    const walk = async (dir, relPrefix) => {
        if (truncated)
            return;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= limit) {
                truncated = true;
                return;
            }
            const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
            /**
             * ★ 不跟符号链接 —— 与 `digestWorkspacePaths` 同一条安全纪律
             *   （链接不得变成"读宿主机任意文件"）。
             */
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory()) {
                /** ★ 跳过明显的重型目录（与全仓的 ignore 口径同源）。 */
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lib')
                    continue;
                await walk(join(dir, entry.name), rel);
                continue;
            }
            if (!entry.isFile())
                continue;
            if (/\.test\.(mjs|js|cjs|ts|tsx)$/.test(entry.name))
                out.push(rel);
        }
    };
    for (const root of ['scripts', 'src', 'test', 'tests']) {
        const abs = join(workspace, root);
        try {
            if (!(await stat(abs)).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        await walk(abs, root);
    }
    return { files: [...new Set(out)].sort(), truncated };
}
/**
 * 拍一份**测试文件基线**（开工那一刻的字节）。
 *
 * ★ 复用 `digestWorkspacePaths`（同一个 sha256、同一条"逃出工作区就拒"的纪律），
 *   不新造第二条读字节的路径。
 * ★★ 三态**原样往上传**：读不到 ⇒ `undefined`（**不是**空数组）。
 *   调用方据此写不写 `testFileBaseline` —— 而写入侧缺席 = "没能拍"。
 */
export async function snapshotTestFiles(workspace) {
    const listed = await enumerateTestFiles(workspace);
    /**
     * ★ 一个测试文件都没有 ⇒ **空数组**（一条读数：这条任务开工时工作区里没有测试文件）。
     *   ★★ 它与 `undefined`（没能读）**不同形** —— 见 `testFileBaselineOf` 的三态。
     */
    if (listed.files.length === 0)
        return { baseline: [], truncated: listed.truncated, gaps: [] };
    const read = await digestWorkspacePaths(workspace, listed.files);
    /**
     * ★ 读失败 ⇒ **不只是**把缺的丢掉：那条路径**读不到**，而快照里没有它就等于
     *   "它当时不存在" ⇒ 于是一个**后来被删的**文件不会被判 weakened。
     *   ⇒ 只要有一次读取缺口，就**整份不拍**（`undefined`），如实报 unmeasured。
     *   ★ 保守方向：判不了**不拒绝**，但也不假装拍到了。
     */
    if (read.gaps.length > 0)
        return { baseline: undefined, truncated: listed.truncated, gaps: read.gaps };
    return { baseline: read.artifacts, truncated: listed.truncated, gaps: [] };
}
