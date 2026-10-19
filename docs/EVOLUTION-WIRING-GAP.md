# 采集层的接线缺口：三个模块零消费者（2026-10-17）

> ★ 队长在准备"接投影"时先核了数据源 —— 而发现**数据源本身还没接上生产**。

---

## 1. ★★★ 实测

```
src/evolution/ 的五个模块，按"非本目录的 import 数"数:

  collect.ts   7 个消费者   ✅ 已接（t87 那三个调用点）
  types.ts    17 个消费者   ✅ 类型
  health.ts    0 个消费者   ★★ 零
  history.ts   0 个消费者   ★★ 零
  propose.ts   0 个消费者   ★★ 零（★ t91 刚造的）
```

⇒ ★★★ **而这意味着:**
```
★ `collectionHealthOf`（redundancy / coverage / refused 的读数）【从没被生产路径调用过】
★ `recordFriction`… 不,那是台账 —— 而 history 的判据变更历史【从没被写过一条】
★ `RoutingDecision` / `Proposal`（t91 造的结论产出)【从没被产生过一个】
```

## 2. ★★ 所以"接投影"这个动作**现在做不了**

```
★ 投影要显示"采集了多少 / 重复率多少 / 拒绝了多少"
★★ 而那个读数函数【零消费者】⇒ 没有任何生产路径算过它
⇒ ★★★ 所以先接投影 = 把一个【从未计算过】的读数画到界面上
```

★ **而那正是本会话那条主轴的第四次:**
```
t87「装了但调不到」（判据零调用）
t97「机制建好但没接上」（S1 的 audit 没传）
UI「能算但看不见」（client 的 FLISTAGES 分叉）
★★★ 而这次:「能算，但【从没算过】」—— 比前三者更早一步
```

## 3. ★ 缺的具体是什么（三处，各不同）

### ① `health.ts` —— 缺**调用方**

```
★ `collectionHealthOf(records)` 要一份 records 数组
★★ 而 records 从哪来:从 `signals.jsonl` 读（那是 t87 写的采集流）
⇒ ★★ 缺的是:"在某个生产路径上读 signals.jsonl 并算读数"
★ 而实测:signals.jsonl 现在 15 条 ⇒ ★ 数据在,读的人在
```

### ② `history.ts` —— 缺**写方**

```
★ `record({gateId, at, before, after, evidence})` 四格缺一即抛
★★ 而【没有任何生产路径调用它】⇒ ★ 判据变更历史是空的
⇒ ★★ 缺的是:"改判据时记一条" —— 而那个动作【现在不存在】
```

### ③ `propose.ts` —— 缺**产生方**

```
★ t91 造了 `RoutingDecision`（五态）与 `Proposal`
★★ 而没有任何路径产生过一个 Proposal
⇒ ★★★ 缺的是:"把一条信号转成一个 Proposal" —— ★ 那正是【分流】那一步
```

## 4. ★★ 与本会话已裁定的关系

```
★ 用户早先裁定:三模块 = 采集 · 实施(不存在) · 评估器
★★ 而采集模块内部的【结论产出】是 t91 造的 —— 而它的【上游】（分流）还没做
⇒ ★★★ 所以管道是:采集 ✅ → 分流 ⬜ → 结论 ✅(类型在,无产生者) → 实施(走派发)
```

★ **而"分流"正是 `RoutingDecision.modality` 要回答的问题**（hard/soft/contract/none/unmeasured）。
⇒ ★★ **所以 ① 与 ③ 其实是同一件事的两端:分流产出结论,而健康读数给分流提供依据。**

## 5. ★ 所以下一步的顺序建议（依赖，不是偏好）

| 顺序 | 做什么 | 为什么 |
|---|---|---|
| **①** | ★ **读 signals.jsonl 并算健康读数**（给 `health.ts` 一个消费方）| ★ 它数据最全，且**它是分流的依据** |
| **②** | ★ **分流**：信号 → `RoutingDecision` | ★ 让 `propose.ts` 有产生者 |
| **③** | ★ 判据变更历史（`history.ts` 的写方）| ⚠️ 要改判据的路径，独立 |
| **④** | 接投影到界面 | ★ 必须等 ①② 有数据 |

★ **而 ① 与 ③ 独立,② 依赖 ①。**

## 6. ★ 一条我如实说的

```
★ 本文是【队长在准备接投影时顺手核出来的】—— 不是派工的结果
★★ 而它改变了我上一条消息说的顺序:
   "③ 先接 collection 层"【做不了】—— 因为它没有可显示的读数
⇒ ★★★ 正确的是:先让读数【存在】,再让它【可见】
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*

---

## 7. ★★★ t101 执行记录：§5 顺序① 已落地 —— 读数【存在】了

> **本节由 t101 追加。** §1 实测的 `health.ts 零消费者`，至此结束：
> `collectionHealthOf` 在 `src/snapshot.ts:631`（`assembleTeamSnapshot` 内）有了**第一个生产调用方**，
> 而快照经 `/plugins/dsh-agent-teams/state` 路由（`index.ts:412` → `collectTeamsActivity`）生产可达。

### 7.1 落地了什么

| 文件 | 内容 |
|---|---|
| **`src/evolution/read.ts`（新建）** | `readSignalsHealth(stateRoot, readFile)` —— 读真实 `signals.jsonl`（`signalsPathOf` 拼路径），逐行 `JSON.parse`（**两种历史形状并存**：t88 带空格 / t87 不带——解析与序列化格式解耦，t93 的教训），投影成 `HealthRecord[]`（component=`source.where`、kind=[信号三分类]、at）+ `refused`（从每行自带 `collection.verdicts` 数 `ok` 之外的裁决，**转发不重算**）。 |
| **`src/snapshot.ts`** | `TeamActivitySnapshot` 增两格：`collectionHealth?`（`{health, readout}`，只**算出来**时在场）+ `collectionHealthUnmeasurable?`（真算不了＝异常）。`assembleTeamSnapshot` 调用（归档团队不算——与 `historic` 同口径）。 |
| `src/evolution/health.ts` | **零改动**（被消费，不是被改）。 |

### 7.2 ★ 三态（三种"没有读数"互不同形）

```
A · 文件缺席（流水线没开过）        ⇒ collectionHealth 整格缺席（**不是空读数**）+ readout.status='unmeasured'
B · 文件在、零条记录                ⇒ measured + 空集（redundancy/coverage=0）—— 与 A 不同形
C · 一行坏 JSON                     ⇒ 只跳那一行（skippedMalformed 计数），其余照常算（t93 纪律）
另 · 真的算不了（异常）             ⇒ collectionHealthUnmeasurable 在场 —— 与 A 不同形
```

### 7.3 反向半边（全部实测：变异体当场红）

| 臂 | 钉什么 | 变异体实测 |
|---|---|---|
| A | 文件缺席 ⇒ unmeasured；refused/totalLines **缺席**（不补 0） | 改成返回空读数 ⇒ **2 臂红** |
| B | 文件在零记录 ⇒ measured+空集 | （A 变异体同时红 B 侧） |
| C | 一行坏 JSON ⇒ 计数地跳过 | 改成整文件放弃 ⇒ **1 臂红** |
| 4/4b | 两代形状全 parse；refused 分组；**撞号不去重**（redundancy 1/2） | — |
| **5** | ★ 真实 `assembleTeamSnapshot`：有信号 ⇒ 快照带 `collectionHealth`；缺席 ⇒ 整格缺席 | **拔掉接线 ⇒ 1 臂红** |

夹具：`scripts/gate-collection-health-readout.test.mjs`（6 臂全绿）。

### 7.4 投影口径（如实：数据形状决定的）

- **桶分类今天偏窄**：真数据 15 行里 t88 的 10 行分类住在自由文本 `routing.target/effect`（无桶），t87 的 5 行只有 `source.where` + 三分类 ⇒ 本读数今天主要回答"按 (来源， 信号三分类) 分桶的重复率"。**分类不出来的落 `(unattributed)`，不编**；规格顺序 ②（分流）产出结构化类别后，投影在 `read.ts` 一处升级。
- **refused**：`ok` 之外的裁决各计一次；`unmeasured` 与 `false` 都算"没采进来"但**不合并也不分列**（要分＝形态决策，留给队长）。**没有 `collection` 格的行不数**（不补 0）。
- **重复 id（5 组撞号）不去重** —— 同桶重复正是 `redundancy` 要暴露的（实测：两条同桶 ⇒ redundancy 1/2）。

### 7.5 Verify 与局限

- 两套 tsc + build 均 exit=0；净变化：对照跑（stash --include-untracked + 确认能建）**1533/1472/23/16 文件** vs 改后 **1539/1478/23/17 文件**（+6 = 本夹具 6 臂；失败文件集合除本夹具外零差异）。
- **局限**：① 客户端还不知道这一格（activity-monitor 的界面类型没读它——"机制建好 ≠ 接线"，B 线任务）；② 桶分类语义窄于规格（见 7.4）；③ refused 不分 `unmeasured`/`false`（形态决策留给队长）；④ 未起真团队跑一轮；⑤ 归档团队不算读数（`historic` 口径）。
