/**
 * ── ★★★ 接线臂：`memberDotTone` 的调用方**必须真的传 `openWork`** ────────────────
 *
 * ── 为什么需要这一条（MEASURED，t82）────────────────────────────────────────────
 *
 * t82 修好了琥珀点：`memberDotTone` 在 `liveness === 'not-live'` 时不再无条件返回
 * `stalled`，而是看 `context.openWork`。
 *
 * ★★ 而它自己报出：**判据必须两层**。它用 7 个变异体实测，其中 **M6
 *   「调用方不传 `openWork`」（＝ 函数改对了、接线忘了）** 在**纯函数层 FAIL=0（全绿）**，
 *   只有**渲染层**能看见（FAIL=3）。
 *
 * ⇒ ★ M6 恰恰是那种**静默把缺陷原样留下**的形态：
 *   `memberDotTone` 的缺省语义是 `openWork` **缺席 ＝ 有活**（故意选代价小的一侧），
 *   所以**不传 `openWork` 时它退回改前的行为** —— 用户报的那个琥珀色**原样回来**，
 *   而**纯函数层的每一条断言都还是绿的**。
 *
 * ── ★ 为什么这条臂【不是】渲染层 ──────────────────────────────────────────────
 *
 * t82 的渲染层夹具是**临时的、已删除**，而 `scripts/` 不在它的写域 ⇒ **没有产物落地**。
 * 队长实测过后果：删掉 `MemberRow.tsx` 的接线并重建，**只有臂 33/33c 变红** ——
 * 而那两条是**浏览器臂，在本沙箱恒红、与接线无关** ⇒ **今天删掉那一行，全绿。**
 *
 * ★ 本臂**不渲染 React**（那需要 CSS module 的运行时解析，而仓内没有先例），
 *   而是**在源码层核对调用点真的传了那个键** —— 那是 M6 唯一可静态观测的地方，
 *   且判据本身**双向**：它同时钉住"传了"与"传的是那个纯派生函数"。
 *
 * ── 两条反向半边（缺一不可）───────────────────────────────────────────────────
 *
 *   ① 调用点**没有** `openWork` 这个键 ⇒ 红（M6 的形状）
 *   ② 调用点有 `openWork` 但**值不是** `memberHasOpenWork(...)` ⇒ 红
 *      ★ 那防的是"接了个常量 `true`"—— 它会让接线臂变绿，
 *        而**修复完全没生效**（缺省语义本来就是 true）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { memberHasOpenWork } from '../lib/client/activity-model.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROW = join(HERE, '..', 'src', 'client', 'MemberRow.tsx')

test('★★★ 接线臂：`memberDotTone` 的调用点必须传 `openWork: memberHasOpenWork(...)`', () => {
  const src = readFileSync(ROW, 'utf8')

  /**
   * ★ 只取 `memberDotTone(` 的**调用点**（不是它的声明）。
   *   声明的形态是 `export function memberDotTone(` ⇒ 用 `=` 或裸调用区分。
   */
  const callSites = [...src.matchAll(/memberDotTone\(\s*member\s*,\s*\{([\s\S]*?)\}\s*\)/g)]
  assert.equal(
    callSites.length, 1,
    '★★ 本臂假定 `memberDotTone` 恰好有一个生产调用点 —— '
    + `实测 ${callSites.length} 个。`
    + ' 多出来时必须逐一看过并更新本臂，而不是让它静默放宽（那正是本仓记账的形态）。',
  )

  const context = callSites[0][1]

  // ── 反向半边 ①：键必须在 ──────────────────────────────────────────────────
  assert.match(
    context, /openWork\s*:/,
    '★★★ M6：`memberDotTone` 的调用点**没有传 `openWork`** ⇒ 缺省语义是「有活」\n'
    + '    ⇒ 它**退回改前的行为**（会话不在场就琥珀），而**纯函数层全绿**。\n'
    + '    用户报的那个"已完成的成员显示琥珀"会**原样回来**。\n'
    + `    实测 context = ${JSON.stringify(context.replace(/\s+/g, ' ').trim())}`,
  )

  // ── 反向半边 ②：值必须是那个纯派生函数，不是常量 ────────────────────────────
  assert.match(
    context, /openWork\s*:\s*memberHasOpenWork\s*\(/,
    '★★ 接线臂的反向半边：`openWork` 必须由 `memberHasOpenWork(...)` 算出，'
    + '而不是一个常量。\n'
    + '    ★ 写成 `openWork: true` 会让本臂变绿，而**修复完全没生效** ——\n'
    + '      因为 `memberDotTone` 的缺省语义**本来就是 true**。\n'
    + `    实测 context = ${JSON.stringify(context.replace(/\s+/g, ' ').trim())}`,
  )
})

test('★★ 同源臂：`memberHasOpenWork` 对「全终态」与「有活」给相反答案', () => {
  /**
   * ★ 这一条钉住**纯派生函数的语义本身**，与上面那条（接线）合起来才完整：
   *   上面回答"接上了没有"，这里回答"接的那个函数对不对"。
   */
  assert.equal(
    memberHasOpenWork([{ status: 'completed' }, { status: 'failed' }, { status: 'cancelled' }]),
    false,
    '★★ 全部是终态的成员**没有活** ⇒ 不许说它有（那正是用户报的那一格：干完活而会话被回收）',
  )
  assert.equal(memberHasOpenWork([{ status: 'completed' }, { status: 'in_progress' }]), true,
    '★ 有 `in_progress` ⇒ 有活')
  assert.equal(memberHasOpenWork([{ status: 'pending' }]), true, '★ 有 `pending` ⇒ 有活')
  assert.equal(memberHasOpenWork([]), false, '★ 空数组 ⇒ 没有活')
  /**
   * ★ 缺席 ＝ `true`，这是**刻意的取舍**（代价不对称）：
   *   误判成琥珀只是多看一眼；误判成 idle 会**藏起一个真卡点**。
   */
  assert.equal(memberHasOpenWork(undefined), true,
    '★★ 缺席必须按「有活」处理 —— 那个取舍写在 `activity-model.ts` 的注释里，本臂把它钉住')
})
