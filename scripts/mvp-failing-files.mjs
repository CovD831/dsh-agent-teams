#!/usr/bin/env node
/**
 * ── 失败**文件集合**（不是失败计数）──────────────────────────────────────────────────
 *
 * 用途：`docs/MVP-FUSION-PLAN.md` 的每一步验收都要求"失败文件集合不许变大"。
 * 本文件把 `pnpm test:gates` 的输出变成一份**可 diff 的文件列表**。
 *
 * ── 为什么是文件集合而不是计数（这段理由是从账上来的，不是偏好）──────────────
 *
 * ① `node --test` 的 `✖` 行会出现**两次**（进度中一次、`failing tests:` 汇总里一次）
 *    ⇒ `grep -c '^✖'` 得到 45，而真实失败是 22。**计数会被读错。**
 * ② `scripts/fixtures/baseline-known-failures.json` 的 `_measured_caveat` 逐字写：
 *    「名单会随队友活动抖动……同一提交零碰撞的读数也曾得到 30/31/39 条」——
 *    因为 `lib/` 会被并发 build 改写成不同中间态。**计数还会自己抖。**
 * ③ 集合能做 diff（新增了哪一项、修好了哪一项），计数只能做大小比较。**集合信息量大。**
 *
 * ── 三条纪律（与 `scripts/mvp-measure.mjs` / `scripts/verify-fast.mjs` 同源）──────
 *
 * ① **它不裁决。** 输出里没有 ok / verdict / pass / fail。它只是把测试输出归类成文件。
 * ② **三态不许并。** `ran: false`（没跑成）≠ `files: []`（跑了，零失败）。
 *    跑不起来时它打印 `ran: false` 与原因，**绝不**打印一个空的失败集合 ——
 *    那会让"夹具全绿"与"夹具根本没跑"同形（REQUIREMENTS §4 的第九次事故形态）。
 * ③ **不读模型的自我陈述。** 只解析 `node --test` 自己打印的栈行。
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────────────
 *
 *   0  跑完了，集合已打印（★ 注意：**不代表绿** —— 有失败也返回 0，它是读数工具不是闸）
 *   2  没能跑（spawn 失败 / 无输出 / 输出里找不到任何测试结论）⇒ 调用方必须当成"未测到"
 *
 * 用法：
 *   node scripts/mvp-failing-files.mjs                  # 人读
 *   node scripts/mvp-failing-files.mjs --json           # 机器读
 *   node scripts/mvp-failing-files.mjs --diff <file>    # 与一份旧集合比对（每行一个路径）
 *   node scripts/mvp-failing-files.mjs --save <file>    # 把当前集合写成一行一个路径
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  /**
   * ★ 只印文件头的注释块，且把 shebang 与 `/**` 两行剥掉 ——
   *   一个把 `#!/usr/bin/env node` 当成说明打印出去的 `--help`，本身就是
   *   "两件不同的事同形"的小号样本。
   */
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]
  const body = header
    .split('\n')
    .slice(1)
    .filter((line) => !line.startsWith('/**'))
    .map((line) => line.replace(/^ \* ?/, ''))
    .join('\n')
    .trim()
  process.stdout.write(`${body}\n`)
  process.exit(0)
}
const asJson = argv.includes('--json')
const flagValue = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}
const diffAgainst = flagValue('--diff')
const saveTo = flagValue('--save')

/**
 * 一条 `node --test` 失败栈里，`file:///…/scripts/gate-x.test.mjs:12:3` 那一段是
 * **唯一的**能把失败归到文件的线索。★ 不按"测试名"归 —— 同名测试可能在两个文件里。
 */
const STACK_FILE = /file:\/\/([^\s:)]+\.(?:test\.mjs|test\.js|mjs)):\d+:\d+/

const started = Date.now()

/**
 * ★★ 本文件必须与 `pnpm test:gates` 读**同一件事**：夹具清单从 package.json 里取，
 *    不自己再写一遍 glob。写两遍的下场是"那个命令不含被测文件"（REQUIREMENTS §4 的⑤）。
 */
const testArgv = (() => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const script = pkg.scripts?.['test:gates']
  if (typeof script !== 'string' || !script.startsWith('node --test ')) return undefined
  return script.slice('node --test '.length).trim().split(/\s+/)
})()

const result = testArgv === undefined
  ? { status: null, stdout: '', stderr: 'package.json 里没有 test:gates，或它不是 `node --test …` 形状' }
  : spawnSync('node', ['--test', ...testArgv], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    })

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

/**
 * ★ 三态第一格：「有没有跑成」与「跑成了但零失败」必须分家。
 *   判据：输出里必须出现 `ℹ tests`（node --test 的汇总行），否则就是没跑成。
 */
const ran = /^ℹ tests \d+/m.test(output)

const files = new Set()
for (const match of output.matchAll(new RegExp(STACK_FILE.source, 'g'))) {
  const absolute = decodeURIComponent(match[1])
  files.add(relative(ROOT, absolute))
}
const sorted = [...files].sort()

/**
 * ★ 自检：失败了但一个文件都归不出来，只有一种可能 —— 解析规则与实际输出分叉了。
 *   这时必须报 `ran:false`（未测到），而不是报一个空集合（会被读成"全绿"）。
 */
const reportedFail = /^ℹ fail (\d+)/m.exec(output)
const failCount = reportedFail === null ? null : Number(reportedFail[1])
const parseBlind = failCount !== null && failCount > 0 && sorted.length === 0

const readings = {
  ran: ran && !parseBlind,
  why: !ran
    ? `输出里没有 "ℹ tests" 汇总行 ⇒ 测试没跑成（不是"零失败"）`
    : parseBlind
      ? `ℹ fail ${failCount} 但一个文件都归不出来 ⇒ 栈格式与解析规则分叉（不是"零失败"）`
      : undefined,
  failCount,
  passCount: (() => {
    const match = /^ℹ pass (\d+)/m.exec(output)
    return match === null ? null : Number(match[1])
  })(),
  files: ran && !parseBlind ? sorted : null,
  elapsedMs: Date.now() - started,
}

if (saveTo !== undefined && readings.files !== null) {
  writeFileSync(saveTo, `${readings.files.join('\n')}\n`)
  readings.savedTo = saveTo
}

if (diffAgainst !== undefined) {
  if (readings.files === null) {
    readings.diff = null
    readings.diffWhy = '本次没跑成，无从比对（不是"无变化"）'
  } else {
    const before = new Set(
      readFileSync(diffAgainst, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line !== ''),
    )
    const after = new Set(readings.files)
    readings.diff = {
      added: [...after].filter((item) => !before.has(item)).sort(),
      removed: [...before].filter((item) => !after.has(item)).sort(),
      unchanged: [...after].filter((item) => before.has(item)).sort(),
    }
  }
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(readings, null, 2)}\n`)
} else {
  process.stdout.write('失败文件集合（不是计数 —— 见文件头三条理由）\n')
  process.stdout.write('─'.repeat(78) + '\n')
  if (!readings.ran) {
    process.stdout.write(`  未测到：${readings.why}\n`)
  } else {
    process.stdout.write(`  ℹ fail ${readings.failCount ?? '(无)'} · ℹ pass ${readings.passCount ?? '(无)'} · ${readings.elapsedMs} ms\n`)
    for (const file of readings.files) process.stdout.write(`  ${file}\n`)
  }
  if (readings.diff) {
    process.stdout.write(`\n与 ${diffAgainst} 比对：\n`)
    process.stdout.write(`  新增 ${readings.diff.added.length}：${readings.diff.added.join(', ') || '(无)'}\n`)
    process.stdout.write(`  修好 ${readings.diff.removed.length}：${readings.diff.removed.join(', ') || '(无)'}\n`)
    process.stdout.write(`  不变 ${readings.diff.unchanged.length}\n`)
  } else if (readings.diffWhy !== undefined) {
    process.stdout.write(`\n与 ${diffAgainst} 比对：${readings.diffWhy}\n`)
  }
  if (readings.savedTo !== undefined) process.stdout.write(`\n已写入 ${readings.savedTo}\n`)
  process.stdout.write('\n★ 本文件不裁决：上面没有 ok / verdict / pass / fail。\n')
}

process.exit(readings.ran ? 0 : 2)
