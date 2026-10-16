# 待你裁定（2026-10-16 · 本会话汇总）

> **用途**:本会话的裁定散落在 15 份专题文档里 —— 而**"散着"与"没有"在读的时候差别不大**。
> ★ 本文把它们**汇成一处**,每条附**已完成的读数**与**可复跑命令**,你只需拍板。
>
> ★ **前身**:`docs/AWAITING-YOUR-RULING.md`（2026-10-15 深夜,116 行）——
> 那一批**已全部裁定**,本文是接续。

---

## 0. 本会话已落地（先看这个 —— 你不用管的）

| 事项 | 状态 | 证据 |
|---|---|---|
| **`collection` 第七个插入点** | ✅ 7 位置 · 21 判据 | `node -e "…INSERTION_POINTS.length"` ⇒ 7 |
| **四条采集判据接生产路径** | ✅ 3 个调用点 | `entities.ts:4136` · `create-task.ts:616` · `tools.ts:2124` |
| **采集模块的输出** | ✅ `RoutingDecision` 五态 + `Proposal` | `src/evolution/propose.ts` |
| **评估器独立模块** | ✅ `src/evaluator/` 三文件 | 零 import 于 evolution/gates |
| **台账写入竞态** | ✅ 原子写 + id 占用一步化 | 385 文件 · **坏 0**（原 12） |
| **信号 id 撞车** | ✅ 逐行 parse 取代正则 | `duplicateSignalIds()` 报出 5 组 |
| **上游 #183 排除谓词** | ✅ 推导与闸门共用一份 | 复现⇒修复,5 臂绿 |
| **上游 #174 行号锚点** | ✅ `stripLineAnchors` + 声明 | 6 臂绿 · 反向半边 4/6 红 |
| **全量** | ✅ **零新增失败** | 1509/1449/23/**16 文件** |

---

## 1. ★★★ 已裁定,但**尚未派工**的（1 条）

### ① `worktree` 的去留 —— 仍需 D1 数据

**背景**（早先 `AWAITING-YOUR-RULING.md` §3 留下的）:
```
★ 需要的数据:哪些任务真的用到了隔离 worktree 的价值（否则它是纯成本）
⇒ ⚠️ 而本会话【没有】采集到那份数据
```

**★ 可跑的读数:**
```bash
# 有多少任务派生到 worktree，而其中多少真产生了独立提交
ls .agent-teams/worktrees/ | wc -l
```
**★ 你需要定的**:留 · 去 · 只在特定 kind 上启用。

---

## 2. ★★★ 正在做的（你已批准,不需再定）

| # | 事项 | 状态 |
|---|---|---|
| **S1** | 判决落盘记「它绑定了哪些字节」 | 🔄 **t97 在跑**（你已批准）|

★ **而 S1 的后果你已据它批准:**
```
★★ 补上内容摘要后:【所有历史判决立刻落 unauditable gap】
   ——★ 那正是 ③ 的正确行为（"未绑定不许读成 sound"）
   ★★ 但它会让"能不能宣布交付"立刻变严
```

---

## 3. ★★★ 需要你判的（**3 条**）

### ① #176 fork 链上的团队身份 —— **队长的建议:(乙) 部分吸收**

**我们的现状（★ 实测 **12 处**，分布在 **9 个文件**，其中 3 处在客户端）:**
```
服务端 9 处:
  src/state.ts:727          team?.captainSessionId === captainSessionId
  src/state.ts:762          team?.captainSessionId === agentSessionId
  src/members.ts:383        team?.captainSessionId === parentSessionId
  src/scheduler.ts:1189     located.captainSessionId === agent.id
  src/tools/status.ts:653   located.captainSessionId === caller.id
  src/tools/update-task.ts:2102  team.captainSessionId === caller.id
  src/tools/shared/entities.ts:1157  team.captainSessionId === agentId
  src/tools/create.ts:88    current.captainSessionId === captain.id
  src/tools/create.ts:89    current.captainSessionId === captain.id
客户端 3 处:
  src/client/activity-model.ts:128       team.captainSessionId === owner
  src/client/activity-monitor.ts:486     team.captainSessionId === discoverySessionId
  src/client/activity-monitor.ts:497     team.captainSessionId === target.sessionId
```
★★★ **而客户端那 3 处值得注意:它们读的是同一份 team 记录,
所以"服务端收口"之后，客户端若仍精确匹配，【两边会不一致】。**
★ 队长第一版写成"六处" —— **而实测是 12 处** ⇒ ★★ 那正是本文要防的形态（数错一处而看起来对）。

**上游逐字（`38a84b9`）:**
> 「**#176: team identity now resolves through the durable fork chain**
>  （live session first, **stored header through `sessionPersistence.stat`** otherwise）,
>  so a captain that continues in its fork still leads its team,
>  **including a cold parent chain and multi-level forks.**」

★★★ **而队长核实了一个决定性约束:**
```
★ 上游依赖 `sessionPersistence`（持久化服务）
★★ 而我们的树里 sessionPersistence 【0 命中】—— 拿不到
⇒ ★★★ 所以上游那套（"live session 优先，否则读持久化 header"）
   在我们这里【只有前半:live session】
   ★ 而"冷父链"（cold parent chain）那一半【做不到】
```

### ★★★ 所以三条路（而我建议 (乙)）

| | 做法 | 代价 | 覆盖 |
|---|---|---|---|
| **(甲)** | **全盘照搬** | ★ 要接 `sessionPersistence`（我们没有）| ⚠️ **做不到** |
| **(乙)** | ★★ **只做 live 链解析** —— 一个 `leadIdentityOf` 收口六处 | ★ 小（一个纯函数 + 六处调用点）| ★ **活的 fork 链** |
| **(丙)** | **不做** | 零 | ⚠️ fork 后仍找不到队 |

**★ 我建议 (乙),理由:**
```
① ★ 上游要的一半我们【有】:live session（parentSession 字段我们能读）
② ★★ 而另一半（冷父链）依赖 sessionPersistence —— 那是我们拿不到的
   ⇒ ★ 硬做会造出"看起来支持 fork，而冷链时静默失败"的东西
     ★★ 而那正是本会话反复的形态
③ ★★ 而 (乙) 还有一个独立价值:【六处精确匹配收口成一处】
   ⇒ 下一个人要改团队身份判定时，只有一个地方
```

★★ **而 (乙) 必须【显式报出它没覆盖的格】:**
```
★ "冷父链（父会话不驻留）⇒ unmeasured" —— 不许静默当成"不是队长"
```

### ② `docs/REQUIREMENTS.md` 要不要建 —— 队长建议:**建**

```
★ 全局指令要求:有该文件时，新需求/设计原则/被推翻的旧判断应提案追加
★★ 而本仓【没有它】⇒ 那条指令不适用
⇒ ★★★ 但本会话的裁定散在 15 份专题文档里
   ★ 而"散着"与"没有"在读的时候差别不大
```

★ **建了之后可以跑 `workbench-align`**（实现与需求双向对齐:需求未实现 + 实现了但无需求认领）。

### ③ 本会话**反复出现的形态**要不要落成一条规则 —— 队长建议:**要**

**本会话 8 次同族事故:**
```
① t79/t80「尝试被拦下」被我写成「越界」
② #2 一条被我写成两条
③「四处登记」实际五处
④「第二份完整写入」实际是残片
⑤ 我的验收写 test:gates 而那条命令不含被测文件（t73）
⑥「全跳过」被画成 ✓（c4cbeaf）
⑦ ★ 我读了上游的排除列表，当成我们的（t95 纠正）
⑧ ★ 我引的锚点字符串属于另两个测试（t96 纠正）
```

⇒ ★★★ **共同的形态:「两件不同的事在读数里同形」**
```
· 「命令失败」与「文件是空的」
· 「没采」与「采了没用」
· 「已解决」与「待处置」
· 「机制缺失」与「数据缺失」（t94 的区分）
· 「不存在」与「没读到」
```

★ **而它已经在代码里被反复落地**（`unmeasured` 出现在 5 层语汇里）。
**★ 而它还没有一条【写下来的规则】** —— 供下一次会话直接照做。

---

## 4. ★ 我如实说的两条

```
① ★ 本文只汇总【本会话】的裁定 —— 早先那批已全部裁定，不重复列
② ★★ 而 §3③ 那条"要不要落成规则"是【我的提案】，不是既有裁定
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
