/**
 * ── `hmr-trace` 的夹具（`src/hmr-trace.ts`）──────────────────────────────────────
 *
 * ── 它在钉什么 ───────────────────────────────────────────────────────────────
 *
 * 这个模块的存在理由是**一条否则不可判定的问题**：
 *
 *     「我改了 src/ → pnpm build 之后，宿主内存里的代码到底换了没有？」
 *
 * ★ 而那个答案决定两件后果完全不同的事：换了 ⇒ 工作流成立；没换 ⇒ 那次
 *   `pnpm build` **什么也没生效**，而它读起来完全正常（`lib/` 是新的、
 *   `tsc` 退出码 0、`git status` 干净）。
 *
 * ⇒ 所以本夹具不测"它写没写文件"，而测**它有没有资格当那个读数**：
 *   三态不同形、有界、失败不冒泡、且不许成为启动条件。
 *
 * ── 定向突变（每条臂红得起来的方式，都写在臂里）────────────────────────────────
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'hmr-trace.ts')

const {
  modulesFromReloads, shapeOf, appendHmrReload, readHmrTrace, HMR_TRACE_LIMIT, HMR_TRACE_FILE,
  reloadJustBefore, HMR_FAILURE_WINDOW_MS,
} = await import(join(ROOT, 'lib', 'hmr-trace.js'))

function scratch() {
  return mkdtempSync(join(tmpdir(), 'hmr-trace-'))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 三态臂 —— 「观察到一批」「观察到空」「没能观察」必须【不同形】
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（三态臂）：modules 的三态必须不同形 —— 判不了不许伪装成空数组', () => {
  /**
   * ── 这是本模块最要紧的一条 ────────────────────────────────────────────────────
   *
   * 官方签名逐字是 `Map<Plugin, Reload>`，而 `Reload` 那个形状**不在本插件
   * 的类型面里**（它是 `dsh-hmr` 的）。所以取值一定是在运行时摸形状。
   *
   * ★ 摸不出来时返回 `[]` 会让两件**处置完全不同**的事同形：
   *   · `[]`       ⇒ "重载了一批空的"（几乎不可能，但读起来像结论）
   *   · `undefined`⇒ "我收到了事件，而我说不出是哪些" ⇒ ★ 去核形状
   * ⇒ 定向突变：把两个 `return undefined` 改成 `return out`（空数组）⇒ 本臂红。
   */
  // ① 真的取出了一批
  const real = new Map([['p', { filename: 'file:///a/b.js' }], ['q', { filename: 'file:///a/c.js' }]])
  assert.deepEqual(modulesFromReloads(real), ['file:///a/b.js', 'file:///a/c.js'], '★ 认得出的形状必须真的取出来')

  // ② 观察到空（Map 存在但没有条目）
  assert.deepEqual(modulesFromReloads(new Map()), [], '★ 空 Map = 观察到"没有条目"，这是一个结论')
  assert.deepEqual(modulesFromReloads([]), [], '★ 空数组同理')

  // ③ ★ 没能观察：形状不认识 ⇒ undefined，【不是】[]
  const unknown = modulesFromReloads(new Map([['p', { mystery: 1 }]]))
  assert.equal(unknown, undefined, '★★ 形状认不出 ⇒ undefined。返回 [] 会把"没能观察"写成"观察到空"')
  assert.notDeepEqual(unknown, [], '★★ 这两者必须不同形（这是本臂的全部要害）')

  assert.equal(modulesFromReloads(null), undefined, '★ null 也是没能观察')
  assert.equal(modulesFromReloads('nope'), undefined, '★ 字符串同理')
  assert.equal(modulesFromReloads(42), undefined, '★ 数字同理')

  /** ★ 数组里认不出一项 ⇒ 同样是没能观察（不是"取到了 0 项"）。 */
  assert.equal(modulesFromReloads([{ mystery: 1 }]), undefined, '★ 数组里认不出 ⇒ undefined')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：形状摘要 —— 当 modules 判不了时，它是唯一说得出"收到的是什么"的东西
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（诊断臂）：shapeOf 必须能把四种载荷说开', () => {
  assert.equal(shapeOf(new Map([['a', {}]])), 'Map(1)')
  assert.equal(shapeOf([]), 'Array(0)')
  assert.equal(shapeOf(null), 'null')
  assert.equal(shapeOf('x'), 'string')
  /**
   * ★ 它的用处是**具体**的：当 `modules` 是 `undefined` 时，读痕迹的人要能
   *   从同一行里看出"当时收到的是什么" —— 否则那一行只说"我失败了"，
   *   而说不出该去核哪里。
   */
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：写入 + 读回（对照臂）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（对照臂）：写进去的能被读回来，且字段齐全', () => {
  const dir = scratch()
  try {
    appendHmrReload(dir, { at: 123, modules: ['a.js'], shape: 'Map(1)', pid: 42 })
    const read = readHmrTrace(dir)
    assert.equal(read.length, 1)
    assert.equal(read[0].at, 123)
    assert.deepEqual(read[0].modules, ['a.js'])
    assert.equal(read[0].shape, 'Map(1)')
    assert.equal(read[0].pid, 42)
    /** ★ 追加语义：第二条不许覆盖第一条。 */
    appendHmrReload(dir, { at: 456, shape: 'Map(0)', pid: 42 })
    assert.equal(readHmrTrace(dir).length, 2, '★ 这是痕迹（append），不是状态（overwrite）')
    assert.deepEqual(readHmrTrace(dir).map((e) => e.at), [123, 456], '★ 顺序必须是发生顺序')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 有界臂 —— 一个长会话不许把它写成无限增长的文件
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（有界臂）：痕迹必须封顶在 HMR_TRACE_LIMIT —— 且保留的是【最新】的', () => {
  /**
   * ★ 为什么要这条：HMR 的每一次重载都会进来一条，而一个开发会话里
   *   "改一次 → build" 是**高频**动作。没有上界 ⇒ 文件无限增长 ⇒
   *   而"文件很大"与"它有用"在读数上同形。
   *
   * ★★ 而**保留哪一头**同样是判据：保留最旧的会让读的人看到一个远古的
   *   重载、而以为那是刚才那次。⇒ 保留**最新**的 N 条。
   *   定向突变：把 `slice(lines.length - LIMIT)` 改成 `slice(0, LIMIT)` ⇒ 本臂红。
   */
  const dir = scratch()
  try {
    const total = HMR_TRACE_LIMIT + 7
    for (let i = 0; i < total; i += 1) {
      appendHmrReload(dir, { at: i, modules: [`m${i}.js`], shape: 'Map(1)', pid: 1 })
    }
    const read = readHmrTrace(dir)
    assert.equal(read.length, HMR_TRACE_LIMIT, `★ 必须有界（${HMR_TRACE_LIMIT}）`)
    /** ★ 保留的是最新的那一批 —— 最后一条必须是最后写进去的那一条。 */
    assert.equal(read[read.length - 1].at, total - 1, '★ 最后一条 = 最后写的')
    assert.equal(read[0].at, total - HMR_TRACE_LIMIT, '★★ 丢掉的是【最旧】的，不是最新的')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 缺字段臂 —— 判不了时【字段缺席】，而不是编一个值
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（缺字段臂）：modules 判不了时那一格不出现 —— 不许写 null 也不许写 []', () => {
  const dir = scratch()
  try {
    appendHmrReload(dir, { at: 1, shape: 'Map(1)', pid: 7 })
    const raw = readFileSync(join(dir, HMR_TRACE_FILE), 'utf8').trim()
    const parsed = JSON.parse(raw)
    assert.equal('modules' in parsed, false, '★ 判不了 ⇒ 字段【不出现】（缺席与"空"不同形）')
    assert.equal(parsed.shape, 'Map(1)', '★ 而形状摘要在场 —— 它是那一刻唯一可说的东西')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★ 失败不冒泡（写不进去时抛、而调用方负责吞）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（失败臂）：写不进去要【抛】出带路径的可读错误 —— 由调用方决定吞掉', () => {
  /**
   * ── 为什么是"抛"而不是"自己吞掉"──────────────────────────────────────────────
   *
   * `appendHmrReload` 是一个**纯动作**：它要么写成、要么没写成。把它做成
   * 静默吞掉，会让"没写进去"与"没发生重载"同形 —— 而那正是本模块要消灭的。
   *
   * ★ 而**调用方**（`installHmrTrace`）必须吞掉它：重载已经发生了，
   *   一次记账失败不该把它变成一次失败的重载。
   * ⇒ 这一格的分工是：**这里负责说清，那里负责不打断。**
   */
  const bogus = join(scratch(), 'a-file-not-a-dir')
  writeFileSync(bogus, 'x')
  assert.throws(
    () => appendHmrReload(join(bogus, 'nested'), { at: 1, shape: 'Map(0)', pid: 1 }),
    /could not record the hmr reload trace/,
    '★ 错误里必须说清【是记账失败】，且带上路径 —— 否则读的人以为是重载失败',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★ 启动条件臂 —— 这个探针不许成为宿主能不能起来的一个条件
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7（启动条件臂）：它【不 inject】hmr，且事件名只在一处出现', () => {
  /**
   * ── 这一条防的是本插件最容易犯的那个错 ────────────────────────────────────────
   *
   * 若把它写成 `inject: ['hmr']`，那么在一个**没有** hmr 的合成里
   * （Headless / SDK / ACP —— dsh-base 逐字说它们 disable 了那一行），
   * 本插件的 fiber 会**挂在那里等** ⇒ 整个插件不激活。
   * ⇒ 那是"一个诊断工具把被测系统拖死了"。
   *
   * ★ 所以：事件名走窄化类型（`harness-compat.ts:72` 的同一种做法），
   *   且**全仓只有一处** `hmr/reload` 字样 —— 改宿主时只改它一处。
   *   定向突变：把事件名再抄一份到别处 ⇒ 本臂红。
   */
  const source = readFileSync(SRC, 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  const occurrences = [...code.matchAll(/hmr\/reload/g)].length
  assert.equal(occurrences, 1, `★ 事件名必须只在一处出现（实测 ${occurrences} 处）—— 两处会分叉`)

  assert.doesNotMatch(
    code, /\binject\b\s*[:=]\s*\[[^\]]*hmr/,
    '★★ 不许 inject hmr —— 那会让"没有 hmr 的合成"里整个插件不激活（诊断工具拖死被测系统）',
  )

  /** ★ 而窄化本身要在场（没有它，typecheck 就不该过）。 */
  assert.match(code, /as unknown as \{\s*\n?\s*on\(name: string/, '★ 窄化逃逸必须在场，且写明它为什么在那里')

  /**
   * ★★ 而【类型面不许再写一遍那个字符串】 —— 这是臂 7 抓到的第二个半边。
   *
   * MEASURED（本条的作者自己踩的）：第一版把类型面写成
   * `on(name: 'hmr/reload', …)`，于是同一个名字在【签名】与【调用】各一份
   * ⇒ 实测 2 处 ⇒ 本臂当场红。
   *
   * ★ 而修法不是"把断言放宽到 2"，是**让类型面只说 `string`** ——
   *   两份拷贝会分叉，而"分叉了"与"一致"在源码里同形。
   */
  assert.doesNotMatch(
    code, /on\(name: 'hmr\/reload'/,
    '★ 类型面不许重复那个字符串（应当写 `name: string`）—— 两份拷贝会分叉',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★ 接线臂 —— 它真的被 apply 调到了（否则是"建好没接线"）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8（接线臂）：`installHmrTrace` 在 `apply` 里被调用 —— 且落在 pluginRoot，不是 cwd', () => {
  /**
   * ★ 本仓记账最多的形态之一就是「机制建好了，中间那一格没接上」。
   *   一个从不被调用的监听器，与"没有这个监听器"在读数上同形。
   */
  const index = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
  assert.match(index, /import \{ installHmrTrace \} from '\.\/hmr-trace\.ts'/, '★ import 要在场')
  assert.match(index, /installHmrTrace\(ctx, join\(pluginRoot\(\), resolved\.stateDir\)\)/,
    '★ 必须在 apply 里被调用，且落盘位置来自 pluginRoot()')

  /**
   * ── ★★ 而【不许】用 process.cwd()（MEASURED 2026-10-10）────────────────────────
   *
   * 第一版写的是 `join(process.cwd(), resolved.stateDir)`，而实测：
   *
   *     lsof -p <host> -a -d cwd   ⇒   /Users/abab/.dsh/profiles/desktop
   *
   * ⇒ 宿主进程的 cwd 是 **profile 目录**，不是仓库
   * ⇒ 痕迹写去了 `~/.dsh/profiles/desktop/.agent-teams/hmr-reloads.jsonl`，
   *   而**找它的人在仓库里找**（实测找了两轮）。
   *
   * ★★ 这与臂 5 那条是同一种形状：**"写对了"与"写在别人会去看的地方"是两件事**，
   *    而它们在"文件确实存在"这个读数上同形。
   *    定向突变：把 `pluginRoot()` 改回 `process.cwd()` ⇒ 本臂红。
   */
  assert.doesNotMatch(
    index, /installHmrTrace\(ctx, join\(process\.cwd\(\)/,
    '★★ 不许用 process.cwd() —— 宿主 cwd 是 profile 目录，痕迹会落在没人找的地方',
  )

  /** ★ 而产物要跟上（`lib/` 落后于 `src/` 会让接线"看起来没接"）。 */
  assert.ok(existsSync(join(ROOT, 'lib', 'hmr-trace.js')), '★ lib/hmr-trace.js 必须在（先 pnpm build）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：★★ 接线上限臂 —— 它落在 stateDir，而【不是】团队状态
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 9（隔离臂）：痕迹文件名不与团队状态同名，且读它不依赖任何团队', () => {
  /**
   * ★ 它必须是**一个独立的文件**：写进 `team.json` 会让"重载痕迹"成为
   *   团队状态的一部分 ⇒ 判据层会去读它 ⇒ 一个诊断探针污染业务判据。
   *
   * ★ 而 `readHmrTrace` 在没有文件时必须返回 `[]`（而不是抛）：
   *   "还没有任何重载"是**正常的初始状态**，不是一次失败。
   *   ★ 这与臂 1 那条不冲突：那里判的是"事件载荷能不能读"，
   *     这里判的是"痕迹文件在不在" —— 两件事。
   */
  assert.notEqual(HMR_TRACE_FILE, 'team.json', '★ 不许与团队状态同文件')
  assert.match(HMR_TRACE_FILE, /\.jsonl$/, '★ 行式（append）语义要能从名字上读出来')

  const empty = scratch()
  try {
    assert.deepEqual(readHmrTrace(empty), [], '★ 文件不存在 ⇒ 空痕迹（正常初始态），不是抛错')
    /** ★ 而它也不该顺手把文件建出来（读操作没有副作用）。 */
    assert.equal(existsSync(join(empty, HMR_TRACE_FILE)), false, '★ 读不许建文件')
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10：★★ 归属臂 —— 痕迹跨进程追加，而"我这一次"必须分得出来
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 10（归属臂）：`sincePid` 只筛那一个进程 —— 而不传它时行为【逐字不变】', () => {
  /**
   * ── 这一条防的是什么 ──────────────────────────────────────────────────────────
   *
   * 文件是**跨进程追加**的：宿主重启、开两个窗口、跑一次 CLI，都往同一份
   * `hmr-reloads.jsonl` 里续写。于是"痕迹里有 3 条"回答不了真正被问的那个问题：
   *
   *     「**我这一次** build 之后，重载到底发生了几次？」
   *
   * ★ 一个**别的进程**刚写下的重载，与"我这一进程刚重载过"，在"文件有内容"
   *   这个读数上同形 —— 而 `HmrReloadEntry.pid` 早就在场，本臂钉的是它**可用**。
   *
   * ── ★★ 两半必须【同时】成立，缺一半就成了另一种坏 ─────────────────────────────
   *
   *   ① 不传 `sincePid` ⇒ **全部**（既有调用方的行为不许被悄悄改掉）
   *   ② 传 `sincePid`   ⇒ **只有那一个 pid**（否则这个参数是装饰）
   * ⇒ 只测一半的夹具是抓不住"半边坏"的：只会筛=默认读了全部；只会全返=筛是空转。
   *
   * ── ★ 而第三个 pid 是边界：**零条匹配必须返回 `[]`，不是抛，也不是编一条**──────
   *
   * 与臂 9 同源：`[]` 在这里是一个**结论**（"这个进程没重载过"），它必须与
   * "读不出来"（抛）不同形。★ 但注意它**只对传了 pid 的调用成立** ——
   * 不传时返回 `[]` 才是故障（那意味着筛选被误当成了默认行为）。
   *
   * ★ 而夹具里的两个 pid 必须在**同一份文件里交错**：写成一前一后两段，
   *   会让一个只会 `slice` 的坏实现也过关。
   *
   * ── 定向突变（两种都试过会红）────────────────────────────────────────────────
   *
   *   · 把 `sincePid === undefined ? entries : entries.filter(…)` 改成**无条件
   *     `filter`** ⇒ ① 红（不传参数时返回 `[]`，不再是全部）
   *   · 把 `filter` 整个去掉（永远返回 `entries`）⇒ ② 红（筛了等于没筛）
   *   · 把 `entry.pid === sincePid` 写成 `entry.pid !== sincePid` ⇒ ② 红
   *
   * MEASURED（本条作者实测）：把 filter 去掉重建后跑本文件 ⇒ 本臂 FAIL，
   *   臂 1–9 全绿 ⇒ 红的是**这一条**，不是别处。
   */
  const dir = scratch()
  try {
    const ME = 4242
    const OTHER = 9999
    const ABSENT = 31337 // ★ 从没写过记录的进程
    /** ★ 交错写入：两个 pid 的条目在同一份文件里混在一起。 */
    appendHmrReload(dir, { at: 1, modules: ['mine-a.js'], shape: 'Map(1)', pid: ME })
    appendHmrReload(dir, { at: 2, modules: ['theirs.js'], shape: 'Map(1)', pid: OTHER })
    appendHmrReload(dir, { at: 3, shape: 'Map(0)', pid: ME })
    appendHmrReload(dir, { at: 4, modules: ['theirs2.js'], shape: 'Map(1)', pid: OTHER })
    appendHmrReload(dir, { at: 5, modules: ['mine-b.js'], shape: 'Map(1)', pid: ME })

    // ① ★ 不传 ⇒ 全部（既有签名的行为，逐字不变）
    const all = readHmrTrace(dir)
    assert.equal(all.length, 5, '★★ 不传 sincePid ⇒ 必须返回全部（这就是改动前的行为）')
    assert.deepEqual(all.map((e) => e.at), [1, 2, 3, 4, 5], '★ 全部 = 文件里的每一条，且保持发生顺序')
    assert.deepEqual(
      readHmrTrace(dir, undefined).map((e) => e.at), all.map((e) => e.at),
      '★★ 显式传 undefined 与不传必须【同一件事】—— "没传"不等于"筛 pid=undefined"',
    )

    // ② ★ 传 ME ⇒ 只有 ME 的（按 at 交错，所以一个只会 slice 的实现过不了关）
    const mine = readHmrTrace(dir, ME)
    assert.deepEqual(mine.map((e) => e.at), [1, 3, 5], '★★ 只留我这个进程写的那些')
    assert.ok(mine.every((e) => e.pid === ME), '★ 筛出来的每一条的 pid 都必须是我')

    // ②' 另一个 pid 也要真的能筛（否则"筛 = 按 ME 硬编码"也能过）
    const theirs = readHmrTrace(dir, OTHER)
    assert.deepEqual(theirs.map((e) => e.at), [2, 4], '★ 换一个 pid，筛出来的必须是另一批')
    assert.ok(theirs.every((e) => e.pid === OTHER), '★ 不是把 ME 写死')

    /** ★ 两批【不是同一批】—— 这一条保证上面两半真的不同形，而不是都读了全部。 */
    assert.notDeepEqual(mine.map((e) => e.at), theirs.map((e) => e.at), '★ 两个 pid 的结果必须真的不同')

    // ③ ★ 边界：没有任何条目的 pid ⇒ `[]`（一个结论），不是抛
    assert.deepEqual(readHmrTrace(dir, ABSENT), [], '★ 零条匹配 ⇒ []，不是抛错、也不是编一条出来')

    /** ★ 而筛选是**读**操作：不许顺手把文件改掉/建出来。 */
    assert.equal(existsSync(join(dir, HMR_TRACE_FILE)), true, '★ 文件本来就该在')
    assert.equal(readHmrTrace(dir).length, 5, '★ 筛过之后文件内容不许变（读无副作用）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11：★★ 窗口臂 —— 「这次失败离那次重载多近」必须是一个能读的读数
//   这一格是 N4 的判据来源：`src/members.ts` 靠它决定一次 `inactive context`
//   该记成基础设施故障还是工作失败。窗口两侧各一条，中间的边界各一条。
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 11：`reloadJustBefore` 的窗口是【单边】的，且两侧结论不同形', () => {
  const dir = scratch()
  try {
    appendHmrReload(dir, { at: 10_000, shape: 'Map(1)', pid: 7 })
    appendHmrReload(dir, { at: 20_000, shape: 'Map(1)', pid: 7 })

    /** ① 窗口内 ⇒ 命中的是**最近那条**（不是最早那条，也不是"有没有"）。 */
    assert.equal(reloadJustBefore(dir, 20_000, 7)?.at, 20_000, '★ 恰好在重载那一刻 ⇒ 命中它自己')
    assert.equal(reloadJustBefore(dir, 20_500, 7)?.at, 20_000, '★ 500 ms 之后 ⇒ 命中最近那条')

    /** ② 窗口边界：恰好 `HMR_FAILURE_WINDOW_MS` 仍然算窗口**内**（闭区间）。 */
    assert.equal(reloadJustBefore(dir, 20_000 + HMR_FAILURE_WINDOW_MS, 7)?.at, 20_000,
      '★ 窗口是闭区间 —— 取开区间会让边界那 1 ms 落在没人定义的一侧')
    assert.equal(reloadJustBefore(dir, 20_000 + HMR_FAILURE_WINDOW_MS + 1, 7), undefined,
      '★★ 越过窗口 1 ms ⇒ undefined（这就是"与重载无关"的那个读数）')

    /**
     * ③ ★★ 未来不算：一条**晚于**这次失败的重载解释不了它。
     *    系统时钟回拨会让这种记录出现；把它算进来，就是拿未来解释过去。
     */
    assert.equal(reloadJustBefore(dir, 5_000, 7), undefined,
      '★★ 早于所有重载 ⇒ 不许拿"后来的那次重载"解释更早的一次失败')
    /**
     * ★ 而边界这一格要选一条**两侧都有邻居**的时刻才测得准：
     *   `at = 15_000` 时，20_000 那条在**未来**（必须跳过），10_000 那条
     *   恰好差 `HMR_FAILURE_WINDOW_MS`（必须算进来）⇒ 命中 10 000。
     *   ★ 这一个读数同时钉住两件事：未来被排除、"恰好一个窗口"没被排除。
     *   定向突变：把 `entry.at > at` 那一行删掉 ⇒ 这里会返回 20 000，当场红。
     */
    assert.equal(reloadJustBefore(dir, 15_000, 7)?.at, 10_000,
      '★★ 未来那条要跳过、恰好差一个窗口那条要算进来')

    /**
     * ④ ★ 空痕迹 ⇒ `undefined`，**不是**抛。
     *    "从没构建过"是正常的初始态；而它必须落回**保守的一侧**（不豁免）。
     */
    const empty = scratch()
    try {
      assert.equal(reloadJustBefore(empty, 1_000, 7), undefined, '★ 没有痕迹 ⇒ 不豁免，而不是抛')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }

    /** ⑤ ★ pid 过滤要跟着走：别的进程的重载不许被当成本进程的。 */
    assert.equal(reloadJustBefore(dir, 20_100, 8), undefined, '★ 换一个 pid ⇒ 一条也不算（别人的重载不算数）')
    assert.equal(reloadJustBefore(dir, 20_100)?.at, 20_000, '★ 不筛进程时仍然读得到（既有口径不变）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('★ 臂 12：N4 的窗口常量只有一处定义（改一处就够，不是两处要同步）', () => {
  /**
   * ★ 本仓记账最多的形态之一是"同一个数写在两个地方，改一处留下另一处"。
   *   一个分叉的窗口常量会让"窗口是 5 秒"与"窗口是 5 秒"读起来同形，
   *   而实际两处取值不同 —— 于是同一份失败记录在两个入口得到相反结论。
   */
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) {
        const text = readFileSync(full, 'utf8')
        if (text.includes('HMR_FAILURE_WINDOW_MS')) hits.push(full)
      }
    }
  }
  walk(join(ROOT, 'src'))
  assert.deepEqual(hits.map((file) => file.slice(ROOT.length + 1)), ['src/hmr-trace.ts'],
    '★ 窗口常量只许定义在 hmr-trace.ts 一处；别处要 5 秒就 import 它')
  assert.equal(readFileSync(SRC, 'utf8').match(/export const HMR_FAILURE_WINDOW_MS/g)?.length, 1,
    '★★ 连"同一文件里两处"也不许 —— 判据 ③ 说的是"一处定义一处使用"')
})
