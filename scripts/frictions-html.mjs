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

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = join(ROOT, '.agent-teams', 'frictions')
const OUT = process.argv[2] ?? join(ROOT, 'docs', 'frictions.html')

/** 读全部条目。解析失败【不静默跳过】—— 一条坏记录与一条不存在的记录必须不同形。 */
function load() {
  const out = []
  const broken = []
  for (const f of readdirSync(DIR).filter((f) => /^f-\d+\.json$/.test(f)).sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(DIR, f), 'utf8')))
    } catch (error) {
      broken.push({ file: f, why: String(error?.message ?? error) })
    }
  }
  return { entries: out, broken }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

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

const { entries, broken } = load()

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
console.log(`写出 ${OUT}`)
console.log(`  ${entries.length} 条 · 需上报 ${escalate.length} · 可自解 ${self.length}`)
console.log(`  已修 ${byStatus.fixed.length} · 已排任务 ${byStatus.scheduled.length} · 开着 ${byStatus.open.length}`)
console.log(`  本质分组：${essenceGroups.map((g) => `${g.name}(${g.items.length})`).join(' · ')}`)
if (broken.length) console.log(`  ★ ${broken.length} 条读不出来：${broken.map((b) => b.file).join(', ')}`)
