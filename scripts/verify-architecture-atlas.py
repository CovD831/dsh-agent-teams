import re, pathlib, collections, json
root = pathlib.Path('src')
files = sorted([p for p in root.rglob('*') if p.suffix in ('.ts','.tsx')])

def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'(?m)^\s*//.*$', '', s)
    return s

def group(p):
    rel = p.relative_to(root)
    return rel.stem if len(rel.parts) == 1 else rel.parts[0]

# ── 1. 行数 ──────────────────────────────────────────────
tot = collections.Counter()
for p in files:
    tot[group(p)] += len(p.read_text(encoding='utf-8', errors='ignore').splitlines())
print('== 行数（组）==')
for g, n in tot.most_common():
    print(f'  {g:16} {n:6}')
print('  TOTAL', sum(tot.values()))

# ── 2. 注释/代码 ─────────────────────────────────────────
blank = comment = code = 0
for p in files:
    text = p.read_text(encoding='utf-8', errors='ignore')
    inblock = False
    for line in text.splitlines():
        s = line.strip()
        if not s: blank += 1; continue
        if inblock:
            comment += 1
            if '*/' in s: inblock = False
            continue
        if s.startswith('/*'):
            comment += 1
            if '*/' not in s: inblock = True
            continue
        if s.startswith('//'): comment += 1; continue
        code += 1
print(f'== 注释/代码 == total={blank+comment+code} blank={blank} comment={comment} code={code} '
      f'c/nonblank={comment/(comment+code):.3f}')

# ── 3. import 图 ────────────────────────────────────────
edges = collections.Counter(); resolved = 0; unresolved = []
for p in files:
    src = strip_comments(p.read_text(encoding='utf-8', errors='ignore'))
    for m in re.finditer(r"""from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]""", src):
        spec = m.group(1) or m.group(2)
        if not spec.startswith('.'): continue
        import os
        base = pathlib.Path(os.path.normpath(str(p.parent / spec)))
        cands = [base, pathlib.Path(str(base)+'.ts'), pathlib.Path(str(base)+'.tsx'),
                 base/'index.ts', base/'index.tsx']
        hit = next((c for c in cands if c.exists() and c.is_file()), None)
        if hit is None: unresolved.append((p, spec)); continue
        resolved += 1
        if group(p) != group(hit): edges[(group(p), group(hit))] += 1
print(f'== import 图 == files={len(files)} resolved={resolved} unresolved={len(unresolved)} '
      f'cross={sum(edges.values())} distinct={len(edges)}')
print('  gates ->', {f'{a}->{b}': n for (a,b),n in edges.items() if a=='gates'})
print('  -> gates :', {f'{a}->{b}': n for (a,b),n in edges.items() if b=='gates'})
print('  tools ->', sorted([(b,n) for (a,b),n in edges.items() if a=='tools'], key=lambda x:-x[1]))

# ── 4. node: 引用 ───────────────────────────────────────
nodeio = collections.Counter()
for p in files:
    src = p.read_text(encoding='utf-8', errors='ignore')
    nodeio[group(p)] += len(re.findall(r"from 'node:", src))
print('== from node: ==', dict(nodeio))

# ── 5. export 面（口径：以 `^export` 开头的行数）────────────────
exp = collections.Counter(); cnt = collections.Counter()
for p in files:
    src = p.read_text(encoding='utf-8', errors='ignore')
    exp[group(p)] += len(re.findall(r'(?m)^export\s', src))
    cnt[group(p)] += 1
print('== export 面 ==')
for g in ('gates', 'tools', 'client', 'evolution', 'mutation', 'evaluator'):
    print(f'  {g:12} files={cnt[g]:3} exports={exp[g]:4}')
