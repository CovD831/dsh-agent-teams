# 吸收上游 #183：推导侧与闸门侧共用同一个排除谓词

> **上游**：`648fd9a`（v0.1.23，标题含 `keep contracts satisfiable`）。★ 该提交**在本仓可读**
> （`git show 648fd9a`），所以本次吸收是**照上游的真实代码**做的，不是照转述。
> **基线**：HEAD `8448863`（`git merge-base --is-ancestor 71790be HEAD` ⇒ **IS ancestor** ✅）。
> **对照基线**：`pnpm test:gates` ⇒ **16 个失败文件 / 1498 tests**。

---

## 1. 缺陷（t95 开工在本仓复现）

```
repairScopeFromFindings([{ file: 'secrets/k.json' }, { file: 'src/a.ts' }])
  ⇒ 推导出的 inScope = ["secrets/k.json","src/a.ts"]
★ 而闸门对第一条的裁决 = `out_of_scope`
⇒ ★★ 一条路径被【写进】 inScope，而闸门仍然判它 out_of_scope
⇒ ★★★ 【契约自身不可满足】—— 成员无论怎么做都过不了，于是死锁。
```

而行上那段既有注释（`quality-gates.ts:1661`）逐字是：
> 「Keep all derived paths until the generator resolves inherited exclusions;
>   filtering first would silently discard a required fix target.」

★ **方向是对的，但只做了一半** —— 它说"等生成器去解析排除"，而
**生成器从来没有做那个解析** ⇒ 被排除的路径原样进了 `inScope`。

★★ 而根因**不是"两份谓词"**（本仓只有一份 `isDefaultExcluded`），而是
**推导侧根本没用它** —— 那一侧自己收集路径，**从不问闸门**。
⇒ 这正是上游说的 "**Derivation and gate now share one**"。

---

## 2. ★ 一处必须更正任务书的地方（实测）

任务书写「`.agent-teams/foo.json` ⇒ `out_of_scope`（★ 而它正被推导进 inScope）」。
**实测：本仓的谓词里【没有】`.agent-teams`** ——
```
$ grep -n "agent-teams" src/quality-gates/predicates.ts    # 空
$ classifyChangedPath('.agent-teams/foo.json')             # ⇒ 'undeclared'（不是 out_of_scope）
```

★ 而上游 `648fd9a` 的那一行**恰好加了它**：
```diff
-  if (segments[0] === '.git' || segments[0] === '.dsh') return true
+  if (segments[0] === '.git' || segments[0] === '.dsh' || segments[0] === '.agent-teams') return true
```

⇒ ★★ **所以本次一并补齐**（不是可选）：契约生成器**不该走进** `.agent-teams/`
（那是台账/状态目录），而"它是否被排除"这件事**只有谓词说了算**。
★ 用**真实的被排除路径**（`secrets/k.json`）复现缺陷同样成立 ⇒ **缺陷本身不变**，
只是任务书举的那个例子在本仓当时读数是 `undeclared`。

---

## 3. 改了什么（照上游形状）

| # | 改动 | 位置 |
|---|---|---|
| **①** | `isDefaultExcluded` → **`isDefaultExcludedPath`（导出）**；旧的私有名保留为**一行转发**（同一个函数体，不是第二份） | `predicates.ts` |
| **②** | 谓词里补 `segments[0] === '.agent-teams'` | `predicates.ts` |
| **③** | 新增 `findingDerivedPaths(finding)` —— 一条 finding 的**全部候选路径（排除规则之前）** | `quality-gates.ts` |
| **④** | `repairScopeFromFindings` **改用共用谓词过滤** | `quality-gates.ts` |
| **⑤** | 新增 `excludedFindingsOf(findings)` —— **每条**候选路径都被排除的那些 | `quality-gates.ts` |
| **⑥** | `PlanQualityFollowUpResult` 加 `reason?` + `excludedFindings?` | `quality-gates.ts` |
| **⑦** | 全部 finding 都被排除 ⇒ **升级并给理由**（而不是静默丢/死锁） | `quality-gates.ts` |

★★ **第 ③ 步为什么必须把"路径集合"与"排除判定"分开**：
两者揉成一个函数就只能得到"过滤后的结果"，而**分不出**
「它本来就没报路径」与「它报的路径全被排除」——
**两者补救动作相反**（前者是审查员漏填 `file`，后者要人裁决）。

---

## 4. ★★★ 反向半边（五臂，实测）

```
$ node --test scripts/gate-repair-scope-exclusions.test.mjs
✔ ★★ 臂 1（A）：被默认排除的路径【不许】出现在推导出的 inScope 里
      ℹ 推导出的 inScope = ["src/a.ts"]（5 条被排除的都没进去）
✔ ★★ 臂 2（B）：正常路径【必须】仍在 —— 不许把全部路径都滤掉
✔ ★★★ 臂 3（C）：每条候选路径都被排除的 finding ⇒【升级并给理由】，不许静默丢
      ℹ 升级理由：every finding of review-1 cites only default-excluded paths
         (secrets/k.json, .env); the completion gate classifies those out_of_scope
         by default, so no honest repair contract exists - a human must decide
✔ ★★ 臂 4：推导侧与闸门侧【用同一个谓词】—— 改排除规则时只有一处改
      ℹ 对拍 13 条路径：两侧结论**逐条一致**（9 条被排除）
✔ ★ 臂 5（前提臂）："契约自身不可满足"是可复现的
```

### ★★ 臂 4 的判据是**机械的**，而且**不需要知道排除名单**

它只要求「闸门说排除的，推导侧也必须排除」——**两侧结论逐条一致**。
⇒ ★ 将来**改规则**（加一条被排除的前缀）时本臂**照样成立**，
而一个"两侧各自分类"的实现会**当场红**。这正是"共用"的可核形态。

### ★★ 臂 5 是**前提臂**（防恒真）

它钉住「闸门**必须先看默认排除**」这条前提 —— 而臂 1 全靠它。
★ 若某天 `classifyChangedPath` 不再先看默认排除，**臂 1 就没有对象了**（会恒真）
⇒ 本臂当场红，提醒"该重审这个判据了"。

---

## 5. ★★ 对照组：证明这五臂**不是恒真**

`git stash` 掉全部修复（`--include-untracked`）+ 重建 + 跑同一夹具：
```
fixture exit=1   ⇒ ★ 5 臂里 4 臂变红：
  ✖ 臂 1（反向半边 A）
  ✖ 臂 3（反向半边 C）
  ✖ 臂 4（共用性）
  ✖ 臂 5（前提臂）
```
⇒ ★★ **同一夹具在修复前后一红一绿** ⇒ 它有分辨力。
★ 而**臂 2 在修复前也是绿的**，这是对的：它挡的是"把全部路径都滤掉"那种**更坏的修法**
（恒返回空能让臂 1 变绿，而臂 2 会当场红）。

---

## 6. 净变化

```
$ pnpm test:gates      # 对照：1498 tests / 16 文件    改后：1503 tests / 16 文件
$ diff <(对照失败文件集) <(改后失败文件集)
（无输出）
```
★ **用集合判定**：**逐条相同** ⇒ **净新 0、净减少 0**。
★ 而 **+5 tests** 正是本夹具的 5 臂（实证它**真的进了跑者**，不是躺在盘上）。
★ 夹具命名符合 `scripts/gate-*.test.mjs` 那个 glob ⇒ **自动收，无需改 `package.json`**。

### 既有行为不变（逐条核过）

```
$ git diff src/quality-gates.ts | grep -E "^[-+].*withoutScopeConflicts"
（无输出）                       ← ★ 一字未动
$ git diff src/quality-gates.ts | grep -E "^[-+].*outOfScope.some"
（无输出）                       ← ★ outOfScope 的处理一字未动
```

---

## 7. 局限（如实留白）

1. ★★ **只吸收了 #183，没有吸收 `648fd9a` 的另外三个缺陷**（#161 裁定绑定修订 /
   #174 工单陈旧标记 / #175 失败 verify 也开修复环）。
   ⇒ 那三个**不在本任务 inScope**，且它们各自带**独立的**行为改动与验收面。
   ★ 如实记下：**本仓与上游在那个提交上仍有差距**，而差距**不止 #183**。
2. ★ **`reason` 只有"全部被排除"这一处填**。上游还把 `reject` / 轮次上限那两处
   也换成了带 `reason` 的 `escalate(...)`（`648fd9a` 的 diff 里可见）。
   ⇒ 本次**没有**顺手改那两处：它们**不属于 #183**，且改它们会动到
   **既有升级路径的读数**（而"不许改既有行为"是硬纪律）。
   ★ 结果是：`reason` 在那些路径上**缺席** ⇒ 与"没有理由"不同形（缺席 = 没这一格）。
3. ★ **未测"修复后的任务在真实闸门下走完一轮"** —— 臂 3 走的是
   `planQualityFollowUp` 的真实路径，但那是一条**编排层**的函数；
   **没有**起一个真团队把它派下去跑。
4. ★ **`excludedFindings` 在"正常支"（还有 actionable）上只记账、不阻塞** ——
   那是刻意的（否则任何一条被排除的 finding 都会让整轮停下），
   但意味着**读的人要自己去看那一格**。★ 若将来要让它更显眼，应改的是**呈现层**，
   不是这里（那会越过"只吸收 #183"的边界）。

---

*本文件只写 `docs/UPSTREAM-ABSORB-183-EXCLUSIONS.md`。*
*改动：`src/quality-gates.ts` · `src/quality-gates/predicates.ts` · 新增一个夹具 · 对应 lib 产物与 stamp。*
