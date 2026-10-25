#!/usr/bin/env python3
"""三张架构图：契约、管线、采集。

★ 为什么是三张而不是一张：用户要的是「模块间契约」「运行管线」「采集模块」。
  塞进一张会有 60+ 个框，读不出边界。三张各回答一个问题。

★ 所有数字均**当场从代码量出**（2026-10-17）。不要在改代码后直接重跑；
  先确认那三组事实仍然成立，否则图会变成"看着像真的"。
"""
import html
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'docs'
W, H = 1420, 980

# ── 配色：与既有的 module-map.svg 同族（深底、低饱和、靠描边区分角色）──────
BG = '#16191d'
INK = '#e6e9ee'
DIM = '#8b94a3'
FAINT = '#5a6472'
CARD = '#1e232a'
EDGE = '#2b323c'
CONTRACT = '#6ea8fe'   # 契约（跨模块唯一入口）
PURE = '#7dd3a0'       # 纯函数层（零 I/O）
ORPHAN = '#e0a15c'     # 孤儿面（没有消费者）
BROKEN = '#e06c75'     # 断裂（流不到的地方）
STORE = '#b48ead'      # 磁盘真相


def esc(s):
    return html.escape(str(s), quote=True)


class Sheet:
    def __init__(self, title, subtitle, w=W, h=H):
        self.w, self.h = w, h
        self.body = []
        self.defs = []
        self.title = title
        self.subtitle = subtitle

    def rect(self, x, y, w, h, fill=CARD, stroke=EDGE, rx=8, sw=1.4, dash=None, op=1):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.body.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"{d}/>')

    def text(self, x, y, s, size=13, fill=INK, weight=400, anchor='start', mono=False, op=1):
        fam = ("font-family=\"'SF Mono', Menlo, monospace\"" if mono
               else "font-family=\"-apple-system, 'PingFang SC', sans-serif\"")
        self.body.append(
            f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" '
            f'font-weight="{weight}" text-anchor="{anchor}" {fam} opacity="{op}">{esc(s)}</text>')

    def label(self, x, y, s, color=INK, size=13, weight=600):
        """带底色块的标签，压在框的左上角。"""
        pad = 9
        wpx = len(s) * size * (0.72 if s.isascii() else 1.0) + pad * 2
        self.rect(x, y - size - 5, wpx, size + 11, fill=color, stroke='none', rx=4)
        self.text(x + pad, y, s, size=size - 1, fill='#12151a', weight=700)

    def arrow(self, path, color=DIM, sw=1.8, dash=None, marker='arr'):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.body.append(
            f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{sw}" '
            f'marker-end="url(#{marker})"{d}/>')

    def note(self, x, y, lines, color=DIM, size=11.5, lh=16):
        for i, ln in enumerate(lines):
            self.text(x, y + i * lh, ln, size=size, fill=color)

    def render(self):
        head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'font-family="-apple-system, \'PingFang SC\', sans-serif">\n'
            f'<defs>\n'
            f'  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0,1 L9,5 L0,9 z" fill="{DIM}"/></marker>\n'
            f'  <marker id="arrC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0,1 L9,5 L0,9 z" fill="{CONTRACT}"/></marker>\n'
            f'  <marker id="arrR" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0,1 L9,5 L0,9 z" fill="{BROKEN}"/></marker>\n'
            f'  <marker id="arrP" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0,1 L9,5 L0,9 z" fill="{STORE}"/></marker>\n'
            f'</defs>\n'
            f'<rect width="{self.w}" height="{self.h}" fill="{BG}"/>\n'
            f'<text x="40" y="46" font-size="21" font-weight="700" fill="{INK}">{esc(self.title)}</text>\n'
            f'<text x="40" y="70" font-size="12.5" fill="{DIM}">{esc(self.subtitle)}</text>\n'
        )
        return head + '\n'.join(self.body) + '\n</svg>\n'


# ══════════════════════════════════════════════════════════════════════════
# 图一：模块契约
# ══════════════════════════════════════════════════════════════════════════
def contract_map():
    s = Sheet(
        '① 模块契约 · 谁被允许 import 谁',
        '实测 2026-10-17 · src/ 共 56,981 行，其中真代码 26,706 行（注释占非空的 51%）· 箭头方向 = import 方向',
    )

    # 层带
    bands = [
        (96, '接入层 · 宿主只认这一层'),
        (300, '运行层 · 工具调用的实际执行'),
        (560, '判据层 · 12,496 行，零 node: 引用（实测）'),
        (790, '真相层 · 磁盘是唯一权威源'),
    ]
    for y, name in bands:
        s.text(40, y + 4, name, size=11.5, fill=FAINT, weight=600)

    # ── 接入层 ──
    entry = [
        ('index.ts', '669 行 · apply() 注册 16 工具 / HTTP / commands'),
        ('web-routes.ts', '298 行 · 单一路径 /plugins/dsh-agent-teams/state'),
        ('client/index.tsx', '397 行 · 10 处 slots.register，8 个槽位名'),
    ]
    for i, (n, d) in enumerate(entry):
        x = 40 + i * 452
        s.rect(x, 110, 428, 62)
        s.text(x + 16, 134, n, size=14, weight=700, mono=True)
        s.text(x + 16, 156, d, size=11.5, fill=DIM)

    # ── 运行层 ──
    run = [
        ('tools.ts', '2,316 行 · 16 个工具的实现装配处', 40),
        ('scheduler.ts', '1,253 行 · kickTeam / kickMember', 476),
        ('members.ts', '1,507 行 · startContinuable 子代理', 912),
    ]
    for n, d, x in run:
        s.rect(x, 318, 428, 74)
        s.text(x + 16, 344, n, size=14, weight=700, mono=True)
        s.text(x + 16, 366, d, size=11.5, fill=DIM)
        s.text(x + 16, 384, '依赖：state / types / lineage / mailbox', size=10.5, fill=FAINT)

    # 转发：index → tools / scheduler / members
    for x in (254, 690, 1126):
        s.arrow(f'M{x} 172 L{x} 316', color=CONTRACT, marker='arrC')
    s.text(266, 250, 'ctx.tool() 注册', size=10.5, fill=CONTRACT)

    # tools 内部转发
    for x in (690, 1126):
        s.arrow(f'M468 355 L{x - 16} 355', color=CONTRACT, marker='arrC')
    s.text(56, 412, '↳ tools 侧 8 处 await scheduler.kickTeam(…) —— 每个写路径末尾都踢一次', size=10.5, fill=CONTRACT)

    # ── 判据层 ──
    s.rect(40, 580, 916, 186, fill='#191d23')
    s.text(58, 606, 'src/gates/ · 7 个插入点', size=14, weight=700)
    s.text(58, 628, 'admission → contract → dispatch → completion → delivery → runtime → collection', size=11.5, fill=CONTRACT, mono=True)
    s.text(58, 652, '每个判据 = 一个纯函数：输入一个上下文对象，吐出三态判决', size=11.5, fill=DIM)
    s.note(58, 680, [
        '· ok      —— 看了，没问题',
        '· blocked —— 看了，有问题（附 blockers）',
        '· unmeasured —— 没能测量（★ 绝不等于 ok）',
    ], color=DIM, size=11)

    # 判据层到运行层：单向
    s.arrow('M498 580 L498 396', color=DIM)
    s.text(508, 500, 'registry.evaluate(point, ctx) → GateVerdict', size=10.5, fill=DIM)
    s.text(508, 518, '★ 纯函数：不读盘、不发消息、不改状态', size=10.5, fill=PURE)

    # ── 孤儿面 ──
    s.rect(986, 580, 394, 80, stroke=ORPHAN, dash='5 4')
    s.label(986, 580, '孤儿面', ORPHAN, size=11)
    s.text(1004, 624, 'src/evaluator/ · 13 个导出', size=13, weight=700, fill=ORPHAN, mono=True)
    s.text(1004, 646, '外部引用 0 —— 422 行没有消费者', size=11.5, fill=ORPHAN)

    s.rect(986, 676, 394, 90, stroke=ORPHAN, dash='5 4')
    s.text(1004, 704, 'src/evolution/ · 21 个导出', size=13, weight=700, fill=ORPHAN, mono=True)
    s.text(1004, 726, '有消费者 3 个：', size=11.5, fill=ORPHAN)
    s.text(1004, 746, 'observe 49 · collectionHealthOf 8 · readSignalsHealth 2', size=11, fill=ORPHAN, mono=True)

    s.text(986, 796, '★ 隔离做得越彻底，越没人调 ——', size=11.5, fill=ORPHAN)
    s.text(986, 814, '  而"没有被调用"与"没有用"在读数上同形。', size=11.5, fill=ORPHAN)

    # ── 真相层 ──
    stores = [
        ('.agent-teams/<teamId>/team.json', '队伍、成员、任务、相位'),
        ('inbox/<recipient>.jsonl', '消息，append 原子'),
        ('evolution/signals.jsonl', '采集信号'),
        ('audit/workspace.jsonl', '跨区读审计'),
    ]
    for i, (n, d) in enumerate(stores):
        y = 806 + i * 40
        s.rect(40, y, 916, 32, fill='#1b1f26', rx=5)
        s.text(56, y + 21, n, size=11.5, fill=STORE, mono=True)
        s.text(560, y + 21, d, size=11, fill=DIM)

    s.arrow('M498 766 L498 802', color=STORE, marker='arrP')
    s.text(508, 790, 'readTeam / writeTeam  ·  磁盘是权威源', size=10.5, fill=STORE)

    # ── 图例 ──
    s.text(986, 900, '── 图例', size=11.5, fill=FAINT, weight=600)
    s.rect(986, 912, 14, 14, fill=CONTRACT, stroke='none', rx=3)
    s.text(1008, 924, '契约（唯一入口）', size=11, fill=DIM)
    s.rect(1140, 912, 14, 14, fill=PURE, stroke='none', rx=3)
    s.text(1162, 924, '纯函数（零 I/O）', size=11, fill=DIM)
    s.rect(986, 938, 14, 14, fill=ORPHAN, stroke='none', rx=3)
    s.text(1008, 950, '孤儿面（无消费者）', size=11, fill=DIM)
    s.rect(1140, 938, 14, 14, fill=STORE, stroke='none', rx=3)
    s.text(1162, 950, '磁盘真相', size=11, fill=DIM)

    return s.render()


# ══════════════════════════════════════════════════════════════════════════
# 图二：运行管线
# ══════════════════════════════════════════════════════════════════════════
def pipeline_map():
    s = Sheet(
        '② 运行管线 · 一次任务从派发到完成',
        '实测 2026-10-17 · ★ 没有后台循环（setInterval / timer. 在 scheduler.ts 与 index.ts 均无命中）⇒ 工具调用才是发动机',
        h=1080,
    )

    # ── 主链：单列 8 步（左侧）────────────────────────────────────────────────
    steps = [
        ('create_task', '队长调 agent_teams_create_task', '写状态 → 过 admission / contract 判据', INK),
        ('kickTeam()', 'src/scheduler.ts:687', '三个早退：halted · staged · dispatchHeldByReload', CONTRACT),
        ('for each member', '逐成员 kick —— 不是广播', 'serializeMember(queueKey, …) 每人一把锁', CONTRACT),
        ('锁内再读 team', 'readTeam 第二次', '★ 这是防竞态的设计，不是冗余', PURE),
        ('kickMember()', 'src/scheduler.ts:709', '判成员可用 → 取 prompt → startContinuable', CONTRACT),
        ('ctx.subagents.startContinuable', '成员 = 真正的子代理', '★ 上下文独立 —— 因而前缀缓存不共享', PURE),
        ('成员执行 turn', '它能调全部 agent_teams_* 工具', 'claim_task · update_task · send_message', INK),
        ('update_task（成员自报）', '★ 这是唯一的"完成"信号', '没有它 ⇒ 任务永远停在 in_progress', BROKEN),
    ]
    LX, LW = 40, 560
    y0 = 104
    for i, (name, line1, line2, color) in enumerate(steps):
        py = y0 + i * 104
        fill = '#241a1c' if color == BROKEN else ('#1b2028' if color in (CONTRACT, PURE) else CARD)
        s.rect(LX, py, LW, 88, fill=fill, stroke=color if color != INK else EDGE)
        s.text(LX + 16, py + 26, name, size=13.5, weight=700, mono=True,
               fill=color if color != INK else INK)
        s.text(LX + 16, py + 48, line1, size=10.5, fill=DIM)
        s.text(LX + 16, py + 68, line2, size=10.5,
               fill=color if color in (BROKEN, PURE, CONTRACT) else FAINT)
        if i < len(steps) - 1:
            s.arrow(f'M{LX + LW // 2} {py + 88} L{LX + LW // 2} {py + 104}', color=DIM)

    # ── 右���：完成之后 ──
    rx = 640
    s.text(rx, 116, '完成之后：消息去哪里', size=15, weight=700, fill=INK)
    # 把左列第 8 步（唯一的"完成"信号）接到右列顶端 —— 走廊只有 40px，走 x=622
    y8 = y0 + 7 * 104 + 44
    s.arrow(f'M{LX + LW} {y8} L622 {y8} L622 152 L638 152',
            color=BROKEN, sw=2.0, marker='arrR')
    post = [
        ('appendMailbox', 'update-task.ts:2058', '消息落进 inbox/captain.jsonl', STORE),
        ('readCaptainSession', '★ 可能失败', 'inactive context ⇒ 拿不到 agents', BROKEN),
        ('steerCaptainReport', 'members.ts:146', 'captain.steer(…) —— 唯一唤醒手段', CONTRACT),
        ('markMailboxDelivered', 'update-task.ts:2147', '成功才标记已投递', PURE),
    ]
    for i, (n, sub, d, color) in enumerate(post):
        py = 140 + i * 96
        s.rect(rx, py, 740, 76, stroke=color)
        s.text(rx + 16, py + 26, n, size=13.5, weight=700, mono=True, fill=color)
        s.text(rx + 340, py + 26, sub, size=10.5, fill=DIM, mono=True)
        s.text(rx + 16, py + 50, d, size=11.5, fill=DIM)
        if i < len(post) - 1:
            s.arrow(f'M{rx + 370} {py + 76} L{rx + 370} {py + 96}', color=DIM)

    # ── 关键发现框 ──
    s.rect(rx, 546, 740, 190, fill='#241a1c', stroke=BROKEN)
    s.label(rx, 546, '实测到的断点', BROKEN, size=11)
    s.note(rx + 18, 584, [
        '成员 update_task 完成 → kickTeam 只 kick【其他成员】',
        '⇒ ★ 队长【不被唤醒】',
        '⇒ 队长只在【自己主动调 status】时才看到那条消息',
        '⇒ 而队长通常在本回合【已经结束】，没人叫它',
        '',
        '★ 这就是你描述的："成员做完了，但主规划这边没收到任何消息"。',
    ], color=INK, size=12, lh=21)

    # ── 三个早退 ──
    s.rect(rx, 758, 740, 118, fill='#1b2028', stroke=EDGE)
    s.text(rx + 18, 784, '为什么 kickTeam 会【什么都不做】', size=13, weight=700, fill=INK)
    s.note(rx + 18, 808, [
        '① team.halted === true            —— 被显式停下',
        '② team.phase === \'staged\'          —— 计划还没批',
        '③ dispatchHeldByReload(tasks)     —— 有 reload 排队',
    ], color=DIM, size=11.5, lh=18)
    s.text(rx + 18, 868, '★ 三者都【不报错】—— 一个不派发的 kick 与"没有活"同形', size=11, fill=BROKEN)

    # ── 底部：三个弱点 ──
    s.rect(40, 966, 1340, 92, fill='#191d23', stroke=EDGE)
    s.text(58, 992, '由此推出的三个弱点（它们决定了"救援"该补哪里）', size=13, weight=700, fill=INK)
    s.note(58, 1016, [
        '① 没有超时、没有救援 —— 成员静默停下只能靠人看见。runtime.stall 判据只在【被拒 ≥2 次】或【in_progress 超 N 轮】时记一笔，且【只告警不干预】。',
        '② 没有推送 —— 客户端轮询单一路径，状态晚一个周期。人不需要毫秒级，可接受。',
        '③ 没有汇合点 —— 非工具触发的逻辑永远不跑。这正是 evaluator 成为孤儿的结构原因。',
    ], color=DIM, size=11, lh=19)

    return s.render()


# ══════════════════════════════════════════════════════════════════════════
# 图三：采集模块
# ══════════════════════════════════════════════════════════════════════════
def collect_map():
    s = Sheet(
        '③ 采集模块 · 从"卡点"到"能用的信号"',
        '实测 2026-10-17 · 旧 frictions/ 已冻结（386 条 · 15.1 MB · 平均 38 KB）',
        h=940,
    )

    # ── 左：三个汇合点 ──
    s.text(40, 112, '汇合点（宿主已经在的地方）', size=14, weight=700, fill=INK)
    points = [
        ('recordFriction()', 'entities.ts:4175', '三处调用：create-task / entities / update-task', '★ 只在【判据拒绝】时触发'),
        ('工具拒绝抛出点', 'tools.ts', '参数不合法、越权、状态不允许', '★ 非判据类的拒绝'),
        ('validateCreateTask', 'quality-gates.ts:980', '建任务的契约校验', '★ 纯函数，只依赖 types.ts'),
    ]
    for i, (n, loc, d, tag) in enumerate(points):
        py = 136 + i * 106
        s.rect(40, py, 470, 88)
        s.text(58, py + 26, n, size=13.5, weight=700, mono=True)
        s.text(300, py + 26, loc, size=10.5, fill=DIM, mono=True)
        s.text(58, py + 50, d, size=11.5, fill=DIM)
        s.text(58, py + 70, tag, size=11, fill=ORPHAN if '判据' in tag else FAINT)

    # ── 中：四条判据 ──
    s.text(560, 112, 'collection 插入点 · 4 条判据', size=14, weight=700, fill=CONTRACT)
    crit = [
        ('dedupe', '(kind, component, message) 在窗口内出现过'),
        ('cooldown', '同一来源距上次采集不足 cooldownMs'),
        ('attributable', '能不能归因到某个模块？归不了 ⇒ unmeasured'),
        ('immunity', '已知噪声源（如 worktree 路径差异）免疫'),
    ]
    for i, (n, d) in enumerate(crit):
        py = 136 + i * 78
        s.rect(560, py, 400, 62, stroke=CONTRACT)
        s.text(578, py + 26, n, size=13, weight=700, mono=True, fill=CONTRACT)
        s.text(578, py + 47, d, size=10.5, fill=DIM)
        s.arrow(f'M512 {160 + i * 78} L556 {160 + i * 78}', color=DIM)

    s.text(560, 452, '★ 四条都是纯函数：缺输入 ⇒ unmeasured，绝不是 ok', size=11.5, fill=PURE)
    s.text(560, 472, '★ 添加一个插入点是【五处登记】，漏一处则判据不生效', size=11.5, fill=ORPHAN)

    # ── 右：落盘 ──
    s.text(1010, 112, '落盘', size=14, weight=700, fill=STORE)
    s.rect(1010, 136, 370, 100, fill='#1b1f26', stroke=STORE)
    s.text(1028, 162, 'evolution/signals.jsonl', size=13, weight=700, mono=True, fill=STORE)
    s.note(1028, 186, [
        'appendSignalClaimingId() —— 进程内互斥',
        '★ id 在临界区内才读，否则并发撞车',
        '（实测：12 次并发曾全返回 e-0001）',
    ], color=DIM, size=10.5, lh=16)

    s.rect(1010, 256, 370, 96, fill='#1b1f26', stroke=STORE)
    s.text(1028, 282, 'states/{team,member,task}/', size=13, weight=700, mono=True, fill=STORE)
    s.note(1028, 306, [
        '内容寻址，去重靠 substructure',
        '实测 4.92 MB → 0.75 MB（约 7×）',
        'whole-block 只压 1%，substructure 压 70%',
    ], color=DIM, size=10.5, lh=16)

    s.arrow('M960 168 L1006 186', color=STORE, marker='arrP')

    # ── 底部：健康度 ──
    s.rect(40, 540, 1340, 168, fill='#191d23', stroke=EDGE)
    s.text(58, 566, '采集健康度 · collectionHealthOf()（两个元指标，出自 AutoLibra / ICLR 2026）', size=13.5, weight=700, fill=INK)
    s.note(58, 594, [
        'coverage   —— 采到的信号覆盖了多少种 (component, kind) 对',
        'redundancy —— 唯一对数 / 总记录数。★ 实测 54/372 = 0.145（补录后 71/382 = 0.186）',
        '',
        '★ 口径陷阱：必须按「(component, 单个 kind) 对」算，不能按「kind 集合桶」算 ——',
        '  两者差 18 条多 kind 记录（如 f-0078 · [unwired, cross-ecosystem]），按对算 54、按桶算 38。',
    ], color=DIM, size=11.5, lh=20)

    s.rect(40, 728, 1340, 88, fill='#1a1e24', stroke=EDGE)
    s.text(58, 754, '现在的真实状态', size=13, weight=700, fill=INK)
    s.note(58, 778, [
        '★ 采集在跑，但只有 3 个导出有消费者（observe 49 · collectionHealthOf 8 · readSignalsHealth 2）。三条自进化路径里只有②接上了。',
        '★ 旧 frictions/ 不迁移（用户裁定），新 signals.jsonl 与它并存。',
    ], color=DIM, size=11, lh=19)

    # 图例
    s.text(40, 858, '── 图例', size=11.5, fill=FAINT, weight=600)
    s.rect(40, 870, 14, 14, fill=CONTRACT, stroke='none', rx=3)
    s.text(62, 882, '插入点与判据', size=11, fill=DIM)
    s.rect(180, 870, 14, 14, fill=STORE, stroke='none', rx=3)
    s.text(202, 882, '落盘', size=11, fill=DIM)
    s.rect(272, 870, 14, 14, fill=ORPHAN, stroke='none', rx=3)
    s.text(294, 882, '需要留意', size=11, fill=DIM)
    s.rect(400, 870, 14, 14, fill=PURE, stroke='none', rx=3)
    s.text(422, 882, '不变量', size=11, fill=DIM)

    return s.render()


if __name__ == '__main__':
    for name, fn in [
        ('architecture-1-contract.svg', contract_map),
        ('architecture-2-pipeline.svg', pipeline_map),
        ('architecture-3-collection.svg', collect_map),
    ]:
        p = OUT / name
        p.write_text(fn(), encoding='utf8')
        print(f'  wrote {p.relative_to(OUT.parent)}  ({p.stat().st_size} bytes)')
