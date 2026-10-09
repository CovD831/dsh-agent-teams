#!/usr/bin/env node
/**
 * ── t2：`reviewed` 那一格的**形状**，以及它能不能真的落进 team.json ──────────────
 *
 * ── 它存在的理由（用户原话，逐字）────────────────────────────────────────────────
 *
 *   「因为有的任务是自动生成的，有的任务是需要问过我之后再生成、再派发的。
 *     对于问过我、我裁决过的任务，在生成计划时就没有走自动生成的那一步，
 *     也就没有『已审查』的字段，**那它就需要被审查一遍**。」
 *
 * ⇒ ★ 所以「带 `reviewed` ⇒ 放行；不带 ⇒ 派之前必须先审一遍」是一条**路由规则**，
 *   而本任务要做的是让契约**首次能够承载**那一格。
 *
 * ── ★★★ 而它为什么在【形状】这一层就要有判据（而不是等到判据本体）──────────────
 *
 * ★ 因为"契约承载不了那一格"与"那一格是空的"，在**路由程序眼里同形**：
 *
 *     契约根本没有 `reviewed` 这个字段  ⇒ 读它得到 undefined ⇒ 落"需要审"
 *     契约有字段、而这条任务没审        ⇒ 读它得到 undefined ⇒ 也落"需要审"
 *
 * ★★ ⇒ 于是"那一格从来没被接上"这件事**没有任何读数会说** ——
 *   而它看起来与"一切正常：这些任务确实都还没审"完全一样。
 *   ⇒ 这正是本队记账过多次的形态：**一个从未接上的字段，与一个正常的缺席同形。**
 *
 * ── 本文件**不测判据**（那是 t8）────────────────────────────────────────────────
 *
 * ★ 它只测三件事：
 *   ① 形状：`reviewed?: {at, by, checks[]}`
 *   ② ★ **它缺席时一切照旧**（不许变成必填 —— 那会让每一条手工裁决的任务都落不了盘）
 *   ③ ★★ **它能真的写进 team.json 并逐字读回**（读回来比对，不是读返回值）
 *
 * Run: node --test scripts/gate-reviewed-shape.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** ★ 走**构建产物**（判据读到的是它）—— 而 `.js` 是 build 的产物，不是源码。 */
const BUILT_STATE = join(ROOT, 'lib', 'state.js')
const TYPES_SOURCE = join(ROOT, 'src', 'types.ts')

/** 一个最小的 TeamState（够 writeTeam / readTeam 走完，且只有一条任务）。 */
function teamWith(task) {
  const now = 1_700_000_000_000
  return {
    id: 'gate-reviewed-shape',
    members: [],
    tasks: [task],
    createdAt: now,
    updatedAt: now,
  }
}

const baseTask = (extra = {}) => ({
  id: 't-x',
  subject: '形状臂用的一条任务',
  status: 'pending',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...extra,
})

/** 落盘一份 TeamState，再把 **team.json 的原始文本**读回来（不是读返回值）。 */
async function roundTrip(state) {
  const { writeTeam } = await import(`${BUILT_STATE}?hook=reviewed-shape`)
  const dir = mkdtempSync(join(tmpdir(), 't2-reviewed-'))
  try {
    /**
     * ★ `writeTeam` 写的是 `<root>/<teamId>/team.json`，而它**不建目录**
     *   （MEASURED：不建就 ENOENT，而那条错的措辞是"找不到 .tmp 文件" ——
     *    它指的是那个原子写的临时名，不是 team.json 本身）。
     *   ⇒ 所以夹具自己把那层目录建出来（那是生产侧 `createTeam` 的活）。
     */
    mkdirSync(join(dir, state.id), { recursive: true })
    await writeTeam(dir, state)
    /** ★★ 读的是**盘上的文本** —— 那才是"逐字落进去"的证据。 */
    const raw = readFileSync(join(dir, state.id, 'team.json'), 'utf8')
    return { raw, parsed: JSON.parse(raw) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1：形状 —— 而它是**可选的**
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：`reviewed` **缺席**时一切照旧 —— 它绝不许变成必填', async () => {
  /**
   * ── 判据（契约逐字）──────────────────────────────────────────────────────────
   *
   *   「不做 `reviewed` 建任务**照常成功**（它不许变成必填）」
   *
   * ★★ 而这一条**不是形式**：把 `reviewed` 变成必填，会让**每一条手工裁决过的任务**
   *   都无法落盘 —— 而那一类任务正是这条规则要服务的那一类。
   *   ⇒ ★ 于是"加了一格字段"会把它要修的那件事**弄得更坏**。
   */
  const { raw, parsed } = await roundTrip(teamWith(baseTask()))
  const task = parsed.tasks[0]

  assert.equal(task.reviewed, undefined, '★ 没写就没有它（不许被填一个默认值）')
  /**
   * ★★ 而"缺席"必须在**原始文本**里也可核 —— 而不是只在新对象上看不见：
   *   一个把 `reviewed: null` 写进去的实现，在这里会红。
   */
  assert.equal(
    /"reviewed"/u.test(raw), false,
    '★★ 盘上的 team.json 里出现了 "reviewed" —— 而这条任务【没有】审过 ⇒ 那是一个编出来的在场',
  )
  /** ★ 而其余字段逐字照旧（加字段不许动别的）。 */
  assert.equal(task.id, 't-x')
  assert.equal(task.subject, '形状臂用的一条任务')
  assert.equal(task.status, 'pending')
})

test('★★★ 臂 1b：`reviewed` 在场时，`{at, by, checks[]}` 逐字落进 team.json', async () => {
  /**
   * ── 判据（契约逐字）──────────────────────────────────────────────────────────
   *
   *   「带则 `{at, by, checks[]}` **逐字落进 team.json**（读回来比对，不是读返回值）」
   *
   * ★★ 而"读回来"这一句是判据的实质：一个只把值返回、没写进盘上的实现，
   *   **在返回值那一侧完全正常**。⇒ 所以本臂只信盘上的文本。
   */
  const stamp = {
    at: 1_700_000_000_123,
    by: 'adversarial',
    checks: [
      { id: 'scope', verdict: 'pass', why: '写域是具体文件' },
      { id: 'boundary', verdict: 'unmeasured', why: '没有具体产物路径 ⇒ 问不出来' },
    ],
  }
  const { parsed } = await roundTrip(teamWith(baseTask({ reviewed: stamp })))
  const task = parsed.tasks[0]

  assert.deepEqual(
    task.reviewed, stamp,
    '★★ `{at, by, checks[]}` 必须**逐字**落进 team.json 并读回 —— 而不是被裁剪/补默认值',
  )
  /** ★ 而 `checks[]` 的**每一条**都要在（一个只留第一条的实现会在这里红）。 */
  assert.equal(task.reviewed.checks.length, 2)
  assert.deepEqual(task.reviewed.checks[1], { id: 'boundary', verdict: 'unmeasured', why: '没有具体产物路径 ⇒ 问不出来' })
})

test('★★★ 臂 1c（反向半边）：三态里 `unmeasured` 那一格**逐字保留** —— 不许被规整成 pass', async () => {
  /**
   * ★ 反向半边：上面那条臂证明"值落进去了"，而这一条钉的是**那一格的内容不被规整**。
   *
   * ★★ 理由：`unmeasured`（"我没能审明白"）与 `pass`（"审过了，没问题"）不同形，
   *   而一个"顺手把认不出的 verdict 归成 pass"的落盘实现，会让两者**同形**。
   *   ⇒ 而那正是本队那条最贵的纪律在**这一格上**的落点。
   */
  const stamp = {
    at: 1,
    by: 'adversarial',
    checks: [{ id: 'acceptance', verdict: 'unmeasured', why: 'acceptance 读起来像恒真，而我不确定' }],
  }
  const { raw, parsed } = await roundTrip(teamWith(baseTask({ reviewed: stamp })))
  assert.equal(parsed.tasks[0].reviewed.checks[0].verdict, 'unmeasured', '★ 不许被规整成 pass')
  /** ★ 而盘上的文本里也要逐字是它。 */
  assert.match(raw, /"verdict": "unmeasured"/u, '★ 盘上那一格必须逐字是 unmeasured')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2：★ 接线读数 —— 类型层真的声明了它（而不是只存在于注释里）
// ═════════════════════════════════════════════════════════════════════════════

test('★★★★ 臂 2：类型层真的声明了 `reviewed?: ReviewedStamp`，且 `checks` 是数组', async () => {
  /**
   * ── 判据（契约逐字）──────────────────────────────────────────────────────────
   *
   *   「类型层：`reviewed` 在场但形状坏（非对象 / checks 非数组）在**类型或校验**处被拒
   *     （定向突变：改成 `any` 静默接受 ⇒ 臂红）」
   *
   * ★★ 而"类型层被拒"这件事**不能靠运行时断言**来测（一个 `any` 在运行时也接受一切）。
   *   ⇒ 所以它必须**读源码的类型声明**，并把三件事钉住：
   *     ① `TeamTask` 上有 `reviewed?`（可选 —— 不是必填）
   *     ② 它的类型是 `ReviewedStamp`（不是 `any` / `unknown` / `Record<string, unknown>`）
   *     ③ `ReviewedStamp.checks` 是 `ReviewedCheck[]`（数组，不是 `any`）
   *
   * ★ 而那正是"定向突变：改成 `any` 静默接受 ⇒ 臂红"的可执行形式 ——
   *   因为把 `ReviewedStamp` 换成 `any` 之后，② 与 ③ 的**字面**就变了。
   */
  const source = readFileSync(TYPES_SOURCE, 'utf8')

  /** ① 字段在，且是**可选**（`reviewed?`）—— ★ 少了 `?` 就是"变成必填"。 */
  assert.match(
    source, /^\s*reviewed\?: ReviewedStamp\s*$/mu,
    '★★ `TeamTask` 上必须有 `reviewed?: ReviewedStamp` —— 而它【必须可选】（`?`），否则每一条手工裁决的任务都落不了盘',
  )
  /** ★ 反向：不许出现把它写成必填的形态（那会让上面那条匹配不上，而这一条指名为它）。 */
  assert.equal(
    /^\s*reviewed: ReviewedStamp\s*$/mu.test(source), false,
    '★ 出现了把 `reviewed` 写成【必填】的声明 —— 那正是"不新增必填"那条边界要防的',
  )

  /** ② 类型是具名的 `ReviewedStamp`，而**不是** `any` / `unknown`。 */
  assert.match(source, /export interface ReviewedStamp \{/u, '★★ 必须有具名的 `ReviewedStamp`（`any` 会让形状坏被静默接受）')
  assert.equal(
    /^\s*reviewed\?: (any|unknown|Record<string, unknown>)\s*$/mu.test(source), false,
    '★★ `reviewed` 被声明成 any/unknown ⇒ 形状坏会被【静默接受】',
  )

  /** ③ 三个必答项都在，且 `checks` 是**数组**。 */
  assert.match(source, /export interface ReviewedCheck \{/u, '★ `checks[]` 的元素类型必须是具名的')
  const stampBody = /export interface ReviewedStamp \{([\s\S]*?)\n\}/u.exec(source)
  assert.notEqual(stampBody, null, '★ 读不到 `ReviewedStamp` 的正文 —— 本臂无法成立（而"读不到就跳过"是恒真写法）')
  const body = stampBody[1]
  assert.match(body, /^\s*at: number\s*$/mu, '★ `at` 必须在（epoch ms）')
  assert.match(body, /^\s*by: string\s*$/mu, '★ `by` 必须在（谁审的）')
  assert.match(body, /^\s*checks: ReviewedCheck\[\]\s*$/mu, '★★ `checks` 必须是 `ReviewedCheck[]`（数组）—— 一个 `any` 会让"非数组"被静默接受')

  /** ★ 而 `checks` 的元素里那一格 `verdict` 必须存在（判据读的就是它）。 */
  const checkBody = /export interface ReviewedCheck \{([\s\S]*?)\n\}/u.exec(source)
  assert.notEqual(checkBody, null, '★ 读不到 `ReviewedCheck` 的正文')
  assert.match(checkBody[1], /^\s*verdict: string\s*$/mu, '★ `verdict` 必须在（它是三态那一格）')
})

test('★★★★ 臂 2b（反半边）：`reviewedTaskId` 与 `reviewed` 是**两件不同的事** —— 都不许被改掉', async () => {
  /**
   * ★ 边界逐字：「不改 `reviewedTaskId`（它与 `reviewed` 是两件不同的事）」
   *
   * ★★ 而这条反半边的用处：一个"把两者合并成一个"的实现，
   *   会让"**哪一条**任务被审过"与"**审的结果**"合成一格 ——
   *   而它们的**缺席含义相反**（前者缺席=没指明对象；后者缺席=还没审）。
   */
  const source = readFileSync(TYPES_SOURCE, 'utf8')
  assert.match(source, /^\s*reviewedTaskId\?: string\s*$/mu, '★ `reviewedTaskId?: string` 必须仍在（它指的是"哪一条")')
  assert.match(source, /^\s*reviewedAttempt\?: number\s*$/mu, '★ `reviewedAttempt?: number` 必须仍在')

  /** ★ 而落盘侧：两个字段可以**各自在场、各自缺席**（合并实现会让这条红）。 */
  const both = await roundTrip(teamWith(baseTask({ reviewedTaskId: 't-y', reviewed: { at: 2, by: 'captain', checks: [] } })))
  assert.equal(both.parsed.tasks[0].reviewedTaskId, 't-y', '★ 两者可以同时在场')
  assert.equal(both.parsed.tasks[0].reviewed.by, 'captain')

  const onlyId = await roundTrip(teamWith(baseTask({ reviewedTaskId: 't-y' })))
  assert.equal(onlyId.parsed.tasks[0].reviewedTaskId, 't-y', '★ 只有 id 时它照常落盘')
  assert.equal(onlyId.parsed.tasks[0].reviewed, undefined, '★ 而 `reviewed` 不许被顺手补上')
})
