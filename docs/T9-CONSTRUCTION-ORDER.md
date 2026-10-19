# t9 施工单 —— `add_task` 不许静默造 `kind:'work'`

> 交付人：researcher（只读角色，**本文件不写任何 `src/`、`lib/`**）
> 落笔人：architect
> 依据：船长 m01601 裁决「选项 1（报错）」，以及本人 m01573 侦察 + 本轮实测
> 复跑方式：每一条读数下的 `$` 开头的命令都是可直接粘贴重跑的；读数取自 2026-10-20 的 `HEAD 0d1e2b4` 附近

---

## 0. 一句话

`src/tools.ts:2056` 把 `kind: 'work'` 硬编码，于是经 `edit_plan`/HTTP 计划路由加进来的任务**永远不会是 quality kind**，也就永远不需要质量契约 —— 而「这活根本没被人看过」这件事在数据上**不可见**。修法是：**缺 kind ⇒ 拒**，显式 quality kind ⇒ 走 `create_task` 同一条 `validateCreateTask`。

---

## 1. ★ 动工前必须知道的三条实测（否则会做错方向）

### 1.1 `add_task` 今天**根本传不进 kind** —— 宿主校验器直接拒

```
$ node --input-type=module -e "
const { toolDefinitions } = await import('./scripts/tool-definitions.mjs');
const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools');
const ep = (await toolDefinitions())['agent_teams_edit_plan'];
const check = (args) => validateJsonSchemaValue(ep.parameters, args, '');
for (const [l,a] of [
  ['A: 不带 kind   ', { operations:[{action:'add_task', subject:'x', dependencies:[]}] }],
  ['B: kind=work  ', { operations:[{action:'add_task', subject:'x', dependencies:[], kind:'work'}] }],
  ['C: kind=impl  ', { operations:[{action:'add_task', subject:'x', dependencies:[], kind:'implementation'}] }],
]) { const v = check(a); console.log(l, '=>', v.length===0 ? 'ACCEPTED' : 'REJECTED: '+v[0]); }
"
```
读数：
```
A: 不带 kind    => ACCEPTED
B: kind=work   => REJECTED: "operations[0].kind" is not a declared property (additionalProperties: false)
C: kind=impl   => REJECTED: "operations[0].kind" is not a declared property (additionalProperties: false)
```

★★ **这条推翻了「反向半边今天已经通」的假设。** 今天的 `add_task` **不是**"显式传 `kind:'work'` 能通"，而是**连传都传不进去**。`edit_plan` 的 item schema 里没有 `kind` 属性，而 `items.additionalProperties === false`：

```
$ node --input-type=module -e "
const { toolDefinitions } = await import('./scripts/tool-definitions.mjs');
const ep = (await toolDefinitions())['agent_teams_edit_plan'];
const it = ep.parameters.properties.operations.items;
console.log('properties      =', Object.keys(it.properties).join(','));
console.log('additionalProps =', it.additionalProperties);
"
```
```
properties      = action,assignee,dependencies,description,execution_prompt,member_name,model,provider,reasoning_effort,role,subject,task_id
additionalProps = false
```

⇒ **施工第 1 步必须是给 schema 加 `kind` 属性**，否则后面所有"显式声明"都是空话。验收第 3 条（反向半边）在**今天**是 `refuted`，不是 `confirmed` —— 它只有在 schema 加上 `kind` 之后才能被真正测。

### 1.2 HTTP 路由没有 kind 通道

```
$ grep -c "payload\['kind'\]" src/index.ts
0
```

`src/index.ts:585-598` 的 `add_task` 分支只读 `subject` / `dependencies` / `description` / `assignee`。⇒ 两个生产者（`edit-plan.ts` + `index.ts`）**必须同时改**，否则"计划路线"从 HTTP 进来仍然静默。

### 1.3 ★ 选项 1 落地后，`validateCreateTask` 对 `kind` 缺席是**放行**的

```
$ node --input-type=module -e "
const { validateCreateTask } = await import('./src/quality-gates.ts');
const team = { halted:false, tasks:[], members:[] };
for (const k of ['work','implementation','review', undefined, 'bogus']) {
  const r = validateCreateTask(team, { subject:'x', dependencies:[], kind:k });
  console.log(String(k).padEnd(16), '=>', r.ok ? 'OK' : 'REJECT: '+r.error);
}"
```
```
work             => OK
implementation   => REJECT: implementation tasks require a non-empty objective
review           => REJECT: review tasks require a non-empty objective
undefined        => OK          ← ★ 缺席仍是放行，`input.kind ?? 'work'` 那一行
bogus            => REJECT: unknown task kind "bogus"
```

⇒ **`validateCreateTask` 不能独自承担"缺 kind 必须拒"**。它内部第一行是 `const kind = input.kind ?? 'work'`（`src/quality-gates.ts:1000`）。这是**故意的**：它是运行时容错缺省，`taskKindOf` 同口径。

> ### ★★★ 2026-10-20 修订（船长 m01755 复核后改用途 —— 本节以上那句原文已过期）
>
> 本文初稿逐字写过：「`src/quality-gates.ts` 在 t9 的 outOfScope 里 ⇒ 拒绝必须落在调用点」。**那句现在是错的** —— 船长把 `src/quality-gates.ts` 移进 inScope，用途改成**收紧 `:1000` 的 `?? 'work'` 缺省**（t9 现在的 inScope 实测 18 条，含 `src/quality-gates.ts` 与 `lib/quality-gates.js`）。
>
> 把这段修订留在原地，是因为它正是本文件 §5.4 在讲的东西：**文档里的结论会自己过期，而过期方向偏向"可以少做一点"**。architect 按初稿施工会漏掉一层。
>
> ### 收紧 `:1000` 之前必须知道的三条实测
>
> **① `create_task` 的 `kind` 不是必填，而且它的描述明写了这个缺省。** `src/tools/create-task.ts:250-255`：
> ```ts
> kind: {
>   type: 'string',
>   enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
>   description: 'Explicit task kind. Omission means work with no quality gates, even if the subject says implementation/review. Quality kinds require a contract. …',
> },
> ```
> `required` 列表里**没有** `kind`（实测：`awk 'NR>=200 && NR<=340 && /required/'` 只抓到 `subject`）。⇒ 收紧 `:1000` 会把 `create_task` 这条**被文档承认的**缺省路径一起改掉。**那是行为变更，不是修 bug**，必须显式决定。
>
> **② 两条路由对"同样没声明"落盘形状本来就不同**（初稿 §3 漏了这一格）：
> ```
> $ node --input-type=module -e "
> const { makeTask } = await import('./src/tools/shared/entities.ts');
> const { taskKindOf } = await import('./src/quality-gates.ts');
> const viaCreate = makeTask({ id:'t1', subject:'x', dependencies:[] });
> const viaAdd    = makeTask({ id:'t2', subject:'x', dependencies:[], kind:'work' });
> for (const [l,t] of [['create_task (kind omitted)', viaCreate], ['add_task   (hardcoded work)', viaAdd]]) {
>   console.log(l.padEnd(30), '| kind key present =', String('kind' in t).padEnd(6), '| taskKindOf =', taskKindOf(t));
> }"
> ```
> ```
> create_task (kind omitted)     | kind key present = false  | taskKindOf = work
> add_task   (hardcoded work)    | kind key present = true   | taskKindOf = work
> ```
> ⇒ **`create_task` 今天已经在产出"键缺席"的任务**，而 `add_task` 硬编码反而产出"键在场"的。同一件事（没人声明 kind），两条路由落成两种形状。t9 若只改 `add_task`，这个不一致会留着。
>
> **③ 收紧后谁会被误伤 —— 差值化实测（245 条真实任务）**：
> ```
> $ node --input-type=module -e "
> const fs = await import('node:fs'), p = await import('node:path');
> const { validateCreateTask } = await import('./src/quality-gates.ts');
> const tightened = (team, input) => input.kind === undefined
>   ? { ok:false, error:'kind must be declared explicitly' } : validateCreateTask(team, input);
> let total=0, baselineReject=0, delta=[], nonTerminalDelta=[];
> for (const d of fs.readdirSync('.agent-teams')) {
>   const f = p.join('.agent-teams', d, 'team.json');
>   if (!fs.existsSync(f)) continue;
>   const t = JSON.parse(fs.readFileSync(f,'utf8'));
>   for (const task of (t.tasks||[])) {
>     total++;
>     const team = {...t, tasks:(t.tasks||[]).filter(x=>x.id!==task.id)};
>     const b = validateCreateTask(team, task).ok, g = tightened(team, task).ok;
>     if (!b) baselineReject++;
>     if (b && !g) { delta.push(d+'/'+task.id+' ('+task.status+')');
>       if (task.status!=='completed'&&task.status!=='failed') nonTerminalDelta.push(d+'/'+task.id); }
>   }
> }
> console.log('任务总数 =', total);
> console.log('基线就已经被拒的（非本改动造成） =', baselineReject);
> console.log('★ 本改动【新增】拒掉的 =', delta.length, '->', delta.join(', ') || '(none)');
> console.log('★ 其中非终态的（会被卡死） =', nonTerminalDelta.length, '->', nonTerminalDelta.join(', ') || '(none)');
> "
> ```
> ```
> 任务总数 = 245
> 基线就已经被拒的（非本改动造成） = 34
> ★ 本改动【新增】拒掉的 = 1 -> agent-teams-hardening/t1 (completed)
> ★ 其中非终态的（会被卡死） = 0 -> (none)
> ```
> ★★ **先做差值再下结论**：我第一次只数了"收紧后被拒 = 35"，那会把 34 条**与本改动无关**的既有拒绝算进来（分组后全是契约层的：`inScope overlaps t29/t30/t32/t35`、`the contract's file-level premises do not hold`）。真读数只有 **1** 条，且是**已完成**的历史任务 ⇒ **不回填、不卡流程**，与船长"历史不回填"的裁决一致。
>
> ⇒ **结论**：收紧 `:1000` 在数据上安全（新增拒绝 1 条、非终态 0 条），但它**同时改掉了 `create_task` 的已文档化缺省**。architect 必须做一个显式选择：
> - **(a)** `:1000` 只对"新调用方"收紧，`create_task` 显式传 `kind ?? 'work'` 保持原行为 —— 局部、风险 0，但两条路由的不一致留着；
> - **(b)** 全局收紧，同时改 `create_task` 的 schema（`kind` 加 `required: true`）+ 它的 description —— 干净，但那是一个**用户可见的行为变更**，且 `src/tools/create-task.ts` **不在** t9 的 inScope 里。
>
> ★ 我倾向 (a) 并把 (b) 记成后续缺陷，但这是**裁决不是读数**，留给船长和 architect。

---

## 2. 施工单（逐文件、逐行）

### 2.1 `src/tools/shared/entities.ts:254-260` —— 给 mutation 加 `kind` 格

现状（`:252-260`）：
```ts
  | {
      action: 'add_task'
      subject: string
      description?: string | null
      assignee?: string | null
      dependencies: string[]
    }
```
改成（`TaskKind` **已在本文件 import**，`:54` 逐字 `import type { …, TaskKind } from '../../types.ts'`，不需要新增 import）：
```ts
  | {
      action: 'add_task'
      subject: string
      description?: string | null
      assignee?: string | null
      dependencies: string[]
      /** ★ t9：显式声明的 kind。缺席 ⇒ 调用点拒绝，不许在这里补 'work'。 */
      kind?: TaskKind
    }
```

### 2.2 `src/tools/edit-plan.ts:137-155` —— schema 加 `kind` 属性

在 `dependencies` 那一行（`:149`）**之后**、`role`（`:150`）之前插入：
```ts
              kind: {
                type: 'string',
                enum: [...TASK_KINDS],
                description: 'Required for add_task: the task kind must be declared explicitly (no silent default). A quality kind additionally requires objective + acceptance; implementation/repair/integration also require inScope + verify.',
              },
```
★ `TASK_KINDS` 需要 import。本文件当前 `import type { TaskKind }` 之类的形状请按实际补；`TASK_KINDS` 是**值**不是类型（`src/types.ts:158` `export const TASK_KINDS: readonly TaskKind[] = […]`）。

★★ 还要加 `objective` / `acceptance` / `inScope` / `verify` 四格 —— **否则验收第 2 条无法满足**：显式声明 quality kind 时，`validateCreateTask` 会要求这四格，而 schema 传不进去，于是 quality kind 100% 被拒。四格形状照抄 `src/tools/create.ts:79-100` 的 `kind` / `objective` / `acceptance` / `inScope` / `verify` 声明（那一处已经是「整组放行」的既有先例，注释逐字说明了为什么必须整组）。

### 2.3 `src/tools/edit-plan.ts:257-320` —— mapper 透传，并让契约走 `contractRequirement` 真读 kind

现状 `:295`：
```ts
            const requirement = contractRequirement('work', {
              subject,
              description: operation.description,
              assignee: operation.assignee,
            })
```
★ 这一行是 t22 为了让"契约不需要"这件事有记录而写的，它**硬编码 `'work'`**，因为在 t22 的 scope 里 `add_task` 结构上就只有 work。t9 之后它能拿到真 kind 了。

改成（`kind` 来自 `operation.kind`，可能是 `undefined`）：
```ts
            const kind = operation.kind as TaskKind | undefined
            if (kind === undefined) {
              throw new Error(
                `${label} requires an explicit kind for add_task: ` +
                'the plan route must not silently create a "work" task. ' +
                'Declare kind (e.g. "work" for ordinary work, or a quality kind such as "implementation").',
              )
            }
            const requirement = contractRequirement(kind, {
              subject,
              description: operation.description,
              assignee: operation.assignee,
              objective: operation.objective,
              inScope: operation.inScope,
              acceptance: operation.acceptance,
              verify: operation.verify,
            })
```
★ **保留** `:304-318` 那段 `whyNoContract` 的写法与文案 —— 它在 `kind === 'work'`（`requirement.required.length === 0`）时仍然成立，t22 的推理没有被推翻。★ 但 `whyNoContract` 里那句 `'This task is kind "work"…'` 现在**只在 kind 真的是 work 时才写**，这正是它原本想要的语义。

`return` 的对象（`:315-320`）加上：`kind`、`objective`、`inScope`、`acceptance`、`verify`。

### 2.4 `src/index.ts:585` —— HTTP 路由同口径

现状只读 4 格。改成：
```ts
          } else if (action === 'add_task') {
            if (typeof payload['subject'] !== 'string') throw new Error('subject is required')
            if (typeof payload['kind'] !== 'string' || payload['kind'].trim() === '') {
              throw new Error('kind is required for add_task: the plan route must not silently create a "work" task')
            }
            mutation = {
              action,
              subject: payload['subject'],
              kind: payload['kind'] as TaskKind,
              dependencies,
              ...（description / assignee 原样保留）
              ...（objective / inScope / acceptance / verify 照 edit-plan 的口径收）
            }
          }
```
★ 两个生产者的拒绝**措辞可以不同**（一个是工具参数、一个是 HTTP），但**行为必须一致**：都拒。船长的裁决原话：「两个生产者反应必须一致，不许一个拒一个放」。

### 2.5 `src/tools.ts:2036-2060` —— 消费点：删硬编码，改走 `validateCreateTask`

现状 `:2056` 是 `kind: 'work',`。改成：
```ts
        } else if (mutation.action === 'add_task') {
          const subject = mutation.subject.trim()
          if (subject === '') throw new Error('task subject must not be empty')
          /**
           * ★ t9：kind 必须显式声明。这里**不再**补 'work' ——
           *   一条没人声明过类型的任务进来就是缺陷，不是缺省。
           */
          if (mutation.kind === undefined) {
            throw new Error('add_task requires an explicit kind: the plan route must not silently create a "work" task')
          }
          fresh.taskSeq += 1
          const nextId = `t${fresh.taskSeq}`
          const draft = {
            id: nextId,
            subject,
            description: trimmedOptional(mutation.description),
            assignee: trimmedOptional(mutation.assignee),
            dependencies: [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))],
            kind: mutation.kind,
            objective: mutation.objective ?? undefined,
            inScope: mutation.inScope ?? undefined,
            acceptance: mutation.acceptance ?? undefined,
            verify: mutation.verify ?? undefined,
          }
          /**
           * ★★ 验收第 2 条：走 create_task 的**同一条**校验，不许第二份。
           *   位置在 makeTask **之前** —— 与 create_task 同序。
           *   ★ 团队用 `{ ...fresh, tasks: fresh.tasks }`（新任务还没进去），
           *     因为 validateCreateTask 只看 input，不看 tasks 里有没有它。
           */
          const validation = validateCreateTask(fresh, draft as never)
          if (!validation.ok) throw new Error(validation.error)
          fresh.tasks.push(makeTask(draft))
        }
```

★★ **注意 `validateCreateTask` 的第二个参数是 `CreateTaskInput`，而 `draft` 多一个 `id`。** `create_task` 在 `src/tools/create-task.ts:531` 是**逐格列举**传的（不 spread）。建议照抄那种逐格形状，而不是 `draft as never`：

```ts
          const validation = validateCreateTask(fresh, {
            subject, description: draft.description, dependencies: draft.dependencies,
            assignee: draft.assignee, kind: mutation.kind,
            objective: mutation.objective ?? undefined,
            inScope: mutation.inScope ?? undefined,
            acceptance: mutation.acceptance ?? undefined,
            verify: mutation.verify ?? undefined,
          })
```

★ `validateCreateTask` **已经在 `src/tools.ts:48` import 过了**（`grep -n validateCreateTask src/tools.ts` ⇒ `48:  validateCreateTask,`），不需要新增 import。这很关键 —— 它证明这条校验本来就是"计划路线也该用"的。

### 2.6 产物：`lib/` 六个文件

`build` 会跑 `tsc` + `tsdown` + `git-artifacts.mjs`。★ 船长规矩逐字：`lib/client.js` / `lib/client.js.map` **必须回退**（`git checkout -- lib/client.js lib/client.js.map`），因为它们带构建机身份；其余 `lib/` 产物跟着源码走。

---

## 3. ★ 反向半边：今天 vs 改后，两个数必须同口径

船长的要求：「`add_task` 显式传 `kind:'work'` 今天是通的（因为硬编码），改后必须**仍然通**。你现在能测今天的基线读数，改后他测 —— 两个数同口径才有意义。」

★★ **而这一条的前提在 §1.1 已经被实测推翻。** 今天传不进去。所以口径应该是：

| 臂 | 今天（实测） | 改后（期望） | 判据 |
|---|---|---|---|
| A 缺 kind | schema **ACCEPTED**，落盘 `kind:"work"`（静默） | **REJECTED** | ★ 主判据 |
| B `kind:'work'` | schema **REJECTED**（`additionalProperties: false`） | **ACCEPTED** + 落盘 `kind:"work"` | ★ 反向半边 |
| C `kind:'implementation'` 带全契约 | schema **REJECTED** | **ACCEPTED** + 落盘 `kind:"implementation"` | 验收第 2 条 |
| D `kind:'implementation'` 缺 objective | schema **REJECTED** | **REJECTED**，且报文指名 `implementation tasks require a non-empty objective` | ★ 走同一条校验 |

★ **A 臂今天**的落盘证据（不能只看 schema）：

```
$ node --input-type=module -e "
const { makeTask } = await import('./src/tools/shared/entities.ts');
console.log('今天的 add_task 落盘形状 =', JSON.stringify(makeTask({ id:'t9', subject:'x', dependencies:[], kind:'work' })));
"
```
```
今天的 add_task 落盘形状 = {"id":"t9","subject":"x","status":"pending","dependencies":[],"attempt":0,"createdAt":…,"updatedAt":…,"kind":"work"}
```

⇒ 改后这条命令里的 `kind:'work'` **不该再出现在调用点**，而 `makeTask` 的行为不变。

---

## 4. 验收第 4 条（历史兼容）—— 今天就是绿的，改后必须仍绿

```
$ node -e "
const fs=require('fs'),p=require('path');
let n=0,bad=0;
for(const d of fs.readdirSync('.agent-teams')){
  const f=p.join('.agent-teams',d,'team.json'); if(!fs.existsSync(f))continue;
  n++; try{const t=JSON.parse(fs.readFileSync(f,'utf8'));console.log(d+': phase='+t.phase+' tasks='+(t.tasks||[]).length)}catch(e){bad++}
}
console.log('--- total='+n+' parse-failures='+bad);
"
```
读数（今天）：
```
agent-teams-hardening: phase=running tasks=39
agent-teams-refactor: phase=running tasks=106
mutation-cost: phase=staged tasks=3
mutation-quality: phase=running tasks=24
overnight-registration-hardening: phase=undefined tasks=10
self-iteration: phase=staged tasks=3
self-iteration-3: phase=undefined tasks=18
unified-pipeline: phase=running tasks=42
--- total=8 parse-failures=0
```

★ 历史里已有 **1 条无 kind 的任务**：`agent-teams-hardening/t1`（`status=completed`）。**不回填**，照常可读。校验只发生在**建**那一刻 —— 这正是"只校验新建"的意义，也是本条能绿的原因。

---

## 5. 两条我**没有**测到的事（不许当通过）

1. **`status.ts:876` 的三态改造今天不需要做**。船长 m01601 最初裁决里「半 B（让缺席可读）」在 options 1 下**不适用** —— 因为 option 1 不产生"缺席"状态（缺 kind 直接拒）。但若 architect 施工时选择了"落标记"而非"拒"，则必须补 `src/tools/status.ts:876` 三态，否则标记不可读。**我没有测 option 1 之外的分支。**

2. **`requires` 审计对 `task.kind` 缺席是盲的** —— 这条对 option 1 无影响（不产生缺席），但如果将来有人改回标记法，这条会咬人。实测：

```
$ node --input-type=module -e "
const { checkRequires } = await import('./src/gates/requires.ts');
const { registry } = await import('./src/gates/index.ts');
const g = (registry.list().completion||[]).find(x=>x.id==='completion.r5');
const base = { runTestOnRevision:()=>{}, scanDirs:[], parentRevision:'abc', update:{newTestFiles:[]}, wantsCompleted:true, taskNotTerminal:true };
const A = checkRequires(g, { ...base, task:{ id:'t1', kind:'work' } });
const B = checkRequires(g, { ...base, task:{ id:'t2' } });
console.log('skipReason A/B =', A.skipReason, '/', B.skipReason);
console.log('A.present 含 task.kind =', A.present.includes('task.kind'));
console.log('B.present 含 task.kind =', B.present.includes('task.kind'));
"
```
```
skipReason A/B = not-applicable / not-applicable
A.present 含 task.kind = true
B.present 含 task.kind = false
```
⇒ **`skipReason` 两侧相同，但 `present` 列表不同**（`task.kind` 在 B 里消失）。而决定 `skipReason` 的是 `derivedGateCells`，它对 `task.kind` 这类**字符串枚举格故意不探**（`src/gates/requires.ts:615-621` 逐字：「`task.kind` 这一类**故意不探字符串**……⇒ 这一类如实**推不出来**（少报），而不是猜一个」）。**所以"标记在场"与"标记可读"在这条链上是两件事。**

### 5.3 ★★★ 决定性的一条：`kind` 缺席与 `kind:'work'` 在完工位置**读数完全同形**

这条是给"标记法"钉死的最后一根钉子 —— 我用**真表**（`src/gates/completion/kind-requirements.json`，实测覆盖全部 7 个 kind：`implementation, integration, repair, requirements, review, verification, work`）跑位置级 `evaluate`：

```
$ node --input-type=module -e "
const { registry } = await import('./src/gates/index.ts');
const { parseKindRequirements } = await import('./src/gates/completion/kind-requirements.ts');
const fs = await import('node:fs');
const load = () => parseKindRequirements(JSON.parse(fs.readFileSync('src/gates/completion/kind-requirements.json','utf8')));
const base = { runTestOnRevision:()=>{}, scanDirs:[], parentRevision:'abc', update:{newTestFiles:[]}, wantsCompleted:true, taskNotTerminal:true };
for (const kind of ['implementation','work','verification','review', undefined]) {
  const r = await registry.evaluate('completion', { ...base, task:{ id:'t', kind }, loadKindRequirements: load });
  console.log(String(kind).padEnd(16), 'ok='+String(r.ok).padEnd(6), 'blockers='+(r.blockers||[]).length,
    'unmeasured='+(Array.isArray(r.unmeasured)?r.unmeasured.length:JSON.stringify(r.unmeasured)),
    'evaluated='+r.evaluated, 'skipped='+r.skipped);
}"
```
读数：
```
implementation   ok=false  blockers=0 unmeasured="[completion.r5] R5 could not locate the new test files: none of the 0 reported file(s) resolve to a test path inside []; [completion.mutation] mutation testing is unavailable (no readFile / runTest / writeFile injected), so whether the delivered tests detect a broken implementation could not be measured" evaluated=2 skipped=2
work             ok=false  blockers=0 unmeasured=undefined evaluated=0 skipped=4
verification     ok=false  blockers=0 unmeasured=undefined evaluated=0 skipped=4
review           ok=false  blockers=0 unmeasured=undefined evaluated=0 skipped=4
undefined        ok=false  blockers=0 unmeasured=undefined evaluated=0 skipped=4   ← ★ 标记法落在这里
```

★★ **`work` / `verification` / `review` / `undefined` 四行逐字相同。** 也就是说：如果 t9 选择"删掉硬编码、让 `kind` 键缺席"（标记法），那么一个**没人声明过类型的任务**与一个**明写了 `kind:'work'` 的任务**，在完工位置上的读数**一个字都不差** —— `ok=false, blockers=0, unmeasured=undefined, evaluated=0, skipped=4`。

⇒ 标记在**裁决面**上零信息量。这正是船长 m01601 推翻自己上一次裁决的实测依据，而这条读数把它从"推理"变成了"数字"。

### 5.4 位置级为何吞掉判据层的 `unmeasured`（仓库自己承认，非我新发现）

同一条 `r5`，两条路径两个答案：

```
$ node --input-type=module -e "
const { registry } = await import('./src/gates/index.ts');
const { gate } = await import('./src/gates/completion/r5.ts');
const base = { runTestOnRevision:()=>{}, scanDirs:[], parentRevision:'abc', update:{newTestFiles:[]}, wantsCompleted:true, taskNotTerminal:true };
const byKind = new Map([['implementation', { requiredGates:['completion.r5'], because:'x' }]]);
const load = () => ({ status:'loaded', requirements:{ byKind, knownKinds:['implementation'] } });
for (const [label, kind] of [['work (表里没有)', 'work'], ['kind ABSENT', undefined]]) {
  const ctx = { ...base, task:{ id:'t', kind }, loadKindRequirements: load };
  const r = await registry.evaluate('completion', ctx);
  const g = await gate(ctx);
  console.log(label.padEnd(18), '| registry: skipped='+r.skipped+' evaluated='+r.evaluated+
    ' | r5.gate(): unmeasured='+(typeof g.unmeasured === 'string' ? 'YES' : 'no'));
}"
```
```
work (表里没有)        | registry: skipped=4 evaluated=0 | r5.gate(): unmeasured=YES
kind ABSENT        | registry: skipped=4 evaluated=0 | r5.gate(): unmeasured=YES
```

成因在 `src/gates/registry.ts:735`：
```js
if (typeof reg.appliesTo === 'function' && reg.appliesTo(context) !== true) {
  skipped += 1
  ran.push({ id: reg.id, verdict: 'skipped' })
```
而 `src/gates/completion/r5.ts:134` 是 `if (requirement.status !== 'required') return false` —— **`appliesTo` 在表不可用时返回 false，于是 `gate()` 根本不进，那个 `unmeasured` 分支成了 registry 路由上的不可达代码。**

★ 这条 `registry.ts` 自己写在 `:905-935`，逐字：「判据层**是对的**：三条门各自在表不可用时报 `unmeasured`；而位置级把那个 `unmeasured` **吞掉了** —— `appliesTo` 返回 false ⇒ 门**根本不进 `gate()`** ⇒ 位置级看到的是"四条都 skipped" ⇒ 报 ok。」★ 而那段注释描述的 `ok: true` **今天已经不成立**：`:1044` 现在是 `if (allSkippedVerdict) { return { ok: false, … } }`。实测四行全是 `ok=false`。

⇒ **注释比代码旧了一步，而旧的方向是"乐观"。** 这不是 t9 要修的，但它决定了 t9 的验收该怎么读：**"完工位置报 ok"不能当作"这条任务被检查过"的证据**，因为 `work` / `verification` / `review` / 缺席 四者都是 `ok=false` 且 `evaluated=0`。

---

## 6. 施工顺序建议（避开热文件冲突）

```
① entities.ts (:254)                — 只加一格类型，最小面
② edit-plan.ts (:137 schema, :257 mapper)
③ index.ts (:585)
④ tools.ts (:2036 消费点)
⑤ pnpm typecheck                    — 必须 exit 0
⑥ pnpm build + 回退 lib/client.js*
⑦ 四条臂实测（§3 表）+ 验收第 4 条重跑
```
★ ① 与 ④ 分别在 `entities.ts` / `tools.ts`，两者都在团队的**单车道热文件**里 —— 按船长的派工顺序串行，不要同时开。
