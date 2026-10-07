#!/usr/bin/env node
/**
 * ── 「判断 → 行动」：把卡点与判决变成【待派任务清单】（t72）──────────────────────
 *
 * ── 它补的是链条上**唯一缺的那一环**（MEASURED，2026-10-08）──────────────────
 *
 *     卡点 ⇒ 自动记录        ✓ t22
 *     判决 ⇒ 有格式有读者    ✓ t57
 *     判决 ⇒ 可机械化判断    ✓ t65
 *     ★ 判断 ⇒ 行动          ✗ **没有人做**  ← 本任务
 *
 * ★ 而本队对这件事有一条归纳，正对着它：
 *     **「一个没有调用方的判断，与没有判断在观测上完全相同。」**
 *
 * 用户的原话（本文件存在的理由）：
 *     「经验记录下来后，应该自动判断是否要去派任务去做 ——
 *       不管是卡点还是经验，我们不是都已经构建过了吗。」
 *
 * ── ★★ 它产出【提案】，不建任务 ────────────────────────────────────────────────
 *
 * 建任务/派工是 **captain 的判断**（协议所限：成员不建任务、不派活）。
 * ⇒ 本工具只回答"**该派哪几条、以及为什么**"，并把那个消费做**便宜**：
 *   一份 JSON（机器可读）+ 一份人话清单（一眼能看出该派哪条）。
 *
 * ── ★★★ 三个不同的动作（三态不同形，因为补救动作不同）──────────────────────────
 *
 *     `to-dispatch` —— 值得派，且**现在就能派**（写域空闲）
 *     `blocked`     —— 值得派，而**被写域挡着**（★ 附：**被谁**挡）
 *     `no-action`   —— 不需要行动（已修 / 已归档 / 是纪律而非判据）
 *
 * ★ 三者**不许合流**：把 `no-action` 并进 `to-dispatch` 会让 captain
 *   去派一堆**不需要做的事**；把 `blocked` 并进 `to-dispatch` 会让它派出一批
 *   **必然冲突**的任务（而那正是用户裁定"写域冲突就先别派"要避免的）。
 *
 * ── ★ 它不 import 任何产品代码，也不 import t65 的工具 ─────────────────────────
 *
 * `judgement-triage.mjs`（t65）**没有落进本仓库**（那次交付报了 failed 且未提交）——
 * ⇒ 本文件把它那三条判断**自己实现一遍**，而不是 import 一个不存在的模块。
 *   ★ 而那个重复是**明写的**（见 {@link triageJudgement} 的注释），并且有一条臂
 *     断言"两边口径一致"—— 等 t65 落地之后，这里应当改成 import 它。
 *
 * ── ★ 输入从**参数**来，不写死路径 ──────────────────────────────────────────────
 *
 *     --frictions <dir>   默认 `.agent-teams/frictions`
 *     --judgements <dir>  默认 `.agent-teams/judgements`
 *     --json              只出机器可读的那一份
 *
 * ★ 读不到目录 ⇒ **如实落 `unmeasured`**（不是"没有卡点"）——
 *   与全库那条纪律一致：「我没能读」与「读了、是空的」不同形。
 *
 * @module friction-triage
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// ① 判决的可机械化判断（★ 与 t65 同口径 —— 而那是**明写的重复**，见文件头）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 三态 + 第四态。★ 与 t65 的 `VERDICTS` 逐字一致。
 */
export const JUDGEMENT_VERDICTS = Object.freeze(['gate', 'diagnosis', 'discipline', 'unmeasured'])

/**
 * ── claim 能不能被写成一条【对某个输入返回真/假】的断言 ────────────────────────
 *
 * ★★ 与 t65 的 `looksAssertive` **同一口径**（那一版被 9 条真实语料打回过两次）：
 *   判的是**可检查的联结结构**（条件⇒后果 / 二选一 / 依赖判定 / 可达性 / 对照分词），
 *   **不是**"有没有某个词"。
 *
 * ★ 为什么这里要重写一遍而不是 import：t65 那次交付**没有落进本仓库**
 *   （它报了 failed 且未提交）⇒ import 一个不存在的模块会让本工具**启动即炸**。
 *   ★ 而"重写一份"的代价是**两份真相会漂移** —— 所以本文件把两边口径**并排列在这里**，
 *     并由夹具的一条臂对拍（它同时断言 `JUDGEMENT_VERDICTS` 与 t65 的取值一致）。
 *     ⇒ 等 t65 落地，这里应当改成 import。
 */
export function looksAssertive(text) {
  if (typeof text !== 'string') return undefined
  const claim = text.trim()
  if (claim.length < 8) return undefined

  const CHECKABLE = [
    /(时|后|之后|之前)([^。；;]{0,40})?(才|就|也|全|都|会)/u,
    /(只在|只有在|只有)[^。；;]{2,40}(才|就)/u,
    /当[^。；;]{2,40}(时|后|了)[^。；;]{0,30}(就|便|则|是)/u,
    /(下一次|下次|之后才|后来才)/u,
    /取决于/u,
    /(是不是|是否是)/u,
    /与[^。；;]{2,30}(是|不是)(两件事|一回事|同一个)/u,
    /(不是|并非)[^。；;]{2,30}(而是|，)/u,
    /(要|必须|应当)[^。；;]{2,30}(，|,)?(不要|不得|不能)/u,
    /(可以从未|从来没有|从未被|永不|永远不)/u,
    /把[^。；;]{2,20}(与|和)[^。；;]{2,20}(分开|区别)/u,
    /(也会变|会变|会分岔|会失效|会过时|会腐烂|不再一样)/u,
  ]
  if (CHECKABLE.some((pattern) => pattern.test(claim))) return claim
  const REFERENT = /([\w.-]+\.[a-z]{1,4}\b|`[^`]+`|[A-Za-z_][A-Za-z0-9_]{3,}\(\)|:\d+)/u
  const PREDICATE = /(必须|不得|应当|不能|会|不会|等于|属于|只在|是否|一定|永远|从不|全都)/u
  if (REFERENT.test(claim) && PREDICATE.test(claim)) return claim
  return undefined
}

/**
 * ── 那条断言读的东西是不是【现成可取】的 ──────────────────────────────────────
 *
 * ★ 顺序**从窄到宽**，且 ① 必须**最先**（一条 claim 可以同时提到文件和"理解"，
 *   而那时正确答案是后者）。
 * ★ 与 t65 的 `inputKindOf` 同一口径（同一张 `SHAPE_BY_INPUT` 表的输入侧）。
 */
export function inputKindOf(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  const claim = text
  if (/(理解.{0,8}(任务|意图|目的|在做什么)|需要.{0,6}(判断|理解|读懂)|靠人|人眼|感受|经验判断|语义上|看情况|视情况|编译器.{0,10}不会告诉你|不会告诉你|只有.{0,6}跑(到|过).{0,6}才|靠经验)/u.test(claim)) {
    return { kind: 'semantic' }
  }
  if (/(夹具|针脚|突变|断言|测试怎么写|被测模块|import 缓存)/u.test(claim)) return { kind: 'runtime-ctx' }
  if (/(loader|注入|接线|调用方|consumer|消费|送过来|送进来|有没有.{0,8}接上|没有.{0,8}接上|没接上|requires|输入面|谁给它赋|skipped)/u.test(claim)) {
    return { kind: 'injected-by-another-mechanism' }
  }
  if (/\bgit\b|commit|HEAD|祖先|分支|merge-base|worktree|提交|搬运|底本/u.test(claim)) return { kind: 'git' }
  if (/注册表|清单|roster|registry|工具定义/u.test(claim)) return { kind: 'registry' }
  if (/(派生物|派生文件|生成器|重新生成|快照|golden|扫盘|存在性|目录结构|手改)/u.test(claim)) return { kind: 'filesystem' }
  if (/(文件|目录|路径)/u.test(claim)) return { kind: 'filesystem' }
  if (/(源码|文本|措辞|字符串|匹配|正则|写法|字段名|行号|距离|缩进|针脚|突变|夹具|断言|读数|拒绝|格式|数字|赋值|\?\?|兜底|一句.{0,10}话|说明|兑现|字面)/u.test(claim)) {
    return { kind: 'source-text' }
  }
  return undefined
}

/** 输入的种类 ⇒ 建议形状。★ 与 t65 的 `SHAPE_BY_INPUT` 同一张表。 */
export const SHAPE_BY_INPUT = Object.freeze({
  'source-text': { shape: 'gate', where: '源码扫描的判据（scripts/gate-*.test.mjs）' },
  filesystem: { shape: 'gate', where: '扫盘的判据（文件存在性 / 内容 / 目录结构）' },
  git: { shape: 'gate', where: '建任务时（contract）或收口时（completion）的检查' },
  registry: { shape: 'gate', where: '读判据注册表 / 工具清单这类结构化读数的判据' },
  'injected-by-another-mechanism': { shape: 'gate', where: '判据的输入面（requires）：断言"那一格有没有被送过来"' },
  'runtime-ctx': { shape: 'fixture-helper', where: '夹具辅助库（**不是判据**，不进注册表）' },
  semantic: { shape: 'diagnosis', where: '诊断（标记给人看，不拦）' },
})

/**
 * 对一份判决候选给出裁决（★ 与 t65 的 `triage` 同形）。
 *
 * @param candidate - `{ id, claim }`
 */
export function triageJudgement(candidate) {
  const id = typeof candidate?.id === 'string' ? candidate.id : '(no id)'
  const claim = candidate?.claim
  if (typeof claim !== 'string' || claim.trim() === '') {
    return { id, verdict: 'unmeasured', reason: 'no claim was given' }
  }
  if (looksAssertive(claim) === undefined) {
    return { id, verdict: 'discipline', reason: 'the claim does not reduce to an assertion returning true/false on some input' }
  }
  const input = inputKindOf(claim)
  if (input === undefined) {
    return { id, verdict: 'unmeasured', reason: 'what the assertion would read could not be identified from the text' }
  }
  const mapping = SHAPE_BY_INPUT[input.kind]
  return {
    id,
    verdict: mapping.shape === 'fixture-helper' ? 'gate' : mapping.shape,
    shape: mapping.shape,
    inputKind: input.kind,
    where: mapping.where,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 判决 ⇒ 一条【待建任务的提案】
// ─────────────────────────────────────────────────────────────────────────────


/**
 * ── ★★★ 这一格的写域是【粗的】，而那是**如实**的，不是偷懒 ──────────────────────
 *
 * 我一开始想给每条判决推一个**具体文件**，好让冲突检测更精确。**做不到**，而
 * 原因值得写下来：判决的 `claim` 是**人话散文**，它推不出可靠的文件路径。
 * 实测（11 条判决）：只有 2 条的正文里出现了 `scripts/`，而其中一条指的是
 * **它讲的两次事故**（j-0011 的 `scene`），不是它自己要产出的文件。
 *
 * ⇒ ★ 硬推一个"具体文件"会让提案**声称**一个它没有依据的写域 ——
 *   而那比"粗的写域"坏得多：粗的写域会让一条提案**多等一会儿**，
 *   编的写域会让两条真的冲突的提案**同时被派出去**。
 *   ★ 与本队那条同源：**一个编出来的读数，与没有那个读数在观测上完全不同**
 *     —— 前者会让人做错决定。
 *
 * ★★ 所以粗写域的**代价**必须在**读数里**被说清，而不是藏起来：
 *   见 {@link triageProposals} 的 `blockedBy` —— 它必须区分
 *   「与**具体某条**互斥」与「与同区域的一批**排队**」（见那里）。
 */
export function inScopeCandidatesFor(triage) {
  if (triage.shape === 'gate' || triage.shape === 'fixture-helper') {
    return ['scripts/', 'src/gates/']
  }
  return []
}

/** 把一个判决变成提案；`no-action` 的不产出提案。 */
export function proposalForJudgement(candidate, triage) {
  if (triage.verdict !== 'gate') return undefined
  return {
    source: 'judgement',
    sourceId: triage.id,
    kind: triage.shape === 'fixture-helper' ? 'fixture-helper' : 'gate',
    subject: `判据：${shorten(candidate?.claim ?? '', 60)}`,
    objective: candidate?.claim ?? '',
    inScope: inScopeCandidatesFor(triage),
    /** ★ 写域是**候选**（要 captain 定），而这一句说清它凭什么 —— 别让它看起来像已定。 */
    scopeBasis: '粗写域（判据的产物落 scripts/ 与 src/gates/）—— 具体到哪个文件要 captain 定，'
      + '因为 claim 是散文，推不出可靠路径；编一个比粗的更坏',
    because: `judgement-triage 判它 gate（读的是 ${triage.inputKind}）⇒ ${triage.where}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 卡点 ⇒ 还需不需要行动
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 一个卡点**还需不需要行动**（三态，而三者不同形）────────────────────────────
 *
 * 读的是两个**已经写在盘上**的事实：
 *
 *     `resolution.state`  —— 它被处理了吗（fixed / scheduled / open / wontfix / 没写）
 *     `index.component`   —— 它属于哪个组件（提案的写域从它推）
 *
 * ── ★ 判据（顺序即优先级，且每一条都有理由）────────────────────────────────────
 *
 *   `fixed`            ⇒ **no-action** —— 已修。★ 而"再派一次"的代价不是零：
 *                        它会让人把**已经做过的事**再做一遍，而台账里会多一条
 *                        "同一个卡点被修了两次"的读数（而它读起来像"这个卡点很顽固"）。
 *   `wontfix`          ⇒ **no-action** —— 已裁定不修（那是一个决定，不是待办）。
 *   `scheduled`        ⇒ **no-action** —— 已经被排进某个任务（`resolution.task` 指得出是谁）。
 *                         ★ 而它与 `fixed` 不同形：一个是"做完了"，一个是"在做"。
 *   `open`             ⇒ **to-dispatch 候选** —— 真的还欠一个动作。
 *   没写 `resolution`  ⇒ ★ **`unknown`** —— **不是** `open`。
 *
 * ★★ 为什么"没写"必须落 `unknown`（第四态）而不是 `open`：
 *   本仓库里**85/112 条没有 `resolution`** —— 而它们混合了两种东西：
 *     · 真的还没处理的；
 *     · 以及**处理了但没回填的**（台账漏记）。
 *   ⇒ 把它们一律当 `open` 会让清单里塞进几十条**没人验证过**的"待办"，
 *     而 captain 只能逐条去读 —— 那正好抵消了本工具的全部价值。
 *   ⇒ 如实报 `unknown`，并**让那个数字可见**（它是"台账需要回填"这条读数）。
 */
export function actionForFriction(record) {
  const state = record?.resolution?.state
  if (state === 'fixed') return { action: 'no-action', why: 'resolution.state = fixed（已修）' }
  if (state === 'wontfix') return { action: 'no-action', why: 'resolution.state = wontfix（已裁定不修）' }
  if (state === 'scheduled') return { action: 'no-action', why: `resolution.state = scheduled（已排进 ${String(record?.resolution?.task ?? '某个任务')}）` }
  if (state === 'open') return { action: 'candidate', why: 'resolution.state = open（真的还欠一个动作）' }
  /**
   * ★ 没有 `resolution` / 状态不认识 ⇒ **`unknown`**（第四态）。
   *   ★ 而它**不是** `no-action`（那会把它藏起来），也**不是** `candidate`
   *     （那会把没验证过的当作待办）。⇒ 它是它自己：**台账需要回填**。
   */
  return {
    action: 'unknown',
    why: state === undefined
      ? 'no resolution.state was recorded — this is "the ledger was not backfilled", not "this still needs action"'
      : `resolution.state = "${String(state)}" is not one this tool knows, so whether it needs action could not be judged`,
  }
}

/**
 * 一个卡点变成提案。
 *
 * ★ 只有 `candidate`（`resolution.state === 'open'`）才产出提案 ——
 *   而 `unknown` 那一些**不产出**（它们先要人回填台账，而那不是一条可派的任务）。
 */
export function proposalForFriction(record) {
  const verdict = actionForFriction(record)
  if (verdict.action !== 'candidate') return undefined
  const component = record?.index?.component
  return {
    source: 'friction',
    sourceId: record?.id ?? '(no id)',
    kind: 'repair',
    subject: `修卡点 ${record?.id ?? '?'}：${shorten(record?.title ?? '', 60)}`,
    objective: record?.title ?? '',
    inScope: typeof component === 'string' && component !== '' ? [component] : [],
    because: verdict.why,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 三态裁决：写域空闲 ⇒ to-dispatch；被挡 ⇒ blocked（★ 附：被谁挡）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 两个提案的写域**重叠**吗 ──────────────────────────────────────────────────
 *
 * ★ 判定是**目录前缀**级别（`src/gates/` 与 `src/gates/x.ts` 重叠），
 *   因为这一格要回答的是"**它们会不会改同一个地方**"。
 *   ★ 而它**不是** `inScopeOverlap` 的复制品：那个函数做的是**精确路径**匹配
 *     （实测：`['src/dir']` 与 `['src/dir/file.ts']` 不算重叠），
 *     而这里要的正是**前缀**语义 —— 两者是不同的判据，不该借用。
 */
export function scopesOverlap(left, right) {
  const norm = (scope) => String(scope).replace(/^\.\//u, '').replace(/\/+$/u, '')
  for (const a of left ?? []) {
    for (const b of right ?? []) {
      const na = norm(a)
      const nb = norm(b)
      if (na === nb) return true
      if (na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`)) return true
    }
  }
  return false
}

/**
 * ── 给一组提案判三态 ──────────────────────────────────────────────────────────
 *
 * @param proposals - 待派提案
 * @param occupied - **已被占用的写域**（`{ scope, by }`；`by` 是"被谁占着"）
 * @returns `{ toDispatch, blocked, occupants }`
 *
 * ── ★★ `blocked` 必须【说出被谁挡】────────────────────────────────────────────
 *
 * 契约原文：「`blocked` —— 值得派，而被写域挡着（★ 附：**被谁**挡）」。
 * ★ 只说"被挡住了"等于让人自己去翻——而那正是本工具要消掉的那件事。
 *   ⇒ 每一条 `blocked` 带上**占用者的名字**（来自 `occupied[].by`）。
 *
 * ★ 而"提案之间"也会互相挡：两条都要 `scripts/` ⇒ 第二条落 `blocked`（被第一条挡）。
 *   ⇒ 那正是用户裁定的"写域冲突就先别派"的机械化落点。
 */
export function triageProposals(proposals, occupied = []) {
  const toDispatch = []
  const blocked = []
  /** 已经被**接受**的提案（它们自己开始占写域 —— 派出去的会真的动那些文件）。 */
  const accepted = []
  for (const proposal of proposals) {
    /** ① 被【清单之外】的东西占着（一个正在跑的成员、一个已派的任务）。 */
    const external = occupied
      .filter((holder) => scopesOverlap(proposal.inScope, [holder.scope]))
      .map((holder) => holder.by)
    /** ② 被【本条清单里更早的一条】占着。 */
    const internal = accepted.filter((earlier) => scopesOverlap(proposal.inScope, earlier.inScope))
    if (external.length === 0 && internal.length === 0) {
      accepted.push(proposal)
      toDispatch.push(proposal)
      continue
    }
    blocked.push({
      ...proposal,
      blockedBy: [...external, ...internal.map((earlier) => earlier.sourceId)],
      /**
       * ── ★★★ 这一格是本工具**最容易被读错**的一处，所以单独成字段 ────────────────
       *
       * MEASURED（t72 第一次对真实台账跑）：11 条判决里有 8 条判成 `gate`，
       * 而它们的写域**都是** `['scripts/', 'src/gates/']`（见 `inScopeCandidatesFor`
       * 那段"为什么写域是粗的"）⇒ 于是**7 条互相挡**，而 `blockedBy` 全部写着
       * `j-0002`。
       *
       * ★ 那**技术上是对的**（它们确实都在同一个区域），而它**读起来是错的**：
       *   "被 j-0002 挡着"暗示 `j-0002` 是那 7 条的**前置条件** ——
       *   而它根本不是。它们是**同区域的一批候选**，谁先谁后**可以随便排**。
       *
       * ⇒ 所以这一格把两种"被挡"**分开说**（而契约要的正是"附：被谁挡"说清楚）：
       *
       *     `mutual`     —— 与**具体某条**互斥（那一条真的动了它的写域）
       *     `same-area`  —— 与同区域的另一条**排队**（顺序可互换，不是前置）
       *
       * ★ 而"顺序可互换"这句话**不是**猜测：判据的产地（`scripts/gate-*.test.mjs`）
       *   是**一条判据一个文件**，两条判据天然不共享文件。
       *   ⇒ 所以它们可以**串行**，而**不必**按某个特定次序。
       *   ★ 这也解释了为什么"一次只派一条"在这里是**对的**（用户裁定）：
       *     不是为了满足一条真的前置依赖，而是为了让**合并**不必处理同区域并发。
       */
      blockedKind: external.length > 0 ? 'mutual' : 'same-area',
      blockedNote: external.length > 0
        ? '那件事做完之前不该动这些文件（真的前置）'
        : '串行是为了让合并简单，不是因为前置 —— 这两条谁先谁后都可以',
    })
  }
  return { toDispatch, blocked }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 读盘（★ 读不到 ⇒ unmeasured，不是"空"）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 读一个目录里的 JSON。
 *
 * ★ 读不到目录 ⇒ `undefined`（**不是** `[]`）：`[]` 是"读了、一条都没有"，
 *   `undefined` 是"我没能读" —— 本队记账最久的那条界线。
 * ★ 单条读坏 ⇒ **跳过它**，但把条数差记在 `malformed` 里（不静默）。
 */
export function readJsonDir(dir) {
  let names
  try {
    if (!existsSync(dir)) return undefined
    names = readdirSync(dir)
  } catch {
    return undefined
  }
  const out = []
  const malformed = []
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (parsed === null || typeof parsed !== 'object') { malformed.push(name); continue }
      out.push(parsed)
    } catch {
      malformed.push(name)
    }
  }
  return { records: out, malformed }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 主流程
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 跑一次分诊。
 *
 * @returns 一份**可直接消费**的读数：JSON 部分 + 人话清单。
 */
export function triage({ frictionsDir, judgementsDir, occupied = [] } = {}) {
  const frictionsRead = readJsonDir(frictionsDir)
  const judgementsRead = readJsonDir(judgementsDir)

  /** ★ 读不到任一侧 ⇒ 如实说**是哪一侧**读不到（不合并成一句"没能读"）。 */
  const unreadable = []
  if (frictionsRead === undefined) unreadable.push(`frictions (${frictionsDir})`)
  if (judgementsRead === undefined) unreadable.push(`judgements (${judgementsDir})`)

  const judgementVerdicts = (judgementsRead?.records ?? []).map((record) => ({
    id: String(record.id ?? '(no id)'),
    triage: triageJudgement(record),
  }))
  const frictionActions = (frictionsRead?.records ?? []).map((record) => ({
    id: String(record.id ?? '(no id)'),
    title: String(record.title ?? ''),
    verdict: actionForFriction(record),
  }))

  /** 提案 = 判决里的 gate + 卡点里的 open。 */
  const proposals = [
    ...judgementVerdicts
      .map(({ id, triage: t }) => proposalForJudgement(
        (judgementsRead?.records ?? []).find((r) => String(r.id) === id), t,
      ))
      .filter((p) => p !== undefined),
    ...frictionActions
      .filter(({ verdict }) => verdict.action === 'candidate')
      .map(({ id }) => proposalForFriction((frictionsRead?.records ?? []).find((r) => String(r.id) === id)))
      .filter((p) => p !== undefined),
  ]

  const { toDispatch, blocked } = triageProposals(proposals, occupied)

  /** `no-action` 的两类，分开数（★ 理由不同 ⇒ 读数不同形）。 */
  const noAction = frictionActions.filter(({ verdict }) => verdict.action === 'no-action')
  const unknown = frictionActions.filter(({ verdict }) => verdict.action === 'unknown')

  return {
    unreadable,
    counts: {
      frictions: frictionActions.length,
      judgements: judgementVerdicts.length,
      toDispatch: toDispatch.length,
      blocked: blocked.length,
      noAction: noAction.length,
      unknown: unknown.length,
    },
    /** ★ 判决侧的分布：机械化的 / 只能诊断的 / 表达不出断言的 / 判不了的。 */
    judgementVerdicts,
    /** ★ 卡点侧：不需要行动的（已修/已排/已裁定）。 */
    noAction,
    /** ★ 卡点侧：**台账需要回填**（没有 resolution 记录）—— 它是一条独立读数。 */
    unknown,
    toDispatch,
    blocked,
  }
}

function shorten(text, max) {
  const flat = String(text).replace(/\s+/gu, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** 人话清单。★ 它必须让"该派哪几条"**一眼看得出**（契约：让消费变便宜）。 */
export function render(report) {
  const lines = []
  if (report.unreadable.length > 0) {
    lines.push(`★ 读不到：${report.unreadable.join('、')} —— 那一侧**没能测量**（不是"空的"）`, '')
  }
  const c = report.counts
  lines.push(
    `卡点 ${c.frictions} 条 · 判决 ${c.judgements} 条`,
    `⇒ 待派 ${c.toDispatch} · 被写域挡 ${c.blocked} · 无需行动 ${c.noAction} · 台账待回填 ${c.unknown}`,
    '',
  )
  lines.push(`── 现在就能派（${c.toDispatch}）──`)
  if (c.toDispatch === 0) lines.push('  （无）')
  for (const p of report.toDispatch) {
    lines.push(`  · [${p.sourceId}] ${p.subject}`)
    lines.push(`      写域：${p.inScope.join(', ') || '(未声明)'}`)
    lines.push(`      依据：${p.because}`)
  }
  lines.push('', `── 值得派、而被写域挡着（${c.blocked}）──`)
  if (c.blocked.length === 0) lines.push('  （无）')
  for (const p of report.blocked) {
    lines.push(`  · [${p.sourceId}] ${p.subject}`)
    lines.push(`      被谁挡：${p.blockedBy.join('、')}`)
    /**
     * ★★★ 这一行是"被谁挡"的**全部意义**（见 `triageProposals` 那段实测）。
     *   ★ 只说一个 id 会让人以为那是**前置条件** —— 而 7 条同区域的候选
     *     互相"挡"的其实是**排队**，顺序可互换。
     */
    lines.push(`      性质：${p.blockedKind === 'mutual' ? '互斥' : '同区域排队'} —— ${p.blockedNote}`)
  }
  lines.push('', `── 无需行动（${c.noAction}）──`)
  for (const entry of report.noAction.slice(0, 8)) lines.push(`  · ${entry.id}：${entry.verdict.why}`)
  if (report.noAction.length > 8) lines.push(`  …另有 ${report.noAction.length - 8} 条`)
  lines.push('', `── ★ 台账待回填（${c.unknown}）：它们**不是**待办，是"没有 resolution 记录" ──`)
  if (report.unknown.length > 0) {
    lines.push(`  （这 ${report.unknown.length} 条混合了"真的还没处理"与"处理了但没回填"——`)
    lines.push('    把它们当待办会让清单塞进几十条没人验证过的条目，而那正好抵消本工具的价值。）')
  }
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const report = triage({
    frictionsDir: argValue(argv, '--frictions', '.agent-teams/frictions'),
    judgementsDir: argValue(argv, '--judgements', '.agent-teams/judgements'),
  })
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`${render(report)}\n`)
}
