#!/usr/bin/env python3
"""画三张 UI 形态样张（A/B/C）。每条【按它真实的容器宽度】画，不放宽。"""

W_SIDE = 360      # 侧边栏真实宽度（@container max-width: 360px 那一档）
W_MAIN = 1200     # 主区（B1 样张的宽度）

HEAD = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif">
<rect width="{w}" height="{h}" fill="#1a1d21"/>
<style>
  .bg{{fill:#1a1d21}} .card{{fill:#22262b;stroke:#33383e;stroke-width:1}}
  .hdr{{fill:#2a2f36}} .t{{fill:#e6e8ea;font-size:12px}} .dim{{fill:#8b939c;font-size:10px}}
  .ok{{fill:#5fbf7f}} .bad{{fill:#e06c6c}} .skip{{fill:#8b939c}} .live{{fill:#e0a35c}}
  .obs{{fill:#e0a35c}} .mono{{font-family:'SF Mono',Menlo,monospace}}
  .tabon{{fill:#2f3a46;stroke:#4d6bfe;stroke-width:1}} .taboff{{fill:#22262b;stroke:#33383e;stroke-width:1}}
  .ln{{stroke:#33383e;stroke-width:1}} .bar{{fill:#4d6bfe}} .bar2{{fill:#e0a35c}}
</style>
<rect width="{w}" height="{h}" class="bg"/>
{body}
</svg>
'''

def txt(x, y, s, cls='t', anchor='start', size=None, weight=None):
    a = f' text-anchor="{anchor}"' if anchor != 'start' else ''
    sz = f' font-size="{size}"' if size else ''
    wt = f' font-weight="{weight}"' if weight else ''
    esc = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return f'<text x="{x}" y="{y}" class="{cls}"{a}{sz}{wt}>{esc}</text>'

def rect(x, y, w, h, cls='card', rx=4):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"/>'

# ─────────────────────────────────────────────────────────────────────
# 样张 A：同一面板【切换】—— 侧边栏 360px，管线图必须纵向化
# ─────────────────────────────────────────────────────────────────────
def mock_a():
    b = []
    b.append(rect(0, 0, W_SIDE, 34, 'hdr', 0))
    b.append(txt(12, 22, 'Agent Team', 't', weight='600'))
    # 两个 tab
    b.append(rect(120, 6, 82, 22, 'tabon'))
    b.append(txt(161, 21, '成员', 't', anchor='middle'))
    b.append(rect(206, 6, 82, 22, 'taboff'))
    b.append(txt(247, 21, '管线', 't', anchor='middle'))
    b.append(txt(300, 21, '┃ 2 在跑', 'live', anchor='start'))

    # ★ 纵向管线（360px 下唯一可行）
    y = 48
    b.append(txt(12, y, 't77 · implementation · 第 1 轮', 'dim'))
    y += 6
    b.append(f'<line x1="12" y1="{y}" x2="{W_SIDE-12}" y2="{y}" class="ln"/>')
    y += 20

    stages = [
        ('contract',   '✓✓✓',        'ok',   False),
        ('dispatch',   '✓✓⊘',        'ok',   False),
        ('completion', '●○○○',       'live', False),
        ('delivery',   '○○',          'dim',  False),
        ('admission',  '—',           'dim',  True),
        ('runtime',    '✗✗',          'bad',  False),
    ]
    for name, sym, tone, unreg in stages:
        # 竖排：左侧一条轴
        b.append(f'<circle cx="20" cy="{y-4}" r="3" class="{tone}"/>')
        if name != 'runtime':
            b.append(f'<line x1="20" y1="{y-1}" x2="20" y2="{y+16}" class="ln"/>')
        b.append(txt(32, y, name, 't'))
        scls = {'ok':'ok','bad':'bad','skip':'skip','live':'live','dim':'dim'}[tone]
        b.append(txt(W_SIDE-14, y, sym, scls, anchor='end', size='13'))
        if name == 'admission':
            b.append(txt(32, y+12, '未接入', 'skip', size='9'))
        y += 30

    y += 4
    b.append(f'<line x1="12" y1="{y}" x2="{W_SIDE-12}" y2="{y}" class="ln"/>')
    y += 18
    b.append(txt(12, y, '▶ completion.mutation', 'live'))
    y += 14
    b.append(txt(12, y, '运行中 · 变异 8/14 · 2m', 'dim'))
    return '\n'.join(b), 300

# ─────────────────────────────────────────────────────────────────────
# 样张 B：管线图【开到主区】—— 1200px，四列并排（B1 原样）
# ─────────────────────────────────────────────────────────────────────
def mock_b():
    b = []
    b.append(rect(0, 0, W_MAIN, 30, 'hdr', 0))
    b.append(txt(14, 20, '主对话区  ← ★ 管线图搬到这儿，侧边栏留成员', 'dim'))
    b.append(rect(500, 4, 90, 22, 'tabon'))
    b.append(txt(545, 19, '成员', 'dim', anchor='middle'))
    b.append(rect(596, 4, 90, 22, 'taboff'))
    b.append(txt(641, 19, '管线图', 't', anchor='middle'))

    y = 56
    b.append(txt(20, y, 't77 · implementation · 第 1 轮', 't', size='14', weight='600'))
    b.append(txt(320, y, '● 进行中', 'live'))
    b.append(txt(400, y, '43m', 'dim'))
    b.append(txt(1160, y, '⚑2 观察', 'obs', anchor='end'))
    y += 10
    b.append(f'<line x1="20" y1="{y}" x2="{W_MAIN-20}" y2="{y}" class="ln"/>')
    y += 28

    colw = 285
    cols = [
        ('contract',   [('contract.verify-command','✓'),('contract.build-artifact','✓'),('contract.task-atomicity','✓')]),
        ('dispatch',   [('dispatch.worktree','✓'),('dispatch.plan-reviewed','✓'),('dispatch.changed-paths','⊘')]),
        ('completion', [('completion.verify-rerun','●'),('completion.r5','○'),('completion.mutation','○'),('completion.backtest','○')]),
        ('delivery',   [('delivery.coverage','○'),('delivery.convergence','○')]),
    ]
    for i, (name, rows) in enumerate(cols):
        x = 20 + i * (colw + 8)
        b.append(rect(x, y, colw, 20 + len(rows)*20, 'card'))
        b.append(txt(x+10, y+15, name, 't', weight='600'))
        b.append(txt(x+colw-10, y+15, f'{len(rows)} 条', 'dim', anchor='end'))
        ry = y + 34
        for rname, sym in rows:
            cls = {'✓':'ok','⊘':'skip','●':'live','✗':'bad','○':'dim'}[sym]
            b.append(f'<circle cx="{x+14}" cy="{ry-4}" r="3" class="{cls}"/>')
            b.append(txt(x+24, ry, rname, 'dim', size='9'))
            b.append(txt(x+colw-12, ry, sym, cls, anchor='end', size='12'))
            ry += 20

    y += 20 + 4*20 + 24
    b.append(rect(20, y, W_MAIN-40, 54, 'card'))
    b.append(txt(34, y+20, '★ 未检查（skippedAll 在场）', 'obs'))
    b.append(txt(34, y+38, 'completion  ⊘⊘⊘⊘   0 跑 / 4 跳过  ⇒ ★未检查', 'obs', size='11'))
    y += 70
    b.append(rect(20, y, W_MAIN-40, 54, 'card'))
    b.append(txt(34, y+20, '★ 观察模式（observed）—— 开火了、裁决被放过', 'obs'))
    b.append(txt(34, y+38, '✗ 加琥珀底纹 · 位置级 ⚑2', 'obs', size='11'))
    return '\n'.join(b), y + 76

# ─────────────────────────────────────────────────────────────────────
# 样张 C：按容器【重排】—— 同一份数据，宽窄两套布局
# ─────────────────────────────────────────────────────────────────────
def mock_c():
    b = []
    b.append(rect(0, 0, W_MAIN, 28, 'hdr', 0))
    b.append(txt(14, 19, '样张 C：同一份数据，按容器宽度【自动重排】', 't', weight='600'))

    # 左：窄（360）
    b.append(txt(20, 54, '① 侧边栏 360px → 纵向', 'dim', weight='600'))
    bx, by = 20, 66
    b.append(rect(bx, by, 360, 250, 'card'))
    yy = by + 22
    b.append(txt(bx+12, yy, 't77 · implementation', 't', weight='600'))
    yy += 16
    for name, sym, cls in [('contract','✓✓✓','ok'),('dispatch','✓✓⊘','ok'),
                            ('completion','●○○○','live'),('delivery','○○','dim')]:
        b.append(f'<circle cx="{bx+18}" cy="{yy-4}" r="3" class="{cls}"/>')
        b.append(txt(bx+30, yy, name, 'dim'))
        b.append(txt(bx+348, yy, sym, cls, anchor='end', size='12'))
        yy += 22
    b.append(txt(bx+12, yy+6, '★ 窄时只给"点 + 计数"，不展开逐条', 'skip', size='9'))
    b.append(txt(bx+12, yy+22, '★ 展开态改为【点进去看】，占满整个面板', 'skip', size='9'))

    # 右：宽（1000+）
    b.append(txt(410, 54, '② 主区/宽容器 ≥1000px → 横向四列', 'dim', weight='600'))
    bx2, by2 = 410, 66
    b.append(rect(bx2, by2, 760, 250, 'card'))
    b.append(txt(bx2+12, by2+22, 't77 · implementation · 第 1 轮', 't', weight='600'))
    cw = 178
    for i, (name, rows) in enumerate([
        ('contract', ['verify-command','build-artifact','task-atomicity']),
        ('dispatch', ['worktree','plan-reviewed','changed-paths']),
        ('completion', ['verify-rerun','r5','mutation','backtest']),
        ('delivery', ['coverage','convergence'])]):
        x = bx2 + 12 + i*(cw+6)
        yy = by2 + 36
        b.append(txt(x, yy, name, 't', weight='600'))
        yy += 14
        b.append(f'<line x1="{x}" y1="{yy}" x2="{x+cw-8}" y2="{yy}" class="ln"/>')
        yy += 14
        for r in rows:
            b.append(f'<circle cx="{x+4}" cy="{yy-4}" r="2.5" class="ok"/>')
            b.append(txt(x+12, yy, r, 'dim', size='9'))
            yy += 16

    b.append(txt(20, 350, '★ C 的关键：不是"两个视图"，而是【一份数据 + 两套布局】—— 一个组件，两个断点', 'obs'))
    b.append(txt(20, 372, '★ 好处：不需要新 slot、不需要切换交互；坏处：要维护两套排版', 'skip', size='10'))
    return '\n'.join(b), 400

for tag, fn, w in [('A', mock_a, W_SIDE), ('B', mock_b, W_MAIN), ('C', mock_c, W_MAIN)]:
    body, h = fn()
    out = HEAD.format(w=w, h=h, body=body)
    p = f'docs/ui-form-{tag}.svg'
    open(p, 'w', encoding='utf8').write(out)
    print(f'  ✓ {p}  ({w}×{h})')
