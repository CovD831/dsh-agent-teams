/**
 * ── gate-tally 的行为测试（16 臂）────────────────────────────────────────────────
 *
 * 它验的是**数据流**，不是函数存在：
 *   逐条裁决 → 落盘 → 读回 → 折成 UsageTally → confidenceOf → readFlywheel
 *
 * ★ 为什么用 `.mts` + `--experimental-strip-types`：本模块是 TS，而仓库的
 *   `.test.mjs` 惯例是"扫源码"而非"import 运行时"。这里要跑真行为，
 *   所以直接跑 TS（Node 22 的类型剥离），不引入构建依赖。
 *
 * 跑法：`node --experimental-strip-types scripts/gate-tally.test.mts`
 * 或 `pnpm verify:gate-tally`。
 *
 * ★ 状态：**尚未纳入 `pnpm verify` 链**（2026-10-23）。原因：本模块还没有生产
 *   调用点，此时把它挂进门禁会让"门禁在测一条没人用的模块"。等接线点定了再挂。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { appendGateTallies, readGateTallies, talliesFromRows, gateTallyPathOf } from '../src/evolution/gate-tally.ts'
import { confidenceOf, readFlywheel } from '../src/confidence.ts'

const root = await mkdtemp(join(tmpdir(), 'gate-tally-'))
let failures = 0
const check = (name: string, cond: boolean, detail?: string): void => {
  if (cond) console.log(`  ok  ${name}`)
  else { failures += 1; console.log(`  FAIL ${name}${detail === undefined ? '' : ' — ' + detail}`) }
}

const ran = [
  { id: 'completion.r5', verdict: 'blocked' as const },
  { id: 'completion.r5', verdict: 'ok' as const },
  { id: 'completion.r5', verdict: 'unmeasured' as const },
  { id: 'dispatch.worktree', verdict: 'skipped' as const },
]

const n = await appendGateTallies({ stateRoot: root, point: 'completion', ran, at: 1000, by: 'agent-a' })
check('写入行数 = 3（skipped 被丢弃）', n === 3, `实际 ${n}`)
check('文件真的落盘', existsSync(gateTallyPathOf(root)))

const log = await readGateTallies(root)
check('读回 3 行', log.rows.length === 3, `实际 ${log.rows.length}`)
check('present = true', log.present === true)
check('unreadable = 0', log.unreadable === 0)

const tallies = talliesFromRows(log.rows)
const r5 = tallies.get('completion.r5')
check('recalled = 3（ok+blocked+unmeasured）', r5?.recalled === 3, JSON.stringify(r5))
check('upvoted = 1（只有 blocked）', r5?.upvoted === 1, JSON.stringify(r5))
check('skipped 的判据不在 Map 里', tallies.get('dispatch.worktree') === undefined)
check('contributors 记到了 agent-a', JSON.stringify(r5?.contributors) === '["agent-a"]', JSON.stringify(r5?.contributors))

const c = confidenceOf(r5)
check('confidence = (1+1)/(3+2) = 0.4', c === 0.4, String(c))
const fw = readFlywheel(r5 ?? {}, 2000)
check('飞轮判 observe（不是 unmeasured）', fw.verdict === 'observe', `${fw.verdict} / ${fw.reasons.join(' | ')}`)
check('四条件里 confidence 读得出来', fw.conditions.confidence === false, JSON.stringify(fw.conditions))

check('空台账 ⇒ 空 Map（不是 0 次曝光）', talliesFromRows([]).size === 0)
const born = talliesFromRows([{ at: 5, point: 'completion', gate: 'x.y', verdict: 'ok' }])
const noBy = born.get('x.y')
check('无 by ⇒ contributors 缺席（不是空数组）', noBy !== undefined && !('contributors' in noBy), JSON.stringify(noBy))
check('无 by 时 upvoted = 0 且 recalled = 1', noBy?.upvoted === 0 && noBy?.recalled === 1)

const missing = await readGateTallies(join(root, 'nope'))
check('目录不存在 ⇒ present=false 且 0 行', missing.present === false && missing.rows.length === 0)

await rm(root, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
