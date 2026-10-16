# UI v4 三缺陷修复记录（t80）

**基线**：HEAD = `0c9ee79`（`git merge-base --is-ancestor 71790be HEAD` ✅）。
开工时 `lib/git-artifact-stamp.json` 的 commit 是 `1d7912c` ≠ HEAD ⇒ **先 `pnpm build` 取新鲜基线**。
**写域**：只改 `src/client/**` + 构建产物 + 本文。`src/gates/**`、`src/state.ts`、`src/types.ts`、`scripts/**` 一行未动。

---

## 0. 验收读数

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `npx tsc -p tsconfig.client.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0**（`lib/client.js` 359.47 kB） |
| `grep -c 'data-member-round' src/client/MemberRow.tsx` | **3**（1 处真渲染 + 2 处注释提到） |
| `pnpm test:gates` | **1482 tests / 1424 pass / 20 fail / 16 文件**，失败**文件集合**与基线 `diff` 无输出 ⇒ **净新 = 0** |
| 成员行夹具臂 24–29 / 30–32 | **16/16 绿** |
| 本轮缺陷判据（自写） | **41 条断言全绿**；**8 个变异体全部被检出** |

★ 任务书给的基线是 `1482/1425/20/16`，我实测 **1424** —— 差 1。按净变化纪律**以本 HEAD 实测基线为准**，如实记在这里。

---

## 1. 三个缺陷的修法

### ① 「第几轮是重复的，有两个」

改前**两块**都印轮次：v4 的行 2（`memberStageLine`）印 `第 N 轮 · 阶段 · 测试`，
而旧的 `memberRoundLine` 又印一次 `第 N 轮` + 「本轮已完成」。

★ 而旧块**不是纯冗余**：它含**可点的任务 id 按钮**（`onSelectTask`）与两个探针
（`data-member-round` / `data-tone`，臂 27 依赖）。

⇒ 处置：**把按钮并进行 2**，删掉旧块里**重复的那两句**。逐条落点——

| 保留 | 删掉 |
|---|---|
| 任务 id `<button>`（并入行 2 的 `memberStageTasks`） | `memberRoundMark`（「第 N 轮」文字） |
| `data-member-round` / `data-tone`（挂到行 2 的按钮组上） | `memberRoundTone`（「本轮已完成」） |
| `onSelectTask?.(task.id)` + `event.stopPropagation()` | 整个 `memberRoundLine` 容器 |

★★ **`stopPropagation` 是必需的新增**：行 2 在那一整行 `<button>`（展开/收起）**内部** ——
不拦住冒泡，点任务 id 会**顺带把这一行折叠掉**。这是"按钮并进去"带来的**新**交互耦合，
不是我抄来的。实测断言在案。

★★ **轮次词条 `member.round.mark` 仍是轮次的唯一出处**：行 2 经
`t('member.round.mark', …)` 渲染，而**不是**硬编码「第 N 轮」。这不是风格 ——
臂 25b **逐字**断言 `member.round.mark:2` 出现在**这一行**里。我第一版硬编码，
**臂 25b 当场报红**（见 §3）。

### ② 「展开详情之后会很杂乱」

**根因不是排版，是把两件不同的事并列了**（队长已查实，我复核成立）：

```
gateEvaluation.ran  只有 4 条，全在 completion 段
registry.list()     有 17 条
⇒ 其余 13 条没有裁决 ⇒ state='registered'（○）
⇒ 13 个 ○ 淹没 4 条真实裁决 ⇒ 看起来像"什么都没跑"
```

★★ **而"看起来什么都没跑"是误导**：它**不是没跑**，是**其余段的结果不落盘**（甲方案边界）。

⇒ 拆成**两块**（`splitStageGroups`，纯函数）：

| 块 | 内容 | 渲染 |
|---|---|---|
| `ran` | `hasVerdicts` 的段 | 段头 + **逐条** id/description/符号 |
| `silent` | 有判据但没有落盘读数的段 | **折叠成一行**（逐段计数，不逐条） |

★ 四条硬约束逐条：

1. **跑了的在前、没读数的折叠成一行** ✅ —— 实测 4 条逐条 + 13 条折成 1 行（4 个段行）。
2. **措辞不同形** ✅ —— `ran`：「本轮跑了 {count} 条判据 · {stages}」／
   `silent`：「其余 {count} 条在别的段 —— **本轮没有落盘读数（不是没跑）**」。
3. **`○` 与 `⊘` 不同色** ✅ —— 改前两者**同为** `--dsw-alias-label-tertiary`（`:2775-2776`）；
   现在 `⊘` 保持 `label-tertiary`（**有结论**：跑了、跳过了），`○` 改 `--dsw-alias-border-l3`
   （"还没有东西"那一族）。逐条与段头**各一处**都改了。
4. **空段不显示** ✅ —— `rows.length === 0` 两块都不进（`admission 0 条` 不显示）。
   ★ 而"不显示"与"显示 0 条"不同形：后者会让人以为那个位置**该有**判据却没有。

★ **`noVerdicts` 词条仍然有人用**：silent 块的逐段计数用它（它逐字说的就是"结果不落盘"）。
我第一版把它**删掉**了，臂 27 立刻报红（"被引用的 locale 键掉了"）—— 见 §3。

### ③ 「队长的图标还在」—— 而它在**四处**

| 处 | 改前 | 处置 |
|---|---|---|
| `CaptainNode.tsx:51` | `<img className={css.leadAvatar} src={LEAD_ART}>` | **删显示**（连同空的 `captainAvatar` 外壳）+ CSS 头像列从 3 列改 2 列 |
| `AgentTeamsCard.tsx:90` | 卡片顶部同一句 | **删显示** |
| `TeamChatEntry.tsx:16` | `<img src={LEAD_ART}>` | **删显示** |
| `ActivityPanel.tsx:57` | `import { LEAD_ART }` | **核查=死 import**（`grep -c LEAD_ART` = 1，即 import 本身）⇒ **删 import** |

★★ **`LEAD_ART` 资源一个字节没动**（`artwork.ts` 未在改动清单里）：
`team-lead-v2.png` 在 `scripts/verify.mjs:311` 的打包契约清单里，删图会红一条
**host 侧**契约（不在本任务写域）。实测：四处**零** `leadAvatar` 渲染点，
而 `artwork.ts` 里 `export const LEAD_ART = \`${ART_BASE}team-lead-v2.png\`` 原样。

★ **连 CSS 的头像列一起去掉**（不是只删 DOM）：`grid-template-columns` 从
`48px minmax(0,1fr) auto` 改 `minmax(0,1fr) auto`，窄态 2 列改 1 列。
只删 DOM 不删列会留一条 48px 空槽 —— 那看起来像"图没加载出来"，是**另一种**误导。

---

## 2. 两条反向半边（+ **变异体实测 8/8 被检出**）

判据写成纯函数层（`lib/client/activity-model.js` 与 `MemberRow.js` 可直接跑，不需浏览器）。

| 变异体 | 含义 | 被检出 |
|---|---|---|
| M1 `registered(支②) ⇒ passed` | **破坏反向半边 A** | ✅ FAIL=2 |
| M2 `skipped ⇒ passed` | **`c4cbeaf` 的形态 / 反向半边 B** | ✅ FAIL=2 |
| M3 `○` 与 `⊘` 同色 | 回到缺陷②改前的样子 | ✅ FAIL=1 |
| M4 空段也显示 | 违反硬约束 4 | ✅ FAIL=3 |
| M5 silent 也当 ran | 不分两块 | ✅ FAIL=9 |
| M6 队长头像回来 | 缺陷③ 复发 | ✅ FAIL=10 |
| M7 `hasVerdicts` 按"有没有通过"推 | 把"跑了但 0 条通过"错读成"没有读数" | ✅ FAIL=7 |
| M8 空段也算一个段 | 同 M4 的另一条路径 | ✅ FAIL=3 |

**8/8 全部被检出。**

---

## 3. ★★★ 本轮我自己抓到的**四处"假绿"**（逐条留痕）

### 假绿 1：A 臂只覆盖了 `registered` 的**一处**产出点
`stageGateRows` 里 `registered` 有**两处**：① 整段没有裁决；② 该段有裁决但**这一条不在 `ran[]` 里**。
我第一版 A 臂只走 ① ⇒ 变异体打在 ② 上时**全绿**。
⇒ 补 ② 的用例（completion 段有裁决、只有 1 条在 `ran[]`）后 M1 才 FAIL=2。

### 假绿 2：B 臂被 `skippedAll` **遮住**
`gateRunState` 里 `'skipped'` 也有**两处**：① `skippedAll` 在场 ⇒ 整段压成 ⊘；② 该条自己的 `verdict === 'skipped'`。
我第一版夹具**带了 `skippedAll`** ⇒ ① 先返回、**② 被遮住** ⇒ M2 全绿。
★ **这与上一轮（t79）那次是同一种错**：夹具走了**另一支**，于是变异体测不到。
⇒ 补一条**不带 `skippedAll`** 的用例后 M2 才 FAIL=2。

### 假绿 3：夹具**照抄**了被测逻辑
我在测试脚本里自己写了一份 `groupsFor()`，并**把 `hasVerdicts` 硬写死**在里面 ——
于是 M7（改生产那一行）**测不到**，因为测的是**副本**。
⇒ 改成调用**生产导出的 `stageGroups`**（它从 `MemberRow.tsx` 导出就是为了这个）后，M7 才 FAIL=7。
★★ **教训：夹具照抄被测逻辑 = 夹具测的是自己。判据必须打在实现处。**

### 假绿 4（两处断言口径错误，各自记下）
- **配色比对读了"第一条"匹配而不是"最后一条"**：CSS 的胜出者是**后出现**的那条，而我的 v4 覆盖
  正是靠"在后面"生效 ⇒ 读到的是**已被覆盖**的旧值 ⇒ 假红。同样属于"**读错了谁赢**"。
- **计数把注释也算进去了**：`t('member.round.mark'` 在注释里被提到一次 ⇒ 计数 2 ⇒ 假红。
  改成只在**代码行**里数。
- **两个情形的数字搞混**：A 臂"从未求值 ⇒ silent = 13"是错的 —— 13 是"completion 跑了 4 条"时的余数；
  **没有求值时全部 17 条**都在 silent 块。已改成 17 并写明口径。

★ 另有 **两处真回归**（不是假绿，都是我改出来的，已修）：
`member.round.mark` 硬编码（臂 25b 报红）与 `member.gates.noVerdicts` 变成死词条（臂 27 报红）。
两处都是**先报红、再修**，没有为了让测试变绿去放宽任何断言。

---

## 4. ★ 一处规格与盘上不符（如实报出）

任务书逐字说「规格见 `docs/UI-DEFECT-V4.md`（**唯一依据**）」——
**该文件在本 worktree 里不存在**（`git ls-files docs/` 只有 `UI-REFACTOR-V4.md` 与
`UI-DEFECT-D12-STATUS-COLLAPSE.md`）。

⇒ 我按**任务书正文**里那份完整规格做的（它含用户原话、根因、目标样例、
四条硬约束、两条反向半边与四处头像位置，足以执行）。本文即该规格的实施记录，
写在 `inScope` 指定的 `docs/UI-DEFECT-V4.md` 上。

---

## 5. ★ 本机**量不到**的部分（不声称验证过）

臂 33 / 33b / 33c / 33d 用**真实 headless Chrome** 量成员行布局。
本机 `launchChrome()` 的 promise **不 resolve**（`tests 4 / pass 0 / fail 0`），
**干净树实测相同** ⇒ 非本轮造成。

⇒ **我没有验证过真实渲染。** 本轮只保证：
- 两块的**切分**是纯函数（`splitStageGroups`），8 个变异体钉住；
- `○`/`⊘`/`✓` 的**颜色规则**在 CSS 源里逐条比对（M3 钉住"两者不同色"）；
- **"在 360px 容器里两块是否真的不溢出"需要浏览器** —— 留给能跑 Chrome 的环境。

★ 另：本轮**改了 captain 节点的网格列数**（3→2、窄态 2→1）。那**只**是静态 CSS，
但"列数改了之后窄面板里不换行、不溢出"同样**需要浏览器**确认。

---

## 6. 改动清单

```
src/client/MemberRow.tsx            ① 删旧轮次块、按钮并入行 2、探针保留；② splitStageGroups / stageGroupCount（**就地**）+ 两块渲染
src/client/CaptainNode.tsx          ③ 去头像显示 + 去空壳 + 去 import
src/client/AgentTeamsCard.tsx       ③ 去头像显示 + 去 import（memberArtUrl 仍用，保留）
src/client/TeamChatEntry.tsx        ③ 去头像显示 + 去 import
src/client/ActivityPanel.tsx        ③ 删**死** import（核查后确认不渲染）
src/client/ActivityPanel.module.css ② ○/⊘ 分色 + 两块样式；③ captain 网格去头像列；①行2 任务按钮样式
src/client/locales.ts               zh + en：新增 2 条（ran/silent 摘要）；noVerdicts **仍被使用**
lib/**（对应产物）+ lib/git-artifact-stamp.json
docs/UI-DEFECT-V4.md                本文
```

**未动**：`src/gates/**` · `src/state.ts` · `src/types.ts` · `src/tools/**` · `scripts/**` · `src/client/artwork.ts`。

## 7. ★ 我第二次**越界**，闸门又拦对了（如实记下）

我第一版把 `splitStageGroups` / `stageGroupCount` 写进了 **`src/client/activity-model.ts`**，
并顺手改了 `doingLineCandidates` 的签名 —— 提交时被闸门拒了：
`src/client/activity-model.ts is undeclared`。

★ **闸门是对的**：t80 的 `inScope` **没有** `activity-model.ts`（它在 t79 的写域里）。

★ 更正方式不是"补一条许可"，而是**把改动搬回写域**：
- `splitStageGroups` / `stageGroupCount` **就地**住在 `MemberRow.tsx`（inScope 内）；
- `doingLineCandidates` 的签名**不动**（`activity-model.ts` 已 `git checkout` 还原，`git diff` 为空）；
- 轮次改由**调用方**渲染后替换：行 2 的候选串首段**按位置**换成
  `t('member.round.mark', …)` 的结果。

★★ **替换按"位置（首段）"而不是 `startsWith('第 N 轮')`** —— 因为夹具的 `t` 桩返回的是
`member.round.mark:2`，按字面匹配会**匹配不上、静默不替换**；而"没替换"与"替换了"
在屏幕上同形，正是本仓纪律要挡的那一类。我第一版就是这么写的，臂 25b 报红后才看出来。

⇒ 最终改动 **20 条路径，逐条都在 inScope 内**（实测 `git status --short` 与 inScope 对拍）。

★ 两次越界（t79 的 `MemberScreen.tsx`、t80 的 `activity-model.ts`）**根因相同**：
我先按"哪个文件放这段逻辑最自然"去放，**然后**才去核 inScope —— 顺序反了。
正确顺序是**先核写域、再决定落点**。
