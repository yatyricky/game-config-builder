import { expect, it } from 'vitest';
import type { SchemaIr } from '../src/index.js';
import { parseTypeString, resolveTypes } from '../src/index.js';

// ---------- parser：文法每条产生式 ----------

it('基础类型五种', () => {
  for (const name of ['bool', 'int', 'float', 'string', 'text'] as const) {
    expect(parseTypeString(name)).toEqual({ ok: true, ast: { kind: 'primitive', name } });
  }
});

it('enum/struct/ref/union 单参泛型', () => {
  expect(parseTypeString('enum<ItemQuality>')).toEqual({
    ok: true,
    ast: { kind: 'enum', enumName: 'ItemQuality' },
  });
  expect(parseTypeString('struct<RewardItem>')).toEqual({
    ok: true,
    ast: { kind: 'struct', structName: 'RewardItem' },
  });
  expect(parseTypeString('ref<Item>')).toEqual({
    ok: true,
    ast: { kind: 'ref', tableName: 'Item' },
  });
  expect(parseTypeString('union<SkillEffect>')).toEqual({
    ok: true,
    ast: { kind: 'union', unionName: 'SkillEffect' },
  });
});

it('list 与 map（含逗号后空格）', () => {
  expect(parseTypeString('list<int>')).toEqual({
    ok: true,
    ast: { kind: 'list', element: { kind: 'primitive', name: 'int' } },
  });
  expect(parseTypeString('map<string, float>')).toEqual({
    ok: true,
    ast: {
      kind: 'map',
      key: 'string',
      element: { kind: 'primitive', name: 'float' },
    },
  });
  expect(parseTypeString('map<int,ref<Item>>')).toEqual({
    ok: true,
    ast: { kind: 'map', key: 'int', element: { kind: 'ref', tableName: 'Item' } },
  });
});

it('嵌套组合在语法层合法（深度约束属语义层）', () => {
  const result = parseTypeString('list<map<string, list<enum<Q>>>>');
  expect(result.ok).toBe(true);
});

it('语法错误：未知类型 / 泛型参数 / 未闭合 / 尾随字符 / 非法 map 键 / 空串', () => {
  expect(parseTypeString('foo').ok).toBe(false);
  expect(parseTypeString('int<4>').ok).toBe(false);
  expect(parseTypeString('enum<Item').ok).toBe(false);
  expect(parseTypeString('int int').ok).toBe(false);
  expect(parseTypeString('map<float, int>').ok).toBe(false);
  expect(parseTypeString('').ok).toBe(false);
  expect(parseTypeString('ref<1Bad>').ok).toBe(false);
});

// ---------- resolveTypes：引用存在性 / 深度 / 环 ----------

function emptyIr(): SchemaIr {
  return { enums: {}, structs: {}, unions: {}, tables: {} };
}

it('合法 IR：零错误', () => {
  const ir = emptyIr();
  ir.enums['Q'] = {
    kind: 'enum',
    name: 'Q',
    values: [{ name: 'A', value: 0 }],
  };
  ir.structs['S'] = {
    kind: 'struct',
    name: 'S',
    fields: [
      { name: 'q', type: 'enum<Q>' },
      { name: 'items', type: 'list<struct<S2>>' },
    ],
  };
  ir.structs['S2'] = {
    kind: 'struct',
    name: 'S2',
    fields: [{ name: 'm', type: 'map<string, ref<T>>' }],
  };
  ir.unions['U'] = {
    kind: 'union',
    name: 'U',
    tag: 'kind',
    variants: [{ name: 'V', struct: 'S' }],
  };
  ir.tables['T'] = {
    kind: 'table',
    name: 'T',
    primaryKey: 'id',
    displayField: 'id',
    fields: [
      { name: 'id', type: 'int' },
      { name: 'onUse', type: 'union<U>' },
    ],
  };
  expect(resolveTypes(ir)).toEqual([]);
});

it('ref 指向非表：schema.bad-ref', () => {
  const ir = emptyIr();
  ir.enums['Item'] = { kind: 'enum', name: 'Item', values: [{ name: 'A', value: 0 }] };
  ir.tables['T'] = {
    kind: 'table',
    name: 'T',
    primaryKey: 'id',
    displayField: 'id',
    fields: [{ name: 'r', type: 'ref<Item>' }],
  };
  const errors = resolveTypes(ir);
  expect(errors[0]?.ruleId).toBe('schema.bad-ref');
  expect(errors[0]?.message).toContain('必须指向表');
});

it('未知引用名：schema.bad-ref', () => {
  const ir = emptyIr();
  ir.tables['T'] = {
    kind: 'table',
    name: 'T',
    primaryKey: 'id',
    displayField: 'id',
    fields: [
      { name: 'e', type: 'enum<Missing>' },
      { name: 'r', type: 'ref<NoSuchTable>' },
      { name: 's', type: 'struct<Nope>' },
      { name: 'u', type: 'union<NoUnion>' },
    ],
  };
  const errors = resolveTypes(ir);
  expect(errors.filter((e) => e.ruleId === 'schema.bad-ref')).toHaveLength(4);
});

it('list/map 嵌套：schema.depth', () => {
  const ir = emptyIr();
  ir.tables['T'] = {
    kind: 'table',
    name: 'T',
    primaryKey: 'id',
    displayField: 'id',
    fields: [
      { name: 'a', type: 'list<list<int>>' },
      { name: 'b', type: 'map<string, list<int>>' },
      { name: 'c', type: 'list<map<string, int>>' },
      { name: 'ok', type: 'list<struct<X>>' },
    ],
  };
  ir.structs['X'] = { kind: 'struct', name: 'X', fields: [{ name: 'v', type: 'int' }] };
  const errors = resolveTypes(ir);
  expect(errors.filter((e) => e.ruleId === 'schema.depth')).toHaveLength(3);
});

it('struct 直接循环：schema.cycle', () => {
  const ir = emptyIr();
  ir.structs['A'] = {
    kind: 'struct',
    name: 'A',
    fields: [{ name: 'b', type: 'struct<B>' }],
  };
  ir.structs['B'] = {
    kind: 'struct',
    name: 'B',
    fields: [{ name: 'a', type: 'struct<A>' }],
  };
  const errors = resolveTypes(ir);
  expect(errors.some((e) => e.ruleId === 'schema.cycle')).toBe(true);
});

it('经 union 变体的间接循环：schema.cycle', () => {
  const ir = emptyIr();
  ir.structs['A'] = {
    kind: 'struct',
    name: 'A',
    fields: [{ name: 'effect', type: 'union<U>' }],
  };
  ir.unions['U'] = {
    kind: 'union',
    name: 'U',
    tag: 'kind',
    variants: [{ name: 'V', struct: 'VParams' }],
  };
  ir.structs['VParams'] = {
    kind: 'struct',
    name: 'VParams',
    fields: [{ name: 'next', type: 'struct<A>' }],
  };
  const errors = resolveTypes(ir);
  expect(errors.some((e) => e.ruleId === 'schema.cycle')).toBe(true);
});

it('类型字符串语法错：schema.type-parse', () => {
  const ir = emptyIr();
  ir.tables['T'] = {
    kind: 'table',
    name: 'T',
    primaryKey: 'id',
    displayField: 'id',
    fields: [{ name: 'x', type: 'list<int' }],
  };
  const errors = resolveTypes(ir);
  expect(errors[0]?.ruleId).toBe('schema.type-parse');
});

it('自引用集合（list<struct<A>> 在 A 内）也构成环', () => {
  const ir = emptyIr();
  ir.structs['A'] = {
    kind: 'struct',
    name: 'A',
    fields: [{ name: 'children', type: 'list<struct<A>>' }],
  };
  const errors = resolveTypes(ir);
  expect(errors.some((e) => e.ruleId === 'schema.cycle')).toBe(true);
});
