/**
 * ── `verify-reload.mjs` 的夹具 ────────────────────────────────────────────────────
 *
 * ── 它在钉什么 ───────────────────────────────────────────────────────────────
 *
 * 这条命令回答一个**否则不可判定**的问题：
 *
 *     「我这次 `pnpm build` 的改动，透过【工具边界】能被看见吗？」
 *
 * ★★ 而它必须成立的理由是一条**实测出来的三层断裂**（2026-10-10）：
 *
 *     ① watcher 追文件       ✅ 成立  —— 有 `hmr/reload` 事件
 *     ② 模块被重新求值       ✅ 成立  —— 在 state.js / update-task.js 顶部插
 *                                       求值探针，两者都被重新求值
 *     ③ apply 被重新执行     ❌ 【不】成立 —— 重载 +1，而 apply 里的探针 0 次
 *
 *   ⇒ 三层在**外部读数上同形**（日志有重载、`lib/` 是新的、`tsc` 退出码 0、
 *     `git status` 干净）⇒ **唯一能分开它们的是一次真实的工具调用。**
 *
 * ── 本夹具的射程（如实写出来）──────────────────────────────────────────────────
 *
 * ★ 它**不**跑一个真实的宿主（那要一个活会话 + 一个团队，夹具做不了）。
 *   它钉的是这条命令的**判据正确性**：
 *     · 两个 verdict 必须不同形（出现哨兵 ⇒ 0；不出现 ⇒ 1）
 *     · arm 之后源码里必须有哨兵、**产物里必须没有**（那正是"待验证"的状态）
 *     · clear 必须**逐字还原**（否则它会在源码里留垃圾）
 *     · 缺 `--saw` 时必须**拒绝判定**（不许猜）
 *     · 哨兵必须**唯一**（两处同名会让"种了"与"种了两次"同形）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'verify-reload.mjs')
const STATE_SRC = join(ROOT, 'src', 'state.ts')
const ARM_FILE = join(ROOT, '.agent-teams', 'reload-check.json')
const BACKUP = join(ROOT, '.agent-teams', 'state.ts.reload-check.bak')

/** 跑脚本，把**退出码与两个流**都取回来（判据靠退出码分形，所以必须收下它）。 */
function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    }
  }
}

/** 确保起始状态干净（否则上一条臂留下的哨兵会污染下一条）。 */
function clean() {
  run(['clear'])
  if (existsSync(ARM_FILE)) rmSync(ARM_FILE, { force: true })
  if (existsSync(BACKUP)) rmSync(BACKUP, { force: true })
}

const pristine = readFileSync(STATE_SRC, 'utf8')

test('★ 臂 1（用法臂）：无参数 ⇒ 退出 0，且把【三层】印出来', () => {
  /**
   * ★ 帮助文本刻意不写"打开 HMR 就不用重启了" —— 实测证明那句话是错的
   *   （重载成立，而 apply 不重跑）。帮助必须与读数一致，否则下一个人照着它推断。
   *   定向突变：把三层那段从帮助里删掉 ⇒ 本臂红。
   */
  const r = run([])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /watcher 追文件/, '★ 必须写出第①层')
  assert.match(r.stdout, /模块被重新求值/, '★ 必须写出第②层')
  assert.match(r.stdout, /apply 被重新执行/, '★ 必须写出第③层（断点）')
  assert.match(r.stdout, /不成立/, '★ 第三层必须标明它不成立 —— 否则帮助会把人引向错的结论')
})

test('★★ 臂 2（arm 臂）：种下之后源码里有哨兵、而【产物里没有】', () => {
  clean()
  try {
    const r = run(['arm'])
    assert.equal(r.code, 0)
    const sentinel = /RELOAD-CHECK-[A-Z0-9]+/.exec(r.stdout)?.[0]
    assert.ok(sentinel !== undefined, '★ arm 必须把哨兵报出来（否则人不知道要找什么）')

    const src = readFileSync(STATE_SRC, 'utf8')
    assert.ok(src.includes(sentinel), '★ 源码里必须种进去了')

    /**
     * ★★ 而**产物里必须还没有** —— 那正是"待验证"的状态。
     *   若 build 在 arm 里顺手跑了，这个读数就变成"已经生效了"，
     *   而它恰好会把要测的那一格跳过去。
     */
    const lib = readFileSync(join(ROOT, 'lib', 'state.js'), 'utf8')
    assert.ok(!lib.includes(sentinel), '★★ arm 不许顺手 build —— 产物必须仍是旧的（那才是待验证状态）')

    /** ★ 备份必须在（clear 靠它还原）。 */
    assert.ok(existsSync(BACKUP), '★ 备份必须存在')
  } finally {
    clean()
  }
})

test('★★★ 臂 3（判据臂 · 核心）：两个 verdict 必须【不同形】', () => {
  /**
   * ── 这一条是本夹具的全部理由 ──────────────────────────────────────────────────
   *
   * 一个"只看有没有哨兵"的实现，若两个方向都退 0（或都退 1），
   * 就与"没有这条命令"同形 —— 而它读起来完全正常（有输出、有结论）。
   * ⇒ 所以判据必须是**退出码不同**，而不只是措辞不同。
   */
  clean()
  try {
    run(['arm'])
    const sentinel = JSON.parse(readFileSync(ARM_FILE, 'utf8')).sentinel

    const yes = run(['read', '--saw', `Error: task status cannot move from "claimed" to "completed" [${sentinel}]`])
    const no = run(['read', '--saw', 'Error: task status cannot move from "claimed" to "completed"'])

    assert.equal(yes.code, 0, '★ 出现哨兵 ⇒ 退出 0（生效）')
    assert.equal(no.code, 1, '★★ 不出现哨兵 ⇒ 退出 1（未生效）—— 两个方向必须不同形')
    assert.notEqual(yes.code, no.code, '★★★ 这就是"可判定"：同一份输入形状，两个相反的结论')

    /**
     * ★ 而**未生效**那一支必须解释"重载了但没生效"这个反直觉的事实 ——
     *   否则读的人会以为"没重载"，而去查错的地方。
     */
    assert.match(no.stdout, /重载/, '★ 未生效时必须说清"重载可能确实发生了"')
    assert.match(no.stdout, /apply/, '★ 且指向真正的断点（apply 不重跑）')
    assert.match(no.stdout, /重启宿主/, '★ 并给出处置')
  } finally {
    clean()
  }
})

test('★★ 臂 4（拒绝臂）：缺 --saw ⇒ 拒绝判定，不许猜', () => {
  /**
   * ★ 判定**必须**由一次真实读数驱动。让它自己猜（例如读产物）会把
   *   "我看到了什么"与"我以为会看到什么"合成一件 —— 而那正是本仓记账最久的形状。
   */
  clean()
  try {
    run(['arm'])
    const missing = run(['read'])
    assert.equal(missing.code, 2, '★ 缺 --saw ⇒ 退出 2（用法错误），不是 1（未生效）')

    const empty = run(['read', '--saw', '   '])
    assert.equal(empty.code, 2, '★ 空白读数同样拒绝（"空"不是"没看到"）')
  } finally {
    clean()
  }
})

test('★★★ 臂 5（还原臂 · 安全）：clear 必须【逐字】还原，不许留垃圾', () => {
  /**
   * ── 为什么这条是安全臂而不是洁癖 ──────────────────────────────────────────────
   *
   * 一个"清不干净"的 verify 命令会在**被测源码**里留下哨兵 ——
   * 而下一次 build 会把它带进产物、带进宿主、带进别人的读数。
   * ★ 那就是"一个诊断工具污染了被测系统"。
   *
   *   定向突变：把 clear 里的 copyFileSync 去掉 ⇒ 本臂红。
   */
  clean()
  try {
    run(['arm'])
    assert.notEqual(readFileSync(STATE_SRC, 'utf8'), pristine, '前置：arm 之后源码必须已经变了')

    const r = run(['clear'])
    assert.equal(r.code, 0, '★ clear 必须成功')
    assert.equal(readFileSync(STATE_SRC, 'utf8'), pristine, '★★★ clear 必须逐字还原到原样')
    assert.doesNotMatch(readFileSync(STATE_SRC, 'utf8'), /RELOAD-CHECK/, '★ 不许残留哨兵')
  } finally {
    clean()
  }
})

test('★ 臂 6（幂等臂）：重复 arm 必须被拒 —— 否则两个哨兵会互相冒充', () => {
  clean()
  try {
    assert.equal(run(['arm']).code, 0)
    const second = run(['arm'])
    assert.equal(second.code, 2, '★ 已种过 ⇒ 拒绝，而不是种第二个')
    assert.match(second.stderr, /已经种过一次/, '★ 并说清要先 clear')
  } finally {
    clean()
  }
})

test('★ 臂 7（show 臂）：三种状态必须不同形', () => {
  clean()
  /** ① 没种 */
  assert.equal(run(['show']).code, 1, '★ 没种 ⇒ 退出 1')

  /** ② 种了、源码在、产物不在（= 待验证） */
  run(['arm'])
  const armed = run(['show'])
  assert.equal(armed.code, 0)
  assert.match(armed.stdout, /源码里还在: 是/)
  assert.match(armed.stdout, /产物里还在: 否/, '★ 这才是"待验证"的样子')

  clean()
})

test('★ 臂 8（坐标臂）：脚本钉的锚点必须真的在源码里', () => {
  /**
   * ★ `verify-reload` 挂哨兵靠一段**字面匹配**。若 `transitionError` 改了措辞，
   *   匹配会失败 —— 而"匹配不上"必须**响亮地失败**，不是静默种不上。
   *   本臂提前把这件事钉住：锚点不在 ⇒ 这里先红，而不是等人跑到 arm 才发现。
   */
  const src = readFileSync(STATE_SRC, 'utf8')
  assert.match(
    src,
    /return `task status cannot move from "\$\{current\}" to "\$\{next\}"`/,
    '★ 锚点不在 src/state.ts 里了 ⇒ 请同步更新 scripts/verify-reload.mjs 的 TARGET_SRC',
  )
})
