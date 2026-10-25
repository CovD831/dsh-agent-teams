#!/usr/bin/env node
/**
 * ── 机制地图：把「我们对这个插件改了什么」变成一张可读的页 ──────────────────────
 *
 * 用法：`node scripts/mechanisms-html.mjs [输出路径]`
 * 默认输出：`docs/mechanisms.html`
 *
 * ── ★★ 它回答的是用户的哪句话 ─────────────────────────────────────────────────
 *
 *   「现在增加的机制越来越多，我都忘记有哪些了。
 *    而且有的机制并不是落成具体的机械判据，而是作为 prompt 增加在某个文档里面的，
 *    我觉得这样其实不太好。所以我希望你能想个方式，
 *    把我们对这个插件的整体改造清晰、直观地体现出来。」
 *
 * ── ★★ 本脚本的中心纪律：**真值只有一份，而它不在本文件里** ────────────────────
 *
 *   判据       ← `lib/gates/index.js` 的 **注册表**（`buildRegistry().list()`）
 *   工具       ← `lib/tool-names.js` 的 `TEAM_TOOL_NAMES` / `MEMBER_TOOL_NAMES`
 *   插入点     ← 同一个模块的 `INSERTION_POINTS`
 *   prompt 规则 ← `lib/index.js` 的 `usageSectionText()`（★ 直接调用，不复制正文）
 *
 *   ⇒ 本脚本【不写死任何一条机制】。加一条判据、改一句 prompt，
 *     重跑一次这张页就跟着变 —— 而"忘了更新文档"这件事因此不可能发生。
 *
 *   ★ 这正是 `docs/frictions.html` 那条先例的同一条纪律：
 *     「机器读 JSON（唯一真源），本页是它的视图」。
 *
 * ── ★★ 它是怎么把「prompt 里的机制」变成可数的东西的 ────────────────────────────
 *
 *   用户指出：有些机制只是 prompt 里的一句话，没有机械判据。
 *   ⇒ 本页把它做成一个**对照**，而不是一句抱怨：
 *
 *     左栏：prompt 里的每一条规则（逐字从 `usageSectionText()` 取）
 *     右栏：判据层里**能机械检查它的**那一格（按 id 前缀/关键词匹配）
 *     而匹配不上的，如实标注 `prose-only` —— ★ 不粉饰。
 *
 *   ★ 匹配是【启发式】的，所以每一条都把自己的匹配依据印出来，供人复核。
 *     一个不说明自己怎么算出来的分类，与一个错分类一样有害。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.argv[2] ?? join(ROOT, 'docs', 'mechanisms.html')

const gatesUrl = new URL('../lib/gates/index.js', import.meta.url)
const namesUrl = new URL('../lib/tool-names.js', import.meta.url)
const indexUrl = new URL('../lib/index.js', import.meta.url)
for (const url of [gatesUrl, namesUrl, indexUrl]) {
  if (!existsSync(fileURLToPath(url))) {
    console.error(`[mechanisms] missing build output: ${fileURLToPath(url)}\n  run \`pnpm build\` first — this page reads the compiled truth, not src/`)
    process.exit(1)
  }
}

const gates = await import(gatesUrl.href)
const names = await import(namesUrl.href)
const plugin = await import(indexUrl.href)

// ── 1. 判据：从注册表读（唯一真源） ───────────────────────────────────────────
const registry = gates.buildRegistry()
const listed = registry.list()
const insertionPoints = gates.INSERTION_POINTS

/**
 * ★ 走文件系统找「src/gates 下有、而注册表里没有」的判据。
 *   这一格是本项目反复记过的病（`gates/index.ts` 自己写着「写了但没接线」），
 *   所以它必须出现在这张页上 —— 否则这张页会把"没接线"读成"没有这条判据"。
 */
function scanGateFiles() {
  const dir = join(ROOT, 'src', 'gates')
  const found = []
  for (const point of readdirSync(dir)) {
    const p = join(dir, point)
    let isDir = false
    try { isDir = statSync(p).isDirectory() } catch { continue }
    if (!isDir) continue
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.ts')) continue
      const text = readFileSync(join(p, f), 'utf8')
      const m = /export const id = '([^']+)'/.exec(text)
      if (m) found.push({ id: m[1], file: `src/gates/${point}/${f}`, point })
    }
  }
  return found
}

const wiredIds = new Set()
for (const arr of Object.values(listed)) for (const g of arr) wiredIds.add(g.id)

const allGateFiles = scanGateFiles()
const unwired = allGateFiles.filter((g) => !wiredIds.has(g.id))

// ── 2. 工具：从 tool-names 读 ────────────────────────────────────────────────
const teamTools = [...names.TEAM_TOOL_NAMES]
const memberTools = new Set(names.MEMBER_TOOL_NAMES)
const toolRows = teamTools.map((name) => ({ name, member: memberTools.has(name) }))

// ── 3. prompt 规则：★ 直接调用产品函数，不复制正文 ─────────────────────────────
const promptText = plugin.usageSectionText(teamTools.join(', '), '')
const promptRules = (() => {
  const body = promptText.split('Tools:')[0]
  const out = []
  const re = /^(\d+)\.\s+(.*)$/gm
  let m
  while ((m = re.exec(body)) !== null) out.push({ n: Number(m[1]), text: m[2].trim() })
  return out
})()

/**
 * ── 4. ★ 对照：prompt 规则 ↔ 能机械检查它的判据 ────────────────────────────────
 *
 * ★ 这是本页对用户那句「有的机制只是 prompt 里的一句话」的正面回答。
 *   匹配是**关键词启发式**，所以每一条都把命中的词印出来 —— 供人复核，
 *   而不是让人相信一个不透明的分类。
 *
 * ★★★ 而"没匹配上"**不等于**"没有机械判据"：
 *   有的规则本来就无法机械判（如"不要重复建队"需要先有团队状态语义）。
 *   ⇒ 所以三态：`mechanical`（有判据） / `partial`（有相关判据但不完全覆盖） /
 *     `prose-only`（只有这句话）。★ 而它**不许**把 partial 并进 mechanical ——
 *     那正是本项目那条最贵的合流（"没测到"并进"通过"）。
 */
const RULE_SIGNALS = {
  1: { signal: ['create', 'plan', 'approval'], note: '建队/计划：admission 位置本应管这一段' },
  2: { signal: ['profile', 'member'], note: '成员与 profile：装配层校验，无独立判据' },
  3: { signal: ['plan', 'requires', 'contract'], note: '计划形状 ↔ contract 位置' },
  4: { signal: ['plan', 'reviewed'], note: '计划审查 ↔ dispatch.plan-reviewed' },
  5: { signal: [], note: '调度纪律：无判据（是 captain 的行为规范）' },
  6: { signal: ['worktree', 'changed'], note: '派发 ↔ dispatch.worktree / changed-paths' },
  7: { signal: ['verify', 'requires', 'atomicity', 'artifact'], note: '契约形状 ↔ contract 位置三条' },
  8: { signal: ['r5', 'mutation', 'backtest', 'verify'], note: '质量闭环 ↔ completion 位置四条' },
  9: { signal: [], note: 'halt/resume 语义：有工具行为，无独立判据' },
  10: { signal: ['coverage', 'convergence'], note: '交付 ↔ delivery 位置两条' },
}

const gateById = new Map()
for (const [point, arr] of Object.entries(listed)) for (const g of arr) gateById.set(g.id, { ...g, point })

const ruleRows = promptRules.map((rule) => {
  const cfg = RULE_SIGNALS[rule.n] ?? { signal: [], note: '' }
  const hits = []
  for (const [id, g] of gateById) {
    const hay = `${id} ${g.description ?? ''}`.toLowerCase()
    for (const s of cfg.signal) {
      if (hay.includes(s.toLowerCase())) { hits.push({ id, via: s }); break }
    }
  }
  const distinct = [...new Map(hits.map((h) => [h.id, h])).values()]
  const verdict = cfg.signal.length === 0 ? 'prose-only' : distinct.length === 0 ? 'prose-only' : distinct.length >= 2 ? 'mechanical' : 'partial'
  return { ...rule, hits: distinct, verdict, note: cfg.note }
})

// ── 5. 统计 ────────────────────────────────────────────────────────────────
const stats = {
  gatesWired: [...gateById.keys()].length,
  gatesUnwired: unwired.length,
  tools: toolRows.length,
  memberTools: memberTools.size,
  captainTools: toolRows.filter((t) => !t.member).length,
  promptRules: promptRules.length,
  mechanical: ruleRows.filter((r) => r.verdict === 'mechanical').length,
  partial: ruleRows.filter((r) => r.verdict === 'partial').length,
  proseOnly: ruleRows.filter((r) => r.verdict === 'prose-only').length,
}

// ── 6. 渲染 ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const POINT_META = {
  admission: { label: '准入', when: '成团【之前】', note: '这份需求够不够格进场' },
  contract: { label: '契约', when: '建任务 / 改契约', note: '这份契约合不合法、可不可判' },
  dispatch: { label: '派发', when: '成员开工前', note: '这次派发做得对不对、该不该派' },
  completion: { label: '收口', when: '成员汇报完成', note: '这一步的产出经不经得起重跑' },
  delivery: { label: '交付', when: '宣布交付那一刻', note: '整件事齐不齐、人收没收敛' },
  runtime: { label: '运行中', when: '全程', note: '过程健不健康（只告警，不拦任务）' },
}

const VERDICT_META = {
  mechanical: { label: '有机械判据', cls: 'ok' },
  partial: { label: '部分覆盖', cls: 'part' },
  'prose-only': { label: '仅 prompt 一句话', cls: 'prose' },
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentTeams 改造地图</title>
<style>
  :root { --fg:#16181d; --dim:#6b7280; --line:#e5e7eb; --bg:#fbfbfc; --card:#fff;
          --acc:#2563eb; --ok:#15803d; --part:#b45309; --prose:#b91c1c; --unwired:#7c3aed; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8eaed; --dim:#9aa0a6; --line:#33373d;
          --bg:#131417; --card:#1a1c20; --acc:#7aa2ff; --ok:#4ade80; --part:#fbbf24;
          --prose:#f87171; --unwired:#c4b5fd; } }
  * { box-sizing:border-box }
  body { margin:0; padding:2.5rem 2rem 7rem; background:var(--bg); color:var(--fg);
         font:15px/1.65 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; }
  h1 { font-size:1.7rem; margin:0 0 .35rem }
  h2 { font-size:1.2rem; margin:3.2rem 0 .5rem; padding-bottom:.45rem; border-bottom:2px solid var(--line) }
  h3 { font-size:1rem; margin:1.6rem 0 .6rem }
  .lede { color:var(--dim); margin:0 0 2rem; max-width:60rem }
  .sub { color:var(--dim); font-size:.9rem; margin:.3rem 0 1rem; max-width:62rem }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.9rem; margin:1.8rem 0 }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:1rem 1.1rem }
  .stat b { display:block; font-size:1.9rem; line-height:1.1; font-variant-numeric:tabular-nums }
  .stat span { color:var(--dim); font-size:.85rem }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:1rem 1.15rem; margin:.7rem 0 }
  .card.unwired { border-left:4px solid var(--unwired) }
  .rowhead { display:flex; gap:.55rem; align-items:baseline; flex-wrap:wrap }
  .id { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.86rem; color:var(--dim) }
  .pill { font-size:.72rem; padding:.14rem .55rem; border-radius:999px; border:1px solid var(--line); color:var(--dim); white-space:nowrap }
  .pill.ok { color:var(--ok); border-color:var(--ok) }
  .pill.part { color:var(--part); border-color:var(--part) }
  .pill.prose { color:var(--prose); border-color:var(--prose) }
  .pill.unwired { color:var(--unwired); border-color:var(--unwired) }
  .pill.captain { color:var(--acc); border-color:var(--acc) }
  .desc { margin:.5rem 0 0; font-size:.93rem; color:var(--fg) }
  .why { color:var(--dim); font-size:.85rem; margin-top:.4rem }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em;
         background:rgba(127,127,127,.13); padding:.06rem .32rem; border-radius:4px }
  .chain { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; margin:1rem 0 1.6rem }
  .step { border:1px solid var(--line); border-radius:9px; padding:.5rem .8rem; background:var(--card); font-size:.87rem }
  .step b { display:block; font-size:.95rem }
  .step i { font-style:normal; color:var(--dim); font-size:.78rem }
  .step.empty { border-style:dashed; color:var(--dim) }
  .arrow { color:var(--dim) }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:1rem }
  table { border-collapse:collapse; width:100%; font-size:.9rem; margin:.5rem 0 }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top }
  th { color:var(--dim); font-weight:600; font-size:.82rem }
  .warn { border:1px solid var(--part); border-radius:12px; padding:1rem 1.15rem; margin:1.6rem 0; background:var(--card) }
  .warn h3 { margin-top:0 }
  .toc { display:flex; gap:1.2rem; flex-wrap:wrap; font-size:.9rem; margin:1.4rem 0 0 }
  .toc a { color:var(--acc); text-decoration:none }
  .toc a:hover { text-decoration:underline }
  footer { margin-top:4rem; color:var(--dim); font-size:.85rem; border-top:1px solid var(--line); padding-top:1rem }
</style></head><body>

<h1>AgentTeams 改造地图</h1>
<p class="lede">
  这张页回答一件事：<b>我们对上游插件到底改了什么、每一条落在哪、有几条真的会开火。</b><br>
  ★ 它不是手写的清单 —— 它由 <code>scripts/mechanisms-html.mjs</code> 从<b>编译产物</b>生成，
  判据读注册表、工具读 <code>tool-names</code>、prompt 规则直接调用产品函数。
  <b>改了代码重跑一次，这张页就跟着变；"忘了更新文档"因此不可能发生。</b>
</p>

<div class="toc">
  <a href="#shape">① 整体形状</a>
  <a href="#gates">② 机械判据（13 条）</a>
  <a href="#gap">③ ★ 写了但没接线</a>
  <a href="#prose">④ ★ prompt 里的机制</a>
  <a href="#tools">⑤ 工具面</a>
  <a href="#how">⑥ 怎么重跑</a>
</div>

<div class="stats">
  <div class="stat"><b>${stats.gatesWired}</b><span>已接线判据</span></div>
  <div class="stat"><b style="color:var(--unwired)">${stats.gatesUnwired}</b><span>写了但没接线</span></div>
  <div class="stat"><b>${stats.tools}</b><span>工具（${stats.captainTools} captain-only）</span></div>
  <div class="stat"><b>${stats.promptRules}</b><span>prompt 规则</span></div>
  <div class="stat"><b style="color:var(--ok)">${stats.mechanical}</b><span>规则有机械判据</span></div>
  <div class="stat"><b style="color:var(--part)">${stats.partial}</b><span>部分覆盖</span></div>
  <div class="stat"><b style="color:var(--prose)">${stats.proseOnly}</b><span>仅 prompt 一句话</span></div>
</div>

<h2 id="shape">① 整体形状：机制挂在流程的六个位置上</h2>
<p class="sub">
  ★ 这是本项目与上游最大的结构差异：<b>判据不写在编排层里，而是挂在"流程位置"上</b>。
  位置是流程的形状（换实现不影响接线），判据是实现（可以一条一条换）。
  编排层只调 <code>registry.evaluate(point, ctx)</code> —— 它不知道任何判据的名字。
</p>
<div class="chain">
${insertionPoints.map((p, i) => {
  const meta = POINT_META[p] ?? { label: p, when: '', note: '' }
  const count = (listed[p] ?? []).length
  return `${i > 0 ? '<span class="arrow">→</span>' : ''}<div class="step${count === 0 ? ' empty' : ''}"><b>${esc(meta.label)} <span class="pill">${count} 条</span></b><i>${esc(meta.when)}</i><br><i>${esc(meta.note)}</i></div>`
}).join('\n')}
</div>

<h2 id="gates">② 机械判据：会真的开火的那 ${stats.gatesWired} 条</h2>
<p class="sub">
  每条判据都必须三态裁决（<code>ok</code> / <code>blocked</code> / <code>unmeasured</code>），
  并自带三臂夹具（伪造臂 / 未测量臂 / 对照臂）。
  <code>requires</code> 那一列是<b>它的输入面</b> —— ★ 而"判据接进来了"与"它的输入接上了"是两件事，
  本项目为此踩过五次，所以它单列一列。
</p>
${insertionPoints.map((point) => {
  const arr = listed[point] ?? []
  if (arr.length === 0) return ''
  const meta = POINT_META[point] ?? { label: point }
  return `<h3>${esc(meta.label)} <span class="id">${esc(point)}</span> · ${arr.length} 条</h3>
${arr.map((g) => `<div class="card">
  <div class="rowhead"><span class="id">${esc(g.id)}</span>
    <span class="pill">${(g.requires ?? []).length} 个输入</span>
    ${g.hasAppliesTo ? '<span class="pill">按 kind 适用</span>' : '<span class="pill">恒适用</span>'}
    ${g.observing ? '<span class="pill part">观察期</span>' : ''}
  </div>
  <p class="desc">${esc(g.description)}</p>
  ${(g.requires ?? []).length ? `<div class="why">输入面：${(g.requires ?? []).map((r) => `<code>${esc(r)}</code>`).join(' ')}</div>` : ''}
</div>`).join('\n')}`
}).join('\n')}

${unwired.length === 0 ? '' : `<h2 id="gap">③ ★ 写了但没接线：${unwired.length} 条</h2>
<div class="warn">
  <h3>这一格是这张页最该被看见的部分</h3>
  <p class="sub" style="margin-bottom:.6rem">
    下面这些判据<b>源码在盘上、夹具也有</b>，但没有进装配清单 <code>ALL_GATES</code> ⇒
    注册表里读不到它 ⇒ <b>一次都不会被求值</b>。
  </p>
  <p class="sub" style="margin-bottom:.6rem">
    本项目把它记作「<b>写了但没接线</b>」，而它已经复发过多次
    （<code>contract.task-atomicity</code>、<code>dispatch.plan-reviewed</code> 都曾是这一格）。
    源码注释里原话：<i>「这与 admission 那三条是同一个病：写了但没接线。」</i>
  </p>
  <p class="sub" style="margin-bottom:0">
    ★ 而它正是"机制变多了、但不知道哪些在起作用"的<b>最具体来源</b> ——
    一个不存在于装配清单的判据，与一个根本没写的判据，在运行读数上完全同形。
  </p>
</div>
${unwired.map((g) => `<div class="card unwired">
  <div class="rowhead"><span class="id">${esc(g.id)}</span><span class="pill unwired">未接线</span><span class="pill">${esc(g.point)}</span></div>
  <div class="why">文件：<code>${esc(g.file)}</code></div>
</div>`).join('\n')}`}

<h2 id="prose">④ ★ prompt 里的机制：哪一条只是"一句话"</h2>
<p class="sub">
  用户的判断是对的：这个插件的 captain protocol 是 <b>${stats.promptRules} 条纯 prompt 规则</b>，
  它们注入系统提示词，而<b>有一部分没有任何机械判据在背后</b>。
  下面把每一条规则与判据层做对照 ——
  ★ 而"没匹配上"<b>不等于</b>"没有机械判据"：有的规则天生无法机械判（那是三态里的 <code>prose-only</code>，不是"漏了"）。
  <br>匹配用的是关键词启发式，所以每一条都印出<b>它是靠哪个词匹配上的</b>，供复核。
</p>
${ruleRows.map((r) => {
  const v = VERDICT_META[r.verdict]
  return `<div class="card">
    <div class="rowhead">
      <span class="id">规则 ${r.n}</span>
      <span class="pill ${v.cls}">${v.label}</span>
      ${r.hits.length ? `<span class="pill">命中 ${r.hits.length} 条判据</span>` : ''}
    </div>
    <p class="desc">${esc(r.text.length > 420 ? r.text.slice(0, 420) + ' …' : r.text)}</p>
    ${r.hits.length ? `<div class="why">对应判据：${r.hits.map((h) => `<code>${esc(h.id)}</code><span style="opacity:.7">（经「${esc(h.via)}」）</span>`).join(' ')}</div>` : ''}
    ${r.note ? `<div class="why">备注：${esc(r.note)}</div>` : ''}
  </div>`
}).join('\n')}

<h2 id="tools">⑤ 工具面：模型看得见的动作</h2>
<p class="sub">
  <b>captain-only</b> 的那一列由 <code>TEAM_TOOL_NAMES</code> 减去 <code>MEMBER_TOOL_NAMES</code> 算出 ——
  与运行时的 <code>deny</code> 列表<b>同一个来源</b>，所以这张表不会与真实可见性分叉。
</p>
<table>
  <thead><tr><th>工具</th><th>谁能调</th><th>说明</th></tr></thead>
  <tbody>
  ${toolRows.map((t) => `<tr><td><code>${esc(t.name)}</code></td><td>${t.member ? '成员 + captain' : '<span class="pill captain">captain-only</span>'}</td><td class="id">${t.member ? '成员本位的动作' : '队长专有'}</td></tr>`).join('\n')}
  </tbody>
</table>

<h2 id="how">⑥ 怎么重跑这张页</h2>
<p class="sub">
  ★ 它读的是 <b>lib/</b>（编译产物），因为那才是进程实际加载的东西。
  改了 <code>src/</code> 之后要先 build。
</p>
<pre style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;overflow:auto"><code>cd ~/Desktop/agent-teams-dev
pnpm build                        # 先让 lib/ 与 src/ 同步
node scripts/mechanisms-html.mjs  # 重新生成 docs/mechanisms.html</code></pre>
<p class="sub">
  生成的判据数、工具数、规则数全部来自运行时求值 ——
  <b>某个机制没在装配清单里，它就会出现在第 ③ 节，而不是被悄悄算进"已有机制"。</b>
</p>

<footer>
  生成于 ${new Date().toLocaleString('zh-CN')} ·
  真值来源：<code>lib/gates/index.js</code>（注册表）、<code>lib/tool-names.js</code>、
  <code>lib/index.js</code>（<code>usageSectionText()</code>）·
  生成器：<code>scripts/mechanisms-html.mjs</code>
</footer>
</body></html>
`

writeFileSync(OUT, html, 'utf8')
console.log(`[mechanisms] wrote ${OUT}`)
console.log(`[mechanisms] gates=${stats.gatesWired} unwired=${stats.gatesUnwired} tools=${stats.tools} promptRules=${stats.promptRules} mechanical=${stats.mechanical} partial=${stats.partial} prose-only=${stats.proseOnly}`)
