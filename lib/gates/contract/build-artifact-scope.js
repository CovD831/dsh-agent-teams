/**
 * ── 判据：inScope 含 `src/**` 却漏掉对应构建产物 ⇒ 建任务时就提示 ────────────────
 *
 * 插入点：`contract`（建任务 / 改契约 —— 契约 §1 ①）
 *
 * ── 它防的是什么失效（MEASURED ×3，代价是三个成员的往返）──────────────────────
 *
 * 本仓库强制 `lib/` 与 `src/` 同步：`scripts/git-artifacts.mjs` 会检查构建产物是否
 * 与源码一致，不一致就判 stale；而硬约束又要求"改 src 后必须 pnpm build"（已装插件
 * 是 `link:` 指向源码，不 build 就跑旧代码）。两件事叠起来的必然后果是：
 *
 *     一个 inScope 含 `src/gates/registry.ts` 却漏掉 `lib/gates/registry.js` 的
 *     质量任务，成员按纪律 build 之后，**必然**产出 lib/ 下的改动；
 *     而质量门禁看到的就是 `lib/gates/registry.js is undeclared` ⇒ 该任务永远
 *     无法诚实地完成 —— 契约在【建】的那一刻就已经写错了。
 *
 * 本轮实测发生了三次（t8/t11、t6、t9），每一次的代价是一个成员的往返 + 一次契约
 * 修订。而三次的形状完全相同、且**在 create_task 那一刻就完全可见**。
 *
 * ★ 为什么这条判据在 `contract` 位置而不是 completion 位置：后者只能在成员已经
 *   白跑一趟之后说"这个路径没声明"；前者在派发之前就把话说清楚。**同一个事实，
 *   在建任务时说是一次提醒，在完成时说是一次损失。**
 *
 * ★ 它为什么不是"放宽"（这是本任务唯一的硬约束）：
 *   本判据**只读 inScope 列表**，从不改判任何 changedPath 的分类。
 *   `classifyChangedPath` / `undeclared path` 的拒绝逻辑一个字都没动 ——
 *   没写进 inScope 的路径，无论本判据说什么，都仍然是 `undeclared`。
 *   一个"因为漏了 lib/ 就放它过"的判据会把本队刚吃过三次的那个洞**焊死成特性**。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O，也不读磁盘去看 `lib/` 里有没有那个文件。
 *    它只做【路径字符串之间的映射】—— 与 `deriveCoverageInput` 那类"由调用方提供
 *    观察"的分工一致。拿不到 inScope ⇒ `unmeasured`（★ 不是 `ok`）。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */
import { ok, blocked, unmeasured } from "../registry.js";
export const id = 'contract.build-artifact-scope';
export const point = 'contract';
export const description = 'inScope 声明了 src/ 下会改动的文件、却没有声明对应的 lib/ 构建产物 ⇒ 提示（本仓库强制 lib/ 与 src/ 同步，成员 build 后必然产生 undeclared 路径）';
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 这一份是本轮「可选输入怎么声明」的**第一个真实压力测试**，而结论是：
 *   **不需要新形状 —— 需要的是一条口径。**
 *
 * ── 口径（与 shape-dev 的 paths 层、delivery-owner 的 (a)/(b)/(c) 三分法同源）
 *
 *     `requires` 只声明【这条判据无条件读的那几格】。
 *     判据【可选地】读的东西不进 requires —— 它的在场与否由判据自己的裁决
 *     （ok / unmeasured）持有，并由一条夹具臂钉住。
 *
 * ── 为什么这里只声明 `'task'`，而【不】声明 `'task.inScope'` ────────────────────
 *
 * 这条判据的语义**恰好**是一句「缺席不是缺失」（t11 的收口，见下面 `gate()` 的
 * 两段注释 —— 它们逐字对着 `kind=work` 的真实契约：`create_task` 给 work 类
 * **本来就不带 `inScope`**）：
 *
 *     inScope 整个缺席    ⇒ 这份契约没有提出同步要求 ⇒ **ok**（不适用）
 *     inScope 在场但不可判 ⇒ 它提了要求而清单读不出   ⇒ **unmeasured**
 *
 * ⇒ 若把 `'task.inScope'` 写进 requires，核对层会在**每一个普通任务**上报
 *   「contract.build-artifact-scope declares 1 ctx path that this context does not
 *   carry: task.inScope」—— 而那正是这条判据明确拒绝报的东西。
 *   ★ 那是**假告警**，而本队的定论是：假告警与不报警同样有害，它教人忽略门禁。
 *
 * ── 那"没接上"还发不发现得了 ────────────────────────────────────────────────────
 *
 * 能，而且分得比"报缺"更准 —— 三件事各归其位（与 requires.ts 文件头那三层同源）：
 *
 *     ① 拼错路径（`'task.inScpoe'`）          ⇒ 编译期 TS2322，永远不可能漏。
 *     ② 调用方【整个没交出契约】（没有 task）  ⇒ 这不是静态判断，是**运行时**事实：
 *        `appliesTo` 为假 ⇒ 注册表在进 `gate()` 之前就把它记成
 *        `requires.checks[].status === 'skipped'`（`skippedBecause` 写明原因），
 *        `requires.skipped` 计数把它抬出来。★ 跳过 ≠ 齐（不同形），所以
 *        「这一轮根本没接上契约」不会被读成「判据通过了」。
 *     ③ 契约在、而 inScope 故意缺席           ⇒ 判据自己判 **ok**（不适用）。
 *
 * ★ `'task'` 这一格是**必填**的：它既是 `appliesTo` 读的那一格，也是判据里唯一
 *   一个**无条件**读的东西（`const inScope = ctx?.task?.inScope`）。它缺席 ⇒
 *   判据根本不说话。于是"声明到判据真的读到的那条边界"在这里是自洽的：
 *   声明 `'task'`、`appliesTo` 看 `ctx.task`、`gate()` 从 `ctx.task.inScope` 起读。
 *
 * ★ 它也不会让"漏接"从此看不见：真会产出 undeclared 路径的是**声明了 inScope 的
 *   质量任务**，而那些任务必然带着 `task` ⇒ 核对层照常核对这一格；一条把契约
 *   整个丢掉的调用点会在 `skipped` 计数上留下痕迹 —— 它本来就不在这条判据的
 *   输入面里，硬报成"缺 task"会把"不适用"说成"没接线"。
 */
export const requires = ['task'];
/**
 * 源码目录 → 它的构建产物目录。
 *
 * ★ 刻意只写死这一条映射，而不是"猜任意目录的产物在哪"：本仓库的构建约定就是
 *   `src/**.ts → lib/**.js`（tsc 输出），其余目录（assets/、docs/、scripts/…）
 *   在被证明有同样的强制同步关系之前【不猜】。一条靠猜的判据会在别的仓库形态里
 *   误伤，而误伤正是本队最贵的失效（它会教人忽略门禁）。
 */
const SOURCE_ROOT = 'src';
const ARTIFACT_ROOT = 'lib';
/** 类型声明也住在 lib/types/ 下（`tsc -p tsconfig.json` 的 declarationDir）。 */
const ARTIFACT_TYPE_ROOT = 'lib/types';
/** 把一个 workspace 相对路径规整成 `a/b/c` 形状；绝对路径/`..` ⇒ undefined（无法判定）。 */
function normalize(path) {
    if (typeof path !== 'string')
        return undefined;
    const trimmed = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (trimmed === '' || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed))
        return undefined;
    const segments = trimmed.split('/');
    if (segments.includes('..'))
        return undefined;
    return segments.filter((segment) => segment !== '').join('/');
}
/**
 * `src/` 下的一个【具名】源码路径（目录前缀不算）对应的候选构建产物。
 *
 * ★ 为什么 `src/gates/` 这种【目录前缀】不产出候选：目录级 inScope 已经因为
 *   "掩盖这个任务实际改哪个文件"被本队收窄过一次。把 `src/gates/` 展开成
 *   `lib/gates/`（或 `lib/gates/**`）会凭空要求一个成员去声明整个目录的产物 ——
 *   那是一条**凭猜**的提示，而误报会把这条判据本身教成噪音。
 *   具名路径（`src/a.ts`）的产物是确定的（`lib/a.js` + `lib/types/a.d.ts`），
 *   这一条映射是实测的、不是猜的。
 *
 * ★ 为什么产物要分 `.js` 与 `lib/types/*.d.ts` 两处：`pnpm build` 同时跑
 *   `tsc -p tsconfig.json`（产出 lib/**.js）与声明输出（lib/types/**.d.ts）。
 *   只提其中一个，会让"补了 lib/x.js、仍缺 lib/types/x.d.ts"的任务再卡一次 ——
 *   提示必须一次说全，否则它只是把同一个往返拆成两次。
 */
function artifactCandidates(sourcePath) {
    const normalized = normalize(sourcePath);
    if (normalized === undefined)
        return [];
    if (!normalized.startsWith(`${SOURCE_ROOT}/`))
        return [];
    const rest = normalized.slice(SOURCE_ROOT.length + 1);
    if (rest === '')
        return [];
    /**
     * 源码扩展名：`.ts` / `.mts` / `.cts` / `.tsx` → `.js`；
     * 其余（含无扩展名）⇒ 不做扩展名替换，只换根目录。
     * ★ 一个已经叫 `.js` 的源文件（本仓库有，如 assets 下的脚本）仍会被列出
     *   `lib/**.js` —— 那是"它的产物在哪"，不是"它一定产出"。
     */
    const mapped = rest.replace(/\.([cm]?ts|tsx)$/, '.js');
    const candidates = [`${ARTIFACT_ROOT}/${mapped}`];
    /**
     * `.d.ts` 只对会被声明输出覆盖的文件形态列出：`.ts` 系源码。
     * 对无扩展名/非 ts 路径不列 —— 那会是一条凭猜的候选。
     */
    if (/\.([cm]?ts)$/.test(rest)) {
        candidates.push(`${ARTIFACT_TYPE_ROOT}/${rest.replace(/\.([cm]?ts)$/, '.d.ts')}`);
    }
    return candidates;
}
/** inScope 里的条目是否指一个【目录】而不是一个文件。 */
function isDirectoryEntry(entry, normalized) {
    const raw = entry.trim();
    /** 尾斜杠是最明确的"这是目录"。 */
    if (raw.endsWith('/'))
        return true;
    /** glob（`src/**`、`src/*.ts`）不是"这个任务会改哪个文件"。 */
    if (normalized.includes('*'))
        return true;
    /**
     * ★ 无扩展名的路径也算目录。这一条是实测逼出来的：本队已经把目录级 inScope
     *   收窄过一次（`src/gates/reg` → 具体文件），而写成 `src/gates`（不带尾斜杠）
     *   与写成 `src/gates/` 是**同一个意图**。只认尾斜杠会让同一个意图的两种写法
     *   得到相反的裁决 —— 而那种不一致会让这条判据读起来像随机噪音。
     *
     * ★ 它对"无扩展名的源文件"是宽松的（本仓库有 `scripts/...` 这类，但不在 src/
     *   下会被 isSource 过滤掉）。**宽松的方向是对的**：这里判错的代价是少提示一次
     *   （而门禁仍会在 completion 时拒掉 undeclared 路径，预防漏一次不等于放宽），
     *   反过来的代价是在合法契约上误报 —— 那才是会把判据教成噪音的方向。
     */
    return !/\.[A-Za-z0-9]+$/.test(normalized);
}
/** inScope 里【具名】的 src/ 源码路径（目录前缀不算：见 artifactCandidates 的说明）。 */
function namedSourcePaths(inScope) {
    const out = [];
    for (const entry of inScope) {
        const normalized = normalize(entry);
        if (normalized === undefined)
            continue;
        if (!normalized.startsWith(`${SOURCE_ROOT}/`))
            continue;
        if (isDirectoryEntry(entry, normalized))
            continue;
        out.push(normalized);
    }
    return out;
}
/** inScope 是否已经声明了某个构建产物根（`lib/` 整体、或它下面某条路径）。 */
function declaresArtifacts(inScope) {
    for (const entry of inScope) {
        const normalized = normalize(entry);
        if (normalized === undefined)
            continue;
        if (normalized === ARTIFACT_ROOT || normalized.startsWith(`${ARTIFACT_ROOT}/`))
            return true;
    }
    return false;
}
/**
 * 凡是有任务在场的契约都进求值。
 *
 * ★ `appliesTo` 在这里刻意【不】按 kind 收窄、也**不**排除"没有 inScope"的情形。
 *
 *   为什么不用 `appliesTo: (ctx) => Array.isArray(ctx.task.inScope)`：
 *   那会让三种"没有可判清单"的情形一起落进 `skipped`，而 `skipped` 与"这条判据
 *   不适用"同形 —— 于是**契约里到底有没有提出同步要求**这件事永远不会有人说。
 *   这与 t9 里"观察模式不是 appliesTo"是同一个道理：**不适用**与**没能测量**必须
 *   不同形，而它们各自的**正确收场也不同**（见 gate 里两条分支的注释）。
 *
 * ★ 收窄在 gate 里按【事实】做，不按 kind 做：判据不去猜哪些 kind "应该"有 inScope
 *   （那是 `quality-gates.ts` 的知识），它只看手上这份契约有没有提出同步要求。
 */
export function appliesTo(ctx) {
    return ctx?.task !== undefined;
}
export function gate(ctx) {
    const inScope = ctx?.task?.inScope;
    /**
     * ── ★ inScope【整个缺席】⇒ ok（不适用），**不是** unmeasured ──────────────────
     *
     * MEASURED（2026-10-05，t11 收口）：`kind=work` 的 `create_task` **本来就不带
     * `inScope`**（实测：`assert.ok(!('inScope' in created))`）。而 `src/quality-gates.ts`
     * 对 work 类直接 `return { ok: true }` —— 它**没有** inScope 要求。
     *
     * ⇒ 本判据若对"缺席"报 `unmeasured`，而 inScope 缺席恰恰是**每个普通任务**的常态，
     *   那么 unmeasured 在本插件里等价于拒绝 ⇒ **所有普通任务都建不出来**。
     *   那不是判据严格，那是把"不适用"写成了"没测到"—— 而这两种结论的**代价方向相反**：
     *
     *     不适用 ⇒ 没有这个要求，放行是**对的**
     *     没测到 ⇒ 有这个要求而我没能检查，放行是**错的**
     *
     * ★ 所以这里的分界不是"字段在不在"，而是**"这份契约有没有提出同步要求"**：
     *   inScope 整个缺席（或压根不是数组）⇒ 这份契约没有进入"要改哪些文件"的讨论
     *   ⇒ 没有可违反的要求 ⇒ `ok`。
     *
     * ★ 它不会被用来偷偷放过一份坏契约：真正会产出 undeclared 路径的是**声明了
     *   inScope 的质量任务**，而那些任务走的是下面那条 blocked 分支。缺席的契约
     *   连 changedPaths 都没有（`quality-gates.ts` 的 `kind=work` 分支不看它们），
     *   所以这里放行不改变任何一条路径的分类结果。
     */
    if (!Array.isArray(inScope))
        return ok();
    /**
     * ── ★ inScope【在场】但不可判 ⇒ unmeasured ───────────────────────────────────
     *
     * 与上面那条的分界是刻意的，也是本判据唯一保留的 unmeasured 场景：
     *
     *     缺席     = 这份契约没有提出同步要求      ⇒ 不适用 ⇒ ok
     *     在场但空 = 它**提出了**要求（说了"这些是要改的文件"），而那个清单读不出内容
     *                ⇒ 我**没能测量**它 ⇒ unmeasured
     *
     * 一个空数组与一个全是无法规整条目的数组，都属于"清单在场、但没有一条能拿来做
     * 判断"：这不是"不适用"，而是"该检查的东西检查不了"。
     */
    const meaningful = inScope.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
    if (meaningful.length === 0) {
        return unmeasured('the task contract declares an inScope list, but no entry in it can be judged (it is empty, or every entry is blank); whether it also declares the build artifacts `pnpm build` will produce could not be determined (an unreadable scope is not evidence that the artifacts are declared)');
    }
    const sources = namedSourcePaths(meaningful);
    /**
     * ★ 没有具名的 src/ 路径 ⇒ `ok`（不是 unmeasured）。
     *   这是一个【测量结论】：看过了这份契约，它没有声明任何会触发构建产物的源码。
     *   把它写成 unmeasured 会让每一个 docs/ tasks 都读起来像"没测到"—— 而那正是
     *   验收里那条"纯文档路径（docs/）⇒ 无提示（不误伤）"要保住的东西。
     */
    if (sources.length === 0)
        return ok();
    if (declaresArtifacts(meaningful))
        return ok();
    const missing = new Set();
    for (const source of sources) {
        for (const candidate of artifactCandidates(source))
            missing.add(candidate);
    }
    /**
     * ★ 提示必须说清「为什么」，而不只是「你漏了一个路径」。
     *
     *   一条只说"缺 lib/**"的提示，读到的人会以为这是本判据的洁癖；而把因果链写出来
     *   （本仓库强制 lib/ 与 src/ 同步 → 成员按纪律 build → 必然产出 lib/ 改动 →
     *   没有声明的路径会被记为 undeclared）之后，它能被独立复核 —— 而"能被复核"
     *   正是它配得上被修的理由。三个真实样本（t8/t11、t6、t9）都长这个样子。
     */
    const blockers = [
        `inScope declares source path(s) ${sources.map((path) => `"${path}"`).join(', ')} but declares no build artifact under "${ARTIFACT_ROOT}/". `
            + `This repository keeps "${ARTIFACT_ROOT}/" in lockstep with "${SOURCE_ROOT}/": scripts/git-artifacts.mjs fails on a stale build, and the build rule requires running \`pnpm build\` after any source change, `
            + `so this task will necessarily produce changes under "${ARTIFACT_ROOT}/" — and an inScope that does not declare them makes those paths unauditable, so the task can never be completed honestly. `
            + `Declare the artifacts too (for example: ${[...missing].slice(0, 4).map((path) => `"${path}"`).join(', ')}${missing.size > 4 ? ', …' : ''}).`,
    ];
    return blocked(blockers);
}
