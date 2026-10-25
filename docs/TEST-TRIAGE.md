# 测试基线归因（t4）

> **本文是诊断，不是修理。** 本轮**没有改动任何 `scripts/`、`src/`、`lib/` 文件**。
> 每一条结论都附**可复跑命令**与**原始读数**。
>
> 起点：分支 `task-mutation-integrate`，HEAD `b8f357e`（工作树里 `lib/git-artifact-stamp.json` 有 1 行未提交改动，与本报告无关）。
> 对照：pristine `main` = `323f104`，在 `.triage-main/` 里用 `git worktree add --detach` 独立抽出（`node_modules` 软链进主树，**源码零改动**）。

---

## 〇、一句话结论

| # | 失败文件 | 分类 | 一句话 |
|---|---|---|---|
| 1 | `gate-contract-build-artifacts` | **pin 合理** | 存量，pin 与实测一致 |
| 2 | `gate-input-wiring` | **pin 合理** | 存量，两条臂各有一条 pin |
| 3 | `gate-producer-consumer` | **pin 过期（读数漂移）** | pin 写「实测 21」，实际 **26** |
| 4 | `gate-repair-completion` | **pin 合理，但 pin 文本落不进任何成因类** | 存量归因成立；分类学缺陷在 pin 的措辞，不在断言 |
| 5 | `gate-source-reading-convention` | **pin 合理** | 全仓普查臂，随夹具增长而漂 |
| 6 | `gate-falsification-pairs` | **真存量（main 也红），非本分支引入** | 注册表 3 条判据既无对照对也无理由 |
| 7 | `gate-reviewed-passthrough` | **臂过期（断言腐化）** | 它**自己写着**「t11 落地后本条该被删掉/改成已连接」 |
| 8 | `gate-stale-module` | **臂过期（断言腐化）** | 正则 `OLDER than…`，产品现在写 `OLDER **build** than…` |
| 9 | `gate-worktree-arrival` | **臂过期（断言腐化）** | 正则 `task-t-impl`，目录现在叫 `task-team-t-impl` |
| 10 | `gate-baseline-known-failures` | **真实缺陷（清单自洽）** | 臂 6：1 条 pin 的 `because` 落不进任何已知成因类 |
| 11 | `gate-t1-completion-probe` | **环境 / 夹具加载面 —— 不是本分支引入的源码回归** | 臂 5 断言的**目标记录**被一次**跨团队的同名 id 写入**污染；main 上「绿」是因为 `team.json` **不在盘上**，臂被 `t.skip` 跳过了 |

★★ **对起点读数最重要的一处更正**：队长把 `gate-t1-completion-probe` 判为「本分支新引入的真实回归」，依据是「main 上 fail=0，HEAD 上 fail=1」。
**该依据不成立** —— 见 §2。这个文件的断言**在 main 与 HEAD 上逐字相同**（`git diff` 为空），它 main 上绿是因为**前置不满足而跳过**。

---

## 一、总读数（两个树，同一命令）

```
命令：node --test scripts/gate-*.test.mjs
```

| 树 | ℹ tests | ℹ pass | ℹ fail | ℹ skipped | exit |
|---|---|---|---|---|---|
| HEAD `b8f357e` | 1062 | 1031 | **11** | 20 | 1 |
| `main` `323f104`（`.triage-main/`） | 1053 | 1022 | **10** | 21 | 1 |

**失败文件集合的差集**（`comm` 逐行比对）：

```
只在 HEAD 出现：scripts/gate-t1-completion-probe.test.mjs
只在 main 出现：（无）
其余 10 个文件两边都有
```

⇒ 净变化：**tests +9 / pass +9 / fail +1 / skipped −1**，且那 +1 我已独立证伪为「源码回归」（§2）。

`npx tsc -p tsconfig.json --noEmit` ⇒ **exit=0**（与起点一致）。

---

## 二、★ `gate-t1-completion-probe` 的根因（推翻了起点的分类）

### 2.1 判据（先写清口径，再给读数）

问题：臂 5 的那条断言红了，是「**臂的期望过期**」还是「**产品真坏了**」？

我采用三条**互相独立**的判据，全部满足才允许说"不是回归"：

- **判据 A（同一性）**：heads 与 main 上，**被测断言本身**是否逐字相同？（若相同，则"main 绿"不可能来自源码差异。）
- **判据 B（可达性）**：main 上那条断言**到底跑了没有**？——「跳过」与「通过」必须不同形。
- **判据 C（成因）**：被断言的那一格，是**谁**、**什么时候**写的；那个写者是否**有权**写它？

### 2.2 实测读数

**判据 A —— 断言逐字相同：**

```
$ git diff 323f104 b8f357e -- scripts/gate-t1-completion-probe.test.mjs
（空输出）
```

⇒ 该文件在两个树上**逐字节相同**。于是「main 绿 / HEAD 红」**不可能**由这个文件造成。

**判据 B —— main 上它是「跳过」，不是「通过」：**

```
$ node --test scripts/gate-t1-completion-probe.test.mjs        # 在 HEAD 上
ℹ tests 7
ℹ pass 1
ℹ fail 1
ℹ skipped 5
✖ ★ 臂 5：`resolveBaseRevision` 的两条来源与两个"没有"的成因**不同形**
  AssertionError: ★ t1 的记录里【不该】有 baseRevision…
  true !== false
    at scripts/gate-t1-completion-probe.test.mjs:898:10
```

```
$ cd .triage-main && node --test scripts/gate-t1-completion-probe.test.mjs   # 在 pristine main 上
  [t13] （unified-pipeline 的 team.json 不在盘上 ⇒ t1 那一半跳过）
✔ ★ 臂 5：`resolveBaseRevision` 的两条来源与两个"没有"的成因**不同形** (49.5ms)
ℹ tests 7
ℹ pass 2          ← ★ 注意：臂 5 的 t1 那一半【整体跳过】了，剩下那一半绿
ℹ fail 0
ℹ skipped 5
```

★★ **决定性对照**：在**同一个 pristine main 源码**上，只把 state 目录接到眼前（软链，源码一字未动）：

```
$ cd .triage-main
$ ln -sfn ../../agent-teams-dev/.agent-teams/unified-pipeline .agent-teams/unified-pipeline   # 只为让前置可达
$ node --test scripts/gate-t1-completion-probe.test.mjs
✖ ★ 臂 5：… (49.2ms)
  AssertionError: ★ t1 的记录里【不该】有 baseRevision…
  true !== false
    at scripts/gate-t1-completion-probe.test.mjs:898:10
✖ failing tests: 1
```

⇒ **同一份 main 源码：前置不可达 ⇒ `fail 0`；前置可达 ⇒ `fail 1`。**
⇒ 「HEAD 引入真实回归」这个推论，其**唯一证据**是「main 上 fail=0」——而那个 0 来自 `t.skip`，不是来自断言通过。

**判据 C —— 那一格是谁写的：**

```
$ node -e "…读 .agent-teams/unified-pipeline/team.json…"
t1.baseRevision = 2ecd49860591f3c8e939784a44b170f397d87333
t1.updatedAt    = 1791887402289  (2026-10-13T18:30:02 GMT+0800)
t1.status       = completed · t1.kind = implementation · t1.attempt = 10
t1.revisions    = 只有 1 条：2026-10-08 14:53:21 by captain（fields: objective/acceptance/inScope）
```

★ 关键：`2ecd498` 是 **2026-10-13 14:35** 的提交（「chore: refresh the artifact stamp so it names 12d822b」），
而 t1 `updatedAt` 是 **同日 18:30**。所以那次写入**晚于** `2ecd498` 三个多小时 —— 它写的是一个**当时正确**的父版本。

再看**写者**（`src/tools.ts:285-319`）：

```ts
async function persistTaskBaseRevision(taskId: string, base: string, stateRoot: string): Promise<void> {
  const root = stateRoot
  let teamIds = (await readdir(root, { withFileTypes: true }))…       // ★ 枚举 stateRoot 下【所有】团队
  for (const teamId of teamIds) {                                     // ★ 逐个团队
    await withTeamLock(teamLockKey(root, teamId), async () => {
      const fresh = await readTeam(root, teamId)
      if (fresh === undefined) return
      const task = fresh.tasks.find((candidate) => candidate.id === taskId)   // ★ 只按【裸 taskId】匹配
      if (task === undefined) return
      record['baseRevision'] = base                                    // ★ 写进【每一个】同名任务
      task.updatedAt = Date.now()
      await writeTeam(root, fresh)
    })
  }
}
```

`src/tools.ts:267-271` 的注释说明了「为什么要查所有团队」：`onWorktree` 回调只拿到 `taskId`，**不知道它属于哪个团队**。⇒ 于是它**扫全部团队、按裸 id 匹配**。

**实测的后果**（`.agent-teams/` 下**三个**团队各有一条 `id === 't1'` 的任务）：

```
$ node -e "…遍历 .agent-teams/*/team.json，找 id==='t1'…"
team agent-teams-hardening  task id=t1  base=2ecd498  updated=2026-10-13T10:30:02.098Z
team mutation-quality       task id=t1  base=2ecd498  updated=2026-10-13T16:37:33.955Z
team unified-pipeline       task id=t1  base=2ecd498  updated=2026-10-13T10:30:02.289Z
```

`agent-teams-hardening/t1` 与 `unified-pipeline/t1` 的 `updatedAt` **相隔 191 毫秒、同一秒** ⇒ 这是**同一次写入**的两个落点。
⇒ 一次针对「hardening 团队 t1」的派发，把 base **同时写进了 unified-pipeline 团队的 t1** —— 那是**跨团队的同名 id 串写**。

### 2.3 裁定

★★★ **本轮不做修改（任务要求只判不定修），但归因是明确的，且它【不是】"本分支引入的源码回归"：**

| 问题 | 答案 |
|---|---|
| 是「臂的期望过期」吗？ | **不完全是。** 臂 5 的期望（`t1` 记录里不该有 `baseRevision`）在 **2026-10-08** 是真的；它现在**不再是**真的，但**不是因为它过期于"有意改掉的口径"**，而是因为**一条外来写入落进了它的读数域**。 |
| 是「产品真坏了」吗？ | **这里有一条真实缺陷**，但它**不是**在 t1-completion-probe 被引入的，也**不是** `b8f357e` 引入的。它是 `persistTaskBaseRevision` 的**跨团队同名 id 串写**。该函数由 `981cb4f`（2026-10-10）定形，本分支**未改它**。 |
| 那 main 上为什么绿？ | **因为前置不可达**：`.triage-main/` 里没有 `.agent-teams/`（它被 `.gitignore:4` 忽略，worktree 抽不出来）⇒ `existsSync(teamFile)` 为假 ⇒ 臂 5 的 t1 那一半 `return`（**静默**跳过，不是 `t.skip`）。 |

★ 所以「main: fail=0」这条证据**测的是"state 目录不在盘上"**，不是「这条断言在 main 上成立」。

**可核判据汇总（三条各自独立，全部实测）：**

1. `git diff 323f104 b8f357e -- <该文件>` = 空 ⇒ 源码无差异。
2. 同一份 main 源码，前置从不可达改为可达 ⇒ `fail 0` → `fail 1` ⇒ 绿来自跳过。
3. 三个团队各有一条裸 id `t1`；其中两条的 `updatedAt` 同秒 ⇒ 串写。

**建议（写进 §6「等裁定」）**：这条同时涉及**两件事**，**必须分开处理**：
- `scripts/` 侧：臂 5 用**真实仓库的 `.agent-teams/unified-pipeline/team.json`** 做断言 —— 那是一个**会随队友活动变化、且被 gitignore 的活状态**，不是不变量。用活状态做断言，正是这个仓反复记账的「会抖的量当断言」。
- `src/` 侧：`persistTaskBaseRevision` 的跨团队串写是一条**真缺陷**（写错了对象），但它**在 `src/`（本轮 out of scope）**，且**不是本分支引入的**。

---

## 三、11 条逐条：实测命令 + 原始读数 + 分类

> 每条的命令都在**单文件**粒度上跑（`node --test scripts/<file>.test.mjs`），并同时给 HEAD 与 `.triage-main/` 两个读数。

### 3.1 五条「已被 pin 覆盖」的

| 文件 | HEAD | main | 分类 |
|---|---|---|---|
| `gate-contract-build-artifacts` | `ℹ pass 22 ℹ fail 1` | 同 | **pin 合理** |
| `gate-input-wiring` | `ℹ pass 11 ℹ fail 1` | 同 | **pin 合理** |
| `gate-producer-consumer` | `ℹ pass 4 ℹ fail 1` | 同 | **pin 过期（读数漂移）** |
| `gate-repair-completion` | `ℹ pass 11 ℹ fail 1` | 同 | **pin 合理**（但 pin 措辞有分类缺陷，§4） |
| `gate-source-reading-convention` | `ℹ pass 5 ℹ fail 1` | 同 | **pin 合理** |

**① `gate-contract-build-artifacts` —— pin 合理**

```
$ node --test scripts/gate-contract-build-artifacts.test.mjs
✖ ★ 输入面臂：`execVerifyCommand` 缺席与在场 ⇒ 判据裁决不同形（★ 但要在【判据层】看）
  AssertionError: ★ 两次求值都要真的跑到两条判据（声明不许让判据被跳过）
  3 !== 2        at scripts/gate-contract-build-artifacts.test.mjs:593:10
ℹ tests 23 · pass 22 · fail 1
```
pin 逐字为「pristine a176e5d 上逐字复现（零改动 ⇒ 属【改动之前就存在】）」。
★ 我独立复核的方式不同（对 main `323f104` 而非 a176e5d）：**同红**。⇒ pin 的**属性**（存量）成立，**记账点**（a176e5d）是更早的快照。

**② `gate-input-wiring` —— pin 合理（两条 pin 各对一条臂）**

```
$ node --test scripts/gate-input-wiring.test.mjs
✖ ★ 臂 12：八处调用点【都不拒绝】—— 核对的裁决权是零（逐位置实测，不是读源码）
ℹ tests 12 · pass 11 · fail 1
```
★ 该文件**只红了 1 条臂**，而清单里给它挂了 **2 条 pin**（臂 12 + 「臂 4（历史缺口 ②）：verify 缺席」）。
⇒ 第 2 条 pin 指向的臂**现在是绿的** → 这是一条**多余的 pin**（见 §5 的记账）。

**③ `gate-producer-consumer` —— ★ pin 过期（读数漂移）**

```
$ node --test scripts/gate-producer-consumer.test.mjs
✖ 臂 4 ★★ 全仓读数（如实报出）：合格多少、不合格多少、判不了多少
  AssertionError: ★ "只有夹具消费"的产出涨到了 26（记账值 20：17 + worktree-reclaim 的两条 + verdictState）
ℹ tests 5 · pass 4 · fail 1
```
清单里那条 `because` 写的是：
> 「`fixtureOnly` 实测 **21** > 记账值 **20**」
而**实测现在是 26**。⇒ pin 的**结论**（存量、与清单改动无关）仍成立，但它**引用的数字已经过期 5 条**。
★ 这条 pin 自身就在演示它要防的形态：「手写清单」与「实测集合」靠人肉对齐必然漂（见该文件 `_repaired_at`）。

**④ `gate-repair-completion` —— pin 合理，但 pin 措辞掉出分类学（§4）**

```
$ node --test scripts/gate-repair-completion.test.mjs
✖ arm 9 — ★ FLIPPED (t33): the real path no longer reports the f-0020 wording
  AssertionError: ★ 接线后真实路径的下一道坎应当是 mutation（而不是 r5 的 none-of-zero）
ℹ tests 12 · pass 11 · fail 1
```

**⑤ `gate-source-reading-convention` —— pin 合理**

```
$ node --test scripts/gate-source-reading-convention.test.mjs
✖ ★★ 臂 1（★★ 核心臂）：全仓普查，把"多少处直接读 src/**、其中多少处该走统一口径"如实报出
ℹ tests 6 · pass 5 · fail 1
```
读数：实测 **18 处** `join('src', …)` 形态（`gate-fault-isolation`、`gate-known-baseline-loader`、`worktree-commit` … 等），期望 `[]`。
⇒ 全仓普查臂，**随别的任务新增夹具而漂** —— 与 pin 的说法一致。

### 3.2 四条「main 也红、未被 pin」的（含一条臂过期）

**⑥ `gate-falsification-pairs` —— 真存量（main 同红）**

```
$ node --test scripts/gate-falsification-pairs.test.mjs                       # HEAD
[j-0002 普查] 注册表 14 条判据 —— 有对照对 1 · 无法构造（附理由）10 · ★ 两者皆无 3
    ✗ contract.task-atomicity / ✗ dispatch.plan-reviewed / ✗ runtime.stall
✖ ★★★ 臂 2（普查臂）…   ℹ tests 5 · pass 4 · fail 1

$ cd .triage-main && node --test scripts/gate-falsification-pairs.test.mjs    # main
[j-0002 普查] 注册表 14 条判据 —— 有对照对 1 · 无法构造（附理由）10 · ★ 两者皆无 3
✖ ★★★ 臂 2（普查臂）…   ℹ tests 5 · pass 4 · fail 1
```
⇒ **逐字相同的读数**（14 / 1 / 10 / 3）。**不是本分支引入。**
★ 而这条**不该直接进 pin**：它报的是**三条判据缺对照对** —— 那是「该去修」的形状（补对照对，或把「无法构造」的理由补上），不是「与任何改动都无关的存量」。
⇒ 处置建议：**去修**（补 3 对 / 补 3 个理由），不要 pin。

**⑦ `gate-reviewed-passthrough` —— ★ 臂过期（断言里自陈）**

```
$ node --test scripts/gate-reviewed-passthrough.test.mjs
✖ ★★★★★ 臂 3：第三站那行【在源码里】，而它等的是 t11 —— 且那条等待**可核**
  AssertionError: ★★ 接收方（`CreateTaskInput`）已经声明了 `reviewed` —— 那说明 t11 落地了，
   而本任务那条"等待中的连接"应当被复核（本条臂随之该被删掉或改成"已连接"）
  true !== false      at scripts/gate-reviewed-passthrough.test.mjs:196:10
ℹ tests 5 · pass 4 · fail 1        # main 上逐字相同
```
★★ **这条红是"断言自己的注解要求的"**：它等的 t11 **已经落地**（接收方 `CreateTaskInput` 已声明 `reviewed`），
于是它**按设计**转红，并**逐字写明**「本条臂随之该被删掉或改成『已连接』」。
⇒ 分类：**臂过期（口径已变，臂未同步）**。
⇒ 处置建议：**改臂**（改成断言"已连接"，或删掉这条等待）。★ 但要注意：**这不是放宽断言** —— 是把「等待中的连接」改成「连接已建立」这条**更强**的性质（后者可证伪：把 `reviewed` 从 `CreateTaskInput` 拿掉 ⇒ 臂红）。

**⑧ `gate-stale-module` —— ★ 臂过期（正则与产品文案分叉）**

```
$ node --test scripts/gate-stale-module.test.mjs
✖ ★ 臂 10（三态在拒绝里也分形）：unknown **不得**说成 current；stale 那一态必须指向 reload
  AssertionError: ★ stale 必须明说自己旧
    expected: /OLDER than the one on disk/
       actual: 'this process is running an OLDER build than the one on disk (…) — … The fix is to reload the plugin (build, then restart the host).'
ℹ tests 24 · pass 23 · fail 1        # main 上逐字相同
```
★ 实测复算（直接调产品函数）：
```
$ node --input-type=module -e "import {moduleFreshnessMessage} from './lib/tools/shared/entities.js'; …"
/OLDER than the one on disk/        => false
/OLDER build than the one on disk/  => true
/reload the plugin/                 => true
```
⇒ 产品文案是 `OLDER **build** than the one on disk`（多了 `build` 一词），而断言的正则停在**旧文案**上。
★ 成因可核：`89419bc`（2026-10-09「the stale-build warning now says what the staleness costs」）**改了文案、没改夹具**（`git show 89419bc --stat` 里没有该测试文件）。
★★ 讽刺的是 `src/tools/shared/entities.ts:2031` 的注释**逐字**记着 `OLDER than the one on disk` —— 现在**源码注释也过期了**。
⇒ 分类：**臂过期**。处置：**改臂的正则**（`/OLDER build than the one on disk/`），并**顺手把源码注释改正**。★ 这不是放宽：`reload the plugin` 那一半仍然钉着，且新文案**信息更多**（多了 `build`）。

**⑨ `gate-worktree-arrival` —— ★ 臂过期（名字前缀变了）**

```
$ node --test scripts/gate-worktree-arrival.test.mjs
✖ ★ 接线臂（闸门对照臂）：仓库可用 ⇒ 照常派发，提示里带工作目录
  AssertionError: ★ 成员必须看到自己的隔离目录
    expected: /Working directory: .*task-t-impl/
       actual: '…Working directory: /var/folders/…/wt-arrival-repo-zX0YvW/.agent-teams/worktrees/task-team-t-impl\n…'
ℹ tests 22 · pass 21 · fail 1        # main 上逐字相同
```
★ 断言**意图**（成员看到自己的隔离目录）**已经满足** —— 提示里确实有 `Working directory: …`。
失败的是**字面**：目录名现在是 `task-**team**-t-impl`（团队 `team` + 任务 `t-impl`）。
```
$ node -e "const s='….agent-teams/worktrees/task-team-t-impl'; console.log(/task-t-impl/.test(s))"
false
```
产品侧的规则（`src/worktree.ts:193-204`）明写：
```ts
return teamId === undefined || teamId === ''
  ? `task-${safeTask}`                    // 不传 teamId ⇒ 保持旧形状
  : `task-${safe(teamId)}-${safeTask}`    // ★ 生产路径一律带前缀
```
且注释逐字说明理由：「两个团队的同名任务天然落到不同目录」。
★ 成因可核：前缀由 `60c51f7`（2026-10-10「bring stale fixtures back in line with the gates that outgrew them」）引入，
而**那一次没碰这个文件**（`git show 60c51f7 --stat | grep worktree-arrival` ⇒ 命中 0）。
⇒ 分类：**臂过期**。处置：**改臂正则**为 `/Working directory: .*task-team-t-impl/`（或更稳地断言"提示里的路径**是该任务自己的 worktree 目录**"）。★ 不是放宽：契约要的是"成员看到隔离目录"，而新正则**逐字钉住**它。

### 3.3 另外两条

**⑩ `gate-baseline-known-failures` —— 真实缺陷（清单自洽），但只在 `because` 文本上**
详见 §4。

**⑪ `gate-t1-completion-probe` —— 环境 / 夹具加载面**
详见 §2。

---

## 四、pin 清单治理：`gate-baseline-known-failures` 臂 6

### 4.1 实测读数

```
$ node --test scripts/gate-baseline-known-failures.test.mjs
✖ ★★ 臂 6：清单的成因分类学自洽 —— 每条都落在一个已知成因类里
  AssertionError: ★ 有 pin 的成因类**落不进任何已知类** —— …
    已知类：核对接线 / 运行时接线 / 全仓普查 / 存量 / 夹具自身加载面 / 结构违规 / 环境（worktree / 语料 / 台账） / 断言腐化（口径漂移） / 记录在案的故意红
ℹ tests 6 · pass 5 · fail 1        # main 上逐字相同
```

### 4.2 定位到**唯一**那一条

我用该臂**自己那 8 个正则**（逐字抄自 `scripts/gate-baseline-known-failures.test.mjs:357-366`）对全部 17 条 pin 跑了一遍：

```
$ node -e "…用臂 6 的 CLASSES 逐条 test…"
UNCLASSIFIED: scripts/gate-repair-completion.test.mjs
              :: arm 9 — ★ FLIPPED (t33): the real path no longer reports the f-0020 wording
   because = pristine a176e5d 上逐字复现（零改动）；t33 是既有记账点。同上由 t10 记账点的 pristine 对照证得。
```

**只有 1 条**落不进去（其余 16 条各自命中至少一类）。

### 4.3 为什么它落不进去（成因）

这条 `because` 说的是「**在另一个 pristine 修订上逐字复现**」—— 那是一个**方法论证据**（"我怎么知道它是存量"），
而不是**成因**（"它为什么会红"）。臂 6 的 8 个类全是**成因类**（核对接线 / 运行时接线 / 全仓普查 / …），
于是这条**说对了事、却没说出病因**的 `because` 掉在分类学之外。

★ 同类对照：清单里 `gate-contract-build-artifacts` 那条也用了「pristine a176e5d 上逐字复现」这种写法，
**但它多了一句**「t10 的记账点…同一测试、同一断言、逐字相同」—— 而 `t10` 命中了 `CLASSES` 里
「全仓普查 / 存量」的 `存量`（★ 注意该 pattern 里**没有** `t10`，命中的是 `存量` 二字）。
⇒ **同一个证据写法，一条写得完整（顺带说出成因面） ⇒ 通过；一条只写证据 ⇒ 掉出去。**

### 4.4 建议修法（★ 本轮**不动手**，等用户拍板）

我建议 **A：补齐 `because`，让它落进已有类**，理由是**可核的**：

- 这条 pin 的**成因**其实已经在别处记着 —— 该 pin 的被测臂是「等待中的连接」（`arm 9 — FLIPPED (t33)`），
  其成因面是 **断言/口径漂移**（t33 翻转了措辞，臂没跟上）⇒ 天然属于已有类 **「断言腐化（口径漂移）」**。
- **不需要新类**：新类意味着「这是一类新的存量」。而这条**不是新类**，它只是**一条写得太省的 `because`**。
  ★ 清单的 `_adding` 逐字写着「宁可去修，也不要加」——新立一个类会把一条**写法缺陷**升格成**分类学扩充**，方向反了。

**具体改法（若采纳）**：把该条 `because` 从
```
pristine a176e5d 上逐字复现（零改动）；t33 是既有记账点。同上由 t10 记账点的 pristine 对照证得。
```
补成（保留全部既有信息，只补"成因是哪一类"）：
```
（成因面：断言腐化 —— t33 翻转了真实路径上的措辞，而这条臂等的仍是旧的 f-0020 原话。）
pristine a176e5d 上逐字复现（零改动）；t33 是既有记账点。同上由 t10 记账点的 pristine 对照证得。
```

**为什么不选 B（登记为新类）**：新类的判据应当是「有一批存量**同属某个此前没被命名的成因机制**」。
这条不满足 —— 它是**孤例**，且它的成因（断言腐化）**已经被命名**。登记新类会把分类学变成"谁来都能加一格"，
而那正是臂 6 想防的事。

★ **另一条并列缺陷（同一文件、同一条 pin，本轮不改，登记在此）**：见 §5 的 pin 冗余。

---

## 五、pin 清单的另外两处记账（本轮不改）

1. **`gate-input-wiring` 有 2 条 pin，但只红 1 条臂。**
   清单里 `★ 臂 4（历史缺口 ②）：verify 缺席 —— 核对报出它（completion 位置）` 所指的臂，
   `node --test scripts/gate-input-wiring.test.mjs` 现在**是绿的**（`pass 11 / fail 1`，红的是臂 12）。
   ⇒ 这是一条**过期的 pin**。★ 按该文件 `_retiring`（「退一条必须附上**实测的绿读数**与**是哪个交付让它转绿**」），
   退它需要一份 `git log -S` 的归因 —— **本轮没做**，故**保留**（`_retiring` 明写「宁可留着，也不要凭我猜它该好了退」）。

2. **清单里 11 条 pin 指向的夹具现在是绿的**（即 `fixture` 文件整个不在 11 个失败文件里）：
   ```
   gate-readout-uniform · gate-runtime-clock · gate-runtime-liveness · moment-facts
   verify-admission · verify-input-requires · verify-readout-uniform
   verify-runtime-integration (×3) · verify-task-atomicity
   ```
   ★ 这**不一定是缺陷**：`_snapshot_caveat` 明写「本清单是**某一时刻**的集合比对结果，不是不变量」，
   而 `_measured_caveat` 记录了它会随队友并发 build 抖动（30/31/39 vs 22/22/22）。
   ⇒ 凡**依赖 `.agent-teams/` 语料或 `lib/` 中间态**的那些（`moment-facts`、`verify-task-atomicity`、
   `gate-runtime-*`），在**独立 worktree 里恒红/恒绿**是**已知**的 —— 而本轮的对照树 `.triage-main/`
   **恰好没有 `.agent-teams/`**，所以这些 pin 在对照树里看起来"指空"是**预期的**，不构成新发现。
   ★ 我不把它们登记成"pin 过期"，因为**判定它们需要主树的、无并发 build 的稳定读数** —— 本环境的失败集合会抖（见该文件自己的 `_measured_caveat`）。

---

## 六、建议的修复顺序与风险

### 6.1 低风险、独立、可立即做（**不改口径**）

| 序 | 项 | 动作 | 风险 | 为什么低 |
|---|---|---|---|---|
| 1 | `gate-stale-module` 臂 10 | 正则改为 `/OLDER build than the one on disk/`；顺手改正 `src/tools/shared/entities.ts:2031` 的过期注释 | **低** | 断言**变强**（旧正则根本匹配不到任何现行文案）；`reload the plugin` 那一半未动 |
| 2 | `gate-worktree-arrival` 臂 | 正则改为 `/Working directory: .*task-team-t-impl/` | **低** | 断言**变准确**（现在钉的是产品**真实**产出的名字）；`src/worktree.ts:186` 逐字给出「两团队同名任务天然落到不同目录」的设计意图 |
| 3 | `gate-baseline-known-failures` 臂 6 | 补 `gate-repair-completion` 那条 pin 的 `because`（§4.4 的具体改法） | **低** | 只**补**字节、不删既有信息；且不改 8 个类的正则 |
| 4 | `gate-producer-consumer` 那条 pin | 把 `because` 里的「实测 21」更新为**实测 26** | **低** | 只改**引用的读数**，不改结论；★ 但**必须同时说明**：26 里哪几条是可记账的、哪几条是"该去接线"的（原 pin 已经点名 `readContractGateVerdict` 不许记账） |

★ **1、2 两条都是"臂过期"**，改臂**不是放宽断言** —— 判据：改后**仍然可证伪**（把产品文案/目录名改回去 ⇒ 臂立刻红），
且新断言钉的**性质**与旧断言**相同**（"stale 明说自己旧" / "成员看到隔离目录"）。**这两条我建议批，且风险最低。**

### 6.2 会**改变口径**、必须**单独列出等用户裁定**

| # | 项 | 为什么要人拍板 |
|---|---|---|
| **A** | **`gate-t1-completion-probe` 臂 5 的处置**（§2） | 牵涉**两个相反方向的选择**：①「`scripts/` 侧：臂 5 用**活的、被 gitignore 的**仓库状态做断言」⇒ 该不该改成**自造夹具状态**（那需要**新的判据**：这条臂还要不要保"真实检出"这一性质）？②「`src/` 侧：`persistTaskBaseRevision` **跨团队同名 id 串写**」⇒ 这是一条**真产品缺陷**（写错了对象），修它在 `src/`（本轮 out of scope），且**没有现成断言**覆盖它。★ 两者**必须分开裁定**，本轮**只判定、不改**。 |
| **B** | **`gate-reviewed-passthrough` 臂 3：删掉还是改成"已连接"** | 臂**自己**说「该被删掉或改成『已连接』」。删掉 = **减少一条**校验；改成"已连接" = **换一条**校验。这是**判据层**的选择，不是措辞修正。 |
| **C** | **`gate-falsification-pairs` 臂 2：去修 vs pin** | 它报的是「注册表里 3 条判据（`contract.task-atomicity` / `dispatch.plan-reviewed` / `runtime.stall`）既无对照对、也无『无法构造』理由」。★ **去修**要给那 3 条各自补一个对照对**或**一个理由 —— 那是**新增判据工作**，不是归因。★ **不许 pin**：清单的语义是「与任何改动都无关的存量」，而这 3 条是**判据注册表自己的缺口**（该文件臂 4 的注释逐字说过：「一旦它收进一个【某个机制自己的缺口】，那个缺口就永久免疫了」）。 |
| **D** | **`gate-input-wiring` 第 2 条 pin 的退场** | 按 `_retiring`，退一条**必须**附「是哪个交付让它转绿」的 `git log -S` 归因。★ 本轮**没做**（且它落在别人写域附近的语义判断上）⇒ 建议**另立一条小任务**去做归因，而不是顺手退。 |
| **E** | **11 条 pin 指向"当前绿"的夹具** | `_measured_caveat` 说清单会随并发 build 抖动 ⇒ **只有在稳定环境下跑出的集合**才配做退场判据。★ 建议：**先冻结环境**（无并发 build）跑一次全量，再谈退场。 |

### 6.3 我**明确不建议**的两件事

1. **不要**把 §3.2 / §3.3 里任何一条**新写进 pin**。理由：清单的 `_adding` 逐字写着「宁可去修，也不要加」，
   且 `gate-baseline-known-failures` 的文件头立了一条一般形式：
   > 「一个『已知失败』清单，只能收【与任何改动都无关的存量】。一旦它收进一个【某个机制自己的缺口】，那个缺口就永久免疫了。」
   `gate-falsification-pairs`（3 条判据缺对照对）与 `gate-t1-completion-probe`（臂 5 + 跨团队串写）**都**是"某个机制自己的缺口" ⇒ **不配进 pin**。
2. **不要**为了让 `gate-stale-module` / `gate-worktree-arrival` 变绿而**改产品**（把 `build` 去掉 / 把 team 前缀去掉）。
   两者都是**有意的、有注释的**设计（`src/worktree.ts:186` 逐字说明前缀是为了"两个团队的同名任务天然落到不同目录"）。
   ⇒ 过期的是**臂**，不是产品。

---

## 七、复核（本轮全部命令与读数，可逐个复跑）

```bash
# ① 全量（HEAD）
node --test scripts/gate-*.test.mjs
#   ⇒ ℹ tests 1062 · pass 1031 · fail 11 · skipped 20 · exit 1

# ② 对照树（pristine main 323f104；源码零改动，只软链 node_modules）
git worktree add --detach .triage-main 323f104
ln -s ../node_modules .triage-main/node_modules
cd .triage-main && node --test scripts/gate-*.test.mjs
#   ⇒ ℹ tests 1053 · pass 1022 · fail 10 · skipped 21 · exit 1

# ③ 失败集合差集
comm -23 <(grep '^test at ' /tmp/full-head.txt | sed 's/:.*//' | sort -u) \
         <(grep '^test at ' /tmp/full-main.txt | sed 's/:.*//' | sort -u)
#   ⇒ 只在 HEAD：scripts/gate-t1-completion-probe.test.mjs
#   ⇒ 只在 main：（空）

# ④ t1 探针：同一份 main 源码，前置不可达 vs 可达
cd .triage-main && node --test scripts/gate-t1-completion-probe.test.mjs
#   ⇒ pass 2 · fail 0（打印："（unified-pipeline 的 team.json 不在盘上 ⇒ t1 那一半跳过）"）
ln -sfn ../../agent-teams-dev/.agent-teams/unified-pipeline .agent-teams/unified-pipeline
node --test scripts/gate-t1-completion-probe.test.mjs
#   ⇒ fail 1（AssertionError: ★ t1 的记录里【不该】有 baseRevision… true !== false）

# ⑤ 跨团队同名 id
node -e "…遍历 .agent-teams/*/team.json 找 id==='t1'…"
#   ⇒ agent-teams-hardening.t1(10:30:02.098Z) · mutation-quality.t1(16:37:33.955Z) · unified-pipeline.t1(10:30:02.289Z)
#   ⇒ 前两条同秒 ⇒ 同一次写入

# ⑥ stale 文案
node --input-type=module -e "import {moduleFreshnessMessage} from './lib/tools/shared/entities.js'; …"
#   ⇒ /OLDER than the one on disk/ => false ; /OLDER build than the one on disk/ => true

# ⑦ 分类学
node --test scripts/gate-baseline-known-failures.test.mjs     # ⇒ pass 5 · fail 1（臂 6）
node -e "…用臂 6 的 8 个 CLASSES 逐条 test 17 条 pin…"        # ⇒ 只有 1 条 UNCLASSIFIED

# ⑧ 类型
npx tsc -p tsconfig.json --noEmit                              # ⇒ exit 0
```

★ **本轮未改动任何文件**（`scripts/`、`src/`、`lib/` 均未动）。
★ 唯一留下的工作树痕迹：`.triage-main/`（对照 worktree，含 `node_modules` 软链）。
  它**不在** `.agent-teams/worktrees/**` 下，也未改动任何被跟踪文件；
  清理：`git worktree remove --force .triage-main && rm -rf .triage-main`。
