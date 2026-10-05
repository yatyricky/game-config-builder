import type { SchemaIr, TableDef } from '@gcb/schema';
import { loadSchema } from '@gcb/schema';
import { expect, it } from 'vitest';
import { checkKeys, typeRows, type RawRow } from '../src/index.js';

const SCHEMA_YAML = `structs:
  S:
    fields:
      - { name: x, type: int }
tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: code, type: string, unique: true }
      - { name: st, type: "struct<S>" }
  TS:
    primaryKey: key
    displayField: key
    fields:
      - { name: key, type: string }
`;

const ir: SchemaIr = loadSchema({ 's.yaml': SCHEMA_YAML }).ir;

function tableOf(name: string): TableDef {
  const t = ir.tables[name];
  if (t === undefined) throw new Error(`夹具缺表 ${name}`);
  return t;
}

const table = tableOf('T');

function rowsOf(items: Array<Record<string, unknown>>): ReturnType<typeof typeRows>['rows'] {
  const raw: RawRow[] = items.map((json, i) => ({ json, line: i + 1 }));
  return typeRows(table, ir, raw).rows;
}

it('pk.duplicate：重复主键全部报告', () => {
  const rows = rowsOf([
    { id: 1, code: 'a' },
    { id: 1, code: 'b' },
    { id: 1, code: 'c' },
  ]);
  const errors = checkKeys(table, rows);
  const dups = errors.filter((e) => e.ruleId === 'pk.duplicate');
  expect(dups).toHaveLength(2);
  expect(dups[0]?.message).toContain('第 2 行');
});

it('unique.duplicate：unique 字段跨行唯一', () => {
  const rows = rowsOf([
    { id: 1, code: 'x' },
    { id: 2, code: 'x' },
  ]);
  const errors = checkKeys(table, rows);
  expect(errors.filter((e) => e.ruleId === 'unique.duplicate')).toHaveLength(1);
});

it('pk.order：乱序告警一次（warning）', () => {
  const rows = rowsOf([
    { id: 3, code: 'a' },
    { id: 1, code: 'b' },
    { id: 2, code: 'c' },
  ]);
  const errors = checkKeys(table, rows);
  const order = errors.filter((e) => e.ruleId === 'pk.order');
  expect(order).toHaveLength(1);
  expect(order[0]?.severity).toBe('warning');
});

it('升序：无 pk.order（正）', () => {
  const rows = rowsOf([
    { id: 1, code: 'a' },
    { id: 2, code: 'b' },
  ]);
  expect(checkKeys(table, rows)).toEqual([]);
});

it('string 主键按码点序比较', () => {
  const ts = ir.tables['TS'];
  if (ts === undefined) throw new Error('夹具缺表 TS');
  const raw: RawRow[] = [
    { json: { key: 'b' }, line: 1 },
    { json: { key: 'a' }, line: 2 },
  ];
  const rows = typeRows(ts, ir, raw).rows;
  const errors = checkKeys(ts, rows);
  expect(errors.filter((e) => e.ruleId === 'pk.order')).toHaveLength(1);
});
