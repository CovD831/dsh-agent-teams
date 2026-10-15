# E 线 L0：零行为变更的纯删除 —— 执行记录 + 三条**推翻 `UI-DISSECTION.md` 读数**的实测

**基线**：HEAD = `57416a8`（工作树在开工时只有 `lib/git-artifact-stamp.json` 一处非 client 变更）。
**性质**：本文只报**可复跑读数**。**一条观感都没有**，也**没有跑过真实浏览器**（原因见 §6）。

---

## 0. 结论速览

| 条 | 动作 | 状态 | 判据 |
|---|---|---|---|
| L0.1 | 删 6 个死 CSS 类 | ✅ 已做 | D1 脚本 ⇒ `[]`（135 → 129 类）；6 个 `grep -c` ⇒ 全 0 |
| L0.2 | 处置 `data-selected-member` 规则 | ✅ 已删 | `grep -c` ⇒ 0；属性在 `src/**` 里**无生产者** |
| L0.3 | 删 39 条死文案 | ⛔ **未做（越权）** | 删任一 key ⇒ `scripts/workspace-activity.test.mjs` 臂 27 **必红**，而登记表在 `scripts/`（**不在写域**）。见 §4 |
| L0.4 | 删 `activity-model.ts` 死 `if` | ✅ 已做 | 657 例对拍（9 命名 + 648 穷举）**mismatch = 0** |
| L0.5 | 只删 D2 表 A 各自**前者** | ✅ 已做（**8 组，不是 11 组**） | 删前/删后**胜出声明值逐条相同**；`DEAD` 列表 44 组里 8 → **0**，MIXED 35 / ALL_INSIDE 1 不变；见 §3 |

**★ 三条把 `UI-DISSECTION.md` 的读数推翻的实测**（§2、§3、§4）：
1. **D8 的 dead key 是 41 条，不是 40 条**；而文档表格**自身的分组算术就等于 41**，合计却写 40。
2. **D2 表 A 是 8 组，不是 11 组** —— 文档的脚本有一处**行号 bug**（去注释时把换行也删了 76 个，却拿**未去注释**的行号区间去判）。
3. **L0.3 与 `scripts/` 的写域冲突是硬冲突**：不是"要同步改断言"，是**不加登记就必红**。

---

## 1. L0.1 / L0.2：6 个死类 + 1 条死属性规则

### 1.1 复跑 D1 脚本（改前 / 改后）

```bash
python3 - <<'EOF'
import re,glob
src=re.sub(r'/\*.*?\*/','',open('src/client/ActivityPanel.module.css').read(),flags=re.S)
cls=set(re.findall(r'\.([A-Za-z_][A-Za-z0-9_-]*)',src))
corpus={f:open(f).read() for f in glob.glob('src/client/*.tsx')+glob.glob('src/client/*.ts')}
print([c for c in sorted(cls) if not any(re.search(r'\b'+re.escape(c)+r'\b',t) for t in corpus.values())])
EOF
```

* **改前** ⇒ `['assignmentLine','loopRound','loopRoundMarker','loopSection','loopStatusTail','memberState']`，类名 token **135**
* **改后** ⇒ `[]`，类名 token **129**

`grep -c` 逐条：6 个类名在 `ActivityPanel.module.css` 中**全为 0**。

### 1.2 ★「逐选择器删」是**必要**的，不是讲究

两个死类是**活着的一半**里的一条：

```css
/* 改前 */
.team[data-workspace-team] .memberRole, .team[data-workspace-team] .memberState, .team[data-workspace-team] .memberCount { font-size: 11px; }
```

`memberRole` / `memberCount` 都活着。**整块删会把它们的字号一起删掉** ⇒ 本条的粒度只能是选择器：

```css
/* 改后 */
.team[data-workspace-team] .memberRole, .team[data-workspace-team] .memberCount { font-size: 11px; }
```

### 1.3 L0.2：`data-selected-member` 二选一，选「删」

判据是**它在 `src/**` 里有没有生产者**，不是"读起来像什么"：

```bash
grep -rn "data-selected-member" src/          # ⇒ 只有 CSS 一处，ts/tsx 零命中
grep -rn "selectedMember" src/client/         # ⇒ 零命中（只有 selectedTaskId）
```

`MemberRow.tsx:278` 确实渲染 `className={css.memberBlock}`，但**从不带这个属性**；面板只有一个 `selectedTaskId`，**没有成员选中态**。⇒ 这条规则**永远不可能命中**，删掉。

**同族确认（避免重复处理）**：`data-has-model` 在 CSS 里**只剩注释**（`ActivityPanel.module.css:2439-2441`），无活规则 ⇒ 文档说的「t36 已删」**成立**，本轮不动。

### 1.4 六个类的**唯一** CSS 规则（逐条位置）

| 类名 | 规则 | 改前行号 |
|---|---|---:|
| `assignmentLine` | `.assignmentLine { padding-left: 53px }`（在 `@media max-width:640px` 内） | 1833 |
| `memberState` | 逗号列表中间那个 | 2008 |
| `loopSection` | 5 条声明 | 2034 |
| `loopRound` | 7 条声明 | 2043 |
| `loopRoundMarker` | 13 条声明 | 2053 |
| `loopStatusTail` | 14 条声明 | 2070 |

⇒ 与 `loop*` 三个内联注释 + 其 2021–2028 的 `t13 Review convergence` 块头**一并删除**（实测该块头下**只有**这 4 条规则，`t13` 的 `──` 段落头在 2083 另起）。

---

## 2. ★ 推翻一：D8 的死文案是 **41 条**，不是 40；而文档表格的算术本身就是 41

### 2.1 复跑（判据 = 完整点号 key 作为**带引号字符串**出现在非 `locales.ts` 语料里）

```bash
python3 - <<'EOF'
import re,os
src=open('src/client/locales.ts').read()
def objkeys(name):
    m=re.search(r'export const '+name+r' = \{',src)
    i=src.index('{',m.start()); d=0; j=i
    while j<len(src):
        if src[j]=='{': d+=1
        elif src[j]=='}':
            d-=1
            if d==0: break
        j+=1
    return re.findall(r"^\s*'([^']+)':",src[i:j+1],re.M)
zk=objkeys('zh')
files=[]
for root in ('src','scripts'):
    for dp,dn,fn in os.walk(root):
        if 'node_modules' in dp: continue
        for f in fn:
            if f.endswith(('.ts','.tsx','.mjs','.js')):
                p=os.path.join(dp,f)
                if p!='src/client/locales.ts': files.append(p)
corpus='\n'.join(open(p,errors='ignore').read() for p in files)
dead=[k for k in zk if ("'"+k+"'") not in corpus and ('"'+k+'"') not in corpus]
print(len(zk),'keys;',len(dead),'dead'); [print('  ',d) for d in sorted(dead)]
EOF
```

* `zh` / `en` 各 **241** key，集合相等。
* **dead = 41**（`zh` 一份；`en` 一份 ⇒ **82 处条目**）。

### 2.2 与文档的**唯一差别**是 `progress.delivered`

文档 §2.5 的分组表：`4+10+6+3+5+3+8+2 = 41`，而表尾「**合计 40**」。⇒ **文档的合计与它自己的分组不符**，差的正是 `progress.delivered`。

**它是真死的，而且仓库自己已经写明了**（这是最硬的一条旁证）——`scripts/workspace-activity.test.mjs:1355`：

```
 *   · `progress.delivered` 被读成"还在" —— 因为它在 `locales.ts` 里**有词条**；
 *   · 而它其实**已经没有任何一处渲染它**了。
```

⇒ 文档 §2.5 的措辞「40 里含 `member.state.notCreated` ⇒ 39 可删」是**两处混淆叠加**：
* `member.state.notCreated` **根本不在** dead 集里（它被 `scripts/verify.mjs:308` 逐字钉住，是**带引号字符串**，语料命中 ⇒ 活着）；
* 真正的可删数是 **41**，不是 39。

**补充实测（排除"仅被注释提及"这一类假阳性）**：把 `.ts/.tsx/.mjs/.js` 的块注释与行注释都剥掉后重跑 ⇒ **alive 集一字不变**，`alive only via a comment` = **空**。

---

## 3. ★★ 推翻二：D2 表 A 是 **8 组**，不是 11 组 —— 文档脚本的**行号 bug**

### 3.1 文档的脚本为什么给出 11

文档脚本（`UI-DISSECTION.md` §3-D2）这两行**互相矛盾**：

```python
nc = re.sub(r'/\*.*?\*/','', open('...').read(), flags=re.S)   # ← 把注释连同换行一起删了
ATR = [(1773,1798),(1800,1804),(1806,1880),…]                  # ← 这些行号是在**未删注释**的文本上量的
```

实测这一删**少了 76 个换行**：

```
raw lines:            2457
comment-stripped lines: 2381   ← 少了 76
'prefers-reduced-motion' : raw@1773  vs stripped@1755
'.panel {'               : raw@76    vs stripped@70
```

⇒ reduced-motion 块在 stripped 文本里落在 **1755–1780**，而 `ATR` 里的区间是 **(1773,1798)** ⇒ **被判成"在 at-rule 之外"**。于是 `.panel` / `.badge` / `.memberAvatar[data-unread='true']::after` 那三组被误判为"无条件死声明"。

**把去注释改成保留换行（一行之差）后，文档自己的脚本输出从 11 变成 8。**

### 3.2 三种**互相独立**的方法都给 8

| 方法 | 实现 | 结果 |
|---|---|---|
| A | 保留换行的逐字符扫描 + 花括号配对 | 44 组 ⇒ **ALL_OUTSIDE 8** / MIXED 35 / ALL_INSIDE 1 |
| B | 递归下降 + at-rule 上下文栈 | 44 组 ⇒ **8 / 35 / 1** |
| C | 文档脚本 + **保留换行**的去注释 | 44 组 ⇒ **8** |

且**在基线 `b8f357e` 的 CSS 上跑同样是 8** ⇒ 这不是本次改动引起的漂移。

**合成夹具自证**（证明分析器有分辨力）：

```css
.a { color: red; }
@media (max-width: 100px) { .a { color: blue; } }   /* MIXED */
.b { color: red; }
.b { color: blue; }                                  /* ALL_OUTSIDE ← 真死 */
.c { color: red; }
@media (max-width: 100px) { .c { color: blue; } }   /* MIXED */
```
⇒ 实测 `ALL_OUTSIDE = 1`，正是 `.b`。**14 个 at-rule 区间**（含 8 个 `@keyframes` 与 6 个 media/container）与文档逐条相同。

### 3.3 真正的 8 组（含改后行号）

| 选择器 | 属性 | 前者 → 后者（改后行号） |
|---|---|---|
| `.memberRow` | `grid-template-columns` | 682 → 2024 |
| `.memberRow` | `gap` | 682 → 2024 |
| `.taskDetailMeta` | `color` | 1043 → 1052 |
| `.planNewTask label` | `gap` | 1335 → 1658 |
| `.planApproveRow button` | `background` | 1570 → 1710 |
| `.planApproveRow button` | `color` | 1570 → 1710 |
| `.planApproveRow button` | `min-height` | 1570 → 1710 |
| `.planApproveActions > button[data-danger]` | `color` | 1739 → 1745 |

### 3.4 ★ 4 组是逗号列表，**只能按选择器摘**

与 §1.2 同一个形态，**8 组里有 4 组**踩这个坑。摘法逐条：

| 组 | 共享列表 | 处理 |
|---|---|---|
| `.taskDetailMeta` `color` | `.taskDetailLine, .taskDetailMeta` | 拆成 `.taskDetailLine { color }` + 保留 `{ font-size; line-height }` 给两者 |
| `.planNewTask label` `gap` | `.planCardBody label, .planNewTask label` | 把 `gap` 单独留给 `.planCardBody label` |
| `.planApproveRow button` ×3 | `.planActions button, .planNewTask button, .planApproveRow button, .planConfirm button` | 4 选择器拆成 `{3 个带 min-height/background/color}` + `{planApproveRow button 不带}` |
| `.planApproveActions > button[data-danger]` `color` | `.planSecondaryActions > button, .planApproveActions > button[data-danger]` | 拆开，后者不带 `color` |

**「整块删」在 8 组里会杀掉 4 组活声明** —— 这一点写进 §3.5 的验收。

### 3.5 硬验收：**逐条**证明删前删后同一选择器的**最终声明值**相同

判据 = 把整张样式表解析成 `(at-rule 上下文, 选择器, 属性) → 最后一条声明的值`，比**全部 1673 个键**：

```
union keys: 1673
value-differing winners: 42
disappeared: 42        appeared: 0
```

**42 条消失，逐条就是本轮的删除**（40 条来自 L0.1 的 6 个死类 + 2 条来自 L0.2 的属性规则），**appeared = 0**（证明 §3.4 的拆分**没有引入任何新声明**）。

**§3.2 的三分表在删后复跑**（这份读数本身也是反向半边的一部分）：

```
改前： total groups = 44  { MIXED: 35, ALL_OUTSIDE: 8,  ALL_INSIDE: 1 }
改后： total groups = 36  { MIXED: 35,                  ALL_INSIDE: 1 }
```

⇒ **MIXED 35 与 ALL_INSIDE 1 逐条不变**；`44 → 36` 的差**正好是 8**，即 ALL_OUTSIDE 那 8 组**按构造**消失（每组只剩后一条声明，就不再是"重复组"）。
⇒ 这正是 D2 反向半边要的形态：**`DEAD` 列表变空，而合法覆盖（35 + 1）一条不少**。

8 个 L0.5 目标逐条：

| 选择器 | 属性 | 最终值（删前 = 删后） |
|---|---|---|
| `.memberRow` | `gap` | `6px` |
| `.memberRow` | `grid-template-columns` | `46px 16px minmax(0, 1fr) 96px` |
| `.planApproveActions > button[data-danger]` | `color` | `var(--dsw-alias-state-error-primary)` |
| `.planApproveRow button` | `background` | `var(--dsw-alias-state-business-primary)` |
| `.planApproveRow button` | `color` | `var(--dsw-alias-label-primary-inverted)` |
| `.planApproveRow button` | `min-height` | `32px` |
| `.planNewTask label` | `gap` | `4px` |
| `.taskDetailMeta` | `color` | `var(--dsw-alias-label-tertiary)` |

**构建产物上再验一遍**（改的是 CSS 产物，所以必须看 `lib/client.js` 里被压缩合并后的**级联顺序**）：

```
_memberRow { grid-template-columns }
   BEFORE(2): ["46px minmax(0,1fr) auto","46px 16px minmax(0,1fr) 96px"]
   AFTER (1): ["46px 16px minmax(0,1fr) 96px"]                     winner same: true
_memberRow { gap }                 BEFORE ["8px","6px"] → AFTER ["6px"]
_planApproveRow button { background }  BEFORE ["…button-ghost-active-fill","…state-business-primary"] → AFTER ["…state-business-primary"]
_planApproveRow button { color }       BEFORE ["…label-primary","…label-primary-inverted"] → AFTER ["…label-primary-inverted"]
_planApproveRow button { min-height }  BEFORE ["30px","32px"] → AFTER ["32px"]
_planNewTask label { gap }             BEFORE ["4px","4px"] → AFTER ["4px"]
_taskDetailMeta { color }              BEFORE ["…label-secondary","…label-tertiary"] → AFTER ["…label-tertiary"]
_planApproveActions>button[data-danger] { color }  BEFORE ["…label-primary","…state-error-primary"] → AFTER ["…state-error-primary"]
```

**8/8 winner same: true**，且 base 里那条死声明在产物里**真的没了**。

### 3.6 ★★ 反向半边：证明**没删错**（"删干净了"与"删多了"不同形）

**如果只按文档的表 A 11 组删**，多出来的正是这三组：

| 选择器 | 属性 | 文档判"死"的**前者** | 它的"后者"实际是 |
|---|---|---|---|
| `.panel` | `animation` | `animation: agentTeamsPanelIn 160ms ease-out;`（真实行 91） | `@media (prefers-reduced-motion: reduce)` 里的 `animation: none` |
| `.badge` | `transition` | `transition: border-color …`（真实行 42） | 同上块里的 `transition: none` |
| `.memberAvatar[data-unread='true']::after` | `animation` | `animation: … agentTeamsUnreadPulse`（真实行 715） | 同上块里的 `animation: none` |

⇒ 照文档删：这三个选择器**连基础动画一起没了**，而 `animation: none; transition: none;` 留成**空操作**。结果是**所有用户**（包括**没有**要求降动效的）都失去入场动画与未读脉冲 —— **那是行为变更，不是纯删除。**

**而文档 §2.1.2 自己的文字说这 13 组是合法的**（「10 组是 `@media (prefers-reduced-motion: reduce)` 的 `transition/animation: none` 覆盖（`:1776`），**这是正确写法**」）。⇒ **文档的散文与它脚本的输出互相矛盾**，散文是对的，脚本有 bug。

**构建产物上的反向半边**：改后 `lib/client.js` 里 `prefers-reduced-motion:reduce` 仍在，其选择器列表**仍含** `_panel` / `_badge` / `_memberAvatar[data-unread=true]:after`：

```
prefers-reduced-motion:reduce){._H_panel,._H_badge,._H_badgeDot,._H_panelDot,._H_workGlyph rect,._H_stateArt,._H_memberAvatar[data-unread=true]:after,…
```

⇒ **reduced-motion 支持完整保留**。

**而 MIXED 组的读数**：44 组里 **35 组是混合**（文档说 32），其中 **13 组命中 reduced-motion 块**。"重复即删"会动到全部 44 组 ⇒ **13 组降动效支持在刀下**。

---

## 4. ★★ L0.3 未做：不是漏做，是**与 `scripts/` 的硬写域冲突**

### 4.1 实测：删**任一** key ⇒ 臂 27 必红

把 `progress.delivered` 从 `zh`/`en` 各删一份，然后：

```bash
node --test --test-name-pattern="臂 27" scripts/workspace-activity.test.mjs
```

```
✖ ★ 臂 27（R3 集合比对臂）：搬动之后**没有**任何渲染事实掉在路上
  AssertionError: ★ 搬动不得丢掉任何词典词条（有意去掉的那些已在 INTENTIONAL_REMOVALS 里逐条登记并给出替代）。
  实测未登记的丢失：["progress.delivered"]
```

### 4.2 为什么这**不是**"同步改断言"就能过

* `scripts/workspace-activity.test.mjs:1434` `headFiles = headClientFiles()` —— 用 `git ls-tree HEAD -- src/client` 取 **HEAD 的 `locales.ts`**；
* `:1486` 词典面投影 `declaredLocaleKeys`，`:1490-1494` 断言 `unexplained` 必须为空；
* 登记表是 `:1475` 的 **`const INTENTIONAL_REMOVALS = new Map()`，硬编码在 `scripts/` 里**（`scripts/fixtures/` 下**没有**对应数据文件）。

⇒ 要过这条，**必须写 `scripts/workspace-activity.test.mjs`**。而本任务 `Out of scope` 逐字含 **`scripts`**。

### 4.3 ★ 这条与「P0 解耦已完毕」的关系必须说清

`docs/UI-DISSECTION.md` D10 说 P0/P0b 解耦过"读源文本"的假红。**那解的是 `verify.mjs` 那一族**（改类名/挪文件不再假红）。**本仓仍有一处是"删了就必须登记"** —— 它不是假红，**是这条臂的设计意图**（`:1440-1444` 明确写「没登记的差异 → 仍然是红的（所以"悄悄删掉一件事实"跑不掉）」）。

⇒ 所以 L0.3 的正确形状**不是**"改断言让它变绿"，而是**在 `scripts/` 里逐条登记 41 条 + 给出替代**。那是一次**独立的、有写域的任务**。

### 4.4 本轮的实际处置

**不动 `locales.ts`**（已复原：`git diff src/client/locales.ts` 为空）。41 条清单与 §2 的复跑脚本已备好，可直接交给下一个拥有 `scripts/` 写域的人。

---

## 5. L0.4：死 `if`

```ts
/* 改前 activity-model.ts:208-209 */
  if (team.tasks.length === 0) return { working: 0, detail: '' }
  return { working: 0, detail: '' }
```

两个出口**字面相同** ⇒ 第一个 `if` 是死的。改后只剩一条 `return`。

**单位测试：无任务的队返回值不变**（判据 = 与**删前那份实现逐字复制**的参照实现做对拍）：

```
OK    no members, no tasks                       {"working":0,"detail":""} == {"working":0,"detail":""}
OK    members but no tasks (the D9a path)        {"working":0,"detail":""} == {"working":0,"detail":""}
OK    members with tasks, none running           {"working":0,"detail":""} == {"working":0,"detail":""}
OK    a working member, no tasks                 {"working":1,"detail":""} == {"working":1,"detail":""}
OK    running task with subject                  {"working":1,"detail":"Do it"} == …
OK    running task with empty subject → id       {"working":1,"detail":"t1"} == …
OK    two running tasks                          {"working":2,"detail":"A · B"} == …
OK    three running tasks (slice 0,2)            {"working":3,"detail":"A · B"} == …
OK    2 working members + 1 running task (max)   {"working":2,"detail":"X"} == …

sweep cases=648  mismatches=0
★ L0.4 BEHAVIOR IDENTICAL
```

穷举空间 = `成员数∈{0,1,2} × 任务数∈{0..3} × 成员活动∈{undefined,working,idle} × 任务状态∈6 × 标题∈{'', '  ', 'X'}`。

---

## 6. ★ 需要真实浏览器才能验证的改动 —— **本机量不到，如实报出**

`scripts/workspace-activity.test.mjs` 的 **臂 33 / 33b / 33c / 33d** 是**真实 headless Chrome** 量布局的（`CHROME_BINARY = /Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，**该二进制在本机存在**）。它们断言的是成员行行高、`.memberBlock` 内边距、`.delegationTree` gap、相邻行顶之差。

**实测本机这 4 条臂跑不起来**（`launchChrome()` 的 promise 不 resolve）：

```
✖ 臂 33 / 33b / 33c / 33d
  'Promise resolution is still pending but the event loop has already resolved'
ℹ tests 4 / pass 0 / fail 0
```

**这不是我的改动造成的** —— 在**干净树**（`git stash` 掉本轮全部改动）上实测**同样**是 `tests 4 / pass 0 / fail 0`。

⇒ **我不声称验证过真实渲染。** 本轮 L0.5 对 `.memberRow` 的 `grid-template-columns`/`gap` 有改动，因此"浏览器里行高不变"这一条**必须由能跑 Chrome 的环境补验**（判据：臂 33 的 `rowHeights` / `rowTopDeltas` / `memberBlockPadding` / `treeGap` 与改前逐条相同）。

**能替代到什么程度**：§3.5 §3.6 已在**构建产物**上证明级联胜出值逐条不变，那是"浏览器会量到什么"的**声明侧**证据，但**不等同于**渲染侧证据。

---

## 7. 验收读数汇总

```bash
npx tsc -p tsconfig.json --noEmit     # exit=0（改前 exit=0）
npx tsc -p tsconfig.client.json --noEmit  # exit=0
pnpm build                            # exit=0；lib/client.js 320.19 kB；stamp.commit == 57416a8 == HEAD
grep -c "border-radius" src/client/ActivityPanel.module.css   # 见下
```

**净变化按【失败文件集合】判**（不用计数，计数会抖）：

| 命令 | 基线 | 改后 | 判定 |
|---|---|---|---|
| `pnpm test:gates` | 16 个失败文件 | **16 个，逐条相同** | ✅ 净新 = 0 |
| `pnpm verify` | 8 条 FAIL | **8 条，逐条相同（`diff` 无输出）** | ✅ 净新 = 0 |
| `workspace-activity.test.mjs` 可跑的 13 条臂 | — | **13/13 pass** | ✅ |

★ **基线本身是红的**：`pnpm verify` 在 `scripts/verify.mjs` 处即失败（8 条检查），所以验收口径定为「**与基线逐条相同**」，**不是**「全绿」。本轮**没有**为了变绿而放宽任何断言 —— 那 8 条一条没碰（其中 4 条是 `verify.mjs` 对 `memberState`/`assignmentLine`/`memberModel` 的文本断言，见 §8）。

---

## 8. ★ 附：`scripts/verify.mjs` 里 4 条**已经坏了**的断言（本轮未碰，如实报出）

`docs/UI-DISSECTION.md` D10 说"P0/P0b 已解耦"。实测 `scripts/verify.mjs` 仍有 4 条**结构性失效**（都属基线 8 条 FAIL，**不在本轮写域**）：

| 行 | 断言 | 实测 |
|---|---|---|
| `:392-393` | `activityPanelCss.includes(".memberState[data-activity='working']")` + 正则要求它设 `color: var(--dsw-alias-state-business-primary)` | CSS 里**只有** `:2008` 的逗号列表，**没有** `[data-activity='working']` 规则 ⇒ 恒红 |
| `:471` | `activityPanelSource.indexOf('css.assignmentLine', memberMapStart)` 当**切片哨兵** | `visibleMembers.map((member) => {` 与 `css.assignmentLine` 在 `ActivityPanel.tsx` 里**都零命中** ⇒ `memberMapStart = -1`、切片为空 ⇒ 后面整条 `:473-484` 的 `memberBadgeSection` 断言**在空串上判** ⇒ 恒红 |

⇒ 这两处不是"我删坏了"，是**在 HEAD 上就已经恒红**（`git stash` 后实测相同）。**要修得改 `scripts/`**，与本任务写域冲突，**留给拥有写域的人**。

---

## 9. 改动清单

```
src/client/ActivityPanel.module.css   L0.1（6 个死类，逐选择器）+ L0.2（1 条死属性规则）+ L0.5（8 组前者）
src/client/activity-model.ts          L0.4（1 行死 if）
lib/…                                 pnpm build 产物
docs/E-LINE-L0.md                     本文
```

**未动**：`src/client/locales.ts`（见 §4）、`src/client/ActivityPanel.tsx`（L0.1–L0.5 无需改它）、`scripts/**`、`docs/UI-DISSECTION.md`。
