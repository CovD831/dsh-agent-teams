# F 线 · 数据飞轮的心脏：confidence（双计数 + 双阈值 + 四条件）

> **改动**：新增 `src/confidence.ts`（+330 行）· `src/tools/shared/entities.ts`（+98 行，接线）· lib 产物。
> **基线**：HEAD `e7df82c`（worktree `task-agent-teams-refactor-t68`）。开工前 stamp 陈旧（`1a1672d`）⇒ 已先 `pnpm build` 对齐。
> **参照**：腾讯 TeamAI 的 `docs/designs/git-native-memory.md`（**外部材料，不在本仓**——见 §6 局限①）。
> **硬纪律自证**：未碰 `src/client/**`、`src/quality-gates.ts`、`src/mutation.ts`、`src/state.ts`、`scripts/`、`docs/REFACTOR-PLAN.md`。

---

## 0. 一句话

飞轮的**心脏是两个分开的计数**（`recalled` / `upvoted`），配**两条阈值**切成**三段**（含很宽的观察区），
晋升要求**四条件齐全**；★ 而**任何缺失都是独立的一态（`undefined`），从不填 0**。

---

## 1. F1 · confidence 的形状

### 1.1 两个计数**分开**，且**不可合并**

| 计数 | 何时 +1 | 含义 |
|---|---|---|
| `recalled` | 检索**命中**它 | "它被**找到**过几次" |
| `upvoted` | ★ **采纳证据**（agent 真的**打开了**它） | "它被**用上**了几次" |

★ **为什么不可合并**（这是整份设计最讲究的一处）：
- 只数 `recalled` ⇒ 一个**总被搜到、却从不被采纳**的条目**显得很热**；
- 只数 `upvoted` ⇒ **丢了"曝光度"**；
- **两个一起** ⇒ 才分得清「**没人搜它**」与「**搜到了但没人用**」。

⇒ 而这正是本仓记账最久的形态：**"没找到"与"确实没有"同形**。
★ 所以模块**不提供**任何把它们加起来的函数 —— **合并本身就是要防的事**，
提供一个 `total()` 等于把那个缺陷做成 API（自证里有断言钉住这一点）。

### 1.2 累积：两个事件**各加各的**

```
recall（检索命中）⇒ recalled + 1   ★ 不动 upvoted
adopt（采纳/打开）⇒ upvoted + 1    ★ 不动 recalled，且记下 contributor
```

★★ **`adopt` 为什么不顺带 +1 `recalled`**：那会**污染"曝光度"** ——
一个被采纳的条目**必然**先被搜到过，但**反过来不成立**；
若 adopt 也增 recall，就再也分不出「搜到 100 次采纳 1 次」与「搜到 1 次采纳 1 次」。

★ `contributors` **存名单不存数字**：因为「≥2 contributors」要的**恰恰是"是不是两个不同的人"**，
而 `contributors: 3` **无法**回答"这 3 次是不是同一个人做的" —— 而那正是"一个偏方变成全队默认"的入口。

### 1.3 confidence 公式 —— 腾讯**没给**，我按设计性质反推

腾讯原文只给了两条阈值与飞轮形状，**没有公式**。⇒ 我按**设计必须满足的三条性质**反推，并把性质写成断言：

| 性质 | 断言 |
|---|---|
| **采纳率驱动** | `100 recall / 1 upvote` ⇒ confidence **< 0.15**（"总被搜到而从不采纳"必须**显得冷**） |
| **小样本不许冒高** | `1 recall / 1 upvote` ⇒ **不过**晋升线（与 `50/50` **不同形**） |
| **缺失 ⇒ 判不了** | 任一侧缺席 ⇒ `undefined`（**不是 0**） |

**公式**：`confidence = (upvoted + k/2) / (recalled + k)`，`k = 2`（小样本收缩）

| 输入 | confidence | 读数 |
|---|---:|---|
| 1 / 1 | 0.667 | ★ 100% 采纳率，但**样本太小，不许晋升** |
| 50 / 50 | **0.981** | 同样的采纳率，样本量把它推过 0.90 |
| 100 / 1 | **0.020** | ★ "总被搜到而从不采纳"确实**冷** |
| 1000 / 50 | 0.051 | ★ `upvoted>0` 但采纳率低 ⇒ **照样归档** |
| 0 / 0 | 0.500 | 没有观测 ⇒ **中立**（不是 0 也不是 1） |

★ **为什么分母用 `recalled` 而不是两个计数之和**：若把曝光量混进分母，
那个"总被搜到"的条目会因为**自己的曝光**把分数**推高** —— 那正是要防的形态。

---

## 2. F2 · 双阈值 = **三态**（+ `unmeasured`），不是二值

```
promote   ：confidence ≥ 0.90
observe   ：0.15 ≤ confidence < 0.90      ← ★ 很宽的观察区，是【正式归宿】
archive   ：confidence < 0.15
unmeasured：confidence 读不出来（缺 recalled 或 upvoted）
```

★★ **中间那一段不是"待定"，它是一个正式的归宿** —— 与门禁注册表的
`ok`/`blocked`/`unmeasured` **同构**：`unmeasured` 不是"还没测出结果"的临时态，
它是"**我判不了**"这个**结论本身**。同一条纪律：**别把"还没成熟"读成"不合格"**。

★ **归档是单条件**（`confidence < 0.15`），与晋升**不对称**，这是刻意的：
晋升要求"经得起时间和多人"，归档只要求"它确实没用"。
但 `confidence === undefined` ⇒ **既不能归档也不能晋升** ⇒ `unmeasured` ——
★ 把"没有读数"读成"低分"会**直接归档**一个可能只是**没人记过**的条目。

---

## 3. ★★★ F2 的四条件 —— 直接回答那条尖锐质疑

腾讯原文的全部四条件：
`confidence ≥ 0.90` **∧** `≥5 upvotes` **∧** `≥2 contributors` **∧** `存在 ≥ 14 天`

> 质疑：「**how do you stop one bad workaround from becoming the team's default
> after a few successful runs?**」

| condiiton | 挡住什么 |
|---|---|
| **只有 confidence** | 一个人试了 5 次、成 5 次 ⇒ confidence 高 ⇒ **立刻全队默认**（而 5 次可能全在**同一台机器**上成功） |
| **`≥2 contributors`** | 挡住"**一个人的偏方**"：必须有**第二个人独立地**用上它 |
| **`≥14 天`** | 挡住"几天内连续试了几次"：让结论**经得起时间** |

⇒ ★ **只抄 confidence 会重犯那个问题** —— 所以四条件在代码里是 **AND**，不是打分。
★ 任一条件**读不出来** ⇒ 该条为 `undefined` ⇒ **不晋升**（落 `unmeasured`/`observe`），
**不许**把 `undefined` 当作"通过"。

★ 四条件的**逐条读数**都返回（`conditions` + `reasons`），不是只给一个 `false` ——
读的人能看到**具体缺哪一条**。

---

## 4. 验证

### 4.1 自证：**33 条断言全绿**

```sh
$ node /tmp/fcheck.mjs "$(pwd)"
── F1：两个计数【分开】，不可合并                                    （7 条 ✔）
── ★ 不许把「缺失」填成 0                                            （6 条 ✔）
── F2：双阈值 —— 三态（+unmeasured），0.15–0.90 是【观察区】          （5 条 ✔）
── F2：晋升必须【四条件齐全】                                        （6 条 ✔）
── ★★ 反向半边：confidence 高但【只有 1 个 contributor】⇒ 不许晋升    （4 条 ✔）
── ★ reflect 层：刻意不做                                            （2 条 ✔）
── 接线：沉淀 × 飞轮（entities.ts）                                  （3 条 ✔）
★ 结果：pass 33 / fail 0
```

**★ 反向半边（验收点名的那条）**：
```
✔ 该条 confidence ≥0.90 确实很高              ← 先证明它"看起来够格"
✔ 而它【不许】晋升（只有一个贡献者）
✔ 且 reasons 里指名 contributors 没过（不是笼统拒绝）
✔ ★ 对照：加上第二个人 ⇒ 立刻可晋升            ← 证明拦的正是那一条，不是别的原因
```

### 4.2 ★★ 反向半边：四个变异体，**全部被检出**

| 变异体 | 改法 | 结果 |
|---|---|---|
| **A** | 缺失**不判了**（`undefined` 不再短路）—— 即"填 0"路线 | ✅ exit=1，**7 条 ✖** |
| **B** | 晋升**只看 confidence**（丢掉其余三条件） | ✅ exit=1，**3 条 ✖** |
| **C** | 归档被**额外条件收窄**（`&& upvoted === 0`，观察区被吞） | ✅ exit=1，**1 条 ✖** |
| **D** | 接线处把缺失补成 `{ recalled: 0, upvoted: 0 }` | ✅ exit=1，**2 条 ✖** |

★★ **变异体 C 第一次【没红】—— 而那是我的断言有洞，不是变异体无效**：

我原先的归档用例**只有 `upvoted === 0` 的输入**（`100 recall / 0 upvote`），
于是变异体加的 `&& upvoted === 0` **恰好恒真** ⇒ 测不出来。
⇒ 我补了一个 `1000 recall / 50 upvote`（confidence 0.051 < 0.15 **且 `upvoted>0`**）的用例：
再跑变异体 C ⇒ **exit=1、1 条 ✖**（裁决从 `archive` 被翻成 `observe`）。
★ 这一条是本次**最有价值的自我纠错**：一个只覆盖单侧输入的断言，
会让"归档条件被悄悄加严"整类缺陷**不可见**。
★ 另：变异体 A 第一次是**崩溃**（我的注入写坏了 `const` 参数）而不是被检出 ——
**"退出码非 0"不等于"被检出"**，必须同时看 ✖ 数（A 修好后是 7 条 ✖）。这与 t62/t63 记的同一类。

### 4.3 构建与净变化

```sh
$ npx tsc -p tsconfig.json --noEmit   # exit=0
$ pnpm build                          # exit=0；新增 lib/confidence.js + lib/types/confidence.d.ts
$ pnpm test:gates                     # tests 1471 / pass 1413 / fail 20
```

★ **净变化按【失败文件集合】判**（契约要求，因为计数会抖）：
```sh
$ comm -13 <(改前失败文件集) <(改后失败文件集)     # 净新
（空）
$ comm -23 …                                       # 净减少
（空）
```
⇒ ★ **净新失败 = 0、净减少 = 0** —— 失败文件集**逐条相同**（16 个）。
★ **基线口径修正**：任务书给 1415/19，而我**动代码前实测** = **1413 pass / 20 fail / 16 个文件**。

---

## 5. ★ reflect 层：**刻意不做**（验收点名）

腾讯**自己推迟了**，原文理由：「**needs 20+ learnings**」、
「The knowledge base is **still cold-starting; not enough data**」。

★★ **而我们的处境更该推迟**：我们有 **384 条卡点，但 confidence 全为 0** ——
即**"热"在数量上，不"热"在质量信号上**。
★ 本模块的产出全是**累积出来的行为读数**（recalled / upvoted / contributors / age），
而它们**今天一条都还没有**。⇒ 此时做 reflect，等于**在没有读数的库上做"反思"** ——
而那正是腾讯点名要避免的那个错。

⇒ 所以模块里**没有** `reflect()`。推迟的**理由是可读的**（`REFLECT_DEFERRED_REASON` 常量），
不是留白。★ 等的条件也是可判的：**库里真有条目进入 `promote`** ——
不是"我们觉得够了"。

---

## 6. 局限（如实留白）

1. ★ **我没能读到腾讯原文**：`docs/designs/git-native-memory.md` **不在本仓**
   （`find` 无结果），它是队长转述的材料。⇒ 我**实现了转述里的每一条**，
   但**无法**独立核对"转述是否忠实于原文"（如公式、`k` 值、四条件的确切措辞）。
   ★ 这是本次**最大的不确定性**，且**不是我能自证的** —— 记在这里而不是含糊过去。
2. **`k = 2` 是我选的**（原设计未给）。它决定"多大样本才算数"，是**可调参数**而非事实。
   ⇒ 若将来发现晋升过快/过慢，**先调它**，不要动阈值。
3. **没有真实数据流过**：全部验证都在构造输入上。★ 真台账里**没有任何条目带使用读数**
   —— 这正是 §5 说 reflect 不能做的**依据**，也是本模块**尚未在真实数据上运行过**的证明。
4. **接线只做了"读"**：`readSedimentFlywheel` 把沉淀与飞轮并读，但**没有**任何生产路径
   **调用** `tallyRecall` / `tallyAdopt`（即：**还没有地方在产生这两个计数**）。
   ⇒ ★ 与 t63 记的同一形态：**机制建好了 ≠ 接线了**。产生事件的那一端（检索/采纳的观测点）
   **不在本任务范围**，需另派。
5. **`unmeasured` 与 `observe` 的区分只在 `reasons` 里**：四条件有读不出来的项时，
   裁决仍落 `observe`（动作相同），差异写在理由里。★ 如果将来需要"缺读数的条目"**单独计数**，
   得**另加一格** —— 今天从 `verdict` 上分不出来。

---

*本文件只写 `docs/F-LINE-FLYWHEEL.md`。改动：新增 `src/confidence.ts`，`src/tools/shared/entities.ts`（+98）及其 lib 产物。*

---

## ★★★ §7 队长补：转述保真度的核对（t68 无法自证的那条）

**t68 在 §6 如实提出**：
> 「我**读不到腾讯的源码** —— `docs/designs/git-native-memory.md` **不在这个仓库**，
>  它是**队长的转述**。我实现了那份转述里的每一条，但**无法独立验证转述的保真度**。
>  ★ **这不是我能自证的事。**」

★★ **它说得对，而这正是分工该有的样子。** 那份原文**在队长手上**
（走 `127.0.0.1:7890` 代理取回，副本在 `/tmp/tc-d-git-native-memory.md`）。
⇒ **核对是队长的责任。下面是逐条核对结果。**

### 核对 1 · 两个计数（F1 的核心）

**队长转述**：「`recalled_count`（被找到）/ `upvoted_count`（被采纳），**两者分开**」

**原文逐字（`:50-53`）**：
```
Ranked results → recalled_count++
                      │
      (adoption evidence: agent opens the doc, or
       opt-in LLM-judge) → upvoted_count++
```
**`:64` 逐字**：
> 「Recall bumps `recalled_count`; adoption evidence (agent opened the doc, or the
>  opt-in LLM-judge) bumps `upvoted_count`」

✅ **转述属实** —— 两个计数、两个触发点（检索命中 / 采纳证据），**确实分开**。

### 核对 2 · 阈值

**队长转述**：`≥0.90` 晋升 · `<0.15` 归档 · 且晋升需 `≥5 upvotes ∧ ≥2 contributors ∧ ≥14 天`

**原文（`docs/guide/knowledge.md`）**：
> 「A learning can become a skill, rule, or doc when its confidence is **at least 0.90**,
>  it has **at least 5 upvotes**, **at least 2 contributors**, and it has existed for
>  **at least 14 days**.」
> 「`--archive` puts aside learnings whose confidence is **below 0.15**.」

✅ **转述属实** —— 四条件与双阈值**逐字对上**。

### ★ 核对 3 · 一个**转述时我漏了的**设计点（诚实补充）

原文 `:64` 还有一段**队长没转述**的内容：
```
→ votes/<user>.yaml → aggregate at pull
```
★ 即：**每人一个文件**,而**聚合发生在 `pull` 时**。

⇒ ★ **队长转述了"每人一个 YAML"（在决策 4 里），但漏了"聚合在 pull 时"这一步。**
这不影响 t68 的实现（它做的是**计数与阈值**,不是聚合时机），
但**将来接线上时要注意**：聚合是**拉取时批量做**的,不是每次投票都写。

### 核对 4 · Hindsight 三阶

**队长转述**：灵感来自 `retain / recall / reflect`

**原文 `:10` 逐字**：
> 「Borrow Hindsight's **three-layer retain/recall/reflect** memory model」

✅ **属实**,且原文另给了映射表（`:56-63`），其中 **Reflect 标为 `⏳ Deferred`**。

### ★★ 结论

| # | 转述项 | 核对结果 |
|---|---|---|
| 1 | 两个计数分开 | ✅ 属实 |
| 2 | 双阈值 + 四条件 | ✅ 属实（逐字对上）|
| 3 | 「每人一个 YAML」 | ✅ 属实,**但漏了"聚合在 pull 时"** |
| 4 | retain/recall/reflect | ✅ 属实 |

⇒ **转述整体保真。** 而**第 3 条的遗漏已在此补上** ——
★ 这就是"转述者不能自证"那条纪律的**具体收益**:它逼出了这次核对,而核对**发现了遗漏**。
