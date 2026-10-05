/**
 * ── 变异测试守卫：变异跑完之后，确认源码里【没有被留下缺陷】──────────────────────
 *
 * ★ 这是【守卫】，不是判据。它不进注册表（`src/gates/index.ts` 的装配契约里没有它的
 *   槽位），也不产出三态裁决意义上的 GateVerdict —— 它由调用方在变异测试之后
 *   【显式调用】，发现残留就直接拒绝。
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 变异测试的工作方式是【就地改坏生产文件，跑测试，再改回来】：
 *
 *     writeFileSync(target, mutated)
 *     try { runTests() } finally { writeFileSync(target, original) }
 *
 * `finally` 只覆盖【正常退出】。它不覆盖：
 *   · SIGKILL（`kill -9`）
 *   · 外部超时杀掉进程（`timeout`、execFileSync 的 timeout）
 *   · 宿主崩溃 / 断电
 *
 * MEASURED（借鉴项目的实测形态）：一个仓库被留在"变异体未还原"的状态里。
 * `npm test` 随后报了一个【看起来完全无关】的断言失败，诊断代价很高 ——
 * 因为源码里现在有一处【真实的缺陷】，而它是变异测试留下的。
 *
 * ★ 为什么"绿测试"证明不了源码没被改坏：
 *   变异测试的语义是"改坏了、测试应该红"。若进程在注入与还原之间死掉，
 *   源码【保持被改坏】。此后任何一次绿色套件都只说明"剩下的测试没覆盖那一行"
 *   —— 它证明不了源码是干净的。**没有覆盖 ≠ 没被改坏**，这两件事必须分开。
 *
 * ── 机制：拿基线比对，而不是"看文件像不像被改过" ──────────────────────────────
 *
 * 光跑 `git status` 是不够的：一个正在开发中的仓库【本来就有】未提交改动，
 * 那些改动与变异残留【在 git status 里长得一模一样】。
 *
 * ⇒ 调用方在变异测试【开始之前】取一份基线（每个目标文件的内容指纹）；
 *   守卫在变异之后重新取一次，逐文件比对。于是状态是【可判定的】：
 *
 *     指纹与基线相同        ⇒ 干净
 *     指纹与基线不同        ⇒ 有残留（且能报出是哪几个文件）
 *     读不到基线 / 读不到 git ⇒ 未测量（**不得**并进干净）
 *
 * ── 三态，且"读不到"绝不并进"干净" ────────────────────────────────────────────
 *
 * ```
 * { clean: true }                        → ok
 * { clean: false, residues: [...] }      → 拒绝（残留是事实，不是报告）
 * { unmeasured: "…" }                    → 拒绝（没能测量）
 * ```
 * 注意后两者都【拒绝】，但形状不同：一个说"我发现你留下了缺陷"，
 * 另一个说"我没能确认你有没有留下缺陷"。把后者读成前者或读成"干净"，
 * 都会让一次基础设施故障伪装成一条关于代码的结论。
 *
 * ── 纯数据变换 ────────────────────────────────────────────────────────────────
 *
 * 本文件不 import 任何 I/O。它只做：基线 × 现状 → 裁决。
 * （读文件、跑 git、算指纹全部由调用方注入，见 `MutationGuardContext`。）
 */
/** 一个文件的内容指纹（调用方算，通常是 sha256 hex）。 */
export type FileDigest = string;
/**
 * 变异测试【开始之前】的基线。
 *
 * ★ `undefined`（没能取到基线）与 `{}`（取到了，且当时是空的）必须不同形：
 *   前者 ⇒ 未测量；后者 ⇒ 可以据此判定"这些文件现在与原样不符"。
 */
export interface MutationBaseline {
    /** 目标文件（workspace 相对）→ 变异前的内容指纹。 */
    readonly digests: Readonly<Record<string, FileDigest>>;
    /** 变异测试【打算】注入变异体的位置：文件 → 1-based 行号。用于把残留归属到具体变异体。 */
    readonly plannedMutants?: readonly PlannedMutant[];
}
/** 一条【预期会被注入】的变异体：位置用来把残留归属回具体的变异体 id。 */
export interface PlannedMutant {
    readonly id: string;
    /** 被变异的文件（workspace 相对）。 */
    readonly file: string;
    /** 1-based 行号。 */
    readonly line?: number;
    /** 原文片段（可选）：用于在残留里定位它是否还在。 */
    readonly find?: string;
    /** 变异后的片段（可选）。 */
    readonly replace?: string;
}
/** 守卫看到的【现状】。 */
export interface MutationGuardObservation {
    /**
     * 现在每个目标文件的指纹。
     * ★ 同样地区分缺席与空：缺席 ⇒ 未测量。
     */
    readonly digests?: Readonly<Record<string, FileDigest>>;
    /**
     * git 状态（`git status --porcelain` 的原始行）。
     *
     * ★ 这是【佐证】而不是判据：一个正在开发中的仓库本来就有未提交改动。
     *   它用来在两件事之间给出更准的话：残留是"源码与基线不符"，
     *   而 git 脏是"与 HEAD 不符" —— 两者可以同时为真也可以只有一个为真。
     */
    readonly gitStatus?: readonly string[];
    /**
     * `git diff -U0` 的文本（针对本仓库）。
     *
     * ★ 这是【唯一】能给出真实残留行号的来源：`--porcelain` 只说"这个文件变了"，
     *   不告诉你变了哪几行。有它 ⇒ 残留能报到行；没有 ⇒ 回退到 plannedMutants
     *   的行号（我们知道的那一处），**绝不编造**。
     */
    readonly gitDiff?: string;
    /** 从 git status 行里读出来的、本仓库是否可达。缺席 ⇒ 读不到 git。 */
    readonly gitReadable?: boolean;
}
export interface MutationGuardContext {
    baseline?: MutationBaseline | undefined;
    observation?: MutationGuardObservation | undefined;
    /** 只关心这些文件（workspace 相对）。缺席 ⇒ 基线里列出的全部。 */
    readonly targets?: readonly string[];
    /**
     * 内容取回器：给一个 workspace 相对路径，返回当前文本。
     * 缺省时无法把残留归属到具体变异体（但归属仍能给出文件与行号）。
     */
    readonly readFile?: ((path: string) => string) | undefined;
}
/** 一条残留：哪个文件、哪几行、属于哪条变异体。 */
export interface MutationResidue {
    readonly file: string;
    /** 与基线不符的文件（必然有）；下面三个字段在有证据时才有。 */
    readonly mutantIds: readonly string[];
    /** 1-based 行号（来自 plannedMutants 与/或 git diff 的 hunk 头）。 */
    readonly lines: readonly number[];
    /** 说清这条残留是怎么被认定的。 */
    readonly evidence: string;
}
export type MutationGuardVerdict = {
    ok: true;
    clean: true;
    checked: readonly string[];
} | {
    ok: false;
    clean: false;
    residues: readonly MutationResidue[];
    summary: string;
} | {
    ok: false;
    unmeasured: string;
};
/**
 * 从 `git status --porcelain` 的一行里取出路径与状态码。
 *
 * 形状（实测）：` M src/a.ts` / `?? new.ts` / `R  old -> new`。
 * 解析不出来就返回 undefined —— 调用方据此把这一行忽略，而不是瞎猜。
 */
export declare function parseStatusLine(line: string): {
    code: string;
    path: string;
} | undefined;
/** `@@ -a,b +c,d @@` ⇒ 新文件里的起始行与行数。 */
export declare function parseHunkHeader(line: string): {
    startLine: number;
    lineCount: number;
} | undefined;
/**
 * 从 diff 文本里取出【被改动的行号】（新文件侧，1-based）。
 *
 * 用途：把"这个文件与基线不符"细化成"是这几行不符"，再与 plannedMutants 对位置。
 */
/**
 * 从 diff 文本里取出【被改动的行号】（新文件侧，1-based）。
 *
 * 用途：把"这个文件与基线不符"细化成"是这几行不符"，再与 plannedMutants 对位置。
 *
 * ★ `-` 行【不】计入新文件行号：`-` 是旧文件的行，它在新文件里没有对应位置。
 *   把删除算成新行号，会让之后"归属到哪条变异体"整片偏掉 —— 一个看起来更精确、
 *   实际更错的报告。
 */
export declare function changedLinesFromDiff(diff: string): number[];
/**
 * 主线：基线 × 现状 ⇒ 三态裁决。
 *
 * ★ 判定顺序是有意的 —— "没能测量"必须【先于】"干净"被判定：
 *   拿一个不完整的观察去宣布"干净"，正是这个项目反复警惕的失效。
 */
export declare function checkMutationGuard(context: MutationGuardContext): MutationGuardVerdict;
/**
 * 把一个 `git diff` 文本切成"每个文件一块"，每块以它自己的 `diff --git` 行开头。
 *
 * ★ 逐行扫描而不是用正则一次性切：diff 里可能有任意文本（含别处出现的
 *   `diff --git` 字样），逐行是唯一不会误解的读法。
 */
export declare function splitDiffChunks(diff: string): string[];
