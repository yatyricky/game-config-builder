import { expect, it } from 'vitest';
import {
  createLayout,
  visibleRange,
  visibleColumns,
  scrollTopForRow,
  totalHeight,
} from '../src/index.js';

const layout = createLayout(
  [
    { name: 'id', width: 80, frozen: true },
    { name: 'a', width: 100 },
    { name: 'b', width: 100 },
    { name: 'c', width: 100 },
  ],
  28,
  1000,
);

it('T6.2：固定行高总高与行 y', () => {
  expect(totalHeight(layout)).toBe(28000);
});

it('T6.2：可视窗口 + overscan 边界钳制（顶部/底部/越界）', () => {
  expect(visibleRange(layout, 0, 280)).toEqual({ start: 0, end: 16 }); // 10 可见 + 1 余行 + 5 overscan
  // 底部：scrollTop 使最后一行可见
  const bottom = visibleRange(layout, 28000 - 280, 280);
  expect(bottom.end).toBe(1000); // 钳制到 rowCount
  // 滚出界外
  const beyond = visibleRange(layout, -100, 280);
  expect(beyond.start).toBe(0);
});

it('T6.2：overscan=0 时窗口即精确可视', () => {
  const tight = createLayout([{ name: 'a', width: 100 }], 10, 100, 0);
  expect(visibleRange(tight, 50, 100)).toEqual({ start: 5, end: 16 });
});

it('T6.4：冻结列恒在窗口，滚动列按 scrollLeft 裁剪', () => {
  const v = visibleColumns(layout, 150, 150);
  expect(v.frozen).toEqual([0]);
  // 列 1 (x=0..100) 不在 [150,300)；列 2 (100..200) 相交；列 3 (200..300) 相交
  expect(v.windowed).toEqual([2, 3]);
});

it('T6.6：滚动跟随——向下进入视口下方时贴底，向上贴顶，中间不动', () => {
  const viewportH = 280;
  expect(scrollTopForRow(layout, 5, viewportH, 0)).toBe(0); // 可见，不动
  expect(scrollTopForRow(layout, 30, viewportH, 0)).toBe(30 * 28 - viewportH + 28); // 底部对齐
  expect(scrollTopForRow(layout, 2, viewportH, 5 * 28)).toBe(2 * 28); // 顶部对齐
});
