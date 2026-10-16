# 缺陷：已完成任务的**历史 assignee** 挡住了整个 `edit_plan`（2026-10-16）

> **队长在为六个成员改中文角色时撞上** —— 而那件事**与任务图毫无关系**。

---

## 1. 现象

`agent_teams_edit_plan`（改一个成员的角色）被拒:
```
task "t15" assignee "reviewer" is not an active member
```

★ **`t15` 是【已完成】的任务,而 `reviewer` 是一个早已删除的成员。**

---

## 2. 根因（`src/tools.ts:492-503`）

```ts
function validateStagedGraph(team: TeamState, requireRunnable: boolean): void {
  const members = team.members.filter((member) => member.status !== 'removed')
  const memberNames = new Set(members.map((member) => member.name))
  for (const task of team.tasks) {                    // ★ 遍历【全部】任务
    if (task.assignee !== undefined && task.assignee !== CAPTAIN_KEY
        && !memberNames.has(task.assignee)) {
      throw new Error(`task "${task.id}" assignee "${task.assignee}" is not an active member`)
    }
```

**调用点**：`src/tools.ts:2063` —— 它在 **`edit_plan` 的所有编辑之后**跑：
```ts
validateStagedGraph(fresh, false)
```

⇒ ★★ **所以任何 `edit_plan`（含"改一个成员的角色"）都会被一条【与它无关】的历史记录挡住。**

---

## 3. 影响面（队长实测 `.agent-teams/agent-teams-refactor/team.json`）

```
已完成任务里 assignee 已删除的:
  reviewer         2 个（均 completed）
  route-probe-hy4  1 个（completed）
  route-probe-glm2 1 个（completed）
⇒ ★ 4 条历史记录 ⇒ 整个 edit_plan 不可用
```

---

## 4. 为什么它到现在才被撞上

★ **因为此前没人需要改【已生成成员】的数据** ——
t84 之前,`update_member` 对已生成成员**一律拒绝**,所以那条路径根本走不到这一步。

⇒ ★★ **t84 打开了那条路,才让这个既存缺陷变得可观测。**
（这与 t84 自己那句"**两类字段被同一条闸门挡住,所以区别从来不可观测**"是同一个形状。）

---

## 5. 修法（两条,选一）

### **(甲) 让校验只看【非终态】任务**

```ts
for (const task of team.tasks) {
  if (TERMINAL_TASK_STATUSES.includes(task.status)) continue   // ★ 已完成/取消的历史不再校验
  ...
}
```
★ 理由:**终端任务的 assignee 是历史事实**,而不是"待执行的引用"。
★ 而"引用要能解析"这条纪律,只对**还会被派发**的任务需要。

### **(乙) 只在 `requireRunnable === true` 时校验 assignee**

⚠️ 但那会让 `add_task` 时**不校验**新任务的 assignee —— 那**更危险**。

⇒ ★★ **必须 (甲)**:只跳过**终端**任务,非终态仍严格校验。

---

## 6. 反向半边（必须）

**A**：一个**非终态**任务的 assignee 不存在 ⇒ ★ **必须仍被拒**
（"跳过历史"不许变成"跳过一切"）
**B**：一个**已完成**任务的 assignee 不存在 ⇒ ★ **不许挡住** `edit_plan`
**C**：★ **`TERMINAL_TASK_STATUSES` 必须是那个既有的常量**,不许另写一份字面量
（否则两处会漂移 —— 本仓记账过的形态）

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
