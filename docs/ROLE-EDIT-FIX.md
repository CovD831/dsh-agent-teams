# t84：`update_member` 的闸门按**字段**收紧（放行 `role` / `executionPrompt`）

> **改动**：只有 `src/tools.ts`（`+37 / −1`）+ `lib/tools.js` + `lib/git-artifact-stamp.json`。
> **基线**：HEAD `62fc153`（`git merge-base --is-ancestor 71790be HEAD` ⇒ **IS ancestor** ✅）。
> **对照基线**：`pnpm test:gates` ⇒ `tests 1488 / pass 1430 / fail 20`，**16 个失败文件**。

---

## 1. 缺口

`src/tools.ts` 原本逐字是：

```ts
if (member.id !== '') throw new Error(!staged
  ? `member "${member.name}" has already been spawned, so its model is frozen
     into its session descriptor; changing it now would be recorded without
     being applied - spawn a replacement member instead`
  : `staged member "${member.name}" was already spawned`)
```

⇒ ★★ **它把【整条 `update_member`】一起拒掉** ——
而它的理由（"model 冻进 session descriptor，不传播"）**只对一部分字段成立**。

## 2. ★★ 逐字段定性（本次的核心）

| 字段 | 进哪里 | 对**已生成**成员改它，生效吗 | 结论 |
|---|---|---|---|
| `provider` · `model` · `reasoningEffort` | 冻进 **session descriptor**（t14 实测：不传播） | ❌ **不生效** | ★ **该拒** |
| `role` | ① 面板：`snapshot.ts:368` `role: member.role ?? ''`（每轮轮询**重读** `team.json`） | ✅ **面板立刻生效** | ★ 放行 |
| | ② 成员 persona：`members.ts:536` `...with the role: ${member.role}` | ⚠️ **不会更新**（见 §3） | ★ 放行 + **加注** |
| `executionPrompt` | ① 存储 / 面板：`snapshot.ts:372` 直取 | ✅ 生效 | ★ 放行 |
| | ② persona：`members.ts:534` 的 `injectedPrompt` | ⚠️ **不会更新** | ★ 放行 + **加注** |

★ **`executionPrompt` 与 `role` 同性质**（队长裁定授权一并处理）——
否则下一个人改 `executionPrompt` 会撞上同一条闸门，而那条闸门会因为"`role` 已放开"而**更难解释**。

## 3. ★★★ 加注：`role` / `executionPrompt` **有一半是冻的**（既存事实）

```
consumer ① 面板        snapshot.ts:368 → 每轮从 team.json 重读        ⇒ ✅ 刷新即生效
consumer ② 成员 persona members.ts:536 memberPersona(...)            ⇒ ❌ 不更新
```

**② 为什么冻**（实测，不是推断）：
```
memberPersona 在 src/ 里【只有一处调用】：
    members.ts:634   persona: memberPersona(team, member, stateDir, …)
  ★ 而它在 spawnMember 内部。
调度路径逐字（tools.ts:1898）：
    if (member.id !== '') return deliverToMember(ctx, captain, member.id, text, signal, mode)
    …
    await spawnMember(...)      ← ★ 只有 member.id === '' 才会走到
⇒ 已生成会话的成员【永远不会再跑 spawnMember】⇒ persona 不再重建。
```

★★ **一个精确的更正**（我先写错、后实测纠正）：
`memberPersona` 本身是**纯函数** —— 把新 `role` 传进去，它**会**输出新 role（实测三个值逐个验证）。
⇒ **"冻"不在这个函数里，而在【谁调用它】**。所以正确的说法是
「**persona 不会更新**」，而不是「persona 无法反映新值」—— 后者会让人以为要去改那个函数。

★ **而这是【既存事实】，不是本次引入的**：今天这两件事被同一条闸门一起挡住，
所以**这个区别从来没人看得见**。放行之后它才第一次变得可观察。

## 4. ★★ 判据为什么是"**变了没有**"，而不是 `!== undefined`

**MEASURED（t84 实查，这一条决定修法对不对）**：

```ts
// src/tools/shared/entities.ts —— StagedPlanMutation 的 update_member 分支
action: 'update_member'
memberName: string
role?: string | null
provider: string        // ★ 必填
model: string           // ★ 必填
reasoningEffort?: string | null
executionPrompt?: string | null
```

而 `edit-plan.ts` 用**成员当前值兜底**：
```ts
provider: operation.provider?.trim() || member.provider || '',
model:    operation.model?.trim()    || member.model    || '',
```

⇒ ★★ **一次"只改 `role`"的编辑，到达闸门时 `mutation.model` 是【成员现有值】、恒非 `undefined`。**
⇒ 若照字面写成 `mutation.model !== undefined`，**闸门会把 `role` 编辑照样拒掉** ——
  即 **"修了但没修好"，而那种失败在报告里与"改对了"同形**（本仓记账最久的形态）。

**实现**：逐字段比较**值是否变化**（`trim` 后）：

```ts
const changedLlmRoute = member.id !== '' && (
  (mutation.provider?.trim() ?? member.provider ?? '') !== (member.provider ?? '')
  || (mutation.model?.trim() ?? member.model ?? '') !== (member.model ?? '')
  || (trimmedOptional(mutation.reasoningEffort) ?? '') !== (member.reasoningEffort ?? '')
)
if (changedLlmRoute) throw new Error(/* ★ 原措辞逐字保留 */)
```

★ **没变 ⇒ 不是在改那个字段 ⇒ 不拒**。
★ 与下面的 `resolveMemberLlmSelection` 调用**不冲突**：值没变时它解析出同一个路由 ⇒ 写回去是**幂等**的
（不是"放宽"，是"同一个值"）。
★ **`model` 的拒因逐字保留**（约束 1）；★ **不再要求 `staged`**（约束 2）。

## 5. 验证

### 5.1 闸门的分辨力（四个用例）

```
1) 只改 role（provider/model 原样回传）  ⇒ ALLOWED ✅   ← ★ 本次要放行的
2) 改 model                              ⇒ BLOCKED ✅   ← 反向半边 A
3) 改 provider                           ⇒ BLOCKED ✅
4) 改 reasoningEffort                    ⇒ BLOCKED ✅
```

### 5.2 ★ 反向半边 A：`model` 仍被拒

用例 2 实测 `BLOCKED`，且**拒因逐字保留**（"…frozen into its session descriptor…"）。

### 5.3 ★ 反向半边 B：`role` 端到端可读

**驱动真实投影器** `assembleTeamSnapshot`（**不是**读源码、**不是**复算逻辑）：

```
$ node /tmp/probeB2.mjs .
  input role="OLD-ROLE"   -> snapshot role="OLD-ROLE"  ✅ FRESH
  input role="新角色"       -> snapshot role="新角色"      ✅ FRESH
  input role="third"      -> snapshot role="third"     ✅ FRESH
```
★ 含**中文**一例 —— 正是队长要改的那六条的性质。
★ 证明链路：`state.members[0].role` ⇒ `snapshot.ts:368 role: member.role ?? ''` ⇒ 快照原样带出。
★ 而 client **轮询 `/state`** ⇒ **不需要重派成员、不需要重编译、不需要重启**。

### 5.4 ★★ 反向半边 C：`role` 改了，但 **persona 不会变**（主动证明）

```sh
$ grep -rn "memberPersona" src/ --include=*.ts
src/members.ts:532  export function memberPersona(...)      ← 定义
src/members.ts:634      persona: memberPersona(…)            ← ★ 唯一调用点（在 spawnMember 内）
$ sed -n '1898p' src/tools.ts
        if (member.id !== '') return deliverToMember(ctx, captain, member.id, text, signal, mode)
```
★ **同时可读的两个读数**：5.3 证明**面板变了**；本节证明**persona 不会再被调用**。
⇒ 「我改了什么」与「什么没跟着变」**分开说明**。

★ **C 是本任务最该留档的一条**：没有它，
**"改了但没生效"** 与 **"改了且按设计只生效一半"** 在报告里**同形**。

### 5.5 构建与净变化

```sh
$ npx tsc -p tsconfig.json --noEmit        # exit=0
$ npx tsc -p tsconfig.client.json --noEmit # exit=0
$ pnpm build                               # exit=0
$ pnpm test:gates                          # tests 1488 / pass 1430 / fail 20
$ comm -13 <(对照跑失败文件集) <(改动后失败文件集)   # 净新（空）
$ comm -23 <(对照跑失败文件集) <(改动后失败文件集)   # 净减少（空）
```
★ **净新 = 0、净减少 = 0**，**16 个失败文件逐条相同**（**对照跑判定**，不是记住的计数）。

---

## 6. ★ 附带：那六条中文**不会撑破布局**

`src/client/activity-model.ts:1825-1830` 的注释逐字：
> 「★ 为什么需要它：`role` 是自由文本（队长写进去的是 106–209 字符的英文长句），
>   **而将来它可以由成员定义给出中文**。中文字占 **2 列** ⇒
>   同样的字符数，中文占的宽度约两倍 ⇒ 用"字符数"判"放不放得下"会**判错**。」

⇒ ★★ **UI 侧已经为中文件过列宽适配**（`charColumns`，按**码元**累加而非 `character.length`）。
⇒ **那六条中文不会撑破布局**（t83 已带对拍臂）。

---

## 7. 局限（如实留白）

1. **成员自我认知不更新**（§3）：放行后，一个成员的 persona 里仍是**生成时**那句 role。
   ★ 这是**既存事实**，本次只是让它**第一次可见**。要让它跟着变，需要"给成员补一条通知"，
   而那个行为**在 t84 的验收面里测不到**（`deliverToMember` 改对没有，本任务无法证明）⇒
   队长已裁定**不在本轮做**；若要做，应**另立任务并带自己的反向半边**。
2. **没有端到端跑真实的 `edit_plan` 工具**：5.3 驱动的是**投影器**（`assembleTeamSnapshot`），
   而不是走 `edit_plan(update_member)` 的完整工具链。
   ★ 理由是那条链需要真实的 ctx/会话；而**闸门的分辨力**（5.1 四例）与**写入后的可读性**（5.3）
   分别在两侧各自钉住了。★ **中间那一段（工具 → team.json 的写盘）未在本次实测覆盖。**
3. **`provider` / `model` 的"变了"用 `trim` 后比较**：大小写不同视为不同（未做 case-insensitive）。
   ★ 我判断这是对的（模型 id 大小写敏感），但**未验证** `resolveMemberLlmSelection` 是否也这么看。
4. **`reasoningEffort` 从 `'high'` 改成 `undefined`**（清空）会被判为"变了" ⇒ 拒。
   ★ 这与 `model` 同族（都是冻进描述符的路由）⇒ 我**故意**让它拒，但这条**未在验收里单列**。

---

*本文件只写 `docs/ROLE-EDIT-FIX.md`。改动：`src/tools.ts`（+37/−1）及其 lib 产物与 stamp。*
