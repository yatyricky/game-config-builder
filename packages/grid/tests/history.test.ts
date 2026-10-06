import { expect, it } from 'vitest';
import { HistoryStack, parseTsv, mapPasteToRect, fillSequence } from '../src/index.js';

it('T7.4：undo/redo 栈语义 + 上限 + canUndo/canRedo', () => {
  const log: string[] = [];
  const stack = new HistoryStack(3);
  expect(stack.canUndo()).toBe(false);
  stack.push({ apply: () => log.push('a'), undo: () => log.push('-a') });
  stack.push({ apply: () => log.push('b'), undo: () => log.push('-b') });
  stack.push({ apply: () => log.push('c'), undo: () => log.push('-c') });
  stack.push({ apply: () => log.push('d'), undo: () => log.push('-d') }); // 挤出 a
  expect(log).toEqual(['a', 'b', 'c', 'd']);
  expect(stack.canUndo()).toBe(true);
  stack.undo();
  stack.undo();
  expect(log).toEqual(['a', 'b', 'c', 'd', '-d', '-c']);
  expect(stack.canRedo()).toBe(true);
  stack.redo();
  expect(log).toEqual(['a', 'b', 'c', 'd', '-d', '-c', 'c']);
  expect(stack.undo()).toBe(true); // -c
  expect(stack.undo()).toBe(true); // -b
  expect(stack.undo()).toBe(false); // a 已被上限挤出，栈空
});

it('T7.4：同 coalesceKey 合并（同格连续输入 = 一条）', () => {
  const stack = new HistoryStack();
  let value = '';
  stack.push({ coalesceKey: 'cell:1:1', apply: () => (value = 'h'), undo: () => (value = '') });
  expect(value).toBe('h');
  stack.push({ coalesceKey: 'cell:1:1', apply: () => (value = 'he'), undo: () => (value = 'h') });
  expect(value).toBe('he');
  expect(stack.canUndo()).toBe(true);
  stack.undo();
  expect(value).toBe(''); // 回到合并前的原值
  stack.push({ coalesceKey: 'cell:1:2', apply: () => (value = 'x'), undo: () => (value = '') });
  expect(value).toBe('x');
});

it('T7.5：TSV 解析（尾换行/\r 归一）', () => {
  expect(parseTsv('a\tb\nc\td\n')).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  expect(parseTsv('a\r\nb')).toEqual([['a'], ['b']]);
  expect(parseTsv('single')).toEqual([['single']]);
  expect(parseTsv('')).toEqual([]);
});

it('T7.5：粘贴映射——越界裁剪', () => {
  const matrix = [
    ['1', '2', '3'],
    ['4', '5', '6'],
  ];
  const mapped = mapPasteToRect(matrix, 8, 4, 10, 6); // 3 列表从 (8,4) 粘贴
  expect(mapped).toEqual([
    { row: 8, col: 4, raw: '1' },
    { row: 8, col: 5, raw: '2' },
    { row: 9, col: 4, raw: '4' },
    { row: 9, col: 5, raw: '5' },
  ]);
});

it('T7.5：拖拽填充——复制与数字序列', () => {
  expect(fillSequence([['x']], 3)).toEqual([['x'], ['x'], ['x']]);
  expect(fillSequence([['10']], 3)).toEqual([['10'], ['11'], ['12']]);
  // Excel 语义：单行源下拉时数字列成序列，非数字列复制
  expect(fillSequence([['1', 'a']], 2)).toEqual([
    ['1', 'a'],
    ['2', 'a'],
  ]);
});
