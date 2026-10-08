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
 * ── ★ t78：那份"明写的重复"已经消掉了 —— 而**到期条件**写在它旁边 ─────────────
 *
 * 这里曾经逐字写着（t72）：
 *
 *     「`judgement-triage.mjs`（t65）**没有落进本仓库**（那次交付报了 failed 且未提交）
 *       ⇒ 本文件把它那三条判断**自己实现一遍**，而不是 import 一个不存在的模块。
 *       ★ 而那个重复是**明写的**，并且有一条臂断言"两边口径一致"——
 *         等 t65 落地之后，这里应当改成 import 它。」
 *
 * ⇒ ★ 那个条件在 **5d91625** 满足了（captain 把 t65 的产物并入了主树）
 *   ⇒ 于是这里现在是 **re-export**（见 §①）：**只有一份实现**，而不是两份。
 *
 * ★★ 而它**仍然不 import 产品代码** —— 它只读 JSON，只依赖 `judgement-triage` 那一个
 *   同样只读文本的工具。
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
// ① 判决的可机械化判断 —— ★★★ t78：**改成 import**（写在 t72 的到期条件已满足）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 那份重复的**到期条件**，以及它为什么现在该消掉 ──────────────────────────
 *
 * t72 写下的原文（逐字保留在 §"曾经写在这里的"里）：
 *
 *     「`judgement-triage.mjs`（t65）**没有落进本仓库**（那次交付报了 failed 且未提交）
 *       ⇒ 本文件把它那三条判断**自己实现一遍**，而不是 import 一个不存在的模块。
 *       ★ 而那个重复是**明写的**，并且有一条臂断言"两边口径一致"——
 *         等 t65 落地之后，这里应当改成 import 它。」
 *
 * ⇒ ★ 那个条件在 **5d91625** 满足了（captain 把 t65 的产物并入了主树）
 *   ⇒ 于是这里**不再是两份实现**，而是一份。
 *
 * ── ★★ 而"同一份实现"这件事**仍然可测** —— 否则这次改动只是把证据删掉了 ────────
 *
 * 这里导出的**就是那个函数对象本身**（不是包装）：
 *
 *     import { triage as triageJudgement } from './judgement-triage.mjs'
 *     export { triageJudgement, … }
 *
 * ★★ MEASURED（第一版当场抓出来的）：写成 `export { triage as triageJudgement } from '…'`
 *   **只是转发**，它**不建立本地绑定** ⇒ 本文件内部引用 `triageJudgement` 会
 *   `ReferenceError: triageJudgement is not defined`。
 *   ★ 而那个错**能通过任何"文件能不能加载"的检查** —— 只有真的跑到那条路径才现形。
 *
 * ⇒ 夹具可以断言**同一性**（`===`），而那比"取值集合相同"强一级：
 *   · 旧的那条臂测"两边的**取值**一致"—— 两份实现可以碰巧一致，也可以各自漂移
 *   · 新的那条臂测"**就是同一个函数**"—— 漂移在**结构上**不可能
 *
 * ★★ 而 j-0003 那条分歧（t65 记为"判据边界上的分歧"）现在**变成了同一份实现的
 *   内部一致性** —— 而那正是它该有的结果：**一个分歧只在有两份实现时才存在。**
 *
 * ── ★ 三态（import 成功 / 模块缺 / 无法判断）──────────────────────────────────
 *
 * ★ 这里刻意**用静态 import**，于是"模块缺"这一态由 **ESM 解析器**给出
 *   （`ERR_MODULE_NOT_FOUND`，一条明确的、带文件名的错误）——
 *   而不是由本文件**猜**出来。
 *
 * ★★ 为什么不写成"惰性 + try/catch 降级成 unmeasured"（我第一版就是那么写的，
 *   而它**是错的**）：那会把"**这个模块还没落地**"（一次真实的安装/合并缺陷）
 *   与"**这一条 claim 判不了**"（一个正常的第四态）**合成同一种读数**，
 *   而两者的补救动作相反（一个去补模块，一个去改 claim）。
 *   ⇒ 本队记账过这个形态：**把基础设施工况伪装成关于数据的结论。**
 *
 *   ★ 而"模块缺时不崩"这个诉求是**对的**，只是它该落在**调用方**：
 *     见 `scripts/friction-triage.test.mjs` 里那条"模块缺 ⇒ 给出可读的失败"的臂 ——
 *     它**真的把模块移走**再跑，而不是让产品代码预先降级。
 */
/**
 * ★★ MEASURED（第一版当场抓出来的）：`export { x } from '…'` 只是**转发**，
 *   它**不建立本地绑定** ⇒ 本文件里 `triage()` 引用 `triageJudgement` 会
 *   `ReferenceError: triageJudgement is not defined`。
 *   ★ 而它**能通过任何"文件能不能加载"的检查** —— 只有真的跑到那条路径才现形。
 *
 * ⇒ 所以这里**先 import 再 export**：本地有绑定（内部可调用），而导出的
 *   仍然是**那个函数对象本身**（同一性可测）。
 */
export { triage as triageJudgement, looksAssertive, inputKindOf, SHAPE_BY_INPUT, VERDICTS as JUDGEMENT_VERDICTS } from './judgement-triage.mjs'
import { triage as triageJudgement } from './judgement-triage.mjs'

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
   * ── ★★★ t91：**自动记录**与"还没回填"是两件事 ─────────────────────────────────
   *
   * MEASURED（t91 实测当前台账 209 条）：**165 条是自动记录的拒绝**
   * （`update_task rejected…` / `create_task rejected…`），而它们**没有 `state` 是设计如此** ——
   * 那条记录发生在"判据拒绝那一下"，那时没有任何人做过决定。
   *
   * ★★ 而本函数此前把它们与"人记了但还没回填"算进**同一格**（`unknown`）⇒
   *   那个数字是 **174**，而真正需要人看的是 **9**。
   *   ⇒ 一个读数把两类东西算成同一类：**"不需要回填"与"还没回填"在它眼里同形。**
   *   ★ 那正是本队记账过的形态，只是这次它在**读数**里而不是在判据里。
   *
   * ── ★★ 为什么它排在四个 state 检查【之后】（那一格的位置是刻意的）───────────────
   *
   * 契约的反向半边：「不许把有待处理的自动条目也一并放过 ——
   * 若某条自动记录**已经有 resolution**，它仍该按那个 resolution 走。」
   * ⇒ 先看 `state`、再看 `auto`。
   * ★ 而一个把顺序反过来的实现会在"自动记录被标成 `open`"时**漏掉一条真的待办** ——
   *   那正是这条反向半边要挡的东西。
   */
  if (record?.auto !== undefined) {
    const origin = record.auto
    const source = typeof origin?.gate === 'string' && origin.gate !== ''
      ? `${String(origin.point ?? '?')} 位置的 ${origin.gate}`
      : String(origin?.point ?? '?')
    return {
      action: 'auto-recorded',
      why: `自动记录的拒绝（${source}）—— 它没有 resolution.state **是设计如此**：`
        + '记录发生在判据拒绝的那一下，那时没有人做过决定。★ 它**不要求人回填**。',
    }
  }
  /**
   * ── ★★ t91：`auto` 那格的**向后兼容** —— 而它是明写的回退，不是暗中的猜 ──────────
   *
   * MEASURED（t91）：`auto` 这个字段是**本轮才加的**，而台账里现存的
   * **167 条自动记录是先于它写下的** ⇒ 它们没有那一格。
   * ⇒ 若只看新字段，本任务的修复对**已有台账**完全无效（那个数字仍是 176）。
   *
   * ★ 所以这里有一个**明写的回退**：老记录的 `title` 以 `<tool> rejected` 开头。
   *   实测分布：`update_task` 160 条 + `create_task` 7 条 —— 而它们**全部**是拒绝路径写的。
   *
   * ── ★★★ 而它是一条**代理读数**，所以我把它写成一格可清理的东西 ──────────────────
   *
   * ★ 本队记账过 j-0003：「代理读数在它所代理的东西没变时也会变」。
   *   这里的代理是 **title 的字符串前缀**，被代理的是"这条记录是谁产生的"。
   *   ★ 而它与真正的字段**不同源** ⇒ 它会随"有没有人改标题措辞"而漂移。
   *   ⇒ 所以回退命中的条目**带一个可读的标记**（`via: 'title-fallback'`），
   *     而那让我们能回答"还有多少条在吃回退"—— 那个数字降到 0 时，这段就该删。
   *
   * ★★ 而它**不与真字段合流**：`auto` 在场时优先用它（上面的分支），
   *   回退只在**没有** `auto` 时生效。⇒ 一个新记录绝不会被标题前缀误判。
   */
  const titleFallback = titleRejectionOrigin(record)
  if (titleFallback !== undefined) {
    return {
      action: 'auto-recorded',
      via: 'title-fallback',
      why: `自动记录的拒绝（${titleFallback}，★ 由 title 前缀认出 —— 这条记录写于 auto 字段之前）—— `
        + '它没有 resolution.state **是设计如此**。★ 它**不要求人回填**。',
    }
  }
  /**
   * ★ 没有 `resolution` / 状态不认识 ⇒ **`unknown`**（第四态）。
   *   ★ 而它**不是** `no-action`（那会把它藏起来），也**不是** `candidate`
   *     （那会把没验证过的当作待办）。⇒ 它是它自己：**台账需要回填**。
   *   ★★ 而它现在**只**覆盖"真的需要人看的"那一类：**人记的、而没有 state**。
   */
  return {
    action: 'unknown',
    why: state === undefined
      ? 'no resolution.state was recorded, and this is not an auto-recorded rejection — '
        + 'so this is "the ledger was not backfilled", not "this still needs action"'
      : `resolution.state = "${String(state)}" is not one this tool knows, so whether it needs action could not be judged`,
  }
}

/**
 * 从 `title` 前缀认出"这是一条自动记录的拒绝"。
 *
 * ★ 形态：`update_task rejected: …` / `create_task rejected: …`
 *   —— 那是 `recordFriction` 的调用方在拒绝路径上拼的那句话。
 *
 * ★ 而它**只认它认得的工具名**（不是任何 `\w+ rejected`）：宽了会把
 *   某条人工写的、恰好那样开头的记录也算成自动的 —— 而那正是本任务要消掉的
 *   那个误导（只是方向反过来）。⇒ 名单是明写的、短的、可核的。
 */
export function titleRejectionOrigin(record) {
  const title = typeof record?.title === 'string' ? record.title : ''
  const match = /^(agent_teams_\w+|update_task|create_task|claim_task|reassign_task|message_member) rejected\b/u.exec(title)
  return match?.[1]
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
  /**
   * ── ★★★ t91：这两格**分开数**（而它们此前是一格）─────────────────────────────────
   *
   * `autoRecorded` = 自动记录的拒绝（**不要求人回填**）
   * `unknown`      = 人记的、而没有 state（★ **真的需要人看**）
   *
   * ★ 合成一格时那个数字是 174，而实际需要人看的是 9 ——
   *   一个读数把两类东西算成同一类，而它们的**补救动作相反**：
   *   前者什么都不用做，后者要人去补一个 state。
   */
  const autoRecorded = frictionActions.filter(({ verdict }) => verdict.action === 'auto-recorded')
  const unknown = frictionActions.filter(({ verdict }) => verdict.action === 'unknown')

  return {
    unreadable,
    counts: {
      frictions: frictionActions.length,
      judgements: judgementVerdicts.length,
      toDispatch: toDispatch.length,
      blocked: blocked.length,
      noAction: noAction.length,
      autoRecorded: autoRecorded.length,
      unknown: unknown.length,
    },
    /** ★ 判决侧的分布：机械化的 / 只能诊断的 / 表达不出断言的 / 判不了的。 */
    judgementVerdicts,
    /** ★ 卡点侧：不需要行动的（已修/已排/已裁定）。 */
    noAction,
    /** ★ 卡点侧：**自动记录**（不要求人回填）—— t91 从下面那一格里分出来的。 */
    autoRecorded,
    /**
     * ★ 而其中有多少条是靠 **title 前缀回退**认出来的（写于 `auto` 字段之前）。
     *   ★ 它是一条**代理读数**（见 `actionForFriction` 那段）⇒ 它的存量必须可见，
     *     否则我们无法知道那段回退什么时候可以删。
     */
    autoRecordedViaFallback: autoRecorded.filter(({ verdict }) => verdict.via === 'title-fallback').length,
    /** ★ 卡点侧：**台账需要回填**（人记的、而没有 state）—— 它是一条独立读数。 */
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
    `⇒ 待派 ${c.toDispatch} · 被写域挡 ${c.blocked} · 无需行动 ${c.noAction}`,
    /**
     * ── ★★★ t91：那两格**分开印**（而它们此前合成一个"台账待回填"）───────────────
     * ★ 合成一格时读的人会以为 174 条要他去补 —— 而其中 165 条**根本不需要人来管**。
     */
    `   ★ 台账待回填 ${c.unknown}（人记的、而没有 state —— 这些**真的需要人看**）`,
    `   · 自动记录 ${c.autoRecorded}（判据拒绝的那一下记的，★ **不要求人回填**）`
      + (report.autoRecordedViaFallback === 0
        ? ''
        : `\n     ★ 其中 ${report.autoRecordedViaFallback} 条是靠 **title 前缀**认出来的`
          + '（它们写于 auto 字段之前）—— 那个数字降到 0 时，那段回退就可以删了'),
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
  lines.push('', `── ★ 台账待回填（${c.unknown}）：人记的、而没有 resolution.state ──`)
  if (report.unknown.length > 0) {
    for (const entry of report.unknown.slice(0, 8)) lines.push(`  · ${entry.id}：${shorten(entry.title, 60)}`)
    if (report.unknown.length > 8) lines.push(`  …另有 ${report.unknown.length - 8} 条`)
    lines.push('  （这一格**只**收"人记的、而没有 state"。把它当待办会让清单塞进没人验证过的条目，）')
    lines.push('  （而那正好抵消本工具的价值。区别于下面那一格 —— 那些**不用管**。）')
  }
  /**
   * ★★★ t91：自动记录**单列一格**，而它必须**看得见**（否则读的人仍会以为它们等着他）。
   *   ★ 而它**不逐条列**（165 条会把清单淹掉）：只给计数 + 一句"它们不要求回填"。
   */
  lines.push('', `── 自动记录（${c.autoRecorded}）：判据拒绝那一下记的，★ **不要求人回填** ──`)
  if (report.autoRecorded.length > 0) {
    const byGate = new Map()
    for (const entry of report.autoRecorded) {
      const key = entry.verdict.why.match(/位置的 ([\w.-]+)/u)?.[1] ?? '(未指名判据)'
      byGate.set(key, (byGate.get(key) ?? 0) + 1)
    }
    const top = [...byGate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    for (const [gate, count] of top) lines.push(`  · ${gate}：${count} 条`)
    if (byGate.size > 5) lines.push(`  …另有 ${byGate.size - 5} 条判据`)
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
