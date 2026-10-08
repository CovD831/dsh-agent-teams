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
 */

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
