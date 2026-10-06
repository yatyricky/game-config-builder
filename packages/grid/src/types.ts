// 网格纯逻辑内核（docs/02 §4，T6.1）。框架无关、无 DOM import——Svelte 层只订阅事件翻译状态。
// 所有可出错的逻辑都在这里被 vitest 覆盖。

export interface CellCoord {
  row: number;
  col: number;
}

export interface RowRange {
  start: number;
  end: number; // exclusive
}

export interface SelectionState {
  /** 焦点格（光标） */
  cursor: CellCoord;
  /** 选区矩形（anchor↔focus）；单选时 anchor == focus */
  anchor: CellCoord;
  focus: CellCoord;
}

export interface ColumnSpec {
  name: string;
  width: number;
  frozen?: boolean;
}

export interface GridEvents {
  onViewportChange(range: RowRange): void;
  onSelectionChange(sel: SelectionState): void;
  onEditCommit(coord: CellCoord, raw: string): void;
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
}

export interface GridOptions {
  rowCount: number;
  columns: ColumnSpec[];
  rowHeight: number;
  /** 垂直 overscan 行数（渲染缓冲，§thesis 4.3 护栏） */
  overscan?: number;
}

export type KeyName =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'Enter'
  | 'F2'
  | 'Escape'
  | 'Tab'
  | 'character';

export interface KeyModifiers {
  shift: boolean;
  ctrl: boolean;
}

export interface ViewportState {
  scrollTop: number;
  viewportHeight: number;
  viewportWidth: number;
  scrollLeft: number;
}

export interface EditState {
  coord: CellCoord;
  initial: string;
  selectAll: boolean;
}
