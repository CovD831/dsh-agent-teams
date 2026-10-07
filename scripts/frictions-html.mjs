#!/usr/bin/env node
/**
 * ── 卡点台账 → HTML（给人读的那一份）─────────────────────────────────────────
 *
 * ★ 用户裁定的分工：
 *     机器读：.agent-teams/frictions/*.json（原始记录，唯一真源）
 *     人  读：本脚本生成的 HTML
 *
 * ★ 它【只读】JSON，不写回任何东西 —— 台账是记录，记录不可重算
 *   （`frictions/README.md` 第一条纪律）。
 *
 * ── 三个维度（用户裁定）──────────────────────────────────────────────────────
 *   ① 按【池子】分：需上报（escalate）/ 可自解（self）
 *      ★ 用户原话：「可以自行解决的卡点：也不是说不需要给我看，
 *        最后也需要列出来，让我知道你自己做了什么裁决。」
 *   ② 按【状态】分：已修 / 未修 / 已排任务
 *   ③ 按【本质】分：聚类 —— 同族的卡点放在一起
 *
 * ★ 用法：node scripts/frictions-html.mjs [输出路径]
 *
 * ★ 默认输出到 `docs/frictions.html`（**不是** .agent-teams/ 下面）——
 *   MEASURED（2026-10-07）：第一版写在 `.agent-teams/frictions.html`，
 *   而那是【隐藏目录】⇒ 用户在项目目录里看不到它。
 *   而这一份是【给人读的】，藏在隐藏目录里等于没生成。
 *   ★ 判据：一个产物的受众，决定了它该放在哪。
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = join(ROOT, '.agent-teams', 'frictions')
const OUT = process.argv[2] ?? join(ROOT, 'docs', 'frictions.html')
/**
 * ── ★★ t57：判决是【第二种记录】，而它必须有自己的一份产物 ──────────────────────
 *
 * ★ 为什么是【另一份文件】而不是拼进同一份：
 *   卡点说「我卡住了」；判决说「我学到了」。
 *   ⇒ 合并会让「执行到位」与「出问题了」同形 —— 而那正是本队一直防的那条。
 *   ⇒ 两份产物、两组字段、两个阅读入口。
 *
 * ★ 输出路径由 `OUT` 推导：默认 `docs/frictions.html` ⇒ 判决落 `docs/judgements.html`。
 *   调用方若给了自定义 `OUT`（夹具就是），判决跟着它走 ——
 *   于是"两份产物总在同一处"是一个可依赖的性质，而不是一句巧合。
 */
const OUT_JUDGEMENTS = process.argv[3] ?? join(dirname(OUT), 'judgements.html')
/** 判决的来源目录。★ 与 `frictions/` 并列，而不是嵌在它里面（两种记录，两条通路）。 */
const JUDGEMENT_DIR = join(ROOT, '.agent-teams', 'judgements')

/**
 * ── ★★ 三态：生成成功 / 降级（有坏条目）/ 无法生成（台账目录不存在）────────────
 *
 * ★ 为什么 ③（无法生成）也必须 exit 0：
 *   台账是**按项目分**的（`frictions/README.md`）⇒ 一个干净 checkout 里
 *   没有 `.agent-teams/frictions/` 是**正常**的，不是故障。
 *   让它 exit≠0 会把"不适用"当成"失败"，而它一旦挂进 `pnpm verify`（`&&` 串联），
 *   每一个没有台账的环境都会在 verify 上失败。
 *   ★ 而后果比"多一条红"更坏：为了通过验证，人会去删/改台账 ——
 *     那会把「记录工具」变成「门禁」，而记录工具的第一条纪律是记录不可重算。
 *
 * ★ 但 ③ 与 ① 必须在**输出上**不同形：都 exit 0，而必须说得出发生了什么。
 *   否则"我生成了 38 条"与"我什么都没找到"在日志里长得一模一样 ——
 *   那正是本队记账的三态合流。
 *
 * ★ 实现上，它是【catch ENOENT 并把状态说清】，而不是让异常抛到栈顶：
 *   一条原始 stack trace 与"生成器坏了"同形，而它与"这个环境没有台账"不同形。
 *   MEASURED（2026-10-07，接线时实测）：此前缺台账目录 ⇒ 未捕获的 ENOENT +
 *   exit 1 + 无输出，读起来完全像生成器崩了。
 */
function load() {
  if (!existsSync(DIR)) return { entries: [], broken: [], available: false }
  const out = []
  const broken = []
  for (const f of readdirSync(DIR).filter((f) => /^f-\d+\.json$/.test(f)).sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(DIR, f), 'utf8')))
    } catch (error) {
      broken.push({ file: f, why: String(error?.message ?? error) })
    }
  }
  return { entries: out, broken, available: true }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * ── ★★ 判决的读取：三态，且与卡点那一侧【逐条对齐】────────────────────────────
 *
 *   `available: false`  —— 判决目录不存在（这一条通路还没接上）
 *   `entries: []`       —— 目录在，但还没有判决
 *   `entries: [...]`    —— 有判决
 *
 * ★ 前两者【最容易被做成同形】（都渲染成"0 条"），而它们说的是两件事：
 *   前者是"这一格没有接上"，后者是"接上了，而确实还没有结论"。
 *   ⇒ 本队记账：三态不同形。
 *
 * ★ 坏条目与卡点那一侧同一口径：**解析失败不静默跳过** ——
 *   一条坏记录与一条不存在的记录必须不同形。
 */
function loadJudgements() {
  if (!existsSync(JUDGEMENT_DIR)) return { entries: [], broken: [], available: false }
  const out = []
  const broken = []
  for (const f of readdirSync(JUDGEMENT_DIR).filter((f) => /^j-\d+\.json$/.test(f)).sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(JUDGEMENT_DIR, f), 'utf8')))
    } catch (error) {
      broken.push({ file: f, why: String(error?.message ?? error) })
    }
  }
  return { entries: out, broken, available: true }
}

/**
 * ── ★★ 判决的状态：读【显式字段】，缺字段⇒ `unknown`，绝不舍默成 `adopted` ────────
 *
 * ★ 为什么这一格重要：一条【没人标注过】的判决与一条【已被采纳】的判决，
 *   在读者眼里如果同形，那么"未检验的声称"就混进了"结论"里 ——
 *   而 README 写明判决的价值恰恰在于它能被证伪、被降级。
 *   ⇒ 缺字段与非法值都落 `unknown`，且它在页面上有**自己的**标签与措辞。
 */
const JUDGEMENT_STATUSES = ['adopted', 'refuted', 'pending']
function judgementStatusOf(j) {
  const s = j?.status
  return JUDGEMENT_STATUSES.includes(s) ? s : 'unknown'
}
const JUDGEMENT_STATUS_LABEL = {
  adopted: '已采纳',
  refuted: '★ 已被证伪',
  pending: '待定',
  unknown: '★ 未标注状态',
}
const JUDGEMENT_STATUS_NOTE = {
  adopted: '它经得住目前的反例 —— 而那不等于它被证明了。',
  refuted: '★ 它在某次卡点里被证伪 ⇒ 已降级（按 README：保留原 id，status 改成 refuted）。',
  pending: '有人记下了它，而还没有裁定采纳或证伪。',
  unknown: '★ 这条记录没有可识别的 status ⇒ 它【不是】"已采纳"，是"没人标注过"。两者必须不同形。',
}

/**
 * ── ★★★ 一张判决卡 ─────────────────────────────────────────────────────────────
 *
 * ★ `counterexample` 单独成块、带自己的 class 与标题，且**紧跟在 claim 之后** ——
 *   README 写明：判决必须带反例，否则它就是一个【未检验的声称】。
 *   ⇒ 把它埋在页面末尾等于让每条判决都退化成一个声称。
 */
function judgementCard(j) {
  const st = judgementStatusOf(j)
  return `
  <article class="jcard ${st}">
    <header>
      <span class="id">${esc(j.id)}</span>
      <span class="pill jstatus-${st}">${esc(JUDGEMENT_STATUS_LABEL[st])}</span>
      ${j.project ? `<span class="pill">${esc(j.project)}</span>` : ''}
      ${j.at ? `<span class="pill">${esc(j.at)}</span>` : ''}
    </header>
    <h3 class="claim">${esc(j.claim)}</h3>
    <div class="counter">
      <b>★ 什么会证伪它</b>
      <p>${esc(j.counterexample ?? '（这一格是空的）')}</p>
      ${j.counterexample ? '' : '<p class="why">★ 一条没有反例的判决是一个【未检验的声称】—— 它与猜测同形。</p>'}
    </div>
    <dl>
      <dt>它从哪来</dt><dd>${esc(j.scene?.from)}${j.scene?.what ? `<div class="why">${esc(j.scene.what)}</div>` : ''}</dd>
      <dt>怎么复用</dt><dd>${esc(j.reuse)}</dd>
      <dt>状态含义</dt><dd class="why">${esc(JUDGEMENT_STATUS_NOTE[st])}</dd>
      ${j.notes?.length ? `<dt>备注</dt><dd><ul>${j.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>` : ''}
    </dl>
  </article>`
}

/**
 * ── 本质归类 ────────────────────────────────────────────────────────────────
 * ★ 这不是"判断本质/表象"（那件事本队已论证过做不到），
 *   而是【按已记录的共同形状分组】—— 分组规则写在下面，可复核、可争议。
 */
const ESSENCES = [
  {
    id: 'stale-source',
    name: '读了过期的来源',
    why: '机制读了一个来源，而那个来源不是它声称的那个 —— 于是它给出一个看起来正常的答案',
    match: (e) => ['stale-module', 'misclassified'].some((k) => (e.index?.kind ?? []).includes(k)) &&
      /旧模块|过期|构建产物|不匹配|旧绑定|stale/i.test(`${e.title} ${e.notes?.join(' ')}`),
  },
  {
    id: 'unsatisfiable',
    name: '某类任务在判据上恒不可满足',
    why: '判据本身诚实（报「没能测量」），但它的输入面在某类任务上永远接不上 ⇒ 那类任务永远无法收口',
    match: (e) => (e.index?.kind ?? []).includes('unsatisfiable'),
  },
  {
    id: 'misclassified',
    name: '把「没能测量」读成了「测出来了」',
    why: '三态合流：unmeasured 被当成 ok 或 blocked ⇒ 症状与「这一轮本来不适用」同形',
    match: (e) => (e.index?.kind ?? []).includes('misclassified'),
  },
  {
    id: 'unwired',
    name: '装了但调不到 / 建了但没接',
    why: '声明写对了、机制也建好了，而中间那一格没接线 ⇒ 静默不生效',
    match: (e) => ['unwired', 'uncalled', 'unread'].some((k) => (e.index?.kind ?? []).includes(k)),
  },
  {
    id: 'quantity-over-property',
    name: '量大于性质',
    why: '它读的量超过了它声称的性质 ⇒ 在一个它没想到的输入上给出错误的裁决',
    match: (e) => /量大于性质|量超过了|超过了它声称/.test(`${e.notes?.join(' ')} ${e.observed?.couldNotObserve?.join(' ')}`) ||
      (e.index?.kind ?? []).includes('overreaching'),
  },
  {
    id: 'fixture-shaped',
    name: '夹具造出的与产品造出的同形',
    why: '夹具自己的构造错误在返回值上与产品缺陷同形 ⇒ 会把人送到错误的代码去',
    match: (e) => /夹具造出|夹具自己|假臂|恒真|恒红/.test(`${e.title} ${e.notes?.join(' ')}`),
  },
]

function essenceOf(e) {
  for (const rule of ESSENCES) if (rule.match(e)) return rule
  return { id: 'other', name: '未归类', why: '★ 它没落进任何已知分组 —— 那不是缺陷，是「分组规则该扩了」的信号' }
}

/**
 * 状态：读 `resolution.state` 这个【显式字段】。
 *
 * ★ MEASURED（2026-10-07，第一版）：用 `resolution.fix` 的措辞正则判断 ⇒
 *   在 26 条里判错了 14 条 —— 它们写的是「去掉了 kind 条件」「五处 schema 改闭合」，
 *   那是【做了什么】，不是【还没做】。
 * ⇒ 判据：状态是【结构化事实】，不该从措辞里猜。
 *
 * ★ 而缺字段时【不猜】：返回 'unknown'，并在视图里显示成「未标注状态」——
 *   那与「开着」不同形，而后者会让人以为有人管着。
 */
function statusOf(e) {
  const s = e.resolution?.state
  return s === 'fixed' || s === 'scheduled' || s === 'open' || s === 'wontfix' ? s : 'unknown'
}

/** 每个状态的一句话解释 —— 让人不必猜这一栏是什么意思。 */
const STATE_NOTE = {
  fixed: '已经修好并落地（有 commit / 有实测读数）。',
  scheduled: '★ 修法与理由已定，但【还没落地】—— 典型情况是排在一条写域串行链的后面，或等一个前置任务。',
  open: '还没定修法，或修法未定。',
  wontfix: '★ 明确不修 + 理由 —— 这一格存在的理由是：「不修」是一个决定，不是遗忘。',
  unknown: '★ 这条记录没有 state 字段 —— 它【不是】「开着」，是「没人标注过」。两者必须不同形。',
}

const STATUS_LABEL = {
  fixed: '已修',
  scheduled: '已排任务 / 未修',
  open: '开着',
  wontfix: '★ 明确不修',
  unknown: '★ 未标注状态',
}

const POOL_LABEL = { escalate: '★ 需上报（要你做裁决）', self: '可自解（leader 已裁）' }

function entryCard(e) {
  const ess = essenceOf(e)
  const st = statusOf(e)
  return `
  <article class="card ${esc(e.resolution?.pool ?? 'self')}">
    <header>
      <span class="id">${esc(e.id)}</span>
      <span class="pill ${st}">${esc(STATUS_LABEL[st])}</span>
      <span class="pill ess">${esc(ess.name)}</span>
      ${e.resolution?.blocking ? '<span class="pill block">阻塞任务</span>' : ''}
    </header>
    <h3>${esc(e.title)}</h3>
    <dl>
      <dt>在哪</dt><dd><code>${esc(e.index?.component)}</code>${(e.index?.kind ?? []).length ? ` · ${esc(e.index.kind.join(' / '))}` : ''}</dd>
      <dt>机制当时说的</dt><dd class="quote">${esc(firstVerdict(e))}</dd>
      ${e.observed?.couldNotObserve?.length ? `<dt>没能观测到的</dt><dd><ul>${e.observed.couldNotObserve.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>` : ''}
      <dt>临时裁决</dt><dd>${esc(e.resolution?.leaderRuling)}</dd>
      <dt>后来怎么处理的</dt><dd>${esc(e.resolution?.fix)}${e.resolution?.whyPool ? `<div class="why">为什么进这个池子：${esc(e.resolution.whyPool)}</div>` : ''}</dd>
      ${e.unknown?.length ? `<dt>还不知道的</dt><dd><ul>${e.unknown.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>` : ''}
      ${e.notes?.length ? `<dt>备注</dt><dd><ul>${e.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>` : ''}
      <dt>能不能重放</dt><dd>${e.index?.replayable ? '能' : '<b>不能</b> —— 这条记录缺复现所需的上下文'}</dd>
    </dl>
  </article>`
}

function firstVerdict(e) {
  const v = e.observed?.verdict ?? {}
  const b = Array.isArray(v.blockers) ? v.blockers[0] : undefined
  return v.unmeasured ?? b ?? v.note ?? '(无)'
}

function section(title, sub, items) {
  if (!items.length) return ''
  return `<section><h2>${esc(title)} <span class="count">${items.length}</span></h2>
    ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
    <div class="grid">${items.map(entryCard).join('')}</div></section>`
}

const { entries, broken, available } = load()

/**
 * ── ★★ t57：判决那一侧【独立生成】，不随卡点那一侧的早退一起消失 ────────────────
 *
 * ★ 为什么必须独立：缺判决目录不该拖垮卡点（契约明写），而**反过来也成立** ——
 *   一个没有卡点目录的环境仍可能已经写了判决。
 *   ⇒ 把两侧做成"各自判自己的三态"，而不是"一个总开关"。
 *
 * ★ 三态（判决侧）：
 *     absent  ⇒ 判决目录不存在        —— 这一条通路还没接上
 *     empty   ⇒ 目录在、没有判决      —— 接上了，确实还没有结论
 *     present ⇒ 有判决
 *   三者必须不同形，且**都必须 exit 0** —— 记录工具不许变成门禁。
 */
const JUDGEMENT_STYLE = `
  :root { --fg:#1a1a1a; --dim:#666; --line:#e3e3e3; --bg:#fafafa; --acc:#0b5fff;
          --adopted:#2f855a; --refuted:#c0392b; --pending:#b7791f; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --dim:#9a9a9a; --line:#333;
          --bg:#141414; --acc:#6ea8ff; --adopted:#5fd39a; --refuted:#ff6b5e; --pending:#e0b050; } }
  * { box-sizing:border-box }
  body { margin:0; padding:2.5rem 2rem 6rem; background:var(--bg); color:var(--fg);
         font:15px/1.65 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; }
  h1 { font-size:1.6rem; margin:0 0 .3rem }
  h2 { font-size:1.15rem; margin:2.5rem 0 .6rem; padding-bottom:.4rem; border-bottom:1px solid var(--line) }
  h3 { font-size:1.05rem; margin:.2rem 0 .7rem }
  .lede { color:var(--dim); margin:0 0 2rem }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(460px,1fr)); gap:1rem }
  .jcard { background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem }
  .jcard.adopted { border-left:4px solid var(--adopted) }
  .jcard.refuted { border-left:4px solid var(--refuted) }
  .jcard.pending { border-left:4px solid var(--pending) }
  .jcard.unknown { border-left:4px solid var(--dim); border-style:dashed }
  .jcard header { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; margin-bottom:.3rem }
  .id { font-family:ui-monospace,monospace; color:var(--dim); font-size:.85rem }
  .pill { font-size:.72rem; padding:.15rem .5rem; border-radius:999px; border:1px solid var(--line); color:var(--dim) }
  .pill.jstatus-adopted { color:var(--adopted); border-color:var(--adopted) }
  .pill.jstatus-refuted { color:var(--refuted); border-color:var(--refuted) }
  .pill.jstatus-pending { color:var(--pending); border-color:var(--pending) }
  dl { margin:0; display:grid; grid-template-columns:5.5rem 1fr; gap:.35rem .8rem; font-size:.92rem }
  dt { color:var(--dim); font-size:.85rem; padding-top:.1rem }
  dd { margin:0 }
  ul { margin:0; padding-left:1.1rem } li { margin:.15rem 0 }
  code { font-family:ui-monospace,monospace; font-size:.85em; background:rgba(127,127,127,.12);
         padding:.05rem .3rem; border-radius:4px }
  /* ★★★ 反例那一块：边框 + 底色 + 加粗标签 —— 它必须一眼可见 */
  .counter { border:2px solid var(--refuted); border-radius:8px; padding:.6rem .75rem; margin:0 0 .9rem;
             background:rgba(192,57,43,.06) }
  .counter b { color:var(--refuted); font-size:.85rem }
  .counter p { margin:.3rem 0 0 }
  .why { color:var(--dim); font-size:.85rem; margin-top:.25rem }
  .note { border:1px solid var(--line); border-radius:10px; padding:1rem; margin:1rem 0; color:var(--dim) }
  .warn { border:1px solid var(--refuted); border-radius:10px; padding:1rem; margin:1.5rem 0 }
  a { color:var(--acc) }
</style>`

{
  const j = loadJudgements()
  const byStatus = Object.fromEntries(
    ['adopted', 'refuted', 'pending', 'unknown'].map((s) => [s, j.entries.filter((e) => judgementStatusOf(e) === s)]),
  )
  /** ★ 缺反例的判决单独列出来 —— 它是"未检验的声称"，而那不是一种状态，是一个缺口。 */
  const missingCounter = j.entries.filter((e) => !e.counterexample)

  const body = j.available
    ? `${j.entries.length} 条判决 · 生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
      + ` · 机器读的是 <code>.agent-teams/judgements/*.json</code>（唯一真源）`
    : '这一条通路【还没有接上】：没有 <code>.agent-teams/judgements/</code> 目录。'
      + '★ 这不是故障 —— 但它与「接上了、确实还没有判决」是两件事。'

  const sections = []
  if (!j.available) {
    sections.push(`<div class="note"><b>★ 判决目录不存在</b>
      <div class="why">「这一格没有接上」与「接上了、确实还没有判决」必须不同形 ——
      前者是配置问题，后者是事实。本页是前者。</div></div>`)
  } else if (j.entries.length === 0) {
    sections.push(`<div class="note"><b>目录在，而还没有判决</b>
      <div class="why">这一条通路是通的，只是还没有人写下结论。
      ★ 它与「没有这个目录」不同形：那一边是没接上，这一边是接上了而为空。</div></div>`)
  } else {
    for (const [status, list] of Object.entries(byStatus)) {
      if (list.length === 0) continue
      sections.push(`<section><h2>${esc(JUDGEMENT_STATUS_LABEL[status])} <span style="color:var(--dim);font-weight:400;font-size:.9rem">${list.length} 条</span></h2>
        <p class="why">${esc(JUDGEMENT_STATUS_NOTE[status])}</p>
        <div class="grid">${list.map(judgementCard).join('')}</div></section>`)
    }
    if (missingCounter.length > 0) {
      sections.push(`<div class="warn"><b>★ ${missingCounter.length} 条判决没有反例</b>
        <ul>${missingCounter.map((e) => `<li><b>${esc(e.id)}</b>：${esc(e.claim)}</li>`).join('')}</ul>
        <div class="why">按 README：判决必须带反例，否则它就是一个【未检验的声称】——
        而未检验的声称与猜测同形。</div></div>`)
    }
  }

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>判决台账 · ${j.entries.length} 条</title>
<style>${JUDGEMENT_STYLE}</head><body>

<h1>判决台账</h1>
<p class="lede">${body}</p>

<p class="lede">★ 这是【第二种记录】。它与<a href="frictions.html">卡点台账</a>是两条通路，<b>不合并呈现</b>：
  卡点说「我卡住了」（场景 / 观测 / 未知 / 处置）；
  判决说「我学到了」（claim / 反例 / 复用 / 状态）。
  ★ 合并会让「执行到位」与「出问题了」同形。</p>

${j.broken.length ? `<div class="warn"><b>★ ${j.broken.length} 条判决读不出来</b>
  <ul>${j.broken.map((b) => `<li>${esc(b.file)}: ${esc(b.why)}</li>`).join('')}</ul>
  <div class="why">一条坏记录与一条不存在的记录必须不同形 —— 所以它们在这里，而不是被跳过。</div></div>` : ''}

${sections.join('\n')}

<footer style="margin-top:4rem;color:var(--dim);font-size:.85rem">
  ★ 每张卡片里那个红色框就是这条判决的<b>反例</b> —— 它回答「什么会证伪它」。<br>
  ★ 本页只读 JSON，不写回任何东西：记录不可重算。
</footer>
</body></html>`

  writeFileSync(OUT_JUDGEMENTS, html)
  /**
   * ★ 三态在【输出文本】上必须分得开（都 exit 0，所以"说了什么"是唯一的区分面）：
   *     absent  ⇒ "无法生成：判决目录不存在"
   *     empty   ⇒ "生成成功（判决侧为空）：目录在，而还没有判决"
   *     present ⇒ "生成成功（判决）：N 条"
   */
  if (!j.available) {
    console.log(`无法生成（判决侧）：判决目录不存在 —— ${JUDGEMENT_DIR}`)
    console.log('  ★ 这不是故障：判决是另一种记录，没有它是正常的。')
    console.log('  ★ 它与「目录在、而还没有判决」不同形 —— 前者是没接上，后者是接上了而为空。')
  } else if (j.entries.length === 0) {
    console.log('生成成功（判决侧为空）：目录在，而还没有判决')
    console.log(`  写出 ${OUT_JUDGEMENTS}`)
  } else {
    console.log(`生成成功（判决）：${j.entries.length} 条`)
    console.log(`  写出 ${OUT_JUDGEMENTS}`)
    if (j.broken.length) console.log(`  ★ ${j.broken.length} 条判决读不出来：${j.broken.map((b) => b.file).join(', ')}`)
    if (missingCounter.length) console.log(`  ★ ${missingCounter.length} 条判决没有反例（= 未检验的声称）`)
  }
}

/**
 * ── ★ 状态 ③：无法生成（台账目录不存在）─────────────────────────────────────
 *
 * ★ 在写文件【之前】返回：绝不写一份"0 条"的 HTML。
 *   后者会覆盖一份真有内容的 `docs/frictions.html`，让读者以为台账是空的 ——
 *   而"台账是空的"与"这个环境没有台账"是两件事。
 */
if (!available) {
  console.log(`无法生成：台账目录不存在 —— ${DIR}`)
  console.log('  ★ 这不是故障：台账按项目分，一个干净 checkout 里没有它是正常的。')
  console.log('  ★ 已跳过生成，且【没有】覆盖既有的 docs/frictions.html（一份空的视图比没有更坏）。')
  process.exit(0)
}

// ── ① 池子 ──────────────────────────────────────────────────────────────────
const escalate = entries.filter((e) => e.resolution?.pool === 'escalate')
const self = entries.filter((e) => e.resolution?.pool !== 'escalate')

// ── ② 状态（读显式字段）──────────────────────────────────────────────────────
const ALL_STATES = ['fixed', 'scheduled', 'open', 'wontfix', 'unknown']
const byStatus = Object.fromEntries(ALL_STATES.map((s) => [s, entries.filter((e) => statusOf(e) === s)]))

// ── ③ 本质 ──────────────────────────────────────────────────────────────────
const byEssence = new Map()
for (const e of entries) {
  const ess = essenceOf(e)
  if (!byEssence.has(ess.id)) byEssence.set(ess.id, { ...ess, items: [] })
  byEssence.get(ess.id).items.push(e)
}
const essenceGroups = [...byEssence.values()].sort((a, b) => b.items.length - a.items.length)

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>卡点台账 · ${entries.length} 条</title>
<style>
  :root { --fg:#1a1a1a; --dim:#666; --line:#e3e3e3; --bg:#fafafa; --acc:#0b5fff;
          --block:#c0392b; --sched:#b7791f; --fixed:#2f855a; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --dim:#9a9a9a; --line:#333;
          --bg:#141414; --acc:#6ea8ff; --block:#ff6b5e; --sched:#e0b050; --fixed:#5fd39a; } }
  * { box-sizing:border-box }
  body { margin:0; padding:2.5rem 2rem 6rem; background:var(--bg); color:var(--fg);
         font:15px/1.65 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; }
  h1 { font-size:1.6rem; margin:0 0 .3rem }
  h2 { font-size:1.15rem; margin:3rem 0 .3rem; padding-bottom:.4rem; border-bottom:1px solid var(--line) }
  h3 { font-size:1rem; margin:.2rem 0 .8rem }
  .lede { color:var(--dim); margin:0 0 2rem }
  .count { color:var(--dim); font-weight:400; font-size:.9rem }
  .sub { color:var(--dim); font-size:.9rem; margin:.3rem 0 1rem }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(420px,1fr)); gap:1rem }
  .card { background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem }
  .card.escalate { border-left:4px solid var(--block) }
  .card header { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; margin-bottom:.3rem }
  .id { font-family:ui-monospace,monospace; color:var(--dim); font-size:.85rem }
  .pill { font-size:.72rem; padding:.15rem .5rem; border-radius:999px; border:1px solid var(--line); color:var(--dim) }
  .pill.fixed { color:var(--fixed); border-color:var(--fixed) }
  .pill.scheduled { color:var(--sched); border-color:var(--sched) }
  .pill.block { color:var(--block); border-color:var(--block) }
  dl { margin:0; display:grid; grid-template-columns:5.5rem 1fr; gap:.35rem .8rem; font-size:.92rem }
  dt { color:var(--dim); font-size:.85rem; padding-top:.1rem }
  dd { margin:0 }
  ul { margin:0; padding-left:1.1rem } li { margin:.15rem 0 }
  code { font-family:ui-monospace,monospace; font-size:.85em; background:rgba(127,127,127,.12);
         padding:.05rem .3rem; border-radius:4px }
  .quote { color:var(--dim); font-style:italic }
  .why { color:var(--dim); font-size:.85rem; margin-top:.25rem }
  .warn { border:1px solid var(--block); border-radius:10px; padding:1rem; margin:1.5rem 0 }
  .toc { columns:2; font-size:.9rem } .toc a { color:var(--acc); text-decoration:none }
</style></head><body>

<h1>卡点台账</h1>
<p class="lede">
  ${entries.length} 条 · 生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
  · 机器读的是 <code>.agent-teams/frictions/*.json</code>（唯一真源），本页是它的视图
</p>

${broken.length ? `<div class="warn"><b>★ ${broken.length} 条记录读不出来</b><ul>${broken.map((b) => `<li>${esc(b.file)}: ${esc(b.why)}</li>`).join('')}</ul>
  <div class="why">一条坏记录与一条不存在的记录必须不同形 —— 所以它们在这里，而不是被跳过。</div></div>` : ''}

<section>
  <h2>三个维度</h2>
  <p class="sub">同一批 ${entries.length} 条，按三种方式各看一遍。★ 一条卡点可能同时属于多个本质 —— 那正是「本质/表象」不可判定这件事的产物。</p>
  <div class="toc">
    <div><b>① 按池子</b>（谁做的决定）<br>
      · <a href="#pool-escalate">需上报 ${escalate.length} 条</a><br>
      · <a href="#pool-self">可自解 ${self.length} 条</a></div>
    <div><b>② 按状态</b>（办到哪了）<br>
      ${ALL_STATES.filter((s) => byStatus[s].length).map((s) =>
        `<a href="#st-${s}">${STATUS_LABEL[s]} ${byStatus[s].length}</a>`).join(' · ')}</div>
    <div><b>③ 按本质</b>（同族的放一起）<br>
      ${essenceGroups.map((g) => `· <a href="#es-${esc(g.id)}">${esc(g.name)} ${g.items.length}</a>`).join('<br>')}</div>
  </div>
</section>

<section id="pool-escalate">
  <h2>① 需上报 <span class="count">${escalate.length} 条</span></h2>
  <p class="sub">这些是【要你做裁决】的 —— 不是因为难，而是因为没有一个不依赖判断主体的正确答案。
     ★ 上报的是【本质问题】，不是表象。</p>
  ${escalate.length ? `<div class="grid">${escalate.map(entryCard).join('')}</div>`
    : '<p class="sub">（暂无）</p>'}
</section>

<section id="pool-self">
  <h2>① 可自解 <span class="count">${self.length} 条</span></h2>
  <p class="sub">leader 已裁的 —— <b>也列给你看</b>：让你知道我自己做了什么裁决。</p>
  <div class="grid">${self.map(entryCard).join('')}</div>
</section>

${ALL_STATES.filter((s) => byStatus[s].length).map((s) => `
<section id="st-${s}"><h2>② ${STATUS_LABEL[s]} <span class="count">${byStatus[s].length}</span></h2>
  ${STATE_NOTE[s] ? `<p class="sub">${STATE_NOTE[s]}</p>` : ''}
  <div class="grid">${byStatus[s].map(entryCard).join('')}</div></section>`).join('')}

${essenceGroups.map((g) => `
<section id="es-${esc(g.id)}">
  <h2>③ ${esc(g.name)} <span class="count">${g.items.length}</span></h2>
  <p class="sub">${esc(g.why)}</p>
  <div class="grid">${g.items.map(entryCard).join('')}</div>
</section>`).join('')}

<footer style="margin-top:4rem;color:var(--dim);font-size:.85rem">
  ★ 分组规则写在 <code>scripts/frictions-html.mjs</code> 的 <code>ESSENCES</code> 里 ——
  它可复核、可争议，而<b>不是</b>一次「本质判定」。<br>
  ★ 本页只读 JSON，不写回任何东西：台账是记录，记录不可重算。
</footer>
</body></html>`

writeFileSync(OUT, html)
/**
 * ★ 状态标签放在【第一行】—— 三态的主判据就是这一行，人扫一眼日志就能分开：
 *     generated   ⇒ "生成成功"   + 条数
 *     degraded    ⇒ "生成成功（降级）" + 条数 + 坏条目
 *     unavailable ⇒ "无法生成"   （上面已早退，走不到这里）
 *   三种措辞必须能一眼分开：都 exit 0，所以"说了什么"是唯一的区分面。
 */
if (broken.length) {
  console.log(`生成成功（降级）：${broken.length} 条记录读不出来，其余 ${entries.length} 条已渲染`)
} else {
  console.log('生成成功')
}
console.log(`写出 ${OUT}`)
console.log(`  ${entries.length} 条 · 需上报 ${escalate.length} · 可自解 ${self.length}`)
console.log(`  已修 ${byStatus.fixed.length} · 已排任务 ${byStatus.scheduled.length} · 开着 ${byStatus.open.length}`)
console.log(`  本质分组：${essenceGroups.map((g) => `${g.name}(${g.items.length})`).join(' · ')}`)
if (broken.length) console.log(`  ★ ${broken.length} 条读不出来：${broken.map((b) => b.file).join(', ')}`)
