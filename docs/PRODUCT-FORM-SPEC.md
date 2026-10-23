# 产品形态规格：Keeper（暂名）

> **状态**：⬜ 提案，未裁定。本文描述"吸收完 Harness² / OCR / ACP 之后，产品应该长成什么样"。
> **不是**对现状的描述 —— 现状见 `docs/TEAM-CONTROL-PLANE-SPEC.md` §19 / §22。
>
> 一句话：**一个交付门禁台。你用一句话派活给队长，队长带团队干完，回来时把「要你决定的事 + 每件事的证据」推到你面前。**

---

## 0. 五条不变量（违反任一条，产品就退回成"又一个 agent 平台"）

| # | 不变量 | 为什么 |
|---|---|---|
| **I1** | **真相只有一份，在控制面** | harness 持有会话，控制面持有任务。否则 N 个后端 = N 份真相 |
| **I2** | **后端只报告，不裁决** | 后端说"我改了 3 个文件、exit 0"；是否通过由判据算 |
| **I3** | **每条判断都有第三态 `unmeasured`** | 与 `ok` 必须不同形，否则"没测"会被读成"通过" |
| **I4** | **软硬必须成对** | 只有软 = 建议；只有硬 = 误伤 |
| **I5** | **证据可寻址** | 一条结论能点开、能分享、能回放；靠"同一屏对齐"不算 |

---

## 1. 前端：四个界面

### 1.1 收件箱（首页，默认打开）

**这是产品的全部价值所在** —— 一切正常时，它应该是空的。

```
┌─────────────────────────────────────────────────────────────┐
│  待你决策 3                          [收件箱] [运行态] [流程] │
├─────────────────────────────────────────────────────────────┤
│  ● 等你批准：审查关卡新增「独立审查者」检查项                 │
│    等了 3 分钟 · human-rev 在等 · 证据 g-3f2a      [批准][驳回]│
├─────────────────────────────────────────────────────────────┤
│  ● 等你裁断：verify 未重跑，是否豁免                          │
│    等了 17 分钟 · 队长已尝试 2 次 · 证据 g-8b71   [看证据][驳回]│
├─────────────────────────────────────────────────────────────┤
│  ○ 提示：提案 g-1c04 已 12 小时无人处理                       │
│    来源：dispatch.unwired 桶连续 3 天上升            [看证据]  │
└─────────────────────────────────────────────────────────────┘
```

**一条决策的字段**（这是后端契约）：

```ts
interface Decision {
  decisionId: string            // 决策自己的 id —— 不能只借 evidenceId
  kind: 'approve' | 'adjudicate' | 'notice'
  oneLine: string               // ≤ 30 字，说清"要你做什么"
  waitingSince: number          // epoch ms
  waitingOn: 'human'            // 等待方永远是人
  blockedBy?: {
    agent: string               // 谁被卡住
    attempts: number            // 它自己试过几次（≥1 才允许上报）
    missingDimension?: string   // ★ 缺哪一维判断（见 §4.2）
  }
  evidenceRef: string           // 可寻址：gate.evaluated#g-3f2a
  actions: Array<'approve' | 'reject' | 'exempt' | 'open-evidence'>
}
```

**空态**：一句「今天没有需要你决定的事。团队在跑 2 个任务，预计 40 分钟后完成。」
**★ 空态必须给"在跑什么 + 大概多久"，否则人会怀疑它是不是坏了。**

### 1.2 任务详情（点进某条之后）

三栏，比例 `260px / 1fr / 380px`。

| 栏 | 内容 | 抄自 |
|---|---|---|
| **左：关卡** | 5 道关卡竖排（立项/计划/实现/审查/交付），每道带状态点 + **一句话结论**（≤10 字）+ 检查项列表（带 `硬`/`软` 徽标） | Linear 的密度 + n8n 的声明式 |
| **中：运行态 + 事件** | 上半：成员列表（谁在跑什么、耗时、状态）；下半：事件流（时间/类型/状态/ID），**每条可展开原始 payload** | Temporal 的事件历史 |
| **右：产物审查** | 验收项勾选（✓/✗/○）+ 文件树 + diff 行内评论 | Vibe Kanban |

**跨栏追溯（I5 的落点）**：

```
点左栏红检查项  → 中栏对应事件高亮 + 展开 + 滚到视口
点中栏事件      → 左栏检查项高亮（双向，不是单向跳转）
点右栏验收项    → 左栏 + 中栏同时高亮
```

三栏共用同一个 `evidenceId` 空间；**选中态统一用琥珀色左边条**。

### 1.3 流程配置（关卡与检查项）

```
关卡： 立项 · 计划 · 实现 · 审查 · 交付        ← 位置固定，不可增删
       每道关卡下可挂检查项：                   ← 可增删换

检查项卡片（一张卡 = 一条检查项）：
┌──────────────────────────────────────────────┐
│  independent-review            [硬][软]  ✓   │
│  ─────────────────────────────────────────    │
│  软：在实现完成后，由另一个成员独立审查 diff   │
│  硬：review.by ≠ implement.by                 │
│      且 review.changedPaths ⊇ impl.changedPaths│
│  ─────────────────────────────────────────    │
│  来源：OCR 的二次确认范式        [编辑][停用]  │
└──────────────────────────────────────────────┘
```

**三层覆盖**（抄 OCR）：

```
仓库级 .keeper/flow.yml  >  用户级 ~/.keeper/flow.yml  >  系统默认
```

**加一条检查项 = 加一段 YAML，不改代码。**
**软硬不成对的检查项，卡片上必须显示 `⚠ 未成对，不计入固化`**（见 I4）。

### 1.4 模板库与效果

```
模板列表                          效果面板
├ 默认·单人开发   v3  ● 生效中    ├ 近 30 天：12 个任务
├ 默认·严谨交付   v1              ├ 交付后回滚：1 次（8.3%）
└ 我的·前端专项   v2  ⚠ 未发布    ├ 最常拦下的检查项：changed-paths(7)
                                   └ 判不了的检查项：3 条（附原因）
```

**「判不了的检查项」必须在这一屏显式列出** —— 它是 `unmeasured` 的聚合，也是自改进的输入。

---

## 2. 后端：五个服务 + 三类存储

### 2.1 控制面（Control Plane）

**职责**：任务 DAG、状态机、派发、真相归属。

```ts
// 任务状态机（唯一真相）
type TaskStatus =
  | 'draft'        // 计划中，未批准
  | 'approved'     // 人已批准，未派发
  | 'dispatched'   // 已派给成员
  | 'implementing'
  | 'reviewing'
  | 'delivered'    // 已验收
  | 'blocked'      // 被某条判据拦下
  | 'abandoned'
```

**硬规则**：状态只能由控制面的 `transition()` 改，**后端不能改状态**（I2）。

### 2.2 执行面（Backends）

```ts
interface Backend {
  readonly id: string
  readonly capability: {
    reportsChangedPaths: boolean
    canExec: boolean
    exposesToolCalls: boolean
    resumable: boolean
    isolatesFs: boolean
  }
  spawn(task, cwd): Promise<WorkerId>
  send(id, msg): Promise<void>
  read(id): AsyncIterable<Event>
  kill(id): Promise<void>
}
```

**三个规则**：

- 能力位不足的判据 → 直接 `unmeasured`（附"缺哪个能力位"）
- **每个后端必须过 conformance**：一组一红一绿的 fixture，两端必须同裁决。不过 = "能启动"，不是"支持"
- 首选 **ACP**（接一个协议 = 接一批 harness）

### 2.3 判据层（Gate Registry）

```
7 个插入点：admission · contract · dispatch · completion · delivery · runtime · collection
每条判据声明：id / point / appliesTo / requires / gate
```

**四态裁决**（不是三态）：

```ts
type Verdict =
  | { ok: true }
  | { ok: false, blockers: string[] }
  | { ok: false, unmeasured: string }   // 判不了
  | { skipped: 'not-applicable' }        // 本轮不适用
```

**软硬配对校验**（I4）：

```
每条检查项必须有 { soft: string, hard: GateId }
  paired       → 可挂载、计入固化
  soft-only    → 不生效（只是建议）
  hard-only    → 允许挂载，但必须补 why（否则误伤）
```

### 2.4 证据层（Evidence）

**四条反向引用**（这是追溯链能成立的全部原因）：

```ts
interface GateEvaluationEvent {
  evidenceId: string            // gate.evaluated#g-3f2a
  at: number
  point: string
  gateId: string
  verdict: Verdict
  producedCheckIds: string[]    // ★ 这一次求值影响了哪些检查项
  taskId: string
  attemptId?: string
}

interface CheckResult {
  checkId: string
  evidenceRef: string           // ★ 这条结论来自哪次求值
  verdict: Verdict
}
```

**为什么是两条而不是一个 id**：一次求值跑 17 条判据，一条判据可能被多次求值佐证 ⇒ **多对多**，一个标识符表达不了。

### 2.5 经验层（Library）

抄 `harness2/core/library.py` 的目录结构：

```
~/.keeper/library/<domain>/<template>/INDEX.md
                                      /flow.yml          ← 可执行模板
                                      /EXPERIENCE.md     ← 为什么这么改 + 证据
```

三条设计：
- **目录即检索**（按 domain 分区，不靠向量）
- **整树不摘要**（模板完整带走）
- **按 run 隔离**（可复现）

### 2.6 三类存储

| 存储 | 形态 | 为什么不放 DB |
|---|---|---|
| 任务台账 | `tasks/<id>.json` | 人可读、可 git diff、可手工修 |
| 事件流 | `events.jsonl`（追加） | O_APPEND 原子，无需锁 |
| 模板 | `flow.yml` | 可版本化、可分享 |

---

## 3. 一次任务怎么跑（完整时序）

### 3.1 起点：你说一句话

```
你：把这个仓库的 worktree 回收逻辑改成按空闲时间回收
```

### 3.2 队长接单，先过「入口闸」（不写代码）

```
① 澄清（≤5 问，一次问完）
   目标 / 非目标 / 验收条件 / 优先级
② 计划自检（三问，可机械判）
   Q1 哪些地方"做错了只有人能判断"？  → 每个必须配验收条件
   Q2 每条验收条件能否被机械判真假？    → 不能则退回重写
   Q3 还有没有"到时候再看"的地方？      → 有则不许开工
③ 产出 plan.yml：objective / acceptance / inScope / outOfScope / verify / tasks[]
```

**这一步的判据**：`contract` 位置（计划本身的合法性）+ `dispatch.plan-reviewed`（五问全过）。

**★ 入口闸的产出不是"计划"，是"一份能被机械验收的契约"。**

### 3.3 你批准（这是第一次、也可能是唯一一次打扰）

收件箱出现一条：`等你批准：worktree 回收改为按空闲时间`（带计划全文 + 预计影响 3 个文件）。

你点「批准」→ `draft → approved`。

### 3.4 派发（控制面切 worktree）

```
for each task in plan.tasks:
    worktree = create_detached(plan.baseCommit, name=task.id)
    worker   = backend.spawn(task, cwd=worktree)
    state    = dispatched
```

**并发上限三条**（实测依据）：

```
N_agent = 6     思考（网络 I/O，几乎不占 CPU）
N_dep   = 1     依赖只装一份（测试专用树）
N_build = 1-2   同时只允许 1-2 个跑构建/测试
```

### 3.5 成员干活，判据在四个时刻插进来

| 时刻 | 判据在问什么 | 失败后果 |
|---|---|---|
| **派发前**（dispatch） | 上游产物进主干了吗？已有计划被批过吗？ | 拒绝派发 |
| **完成时**（completion） | verify 真的重跑了吗？改的路径在 inScope 内吗？ | 任务 `blocked` |
| **交付时**（delivery） | 验收项逐条有证据吗？覆盖率够吗？ | 拒绝交付 |
| **全程**（runtime） | 有成员卡住吗？预算超了吗？ | 告警，不阻断 |

每条判据的输出都写进 `events.jsonl`，带 `evidenceId`。

### 3.6 测试在专用树里跑（不污染开发树）

```
test-tree/  常驻，只装一次依赖（2.4GB，全仓唯一一份）
每次测试：
    git checkout --detach <开发 commit>
    git apply <开发树的 diff>          ← 或整树快照
    断言 git status --porcelain 为空
    跑 verify
    git reset --hard && git clean -fd
```

⇒ 开发树永远干净（可回退），依赖只有一份。

### 3.7 交付：给你一条摘要，而不是一个 diff

```
交付：worktree 回收改为按空闲时间
  改了 3 个文件（均在 inScope 内）
  验收 4/4 通过 · verify 重跑 exit 0
  ★ 2 条判据 unmeasured：cooldown（缺 source）、immunity（无历史）
  耗时 38 分钟 · 用了 2 个成员
```

**`unmeasured` 必须出现在摘要里。** 这是这套产品区别于所有"agent 干完了"的地方。

### 3.8 失败怎么走

```
判据 blocked
  → 记 evidence（带 blocker 原文）
  → 回给队长，附「哪条判据、缺什么、上一轮试过什么」
  → 队长自行重试（最多 2 轮）
  → 仍不过 ⇒ 生成一条 Decision（进收件箱）
       ★ 必须带 missingDimension（见 §4.2）
```

---

## 4. 自改进：两条闸 + 三条回流

### 4.1 入口闸：把决策提前到计划阶段

**目的**：让"需要你决定"尽量发生在开工前，而不是执行中。

三问见 §3.2。**其中 Q3（"到时候再看"）是最关键的一条** —— 它是所有中途打扰的源头。

### 4.2 出口闸：上报必须带「缺哪一维」

```ts
interface Escalation {
  missingDimension: string      // ★ 必填，例：'worktree 空闲判定用 mtime 还是 git 状态'
  attempted: Attempt[]          // 至少 1 次
  whyNotResolvable: string
}
```

**禁止写**：「这个问题难」/「需要人决定」/「我拿不准」。

**没有 `missingDimension` 的上报 = 不合格上报，打回重写。**

⇒ 这把「求助」变成了「报缺」，而报缺是可累积的规格。

### 4.3 三条回流

```
① 人补维度  → 判据层
     一次裁断 → 补成一条判据 → 同类问题永不重报
     度量：同一 dimension 上报 ≥3 次 ⇒ 该维度必须补，否则报警

② 效果读数  → 经验层
     改动前后对比 → improved / unchanged / unmeasured
     规则：before.count === 0 ⇒ unmeasured（无基线，不猜）
           after < before     ⇒ improved（★ 无阈值：降了就是降了）

③ 模板更新  → 流程层
     经验写回 flow.yml / EXPERIENCE.md
```

### 4.4 自改进与 Harness² 的差别（重要）

| | Harness² | 本产品 |
|---|---|---|
| 改进信号 | 行为对比（猜哪个差异是因果） | **判据裁决 + 效果读数** |
| 谁判断 | selector agent | 人（一次）+ 判据（永久） |
| 成本 | k=1 需 4 次执行 | **复用真实交付，零额外执行** |
| 失败模式 | 对比真实但无关 | 误伤（已用"先软后硬"缓解） |

**⇒ 它是"没有标准答案时怎么自迭代"；我们有标准答案，所以更省、更可信。**

### 4.5 预算账本

```
每次自迭代记：执行次数 / 改了几个组件 / 采纳率
参考 Harness²：R = 4k, P = 3k
```

**为什么必须记**：不记的话，"自迭代"会变成一个永远在花钱、说不清收益的黑洞。

---

## 5. 检查点清单（7 个插入点）

| 插入点 | 时机 | 典型判据 | 拦得住什么 |
|---|---|---|---|
| **admission** | 建团之前 | 够不够格进场（任务规模 vs 团队配置） | 小题大做 / 大题小做 |
| **contract** | 建任务 / 改契约 | inScope 与 outOfScope 不重叠；写 `src/` 必配 `lib/` | 契约自相矛盾 |
| **dispatch** | 派发前 | 上游进主干了吗；计划过五问了吗 | 基于陈旧产物开工 |
| **completion** | 成员报完成 | verify 重跑了吗；改动越界了吗；变异测试还原了吗 | 假完成 |
| **delivery** | 团队宣布交付 | 验收项逐条有证据吗；覆盖率够吗 | 没验收就交付 |
| **runtime** | 全程 | 成员卡住；预算超支；lint 计数上升 | 静默停摆 |
| **collection** | 拒绝时 | 去重 / 冷却 / 归因 / 免疫 | 同一问题刷屏 |

**★ 每个点都必须能回答三件事**：这一轮跑了几条判据、几条跳过、几条判不了。
**「全跳过」必须与「全通过」不同形** —— 否则没检查会被读成检查过。

---

## 6. 资源与并发（实测）

| 项 | 实测值 |
|---|---|
| `node_modules` | **2.4 GB** |
| `.pnpm-store` | 1.7 GB |
| `tsc --noEmit` 峰值 | **328 MB** |
| `tsc --noEmit` 耗时 | **68.7 秒** |

**结论**：内存不是瓶颈（6 个并发 ≈ 2GB）；**CPU 时间与磁盘是**。

⇒ 并发上限按"重资源命令"算，不按 agent 数算。

---

## 7. 不做什么

- ❌ agent runner（60 个项目的红海）
- ❌ 关卡画布（流程还没定型就画，会被 UI 绑架）
- ❌ IDE、模型路由、规格生成
- ❌ 多租户协作治理（v1 只做个人流程 + 导出导入）
- ❌ 自己造版本控制（Anthropic 的 Scion 是规模信号，不是模板）

---

## 8. 怎么算成了（四条可测判据）

| # | 判据 | 说明 |
|---|---|---|
| 1 | 一周内**每天打开 < 3 次** | 只在需要决策时打扰你 |
| 2 | 每条 `blocked` 都能点开看到证据 | 不可追溯的拦截等于没有拦截 |
| 3 | 换一个 harness，**判据一行不改** | 真的独立于 runtime |
| 4 | 加一条检查项**不改代码** | 真的"让每个人配自己的流程" |

---

## 9. 与现状的距离

| 支柱 | 现状 | 到本文形态还差 |
|---|---|---|
| 控制面 | 在 DSH 插件里 | 切边界（2–3 周） |
| 判据层 | 22 条、7 插入点 | 2 个插入点半活；无配置面 |
| 证据层 | 有 `at/point/gate/verdict` | 缺 `evidenceId` / `producedCheckIds` |
| 执行面 | 单后端（DSH） | 能力位 + conformance + 第二个后端 |
| 经验层 | 无 | 模板库 + 效果读数 |
| 前端 | 静态原型 | 接真数据（1–2 周） |

---

*本文只写 `docs/PRODUCT-FORM-SPEC.md`。未改动 `src/`、`scripts/`、`lib/`。*
