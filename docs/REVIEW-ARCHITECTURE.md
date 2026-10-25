# 对抗性复核：`docs/LAYER-INVENTORY.md` · `docs/architecture-pipeline.svg` · `docs/architecture.html`

> **复核人**：reviewer（t10，attempt `01fb4943-a8dc-49ef-99b5-3cef70d4b9f2`）
> **被审对象**：t3 的三份产出（archaeologist）
> **测量点**：HEAD = `b8f357e` ｜ upstream/main = `1094b84` ｜ merge-base = `98aac03`
> **纪律**：本文**不修改**任何被审文件。每条 finding 都有可复跑的命令与读数。
> **裁决**：**needs_revision**（1 blocker + 3 high + 2 medium + 1 low）

---

## 0. 结论摘要

三份产出**主体质量高、可回源率高**：我抽检的 **5 条清单断言 + 5 处图中标注 + 全部 17 条判据 id + 6 处求值调用点**，**除下面列出的项外全部逐字命中**（含行号）。SVG 能被 XML 解析器解析，HTML 零外网依赖，判据集合与分组计数**完全正确**。

但有两类问题**必须改**：

1. **BLOCKER — 归因方向错**（§8.2 / HTML §6.2）：4 个文件被写成「**被删除**的上游文件」，实际是**上游自 fork 以来的新增**。风险结论方向也因此反了。
2. **HIGH — §8.1 改动量表格系统性失真**：整列 deletions 用了 three-dot diff 的数字，却标成「上游侵入点 / 同步冲突风险」，**误报的量级是 40~110 倍**。

---

## 1. ★ 复核覆盖面（先给读数，再给结论）

### 1.1 抽检的清单断言（≥5 条，逐条回源）

| # | 断言（文件:行） | 我的回源命令 | 我的读数 | 判定 |
|---|---|---|---|---|
| A1 | `src/` 从 18,793 → **47,310** 行；文件 40 → **95**（`:31-32`） | `git ls-tree -r HEAD --name-only -- src/ \| grep -E '\.tsx?$' \| while read f; do wc -l < "$f"; done \| paste -sd+ - \| bc` / `git ls-tree -r HEAD --name-only -- src/ \| wc -l` | **47310** ｜ **95** ｜ upstream **40** | ✅ 逐字命中 |
| A2 | `src/quality-gates.ts` 2,109 → 2,520（`:36`） | `git cat-file -p upstream/main:src/quality-gates.ts \| wc -l` / `wc -l < src/quality-gates.ts` | **2109** ｜ **2520** | ✅ |
| A3 | `src/gates/` 上游**整个目录不存在**（`:91`、`:519`） | `git ls-tree -r upstream/main --name-only -- src/gates \| wc -l` | **0** | ✅ |
| A4 | `src/client/` 新增 **13** 个文件（`:442`） | `comm -13 <(git ls-tree -r --name-only upstream/main -- src/client\|sort) <(git ls-tree -r --name-only HEAD -- src/client\|sort) \| wc -l` | **13**（逐个列名与文档表格一致） | ✅ |
| A5 | 工具面计数 15 / 4 / 差集 11（`:346`） | 读 `src/tool-names.ts`：`TEAM_TOOL_NAMES` 15 项、`MEMBER_TOOL_NAMES` 4 项、`CAPTAIN_TOOL_NAMES = filter(...)` | **15 / 4 / 11** | ✅ |
| A6 | `src/tool-names.ts` 对上游 **+14 / -0**（`:334`） | `git diff --numstat upstream/main HEAD -- src/tool-names.ts` | **14 / 0** | ✅ |
| A7 | 13 个 client 新文件的行数（`:446-458`） | 逐个 `wc -l` | 453/214/128/258/98/88/203/131/121/**67**/**151** 全中 | ✅ |
| A8 | 88 个判据夹具 / 130 个测试文件（`:596-599`） | `ls scripts/gate-*.test.mjs \| wc -l` / `ls scripts/*.test.mjs \| wc -l` | **88** ｜ **130** | ✅ |
| A9 | `kind-requirements.ts` 不是判据（`:162`、`:594`） | `grep -c "export const id" src/gates/completion/kind-requirements.ts` | **0** | ✅ |
| A10 | §3 全部 18 个 commit 溯源（`621e152`/`ad7a3ed`/`2370145`/`485ec9e`/`626c59d`/`0657f65`/`5520399`/`70c8c96`/`ebbacce`/`c396e71`/`27e9613`/`0b01104`/`5bc5b45`/`f8fc671`/`9779c58`/`68ee2c8`/`6345750`/`887d98a`） | `git show -s --format='%ci %s' <c>` | **18/18 命中**，含日期与标题 | ✅ |

### 1.2 抽检的图中标注（≥5 处，逐处回源 `src/gates/**`）

| # | 图中标注（SVG 行） | 我的回源 | 判定 |
|---|---|---|---|
| S1 | 插入点定义在 `registry.ts:288` `INSERTION_POINTS = Object.freeze([`（`:64`） | `sed -n '288p'` | ✅ |
| S2 | `GateVerdict` 三态在 `registry.ts:44`（`:291`） | `sed -n '44p'` = `export type GateVerdict =` | ✅ |
| S3 | `admission.absorb` 闸门 `claims ∈ {'absorbed','nothing'}`，`absorb.ts:268`/`id:71`（`:136-137`） | `sed -n '268,271p'` = `claims === CLAIMED_ABSORBED \|\| claims === CLAIMED_NOTHING` | ✅ |
| S4 | `admission.convene` 闸门恒真，`convene.ts:449`（`:150-151`） | `sed -n '449,451p'` = `return true` | ✅ |
| S5 | `contract.task-atomicity` 闸门 `QUALITY_KINDS.has(kind ?? 'work')`，`:650`/`id:126`/`:216`（`:176-177`） | `sed -n '650p'` = `QUALITY_KINDS.has(task.kind ?? 'work')`；`:216` = `const QUALITY_KINDS = new Set([...])`（6 个 kind） | ✅ |
| S6 | `dispatch.changed-paths` / `dispatch.worktree` **逐字同一口径**，`:160`/`:169`（`:188-189`、`:196-197`） | 两处 `sed` 比对：**逐字节相同**（`kind !== 'implementation' && kind !== 'repair'` + `Array.isArray(...) && length > 0`） | ✅ 「刻意逐字相同」属实 |
| S7 | `delivery.coverage` / `convergence` 闸门 `ctx.team !== undefined`，`:191`/`:181`（`:251`、`:258`） | 两处 `sed` | ✅ |
| S8 | `runtime.liveness` 闸门 `LIVENESS_EVENTS = ['task-status','runtime-liveness']`，`:163`/`id:64`/`:161`（`:270-272`） | `sed -n '161,165p'` | ✅ |
| S9 | `runtime.stall` 闸门 `STALL_EVENTS = ['task-status','task-update-settled','delivery-declared']`，`:127`/`id:60`/`:84`（`:276-278`） | `sed -n '84p'`、`'127,130p'` | ✅ |
| S10 | **6 处求值调用点**，逐处给出 `文件:行`（`:120-124`、`:334-335`） | `grep -rn "registry\.evaluate(" src/ \| grep -vE ':[0-9]+:\s*(\*\|//)'` | **恰好 6 处**，且 `entities.ts:3661` / `dispatch.ts:117` / `completion.ts:672` / `delivery.ts:84` / `status.ts:659` / `entities.ts:3554` **逐行号命中** ✅ |
| S11 | `runtime`「**六个**事件调用点共用这一个构造点」（`:124`） | `grep -rn "evaluateRuntimeGates(" src/ \| grep -vE ':\s*(\*\|//)'` | **6 处**：`status.ts:660`、`update-task.ts:1052`、`update-task.ts:1956`、`create-task.ts:788`、`delivery.ts:151`、`tools.ts:1865` ✅ |
| S12 | `asRegistration()` 形状校验在 `index.ts:419`；`ALL_GATES(:305)`；`buildRegistry()(:459)`；`registry(:468)`（`:320-321`、`:327`） | `grep -n` 逐个 | ✅（但见 F5：`ALL_GATES` 并非 export，见下） |

### 1.3 抽检「6 处过期」+ 反向查漏

| # | 文档声称 | 我的独立复核 | 判定 |
|---|---|---|---|
| E1 | `START-HERE.md:17`「34 个导出」⇒ 实测 52 | `git show 54eddb4:src/quality-gates.ts \| grep -c "^export "` ⇒ **52**；上游现在 `git cat-file -p upstream/main:src/quality-gates.ts \| grep -c "^export "` ⇒ **80** | ✅ 完全属实 |
| E2 | `START-HERE.md:53`「十一条」⇒ 17 | 实测 **17** | ✅ |
| E3 | `START-HERE.md:55-62` 清单缺 6 条 | 对照实测：缺 `admission.*`×3、`contract.task-atomicity`、`dispatch.plan-reviewed`、`runtime.stall` = **正好 6 条** | ✅ |
| E4 | `START-HERE.md:121`「六条判据还没生效」⇒ 过期 | 原文逐字命中 | ✅ |
| E5 | `THREE-LINE-PLAN.md:6`「账本未接入生产路径」⇒ 过期（`71de42a`） | `git show -s --format='%ci %s' 71de42a` ⇒ `2026-10-10 … the friction/experience line gets a production caller` | ✅ |
| E6 | `BASELINE-RED.md`「24→5」对现状不适用 ⇒ 现状 19 fail | `pnpm test:gates` ⇒ **tests 1471 / pass 1415 / fail 19** | ✅ 数字完全复现 |

**反向查漏（我主动追的）**：未发现被漏掉的「与代码冲突的旧断言」。
- 我额外核了 `START-HERE.md:79-92`（liveness 三个坑）与 `START-HERE.md:95-99`（注册表两条新能力），文档判「✅ 有效」，**与源码一致，判定正确**。
- `THREE-LINE-PLAN.md:24-32`（裁定 A：`uncovered` 不进 `scored`）—— 文档判「✅ 有效」，我核 `src/mutation.ts` 的 `SCORED`/地板逻辑，**一致**。
- 文档**主动**区分了「注释里的历史数字 11」不算过期文档（`:301`、`:585`），这是**正确且难得**的纪律 —— 见 §3 的正面记录。

### 1.4 判据集合核对（验收硬指标）

```sh
$ grep -rn "^export const id = '" src/gates/*/*.ts
# ⇒ 17 行，集合如下（逐条与图/表比对）
admission.absorb · admission.checkpoint · admission.convene
contract.build-artifact-scope · contract.task-atomicity · contract.verify-command
dispatch.changed-paths · dispatch.plan-reviewed · dispatch.worktree
completion.backtest · completion.mutation · completion.r5 · completion.verify-rerun
delivery.convergence · delivery.coverage
runtime.liveness · runtime.stall
```

- **总数 = 17** ✅（`grep … | wc -l`）
- **图/表集合与实测集合逐条相等** ✅（SVG 中 `grep -oE '(admission|contract|dispatch|completion|delivery|runtime)\.[a-z0-9-]+'` 的 20 个去重命中里，3 个是文件名误配 —— `completion.ts` / `dispatch.ts` —— **真实判据 id 恰为 17**）
- **分组计数**：

```sh
$ for p in admission contract dispatch completion delivery runtime; do
    echo "$p = $(grep -rh "^export const id = '" src/gates/$p/*.ts | wc -l)"; done
admission = 3   contract = 3   dispatch = 3
completion = 4  delivery = 2   runtime = 2      # 3+3+3+4+2+2 = 17 ✅
```
**与任务书要求的分组逐条相等** ✅

- **(a) `kind-requirements.ts` 没被误当判据** ✅ —— `grep -c "export const id"` ⇒ **0**；SVG `:285` 与清单 `:162` 都显式写明「不是判据，不计入 17」。**这一条做对了。**

### 1.5 文件可打开 / 无外网依赖（验收硬指标）

```sh
$ python3 -c "import xml.etree.ElementTree as ET; ET.parse('docs/architecture-pipeline.svg')"
OK                                     # 无异常 ✅

$ grep -cE '<(link|script|img)\b' docs/architecture.html
0                                      # 零外链标签 ✅
$ grep -oE 'https?://[^"'"'"' <>]*' docs/architecture.html | sort -u
http://www.w3.org/2000/svg             # 唯一命中 = SVG XML 命名空间，非网络请求 ✅
$ grep -oE '(href|src)="[^"]*"' docs/architecture.html | grep -E ':'
（空）                                  # 无任何带 scheme 的 href/src ✅
```

**结论**：图可解析、HTML 自足。**这一条完全通过。**

---

## 2. Findings

### F1 — **BLOCKER**：4 个上游文件的归因方向写反了

- **文件:行**：`docs/LAYER-INVENTORY.md:507-514`（标题 `### 8.2 被**删除**的上游文件（4 个）`）· `docs/architecture.html:949-953`（`<h3>6.2 被<strong>删除</strong>的上游文件（4 个，最高风险）</h3>`）· 命令块 `docs/architecture.html:1143-1144`（`# ⇒ 4 个被删除的上游文件`）
- **问题**：这 4 个文件**在分叉点 `98aac03` 上就不存在**，是**上游自己后来新增的**，fork 一个上游文件都没删。文档写成「被**删除**的上游文件…这是**最高风险**的一类侵入」，把方向说反了。
- **我的回源（双向确认）**：

```sh
$ for f in src/artifacts.ts src/lineage.ts src/tool-policies.ts src/workspace-audit.ts; do
    for ref in 98aac03 upstream/main HEAD; do
      git cat-file -e $ref:$f 2>/dev/null && echo "$ref $f EXISTS" || echo "$ref $f absent"; done; done
98aac03 src/artifacts.ts absent      upstream/main src/artifacts.ts EXISTS      HEAD src/artifacts.ts absent
98aac03 src/lineage.ts absent        upstream/main src/lineage.ts EXISTS        HEAD src/lineage.ts absent
98aac03 src/tool-policies.ts absent  upstream/main src/tool-policies.ts EXISTS  HEAD src/tool-policies.ts absent
98aac03 src/workspace-audit.ts absent upstream/main src/workspace-audit.ts EXISTS HEAD src/workspace-audit.ts absent

$ git diff --name-status 98aac03 upstream/main -- src/
A  src/artifacts.ts          ← 上游新增
A  src/lineage.ts            ← 上游新增
A  src/tool-policies.ts      ← 上游新增
A  src/workspace-audit.ts    ← 上游新增
M  src/capabilities.ts  M  src/command.ts  M  src/mailbox.ts  … （其余为上游自己的修改）

$ git diff --name-status 98aac03 HEAD -- src/ | grep '^D'
（空）                        ← ★ fork 侧对上游文件的删除数 = 0
```

- **新增 commit 全在 fork 之后**（`git merge-base --is-ancestor 98aac03 <c>` ⇒ true）：

| 文件 | 上游新增 commit | 日期 |
|---|---|---|
| `src/artifacts.ts` | `648fd9a` | 2026-10-10 23:35:32 |
| `src/workspace-audit.ts` | `648fd9a` | 2026-10-10 23:35:32 |
| `src/tool-policies.ts` | `f21f37c` | 2026-10-10 23:46:55 |
| `src/lineage.ts` | `38a84b9` | 2026-10-11 00:05:12 |

- **风险结论方向也反了**（这是比措辞更实质的部分）：
  - 文档写：「上游若改动它们，fork **拿不到**」。
  - 实情：它们**在 fork 之后**才出现在上游，**完全可合并**（`git merge upstream/main` 会干净拉进来）。真正的风险不是「拿不到」，而是「**fork 至今没接进来** ⇒ 上游这 4 个能力（裁决绑定修订 `648fd9a`、成员工具策略 `f21f37c`、团队身份沿 fork 链解析 `38a84b9`）在 fork 里**还不存在**」。
  - 正确的类别名是 **「上游新增、fork 未采纳 ⇒ 有意/无意的分叉缺口」**，不是 **「fork 删掉了上游的东西」**。
- **必须怎么修**：
  1. `LAYER-INVENTORY.md:507` 标题改为 `### 8.2 上游有、fork **未采纳**的文件（4 个：上游自 fork 后**新增**）`。
  2. 正文 `:513` 改为：`★ 这 4 个在分叉点 98aac03 上【不存在】（git cat-file -e 实测），是【上游自己后来新增的】（A 状态，见 git diff --name-status 98aac03 upstream/main -- src/）；fork 侧对上游文件的删除数 = 0。⇒ 它们【可以干净合并】，风险不是"拿不到"，而是"fork 尚未采纳"：上游 648fd9a / f21f37c / 38a84b9 带来的能力在 fork 里还没有。`
  3. `architecture.html:949` 标题、`:952` 风险句、`:1144` 的路内注释同步改成同一口径（`# ⇒ 4 个上游新增、fork 未采纳的文件`）。
  4. 把「最高风险」的重定级说明白：**「不可合并」才是最高风险，而这一类不是不可合并** —— 真正的不可合并项是 §8.1 里那些被大改的文件。

  > 说明：`comm -23 <(ls-tree upstream/main) <(ls-tree HEAD)` 这个**命令本身没错**（它正确地算出了「上游有、HEAD 无」），错的是**由它推出的结论**——集合差无法区分「fork 删了」与「上游加了」。这正是本次复核最有价值的一条。

---

### F2 — **HIGH**：§8.1「改动量」整张表的 deletions 列系统性失真（最大 118 倍）

- **文件:行**：`docs/LAYER-INVENTORY.md:483-505`（表头 `### 8.1 被修改的上游文件（comm -12 + git diff --numstat 实测，按改动量排序）`）· `docs/architecture.html:907-933`（HTML 明确写了判据是 `git diff --numstat upstream/main...HEAD`）
- **问题**：整张表用的是 **three-dot**（`upstream/main...HEAD` = merge-base→HEAD）的数字，但这一节的标题与列名是 **「上游侵入点 / 同步冲突风险」** —— 那是 **two-dot**（`upstream/main HEAD`）才能回答的问题。deletions 列因此**普遍低报几十倍**。
- **我的回源**（逐行 `git diff --numstat upstream/main HEAD -- <f>` vs 文档声称）：

| 上游文件 | 文档声称 | 实测（two-dot） | 偏差 |
|---|---|---|---|
| `src/quality-gates.ts` | +1295 / **-8** | +1369 / **-958** | deletions **低报 120 倍** |
| `src/members.ts` | +663 / **-3** | +713 / **-342** | **低报 114 倍** |
| `src/state.ts` | +439 / **-4** | +448 / **-229** | **低报 57 倍** |
| `src/types.ts` | +653 / **-1** | +647 / **-94** | **低报 94 倍** |
| `src/tools.ts` | +1673 / -2018 | +1685 / **-2335** | -317 |
| `src/scheduler.ts` | +737 / -18 | +738 / **-46** | -28 |
| `src/harness-compat.ts` | +466 / **-0** | +489 / **-80** | **「只增」不成立** |
| `src/snapshot.ts` | +184 / -3 | +184 / **-39** | -36 |
| `src/index.ts` | +187 / -2 | +191 / **-54** | -52 |
| `src/profiles.ts` | +87 / -2 | +89 / **-11** | -9 |
| `src/client/activity-monitor.ts` | +202 / **-0** | +200 / **-6** | **「只增」不成立** |
| `src/client/ActivityPanel.tsx` | +94 / -525 | +94 / **-530** | -5 |
| `src/client/ActivityPanel.module.css` | +564 / -345 | +564 / **-356** | -11 |
| `src/client/activity-model.ts` | +721 / -0 | +721 / -0 | ✅ |
| `src/client/StagingPlanEditor.tsx` | +153 / -1 | +153 / -1 | ✅ |
| `src/client/locales.ts` | +81 / -0 | +81 / -0 | ✅ |
| `src/client/index.tsx` | +55 / -0 | +55 / -0 | ✅ |
| `src/client/icons.tsx` | +6 / -0 | +6 / -0 | ✅ |
| `src/client/WorkspaceActivity.tsx` | +1 / -1 | +1 / -1 | ✅ |
| `src/tool-names.ts` | +14 / -0 | +14 / -0 | ✅ |

- **根因已定位**（我用对照实验确认，不是推测）：

```sh
$ git diff --numstat upstream/main HEAD -- src/quality-gates.ts      # two-dot
1369    958
$ git diff --numstat upstream/main...HEAD -- src/quality-gates.ts    # three-dot
1295    8          ← 与文档 -8 逐字相同
```

  三份产出内部**自相矛盾**：`:334` 与 `:10` 用 `...`（three-dot），HTML `:907` 也写明 `...`，但**表头写的是「上游侵入点 / 同步冲突风险」** —— 后者要求 two-dot。
- **为什么这是 HIGH 而非 LOW**：这一节的**唯一目的**就是回答「fork 的真实成本 / 同步冲突风险」（`LAYER-INVENTORY.md:479` 原话：「用户 fork 的动机是上游同步会冲突，所以这一节是本清单的重点」）。用 three-dot 数字给「同步冲突风险」评级，**恰好低报了真实冲突面** —— 而这是一份要给人做取舍决策的材料。更严重的是 `quality-gates.ts` 的「**只增不删**」这个**定性结论**，在 two-dot 口径下被证伪（-958）。
- **必须怎么修**：
  1. **二选一，并让全文自洽**：
     - 若要回答「同步冲突风险」⇒ 全表改用 `git diff --numstat upstream/main HEAD -- <f>`（two-dot），并逐行更新数字。
     - 若要保留 three-dot（它正确表达「fork 自己改了多少」）⇒ **改列名与节标题**为「fork 相对 merge-base 的改动量（不代表上游冲突面）」，并**删掉**「同步冲突风险」列与「侵入点」措辞。
  2. **推荐 two-dot**，因为它与用户 fork 的动机（同步上游会不会冲突）一致。改后须复核 §8.4 小结：「`src/quality-gates.ts`（+1295/-8）」⇒ 应为 `(+1369/-958)`，且「只增不删」的表述要**撤掉**（`LAYER-INVENTORY.md:486`、`architecture.html:919`）。
  3. `architecture.html:922` 的 `src/web-routes.ts +200/-0` ✅ 与 `:507`(LAYER) 一致（two-dot 实测 `200 0`），**这一行恰好两种口径相同，不用改**。
  4. `harness-compat.ts`「只增」`LAYER-INVENTORY.md:491`、`activity-monitor.ts`「只增」`:499` 两处措辞同样要撤。

---

### F3 — **HIGH**：§8.3 的 `src/gates/**` 文件数写 26，实测 24（且与本节自己的算式矛盾）

- **文件:行**：`docs/LAYER-INVENTORY.md:519`（`src/gates/**  26 个文件，11,964 行`）· `docs/architecture.html:131`（`26 个文件：17 条判据 + registry.ts + requires.ts + index.ts + budget-stop.ts + kind-requirements.{ts,json}`）· `docs/architecture.html:956`
- **问题**：实测 `find src/gates -type f | wc -l` ⇒ **24**。而且 HTML `:131` 自己列的算式 `17+1+1+1+1+2 = 23`，也不等于 26 —— **算式与结论互相矛盾**。漏项是 `src/gates/contract/verify-command-rules.json`（`grep -c "export const id"` ⇒ 0，是规则表不是判据，但它是目录里的文件）。
- **我的回源**：

```sh
$ find src/gates -type f | wc -l
24
$ find src/gates -type f | sort
… admission/{absorb,checkpoint,convene}.ts · budget-stop.ts ·
  completion/{backtest,kind-requirements.json,kind-requirements.ts,mutation,r5,verify-rerun}.ts ·
  contract/{build-artifact-scope,task-atomicity,verify-command-rules.json,verify-command}.ts ·
  delivery/{convergence,coverage}.ts · dispatch/{changed-paths,plan-reviewed,worktree}.ts ·
  index.ts · registry.ts · requires.ts · runtime/{liveness,stall}.ts      ⇒ 24
$ find src/gates -type f | xargs wc -l | tail -1
11964 total                                                                # 行数 ✅ 正确
```
- **必须怎么修**：
  1. 三处 `26` 改为 `24`。
  2. `architecture.html:131` 的算式补全为 `17 条判据 + registry.ts + requires.ts + index.ts + budget-stop.ts + kind-requirements.{ts,json} + verify-command-rules.json`（`17+1+1+1+1+2+1 = 24`）。
  3. 行数 `11,964` **不用改**（实测一致）。

---

### F4 — **HIGH**：§10 的「19 条失败分布」表与实际分布不符

- **文件:行**：`docs/LAYER-INVENTORY.md:606-614`（表：`verify-runtime-integration` **8** / `verify-input-requires` **4** / `verify-unified-pipeline` **2** / `verify-admission` **2** / `其余 11 个文件各 1–2 条 … 2 each`）
- **问题**：四个文件的失败数**全部低报一倍**，且「其余 11 个文件各 1–2 条」与同格右侧的「2 each」**自相矛盾**。表格内的数字加起来（8+4+2+2+2×11 = 38）也**对不上**它自己报的 19。
- **我的回源**（逐个文件单跑，取 node 自己的 `ℹ fail`）：

```sh
$ pnpm test:gates          # 总计
ℹ tests 1471   ℹ pass 1415   ℹ fail 19          # ★ 总计完全复现 ✅
$ for f in <每个可疑文件>; do node --test "$f" | grep '^ℹ fail'; done
4 scripts/verify-runtime-integration.test.mjs
2 scripts/verify-input-requires.test.mjs
1 scripts/verify-unified-pipeline.test.mjs
1 scripts/verify-admission.test.mjs
1 × 11 其余文件（gate-worktree-arrival / gate-t1-completion-probe / gate-stale-module /
        gate-source-reading-convention / gate-reviewed-passthrough / gate-repair-completion /
        gate-producer-consumer / gate-input-wiring / gate-falsification-pairs /
        gate-contract-build-artifacts / gate-baseline-known-failures）
```

- **正确的表**：**15 个文件**、`4 + 2 + 1×13 = 19`，即 **1 个文件 4 条、1 个文件 2 条、13 个文件各 1 条**。
- **必须怎么修**：把 `:606-614` 的表整体替换为上述 15 行（或至少改为「`verify-runtime-integration` 4 · `verify-input-requires` 2 · 其余 **13** 个文件各 **1**」），并让「合计 = 19」显式成立。**注意**：失败**总数 19 与 tests/pass 读数是对的**，只需修分布表。同类表在 `architecture.html` 中若有镜像，一并同步（HTML §8/§9 附近）。

---

### F5 — **MEDIUM**：`registry.evaluate('completion', …)` 的注释计数口径漏了一处，自查结论差 1

- **文件:行**：`docs/LAYER-INVENTORY.md:90`（「`grep -rn "registry.evaluate('completion'" src/` 会命中 **6 处**，但其中**只有 1 处是真代码**，**另 5 处是注释里的提及**（`verify-rerun.ts:19`、`update-task.ts:13`、`update-task.ts:916`、`quality-gates.ts:1624`、`tools.ts:225`）」）
- **问题**：该「5 处注释」清单**漏了 `docs`…不，漏了 `src/tools.ts:1426` 之外的**——精确说：`grep -rn "registry.evaluate('completion'" src/` 实际命中 **6 处**且已列出，但**另有一处 `registry.evaluate('completion', …)` 提及在 `src/gates/completion/verify-rerun.ts:19` 之外**……以我的实测为准，见下。该条目**主结论（1 处真代码 + 5 处注释）成立**，但**清单不完整**：`src/tools.ts` 里同一文件中另有以 `registry.evaluate('runtime', …)`/变体出现的注释，若读者照文档口径 grep `registry.evaluate`（不带 point）会得到更多行。
- **我的回源**：

```sh
$ grep -rn "registry.evaluate('completion'" src/ | wc -l
6
$ grep -rn "registry.evaluate('completion'" src/
src/gates/completion/verify-rerun.ts:19   *.ts 注释
src/tools/update-task.ts:13               *   注释
src/tools/update-task.ts:916              *   注释
src/tools/update-task/completion.ts:672   ← ★ 唯一真代码
src/quality-gates.ts:1624                 *   注释
src/tools.ts:225                          *   注释
```
  逐行核对：**文档列的 5 处注释 + 1 处真代码 = 恰好 6**，**完全正确**。
- **因此本条降级为 LOW**，仅剩一处**表述风险**：`:90` 末尾说「另注：`registry.ts:850` 也提到 `evaluate('completion', …)`（少了 `registry.` 前缀），故不在上面那 6 处之内」—— 我核 `registry.ts:850` 确有此行。**该注正确**。
- **必须怎么修**：**无需修改数值**；仅建议在 `:90` 补一句「口径 `grep -rn "registry.evaluate('completion'"` 只覆盖带 `registry.` 前缀的写法；已知 unprefixed 提及 1 处（`registry.ts:850`）已单列」。**（措辞澄清，非事实错误）**

> 复核注：本条我原本判为问题，回源后**自我更正为「文档正确」**。按对抗性复核纪律，**我保留这条记录**，以免用「我不喜欢这个口径」冒充 finding。

---

### F6 — **MEDIUM**：`ALL_GATES` 被标为 `export`，实际是模块内 `const`

- **文件:行**：`docs/architecture-pipeline.svg:320`（`ALL_GATES（:305）→ buildRegistry()（:459）`）· 关联 `docs/LAYER-INVENTORY.md:88`（关键符号列的惯例是导出符号）· `docs/LAYER-INVENTORY.md:534`（「装配清单的冲突面 = 1 行/判据 ← `src/gates/index.ts` 的 `ALL_GATES`」）
- **问题**：`src/gates/index.ts:305` 是 `const ALL_GATES = [` —— **没有 `export`**。图与清单在别处都严格区分「可 import 的公共面」与「私有的」，此处会让读者以为注册表是「加上游没导出的私有 const」（这恰好是 §4 记的那个坑：运行期 `registry.register(...)` 进来的判据不在 `ALL_GATES` 里）。
- **我的回源**：

```sh
$ grep -n "ALL_GATES" src/gates/index.ts | grep -E "export|const ALL_GATES"
305:const ALL_GATES = [
# 无 export
$ sed -n '305p' src/gates/index.ts
const ALL_GATES = [
```
- **必须怎么修**：把相关措辞改为「`src/gates/index.ts:305` 的**模块内** `const ALL_GATES`（**非导出**）」，并在 §8.4 的「装配清单的冲突面 = 1 行/判据」处补一句口径说明（改动点是**新增一行 import + 在 `ALL_GATES` 里加一行**，两行而非一行）。SVG `:320` 同步标注「(module-local, not exported)」。

---

### F7 — **LOW**：`src/gates/` 文件数与 `src/tools/` 计数口径未写明「含/不含 JSON 与 index」

- **文件:行**：`docs/LAYER-INVENTORY.md:519-520`、`docs/architecture.html:131-132`
- **问题**：`src/tools/**.ts 18 个文件` 我实测为 **18** ✅；但 `src/gates/` 的 26（⇒24）与 `src/client/` 的 13 分别对应不同口径（前者含 `.json`、后者含 `.module.css`），文档未统一说明，导致读者无法复现（F3 就是这么产生的）。
- **必须怎么修**：在这些计数旁统一标注口径，例如「（含非 `.ts` 资源：`find <dir> -type f`）」，并给出可复跑命令。与 F3 合并修一次即可。

---

## 3. 明确判「通过」的部分（不得因为上面有 finding 就推翻）

以下是我**独立复跑并逐条命中**的，应当保留：

1. **判据集合 = 17 且分组 3/3/3/4/2/2 逐条相等** ✅ —— 这是本次任务的关键验收项，**做得完全正确**，包括把 `kind-requirements.ts` 正确排除（`grep -c "export const id"` ⇒ 0）。
2. **6 处求值调用点全部命中行号** ✅ —— `entities.ts:3661`、`dispatch.ts:117`、`completion.ts:672`、`delivery.ts:84`、`status.ts:659`、`entities.ts:3554`，我用「排除注释行」的 grep 得到**恰好 6 处**，与图完全一致。**SVG 的这一段可以直接当作事实使用。**
3. **SVG 的 12 处标注（S1–S12）全部回源命中** ✅ —— 尤其是「`changed-paths` 与 `worktree` **逐字同一口径**」这条，我做了逐字节比对，**确实是刻意逐字相同的**，文档的因果说明（「让普查臂能用同一条口径核对」）与源码注释一致。
4. **图/HTML 可打开、零外网依赖** ✅ —— `ET.parse` 无异常；HTML `<link>/<script>/<img>` 计数为 **0**；唯一 `http://` 是 SVG 命名空间（非网络请求）。
5. **§9 的 6 处过期判定全部属实**，且**主动区分了「注释里的历史数字」与「过期文档」**（`registry.ts:527-541` 的「11 条」被正确判为历史记录而非过期）—— 这是**高水准**的一处，值得保留。
6. **§10 的三项总计读数完全复现** ✅ —— `tests 1471 / pass 1415 / fail 19`，与我 `pnpm test:gates` 实测逐字相同。
7. **18 个 commit 溯源全部命中**，含日期（这一点很少见，做得好）。
8. **11 + 6 = 17 的溯源链**（`a5d3dce` 时确为 11 条）✅ —— `START-HERE.md` 不是笔误，是**真的停在历史某刻**，文档看懂了它。

---

## 4. 裁决

**verdict = `needs_revision`**

| id | severity | 位置 | 一句话 |
|---|---|---|---|
| F1 | **blocker** | `LAYER-INVENTORY.md:507-514` · `architecture.html:949-953,1143-1144` | 4 个文件是**上游新增**、非 fork 删除；风险方向反了 |
| F2 | **high** | `LAYER-INVENTORY.md:483-505` · `architecture.html:907-933` | deletions 列用 three-dot，却标成「上游侵入点/冲突风险」，最大低报 120 倍 |
| F3 | **high** | `LAYER-INVENTORY.md:519` · `architecture.html:131,956` | `src/gates/**` 26 个文件 ⇒ 实测 **24**，且与自身算式矛盾 |
| F4 | **high** | `LAYER-INVENTORY.md:606-614` | 19 条失败分布表全错（应 4/2/1×13，共 **15** 个文件） |
| F5 | medium | `LAYER-INVENTORY.md:90` | 口径澄清（**数值正确**，非事实错误；已自我降级） |
| F6 | medium | `architecture-pipeline.svg:320` · `LAYER-INVENTORY.md:88,534` | `ALL_GATES` 非 export，图为标 |
| F7 | low | `LAYER-INVENTORY.md:519-520` · `architecture.html:131-132` | 文件计数口径未写明，无法复现 |

**放行条件**：F1–F4 必须修（含 `architecture.html` 中的镜像段落），并**重跑一次本节 §1.4 的判据计数与 §1.5 的解析命令**自证未改坏。F5–F7 建议同批修。**修复后无需重审全部内容，但 F1/F2 触及的 §8 整节需要一次针对性复核**（因为这两条都改变了该节的结论方向，而不只是数字）。

**为什么不是 `reject`**：三份产出的**骨架、判据集合、调用点、图可解析性、过期判定**全部经我独立复跑后成立 —— 这是**核心交付**，且质量高。错误集中在 **§8（上游侵入点）与 §10（失败分布）两个统计小节**，属「结论方向错 + 数字失真」，可定点修复，不需要推倒重来。

**为什么不是 `pass`**：F1 是**事实性归因错误**，而 §8 恰好是用户 fork 动机的直接答案；F2 让「同步冲突风险」这一列**系统性失真到不可用于决策**。这两条如果放行，会直接把读者引向错误结论。

---
---

# 第 2 轮复核（t13）：t12 修复后的复验

> **复核人**：reviewer（t13，attempt `6cc4ea87-035b-4d2c-83df-6ea93fa668cc`）
> **复核对象**：t12（archaeologist 的 round-2 修复）｜ **测量点**：HEAD = `b8f357e`（未变）
> **裁决**：**needs_revision** —— 第 1 轮 7 条 finding **6 条已修并经我独立复跑证实**；**F2 有 1 处未修净（新 F8, high）**，另发现 1 处口径孤儿（F9, low）

## R2-0. 结论摘要

t12 的修复**质量很高**。第 1 轮的 7 条，**6 条完全修复**，其中：

- **F1（blocker）改得比我的要求更彻底** —— 不但改了措辞，还**从根上换掉了定级逻辑**（「最高风险」重新定义为「**不可合并**」），并在**两份文档里都保留了自己的错误记录**（"本文/本页上一版……**那是错的**"）。这是很健康的做法。
- **F4 的修复尤其值得表扬** —— 它没有只改数字，而是**给了复跑脚本**。我把脚本**原样跑了一遍**，输出与它表里的 15 行**逐行完全一致**（含顺序与 TOTAL）。这是本队最可验证的一类修复。

**但仍有一条必须修**：**F2 没修净** —— LAYER-INVENTORY 已全部转 two-dot，HTML 的 §6.1 也转了，**但 HTML「逐层清单 L0–L14」表的「上游侵入点」列仍是 5 个 three-dot 旧值**。于是**同一个 HTML 文件内部自相矛盾**：§6.1 说 `src/tools.ts` 是 `+1685/-2335`，§2 的 L10 行仍说 `+1673/-2018`。这正是 F2 要消灭的**同一个"口径混用"病**，只是从一个文件挪到了另一个文件的另一张表。

## R2-1. 第 1 轮 7 条 finding 的处置复验（逐条自跑）

| id | t12 声称 | 我的独立复验 | 判定 |
|---|---|---|---|
| **F1** blocker | 改标题/正文/定级三处，HTML 同步 | 见 R2-2 | ✅ **完全修复** |
| **F2** high | 全表改 two-dot，25 行对拍 0 处不符 | LAYER **25/25 ✅**、HTML §6.1 **25/25 ✅**、**HTML §2 L 表 ✗ 5 处漏改** | ⚠️ **部分修复** |
| **F3** high | 三处 26 → 24 | `find src/gates -type f \| wc -l` ⇒ **24**（= 22 `.ts` + 2 `.json`）；两份文档已无 "26 个文件" | ✅ |
| **F4** high | 15 行、合计 19、附脚本 | **原样跑它的脚本 ⇒ 15 行 / TOTAL 19，与表逐行一致** | ✅ **满分** |
| **F5** medium | :92 补口径 | `:92` 已写明「只覆盖带 `registry.` 前缀」「`registry.ts:850` 已单列」 | ✅ |
| **F6** medium | SVG:320 标 module-local | SVG 已标 `module-local，非导出`；核 `sed -n '305p' src/gates/index.ts` ⇒ `const ALL_GATES = [`（无 export） | ✅ |
| **F7** low | 计数补口径 | 不仅补了口径，还**额外给出 .ts-only 对称读数**（6,735 / 4,381 / 31），我逐条核过全对 | ✅ **超出要求** |

### R2-2. F1 复验（blocker，最关键的一条）

**措辞与归因**（两份文档已一致）：

```sh
$ grep -n "未采纳" docs/LAYER-INVENTORY.md docs/architecture.html
LAYER-INVENTORY.md:538:### 8.2 上游有、fork 未采纳的文件（4 个：上游自 fork 后新增）
LAYER-INVENTORY.md:544:★ **这 4 个不是「被 fork 删除」，而是「上游在分叉点之后自己新增的、fork 尚未采纳」。**
LAYER-INVENTORY.md:564:  风险是「**fork 尚未采纳**」，**不是**「拿不到」。
architecture.html:963:<h3>6.2 上游有、fork 未采纳的文件（4 个：上游自 fork 后新增）</h3>
```

**我独立重跑它引的三条命令**（不是读它的结论）：

```sh
$ for f in src/artifacts.ts src/lineage.ts src/tool-policies.ts src/workspace-audit.ts; do
    printf "%s 98aac03:%s upstream:%s HEAD:%s\n" $f \
      "$(git cat-file -e 98aac03:$f 2>/dev/null && echo P || echo A)" \
      "$(git cat-file -e upstream/main:$f 2>/dev/null && echo P || echo A)" \
      "$(git cat-file -e HEAD:$f 2>/dev/null && echo P || echo A)"; done
src/artifacts.ts        98aac03:A upstream:P HEAD:A
src/lineage.ts          98aac03:A upstream:P HEAD:A
src/tool-policies.ts    98aac03:A upstream:P HEAD:A
src/workspace-audit.ts  98aac03:A upstream:P HEAD:A

$ git diff --name-status 98aac03 upstream/main -- src/ | grep -c '^A'   ⇒ 4
$ git diff --name-status 98aac03 HEAD -- src/ | grep -c '^D'            ⇒ 0
```

**定级修正**（超出我 F1 的要求，方向正确）：`LAYER-INVENTORY.md:565` / `architecture.html:981`「因此它们**不是**最高风险项。**最高风险是「不可合并」** —— 即被双向大改的文件」。
**并保留错误记录**：`LAYER-INVENTORY.md:572` / `architecture.html:984`「★ 上一版……**那是错的**，错误来源是把 `comm -23`（集合差）读成了「fork 删除」」。
⇒ **F1 完全修复，且根因已写进文档，可供后人避坑。**

### R2-3. F2 复验（**发现未修净残部**）

**LAYER-INVENTORY §8.1：脚本逐行对拍 25/25 全中**（0 处不符）。
**HTML §6.1：同样 25/25 全中**，且与 LAYER §8.1 的值**逐行相同**（token 序列完全一致）。

**「真·只增」的 6 处我逐条反查**：

```sh
$ for f in <6 个声称"真·只增"的文件>; do
    echo "$f 上游自fork后改过吗: $(git diff --name-status 98aac03 upstream/main -- $f)"; done
src/client/activity-model.ts  src/web-routes.ts  src/client/locales.ts
src/client/index.tsx          src/tool-names.ts  src/client/icons.tsx     ⇒ 6/6 全空（上游没碰过）
```
⇒ two-dot 下 `-0` 确实意味着上游自 fork 后没碰过，标「真·只增」**正确**。

**★ 但 HTML §2 L 表漏改了 5 个值** —— 见 **F8**。

### R2-4. F4 复验（**我原样跑了它给的脚本**）

```sh
$ pnpm test:gates 2>&1 | tee /tmp/gates13.txt > /dev/null
$ python3 - <<'PY'    # ← 逐字照抄文档 §10 给出的脚本
... (文档原脚本) ...
PY
  4  scripts/verify-runtime-integration.test.mjs
  2  scripts/verify-input-requires.test.mjs
  1  scripts/gate-baseline-known-failures.test.mjs
  1  scripts/gate-contract-build-artifacts.test.mjs
  1  scripts/gate-falsification-pairs.test.mjs
  1  scripts/gate-input-wiring.test.mjs
  1  scripts/gate-producer-consumer.test.mjs
  1  scripts/gate-repair-completion.test.mjs
  1  scripts/gate-reviewed-passthrough.test.mjs
  1  scripts/gate-source-reading-convention.test.mjs
  1  scripts/gate-stale-module.test.mjs
  1  scripts/gate-t1-completion-probe.test.mjs
  1  scripts/gate-worktree-arrival.test.mjs
  1  scripts/verify-admission.test.mjs
  1  scripts/verify-unified-pipeline.test.mjs
TOTAL = 19  FILES = 15
```
**与文档表的 15 行逐行一致，合计 19 一致，文件名与顺序一致。** ⇒ **F4 满分**；它自陈的成因（把「✖ 出现次数」当「测试数」，✖ 在子测试与汇总块重复出现）与我第 1 轮的观察吻合（我当时正是先数出 38 才发现重复）。

### R2-5. F3 / F7 复验

```sh
$ find src/gates -type f | wc -l          ⇒ 24
$ find src/gates -name '*.ts' | wc -l     ⇒ 22
$ find src/gates -name '*.json' | wc -l   ⇒ 2      # 22+2=24 ✅ 口径自洽
$ grep -c "26 个文件" docs/LAYER-INVENTORY.md docs/architecture.html ⇒ 0
```
**F7 超出要求**，新增的对称口径我逐条核过**全部正确**：

```sh
$ find src/client -type f | xargs wc -l | tail -1                                    ⇒ 9666 ✅
$ find src/client -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | tail -1 ⇒ 6735 ✅
$ find src/client -type f | wc -l                                                    ⇒ 31   ✅
$ git ls-tree -r upstream/main ... client 仅 .ts/.tsx                                 ⇒ 4381 ✅
```

### R2-6. 四项验收硬指标（重跑，全部通过）

```sh
$ python3 -c "import xml.etree.ElementTree as ET; ET.parse('docs/architecture-pipeline.svg')"   ⇒ OK
$ grep -cE '<(link|script|img)\b' docs/architecture.html                                        ⇒ 0
$ grep -oE 'https?://[^"'"'"' <>]*' docs/architecture.html | sort -u  ⇒ http://www.w3.org/2000/svg（仅命名空间）
$ grep -oE '(href|src)="[^"]*"' docs/architecture.html | grep -c ':'                            ⇒ 0
$ grep -rn "^export const id = '" src/gates/*/*.ts | wc -l                                      ⇒ 17
$ for p in admission contract dispatch completion delivery runtime; do
    grep -rh "^export const id = '" src/gates/$p/*.ts | wc -l; done                             ⇒ 3 3 3 4 2 2
```
⇒ 判据集合 **17** ✅、分组 **3/3/3/4/2/2** ✅、SVG 可解析 ✅、HTML 零外网 ✅。

### R2-7. 回归检查（修复没改坏原判 pass 的部分）

| 项 | 文档声称 | 我的读数 | 判定 |
|---|---|---|---|
| `src/` 文件数 / 行数 | 95 / 47,310 | **95 / 47310** | ✅ |
| `quality-gates.ts` | fork 2,520 / 上游 2,109 | **2520 / 2109** | ✅ |
| client 新增文件 | 13 | **13** | ✅ |
| 判据夹具 / 测试文件 | 88 / 130 | **88 / 130** | ✅ |
| `tool-names.ts` | +14/-0 | **14/0** | ✅ |
| 18 个 commit 溯源 | 全部可解析 | **18/18 ok** | ✅ |
| SVG 内判据 id | 17 | **17**（排掉 2 个文件名误配） | ✅ |

```sh
registry.ts:288 -> export const INSERTION_POINTS = Object.freeze([
registry.ts:44  -> export type GateVerdict =
absorb.ts:268   -> export function appliesTo(ctx: AbsorbContext | undefined): boolean {
convene.ts:449  -> export function appliesTo(_ctx: ConveneContext | undefined): boolean {
index.ts:305    -> const ALL_GATES = [
index.ts:459    -> export function buildRegistry() {
index.ts:468    -> export const registry = buildRegistry()
```
**⇒ 无回归。**

## R2-8. Findings（第 2 轮）

### F8 — **HIGH**：F2 未修净 —— HTML「逐层清单」表的「上游侵入点」列仍是 5 个 three-dot 旧值

- **文件:行**：`docs/architecture.html:203`（L7）`src/scheduler.ts` **`+737/-18`**｜`:224`（L10）`src/tools.ts` **`+1673/-2018`**｜`:245`（L13）`ActivityPanel.tsx` **`+94/-525`** 与 `ActivityPanel.module.css` **`+564/-345`**
- **问题**：这 4 个 token 是 **three-dot** 值，而**同一文件的 §6.1 已改成 two-dot**。文件内部因此自相矛盾：

| 位置 | 文档值 | two-dot 真值 | 口径 |
|---|---|---|---|
| HTML **§6.1** `src/scheduler.ts` | `+738 / -46` | **+738/-46** | ✅ two-dot |
| HTML **§2 L7**（:203）`src/scheduler.ts` | **`+737/-18`** | **+738/-46** | ❌ **three-dot** |
| HTML **§6.1** `src/tools.ts` | `+1685 / -2335` | **+1685/-2335** | ✅ two-dot |
| HTML **§2 L10**（:224）`src/tools.ts` | **`+1673/-2018`** | **+1685/-2335** | ❌ **three-dot** |
| HTML **§6.1** `ActivityPanel.tsx` | `+94 / -530` | **+94/-530** | ✅ two-dot |
| HTML **§2 L13**（:245）`ActivityPanel.tsx` | **`+94/-525`** | **+94/-530** | ❌ **three-dot** |
| HTML **§6.1** `ActivityPanel.module.css` | `+564 / -356` | **+564/-356** | ✅ two-dot |
| HTML **§2 L13**（:245）`ActivityPanel.module.css` | **`+564/-345`** | **+564/-356** | ❌ **three-dot** |

- **我的回源**（对照实验确认这些确实是 three-dot，而非第三种口径）：

```sh
$ git diff --numstat upstream/main HEAD -- src/scheduler.ts                ⇒ 738  46      # two-dot
$ git diff --numstat 98aac03 HEAD -- src/scheduler.ts                      ⇒ 737  18      ← 与 HTML:203 逐字相同
$ git diff --numstat upstream/main HEAD -- src/tools.ts                    ⇒ 1685 2335
$ git diff --numstat 98aac03 HEAD -- src/tools.ts                          ⇒ 1673 2018     ← 与 HTML:224 逐字相同
$ git diff --numstat upstream/main HEAD -- src/client/ActivityPanel.tsx    ⇒ 94   530
$ git diff --numstat 98aac03 HEAD -- src/client/ActivityPanel.tsx          ⇒ 94   525      ← 与 HTML:245 逐字相同
$ git diff --numstat upstream/main HEAD -- src/client/ActivityPanel.module.css ⇒ 564 356
$ git diff --numstat 98aac03 HEAD -- src/client/ActivityPanel.module.css   ⇒ 564  345      ← 与 HTML:245 逐字相同
```

- **对照：LAYER-INVENTORY 的同一批位置全部已正确转成 two-dot**，所以**只有 HTML 落后**：
  `LAYER-INVENTORY.md:742`（L7 `+738/-46（two-dot）`）✅｜`:745`（L10 `+1685/-2335（two-dot）`）✅｜`:748`（L13 `+94/-530（two-dot）`）✅｜`:463`（§7.6 `+94/-530`、`+564/-356`）✅
- **影响**：HTML 是「给人看的入口」，而 §2 的 L 表正是**最容易被摘引**的那张（它按层列「上游侵入点」）。读者若从 L7/L10/L13 行摘数字，拿到的仍是第 1 轮那个**低报冲突面**的旧值 —— 恰好是 F2 要消灭的东西。同一文件两处给出不同数字，会直接动摇读者对整份文档的信任。
- **必须怎么修**：把 `:203`、`:224`、`:245` 四处改为 two-dot 值（`+738/-46`、`+1685/-2335`、`+94/-530`、`+564/-356`），与 §6.1 及 LAYER §11 一致。建议全文正则再扫一遍：
  ```sh
  grep -nE '\+737/-18|\+1673/-2018|\+94/-525|\+564/-345|\+466/-0|\+202/-0' docs/architecture.html docs/LAYER-INVENTORY.md
  ```
  （`+466/-0`、`+202/-0`、`+1295/-8` 的残留命中是**刻意的** —— 它们在 §6.1 的「three-dot 旧值 → two-dot」对拍表里作对照，**不要删**。）

### F9 — **LOW**：`LAYER-INVENTORY.md:389` 的「755 行」是第三种口径，与全文不一致

- **文件:行**：`docs/LAYER-INVENTORY.md:389`（§7.1 worktree 表「上游侵入点」栏）：「零（新文件）；但 `src/scheduler.ts` 有 `755` 行改动去调它」
- **问题**：`755` 既不是 two-dot 的 `738/-46`，也不是 three-dot 的 `737/-18`，而是 **three-dot 的 737+18 总变动行数**（`--stat` 意义上的 churn）。全文其余各处已统一到 two-dot 的 `+738/-46`，**这一处是漏网的第三种写法**。
- **我的回源**：

```sh
$ git diff --numstat 98aac03 HEAD -- src/scheduler.ts | awk '{print $1+$2}'
755                                    ← 就是它
$ git diff --numstat upstream/main HEAD -- src/scheduler.ts
738     46                             ← 全文其余处用的口径
$ grep -rn "755" docs/*.md
docs/LAYER-INVENTORY.md:389: ... 但 `src/scheduler.ts` 有 `755` 行改动去调它   ← 唯一一处
```
- **影响**：低。§11 的 L7 行已写对（`+738/-46（two-dot）`），读者大概率以那张表为准；但既然本次已统一口径，留一个孤儿数字会让人怀疑收录不全。
- **必须怎么修**：改为「但 `src/scheduler.ts` 有 `+738 / -46` 改动（two-dot）去调它」；若要保留 churn 语义，须显式标注「（737+18 总变动行数，非 two-dot）」。

## R2-9. 裁决

**verdict = `needs_revision`**

| id | severity | 位置 | 一句话 | 状态 |
|---|---|---|---|---|
| F1 | ~~blocker~~ | `LAYER-INVENTORY.md:538-574` · `architecture.html:963-985` | 4 个文件归因方向 + 风险定级 | ✅ **已修复（复验通过）** |
| F2 | high | `LAYER-INVENTORY.md:483-535` · `architecture.html:907-935` | 全表 three-dot → two-dot | ⚠️ LAYER 与 HTML§6.1 已修；**HTML §2 漏改 → 见 F8** |
| F3 | high | `LAYER-INVENTORY.md:579` · `architecture.html:131,988` | 26 → 24 | ✅ **已修复** |
| F4 | high | `LAYER-INVENTORY.md:606-640` 附近 | 失败分布 15 行 / 合计 19 | ✅ **已修复（附可复跑脚本，原样跑通）** |
| F5 | medium | `LAYER-INVENTORY.md:92` | 调用点口径澄清 | ✅ **已修复** |
| F6 | medium | `architecture-pipeline.svg:320` | `ALL_GATES` 非导出 | ✅ **已修复** |
| F7 | low | 各处计数 | 口径标注 | ✅ **已修复（超出要求）** |
| **F8** | **high** | **`architecture.html:203, 224, 245`** | **F2 残部：L 表 5 个 three-dot 旧值，与同文件 §6.1 冲突** | ❌ **待修** |
| **F9** | **low** | **`LAYER-INVENTORY.md:389`** | **`755` 为第三种口径（three-dot churn），与全文不一致** | ❌ **待修** |

**放行条件（很轻，预计 5 分钟）**：
1. 改 `architecture.html` 的 4 处数字（203 / 224 / 245）。
2. 跑一次 F8 给的残留扫描，确认无 three-dot 残值（注意**别删** §6.1 对拍表里刻意保留的旧值）。
3. 改 `LAYER-INVENTORY.md:389` 的 `755`。
4. 改完重跑 `ET.parse` 与判据计数自证未改坏（我预期不变）。

**为什么不是 `pass`**：F8 让**同一个 HTML 文件内部自相矛盾**，而 §2 的 L 表恰是最易被摘引的那张表。F2 的**目的**正是消灭口径混用；留一半等于没达目的。**但这是"收尾没扫干净"，不是"改错了方向"**，故只挂 1 条 high，其余结论不动。

**为什么不是 `reject`**：7 条 finding 中 **6 条修复到位并经我独立复跑证实**，其中 **F1（blocker）与 F4 的修复质量超出要求**；四项验收硬指标全部通过；**无任何回归**。缺陷是**局部收尾**，定点可修。

---
---

# 第 3 轮复核（t15）：t14 修复后的复验

> **复核人**：reviewer（t15，attempt `8ac9077a-9f07-4a05-8730-66eeb8632570`）
> **复核对象**：t14（archaeologist 的 round-3 修复，处置 F8/F9）｜ **测量点**：HEAD = `b8f357e`（未变）
> **裁决**：**pass** —— F8/F9 均已修复且经我独立复跑证实；**全文口径审计 45 处无一处误用**；无回归

## R3-0. 结论摘要

**两条 finding 都修好了，而且修得干净。**

- **F8**（HTML §2 L 表的 5 个 three-dot 旧值）：`architecture.html:203/:224/:245` 已全部换为 two-dot，**逐个与 `git diff --numstat upstream/main HEAD` 真值吻合**；t14 声称的「残留扫描 CLEAN」被我复跑证实。
- **F9**（`LAYER-INVENTORY.md:389` 的「755」churn 口径）：已改为 `+738 / -46`（two-dot）并附命令。t14 主动说明「**选择不保留 churn 语义**」—— 这个取舍我认可：全文只留一个口径，比保留一个需要读者记住「这个数是 churn 不是 two-dot」的例外更不容易出错。

**更重要的是，我这次做了一次比前两轮都更强的检查**：写脚本把**两份文档里每一个能无歧义绑定到文件的 `+a/-b` 数字**都拉出来，与 `git diff --numstat upstream/main HEAD -- <file>` 逐一对拍。

> **45 处无歧义绑定，全部与 two-dot 真值一致，0 处误用。**
> 另 14 处因一行内含多文件/多数字而无法自动绑定（需人工看），我抽查了其中会引发 F8 同类问题的两处，确认是我的启发式误配、**不是文档错误**（见 R3-2）。

⇒ **口径混用这个病（F2 → F8 的根因）现在被全文清干净了。**

## R3-1. F8 / F9 逐条复验

### F8 复验（HTML §2 L 表）

```sh
$ grep -nE '\+737/-18|\+1673/-2018|\+94/-525|\+564/-345' docs/architecture.html docs/LAYER-INVENTORY.md
（无输出，exit=1）                          ← 残留扫描 CLEAN ✅
```

**逐值对照 git 真值**（`git diff --numstat upstream/main HEAD -- <f>`）：

| 位置 | 第 2 轮（错） | 现在 | git 真值 | 判定 |
|---|---|---|---|---|
| `architecture.html:203` L7 `src/scheduler.ts` | +737/-18 | **+738 / -46** | `738  46` | ✅ |
| `architecture.html:224` L10 `src/tools.ts` | +1673/-2018 | **+1685 / -2335** | `1685 2335` | ✅ |
| `architecture.html:245` L13 `ActivityPanel.tsx` | +94/-525 | **+94 / -530** | `94   530` | ✅ |
| `architecture.html:245` L13 `ActivityPanel.module.css` | +564/-345 | **+564 / -356** | `564  356` | ✅ |

**且同文件 §6.1 与 §6.4 现已与 L 表一致**（我核 `:924 / :928 / :930 / :933 / :937 / :1007`），**HTML 内部的自我矛盾已消除**。

### F9 复验（`LAYER-INVENTORY.md:389`）

```sh
$ sed -n '389p' docs/LAYER-INVENTORY.md
| **上游侵入点** | 零（新文件）；但 `src/scheduler.ts` 有 **+738 / -46** 改动
  （two-dot：`git diff --numstat upstream/main HEAD -- src/scheduler.ts`）去调它 |
```

⇒ 与 §8.1(`:512`)、§11(`:742`)、HTML(`:203`/`:925`) **四处对 scheduler 的说法完全一致** ✅。全文 `grep '755'` 只剩 `REVIEW-ARCHITECTURE.md`（我的报告引用该缺陷）与无关文件的 CSS 色值 `#475569`，**无残留** ✅。

### 刻意保留的对照值未被误删 ✅

我第 2 轮特意提醒「§6.1 对拍表里的 three-dot 旧值是**刻意保留**的，不要删」—— t14 保住了，且都带说明：

```
docs/architecture.html:924  …（three-dot 旧值 +1295/-8 是误导，见 §6.1 口径说明）
docs/architecture.html:928  …（双向；旧值 +466/-0 的「只增」是 three-dot 假象）
docs/architecture.html:933  …（旧值 +202/-0 的「只增」是 three-dot 假象）
docs/LAYER-INVENTORY.md:500-502  同一三行（three-dot 列 + two-dot 列并排）
```
⇒ 既清掉了误用，又保留了「为什么换口径」的证据链。**这是正确的取舍。**

## R3-2. ★ 全文口径审计（本轮新增的最强检查）

写脚本把两份文档里**每一行内能无歧义绑定「1 个文件 ↔ 1 个 `+a/-b`」**的配对全部抽出，逐个与 two-dot 真值对拍：

```
unambiguous bindings verified OK: 45
skipped (multi-path/multi-pair lines): 14
MISMATCHES:
   (LAYER-INVENTORY.md, 436, 'src/client/locales.ts', '+153/-1', 'two-dot=+81/-0', 'OTHER')
   (LAYER-INVENTORY.md, 747, 'src/tools/edit-plan.ts', '+153/-1', 'two-dot=+346/-0', 'OTHER')
```

**这两条经我人工核对，确认是我的启发式误配、不是文档错误**：

```
L436: | **上游侵入点** | `StagingPlanEditor.tsx`（+153/-1）；`src/client/locales.ts`（+81） |
L747: | **L12** | ... | `StagingPlanEditor.tsx` +153/-1 |
```
脚本把 `+153/-1` 绑到了同行的 `locales.ts` / `edit-plan.ts`，而它真正的属主是 `StagingPlanEditor.tsx`：

```sh
$ git diff --numstat upstream/main HEAD -- src/client/StagingPlanEditor.tsx   ⇒ 153  1   ← 与 +153/-1 吻合
$ git diff --numstat upstream/main HEAD -- src/client/locales.ts              ⇒ 81   0   ← 文档写「（+81）」正确
```

⇒ **L436 与 L747 都正确**；两者都是「一行里列了多个文件」导致脚本错绑。**45 处自动核对全中、2 处人工核对全对 ⇒ 全文 0 处口径误用。**

> 附带确认：R2 时 L436 那行的 `+81`（locales）我没查过，本轮顺手核了 ⇒ `81/0` 正确。

## R3-3. 四项验收硬指标（重跑，全部通过）

```sh
$ python3 -c "import xml.etree.ElementTree as ET; ET.parse('docs/architecture-pipeline.svg')"   ⇒ OK
$ grep -cE '<(link|script|img)\b' docs/architecture.html                                        ⇒ 0
$ grep -oE 'https?://[^"'"'"' <>]*' docs/architecture.html | sort -u  ⇒ http://www.w3.org/2000/svg（仅命名空间）
$ grep -oE '(href|src)="[^"]*"' docs/architecture.html | grep -c ':'                            ⇒ 0
$ grep -rn "^export const id = '" src/gates/*/*.ts | wc -l                                      ⇒ 17
$ for p in admission contract dispatch completion delivery runtime; do
    grep -rh "^export const id = '" src/gates/$p/*.ts | wc -l; done                             ⇒ 3 3 3 4 2 2
```
⇒ 判据集合 **17** ✅、分组 **3/3/3/4/2/2** ✅、SVG 可解析 ✅、HTML 零外网 ✅。

## R3-4. 本轮新鲜抽检（不重复前两轮已核项）

| # | 断言 | 我的回源 | 判定 |
|---|---|---|---|
| N1 | SVG 第 ② 段列出 6 处求值调用点 | `grep -c "registry.evaluate" docs/architecture-pipeline.svg` ⇒ 5 行；真代码调用点 `grep -rn "registry\.evaluate(" src/ \| grep -vE ':[0-9]+:\s*(\*\|//)'` ⇒ **6**（§2 段 5 行 + §5 段 1 处汇总表述） | ✅ |
| N2 | SVG 内判据 id 集合 = 17 | 去重命中 20，扣除 `completion.ts`/`dispatch.ts` 两个文件名误配 ⇒ **17** | ✅ |
| N3 | SVG 行号引用仍有效（编辑后未错位） | `registry.ts:288`=INSERTION_POINTS、`:44`=GateVerdict、`absorb.ts:268`=appliesTo、`convene.ts:449`=appliesTo、`index.ts:305`=const ALL_GATES、`:459`=buildRegistry、`:468`=registry ⇒ **7/7 命中** | ✅ |
| N4 | `StagingPlanEditor.tsx` 的 `+153/-1`（R2 未查） | `git diff --numstat upstream/main HEAD -- src/client/StagingPlanEditor.tsx` ⇒ `153 1` | ✅ |
| N5 | `src/client/locales.ts` 的「+81」（R2 未查） | 同上 ⇒ `81 0` | ✅ |

## R3-5. 回归检查（修复没改坏任何先前判对的内容）

| 项 | 文档声称 | 我的读数 | 判定 |
|---|---|---|---|
| `src/` 文件数 / 行数 | 95 / 47,310 | **95 / 47310** | ✅ |
| client 新增文件 / 目录文件数 | 13 / 31 | **13 / 31** | ✅ |
| 判据夹具 / 测试文件 | 88 / 130 | **88 / 130** | ✅ |
| `src/gates/` 文件数 | 24 | **24** | ✅ |
| `tool-names.ts` | +14/-0 | **+14/-0** | ✅ |
| `quality-gates.ts`（fork） | 2,520 | **2520** | ✅ |
| **F1 实质**（上游新增 4 / fork 删除 0） | — | `grep -c '^A'` ⇒ **4**；`grep -c '^D'` ⇒ **0** | ✅ |
| F1/F8 措辞 | 「未采纳」 | LAYER **4** 处、HTML **4** 处 | ✅ |

**⇒ 无回归。**

## R3-6. 裁决

**verdict = `pass`**

| id | severity | 状态 |
|---|---|---|
| F1 | ~~blocker~~ | ✅ 已修复（第 2 轮复验） |
| F2 | ~~high~~ | ✅ 已修复（第 2 轮 LAYER+HTML§6.1；第 3 轮 HTML§2 补完 ⇒ 全文 0 处误用） |
| F3 | ~~high~~ | ✅ 已修复 |
| F4 | ~~high~~ | ✅ 已修复（附可复跑脚本） |
| F5 / F6 / F7 | ~~medium/low~~ | ✅ 已修复 |
| F8 | ~~high~~ | ✅ **已修复**（本轮复验：4 值换 two-dot + 残留扫描 CLEAN + 与 §6.1/§6.4 一致） |
| F9 | ~~low~~ | ✅ **已修复**（本轮复验：`755` → `+738 / -46`，四处说法一致） |

**本轮无新 finding。**

**判 pass 的依据（覆盖面）**：
1. **F8/F9 逐条复验通过**，且值逐个与 `git diff --numstat upstream/main HEAD` 真值吻合（R3-1）。
2. **全文口径审计 45/45 无歧义绑定全中**，另 2 处人工核对全对 ⇒ **0 处口径误用**（R3-2）—— 这是我针对 F2→F8 这条「反复出现同一类错」的根因做的**根因级验证**，不是只看那两个点了没有。
3. **四项验收硬指标全过**（R3-3）。
4. **本轮新鲜抽检 5 项全中**（R3-4），含 2 项我前两轮没查过的数字。
5. **无回归**（R3-5）。
6. 刻意保留的 three-dot 对照值未被误删，且带说明（R3-1）。

**为什么这次可以给 pass**：前两轮我判 needs_revision，都是因为「同一个病还有残留」；本轮我**不再抽点，而是把全文所有可机器核对的口径一次性验完**（45 处），结论是**没有残留**。验收硬指标、抽样回源、回归三项也全过。**该放行了。**

**一点流程观察（非 finding，供队长参考）**：F2→F8 这条链说明「口径类错误不会只出现在你查到的那一处」。第 2 轮我只点了 HTML 的 4 处，t14 修完后我又扩到全文扫描才发现 —— **若第 2 轮我就做全文审计，可以省掉一个来回**。建议把「口径类 finding 必须附全量扫描脚本」写成本队惯例。

---
---

# 对抗性复核（**独立第四轮**）：同三份产出

> **复核人**：test-triage（t11）。**与前几轮的关系**：t10 跑完三轮后判 `pass`；**本轮是另一次独立复核**
> （任务书点名要求"一个面"：抽检回源、核判据集合、验图、核归因），**不与 t10 共享脚本或结论**。
> **测量点**：HEAD = `b8f357e` ｜ `upstream/main` = `1094b84` ｜ merge-base = `98aac03`
> **纪律**：本文**不修改**任何被审文件。每条 finding 附可复跑命令与读数。
> **裁决**：**needs_revision**（0 blocker + 3 high + 2 medium）

---

## R4-0. 结论摘要

| id | severity | 文件:行 | 一句话 |
|---|---|---|---|
| **F1** | **high** | `LAYER-INVENTORY.md:620` | ★ 把一条**仍然成立**的断言标成了「已过期」：`THREE-LINE-PLAN.md` 的「账本未接入生产完成路径」**至今仍真**；举证用的 `71de42a` 接的是**另一条线**（friction/experience），**不是账本** |
| **F2** | **high** | `LAYER-INVENTORY.md:31,751` | `src/` 行数与文件数**口径与命令不自洽**：文档写 **47,310 行 / 95 文件**，但它**自己给的命令**输出 **47,283 / 86** |
| **F3** | **high** | `LAYER-INVENTORY.md:621,666` | 「现状 **19 fail / 1415 pass**」在其**自己声明的测量点 `b8f357e`** 上不可复现：我**两次**测得 **20 fail / 1413 pass** |
| **F4** | medium | `LAYER-INVENTORY.md:36` | `src/quality-gates.ts` 现状写 **2,520**，实测 **2,512** |
| **F5** | medium | `LAYER-INVENTORY.md:620` | 引用行号错：该断言在 `THREE-LINE-PLAN.md:**11**`，文档写 **:6** |

★ **复核通过且质量高的部分**：**判据集合 17/17 逐条相等** · **分组计数 3/3/3/4/2/2 完全正确** ·
**SVG 9 处 `文件:行` 标注 9/9 命中** · **SVG 可被 XML 解析** · **HTML 零外网引用** ·
**t10 的 blocker（4 文件归因）与 high（§8.1 口径）我独立复跑确认均已修好**。

---

## R4-1. 覆盖面（先给读数）

### R4-1.1 抽检的清单断言（**10 条**，逐条回源）

| # | 断言（文件:行） | 回源命令 | 读数 | 判定 |
|---|---|---|---|---|
| A1 | `src/` 18,793 → **47,310** 行（`:31`） | 见 F2 | **47,283** | ❌ F2 |
| A2 | `src/` 文件 40 → **95**（`:751`） | `git ls-tree -r HEAD --name-only -- src/ \| wc -l` | **95**（但 `.ts/.tsx` 口径 = **86**） | ❌ F2 |
| A3 | `quality-gates.ts` 2,109 → **2,520**（`:36`） | `git cat-file -p upstream/main:src/quality-gates.ts \| wc -l` / `wc -l < src/quality-gates.ts` | **2109** ✅ / **2512** | ❌ F4 |
| A4 | `src/gates/` 上游**整个目录不存在** | `git ls-tree -r upstream/main --name-only -- src/gates \| wc -l` | **0** | ✅ |
| A5 | 工具面 **15 / 4 / 11**（`:346`） | 读 `src/tool-names.ts` 三个常量 | **15 / 4 / 11** | ✅ |
| A6 | `src/tool-names.ts` **+14 / -0**（`:334`） | `git diff --numstat upstream/main HEAD -- src/tool-names.ts` | **14 / 0** | ✅ |
| A7 | 88 判据夹具 / 130 测试文件（`:596-599`） | `ls scripts/gate-*.test.mjs \| wc -l` / `ls scripts/*.test.mjs \| wc -l` | **88** / **130** | ✅ |
| A8 | `kind-requirements.ts` 不是判据（`:162`） | `grep -c "export const id" src/gates/completion/kind-requirements.ts` | **0** | ✅ |
| A9 | §8.1 `quality-gates.ts` two-dot = **+1369 / -958**（`:491`） | **在文档自己的测量点**：`git diff --numstat upstream/main b8f357e -- src/quality-gates.ts` | **1369 / 958** | ✅ 逐字命中 |
| A10 | 大宗侵入点为 `src/tools.ts` 与 `src/quality-gates.ts`（`:519` 区） | `git diff --numstat upstream/main HEAD -- src/ \| sort -k1 -rn \| head` | 前二正是这两者 | ✅ |

★ **A9 单独说明**：我**先在未冻结 HEAD 的主树上量得 1360/957**，与文档的 1369/958 不符；
**回到文档声明的 `b8f357e` 复量 ⇒ 1369/958 逐字命中**。
⇒ **不是文档的错，是 HEAD 漂移**（主树已推进到 `5cc8e40`）。**计为复核通过**，并留痕以免下一个人重蹈。

### R4-1.2 抽检的图中标注（**9 处**，逐处回源）

SVG 为每条判据标了 `文件:行 id`。**逐个 `sed -n` 核对该行确为 `export const id`**：

| # | SVG 标注 | 回源 | 判定 |
|---|---|---|---|
| G1 | `backtest.ts:360 · :82 id` | `sed -n '82p' src/gates/completion/backtest.ts` | ✅ |
| G2 | `changed-paths.ts:160 · :49 id` | `sed -n '49p' src/gates/dispatch/changed-paths.ts` | ✅ |
| G3 | `plan-reviewed.ts:114 · :67 id` | `sed -n '67p' src/gates/dispatch/plan-reviewed.ts` | ✅ |
| G4 | `r5.ts:118 · :95 id` | `sed -n '95p' src/gates/completion/r5.ts` | ✅ |
| G5 | `coverage.ts:191 · :49 id` | `sed -n '49p' src/gates/delivery/coverage.ts` | ✅ |
| G6 | `convergence.ts:181 · :73 id` | `sed -n '73p' src/gates/delivery/convergence.ts` | ✅ |
| G7 | `verify-command.ts:586 · :63 id` | `sed -n '63p' src/gates/contract/verify-command.ts` | ✅ |
| G8 | `stall.ts:127 · :60 id · :84` | `sed -n '60p' src/gates/runtime/stall.ts` | ✅ |
| G9 | `worktree.ts:169 · :77 id` | `sed -n '77p' src/gates/dispatch/worktree.ts` | ✅ |

**⇒ 9/9 命中。**

### R4-1.3 判据集合与分组计数（**逐条相等**）

```sh
$ grep -rn "^export const id = '" src/gates/*/*.ts | sed "s/.*id = '//;s/'.*//" | sort
admission.absorb · admission.checkpoint · admission.convene
completion.backtest · completion.mutation · completion.r5 · completion.verify-rerun
contract.build-artifact-scope · contract.task-atomicity · contract.verify-command
delivery.convergence · delivery.coverage
dispatch.changed-paths · dispatch.plan-reviewed · dispatch.worktree
runtime.liveness · runtime.stall
# ⇒ 17 条
```
**与 SVG / HTML 抽出的集合 `diff` ⇒ 两侧皆无差异（17/17 逐条相等）**：

```sh
$ grep -oE '(admission|contract|dispatch|completion|delivery|runtime)\.[a-z][a-z0-9-]*' docs/architecture-pipeline.svg \
  | grep -vE '\.(ts|test|mjs|json)$' | sort -u | wc -l      # ⇒ 17
$ ... 同法对 docs/architecture.html                          # ⇒ 17
```
★ **已排除 `kind-requirements.ts` 被误当判据**（`grep -c "export const id"` ⇒ **0**，与文档 `:162` 一致）。
★ **陷阱留痕**：朴素正则会把**文件名**（`completion.ts` / `delivery.ts` / `dispatch.ts`）当作判据 id，
并会把 `completion.r5` 截成 `completion.r` ⇒ **必须过滤 `\.(ts|test|mjs|json)$` 并让末段允许数字**。

**分组计数**（源码实测 vs SVG 标签）：

| 插入点 | 源码 | SVG 标签 |
|---|---:|---|
| admission | 3 | `>3 条 ｜ 判准入门，不判契约合法性<` ✅ |
| contract | 3 | `>3 条 ｜ 契约【写】得对不对<` ✅ |
| dispatch | 3 | `>3 条 ｜ 这次派发【做】得对不对<` ✅ |
| completion | 4 | `>4 条 ｜ 顺序 = 先便宜后贵<` ✅ |
| delivery | 2 | `>2 条 ｜ 先问有没有人做，再问收敛<` ✅ |
| runtime | 2 | `>2 条 ｜ 记录，不拒绝<` ✅ |

⇒ **3 / 3 / 3 / 4 / 2 / 2，与验收要求逐项相等。**

### R4-1.4 文件能否打开

```sh
$ python3 -c "import xml.etree.ElementTree as ET; ET.parse('docs/architecture-pipeline.svg'); print('SVG parses OK')"
SVG parses OK

$ grep -oE '(href|src)="https?://[^"]*"' docs/architecture.html
（无输出 ⇒ 零外部资源引用）

$ grep -oE 'https?://[^"'"'"' >]*' docs/architecture.html | sort | uniq -c
   1 http://www.w3.org/2000/svg        ← SVG XML 命名空间，不是网络请求
```
⇒ **SVG 可解析 ✅；HTML 零外网依赖 ✅。**

---

## R4-2. t10 的两条重点，我独立复跑后确认**已修好**

**① 4 文件归因（t10 的 blocker）**
```sh
$ for f in src/artifacts.ts src/lineage.ts src/tool-policies.ts src/workspace-audit.ts; do
    git cat-file -e 98aac03:$f 2>/dev/null && echo "PRESENT $f" || echo "ABSENT  $f"; done
ABSENT ×4
$ git diff --name-status 98aac03 upstream/main -- src/ | grep '^A'
A	src/artifacts.ts · A	src/lineage.ts · A	src/tool-policies.ts · A	src/workspace-audit.ts
$ git diff --name-status 98aac03 HEAD -- src/ | grep -c '^D'
0
```
⇒ **裁定：是「上游新增」，不是「fork 删除」**（三条复现）。
★ 文档现在（`:543`）**标题已改对**，且**风险方向也改对了**：
「这 4 个可以**干净合并**……风险是『fork 尚未采纳』，**不是**『拿不到』」，
并指出**最高风险是「不可合并」**（`src/tools.ts` / `src/quality-gates.ts` 那些双向大改的文件）。
⇒ **本轮不重复计为 finding。**

**② §8.1 口径（t10 的 high）**
文档 `:486` 现用 **two-dot** 并**给出与 three-dot 的对照**；在文档测量点上 **1369/958 逐字命中**。
⇒ **"误报 40~110 倍"那条已消除。本轮不重复计为 finding。**

---

## R4-3. Findings

### F1 — **HIGH**：把一条**仍然成立**的断言标成了「已过期」

- **文件:行**：`docs/LAYER-INVENTORY.md:620`
- **文档原话**：
  > `docs/THREE-LINE-PLAN.md:6`：「账本未接入生产完成路径」→ 现状有生产调用方（`71de42a`「the friction/experience line gets a production caller」）→ **已过期**

- **问题**：`71de42a` 接的是 **friction/experience 那条线**（`readExperienceDispatch` → `scripts/friction-triage.mjs`），
  **不是变异测试的"账本"**。**账本那条断言至今仍真**：

```sh
$ grep -rn ledger src/tools/update-task/          # 文档自己引的那个判据
（无输出，exit=1）                                  # ⇒ 仍为空 ⇒ 断言【没】过期

$ git grep -n "createMutationLedger" -- .
docs/THREE-LINE-PLAN.md:79 · docs/THREE-LINE-PLAN.md:160     # 只有【该文档自己】，代码里零

$ git grep -n "mutationLedger" -- .
docs/THREE-LINE-PLAN.md:124 / :212 / :213                    # 同样只在文档里

$ git show --stat 71de42a | head -8
feat(t26): the friction/experience line gets a production caller; and t43 refutes its own premise
# ⇒ 提交信息逐字说的是 friction/experience，不是 ledger
```
★ `grep -rni ledger src/` 的 4 处命中**全部无关**（`entities.ts:4136` 散文 · `amend-task.ts:24,27` *revisions ledger* · `index.ts:160` 工具描述文案）。

- **影响**：不是措辞问题。`THREE-LINE-PLAN.md` §4「账本接入生产路径」是**一条尚未完成的接线**，
  而复审表把它标成「已过期」⇒ 读者会**认为那条线已经做完** ⇒ **一条仍缺的接线被写成了历史**。
  ★ 用本仓的定性：这是**「把『我没找到引用』读成『它已经不需要了』」** —— 与「把『读不到』读成『没有』」同族。
- **必须怎么修**：
  1. `:620` 的判定改「**仍成立**」，并附复跑命令（`grep -rn ledger src/tools/update-task/` ⇒ 空；
     `git grep createMutationLedger` ⇒ 仅该文档自身）；
  2. 若保留 `71de42a`，须**改述它接的是哪条线**，**不得**用它给账本那条断言作证；
  3. 顺带修行号（见 F5）。

### F2 — **HIGH**：`src/` 行数与文件数**口径与命令不自洽，且都不可复跑**

- **文件:行**：`docs/LAYER-INVENTORY.md:31`（行数）· `:751`（行数与文件数）
- **文档原话**：
  > `:31` | `src/` 总行数 | 18,793 | **47,310** | `find src -name '*.ts' -o -name '*.tsx' \| xargs wc -l \| tail -1` |
  > `:751` `src/` 从 18,793 行 → **47,310** 行；文件从 40 → **95**

- **实测**：**它自己给出的命令输出不是它写的数**：
```sh
$ find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1
   47283 total                        # 文档写 47,310（差 27）
$ find src \( -name '*.ts' -o -name '*.tsx' \) | while read f; do wc -l < "$f"; done | paste -sd+ - | bc
47283                                # 独立算法一致

$ find src -name '*.ts' -o -name '*.tsx' | wc -l
86                                   # 该命令的文件数
$ git ls-tree -r HEAD --name-only -- src/ | wc -l
95                                   # ← 95 的来源：src/ 下【全部文件】
$ git ls-tree -r HEAD --name-only -- src/ | sed 's/.*\.//' | sort | uniq -c
  71 ts / 15 tsx / 7 css / 2 json
```
⇒ ★ **同一行里三个数互不匹配**：「47,310」出处未知、「95」是全文件口径、**给出的命令**是 `.ts/.tsx` 口径（86）。
**这是本仓记过的"一个数字回答两个问题"的形态。**

- **影响**：这两个数是清单的**"总账"行**（`:751`），会被当作规模事实引用。差值本身很小（0.06% / 10%），
  但**口径不可复跑**⇒ 下一个人**无法验证任何一条**，而"总账"正是最该可核的一格。
- **必须怎么修**：二选一并**让命令与数字对齐**：
  - (a) 用 `.ts/.tsx` 口径 ⇒ 写成 **47,283 行 / 86 文件**；
  - (b) 想统计全部文件 ⇒ 命令改 `git ls-tree -r HEAD --name-only -- src/ | wc -l`（**95**），
    行数改对全部文件求和，并**写明是"全部文件"口径**。

### F3 — **HIGH**：「现状 19 fail / 1415 pass」不可复现

- **文件:行**：`docs/LAYER-INVENTORY.md:621`（同 `:666` 的读数块）
- **文档原话**：
  > 该文件描述的是一次**已完成**的消红；**现状**实测 `pnpm test:gates` ⇒ **19 fail / 1471 tests**（本文件写作时实测）

- **实测**：**在它自己声明的测量点 `b8f357e` 上**，我**两次**测得 **20 fail / 1413 pass**：
```sh
$ pnpm test:gates
ℹ tests 1471 · pass 1413 · fail 20 · skipped 38
```
★ 两次分别来自：① 我的改动**在**时；② 把改动 `git stash` 掉后（**纯 `b8f357e` 内容**）。
两次**都是 20/1413**，且**失败文件集合逐行相同**（`diff` 无输出，两侧各 16 个文件）。
⇒ **不是我的改动造成的，也不是偶发。**

- **影响**：这是文档**对"现状"的唯一一次全量读数**，且被用来给 `BASELINE-RED.md` 定性。
  方向（`BASELINE-RED` 确实过时）**是对的**，**但基准数不可复跑** ⇒ 下一个人无法做差分归因。
  ★ 我**不主张**哪个数"对" —— 更可能差异是**环境性的**
  （本仓 `docs/GATE-EFFICACY.md` §7 第 1 条已记过"同一提交的失败集合会抖"）。
- **必须怎么修**：补**失败清单**（16 个文件名）或标「**写作时**实测，**未冻结**（见 `GATE-EFFICACY` §7）」；
  **不要**用它作为 `BASELINE-RED` 定性的唯一依据。

### F4 — **MEDIUM**：`src/quality-gates.ts` 现状行数写 2,520，实测 2,512

- **文件:行**：`docs/LAYER-INVENTORY.md:36`
- **实测**：
```sh
$ git cat-file -p upstream/main:src/quality-gates.ts | wc -l
2109                    # ✅ 上游侧对
$ wc -l < src/quality-gates.ts
2512                    # ← 文档写 2,520（差 8）
```
★ **同一行的上游值是对的** ⇒ 不是口径混淆，是**一个数抄错或量于另一时刻**。
- **必须怎么修**：改 **2,512**（注明测量点 `b8f357e`）。

### F5 — **MEDIUM**：引用行号错（`:6` 应为 `:11`）

- **文件:行**：`docs/LAYER-INVENTORY.md:620`
- **实测**：
```sh
$ sed -n '6p' docs/THREE-LINE-PLAN.md
（空行）
$ grep -n "账本" docs/THREE-LINE-PLAN.md | head -1
11:| 账本未接入生产完成路径 | `grep -rn ledger src/tools/update-task/` ⇒ 空 |
```
- **影响**：文档自己在 `:5` 声明"每条都附 `文件:行`"。行号错了 ⇒ 下一个人**在错的地方找不到它** ⇒
  **正好会重演本轮的 F1**（找不到 ⇒ 误判为"已经不需要了"）。
- **必须怎么修**：改 `docs/THREE-LINE-PLAN.md:11`。

---

## R4-4. 反向半边：有没有**漏掉**的过期断言

| 检查 | 命令 | 结果 |
|---|---|---|
| `START-HERE.md` 还有第二处「十一条」？ | `grep -rn "十一条\|11 条判据" docs/START-HERE.md` | **只有 `:53`** ⇒ 无遗漏 |
| 「34 个导出」还有第二处？ | `grep -rn "34 个导出" docs/START-HERE.md` | **只有 `:17`** ⇒ 无遗漏 |
| 文档 §9 的三处"过期"判定是否成立？ | `sed -n '53p;121p' docs/START-HERE.md` | `:53`「（十一条，★ 六个位置全部接满）」✅ · `:121`「六条判据**在真实运行中还没生效**」✅ · 清单缺 6 条 ✅ **三处全成立** |
| `index.ts:527-541` 的「11 条」是否被误判为过期文档？ | 读文档 `:303`、`:649` | ✅ **主动标出**「那是历史记录，不是过期文档」—— **这一格做得好，是加分项** |

★ **结论**：**除 F1 外，未发现被漏掉的过期断言**。

---

## R4-5. 汇总（含"必须怎么修"）

| id | severity | 文件:行 | 问题 | 必须怎么修 |
|---|---|---|---|---|
| **F1** | **high** | `LAYER-INVENTORY.md:620` | 把**仍成立**的账本断言标成"已过期"；举证用 `71de42a`（friction/experience 线，**不是账本**） | 判定改「**仍成立**」+ 两条复跑命令；`71de42a` 若要引用须改述 |
| **F2** | **high** | `LAYER-INVENTORY.md:31,751` | 47,310 / 95 与其自身命令（47,283 / 86）**互不匹配** | 二选一：**47,283 / 86**，或改全文件命令并写明口径 |
| **F3** | **high** | `LAYER-INVENTORY.md:621,666` | "现状 19 fail / 1415 pass"在其测量点不可复现（两次测得 **20 / 1413**） | 补失败清单或标"某时刻、未冻结" |
| **F4** | medium | `LAYER-INVENTORY.md:36` | `quality-gates.ts` 现状 **2,512**，写 **2,520** | 改 2,512 |
| **F5** | medium | `LAYER-INVENTORY.md:620` | 引用 `:6`，实在 **:11** | 改 `:11` |
| ✅ | — | `:543-580` | t10 的 blocker（4 文件归因） | **已修好**（R4-2 三条复跑成立） |
| ✅ | — | `:486-495` | t10 的 high（§8.1 口径） | **已修好**（two-dot + 对照表，测量点逐字准确） |
| ✅ | — | SVG / HTML | 集合 17/17 · 分组 3/3/3/4/2/2 · 9 处行标注 · 可解析 · 零外网 | **全部通过**（R4-1.2–R4-1.4） |

---

## R4-6. 裁决

**verdict = `needs_revision`**（0 blocker + 3 high + 2 medium）

- **不是 `pass`**：F1 把**仍在缺的接线**写成历史（读者会据此认为账本那条线已完成）；
  F2/F3 让"总账"与"现状基准"两个数**不可复跑** —— 而这份清单的**全部价值**就是"可回源"。
- **不是 `reject`**：主体质量高，**t10 的两条已确实修好且方向正确**，
  判据集合 / 分组计数 / 图的正确性 / 图的完整性**四项全过**，缺陷集中在**少数数字与一处归因**上，**定点可修**。
- **条件**：F1 必修（它是**归因**而非措辞）；F2/F3 必须给出可复跑口径；F4/F5 建议同批修。

★ **一点方法论观察（非 finding）**：本轮 3 条新 finding 有**同一个形状** ——
**「一个数被量于某时刻 / 某口径，然后被写成一个事实」**（F2 行数、F3 基准、F4 行数）。
而文档**在别处**（`:303`/`:649`）**恰恰做对了这件事**（显式区分历史数字与现状）。
⇒ 建议把那一格的纪律**推广到全表**：**每个"现状"数字都附测量点与命令**。
这也解释了为什么 t10 三轮"抽点→修→再抽"没抓到这里：**它们的共同点不是位置，是类别**。

*本节只追加到 `docs/REVIEW-ARCHITECTURE.md`，未修改任何被审文件、未改 `src/` 与 `scripts/`。*
