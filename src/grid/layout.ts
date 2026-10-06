import type { FieldDef } from '../data/types.ts'

/** 行高必须与 grid.css 的 .grid-row / .grid-header height 保持一致 */
export const ROW_HEIGHT = 24
export const ROW_HEADER_WIDTH = 48
export const COL_WIDTH = 120

export interface ColumnBox {
  field: FieldDef
  /** 相对工作区左缘的 px 偏移 */
  left: number
  width: number
}

export function layoutColumns(fields: readonly FieldDef[]): ColumnBox[] {
  return fields.map((field, i) => ({ field, left: i * COL_WIDTH, width: COL_WIDTH }))
}

/** 视口总宽 = 行头宽 + 字段列宽之和 */
export function totalWidth(fieldCount: number): number {
  return ROW_HEADER_WIDTH + fieldCount * COL_WIDTH
}

export function canvasHeight(rowCount: number): number {
  return rowCount * ROW_HEIGHT
}

/** 视口内应渲染的行号区间 [start, end)，含 overscan，两端越界裁剪；scrollTop 超界时返回空窗口 */
export function visibleRows(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  overscan = 5,
): { start: number; end: number } {
  const first = Math.floor(scrollTop / ROW_HEIGHT)
  const start = Math.min(Math.max(0, first - overscan), rowCount)
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + overscan)
  return { start, end }
}
