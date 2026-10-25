/**
 * ── 计划审查：四个必答项的真值 + 一个能对【真实计划】求值的检查（t12）──────────────
 *
 * ── 这个文件为什么存在（它修的是什么）────────────────────────────────────────────
 *
 * MEASURED（本次实测）：`PLAN-REVIEW.md` §6 定义了**计划审查的四个必答项**，
 * 而 `scripts/plan-review-tier.test.mjs` 的**臂 6** 也测了它 —— 但：
 *
 *     scripts/plan-review-tier.test.mjs:413
 *         const REQUIRED = [ ... ]        ← ★ 声明在【测试函数内部】
 *
 * 而 `grep -rn "why-now|invariant-reading" scripts/` ⇒ **只命中那一个文件**。
 *
 * ⇒ **那四个必答项是一份【夹具内部的常量】，而不是一份【可对真实计划求值的真值】。**
 *   ⇒ 于是「captain 交计划前必须先跑计划审查」这件事，**没有任何东西能检查它**。
 *
 * ★ 这与 `reviewStateOf` 没有调用方、`admission` 未接线是**同一个形状**：
 *   **机制在，而流程没走。**
 *
 * ── 本文件的两半 ────────────────────────────────────────────────────────────
 *
 *   ① `REQUIRED_PLAN_QUESTIONS` —— 四个必答项，**可被外部 import 的真值**
 *      （含每项**挂着的实测后果**：那是它值得被问的理由，而不是一句"应该问"）
 *   ② `checkPlanReview(plan)` —— 对**一份真实计划**（一组任务契约）求值，
 *      逐条报出四个必答项各自是「有 / 缺（缺什么）/ unmeasured（读不到什么）」
 *
 * ── ★★★ 三态，而且 `unmeasured` 与「有」必须不同形 ──────────────────────────────
 *
 *   有（present）    ⇒ 这一项能**指向契约里的具体一格**，且那一格非空
 *   缺（missing）    ⇒ 契约在场、能读，而**它没写**这一项 ⇒ 报出**缺什么**
 *   unmeasured       ⇒ **契约本身读不到 / 形状坏了** ⇒ 报「读不到什么」
 *
 * ★ 为什么第三态必须单独存在：一个"读不到契约"的计划与一个"契约都写了"的计划，
 *   在"没有 missing"这一读数上**同形** —— 而那正是本队最贵那条
 *   （**「没能测量」不得并进「通过」**）。⇒ 本检查**绝不**把 unmeasured 并进 pass。
 *
 * ── ★★ 第③项（`invariant-reading`）的口径含「读数」───────────────────────────────
 *
 * 它的问句必须要求一个**读数**（一个数字、一次计数、一个可比对的量），
 * 而不是"我检查过了"。原因（文档 §6 逐字）：
 *
 *     ★ **一个不可读的保证与没有保证同形。**
 *
 * ⇒ 而它在求值时的机械形式：契约里必须有一格**含读数字样**的证据
 *   （见 `READING_MARKERS`），否则判「缺」，且**说清缺的是"读数"**。
 *
 * ── ★★★ G3：这个文件曾经**没有 CLI**（本次修的就是它）─────────────────────────────
 *
 * MEASURED（修之前，逐字）：
 *
 *     $ grep -c process.argv scripts/plan-review-check.mjs
 *     0
 *     $ node scripts/plan-review-check.mjs --file x
 *     （无输出）  exit 0
 *
 * ★ 而 `formatPlanReview` 的注释逐字写着「人可读的一行摘要（**给 CLI 与报告用**）」——
 *   **那个 CLI 不存在**。⇒ 与 `reviewStateOf` 零调用方、`admission` 零求值点
 *   **是同一个形状**：机制在，而流程没走。本文件头自己写下的那句诊断，
 *   命中了它自己。
 *
 * ★★ 为什么这一条**比"少一个便利命令"严重**：
 *   一个**读不到**的计划与一个**全答了**的计划，在 `exit 0` 下**同形**。
 *   而那正是本队记账最贵那条（「没能测量」不得并进「通过」）在**进程边界上**的复现 ——
 *   本文件在里面判得再细，只要外面那层永远 exit 0，那份细致的结论**没有任何出口**。
 *
 * ⇒ 所以下面这一节的重点**不是**"加个 argv 解析"，而是**把三态投影到退出码上**
 *   （`PLAN_REVIEW_EXIT`）：present=0 / missing=1 / unmeasured=2。
 *   ★ 定向突变（把 unmeasured 也映射成 0）⇒ CLI 臂红。
 *
 * ── 本节的两条纪律 ──────────────────────────────────────────────────────────
 *
 *   ① **求值逻辑一行不动** —— `checkPlanReview` / `questionVerdict` / `looksLikeReading`
 *      / `formatPlanReview` 保持原样（它们被 `plan-review-tier.test.mjs` 与
 *      `review-unified-pipeline.test.mjs` 钉着）。本节是**外面那层壳**，只做
 *      「文件 → 计划」的适配 + 「结论 → 文字/退出码」的投影。
 *   ② **不写盘**（`gate-shared-artifact-writes` 扫全仓 `scripts/*.mjs`）——
 *      本文件的 I/O 只有一次 `readFileSync`。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 四个必答项里的第 ③ 项 —— 它是唯一一项额外要求"读数"的（见文件头）。 */
export const READING_QUESTION_KEY = 'invariant-reading'

/**
 * ── 四个必答项（**可 import 的真值**，与 `PLAN-REVIEW.md` §6 的表逐行对应）──────
 *
 * ★ 每一项都挂着一个**实测后果**（`missingCost`）—— 那不是装饰：
 *   它是"这一项为什么值得被问"的**证据**，而少了它，这一条就退化成一句口号。
 *   实测后果取自本队的真实事故（t58 / t54 / t70 / 半成品不可见）。
 */
export const REQUIRED_PLAN_QUESTIONS = Object.freeze([
  Object.freeze({
    key: 'why-now',
    question: '为什么现在做？前置条件在不在？',
    missingCost: "t58: the second half discovered its premise (the first half's commit) was missing, only after it started",
    /**
     * ★ 这一项的证据来源：契约的 `objective` 里必须说出**前置条件**。
     *   （"为什么现在"是一个关于**依赖**的主张 —— 而依赖在契约里由 `dependencies` 承载。）
     */
    evidence: 'objective',
  }),
  Object.freeze({
    key: 'steps',
    question: '拆成几步？每步的边界是什么？',
    missingCost: 't54: three amend rounds, because the boundary (inScope) kept turning out to be wrong',
    /** ★ "边界"在契约里就是 `inScope` —— 而它必须是**可枚举的几步**。 */
    evidence: 'inScope',
  }),
  Object.freeze({
    key: READING_QUESTION_KEY,
    question: '★ 每步做完后，【什么读数】能证明它没丢东西？',
    /** ★ 这就是 t70 缺的那一格。 */
    missingCost: 't70: 4 wiring groups (t69/t76/t83) were erased during the move, and nothing was counting',
    /** ★ 读数在契约里由 `acceptance` / `verify` 承载（一个可跑的、可比对的量）。 */
    evidence: 'acceptance',
    /**
     * ★★ 这一项**额外**要求"读数"：见文件头。它是本项与另外三项的唯一区别，
     *   而把它写成**数据**（而不是散落的 if）让检查层能机械地逐项处理。
     */
    requiresReading: true,
  }),
  Object.freeze({
    key: 'stop-points',
    question: '哪一步之后必须停下来给人看？',
    missingCost: 'the half-finished state in a worktree is invisible to everyone else',
    /** ★ "停下来给人看"在契约里由 `verify` 承载（人要看的正是那个可复现的读数）。 */
    evidence: 'verify',
  }),
])

/**
 * ── 什么算"一个读数"（第③项的机械判据）──────────────────────────────────────────
 *
 * ★ 它必须**可数或可比对**：一个数字、一次计数、一个集合比对、一次实测。
 *   而"我检查过了 / 已确认 / 符合预期"这类**不可读的**保证不算 —— 见文件头。
 *
 * ★ 取舍：宁可宽（多认几种可读的写法），也不要窄到把真的读数误判成没有读数 ——
 *   因为**误报与漏报一样有害**，而误报会教人忽略这条检查。
 */
const READING_MARKERS = Object.freeze([
  /读数/, /计数/, /输出/, /结果/, /实测/, /退出码/, /exit\s*code/i,
  /集合/, /逐条/, /对比/, /比对/, /diff/i, /hash/i, /stamp/i,
  /\d/,            // ★ 含数字（`N 项` / `> 0` / `= 4`）—— 一个数就是一个读数
  /assert/i, /test/i, /夹具/, /臂\d/, /console/i,
])

/** 一个字符串里是否含"读数"的字样（第③项的判据）。 */
export function looksLikeReading(text) {
  if (typeof text !== 'string' || text.trim() === '') return false
  return READING_MARKERS.some((pattern) => pattern.test(text))
}

/**
 * 契约上承载某一项的格子 —— 逐项取，取不到就**如实说取不到什么**。
 *
 * ★ 缺席（`undefined`）与空数组（`[]`）**不同形**：
 *   `undefined` ⇒ 契约没写这一格 ⇒ 那是"读不到"
 *   `[]`        ⇒ 写了、而它是空的 ⇒ 那是"缺"（写了个空的）
 */
function fieldOf(task, name) {
  if (task === null || typeof task !== 'object') return undefined
  return task[name]
}

/**
 * 一条契约的某一项：**三态**。
 *
 * @returns {{status:'present'|'missing'|'unmeasured', detail:string, because?:string}}
 */
function questionVerdict(task, item) {
  const raw = fieldOf(task, item.evidence)
  /**
   * ★★ 第三态：这一格**根本读不到**（`undefined`）⇒ `unmeasured`，而**不是** `missing`。
   *   ⇒ 前者是"契约没这一格"（没法判），后者是"这一格是空的"（判得了、判它缺）。
   *   ★ 两者对读者的补救动作不同：前者要去看契约形状，后者要去补内容。
   */
  if (raw === undefined) {
    return {
      status: 'unmeasured',
      detail: `read nothing at \`${item.evidence}\`: this contract carries no such field, so "${item.key}" could not be judged at all`,
    }
  }
  /** 形状坏了（不是字符串也不是数组）⇒ 同样读不了。 */
  if (typeof raw !== 'string' && !Array.isArray(raw)) {
    return {
      status: 'unmeasured',
      detail: `\`${item.evidence}\` is a ${typeof raw}, which this check cannot read (expected a string or an array)`,
    }
  }
  const entries = (Array.isArray(raw) ? raw : [raw])
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  /** ★ 写了格子、而它是空的 ⇒ **缺**（判得了，且判它缺）。 */
  if (entries.length === 0) {
    return { status: 'missing', detail: `\`${item.evidence}\` is empty — "${item.key}" was asked and left unanswered` }
  }
  /**
   * ★★ 第③项**额外**要求"读数"：写了几句话但**没有一个可读的量** ⇒ 仍然判「缺」，
   *   而且**说清缺的是"读数"**（不是泛泛的"没写"）。
   *   ★ 定向突变（把没读数读成有读数）⇒ 此分支不再命中 ⇒ 臂红。
   */
  if (item.requiresReading === true) {
    const withReading = entries.filter((entry) => looksLikeReading(entry))
    if (withReading.length === 0) {
      return {
        status: 'missing',
        detail: `\`${item.evidence}\` describes the work but names NO READING — `
          + `"${item.key}" requires something countable or comparable (a number, a count, a set comparison, an exit code). `
          + '★ "I checked it" and "it looked right" are not readings: an unreadable guarantee is the same shape as no guarantee.',
      }
    }
  }
  return { status: 'present', because: entries[0], detail: `\`${item.evidence}\` answers it` }
}

/**
 * ── 对**一份真实计划**求值 ────────────────────────────────────────────────────
 *
 * @param plan 一组任务契约（`TeamTask[]` 或任何带 `id` 的对象数组）
 * @returns 逐条契约 × 四个必答项的结果，外加一个**总判定**
 *
 * ★ 总判定**不是**"全绿才过"那一种两态：它保持三态（见 `overall`）。
 */
export function checkPlanReview(plan) {
  /**
   * ★ 计划本身读不到 ⇒ `unmeasured`（而不是"没有契约 ⇒ 过"）。
   *   一个空计划与一个读不到的计划**必须不同形**。
   */
  if (!Array.isArray(plan)) {
    return {
      overall: 'unmeasured',
      detail: `the plan could not be read as a list of contracts (got ${plan === null ? 'null' : typeof plan}) — nothing was judged`,
      contracts: [],
    }
  }
  if (plan.length === 0) {
    return { overall: 'unmeasured', detail: 'the plan holds no contracts — an empty plan and an unreadable plan are not the same thing', contracts: [] }
  }

  const contracts = plan.map((task) => {
    const id = task !== null && typeof task === 'object' && typeof task.id === 'string' && task.id.trim() !== ''
      ? task.id
      : '(a contract with no id)'
    const answers = {}
    for (const item of REQUIRED_PLAN_QUESTIONS) answers[item.key] = questionVerdict(task, item)
    return { id, answers }
  })

  /** ★ 三态汇总（**不是**两态）：任何一项 unmeasured ⇒ 整体 unmeasured；否则任一项 missing ⇒ 缺；否则有。 */
  const flat = contracts.flatMap((contract) => Object.values(contract.answers))
  const unmeasuredCount = flat.filter((answer) => answer.status === 'unmeasured').length
  const missingCount = flat.filter((answer) => answer.status === 'missing').length

  const overall = unmeasuredCount > 0
    ? 'unmeasured'
    : missingCount > 0
      ? 'missing'
      : 'present'

  return {
    overall,
    detail: unmeasuredCount > 0
      ? `${unmeasuredCount} answer(s) could not be read at all — this is NOT a pass: an unmeasurable answer and an answered one are different shapes`
      : missingCount > 0
        ? `${missingCount} answer(s) are missing — the plan was read, and it does not answer them`
        : `all ${flat.length} answers are present`,
    contracts,
  }
}

/** 人可读的一行摘要（给 CLI 与报告用）。 */
export function formatPlanReview(result) {
  const lines = [`plan review: ${result.overall} — ${result.detail}`]
  for (const contract of result.contracts) {
    lines.push(`  ${contract.id}`)
    for (const item of REQUIRED_PLAN_QUESTIONS) {
      const answer = contract.answers[item.key]
      const mark = answer.status === 'present' ? '✔' : answer.status === 'missing' ? '✘' : '？'
      lines.push(`    ${mark} ${item.key}: ${answer.detail}`)
    }
  }
  return lines.join('\n')
}

/* ────────────────────────────────────────────────────────────────────────────
 * CLI（G3）—— 把三态投影到**退出码**上
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ── 三态 → 退出码 ─────────────────────────────────────────────────────────────
 *
 * ★★ 这张表是本文件最重要的一行**数据**：它把"结论"变成"进程边界上可判的东西"。
 *   `unmeasured` **不许**是 0 —— 否则"读不到"与"读到了且齐备"在 CI 里同形，
 *   而那就是本队最贵那条在 shell 层的复现。
 *
 * ★ `usage` 单独一码（64 = `sysexits.h` 的 `EX_USAGE`），**刻意避开 2**：
 *   一次敲错的命令与一次"读不到计划"是两件事，退出码不许把它们合并 ——
 *   与 `unmeasured` 不许并进 `present` 是同一个理由。
 */
export const PLAN_REVIEW_EXIT = Object.freeze({
  present: 0,
  missing: 1,
  unmeasured: 2,
  usage: 64,
})

/** 命令行用法（`--help` 走 stdout / 敲错了走 stderr，同一份文字）。 */
export const PLAN_REVIEW_USAGE = `用法：
  node scripts/plan-review-check.mjs --file <plan.json> [--json]
  node scripts/plan-review-check.mjs --self-check
  node scripts/plan-review-check.mjs --help

  --file <plan.json>   对一份计划求值，逐条打印四个必答项的 present / missing / unmeasured
  --json               把结论打成 JSON（字段与 checkPlanReview 的返回值一致）
  --self-check         跑内置的四条对照（★ 反向半边：恒真话必须判 missing）

计划文件的形状：一个契约数组，或 { "plan": [ …契约… ] }（本仓 docs/self-iteration-plan.json 的写法）。
★ 其它形状（含 { "tasks": […] }）**不**做猜测性解包 —— 交给 checkPlanReview 如实报 unmeasured。

退出码（★ 三态投影，不许合并）：
  0  present      四问齐备
  1  missing      读得到、而至少一问没答
  2  unmeasured   ★ 读不到 —— 这不是通过
  64 用法错误（敲错了命令，与上面三态无关）`

/**
 * ── 计划文件的形状适配（**只认两种**，不猜）───────────────────────────────────
 *
 * ★ 为什么只认两种、而不顺手把 `{tasks}` / `{items}` 也解开：
 *   一次"贴心"的解包会把「**计划读不到**」悄悄变成「**计划是空的**」——
 *   而那正好抹掉本文件要保住的区别（`checkPlanReview` 对二者都报 unmeasured，
 *   但 detail 不同，读的人要能看出是哪一种）。
 */
export function extractPlan(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.plan)) return parsed.plan
  return parsed
}

const MARKS = Object.freeze({ present: '✔', missing: '✘', unmeasured: '？' })

/**
 * 人读的三态渲染 —— 比 `formatPlanReview` 多两件事：
 *   ① **逐条列出缺哪一问 / 哪一问读不到**（分组，而不是散在每行里让人自己扫）
 *   ② 一行**图例**把三个词逐个吐出来（"三态可见"的可执行形式）
 *
 * ★ 刻意**不**改 `formatPlanReview`：它被两个夹具逐字钉着
 *   （`plan-review-tier.test.mjs` 的 `[✔✘？]` 计数与 `plan review: present` 前缀）。
 */
export function renderPlanReview(result) {
  const lines = []
  const counts = { present: 0, missing: 0, unmeasured: 0 }
  for (const contract of result.contracts) {
    for (const answer of Object.values(contract.answers)) counts[answer.status] += 1
  }

  lines.push(`plan review: ${result.overall} — ${result.detail}`)
  /**
   * ★★ 契约一条都没求值时，`present 0 · missing 0 · unmeasured 0` 那三个 0 是**会骗人**的：
   *   读起来像"没有任何一项读不到"，而实际是"**一项都没能被求值**"。
   *   ⇒ 那不是同一件事，而它正是本仓记账最久的形态（数字在、而它数的不是那件事）。
   *   所以这一行的措辞按 `contracts.length === 0` **换形**，并明说 0 不是"没有问题"。
   */
  if (result.contracts.length === 0) {
    lines.push('三态：★ 未对任何契约求值（0 条）—— 下面的 0/0/0 是【没有东西可判】，不是"三项都没问题"')
  } else {
    lines.push(`三态：present ${counts.present} · missing ${counts.missing} · unmeasured ${counts.unmeasured}`)
  }
  lines.push(`退出码：${PLAN_REVIEW_EXIT[result.overall]}（0=present / 1=missing / 2=unmeasured）`)
  lines.push('')

  for (const contract of result.contracts) {
    lines.push(`  ${contract.id}`)
    for (const item of REQUIRED_PLAN_QUESTIONS) {
      const answer = contract.answers[item.key]
      lines.push(`    ${MARKS[answer.status]} ${item.key.padEnd(18)} ${answer.status.padEnd(11)} ${item.question}`)
      if (answer.status === 'present' && typeof answer.because === 'string') {
        lines.push(`      └ 读到：${answer.because.slice(0, 120)}`)
      } else {
        lines.push(`      └ ${answer.detail}`)
      }
    }
  }

  const missing = []
  const unmeasured = []
  for (const contract of result.contracts) {
    for (const item of REQUIRED_PLAN_QUESTIONS) {
      const answer = contract.answers[item.key]
      if (answer.status === 'missing') missing.push(`  ${contract.id} / ${item.key} — ${item.question}`)
      if (answer.status === 'unmeasured') unmeasured.push(`  ${contract.id} / ${item.key} — ${answer.detail}`)
    }
  }
  lines.push('')
  lines.push(`missing（缺哪一问，${missing.length} 条）：${missing.length === 0 ? ' （无）' : ''}`)
  lines.push(...missing)
  lines.push(`unmeasured（哪一问读不到，${unmeasured.length} 条）★ 这不是通过：${unmeasured.length === 0 ? ' （无）' : ''}`)
  lines.push(...unmeasured)

  return lines.join('\n')
}

/** `--json` 的投影（字段与 `checkPlanReview` 一致，外加退出码，免得消费方自己再映射一遍）。 */
export function renderPlanReviewJson(result) {
  return JSON.stringify({ ...result, exitCode: PLAN_REVIEW_EXIT[result.overall] }, null, 2)
}

/* ────────────────────────────────────────────────────────────────────────────
 * ★ 反向半边：内建的四条对照 —— 让"检查有效"与"检查在乱拒"可区分
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ★★★ 第 1 条是**契约点名的反向半边**：一份 acceptance 全是**恒真话**的假计划，
 *   **必须**判 `missing` 而不是 `present`。
 *
 *   ★ 若它判 `present`，那么本文件的四问检查就等于没装 —— 因为它会放过
 *     恰好是它要拦的那一份计划。而那时"全绿"读起来与"真的写全了"同形。
 *
 * ★ 其余三条是**对照臂**：缺了它们，一个"恒判 missing"的实现会让第 1 条全绿。
 */
export const SELF_CHECK_CASES = Object.freeze([
  Object.freeze({
    name: 'vacuous-acceptance（★ 反向半边：恒真话不是读数）',
    plan: [{
      id: 'fake',
      objective: 'because the previous step landed',
      inScope: ['scripts/a.mjs'],
      acceptance: ['已检查过', '我确认没问题', '看起来是对的', '符合预期'],
      verify: ['node scripts/a.mjs'],
    }],
    expect: 'missing',
    expectAnswer: { key: READING_QUESTION_KEY, status: 'missing' },
  }),
  Object.freeze({
    name: 'complete（对照臂：四问齐备必须过）',
    plan: [{
      id: 'good',
      objective: 'because the previous step landed',
      inScope: ['scripts/a.mjs'],
      acceptance: ['cooldown:unmeasured 从 29 → 0'],
      verify: ['node scripts/a.mjs'],
    }],
    expect: 'present',
    expectAnswer: { key: READING_QUESTION_KEY, status: 'present' },
  }),
  Object.freeze({
    name: 'empty-plan（空计划不是"没有问题时"）',
    plan: [],
    expect: 'unmeasured',
    expectAnswer: null,
  }),
  Object.freeze({
    name: 'unreadable-plan（形状坏了 ⇒ 读不到，而不是判它缺）',
    plan: { tasks: [{ id: 'x' }] },
    expect: 'unmeasured',
    expectAnswer: null,
  }),
  Object.freeze({
    name: 'absent-field（契约没有 acceptance 这一格 ⇒ 读不到）',
    plan: [{ id: 'no-acceptance', objective: 'o', inScope: ['a'], verify: ['node a.mjs'] }],
    expect: 'unmeasured',
    expectAnswer: { key: READING_QUESTION_KEY, status: 'unmeasured' },
  }),
])

/**
 * 跑内建对照。**返回结果而不打印** —— 打印与退出码留给 `main`，这样它可被夹。
 * @returns {{ok:boolean, rows:Array<{name:string,expect:string,actual:string,answerOk:boolean,ok:boolean}>}}
 */
export function runSelfCheck() {
  const rows = SELF_CHECK_CASES.map((entry) => {
    const result = checkPlanReview(entry.plan)
    let answerOk = true
    if (entry.expectAnswer !== null) {
      const contract = result.contracts[0]
      const answer = contract === undefined ? undefined : contract.answers[entry.expectAnswer.key]
      answerOk = answer !== undefined && answer.status === entry.expectAnswer.status
    }
    const overallOk = result.overall === entry.expect
    return {
      name: entry.name,
      expect: entry.expect,
      actual: result.overall,
      answerOk,
      ok: overallOk && answerOk,
    }
  })
  return { ok: rows.every((row) => row.ok), rows }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 入口
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 求值一个文件 ⇒ 一个 `checkPlanReview` 结果。
 *
 * ★ 读不到**不抛** ⇒ 转成 `unmeasured` 的结论。这是本文件对
 *   "crash 与 no-data 必须不同形" 那条的执行方式：
 *   一次 ENOENT 不该变成一段栈，而该变成一行**说清了读不到什么**的读数。
 */
export function evaluatePlanFile(file, readFile = readFileSync) {
  let raw
  try {
    raw = readFile(resolve(file), 'utf8')
  } catch (error) {
    return {
      overall: 'unmeasured',
      detail: `plan file could not be read: \`${file}\` — ${error?.code ?? String(error)} (nothing was judged)`,
      contracts: [],
    }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      overall: 'unmeasured',
      detail: `plan file is not valid JSON: \`${file}\` — ${String(error?.message ?? error)} (nothing was judged)`,
      contracts: [],
    }
  }
  return checkPlanReview(extractPlan(parsed))
}

/** 解析 argv。返回 `{mode, file, json}` 或 `{mode:'usage', error}`。 */
export function parseArgs(argv) {
  let file
  let json = false
  let selfCheck = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return { mode: 'help' }
    if (arg === '--json') { json = true; continue }
    if (arg === '--self-check') { selfCheck = true; continue }
    if (arg === '--file') {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) return { mode: 'usage', error: '`--file` 后面缺少路径' }
      file = next
      index += 1
      continue
    }
    if (arg.startsWith('--file=')) {
      const value = arg.slice('--file='.length)
      if (value === '') return { mode: 'usage', error: '`--file=` 后面缺少路径' }
      file = value
      continue
    }
    return { mode: 'usage', error: `不认识的参数：\`${arg}\`` }
  }
  if (selfCheck) return { mode: 'self-check', json }
  if (file === undefined) {
    return { mode: 'usage', error: '没有给计划文件 —— 本命令**不会**在没有输入时静默 exit 0（那与"计划齐备"同形）' }
  }
  return { mode: 'file', file, json }
}

/**
 * @returns {number} 进程退出码
 */
export function main(argv, io = {}) {
  const out = io.out ?? ((text) => process.stdout.write(`${text}\n`))
  const err = io.err ?? ((text) => process.stderr.write(`${text}\n`))
  const args = parseArgs(argv)

  if (args.mode === 'help') { out(PLAN_REVIEW_USAGE); return 0 }
  if (args.mode === 'usage') {
    err(PLAN_REVIEW_USAGE)
    err('')
    err(`✘ ${args.error}`)
    return PLAN_REVIEW_EXIT.usage
  }

  if (args.mode === 'self-check') {
    const { ok, rows } = runSelfCheck()
    for (const row of rows) {
      const mark = row.ok ? '✔' : '✘'
      const answerNote = row.answerOk ? '' : ' ★ 而第③项（读数）的判定与期望不符'
      out(`  ${mark} ${row.name} — 期望 ${row.expect} / 实测 ${row.actual}${answerNote}`)
    }
    out('')
    out(ok
      ? `self-check: present（${rows.length} 条对照全部符合）— ★ 反向半边：恒真话没有被判成 present`
      : `self-check: refuted（${rows.filter((row) => !row.ok).length} 条对照不符）—— ★ 本检查要么放过恒真话，要么在乱拒`)
    // ★ 对照失败是**检查本身坏了**，不是某个计划的结论 —— 因此它借 missing 的 1，而不是 0。
    return ok ? PLAN_REVIEW_EXIT.present : PLAN_REVIEW_EXIT.missing
  }

  const result = evaluatePlanFile(args.file)
  out(args.json ? renderPlanReviewJson(result) : renderPlanReview(result))
  return PLAN_REVIEW_EXIT[result.overall] ?? PLAN_REVIEW_EXIT.unmeasured
}

/** 判定本文件是不是被直接执行的（`import` 时不跑 CLI）。 */
function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  /** ★ `pathToFileURL` 而不是手拼 `file://` —— 后者在含空格/中文的路径上会静默不匹配。 */
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (invokedDirectly()) {
  process.exitCode = main(process.argv.slice(2))
}
