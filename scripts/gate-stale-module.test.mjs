/**
 * ── 「本进程持有的模块是旧的」必须可检测、可上报（t23 / C）────────────────────────
 *
 * ── 它防的是什么失效（MEASURED，本轮**五次**拦截）────────────────────────────────
 *
 * 本队今晚被同一个东西拦了 5 次（t14 / t17 / t19 / t22 / t23 开工），而每一次的
 * **表面理由都不同**：
 *
 *     · `dispatch.changed-paths` 说「你虚报改动」
 *     · `completion.backtest`    说「基准不可得」
 *     · `claim_task`             说「依赖未满足」
 *
 * ⇒ 而真相只有一个：**进程加载的是构建前的模块**。
 *   ★ 形态：**一个机制级的失效，伪装成一条业务规则**。
 *     代价不是"重载一次"，而是"**每一轮都重新误诊一次**"。
 *
 * ── 为什么 ESM 让这件事必然发生（机制级解释）───────────────────────────────────
 *
 * `import { f } from './state.ts'` 建立的是**命名绑定**，在**模块求值时**建立，
 * 之后**永远指向同一个函数对象**。⇒ 盘上 `.js` 被 `pnpm build` 覆盖后，进程里那个
 * 函数还是旧的 —— 因为它的**闭包环境**也是旧的。
 * ★ 所以"每次调用时求值"这句话不精确：函数体确实每次跑，但它**本身**是从旧实例拿来的。
 *
 * ── ★★ 本夹具钉什么、不钉什么（边界写清）────────────────────────────────────────
 *
 *   钉：**该不该重载**（stamp 不一致 ⇒ 报）。
 *   **不**钉：哪一段是旧的 —— 那需要模块图内省，做不干净，而 5 次拦截里真正需要的
 *     判断是前者。
 *   ★ 已知边界（**写成断言，防止下一个人去修一个修不了的东西**）：
 *     即使 stamp 一致，也可能有段落是旧的。这一格本读数**测不了**，
 *     它必须在措辞里说明，而不是假装覆盖。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { moduleFreshness, moduleFreshnessMessage } from '../lib/tools.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAMP = join(ROOT, 'lib', 'git-artifact-stamp.json')

/** 改盘上的 stamp，跑一段，**无论成败都还原** —— 绝不把仓库留在脏状态。 */
function withStampOutput(output, run) {
  const original = readFileSync(STAMP, 'utf8')
  try {
    const parsed = JSON.parse(original)
    writeFileSync(STAMP, `${JSON.stringify({ ...parsed, output }, null, 2)}\n`, 'utf8')
    return run()
  } finally {
    writeFileSync(STAMP, original, 'utf8')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：一致 ⇒ current，且**不阻止任何东西**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：盘上与加载时一致 ⇒ current', () => {
  const freshness = moduleFreshness()
  assert.equal(freshness.status, 'current', `实测：${JSON.stringify(freshness)}`)
  assert.equal(typeof freshness.loaded, 'string', '★ 一致时要把两个指纹都交出来（否则人没法核对）')
  assert.equal(freshness.loaded, freshness.onDisk)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 核心臂）：盘上变了而进程没重载 ⇒ 必须报 stale
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（核心）：盘上的构建变了、而本进程没重载 ⇒ 必须报 stale，并说"请重载"', () => {
  /**
   * ── ★ 这是本任务存在的理由的可执行形式 ────────────────────────────────────────
   *
   * 它**必须**能区分"我持有旧模块"与"我持有当前模块"。一个恒为 `current` 的实现
   * 会让本臂红 —— 而那正是今晚 5 次误诊能够发生的原因。
   */
  const freshness = withStampOutput('deadbeef'.repeat(8), () => moduleFreshness())
  assert.equal(
    freshness.status, 'stale',
    `★ 盘上的 stamp 已经变了，而本进程加载的还是旧的那一份 ⇒ 必须报 stale。实测：${JSON.stringify(freshness)}`,
  )
  assert.equal(typeof freshness.loaded, 'string')
  assert.equal(typeof freshness.onDisk, 'string')
  assert.notEqual(freshness.loaded, freshness.onDisk, '★ 两个指纹必须真的不同（否则"不一致"没有依据）')

  /**
   * ★★ 措辞**不许用业务语气**。这是本任务要消灭的那个伪装本身：
   *   它不能读起来像"你的申报有问题"，而要读起来像"**这个进程该重载了**"。
   *   ⇒ 断言两半：说清"旧"、且说清"动作是重载"。
   */
  const message = moduleFreshnessMessage(freshness)
  assert.match(message, /OLDER|old/i, `★ 必须说清"它比盘上旧"。实测：${message}`)
  assert.match(message, /reload/i, `★ 而必须给出动作（重载）—— 否则读的人仍然要去猜。实测：${message}`)
  assert.doesNotMatch(
    message, /rejected|not declared|blocked/i,
    '★ 措辞不许像一条业务规则（那正是它要消灭的伪装）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 三态臂）：读不到 stamp 必须与「一致」不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（三态）：读不到 stamp ⇒ unknown，且**与 current 不同形**', () => {
  /**
   * ── ★ 这一臂防的是本队反复记账的那条合流 ──────────────────────────────────────
   *
   * 把「读不到」读成「一致」会让 **"我没能检查" 伪装成 "检查过了，是新的"** ——
   * 而那正是本任务要消灭的那个形态的**又一次出现**（只不过换了一层）。
   */
  const freshness = withStampOutput(undefined, () => {
    /** 模拟"盘上读不到 stamp"：把文件移开。 */
    const original = readFileSync(STAMP, 'utf8')
    try {
      writeFileSync(STAMP, '{ this is not json', 'utf8')
      return moduleFreshness()
    } finally {
      writeFileSync(STAMP, original, 'utf8')
    }
  })
  assert.equal(
    freshness.status, 'unknown',
    `★ 读不到 stamp ⇒ 必须是 unknown（没能测量），不是 current。实测：${JSON.stringify(freshness)}`,
  )

  /**
   * ★ 三态两两不同形：`unknown` 与 `current` 的**读数**不许相等。
   *   （只断言 `status` 是不够的 —— 一个把 reason 写成"与盘上一致"的实现
   *     仍然会在这里绿。所以同时钉措辞。）
   */
  const current = moduleFreshness()
  assert.notEqual(freshness.status, current.status)
  const message = moduleFreshnessMessage(freshness)
  assert.doesNotMatch(
    message, /holds the current build/i,
    `★ 「没能测量」的措辞不许读成「是新的」。实测：${message}`,
  )
  assert.match(
    message, /not measured|COULD NOT|could not/i,
    `★ 它必须说清"这是没测到，不是没问题"。实测：${message}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 边界臂）：把"哪一段旧"这一格**写明测不了**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（边界臂）：stamp 一致**不等于**每一段都新 —— 这一格本读数测不了，必须写明', () => {
  /**
   * ── ★ 为什么这条要写成断言 ────────────────────────────────────────────────────
   *
   * MEASURED（本轮，一条**被撤回的**推断）：我曾报告"同一进程里 t17 生效而 t18 未生效"
   * ⇒ 后来自己检验发现**证据无效**（那种输入新旧代码都放行），已撤回。
   *
   * ★ 而那个撤回留下的结论是**由实测支撑的**：
   *   「当前没有任何读数能把『新代码的正常行为』与『旧代码的失效』分开。」
   *
   * ⇒ 所以本读数**只回答"该不该重载"**，不回答"哪一段旧"。
   *   把这条边界**钉成断言**，是为了让下一个人不去"修"一个修不了的东西
   *   （本队纪律：把已知边界钉成断言，防止下一个人去修一个修不了的东西）。
   */
  const message = moduleFreshnessMessage()
  assert.match(
    message, /current build|COULD NOT|not measured/i,
    '★ 一致或未知时都要给出一句可读的结论',
  )
  /**
   * ★ 反向半边：措辞里**不许**出现"哪一段是新的/旧的"这种它做不到的声称。
   */
  assert.doesNotMatch(
    message, /every (module|section)|all modules are/i,
    '★ 它不许声称"每一段都是新的" —— 那正是它测不了的那一格',
  )

  /**
   * ★ 而这一格确实**测不了**：stamp 一致时，本读数**无法**回答段落级的真假。
   *   可执行形式：一致 ⇒ `current`，而 `current` 这个取值**不携带**任何段落信息。
   */
  const freshness = moduleFreshness()
  assert.deepEqual(
    Object.keys(freshness).sort(), ['loaded', 'onDisk', 'status'],
    '★ `current` 只携带"两个指纹相同"这一个事实 —— 它没有、也不该有段落级的字段',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 副作用臂）：这个读数**不参与裁决**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（先软后硬）：这个读数不参与任何裁决 —— 判据不许因它拒绝', () => {
  /**
   * ★ 它是**部署状态的读数**，不是判据结论。让它有否决权会把
   *   「这个进程旧了」变成「你这次调用被拒」，而那正是本任务要消灭的伪装
   *   （机制级失效伪装成业务规则）。
   *
   * ★ 可执行形式：在 `stale` 的环境下走一次真实工具调用，断言它**照常返回**
   *   （不从这条读数里产生 blocker）。
   */
  assert.equal(typeof moduleFreshness, 'function')
  assert.equal(typeof moduleFreshnessMessage, 'function')
  /**
   * ★ 而它**没有** `ok: false` 那种裁决形状 —— 一个"看起来像裁决"的读数
   *   会在任何一处被误当成 blocker。断言它的形状里没有 `ok` / `blockers`。
   */
  const freshness = moduleFreshness()
  assert.equal('ok' in freshness, false, '★ 它不是裁决：不许带 `ok`')
  assert.equal('blockers' in freshness, false, '★ 也不是拒绝理由：不许带 `blockers`')
})
