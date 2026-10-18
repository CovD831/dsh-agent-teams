# 过夜运行报告 · 集成校验（INT）

**报告人**：verifier（独立验证与集成，本轮不实现、不改 src/ 与 lib/）
**校验时刻**：2026-10-19 05:07–05:40（Asia/Shanghai）
**校验期间主干推进**：`019ec3c` → `4c4cef1` → `0e2fadb` → `351c2e3` → `c090a04` → `b0f1e9f` → `777679b`（共 6 跳）
**被校验的主干**：`777679b`（复查后 `git status --porcelain -uall` = 本报告 1 行 M，其余干净）
**本文件自身的改动范围**：只有 `docs/OVERNIGHT-RUN-REPORT.md` 一个文件（本任务 inScope 就是它）
**口径**：本报告里每一条读数都是我自己在本机跑出来的；凡是转述他人结论的，都标了「转述」并注明我没复跑。

> ★ 本报告只写三类：**已完成 / 未闭环 / 需要人拍板**。三态不合并。
> ★ 一件东西「落在盘上」不等于「闭环」—— 完工门、独立审查、下游可用性各算一格，分开放。

---

## 一、已完成

**进入本节的门槛（三条同时满足，缺一条就进第二节）**：
① `changedPaths` 逐个在盘上存在且都在该任务 inScope 内；② 交付字节真的在主干上（不是「说合了」）；
③ 该任务 verify 命令我自己复跑过，读数等于或优于它自己记录的基线。

### 1.1 R7 · plan-reviewed 判据开始读 reviewed 戳的时间（t3）

| 项 | 读数 |
|---|---|
| 交付提交 | `337424c task(t3): worktree deliverable`（父 `e1ef3b7`） |
| 合入主干 | `c01fdb4`（**真合并提交**，父 = `7a94837` + `337424c`） |
| `changedPaths` | 8 条，全部存在、全部在 inScope 内（字节数 28483 / 27223 / 11845 / 41782 / 3718 / 167534 / 46900 / 35388） |
| 字节一致性 | `git diff 337424c c01fdb4 -- <该 8 条>` ⇒ **0 行**（我跑的） |
| `git merge-base --is-ancestor 337424c c01fdb4` | **YES** |

我自己复跑的 verify：

```
pnpm typecheck                                        → EXIT=0
node --test scripts/gate-plan-reviewed.test.mjs       → tests 17 / pass 17 / fail 0   EXIT=0
```

`commandsRun` 逐条核对（它记了 7 条，我复跑了全部 7 条）：

| # | 命令 | 它记的 | 我复跑 | 结论 |
|---|---|---|---|---|
| 0 | `pnpm typecheck` | exit 0 | EXIT=0 | 一致 |
| 1 | `pnpm build` | exit 0 | EXIT=0（我在一次性 worktree `/tmp/wt-head` 上跑，未在主树跑，见 §4.5） | 一致 |
| 2 | `node --test scripts/gate-plan-reviewed.test.mjs` | 17/17/0 | 17/17/0 EXIT=0 | 一致 |
| 3 | `node --test scripts/verify-readout-uniform.test.mjs` | 14/13/0 | 14/13/0（含 skipped 1）EXIT=0 | 一致 |
| 4 | `node --test scripts/review-unified-pipeline.test.mjs` | 14/14/0 | 14/14/0 EXIT=0 | 一致 |
| 5 | `node --test scripts/verify-unified-pipeline.test.mjs` | 11/10/1，自称存量红 | 11/10/1 EXIT=1 | 一致；★ 且我在**它的真实父提交** `7a94837` 上跑也是 11/10/1 ⇒ 确系存量 |
| 6 | `node scripts/reviewed-stamp-census.mjs --active` | exit 0 | EXIT=0 | 一致，但**数字口径见附录 B-1** |

★ 它那条最关键的验收（「新增失败 = 0，禁止把存量红改绿」）我做了**臂名集合差**（不是比计数）：
`gate-plan-reviewed` 父 `7a94837` = 12 臂 → 主干 = 17 臂，**新增 5 条**（臂 10/11/12/13/14），**删除 0 条**。
⇒ 这是正面证据，不是自述。

### 1.2 R5 · 判据接线可测普查（t4）

| 项 | 读数 |
|---|---|
| 交付提交 | `b61ce6a`（父 `e1ef3b7`）；**不在任何 ref 上**（`git for-each-ref --contains` 为空） |
| 合入主干 | `48d3418`（内容复制式落地，父 `9720ca9`） |
| `changedPaths` | 2 条：`scripts/gate-wiring-census.mjs`(30431 B)、`scripts/gate-admission-point.test.mjs`(45901 B) —— 都存在、就是 inScope 的 2 条 |
| 字节一致性 | `git diff b61ce6a 48d3418 -- <该 2 条>` ⇒ **0 行** |

我自己复跑的 verify：

```
node --test scripts/gate-admission-point.test.mjs   → tests 10 / pass 10 / fail 0   EXIT=0
node scripts/gate-wiring-census.mjs                 → EXIT=0
```

census 的逐点读数（我复跑，原样）：

```
admission   zero    3  0 sites   —
contract    wired   3  1  not-shown (declared)   src/tools/shared/entities.ts:4877
dispatch    wired   3  1  not-shown (declared)   src/tools/update-task/dispatch.ts:117
delivery    wired   2  2  shown                  src/tools/delivery.ts:193, src/tools/status.ts:963
runtime     wired   2  1  shown                  src/tools/shared/entities.ts:4749
collection  wired   4  3  not-shown (undeclared) src/tools.ts:2127, src/tools/create-task.ts:616, src/tools/shared/entities.ts:4653
```

★ **口径勘误（我自己发现并复现的）**：t4 的 `commandsRun` 记的是 `entities.ts:4876 / :4748 / :4652`，
主干现在是 `4877 / 4749 / 4653`。差 1 行的原因**不是它抄错**：`9720ca9` 在 t4 之后给
`src/tools/shared/entities.ts` 加了 3 行 2 删（`git diff --stat e1ef3b7 9720ca9 -- src/tools/shared/entities.ts`
⇒ `3 insertions(+), 2 deletions(-)`）。我把**今天的** census 脚本拷进 `e1ef3b7` 的树里跑，
逐点恰好印出 `4876 / 4748 / 4652` ⇒ t4 的读数是**对它自己基底忠实的**。

反向半边我**自己重做了一遍**（不是采信它记的）：

```
变异 A：把 zero 折进 wired（`sites.length>0 || gates.length>0 ? 'wired'`)
        ⇒ gate-admission-point：tests 10 / pass 5 / fail 5   EXIT=1   （它记 10/5/5 EXIT=1 —— 一致）
变异 B：not-run 分支 process.exitCode 2 → 0
        ⇒ gate-admission-point：tests 10 / pass 9 / fail 1   EXIT=1   （它记 10/9/1 EXIT=1 —— 一致）
两次都从备份还原，md5 校验 a57a4b74b1f9c4fc32088efab88723a7 前后一致
```

### 1.3 R6 · 夹具注册普查：有多少测试永远不会被跑到（t5）

| 项 | 读数 |
|---|---|
| 交付提交 | `6b90523`（父 `9720ca9`）；**不在任何 ref 上** |
| 合入主干 | `7a94837`（父 `48d3418`） |
| `changedPaths` | 2 条：`scripts/gate-fixture-registry.mjs`(38052 B)、`scripts/gate-input-wiring.test.mjs`(70379 B) —— 存在且即 inScope |
| 字节一致性 | `git diff 6b90523 7a94837 -- <该 2 条>` ⇒ **0 行** |

我自己复跑的 verify：

```
pnpm typecheck                                → EXIT=0
node scripts/gate-fixture-registry.mjs        → EXIT=0
    total=156  registered=150  unregistered=6  undecidable=0
    registered + unregistered + undecidable === total: true
```

未注册 6 个（我复跑同名清单）：`decompose / experience-rollup / hmr-trace / mechanisms-html / verify-reload / worktree-commit`。

★ 该任务契约被 amend 过（verify 从 `node --test scripts/gate-input-wiring.test.mjs` 改成
`pnpm typecheck`），理由是那条夹具**结构上不可能 exit 0**。**我独立验证了这个理由成立**：
在它记录的基底 `9720ca9` 上跑该夹具 = `tests 12 / pass 10 / fail 2 / EXIT=1`；
在主干上 = `tests 17 / pass 15 / fail 2 / EXIT=1`。两条存量红（臂 10、臂 12）**臂名逐字相同**，改前改后都在。
臂名集合差：`9720ca9` 12 臂 → 主干 17 臂，**新增 5 条**（臂 13–17），删除 0。

反向半边我自己重做了一遍：

```
变异：未注册夹具默认当已注册（`routes.get(fixture) ?? [{module:'unknown'}]`）
      ⇒ gate-input-wiring：tests 17 / pass 12 / fail 5   EXIT=1
```
★ 与它记的「11 pass / 6 fail」**数量不同** —— 我的变异是**我自己的复现**，不是它那份的逐字拷贝，
两半都红，但**计数不能互相当证据**。这一条我标成「方向一致、读数不同」。

### 1.4 R1 · 判据级 reason 落盘（t1）—— **已合入主干并逐字节复核**

★ 这一节是**后补的**：t1 在我写报告期间（05:24:42）才完成，合入主干（`b0f1e9f`）又更晚。
补它的同时我把 §2.1 改成指针，避免同一件事在两节里说法不一致。

| 项 | 读数 |
|---|---|
| 交付提交 | `c090a04 task(t1): worktree deliverable`（父 `351c2e3`） |
| 合入主干 | `b0f1e9f feat(t1): a gate run now records why it could not measure`（9 文件 `+379/−11`） |
| `changedPaths` | 9 条，**9 条全在 inScope 内、全部 EXISTS** |
| 字节一致性 | `git diff c090a04 HEAD -- <那 9 条>` ⇒ **0 行**（逐字节相同） |
| 祖先关系 | `git merge-base --is-ancestor c090a04 HEAD` ⇒ **YES** |
| 任务基底 | `baseRevision=351c2e3` —— 部长手工对齐之后才派的那一次 |

我自己复跑的 verify（**在主干上**，不是在隔离树里）：

```
pnpm typecheck                                 → EXIT=0
node --test scripts/gate-registry.test.mjs     → ℹ tests 35 / pass 35 / fail 0   EXIT=0
基线 /tmp/wt-head (351c2e3) 同命令             → ℹ tests 30 / pass 30 / fail 0
```

**臂名集合差**（不是比计数）：基线 30 → 主干 35，**新增 5 条、删除 0 条**：

```
⑱ 臂 1  ★ unmeasured 的成因必须【穿过落盘投影】并且读得回来
⑱ 臂 1b ★ 观察模式下的 unmeasured 也带成因
⑱ 臂 2  ★ blocked 的成因【允许缺席】—— 与 unmeasured 是两条独立判定
⑱ 臂 2b ★ skipped 的成因同样可缺席
⑱ 臂 3  ★ 旧条目（历史 team.json 里没有这一格）必须仍能解析，不抛错
```

**★ 我亲手打穿了投影，两半都验过**（一次性副本 `/tmp/t1mut`，做完即弃）：

```
① 字段名对齐 —— t1 的字段叫 reason，不叫 cause
   主干上 import lib/state/tasks.js 的 gateEvaluationRecordOf，投入
   {verdict:'unmeasured', reason:'probe-could-not-measure'}
   ⇒ 读回 {"id":"completion.a","verdict":"unmeasured","reason":"probe-could-not-measure"}
   ⇒ reason survived projection? true
② 反向半边 删掉 src/state/tasks.ts 里 `...entry.reason === undefined ? {} : { reason }`
   ⇒ tests 35 / pass 33 / fail 2，红的是「⑱ 臂 1」「⑱ 臂 1b」；还原后 35/35/0
③ 反向半边 让 blocked 也强制带 reason
   ⇒ tests 35 / pass 34 / fail 1，红的是「⑱ 臂 2」；还原后 35/35/0
④ 反向半边 去掉 5 处 unmeasured 的 reason 赋值
   ⇒ tests 35 / pass 33 / fail 2，红的仍是「⑱ 臂 1」「⑱ 臂 1b」
```

**但它的两格账仍然没平**（这就是 §2.1 存在的原因，两节不矛盾）：

- `verdict` 键**缺席**（`objectHasOwnProperty('verdict')` = false），尽管 `reviewed.by=captain` 且 5 条 checks 全 pass。
- `completion.ok` = **false**，blocker 是那条我已证伪的假阳性
  `[completion.r5] "scripts/gate-registry.test.mjs" is a decorative test`。

⇒ **代码闭环了，账没有。** 这一节只主张代码与字节，账的问题全在 §2。

---

## 二、未闭环

> 本节里的东西**一条都不许并进第一节**。它们的共同点是：主干上看得见、读得出问题、但今晚没修到闭环。

### 2.1 R1（t1）的**账**还没平（代码已进主干，见 §1.4）

★ 本节被改写过三次：t1 的「零实现」→「实现在隔离树里」→「已合入主干」。
三次改写对应三次真实的主干推进（`351c2e3` → `b0f1e9f` → `777679b`）。
**这三稿我都留在 git 里了**，所以「我看错了没」是可以查的：`git log -p -- docs/OVERNIGHT-RUN-REPORT.md`。
现在它以 **§1.4** 的身份进了「已完成」，这里只留一条指针与一条**仍然未闭环**的尾巴。

**已闭环的部分**：`c090a04`（9 文件 `+379/−11`）已由 `b0f1e9f` 合入主干；
`git merge-base --is-ancestor c090a04 HEAD` = **YES**；`git diff c090a04 HEAD -- <那 9 条>` = **0 行**（逐字节相同）。
主干 `node --test scripts/gate-registry.test.mjs` = **35/35/0**，投影探针在主干上读回 `reason survived projection? true`。
详见 §1.4。

**未闭环的是这两格（代码本身已闭环，不许把两件事混成一句）**

- t1 的 `verdict` 键**仍然缺席**（`reviewed.by=captain`、5 条 checks 全 pass，`objectHasOwn('verdict')` = false）。
- `completion.ok` 仍是 **false**，blocker 仍是那条已被我证伪的假阳性：
  `[completion.r5] "scripts/gate-registry.test.mjs" is a decorative test`
  —— 臂名差集证明它新增了 5 条真臂（30 → 35，删除 0）。
- ⇒ **代码进去了，账没平。** 这两格分开记。

### 2.2 R2R3R4（t2）记账层三处缺陷 —— **主干上零交付，三处在主干上全部仍然活着**

★★ **这一节我也改写过**。05:36 时它是「零实现」（树脏 0 行、`changedPaths=undefined`）；
05:40 我再看时，**隔离树里已经有 1028 行未提交的改动**。两次读数都真，只是中间隔了 4 分钟。
**教训：报告里凡写"没有实现"，都必须带时刻 —— 因为它是会变的。**

| 时刻 | t2 隔离树（`HEAD=351c2e3`） | 我的读数 |
|---|---|---|
| 05:36 | `git status --porcelain -uall` = **0 行** | 零实现 |
| 05:40 | **10 行脏**：`src/tools/update-task.ts +207` · `src/tools/create-task.ts +9` · `scripts/gate-update-task-unmeasured.test.mjs +409` · 4 个 lib 产物 · 2 个 `.probe-*.mjs` | `git diff --stat` = **8 文件 +1028/−351** |

⇒ 05:40 的盘面是：**实现写在隔离树里、尚未提交、团队账上仍是 `changedPaths=undefined`、`deliverableCommit=undefined`**。
按「隔离树里的未提交改动不算交付」这条纪律（§1 的门槛第 ② 条），它**仍然不能进 §1**。
但它也**已经不是「零实现」**了 —— 下面三条缺陷的「还在」是 **05:28 的读数**，我在 05:40 复核过主干侧仍然成立
（主干 `src/tools/update-task.ts` 没有这些改动），但**隔离树里那 1028 行我按纪律不采信为交付**。

下面三条**是我亲手构造输入复现的**，不是读源码推断（时刻：05:28，对象：主干 `351c2e3`/`777679b` 的构建产物）：

**★ 先把我对那 1028 行的独立读数写清（三态分开）**

| 我测的东西 | 结果 | 状态 |
|---|---|---|
| 那 1028 行**算不算交付** | `deliverableCommit=undefined`、`changedPaths=undefined`、无提交 | **could-not-measure（不算交付）** |
| 那 1028 行**跑起来对不对** | 在隔离树里 `node --test scripts/gate-update-task-unmeasured.test.mjs` ⇒ **10/10/0 EXIT=0**（05:40） | confirmed（仅限隔离树） |
| 那三处缺陷**在主干上还在吗** | 在，见下面①②③ | confirmed |
| 那三处缺陷**在那 1028 行里修好了吗** | ①③我实测**修好了**（见下），②的修法在源码里但落盘顺序我未复跑 | ①③ confirmed，② could-not-measure |

★ **我特意去打了 ① 的反向半边**，因为「10/10 绿」本身不是证据（绿可能是夹具自己写了一份"应该长这样"）。
我直接拿 t2 隔离树里**构建出来的** `lib/` 跑同一组输入，把**新旧两条表达式**并排求值：

```
输入 = {ok:false, blockers:['real problem'], unmeasured:'could not measure'}
旧：notChecked=true   ⇒ wouldReject=false   ← 缺陷
新：notChecked=false  ⇒ wouldReject=true    ← 修好了
对照（只有 unmeasured）：新旧都是 notChecked=true ⇒ 仍放行   ← 反向半边没被放宽
对照（只有 blockers）  ：新旧都是 wouldReject=true           ← 这一半没退化
```

③ 我也直接调了它新导出的 `parseCommandResultsChecked`（**不是**读源码）：

```
{status:'passed', exitCode:1}  => REJECT "a passed command cannot have a non-zero exit code"
{status:'failed', exitCode:0}  => REJECT "a failed command cannot have a zero exit code"
{status:'passed'}              => ACCEPT   ← exitCode 缺席不算矛盾（这一格刻意保留）
{command:'x', exitCode:1}      => REJECT "commandsRun[0].status must be passed or failed"
```

⇒ **三态分开的结果**：那 1028 行**在隔离树里是对的**，但它**还不是交付**。
所以下面三条「还在」现在必须读成「**在主干上还在**」，而不是「谁都没做」。

**① 吞掉 blocker（在主干上还在）** —— 用真实的 `createGateRegistry()`，两条 completion 判据（一条 blocked、一条 unmeasured）：

```
只有 blocker：{"ok":false,"blockers":["[completion.a-blocked] found a real problem"],...}
             completionNotChecked = false  ⇒ would REJECT = true
blocker+unmeasured：{"ok":false,"unmeasured":"[completion.z-unmeasured] could not measure",
                     "blockers":["[completion.a-blocked] found a real problem"],...}
             completionNotChecked = TRUE   ⇒ would REJECT = FALSE     ← 真 blocker 被吞
```
（代入的是 `src/tools/update-task.ts:1443-1444` 与 `:1473` 的表达式原文。）

**② 归因记错代（还在）** —— 行序即证据（我打印的行号）：
`appendExecution` 调用在 **:1608**，里面抄 `task.status`(:1613) / `task.round`(:1620) / `task.verdict`(:1621)；
而 `task.status = args.status` 在 **:1580**（早于，OK），`task.verdict = args.verdict` 在 **:1810**（**晚于 200 行**）。
⇒ 历史里记的是**上一代**的 verdict。

**③ status 与 exitCode 自相矛盾（还在）** —— 真实的 `parseCommandResults`：

```
{"command":"x","status":"passed","exitCode":1} => ACCEPT
{"command":"x","status":"failed","exitCode":0} => ACCEPT
{"command":"x","status":"passed"}              => ACCEPT
{"command":"x","exitCode":1}                   => REJECT: commandsRun[0].status must be passed or failed
```

### 2.3 四张已完工任务的**完工门全是 `ok:false`**

这不是「它们没做完」，是**完工门自己给了否决**。逐条原文（`team.json` 的 `gateEvaluations.completion`）：

| 任务 | `ok` | blocker 原文（截断） |
|---|---|---|
| t3 | false | `[completion.r5] "scripts/gate-plan-reviewed.test.mjs" is a decorative test: it already passed on the parent revision (exit 0)` · 同上 `review-unified-pipeline.test.mjs` · `[completion.r5] "scripts/verify-unified-pipeline.test.mjs" failed on both revisions (parent exit 1, fixed exit 1)` |
| t4 | false | `[completion.r5] "scripts/gate-admission-point.test.mjs" is a decorative test ...` |
| t5 | false | `[completion.r5] "scripts/gate-input-wiring.test.mjs" failed on both revisions (parent exit 1, fixed exit 1)` |
| t1 | false | `[completion.r5] "scripts/gate-registry.test.mjs" is a decorative test: it already passed on the parent revision (exit 0)`（★ 假阳性：该夹具 30→35 臂） |

四条的 `unmeasured` 里同样有 `[completion.mutation]` 与 `[completion.backtest]`（t1 的 mutation 那条是「被截断到 40 个变异体」），
典型原文：`[completion.mutation] … the killer suite is not green before mutation …`、
`[completion.backtest] no dependency graph / coverage data was …`。

★★ **这四条 `completion.r5` blocker 是假阳性，我证伪了它**（详见 §5.3）：r5 的「按臂判」那条路
在生产里**不可达**，所以它永远退回「按文件判」，于是「父版本绿 + 工作区绿」就被读成装饰品。
我实测：`gate-plan-reviewed` 在父版本 12 臂、在主干 17 臂，**新增 5 条**；`gate-admission-point`
父 3 臂 → 主干 10 臂，**新增 7 条**。它们**不是**装饰品 —— 是判据读不到臂名。

### 2.4 t1 与 t4 的审查 verdict **都不存在**

`t4` 的 `verdict` 键**整个缺席**（不是 `pass` 也不是空串）。`reviewed.by=captain`、`reviewed.at=1792354680000`,
但 `verdict` 从未落盘。`t3`/`t5` 都是 `verdict=pass`。**`t1` 一模一样**：
`objectHasOwnProperty('verdict')` = false，而 `reviewed.by=captain`、5 条 checks 全 pass。
⇒ 团队的 Delivery 判词里那句「completed implementation has no passing review」指的就是它（们）。
★ 可复跑：`node -e 'const t=require("./.agent-teams/overnight-registration-hardening/team.json");\nfor(const id of ["t1","t4"]){const x=t.tasks.find(y=>y.id===id);\nconsole.log(id, "verdict key:", Object.prototype.hasOwnProperty.call(x,"verdict"), "reviewed.by:", x.reviewed&&x.reviewed.by)}'`

### 2.5 四张已完工任务里有**两张的完成回执由队长自己写**

- t3：attempt 2 `status=completed, by=captain`；`reviewed.by=captain`。⇒ 完成者与审查者是同一人。
- t5：attempt 2 `status=completed, by=captain`；`reviewed.by=captain`。同上。
- t4：attempt 2 completed by `foreman-b`；`reviewed.by=captain`。**唯一一个「不是我干的我来审」**，而它恰好 `verdict` 缺席。
- t1：attempt 6 completed by `foreman`；`reviewed.by=captain`。也是「不是我干的我来审」，同样 `verdict` 缺席。
  ⇒ 四张里真正做到「完成者 ≠ 审查者」的只有 t4 与 t1，而这两张**恰好都没有 `verdict`**。
  这不是巧合能解释的形状：一旦 `reviewed.by` 换成了别人，`verdict` 就没落盘。

⇒ 「每件实现通过审查后由队长合进主干」这条设计**在账面上没有分离**。此处只报读数，不做道德判断。

### 2.6 t3 的独立审查（t8）实际结论是 `needs_revision`，而 t8 自己没有 verdict

t8 `output` 逐字是 `cannot get required service "agents" in inactive context (code UNKNOWN)`，
`findings=null`、`commandsRun=null`、**`verdict` 键缺席**。
但 foreman 的 `supplementalEvidence` 记了可续 reviewer `2de3ae27-1764-4c33-9524-135f82c0e352` 的完整结论：**needs_revision**，
理由是 **F1**（high）：`src/gates/dispatch/plan-reviewed.ts:248` 的 `isoInstant()` 直接
`new Date(instant).toISOString()`，而 `:271` 的守卫只挡 `typeof !== 'number' || !Number.isFinite(at)`。

★ **我独立复现了 F1**（这是我的读数，不是转述）：

```
at=-1e300              => THREW RangeError: Invalid time value
at=-8640000000000001   => THREW RangeError: Invalid time value
at=-8.64e15 (Date 下界) => ok=false blockedKind=reviewed-stamp-impossible   ← 正常
at=+8640000000000001   => ok=true
at=+1e300              => ok=true
at=NaN                 => ok=true
一年前                  => ok=false blockedKind=reviewed-stamp-impossible
晚一天 / 恰好等于        => ok=true
```
⇒ 「有限但超出 Date 可表示范围」的 `at` 会**抛穿判据**，绕过三态。可达性也成立：`src/quality-gates.ts:1114`
的 create_task 校验同样只查 `Number.isFinite`。

### 2.7 两份审查（t6 / t7）都是 reject —— t6 已实质过时，t7 仍然成立

- t6 → `verdict=reject`，findings 4 条**全 blocker**（被审的 t1 无实现）。
- t7 → `verdict=reject`，F1/F2/F3 blocker、F4 high、F5 medium（被审的 t2 无实现 + 三处缺陷实测仍在）。
  ★ 我核对过 t7 的 F2/F3：与我 §2.2 的①②③是同一批读数，**我重跑得到同样结论**。
- 这两张任务**不能**因为「结论对」就算闭环 —— 被它们打回的实现，**t1 那张后来做了并合进主干**（§1.4），
  **t2 那张到 05:40 只写到隔离树里、未提交**（§2.2）。⇒ t6 已实质过时（它判的是「无实现」那一刻），
  t7 的结论**仍然成立**。两个 reject **都不能改判**（终态不可变），要重审只能重派。

---

## 三、需要人拍板

> 全部落在 `docs/OVERNIGHT-MANDATE.md` 的 **R4**（「按照你推荐的来吧」= 遇产品决策停住、只出读数）。
> 下面每一条都附了我**已备好的读数**，人只需要选。

1. **`admission.*` 三条判据要不要接线**（会改行为，R4 挡住）
   已备读数：census 逐点表 `admission zero 3 registered 0 sites` —— 三条判据（absorb / checkpoint / convene）
   全部在「零求值」桶里。接上就是改行为，不接就永远是零求值。
2. **`worktree` 是否保留**（R4 挡住；`docs/DECISIONS-PENDING.md` 已列 ①，仍缺 D1 数据）
   已备读数：本轮 5 棵树里 **0 棵**含 `c01fdb4`（05:07:45 采样），见 §4。
   复用分支 `src/worktree.ts:224` 直接返回旧 HEAD、永不再对齐，这是**第二个面**（见 §4.2）。
3. **HMR 在成员回合中重载插件**（`docs/DEFECT-HMR-DURING-MEMBER-TURN.md`，三条修法都要拍板）
   ① 重载窗口内 `agents.get` 返 `undefined` 而非抛（改错误传播面）
   ② 新增一个 `failureKind` 枚举值（数据模型变更）
   ③ `pnpm build` 在成员活跃时拒绝执行（改构建脚本行为）
   已备读数：整晚 **12 次执行里 8 次** `failureKind=failed_context`（t1 a4/a5、t2 a2/a3/a4、t3 a1、t6 a1、t7 a1）；
   `.agent-teams/hmr-reloads.jsonl` 共 50 条重载，窗口 02:35:06–05:04:15。★ 但这套因果**不完全成立**，见 §5.5。
4. **要不要在产物里造一个 integrator**（`deliverableCommit` 有写者零读者）
   已备读数：`grep -rn "deliverableCommit" src/` ⇒ **恰好 2 处**：`src/tools/update-task.ts:1703`（写）、
   `src/types.ts:699`（声明）。**零读者**。⇒ 本轮每一次「合入主干」都是队长手工做的（见 §4.3）。
5. **R1 / R2R3R4 两张任务重派不重派、按什么基底派**
   读数：两张的隔离树在 05:13:18 已被队长手工 `git checkout --detach` 对齐到 `351c2e3`
   （`merge-base --is-ancestor c01fdb4 HEAD` = YES、`9720ca9` = YES）。基底问题**已解**。
   ★ 结果：**t1 已于 05:24:42 交付 `c090a04`**（详见 §2.1）；**t2 到 05:28 仍 `in_progress`、零改动**。
   剩下要拍的是：**t1 的 `c090a04` 要不要合进主干**（它不在任何 ref 上，主干零改动），
   以及 t2 还要不要再派。附：一次派发 = 一次 `pnpm build` = 一次插件重载 = 打断所有在跑的成员回合（§3 第 3 条）。
6. **t1 / t4 的审查 `verdict` 缺席，要不要补一次正式审查**
   读数：t1 与 t4 都有 `reviewed.by=captain` 与 5 条 checks 全 pass，但 `verdict` 键**根本不存在**。
   t3/t5 是 `verdict=pass`。⇒ 要么是记账写漏了，要么是「审了但没裁决」。这是数据形状问题，不是判断问题。
7. **t3 的 F1（RangeError）的续审回到哪个 reviewer**
   ★ 「修不修」这一问**已经有答案了**：团队在 05:36 派了 `t10`（`kind=implementation`、`assignee=foreman`、
   inScope 恰是 `src/gates/dispatch/plan-reviewed.ts` + 该夹具 + 2 个 lib 产物）。所以本项**只剩续审**。
   读数：F1 我在 §2.6 已独立复现（`at=-1e300` ⇒ `RangeError`）。
   硬约束：**续审必须是同一个 reviewer** `2de3ae27-1764-4c33-9524-135f82c0e352`（t8 契约第 6 条），
   而 t8 已是终态 —— 任何人都不能改它的 verdict，只能由队长重派。

---

## 四、结构缺陷：本轮的实测影响

> 问题原样：**隔离树从 HEAD 建 · 下游看不见上游 · 产品无 integrator**。
> 本节只回答「它影响了本轮吗」，并给证据。三格的答案**不同**。

### 4.1 「下游看不见上游」—— **影响了，且它决定了 t1 的成败**

05:07:45 采样（`git -C <树> rev-parse --short HEAD` + `merge-base --is-ancestor c01fdb4 HEAD`）：

| 任务树 | HEAD | 脏行数 | 含 `c01fdb4`(R7) |
|---|---|---|---|
| t1 | `e1ef3b7` | 0 | **NO** |
| t2 | `e1ef3b7` | 0 | **NO** |
| t3 | `337424c` | 0 | NO（它自己是 R7 的交付树） |
| t4 | `b61ce6a` | 0 | NO |
| t5 | `6b90523` | 0 | NO |

⇒ 五棵树里 **0 棵**含 R7 的合并。t1 与 t2 的成员**各自独立探测到**这一点并**拒绝开工**，
两张任务的 output 都逐字写了 `git merge-base --is-ancestor c01fdb4 HEAD → NO`。

★★ **本轮最干净的一次对照实验**（不是推断，是两次同条件观测）：

| 阶段 | t1 树的基底 | 结果 |
|---|---|---|
| 05:13 之前 | `e1ef3b7`（不含 `c01fdb4`/`9720ca9`） | **5 次 attempt，5 次 `failed_context`，交付 0** |
| 05:13:18 队长手工 `--detach` 到 `351c2e3` 之后 | `351c2e3`（含两者） | **第 6 次 attempt 在 11 分钟内完成**，交付 `c090a04`（9 文件 +379/−11），35/35 绿 |

⇒ 同一张任务、同一个成员（foreman）、同一份契约，**只换了基底**。这就是「下游看不见上游」在
本轮的**代价**：它不是「可能有点影响」，它让 t1 浪费了 5 个回合。
t2 在同一时刻也被对齐到 `351c2e3`，但它的第 5 次 attempt 在 05:28 时仍是 `in_progress`、树 HEAD 仍是 `351c2e3`、脏行 0
—— **尚未交付，不能写成「也成功了」**。

下游盲区的**可执行证据**（我跑的，同一份夹具同一时刻）：

```
t3 树（337424c）node --test scripts/gate-input-wiring.test.mjs → tests 12 / pass 10 / fail 2
主干  （351c2e3）node --test scripts/gate-input-wiring.test.mjs → tests 17 / pass 15 / fail 2
```
12 vs 17 —— 下游树里少了 t5 的 5 条臂。**下游看到的是旧代码，这在读数上可见。**

### 4.2 「隔离树从 HEAD 建」—— **只对了一半**，真正的病是「建一次，永不再对齐」

`docs/WORKTREE-BASE-DEFECT.md` 在 `351c2e3` 补的第二个面，我核了源码位置与实测：

- `src/worktree.ts:111 detectWorktreeSupport` → `:120 rev-parse --verify HEAD`（拿到 `support.base`）；
  `:234 git worktree add --detach <path> support.base`
  —— 建树**确实**取的是当时的 HEAD。
- 但 `src/worktree.ts:223-226` 的**复用分支**（`if (existsSync(join(path, '.git')))` ⇒ `tryGit(path, ['rev-parse','HEAD'])` ⇒ `return { ok:true, path, base }`）
  直接返回既有树的 HEAD，**从不 re-base**。
  ⇒ 重派任务时 `git worktree add` 那一步被整个跳过。
- 实测（`docs/WORKTREE-BASE-DEFECT.md` 记录，我只复核了结论一致性 —— 那两个时间戳我无法重现）：t1 的树 04:52:10 建，主干当时已是 `48d3418`+，
  而树停在 `e1ef3b7`(04:04:37)。**树的 mtime 会变**（复用路径也写文件），
  所以「mtime 比某提交晚」**不能**证明树含那个提交 —— 这一格骗过一次排查。
- ★ **我自己的独立读数**（不依赖那份文档）：05:07:45 五棵树的 HEAD 与 `merge-base --is-ancestor c01fdb4` 全部为 NO（§4.1 表）；
  05:13:18 t1/t2 两棵被手工对齐到 `351c2e3` 之后，`merge-base --is-ancestor c01fdb4 HEAD` 才变 YES。
  ⇒ 「复用分支不对齐」这条在**行为上**可见，不需要 mtime 那一格。

⇒ 归因要准确：**不是「从 HEAD 建」错了，是「建完再也不对齐」**。前者是设计，后者是缺陷。

### 4.3 「产品无 integrator」—— **影响了，且它让「合并」变成一件不可机器核的事**

`grep -rn "deliverableCommit" src/` = **2 处**（写 + 声明），**零读者**。后果实测：

- `c01fdb4` 是**真合并提交**（父 `7a94837` + `337424c`），`337424c` 因此**在主干历史里**（`--is-ancestor` = YES）。
- `48d3418`（t4）/ `7a94837`（t5）是**内容复制**，它们的交付提交 `b61ce6a` / `6b90523`
  **不在任何一个 ref 上**（`git for-each-ref --contains` 为空，只在 detached worktree 里活着）。
  ⇒ 一旦这些工作树被回收，交付提交就成孤本。
- 所以「这件东西合进去了吗」**没有产品读数可查**。我这一轮是**用字节比对手工核的**：
  `git diff 337424c c01fdb4 -- <8 条>` / `git diff b61ce6a 48d3418 -- <2 条>` / `git diff 6b90523 7a94837 -- <2 条>`
  / `git diff c090a04 HEAD -- <9 条>` —— 四条**全是 0 行**。结论是「合对了」，但**这个结论依赖人肉步骤，不是产品能力**。
- ★ **今晚一共四次「合入主干」，四次都是人肉，其中两次连合并提交都没有**：
  `c01fdb4`（真 merge）/ `48d3418`（内容复制）/ `7a94837`（内容复制）/ `b0f1e9f`（内容复制，就是 t1 那次）。
  ⇒ 四次里只有一次留下了可追溯的合并拓扑，另外三次在 git 历史里**看起来像普通提交**。
  这不是队长偷懒 —— 是**产品没有 integrator，`deliverableCommit` 写进去以后没有任何读者**。
- 可被反驳的证伪路径（我跑过，**原样照抄**）：

```
$ grep -rn "deliverableCommit" src/
src/tools/update-task.ts:1703:                task.deliverableCommit = committed.commit      ← 写
src/types.ts:699:  deliverableCommit?: string                                     ← 声明
$ grep -rn "deliverableCommit" src/ | grep -vE "= *committed\.commit" | grep -vE "deliverableCommit\?: *string"
（0 行）
```

  ⇒ **恰好 2 处：一处写、一处声明，零读者。** 若哪天第三条出现且是读，这条结论即被推翻。

### 4.4 ★ 第四次「合入主干」发生在成员回合中间，我抓到了它的现场读数

这一格是**本轮最后一次、也是最讽刺的一次**证据：修结构缺陷的动作本身又踩了一次结构缺陷。

时间线（全部是我从盘上读的，不是转述）：

| 时刻 | 事件 | 我的读数来源 |
|---|---|---|
| 05:24:42 | t1 第 6 次 attempt 记为 `completed`（`by=foreman`） | `team.json` executions |
| 05:24:42 | `c090a04 task(t1): worktree deliverable` 落盘 | `git log --date=format:%H:%M:%S` |
| 05:31:31 | `b0f1e9f feat(t1): …` 合入主干 | 同上 |
| 05:24:39–05:24:40 | **主树跑了一次 `pnpm build`**：`lib/index.js` `:24:39`、`lib/client.js` 与 `lib/git-artifact-stamp.json` `:24:40` | `stat -f %Sm` |
| 05:24:40.385 … 05:24:44.050 | **6 次插件重载** | `.agent-teams/hmr-reloads.jsonl` |

⇒ **t1 完成的那一刻，主树正在重建插件，插件在 3.7 秒内重载了 6 次。**
这一次没有打死 t1（它已经写完了），但它就是 `docs/DEFECT-HMR-DURING-MEMBER-TURN.md` 所描述场景的又一例。

★ 而这次重建是**必要**的：`b0f1e9f` 把 t1 的 `src/` 改动合进主干，`lib/` 必须同步。
**实测精确到文件（`find lib -name "*.js" -o -name "*.d.ts" | xargs stat`）**：
**143 个文件 05:24:38、74 个 05:24:39、1 个 05:24:40** —— 那是一次完整重建。
而 **05:31:31 只有 5 个**：

```
lib/gates/registry.js · lib/state/tasks.js
lib/types/gates/registry.d.ts · lib/types/state/tasks.d.ts · lib/types/types.d.ts
```

**这 5 个与 t1 `changedPaths` 里的 5 个 `lib/` 产物逐字相同**（另外 4 条是 `src/` 与 `scripts/`，本来就不进 `lib/`）。
我做了集合比对，不是目测：`comm -12 <(diff 清单) <(changedPaths 的 lib 子集)` ⇒ 5 条全中、0 条在外。
⇒ 05:31:31 那一次**不是**全量 `pnpm build`，是**只同步 t1 涉及的那几份**；
`.agent-teams/hmr-reloads.jsonl` 在同一毫秒记录了 1 次重载（05:31:31.658）。
★ 两件事都值得记：**全量构建 3.7 秒内 6 次重载；增量同步 1 次。**

我用两次**独立构建**证明了主树的产物确实换成了含 t1 的那一份：

```
lib/state/tasks.js     主树 af883872…  = /tmp/wt-h3(777679b) 构建 af883872…   ≠ /tmp/wt-head(351c2e3) 构建 cd8e93a7…
lib/gates/registry.js  主树 7f89dd33…  = /tmp/wt-h3 构建 7f89dd33…            ≠ /tmp/wt-head 构建 b07fb3e6…
lib/types.js           主树 31a7265a…  = 两次构建都是 31a7265a…（t1 没改它）
```

⇒ 产物是新鲜的、且确实包含 t1。**但 `lib/git-artifact-stamp.json` 仍写着 `commit=019ec3c`**，
`node scripts/git-artifacts.mjs` 在主树上报 `EXIT=1 stale or modified`，而在 `/tmp/wt-h3` 上同一个命令报
`EXIT=0 Git artifacts match source and build settings`。
**同一份字节，两个不同的 verdict —— 差别只在 stamp 文件里那一行 commit。**

⇒ 结论：结构缺陷**影响了本轮**。五个面：①下游看不见上游（§4.1）②建一次永不再对齐（§4.2）
③无 integrator ⇒ 四次合并全靠人肉（§4.3）④合并本身会打断成员（本节）⑤产物与记账戳会脱钩（§5.9）。

### 4.5 第三个面（HMR）：**修一次结构缺陷，会再打断一次成员回合**

`docs/DEFECT-HMR-DURING-MEMBER-TURN.md`（提交 `4c4cef1`）与队长的纪律（`0e2fadb`：成员在跑时主树不跑
`pnpm build`）是同一个缺陷的两面。我在本轮**遵守了它**：`pnpm build` 只在一次性 worktree `/tmp/wt-head`
（`351c2e3`）里跑，主树只跑 `pnpm typecheck`。
读数：`pnpm build` 会改两样东西 —— `lib/git-artifact-stamp.json`（记 commit）与 `lib/client.js`。
后者**在任何目录下都不可复现**，这一点我做了三方对撞（同一提交 `351c2e3`，三个不同路径各构建一次）：

| 构建目录 | `//#region \0dsh-css:` 里的绝对路径 | CSS-module 类名哈希 |
|---|---|---|
| `/tmp/wt-head` | `/private/tmp/wt-head/src/client/ActivityPanel…` | `TYE-tq_badge` |
| `/tmp/wt-head2` | `/private/tmp/wt-head2/src/client/ActivityPanel…` | `YRFlea_badge` |
| 主树 | `/Users/abab/Desktop/agent-teams-dev/src/client/ActivityPanel…` | `_8qZE2a_badge` |

⇒ `lib/client.js` **把构建目录的绝对路径与由它派生的类名哈希一起焊进了产物**。
两个 worktree 之间 diff 是 **484 行变动**（其中 16 行直接含路径，其余 468 行是类名哈希的连带改写）；
两份都做路径归一化后**仍有 468 行不同**，因为哈希不是路径的字面函数。
所以「在**别的目录**重跑 build 会不会脏」的答案是：**一定会**，改完的 `lib/client.js` 与提交进去的那份不可能逐字节相同。

★★ **但「在主树重跑」是另一回事，我先前写错了，这里改正。**
提交进主干的 `lib/client.js` **本来就含着主树的绝对路径**：

```
$ git show HEAD:lib/client.js | grep -c "/Users/abab/Desktop/agent-teams-dev"   ⇒ 8
$ git show HEAD:lib/client.js | grep -c "/private/tmp/wt-head"                   ⇒ 0
```

⇒ 那 8 处 `//#region \0dsh-css:` banner 指向的就是本仓的绝对路径。
**所以在主树重跑一次 build，`lib/client.js` 会被逐字节重建成同一份**（实测：05:44:46 主树那次构建之后，
`md5 lib/client.js` 与 `git show HEAD:lib/client.js` 完全相同，`git status` 里它**没有出现**）。

⇒ 修正后的说法：**「主树 build 一定脏两行」是错的。**
主树 build 之后**唯一**可能脏的是 `lib/git-artifact-stamp.json`（它记 `commit`，HEAD 一变就对不上），
而 `lib/client.js` 只有在**换目录构建**时才会脏。
我不改 §4.5 的标题，但这里必须留下改正痕迹 —— 这是我在本轮**第二次**推翻自己的读数
（第一次是 `lib/client.js` 的「242 行纯路径 diff」）。

⇒ 结论：结构缺陷**影响了本轮**。直接后果分两段：
**05:13 之前** 2 张任务（R1、R2R3R4）因基底盲区**零交付**；
**05:13 之后**队长手工把 t1/t2 的树对齐到 `351c2e3`，t1 立刻在 11 分钟内交付了 `c090a04`（9 文件 +379/−11）——
**同一张任务、同一个成员、同一份契约，对齐基底前后结果完全不同**。这是本轮关于「基底」最干净的一次对照。
而修它的动作本身又会打断成员，所以本轮只能「手工对齐 + 手工合并 + 不在主树构建」，三条都是人肉。

---

## 五、本轮仍未修的缺陷，以及为什么没修

> 每条写明「**为什么没修**」，只在两种原因里选：被 **R4** 挡住，或**不在本轮 DAG 里**。
> 不允许写「时间不够」。

| # | 缺陷 | 为什么没修 | 今晚的读数 |
|---|---|---|---|
| 5.1 | ~~**R1**：`unmeasured` 条目落盘时不带成因~~ | ★ **已修，不在此表** —— 合入 `b0f1e9f`，见 §1.4。留行是为了让读到旧版本的人知道它已闭环 | 主干 `reason survived projection? true`；`gate-registry` 35/35/0 |
| 5.2 | **R2R3R4 三处记账层缺陷**（吞 blocker / 归因记错代 / status 与 exitCode 矛盾） | **在主干上仍未修**：t2 的 1028 行**写在隔离树里但未提交**，团队账上 `changedPaths=undefined`。★ 且第 3 条的原始验收自相矛盾，已由 captain amend 掉 | §2.2：主干上三条都还在（05:40 复核）；隔离树里 ①③ 我实测已修好且反向半边成立 |
| 5.3 | **★ r5 的「按臂判」是死代码**（本轮新发现，此前无人记账） | **不在本轮 DAG 里** —— 它是今晚跑完工门时才暴露的 | 见下 |
| 5.4 | **R7 的 F1**：`at` 有限但越界 ⇒ `RangeError` 抛穿判据 | **不在本轮 DAG 里**（是 t8 的独立审查在收口后报的） | §2.6 我复现：`at=-1e300` THREW |
| 5.5 | **HMR 重载打断成员回合**（整晚 8/12 次执行） | **被 R4 挡住**（三条修法分别是错误传播面 / 数据模型 / 构建脚本） | `.agent-teams/hmr-reloads.jsonl` 50 条，窗口 02:35–05:04 |
| 5.6 | **`test` 脚本根本不存在**（`pnpm test` 跑不了任何东西） | **不在本轮 DAG 里**（t5 只是报出来，其 inScope 是普查脚本） | `package.json` 无 `test`；`test:gates` 是 1 glob + 85 显式参数，UNION=136 |
| 5.7 | **6 个夹具永远不会被任何入口跑到** | **不在本轮 DAG 里**（t5 只负责数出来） | decompose / experience-rollup / hmr-trace / mechanisms-html / verify-reload / worktree-commit |
| 5.8 | **`gate-plan-reviewed-stamp` 臂 8 恒红**（盘上 90 个不可能戳） | **不在本轮 DAG 里**；且它是**刻意的钉子**不是坏测试 | 我跑：`tests 8 / pass 7 / fail 1 EXIT=1`，红的正是臂 8 |
| 5.9 | ~~**`lib/git-artifact-stamp.json` 与 HEAD 不同步**~~ | ★ **已在本任务收尾时被平掉**（05:44:46 主树重跑了一次 `pnpm build`），留行是为了让读到旧版本的人知道它已闭环 | 现状：`git-artifacts` **EXIT=0「Git artifacts match source and build settings」**，stamp `commit=777679b` = HEAD。★★ 但这次构建**推翻了我另一条判断**，见 §4.5 末尾：`lib/client.js` 在主树重建**逐字节相同**（committed 版含 8 处主树绝对路径），所以「主树 build 必然脏两行」是错的；真正会脏的只有离开主树构建时的 `lib/client.js`，以及 stamp 的 `commit` 那一行 |

### 5.3 为什么它重要（本轮新发现，值得单独写清）

`src/gates/completion/r5.ts:605-628` 会解析两份运行报告的**臂名**（`newArms` 在 `:618-620`，
命中在 `:621`），只有读不到臂名时才退回按文件判（`parentExit === 0 … fabricated` 在 `:629`）。
而它的注释（`r5.ts:492-494`）与唯一的**生产**注入器
`src/tools/update-task/completion.ts:512-536` 一致：那个注入器对 `'working-tree'` 返回 `{ exitCode }`，
对普通版本返回 `exitCode === undefined ? {} : { exitCode }` —— **从不返回 `output`**。
于是 `parseNodeTestReport('')` 在 `r5.ts:516` 直接 `return undefined`，`newArms` 永远是 `undefined`，
**永远走按文件那条路**。

我的探针（`/tmp/r5deadcode.mjs`，跑在 `lib/` 实数上，两份输入**退出码完全相同**）：

```
生产形状的执行器（只给 exitCode）      → {"ok":false,"blockers":["\"scripts/demo.test.mjs\" is a decorative test: already passed on the parent revision (exit 0), ..."]}
同退出码 + 把 reporter 文本一起交回    → {"ok":true,"evidence":1}
```
⇒ 这不是「判据太严」，是**判据读不到它需要的那一格**，于是把每一件真交付都读成装饰品。
**本轮四张已完工任务的 `completion.r5` blocker 全部由此产生**（而它们的臂名差集证明它们分别新增 5 / 7 / 5 / 5 条真臂）。
配套证据：`scripts/gate-r5.test.mjs` 里所有夹具**都自己注入 `output`**（`:65`、`:195`、`:505-570`），
所以夹具全绿，而生产走的是另一条路 —— 这正是「测试与我跑的那条路不是同一条」的教科书例子。

**★ 本节的可证伪路径（我不想要"我说了算"）**

```
① 若 `runTestOnRevision` 有任何一处返回 `output` ⇒ 本节垮掉。精确查法（**别直接 grep 整个文件**）：
   `sed -n '512,536p' src/tools/update-task/completion.ts | grep -n output`
   我跑的结果：**0 行**。那两处返回式只有 `{ exitCode: … }` 与 `exitCode === undefined ? {} : { exitCode }`。
   ★ 陷阱：整文件 `grep -n output` 会命中 `:456` 的 `output: args.output` ——
     那是 `completionContext.update` 的一格（成员交上来的回执正文），**不是**测试执行器的返回值。
     我自己第一次就是这么数的，差点把这一节否掉。
② 若 `parseNodeTestReport('')` 不返回 undefined ⇒ newArms 可能真有值。
   精确查法：`sed -n '514,517p' src/gates/completion/r5.ts`
   我跑的结果：`:516` 是 `if (text.trim() === '') return undefined`。
③ 最直接的一条：拿一份**真实**的 completion 求值，打印 r5 那一次拿到的是什么。
   我跑过（/tmp/r5deadcode.mjs）：生产形状 ⇒ decorative 假阳性；同样退出码 + 带 output ⇒ ok:true。
```

⇒ 三条里任何一条读数不同，我这一节的结论就作废。**我不认为"我跑过"能替代别人重跑。**

---

## 六、形态验证（原 §一，保留）

用户设计的形态：**持久领导成员（记账点）在子树内当 leader**——每张实现任务它拉起一个
一次性 subagent worker，每张审查它拉起一个可续 subagent reviewer；队长只派任务给领导成员，
不直接派 worker。

### 结论：形态可跑通，且今晚跑通了。

实测读数（可复跑：读 `~/.dsh/sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd`，
**按 zstd magic `28 B5 2F FD` 切帧逐帧解压** —— 单次 `zstdDecompressSync` 只解第一帧）：

| 会话 | 深度 | 父 | 工具调用 |
|---|---|---|---|
| `cb95c8e7` foreman | 1 | captain | 567 条记录，含 `subagent`×3 |
| `0a87d7c8` foreman-b | 1 | captain | 509 条记录，含 `subagent`×1 |
| `45c85f41` t4 worker | 2 | foreman-b | **write×2 / edit×10**，产出 611 行脚本 |
| `9c003f33` t3 worker | 2 | foreman | **edit×14 / bash×49**，产出 138 行改动 |

⇒ 持久成员 → 一次性 subagent worker → 在隔离树里写盘的**三层链路真的通**。

### ★ 途中被推翻的三个错误判断（都是队长的）

1. **"成员会话只有 290 字节、零轮次"** —— 错的。宿主把会话写成**多个 zstd frame 拼接**，
   单次解压只解第一帧。按 magic 切帧后 foreman 是 279,902 字节 / 157 帧 / 712 KB / 391 条记录。
2. **"子会话活着但不落盘"** —— 错的。t3 的第一个 worker 被 foreman **interrupt 掉**了
   （`turn/end` 记录 `reason: {"kind":"aborted","reason":{"kind":"parent"}}`），
   而它当时工具调用是 **write/edit = 0 次**（74 次全是 bash/read/grep）。它**从未尝试过写**。
3. **"写盘路径断了"** —— 被同时刻的 t4 worker 直接否掉：同一宿主、同样 depth=2，
   它写了 2 次 write + 10 次 edit，611 行落盘。

★ 教训：**「子会话说要做什么」不是「它做了什么」。**
判断 worker 有没有推进只认两样硬读数：①`tool/call` 里 write/edit 的**次数**
②worktree 的 `git status --porcelain`。**不许**用自然语言、也**不许**用文件 mtime
（读文件阶段 mtime 本来就不变）。

---

## 七、修掉的缺陷：inactive context 被读成一次失败的回合（原 §二，保留）

### 现象
成员的 `agent_teams_update_task` / `send_message` 反复返回
`cannot get required service "agents" in inactive context (code UNKNOWN)`，
任务被标 failed，而**落盘其实已经完成**。

### 根因（两层）
1. **宿主机制**：`ctx.agents.get(...)` 的取值器沿 fiber 树往上找 `fiber.store`，
   而 store 只在 fiber active 时存在。本插件在顶层 `inject` 里声明了 `agents`
   （`src/index.ts:56`），于是 fiber 不在运行时取值器走到"我自己就声明了它"这一支
   ⇒ **当场抛，不再往上找**。
2. **★ 真正的放大器**：`captainSessionOf`（`src/events.ts`）在**每一个工具**的事件记录
   路径上。于是"成员回合结束"这一个事件，会把之后每一次工具调用的返回值都变成
   一次本来不存在的失败。调用方分不清"没做"与"做了但回执丢了" ⇒ 重试 ⇒
   重试又成功又失败 ⇒ 整轮卡死。

### 实测证据
foreman 的三次 `turn/end` **全是 `kind: error`**：
- turn 1 / 2：`empty_output: upstream returned no visible output (PI_AI_ERROR)`
- turn 3：`cannot get required service "agents" in inactive context (UNKNOWN)`

随后 `agent/error` 监听器（`src/members.ts:492`）调 `failMemberOpenAttempt`
（`src/members.ts:197`）把 t1 标成 failed。**实现没失败，基础设施失败了。**

### 修法（commit `9720ca9`）
在 `src/events.ts` 加一个共享的
`export function liveAgentOf(ctx: Context, sessionId: string): Agent | undefined`：
只对这一种错误降级成 `undefined`，**其余异常照旧往上抛**
（一个 catch 若把"读不到会话"与"记录逻辑自己坏了"读成同一件事，
就是把这一格修成一个更宽的盲区）。

七个裸奔点全部收口：
- `src/events.ts` `captainSessionOf` —— 每个工具的事件路径
- `src/tools/message.ts` —— 成员汇报队长的**唯一**出口
- `src/tools/shared/entities.ts` ×2 —— `observeMemberActivity` 与成员观察面
- `src/members.ts` ×6 —— `failMemberOpenAttempt`×2 / `deliverToMember` / 血缘上溯 /
  `sessionForMember` / `memberLiveness`
- `src/scheduler.ts` ×2 —— `liveCaptain` / `liveMember`
- `src/tools/update-task.ts` —— 本地那份 `readCaptainSession` 改为委托
  （★ 同一格曾有**三份**各自宽严不同的实现 —— 那比一份都没有更坏，因为读起来像已经处理过了）

读数：`pnpm typecheck` exit=0 · `pnpm build` exit=0 ·
`node --test scripts/gate-plan-reviewed.test.mjs` 12/12 ·
`scripts/review-unified-pipeline.test.mjs` 14/14 ·
`scripts/capabilities.test.mjs` pass 18 fail 0 ·
★ **转述，我复跑不了**：原文记的「`mvp-failing-files --diff` 新增 1 / 修好 0 / 不变 15」需要一份旧的失败集合文件当参数
（`scripts/mvp-failing-files.mjs:66` `flagValue('--diff')`，`:141-150`），而盘上**不存在**这样一份快照
（`find . -name "*failing*"` 只找到脚本自身与五棵工作树里的副本）。我跑的是**无参数**版本：
`node scripts/mvp-failing-files.mjs --diff` → **EXIT=0**，当前失败集合 **16 个文件**（`ℹ fail 30 · ℹ pass 1560 · 37643 ms`）。
⇒ 这一行**不给结论**：既不能确认「新增 1」，也不能否认。要复跑必须有人先交出那份基线快照。

---

## 八、已落地并合入主干的改动（原 §五，已按我的复核更新）

| commit | 内容 | 我核过的读数 |
|---|---|---|
| `9720ca9` | `inactive context` 不再被读成一次失败的回合 | 七处裸奔点收口；`liveAgentOf` 只降级这一种错误。★ 但它把 `src/tools/shared/entities.ts` 改了 3+/2−，**正是 t4 行号漂 1 的来源** |
| `48d3418` | R5 判据接线普查（t4） | 7 插入点 21 判据：wired 6·18 / **zero 1·3 = admission** / vacant 0·0 |
| `7a94837` | R6 夹具注册普查（t5） | 156 个夹具 **6 个永远不会被跑到**；`test` 脚本根本不存在 |
| `c01fdb4` | R7 plan-reviewed 读戳时间（t3） | `--active` 口径 90 条不可能戳（详见附录 B-1） |
| `4c4cef1` | HMR 缺陷记账（文档） | 四项毫秒级对齐；★ 我补了反例，见附录 B-2 |
| `0e2fadb` | 队长纪律：成员在跑时主树不跑 build | 我在本轮遵守了（build 只在 `/tmp/wt-head`） |
| `351c2e3` | 隔离树缺陷第二个面：建一次永不再对齐 | 我复核：t1 树 04:52 建、停在 04:04 的 `e1ef3b7` |

### 四次契约 amend，四次都是契约写错而不是执行写错

1. **t5 · acc5 要求 `node --test scripts/gate-input-wiring.test.mjs` 全绿**
   —— 该夹具在树上结构上不可能 exit 0（两条先于任务的存量红）。改成本仓自己的净新失败口径。
   ★ **我独立验证了这条理由**：`9720ca9` 上 12/10/2 EXIT=1，主干 17/15/2 EXIT=1。
2. **t3 · inScope 只覆盖 4 个文件，而交付必然要改另外 4 个**
   —— 共享夹具此前写死 `at: 1_700_000_000_123`（2023-11-14），本身就是普查数出的不可能戳之一。
   ★ 精确位置：**现在**的 `scripts/fixtures/reviewed-stamp.mjs:53` 已改成
   `at: PLAN_REVIEWED_GATE_ONLINE_AT + 86_400_000`（加 1 天，故意离 `>=` 边界留距离），
   旧值的记录留在**同一文件的注释 `:43`**（「这里此前写的是 `1_700_000_000_123`」）。
   ⇒ 引用这一条时不要写成「`:42` 仍写死」——`:42` 是注释分隔行，写死的那个值**已经不在**了。
3. **t1 · inScope 漏了投影层**（今晚由 RV1 审查抓出，由 captain amend）
   —— 见 §2.1：不加 `src/state/tasks.ts`，验收第 1 条**在数据通路上不可达**。
4. **t2 · 验收 3 自相矛盾**（今晚由 RV2 审查抓出，由 captain amend）
   —— 原文要求「status 缺席时不拒」，而 `parseCommandResults` 现在就拒、且 `CommandResult.status` 是必填。

### 三条本该更早做的纪律

- **契约里的 verify 命令，必须在真实树上先跑一遍**，确认它有可能是绿的。
  t5 的 verify 从起草那天起就不可能绿，而它一路通过了 `preflight-contracts.mjs`
  —— 因为预检只查"命令合法"，不查"该命令当前是否红"。
- **inScope 的边界要按"这件事的全部影响面"划，不是按"我想改的文件"划。**
  t3 的 4 个越界文件、t1 的投影层，都是同一件事的另一半。
- **一条断言真实盘面的臂，天生会被真实盘面打红。**
  `scripts/gate-plan-reviewed-stamp.test.mjs` 臂 8 断言"盘面零个不可能戳"，
  实测 90 条 ⇒ 它 7 pass / 1 fail 是**正确状态**，不是缺陷（我复跑同值）。

---

## 附录 A · 我跑过的全部命令与原始退出码

按「我最后一次跑的时刻」排序。**最后一次全量复查在 `HEAD=777679b`**（主干在本任务期间从 `019ec3c`
走到 `777679b`，共 6 个提交）；复查后主树 `git status --porcelain -uall` 只有本报告 1 行 M。

### A-1 本轮 verify（契约要求的两条）

```
pnpm typecheck   @ HEAD 777679b  →  EXIT=0
   $ tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit    （无诊断输出）
pnpm build       →  EXIT=0（四次，都在一次性 worktree 里，主树一次没跑）
   ① @ /tmp/wt-head  = 351c2e3   2 files 938.96 kB
   ② @ /tmp/wt-h3    = 777679b   2 files 938.91 kB
   ③ @ /tmp/wt-final = 777679b   2 files 939.74 kB
   ④ @ /tmp/wt-v2    = 777679b   2 files 938.97 kB   ← 交回任务前的最后一次
   clean-build clear → tsc×2 → publish → tsdown → git-artifacts --write
   ★ 四次都**不在主树**执行（队长纪律 0e2fadb）；主树 04:57 那次旧构建产生的 stamp 变化已还原
   ★ 产出的 lib/*.js 与主树 md5 逐个全同（§4.4 的表格）—— 所以「不在主树 build」没有代价
   ★ 每次之后都立刻 `node scripts/git-artifacts.mjs` ⇒ 全部 EXIT=0「Git artifacts match source and build settings」
```

★ **`pnpm build` 为什么不能在主树跑，本轮有硬读数**：主树在 05:24:39–05:24:40 被构建过一次，
`.agent-teams/hmr-reloads.jsonl` 在同一秒记录到 **6 次插件重载**（05:24:40.385 … 05:24:44.050）。
详见 §4.4。

### A-2 各任务 verify 的复跑

```
node --test scripts/gate-plan-reviewed.test.mjs        → tests 17 / pass 17 / fail 0   EXIT=0
node --test scripts/gate-admission-point.test.mjs      → tests 10 / pass 10 / fail 0   EXIT=0
node --test scripts/gate-registry.test.mjs             → tests 35 / pass 35 / fail 0   EXIT=0   （t1 合入后；基线 351c2e3 上是 30/30/0）
node --test scripts/gate-update-task-unmeasured.test.mjs → tests 5 / pass 5 / fail 0   EXIT=0
node --test scripts/gate-input-wiring.test.mjs         → tests 17 / pass 15 / fail 2   EXIT=1
node --test scripts/verify-readout-uniform.test.mjs    → tests 14 / pass 13 / fail 0 (skipped 1) EXIT=0
node --test scripts/review-unified-pipeline.test.mjs   → tests 14 / pass 14 / fail 0   EXIT=0
node --test scripts/verify-unified-pipeline.test.mjs   → tests 11 / pass 10 / fail 1   EXIT=1
node --test scripts/gate-plan-reviewed-stamp.test.mjs  → tests 8 / pass 7 / fail 1     EXIT=1  （臂 8 恒红，刻意）
node --test scripts/git-artifacts.test.mjs             → tests 13 / pass 13 / fail 0   EXIT=0
node --test scripts/gate-stamp-ancestry.test.mjs       → tests 4 / pass 4 / fail 0     EXIT=0
node scripts/gate-wiring-census.mjs                    → EXIT=0
node scripts/gate-fixture-registry.mjs                 → EXIT=0   total=156 registered=150 unregistered=6 undecidable=0
node scripts/reviewed-stamp-census.mjs                 → EXIT=0   teams=27 stamps=183 impossible=95
node scripts/reviewed-stamp-census.mjs --active        → EXIT=0   teams=6  stamps=114 impossible=90
```

### A-3 基线树（我自己建的真 git worktree，不是 `git archive` —— 后者没有 `.git`，臂 9e 会 `fatal: not a git repository`）

```
/tmp/wt-e1ef3b7  gate-plan-reviewed 12/12 EXIT=0 · review-unified 14/14 EXIT=0 · verify-unified 11/10/1 EXIT=1
                 gate-input-wiring 12/10/2 EXIT=1 · gate-admission-point 3/3 EXIT=0
/tmp/wt-7a94837  gate-plan-reviewed 12/12 EXIT=0 · review-unified 14/14 EXIT=0 · verify-unified 11/10/1 EXIT=1
                 gate-input-wiring 17/15/2 EXIT=1 · gate-admission-point 10/10 EXIT=0
/tmp/wt-9720ca9  gate-input-wiring 12/10/2 EXIT=1 · gate-admission-point 3/3 EXIT=0
/tmp/wt-head (=351c2e3)  gate-registry 30/30/0 EXIT=0
/tmp/wt-h3  (=777679b)   pnpm build EXIT=0 · node scripts/git-artifacts.mjs EXIT=0 "Git artifacts match source and build settings"
```

### A-4 臂名集合差（不是比计数）

```
gate-plan-reviewed  父(7a94837) 12 → 主干 17   新增 5（臂 10/11/12/13/14）  删除 0
gate-admission-point 父(e1ef3b7)  3 → 主干 10   新增 7（臂 4–10）           删除 0
gate-input-wiring    父(9720ca9) 12 → 主干 17   新增 5（臂 13–17）          删除 0
gate-registry       父(351c2e3) 30 → 主干 35   新增 5（⑱ 臂 1/1b/2/2b/3）  删除 0
```

---

## 附录 B · 与既有正文的三条勘误（都是我自己复跑发现的）

### B-0 我差点把自己骗了：`grep -c` 会把**汇总行**当成一条记录

`node scripts/reviewed-stamp-census.mjs | grep -c "before this gate existed"` 得到的是 **96**，
而脚本自己打印的汇总是 `impossible : 95`。差 1 —— 因为脚本末尾那行汇总
`    impossible  : 95   ← stamped before this gate existed` **自己就匹配这个模式**。
正确的数法必须排除汇总行：

```
$ node scripts/reviewed-stamp-census.mjs | grep "before this gate existed" | grep -vE "^ *impossible" | wc -l
95
$ node scripts/reviewed-stamp-census.mjs --active | ...同上... | wc -l
90
```

⇒ 这与附录 B-1 是同一类错：**读数工具本身会污染读数**。凡是「用 grep 数一个自己也会打印该字符串的脚本」，
都必须先把汇总行排掉。我把这条写下来，是因为我在本轮**真的先写成了 96/91**，靠对撞汇总行才发现。

### B-1 「95 条不可能戳」与「90 条」都没错，但**不能混用**

`node scripts/reviewed-stamp-census.mjs` 的两个口径：

| 口径 | teams scanned | stamps | impossible |
|---|---|---|---|
| 不带参数 | 27 | 183 | **95** |
| `--active` | 6 | 114 | **90** |

差的 5 条全在 `.agent-teams/archive/` 下。`src/gates/dispatch/plan-reviewed.ts:46-47` 的注释用的是
「盘上带戳任务 151，其中 95 条」（全量口径），而 `scripts/gate-plan-reviewed-stamp.test.mjs` 臂 8 用的是
`activeOnly: true`（90 条）。两者各自自洽，但**报告里凡出现「95」的地方都要注明是全量口径**。
另外 t3 的 `commandsRun[6]` 命令是 `--active`，它跑出来是 90 —— 复核时不要拿 95 去对。

### B-2 HMR 因果**在日志尾部不成立** —— 这是对 `docs/DEFECT-HMR-DURING-MEMBER-TURN.md` 的反例

那份文档给了 4 行毫秒级对齐（538 ms / 11 ms / 537 ms / 6 ms），结论是「四次 inactive context 失败，
四次都紧跟在一次重载之后」。**我把它扩到全部 8 次失败后，尾部两次不成立**：

```
最后一次记录的重载：2026-10-19 05:04:15.335
  t1 attempt 5  05:04:54.491   Δ = +39.2 s
  t2 attempt 4  05:11:41.318   Δ = +446.0 s
```

（其余 6 次 Δ 分别是 125 s / 149 s / 109 s / 69 s / 288 s / 10.3 s，也都不是毫秒级。）

⇒ 修正后的说法应当是：**「inactive context」与重载的毫秒级对齐只在 04:46–04:57 那段窗口里成立**；
05:00 之后的两次失败**不能用「刚重载过」解释**。这不推翻根因（cordis 取值器那层是确定的），
但它推翻了「重载是唯一触发条件」这个更强的说法 —— 而这条更强的说法正是三条修法里第 2 条的理由。
**所以第 3 条修法（`pnpm build` 在成员活跃时拒绝执行）才是最有据的一条；第 2 条需要先解释这两次。**

---

## 附录 C · 一句话总结（可被反驳）

- **落在主干的 4 件**：R5、R6、R7、R1 —— 字节可核（`git diff <交付> HEAD -- <changedPaths>` 全 0 行）、
  verify 可复跑、臂名差集证明有判别力（12→17 / 3→10 / 12→17 / 30→35，**删除数全为 0**）。
- **主干上零交付 1 件**：R2R3R4（t2）—— 三处缺陷在主干上我逐条构造输入复现，全部还在；
  隔离树里已有 1028 行未提交改动（①③ 我实测已修好、反向半边成立），但**未提交 = 未交付**。
- **账没平（与代码分开记）**：四张已完工任务（t1/t3/t4/t5）的完工门全是 `ok:false`，
  其中四条是 r5 死代码造成的假阳性（§5.3 有根因）；t1 与 t4 **没有 `verdict` 键**；
  t3 的独立审查真实结论是 `needs_revision`；t3/t5 的完成回执由队长自己写。
- **结构缺陷影响成立且被对照验证**：同任务同成员同契约，基底 `e1ef3b7` 时 5 次 attempt 零产出，
  基底 `351c2e3` 时 11 分钟交付 `c090a04`。
- **本文的立场**：以上任一条都可以被一条可复跑的命令推翻 —— 命令都在附录 A。
- **★ 最该被反驳的一条**：如果 r5 的臂名解析在生产上其实拿得到 `output`，
  那么 §5.3 整节垮掉、四条 blocker 立刻从假阳性变成真阳性。我给的证伪路径在 §5.3 末尾。
- **★ 我在本轮推翻了自己两次**：①`lib/client.js` 的「242 行纯路径 diff」→ 实为 484 行且哈希随目录变；
  ②「主树 build 必然脏两行」→ 主树重建 `lib/client.js` 逐字节相同。两次都留着改正痕迹（§4.5）。
  **一份不能被自己推翻的报告，通常是因为它没测到能推翻自己的那一格。**
