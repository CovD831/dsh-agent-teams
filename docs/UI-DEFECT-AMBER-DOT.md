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
