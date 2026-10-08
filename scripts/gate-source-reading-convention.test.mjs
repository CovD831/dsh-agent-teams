/**
 * ── 判据：读 `src/**` 源码文本的夹具必须走【统一口径】（t87）─────────────────────────
 *
 * ── ★★★ 它防的是"同一个修复第二次发生"──────────────────────────────────────────
 *
 * MEASURED，今晚**两次**：
 *
 *   · **t39** 拆 `tools.ts`     ⇒ 15 个夹具在旧位置找已搬走的东西（★ 那次 captain 手动修的）
 *   · **t70** 拆 `update-task`  ⇒ 8 个夹具在旧位置找（18 条红）
 *
 * ★ 而两次的修法**相同**：改用 `scripts/tools-source.mjs` 的 `toolsSource()`
 *   （它是 `src/tools/**` 的递归 —— 所以它自动涵盖 `update-task/`）。
 *
 * ── ★★ 而真正的问题是：**为什么第一次修完之后，第二次还会发生？** ──────────────────
 *
 * ⇒ 因为第一次修的是【那 15 个夹具】，而**不是那个约定本身**。
 *   「读源码文本时要用统一口径」这句话**没有被任何东西强制** ——
 *   它是一条靠人记得执行的约定，而本项目的文档已经反复证明这类约定会腐烂。
 *
 * ★ 所以本判据的产出不是"又修了几个夹具"，而是**把那个约定变成机制**。
 *   ⇒ 它的价值就在下面那次**全仓普查**的数字里。
 *
 * ── ★★★ 判据的核心问句（captain 给的，而它是这条判据全部精度的来源）─────────────
 *
 *     那个夹具读这个文件，是为了【从它的文本里找某个东西】，
 *     还是为了【它本身】？
 *
 *     · 前者 ⇒ 该走统一口径（因为它关心的是"**生产的代码**里有没有这件事"，
 *              而那件事的落点会随重构移动 —— 它不该关心在哪个文件里）
 *     · 后者 ⇒ 该直接读（它要的**就是**那一个文件：数据文件 / 存在性 / 逐文件普查）
 *
 * ★ 这条问句把一个"看起来主观"的分类变成了**可机械判定的**：
 *   `readFileSync` 的结果**被用来做什么**，在源码里读得出来。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★★ 白名单：**确实该**直接读某个具体 `src/**` 文件的夹具 ────────────────────────
 *
 * ★ 每一条都必须带**理由**，而理由是**可核对的**（不是"我们决定放过它"）。
 *   ★ 一个没有理由的白名单与"把判据关掉"是同义的 —— 所以下面每条都写清
 *     "它为什么**不能**走统一口径"。
 */
const ALLOWED_DIRECT_READS = {
  /**
   * ── ★★ 白名单的键是**具体某一处**（file + 路径尾巴），不是整个文件 ──────────────
   *
   * MEASURED（本判据第一版在这里放过了 1 处）：第一版按**文件**白名单，于是
   * `gate-changed-paths-message.test.mjs` 因为"整体看还算规矩"而被整份免检 ——
   * 而它内部**同时**有一处写死读 `src/tools/update-task.ts`（那处**已经断了**）。
   *
   * ★ 形态：**一个文件的整体属性，替它内部的一行作了证** ——
   *   该问的是"**这一处**读得对不对"，而不是"**这个文件**像不像守规矩的"。
   *   （与本队记账的"守卫检查了另一个同名的东西"同族。）
   *
   * ⇒ 键写成 `<file>:<路径尾巴>`，判定落在**每一处**上。
   */
  'gate-r5.test.mjs:gates/completion/kind-requirements.json': 'reads the kind-requirements TABLE (data, not source text): it must know the file to parse it',
  'gate-r5-no-worktree.test.mjs:gates/completion/kind-requirements.json': 'reads the kind-requirements TABLE (data, not source text)',
  'gate-backtest-baseline.test.mjs:gates/completion/kind-requirements.json': 'reads the kind-requirements TABLE (data, not source text)',
  'gate-contract-verify-command.test.mjs:gates/contract/verify-command-rules.json': 'reads the verify-command RULES table (data, not source text)',
  /** ★ 测"工具被拆开"这件事本身的夹具 —— 它**必须**知道文件名。 */
  'gate-tool-split.test.mjs:tools.ts': 'its subject IS the split file layout — it must name the files to assert about them',
  /** ★ 逐文件普查：它按文件列判据，所以文件名**就是**断言的一部分。 */
  'verify-input-requires.test.mjs:gates/registry.ts': 'the census lists gates FILE BY FILE, so the file name is part of the assertion',
  /** ★ 统一口径的**定义处**：它当然要读 `src/tools.ts`。 */
  'tools-source.mjs:tools.ts': 'this IS the unified reader — reading src/tools.ts is its job',
  'gate-source-reading-convention.test.mjs:tools/something.ts': 'this IS the convention judge — it must name paths to check them',
  /**
   * ── ★★ 读【某一个判据自己的源码】找它自己的措辞 ⇒ 该直接读 ──────────────────────
   *
   * ★ 与"读 `src/tools/**` 找某个接线"不同：这里要的**就是那一个文件**的内容 ——
   *   那条措辞属于那条判据，而它**不会有**第二个落点（判据不会被拆到别处去）。
   *   ⇒ 统一口径在这里没有意义：`toolsSource()` 是给 `src/tools/**` 用的。
   */
  'gate-changed-paths-message.test.mjs:gates/dispatch/changed-paths.ts': "reads the wording out of ONE named gate's own source — that text belongs to that file and has no second location",
}

/**
 * ★★ 临时检出（`join(repo, 'src', …)` / `join(ws, 'src', …)`）**不在本判据范围内** ——
 *   那些是夹具自己造的仓库，不是本仓的源码面（落第三态 `unreadable`）。
 */
/** 一个"读源码文本"的调用点。 */
function scanDirectSrcReads(file, source) {
  const hits = []
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    /**
     * ★ 形状：`readFileSync(join(<ROOT>, 'src', …))` —— 即"路径里写死了 src 下的具体文件"。
     *   ★ 只认**同一行**内的形状：跨行的调用会让本判据需要解析器，
     *     而一个会被字符串字面量骗到的解析器比"少扫一条"更坏。
     */
    const match = /readFileSync\(\s*join\(\s*([A-Za-z_$][\w$]*)\s*,\s*'src'((?:\s*,\s*'[^']+')+)/.exec(line)
    if (match === null) continue
    /** ★ 路径的**根变量**决定它是不是"本仓的 src"：`ROOT` / `root` 是本仓；`repo` / `ws` 是临时检出。 */
    hits.push({
      line: index + 1,
      root: match[1],
      tail: match[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '').join('/'),
    })
  }
  return hits
}

/**
 * ── ★★ 那次普查（判据的价值所在）───────────────────────────────────────────────
 *
 * 三态，**互不同形**：
 *
 *   `unified`    —— 走统一口径（用了 `toolsSource()` / `toolsCode()`，或读的是白名单里那类东西）
 *   `hardcoded`  —— 写死了 `src/**` 下某个具体文件，而它要的是**文本里的东西** ⇒ **该改**
 *   `unreadable` —— 判不了（根变量不是本仓的 ⇒ 那是临时检出，不在本判据范围内）
 */
function survey() {
  const fixtures = readdirSync(join(ROOT, 'scripts'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(ROOT, 'scripts', name))

  const rows = []
  for (const file of fixtures) {
    const rel = `scripts/${relative(join(ROOT, 'scripts'), file)}`
    const source = readFileSync(file, 'utf8')
    const usesUnified = /\btoolsSource\s*\(|\btoolsCode\s*\(|\btoolsSourceFiles\s*\(/.test(source)
      || /from '\.\/tools-source\.mjs'|from '\.\.\/scripts\/tools-source\.mjs'/.test(source)
    for (const hit of scanDirectSrcReads(file, source)) {
      /**
       * ★ 根变量不是本仓的（`repo` / `ws` / `workspace` / `result`）⇒ 那是**临时检出**，
       *   不在本判据范围内（附条件）。★ 如实报第三态，而不是判它错。
       */
      const isThisRepo = hit.root === 'ROOT' || hit.root === 'root'
      /**
       * ★ 白名单按 **file:tail** 查（见上面那段实测）—— 落点是**这一处**，不是整个文件。
       */
      const key = `${rel.replace(/^scripts\//, '')}:${hit.tail}`
      const allowed = ALLOWED_DIRECT_READS[key] !== undefined
      /**
       * ── ★★ "这个文件已经引了统一口径" **不是**一条豁免（本判据第一版在这里放过了 1 处）──
       *
       * MEASURED：`gate-restart-arbitration.test.mjs` 引了 `toolsSource()`（3 处），
       * 而它**同时**在 533 行写死读 `src/tools/status.ts`。
       * 第一版按"用了统一口径"把**整个文件**标成免检 ⇒ 那一行被静默放过。
       *
       * ★ 形态：**一个文件的整体属性，替它内部的一行作了证** ——
       *   与本队记账的"守卫检查了另一个同名的东西"同族：
       *   该问的是"**这一行**读得对不对"，而它问的是"**这个文件**像不像守规矩的"。
       *
       * ⇒ 判定必须落在**每一行**上，与它所在文件的其他行无关。
       */
      const state = !isThisRepo ? 'unreadable' : allowed ? 'declared-exception' : 'hardcoded'
      rows.push({ file: rel, ...hit, usesUnified, state })
    }
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★★ 核心臂）：全仓普查 —— 存量如实报出
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（★★ 核心臂）：全仓普查，把"多少处直接读 src/**、其中多少处该走统一口径"如实报出', async (t) => {
  /**
   * ── 契约原话：「那个数字就是这条判据的价值」────────────────────────────────────
   *
   * ★ 而这一臂的**主要产出是那次 diagnostic**（存量读数）；断言只钉住**形状**：
   *   三态必须穷尽，且"该改的"必须被**逐条点名**。
   *
   * ── ★★★ 而它对本仓当前状态是【红的】，而那是**对的** ─────────────────────────
   *
   * MEASURED（本任务当场跑出来的存量）：全仓还有 **2 处**"读 `src/tools/**` 的文本
   * 去找某一句话"的地方 —— 而那正是 t39（15 处）与 t70（8 处）断掉的那个形状：
   *
   *     scripts/gate-changed-paths-message.test.mjs:398  读 src/tools/update-task.ts
   *       ★ 而那段代码**已经**搬到了 src/tools/update-task/dispatch.ts ⇒ 那一臂**此刻就是红的**
   *     scripts/gate-restart-arbitration.test.mjs:533   读 src/tools/status.ts
   *       ★ 而 `status.ts` 里的东西同样可能随时搬进 `src/tools/status/*.ts`
   *
   * ★ 所以本判据**第一次运行就抓到了第三次**（前两次是 t39 / t70）——
   *   它证明自己不是一条恒真的判据。
   *
   * ★★ 而这两处**不在本任务的 inScope 里**（inScope 只有本文件与那份文档）——
   *   所以本判据**如实报红**，把处置交给持有那些夹具写域的人。
   *   ⇒ 一个为了让自己的任务变绿而放宽这一条的实现，会把本判据最值钱的那个读数抹掉。
   */
  const rows = survey()
  const hardcoded = rows.filter((r) => r.state === 'hardcoded')
  const unreadable = rows.filter((r) => r.state === 'unreadable')
  const declared = rows.filter((r) => r.state === 'declared-exception')

  t.diagnostic(
    `t87 普查：全仓夹具共 ${rows.length} 处读本仓 \`src/**\` —— `
    + `白名单（有理由的直接读）${declared.length} · **该走统一口径的可疑处 ${hardcoded.length}** · `
    + `（临时检出，范围外）${unreadable.length}`,
  )
  for (const row of hardcoded) {
    t.diagnostic(`  ✗ 可疑：${row.file}:${row.line}  join('src', '${row.tail}')`)
  }

  /**
   * ★★ 硬断言：**没有一条**是"该改而没改"的。
   *   ★ 它在**今天**是红的 —— 因为上面那 2 处真的还没改（见文件头）。
   */
  assert.deepEqual(
    hardcoded.map((r) => `${r.file}:${r.line} join('src', '${r.tail}')`), [],
    '★★ 有夹具【直接读 src/tools/** 的文本】去找某一句话 ——\n'
    + '   那正是 t39（15 处）与 t70（8 处）两次断裂的形状：文件一搬走，它就在旧位置找。\n'
    + '   ⇒ 应改用 `scripts/tools-source.mjs` 的 `toolsSource()`（它是 src/tools/** 的递归）。\n'
    + '   ★ 而这 2 处**不在本任务的 inScope 内**（本任务只写"判据 + 文档"两个文件）——\n'
    + '     所以本判据如实报红，把处置交给持有那些夹具写域的人。逐条见上方 diagnostic。',
  )

  /**
   * ★ 反向自证（防恒真）：扫描器必须**真的能认出**一处"写死路径"。
   */
  const probe = "const x = readFileSync(join(ROOT, 'src', 'tools', 'something.ts'), 'utf8')"
  assert.equal(scanDirectSrcReads('probe.mjs', probe).length, 1,
    '★ 扫描器认不出一处写死的 src 读 —— 那它对什么都说"没问题"（恒真）')
  assert.equal(
    scanDirectSrcReads('probe.mjs', "const x = readFileSync(join(repo, 'src', 'parser.ts'), 'utf8')").length, 1,
    '★ 扫描器也要认得出"临时检出"那种（它落在第三态，不是漏扫）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 三态臂）：三态两两不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（★ 三态臂）：走统一口径 / 写死具体路径 / 无法判断 三者不得合并', async () => {
  /**
   * ★ 三态必须**互不同形**，否则"范围外的临时检出"会被判成"写死路径"（**误伤**）。
   */
  const rows = survey()
  const states = new Set(rows.map((r) => r.state))
  assert.ok(states.size >= 2, `★ 普查里至少要有两种状态（实测：${[...states].join(', ')}）`)

  /** ★ 而"临时检出"那一态真的有人落（本仓确实有自己造仓库的夹具）—— 否则它是形同虚设的。 */
  const unreadable = rows.filter((r) => r.state === 'unreadable')
  assert.ok(
    unreadable.length > 0,
    '★ 第三态必须真的有人落（本仓有夹具读自己造的临时检出）—— 若它恒为 0，'
    + ' "范围外"就会被静默并进"写死路径"，而那是误伤',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 断裂复现臂）：那个形状**真的**会断
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（★★ 断裂复现臂）：写死 `src/tools/<file>` 的夹具，在文件搬走时会断', async () => {
  /**
   * ── 这一臂把"为什么这条判据要存在"变成**可执行的**────────────────────────────────
   *
   * ★ 它不去动真实文件（那会留下残骸），而是**构造**那个形状并证明它断：
   *
   *     写死 `join(root, 'src', 'tools', 'update-task.ts')` 读文本
   *       ⇒ 而那段文本已经搬到 `src/tools/update-task/dispatch.ts`
   *       ⇒ 断言 `/gitChangedPaths:\s*observed\?\.paths/` **找不到它**
   *
   * ★ 而这就是 **t70 的重演**，也是**此刻真实存在的一处**（见臂 5 的存量读数）。
   */
  const { dirname: dn } = await import('node:path')

  /** ① 写死的路径（旧位置）。 */
  const hardcodedPath = join(ROOT, 'src', 'tools', 'update-task.ts')
  assert.equal(existsSync(hardcodedPath), true, '★ 前置：那个文件本身还在（它只是**不再含**那段代码）')
  const hardcodedText = readFileSync(hardcodedPath, 'utf8')

  /** ② 统一口径（`src/tools/**` 的递归）。 */
  const { toolsSource } = await import('./tools-source.mjs')
  const unifiedText = toolsSource()

  const needle = /gitChangedPaths:\s*observed\?\.paths/
  assert.equal(
    needle.test(hardcodedText), false,
    '★ 前置：那段代码**确实**已经不在旧位置了 —— 否则本臂测的不是"搬走"这件事',
  )
  assert.equal(
    needle.test(unifiedText), true,
    '★★ 而统一口径**找得到**它 —— 这就是两次断裂的修法：把"源码面"的定义收进一个地方，'
    + ' 让它随重构自动跟上（而不是让每一个夹具各自记住路径）',
  )
  void dn
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 白名单臂）：例外必须有理由，且理由必须可核对
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（★ 白名单臂）：白名单每一条都必须带**真正的**理由，且不许收"该改的"那类', async () => {
  /**
   * ★ 一个没有理由的白名单 = 把判据关掉。
   *   ⇒ 每一条理由都必须**说得清"它为什么不能走统一口径"**。
   */
  for (const [file, reason] of Object.entries(ALLOWED_DIRECT_READS)) {
    assert.equal(typeof reason, 'string')
    assert.ok(
      reason.trim().length >= 20,
      `★ 白名单条目 "${file}" 的理由太短（"${reason}"）—— 一句话理由与"我们决定放过"同义`,
    )
    /**
     * ★ 而理由必须**指名**它属于哪一类豁免（数据文件 / 拆分布局本身 / 逐文件普查 / 本仓外的临时检出）。
     *   ⇒ 一个含糊的理由（"它是特殊的"）会被这一条打回。
     */
    assert.match(
      reason,
      /data|table|split|census|temp|this IS|its subject|its own|own source|no second location/i,
      `★ 白名单条目 "${file}" 的理由没有说清它属于哪一类豁免："${reason}"`,
    )
  }

  /**
   * ★★ 反向半边（缺了它，白名单可以无限扩张）：白名单里**不许**出现
   *   "读 `src/tools/**` 的文本去找某一句话"那一类 ——
   *   那正是 t39/t70 断掉的东西，而它们**必须**走统一口径。
   */
  const forbidden = Object.keys(ALLOWED_DIRECT_READS).filter((key) => {
    const tail = key.slice(key.indexOf(':') + 1)
    /**
     * ★★ 禁的是【把 `src/tools/**` 的文本读】放进白名单 —— 那正是 t39/t70 断掉的形态。
     *
     * MEASURED（本臂第一版在这里红，而且**红得对**）：第一版按**文件名**禁
     * （`/gate-changed-paths-message|gate-restart-arbitration/`），于是它把
     * `gate-changed-paths-message` 那条**合法**的豁免（读 `gates/dispatch/changed-paths.ts`
     * 找那条判据自己的措辞）也一起禁了。
     *
     * ★ 形态：**它按"哪个文件"禁，而规则是"哪条路径"** —— 又一次"守卫检查了另一个同名的东西"。
     * ⇒ 现在按**路径尾巴**判：`tools.ts` / `tools/**` 一律不许豁免
     *   （唯一例外是统一口径的**定义处** `tools-source.mjs` 本身）。
     */
    if (!/^tools\.ts$|^tools\//.test(tail)) return false
    /**
     * ★★ 三个**正当**例外，各自都必须说得清"它要的就是那一个文件本身"：
     *
     *   · `tools-source.mjs`          —— 统一口径的**定义处**（读它就是它的工作）
     *   · `gate-source-reading-convention.test.mjs` —— 本判据自己的探针字符串
     *   · `gate-tool-split.test.mjs`  —— ★ 它的**被测对象就是这个文件的结构**：
     *        它断言"`src/tools.ts` 里不再出现 `ctx.tools.register(`" ——
     *        而那条断言**只有**读那一个具体文件才成立（读 `tools/**` 反而会让它失效，
     *        因为工具模块里**当然**有 register 调用）。⇒ 它是"为了它本身"那一类。
     */
    const justified = new Set([
      'tools-source.mjs',
      'gate-source-reading-convention.test.mjs',
      'gate-tool-split.test.mjs',
    ])
    return !justified.has(key.split(':')[0])
  })
  assert.deepEqual(
    forbidden, [],
    '★★ 把"读 src/tools/** 的文本找一句话"放进白名单 —— 那正是这条判据要防的形态，'
    + ' 放进白名单等于把判据关掉。\n  ' + forbidden.join('\n  '),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★ 实际存量臂）：点名当前真实存在的可疑处
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（★★ 实际存量臂）：当前可疑处必须逐条点名 —— 不许只报一个数字', async (t) => {
  /**
   * ── 这一臂与臂 1 的分工 ────────────────────────────────────────────────────────
   *
   *   臂 1 断言"形状上不许有可疑处"（若将来有人引入新的，它会红）
   *   本臂**列出当前每一处**并逐个核对它**读的是哪个文件** ——
   *   ★ 因为"一个数字"会在变化时无人察觉，而"哪一行"不会。
   */
  const rows = survey()
  for (const row of rows) {
    if (row.state !== 'hardcoded') continue
    t.diagnostic(`  ✗ ${row.file}:${row.line} → join('src', '${row.tail}')`)
  }

  /**
   * ★★ 而这其中**最有价值的一条**是那个**已经被搬走**的文件：
   *   一个夹具读 `src/tools/update-task.ts` 去找已经在 `update-task/dispatch.ts` 里的东西。
   *   ⇒ 本臂**认得出**它（不管它现在是不是红）。
   */
  const staleToolsReads = rows.filter((r) => r.tail.startsWith('tools'))
  for (const row of staleToolsReads) {
    const target = join(ROOT, 'src', 'tools', row.tail.slice('tools/'.length))
    const exists = row.tail === 'tools.ts' ? existsSync(join(ROOT, 'src', 'tools.ts')) : existsSync(target)
    t.diagnostic(`    · 读 src/${row.tail} —— 该文件${exists ? '存在' : '**不存在**'}（存在≠含那段代码：文件会搬走内容）`)
  }
  assert.ok(true, '本臂的产出是上方 diagnostic（逐条点名），不是布尔')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★ 附条件臂）：判据的适用范围写在判据本身里
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（★ 附条件臂）：适用范围（本仓 src/** / 非数据文件 / 非临时检出）写进判据本身', async () => {
  /**
   * ★ 与 t82 同一条纪律：特定条件起效的判据，必须把条件**顺便加上去**
   *   （用户 2026-08-08 的标准），而不是靠使用的人记得。
   */
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.match(self, /白名单/, '★ 必须写明例外机制是白名单')
  assert.match(self, /临时检出|temp checkout/, '★ 必须写明"临时检出不在范围内"（否则会误伤）')
  assert.match(self, /它本身|它\*\*就是\*\*那一个文件/, '★ 必须写清那条核心问句：为了"文本里的东西" vs 为了"它本身"')
})
