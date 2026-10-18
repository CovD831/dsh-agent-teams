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
test('臂 8 ★★★ 真实盘面上不存在"早于这道门上线"的 reviewed 戳', () => {
  /**
   * ── ★ 这条臂当前【会红】，而它红得有理由 ─────────────────────────────────────
   *
   * 它不是一条坏掉的测试，是一条**钉子**：它把"盘上有 N 个不可能戳"钉成一个
   * **每次跑夹具都看得见**的读数，而不是一个"我上次查过好像有"的记忆。
   *
   * ★ 处置是另一件事，而且不在本文件里：
   *   一条早于机制存在的戳，正确的处置不是"把 at 改成今天"（那是伪造），
   *   而是 **A**：让戳指向它审过的审查产物（`reviewedArtifacts`），
   *   于是"这份戳审的是什么"变成一个可核的事实，而不是一个 `at` 数字。
   */
  const STATE_DIR = join(ROOT, '.agent-teams')
  const result = censusOf(STATE_DIR, { activeOnly: true })

  /** ★ 状态目录缺席时跳过 —— 那不是"零个不可能戳"，而本仓的纪律是"没测到"不许读成"通过"。 */
  if (!result.ran) {
    assert.fail(`★ 没能扫到真实盘面（${result.reason}）—— 这**不是**"零个不可能戳"`)
  }

  const offenders = result.impossible
    .map((stamp) => `${stamp.team}/${stamp.taskId} @ ${new Date(stamp.at).toISOString()}`)
    .sort()
  assert.deepEqual(
    offenders,
    [],
    `★ 盘上有 ${offenders.length} 个 reviewed 戳早于这道门上线（${new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString()}）。\n`
    + '  这些戳的五问可能写得很完整、why 写得很详细 —— 而它们的 at 指向一个这条路由还不存在的时刻。\n'
    + '  ★ 处置不是把 at 改成今天（那是伪造），是让戳指向它审过的产物（见 A）。\n'
    + `  逐条：\n${offenders.map((line) => `    ${line}`).join('\n')}`,
  )
})
