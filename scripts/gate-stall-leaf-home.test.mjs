/**
 * ── C1 判据的【叶子的家】（t24）─────────────────────────────────────────────────
 *
 * 契约：把 stall 判据搬进一个**叶子模块**，好让**判据层**与**工具层**
 * 共用**一份**实现而不成环。
 *
 * ── ★★★ 它防的是什么（MEASURED，t6 的持有者先撞上、t24 逐条复现）──────────────
 *
 * 判据原先住在 `src/tools/shared/entities.ts`。而判据层的 `runtime/stall.ts`
 * **要用它**，于是只有两条路：
 *
 *     runtime/stall.ts -> tools/shared/entities.ts -> gates/index.ts -> runtime/stall.ts
 *                                                       ↑ 成环
 *
 *   · 复制一份 ⇒ **第二个真相**（本仓反复记账的形态：两份判据会随改动分叉，
 *     而分叉后的两次读数在断言层面同形）；
 *   · 直接 import ⇒ **成环**，且会破掉一条承重的不变量（见臂 4）。
 *
 * ⇒ 修法是把判据搬到双方都能 import 的**叶子**上（`src/types.ts`，零 import）。
 *
 * ── ★★★ 本文件的五条臂对应契约的五条 acceptance，一条不落 ────────────────────────
 *
 *   臂 1  搬家**不改行为**（同一批输入给出逐字相同的裁决）—— 这是"搬家"这个词的全部内容
 *   臂 2  判据层真的 import 得到它，且**不成环**（在真子进程里读一个环检测读数）
 *   臂 3  **不许有第二份实现**（扫全仓，计数判据只被实现过一次）
 *   臂 4  叶子**仍然是叶子**（`src/types.ts` 零 import）—— ★ 这是最容易被破坏的一条
 *   臂 5  C1 的调用点**一个字没改**也照常拿得到（重导出的接线活着的）
 *
 * ── ★★ 为什么臂 4 是本文件最值钱的一条 ──────────────────────────────────────────
 *
 * `src/types.ts` 之所以能同时被 `gates/` 与 `tools/` import，**只因为**它没有任何 import。
 * ⇒ 有人往里加**一行** import（哪怕是一行 `import type`），这个叶子就变成图上的一个节点，
 *   而那个环会在**下一层**重新长出来 —— 报错会指向别的文件，读的人不会想到这里。
 * ★ 这正是本仓反复记的那条形态：**一个机制成立的前提，如果没有一条臂直接读它，
 *   那么它会在无人注意时失效**（t79 记过同一形状：前置条件藏在调用序列里，没人直接断言它）。
 *
 * ── ★ 怎么跑"环检测"：用**真的子进程**，不是读源码猜 ────────────────────────────
 *
 * 见臂 2 的长注释：源码里"看起来没有环"与"运行期真的加载得起来"是两件事
 * （本仓 t79 那条教训：「动作发生了」与「事实建立了」不同形）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ★ 仓库根。
 *   ★★ 注意这个写法：`new URL('..', import.meta.url)` —— 第二个参数必须是
 *      **文件自己的 URL**。写成 `new URL('./', import.meta.url)` 再 `..` 会少一级
 *      （会得到 `<repo>/scripts/`），于是下面那个 walk 会在 `<repo>/scripts/src`
 *      上扫、扫到零个文件，而"零个"恰好是本臂**期望**的读数
 *      ⇒ 一个把根算错的实现会**恒绿**。MEASURED（本臂第一版就是这样）。
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TYPES_SRC = join(REPO_ROOT, 'src', 'types.ts')
const ENTITIES_SRC = join(REPO_ROOT, 'src', 'tools', 'shared', 'entities.ts')

/** 造一份"上一次的 stall 读数"。 */
const prev = (gate, point, count) => ({ gate, point, state: 'trying', count, at: 1 })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★★★ 搬家臂）：同一批输入 ⇒ 逐字相同的裁决
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1：判据住进了叶子 —— 且同一批输入给出（与搬家前）逐字相同的裁决', async () => {
  /**
   * ── ★ 搬家这件事的全部内容就是"行为不变" ─────────────────────────────────────
   *
   * 契约原话：「no behaviour changes -- the same inputs yield the same verdicts
   * as before the move」。
   * ★ 而"before the move"那一份**已经不在树里了**（那正是搬家的意思）⇒ 判据必须是
   *   **从两个入口各拿一次、彼此比对**：真身（`src/types.ts`）与转交口
   *   （`src/tools/shared/entities.ts`）。两者若给出不同裁决，搬家就改变了行为。
   */
  const truth = await import('../lib/types.js')
  const relay = await import('../lib/tools/shared/entities.js')

  /** ★ 前置：两个入口都要真的交出这个函数（少一个，下面测的就是 undefined）。 */
  assert.equal(typeof truth.observeStall, 'function', '★ 真身（lib/types.js）必须导出 observeStall')
  assert.equal(typeof relay.observeStall, 'function', '★ 转交口（entities）必须**仍然**导出 observeStall')
  assert.equal(
    truth.observeStall, relay.observeStall,
    '★★★ 两个入口必须交出**同一个函数对象** —— 若是两份不同的实现，'
    + ' "共用一份实现"这句话就是假的（而那正是本任务要消灭的第二个真相）',
  )

  /**
   * ── 用例表：覆盖判据的**每一条分支**，而不只是"跑一次不炸" ────────────────────
   *
   * ★ 三类输入各自必须不同形（这就是判据的三态）：
   *   ① 读不出 gate      ⇒ `unknown`（★ 不许并进另外两态）
   *   ② 换了判据/位置    ⇒ `first`（不算重复）
   *   ③ 同一 (gate,point) ⇒ `repeated`（够了次数）
   */
  const cases = [
    ['读不出 gate ⇒ unknown', [undefined, undefined, 'completion'], { stalled: false, count: 1, basis: 'unknown' }],
    ['空白 gate   ⇒ unknown', [undefined, '   ', 'completion'], { stalled: false, count: 1, basis: 'unknown' }],
    ['第一次        ⇒ first', [undefined, 'completion.mutation', 'completion'], { stalled: false, count: 1, basis: 'first' }],
    ['换判据        ⇒ first', [prev('completion.mutation', 'completion', 1), 'completion.backtest', 'completion'], { stalled: false, count: 1, basis: 'first' }],
    ['换位置        ⇒ first', [prev('completion.mutation', 'completion', 1), 'completion.mutation', 'contract'], { stalled: false, count: 1, basis: 'first' }],
    ['同一判据第 2 次 ⇒ repeated', [prev('completion.mutation', 'completion', 1), 'completion.mutation', 'completion'], { stalled: true, count: 2, basis: 'repeated' }],
    ['同一判据第 3 次 ⇒ repeated', [prev('completion.mutation', 'completion', 2), 'completion.mutation', 'completion'], { stalled: true, count: 3, basis: 'repeated' }],
    ['阈值 N=3 而第 2 次 ⇒ first', [prev('completion.mutation', 'completion', 1), 'completion.mutation', 'completion', 0, 3], { stalled: false, count: 2, basis: 'first' }],
  ]
  for (const [label, args, expected] of cases) {
    const fromTruth = truth.observeStall(...args)
    const fromRelay = relay.observeStall(...args)
    assert.deepEqual(fromTruth, expected, `★ 「${label}」的裁决必须逐字如此。实测：${JSON.stringify(fromTruth)}`)
    assert.deepEqual(fromRelay, expected, `★ 而转交口给出的必须是**同一个**裁决。实测：${JSON.stringify(fromRelay)}`)
  }

  /** ★ 阈值与它的读法也一起搬了 —— 且两个入口同源。 */
  assert.equal(truth.STALL_REPEAT_THRESHOLD, 2, '★ N 的缺省仍然是 2（搬家不改缺省）')
  assert.equal(relay.STALL_REPEAT_THRESHOLD, 2)
  assert.equal(truth.stallRepeatThreshold({}), 2, '★ 空环境 ⇒ 缺省')
  assert.equal(truth.stallRepeatThreshold({ AGENT_TEAMS_STALL_REPEAT_THRESHOLD: '4' }), 4, '★ N 仍然可注入')
  assert.equal(truth.stallRepeatThreshold({ AGENT_TEAMS_STALL_REPEAT_THRESHOLD: '0' }), 2, '★ 坏值仍然回落缺省')
  assert.equal(relay.stallRepeatThreshold({ AGENT_TEAMS_STALL_REPEAT_THRESHOLD: '4' }), 4, '★ 转交口也是同一个读法')

  /**
   * ── ★★ 反向半边：搬家**不是**把判据换成别的算法 ────────────────────────────────
   *
   * 一个"搬家后恒返回 first"的实现会让上面每一格都红 —— 但一个"搬家后**恒**返回
   * 与预期相同"的实现是测不出来的。⇒ 所以这里再钉一条**判别性**：三态必须两两不同。
   */
  const a = truth.observeStall(undefined, 'completion', 0, 'g')
  const b = truth.observeStall(prev('g', 'completion', 1), 'g', 'completion')
  const c = truth.observeStall(undefined, 'completion', 0)
  assert.notDeepEqual(a, b, '★★ first 与 repeated 必须不同形')
  assert.notDeepEqual(a, c, '★★ first 与 unknown 必须不同形')
  assert.notDeepEqual(b, c, '★★ repeated 与 unknown 必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 无环臂）：判据层真的 import 得到它，且**真的加载得起来**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2：判据层 import 判据 ⇒ **不成环**（在真子进程里读一个模块图读数）', () => {
  /**
   * ── ★ 为什么必须在**真子进程**里读，而不是读源码猜 ──────────────────────────────
   *
   * 源码里"看起来没有环"与"运行期真的加载得起来"是**两件不同的事**（本仓 t79 记过
   * 同一形状：「动作发生了」与「事实建立了」不同形）。而 ESM 的环**未必**当场抛错 ——
   * 它常常表现为**某一格在初始化时是 `undefined`**，那比抛错更难发现。
   *
   * ⇒ 做法：造一个**临时模块**，它照着将来 `runtime/stall.ts` 的样子 ——
   *   `import { observeStall } from '<repo>/src/types.ts'` —— 然后**真的跑它、真的用那个函数**。
   *   ★ 断言的不只是"没抛错"，而是**那个函数真的能用**（返回值对）。
   */
  const probe = `
import { observeStall, STALL_REPEAT_THRESHOLD, stallRepeatThreshold } from ${JSON.stringify(TYPES_SRC)}
// ★ 用一次，证明它是**真的函数**而不是环造成的 undefined
const verdict = observeStall({ gate: 'g', point: 'completion', state: 'trying', count: 1, at: 1 }, 'g', 'completion')
process.stdout.write(JSON.stringify({ verdict, threshold: STALL_REPEAT_THRESHOLD, injected: stallRepeatThreshold({ AGENT_TEAMS_STALL_REPEAT_THRESHOLD: '5' }) }))
`
  /**
   * ★ 用 `--input-type=module` 跑一段**真的 ESM**（与判据将来被 import 的方式同形）。
   *   ★ 而它必须从**仓库根**跑，好让 `src/types.ts` 的相对 import 解析得对。
   */
  const run = spawnSync('node', ['--input-type=module', '-e', probe], {
    encoding: 'utf8', cwd: REPO_ROOT,
  })
  assert.equal(
    run.status, 0,
    `★★★ 判据层必须能 import 判据而**不炸**。实测 exit=${run.status} · stderr=${String(run.stderr).slice(0, 600)}`,
  )
  const out = JSON.parse(run.stdout)
  assert.deepEqual(
    out.verdict, { stalled: true, count: 2, basis: 'repeated' },
    '★★ 而且它必须是**真的能算**的函数（环会让它在初始化时是 undefined，那比抛错更难发现）',
  )
  assert.equal(out.threshold, 2, '★ 常量也一起拿得到')
  assert.equal(out.injected, 5, '★ 注入口也一起拿得到')

  /**
   * ── ★★ 反向半边：那个**曾经的**环路线必须真的是环 ───────────────────────────────
   *
   * 缺了这一半，本臂可能只是"某个路径恰好能跑"。⇒ 这里断言
   * `src/tools/shared/entities.ts` **确实** import 了 `gates/index.ts` ——
   * 也就是说，"判据住在 entities.ts 里"这件事**今天仍然是成环的**，
   * 因此这次搬家是**必要的**，而不是一次风格调整。
   */
  const entities = readFileSync(ENTITIES_SRC, 'utf8')
  assert.match(
    entities, /from '\.\.\/\.\.\/gates\/index\.ts'/u,
    '★★ 反向半边：entities.ts 必须**确实** import 判据层（否则环不存在，'
    + ' 而这次搬家就不是必要的 —— 本条用来证明"必要性"不是推想的）',
  )
  assert.match(
    readFileSync(join(REPO_ROOT, 'src', 'gates', 'index.ts'), 'utf8'), /from '\.\/runtime\//u,
    '★★ 而判据层必须**确实** import 它的运行时判据（环的另一半）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★★ 单份实现臂）：全仓只许有**一份**计数判据
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3：全仓只许有**一份**计数判据 —— 第二份实现必须让本臂红', () => {
  /**
   * ── ★ 契约原话：「No second implementation of the counting judgement exists
   *   anywhere in the tree」────────────────────────────────────────────────────
   *
   * ★ 而"没有第二份"这件事**必须扫出来**，不能用"我记得我只写了一份"来担保 ——
   *   那是一条靠记忆的规则，而本仓反复证明这类规则会腐烂。
   *
   * ── 判据：`export function observeStall(` 这个**声明**在全仓只许出现一次 ────────
   *
   * ★ 用**声明**而不是用名字：`observeStall` 这个名字会出现在 import、重导出、
   *   JSDoc 里（那些都**应该**出现）。真正的"第二份实现"是**又一个函数体**。
   */
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(ts|mjs|js)$/.test(entry.name)) continue
      if (/_test\.|\.test\./.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      /** ★ 允许 JSDoc 提到它，所以只找**声明**。 */
      if (/export\s+function\s+observeStall\s*\(/u.test(text)) {
        /**
         * ★ 报**相对路径**（`src/types.ts`）而不是绝对路径 ——
         *   绝对路径会让这条断言在另一台机器上因为前缀不同而红，
         *   而那时红出来的东西与"多了一份实现"毫无关系。
         *   ★ 用 `relative()` 而不是字符串切片：切片对尾斜杠敏感，
         *     而"多一个斜杠就少切一个字符"这种错**看起来像**一条真读数。
         */
        hits.push(relative(REPO_ROOT, full))
      }
    }
  }
  walk(join(REPO_ROOT, 'src'))

  assert.deepEqual(
    hits, ['src/types.ts'],
    '★★★ 计数判据的**实现**必须恰好有一份，且住在叶子里。'
    + ` 实测：${JSON.stringify(hits)} —— 多一份就是第二个真相，`
    + ' 两份会随下一次改动分叉，而分叉后的两次读数在断言层面同形',
  )

  /**
   * ── ★★ 反向半边：那个"唯一的实现"必须**不是**一行空壳 ─────────────────────────
   *
   * 一个把 `observeStall` 写成 `return { stalled: false, count: 0, basis: 'first' }`
   * 的实现同样只会出现一次 —— 而它把判据删掉了。
   * ⇒ 所以要断言那段实现**真的含有判据的三个要点**（读不出 id / 比 gate+point / 比阈值）。
   */
  const impl = readFileSync(TYPES_SRC, 'utf8')
  for (const [what, pattern] of [
    ['读不出判据 id ⇒ 第三态', /gate\s*===\s*undefined/u],
    ['同时比较 gate 与 point', /previous\.point\s*===\s*point/u],
    ['按阈值判"停住"', /count\s*>=\s*threshold/u],
  ]) {
    assert.match(impl, pattern, `★★ 那唯一的实现里必须真的含有「${what}」—— 否则"只有一份"这句话说的是一个空壳`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★★ 叶子臂）：`src/types.ts` **零 import** —— 这次搬家成立的**前提**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（前提臂）：`src/types.ts` 仍然**零 import** —— 一行 import 就会让环在下一层重新长出来', () => {
  /**
   * ── ★ 为什么这一条是本文件最值钱的一条 ─────────────────────────────────────────
   *
   * `src/types.ts` 同时被 `gates/**` 与 `tools/**` import，**只因为它没有任何 import**。
   * ⇒ 加一行 import（哪怕 `import type`）就把这个叶子变成图上的一个节点，
   *   而环会在**下一层**重新长出来 —— 报错会指向别的文件，读的人根本不会想到这里。
   *
   * ★★ 本仓记过同一形状（t79）：**一个机制成立的前提，如果没有一条臂直接读它，
   *   它会在无人注意时失效**。⇒ 所以这里直接读它，而不是把它写进注释里当忠告。
   *
   * ★ 判据是机械的：逐行扫出所有 `import` / `export … from` 语句，**必须一条都没有**。
   */
  const source = readFileSync(TYPES_SRC, 'utf8')
  const importLines = source.split('\n')
    .map((line, index) => ({ line: line.trim(), no: index + 1 }))
    .filter(({ line }) => /^import[\s{*'"]/u.test(line) || /^export\s+(type\s+)?\{[^}]*\}\s+from\s/u.test(line))

  assert.deepEqual(
    importLines, [],
    '★★★ `src/types.ts` 必须**一条 import 都没有** —— 它是叶子这件事**只因为**这一点。'
    + ' 加一行就会让判据层与工具层之间那个环在下一层重新长出来'
    + ` （而报错会指向别的文件）。实测这些行：${JSON.stringify(importLines)}`,
  )

  /**
   * ── ★ 反向半边：它必须**真的有内容** ───────────────────────────────────────────
   *
   * 一个空文件同样零 import —— 而那会让上面那条断言恒真，
   * 也会让"判据住在这里"这句话变成假话。
   */
  assert.match(source, /export\s+function\s+observeStall\s*\(/u, '★★ 零 import 的那个文件必须**真的**装着判据')
  assert.match(source, /export\s+interface\s+TaskStall\b/u, '★ 而且类型也还在这里（类型与它的观察者同处一室）')
  assert.ok(source.length > 2000, `★ 它必须是一份真的模块（实测 ${source.length} 字符）`)

  /**
   * ── ★★★ 对照读数（让本臂**有分辨力**）────────────────────────────────────────
   *
   * 上面那条断言的形式是"扫出来的清单为空"。而**任何**扫描错误的实现（正则写错、
   * 路径错了、读的是空文件）都会给出空清单 —— 于是本臂会**恒绿**。
   * ⇒ 所以拿一个**确实有 import** 的文件跑同一个扫描，断言它**非空**。
   *   这一条把"这个方法真的看得见 import"变成读数，而不是假设。
   */
  const controlSource = readFileSync(ENTITIES_SRC, 'utf8')
  const controlHits = controlSource.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^import[\s{*'"]/u.test(line) || /^export\s+(type\s+)?\{[^}]*\}\s+from\s/u.test(line))
  assert.ok(
    controlHits.length > 0,
    '★★★ 对照读数：同一个扫描在 entities.ts（**确实有** import）上必须**非空** —— '
    + '若它也是空的，说明扫描本身坏了，而本臂的绿是假绿',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 接线臂）：C1 的调用点**一个字没改**也照常拿得到
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：C1 的调用点仍然 import 得到（转交口活着，且是重导出不是第二份）', () => {
  /**
   * ★ 契约原话：「C1's existing call sites point at the relocated criterion」。
   *   ⇒ 最省的实现是**重导出**，于是 `src/tools/update-task.ts` 一个字都不用改。
   *   ★ 而"一个字都不用改"这件事本身是可断言的：那个文件今天仍然 import 那几个名字
   *     **从 entities.ts**（而不是从 types.ts）。
   */
  const updateTask = readFileSync(join(REPO_ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  assert.match(
    updateTask, /from '\.\/shared\/entities\.ts'/u,
    '★ C1 的调用点必须仍然从 entities.ts 拿（搬家的省法就是重导出，改调用点是没必要的 churn）',
  )
  for (const name of ['noteStall', 'clearStall']) {
    assert.match(updateTask, new RegExp(`\\b${name}\\b`, 'u'), `★ 它仍然要用 ${name}（那是 C1 的另一半，没有搬）`)
  }

  /** ★ 而转交必须是**重导出**（`export … from`），不是 `import` + 再 `export` 一个副本。 */
  const entities = readFileSync(ENTITIES_SRC, 'utf8')
  assert.ok(
    /export\s*\{[^}]*\bobserveStall\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/types\.(ts|js)['"]/u.test(entities),
    '★★ 转交口必须写成 `export { … } from "../../types.ts"`（**纯转交**）。'
    + ' 写成 `import` + 再 `export` 会多一个本地绑定，读的人会以为"它住在这里、只是从别处拿的"',
  )
  /**
   * ★★ 而 `noteStall` / `clearStall` **没有**搬走 —— 它们写的是**任务记录**
   *   （`task.stall`），属于状态层，判据层不需要、也不该拿得到它们。
   *   ⇒ 断言它们**仍然**在 entities.ts 里被**声明**。
   */
  assert.match(
    entities, /export\s+function\s+noteStall\s*\(/u,
    '★ noteStall 必须**留在** entities.ts —— 它写任务状态，判据层不该拿到它',
  )
  assert.match(entities, /export\s+function\s+clearStall\s*\(/u, '★ clearStall 同理')
  assert.doesNotMatch(
    readFileSync(TYPES_SRC, 'utf8'), /export\s+function\s+(noteStall|clearStall)\s*\(/u,
    '★★ 而它们**不许**跟着搬进叶子 —— 叶子只装纯判据，不装状态写入',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★ 产物臂）：搬家的产物真的落在 `lib/`（免得"源码搬了、产物没搬"）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：产物在 `lib/` 里也对得上 —— `lib/types.js` 真的导出判据，且 lib 侧无环', () => {
  /**
   * ★ 源码搬了而产物没搬，会让**运行期**用的仍是旧位置 ——
   *   而那种失灵在"读源码"的臂里**完全看不见**（本仓记过"进程持有旧模块"那族）。
   *   ⇒ 所以直接读**产物**。
   */
  const libTypes = join(REPO_ROOT, 'lib', 'types.js')
  assert.ok(existsSync(libTypes), '★ `lib/types.js` 必须存在（搬家之后它不再只是类型声明，而有了运行期内容）')
  const produced = readFileSync(libTypes, 'utf8')
  assert.match(produced, /function observeStall/u, '★★ 产物里必须真的有 `observeStall`')
  assert.match(produced, /STALL_REPEAT_THRESHOLD/u, '★ 而常量也在')

  /** ★ 而转交口在产物里也必须是**重导出**（`export { … } from`），不是一份拷贝。 */
  const libEntities = readFileSync(join(REPO_ROOT, 'lib', 'tools', 'shared', 'entities.js'), 'utf8')
  assert.ok(
    /export\s*\{[^}]*\bobserveStall\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/types\.(ts|js)['"]/u.test(libEntities),
    '★★ 产物里的转交口也必须是重导出 —— 否则运行期真的有两份实现，而源码看起来只有一份。'
    + ` 实测产物里的转交行：${(libEntities.split('\n').find((l) => /export\s*\{[^}]*observeStall/u.test(l)) ?? '(找不到)').slice(0, 200)}`,
  )
  assert.doesNotMatch(
    libEntities, /export\s+function\s+observeStall\s*\(/u,
    '★★★ 而产物里**不许**再有一份 `observeStall` 的实现 —— '
    + '源码里删掉了而产物里留着，正是"两份实现"最隐蔽的一种',
  )
})
