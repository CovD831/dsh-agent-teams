/**
 * ── 判据的装配点：注册表 + 本仓库全部判据 ──────────────────────────────────────
 *
 * 这个文件是【唯一】知道"我们有哪些判据"的地方。编排层只调
 * `evaluateGate(point, context)`，不知道任何判据的名字或语义（契约 §8）。
 *
 * ★ 换一条判据 = 换这一份注册清单里的一行。
 * ★ 加一个位置 = 在 registry 的 INSERTION_POINTS 里加（那是流程形状的变化，
 *   属于上游，不属于这里）。
 *
 * ── ★ 四条并行判据的【装配点约定】（2026-10-05 定，四条并行开发共用）─────────────
 *
 * 这一段是【契约的注释副本】，不是代码。它唯一的读者是接下来同时动这个文件的
 * 四个人 —— 所以它钉的是四件最容易撞车的事：
 *
 *   ① 【模块路径 + 导出名】先定死。四条判据必须落下【同一组四个导出】，
 *      装配循环读的就是这四个名字（见 `GateModuleParts`）：
 *
 *          export const id          // 稳定标识，与 point 一起唯一
 *          export const point       // 五个插入点之一
 *          export const description // 控制台渲染用
 *          export function gate(ctx)  // 三态裁决（async 也行）
 *                                  // 可选第五个：appliesTo(ctx)
 *
 *      ★ 少一个导出不是"还没写完"，是【这里会当场抛错】：
 *        register() 校验 id / point / description / gate，缺一不可；
 *        而 point 写错会撞上 `unknown insertion point`。两者都是启动即炸，
 *        不会静默地少一条判据。
 *
 *   ② 【id 与 point 也先定死】，因为注册表对重复 id 是【抛错】而不是覆盖：
 *
 *          任务 模块（src/gates 相对）        导出名        id                            point
 *          T1   dispatch/worktree.ts          worktree      dispatch.worktree             dispatch
 *          T2   completion/r5.ts              r5            completion.r5                 completion
 *          T3   completion/mutation.ts        mutation      completion.mutation           completion
 *          T4   completion/backtest.ts        backtest      completion.backtest           completion
 *
 *      ★ 导出名撞车（两个文件都叫 `gate` 无所谓；但 import 绑定名必须互不相同）
 *        ⇒ 下面的别名表就是答案：`import * as worktree` / `as r5` / ...
 *      ★ 三条 completion 判据都在同一位置 ⇒ 它们会【同一次求值里一起跑】，
 *        所以顺序有意义且必须稳定。ALL_GATES 的书写顺序 = 求值顺序（契约 §3），
 *        这里故意排成「先跑便宜的机械判据，后跑要起进程的」：
 *        r5（重跑测试）→ mutation（重跑变异）→ backtest（跑基准与全量）。
 *
 *   ③ 【接线位置】`import` 与 `ALL_GATES` 里各留一行槽位（现在是注释占位）。
 *      在自己那一行落把 import 后，把该行从 `T? ——— 待接` 改成 `T? ——— 已接`；
 *      **不要**动别人的行，也不要重排 —— 一条判据一个 import，冲突面就是那一行。
 *
 *   ④ 【本文件不许出现任何判据语义】：不 import 任何 I/O，不写 if/then，
 *      registry.ts 本身不改。一个只做"列清单"的文件才可能被四个人同时改而不冲突。
 *
 * ── 契约（对四条判据的接口要求，读 `docs/GATE-REGISTRY.md`）──────────────────
 *
 *   · 三态裁决：`ok` / `blocked([原因])` / `unmeasured(为什么没测成)`；
 *     后两者【不同形】—— 而"没测到"绝不允许并进"通过"。
 *   · 纯数据变换：判据不 import I/O，执行器由调用方注入（见 registry.ts 的
 *     `execVerifyCommand` 先例）；拿不到观察就 `unmeasured`，不是 `ok`。
 *   · 每条自带三臂夹具：伪造臂 / 未测量臂 / 对照臂，放 `scripts/gate-<名字>.test.mjs`
 *     （被 `test:gates` 的 `gate-*` glob 收；名字不匹配 glob 的夹具必须在
 *     package.json 的 test:gates 里显式列出，否则是"有 0 个读者"的测试）。
 */

import { createGateRegistry } from './registry.ts'
import * as verifyRerun from './completion/verify-rerun.ts'
import * as changedPaths from './dispatch/changed-paths.ts'
import * as backtest from './completion/backtest.ts'
import * as worktree from './dispatch/worktree.ts'
import * as r5 from './completion/r5.ts'
import * as mutation from './completion/mutation.ts'
/**
 * ── T10 ——— 已接：判据「inScope 含 src/ 却漏 lib/ 构建产物」（contract 位置第一条）
 *
 *      id = 'contract.build-artifact-scope' · point = 'contract'
 *      证据来源：契约里的 inScope 列表本身 —— 它只做路径字符串之间的映射，
 *                不读磁盘、不碰 classifyChangedPath（预防，不是放宽）。
 *                inScope 整个缺席（如 kind=work）⇒ ok（不适用，没有同步要求）；
 *                inScope 在场但读不出 ⇒ unmeasured（见 t11 修正后的两条臂）。
 *
 * ★ 本行由 t10 落。规则：`src/gates/index.ts` 归【第一个接判据的任务】持有并接线，
 *   后续任务按「一人一行」只加自己那一行 —— 见上面的槽位约定。
 */
import * as buildArtifactScope from './contract/build-artifact-scope.ts'
/**
 * ── T8 ——— 已接：delivery 位置的两条判据（交付那一刻的全局检查）─────────────────
 *
 *      id = 'delivery.coverage'    · point = 'delivery'
 *          每个目标都有人认领。一个没有任何任务 `coverageOf` 它的目标在任务列表里
 *          【不留痕迹】：全绿、review 全 pass、canDeclareDelivery 返回 ok，
 *          而它从来没人碰过 —— "没测到"并进"通过"的同一形态，只是被并进去的是整个目标。
 *
 *      id = 'delivery.convergence' · point = 'delivery'
 *          成员确实收敛 —— idle ≠ converged，空回复不是收敛。
 *
 * ★ 这两行由 t11 落。规则：`src/gates/index.ts` 归【第一个接判据的任务】持有。
 *   t8 的判据本体是 t8 已交付的产物，本任务**只接线、不改它们**（见 t11 契约）。
 * ★ 顺序 = 同位置内的求值顺序：先问"有没有人做"（coverage），再问"做的人收敛了没有"
 *   （convergence）—— 一个没人认领的目标谈不上"那个人的收敛"。
 */
import * as deliveryCoverage from './delivery/coverage.ts'
import * as deliveryConvergence from './delivery/convergence.ts'
/**
 * ── T6 ——— 已接：runtime 位置的第一条判据（探活，契约 §5 的落点）────────────────
 *
 *      id = 'runtime.liveness' · point = 'runtime'
 *
 *      「卡死了」：两次探活之间最后活动时刻没变 ⇒ blocked（**作为告警，不是拒绝**）。
 *      「定期告知」：还在活动 ⇒ ok + 「还在跑，已 N 分钟」。
 *      ✗ 「没进展」不做 —— 「思考很久」与「卡住」在观察上同形，判它必然误报。
 *
 * ★ 它【不是】硬超时：等多久都不构成报警，唯一的判据是"这 10 分钟里动过没有"。
 *   用户原话：「有的任务确实超过 30min」。
 *
 * ★ 它是【有状态】的（本插件第一条）：比较"这次探活"与"上次探活"。状态由**调用方**
 *   持有（每条等待一本记录），判据本身仍是纯函数 —— 时钟与两份读数全部注入。
 *
 * ★ 本行由 t6 落。规则：`src/gates/index.ts` 归【第一个接判据的任务】持有；t6 恰好
 *   也是为三个空位置建调用点的那个任务（见下面 contract/delivery 两行）。
 *
 * ★★ t4（集成收口）在这一行上补的一件事：**观察模式不需要改代码，也不能改代码**。
 *
 *   要求「新判据先观察一轮」时，最自然的写法是在这里加 `registry.observe(id)`。
 *   那是错的，而且错得有据可查（注册表 §3.5 决定 ② 的原话）：观察集是**运行时
 *   数据**，一旦把它写成装配点里的一行，本项目两个时刻的时序就合成了同一个时刻 ——
 *
 *     · 注册表在模块加载时就建好了（`export const registry`，本文件最后一行）；
 *     · 插件 `apply()` 在**之后**才跑。
 *
 *   ⇒ 于是观察期只在"加载与 `apply()` 之间"生效。生产里没有夹在中间的人，
 *     它等于**没有**；而夹具若在 import 之后调 `unobserve()`，读到的又是"没在观察"
 *     —— 两个相反的结果，取决于**谁先跑**，而它们在日志里同形。这正是注册表
 *     决定 ② 要防的那条窗口（"改了代码 → 漏了 build → 装的位置跑的是旧代码"）。
 *
 *   ⇒ 观察开关有两个**已经存在**的入口，本行一个都不用加：
 *     · `AGENT_TEAMS_OBSERVE_GATES=runtime.liveness` —— 部署改动，不改代码；
 *     · `registry.observe(id, {reason})` —— 运行时调用，改的是那一次运行。
 *   `scripts/gate-index-assembly.test.mjs` 臂 3e 钉住"装配点里没有第三句话"。
 */
import * as runtimeLiveness from './runtime/liveness.ts'
/**
 * ── T7 ——— 已接：判据「verify 命令可判性」（contract 位置第二条）──────────────
 *
 *      id = 'contract.verify-command' · point = 'contract'
 *      证据来源：契约里声明的 verify 命令本身。
 *      实测教训（本队）：`grep -qx N` 会被 `wc` 的前导空格卡死 —— 命令永远失败
 *      而它看起来是对的，于是一个【永远红】的 verify 会把整条任务链锁死。
 *      本判据在契约落库那一刻就问"这条命令判得出来吗"。
 *
 * ★ 本行由 t14 落。★ 它此前【已在盘上但没进清单】—— 那正是本轮一直在消灭的
 *   「装了但调不到」：判据文件写好了、夹具也有了，而 `registry.list().contract`
 *   里没有它。接线与判据本体分开看，是这类缺陷唯一的藏身处。
 */
import * as contractVerifyCommand from './contract/verify-command.ts'
/**
 * ── 四条并行判据的 import 槽位（一人一行，互不越界）───────────────────────────
 *
 * T1 ——— 已接：判据「worktree 到达（成员真的在隔离目录里干活吗）」
 *      `import * as worktree from './dispatch/worktree.ts'`
 *      id = 'dispatch.worktree' · point = 'dispatch'
 *      证据来源：src/worktree.ts 的 createTaskWorktree(...) ⇒ { path, base }
 *                —— 没有 worktree ⇒ unmeasured（见 START-HERE §5.2）
 *
 * T2 ——— 已接：判据「R5 红前绿后（新测试必须先红后绿）」
 *      `import * as r5 from './completion/r5.ts'`
 *      id = 'completion.r5' · point = 'completion'
 *      证据来源：父版本 = worktree 的 base；newTestFiles = 会话事件（§5.1）
 *                —— 拿不到父版本 ⇒ unmeasured，不是 ok（见 START-HERE §6②）
 *
 * T3 ——— 已接：判据「变异测试（L1/L2 机械 + L3 语义）」
 *      `import * as mutation from './completion/mutation.ts'`
 *      id = 'completion.mutation' · point = 'completion'
 *      证据来源：变异跑在 worktree 的 base 上；L3 语义分由调用方注入
 *                —— 没跑变异 ⇒ unmeasured（L3 未给分 ≠ L3 通过）
 *      ★ 需要注入 readFile / runTest / writeFile 三个执行器（判据本身不做 I/O）；
 *        三者缺一 ⇒ unmeasured，**不是 ok** —— 一个不能注入变异体的判据如果返回
 *        ok，就是"装上了但从不生效"，比没装更坏。
 *
 * T4 ——— 已接：判据「回测（基准绿前置 + 选测 + 全量 + 基线）」
 *      `import * as backtest from './completion/backtest.ts'`
 *      id = 'completion.backtest' · point = 'completion'
 *      证据来源：基准必须先绿；基线缺失 ⇒ unmeasured（不是"回到基线"）
 *
 * ★ 四个人各自只改自己那一行；未接的槽位保持注释 —— 它不会被 register() 看见，
 *   也不会有半条判据被装上去。
 */

/**
 * 一个判据模块必须交出的四个名字（+ 可选的 `appliesTo`）。
 *
 * ★ 为什么把它写成类型而不是只写在注释里：`import * as` 拿到的是一个 unknown 袋子，
 *   装配循环读 `module.id` 时 TS 只能看见 `any` ⇒ 「我少写了一个导出」会一路滑到
 *   运行时才以别的形状暴露（或更坏：压根不被察觉，见下面的显式校验）。
 *
 * ★ 只有在【被断言为它】的那一刻，这个形状才起作用 —— 断言之前，每件都必须先被
 *   查过（asRegistration 里的 missing / appliesTo 两处），否则这里的注解只是许愿。
 */
interface GateModuleParts {
  id: string
  point: Parameters<ReturnType<typeof createGateRegistry>['register']>[0]['point']
  description: string
  gate: (context: any) => unknown
  appliesTo?: (context: any) => boolean
  /** ★ 输入面声明（t6 起的第六条可选导出）；见下面 `asRegistration` 里那段实测记录。 */
  requires?: readonly string[]
}

/**
 * 全部判据。**一条判据一个 import** —— 这样"换掉一条"就是换一个 import，
 * 而不是在一个大文件里找。
 *
 * ★ 顺序 = 同位置内的求值顺序（registry.ts 按注册顺序跑，契约 §3）。
 *   completion 位置会同时挂 T2/T3/T4，所以这一份顺序是它们唯一共享的约定：
 *   先机械（r5 重跑测试）→ 再机械（mutation 重跑变异）→ 最后最贵的（backtest）。
 */
const ALL_GATES = [
  verifyRerun,
  changedPaths,
  worktree,
  // T1 ——— 已接：worktree
  r5,
  // T2 ——— 已接：r5
  mutation,
  // T3 ——— 已接：mutation
  // T4 ——— 已接：backtest
  backtest,
  /**
   * T10 ——— 已接：buildArtifactScope
   * ★ 只加自己这一行：别人的行一个字都不动（见文件顶部的槽位约定）。
   */
  buildArtifactScope,
  /**
   * T7 ——— 已接：contractVerifyCommand（contract 位置第二条；由 t14 接线）
   * ★ 顺序 = build-artifact-scope（scope 里有没有漏产物）
   *        → verify-command（这条命令判不判得出来）。
   *   两条都在契约落库那一刻说话，且互不依赖 —— 顺序只影响 blocker 的排列。
   */
  contractVerifyCommand,
  /**
   * T8 ——— 已接：delivery 位置的两条判据（由 t11 接线；判据本体属 t8）
   * ★ 顺序 = coverage（有没有人做）→ convergence（做的人收敛了没有）：
   *   一个没人认领的目标谈不上"那个人的收敛"。
   */
  deliveryCoverage,
  deliveryConvergence,
  /**
   * T6 ——— 已接：runtimeLiveness（runtime 位置的第一条判据）★ t4 集成收口
   * ★ runtime 位置上只有它一条，所以没有"位置内顺序"要排；但它有位置纪律：
   *   它的任何裁决都【只被记录】，不参与控制流（契约 §5 硬要求）。
   *
   * ★★ t4：这一条**第一次上线**，而"第一次上线"与"以后每次上线"在装配点里
   *   必须是同一行 —— 观察期是运行时数据，不是清单里的一个状态（见上面
   *   import 那一段的长注释）。所以这里只说一件事：**它在观察期里，本行一字不改**。
   *
   *   `runtime` 位置与其余四个位置有一条结构性的差别，值得写在这里（它是
   *   "观察模式在 runtime 上是双保险"这句话的由来）：
   *     契约 §5 硬要求 runtime **不得拒绝任务** —— 六处调用点拿到的裁决只用于
   *     `judgeRuntimeGates(...)` 记录（`src/tools.ts`），**不进任何控制流**。
   *   ⇒ 对 runtime 而言，"观察模式"与"判据本来就没有否决权"放行的是**同一组**
   *     裁决（`observed.blockers` 与 `blockers` 在 runtime 上走向同一个终点：
   *     一行记录）。两者同时生效不会互相取消，也不会有一方悄悄盖住另一方 ——
   *     实测见 `scripts/gate-index-assembly.test.mjs` 臂 3f（三条读法对照）。
   */
  runtimeLiveness,
] as const

/**
 * 把注册清单里的一个模块拆成注册表要的形状。
 *
 * ★ 为什么导出它：它是装配点唯一会【拒绝】的地方，而一个只在启动路径上跑一次、
 *   且只在出错时才可见的校验，恰恰是最难被测到的东西。导出它 ⇒ 夹具可以拿一个
 *   缺导出的模块直接问它「你会炸吗」（见 `scripts/gate-index-assembly.test.mjs` 臂 1）。
 *   它是纯函数，没有副作用。
 *
 * ★ 校验是【显式】的，不靠 registry.register() 兜底，理由是实测的：`register()`
 *   只在【真的读了那个字段】时才发现它有问题 —— 一个模块若把 `appliesTo` 导出成
 *   非函数（例如常数 `true`），`typeof module.appliesTo === 'function'` 为假 ⇒
 *   它被静默丢掉，而 `register` 永远看不见 ⇒ **一条只对某些 kind 生效的判据会变成
 *   对全部 kind 生效**，且没有任何地方报错。装配层是唯一该说清"缺哪一件"的地方。
 *
 * ★ 报错信息是签名的一部分：它必须指名【哪个模块】与【缺的哪一件】。缺了 `gate`
 *   的模块 `id` 往往还在，所以 `${named}` 有话说；连 `id` 都缺时退化成
 *   "(a gate module)"，也必须照样说清缺的是什么。
 */
export function asRegistration(module: Record<string, unknown>): Parameters<ReturnType<typeof createGateRegistry>['register']>[0] {
  const named = typeof module.id === 'string' && module.id.trim() !== '' ? `"${module.id}"` : '(a gate module)'
  const missing = (['id', 'point', 'description', 'gate'] as const).filter((key) => module[key] === undefined || module[key] === null)
  if (missing.length > 0) {
    throw new Error(`${named} does not export ${missing.join(' / ')}; a gate module must export id, point, description and gate (see the assembly contract at the top of gates/index.ts)`)
  }
  if (typeof module.gate !== 'function') {
    throw new Error(`${named} exports "gate" but it is not a function (got ${typeof module.gate}); a gate that cannot be called would be registered but never decide anything`)
  }
  if (module.appliesTo !== undefined && typeof module.appliesTo !== 'function') {
    throw new Error(`${named} exports "appliesTo" but it is not a function; a non-function appliesTo would be silently dropped, making a gate that applies to some kinds apply to every kind`)
  }
  const parts = module as unknown as GateModuleParts
  return {
    id: parts.id,
    point: parts.point,
    description: parts.description,
    gate: parts.gate as never,
    ...(typeof module.appliesTo === 'function' ? { appliesTo: parts.appliesTo } : {}),
    /**
     * ── ★ `requires` 必须在这里【显式】转发（缺陷发现于 t3 = dispatch 接线）─────────
     *
     * MEASURED（2026-10-06）：`asRegistration` 此前只转发 id / point / description /
     * gate / appliesTo。判据模块写了 `export const requires = [...]`，核对层也建好了，
     * 而装配层**不再往下交** ⇒ `registry.list()` 读出来是 `hasRequires: false`，
     * 于是"这条判据声明了输入面"与"它压根没声明"在控制台上同形。
     *
     * ★ 这个缺陷的形状正是本轮要消灭的那一个：**声明写对了、机制也建好了、
     *   而中间那个白名单没列它** —— 于是它静默地不生效。前四次同形问题
     *   （inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配）都长这样。
     *
     * ★ 与 `appliesTo` 那条的区别：非函数 appliesTo 是被**静默丢掉**的，而
     *   requires 丢掉之后至少还留着一条 `undeclared` 说明 —— 两者都不可接受，
     *   因为"没声明"与"声明了但没转发"读起来一模一样。臂 1e 钉住这一行。
     */
    ...(module.requires === undefined ? {} : { requires: parts.requires as readonly string[] }),
  }
}

/** 建一个装好全部判据的注册表。 */
export function buildRegistry() {
  const registry = createGateRegistry()
  for (const module of ALL_GATES) {
    registry.register(asRegistration(module as unknown as Record<string, unknown>))
  }
  return registry
}

/** 进程级单例：编排层用它。 */
export const registry = buildRegistry()

export { createGateRegistry } from './registry.ts'
export { ok, blocked, unmeasured, INSERTION_POINTS } from './registry.ts'
