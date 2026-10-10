# 新机制验证计划（N1）

> **目标**：在一套【从零创建的会话】上跑今晚修好的机制，检验用户那个命题：
> **「旧会话 + 新机制会打架；那新会话 + 新机制，还会不会一直有 ready 任务而没人派？」**

---

## 0. 为什么开新会话（用户的判断，而有数字支持）

```
★ 现有四个成员会话创建于: 2026-10-08 13:56
★ 而从那时到现在:         50 条提交
★ 其中【直接改成员/会话与派发行为】的:
    · 恢复 t50 的重载扣发闸门（它曾被整文件覆盖删掉）
    · t43: 投递失败留痕（deliveryFailure）
    · t43: worktree 拒绝留痕（★ "静默不派"的真出口）
    · t24: 依赖按需注入接线
    · t20: 非 implementation/repair 的 kind 不建树
⇒ ★★ 那四个会话【是在这些之前创建的】—— 它们从没运行过这套机制。
```

**★★ 而今晚实测里，5+ 次停摆中有【两个】是会话层的，不是机制层的**：
```
① ★ 残留 `working`: team.json 说三个成员在跑，而他们的会话【都不在了】
   （探针 ⇒ "active teammate not found"）
② ★ 而他们树里的改动【冻着】—— t39 那 300 行靠 salvage 才救回
```

---

## 1. 要验证的命题（而它必须是**可判真假的**）

```
★ 命题: 在一套【从零创建】的团队上，跑今晚修好的机制 ——
        还会不会出现【有 ready 任务而没有成员在推进】？

★ 判据（可机械执行，不需要人读日志）:
    node scripts/team-stall-check.mjs <新队 id>
      ⇒ ★ 七个信号全 0，而 ready > 0，且【有成员在 working】
      ⇒ 而那一条命令就是本计划的验收工具
```

**★★ 而"卡"的定义要写死**（否则它会变成一个感觉）：
```
★ 停摆 = ①成员被占着 / ②卡 failed 依赖 / ③悬挂交接 / ④部署陈旧
        / ⑤团队心跳静默 / ⑥写域冲突而缺边 / ⑦worktree 台账僵尸
        ★ 任一 > 0，而【没有任何成员在 working】
⇒ ★ 而那七个信号今晚各被实测过一次以上（各自的成因见 DISPATCH-RULES §16/§39）
```

---

## 2. 新会话要验证的**四件机制**（每一件今晚都修过，而旧成员没见过）

| # | 机制 | 今晚的修法 | 而它【可观测】的形式 |
|---|---|---|---|
| ① | **成员能派 subagent** | `memberMaxDepth: 1`（宿主配置） | 一个成员指派一个临时 worker 并拿到它的结果 |
| ② | **静默不派的两个出口留痕** | `deliveryFailure`（投递失败 + worktree 拒绝） | 派发失败时 `task.deliveryFailure` 在场且带 `reason` |
| ③ | **存量红不挡住完工** | t19 的基线判据（三态 + 集合比对） | 一个 verify 含 `test:gates` 的任务能落 `completed` |
| ④ | **worktree 台账不积僵尸** | `git worktree prune` + 信号⑦ | 连续派发 N 条而不撞 `already registered worktree` |

**★★ 而①是本计划里唯一的【新能力】**（其余三条是"旧成员运行时一直撞的那些门"）。

---

## 3. 团队形状（★ 而这里用用户已定的设计）

```
★ Worker  = 临时 sub agent，干净上下文，在【那棵 worktree】上
★ Reviewer = 也是临时的，在【同一棵 worktree】上，干净上下文
★ Integrator = 合并多棵 worktree
```

**★★ 而队长是持久的（captain），成员是持久的 dispatch 点 —— 而每一条任务用临时 worker 执行。**
**⇒ 而这条形状今晚只落了一半（`t37` 那条 integrator 还没做）—— 所以它是本计划的一部分。**

**★ 而成员的角色（四个，每个只做一件事）**：
```
n-lead      派工 + 收口 + 裁决（★ 而它【不写代码】）
n-worker-1  实现（★ 而它会长出临时 sub agent）
n-worker-2  实现（同）
n-verify    独立验证 + 独立审查（★ 而它【不实现】）
```

---

## 4. 阶段一：**先证明检测器在新会话上会说话**（★ 而这一阶段不出产品）

| id | 任务 | 验收（可机械读出） |
|---|---|---|
| `n1` | 在新队上跑 `team-stall-check.mjs`，并**故意造一个卡** | 造卡前后，那七个信号**至少一个翻转**（★ 否则检测器在新会话上是哑的） |
| `n2` | 核 `memberMaxDepth: 1` 真的让成员能派 subagent | 一个成员**真的**派了一次 sub agent，并交出它的结果 |

**★★ 而 `n1` 是本计划最重要的一条**：
> **若检测器在新会话上不说话 ⇒ 那么"新机制下会不会卡"这个命题【测不了】——
>  而那本身是第一个要报的读数。**

---

## 5. 阶段二：**四条机制各跑一次真实交付**（★ 而这里是产品）

| id | 任务 | 验收 |
|---|---|---|
| `n3` | 走通一条**完整**的质量链（requirements → implementation → verification → review → integration） | 五环各一条任务，且 `integration` 真的合并了 ≥2 棵 worktree |
| `n4` | 让一条 verify 含 `test:gates` 的任务【落 completed】 | `commandsRun` 里 `test:gates = failed`，而任务 `completed`（★ 存量红不挡） |
| `n5` | 连续派发 ≥6 条任务（超过并发上限的一半） | ⑨ 七信号全 0 而成员反复 `working`；★ 而无一条撞 worktree 台账 |

**★ 而 `n3` 就是 `t37`（integrator 那一环）—— 今晚它只被立项，没被做。**

---

## 6. 阶段三：**对抗性检验**（★ 而这一阶段故意造坏）

| # | 造什么坏 | 期望 |
|---|---|---|
| `n6` | 一条任务**故意**在实现中途让 worker 会话结束 | ★ 检测器报出来（而不是显示 `working` 而其实没人） |
| `n7` | 一条任务的 verify 里塞一个**真的新失败** | ★ 它**必须**落 `failed`（那一半不许放宽） |
| `n8` | 把 `git worktree` 台账人为搞出一条僵尸 | ★ 信号⑦ 报出来，而 prune 后恢复 |

**★★ 而 `n6` 直接对应用户的观察**：今晚那种"显示 working 而没人"的状态，
**★ 在新机制下必须【可检测】** —— 否则它是本计划唯一没被覆盖的一格。

---

## 7. 收口条件（★ 而它是"可以宣布完成"的判据）

```
✓ 阶段一 ~ 三全部终态
✓ 而【七信号在三个阶段里各被观察到一次】（★ 包括"不该说话时不说"的反向半边）
✓ 而最后一条: ★ 在新会话里，从零到收口【没有出现过一次"有 ready 而没人派"】
   ⇒ ★ 而那一条由 `team-stall-check.mjs` 的历史读数给出（而它现在是可复跑的命令）
```

**★★ 而若它【仍然卡】⇒ ★ 那是一个比"新会话能跑通"更有价值的读数**：
```
★ 因为那时"旧会话"这个变量已经被排除 ⇒ ★ 而剩下的就是【机制里还剩一格的静默】
⇒ ★ 而检测器的【哪一个信号】先说话，就直接指向那一格。
```

---

## 8. 已知的、本计划**不覆盖**的（★ 而这个清单本身是交付的一部分）

```
✗ 判据的语义正确性（例如"目录条目 ⇒ 大档"那个口径本身对不对）
✗ 经【工具边界】的端到端（★ 而那正是本会话反复划出的射程边界）
✗ 用户目标被完全满足（acceptance 是目标的一个投影）
✗ 未来不回归
★ 而本计划覆盖的是: 【机制在从零开始的会话上，会不会静默地不派发】
```

---

## 9. 起点状态（★ 而它是干净的）

```
主树:      d231f74（今晚 57 条修复已落）
工作树:    ★ 只剩三份【不是我改的】（MODULE-RELOAD.md / package.json / src/index.ts）
旧队:      unified-pipeline（42 条 · 9 completed · 23 failed · 10 pending）
           ★ 而新会话要【新队】⇒ 旧队会被 delete/archive（而它是可归档的，不是丢弃）
salvage:   /tmp/salvage-0131/t28（7 个文件）—— ★ 若新会话要用它，先核它满足 t28 的验收
沉淀:      DISPATCH-RULES 2322 · PENDING-RESTARTS 1288 · ORPHAN-CENSUS 366 = 3976 行
```

---

## 10. 一句话

> **今晚我们修了 57 处，而其中至少 8 处的形状是同一件事：
> 「一个静默的读数，被读成了它恰好想被读成的那个意思」。
> ★ 而本计划要验的就是最后那一格：
> 【在一套没有历史包袱的会话上，那些静默还在不在。】**

---

## 11. ★★★ 执行前必须知道的事（2026-10-10 实测补入）

> **这些条目都是本计划开工【之前】实测出来的，而其中 11.2 会直接改变你对
> `pnpm build` 的信任。写在 §1 之前，因为它们决定"读数算不算数"。**

### 11.1 ★ 宿主重启：GUI 关不掉进程，必须 kill

```
配置（实测）:  close_action: "tray" + auto_start: true
⇒ 点关闭 = 收进托盘，进程【不退出】⇒ 旧模块一直在内存里
⇒ 真正重启只能:  node scripts/restart-host.mjs --kill
```

**工具**：`scripts/restart-host.mjs`（lsof 找 PID，**不用 pgrep** —— 实测两者对同一
进程给出相反答案）、`scripts/restart-dev.sh`（一键）。

★ 而 `agent_teams_status` 报的 `deployment: this process holds the current build`
在**重启前**是不可信的（`loadedStamp()` 是加载时读一次的常量）。

### 11.2 ★★★ 「重载发生了」**推不出**「我的改动生效了」

这是本轮最贵的负结果。打开 HMR 之后，`pnpm build` **确实**让宿主重载 ——
而重载分三层，**结论不同**：

| 层 | 结论 | 证据（实测） |
|---|---|---|
| ① watcher 追文件 | ✅ 成立 | 149 个只读 fd；就地改写也触发 `hmr/reload` |
| ② 模块被重新求值 | ✅ 成立 | 在 `state.js` / `update-task.js` 顶部插求值探针，**两者都被重求值** |
| ③ **`apply` 被重新执行** | ❌ **不成立** | 重载 +1，而 `apply` 里的探针 **0 次** |

**③ 的确切机制（坐实）**：

```js
// 宿主 Registry：键 = 回调对象身份
resolve(plugin) {
  if (typeof plugin === "function") return plugin;
  if (isApplicable(plugin)) return plugin.apply;   // ★ 键 = apply 函数对象
}
// HMR partialReload：重新 import 后拿【新 apply】去查 ⇒ 查不到
reloads.set(plugin, { filename: job.url, runtime: this.ctx.registry.get(plugin) });
//                                                    ^^^ undefined ⇒ if (!runtime) continue
```

实测：`(await import('./lib/index.js?gen=1')).apply === (await import('./lib/index.js?gen=2')).apply`
⇒ **false**。ESM 语义下"重新求值 ⇒ 新函数对象"是必然的。

⇒ ★ 这是**宿主侧的设计限制**，本仓改不动。而三层在外部读数上**同形**：

```
hmr/reload 有事件 · lib/ 是新的 · tsc 退出码 0 · git status 干净
                    —— 而宿主执行的仍是旧代码
```

**⇒ 所以：改 `scheduler.ts` 这类经由工具边界调用的代码，仍然需要重启。**
★ 而 `scheduler.ts` 正是 §5 `n3` / `n5` 要验的那个文件。

### 11.3 ★ 「上次审查的版本」之类要判"生效没生效"，有一条会说话的命令

```
node scripts/verify-reload.mjs arm                    # 种哨兵
#  跑 pnpm build，然后从工具侧读一次（claim 一个任务再 update 成 completed）
node scripts/verify-reload.mjs read --saw "<原文>"     # 判定：0=生效 / 1=未生效
node scripts/verify-reload.mjs clear                  # 还原
```

它挑 `transitionError` 不是随便挑的：那是**唯一**能从成员侧可靠触发、
且返回值**逐字**进工具错误的路径（`claim.ts` 那条调用点永远被 ownership 挡在前面）。

★ 它回答的是**「改动能不能透过工具边界被看见」**，而**不是**「HMR 有没有重载」
—— 后者由 `.agent-teams/hmr-reloads.jsonl` 回答，而实测证明两者是两件事。

### 11.4 ★ 因为 11.2，§1 的判据要加一条前提

```
§1 原判据:  七个信号全 0，而 ready > 0，且有成员在 working
★ 现在要加: 而【宿主是这次 build 之后的】（否则测的是旧机制）
            ⇒ 用 11.3 的命令确认，而不是看 `deployment` 那一行
```

★ 否则：一次失败的 `n1` 分不清是"机制没修好"还是"宿主跑的是旧代码" ——
而这两件事的**处置完全相反**。

### 11.5 ★ 本次实测顺带暴露的两个真实缺陷（都不是本轮制造的）

```
① describeDependencyOutcomes（src/state.ts）
   ★ 零生产调用方 —— grep 全仓，只有定义与夹具，没有任何调用点。
   与"机制建好了没接线"同形的那一类。

② claim_task 在"已认领"时【幂等返回】，而 transitionError 因此在 claim 路径上不可达
   MEASURED：同一个成员对同一任务二次 claim ⇒ 返回同一个 attempt_id、不报错、不换代。
   ★ 而这是**刻意**的（源码里有注释：`Authorization must happen before the idempotent
     return: another member must not receive a false success for somebody else's task.`
     —— 授权先于幂等返回，否则别的成员会拿到一个假成功）。
   ⇒ 所以这不是缺陷，是一条**设计选择**。而它的**副作用**是本轮的真实发现：
     `claim.ts:89` 的 `transitionError(status, 'claimed')` 在这条路径上**不可达**
     （`claimed`/`in_progress` 都在它之前 return 了；`pending` 是合法转换）。
   ★ 后果：为找一条能触达 `transitionError` 的路径花了 **5 次探针**
     （t1–t5，前四次都撞在 ownership 守卫或幂等返回上）。
     唯一可达的是 `update_task(status='completed')` 从一个 `claimed` 任务出发。
   ⇒ 登记它，不是因为要改 claim，而是因为**下一个需要这条路径的人不必再花 5 次**。
```

★ 两条都**未修**，登记在这里，等 §2 的机制验证跑完再决定要不要立项。

---

## 12. 本轮交付的工具（伴随 11 而产生）

| 文件 | 作用 | 夹具 |
|---|---|---|
| `scripts/verify-reload.mjs` | 改动的生效判定（11.3） | `verify-reload.test.mjs`（8 臂） |
| `src/hmr-trace.ts` | 重载痕迹 + 三层断裂的根因记录 | `hmr-trace.test.mjs`（9 臂） |
| `scripts/enable-hmr.mjs` | 打开 profile 的模块 HMR | — |
| `scripts/restart-host.mjs` | lsof 找 PID + 杀 | — |
| `scripts/restart-dev.sh` | 一键：配 HMR + 重启 | — |

★ 合计 17 臂，全绿。而**它们的价值不在"多了一个工具"，在于 11.2 那条负结果
被变成可复现的读数** —— 否则下一次会话还会照着"HMR 开了就不用重启"去推断，
而那正是本计划 §10 那句话要消灭的形状。

---

## 13. ★★★ 端到端实测补录（2026-10-10 下午）

> **这一节记的是"合并 ≥2 棵 worktree"这件事【第一次真正跑通】的过程，
> 以及跑通之前必须先修掉的三条缺口。它们都属于本计划 §5 的 `n3`。**

### 13.1 ★ 先说结论：`n3` 的合并目标已经可验

```
两条链各自建树（从同一个 base）
  ↓ 各自在【自己的树】上改不相交的文件
落终态 ⇒ 机制【自动提交】（commitWorktree）
  ↓ 产物可寻址（team.json 里的 deliverableCommit）
integrator 两次 git merge ⇒ 零冲突
  ↓ git 图里两棵树的 commit 真的成为合并的双亲
两个改动都在（逐字节相等）
```

**⇒ 这条链现在是可跑、可判的。** 而它跑通之前，有三条缺口挡着。

### 13.2 ★ 缺口一：worktree **只建不提交**（最根本的一条）

```
MEASURED：46 棵 worktree 里，目标文件【一个都没有】
根因：worktree 是 checkout 产物，只含【已提交】内容，而成员改动从未被提交
⇒ integrator 没有任何东西可合 ——「合并 ≥2 棵 worktree」在机制上不成立
```

**★ 而它是静默的**：成员在那棵树里 `git status` 看得见改动、任务照常 `completed`、
而**从外面看什么都不存在**。

**修法**：落终态时自动提交（`commitWorktree`），commit id 落进 `deliverableCommit`。
三条可靠性约束：只有终态才提交 / 提交失败**不改判**（记账不是裁决）/ 没有树就跳过。

### 13.3 ★★ 缺口二：「不该建树」把「该建树而没建成」盖住了

```
MEASURED（由 e2e-worker 抓到）：
  if (existsSync(<worktree>/.git)) { …commit… }
  —— 条件为假时【整段静默】：不产 commit，也不产任何读数
⇒ 两件【处置完全相反】的事同形：
   · work/review/requirements ⇒ 设计如此（不建树），什么都别做
   · implementation 却没树    ⇒ ★ 真缺陷，要去查
```

**修法**：判据从「路径在不在」改成 `needsWorktreeFor(task.kind)`（**应当**有树吗），
并加一支独立读数（日志 + `deliveryFailure`，说明"integrator 取不到这个产物"）。

### 13.4 ★★★ 缺口三：**任务 id 按团队重计数，而路径名只用 taskId**

```
MEASURED（两条链独立报出同一个现象）：
  task-t1 HEAD = d623cbd   ← 上一轮 integrate-probe2 的链 A 产物
  task-t2 HEAD = 451c06d   ← 上一轮的链 B 产物
  而当前 HEAD = c70cf12
⇒ 成员在一个【与本轮完全无关的历史点】上干活，而所有读数都说"正常"

根因（比成员诊断的更深一层）：
  createTaskWorktree 的「已建过 ⇒ 复用」分支
  + 任务 id 按团队【重新计数】（每个团队的 t1 都叫 t1）
  + delete 团队【不清理 worktree】（目录留着）
  ⇒ 新团队的同名任务命中上一轮的树

★★ 而它在读数上完全正常：ok:true、base 有值、目录在、missingIgnored 也算得出来
   ⇒「复用了对的树」与「复用了别人的树」同形。
```

**修法**：把 `teamId` 编进路径名（`task-<teamId>-<taskId>`）—— 在**根上**避免重名，
而不是事后校验归属。★ 建树与找树（`update_task` 的自动提交）**共用同一个函数**，
否则两处会在团队前缀那一位上分叉。

### 13.5 ★ 三条链上成员的处置【都对】，值得记下来

缺口三暴露时，两个记账点都**独立地拒绝硬做**，并给出可复现证据：

```
· 没派临时工（让临时工改一个不存在的文件 = 伪造结果）
· 没自建文件（那是"新增"而非授权的"改一行"，且会污染合并语义验证）
· 如实报 failed + 根因 + 建议
```

★ 与 §11.2 那条同源：**"让实验继续"有时正是毁掉实验意义的那件事。**

### 13.6 ★★ 写域门使"两链改同一文件"在建任务时就被拒

```
create_task ⇒ inScope overlaps t1 at scripts/clean-build.mjs;
              serialize these tasks or split the paths
```

★ 机制：两条 OPEN 的 WRITE_KINDS 任务，`inScope` 有交集 ⇒ 拒绝；
豁免只有"一方依赖另一方"。

**⇒ 这不是缺陷，而它有一个重要含义**：**行级合并冲突被前移到了建任务阶段** ——
能并行建出来的任务，其写域必然不相交。所以 `n3` 要测的"合并级冲突"，
**不可能来自同一文件的行冲突**，只能来自**语义**层面（两条链各自自洽、合起来矛盾）。

### 13.7 ★★★ 而"语义级冲突"真的被发现了一次

上一轮（两条链改**同一个文件的两个不同函数**，靠依赖豁免建出来的）：

```
链 A 给 clear() 加 lib.tmp.LOCK 守卫  →  合并【零冲突】
链 B 给 publish() 加一行日志          →  两份审核都 pass

★★ 而 integrator 在【合并后的语义】上发现：
   陈旧的 lib.tmp.LOCK ⇒ 构建【永久死锁】
   · 全仓没有任何代码创建或删除那个文件
   · clear() 只删 lib.tmp/lib.old，永不删 LOCK，而 build 第一步就是 clear
   · 一旦残留，每次构建都在第一步失败，仓库无法自愈
```

**★ 为什么单条链看不到**（integrator 的原话，值得逐字记）：

> t1 的独立审核只验了"有 LOCK 时正确拒绝"——**拒绝本身没错，pass 成立**。
> 但看不出**没有任何路径会清掉它**。要看出这点，必须把守卫 + publish()/build 链
> + "谁写这个文件"放进同一视野 —— **正是合并才提供的视野**。

**⇒ 这就是 integrator 存在的理由，而且是实测出来的。**

★ 而 `chain-a` 自己报的那条 low finding（"守卫在 rm 循环之后"）**已经擦到了这条的边**，
但被降级为"契约字面已满足"。**合并级视野把它变成了必修项。**

**修法**（三件一起）：
```
① LOCK 里写【持有者 pid】  ← "谁在跑"的机械形式，不是一个布尔
② 持有者已死 ⇒ 陈旧 ⇒ 清掉并继续（自愈）
③ 守卫移到 rm 之前（拒绝时不许造成破坏）
★ 四态：free / held / stale / unreadable —— 而 unreadable 按 held 处理
  （"没测到"不许并进"没有锁"）
```

### 13.8 ★ 两条夹具假设也过时了（空目录 ≠ 扫描失败）

```
MEASURED：清理掉全部 46 棵 worktree 之后，两条夹具红了 ——
  它们都断言 scanned > 0 / rows.length > 0
⇒ 而【空目录是合法的】（刚回收干净）
⇒ 那不是回归，是把"这一轮恰好有东西可扫"当成了机制性质
```

**修法**：三态区分 —— 目录不在（跳过）/ 目录在而空（**合法，如实报出**）/
目录在且非空（必须真扫到）。

### 13.9 ★ 顺带：一批夹具的"写死判据数"是一条恒假型断言

```
MEASURED：verify-input-requires 里 assert.equal(declared.length, 11, …)
而判据数从 11 长到 13（注册表新增了判据）⇒ 这条臂【永久红】
★ 而它红的原因与"判据有没有声明输入面"【无关】

★★ 更坏的是形态：该臂的本意是"每一条判据都必须声明输入面"，
   写死数字把它变成了"判据数必须恰好是 11" —— 后者是一条【恒假型】断言，
   而恒假的断言与没有断言同形。
```

**修法**：从注册表读（`declared.length === views.length`），把"有多少条"降级成读数。

★ 同一类（夹具过时）还表现在 **8 个夹具没盖 `reviewed` 戳**而被 `plan-reviewed` 门挡住 ——
那 8 个夹具测的都不是那条门，是被**意外挡住**的（门在夹具之后上线）。
⇒ 抽出一个共用件 `scripts/fixtures/reviewed-stamp.mjs`（五问从判据层 import，
**不在 8 个文件里各写一遍** —— 那样会在"五问改名"那天同时红八个）。

---

## 14. 合并级实测的最终读数（2026-10-10）

```
两条链:  task-merge-e2e-t1 / task-merge-e2e-t2   （都从 c70cf12 分出）
产物:    3679545  scripts/restart-host.mjs   +1
         608dc25  scripts/verify-reload.mjs  +9/-1
合并:    两次 git merge --no-ff，均 "Merge made by the 'ort' strategy"，【零冲突】
结果:    merged blob 与各自 worktree 的 HEAD blob 【逐字节相等】
         git diff --stat = 恰好 2 文件 / 10 insertions / 1 deletion ⇒ 无第三方被牵连
主线:    全程未污染（integrator 在隔离 clone 里做，做完主线 HEAD 未变）
落地:    e4901ab（由 captain 按文件落地，避免把 24 项无关改动卷进 merge commit）
```

★ **而这一轮 integrator 没有发现合并级问题** —— 文件不相交、语义不耦合，
且它用**差分法**证明了既有的 10 条夹具失败在 pristine 基线上完全相同（与合并无因果）。
**"没有发现"也是一个结论，而它必须说清是怎么找的。**
