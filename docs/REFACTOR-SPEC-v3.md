# UI 重构规格 v3：按你的推导重新定（2026-10-16）

> **本文取代 v2 的 §5-§7。** v2 的 §1-§4（你的原话、数据现状、可插拔机制、两个 bug 调查）
> 仍然有效。

---

## 1. ★★★ 你的推导（本轮原话，逐字）

> 「既然能显示"**已经完成**"就够了呀。比如说**上一阶段已经完成了，
>  那下一阶段自然就得开始了**呀，对吧？
>  我们**不需要显示上一阶段**，只需要**把上一阶段的完成当做一个信号，
>  自然就进入下一阶段的任务进行中了**，你就可以说**现在在跑什么东西**了」

## 2. ★★ 而我验证了：**这个推导成立，且顺序是声明式的**

`src/gates/registry.ts:288` **逐字（含注释）**：
```ts
export const INSERTION_POINTS = Object.freeze([
  'admission',   // ⓪ 成团【之前】：这份需求 / 计划够不够格进场
  'contract',    // ① 建任务 / 改契约
  'dispatch',    // ② 派发前（成员开工）
  'completion',  // ③ 成员汇报完成
  'delivery',    // ④ 团队宣布交付
  'runtime',     // ⑤
])
```

⇒ ★★ **顺序刻在源码里** ⇒ 于是：

```
上一代 ran[] 落在 contract 段  ⇒ 现在在 dispatch 段
上一代 ran[] 落在 dispatch 段  ⇒ ★ 现在在 completion 段
上一代 ran[] 落在 completion 段 ⇒ 现在在 delivery 段
```

⇒ ★★★ **"现在在跑什么"是从"上一代完成到哪一段"推出来的** ——
**不需要新数据通道,不需要改宿主侧。**

★ 而**你的取舍正好绕开了 v2 §4 那个冲突**：
> **不显示上一代** ⇒ 不会与「S1 刻意丢弃上一代读数」冲突。

---

## 3. ★★★ 而"下一段有哪些测试"也是可查的

`src/gates/registry.ts:592` 有 `list()`：
```ts
list(): Record<InsertionPoint, Array<{ id, description, hasAppliesTo, observing, ... }>>
for (const point of INSERTION_POINTS) out[point] = []
```

⇒ ★★ **它给出每个阶段的全部判据（含 id 与 description）。**

★★ **而 `list()` 已经有出口** —— 但只在 `src/tools/status.ts:974`（**UI 不读的那个通道**）。
⇒ 与 S2/t78 同一个缺口。

---

## 4. ★★ 于是两个态的规格（按你的原话）

### 未展开态（你说："显示正在跑什么任务 + 进行过程中的具体状态"）

```
● ui-hy4  UI engineer (hy4-preview)                在做 t77
  └ 第 1 轮 · completion 段 · 在跑：变异测试 8/14
```

★ **三段信息，各有来源**：
| 段 | 内容 | 来源 |
|---|---|---|
| **①** | 在做哪个任务 | `currentTaskOf`（`status==='in_progress'`）|
| **②** | 第几轮 | `task.round` |
| **③** | ★ **在哪个阶段 + 在跑什么** | ★ **上一代 ran[] 推下一段** + `registry.list()` |

★ **③ 的推导规则（机械）**：
```
上一代 ran[] 里最后一个【完成了】的阶段 = P
⇒ 显示 P 的下一段（按 INSERTION_POINTS 顺序）
⇒ 而"在跑什么"从 list()[下一段] 里取（若该段有多条，显示全部 id 后缀）
```

★ **若没有上一代**（第一条任务）⇒ 显示 `contract 段`（流程的第一个位置）。

### 展开态（你说："职责+模型+已完成/未完成 + 所有测试哪些通过了"）

★ **按【阶段】分组**：
```
▼ ui-hy4  UI engineer · hy4-preview · B 线前端

  ✓ contract 段 —— 3/3 通过
      ✓ contract.verify-command        verify 命令可执行
      ✓ contract.build-artifact-scope  产物范围
      ✓ contract.task-atomicity        任务原子性
  ✓ dispatch 段 —— 2/3 通过，1 跳过
      ✓ dispatch.worktree              worktree 隔离
      ✓ dispatch.plan-reviewed         计划已评审
      ⊘ dispatch.changed-paths         本轮未适用
  ▶ completion 段 —— 正在跑
      ● completion.mutation            变异测试 8/14
      ○ completion.r5                  待跑
      ○ completion.backtest            待跑
  ○ delivery 段 —— 未开始
  ⚑ 观察中：runtime.liveness
```

★ **每条测试显示它的 `description`** —— 那正是**你要的"可插拔"**：
**换掉一条判据 ⇒ id 与 description 都变 ⇒ UI 自动跟着变,不用改代码。**

---

## 5. ★ 去徽章（你的裁定，对应计划 B3）

★ **去掉**：头像、徽章、卡片
★ **保留**：成员名 + 职责 + 状态点
⇒ 成员**降级为流程行**,而**测试列表成为主体**。

---

## 6. ★ 三个 bug（我查实的）

### ① 琥珀色 —— ★ **映射是对的**

`src/client/MemberRow.tsx:143-148`：
```ts
ok: 'round.tone.completed'（绿）· blocked: 'round.tone.failed'（红）
unmeasured: 'round.tone.unmeasured'（中性）· observed: 'round.tone.converging'（★ 琥珀）
```
CSS 注释（`ActivityPanel.module.css:2162`）逐字：
> 「converging(琥珀) / failed(红) / unmeasured(中性) / running(蓝) / completed(绿)」

⇒ **琥珀来自 `converging`（"继续下一轮"），不是来自"已完成"。**

### ② ★★ 而**真的存在一个状态冲突**（你的截图）

```
ui-dissect:  主行「t69 失败 · 待重派」  小字「第 5 轮 本轮已完成」
```
**根因**：两个独立算的 tone —— `memberDoingText`（看**最新终结任务**）
vs `memberRound`（看**最后一轮的 roundTone**）。**两个"最新"不是同一口径。**

⇒ **本次重构处置**：统一口径,或明确标注各是什么。

### ③ ★ **未检查与全通过必须不同形**（已由 `c4cbeaf` 修）

★ 我修的那个：`skippedAll` 在场 ⇒ `unmeasured`（修前被画成 ✓）。

---

## 7. 唯一待定的

**排版**：样张 A / B / C？（内容规格已定,三种都能装）

★ 而**按本规格,内容是【纵向的一串阶段】**,所以 **A 或 C 更自然**
（B1 的横向四列是"一屏看全",而本规格是"按阶段推进",**纵向更贴合**）。

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*

---

## 8. ★★★ 一处我必须更正的硬伤（2026-10-16，我在写本文之后才查实）

★ **本文 §4 的展开态规格"按阶段分组显示所有测试"【做不到】。** 我写的时候没查这一层。

### 实测：**只有 `completion` 段的求值结果落盘**

```
全仓 registry.evaluate() 的求值点：
  'contract'   ⇒ src/tools/shared/entities.ts   （拒绝路径）
  'dispatch'   ⇒ src/tools/update-task/dispatch.ts:117
  'completion' ⇒ src/tools/update-task/completion.ts
  'delivery'   ⇒ src/tools/delivery.ts · src/tools/status.ts
  'runtime'    ⇒ src/tools.ts · src/tools/shared/entities.ts

而【落盘到 task】的只有一行：
  src/tools/update-task.ts:1842
    task.gateEvaluation = gateEvaluationRecordOf(completionGates)
                         ↑ ★ 只有 completion 段
```

| 段 | 求值？ | **落盘？** |
|---|---|---|
| `contract` | ✅ | ❌ 只当场用于放行/拒绝 |
| `dispatch` | ✅ | ❌ |
| **`completion`** | ✅ | ★ **✅ 落盘** |
| `delivery` | ✅ | ❌ |
| `runtime` | ✅ | ❌ |

### ★★ 这对规格意味着什么

| 规格条目 | 能做到吗 |
|---|---|
| 展开态显示 **completion 段**的全部测试与裁决 | ✅ **能** |
| 展开态显示 **其他四段**的测试与裁决 | ❌ **不能**（没有数据）|
| 未展开态推导"现在在哪个阶段" | ⚠️ **只能推出"completion 已完成 ⇒ 在 delivery"**；**contract/dispatch 段无从得知** |

⇒ ★★ **而 §2 那个推导（"上一段完成 ⇒ 下一段开始"）因此【只对 completion 那一步成立】。**

### ★ 两条出路（属于产品决策，我不替你选）

| | 方案 | 代价 |
|---|---|---|
| **(甲)** | ★ **只做 completion 段**（承认其余四段不可见）| ✅ 零改动；❌ 与你要的"看到全部测试"不符 |
| **(乙)** | ★ **把其余四段也落盘**（与 S1 同构,多写几个字段）| ⚠️ 改宿主侧；★ 会与「S1 刻意只存 completion」的取舍冲突 |

★★ **而 (乙) 是真正满足你原话的** —— 而它**是一个新机制**,不是渲染。

★ 我**先如实报出这个硬伤**,而不是按错的规格派工。
