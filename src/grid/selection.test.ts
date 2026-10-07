import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SELECTION, focusToMatrixOrigin, isMatrix, isInSelection, navigate, navKeyOf, rectBetween, singleAt } from './selection.ts'
import type { Focus, Selection } from './selection.ts'

const RC = 12
const CC = 5

const single = (row: number, col: number): Selection => singleAt({ row, col })
/** 矩阵：行 1..3、列 2..4（3x3），焦点位置可指定 */
const mat = (focusRow: number, focusCol: number): Selection => ({
  rowStart: 1,
  rowEnd: 3,
  colStart: 2,
  colEnd: 4,
  focus: { row: focusRow, col: focusCol },
})

test('默认选中工作区第一行第一列，且为单选', () => {
  assert.deepEqual(DEFAULT_SELECTION, single(0, 0))
  assert.equal(isMatrix(DEFAULT_SELECTION), false)
})

test('isMatrix / isInSelection', () => {
  assert.equal(isMatrix(mat(2, 3)), true)
  assert.equal(isMatrix(single(2, 3)), false)
  assert.equal(isInSelection(mat(2, 3), 3, 4), true)
  assert.equal(isInSelection(mat(2, 3), 1, 1), false)
})

test('rectBetween：矩形(锚点,当前格)，路径不留痕', () => {
  assert.deepEqual(rectBetween({ row: 2, col: 2 }, { row: 4, col: 4 }), {
    rowStart: 2, rowEnd: 4, colStart: 2, colEnd: 4, focus: { row: 4, col: 4 },
  })
  // 反方向（右下→左上）：bounds 一致
  assert.deepEqual(rectBetween({ row: 4, col: 4 }, { row: 1, col: 2 }), {
    rowStart: 1, rowEnd: 4, colStart: 2, colEnd: 4, focus: { row: 1, col: 2 },
  })
  // bug 回归：从 (1,1) 经过 (1,3) 回到 (2,2)，最终选区 = 矩形((1,1),(2,2))，不含第 3 列
  assert.deepEqual(rectBetween({ row: 1, col: 1 }, { row: 1, col: 3 }), {
    rowStart: 1, rowEnd: 1, colStart: 1, colEnd: 3, focus: { row: 1, col: 3 },
  })
  assert.deepEqual(rectBetween({ row: 1, col: 1 }, { row: 2, col: 2 }), {
    rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2, focus: { row: 2, col: 2 },
  })
})

// ---- M3 单选语义回归 ----

test('单选：方向键四向移动', () => {
  assert.deepEqual(navigate(single(2, 1), 'ArrowDown', RC, CC), single(3, 1))
  assert.deepEqual(navigate(single(2, 1), 'ArrowUp', RC, CC), single(1, 1))
  assert.deepEqual(navigate(single(2, 1), 'ArrowLeft', RC, CC), single(2, 0))
  assert.deepEqual(navigate(single(2, 1), 'ArrowRight', RC, CC), single(2, 2))
})

test('单选：四条边界不生效（不回绕）', () => {
  assert.deepEqual(navigate(single(0, 0), 'ArrowLeft', RC, CC), single(0, 0))
  assert.deepEqual(navigate(single(0, 0), 'ArrowUp', RC, CC), single(0, 0))
  assert.deepEqual(navigate(single(RC - 1, CC - 1), 'ArrowDown', RC, CC), single(RC - 1, CC - 1))
  assert.deepEqual(navigate(single(RC - 1, CC - 1), 'ArrowRight', RC, CC), single(RC - 1, CC - 1))
})

test('单选：回车系与 Tab 系等效方向键，同样受边界约束', () => {
  assert.deepEqual(navigate(single(2, 1), 'Enter', RC, CC), single(3, 1))
  assert.deepEqual(navigate(single(2, 1), 'ShiftEnter', RC, CC), single(1, 1))
  assert.deepEqual(navigate(single(2, 1), 'Tab', RC, CC), single(2, 2))
  assert.deepEqual(navigate(single(2, 1), 'ShiftTab', RC, CC), single(2, 0))
  const br = single(RC - 1, CC - 1)
  assert.deepEqual(navigate(br, 'Enter', RC, CC), br)
})

test('单选：空工作区不动，入参不被修改', () => {
  const f = single(0, 0)
  assert.deepEqual(navigate(f, 'ArrowDown', 0, CC), f)
  assert.deepEqual(navigate(f, 'ArrowRight', RC, 0), f)
  navigate(f, 'ArrowDown', RC, CC)
  assert.deepEqual(f, single(0, 0))
})

// ---- M4 多选语义 ----

test('多选：方向键退出矩阵并从焦点单选步进（范围收拢）', () => {
  assert.deepEqual(navigate(mat(2, 3), 'ArrowDown', RC, CC), single(3, 3))
  assert.deepEqual(navigate(mat(2, 3), 'ArrowLeft', RC, CC), single(2, 2))
  // 焦点在矩阵上沿时退出后照常受工作区边界约束
  assert.deepEqual(navigate(mat(1, 3), 'ArrowUp', RC, CC), single(0, 3))
})

test('多选：Enter 环流（行进位，溢出回绕），范围不变', () => {
  assert.deepEqual(navigate(mat(1, 2), 'Enter', RC, CC).focus, { row: 2, col: 2 })
  // 右下角：行溢出回首行、列+1 溢出回首列 → 回到左上；矩阵必须保持不塌缩
  const r = navigate(mat(3, 4), 'Enter', RC, CC)
  assert.deepEqual(r.focus, { row: 1, col: 2 })
  assert.deepEqual({ rowStart: r.rowStart, rowEnd: r.rowEnd, colStart: r.colStart, colEnd: r.colEnd }, {
    rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 4,
  })
  assert.equal(isMatrix(r), true)
  // 单行矩阵：行进位原地，列溢出回首列
  const row: Selection = { rowStart: 2, rowEnd: 2, colStart: 0, colEnd: 2, focus: { row: 2, col: 2 } }
  assert.deepEqual(navigate(row, 'Enter', RC, CC).focus, { row: 2, col: 0 })
})

test('多选：ShiftEnter 环流（行退位，溢出回末行且列-1）', () => {
  assert.deepEqual(navigate(mat(2, 2), 'ShiftEnter', RC, CC).focus, { row: 1, col: 2 })
  // 左上角：行溢出回末行、列-1 溢出回末列 → 右下
  assert.deepEqual(navigate(mat(1, 2), 'ShiftEnter', RC, CC).focus, { row: 3, col: 4 })
})

test('多选：Tab 环流（列进位，溢出回绕），范围不变', () => {
  assert.deepEqual(navigate(mat(2, 3), 'Tab', RC, CC).focus, { row: 2, col: 4 })
  // 行末列：列溢出回首列、行+1
  assert.deepEqual(navigate(mat(2, 4), 'Tab', RC, CC).focus, { row: 3, col: 2 })
  // 右下角：列回绕回首列、行溢出回首行 → 左上，矩阵保持
  const r = navigate(mat(3, 4), 'Tab', RC, CC)
  assert.deepEqual(r.focus, { row: 1, col: 2 })
  assert.equal(isMatrix(r), true)
  // 单列矩阵：列进位原地，行溢出回首行
  const col: Selection = { rowStart: 0, rowEnd: 2, colStart: 3, colEnd: 3, focus: { row: 2, col: 3 } }
  assert.deepEqual(navigate(col, 'Tab', RC, CC).focus, { row: 0, col: 3 })
})

test('多选：ShiftTab 环流（列退位，溢出回末列且行-1）', () => {
  assert.deepEqual(navigate(mat(1, 3), 'ShiftTab', RC, CC).focus, { row: 1, col: 2 })
  // 左上角：列溢出回末列、行-1 溢出回末行 → 右下
  assert.deepEqual(navigate(mat(1, 2), 'ShiftTab', RC, CC).focus, { row: 3, col: 4 })
})

// ---- M4 增补：shift+方向键调整矩阵（统一规则：焦点在箭头方向最远端且该方向 ≥2 → 收缩对侧；否则扩展；焦点原地不动）----

test('shift+右：三分支', () => {
  // 一列 → 右扩
  const oneCol: Selection = { rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 2, focus: { row: 2, col: 2 } }
  assert.deepEqual(navigate(oneCol, 'ShiftRight', RC, CC), { ...oneCol, colEnd: 3 })
  // 2+ 列、焦点不在末列 → 右扩（不贴工作区右缘，否则会被钳制）
  const m: Selection = { rowStart: 1, rowEnd: 3, colStart: 1, colEnd: 3, focus: { row: 2, col: 2 } }
  assert.deepEqual(navigate(m, 'ShiftRight', RC, CC), { ...m, colEnd: 4 })
  // 2+ 列、焦点在末列 → 缩最左列
  const shrunk = navigate(mat(3, 4), 'ShiftRight', RC, CC)
  assert.deepEqual(shrunk, { rowStart: 1, rowEnd: 3, colStart: 3, colEnd: 4, focus: { row: 3, col: 4 } })
})

test('shift+左：三分支', () => {
  const oneCol: Selection = { rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 2, focus: { row: 2, col: 2 } }
  assert.deepEqual(navigate(oneCol, 'ShiftLeft', RC, CC), { ...oneCol, colStart: 1 })
  // 焦点不在首列 → 左扩
  const m: Selection = { rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 4, focus: { row: 2, col: 3 } }
  assert.deepEqual(navigate(m, 'ShiftLeft', RC, CC), { ...m, colStart: 1 })
  // 焦点在首列 → 缩最右列
  assert.deepEqual(navigate(mat(2, 2), 'ShiftLeft', RC, CC), { rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 3, focus: { row: 2, col: 2 } })
})

test('shift+下：三分支', () => {
  const oneRow: Selection = { rowStart: 1, rowEnd: 1, colStart: 2, colEnd: 4, focus: { row: 1, col: 3 } }
  assert.deepEqual(navigate(oneRow, 'ShiftDown', RC, CC), { ...oneRow, rowEnd: 2 })
  assert.deepEqual(navigate(mat(2, 3), 'ShiftDown', RC, CC), { ...mat(2, 3), rowEnd: 4 })
  // 焦点在末行 → 缩最上行
  assert.deepEqual(navigate(mat(3, 3), 'ShiftDown', RC, CC), { rowStart: 2, rowEnd: 3, colStart: 2, colEnd: 4, focus: { row: 3, col: 3 } })
})

test('shift+上：三分支', () => {
  const oneRow: Selection = { rowStart: 1, rowEnd: 1, colStart: 2, colEnd: 4, focus: { row: 1, col: 3 } }
  assert.deepEqual(navigate(oneRow, 'ShiftUp', RC, CC), { ...oneRow, rowStart: 0 })
  assert.deepEqual(navigate(mat(2, 3), 'ShiftUp', RC, CC), { ...mat(2, 3), rowStart: 0 })
  // 焦点在首行 → 缩最下行
  assert.deepEqual(navigate(mat(1, 3), 'ShiftUp', RC, CC), { rowStart: 1, rowEnd: 2, colStart: 2, colEnd: 4, focus: { row: 1, col: 3 } })
})

test('shift+方向键：1x1 起步连续扩展', () => {
  let s = single(2, 2)
  s = navigate(s, 'ShiftRight', RC, CC)
  s = navigate(s, 'ShiftRight', RC, CC)
  s = navigate(s, 'ShiftDown', RC, CC)
  assert.deepEqual(s, { rowStart: 2, rowEnd: 3, colStart: 2, colEnd: 4, focus: { row: 2, col: 2 } })
})

test('shift+方向键：扩展受工作区边界钳制（no-op）', () => {
  // 矩阵已达最右列、焦点不在末列 → 扩展意图但越界 → 原样
  const atRight: Selection = { rowStart: 0, rowEnd: 2, colStart: 3, colEnd: 4, focus: { row: 1, col: 3 } }
  assert.deepEqual(navigate(atRight, 'ShiftRight', RC, CC), atRight)
  const atLeft: Selection = { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 2, focus: { row: 1, col: 2 } }
  assert.deepEqual(navigate(atLeft, 'ShiftLeft', RC, CC), atLeft)
  const atBottom: Selection = { rowStart: RC - 3, rowEnd: RC - 1, colStart: 0, colEnd: 2, focus: { row: RC - 2, col: 1 } }
  assert.deepEqual(navigate(atBottom, 'ShiftDown', RC, CC), atBottom)
  const atTop: Selection = { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 2, focus: { row: 1, col: 1 } }
  assert.deepEqual(navigate(atTop, 'ShiftUp', RC, CC), atTop)
})

test('shift+方向键：焦点全程原地不动，入参不被修改', () => {
  const s = mat(2, 3)
  for (const key of ['ShiftUp', 'ShiftDown', 'ShiftLeft', 'ShiftRight'] as const) {
    assert.deepEqual(navigate(s, key, RC, CC).focus, s.focus)
  }
  const before = JSON.stringify(s)
  navigate(s, 'ShiftRight', RC, CC)
  navigate(s, 'ShiftDown', RC, CC)
  assert.equal(JSON.stringify(s), before)
})

test('多选：入参不被修改', () => {
  const s = mat(2, 3)
  const before = JSON.stringify(s)
  navigate(s, 'Enter', RC, CC)
  navigate(s, 'ArrowDown', RC, CC)
  rectBetween({ row: 0, col: 0 }, { row: 0, col: 0 })
  assert.equal(JSON.stringify(s), before)
})

test('focusToMatrixOrigin：焦点归位首行首列，范围不变', () => {
  const m = mat(3, 4)
  const r = focusToMatrixOrigin(m)
  assert.deepEqual(r.focus, { row: 1, col: 2 })
  assert.deepEqual({ rowStart: r.rowStart, rowEnd: r.rowEnd, colStart: r.colStart, colEnd: r.colEnd }, {
    rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 4,
  })
  assert.deepEqual(focusToMatrixOrigin(single(2, 3)).focus, { row: 2, col: 3 })
})

test('navKeyOf 映射与 shift 变体', () => {
  assert.equal(navKeyOf('ArrowDown', false), 'ArrowDown')
  assert.equal(navKeyOf('ArrowUp', true), 'ShiftUp')
  assert.equal(navKeyOf('ArrowLeft', true), 'ShiftLeft')
  assert.equal(navKeyOf('ArrowRight', true), 'ShiftRight')
  assert.equal(navKeyOf('Enter', false), 'Enter')
  assert.equal(navKeyOf('Enter', true), 'ShiftEnter')
  assert.equal(navKeyOf('Tab', false), 'Tab')
  assert.equal(navKeyOf('Tab', true), 'ShiftTab')
  assert.equal(navKeyOf('a', false), null)
  assert.equal(navKeyOf('Escape', true), null)
})

test('Focus 类型仅内部使用（编译期哨兵）', () => {
  const f: Focus = { row: 0, col: 0 }
  assert.deepEqual(f, { row: 0, col: 0 })
})
