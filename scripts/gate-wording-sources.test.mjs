/**
 * ── j-0007 判据化：一句描述机制行为的话，可以从未被兑现过 ────────────────────────────
 *
 * ── 它防的是什么（两个真实实例，今晚各出现过一次）────────────────────────────────
 *
 * ① **t56**：`changed-paths.ts` 的拒绝消息里写着
 *
 *     `…not in any of the ${ctx?.observedWorkspaces ?? 1} workspace(s) that were checked
 *       (the main workspace and every member worktree under it)`
 *
 *   而 `observedWorkspaces` **从来没有被任何地方赋过值** ⇒ 恒 `undefined`
 *   ⇒ `?? 1` **恒取 1**。
 *
 *   ★ 于是那句"扫了 N 处"里的 N 是一个**硬编码的兜底值**，
 *     而那句括号是**一句从未兑现的承诺**：它声称扫过成员 worktree，而代码里没有那件事。
 *
 * ② **t73**：`kind-requirements.json` 的 `verification` 一节，
 *   `requiredGates` 说要 `r5`，而同一行的 `because` 说不要。
 *   ★ 那一次不是"两个值冲突"，是**数据与它自己的理由互相否**。
 *
 * ── ★★ 判据的形状（这正是它最窄、最可机械判定的原因）────────────────────────────
 *
 * 问：**那句话里的每个值，能不能指出它【由谁赋值】？**
 *
 *     能（有赋值点）                      ⇒ 合格
 *     不能、而兜底值是字面量               ⇒ **blocked**（那就是缺陷）
 *     无法判断（赋值是动态的 / 名字太泛）  ⇒ **第三态**，如实报
 *
 * ★ 而"谁给它赋的值"是**可查的**（grep 那个属性路径的赋值点）——
 *   这就是这条判据比"措辞好不好"窄得多、也硬得多的原因。
 *
 * ── ★★ 为什么必须有三态（否则会误伤）────────────────────────────────────────────
 *
 * 一个只判"有没有赋值点"的实现会把 `task?.kind ?? 'unspecified'` 也判红 ——
 * 而那一格**合理**：`kind` 是可选字段，`'unspecified'` 是一个诚实的兜底。
 * ⇒ 缺陷的形状**不是**"用了 `??` 字面量"，而是：
 *
 *     那句话声称了一件【关于机制做过什么】的事，而那个值**没有任何来源**
 *
 * ★ 所以本判据的第三态不是礼貌，是**精度**：它拒绝把"我查不清"判成"它错了"。
 *
 * ── ★★★ 附条件（写进判据本身，不靠使用的人记得）────────────────────────────────
 *
 * 用户 2026-10-08 的标准：「特定条件下起效的也能加，只是需要把那些特定条件顺便加上去。」
 *
 * ⇒ 本判据**只在**下列条件成立时适用（`appliesTo` 逐条写死，见下）：
 *   (a) 那个 `${…?? literal}` 出现在**面向人的措辞**里（拒绝消息 / 日志 / 状态行）；
 *   (b) 被兜底的是一条**属性路径**（`a?.b ?? x`），而不是裸局部变量；
 *   (c) 那条路径的**根对象**在本仓里可解析（即它是本仓产出的 ctx / 返回值，
 *       而不是宿主注入的、仓外的东西）。
 *
 * ★ 条件 (c) 是**必须**的：本仓看不到宿主给 `ctx` 里塞了什么，
 *   一个"仓外来源"被判红就是**误伤**。⇒ 判据对这种情形说 `unreadable`，而不是 blocked。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ── ★★★ t86：读数面换成 t39 的**统一口径** ────────────────────────────────────
 *
 * MEASURED：本文件此前 `readFileSync(join(ROOT, 'src/tools/update-task.ts'))`
 * 去找 `observedWorkspaces:` 的赋值点。而 t70 把 update-task.ts 拆了 ——
 * ★ 那一行的赋值点现在住在 **`src/tools/update-task/dispatch.ts:114`**。
 *
 * ★ 而 `toolsSource()` 是 **`src/tools/**` 的递归** ⇒ 它自动涵盖拆分后的新文件。
 *   ⇒ 换面之后那条断言**原样通过**（它问的东西一个字没变：
 *     "那个赋值点的右边有没有来源"）—— 这正是 t39 修那 15 个夹具时的同一手法。
 *
 * ★★ 而**不许**改成 `readFileSync('…/update-task/dispatch.ts')`：
 *   那会把"同一件事"钉死在**某一个文件里**，而下一次拆分又会失效
 *   （那正是 t39 之所以建立统一口径的原因，也是本任务的反向半边）。
 */
import { toolsSource } from './tools-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归收集 `src/` 下的全部 TypeScript 源码。 */
function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
      } else if (entry.name.endsWith('.ts')) out.push(full)
    }
    return out
  }
  return walk(join(ROOT, 'src'))
}

/**
 * ── 去掉注释 ──────────────────────────────────────────────────────────────────
 *
 * ★ 必须两步（本队的"读错位置的出口"）：块注释 + **整行**行注释。
 *   ★ 而行尾注释（`foo() // ${x ?? 1}`）刻意**不**剥 —— 那种写法不存在于本仓，
 *     而剥它需要一个会被字符串字面量骗到的解析器。⇒ 宁可少剥不可乱剥。
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * ── 扫出全部 `… ?? <字面量>`，并解析出**被兜底的那条属性路径** ────────────────────
 *
 * ★ 返回的 `path` 是**去掉可选链与下标**后的属性路径（`ctx.observedWorkspaces`），
 *   因为"谁给它赋的值"要按那个名字去查。
 */
function scanFallbacks(source) {
  const hits = []
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    /**
     * ★ 只认**模板字面量里**的 `${…}`：那是"面向人的措辞"的落点。
     *   一条 `const x = a ?? 1` 不是措辞，本判据不管它（它有自己的读者）。
     */
    for (const match of line.matchAll(/\$\{([^{}]*?)\?\?\s*([^{}]*?)\}/g)) {
      const [, left, right] = match
      /**
       * ★ 粗筛：右边必须**真的像字面量**（数字 / 引号串 / 方括号）。
       *   `?? someFallback` 这种**有来源**的兜底不在本判据范围内。
       */
      const fallback = right.trim()
      if (!/^(\d[\d_]*|'[^']*'|"[^"]*"|`[^`]*`|\[\]|\{\})$/.test(fallback)) continue
      /**
       * ★★ 从左边解析**属性路径**：取最后一个标识符，并往前收 `.name` / `?.name`。
       *   ⇒ `ctx?.observedWorkspaces` → `ctx.observedWorkspaces`
       *     `ctx?.update?.changedPaths?.length` → `ctx.update.changedPaths.length`
       */
      const pathMatch = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*$/.exec(left.trim())
      const raw = pathMatch?.[1] ?? ''
      const path = raw.replace(/\?\./g, '.')
      hits.push({ line: index + 1, path, fallback, expression: match[0] })
    }
  }
  return hits
}

/**
 * ── 一条属性路径在**本仓**里有没有赋值点 ────────────────────────────────────────
 *
 * 三态（与判据自身的口径一致）：
 *   `assigned`   —— 找到至少一个 `…path…: <expr>` 的**对象字面量赋值**
 *   `unassigned` —— 找不到（**且**路径的根是本仓可达的 ⇒ 那是缺陷）
 *   `unreadable` —— 判不了（路径太短 / 根是宿主注入的 / 赋值是动态的）
 *
 * ★ 它必须区分"声明"与"赋值"：`observedWorkspaces?: number` 是**类型声明**，
 *   它**不**产生值。把声明当赋值 = 这条判据永远绿（本队记账的恒真写法）。
 */
function resolvePath(files, path) {
  const segments = path.split('.')
  /** ★ 根是 `ctx` / `task` / `update` 之类**宿主或调用方塞进来**的对象 ⇒ 判不了（附条件 c）。 */
  if (segments.length < 2) return { state: 'unreadable', reason: 'the defaulted value is a bare local, not a property path' }

  const leaf = segments[segments.length - 1]
  const assignments = []
  const dynamic = []
  /**
   * ── ★★ 被排除掉的那些"看起来像赋值点、其实是**类型产出面**"的行 ────────────────
   *
   * MEASURED（本判据第一版误报了 10 条）：`baseline.stdout ?? ''` 这类措辞里的
   * `.stdout` **确实有来源** —— 它来自一次真的子进程调用，
   * 而那个来源**以类型注解的形式**写在仓里：
   *
   *     runVerifyCommandCaptured(…): Promise<{ exitCode: number; stdout: string; … }>
   *
   * ⇒ 一个只认"对象字面量 `leaf:`"的检索会把它判成**没有来源**，而那是**误伤**：
   *   那条措辞说的是"我没读到 stdout 时显示空串"，而那一格**真的会产生**。
   *
   * ★ 而这两件事必须**不同形**（本判据的核心纪律）：
   *     无来源（缺陷）    —— 没有任何地方**产出过**这个值
   *     类型产出面（合格）—— 有地方**声明并返回**它（只是不是对象字面量赋值）
   */
  const typedProducers = []

  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const [index, line] of code.split('\n').entries()) {
      const at = `${file.replace(`${ROOT}/`, '')}:${index + 1}`
      /**
       * ── ★★ 赋值点 = 对象字面量里的 `leaf:` 或 `leaf =` ────────────────────────────
       *
       * ★ 而**类型**形状要排除。而这一步**比看起来难**（本判据第一版在这里误报了 10 条）：
       *
       * MEASURED：第一版只排除 `leaf: string|number|…` 与 `leaf?:`。于是
       * `runVerifyCommandCaptured(...): Promise<{ exitCode: number; stdout: string; … }>`
       * 这类**返回值类型注解**没被排除 —— 而它是类型的**产出面**，不是赋值。
       * ⇒ 判据说 `baseline.stdout ?? ''` **无来源**，而它其实**有**（来自一次真的子进程调用）。
       * ★ 那 10 条误报全是同一个形状：`.stdout` / `.stderr` / `.length`、`.length` 这些
       *   **由别处产出、经变量传过来**的字段。
       *
       * ⇒ 排除规则要更宽：**行内出现类型注解语法**（返回类型 / 泛型 / interface / type 声明）时，
       *   那一行不是赋值点 —— 但它是**一条产出面的证据**，记进 `typedProducers`。
       */
      const isTypeShape =
        new RegExp(`${leaf}\\s*\\?:`).test(line)
        || new RegExp(`${leaf}\\s*:\\s*(string|number|boolean|unknown|any|readonly)\\b`).test(line)
        || (/\)\s*:\s*/.test(line) && !/[:=]\s*\{/.test(line))
        || /Promise<|Record<|\binterface\b|^\s*(export\s+)?type\b/.test(line)
      if (isTypeShape) {
        /**
         * ── ★★ 但不是每一种"类型形状"都算产出面（本判据第二版在这里假阴性）────────────
         *
         * MEASURED：把 t56 的赋值点**删掉**（还原缺陷）之后，存量普查**仍然报"合格"** ——
         * 因为 `observedWorkspaces?: number` 这一行**类型声明**也被当成了产出面。
         *
         * ★ 而**声明不是产出**：`x?: number` 说的是"如果它在，它是数字"，
         *   它**不产生任何值**。把声明当来源 = 这条判据永远绿（本队记账的恒真写法）。
         *
         * ⇒ 只有**产出面**才算：
         *     · 返回值类型里的字段（`): Promise<{ stdout: string }>`）—— 那是一次真的产出
         *     · **不**包括可选的接口成员声明（`leaf?: T`）
         *     · **不**包括 `readonly` 成员声明
         */
        const isOptionalMemberDecl = new RegExp(`^\\s*(readonly\\s+)?${leaf}\\s*\\?:`).test(line)
        const isInterfaceMember = new RegExp(`^\\s*(readonly\\s+)?${leaf}\\s*:\\s*\\S`).test(line)
          && !/[=(]/.test(line.slice(0, line.indexOf(leaf)))
        if (!isOptionalMemberDecl && !isInterfaceMember && new RegExp(`(^|[^\\w$.])${leaf}\\b`).test(line)) {
          typedProducers.push(at)
        }
        continue
      }

      const assignment = new RegExp(`(^|[^\\w$.])${leaf}\\s*:`).test(line)
      if (assignment) { assignments.push(at); continue }
      /**
       * ── ★★ 动态赋值：必须引用**同一个根对象**（本判据第一版在这里假阴性）─────────
       *
       * MEASURED：第一版写的是 `${parent}[` —— 即只要行内出现 `anything[` 且带 `=`，
       * 就记成"这一格可能是动态赋值的"。
       *
       * ⇒ 于是**每一个**被兜底的路径都因为**别处**某一行无关的下标赋值而落 `unreadable`：
       *   我编造一个显然不存在的 `ctx.neverAssignedCount`，它竟报
       *   `"the only writes found are dynamic (…entities.ts:1020, :1025)"`。
       *   ★ 而那是一条**假阴性**：真正的缺陷会躲在一堆无关的下标操作后面，
       *     永远报"查不清"——比误报更危险，因为它**看起来像保守**。
       *
       * ⇒ 现在要求根对象**同名**：`ctx[...] = …` 才算 `ctx.x` 的动态赋值。
       */
      const root = segments[0]
      /**
       * ── ★★ 泛型写入（`ctx[key] = value`）不算"这一格有来源"（本判据第一版在这里假阴性）──
       *
       * MEASURED：`entities.ts` 里有一个**注入还原循环**（`ctx[key] = value`，`key` 是循环变量）。
       * 它**对任何** `ctx.*` 路径都为真 ⇒ 一个"只要有 `root[` 就算动态写入"的判据会
       * 把**每一个** `ctx.x` 都判成 `unreadable` —— 包括我编造的那个显然不存在的名字。
       *
       * ★ 而那是**假阴性**，比误报更危险：真正的缺陷会躲在这一层后面永远报"查不清"，
       *   而"查不清"读起来像**保守**（本队记账的"把没测到读成谨慎"）。
       *
       * ⇒ 判法：只有把 **leaf 名字本身**写进下标的（`ctx['leaf']` / `ctx[\`leaf\`]`）
       *   才算"这一格可能有动态来源"。泛型循环变量（`ctx[key]`）**不算** ——
       *   它是一条**还原**路径，不是那个值被**产生**的地方。
       */
      const namesLeaf = new RegExp(`${root}\\s*\\[\\s*['"\`]?${leaf}\\b`).test(line)
      if (namesLeaf && /=/.test(line)) dynamic.push(at)
    }
  }

  if (assignments.length > 0) return { state: 'assigned', sites: assignments }
  /**
   * ★★ 有**类型产出面** ⇒ 也算合格，但要说清是哪一种：
   *   它不是"对象字面量赋的值"，而是"某个函数**返回**了它"。
   *   ⇒ 两者都必须与"完全没有来源"不同形。
   */
  if (typedProducers.length > 0) return { state: 'assigned', sites: typedProducers, via: 'typed-producer' }
  if (dynamic.length > 0) return { state: 'unreadable', reason: `the only writes found are dynamic (${dynamic.slice(0, 2).join(', ')})` }
  return { state: 'unassigned' }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★★ 机制臂）：两个真实实例的形状 —— 无赋值点 + 字面量兜底 ⇒ blocked
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（★★ 机制臂）：一个【无赋值点】的属性路径被字面量兜底 ⇒ 判 blocked', async () => {
  /**
   * ── 这一臂把 t56 的形状变成可执行的 ────────────────────────────────────────────
   *
   * 它**不**在真实源码上跑（那一格现在是合格的，见臂 3 的存量读数）——
   * 它**构造**那个形状，证明判据抓得住它。
   *
   * ★ 构造是必须的：一个"只在真实实例存在时才红"的判据，在实例被修好之后
   *   就**再也没有证据**证明它还能工作。⇒ 用替身把它钉住。
   */
  const files = sourceFiles()
  const fixture = `
    const msg = \`not in any of the \${ctx?.neverAssignedCount ?? 1} workspace(s) that were checked\`
  `
  const hits = scanFallbacks(fixture)
  assert.equal(hits.length, 1, '★ 前置：替身里必须真的被扫出一条')
  assert.equal(hits[0].path, 'ctx.neverAssignedCount')
  assert.equal(hits[0].fallback, '1')

  /**
   * ★★ 而它在**本仓**里没有赋值点（这个名字是编的）⇒ `unassigned` ⇒ 那就是缺陷。
   *   ★ 这一条同时证明检测器**有分辨力**：一个真的存在的路径必须给出不同的读数（臂 2）。
   */
  const verdict = resolvePath(files, hits[0].path)
  assert.equal(
    verdict.state, 'unassigned',
    `★ 编造的无赋值点路径必须落 unassigned（实测：${JSON.stringify(verdict)}）——`
    + ' 而它正是 t56 的形状：那个数字是写死的兜底值',
  )
})

test('★★ 臂 2（★ 反向半边）：一个【真的有赋值点】的路径必须判 assigned', async () => {
  /**
   * ★ 缺了这一半，臂 1 在"什么都判 unassigned"的实现上照样绿。
   *
   * ★★ 而这里用的是**真实路径** `ctx.observedWorkspaces` —— 它正是 t56 那条，
   *   在被补上赋值点之后应当合格。⇒ 这一臂读的是**存量**，不是替身。
   */
  const files = sourceFiles()
  const verdict = resolvePath(files, 'ctx.observedWorkspaces')
  assert.equal(
    verdict.state, 'assigned',
    `★ t56 那一格（\`ctx?.observedWorkspaces ?? 1\`）现在【有】赋值点 ⇒ 必须合格。实测：${JSON.stringify(verdict)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 存量普查臂）：全仓如实报出有多少合格 / 多少不合格
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（★★ 存量普查臂）：全仓扫一遍，如实报出存量', async (t) => {
  /**
   * ── 契约要求"先跑一次全仓，把存量如实报出来"──────────────────────────────────
   *
   * ★ 而这一臂**不**断言"存量必须是 0" —— 那是把当下的快照写成不变量
   *   （本队记账过的棘轮）。它断言的是**形状**：每一个被扫到的格子都必须
   *   落到三态之一，且每一态的读数都能被读出来。
   *
   * ★★ 而它有一条**硬断言**：不合格的那些必须**在测试输出里被点名**。
   *   一个只报数字的普查会在数字变化时无人察觉。
   */
  const files = sourceFiles()
  const collected = []
  for (const file of files) {
    const rel = file.replace(`${ROOT}/`, '')
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const hit of scanFallbacks(code)) {
      collected.push({ file: rel, ...hit, verdict: resolvePath(files, hit.path) })
    }
  }

  assert.ok(
    collected.length >= 20,
    `★ 全仓只扫到 ${collected.length} 条 —— 这个扫描器本身可能失效了（空集合上"都没问题"是恒真的）`,
  )

  const byState = { assigned: [], unassigned: [], unreadable: [] }
  for (const item of collected) byState[item.verdict.state].push(item)

  /**
   * ★ 存量读数**如实打印**（这是本臂的主要产出，不是断言）。
   */
  t.diagnostic(
    `j-0007 存量普查：共 ${collected.length} 条 \`?? 字面量\` 措辞 —— `
    + `合格 ${byState.assigned.length} · **不合格 ${byState.unassigned.length}** · 无法判断 ${byState.unreadable.length}`,
  )
  for (const item of byState.unassigned) {
    t.diagnostic(`  ✗ 不合格：${item.file}:${item.line}  \`${item.path} ?? ${item.fallback}\``)
  }
  for (const item of byState.unreadable) {
    t.diagnostic(`  ? 无法判断：${item.file}:${item.line}  \`${item.path} ?? ${item.fallback}\`（${item.verdict.reason}）`)
  }

  /**
   * ★★ 硬断言：三态必须**互不同形**，且每一条都有归属。
   *   ★ 这一条防的是"扫描器把一切都归进 assigned"（那会让本判据恒绿）。
   */
  assert.equal(
    byState.assigned.length + byState.unassigned.length + byState.unreadable.length, collected.length,
    '★ 每一条都必须落到三态之一 —— 有漏网的说明分类不穷尽',
  )
  assert.ok(
    byState.unreadable.length > 0,
    '★ 第三态必须是**有人落的**（本仓确实有动态赋值与裸局部变量）——'
    + ' 若它恒为 0，说明这一态形同虚设，而"无法判断"会被静默并进某一态',
  )
  /**
   * ★ 而**不合格的那一格现在必须是 0** —— 不是"永远必须 0"，是**今天**的存量读数：
   *   t56 与 t73 两个实例都已被修（臂 2 与臂 5 各钉一个）。
   *   ★ 若将来有人引入新的无来源兜底，这一条会红，而红的信息里带着**哪一行**。
   */
  assert.deepEqual(
    byState.unassigned.map((x) => `${x.file}:${x.line} \`${x.path} ?? ${x.fallback}\``),
    [],
    '★ 仓库里出现了【无赋值点却被字面量兜底】的措辞 —— 那就是 j-0007：'
    + ' 一句描述机制行为的话从未被兑现，而它读起来与兑现了的一样。逐条见上方 diagnostic。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 三态臂）：三态两两不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（★ 三态臂）：assigned / unassigned / unreadable 两两不同形', async () => {
  /**
   * ★ "无法判断"必须是一条**真的出口**，而不是被并进某一态 ——
   *   否则一次仓外来源会被判成缺陷（**误伤**），而误伤的代价比漏报更贵。
   */
  const files = sourceFiles()
  const assigned = resolvePath(files, 'ctx.observedWorkspaces')
  const unassigned = resolvePath(files, 'ctx.definitelyNeverAssignedXyz')
  /** ★ 裸局部变量（长度 < 2）⇒ 判不了：那不属于"属性路径可查"的范围（附条件 b）。 */
  const unreadable = resolvePath(files, 'fallback')

  assert.equal(assigned.state, 'assigned')
  assert.equal(unassigned.state, 'unassigned')
  assert.equal(unreadable.state, 'unreadable')
  assert.equal(
    new Set([assigned.state, unassigned.state, unreadable.state]).size, 3,
    '★ 三态必须两两不同形',
  )
  assert.notDeepEqual(assigned, unassigned)
  assert.notDeepEqual(unassigned, unreadable, '★ "没有来源"与"查不清"必须不同形 —— 前者是缺陷，后者是精度')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★ 实例臂）：两个真实实例都必须处于"已修"的状态
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5a：实例①（t56）—— `ctx.observedWorkspaces` 的赋值点必须真的把值传进来', async () => {
  /**
   * ★ 这一臂比臂 2 更强：它不只问"有没有赋值点"，还问**那个赋值点的右边有没有来源**。
   *
   *   t56 的缺陷形态是"字段从未被赋值"；而**它的近亲**是"字段被赋了值，
   *   而那个值本身恒 undefined"（`observedWorkspaces: alwaysUndefined`）。
   *   ⇒ 两者在下游**同形**（都是 `?? 1` 恒取 1），所以都要被挡住。
   */
  /** ★ t86：统一口径（见文件头）—— 不再钉在 update-task.ts 上。 */
  const source = toolsSource()
  const line = source.split('\n').find((l) => /observedWorkspaces\s*:/.test(l) && !/\?:/.test(l))
  assert.notEqual(line, undefined, '★ 必须找到那一行的赋值点')

  /**
   * ★★ 右边**不许**是裸字面量 —— 那就等于把兜底值搬了个地方，而缺陷一个字没变。
   */
  const rhs = line.split(':').slice(1).join(':').trim()
  assert.doesNotMatch(
    rhs, /^\d+$/,
    `★ 赋值点的右边是一个**字面量**（\`${rhs}\`）—— 那不是赋值，那是把硬编码搬了个地方`,
  )
  /**
   * ★ 而它必须**能追溯到一次真的观察**：`observeWorkspaces(...)` 的返回。
   *   ⇒ 断言那一行引用了一个观察来源（而不是一个常量 / 一个未定义的名字）。
   */
  assert.match(
    rhs, /observ|workspace/i,
    `★ 赋值点的右边必须追溯到一次真的观察。实测：\`${rhs}\``,
  )
  /** ★ 反向半边：那个来源**真的存在**（不是一个编出来的名字）。 */
  const observSource = readFileSync(join(ROOT, 'src/harness-compat.ts'), 'utf8')
  assert.match(observSource, /export function observeWorkspaces/, '★ 观察来源必须真的在本仓里定义')
})

test('★★ 臂 5b：实例②（t73）—— kind-requirements 的 `verification` 一节，数据与理由不许互相否', async () => {
  /**
   * ── 那一格的形态（captain 的原话）：「不是冲突，是**数据与它自己的理由互相否**」───
   *
   *   `requiredGates` 说要 `r5`，而同一行的 `because` 说不要。
   *   ★ 两者**都在场**、都读得通、单独看都合理 —— 只有并排读才发现它们说的是两件事。
   */
  const raw = readFileSync(join(ROOT, 'src/gates/completion/kind-requirements.json'), 'utf8')
  const table = JSON.parse(raw)
  const entry = table.kinds.find((k) => k.kind === 'verification')
  assert.notEqual(entry, undefined, '★ 前置：表里必须有 verification 那一行')

  const gates = entry.requiredGates ?? []
  const because = String(entry.because ?? '')

  /**
   * ★★ 可机械判定的那一半：`because` 里**提到**的每一道门，都必须与 `requiredGates` 一致。
   *
   *   本判据只做**能机械判的那一半**：若理由里出现了 "r5" / "mutation" 这类门名，
   *   就断言它**在该门要求的名单里**，或**明确说了不要它**。
   *   ★ 而"明确说不要"是一个可判的正则（`no r5` / `not require` / `nothing … for r5`）——
   *     一个含糊的理由**不算**解释（它会被判红，而那正是我们要的：
   *     理由要么说清要，要么说清不要）。
   */
  const named = ['r5', 'mutation', 'backtest'].filter((gate) => new RegExp(`\\b${gate}\\b`).test(because))
  assert.ok(named.length > 0, '★ 前置：这一节的 because 必须提到至少一道门名（否则本臂没有可判的对象）')

  for (const gate of named) {
    const gateId = `completion.${gate}`
    const required = gates.includes(gateId)
    /** ★ 明确否定：`no r5` / `not … r5` / `nothing … r5` 之类。 */
    const denied = new RegExp(`\\b(no|not|nothing|without)\\b[^.]{0,40}\\b${gate}\\b|\\b${gate}\\b[^.]{0,30}\\b(not required|is not)\\b`, 'i').test(because)
    assert.ok(
      required || denied,
      `★★ kind=verification 的 because 提到了 "${gate}"，而 requiredGates=${JSON.stringify(gates)} `
      + `—— 数据与理由**互相否**（提了它，却既没要求、也没说清不要）。`
      + `\n  这就是 t73 的形状：两句话各自都读得通，并排读才发现说的是两件事。`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★ 附条件臂）：判据的适用条件必须写进判据本身
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（★ 附条件臂）：三态与适用条件的口径写在【可执行的注释】里，不靠使用的人记得', async () => {
  /**
   * ★ 用户 2026-10-08 的标准：「特定条件下起效的也能加，只是需要把那些特定条件顺便加上去。」
   *
   * ⇒ 本判据的适用范围（扫**措辞**里的 `??` 字面量；只看**属性路径**；根必须是本仓可达的）
   *   必须**写在本文件里**且**可机械核对** —— 而不是一条口口相传的约定。
   *
   * ★ 可执行形式：那三条条件各自都要有一句**可 grep 的**声明，
   *   且 `scanFallbacks` 真的按它们筛（而不是筛完了再说）。
   */
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')

  /**
   * ★ 条件 (a)：只扫**措辞**（模板字面量里的 `${…}`）—— 这是本判据的范围，也是它的窄。
   */
  assert.match(self, /面向人的措辞/, '★ 判据必须写明它只扫"面向人的措辞"')
  assert.match(self, /\\\$\\\{/, '★ 而它必须真的按 `${…}` 筛（不是扫所有 `??`）')

  /**
   * ★ 条件 (b)：只认**属性路径** —— 裸局部变量判不了，落 unreadable（附条件 c 的兄弟）。
   */
  assert.match(self, /裸局部变量|bare local/, '★ 必须写明"裸局部变量不在范围内"')

  /**
   * ★ 条件 (c)：根是仓外注入的 ⇒ 判不了 ⇒ **不许**判成缺陷（误伤比漏报更贵）。
   */
  assert.match(self, /仓外|host-injected/, '★ 必须写明"仓外来源不判缺陷"')
})

test('★ 臂 7（★ 自扫臂）：本判据文件自己也在扫描范围内 —— 而**替身字符串**要排除', async () => {
  /**
   * ★ 一条"扫别人"的判据若把自己排除在外，下一个人就会在它里面写一句没来源的措辞 ——
   *   而那条**永远**不会被扫到。
   *
   * ★★ 而这条臂第一版**红得对**：它在第 104 行抓到了 `ctx.neverAssignedCount ?? 1` ——
   *   而那**正是臂 1 的替身**（我故意编造的无来源路径，用来证明判据抓得住 t56 的形状）。
   *
   * ⇒ "本文件里的措辞"要分两类，而它们必须**不同形**：
   *
   *     ① 本判据**自己产出**的措辞（错误信息里给人看的话）⇒ 必须合格
   *     ② 本判据**作为替身构造**的字符串      ⇒ 刻意不合格，那是它的用途
   *
   * ★ 判法不是"记得排除"，而是**按形状排除**：替身一律出现在带 `fixture` / `替身`
   *   标记的模板字面量里。⇒ 判据只把**不带那些标记**的措辞当自己的产出。
   */
  const files = sourceFiles()
  const selfPath = fileURLToPath(import.meta.url)
  const source = readFileSync(selfPath, 'utf8')

  /** ★ 一行一行看：替身所在的行带标记词，其余才是"本判据自己说的话"。 */
  const lines = stripComments(source).split('\n')
  const offenders = []
  for (const [index, line] of lines.entries()) {
    const isFixture = /fixture|替身|neverAssigned/i.test(line)
    if (isFixture) continue
    for (const hit of scanFallbacks(line)) {
      const verdict = resolvePath(files, hit.path)
      if (verdict.state === 'unassigned') offenders.push(`${index + 1}: ${hit.path} ?? ${hit.fallback}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    '★ 本判据**自己产出**的措辞里有没来源的兜底值（替身字符串已按形状排除）：\n  '
    + offenders.join('\n  '),
  )
  /**
   * ★ 反向自证：替身那一行**确实存在**且**确实**被扫成 unassigned ——
   *   否则上面那段"排除"可能把整份文件都排掉了（那就是恒真）。
   */
  const fixtureLine = lines.find((l) => /neverAssigned/.test(l))
  assert.notEqual(fixtureLine, undefined, '★ 替身必须真的在文件里（否则排除规则没有对象）')
  const fixtureHits = scanFallbacks(fixtureLine)
  assert.ok(fixtureHits.length > 0, '★ 而且替身必须真的被扫到（否则臂 1 测的是空气）')
  assert.equal(
    resolvePath(files, fixtureHits[0].path).state, 'unassigned',
    '★ 替身必须落 unassigned —— 那正是臂 1 赖以成立的前提',
  )
})
