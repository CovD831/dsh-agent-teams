# MVP 融合计划 —— 以当前状态为极限的最小可验证路径

> ★ 用户裁定（m0069 / m0078，原话）：
> 「整体的实施顺序必须按照**最小 MVP 的思想**去做，以我们当前的状态为极限。
> 每次做完改动，都需要满足以下要求：**1. 证明收益**：要么通过前后对比实验来证明有收益，
> 要么通过真实的测试来证明前后确实有所改善；或者如果某些机制提升了某种性能，
> 那性能的对比都要出来。**2. 保证运行**：这一切的前提都是能保证这个插件正常运行，
> 能正常帮我完成任务。先做一个**真实的大计划文档**吧」
>
> **判据纪律**：进展 = 命令打印的数字，不读任何模型的自我陈述。
> 每一步的"完成"定义 = §5 里那一步的前后读数都出来了、且失败**文件集合**没有变大。
>
> 生成时间：2026-10-18。基线提交 `4b648fb`（分支 `task-mutation-integrate`，领先 origin 58 commits）。
>
> ★★ **本计划自己的范围（写在最前面，免得读到中间忘了）**：
> **MVP 是 4 步 —— 0 → 1 → 2 → 4**。步骤 3 与步骤 5 **被这条计划自己的第 ④ 条原则推迟了**
> （见 §0.2 与 §3 那两节：1.2% 的共享池使用率、1.2% 的真实越界，各自撑不起一个改动）。
> 它们的完整方案仍留在 §3 里 —— 不是被否决，是**证据不足，先不做**。
> 步骤 6（读数常规化）是地基，已经先落地了：`scripts/mvp-measure.mjs` + `scripts/mvp-failing-files.mjs`。

---

## 0. 这份计划为什么长这样

### 0.1 它要解决的不是"缺功能"，是三种结构性缺失

本仓已有 7 个插入点 / 21 条判据 / 语料里 23 个团队 · 425 任务 · 102 成员（其中 215 个任务已完成、75 个成员至少完成过一条）。所以融合不是从零加能力，
而是把**已经存在但没人读的事实**接到**有人会因此改变行为**的地方。三处缺口各有可复跑读数：

| 缺失 | 读数 | 复跑命令 |
| --- | --- | --- |
| **① 残差看不见** —— 成员开工时读不到"这个团队的目标还剩哪些没人认领" | 全仓 `coverageOf` 使用率 **0 / 425 任务**；`profile.protocol` **23/23 团队全空** | `node scripts/mvp-measure.mjs --json` ⇒ `corpus.fieldUsage.coverageOf: 0` |
| **② 后序交接不存在** —— 产物提交了，但没有任何代码把它交给下一个人或系住 | 92 个 distinct `deliverableCommit` 里 **80 个无 ref、无活树**；其中 **3 个 (sha,path) 对 / 2 个文件**全网只存在于孤儿提交里 | `node scripts/mvp-measure.mjs --json` ⇒ `handoff.reachability` + `handoff.atRiskPaths` |
| **③ 「不实现」只是 prompt 一句话** —— 同一个成员既审又写 | 93 个有任务的成员里 **18 个（19.4%）** 同时做过 verifier 类与写类任务；★ 而"越界写源码"只有 **1 条**（review 0 条） | `node scripts/mvp-measure.mjs --json` ⇒ `verifierWrites`（★ 同时读它的 `wroteOutsideLib: 12` 与 `verifierSourceWriters: 1` —— **12 与 1 是两个不同的口径**，12 里有 7 条是审查报告、4 条是 integration） |

★★ **这三条都必须在同一份脚本里可复跑** —— `scripts/mvp-measure.mjs` 就是为此存在的。
下面正文里凡是写 `/tmp/*.mjs` 的历史读数，其口径都已并入那份脚本。

★★★ **而 ③ 是这份计划里唯一一条"读数把设计否掉"的例子**：19.4% 听起来值得做，
但拆开看 `verifierSourceWriters` 只有 **1**（1.2%）⇒ "审查者动了产品代码"这个危害
在 425 条真实任务上**只发生过一次**。所以步骤 5 被推迟（见 §3 步骤 5 / §7 第 5 条）。
**这就是"先算读数，再写判据"该有的样子 —— 包括否掉自己中意的设计。**

★ 而**有一条候选判据被这条纪律筛掉了**：`inScope` 重叠检查（32.3% 的任务与更早完成任务的
`changedPaths` 相交）看似危险，但重叠组失败率 **17.9%** 反而**低于**不重叠组 **23.3%**
⇒ 它没有收益证据 ⇒ **不进 MVP**。先算相关，再写判据。

### 0.2 排序原则（"最小 MVP"的具体含义）

```
① 每一步只接【一个】已有能力，不新增工具、不新增角色、不改数据模型的语义
   （parentTaskId 是新增字段，但它是【正交】的 —— 见 §3 步骤 4 的豁免）
② 每一步都必须能用【同一份真实语料】跑出前后两组数字
   ⇒ 优先复用 scripts/gate-corpus-shape.test.mjs 的 distributionOf（五态计数，一个都不许并）
③ 每一步的收益口径都必须能在【不改产品】的情况下先测出来
   ⇒ 先写读数脚本（scripts/mvp-*.mjs），再改产品
④ 任何一步若读数说"没收益"，就地停止，不继续往下做
   ★★ 而这条已经【兑现过一次】：步骤 3 与步骤 5 就是被它拦下来的
      （1.2% 的共享池使用率、1.2% 的真实越界）—— 见下面 §3 那两节
```

### 0.3 与 MAPLE（yunpai maple）的关系：只借三条纪律，不借它的机制

三个不可照抄点（已核实）：它的宪法**禁止** heartbeat / TTL / 超时驱动退出；它的 `run_child`
只认本次 run 内 hire 的 child（我们是持久化成员、要随时派发）；它**没有 worktree**（并行安全靠结构额度）。
⇒ 我们采纳的是它的**三条方法纪律**，且全部已经能在本仓找到对应：

```
· 负约束只写"不许"，永不写"应该"（侧向抑制的原文注释）
· 模型可修复的校验错误必须转成"可修复协议错误"，不能抛框架完整性错误
· 测量不裁判（morphology.py 用三重 AST 断言禁止自己被运行时和裁决器 import）
```

---

## 1. 现状基线（已核实，非记忆）—— 改前的数字，全部可复跑

### 1.1 构建与类型：**绿**

```
pnpm typecheck        exit=0   （tsc ×2，各约 1.4s）
pnpm build            exit=0   约 3.2s；lib/client.js 427.49 kB / gzip 118.02 kB
```

### 1.2 判据夹具：**红，但红在 15 个文件上，且这 15 个文件两次独立跑完全相同**

```
pnpm test:gates       exit=1   tests 1600 / pass 1541 / fail 22 / skipped 37
```

★ 读数口径：`node --test` 的 `✖` 行会出现**两次**（进度中一次、`failing tests:` 汇总里一次），
所以 `grep -c '^✖'` 得到 45 —— **45 是重复计数，真实失败数是 22**。本计划一律用
`ℹ fail` 那一行或"失败文件集合"，不用 `✖` 计数。

失败文件集合（**这就是 §5 里每一步"不许弄坏"的比对基准**，存于 `docs/_MVP-BASELINE-FILES.txt`）：

```
scripts/gate-baseline-known-failures.test.mjs      scripts/gate-stale-module.test.mjs
scripts/gate-contract-build-artifacts.test.mjs     scripts/gate-t1-completion-probe.test.mjs
scripts/gate-falsification-pairs.test.mjs          scripts/gate-worktree-arrival.test.mjs
scripts/gate-input-wiring.test.mjs                 scripts/verify-admission.test.mjs
scripts/gate-producer-consumer.test.mjs            scripts/verify-input-requires.test.mjs
scripts/gate-repair-completion.test.mjs            scripts/verify-runtime-integration.test.mjs
scripts/gate-reviewed-passthrough.test.mjs         scripts/verify-unified-pipeline.test.mjs
scripts/gate-source-reading-convention.test.mjs
```

★★ 逐条与 `scripts/fixtures/baseline-known-failures.json` 比对（比对键 `fixture||test`，
用栈里的 `file:///…/scripts/x.test.mjs` 归到文件）。**按文件粒度复算（本块实测，可复跑）**：

```
knownFailures 条目          17 条（分布在 14 个不同夹具上）
当前失败文件                 15 个
  完全记账                    8 个（gate-contract-build-artifacts / gate-input-wiring /
                                  gate-producer-consumer / gate-repair-completion /
                                  gate-source-reading-convention / verify-admission /
                                  verify-input-requires / verify-runtime-integration）
  完全未记账                  7 个（gate-baseline-known-failures / gate-falsification-pairs /
                                  gate-reviewed-passthrough / gate-stale-module /
                                  gate-t1-completion-probe / gate-worktree-arrival /
                                  verify-unified-pipeline）
★ 而账面另有 6 个夹具被"记账"了却【当前不红】（gate-readout-uniform / gate-runtime-clock /
  gate-runtime-liveness / moment-facts / verify-readout-uniform / verify-task-atomicity）
  ⇒ 那 6 条是**旧账**，说明这份名单不是"当前失败清单"，而是"曾经红过、先记账"的清单
```

★ 这条"账面 14 个夹具 vs 当前 15 个红、交集只有 8"的形状本身就是本计划要治的病：
**一份名单被当成"当前状态"读了**。步骤 0 只让它变成可读（`mvp-failing-files.mjs`），
不试图把 7 条未记账的一夜之间补齐 —— 那会把"修夹具"变成"改名单"，而 `_adding` 字段逐字写着
「宁可去修，也不要加」。

逐条归因后，**没有一条是"产品逻辑坏了"**（22 条唯一失败测试的成因分类）：

| 类别 | 条数 | 成因（逐条实测） |
| --- | --- | --- |
| **夹具断言腐化**（写死的位置数 / 文案 / 路径） | 8 | `verify-input-requires` 臂 1 写死"5 个位置"（现 7）；`gate-stale-module` 断言 `/OLDER than the one on disk/`；`gate-worktree-arrival` 断言 `task-t-impl` 而实际 `task-team-t-impl`；`verify-admission` 臂 0 断言"全跳过也放行"而 t58 已翻成 `ok:false`；`verify-runtime-integration` 期望 runtime 挂 1 条（现 2）；`verify-unified-pipeline` 期望净增恰好 2（实测 +10） |
| **普查臂如实报出的账实不符** | 4 | `gate-producer-consumer` "只有夹具消费"的产出涨到 31（记账 20）；`gate-falsification-pairs` 与 `gate-input-wiring` 双臂指出有判据既无对照对也无理由；`gate-baseline-known-failures` 有 pin 的成因类落不进已知类 |
| **等待中的连接已被复核** | 2 | `gate-reviewed-passthrough` 臂 3：`CreateTaskInput` 已声明 `reviewed` ⇒ 那条"等待中"的连接该复核 |
| **其他** | 1 | `gate-t1-completion-probe` 臂 5 断言 t1 记录里不该有 `baseRevision` |

### 1.3 全量验证链：**第一步就断，但断在夹具而非产品**

`pnpm verify`（22 步串行）在**第 1 步** `node scripts/verify.mjs` 就 exit=1：**8 FAIL / 180 PASS**（0.5s）。
逐条实测全是 `scripts/verify.mjs` 里的静态源码 `includes()` 断言与客户端源码分叉：

```
scripts/verify.mjs 最后三次改动：9779c58 / 672e044（2026-10-07）、f60d40d（2026-09-25）
src/client/MemberRow.tsx   最后三次：f08e4b2（10-17）、7fd07d6（10-16）、4fd5efc（10-16）
src/client/ActivityPanel.tsx 最后三次：b913911（10-17）、524fa59（10-16）、fa023f6（10-12）
⇒ 客户端在 10-16/10-17 被重构，verify.mjs 停在 10-07
```

四条具体分叉（每条都能用一行 node -e 复现）：

```
· inject 数组多了一个 'layout'（实际 6 项，断言钉 5 项）
· locale: AGENT_TEAMS_LOCALE_NAMESPACE 现 8 处（断言钉 === 5）
· member.status.discarded / .stopped 已搬到 MemberRow.tsx:741 / MemberScreen.tsx:139
· .memberModel 现 max-width:148px 且无 pill 背景（断言钉 max-width:132px + border-radius:999px）
  —— 而徽章本体（MemberRow.tsx:865 + role="img"）是**在的**
```

其余 21 步逐条单独跑的结果：**11 步 exit=0**（corrupt-state / web-routes / release / readme /
skill / http-body / compatibility / capabilities / member-spawn-recovery / source-runner / frictions）；
**4 步 exit=1**：`verify.mjs`、`verify:quality-gates`、`lifecycle-verify`、`stress-verify`。

★★ **这 4 步里的后 3 步是同一个病，而且第一眼看上去不是它**。逐条实测（★ 这一格是本轮最重要的方法发现）：

```
pnpm verify:quality-gates 首段 scripts/quality-gates-tdd.mjs
  ⇒ 64 PASS / 0 断言 FAIL，然后在 "tool-level closed loop" 一节的第一处
    agent_teams_create_task 抛出：
    create_task rejected: [dispatch.plan-reviewed] this plan has not been reviewed: no `reviewed`
    stamp is attached, and dispatch requires one … It is missing all 5 questions: `scope`,
    `prerequisite`, `move`, `acceptance`, `boundary`.
    而**表面**看到的是 finally 里的 ENOTEMPTY（见下），因为 rm 失败先抛了。
```

★★ **ENOTEMPTY 把真实原因盖住了**：`scripts/lifecycle-verify.mjs:1820` 的
`await rm(workspace, { recursive: true, force: true })` 在 `finally` 里，**先于**
`if (failures.length > 0) process.exit(1)` 执行 ⇒ rm 一抛，后面的 check 汇总就再也打不出来。
实测（★ 必须原地临时改再 `cp` 回去；复制到 /tmp 跑会 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-llm`）：
给 `lifecycle-verify.mjs` 与 `quality-gates-tdd.mjs` 的 `rm` 都加 `maxRetries:5, retryDelay:50` 之后，
**两者都前进到同一个 `dispatch.plan-reviewed` 拒绝**（lifecycle-verify 停在第 39 个 PASS 之后）。

```
真正的两个病（与"ENOTEMPTY"是什么关系）：
(a) ★ 主动病因：scripts/lifecycle-verify.mjs:787 / scripts/quality-gates-tdd.mjs:1052 一带的
    agent_teams_create_task 没带 `reviewed` 戳，被一条【真实开火】的新判据拒绝。
    证据它真的在生产里开火：.agent-teams/frictions/ 里 **40 条**记录含 plan-reviewed。
    ⇒ 修法是给夹具补戳（或按 PLAN-REVIEW.md §8 走一遍），不是放宽判据。
(b) 被动病：finally 里 `rm(workspace,{recursive:true,force:true})` 偶发
    Error: ENOTEMPTY: directory not empty, rmdir '/var/folders/…/.agent-teams[/frictions]'
    成因：拒绝路径上 void observe(...) 不 await（entities.ts:4503 → evolution/collect.ts:428），
          而 recordFriction（entities.ts:4175）先 await mkdir(frictions) 再写文件
    ⇒ 修法：清理处加 maxRetries + retryDelay（node 的 fs.rm 原生支持），不必 hack。
★★ 顺序上必须先修 (b) 再修 (a)：不修 (b)，(a) 的真实报错永远打不出来 ——
   一个关于夹具的结论，被一次清理竞态伪装了出来。
```

### 1.4 交付提交的四种归宿（最硬的一条读数）

```
100 条 deliverableCommit 记录 / 92 个 distinct commit
  inHead（HEAD 祖先）            1
  inOtherBranchRef（别的分支指着）  5    ← 全在 refs/heads/task-mutation-quality-t{1,3,11,13-t17,18}
  onlyLiveWorktree（活树 HEAD）     6
  fullyOrphan（无 ref、无活树）     80
noDownstreamConsumer = 38 / 100（38% 的产物做完就没人接）
```

80 个孤儿里按文件粒度比：**7 个与 HEAD 逐字节相同**（内容已落盘，只是对象身份不同）、**70 个不同**、
**3 个动了 HEAD 里根本不存在的文件**（3 个 `(sha, path)` 对 / 2 个路径）：

```
docs/P0-DECOUPLING.md    11,593B    来自 05fdc4e（t53，作者 ui-dissect）
docs/P0-DECOUPLING.md    +113 行    来自 3153092（t56 的 attempt 2，同一作者，内容比 t53 多 113 行）
E2E-COMMIT-PROBE.md                 来自 51925ed（t2，作者 e2e-worker，loose，mtime 10-10 03:47）
★ git log --all --oneline -- <path> 零命中；7 棵活 worktree 里也不存在
⇒ 它们只存在于这三个孤儿提交里，一份都没有别处
```

★ 7 + 70 + 3 = 80（三档互斥且齐全）。
★ 附带核实：`3153092` 还改了 `scripts/verify.mjs` —— 我把它整文件取出跑过，**仍是 8 FAIL**，
那 8 条一条都没修（它做的是「按语义定位」的基础设施，不是修断言）⇒ 步骤 0a 不能指望捡回那棵树。

紧迫度（**按读数说，不按感觉说**）：

```
git config gc.pruneExpire           未设置（缺省 2.weeks.ago）
51925ed 仍是 loose，mtime Oct 10 03:47:32，今天 Oct 18 04:09 ⇒ 已 7 天 12 小时
git count-objects -v  count 2937 / in-pack 7807 / packs 3 / prune-packable 0
git fsck --unreachable  624 条 unreachable commit
⇒ 安全窗还剩约 6 天，不是"已经丢了"
```

★ 根因是结构性的：`grep -rn "update-ref|refs/agent-teams|refs/heads/" src/ --include=*.ts` ⇒ **零命中**
⇒ 整个 `src/` 没有任何创建 ref 的能力；而 `src/worktree.ts:599` 的 commit message 逐字写着
「合流由 **integrator** 负责」—— 这句话在代码里没有对应实现，也没有任何角色被指派这件事。
`deliverableCommit` 全仓**只有一个写点、零个读者**（`update-task.ts:1711` 写、`types.ts:668` 声明）。

### 1.5 语料规模（收益口径的分母）

```
23 个 team.json / 425 任务
status: completed 215 · failed 86 · cancelled 101 · pending 21 · in_progress 2
kinds : implementation 205 · repair 72 · work 41 · review 40 · verification 24 · integration 20 · 无 23
字段使用率: coverageOf 0 · parentTaskId 0 · handoffCommit 0 · delivery 0
            deliverableCommit 100 · inScope 362 · acceptance 391 · verify 332 · objective 396
reviewed 151 / reviewedTaskId 40
findings: 23 条任务带该字段，**共 68 个 finding 元素** —— ★ 两个口径，别混
verdict : 40 条有值 {pass:34, needs_revision:5, reject:1}
ready 但未派发的 pending：8 条，其中 3 条 assignee 为 undefined —— ★ n=8，仍然太小
（口径 = `unsatisfiedDependencies` 的真实规则：failed / cancelled 也是终态 ⇒ 也算满足；
 这 8 条里 2 条出自 integrate-probe、3 条出自 unified-pipeline）
```

### 1.6 admission 三条判据的真实处境（决定步骤 2 怎么做）

```
evaluate('admission', …) 生产路径调用点 = 0 处（grep 全量 .evaluate( 共 9 处，8 个位置）
而它们的输入面在生产里【没有任何人提供】：
  absorb.claims     src/ 里只有判据自己读（grep 除 src/gates/ 外零命中）⇒ appliesTo 恒假 ⇒ skipped
  documents         全仓 .agent-teams/** 搜 open-questions* 零命中；profile.protocol 全 undefined ⇒ skipped
  convene.appliesTo 恒真，但读 ctx.upstream ⇒ unmeasured(…)，且缺省 disposition='refuse'
                    ⇒ ★ 直接接线会把【每一次成团】都拒掉
```

★★ 所以**"接线"不等于"三条判据开始管事"**。步骤 2 的设计前提是：
**先让某人真的提供那几格，再接**；否则接上后只是把"静默不跑"换成"静默跳过 / 恒拒绝"。

### 1.7 与本次计划相关的两个既有机制

```
· 观察模式已在注册表里：OBSERVE_GATES_ENV='AGENT_TEAMS_OBSERVE_GATES'；
  但唯一生产构造点 src/gates/index.ts:551 是 createGateRegistry() 无参
  ⇒ index.ts:138-199 逐字禁止在装配点写 registry.observe(id)（观察期只在模块加载与 apply() 之间）
  ⇒ "新增判据出厂 off"今天只能靠部署时设环境变量
· 快环：pnpm verify:fast 产物只有 {mode:'fast', ran, skipped, at}，【没有】ok/verdict
  ⇒ 快环结果不得进入任何终态裁决（scripts/verify-fast.mjs 的 assertFastRingIsNonAuthoritative 扫 src/** 禁止读它）
```

---

## 2. 不做的事（写清楚，免得后面反复讨论）

| 不做 | 理由（读数） |
| --- | --- |
| **不做 `inScope` 重叠判据** | 重叠组失败率 17.9% < 不重叠组 23.3%，反向相关 |
| **不做步骤 3（能力匹配 rank）** | 425 条任务里只有 5 条走过共享池（1.2%），且全是 8–12 天没人管的废弃探针；没有可复跑的收益读数 |
| **不做步骤 5（tools 白名单收紧）** | 真实"审查者动了源码"只有 1.2%；且唯一能落地的形态（按 kind 派人）依赖步骤 3 ⇒ 一起推迟 |
| **不做形态学测量（morphology）/ RulePack** | 它是"评估"而非"执行"；在 ①②③ 三个缺口闭掉之前做它，等于给一支没有树的队伍量身高 |
| **不新增 `hire_child` 工具** | 现有 `create_task` 已能建任务；`requireCaptainTeam \|\| parentTaskId === 我` 的分支足够 |
| **不给残差视图加 weight** | Goodhart：成员会压低自己那一项的权重来抬眼 `covered_ratio`。第一版全等权 1.0，字段留着不生效 |
| **不照抄 MAPLE 的"双计时器掐死"** | 它的宪法第 9 条禁止超时驱动退出；我们的 `runtime/liveness.ts` 也是"只报不救" |
| **不修 8 条 `scripts/verify.mjs` 之外的客户端断言** | 只修这 8 条，因为它们是 `pnpm verify` 的**第一道门**；其余的不在关键路径上 |
| **不清理 5.3 GB worktree** | `DECISIONS-PENDING.md` §1 的 D1 数据（"哪些任务真的用到了 worktree 的价值"）还没采；清早了会把证据一起删掉 |

---

## 3. 步骤（每步都有"改前 / 改后 / 不许弄坏"三组读数）

★★ **MVP 只有 4 步**（数字编号保留 0..6 是为了与 `DECISIONS-PENDING.md` 的引用一致）：

```
在做   步骤 0（把失败变成可读的）· 1（残差视图）· 2（admission 接线）· 4（后序交接 4a/4b/4c）
推迟   步骤 3（能力匹配 rank）· 5（tools 白名单）
地基   步骤 6（读数常规化 —— scripts/mvp-measure.mjs 已经先落地了）
```

★ **为什么砍 3 和 5**：它们各自缺的不是实现方案（方案都已核清），而是**一条可复跑的收益读数**
—— 425 条任务里只有 5 条走过共享池（1.2%）、真实的"审查者动源码"只有 1 条（1.2%）。
用户的原话是"以我们当前的状态为极限"，把没有收益证据的机制塞进 MVP 会让整份计划的门槛失真。
★ 两步的完整方案与"若将来要做"的落点都留在原处，没有删 —— 只是**不在 MVP 的执行序列里**。

★ 数字顺序**已经满足** §4 里那两条真实依赖（`4a → 4c`、`4b → 4c`），所以按 0→1→2→4 走就是对的。
★ 但**不要求**串行执行：§4 列了三对可以并行的（写域互不重叠）。

### 步骤 0 · 把失败变成可读的（修复 `pnpm verify` 第一道门 + 采准 D1 数据）

**为什么它是第 0 步**：用户的要求是"保证运行"。今天 `pnpm verify` 在第一步就红，
不修这一格，后面每一步的"证明"都没有一个可信的总闸。★ 它也是**唯一一步"改测试不改产品"**。

改动（三件事，全部是让读数重新成立，不是放宽断言）：

```
0a  scripts/verify.mjs 的 8 条断言按【现在的位置】重写，每条都要写清"改前它防的是什么/为什么现在要改/改成什么"
    （docs/ADMISSION-WIRING.md §3 的格式）
0b  scripts/lifecycle-verify.mjs:787 与 scripts/quality-gates-tdd.mjs:1052 两处的 agent_teams_create_task
    补上 `reviewed` 戳（形如 {at, by:'admission-harness', checks:[{id:'scope',verdict:'pass'}, …五问]}
    —— ★ 五问必须齐：plan-reviewed 的措辞就是 "It is missing all 5 questions"）
    ★ 不许把它写进 baseline-known-failures.json —— 那里逐字写着"宁可去修，也不要加"
0c  ★★ 0c 必须【先于】0b 做：把 lifecycle-verify.mjs:1820 与 quality-gates-tdd.mjs 三处 rm 改成
    rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    理由：不修这处，finally 里的 ENOTEMPTY 会先抛，把 0b 那条真实报错盖掉
    （实测：修了它之后两个脚本都才暴露出 dispatch.plan-reviewed 拒绝）
    ⇒ 顺带给 recordFriction 与 observe 的调用顺序看一眼（entities.ts:4175 / :4503）
       —— 那是 ENOTEMPTY 的**成因**，但本步只要求让读数可读，不要求根治竞态
```

★★ **本步的三条"不许"**：
```
· 不许把 reviewed 戳写成恒真 —— 五问的 verdict 必须是 pass/fail/unmeasured 三态之一，
  且计划审的是"派发前这份 plan 值不值得做"，不是"我来盖个章"
· 不许用 baseline-known-failures.json 把红收编（那文件自己写着"宁可去修，也不要加"）
· 不许在 0c 之前先改 0b —— 改了也看不见效果，只会以为"改了还是红"
```

**★ 顺带采 D1 数据（这一步唯一的新读数，用于 §2 里被推迟的 worktree 去留决策）**：

```
对每条带 deliverableCommit 的任务，判定它的产物是否【只在 worktree 里存在】：
  形态Ⅰ 该 commit 的文件与 HEAD 逐字节相同        ⇒ 那棵树的独立价值 = 0
  形态Ⅱ 该 commit 有 HEAD 里不存在的文件           ⇒ 独立价值 = 高
  形态Ⅲ 其余（与 HEAD 分叉但文件都在）             ⇒ 需人判
★ 改前读数（`node scripts/mvp-measure.mjs` 的 handoff.orphanContent，分母只算 80 个孤儿）：
  形态Ⅰ **7** · 形态Ⅱ **3** · 形态Ⅲ **70**
★ 注意分母不同：92 是 distinct commit，80 是其中不可达的；形态分类只对 80 做。
```

**验收（可复跑，全部是命令打印的数字）**：

| 读数 | 改前 | 期望改后 |
| --- | --- | --- |
| `node scripts/verify.mjs` | 8 FAIL / 180 PASS | **0 FAIL**（PASS 数 ≥ 180，只增不减） |
| `node scripts/mvp-failing-files.mjs --diff docs/_MVP-BASELINE-FILES.txt` | 基线 15 个（已采） | **新增 0**，且 `修好` 里有 `verify-admission` |
| `node scripts/lifecycle-verify.mjs` | 39 PASS 后抛 | **PASS 数 ≥ 39 且 exit=0**（★ 全文 129 处 `check(`，今天只跑到前 39 处 ⇒ **后面 90 处从未被执行过**） |
| `node scripts/quality-gates-tdd.mjs` | 64 PASS 后抛 | **PASS 数 ≥ 64 且 exit=0**；`tool-level closed loop` 一节要真的跑完 |
| `node scripts/mvp-measure.mjs --json` 的 `handoff.orphanContent` | 7 / 70 / 3 **已就绪** | 不变（它是基线，不是待做的活） |

★★ **验收口径上有一条硬纪律**：本步改的都是**夹具**，所以"改后全绿"本身不算证据 ——
必须有一条**反向半边**：把 `reviewed` 戳从夹具里拿掉，`lifecycle-verify` 必须**重新红在同一条**上。
只有这一步做到了，才能说"我修的是夹具，判据没被放宽"。

---

### 步骤 1 · 残差视图进派发提示（`residual_view`）

**这一步是"信息注入"还是"约束"？** —— 用户已裁定（m0078 之前那轮）**先做信息注入**，
但必须是**内核算的、成员改不了的**读数，而不是把目标清单丢给成员自己算。这就是它与
MAPLE **v2（信息注入 ⇒ 无效）**的关键区别：v2 注入的是"你的层级位置"，那是**描述**；
这里注入的是"目标 N 条，0 条有人认领"，那是**内核的测量**。

**落点（唯一拼装点，已核）**：`src/scheduler.ts:565 assignmentPrompt(ticket, stateDir, teamId)`，
插在 `worktreeBlock` / `unavailableLine` 之后、`Team goal:` 之前。数据从 `src/scheduler.ts:1074`
的 `DispatchTicket` 构造点带进去（新增 `residual?: ResidualView` 一格）。

**数据从哪来（★ 这一步的最大坑，已实测）**：现有的覆盖矩阵在真实语料上**恒为空**：

```
buildCoverageMatrix(goalItems, tasks)（quality-gates.ts:2222）
  goalItems 在生产只有一处来源：[...new Set(tasks.flatMap(t => t.coverageOf ?? []))]
  实测 coverageOf 使用率 0 / 425  ⇒ 矩阵恒为空数组
  profile.protocol 全语料 undefined ⇒ 那条路也接不上
```

⇒ 第一版的**目标清单**取自 `team.description`（**23/23 有值**）+ 本次 `task.objective`
（396/425 有值）；覆盖率取自三样**已有**的东西：`coverageOf`（有就用）、
`deliverables[]`（61 条）、`acceptance[]`（391 条）。★ 并必须有一条臂钉住
**"目标清单为空 ⇒ 不注入，且如实说明没有"** —— 不许把空字符串当残差发出去。

**三态（照 `formatDependencyOutputs` 的先例）**：

```
有残差   ⇒ 一段 "Open goals: k of n uncovered" + 逐条列出，带 task_ids
全 covered ⇒ "Open goals: all n covered (measured <at>)"   ← 与"没测到"不同形
拿不到   ⇒ "Open goals: not measured (<why>)"                ← 绝不写成"全 covered"
```

**验收**：

| 读数 | 改前 | 期望改后 |
| --- | --- | --- |
| 新夹具 `scripts/gate-residual-view.test.mjs` | 无 | 三态各一臂 + 反向半边（把注入删掉必须红） |
| 在 23 个真实 team 上离线渲染 `assignmentPrompt` | 0/23 含残差段 | **23/23 含**，且空目标清单那几条落在"not measured" |
| `task.objective` 覆盖率 | 396/425 | 不变（不新增字段依赖） |
| `node scripts/mvp-failing-files.mjs --diff docs/_MVP-BASELINE-FILES.txt` | 基线 15 个 | **新增 0** |

★ **这一步不承诺"失败率下降"**——它是信息注入，收益是**可读性**，不是成功率。
把它写成收益是 MAPLE v1/v2 失败的原因。真正的行为收益在步骤 4。

---

### 步骤 2 · admission 接线 —— 但先给它喂得进去的输入

**这一步是"接线"还是"造输入"？** 读数说：**主要是造输入**。直接接线的结局是
`skipped / skipped / 恒 unmeasured(refuse)` ⇒ 每一次成团都被拒（§1.6）。

改动（顺序不可颠倒）：

```
2a  先定"谁提供输入"（★ 这是唯一需要设计决定的一格）：
     · open-questions.json  ⇒ 不存在，也不该为它新造一个文件
       ⇒ 改为：convene 的"无待确认问题"读【队长的 planReviewState（src/types.ts:1144
         'awaiting_review'|'awaiting_feedback'）+ 未读收件箱】（已有事实，不需要新机制）
     · absorb.claims ⇒ 不新增申报面。staged 阶段 `edit_plan` 已经是一次"吸收"动作
       ⇒ claims 由 `approvedAt` 之前是否有 `edit_plan` 推导
     · documents / currentRevisions / reviewedRevisions ⇒ ★ 这里**不能**直接用 reviewedArtifacts：
       那是**内容摘要**（`ReviewedArtifact = {path, digest: sha256}`，src/types.ts:235-240），
       不是 git 修订标识，而 checkpoint 要的是**修订号**
       ⇒ 必须新增一次"文档 → git 修订"的读取（`git rev-parse HEAD:<path>`），
         并把"上一次审查时的修订"另行记下（今天是缺的，这就是为什么它恒 unmeasured）
2b  在 approveStagedTeam（src/tools.ts:2140，staged→running 的唯一入口）求值 evaluate('admission', ctx)
2c  三条判据在**没有输入时**的裁决必须是 unmeasured(…, 'tolerate')，并在同一行写清"等我喂它"
     ★ 不许把它们悄悄写进观察集 —— index.ts:138-199 逐字禁止
2d  连带改动（不接会变成事实错误）：status.ts:98 的 NOT_EVALUATED_IN_STATUS、
     snapshot.ts:714 的"admission 是空段"、client/activity-model.ts:1459/1468/1484 的 SegmentAbsence.noGate
```

**验收**：

| 读数 | 改前 | 期望改后 |
| --- | --- | --- |
| `grep -c "evaluate('admission'" src/` | **0** | **≥1** |
| `node scripts/mvp-failing-files.mjs --diff docs/_MVP-BASELINE-FILES.txt` | 基线 15 个 | **新增 0**；★ `修好` 里必须出现 `verify-admission`（改那一句断言，见下） |
| 新夹具：staged 团队**不被拒** | — | 一条臂（★ 这是最容易写成恒拒的一条） |
| 新夹具：running 团队成团时三条都真的求值 | — | 一条臂，且断言 `skipped === 0` |
| 真实语料回放 23 个已存在团队 | — | 0 个被拒（它们早就成团了） |

★ `verify-admission` 那**一条**修的是步骤 0 就该修掉的同类问题（`skippedVerdict.ok === true`）；
本步（2）要它出现在 `修好` 里，是因为 admission 一旦接线，它还会暴露**第二类**问题：
`inputSurfaceOf` 的调用点（`src/tools/shared/entities.ts:2859`，5 处）少于 `evaluate` 的求值点
（8 处）—— 那条形状不会因为"改一句断言"而消失，它是接线的直接后果。

★ 现有 `verify-admission` 的臂 0 是**断言腐化**，不是"等接线"：它断言
`assert.equal(skippedVerdict.ok, true, '★ 全跳过也必须放行（"这一轮没有适用判据"是正常情形）')`（:228），而 t58 已把全跳过翻成
`ok:false`（`src/gates/registry.ts:1012`，`gate-registry.test.mjs:307` 明写"t58 之后：全跳过 ⇒ ok:false"）
⇒ 修法是**改这句断言**（并补上它真正想钉的那件事：`skippedAll` 在场 + 形状与"都通过"不同），
**不是**去改产品。
★ 而本臂**其余断言今天全绿**（整臂 1 处 `assert.equal` 失败；文件级读数 `node --test
scripts/verify-admission.test.mjs` ⇒ pass 9 / fail 1），所以这不是"整臂腐化"，是**一行**与 t58 的分歧 ——
★ 更要紧的是它旁边那 6 条（`skippedAll` 必须为 string、空位置不得产出它、
三种情形两两不同形）**仍然在管**，改动只许动第一行。

★ 同理 `gate-admission-point.test.mjs` 今天已经 3/3 全绿，它的文件头刻意写着「`admission` 现在一条判据都没有 —— 但那**不是不变量**」，可以不改。

★ **这一步的收益是"一条判据从静默不跑到真的跑"**，不是"抓到 N 个问题"。要报的读数是
**求值次数**（0 → 每次成团 1 次），而不是"命中数"。

---

### 步骤 3 · 能力匹配进选人（`capabilities` + 内核 rank）—— ★ 建议**推迟**

**★★ 先把话说死：本轮实测发现这一步的收益主张目前站不住。** 数字（`mvp-measure` 可复跑）：

```
425 条任务里，有 assignee 的 420 条、没有 assignee 的 5 条（1.2%）
而那 5 条全部落在两个已经废弃的探针团队里、全部还是 pending、已经等了 8–12 天：
  gates-positions/t4 t5（12 天） · integrate-probe/t1 t2 t3（8 天）
⇒ 而 nextReadyTask 的第二条规则（`ready.find(t => t.assignee === undefined)`）
  在真实语料上【几乎从未被走到过】—— 它不是"用得少"，是"用得上的场景从没发生过"
```

**⇒ 在这样一条路径上加排序，等于在没有流量的路上修红绿灯。** 所以本步的处置是：

```
★ 建议：不在 MVP 里做。把它降到"步骤 3'（可选，需先有需求）"。
★ 理由不是它没用，而是【没有可复跑的收益读数能支撑它】—— 那正是 §0.2 原则 ④ 要拦的东西。
★ 而它一旦有了需求，落点已经核清（见下），随时可以捡回来。
```

**如果将来要做，落点与形状（已核实，别重查）**：

```ts
// src/scheduler.ts:557 —— 现有两条规则（不改）
return ready.find(t => t.assignee === memberName)
  ?? ready.find(t => t.assignee === undefined)
// 提议：把第二条换成"在共享池里按能力排序"
//   ★ 只影响第二条的排序，不影响它的集合 ⇒ 有 assignee 时行为一个字不变
```

**数据形状**（照 `src/profiles.ts:23 MEMBER_KEYS` 加一格，**不做成新表**）：

```
TeamMember.capabilities?: readonly string[]      // 缺席 = 未声明，⇒ 不参与排序（不是"什么都不会"）
TeamTask.capabilities?: readonly string[]        // 需要什么；缺席 = 不需要特定能力
```

**★ 而"为什么 5 条都没人接"才是真问题** —— 它们不是"没能力匹配"，是**没有人会看到它们**：
`nextReadyTask` 只在 kick 某个成员时被调用，而这两个团队的成员早就没人 kick 了。
⇒ 真正缺的是「共享池里躺着 ≥N 天没人认领」的**可见性**（一条读数，不是一条排序）。
那个读数今天不存在 —— 它属于步骤 6 的格子里该有的一项，而不是一个 rank 算法。

**若决定仍要做，验收（两条，缺一不可）**：

| 读数 | 改前 | 期望改后 |
| --- | --- | --- |
| 离线重放：425 条历史任务，按新 rank 问"若当时在共享池会选谁" | 无 | 与原分配**一致率 ≥ 95%**（否则说明 rank 在改历史判断，不是补充）；★ **n=5，样本不足，这个 ≥95% 几乎必然成立也可能毫无意义** |
| 有 `capabilities` 的成员数 | 0 | 由夹具造 ≥2 个不同能力集，证明排序**真的改变了结果**（反向半边：能力集设成一样 ⇒ 顺序退回原口径） |

★★ **诚实结论**：本步的"≥95% 一致率"是个**低信息量**的判据 —— 分母只有 5，怎么算都能过。
所以它**不该进 MVP**。已把这条移进 `DECISIONS-PENDING.md` 待裁。

---

### 步骤 4 · 后序交接（`parentTaskId` 正交字段 + 落 ref + 交付时的"无人接"检查）

**这是四步里唯一有"结构性收益"的一步**，因为读数最硬（80 个孤儿、2 个文件全网唯一、38% 无人接）。
它拆成**三个互不依赖的小件**，可以分别上线、分别量：

```
4a ★ 系住（约 10 行，风险最低）：任务落终态且 deliverableCommit 有值时，
   写一条 ref: refs/agent-teams/<teamId>/<taskId> 指向它
   —— 落点 update-task.ts:1711 附近，workspace / stateRoot / fresh.id / task.id 全在作用域内
   —— 收益读数：`git fsck --unreachable` 的 624 条里，deliverable 那部分归零
4b ★ 正交的树：TeamTask.parentTaskId（新字段，不进 unsatisfiedDependencies，nextReadyTask 一行不改）
   —— 依据：unsatisfiedDependencies 只读 dependencies 数组（`src/state.ts:190`），
      ⇒ 新增一个字段在结构上不可能影响就绪判定
   —— 收益读数：能回答"这棵子树完成了吗"（今天靠 dependencies 一张表同时承载两条轴）
4c ★ 交付前的"无人接"检查：把已有的 canDeclareDelivery（quality-gates.ts:2237）与
   buildCoverageMatrix（:2222）之间那条【不存在的线】连起来 —— 今天它不读覆盖矩阵
```

**★ 明确不做**：不做 integrator 角色，不做 `defaultQualityDeliveryGraph`（零生产调用，`quality-gates.ts:2520`）。
缺的不是角色，是**顺序**；4a 用 10 行就让"该并什么"可枚举，之后谁来并是人的决定。

**验收**：

| 读数 | 改前 | 期望改后 |
| --- | --- | --- |
| 不可达的 deliverable commit | **80** | **0**（4a 后） |
| 全网唯一的孤儿文件数 | **2 个路径 / 3 个 (sha,path) 对**（`docs/P0-DECOUPLING.md` ×2、`E2E-COMMIT-PROBE.md`） | **0**（4a 后立即可 `git cat-file` 从 ref 读出） |
| 无下游消费者的产物 | **38 / 100** | 4c 后：交付时**点名**；不是数字变小，而是"从读不出来变成读得出来" |
| `grep -rn "update-ref" src/` | **0** | ≥1 |
| 反向半边 | — | 把 4a 拿掉 ⇒ 孤儿数必须回到 80 |

★ 4a 的收益读数**当场可证**：改动前 `git for-each-ref refs/agent-teams` 空，改动后 92 条
（其中 80 条从 `fsck --unreachable` 的 624 里消失）。这是本计划里**唯一一条"打一个命令就能看见前后差别"**的收益。
★ 一个反直觉的细节：4a **不需要**先决定"该不该并"。落 ref 只是"系住"，它让后续的合并变成
可枚举的清单，而**不改任何工作区内容** —— 所以它的风险与"合并策略"完全解耦。

---

### 步骤 5 · 「不实现」变成结构约束（tools 白名单）—— ★ 建议**推迟**（依赖步骤 3）

**★★ 两个纠正，先说清，因为这条我原先写错过两次。**

**纠正一：依据被夸大了。** 我原先写「84 条 verifier 里 12 条（14.3%）写了非 `lib/` 文件」——
那个 12 是**全部写完再回看**的读数，不是"越界写源码"的证据。逐条拆开（本轮实测）：

```
verification/review/integration 共 84 条，其中 12 条 changedPaths 含非 lib/ 文件：
  7 条写的是自己那份审查报告（docs/REVIEW-*.md、docs/HANDOVER.md）  ← 这是【正当产出】
  4 条是 integration（agent-teams-gates/t14、gate-inputs/t7/t9/t10）  ← integration 本来就该写
  1 条是 verification（gate-inputs/t8：scripts/verify-input-requires.test.mjs + package.json）
★★ 真正的"审查者/验证者动了源码"：review 0 条 · verification 1 条（84 里 1 条 = 1.2%）
```

⇒ **这条读数撑不起"给 verifier 收紧写权限"这个改动**。1.2% 的样本，而且那 1 条本身
（改夹具 + 加一个 devDependency）**未必是坏事**。写计划时我把"12"当成了"12 次越界"，那是错的。

**纠正二：机制上做不到"按任务收紧"。** 换一个口径重测，有量的是这个：

```
members 有过任务的一共 93 个；其中【既做过 verifier 类、又做过写类】的 18 个（19.4%）
   例：agent-teams-refactor/archaeologist  work,repair,review,implementation
       agent-teams-refactor/reviewer-glm   review,work,implementation
       agent-teams-gates/integrator        work,implementation,integration
⇒ 同一个成员今天可以在"审"和"写"之间横跳 —— 而「审查者不实现」要防的正是这个
```

```
· 机制：`agent.ctx.tools.restrict()` 的 `deny` 是【按 agent 一生】生效的，不随任务切换
  （`src/capabilities.ts:53` 的 Exposure 是 WeakMap<Agent>、`installTeamCapabilities` 注释逐字
    "Call once, after all business definitions have registered. Never per member."）
  ⇒ 不能"派 review 时收紧、派 implementation 时放开"
  ⇒ 合理做法只有一种：**给 review 单独派一个只读成员**，而不是复用写手成员
· 但那要"按 kind 选人"，而那正是步骤 3 的 rank —— 而步骤 3 已被推迟（无收益读数）
  ⇒ ★★ 步骤 5 因此也随之推迟；它不是独立可做的一步
```

**★ 所以本步的正确处置是：不在 MVP 里做。** 理由与步骤 3 同构 —— 它**没有可复跑的收益读数**
（1.2%），而且它唯一能落地的形态依赖一个已被判"无收益"的机制。

**如果将来要做，机制清单（已核实，别重查）**：

```
· tools 白名单今天只有【队长/成员】二分：
  src/capabilities.ts:91  agent.ctx.tools.restrict({ deny: TEAM_TOOL_NAMES.filter(n => !MEMBER_TOOL_NAMES.includes(n)) })
  MEMBER_TOOL_NAMES = claim_task / update_task / send_message / status（4 个）
  —— ★ 注意：这 4 个都是【状态工具】，成员"写文件"靠的是宿主工具，不在这个清单里
    ⇒ 所以"白名单"能拦的是【团队工具面】，拦不住"读文件/写文件"
    ⇒ 真正要做的不是 deny 团队工具，而是【把成员对宿主工具的 exposure 收窄】
      （宿主支持 `restrict({ allow: [...] })` 返回 restore —— scripts/capabilities.test.mjs:154 已证）
· 已有的相关机制：src/harness-compat.ts:726 restrictableToolNames(agent) 读宿主 tools.view().restrictableNames
  · :748 memberToolFilter(maxDepth, knownTools) · :793 startMemberWithLenientFilter（按 unknown global tool 逐次放宽）
  · 调用点 src/members.ts:670
```

**验收（若将来做；诚实版，收益读数以"结构可判"为主，不承诺数字下降）**：

| 读数 | 改前 | 期望改后 |
| --- | --- | --- |
| 同一个成员既审又写的比例 | **18 / 93（19.4%）** | 新团队里 **0**（只对新成团生效；历史不改） |
| `restrict` 能按任务切换吗 | **不能**（Exposure 按 agent 缓存） | 仍不能 —— 所以本步**不靠**它，靠派人 |
| review 派发的成员有没有写权限 | 有（成员对宿主工具面未收窄） | 该成员**从未**在写类任务上出现过（结构判据，不是权限判据） |
| 反向半边 | — | 把"按 kind 选人"关掉 ⇒ 那两个混合成员重新可能被派 review |

★ **本步允许被整条删掉**：如果将来做步骤 3 的 rank 之后发现"混合成员"其实是好事（比如
`reviewer-glm` 审自己写的东西时确实更准），那第 5 步就该删掉，并把读数写进
`DECISIONS-PENDING.md`。**这比强行上线一个没有证据支撑的机制诚实。**

---

### 步骤 6 · 把"收益证明"变成常规（而不是这一轮的产物）

**★ 已完成（本计划之前就落了，刻意如此）**：`scripts/mvp-measure.mjs` 已经写进仓库并跑通
（约 10 秒，7 组读数）。★ 它先于任何产品改动落地 —— 这正是 §0.2 原则 ③
「先写读数脚本，再改产品」，否则你没法证明第一步之后的任何一步有收益。

```
node scripts/mvp-measure.mjs          人读表格（7 组读数，只报数不裁决）
node scripts/mvp-measure.mjs --json   JSON，shape 与 fast-ring 同一条纪律：
                                      【不含】ok / verdict / pass / fail
                                      （理由：verify-fast.mjs 的三条纪律，其中一条是
                                        静态断言扫 src/** 禁止读产物 ⇒ 本项目也不许有读者）
```

**它剩下的工作只有一件**：把 §3 里**产品改动之后才会出现**的读数接进去
（残差注入的覆盖率、admission 的求值次数、rank 的一致率、refs/agent-teams 的条数）。
★ 那些格子现在**必须报 `null`（没能测）而不是 `0`** —— 今天 `admissionWiring.admissionCallSites`
就是 `0` 且带一句 `note` 说明"没有求值点 ≠ 求值了 0 次"，这个形状要沿用到每一个新格子。

它的验收：把步骤 0–5 全部 `git stash` 掉，`node scripts/mvp-measure.mjs --json` 必须与
`docs/_MVP-BASELINE-PIN.json` 里的数字**逐字相同**；`git stash pop` 之后必须不同。
⇒ 这同时是"收益证明可复跑"的自证。

---

## 4. 依赖关系与并行性（为什么不能打乱顺序）

★★ 先说清一件事：**这几步之间大部分没有技术依赖，只有"验证顺序"依赖** ——
每一步的验收都是"失败文件集合不许变大"，而那个集合只有在**前一步落地之后**才是新基线。
所以下面写的是**真实依赖**，没写出来的都是**建议顺序**（可换，但要自己承担读数失准）：

```
步骤 0  ────┬──► 步骤 1  （1 需要 0 的绿闸门：否则"残差注入没弄坏东西"无从判断）
            ├──► 步骤 2  （2 只依赖 0；与 1 写域不重叠，可换序）
            └──► 步骤 4a （4a 只依赖 0；纯 git 调用，改 update-task.ts 一处）

步骤 4a ──► 步骤 4c        （4c 读的是 4a 之后才存在的"可枚举清单"）
步骤 4b ──► 步骤 4c        （4c 的"这棵子树完成了吗"要 parentTaskId）

★ 步骤 3（能力匹配）【不在 MVP 里】—— 它的收益前提在真实语料上不成立（见 §3 步骤 3）
★ 步骤 5（不实现）原本写"依赖 3"，现在 3 被推迟 ⇒ 5 也随之推迟到"将来和 3 一起做"
  理由不变：`tools.restrict()` 的 deny 按 agent 一生生效（src/capabilities.ts:60-96 的
  Exposure 按 Agent 缓存），唯一能落地的形态是【给 review 单独派人】，而那正是 3 的 rank
★ 步骤 6（读数常规化）不依赖任何一步，但它要给 1/2/4a 的结果加格子 ⇒ 排在最后
```

★ **真实可并行的三对**（写域互不重叠，可同时派两个人）：
`1（src/scheduler.ts + src/quality-gates.ts）` · `2（src/tools.ts + src/tools/approve.ts）` ·
`4a（src/tools/update-task.ts）`。
★ **必须串行的只有两处**：`4a → 4c` 与 `4b → 4c`。
★ 建议仍按 §3 的数字顺序，理由只有一个：4a 的收益读数**当场可证**，
先做它能让后面每一步都在"知道有个办法能证明收益"的前提下进行。

### 4.1 MVP 的真实范围（★ 从 7 步收成 4 步）

```
在做：  步骤 0 · 步骤 1 · 步骤 2 · 步骤 4（4a/4b/4c）
推迟：  步骤 3（无收益读数支撑）、步骤 5（依赖 3）
保留：  步骤 6（读数常规化，它本身就是"证明收益"的地基）
```

★★ **为什么敢砍掉两条**：用户的原话是"以我们当前的状态为极限"。
把两条**没有可复跑收益读数**的机制塞进 MVP，只会让整份计划的"证明收益"这条门槛失真 ——
而那条门槛正是这份计划存在的理由。

---

## 5. 每一步的"完成"定义（统一模板，不许跳格）

```
□ 改前读数：本步 §3 表格里的"改前"列，逐条贴命令与输出
□ 改后读数：同一组命令，逐条贴输出
□ 失败文件集合：node scripts/mvp-failing-files.mjs --diff docs/_MVP-BASELINE-FILES.txt
                ⇒ "新增 0"（★ 用工具，不许手写这个列表 —— 手写会漏项，见下）
□ 反向半边：把本步的核心改动拿掉/换成恒等，至少一条臂必须红（REQUIREMENTS §9）
□ 三态：新增的每个读数都必须区分 ok / 未测到 / 不适用，且三者不同形
□ 可复跑：读数的命令写进 docs，任何人 clone 后能跑出同一个数
□ 没有新依赖：pnpm-lock.yaml 零改动
```

★ **`pnpm test:gates` 的计数一定会抖**（`_measured_caveat` 逐字：同一提交零碰撞也得到过
30/31/39 条，因为 `lib/` 被并发 build 改写成不同中间态）⇒ **一律用失败文件集合，不用计数**。

★ **而"失败文件集合"也是工具算的，不是手抄的** —— 这正是 `scripts/mvp-failing-files.mjs` 的用途：

```
node scripts/mvp-failing-files.mjs --save docs/_MVP-BASELINE-FILES.txt   # 采基线（步骤 0）
node scripts/mvp-failing-files.mjs --diff docs/_MVP-BASELINE-FILES.txt   # 每步之后比对
  ⇒ 期望输出 "新增 0"；"修好 N" 越多越好
  ⇒ 退出码 0 = 跑到了（★ 不代表绿）；2 = 没跑成 ⇒ 必须当成"未测到"，绝不当成"无新增"
```

★★ **它自己也守三态**：输出里找不到 `ℹ tests` 汇总行 ⇒ `ran: false`（未测到），
而**不是** `files: []`（测了零失败）。★ 这个区分不是洁癖 —— 一个空集合会被读成"全绿"，
而实际的病因可能只是"测试进程根本没起来"（REQUIREMENTS §4 的第九次事故形态）。
★ 另外它还防一个具体的读数坑：`✖` 行会被 `node --test` 打印**两次**（进度 + 汇总），
所以 `grep -c '^✖'` 得到 45 而真实失败是 22 —— 它按**栈里的文件路径**归集，不数 `✖`。

---

## 6. 风险与"就地停止"条件

| 风险 | 触发读数 | 动作 |
| --- | --- | --- |
| 步骤 0 修断言时把强度放低 | 修订后的断言在**故意破坏**下不再变红 | 该条不许进 0a，先按原样保留为红并记账 |
| 步骤 1 是把 MAPLE v2 重做一遍 | 23 个真实团队渲染后，残差段内容与 `team.description` 逐字相同 | 说明内核没算东西 ⇒ 停下，重设计 |
| 步骤 2 接线后成团被恒拒 | 任一次 staged→running 被 admission 拒 | 立刻回滚 2b，改成 `tolerate` 并记账 |
| 步骤 3 rank 改变了历史判断 | 一致率 < 95% | 就地停止，读数进 `DECISIONS-PENDING.md` |
| 步骤 4a 的 ref 污染主仓 refs | `git for-each-ref refs/agent-teams \| wc -l` 超过任务数 | 说明命名冲突，改前缀 |
| 任意一步 | 失败文件集合**新增**任何一项 | 不许合并；修回或按 `_adding` 的规矩记账（“宁可去修，也不要加”） |

---

## 7. 交给人拍板的（7 件，逐条都带我的建议）

★ 前 3 件是原计划里的，后 4 件是本轮核数时新冒出来的（已同步进 `docs/DECISIONS-PENDING.md §3b`）。

```
1. 步骤 0b：scripts/lifecycle-verify.mjs 撞上的 dispatch.plan-reviewed 是真判据开火
   (甲) 给夹具补 reviewed 戳（★ 建议） —— (乙) 挪 PLAN_REVIEWED_GATE_ONLINE_AT
   会让判据对一批新任务不适用，等于关掉它
2. 步骤 2a：convene 的"无待确认问题"改读 planReviewState + 未读收件箱（★ 建议），
   还是新造 open-questions.json（MAPLE 的形状）—— 前者不新增文件、两样都是已有事实
3. 步骤 4a 的 ref 命名：refs/agent-teams/<teamId>/<taskId>（★ 建议，与分支命名空间隔离）
   还是 refs/heads/…（会出现在 git branch 里，更容易被看见也更可能被误删）
4. 步骤 3（能力匹配 rank）留不留：★ 建议推迟（425 条里只有 5 条走过共享池）
5. 步骤 5（tools 白名单收紧）留不留：★ 建议与 3 一起推迟（真实越界只有 1.2%）
6. 步骤 0c 的顺序：★ 建议先修 ENOTEMPTY 再修 plan-reviewed
   （不先修它，真实报错永远打不出来 —— 这是本轮实测的教训）
7. admission 接上之后，src/tools/status.ts:98 / src/snapshot.ts:714 /
   src/client/activity-model.ts:1459 三处"admission 是空段"的说法必须同批改掉
   （否则接线会制造三处事实错误）
```

---

## 8. 本计划**没**解决的事（诚实的边界）

```
· worktree 的去留仍未裁（DECISIONS-PENDING.md §1 的 D1）—— 步骤 0 只采数据，不决策
· failed 任务的"为什么失败"仍是散文（86 条里 77 条有非空 output，9 条完全为空 —— ★ 而字段名叫 `output`（src/types.ts:621，注释逐字「The worker's written result」，所以说"result 字段"是一种把注释当字段名的读法））
· acceptance 与 acceptanceResults 的对齐没有判据（391 条有 acceptance，79 条 acceptanceResults 为空，
  55 条部分覆盖 / 257 条全覆盖 —— ★ 但"覆盖"是模糊文本匹配的读数，不足以支撑判据，故不进 MVP）
· 4c 只能"点名无人接"，不能"自动并回"—— 后者需要人决定冲突时谁赢
· 步骤 3/5 被推迟，所以"能力匹配"与"结构上不许写"这两件事【本计划不做】——
  它们各自缺的是一条可复跑的收益读数，而不是实现方案（方案都已核清，见 §3）
```

---

## 附：本篇所有读数的复跑入口

```
pnpm typecheck / pnpm build                       构建与类型（今晚实测都 exit=0）
node scripts/mvp-measure.mjs                      ★ 本篇全部语料/git 读数（人读表格，约 10s）
node scripts/mvp-measure.mjs --json               ★ 同上，JSON 形状 ⇒ 改前/改后直接 diff
node scripts/mvp-failing-files.mjs                ★ 失败【文件集合】（不是计数；见 §5 的理由）
node scripts/mvp-failing-files.mjs --diff docs/_MVP-BASELINE-FILES.txt   ★ 每步之后的净变化
node scripts/verify.mjs                            8 FAIL / 180 PASS
node scripts/lifecycle-verify.mjs                 今天：39 PASS 后抛（129 处 check 里后 90 处从未跑到）
node scripts/quality-gates-tdd.mjs                今天：64 PASS 后抛（同一个 plan-reviewed 拒绝）
pnpm verify:fast / pnpm verify:quality-gates       快环与质量闸的独立读数
git fsck --unreachable | grep -c '^unreachable'    624
```

★★ **两个"今天跑不能全跑完"的脚本必须点名**，否则下一个人会把"39 PASS 后抛"读成 "39 PASS 通过"：
`lifecycle-verify` 与 `quality-gates-tdd` 都是**在抛错前停住**，后面那 90 处检查从未执行。
这正是步骤 0 存在的理由 —— 在它们能跑到底之前，任何"夹具是绿的"的说法都不成立。

★ `scripts/mvp-measure.mjs` 与 `scripts/mvp-failing-files.mjs` 都**已经落在仓库里**
（本计划同一批改动），**不是** `/tmp` 里的一次性脚本。两份都只报数、不裁决
（输出里没有 `ok` / `verdict` / `pass` / `fail`），三态不并
（`null` 没能测 ≠ `0` 测了是零 ≠ `[]` 测了没有条目）。
`mvp-measure` 全量约 **10 秒**（含 92 次 git 查询）；`mvp-failing-files` 约 **30 秒**（它真的跑一遍夹具）。

---

## 附二：本次勘查中**被推翻**的三条说法（写在这里，免得后人重犯）

| 曾经的说法 | 实测 | 为什么错 |
| --- | --- | --- |
| "failed 任务的 `result` 是空串 ⇒ 为什么失败读不出来" | 字段名是 **`output`**（`src/types.ts:621`），全仓 425 条里**没有任何一条叫 `result`**；86 条 failed 里 **77 条有非空 `output`** | 把注释里的一个英文词当成了字段名 ⇒ 读了个不存在的键，于是"读到空" |
| "80 个孤儿提交 = 80 份丢失的工作" | 7 份内容与 HEAD 逐字节相同；真正**只在孤儿提交里**的只有 **3 个 (sha, path) 对 / 2 个路径** | 对象身份 ≠ 内容；本仓合流是"按文件落盘"不是 merge |
| "`pnpm test:gates` 有 45 条失败" | 真实 **22 条**（`ℹ fail`）；45 是 `✖` 行被打印两次 | `node --test` 的进度行与汇总行都带 `✖` |
