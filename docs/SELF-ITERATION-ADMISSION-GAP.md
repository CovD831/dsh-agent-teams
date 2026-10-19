# G4：`admission` 三条判据生产求值点仍然是 0 —— 只读勘查与定案（2026-10-20）

> ★★ **本文是勘查，不是实现。本轮 `src/`、`lib/`、`scripts/` 一个字节都没改。**
> 本文回答的是计划 N5.4 留下的那个问题：**approve 那一刻，`upstream` 与 `producedDocuments`
> 该从哪里来？** 答案写在 §6 的「本轮不做」里 —— 而理由是实测出来的，不是猜的。

**写域**：只有 `docs/SELF-ITERATION-ADMISSION-GAP.md` 这一个文件。`git status --short` 见 §9。

**环境**：`node v26.5.0`（直跑 `.ts`），HEAD `ad5be83109cfa0347623492463f1733b1029dde6`。

---

## 0. ★★★ 一页纸结论

| 问题 | 实测答案 |
|---|---|
| 三条判据注册了吗？ | ✅ 注册了，`registry.count('admission') === 3` |
| 生产路径求值过一次吗？ | ❌ **零次**。`grep -rn "evaluate('admission'" src/` ⇒ 零命中 |
| 直接接上会怎样？ | ★ **每一次批准都落 `ok:false`**，且 `blockers` 是**空数组**（§2） |
| 卡在哪几格？ | **不是 2 格，是 4 格**：`producedDocuments` / `upstream` / `documents`+`currentRevisions`+`reviewedRevisions`+`observedDocumentWrites` / `absorb`+`observedDocumentChanged`+`documentsRead`+`producedContent`。外加 `openQuestions`。**全仓零生产写入方**（§3） |
| 30 个历史团队会怎样？ | 朴素接法 ⇒ **22 个落 `blocked`（假红）**；诚实接法 ⇒ **30 个落 `unmeasured`（真「没测到」）**；**一个都不会 `ok`**（§5） |
| 有没有安全接法？ | ✅ 有，**观察模式**：`ok:true` 全部 30 个，但**把发现记进 `observed`** —— 30/30 都记了（§6 方案 D） |
| 本轮做吗？ | ❌ **不做**。理由见 §7 —— 不是"太难"，是**它现在接上去只能测到一个空仓库** |

---

## 1. 复现那条陷阱（逐字原文）

★ 这是计划 N5.4 点名的那一条。命令可直接粘贴复跑：

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', {}); console.log('ok =', r.ok); console.log('blockers =', JSON.stringify(r.blockers)); console.log('unmeasured =', r.unmeasured); console.log('ran =', JSON.stringify(r.ran.map(x => [x.id, x.verdict])))"
```

**原文输出（逐字，exit 0）**：

```
ok = false
blockers = []
unmeasured = [admission.convene] the verdicts of the gates that must run before a team can convene (the review checkpoint and the absorption check) were not provided, so "has the loop run long enough" could not be measured — this is "not measured", not "the loop is done"
ran = [["admission.absorb","skipped"],["admission.checkpoint","skipped"],["admission.convene","unmeasured"]]
```

★★★ **要害是 `ok:false` 与 `blockers:[]` 同时成立**：

```
一个只读 `ok` 的调用方      ⇒ 看到「拒绝」
一个只读 `blockers` 的调用方 ⇒ 看到「无话可说」
```

**两种读法都"没错"，而它们是相反的结论。** 这就是为什么 N5 不是"把 admission 接上"一句话 ——
接上之后，`approve` 会在**每一次**批准时拿到一个 `ok:false`，而它的 `blockers` 是空的，
于是**任何"列出被什么挡住了"的日志都是空的**，而团队就是成不了团。

三条判据**没有一条真的说话了**：`absorb` skipped（没有 `absorb.claims`）、
`checkpoint` skipped（没有 `documents`）、`convene` unmeasured（缺 `upstream`）。

### 1.1 完整裁决（含输入面核对，逐字）

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', {}); console.log(JSON.stringify({ok:r.ok,blockers:r.blockers,unmeasured:r.unmeasured,evaluated:r.evaluated,skipped:r.skipped,registered:r.registered,requires:r.requires}, null, 2))"
```

```json
{
  "ok": false,
  "blockers": [],
  "unmeasured": "[admission.convene] the verdicts of the gates that must run before a team can convene (the review checkpoint and the absorption check) were not provided, so \"has the loop run long enough\" could not be measured — this is \"not measured\", not \"the loop is done\"",
  "evaluated": 1,
  "skipped": 2,
  "registered": 3,
  "requires": {
    "checked": 1,
    "incomplete": 1,
    "skipped": 2,
    "notApplicable": 1,
    "inputSurfaceAbsent": 1,
    "gateCellsUndeclared": [],
    "missing": [
      "[admission.convene] declares 2 ctx path(s) that this context does not carry: producedDocuments, upstream"
    ],
    "checks": [
      {
        "id": "admission.absorb",
        "status": "skipped",
        "skipReason": "not-applicable",
        "missing": [],
        "present": [],
        "gateCells": [],
        "skippedBecause": "appliesTo(context) read its own gating cells and concluded this gate does not speak for this context"
      },
      {
        "id": "admission.checkpoint",
        "status": "skipped",
        "skipReason": "input-surface-absent",
        "missing": [],
        "present": [],
        "gateCells": ["documents"],
        "skippedBecause": "this gate reached \"not applicable\" using a gating cell that the context does not carry (documents): the verdict is about THIS ROUND being inapplicable, not about the gate being silent because a wiring is missing (nothing is blocked — a gate that is not meant to run must not raise an alarm)"
      },
      {
        "id": "admission.convene",
        "status": "incomplete",
        "missing": ["producedDocuments", "upstream"],
        "present": [],
        "gateCells": ["producedDocuments", "upstream"]
      }
    ]
  }
}
```

★ 顺带一个**只在这一格里读得到**的事实：`inputSurfaceAbsent: 1`。
`checkpoint` 是被"输入面缺席"挡住的，而 `absorb` 是 `not-applicable`（按设计闭嘴）。
**两者被分开计数**（`registry.ts` 的 t11 修）—— 于是"没接线"与"这条判据这一轮不说话"不同形。
★ 但注意 `convene` 的 `appliesTo` **恒 `true`**，所以它**永远不会**落进
`inputSurfaceAbsent` —— 它的缺席只能从 `status: 'incomplete'` 读出来。

---

## 2. 为什么"直接接上"是量过的陷阱，不是担心

★ 计划 N5.4 已经预言了这条。本节把它做成**可复跑**的。

`src/tools.ts:2143-2190` 的 `approveStagedTeam` 里，**没有一个 `registry.evaluate` 调用**：

```sh
grep -rn "evaluate('admission'" src/
```

```
（零命中，exit 1）
```

⇒ 若把 `await registry.evaluate('admission', {})` 直接塞进 `approveStagedTeam`，
**每一次 approve 都会拿到 §1 那个 `ok:false`**。这不是"可能会"，是 §1 已经跑出来的读数：
**输入是 `{}`，输出是 `ok:false`**，而 `approveStagedTeam` 的输入**恰好**就是这个形状
（它在那一刻**没有**任何产物清单、没有任何上游裁决、没有任何审查记录）。

---

## 3. ★★★ 查清那几格：全仓有没有生产写入方

★ 任务书点名两格（`producedDocuments` / `upstream`）。实测**不止两格** —— 是 **4 组 10 格**。
下面每一行都是**可直接复跑**的命令，并附**零命中的原文**。

### 3.1 逐格计数（一条命令数全部）

```sh
for cell in producedDocuments documents currentRevisions reviewedRevisions observedDocumentWrites upstream openQuestions absorb; do
  n=$(grep -rn "\b$cell\b" src/ --include=*.ts | grep -v "^src/gates/admission/" | wc -l | tr -d ' ')
  echo "$cell outside admission: $n"
done
```

**原文输出**：

```
producedDocuments outside admission: 0
documents outside admission: 0
currentRevisions outside admission: 0
reviewedRevisions outside admission: 0
observedDocumentWrites outside admission: 0
upstream outside admission: 9
openQuestions outside admission: 0
absorb outside admission: 5
```

★ 唯一两个非零的是 `upstream`(9) 与 `absorb`(5) —— **它们全是别的概念**，下面逐条证明。

### 3.2 `producedDocuments`：零命中

```sh
grep -rn "producedDocuments" src/ --include=*.ts | grep -v "^src/gates/admission/"
echo "(exit $?)"
```

```
(exit 1)
```

⇒ **全仓没有任何生产写入方。** 它只出现在 `src/gates/admission/` 的三个文件里：
`absorb.ts`（8 处）、`checkpoint.ts:139`（注释）、`convene.ts`（9 处）。

### 3.3 `upstream`：9 条命中，**没有一条**是"组装 admission 的 upstream"

```sh
grep -rn "\bupstream\b" src/ --include=*.ts | grep -v "^src/gates/admission/"
```

**原文输出（逐字，全部 9 条）**：

```
src/harness-compat.ts:26: * stable symbol and call signature as upstream queueHostSubagentPrompt.
src/quality-gates.ts:1202:    const upstream = team.tasks.find((item) => item.id === dependency)
src/quality-gates.ts:1203:    if (upstream === undefined) {
src/quality-gates.ts:1206:    if ((kind === 'repair' || kind === 'review') && (upstream.status === 'failed' || upstream.status === 'cancelled')) {
src/quality-gates.ts:1207:      return { ok: false, error: `${kind} must not depend on ${upstream.status} task "${dependency}"` }
src/quality-gates.ts:1804: * Root cause (upstream #174, verbatim): "Auto-generated repair work orders were
src/mutation.ts:16: *   混装了 4 件事；而它是 **fork 全新文件**（上游 `upstream/main` 上 ABSENT）
src/members.ts:928: * upstream seam exposes no targeted forget/retire method. The durable
src/client/activity-model.ts:1155: * Return the complete upstream/downstream chain around one task.
```

逐条判读 —— **每一条都是另一个概念**：

| 位置 | 它是什么 | 为什么**不是** admission 的 `upstream` |
|---|---|---|
| `harness-compat.ts:26` | 上游 DSH 的符号名 | 注释，讲 API 兼容 |
| `quality-gates.ts:1202-1207` | ★ **局部变量** `const upstream = team.tasks.find(...)` | 它是个 **`TeamTask`**（有 `.status`），而 admission 要的是 `Record<gateId, GateVerdictLike>`。★ **同名不同型** —— 这正是"读错引用"的经典入口 |
| `quality-gates.ts:1804` | 上游 issue 编号 #174 | 注释 |
| `mutation.ts:16` | git 分支 `upstream/main` | 注释 |
| `members.ts:928` | 上游 seam API | 注释 |
| `client/activity-model.ts:1155` | 任务的上游/下游链 | 前端模型，且方向相反（任务依赖） |

★ 更严格的那条（只数**被当成键或对象属性**写的）也是零命中：

```sh
grep -rnE "upstream\s*[:,]" src/ --include=*.ts | grep -v "^src/gates/admission/"
echo "(exit $?)"
```

```
(exit 1)
```

⇒ **没有任何代码"组装 admission 的 upstream"。**

### 3.4 其余四格：全部零命中

```sh
for cell in reviewedRevisions observedDocumentWrites currentRevisions openQuestions; do
  printf '%s: ' "$cell"; grep -rn "$cell" src/ --include=*.ts | grep -v "^src/gates/admission/" | wc -l | tr -d ' '
done
```

```
reviewedRevisions: 0
observedDocumentWrites: 0
currentRevisions: 0
openQuestions: 0
```

`absorb`（5 条）同样全是别的东西：`src/gates/contract/task-atomicity.ts:43`（注释里的团队名），
`src/gates/index.ts:288,293,296,470`（**import 与装配**，是接线不是生产写入方）。

⇒ ★★★ **`absorb.claims` 从来没有一个生产者**：

```sh
grep -rn "claims:" src/ --include=*.ts | grep -v "^src/gates/admission/"
echo "(exit $?)"
```

```
(exit 1)
```

⇒ `admission.absorb` 的 `appliesTo` 读 `ctx.absorb.claims`，而**那一格永远是 `undefined`**
⇒ 这条判据在**每一个**真实 ctx 上都恒 `skipped`。**它注册了，但它在生产上永远不会说话。**

### 3.5 三条判据声明的输入面（一张表看完）

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); for (const g of registry.list().admission) console.log(g.id.padEnd(22), JSON.stringify(g.requires))"
```

```
admission.absorb       ["observedDocumentChanged","documentsRead","producedDocuments"]
admission.checkpoint   ["documents","currentRevisions","reviewedRevisions","observedDocumentWrites"]
admission.convene      ["producedDocuments","upstream"]
```

**9 个格位（去重后 8 个），生产写入方 0 个。** 外加 `convene` 还读两个**没进 requires** 的格子
（判据自己的注释解释了为什么：它们的缺席必须由判据读成 unmeasured，而不是由核对层报 missing）：

| 格 | 声明在 requires 里 | 生产写入方 |
|---|---|---|
| `producedDocuments` | absorb + convene | **0** |
| `documents` | checkpoint | **0** |
| `currentRevisions` | checkpoint | **0** |
| `reviewedRevisions` | checkpoint | **0** |
| `observedDocumentWrites` | checkpoint | **0** |
| `upstream` | convene | **0** |
| `observedDocumentChanged` | absorb | **0** |
| `documentsRead` | absorb | **0** |
| `producedContent` | （未声明） | **0** |
| `absorb.claims` | （是闸门，故不声明） | **0** |
| `openQuestions` | （未声明） | **0** |

★ 另一半同样成立：`open-questions.json` **在整台机器上一份都不存在**。
★ 注意用 `| wc -l` 数，**不要靠 `find` 的退出码** —— `find` 没找到东西时仍然 exit 0，
`(exit 1)` 会被读成"命令失败了"（我第一次就跑错了这一格，见 §10 末行）：

```sh
find . -name "open-questions.json" -not -path "./node_modules/*" | wc -l | tr -d ' '
```

```
0
```

⇒ 条件 ③ 的证据**不是"没人读"，是"根本没有这张表"**。
（★ 注意 `src/` 里有 1 个文件**提到** `open-questions` 这个名字 —— 那是
`convene` 读它的注释与实现，不是生产者；见 §3.4。）

---

## 4. ★★ 一条只在装配处才会犯的错：`[]` 与"缺席"同形

三条判据的注释**反复**写着同一条纪律：`undefined`（没观察到）与 `[]`（观察了、确实是空）
**必须不同形**。这不是风格问题 —— 实测它的代价。

★ 先把这条纪律的**正面**跑出来（`[]` 与缺席给出**不同**的裁决，这是判据做对的地方）：

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', {producedDocuments:[], documents:[], currentRevisions:{}, observedDocumentWrites:[]}); console.log(JSON.stringify({ok:r.ok, blockers:r.blockers, unmeasured:r.unmeasured}, null, 1))"
```

```
{
 "ok": false,
 "blockers": [],
 "unmeasured": "[admission.checkpoint] the git revision the documents were last reviewed at could not be observed (reviewedRevisions was not provided), so \"has the artefact moved since the review\" could not be measured — this is \"not measured\", not \"unchanged\"; [admission.convene] the verdicts of the gates that must run before a team can convene (the review checkpoint and the absorption check) were not provided, so \"has the loop run long enough\" could not be measured — this is \"not measured\", not \"the loop is done\""
}
```

⇒ `[]` 让全局是 `unmeasured`（诚实），**不是** `blocked`。
★ 因为 `convene` 的条件 ① 只有在**上游给齐之后**才轮得到被读（§6 的两趟结构）。
下面这一条才是那个代价。

### 4.1 ★★★ 假红：一条 `[]` 兜底的 blocker，会把"没人接线"写成"这个团队没有产物"

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', {producedDocuments:[], documents:['docs/REQUIREMENTS.md'], currentRevisions:{'docs/REQUIREMENTS.md':'aaa'}, reviewedRevisions:{'docs/REQUIREMENTS.md':'aaa'}, observedDocumentWrites:[], upstream:{'admission.checkpoint':{ok:true},'admission.absorb':{ok:true}}}); console.log('ok =', r.ok); console.log('blockers =', JSON.stringify(r.blockers, null, 1)); console.log('unmeasured =', r.unmeasured)"
```

**原文输出（逐字）**：

```
ok = false
blockers = [
 "[admission.convene] condition ①: this run declares NO requirement/plan document at all — there is no artefact for a team to work from, so convening one now would be convening it on nothing",
 "[admission.convene] (separately, 1 of the three condition(s) could not be measured: condition ③: the pending questions for this run could not be observed at all (no open-questions.json observation was injected), so \"no unanswered question is waiting on the user\" could not be measured — nobody wired this grid up, which is not the same as \"the questions are all answered\")"
]
unmeasured = undefined
```

★★ 注意第二条 blocker 的措辞里，判据**自己**把这件事说清楚了：
> **"nobody wired this grid up, which is not the same as ..."**

⇒ 判据**知道**自己在报"没接线"，但它只能把这句话塞进**同一条 `blocker` 数组**里。
而 ★ **第一条**（condition ①）读起来是**"这个 run 一份产物都没有"** —— 那是**对团队的指控**。
**两条并列在同一个 `blockers[]` 里，读者无法区分哪条该回去写文档、哪条该回去接线。**

★★ 而这个错误**很容易犯**，因为一个诚实的工程师会这么写：

```js
const docs = tasks.flatMap(t => t.inScope).filter(p => p.startsWith('docs/')).filter(p => fs.existsSync(p))
// docs 是 [] —— 传还是不传？
registry.evaluate('admission', { producedDocuments: docs, documents: docs, ... })
```

**传 `[]` ⇒ 一条像样的假红；不传 ⇒ 诚实的「没测到」。** 实测代价见 §5.2 的 B 行：
**22 个团队从 `unmeasured` 变成 `blocked`。**

---

## 5. ★★★ 会让多少历史团队通不过（实测，不是估算）

### 5.1 分母：盘上有 30 个团队

```sh
node -e "const fs=require('fs'),p=require('path');const f=[];(function w(d,n){if(n>3)return;let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}for(const x of e){const q=p.join(d,x.name);if(x.isDirectory()){if(x.name==='worktrees'||x.name==='inbox')continue;w(q,n+1)}else if(x.name==='team.json')f.push(q)}})('.agent-teams',0);console.log('team.json files:',f.length)"
```

```
team.json files: 30
```

★ **没有一个是"运行在 admission 之后的"** —— `admitted`（被 admit 过）这个概念在
`TeamState` 里**不存在**。`TeamState` 的 phase 只有 `staged` / `running` / …，
而 `approvedAt` 存在 11 个团队上、`phase: 'staged'` 有 6 个。

### 5.2 四种接法的实测读数

命令（完整可复跑的探针，读全部 30 个团队）：

```sh
node --input-type=module -e "
import { registry } from './src/gates/index.ts'
import fs from 'node:fs'
const files=[]
;(function w(d,n){if(n>3)return;let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}
 for(const x of e){const q=d+'/'+x.name;if(x.isDirectory()){if(x.name==='worktrees'||x.name==='inbox')continue;w(q,n+1)}else if(x.name==='team.json')files.push(q)}})('.agent-teams',0)
function up(ev){const o={};for(const e of ev.ran){if(e.verdict==='skipped')continue
 if(e.verdict==='ok')o[e.id]={ok:true}
 else if(e.verdict==='blocked')o[e.id]={ok:false,blockers:ev.blockers.filter(b=>b.startsWith('['+e.id+'] '))}
 else o[e.id]={ok:false,unmeasured:e.reason??''}}return o}
function tally(r){return r.blockers.length?'blocked':(r.ok?'ok':'unmeasured')}
const A={},B={},C={},D={}
for(const f of files){let t;try{t=JSON.parse(fs.readFileSync(f,'utf8'))}catch{continue}
 const s=new Set();for(const x of (t.tasks||[]))for(const p of (x.inScope||[]))if(typeof p==='string'&&p.startsWith('docs/'))s.add(p)
 const ex=[...s].filter(p=>fs.existsSync(p))
 const naive={task:{kind:'work'},team:{id:t.id},producedDocuments:ex,documents:ex,currentRevisions:{},observedDocumentWrites:[]}
 const honest=ex.length>0?naive:{task:{kind:'work'},team:{id:t.id}}
 const a=await registry.evaluate('admission',naive);A[tally(a)]=(A[tally(a)]||0)+1
 const b=await registry.evaluate('admission',{...naive,upstream:up(a)});B[tally(b)]=(B[tally(b)]||0)+1
 const c=await registry.evaluate('admission',honest);C[tally(c)]=(C[tally(c)]||0)+1
 const d=await registry.evaluate('admission',{...honest,upstream:up(c)});D[tally(d)]=(D[tally(d)]||0)+1
}
console.log('A naive  []-filled, 1 pass:',JSON.stringify(A))
console.log('B naive  []-filled + upstream:',JSON.stringify(B))
console.log('C honest omitted, 1 pass:',JSON.stringify(C))
console.log('D honest omitted + upstream:',JSON.stringify(D))
"
```

**原文输出（本文件存在之后，2026-10-20 复跑）**：

```
A naive  []-filled, 1 pass: {"unmeasured":30}
B naive  []-filled + upstream: {"unmeasured":8,"blocked":22}
C honest omitted, 1 pass: {"unmeasured":30}
D honest omitted + upstream: {"unmeasured":30}
```

★★★ **这就是那张表**：

| 接法 | `ok` | `blocked`（假红） | `unmeasured`（真「没测到」） |
|---|---|---|---|
| **A** 朴素、单趟、**不注入 upstream** | **0** | 0 | **30** |
| **B** 朴素 + 两趟重建 upstream | **0** | ★ **22** | 8 |
| **C** 诚实省略 + 单趟 | **0** | 0 | **30** |
| **D** 诚实省略 + 两趟重建 | **0** | **0** | **30** |

★ **一个都不会 `ok`。** 而 B 那 22 个 `blocked` **全是假的** —— 原因是那些团队的
`inScope` 里**没有可解析的 `docs/` 路径**，于是 `producedDocuments` 变成 `[]`，
`convene` 条件 ① 报"这个 run 一份产物都没有"。**而真相是"这些团队的产物在哪，没人记录过"。**

### 5.2.1 ★★★ 这篇文档自己改变了这个读数（23 → 22），而这是可证明的

★ 同一条命令在**本文件被创建之前**跑，B 行是 `{"blocked":23,"unmeasured":7}`。
现在变成 `{"blocked":22,"unmeasured":8}`。**差值不是噪声，是我自己写的这个文件。**

原因是 `.agent-teams/self-iteration-3/team.json` 的某个 task 的 `inScope` 里写着
`docs/SELF-ITERATION-ADMISSION-GAP.md` —— 在本文件存在之前，那格**声明了但盘上没有**
⇒ 该团队落进"没有可解析产物"的桶（⇒ 假 `blocked`）。
本文件一落盘，它就有了 1 个可解析产物 ⇒ 从 `blocked` 挪到 `unmeasured`。

证明（把 `self-iteration-3` 排除后重跑 B，个数必须回到 23）：

```sh
node --input-type=module -e "
import { registry } from './src/gates/index.ts'
import fs from 'node:fs'
const files=[]
;(function w(d,n){if(n>3)return;let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}
 for(const x of e){const q=d+'/'+x.name;if(x.isDirectory()){if(x.name==='worktrees'||x.name==='inbox')continue;w(q,n+1)}else if(x.name==='team.json')files.push(q)}})('.agent-teams',0)
function up(ev){const o={};for(const e of ev.ran){if(e.verdict==='skipped')continue
 if(e.verdict==='ok')o[e.id]={ok:true}
 else if(e.verdict==='blocked')o[e.id]={ok:false,blockers:ev.blockers.filter(b=>b.startsWith('['+e.id+'] '))}
 else o[e.id]={ok:false,unmeasured:e.reason??''}}return o}
function tally(r){return r.blockers.length?'blocked':(r.ok?'ok':'unmeasured')}
const B={}
let skipped=0
for(const f of files){let t;try{t=JSON.parse(fs.readFileSync(f,'utf8'))}catch{continue}
 if(t.id==='self-iteration-3'){skipped++;continue}
 const s=new Set();for(const x of (t.tasks||[]))for(const p of (x.inScope||[]))if(typeof p==='string'&&p.startsWith('docs/'))s.add(p)
 const ex=[...s].filter(p=>fs.existsSync(p))
 const naive={task:{kind:'work'},team:{id:t.id},producedDocuments:ex,documents:ex,currentRevisions:{},observedDocumentWrites:[]}
 const a=await registry.evaluate('admission',naive)
 const b=await registry.evaluate('admission',{...naive,upstream:up(a)});B[tally(b)]=(B[tally(b)]||0)+1
}
console.log('B excluding self-iteration-3 (29 teams):',JSON.stringify(B),'skipped=',skipped)
"
```

**原文输出**：

```
B excluding self-iteration-3 (29 teams): {"unmeasured":7,"blocked":22} skipped= 1
```

⇒ ★ 排除后是 **22 blocked / 7 unmeasured（29 个团队）**，加上 self-iteration-3 自己那 1 个
`unmeasured` ⇒ **22 / 8（30 个团队）**。**两个读数都对，差别是我的文件在不在盘上。**

★★ **这条本身就是"假红"最响的一次演示**：一个团队是 `blocked` 还是 `unmeasured`，
**只取决于一篇文档存不存在** —— 而不是取决于那个团队做了什么。

### 5.3 那 8 个有可解析产物的团队，卡在哪两条条件上

```
agent-teams-hardening      ok=false blockers=0 cond3=true cond4=true
agent-teams-refactor       ok=false blockers=0 cond3=true cond4=true
overnight-registration-har ok=false blockers=0 cond3=true cond4=true
overnight-registration-har ok=false blockers=0 cond3=true cond4=true
planning-loop              ok=false blockers=0 cond3=true cond4=true
overnight-registration-har ok=false blockers=0 cond3=true cond4=true
self-iteration-3           ok=false blockers=0 cond3=true cond4=true
unified-pipeline           ok=false blockers=0 cond3=true cond4=true
```

⇒ **8/8 全部卡在条件 ③（`openQuestions`）与条件 ④（`absorb`）** —— 也就是 §3.4 那两个
**零写入方**的格。即使 `producedDocuments` / `upstream` 都接好了，**这 8 个团队仍然全落 `unmeasured`**
（`ok=false`, `blockers=0` ⇒ 没有一条假红，全是诚实的「没测到」）。

★★ 这解释了为什么 §3 的重点**不是两格而是四格**：只接任务书点名的两格，
读数会从"30 个 unmeasured"变成"8 个 unmeasured + 22 个假 blocked" —— **一个都过不了，还多出 22 条假红。**

### 5.4 30 个团队的 `TeamState` 里没有任何一格能装这些数据

```sh
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('.agent-teams/self-iteration-3/team.json','utf8'));console.log(Object.keys(t).join('\n'))"
```

```
name
id
description
captainSessionId
createdAt
members
tasks
taskSeq
```

★ 上面这 8 个键是**这个团队**的（它是个还没走到 approve 的团队 —— 所以没有
`approvedAt` / `phase` / `planReviewState`）；**全部 30 个团队的顶层键并集**是 16 个：

```sh
node -e "const fs=require('fs'),p=require('path');const f=[];(function w(d,n){if(n>3)return;let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}for(const x of e){const q=p.join(d,x.name);if(x.isDirectory()){if(x.name==='worktrees'||x.name==='inbox')continue;w(q,n+1)}else if(x.name==='team.json')f.push(q)}})('.agent-teams',0);const s=new Set();for(const x of f){try{for(const k of Object.keys(JSON.parse(fs.readFileSync(x,'utf8'))))s.add(k)}catch{}}console.log([...s].sort().join(','))"
```

```
approvedAt,captainSessionId,createdAt,description,escalated,halted,id,members,name,phase,planReviewState,profile,reviewPolicy,taskSeq,tasks,updatedAt
```

⇒ ★★ **这 16 个键里没有 `producedDocuments`、没有 `documents`、没有 `currentRevisions`、
没有 `reviewedRevisions`、没有 `observedDocumentWrites`、没有 `upstream`、没有 `openQuestions`。**
承载这些数据的**地方不存在** —— 这不是"没接上"，是"**没有落盘的位置**"。

★ 唯一健康相关的两格是 `phase` 与 `planReviewState`（`src/types.ts:1189`，
取值只有 `'awaiting_review' | 'awaiting_feedback'`）—— **它们是"审查流程到哪一步"，
不是"审了哪几份文档的哪个版本"。** 而 §5.2.1 与 §6.1 需要的恰恰是后者。

---

## 6. 接入方案（每条附「approve 那一刻读到什么」与「多少历史团队通不过」）

★ 五条方案，每条都是**实测过的**（§5 的探针就是它们的读数）。

### 方案 A：单趟直接接，`evaluate('admission', {})`

- **在 approve 那一刻读到什么**：什么都没有。`absorb` skipped、`checkpoint` skipped、
  `convene` unmeasured ⇒ `ok:false`, `blockers:[]`（§1 逐字）。
- **多少历史团队通不过**：**30/30**（全落 `unmeasured`）。
- **代价**：★ **每一次批准都被拒，而日志里"被什么挡住"是空的。** 这是最坏的一种：
  读者拿不到任何可行动的信息，只会去改判据。
- **结论**：★ **明确否决。** 计划 N5.4 预言的就是这一条，§1 把它复现了。

### 方案 B：单趟 + 朴素填格（`[]` 兜底）

- **读到什么**：`producedDocuments: []`、`documents: []` ⇒ `convene` 条件 ① 报
  "declares NO requirement/plan document at all"（§4.1 逐字）。
- **多少历史团队通不过**：**30/30**，其中 ★ **22 个是 `blocked`（假红）**、8 个 `unmeasured`（§5.2 B 行）。
- **代价**：★★ 把"没人接线"写成"这个团队没有产物" —— 一次**假指控**。
  这正是三条判据的注释反复警告的那条合流，只不过这次它发生在**装配处**。
- **结论**：★ **否决。** 它比 A 更坏：A 至少诚实（`unmeasured`），B **撒谎**。

### 方案 C：两趟 + 诚实省略（推荐给"真接"的那一轮）

- **怎么做**：第一趟交给 registry 的只有**真的观察到的**格（没观察到就**整个键不传**）。
  然后**从第一趟的 `ran` 重建 `upstream`**，再跑第二趟：

  ```js
  function upstreamFrom(ev) {
    const o = {}
    for (const e of ev.ran) {
      if (e.verdict === 'skipped') continue
      if (e.verdict === 'ok') o[e.id] = { ok: true }
      else if (e.verdict === 'blocked') o[e.id] = { ok: false, blockers: ev.blockers.filter(b => b.startsWith(`[${e.id}] `)) }
      else o[e.id] = { ok: false, unmeasured: e.reason ?? '' }
    }
    return o
  }
  ```

- **读到什么**：第一趟 `checkpoint` 真的说话了（如果 `documents` 与版本面都接上），
  第二趟 `convene` 因此读得到 `upstream['admission.checkpoint']`。
- **多少历史团队通不过**：★ **30/30 仍然全落 `unmeasured`**（§5 D 行）。
  原因：条件 ③（`openQuestions`）与 ④（`absorb`）**仍然零写入方** §5.3。
- **代价**：★ 它**不会让任何团队通过**，但**不会产生假红**。它是"诚实的没测到"。
- **★ 它还暴露了一个 registry 层面的缺口**（见 §6.1）—— 而那可能是**更该先修的东西**。

### 方案 D：★ 观察模式（**唯一可以安全地"现在就接"的**）

- **怎么做**：不注入任何新数据，也不改判据。把三条判据放进观察名单：

  ```sh
  AGENT_TEAMS_OBSERVE_GATES="admission.absorb,admission.checkpoint,admission.convene"
  ```

  （`src/gates/registry.ts:510` 的 `OBSERVE_GATES_ENV`，构造时读一次。）

- **读到什么**：★ `ok: true`、`blockers: []`，而**发现记在 `observed` 里**：

  ```sh
  AGENT_TEAMS_OBSERVE_GATES="admission.convene,admission.checkpoint,admission.absorb" \
  node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', {}); console.log('ok =', r.ok); console.log('blockers =', JSON.stringify(r.blockers)); console.log('observed =', JSON.stringify(r.observed, null, 1)); console.log('ran =', JSON.stringify(r.ran.map(x => [x.id, x.verdict, x.observed ?? false])))"
  ```

  ```
  ok = true
  blockers = []
  observed = {
   "blockers": [],
   "unmeasured": [
    "[admission.convene] the verdicts of the gates that must run before a team can convene (the review checkpoint and the absorption check) were not provided, so \"has the loop run long enough\" could not be measured — this is \"not measured\", not \"the loop is done\""
   ]
  }
  ran = [["admission.absorb","skipped",false],["admission.checkpoint","skipped",false],["admission.convene","unmeasured",true]]
  ```

- **多少历史团队通不过**：★ **0/30**。实测扫全部 30 个团队：

  ```sh
  AGENT_TEAMS_OBSERVE_GATES="admission.absorb,admission.checkpoint,admission.convene" node --input-type=module -e "
  import { registry } from './src/gates/index.ts'
  import fs from 'node:fs'
  const files=[]
  ;(function w(d,n){if(n>3)return;let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}
   for(const x of e){const q=d+'/'+x.name;if(x.isDirectory()){if(x.name==='worktrees'||x.name==='inbox')continue;w(q,n+1)}else if(x.name==='team.json')files.push(q)}})('.agent-teams',0)
  let ok=0,notok=0,findings=0
  for(const f of files){let t;try{t=JSON.parse(fs.readFileSync(f,'utf8'))}catch{continue}
   const r=await registry.evaluate('admission',{})
   if(r.ok)ok++;else notok++
   const n=(r.observed?.blockers?.length||0)+(r.observed?.unmeasured?.length||0)
   if(n>0)findings++
  }
  console.log('ok =',ok,'| not ok =',notok,'| with recorded findings =',findings)
  "
  ```

  ```
  ok = 30 | not ok = 0 | with recorded findings = 30
  ```

- **代价**：★ **它测到的仍然是"没接线的空仓库"** —— 30/30 都记了发现，
  而那些发现**全都是"没人接线"**，不是"这个团队有问题"。
  ⇒ 观察模式的**价值是"证明它真的在跑"**（有 `ran[]` 条目、有 `observed` 记录、
  有 `evaluated: 1`），**不是"发现了什么问题"**。
  ★ 而且它是**环境变量**，不是代码 —— 关掉就没了，不会变成默认行为。

### 6.1 ★★ 方案 C 暴露的 registry 缺口：`upstream` 没有合法的生产者

这是本次勘查**新发现**的、计划里没有记的一条。

`convene` 的注释（`src/gates/admission/convene.ts:207`，逐字）说：

```
 * 形状 = 注册表 `evaluate()` 的 `outputs` 字段（`Record<id, 非 ok 字段>`）的
 * **同一份真值**，只是这里多带了态。
```

★ 这句话**对了一半**：`outputs` 确实是 `Record<id, 非 ok 字段>`，而 `upstream` 要多带一个态 ——
所以注释自己已经说了"多带了态"。**但实测发现真正的缺口在"非 ok 字段"这四个字上**：
一条**通过的**判据如果除 `ok` 外没有别的字段，它在 `outputs` 里**根本不存在** ——
于是"同一份真值"里**缺了最重要的那一条**（"它跑过了，而且通过了"）。
复跑：

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', { documents: ['docs/REQUIREMENTS.md'], currentRevisions: {'docs/REQUIREMENTS.md':'aaa'}, reviewedRevisions: {'docs/REQUIREMENTS.md':'aaa'}, observedDocumentWrites: [], producedDocuments: ['docs/REQUIREMENTS.md'] }); console.log('checkpoint verdict:', JSON.stringify(r.ran.find(x => x.id === 'admission.checkpoint'))); console.log('outputs:', JSON.stringify(r.outputs))"
```

```
checkpoint verdict: {"id":"admission.checkpoint","verdict":"ok","produced":false}
outputs: {}
```

★★ **`checkpoint` 通过了，而 `outputs` 是 `{}`。** 因为注册表只收"除 `ok` 之外的字段"
（`src/gates/registry.ts:839`：`const given = Object.fromEntries(Object.entries(verdict).filter(([key]) => key !== 'ok'))`，
紧接着 `:840` `if (Object.keys(given).length > 0) outputs.set(reg.id, given)` —— ★ 那条 `if` 就是缺口），
而一条**通过的**判据如果没有额外产出，就**不往 `outputs` 里写任何东西**。

⇒ ★★★ **所以"用 `outputs` 当 `upstream`"这条路是断的**：一个 `ok` 的判据在 `outputs` 里
**根本不存在**，于是 `convene` 读 `UPSTREAM_CHECKPOINT in upstream` ⇒ **false** ⇒
判"上游没跑" ⇒ `unmeasured`。

★ 这就是为什么方案 C 必须**从 `ran[]` 重建**，而不读 `outputs`。
而 `ran[]` 是**位置级**的（`registry.ts` 每条判据一行），**它不含判据自己的理由文本**
（`blocked` 只有 `count`，`unmeasured` 才有 `reason`）—— 所以重建 `upstream` 时
`blockers` 得从**位置级带上来的前缀**里筛（`[${id}] `），这本身是个**耦合**。

⇒ ★ **定案**：`upstream` 今天**没有合法的生产者**，而且
**registry 也不提供**（`outputs` 不是它，`ran` 是要自己拼的半成品）。
要接 `convene`，**先得回答"谁负责把上游裁决交下来"** —— 而这个决定**不是接线问题，是设计问题**。

### 6.2 ★ 一条必须写下来的反向半边：伪造 `upstream` 会让它全绿

```sh
node --input-type=module -e "const { registry } = await import('./src/gates/index.ts'); const r = await registry.evaluate('admission', { producedDocuments: ['docs/REQUIREMENTS.md'], documents: ['docs/REQUIREMENTS.md'], currentRevisions: {'docs/REQUIREMENTS.md':'aaa'}, reviewedRevisions: {'docs/REQUIREMENTS.md':'aaa'}, observedDocumentWrites: [], openQuestions: [], upstream: { 'admission.checkpoint': { ok: true }, 'admission.absorb': { ok: true } } }); console.log('ok =', r.ok, '| blockers =', JSON.stringify(r.blockers), '| unmeasured =', r.unmeasured); console.log('ran =', JSON.stringify(r.ran.map(x => [x.id, x.verdict])))"
```

```
ok = true | blockers = [] | unmeasured = undefined
ran = [["admission.absorb","skipped"],["admission.checkpoint","ok"],["admission.convene","ok"]]
```

★★★ **`ok: true`，而 `absorb` 是 `skipped`（它根本没跑）。**

⇒ `upstream` 是**判据之间唯一的证据通道**，而它**由调用方填**。
一个为了"让 approve 过"而填 `{ok:true}` 的调用方，会让 `convene` 报通过 ——
**而它测量的东西一个字都没测**。

★ 这与本仓记账过的"**读错位置的出口**"是同一族缺陷的**反向**：
那边是"读了一个热闹但无关的格"（恒真），这边是"**填了一个不该由自己填的格**"。

⇒ ★★ **这一条本身就是"本轮不做"的最强理由**：接线时最省事的做法
（伪造 `upstream` 让它绿）与正确做法（诚实地 `unmeasured`）**在日志里一个是绿的、一个是红的**。
在没有"谁生产 `upstream`"的定案之前接上它，**会奖励伪造**。

---

## 7. ★★★ 本轮不做（以及理由）

★ 任务书要求"明确写出本轮不做的部分与理由 —— 不许把勘查写成已实现"。本节逐条写明。

### 7.1 不做：把 `evaluate('admission', …)` 塞进 `approveStagedTeam`

**理由（三条，都是实测）**：

1. **它会拒掉每一次批准，且不给理由。** §1：`ok:false` + `blockers:[]`。
   `approveStagedTeam` 今天的错误路径全是 `throw new Error(...)` 带一句人话；
   接上之后它会拿到一个**无可读理由**的拒绝 —— 那是**退步**，不是进步。
2. **它会让 30/30 历史团队通不过，其中 0 个是真问题。** §5。
3. ★ **它的输入面 8 个格位一个生产写入方都没有。** §3。
   接上去等于**给一个空仓库装门禁** —— 门禁会一直响，而它响的原因永远是"没人接线"。

### 7.2 不做：为了让 approve 通过而伪造 `upstream`

**理由**：§6.2 实测 —— 伪造会让它 `ok:true` 而 `absorb` 根本没跑。
**那是"装上了但没生效"，比没装更坏**（本仓的原话：它比没装更坏，因为它会让人以为检查过了）。

### 7.3 不做：接 `producedDocuments` 的生产写入方

**理由**：它需要先回答一个**产品问题**，而这不在本任务的写域里：

> **一个团队的"产物文档"到底由谁声明？**
> 是每个 task 的 `inScope` 里 `docs/` 开头的那些（§5 的探针就是这么取的吗？——
> 那是**我猜的**，仓里**没有任何地方**这么定义过），
> 还是 `team.json` 里新加一格，还是从 `docs/REQUIREMENTS.md` 硬编码？

★ 实测的现状是：`TeamState` 里**没有这一格**（§5.4），
而 30 个团队里 **21 个的 `inScope` 里一个 `docs/` 路径都没有**，
**1 个声明了但盘上一个都不存在**（`archive/self-iteration-2` ⇒ `docs/SELF-ITERATION-VERIFICATION.md`），
**8 个有 ≥1 个可解析产物**（§5.3 那张表）。

复跑命令：

```sh
node --input-type=module -e "
import fs from 'node:fs'
const files=[]
;(function w(d,n){if(n>3)return;let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}
 for(const x of e){const q=d+'/'+x.name;if(x.isDirectory()){if(x.name==='worktrees'||x.name==='inbox')continue;w(q,n+1)}else if(x.name==='team.json')files.push(q)}})('.agent-teams',0)
let noDocs=0, declButAbsent=0, withDocs=0
const withDocsNames=[]
for(const f of files){let t;try{t=JSON.parse(fs.readFileSync(f,'utf8'))}catch{continue}
 const s=new Set();for(const x of (t.tasks||[]))for(const p of (x.inScope||[]))if(typeof p==='string'&&p.startsWith('docs/'))s.add(p)
 if(s.size===0){noDocs++;continue}
 const ex=[...s].filter(p=>fs.existsSync(p))
 if(ex.length===0)declButAbsent++; else {withDocs++;withDocsNames.push(t.id)}
}
console.log('teams total:',files.length)
console.log('no docs/ path in any inScope:',noDocs)
console.log('declares docs but ALL absent from disk:',declButAbsent)
console.log('has >=1 resolvable doc:',withDocs)
console.log('names:',withDocsNames.join(', '))
"
```

**原文输出（本文件存在之后）**：

```
teams total: 30
no docs/ path in any inScope: 21
declares docs but ALL absent from disk: 1
has >=1 resolvable doc: 8
names: agent-teams-hardening, agent-teams-refactor, overnight-registration-hardening, overnight-registration-hardening, planning-loop, overnight-registration-hardening, self-iteration-3, unified-pipeline
```

★★ 注意 `self-iteration-3` 出现在最后一行 —— **它在本文写下来之前属于"声明了但盘上没有"那一桶**
（它声明了本文件）。§5.2.1 已经证明了这个位移。
⇒ **猜一个定义然后接线，会把猜错的那一份写进 30 个团队的读数里。**
★ 更进一步：**连"数一下有多少团队有产物"这个动作本身，都会因为我在写文档而变。**
这就是为什么 §7.5 说"文档定义"这一步必须先被**定死**，再谈接线。

### 7.4 不做：修 `upstream` 的 registry 缺口（§6.1）

**理由**：那需要**改 `src/gates/registry.ts`** —— 而本任务的写域是
`docs/SELF-ITERATION-ADMISSION-GAP.md` **一个文件**。★ 且它是**设计决定**：
"谁负责把上游裁决交下来"不该由一个只读勘查顺手定掉。

### 7.5 不做：观察模式上线（方案 D）

**理由**：它**技术上今天就能做**（一个环境变量，零代码改动），
但★ **它测不到任何真问题** —— §6 的实测是 `30/30 都记了发现`，而那 30 条发现
**全部是"没人接线"**。把它当作"接上了"来汇报，就是把**装门禁这件事本身**
当成了门禁的产出。⇒ **本轮只记录它是一条安全的路，不执行它。**
（★ 若下一轮要证明"`admission` 真的会被求值"，方案 D 是**唯一**无损的做法，
且必须同时报出 `observed` 里那 30 条**全是接线缺口**这件事。）

### 7.6 不做：`admission.plan-gate`（计划 N5.11 提到的第四问）

**理由**：计划自己在 `docs/SELF-ITERATION-PLAN.md:817` 已经推荐**不进注册表**
（"直接在 `approve` 里调，读数挂在返回值与 error message 上"）。
★ 本轮的实测**加强了那个推荐**：`admission` 位置今天**连一格的输入面都接不上**（§3），
再往里加第四条判据只会让 §6.1 那个缺口**更难看**。

---

## 8. 三条交给下一轮的话

1. ★★★ **"接上 admission"不是一个动作，是两个决定**：
   (a) **产物文档由谁定义**（§7.3 的那个产品问题）；
   (b) **`upstream` 由谁生产**（§6.1 的 registry 缺口）。
   **两个都定了，接线才是几分钟的事。** 在这之前，任何"接上"都只会产出假红或假绿。

2. ★★ **要接，先接观察模式（方案 D）**，且**必须同时打印 `observed`**
   —— 否则"接上了"和"接上了但什么都没测到"同形。
   实测 `30/30 都记了发现`，而那 **30 条全是接线缺口**，不是团队缺陷。

3. ★ **这条缺陷的"反向半边"是伪造**（§6.2）。写夹具时**要有**一条臂：
   拿着伪造的 `upstream: {ok:true}` 调 `evaluate('admission', …)`，
   断言它**不能**因此变成 `ok:true` —— 否则"最省事的接线"永远赢过"正确的接线"。

---

## 9. 写域核对（`git status`）

```sh
git status --short
```

**原文输出（本文写完后，2026-10-20 复跑）**：

```
 M scripts/plan-review-check.mjs
?? docs/SELF-ITERATION-ADMISSION-GAP.md
?? scripts/evolution-readout.mjs
```

★ 前两条**不是我这一轮的改动**：
`scripts/plan-review-check.mjs` 是 **t12** 的交付（`M`），
`scripts/evolution-readout.mjs` 是 **t1** 的交付（`??`），两者都在本轮之前就已存在。
本轮**只新增** `docs/SELF-ITERATION-ADMISSION-GAP.md` 一个文件（就是那第三条）。

```sh
git diff --stat src/ lib/
```

```
（无输出 ⇒ src/ 与 lib/ 一个字节未改）
```

---

## 10. 附：本文每一个数字的来源

| 数字 | 命令 | 位置 |
|---|---|---|
| `ok:false` / `blockers:[]` / `ran` 三条 | §1 的第一条命令 | §1 |
| `requires.incomplete: 1` / `inputSurfaceAbsent: 1` | §1.1 | §1.1 |
| `evaluate('admission'` 零命中 | `grep -rn "evaluate('admission'" src/` ⇒ exit 1 | §2 |
| 8 个格位 0 写入方 | §3.1 的 for 循环 | §3.1 |
| `upstream` 9 条全是别的概念 | §3.3 的 grep 原文 | §3.3 |
| `absorb.claims` 零生产者 | `grep -rn "claims:" src/ …` ⇒ exit 1 | §3.4 |
| 三条判据的 requires | `registry.list().admission` | §3.5 |
| `open-questions.json` **0 份** | `find . -name "open-questions.json" \| wc -l` ⇒ `0`（★ 不用 find 的退出码） | §3.5 |
| `[]` ⇒ 假 blocker | §4.1 的命令 | §4.1 |
| 30 个团队 | §5.1 | §5.1 |
| A/B/C/D 四种接法（30/0/22/8、0/0/22/8） | §5.2 的探针 | §5.2 |
| ★ 本文件让 B 行从 23 变 22 | §5.2.1 的排除重跑 | §5.2.1 |
| 8/8 卡条件 ③④ | §5.3 的探针 | §5.3 |
| `TeamState` 16 个键里没有产物格 | §5.4 | §5.4 |
| 观察模式 30/30 ok、30/30 有发现 | §6 方案 D 的扫盘 | §6 |
| `outputs: {}` 而 checkpoint 通过 | §6.1 | §6.1 |
| 伪造 `upstream` ⇒ `ok:true` | §6.2 | §6.2 |
| 21 个团队 inScope 无 `docs/`、1 个声明了但盘上没有、8 个有 | §7.3 的扫盘 | §7.3 |
| `git status` 三条 | §9 | §9 |

### 10.1 ★ 本文改过的三处口径（记账，免得下一轮读到旧数）

本文第一稿有三处**命令与读数对不上**，都在复跑时抓出来了，已改：

1. **§3.5 的 `find … ; echo "(exit $?)"` 写成 `(exit 1)`** —— 错。`find` 没找到任何东西时
   **仍然 exit 0**。改成 `| wc -l` ⇒ `0`。（教训：`find` 的退出码不表示"找到了没有"。）
2. **§4 引用的那条 blocker 原文，第一稿的命令根本产不出来** —— 那个命令给的是
   `blockers: []` + 全局 `unmeasured`。真正的假红需要**上游先给齐**（§4.1 的命令）。
   第一稿把"两条不同命令的读数"缝在了一段话里。已拆成 §4（正面，诚实的 `unmeasured`）
   与 §4.1（反面，假 `blocked`）两段，各自附各自的命令与原文。
3. **§5 的 23 / 7 / 两个团队** —— 第一稿的数是在本文件**不存在**时测的。
   本文件落盘后变成 22 / 8 / 一个团队。**两个读数都对**，已在 §5.2.1 用一条排除重跑证明
   差值恰好是 `self-iteration-3` 自己。★ 这也是全文最好的一次"假红"演示：
   一个团队是 `blocked` 还是 `unmeasured`，**取决于一篇文档在不在盘上**。
