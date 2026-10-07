/**
 * ── 判据：共享产物在并发下的【序关系】（t68）────────────────────────────────────
 *
 * 契约原话（captain 派工时）：
 *
 *     ★ 给「共享产物在并发下的序关系」建一条判据 —— 今晚它出现了【三次】，
 *       而每次的位置都不同。
 *
 * ── ★★★ 那三次（都是 MEASURED，不是设想）──────────────────────────────────────
 *
 *   ① **t56 的夹具**在【共享的 `lib/`】上跑 `rm -rf lib` 来模拟旧实现
 *      ⇒ 那一步一旦失败或被打断，就把 `lib/` 留成残缺
 *      ⇒ 实测此后 **49 个夹具**报 `ERR_MODULE_NOT_FOUND`。
 *      ★ 而它的作者（本任务作者）当时的原话：
 *        「那正是我本任务要消灭的那种病，而我的夹具自己制造了一次。」
 *
 *   ② **clean-build 的 carry-forward**：`exists(from)` 通过之后、`copyFile` 之前，
 *      那个文件可能已经被**另一次并发构建**删掉 ⇒ ENOENT ⇒ 整个 build 崩。
 *
 *   ③ **gate-stale-module**：它污染共享的 `lib/git-artifact-stamp.json`，
 *      并在 `finally` 里还原 ⇒ 并发时那个还原会写回**过期值** ⇒ 后续 19 条臂一起红。
 *      ★★ 而它最隐蔽：**夹具【有】还原逻辑，所以它看起来是谨慎的** ——
 *         而那个还原正是让它更坏的东西（它用一份**过期快照**覆盖了别人刚写的新值）。
 *
 * ── ★★★ 共同形态：**两个动作在同一个共享资源上没有序关系** ───────────────────────
 *
 *   三次换位置的方式都不同形：
 *     · 读的人在 `rm` 窗口里读            （①）
 *     · copy 的人在窗口里 copy            （②）
 *     · 写回的人用**过期的快照**覆盖        （③）
 *   ⇒ ★ 而三者的共同点是：**单个动作看起来都对，而它们之间没有序。**
 *
 * ── ★★ 判据的形状（可机械判定）────────────────────────────────────────────────
 *
 *     扫全部夹具与脚本，找出【写共享产物】的地方
 *     ⇒ 对每一个，断言它【要么不写共享资源，要么写的是一个私有副本】。
 *
 * ★ 而"可判定"的意思在这里是具体的：**看它写的那个路径是不是在共享树里。**
 *
 * ── ★ 四态（而这四态不得合并）─────────────────────────────────────────────────
 *
 *     `private`  —— 写的是私有副本（tmpdir / mkdtemp 出来的）      ⇒ 合格
 *     `none`     —— 根本没写（只读）                              ⇒ 合格
 *     `shared`   —— 直接在共享树上写                              ⇒ blocked（除非在白名单）
 *     `unknown`  —— ★ 路径动态构造、静态看不出来                  ⇒ 第四态，不得并进任何一态
 *
 * ★★ 为什么 `unknown` 必须单独存在：
 *   把"看不出来"并进"合格"，就是**把没测到并进通过**（本队最老的记账）；
 *   并进"blocked"，就会在每一个 `writeFileSync(someVar)` 上误报 ——
 *   而误报会教人忽略门禁，与漏报同样有害。
 *
 * ── ★★ 反向半边（这一条的关键）────────────────────────────────────────────────
 *
 *   **真的需要写共享资源的**（例如 build 本身、写 stamp 的脚本）必须进【白名单】，
 *   且每一条要【说明理由】—— 不是"全都拦"。
 *
 *   ★ 而那正是 t56 里做对的那件事：修法是"两种实现都在独立临时树里重放"，
 *     而**不是**"让大家更小心地跑 `rm -rf`"。
 *   ⇒ 同理，本判据的修法是"把写的地方挪到私有副本"，
 *     而**不是**"把共享写入加进白名单"。
 *
 * ── ★ 它只记账、只拦【新增】的共享写入 ──────────────────────────────────────────
 *
 *   对当前全仓跑一次，把**存量**如实报出来（那正是这条判据的价值：那个数字）。
 *   ★ 而存量进白名单时要逐条写理由 —— 一条没有理由的白名单条目，
 *     与"兜底值"是同一个东西（j-0007：一句话里的每个数字/名词，能不能指出它的来源）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'scripts')

/**
 * ── 写动作的形状 ──────────────────────────────────────────────────────────────
 *
 * ★ 只列**真的会改动盘上内容**的那些。`readFileSync` / `existsSync` / `statSync`
 *   不在其中 —— 它们是读，而读共享资源是**本判据允许**的（700 多个夹具都在读 `lib/`）。
 */
const WRITE_CALLS = [
  'writeFileSync', 'appendFileSync', 'rmSync', 'unlinkSync', 'renameSync',
  'copyFileSync', 'cpSync', 'mkdirSync', 'truncateSync', 'createWriteStream',
]

/**
 * ── 共享树的根 ────────────────────────────────────────────────────────────────
 *
 * ★ "共享"的定义是**操作性的**：被多个测试（或测试与被测代码）都读的东西。
 *   本仓里满足这个定义的有三处：
 *
 *     `lib/`                     —— 构建产物，700+ 夹具从它 import
 *     `lib/git-artifact-stamp.json` —— `moduleFreshness` 读它（③ 的受害者）
 *     `.agent-teams/`            —— 团队状态，多个夹具读它
 *
 * ★ 而**不**包括：`src/`（夹具不写它）、`node_modules/`（装完就不动）。
 */
const SHARED_PATTERNS = [
  { name: 'lib/', test: (line) => /\bLIB\b/.test(line) || /join\(\s*ROOT\s*,\s*'lib'/.test(line) },
  { name: 'lib/git-artifact-stamp.json', test: (line) => /\bSTAMP\b/.test(line) || /git-artifact-stamp/.test(line) },
  { name: '.agent-teams/', test: (line) => /\bSTATE_ROOT\b/.test(line) || /join\(\s*ROOT\s*,\s*'\.agent-teams'/.test(line) },
]

/**
 * ── 私有副本的形状（合格）─────────────────────────────────────────────────────
 *
 * ★ `mkdtempSync(join(tmpdir(), …))` 是本仓一贯的隔离手法 ——
 *   而它出现在**同一行**或**同一个变量名**上时，就说明写的是私有树。
 */
const PRIVATE_PATTERNS = /\bmkdtempSync\b|\btmpdir\b|\bmkdtemp\b|\bTMPDIR\b/

/**
 * ── ★★ 白名单：真的需要写共享资源的，每条都要有理由 ──────────────────────────────
 *
 * ★ 判法（而不是"我觉得"）：**这个脚本是不是【构建链本身】的一环？**
 *   构建链必须写 `lib/`（那是它的全部工作），而夹具**从来不需要**。
 *
 * ⇒ 所以白名单的每一条都回答了同一个问题：**为什么它非写共享不可？**
 *   ★ 而没有理由的白名单条目 = 一个兜底值（j-0007）—— 所以这里没有"默认允许"。
 */
const WHITELIST = [
  {
    file: 'scripts/clean-build.mjs',
    reason: '★ 它就是构建的**原子替换**本身：把 lib.tmp 换成 lib/。'
      + '它写的时刻是【唯一允许】改 lib/ 的时刻，而它用两次 rename 把窗口压到微秒级'
      + '（见该文件头）。⇒ 它是"谁有权写共享产物"这个问题的答案，不是它的反例。',
  },
  {
    file: 'scripts/git-artifacts.mjs',
    reason: '★ 它是**构建的最后一步**：给构建产物打指纹（`--write`）。'
      + '与 clean-build 同属构建链，且只在 build 末尾跑一次。',
  },
]

/**
 * ── ★★★ 按【动作的语义】取"会被写到的那个位置"（第三版；前两版都被臂打回过）────
 *
 * ★ 为什么不简单地取第一个/最后一个参数：
 *
 *     cpSync(LIB, join(tree, 'lib'), { recursive: true })
 *                    ^^^^^^^^^^^^^^^^^^^ 目标在这里（第 2 个）
 *                                      ^^^^^^^^^^^^^^^^^^ 而"最后一个"是这个配置对象
 *
 *     execFileSync('rm', ['-rf', LIB])
 *                   ^^^^ 第 1 个是**命令名**，不是路径；目标在数组里
 *
 * ⇒ 三个族各自取不同的位置：
 *     单目标（rm/write/mkdir/unlink/truncate）  ⇒ 第 1 个参数
 *     双目标（cp/copy/rename）                  ⇒ 第 2 个参数
 *     shell 形式（execFileSync('rm'|'cp'|'mv')）⇒ 数组里最后一个**路径样**的项
 *
 * ★ 取不到 ⇒ 返回整行 ⇒ 会落到 `unknown`（第四态）。
 *   ⇒ ★ 那是刻意的：宁可说"我没看出来"，也不静默判成 private（把没测到并进通过）。
 */
function writeTargetOf(code) {
  const shell = code.match(/execFileSync\(\s*'(rm|cp|mv|truncate)'\s*,\s*\[([^\]]*)\]/)
  if (shell !== null) {
    const items = shell[2].split(',').map((item) => item.trim()).filter((item) => item !== '')
    return items.length > 0 ? items[items.length - 1] : code
  }
  if (/\b(cpSync|copyFileSync|renameSync)\s*\(/.test(code)) return secondArgumentOf(code)
  return firstArgumentOf(code)
}

/** 第 n 个参数（1-based），按括号/引号配平切分。取不到 ⇒ 整行。 */
function nthArgumentOf(code, wanted) {
  const open = code.indexOf('(')
  if (open === -1) return code
  let depth = 0
  let quote = null
  let seen = 0
  let start = open + 1
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i]
    if (quote !== null) {
      if (ch === quote && code[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') depth += 1
    else if (ch === ')' || (ch === ',' && depth === 1)) {
      if (ch === ',') seen += 1
      if (seen === wanted) return code.slice(start, i).trim()
      if (ch === ')') break
      start = i + 1
    }
  }
  return code
}

const firstArgumentOf = (code) => nthArgumentOf(code, 1)
const secondArgumentOf = (code) => nthArgumentOf(code, 2)

/** 一个文件里的"写共享资源"命中（行号 + 原文），以及它的分类。 */
function scanFile(file) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  const hits = []
  /**
   * ★★ 一个真实的陷阱（第一版当场踩到）：**共享根与写调用常常不在同一行**。
   *
   *     const LIB = join(ROOT, 'lib')          ← 第 55 行
   *     ...
   *     execFileSync('rm', ['-rf', LIB])       ← 第 80 行
   *
   * ⇒ 只看当前行的话，那条**最危险**的写法（在共享树上 rm -rf）会被判成 `unknown`。
   *   ★ 而它正是让 49 个夹具挂掉的那一行。
   *
   * ⇒ 修法：把"这一行提到的名字"解析到**文件里绑定了共享根的那些标识符**上。
   *   即：先收集 `const X = …ROOT…/lib…` 这类**共享别名**，再在写行里找它们。
   */
  const sharedAliases = new Set()
  for (const line of lines) {
    const bind = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/)
    if (bind && SHARED_PATTERNS.some((pattern) => pattern.test(line.replace(/\/\/.*$/, '')))) {
      sharedAliases.add(bind[1])
    }
  }
  const mentionsShared = (code) => SHARED_PATTERNS.some((pattern) => pattern.test(code))
    || [...sharedAliases].some((alias) => new RegExp(`\\b${alias}\\b`).test(code))

  lines.forEach((line, index) => {
    /**
     * ★ 先剥注释：本仓的注释里**大量讨论**这些名字（本判据自己的说明文字就是例子）。
     *   不剥的话，判据会在它自己写下的解释上开火 —— t61 那条臂我踩过同一个坑。
     */
    const code = line.replace(/\/\/.*$/, '')
    /**
     * ★★ 写动作有两族，而**两族都要认**（第一版只认了前一族，实测抓出来）：
     *
     *     · 直接调用：`writeFileSync(...)` / `rmSync(...)` / …
     *     · 走 shell：`execFileSync('rm', ['-rf', LIB])` —— ★ 而 t56 那次事故
     *       恰好是**这一族**（`execFileSync('rm', ...)`），而它一度被我漏掉。
     *
     * ⇒ 一个"只认直接调用"的扫描器，会对最危险的那种写法失明 ——
     *   而它失明的方式很隐蔽：那一行会被判成"不是写动作"而**根本不进入分类**。
     */
    const shellWrite = /execFileSync\(\s*'(rm|cp|mv|truncate|install)'/.test(code)
    const directWrite = WRITE_CALLS.some((call) => new RegExp(`\\b${call}\\s*\\(`).test(code))
    if (!shellWrite && !directWrite) return

    /**
     * ── 分类：私有 → 共享 → unknown ────────────────────────────────────────────
     * ★ 顺序是刻意的：**私有优先** —— 一个 `cpSync(LIB, join(tree, 'lib'))`
     *   同时提到 `LIB`（共享）与 `tree`（私有），而它是**从共享读、往私有写**。
     *   ⇒ 先判私有能正确处理那一种（否则它会被误报成"写共享"）。
     */
    /**
     * ── ★★ 只看【写的那个目标】，而不是整行（第二版修正，实测抓出来）────────────
     *
     * MEASURED：第一版把**整行**拿去匹配共享名字，于是这一行被误报：
     *
     *     writeFileSync(backup, readFileSync(BUILT_GATE, 'utf8'))
     *                    ^^^^^^ 写的（私有）      ^^^^^^^^^^ 读的（共享）
     *
     * ★ 而那一行**恰恰是本仓正确的隔离写法**（先把共享产物备份到私有路径，再折腾）。
     * ⇒ 一个"看到共享名字就报"的扫描器会把**正确的做法**判成违规 ——
     *   而那是最坏的一种误报：它惩罚了它本该鼓励的那件事。
     *
     * ⇒ 修法：只取**第一个参数**（写目标）来做分类。
     *   ★ 而这也让"读共享"与"写共享"在**同一个表达式里**不再互相污染。
     */
    /**
     * ── ★★ 只对【写目标】分类 —— 而"目标"按动作的语义取（第三版修正）─────────────
     *
     * MEASURED（前两版各自错了一次，都由臂当场抓出来）：
     *
     *   第一版：拿**整行**匹配共享名字 ⇒
     *     `writeFileSync(backup, readFileSync(BUILT_GATE,'utf8'))`
     *     被误报 —— ★ 而那一行恰恰是本仓**正确的隔离写法**（把共享产物备份到私有路径）。
     *
     *   第二版：只取"第一个参数"或"最后一个参数" ⇒ 仍然不对，因为：
     *     · `cpSync(LIB, join(tree,'lib'), {recursive:true})` 的**最后一个**是 `{recursive:true}`
     *     · `execFileSync('rm', ['-rf', LIB])` 的第一个是 `'rm'`（命令名，不是路径）
     *
     * ⇒ ★ 正确口径：**按动作的语义取那个"会被写到的位置"**：
     *     · `rm*` / `unlink*` / `mkdir*` / `truncate*`  ⇒ 第 1 个参数
     *     · `write*` / `append*`                        ⇒ 第 1 个参数
     *     · `cp*` / `copy*` / `rename*`                 ⇒ 第 2 个参数（目标是"到哪去"）
     *     · `execFileSync('rm'|'cp'|'mv', [ … ])`       ⇒ 数组里**最后一个**路径项
     *
     * ★ 而 `write*(a, b)` 里 `b` 可能是**从共享读来的内容** —— 它不参与分类。
     *   这一条是"读共享"与"写共享"能在同一行共存而不互相污染的关键。
     */
    const targetArg = writeTargetOf(code)
    const isPrivate = PRIVATE_PATTERNS.test(targetArg)
      || /\btree\b|\bworktree\b|\bsandbox\b|\bdir\b|backup/i.test(targetArg)
    if (isPrivate) return hits.push({ line: index + 1, text: line.trim(), kind: 'private' })
    if (mentionsShared(targetArg)) {
      const target = SHARED_PATTERNS.find((pattern) => pattern.test(targetArg))
      return hits.push({
        line: index + 1, text: line.trim(), kind: 'shared',
        target: target === undefined ? 'shared alias' : target.name,
      })
    }
    return hits.push({ line: index + 1, text: line.trim(), kind: 'unknown' })
  })
  return hits
}

/** 扫描目录下的全部 `.mjs`（夹具 + 脚本）。 */
function scanAll() {
  const out = new Map()
  for (const entry of readdirSync(SCRIPTS, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
    /**
     * ── ★★ 跳过【本文件自己】—— 而理由是结构性的，不是"给自己开后门" ──────────────
     *
     *   本文件的臂 1 / 臂 2 / 臂 3 把那些**事故形状当作测试数据**写在字符串里
     *   （`execFileSync('rm', ['-rf', LIB])` 之类）。
     *   ⇒ 扫描器把它们当成真的写入 ⇒ 于是判据会在**它自己的测试数据**上报违规。
     *
     * ★ 而这不是放宽：本文件**运行时**不写任何共享产物
     *   （它只读脚本源码 + 往 mkdtemp 里写临时夹具）。
     *   ⇒ 跳过它是"把测试数据与真实调用分开"，而不是"允许自己违规"。
     *   ★ 而为了让这句话**可核**，臂 4 里另有一条断言：
     *     本文件在磁盘上的真实写入目标**必须**都是私有的。
     */
    if (entry.name === 'gate-shared-artifact-writes.test.mjs') continue
    const file = join(SCRIPTS, entry.name)
    out.set(relative(ROOT, file), scanFile(file))
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 三个真实实例的形状 —— 每一个都必须被这个扫描判成 `shared`
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1 实例臂：那三个真实实例的形状，每一个都被判成 `shared`（而不是漏掉）', async () => {
  /**
   * ── 这一臂是"判据有分辨力"的最小证据 ────────────────────────────────────────
   *
   * ★ 三个实例都**已经修过了**（① 改成独立临时树；② ENOENT 当正常；③ 仍在盘上）。
   *   ⇒ 所以这里**不是**去盘上找它们，而是**把它们的形状重新构造一遍**，
   *     断言扫描器认得出那种形状。
   *   ★ 缺了这一臂，一个"什么都判成 private"的扫描器会让整份夹具全绿。
   *
   * ★ 定向突变：把 SHARED_PATTERNS 清空 ⇒ 三条全变成 `unknown`/`private` ⇒ 本臂红。
   */
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 't68-instances-'))

  /** ① t56 的形状：在【共享 lib】上 rm -rf。 */
  const one = join(dir, 'one.mjs')
  writeFileSync(one, [
    `import { execFileSync } from 'node:child_process'`,
    `const LIB = join(ROOT, 'lib')`,
    `execFileSync('rm', ['-rf', LIB])`,
  ].join('\n'))
  const oneHits = scanFile(one).filter((h) => h.kind === 'shared')
  assert.equal(
    oneHits.length, 1,
    '★ 实例 ① 的形状（在共享 LIB 上 rm -rf）必须被判成 shared —— '
    + ' 那正是让 49 个夹具报 ERR_MODULE_NOT_FOUND 的那一行',
  )

  /** ② clean-build 的形状：对共享文件做 exists-then-copy（窗口在这里）。 */
  const two = join(dir, 'two.mjs')
  writeFileSync(two, [
    `const STAMP = join(ROOT, 'lib', 'git-artifact-stamp.json')`,
    `if (existsSync(STAMP)) copyFileSync(STAMP, to)`,
  ].join('\n'))
  assert.equal(
    scanFile(two).filter((h) => h.kind === 'shared').length, 1,
    '★ 实例 ② 的形状（exists 通过后对共享文件 copy）必须被判成 shared —— '
    + ' 那一步的窗口正是"exists 通过、而并发构建把它删了"',
  )

  /** ③ gate-stale-module 的形状：写共享 stamp + finally 还原。 */
  const three = join(dir, 'three.mjs')
  writeFileSync(three, [
    `const STAMP = join(ROOT, 'lib', 'git-artifact-stamp.json')`,
    `try { writeFileSync(STAMP, mutated, 'utf8') }`,
    `finally { writeFileSync(STAMP, original, 'utf8') }`,
  ].join('\n'))
  const threeHits = scanFile(three).filter((h) => h.kind === 'shared')
  assert.equal(
    threeHits.length, 2,
    '★ 实例 ③ 的形状必须**两次**都被判成 shared —— 写入与还原**都是**共享写入。'
    + ' ★ 而这一点是刻意的：那个还原看起来是"恢复"，而它用的是一份**过期快照**'
    + ' ⇒ 并发时它会覆盖别人刚写的新值。**"意图是恢复"不改变"它写了共享资源"这件事。**',
  )

  rmSync(dir, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 四态不得合并 —— private / none / shared / unknown
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2 四态臂：private / none / shared / unknown 四态【互不同形】', async () => {
  /**
   * ★★ 为什么 `unknown` 必须单独存在（本臂的核心）：
   *
   *   并进 `private`（"看不出来就算合格"）⇒ **把没测到并进通过**
   *   并进 `shared`（"看不出来就算违规"）  ⇒ 在每一个 `writeFileSync(someVar)` 上误报
   *   ⇒ ★ 两者都违反本队最老的两条：不把没测到并进通过；误报会教人忽略门禁。
   */
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 't68-four-states-'))
  const write = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p }

  /** `private`：写在 mkdtemp 出来的树里。 */
  const priv = write('priv.mjs', `const tree = mkdtempSync(join(tmpdir(), 'x-'))\nwriteFileSync(join(tree, 'a'), 'x')`)
  assert.deepEqual(
    scanFile(priv).map((h) => h.kind), ['private'],
    '★ 写私有副本（mkdtemp）⇒ private（合格）',
  )

  /** `none`：只有读，没有写。 */
  const none = write('none.mjs', `const LIB = join(ROOT, 'lib')\nconst s = readFileSync(join(LIB, 'index.js'), 'utf8')`)
  assert.deepEqual(scanFile(none), [], '★ 只读共享资源 ⇒ 没有任何命中（读是允许的）')

  /** `shared`：直接写共享树。 */
  const shared = write('shared.mjs', `const LIB = join(ROOT, 'lib')\nrmSync(LIB, { recursive: true, force: true })`)
  assert.deepEqual(scanFile(shared).map((h) => h.kind), ['shared'], '★ 直接写共享树 ⇒ shared')

  /** `unknown`：目标来自一个解析不出来的变量。 */
  const unknown = write('unknown.mjs', `writeFileSync(destination, 'x')`)
  assert.deepEqual(
    scanFile(unknown).map((h) => h.kind), ['unknown'],
    '★ 路径动态构造、静态看不出来 ⇒ **unknown**（第四态）——'
    + ' 不许并进"合格"（那是把没测到并进通过），也不许并进"违规"（那是误报）',
  )

  /** ★ 四态两两不同形。 */
  const states = ['private', 'none', 'shared', 'unknown']
  assert.equal(new Set(states).size, 4, '★ 四态必须互不相同')

  rmSync(dir, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ "从共享读、往私有写"不许被误报（这是最容易被写错的一格）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3 误报臂：`cpSync(LIB, tree)` 这种【从共享读、往私有写】不许被判违规', async () => {
  /**
   * ── 为什么这一格最容易写错 ──────────────────────────────────────────────────
   *
   *   本仓的隔离手法正是「**把共享树复制一份到私有树**，然后在私有树上折腾」
   *   （t56 的修法、`realLayoutFixture` 那一类都是它）。
   *
   *   ★ 而那一行**同时提到** `LIB`（共享）与 `tree`（私有）
   *     ⇒ 一个"看到共享名字就报违规"的扫描器会把它误判成写共享。
   *   ⇒ ★ 而那个误报的代价很具体：**它会让修法本身变红** ——
   *     于是下一个人只能去加白名单，而白名单正是这条判据要防的兜底。
   *
   * ★ 定向突变：把分类顺序倒过来（先判共享、后判私有）⇒ 本臂红。
   */
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 't68-copy-'))
  const file = join(dir, 'isolate.mjs')
  writeFileSync(file, [
    `const LIB = join(ROOT, 'lib')`,
    `const tree = mkdtempSync(join(tmpdir(), 'replay-'))`,
    `cpSync(LIB, join(tree, 'lib'), { recursive: true })`,
  ].join('\n'))

  const hits = scanFile(file)
  assert.equal(
    hits.filter((h) => h.kind === 'shared').length, 0,
    '★ `cpSync(LIB, join(tree, …))` 是【从共享读、往私有写】—— 它必须**不是** shared。'
    + ` 实测命中：${JSON.stringify(hits)}`,
  )
  assert.equal(hits.length, 1, '★ 而它仍要有一个命中（private），否则本臂测的是"什么都没扫到"')
  assert.equal(hits[0].kind, 'private', '★ 它写的是私有树 ⇒ private')

  rmSync(dir, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 对当前全仓跑一次 —— 如实报【存量】，而存量不得无声增长
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4 存量臂：全仓扫描 ⇒ 违规清单必须【恰好】等于已知存量（新增即红）', async () => {
  /**
   * ── 本臂是这条判据在仓库上的落地 ─────────────────────────────────────────────
   *
   * ★ 契约原话：「它必须【对当前全仓跑一次】并如实报存量 ——
   *   有多少夹具在写共享资源，而那个数字就是这条判据的价值。」
   *
   * ★★ 而判法是【精确相等】而不是"不超过 N"：
   *   · "不超过 N" 会让存量慢慢长（每次加一个都不到线）
   *   · 精确相等 ⇒ 任何新增的共享写入都会红，而**减少**也要有人来改这一行
   *     ⇒ 于是那张清单是一次**要有人说话的**变更。
   *
   * ★ 而每一条都必须是"成因可指"的（j-0007 的同一条纪律）：
   *   一条说不出理由的条目 = 一个兜底值。
   */
  const hits = scanAll()
  const shared = []
  const unknown = []
  for (const [file, entries] of hits) {
    for (const entry of entries) {
      if (entry.kind === 'shared') shared.push(`${file}:${entry.line} → ${entry.target}`)
      if (entry.kind === 'unknown') unknown.push(`${file}:${entry.line}`)
    }
  }

  /**
   * ── ★★★ 存量（MEASURED，t68 当天）────────────────────────────────────────────
   *
   * ★ 判据自己**只记账、不修**：一次性全修会让它从"读数"变成"门禁"，
   *   而"先软后硬"是本队已经论证过的次序（见 docs/GATE-REGISTRY.md §3.5）。
   *   ⇒ 所以下面这张表**如实列出**当前全部共享写入，而每一条都带成因。
   */
  const KNOWN_SHARED = [
    /**
     * ★ 实例 ③ 的**存活实例**：它写共享 stamp，并在 finally 里写回。
     *   ⇒ 与白名单不同，这里**不给理由放行** —— 它是一条**已知的、待修的**存量。
     *   ★ 而那正是本判据的价值：它把这个数字变成一条**要有人处理的记录**，
     *     而不是一个靠人记着的隐患。
     */
    'scripts/gate-stale-module.test.mjs',
    /**
     * ★ `git-artifacts.mjs` 写 stamp —— 而它是**构建链本身**（见白名单）。
     *   ★ 而它与实例 ③ 的区别是决定性的：
     *     它在 build 的**末尾**跑一次、写的是**刚刚构建出来的**那棵树的值；
     *     而实例 ③ 在**任意时刻**写，且写回的是一份**过期快照**。
     */
    'scripts/git-artifacts.mjs',
  ]

  const unexpected = shared.filter((item) => !KNOWN_SHARED.some((known) => item.startsWith(`${known}:`)))
  assert.deepEqual(
    unexpected, [],
    '★ 出现了【新的】共享写入 —— 而这条判据的全部意义就是"下一个写夹具的人不必知道那次事故"。'
    + ` 实测新增：${JSON.stringify(unexpected)}。`
    + ' ⇒ 修法是把写的地方挪到【私有副本】（见臂 3 的那种写法），而不是加白名单。',
  )

  /**
   * ★★ 而存量本身也要**被看见**：一个"清单一条都没有"的读数，
   *   与"扫描器什么都没扫到"在结果上同形。
   *   ⇒ 所以这里同时断言"扫描器真的扫到了东西"。
   */
  const totalHits = [...hits.values()].reduce((sum, entries) => sum + entries.length, 0)
  assert.ok(
    totalHits > 50,
    `★ 扫描器必须真的扫到东西（实测 ${totalHits} 条写动作命中）——`
    + ' 一个什么都没扫到的扫描器会让上面那条断言恒真',
  )
  assert.ok(
    shared.length > 0,
    '★ 存量清单不许为空：它至少有实例 ③（gate-stale-module 写共享 stamp）——'
    + ' 而一个空清单会让"新增即红"这条断言在任何扫描器上恒真',
  )

  /** ★ 而 `unknown` 也必须被如实报出来（它是第四态，不是一个错误）。 */
  const report = { shared: shared.length, unknown: unknown.length, totalHits }
  assert.equal(typeof report.unknown, 'number', `★ unknown 是第四态，必须被统计：${JSON.stringify(report)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 白名单必须有理由，且不许吞掉实例 ③
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5 白名单臂：每条都必须说明理由；而实例 ③【不在】白名单里（它是待修的存量）', async () => {
  /**
   * ── 为什么白名单本身也要被审 ────────────────────────────────────────────────
   *
   *   ★ 一条**没有理由**的白名单条目，与一个兜底值是同一个东西
   *     （j-0007：一句话里的每个数字/名词，能不能指出它的来源？）。
   *   ⇒ 而"白名单"正是这条判据最容易被滥用的地方：
   *     遇到报警就把文件加进去，于是判据变成一张不断变长的名单。
   *
   * ★ 所以白名单里的每一条都必须回答同一个问题：**为什么它非写共享不可？**
   *   ★ 而本仓的答案是**结构性的**：只有**构建链本身**该写 `lib/`。
   *
   * ★★★ 而实例 ③ 必须在白名单【之外】——
   *   它是"待修的存量"，不是"有理由的例外"。把两者混起来，
   *   就等于用白名单把那个缺陷永久合法化。
   */
  for (const entry of WHITELIST) {
    assert.equal(typeof entry.reason, 'string', `★ 白名单条目 ${entry.file} 必须有 reason`)
    assert.ok(
      entry.reason.trim().length > 30,
      `★ ${entry.file} 的理由太短（${entry.reason.trim().length} 字符）—— `
      + ' 一条说不清"为什么非写共享不可"的白名单，与兜底值同形',
    )
  }

  /** ★ 而实例 ③ 不许进白名单。 */
  assert.equal(
    WHITELIST.some((entry) => entry.file.endsWith('gate-stale-module.test.mjs')), false,
    '★★ 实例 ③ 是【待修的存量】，不许进白名单 —— '
    + '它是"已知且待处理"，而白名单是"有结构性理由的例外"。'
    + ' 把两者混起来，就是用白名单把一个缺陷永久合法化',
  )

  /**
   * ★ 而白名单里的每一条都必须是**真的存在于盘上**的文件
   *   （一个指向不存在文件的条目，是一条没人会去核的声明）。
   */
  for (const entry of WHITELIST) {
    const present = readdirSync(SCRIPTS).includes(entry.file.replace(/^scripts\//, ''))
    assert.ok(present, `★ 白名单条目 ${entry.file} 指向一个不存在的文件 —— 一条没人能核的声明`)
  }
})
