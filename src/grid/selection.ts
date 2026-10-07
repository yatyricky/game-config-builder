export interface Focus {
  row: number
  col: number
}

/**
 * 选中区：显式矩阵范围（工作区坐标，闭区间）+ 焦点。
 * 范围在拖拽中随 focus 延伸（见 extendTo），拖拽结束后固定不变——
 * 因此环流回绕到任何格子（含左上角）都不会使矩阵塌缩。
 */
export interface Selection {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
  focus: Focus
}

/** spec：默认选中表格工作区第一行第一列的格子 */
export const DEFAULT_SELECTION: Selection = singleAt({ row: 0, col: 0 })

export function singleAt(f: Focus): Selection {
  return { rowStart: f.row, rowEnd: f.row, colStart: f.col, colEnd: f.col, focus: f }
}

/** 拖拽延伸：范围并入 (f)，焦点移到 f（可向任意方向扩展） */
export function extendTo(s: Selection, f: Focus): Selection {
  return {
    rowStart: Math.min(s.rowStart, f.row),
    rowEnd: Math.max(s.rowEnd, f.row),
    colStart: Math.min(s.colStart, f.col),
    colEnd: Math.max(s.colEnd, f.col),
    focus: f,
  }
}

export function isInSelection(s: Selection, row: number, col: number): boolean {
  return row >= s.rowStart && row <= s.rowEnd && col >= s.colStart && col <= s.colEnd
}

export function isMatrix(s: Selection): boolean {
  return s.rowStart !== s.rowEnd || s.colStart !== s.colEnd
}

export type NavKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Enter'
  | 'ShiftEnter'
  | 'Tab'
  | 'ShiftTab'

/** 单选导航态的按键语义：回车系与 Tab 系等效于对应方向键 */
const DELTA: Record<NavKey, readonly [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  Enter: [1, 0],
  ShiftEnter: [-1, 0],
  Tab: [0, 1],
  ShiftTab: [0, -1],
}

/**
 * 导航总入口（纯函数）。
 * 单选：四方向 + 回车/Tab 系等效方向键，四条边界不生效、不回绕（回绕是矩阵环流专属）。
 * 多选：方向键立即退出多选——焦点视同所选单元格，原地执行单选步进（范围收拢为焦点）；
 * 回车/Tab 系在矩阵内环流，范围不变，回绕按 spec 顺序：Enter 行+1 溢出回首行并列+1、
 * 列溢出回首列；ShiftEnter 对称；Tab 列+1 溢出回首列并行+1、行溢出回首行；ShiftTab 对称。
 */
export function navigate(s: Selection, key: NavKey, rowCount: number, colCount: number): Selection {
  if (!isMatrix(s)) {
    return stepSingle(s, key, rowCount, colCount)
  }
  if (key === 'Enter' || key === 'ShiftEnter' || key === 'Tab' || key === 'ShiftTab') {
    return { ...s, focus: cycleFocus(s, key) }
  }
  // 方向键：退出矩阵，范围收拢为焦点，再单选步进
  return stepSingle(singleAt(s.focus), key, rowCount, colCount)
}

function stepSingle(s: Selection, key: NavKey, rowCount: number, colCount: number): Selection {
  if (rowCount === 0 || colCount === 0) return s
  const [dr, dc] = DELTA[key]
  const row = s.focus.row + dr
  const col = s.focus.col + dc
  if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return s
  return singleAt({ row, col })
}

function cycleFocus(s: Selection, key: 'Enter' | 'ShiftEnter' | 'Tab' | 'ShiftTab'): Focus {
  let { row, col } = s.focus
  if (key === 'Enter' || key === 'ShiftEnter') {
    row += key === 'Enter' ? 1 : -1
    if (row > s.rowEnd) {
      row = s.rowStart
      col += 1
    } else if (row < s.rowStart) {
      row = s.rowEnd
      col -= 1
    }
    if (col > s.colEnd) col = s.colStart
    else if (col < s.colStart) col = s.colEnd
  } else {
    col += key === 'Tab' ? 1 : -1
    if (col > s.colEnd) {
      col = s.colStart
      row += 1
    } else if (col < s.colStart) {
      col = s.colEnd
      row -= 1
    }
    if (row > s.rowEnd) row = s.rowStart
    else if (row < s.rowStart) row = s.rowEnd
  }
  return { row, col }
}

/** 矩阵形成后焦点归位首行首列（spec：焦点默认为矩阵第一行第一列的单元格）；范围不变 */
export function focusToMatrixOrigin(s: Selection): Selection {
  return { ...s, focus: { row: s.rowStart, col: s.colStart } }
}

/** 键盘事件 → NavKey；非导航键返回 null */
export function navKeyOf(key: string, shiftKey: boolean): NavKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'ArrowUp'
    case 'ArrowDown':
      return 'ArrowDown'
    case 'ArrowLeft':
      return 'ArrowLeft'
    case 'ArrowRight':
      return 'ArrowRight'
    case 'Enter':
      return shiftKey ? 'ShiftEnter' : 'Enter'
    case 'Tab':
      return shiftKey ? 'ShiftTab' : 'Tab'
    default:
      return null
  }
}
