export const PACKAGE_NAME = '@gcb/grid';

export type {
  CellCoord,
  RowRange,
  SelectionState,
  ColumnSpec,
  GridEvents,
  GridOptions,
  KeyModifiers,
  KeyName,
  ViewportState,
  EditState,
} from './types.js';
export { GridModel } from './model.js';
export {
  createLayout,
  totalHeight,
  totalWidth,
  columnX,
  visibleRange,
  visibleColumns,
  rowY,
  scrollTopForRow,
} from './layout.js';
export { HistoryStack, parseTsv, mapPasteToRect, fillSequence } from './history.js';
export type { HistoryCommand } from './history.js';
