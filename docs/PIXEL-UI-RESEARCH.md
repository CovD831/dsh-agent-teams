# 像素风 UI 调研：已核实的事实（2026-10-17）

> **用户裁定**「**先定一个大致的风格,像素风**,然后去做**广泛调研**,
>  不一定是公司形式吧,但是得是**像素风**,像素风好做」
>
> ★ 本文只写**队长亲手核实过的**,子代理的调研另附。

---

## 1. ★★★ 最接近的先例：`ringhyacinth/Star-Office-UI`（★7522）

**它的定位（逐字）:**
> 「**一个像素风格的 AI 办公室看板** —— 把 AI 助手的工作状态实时可视化,
>  让你直观看到"**谁在做什么、昨天做了什么、现在是否在线**"。
>  支持多 Agent 协作、中英日三语、AI 生图装修、桌面宠物模式。」

### ★★★ 而它的核心机制**极简单** —— 值得抄

```js
// frontend/game.js
const STATES = {
  idle:        { name: '待命',     area: 'breakroom' },
  writing:     { name: '整理文档', area: 'writing' },
  researching: { name: '搜索信息', area: 'researching' },
  executing:   { name: '执行任务', area: 'writing' },     // ★ 与 writing 同区
  syncing:     { name: '同步备份', area: 'writing' },     // ★ 同一个
  error:       { name: '出错了',   area: 'error' },
};
```

⇒ ★★★ **6 种状态 → 只有 4 个区域**:
```
★ 角色【走到哪个区域】= 大状态（4 个可见的格）
★★ 而【气泡文字】  = 具体在做什么（那 6 种的差别在这里）
⇒ ★★★ 即:【空间编码粗粒度,文字编码细粒度】
```

★ **而这条设计是对的**,理由:★ **4 个区域是"一眼能数清"的,而 6 种状态不是。**

### ★★★ 而它的成本结构是**决定性的**

```
$ frontend 目录
  文件数 45 · 总计 13.8 MB
  ★ 而代码只有:game.js 35 KB + index.html 241 KB + layout.js 2 KB ≈ 280 KB
⇒ ★★★ 即:【美术 13.5 MB : 代码 0.28 MB = 48 : 1】
```

**而最大的几块全是位图:**
```
cats-spritesheet.webp              ★ 581 KB
coffee-machine-v3-grid.webp       ★ 2.5 MB
error-bug-spritesheet-grid.webp   ★ 1.9 MB
flowers-bloom-v2.webp             ★ 349 KB
desk-v3.webp                        53 KB
```

⇒ ★★★ **所以"像素风好做"这句话要分两半:**
```
✅ 代码【极好做】—— 35 KB 的 canvas 2d 循环
★★ 而【好看】的成本全在美术素材 —— 而那是【13.5 MB 的位图】
```

### ★★ 而它的渲染技术**极朴**（不是 Phaser）

```
$ grep game.js
  getContext('2d')   ×1
  new Image(         ×1
  sprite             ×45
⇒ ★★ 就是 canvas 2d + <img> 位图，★ 而 topics 里的 phaser 是【误导】
```

★ **而那对我们有直接意义:**
```
★ 我们【不许】引入 13.5 MB 位图（★ 插件体积 + 版权:它的 LICENSE 写明
  "art assets for non-commercial learning only"）
★★ 所以我们的路只有:【纯 CSS + 内联 SVG】—— 而那已有先例（FolderGlyph）
```

---

## 2. ★★★ 而我们的数据比它**丰富得多**

**实测 `TeamActivityMember`:**
```
id · name · role · provider · model · reasoningEffort · executionPrompt
status:   idle · working · removed
activity: working · idle · unknown
liveness: working(live-running) · idle(live-idle)
        · not-live(driver-absent) · never-spawned
```

**而团队/任务层还有:**
```
★ 判据位置:7 个插入点（admission · contract · dispatch · completion · delivery · runtime · collection）
★★ 21 条判据的裁决（三态 + 六种字形）
★ 任务:状态 · 轮次 · 依赖图
```

⇒ ★★★ **所以照搬它的"4 区域"会【丢信息】。**

### ★★ 而它给了一个更好的思路

```
★ 它用【空间】编码粗粒度（4 区域），用【文字】编码细粒度（6 状态）
⇒ ★★★ 而我们有三层粒度可用:
   ① 空间（区域/工位）      ⇒ ★ 粗:在忙 / 在等 / 不在 / 有问题
   ② 像素小人（姿态/动画）  ⇒ ★ 中:working / idle / never-spawned
   ③ 气泡文字 + 角标        ⇒ ★ 细:哪个任务 · 哪个判据 · 第几轮
```

---

## 3. ★ 三条已核实的"不该抄"

| # | 它的做法 | 为什么我们不抄 |
|---|---|---|
| **①** | ★ **13.5 MB 位图素材** | ★ 插件体积 + **版权**（它自己写明仅非商业学习）|
| **②** | ★ 6 状态 → 4 区域 | ★★ 我们状态更多（`liveness` 有 4 值，且与 `activity` 并列）|
| **③** | 单 Agent 视角（"AI 助手"）| ★ 我们是**多成员**，且要显示**判据** |

---

## 4. ★★ 而它验证了一件事：**这个形态是有人要的**

```
★ 7522 星
★★ 而它的描述里那句「turn invisible work states into a cozy little space」
   ⇒ ★★★ 那正是我们的处境:成员在干活,而【工作是不可见的】
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
