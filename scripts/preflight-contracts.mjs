#!/usr/bin/env node
// ── scripts/preflight-contracts.mjs ──────────────────────────────────────────
//
// 在**建任务之前**用生产同一套判据函数预检契约，而不是被 `create_task` 拒绝后再猜。
//
// ★ 为什么需要它（MEASURED，2026-10-19 夜里）：
//   我连续被 `create_task` 拒了三次，每次都是同一个形状 ——
//   「验收标准点名的标识符，在 verify 指定的那个夹具文件里不存在」。
//   三次都只能靠**读报错**发现，而报错要等一次工具往返（含一次写盘）。
//
//   而拒绝用的那两个函数（`checkTaskPremises` / `validateCreateTask`）
//   **本来就可以离线调用** —— 它们是纯函数，不需要团队、不需要锁、不写盘。
//   ⇒ 「知道规则」与「能在动手前自己判一次」之间隔着一次往返，那个往返是本脚本省掉的东西。
//
// ── 三条纪律（与本仓其它普查脚本同源）────────────────────────────────────────
//
//   ① **不裁决**：本脚本只报出生产判据会怎么说，不自己发明新规则。
//      它 import 的是 `lib/quality-gates.js` —— 生产代码编译出来的那一份。
//   ② **三态不并**：「预检跑了且干净」/「预检跑了且有 N 条问题」/「预检没跑成」
//      三者互不相同。尤其：读不到输入 ⇒ `ran: false`，而不是「0 条问题」。
//   ③ **不读模型自述**：每条结论都带判据自己吐出的原文 detail。
//
// ── 用法 ─────────────────────────────────────────────────────────────────────
//
//   契约从 stdin 读（JSON 数组，每条一个契约草案）：
//
//     echo '[{"kind":"implementation","objective":"...","acceptance":["..."],
//            "inScope":["src/a.ts"],"verify":["node --test scripts/x.test.mjs"]}]' \
//       | node scripts/preflight-contracts.mjs
//
//   退出码 0 = 预检跑完了（不代表每条都干净）/ 2 = 预检没跑成（必须当「未测到」）

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${process.argv[1]}`).href

/**
 * 判据层最小可用的 `TeamState` 形状。
 *
 * ★ 为什么用一个假的团队：`validateCreateTask(team, input)` 只读 `team.halted`
 *   与 `team.tasks`（review 类要核 `reviewedTaskId` 存在）。其余字段对本次预检
 *   没有意义 —— 而为了凑齐它们去构造一份会撒谎的盘面，比缺字段更糟。
 *   预检的判据面**不包含**任何团队级性质（那些是 dispatch 位置的事）。
 */
const EMPTY_TEAM = { halted: false, tasks: [], members: [], name: 'preflight', id: 'preflight' }

function describeFailure(value) {
  return value instanceof Error ? value.message : String(value)
}

/**
 * 对一条契约草案跑生产判据。返回三态之一：
 *   { state: 'clean' }              预检跑了，没有会拒它的东西
 *   { state: 'refused', reasons }   预检跑了，生产判据会拒它（逐条带原文）
 *   { state: 'not-run', error }     预检没能跑成（必须当「未测到」）
 */
export function preflight(contract, deps) {
  const { validateCreateTask, checkTaskPremises } = deps
  const reasons = []

  let validated
  try {
    validated = validateCreateTask(EMPTY_TEAM, contract)
  } catch (error) {
    return { state: 'not-run', error: describeFailure(error) }
  }
  if (validated.ok === false) reasons.push({ tier: 'validate', detail: validated.error })

  /**
   * ★ `checkTaskPremises` 只在**质量类**才有意义（与生产调用点逐字同形）：
   *   `validateCreateTask` 里那一段整个裹在 `if (isQualityKind(kind))` 里。
   *   ⇒ 这里也要裹，否则 `work` 类任务会被报出一堆它根本不需要满足的梯级。
   */
  const kind = contract.kind ?? 'work'
  const qualityKinds = ['implementation', 'verification', 'review', 'repair', 'integration', 'requirements']
  if (qualityKinds.includes(kind)) {
    try {
      const failures = checkTaskPremises({
        objective: contract.objective,
        acceptance: contract.acceptance,
        inScope: contract.inScope,
        verify: contract.verify,
      })
      for (const failure of failures) reasons.push(failure)
    } catch (error) {
      return { state: 'not-run', error: describeFailure(error) }
    }
  }

  return reasons.length === 0 ? { state: 'clean', reasons: [] } : { state: 'refused', reasons }
}

export function preflightAll(contracts, deps) {
  return contracts.map((contract, index) => ({
    index,
    id: contract.id ?? `#${index}`,
    subject: contract.subject ?? '',
    kind: contract.kind ?? 'work',
    reading: preflight(contract, deps),
  }))
}

async function main() {
  let raw
  try {
    raw = readFileSync(0, 'utf8')
  } catch (error) {
    process.stderr.write(`preflight: could not read stdin — ${describeFailure(error)}\n`)
    process.exit(2)
  }
  if (raw.trim() === '') {
    process.stderr.write('preflight: stdin is empty; nothing to check (this is "not measured", not "clean")\n')
    process.exit(2)
  }

  let contracts
  try {
    contracts = JSON.parse(raw)
  } catch (error) {
    process.stderr.write(`preflight: stdin is not valid JSON — ${describeFailure(error)}\n`)
    process.exit(2)
  }
  if (!Array.isArray(contracts)) {
    process.stderr.write('preflight: expected a JSON array of contract drafts\n')
    process.exit(2)
  }

  /**
   * ★ 加载生产判据。用 `lib/` 而不是 `src/` —— 那正是插件运行时真正加载的那一份
   *   （`~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams` 是 link:
   *   指向本树，解析到 `lib/`）。用 `src/` 预检等于用一份没人跑过的代码预检。
   */
  let deps
  try {
    deps = await import('../lib/quality-gates.js')
  } catch (error) {
    process.stderr.write(
      `preflight: could not load lib/quality-gates.js — ${describeFailure(error)}\n`
      + '★ 先跑 `pnpm build`；这一条是「预检没跑成」，不是「契约干净」。\n',
    )
    process.exit(2)
  }
  if (typeof deps.validateCreateTask !== 'function' || typeof deps.checkTaskPremises !== 'function') {
    process.stderr.write('preflight: lib/quality-gates.js does not export the two judges; refusing to guess\n')
    process.exit(2)
  }

  const readings = preflightAll(contracts, deps)
  const refused = readings.filter((item) => item.reading.state === 'refused')
  const notRun = readings.filter((item) => item.reading.state === 'not-run')

  for (const item of readings) {
    const { reading } = item
    if (reading.state === 'clean') {
      process.stdout.write(`ok        ${item.id}  ${item.kind}  ${item.subject}\n`)
      continue
    }
    if (reading.state === 'not-run') {
      process.stdout.write(`NOT-RUN   ${item.id}  ${item.kind}  ${item.subject}\n            ${reading.error}\n`)
      continue
    }
    process.stdout.write(`refused   ${item.id}  ${item.kind}  ${item.subject}\n`)
    for (const reason of reading.reasons) {
      process.stdout.write(`          (${reason.tier}) ${reason.detail}\n`)
    }
  }

  process.stdout.write(
    `\ncontracts ${readings.length} · clean ${readings.length - refused.length - notRun.length}`
    + ` · refused ${refused.length} · not-run ${notRun.length}\n`,
  )
  /**
   * ★ 退出码语义（与 `scripts/mvp-failing-files.mjs` 同源）：
   *   0 = 预检跑完了。**它不代表每条契约都干净** —— 干净与否看上面的 refused 计数。
   *   2 = 预检没跑成。这一条必须被当成「未测到」，绝不许读成「没问题」。
   */
  process.exit(0)
}

if (invokedDirectly) await main()
