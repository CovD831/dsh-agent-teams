/**
 * ── `admission.absorb` 的三臂夹具（声称吸收了 vs 产物真的变了）─────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）。本判据的三臂是：
 *
 *   臂 1（伪造臂）：主会话自报「已吸收」而**产物一行未动** ⇒ 期望 blocked
 *                   ★ 且必须指名"哪一份产物、哪个版本没变"这一类事实
 *   臂 2（未测量臂）：拿不到观察（没读过 / 没有会话事件 / 没有产物表）
 *                     ⇒ 期望 unmeasured，★ 不是 ok，且与 blocked 不同形
 *   臂 3（对照臂）：产物相对**读到的内容**真的变了 ⇒ 期望 ok
 *
 * ★ 缺任何一臂，这条判据不算完成。理由是这个仓库踩过的：只有对照臂能区分
 *   「判据有效」与「判据在乱拒」（START-HERE §4）。
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 用户原话：「★ 不把子代理的话原样给用户看」，主会话要自己判断采纳哪些。
 * 而"自主判断"不等于"可以不发生"：
 *
 *     审完 → 主会话回一句"我吸收了" → 产物一个字没动 → 成团
 *     审完 → 主会话真的改了三处                    → 成团
 *
 * 上面两条在【任何现有判据】下同形：产物都在、循环都"走完了"，而前者是一次空操作。
 *
 * ── ★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）──────────────────────────
 *
 * 「当前没有主会话声称吸收」**不是不变量**，它是接线还没有做时的快照。
 * 真实 ctx 上现在确实还没有 `absorb` 这一格（调用点属 t10 集成）—— 但夹具
 * **一个字节都不许**把这件事写成断言：一旦接线落地，那种断言会在队友那里按设计
 * 变红，而红的原因与"判据坏了"毫无关系。
 *
 * ⇒ 本文件断言的一律是**判据自身的性质**：
 *     · 声称吸收 + 产物真变     ⇒ ok
 *     · 声称吸收 + 产物没动     ⇒ blocked（而"没能观察"是另一态）
 *     · 声称"无需改" + 点名读过 ⇒ ok（这是第二条合法出口）
 *     · 声称"无需改" + 没点名   ⇒ blocked
 *     · 拿不到观察              ⇒ unmeasured，且与上面两态不同形
 *
 * ── 臂 1 的那一次【定向突变】──────────────────────────────────────────────────
 *
 * 契约的验收是：「把『产物真的变了』那半边去掉（只信声明）⇒ 对应臂必须红」。
 * 那一半在本判据里是 `changedAtReadTime` 那个比较（`producedContent[path] !== then`）。
 * 本文件**真的执行**这次突变：把 `src/gates/admission/absorb.ts` 里那次比较改成
 * 恒真（"读过的产物一律算变过"），重新 build，再跑一次臂 1 的三个输入，
 * 断言它们**不再被拒**。这就是"机制被单独去掉、臂必须红"的字面落点。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * ★ 从 `../lib` 读（和每一条既有判据夹具一样）：测的是**真的会被装配层装上**的
 *   那一份代码，而不是 `src/` 里的一份平行副本。
 */
import { gate, appliesTo, id, point, requires } from '../lib/gates/admission/absorb.js'
import { checkRequires } from '../lib/gates/requires.js'
import { createGateRegistry } from '../lib/gates/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'gates', 'admission', 'absorb.ts')
const BUILT_GATE = join(ROOT, 'lib', 'gates', 'admission', 'absorb.js')

/** 收窄助手：把"这条断言期望哪一种裁决"写进断言本身（三态必须不同形）。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

const DOC = 'docs/REQUIREMENTS.md'
const OTHER_DOC = 'docs/PLAN.md'

/**
 * 一个最小 ctx。**每一格都显式给值**，好让每条臂只改它要测的那一格
 * —— 一个"顺手把别的格也拿掉"的夹具会让失败的归因失效。
 */
function ctx(overrides = {}) {
  return {
    task: { id: 't7', kind: 'requirement' },
    absorb: { claims: 'absorbed' },
    producedDocuments: [DOC],
    /** 会话事件里观察到的：产物被动过（或没有）。 */
    observedDocumentChanged: true,
    /** 吸收【那一刻】读到的内容。 */
    documentsRead: { [DOC]: 'v1: 需求第一版\n' },
    /** 产物【现在】的样子。 */
    producedContent: { [DOC]: 'v2: 吸收后改过\n' },
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（伪造臂）：只声称吸收了，产物一文未动
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：自报「已吸收」而产物一行未动 ⇒ blocked，且说清是哪一份、没变在哪', async () => {
  /**
   * 定向突变（本文件末尾那条会真的执行它）：把 `changedAtReadTime` 的比较改成
   * 恒真 ⇒ 本条**必须红**（它不再拒绝）。改动点是 absorb.ts 里那一次内容比较。
   */
  const verdict = await gate(ctx({
    /** 内容一模一样：读了 v1，现在还是 v1。 */
    producedContent: { [DOC]: 'v1: 需求第一版\n' },
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 这一次只该有一条结论（改动半边 + 因果半边合成一句），不连坐')
  assert.match(blockers[0], /absorbed the review/i, '★ 必须复述它自报的那句话 —— 读日志的人要知道是谁声称的')
  assert.match(blockers[0], new RegExp(DOC.replaceAll('/', '\\/')), '★ 必须指名是哪一份产物')
  assert.match(blockers[0], /did not change after it was read/, '★ 必须说清是哪一类问题（不是笼统的"你该审了"）')
})

test('臂 1b ★ 伪造臂：会话事件里根本没有任何产物被写过 ⇒ blocked（空操作的第二种长相）', async () => {
  /**
   * ★ 它与臂 1 不是重复：臂 1 是"观察了、产物没变"，本条是"观察了、产物连写都没被写过"。
   *   两者在"产物内容"上完全一样，而措辞与补救动作不同（一个去改文档，一个去看
   *   会话里到底发生了什么）。把它们合成一条，会让"没写入"与"写了但没变"同形。
   */
  const verdict = await gate(ctx({
    observedDocumentChanged: false,
    producedContent: { [DOC]: 'v1: 需求第一版\n' },
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /no write to any of the \d+ produced document\(s\) was ever observed/)
})

test('臂 1c ★ 伪造臂：吸收那一刻【一份产物都没读过】⇒ blocked（结论不可能是从没打开过的文档里得出的）', async () => {
  const verdict = await gate(ctx({ documentsRead: {}, producedContent: { [DOC]: 'v2\n' } }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /no produced document was ever read/)
})

test('臂 1d ★ 伪造臂：读的是【别的】文档，声称吸收的那一份没变 ⇒ blocked（因果半边）', async () => {
  /**
   * ★ 这一条是"产物动过没有"与"吸收真的发生了没有"的分界：主会话可以读一份无关
   *   文档、再往产物里加一行 —— 若判据只看"产物动过"，它就绿了。
   *   这里的构造是"读了别的文档"，产物**没变** ⇒ 必须红。
   */
  const verdict = await gate(ctx({
    documentsRead: { [OTHER_DOC]: 'x\n' },
    producedContent: { [DOC]: 'v1: 需求第一版\n', [OTHER_DOC]: 'y\n' },
    observedDocumentChanged: true,
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /did not change after it was read/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（未测量臂）：拿不到观察 ⇒ unmeasured，★ 不是 ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 未测量臂：拿不到该会话的写入观察 ⇒ unmeasured，与 blocked 不同形', async () => {
  const verdict = await gate(ctx({ observedDocumentChanged: undefined }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /could not be observed|no session events/i)
  assert.equal('blockers' in verdict, false, '★ 未测量不带 blockers —— 两种说法不许同时出现（注册表的形状校验会抛错）')
})

test('臂 2b ★ 未测量臂：吸收那一刻读到了什么观察不到 ⇒ unmeasured（而不是"没变"）', async () => {
  const verdict = await gate(ctx({ documentsRead: undefined }))
  assert.match(expectUnmeasured(verdict), /what this session had actually read|could not be observed/i)
})

test('臂 2c ★ 未测量臂：产物【现在】的内容观察不到 ⇒ unmeasured', async () => {
  const verdict = await gate(ctx({ producedContent: undefined }))
  assert.match(expectUnmeasured(verdict), /current content/i)
})

test('臂 2d ★ 未测量臂：产物表缺席 ⇒ unmeasured；而产物表为空 ⇒ blocked（两件事不同形）', async () => {
  /**
   * ★ 这一条钉的是"缺格"与"可判定的事实"的分界（契约 §8.5 规则一）：
   *
   *     缺席 ⇒ 判据不知产物是什么        ⇒ unmeasured（"我没被喂饱"）
   *     `[]` ⇒ 判据知道产物集，而它是空的 ⇒ blocked（"一个产物都没有"）
   *
   *   合成一个 `?? []` 会让"没人接线"伪装成"拒绝"，而那是一次误伤。
   */
  assert.match(expectUnmeasured(await gate(ctx({ producedDocuments: undefined }))), /could not be observed/)

  const empty = expectBlocked(await gate(ctx({ producedDocuments: [] })))
  assert.match(empty.join('\n'), /declares no requirement\/plan document at all/)
})

test('臂 2e ★ 未测量臂：闸门格（本次没声称 / kind 不是需求阶段）⇒ unmeasured，不是 blocked', async () => {
  /**
   * ★ 闸门格**不进 requires**（见 absorb.ts 的声明注释），所以判据要自己对它们
   *   负责：一份完全合规的空 ctx 走到这里，正确答案是"我没被喂饱"，绝不是
   *   "产物一个都没有 ⇒ 拒绝"。后者是一次误伤，而误伤的代价比漏报更贵。
   */
  assert.match(expectUnmeasured(await gate({})), /never claimed to have absorbed/)
  assert.match(
    expectUnmeasured(await gate(ctx({ absorb: { claims: 'done' } }))),
    /never claimed to have absorbed/,
    '★ 认的只有那两个取值 —— "done" / "ok" 这类含糊的话读作"没说清"，不是"已声称"',
  )
  assert.match(
    expectUnmeasured(await gate(ctx({ task: { id: 't7', kind: 'implementation' } }))),
    /not a requirement\/plan artefact phase/,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（对照臂）：产物真的变了 ⇒ ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：声称吸收、产物相对读到的内容真的变了 ⇒ ok，且交出它亲眼核对的产出', async () => {
  const verdict = expectOk(await gate(ctx()))
  assert.equal(verdict.absorbReport.claim, 'absorbed')
  assert.deepEqual(verdict.absorbReport.absorbedDocuments, [DOC], '★ 产出里只列【真的被读、且真的变了】的那些')
  assert.deepEqual(verdict.absorbReport.producedDocuments, [DOC])
})

test('臂 3b 对照臂：内容与读到的一致、但【会话事件里也没写过】⇒ 仍是 blocked（ok 不是"没人说话"的缺省）', async () => {
  /**
   * ★ 反向钉法：本判据的 ok **必须要求两侧证据都在**。一个"缺省放行"的实现
   *   过不了本条 —— 它会在"观察到了、没写过、内容也没变"上放行。
   */
  const verdict = await gate(ctx({
    observedDocumentChanged: false,
    producedContent: { [DOC]: 'v1: 需求第一版\n' },
  }))
  assert.equal(expectBlocked(verdict).length >= 1, true)
})

// ─────────────────────────────────────────────────────────────────────────────
// 第二条出口：「无需改」—— 它有自己的代价，而它不许成为一条恒安全的路径
// ─────────────────────────────────────────────────────────────────────────────

test('★ 出口 2（对照臂）：「无需改」+ 点名一份被真正读过的产物 ⇒ ok —— 产物一字未改也是合法结论', async () => {
  /**
   * ★ 这一格是用户的裁定落成的形状：一份审查意见可能**全被否掉**
   *   （"驳回也是结论，默认路径不是改文档"）。若不给这条出口，判据就会逼着人
   *   为了过关去改文档 —— 那正是"把判据的输入交给被判的一方"。
   *
   * ★ 而它与臂 1 的区别只在**声明**：文件状态一模一样（都没变），
   *   一个说"我吸收了"（⇒ 必须变），一个说"无需改"（⇒ 必须点名）。
   *   判据能说的只有这一句；谁在部署上把两者读混，谁就得自己回答
   *   "他是真的判断了，还是随口一说"—— 判据不假装它能回答那个问题。
   */
  const verdict = expectOk(await gate(ctx({
    absorb: { claims: 'nothing-to-change', documents: [DOC] },
    observedDocumentChanged: false,
    producedContent: { [DOC]: 'v1: 需求第一版\n' },
  })))
  assert.equal(verdict.absorbReport.claim, 'nothing-to-change')
  assert.deepEqual(verdict.absorbReport.absorbedDocuments, [], '★ 没改动 ⇒ "吸收进文档的那几份"是空的，不许把产物全集塞进去')
  assert.deepEqual(verdict.absorbReport.noChangeDocuments, [DOC])
})

test('★ 出口 2（伪造臂）：声称「无需改」却【没点名】任何产物 ⇒ blocked（笼统一句不算结论）', async () => {
  const verdict = await gate(ctx({
    absorb: { claims: 'nothing-to-change' },
    observedDocumentChanged: false,
    producedContent: { [DOC]: 'v1: 需求第一版\n' },
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /without naming a single produced document/)
  assert.match(blockers.join('\n'), /nothing to change/i, '★ 必须复述它自报的那句话')
})

test('★ 出口 2（伪造臂）：点名了，但那份产物【从没被读过】⇒ blocked', async () => {
  const verdict = await gate(ctx({
    absorb: { claims: 'nothing-to-change', documents: [DOC] },
    documentsRead: {},
    observedDocumentChanged: false,
    producedContent: { [DOC]: 'v1: 需求第一版\n' },
  }))
  assert.match(expectBlocked(verdict).join('\n'), /none of those was ever read/)
})

test('★ 出口 2（伪造臂）：点名"无需改"、却把点名的那份改了 ⇒ blocked（否则它就是一条恒安全的路径）', async () => {
  /**
   * ★ 这一半的存在理由与 `dispatch.changed-paths` 的"隐瞒改动与虚报改动同样危险"
   *   是同一个：一条**永远安全**的出口会在几次使用之后取代另一条成为默认路径，
   *   而本判据整个失效。定向突变：把这一半删掉，本条**必须红**。
   */
  const verdict = await gate(ctx({
    absorb: { claims: 'nothing-to-change', documents: [DOC] },
    producedContent: { [DOC]: 'v2: 明明改过了\n' },
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /was rewritten after it was read/)
})

test('★ 出口 2（边界臂）：点名"无需改"的是【另一份】产物，而它确实没变 ⇒ ok', async () => {
  /**
   * ★ 反向半边：判据不许把"产物集里有人变了"读成"点名的那份变了"。
   *   一个拿**整个产物集**做比较的实现会在这里误伤 ——
   *   而"点名的到底是哪一份"正是这条出口的代价本身。
   */
  const verdict = expectOk(await gate(ctx({
    absorb: { claims: 'nothing-to-change', documents: [OTHER_DOC] },
    producedDocuments: [DOC, OTHER_DOC],
    documentsRead: { [OTHER_DOC]: 'plan v1\n' },
    producedContent: { [DOC]: 'v2: 被吸收了\n', [OTHER_DOC]: 'plan v1\n' },
  })))
  assert.deepEqual(verdict.absorbReport.noChangeDocuments, [OTHER_DOC])
})

// ─────────────────────────────────────────────────────────────────────────────
// 路径规整：非法路径不许静默丢弃（与 changed-paths 的 bucket 同构）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 非法路径：绝对路径 / `..` 不许静默当作合法路径比过去', async () => {
  const verdict = await gate(ctx({ producedDocuments: ['/etc/passwd'] }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /not a workspace-relative path/)

  const dotdot = await gate(ctx({ producedDocuments: ['../docs/REQUIREMENTS.md'] }))
  assert.match(expectBlocked(dotdot).join('\n'), /not a workspace-relative path/)
})

test('★ 路径规整：`./docs/REQUIREMENTS.md` 与 `docs/REQUIREMENTS.md` 是同一条路径（不是两次读取）', async () => {
  const verdict = expectOk(await gate(ctx({
    producedDocuments: ['./docs/REQUIREMENTS.md'],
    documentsRead: { 'docs/REQUIREMENTS.md': 'v1\n' },
    producedContent: { './docs/REQUIREMENTS.md': 'v2\n' },
  })))
  assert.deepEqual(verdict.absorbReport.producedDocuments, [DOC], '★ 规整之后的路径才是判据读到的那个')
})

// ─────────────────────────────────────────────────────────────────────────────
// 元数据 + appliesTo
// ─────────────────────────────────────────────────────────────────────────────

test('判据元数据：id / point 与注册表的插入点一致', () => {
  assert.equal(id, 'admission.absorb')
  assert.equal(point, 'admission')
})

test('appliesTo ★ 两个条件缺一不可，且"含糊的话"不算声称', () => {
  // 声称 + 需求阶段 ⇒ 生效
  assert.equal(appliesTo(ctx()), true)
  assert.equal(appliesTo(ctx({ absorb: { claims: 'nothing-to-change' }, task: { id: 't', kind: 'plan' } })), true)
  // 没声称 ⇒ 不生效（没有可核对的东西）
  assert.equal(appliesTo(ctx({ absorb: {} })), false)
  assert.equal(appliesTo(ctx({ absorb: { claims: 'done' } })), false, '★ 取值之外的话不算声称')
  assert.equal(appliesTo(undefined), false)
  // 不是需求/计划阶段 ⇒ 不生效
  assert.equal(appliesTo(ctx({ task: { id: 't', kind: 'implementation' } })), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 输入面（t6 的 B 层 + A 层）：声明与实测必须一致
// ─────────────────────────────────────────────────────────────────────────────

test('★ 输入面声明：`requires` 与本判据的未测量臂【逐条对齐】，闸门格不许进声明', async () => {
  assert.deepEqual(
    [...requires], ['observedDocumentChanged', 'documentsRead', 'producedDocuments'],
    '★ 本判据要 ctx 的哪几格，只此三格',
  )

  /**
   * ★ 正向：声明的每一格缺席 ⇒ 判据必须说不出话（unmeasured），而不是 ok / blocked。
   *   若某一格缺席时判据仍给出 ok，那这一格就不该进 requires。
   */
  const full = ctx()
  assert.equal(gate(full).ok, true, '★ 前提：一格不缺时它是 ok —— 否则下面那条"拿掉一格"证明不了任何事')
  for (const path of requires) {
    const broken = structuredClone(full)
    for (const segment of path.split('.')) {
      if (segment === path) delete broken[segment]
    }
    const verdict = gate(broken)
    assert.equal(verdict.ok, false, `★ 声明的 '${path}' 缺席 ⇒ 判据必须说不出话；若它仍 ok，那一格就不该进 requires`)
    assert.equal(
      'unmeasured' in verdict, true,
      `★ 而且要是"未能观察"这一类，不是"发现问题"那一类（实际 ${JSON.stringify(verdict)}）`,
    )
  }

  /**
   * ★ 反向：**闸门格不许进 requires**。
   *
   *   它们缺席时 `appliesTo` 为假 ⇒ 注册表直接跳过 ⇒ `gate()` 根本不会被调用。
   *   把 `task.kind` / `absorb.claims` 声明进来，核对层会在"这条判据按设计闭嘴"
   *   的每一次调用上报缺格 —— 噪音，而噪音教人忽略门禁。
   *
   *   定向突变：把 'task.kind' 加进 absorb.ts 的 requires ⇒ 本条**必须红**。
   */
  assert.equal(requires.includes('task.kind'), false, '★ 闸门格不进 requires：不适用不报')
  assert.equal(requires.includes('absorb'), false, '★ 同上')
  assert.equal(requires.includes('absorb.claims'), false, '★ 同上')
})

test('★ A 层核对：适用而缺一格 ⇒ 核对【报出缺的是哪一格】；不适用 ⇒ 不报', () => {
  const subject = { id, requires, appliesTo }

  // ① 声明齐了 ⇒ ok（对照臂）
  const injected = checkRequires(subject, ctx(), true)
  assert.equal(injected.status, 'ok')
  assert.deepEqual(injected.missing, [])
  assert.deepEqual([...injected.present].sort(), ['documentsRead', 'observedDocumentChanged', 'producedDocuments'])

  // ② 适用、但没接上观察 ⇒ 必须指名报缺
  const withoutObservation = checkRequires(subject, ctx({ observedDocumentChanged: undefined, documentsRead: undefined }), true)
  assert.equal(withoutObservation.status, 'incomplete')
  assert.deepEqual([...withoutObservation.missing].sort(), ['documentsRead', 'observedDocumentChanged'])

  // ③ 不适用（本次没声称吸收）⇒ 一格缺席【不报】—— 不制造噪音
  const notApplicable = checkRequires(subject, { task: { kind: 'requirement' } })
  assert.equal(notApplicable.status, 'skipped')
  assert.equal(notApplicable.status === 'skipped' && notApplicable.skipReason, 'not-applicable')
  assert.deepEqual(notApplicable.missing, [], '★ 不适用不许产出噪音')
})

test('★ A 层核对：`observedDocumentChanged: false` 是【在场】的观察，不是缺格', () => {
  /**
   * ★ `false` 与 `undefined` 必须不同形（与 `dispatch.changed-paths` 的 `[]` vs
   *   `undefined` 同一条纪律）：前者是"观察了、确实没写过"（判据据此判定空操作），
   *   后者是"没能观察"。把 `false` 读成缺格，会让那条**最有用**的拒绝
   *   （"你声称吸收了、而产物一行没动"）永远走不到。
   */
  const check = checkRequires({ id, requires, appliesTo }, ctx({ observedDocumentChanged: false }), true)
  assert.equal(check.status, 'ok', '★ `false` 是在场的观察')
  assert.deepEqual(check.present, [...requires])

  const verdict = gate(ctx({ observedDocumentChanged: false, producedContent: { [DOC]: 'v1\n' } }))
  assert.equal(verdict.ok, false)
  assert.equal('blockers' in verdict, true, '★ 而它在"在场"之下就该开火 —— 在场不等于通过')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 定向突变（真的执行）：把"产物真的变了"那半边改成【恒真】⇒ 臂 1 必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这条突变要**真的跑**，而不是写在注释里 ────────────────────────────────
 *
 * 契约 §8.5 规则二：「没被突变抓住的修复，等于没修」。而它的后半句更狠：
 * **一条恒真的断言会在"突变全红"的表象下活下来**。所以本文件不是"声称"这一次
 * 突变能打红臂 1，而是把它跑出来：
 *
 *     ① 备份 `src/gates/admission/absorb.ts`
 *     ② 把那一次内容比较改成恒真（"读过的产物一律算变过"）
 *     ③ 重新 build 出 `lib/`（整个仓库的夹具读的都是 lib/，所以必须真的重建）
 *     ④ 用臂 1 的三个输入再问一次 ⇒ **它们必须不再被拒**（这就是臂 1 变红）
 *     ⑤ 还原源码、重新 build，并断言还原之后的裁决与突变前**逐字相等**
 *
 * ★ 第 ⑤ 步不是礼节：没有它，一次中途失败会把一条被突变的判据留在盘上，
 *   而此后所有夹具都在测一份没人认得的代码 —— 那比突变本身坏得多。
 *
 * ★ 顺序是【串行】的，而且必须：`pnpm build` 会先 `rm -rf lib/`（clean-build），
 *   并行跑两个 build 会让另一个进程读到半个 lib/。本文件因此不做任何并行突变。
 */

/**
 * ── ★★ 这一节的设计被自己的实测推翻过两次，两次都值得记 ────────────────────────
 *
 * MEASURED（本任务，第一版）：突变臂把还原写在 `finally` 里，**而 `finally` 里的
 * 还原本身会抛**（`assert.equal(restored.status, 0)`）—— 于是：
 *
 *     ① 断言失败 ⇒ 还原分支抛错 ⇒ 源码留在**突变态**；
 *     ② 更坏的一层：还原前的那次 build 撞上**队友正在跑的 `pnpm build`**
 *        （它先 `rm -rf lib/`）⇒ `lib/gates/admission/absorb.js` 那一刻不在盘上
 *        ⇒ 还原读取抛 ENOENT ⇒ 源码**永久**留在突变态，而报告里只有一句
 *        "突变体必须放行臂 1"，读的人完全不知道盘上留了一份变异体。
 *
 * ★ 这正是本仓那条硬约束的字面形态：**`rm -rf lib/` 的窗口会让并行读到假红**。
 *   它不是"偶尔抖一下"，它会把一次安全操作变成一次数据损坏。
 *
 * ⇒ 修法有三条，每条对应上面一种失效：
 *
 *   ① **还原永不抛**：把源码写回放在 `try/finally` 的最外层，且**不走断言** ——
 *      还原失败要能被看见，但它绝不能阻止下一次还原。
 *   ② **进程退出兜底**：`process.on('exit')` 再写一次原文（兜住 `process.exit`
 *      与未捕获异常那条路）。★ 它必须捕获**原始文本**，而不是"读当前源码"。
 *   ③ **不读 lib/**：突变体的裁决通过**子进程**问（子进程启动时读的必然是 build
 *      之后的 lib/），而不是在测试进程里靠带 query 的 import 去猜模块缓存。
 *      父进程里的 `gate()` 是 import 时捕获的绑定，**它永远指向基线** ——
 *      第一版错就错在这里（它拿基线去问"突变体放行了吗"，答案恒为"没有"）。
 */
function absorbCtx(overrides = {}) {
  return {
    task: { id: 't7', kind: 'requirement' },
    absorb: { claims: 'absorbed' },
    producedDocuments: [DOC],
    observedDocumentChanged: true,
    documentsRead: { [DOC]: 'v1: 需求第一版\n' },
    producedContent: { [DOC]: 'v2: 吸收后改过\n' },
    ...overrides,
  }
}

/** 一个读数探针：把它的输入写死在文件里，让**子进程**去读 lib/ 里的判据并回答。 */
function writeProbeFile(path) {
  writeFileSync(path, `
import { gate } from ${JSON.stringify(BUILT_GATE)}
const DOC = ${JSON.stringify(DOC)}
const ctx = (o) => ({
  task: { id: 't7', kind: 'requirement' },
  absorb: { claims: 'absorbed' },
  producedDocuments: [DOC],
  observedDocumentChanged: true,
  documentsRead: { [DOC]: 'v1: 需求第一版\\n' },
  producedContent: { [DOC]: 'v2: 吸收后改过\\n' },
  ...o,
})
process.stdout.write(JSON.stringify({
  lieAboutContent: gate(ctx({ producedContent: { [DOC]: 'v1: 需求第一版\\n' } })).ok,
  lieAboutWrite: gate(ctx({ observedDocumentChanged: false, producedContent: { [DOC]: 'v1: 需求第一版\\n' } })).ok,
  lieAboutReading: gate(ctx({ documentsRead: {} })).ok,
  control: gate(ctx()).ok,
}))
`)
}

/** 在**子进程**里问一次 lib/ 的当前内容（它的模块缓存是全新的，不依赖父进程的 import）。 */
function readVerdicts(probePath) {
  const run = spawnSync(process.execPath, [probePath], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(run.status, 0, `★ 读数探针必须跑得起来（lib/ 可能在队友的 rm -rf 窗口里）:\n${run.stdout}\n${run.stderr}`)
  return JSON.parse(run.stdout)
}

function rebuild() {
  const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
  return { status: built.status, output: `${built.stdout}\n${built.stderr}` }
}

// ─────────────────────────────────────────────────────────────────────────────

test('★ 定向突变：把「产物真的变了」那半边改成恒真（只信声明）⇒ 臂 1 那条输入不再被拒', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启、默认跳过，由本任务的验证读数那次单独运行。
   *
   * ★ 但"默认跳过"**不是**把机制关掉：跳过的成因由环境变量显式表达，而运行它的
   *   那一次读数记在任务的 output 里 —— 缺了那次读数，本臂不算数。
   */
  if (process.env.AGENT_TEAMS_ABSORB_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_ABSORB_MUTATION=1 时运行（读数见任务 output）')
    return
  }

  const original = readFileSync(GATE_SOURCE, 'utf8')
  /**
   * ★ 兜底一：进程无论怎么退出，源码都回到原文。
   *   ★ 它捕获的是**此刻读到的原始文本**，不是"退出时再去读源码"—— 后者会在
   *     一次损坏之后把损坏态当成"原文"再写一遍（本队记账的"守卫检查了另一个
   *     同名的东西"）。
   */
  const restore = () => {
    try { writeFileSync(GATE_SOURCE, original) } catch { /* 还原尽力而为，见下 */ }
  }
  process.on('exit', restore)

  const NEEDLE = `    else if (now !== then) changedAtReadTime.push(path)`
  const mutated = original.replaceAll(
    NEEDLE,
    `    else if (true) changedAtReadTime.push(path) // MUTANT: "the document changed" is taken on faith`,
  )
  /**
   * ★ `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的替换会让突变体与
   *   基线逐字相同，于是"变了"这件事变成恒假 —— 那是本队记账的第二种恒真写法
   *   （恒红）的镜像：**突变没生效，而报告说它生效了**。
   */
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一次内容比较 —— 没匹配上的替换会让这次突变恒不生效')

  const probePath = join(realpathSync(mkdtempSync(join(tmpdir(), 'absorb-mutation-'))), 'probe.mjs')
  writeProbeFile(probePath)

  try {
    /** ① 基线（突变之前）：臂 1 的那条输入必须被拒、对照臂必须通过。 */
    const baseline = readVerdicts(probePath)
    assert.deepEqual(
      baseline,
      { lieAboutContent: false, lieAboutWrite: false, lieAboutReading: false, control: true },
      '★ 突变之前，臂 1 的三个输入必须全被拒、对照臂必须通过 —— 否则下面测的不是突变，是别的东西',
    )

    /** ② 注入突变并重建。★ 这一步会 `rm -rf lib/`，所以本文件**不在此刻并发跑别的 build**。 */
    writeFileSync(GATE_SOURCE, mutated)
    const built = rebuild()
    assert.equal(built.status, 0, `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是判据的裁决）:\n${built.output}`)

    /** ③ 在**子进程**里问突变体 —— 父进程的 `gate` 绑定永远指向基线，问它等于什么都没问。 */
    const mutant = readVerdicts(probePath)
    assert.equal(
      mutant.lieAboutContent, true,
      '★ 突变体必须放行"读了没改"那条输入 —— 放行不了说明这一半不是臂 1 赖以成立的那个东西（即臂 1 是恒红的）',
    )
    /**
     * ★ 另外两条半边不受影响是**刻意的**：本次突变只拆掉"内容比较"那一半。
     *   于是这一条同时证明"三条半边各自独立"，而不是一个布尔把三件事一起放行。
     */
    assert.equal(mutant.lieAboutWrite, false, '★ 另外两条半边不受影响（它们各自独立）')
    assert.equal(mutant.lieAboutReading, false, '★ 同上')
    assert.equal(mutant.control, true, '★ 对照臂在突变体上照常通过 —— 突变不是把判据整个打瘫')
    assert.notDeepEqual(mutant, baseline, '★ 突变体与基线的裁决必须真的不同 —— 相同说明这次突变什么都没测到')
  } finally {
    /**
     * ★ 还原顺序是刻意的，而且**还原路径上不许有任何断言**：
     *   一次失败必须留下**干净**的工作区 + 一条失败信息，绝不能留下一个变异体。
     *   第一版就是在 finally 里写了一条 `assert.equal(restored.status, 0)`，
     *   于是还原失败时源码永久留在突变态（见上面那段 MEASURED）。
     */
    writeFileSync(GATE_SOURCE, original)
    rmSync(probePath, { force: true })
    rmSync(dirname(probePath), { recursive: true, force: true })
  }

  /**
   * ★ 还原之后必须能重新 build 成功，且裁决与突变前逐字一致 —— 否则盘上留着一份
   *   没人认得的判据。★ 这一步放在 `finally` **之外**：它允许失败（失败会被报告），
   *   但它绝不能挡住还原。
   */
  const restored = rebuild()
  assert.equal(restored.status, 0, `★ 还原之后必须能重新 build 成功:\n${restored.output}`)
  assert.equal(readFileSync(GATE_SOURCE, 'utf8'), original, '★ 源码必须逐字回到原文')

  const restoredProbeDir = realpathSync(mkdtempSync(join(tmpdir(), 'absorb-restored-')))
  const restoredProbe = join(restoredProbeDir, 'probe.mjs')
  writeProbeFile(restoredProbe)
  try {
    assert.deepEqual(
      readVerdicts(restoredProbe),
      { lieAboutContent: false, lieAboutWrite: false, lieAboutReading: false, control: true },
      '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的判据',
    )
  } finally {
    rmSync(restoredProbeDir, { recursive: true, force: true })
  }
})

test('★ 二次对照：突变脚本本身在【不匹配】时必须炸（否则它是一个恒真的机制）', () => {
  /**
   * ★ 这条不测判据，测的是上面那条突变**赖以成立的前提**：`replaceAll` 的针脚
   *   串在源码里**真的存在**。针脚写错一个字符，上面的突变就会静默变成"什么都没改"，
   *   而报告里它会读作"突变没打红 ⇒ 臂 1 是恒真的"—— 一个**方向相反**的结论。
   *
   *   定向突变：把 absorb.ts 里那一行的空白改掉 ⇒ 本条红（且红得比上面那条早）。
   */
  const NEEDLE = `    else if (now !== then) changedAtReadTime.push(path)`
  assert.equal(
    readFileSync(GATE_SOURCE, 'utf8').includes(NEEDLE),
    true,
    '★ 突变针脚必须逐字存在于 absorb.ts —— 它不在了，上面那次"定向突变"就是在改一个不存在的字符串',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 装配层：本条判据能不能真的被注册表装上（"装了但调不到"是本队记账五次的那件事）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 装配形状：这条判据交给注册表时不会当场抛错（缺导出 / point 写错都是启动即炸）', async () => {
  const r = createGateRegistry()
  r.register({ id, point, description: 'x', gate, appliesTo, requires })
  const evaluation = await r.evaluate(point, ctx())
  assert.equal(evaluation.registered, 1)
  assert.equal(evaluation.evaluated, 1, '★ 适用 ⇒ 真的跑了（不是 skipped）')
  assert.equal(evaluation.ok, true)
  assert.deepEqual(evaluation.outputs[id].absorbDocuments ?? evaluation.outputs[id].absorbReport.absorbedDocuments, [DOC])

  /** ★ 反向半边：不适用时它必须**不说话**，而不是"说 ok"。 */
  const silent = await r.evaluate(point, { task: { kind: 'requirement' } })
  assert.equal(silent.evaluated, 0)
  assert.equal(silent.skipped, 1)
  assert.equal(silent.ok, true, '★ 跳过是正常情形，不翻成 ok:false')
})

// ─────────────────────────────────────────────────────────────────────────────
// 夹具自检（★ 用真的临时目录，逐条钉住上面那些"假事实"的形状）
// ─────────────────────────────────────────────────────────────────────────────

test('夹具自检：产物"变没变"的那两个内容快照来自【两个不同的时刻】', () => {
  /**
   * ★ 这一条钉的是本夹具（以及整个判据）的**输入形状**：`documentsRead` 是吸收
   *   那一刻读到的，`producedContent` 是产物现在的样子。若有人把它们合成一次读，
   *   两边恒等 ⇒ 判据恒真（记账的第四种写法：守卫检查了另一个同名的东西）。
   *
   *   做法：真的用一个临时目录 + 真的文件，把"读 → 改 → 再读"走一遍。
   */
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'absorb-shape-')))
  try {
    const file = join(dir, 'REQUIREMENTS.md')
    writeFileSync(file, 'v1\n')
    const read = readFileSync(file, 'utf8')
    writeFileSync(file, 'v2\n')
    const now = readFileSync(file, 'utf8')
    assert.notEqual(read, now, '★ "读到的"与"现在的"必须来自两个时刻，否则整条判据恒真')

    const verdict = gate(ctx({ documentsRead: { [DOC]: read }, producedContent: { [DOC]: now } }))
    assert.equal(verdict.ok, true)

    /** ★ 而把两次读合成一次（同一份内容）⇒ 必须红：这才是"空操作"该有的下场。 */
    const hollow = gate(ctx({ documentsRead: { [DOC]: read }, producedContent: { [DOC]: read } }))
    assert.equal(hollow.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
