import json
from PIL import Image, ImageDraw

j = json.load(open('/tmp/room-geometry.json'))
plan, size, sprites = j['plan'], j['size'], j['sprites']
TW, TH = 16, 8
def wall_height(rows): return max(24, min(40, 18 + rows*3))
WALL_H = wall_height(plan['rows'])
ox, oy = size['ox'], size['oy']

def to_screen(u, v, h=0):
    return ((u - v) * (TW / 2), (u + v) * (TH / 2) - h)

PAL = {
 'floorA':'#26212f','floorB':'#2a2533','teamA':'#302641','teamB':'#233040','teamC':'#332b26','teamD':'#26332d',
 'wallBack':'#3a3348','wallSide':'#2e2838','wallBase':'#1e1a26',
 'deskTop':'#564a63','deskLeft':'#362e40','deskRight':'#41374d',
 'chairTop':'#b93a44','chairLeft':'#7f1f2a','chairRight':'#962533',
 'screenCode':'#0f3b36','screenIdle':'#15151c','codeGlyph':'#4fe0c0','neon':'#ff3cbe','unknown':'#6b6478',
 'ghost':(190,200,220,90),
}
SP = {'k':'#141018','s':'#e8b98a','S':'#c9975f','h':'#2f2a3a','c':'#4a6fa5','C':'#345079','w':'#e8e6ef','e':'#1a1622','a':'#f2b134'}

img = Image.new('RGBA', (int(size['width'])+4, int(size['height'])+4), '#0b0a10')
d = ImageDraw.Draw(img, 'RGBA')

def poly(pts, color):
    d.polygon([(round(ox+x), round(oy+y)) for x,y in pts], fill=color)

def box(u,v,w,dd,h,top,left,right,base=0):
    poly([to_screen(u,v+dd,base),to_screen(u+w,v+dd,base),to_screen(u+w,v+dd,base+h),to_screen(u,v+dd,base+h)], left)
    poly([to_screen(u+w,v,base),to_screen(u+w,v+dd,base),to_screen(u+w,v+dd,base+h),to_screen(u+w,v,base+h)], right)
    poly([to_screen(u,v,base+h),to_screen(u+w,v,base+h),to_screen(u+w,v+dd,base+h),to_screen(u,v+dd,base+h)], top)

# 地板
for row in range(1, plan['rows']+1):
    band = next((t for t in plan['teams'] if t['fromRow'] <= row <= t['toRow']), None)
    for col in range(1, plan['cols']+1):
        u, v = col-1, row-1
        if band is None:
            c = PAL['floorA'] if (u+v) % 2 == 0 else PAL['floorB']
        else:
            idx = plan['teams'].index(band) % 4
            c = PAL[['teamA','teamB','teamC','teamD'][idx]]
        poly([to_screen(u,v),to_screen(u+1,v),to_screen(u+1,v+1),to_screen(u,v+1)], c)

W, H = plan['cols'], max(1, plan['rows'])
def wall(u0,v0,u1,v1,h,color):
    a, b = to_screen(u0,v0,0), to_screen(u1,v1,0)
    poly([a, b, (b[0], b[1]-h), (a[0], a[1]-h)], color)
wall(0,0,W,0,WALL_H,PAL['wallBack']); wall(0,0,0,H,WALL_H,PAL['wallSide'])
wall(0,0,W,0,4,PAL['wallBase']);   wall(0,0,0,H,4,PAL['wallBase'])
# 大屏
wall(1,0,min(W-0.5,4),0,WALL_H*0.72,'#0a0d14')
for line in range(4):
    y0 = WALL_H*0.3 + line*6
    wall(1.2,0,2.4,0,y0+3,PAL['codeGlyph'] if line%2==0 else '#243040')
wall(0.5,0,W-0.5,0,WALL_H*0.94,PAL['neon'])

# 桌椅人
for a in sorted(plan['actors'], key=lambda a: a['seat']['col']+a['seat']['row']):
    u, v = a['seat']['col']-1, a['seat']['row']-1
    box(u+0.1, v-0.7, 1.6, 0.6, 5, PAL['deskTop'],PAL['deskLeft'],PAL['deskRight'])
    box(u+0.42, v-0.62, 0.95, 0.12, 8, '#16161c','#0b0b10','#101016',5)
    box(u+0.2, v+0.25, 1.0, 0.55, 4, PAL['chairTop'],PAL['chairLeft'],PAL['chairRight'])
    sc = to_screen(u+0.5, v-0.5, 6)
    face = PAL['screenCode'] if a['doing']=='working' else PAL['screenIdle']
    poly([(sc[0]-5,sc[1]),(sc[0]+5,sc[1]),(sc[0]+5,sc[1]-5),(sc[0]-5,sc[1]-5)], face)
    if a['doing']=='working':
        for line in range(3):
            poly([(sc[0]-4,sc[1]-2-line*1.4),(sc[0]-1,sc[1]-2-line*1.4),(sc[0]-1,sc[1]-2.8-line*1.4),(sc[0]-4,sc[1]-2.8-line*1.4)], PAL['codeGlyph'])
    pass
    if a['doing']=='away':
        c = to_screen(u+0.5, v+0.5, 0)
        poly([(c[0]-4,c[1]),(c[0]+4,c[1]),(c[0],c[1]+3)], PAL['ghost'])
    else:
        c = to_screen(u+0.5, v+0.5, 0)
        left = round(ox+c[0]-12); top = round(oy+c[1]-16)
        for r, row in enumerate(sprites[a['doing']]):
            for col, ch in enumerate(row):
                if ch == '.': continue
                color = PAL['unknown'] if ch == '?' else SP.get(ch)
                if color: d.rectangle([left+col, top+r, left+col, top+r], fill=color)

img = img.resize((img.width*4, img.height*4), Image.NEAREST)
img.save('/tmp/room-preview.png')
print('saved', img.size)
