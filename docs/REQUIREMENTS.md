# 需求（本仓当前认领的设计原则与裁定）

> **本文件是什么**:本仓**已裁定**的需求、设计原则、与被推翻的旧判断。
> ★ 它不是计划文档（那些在 `docs/*-PLAN.md` 与各专题文档里）；
> 它是**一份可对齐的清单** —— 供 `workbench-align` 双向比对。
>
> **怎么写**:见本仓 `AGENTS.md` 的「需求捕获」一节（判据与格式）。
> ★ 每条都必须能回答:**它是否还在生效**、**谁在实现它**、**怎么验证**。

---

## 0. 判据（什么样的东西该进这里）

```
✅ 该进:  用户明确裁定的设计原则 · 被推翻的旧判断 · 需求变更
★ 而每条必须带三格:
   ① 【判据】—— 为什么它是需求（用户原话或可复跑的读数）
   ② 【现状】—— 已实现 / 未实现 / 已推翻
   ③ 【证据】—— 文件路径或命令
❌ 不该进:一次性的排期 · 尚未裁定的提案（那些在 DECISIONS-PENDING.md）
```

---

## 1. ★★★ 模块边界（用户硬约束，逐字）

> 「**我是不允许模块之间互相侵入的。** 所以，需要暴露给其他模块使用的功能，
>  都必须做一个**接口**接出来，供其他模块调用，**不能做模块之间的互相侵入**。」

**判据**:用户原话 · **现状**:✅ 已落地为四条规则 · **证据**:`docs/MODULE-REPARTITION.md` §1.4

```
A. 别人 → evolution：★ 只许 import src/evolution/（一个接口面）
B. evolution → 别人：★ 只读。要影响别人 ⇒ 发信号给宿主
C. 采集点：★ 别的模块不许主动调用 —— 宿主在【既有汇合点】调用
D. ★★★ 裁决器（gates / 验证命令 / 阈值）【AI 只读】，由机械臂钉住
```

★ **并已实测**:`src/evaluator/` 三文件**剥注释后零 import**（独立于 evolution/gates）。

---

## 2. ★★★ 三模块划分（用户裁定：实施不是模块）

> 「**我觉得不一定一定要有这个实施模块。** 因为我们这个插件本身就是一个任务的实施，
>  它可以走我们**本身的 Agent Team 派发任务**之类的。」
> 「我们目前做的这个，**可能不能被称为一个"自净化模块"**，因为它不包含
>  **"改完之后产生收益"这样一个完整的闭环**。目前做的可能只是一个**信息采集和初步处理的模块**。」

**判据**:用户原话 + 六个导出全为采集侧的实测 · **现状**:✅ · **证据**:`docs/MODULE-REPARTITION.md`

| 模块 | 职责 | 现状 |
|---|---|---|
| **① 采集与处理** | 采集 · 该不该采 · 分类 ⇒ 产出**结论** | ✅ `src/evolution/` |
| **② 实施** | ★ **不存在** —— `Proposal` 转成 `create_task` 契约 | ✅ 一个转换函数 |
| **③ 评估器** | 衡量**收益**（前后两个窗口）| ✅ `src/evaluator/` |

★ **而 ③ 独立的理由（技术性的，不是组织性的）:**
```
★ 单次判据回答「这次改动【合规】吗」—— 当下、机械
★★ 而收益回答「这次改动【有收益】吗」—— ★ 需要【前后两个窗口】
⇒ 单次判据【结构上】回答不了趋势
```

---

## 3. ★★★ 评估器待在循环外（安全边界）

**判据**:STOP（microsoft）的两文件设计 + 用户裁定 · **现状**:✅ · **证据**:`src/evolution/types.ts:105`

```ts
LOOP_B_SUBJECTS = ['collection-gates', 'verify-command', 'confidence-threshold']
canLoopAAutoChange ⇒ 对这三者返回 false
★★ 而 src/evolution/ 里【没有任何函数能改判据】—— 刻意不提供
```
★ **理由（STOP 的结构）:**
```
tasks/maxcut/utility.py         ← 给被进化的程序看的（n_tests=3）
tasks/maxcut/secret_utility.py  ← ★ 真正裁决，被进化对象【看不到、改不到】
⇒ ★★ "一条只禁止调用的注释会腐烂，没有那个函数则不会"
```

---

## 4. ★★★ 「两件不同的事不许同形」（本会话 9 次事故的共同根因）

**判据**:★ 本会话**实测 9 次**同族事故 · **现状**:⚠️ **已实现但未成文** · **证据**:`docs/DECISIONS-PENDING.md` §3③

**事故清单（每条都有据）:**
```
① t79/t80「尝试被拦下」被写成「越界」
② #2 一条被写成两条
③「四处登记」实际五处
④「第二份完整写入」实际是残片
⑤ 验收写 test:gates 而那条命令【不含】被测文件
⑥「全跳过」被画成 ✓
⑦ 读了上游的排除列表，当成我们的
⑧ 引的锚点字符串属于另两个测试
⑨ 写「六处精确匹配」，实测 12 处
```

**⇒ 需求:每一层读数都必须有【第三态】，且它不许退化成"否"或"低分"：**
```
判据      ok / blocked / unmeasured          ✅ src/gates/registry.ts
飞轮      promote / observe / archive / unmeasured   ✅ src/confidence.ts
采集      true / false / undefined           ✅ src/evolution/collect.ts
分流      hard / soft / contract / none / unmeasured  ✅ src/evolution/types.ts
收益      improved / unchanged / unmeasured   ✅ src/evaluator/effect.ts
评估      effective / ineffective / unmeasured ⚠️ 待接
```

★★ **而两处已实测的推论:**
```
★ 评估器:verdict unmeasured ⇒ probability 【必为 undefined】
  ——"一个数字挂在弃权上会被读成低把握的判断"（t92 实测，40 臂）
★ 候选:无基线（before===0）与「降了但幅度小」【不同形】（t92 三条反向半边）
```

---

## 5. ★★ 采集：该不该采（第七个插入点）

**判据**:用户批准 + AutoLibra 的 redundancy/coverage · **现状**:✅ · **证据**:`src/gates/collection/`

```
INSERTION_POINTS 七个 · 共 21 条判据 · 3 个生产调用点
  （entities.ts:4136 · create-task.ts:616 · tools.ts:2124）

四条采集判据:dedupe · cooldown · attributable · immunity
★★ 而它防的第一件事不是"采错的"，而是"采重复的":
   MEASURED:372 条里唯一 (component,kind) 只有 54 对，
   dispatch·unwired 【161 条、持续 8 天】而无人发现
```

---

## 6. ★★★ 收益衡量：结构性判据，无阈值

**判据**:用户裁定 + 本仓实测（54 个桶里 49 个只有 1 条）· **现状**:✅ · **证据**:`src/evaluator/effect.ts`

```
before.count === 0         ⇒ unmeasured（无基线）
after.count <  before.count ⇒ improved（★ 无阈值:降了就是降了）
after.count >= before.count ⇒ unchanged
★ 而【幅度】作读数报出，★ 不进 verdict
```
★★ **依据**:MemOS 源码实测 —— `minEpisodesForInduction` 已被下调到 1，
注释反复记录「**真实使用中阈值永不触发**」⇒ **阈值该是提示开关，不是执行开关。**

★ **而「最小观察期」那个常量叫 `GUESSED_MIN_OBSERVATION_MS`** ——
**名字带 `GUESSED`、注释声明无依据、且可覆盖** ⇒
**一个猜测与一个测量在代码里不许同形。**

---

## 7. ★★ 判据要「一致性的三处登记」

**判据**:加一个插入点时实测踩到 `contract.task-atomicity` · **现状**:✅ · **证据**:`docs/PARALLELISM-BOTTLENECK.md`

```
加一个位置要改【五处】，而不是一处:
  ① registry.ts 的 INSERTION_POINTS
  ② types.ts 的 GATE_INSERTION_POINTS 镜像
  ③ GATE_DIRS（verify-gate-tristate，★ 已改为从 INSERTION_POINTS 派生）
  ④ 装配清单 + 注释槽位
  ⑤ ★ NEW_POSITION_GATES（gate-index-assembly）
★ 而 ③ 已改成派生 ⇒ 下次不会再漏那一处
```

---

## 8. ★★ 断言必须双向（反向半边）

**判据**:本会话反复受益 · **现状**:✅ 已成习惯 · **证据**:各夹具

```
★ 每条断言都要能在【反向】下变红 —— 否则它没有判别力
★ 而"两侧都测过"与"我以为两侧都测过"不同形

已实测的例子:
  · t92 把 stripLineAnchors 换成恒等 ⇒ 4/6 红（而没有它，"我保持了强度"无从证明）
  · t93 把三段拆开跑 12 次并发 ⇒ unique 1/12（串行化后 12/12）
  · t95 stash 全部修复 ⇒ 5 条臂里 4 条红
  · t76 的"集合差"取代"计数比"（未提交文件会让计数虚高）
```

★ **而净变化的判定一律用【失败文件集合】，不靠计数** ——
**本会话实测同树两次跑得 `1429/21` 与 `1427/23`（计数会抖动）。**

---

*本文件是【需求清单】，不是计划。未裁定的提案在 `docs/DECISIONS-PENDING.md`。*
