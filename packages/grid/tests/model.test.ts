import { expect, it } from 'vitest';
import { GridModel } from '../src/index.js';
import type { GridEvents } from '../src/index.js';

function makeModel(rowCount = 100, colCount = 5, events?: Partial<GridEvents>) {
  const log = {
    viewport: 0,
    selection: 0,
    commits: [] as Array<{ row: number; col: number; raw: string }>,
  };
  const model = new GridModel(
    {
      rowCount,
      columns: Array.from({ length: colCount }, (_, i) => ({ name: `c${i}`, width: 100 })),
      rowHeight: 28,
      overscan: 0,
    },
    {
      onViewportChange: () => {
        log.viewport++;
      },
      onSelectionChange: () => {
        log.selection++;
      },
      onEditCommit: (coord, raw) => {
        log.commits.push({ row: coord.row, col: coord.col, raw });
      },
      onHistoryChange: () => {},
      ...events,
    },
  );
  model.setViewport({ viewportHeight: 280, viewportWidth: 500 });
  return { model, log };
}

it('T6.5：setCursor 单选；shift 扩展 anchor 不动；负向拖拽矩形规范化', () => {
  const { model } = makeModel();
  model.setCursor(3, 2);
  expect(model.getSelection()).toEqual({
    cursor: { row: 3, col: 2 },
    anchor: { row: 3, col: 2 },
    focus: { row: 3, col: 2 },
  });
  model.setCursor(1, 0, true);
  expect(model.selectionRect()).toEqual({ startRow: 1, endRow: 3, startCol: 0, endCol: 2 });
  // 负向：focus 越过 anchor
  model.setCursor(5, 4, true);
  expect(model.selectionRect()).toEqual({ startRow: 3, endRow: 5, startCol: 2, endCol: 4 });
});

it('T6.5：越界钳制', () => {
  const { model } = makeModel(10, 3);
  model.setCursor(-5, -5);
  expect(model.getSelection().cursor).toEqual({ row: 0, col: 0 });
  model.setCursor(99, 99);
  expect(model.getSelection().cursor).toEqual({ row: 9, col: 2 });
});

it('T6.6：方向键/Home/End/PageDown 意图 + 事件通知', () => {
  const { model, log } = makeModel();
  model.handleKeyDown('ArrowDown', { shift: false, ctrl: false });
  expect(model.getSelection().cursor).toEqual({ row: 1, col: 0 });
  model.handleKeyDown('ArrowRight', { shift: true, ctrl: false });
  expect(model.getSelection().cursor).toEqual({ row: 1, col: 0 }); // cursor 不动
  expect(model.selectionRect().endCol).toBe(1);
  model.handleKeyDown('End', { shift: false, ctrl: false });
  expect(model.getSelection().cursor.col).toBe(4);
  model.handleKeyDown('Home', { shift: false, ctrl: false });
  expect(model.getSelection().cursor.col).toBe(0);
  model.handleKeyDown('PageDown', { shift: false, ctrl: false });
  // viewportHeight 280 / rowHeight 28 = 10 行 / 2 = 5；Home 未改 row（仍为 1）→ 1+5=6
  expect(model.getSelection().cursor.row).toBe(6);
  expect(log.selection).toBeGreaterThan(0);
});

it('T6.6：滚动跟随——cursor 移出视口时 scrollTop 调整', () => {
  const { model } = makeModel();
  model.setViewport({ viewportHeight: 280 }); // 10 行
  model.scrollToRow(50);
  const before = model.getScrollTop();
  model.setCursor(40, 0); // 行 40 在视口上方（scrollTop 1148 → 首行 41）→ 上滚
  expect(model.getScrollTop()).toBeLessThan(before);
});

it('T6.1：viewport 事件只在窗口变化时发出', () => {
  const { model, log } = makeModel();
  const baseline = log.viewport;
  model.setViewport({ viewportHeight: 280 });
  expect(log.viewport).toBe(baseline); // 窗口未变 → 无事件
  model.setViewport({ scrollTop: 2800 });
  expect(log.viewport).toBe(baseline + 1);
});

it('T7 前置：beginEdit/commitEdit/cancelEdit 与事件', () => {
  const { model, log } = makeModel();
  model.setCursor(2, 1);
  model.handleKeyDown('F2', { shift: false, ctrl: false });
  expect(model.getEdit()).toEqual({ coord: { row: 2, col: 1 }, initial: '', selectAll: true });
  model.commitEdit('42', 'down');
  expect(log.commits).toEqual([{ row: 2, col: 1, raw: '42' }]);
  expect(model.getEdit()).toBeNull();
  expect(model.getSelection().cursor).toEqual({ row: 3, col: 1 });
  // 直接键入 = 带初始值开始编辑
  model.handleKeyDown('character', { shift: false, ctrl: false }, 'x');
  expect(model.getEdit()).toEqual({ coord: { row: 3, col: 1 }, initial: 'x', selectAll: false });
  model.cancelEdit();
  expect(model.getEdit()).toBeNull();
});
