import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClipboard, defineImplicitConversion, planPaste } from './clipboard.ts'
import type { ClipboardContent, SelectionBounds } from './clipboard.ts'
import type { StructDef, TableRow } from './types.ts'

// 同构 6 列 string：tiling 例子的目标
const strDef: StructDef = {
  kind: 'struct',
  name: 'S6',
  fields: [
    { name: 'A', type: 'string' },
    { name: 'B', type: 'string' },
    { name: 'C', type: 'string' },
    { name: 'D', type: 'string' },
    { name: 'E', type: 'string' },
    { name: 'F', type: 'string' },
  ],
}

// 混合类型：转换/阻断测试
const mixedDef: StructDef = {
  kind: 'struct',
  name: 'T',
  fields: [
    { name: 'S', type: 'string' },
    { name: 'N', type: 'number' },
    { name: 'E', type: 'School' },
    { name: 'M', type: '', map: true, keyType: 'string', valueType: 'number' },
  ],
}

const bounds = (rowStart: number, rowEnd: number, colStart: number, colEnd: number): SelectionBounds => ({
  rowStart,
  rowEnd,
  colStart,
  colEnd,
})

const board2x2: ClipboardContent = [
  [
    { type: 'string', value: 'a' },
    { type: 'string', value: 'b' },
  ],
  [
    { type: 'string', value: 'c' },
    { type: 'string', value: 'd' },
  ],
]

test('ctrl+c：值快照（含缺值 undefined）', () => {
  const rows: TableRow[] = [{ A: 'a', B: 1 }, {}]
  const clip = buildClipboard(rows, strDef, bounds(0, 1, 0, 1))
  assert.equal(clip.length, 2)
  assert.deepEqual(clip[0][0], { type: 'string', value: 'a' })
  assert.deepEqual(clip[0][1], { type: 'string', value: 1 })
  assert.deepEqual(clip[1][0], { type: 'string', value: undefined })
})

test('number→string：已定义路径转换生效', () => {
  const clip: ClipboardContent = [[{ type: 'number', value: 42 }]]
  const plan = planPaste(clip, bounds(0, 0, 0, 0), mixedDef, 10, 4)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') {
    assert.equal(plan.writes.length, 1)
    assert.equal(plan.writes[0].fieldName, 'S')
    assert.equal(plan.writes[0].value, '42')
  }
})

test('string→number：未定义路径报错并整体阻断', () => {
  const clip: ClipboardContent = [[{ type: 'string', value: 'x' }]]
  const plan = planPaste(clip, bounds(0, 0, 1, 1), mixedDef, 10, 4)
  assert.equal(plan.status, 'error')
  if (plan.status === 'error') assert.match(plan.message, /未定义隐式转换/)
})

test('同类型恒等（含枚举与 map 标签）', () => {
  const enumClip: ClipboardContent = [[{ type: 'School', value: 6 }]]
  const enumPlan = planPaste(enumClip, bounds(0, 0, 2, 2), mixedDef, 10, 4)
  assert.equal(enumPlan.status, 'ok')
  if (enumPlan.status === 'ok') assert.equal(enumPlan.writes[0].value, 6)

  const mapClip: ClipboardContent = [[{ type: 'map<string,number>', value: { '001': 20 } }]]
  const mapPlan = planPaste(mapClip, bounds(0, 0, 3, 3), mixedDef, 10, 4)
  assert.equal(mapPlan.status, 'ok')
  if (mapPlan.status === 'ok') assert.deepEqual(mapPlan.writes[0].value, { '001': 20 })
})

test('缺值单元格粘贴为清空（写 undefined，不走转换）', () => {
  const clip: ClipboardContent = [[{ type: 'number', value: undefined }]]
  const plan = planPaste(clip, bounds(0, 0, 1, 1), mixedDef, 10, 4)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') assert.equal(plan.writes[0].value, undefined)
})

test('tiling 例 1：单格贴整列', () => {
  const clip: ClipboardContent = [[{ type: 'string', value: 'my text' }]]
  const plan = planPaste(clip, bounds(2, 4, 0, 0), strDef, 10, 6)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') {
    assert.equal(plan.writes.length, 3)
    assert.equal(plan.writes[0].row, 2)
    assert.equal(plan.writes[1].row, 3)
    assert.equal(plan.writes[2].row, 4)
    for (const w of plan.writes) assert.equal(w.value, 'my text')
  }
})

test('tiling 例 2：2x2 贴 6 宽 3 高，只写完整瓦片（第三行不动）', () => {
  const plan = planPaste(board2x2, bounds(0, 2, 0, 5), strDef, 10, 6)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') {
    assert.equal(plan.writes.length, 12)
    const row0 = plan.writes.filter(w => w.row === 0)
    const row1 = plan.writes.filter(w => w.row === 1)
    const row2 = plan.writes.filter(w => w.row === 2)
    assert.equal(row0.length, 6)
    assert.equal(row1.length, 6)
    assert.equal(row2.length, 0)
    assert.deepEqual(row0.map(w => w.value), ['a', 'b', 'a', 'b', 'a', 'b'])
    assert.deepEqual(row1.map(w => w.value), ['c', 'd', 'c', 'd', 'c', 'd'])
  }
})

test('裁决：目标 1x1 → 完整剪切板贴一次', () => {
  const plan = planPaste(board2x2, bounds(3, 3, 0, 0), strDef, 10, 6)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') {
    assert.equal(plan.writes.length, 4)
    assert.equal(plan.writes[0].row, 3)
    assert.equal(plan.writes[0].value, 'a')
    assert.equal(plan.writes[3].row, 4)
    assert.equal(plan.writes[3].fieldName, 'B')
    assert.equal(plan.writes[3].value, 'd')
  }
})

test('裁决：目标 1x1 贴大板，越工作区裁剪', () => {
  const clip: ClipboardContent = [
    [{ type: 'string', value: 'a' }],
    [{ type: 'string', value: 'c' }],
  ]
  const plan = planPaste(clip, bounds(9, 9, 0, 0), strDef, 10, 6)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') {
    assert.equal(plan.writes.length, 1)
    assert.equal(plan.writes[0].row, 9)
    assert.equal(plan.writes[0].value, 'a')
  }
})

test('裁决：多选目标容纳不下 → 报错阻断', () => {
  const clip: ClipboardContent = [
    [
      { type: 'string', value: 'a' },
      { type: 'string', value: 'b' },
      { type: 'string', value: 'c' },
    ],
  ]
  const plan = planPaste(clip, bounds(0, 1, 0, 1), strDef, 10, 6)
  assert.equal(plan.status, 'error')
  if (plan.status === 'error') assert.match(plan.message, /无法容纳/)
})

test('tiling：3x3 目标贴 2x2 板 → 只有一个完整瓦片（4 格）', () => {
  const plan = planPaste(board2x2, bounds(0, 2, 0, 2), strDef, 10, 6)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') {
    assert.equal(plan.writes.length, 4)
    assert.deepEqual(plan.writes[0].value, 'a')
    assert.deepEqual(plan.writes[3].value, 'd')
  }
})

test('空剪切板报错', () => {
  const plan = planPaste([], bounds(0, 0, 0, 0), strDef, 10, 6)
  assert.equal(plan.status, 'error')
})

test('自定义转换注册可扩展（spec API 形状）', () => {
  defineImplicitConversion('string', 'School', v => Number(v))
  const clip: ClipboardContent = [[{ type: 'string', value: '8' }]]
  const plan = planPaste(clip, bounds(0, 0, 2, 2), mixedDef, 10, 4)
  assert.equal(plan.status, 'ok')
  if (plan.status === 'ok') assert.equal(plan.writes[0].value, 8)
})
