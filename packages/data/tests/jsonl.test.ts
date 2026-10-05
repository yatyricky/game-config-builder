import { expect, it } from 'vitest';
import { parseJsonl } from '../src/index.js';

it('合法 JSONL 逐行解析，行号正确', () => {
  const result = parseJsonl('T', '{"id":1}\n{"id":2}\n{"id":3}\n');
  expect(result.errors).toEqual([]);
  expect(result.rows.map((r) => r.line)).toEqual([1, 2, 3]);
});

it('坏 JSON 行：data.jsonl.parse 含行号，不中断后续行（T2.1 验收）', () => {
  const result = parseJsonl('T', '{"id":1}\n{id broken}\n{"id":3}\n');
  expect(result.rows.map((r) => r.line)).toEqual([1, 3]);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.ruleId).toBe('data.jsonl.parse');
  expect(result.errors[0]?.message).toContain('第 2 行');
  expect(result.errors[0]?.table).toBe('T');
});

it('空文件 = 0 行合法（T2.1 验收）', () => {
  const result = parseJsonl('T', '');
  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([]);
});

it('无尾换行也容忍；空行跳过', () => {
  const result = parseJsonl('T', '{"id":1}\n\n{"id":2}');
  expect(result.rows.map((r) => r.line)).toEqual([1, 3]);
  expect(result.errors).toEqual([]);
});
