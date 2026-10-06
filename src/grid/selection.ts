export interface Focus {
  row: number
  col: number
}

/** spec：默认选中表格工作区第一行第一列的格子 */
export const DEFAULT_FOCUS: Focus = { row: 0, col: 0 }

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
 * 单选导航：返回移动后的焦点。
 * 四条边界不生效（首列左、首行上、末行下、末列右）；不回绕——回绕是 M4 矩阵行为；
 * 空工作区不动；入参不被修改。
 */
export function moveFocus(focus: Focus, key: NavKey, rowCount: number, colCount: number): Focus {
  if (rowCount === 0 || colCount === 0) return focus
  const [dr, dc] = DELTA[key]
  const row = focus.row + dr
  const col = focus.col + dc
  if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return focus
  return { row, col }
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
