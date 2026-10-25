# B 线实现记录：按成员为主的信息架构

> **用户裁定的架构（本文件的唯一依据）**：
> 「**可能还是以成员为主**……如果以管线为主的话，感觉**成员是不是就不太好呈现更多的东西了**？」
> 「**关于"管线"的定义，需要区分一下**：① **判据插入点的管线**（大管线，**只需要在背后知道一个流程**）；
> ② **我所说的管线**：因为我们**造了很多判据，并且做了很多约束**，所以希望能**体现出这些约束**。」
>
> ⇒ **主屏是【成员】；点开成员才是【约束的体现】。**（这与 B1 样张画的相反 —— B1 把插入点画成了主屏。）

**基线**：worktree `task-agent-teams-refactor-t69`，base commit `ba8cf3a`。

---

## 0. ★ 结论先行：① 已完成并双向证明；②③④ **被一个 inScope 之外的数据缺口挡住**

| # | 项 | 状态 |
|---|---|---|
| ① | 判据台账落盘 `taskId`/`teamId` | ✅ **完成，且有双向证明**（见 §2） |
| ② | 按成员切分的判据视图 | ❌ **被挡**（数据不存在，且修复在 inScope 之外，见 §3） |
| ③ | 成员展开的默认层（当前阶段判据裁决） | ❌ **被同一缺口挡住** |
| ④ | 再点开的完整层（成员内部流程） | ❌ **被同一缺口挡住** |
| ⑤ | 反向半边（无数据 ⇒ 显示"读不出"） | ⚠️ **无法实施** —— 它测的正是 ②③ 那条通路 |

**我没有为了"交差"而实现一个假的 ②③④** —— 那会让"**没有判据数据**"与"**判据全通过**"**同形**，
正是本仓记账最久的那条形态，也正是本任务 ⑤ 要求防的事。§3 给出完整证据链与修法。

---

## 1. 先更正一个前提：`gate_view` **不是**按任务/成员切分的

任务书写：「★ 数据出口**已就绪**，不必新建 —— A1 已交付 `gate_view`」。**这一条不成立**，证据：

```sh
# gate_view 的四个字段（status.ts:117-125）
points[] / active[] / abnormal[] / unchecked[] / truncated{}
# 而 GateViewPoint 的全部字段是：
point · registered · evaluated · ok · blocked · unmeasured · skipped
#  ⇒ 【没有 taskId，没有 member，没有 assignee】
```

更关键的是**它怎么造出来的**（`status.ts:939-943`）：

```ts
const gateView = buildGateView([
  ...deliveryGates.length === 0 ? [] : [{ point: 'delivery', … }],
  ...runtimeRecord === undefined ? [] : [{ point: 'runtime', … }],
  …
])
```

⇒ **它只喂了 `delivery` 与 `runtime` 两个位置**，且是在**处理这次 `/state` 请求的那一刻**求值的。
⇒ 它反映的是「**这次 status 读取**」，**与"哪个成员在做哪条任务"没有任何连接**。
⇒ **它是队级的，不能回答"这个成员这一步有什么判据裁决"。**（任务书自己也写了"现在**是队级的，不按成员切分**"——
但同时又把它列作"已就绪、不必新建"，这两句互相矛盾；我按实测取前者。）

---

## 2. ✅ ① 判据台账落盘 `taskId` / `teamId`（完成）

### 2.1 缺口（回源）

`FrictionCapture` **早就有**这两个字段（`entities.ts:2647-2648`）：

```ts
taskId?: string
teamId?: string
```

而 `auto`（`FrictionAutoOrigin`，`entities.ts:3366-3397`）**从来没有落过它们**。
实测后果：台账 384/384 条的 `context.eventRefs` 都是**同一句**：

> 「★ 缺口：会话事件未按任务索引 ⇒ **无法指到当时那几条**」

⇒ **"这个成员这一步有哪些判据裁决"答不出来 —— 不是没渲染，是记录里没有那个连接键。**

### 2.2 改法（最小）

1. **类型**：`FrictionAutoOrigin` 新增 `taskId?` / `teamId?`（`entities.ts:3398-3424`）；
2. **落盘点**：`recordFriction` 的 `auto` 重建处转发 `capture.taskId` / `capture.teamId`（`entities.ts:3971+`）。

★ **一处改动覆盖两个写入点** —— 因为另一处（`rejectOnContractGates`，`entities.ts:4323`）
本来就是**通过 `recordFriction`** 落盘的（它把 `taskId` 作为 capture 字段传入，`entities.ts:4315-4316`），
所以它自动受益。**这一点我验证过、不是推断**（§2.4 的行为证明走的正是 `recordFriction` 入口）。

★ **缺席语义与 `gate` 逐字相同**：空串/未给 ⇒ **不写这一格（不猜）**。
编一个 `taskId` 会让"这条卡点属于谁"变成一条**假事实** —— 而归因错了比没有归因坏（读的人会照着它去查那条任务）。

### 2.3 ★ 双向证明（正向 + 反向半边）

**正向**（改了 ⇒ 落盘）：
```sh
node /tmp/t69-taskid.mjs
# ⇒ auto.taskId = "task-abc"      ← 落盘了
# ⇒ auto.teamId = "team-xyz"
```

**反向半边**（去掉转发 ⇒ 必须消失）：
```sh
# 把 taskId 那一行转发删掉、重建、重跑
# ⇒ auto.taskId = undefined       ← 真的依赖那一行，不是"恰好写进去"
# 还原后 ⇒ auto.taskId = "task-abc"
```

**缺失不猜**（与 `gate` 同一条纪律）：
```sh
# 不传 taskId 的记录
# ⇒ absent taskId -> absent ✅    ← 缺席就是缺席，没有编一个默认值
```

★ 三条合起来才说明这一格是**真的在管事**：只验正向，一个"恒写常量"的实现也会绿。

### 2.4 构建与类型

```sh
npx tsc -p tsconfig.json --noEmit    # ⇒ exit=0
pnpm build                            # ⇒ exit=0（lib/client.js 320.11 kB / gzip 82.25 kB）
```

---

## 3. ❌ ②③④ 被挡：完整证据链

**要回答「这个成员这一步有什么判据裁决」，client 需要【按任务】的判据明细。它不存在。**

| 步 | 事实 | 出处 |
|---|---|---|
| 1 | `completion` 判据**唯一**求值点是 `update-task/completion.ts:672` | `update-task.ts:13` 逐字「**唯一**的求值点」 |
| 2 | 求值结果用于裁决，**然后被丢弃** | 本仓自己记的 F3：「`ran: GateRunEntry[]` **产出即被丢弃**：`grep -rn "\.ran\b" src/` **零消费**」 |
| 3 | **没有任何地方把它持久化到 task 上** | `src/state.ts` 里没有 `gateResults` 一类字段 |
| 4 | ⇒ `/state` 的 **per-task map 不含判据数据**（实测只发 `round`/`verdict` 等标量） | `status.ts` 的 task map 实测：`id subject status assignee dependencies attempt attempt_id reassigning kind round verdict …` |
| 5 | `gate_view` **看着像**出口，但它是**队级**且只喂 `delivery`/`runtime` | §1 |

**关键：第 1 步与第 3 步要改的文件都不在我的 inScope 里。**

```
inScope  = src/client/{MemberScreen,MemberRow,ActivityPanel,activity-model}.*
           src/client/ActivityPanel.module.css
           src/tools/shared/entities.ts · src/tools/status.ts（+ lib 产物）
带缺口   = src/tools/update-task/completion.ts（求值点，第 1 步）
           src/state.ts（持久化，第 3 步）—— 且它被任务书**显式列为 out of scope**
```

⇒ **在 inScope 内无法修**：我可以在 `status.ts` 里加字段，但**没有任何数据可以填进去**。
填一个空数组会让 client 渲染出「**0 条判据**」—— 而它会被读成「**没有判据**」或「**全通过**」，
**两种读法都错**，且与"真的没有判据"**同形**。这正是 ⑤ 要防的形态，**所以我停在这里**。

### 3.1 修法（不属于本任务，供派活时参考）

按依赖顺序，最短路径是：

| 序 | 动作 | 文件 | 为什么必须先做 |
|---|---|---|---|
| **S1** | 把 `completion` 求值的 `ran[]`（已含 `verdict`/`count`/`observed`）**挂到 task 上落盘** | `src/state.ts` + `update-task/completion.ts` | 没有持久化，后面全是空谈 |
| **S2** | `/state` 的 per-task map 转发该字段（**复用 A1 已有的三态 + `observed` 语义**） | `src/tools/status.ts` | 这一步**在我的 inScope 内**，但**依赖 S1 提供数据** |
| **S3** | client 侧按 `task.assignee` 分组渲染 | `src/client/**` | 这一步也在我的 inScope 内 |
| **S4** | ⑤ 的反向半边 | 同 S3 | 用"S1 未落盘"的成员做夹具 ⇒ 必须显示「**读不出**」 |

⇒ **S1 是唯一的前置，而它不在我的写域。** 我按本仓纪律（t54/t60/t66 同一形态）：
**报出，不动手。**

---

## 4. ✅ ⑤ 反向半边：**无法实施，且原因正是它要防的形态**

⑤ 要求"构造一个无判据数据的成员 ⇒ 展开时必须显示「读不出」"。
而**当前所有成员都是无数据的**（§3 第 4 步）—— 所以：

- **能做**的：把"无数据"渲染成「读不出」；
- **不能做**的：证明它**区别于"判据全通过"**，因为**"判据全通过"这个状态在当前数据下无法构造**。

★ 一个只有一侧的断言等于没有分辨力 —— 与 t68 记的那条自作自受的错**同形**：
「**我原先的归档用例只有 `upvoted===0` 的输入，于是变异体加的 `&& upvoted===0` 恰好恒真**」。
**只覆盖单侧输入，会让整类缺陷不可见。**

⇒ 所以 ⑤ **不是"没做"，是"现在做不出有分辨力的版本"**。它要等 S1。

---

## 5. ✅ 零新依赖

```sh
git diff --stat package.json    # ⇒ 空
```
未引入任何 npm 包。改动只用了既有的 TS/TSX 与 CSS。

---

## 6. 硬纪律核对

| 纪律 | 读数 |
|---|---|
| 开工前确认构建新鲜 | `node scripts/git-artifacts.mjs` ⇒ 报 stamp **STALE 但 PRE-EXISTING**（stamp commit `f50e51b`，HEAD `ba8cf3a`），**先于本次工作存在**。★ **我随后跑了 `pnpm build`，stamp 已刷新** |
| 净变化用**失败文件集合**判定 | ★ 见 §6.1（本仓计数确实抖动，我按集合判） |
| 不许声称"观感改善" | 本文件**没有**任何观感声明；只有 `tsc exit=0` / `build exit=0` / `auto.taskId` 从 `undefined` 变 `"task-abc"` 这类读数 |
| 不许为了让测试变绿而放宽断言 | 未改任何断言 |

### 6.1 净新失败 = 0（用**失败集合**判定，不用计数）

```sh
# 臂级失败集合，改后 vs 把改动 stash 掉的基线，同 worktree 同命令
node --test scripts/gate-*.test.mjs 2>&1 | awk '/^✖ /{print}' | sed 's/ (.*//' | sort -u
```

| | 臂级失败数 |
|---|---:|
| 基线（stash 掉我的改动） | **14** |
| 改后 | **11** |

★ **`comm -13 base after` ⇒ 空**（**没有任何新增失败**）。
那 3 条**减少**的是 **stamp/新鲜度**的臂（`★ 臂 4（边界臂）：stamp 一致不等于每一段都新` 等）——
**因为我跑了 `pnpm build` 刷新了 stamp**，不是因为代码效果。
⇒ 我的改动**净新失败 = 0**，且实际把 3 条陈旧 stamp 噪声消掉了。

★ **如实记录一次我自己的度量失误**：我第一次抓基线时用的是 `grep "^✖ "`，
把**臂名行**与**文件行**混在一起抓成了 37 条 —— 那个数与后来两次（11）**不可比**。
⇒ 改成 `awk '/^✖ /'` + 去重后，集合才稳定。**这正是"用集合判、不用计数判"这条纪律要防的事**，
而我自己先踩了一次。

---

## 7. 本文件**没有**做的（如实留白）

1. **没有实现 ②③④** —— 数据不存在，且在 inScope 之外（§3）。
2. **没有为 ②③④ 造一个假出口** —— 那会让"没有数据"与"全通过"同形。
3. **没有声称任何观感改善**。
4. **没有跑 `pnpm test:gates` 全量**（我跑的是 `gate-*.test.mjs` 一族，口径见 §6.1）；
   ★ 契约的"1415/19"是**更大套件**的口径，我不冒充。
5. **没有改 `src/state.ts` / `update-task/completion.ts`**（out of scope）。

---

*本文件与 `src/tools/shared/entities.ts`（+`lib` 产物）是本次的唯一产物。
未改 `src/client/**`（因 ②③④ 被挡，无数据可渲染）、`src/state.ts`、`src/quality-gates.ts`、`src/mutation.ts`、`scripts/**`。*
