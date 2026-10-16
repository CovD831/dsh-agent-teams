# 吸收上游 #161 的 S1：判决落盘时记下「它绑定了哪些字节」

> **上游**：`648fd9a`（v0.1.23）。★ 该提交**在本仓可读**（`git show 648fd9a`），
> 所以本次吸收照的是**上游的真实代码**，不是转述。
> **基线**：HEAD `f5d6722`（`git merge-base --is-ancestor 71790be HEAD` ⇒ **IS ancestor** ✅）。
> **对照基线**：`pnpm test:gates` ⇒ **16 个失败文件 / 1509 tests**。

---

## 1. 缺陷（上游 #161 原文）

> 「A **passing review was not bound to the revision it judged**……
>   it advertised "all gates passed" over **bytes that had since been edited or deleted**.」
>
> 「★★ A verdict that **predates content binding** is reported as an **unauditable gap**
>   rather than **being read as a pass over the current bytes**.」

**MEASURED（t97 开工）**：本仓此前有 `baseRevision`，而它是 **git 对象名**
（`tools.ts` 注释逐字：「base 是一个 git 对象名」）——
★ 它**回答不了"漂了没有"**：`cherry-pick` / `rebase` 会改那个名字而**字节没变**
（T7 的教训）⇒ 它在**两个方向上**都可能误判。

---

## 2. 改了什么（**只做 S1**）

| # | 改动 | 位置 |
|---|---|---|
| ① | `ReviewedArtifact`（`{path, digest}`）· `ArtifactDigest` · `ArtifactScopeGap` · `VERDICT_KINDS` | `src/types.ts` |
| ② | `TeamTask.reviewedArtifacts?: readonly ReviewedArtifact[]` | `src/types.ts` |
| ③ | **新增** `src/artifacts.ts` —— 插件里**唯一**读产物字节的模块（`sha256`） | `src/artifacts.ts` |
| ④ | 判决落盘时**快照绑定**（只对 `VERDICT_KINDS` 那三类） | `src/tools/update-task.ts` |
| ⑤ | `ArtifactBinding`（三态）+ `artifactBindingOf(...)` —— **回答那三个问题** | `src/quality-gates.ts` |
| ⑥ | `DeliveryAudit { artifacts?, gaps? }` —— 审计的**输入面** | `src/quality-gates.ts` |
| ⑦ | `DeliveryResult.verdictBindings` —— 逐条判决的三态读数 | `src/quality-gates.ts` |

★★ **`ArtifactDigest`（当前读到的）与 `ReviewedArtifact`（判决落盘时记下的）形状相同
而语义相反** —— 恰如 `before`/`after`。★ **不合成一个名字**：合成会让
"记下来的"与"读出来的"在读取端同形，而那正是这套机制要防的事。

### ★★ `VERDICT_KINDS = ['review', 'requirements', 'verification']`

★ 判据是**语义的**：一次"完成"是不是在说「**这批字节**行不行」？

| kind | 是判决吗 | 为什么 |
|---|---|---|
| `review` · `requirements` · `verification` | ✅ | 它们判的是"被审的那批字节行不行" |
| `implementation` · `repair` · `integration` · `work` | ❌ | 完成是"**我把活干了**"，不判决任何字节 |

★ 给非判决类也记一份绑定是**造一个不存在的语义**（"这次研究绑定了哪些字节"没有意义）。

---

## 3. ★★★ 一条必须写进注释的后果（用户已据它批准）

```
今天盘上的判决【都没有】 reviewedArtifacts（本格是本次新加）
⇒ 它们无法回答"我判的是哪批字节"
⇒ 按上游口径必须被报成「【早于内容绑定】」（unbound / unauditable gap），
   ★ 【而不是】被读成"对当前字节的一次通过"
```

★★ **那【是正确行为】，不是 bug** —— 它变严，是因为此前它在**读一个它没有的信息**。
★ 别在事后把这条判据说成"突然变严"：它只是**第一次说真话**。

⇒ ★★ **这个后果已逐字写进 `TeamTask.reviewedArtifacts` 的注释**（见 `src/types.ts`），
而下一个人看到"交付判据变严"时能从那里知道**为什么**。

---

## 4. 三态（★ 三态必须不同形）

| 取值 | 什么情况 | 补救动作 |
|---|---|---|
| `bound` | 有摘要，且**当前字节与它一致** | 无需动作（判决仍有效） |
| `drifted` | 有摘要，而**字节已变**（含**已删除**） | 重判 —— 那次判决说的是**另一批字节** |
| `unbound` | **根本没有摘要**（早于内容绑定） | ★ **不能读成通过** —— 它判的是不可知的东西 |

★★ `unbound` **不是** `drifted` 的一个特例：
`drifted` 说"我判过那批字节，而它们变了"（**知道**）；
`unbound` 说"我不知道它判的是什么"（**不知道**）。
⇒ 把后者塞进前者会**造出一个没发生过的绑定**。

---

## 5. 反向半边（7 臂，实测）

```
$ node --test scripts/gate-verdict-artifact-binding.test.mjs
✔ ★★ 臂 1（A）：【没有】 reviewedArtifacts 的判决 ⇒ unbound，不许被当作 sound
✔ ★★ 臂 2（B）：有 reviewedArtifacts 而【字节已变】⇒ drifted（含"已删除"）
✔ ★★ 臂 3（C）：有 reviewedArtifacts 且【字节未变】⇒ bound（不许把所有带摘要的都判成 drifted）
✔ ★ 臂 4：摘要是确定性（同一批字节 ⇒ 同一摘要，可复跑）
✔ ★★ 臂 5：符号链接不得变成读宿主机任意文件 —— 逃出工作区即拒并记 gap
✔ ★★ 臂 6：audit.artifacts 传进 canDeclareDelivery ⇒ 逐条判决的三态可读
✔ ★ 臂 7（前提臂）：VERDICT_KINDS 只含判决类
```

### ★★ 臂 3 挡的是**最省事的错法**

「有摘要就报 drifted」是恒报 —— ★ 与「什么都判不了」在**补救动作**上同形
（都会让人去重做一次本来没问题的活）。⇒ 所以字节一致时**必须**报 `bound`。

### ★★ 臂 5 是**安全**规则，不是性能优化

① 逃出工作区的路径 ⇒ 拒 + **记一条显式 gap**（★ 一份**静默省略**的清单会让"没读到"读成"没变"）；
② 目录遍历**不跟符号链接**（否则一个环会变成无限遍历）。

---

## 6. ★★ 对照组：三个变异体，全部被检出

| 变异体 | 改法 | 结果 |
|---|---|---|
| **A** | 缺席**不再**报 `unbound` | ✅ exit=1，**5 ✖** |
| **B** | **不再**检测漂移（`now !== digest` 短路） | ✅ exit=1，**5 ✖** |
| **C** | **恒报** `drifted`（`bound` 那行改成 `drifted`） | ✅ exit=1，**7 ✖** |

★ 变异体 C 是关键：它**放过**臂 1/4/5/6 的一部分，而 **臂 3 抓住的正是它** ——
⇒ 没有臂 3，"判据退化成恒报"**在报告里与成功同形**。

---

## 7. 净变化

```
$ pnpm test:gates      # 对照：1509 tests / 16 文件    改后：1516 tests / 16 文件
$ diff <(对照失败文件集) <(改后失败文件集)
（无输出）
```
★ **用集合判定**：**逐条相同** ⇒ **净新 0、净减少 0**。
★ 而 **+7 tests** 正是本夹具的 7 臂 ⇒ **实证它真的进了跑者**
（命名符合 `scripts/gate-*.test.mjs` 那个 glob，无需改 `package.json`）。

---

## 8. ★ 本任务【不做】的（边界，逐条对照任务书）

```
❌ 不搬那六个符号的完整实现（verdictDrift / bindsRecordedRevision / unboundVerdict /
   ArtifactDriftDetail / 判据分级）—— 那是 S3
❌ 不做 blocker/warning 分级 —— 那是 S4
❌ 不搬 blob 级 diff 对比（上游的 ArtifactDriftDetail 更复杂）
❌ 不搬 expandedScope（上游 DeliveryAudit 的第三格）
   ★ 理由：它属于"用范围去发现未审路径"，那是 S3 的判据输入面
```

★ 而 `verdictBindings` **不参与 `ok`** —— S1 只"回答那三个问题"。
★ 拿它拦交付是 S3/S4（那会改既有交付语义，而本任务的硬纪律是
「不许改既有判据的 verdict 语义」）。

---

## 9. 局限（如实留白）

1. ★★ **`verdictBindings` 只在传了 `audit` 时出现**，而**当前没有任何生产调用方传它**
   （`canDeclareDelivery` 的调用方在 `src/state.ts` → `src/tools/status.ts`，**两者都不在本任务 inScope**）。
   ⇒ ★ **S1 交了"能回答"的能力，但那条线还没接上** —— 接线点应落在 status 那条路上，
     而它**不在本任务写域**（同 t87 记过的形态：**机制建好了 ≠ 接线了**）。
2. ★ **`reviewedArtifacts` 的写入只在 `update-task.ts` 的终态更新路径上**。
   ★ 而**历史判决**（今天盘上那些）**永久**是 `unbound` —— 那是设计，
     不是遗漏（§3）。★ 若要给它们补绑定，那**做不到**：字节早已不是当时那批。
3. ★ **摘要只覆盖 `inScope`（退化时为 `changedPaths`）** ——
   ★ 一条判决**实际看过的**文件可能超出它声明的范围（那正是上游 `expandedScope` 要解决的）。
   ⇒ 今天"范围外被改"**检测不出来**，如实记下。
4. ★ **未测真实的一轮**（真跑 `update_task` 判一次 pass，再看盘上字段）——
   §5 臂 6 驱动的是真实的 `canDeclareDelivery` 与真实的 `snapshotReviewedArtifacts`，
   而「工具 → 落盘」那一段靠**代码位置 + `tsc`** 保证，**未实测**。
5. ★ **`MAX_EXPANDED_ARTIFACTS = 200` 是承重的**：超过它只记 gap **不阻断** ——
   若一个大范围被判为"绑定了"而其实只绑了前 200 个，那是**已知的截断**。
   ★ 而被截断这件事**有账**（`gaps`），所以它不会被静默读成完整。

---

*本文件只写 `docs/UPSTREAM-ABSORB-S1-ARTIFACT-BINDING.md`。*
