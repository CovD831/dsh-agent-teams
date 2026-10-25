# 像素风 UI 调研 · 第二份：文献与生态（2026-10-17）

> 两份子代理调研的**汇总 + 队长复核**。★ 只保留**有出处**的，并把**不能信的**标出来。

---

## 0. ★★★ 最重要的发现：**DSH 里已经有一个同类插件了**

**实测（raw 路径 200）：`xx-ytg/dsh-agent-office`**

**它自己的话（逐字）:**
> 「**Tiny coworkers. Real work.** Watch your DeepSeek Harness agents work in a living pixel office.」
> 「Your agents **leave their desks to use tools**, **queue up when they need approval**,
>  and **take a breather when a turn finishes**. **Click a coworker to inspect their activity.**
>  ★ **Everything in live mode comes from Harness session events.**」
> 「MIT · **Zero runtime dependencies** · No extra API key」

### ★★ 而它的状态集实测是 **7 种**

```
working · waiting · blocked · idle · done · error · paused
```
（★ 从 `src/store.mjs` 里数出来的）

### ★★★ 而它与我们**有一个关键差别**

> 「The first release is a **separate browser dashboard,
>  not an embedded Harness sidebar** or an operating-system desktop overlay.」

⇒ ★★★ **即:它是【独立网页】，而我们是【DSH 内部的 panel】。**
**★ 那意味着它抢不走我们的位置 —— 而我们必须从它学。**

### ★★ 而它做了那份文献说**不该做**的事

```
★ 它让角色【离开工位去用工具】（leave their desks to use tools）
★★ 而文献说:「Don't auto-re-arrange on state change」——
   「the single most seductive pixel-art idea… directly contradicts
     Data Mountain / Cockburn / Steinbrückner」
⇒ ★★★ 所以我们要【不学它这一条】，而那条正是最好看的部分
```

---

## 1. ★★★ 文献的第一结论：**空间形式买到的是"位置记忆"，不是"变化检测"**

> 「Data Mountain **does take advantage of spatial memory**… statistically reliable advantages
>  over the Microsoft Internet Explorer Favorites mechanism」（UIST 1998，497 引）
> 「**the effectiveness of spatial memory is unaffected** by the presence or absence of
>  three-dimensional perspective effects」（Cockburn & McKenzie 2004）

⇒ ★★★ **而那句"不是变化检测"是关键:**
```
★ 文献【没有人】声称空间布局能让你【更快注意到状态变化】
★★ 而"注意到变化"【正是 agent 看板存在的理由】
⇒ ★★★ 所以:【房间负责氛围与归属，列表负责状态与变化】—— 而【绝不能只有房间】
```

### ★★★ 而那条**最强的旁证来自一个已上线的项目**

```
★ pixel-agents（★9749）的两个线上 bug:
   #272「Agent Labels Overlap and Become Unreadable When Multiple Agents Are Close Together」
   #380「Named sub-agents don't get their own seat… all 3 spawn on the same tile」
★★ 而它自己的 v1.5.0 修法:
   「Agent cards — Every agent gets a mug shot and status dot
     along the office's **right edge**; clicking one raises its terminal」
⇒ ★★★ 即:【一个已上线的项目独立走到了"光有场景不够，需要场景外的常驻名册"】
```

---

## 2. ★★★ 六个有出处的"别做"

| # | 别做什么 | 出处 | 为什么 |
|---|---|---|---|
| **①** | ★★ **别自动重排**（状态变了就换工位）| Steinbrückner 2013（software cities 必须保持位置稳定）+ Cockburn 2004 | ★ 它【摧毁唯一被测量到的收益】（位置记忆）|
| **②** | ★★ **别连续动画** | Nowell 2001（change blindness）+ Drew 2014（**255 万次报警，88.8% 误报**）| ★ 一直动会让"注意变化"的机制**脱敏** |
| **③** | ★ **别用 3D/透视** | Sebrechts 1999（「high interface costs for the 3D」）| ★ 而 Cockburn 说透视**不加分** ⇒ 2D 像素**白赚** |
| **④** | ★ **别让世界成为唯一界面** | Microsoft Bob（**隐喻替换了对象**，被骂到下架）+ Magic Cap | ★ 每个东西都要有**非空间的等价入口** |
| **⑤** | ★★ **别靠 sprite 认人（>8 人）** | pixel-agents 只有 **6 个角色**却要显示 10+ agent | ★ 重复 sprite ⇒ 身份只能靠标签 ⇒ 而标签会重叠 |
| **⑥** | ★ **别把通知做成无上限** | PTK（peripheral display 必须有「**分配通知等级的规则**」）| ★ 那是**必需子系统**，不是锦上添花 |

---

## 3. ★★ 三条被测量的**约束数字**（而那些是唯一能引的）

```
★ 工作记忆 ≈ 4 个对象（Luck & Vogel 1997）
★★ 而【场景】的工作记忆平台约 2 个（Yokosawa & Li 2018）
★ 而【分类颜色】的判断随类数增加而变难，测到 2–10 类（CHI 2023）
⇒ ★★★ 所以:【≤5 个分类色，且永不作为唯一通道】
```

★★★ **而两份调研都强调了一件我该记的事:**
> 「**There is no peer-reviewed number for "N distinct states distinguishable at a glance."
>  I looked. Don't let anyone quote one to you.**」
> ★ 而被误引最多的是 **Miller 1956 的 7±2** —— **而那是"瞬时言语记忆"，不是"视觉状态解码"。**

⇒ ★★ **所以"一屏能看几个"这件事【没有文献答案】。**
★ **而它俩给了同一个替代指标:**
```
★ Olsen & Goodrich 2003 的 **fan-out**（一个操作者能管多少个）
★★ 以及 **neglect time**（多久没看 = 失控）
⇒ ★★★ 而那正是我们的 KPI:【"多久之后你才会发现某个成员卡住了"】
   ★ 而【不是"好看不好看"】
```

---

## 4. ★★★ 而最有说服力的诊断

> 「the spatial digital office genre's failures are **not about pixel art**;
>  they're about it being **a place you must GO TO rather than a thing you GLANCE AT**」
> —— 而证据是 Gather / Sococo / Teamflow 的商业困境，以及 Gather 那个**真正起作用的**
> 报告里说的是「**预约 + 社交在场**」，**不是地图**。

⇒ ★★★ **所以我们的形态必须是【瞥一眼】，不是【走进去】。**
**★ 而那与我们已有的"成员为主屏"是同一个结论。**

---

## 5. ★★ 而资产成本那条已被实测钉死

```
★ Star-Office-UI:美术 13.5 MB : 代码 0.28 MB = 【48 : 1】
★★ 而它的 LICENSE 逐字:「art assets for non-commercial learning only」
⇒ ★★★ 所以我们只能用【程序化像素】（Tier 0/1）:
   · Tier 0:纯 rect 程序化（cubicle:0 图片文件，375 KB html）
   · Tier 1:字符串网格 → SVG rect（pixel-openspace:8×12 px 用字符串描述，
     跑长合并成 rect，0 图片字节，可 diff、可改色）
⇒ ★★ 而 Tier 1 正是我们该走的那档
```

---

## 6. ★ 一条我如实说的（两份调研共同的诚实边界）

```
★★ 两边的 web_search 都【坏了】（HTTP 401）
★ 所以它们都绕道 GitHub API / OpenAlex / calmtech.com / HN Algolia
★★ 而 GitHub API 配额后来也耗尽了（60/h）⇒ 部分星数是【当时读数】
⇒ ★★★ 所以"genre 叫什么"这个问题【没有答案】——
   而它们都说清了，没有编
```

★ **而最接近的名字是「calm technology / ambient awareness」（Weiser & Brown 1995/96）** ——
**但它俩都提醒:那是【原则】，不是【这个实现的名字】。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
