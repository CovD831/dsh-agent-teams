# UI v4 的三个缺陷（用户 2026-10-16 截图发现，队长查实根因）

> **用户原话**：
> 「**第几轮是重复的，有两个**。**展开详情之后会很杂乱**。
>  还有就是**队长的图标还在**。」

★ 三条**全部为真**。以下为**查实的根因**（不是我猜的）。

---

## 缺陷 ① 「第几轮」重复 —— 旧的轮次行没删

```
新（t79 加）: src/client/MemberRow.tsx:616-617  memberStageLine
               内容 = 「第 N 轮 · 阶段 · 测试」

旧（仍在）  : src/client/MemberRow.tsx:645-669  memberRoundLine
               内容 = 「第 N 轮 · 本轮已完成 · t44」

⇒ ★ 两块都渲染 ⇒ "第 N 轮"出现两次
```

**★ 根因是【我的规格漏项】**：我只写了"行 2 = 轮次·阶段·测试",
**没写"旧的 `memberRoundLine` 要删"** ⇒ 实现方保留了它 ⇒ 重复。

### ★ 但旧块**不是纯冗余**，删除时要保住它的功能

`memberRoundLine` 里还有：
```tsx
round.tasks.map((task) => (
  <button data-tone=... onClick={() => onSelectTask?.(task.id)}>{task.id}</button>
))
```
⇒ ★ **那是"点任务 id 跳到该任务"的入口**（截图里的 `t44` / `t67` 可点）。

**处置**：把**任务 id 按钮**并入新行 2（它本来就要显示"测试"）,
**删掉旧的轮次文字**（`memberRoundMark` + `memberRoundTone`）,
**保留** `data-member-round` 与 `data-tone` 探针（臂 27 依赖它们）。

---

## 缺陷 ② 展开后杂乱 —— ★★ 根因是**数据缺口被并列显示**，不是排版

### 实测（`.agent-teams/agent-teams-refactor/team.json` 的 t79）

```
t79 的 gateEvaluation.ran 有 4 条，全部是 completion 段：
  completion.verify-rerun  ⇒ blocked
  completion.r5            ⇒ unmeasured
  completion.mutation      ⇒ unmeasured
  completion.backtest      ⇒ unmeasured
  registered: 4 · evaluated: 4 · skipped: 0

而 UI 显示的是 registry.list() 的【全部 17 条】
⇒ ★★ 其余 13 条没有裁决 ⇒ 状态 'registered'（○）
```

⇒ ★★★ **所以展开态把两件不同的事并列了：**
```
"注册表里有哪些判据"        ← 17 条（清单）
"这次任务实际跑了哪些判据"   ← 4 条（事实）
⇒ 15 个 ○ 淹没 4 个真实裁决 ⇒ ★ 看起来像"什么都没跑"
```

★★ **而"看起来什么都没跑"是【误导】** —— 因为它**不是没跑,是其余段没落盘**（甲方案的边界）。

### ★ 而第二个成因：`skipped` 与 `registered` **同色**

```css
.memberStageRow[data-gate-state='skipped']    .memberStageRowMark { color: var(--…-label-tertiary); }
.memberStageRow[data-gate-state='registered'] .memberStageRowMark { color: var(--…-label-tertiary); }
```
⇒ ★★ **`⊘`（跳过）与 `○`（注册未跑）只靠符号区分,颜色完全相同** ——
在一屏 15 个 ○ 的密度下**几乎不可辨**。

### ★ 第三个成因：空段也占一行

```
· admission        0 条      ← ★ 0 条也显示
```
⇒ 截图里 admission 那行**没有任何信息**,却占了一行。

---

## 缺陷 ③ 队长图标还在 —— ★ 我只改了成员行

```
队长 = src/client/CaptainNode.tsx:50-51
         <span className={css.captainAvatar}>
           <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
成员 = src/client/MemberRow.tsx   ← ★ t79 只改了这里
```

**★ 根因也是【我的规格漏项】**：我写了"去掉头像",
**没写明"队长也要去"** ⇒ 实现方只改了成员行。

---

## 修复规格

### ① 删旧轮次行（保住任务按钮与探针）

```
删： memberRoundMark（"第 N 轮"文字）+ memberRoundTone（"本轮已完成"）
留： round.tasks 的 <button> ⇒ 并入行 2
留： data-member-round · data-tone 探针（臂 27 依赖）
```

### ② 展开态重做（★ 这是本次最重的一条）

**★ 分组显示"两件不同的事",且【明显不同形】：**

```
▼ ui-engineer · UI engineer · deepseek-v4.1-flash

  ✓ 本轮跑了 4 条判据 —— 全部在 completion 段
      ✗ completion.verify-rerun   重跑验证      失败
      ⊘ completion.r5             回归门        未测到
      ⊘ completion.mutation       变异测试      未测到
      ⊘ completion.backtest       回归测试      未测到

  ○ 其余 13 条判据在别的段 —— ★ 本轮没有落盘读数（不是"没跑"）
      contract 3 条 · dispatch 3 条 · delivery 2 条 · runtime 2 条 · admission 0 条
```

⇒ ★★ **要点：**
1. ★ **"跑了的"在前,"没读数的"折叠成一行**（不逐条列 13 个 ○）
2. ★ **"没读数"的措辞必须与"没跑"不同形** —— 它是**数据缺口,不是事实**
3. ★ **去掉空段**（`admission 0 条` 不显示）
4. ★ **`○` 与 `⊘` 必须不同色**（现在同色）

### ③ 队长去头像

```
src/client/CaptainNode.tsx:50-51  删 captainAvatar / leadAvatar
★ 核查 LEAD_ART 是否还有其他引用（t79 报过"4 个组件 import LEAD_ART"）—— 有则留,无则清
```

---

## 两条反向半边（必须）

**A**：一个**从未求值过**的任务 ⇒ 展开态**不许**出现任何 **✓**,
且**不许**把"没有读数"说成"没跑"
**B**：`skippedAll` 在场 ⇒ 必须 **⊘** 且**与 ○ 不同色**（`c4cbeaf` 的形态）

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
