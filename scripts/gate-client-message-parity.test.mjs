/**
 * ── ★★★ 九格对齐臂 + `captainInbox` 接线臂（t102）───────────────────────────────
 *
 * ── 为什么需要这一条（MEASURED，t102）─────────────────────────────────────────
 *
 * 改前全仓 `captainInbox` 只有两处（`grep -rn "captainInbox" src/client/`）：
 *
 *     activity-monitor.ts   readonly captainInbox: readonly ActivityMessage[]   ← 只有声明
 *     ActivityPanel.tsx     captainInbox: [],                                   ← 硬编码空
 *
 * 而 t100 已经让**服务端**投影九格 ⇒ **两边分叉**：数据到了载荷里，
 * **没有任何客户端代码读它**（`grep -rn "\.captainInbox" src/client/` 除那两处 ⇒ 空）。
 *
 * ⇒ ★ 这就是本仓记账最久的形态：**"机制建好了"与"接线了"同形**。
 *   （同族的先例：t82 的 M6 —— 函数改对了、调用方不传键 ⇒ **纯函数层全绿**。）
 *
 * ── ★★ 所以本臂必须【两层】，只有一层会漏 ─────────────────────────────────────
 *
 *   第一层（纯函数）：`readCaptainInbox` 的三态真的可分。
 *   第二层（接线）：★ **活的那条路真的调用它** —— 只测第一层，
 *                    把 `projectTeams(body.teams)` 改回纯断言
 *                    `body.teams as readonly ActivityTeam[]`，**第一层依然全绿**
 *                    而缺陷**原样回来**（这正是 t82/M6 的形状）。
 *
 * ── 三条判据（每条各钉一件事）─────────────────────────────────────────────────
 *
 *   ① ★ 九格对齐：客户端 `ActivityMessage` 与服务端 `TeamActivityMessage`
 *      **逐格同名同序** ⇒ 防两边再次分叉。
 *   ② ★ 三态不同形：`absent`（没给）/ `empty`（给了空）/ `present`（给了 N 条）
 *      ★★ 前两者**必须不同形** —— 否则「读不到」与「确实没有」同形，
 *      而补救动作相反（前者查服务端，后者什么都不用做）。
 *   ③ ★ 接线：`/state` 的活路径**真的**过 `projectTeams`，而不是裸断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { readCaptainInbox } from '../lib/client/activity-monitor.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'src', 'client', 'activity-monitor.ts')
const PANEL = join(HERE, '..', 'src', 'client', 'ActivityPanel.tsx')
const SERVER = join(HERE, '..', 'src', 'snapshot.ts')

/** Extract the field names of one interface, in declaration order. */
function fieldNames(source, interfaceName) {
  const start = source.indexOf(`export interface ${interfaceName} {`)
  assert.notEqual(start, -1, `interface ${interfaceName} not found`)
  let depth = 0
  const out = []
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1) {
      const line = source.slice(i, source.indexOf('\n', i))
      const match = /^\s*readonly\s+([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line)
      if (match !== null) {
        out.push(match[1])
        i = source.indexOf('\n', i) - 1
      }
    }
  }
  return out
}

test('★ 臂 1（九格对齐）：客户端 ActivityMessage 与服务端逐格同名同序', () => {
  const client = fieldNames(readFileSync(CLIENT, 'utf8'), 'ActivityMessage')
  const server = fieldNames(readFileSync(SERVER, 'utf8'), 'TeamActivityMessage')
  /**
   * ★ 逐格比对（不是"数量相等"）：数量相等会让**同数不同名**蒙混过去。
   * ★ 也比对**顺序** —— 两份定义要对读，顺序不同就得来回找。
   */
  assert.deepEqual(client, server, `client=[${client}] server=[${server}]`)
  assert.equal(client.length, 9, `expected nine fields, got ${client.length}`)
})

test('★★ 臂 2（反向半边 A）：服务端【给了】消息 ⇒ 读得到，不是空数组', () => {
  const read = readCaptainInbox([
    { id: 'm1', from: 'captain', to: 'worker', content: 'hi', ts: 11, taskId: 't1', attemptId: 'a1', taskStatus: 'running', read: false },
    { id: 'm2', from: 'worker', to: 'captain', content: 'done', ts: 12, read: true },
  ])
  assert.equal(read.state, 'present')
  assert.equal(read.messages.length, 2, 'given messages must be readable, not an empty array')
  /* 九格原样带出（含分组键与已读位） */
  assert.equal(read.messages[0].taskId, 't1')
  assert.equal(read.messages[0].attemptId, 'a1')
  assert.equal(read.messages[0].taskStatus, 'running')
  /* ★ `read` 如实：一条未读一条已读，不许都推成同一个值 */
  assert.equal(read.messages[0].read, false)
  assert.equal(read.messages[1].read, true)
})

test('★★ 臂 3（反向半边 B）：服务端【没给】与「给了空数组」不同形', () => {
  const absent = readCaptainInbox(undefined)
  const empty = readCaptainInbox([])
  assert.equal(absent.state, 'absent')
  assert.equal(empty.state, 'empty')
  /**
   * ★★ 这一条是**全臂的核心**：它钉住两种情形**不同形**。
   *   把 `!Array.isArray(raw)` 那一支的 `'absent'` 改成 `'empty'` ⇒ 本臂立刻红。
   */
  assert.notEqual(absent.state, empty.state, '"not given" must differ from "given empty"')
  /* 非数组（null / 字符串）也是"没给"，不是"空" */
  assert.equal(readCaptainInbox(null).state, 'absent')
  assert.equal(readCaptainInbox('nope').state, 'absent')
  /**
   * ★ 控制：三态**互不相同**。若实现恒返回一个值，上面两条会"恰好"通过
   *   ——这里直接把"恒真"这一形态挡在外面。
   */
  assert.equal(new Set([absent.state, empty.state, readCaptainInbox([{ from: 'a', content: 'b' }]).state]).size, 3)
})

test('★ 臂 4：形状不对的条目【不静默丢】', () => {
  const partly = readCaptainInbox([{ from: 'a', content: 'ok' }, { garbage: true }, { from: 1, content: 2 }])
  assert.equal(partly.messages.length, 1)
  /* ★ 报出来 —— 丢掉一条会让"少了一条"与"从来没有它"同形 */
  assert.equal(partly.unreadable, 2)
})

test('★★★ 臂 5（接线）：活的那条路真的过 projectTeams，不是裸断言', () => {
  const source = readFileSync(CLIENT, 'utf8')
  /**
   * ★★ 这一层是**必须的**：只测纯函数的话，把接线改回
   *   `body.teams as readonly ActivityTeam[]` ⇒ 臂 1–4 **全绿**，
   *   而缺陷**原样回来**（t82/M6 的形状）。
   */
  assert.match(source, /const liveTeams = projectTeams\(body\.teams\)/,
    'the live /state path must project through projectTeams, not a bare cast')
  assert.equal(/const liveTeams = body\.teams as readonly ActivityTeam\[\]/.test(source), false,
    'the bare cast must be gone')
})

test('★★ 臂 6：归档卡片那格是 empty（确实没有），不是 absent（读不到）', () => {
  const source = readFileSync(PANEL, 'utf8')
  /**
   * ★ `historicCardTeam` 合成的是**归档卡片**，而 `AgentTeamsCardData`
   *   **没有任何消息字段** ⇒ 它拿不到消息是**结构事实**。
   * ★ 但它必须声明 `'empty'` 而不是落进 `'absent'` —— 否则
   *   「归档卡片确实没有消息」与「读不到消息」**同形**，而补救动作相反。
   */
  assert.match(source, /captainInboxState: 'empty'/, 'archived cards must declare empty, not absence')
})
