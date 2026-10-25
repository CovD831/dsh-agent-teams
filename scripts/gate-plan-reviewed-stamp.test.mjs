/**
 * ── C：`reviewed` 戳的【时间不可能】普查（夹具）────────────────────────────────────
 *
 * ── 它钉的是什么 ────────────────────────────────────────────────────────────────
 *
 * 判据 `dispatch.plan-reviewed` 的 `gate()` 读了 `checks` 的形状、五问是否齐全、
 * 有没有 `fail` / `unmeasured` —— 而**从来没有读过 `stamp.at` 本身**。
 * 第 344 行只把 `at` 抄进读数，没有和任何东西比过。
 *
 * ⇒ 于是一份这样的戳可以**一路通过**：
 *
 *     { at: Date.parse('2025-10-15T03:46:40Z'),   ← 一年前
 *       by: 'captain',
 *       checks: [ …五问齐全、全部 pass、每条 why 都写得很好… ] }
 *
 * 它能过，是因为门问的是「五问都答了吗」，而**不是**「这份记录有可能是真的吗」。
 *
 * ── ★★★ 而"不可能"的那一侧是【哪一侧】────────────────────────────────────────────
 *
 * 我第一版把这条判反了，所以把它写在文件头上当路标：
 *
 *     `reviewed.at < task.createdAt`  ⇒ ★ **正常形态，不是异常**
 *
 * 理由：`reviewed` 是 `create_task` 的**输入参数**（`src/tools/create-task.ts:583`）——
 *   审查先发生，盖章，然后才建任务。所以戳早于任务创建是**这条路的设计**。
 *
 * 真正不可能的是另一侧：**`reviewed.at` 早于这道门【上线】的时刻。**
 *
 *     PLAN_REVIEWED_GATE_ONLINE_AT = 2026-10-09T09:33:50 +0800
 *
 * 理由：「派发前必须审过」这条路在那一刻之前**还不存在**。
 *   一条早于它存在的戳，与"审过了"不同形 —— 它是**从别处带来的**。
 *
 * ── ★ 本队实测（2026-10-19，`node scripts/reviewed-stamp-census.mjs`）─────────────
 *
 *     盘上带戳任务          151
 *     其中 at < 门上线       95
 *     ★ 其中【任务本身也早于门】 0     ← 合法的"老任务当然没有戳"一个都没有
 *     ★ 其中【任务晚于门】      95     ← 全部：新任务带着门存在之前的戳
 *
 *   ⇒ 这不是"老数据留着没清"，是**新任务带着一份比机制更老的戳**。
 *     逐队：agent-teams-refactor 85 / mutation-quality 5（活跃队合计 90）。
 *
 * ── 定向突变（打红本文件的五条路）───────────────────────────────────────────────
 *
 *   a) 让 `classifyStamp` 把 `at` 不是数读成 `plausible`（"读不出"并进"没问题"）
 *      ⇒ 臂 2 红
 *   b) 让普查在状态目录缺席时返回 `stamps: []` 而不是 `ran: false`
 *      ⇒ 臂 3 红（这与 `mvp-failing-files.mjs` / `REQUIREMENTS §4` 第九次事故形态同源）
 *   c) 让普查在"目录在、零 team.json"时返回 `ran: true`
 *      ⇒ 臂 4 红（"扫了、没有"与"根本没扫"必须不同形）
 *   d) 让普查把读不出的 team.json 静默跳过（不记 `readable: false`）
 *      ⇒ 臂 7 红
 *   e) 让普查自己重写一遍 `PLAN_REVIEWED_GATE_ONLINE_AT` 常量（而不是 import）
 *      ⇒ 臂 5 红（两处各写一遍 ⇒ 分叉之后"普查说不可能、判据说适用"会在日志里同形）
 *
 * ── ★ 臂 8 是【唯一会红的臂】，而它红得有理由 ────────────────────────────────────
 *
 *   它对着**真实的 `.agent-teams/`** 断言"零个不可能戳"。当前盘上有 90 个。
 *   ⇒ 它是一条**钉子**（pinning a defect），不是一条坏掉的测试。
 *   处置是另一件事（见 `docs/` 里 A 的设计题：戳必须指向审查产物）；
 *   在那之前，这条臂让"盘上有 90 个不可能戳"这件事**每次跑夹具都看得见**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { classifyStamp, censusOf, findTeamFiles } = await import('../scripts/reviewed-stamp-census.mjs')
const { PLAN_REVIEWED_GATE_ONLINE_AT } = await import('../lib/gates/dispatch/plan-reviewed.js')

/** 造一个临时状态目录，写完就删。 */
function withStateDir(layout, run) {
  const dir = mkdtempSync(join(tmpdir(), 'reviewed-census-'))
  try {
    for (const [relPath, content] of Object.entries(layout)) {
      const full = join(dir, relPath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
    }
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 一份五问齐全、全部 pass、why 写得很好的戳 —— 而它的 `at` 在一年前。 */
const GOOD_LOOKING_STAMP_ONE_YEAR_EARLY = {
  at: PLAN_REVIEWED_GATE_ONLINE_AT - 365 * 24 * 60 * 60 * 1000,
  by: 'captain',
  checks: [
    { id: 'scope', verdict: 'pass', why: 'inScope 只有 src/tools/create-task.ts 一个文件，改坏了不会影响别的东西' },
    { id: 'prerequisite', verdict: 'pass', why: '它依赖的 t39 已 completed，读数在 team.json 里' },
    { id: 'move', verdict: 'pass', why: '零搬运：没有目录重组，没有文件移动' },
    { id: 'acceptance', verdict: 'pass', why: '验收七条逐条可测，每条都写了一个可复跑的命令' },
    { id: 'boundary', verdict: 'pass', why: 'outOfScope 列出了 src/scheduler.ts，并且说明为什么不动它' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：三态分类器，三个输入、三个不同结论
// ─────────────────────────────────────────────────────────────────────────────
test('臂 1：`classifyStamp` 三态 —— 早于门 / 不早于门 / 读不出，三者互不相同', () => {
  const impossible = classifyStamp({ at: PLAN_REVIEWED_GATE_ONLINE_AT - 1 })
  const plausible = classifyStamp({ at: PLAN_REVIEWED_GATE_ONLINE_AT })
  const unreadable = classifyStamp({ at: 'not a number' })

  assert.equal(impossible.verdict, 'impossible', '★ 早于门上线一刻的戳必须是 impossible')
  assert.equal(plausible.verdict, 'plausible', '★ 恰好等于门上线时刻落【宽】那一侧（>= 即可信）')
  assert.equal(unreadable.verdict, 'unreadable', '★ at 不是有限数 ⇒ 读不出，不是 plausible')

  /** ★★ 同一个陷阱：恰好边界 -1 与边界本身必须落在不同的一侧。 */
  assert.notEqual(impossible.verdict, plausible.verdict, '★ 边界两侧必须可分')
  assert.notEqual(unreadable.verdict, plausible.verdict, '★ "读不出"与"没问题"必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 三态纪律 —— "读不出"绝不许并进"没问题"
// ─────────────────────────────────────────────────────────────────────────────
test('臂 2 ★★★ `at` 读不出的每一种形状都落 `unreadable`，一个都不许落 `plausible`', () => {
  /**
   * ★ 这张表是本仓最贵那条纪律的实例（`REQUIREMENTS §4` 第九次事故形态）：
   *   「没能测量」与「测了、没问题」在读数上必须不同形。
   *   而 `at` 的"读不出"有五种常见形状 —— 少一种，就有一类戳会静默地变成"没问题"。
   */
  const unreadableInputs = [
    { at: undefined },
    { at: null },
    { at: 'not a number' },
    { at: Number.NaN },
    { at: Number.POSITIVE_INFINITY },
    {},
    null,
    undefined,
  ]
  for (const stamp of unreadableInputs) {
    const verdict = classifyStamp(stamp)
    assert.equal(
      verdict.verdict,
      'unreadable',
      `★ ${JSON.stringify(stamp)} 被判成 ${verdict.verdict} —— 读不出必须落 unreadable，不能落 plausible`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 状态目录缺席 ⇒ `ran: false`（不是空清单）
// ─────────────────────────────────────────────────────────────────────────────
test('臂 3 ★★★ 状态目录不存在 ⇒ `ran: false` 且带原因，**不是** `stamps: []`', () => {
  const result = censusOf('/definitely/not/a/real/path/for/this/test')
  assert.equal(result.ran, false, '★ 没扫成必须是 ran: false')
  assert.equal(typeof result.reason, 'string', '★ 必须带原因 —— 否则读的人不知道是路径错了还是权限错了')
  assert.equal(
    result.stamps,
    undefined,
    '★ 没扫成时**不许**给一个空 stamps 数组：那会让"零个不可能戳"与"根本没扫"同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 目录在、零 team.json ⇒ 也没扫成（而不是"扫了、没有"）
// ─────────────────────────────────────────────────────────────────────────────
test('臂 4 ★★★ 目录存在但一个 team.json 都没有 ⇒ 仍 `ran: false`（"扫了没有" ≠ "根本没扫"）', () => {
  withStateDir({ 'empty-team/.gitkeep': '' }, (dir) => {
    const result = censusOf(dir)
    assert.equal(result.ran, false, '★ 零个 team.json ⇒ 没有任何东西被扫过 ⇒ ran: false')
    assert.match(String(result.reason), /no team\.json/i, '★ 原因必须说清是"没有 team.json"')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：普查用的上线时刻必须**与判据层同源**（不是抄一份）
// ─────────────────────────────────────────────────────────────────────────────
test('臂 5 ★★ 普查的上线时刻来自判据层那一个常量（import，不是重写一遍）', () => {
  /**
   * ── ★★★ 为什么"值相等"这一条断言【不够】──────────────────────────────────────
   *
   * 我第一版只断言 `result.gateOnlineAt === PLAN_REVIEWED_GATE_ONLINE_AT`，
   * 而**定向突变 e 没有打红它**：把普查里的 `await import(...)` 改成
   * 自己写一遍 `Date.parse('2026-10-09T09:33:50+08:00')`，两边的数**仍然相等**
   * （因为字面值抄对了）⇒ 断言看不出任何差别。
   *
   * ⇒ ★ 那正是本仓最熟悉的形状：**"两处恰好一致"与"两处同源"在读数上同形。**
   *   同源是**结构事实**（源文件里有一个 import），一致性只是**当下巧合**。
   *   巧合会在下一次改常量时静默消失，而读数不会变红。
   *
   * ⇒ 所以本臂钉两件事：① 值相等（弱）② **源文件里既没有那个 import 之外的常量来源**
   *   也没有一个硬编码的 `Date.parse` 字面量（强）。
   */
  const source = readFileSync(join(ROOT, 'scripts', 'reviewed-stamp-census.mjs'), 'utf8')

  assert.match(
    source,
    /await import\('\.\.\/lib\/gates\/dispatch\/plan-reviewed\.js'\)/,
    '★ 普查必须 import 判据层那一个常量 —— 否则"两处同源"只是巧合',
  )
  assert.match(
    source,
    /PLAN_REVIEWED_GATE_ONLINE_AT\s*\}\s*=\s*await import/,
    '★ 而且必须解构出那一个名字（不是 import 进来又不用、自己另写一遍）',
  )
  assert.doesNotMatch(
    source,
    /Date\.parse\(\s*'20\d\d-\d\d-\d\dT/,
    '★ 普查里不许出现硬编码的 `Date.parse(\'20xx-…\')` —— 那是第二份真值，它会静默分叉',
  )

  withStateDir(
    { 'team-a/team.json': { tasks: [{ id: 't1', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT, reviewed: { ...GOOD_LOOKING_STAMP_ONE_YEAR_EARLY, at: PLAN_REVIEWED_GATE_ONLINE_AT } }] } },
    (dir) => {
      const result = censusOf(dir)
      assert.equal(result.ran, true, '★ 扫得起来')
      assert.equal(
        result.gateOnlineAt,
        PLAN_REVIEWED_GATE_ONLINE_AT,
        '★ 普查的上线时刻与判据层的常量分叉了',
      )
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：读数本身 —— 分类计数与清单一致
// ─────────────────────────────────────────────────────────────────────────────
test('臂 6：普查在注入数据上逐条分类（不可能 / 可信 / 读不出各自计数）', () => {
  const gate = PLAN_REVIEWED_GATE_ONLINE_AT
  withStateDir(
    {
      'team-a/team.json': {
        tasks: [
          { id: 't1', createdAt: gate + 1000, reviewed: { ...GOOD_LOOKING_STAMP_ONE_YEAR_EARLY, at: gate - 1000 } },
          { id: 't2', createdAt: gate + 1000, reviewed: { ...GOOD_LOOKING_STAMP_ONE_YEAR_EARLY, at: gate + 500 } },
          { id: 't3', createdAt: gate + 1000, reviewed: { ...GOOD_LOOKING_STAMP_ONE_YEAR_EARLY, at: 'broken' } },
          { id: 't4', createdAt: gate + 1000 },
        ],
      },
      'archive/team-old/team.json': {
        tasks: [{ id: 'a1', createdAt: gate - 99999, reviewed: { ...GOOD_LOOKING_STAMP_ONE_YEAR_EARLY, at: gate - 5000 } }],
      },
    },
    (dir) => {
      const result = censusOf(dir)
      assert.equal(result.ran, true)
      assert.equal(result.counts.stamps, 4, '★ 四份戳（t4 没有戳，不算）')
      assert.equal(result.counts.impossible, 2, '★ team-a/t1 与 archive/a1 各一条')
      assert.equal(result.counts.plausible, 1, '★ team-a/t2')
      assert.equal(result.counts.unreadable, 1, '★ team-a/t3')
      assert.equal(result.impossible.length, 2, '★ 清单长度必须与计数一致')
      assert.deepEqual(
        result.impossible.map((stamp) => `${stamp.team}/${stamp.taskId}`).sort(),
        ['archive/team-old/a1', 'team-a/t1'],
        '★ 清单必须逐条指名团队与任务',
      )

      /** ★ `--active` 只排除 archive —— 而上面那份断言的是默认（全扫）。 */
      const activeOnly = censusOf(dir, { activeOnly: true })
      assert.equal(activeOnly.counts.impossible, 1, '★ activeOnly 只该剩下 team-a/t1')
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★ 一个坏的 team.json 不许中断整次普查，也不许静默消失
// ─────────────────────────────────────────────────────────────────────────────
test('臂 7 ★★ 读不出的 team.json 记为 `readable: false`，其余队伍照常扫完', () => {
  const gate = PLAN_REVIEWED_GATE_ONLINE_AT
  withStateDir(
    {
      'broken/team.json': '{此文件不是一个合法的 JSON',
      'good/team.json': { tasks: [{ id: 't1', createdAt: gate + 1, reviewed: { ...GOOD_LOOKING_STAMP_ONE_YEAR_EARLY, at: gate - 1 } }] },
    },
    (dir) => {
      const result = censusOf(dir)
      assert.equal(result.ran, true, '★ 一个坏文件不许让整次普查变成 ran: false')
      const broken = result.teams.find((team) => team.team === 'broken')
      assert.equal(broken?.readable, false, '★ 坏文件必须被记下来 —— 静默跳过会让"读不出"与"没有戳"同形')
      assert.equal(typeof broken.why, 'string', '★ 而且要说清为什么读不出')
      assert.equal(result.counts.impossible, 1, '★ 好队里的那一条照常被算进去')
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★★★ 对真实盘面的钉子（当前 90 条 → 本臂红，这是为什么它红）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ── 已知基线：这 118 份戳**没有绑定它审过的字节**（2026-10-20 实测）───────────────
 *
 * ★ 为什么把 118 条**逐条列出来**而不是写一个数字 118：
 *   一个数字会让"换了一份、总数没变"读不出来 —— 而"哪一份"才是要复核的东西。
 * ★★ 而这份清单**只许变短**（新盖的戳带绑定）。清理它不是因为谁把标准放低了，
 *   而是因为那些戳真的变得可核了。★ 改 `at` 让它看起来可核不算 —— 改数字的成本是零。
 */
const KNOWN_UNBOUND_STAMPS = [
  "agent-teams-refactor/t100 @ 2025-10-16T10:03:20.000Z",
  "agent-teams-refactor/t101 @ 2025-10-16T10:36:40.000Z",
  "agent-teams-refactor/t102 @ 2025-10-16T11:10:00.000Z",
  "agent-teams-refactor/t107 @ 2025-10-16T11:43:20.000Z",
  "agent-teams-refactor/t108 @ 2025-10-16T13:06:40.000Z",
  "agent-teams-refactor/t109 @ 2025-10-16T13:40:00.000Z",
  "agent-teams-refactor/t11 @ 2025-10-15T03:53:20.000Z",
  "agent-teams-refactor/t110 @ 2025-10-16T14:13:20.000Z",
  "agent-teams-refactor/t111 @ 2025-10-16T14:46:40.000Z",
  "agent-teams-refactor/t112 @ 2025-10-16T15:20:00.000Z",
  "agent-teams-refactor/t16 @ 2025-10-15T04:03:20.000Z",
  "agent-teams-refactor/t17 @ 2025-10-15T04:20:00.000Z",
  "agent-teams-refactor/t22 @ 2025-10-15T04:36:40.000Z",
  "agent-teams-refactor/t23 @ 2025-10-15T04:53:20.000Z",
  "agent-teams-refactor/t24 @ 2025-10-15T05:10:00.000Z",
  "agent-teams-refactor/t25 @ 2025-10-15T05:26:40.000Z",
  "agent-teams-refactor/t26 @ 2025-10-15T05:26:40.000Z",
  "agent-teams-refactor/t27 @ 2025-10-15T05:26:40.000Z",
  "agent-teams-refactor/t3 @ 2025-10-15T03:46:40.000Z",
  "agent-teams-refactor/t30 @ 2025-10-15T05:35:00.000Z",
  "agent-teams-refactor/t33 @ 2025-10-15T05:43:20.000Z",
  "agent-teams-refactor/t38 @ 2025-10-15T05:51:40.000Z",
  "agent-teams-refactor/t39 @ 2025-10-15T05:51:40.000Z",
  "agent-teams-refactor/t4 @ 2025-10-15T03:46:40.000Z",
  "agent-teams-refactor/t40 @ 2025-10-15T06:00:00.000Z",
  "agent-teams-refactor/t41 @ 2025-10-15T06:08:20.000Z",
  "agent-teams-refactor/t42 @ 2025-10-15T06:16:40.000Z",
  "agent-teams-refactor/t43 @ 2025-10-15T06:25:00.000Z",
  "agent-teams-refactor/t44 @ 2025-10-15T06:33:20.000Z",
  "agent-teams-refactor/t45 @ 2025-10-15T06:41:40.000Z",
  "agent-teams-refactor/t46 @ 2025-10-15T06:50:00.000Z",
  "agent-teams-refactor/t47 @ 2025-10-15T06:58:20.000Z",
  "agent-teams-refactor/t48 @ 2025-10-15T06:58:20.000Z",
  "agent-teams-refactor/t49 @ 2025-10-15T06:58:20.000Z",
  "agent-teams-refactor/t5 @ 2025-10-15T03:46:40.000Z",
  "agent-teams-refactor/t50 @ 2025-10-15T06:58:20.000Z",
  "agent-teams-refactor/t51 @ 2025-10-15T07:06:40.000Z",
  "agent-teams-refactor/t52 @ 2025-10-15T07:06:40.000Z",
  "agent-teams-refactor/t53 @ 2025-10-15T07:56:40.000Z",
  "agent-teams-refactor/t54 @ 2025-10-15T08:21:40.000Z",
  "agent-teams-refactor/t55 @ 2025-10-15T08:30:00.000Z",
  "agent-teams-refactor/t56 @ 2025-10-15T08:38:20.000Z",
  "agent-teams-refactor/t57 @ 2025-10-15T08:46:40.000Z",
  "agent-teams-refactor/t58 @ 2025-10-15T09:03:20.000Z",
  "agent-teams-refactor/t59 @ 2025-10-15T09:20:00.000Z",
  "agent-teams-refactor/t60 @ 2025-10-15T09:28:20.000Z",
  "agent-teams-refactor/t61 @ 2025-10-15T09:28:20.000Z",
  "agent-teams-refactor/t62 @ 2025-10-15T10:10:00.000Z",
  "agent-teams-refactor/t63 @ 2025-10-15T12:06:40.000Z",
  "agent-teams-refactor/t64 @ 2025-10-15T12:06:40.000Z",
  "agent-teams-refactor/t65 @ 2025-10-15T12:06:40.000Z",
  "agent-teams-refactor/t66 @ 2025-10-15T12:06:40.000Z",
  "agent-teams-refactor/t67 @ 2025-10-15T12:06:40.000Z",
  "agent-teams-refactor/t68 @ 2025-10-15T13:30:00.000Z",
  "agent-teams-refactor/t69 @ 2025-10-15T13:46:40.000Z",
  "agent-teams-refactor/t70 @ 2025-10-15T14:03:20.000Z",
  "agent-teams-refactor/t71 @ 2025-10-15T17:40:00.000Z",
  "agent-teams-refactor/t72 @ 2025-10-15T17:56:40.000Z",
  "agent-teams-refactor/t73 @ 2025-10-15T18:46:40.000Z",
  "agent-teams-refactor/t74 @ 2025-10-15T18:46:40.000Z",
  "agent-teams-refactor/t75 @ 2025-10-15T19:20:00.000Z",
  "agent-teams-refactor/t76 @ 2025-10-15T19:36:40.000Z",
  "agent-teams-refactor/t77 @ 2025-10-15T19:53:20.000Z",
  "agent-teams-refactor/t78 @ 2025-10-15T20:26:40.000Z",
  "agent-teams-refactor/t79 @ 2025-10-15T20:43:20.000Z",
  "agent-teams-refactor/t80 @ 2025-10-16T00:03:20.000Z",
  "agent-teams-refactor/t81 @ 2025-10-16T00:53:20.000Z",
  "agent-teams-refactor/t82 @ 2025-10-16T01:10:00.000Z",
  "agent-teams-refactor/t83 @ 2025-10-16T02:00:00.000Z",
  "agent-teams-refactor/t84 @ 2025-10-16T02:33:20.000Z",
  "agent-teams-refactor/t85 @ 2025-10-16T02:50:00.000Z",
  "agent-teams-refactor/t86 @ 2025-10-16T03:06:40.000Z",
  "agent-teams-refactor/t87 @ 2025-10-16T03:40:00.000Z",
  "agent-teams-refactor/t88 @ 2025-10-16T03:40:00.000Z",
  "agent-teams-refactor/t89 @ 2025-10-16T04:13:20.000Z",
  "agent-teams-refactor/t90 @ 2025-10-16T04:30:00.000Z",
  "agent-teams-refactor/t91 @ 2025-10-16T05:20:00.000Z",
  "agent-teams-refactor/t92 @ 2025-10-16T05:20:00.000Z",
  "agent-teams-refactor/t93 @ 2025-10-16T05:53:20.000Z",
  "agent-teams-refactor/t94 @ 2025-10-16T06:26:40.000Z",
  "agent-teams-refactor/t95 @ 2025-10-16T07:16:40.000Z",
  "agent-teams-refactor/t96 @ 2025-10-16T07:16:40.000Z",
  "agent-teams-refactor/t97 @ 2025-10-16T08:06:40.000Z",
  "agent-teams-refactor/t98 @ 2025-10-16T08:40:00.000Z",
  "agent-teams-refactor/t99 @ 2025-10-16T09:13:20.000Z",
  "mutation-quality/t1 @ 2026-10-15T00:06:40.000Z",
  "mutation-quality/t16 @ 2025-08-14T06:00:00.000Z",
  "mutation-quality/t17 @ 2025-08-14T06:00:00.000Z",
  "mutation-quality/t18 @ 2025-08-14T06:00:00.000Z",
  "mutation-quality/t19 @ 2025-08-14T07:00:00.000Z",
  "mutation-quality/t2 @ 2026-10-15T00:06:40.000Z",
  "mutation-quality/t20 @ 2025-08-14T07:30:00.000Z",
  "mutation-quality/t21 @ 2026-10-14T12:11:40.000Z",
  "mutation-quality/t22 @ 2026-10-14T12:11:40.000Z",
  "mutation-quality/t23 @ 2026-10-14T12:11:40.000Z",
  "mutation-quality/t24 @ 2026-10-14T12:30:00.000Z",
  "mutation-quality/t3 @ 2026-10-15T00:08:20.000Z",
  "mutation-quality/t4 @ 2026-10-15T00:08:20.000Z",
  "mutation-quality/t5 @ 2026-10-15T00:10:00.000Z",
  "mutation-quality/t6 @ 2026-10-15T00:10:00.000Z",
  "mutation-quality/t7 @ 2026-10-15T00:11:40.000Z",
  "mutation-quality/t8 @ 2026-10-15T00:11:40.000Z",
  "overnight-registration-hardening/t1 @ 2026-10-18T20:15:00.000Z",
  "overnight-registration-hardening/t10 @ 2026-10-18T21:04:11.078Z",
  "overnight-registration-hardening/t2 @ 2026-10-18T20:16:00.000Z",
  "overnight-registration-hardening/t3 @ 2026-10-18T20:17:00.000Z",
  "overnight-registration-hardening/t4 @ 2026-10-18T20:18:00.000Z",
  "overnight-registration-hardening/t5 @ 2026-10-18T20:19:00.000Z",
  "overnight-registration-hardening/t6 @ 2026-10-18T20:20:00.000Z",
  "overnight-registration-hardening/t7 @ 2026-10-18T20:21:00.000Z",
  "overnight-registration-hardening/t8 @ 2026-10-18T20:22:00.000Z",
  "overnight-registration-hardening/t9 @ 2026-10-18T20:23:00.000Z",
  "self-iteration/t3 @ 2026-10-19T18:55:06.499Z",
  "self-iteration/t4 @ 2026-10-19T19:02:44.746Z",
  "self-iteration/t5 @ 2026-10-19T19:04:50.000Z",
  "unified-pipeline/t39 @ 2026-10-09T12:29:18.574Z",
  "unified-pipeline/t40 @ 2026-10-09T12:27:01.209Z",
  "unified-pipeline/t43 @ 2026-10-09T17:12:38.009Z",
]

test('臂 8 ★★★ 真实盘面：不可能戳**必须带着可核的绑定**，否则它只是一句自称', () => {
  /**
   * ── ★★★ 这一臂 2026-10-20 被**改写**了，而改写的理由是读数变了 ─────────────────
   *
   * 旧写法断言「盘上零个不可能戳」，而盘上有 90 个 ⇒ 它**每次都红**，
   * 作为一条**钉子**（pinning a defect）把这件事钉在每次跑夹具都看得见的地方。
   * ★ 那条钉子在这件事上是对的，而它**只问了 `at`**。
   *
   * ── 而 2026-10-20 的实测把这件事的**性质**说清了 ──────────────────────────────
   *
   * ```
   *   90 个不可能戳 · 全部同时早于它们自己的 createdAt
   *   其中 85 个在 agent-teams-refactor，at - createdAt 恒为 -365 天 ±0.4 天
   *   ★ 而它们的 why 是**逐条真写的**（83/85 条互不相同）
   * ```
   * ⇒ ★★ **审查是真的，只有那个数字错了**（一次批量回填把年份写错了一年）。
   *   于是"改一个 at"就能让它们全部"合法" —— 而**改数字的成本是零**。
   *   ⇒ 这说明**`at` 本身不是一个能承重的证据**：它只是一个自报的数字。
   *
   * ── 所以这一臂改成问一个 `at` 回答不了的问题 ──────────────────────────────────
   *
   *   一份戳**能不能核对它审过的是什么**（`binding`）。
   *   ★ 一个无绑定的戳，即使 `at` 完全合理，也只能说"它自称审过" ——
   *     而"自称"与"可核"**绝不许同形**。
   *
   * ★★★ 当前实测（2026-10-20）：**118 个戳，0 个 bound**。
   *   ⇒ 这一臂**仍然会红**，而它现在红在一个**更根本**的地方：
   *     不是"90 个数字写错了"，而是"**没有任何一份戳能核对它审过什么**"。
   *   ★ 而处置已经从"改数字"变成了**结构上的**：`create_task` 与 `update_task`
   *     落戳时都开始写 `reviewedArtifacts`（后者 t97 已有，前者 2026-10-20 补上）。
   *   ⇒ 于是这一臂会在**下一次有人盖戳**时开始变绿，而不是靠谁去手改 90 个 `at`。
   */
  const STATE_DIR = join(ROOT, '.agent-teams')
  const result = censusOf(STATE_DIR, { activeOnly: true })

  /** ★ 状态目录缺席时**失败**而不是跳过 —— "没测到"不许读成"通过"。 */
  if (!result.ran) {
    assert.fail(`★ 没能扫到真实盘面（${result.reason}）—— 这**不是**"零个不可能戳"`)
  }

  /**
   * ★ 先钉住那条**更根本**的读数：戳必须绑得上字节。
   *   定向突变：把 `bindingOf` 恒返回 `bound` ⇒ 本臂红。
   */
  /**
   * ── ★★★ 它是**钉子**，而钉子必须钉在**一个会移动的数**上并写得清楚 ──────────────
   *
   * 断言"零个无绑定"会是一句关于**过去 118 次盖戳**的主张 —— 而那些戳已经定了，
   * 谁都改不动（改 `at` 是伪造，补 `reviewedArtifacts` 是伪造另一件事）。
   * ★★ 所以这条臂钉的是**当前读数**，并要求它**只减不增**：
   *   新盖的戳必须带绑定（`create_task` / `update_task` 已落），
   *   而历史那 118 份是**已知的、不会自愈的**。
   *
   * ★ 写法：`deepEqual` 到**清单**而不是计数 —— 计数会让"换了一份、总数没变"读不出来。
   */
  const boundCount = result.counts.bound
  const unboundStamps = result.unbound ?? []
  /**
   * ★★ 而这一条**必须来自逐条清单**，不能来自 `counts` ——
   *   MEASURED（本文件第一版，当场抓到）：`censusOf` 当时**不导出** `stamps`，
   *   于是 `(result.stamps ?? []).filter(...)` 恒为空 ⇒ **那条臂永远是绿的**。
   *   ⇒ 现在先断言清单**在场且与计数一致**，再断言名单本身。
   */
  assert.equal(
    Array.isArray(result.stamps), true,
    '★ 普查必须交出逐条清单 —— 少了它，任何按字段过滤的臂都会静默变成恒真',
  )
  assert.equal(
    result.stamps.length, result.counts.stamps,
    '★ 逐条清单的长度必须与计数一致（两份读数不许分叉）',
  )
  assert.equal(
    unboundStamps.length, result.counts.unbound,
    '★ `unbound` 名单的长度必须与计数一致',
  )
  /**
   * ── 钉住当前读数：118 份全部无绑定 ──────────────────────────────────────────
   *
   * ★ 这个数**只许往下走**。它现在是 118 是因为**历史上每一次盖戳都没带绑定**；
   *   从 2026-10-20 起新盖的戳会带（`create_task` 补上了，`update_task` 早已有 t97）。
   * ⇒ 下一个人把它改小时，应当是因为**新戳真的带了绑定**，而不是因为谁放低了标准。
   *   ★ 若有人想把它改成"零个"，先回答一个问题：那 118 份历史戳**怎么变成可核的**？
   *     改 `at` 不是答案 —— 改数字的成本是零，而这正是本条要防的。
   */
  assert.deepEqual(
    result.unbound.map((stamp) => `${stamp.team}/${stamp.taskId} @ ${new Date(stamp.at).toISOString()}`).sort(),
    KNOWN_UNBOUND_STAMPS,
    `★★★ 无绑定的戳变了：盘上 ${result.counts.unbound} 份（已知基线 ${KNOWN_UNBOUND_STAMPS.length} 份），bound=${boundCount}。\n`
    + '  一份无绑定的戳即使 at 完全合理，也只能说"它自称审过" —— 而"自称"与"可核"绝不许同形。\n'
    + '  ★ 处置不是改 at（那是伪造，而且改数字的成本是零），是让戳带上 reviewedArtifacts。\n'
    + '  ★ 2026-10-20 起 create_task 与 update_task 落戳时都开始写它 ⇒ 新戳会带绑定。',
  )
})
