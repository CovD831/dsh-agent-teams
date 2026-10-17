/**
 * ── ★★★ t112：**导航**可用缺陷的判据（进了会话回不到文件夹 + 文件夹页是死路）──────
 *
 * 用户原话：「我刚才从那个大的界面点击侧面的 session 到了目前的界面,
 *          但是现在**回不去那个大的界面**了」。
 *
 * ── 三条反向半边，方向各不同 ─────────────────────────────────────────────────
 *
 *   **A** 在**不是团队**的会话里 ⇒ 回入口**仍然在且能点**
 *        （★ 这才是既有 `TeamChatEntry` 缺的那一格：它无队时 `return null`）
 *   **B** 从文件夹页点进团队 ⇒ **必须**切到 `conversation`（否则文件夹页是死路）
 *   **C** **两次往返**都能成（文件夹 → 会话 → 文件夹 → 会话）
 *
 * ── ★★ 判据全部可编程（本机没有视觉模型）────────────────────────────────────
 *
 *   · `returnEntryState()` 纯函数的三态 · `selectPanelLog()` 的**调用序列** ·
 *     `shell.overlay` 的**真 spec**（`kind:'list'` / `scope:'root'`）·
 *     `index.tsx` 里注册的**面**（有没有会话相关 prop）。
 *   ★ 零截图。
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

import { FOLDERS_MAIN_KEY } from '../lib/client/folders-probe.js'
const {
  noteSelectPanelCall, resetSelectPanelLog, selectPanelLog, returnEntryState, returnEntryLabel,
} = await import('../lib/client/folders-return-entry.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX = join(HERE, '..', 'src', 'client', 'index.tsx')
const ENTRY = join(HERE, '..', 'src', 'client', 'folders-return-entry.tsx')
/** ★ 真实的 layout 包（判据落在**官方**的 SlotMap 上，不是复刻）。 */
const LAYOUT_TYPES = join(
  HERE, '..', 'node_modules', '.pnpm',
  '@deepseek-ai+dsh-client-ui-layout@0.2.0-rc.2_@deepseek-ai+cordis@4.0.4',
  'node_modules', '@deepseek-ai', 'dsh-client-ui-layout', 'lib', 'types', 'client', 'index.d.ts',
)

test('★★ 臂 1（地基）：`shell.overlay` 是 list + root ⇒ 新 id 加在旁边且【不绑会话】', () => {
  const dts = readFileSync(LAYOUT_TYPES, 'utf8')
  const at = dts.indexOf("'shell.overlay': {")
  assert.notEqual(at, -1, '★ 前置：官方 SlotMap 里真的声明了 shell.overlay')
  const block = dts.slice(at, at + 200)
  assert.ok(/kind:\s*'list'/.test(block), `★ 必须是 list（新 id 加在既有条目旁边，不替换）\n${block}`)
  assert.ok(/scope:\s*'root'/.test(block), `★★ 必须是 root（不绑会话 ⇒ 任何界面都在）\n${block}`)
})

test('★★★ 臂 2（反向半边 A）：回入口**不接任何会话 prop** ⇒ 非团队会话里也在', () => {
  const src = readFileSync(ENTRY, 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  /** ★ 它的 props 只有两格，且**没有一个是会话相关的**。 */
  const propsBlock = code.slice(code.indexOf('export interface FoldersReturnEntryProps'), code.indexOf('}', code.indexOf('export interface FoldersReturnEntryProps')))
  assert.ok(propsBlock.includes('usePanelInfo'), '★ 读**根作用域**的面板状态')
  assert.ok(propsBlock.includes('selectPanel'), '★ 切换的唯一出口')
  assert.doesNotMatch(propsBlock, /sessionId|session|team\b/i,
    `★★ 不许出现会话/团队的 prop（那会让它在非团队会话里消失）\n${propsBlock}`)
})

test('★★★ 臂 3（反向半边 A 的另一半）：既有的 TeamChatEntry **仍然**是"只在有队时显示"', () => {
  /**
   * ★ 硬边界②：**不许把它改成永远显示**。
   *   本臂把"它仍然有 `if (!team) return null`"钉住 ——
   *   否则为了修这个缺陷，很容易顺手把那一行去掉（那会让它出现在无关会话里）。
   */
  const src = readFileSync(join(HERE, '..', 'src', 'client', 'TeamChatEntry.tsx'), 'utf8')
  assert.ok(/if \(!team\) return null/.test(src), '★ TeamChatEntry 仍然只在有队时渲染（那是对的）')
})

test('★★ 臂 4（三态）：不在文件夹页 ⇒ show；在文件夹页 ⇒ hidden；读不到 ⇒ **仍然 show**', () => {
  assert.equal(returnEntryState(null), 'show', '★ 在 conversation ⇒ 显示"回到工作区"')
  assert.equal(returnEntryState('some-other-panel'), 'show', '★ 在别的面板 ⇒ 也显示')
  assert.equal(returnEntryState(FOLDERS_MAIN_KEY), 'hidden', '★ 已经在文件夹页 ⇒ 不重复给')
  /**
   * ★★ 读不到时**仍然显示**：这个入口是**唯一能回去的路**。
   *   藏起它会把一个读数缺失变成一次**不可用** —— 那与"这个功能没做"同形。
   */
  assert.equal(returnEntryState(undefined), 'unknown')
  assert.equal(returnEntryLabel('unknown').includes('回到工作区'), true, '★ unknown 仍然是一个可点的回入口')
})

test('★★★ 臂 5（反向半边 B）：从文件夹页出去 ⇒ 记到 selectPanel(null)', () => {
  resetSelectPanelLog()
  /** ★ 面板点文件夹时走的就是这一句（生产实现：`selectPanel(null)`）。 */
  noteSelectPanelCall('folder-open', null)
  const log = selectPanelLog()
  assert.equal(log.length, 1, '★ 记到一次')
  assert.equal(log[0].from, 'folder-open', '★ 来源是"从文件夹点出去"')
  assert.equal(log[0].panelId, null, '★★ 切到 conversation 的官方写法就是 null')
})

test('★★★ 臂 6（反向半边 C）：**两次往返**都成 —— 文件夹 → 会话 → 文件夹 → 会话', () => {
  resetSelectPanelLog()
  /** ① 启动：选中文件夹页（`index.tsx:302` 那一句的效果）。 */
  noteSelectPanelCall('return-entry', FOLDERS_MAIN_KEY)
  /** ② 从文件夹点进某个团队 ⇒ 会话。 */
  noteSelectPanelCall('folder-open', null)
  /** ③ 点"回到工作区" ⇒ 回文件夹。 */
  noteSelectPanelCall('return-entry', FOLDERS_MAIN_KEY)
  /** ④ 再点进团队 ⇒ 会话。 */
  noteSelectPanelCall('folder-open', null)

  const log = selectPanelLog()
  assert.deepEqual(log.map((c) => c.panelId), [FOLDERS_MAIN_KEY, null, FOLDERS_MAIN_KEY, null],
    `★★ 四次调用的**序列**必须交替（不是"单向可用"）\n${JSON.stringify(log)}`)
  /**
   * ★★ 而"单向可用"与"双向可用"**必须不同形** ——
   *   若只实现了一个方向，上面的序列会长这样：
   *     [folder, null]              （只出不进 = 现在这个缺陷）
   *     [folder, folder, folder]    （只进不出 = 死路）
   *   ⇒ 显式断言两个方向**各出现两次**。
   */
  assert.equal(log.filter((c) => c.panelId === FOLDERS_MAIN_KEY).length, 2, '★ 进文件夹：2 次')
  assert.equal(log.filter((c) => c.panelId === null).length, 2, '★ 出到会话：2 次')
})

test('★★ 臂 7（接线）：`index.tsx` 在 `shell.overlay` 上注册了**独立的 id**，且**不注入会话**', () => {
  const src = readFileSync(INDEX, 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  assert.ok(code.includes("id: 'agent-teams-folders-return'"), '★ 回入口有自己的 id')
  assert.ok(code.includes("id: 'agent-teams-activity'"), '★ 既有的活动面板**仍在**（list 是追加，不是替换）')
  /**
   * ★★ 回入口的 `inject` 面里**必须有 `selectPanel` 这个键**，且**没有会话**。
   *
   * MEASURED（本轮自抓的假绿）：我第一版只查 `tail.includes('selectPanel')`，
   * 而那一窗口里**注释**也提到 `selectPanel` ⇒ 把注入的键改名为
   * `selectPanelDisabled` 时**仍然绿**（变异体 M5 FAIL=0）。
   * ⇒ 改成**按形状断言**：`inject: () => ({ selectPanel: … })`。
   */
  const at = code.indexOf("id: 'agent-teams-folders-return'")
  const tail = code.slice(at, at + 1200)
  const injectAt = tail.indexOf('inject:')
  assert.notEqual(injectAt, -1, '★ 回入口有 inject 面')
  const injectFace = tail.slice(injectAt, tail.indexOf('}, FoldersReturnEntry'))
  assert.match(injectFace, /selectPanel\s*:/,
    `★★ 注入面里**必须**有一个叫 \`selectPanel\` 的键（不是"某处提到这个词"）\n${injectFace}`)
  assert.doesNotMatch(injectFace, /sessionId/,
    `★★ 注入面里不许有 sessionId（那会让它绑上会话）\n${injectFace}`)
})

test('★★ 臂 8（反向半边 B 的接线）：面板真的拿到了"出去"的出口，且走 selectPanel(null)', () => {
  const src = readFileSync(INDEX, 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  assert.ok(code.includes('openConversation'), '★ 面板被注入了 openConversation')
  assert.ok(/ctx\.layout\.selectPanel\(null\)/.test(code), '★★ 出口走的是官方的 selectPanel(null)')
})

test('★★ 臂 9（浮层 click-through）：回入口自己开了 pointer-events', () => {
  const cssText = readFileSync(join(HERE, '..', 'src', 'client', 'folders-panel.module.css'), 'utf8')
  const at = cssText.indexOf('.returnEntryHost')
  assert.notEqual(at, -1, '★ 前置：回入口的样式存在')
  const block = cssText.slice(at, cssText.indexOf('}', at))
  assert.ok(/pointer-events:\s*auto/.test(block),
    '★★ 浮层缺省 click-through ⇒ 不开这一行它就"看得见、点不着"（= 回不去）')
})

test('★★ 臂 10（只增不改）：回入口是**新文件**，既有视图一行未动', () => {
  const src = readFileSync(ENTRY, 'utf8')
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set([
    'react', '@deepseek-ai/dsh-client-ui-layout/client',
    './folders-probe.tsx', './folders-panel.module.css',
  ])
  const offending = imports.filter((s) => !allowed.has(s))
  assert.deepEqual(offending, [], `★ 零新依赖；实测多出 ${JSON.stringify(offending)}`)
})
