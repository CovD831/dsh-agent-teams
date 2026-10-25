#!/usr/bin/env python3
"""画风格样张：简约、文字为主、两行式、去徽章。"""

SIDE = 360

def esc(s):
    return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def t(x, y, s, cls='t', anchor='start'):
    a = f' text-anchor="{anchor}"' if anchor != 'start' else ''
    return f'<text x="{x}" y="{y}" class="{cls}"{a}>{esc(s)}</text>'

def build():
    b = []
    H = 300
    b.append(f'<rect width="{SIDE}" height="{H}" class="bg"/>')
    # 顶栏
    b.append(t(14, 22, 'Agent Team', 'hdr'))
    b.append(t(SIDE-14, 22, '6 名成员', 'dim', anchor='end'))
    b.append(f'<line x1="0" y1="32" x2="{SIDE}" y2="32" class="ln"/>')

    y = 54
    rows = [
        ('ui-hy4',  'UI engineer · hy4-preview',       'working', '在做 t77',      '第 1 轮 · completion 段 · 变异测试 8/14', 'live'),
        ('ui-dissect','UI anatomist · deepseek-v4.1',   'working', '在做 t78',      '第 1 轮 · completion 段 · 重跑验证',      'live'),
        ('test-triage','Test triage · deepseek-v4.1',   'idle',    '已完成 t76',    '第 3 轮 · 本轮已完成',                    'done'),
        ('archaeologist','Layer historian · deepseek-v4.1','idle','已完成 t74',    '第 3 轮 · 评审发现问题 · 继续下一轮',      'warn'),
        ('reviewer-glm','Reviewer · glm-5.3-flash',     'idle',    '已完成 t71',    '第 6 轮 · 本轮已完成',                    'done'),
        ('ui-engineer','UI engineer · deepseek-v4.1',   'idle',    't69 失败 · 待重派','第 5 轮 · 本轮已失败',                  'bad'),
    ]
    for name, role, act, doing, sub, tone in rows:
        if y > 40:
            b.append(f'<line x1="14" y1="{y-14}" x2="{SIDE-14}" y2="{y-14}" class="ln"/>')
        # 状态点（唯一保留的"装饰"，而它是信息）
        b.append(f'<circle cx="18" cy="{y-4}" r="3.5" class="{tone}"/>')
        # 第一行：名字（左） ……… 状态短语（右）★ 职责不再挤在这一行
        b.append(t(30, y, name, 'name'))
        b.append(t(SIDE-14, y, doing, 'doing', anchor='end'))
        # 第二行：职责 · 轮次 · 阶段 · 测试
        # ★ 第二行按【优先级】拼：阶段·测试 必留，职责放最后（可截断）
        b.append(t(30, y+15, sub, 'sub'))
        y += 44

    b.append(f'<line x1="0" y1="{y-14}" x2="{SIDE}" y2="{y-14}" class="ln"/>')
    return '\n'.join(b), H

HEAD = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="-apple-system, 'SF Pro Text', 'PingFang SC', sans-serif">
<style>
  .bg{{fill:#1c1f23}}
  .ln{{stroke:#2b3036;stroke-width:1}}
  .hdr{{fill:#c8ccd1;font-size:12px;font-weight:600;letter-spacing:.2px}}
  .dim{{fill:#6f7780;font-size:11px}}
  .name{{fill:#e8eaed;font-size:12.5px;font-weight:500}}
  .role{{fill:#6f7780;font-size:11px}}
  .doing{{fill:#b8bec5;font-size:11.5px}}
  .sub{{fill:#6f7780;font-size:10.5px}}
  .working{{fill:#5b9dd9}} .idle{{fill:#4a5158}} .live{{fill:#5b9dd9}}
  .done{{fill:#5fbf7f}} .warn{{fill:#e0a35c}} .bad{{fill:#e06c6c}}
</style>
<rect width="{w}" height="{h}" class="bg"/>
{body}
</svg>
'''

body, h = build()
open('docs/ui-style-mock.svg','w',encoding='utf8').write(HEAD.format(w=SIDE, h=h, body=body))
print(f'  ✓ docs/ui-style-mock.svg ({SIDE}×{h})')
