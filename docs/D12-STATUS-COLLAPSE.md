# D12 · 成员主行的状态塌缩 —— 修法与自证

**基线**：HEAD = `87def5a`（开工时 stamp `2b23665` ≠ HEAD，先 `pnpm build` 取新鲜基线）。
**写域**：只改 `src/client/**` + 构建产物 + 本文。`src/state.ts` / `src/tools/**` / `scripts/**` 一行未动。

---

## 0. 结论速览

| # | 判据 | 状态 | 读数 |
|---|---|---|---|
| 1 | 主行区分**四种**情形（不压成一行） | ✅ | 四种取值两两不同（见 §2） |
| 2 | 「待派工」与「从未派工」**不同形** | ✅ | 两个不同 locale key |
| 3 | 反向半边 A：完成 12 件 vs 从未派工 ⇒ 文本**不同** | ✅ | `awaitingAssignment#d12` ≠ `waitingAssignment` |
| 4 | 反向半边 B：最新失败 ⇒ 既不「待派工」也不「从未派工」 | ✅ | `awaitingRedispatch#t7`，与两者都不同 |
| 5 | 不把四种压回两种 | ✅ | 三种**无未终结任务**的形态互不相同 |
| 6 | 零新依赖 | ✅ | `git diff --stat package.json pnpm-lock.yaml` 为空 |
| 7 | `tsc` exit=0、`pnpm build` exit=0 | ✅ | 两份 tsconfig 都 exit=0；stamp == HEAD |
| 8 | `pnpm test:gates` 失败文件集合与基线逐条相同 | ✅ | 16 == 16，`diff` 无输出 |

---

## 1. 根因与修法

**根因**：`src/client/MemberRow.tsx` 的 `memberDoingText` 原来只有**一个兜底 return**，
于是四种情形同形（用户截图里 `ui-engineer` 完成 0 · 失败 1 与 `ui-dissect` 完成 12 · 失败 3 **都是**「等待队长派工」）。

```
改前                                  改后
① current !== undefined  有当前任务   ① 不变
② activity === 'working' 活动中       ② 不变
③ open.length > 0        有未终结     ③ 不变
④ ★ 兜底 = 四种合并于此               ④ 最新终结任务 failed   →「{taskId} 失败 · 待重派」
                                      ⑤ 有 completed 任务     →「已完成 {taskId} · 待派工」
                                      ⑥ 从未派工             →「从未派工」
```

★ 修法**没有新数据出口**：`owned`（该成员全部任务）与每个任务的 `status`/`state`/`updatedAt`
本来就已经传进来了 —— 纯渲染层改动。

### 1.1 新增 `memberHistoryState()`（`activity-model.ts`）

一个**纯函数**把"名下任务"归到四种之一，让两个调用点（`memberDoingText` 与将来的消费者）
用**同一口径**：

```ts
memberHistoryState(owned) → 'open' | 'failed' | 'finished' | 'never'
```

| 取值 | 判据 | 主行文案 |
|---|---|---|
| `open` | 还有未终结任务 | 调用方去显示那个任务（不是兜底） |
| `failed` | 最新一条**终结**任务是失败 | `member.status.awaitingRedispatch` |
| `finished` | 终结任务里有 completed，且最新那条不是失败 | `member.status.awaitingAssignment` |
| `never` | 名下一条任务都没有（或只有 cancelled 残留） | `member.status.waitingAssignment` |

**三条细节判据（每一条都能被推翻）**：

1. **"最新"必须确定**：优先用宿主写的 `updatedAt`（唯一持久时间戳）；**缺席时退回快照顺序的最后一条**。
   ⇒ 快照顺序是稳定的，而"随机挑一条"会让同一份数据两次渲染给出**不同**的句子。
   ★ 实测：`无 updatedAt ⇒ 取最后一条` 两条断言 + `同一份数据两次调用同结果`。
2. **`finished` 里的 tN 必须是真的完成了的那个**：`latestCompletedId` 只从 `status === 'completed'` 里挑。
   若取"最新那条终结任务"，一条较新的 `cancelled` 会让这句话把**被取消**的任务说成**已完成**。
3. **只有 `cancelled` 不算"干完了"** ⇒ 落 `never`。实测断言在案。

### 1.2 文案改动（zh + en 各一次）

| key | zh | en |
|---|---|---|
| `member.status.waitingAssignment` | 「等待队长派工」→「**从未派工**」 | "Waiting for the captain to assign work" → "**Never assigned work**" |
| `member.status.awaitingAssignment` | ★ 新增「**已完成 {taskId} · 待派工**」 | ★ new "Finished {taskId} · awaiting assignment" |
| `member.status.awaitingRedispatch` | ★ 新增「**{taskId} 失败 · 待重派**」 | ★ new "{taskId} failed · awaiting re-dispatch" |

★ **为什么改的是 `waitingAssignment` 的文案而不是它的 key**：
`scripts/workspace-activity.test.mjs:1217`（臂 25e）**逐字钉住**了这个 key：

```js
assert.equal(doing, 'member.status.waitingAssignment', '★ 兜底必须是明确的一句话')
```

而那个夹具的输入正是 **(从未派工)** 这一格（`owned: []`、`done: 0`、`total: 0`）。
⇒ 若我给 ④ 换一个新 key，就会**让一个写域在我之外（`scripts/`）的夹具变红**。
改**文案**（让 key 名 `waitingAssignment` 恰好说"从未派工"）同时满足两件事：
① ④ 显示的字面就是「从未派工」；② 臂 25e **不动也绿**（实测 6/6）。
★ 这不是绕开判据 —— 判据钉的是"兜底必须是一句明确的话"，它仍然成立。

**zh/en 校验**：两本字典各 **202** key，集合相等，差集为空；三个 key 在两本里都在。

---

## 2. 四种不同形 —— 实测读数

用**会回显 key 与 taskId 的 `t`**（`(key, params) => key + '#' + params.taskId`），
于是"选了哪个 key、给了哪个任务"都读得出来：

```
① 有未终结任务        member.doing.task#t1
② 最新失败            member.status.awaitingRedispatch#t7
③ 完成 12 件          member.status.awaitingAssignment#d12
④ 从未派工            member.status.waitingAssignment
```

* **四种取值两两不同** ✅（`new Set(四种).size === 4`）
* **不是"有任务/没任务"两分** ✅：三种**无未终结任务**的形态互不相同
  （`{failed, finished, never}` 的 `size === 3`）
* ★ **③ 取的是最新的完成件 `d12`，不是 `d1`**（构造了 12 件，断言落在 `#d12`）

### ★ 用户截图的那两行（本次缺陷的原始现场）

```
ui-engineer  完成 0  · 失败 1  → member.status.awaitingRedispatch#t_eng
ui-dissect   完成 12 · 失败 3  → member.status.awaitingRedispatch#df3
```

两者**不再同形** ✅ —— 改前它们都是 `member.status.waitingAssignment`。

---

## 3. ★★ 反向半边（两条都在，且都证明**有分辨力**）

### A —— 完成 12 件 vs 从未派工必须不同

```
A: done12 !== never
   done12 = member.status.awaitingAssignment#d12
   never  = member.status.waitingAssignment            ✅ 不同

A 的分辨力探针：模拟"把 finished 与 never 合流"的错实现 ⇒ 两者变同形
   ⇒ 说明 A **测得出**合流，不是一条恒真的判据        ✅
```

### B —— 最新失败既不「待派工」也不「从未派工」

```
B: failed !== never                ✅
B: failed !== finished(待派工)     ✅
B 的分辨力探针：把 failed 折回 waitingAssignment ⇒ 它会等于 never
   ⇒ 说明 B **测得出**折叠                          ✅
```

### ★★ 决定性对照：同一份测试，**旧实现 6/19 通过，新实现 19/19 通过**

把测试写成**不依赖新增导出**的版本（只经 `memberDoingText`），
于是同一份文件能同时对**新旧两份 `lib/`** 运行（中间 `git stash` 源码 + `pnpm build`）：

| 实现 | 结果 | 失败的断言 |
|---|---|---|
| **旧**（HEAD） | **6 passed / 13 failed** | 失败/完成/四种不同形/两分/A/B/截图对照/顺序敏感/无时间戳 全红 |
| **新**（本轮） | **19 passed / 0 failed** | 无 |

⇒ 这是"拆开了"与"拆了个恒等的"**不同形**的机械证据：
**拆了个恒等的实现，这份测试会红。**

---

## 4. 验收命令读数

```bash
npx tsc -p tsconfig.json --noEmit        # exit=0   （tsconfig.client.json 亦 exit=0）
pnpm build                               # exit=0   （lib/client.js 321.58 kB）
pnpm test:gates                          # 失败文件集合与基线逐条相同
```

**净变化用【失败文件集合】判定**（计数会抖）：

| | 基线（同 HEAD） | 改后 | 判定 |
|---|---|---|---|
| `pnpm test:gates` | 16 个失败文件（1413 pass / 20 fail） | **16 个，逐条相同**（1413 / 20） | ✅ 净新 = 0 |

★ 基线与任务书写的「1415 pass / 19 fail / 15 文件」不同 —— 那是**更早 HEAD** 的读数。
按净变化纪律，我以**本 HEAD 实测的基线**为准（开工时先 `pnpm build` + 跑一遍取基线）。

**产物**：`lib/git-artifact-stamp.json` 的 `commit` == `87def5a` == HEAD ✅；
三个 key 与三条 zh 文案都在 `lib/client.js` 里读得到。

### 4.1 会碰成员行的夹具臂

| 臂 | 结果 |
|---|---|
| 25a–25f（含**钉住 `waitingAssignment` 的 25e**） | **6/6 pass** |
| 24–26 / 28–32（共 13 条，非浏览器） | **13/13 pass** |

---

## 5. ★ 两条如实报出（都不是本轮造成）

### 5.1 `MemberScreen.tsx` **无需改动** —— 它没有这个塌缩

`src/client/MemberScreen.tsx` 的"在做什么"走的是**另一条**逻辑（`:168-177`）：
`member.status.working` / `executing` / `executingModel`，兜底是 **`member.status.working`**
（不是被压扁的 `waitingAssignment`）⇒ 那里本来就不存在 D12 这个塌缩。
故本任务 inScope 里的 `MemberScreen.tsx` **一行未改**（`git diff --stat` 为空）。

### 5.2 `workspace-activity.test.mjs` 臂 27 **在干净树上就是红的**（t67 的遗留）

实测：`git stash` 掉本轮**全部**改动 + 重新 `pnpm build` ⇒ 臂 27 仍然是
`tests 2 / pass 1 / fail 1`，报文是

```
★ 反向半边：这些条目登记为"已删除"，但它们并没有真的消失 ——
实测：["workspace.guide", … , "assignment.empty"]   （41 条）
```

⇒ 这是 **t67（E 线 L0.3）交下来的登记表**：登记已写好，但 `locales.ts` 的删除**还没做**
（那一步需要 `scripts/` 写域，当时判为越权）。**与本轮改动无关**，也已确认
`workspace-activity.test.mjs` **不在** `test:gates` 的失败文件集合里（基线与改后都没有它）。

★ 这条**需要另派**：改 `src/client/locales.ts` 删那 41 条（zh+en 各一次 ⇒ 82 处条目），
那 41 条与本轮的 `member.status.*` 改动**不重叠**（它们是 `workspace.*` / `assignment.*` /
`member.state.*` / `member.status.{delivered,idle,settled,unknown,waitingOn,waitingPrerequisite}` 等，
**不含** `member.status.waitingAssignment`）。

---

## 6. 改动清单

```
src/client/MemberRow.tsx          memberDoingText 拆四支 + 两个取 id 的私有函数 + import
src/client/activity-model.ts      + memberHistoryState / latestOwnedTask / isTerminalTask（纯函数）
src/client/locales.ts             zh + en：改 1 条文案、新增 2 条
lib/**                            pnpm build 产物（含 .d.ts）
docs/D12-STATUS-COLLAPSE.md       本文
```

**未动**：`src/state.ts`、`src/tools/**`（t71 写域）、`scripts/**`、`src/client/MemberScreen.tsx`（见 §5.1）。
