import type { SchemaIr, TableDef } from '@gcb/schema';
import { loadSchema } from '@gcb/schema';
import { expect, it } from 'vitest';
import { typeRows, type RawRow } from '../src/index.js';

const SCHEMA_YAML = `enums:
  E:
    values:
      - { name: A, value: 0 }
      - { name: B, value: 1 }
structs:
  S:
    fields:
      - { name: n, type: int, range: [0, 5] }
      - { name: s, type: string }
tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: b, type: bool }
      - { name: i, type: int, range: [1, 10], default: 5 }
      - { name: f, type: float, default: 1.5 }
      - { name: s, type: string, maxLength: 4 }
      - { name: e, type: "enum<E>", default: A }
      - { name: st, type: "struct<S>" }
      - { name: l, type: "list<int>" }
      - { name: m, type: "map<int, string>" }
      - { name: u, type: "union<UEffect>" }
  T2:
    primaryKey: key
    displayField: key
    fields:
      - { name: key, type: string }
      - { name: r, type: "ref<T>" }
  U:
    comment: 用于 union 的表（含 union 字段）
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
unions:
  UEffect:
    tag: kind
    variants:
      - { name: V, struct: S }
`;

const ir: SchemaIr = loadSchema({ 's.yaml': SCHEMA_YAML }).ir;

function tableOf(name: string): TableDef {
  const t = ir.tables[name];
  if (t === undefined) throw new Error(`夹具缺表 ${name}`);
  return t;
}

function typeOne(line: string) {
  const raw: RawRow[] = [{ json: JSON.parse(line), line: 1 }];
  return typeRows(tableOf('T'), ir, raw);
}

function ruleIds(result: { errors: { ruleId: string; fieldPath: string }[] }): string[] {
  return result.errors.map((e) => e.ruleId);
}

const LEGAL = JSON.stringify({
  id: 1,
  b: true,
  s: 'ok',
  st: { n: 2, s: 'x' },
  l: [1, 2],
  m: { '1': 'a', '2': 'b' },
  u: { kind: 'V', value: { n: 1, s: 'y' } },
});

it('合法行：类型化成功 + 默认值填充 + 未知键零错误', () => {
  const result = typeOne(LEGAL);
  expect(result.errors).toEqual([]);
  const row = result.rows[0]?.row;
  expect(row?.['i']).toBe(5); // 缺省 → default
  expect(row?.['f']).toBe(1.5);
  expect(row?.['e']).toBe('A');
  expect(result.rows[0]?.pk).toBe('1');
});

it('int 键 map 加载后键转为 number（§3.2）', () => {
  const row = typeOne(LEGAL).rows[0]?.row;
  const m = row?.['m'] as Map<number, string>;
  expect([...m.keys()]).toEqual([1, 2]);
});

it('type.bool.parse（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: 'yes' })))).toContain('type.bool.parse');
});

it('type.int.parse：小数/字符串/超安全整数（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1.5, b: true })))).toContain('type.int.parse');
  expect(ruleIds(typeOne(JSON.stringify({ id: '9', b: true })))).toContain('type.int.parse');
  expect(ruleIds(typeOne(JSON.stringify({ id: 1e18, b: true })))).toContain('type.int.parse');
});

it('type.int.range（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, i: 99 })))).toContain('type.int.range');
});

it('type.float.parse：NaN 字符串形式不可达，字符串拒绝（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, f: 'x' })))).toContain(
    'type.float.parse',
  );
});

it('type.string.max-length（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, s: 'too long' })))).toContain(
    'type.string.max-length',
  );
});

it('type.string.parse：string 字段给数字（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, s: 9 })))).toContain('type.string.parse');
});

it('enum.unknown-member（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, e: 'Z' })))).toContain(
    'enum.unknown-member',
  );
});

it('type.unknown-field（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, ghost: 1 })))).toContain(
    'type.unknown-field',
  );
});

it('required.missing：主键缺失（负）', () => {
  const result = typeOne(JSON.stringify({ b: true }));
  expect(ruleIds(result)).toContain('required.missing');
});

it('map.key.parse：int 键无法解析（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, m: { abc: 'x' } })))).toContain(
    'map.key.parse',
  );
});

it('union.shape：缺 value / 错误判别值（负）', () => {
  expect(ruleIds(typeOne(JSON.stringify({ id: 1, b: true, u: { kind: 'V' } })))).toContain(
    'union.shape',
  );
  expect(
    ruleIds(typeOne(JSON.stringify({ id: 1, b: true, u: { kind: 'Nope', value: {} } }))),
  ).toContain('union.shape');
});

it('union 变体字段校验：嵌套路径 fieldPath（负）', () => {
  const result = typeOne(
    JSON.stringify({ id: 1, b: true, u: { kind: 'V', value: { n: 99, s: 'x' } } }),
  );
  expect(ruleIds(result)).toContain('type.int.range');
  expect(result.errors.find((e) => e.ruleId === 'type.int.range')?.fieldPath).toBe('u.value.n');
});

it('嵌套 struct 的 range 与默认填充（正负）', () => {
  const bad = typeOne(JSON.stringify({ id: 1, b: true, s: 'ok', st: { s: 'x' } }));
  expect(ruleIds(bad)).toContain('required.missing'); // S.n 无默认
  const good = typeOne(
    JSON.stringify({
      id: 1,
      b: true,
      s: 'ok',
      st: { n: 3, s: 'x' },
      l: [],
      m: {},
      u: { kind: 'V', value: { n: 1, s: 'y' } },
    }),
  );
  expect(good.errors).toEqual([]);
});

it('ref 字段按目标表主键类型校验（T 的 pk 为 int）', () => {
  const t2 = tableOf('T2');
  const bad = typeRows(t2, ir, [{ json: { key: 'k', r: '9' }, line: 1 }]);
  expect(ruleIds(bad)).toContain('type.ref.parse');
  const good = typeRows(t2, ir, [{ json: { key: 'k', r: 9 }, line: 1 }]);
  expect(good.errors).toEqual([]);
});
