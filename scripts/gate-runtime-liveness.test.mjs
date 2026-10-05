/**
 * ── `runtime.liveness` 的三臂夹具（探活：卡死报警 + 定期告知）──────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）。在本判据里它们各自是：
 *
 *   臂 1（伪造臂）：**假活** —— 两次探活之间最后活动时刻一动没动，而它看起来
 *                   一切正常（有 ctx、有时钟、`startedAt` 也不缺） ⇒ 期望 blocked
 *   臂 2（未测量臂）：拿不到时钟 / 等待起点 / 活动观察 ⇒ 期望 unmeasured，
 *                   ★ 与 blocked【不同形】，更**绝不能是 ok**
 *   臂 3（对照臂）：第一次探活；以及第二次探活而它确实动过 ⇒ 期望 ok，
 *                   且"第一次"与"确认还在动"【不同形】
 *
 * ── ★ 本夹具刻意不测的东西（与实现里那条一样重要）────────────────────────────
 *
 * ✗ **不测「等了多久 ⇒ 报警」**。它不是硬超时：一个等了 3 小时、期间一直在产出的
 *   成员必须【不被报警】。夹具里有一条臂专门钉这个（`★ 它不是硬超时`），因为
 *   "等太久了 ⇒ 报警"是最容易被顺手加进来、也最容易误伤长任务的那一格。
 *
 * ── ★ 状态放在调用方（本判据是纯函数，同一个输入永远同一个裁决）─────────────────
 *
 * 夹具自己扮演"持有等待记录的那一方"：一份 `wait` 对象 + 手推的假时钟。于是整份
 * 夹具**不真等任何时间**，也不碰 `Date.now()`。
 *
 * ── 每条臂都对着一次【定向突变】──────────────────────────────────────────────
 *
 * 每条 test 里都标了「打红它的突变」。收口时逐条删掉实现里对应的那一行，只有那条
 * 臂会红 —— 打不红说明这条臂没有真的覆盖那个行为（§8.5 规则二）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gate, appliesTo, id, point, DEFAULT_LIVENESS_INTERVAL_MS } from '../lib/gates/runtime/liveness.js'

const T0 = 1_700_000_000_000
const INTERVAL = DEFAULT_LIVENESS_INTERVAL_MS           // 10 分钟
const P1 = T0 + INTERVAL                                // 第一次探活
const P2 = T0 + 2 * INTERVAL                            // 第二次探活

/** 收窄助手：把"期望哪一种裁决"写进断言本身（与其它 gate 夹具同构）。 */
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  return v.unmeasured
}
/** 三态的形状（用于"两者不同形"的断言）。 */
function shapeOf(v) {
  if (v.ok === true) return 'ok'
  return 'blockers' in v ? 'blocked' : 'unmeasured'
}

/** 一份"当前这次探活"的 ctx（与 t5 约定的形状一致）。 */
function ctx(wait, extra = {}) {
  return {
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: { startedAt: T0, ...wait },
    ...extra,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（对照臂）：第一次探活 / 确认它还在动
// ─────────────────────────────────────────────────────────────────────────────

test('★ 对照臂：第一次探活（没有上次记录）⇒ ok，且【不是】一个健康判断', () => {
  // 打红它：把 `first_probe` 去掉，或让"没有上一次"落进 blocked。
  const verdict = expectOk(gate(ctx({ lastActivityAt: T0, now: P1 })))
  assert.equal(verdict.first_probe, true)
  assert.equal(verdict.alive, null, '★ "还没比过"不得被读成"确认它活着"')
  assert.equal(verdict.stuck, null, '★ 也不得被读成"卡死"—— 只有一端时比不了')
  assert.match(String(verdict.message), /still running/)
  assert.match(String(verdict.message), /10 minute\(s\)/, '★ 定期告知必须带上"已等多久"')
})

test('★ 对照臂：第二次探活、活动时刻推进了 ⇒ ok，且与"第一次探活"【不同形】', () => {
  // 打红它：把 `first_probe: false` 去掉（两者就同形了）。
  const verdict = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + INTERVAL / 2, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  assert.equal(verdict.first_probe, false)
  assert.equal(verdict.alive, true)
  assert.equal(verdict.stuck, false)
  assert.equal(verdict.updated_since_previous_probe, true)
  assert.equal('observation_inconsistent' in verdict, false, '★ 正常推进不该带任何异常标记')

  const first = expectOk(gate(ctx({ lastActivityAt: T0, now: P1 })))
  assert.notDeepEqual(
    [verdict.first_probe, verdict.alive, verdict.stuck],
    [first.first_probe, first.alive, first.stuck],
    '★ "第一次探活"与"确认它还在动"必须不同形 —— 否则"我等了 10 分钟还没看过它"读起来像"我确认过它还活着"',
  )
})

test('★ 它不是硬超时：等了 3 小时、期间一直在产出 ⇒ 绝不报警', () => {
  /**
   * ★ 用户裁定的那一条：「有的任务确实超过 30min」。本判据问的是「还健康吗」，
   *   与"任务本来要多久"无关 —— 一个长任务只要在产出就永不被报警。
   *
   * 打红它：加一条 `if (elapsed > 30 * 60_000) return blocked(...)` 的硬超时。
   */
  let lastActivity = T0
  let now = T0
  for (let poll = 1; poll <= 18; poll += 1) {           // 18 次探活 = 3 小时
    const previousPollAt = poll === 1 ? undefined : now
    const previousLastActivityAt = poll === 1 ? undefined : lastActivity
    now += INTERVAL
    lastActivity = now - 60_000                          // 每一轮都在动
    const verdict = expectOk(gate(ctx({ lastActivityAt: lastActivity, now, previousPollAt, previousLastActivityAt })))
    assert.equal(verdict.stuck, poll === 1 ? null : false, `第 ${poll} 次探活：还在产出，不许报警`)
  }
  assert.ok(now - T0 >= 3 * 60 * 60_000, '本臂必须真的走过 3 小时（手推时钟，不真等）')
})

test('★ 不做「没进展」：两次探活之间没产出，但没跨过一个间隔 ⇒ 不报警、也不说健康', () => {
  /**
   * ★ 「思考很久」与「卡住」在观察上同形（用户已裁定：不做「没进展」）。
   *   本臂钉的是最难的那一格：上一次读数在 `now - 2 分钟`（**没有**跨过一个间隔），
   *   而它的活动时刻与这一次完全相同。
   *
   * ★ 本判据的答案：`blocked`。理由不是"它没动"，而是"上一次读到它的时刻已经
   *   整整一个间隔没变" —— 这正是「卡死了」那条可判定的定义，与"在想"无关：
   *   一个在读文件、跑长命令的成员同样会跨过一个间隔没有任何 assistant 产出，
   *   而那时唯一诚实的话是"我看不到它在动，去看一眼"，而不是"它卡死了，掐掉它"
   *   （本判据没有掐的能力，见契约 §5）。
   *
   * 打红它：把 `stuck` 判定改成要求两条（活动没变 **且** 时间跨度极大）。
   */
  const verdict = gate(ctx({
    startedAt: T0, lastActivityAt: T0, now: P2,
    previousPollAt: P2 - 2 * 60_000, previousLastActivityAt: T0,
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers[0], /has not moved for a full 10-minute probe interval/)
  assert.equal(/exceeded|too long|timed out/i.test(blockers[0]), false, '★ 措辞不得读起来像"超时了"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（伪造臂）：假活
// ─────────────────────────────────────────────────────────────────────────────

test('★ 伪造臂：两次探活、最后活动时刻一动没动 ⇒ blocked（告警，不是拒绝）', () => {
  // 打红它：把 `stuck` 改成恒 false，或把相等判成 `>`（差一）。
  const blockers = expectBlocked(gate(ctx({
    startedAt: T0, lastActivityAt: T0, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /worker/)
  assert.match(blockers[0], /has not moved for a full 10-minute probe interval/)
  /**
   * ★ 用【肯定式】断言，而不是"消息里不许出现 rejected/cancel 这些词"。
   *   一条写"the task is not cancelled"的告警里**本来**就含 `cancel` ——
   *   拿它做反向匹配，测的是措辞的巧合，不是行为（本臂第一版就栽在这里）。
   */
  assert.match(blockers[0], /not a rejection/, '★ 它必须明说"这不会打断任何东西"')
  assert.match(blockers[0], /not cancelled/, '★ 契约 §5：过程约束不结束等待')
  assert.equal(/exceeded its|timed out/i.test(blockers[0]), false, '★ 它是探活告警，不是硬超时')
})

test('★ 伪造臂：活动时刻【倒退】（观察面不自洽）⇒ 只报"还在跑"，绝不当成卡死', () => {
  /**
   * ★ 同一次等待里 `lastActivityAt` 只增不减。出现倒退说明观察面自己不自洽
   *   （换了任务 / 缓存被清），而"不自洽"既不是"它动了"也不是"它卡死了"。
   *
   * 打红它：把 `moved` 的判定删掉，让这一格落进 `stuck`（那是假警报）。
   */
  const verdict = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + 100, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0 + INTERVAL / 2,
  })))
  assert.equal(verdict.stuck, false, '★ 倒退不得被读成卡死')
  assert.match(String(verdict.observation_inconsistent), /moved backwards/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（未测量臂）：拿不到观察 ⇒ unmeasured，不是 ok
// ─────────────────────────────────────────────────────────────────────────────

test('★ 未测量臂：拿不到时钟（wait.now 缺席）⇒ unmeasured，不是 ok', () => {
  // 打红它：给 `now` 加一个 `?? Date.now()` 的兜底 —— 判据就再也不 unmeasured 了。
  const verdict = gate(ctx({ startedAt: T0, lastActivityAt: T0 }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /wait\.now/)
  assert.equal('blockers' in verdict, false)
})

test('★ 未测量臂：拿不到等待起点 ⇒ unmeasured（说不出"已等多久"）', () => {
  // 打红它：把 startedAt 的检查去掉（它会掉进第一次探活那条 ok 的路）。
  const reason = expectUnmeasured(gate({ event: 'runtime-liveness', wait: { lastActivityAt: T0, now: P1 } }))
  assert.match(reason, /wait\.startedAt/)
})

test('★ 未测量臂：拿不到活动观察 ⇒ unmeasured（t5 的两种情形都落在这一格）', () => {
  /**
   * ★ t5 明确不做兜底：没观察到产出时**字段不出现在 ctx 里**，而不是填一个
   *   `startedAt` 进去。那看起来无害（"至少它开工了"），实际是把"没动过"伪造成
   *   "刚动过"—— 而这两件事正是探活要分辨的。
   *
   * 打红它：把 lastActivityAt 的检查去掉，或给它一个 `?? startedAt` 兜底。
   */
  const reason = expectUnmeasured(gate(ctx({ startedAt: T0, now: P1 })))
  assert.match(reason, /wait\.lastActivityAt/)
  assert.match(reason, /not evidence that it is stuck/, '★ 它必须说清"这不是关于成员的结论"')
  assert.equal(/\bit is healthy\b/i.test(reason), false, '★ 不得读起来像"它很健康"')
  assert.match(reason, /an unobserved wait is not a healthy one/, '★ 反向读法：没读到的等待不算健康，而不是"它很健康"')
})

test('★ 未测量臂：整份 wait 观察面缺席 ⇒ unmeasured（与"拿不到某一项"同格但措辞不同）', () => {
  const reason = expectUnmeasured(gate({ event: 'runtime-liveness', task: { id: 't1' } }))
  assert.match(reason, /no wait observation at all/)
})

test('★ 未测量臂：第二次探活、却拿不到上一次的活动读数 ⇒ unmeasured', () => {
  /**
   * ★ 这一格最容易写错："有 previousPollAt ⇒ 探过了 ⇒ 报 ok（它还在跑）"。
   *   那是**把没能测量并进通过**，而且报告读起来完全正常（有 message、有 wait_ms）。
   *   没有可比的那一端时，唯一诚实的话是"我比不了"。
   *
   * 打红它：把 `!hasPreviousActivity` 那一支删掉（它会落到下面 ok 的那条路）。
   */
  const verdict = gate(ctx({
    startedAt: T0, lastActivityAt: T0 + INTERVAL / 2, now: P2, previousPollAt: P1,
  }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /last activity reading of the previous probe is missing/)
  assert.notEqual(shapeOf(verdict), 'ok')
  assert.notEqual(shapeOf(verdict), shapeOf(gate(ctx({
    startedAt: T0, lastActivityAt: T0, now: P2, previousPollAt: P1, previousLastActivityAt: T0,
  }))), '★ 未测量与"卡死"必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 边界钉住（任务要求的四格 + 间隔参数四值）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 边界：正好等于间隔、活动时刻正好没变 ⇒ blocked（边界落在"告警"这一侧）', () => {
  /**
   * ★ 这一格是刻意钉死的，因为它两边都说得通，所以必须有人裁决并写下来：
   *   上一次探活与这一次相隔**正好** 10 分钟，而活动时刻一模一样 ⇒ 算"到了要报警"。
   *
   *   理由：探活的间隔定义就是"多久看一次"，而这一次看到的与上一次**完全一样**。
   *   把"正好等于"放行会让一个每次都在整点探活的等待永久地漏报（判据读的是快照，
   *   不是区间）。⇒ 边界归**报警**这一侧。
   *
   * 打红它：把 `===` 改成 `<`（差一就漏报）。
   */
  const blockers = expectBlocked(gate(ctx({
    startedAt: T0, lastActivityAt: T0, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  assert.equal(blockers.length, 1)
})

test('★ 边界：正好等于间隔、【活动推进了 1ms】⇒ ok（边界不误伤"刚动过"）', () => {
  // 打红它：把 `moved`/`stuck` 的比较改成 `<=` 之类的"模糊相等"。
  const verdict = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + 1, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  assert.equal(verdict.stuck, false)
  assert.equal(verdict.updated_since_previous_probe, true)
})

test('★ 边界：时钟回拨（now < previousPollAt）⇒ unmeasured（不是 ok，也不是 blocked）', () => {
  /**
   * ★ 两个坏选项各自都有明确代价：读成 ok = 把没测成并进通过；
   *   读成 blocked = 一次时钟抖动变成假警报，而假警报教人忽略这条判据。
   *
   * 打红它：把回拨那一支改成 `ok` 或 `blocked`。
   */
  const verdict = gate(ctx({
    startedAt: T0, lastActivityAt: T0, now: P1 - 1,
    previousPollAt: P1, previousLastActivityAt: T0,
  }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /clock went backwards/)
  assert.match(reason, /this is a clock problem/, '★ 必须说清是时钟的问题，不是成员的问题')
  assert.equal(/the member has been stuck|member is at fault|it looks stuck/i.test(reason), false, '★ 不得把它读成一次成员故障')
  assert.match(reason, /not evidence that the member is stuck/, '★ 反向读法：它必须明说"这不是关于成员的结论"')
})

test('★ 边界：第一次探活时"时钟回拨"无从谈起 ⇒ 不因为回拨而 unmeasured', () => {
  /**
   * ★ 顺序的另一面：没有上一次读数就没有"两个读数不可比"这件事。
   *   把回拨判在"第一次"之前，会让每一次首探都多看一个不存在的条件。
   */
  const verdict = expectOk(gate(ctx({ startedAt: T0 + 10_000, lastActivityAt: T0, now: T0 })))
  assert.equal(verdict.first_probe, true)
})

test('★ 边界：间隔参数 0 / NaN / 负数 / Infinity / 非数 ⇒ 不抛错，落回缺省并【记下被忽略】', () => {
  /**
   * ★ 源项目先例（`with-timeout.mjs`）：`ms` 非法时【不加界】而不是抛错 ——
   *   一个因为参数没写对就炸的守卫，会在第一次出问题时被关掉。
   *
   * ★ 在探活里"不加界"的落点是【探活照常、只是没有界可比】，所以本判据的落法是：
   *   落回 10 分钟缺省 + **照常求值**（该报警就报警）+ 把非法值原文记进
   *   `interval_ignored`。★ 参数坏了 ≠ 判据失效。
   *
   * 打红它：`throw new Error(...)`（炸），或静默用缺省（`interval_ignored` 消失）。
   */
  const bad = [0, Number.NaN, -1, Number.POSITIVE_INFINITY, '60000', null]
  for (const intervalMs of bad) {
    const verdict = gate(ctx({
      startedAt: T0, lastActivityAt: T0, now: P2,
      previousPollAt: P1, previousLastActivityAt: T0, intervalMs,
    }))
    const blockers = expectBlocked(verdict)                     // ★ 照常报警
    assert.equal(blockers.length, 2, `intervalMs=${String(intervalMs)}：报警 + 一句参数被忽略`)
    assert.match(blockers[1], /not a finite positive number/)
    assert.match(blockers[1], /instead of throwing/)
  }
})

test('★ 边界：间隔【缺席】⇒ 用缺省，且【不产生】interval_ignored（与"给了但非法"不同形）', () => {
  /**
   * ★ 这一条是刻意分开的两格：缺席 = 正常（用缺省），非法 = **参数坏了**（要有人去看）。
   *   把两者写成同一个标记，会让每一次正常运行都带着一句"被忽略"，
   *   而人就会学会忽略它 —— 本队一直在防的那个形态。
   *
   * 打红它：让 `resolveIntervalMs` 在缺席时也给出 `why`。
   */
  const absent = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + 1, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  assert.equal(absent.interval_ms, INTERVAL)
  assert.equal('interval_ignored' in absent, false, '★ 正常路径不得带"参数被忽略"的标记')

  const illegal = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + 1, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0, intervalMs: 0,
  })))
  assert.equal(illegal.interval_ms, INTERVAL)
  assert.equal('interval_ignored' in illegal, true, '★ 给了非法值必须留下痕迹')
})

test('★ 边界：合法但很小的间隔被原样采用（不做"至少 10 分钟"的静默钳制）', () => {
  // 打红它：加一条 `Math.max(ms, DEFAULT)` 的钳制（那会让夹具里 1 分钟的间隔说谎）。
  const verdict = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + 1, now: T0 + 60_000,
    previousPollAt: T0, previousLastActivityAt: T0, intervalMs: 60_000,
  })))
  assert.equal(verdict.interval_ms, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// 纯数据变换 / 不拒绝任务 / 身份
// ─────────────────────────────────────────────────────────────────────────────

test('★ 判据是纯数据变换：同一个输入两次求值给出【完全相同】的裁决，且不读全局时钟', () => {
  /**
   * ★ 时钟由调用方注入。夹具能真说这句话的方式只有一种：**同一个 ctx 跑两次，
   *   裁决逐字节相同** —— 一个偷偷读 `Date.now()` 的实现会在两次调用之间
   *   （至少偶尔）给出不同的 `wait_ms`。
   *
   * 打红它：把任意一处 `wait.now` 换成 `Date.now()`。
   */
  const input = ctx({ startedAt: T0, lastActivityAt: T0, now: P2, previousPollAt: P1, previousLastActivityAt: T0 })
  const first = gate(input)
  const second = gate(structuredClone(input))
  assert.deepEqual(second, first)

  const live = expectOk(gate(ctx({ lastActivityAt: T0, now: P1 })))
  assert.equal(live.wait_ms, INTERVAL, '★ wait_ms 必须由注入的两个时刻算出，与真实时间无关')
})

test('★ 它不能拒绝任务：blocked 是一条【告警 + 证据】，不是一道拒绝（契约 §5）', () => {
  /**
   * ★ 契约 §5 的硬要求。判据能给出来的最强表态是 `blocked`，而那个字段在 runtime
   *   位置上的语义是"报警"：调用方只记录、不据此拒任务（`evaluateRuntimeGates`
   *   的返回值不参与任何控制流 —— 那条链路由 `gate-position-wiring.test.mjs` 证明）。
   *
   * 本臂在判据这一侧钉的是它的【形状】：产出里既有告警原文，也有可判读的证据，
   * 且它**明说**自己没有结束等待。
   *
   * 打红它：让 blocked 分支不再带证据字段，或把 "not a rejection / not cancelled"
   * 那一句从措辞里删掉。★ 后者是真实的退化：告警会读起来像一次硬超时，
   * 而人下一次就会把它当成"任务被掐了"。
   */
  const blockers = expectBlocked(gate(ctx({
    startedAt: T0, lastActivityAt: T0, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  /**
   * ★ 肯定式断言（见上一条臂的说明）：判据必须**明说**它没有结束等待，
   *   而不是"消息里不含某些词"。
   */
  assert.match(blockers[0], /not a rejection/)
  assert.match(blockers[0], /not cancelled[^;]*nothing is unwound/)

  const ok = expectOk(gate(ctx({
    startedAt: T0, lastActivityAt: T0 + 1, now: P2,
    previousPollAt: P1, previousLastActivityAt: T0,
  })))
  assert.equal(ok.wait_ms, P2 - T0, '★ 通过时也要交出证据')
  assert.equal(ok.lastActivityAt, T0 + 1)
  assert.equal(ok.previous_last_activity_at, T0)
})

test('★ 输入面的第二条纪律：活动观察在【成员上报那一刻】也必须活着（独立于 t5 的夹具）', async () => {
  /**
   * ── ★ 这条护栏为什么要【独立存在一份】────────────────────────────────────────
   *
   * MEASURED（2026-10-06）：`agent_teams_update_task` 上的活动观察一度完全没有跑。
   * 后果不是"夹具红"，而是一条**假报警**：一个只在写文件、只在 update_task 里交
   * 进展、又从不被查状态的成员，`lastActivityAt` 永远停在派发那一刻 ⇒ 第二次探活
   * 判它"卡死"—— 而那正是本队最贵的教训里说的那种会教人忽略门禁的假警报。
   *
   * clock-dev 已在它的 `gate-runtime-clock.test.mjs` 里钉了同一件事。**本条仍然独立
   * 存在**，理由是一条纪律：判据的输入面是**本判据的**事，不能把"我的输入还在不在"
   * 寄存在别人的夹具里 —— 那份夹具若被谁动一下、或随任务一起收口，这一格就没人看了。
   *
   * ── 它钉的是一个【两个方向的合取】，而不是"某个数在动" ──────────────────────
   *
   *   ① 成员**真的又说了一句话**（会话里多一条 `assistant/message`）
   *      ⇒ 走真实的 `update_task`，活动时刻**必须前进**；
   *   ② 成员**什么都没说**，只是工具被调用（心跳 / 重试 / 空转）
   *      ⇒ 活动时刻**必须一动不动**。
   *
   * ★ ② 才是这条护栏真正防的东西，而它比 ① 更容易被写坏：把"这次工具调用"当成
   *   一次产出（"产出当场就在手上，何必去翻日志"）写起来非常顺手，而它会让一个
   *   卡死的成员只要工具还被调用就一直"健康" ⇒ **判据永远不报警**。
   *   用户已裁定的活动定义是「以产出为准（有 `assistant/message` 才算在动）」。
   *
   * ★ 但它仍然是**数据层面的**，不是反向的源码断言：夹具不 grep "有没有调用
   *   observeMemberActivity"（那种断言会在无害重构下红，而在真正的旁路下绿）。
   *   判据是"观察有没有产生正确的读数变化"——**行为对，接线就在**。
   */
  const { registerAgentTeamsTools, waitRecordSnapshot, resetWaitRecords } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const workspace = mkdtempSync(join(tmpdir(), 'liveness-observe-path-'))
  try {
    resetWaitRecords()
    const stateRoot = join(workspace, '.agent-teams')
    await createTeamDir(stateRoot, {
      id: 'team', name: 'Liveness', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 1,
      members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
      tasks: [{
        id: 't1', subject: 'work', assignee: 'worker', status: 'pending',
        dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
      }],
    })
    let t = 1_000_000
    const clock = () => t
    const events = [{ type: 'assistant/message', message: { content: [{ type: 'text', text: 'starting' }] } }]
    const worker = { id: 'worker-session', status: 'idle', session: { header: { cwd: workspace }, events }, steer() {} }
    const captain = { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} }
    const tools = new Map()
    const deliveries = []
    const ctx = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      tools: { register(tool) { tools.set(tool.name, tool) } },
      /**
       * ★ 一个【够真实】的子代理面：`registerAgentTeamsTools` 会装退役成员的投递守卫，
       *   而它要求宿主交出 queue/deliver + sendMessage 三者之一（否则当场抛错 ——
       *   而那个错是**对的**，一个装不上的守卫必须炸，不能静默）。
       */
      subagents: {
        getProvider() { return undefined },
        list() { return [] },
        sendMessage: async () => 'msg-0',
        [Symbol.for('dsh.subagent.queuePrompt')]: async (_parent, childId, content) => {
          deliveries.push({ memberName: childId, text: content.map(block => block.text ?? '').join('') })
          return 'msg-0'
        },
      },
      agents: { get(id) { return id === worker.id ? worker : id === captain.id ? captain : undefined } },
      on() { return () => {} },
      effect(setup) { return setup() },
    }
    registerAgentTeamsTools(ctx, {
      stateDir: '.agent-teams',
      memberProvider: 'spawn',
      maxMembers: 8,
      profiles: {},
      now: clock,
    })
    const call = async (name, args, agent = captain) => {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
      return await tool.execute(args, { agent, signal: new AbortController().signal })
    }
    /** 派发一次，返回这一代等待记录的读数（`attemptId` 与活动时刻）。 */
    const dispatchOnce = async () => {
      await call('agent_teams_status', {})
      await new Promise(resolve => setImmediate(resolve))
      const record = waitRecordSnapshot().at(-1)
      assert.ok(record !== undefined, '前置：派发应当已经记下一条等待记录')
      assert.ok(typeof record.lastActivityAt === 'number', '前置：派发应当已经记下一个活动时刻')
      return record
    }

    /**
     * ── ② 空转：一次**带 output 但没有新产出**的更新，不得让"最近一次活动"前进 ────
     *
     * ★★ 这一条为什么必须【跨代】比较（而不是在一条记录里比 `lastActivityAt`
     *   与 `startedAt`）—— 这是本臂第一版栽过的地方，记下来：
     *
     *   MEASURED：一次 `update_task` 之后任务会**回到派发池并换一代** `attemptId`
     *   （既有调度行为，与本判据无关）。于是那条新记录本来就是"刚开工"，
     *   `lastActivityAt == startedAt` **永远成立** —— 一个把"工具被调用"当成产出的
     *   实现（被否掉的那一版修法）在这条断言下**活得好好的**（定向突变实测：
     *   变异体存活，本臂全绿）。一条在缺陷下不变红的断言，抓不住任何东西。
     *
     *   ⇒ 正确的口径是问**判据真正读到的那个问题**：*"从派发到现在，它到底动过没有？"*
     *     一个一句话都没说的成员，无论它的工具被调用了多少次、换了几代，
     *     记录里**任何一代的** `lastActivityAt` 都不许晚于它的 `startedAt`。
     *     这正是判据在两次探活之间据以判"卡死"的那个读数。
     */
    const first = await dispatchOnce()
    assert.equal(deliveries.length, 1, '前置：成员必须真的被派发出去（走真实路径）')
    t += 60_000
    await call('agent_teams_update_task', {
      task_id: 't1', attempt_id: first.attemptId, output: 'a heartbeat with no new message',
    }, worker)
    const heartbeatRecords = waitRecordSnapshot()
    assert.ok(heartbeatRecords.length >= 1, '前置：心跳之后应当仍有等待记录')
    for (const record of heartbeatRecords) {
      assert.equal(
        record.lastActivityAt,
        record.startedAt,
        `★ 工具被调用【不是】产出：会话里没有新的 assistant/message 时，记录里任何一代的活动时刻都不许晚于它自己的起点 `
        + `（否则一个卡死的成员只要工具还在被调用就永远健康）。实际记录：${JSON.stringify(record)}`,
      )
    }

    /**
     * ── ① 真的说话：会话里多一条 `assistant/message` ⇒ 活动时刻必须前进 ────────
     *
     * ★ 与 ② 用同一条跨代口径（缺陷在任何一代上刷新，都算刷新）。
     */
    t += 60_000
    events.push({ type: 'assistant/message', message: { content: [{ type: 'text', text: 'now I really said something' }] } })
    const current = waitRecordSnapshot().at(-1)
    await call('agent_teams_update_task', {
      task_id: 't1', attempt_id: current.attemptId, output: 'reported from the member path',
    }, worker)
    assert.ok(
      waitRecordSnapshot().some(record => record.lastActivityAt > record.startedAt),
      '★ 成员真的又说了话 ⇒ 成员上报那一刻必须观察到它（否则探活要迟到到下一次队长查状态）',
    )
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('★ appliesTo：只认自己那一个事件（其余五个调用点不该被这条判据发言）', () => {
  assert.equal(appliesTo({ event: 'runtime-liveness' }), true)
  for (const other of ['member-dispatched', 'task-created', 'task-update', 'task-update-settled', 'task-status', 'delivery-declared']) {
    assert.equal(appliesTo({ event: other }), false, `"${other}" 不是一次探活`)
  }
  assert.equal(appliesTo(undefined), false)
  /**
   * ★ 但"能开口却缺输入"绝不靠 appliesTo 藏：那会把「没测到」并进「通过」。
   *   下面这一条钉住两个方向的差别。
   */
  assert.equal(appliesTo({ event: 'runtime-liveness', wait: undefined }), true, '★ 缺输入时它必须仍然开口说 unmeasured')
  assert.equal(shapeOf(gate({ event: 'runtime-liveness' })), 'unmeasured')
})

test('★ 判据身份与装配约定一致（id/point 是装配点的键）', () => {
  assert.equal(id, 'runtime.liveness')
  assert.equal(point, 'runtime')
  assert.equal(DEFAULT_LIVENESS_INTERVAL_MS, 10 * 60_000, '用户裁定：探活间隔 10 分钟')
})
