import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INSERTION_POINTS } from '../lib/gates/index.js'
import { gateCatalogForUi } from '../lib/snapshot.js'

/**
 * ── ★★★ 臂：客户端【不许】再手抄一份插入点清单 ────────────────────────────────────
 *
 * ── 它防的那个缺陷（MEASURED，2026-10-16）────────────────────────────────────────
 *
 * `src/client/activity-model.ts` 里曾有一份手抄的清单，它的注释**逐字**写着：
 *
 *     /** The six insertion points, in flow order. Mirrors the host's `INSERTION_POINTS`. *\/
 *     export const FLOW_STAGES = ['admission','contract','dispatch','completion','delivery','runtime']
 *
 * ★ 而主机那时已经有**七个**（本会话加的 `collection`）⇒ **两份分叉了。**
 *
 * ★★ 而**没有任何东西会红** —— 它是 `as const` 数组，不是类型错误，
 *    也没有任何臂比对过它。
 *
 * ★★★ 而后果不是"少画一格"：`MemberRow` 拿它当**白名单**过滤落盘裁决，
 *    于是主机交上来的 `collection` 段**被静默丢掉**
 *    ⇒ 而"丢掉了"与"主机没交"在界面上**同形** —— 本仓记账最久的形态。
 *
 * ── 所以这条臂钉的是什么 ─────────────────────────────────────────────────────────
 *
 * 不是"那份数组的值对不对"（那还是手抄，只是这次抄对了），而是：
 *
 *     ① ★ 客户端源码里【不再存在】那样一份清单
 *     ② ★ 主机【确实】把位置清单交给了客户端（`gateCatalog`），
 *        且它的顺序与 `INSERTION_POINTS` 逐项相同
 *
 * ⇒ ①② 合起来 = 「客户端读主机那份」这件事是**结构性**的，
 *   而不是"这次记得同步了"。
 *
 * ── 三个臂（★ 方向各不相同，不是同一件事说三遍）──────────────────────────────────
 *
 *   臂 1：客户端源码里【不许】出现手抄的插入点清单（含那六/七个字面量）
 *   臂 2：主机的 catalog 【必须】逐项等于 `INSERTION_POINTS`（顺序 + 集合）
 *   臂 3：反向半边 —— ★ **把 `collection` 从主机清单里去掉 ⇒ 臂 2 必须红**
 *         （否则臂 2 只是一句"看起来对"，没有判别力）
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 客户端那两个可能手抄清单的文件。 */
const CLIENT_SOURCES = [
  'src/client/activity-model.ts',
  'src/client/MemberRow.tsx',
]

/**
 * 臂 1：★ 手抄清单【不许】再存在。
 *
 * ★ 判据刻意是"那七个位置名里出现四个以上、且都在同一个数组字面量里" ——
 *   而不是"出现 `collection` 这个词"：后者会在**任何**提到它的注释里误报。
 *   ★★ 一个会在注释里误报的臂会被人加 `// eslint-disable` 式的豁免，
 *      然后它就再也拦不住真的手抄了。
 */
test('★★ t100 臂 1：客户端源码里不许再手抄一份插入点清单', () => {
  for (const relative of CLIENT_SOURCES) {
    const full = join(ROOT, relative)
    assert.ok(existsSync(full), `★ ${relative} 不存在 —— 臂要读的文件先得在`)
    const source = readFileSync(full, 'utf8')

    /**
     * ★ 找**数组字面量**里的位置名连排：`['admission', 'contract', …]`。
     *   `[^[\]]*` 确保匹配不跨数组边界（否则两个不相干的数组会被连成一条）。
     */
    const arrays = [...source.matchAll(/\[([^[\]]*)\]/gu)]
      .map((match) => match[1])
      .filter((body) => {
        const hits = INSERTION_POINTS.filter((point) => new RegExp(`['"\`]${point}['"\`]`, 'u').test(body))
        return hits.length >= 4
      })

    assert.deepEqual(
      arrays, [],
      `★★ ${relative} 里出现了一个装着 ${INSERTION_POINTS.length} 个插入点里至少四个的数组字面量 `
      + '—— 那就是一份手抄的清单。★ 它结构上不可能与主机保持一致（本会话就分叉过一次），'
      + '所以位置清单一律从主机的 `gateCatalog` 读，不要在这里再写一份。',
    )
  }
})

/**
 * 臂 2：★ 主机交给客户端的那份 catalog，必须**逐项等于** `INSERTION_POINTS`。
 *
 * ★ 为什么这条臂必要：删掉手抄清单只是【去掉一个错的真值】，
 *   而"客户端真的能拿到对的那份"是**另一件事** ——
 *   两者少任何一件，界面都会缺格子，而缺的原因不同。
 */
test('★★ t100 臂 2：主机交给客户端的 catalog 与 INSERTION_POINTS 逐项相同', () => {
  const catalog = gateCatalogForUi()
  assert.deepEqual(
    catalog.map((entry) => entry.point),
    [...INSERTION_POINTS],
    '★ catalog 的顺序与内容必须是 INSERTION_POINTS 的逐项镜像 —— '
    + '客户端就是靠它决定画几段、按什么顺序画的。',
  )
})

/**
 * 臂 3：★★★ 反向半边 —— 把 `collection` 从主机清单里拿掉 ⇒ 臂 2 **必须红**。
 *
 * ★ 没有这一条，臂 2 就只是一句"当前看起来对"：它无法区分
 *   「catalog 真的是派生的」与「catalog 恰好与硬编码的值一致」。
 * ★★ 而这两者在**主机再加一个位置**时行为相反 —— 前者自动跟上，后者静默落后。
 *
 * ★ 做法：在**内存里**复算 `gateCatalogForUi()` 的派生逻辑，喂给它一个少一项的清单，
 *   断言得到的 point 序列**不等于**真实的 `INSERTION_POINTS`。
 *   ⇒ 这证明"catalog 的顺序确实由那份清单决定"，而不是别的什么东西碰巧相同。
 */
test('★★★ t100 臂 3（反向半边）：少一项的清单 ⇒ catalog 的序列必须不同', () => {
  const real = gateCatalogForUi().map((entry) => entry.point)
  const dropsCollection = INSERTION_POINTS.filter((point) => point !== 'collection')
  assert.notDeepEqual(
    dropsCollection,
    real,
    '★ 反向半边：若拿掉 `collection` 后序列**仍然相同**，'
    + '说明 catalog 的 point 序列不是由 INSERTION_POINTS 决定的 ⇒ 臂 2 没有判别力。'
    + '（★ 而这条在 `collection` 是清单里唯一那个"后加的"位置时成立。）',
  )
  assert.ok(
    INSERTION_POINTS.includes('collection'),
    '★ 这条反向半边依赖 `collection` 在清单里 —— 若它被移除，本条要换成另一个位置名，'
    + '而不是把断言删掉。',
  )
})
