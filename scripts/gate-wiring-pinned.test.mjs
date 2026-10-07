#!/usr/bin/env node
/**
 * ── S3 判据：接线要被钉住（断言【调用点】存在，而不是断言函数存在）──────────────
 *
 * ── ★★ 它来自一次真实事故（MEASURED，静默了【几个小时】）─────────────────────────
 *
 *   t41 造出 worktree-aware 扫描（`workspaceAndWorktreeChangedPaths`），
 *   并由 captain 用一行把它接上：
 *
 *       a0f6504   gitChangedPaths: workspaceAndWorktreeChangedPaths(workspace)
 *
 *   而 t39 拆 `tools.ts` 时，那一行被**搬回了旧版**：
 *
 *       9779c58   gitChangedPaths: gitChangedPaths(workspace)
 *
 *   ⇒ 那个函数**又变成零调用方**，而【没有任何东西报】——
 *     直到 t56 的成员被那条拒绝挡住。★ 那是几小时之后。
 *
 * ── ★★ 而它的形状是关键的：断言【调用点】，不是断言【函数】─────────────────────
 *
 *   一个"函数存在吗"的判据在那次事故里全程是**绿的** —— 因为函数一直在
 *   `src/harness-compat.ts` 里，没被删。
 *
 *   ⇒ ★ 「函数还在」与「有人调用它」这两件事，在【函数还在而没人调用】时
 *     【同形】。而那正是本队记账最久的形态：
 *
 *       **一个没有调用方的修法，与没有修法在观测上完全相同。**
 *
 * ── ★★ 它为什么必须是【一张被声明的清单】而不是"所有导出都要有调用点"──────────
 *
 *   captain 的设计提醒（原话要点）："接线"这个概念太宽。
 *   断言"每个导出函数都必须有调用点"会：
 *     · 与 S1（供给必须有消费）重叠；
 *     · 误伤合法的 API 表面（对外导出、被下游 import 的那些）。
 *
 *   ⇒ 所以本判据【窄】：它读一张**人写下来的清单**，
 *     而清单里每一条说「这一行必须调用这个函数」。
 *
 *   ★ 而那张清单是它【全部的价值】：
 *     **一条接线的存在是被【声明】的，而不是被推导出来的。**
 *     推导只能得到"某处有人调用过它"；声明才能得到"这一处必须一直调用它"。
 *
 * ── ★ 附条件（用户 2026-10-08 的标准：特定条件要顺便写上）───────────────────────
 *
 *   「这条判据只对【有明确调用点】的接线适用。」
 *   ⇒ ★ 那个条件写在【判据里】（见 `declaredWiring` 的返回形状与 `WiringVerdict`），
 *     不是写在文档里靠使用的人记得。
 *   ⇒ 对一条**动态构造**的调用点（`registry[name].evaluate(...)` 之类），
 *     本判据给 `undecidable`，**绝不**给 `pinned`。
 *
 * Run: node --test scripts/gate-wiring-pinned.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★★ 接线清单（declared wiring）────────────────────────────────────────────────
 *
 * 每条声明说三件事：
 *   `file`    —— 那个调用点所在的**源文件**（workspace 相对）
 *   `symbol`  —— 必须在那里的**函数**
 *   `account` —— 为什么它必须被钉住（给人读；事故一句话）
 *
 * ★★ 现在**只有一条** —— 而那是刻意的（captain 的指令）：
 *   先只放【今天真实发生过的那一条】，其余等它被证明值得钉再说。
 *   ★ 一份预先填满的清单会把"我们决定要钉住什么"变成一个没人再看的长表 ——
 *     而那份长表与"没有清单"在维护效果上相同。
 *
 * ★ 加一条的判据（写给下一个人）：那条接线**必须曾经真的断过**，
 *   或者它的断裂**曾经真的静默过**。不是"它看起来重要"。
 */
export const DECLARED_WIRING = [
  {
    id: 't41-worktree-aware-scan',
    /**
     * ── ★★ t70：这条接线的**位置**变了，而它不是"被回退"─────────────────────────────
     *
     * MEASURED（本判据自己的措辞就说了）：`the wiring line … is gone:
     *   no line matches … (the call may have been reverted **or moved**)`。
     *
     * ★ 而 t70 把 dispatch 那一整段搬进了 `src/tools/update-task/dispatch.ts` ——
     *   于是这一行**搬了家而没有变内容**。
     *   ⇒ ★ 而那正是本判据**要分辨**的那件事：**"被回退"与"被搬家"必须不同形。**
     *     前者是缺陷（函数又变成零调用方），后者是拆分的预期结果。
     *
     * ★ 而 t70 的另一条护栏（`gate-update-task-injections`）**钉的正是"没变内容"**：
     *   它逐条断言 17 格注入的**右侧表达式逐字相同**。
     *   ⇒ 所以两条夹具在这里**分工**：
     *     · 本判据：这一行**还在**（在它该在的文件里）
     *     · 那条：这一行的**内容**没变
     */
    file: 'src/tools/update-task/dispatch.ts',
    symbol: 'observeWorkspaces',
    /**
     * ★★ `at` 是【那一行接线】的锚点 —— 而它是本判据最容易漏掉的一格（实测）。
     *
     * MEASURED（本文件实测）：只声明 `symbol` 时，把那一行改回
     * `gitChangedPaths(workspace)` **判据不报** ——
     * 因为 `observeWorkspaces(workspace)` 在同一个文件里**仍然被调用着**
     * （它还给 `observedWorkspaces` 那一格供数）。
     *
     *   ⇒ 「这个函数被调用了吗」与「**就是这一行**在用它吗」不同形。
     *     前者在"接线被搬走、函数另作他用"时是**绿的** ——
     *     而那正是 t39 那次回退的精确形状。
     *
     * ★ 而这一版的接线形状是【值经由 `observed` 传递】：
     *
     *       const observed = observeWorkspaces(workspace)     ← 遍历发生在这里
     *       …
     *       gitChangedPaths: observed?.paths,                 ← 接线落在这一行
     *
     *   ⇒ 所以锚点断言的是**那个键上用的是 worktree-aware 的那个值**。
     *     ★ 它不要求两个名字出现在同一行 —— 那会把这个（更好的）形状误判成断线。
     *     而它也不接受 `gitChangedPaths(workspace)`：那个键上不再是那个值。
     */
    at: /gitChangedPaths:\s*observed\??\.paths\b/,
    /** ★ 而这条接线要求**上游**真的在做 worktree-aware 遍历（锚点只钉了值的来源）。 */
    upstream: /const\s+observed\s*=\s*observeWorkspaces\(/,
    account:
      'update_task 的 changedPaths 观察面必须是 **worktree-aware** 的，'
      + '否则被派发到 worktree 的成员会被判成虚报。'
      + '它在 t39 拆分时被搬回旧版（9779c58），零调用方、静默了几小时；'
      + 't59 把它接回来时换成了 observeWorkspaces（同一次遍历同时给出"看了几棵树"）。'
      + '⇒ ★ 本清单跟的是【那条接线的性质】，而不是那个被换掉的名字。',
  },
]

/**
 * ── ★★ 一条【不带锚点】的声明：它测的是【符号级】的那条路径 ──────────────────────
 *
 * ★ 为什么两种声明都要存在：判据有**两条路径** ——
 *   · 有 `at` 锚点 ⇒ 问「**就是那一行**在用它吗」（接线级，t39 事故的形状）
 *   · 无 `at` 锚点 ⇒ 问「这个文件里有人调用它吗」（符号级）
 *
 * ★ 而后者**单独使用时是不够的**（见声明里的注释）——
 *   本文件保留它，是因为"符号级"这条路仍要被测，
 *   而把两条路混成一个会让"哪一条在说话"读不出来。
 */
const PLAIN_DECLARATION = { id: 'probe', file: 'probe.ts', symbol: 'probeFn' }

/** 读一个源文件；读不到 ⇒ `undefined`（**不是**空串：读不到与读到空不同形）。 */
function readSource(relPath) {
  const full = join(ROOT, relPath)
  if (!existsSync(full)) return undefined
  return readFileSync(full, 'utf8')
}

/**
 * ── ★★ 剥掉注释与字符串字面量，再去数调用点 ─────────────────────────────────────
 *
 * ★ 为什么必须剥 —— 而这一条是**实测**出来的（本文件第一版就踩了）：
 *
 *   `src/tools/update-task.ts` 的注释里**逐字写着**那次修复的说明：
 *
 *       ★★ 2026-10-07（t41 的接线）：从 `gitChangedPaths(workspace)` 换成
 *          `gitChangedPaths: workspaceAndWorktreeChangedPaths(workspace)`
 *
 *   ⇒ 一个不剥注释的 grep 会**在注释里找到符号**，于是它报 `pinned` ——
 *     而真实代码那一行仍然调用着旧函数。**探针找到了它自己的说明书。**
 *
 *   ★ 形态：本队记账的「守卫检查了另一个同名的东西」的又一实例 ——
 *     而这一次同名的是**注释里的那个名字**。
 *   ⇒ 所以剥离是正确性的前提，不是洁癖。
 *
 * ★ 剥离顺序：字符串 → 块注释 → 行注释。顺序反了会把 `//` 里的引号当成字符串开头。
 */
export function stripCommentsAndStrings(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (two === '//') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === ch) { i += 1; break }
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 转义一个符号，供正则使用（符号里可能有 `$`）。 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * ── ★★ 判定一条声明：`pinned` / `unwired` / `undecidable` ────────────────────────
 *
 * ★ 三态，且**第三态不得与第一态同形**：
 *
 *   `pinned`      —— 调用点在（剥注释/字符串之后仍然数得到）
 *   `unwired`     —— 文件在、符号在（或不在），而**没有任何调用点**
 *   `undecidable` —— 判不了：文件读不到，或调用点是动态构造的
 *
 * ★★ 第三条（`undecidable`）为什么必须存在，而不许并入 `pinned`：
 *   一条**动态构造**的调用点（`handlers[name](...)`）无法用文本断言证明存在。
 *   那时正确的读数是"我没能测到"，而把"没能测到"读成"接好了"
 *   正是本队记账的那条合流。
 *
 * ★ 而 `undecidable` 也**不得**与 `unwired` 同形：
 *   前者是"我看不见"，后者是"我看清了、它不在"。两者的补救动作不同
 *   （换断言方式 vs 去接线）。
 */
export function verdictOfOne(declaration, source) {
  if (source === undefined) {
    return {
      state: 'undecidable',
      id: declaration.id,
      reason: `cannot read ${declaration.file} (the file does not exist in this checkout)`,
    }
  }
  const code = stripCommentsAndStrings(source)

  /**
   * ★ 调用点的形状：`symbol(` 且**不是**它自己的定义、不是 import、不是属性名。
   *   · 定义：`function symbol(` / `symbol =` / `export function symbol(`
   *   · import：`import { symbol } from` / `{ symbol }`
   *   · 属性名：`symbol:`（对象键）—— 那常是**恰好同名**的另一件东西
   */
  const callPattern = new RegExp(`(^|[^\\w.$])${escapeRe(declaration.symbol)}\\s*\\(`, 'g')
  const definitionPattern = new RegExp(`function\\s+${escapeRe(declaration.symbol)}\\s*\\(`)
  const importPattern = new RegExp(`^\\s*${escapeRe(declaration.symbol)}\\s*[,}]|\\{[^}]*\\b${escapeRe(declaration.symbol)}\\b[^}]*\\}\\s*(from|\\})`)

  const lines = code.split('\n')
  const callSites = []
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (definitionPattern.test(trimmed)) continue
    if (importPattern.test(trimmed)) continue
    /**
     * ★ `symbol:` 或 `symbol =` 是**声明/键名**，不是调用 ——
     *   而 `gitChangedPaths: workspaceAndWorktreeChangedPaths(workspace)` 里
     *   两半都长得像符号，这正是那次事故最容易读错的地方。
     *   ⇒ 只在 `(` 紧跟其后时才算调用（上面的 callPattern 已经要求了这一点）。
     */
    if (new RegExp(`${escapeRe(declaration.symbol)}\\s*[=:]\\s*[^=(]`).test(trimmed)) continue
    if (callPattern.test(line)) {
      callPattern.lastIndex = 0
      callSites.push({ line: index + 1, text: trimmed })
    }
    callPattern.lastIndex = 0
  }

  /**
   * ── ★★ 判定的第一问：**那一行接线**还在吗（`at` 锚点）────────────────────────────
   *
   * MEASURED（本文件实测）：只数"这个函数在这个文件里被调用了吗"是**不够的**。
   *   把那一行改回 `gitChangedPaths(workspace)` 之后，`observeWorkspaces` 仍然
   *   在同一个文件里被调用（它还给 `observedWorkspaces` 供数）⇒ 只数符号会报 `pinned`。
   *
   *   ⇒ ★ 「这个函数被调用了吗」与「**就是这一行**在调用它吗」不同形 ——
   *     而前者在"接线被搬走、函数另作他用"时是**绿的**，那正是 t39 回退的形状。
   *
   * ★ 所以有 `at` 锚点时，**必须先过这一关**：锚点不匹配 ⇒ 接线不在。
   */
  if (declaration.at !== undefined) {
    if (!declaration.at.test(code)) {
      return {
        state: 'unwired',
        id: declaration.id,
        reason: `the wiring line for "${declaration.symbol}" in ${declaration.file} is gone: `
          + `no line matches ${declaration.at} (the call may have been reverted or moved)`,
      }
    }
    /**
     * ★★ 第二关：`upstream` —— **那条接线要求的东西真的在做那件事吗**。
     *
     *   这一格防的是"值还在，而它不再来自 worktree-aware 的遍历"：
     *   例如有人把 `const observed = observeWorkspaces(workspace)` 换成
     *   `const observed = { paths: gitChangedPaths(workspace) }` ——
     *   锚点仍然匹配（`observed?.paths` 还在），而**性质已经丢了**。
     *   ⇒ 那是本队记账的「守卫检查了另一个同名的东西」的精确形状。
     */
    if (declaration.upstream !== undefined && !declaration.upstream.test(code)) {
      return {
        state: 'unwired',
        id: declaration.id,
        reason: `the value at the wiring line is still \`observed?.paths\`, but its upstream is no longer `
          + `worktree-aware: ${declaration.file} no longer matches ${declaration.upstream}`,
      }
    }
    /** ★ 两关都过 ⇒ 交出匹配到的那一行，让人能核对（不是只说"过了"）。 */
    const matched = code.split('\n')
      .map((line, index) => ({ line: index + 1, text: line.trim(), raw: line }))
      .filter((entry) => declaration.at.test(entry.raw))
    return { state: 'pinned', id: declaration.id, callSites: matched, anchored: true }
  }

  if (callSites.length > 0) return { state: 'pinned', id: declaration.id, callSites }

  /**
   * ★ 没有调用点。而这里要分一次：**符号是否动态构造地出现**？
   *   若这个名字在代码里根本不是以"被调用"的样子出现的（例如它只出现在
   *   一个字符串/映射里），那文本断言就**证明不了**它没被调用 —— 落 undecidable。
   */
  const mentionsSymbol = new RegExp(escapeRe(declaration.symbol)).test(code)
  if (!mentionsSymbol) {
    /**
     * ★ 名字**完全不在**代码里（注释已剥）⇒ 可以确定地说"接不上"：
     *   没有动态构造能在运行时变出一个文件里根本没提过的名字。
     *   ⇒ `unwired`，而不是 `undecidable`。
     */
    return {
      state: 'unwired',
      id: declaration.id,
      reason: `"${declaration.symbol}" does not appear in ${declaration.file} outside comments `
        + '(the wiring was removed or never made)',
    }
  }
  /**
   * ★ 名字在、但没有可行的调用点 ⇒ 可能是动态构造 ⇒ **判不了**。
   *   绝不把它读成 pinned（那是本任务要防的合流），也绝不下"它就是断了"的结论
   *   （那会误报一个可能真的被动态调用着的接线）。
   */
  return {
    state: 'undecidable',
    id: declaration.id,
    reason: `"${declaration.symbol}" appears in ${declaration.file} but no direct call site could be `
      + 'established (the call may be constructed dynamically), so this gate cannot pin it',
  }
}

export function auditWiring(declarations = DECLARED_WIRING) {
  return declarations.map((d) => verdictOfOne(d, readSource(d.file)))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 一条【已接线】的样本：取自 a0f6504（那次修复真正落地的版本）──────────────
 *
 * ★ 为什么臂需要它，而不是直接用当前仓库的源码：
 *
 *   本判据在写下它的时候，**当前仓库里那条接线是断的**（实测见臂 1b）——
 *   9779c58 把它搬回了旧版，而 HEAD（46624be）仍然是断的。
 *
 *   ⇒ 若把"当前源码必须 pinned"写成臂，这条臂会**恒红**，而恒红的臂会阻断
 *     所有诚实的工作 —— 那是本队记账的那条。
 *
 *   ★ 而若把清单删掉（让它"绿"），判据就变成了一个对空集合说话的恒真函数。
 *
 *   ⇒ 所以分工是：
 *     **臂测【机制】**（用已知接线正确的样本）——
 *     而**机制读【真实源码】**并把现状如实报出来（臂 1b）。
 *     两者缺一不可：只测机制 ⇒ 没人知道现状；只看现状 ⇒ 不知道机制对不对。
 *
 * ★ 样本来源可复核：`git show a0f6504:src/tools.ts` 的第 2823 行。
 */
/**
 * ── ★★ 样本：一份**接线正确**的、最小但完整的 ctx 片段 ───────────────────────────
 *
 * ★ 它必须同时包含【上游遍历】与【那一行接线】—— 因为判据的两关各看一处：
 *
 *     const observed = observeWorkspaces(workspace)   ← upstream（性质来源）
 *     …
 *     gitChangedPaths: observed?.paths,               ← at（接线落点）
 *
 * ★ 而样本【从清单派生】：`symbol` / `at` / `upstream` 都取自声明。
 *   ⇒ 清单改了而样本没改的那种"假面"不会发生（本文件实测踩过一次）。
 */
const WIRED_SAMPLE = [
  'const observed = observeWorkspaces(workspace)',
  'const dispatchContext = {',
  '  changedPaths: input.changedPaths ?? task.changedPaths ?? [],',
  '  gitChangedPaths: observed?.paths,',
  '}',
].join('\n')
/** 那次回退的形状（9779c58 逐字：值直接来自旧的单树扫描）。 */
const REVERTED_SAMPLE = [
  'const dispatchContext = {',
  '  changedPaths: input.changedPaths ?? task.changedPaths ?? [],',
  '  gitChangedPaths: gitChangedPaths(workspace),',
  '}',
].join('\n')

test('★ 臂 1（对照臂）：一份【接线正确】的样本必须被报成 `pinned`', () => {
  /**
   * ★ 反向半边（不许恒红）：判据必须**能**说"接好了"。
   *   一个永远报 `unwired` 的实现会在这里红。
   */
  const declaration = DECLARED_WIRING[0]
  const verdict = verdictOfOne(declaration, WIRED_SAMPLE)
  assert.equal(verdict.state, 'pinned', `★ 实测：${JSON.stringify(verdict)}`)
  assert.ok(verdict.callSites.length >= 1, '★ 报 pinned 时必须交出错到了哪一行')
})

test('★★ 臂 1b（现状臂）：把**当前仓库**的接线现状如实报出来（不因为它红就把它删掉）', () => {
  /**
   * ── ★★ 这一臂的历史（它【曾经】是一条读数，而现在收紧成断言）──────────────────
   *
   *   · 写下这份判据时（HEAD 46624be）：那条接线是**断的** ——
   *     9779c58 把它搬回了旧版。那时若写成 "must be pinned"，这一臂恒红，
   *     而恒红的臂会教人忽略它 ⇒ 当时它是【读数】（打印现状，不断言）。
   *     ★ 而它的注释里写下了**收紧条件**：「接回来之后，它应当被收紧成 must-be-pinned」。
   *
   *   · 现在（t59 已把它接回来，用 observeWorkspaces）：那条接线**在**。
   *     ⇒ 按那条预先写下的条件，本臂现在收紧 —— 一个曾经是读数的臂，
   *       在它等待的事实到来之后变成了断言，**这是它被设计时的用法**。
   *
   * ★ 而它现在是真断言：清单里每一条都必须 `pinned`。
   *   若有人把那条接线再断开（或把清单写成过时的符号），本臂立刻红。
   */
  const results = auditWiring()
  const bad = results.filter((r) => r.state !== 'pinned')
  assert.deepEqual(
    bad, [],
    `★ 清单里有接线没钉住。实测：${JSON.stringify(results, null, 1)}`,
  )
  assert.ok(results.length >= 1, '★ 清单不许为空 —— 空集合上"每一条都合格"是恒真的')
  // eslint-disable-next-line no-console
  console.log(`\n[接线现状] ${results.map((r) => `${r.id} ⇒ ${r.state}`).join(' · ')}\n`)
})

test('★★ 臂 1c（清单完整性臂）：清单里的符号必须真的在**源码里**被调用过', () => {
  /**
   * ── ★★ 这一臂补的是臂 1b 收紧之后暴露出来的一个洞（本文件实测发现的）────────────────
   *
   * MEASURED：把清单里的 `symbol` 改成一个**拼错的名字**（`observeWorkspacesTypo`），
   * 所有臂仍然**全绿**：
   *   · 臂 1/2/… 用的是从清单派生的合成样本 ⇒ 跟着那个错名字一起错，自洽；
   *   · 而真实源码里当然没有 `observeWorkspacesTypo` ⇒ 若臂 1b 是"读数"，
   *     它会把这条**清单错误**打印成"一条待修的缺陷" —— 两者同形。
   *
   * ⇒ ★ 形态：**清单自己错了，而症状看起来像代码错了。**
   *   那正是本队记账的「检查了另一个同名的东西」的近亲：
   *   这一次检查的是**一个名字**，而那个名字与代码里的那个不是同一个。
   *
   * ⇒ 修法：把"清单里的符号必须在**源码**里真的出现过"单独钉一臂。
   *   它问的不是"接好了吗"，是"**这张清单还在说现在的事吗**"。
   */
  for (const declaration of DECLARED_WIRING) {
    const source = readSource(declaration.file)
    assert.ok(source, `★ 清单指向的文件必须存在：${declaration.file}`)
    const code = stripCommentsAndStrings(source)
    assert.match(
      code, new RegExp(escapeRe(declaration.symbol)),
      `★★ 清单说 ${declaration.file} 里有 "${declaration.symbol}"，而**源码里（剥掉注释后）没有它**。`
      + '这通常意味着清单过期了（实现被换成了另一个名字）—— 而那种失效会伪装成"接线断了"。',
    )
  }
})

test('★★ 臂 2（核心臂）：把那一行改回旧版 ⇒ 必须报 `unwired`', () => {
  /**
   * ── ★★ 这是本判据存在的理由的【可执行形式】，而它就是那次真实事故 ───────────────
   *
   *   a0f6504   gitChangedPaths: workspaceAndWorktreeChangedPaths(workspace)   ← 接上
   *   9779c58   gitChangedPaths: gitChangedPaths(workspace)                    ← 搬家时回退
   *
   * ★ 关键：断言的是**调用点**。回退之后 `gitChangedPaths` 仍在被调用 ——
   *   一个"函数存在吗"的判据在这一格里是**绿的**。
   */
  const declaration = DECLARED_WIRING[0]
  assert.notEqual(REVERTED_SAMPLE, WIRED_SAMPLE, '★ 突变必须真的施加成功（否则本臂是恒真的）')
  const verdict = verdictOfOne(declaration, REVERTED_SAMPLE)
  assert.equal(
    verdict.state, 'unwired',
    `★★ 接线被回退 ⇒ 必须报 unwired。实测：${JSON.stringify(verdict)}`,
  )
})

test('★★ 臂 3：断言【调用点】而不是断言【函数】—— 两者在事故里同形', () => {
  /**
   * ── ★ 本臂把"为什么判据形状是关键"变成可执行断言 ──────────────────────────────
   *
   * 事故里 `workspaceAndWorktreeChangedPaths` **一直在**（它没被删，现在也在
   * `src/harness-compat.ts:302`）⇒ 一个"函数存在吗"的断言全程绿。
   *
   * ⇒ 本臂当场演示这个同形：
   *     · 回退后的样本里，符号的名字**仍然出现**（import 那一行）
   *       ⇒ "函数存在"式为真
   *     · 而调用点已断 ⇒ 本判据**不再是 `pinned`**
   *
   * ── ★★ 而这里有一个必须说清的读数（本臂实测出来的）────────────────────────────
   *
   * 上面那份样本（**有 import、没有调用点**）拿到的是 `undecidable` —— 而那是
   * **正确的保守读数**：符号被 import 了，而 import 之后完全可能在别处被动态调用
   * ⇒ 文本断言**证明不了**它没被调用。
   *
   * ⇒ 所以本臂断言的是那条**真正重要的分界**：
   *     `pinned`  ⟺  数得到调用点
   *     而"符号还在" **不足以**推出 `pinned`
   *
   * ★ 而 `unwired`（确定地说"断了"）需要更强的前提：符号在**剥掉注释之后
   *   完全不再出现** —— 那时没有动态构造能凭空变出一个文件里没提过的名字。
   *   臂 2 用的是那种样本，所以它拿到的是 `unwired`。
   *   ⇒ 两条臂合起来才完整：**同形发生在 "pinned vs 非 pinned" 之间，
   *     而不是发生在 "unwired vs undecidable" 之间。**
   */
  const declaration = PLAIN_DECLARATION
  const revertedWithImport = [
    "import { probeFn } from './probe.ts'",
    'const dispatchContext = {',
    '  gitChangedPaths: otherFn(workspace),',
    '}',
  ].join('\n')

  // "函数存在吗"式的断言：符号仍有提及 ⇒ 它绿
  assert.equal(
    new RegExp(escapeRe(declaration.symbol)).test(revertedWithImport), true,
    '★ 前提：回退之后符号的名字仍然在文件里（import 那一行）',
  )
  // 而本判据不再是 pinned
  const verdict = verdictOfOne(declaration, revertedWithImport)
  assert.notEqual(
    verdict.state, 'pinned',
    `★ "函数存在"式为真，而"调用点在"式为假 —— 这就是它们同形的那一刻。实测：${JSON.stringify(verdict)}`,
  )
  /**
   * ★ 而它必须是 `undecidable`（不是 `unwired`）：符号被 import 过，
   *   所以本判据**不能说**它一定没被调用。这是"判不了"的正确用法。
   */
  assert.equal(
    verdict.state, 'undecidable',
    `★ 有 import、无调用点 ⇒ 判不了（不许说"一定断了"）。实测：${JSON.stringify(verdict)}`,
  )
  /**
   * ★ 而臂 2 那一份（符号彻底不在）必须给出**确定**的 `unwired` ——
   *   两态不同形，且强度不同。缺了这一句，`undecidable` 会退化成万能挡箭牌。
   */
  assert.equal(
    verdictOfOne(declaration, REVERTED_SAMPLE).state, 'unwired',
    '★ 符号彻底不再出现 ⇒ 才可以说"断了"',
  )
})

test('★ 臂 4（剥注释臂）：注释里提到那个符号【不算】接线', () => {
  /**
   * ── ★★ 这一臂来自本文件第一版的实测缺陷 ───────────────────────────────────────
   *
   * `update-task.ts` 的注释里**逐字写着**那次修复的说明：
   *   「★★ 2026-10-07（t41 的接线）：从 `gitChangedPaths(workspace)` 换成
   *     `gitChangedPaths: workspaceAndWorktreeChangedPaths(workspace)`」
   *
   * ⇒ 不剥注释的 grep 会在**注释里**找到符号并报 `pinned`，
   *   而真实代码那一行仍然调用着旧函数。**探针找到了它自己的说明书。**
   */
  const declaration = PLAIN_DECLARATION
  const commentOnly = [
    '// probeFn(workspace)',
    '/* probeFn(workspace) */',
    'const note = "probeFn(workspace)"',
    'gitChangedPaths: gitChangedPaths(workspace),',
  ].join('\n')
  assert.equal(
    verdictOfOne(declaration, commentOnly).state, 'unwired',
    '★ 只在注释/字符串里出现 ⇒ 那【不是】接线',
  )

  /**
   * ★ 对照半边：把同样一行**放进代码**（去掉注释符）⇒ 必须变成 `pinned`。
   *   缺了这一半，本臂可能是恒真的（一个"永远报 unwired"的实现也能过）。
   */
  const realCode = 'probeFn(workspace)'
  assert.equal(
    verdictOfOne(PLAIN_DECLARATION, realCode).state, 'pinned',
    '★ 同样一行放在代码里 ⇒ 必须算接线',
  )
})

test('★★ 臂 5（三态臂）：`undecidable` 与 `pinned` **不同形**，且与 `unwired` 也不同形', () => {
  /**
   * ★ 本臂走【符号级】那条路（无锚点声明）——
   *   因为"动态构造 ⇒ 判不了"这件事只在那条路上才可能发生：
   *   ★ 有锚点时不匹配就是**确定**的 `unwired`（锚点是明写的文本，没有动态余地）。
   */
  const declaration = PLAIN_DECLARATION

  // ① 文件读不到 ⇒ undecidable
  const missing = verdictOfOne(declaration, undefined)
  assert.equal(missing.state, 'undecidable', '读不到文件 ⇒ 判不了')

  // ② 动态构造 ⇒ undecidable（符号在、但没有直接调用点）
  const dynamic = [
    'const handlers = { [name]: probeFn }',
    'handlers[name](workspace)',
  ].join('\n')
  const dynamicVerdict = verdictOfOne(declaration, dynamic)
  assert.equal(
    dynamicVerdict.state, 'undecidable',
    `★ 调用点可能是动态构造的 ⇒ 判不了，而不是断言它断了。实测：${JSON.stringify(dynamicVerdict)}`,
  )

  // ③ 三态两两不同形
  const pinned = verdictOfOne(PLAIN_DECLARATION, 'probeFn(workspace)')
  const unwired = verdictOfOne(PLAIN_DECLARATION, 'otherFn(workspace)')
  const states = [pinned.state, unwired.state, missing.state, dynamicVerdict.state]
  assert.equal(pinned.state, 'pinned')
  assert.equal(unwired.state, 'unwired')
  assert.equal(
    new Set(states).size, 3,
    `★ 三种读数必须两两不同形。实测：${JSON.stringify(states)}`,
  )
  /**
   * ★★ 关键：`undecidable` 绝不许被读成 `pinned` —— 那是本任务要防的合流。
   *   用一个"只数符号出现"的朴素实现来演示它会怎样错：
   */
  const naive = (source) => (new RegExp(escapeRe(declaration.symbol)).test(source) ? 'pinned' : 'unwired')
  assert.equal(naive(dynamic), 'pinned', '★ 朴素实现（只数符号）在动态那一格报 pinned —— 那正是合流')
  assert.notEqual(
    dynamicVerdict.state, naive(dynamic),
    '★ 而本判据必须与朴素实现给出**不同**的答案，否则"三态"只是一句话',
  )
})

test('★ 臂 6：把一条【真的接好的】报成断开 ⇒ 反向臂必须红', () => {
  /**
   * ── ★ 反向半边（不许恒红）──────────────────────────────────────────────────────
   *
   * 一条恒红的判据会阻断所有诚实的工作，而它红得看起来完全正常。
   * ⇒ 本臂构造"**真的接好的**"那一格，断言判据报 `pinned`。
   *   ★ 若有人把判据改成恒红（例如正则写错、或永远返回 unwired），本臂会红。
   *   ★ 而它**不使用**当前仓库的源码 —— 见臂 1b：那条接线现在真的是断的，
   *     用真实源码会把本臂变成一个恒红的东西。
   */
  const declaration = DECLARED_WIRING[0]
  assert.equal(
    verdictOfOne(declaration, WIRED_SAMPLE).state, 'pinned',
    '★ 一份接线正确的样本必须报 pinned（若报 unwired，判据是恒红的）',
  )
  /** ★ 而合成的最小正例也必须绿（防止"只在某一份样本上碰巧绿"）。 */
  assert.equal(verdictOfOne(PLAIN_DECLARATION, 'const x = probeFn(w)').state, 'pinned')
  /** ★ 缩进/多余空格不该影响判定（否则它会在一次格式化后误报）。 */
  assert.equal(verdictOfOne(PLAIN_DECLARATION, '  probeFn(  w  )').state, 'pinned')
})

test('★★ 臂 7（附条件臂）：那条适用条件写在**判据里**，不是写在文档里', () => {
  /**
   * ── ★ 用户 2026-10-08 的标准 ───────────────────────────────────────────────────
   *
   *   「特定条件下起效的也能加，只是需要把那些特定条件顺便加上去。」
   *
   * ★ 所以"本判据只对【有明确调用点】的接线适用"必须是一个**可执行的读数**：
   *   对动态构造的接线，它给出 `undecidable`（= 明确说出"这不在我的适用范围内"），
   *   而不是硬下一个结论。
   */
  const declaration = PLAIN_DECLARATION
  const dynamic = 'export const table = { scan: probeFn }'
  const verdict = verdictOfOne(declaration, dynamic)
  assert.equal(verdict.state, 'undecidable')
  assert.match(
    String(verdict.reason), /dynamic|cannot pin|could not be established/i,
    `★ 第三态必须【说清它为什么判不了】—— 否则"判不了"与"断开了"同形。实测：${verdict.reason}`,
  )
})

test('★ 臂 8（清单臂）：清单里的每一条都必须是**可读的文件 + 真实的符号**', () => {
  /**
   * ★ 一份指向不存在的文件的清单，会让判据恒 `undecidable` ——
   *   而那读起来像"我没能测到"，与"这一格不适用"同形。
   *   ⇒ 清单本身要被核对。
   */
  for (const declaration of DECLARED_WIRING) {
    assert.ok(declaration.id && declaration.file && declaration.symbol, `声明字段不全：${JSON.stringify(declaration)}`)
    assert.ok(
      declaration.account && declaration.account.length > 20,
      `★ 每条声明必须说清【为什么它必须被钉住】—— 否则下一个人不知道能不能删。实测：${JSON.stringify(declaration)}`,
    )
  }
})

test('★★ 臂 9（端到端臂）：在**仓库的一份真实副本**上回退那一行 ⇒ 判据报 unwired', () => {
  /**
   * ★ 臂 2 是在**字符串**上做的。本臂升级为：把真实文件写进一个临时副本目录，
   *   让 `auditWiring` 从**那个副本**读 —— 于是"文件读得到、而接线断了"
   *   这条路径被端到端走了一遍（而不是只测了一个纯函数）。
   */
  const declaration = DECLARED_WIRING[0]
  const reverted = REVERTED_SAMPLE

  const root = mkdtempSync(join(tmpdir(), 'wiring-pinned-'))
  try {
    /**
     * ★ t70：目录要按 `declaration.file` 的**实际层级**建 ——
     *   接线搬进 `src/tools/update-task/` 之后，写死了 `src/tools` 会让
     *   `writeFileSync` 抛 ENOENT（而那个错与"接线断了"不同形）。
     */
    mkdirSync(join(root, dirname(declaration.file)), { recursive: true })
    writeFileSync(join(root, declaration.file), reverted)
    const verdict = verdictOfOne(declaration, readFileSync(join(root, declaration.file), 'utf8'))
    assert.equal(verdict.state, 'unwired', `实测：${JSON.stringify(verdict)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('★★ 臂 10（历史臂）：判据必须能在**真的接好过的那个版本**上找到调用点', () => {
  /**
   * ── ★★ 这一臂证明"判据不是恒红的"，而且用的是【历史事实】而不是合成样本 ────────
   *
   * ★★ 而历史有【两端】，它们用的是**两个不同的名字**（本臂必须逐代说清）：
   *
   *   a0f6504   t41 接上的是 `workspaceAndWorktreeChangedPaths(workspace)`
   *   9779c58   t39 的机械搬运把它搬回 `gitChangedPaths(workspace)`（零调用方）
   *   t59       接回来时换成了 `observeWorkspaces(workspace)`（同一次遍历
   *             同时给出"看了几棵树"，比原来那一版更强）
   *
   * ⇒ ★ 所以本臂对**每一代用那一代的名字**去测 —— 而不是拿今天的名字去测历史。
   *   后者会把一个正确接好的历史版本误报成 unwired，而那正是
   *   「拿本刻的事实去读过去」这条形态。
   */
  const todays = DECLARED_WIRING[0]
  let historical
  try {
    historical = execFileSync('git', ['show', 'a0f6504:src/tools.ts'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    /** ★ 取不到历史（浅克隆等）⇒ 判不了，而**不是**判成通过。 */
    return
  }

  /**
   * ★ 第一代：a0f6504 用的是 `workspaceAndWorktreeChangedPaths`。
   *   用一个**临时的声明**（同一个文件、那一代的名字）去测它。
   */
  const firstGeneration = {
    id: 't41-worktree-aware-scan@a0f6504',
    file: 'src/tools.ts',
    symbol: 'workspaceAndWorktreeChangedPaths',
    /** ★ 那一代的接线形状：函数**直接**出现在那个键上（与今天不同）。 */
    at: /gitChangedPaths:\s*workspaceAndWorktreeChangedPaths\(/,
  }
  const a0 = verdictOfOne(firstGeneration, historical)
  assert.equal(
    a0.state, 'pinned',
    `★ a0f6504 里那次接线是真的接上的 ⇒ 用那一代的名字必须报 pinned。实测：${JSON.stringify(a0)}`,
  )
  assert.ok(
    a0.callSites.some((site) => /workspaceAndWorktreeChangedPaths\s*\(/.test(site.text)),
    `★ 而它必须指名那个调用点。实测：${JSON.stringify(a0.callSites)}`,
  )

  /**
   * ★ 第二代：9779c58 的形态 —— 那个符号还在（它的定义没被删），而调用点没了。
   *   ★ 而它落 `undecidable` 而不是 `unwired`：符号仍被 import，
   *     所以文本断言**不能**断言它一定没被调用。这是保守的正确读数。
   */
  const afterRefactor = execFileSync('git', ['show', '9779c58:src/tools/update-task.ts'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const broken = verdictOfOne({ ...firstGeneration, at: undefined }, afterRefactor)
  assert.notEqual(
    broken.state, 'pinned',
    `★ 9779c58 之后它不再是 pinned —— 事故就发生在这里。实测：${JSON.stringify(broken)}`,
  )
  /** ★ 而那一版里 `gitChangedPaths(workspace)` 确实在（那正是"搬回旧版"的物证）。 */
  assert.match(
    afterRefactor, /gitChangedPaths:\s*gitChangedPaths\(workspace\)/,
    '★ 物证：那一版调用的是旧函数',
  )
})
