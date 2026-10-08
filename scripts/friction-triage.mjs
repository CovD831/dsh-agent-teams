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
  for (const proposal of report?.toDispatch ?? []) {
    /**
     * ── ★★★ t97：`--dispatchable` 走**带审查**的那条路 ─────────────────────────
     * 用户原话：「在自动生成的时候就可以去做了…带一个『已审查』的字段」
     * ⇒ 生成与审查是**一步**，不是两步。
     */
    const emitted = emitReviewedContract(proposal, options)
    if (emitted.status === 'executable') ready.push({ proposal, ...emitted })
    else if (emitted.status === 'rejected') rejected.push({ sourceId: proposal.sourceId, because: emitted.rejectedBecause, review: emitted.review })
    else cannotEmit.push({ sourceId: proposal.sourceId, missing: emitted.missing })
  }
  return {
    /**
     * ★★ 三态（而三者不许合并 —— 契约点名的那一条）：
     *   `ready`（审过了）/ `rejected`（审了没过）/ `cannotEmit`（契约就不完整）
     */
    rejected,
    ready,
    cannotEmit,
    /** ★ 而那一格是**读数**：被挡的有几条（它们不在这份清单里，而读的人要知道有多少）。 */
    blockedCount: (report?.blocked ?? []).length,
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
      /** ★★★ t97：`--emit-task` 也走**同一条**（生成即审查）。 */
      const emitted = emitReviewedContract(proposal, teamState)
      if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(emitted, null, 2)}\n`)
      else if (emitted.status === 'executable') {
        process.stdout.write(`${JSON.stringify(emitted.contract, null, 2)}\n`)
        process.stdout.write(`\n★ 审查（五问）：${emitted.review.outcome}\n`)
        for (const check of emitted.review.checks) {
          process.stdout.write(`  · ${check.id}=${check.verdict} —— ${check.why}\n`)
        }
        process.stdout.write(`\n★ 写域：${emitted.scope.status}\n  ${emitted.scope.why}\n`)
        process.stdout.write(`\n★ 派工理由：\n${emitted.assignee.reasons.map((r) => `  · ${r}`).join('\n')}\n`)
      } else if (emitted.status === 'rejected') {
        process.stdout.write(`★ 审查**没过** ⇒ 不产出可派契约。没过的问：\n`)
        for (const reason of emitted.rejectedBecause) process.stdout.write(`  · ${reason}\n`)
      } else {
        process.stdout.write(`★ 这份契约**生成不出来** —— 缺：\n${emitted.missing.map((m) => `  · ${m}`).join('\n')}\n`)
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
