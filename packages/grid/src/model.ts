// GridModel（T6.1/T6.5/T6.6）：选择模型 + 键盘导航 + 视口状态。可变状态但无副作用外溢，
// 全部通过 GridEvents 通知渲染层。编辑状态机在 edit.ts（T7.1），此处仅聚合。

import { createLayout, scrollTopForRow, visibleRange, type Layout } from './layout.js';
import type {
  CellCoord,
  ColumnSpec,
  EditState,
  GridEvents,
  GridOptions,
  KeyModifiers,
  KeyName,
  RowRange,
  SelectionState,
  ViewportState,
} from './types.js';

export interface GridModelSnapshot {
  selection: SelectionState;
  viewport: RowRange;
  scrollTop: number;
  scrollLeft: number;
}

export class GridModel {
  private layout: Layout;
  private readonly events: GridEvents;
  private selection: SelectionState;
  private viewport: RowRange;
  private view: ViewportState = {
    scrollTop: 0,
    viewportHeight: 600,
    viewportWidth: 800,
    scrollLeft: 0,
  };
  private edit: EditState | null = null;

  constructor(options: GridOptions, events: GridEvents) {
    this.layout = createLayout(
      options.columns,
      options.rowHeight,
      options.rowCount,
      options.overscan,
    );
    this.events = events;
    const origin: CellCoord = { row: 0, col: 0 };
    this.selection = { cursor: origin, anchor: origin, focus: origin };
    this.viewport = visibleRange(this.layout, 0, this.view.viewportHeight);
  }

  // ---------- 视口（渲染层滚动时调用） ----------

  setViewport(view: Partial<ViewportState>): void {
    this.view = { ...this.view, ...view };
    this.recomputeViewport();
  }

  scrollToRow(row: number): void {
    const clamped = clampRow(row, this.layout.rowCount);
    this.view.scrollTop = scrollTopForRow(
      this.layout,
      clamped,
      this.view.viewportHeight,
      this.view.scrollTop,
    );
    this.recomputeViewport();
  }

  getScrollTop(): number {
    return this.view.scrollTop;
  }

  getViewportHeight(): number {
    return this.view.viewportHeight;
  }

  get rowCount(): number {
    return this.layout.rowCount;
  }

  get columns(): ColumnSpec[] {
    return this.layout.columns;
  }

  get rowHeight(): number {
    return this.layout.rowHeight;
  }

  snapshot(): GridModelSnapshot {
    return {
      selection: { ...this.selection, cursor: { ...this.selection.cursor } },
      viewport: { ...this.viewport },
      scrollTop: this.view.scrollTop,
      scrollLeft: this.view.scrollLeft,
    };
  }

  // ---------- 选择（T6.5：anchor↔focus 矩形，shift 扩展） ----------

  getSelection(): SelectionState {
    return this.selection;
  }

  setCursor(row: number, col: number, extend = false): void {
    const r = clampRow(row, this.layout.rowCount);
    const c = clampCol(col, this.layout.columns.length);
    if (extend) {
      this.selection = {
        cursor: this.selection.cursor,
        anchor: this.selection.anchor,
        focus: { row: r, col: c },
      };
    } else {
      this.selection = {
        cursor: { row: r, col: c },
        anchor: { row: r, col: c },
        focus: { row: r, col: c },
      };
    }
    this.ensureVisible(r);
    this.events.onSelectionChange(this.selection);
  }

  selectAll(): void {
    const end: CellCoord = { row: this.layout.rowCount - 1, col: this.layout.columns.length - 1 };
    this.selection = { cursor: this.selection.cursor, anchor: { row: 0, col: 0 }, focus: end };
    this.events.onSelectionChange(this.selection);
  }

  /** 规范化选区矩形（拖拽可为负向：上→下、右→左，T6.5 验收） */
  selectionRect(): { startRow: number; endRow: number; startCol: number; endCol: number } {
    const { anchor, focus } = this.selection;
    return {
      startRow: Math.min(anchor.row, focus.row),
      endRow: Math.max(anchor.row, focus.row),
      startCol: Math.min(anchor.col, focus.col),
      endCol: Math.max(anchor.col, focus.col),
    };
  }

  // ---------- 键盘（T6.6：意图分发，滚动跟随） ----------

  handleKeyDown(key: KeyName, modifiers: KeyModifiers, character?: string): void {
    const { cursor } = this.selection;
    switch (key) {
      case 'ArrowUp':
        this.setCursor(cursor.row - 1, cursor.col, modifiers.shift);
        break;
      case 'ArrowDown':
        this.setCursor(cursor.row + 1, cursor.col, modifiers.shift);
        break;
      case 'ArrowLeft':
        this.setCursor(cursor.row, cursor.col - 1, modifiers.shift);
        break;
      case 'ArrowRight':
        this.setCursor(cursor.row, cursor.col + 1, modifiers.shift);
        break;
      case 'Home':
        this.setCursor(cursor.row, 0, modifiers.shift);
        break;
      case 'End':
        this.setCursor(cursor.row, this.layout.columns.length - 1, modifiers.shift);
        break;
      case 'PageUp':
        this.setCursor(cursor.row - this.estimatePageSize(), cursor.col, modifiers.shift);
        break;
      case 'PageDown':
        this.setCursor(cursor.row + this.estimatePageSize(), cursor.col, modifiers.shift);
        break;
      case 'Enter':
        if (modifiers.shift) this.setCursor(cursor.row - 1, cursor.col, false);
        else this.setCursor(cursor.row + 1, cursor.col, false);
        break;
      case 'Tab':
        this.setCursor(cursor.row, cursor.col + (modifiers.shift ? -1 : 1), false);
        break;
      case 'F2':
        this.beginEdit(cursor);
        break;
      case 'Escape':
        this.cancelEdit();
        break;
      case 'character':
        if (character !== undefined && !modifiers.ctrl) {
          // 直接键入 = 覆盖式开始编辑（Excel 肌肉记忆）
          this.beginEdit(this.selection.cursor, character);
        }
        break;
    }
  }

  private estimatePageSize(): number {
    return Math.max(1, Math.floor(this.view.viewportHeight / this.layout.rowHeight / 2));
  }

  private ensureVisible(row: number): void {
    const next = scrollTopForRow(this.layout, row, this.view.viewportHeight, this.view.scrollTop);
    if (next !== this.view.scrollTop) {
      this.view.scrollTop = next;
      this.recomputeViewport();
    }
  }

  private recomputeViewport(): void {
    const next = visibleRange(this.layout, this.view.scrollTop, this.view.viewportHeight);
    if (next.start !== this.viewport.start || next.end !== this.viewport.end) {
      this.viewport = next;
      this.events.onViewportChange(next);
    }
  }

  // ---------- 编辑（T7.1 完整状态机在 EditController；此处做聚合入口） ----------

  beginEdit(coord: CellCoord, initial = ''): void {
    if (coord.row < 0 || coord.row >= this.layout.rowCount) return;
    if (coord.col < 0 || coord.col >= this.layout.columns.length) return;
    this.edit = { coord: { ...coord }, initial, selectAll: initial === '' };
  }

  getEdit(): EditState | null {
    return this.edit;
  }

  cancelEdit(): void {
    this.edit = null;
  }

  /** 提交编辑：交上层 parse/写数据；成功（不抛）后推进光标 */
  commitEdit(raw: string, move: 'down' | 'right' | 'none' = 'none'): void {
    if (this.edit === null) return;
    const coord = this.edit.coord;
    this.edit = null;
    this.events.onEditCommit(coord, raw);
    if (move === 'down') this.setCursor(coord.row + 1, coord.col);
    if (move === 'right') this.setCursor(coord.row, coord.col + 1);
  }

  /** 按坐标直接提交（粘贴/撤销重做的批量写原语；不经编辑状态机，不移动光标） */
  commitAt(coord: CellCoord, raw: string): void {
    if (coord.row < 0 || coord.row >= this.layout.rowCount) return;
    if (coord.col < 0 || coord.col >= this.layout.columns.length) return;
    this.events.onEditCommit(coord, raw);
  }
}

function clampRow(row: number, rowCount: number): number {
  return Math.max(0, Math.min(rowCount - 1, row));
}

function clampCol(col: number, colCount: number): number {
  return Math.max(0, Math.min(colCount - 1, col));
}
