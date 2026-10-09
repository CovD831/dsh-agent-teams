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
    /**
     * ── ★★★ t95：`create_task` 对质量类要求 `acceptance` 与 `verify` ─────────────
     *
     * ★ 而它们**不是凑数的**：那两格是从**这条判决自己的判据**推出来的 ——
     *   一条判据的验收就是"它真的能判那件事"，而它的验证命令就是**它自己的夹具**。
     *   ⇒ 一条判据**没有夹具**就不该被建出去（那正是"建了一个没人检查的任务"）。
     */
    acceptance: [
      `★ 这条判据必须能对某个输入返回真/假（否则它只是纪律，不该建）`,
      `★ 它必须【能判出】${shorten(candidate?.claim ?? '', 60)} 的反面（一次定向突变能让它红）`,
      '★ 三态不同形：判不了 / 判了通过 / 判了拒绝 —— 不许把"没测到"并进"通过"',
    ],
    verify: ['pnpm build', 'pnpm typecheck', 'pnpm test:gates'],
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
    /**
     * ★ 卡点类提案的验收是"那个卡点**不再发生**"，而它的可核形式是
     *   **那个位置的读数据有变化** —— 不是"我改了点东西"。
     */
    acceptance: [
      `★ ${record?.id ?? '那条卡点'} 不再复现：那个位置上的读数必须能证明它变了`,
      '★ 而"改了但没测"不算修好：修复要能用一次定向突变打红它',
    ],
    verify: ['pnpm build', 'pnpm test:gates'],
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
// ⑧ ★★★ t97：写域收窄 —— 而"收窄"本身要可核
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 它修的是什么（MEASURED，captain 当场撞到）─────────────────────────────────
 *
 * 分诊器此前给的写域是**粗的**：`['scripts/', 'src/gates/']`。
 * ★ 而它让两条**本来无关**的任务**互斥** —— t96 与 t97 撞了，而 captain 只能手动
 *   amend t96 的写域。
 *
 * ★★ 而 t72 当时给的理由是对的：**claim 是人话散文，推不出可靠路径**。
 *   一个"编出来的具体文件"比粗写域坏得多 —— 编的会让两条真冲突的同时被派出去。
 *
 * ── ★★★ 而现在【信息够了】：那件事**知道自己会产出什么** ────────────────────────
 *
 * 一条判据的产物在**本仓库的约定**里是可推的（实测：`scripts/gate-*.test.mjs`
 * 一条判据一个夹具文件，而 slug 来自它讲的那件事）：
 *
 *     判决的 claim  ⇒  slug 由它里面的**英文标识符**归一化而来
 *     ⇒ `scripts/gate-<slug>.test.mjs`
 *
 * ★ 而**推导不出来的**（claim 里挑不出可靠的 slug）⇒ 如实标 `coarse`
 *   **并说明为什么** —— 不许硬推一个"具体文件"。
 *
 * ★★ 三态（而它们不许合并）：
 *
 *     `narrowed`  —— 推出来了，附**为什么是这个文件**
 *     `coarse`    —— ★ 推不出来，如实标粗**并说清理由**（补救：人来收窄）
 *     `none`      —— 这个提案**不产出文件**
 */
export function narrowScope(proposal, options = {}) {
  const broad = Array.isArray(proposal?.inScope) ? proposal.inScope : []
  if (broad.length === 0) {
    return { status: 'none', inScope: [], why: '这个提案没有写域（它不产出文件）' }
  }
  /**
   * ★ 只有**判决侧**的提案能收窄到具体文件 —— 因为只有它的产物有命名约定。
   *   ★ 卡点侧改的是"某个组件"（那一格本身就是它知道的全部）⇒ **如实标 coarse**。
   */
  if (proposal?.source !== 'judgement') {
    return {
      status: 'coarse',
      inScope: broad,
      why: '卡点侧只知道"哪个组件"，而组件的具体文件要人去读那个卡点 —— '
        + '★ 推一个具体文件会编出一个没有依据的写域（那比粗的更坏）',
    }
  }

  /**
   * ── ★★★ 而 slug 有**两个来源**，而它们的可靠性不同 ──────────────────────────────
   *
   *   ① claim 里的英文标识符 ⇒ 它讲的**就是那个东西**（最可靠）
   *   ② 判决自己的 id（`j-00NN`）⇒ ★ 那**不是编的**：它是这条判决在台账里的稳定标识，
   *      而"一条判决一个夹具文件"是本仓库的**命名约定**，不是我的猜测。
   *
   * ★★ 而为什么需要 ②（MEASURED）：真实台账里的 claim **全是中文散文**
   *   （实测 j-0001…j-0011 一条都挑不出英文 slug）⇒ 只用 ① 会让收窄**永不生效**，
   *   而那意味着 t96/t97 那种互斥**一次都不会被修掉**。
   *
   * ★★★ 而 ② 与"编一个具体文件"的区别在哪里（那正是 t72 禁止的东西）：
   *
   *     编的写域     —— 我说"它大概会改 foo.ts"，而**没有依据**
   *     ② 这个写域   —— 按**本仓库的命名约定**，这条判决的产物就是 `gate-j-00NN.test.mjs`
   *                    ⇒ 它是**可核的**：交付时若那个文件叫别的名字，那是一次偏差
   *                      （而偏差**看得见**，因为它与契约写的不一样）
   *
   * ★ 所以 ② 只在**约定确实存在**时使用（判决侧、且 slug 是 `j-00NN` 形状）。
   */
  const slug = slugFromClaim(proposal?.objective ?? '') ?? slugFromId(proposal?.sourceId)
  if (slug === undefined) {
    return {
      status: 'coarse',
      inScope: broad,
      why: 'claim 是散文、而这条提案的 id 也不是判决 id 那样的稳定标识 ⇒ 如实标粗。'
        + '★ 不许编一个具体文件：编的写域会让两条真冲突的任务同时被派出去',
    }
  }
  /**
   * ★ 收窄成**两个格子**：判据本体（它的夹具）与它要注册进的那一格。
   *   ★ 而 `src/gates/` 保留 —— 因为一条判据**要注册进去**，
   *     而把注册表排除在外会让"它的产物"与"它的接线"分开（那是本队记账过的形态）。
   */
  return {
    status: 'narrowed',
    inScope: [`scripts/gate-${slug}.test.mjs`, 'src/gates/index.ts'],
    why: `收窄到**两个具体文件**：它实际会产出的那一个夹具（scripts/gate-${slug}.test.mjs），`
      + '以及它必须登记进去的那一格（src/gates/index.ts）。'
      + '★ 前者是本仓库的约定（一条判据一个夹具文件）；'
      + '★ 后者是实测的（那个文件是一张**手工维护的 import 清单** ⇒ 新判据不登记就没装上去）。'
      + '★★ 而它们都**不是目录** —— 那正是 t96/t97 互斥的成因（目录级写域让两条无关任务互斥）',
    slug,
  }
}

/**
 * 从一个 claim 里挑出**可靠的 slug** —— 而挑不出来就返回 `undefined`（**不猜**）。
 *
 * ★ 它只认**英文标识符形状**的词：那是本仓库 slug 的真实来源
 *   （实测 `scripts/gate-changed-paths.test.mjs` ← 它的主题词）。
 *   ★ 中文短语**不做音译**：音译出来的 slug 是编的，而编的比粗的更坏。
 */
export function slugFromClaim(claim) {
  if (typeof claim !== 'string') return undefined
  /** ① 反引号里的标识符（最可靠）。 */
  for (const match of claim.matchAll(/`([A-Za-z][\w-]{2,})`/gu)) {
    const slug = normalizeSlug(match[1])
    if (slug !== undefined) return slug
  }
  /** ② 裸的英文标识符（`foo-bar` / `foo.bar` / `foo_bar`）。 */
  for (const match of claim.matchAll(/\b([a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+)\b/gu)) {
    const slug = normalizeSlug(match[1])
    if (slug !== undefined) return slug
  }
  return undefined
}

/**
 * 判决 id ⇒ slug。★ 只认 `j-NNNN` 那个形状（**窄**：宽了会把别的东西也算进来）。
 *
 * ★ 而它**不是编的**：一条判决一个夹具文件是本仓库的命名约定，
 *   而判决 id 是它在台账里的稳定标识 ⇒ 那个文件名是**可核的**。
 */
export function slugFromId(id) {
  const match = /^j-(\d{3,})$/u.exec(typeof id === 'string' ? id : '')
  return match === null ? undefined : `j-${match[1]}`
}

/** 归一化：`foo.bar` / `foo_bar` ⇒ `foo-bar`。★ 太短的不算（一个三字母的词不是 slug）。 */
function normalizeSlug(text) {
  const slug = String(text).toLowerCase().replace(/[._]/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '')
  return slug.length >= 4 ? slug : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ ★★★ t97：对抗性审查 —— 前移到**生成的那一刻**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 用户原话（这一节存在的全部理由）────────────────────────────────────────────
 *
 * > 「我觉得可能不用等到要派的时候再去做任务的对抗性审查，在自动生成的时候就可以去做了。
 * >   生成完的任务，可以带一个『已审查』的字段。
 * >   因为有的任务是自动生成的，有的任务是需要问过我之后再生成、再派发的。
 * >   对于问过我、我裁决过的任务，在生成计划时就没有走自动生成的那一步，
 * >   也就没有『已审查』的字段，那它就需要被审查一遍。
 * >   但是，目前我们先只做一遍审查。」
 *
 * ── ★★★ 所以核心是一条【路由规则】，而字段就是判据 ──────────────────────────────
 *
 *     带 `reviewed`  ⇒ 放行（它在生成时已经审过）
 *     不带         ⇒ ★ 必须先审一遍才能派
 *   ★ 而"不带"**不是错误**：它是"这条路没走自动生成"的**正常状态**。
 *
 * ── 五问（每条都对着一次真实事故）───────────────────────────────────────────────
 *
 *   ① 写域：inScope 是否覆盖它要改的全部？（t54 漏了三个文件）
 *   ② 前置：它依赖的东西在不在？（t58 拆成两半而第二半的前提不在）
 *   ③ 搬运：若它要搬东西 ⇒ 有没有核对手段？（t70 丢 4 组接线 / t94 逐符号）
 *   ④ 验收：acceptance 能不能判真假？会不会恒真？（t94 的"恰好落一栏"看不见哪一栏）
 *   ⑤ 越界：outOfScope 是否挡住了它会碰到的东西？
 *
 * ★★ 而每一问的结论**三态**，不许合并：
 *
 *     `pass`        —— 看了，没问题
 *     `fail`        —— 看了，有问题（★ 附**为什么**）
 *     `unmeasured`  —— ★ **问不出答案**（附缺什么）
 *
 *   ⇒ ★★★ 而 `unmeasured` **绝不并进 `pass`**：那是本队那条最贵的纪律。
 *     且它让整条审查落 `needs-review`（**不是**盖章）—— 见 `adversarialReview`。
 */
export const REVIEW_CHECKS = Object.freeze([
  { id: 'scope', question: '写域：inScope 是否覆盖了它要改的全部？', accident: 't54 漏了三个文件' },
  { id: 'prerequisite', question: '前置：它依赖的东西在不在？', accident: 't58 拆成两半而第二半的前提不在' },
  { id: 'move', question: '搬运：若它要搬东西 ⇒ 有没有核对手段？', accident: 't70 丢 4 组接线 / t94 逐符号' },
  { id: 'acceptance', question: '验收：acceptance 能不能判真假？会不会恒真？', accident: 't94 的"恰好落一栏"看不见哪一栏' },
  { id: 'boundary', question: '越界：outOfScope 是否挡住了它会碰到的东西？', accident: '产物与接线分开会让接线无人负责' },
])

/**
 * 跑一遍**对抗性审查**（五问）。
 *
 * @returns `{ outcome, checks, failedIds, unmeasuredIds }`
 *   `outcome` = `passed` / `rejected` / `needs-review`
 *
 * ★ 而 `needs-review` 的判据是**至少有一问 `unmeasured`** 且**没有一问 `fail`**：
 *   那是一句诚实的话 —— "我没能把它审明白" —— 而它与"审过了，没问题"不同形。
 */
export function adversarialReview(contract, scopeVerdict) {
  const checks = []
  const inScope = Array.isArray(contract?.inScope) ? contract.inScope : []
  const outOfScope = Array.isArray(contract?.outOfScope) ? contract.outOfScope : []
  const acceptance = Array.isArray(contract?.acceptance) ? contract.acceptance : []
  const verify = Array.isArray(contract?.verify) ? contract.verify : []

  /** ① 写域 —— ★★ 而它**先读收窄的结论**（见下） */
  if (inScope.length === 0) {
    checks.push({ id: 'scope', verdict: 'fail', why: '没有任何写域 ⇒ 它改什么没人管得住（t54 的形态）' })
  } else if (scopeVerdict?.status === 'coarse') {
    /**
     * ── ★★★ MEASURED（t97 实测抓出来）：这一问此前**只看"结尾有没有 /"** ──────────
     *
     * 而 `['comp.x']`（卡点侧给的那一格）**不以 `/` 结尾** ⇒ 它被判 `pass`。
     * ★★ 而那不是"写域是具体的" —— 它是"**我没能把它收窄**"（`narrowScope` 标了 coarse）。
     *   ⇒ 只看结尾字符会把"我推不出来"读成"它是具体的" —— 而那是本队那条：
     *     **代理读数在它所代理的东西没变时也会变**
     *     （代理是"结尾有没有 /"，被代理的是"写域窄不窄"）。
     *
     * ⇒ 修法：**先读收窄那一格的结论**（它是权威），只在它缺席时才退回看结尾字符。
     */
    checks.push({
      id: 'scope',
      verdict: 'unmeasured',
      why: `写域没能收窄到具体文件（${scopeVerdict.why}）⇒ "它要改的全部"问不出来。`
        + '★ 而那不是"覆盖得够"，是"我判不了"',
    })
  } else {
    const coarse = inScope.filter((scope) => scope.endsWith('/'))
    checks.push({
      id: 'scope',
      verdict: coarse.length === 0 ? 'pass' : 'unmeasured',
      why: coarse.length === 0
        ? `写域是具体文件（${inScope.join(', ')}）⇒ 覆盖范围读得出来`
        : `写域里有【目录级】的格子（${coarse.join(', ')}）⇒ 它可能改到目录下任何一个文件，`
          + '而那正是 t96/t97 互斥的成因。★ 而"我推不出具体文件"是**问不出答案**，不是"没问题"',
    })
  }

  /** ② 前置 */
  if (contract?.prerequisiteAbsent !== undefined) {
    checks.push({ id: 'prerequisite', verdict: 'fail', why: String(contract.prerequisiteAbsent) })
  } else {
    const declared = Array.isArray(contract?.dependencies) ? contract.dependencies : []
    checks.push({
      id: 'prerequisite',
      verdict: 'pass',
      why: declared.length === 0
        ? '它不声明依赖 ⇒ 没有前置要查（★ 而那本身是一个**声明**，不是"我忘了查"）'
        : `声明的依赖：${declared.join(', ')}`,
    })
  }

  /** ③ 搬运 */
  if (contract?.movesFiles === true) {
    checks.push(verify.some((command) => /test|verify/iu.test(command))
      ? { id: 'move', verdict: 'pass', why: '它要搬东西，而 verify 里有可重跑的核对 —— 那是 t94 要求的逐符号手段' }
      : { id: 'move', verdict: 'fail', why: '它要搬东西，而 verify 里**没有核对手段**（t70 就是这样丢了 4 组接线）' })
  } else {
    checks.push({ id: 'move', verdict: 'pass', why: '它不搬文件 ⇒ 这一问不适用（★ 而"不适用"是看了之后的结论）' })
  }

  /** ④ 验收 */
  const tautological = acceptance.filter(looksTautological)
  if (acceptance.length === 0) {
    checks.push({ id: 'acceptance', verdict: 'fail', why: '没有 acceptance ⇒ 建出去也没人判它做没做对' })
  } else if (tautological.length > 0) {
    checks.push({
      id: 'acceptance',
      verdict: 'fail',
      why: `有一条 acceptance **恒真**（${shorten(tautological[0], 50)}）—— t94 的"恰好落一栏"就是它：`
        + '它读起来像一条标准，而它对**任何**输入都成立',
    })
  } else {
    checks.push({ id: 'acceptance', verdict: 'pass', why: `${acceptance.length} 条，且没有一条读起来是恒真的` })
  }

  /** ⑤ 越界 */
  const generated = generatedPathsOf(contract)
  const blocked = generated.filter((path) => outOfScope.some((scope) => scopesOverlap([scope], [path])))
  if (blocked.length > 0) {
    checks.push({
      id: 'boundary',
      verdict: 'fail',
      why: `它会产出 ${blocked.join(', ')}，而那一格被自己的 outOfScope 挡住了 —— 那条任务永远做不完`,
    })
  } else if (generated.length === 0) {
    /**
     * ★★ 而这一格是 `unmeasured` 而**不是** `pass`：没有具体产物路径 ⇒
     *   这一问**没法回答**（"越界"问的是"产物与 outOfScope 撞不撞"）。
     *   ★ 把它算成"没问题"正是本队那条：**把没测到并进通过。**
     */
    checks.push({
      id: 'boundary',
      verdict: 'unmeasured',
      why: `契约里没有**具体产物路径**（inScope 全是目录级）⇒ "产物与 outOfScope 撞不撞"问不出来。`
        + `★ 而那不是"不冲突"，是"我判不了"（outOfScope: ${outOfScope.join(', ') || '空'}）`,
    })
  } else {
    checks.push({
      id: 'boundary',
      verdict: 'pass',
      why: `它的产物（${generated.join(', ')}）不与 outOfScope（${outOfScope.join(', ') || '空'}）冲突`,
    })
  }

  /**
   * ★★★ 总判：**一票否决 + 一票"我判不了"**
   *   有 `fail`        ⇒ `rejected`（★ 并指名哪一问）
   *   有 `unmeasured`  ⇒ ★ `needs-review`（**不盖章** —— 问不出来就不许并进通过）
   *   全 `pass`        ⇒ `passed`
   */
  const failed = checks.filter((check) => check.verdict === 'fail')
  const unmeasured = checks.filter((check) => check.verdict === 'unmeasured')
  const outcome = failed.length > 0 ? 'rejected' : unmeasured.length > 0 ? 'needs-review' : 'passed'
  return {
    outcome,
    checks,
    failedIds: failed.map((check) => check.id),
    unmeasuredIds: unmeasured.map((check) => check.id),
  }
}

/** 一条 acceptance 读起来是不是**恒真**的（对任何输入都成立）。 */
export function looksTautological(text) {
  if (typeof text !== 'string') return false
  /** ★ 只认"结构上恒真"的说法，而不是"我觉得不够具体"。 */
  /**
   * ★★ MEASURED（臂 11f 当场抓出来）：第一版写的是 `必须非空`（一个词），
   *   而真实的恒真断言写的是「必须**有非空**的 acceptance」—— 中间隔了一个字
   *   ⇒ 它**漏掉了**，而那正是"窄了会让恒真的漏过去"。
   *
   * ★ 修法：把"存在性"的说法写成**松一点**的几种形态，而**仍不碰**可判真假的那些
   *   （"一次定向突变能让它红" / "三态不同形" 都必须落 false）。
   */
  return /(必须存在|必须.{0,3}存在|不能为空|必须.{0,3}非空|不该.{0,3}为空|要有.{0,4}文件|不能什么都没有|必须有一个|不得为空|至少.{0,4}一个)/u.test(text)
}

/** 从契约里读"它会产出什么"（可比的具体路径）。★ 读不出来 ⇒ `[]`（**不编**）。 */
function generatedPathsOf(contract) {
  const paths = []
  for (const scope of Array.isArray(contract?.inScope) ? contract.inScope : []) {
    if (!scope.endsWith('/')) paths.push(scope)
  }
  return paths
}

/**
 * ── ★★★ 把审查**接进生成的每一步**（而不是生成之后一个可跳过的额外步骤）──────────
 *
 * @returns `{ status, contract?, review?, rejectedBecause?, scope }`
 *
 *     `status: 'executable'` + 契约带 `reviewed`  —— 审过了（★ 只有全 pass 才带）
 *     `status: 'executable'` 而**不带** `reviewed` —— 有一问问不出来 ⇒ 落到 needs-review
 *     `status: 'rejected'`   —— 审了而没过 ⇒ ★ **不产出可派契约**，产出退回理由
 *     `status: 'cannot-emit'` —— 契约本身就不完整（t95 那一格，保持不变）
 */
export function emitReviewedContract(proposal, options = {}) {
  const narrow = narrowScope(proposal, options)
  const emitted = emitTaskContract({ ...proposal, inScope: narrow.inScope }, options)
  if (emitted.status !== 'executable') return { ...emitted, scope: narrow }

  const contract = { ...emitted.contract }
  /** ★ 把**收窄的结论**交给审查 —— 否则它会把 coarse 读成细的（见那一格的长注释）。 */
  const review = adversarialReview(contract, narrow)
  if (review.outcome === 'rejected') {
    return {
      status: 'rejected',
      sourceId: proposal?.sourceId,
      scope: narrow,
      assignee: emitted.assignee,
      review,
      /** ★ 退回理由**指名哪一问没过** —— 而不是一句"审查没通过"。 */
      rejectedBecause: review.checks
        .filter((check) => check.verdict === 'fail')
        .map((check) => `${check.id}：${check.why}`),
    }
  }
  /**
   * ★★ `needs-review` 那一格**不盖章**：`reviewed` **不出现在契约里** ——
   *   于是它落到那条路由的"不带 reviewed ⇒ 先审一遍"上。
   *   ★ 而那正是"不许把没测到并进通过"在**契约形状**上的落点。
   */
  if (review.outcome === 'needs-review') {
    return { status: 'executable', sourceId: proposal?.sourceId, scope: narrow, assignee: emitted.assignee, contract, review }
  }
  return {
    status: 'executable',
    sourceId: proposal?.sourceId,
    scope: narrow,
    assignee: emitted.assignee,
    contract: {
      ...contract,
      /** ★★★ 那一格 —— 而 `checks` 逐条写着五问的结果（不是一句"已审查"）。 */
      reviewed: {
        at: new Date(options.now ?? Date.now()).toISOString(),
        by: 'adversarial',
        checks: review.checks.map((check) => ({ id: check.id, verdict: check.verdict, why: check.why })),
      },
    },
    review,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑩ ★★★ t97：路由 —— 带 `reviewed` 放行；不带 ⇒ 先审一遍
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 用户原话的机械化：「带 reviewed ⇒ 放行；不带 ⇒ 必须先审一遍才能派」。
 *
 * ★ 而"不带"**不是错误** —— 它是"这条路没走自动生成"的正常状态。
 * ⇒ 三态，且不许合并：
 *
 *     `reviewed`      —— 盖章了（★ 附逐条 checks）
 *     `needs-review`  —— ★ **没走自动生成那条路**，或审了而有一问问不出答案
 *     `rejected`      —— 审了而**没过**（附哪一问）
 */
export function reviewStateOf(contract) {
  if (contract?.reviewed !== undefined && typeof contract.reviewed === 'object') {
    const checks = Array.isArray(contract.reviewed.checks) ? contract.reviewed.checks : []
    return {
      state: 'reviewed',
      why: `在 ${String(contract.reviewed.at)} 由 ${String(contract.reviewed.by)} 审查通过，`
        + `五问逐条：${checks.map((c) => `${c.id}=${c.verdict}`).join(' · ')}`,
    }
  }
  return {
    state: 'needs-review',
    why: '★ 这条契约**没有 reviewed 那一格** ⇒ 它没走自动生成那条路（问过用户、用户裁决过的），'
      + '或者生成时有一问问不出答案。⇒ **派之前必须先审一遍**。★ 而它**不是错误**。',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ ★★★ 缺口 B：把提案变成**可直接执行**的派发指令（t95）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 它补的是什么（用户原话，而这是它的正解）──────────────────────────────────
 *
 * > 「卡点和经验的分类、派发我们不是都做了吗…怎么每次都要来问我，
 * >   没感受到有自动派发部分」
 *
 * ★ 核实之后：**分类是自动的**，而「从分类到建任务」之间是 captain 的**手动一步**。
 *   ⇒ 缺的不是分类，是**那一格的可执行性**。
 *
 * ── ★★★ 而"可执行"的确切标准：能直接喂给 `agent_teams_create_task` ──────────────
 *
 * 那意味着**必填项一个不缺**（从 `create_task` 的 schema 读出来的，不是猜的）：
 *
 *     subject      必填（非空）
 *     kind         质量类必须有 contract（objective + acceptance）
 *     objective    质量类必填
 *     acceptance   质量类必填
 *     verify       implementation / repair 必填
 *     inScope      本队口径：只列**源文件**（`lib/` 由 build 生成）
 *
 * ★ 而缺任何一项时**不猜**：如实报 `cannot-emit` 并说出**缺什么** ——
 *   那是第三态，与"可派 / 不可派"不同形。
 */
export const EXECUTABLE_KINDS = Object.freeze(['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'])

/** 需要 `objective` + `acceptance` 的那些 kind（质量类）。 */
export const QUALITY_KINDS = Object.freeze(['requirements', 'implementation', 'verification', 'review', 'repair', 'integration'])
/** 需要 `verify` 的那些 kind。 */
export const VERIFY_REQUIRED_KINDS = Object.freeze(['implementation', 'repair'])

/**
 * ── 把一个提案变成**一份完整的任务契约** ────────────────────────────────────────
 *
 * @returns `{ status: 'executable', contract, assignee, reasons }`
 *        或 `{ status: 'cannot-emit', missing: [...] }`  ← ★ 第三态
 *
 * ★ 而"缺什么"是**逐项列出来的**，不是一句"信息不足"：
 *   读的人要能直接去补那一项，而不是再来问一次。
 */
export function emitTaskContract(proposal, options = {}) {
  const { members = [], tasks = [], now = Date.now(), unreadable } = options
  const missing = []

  const subject = typeof proposal?.subject === 'string' ? proposal.subject.trim() : ''
  if (subject === '') missing.push('subject（create_task 必填且非空）')

  const objective = typeof proposal?.objective === 'string' ? proposal.objective.trim() : ''
  const kind = typeof proposal?.kind === 'string' ? proposal.kind : undefined
  /**
   * ── ★★ 产物形状 ⇒ `create_task` 的 kind ─────────────────────────────────────────
   *
   * `gate` 与 `fixture-helper` 是**产物的形状**（t65 的口径），而它们都不是
   * `create_task` 认得的类别。⇒ 映射要逐个说清理由：
   *
   *   `gate`            ⇒ **implementation**（要写一条判据 + 它的夹具，要验收）
   *   `fixture-helper`  ⇒ **implementation**（要写一个夹具辅助库，同样要验收）
   *
   * ★ 而**不是** `work`：`work` 是"没有质量门"的类别，而这两者都有产物要验收。
   *   映成 `work` 会让那些判据**没有验收标准**就建出去 ——
   *   而那正是本队记账过的"建了一个没人检查的任务"。
   *
   * ★ 映射认得的形状**不算缺**；而一个既不认得、也不在 `EXECUTABLE_KINDS` 里的
   *   ⇒ 如实报缺（**不猜**：猜一个 kind 会让建出来的任务类别是假的）。
   */
  const SHAPE_TO_KIND = { gate: 'implementation', 'fixture-helper': 'implementation' }
  const createKind = kind !== undefined && SHAPE_TO_KIND[kind] !== undefined ? SHAPE_TO_KIND[kind] : kind
  if (kind === undefined) missing.push('kind（提案没给出任务类别）')
  else if (createKind === undefined || !EXECUTABLE_KINDS.includes(createKind)) {
    missing.push(`kind（"${kind}" 不是 create_task 认得的类别，也不在已知的产物形状里）`)
  }
  const acceptance = Array.isArray(proposal?.acceptance) ? proposal.acceptance : []
  if (createKind !== undefined && QUALITY_KINDS.includes(createKind) && acceptance.length === 0) {
    missing.push(`acceptance（kind=${createKind} 是质量类，create_task 要求非空）`)
  }
  if (createKind !== undefined && QUALITY_KINDS.includes(createKind) && objective === '') {
    missing.push(`objective（kind=${createKind} 是质量类，create_task 要求非空）`)
  }

  const verify = Array.isArray(proposal?.verify) ? proposal.verify : []
  if (createKind !== undefined && VERIFY_REQUIRED_KINDS.includes(createKind) && verify.length === 0) {
    missing.push(`verify（kind=${createKind} 要求给出验证命令）`)
  }

  const inScope = Array.isArray(proposal?.inScope) ? [...proposal.inScope] : []
  if (inScope.length === 0) missing.push('inScope（没有写域 ⇒ 建出来的任务没人能判断改动范围）')

  if (missing.length > 0) return { status: 'cannot-emit', sourceId: proposal?.sourceId, missing }

  /**
   * ★ `outOfScope` 是**从 inScope 反推**的：本队口径里 `lib/**` 由 build 生成
   *   ⇒ 一个声明了 `src/**` 的任务**必须**同时声明它不许手改 `lib/**`
   *   （那是 `contract.build-artifact-scope` 那条判据的口径）。
   */
  const outOfScope = Array.isArray(proposal?.outOfScope) && proposal.outOfScope.length > 0
    ? [...proposal.outOfScope]
    : (inScope.some((scope) => scope === 'src' || scope.startsWith('src/')) ? ['lib/'] : [])

  const assignee = recommendAssignee(proposal, { members, tasks, now, unreadable })

  return {
    status: 'executable',
    sourceId: proposal?.sourceId,
    contract: {
      subject,
      description: proposal?.because ?? '',
      kind: createKind,
      objective,
      inScope,
      ...outOfScope.length === 0 ? {} : { outOfScope },
      ...acceptance.length === 0 ? {} : { acceptance },
      ...verify.length === 0 ? {} : { verify },
      ...assignee.member === undefined ? {} : { assignee: assignee.member },
    },
    /** ★★ 派工建议**连同它的理由**一起给出（见 `recommendAssignee`）。 */
    assignee,
  }
}

/**
 * ── ★★★ 派工建议 —— 而它必须给出【可核的理由】────────────────────────────────────
 *
 * 契约原文：「不给理由的建议，与一条『请自己挑』在观测上同形。」
 *
 * ⇒ 三问，而每一问都有一个**可核的读数**（不是形容词）：
 *
 *   ① **为什么是这个成员** ⇒ 他的**既往写域**与这条任务的写域**重不重叠**。
 *      ★ 那是可核的：`team.json` 里他做过的任务的 `inScope` 是**事实**，
 *        不是"我觉得他擅长这个"。
 *   ② **为什么现在** ⇒ 他 `status === 'idle'`（**此刻**空闲），而写域**没人占**。
 *   ③ **为什么这条而不是那条** ⇒ 它在清单里的位置 + 是否解锁了别的条目。
 *
 * ★★ 而**匹配不上时不硬凑**：给 `member: undefined` 并说清"没有谁的履历碰得上它"——
 *   那比"随便挑一个空闲的"诚实，而后者正是契约点名要避免的。
 */
export function recommendAssignee(proposal, { members = [], tasks = [], now = Date.now(), unreadable } = {}) {
  const reasons = []
  const scopes = Array.isArray(proposal?.inScope) ? proposal.inScope : []

  /**
   * ── ★★★ 第一格：**团队读不到** —— 而那与"没人空闲"完全不同形 ──────────────────
   *
   * MEASURED（t95 第一版）：团队读不到时我原来答的是"没有空闲成员（0 人…）"
   * ⇒ 那把它伪装成了"我看了，确实没人" —— 而事实是**我没能看**。
   * ★ 两者的补救动作相反：一个去等人腾出来，一个去修那格读数（或补 `--team`）。
   * ★ 与全库那条纪律同形：「我没能读」与「读了、是空的」不同形。
   */
  if (unreadable !== undefined) {
    return {
      member: undefined,
      /** ★ 它**不说**"谁空闲"（那是编的）；它说清"我没能看"。 */
      reasons: [
        `★ **我没能读到团队状态**（${unreadable}）⇒ 派工建议**无法给出**`
        + '—— 那不是"没人空闲"，是"我没有可核的依据"。',
        '★ 而那正是本队在避的那个形态：**把基础设施工况伪装成关于数据的结论。**',
      ],
      whyNot: {},
      unreadable: true,
    }
  }

  /** ① 谁此刻空闲。★ 而"空闲"是**读到的状态**，不是假设。 */
  const idle = members.filter((member) => member?.status === 'idle')
  const busy = members.filter((member) => member?.status !== 'idle')
  if (members.length === 0) {
    /**
     * ★ 团队**读到了，而里面一个人都没有** —— 与上一格不同形（那是"读不到"）。
     *   ⇒ 如实说"这份团队状态里没有成员"，而不是"大家都忙"。
     */
    return {
      member: undefined,
      reasons: ['★ 团队状态**读到了**，而里面**没有成员** ⇒ 无从建议（★ 那与"读不到"不同形）'],
      whyNot: {},
    }
  }
  if (idle.length === 0) {
    return {
      member: undefined,
      reasons: [`没有空闲成员（${members.length} 人全部在不 idle 的状态）⇒ **现在不该派**，等人腾出来`],
      whyNot: {},
    }
  }
  reasons.push(`空闲成员 ${idle.length}/${members.length}（${idle.map((m) => m.name).join(', ')}）`)

  /**
   * ② 每个候选的**履历重叠度** = 他在既往任务里声明过的写域，与本条写域重叠几次。
   *   ★ 那是"专长匹配"的可核形式 —— 而它与"角色标签"不同形：
   *     角色是**声明**，既往写域是**做过的事**。
   */
  const scored = idle.map((member) => {
    const past = tasks.filter((task) => task?.assignee === member.name)
    const overlaps = []
    for (const task of past) {
      for (const scope of task.inScope ?? []) {
        if (scopesOverlap([scope], scopes)) overlaps.push(`${task.id}:${scope}`)
      }
    }
    return { member, overlaps, pastCount: past.length }
  })
  scored.sort((a, b) => b.overlaps.length - a.overlaps.length || b.pastCount - a.pastCount)

  const best = scored[0]
  const whyNot = {}
  for (const candidate of scored.slice(1)) {
    whyNot[candidate.member.name] = candidate.overlaps.length === 0
      ? `他的既往写域（${candidate.pastCount} 个任务）与这条**不重叠**`
      : `他的重叠（${candidate.overlaps.length} 条）少于 ${best.member.name}（${best.overlaps.length} 条）`
  }
  for (const member of busy) whyNot[member.name] = `★ 此刻不空闲（status=${member.status}）`

  if (best.overlaps.length > 0) {
    reasons.push(
      `★ 履历重叠 ${best.overlaps.length} 条（可核：${best.overlaps.slice(0, 3).join(' · ')}）`
      + '—— 他的**既往任务声明过同一片写域**，那是“专长匹配”的可核形式（不是角色标签）',
    )
  } else {
    /**
     * ★★ **匹配不上时如实说** —— 而这是本函数最要紧的一格。
     *   契约点名要避免的正是"随便一个空闲的"：那与"请自己挑"在观测上同形。
     */
    reasons.push(
      '★★ **没有谁的既往写域碰得上它** —— 所以这条建议只是"谁现在空闲"，'
      + '而不是"谁擅长它"。★ 若这条要人，请在派的时候补一句为什么是他。',
    )
  }
  reasons.push(`为什么是现在：这条的写域**没人占**（否则它根本不在这份清单里）`)

  return {
    member: best.member.name,
    reasons,
    whyNot,
    /** ★ 便于机器读：重叠条数与它是否**真的**匹配得上。 */
    groundedInTrackRecord: best.overlaps.length > 0,
  }
}

/**
 * ── ★★★ t98：按面分档 —— 而它现在是【可复用的单一真值】────────────────────────────
 *
 * 用户原话（逐字）：
 *
 *   「1. 小货的处理：如果判断出来不需要我来做裁决，你就可以自己去走那条自动路。
 *     生成完内容后，审一遍，找机会就可以直接派了。
 *    2. 大货的处理：大货是不应该直接派的。需要我裁决的就留下来，等问完我的意见、
 *     裁决完之后，你再生成、审查，然后才能派货。因为我们之前做的是那种原子化拆解的
 *       审查（或者说是门禁），所以派出的不应该有大活。」
 *
 * ⇒ ★ 所以 `dispatchable` 的准入条件从两条变成【三条】：
 *
 *     ① `to-dispatch`（值得做）   ② 审查通过（带 `reviewed`）   ③ ★ 分档是**小档**
 *
 * ★★ 而 ③ 的实现放在**这里**，而不是放在 `plan-review-tier.test.mjs` 里 ——
 *   理由是**单一真值**：那条判据的装置与这条判据的准入必须读**同一份**分档，
 *   否则两份会分叉（而分叉之后，"判据说它大、而派发池把它放出去了"在日志里同形）。
 *
 * ★ 所以 `plan-review-tier.test.mjs` 从这个文件 **import** 那条函数 ——
 *   它是 t93 判据的装置，而这里用它来守门。**一处实现，两处使用。**
 */
export const TIER = {
  small: 'small',
  large: 'large',
  unmeasurable: 'unmeasurable',
}

/** 会新建或重组一个目录的写法：`src/foo/` —— 以斜杠结尾。 */
const DIRECTORY_ENTRY = /\/\s*$/

/**
 * 要求"重组/搬运已有代码"的动词。
 *
 * ★ 判据**不是**"objective 里出现了这些字"，而是
 *   「出现这些字 **且** 要搬的东西**已经存在**」——
 *   后者是可判定的（问文件系统），而前者只是措辞。
 */
const REORG_VERB = /拆|搬|重组|抽取|迁移|合并|split|extract|move|merge/i

/** `inScope` 里指向源码的文件条目（不含目录条目）。 */
function tierSourceFiles(inScope) {
  return inScope.filter((path) => /^src\//.test(path) && !DIRECTORY_ENTRY.test(path))
}

/** `inScope` 里的**目录条目**（= 会新建/重组一个目录）。 */
function tierDirectoryEntries(inScope) {
  return inScope.filter((path) => /^src\//.test(path) && DIRECTORY_ENTRY.test(path))
}

/** 缺省的存在性判断（真实磁盘，相对本脚本所在处）。 */
function defaultTierExists(relativePath) {
  try {
    return existsSync(new URL(`../${relativePath}`, import.meta.url))
  } catch {
    return false
  }
}

/**
 * ── 分档（三条信号，而它们**不是同一条**）─────────────────────────────────────────
 *
 *   A：`inScope` 跨**多个现有源码文件**     ← t54（6 个文件、跨两组）
 *   B：`inScope` 含**目录条目**            ← t70（`src/tools/update-task/`）
 *   C：重组词 **且** 要搬的东西**已存在**    ← t39 / t30
 *
 * ★ 数的是 `src/` 下的文件，**不是 `inScope` 的条目数** ——
 *   契约指名的小档正例 t88 有 3 个文件而零个 `src/`（它不碰生产接线）。
 *
 * @param contract - 任何带 `inScope` / `objective` 的对象（提案或任务都行）
 * @param options.exists - 判断"那个文件现在在不在"（注入，便于夹具不依赖真实磁盘）
 */
export function tierOf(contract, { exists = defaultTierExists } = {}) {
  const inScope = Array.isArray(contract?.inScope) ? contract.inScope.map(String) : undefined
  const objective = typeof contract?.objective === 'string' ? contract.objective : ''

  /** ★ 前提：没有 inScope ⇒ 判不了（它是判据唯一的输入）。 */
  if (inScope === undefined) {
    return { tier: TIER.unmeasurable, why: 'the contract carries no inScope, so its surface cannot be read at all', signals: {} }
  }
  /** ★ 空 inScope 也一样：它没说改什么（而"没说"不是"很小"）。 */
  if (inScope.length === 0) {
    return { tier: TIER.unmeasurable, why: 'inScope is present but empty — an empty scope is not a small surface, it is an unstated one', signals: {} }
  }

  const files = tierSourceFiles(inScope)
  const dirs = tierDirectoryEntries(inScope)
  const existing = files.filter((path) => { try { return exists(path) } catch { return false } })

  const signals = {
    /** A：跨多个现有源码文件。 */
    multipleFiles: files.length >= 2,
    /**
     * ── B：含**一个还不存在的**目录条目 ⇒ 它会【新建】一个目录 ──────────────────
     *
     * ★★ 这里我第一版写宽了，而它当场打红了**两条已有的臂**（MEASURED，本任务）：
     *   第一版的条件是"含任何目录条目"—— 于是默认夹具的
     *   `inScope: ['scripts/', 'src/gates/']` 被判成大档，因为 `src/gates/` 以斜杠结尾。
     *   ★ 而 `src/gates/` 是一个**已经存在**的目录：进它下面写文件**不是"重组"**。
     *
     * ⇒ 正确的口径：那个目录**此刻还不存在**（`!exists(dir)`）。
     *   ★ 而那正是 t70 的形状：`src/tools/update-task/` 是**要新建的**
     *     （拆分的目标），而 `src/gates/` 本来就在。
     *   ⇒ ★ "会新建一个目录"与"往一个现成目录里写文件"是**两件事**，
     *     而只有前者意味着搬运风险。
     */
    restructuresDirectory: dirs.filter((path) => { try { return !exists(path) } catch { return false } }).length > 0,
    /** C：要求重组，**且**要搬的东西**已经存在**（那才是"搬运已有代码"）。 */
    movesExistingCode: REORG_VERB.test(objective) && existing.length >= 1,
  }

  if (signals.multipleFiles || signals.restructuresDirectory || signals.movesExistingCode) {
    const reasons = []
    if (signals.multipleFiles) reasons.push(`it spans ${files.length} existing source files`)
    if (signals.restructuresDirectory) reasons.push(`it declares directory entr(ies) ${dirs.join(', ')} — it creates or restructures a directory`)
    if (signals.movesExistingCode) reasons.push('its objective asks to split/move/restructure and the things to be moved are already in its scope')
    return {
      tier: TIER.large,
      why: reasons.join('; '),
      /** ★ 而它要的是**哪一种**审查 —— 那是分档的输出。 */
      review: 'plan-review',
      reviewWhy: 'its risk is not in the edit itself but in the split: what gets moved and what gets left behind',
      signals,
      /** ★★ 而它【卡在哪一问上】—— 用户裁决时需要知道它大在哪，不许只给一个"大"字。 */
      blockingQuestion: reasons[0],
      /** ★ 而拆解的实质是：这条大活得先被拆到原子级，才可能进派发池。 */
      nextStep: 'decompose',
    }
  }

  return {
    tier: TIER.small,
    why: `a single existing source file (${files.join(', ') || 'none'}) with no directory entry and no move of existing code`,
    review: 'adversarial-review',
    reviewWhy: 'getting it wrong cannot affect anything else — one file, no rewiring',
    signals,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑪ ★★★ t113：分档 ⇒ 拆解（**P3 填本体**；在此之前是明写的 unmeasured）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 用户原话（这条阶段存在的理由，逐字）─────────────────────────────────────────
 *
 *   「一开始都是去对符合条件的任务产出契约之类的东西，然后可能有的契约根据一些
 *     判定认为不符合原子化的条件，那就得去拆」
 *
 * ⇒ ★ 所以"拆解"不是一条错误路径，而是**大档的正常下一步**。
 *
 * ── ★★★ 而它此刻**还没有实现** —— 那是 P3 的任务，不许在这里假装有 ──────────────
 *
 * 本任务（P1）的边界逐字写着：「本任务**只做骨架与阶段化**，`decompose` 本体由 P3 填」。
 *
 * ★★ 所以这里返回 `decomposed: false` + `status: 'unmeasured'`，
 *   而**不是**一个空数组、也不是"拆成一条 = 原样"：
 *
 *     返回 []                       ⇒ "拆完了，一条也不用做" —— 一个**编出来的结论**
 *     返回 [原提案]                 ⇒ "拆完了，还是这一条" —— 于是大活**从拆解里溜进 ready**
 *                                      （★ 那正是"派出的不应该有大活"要防的那件事）
 *     返回 unmeasured（本实现）      ⇒ "我还没学会怎么拆" —— ★ 而它的补救动作是【填 P3】，不是裁决
 *
 * ── ★ 而那与主干上的"大档"**不同形**（两格、两句话、两个补救动作）───────────────
 *
 *     decompose 没实现（unmeasured）  ⇒ 人**什么都补不了**，要去填 P3（补**能力**）
 *     分档判不了（unmeasurable）      ⇒ 人**补 inScope**（补**信息**）
 *     大档                            ⇒ 人**裁决**（拍板"这么拆行不行"）
 *
 * ── ★★★ P3 落地：拆解器本体（**纯机械、零 token**）────────────────────────────────
 *
 * 上一版在这里返回 `unmeasured`（"我还没学会"）。P3 把那一条填上了，而**填法**是本任务
 * 的实质：它**不许调用模型**，只按 `tierOf` 已有的**三条信号**切边界。
 *
 * ── 为什么"三条信号"就是拆法的全部依据（而不是另找一套判据）────────────────────
 *
 *   `tierOf` 判"大"用的正是这三条（`signals` 那一格），所以**拆解要消灭的也正是它们**：
 *
 *     A `multipleFiles`         ⇒ 跨 ≥2 个现有文件 ⇒ 按**文件**切（一个子活一个文件）
 *     B `restructuresDirectory` ⇒ 要新建/重组目录 ⇒ **目录**那一条单独成子活（它是搬运）
 *     C `movesExistingCode`     ⇒ 要搬已有代码   ⇒ 搬与被搬**分开**（否则它还是"搬"）
 *
 *   ★ 拆完**每条子活**该落在小档 —— 而那正是可判定的成功条件（见 `decomposeContract`
 *     与下面那个 `verifyChildrenAreAtomic`）：**拆法自己也要能被 `tierOf` 判小。**
 *     ⇒ 于是"拆得对不对"不是一个主观问题，而是"子活过不过得了同一条 `tierOf`"。
 *
 * ── ★★★ 而这条实现里最要紧的一条纪律：【拆不动时留在队列并指名哪一问】─────────────
 *
 *   绝不静默降级成一个大任务。所以下面每一个"我不拆"的出口都带 `blockingQuestion`
 *   （从 `tier.blockingQuestion` 来）与 `missing`（缺什么），而**都不产出 children**
 *   ⇒ 于是它落回主干那条 `awaitingRuling`（有人要裁决），**不会**并进 ready。
 *
 * ── ★ 递归上限 2 层 ────────────────────────────────────────────────────────────
 *
 *   `depth` 由主干传进来（`runStages` 的 `depth`）。到 `MAX_DECOMPOSE_DEPTH` 就不再往下拆
 *   —— 而**超限不是错误**，它是一个读数：那些子活**留在队列**（`awaitingRuling`），
 *   因为"再拆一层"这件事需要人拍板（或者说明这条活本身不该被拆）。
 */
export const MAX_DECOMPOSE_DEPTH = 2

/**
 * 把一条大活按 `tier.signals` **机械地**切成子提案。
 *
 * ★ 它是纯函数：同样的 (tier, contract, depth) 给出同样的结果，**不读盘、不调模型**。
 *   （存在性只经由 `tier.signals` 进来 —— 那是 `tierOf` 已经读过的结论。）
 */
export function mechanicalDecompose({ tier, proposal, depth = 0, exists = defaultTierExists }) {
  /** ★ 信号 B 要问"这个目录此刻存在吗" —— 与 `tierOf` 用的是**同一个** `exists`。 */
  const existsForSignals = exists
  const contract = proposal ?? {}
  const inScope = Array.isArray(contract?.inScope) ? contract.inScope.map(String) : []
  const files = tierSourceFiles(inScope)
  const dirs = tierDirectoryEntries(inScope)

  /**
   * ── 递归上限 ────────────────────────────────────────────────────────────────
   *
   * ★ 到顶了 ⇒ **不产出 children**（于是主干落 `awaitingRuling` ⇒ 子活**留在队列**），
   *   而理由要说清是"到顶"而不是"我不会"（两者的补救动作不同）。
   */
  if (depth >= MAX_DECOMPOSE_DEPTH) {
    return {
      status: 'unmeasured',
      why: `递归到第 ${depth} 层（上限 ${MAX_DECOMPOSE_DEPTH}）⇒ 不再往下拆。`
        + '★ 这不是"拆不了"，而是"再拆一层要人拍板" —— 子活**留在队列**，'
        + '不许静默当成一条大活派出去。',
      missing: [`★ 递归上限（第 ${depth} 层 / 上限 ${MAX_DECOMPOSE_DEPTH}）`],
      blockingQuestion: tier?.blockingQuestion,
    }
  }

  /**
   * ── 切边界：按信号逐条来 ──────────────────────────────────────────────────────
   *
   * ★ 顺序有理由：**目录那一条最先**（它是搬运，而搬运是这三条里唯一"会移动已有代码"的）
   *   —— 若把它并进某个文件的子活，那条子活仍然含"重组"，拆完还是大档。
   */
  const children = []
  /**
   * ── ★★★ 信号：**从 `tier.signals` 读**，而 `tier` 没给时**自己按同一条口径推** ──────
   *
   * ⚠️ MEASURED（P3 当场抓出来）：第一版**只读 `tier.signals`** ⇒ 一条手工构造的 tier
   *   （`{ tier:'large', why:'…' }`，没有 `signals`）会让拆解器答"三条信号一条都不成立"
   *   —— 而**那是错的读数**：拆解器明明能从写域自己看出信号 A。
   *
   *   ★ 而它的形态是本队记账过的那条：**把"上游没给这一格"读成了"这一件事实不成立"。**
   *     （"我没拿到读数"与"读数是零"合流 —— 而两者的补救动作相反。）
   *
   * ⇒ 修法：`tier.signals` 在场就**以它为准**（那是分档亲眼读到的，最新鲜）；
   *   不在场时**按 `tierOf` 的同一条口径从写域推**（同样的三个判断、同一份 `exists`）。
   *   ★ 而推的时候必须用**同一套 helper**（`tierSourceFiles`/`tierDirectoryEntries`）
   *     —— 各写一遍会让两处在下一次改动时对同一份写域给出不同的信号。
   */
  const signals = tier?.signals ?? {
    multipleFiles: files.length >= 2,
    restructuresDirectory: dirs.some((path) => { try { return !existsForSignals(path) } catch { return false } }),
    movesExistingCode: REORG_VERB.test(String(contract?.objective ?? '')) && files.length >= 1,
  }
  const base = {
    sourceId: contract?.sourceId,
    kind: contract?.kind,
    objective: contract?.objective,
    acceptance: contract?.acceptance,
    verify: contract?.verify,
  }

  if (signals.restructuresDirectory === true) {
    for (const dir of dirs) {
      children.push({
        ...base,
        sourceId: `${String(contract?.sourceId ?? 'proposal')}#dir:${dir}`,
        inScope: [dir],
        subject: `重组目录 ${dir}（只做搬运，不改行为）`,
        objective: `把 ${dir} 这一处目录重组落地：只搬运，不改行为。`
          + '★ 它是拆出来的一条**搬运**子活 —— 而"搬"与"改"分开，正是为了让这条能单独被审。',
      })
    }
  }

  if (signals.multipleFiles === true) {
    for (const file of files) {
      children.push({
        ...base,
        sourceId: `${String(contract?.sourceId ?? 'proposal')}#file:${file}`,
        inScope: [file],
        subject: `改 ${file}`,
        objective: `只改 ${file} 这一个文件。`
          + '★ 它是拆出来的一条**单文件**子活 —— 一条子活一个文件，'
          + '于是 `tierOf` 对它判小（信号 A 不再成立）。',
      })
    }
  }

  /**
   * ★ 而 C（`movesExistingCode`）**没有单独的子活** —— 它由上面两条**消掉**：
   *   搬运落在目录那条子活里，而"改"落在单文件那几条里。
   *   ⇒ 于是每一条子活的任务语里都不再含"拆/搬/重组"（见下面 `verifyChildrenAreAtomic`）。
   *
   * ★ 而若三条信号一条都不成立 ⇒ **那不是大档**（`tierOf` 不会这么判）⇒ 如实报"形不一致"，
   *   而不是编一个空拆法出来。
   */
  if (children.length === 0) {
    return {
      status: 'unmeasured',
      why: '这条提案被判大档，而它的三条信号**一条都不成立** ⇒ 拆解器读不懂它大在哪。'
        + '★ 不产出子活：编一个空拆法出来会把"我不懂"伪装成"拆完了"。',
      missing: ['★ 大档的三条信号（multipleFiles / restructuresDirectory / movesExistingCode）一条都不成立'],
      blockingQuestion: tier?.blockingQuestion,
    }
  }

  /**
   * ★★ 拆完**自检**：每一条子活都必须**真的比原来小**。
   *
   * ── ★★★ 而"小"在这里的定义必须精确 —— 我第一版写错了，被自己的自检当场打红 ──────
   *
   *   第一版判据是"子活必须被 `tierOf` 判**小档**"。而它**必然**拒掉目录那条子活：
   *
   *     src/newdir/ 这条子活 ⇒ `tierOf` 仍判 large，因为**信号 B 还在**
   *     （`restructuresDirectory` 正是"声明了一个不存在的目录条目"）
   *
   *   ⇒ ★ 而那不是子活的毛病：**"重组一个目录"这条活，说它自己大不大是没意义的** ——
   *     它是**搬运**，而搬运的风险在于"搬了什么、漏了什么"，不在于面有多宽。
   *     ⇒ 所以用 `tierOf` 的档位去判它，等于**拿一把量宽度的尺去量一件关于顺序的事**。
   *     本队记过这条：**拿一个不是那个东西的量，去断言那个东西的性质。**
   *
   * ── 正确的判据：拆解要消灭的是【原提案那几条信号】，而不是"让每一条都变小档" ──
   *
   *   逐条对：
   *     · 信号 A（跨 ≥2 文件）⇒ 子活**一个文件** ⇒ ★ A 消失（可核：`files.length === 1`）
   *     · 信号 B（新建/重组目录）⇒ 子活含**恰好一个**目录条目 ⇒ ★ B 收敛到"一条搬运"
   *       （可核：目录条目数 = 1），而那条搬运**本身**就是原子的 —— 它不再需要"拆"
   *     · 信号 C（搬已有的东西）⇒ 拆完每条子活**只剩一种动作**（要么搬、要么改）
   *
   *   ★ 而"子活仍被判大档"**不是失败**，只要它大的原因是**已经收敛的那一条**
   *     （即：它的信号集**严格小于**原来的）。⇒ 所以判据是**信号集合的真包含**，
   *     而它同样是机械的、可核的。
   */
  const originalSignalCount = [signals.multipleFiles, signals.restructuresDirectory, signals.movesExistingCode]
    .filter(Boolean).length

  /**
   * 一条子活是否**真的收敛了**：它的信号集合是原来的**真子集**。
   *
   * ★ 逐条说清（与上面那段一一对应）：
   *   · A 消失 ⇒ 它只碰一个文件（`files.length <= 1`）
   *   · B 收敛 ⇒ 它最多声明一个目录条目（`dirs.length <= 1`）—— 而那一格就是"一次搬运"
   *   · C 消失 ⇒ 它的写域里**要么只有目录条目、要么只有文件**（不同时）
   *     ⇒ 那正是"搬"与"改"分开的机械形式
   */
  const converges = (child) => {
    const scope = Array.isArray(child?.inScope) ? child.inScope.map(String) : []
    const childFiles = tierSourceFiles(scope)
    const childDirs = tierDirectoryEntries(scope)
    const childSignals = {
      multipleFiles: childFiles.length >= 2,
      restructuresDirectory: childDirs.length > 1,
      movesExistingCode: childFiles.length > 0 && childDirs.length > 0,
    }
    const childCount = Object.values(childSignals).filter(Boolean).length
    return childCount < originalSignalCount
  }

  const notConverged = children.filter((child) => !converges(child))
  if (notConverged.length > 0) {
    return {
      status: 'unmeasured',
      why: `拆出来的 ${notConverged.length} 条子活**没有收敛**（信号没有变少，例如 `
        + `${String(notConverged[0]?.inScope?.[0] ?? '(无写域)')}）⇒ 这次拆解没消灭大档。`
        + '★ 不许并进 ready：那只是把大活换了个名字。',
      missing: ['★ 一个能让每条子活的信号集合【真包含于】原提案的拆法'],
      blockingQuestion: tier?.blockingQuestion,
    }
  }

  return { status: 'decomposed', children }
}

/**
 * 缺省拆解器 —— **零 token、纯机械**。
 *
 * ★ 它是 `decompose` 的缺省 `decomposer`。而 `options.decomposer` 仍可覆盖它
 *   （夹具要喂"故意坏掉"的拆解器去跑那两道非法拆法的闸门，见 `decomposeContract`）。
 */
function defaultDecomposer({ tier, proposal, depth }) {
  const outcome = mechanicalDecompose({ tier, proposal, depth })
  /**
   * ★ 三态翻译：**只有 `decomposed` 才交出 children**。
   *   `unmeasured` ⇒ **不给料**（`undefined`），于是 `decompose` 那一层如实落 unmeasured
   *   ⇒ 主干落 `awaitingRuling` ⇒ 子活留在队列。
   *   ★ 而"给了料却自称 unmeasured"那条形不一致，`decomposeContract` 会拒 —— 这里不走那条路。
   */
  return outcome.status === 'decomposed' ? outcome.children : undefined
}

/**
 * 缺省拆解器**为什么**答 unmeasured —— 与 `defaultDecomposer` 读的是同一件事。
 *
 * ★ 为什么要单列一个：`decompose` 那一层只拿得到 children（`undefined`），拿不到原因。
 *   而原因**必须**往上走 —— 见 `decompose` 里那段"三种情形不许合流成一句"。
 * ★ 而它与 `defaultDecomposer` **共用 `mechanicalDecompose`** ⇒ 两者不会分叉
 *   （若各写一遍判断，它们会在下一次改动时对同一份料给出不同的解释）。
 */
function defaultDecomposerReason({ tier, proposal, depth }) {
  const outcome = mechanicalDecompose({ tier, proposal, depth })
  return outcome.status === 'decomposed' ? undefined : outcome
}

export function decompose(tier, proposal, { depth = 0, decomposer } = {}) {
  /**
   * ── ★★ 而"拆解器"是**注入**的（`options.decomposer`）────────────────────────────
   *
   * ★ 理由与 `tierOf` 的 `options.exists` **同源**：一个不注入的本体在夹具里只能用
   *   真实磁盘 / 真实拆解器去测 ⇒ 而 P3 之前那个本体**不存在**
   *   ⇒ 下面两道"非法拆法"的闸门会**够不着**（而那与"守住了"同形）。
   *
   * ★★★ 所以这一格让夹具能喂进一个**故意坏掉**的拆解器（拆出 0 条 / 原样还回来），
   *   从而把闸门**真的跑一遍**。★ 而缺省（没有注入）仍然是那条诚实的 unmeasured。
   */
  const children = typeof decomposer === 'function'
    ? decomposer({ tier, proposal, depth })
    : defaultDecomposer({ tier, proposal, depth })
  /**
   * ★★ 而"给了料"⇒ 自报就该是 `decomposed`（而不是那条"我还没学会"）——
   *   否则下游会读到一句与料对不上的话（`decomposeContract` 那一道"形不一致"会拒掉它）。
   *   ★ 而"没给料"⇒ 那条诚实的 `unmeasured`。
   */
  const decomposed = children !== undefined
  /**
   * ── ★★★ P3：`unmeasured` 时，**理由必须来自拆解器自己**，不是这里替它编一句 ────────
   *
   *   缺省拆解器（`defaultDecomposer`）在三种情形下答 unmeasured，而它们的补救动作相反：
   *   ① 递归到顶 ② 三条信号一条都不成立 ③ 拆出来没收敛。
   *   ⇒ 若这里统一写一句"我还没学会"，那三种就**合流**成一句 —— 而读的人会去补 P3
   *     （那已经填好了），真正的那一条永远读不到。
   */
  const reason = decomposed ? undefined : defaultDecomposerReason({ tier, proposal, depth })
  return {
    decomposed,
    status: decomposed ? 'decomposed' : 'unmeasured',
    depth,
    /** ★ 而拆解器给了料（哪怕那料是坏的）⇒ 它**必须**被下游看见（见 `decomposeContract`）。 */
    ...decomposed ? { children } : {},
    /**
     * ★ 而"缺什么"要**逐项**说清（`cannot-emit` 的 `missing` 用同一套口径）——
     *   读的人要能直接去补那一项，而不是再来问一次。
     *   ★ 而拆解器**给了料**时这几项**不再缺**（没有"缺什么"要说）。
     */
    ...decomposed ? {} : {
      /**
       * ★★★ P3 之后这一格的含义变了（**不许留着旧措辞**）────────────────────────────
       *
       *   落地前：它是"**我还没学会**"（补救动作 = 填 P3）。
       *   落地后：拆解器**在**了，而它**仍然**答 unmeasured ⇒ 那说明的是**别的**原因，
       *           而可能的原因**至少有三种**，补救动作各不相同：
       *
       *     ① 递归到顶（`depth >= MAX_DECOMPOSE_DEPTH`）⇒ 再拆一层要人拍板
       *     ② 大档的三条信号一条都不成立        ⇒ 分档与拆解器读的不是同一件事
       *     ③ 拆出来的子活没有收敛               ⇒ 拆法不够好，要换一个
       *
       *   ⇒ ★ 所以 `why` 由**拆解器自己**给出（它最清楚为什么），而这里只补上
       *     "这条活为什么该被拆"与"它卡在哪一问"那两条**下游要用来裁决**的信息。
       *   ★ 而"留着旧措辞"的后果是实的：读的人会去填一个**已经填好的** P3，
       *     而真正的那一条（到顶 / 信号不成立 / 没收敛）**永远读不到**。
       */
      missing: [
        ...Array.isArray(reason?.missing) ? reason.missing : [],
        `★ 而这一条大活为什么该被拆：${String(tier?.why ?? '(分档没给理由)')}`,
        `★ 它卡在哪一问上：${String(tier?.blockingQuestion ?? '(分档没给那一问)')}`,
      ],
      why: String(reason?.why ?? '拆解器答 unmeasured ⇒ 如实落 unmeasured。')
        + '★ 而它**不许**并进"可派"（那会让大活直接出了货）。',
      blockingQuestion: reason?.blockingQuestion ?? tier?.blockingQuestion,
    },
  }
}

/**
 * 把一份**已生成的契约**拆成子契约。★ 而它**不是一个空壳** —— 在拆解器落地之前，
 * 它只做一件可核的事：把 `decompose` 的 `unmeasured` **形状**交给下游，
 * 并**当场拒绝**任何"拆了个空的"或"原样还回来"的拆法（见下）。
 *
 * ★★★ 为什么这条函数现在就值得写：它把"大活不许从拆解里溜进 ready"写成**可执行的断言**，
 *   而不是一句注释 —— 于是 P3 填本体时，一个"拆成 []"或"拆成原样"的实现**当场红**。
 */
export function decomposeContract(contract, tier, { depth = 0, exists, decomposer } = {}) {
  const outcome = decompose(tier, contract, { depth, ...decomposer === undefined ? {} : { decomposer } })
  /**
   * ⚠️ MEASURED（本任务当场抓出来）：第一版在这里**先** `return` 掉 `unmeasured`
   *   ⇒ 下面那两道"非法拆法"的闸门**永远走不到**（P3 之前 `decompose` 恒答 unmeasured）
   *   ⇒ 它们是一条**够不着的断言** —— 而"够不着"与"守住了"在读数上同形。
   *
   * ★★ 而那条是我自己写的一条臂（T113f）打红的：它构造了一个"拆出 0 条"的拆解器，
   *   期望这里拒掉，而实际返回的是 `decompose` 那句"我还没学会"⇒ 断言对不上。
   *   ⇒ ★ 而那正是夹具该做的事：**它把我"以为写了、其实没跑"的闸门当场指出来。**
   *
   * ⇒ 修法：**先**看拆解器给没给出子活，再谈 status。
   */
  const children = Array.isArray(outcome.children) ? outcome.children : []

  /**
   * ── ★★★ 形状闸门**先跑**（不管拆解器自报的是什么 state）──────────────────────────
   *
   * ⚠️ MEASURED（本任务当场抓出来，**两次**）：
   *
   *   ① 第一版把 `unmeasured` 先 `return` 掉 ⇒ 闸门在 P3 之前**够不着**
   *      （"够不着"与"守住了"在读数上同形）。
   *   ② 第二版把闸门放进了 `if (outcome.status === 'unmeasured')` 里面 ⇒
   *      一个**合法的**拆法（写域真的变小了）会在那里被当成"我还没学会"而放过去
   *      —— 而反过来，一个"同形"的坏结果带着 `status: 'decomposed'` 时又走不到闸门。
   *
   * ★★ 根因是同一个：**闸门被 arrangement 挂在了一条分支上**，而不是挂在
   *   "料长什么样"上。⇒ 现在它**只看料**：
   *
   *     料是 undefined      ⇒ 相信拆解器的自报（`unmeasured` = "我还没学会"）
   *     料是空数组          ⇒ ★ 拒（"这条活凭空消失了"）
   *     料里有与原来同形的   ⇒ ★ 拒（"原样传下去，下一轮还会被判大档"）
   *     料是合法的子活       ⇒ 放行（`decomposed`）
   *
   * ★ 而"自报 unmeasured 却给了料"也在这里被拦（见下）—— 那是形不一致。
   */
  const gaveChildren = outcome.children !== undefined
  const sameShape = children.some((child) => {
    const scope = Array.isArray(child?.inScope) ? child.inScope.map(String) : []
    const own = Array.isArray(contract?.inScope) ? contract.inScope.map(String) : []
    return scope.length === own.length && scope.every((entry, index) => entry === own[index])
  })

  if (gaveChildren && (children.length === 0 || sameShape)) {
    return {
      ...outcome,
      status: 'unmeasured',
      children: undefined,
      why: children.length === 0
        ? '拆解给出了 **0** 条子活 ⇒ 那不是"拆完了"，是"这条活凭空消失了"。★ 不许并进 ready。'
        : '拆解至少有一条子活与**原契约同形**（同样的写域）⇒ 那只是把这条大活原样传下去，'
          + '下一轮它会**再一次**被判大档 ⇒ 而若让它过闸，大活就出了货。★ 不许并进 ready。',
    }
  }

  /** ★ 而"没给料" ⇒ 相信自报：`unmeasured`（"我还没学会"，补救是填 P3）。 */
  if (!gaveChildren) return { ...outcome, children: undefined }

  /**
   * ── ★★★ 最后一道：**自报与料对不对得上** ───────────────────────────────────────
   *
   * ★ 而"对得上"只有一种：自报 `decomposed` **且**给了子活 —— 那是正常的那一半。
   *
   * ★★ 而"自报说没学会、却给了一串**能用的**子活" ⇒ 那是**形不一致**：
   *   下游没法知道该信哪一半。★ 不许并进 ready。
   *
   * ⚠️ MEASURED（t113 补强杀伤率时当场抓出来，一次**真 bug**）：这一格的判断
   *   我第一版**写反了** ——
   *
   *     if (outcome.status === 'decomposed') { …拒绝… }   ← 反了
   *
   *   ⇒ 后果是：一个**完全正常**的拆解（自报 decomposed + 给出两条合法子活）
   *     被判成"形不一致"而**拒绝** ⇒ 拆解**永远不会成功**。
   *   ★★ 而它是被我**自己**那条反向半边臂（T113f 的"合法的拆法必须被放行"）
   *     抓出来的 —— 而那一条正是为了防"上面两道闸门可能是一律拒绝"才写的。
   *   ⇒ 所以那条臂不是形式：它当场逮住了一个会让整个 P3 无法交付的错。
   */
  if (outcome.status !== 'decomposed') {
    return {
      ...outcome,
      status: 'unmeasured',
      children: undefined,
      why: `拆解器自报 \`${String(outcome.status)}\`，而它**同时**给出了一串子活 ⇒ 那个自报与料对不上。`
        + '★ 不许并进 ready：一个连自己都没说清的拆解结果，没人能核。',
    }
  }

  return { ...outcome, status: 'decomposed', children }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑫ ★★★ t113：**单一主干** —— 分类 → 契约 → 分档 → 拆解 → 生成即审查 → ready
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 这一节要消掉的那个缺陷（实测，本任务的由来）────────────────────────────
 *
 * 此前有三条**独立出口**，各自走了流水线的不同片段，且**顺序不一致**：
 *
 *     `--emit-task <id>`   生成 → 审查            ★ **不分档**（大活也产出契约）
 *     `--dispatchable`     分档 → 生成 → 审查     顺序对，但只**列**不落地
 *     `--json`             只出分类报告            走不到契约
 *
 * ★ 根因：`tierOf` **只**在 `dispatchable()` 内部被调用 ⇒ `emitReviewedContract`
 *   自己不知道分档 ⇒「原子化判定」是**调用方记得去做的一步**，而不是流水线的一个阶段。
 *
 * ⇒ ★★ 于是同一提案走 `--emit-task` 出契约、走 `--dispatchable` 被判大档 ——
 *   两条路对**同一件工作**给出**相反处置**（那正是本任务的行名）。
 *
 * ── 修法：阶段**固定且有序**，而它们是**代码的顺序**，不是一个约定 ────────────────
 *
 *     ① 分类             —— 提案由 `triage()` 给出（它已经有）
 *     ② 产出契约         —— `emitTaskContract`（★ 注意：**不是** `emitReviewedContract`）
 *     ③ ★ 分档           —— `tierOf`（**硬性阶段**：主干上的一站，不是可选步骤）
 *                            ├ 小档         → ⑥ 生成即审查
 *                            ├ 大档         → ④ 拆解 → ⑤ 审拆法 → 子提案【回到 ②】
 *                            │                （递归上限 2 层；★ 在 P3 填本体之前，
 *                            │                 ④ 如实落 unmeasured ⇒ cannot-emit）
 *                            └ unmeasurable → cannot-emit（★ 绝不并进"可派"）
 *     ⑥ 生成即审查       —— `adversarialReview` 五问 → 盖章 reviewed / needs-review / rejected
 *     ⑦ 进 ready 池      —— 附完整契约 + 派工理由
 *
 * ── ★★★ 为什么"契约"单独是第 ② 站，而审查不是 ──────────────────────────────────
 *
 * ★ 一条**没有契约**的提案（缺 inScope / 缺 subject …）根本无从分档 ——
 *   `tierOf` 的 `unmeasurable` 那一格说的就是这件事（"inScope absent" / "inScope empty"）。
 * ⇒ 所以顺序必须是 ② 再 ③：分档要有一份写域可读。
 *
 * ── ★★★★ 而分档读的是【提案自己的写域】，**不是收窄之后的那一份**（t113 修正）─────
 *
 * MEASURED（本任务第一版就是收窄后分档，由 captain 裁定改掉）：
 *
 *   分档问的是「**这条活本身有多大**」——
 *   而 `narrowScope` 是**为了产出契约**做的一次收窄，它发生在
 *   "我们已经决定要做它"【之后】。
 *
 *   ⇒ 用收窄后的写域去判"它大不大"，等于**用施工图判这块地原本多大**：
 *     判出来的是**收窄器的输出**，不是提案的面。
 *
 * ★★ 而它的实际后果是可量出来的（那一版实测）：
 *     一条判决侧 `inScope: ['src/a.ts','src/b.ts']` 会被收窄成两个具体文件
 *     （`scripts/gate-*.test.mjs` + `src/gates/index.ts`）⇒ **判成小档**
 *     ⇒ ★ **信号 A（跨多个现有源码文件 —— t54 教出来的那一条）在判决侧永不触发**
 *
 *   ★ 而那正是 t54 的事故形状（跨 6 个文件、amend 三次）；
 *     第一版会把它**结构性地**从判决侧关掉 —— 不能接受。
 *
 * ── ★ 而收窄本身**不是白做的**：它的读数要保留，只是不再喂给分档 ────────────────
 *
 * 「收窄前 vs 收窄后」的差**本身是一个有用的信号**：
 *   收窄把一个粗面压成两个文件，说明**原始写域粗得没能指认对象**。
 * ⇒ 它进 `narrowing` 那一格（见 `runStages` 的返回值），**不进分档的输入**。
 *   ★ 两个读数各说各的事：`tier` 说"这条活多大"，`narrowing` 说"这次收窄干了什么"。
 *     把它们合成一个，就会让"收窄器坏了"与"这条活很小"在读数上同形。
 *
 * ★★ 而 `emitReviewedContract` **不许**被绕过：⑦ 那一格拿到的契约**就是它给的**
 *   （见 `OUTCOME_CONTRACT_SOURCE`）⇒ 于是"大活直接出契约"在结构上不可能。
 *
 * ── 三态（而三者不许合并）─────────────────────────────────────────────────────
 *
 *     `ready`          —— 小档 + 审查过了（契约带 `reviewed`）
 *     `awaitingRuling` —— ★ 大档：一个**队列**，不是错误（每条带"它大在哪"与"卡在哪一问"）
 *     `cannot-emit`    —— ★ 补信息（契约不全 / 分档判不了 / 拆解器还没实现）
 *     `rejected`       —— 审了没过
 *
 *   ★ 而 `ready` / `awaitingRuling` / `cannot-emit` 里**没有一格并进另一格**。
 */
export function runPipeline(proposal, options = {}) {
  const now = options.now ?? Date.now()
  /**
   * ── ★★★ 递归上限那一格的【唯一真值】必须在这里读，而不是写死 0 ──────────────────
   *
   * ⚠️ MEASURED（P3 当场抓出来）：第一版这里写死 `depth: 0` —— 于是子活回到入口时
   *   **深度被清零**，`MAX_DECOMPOSE_DEPTH` **永远够不着** ⇒ 递归没有上限。
   *
   *   ★ 而它的形态正是本队记账最久的那条：**一条守着上限的门，而那个上限从来没被读到。**
   *     （"有上限"与"上限生效"在读数上同形 —— 直到有人造一条真的会无限往下拆的活。）
   *
   * ⇒ 修法：深度由调用方经 `options.depth` 传进来，缺省 0。
   *   ★ 而**对外**的语义不变：`runPipeline(proposal)` 仍然从第 0 层开始 ——
   *     只有递归那条路会显式递增它。
   */
  const depth = Number.isInteger(options.depth) ? options.depth : 0
  return runStages(proposal, options, { depth, now, trace: [] })
}

/**
 * ★★ 而下面这个常数是"审查不许被跳过"的**单一真值**（见 `runStages` 里那处断言）：
 *   ⑦ 那一格的契约**只能**来自 `emitReviewedContract`。
 */
export const OUTCOME_CONTRACT_SOURCE = 'emitReviewedContract'

function runStages(proposal, options, { depth, now, trace }) {
  const at = (stage) => [...trace, stage]

  /**
   * ── ② 产出契约（**未盖章的那一份**）────────────────────────────────────────────
   *
   * ★ 用 `emitTaskContract` 而不是 `emitReviewedContract`：证据是它点名的那条失效
   *   ——「大档提案绝不被 `emitReviewedContract` **直接**产出契约」。
   *   而**这一站在主干上**、且它之后**必然**是 ③ 分档 ⇒ 那条不可能成立，
   *   而路径上的每一站都写在下面的 `trace` 里（可核，不是一个承诺）。
   *
   * ★ 而它是**收窄之后**的提案：**契约**写的是收窄后的写域（那是对的 ——
   *   契约要指得出它到底改哪几个文件）。
   *   ★★ 而**分档不读这一份** —— 见本文件头"用施工图判这块地原本多大"那一节。
   */
  const narrow = narrowScope(proposal, options)
  const emitted = emitTaskContract({ ...proposal, inScope: narrow.inScope }, options)

  /**
   * ── ★★ `narrowing`：这次收窄干了什么（**读数**，不是裁决）──────────────────────
   *
   * ★ 它**不**参与分档（那正是本任务修正的那一格），而它不是一个可以丢掉的东西：
   *   原始写域 ⇒ 收窄后写域 的**差**，说的是一件分档说不了的事 ——
   *
   *     收窄把一个大面压成两个具体文件  ⇒ ★ 原始写域**粗得没能指认对象**
   *                                       （判决侧 claim 是人话散文，推不出路径）
   *     收窄什么都没改（`coarse`）       ⇒ 它推不出来，如实标粗
   *
   * ★★ 而它必须**逐条可核**：`from` 是提案给的、`to` 是收窄器给的、`rejected` 是两者的差。
   *   把两个读数（`tier` / `narrowing`）合成一个，会让"收窄器坏了"与"这条活很小"同形。
   */
  const narrowing = {
    status: narrow.status,
    /** ★ 提案**自己的**写域（分档读的就是它）。 */
    from: Array.isArray(proposal?.inScope) ? [...proposal.inScope] : [],
    /** ★ 收窄之后、写进**契约**的那一份。 */
    to: Array.isArray(narrow.inScope) ? [...narrow.inScope] : [],
    /** ★ 而"被收窄掉了哪些格子"要看得见（那是"原始写域粗"的证据）。 */
    dropped: (Array.isArray(proposal?.inScope) ? proposal.inScope : [])
      .filter((entry) => !(Array.isArray(narrow.inScope) ? narrow.inScope : []).includes(entry)),
    why: narrow.why,
  }

  /**
   * ── ★★★ ② · 分档的**第一半**：写域本身就读不出来 ⇒ 那**就是** `unmeasurable` ──────
   *
   * ★★ MEASURED（本任务当场抓出来）：`emitTaskContract` 在 `inScope` 为空时**先**报
   *   `cannot-emit`，而 `tierOf` 的 `unmeasurable` 那一格**永远走不到** ——
   *   于是同一条"写域判不了"的提案会有**两个不同的出处**：
   *
   *     走契约那一站 ⇒ `missing: ['inScope（没有写域 ⇒ …）']`，**没有** `becauseTier`
   *     走分档那一站 ⇒ `missing: [tier.why]`，**有** `becauseTier: 'unmeasurable'`
   *
   *   ★ 而下游要能分辨"分档判不了"与"别的项缺了"（两者的补救动作不同：一个补写域、
   *     一个补 subject/acceptance/…）⇒ 少了那一格，读的人**分不出**该去补什么。
   *
   * ⇒ 修法：在这里把"写域读不出来"**如实**标成 `becauseTier: unmeasurable` ——
   *   而它**不是猜的**：`inScope` 缺席/为空**正是** `tierOf` 判 `unmeasurable` 的那两个条件
   *   （见 `tierOf` 开头那两格），所以这里与那里**读的是同一件事**。
   *
   * ★ 而 stage 仍然是 `cannot-emit`（它确实是"出不了契约"）——**两个出口都是**。
   */
  if (emitted.status !== 'executable') {
    const scopeUnreadable = !Array.isArray(narrow.inScope) || narrow.inScope.length === 0
    return {
      stage: 'cannot-emit',
      sourceId: proposal?.sourceId,
      missing: emitted.missing,
      ...scopeUnreadable ? { becauseTier: TIER.unmeasurable } : {},
      because: '契约不完整',
      narrowing,
      trace: at('contract'),
    }
  }

  const contract = emitted.contract

  /**
   * ── ★★★ ③ 分档 —— **硬性阶段** ───────────────────────────────────────────────
   *
   * ★★ 而它读的是 **`proposal`（提案自己的写域）**，**不是** `contract`（收窄后的那一份）——
   *   见本文件头那一节逐字的理由（"用施工图判这块地原本多大"）。
   *
   * ★ 所以这里必须用 `proposal` 而不是 `{ ...contract, inScope: narrow.inScope }`：
   *   后者读的是**收窄器的输出**，而信号 A（跨多个现有源码文件）会在判决侧永不触发。
   *
   * ★★ 而"分档要在契约之后"这一条**仍然成立**（顺序没变）：
   *   ② 那一站的用途是**证明这份提案出得了契约**（subject/kind/acceptance/verify/inScope 都在），
   *   而不是把"契约里那份写域"当成分档的输入。
   */
  const tier = tierOf(proposal, options)

  /** ★ `unmeasurable`（`inScope` 缺席/为空）⇒ 补**信息**，不许并进"可派"。 */
  if (tier.tier === TIER.unmeasurable) {
    return {
      stage: 'cannot-emit',
      sourceId: proposal?.sourceId,
      missing: [tier.why],
      becauseTier: TIER.unmeasurable,
      because: '分档判不了',
      tier,
      narrowing,
      narrowing,
      trace: at('tier'),
    }
  }

  /** ── ③ · 大档分支：④ 拆解 → ⑤ 审拆法 → 子提案【回到 ②】──────────────────────── */
  if (tier.tier === TIER.large) {
    /**
     * ─── ★★★ 在 P3 落地之前，这一站的形状是【行为不变的】 ─────────────────────────
     *
     * 任务边界逐字写着：「在 P3 完成前，③ 判为大档时走**现有的** `awaitingRuling`
     * （行为不变），只是位置从 `dispatchable()` 内部提到主干上。」
     *
     * ★ 而"提起位置"这件事**本身就是本任务**：此前分档只发生在 `dispatchable()` 内部
     *   ⇒ `--emit-task` 走的是"生成 → 审查"而**没有这一站** ⇒ 它给一条大活出了契约。
     *   ⇒ 现在它在**主干上**，两个出口都经过它。
     *
     * ★★ 而为什么是 `awaitingRuling` 而**不是** `cannot-emit`（我第一版写错了，MEASURED）：
     *   两者都"没有契约"，而它们的**补救动作相反**，混起来会让派发停摆：
     *
     *     `cannot-emit`    ⇒ "我出不了契约" —— 人**补信息/补能力**，而**没有东西可裁决**
     *     `awaitingRuling` ⇒ ★ 契约**完整且合格**，只是这个提案是**大活**
     *                        ⇒ 人（或 P3 的拆解器）**有东西可裁决**：这么拆行不行
     *
     *   把大档报成 `cannot-emit` 的后果是**直接的**：`withMutatedTool` 那类臂会看到
     *   `awaitingRuling` 空了，而 captain 读到的是一句"契约生成不出来"——
     *   于是他会去补一条**根本不缺**的信息，而那条大活**永远等不到裁决**。
     *   ⇒ ★ 这正是本队记账过的形态：**把一类读数伪装成另一类，而两者的补救动作相反。**
     *
     * ★ 所以：**大活的信息是完整的**，缺的从来不是信息。
     */
    const decomposed = decomposeContract(contract, tier, {
      depth,
      ...options.exists === undefined ? {} : { exists: options.exists },
      /**
       * ★★ 注入的拆解器必须**转发到这里** —— 否则 `options.decomposer` 永远到不了
       *   `decompose`，而"夹具能喂一个故意坏掉的拆解器"这件事就成了空话：
       *   那两道非法拆法的闸门会**够不着**（而"够不着"与"守住了"在读数上同形）。
       */
      ...options.decomposer === undefined ? {} : { decomposer: options.decomposer },
    })
    /**
     * ── ★★ ⑤ 审拆法 ──────────────────────────────────────────────────────────────
     *
     * ★ 拆法**本身**要过五问（和契约一样）—— 而那正是用户说的"原子化拆解的审查（门禁）"：
     *   他裁定的从来不是"这条活大不大"，而是"**这么拆行不行**"。
     *
     * ★ 而这里**复用** `adversarialReview`（同一个函数、同一套五问）——
     *   不为拆解另写一套（那样两份会分叉，而分叉之后"审过了"在日志里同形）。
     */
    const decompositionReview = adversarialReview(
      { inScope: contract.inScope, acceptance: contract.acceptance, verify: contract.verify, objective: contract.objective },
      narrow,
    )

    /**
     * ── ★★★ 拆解器**还没有落地**（P3）⇒ 这一站落 `awaitingRuling`【但把缺什么说清】───
     *
     * ★ 三件事**同时**成立，而它们都要在读数里：
     *   ① 它在**等人裁决**（本任务的边界：行为不变，走现有的 `awaitingRuling`）
     *   ② ★ 而那份契约**完整** ⇒ 它不是"生成不出来"（`cannotEmit` 会误导）
     *   ③ ★★ 而"拆解器没落地"这件事**不许被藏起来** —— 它进 `decomposition` 那一格，
     *      因为把这个工况伪装成"一条正常的大活等人裁决"，就是本队记账的
     *      **把基础设施工况伪装成关于数据的结论**。
     *
     * ★★ 而 P3 一落地，`decomposed.status === 'decomposed'` ⇒ 走下面那一段递归，
     *   这一格**自动消失**（不是靠谁记得来删它）。
     */
    const notYetDecomposable = decomposed.status !== 'decomposed'

    /**
     * ── ★★★ P3：拆得动 ⇒ 子提案**回到流水线入口**（递归，上限 2 层）───────────────
     *
     * ★ 那正是用户那句话的落点：「拆解 →（回到）一开始」。
     *   所以每一条子活**重新走一遍** ②契约 → ③分档 → …… —— 而不是在这里就地宣布它合格。
     *   ★ 理由与"审查不许被跳过"同源：**子活自己也要被判一次**，
     *     否则"拆过了"就成了一个绕过分档的后门（而子活可能还是大档）。
     *
     * ★★ 而递归的深度是 `depth + 1`，上限由 `MAX_DECOMPOSE_DEPTH` 管
     *   ⇒ 到顶时子活落进它自己的 `awaitingRuling`（**留在队列**，不是被丢掉）。
     *
     * ★★★ 而审查（⑤ 审拆法）**先过**才递归：`needs-review` / `rejected` 一律不往下走
     *   —— 那正是"审拆法"这道门的意义。见下面 `decompositionReview.status`。
     */
    /**
     * ── ★★★ 而审查（⑤ 审拆法）**先过**才递归 ──────────────────────────────────────
     *
     * ⚠️ MEASURED（P3 当场抓出来）：我第一版写的是 `decompositionReview?.status`，
     *   而 `adversarialReview` 交出来的那一格叫 **`outcome`**（不是 `status`）。
     *   ⇒ 那个 `!== 'rejected'` 因此**恒真**（`undefined !== 'rejected'`）
     *   ⇒ **审拆法这道门被静默跳过了** —— 而它看起来完全正常（返回值里那份 review 在）。
     *
     *   ★★ 而它的形状正是本队记账最久的那条：**读了一个不存在的字段，而它恒真。**
     *     （"门守住了"与"门读了 undefined"在读数上同形 —— 因为两者都不抛。）
     *
     * ⇒ 修法两条**同时**做：
     *   ① 读**真的那一格**（`outcome`）；
     *   ② ★ 而它**读不到时就【不】放行** —— 一个读不到的审查结论**不能**当成"审查过了"
     *      （与"没能测量不得并进通过"同一条纪律）。
     *
     * ── ★★★ 而"哪几种 outcome 该拦下"必须分清（否则这道门会把 P3 整个卡死）─────────
     *
     *   修好 ① 之后，一条**正常**的拆解会拿到 `needs-review` —— 而那不是"拆法坏了"：
     *
     *     `needs-review` 的成因是**别的**那一问（实测：`scope` 因为 claim 是散文
     *     ⇒ `narrowScope` 推不出具体文件 ⇒ 它如实标 `unmeasured`）。
     *     ★ 而那是**收窄器**的既有限制（与拆解无关），且现有行为就是"如实标粗、交给人看"。
     *
     *   ⇒ 把它当成"拆法没过"的后果是**直接的**：**每一条大活都拆不动** ⇒ P3 整个不可用。
     *     ★ 而那不是"严格"，是一条**永远不能为真**的门（本队记账过的那条）。
     *
     *   ⇒ 所以这里拦的是【**拆法自己**出了问题】那两种，而不是"别的问没测到"：
     *     · `rejected`   ⇒ 拆法**被拒** ⇒ 拦住（那是结论，不是缺读数）
     *     · ★ 而**拆法那几问里出现 `fail`** ⇒ 拦住（那是"这么拆不行"）
     *     · `needs-review` 而**只有 `unmeasured`** ⇒ **放行**（缺的是别人的读数，不是拆法的问题）
     *       ★ 而它**不静默**：`decomposition.review` 那一格如实带着这份结论
     *         —— 于是"为什么它过了、而哪一问没测到"读得出来。
     */
    const reviewOutcome = decompositionReview?.outcome
    const reviewReadable = typeof reviewOutcome === 'string'
    /**
     * ★ 拆法自己失败了吗：五问里有没有 `fail`。
     *   （`adversarialReview` 交出的 `failedIds` 就是那个读数 —— 用它，不重算一遍。）
     */
    const reviewFailures = Array.isArray(decompositionReview?.failedIds) ? decompositionReview.failedIds : []
    const decompositionAccepted = decomposed.status === 'decomposed'
      && reviewReadable
      && reviewOutcome !== 'rejected'
      && reviewFailures.length === 0

    if (decompositionAccepted) {
      const children = Array.isArray(decomposed.children) ? decomposed.children : []
      /**
       * ★ 每条子活回到入口 ⇒ 而它们的结论**全部**在返回值里（不是只留第一条）。
       *   ★ 而"回不去"（无 sourceId 等）时它仍然是子活 —— 由下一轮自己去报缺什么。
       */
      const runs = children.map((child, index) => ({
        index,
        child,
        /**
         * ★★★ **深度必须递增** —— `depth + 1`，不是 0。
         *
         *   ⚠️ MEASURED（P3 当场抓出来）：第一版漏了这一步（而 `runPipeline` 那时
         *   还写死 `depth: 0`）⇒ 子活回到入口时深度被清零 ⇒ **递归没有上限**。
         *   那是一条"守着上限而从未读到上限"的门 —— 见 `runPipeline` 里那段。
         */
        ...runPipeline(child, { ...options, depth: depth + 1 }),
      }))
      return {
        stage: 'decomposed',
        sourceId: proposal?.sourceId,
        entry: {
          proposal,
          sourceId: proposal?.sourceId,
          subject: proposal?.subject ?? contract.subject,
          inScope: contract.inScope,
          whyLarge: tier.why,
          blockingQuestion: tier.blockingQuestion,
          nextStep: tier.nextStep,
          signals: tier.signals,
        },
        tier,
        decompositionReview,
        decomposition: {
          status: 'decomposed',
          decomposed: true,
          depth,
          /** ★ 拆了几条，以及**每一条自己走到了哪一站** —— 那才是可核的读数。 */
          count: children.length,
          children: runs.map((run) => ({
            sourceId: run.child?.sourceId,
            inScope: run.child?.inScope,
            stage: run.stage,
            ...run.tier === undefined ? {} : { tier: run.tier.tier },
          })),
        },
        runs,
        narrowing,
        trace: at('tier').concat('decompose', 'recurse'),
      }
    }

    return {
      stage: 'awaitingRuling',
      sourceId: proposal?.sourceId,
      /** ★ 用户裁决时需要知道它**大在哪** —— 不许只给一个"大"字。 */
      entry: {
        proposal,
        sourceId: proposal?.sourceId,
        subject: proposal?.subject ?? contract.subject,
        inScope: contract.inScope,
        whyLarge: tier.why,
        blockingQuestion: tier.blockingQuestion,
        nextStep: tier.nextStep,
        signals: tier.signals,
      },
      tier,
      decompositionReview,
      /**
       * ★ 而这一格是**读数**（不是错误）：
       *   `unmeasured` ⇒ ★ **拆不动**（递归到顶 / 信号一条都不成立 / 拆了没收效）
       *                  ⇒ 子活**留在队列**（就是这一站），而 `missing` 指名缺什么
       *   `illegal`    ⇒ 拆解器拆出一个**非法的**结果（空 / 与原样同形）
       *                  ⇒ 补救是**修拆解器**，而它同样**不许**进 ready
       *
       * ★★★ 而 `blockingQuestion` 必须**跟着这一站一起出去** ——
       *   那就是"留在队列**并指名哪一问**"那句验收的落点：
       *   读的人要能直接回答"它在等哪一问被裁决"，而不是再来问一次。
       */
      blockingQuestion: tier?.blockingQuestion,
      ...notYetDecomposable
        ? {
          decomposition: {
            status: decomposed.status,
            decomposed: false,
            missing: decomposed.missing,
            why: decomposed.why,
            /** ★ 拆不动时**指名哪一问**（与 `entry.blockingQuestion` 同一件事，这里更醒目）。 */
            blockingQuestion: decomposed.blockingQuestion ?? tier?.blockingQuestion,
          },
        }
        : {
          /**
           * ★ 拆得动、而**审拆法没过** ⇒ 也留在这里，而理由要指名是**哪一问**没过。
           *   这是 ⑤ 那道门的落点：不许"拆了就算过"。
           */
          decomposition: {
            status: 'not-accepted',
            decomposed: true,
            blockingQuestion: decompositionReview?.missing?.[0]
              ?? decompositionReview?.questions?.find((q) => q?.status !== 'passed')?.question,
            why: '拆法本身没通过五问 ⇒ 子活**留在队列**，等这一问被裁决。',
            review: decompositionReview?.status,
          },
        },
      narrowing,
      trace: at('tier').concat('decompose'),
    }
  }

  /** ── ⑥ 生成即审查（五问）→ 盖章 reviewed / needs-review / rejected ────────────── */
  const reviewed = emitReviewedContract(proposal, options)

  if (reviewed.status === 'rejected') {
    return {
      stage: 'rejected',
      sourceId: proposal?.sourceId,
      tier,
      emitted: reviewed,
      narrowing,
      narrowing,
    trace: at('tier').concat('review'),
    }
  }
  /**
   * ★ 而"契约生不出来"在**这一站**也要如实报 —— 它此前在 ② 就回去了，
   *   而这里再判一次是因为 ⑥ 是**最后一个**能发现它的地方（两条路都不许静默）。
   */
  if (reviewed.status !== 'executable') {
    return {
      stage: 'cannot-emit',
      sourceId: proposal?.sourceId,
      missing: reviewed.missing,
      because: '契约不完整（审查那一站判出来的）',
      tier,
      narrowing,
      narrowing,
    trace: at('tier').concat('review'),
    }
  }

  /**
   * ── ★★★ ⑦ 进 ready 池 ────────────────────────────────────────────────────────
   *
   * ★★ 而这里有一条**结构性断言**（不是注释）：ready 池里那份契约**只能是**
   *   `emitReviewedContract` 给的 ⇒ 一条绕过了审查的契约**到不了这一格**。
   */
  if (String(OUTCOME_CONTRACT_SOURCE) !== 'emitReviewedContract') {
    throw new Error('the reviewed gate was renamed — re-check that ready contracts still come from it')
  }
  return {
    stage: 'ready',
    sourceId: proposal?.sourceId,
    tier,
    reviewStage: {
      outcome: reviewed.review.outcome,
      /** ★ 而 `reviewed` 那一格**只有在全 pass 时**才盖（needs-review 不盖章）。 */
      stamped: reviewed.contract.reviewed !== undefined,
      checks: reviewed.review.checks.map((check) => ({ id: check.id, verdict: check.verdict })),
    },
    emitted: reviewed,
    method: { stages: at('tier').concat('review'), source: OUTCOME_CONTRACT_SOURCE, now: new Date(now).toISOString() },
    narrowing,
    trace: at('tier').concat('review'),
  }
}

/**
 * ── ★★ `--dispatchable`：只列**现在就能建**的 ──────────────────────────────────
 *
 * 契约：「② 是给 captain **一句话就能执行**的东西，而不是要他再判断一次。」
 *
 * ── 三态（而三者不许合并）─────────────────────────────────────────────────────
 *
 *     `ready`        现在就能建（to-dispatch + 写域空闲 + 有成员空闲 + 契约完整）
 *     `cannot-emit`  ★ **契约生成不出来**（附缺什么）—— 那与"被挡"不同：
 *                    前者要补信息，后者要等写域
 *     （`blocked` 的那些**根本不在这份清单里**，它们由 `--json` 的 blocked 格给出）
 */
export function dispatchable(report, options = {}) {
  const ready = []
  const cannotEmit = []
  const rejected = []
  /**
   * ── ★★★ t98：第三态 —— 「等人裁决」（而它**是一个队列，不是一个错误**）───────────
   *
   * 用户原话：「大货是不应该直接派的。需要我裁决的就留下来，等问完我的意见、
   *   裁决完之后，你再生成、审查，然后才能派货。因为我们之前做的是那种原子化
   *   拆解的审查（或者说是门禁），**所以派出的不应该有大活**。」
   *
   * ⇒ ★ 判成大档的提案**不进 `ready`**，而是进这里，且每条**带上它大在哪**。
   */
  const awaitingRuling = []
  /**
   * ★★★ P3：拆出来的那一栏 —— 每条大活拆成几条子活、而**每条子活走到了哪一站**。
   *   它与 `awaitingRuling` **不同形**：那里是"有人要拍板"，这里是"拆解已经发生"。
   */
  const decomposed = []
  /**
   * ── ★ 而"为什么没进 `ready`"要**分栏报**，而不是一个笼统的 blocked ──────────────
   *
   * ★★ 而下面这个映射是**那一栏的名字 ← 主干的 stage**：
   *   主干的 stage 是**处置**（`awaitingRuling` / `cannot-emit` / `rejected`），
   *   而这一栏的名字是**为什么**（`large` / `contractIncomplete` / `notReviewed`）。
   *   ★ 两者不许各自猜：映射**只有一处**。
   *
   * ★★★ 而 `ready` **故意不在这张表里** —— 这一栏问的就是"为什么**没**进 ready"
   *   ⇒ 一条进了 ready 的提案**本来就没有那一栏**（给它记一栏会让分栏的合计
   *     与 `toDispatch` 一样大，而那把"进了的"与"没进的"又合成一个数字）。
   *   ★ 所以下面查表**只对非 ready 的 stage**做。
   */
  const notReadyBecause = { large: 0, decomposed: 0, notReviewed: 0, contractIncomplete: 0, scopeBlocked: 0 }
  const COLUMN_BY_STAGE = {
    awaitingRuling: 'large',
    /** ★ P3：拆解那一栏 —— 而它**不是** `notReviewed`（拆解不是审查没过的意思）。 */
    decomposed: 'decomposed',
    rejected: 'notReviewed',
    'cannot-emit': 'contractIncomplete',
  }

  for (const proposal of report?.toDispatch ?? []) {
    /**
     * ── ★★★ t113：这条循环**不再自己走一遍阶段** —— 它调用那唯一的一条主干 ──────────
     *
     * ★ 本任务的全部理由：`--emit-task` 与 `--dispatchable` 各写了一遍阶段，而它们的
     *   **顺序不一样**（前者不分档，后者分档）⇒ 同一提案在两个出口上**处置相反**。
     *   ⇒ 现在两个出口都是 `runPipeline` 的**薄包装**，分叉在结构上不可能。
     *
     * ★★★ 而"分档"这一步的位置**在本函数之外**（在主干上）—— 那是本任务最要紧的一格：
     *   它此前**只**在这个循环里被调用 ⇒ `emitReviewedContract` 自己不知道分档，
     *   于是一条大活走 `--emit-task` 就会**出一份契约**。
     *
     * ★ 而 `notReadyBecause` 的计数**从 stage 读出来**，不在这里重算 ——
     *   否则"哪一格进哪一栏"又会有第二处口径（而那正是本任务要消掉的那种分叉）。
     */
    const outcome = runPipeline(proposal, options)
    if (outcome.stage === 'ready') ready.push({ proposal, tier: outcome.tier, ...outcome.emitted })
    else if (outcome.stage === 'awaitingRuling') awaitingRuling.push(outcome.entry)
    /**
     * ── ★★★ P3：`decomposed` 是一条**新的 stage**，而它进哪一栏要说清 ────────────────
     *
     * ★ 它**不进 ready**（那会把一条大活当成可派的），也**不进 awaitingRuling**
     *   （那不是"等人裁决"：拆解**已经发生了**，等人看的是它拆出来的那几条）。
     *
     * ★★ 而它进 `decomposed` 那一栏，且**带着每条子活自己的去向** ——
     *   于是"拆出来的那几条现在在哪"是一个直接读得出来的读数，
     *   而不是要靠人去把三栏扫一遍才知道。
     *
     * ★★★ 而子活里那些走到 `ready` 的**也在这一栏里**（不重复进顶层 ready）——
     *   理由：把它们同时报在顶层 ready 会让"这一轮该派几条"变成一个要数两遍的问题，
     *   而拆解这一站的产出**本来就是一组子活**（见 `decomposition.children`）。
     */
    else if (outcome.stage === 'decomposed') {
      decomposed.push({
        sourceId: proposal.sourceId,
        tier: outcome.tier,
        decomposition: outcome.decomposition,
        children: Array.isArray(outcome.decomposition?.children) ? outcome.decomposition.children : [],
      })
    } else if (outcome.stage === 'rejected') {
      rejected.push({ sourceId: proposal.sourceId, because: outcome.emitted.rejectedBecause, review: outcome.emitted.review })
    } else if (outcome.stage === 'cannot-emit') {
      cannotEmit.push({
        sourceId: proposal.sourceId,
        missing: outcome.missing,
        ...outcome.becauseTier === undefined ? {} : { becauseTier: outcome.becauseTier },
      })
    } else {
      /** ★ 一个认不出的 stage ⇒ **不许静默吞掉**：那会让一条提案凭空消失。 */
      throw new Error(`runPipeline returned an unknown stage "${String(outcome.stage)}" for ${String(proposal?.sourceId)}`)
    }
    /**
     * ★ 而"没进 ready 的 stage 没有对应栏" ⇒ **当场炸**，不是静默漏计。
     *   ★★ 那正是本任务要消的那种形态：**一个读数悄悄少了一格**，
     *     而读的人会以为"这一类是 0 条"。
     *   ★ 而进了 ready 的那一条**本来就没有这一栏**（见上面那张表的注释）。
     */
    if (outcome.stage !== 'ready') {
      const column = COLUMN_BY_STAGE[outcome.stage]
      if (column === undefined) throw new Error(`main-trunk stage "${String(outcome.stage)}" has no column in notReadyBecause`)
      notReadyBecause[column] += 1
    }
  }
  return {
    /**
     * ★★ 四态（而它们不许合并 —— 契约点名的那一条）：
     *   `ready`（三条都满足）/ `awaitingRuling`（★ 大档，等人裁决）
     *   / `rejected`（审了没过）/ `cannotEmit`（契约就不完整）
     */
    rejected,
    ready,
    awaitingRuling,
    /** ★★★ P3：拆解那一栏 —— 每条大活拆成了几条子活、而每条子活走到了哪一站。 */
    decomposed,
    cannotEmit,
    /** ★ 而那一格是**读数**：被挡的有几条（它们不在这份清单里，而读的人要知道有多少）。 */
    blockedCount: (report?.blocked ?? []).length,
    /** ★ 分栏报：每一条**为什么**没进 ready（而不是一个笼统的 blocked）。 */
    notReadyBecause,
  }
}

/** `--dispatchable` 的人话形态。★ 它必须**一句话就能照做**。 */
export function renderDispatchable(result) {
  const lines = []
  lines.push(`★ 现在就能建（${result.ready.length}）—— 每一条都带完整契约与派工理由`)
  if (result.ready.length === 0) lines.push('  （无）')
  for (const entry of result.ready) {
    const c = entry.contract
    lines.push('', `── ${entry.sourceId} ──`)
    lines.push(`  agent_teams_create_task(${JSON.stringify({
      subject: c.subject,
      kind: c.kind,
      assignee: c.assignee,
    }, null, 0)})`)
    lines.push(`  subject    : ${c.subject}`)
    lines.push(`  kind       : ${c.kind}`)
    lines.push(`  objective  : ${shorten(c.objective, 100)}`)
    lines.push(`  inScope    : ${JSON.stringify(c.inScope)}`)
    if (c.outOfScope !== undefined) lines.push(`  outOfScope : ${JSON.stringify(c.outOfScope)}`)
    if (c.acceptance !== undefined) for (const a of c.acceptance) lines.push(`  acceptance : ${a}`)
    if (c.verify !== undefined) for (const v of c.verify) lines.push(`  verify     : ${v}`)
    lines.push(`  assignee   : ${c.assignee ?? '(不指派)'} —— 理由：`)
    for (const reason of entry.assignee.reasons) lines.push(`      · ${reason}`)
    if (Object.keys(entry.assignee.whyNot).length > 0) {
      lines.push('      为什么不给别人：')
      for (const [name, why] of Object.entries(entry.assignee.whyNot)) lines.push(`        - ${name}：${why}`)
    }
  }
  /**
   * ── ★★★ t98：等人裁决的队列（而它是一个**队列**，不是错误）────────────────────────
   *
   * 用户原话：「大货是不应该直接派的。需要我裁决的就留下来，等问完我的意见、裁决完之后…」
   *
   * ★ 所以这一栏的措辞是【要人回答的问题】，而不是【失败】：
   *   它开头说"等你裁决"，而每一条给出「它大在哪」与「卡在哪一问上」。
   */
  if (result.awaitingRuling.length > 0) {
    lines.push('', `── ★ 等人裁决（${result.awaitingRuling.length}）—— 大活不直接派，先拆解 ──`)
    lines.push('   ★ 它们**不是**错误，是一个队列：每条下面那一问就是需要你回答的东西。')
    for (const entry of result.awaitingRuling) {
      lines.push('', `  · [${entry.sourceId}] ${shorten(entry.subject ?? '', 70)}`)
      lines.push(`      它大在哪：${entry.whyLarge}`)
      lines.push(`      ★ 卡在哪一问：${entry.blockingQuestion}`)
      lines.push(`      下一步：${entry.nextStep === 'decompose' ? '拆解成原子活（拆完再审才可能进派发池）' : entry.nextStep}`)
      lines.push(`      写域：${(entry.inScope ?? []).join(', ') || '(未声明)'}`)
    }
  }
  /**
   * ── ★★★ P3：拆解那一栏（而它与"等人裁决"**不同形**）────────────────────────────
   *
   * ★ 这里报的是**已经拆完的**：每条大活拆成了几条、而**每条子活走到了哪一站**。
   *   ⇒ 读的人不必把三栏都扫一遍才知道"拆出来的那几条现在在哪"。
   *   ★ 而"有人要拍板"（awaitingRuling）与"拆解已经发生"（本栏）是**两件事** ——
   *     前者是队列（等一个回答），后者是**读数**（一项已完成的工作的产出）。
   */
  if ((result.decomposed ?? []).length > 0) {
    lines.push('', `── ★ 已拆解（${result.decomposed.length}）—— 每条大活拆成的子活，及其各自去向 ──`)
    for (const entry of result.decomposed) {
      lines.push('', `  · [${entry.sourceId}] ⇒ ${entry.children.length} 条子活`)
      for (const child of entry.children) {
        const where = child.inScope?.join(', ') ?? '(未声明)'
        lines.push(`      · ${where} ⇒ ${child.stage}${child.tier === undefined ? '' : ` (${child.tier})`}`)
      }
    }
  }
  if (result.cannotEmit.length > 0) {
    lines.push('', `── ★ 契约生成不出来（${result.cannotEmit.length}）—— 缺什么写在下面 ──`)
    for (const entry of result.cannotEmit) {
      lines.push(`  · ${entry.sourceId}`)
      for (const item of entry.missing) lines.push(`      缺：${item}`)
    }
  }
  if (result.blockedCount > 0) {
    lines.push('', `（另有 ${result.blockedCount} 条被写域挡着 —— 用 --json 看 blocked 那一格）`)
  }
  /**
   * ★★ 分栏报：每一条**为什么**没进 ready —— 而不是一个笼统的 blocked。
   *   （契约点名：「缺任何一条都不进 dispatchable，而每条缺什么要【分栏报】」）
   */
  const columns = result.notReadyBecause ?? {}
  lines.push(
    '',
    `★ 分栏（为什么没进"现在就能建"）：`
    + `大档等人裁决 ${columns.large ?? 0} · 已拆解 ${columns.decomposed ?? 0}`
    + ` · 审查没过 ${columns.notReviewed ?? 0}`
    + ` · 契约不全 ${columns.contractIncomplete ?? 0} · 写域被挡 ${result.blockedCount}`,
  )
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
  /**
   * ── ★★★ t95：`--team <stateRoot>` —— 派工建议要读**成员与既往任务** ────────────
   *
   * ★ 缺省指向 `.agent-teams/planning-loop`。★ 而**读不到时如实说**
   *   （见 `loadTeamForDispatch`）—— 那会让建议退化成"谁空闲"，
   *   而"我读不到你的团队"与"没人匹配得上"必须不同形。
   */
  const teamState = loadTeamForDispatch(argValue(argv, '--team', '.agent-teams/planning-loop'))

  /** ★ `--dispatchable`：只列**现在就能建**的（附完整契约 + 派工理由）。 */
  if (argv.includes('--dispatchable')) {
    const result = dispatchable(report, teamState)
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write(`${renderDispatchable(result)}\n`)
  } else if (argv.includes('--emit-task')) {
    /**
     * ★ `--emit-task <id>`：一份**可直接喂给 create_task** 的完整契约。
     *   ★ 读不到那个 id ⇒ 如实报（**不猜**、也不给一份空契约）。
     */
    const wanted = argValue(argv, '--emit-task', undefined)
    const proposal = [...report.toDispatch, ...report.blocked].find((entry) => entry.sourceId === wanted)
    if (proposal === undefined) {
      process.stdout.write(`★ 找不到 "${String(wanted)}" —— 它既不在待派里，也不在被挡里。\n`
        + `  （已看过的：${[...report.toDispatch, ...report.blocked].map((e) => e.sourceId).join(', ') || '(空)'}）\n`)
      process.exitCode = 1
    } else {
      /**
       * ── ★★★ t113：`--emit-task` 也是 `runPipeline` 的**薄包装** ──────────────────
       *
       * ★ 此前它走的是 `emitReviewedContract`（生成即审查）而**不分档** ——
       *   于是一条大活在这里会拿到一份完整的、盖了 `reviewed` 的契约，
       *   而**同一条**走 `--dispatchable` 会被判大档等人裁决。
       *   ⇒ **两条路对同一件工作给出相反处置**（本任务的行名）。
       *
       * ★★ 而现在两条出口调的是**同一个函数**：分档在主干上，
       *   它**不可能**被这个出口绕过（`runPipeline` 里 `tierOf` 那一站就是证据）。
       */
      const outcome = runPipeline(proposal, teamState)
      if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`)
      else if (outcome.stage === 'ready') {
        const c = outcome.emitted.contract
        process.stdout.write(`${JSON.stringify(c, null, 2)}\n`)
        process.stdout.write(`\n★ 分档：${outcome.tier.tier} —— ${outcome.tier.why}\n`)
        if (outcome.viaDecomposition === true) {
          process.stdout.write(`\n★ 这一格是【拆出来的】子活（${outcome.children.length} 条一起进 ready）`
            + `\n  拆法审查：${outcome.decompositionReview.outcome}\n`)
        }
        process.stdout.write(`\n★ 审查（五问）：${outcome.emitted.review.outcome}\n`)
        for (const check of outcome.emitted.review.checks) {
          process.stdout.write(`  · ${check.id}=${check.verdict} —— ${check.why}\n`)
        }
        process.stdout.write(`\n★ 写域：${outcome.emitted.scope.status}\n  ${outcome.emitted.scope.why}\n`)
        process.stdout.write(`\n★ 派工理由：\n${outcome.emitted.assignee.reasons.map((r) => `  · ${r}`).join('\n')}\n`)
        process.stdout.write(`\n★ 走过的阶段：${outcome.trace.join(' → ')}\n`)
      } else if (outcome.stage === 'awaitingRuling') {
        /**
         * ★★ 大活**不出契约** —— 这一格是本任务最要紧的读数：
         *   它此前会出契约，而那正是"派出的不应该有大活"被违反的地方。
         */
        process.stdout.write('★ 这条是【大档】⇒ **不产出可派契约**，先等人裁决/拆解。\n')
        process.stdout.write(`  它大在哪：${outcome.entry.whyLarge}\n`)
        process.stdout.write(`  ★ 卡在哪一问：${outcome.entry.blockingQuestion}\n`)
        process.stdout.write(`  下一步：${outcome.entry.nextStep}\n`)
        process.stdout.write(`  写域：${(outcome.entry.inScope ?? []).join(', ') || '(未声明)'}\n`)
        process.stdout.write(`\n★ 走过的阶段：${outcome.trace.join(' → ')}\n`)
      } else if (outcome.stage === 'rejected') {
        process.stdout.write(`★ 审查**没过** ⇒ 不产出可派契约。没过的问：\n`)
        for (const reason of outcome.emitted.rejectedBecause) process.stdout.write(`  · ${reason}\n`)
        process.stdout.write(`\n★ 分档：${outcome.tier.tier}\n★ 走过的阶段：${outcome.trace.join(' → ')}\n`)
      } else {
        process.stdout.write(`★ 这份契约**生成不出来** —— 缺：\n${outcome.missing.map((m) => `  · ${m}`).join('\n')}\n`)
        if (outcome.tier !== undefined) process.stdout.write(`\n★ 分档：${outcome.tier.tier} —— ${outcome.tier.why}\n`)
        process.stdout.write(`\n★ 走过的阶段：${outcome.trace.join(' → ')}\n`)
      }
    }
  } else if (argv.includes('--tier')) {
    /**
     * ── ★★★ t113：`--tier <id>` —— 一条**故意最小**的出口，只为回答一个问题 ──────────
     *
     * ★ 「同一提案走 `--emit-task` 与 `--dispatchable` 得到**相同**的分档与放行结论」
     *   这一条判据需要一个**能同时驱动两个出口**的读数。而此前的两个出口各自
     *   **写了一遍阶段** ⇒ 让它们相等要在一个方向上改两处 —— 那是把判据绑在写法上。
     *
     * ★★ ⇒ 加上这一格：它按 `{ sourceId, outcome, tier }` 的形状印出来，而
     *   `--dispatchable --json` 的四格也用**同一份**分档对象（`entry.tier`）。
     *   ⇒ 「两个出口给出同一份分档」可以是一条对象比对，而不是字符串比对。
     *
     * ★ 而它**自己不走一遍阶段**：它读 `dispatchable()` 的结论（同一份输入、同一次分档），
     *   只是换一个**形状**印出来 —— 于是它不会成为第二种口径。
     */
    const wanted = argValue(argv, '--tier', undefined)
    const stubs = dispatchable(report, teamState)
    const stubsByOutcome = [
      ...stubs.ready.map((entry) => ({ sourceId: entry.sourceId, outcome: 'ready', tier: entry.tier })),
      ...stubs.awaitingRuling.map((entry) => ({ sourceId: entry.sourceId, outcome: 'awaitingRuling', tier: entry.tier })),
      ...stubs.rejected.map((entry) => ({ sourceId: entry.sourceId, outcome: 'rejected', tier: entry.tier })),
      ...stubs.cannotEmit.map((entry) => ({ sourceId: entry.sourceId, outcome: 'cannot-emit', tier: entry.tier })),
    ].filter((stub) => stub.sourceId === wanted)
    const known = [...report.toDispatch, ...report.blocked].some((entry) => entry.sourceId === wanted)
    if (!known) {
      process.stdout.write(`★ 找不到 "${String(wanted)}" —— 它既不在待派里，也不在被挡里。\n`)
      process.exitCode = 1
    } else if (argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(stubsByOutcome, null, 2)}\n`)
    } else if (stubsByOutcome.length === 0) {
      process.stdout.write(`★ [${String(wanted)}] 不在 --dispatchable 的任一格里（它不在待派清单里）。\n`)
    } else {
      for (const stub of stubsByOutcome) {
        process.stdout.write(`★ [${stub.sourceId}] ${stub.outcome} · 分档=${stub.tier.tier}\n  ${stub.tier.why}\n`)
      }
    }
  } else if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`${render(report)}\n`)
}

/**
 * 读团队状态（成员 + 既往任务）—— 而**读不到时如实说**。
 *
 * ★ 三态：
 *   `{ members, tasks, unreadable: undefined }`  —— 读到了
 *   `{ members: [], tasks: [], unreadable: '<原因>' }` —— ★ 读不到
 * ⇒ 而下游要能分开它们：读不到时那条建议必须说"我读不到你的团队"，
 *   而**不是**"没人匹配得上"（后者是"我看了，确实没有"）。
 */
export function loadTeamForDispatch(root) {
  const read = readJsonDir(root === undefined ? undefined : join(root))
  if (read === undefined) return { members: [], tasks: [], unreadable: `团队状态读不到（${String(root)}/team.json）` }
  const team = read.records.find((record) => Array.isArray(record?.members) && Array.isArray(record?.tasks))
  if (team === undefined) {
    return { members: [], tasks: [], unreadable: `团队状态里没有 members/tasks 两格（${String(root)}）` }
  }
  return { members: team.members, tasks: team.tasks, unreadable: undefined }
}
