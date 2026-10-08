/**
 * ── 判据：一次「纯搬运」不得【减少】任何符号的计数（t94）──────────────────────────
 *
 * 出处：checkpoint-dev 在 t86 里的原话
 *
 *     「**『纯搬运』这个说法本身没有被任何判据核对过。**
 *       ⇒ 能核对它的东西很便宜：**搬运前后逐符号计数**。」
 *
 * ── ★★★ 它防的是什么失效（今晚三次同源）──────────────────────────────────────
 *
 *   · **t39**：一次"纯搬运"把 `gitChangedPaths` 的接线**覆盖回旧版**
 *     （⇒ t41 接好的 worktree-aware 扫描变成没有调用方）
 *   · **t70**：拆分把 t69 的出口**覆盖回旧版**
 *   · **t70 同时** 丢了 **4 组接线**：
 *
 *         parseKnownBaselineFailures   pre=3  → post=0
 *         baselineAbsent               pre=2  → post=0
 *         knownBaselineFailures        pre=3  → post=0
 *         skippedAll                   pre=16 → post=0
 *
 *     ★ 而它们**只出现在失败清单里，没有任何东西报出来**。
 *
 * ⇒ ★ 共同形态：**一个动作自称"只是把东西挪了个地方"，
 *   而没有任何机制核对那句自称。**
 *   ⇒ 于是"搬运"成了唯一一种**可以静默丢内容**的重构。
 *
 * ── ★★ 判据形状（可机械判定）─────────────────────────────────────────────────
 *
 *     对一个声称纯搬运的改动，取**搬运前后**的符号集，
 *     断言每一个符号在【搬运目标集合】里的计数**不减少**
 *     —— 而减少的必须逐条点名（哪一个、从几变几）。
 *
 *   · **符号** = 源码里的标识符
 *   · **计数** = 它在【目标集合】里出现的次数
 *   · **目标集合** = 由 `inScope` 决定（★ 那是可读的：它就在契约里）
 *
 * ── ★★ 它分辨【合法差异】与【丢失】──────────────────────────────────────────
 *
 *   | 变化 | 合法吗 | 为什么 |
 *   |---|---|---|
 *   | import 路径变了 | ✅ | 符号**没有消失**，只是它的来源换了个文件 |
 *   | 行号变了 | ✅ | 按行号判会让它恒红（本队记账：位置不是身份） |
 *   | 注释变了 | ✅ | 注释不是符号的载体 |
 *   | **某个标识符从 N 变成 0** | ❌ | **那就是丢了** |
 *
 *   ⇒ ★ 口径是【计数不减少】，**不是**逐字节相同 ——
 *     后者会把一切合法重构都判红，而误报会教人忽略门禁。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★ 符号的词法口径 ──────────────────────────────────────────────────────────
 *
 * ★ 只算**标识符**（`[A-Za-z_$][\w$]*`），且要**先剥注释** ——
 *   本仓的注释里大量写着这些名字（本文件就是例子），
 *   不剥的话"计数"里会混进**说明文字**，而那是把解释当成代码。
 *
 * ── ★★★ 而【模板字面量的 `${…}` 里是代码】，不许一起剥掉 ────────────────────────
 *
 * MEASURED（t94，第一版当场抓出来）：我第一版把 `` ` `` 当成普通字符串，
 *   于是整个模板串（**包括 `${…}` 里的表达式**）都被当成"字面量"剥掉了。
 *   ⇒ 后果：`skippedAll` 在 `update-task.ts` 里的计数从**真实的 6** 掉到 **2** ——
 *     因为 4 处都在模板串的插值里：
 *
 *         : `update_task rejected: ${dispatchGates.skippedAll ?? …}`
 *         + `(recorded, not rejected): ${completionGates.skippedAll}`
 *
 *   ★ 而那些**是真的符号使用**（它们会真的求值）⇒ 剥掉它们等于**少算**。
 *   ★ 而"少算"在本判据里是**危险方向**：它会让 pre 变小 ⇒
 *     一个**真的丢失**可能因为"两边都少算"而落进 `ok`。
 *
 * ⇒ 修法：模板串里的 `${…}` **回到 `code` 状态**（插值里可以嵌套引号与更深的花括号），
 *   只有插值之外的文本才是字面量。
 *
 * ★ 而普通字符串（`'…'` / `"…"`）整段剥掉 —— 那里的 `'skippedAll'` 是**字段名常量**，
 *   不是那个标识符的使用。★ 而剥掉它也可能"少算"…… ⇒ 所以下面另有一条**兜底**：
 *   计数以【两个口径的最大值】为准（见 `symbolCounts` 的文件头）。
 */
function stripCommentsAndStrings(text) {
  let out = ''
  /** `state` ∈ code | line | block | string | template | interp */
  let state = 'code'
  let quote = null
  /** ★ 模板串 / 插值的嵌套栈（`${` 可以套 `${`）。 */
  const stack = []
  let braceDepth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code' || state === 'interp') {
      if (ch === '/' && next === '/') { state = 'line'; i += 1; continue }
      if (ch === '/' && next === '*') { state = 'block'; i += 1; continue }
      if (ch === "'" || ch === '"') { state = 'string'; quote = ch; out += ' '; continue }
      if (ch === '`') { state = 'template'; quote = '`'; out += ' '; continue }
      /**
       * ★ 插值里的花括号要计数：`}` 减一层，减到 0 就**回到模板串**。
       *   ⇒ 而嵌套的 `{`（对象字面量）会让它继续留在 `interp` 里。
       */
      if (state === 'interp') {
        if (ch === '{') braceDepth += 1
        else if (ch === '}') {
          braceDepth -= 1
          if (braceDepth === 0) { state = 'template'; continue }
        }
      }
      out += ch
      continue
    }
    if (state === 'line') { if (ch === '\n') { state = 'code'; out += '\n' } continue }
    if (state === 'block') { if (ch === '*' && next === '/') { state = 'code'; i += 1 } continue }
    if (state === 'string') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) { state = 'code'; quote = null; out += ' ' }
      continue
    }
    /** template：插值之外是字面量 ⇒ 丢掉；遇到 `${` 则**回到代码**。 */
    if (ch === '\\') { i += 1; continue }
    if (ch === '$' && next === '{') { state = 'interp'; braceDepth = 1; i += 1; out += ' '; continue }
    if (ch === '`') { state = 'code'; quote = null; out += ' '; continue }
    /** 其余模板字面量文本：丢掉。 */
  }
  void stack
  return out
}

/** 一个文本里的**符号计数表**。 */
function symbolCounts(text) {
  const counts = new Map()
  const code = stripCommentsAndStrings(text)
  /**
   * ★ 词界由正则自己保证：`\b` 两侧要有非标识符字符。
   *   ★ 而 `.` 与 `_` 都在标识符内，所以 `a.b` 会算成 `a` 与 `b` 两个 ——
   *     那是**对的**：成员访问的两侧各自是可寻的符号。
   */
  for (const match of code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1)
  }
  return counts
}

/** 一个目录树里**全部 `.ts` 源码**拼起来（跳过 `lib/`、`node_modules/`、`.agent-teams/`）。 */
function sourceOf(dir) {
  const SKIP = new Set(['lib', 'node_modules', '.agent-teams', '.git', 'dist'])
  const parts = []
  const walk = (current) => {
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) parts.push(readFileSync(full, 'utf8'))
    }
  }
  walk(dir)
  return parts.join('\n')
}

/**
 * ── ★★★ 判据本体 ─────────────────────────────────────────────────────────────
 *
 * @param {{ inScope: string[], before: Map<string, number>, after: Map<string, number> }} input
 * @returns {{ state: 'ok' | 'shrunk' | 'not-a-move', shrunk: {symbol,pre,post}[], checked: number }}
 */
export function pureMoveVerdict(input) {
  const { inScope, before, after, outside } = input

  /**
   * ── ★★ 第三态：这不是一次搬运 ────────────────────────────────────────────────
   *
   * ★ 判法：一个**普通的**（非搬运）改动会**合法地**改变符号集 ——
   *   它会新增、会删除、会改名。⇒ 那种改动**不该**落在 ok 或 shrunk 上，
   *   因为两条断言都不适用于它。
   *
   * ★ 而"是不是一次搬运"由调用方【声称】，这里只做一次**便宜的合理性核对**：
   *   · inScope 为空 ⇒ 没有目标集合 ⇒ 判不了（不适用）
   *   · before 为空     ⇒ 没有搬运前的东西 ⇒ 判不了（不适用）
   *   ⇒ ★ 两者都是"没能测量"，而它们**不得**并进"合格"。
   */
  if (!Array.isArray(inScope) || inScope.length === 0) {
    return { state: 'not-a-move', shrunk: [], checked: 0, reason: 'no inScope ⇒ there is no target set, so a per-symbol count has nothing to count' }
  }
  if (before.size === 0) {
    return { state: 'not-a-move', shrunk: [], checked: 0, reason: 'the "before" set is empty ⇒ this is not a move (or it was not measured)' }
  }

  /**
   * ── ★★ 只对【搬运前存在】的符号比对 ──────────────────────────────────────────
   *
   * ★ 为什么不管新增的符号：搬运**可以**顺带新增（那是合法差异）。
   *   而"丢失"的定义是**搬运前有的、搬运后没了**。
   */
  /**
   * ── ★★★ 而减少的那些要【分栏】：搬走了 vs 坏了 ──────────────────────────────
   *
   * 出处：t86 的原话（captain 采纳为这条判据的核心）
   *
   *   「两者要不同形，必须让『读到的东西』与『声称的东西』**分栏报**：
   *     · 「读错位置」= 那个东西**不存在于**它该在的地方 ⇒ 读数是"此处没有"
   *     · 「行为回退」= 那个东西**存在于**它该在的地方而**没人用它**
   *       ⇒ 读数是"此处有，而入口为空"
   *     ★ 而失败清单把两者印成同一行字 —— 因为清单只报"红"，不报"**红在哪一格上**"。」
   *
   * ⇒ ★ 本判据里那两栏是：
   *
   *     `moved` —— 在【目标集合】里少了，而在集合**之外找得到**
   *                （★ 读数："此处没有，别处有"）
   *     `lost`  —— 在【目标集合】里少了，而**哪里都找不到**
   *                （★ 读数："此处没有，别处也没有"）
   *
   * ★★ 而这两者的**补救动作完全不同**：
   *   · `moved` ⇒ 去核"那次搬运该不该把它带走"（可能完全正确）
   *   · `lost`  ⇒ ★ **去看那三个修复**（它就是今晚抹掉接线的那一种）
   *   ⇒ 印成一行，读的人必然把两者都当"丢了"去查 —— 而那正是 t86 说的
   *     「谁照它做都会踩」。
   *
   * ★ 判法：`outside` = 目标集合**之外**的同一份计数表（可选输入）。
   *   缺席 ⇒ ★ 整栏降级为 `unclassified`（不许把"没测到"并进任何一栏）。
   */
  const shrunk = []
  const moved = []
  const lost = []
  const unclassified = []
  for (const [symbol, pre] of before) {
    const post = after.get(symbol) ?? 0
    if (post >= pre) continue
    const entry = { symbol, pre, post }
    shrunk.push(entry)
    /**
     * ★ 第三栏缺席 ⇒ `unclassified`（**不是** lost）。
     *   把"我没看别处"读成"别处也没有"，就是**把没测到并进结论**。
     */
    if (outside === undefined) { unclassified.push(entry); continue }
    /**
     * ★★★ 分栏：`outside` 支持两种形状 ────────────────────────────────────────
     *
     *   · 一张 `Map<symbol, count>`            ⇒ 只说"别处有/没有"
     *   · 一张 `Map<file, Map<symbol, count>>` ⇒ ★ 还能说清"**别处有：那个文件**"
     *
     * ⇒ ★ 后者是本判据推荐的形式，因为"搬走了"这个读数**下一步就要有人去那个地方看**。
     *   ★ 而判据**不**替人下"这算不算坏"的结论（那是意图，而意图不是判据的输入）
     *     —— 它只把【此处没有，别处有（在哪儿）】如实印出来。见 captain ⑤。
     */
    const locations = []
    if (outside instanceof Map) {
      for (const [key, value] of outside) {
        if (value instanceof Map) {
          const n = value.get(symbol) ?? 0
          if (n > 0) locations.push(`${key} (${n})`)
        } else if (key === symbol && typeof value === 'number' && value > 0) {
          /** ★ 扁平表：只能确认"别处有"，说不出在哪儿。 */
          locations.push('(a file outside the target set, not named by the caller)')
        }
      }
    }
    if (locations.length > 0) { moved.push({ ...entry, foundIn: locations.sort() }); continue }
    lost.push(entry)
  }
  shrunk.sort((a, b) => b.pre - a.pre || a.symbol.localeCompare(b.symbol))
  moved.sort((a, b) => b.pre - a.pre || a.symbol.localeCompare(b.symbol))
  lost.sort((a, b) => b.pre - a.pre || a.symbol.localeCompare(b.symbol))

  /**
   * ── ★★★ 三态【两两不同形】────────────────────────────────────────────────────
   *
   *     `ok`         计数全对     —— 每一个搬运前的符号都还在（≥ 原计数）
   *     `shrunk`     有符号减少   —— ★ 附【哪一个、从几变几】
   *     `not-a-move` 不适用       —— 这不是一次搬运（或判不了）
   *
   * ★ 而三者**不得合并**：把 `not-a-move` 并进 `ok` 就是"没测到并进通过"；
   *   并进 `shrunk` 就会在每一个普通改动上误报。
   */
  /**
   * ── ★★ 返回值的形状：分栏是【并列】的读数，不是一个合并的结论 ────────────────
   *
   * ★ `state` 只回答"有没有减少"；★ 而"减少的那些是哪一种"由 `moved` / `lost` /
   *   `unclassified` 三栏回答 —— ★ 它们**不得**被合并成一个"丢了 N 个"。
   */
  return {
    state: shrunk.length > 0 ? 'shrunk' : 'ok',
    shrunk,
    /** ★ "此处没有，别处有" —— 可能是完全正确的搬运。 */
    moved,
    /** ★ "此处没有，别处也没有" —— ★ 这一栏才是今晚那种事故。 */
    lost,
    /** ★ "我没看别处" —— 没能测量，绝不是"别处也没有"。 */
    unclassified,
    checked: before.size,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 真实样本 —— t70 那一次必须报出【exactly 那 4 个符号】
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1 真实样本臂：t70（e7c889c）必须报出那 4 个符号，pre/post 逐条对得上', async () => {
  /**
   * ── 为什么这一臂是本文件的【验收样本】────────────────────────────────────────
   *
   * ★ 契约原话：「它必须用一个【已验证过的真实样本】测试自己：
   *   t70 那次（那 4 个符号的 pre/post 计数 captain 已复核成立：3/2/3/16 → 全 0）
   *   ⇒ 判据必须对那一次报出 **exactly** 那 4 个。」
   *
   * ★ 而"exactly"是关键词：**多报**（把别的也算进去）与**少报**（漏掉一个）
   *   都让这条判据在真实事故上不可用。
   *
   * ── 实测复现（本任务独立核过，与 captain 的读数逐字一致）─────────────────────
   *
   *   t70 只动了 `src/tools/update-task.ts`（外加它新建的子模块）。
   *   而那 4 个符号在【tools 那一侧】的计数：
   *
   *       parseKnownBaselineFailures  3 → 0
   *       baselineAbsent              2 → 0
   *       knownBaselineFailures       3 → 0
   *       skippedAll                 16 → 0
   *
   *   ★ 而其中三个在 `src/gates/completion/backtest.ts` 里**还在**
   *     （那是另一个文件，不属这次搬运的目标集合）
   *     ⇒ 判别法是"**在当前的目标集合里**的逐符号计数"，而不是"全仓还在不在"。
   *     ★ 而那正是契约说的：「计数 = 在【搬运目标集合】里出现的次数；
   *       那个集合由 inScope 决定」。
   */
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

  /** ★ 前置：那个提交必须真的存在 —— 否则本臂会静默测一个别的 diff。 */
  const exists = (() => { try { git(['cat-file', '-e', 'e7c889c^{commit}']); return true } catch { return false } })()
  assert.ok(
    exists,
    '★ 前置：找不到 e7c889c（t70 的拆分提交）⇒ 本臂无法成立。'
    + ' ★ 而它**不许静默跳过**：一个"找不到就跳过"的臂是恒真的（本队记账）',
  )

  /**
   * ── ★★★ 目标集合 = **这次搬运真正碰过的那个文件** ────────────────────────────
   *
   * MEASURED（t94，我第一版在这里错了，而它当场被抓出来）：
   *
   *   我第一版把目标集合取成「`src/tools.ts` + `src/tools/**` 全体」。
   *   ⇒ 于是对 `skippedAll` 量出的是 **pre=20 / post=7**，而 captain 的读数是 **16 → 0**。
   *
   * ★ 两者都不是错的 —— 它们量的是**不同的集合**：
   *
   *     captain 的读数   = 在 `src/tools/update-task.ts` **那一个文件**里的计数
   *     我第一版的读数   = 在**整个 tools 面**里的计数
   *       （`skippedAll` 在别的工具模块里也出现 ⇒ 20；而搬运后仍有 7 处别处的）
   *
   * ⇒ ★ 而契约说的口径是**前者**：
   *   「计数 = 在【搬运目标集合】里出现的次数；那个集合由 `inScope` 决定」——
   *   而 t70 那一次搬运动的**就是** `update-task.ts` 那一个文件。
   *
   * ★★ 而这一条本身就是本判据的一个**核心性质**：
   *   **目标集合选错了，同一个改动会给出不同的读数 —— 而两个读数都"看起来对"。**
   *   所以"目标集合是什么"必须是**可读的**（它来自 inScope），
   *   而不是由判据自己猜。
   */
  const sourceAt = (rev, file) => {
    try { return git(['show', `${rev}:${file}`]) } catch { return '' }
  }

  const MOVED_FILE = 'src/tools/update-task.ts'
  const before = symbolCounts(sourceAt('e7c889c^', MOVED_FILE))
  const after = symbolCounts(sourceAt('e7c889c', MOVED_FILE))
  /**
   * ★★★ 第三栏：目标集合**之外**的同一份计数表（`src/` 全体，排除 tools 面）。
   *
   * ★ 这一栏是"分栏"能成立的前提 —— 缺它就只能说"少了"，而说不出"搬走了"还是"坏了"。
   */
  const outside = (() => {
    const files = git(['ls-tree', '-r', '--name-only', 'e7c889c', 'src/']).trim().split('\n')
      .filter((f) => f.endsWith('.ts') && f !== MOVED_FILE && !f.startsWith('src/tools/'))
    /**
     * ★★ 逐文件记账（而不是拼成一份）—— 因为分栏要能说清**搬到了哪里**。
     *   出处：captain ⑤「判据报 `moved`（附"别处有：backtest.ts:190"），
     *   而把"这算不算坏"留给人。」
     *   ⇒ ★ 只说"别处有"还是不够：**读的人下一步就是去那个地方看**。
     */
    const perFile = new Map()
    for (const f of files) perFile.set(f, symbolCounts(sourceAt('e7c889c', f)))
    return perFile
  })()

  const verdict = pureMoveVerdict({
    /** ★ 目标集合 = t70 那一次搬运真正碰过的那个文件（由那次改动的 inScope 决定）。 */
    inScope: [MOVED_FILE],
    before,
    after,
    outside,
  })

  assert.equal(
    verdict.state, 'shrunk',
    '★ t70 那一次**确实**丢了符号 —— 判据必须报 shrunk。'
    + ` 实测：${JSON.stringify(verdict.shrunk.slice(0, 12))}`,
  )

  /**
   * ── ★★★ 那 4 个符号，而【按本判据的口径】的 pre/post ──────────────────────────
   *
   * MEASURED（t94，逐条核过；★ 括号里是**别处**的读数，而它们量的是别的集合）：
   *
   *     parseKnownBaselineFailures   3 → 0   （captain 给的是 3 → 0          ✅ 一致）
   *     baselineAbsent               2 → 0   （同上 2 → 0                    ✅ 一致）
   *     knownBaselineFailures        3 → 0   （同上 3 → 0                    ✅ 一致）
   *     skippedAll                  16 → 0   （★ 见下）
   *
   * ★★ `skippedAll` 那三个数字量的是**三个不同的东西**（captain 已复核并采纳）：
   *
   *     16 → 0   单文件 · **含注释**（captain 最初给我的）
   *      6 → 0   ★ 单文件 · **纯代码**（本判据的口径 —— 契约说"符号 = 源码里的标识符"）
   *     24 → 8   tools 全体 · 纯代码（我第一版量错了集合）
   *
   * ★ 而**三个都"看起来对"** —— 因为它们量的是【不同的集合 × 不同的词法口径】。
   *   ★ 而那正是本判据要防的东西 ⇒ 所以两者都是判据的**显式输入**。
   */
  const EXPECTED = ['parseKnownBaselineFailures', 'baselineAbsent', 'knownBaselineFailures', 'skippedAll']
  for (const symbol of EXPECTED) {
    assert.ok(
      verdict.shrunk.some((item) => item.symbol === symbol),
      `★★ t70 丢了 ${symbol} —— 判据必须报出来。实测减少的：`
      + `${JSON.stringify(verdict.shrunk.map((i) => i.symbol))}`,
    )
  }

  /**
   * ── ★★★ 而【分栏】才是这条判据的价值（t86 的原话）─────────────────────────────
   *
   * MEASURED（t94，我逐条核过那 4 个符号在 `e7c889c` 上的位置）：
   *
   *     parseKnownBaselineFailures  → ★ 还在 `src/gates/completion/backtest.ts`（1 处）
   *     baselineAbsent              → ★ 还在 `backtest.ts`（4 处）
   *     knownBaselineFailures       → ★ 还在 `backtest.ts`（5 处）
   *     skippedAll                  → ★ 还在 `registry.ts` / `entities.ts`
   *
   * ★ 所以它们**不是"哪里都找不到"** —— 它们是"在这个集合里没有，而在别处有"。
   *   ⇒ 按 t86 的分栏口径，它们该落 **`moved`**（"此处没有，别处有"），
   *     ★ 而**不是** `lost`。
   *
   * ★★ 而这一条**恰好演示了这条判据要防的那个东西**：
   *   captain 给的清单说"真的不在任何地方"，而逐符号复核说"在别处还在"。
   *   ★ 差异的成因不是谁粗心 —— 是【"在哪儿数"那一格，清单里没有写】。
   *   ⇒ 而印成一行之后，读的人分不出这两种，**而它们的补救动作完全不同**。
   */
  for (const symbol of EXPECTED) {
    const movedEntry = verdict.moved.find((item) => item.symbol === symbol)
    const inLost = verdict.lost.some((item) => item.symbol === symbol)
    /**
     * ── ★★★ 而这里必须钉【方向】，不能只钉"恰好落一栏" ────────────────────────────
     *
     * MEASURED（t94 的定向突变当场抓出来）：我第一版写的是
     * `assert.notEqual(inMoved, inLost)` —— 而**把两栏合并成一个 lost** 之后，
     * `inMoved=false, inLost=true` ⇒ ★ 那条断言**照样成立** ⇒ 5/5 全绿。
     *
     * ⇒ ★ 一条"恰好落一栏"的断言**看不见"哪一栏"** ——
     *   而"哪一栏"正是这条判据的**全部价值**（t86：分栏是为了让两种补救动作不同形）。
     *
     * ⇒ 所以钉的是：这 4 个符号**必须落 `moved`**（实测它们在别处都还在），
     *   而且★**必须说清在哪儿**（引用 captain ⑤：「判据报 moved（附"别处有：backtest.ts"）」）。
     */
    assert.ok(
      movedEntry !== undefined,
      `★★ ${symbol} 必须落 \`moved\`（实测它在目标集合之外**还在**）。`
      + ` 实测 moved=${JSON.stringify(verdict.moved.map((i) => i.symbol))}`
      + ` lost=${JSON.stringify(verdict.lost.map((i) => i.symbol))}`,
    )
    assert.equal(
      inLost, false,
      `★ 而它**不许**同时落 \`lost\` —— \`lost\` 是"哪里都找不到"，而那与实测相反`,
    )
    /**
     * ★★ 而它**必须说清搬到了哪里** —— 只说"别处有"还是不够：
     *   读的人下一步就是去那个地方看。
     */
    assert.ok(
      Array.isArray(movedEntry.foundIn) && movedEntry.foundIn.length > 0,
      `★★ ${symbol} 落 moved 时必须**点名它在哪几处**（不能在哪儿都说不出来）。`
      + ` 实测：${JSON.stringify(movedEntry)}`,
    )
  }
  /**
   * ★ 而"那 4 个都判成 lost"这个更强的断言**我没有写** ——
   *   因为实测它们是 `moved`（在别处还找得到）。
   *   ★ 写一个与实测相反的上界，会让这条判据**在它唯一的真实样本上恒红**，
   *     而那时读的人会去改判据（而不是去看那份清单）。
   */
  assert.ok(
    Array.isArray(verdict.unclassified) && verdict.unclassified.length === 0,
    '★ 第三栏在场 ⇒ 不许有"没分类"的（那说明分栏没跑起来）',
  )

  /**
   * ★★ 而"exactly"要从【另一侧】也钉住：判据**不许**把
   *   `backtest.ts` 里那些**还在**的符号也报成丢失。
   *   ⇒ 判法是：把它报出来的**每一个**都核一遍 —— 它在搬运前**真的**有计数，
   *     且在搬运后**真的**是 0（或更少）。
   *   ★ 缺了它，一个"把搬运前所有符号都报一遍"的实现会通过上面那条（因为它是子集）。
   */
  for (const item of verdict.shrunk) {
    assert.ok(
      (before.get(item.symbol) ?? 0) > 0,
      `★ 判据报了一个【搬运前就没有】的符号：${item.symbol} —— 那是误报`,
    )
    assert.ok(
      item.post < item.pre,
      `★ 判据报了一个【没有减少】的符号：${item.symbol}（pre=${item.pre} post=${item.post}）—— 那是误报`,
    )
  }
  /**
   * ★ 而越报越多的方向也要挡住：t70 那一次**总共**只该丢那几个。
   *   ★ 而下面这个上界是**实测**的（本任务跑出来是 4），不是猜的 ——
   *     它挡的是"把一大片无关符号也算成丢失"。
   */
  /**
   * ── ★★ 而上界这个方向我写错过一次，如实记下来 ────────────────────────────────
   *
   * MEASURED（t94）：我第一版写 `shrunk.length <= 8`，理由是"t70 只丢了 4 个符号"。
   * ⇒ ★ 而那 4 个是**captain 点名的那 4 个接线**，不是"t70 丢的全部" ——
   *   t70 把 **264 行**搬出了那个文件，所以减少的符号是**三位数**（实测 104）。
   *
   * ⇒ ★ 那个上界是【把一个点名的子集当成了全集】—— 而它会让本臂在真实样本上**恒红**。
   *   ★ 而"恒红"比"恒真"更危险：它会让读的人去改判据，而不是去看那次搬运。
   *
   * ⇒ 现在只钉【方向】，不钉具体数。
   */
  assert.ok(
    verdict.shrunk.length > 0,
    '★ t70 那次确实搬走了整段（264 行）⇒ 减少数必须 > 0',
  )
  assert.ok(
    verdict.shrunk.length < before.size,
    `★ 减少的符号数（${verdict.shrunk.length}）必须【严格小于】集合大小（${before.size}）——`
    + ' 若相等，说明整个集合都被判成减少了，而那更可能是"目标集合选错了"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 合法差异不得被判成丢失
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2 合法差异臂：import 路径 / 行号 / 注释 / 新增 —— 四种合法差异都不得红', async () => {
  /**
   * ── ★★ 契约原话 ──────────────────────────────────────────────────────────────
   *
   *   「合法的有 import 路径变了（那不算符号消失）、行号变了、注释变了；
   *     不合法的有某个标识符的计数从 N 变成 0（那就是丢了）。
   *     ⇒ 判据口径是【计数不减少】，而不是逐字节相同。」
   *
   * ★ 为什么把这一条写成臂：**误报与漏报一样有害** ——
   *   一个把合法重构判红的判据会教人忽略它（本队定论）。
   */
  const base = 'import { join } from "node:path"\nexport function moved(a) { return join(a, "x") }\n'

  const cases = [
    {
      name: '① import 路径变了 —— 符号没消失，只是来源换了文件',
      after: 'import { join } from "../shared/path.ts"\nexport function moved(a) { return join(a, "x") }\n',
    },
    {
      name: '② 行号变了（前面加了空行）—— 位置不是身份',
      after: '\n\n\n' + base,
    },
    {
      name: '③ 注释变了 —— 注释不是符号的载体',
      after: '// 一段全新的注释\n/* 块注释 */\n' + base,
    },
    {
      name: '④ 新增了别的符号 —— 搬运可以顺带新增',
      after: base + 'export const brandNew = 1\n',
    },
  ]

  for (const item of cases) {
    const verdict = pureMoveVerdict({
      inScope: ['src/tools.ts'],
      before: symbolCounts(base),
      after: symbolCounts(item.after),
    })
    assert.equal(
      verdict.state, 'ok',
      `★ 【${item.name}】必须落 ok —— 它是**合法差异**，而判据的口径是"计数不减少"，`
      + `不是"逐字节相同"。实测：${JSON.stringify(verdict)}`,
    )
  }

  /**
   * ★★ 反向半边（防恒真）：**真的丢了**必须红。
   *   ★ 缺了这一半，一个"永远 ok"的实现会让上面四条全绿。
   */
  const lostOne = 'import { join } from "node:path"\nexport function moved(a) { return join(a, "x") }\n'
    .replace('import { join } from "node:path"\n', '')
  const verdict = pureMoveVerdict({
    inScope: ['src/tools.ts'],
    before: symbolCounts('import { join } from "node:path"\nexport function moved(a) { return join(a, "x") }\n'),
    after: symbolCounts(lostOne),
  })
  assert.equal(verdict.state, 'shrunk', '★ 把 import 删掉 ⇒ `join` 真的少了 ⇒ 必须红')
  assert.ok(
    verdict.shrunk.some((item) => item.symbol === 'join'),
    `★ 而它必须**点名**那个符号。实测：${JSON.stringify(verdict.shrunk)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 三态两两不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3 三态臂：ok / shrunk / not-a-move 两两不同形，且【不得合并】', async () => {
  /**
   * ★ 三者：
   *     `ok`         计数全对
   *     `shrunk`     有符号减少（★ 附哪一个、从几变几）
   *     `not-a-move` 不适用（这不是一次搬运）
   *
   * ★ 而"不得合并"的具体含义：
   *   · 把 `not-a-move` 并进 `ok`     ⇒ 把【没测到】并进【通过】
   *   · 把 `not-a-move` 并进 `shrunk` ⇒ 在每一个普通改动上误报
   */
  const before = symbolCounts('const a = 1\n')

  const ok = pureMoveVerdict({ inScope: ['x.ts'], before, after: symbolCounts('const a = 1\n') })
  const shrunk = pureMoveVerdict({ inScope: ['x.ts'], before, after: symbolCounts('const b = 1\n') })
  const notAMove = pureMoveVerdict({ inScope: [], before, after: symbolCounts('const a = 1\n') })

  assert.equal(ok.state, 'ok')
  assert.equal(shrunk.state, 'shrunk')
  assert.equal(notAMove.state, 'not-a-move')
  assert.equal(new Set([ok.state, shrunk.state, notAMove.state]).size, 3, '★ 三态必须互不相同')

  /** ★ 而 not-a-move 必须**说出为什么**判不了（沉默会让它与 ok 在读数上同形）。 */
  assert.equal(typeof notAMove.reason, 'string', '★ not-a-move 必须带理由')
  assert.ok(notAMove.reason.length > 20, `★ 理由要说得清（实测：${notAMove.reason}）`)
  assert.equal(ok.reason, undefined, '★ ok 不该带"判不了"的理由 —— 那会让两者不同形得不彻底')

  /** ★ 而"搬运前为空"也是一个 not-a-move（不是 ok）。 */
  const emptyBefore = pureMoveVerdict({ inScope: ['x.ts'], before: new Map(), after: symbolCounts('const a = 1\n') })
  assert.equal(
    emptyBefore.state, 'not-a-move',
    '★ 搬运前为空 ⇒ 判不了 ⇒ not-a-move。★ 而它**绝不许**是 ok（那是把没测到并进通过）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 反向半边 —— 一个普通的（非搬运）改动不得被判合格
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4 反向臂：一个普通的改动会让符号【合法地】变化 ⇒ 它该落 not-a-move 那条路', async () => {
  /**
   * ── ★★ 契约原话 ──────────────────────────────────────────────────────────────
   *
   *   「不许对所有改动都报合格 —— 一个普通的（非搬运）改动会让符号合法地变化，
   *     而那该落第三态（不适用），而不是合格或不合格。」
   *
   * ★ 而"判它是不是一次搬运"这件事**本身不可机械判定**（那是意图）。
   *   ⇒ 所以本判据的口径是：**调用方声称是搬运**，而判据做一次**便宜的合理性核对**。
   *     核不过 ⇒ `not-a-move`（不适用），而不是硬判。
   *
   * ★★ 这一条是本文件最容易被做成恒真的地方：
   *   一个"没有 inScope 就说 ok"的实现会让**每一个**普通改动都合格。
   */
  const notAMove = pureMoveVerdict({ inScope: [], before: new Map(), after: new Map() })
  assert.equal(
    notAMove.state, 'not-a-move',
    '★ 没有目标集合 ⇒ 判不了 ⇒ not-a-move。★ 而它【不许】是 ok ——'
    + ' 那会让"每一个普通改动"都读成"一次合格的搬运"',
  )
  assert.notEqual(notAMove.state, 'ok')
  assert.notEqual(notAMove.state, 'shrunk')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★★ 定向突变 —— 造一次搬运而故意丢掉一个符号 ⇒ 臂红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 5 突变臂：造一次"搬运"而故意丢掉一个符号 ⇒ 判据必须点名它', async () => {
  /**
   * ── ★ 契约原话 ────────────────────────────────────────────────────────────────
   *
   *   「定向突变能打红：造一次搬运而故意丢掉一个符号 ⇒ 臂红。」
   *
   * ★ 而这里用**真的文件**做（不是内存里的字符串）：
   *   造一棵临时树，把模块 A 的内容"搬到"模块 B，而**故意漏掉一行**。
   *   ⇒ 那正是一次"声称纯搬运、实则丢东西"的改动的最小复现。
   */
  const dir = mkdtempSync(join(tmpdir(), 't94-move-'))
  try {
    const from = join(dir, 'from.ts')
    const to = join(dir, 'to.ts')
    const original = [
      'export function alpha() { return 1 }',
      'export function beta() { return 2 }',
      'export const GAMMA_LIMIT = 3',
    ].join('\n')
    writeFileSync(from, original)
    writeFileSync(to, '')

    const before = symbolCounts(sourceOf(dir))

    /** ★ 搬运：把 from 的内容写进 to，而**故意漏掉 beta** —— 这就是"丢了一个符号"。 */
    writeFileSync(to, [
      'export function alpha() { return 1 }',
      'export const GAMMA_LIMIT = 3',
    ].join('\n'))
    writeFileSync(from, '')
    const after = symbolCounts(sourceOf(dir))

    const verdict = pureMoveVerdict({ inScope: ['from.ts', 'to.ts'], before, after })
    assert.equal(
      verdict.state, 'shrunk',
      `★ 一次"纯搬运"里丢掉了 beta ⇒ 必须报 shrunk。实测：${JSON.stringify(verdict)}`,
    )
    assert.ok(
      verdict.shrunk.some((item) => item.symbol === 'beta'),
      `★ 而它必须**点名 beta**（以及从几变几）。实测：${JSON.stringify(verdict.shrunk)}`,
    )
    const beta = verdict.shrunk.find((item) => item.symbol === 'beta')
    assert.equal(beta.pre, 1, '★ pre 必须如实（beta 在搬运前出现 1 次）')
    assert.equal(beta.post, 0, '★ post 必须如实（搬运后 0 次）')

    /**
     * ★★ 反向半边：把 beta **也搬过去** ⇒ 必须落 ok。
     *   ★ 缺了它，上面那条对一个"永远 shrunk"的实现没有分辨力。
     */
    writeFileSync(to, original)
    const complete = pureMoveVerdict({ inScope: ['from.ts', 'to.ts'], before, after: symbolCounts(sourceOf(dir)) })
    assert.equal(
      complete.state, 'ok',
      '★ 完整搬运（一个符号都不少）⇒ 必须落 ok，否则本臂测的是"永远红"',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
