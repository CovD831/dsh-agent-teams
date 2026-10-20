# 本轮修复的独立复核（2026-10-20 · 队长亲自执行）

> **为什么是队长做的**：`t7` 的独立复核指派给 `verifier`，但团队四个成员全部撞上
> `wb` 上游账号拦截（`upstream_content_policy_blocked`：账号存在异常行为，已被限制使用），
> 复核任务无法由成员完成。⇒ 由队长执行，并**如实标注这不是独立复核**：
> 复核者与实施者同一人，判别力低于契约要求的水平。

---

## 0. 先说清楚本轮**实际完成了几件**

| 任务 | 任务状态 | 产物 | 真实结论 |
|---|---|---|---|
| t1 admission 改真话 | completed | 主树 `ad32ab4` | ✅ 完成 |
| t2 outputs 施工单 | completed | `docs/OUTPUTS-CONSUMER-AUDIT.md` | ✅ 完成 |
| t3 自审缝 | **failed** | 主树 `ad32ab4` | ⚠️ **产物完整、验证通过**；failed 是上游拦截造成的**误判** |
| t4 会话预算 | failed | 无 | ❌ 零改动（被拦截前没开工） |
| t5 测试哈希 | failed | 无 | ❌ 零代码（**契约不可满足**，成员正确选择失败） |
| t6 独立性读数 | failed | 无 | ❌ 被拦截 |
| t7 独立复核 | failed | 本文 | ❌ 由队长代做 |

⇒ **六件里真正完成 2 件（t1/t3）+ 1 份审计单（t2）。**

★★ 而 `t5` 的失败**不是成员的错**：它的 `inScope` 把三个 claim 点
（`claim.ts:98` / `scheduler.ts:891` / `reassign.ts:117`）与臂的落点（`scripts/`）
全留在外面 ⇒ 那条契约**在结构上不可满足**。成员宁可 failed 也不交一个恒 `unmeasured`
的空壳，那个选择是对的。

---

## 1. 逐条复核（三态，不许合流）

### 1.1 t1：admission 的假话 ⚠️→✅

| 验收项 | 状态 | 证据 |
|---|---|---|
| 「没有实例」那句已消失 | **confirmed** | `grep -c "没有实例" src/gates/index.ts` ⇒ **0** |
| 真话已落盘 | **confirmed** | `grep -c "生产零求值点"` ⇒ `index.ts:2` / `types.ts:1` |
| ① 已注册 3 条 | **confirmed** | `registry.count('admission')` ⇒ **3** |
| ② 生产零求值点 | **confirmed** | 排除注释行后 ⇒ **0** |
| ③ 输入面零产出 | **confirmed** | 四个键在 `src/gates/admission/` 之外 ⇒ 命中**全是注释** |

★★ **一条差点读错的读数**：裸 `grep -c "evaluate('admission'" src/` 得到 **4**，
看起来像"②不成立"。而那 4 处**全是注释** —— 包括 t1 自己新增的、**引用这句话本身**的注释。
⇒ 剥掉注释行后是 **0**。★ 这正是 t1 在它的交付报告里警告过的陷阱
（「一句被引用的假话仍然是假话」，以及"裸 grep 会让结论自己证伪成假的"）。
**判据本身没问题，是我的核查命令有缺陷。**

### 1.2 t3：requirements 自审缝 ✅

| 验收项 | 状态 | 证据 |
|---|---|---|
| 实现者判自己的 requirements ⇒ 被拒 | **confirmed** | `ok:false`「would also implement the work these requirements specify」 |
| 换一个身份判 ⇒ 放行（**反向半边**） | **confirmed** | `ok:true` |
| 队里没有被治理的实现 ⇒ undecidable | **confirmed** | `ok:true` + `undecidable`（**不是**放行） |
| 臂全绿 | **confirmed** | `gate-self-review` ⇒ 13 tests / 12 pass / 0 fail |

★★ **而它的判据设计比我的契约更严谨**，它明确写了三处**不读什么、为什么**：
- 不读 requirements 自己的 `executions` —— pass 落盘那一刻它还没有 completed execution
- 不读 requirements 自己的 `assignee` —— 会**自毁**：pass 由别人发出后 assignee 归那个人，
  判据下一刻读到"作者=盖章的人"，**同一个 pass 先绿后红**。
  ★「一条判据若依赖一个会因它自己放行而改变的量，它不是判据，是回音。」
- 读的是**被治理的实现**（依赖闭包含这条 requirements 的 implementation/repair）

### 1.3 t2：outputs 施工单 ✅

| 项 | 状态 | 证据 |
|---|---|---|
| 文件存在、src 零改动 | **confirmed** | `docs/OUTPUTS-CONSUMER-AUDIT.md`；`git status --porcelain src/ scripts/` 空 |
| 22 条判据 / 45 个「判据×键」对 | **confirmed** | 文档 §7.4 的自检 |
| 唯一生产读者是 `reruns` | **confirmed** | 我独立复核：`grep -rn "outputs\[" src/` ⇒ 仅 `update-task.ts:1681` |

★ **一条它会自己漂的读数**（它主动报出）：盘上条目数 8 分钟内从 118 漂到 122
（因为本队别的任务在落盘）。⇒ 它把**结论与那个数解耦**，数的是代码结构不是盘上条目。
★ 这是对的：**一个会漂的数不该承重**。

---

## 2. 我尝试证伪的三件事（不是只确认好消息）

| 证伪尝试 | 结果 |
|---|---|
| t3 的修复会不会**误伤**（换个人判也被拒）？ | **未证伪**：另一个身份判 ⇒ 放行 |
| t1 的"②生产零求值点"是不是读错了（裸 grep 得 4）？ | **未证伪，而我的命令错了**：4 处全是注释 |
| t3 的产物是不是"看着完整其实没生效"？ | **未证伪**：主树里实测三条分支各自不同形 |

---

## 3. 一条我自己的错误，如实记账

复核过程中我**把 `lib/git-artifact-stamp.json` 还原成 `ad32ab4f`**（当时以为那是"清理我造成的抖动"），
结果 `pnpm test:gates` 出现 **4 条新增失败**：

```
✖ 臂 1 ★ 对照臂：盘上与加载时一致 ⇒ current
✖ 臂 4（边界臂）：stamp 一致不等于每一段都新
✖ 臂 6（★ 出口臂）：新鲜度必须能从 status 的返回值读到
✖ 臂 10（三态在拒绝里也分形）
```

根因：`stamp.commit` 停在 `ad32ab4f`，而 HEAD 是 `f4a2c81b` ⇒ 判据正确报 `stale`。
**那 4 条臂是对的，是我错了。** 重建 stamp 后 24/24 全绿、全量回到基线。

★★ 教训：`stamp.commit` 落后于 HEAD 是**判据要抓的形态**（f-0026 的核心），
不是"可以随手还原的噪音"。我把一条**判据信号**当成了**抖动**。

---

## 4. 全局读数

```
pnpm test:gates ⇒ 1740 tests / 1674 pass / 27 fail
逐条对 scripts/fixtures/baseline-known-failures.json ⇒ NOT in pin = 0
```

---

## 5. 本轮**没做**的（不许读成已做）

- **t4 会话预算读数**：零改动。「重派必然复用已满会话」**仍然敲着**
- **t5 测试文件哈希基线**：零代码。「真跑测试拿绿灯、再改松断言」**仍然敲着**
- **t6 判官独立性读数**：未开始。`schedulableAssignee` 找不到人时**仍然静默进共享池**
- **t7 的真正独立复核**：由队长代做，**判别力低于契约要求**

★★ 而 `edit_plan` 的 `add_task` 现在跑契约门了（`4f831b3`），但它**只解决了 t5 病因的一半**：
它只查 `src/` 有没有配对 `lib/`，**查不出**「三个 claim 点与 scripts 落点缺失」。
实测两条方向相反（t5 原契约被拦 / 配了 lib 仍缺落点则放行），见 `docs/REQUIREMENTS.md` §20。
