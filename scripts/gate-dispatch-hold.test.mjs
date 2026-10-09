#!/usr/bin/env node
/**
 * ── ★★★ 派发闸门臂（t50 的第三个闸门必须一直在）──────────────────────────────
 *
 * 由来（2026-10-09，captain 实测）：`dispatchHeldByReload` 与它的三处调用
 * **被 `t24` 的整文件 `cp` 覆盖静默删除** —— 而"它一直不在"与"它刚被删掉"
 * 在源码里**同形**，所以没有任何读数会说。
 *
 * ★ 而那次删除还吞掉了另一处（t20 的 `needsWorktreeFor`），
 *   两处都是靠人回头去找才发现的。
 *
 * ⇒ 本臂钉住【那三处闸门在不在】，而不是钉"它判得对不对"：
 *   判得对不对由 `restartQueueFrom` 自己的夹具管，而这一条管
 *   ★【它有没有被删掉】。
 *
 * ★★ 为什么这条不能用"读产品函数"的方式测：
 *   一个被删掉的函数，调用它的地方**编译就不过** —— 所以 typecheck 能抓一部分。
 *   而**整文件覆盖**可能连调用点一起删（那样编译过），
 *   也可能只删函数体（那样编译不过）。
 *   ⇒ 前者编译得过，所以只有一条**数它几个调用点**的臂能抓到。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEDULER_SRC = join(ROOT, 'src', 'scheduler.ts')
const SCHEDULER_LIB = join(ROOT, 'lib', 'scheduler.js')

/** 剥掉注释再搜 —— 否则"描述这个闸门的注释"会被当成"这个闸门在"。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const src = stripComments(readFileSync(SCHEDULER_SRC, 'utf8'))

test('★★★ 臂 1：`dispatchHeldByReload` 的定义在（那条被静默删过一次）', () => {
  assert.match(src, /function dispatchHeldByReload\s*\(/, '★ 定义不在了 —— 而它被整文件覆盖删过一次')
})

test('★★★ 臂 2：它的【三处调用点】都在 —— 少一处就是一条绕过的路', () => {
  const calls = [...src.matchAll(/dispatchHeldByReload\s*\(/g)].length
  /**
   * ★ 一处定义 + 三处调用 = 4。
   *   ★ 而三处各自的理由不同（t50 的注释写了）:
   *     · kickTeam  ⇒ 连一次扫描都不做
   *     · kickMember ⇒ 可被单独调用 ⇒ 只挡一处会让它成为绕过闸门的路
   *     · 取票之前  ⇒ 与上面隔着 await，状态可能变
   *   ⇒ 所以"少一处"不是"少一点保护"，是【留下一条能绕过的路】。
   */
  assert.equal(calls, 4, `★ 期望 4 处（1 定义 + 3 调用），实测 ${calls} —— 少的那几处就是绕过的路`)
})

test('★★ 臂 3：`restartQueueFrom` 的 import 在（它随函数一起被删过）', () => {
  assert.match(src, /import\s*\{[^}]*restartQueueFrom[^}]*\}/, '★ import 不在了')
})

test('★★ 臂 4：闸门与 `halted` / `phase` 【并列】—— 三者必须分别判', () => {
  /**
   * ★ 若有人把三处合成一句（`team.halted || team.phase === 'staged' || held`），
   *   那会让"等人拍板"与"等这一次交接"在日志里同形 —— 而那正是 t50 的注释要防的。
   */
  const gates = [...src.matchAll(/if \((?:fresh|team)?\.?[^)]*halted[^)]*phase === 'staged'\)/g)].length
  assert.ok(gates >= 3, `★ 三处 halted/phase 判断应当都在（实测 ${gates}）`)
  assert.match(src, /dispatch held while a reload is queued/, '★ 扣住时的那条日志不在了 ⇒ 扣了也看不见')
})

test('★★ 臂 5：`lib/` 产物与 `src/` 一致（闸门真的进了构建）', () => {
  const lib = stripComments(readFileSync(SCHEDULER_LIB, 'utf8'))
  const srcCalls = [...src.matchAll(/dispatchHeldByReload\s*\(/g)].length
  const libCalls = [...lib.matchAll(/dispatchHeldByReload\s*\(/g)].length
  assert.equal(libCalls, srcCalls, `★ src 有 ${srcCalls} 处而 lib 有 ${libCalls} 处 ⇒ 产物落后于源码（先 pnpm build）`)
})
