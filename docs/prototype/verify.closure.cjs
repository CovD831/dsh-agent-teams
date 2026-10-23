// 双向引用闭合检查：evidenceRef（check/decision/acceptance）→ 必须存在对应 event.evidenceId
// 反之：每个 event.evidenceId 必须被至少一个 check / decision / acceptance 引用。
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(__dirname + '/data/mock.readout.json', 'utf8'));

const events = new Map();
d.tasks.forEach(t => (t.events || []).forEach(e => events.set(e.evidenceId, e)));

const refs = [];
d.tasks.forEach(t => {
  (t.gates || []).forEach(g => (g.checks || []).forEach(c => refs.push(['check:' + c.checkId, c.evidenceRef])));
  (t.acceptance || []).forEach(a => refs.push(['acc:' + a.item, a.evidenceRef]));
});
(d.decisions || []).forEach(x => refs.push(['dec:' + x.decisionId, x.evidenceRef]));

let bad = 0;
for (const [from, id] of refs) {
  if (!events.has(id)) { console.log('  MISSING 事件端:', from, '->', id); bad++; }
}
const used = new Set(refs.map(r => r[1]));
for (const [id] of events) {
  if (!used.has(id)) { console.log('  ORPHAN 孤立事件:', id); bad++; }
}
console.log(bad === 0
  ? 'CLOSURE OK · ' + refs.length + ' 个引用全部闭合 · ' + events.size + ' 条事件 · ' + d.tasks[0].gates.length + ' 道关卡 · ' + refs.filter(r => r[0].startsWith('check')).length + ' 个检查项'
  : 'CLOSURE FAIL · ' + bad + ' 处断裂');
process.exit(bad === 0 ? 0 : 1);
