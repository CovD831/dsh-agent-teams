/**
 * ── ★★★ v5 第一层的判据：**文件夹 = 工作区**（t111）────────────────────────────
 *
 * 规格：`docs/UI-V5-SINGLE-ENTRY.md` §1–§3。
 *
 * ── 它与 `gate-main-key-probe.test.mjs` 的分工 ──────────────────────────────────
 *
 * 那个文件验的是**地基**（t103/t105）：`main` 是 keyed+root、注册得进去、
 * 调 `selectPanel` 之后**被渲染**、不调就**不是我们**、传未注册 id **必须抛**。
 * ⇒ ★ **地基那三条（含两条反向半边 A/B）本轮不改**，它们仍然在那边跑、仍然绿。
 *
 * 本文件验的是**这一层新加的东西**：
 *   · 工作区列表**从 `/state` 的 teams 聚合**（纯函数，可编程）；
 *   · 像素风图标的**形状可核**（内联 SVG 的几个 rect，不是位图）；
 *   · ★★ **空态与"读不到"不同形**（反向半边 C）。
 *
 * ── ★★ 为什么全部可编程 ──────────────────────────────────────────────────────
 *
 * 本机没有视觉模型 ⇒ 不看截图。判据落在：纯函数的返回形状 · 组件渲染出的
 * `data-*` 读数 · 模块源码里的**结构事实**（有没有 `<img>` / 有没有外链）。
 */
/**
 * ★★ CSS Modules 在 Node 里没有含义 —— 把 `.css` 解析成一个惰性空模块。
 *   这与本仓既有夹具（`workspace-activity.test.mjs`）**同一种做法**，不是我新发明的：
 *   `Proxy` 让 `css.anything` 都是一个字符串，于是"类名"对判据不透明，
 *   而本文件的判据本来也不该断言类名（它们断言的是**结构**与**读数**）。
 */
const { registerHooks } = await import('node:module')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) {
      return {
        url: 'data:text/javascript,' + encodeURIComponent('export default new Proxy({},{get:(t,k)=>String(k)})'),
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * ★★ **必须用动态 import**：静态 import 会在 `registerHooks` 生效**之前**就被链接
 *   ⇒ CSS 那一条拦不住（实测：ERR_MODULE_NOT_FOUND 打在 `.module.css` 上）。
 *   本仓既有夹具也是这个做法（先 hooks、再 `await import`）。
 */
const { foldersFromSnapshots, foldersView } = await import('../lib/client/folders-panel.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src', 'client')

/** One minimal team as the wire carries it. */
const team = (workspace, teamId, live = true) => ({
  workspace, teamId, name: teamId, captainSessionId: `s-${teamId}`,
  phase: 'running', messageCount: 0, captainInbox: [], members: [], tasks: [],
  ...live ? {} : {},
})

test('★★ 臂 1：工作区从 teams **聚合**出来（一个工作区一个文件夹）', () => {
  const folders = foldersFromSnapshots([
    team('proj-a', 't1'), team('proj-a', 't2'), team('proj-b', 't3'),
  ])
  assert.equal(folders.length, 2, '★ 两个不同的 workspace ⇒ 两个文件夹（不是三个队）')
  const a = folders.find((folder) => folder.workspace === 'proj-a')
  assert.deepEqual(a?.teamIds, ['t1', 't2'], '★ proj-a 下两个队，按首次出现序')
  assert.equal(a?.liveCount, 2, '★ 两个都是活的')
})

test('★★ 臂 2：归档的队**仍算一个工作区**（否则"曾经有"与"从来没有"同形）', () => {
  const folders = foldersFromSnapshots([team('live-ws', 't1')], [team('archived-ws', 't9')])
  assert.equal(folders.length, 2, '★ 只剩归档队的工作区仍然是一个工作区')
  const archived = folders.find((folder) => folder.workspace === 'archived-ws')
  assert.equal(archived?.liveCount, 0, '★ 但 liveCount 是 0 —— "还有没有活的队"读得出来')
  assert.deepEqual(archived?.teamIds, ['t9'])
})

test('★ 臂 3：列表顺序**跨轮询稳定**（按首次出现序，不抖动）', () => {
  const first = foldersFromSnapshots([team('b', 't1'), team('a', 't2')])
  const second = foldersFromSnapshots([team('b', 't1'), team('a', 't2')])
  assert.deepEqual(first.map((f) => f.workspace), ['b', 'a'], '★ 首次出现序，不是字母序')
  assert.deepEqual(first.map((f) => f.workspace), second.map((f) => f.workspace), '★ 两次一致')
})

test('★★ 臂 4：空 workspace 名**照收**（丢它 = 静默少一个文件夹）', () => {
  const folders = foldersFromSnapshots([team('', 't1')])
  assert.equal(folders.length, 1, '★ 无名工作区仍在列表里')
  assert.equal(folders[0]?.workspace, '')
})

test('★★★ 臂 5（反向半边 C 的纯函数半边）：空数组 ≠ 读不到', () => {
  const empty = foldersView([], [])
  assert.equal(empty.state, 'loaded')
  assert.deepEqual(empty.state === 'loaded' ? empty.folders : null, [], '★ 读到了、确实没有 ⇒ 空列表')
  const unknown = foldersView(undefined, undefined)
  assert.equal(unknown.state, 'empty', '★ 没发布过快照 ⇒ 单独的态')
})

test('★★ 臂 6（面板结构）：空态有**可辨识标记**，且**不是白屏**', () => {
  const src = readFileSync(join(SRC, 'folders-panel.tsx'), 'utf8')
  /** ★ 空态必须渲染一句话 + 一个探针（白屏与"读不到"同形）。 */
  assert.ok(src.includes('data-folders-empty="true"'), '★ 空态有可辨识标记')
  assert.ok(/还没有工作区/.test(src), '★ 空态有一句明确的话（不是空白）')
  /** ★ 三态读数落在 DOM 上 ⇒ "画了几个文件夹"是可编程判据。 */
  assert.ok(src.includes('data-folders-state={view.state}'), '★ 三态上 DOM')
  assert.ok(src.includes('data-folders-count={folders.length}'), '★ 张数上 DOM')
  assert.ok(src.includes('data-folder={folder.workspace}'), '★ 每个文件夹可定位')
})

test('★★ 臂 7（像素风）：图标是**内联 SVG 的矩形**，不是位图、不引外部素材', () => {
  const src = readFileSync(join(SRC, 'folders-panel.tsx'), 'utf8')
  assert.ok(src.includes('<svg'), '★ 有内联 SVG')
  assert.ok(src.includes('<rect'), '★ 由 rect 拼出来（像素画的本质是对齐格子的方块）')
  assert.ok(src.includes('shapeRendering="crispEdges"'), '★ 缩放不插值（像素风的观感）')
  /** ★★ 三条"不许"：位图 sprite / emoji 当图标 / 外部图片。 */
  assert.ok(!/<img\b/.test(src), '★ 不用 <img>（位图 sprite = 体积 + 版权）')
  assert.ok(!/from '\S+\.(png|svg|jpg|webp)'/.test(src), '★ 不 import 任何位图/素材文件')
  assert.ok(!/url\(\s*['"]?https?:/.test(src), '★ 不引外链素材')
})

test('★★★ 臂 8（零新依赖）：面板只用既有模块 + React', () => {
  const src = readFileSync(join(SRC, 'folders-panel.tsx'), 'utf8')
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['react', './activity-monitor.ts', './folders-probe.tsx', './folders-panel.module.css'])
  const offending = imports.filter((spec) => !allowed.has(spec))
  assert.deepEqual(offending, [], `★ 只许 spec ${JSON.stringify([...allowed])}，实测多出 ${JSON.stringify(offending)}`)
})

test('★★ 臂 9（不碰既有视图）：本层只新增/替换组件，没有改 MemberRow / ActivityPanel', () => {
  const src = readFileSync(join(SRC, 'index.tsx'), 'utf8')
  assert.ok(src.includes("} from './folders-probe.tsx'"), '★ 仍从探针模块取 key 与计数格子')
  assert.ok(src.includes('import { FoldersPanel }'), '★ 换成了真的面板')
  /**
   * ★★ 只在**代码行**里查，不在注释里查。
   *   MEASURED：我第一版用 `src.includes('FoldersProbe')` —— 而 `index.tsx` 的
   *   **注释**里逐字写着"探针组件换成真的面板"，于是断言假红。
   *   ★ 与 t80 那次同一种错：**把注释算进了计数**。
   */
  const codeOnly = src.split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
  assert.ok(!/\bFoldersProbe\b/.test(codeOnly), '★ 探针组件已不再被**代码**渲染（注释里可以提到它）')
  /** ★ 既有的注册一个都没被删：逐条点名。 */
  for (const needle of [
    "name: 'main',", "'shell.overlay'", "'sidebar.right.pane.tab'",
    "'conversation.session.header.utilities'", "'conversation.chat.node'",
  ]) {
    assert.ok(src.includes(needle), `★ 既有注册仍在：${needle}`)
  }
})

test('★★★ 臂 9b：面板**必须喂渲染计数** —— 反向半边 A 的唯一载体', () => {
  /**
   * ★★★ MEASURED（本轮自抓的假绿）：变异体 M6（把 `noteProbeRender` 变成空调用）
   *   让 10 条断言**全绿**。
   *
   * ★ 为什么这条必须单独存在：**反向半边 A**（不调 `selectPanel` ⇒ 渲染计数 = 0）
   *   判的是 `probeRenderCount(FOLDERS_MAIN_KEY)` 这个格子。而那个格子的**唯一**
   *   写入点就是面板渲染时的 `noteProbeRender`。
   *   ⇒ 若面板不喂它，那条反向半边就退化成"一个**从来没人写过**的格子永远是 0" ——
   *     **恒真**，证明不了任何事。
   *   ★ 这是本会话反复记下的同一形态：**判据的载体本身要被判据钉住。**
   */
  const src = readFileSync(join(SRC, 'folders-panel.tsx'), 'utf8')
  const codeOnly = src.split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
  assert.ok(/^import \{[^}]*noteProbeRender[^}]*\} from '\.\/folders-probe\.tsx'/m.test(codeOnly),
    '★ 面板 import 了 noteProbeRender')
  assert.ok(/^\s*noteProbeRender\(FOLDERS_MAIN_KEY\)\s*$/m.test(codeOnly),
    '★★ 面板**真的调用**了它（不是 import 了不用）')
})

test('★★ 臂 10（像素风的样式纪律）：无圆角、硬阴影、只用宿主语义色', () => {
  const cssText = readFileSync(join(SRC, 'folders-panel.module.css'), 'utf8')
  /** ★ 像素风来自"无圆角 + 硬阴影"，不是素材。 */
  assert.ok(/border-radius:\s*0/.test(cssText), '★ 明确写 border-radius: 0（圆角是平滑世界的）')
  assert.ok(/box-shadow:\s*\d+px \d+px 0 0/.test(cssText), '★ 硬阴影：整像素偏移 + 0 blur')
  assert.ok(!/border-radius:\s*(?!0)[0-9]/.test(cssText), '★ 没有非零圆角')
  /** ★ 不引第二套调色板（本仓纪律）。 */
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(cssText.replace(/\/\*[\s\S]*?\*\//g, '')), '★ 不写死颜色字面量')
  assert.ok(cssText.includes('var(--dsw-alias-'), '★ 颜色只来自宿主语义 token')
})
