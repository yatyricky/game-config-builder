import type { SchemaIr, TableDef } from '@gcb/schema';
import { loadSchema } from '@gcb/schema';
import { expect, it } from 'vitest';
import { typeRows, type RawRow } from '@gcb/validate';
import { canonicalizeRow, normalizeTable, rowHash } from '../src/index.js';

const SCHEMA_YAML = `enums:
  E:
    values:
      - { name: A, value: 0 }
structs:
  S:
    fields:
      - { name: n, type: int }
      - { name: f, type: float }
tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: e, type: "enum<E>", default: A }
      - { name: f, type: float }
      - { name: st, type: "struct<S>" }
      - { name: m, type: "map<int, string>" }
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

function typed(items: Array<Record<string, unknown>>) {
  const raw: RawRow[] = items.map((json, i) => ({ json, line: i + 1 }));
  return typeRows(table, ir, raw);
}

it('canonicalizeRow：键序=字段序 / 默认值显式化 / float 规范形式 / int 键数值排序', () => {
  const typedResult = typed([{ f: 2.5, st: { n: 4, f: 3 }, m: { '10': 'b', '2': 'a' }, id: 1 }]);
  const row = typedResult.rows[0]?.row;
  if (row === undefined) throw new Error('行缺失');
  const line = canonicalizeRow(table, ir, row);
  expect(line).toBe('{"id":1,"e":"A","f":2.5,"st":{"n":4,"f":3.0},"m":{"2":"a","10":"b"}}');
});

it('normalize：乱序输入 → 主键升序 + 规范行 + 尾换行（字节级）', () => {
  const typedResult = typed([
    { id: 2, f: 1.0, st: { n: 1, f: 0.5 }, m: {} },
    { id: 1, f: 2, st: { n: 2, f: 1 }, m: {} },
  ]);
  expect(normalizeTable(table, ir, typedResult.rows)).toBe(
    '{"id":1,"e":"A","f":2.0,"st":{"n":2,"f":1.0},"m":{}}\n' +
      '{"id":2,"e":"A","f":1.0,"st":{"n":1,"f":0.5},"m":{}}\n',
  );
});

it('normalize 幂等：重复 normalize 字节不变', () => {
  const typedResult = typed([{ id: 1, f: 1.5, st: { n: 1, f: 1 }, m: {} }]);
  const once = normalizeTable(table, ir, typedResult.rows);
  const reparsed = once
    .split('\n')
    .filter((l) => l !== '')
    .map((l, i) => ({ json: JSON.parse(l) as unknown, line: i + 1 }));
  const twice = normalizeTable(table, ir, typeRows(table, ir, reparsed).rows);
  expect(twice).toBe(once);
});

it('空表 = 空串', () => {
  expect(normalizeTable(table, ir, [])).toBe('');
});

it('rowHash：同内容同哈希，异内容异哈希', () => {
  const first = typed([{ id: 1, f: 1.5, st: { n: 1, f: 1 }, m: {} }]).rows[0]?.row;
  const second = typed([{ id: 1, f: 1.5, st: { n: 1, f: 1 }, m: {} }]).rows[0]?.row;
  const third = typed([{ id: 2, f: 1.5, st: { n: 1, f: 1 }, m: {} }]).rows[0]?.row;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('行缺失');
  }
  const a = canonicalizeRow(table, ir, first);
  const b = canonicalizeRow(table, ir, second);
  const c = canonicalizeRow(table, ir, third);
  expect(rowHash(a)).toBe(rowHash(b));
  expect(rowHash(a)).not.toBe(rowHash(c));
});

it('string 主键表 normalize 按码点序', () => {
  const ts = ir.tables['TS'];
  if (ts === undefined) throw new Error('夹具缺表 TS');
  const rows = typeRows(ts, ir, [
    { json: { key: 'b' }, line: 1 },
    { json: { key: 'a' }, line: 2 },
  ]).rows;
  expect(normalizeTable(ts, ir, rows)).toBe('{"key":"a"}\n{"key":"b"}\n');
});
