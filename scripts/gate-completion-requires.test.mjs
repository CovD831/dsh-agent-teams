/**
 * ── completion 位置四条判据的【输入面】夹具（t4）───────────────────────────────
 *
 * 本夹具测的不是判据的裁决（那四条的裁决各有自己的夹具：gate-verify-rerun /
 * gate-r5 / gate-mutation / gate-backtest），测的是**它们的输入面声明**：
 *
 *   B 层：`requires` 用 TS 类型声明 ⇒ 拼错的路径在【编译期】报 TS2322。
 *   A 层：每条声明的那一格，在真实 ctx 上缺席时**核对层必须报出它缺**。
 *
 * ── ★ 为什么这个位置值得一份专门的夹具 ────────────────────────────────────────
 *
 * MEASURED（本轮开工前的复盘）：completion 位置的四条判据是上一轮的**重灾区**，
 * 而四次的症状一模一样 —— 判据照常跑、照常说"我没能测量"（`unmeasured`），
 * 而 `unmeasured` 在日志里与 `ok` 同形：
 *
 *     verify-rerun  缺 execVerifyCommand        ⇒ 静默 unmeasured
 *     r5            缺 parentRevision/scanDirs/runTestOnRevision ⇒ 静默 unmeasured
 *     mutation      缺 readFile/runTest/writeFile                ⇒ 静默 unmeasured
 *     backtest      缺 baseline/coverage/两个执行器              ⇒ 静默 unmeasured
 *
 * ⇒ 所以本夹具是一次**回归**：它逐格断言"这条判据声明的每一格，都对着一个真实
 *   的未测量臂"。**如果新机制覆盖不了那些真实发生过的错误，它就是不够用的。**
 *
 * ── 三个臂形状（与 gate-requires.test.mjs 同源）────────────────────────────────
 *
 *   臂 A（对照臂）：声明的每一格都在场 ⇒ `ok`、`incomplete === 0`
 *   臂 B（伪造臂）：适用、而把手接的执行器拿掉 ⇒ 核对**必须报出缺的是哪一个**
 *   臂 C（未测量臂）：`appliesTo` 为假 ⇒ 不报（噪音与误报同样有害）
 *
 * ★ 另有一组"声明覆盖率"臂：把每条判据声明的每一格**逐格**拿掉，核对都要报缺。
 *   一格一条断言 —— 这是"每个声明一条夹具臂"的字面执行，也是本夹具与
 *   gate-requires.test.mjs 的区别：那边测**机制**，这边测**这份接线**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createGateRegistry } from '../lib/gates/registry.js'
import { checkRequires } from '../lib/gates/requires.js'
import { kindRequirementsTable } from './kind-requirements-table.mjs'
import { parseKindRequirements } from '../lib/gates/completion/r5.js'

import {
  requires as verifyRerunRequires, appliesTo as verifyRerunApplies,
} from '../lib/gates/completion/verify-rerun.js'
import {
  requires as r5Requires, appliesTo as r5Applies,
} from '../lib/gates/completion/r5.js'
import {
  requires as mutationRequires, appliesTo as mutationApplies,
} from '../lib/gates/completion/mutation.js'
import {
  requires as backtestRequires, appliesTo as backtestApplies,
} from '../lib/gates/completion/backtest.js'

// ─────────────────────────────────────────────────────────────────────────────
// 四条判据的形状表 —— 本夹具的**唯一事实来源**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 每一条都带三样东西：
 *   · `id` / `requires` —— 从**判据模块本身**读，不在这里抄一遍
 *     （抄一遍就多了一个会腐烂的副本，而"抄漏一格"正是本轮要消灭的形态）；
 *   · `appliesTo` —— 同上；
 *   · `satisfying` —— 一份**让这条判据真的适用**的 ctx（臂 A 的对照）。
 *   · `executorGaps` —— 这条判据的【未测量臂】点名的那几格。它是本夹具的核心：
 *     它说的是"这几格缺席时，判据自己会返回 unmeasured"，而核对层必须
 *     在**求值之前**就报出同一件事。
 */
const SUBJECTS = [
  {
    id: 'completion.verify-rerun',
    requires: verifyRerunRequires,
    appliesTo: verifyRerunApplies,
    /**
     * ★ 未测量臂原文（见 verify-rerun.ts 的 gate()）：
     *   "verify re-execution is unavailable (no executor injected)"
     *   ⇒ 缺口就是执行器这一格。
     */
    executorGaps: ['execVerifyCommand'],
    /** 让 appliesTo 为真的最小 ctx：试图置 completed、非终态、声明了 verify。 */
    satisfying: {
      loadKindRequirements: () => TABLE,
      wantsCompleted: true,
      taskNotTerminal: true,
      task: { id: 't4', verify: ['pnpm typecheck'] },
      execVerifyCommand: async () => 0,
    },
  },
  {
    id: 'completion.r5',
    requires: r5Requires,
    appliesTo: r5Applies,
    /**
     * ★ 未测量臂点名三格（见 r5.ts 的 ①②④）：
     *   ① "no revision runner was injected"        ⇒ runTestOnRevision
     *   ② "no scan directories were declared"       ⇒ scanDirs
     *   ④ "no parent revision is available"         ⇒ parentRevision
     */
    executorGaps: ['runTestOnRevision', 'scanDirs', 'parentRevision'],
    satisfying: {
      loadKindRequirements: () => TABLE,
      wantsCompleted: true,
      taskNotTerminal: true,
      task: { id: 't4', kind: 'implementation' },
      update: { newTestFiles: ['scripts/gate-r5.test.mjs'] },
      parentRevision: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      scanDirs: ['scripts'],
      runTestOnRevision: async () => ({ exitCode: 1 }),
    },
  },
  {
    id: 'completion.mutation',
    requires: mutationRequires,
    appliesTo: mutationApplies,
    /**
     * ★ 未测量臂把三样能力拼成一句（见 mutation.ts 的 gate()）：
     *   "mutation testing is unavailable (no readFile / runTest / writeFile injected)"
     *   ⇒ 缺口就是这三格。
     */
    executorGaps: ['readFile', 'runTest', 'writeFile'],
    satisfying: {
      loadKindRequirements: () => TABLE,
      wantsCompleted: true,
      taskNotTerminal: true,
      task: { id: 't4', kind: 'implementation' },
      changedFiles: ['src/a.ts'],
      changedLines: [1],
      killerSuites: [{ files: ['scripts/a.test.mjs'] }],
      readFile: () => 'const a = 1\n',
      runTest: async () => ({ exitCode: 1, stdout: 'pass 1\nfail 0\n', stderr: '' }),
      writeFile: () => {},
    },
  },
  {
    id: 'completion.backtest',
    requires: backtestRequires,
    appliesTo: backtestApplies,
    /**
     * ★ 未测量臂点名三格（见 backtest.ts）：
     *   · baseline 缺席 ⇒ "the baseline state is unavailable"
     *   · coverage 缺席 ⇒ "no dependency graph / coverage data was provided"
     *   · execBacktestCommand 缺席 ⇒ "no full-suite executor was injected"
     *
     * ★ `execSelectedCommand` **不在这里**，尽管它看起来像"第四格"。理由是
     *   判据自己划的线：它只在 `coverage.command !== undefined` 时才被用到，
     *   而"不跑选测"是判据**明确允许**的一种正常情形（"没给 ⇒ 不假装跑过"）。
     *   ⇒ 它缺席时判据照常说话 ⇒ 它不属于输入面（见下 §有条件的那一格）。
     */
    executorGaps: ['baseline', 'coverage', 'execBacktestCommand'],
    satisfying: {
      loadKindRequirements: () => TABLE,
      /**
       * ── ★★ t48：这一格此前**没有 kind** —— 而那正是缺陷的形状 ───────────────────
       *
       * MEASURED：`backtest.appliesTo` 当时没有 kind 守卫，于是"只喂 changedPaths"
       * 就能让它生效。⇒ 本夹具的 satisfying ctx **照着那个实现写**，
       * 于是一份"完整 ctx"其实缺了契约真正要求的那一格。
       *
       * ★ 加了 kind 守卫之后，少了它会让本判据落进 `appliesTo === false`（skipped），
       *   而本文件把它读成"完整 ctx 上必须 ok，实际 skipped" ⇒ **臂 A 红**。
       *   ★ 而那次红是**对的**：它说明"这份完整 ctx 其实不完整"。
       *   ★ 形态：**夹具可以为缺陷背书** —— 只要它照着实现写，而不是照着契约写。
       */
      task: { id: 't4', kind: 'implementation' },
      changedPaths: ['src/a.ts'],
      baseline: { exitCode: 0, label: 'HEAD' },
      coverage: {
        source: 'dependency-graph',
        dependents: {},
        coverage: { 'src/a.ts': ['scripts/a.test.mjs'] },
        knownTests: ['scripts/a.test.mjs'],
        selected: ['scripts/a.test.mjs'],
      },
      execBacktestCommand: async () => 0,
      // ★ 刻意**不**给 coverage.command / execSelectedCommand：
      //   这份 ctx 是"不跑选测"的正常路径，而它在完整 ctx 上必须核对为 ok
      //   （第一版在这里报了假缺口，被臂 A 抓到 —— 见文件尾 FINDING 2）。
    },
  },
]

/**
 * 从一份 ctx 上逐层拿掉一条路径（`a.b` ⇒ 删掉 ctx.a 上的 `b`）。
 *
 * ★ 手写浅拷贝而不是 `structuredClone`：这份 ctx 里的执行器**就是函数**
 *   （`execVerifyCommand` / `readFile` / `runTestOnRevision` …），而
 *   `structuredClone` 遇到函数会抛 `DataCloneError` —— 那个夹具自己的
 *   缺陷会伪装成"判据的输入面有问题"。函数在拷贝里是**共享**的，这是对的：
 *   本夹具只改结构（哪一格在不在），从不改函数的行为。
 */
function without(ctx, path) {
  const clone = shallowClone(ctx)
  const segments = path.split('.')
  let cursor = clone
  for (const segment of segments.slice(0, -1)) {
    if (cursor?.[segment] === undefined) return clone
    cursor[segment] = shallowClone(cursor[segment])
    cursor = cursor[segment]
  }
  delete cursor[segments[segments.length - 1]]
  return clone
}

/** 只拷一层（数组也拷，免得 `delete` 摸到原对象）。 */
function shallowClone(value) {
  if (Array.isArray(value)) return value.slice()
  if (value !== null && typeof value === 'object') return { ...value }
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：声明本身必须存在，且非空 —— 消灭"没声明"与"不需要"的同形
// ─────────────────────────────────────────────────────────────────────────────


const TABLE = kindRequirementsTable(parseKindRequirements)

test('臂 0 ★ 四条判据都真的声明了 requires（不是缺席，也不是空数组）', () => {
  for (const subject of SUBJECTS) {
    assert.ok(Array.isArray(subject.requires), `${subject.id} 必须导出 requires 数组（缺席 = 输入面未知）`)
    /**
     * ★ 空数组是**合法**的（"不依赖 ctx 任何一格"），但它在本位置是**错的**：
     *   这四条判据每一条都有真实的执行器/数据注入面（见 executorGaps）。
     *   一条声明了 `[]` 的 completion 判据等于说"我不需要任何输入"——
     *   而它明明要一个执行器才能说话。这正是本轮要抓的那句谎。
     */
    assert.ok(subject.requires.length > 0, `${subject.id} 在 completion 位置不可能不依赖任何一格（它有注入面）`)
    assert.equal(new Set(subject.requires).size, subject.requires.length, `${subject.id}: 声明不许有重复项`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 A：对照臂 —— 声明的每一格都在场 ⇒ 不报
// ─────────────────────────────────────────────────────────────────────────────

test('臂 A ★ 对照臂：四条判据在各自的完整 ctx 上都核对为 ok', () => {
  for (const subject of SUBJECTS) {
    const check = checkRequires(subject, subject.satisfying)
    assert.equal(
      check.status, 'ok',
      `${subject.id}: 完整 ctx 上必须 ok，实际 ${check.status}（缺 ${JSON.stringify(check.missing)}）`,
    )
    /**
     * ★ 同时钉住"声明与 ctx 是同一套口径"：`appliesTo` 必须在同一份 ctx 上为真。
     *   否则这条判据的闸门与它的声明互相矛盾 —— 闸门说"不适用"（于是核对被跳过），
     *   而声明说"我要这几格"。两者必须一起动，本断言就是那个联轴器。
     */
    assert.equal(subject.appliesTo(subject.satisfying), true, `${subject.id}: 完整 ctx 上 appliesTo 必须为真（否则核对会被跳过，臂 A 测的就成了别的东西）`)

    /**
     * ── ★ 另一半（FINDING 2 的回归臂）：核对层不许报**判据自己不认**的缺口 ──────
     *
     * 这条 ctx 是判据的**正常路径**之一：判据会在它上面说话（甚至返回 ok）。
     * 核对层若在这里报缺，报的就是一个不存在的缺口 —— 噪音。
     * 第一版 `backtest` 的声明正是这样（多声明了有条件的 `execSelectedCommand`），
     * 而臂 A 当场把它抓了出来。
     */
    assert.deepEqual(
      checkRequires(subject, subject.satisfying).missing, [],
      `${subject.id}: 一份判据自己认的正常 ctx，核对不许报缺口（那是噪音，会教人忽略核对）`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 B：★ 核心 —— 逐格拿掉，核对必须报出【缺的是哪一个】
// ─────────────────────────────────────────────────────────────────────────────

test('臂 B ★ 伪造臂：声明的每一格，拿掉一格 ⇒ 核对必须报出那一格（一格一条）', () => {
  for (const subject of SUBJECTS) {
    const ready = checkRequires(subject, subject.satisfying)
    assert.equal(ready.status, 'ok', `${subject.id}: 前置条件 —— 完整 ctx 必须 ok`)

    for (const path of subject.requires) {
      /**
       * ── ★★ 这里有一个**形状层的缺口**，夹具不许绕过去（见文件尾 FINDING 1）───────
       *
       * 声明里混着**两类**格子，而核对层对它们**做不到一视同仁**：
       *
       *   · 测量格（`execVerifyCommand` / `parentRevision` / `baseline` …）
       *     —— 判据自己读它。它缺席时 `appliesTo` 照样为真 ⇒ 核对报 `incomplete`。✓
       *   · 闸门格（`wantsCompleted` / `task.kind` / `taskNotTerminal` …）
       *     —— `appliesTo` **自己**读它。它缺席时 `appliesTo` 恒为假 ⇒ 注册表把这条
       *     判据判成"不适用" ⇒ 核对被**跳过**（`skipped`），于是"这一格的声明"
       *     永远报不出来。
       *
       * ★ 后果用一句话说：**闸门格缺席 ⇒ 判据无声地不说话了，而核对层也说不出话。**
       *   而这正是本轮要消灭的那个形态（"判据没生效"与"判据通过"同形），
       *   只是换了个入口 —— 上一轮缺的是执行器（测量格，现在能抓），
       *   而如果下次缺的是 `wantsCompleted`（闸门格），新机制**抓不到**。
       *
       * ⇒ 夹具的处置：闸门格**照样逐条断言**，但断言的是它当前**真实**的行为
       *   （`skipped`），并把"这不对"写在这里。**不**为了让夹具变绿而把闸门格
       *   从 `requires` 里删掉 —— 那等于把发现藏起来（"写不出来"是最有价值的
       *   发现，不是要绕开的东西）。见 FINDING 1 的完整报告。
       */
      const gate = isGateField(subject.id, path)
      const thinned = checkRequires(subject, without(subject.satisfying, path))
      if (gate) {
        assert.equal(
          subject.appliesTo(without(subject.satisfying, path)), false,
          `${subject.id}: "${path}" 被当作闸门格（appliesTo 读它），拿掉它 appliesTo 必须变假`,
        )
        assert.equal(
          thinned.status, 'skipped',
          `${subject.id}: 闸门格 "${path}" 缺席 ⇒ 现状是 skipped（报不出来）。★ 这一条若变红，说明闸门格的行为变了 —— 那是好消息，应更新 FINDING 1`,
        )
        continue
      }
      /**
       * ★ 这一条就是"每个声明一条夹具臂"的字面执行：声明了 8 格就有 8 条。
       *   一格不报 ⇒ 那一格的声明是**装饰性的**（恒真的断言，规则二后半句）。
       */
      assert.equal(
        thinned.status, 'incomplete',
        `${subject.id}: 拿掉 "${path}" 之后核对仍说 ${thinned.status} —— 这一格的声明没有被核对（它测的不是它声称的东西）`,
      )
      assert.ok(
        thinned.missing.includes(path),
        `${subject.id}: 拿掉 "${path}"，核对报的是 ${JSON.stringify(thinned.missing)} —— 没有指名那一格`,
      )
      /**
       * ★ 且**只能**缺那一格 —— 但"只能"要按路径的**包含关系**读，不是字符串前缀：
       *
       *   拿掉 `coverage.source` 时，`coverage` 这一格**仍在场**（只是少了个子字段），
       *   所以缺的恰好是 `coverage.source` 自己。反过来，拿掉 `coverage` 时
       *   `coverage.source` 自然也读不到了 ⇒ 两者一起缺。**两者都是对的**：
       *   前者是"少一个读数"，后者是"整格缺席"，而 requires.ts 的设计决定①
       *   正是为了让这两件事分得开。
       *
       * ⇒ 期望的缺格集合 = `path` 自己 + **所有以它为前缀的子路径**
       *   （`path` 是 `other` 的祖先 ⇒ 祖先没了，后代必然读不到）。
       */
      const descendants = subject.requires.filter((other) => other.startsWith(`${path}.`))
      assert.deepEqual(
        [...thinned.missing].sort(), [path, ...descendants].sort(),
        `${subject.id}: 拿掉 "${path}" 的缺格集合应为 {自己 + 子路径}，实际 ${JSON.stringify(thinned.missing)}`,
      )
    }
  }
})

/**
 * ── ★ 闸门格：`appliesTo` 自己读的那些格 ────────────────────────────────────────
 *
 * 它们与测量格的区别不是"重要性"，而是**谁读它**：
 *   · 测量格由 `gate()` 读 ⇒ 缺席时判据仍被求值 ⇒ 核对能报。
 *   · 闸门格由 `appliesTo()` 读 ⇒ 缺席时判据压根不被求值 ⇒ 核对被跳过。
 *
 * ★ 这张表是**显式**的，不是猜的：一条声明是不是闸门格，由"拿掉它之后
 *   `appliesTo` 是否变假"来判定 —— 那正是下面这个函数在做的事。
 *   写成表而不是在循环里现算，是因为"哪些格属于闸门"本身就是要报出去的事实
 *   （FINDING 1 的读数），值得有个名字。
 */
function isGateField(id, path) {
  const subject = SUBJECTS.find((item) => item.id === id)
  if (subject === undefined) return false
  const thinned = without(subject.satisfying, path)
  /**
   * 判据：拿掉这一格之后 `appliesTo` 变假，**而它原本为真**。
   * 用 `appliesTo` 自己回答 —— 不给这张表留一份会腐烂的副本。
   */
  return subject.appliesTo(subject.satisfying) === true && subject.appliesTo(thinned) === false
}

test('臂 B2 ★ 未测量臂的每一格都在声明里（★ 本夹具存在的全部理由）', () => {
  for (const subject of SUBJECTS) {
    for (const gap of subject.executorGaps) {
      /**
       * ── ★ 这是本轮最重要的一条断言 ────────────────────────────────────────────
       *
       * 它把两件事绑在一起：
       *   ① 这条判据的【未测量臂】点名了这一格（拿掉它 ⇒ 判据返回 unmeasured）；
       *   ② 这条判据的【requires】声明了这一格。
       *
       * 两者不一致就是本轮要消灭的形态：判据会对着一格缺席说"我没能测量"，
       * 而核对层对此一无所知（它没被声明），于是那份 unmeasured 依旧与 ok 同形。
       *
       * ★ 这条断言是这一整轮工作的验收标准本身：**新机制必须覆盖那些真实发生过的
       *   错误**。上一轮的四个缺口（execVerifyCommand / parentRevision+scanDirs+
       *   runTestOnRevision / readFile+runTest+writeFile / baseline+coverage+执行器）
       *   就是 `executorGaps` 里的这十格。
       */
      assert.ok(
        subject.requires.includes(gap),
        `${subject.id}: 未测量臂点名了 "${gap}"（它缺席 ⇒ 判据静默 unmeasured），而 requires 里【没有它】—— 核对层永远报不出这个缺口`,
      )

      // 而且它必须真的会被报出来（不是声明了却核不到）。
      const thinned = checkRequires(subject, without(subject.satisfying, gap))
      assert.ok(
        thinned.missing.includes(gap),
        `${subject.id}: "${gap}" 声明了，但拿掉它核对没报（报的是 ${JSON.stringify(thinned.missing)}）`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 C：不适用 ⇒ 不报（噪音与误报同样有害）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 C ★ 未测量臂：appliesTo 为假 ⇒ 不报，且与"核对了、都齐"不同形', () => {
  for (const subject of SUBJECTS) {
    /**
     * 一份**故意什么都没有**的 ctx：四个判据的 `appliesTo` 在它上面都必须为假
     * （没有 wantsCompleted / 没有 kind / 没有 changedPaths）。
     */
    const empty = {}
    assert.equal(subject.appliesTo(empty), false, `${subject.id}: 空 ctx 上 appliesTo 必须为假（否则这一臂测的不是不适用）`)

    const skipped = checkRequires(subject, empty)
    assert.equal(skipped.status, 'skipped', `${subject.id}: 不适用 ⇒ skipped，不是 incomplete`)
    assert.deepEqual(skipped.missing, [], `${subject.id}: ★ 不适用就不许报缺失 —— 11×8 的组合里大部分本就不适用，噪音会教人忽略门禁`)
    assert.match(skipped.skippedBecause, /appliesTo|not applicable/, `${subject.id}: 跳过要说清理由`)

    // "不适用"与"核对了、都齐"必须不同形。
    const ready = checkRequires(subject, subject.satisfying)
    assert.notDeepEqual(
      { checked: skipped.status, missing: skipped.missing },
      { checked: ready.status, missing: ready.missing },
      `${subject.id}: 不适用 与 都齐 必须不同形`,
    )
  }
})

test('臂 C2 ★ 终态补证据 / 中途更新 ⇒ 不报（不适用不报的具体形态）', () => {
  /**
   * ★ 这几份 ctx 取的是**真实存在过的形状**（issue159 的补证据路径、开工时的
   *   in_progress 更新）。它们在上一轮都触发过误伤（lifecycle-verify 实测断在
   *   in_progress 那条更新上）。核对层必须按同样的闸门跳过，不许另建一套口径。
   */
  const cases = [
    { why: '不是试图置为 completed（开工/中途更新）', ctx: { wantsCompleted: false, taskNotTerminal: true, task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] } } },
    { why: '任务已是终态（issue159 补证据，不是新的完成裁决）', ctx: { wantsCompleted: true, taskNotTerminal: false, task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] } } },
  ]
  for (const { why, ctx } of cases) {
    for (const subject of SUBJECTS) {
      const check = checkRequires(subject, ctx)
      /**
       * ★ 这四条判据在两种情形下都【不该说话】⇒ 核对也不该说话。
       *   注意 r5 在这一格上有过一条实测出来的缺陷（判据之间的不一致，已被修）——
       *   本断言把它钉在核对层上：判据说"不适用"，核对就不许报缺。
       */
      assert.equal(check.status, 'skipped', `${subject.id} @ ${why}: 应为 skipped，实际 ${check.status}`)
      assert.deepEqual(check.missing, [], `${subject.id} @ ${why}: 不适用不许报缺失`)
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 D：先软后硬 —— 核对不拒绝流程（走真的注册表，不是只调核对函数）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 D ★ 观察模式：缺格只进旁路字段，裁决一个字节都不动', async () => {
  for (const subject of SUBJECTS) {
    const r = createGateRegistry()
    const registered = r.register({
      id: subject.id,
      point: 'completion',
      description: `${subject.id} probe`,
      gate: () => ({ ok: true }),
      appliesTo: subject.appliesTo,
      requires: subject.requires,
    })
    assert.equal(registered.requires, subject.requires, '★ 声明必须原样进注册表（否则核对读的是另一份清单）')

    /** 适用、但一格都没接上（拿掉全部注入面）。 */
    const barren = shallowClone(subject.satisfying)
    for (const gap of subject.executorGaps) delete barren[gap]

    const evaluation = await r.evaluate('completion', barren)
    assert.equal(evaluation.requires.incomplete, 1, `${subject.id}: 缺陷必须被核对看见`)
    assert.ok(evaluation.requires.missing.length > 0, `${subject.id}: 要有人话清单`)

    /**
     * ★ 这三条是"先软后硬"的字面执行：
     *   · 裁决不变（ok / blockers / unmeasured 一个都不动）；
     *   · 判据照常跑（核对不拦它）。
     */
    assert.equal(evaluation.ok, true, `${subject.id}: 观察模式下核对不得拒绝流程`)
    assert.deepEqual(evaluation.blockers, [], `${subject.id}: 不得产出 blocker`)
    assert.equal(evaluation.evaluated, 1, `${subject.id}: 判据必须照常求值`)
  }
})

test('臂 D2 ★ 同一份 ctx：核对照常记录，而判据的 unmeasured 照常产出（两者不同形）', async () => {
  /**
   * ★ 这一臂说的是本轮的**形状**：核对结论挂在旁路，判据结论进裁决，
   *   两者是**两份不同的数据**。把它们合成一份，就会重演本轮要消灭的同形问题
   *   （"核对说缺"与"判据说没测到"读起来一样，但它们的修法完全不同）。
   */
  const r = createGateRegistry()
  r.register({
    id: 'completion.probe',
    point: 'completion',
    description: 'probe',
    gate: () => ({ ok: false, unmeasured: 'the executor was not injected' }),
    requires: ['execVerifyCommand'],
  })

  const evaluation = await r.evaluate('completion', {})
  assert.equal(evaluation.requires.incomplete, 1, '★ 核对看见了缺口')
  assert.equal(evaluation.requires.checks[0].missing.includes('execVerifyCommand'), true)
  /**
   * 判据自己的 unmeasured 仍在 `unmeasured` 那格（不是 `requires` 那格）——
   * 两条信息各归各位。
   */
  assert.notEqual(evaluation.requires, undefined)
  assert.equal(typeof evaluation.unmeasured, 'string', '★ 判据的结论文本在 `unmeasured` 那格')
  assert.match(evaluation.unmeasured, /executor/, '★ 它是判据说的话，不是核对层说的话')
  assert.equal(evaluation.ok, false, '★ 这条判据自己返回了 unmeasured ⇒ 裁决是 false（与 arm D 的"核对不拒绝流程"成对照）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 本轮的两条发现 —— 都是夹具【先红过】才写进来的，不是事后总结
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── FINDING 1（★ 形状层的缺口：闸门格报不出来）──────────────────────────────────
 *
 * **症状**：把一条判据声明的**闸门格**（`appliesTo` 自己读的那些格，例如
 * `wantsCompleted` / `task.kind` / `taskNotTerminal`）从真实 ctx 上拿掉，
 * 核对层报的是 `skipped`，**不是** `incomplete`。
 *
 * **最小复现**（本夹具臂 B 逐格跑出来的读数）：
 *
 *     completion.verify-rerun
 *       execVerifyCommand   incomplete   appliesTo=true   missing=["execVerifyCommand"]   ← 报得出 ✓
 *       task                skipped      appliesTo=false                                  ← 报不出 ✗
 *       task.verify         skipped      appliesTo=false                                  ← 报不出 ✗
 *       wantsCompleted      skipped      appliesTo=false                                  ← 报不出 ✗
 *       taskNotTerminal     skipped      appliesTo=false                                  ← 报不出 ✗
 *
 * **机制**：`appliesTo` 读的正是这些格。它们缺席 ⇒ `appliesTo` 返回假 ⇒ 注册表把
 * 这条判据判成"这一轮不适用" ⇒ 按 t6 的核心闸门（**不适用不报**）核对被跳过。
 * 于是"这一格没接上"与"这一轮本来就不该审"**同形**。
 *
 * **为什么这值得报**：这正是本轮要消灭的那个形态，只是换了个入口。
 *
 *     verify-rerun 缺 execVerifyCommand ⇒ 判据照常跑、说 unmeasured ⇒ 与 ok 同形
 *     谁谁谁       缺 wantsCompleted   ⇒ 判据**压根不跑**、静默 skipped ⇒ 与"不适用"同形
 *
 * 而第二行的缺口，**新机制抓不到**。上一轮真实缺过的那十格（见 arm B2 的
 * `executorGaps`）都是**测量格**，所以它们现在能抓；但"闸门格"这一类，
 * `requires` 声明了也报不出来。
 *
 * **这不是"声明写错了"**：闸门格确实属于输入面（判据没有它就决定不了要不要说话），
 * 所以把它们从 `requires` 里删掉只会把问题藏起来。这里是**形状不够用**。
 *
 * **可能的修法（留给 captain / t6 定，本任务不自行改形状）**：
 *
 *   ① 闸门格不进 `requires`，另立一个字段（`appliesRequires`）—— 口径分离，
 *      但会让"这条判据的输入面"分裂成两份清单（而"输入面"恰恰是要**一份**完整清单）。
 *   ② 核对层对**闸门格**单独判：既然 `appliesTo` 为假是判据自己说的，那么
 *      "它要的那几格在不在"仍可核对，只是结论要写成第三种措辞 ——
 *      不是 `incomplete`（判据确实没缺测量输入），也不是 `skipped`（它确实缺了一格），
 *      而是一句"闸门格的输入不在场，所以这条判据这一轮没有说话"。
 *      这仍然守着"不适用不报"，但把**闸门格缺席**（一个接线缺陷）与
 *      **任务类型不匹配**（一个正常情形）区分开 —— 两者的日志读数完全不同。
 *   ③ 什么都不做，接受"闸门格抓不到"，把它记在文档里。
 *      —— 本轮若选这条，那至少要**知道**自己没抓什么（本注释就是那个"知道"）。
 *
 * ★ 本夹具的处置是**照现状断言**（`skipped`），并在断言消息里写明"若这条变红，
 *   说明闸门格的行为变了，那是好消息"。**没有**为了让夹具变绿而删掉闸门格的声明。
 */

/**
 * ── FINDING 2（★ 声明过宽 = 噪音：核上报了判据自己不认的缺口）────────────────────
 *
 * **症状**：`completion.backtest` 的 `requires` 第一版把 `coverage.command` 与
 * `execSelectedCommand` 也声明了进去，于是**一份完全正常的 ctx** —— 判据会在它
 * 上面诚实地返回 `ok`（"不跑选测"是判据明确允许的路径）—— 被核对报成
 * `incomplete: ["coverage.command", "execSelectedCommand"]`。
 *
 * **怎么发现的**：臂 A（对照臂）当场红。这正是对照臂存在的理由：
 * 没有它，这份噪声会被当成"核对更严"而留下，然后教人忽略核对。
 *
 * **口径**：一棵格该不该进 `requires`，由**判据自己**回答 ——
 * "它缺席时，这条判据还说得出话吗？"
 *
 *     · `execBacktestCommand` 缺席 ⇒ 判据说"no full-suite executor was injected" ⇒ 说不出话 ⇒ 进 ✓
 *     · `execSelectedCommand` 缺席 ⇒ 判据照常跑完（"没给 ⇒ 不假装跑过"）   ⇒ 还说话   ⇒ 不进 ✓
 *
 * 同一个问题的第二问（第一问见 `mutation.ts` 的注释）：`operators` / `minKillRate`
 * / `mirrors` 那些**有缺省值**的调参位同样不进 —— 缺席时判据用默认值照常测量。
 *
 * ★ 一句话总结两条的分界线：**声明的是"缺席 ⇒ 判据沉默"的那些格**，
 *   不是"看起来重要的那些格"，也不是"ctx 里存在的那些格"。
 *   过宽会制造噪音（FINDING 2），过窄会让缺口静默（FINDING 1 的另一半）。
 */
