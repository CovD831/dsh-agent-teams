#!/usr/bin/env python3
"""整体模块图：现状 + 自进化模块的接口位置。"""

W, H = 1240, 940

def esc(s):
    return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def t(x, y, s, cls='t', anchor='start'):
    a = f' text-anchor="{anchor}"' if anchor != 'start' else ''
    return f'<text x="{x}" y="{y}" class="{cls}"{a}>{esc(s)}</text>'

def box(x, y, w, h, cls='card', rx=5):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"/>'

b = []
b.append(t(24, 32, 'Agent Teams 整体模块图', 'h1'))
b.append(t(24, 50, '现状 28 个顶层模块 · 51056 行 · 17 条判据 · 384 条卡点 —— 以及自进化模块该接在哪', 'dim'))

# ── 第一层：宿主与装配 ────────────────────────────────────────────────────
b.append(t(24, 84, '① 装配层（插件怎么起来的）', 'h2'))
row1 = [
    (24,  'index.ts',       '挂载 · prompt section(117)', 'ok'),
    (24,  'capabilities.ts','队长/成员 prompt 注入', 'ok'),
    (24,  'profiles.ts',    'profile 模板（seed/captain）', 'ok'),
    (24,  'web-routes.ts',  '/plugins/... 路由', 'ok'),
    (24,  'harness-compat.ts','宿主 API 兼容', 'ok'),
]
cw = 236
for i, (_, name, desc, tone) in enumerate(row1):
    x = 24 + i * (cw + 8)
    b.append(box(x, 96, cw, 54))
    b.append(t(x + 12, 118, name, 'name'))
    b.append(t(x + 12, 136, desc, 'dim'))

# ── 第二层：判据（硬约束）───────────────────────────────────────────────
b.append(t(24, 186, '② 判据层（硬约束 · 17 条 · 六位置全接）', 'h2'))
segs = [('admission','3'),('contract','3'),('dispatch','3'),
        ('completion','4'),('delivery','2'),('runtime','2')]
sw = 196
for i, (n, c) in enumerate(segs):
    x = 24 + i * (sw + 8)
    b.append(box(x, 198, sw, 46, 'card-hard'))
    b.append(t(x + 12, 218, n, 'name'))
    b.append(t(x + 12, 236, c + ' 条', 'dim'))
b.append(t(24, 264, 'registry.ts  INSERTION_POINTS（顺序即流程）· evaluate(point, ctx) · list() ⇒ 六位置逐条 id+description', 'dim'))

# ── 第三层：编排（调度）─────────────────────────────────────────────────
b.append(t(24, 306, '③ 编排层（谁做哪个任务）', 'h2'))
row3 = [
    (24,  'scheduler.ts',  '派发就绪任务'),
    (24,  'state/',        '持久化 + 类型 + 状态机'),
    (24,  'tools.ts',      '工具汇合点（闸门拒绝在这）'),
    (24,  'tools/',        'create/update/claim/reassign...'),
    (24,  'members.ts',    'spawnMember + persona'),
    (24,  'worktree.ts',   '隔离'),
]
cw3 = 196
for i, (_, name, desc) in enumerate(row3):
    x = 24 + i * (cw3 + 8)
    b.append(box(x, 318, cw3, 50))
    b.append(t(x + 12, 340, name, 'name'))
    b.append(t(x + 12, 358, desc, 'dim'))

# ── 第四层：投影（→ 前端）─────────────────────────────────────────────
b.append(t(24, 400, '④ 投影层（后端 → 前端，前端【不认识】具体模块）', 'h2'))
b.append(box(24, 412, 600, 50, 'card-proj'))
b.append(t(38, 434, 'snapshot.ts  assembleTeamSnapshot', 'name'))
b.append(t(38, 452, 'tasks / members / gateCatalog / strandedWork → /state', 'dim'))
b.append(box(632, 412, 584, 50, 'card-proj'))
b.append(t(646, 434, 'client/  17 个组件', 'name'))
b.append(t(646, 452, 'memberGateReadouts · charColumns · 六态 · 两行式', 'dim'))

# ── 分隔 ────────────────────────────────────────────────────────────────
b.append(f'<line x1="24" y1="486" x2="{W-24}" y2="486" class="ln"/>')

# ── 自进化模块（新增）────────────────────────────────────────────────────
b.append(t(24, 514, '⑤ ★★★ 自进化模块（新）—— 而它【只通过一个出口】与别人发生关系', 'h2'))

# 采集层的三个汇合点
b.append(t(24, 544, '采集层：宿主在【既有的】失败/成功汇合点上调用一次 observe()', 'note'))
merges = [
    ('recordFriction()', 'entities.ts:3805', '所有判据拒绝', '已在'),
    ('工具拒绝抛出点',    'tools.ts',          '闸门拒绝',     '★ 新增'),
    ('契约校验',          'quality-gates.ts:843', '契约类',   '★ 新增'),
]
for i, (name, where, what, tag) in enumerate(merges):
    x = 24 + i * 300
    cls = 'card-hard' if tag == '已在' else 'card-new'
    b.append(box(x, 554, 290, 52, cls))
    b.append(t(x + 12, 574, name, 'name'))
    b.append(t(x + 12, 590, where + ' · ' + what, 'dim'))
    b.append(t(x + 276, 590, tag, 'new' if tag != '已在' else 'ok', anchor='end'))

# 自进化模块内部
b.append(box(24, 620, W - 48, 172, 'card-evo'))
b.append(t(40, 644, 'src/evolution/   ← ★ 新模块，唯一出口 index.ts', 'name'))
inner = [
    ('types.ts',   '信号 / 记录 / 裁决的形状'),
    ('collect.ts', '① 采集：observe(signal)'),
    ('classify.ts','② 分类：复用既有 9 类 taxonomy'),
    ('route.ts',   '③ ★ 分流：soft | hard | unmeasured'),
    ('verify.ts',  '④ ★ 验证闸：复用 test:gates / verify:fast'),
    ('promote.ts', '⑤ 晋升：L2 profile → L1 代码'),
]
for i, (name, desc) in enumerate(inner):
    x = 40 + (i % 3) * 392
    y = 660 + (i // 3) * 56
    b.append(box(x, y, 378, 46, 'card-inner'))
    b.append(t(x + 12, y + 20, name, 'name'))
    b.append(t(x + 12, y + 37, desc, 'dim'))

b.append(t(40, 782, '★ 只读别人的：registry.list() · frictions/*.json · team.json      ★ 不写别人的状态', 'note'))

# ── 隔离规则 ────────────────────────────────────────────────────────────
b.append(t(24, 826, '⑥ ★★★ 三条不许侵入的规则（用户硬约束）', 'h2'))
rules = [
    'A. 别人 → evolution：★ 只许 import src/evolution/index.ts（不许深入 collect.ts 这类路径）',
    'B. evolution → 别人：★ 只读。要影响别人 ⇒ 发信号给宿主，不直接改',
    'C. 采集点：★ 别的模块【不许】主动调用采集 —— 由宿主在【既有汇合点】调用一次',
]
for i, r in enumerate(rules):
    b.append(t(32, 848 + i * 20, r, 'note'))

b.append(t(24, 916, '★ 而 confidence.ts（飞轮公式 · 双计数 · 三阈值）保持纯算法，被 evolution 调用 —— 它现在零读者', 'dim'))

HEAD = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="-apple-system, 'PingFang SC', sans-serif">
<style>
  .bg{{fill:#16191d}}
  .h1{{fill:#e8eaed;font-size:19px;font-weight:600}}
  .h2{{fill:#c8ccd1;font-size:13px;font-weight:600}}
  .t{{fill:#b8bec5;font-size:11.5px}}
  .name{{fill:#e8eaed;font-size:12px;font-weight:500}}
  .dim{{fill:#6f7780;font-size:10.5px}}
  .note{{fill:#8b939c;font-size:10.5px}}
  .ok{{fill:#5fbf7f;font-size:10.5px}}
  .new{{fill:#5b9dd9;font-size:10.5px}}
  .ln{{stroke:#2b3036;stroke-width:1}}
  .card{{fill:#22262b;stroke:#33383e;stroke-width:1}}
  .card-hard{{fill:#1e2a22;stroke:#3a6a4a;stroke-width:1}}
  .card-proj{{fill:#1e2630;stroke:#3a5a7a;stroke-width:1}}
  .card-new{{fill:#1e2630;stroke:#5b9dd9;stroke-width:1}}
  .card-evo{{fill:#1a1d24;stroke:#4d6bfe;stroke-width:1.5}}
  .card-inner{{fill:#22262b;stroke:#3a4250;stroke-width:1}}
</style>
<rect width="{w}" height="{h}" class="bg"/>
{body}
</svg>
'''

open('docs/module-map.svg','w',encoding='utf8').write(HEAD.format(w=W,h=H,body='\n'.join(b)))
print(f'  ✓ docs/module-map.svg ({W}×{H})')
