# 对话线程的数据投影（t100）

> **任务**：信箱投影从 **2 格**扩到 **9 格**，并读**全部**而非只读未读。
> **基线**：HEAD `5725de1`（`git merge-base --is-ancestor 71790be HEAD` ⇒ **IS ancestor** ✅）。
> **对照基线**：`pnpm test:gates` ⇒ **16 个失败文件 / 1528 tests**。

---

## 1. 缺陷（t100 开工实测）

### ① 投影只转 2 格，而 jsonl 有 10 个字段

```
信箱 jsonl: ['content','deliveredAt','from','id','readAt',
             'sourceAttemptId','sourceTaskId','sourceTaskStatus','to','ts']
原投影（snapshot.ts）: { from, content }        ← ★ 只两格
⇒ ★★ 丢掉八个: id · to · ts · readAt · sourceAttemptId · sourceTaskId · sourceTaskStatus · deliveredAt
```

### ② ★★★ 而第二个缺口更隐蔽：读的是 `readUnreadMailbox`

```
快照此前读 readUnreadMailbox
★★ 而"未读"是【读的那一刻】的状态 ⇒ 一旦读过，那条就从快照里消失
⇒ ★★★ 后果：对话线程会自己变短
   而"消息没了"与"从来没发过"在界面上同形（本仓记账最久的形态）
```

★ 实测：当前团队 captain 信箱 **108 条**，而快照只给最近 5 条且只给未读的。

### ★★ 为什么第 ② 个缺口在本轮**变得**特别坏

以前投影只有 2 格、没有分组键，消息只能摊成**一条时间线**；
本轮引入 `taskId` 做**线程分组键**之后，一条线程要显示「**提问 → 裁决**」的**往返**。
⇒ ★ 裁决一旦被读过，它就消失 ⇒ **往返只剩一半**，
而"只问没答"与"根本没问"在界面上同形。

---

## 2. 一处必须更正任务书的地方（实测）

任务书说「同一 `sourceTaskId` 有多条的：**9 个任务**」——
★ 本仓实测**未能复现那个数**（工作区里 `.agent-teams/` 是 gitignored、不随 checkout 带来，
所以那个计数**在这棵树里量不出来**）。
★★ 但**结构结论成立且可核**：`sourceTaskId` 确实**是**分组键 ——
实测 `TeamMessage` 有 `sourceTaskId` / `sourceAttemptId` / `sourceTaskStatus` 三格，
而 `src/mailbox.ts` 的 `mailboxContent` 已经**按它们拼提示词**：
```ts
`[Source task ${message.sourceTaskId}, attempt_id ${message.sourceAttemptId}${…status…}]\n`
```
⇒ ★ 一条消息**本来就带着"它属于哪条线程"**，`mailboxContent` 早就用上了 ——
**缺的只是把它投影给 UI**。★ 这与任务书的判断同向，只是那个**具体数字**未复现。

---

## 3. 改了什么

| # | 改动 | 位置 |
|---|---|---|
| ① | `TeamActivityMessage` 从 **2 格**扩到 **9 格** | `src/snapshot.ts` |
| ② | 读**全部**信箱（`readUnreadMailbox` → `readMailbox`） | `src/snapshot.ts` |
| ③ | `MAILBOX_PROJECTION_LIMIT = 5`（**具名常量**，不是散落的字面量） | `src/snapshot.ts` |
| ④ | 截断读数：`captainInboxOmitted` + `captainInboxTotal` | `src/snapshot.ts` |
| ⑤ | 读不到信箱：`captainInboxUnreadable`（反向半边 C） | `src/snapshot.ts` |

### ★ 九格逐格**为什么必须在**（不是"顺手多给几格"）

| 格 | 来源 | 为什么必须在 |
|---|---|---|
| `id` | `id` | 定位一封信（点开、引用、去重都要它） |
| `from` | `from` | 原有 |
| `to` | `to` | ★ 有了它"谁发给谁"才**可读**；从 `from` 反推**做不到**（同一个 `from` 可发多个收件人） |
| `content` | `content` | 原有 |
| `ts` | `ts` | ★ **排序与显示**。没有它只能靠**数组序**猜先后，而数组序是**投影顺序**、不是时间顺序（截断后会分叉） |
| `taskId` | `sourceTaskId` | ★★ **一条线程的分组键** |
| `attemptId` | `sourceAttemptId` | 这条消息**针对哪一代**（同一任务多代时不能混） |
| `taskStatus` | `sourceTaskStatus` | ★ 写信**当时**任务是什么状态（事后会变，所以要记当时的） |
| `read` | `readAt !== undefined` | ★ 已读/未读。★ 而"已读"**不再**让它从投影里消失 |

★ **缺席的三格（`taskId?` / `attemptId?` / `taskStatus?`）在缺席时整个键不出现** ——
「不属于任何任务」与「属于一个名字为空的任务」**不同形**。

### ★★ 为什么不新开一条读路径

`readMailbox`（读全部）**本来就有**，而 `readUnreadMailbox` 就是它再 filter 一次
（实测两行：`.filter(m => m.readAt === undefined && m.discardedAt === undefined)`）。
⇒ 本次是**改用**既有那条，**不是**新开一条。
★ 而"已读/未读"这件事**没有丢**：它如实落在 `read` 那一格。

### ★★ `MAILBOX_PROJECTION_LIMIT` 为什么仍取 5

与改造前的 `slice(-5)` **同一个数**。★ 本轮改的是"**投影几格**"与"**读哪些**"，
**不是**"投影多少条" —— 把条数一起改大，会让"字段变多"与"载荷变大"两个读数**混在一起、无法归因**。

---

## 4. ★★★ 反向半边（4 臂，实测）

```
$ node --test scripts/gate-mailbox-projection.test.mjs
✔ ★★★ 臂 1（A）：一条【已读】的消息 ⇒ 仍必须在投影里（不许因为读过就消失）
✔ ★★ 臂 2（B）：超过上限 ⇒ 必须报出【截了几条】，不许静默截断
✔ ★★ 臂 3（C）：空信箱 ⇒ 与「读不到信箱」不同形（缺席 vs 空）
      ℹ 空信箱 ⇒ 那一格缺席（"确实没有"）；读不到 ⇒ 那一格在场（"没能测量"）
✔ ★★ 臂 4：投影是【九格】，且 taskId（分组键）真的带出来了
✔ ★★ 臂 5：已读【留下】而已丢弃【不留】 —— 两种状态的过滤意图不同
```

★ 夹具**驱动真实的 `assembleTeamSnapshot`**（不是复算它的逻辑）——
所以它测的是"**装上去的那份**"，而不是"我以为它写了什么"。

### ★★ 反向半边 C 顺带查出并修掉的一个**更坏的形状**

```
信箱不存在 ⇒ readMailbox 返回 []   （"确实没有"）
信箱读不了 ⇒ readMailbox **抛错**  （"没能测量"）
★★ 而调用处此前【不接错】⇒ 抛出后被 collectTeamsActivity 的
   catch { logger.warn(...) } 吞掉 ⇒ ★★★【整支队伍从快照列表里消失】
```

⇒ ★★ 于是「**这支队读不到**」与「**这支队不存在**」在面板上**同形** ——
那正是本仓记账最久的形态，只是换了个入口。
★ 修法：**接住它**并如实投影 `captainInboxUnreadable`，**不让整支队消失**
（信箱读不了是**一个字段**的问题，不是"这支队伍不存在"）。

⇒ 三态**互不同形**：
```
captainInbox: []  且  captainInboxUnreadable【缺席】 ⇒ ★ 读到了，确实没有信
captainInbox: []  且  captainInboxUnreadable【在场】 ⇒ ★ 没读到（"没能测量"，不是"没有"）
captainInbox: [...]（非空）                          ⇒ 读到了，有信
```

### ★ 臂 2 的两个方向都钉了

```
超上限 ⇒ captainInboxOmitted = 3（★ 报出截了几条）+ captainInboxTotal
没超   ⇒ 那两格【缺席】（不是 0）—— "截过但没超"与"没截过"不同形
```

---

## 5. ★★ 对照组：证明这 4 臂**不是恒真**

`git stash --include-untracked` 掉修复 + 重建 + 跑同一夹具：
```
fixture exit=1   ⇒ ★ 9 处 ✖（4 臂全红，含"failing tests"重复计数）
```
⇒ ★★ **同一夹具在修复前后一红一绿** ⇒ 有分辨力。

---

## 6. 净变化

```
$ pnpm test:gates      # 对照：1528 tests / 16 文件    改后：1532 tests / 16 文件
$ diff <(对照失败文件集) <(改后失败文件集)
（无输出）
```
★ **用集合判定**：**逐条相同** ⇒ **净新 0、净减少 0**。
★ 而 **+4 tests** 正是本夹具的 4 臂 ⇒ **实证它真的进了跑者**
（命名符合 `scripts/gate-*.test.mjs` 那个 glob，无需改 `package.json`）。

★ **边界**：`src/client/**` **零改动**（`git status --porcelain -- src/client` ⇒ 空）。
★ 而客户端**本来就读自己的形状**（`src/client/activity-monitor.ts` 有自己的 `ActivityMessage`）
⇒ 本轮与**任何 UI 形态选择都兼容**，符合任务书那条边界。

---

## 7. 局限（如实留白）

1. ★★ **客户端还不知道新九格** —— `src/client/activity-monitor.ts` 的 `ActivityMessage`
   仍是 `{ from, content }`。★ 本轮**只做投影**（服务端），
   而"UI 要不要用那七格"是**形态选择之后**的事（任务书明令不动 `src/client/**`）。
   ⇒ ★ 如实记下：**数据到了载荷里，但界面还没读它**（同 t87/t97 记过的"机制建好了 ≠ 接线了"）。
2. ★ **任务书那个"9 个任务"的计数未复现**（§2）—— 那棵树里量不出 `.agent-teams/`。
   ★ 结构结论（`sourceTaskId` 是分组键）**可核且成立**，但**数字**我报"未复现"。
3. ★★ **"已丢弃"的信我**堵掉了**，而不是放出来**（这条**曾经是我引入的回归**，已修）。

```
★★ 实测：readMailbox **不**滤 discardedAt（只有 readUnreadMailbox 滤，它滤两半）
⇒ 我把调用从后者换成前者时，会【顺手】把"已丢弃"的信也放出来 ——
   而它们在九格里**没有对应的格** ⇒ 与普通消息**同形**
```

⇒ ★ 修法：**只**滤 `discardedAt`，**不**滤 `readAt`：
```
· readAt 在场  ⇒ ★ 不该让它消失（那正是本任务要修的）
· discardedAt 在场 ⇒ ★ 是【另一种】状态（discardMailboxMessages 在
   create-task / members / reassign 三处被真的调用）
```
★★ 两者的**过滤意图不同** ⇒ **不许一起放行**。
★ 而 `discarded` **没有**进九格 —— 要让"已丢弃"可见需要**第 10 格**，
  而那是**形态决策**（任务书给的是九格）⇒ **由队长裁定，我没有擅自加**。
★ 本项已有**臂 5** 守着（实测：去掉那个 filter ⇒ **臂 5 当场红**）。
4. ★ **上限 5 是承重的**：信箱实测 108 条 ⇒ 103 条不进投影。
   ★★ 而**它们不会被静默吞掉**（`captainInboxOmitted` 报出来了）——
   但"报出来"与"看得见"不同：**线程的早期往返仍会被截断**。
5. ★ **未起真团队跑一轮**（夹具造的是信箱 jsonl + 真实 `assembleTeamSnapshot`，
   ★ 但没有经过真实的"派成员 → 收消息 → 刷新面板"那一路）。
