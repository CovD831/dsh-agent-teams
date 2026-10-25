# 缺陷：已完成的成员仍显示**琥珀**状态点（2026-10-16）

> **用户**：「目前已完成为什么是琥珀色的」

★ **我上一轮答错了对象** —— 我去查了第二行的 `round.tone`（"本轮已完成/本轮有失败"），
而用户问的是**行首那个圆点**（`● ui-engineer`）。★ 两者是**两个独立的 tone**。

---

## 1. 根因：`stalled` 的颜色规则与它**自己声明的语义**不一致

### 语义（两处注释逐字）

**`ActivityPanel.module.css:2053`：**
> 「`stalled` is amber because **a dead session with open work** is a thing to act
>  on, not a green "still going"」

**`MemberRow.tsx:126-127`（`memberDotTone` 自己的注释）：**
> 「A member whose session is gone **while its work is still open**
>  therefore reads `stalled` (amber), not `running`。」

⇒ ★★ **两条注释都写了同一个条件：「会话不在场」**并且「**名下的活还开着**」。

### 实现（`MemberRow.tsx:132-145`）

```ts
export function memberDotTone(member, context) {
  ...
  const liveness = member.liveness
  if (liveness !== undefined && liveness !== '') {
    if (liveness === 'working') return 'running'
    if (liveness === 'not-live') return 'stalled'      // ★ 无条件 stalled
    ...
```

★★ **而 `MemberDotContext`（`:113-118`）只有四个字段:**
```ts
{ discarded?, stopped?, staged?, historic? }
```
⇒ ★★ **没有任何字段承载"名下有没有未完成的活"** ⇒
**"活还开着"这个条件在实现里【根本无法表达】。**

---

## 2. 实测：用户截图里的成员**没有 open work**

```
ui-engineer : status=idle · id=916f5437-…（有效会话 id）
              名下未完成任务数 = 0        ← ★ 没有 open work
⇒ 按两条注释的定义，它【不该】是琥珀
⇒ 而它现在【是】—— 因为 liveness='not-live' 就无条件给琥珀
```

★ 而 `ui-engineer` 刚**成功交付了 t79**（一行显示"已完成 t79 · 待派工"）——
**一个干完活、会话已回收的成员,被画成了"需要你去处理"的琥珀。**

---

## 3. ★★ 为什么这是**真缺陷**而不是配色偏好

**琥珀是本仓唯一的"待处理"色**（见 §1 的注释：「a thing to act on」）。
⇒ ★ **当"干完了"与"卡住了"同为琥珀时,那个色就不再是信号** ——
而**"需要我处理"与"它已经收工"的补救动作完全相反**。

★★ **这正是本仓记账最久的形态:** 两个不同的成因**在界面上同形**。

---

## 4. 修法（两条,选一）

### **(甲) 让 `memberDotTone` 真的能表达那个条件**

```ts
export interface MemberDotContext {
  ...
  /** ★ 有未完成的活（pending/claimed/in_progress 的任务）。 */
  readonly openWork?: boolean
}
// liveness === 'not-live':
//   openWork === true  ⇒ 'stalled'（琥珀）—— 注释说的那一格
//   openWork === false ⇒ 'idle'            —— 它已收工,会话被回收是正常的
```

★ **调用方（`MemberRow.tsx:624`）已经有 `owned`** ⇒ 算 `openWork` 是**纯派生**。

### **(乙) 改注释,承认"会话不在场就琥珀"**

★ **但那会让琥珀失去"待处理"的语义** ⇒ **我不建议。**

---

## 5. 反向半边（必须）

**A**：一个**干完活、会话已回收**的成员 ⇒ ★ **不许**是琥珀（应 `idle`）
**B**：一个**名下仍有未完成任务、而会话不在场**的成员 ⇒ ★ **必须**是琥珀
★ 两条合起来才能证明这个色**真的在区分两件事**。

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*

---

# 实施记录（t82，2026-10-16）

**基线**：HEAD = `3ff29d5`（`git merge-base --is-ancestor 71790be HEAD` ✅）。
开工时 stamp = `9498a80` ≠ HEAD ⇒ **先 `pnpm build` 取新鲜基线**。
**写域**：`src/client/MemberRow.tsx` + `src/client/activity-model.ts` + 产物 + 本文。
★ **`ActivityPanel.module.css` 一行未改**（硬约束 2，实测 `git diff --stat` 为空）。

## 0. 验收读数

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `npx tsc -p tsconfig.client.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0**（`lib/client.js` 375.88 kB） |
| `grep -n 'openWork' src/client/MemberRow.tsx` | **7 处**（声明 / 两段注释 / 分支 / 调用方） |
| `pnpm test:gates` 失败**文件集合** | 基线 16 == 改后 16，`diff` 无输出 ⇒ **净新 = 0** |
| 纯函数判据（本文件 §A） | **25 条断言全绿** |
| 渲染层判据（本文件 §B） | **4 条断言全绿** |
| 变异体 | **7/7 被检出**（两层互补，见 §C） |

★ 基线实测：`1483 tests / 1425 pass / 20 fail / **16 文件**`（与任务书给的 16 文件一致）。

## A. 改了什么（两处，都在 inScope 内）

**① `activity-model.ts` 新增纯派生函数 `memberHasOpenWork(owned)`**

```ts
export function memberHasOpenWork(owned: readonly { readonly status: string }[] | undefined): boolean {
  if (owned === undefined) return true
  return owned.some((task) => !taskIsTerminal(task.status))
}
```

★ **纯派生**：从**已有的** `owned` 算，**不新开数据通道**（硬约束 1）。
终态判定复用本文件**既有的** `taskIsTerminal`（它又读 `TERMINAL_TASK_STATUSES`）
—— 与轮次投影、成员时钟**同一份**来源，不另立第二份清单。

★★ **缺席语义 ＝ `true`（按"有活"处理）**，理由是**代价不对称**：
- 误判成琥珀 ⇒ 一个人去多看一眼（代价小）；
- 误判成 idle ⇒ 一个**真的卡住**的成员被画成"收工了"（代价是**一个没人看的卡点**）。
⇒ 取代价小的那一侧。而"没人看的卡点"正是本仓记账最久的那一类。

**② `MemberRow.tsx`：`MemberDotContext` 加一格 + `not-live` 分两格**

```ts
readonly openWork?: boolean           // 新字段
...
if (liveness === 'not-live') return context.openWork === false ? 'idle' : 'stalled'
```

调用方（`:670`）**已经有 `owned`** ⇒ `openWork: memberHasOpenWork(owned)`，一行。

★ **CSS 颜色规则没动**：`stalled` 仍然是 `--dsw-alias-state-warn-primary`。
**改的是"何时用它"**（硬约束 2）—— 这正是根因所在：那条注释声明的条件
（「死会话 **+ 活还开着**」）改前**在实现里根本无法表达**。

## B. 两条反向半边（逐条实测）

| | 构造 | `data-tone` |
|---|---|---|
| **A** | `liveness:'not-live'` + 名下 **1 件 completed**（= 用户截图那一行） | `idle` ✅ **不是琥珀** |
| **B** | `liveness:'not-live'` + 名下 **1 件 in_progress** | `stalled` ✅ **是琥珀** |

★★ **A ≠ B** ⇒ 同一个 `liveness` 下，点按"有没有活"分开 ⇒ **这个色真的在区分两件事**。

★ 另有一条**辨识力探针**：把实现退回"`not-live` 无条件 amber"，A 与 B 会**同形** ⇒
证明上面那条不是恒真。**而这一点被实测兑现了**（见 §C 的 M1）。

## C. ★★ 变异体 7/7（**两层**判据互补 —— 这是本轮最有价值的发现）

判据分两层：**纯函数层**（直接调 `memberDotTone` / `memberHasOpenWork`）与
**渲染层**（真的挂载 `MemberRow`，读状态点的 `data-tone`）。

| 变异体 | 纯函数层 | 渲染层 | 合计 |
|---|---|---|---|
| M1 `not-live` 无条件 stalled（**= 改前行为**） | FAIL=5 | FAIL=3 | ✅ |
| M2 条件反转（有活⇒idle，干完⇒stalled） | FAIL=7 | FAIL=3 | ✅ |
| M3 `not-live` 无条件 idle（另一端：卡点被藏起） | FAIL=5 | FAIL=2 | ✅ |
| M4 `openWork` 缺省按 `false`（不保守） | FAIL=1 | FAIL=0 | ✅ |
| M5 `openWork` 只看条数（口径漂移） | FAIL=5 | FAIL=3 | ✅ |
| **M6 调用方不传 `openWork`** | **FAIL=0** | **FAIL=3** | ✅ |
| M7 `stopped`/`historic` 预先返回被删 | FAIL=1 | FAIL=0 | ✅ |

★★ **两层各有一只"只有它能看见"的变异体**：
- **M6（调用方忘了传）纯函数层全绿** —— 因为纯函数臂**直接调** `memberDotTone`，
  看不见"这一行接没接上"；
- **M4 / M7 渲染层看不见** —— 它们不改渲染结果，只改**派生口径**。

⇒ ★★ **教训（本轮自抓的"假绿"）**：我第一版只有纯函数层，**M6 全绿**。
而 M6 恰恰是"改对了函数、忘了接线"那个形态 —— 它会**静默地把缺陷原样留下**。
**判据必须打在实现处，且"函数对了"不等于"它被接上了"。**

## D. ★ 决定性对照：把实现退回改前，判据会红

把 `not-live` 那一行改回 `return 'stalled'`（即用户报告的那个行为）后实测：

```
纯函数层：20 passed / 5 failed
渲染层  ： 1 passed / 3 failed
```

红掉的正是 **A、A≠B、"B 是唯一那个待处理色"、以及显式 `openWork:false` 分支**
⇒ **这套判据能复现用户的缺陷，不是"拆了个恒等的"。**

## E. 尚未验证的部分（如实报出）

★ **我没有验证过真实浏览器渲染**（臂 33/33b/33c/33d 在本机 `launchChrome()` 不 resolve，
干净树同样 —— 与前几轮一致）。本轮的"渲染层"判据用的是**仓内既有的最小 DOM 桩**
（`scripts/workspace-activity.test.mjs` 的 `installMinimalDom`），它验证的是
**React 真的把 `data-tone` 写成了那个值**，而**不是**"那个颜色在屏幕上看起来对"。

★ 而本轮**没有改任何 CSS** ⇒ "琥珀仍是 warn 色"是**静态可读**的事实
（`ActivityPanel.module.css:2074-2076` 未动），不需要浏览器确认。

## F. 改动清单

```
src/client/activity-model.ts   + memberHasOpenWork（纯派生，复用既有 taskIsTerminal）
src/client/MemberRow.tsx       + MemberDotContext.openWork；not-live 分两格；调用方传 openWork
lib/**（对应产物）+ lib/git-artifact-stamp.json
docs/UI-DEFECT-AMBER-DOT.md    本节
```

**未动**：`src/client/ActivityPanel.module.css`（硬约束 2）· `src/client/locales.ts`（out of scope）·
`src/gates/**` · `src/tools/**` · `src/state.ts` · `src/types.ts` · `scripts/**`。
★ 实测改动 **9 条路径，逐条在 inScope 内**（与 inScope 对拍，越界 0 条）。
