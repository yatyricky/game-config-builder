// 布局引擎（T6.2）：固定行高 + 冻结列 + 可视窗口计算。全部纯函数（护栏：v1 固定行高）。

import type { ColumnSpec, RowRange } from './types.js';

export interface Layout {
  columns: ColumnSpec[];
  rowHeight: number;
  overscan: number;
  rowCount: number;
}

export function createLayout(
  columns: ColumnSpec[],
  rowHeight: number,
  rowCount: number,
  overscan = 5,
): Layout {
  return { columns, rowHeight, overscan, rowCount };
}

export function totalHeight(layout: Layout): number {
  return layout.rowCount * layout.rowHeight;
}

/** 非冻结列的 x 偏移与前缀宽（水平虚拟化基础，T6.4） */
export function columnX(layout: Layout, col: number): number {
  let x = 0;
  for (let i = 0; i < col && i < layout.columns.length; i++) {
    x += layout.columns[i]?.width ?? 0;
  }
  return x;
}

export function totalWidth(layout: Layout): number {
  return layout.columns.reduce((sum, c) => sum + c.width, 0);
}

/** 可视行窗口 + overscan，边界钳制（T6.2 验收：顶部/底部/overscan 越界） */
export function visibleRange(layout: Layout, scrollTop: number, viewportHeight: number): RowRange {
  const first = Math.floor(Math.max(0, scrollTop) / layout.rowHeight);
  const count = Math.ceil(viewportHeight / layout.rowHeight) + 1;
  const start = Math.max(0, first - layout.overscan);
  const end = Math.min(layout.rowCount, first + count + layout.overscan);
  return { start, end };
}

/** 可视列窗口（不含冻结列；冻结列始终渲染在最左） */
export function visibleColumns(
  layout: Layout,
  scrollLeft: number,
  viewportWidth: number,
): { frozen: number[]; windowed: number[] } {
  const frozen: number[] = [];
  const windowed: number[] = [];
  let x = 0;
  for (let i = 0; i < layout.columns.length; i++) {
    const col = layout.columns[i];
    if (col === undefined) continue;
    const isFrozen = col.frozen === true;
    const colStart = isFrozen ? 0 : x;
    const colEnd = isFrozen ? col.width : x + col.width;
    const viewStart = isFrozen ? 0 : scrollLeft;
    const viewEnd = isFrozen ? Number.MAX_SAFE_INTEGER : scrollLeft + viewportWidth;
    if (colEnd > viewStart && colStart < viewEnd) {
      (isFrozen ? frozen : windowed).push(i);
    }
    if (!isFrozen) x += col.width;
  }
  return { frozen, windowed };
}

export function rowY(layout: Layout, row: number): number {
  return row * layout.rowHeight;
}

/** 给定 scrollTop 保证某行可见所需的滚动位置（键盘导航跟随，T6.6） */
export function scrollTopForRow(
  layout: Layout,
  row: number,
  viewportHeight: number,
  current: number,
): number {
  const top = rowY(layout, row);
  const bottom = top + layout.rowHeight;
  if (top < current) return top;
  if (bottom > current + viewportHeight) return bottom - viewportHeight;
  return current;
}
