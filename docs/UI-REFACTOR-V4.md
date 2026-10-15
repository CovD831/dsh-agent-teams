# UI 重构实现规格 v4（2026-10-16，队长定稿）

> **用户裁定**：甲（只做 completion 段,接受其余段只显示"已通过/未开始"）；
> **排版由队长定**；**风格**：简约、简洁、高级、文字为主、去徽章。

---

## 1. 排版（队长定）：**纵向两行式**

★ **理由（实测）**：
- 内容是**按阶段推进的一串** ⇒ **纵向最自然**（B1 的横向四列是"一屏看全",而本规格是"逐步推进"）
- 面板真实宽度 `@container max-width: 360px` ⇒ ★ **横向四列在 360px 下每列只有 90px**（几何约束）

## 2. 风格（用户原话：「简约的，简洁的，高级的」）

| 规则 | 具体 |
|---|---|
| ★ **文字为主** | 不用卡片、不用药丸、不用底纹块 |
| ★ **两行式** | 行 1 = 名字 + 状态短语；行 2 = 轮次 · 阶段 · 测试 |
| ★ **唯一保留的图元** | **一个 3.5px 状态点** —— 它是**信息**（三态),不是装饰 |
| ★ **去掉** | 头像（`memberArt`/`stateArt`/`memberInitial`）· 徽章 · 卡片边框 |
| **分割** | 1px `#2b3036` 细线,不用卡片围栏 |
| **字重** | 名字 500；其余 400。**不用粗体堆叠** |
| **色彩** | 只用**语义色**:蓝(进行中) 绿(完成) 琥珀(继续下一轮) 红(失败) 灰(空闲/未跑) |

★ **实测过宽度**（360px 容器）：
```
行 1: 名字(12.5px) 左 …… 状态短语(11.5px) 右   ⇒ 最长 119 vs 286 ✅
行 2: 轮次·阶段·测试(10.5px)                    ⇒ 最长 248 / 346 ✅
```

---

## 3. 未展开态（两行）

```
● ui-hy4 ······················· 在做 t77
  第 1 轮 · completion 段 · 变异测试 8/14
```

★ **行 2 的三段各有来源**：

| 段 | 来源 | 缺失时 |
|---|---|---|
| **第 N 轮** | `task.round` | 省略该段 |
| **阶段** | ★ **从任务状态推出**（见 §4）| 省略 |
| **测试** | ★ `registry.list()[该段]` 的 id 后缀 | 省略 |

★★ **行 2 按优先级组装,超出就截断**（先省"测试",再省"阶段"）—— **不许溢出**。

## 4. ★★ 阶段推导（甲方案的核心,只做能做的）

| `task.status` | 推出 |
|---|---|
| `pending` | **dispatch 段**（等派工）|
| `in_progress` | ★ **completion 段**（成员在做）|
| `completed` + `gateEvaluation` 已有 | **delivery 段**（待交付）|
| `completed` 无判据 | 省略阶段 |

★ **"在跑什么测试"**：从 `registry.list()[该段]` 取。
- ★ `in_progress` ⇒ 显示 completion 段的测试名
- ⚠️ **contract/dispatch 段的逐条裁决读不到**（数据没落盘）⇒ ★ **不许假装有**

---

## 5. 展开态（按阶段分组）

```
▼ ui-hy4 · UI engineer · hy4-preview · B 线前端

  ✓ contract 段         已通过 · 3 条判据
  ✓ dispatch 段         已通过 · 3 条判据
  ▶ completion 段       正在跑 · 4 条判据
      ● completion.mutation        变异测试        8/14
      ○ completion.r5              回归门          待跑
      ○ completion.backtest        回归测试        待跑
      ○ completion.verify-rerun    重跑验证        待跑
  ○ delivery 段         未开始 · 2 条判据
      · delivery.coverage          覆盖率门
      · delivery.convergence       收敛检查
  ⚑ 观察中：runtime.liveness
```

### ★★★ 四态**必须明显不同形**（本仓纪律）

| 符号 | 含义 | 色 |
|---|---|---|
| **✓** | 真的跑过且通过 | 绿 |
| **⊘** | 跳过（`skippedAll` 在场）| 灰 —— ★ **绝不是 ✓**（`c4cbeaf` 修的）|
| **●** | 正在跑 | 蓝 |
| **○** | **注册了但本轮未跑** | 灰 |
| **·** | 未开始 | 更暗的灰 |
| **✗** | 失败 / observed | 红 / 琥珀 |

★★ **`✓` 与 `○` 与 `⊘` 三者必须可辨** —— 它们分别是"通过了""没跑""跳过了"。

### ★ 每条测试显示 `description`

⇒ ★★ **那是"可插拔"的落点**：换掉一条判据 ⇒ `id` 与 `description` 都变 ⇒ **UI 自动跟着变**。

### ★ `registry.list()` 的出口

⚠️ 它现在只在 `src/tools/status.ts:974`（**UI 不读的通道**）。
⇒ ★ **需要与 t78 同构地转发到 `collectTeamsActivity`**（`src/snapshot.ts`）。

---

## 6. 两条反向半边（必须在契约里）

**A**：一个**从未跑过**的任务 ⇒ 展开态**不许**出现任何 **✓**
**B**：一个 **`skippedAll` 在场**的位置 ⇒ 必须显示 **⊘**,**不许**显示 **✓**
（★ B 是 `c4cbeaf` 修过的那个缺陷在 UI 上的形态）

---

## 7. 去掉的东西（用户裁定）

```
avatar:  src/client/MemberRow.tsx:424-429 的 memberAvatar 整块
         牵连: memberArt · stateArt · memberInitial · accentOf · ACTION_ART
         · memberArtUrl（若别处还用则保留 import,否则一并清）
badge:   模型名若仍是药丸 ⇒ 已在 :463 改成行内文字（核实即可）
```

★ **去头像后 `artwork.ts` 可能无引用** ⇒ 一并核查（不许留死模块）。

---

## 8. 写域（不许越界）

```
src/client/MemberRow.tsx            ← 主改
src/client/ActivityPanel.module.css ← 样式
src/client/activity-model.ts        ← 阶段推导（纯函数）
src/snapshot.ts                     ← 转发 registry.list()（与 t78 同构）
lib/**（对应产物）+ lib/git-artifact-stamp.json
docs/UI-REFACTOR-V4.md              ← 实施记录
```

★ **不许改**：`src/gates/**`（判据逻辑）· `src/state.ts` · `src/types.ts`
★ **零新依赖**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
