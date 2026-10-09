import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_HEADER_WIDTH, ROW_HEIGHT, canvasHeight, layoutColumns, totalWidth, visibleRows } from './layout.ts'
import type { FieldDef } from '../data/types.ts'

const fields: FieldDef[] = [
  { name: 'ID', type: { raw: 'string' } },
  { name: 'Name', type: { raw: 'string' } },
  { name: 'Age', type: { raw: 'number' } },
]

test('列布局：偏移按列宽递增', () => {
  const cols = layoutColumns(fields)
  assert.deepEqual(cols.map(c => c.left), [0, 120, 240])
  assert.deepEqual(cols.map(c => c.width), [120, 120, 120])
})

test('总宽与画布高', () => {
  assert.equal(totalWidth(3), ROW_HEADER_WIDTH + 3 * 120)
  assert.equal(canvasHeight(12), 12 * ROW_HEIGHT)
})

test('可见行窗口：视口内行 + overscan', () => {
  // 视口高 240 = 10 行，scrollTop 0 → 行 0..10 加 overscan 5，裁到 12
  assert.deepEqual(visibleRows(0, 240, 12), { start: 0, end: 12 })
  // 大表中部：scrollTop 2400（第 100 行起）→ 可见 100..109，加 overscan 后 95..115
  assert.deepEqual(visibleRows(2400, 240, 100_000), { start: 95, end: 115 })
})

test('可见行窗口：越界裁剪', () => {
  assert.deepEqual(visibleRows(0, 240, 3), { start: 0, end: 3 })
  // scrollTop 超出画布：空窗口，不倒置
  assert.deepEqual(visibleRows(999_999, 240, 12), { start: 12, end: 12 })
})

test('可见行窗口：空表与零高视口', () => {
  assert.deepEqual(visibleRows(0, 240, 0), { start: 0, end: 0 })
  assert.deepEqual(visibleRows(0, 0, 12), { start: 0, end: 5 })
})
