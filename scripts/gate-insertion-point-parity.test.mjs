/**
 * ── ★★ 同源臂：`types.ts` 的 `GATE_INSERTION_POINTS` 与注册表的 `INSERTION_POINTS` ──
 *
 * ── 它防的是什么（MEASURED）─────────────────────────────────────────────────────
 *
 * `src/types.ts` **不许** import `src/gates/registry.ts`，而这不是风格问题：
 *
 *   · 它是**零 import 的叶子**，而那条纪律有**两条臂逐字钉住**
 *     （`gate-runtime-stall.test.mjs:77`、`gate-stall-leaf-home.test.mjs:268`）。
 *   · 而 `src/gates/runtime/stall.ts:56` 反过来 `import ... from '../../types.ts'`
 *     ⇒ ★ **一旦 `types.ts` import 了 gates，"环"是真的**。
 *
 * ⇒ 于是"六个插入点的取值与次序"在**两处**各写了一份字面量。
 * ★★ 而两份字面量是一个**会漂移的东西** —— 它必须有一条**机械的**保障，
 *   而不是靠"记得同步"（那是一条靠记忆的规则，本仓反复证明这类规则会腐烂）。
 *
 * ── 为什么这条臂在本队是【必须】的（不是锦上添花）─────────────────────────────────
 *
 * t81 的实现方先核写域后报出了这个缺口，并**明确说它加不了这条臂**（`scripts/` 不在它写域）。
 * ★ 而它同时指出：`FailureKindName` 的先例**正是因为有一条这样的臂**才成立
 *   （`gate-execution-history.test.mjs` 臂 7 逐字比对两处取值）。
 * ⇒ 队长补上这一条，否则 `GATE_INSERTION_POINTS` 就是一份**没有护栏的字面量** ——
 *   而"没有护栏"与"不需要护栏"在报告里同形。
 *
 * ── 两条反向半边（缺一不可）───────────────────────────────────────────────────
 *
 *   ① 取值分叉（注册表加/删一个位置，`types.ts` 没跟）⇒ 本臂红
 *   ② ★ **次序分叉**（两边取值相同但顺序不同）⇒ 本臂红
 *      ★ 次序**不是装饰**：`GATE_INSERTION_POINTS` 被 UI 用来**按流程顺序遍历六段**，
 *        而 `INSERTION_POINTS` 的注释逐字写明它的顺序就是流程顺序。两处不同序 ⇒
 *        UI 会把"delivery 在 completion 之前"画出来，而那**看上去完全正常**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GATE_INSERTION_POINTS } from '../lib/types.js'
import { INSERTION_POINTS } from '../lib/gates/registry.js'

test('★★★ 同源臂：`types.ts` 的 `GATE_INSERTION_POINTS` 与注册表的 `INSERTION_POINTS` 逐字、逐序相同', () => {
  /**
   * ★ 分开断言三件事，而不是只做一个 `deepEqual` ——
   *   因为"少一个"、"多一个"、"次序不同"的**补救动作完全不同**，
   *   而一个合成断言只会给出一句"不相等"。
   */
  const local = [...GATE_INSERTION_POINTS]
  const registry = [...INSERTION_POINTS]

  assert.deepEqual(
    [...local].sort(), [...registry].sort(),
    '★★★ 取值集合分叉：`types.ts` 的 GATE_INSERTION_POINTS 与注册表的 INSERTION_POINTS '
    + '必须含**同一组**位置 —— 分叉会让 UI 漏画或多画一段。\n'
    + `   实测 types.ts = ${JSON.stringify(local)}\n`
    + `   实测 registry = ${JSON.stringify(registry)}`,
  )

  assert.deepEqual(
    local, registry,
    '★★★ 次序分叉：两处取值相同但**顺序不同** ⇒ UI 会把阶段顺序画错，'
    + '而"画错了顺序"看上去完全正常（六个阶段都在，只是先后不对）。\n'
    + `   实测 types.ts = ${JSON.stringify(local)}\n`
    + `   实测 registry = ${JSON.stringify(registry)}`,
  )

  /**
   * ★ 第三条：**次序本身要被钉住**，而不是"两处相等即可"。
   *   若两份字面量被同一次编辑改成同一个错序（例如有人把六段一起重排），
   *   上面两条**都会通过** —— 而流程顺序错了。
   *   ⇒ 所以这里再断言一次"第一个是 admission、最后一个含 runtime"这类锚点。
   */
  assert.equal(local[0], 'admission',
    '★★ 流程的**第一个**位置必须是 `admission`（注册表注释逐字：「成团【之前】」）—— '
    + '两份字面量被一起重排时，上面两条比不出错，这一条能。')
  assert.ok(local.includes('completion') && local.includes('delivery'),
    '★★ `completion` 与 `delivery` 必须都在场 —— 它们是 S1 与交付的落点。')
})
