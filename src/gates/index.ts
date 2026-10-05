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
