/**
 * ── QG-A：纯路径与文本谓词（**无 I/O**）─────────────────────────────────────────
 *
 * ★ 本文件是 M3 从 `src/quality-gates.ts` 拆出的 **QG-A 块**（见 `docs/MODULE-MAP.md` §1.1 的 Q1 + Q2）。
 *
 * ── 为什么必须拆（不是审美，是纪律要求）──────────────────────────────────────────
 *
 * `src/gates/**` 自己**零 I/O**（`grep -rn "from 'node:" src/gates/` ⇒ 0 处），
 * 但 `src/gates/{admission,dispatch}/*.ts` 的 4 个文件都 import
 * `src/quality-gates.ts` 的 `normalizeWorkspacePath` —— **而后者 import 了 `node:fs`**
 * ⇒ ★ **「判据不 import I/O」这条载荷级不变量在【传递闭包】上破了。**
 *
 * ★ 而这条纪律的载荷性在本仓有明文（`src/gates/runtime/stall.ts` 文件头）：
 *   「gates 层今天不 import 任何 `tools/`……**那条纯度是载荷,不是风格**」。
 *
 * ⇒ 把 QG-A 挪到本文件（**零 `node:` import**），4 个 gates 文件改指这里，
 *   传递闭包就**不再经过 `quality-gates.ts` 到达 `node:fs`**。
 *   可复跑证明见 `docs/MODULE-MAP.md` §7c（拆前有路径、拆后无）。
 *
 * ── 内容边界（与 M1 的 Q1/Q2 逐条对应）──────────────────────────────────────────
 *
 *   `PathClassification` · `normalizeWorkspacePath` · `pathMatchesScope` ·
 *   `isDefaultExcluded`（私有）· `classifyChangedPath` ·
 *   `collectChangedPaths` · `inScopeOverlap` · `looksLikeRepoPath` / `normalizeRepoPath`（私有）·
 *   `repoPathsNamedIn` · `verifyTargetOf` · `armsNamedIn` · `subjectTermsIn` · `GENERIC_TERMS`
 *
 * ★ **刻意不含** `structurallyImpossiblePath` 与 `checkTaskPremises` ——
 *   它们虽然文本上紧邻 Q2，但**直接用 `existsSync`/`readFileSync` 做文件系统检查**，
 *   是本块唯一带 I/O 的两件 ⇒ 留在 `quality-gates.ts`（见 §7c 的边界说明）。
 */
export type PathClassification = 'in_scope' | 'out_of_scope' | 'undeclared' | 'illegal';
/** Normalize a workspace-relative POSIX path. `undefined` means illegal. */
export declare function normalizeWorkspacePath(path: string): string | undefined;
export declare function pathMatchesScope(path: string, pattern: string): boolean;
/**
 * ── ★★★ t95（吸收上游 #183 / `648fd9a`）：**任何质量契约都不许认领的路径** ──────────────
 *
 * 版本控制、harness/插件状态、密钥与私钥。
 *
 * ── ★★★ 为什么它必须【导出】，而不再是一个私有函数 ────────────────────────────
 *
 * 上游 #183 的题（逐字）：
 * > 「`repairScopeFromFindings` collected paths the completion gate classifies
 * >   `out_of_scope` by default (secrets/, .env*, .git, .dsh, .agent-teams),
 * >   **producing unsatisfiable contracts.**」
 *
 * MEASURED（t95 开工在本仓复现）：
 * ```
 * repairScopeFromFindings([{ file: 'secrets/k.json' }, { file: 'src/a.ts' }])
 *   ⇒ 推导出的 inScope = ["secrets/k.json","src/a.ts"]
 * ★ 而闸门对第一条的裁决是 `out_of_scope`（下面 classifyChangedPath 的【第一行】）
 * ⇒ ★★ 一条路径被【写进】 inScope，而闸门仍然判它 out_of_scope
 * ⇒ ★★★ 【契约自身不可满足】—— 成员无论怎么做都过不了，于是死锁。
 * ```
 *
 * ★★ 而根因**不是"两份谓词"**（本仓只有这一份），而是：
 *   **推导侧【根本没用它】** —— 那一侧自己收集路径，**从不问闸门**。
 *   ⇒ 这就是上游说的 "**Derivation and gate now share one**"。
 *
 * ⇒ 所以它现在**导出**，供两侧共用：闸门（{@link classifyChangedPath}）与
 *   契约生成（`repairScopeFromFindings`）。
 *   ★ **下一次改排除规则时只有这一处改** —— 那是本次改动的**唯一验收点**。
 *
 * ── ★★ `excluded: false` 时 `.agent-teams/` 也一并排除（上游本次新加的一格）──────
 *
 * 上游 `648fd9a` 在这一行加了 `|| segments[0] === '.agent-teams'`。
 * ★ 而本仓此前**没有**它 ⇒ 实测 `.agent-teams/foo.json` 被判 `undeclared`
 *   （不是 `out_of_scope`）。⇒ 本次照上游补齐，且这**不是**可选的：
 *   契约生成器**不该走进** `.agent-teams/`（那是台账/状态目录）。
 */
export declare function isDefaultExcludedPath(path: string): boolean;
export declare function classifyChangedPath(path: string, inScope?: readonly string[], outOfScope?: readonly string[]): PathClassification;
/**
 * ── ★★ f-0020：repair 的判别力证据，不是「本次新增的测试」───────────────────────
 *
 * ── 它修的是什么（MEASURED：本队 6 次同形终止，全部由 captain 代落终态）─────────
 *
 *     t13 / t16 / t19 / t25 / t26 cancelled · t27 failed
 *
 * 原因不是交付物有问题，而是三道完工门的**问句与 repair 的验收不是同一件事**：
 *
 *     r5 / mutation 度量：「为【新工作】写了新测试吗」   ← 输入面 = `newTestFiles`
 *     repair 的验收    ：「改了【既有】夹具后它仍能判别吗」← 净改动全在既有文件上
 *
 * ⇒ `newTestFiles` 对一份 repair 恒为 `[]`（它数的是"新增"，而 repair 一个都没新增），
 *   于是 r5 报 `unmeasured`（"none of the 0 reported file(s)…"）、mutation 拿不到
 *   杀手套件。判据**没有撒谎** —— 它诚实地说"我没能测量"。
 *   但一个恒常的 `unmeasured` 同样**交不出终态** ⇒ 无人值守退化成 captain 逐个手收。
 *
 * ── ★★ 这一格**只换了文件来源**，没有降低判别的强度 ─────────────────────────────
 *
 * 判据问的仍是同一个问题：「这条夹具**还能不能抓住缺陷**」。
 * 变的只是"拿哪些文件去问"：
 *
 *     旧：本次【新增】的测试文件        ⇒ 对 repair 是空集 ⇒ 恒 unmeasured
 *     新：本次【改动过的既有的】测试夹具 ⇒ repair 的真实证据 ⇒ 可测量
 *
 * ★ 而"装饰性测试"这一路**一步都没让**：一条恒绿的既有夹具同样过不了 r5
 *   （它在父版本上就绿 ⇒ `decorative test` 拒绝）。见夹具的臂 3（定向突变）。
 *   ⇒ 换句话说：**"是不是新文件"是无关的；"它还能不能判别"才是问题。**
 *     旧口径读的是前者，代价是把后者的答案一起丢掉了。
 *
 * ── 三态（与 `observedChangedPaths` / `gitChangedPaths` 逐条对齐）──────────────
 *
 *   观察面缺席（`undefined`）    ⇒ 本函数返回 `[]`，且调用方**必须**报 unmeasured
 *        —— "我没能观察" 与 "观察了、确实没有" 不同形（本队记账最久的那条界线）。
 *   观察到了、一条夹具都没改动  ⇒ `[]`，同样是 unmeasured（没有可测量的判别力）。
 *   观察到了、改了既有夹具      ⇒ 那些路径 —— r5 拿它们去跑红前绿后。
 *
 * ★ 为什么不做成"猜一个默认目录"：猜出来的路径会让运行器返回 `[]`，
 *   而空集会被读成"没有新测试要查" ⇒ **ok**。那是把"没测到"并进"通过"，
 *   正是 r5 的注释里已经点名过的那个坑（"用没有根据的默认值…⇒ ok"）。
 *
 * @param ctx - 一份完成更新的上下文（任务是 `repair` / `implementation`）。
 * @returns 应当被当作判别力证据去测量的测试夹具路径（workspace 相对，已去重排序）。
 */
export declare function collectChangedPaths(gitStatusText: string): string[];
export declare function inScopeOverlap(left: readonly string[] | undefined, right: readonly string[] | undefined): string[];
/**
 * 从一段自由文本（objective / acceptance）里取出**看起来像仓库路径**的 token。
 *
 * ★ 口径刻意**保守**：只认反引号里的那一类（本仓的契约几乎总是这样写路径），
 *   以及裸的 `dir/file.ext` 形态。
 * ★★ 而"取不到"⇒ 返回空数组（**不猜**）：一个靠猜的检查会在别的措辞上误报，
 *   而误报会教人忽略门禁 —— 与漏报同样有害。
 */
export declare function repoPathsNamedIn(text: string): string[];
/** 一条 verify 命令里"被跑的那个文件"（`node --test <path>` / `node <path>`）。 */
export declare function verifyTargetOf(command: string): string | undefined;
/**
 * 一条验收标准"点名的臂"—— 例如 `scripts/gate-friction-capture.test.mjs` 里的 `臂 4`。
 *
 * ★ 这是 (iii) 的**要害**：文件存在**不等于**它里面那条臂存在。
 *   t8 那一例正是如此：文件在（51755 字节），而 **C1 的臂一个都没有**。
 */
export declare function armsNamedIn(text: string): string[];
/**
 * ── ★★★ t8 那一例的最强读数：**臂名存在，而它承载的东西不存在**────────────────────
 *
 * MEASURED（本任务实测，`git show ba5b23a:scripts/gate-friction-capture.test.mjs`）：
 *
 *     `臂 4` 在那个修订上**存在**（2 处）—— 而它是一个**与 C1 无关的**老臂：
 *         「臂 4（★ 重放臂）：拿记录去重跑那条判据 —— 卡点必须**再发生一次**」
 *     而 C1 的词汇（`observeStall` / `recordClass` / `FrictionRecordClass`）**零出现**。
 *
 * ⇒ ★★ 于是"验收说臂 4 证明 escalate 池"在那棵树上**是空的**：
 *   臂名对得上，而**它证明的东西不存在**。
 *   ⇒ 一个只比臂名的检查**会放它过去** —— 而那正是本任务要消灭的形态本身：
 *     **一条读起来像被验证过的标准，其实没有主语。**
 *
 * ── 所以这一梯补的是**主语**：验收标准里点名的标识符，必须在那个文件里真的出现 ────────
 *
 * ★ 口径保守（与 `repoPathsNamedIn` 同一条纪律）：只认**反引号里**、
 *   且形状像**代码标识符**（camelCase / snake_case / PascalCase，可带点）的那些。
 *   ⇒ 取不到 ⇒ 不报（**不猜**）：一个靠猜的检查会在散文上误报，
 *     而误报会教人忽略门禁 —— 与漏报同样有害。
 */
export declare function subjectTermsIn(text: string): string[];
/**
 * 跑三条梯级，返回**全部**失败（不短路 —— 一次给全，与判据注册表同一条纪律）。
 *
 * ★ `root` 可注入 ⇒ 夹具能拿一棵私有树测它，而不必依赖真实仓库的形状。
 */
