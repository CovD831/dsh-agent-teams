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

---

# 实施记录（t79，2026-10-16）

**基线**：HEAD = `1d7912c`（`git merge-base --is-ancestor 71790be HEAD` ✅）。
开工时 stamp `c4cbeaf` ≠ HEAD，**先 `pnpm build` 取新鲜基线**。
**写域**：`src/client/**` + `src/snapshot.ts` + 构建产物 + 本文。`src/gates/**`、`src/state.ts`、`src/types.ts` 一行未动。

## 0. 验收读数

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `npx tsc -p tsconfig.client.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0**（`lib/client.js` 351.70 kB） |
| `grep -n 'registry.list()' src/snapshot.ts` | **7 处命中**（转发本体在 `:253`） |
| `pnpm test:gates` | **1482 tests / 1424 pass / 20 fail / 16 文件**，失败**文件集合**与基线 `diff` 无输出 ⇒ **净新 = 0** |

★ 任务书给的基线是 `1482/1425/20/16`，我实测 **1424** —— 差 1。按净变化纪律**以本 HEAD 实测基线为准**，并如实记在这里。

## 1. 五条 ①–⑤ 的落点

| # | 规格 | 落点 |
|---|---|---|
| ① | 纵向两行式 | `MemberRow.tsx` 行 1 = 名字 + 角色 + 模型 + 状态短语 + 计时 + 箭头；行 2 = `第 N 轮 · 阶段 · 测试`（`.memberStageLine`） |
| ② | 简约/去徽章 | `ActivityPanel.module.css` 末尾新增 v4 一节（**整段覆盖**那套"头像+四列网格"皮肤，回滚只需删这一节） |
| ③ | 六态不同形 | `GATE_GLYPH`（`✓ ⊘ ● ○ · ✗`）单一表，逐条与段头**共用** |
| ④ | 每条显示 `description` | 展开态的 `memberStageRowDesc` 直接印 `registry.list()` 的 `description` |
| ⑤ | 转发 `registry.list()` | `src/snapshot.ts` 的 `gateCatalogForUi()` → 快照新增 `gateCatalog` 字段 |

## 2. ★★ 反向半边（两条 + **变异体实测**）

判据写成纯函数层（`lib/client/activity-model.js` 可直接跑，不需要浏览器）：
`stageGateRows` / `stageGroupState` / `taskStage` / `doingLineCandidates`。

- **A**（从未跑过 ⇒ 展开态**不许**有 `✓`）：`evaluation` 缺席时逐条一律 `registered`（○），
  实测 9 条全是 `○`，`✓` 计数 **0**。
- **B**（`skippedAll` 在场 ⇒ 必须 `⊘`）：逐条与整段都实测为 `⊘`；对照臂（全 `ok`）实测为 `✓`
  ⇒ **`⊘` ≠ `✓` 且两者都真的会出现**（否则上面全是恒真）。

### ★★★ 变异体实测（证明判据**有分辨力**，不是"拆了个恒等的"）

对 `src/client/activity-model.ts` 逐个注入变异体、重新 `pnpm build`、跑同一份判据：

| 变异体 | 含义 | 被检出 |
|---|---|---|
| M1 `skipped ⇒ passed` | **`c4cbeaf` 的合流复活** | ✅ FAIL=2 |
| M2 `registered ⇒ passed` | **破坏反向半边 A** | ✅ FAIL=3 |
| M3 非 completion 段也读裁决 | **越过甲方案边界** | ✅ FAIL=1 |
| M4 `completed 无判据` 也报 `delivery` | 阶段推导错 | ✅ FAIL=1 |
| M5 `ok+observed ⇒ passed` | **观察模式折回"通过"** | ✅ FAIL=1 |
| M6 行 2 截断顺序反转 | 先省"阶段"而非"测试" | ✅ FAIL=3 |

**6/6 全部被检出。** 判据总数 **32 条**，全绿。

★ **两处我自己抓到的错**（如实记下，因为它们都是"看起来通了的假绿"）：
1. 我第一版反向半边 B 的**辨识力探针**写成 `check(..., true, ...)` —— 那是一条**恒真**断言，
   它不可能证明任何事。已改成真的跑两半：①只有 `skippedAll`、②只有 `verdict:'skipped'`。
2. 收紧后我发现 `stageGroupState` / `gateRunState` 里的 `skippedAll` 支**在真实线上形状下是冗余的**
   （全跳过时每条 `verdict` 本来就是 `'skipped'`，`registry.ts:681` 逐字写着）。
   ⇒ 它是**防御支**（旧宿主 / 形状漂移），不是主路径。这条区别被写进了测试注释。
3. 反向半边 B 的第一版夹具用了 `verdict:'blocked', observed:true` —— 那走的是**另一支**，
   M5 因此**没被检出**。补上 `verdict:'ok', observed:true` 这一条（线上真实存在的形状）后 M5 才被钉住。

## 3. ★★ 保留的探针：去掉**装饰**不许丢掉**事实**

改头像那一块时，`data-unread` 与被 v4 取代的三个旧探针
（`data-member-gate` / `-state` / `-readout` `/ -tone` / `data-verdict` / `data-observed`）
会**随 DOM 一起消失**。臂 27 逐条比对渲染出的 `data-*`，**当场报红**（改前它是绿的，我实测过）。

★ 处置：**同名探针以别名保留在行/段上**，而不是去 `scripts/` 里登记"有意删除"（那越界）：
- `data-unread` ⇒ 行 1 上一个 4px 点（`.memberUnread`）；
- `data-member-gate` / `-state` / `-readout` ⇒ 段 `<li>` 上（形状换了承载，事实同一件）；
- `data-verdict` / `data-observed` ⇒ 逐条 `<li>` 上（`data-observed` 仍是**缺席而非 false**）；
- `data-member-gate-tone` ⇒ 成员块上，由新函数 `memberGateTone()` 用**旧词表**推出
  （`absent/ok/skipped/observed/unmeasured`，不发明新词；`registered`/`pending` ⇒ `absent`，
  因为"还没有任何裁决"**不是** `ok`）。

⇒ 结果：**臂 25a / 26 / 27 全绿**（10/10），且**没有改 `scripts/` 一个字**。

## 4. ★ `artwork.ts` 核查结论：**不是死模块**，`ACTION_ART` 也**不能删**

规格 §7 要求核查。实测：
- `artwork.ts` 仍被 **4 个组件** import（`LEAD_ART`）：`ActivityPanel` / `AgentTeamsCard` / `TeamChatEntry` / `CaptainNode`；
  且 `memberArtUrl` 被 `AgentTeamsCard` 与 `scripts/verify.mjs:74` 使用 ⇒ **模块活着**。
- `ACTION_ART` 在 `src/` 里**确实只剩自己的声明**（我删掉头像那处是它唯一消费者），**但它不能删**：
  `scripts/verify.mjs:353` 断言 `artworkSource` 包含**每一个**打包图（含 6 个 `action-*.png`），
  而那 6 个名字**只在 `ACTION_ART` 里**出现（`src/index.ts:624` 的宿主白名单是另一份镜像）。

⇒ 删了它会红一条 **host 侧的打包契约**，而那条契约不在本任务写域。
⇒ 结论：**保留**，并在代码注释里写明"为什么它看着没用却必须留着"。

## 5. ★ 本机**量不到**的部分（如实报出，不声称验证过）

臂 33 / 33b / 33c / 33d 用**真实 headless Chrome** 量成员行布局。
实测本机 `launchChrome()` 的 promise **不 resolve**（`tests 4 / pass 0 / fail 0`），
且**干净树上同样如此** ⇒ 非本轮造成。

⇒ **我没有验证过真实渲染**。规格 §2 的宽度读数（行 1 最长 119 vs 286、行 2 最长 248 / 346）
来自队长在能跑 Chrome 的环境里的实测；本轮**只保证**：
- 行 2 的截断是**按优先级**做的（`doingLineCandidates`，变异体 M6 钉住顺序）；
- 逐条/段头的 `id`、`description`、符号都带 `overflow: hidden; text-overflow: ellipsis`，
  即**溢出被省略号吸收**而不是撑破（CSS 静态可读）。
- ★ 而 `overflow` 是否真的生效**需要浏览器**才能确认 —— 这一条**留给能跑 Chrome 的环境**。

## 6. 改动清单

```
src/snapshot.ts                     + gateCatalogForUi() / TeamActivityGate(Catalog) / 快照字段（t78 同构转发）
src/client/activity-model.ts        + 阶段推导 · 六态 · 阶段分组 · 行2候选 · memberGateTone（纯函数）
src/client/MemberRow.tsx            纵向两行式 · 去头像块 · 展开态按阶段分组 · 旧探针别名
（`MemberScreen.tsx` **未改** —— 它不在 inScope，见 §7）
src/client/locales.ts               zh + en 各 3 条（判据清单/条数/不落盘）
src/client/ActivityPanel.module.css + v4 一节（两行式皮肤 + 3.5px 点 + 语义色 + #2b3036 细线）
lib/**（对应产物）+ lib/git-artifact-stamp.json
docs/UI-REFACTOR-V4.md              本节
```

**未动**：`src/gates/**` · `src/state.ts` · `src/types.ts` · `src/tools/**` · `scripts/**` · `src/client/artwork.ts`（见 §4）。

## 7. ★ 一处**越界**与它的更正（如实记下）

我第一版把判据清单做成 `MemberRow` 的 prop，于是去改 `MemberScreen.tsx` 传它 ——
**提交时被闸门拒了**：`src/client/MemberScreen.tsx is undeclared`。

★ **闸门是对的，我读错了任务书**：t79 的 `inScope` **没有** `MemberScreen.tsx`
（它在 **t72** 的 inScope 里，而我把两轮记混了）。

★ 更正方式不是"补一条许可"，而是**去掉这次越界的必要性**：
`MemberRow` 本来就**拿到了 `team`**（它就在 props 上），所以判据清单**就地读**
即可 —— 新增 `gateCatalogOf(team)` 住在 `MemberRow.tsx`（inScope 内），
`MemberScreen.tsx` **一行未改**（`git diff` 为空）。

⇒ 最终改动 **17 条路径，逐条都在 inScope 内**（实测 `git status --short` 与 inScope 对拍）。

★ 这一条值得留下：**"多一跳 prop"不只是风格问题** —— 它在这里**把改动推出了写域**。
改成就地读之后，既少了接口，也不再越界。
