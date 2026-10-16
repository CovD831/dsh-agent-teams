# 乙方案：让五个段都落盘（2026-10-16，队长勘查后定稿）

> **用户裁定**：做乙 ——「把其余四段也落盘」。
> **目的**：让展开态不再呈现"15 个 ○ 淹没 4 条裁决"。

---

## 1. ★★★ 勘查结论：**只有两段能落盘到 task，另两段不能**

| 段 | 求值点 | 层级 | 能落盘到 `TeamTask` 吗 |
|---|---|---|---|
| **contract** | `rejectOnContractGates`（`create_task` / `amend_task` 调）| ★ **任务级** | ✅ **能** |
| **dispatch** | `wireDispatch`（`src/tools/update-task/dispatch.ts:117`）| ★ **任务级** | ✅ **能** |
| **completion** | `src/tools/update-task/completion.ts:672` | ★ **任务级** | ✅ **已有（S1）** |
| **delivery** | `src/tools/delivery.ts:84`（**团队交付**）| ⚠️ **团队级** | ❌ **不是单任务的事实** |
| **runtime** | `evaluateRuntimeGates`（`entities.ts:4088`，**事件级**）| ⚠️ **事件级** | ❌ **不是单任务的事实** |

⇒ ★★ **所以乙的**准确形式**是：**
```
contract + dispatch + completion  ⇒ 落盘到 task（三段）
delivery + runtime                ⇒ ★ 永不落盘到 task —— 它们是团队级/事件级
```
★ **不许为了"凑齐五段"而把团队级事实塞进任务** —— 那会造出一个**错误的事实**。

### ★ 而 `admission` 是**空段**（不是缺数据）

```
src/gates/admission/{absorb,checkpoint,convene}.ts  ⇒ ★ 三个文件都在
而 src/gates/index.ts 里【没有注册它们】
```
★ `src/gates/index.ts:74` 注释自己承认：
> 「任何夹具都不许把"admission 现在没有判据"写成断言」
> 「这与 `admission` 那三条是**同一个病**：**「写了但没接线」**」

⇒ ★★ **所以 `admission` 段：`0 条`是【真的 0 条】,不是"没数据"。**
**UI 必须把这两种 0 分开。**

---

## 2. 要做的（三段落盘）

### ① `contract` 段落盘

**求值点**：`rejectOnContractGates`（`entities.ts:4264`）—— 它在 **`create_task`**（`:753`）
与 **`amend_task`**（`:84`）被调用。

★ **但要小心**：那是**拒绝路径**函数。让me确认它**通过时**的返回值形状 ——
⚠️ **若它只在拒绝时返回,则"通过"没有可落盘的结果** ⇒ 需要看实现。

### ② `dispatch` 段落盘

**求值点**：`wireDispatch`（`update-task/dispatch.ts:117`）—— ★ **任务级,有 task。**

### ③ 三个 shape 落到哪

★ **S1 已建立先例**：`TeamTask.gateEvaluation`（`types.ts:566`）+ `gateEvaluationRecordOf`（`state/tasks.ts`）。

**选项：**
- **(i)** 复用同一个字段 `gateEvaluation`,但它是**单段**的（completion）⇒ ★ 会互相覆盖
- **(ii)** ★ **新增 `gateEvaluations?: Record<InsertionPoint, GateEvaluationRecord>`** —— 按段存

⇒ ★★ **必须 (ii)** —— 否则 dispatch 落盘会**覆盖** completion（同一个字段）。

⚠️ **而这与 S1 的注释冲突？** 让me确认 `gateEvaluation` 的注释是否声明"只存 completion"。

---

## 3. ★★ 反向半边（缺一不可）

**A**：一个**只跑到 dispatch 段**的任务 ⇒
  - `contract` 与 `dispatch` **有**裁决
  - `completion` **没有** ⇒ ★ **不许显示 ✓,也不许显示"没跑"**
  - ★ 且**不许**把"completion 还没到"说成"completion 没读数"

**B**：`skippedAll` 在场 ⇒ **⊘**,且与 **○ 不同色**（`c4cbeaf` 的形态）

**C**（★ 新增,针对乙）：`delivery` / `runtime` **永远没有 per-task 裁决** ⇒
  ★ **不许**因为"别的段都有了"就给它俩编一个 ⇒ **必须仍显示"团队级,不在任务上"**

---

## 4. ★★★ §4 的四项已查清（队长实测，2026-10-16）

### ① `rejectOnContractGates` 通过时返回什么？⇒ ★ **返回 `{ gates }`**

```ts
// entities.ts，通过路径的最后一行
return gates.length === 0 ? {} : { gates }
```
★ 而调用方**真的接住了**（`create-task.ts:753` 的 `contractGateSurface`），
并在 **`:979` 随工具返回值交出去**（`...contractGateSurface === undefined ? {} : contractGateSurface`）。

⇒ ★★ **所以 contract 的求值结果【已经在手上】，只是没写进 `task`** ⇒ **乙可行。**

### ② `TeamTask.gateEvaluation` 的注释是否声明"只存 completion"？⇒ ★ **没有**

`src/types.ts:550-566` 逐字：
> 「**落盘只在真的求值过时发生**……
>  且**原样**抄写 `GateEvaluation`（`ran[]` 原样进来,`skipped` 条目原样保留为
>  `verdict: 'skipped'`）—— **本字段是记录,不是结论的改写**。」

⇒ ★★ **它是【通用规则】,不是"只准 completion"** ⇒ **乙与它不冲突。**

### ③ `wireDispatch` 的返回值去向 ⇒ **任务级,有 task 在手**

`src/tools/update-task/dispatch.ts:117`：`const dispatchGates = input.registry.evaluate('dispatch', …)`
★ 而 `create-task.ts:983` 附近有 `dispatch` 那一格的注释：
> 「`dispatch` 那一格的求值结论 —— 在**锁内**求值,**随返回值交出去**」

### ④ 落盘与 retry 清读数的取舍 ⇒ ★ **会冲突,必须处置**

`src/tools/update-task.ts:1838` 逐字：
> 「★ 代价如实记下：**retry 会清掉上一代的读数**（`clearAttemptResult`），
>  而"上一代判据说了什么"只在**当场日志**里 —— 那是**刻意的取舍**
>  （与 `output` / `verdict` 同一代际策略）。」

⇒ ★★ **所以乙的落盘必须遵守同一条代际纪律**：
**retry 时,上一代的所有段读数一起清** —— 不许只留某一段。

---

## 5. ★★ 字段设计（查清后的结论）

**不能用单段字段** —— `task.gateEvaluation` 是**单段**的,
若 dispatch 也写它,**会覆盖 completion**（`update-task.ts:1842` 那一行）。

### ★ 两种做法

| | 做法 | 评价 |
|---|---|---|
| **(i)** | 新增 `gateEvaluations?: Partial<Record<InsertionPoint, GateEvaluationRecord>>` | ★ **按段存,不互相覆盖** |
| **(ii)** | 复用 `gateEvaluation` 但改成按段 | ⚠️ **会破坏 S1 的既有读者**（`snapshot.ts:492`、`status.ts:846`）|

⇒ ★★ **必须 (i)** —— **新增按段字段,保留 `gateEvaluation` 原样**（S1 的读者不受影响）。

★ 而 UI 侧:优先读新字段,旧字段作为 **completion 段的兼容来源**。

---

## 6. ★★ 三条反向半边（缺一不可）

**A**：一个**只跑到 dispatch 段**的任务 ⇒
  - `contract` 与 `dispatch` **有**裁决
  - `completion` **没有** ⇒ ★ **不许显示 ✓,也不许把"还没到"说成"没读数"**

**B**：`skippedAll` 在场 ⇒ **⊘**,且与 **○ 不同色**（`c4cbeaf` 的形态）

**C**（★ 针对乙）：`delivery` / `runtime` **永远没有 per-task 裁决** ⇒
  ★ **不许**因为"别的段都有了"就给它们编一个 ⇒
  **必须仍显示"团队级 / 事件级,不在任务上"**

---

## 7. ★★★ 一条必须写进 UI 的区分

```
admission     ⇒ ★ 真的 0 条（三条判据【没注册】,见 §1）
delivery/runtime ⇒ ★ 有判据,但它们是团队级/事件级 —— 不在任务上
其余三段没读数  ⇒ ★ 这个任务还没走到那一步
```

⇒ ★★★ **四种"没有裁决"的成因不同,UI 必须能分开:**
| 显示 | 什么情况 |
|---|---|
| `0 条` | 该段**真的没判据**（admission）|
| `团队级` | 该段**不是任务级事实**（delivery / runtime）|
| `未开始` | 任务**还没走到**那一段 |
| `未落盘` | 走了,但**这一代没记**（retry 清过）|

★ **四者混成一个 ○ 就是本仓记账最久的形态。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*

---

## 8. ★★ 三条由实施方报出、队长记账的形状（2026-10-16）

### ① ★★★ 「给一个被 spread 的返回值加字段」是**隐性越界**

**实施方原话逐字:**
> 「我加 `gates` 到 `rejectOnContractGates` 的返回值时,**漏想了"那个返回值会被两处调用方
>  spread 进工具的 output schema"** ⇒ `gates` 漏进**对外契约** ⇒
>  被 `gate-task-model-binding.test.mjs` 臂 8 当场打红
>  （`'"value.gates" is not a declared property'`）。
>  ★ **是夹具替我发现,不是我自检发现的。**」

★★ **它给这个形状的命名值得留:**
> 「**改动的影响面不在你改的那一行上。**」

★ 与 **t74 的"声明有两份"** 同族 —— 那次也是"改一处、影响另一处"。

### ② ★★ 队长自己的错：加 inScope 时**没摘 outOfScope 的旧条目**

```
inScope     : ✅ src/client/activity-model.ts   ← 裁定 ③ 后加的
outOfScope  : ❌ src/client/activity-model.ts   ← ★ 陈旧条目没摘
⇒ 校验器先看 outOfScope ⇒ 判「越界」
```

★★ **而实施方没有绕过它** —— 没把文件从 `changedPaths` 偷偷拿掉、没改清单,
而是**按队规报上来**。⇒ 队长用 `amend_task` 修正（**留下 revisions 台账**）。

★ **教训**:**"加一个路径进 inScope"与"从 outOfScope 摘掉它"是【两件事】,而漏掉第二件会
让一个合法的改动看起来像越界** —— 而**"看起来越界"与"真的越界"在报告里同形**。

### ③ ★★★ 实施方三次先核写域、三次都对

| 次序 | 报出的缺口 | 队长裁定 |
|---|---|---|
| **1** | `InsertionPoint` 在 `gates/registry.ts`,而 `types.ts` 是零 import 叶子（**两条臂逐字钉住**）| 走 (a) 先例,**护栏臂由队长补** |
| **2** | ★ **规格 §4① 实测不成立** —— `rejectOnContractGates` 的 `gates` **从不离开函数**（那两处 `return gates.length===0?{}:{gates}` 是**卡点台账**的 `auto.gates`）| ★ **承认规格错**,并按它的实测区分 contract/dispatch 的不同代价 |
| **3** | ★ **UI 四态逻辑整体在 `activity-model.ts`**（:1214/:1230/:1500）,而它在 outOfScope | ★ **加进 inScope**（那是队长落点判断错,不是放宽）|

★ **而第 2 条与第 3 条都是【队长的规格错】,由实施方查出。**
⇒ **这正是"契约可被实测推翻"该有的样子** —— 而它**每次都先报、不动手**。

### ④ ★ 护栏臂的归属：队长补，因为 `scripts/` 不在实施方写域

`scripts/gate-insertion-point-parity.test.mjs`（提交 `19028ed`）:
- 逐字 + **逐序**比对 `types.ts` 的 `GATE_INSERTION_POINTS` 与 `gates/registry.ts` 的 `INSERTION_POINTS`
- ★ 被 `gate-*.test.mjs` 的 glob **自动包含**（不用改 `package.json`）
- ★ 它**故意先红**:`lib/types.js` 当时还没有那个导出 ⇒ **"依赖臂"该有的行为**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
