# N1 · 盘局地图：`scripts/` 下非测试脚本的用途、引用与归属

> **只读分析。** 本文**不改动任何 `src/`、`scripts/` 文件**。
> **测量点**：HEAD = `8eb16cd7f160` ｜ `lib/git-artifact-stamp.json` 的 `commit` = **`8eb16cd7f160`**（两者相等 ⇒ 构建新鲜，读数可信）。
> ★ **本文不给「该不该收拢」下结论** —— 那是用户裁定（计划 §3-N 的 N2/N4，按 R4 停住）。

---

## 0. ★ 开工前自证：构建新鲜度（上一轮拒绝开工的同一判据）

```sh
$ python3 -c "import json;print(json.load(open('lib/git-artifact-stamp.json'))['commit'][:12])"
8eb16cd7f160
$ git rev-parse --short=12 HEAD
8eb16cd7f160
```
⇒ **两者相等，可开工。**（★ 上一轮因 `851384b` ≠ `fe7f2b0` 而拒绝开工；本轮已修复。）

★★ **而它在分析过程中又变旧了 —— 如实记**：
```sh
# 开工时（本报告 §0）：            stamp = 8eb16cd7f160   HEAD = 8eb16cd7f160   ✓
# 交稿时重新自查（同一判据）：      stamp = 8eb16cd7f160   HEAD = 2c42430f113b   ✗
```
原因是**在我分析期间落了一个提交**：`2c42430 feat: deliverable-return checker (t50)`（见 §2.5）。

★ **它不影响本文的读数**，因为本文**没有一个数字来自 `lib/`（构建产物）**：
全部读数取自 `git ls-tree` / `git status` / `grep src/ scripts/` / `package.json` / `.github/workflows/`
—— **都是源码与配置，不是产物**。⇒ 构建新旧不改变"哪个脚本被谁引用"。

★ 而**这正是本任务要求"先自证构建新鲜"的理由**：那条判据管的是**读数会不会失真**。
本文的读数**恰好不经过产物**，所以即使中途变旧也仍然成立 ——
**但这一点必须写出来**，否则下一个人无法判断"变旧了要不要重跑"。

---

## 1. 盘面：★ 现在是 **40** 个，不是 39

```sh
$ ls scripts/*.mjs | wc -l              # 170  （top-level .mjs）
$ ls scripts/*.test.mjs | wc -l         # 130
$ ls scripts/*.mjs | grep -v '\.test\.mjs$' | wc -l   # 40  ← 非测试
```

★ **40 = 39 + 1**，而那多出来的 1 个是**本团队自己刚产出的**：

```sh
$ git status --porcelain scripts/check-deliverable-return.mjs
?? scripts/check-deliverable-return.mjs
$ git log --oneline -1 -- scripts/check-deliverable-return.mjs    # （空）
$ git merge-base --is-ancestor 7e5664f HEAD && echo MERGED || echo "NOT an ancestor"
NOT an ancestor
```

⇒ `check-deliverable-return.mjs` 是 **t50 的交付**（其提交 `7e5664f` 里含它），
**已被拷进队长工作区（untracked）**，但**它在 `HEAD` 里还不在**（`git ls-tree HEAD` ⇒ 空）。
**所以"39"是队长测量时刻的数，"40"是现在的数** —— 差异**不是语料漂移，是一次交付落地的中间态**。

★★ **顺带记一条本报告自身可复跑的读数**（它正好演示了 G 工具要解决的问题）：

```sh
$ node scripts/check-deliverable-return.mjs 7e5664f --workspace .
state     : OK — all 2 path(s) are byte-identical
  same      docs/DELIVERABLE-RETURN-TOOL.md
  same      scripts/check-deliverable-return.mjs
```
⇒ **它的提交不是 `HEAD` 的祖先，但内容确实在队长工作区里** ——
**「是不是祖先」与「东西回没回来」是两个问题**。（不影响本文：下面把 40 个逐个列出，
并**单列** t50 那一个新来的。）

---

## 2. 分类与归属：40 个逐个

**判据（先说清，避免"看起来像工具"）**：

| 归属 | 判据（**可核**） |
|---|---|
| **运行时机制**（该进 `src/`） | 被 `src/` **代码**（非注释）在**生产路径**上引用 —— 实测形状：`join(pluginRoot(), 'scripts', '<f>')` + 动态 `import()`。★ **判据不是"它看起来像机制"，是"生产路径上有谁在调它"** |
| **开发工具**（该留 `scripts/`） | 只被 `package.json` 的 `scripts` / CI / 人手工调用；**不被 `src/` 代码引用** |
| **发布工具**（该留 `scripts/`） | 只在 `prepublishOnly` / publish CI / 版本与 README/兼容性校验上跑 |
| **一次性夹具** | 为**某一轮任务**验证某个假设而写，无一般用途 |

### 2.1 ★ 运行时机制（被 `src/` **代码**引用）—— 只有 **2** 个

```sh
$ grep -rnE "join\(pluginRoot\(\), *'scripts'|import\(.*scripts/" src/ --include=*.ts | grep -E "friction-triage|worktree-reclaim"
src/tools/update-task.ts:728:  const target = pathToFileURL(join(pluginRoot(), 'scripts', 'worktree-reclaim.mjs')).href
src/tools/shared/entities.ts:1994:  const target = pathToFileURL(join(pluginRoot(), 'scripts', 'friction-triage.mjs')).href
```

| 脚本 | 行数 | 引用读数（`文件:行`） | 归属 |
|---|---:|---|---|
| `friction-triage.mjs` | 2793 | ★ **1 处生产引用**：`src/tools/shared/entities.ts:1994`（`loadFrictionTriageModule` 动态 import） | **运行时机制** |
| `worktree-reclaim.mjs` | 672 | ★ **1 处生产引用**：`src/tools/update-task.ts:728`（同形动态 import） | **运行时机制** |

★ **为什么只有 2 个**（这条很重要，它**推翻了"8 个辅助支线机制全在 scripts/"的旧印象**）：
队长早先记的是"8 个机制在 `scripts/`，其中只有 `friction-triage` 被 `src/` 引用（2 次）"。
**实测更精确**：被**代码**引用的有 **2 个**（上表），
而"2 次"那个数包含**注释**里的提及（`friction-triage` 在 `src/` 共 6 处命中，**只有 1 处是代码**）。
⇒ ★ **统计引用必须排除注释行** —— 否则"提到过"会被读成"接线了"。

### 2.2 ★ 被"提过名字"但**没有被代码引用**的（6 个）—— 这是本仓的**动态引用盲区**

```sh
# 这些名字在 src/ 里出现过，但全部是【注释/文档字符串】：
$ for f in frictions-html lifecycle-verify stress-verify verify-reload verify; do
    grep -rn "$f\.mjs" src/ --include=*.ts | grep -vE ':\s*[0-9]+:\s*\*' | head -2; done
# ⇒ 非注释命中：0
```
| 脚本 | `src/` 提及 | 其中**代码**引用 | 归属 |
|---|---:|---:|---|
| `frictions-html.mjs` | 1（注释） | **0** | 开发工具 |
| `lifecycle-verify.mjs` | 1（注释） | **0** | 开发工具 |
| `stress-verify.mjs` | 1（注释） | **0** | 开发工具 |
| `verify-reload.mjs` | 1（注释） | **0** | 开发工具 |
| `verify.mjs` | 3（注释；另有同名子串误命中） | **0** | 开发工具 |
| `git-artifacts.mjs` | 4（注释） | **0** | 发布工具 |

★★ **这 6 个的名字被 `src/` 的注释与说明文本引用着 —— 那是"文档耦合"，不是"接线"。**
实测：**全部 6 个的可执行引用 = 0**：
```sh
$ for f in frictions-html lifecycle-verify stress-verify verify-reload verify git-artifacts; do
    n=$(grep -rnE "join\(pluginRoot\(\), *'scripts', *'$f\.mjs'|import\([^)]*$f\.mjs" src/ --include=*.ts | wc -l)
    echo "$f.mjs ⇒ executable refs: $n"; done
frictions-html.mjs   ⇒ 0
lifecycle-verify.mjs ⇒ 0
stress-verify.mjs    ⇒ 0
verify-reload.mjs    ⇒ 0
verify.mjs           ⇒ 0
git-artifacts.mjs    ⇒ 0
```
★ **陷阱（我实测踩到过，记下来）**：只排除 `*` 开头注释是**不够的** ——
`git-artifacts.mjs` 的两处"非注释"命中其实是
① `build-artifact-scope.ts:313` 的**模板字符串散文**（"…scripts/git-artifacts.mjs fails on a stale build…"），
② `tools.ts:691` 的 **JSDoc `/** */`**。
⇒ **判据必须写成"有没有 `join(pluginRoot(),'scripts',…)` / `import(…'<f>.mjs')` 这种可执行形状"，而不是"有没有出现这个名字"。**

⇒ 若有人据 `grep` 的命中数下结论，会把这 6 个误判成运行时机制。
**判据必须写死：只看可执行形状。**

### 2.3 ★★ 动态引用盲区：任务书点名的那个实例（实测复核）

> 任务书：「`describeReclaimability` 跨文件零引用，但被 `scripts/worktree-reclaim.mjs` 消费，
> 而**那个脚本被生产动态 import** ⇒ 它是**接线的**」

**实测逐条对上**：
```sh
$ grep -rn "describeReclaimability" src/worktree.ts
src/worktree.ts:1249:export function describeReclaimability(verdict: WorktreeReclaimability): string {

$ grep -rn "describeReclaimability" scripts/worktree-reclaim.mjs
scripts/worktree-reclaim.mjs:126:import { judgeWorktreeReclaimable, describeReclaimability } from '../lib/worktree.js'
scripts/worktree-reclaim.mjs:233:      human: describeReclaimability(verdict),
scripts/worktree-reclaim.mjs:294:    human: describeReclaimability(verdict),

# 而那个消费它的脚本，被生产动态 import：
$ sed -n '728p' src/tools/update-task.ts
  const target = pathToFileURL(join(pluginRoot(), 'scripts', 'worktree-reclaim.mjs')).href
```
⇒ **链路闭合**：`src/worktree.ts` 定义 → `scripts/worktree-reclaim.mjs` 消费 →
`src/tools/update-task.ts:728` 动态 import 该脚本。
★ **所以「在 `src/` 里 grep 不到引用」不等于「没被引用」** ——
本仓有一条**生产路径绕 `scripts/` 再回调 `lib/`** 的形状，单向 grep 看不见它。

★ **本文的处置**：凡判"没被引用"的，都**同时**给出
①"在 `src/` 代码里的引用数"与 ②"有没有一条经过 `scripts/` 的间接路径"。
**下面凡标"未被引用"的，都只是 ① 为 0**；② 我没有对 40 个逐个穷尽（见 §5 边界）。

### 2.4 全表（40 个）

| # | 脚本 | 行 | 用途分类 | `src/` 代码引用 | 归属建议 | 判据 |
|---:|---|---:|---|---:|---|---|
| 1 | `friction-triage.mjs` | 2793 | **运行时机制** | **1**（`entities.ts:1994`） | **进 `src/`** | 生产路径动态 import（唯一入口 `loadFrictionTriageModule`） |
| 2 | `worktree-reclaim.mjs` | 672 | **运行时机制** | **1**（`update-task.ts:728`） | **进 `src/`** | 同上；且它是 worktree 删除的**唯一出处**（`update-task.ts:321` 逐字） |
| 3 | `verify.mjs` | 1892 | 开发工具 | 0 | 留 `scripts/` | `pnpm verify` 的总入口；CI 调 |
| 4 | `lifecycle-verify.mjs` | 1828 | 开发工具 | 0 | 留 `scripts/` | 被 `pnpm verify` / `verify:harness-contract` 调 |
| 5 | `quality-gates-tdd.mjs` | 1256 | 开发工具 | 0 | 留 `scripts/` | `verify:quality-gates` |
| 6 | `frictions-html.mjs` | 765 | 开发工具 | 0 | 留 `scripts/` | `verify:frictions` |
| 7 | `judgement-triage.mjs` | 743 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（判决分诊）；★ 与 #1 **同族但不接线**（见 §3.2） |
| 8 | `stress-verify.mjs` | 549 | 开发工具 | 0 | 留 `scripts/` | `pnpm verify` 链上 |
| 9 | `team-stall-check.mjs` | 392 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（团队停摆检查） |
| 10 | `harness-compat-tdd.mjs` | 391 | 开发工具 | 0 | 留 `scripts/` | `verify:harness-contract` |
| 11 | `mechanisms-html.mjs` | 386 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（用法见其头注释） |
| 12 | `experience-rollup.mjs` | 384 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（经验汇总） |
| 13 | `git-artifacts.mjs` | 377 | **发布工具** | 0（4 处**注释**） | 留 `scripts/` | `pnpm build` 的最后一步 + `verify:git-artifact` + publish CI |
| 14 | `probe-module-reload.mjs` | 351 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（用法 `[--json]`） |
| 15 | `clean-build.mjs` | 306 | **发布工具** | 0 | 留 `scripts/` | `pnpm build` 的第二段（清 + 发布 `lib/`） |
| 16 | `enable-hmr.mjs` | 306 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（本机 `link:` 安装辅助） |
| 17 | `verify-reload.mjs` | 287 | 开发工具 | 0 | 留 `scripts/` | `src/hmr-trace.ts:39` 注释指向它（**文档耦合**） |
| 18 | `check-deliverable-return.mjs` | 268 | **★ 新到（t50 交付）** | 0 | ★ **待裁定** | 见 §2.5 |
| 19 | `member-failure-tdd.mjs` | 255 | 开发工具 | 0 | 留 `scripts/` | `pnpm verify` + `verify:harness-contract` |
| 20 | `plan-review-check.mjs` | 252 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（计划审查四必答项） |
| 21 | `verify-nested-runtime.mjs` | 220 | **一次性夹具** | 0 | 留 `scripts/` | 为 f-0028 那一格（嵌套运行）而写 |
| 22 | `restart-host.mjs` | 219 | 开发工具 | 0 | 留 `scripts/` | 人手工跑（重启宿主） |
| 23 | `harness-source-verify.mjs` | 212 | 开发工具 | 0 | 留 `scripts/` | `verify:source-runner`（跑它的**测试**） |
| 24 | `harness-runtime-scenarios.mjs` | 203 | **一次性夹具** | 0 | 留 `scripts/` | 需 `--scenario`；为运行时场景核对而写 |
| 25 | `harness-model-benchmark.mjs` | 163 | **一次性夹具** | 0 | 留 `scripts/` | 模型基准；头注释明写"不改活动 profile" |
| 26 | `tool-definitions.mjs` | 148 | 开发工具 | 0 | 留 `scripts/` | `fixtures:tools --write` / `verify:fixtures --check` |
| 27 | `stability-tdd.mjs` | 145 | 开发工具 | 0 | 留 `scripts/` | `verify:harness-contract` |
| 28 | `web-routes-verify.mjs` | 143 | 开发工具 | 0 | 留 `scripts/` | `verify:web-routes` |
| 29 | `harness-runtime-verify.mjs` | 136 | 开发工具 | 0 | 留 `scripts/` | CI `verify.yml` 直调 |
| 30 | `doctor.mjs` | 132 | 开发工具 | 0 | 留 `scripts/` | `pnpm doctor` + `verify:compatibility` |
| 31 | `compatibility.mjs` | 113 | **发布工具** | 0 | 留 `scripts/` | CI `publish.yml`（3 处） |
| 32 | `update-skills.mjs` | 106 | 开发工具 | 0 | 留 `scripts/` | `update:skills` |
| 33 | `sync-skill.mjs` | 104 | 开发工具 | 0 | 留 `scripts/` | `sync:skill` / `verify:skill` |
| 34 | `readme-version.mjs` | 79 | **发布工具** | 0 | 留 `scripts/` | `verify:readme`；防"README 写过时版本号" |
| 35 | `kind-requirements-table.mjs` | 77 | 开发工具 | 0 | 留 `scripts/` | 夹具拿 kind 需求表的**唯一入口**（t54） |
| 36 | `verify-package.mjs` | 74 | **一次性夹具** | 0 | 留 `scripts/` | 无头注释、无 pkg 引用 ⇒ 判定见 §5 边界 |
| 37 | `tools-source.mjs` | 71 | 开发工具 | 0 | 留 `scripts/` | 读工具源码面的**唯一入口**（t39）；夹具用 |
| 38 | `fallback-tdd.mjs` | 59 | 开发工具 | 0 | 留 `scripts/` | `pnpm verify` 链上 |
| 39 | `release-metadata.mjs` | 26 | **发布工具** | 0 | 留 `scripts/` | CI `publish.yml` |
| 40 | `harness-issue-verify.mjs` | 27 | **一次性夹具** | 0 | 留 `scripts/` | 需 `--scenario`；为某 issue 的核对而写 |

**小计**：运行时机制 **2** · 开发工具 **27** · 发布工具 **5** · 一次性夹具 **5**（+ t50 新到 1 待裁定）。
（2 + 27 + 5 + 5 + 1 = 40 ✓）

★ 可复算（按用途列分组计数，从本表本身算出来）：
```sh
$ awk -F'|' '/^\| [0-9]+ \|/ {print $5}' docs/PLATE-MAP.md | sed 's/[* ]//g' | sort | uniq -c
  27 开发工具
   5 发布工具
   5 一次性夹具
   2 运行时机制
   1 ★新到（t50交付）
```

### 2.5 ★ `check-deliverable-return.mjs` 的归属：**待裁定，本文不代替决定**

它是 **t50 的交付**。**归属我不给建议**，理由：
- 它**是否**该变成一个**生产插入点**，正是 `docs/PROPOSAL-DELIVERABLE-RETURN.md` §7 与
  计划 §3-G 明确留给用户/队长的裁定（本任务 out of scope）；
- 它现在**没有被 `src/` 引用**（0），所以按 §2 的判据它**落在"开发工具"**；
- ★ 但它与 #1/#2 的**关系是可变的**：一旦有人把它接成判据，就会变成**运行时机制**。
  ⇒ **它的归属取决于一个尚未做出的裁定** ⇒ 本文如实标"待裁定"，**不预判**。

★★ **它在本次分析期间被归并了（如实记，含时间线）**：
```
分析开始时  git status ⇒ ?? scripts/check-deliverable-return.mjs   （untracked，只在工作区）
分析结束时  git ls-tree HEAD scripts/check-deliverable-return.mjs  ⇒ 100644 blob f02daf1d…
            git log    ⇒ 2c42430 feat: deliverable-return checker (t50) -- and it immediately indicted itself
```
⇒ 它的**归属问题一个字节都没变**（仍未被 `src/` 引用 ⇒ 仍落"开发工具"），
**变的只是它的版本控制状态**。★ 我把它写下来，是因为这正是 G 工具要解决的那件事：
**"文件在盘上"与"它在 `HEAD` 里"是两个不同的读数**，而它们在分析过程中**真的会变**。

---

## 3. 归属的两条判据（可核，逐条给反例）

### 3.1 判据 A：**有生产调用方** ⇒ 运行时机制

**形式化**：`∃` 一条**非注释**的 `src/` 代码行，在生产路径上引用它。
本仓的形状是 `join(pluginRoot(), 'scripts', '<f>')` + 动态 `import()`（因为 `tsconfig` 的 `rootDir=src` 排除了 `scripts/`）。

★ **反例（防止把"文档耦合"读成"接线"）**：`verify-reload.mjs` 被 `src/hmr-trace.ts:39` **注释**指向 ——
那是**有人在代码里写了它的名字**，不是**代码在调它**。
```
$ sed -n '39p' src/hmr-trace.ts
 *   见 `scripts/verify-reload.mjs`。
```
⇒ **0 个生产调用方** ⇒ 开发工具。

### 3.2 ★ 判据 B：**同族但不接线** ≠ 接线（`judgement-triage` vs `friction-triage`）

这一对是本盘面最值得看的地方（也解释用户那句"做得比较散"）：
```
friction-triage.mjs   ⇒ 有生产调用方（entities.ts:1994）   ⇒ 运行时机制 ✅ 接线
judgement-triage.mjs  ⇒ 0 个生产调用方                     ⇒ 开发工具  ✗ 未接线
```
两者**做的是同一条线的事**（卡点 → 任务 / 判决 → 任务），
而**只有前者被接进生产**。⇒ 用户感受到的"散"，在读数上就是**这种成对的不对称**。

★ **本文只报这个不对称，不给处置建议** —— "要不要把 `judgement-triage` 也接上"属于 N2/N4（用户裁定）。

---

## 4. 分层建议（★ 只给读数与形状，不代替裁定）

**现状**：40 个**平铺**在 `scripts/` 根下，与 130 个测试夹具**同层**。

**建议形状**（按 §2 的用途分类一一对应）：

```
scripts/
  ├── dev/        开发工具（27 个）—— 人手工跑 + pnpm 脚本 + CI 的开发期校验
  │             例：verify.mjs · lifecycle-verify.mjs · quality-gates-tdd.mjs · doctor.mjs
  ├── release/    发布工具（5 个）—— build/publish 链
  │             例：clean-build.mjs · git-artifacts.mjs · compatibility.mjs · release-metadata.mjs · readme-version.mjs
  ├── harness/    一次性夹具（5 个）—— 为某一轮任务验证某假设而写
  │             例：harness-runtime-scenarios.mjs · harness-model-benchmark.mjs · verify-nested-runtime.mjs · harness-issue-verify.mjs · verify-package.mjs
  ├── runtime/    ★ 运行时机制（2 个）—— 被 src/ 生产调用的那两个
  │             例：friction-triage.mjs · worktree-reclaim.mjs
  └── *.test.mjs  130 个测试夹具（本次不动）
```

★ **每层的归属判据**（与 §2 表同源，不新造口径）：

| 层 | 放什么 | 判据 |
|---|---|---|
| `dev/` | 只在开发期跑、不被生产调用 | `src/` 代码引用 = 0，且被 `package.json`/CI/人手调用 |
| `release/` | build / publish / 版本与兼容性校验 | 只出现在 `prepublishOnly`、`pnpm build`、`publish.yml` |
| `harness/` | 为某一轮任务的某个假设而写 | 需要显式 `--scenario`/参数才有意义；无一般用途 |
| `runtime/` | 被 `src/` 生产路径动态 import 的 | ★ **判据 A**：`∃` 非注释的 `src/` 代码引用 |

★★ **一个必须写下来的副作用**：把 `friction-triage.mjs` / `worktree-reclaim.mjs` 移进
`scripts/runtime/` 会**改变两个生产引用点的路径**：
```
src/tools/shared/entities.ts:1994   join(pluginRoot(), 'scripts', 'friction-triage.mjs')
src/tools/update-task.ts:728        join(pluginRoot(), 'scripts', 'worktree-reclaim.mjs')
```
⇒ **任何分层动作都必须同时改这两行**（它们**不在本任务写域内**）。
★ 这也是"该不该收拢"以外的**第二个**待裁定项 —— 本文只把它**指出来**，不动手。

---

## 5. ★ 边界与"我没测到"（不许把边界读成"它不重要"）

| # | 边界 | 说明 |
|---|---|---|
| **1** | ★ **间接引用我**没有对 40 个逐个穷尽 | 我只验证了任务书点名的 `describeReclaimability` 那条链路（§2.3）。⇒ 标"未被引用"的，含义**严格地是**"**在 `src/` 的代码行里没有引用**"，**不**等于"任何路径都没引用它"。要穷尽需要做**调用图**，不是 grep |
| **2** | `verify.mjs` 的 3 处命中里有**同名子串**误命中 | `scripts/verify.mjs` 与 `scripts/*-verify.mjs` 名字互相包含；文中数字已按**精确文件名**核对 |
| **3** | `verify-package.mjs` 我判为"一次性夹具"**证据偏弱** | 它**无头注释、不被 `package.json`/CI 引用**。★ 如实记：这个归类是**基于"没有一般用途的痕迹"**，不如其余 39 个那样有直接读数支撑 |
| **4** | t50 的 `check-deliverable-return.mjs` 归属**待裁定** | 见 §2.5；它的归属**取决于一个尚未做出的裁定**，不取决于它现在的代码 |
| **5** | 本文**只读**，且**不改** `src/`、`scripts/` | `git status` 中除本文外无新增/修改（可核） |

---

## 6. 复核：全部命令与读数

```sh
# ① 开工前自证（构建新鲜）
python3 -c "import json;print(json.load(open('lib/git-artifact-stamp.json'))['commit'][:12])"   # ⇒ 8eb16cd7f160
git rev-parse --short=12 HEAD                                                                    # ⇒ 8eb16cd7f160

# ② 盘面计数
ls scripts/*.mjs | wc -l                              # ⇒ 170
ls scripts/*.test.mjs | wc -l                         # ⇒ 130
ls scripts/*.mjs | grep -v '\.test\.mjs$' | wc -l     # ⇒ 40（= 39 + t50 新到 1）

# ③ ★ 真·生产引用（只有 2 个）
grep -rnE "join\(pluginRoot\(\), *'scripts'|import\(.*scripts/" src/ --include=*.ts \
  | grep -E "friction-triage|worktree-reclaim"
# ⇒ entities.ts:1994 · update-task.ts:728

# ④ 注释 / 散文 vs 代码（证明 §2.2 的 6 个是"文档耦合"）
for f in frictions-html lifecycle-verify stress-verify verify-reload verify git-artifacts; do
  n=$(grep -rnE "join\(pluginRoot\(\), *'scripts', *'$f\.mjs'|import\([^)]*$f\.mjs" src/ --include=*.ts | wc -l)
  echo "$f.mjs ⇒ executable refs: $n"; done
# ⇒ 六个全为 0
# ★ 注：只排 `*` 注释不够 —— git-artifacts 的两处命中是【模板字符串散文】与【JSDoc】，
#   所以判据要写"可执行形状"，不是"名字出现过"

# ⑤ 动态引用盲区（任务书名点的实例）
grep -rn describeReclaimability src/worktree.ts scripts/worktree-reclaim.mjs
sed -n '728p' src/tools/update-task.ts
# ⇒ 链路闭合：定义 → 脚本消费 → 生产动态 import 该脚本

# ⑥ 用途分类的旁证
python3 -c "import json;[print(k,v) for k,v in json.load(open('package.json'))['scripts'].items()]"
ls .github/workflows/                              # ⇒ publish.yml · verify.yml

# ⑦ 只读证明
git status --porcelain -- src scripts lib          # ⇒ 除本文件外无改动
```
