# 重构规格 v2：一项目一会话内的 Agent Teams UI（2026-10-16）

> **依据**：用户本轮原话（逐字见 §1）。**本文只定"体现什么",不定"怎么排版"** ——
> 排版等用户在 A/B/C 三张样张里选定后再写。

---

## 1. 用户原话（本轮）

> 「像现在这种**徽章之类的，肯定是要去除的**。」
> 「我觉得现阶段我们**肯定不是先改造成一个统一入口，那样改造可能太大了**。
>  我们现在只是把 Agent Teams 这个插件，**在一个项目、一个会话内**，把它的 UI 给改掉。」
> 「你觉得**最应该体现的都有哪些**？
>  之前我们也讨论过，目前的 UI 总体来说还行，会呈现以下信息：
>  **1. 人的职责  2. 第几轮  3. 工作的时间**
>  （不过目前也有一些小 bug，比如"**已完成**"状态会显示为**琥珀色**。）
>  但是这些信息还是**不够**的。还是我之前说的，我需要看到：
>  **1. 他在哪个阶段  2. 他在做什么测试**
>  但是这些测试信息需要是"**可插拔**"的，因为我后续可能会替换测试内容。」

### ★ 本轮裁定的三件

| # | 裁定 | 含义 |
|---|---|---|
| **甲** | ★ **去掉徽章之类** | 即计划 B3 的"成员降级为流程行，去掉徽章/头像/卡片" |
| **乙** | ★ **改造范围 = 一项目一会话内** | **不做统一入口**（那是阶段二，用户自己说"太大了"）|
| **丙** | ★ **测试信息必须可插拔** | 因为用户**后续会替换测试内容** |

---

## 2. ★★★ 好消息：你要的两件事，**数据已经在项目里了**

### ① "他在哪个阶段" ⇒ 六个插入点

```ts
// src/gates/registry.ts:288
export const INSERTION_POINTS = Object.freeze([
  'contract', 'dispatch', 'completion', 'delivery', 'admission', 'runtime',
])
```
★ 而 **S1 落盘的 `gateEvaluation.ran[]` 带判据 id**（形如 `completion.mutation`）
⇒ **id 的前缀就是阶段**、后缀就是测试名。

### ② "他在做什么测试" ⇒ 17 条判据的 id 本身

```
contract.build-artifact-scope    contract.task-atomicity    contract.verify-command
dispatch.changed-paths           dispatch.plan-reviewed     dispatch.worktree
completion.backtest              completion.mutation        completion.r5
completion.verify-rerun          delivery.convergence       delivery.coverage
admission.absorb                 admission.checkpoint       admission.convene
runtime.liveness                 runtime.stall
```

★★ **`completion.mutation` 就是你说的"变异测试"** —— **它已经在数据里了。**

⇒ ★ **所以"测试信息"不需要新数据出口,只需要【把它显示出来】。**

---

## 3. ★★★ 而"可插拔"这件事，**机制已经成立**

`src/gates/index.ts:26-30` **逐字**：
> 「`register()` 校验 **id / point / description / gate**，缺一不可；
>  而 **`point` 写错会撞上 `unknown insertion point`**。
>  ★ **两者都是启动即炸,不会静默地少一条判据。**」
> 「**id 与 point 也先定死**，因为注册表对**重复 id 是【抛错】而不是覆盖**」

⇒ ★★ **换掉一个测试 = 改一个注册文件的一行；而写错会【启动即炸】,不会静默失效。**

★★ **这正是本仓唯一一处"可插拔且有机械保证"的地方** —— 而它**恰好就是你要的东西。**

### ★ 而 UI 要做的是【不认识具体测试】

★ 用户原话（上一轮）：「**前端不需要认识具体模块,只做投影**」

⇒ UI 的规则:
```
★ 不许硬编码 'mutation' / 'backtest' 这类字面量
★ 只渲染「阶段 + 测试 id + 裁决」的【通用形状】
★ 加入/替换一条判据 ⇒ UI 不用改
```

---

## 4. ★ 你报的两个 bug —— 我查了，一个是真 bug，另一个是**设计如此但不能那样并排**

### bug ①「已完成显示为琥珀色」

★ **我查了映射，它是对的**（`src/client/MemberRow.tsx:143-148`）：
```ts
ok:         'round.tone.completed'    // 绿
blocked:    'round.tone.failed'       // 红
unmeasured: 'round.tone.unmeasured'   // 中性
observed:   'round.tone.converging'   // ★ 琥珀
```
而 CSS 注释（`ActivityPanel.module.css:2162`）逐字：
> 「**converging(琥珀)** / failed(红) / unmeasured(中性) / running(蓝) / **completed(绿)**」

⇒ ★ **所以琥珀色来自 `converging`，不是来自"已完成"。**

### ★★ 但我在你的截图里发现了**一个真的状态冲突**

```
ui-dissect 那行:
  主行 : 「t69 失败 · 待重派」      ← 说【失败】
  小字 : 「第 5 轮 本轮已完成」      ← 说【已完成】
```

⇒ ★★ **两句紧挨着,说的是相反的事。**

**根因**：它们是**两个独立算的 tone**：
- 主行 = `memberDoingText`（看**最新终结任务**的 status）
- 小字 = `memberRound`（看**最后一轮**的 `roundTone`，其优先级是
  `failed > converging > unmeasured > running > completed`）

★ 而 `memberRound` **取的是最后一轮**,`memberDoingText` **取的是最新任务** ——
**两个"最新"不是同一个时间口径** ⇒ **它们可以互相矛盾。**

★★ 而**这正是本仓记账最久的形态的又一实例**:两个口径,一个界面,读起来像矛盾。

⇒ **处置（属于本次重构）**：主行与小字必须**同口径**,或**明确标出各是什么口径**。

---

## 5. ★ 我建议"最应该体现"的（按你的三条现有信息 + 你要的两条）

| # | 体现什么 | 数据来源 | 现状 |
|---|---|---|---|
| **1** | ★ **阶段**（contract/dispatch/completion/…）| `INSERTION_POINTS` + 判据 id 前缀 | ⚠️ 有数据,没显示 |
| **2** | ★ **在做什么测试**（id 后缀:mutation/backtest/…）| `ran[].id` | ⚠️ 有数据,没显示 |
| **3** | **每条测试的裁决**（✓/⊘/●/✗ + 观察）| `ran[].verdict` + `observed` | ✅ t77 已渲染 |
| **4** | ★ **未检查**（skippedAll 在场）| `skippedAll` | ✅ t77 已渲染 + 我修过 |
| **5** | **人的职责** | `member.role` | ✅ 已有 |
| **6** | **第几轮** | `task.round` | ✅ 已有（★ 但与主行口径不一致）|
| **7** | **工作了多久** | `memberClock` | ✅ 已有 |
| **8** | ★ **成员是流程行,不是主角** | —— | ❌ **待改**（去徽章/头像/卡片）|

---

## 6. ★★ 而有一条**我要提醒你**：你要的两条与"去掉徽章"是**同一次改动**

```
你要"看到他在哪个阶段 + 做什么测试"  ⇒ 需要【按阶段分组的测试列表】
你要"去掉徽章之类"                  ⇒ 需要【成员降级为流程行】

★ 而计划 B2+B3 说的正是这两件的组合：
    B2 判据管线图实现      ← 阶段 × 测试
    B3 成员降级为流程行    ← 去徽章
```

⇒ ★★ **所以你说的与计划里的 B2+B3 是同一件事** ——
**而我上一轮把它们误读成了"取消管线图"。**

---

## 7. 待用户拍板的（只有一条）

**排版形态:样张 A（切换,侧边栏纵向）/ B（主区横向）/ C（按容器重排）?**

★ 而**内容规格已经定了**（§5）—— **不论哪种排版,那 8 条都该体现。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
