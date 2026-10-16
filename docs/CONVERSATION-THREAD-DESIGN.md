# 裁决对话线程：设计与数据核实（2026-10-17）

> **用户裁定**「按你推荐的来」⇒ 做**裁决对话线程**（形态来自 `dsh-agent-board` 的 v5.6），
> 以及 **候选 B**（成员为主屏 + 投影层）。
>
> ★ **第一件事是核实数据在不在** —— 不能设计一个没有数据源的东西。

---

## 1. ★★★ 数据核实：**线程数据【全在】,缺的只是投影**

### 实测:`inbox/captain.jsonl` 的字段

```
['content','deliveredAt','from','id','readAt','sourceAttemptId',
 'sourceTaskId','sourceTaskStatus','to','ts']        ← ★ 十个字段
```

### ★★ 而快照【只转出 2 个】

```ts
// src/snapshot.ts:530
captainInbox: captainInbox.slice(-5).map((message) => ({
  from: message.from,
  content: message.content,          // ← ★ 只有这两个
}))
```

```
★ 丢掉:deliveredAt · id · readAt · sourceAttemptId · sourceTaskId
        · sourceTaskStatus · to · ts          ← ★ 八个
```

⇒ ★★★ **所以缺的不是数据,是【投影】—— 而那正是本会话那条主轴的又一个实例。**

### ★★★ 而第二个缺口更隐蔽:`readUnreadMailbox`

```
★ 快照读的是 readUnreadMailbox（:428）
★★ 而"未读"是【读的那一刻】的状态 ⇒ 一旦读过,那条就从快照里消失
⇒ ★★★ 后果:**对话线程会自己变短** —— 而"消息没了"与"从来没发过"在界面上同形
```

★ **而实测:当前团队 captain 信箱 108 条** ⇒ **而快照只给最近 5 条,且只给未读的。**

---

## 2. ★★★ 线程的判据：什么算"一条线程"

### ★★ 而数据里【已经有】分组键

```
$ 来源分布: test-triage 26 · archaeologist 26 · ui-dissect 20 · captain 10 · reviewer 9 · reviewer-glm 8
$ 同一 sourceTaskId 有多条: 9 个任务
⇒ ★★★ 所以"一条线程"= 一组共享 sourceTaskId 的消息
```

★ **而那正是 `dsh-agent-board` 的 `task.messages[]` 的等价物** ——
**它用 task 分组,而我们【已经有 sourceTaskId】。**

### ★ 而一条线程 = 一次"提问 → 裁决"

```
★ 从成员来（from != captain）⇒ 那是【提问】
★ 从 captain 来             ⇒ 那是【裁决】
⇒ ★★ 而两者共享 sourceTaskId ⇒ ★ 天然成对
```

★★ **而那正是我建议吸收的形态:**
> 「不再"裁决后即删疑问"…… 呈现为**对话线程**」

★ **我们现在【没有删】**（jsonl 是 append-only）—— **而界面也【没显示】**
⇒ **所以"没删"与"没发过"在界面上同形。**

---

## 3. ★ 所以投影的形状

```ts
/** ★ 一条消息（比现在的两格多八个）。 */
export interface TeamActivityMessage {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly ts: number                // ★ 时刻（排序与显示）
  readonly taskId?: string           // ★ sourceTaskId ⇒ 分组键
  readonly attemptId?: string
  readonly taskStatus?: string
  readonly read: boolean             // ★ readAt 在场
}

/** ★★ 一条线程 = 一个任务上的一串消息。 */
export interface TeamActivityThread {
  readonly taskId: string
  readonly messages: readonly TeamActivityMessage[]
}
```

### ★★★ 而 `readUnreadMailbox` 那个缺口必须一起修

```
★ 只给未读 ⇒ 线程会自己变短
⇒ ★★ 所以要么读【全部】信箱（按 ts 排序,取尾 N）,要么明确标注"这是未读的"
★★ 而后者会把"读过"读成"没有" —— ★ 所以该读全部
```

★ **而"读全部"有一个代价**:108 条 × 长正文 ⇒ 载荷会大。
⇒ ★★ **所以投影要带【上限 + 明确的截断读数】**（截了多少条,而不是静默截断）。

---

## 4. ★★ 落地顺序（依赖，不是偏好）

| 顺序 | 做什么 | 依赖 |
|---|---|---|
| **①** | ★ **投影扩字段**：`TeamActivityMessage` 到十格中的九格 | 无 |
| **②** | ★★ **读全部而非只读未读** + 截断读数 | ① |
| **③** | ★ **分组成线程**（按 `sourceTaskId`）| ①② |
| **④** | **界面呈现**（成员展开后的一段）| ③ |
| **⑤** | 候选 B 的其余部分（采集/评估投影）| ③ 的形状 |

★ **而 ①②③ 都【不改客户端】** —— **它们是快照层的改动。**
★★ **所以它们与 UI 的形态选择【不冲突】,可以先做。**

---

## 5. ★ 一条边界

```
★ 本设计【不动 src/client/**】⇒ 与任何 UI 形态选择都兼容
★★ 而 ④ 才需要形态定下来
⇒ ★★★ 所以先做 ①②③ 是安全的,且它们让"约束被看见"这件事【有数据可依】
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
