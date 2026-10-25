# completion 链加固（MEASURED 2026-10-12）

## 由来

用户看 DeepSeek Harness 轨迹时发现：**只要遇上调用 `completed` 就会卡住**。
随后给出两条指令：① 先跑对照实验把数字钉死；② 优化插件的整条链路。

**这份文档的存在理由**：这一轮里我对同一个现象给出过**三版互相矛盾的机制解释**，
前两版都被后续取证推翻。只写在对话里，下一个人接这件事会重猜一遍 ——
而这一轮反复证明「留下读数」比「重新猜」便宜得多。所以被推翻的版本也留档。

---

## 0. 结论先行

| | |
|---|---|
| **症状** | `agent_teams_update_task(… → completed)` 是全仓**唯一会永不返回**的工具调用 |
| **真主因** | completion 链**串行**跑多个重活，其中 `completion.mutation` 时长 = O(改动行数 × 套件耗时)，缺省配额下上界约 **2.2 h/attempt** |
| **放大项** | 失败任务每次重试**重跑整条链**；`verify` 至少跑 2 遍（verify-rerun + backtest full） |
| **处置** | 9 项加固全部落地（见 §4），**未提交** |
| **验证** | 改动前后全仓门禁失败集合**逐条相同**（19 条存量红，零新增零修复）；两份新夹具 26/26 绿 |
| **遗留** | 两项待决策（§10）；一处**曾被我误判**的残留已定案为沙箱产物（§9） |

---

## 1. 症状与读数

### 1.1 工具耗时分布（145 个会话 / 30,651 条工具结果聚合）

| 工具 | n | p50 | p90 | max |
|---|---|---|---|---|
| read / edit / write | 1268 / 1432 / 239 | 9 / 15 / 18 ms | ~20 / 27 / 37 ms | < 1 s |
| **agent_teams_update_task** | **914** | **11.3 s** | **84.5 s** | **8,239.8 s** |

### 1.2 拆开看：`completed` 与非 `completed` 的差别

| 子集 | n | p50 | max | >10 min | orphan |
|---|---|---|---|---|---|
| 非 completed | 653 | 3.4 s | 672 s | 1 | — |
| **completed** | **391** | **13.1 s** | **3,215.6 s** | **8** | **5** |

> ★ 诚实口径：**非 completed 也有长尾**，所以「只要 completed 就卡」不全对。
> 两者的真实区别是：**只有 completed 会永不返回**（3 个 in-flight 调用全是 completed）。

### 1.3 最硬的一条判据：**落盘 ≠ 返回**

`team.json` 里 t34 仍是 `in_progress` / `attempt 5` / `updatedAt 02:42:07`
⇒ **那次 `update_task(completed)` 从未保存**。

这比「有没有 tool/result」硬 —— 它证明的是「**没生效**」而不是「没返回」。

> ⚠️ `deliverableCommit` 有值**不能**当作「这次提交成功了」：它可能是更早 attempt 留下的，
> 而 `status` 与它都只改内存副本。

---

## 2. 三次取证与被推翻的假设（诚实账）

| # | 当时的假设 | 用什么判据推翻 | 结论 |
|---|---|---|---|
| 1 | 「自指循环」：completion 重跑 verify ⇒ 落在插件**自己仓库**里跑 build ⇒ 重写 `lib/` ⇒ 触发 HMR ⇒ 拆掉在飞的调用 | 时序反了：**冻结在 02:42:17，首次 reload 在 02:42:51**，冻结早 34 秒 | ❌ 推翻 |
| 2 | HMR 周期性 reload 的间隔 ≈ build 耗时（37 s） | 实测 `pnpm build` = **3 s**；HMR 是 36 s 周期、跨 3 个 pid、共 40 分钟 | ❌ 推翻 |
| 3 | mutation「无上限」 | `maxPerOperator = 25` 其实**生效**；只有 `maxMutants` 未接线 | ⚠️ 修正 |
| 4 | 「尾部停在 tool/call」= 调用被拆了 | 长调用期间**本来就不写 session** ⇒ 该现象只说明"还没结束" | ❌ 推翻（读法错误） |
| 5 | 残留临时文件 = 测试进程被杀 | `readdir` 监视器看到**零 DELETE 事件**，而 `finally` 之后的日志**照常打印** | ❌ 推翻（真因见 §9） |

**★ 由此得到的读法纪律**：想区分「在跑」与「死了」，必须找一个**与它无关的外部时钟**
（HMR 痕迹 / 子进程 / 文件 mtime）看它是否还在走 —— 光看 session 尾部事件是分不出来的。

### 2.1 宿主死因（排除法）

| 候选 | 否证证据 | 结论 |
|---|---|---|
| native crash | `~/Library/Logs/DeepSeek Harness/crash-*.log` 最新停在两天前 | 排除 |
| OOM | `sysctl vm.swapusage` = 0 | 排除 |
| 看门狗 | `dsh-restart-cycle.log` 停在前一天 | 排除 |
| 人工关闭 | 无 Harness 进程、端口无监听 | **最可能** |

> ⚠️ 宿主端口是 **19387**（不是 3080）；查端口前先读 `restart-cycle.log` 的实际值。

---

## 3. 真机制

### 3.1 completion 链的四个阶段

| 阶段 | 做什么 | 单条约束 | 次数 |
|---|---|---|---|
| `completion.verify-rerun` | 跑一遍 `task.verify` | 120 s | 1 |
| `completion.backtest`（full） | **再跑一遍**（`backtest.ts:738` 无条件，`runCommand` 无缓存） | 120 s | 1 |
| `completion.r5` | 每条新测试 ×（working-tree + 父版本 worktree add/test/remove） | 120 s | — |
| **`completion.mutation`** | **每个变异体 × 1 次全套测试** | ★ **无总上限** | 配额 |

- **`VERIFY_COMMAND_TIMEOUT_MS = 120_000` 只是"单条命令"的上限**，整条链**无总预算**，
  长尾可达 53 分钟。⇒ **「有超时」≠「不会挂」。**

### 3.2 关键代码事实：声明了没接线

```
maxMutants 只出现在类型声明（mutation.ts:181），全文件无使用点
⇒ 声明了没接线 ⇒ 实际无上限
⇒ 时长 = O(改动行数 × 套件耗时)
```

### 3.3 实测定案（在 t34 的 worktree 里逐个跑）

| 命令 | exit | 耗时 |
|---|---|---|
| `pnpm build` | 0 | **3 s** |
| `node --test scripts/worktree-reclaim.test.mjs` | 0 | **24.6 s** |
| `node --test scripts/workspace-activity.test.mjs` | 0 | 0.1 s |
| 主仓库 `pnpm build`（**改之前**） | 2 | 2 s 失败 |

- verify 一次 = **27.6 s**；backtest 再跑一遍 ⇒ **≥ 55 s**
- mutation 上界 = `DEFAULT_OPERATORS`(13) × `maxPerOperator`(25) = **325** 变异体 × 24.6 s ≈ **2.2 h/attempt**
- 53 分钟长尾 ≈ **129 个变异体**，落在上界内（吻合）

### 3.4 失败放大

t34 已 attempt 5 —— **每次都重跑整条链**。
仓里 `scripts/gate-completion-deadlock.test.mjs` 记录的正是这一形态：
「判据恒拒 ⇒ 交不出终态」（**空数组比没有数组更坏**）。

### 3.5 ★ 进程泄漏：mutation 就地写 workspace 源码，未还原

`src/worktree.ts:366` 落在盘上的一处未提交畸形：

```diff
-  failed: Array<{ entry: string; reason: string }>
+  failed: Array<{ entry: string; reason: string }>=
```

四条判据钉死它是 mutation 的 `gt-to-ge` 算子（`'>'` → `'>='`）：

1. **算子形态精确匹配** —— `Array<…}` 的 `>` 换成 `>=` 正好产出 `}>=`
2. **行号在改动行范围内** —— `git diff --unified=0 <base> -- src/worktree.ts` 只有一个 hunk：`@@ -366 +366 @@`
3. **写入机制存在** —— `writeFile(plan.file, mutatedText)`
4. **还原只在 `finally`** —— SIGKILL / 关宿主就给不了机会

mtime `02:47:21` = 最后一条 HMR 同秒 ⇒ 那一刻宿主被关，还原没跑。

**根因**：`workspace` 来自 `workspaceOf(caller)`；**t34 的 `assignee = "captain"`，而 captain 的
workspace = 插件根** ⇒ captain 自己领的任务，其 completion 判据会**就地变异插件自己的源码**。

**附带**：`spawn('/bin/sh', …)` + `child.kill('SIGKILL')` **只杀 sh 不杀进程组** ——
实测 4 个孤儿 node 进程（cwd = 插件仓库、ppid = 1、存活 5.7–6.5 h）跨两次宿主重启未被清理。

---

## 4. 九项修改

改动规模：`src/` + `scripts/` 共 **9 个文件改动、1112 增、38 删**，另加 3 个新文件。

| # | 动作 | 落点 |
|---|---|---|
| 1 | 删掉毁掉编译的 `=` | `src/worktree.ts:366`（改完 build 恢复 2–3 s exit 0） |
| 2 | 接线 `maxMutants` + 收窄配额（25→4、200→40）+ **等距抽样** `capMutants` | `src/mutation.ts`、`gates/completion/mutation.ts` |
| 3 | 截断读数进裁决（`batch{}` + `scope`） | 同上 |
| 4 | **样本下限** `MIN_SCORED_FOR_VERDICT = 20`（只对**被截断**的跑批生效） | `src/mutation.ts` |
| 5 | **变异日志 + 恢复**（写前记账、冲突不回溯、启动扫根 + worktrees） | `tools/shared/entities.ts`、`src/index.ts` |
| 6 | **整链 wall-clock 总预算** + 单命令超时**只收窄** | `createCompletionBudget` / `runWithinBudget` |
| 7 | 预算停止的记号 + 两处「认出 ⇒ unmeasured」 | **新** `src/gates/budget-stop.ts`、`gates/registry.ts` |
| 8 | **进程组 kill**（`detached:true` + `process.kill(-pid)`） | `tools/shared/entities.ts` |
| 9 | 两句**假归因**改成按真实成因分 | `src/mutation.ts` |

### 逐项 rationale

**#2 等距抽样而不是取前 N**
`all.slice(0, maxMutants)` 会把配额永远花在**文件开头**，于是"没被抽到"与"没算子"不可分。
改成等距（even-stride）后，抽样覆盖全范围，读数才有代表性。

**#4 为什么下限只对"被截断"的跑批生效**
未被截断的跑批样本量本来就由算子数决定，此时套下限会**把合规的小范围任务误判为 unmeasured**。
下限要防的是「配额把样本砍到靠运气就能过」，不是「任务本来就小」。

**#6 预算与单命令超时的关系是「只收窄」**
总预算不会放宽单命令上限，只会让它更早触发：`min(VERIFY_COMMAND_TIMEOUT_MS, remaining)`。
缺省 **20 min**，可用 `AGENT_TEAMS_COMPLETION_BUDGET_MS` 覆盖（**刻意没有"无限"档**）。

**#9 假归因**
- `scored === 0` 的分支原先**无条件**说「全部落在注释/字符串/无算子区域」——
  而真实成因可能是"全 errored"。⇒ 改成按真实成因分叉。
- `scoreMutants` 原先只报 mutant id，不报**原因** ⇒ 下游只能猜。⇒ 补上去重后的未测量原因。

---

## 5. ★ 加固本身开出的两个新洞（都是我自己引入的）

**洞 A（假通过）**：`scoreMutants` 里 `errored` **不进分母**。
⇒ 预算在中途跑光时，剩下每条变异体立刻抛、全记 `error` ⇒ **分母塌缩** ⇒ 前几条若都被杀则
`mutationScore = 1.0 > 阈值` ⇒ **报 ok**。
**「那条链没跑完」被读成「这个成员的测试很强」。**

**洞 B（穿出三态）**：`registry.evaluate` 的 `await reg.gate(context)` 是**裸调用**（无 try/catch）。
⇒ 预算抛出**穿出整条 completion**，绕过 `blocked` / `unmeasured`，成员收到**异常**而不是裁决。

**一并修法**：让判据框架**认出这一类** ⇒ `unmeasured`；**其余抛出照旧穿出去**（配反向臂钉住）。

---

## 6. ★★★ 分层逼出来的设计：记号只能住叶子模块

```
gates → tools   是禁向
   （gates/runtime/stall.ts 明写「gates 层今天不 import 任何 tools/」）
```

而**认出记号的** `registry.ts` / `completion/mutation.ts` 都在 **gates 层**，
**抛出它的** `runWithinBudget` 在 **tools 层** ⇒ 记号放谁家都违规。

⇒ 记号放进**零依赖叶子模块** `src/gates/budget-stop.ts`，两层都顺向引用。

> ★ 判定用 **`name` 字段**（跨模块实例稳定）而不只是 `instanceof` ——
> 宿主插件重载会**重新求值模块**，那时 `instanceof` 跨实例为假。

**连带改了一条护栏白名单**：`scripts/verify-gates-integration.test.mjs` 的判据 import 白名单
（原来只放行 `../registry.ts` / `../requires.ts` / `../../mutation.ts` / `./kind-requirements.ts`），
新增 `../budget-stop.ts` 一行并写明「这是 `kind-requirements` 先例的又一实例，判据互调仍被禁」。
★ 这是本轮**唯一**动到护栏本身的改动。

---

## 7. ★★★ 配额引入的更深问题：**门禁不可复现**

| 配额缺省 | considered | survived | score | 阈值 0.6 |
|---|---|---|---|---|
| 25 / 200（改动前） | 26 | 2 | **0.923** | 过 |
| 4 / 40（下调后） | 18 | **同两条** | **0.889** | 不过 |

⇒ 一次**与判据无关的缺省调整**让结论翻面。

更贵的一层：**n = 6 的样本靠运气就能放行**（18/30 = 0.600 过 vs 18/135 = 0.133 不过）。

⇒ 对策就是 #4「样本下限」+ #3「截断读数进裁决」。
> ★ **未解**：分数仍与样本量耦合 —— 区间估计是另一个决定，本轮没做。

### 7.1 我改回头的一处：既有夹具被我的缺省改动打红

`scripts/gate-mutation.test.mjs` 臂 1 断言「严格套件应杀 > 0.9」，改动后实测 0.889 ⇒ 红。

**根因不是套件变弱，是夹具没钉住「配额」这个与断言无关的输入。**

⇒ 处置：在夹具的 `context()` 里把配额钉在**不触发**的位置（1000/1000），并写明为什么。

> ★ 纪律：夹具的输入里凡是**不由该条断言规定**的，都要显式钉住。
> 否则缺省一动它就红，而最省事的"修法"是把断言改松 —— **那才是真正的损失。**

---

## 8. 验证口径（必须带基线）

```
改动前（src/ 已 stash、新夹具移开、重新 build）：1415 tests / 1360 pass / 19 fail
改动后：                                          1441 tests / 1386 pass / 19 fail
```

**逐条集合比对：零新增、零修复，失败集合完全相同。**
（+26 条 = 新增的两份夹具，全绿。）

新夹具：

| 文件 | 臂数 | 钉住什么 |
|---|---|---|
| `scripts/gate-mutation-cap.test.mjs` | 9 | 等距抽样、边界（≤0 / 非有限 ⇒ 原样返回）、接线（真的读 ctx 上的配额）、截断文本进 scope、`totals.considered === ran`、**翻面臂**（同实现不同配额 ⇒ ok 翻 blocked）、下限臂（截断到下限之下 ⇒ unmeasured）、注册面 |
| `scripts/gate-completion-hardening.test.mjs` | 17 | 预算到期 / 只收窄 / 自述成因；记号**跨实例**按 `name` 认；registry 里「预算停止 ⇒ unmeasured」vs「普通抛出 ⇒ 原样穿出」；**洞 A**（预算停止不许被读成"变异体出错"）；日志恢复（还原 / 干净 / 冲突 / 新文件 / 空）；进程组 kill（超时后孙进程也死）；`unmeasured()` 形状不变 |

### 8.1 存量 19 条红的构成（与本轮改动无关）

只有 17 条在 `scripts/fixtures/baseline-known-failures.json` 里 ——
该清单 `_verified_at` 指向**另一个 commit**（`ba32130`），有 2 条属**标题漂移**
（清单里的标题与实际不再逐字相同，如 `gate-repair-completion` arm 9 的
`★ FLIPPED (t33): …` 长尾巴）。

⇒ 这也是 `gate-baseline-known-failures.test.mjs` 臂 6 报红的原因，**与本次改动无关**。

**这一轮踩过的坑**：中途一次 `verify:gates` 从 19 红涨到 20 红，多出来的那条是
`verify-gates-integration.test.mjs` 的 import 纪律臂（我新增的 `budget-stop.ts` 不在白名单里）。
⇒ 说明**"先取基线再逐条集合比对"这个口径本身就是有用的**，它把"1 条新增"从 19 条噪音里挑了出来。

---

## 9. 残留文件定案：沙箱「能建不能删」（**推翻了我的上一版结论**）

### 症状

`scripts/` 里反复出现 `.mutant-task-atomicity-<pid>-<ts>.mjs`（每个 **62,127 B**，
内容 = 夹具写进去的完整变异源码），来自 `scripts/verify-task-atomicity.test.mjs:795` 的临时文件。
该夹具**有** `finally { try { unlinkSync } catch {} }`。

### 判据链

| 观测 | 读数 |
|---|---|
| 夹具**单独**跑 | 10 pass，残留 **0** |
| 18 文件同跑（并发） | 残留 **1** |
| 18 文件同跑（`--test-concurrency=1` 串行） | 残留 **1** |
| 18 文件**去掉** `review-unified-pipeline.test.mjs` | 残留 **1** |
| 夹具 + `review-unified-pipeline.test.mjs`（2 文件） | 残留 **1** |

⇒ **与并发无关、与某个兄弟夹具无关**。只要不是"单独跑"就必漏 1 个。

### ★ 决定性仪器：`readdir` 轮询监视器（10 ms 粒度）

```
+0.64s CREATE  .mutant-task-atomicity-63133-1791769304659.mjs
（此后 90 s 内【零 DELETE 事件】，文件一直在）
```

而同一轮日志里，夹具**过了 `finally` 之后**的三行诊断**照常打印**。

⇒ 两者合起来只剩一个可能：**`unlinkSync` 被调用了但没删掉，异常被 `catch {}` 吞了。**
（若是"进程被杀"，那三行打印不出来；若是"删了又被重建"，监视器会看到第二个 CREATE。）

### 真因：沙箱「能建不能删」

- 单独跑的那次命令带 `⚠️ Sandbox bypassed (escalation-approved)` ⇒ `unlink` 成功 ⇒ 残留 0。
- 多文件套件那几次**没有**这行 ⇒ 在沙箱里跑 ⇒ `writeFileSync` **成功**（监视器看得到 CREATE）、
  `unlinkSync` **被拒**（所以零 DELETE）。
- 复核：那几个残留我是用 **shell `rm -f`** 一次清掉的。
  ⇒ **同一路径、同一进程树：shell `rm` 可行、node `unlinkSync` 被拦。**

> ⇒ **结论：残留是「测试项目不在 workspace 内 + 沙箱拦 unlink + 夹具 `catch {}` 静默」
> 三者叠加的环境性产物。不是本仓缺陷，也不是本轮加固引入的。**

---

## 10. 未实施 / 待决策

1. **本轮的 9 项改动尚未 `git commit`** —— 按纪律等用户确认。
   工作树同时有**非本轮的改动**（`docs/HANDOVER.md`、`docs/MODULE-RELOAD.md`、
   `docs/frictions.html`、`docs/judgements.html`、`.archify/`、若干 `docs/*.html`），提交时需分开处理。
2. **夹具 `catch {}` 要不要改**（一行，属改他人夹具）：
   ```js
   catch (error) { if (error?.code !== 'ENOENT') console.error(error) }
   ```
   理由：那个 `catch {}` 把**唯一的失败信号**吞了 —— 这正是 §9 看起来"神秘"的原因。
   它现在不影响任何判据（残留是隐藏文件、`git status` 可见），所以没有擅动。

### 三次取证时列过、本轮未做的修法

| 修法 | 状态 |
|---|---|
| mutation 接线 `maxMutants` | ✅ #2 |
| 链内复用 verify 结果（backtest 不再重跑） | ❌ 未做 |
| wall-clock 总预算 | ✅ #6 |
| 进程组 kill | ✅ #8 |
| **verify 别落在插件自身仓库** | ❌ 未做（根因仍在：captain 任务的 workspace = 插件根） |
| 长期：completion 交后台 job | ❌ 未做（架构级） |

---

## 11. 可迁移的纪律

1. **「有超时」≠「不会挂」** —— 单条命令的上限不构成整条链的上界；要总预算。
2. **加固本身会开新洞** —— 加总预算当场开出"分母塌缩假通过"与"异常穿出三态"两个洞，
   且**后果相反**。凡改判据框架，必须配**反向臂**（普通抛出仍须原样穿出）。
3. **记号该住哪一层由依赖方向决定** —— 跨层共享的记号只能住**零依赖叶子模块**；
   识别用 `name` 而非 `instanceof`（模块可能被重新求值）。
4. **配额会让门禁不可复现** —— 与判据无关的缺省调整能翻结论；样本量要下限 + 截断读数要进裁决。
5. **夹具要钉住无关输入** —— 否则缺省一动就红，而最省事的"修法"是把断言改松。
6. **被推翻的假设要留档** —— 本轮我自己被推翻 4 次；只写最终结论，下一个人会重踩。
7. **测试目录里神秘累积的隐藏文件，先怀疑沙箱** —— 见 §9 的 `readdir` 监视器手法。
