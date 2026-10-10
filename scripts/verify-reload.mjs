#!/usr/bin/env node
/**
 * ── ★★★ 「我这次 build 到底生效了吗？」—— 一条会说话的命令 ────────────────────────
 *
 * ── 它解决的是什么（2026-10-10 实测逼出来的）────────────────────────────────────
 *
 * 打开了 HMR 之后，`pnpm build` 会让宿主**真的重载**（实测：`hmr/reload` 事件
 * 一条条记进 `.agent-teams/hmr-reloads.jsonl`）。于是最自然的推断是：
 * **改代码 → build → 生效**。
 *
 * ★★ 而那是一个**假的三段论**。实测把重载拆成三层，而它们**结论不同**：
 *
 *     ```
 *     ① watcher 追文件        ✅ 成立（149 个只读 fd；就地改写也能触发）
 *     ② 模块被重新求值        ✅ 成立（在 state.js / update-task.js 顶部插求值探针，
 *                                    两次都被重新求值）
 *     ③ ★ apply 被重新执行    ❌ 【不】成立（重载 +1，而 apply 里的探针 0 次）
 *     ```
 *
 * ⇒ ★ 断点在 ③：**模块换了，而 `apply()` 登记给宿主的那些工具闭包仍是旧的。**
 *   而这三层在**外部读数上完全同形** —— 日志里有重载、`lib/` 是新的、
 *   `tsc` 退出码 0、`git status` 干净。**唯一能分开它们的是一次真实的工具调用。**
 *
 * ── 本命令做什么 ──────────────────────────────────────────────────────────────
 *
 * 它把一个**已知的、可观测的字符串**（下称"哨兵"）写进 `lib/state.js` 里
 * `transitionError` 的返回语句，然后**等你从工具侧读它一次**。
 *
 * ★ 为什么挑 `transitionError`：它是**唯一**一条能从成员侧可靠触发、
 *   且返回值会**逐字**出现在工具错误里的路径（`claimed → completed` 是非法转换，
 *   而 ownership 会放行 ⇒ 必然走到那一行）。这一条是实测挑出来的，
 *   不是设计的：`claim.ts` 那条调用点永远被 ownership 守卫挡在前面。
 *
 * ── 用法（三个阶段，必须按顺序）───────────────────────────────────────────────
 *
 *     node scripts/verify-reload.mjs arm     # ① 种哨兵 + build
 *     #  ② 开一个会话，建一个团队，让一个成员把一个 claimed 任务 update 成 completed
 *     #     （或见下面 --expect 的说明）
 *     node scripts/verify-reload.mjs read --saw "<你看到的原文>"   # ③ 判定
 *     node scripts/verify-reload.mjs clear   # ④ 无论结果都要跑：还原
 *
 * ── ★★ 诚实边界（写在最前面，因为它决定这个读数能说什么）────────────────────────
 *
 *   ✓ 它回答的是：「**改动能不能透过工具边界被看见**」—— 那正是你要问的那个问题。
 *   ✗ 它**不能**回答：「HMR 有没有重载」—— 那由 `.agent-teams/hmr-reloads.jsonl`
 *     回答，而实测证明"重载了"与"生效了"是两件事。
 *   ✗ 它只在**有活着的宿主**时有意义（没有宿主 ⇒ 没有工具路径可读）。
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_SRC = join(ROOT, 'src', 'state.ts')
const STATE_LIB = join(ROOT, 'lib', 'state.js')
const ARM_FILE = join(ROOT, '.agent-teams', 'reload-check.json')

/** 哨兵：一个绝不可能与代码里任何既有字符串碰撞的标记。 */
const SENTINEL_PREFIX = 'RELOAD-CHECK-'

/** `transitionError` 里那一行 —— 哨兵挂在它的末尾。 */
const TARGET_SRC = 'return `task status cannot move from "${current}" to "${next}"`'
const TARGET_LIB_RE = /return `task status cannot move from "\$\{current\}" to "\$\{next\}"`/

function now() {
  return new Date().toISOString()
}

function fail(message, code = 1) {
  console.error(`★ ${message}`)
  process.exit(code)
}

function readArm() {
  if (!existsSync(ARM_FILE)) return undefined
  try {
    return JSON.parse(readFileSync(ARM_FILE, 'utf8'))
  } catch {
    return undefined
  }
}

const command = process.argv[2]

// ─────────────────────────────────────────────────────────────────────────────
// arm：种哨兵 + build
// ─────────────────────────────────────────────────────────────────────────────

if (command === 'arm') {
  const existing = readArm()
  if (existing !== undefined && existsSync(join(ROOT, '.agent-teams', 'state.ts.reload-check.bak'))) {
    fail(`已经种过一次了（哨兵 ${existing.sentinel}）。先跑 clear 再 arm。`, 2)
  }
  if (!existsSync(STATE_SRC)) fail(`找不到 ${STATE_SRC}`)

  const sentinel = `${SENTINEL_PREFIX}${Date.now().toString(36).toUpperCase()}`
  const source = readFileSync(STATE_SRC, 'utf8')
  if (!source.includes(TARGET_SRC)) {
    fail(
      '在 src/state.ts 里找不到 transitionError 的那个返回语句。\n'
      + '  ⇒ 它被改过名或改了措辞。本命令**不猜**，请更新 TARGET_SRC 后重试。',
      3,
    )
  }

  /**
   * ★ 备份放在**仓库内**（而不是 /tmp）：这样"忘了 clear"是可发现的 ——
   *   一个留在 `src/` 旁边的 `.bak` 会被 `git status` 看见。
   */
  const backup = join(ROOT, '.agent-teams', 'state.ts.reload-check.bak')
  copyFileSync(STATE_SRC, backup)
  writeFileSync(STATE_SRC, source.replace(TARGET_SRC, `${TARGET_SRC.slice(0, -1)} [${sentinel}]`))

  writeFileSync(ARM_FILE, JSON.stringify({ sentinel, armedAt: now(), backup }, null, 1))

  console.log('── 已种哨兵 ──────────────────────────────────────────────')
  console.log(`  哨兵              ${sentinel}`)
  console.log(`  位置              src/state.ts 的 transitionError`)
  console.log(`  备份              ${backup}`)
  console.log()
  console.log('  下一步:')
  console.log('    ① pnpm build')
  console.log('    ② 从工具侧读一次 —— 建一个团队，让成员把一个 claimed 任务 update 成 completed')
  console.log(`    ③ node scripts/verify-reload.mjs read --saw "<你看到的原文>"`)
  console.log()
  console.log('  ★ 判定：原文里出现哨兵 ⇒ 改动透过了工具边界（生效）')
  console.log('    原文里没有哨兵     ⇒ 改动【没有】透过工具边界（重载了但闭包是旧的）')
  process.exit(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// read：判定
// ─────────────────────────────────────────────────────────────────────────────

if (command === 'read') {
  const arm = readArm()
  if (arm === undefined) fail('没有 arm 过。先跑: node scripts/verify-reload.mjs arm', 2)

  const i = process.argv.indexOf('--saw')
  const saw = i >= 0 ? process.argv[i + 1] : undefined
  if (saw === undefined || saw.trim() === '') {
    fail('缺少 --saw "<你从工具侧看到的原文>"。判定必须由一次真实读数驱动，本命令不猜。', 2)
  }

  const present = saw.includes(arm.sentinel)
  console.log('── 判定 ──────────────────────────────────────────────────')
  console.log(`  哨兵              ${arm.sentinel}`)
  console.log(`  读数里出现        ${present ? '★ 是' : '★ 否'}`)
  console.log()

  if (present) {
    console.log('⇒ ✅ 生效：改动透过了【工具边界】。')
    console.log('   即：宿主现在执行的，是刚才 build 出来的那份代码。')
    process.exit(0)
  }

  console.log('⇒ ❌ 未生效：改动【没有】透过工具边界。')
  console.log()
  console.log('   ★★ 而这与"重载发生了"并不矛盾 —— 实测过的三层：')
  console.log('      ① watcher 追文件      （成立）')
  console.log('      ② 模块被重新求值      （成立）')
  console.log('      ③ apply 被重新执行    （★ 不成立：重载 +1 而 apply 0 次）')
  console.log('     ⇒ 模块换了，而 apply 登记给宿主的工具闭包仍是旧的。')
  console.log()
  console.log('   处置：重启宿主（node scripts/restart-host.mjs --kill），')
  console.log('         或者只改【不经过工具边界】的部分。')
  console.log()
  console.log('   ★ 查重载确实发生过: cat .agent-teams/hmr-reloads.jsonl')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// clear：还原（无论判定结果如何都要跑）
// ─────────────────────────────────────────────────────────────────────────────

if (command === 'clear') {
  const arm = readArm()
  if (arm === undefined) {
    console.log('⇒ 没有 arm 过，无需还原。')
    process.exit(0)
  }
  if (existsSync(arm.backup)) {
    copyFileSync(arm.backup, STATE_SRC)
    console.log(`  ★ 已还原          ${STATE_SRC}`)
  } else {
    /**
     * ★ 备份不在 ⇒ **不要猜着改回去**（那会写坏一个内容未知的文件）。
     *   如实报出来，并给出可核对的当前内容。
     */
    const current = readFileSync(STATE_SRC, 'utf8')
    const still = current.includes(arm.sentinel)
    console.error(`★ 备份不在了: ${arm.backup}`)
    console.error(`  当前 src/state.ts 里哨兵还在吗: ${still ? '★ 还在 ⇒ 必须手工删掉' : '不在'}`)
    process.exit(4)
  }
  // 只删我们写的那个 arm 文件（★ 不整目录删 —— 那里还有别的状态）。
  try {
    writeFileSync(ARM_FILE, JSON.stringify({ ...arm, clearedAt: now() }, null, 1))
  } catch { /* ignore */ }
  console.log()
  console.log('  下一步: pnpm build，让盘上产物与源码一致。')
  process.exit(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// show：只回答"现在种着吗"（给脚本用）
// ─────────────────────────────────────────────────────────────────────────────

if (command === 'show') {
  const arm = readArm()
  if (arm === undefined) {
    console.log('未种哨兵')
    process.exit(1)
  }
  console.log(`哨兵 ${arm.sentinel}（${arm.armedAt} 种下）`)
  const source = readFileSync(STATE_SRC, 'utf8')
  console.log(`源码里还在: ${source.includes(arm.sentinel) ? '是' : '否'}`)
  console.log(`产物里还在: ${existsSync(STATE_LIB) && readFileSync(STATE_LIB, 'utf8').includes(arm.sentinel) ? '是' : '否'}`)
  process.exit(0)
}

/**
 * ── 无参数：打印用法，并把【三层】写在帮助里 ────────────────────────────────────
 *
 * ★ 帮助文本刻意不写"打开 HMR 就不用重启了" —— 实测证明那句话是错的
 *   （重载成立，而 apply 不重跑）。帮助要与读数一致，否则下一个人照着它推断。
 */
console.log('用法:')
console.log('  node scripts/verify-reload.mjs arm                     # 种哨兵')
console.log('  node scripts/verify-reload.mjs read --saw "<原文>"     # 判定')
console.log('  node scripts/verify-reload.mjs clear                   # 还原')
console.log('  node scripts/verify-reload.mjs show                    # 现在种着吗')
console.log()
console.log('它回答:「我这次 build 的改动，透过【工具边界】能被看见吗？」')
console.log()
console.log('★ 实测过的三层（结论不同，而读数上同形）:')
console.log('   ① watcher 追文件      成立  —— 有 hmr/reload 事件')
console.log('   ② 模块被重新求值      成立  —— state.js / update-task.js 都被重求值')
console.log('   ③ apply 被重新执行    ★不成立 —— 重载 +1，而 apply 里的探针 0 次')
console.log('  ⇒ 所以"日志里有重载"不能推出"我的改动生效了"。')
process.exit(0)
