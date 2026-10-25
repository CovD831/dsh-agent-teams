# 形态验证 #1：`shape: 'dispatch'` 第一次真实运行

**日期**：2026-10-20 · **团队**：`dispatch-shape-probe` · **触发**：用户「跑真实队伍」

---

## 0. 这个实验要回答什么

用户 2026-10-20 的裁定（乙方案）让 `shape` 落盘并决定成员提示。而**那条机制此前从未真实运行过** ——
8 个存量队 `withShape=0`，包括本轮建的两个。

⇒ 这一轮要拿的是三组读数：

| # | 问题 | 为什么它要紧 |
|---|---|---|
| ① | 成员会话**还烧不烧穿上下文**？ | `self-iteration-3` 三个成员全部 `CONTEXT_WINDOW_EXCEEDED`（101.9 / 102.5 / 103.1 万 token），那是旧形态的直接代价 |
| ② | 每条任务是否真由**临时 sub-agent** 执行、拿到干净上下文？ | 这是形态的定义本身 |
| ③ | 这个形态在真实负载下**跑不跑得通**？ | 机制对不对 ≠ 能跑 |

---

## 1. 结果：形态成立

### 1.1 `shape` 真的落盘且真的选了提示

```
$ node -e "…readTeamSync('.agent-teams','dispatch-shape-probe')…"
team.shape = dispatch
成员会拿到的是: DISPATCH（命令式）✓
  开头: You are an AgentTeams member and THIS TEAM IS A DISPATCH TEAM: your durable role is the di…
```

★ 这是乙方案**第一次**在真实队伍上生效（此前的队全是 `shape=undefined` ⇒ 条件式提示）。

### 1.2 成员真的没有自己干活

`ledger` 的会话轨迹（17 次工具调用）里有**两次 `list_agents`** 与**两次 `sleep 120/240`** ——
它在**等 worker 干完**，而不是自己写文件。而 `scripts/dispatch-shape-readout.mjs`（1288 行）
是 worker 写的，ledger 只是 `ls -l` 它。

### 1.3 临时 worker 真的存在且上下文干净

```
$ ls -lat ~/.dsh/sessions/--Users-abab-Desktop-agent-teams-dev--/
drwx------ 4 abab staff 128 Oct 20 13:53 48403c6f-7600-45a7-9e16-f63f6eea3fc8   ← 新会话（13:53 创建）
drwx------ 4 abab staff 128 Oct 20 13:52 14f0a67e-dcf4-4381-9be9-9f8219d5ab71   ← ledger 自己的
```

`48403c6f` 是 ledger 派出的**一次性 sub-agent**，它从零开始（不是从 ledger 的历史里继承）。

### 1.4 ★★ 上下文消耗的对比（这是最要紧的一条）

| | 旧形态 `self-iteration-3` | 新形态 `dispatch-shape-probe` |
|---|---|---|
| 成员会话 | **101.9 / 102.5 / 103.1 万** token ⇒ 三个**全部** `CONTEXT_WINDOW_EXCEEDED` | ledger 累计 **38.1 万**（其中 cacheRead 33.2 万） |
| 每成员实际新增 | —— | **in 4.3 万 + out 0.6 万 ≈ 4.9 万** |
| 交付 | 多次中途被打断、实现靠队长从工作树抢救 | 一次跑完（1 个 worker，1 条任务，`completed`） |

★★ **累计量 ≠ 上下文占用量**：脚本自己在屏幕上逐字警告了这一点
（`★ 这是累计量，不是当前上下文窗口占用量，不许拿 1,000,000 去除它`）。
但**新增 in+out 4.9 万**是一个可以横向比的量：旧形态每个成员在**一条任务**上就要几万，
十几条任务后必然撞顶；新形态里**每条任务的消耗落在 worker 身上，worker 用完即弃**。

---

## 2. ★★★ 一个载重的技术发现：Node 的 zstd 只解第一帧

ledger 的 worker 报告的，我独立复现：

```bash
$ node -e "zlib.zstdDecompressSync(readFileSync(ledgerSession))"
内建解出字节数: 290
内建解出行数: 1

$ zstd -dc <ledgerSession> | wc -l
     165
```

**同一个文件**：Node 内建解出 **1 行**，`zstd` 解出 **165 行**。

根因：`session.v4.jsonl.zstd` 是**多帧追加**的（每帧一次 flush），
而 Node 26 的 `zlib.zstdDecompressSync` **静默只解第一帧** —— 不抛、不警告。

⇒ ★★★ 这是本仓记账最贵形态的又一个实例：**读到了，但读的不是你以为的那份**。
一个 token 计数器若用它，会得到一个**看起来像真的**的错数
（290 字节而不是完整内容 —— 而不是一个明显的 0 或错误）。

★ worker 的修法：脚本自带一个 RFC-8878 帧遍历器，并与 `zstd -dc` 逐字节对齐验证。
**任何人再写 token 计数器都会撞这一条** —— 记在这里。

---

## 3. ledger 报的两个缺口，我的裁决

### 3.1 `inspector` 的 `id: ""` —— ★ 不是缺陷，是「还没 spawn」

ledger 推断这是 harness bug。**不成立**：

```
$ node -e "…遍历 8 个队…"
agent-teams-hardening              id空=0 id有=10
agent-teams-refactor               id空=1 id有=10
dispatch-shape-probe               id空=1 id有=1     ← 本队
mutation-cost                      id空=3 id有=0
mutation-quality                   id空=0 id有=6
overnight-registration-hardening   id空=0 id有=3
self-iteration                     id空=4 id有=0
unified-pipeline                   id空=0 id有=4
```

`id === ''` 是**「尚未启动」的既有编码**（`mutation-cost` 三个成员全是空 —— 那是个 staged 队）。
本队 `inspector` 没有任务 ⇒ 调度器没有理由启动它 ⇒ `id` 为空。

★★ 而 ledger 的推断**本身**值得记：它把一个正常的"未开始"读成了"结构性不可测的缺陷"。
**「还没开始」与「测不了」在两个不同方向上都不该同形** —— 它警惕的方向是对的，
只是这一次的对象选错了。★ 正确读法是三态：`id === ''` ⇒ **不是 unmeasured，是 not-started**。

### 3.2 Q3（每任务由哪个 sub-agent 执行）没有数据源 —— ★ 成立，且是真缺口

```
$ grep -n "subagentCount\|dispatches\|childSessions" src/types.ts
（零命中）
```

`team.json` 的 `members[]` 只有 `executionPrompt/id/joinedAt/model/name/provider/
reasoningEffort/role/runtimeSetup/status`，**没有任何派工计数器**；
`tasks[]` 也没有"由哪个 sub-agent 执行"的字段。

⇒ **"这个形态真的在用吗"今天只能从会话文件旁证**（worker 的会话头有 `parentSession`），
而那不是台账。**这是一个应当单独开的缺口**，本轮不夹带。

★ 它的价值在于：`shape` 只声明了**意图**，而"意图有没有被执行"没有任何机械读数。
一个 `shape: 'dispatch'` 的队如果成员全都自己干活，今天**没有任何判据会红**。

---

## 4. 结论

| 问题 | 裁决 |
|---|---|
| ① 还烧不烧穿？ | **形态层面已解决**。消耗落在 worker 身上，worker 用完即弃；ledger 只累积"派工 + 核字段"的上下文（本任务新增 4.9 万） |
| ② 真派临时 worker 了吗？ | **confirmed**。独立会话 `48403c6f`，13:53 创建，产出 1288 行脚本，ledger 全程只 `list_agents` + `sleep` |
| ③ 跑得通吗？ | **confirmed**。1 条任务，一次跑完，`completed`，交付物质量高于以往成员直接写的那批 |

★ 而**两个缺口都指向同一件事**：
**`shape` 是一条声明，而"声明有没有被执行"今天没有读数。**
本轮的形态验证靠的是我手工看会话文件 —— 那不是判据。
