#!/usr/bin/env python3
"""重构地图：12 条线 + 三个层次。"""

W, H = 1180, 860

def esc(s):
    return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def t(x, y, s, cls='t', anchor='start'):
    a = f' text-anchor="{anchor}"' if anchor != 'start' else ''
    return f'<text x="{x}" y="{y}" class="{cls}"{a}>{esc(s)}</text>'

def box(x, y, w, h, cls='card', rx=6):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"/>'

b = []

# ── 标题 ──────────────────────────────────────────────────────────────────
b.append(t(24, 34, 'Agent Teams 重构地图', 'h1'))
b.append(t(24, 54, '12 条线 · 71 个 commit · src/ 93 文件 51056 行', 'dim'))

# ── 三个层次（核心结构）────────────────────────────────────────────────────
b.append(t(24, 92, '① 分层：三条线各管一层', 'h2'))

layers = [
    (24,  'E 结构重构', '拆大文件、去死代码', '45 个模块', 'ok'),
    (24,  'M 模块拆分', 'mutation / QG-A / state 各拆一次', '51k → 93 文件', 'ok'),
    (24,  'N 盘局地图', '把"哪里有东西"画出来', 'PLATE-MAP.md', 'ok'),
]
# 画成三列
colw = 372
for i, (_, name, desc, out, tone) in enumerate(layers):
    x = 24 + i * (colw + 10)
    b.append(box(x, 104, colw, 66))
    b.append(t(x + 14, 128, name, 'name'))
    b.append(t(x + 14, 146, desc, 'dim'))
    b.append(t(x + colw - 14, 164, out, tone, anchor='end'))

# ── 判据体系（核心）────────────────────────────────────────────────────────
b.append(t(24, 206, '② 判据体系：6 个插入点 × 17 条判据 —— 而【哪一段落盘】是本轮的关键', 'h2'))

stages = [
    ('admission', '3 条未注册', 'empty'),
    ('contract',  '3 条', 'new'),
    ('dispatch',  '3 条', 'new'),
    ('completion','4 条', 'was'),
    ('delivery',  '2 条', 'team'),
    ('runtime',   '2 条', 'event'),
]
sw = 178
for i, (name, cnt, kind) in enumerate(stages):
    x = 24 + i * (sw + 8)
    cls = {'empty':'card-dim','new':'card-new','was':'card-was','team':'card-team','event':'card-team'}[kind]
    b.append(box(x, 218, sw, 62, cls))
    b.append(t(x + 12, 242, name, 'name'))
    b.append(t(x + 12, 260, cnt, 'dim'))
    tag = {'empty':'真的 0 条','new':'★ 乙：本轮新落盘','was':'S1 原有','team':'团队级','event':'事件级'}[kind]
    tc = {'empty':'dim','new':'new','was':'ok','team':'team','event':'team'}[kind]
    b.append(t(x + 12, 274, tag, tc))

b.append(t(24, 302, '⇒ ★ 四类"没有裁决"的成因必须不同形：0 条(真的没判据) · 团队级(不在任务上) · 未开始 · 未落盘', 'warn'))

# ── 重建的三块能力 ────────────────────────────────────────────────────────
b.append(t(24, 344, '③ 本轮重建的三块能力', 'h2'))
caps = [
    (24,  'S1 判据落盘',      'completion 段的裁决写进 task',        '★ 曾被我的 git add -A 静默删掉，已恢复+加判据'),
    (24,  '乙 按段落盘',       'contract/dispatch 两段也落盘',        '★ 新增 gateEvaluations（按段，不覆盖）'),
    (24,  'UI v4 重构',        '两行式 · 六态 · 去徽章 · 中文职责',    '★ 含 CJK 宽度表（零依赖，带对拍臂）'),
]
for i, (_, name, desc, note) in enumerate(caps):
    x = 24 + i * (colw + 10)
    b.append(box(x, 356, colw, 78))
    b.append(t(x + 14, 380, name, 'name'))
    b.append(t(x + 14, 398, desc, 'dim'))
    b.append(t(x + 14, 418, note, 'new'))

# ── 数据飞轮与被搁置的 ────────────────────────────────────────────────────
b.append(t(24, 472, '④ 已建但【未接线】的机制（如实记账）', 'h2'))
parked = [
    ('confidence.ts 双计数', '算得出来，但零调用方'),
    ('（无）poolForRescue',  '★ 更正：它【已接线】—— 写进卡点台账 resolution.pool'),
    ('admission.* 三条判据', '文件在，注册表从不注册'),
    ('deliverable-return',  '工具可用，但没做成闸门'),
    ('U 线参数化',          '5 行耦合，产品决策待定'),
]
for i, (name, why) in enumerate(parked):
    y = 484 + i * 26
    b.append(t(32, y + 12, '·', 'dim'))
    b.append(t(44, y + 12, name, 't'))
    b.append(t(340, y + 12, why, 'dim'))

# ── 工装缺陷（这是本轮真正修掉的东西）─────────────────────────────────────
b.append(t(620, 472, '⑤ 修掉的工装缺陷（T 编号）', 'h2'))
fixed = [
    ('T5  gate 死锁',      'lib/types/X.d.ts 是文件而同名目录也在'),
    ('T8  成对产物漏声明',  'tsdown 打包 ⇒ .map 跟 bundle 不跟源'),
    ('t74 声明两份',       '我 c32f0a5 的 git add -A 静默删了 S1'),
    ('t75 关键符号判据',    'wired ≠ still there'),
    ('t76 元判据',         '判据数不许减少（基准在 git 历史）'),
]
for i, (name, why) in enumerate(fixed):
    y = 484 + i * 26
    b.append(t(628, y + 12, '·', 'ok'))
    b.append(t(640, y + 12, name, 't'))
    b.append(t(880, y + 12, why, 'dim'))

# ── 底部：方法论 ──────────────────────────────────────────────────────────
b.append(box(24, 622, W - 48, 96, 'card-note'))
b.append(t(40, 648, '⑥ 本轮反复出现的三个形态（已记账）', 'h2'))
mm = [
    'A. 「它被删了」与「它从来没做过」在报告里同形  →  t75/t76 两条判据',
    'B. 「改了但没报」与「没改」同形              →  探针别名保留（t80）',
    'C. 「写了但没跑」与「跑了且通过」同形          →  对拍臂必须落到跑者里（t83）',
]
for i, line in enumerate(mm):
    b.append(t(40, 670 + i * 18, line, 'note'))

b.append(t(24, 742, '⑦ 而"契约由实测推翻"发生了 6 次 —— 其中 4 次是队长的规格错，由成员查出后先报不动手', 'dim'))
b.append(t(24, 762, '    · rejectOnContractGates 通过时不返回 { gates }（我引用的那两处是卡点台账的）', 'dim'))
b.append(t(24, 780, '    · UI 四态逻辑整体在 outOfScope 文件里（我落点判断错）', 'dim'))
b.append(t(24, 798, '    · types.ts 写不出我指定的类型（它是零 import 叶子，两条臂逐字钉住）', 'dim'))
b.append(t(24, 816, '    · GateEvaluationRecord 的两份声明（我去重时对象是零份，因为 S1 已被我删）', 'dim'))

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
  .warn{{fill:#e0a35c;font-size:11px}}
  .team{{fill:#8b7fd9;font-size:10.5px}}
  .empty{{fill:#6f7780;font-size:10.5px}}
  .card{{fill:#22262b;stroke:#33383e;stroke-width:1}}
  .card-dim{{fill:#1c1f23;stroke:#2b3036;stroke-width:1}}
  .card-new{{fill:#1e2630;stroke:#3a5a7a;stroke-width:1}}
  .card-was{{fill:#1e2a22;stroke:#3a6a4a;stroke-width:1}}
  .card-team{{fill:#241f2e;stroke:#4a3f6a;stroke-width:1}}
  .card-note{{fill:#1e2024;stroke:#33383e;stroke-width:1}}
</style>
<rect width="{w}" height="{h}" class="bg"/>
{body}
</svg>
'''

open('docs/refactor-map.svg','w',encoding='utf8').write(HEAD.format(w=W,h=H,body='\n'.join(b)))
print(f'  ✓ docs/refactor-map.svg ({W}×{H})')
