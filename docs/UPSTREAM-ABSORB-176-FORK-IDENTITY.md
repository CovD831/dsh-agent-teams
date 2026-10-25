# #176（乙）：沿活的 fork 链解析团队身份（t98）

> **改动**：新增 `src/lineage.ts`（纯函数）+ 收口服务端 **9 处**精确匹配 + 判据 `scripts/gate-lead-identity.test.mjs`（9 臂）。
> ★ **客户端 3 处未改，理由在 §5**（那是本任务要求"改或显式报出"的那一格）。

---

## 1. 它修的是什么（上游 `38a84b9` 逐字）

> 「**#176: team identity now resolves through the durable fork chain** …
>   so a captain that continues in its fork **still leads its team**」

★ 今天的行为是**精确 id 相等**（`team.captainSessionId === <会话 id>`）。
★★ 而队长**在自己的 fork 里继续**时，那个 fork 是**另一个会话 id**
⇒ **它认不出自己带的队** —— 即上游那句 "**stops matching the team it leads**"。

---

## 2. ★★★ 边界：只做**活**链，冷父链**显式**报 `unmeasured`

上游那套是「**live session first, stored header through `sessionPersistence.stat` otherwise**」。

```
$ grep -rn "sessionPersistence" src/    ⇒ 0 命中
```

⇒ ★ **拿不到** ⇒ 本模块**只做前半**（live 链）。
★★ 而**冷父链必须显式报 `unmeasured`**：

```
  父会话不驻留（不在活清单里） ⇒ kind: 'unmeasured'   ★ 不是 'not-lead'
  reason 里点名【断在哪一环】与【根因（缺 sessionPersistence）】
```

★ **为什么这条边界必须显式**：若冷链静默落回"不是队长"，那么
**「我们测不出来」**与**「它确实不是队长」**会**同形** —— 本仓记账最久的形态。
★ 而"看起来支持 fork、冷链时静默失败"的实现**比不实现更坏**（虚假的信心）。

---

## 3. `leadIdentityOf`：三态 + **两段**资格判据

```
lead        ⇒ ★ 这个会话（或它的某个祖先）就是这个队的队长（hops = 走了几跳）
not-lead    ⇒ ★ 它不是队长，而且这件事**可判定**
unmeasured  ⇒ ★★ 判不了：链上有一环不驻留，或链成环
```

★★★ **而"谁有资格继承 lead 身份"是两段，缺一不可**（上游逐字警告）：

| 段 | 挡什么 |
|---|---|
| ① 它**自己不是**成员（精确相等） | 成员的父链里**必然**含队长 ⇒ 先走链会**必然**把它认成 lead |
| ② ★★ **链上经过的每一环都不许是成员** | 一个**成员的 fork**（子代理的子代理）不许继承 |

### 3.1 ★★ ② 是**臂 4 当场抓到**的（我的第一版只有 ①③）

```
   MFORK → MEM → CAP        MEM 是成员；MFORK 不在 memberIds 里
   ⇒ ① 不成立 ⇒ 继续走 ⇒ 走到 CAP ⇒ ★ 给出 lead（错）
```
★ 而 `MFORK` 是**一个成员的 fork** = **子代理的子代理**，
**不是**上游说的 `top-level conversation` ⇒ 它**不许**继承。

⇒ ★ 正确判据是「**链上不许经过成员**」：一旦走到成员，那条链就**离开了顶层**；
从那里往上认到的队长，认的是**成员与它的队长**那条边，**不是** fork 关系。

★★ **一句话说明 ① ② 的分工**：① 挡**起点**在成员树上；② 挡**中间**进了成员树。
⇒ 少了 ② 就有一条**绕过 ①** 的路。

---

## 4. 收口服务端 9 处

| 文件 | 收口后 |
|---|---|
| `src/state.ts:727` `findTeamByCaptain` | 用 `sessionLeadsTeam(...)`；**新增可选第三参** `liveSessions?` |
| `src/state.ts:762` `findTeamByParticipant` | 队长那一半走链；★ **成员那一半照旧精确匹配** |
| `src/members.ts:383` 成员准入 | 走链（`parentSessionId` 通常会命中；fork 队长时**不会**） |
| `src/scheduler.ts:1189` | 走链（认不出 ⇒ 那次 kick **静默不发生**） |
| `src/tools/status.ts:653` | 走链（同上） |
| `src/tools/update-task.ts:2100` | 走链（决定 kick 带不带 `caller`） |
| `src/tools/shared/entities.ts:1157` | 走链（否则 fork 队长落到 `undefined` = **它什么都不是**） |
| `src/tools/create.ts:88` / `:89` | ★ **两行同源 ⇒ 必须一起收口**（否则"关系"说 lead、"指引"说当成员 —— **同一份事实两个结论**） |

★ 实测：收口后**服务端再无一处** `captainSessionId === …`（只余注释）。

### 4.1 ★★ 关键设计：`liveSessions` 是**可选**参数

```
   ctx 在手（5 处）：index.ts ×2 · mailbox.ts · members.ts · scheduler.ts · status.ts · update-task.ts · create.ts · entities.ts
   ctx 不在手：state.ts 的两个函数 —— 它们被工具层/调度器/HTTP 路由共同调用
```

★★ 为什么**不做成必填**：那会逼**每一个**调用点都先学会枚举会话 ——
既越权（`state.ts` 不该碰 `ctx`），也会在拿不到 `ctx` 的路径上
（如 HTTP 路由）逼出一个**编造的空清单**（= "假装测过"）。

★ **缺席 ⇒ 行为与今天逐字相同**（`sessionLeadsTeam` 落到 `'exact'` 策略）。
★ 而**枚举不可用**（`liveSessionRefs` 报 `could-not-measure`）⇒ `liveRefsOf` 返回 `[]`
⇒ 链走不动 ⇒ **同样退回精确相等** ⇒ ★ 即"枚举坏了"**不改变任何既有裁决**
（本任务只**加**一条路，不该让坏掉的枚举改变放行/拒绝）。

---

## 5. ★★★ 客户端 3 处：**未改**，以及为什么（这是任务要求显式报的那一格）

```
src/client/activity-model.ts:128       team.captainSessionId === owner
src/client/activity-monitor.ts:486     team.captainSessionId === discoverySessionId
src/client/activity-monitor.ts:497     team.captainSessionId === target.sessionId
```

**不改的理由（三条，都可核）**：

| # | 理由 |
|---|---|
| **①** | ★★ **客户端拿不到父链**：它只知道**自己那个会话 id**（`index.tsx:154` 的 `sessionId`）。而 fork 解析要的是**那个 id 的 `parentSession`** —— ★ 实测 `/state` **从不发送**调用者的父链（`grep -n parentSession src/tools/status.ts` ⇒ **0 命中**）。 |
| **②** | ★ 客户端**已有**的 `parentSession` 字段（`activity-model.ts:777`）**只是成员子代理那一层**（`MemberSubagent`，来自 `snapshot` 的成员面），**不是**队长自己的 fork 链 ⇒ **形状不同、不能借用**。 |
| **③** | ★★ 那三处**不需要**改：它们问的是"**这份 /state 载荷**里有没有我带的队"，而 `captainSessionId` 是**服务端落盘的权威值**。⇒ 正确的修法是**服务端在它自己那一半解析**，而客户端继续读那个权威字段。 |

★★ **而"两边不一致"这个风险必须正面回答**（不然上面三条只是辩解）：
- **服务端**那 9 处问的是「**这个会话**是不是队长」⇒ 现在**沿链**答。
- **客户端**那 3 处问的是「**这份载荷里**有没有 `captainSessionId === <我的会话 id>` 的队」⇒ 它答的是**同一件事**，而它的输入是**服务端已经决定好的那份载荷**。
- ⇒ ★ **当服务端认为"这个 fork 是队长"时，那份载荷里那条队的 `captainSessionId` 仍是【原始队长会话】** ——
  而客户端的 `owner` 是**它自己的 fork 会话 id** ⇒ **仍然不相等**。

⇒ ★★ **所以这里确实存在一个真实的不一致**，而它**不是**这次收口引入的：
**客户端从一开始就无从知道自己的 fork 身份**。正确的修法是让 `/state` 多送一格
「**调用者是不是这个队的队长**」（服务端算好），而**那要改 `/state` 的载荷形状** ——
★ **`src/tools/status.ts` 在 inScope 里，但改载荷形状会影响客户端契约**，
而**那需要一条**"客户端改 + 服务端改"的**配套**裁定（本任务只拿到一端的写域）。

★ 所以我**如实报出**，并给出**可核的读数**：客户端那 3 处**仍读权威字段**，
在"fork 队长"这一种情形下**与服务端结论不同**（服务端：是队长；客户端：找不到自己带的队）。
⇒ ★ 这不改变任何**服务端**裁决（放行/拒绝由服务端定），
只影响**面板显示**（fork 出来的队长看不到自己那支队的面板）。

---

## 6. 判据（9 臂）

| 臂 | 测什么 |
|---|---|
| 1 | ★★ **反向半边 A**：fork 出来的会话 ⇒ 仍认到它带的队（`viaSessionId=CAP`、`hops=1`） |
| 2 | ★ 多级 fork（`FORK2→FORK→CAP`）⇒ 隔两代也认得到（`hops=2`） |
| 3 | ★★★ **反向半边 B**：**成员**（父链也含队长）⇒ **不许**被认成 lead |
| 4 | ★★ **"成员的 fork"**（`MFORK→MEM→CAP`）⇒ 也不许继承（链上不许经过成员） |
| 5 | ★ **不许改语义**：自己就是队长 ⇒ 仍 lead，且 `hops === 0` |
| 6 | ★★ **反向半边 C**：父会话**不驻留** ⇒ `unmeasured`，且 `reason` 点名断点与根因 |
| 7 | ★ 顶层会话（在册、父为空）⇒ `not-lead`（与臂 6 **不同形**） |
| 8 | ★★ `unmeasured` 的退让是**显式策略**（且 `exact` 下"subject 就是队长"仍必须放行） |
| 9 | ★ 父链成环 ⇒ 不许永不返回（走满上限 ⇒ `unmeasured`） |

### 6.1 ★★ 反向半边 A/B/C 的实测读数

```
A  FORK（parent=CAP）          ⇒ lead（viaSessionId=CAP, hops=1）   ✅
A' FORK2（parent=FORK）        ⇒ lead（hops=2）                     ✅
B  MEM（parent=CAP, 是成员）   ⇒ not-lead（reason 引上游原话）      ✅
B' MFORK（parent=MEM）         ⇒ not-lead（链上经过成员）           ✅
C  ORPHAN（parent=GONE，不驻留）⇒ unmeasured（reason 含 GONE 与 sessionPersistence） ✅
```

---

## 7. 净变化（判据是**集合**）

```sh
# 基线（stash --include-untracked，★ 先确认它建得起来）
$ pnpm build ⇒ exit=0                  ← ★ 若建不起来，下面的读数就是假的
$ pnpm test:gates ⇒ ℹ tests 1516 · pass 1455 · fail 23 · **16 文件**
# 改后
$ pnpm test:gates ⇒ ℹ tests 1525 · pass 1464 · fail 23 · **16 文件**
$ diff <基线失败集合> <改后失败集合>  ⇒ **无输出** ✅（净新 0、净减少 0）
```

★ **判据数 1516 → 1525（+9 = 本判据的 9 条臂）**，而 **fail 一侧一动不动（23 ⇒ 23）**。
★ `npx tsc -p tsconfig.json --noEmit` ⇒ **exit=0**；
`npx tsc -p tsconfig.client.json --noEmit` ⇒ **exit=0**；`pnpm build` ⇒ **exit=0**。

---

## 8. ★ 一处必须记账的**取回事故**（我自己犯的）

跑对照跑时我 `git stash push --include-untracked`，随后 `git stash pop` **报冲突**
（`lib/client.js` 与 `git-artifact-stamp.json` 在两侧都动过），而 **stash 被保留**。
★★ **我的 7 个 `src/` 收口一度不在工作树里**（实测 `grep -c sessionLeadsTeam src/state.ts` ⇒ **0**）。

**处置（按本队记账过的那条纪律：先备份，再动作）**：
1. ★ **先**把 stash 内容逐文件导出到 `/tmp/t98-stash-recovery/`（7 个文件，先验证里面有我的收口）；
2. 再从 `stash@{0}` 逐文件写回 7 个 `src/` 文件；
3. 复核（每个文件的收口计数 > 0）⇒ 重建 ⇒ **两套 tsc + build + 9 臂全绿**；
4. 确认 `/tmp` 安全副本仍在，**才** `git stash drop`。

★ **教训（与 t97 那次同族，但这次防线生效了）**：`git stash pop` 的冲突**不报错退出**，
而它**保留** stash —— 于是"pop 过了"与"改动回来了"**不同形**。
⇒ ★★ **判据是去工作树里数一遍**（`grep -c`），而不是读 `pop` 的输出。

---

## 9. ★ 诚实边界

| # | 边界 | 说明 |
|---|---|---|
| **1** | ★★ **不支持冷父链** | 见 §2。★ 它**显式报 `unmeasured`**，且根因（缺 `sessionPersistence`）写在 `reason` 里。 |
| **2** | ★★ **客户端 3 处未改** | 见 §5。★ 那是一个**真实的不一致**，而它**不是本次引入的**（客户端从来无从知道自己的 fork 身份）。★ 正确的修法要改 `/state` 载荷形状 ⇒ 需要一条**配套**（两端同时改）的裁定。 |
| **3** | ★ **`liveSessions` 是可选的**，缺席即今天的行为 | ⇒ ★ 那 5 个拿不到 `ctx` 的调用点在**本轮之后仍只认精确相等** —— 我没有替它们"编一个空清单"。★ 这是**有意的保守**：本任务只加一条路。 |
| **4** | ★ 环保护的上限是 `liveSessions.length + 1` | ★ 它防的是"永不返回"（本函数在**调度器热路径**上）。★ 代价：一条**异常长**的合法链（比活会话数还长）会被算成 `unmeasured` —— 而那在真实数据里构造不出来。 |
