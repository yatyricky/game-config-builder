import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FOCUS, moveFocus, navKeyOf } from './selection.ts'

const RC = 12
const CC = 5

test('默认焦点为工作区第一行第一列', () => {
  assert.deepEqual(DEFAULT_FOCUS, { row: 0, col: 0 })
})

test('方向键四向移动', () => {
  const f = { row: 2, col: 1 }
  assert.deepEqual(moveFocus(f, 'ArrowDown', RC, CC), { row: 3, col: 1 })
  assert.deepEqual(moveFocus(f, 'ArrowUp', RC, CC), { row: 1, col: 1 })
  assert.deepEqual(moveFocus(f, 'ArrowLeft', RC, CC), { row: 2, col: 0 })
  assert.deepEqual(moveFocus(f, 'ArrowRight', RC, CC), { row: 2, col: 2 })
})

test('四条边界不生效（单选不回绕）', () => {
  const tl = { row: 0, col: 0 }
  assert.deepEqual(moveFocus(tl, 'ArrowLeft', RC, CC), tl)
  assert.deepEqual(moveFocus(tl, 'ArrowUp', RC, CC), tl)
  const br = { row: RC - 1, col: CC - 1 }
  assert.deepEqual(moveFocus(br, 'ArrowDown', RC, CC), br)
  assert.deepEqual(moveFocus(br, 'ArrowRight', RC, CC), br)
})

test('回车系与 Tab 系等效方向键', () => {
  const f = { row: 2, col: 1 }
  assert.deepEqual(moveFocus(f, 'Enter', RC, CC), moveFocus(f, 'ArrowDown', RC, CC))
  assert.deepEqual(moveFocus(f, 'ShiftEnter', RC, CC), moveFocus(f, 'ArrowUp', RC, CC))
  assert.deepEqual(moveFocus(f, 'Tab', RC, CC), moveFocus(f, 'ArrowRight', RC, CC))
  assert.deepEqual(moveFocus(f, 'ShiftTab', RC, CC), moveFocus(f, 'ArrowLeft', RC, CC))
})

test('回车系同样受边界约束', () => {
  const br = { row: RC - 1, col: CC - 1 }
  assert.deepEqual(moveFocus(br, 'Enter', RC, CC), br)
  const tl = { row: 0, col: 0 }
  assert.deepEqual(moveFocus(tl, 'ShiftEnter', RC, CC), tl)
  assert.deepEqual(moveFocus(tl, 'ShiftTab', RC, CC), tl)
})

test('空工作区不动，入参不被修改', () => {
  const f = { row: 0, col: 0 }
  assert.deepEqual(moveFocus(f, 'ArrowDown', 0, CC), f)
  assert.deepEqual(moveFocus(f, 'ArrowRight', RC, 0), f)
  const before = { ...f }
  moveFocus(f, 'ArrowDown', RC, CC)
  assert.deepEqual(f, before)
})

test('navKeyOf 映射与 shift 变体', () => {
  assert.equal(navKeyOf('ArrowDown', false), 'ArrowDown')
  assert.equal(navKeyOf('ArrowUp', true), 'ArrowUp')
  assert.equal(navKeyOf('Enter', false), 'Enter')
  assert.equal(navKeyOf('Enter', true), 'ShiftEnter')
  assert.equal(navKeyOf('Tab', false), 'Tab')
  assert.equal(navKeyOf('Tab', true), 'ShiftTab')
  assert.equal(navKeyOf('a', false), null)
  assert.equal(navKeyOf('Escape', true), null)
})
