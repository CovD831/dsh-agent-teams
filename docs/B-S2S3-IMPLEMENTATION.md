# B 线 S2 + S3：判据数据的转发与按成员渲染

> t77 · 实现文档
> 基线：`a575fdc`（含 S1 恢复 + t74 去重 + t75/t76 两条判据）

## 摘要

S2 把 S1 已落盘的 `TeamTask.gateEvaluation` 转发到 `agent_teams_status` 的
per-task map；S3 在 client 侧按【成员】渲染判据裁决（默认精简层 + 点开完整层）。

★ **三态 / 四态在形状上就不合流**，且两条反向半边已被实测挡住。

---

## ★★ 一处必须上报的契约缺口（不是实现问题，是数据流拓扑）

任务书说「`/state` 的 per-task map 在 `src/tools/status.ts:751` 拼」——这一句
在**代码位置**上是对的（实测就是那一行），但 **`agent_teams_status` 这个工具的
返回值并不流向 client**。实测链：

| 环节 | 事实 | 证据 |
|---|---|---|
| client 轮询的 URL | `/plugins/dsh-agent-teams/state` | `src/client/activity-monitor.ts:387` |
| 该 URL 的服务端处理者 | `collectTeamsActivity`（`src/snapshot.ts`） | `src/index.ts:400-416` |
| status **工具**的返回 | 走 tool 通道，**不到浏览器** | `lib/client.js` 对 `failure_kind`/`attempt_id`/`findings_open` 的引用数为 **0** |

即：**存在两个互不相连的「/state」**。工具的那一份与浏览器的那一份是不同的载荷
（工具用 snake_case：`failure_kind`；浏览器用 camelCase：`failureKind`）。

⇒ **S3 要在真实界面上显示数据，还差一跳：把 `gateEvaluation` 也加进
`src/snapshot.ts` 的任务投影。** 而 `src/snapshot.ts` **不在本任务 inScope**
（同样地 `src/state.ts`、`src/types.ts` 也不在）。

本任务因此这样处置（不编造、不越界）：

- **S2 完整实现并验证** —— 工具的读取出口真的转发了 `gate_evaluation`（现场 probes 已跑）。
- **S3 的读数层做成【纯函数】并做成 tolerant reader**：同时接受
  `gateEvaluation`（对象）与 `gate_evaluation`（字符串）两种写法。
  ⇒ 一旦 `snapshot.ts` 那一跳被补上（任一写法），界面**立刻**能显示，本文件无需再改。
- **`snapshot.ts` 那一跳留给拥有该写域的人**，本文档在末尾登记为移交项。

---

## S2 · `src/tools/status.ts`

在 per-task map（`team.tasks.map(...)`）末尾加一行转发：

```ts
...task.gateEvaluation === undefined
  ? {}
  : { gate_evaluation: JSON.stringify(task.gateEvaluation) },
```

### ★ 三态为什么在**这一行**上就不同形

| 情形 | 载荷里的样子 | 读取端能否分辨 |
|---|---|---|
| 缺字段（从没求值过） | **整个 key 不出现** | ✔ `"gate_evaluation" in row === false` |
| 空数组（求值了但全跳过） | `ran: []` + `skippedAll` 在场 | ✔ key 在、`ran.length === 0` |
| 有内容（有裁决） | `ran: [...]` | ✔ key 在、`ran.length > 0` |

★ **缺席用「key 不出现」表达，而不是 `ran: []` 或 `{ok:true}` 的空记录** ——
后者会让「没被检查」与「检查了且没事」在读取端同形（`types.ts` 该字段长注释逐字警告）。

### ★ 为什么是 `JSON.stringify`

工具的产出面要求 `Record<string, JsonValue>`，而 `GateEvaluationRecord` 是
interface（无隐式索引签名）⇒ 直接塞对象过不了类型。这里**沿用紧邻那一行**
`supplemental_evidence` 的既有做法，而不是自造一个 `as unknown as JsonValue`：
后者会引诱读者按字段访问一个其实是被序列化的文本。缺席仍然是 key 不出现。

---

## S3 · client 按【成员】渲染

用户裁定（原话）：「主屏是【成员】；点开成员才是【约束的体现】」＋
「默认精简层（当前阶段的裁决 ✓/⊘/●/✗ + 观察模式），点开看完整内部流程」。

### 读数层：`src/client/activity-model.ts`（纯函数，可独立检验）

```ts
memberGateReadouts(tasks) : Map<taskId, MemberGateReadout>
memberGateVerdict(evaluation) : MemberGateVerdict   // ok|blocked|unmeasured|observed
```

★ **`MemberGateReadout` 是一个三态 union，不是布尔**：

```
{ state: 'absent' }                       —— 没求值过 / 读不出
{ state: 'empty', registered, skippedAll }—— 求值了但一条判据都没跑
{ state: 'verdict', verdict, evaluation } —— 求值了，有裁决
```

- `absent` 的判定把 **`undefined` / 空串 / `null` / 非法 JSON / `ran` 不是数组**
  全部收进来 ⇒ ★ **任何一种「读不出」都不会被读成「通过」**（反向半边 A）。
- `empty` 与 `verdict` 分离 ⇒ ★ **「全跳过」永远拿不到 `✓`**（反向半边 B）。
- `observed`（开火但被观察模式放过）是它自己的第四个答案，`MEMBER_GATE_MARK`
  给它 `✗` + 琥珀底纹 ⇒ 既不读成「通过」也不读成「真拦下」。

### 渲染层：`src/client/MemberRow.tsx`

- **精简层**（默认可见）：成员行内 `<符号> <一句话>`，`data-member-gate-tone`
  是机械探针（取值 `absent`/`skipped`/`ok`/`blocked`/`unmeasured`/`observed`）。
- **展开层**（点开成员）：逐条约束 `<id> <符号>`，`observed` 条目带
  `data-observed="true"` 与琥珀底纹。
- 两层**同一个 `memberGateReadouts`** ⇒ 不可能出现「一句话说通过、展开写着有 blocker」的分叉。

### 为什么没有新增文案 key

`src/client/locales.ts` **不在 inScope**。四个状态全部**复用既有 key**
（`task.status.notRun` / `round.tone.unmeasured` / `round.tone.completed` /
`round.tone.failed` / `round.tone.converging`），zh/en 双字典都已有正确措辞。

### CSS：`src/client/ActivityPanel.module.css`

新增 `.memberGate*` 一组，**沿用 `memberRound*` 的同一套 `--dsw-alias-*` token**，
不另立颜色系统。`absent` 与 `skipped` 都用中性灰 ⇒ 在**视觉上**也与绿色 `✓` 不同形。

---

## 验证

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `npx tsc -p tsconfig.client.json --noEmit` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test:gates` | 失败文件集合与基线**逐条相同** |

### ★ 实测的形状 kernel（复用 stage 已跑过的积木）

```
A 无数据        -> {"state":"absent"}
B 全跳过        -> {"state":"empty","registered":3,"skippedAll":"…"}
C 全通过        -> {"state":"verdict","verdict":"ok",…}
D blocked       -> {"state":"verdict","verdict":"blocked",…}
E observed      -> {"state":"verdict","verdict":"observed",…}

A vs C 不同形 ✔   B vs C 不同形 ✔   A vs B 不同形 ✔
C vs E 不同形 ✔   D vs E 不同形 ✔
```

带决策表的 Nine cases 也全部 pairwise distinct（mark / tone / text 三层都不同）：

```
A no data     -> {"mark":"·","tone":"absent", "text":"[task.status.notRun]"}
B all skipped -> {"mark":"⊘","tone":"skipped","text":"[round.tone.unmeasured]"}
C all passed  -> {"mark":"✓","tone":"ok",     "text":"[round.tone.completed]"}
D blocked     -> {"mark":"✗","tone":"blocked","text":"[round.tone.failed]"}
E observed    -> {"mark":"✗","tone":"observed","text":"[round.tone.converging]"}
```

★ **零新依赖**：`package.json` 未改动，新增 import 全部是相对路径。

---

## 移交（不在本任务 inScope）

| 缺口 | 谁补 | 为什么本任务不补 |
|---|---|---|
| `src/snapshot.ts` 的 tasks 投影未转发 `gateEvaluation` | 拥有该文件写域者 | 不在 t77 inScope |
| `src/client/activity-monitor.ts` 的 `ActivityTask` 未声明该字段 | 同上 | 同上（本任务用 widening 读，兼容） |

★ 补上那一跳之后，本任务的 S3 **不需要再改一行** —— 读数层已是 tolerant reader。

---

## 基线数据的一点更正（不是 blockers，但应记账）

任务书写「`grep -c gateEvaluationRecordOf src/state/tasks.ts` 应为 **3**」。
实测为 **1**（该文件里只有那一个定义；其它 4 处在 `state.ts` / `update-task.ts`
的 import 与调用点，共 5 处）。HEAD 确认是 `a575fdc`，所以**树是对的**，
是那个「3」的预期值不成立。
