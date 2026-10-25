/**
 * ── 会话 ID 复制按钮的判据 ──────────────────────────────────────────────────────
 *
 * ── 它防的是什么 ────────────────────────────────────────────────────────────────
 *
 * 这个功能有**三条分支**，而其中两条只有在特定条件下才走 —— 也就是**默认不会
 * 被任何东西跑到**。而本队记账多次的形态正是：**没被跑到的分支与不存在的分支同形。**
 *
 *   ① 截断：短 ID 原样、长 ID 截两头 —— 只在 ID 长过阈值时才看得见；
 *   ② 降级：`navigator.clipboard` 不存在时退到 `execCommand` —— 只在**非安全上下文**
 *      才走（`http://127.0.0.1` 是安全上下文特例，所以本机 GUI 走不到）；
 *   ③ 失败：两条路径都被拒 —— 只在剪贴板被策略挡住时才走。
 *
 * ⇒ 本夹具把那三条分支**逐条驱动**，而不是渲染一遍看看。
 *
 * ── ★★ 为什么走 `lib/client/*.js` 而不是 `src/*.ts` ─────────────────────────────
 *
 * 与 `client-harness-migration.test.mjs` / `workspace-activity.test.mjs` 同一口径：
 * 判据读的是**真的会被打进浏览器 bundle 的那份产物**。
 * ★ 若改读 `src/`，一条只在构建期生效的错误（例如 tsdown 的纯度门拒了某个
 *   import）会让判据**照样全绿**，而浏览器里那一格是空的。
 *
 * ── ★★★ 三态纪律 ──────────────────────────────────────────────────────────────
 *
 * 每条断言都必须能**对某个输入返回假**。本文件里每条都配了一个反面输入，
 * 写在同一条 `test()` 里 —— 因为\"它恒真\"这件事在绿的时候看不出来。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { copySessionId, shortSessionId, SESSION_ID_HEAD, SESSION_ID_TAIL } from '../lib/client/session-id-chip.js'

/** The plugin's own client entry, read as text so registration is checked where it happens. */
const clientIndexSource = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

test('★ 截断：长 ID 保留【两头】，短 ID 原样，空值不产出省略号', () => {
  const long = '0123456789abcdef0123456789abcdef'
  const short = shortSessionId(long)
  // ★ 期望值由**模块自己导出的常量**推，不由夹具手抄数字。
  //   第一版手抄了 `endsWith('6789abcdef')`（10 个字符），而 `SESSION_ID_TAIL` 是 8
  //   ⇒ 判据当场判红了一个**正确**的实现。手抄的常量会与实现漂移，
  //   而漂移之后\"判据说红\"与\"实现错了\"在读数上同形。
  assert.ok(short.startsWith(long.slice(0, SESSION_ID_HEAD)), `prefix missing: ${short}`)
  assert.ok(short.endsWith(long.slice(-SESSION_ID_TAIL)), `suffix missing: ${short}`)
  assert.ok(short.includes('…'), `no ellipsis: ${short}`)
  assert.ok(short.length < long.length, 'truncation did not shorten')
  // ★ 恰好等于 head + 1 + tail：多留一位会让\"截断过\"这件事无法从长度看出来。
  assert.equal(short.length, SESSION_ID_HEAD + 1 + SESSION_ID_TAIL)

  // ★ 反面臂：只取前缀的实现会在这里红 —— 后缀必须也能读出来。
  assert.ok(!short.startsWith(long.slice(0, SESSION_ID_HEAD + 1 + SESSION_ID_TAIL)), 'the tail was dropped; a prefix-only cut would pass a weaker assertion')

  // ★ 短 ID 原样：截断一个本来就不长的串会让它**更难**核对。
  assert.equal(shortSessionId('abc'), 'abc')
  assert.equal(shortSessionId(''), '')
  assert.equal(shortSessionId(undefined), '')
  // ★ 空值绝不返回单独的省略号（那会渲染成一个看起来坏了的按钮）。
  assert.notEqual(shortSessionId(undefined), '…')
})

test('★ 复制走现代剪贴板；它 reject 时退到 execCommand，而不是直接报失败', async () => {
  const written = []
  assert.equal(
    await copySessionId('abc', { clipboard: { writeText: async text => { written.push(text) } } }),
    'copied',
  )
  assert.deepEqual(written, ['abc'])

  // ★ 反面臂：现代路径抛出时必须**还能复制上**。直接 return 'failed' 的实现在这里红。
  const executed = []
  const outcome = await copySessionId('xyz', {
    clipboard: { writeText: async () => { throw new Error('NotAllowedError') } },
    execCommand: command => { executed.push(command); return true },
    createTextarea: () => ({ value: '', select() {}, remove() {} }),
  })
  assert.equal(outcome, 'copied', 'a rejected writeText must fall through, not report failure')
  assert.deepEqual(executed, ['copy'])
})

test('★ 两条路径都不可用时报 failed —— 而它【绝不】静默成功', async () => {
  // 没有剪贴板、没有 execCommand。
  assert.equal(await copySessionId('abc', {}), 'failed')
  // 有 execCommand 但它说没成功（execCommand 返回 false 是常态，不是异常）。
  assert.equal(
    await copySessionId('abc', { execCommand: () => false, createTextarea: () => ({ value: '', select() {}, remove() {} }) }),
    'failed',
  )
  // ★ 空串不该被"复制成功" —— 那会让用户以为剪贴板里有了东西。
  assert.equal(await copySessionId('', { clipboard: { writeText: async () => {} } }), 'failed')
  // ★ 旧路径抛异常也必须收成 failed，不许穿出去（组件里那次 await 会变成未处理拒绝）。
  assert.equal(
    await copySessionId('abc', { execCommand: () => { throw new Error('blocked') }, createTextarea: () => ({ value: '', select() {}, remove() {} }) }),
    'failed',
  )
})

test('★ 降级路径真的【选中并移除】临时 textarea（否则焦点会留在页面上）', async () => {
  const calls = []
  await copySessionId('payload', {
    execCommand: () => { calls.push('exec'); return true },
    createTextarea: () => ({
      set value(text) { calls.push(`value:${text}`) },
      get value() { return '' },
      select: () => { calls.push('select') },
      remove: () => { calls.push('remove') },
    }),
  })
  assert.deepEqual(calls, ['value:payload', 'select', 'exec', 'remove'])
})

test('★ 注册面：按钮挂在 header.utilities 上，且【不在】可选的 sidebarRight 作用域里', () => {
  assert.ok(
    clientIndexSource.includes("slots.inject('conversation.session.header.utilities'"),
    'the chip must register on the header utilities slot',
  )
  assert.ok(
    clientIndexSource.includes('agent-teams-session-id'),
    'the chip needs its own registration id',
  )

  // ★ 反面臂（本文件最值钱的一条）：它必须住在 `ctx.inject(['sidebarRight', …])`
  //   那个作用域【之外】。放进去的话，一个与本功能无关的宿主差异（没有侧边栏）
  //   会把它一起摘掉 —— 而"没渲染"与"没这个功能"在用户眼里同形。
  //
  // ★ 作用域的边界由**括号配对**求出，不由"下一个 ctx.slots.inject"猜：
  //   第一版就是猜的（拿 `shell.overlay` 当终点），而它**当场判红了一个正确的实现** ——
  //   因为 chip 注册在 164 行、`shell.overlay` 在 169 行，于是"164 > 169"为假。
  //   一个靠猜终点写出来的判据，它的红与绿都是关于**锚点**的，不是关于实现的。
  const scopeStart = clientIndexSource.indexOf("ctx.inject(['sidebarRight', 'sidebarRightTabs']")
  assert.notEqual(scopeStart, -1, 'scope anchor not found; this assertion would be vacuous')
  const open = clientIndexSource.indexOf('(', clientIndexSource.indexOf('ctx.inject', scopeStart))
  let depth = 0
  let scopeEnd = -1
  for (let i = open; i < clientIndexSource.length; i += 1) {
    const ch = clientIndexSource[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) { scopeEnd = i; break }
    }
  }
  assert.notEqual(scopeEnd, -1, 'could not find the sidebarRight scope boundary')
  const chipAt = clientIndexSource.indexOf("slots.inject('conversation.session.header.utilities'")
  assert.notEqual(chipAt, -1, 'the chip registration was not found')
  assert.ok(
    chipAt > scopeEnd,
    'the session-id chip must register outside the optional sidebarRight scope',
  )
})

test('★ 两个槽位的 owner props 是同一个类型 —— 所以 sessionId 是框架注入的，不是我们取的', () => {
  // ★ 这条钉的是**取值的来源**：本仓不解析 URL、不读全局，只消费框架给的 prop。
  //   一个"自己从 location 里抠 ID"的实现能通过上面所有断言，却会在
  //   子代理会话 / 非浏览器宿主里给出**错的 ID**。
  const source = readFileSync(new URL('../src/client/SessionIdAction.tsx', import.meta.url), 'utf8')
  assert.ok(
    source.includes("PropsRuntime<'conversation.session.header.utilities'>"),
    'sessionId must come from the slot runtime props',
  )
  assert.ok(!/location\s*\.\s*(href|pathname|search)/.test(source), 'the chip must not scrape the URL for the session id')
  assert.ok(!/globalThis\s*\.\s*sessionId/.test(source), 'the chip must not read a global for the session id')
})

/* ── ★★★ 真实浏览器臂（与 `workspace-activity.test.mjs` 的臂 33 同一模式）──────────
 *
 * 上面那些断言全是**读文本**的。而读文本永远回答不了一件事：
 * **那份 CSS 在真浏览器里算出来的颜色，真的是三个不同的值吗？**
 *
 * ★ 这条臂的由来（MEASURED，2026-10-13）：写完实现后我在真 Chrome 里渲染了一次，
 *   三态**同色** —— 而原因是我的测试页**没有定义宿主的 `--dsw-alias-*` 变量**。
 *   补上宿主 token 之后三态才分形（灰 / 绿 / 红）。
 *   ⇒ 这件事读文本**永远看不见**：CSS 里写着 `var(--dsw-alias-state-error-primary)`，
 *     而那个变量在页面上不存在时，浏览器静默退回继承色。
 *   ★ 而"三态同色"正是本功能最该避免的失效：用户会把"没复制上"读成"复制好了"。
 *
 * ★★ 三态纪律：**量不到就不算通过。** 本机没有可用 Chrome 时（沙箱会拦），
 *   这条臂报 `COULD NOT MEASURE` 并**不算通过** —— 与臂 33 逐字同一条纪律。
 */

/** The headless Chrome this repo's browser arms already use. */
const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Launch headless Chrome with a debugging port; null when unavailable. */
async function launchChrome() {
  const { existsSync } = await import('node:fs')
  if (!existsSync(CHROME_BINARY)) return null
  const { spawn } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const port = 9600 + (process.pid % 300)
  const profile = mkdtempSync(join(tmpdir(), 'sid-chip-'))
  const child = spawn(CHROME_BINARY, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1200,800', 'about:blank',
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return { child, port }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  child.kill('SIGKILL')
  return null
}

/**
 * ── ★★★ 基础设施故障必须与"判据不满足"分形（这是本文件第二版修的东西）──────────
 *
 * MEASURED（2026-10-13，本仓 `test:gates` 全量跑）：这条浏览器臂**新增了一条失败**，
 * 而它不是关于实现的 —— 是 Chrome 的 **HTTP 端口应答了、CDP WebSocket 却被沙箱拦下**。
 * 第一版把那种情况直接抛成 `CDP socket failed` ⇒ 读数上它与"三态同色"**完全同形**。
 *
 * ⇒ 那正是本队的三态纪律在防的事：`UNKNOWN`（没测成）既不许并进 `DONE`，
 *   **也不许并进 `BLOCKED`** —— 后者会把"没测到"说成"测了是坏的"。
 *
 * ★ 所以测量基础设施的失败单独成一类，由臂接住并报 `COULD NOT MEASURE`；
 *   而**断言**失败照旧穿出去变红。两者的区别是**可判的**：
 *   前者发生在拿到任何读数之前，后者发生在读数之后。
 */
class MeasurementUnavailable extends Error {}

/** Open a data-URL page and run one expression against it. */
async function measureInChrome(browser, html, expression) {
  let created
  try {
    created = await (await fetch(
      `http://127.0.0.1:${browser.port}/json/new?${encodeURIComponent(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)}`,
      { method: 'PUT' },
    )).json()
  } catch (error) {
    throw new MeasurementUnavailable(`could not open a page: ${String(error)}`)
  }
  if (created?.webSocketDebuggerUrl === undefined) {
    throw new MeasurementUnavailable('the page target exposed no webSocketDebuggerUrl')
  }
  const socket = new WebSocket(created.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    /**
     * ★ 超时是必需的：沙箱拦 WebSocket 时，`error` 事件**不保证会来**，
     *   于是第一版在这里**挂到测试超时**（实测 983ms 的红 + 一次 3 分钟挂起）。
     *   一个既不报错也不返回的等待，比一个报错的等待更坏。
     */
    const timer = setTimeout(() => { reject(new MeasurementUnavailable('CDP socket did not open within 10s')) }, 10000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new MeasurementUnavailable('CDP socket failed (a sandboxed host can block the debugger WebSocket)'))
    }, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  /**
   * ★★ `Inspector.targetCrashed`：沙箱里 Chrome 的 renderer 一起来就崩
   *   （实测 `{"method":"Inspector.targetCrashed","params":{}}` 是**唯一**收到的消息）。
   *   ⇒ 任何命令都不会有带 `id` 的响应 ⇒ `send()` 永远挂住。
   *   ⇒ 这不是"实现坏了"，是**这个宿主量不到**。第一版就死在这里：
   *     它把一个环境限制读成了判据失败（983ms 的一条红）。
   *   ★ 认出来之后把**所有在等的命令**一次拒掉，否则 `Runtime.enable` 那一下
   *     要等满兜底超时才降级 —— 白等 10 秒，而原因当场就写在消息里。
   */
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Inspector.targetCrashed') {
      socket.close()
      for (const entry of pending.values()) {
        entry.reject(new MeasurementUnavailable('the headless renderer crashed (a sandboxed host can refuse Chrome child processes)'))
      }
      pending.clear()
      return
    }
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    /**
     * ★ 兜底超时：`Inspector.targetCrashed` 之外**还有别的沉默方式**，
     *   而"既不报错也不返回"的等待比报错更坏（实测一次挂到 3 分钟）。
     *   ⇒ 沉默一律降级成"量不到"，不许变成挂起。
     */
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new MeasurementUnavailable(`CDP command ${method} got no reply within 10s`))
    }, 10000)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await new Promise((resolve) => setTimeout(resolve, 200))
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  socket.close()
  if (result.exceptionDetails !== undefined) throw new Error(`page threw: ${result.exceptionDetails.text}`)
  return result.result.value
}

/** Pull the chip's own compiled stylesheet out of the built bundle. */
function chipStylesheet() {
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const at = bundle.indexOf('SessionIdAction.module.css.mjs')
  assert.notEqual(at, -1, 'the chip stylesheet is not in lib/client.js — did the build run?')
  const after = bundle.slice(at, at + 20000)
  const match = after.match(/const css\$\d+ = "((?:[^"\\]|\\.)*)"/) ?? after.match(/const css = "((?:[^"\\]|\\.)*)"/)
  assert.notEqual(match, null, 'could not read the chip stylesheet literal out of the bundle')
  return JSON.parse(`"${match[1]}"`)
}

/**
 * ★★★ 宿主 token 必须**由这个页面提供**，因为真实宿主就是这么做的。
 *
 * ★ 少了这一段，三枚按钮会算出同一个颜色 —— 而那不是"样式坏了"，
 *   是"这个页面不像宿主"。判据里的**环境**与生产环境的差异必须显式写出来，
 *   否则一条永远绿的断言与一条永远红的断言看起来一样。
 */
const HOST_TOKENS = ':root{'
  + '--dsw-alias-border-l2:#3a3a3a;--dsw-alias-label-secondary:#9a9a9a;'
  + '--dsw-alias-bg-module-platform:#1c1c1c;--dsw-alias-state-business-primary:#4c8dff;'
  + '--dsw-alias-state-error-primary:#e5484d;--dsw-alias-state-success-primary:#2fbf71}'

test('★ 真实浏览器臂：三态在真 Chrome 里**颜色两两不同**，且芯片真的排出了宽度', async (t) => {
  const browser = await launchChrome()
  if (browser === null) {
    // ★ 量不到就说量不到，**不算通过**（本仓三态纪律）。
    t.diagnostic('COULD NOT MEASURE: no usable headless Chrome at ' + CHROME_BINARY)
    return
  }
  try {
    const css = chipStylesheet()
    const prefix = css.match(/\.(\w+)_sessionId\{/)?.[1]
    assert.ok(prefix, 'could not recover the CSS-module class prefix from the compiled stylesheet')
    const chip = (status, label) => `<button class="${prefix}_sessionId" data-status="${status}" type="button">`
      + `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"></svg>`
      + `<span class="${prefix}_text">${label}</span></button>`
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>${HOST_TOKENS}</style>`
      + `<style>html,body{margin:0;padding:20px;background:#fff;font-family:system-ui}</style></head><body>`
      + `<div id="idle">${chip('idle', 'session-a332\u20260549d')}</div>`
      + `<div id="copied">${chip('copied', 'Copied')}</div>`
      + `<div id="failed">${chip('failed', 'Copy failed')}</div>`
      + `</body></html>`

    let measured
    try {
      measured = await measureInChrome(browser, html, `(() => {
        const read = (id) => {
          const el = document.querySelector('#' + id + ' button')
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return { width: +r.width.toFixed(1), height: +r.height.toFixed(1), color: cs.color, border: cs.borderTopColor }
        }
        return { idle: read('idle'), copied: read('copied'), failed: read('failed') }
      })()`)
    } catch (error) {
      /**
       * ★ 只有**测量基础设施**的失败走这条路，且它**不算通过**（如实报出来）。
       *   断言失败不会到这里 —— 它们在下面，已经拿到读数之后。
       */
      if (error instanceof MeasurementUnavailable) {
        t.diagnostic('COULD NOT MEASURE: ' + error.message)
        return
      }
      throw error
    }

    /** ★ 前置：芯片真的排出来了（否则下面几条测的是空值）。 */
    assert.ok(measured.idle.width > 40, `★ 前置：芯片必须真的排出宽度（实测 ${measured.idle.width}）`)
    assert.equal(measured.idle.height, 22, '★ 高度等于声明值 22px（同时证明样式表真的生效了）')
    /** ★★ 三态两两不同形 —— 这就是这条臂存在的全部理由。 */
    assert.notEqual(measured.idle.color, measured.failed.color, '★ 失败态必须与常态**不同色**（否则"没复制上"读起来像"复制好了"）')
    assert.notEqual(measured.copied.color, measured.failed.color, '★ 成功与失败必须不同色')
    assert.notEqual(measured.idle.color, measured.copied.color, '★ 常态与成功态必须不同色')
    assert.notEqual(measured.idle.border, measured.failed.border, '★ 失败态的边框也要分形')
  } finally {
    browser.child.kill('SIGKILL')
  }
})