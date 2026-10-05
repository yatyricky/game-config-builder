import type { SchemaIr } from '@gcb/schema';
import { loadSchema } from '@gcb/schema';
import { expect, it } from 'vitest';
import { validateFull, type RawRow, type RawRowsByTable } from '../src/index.js';

const SCHEMA_YAML = `enums:
  E:
    values:
      - { name: A, value: 0 }
structs:
  S:
    fields:
      - { name: n, type: int }
tables:
  Item:
    primaryKey: id
    displayField: name
    fields:
      - { name: id, type: int }
      - { name: name, type: string }
      - { name: qty, type: int, rule: "qty >= 1 && qty <= 99" }
      - { name: kind, type: "enum<E>", default: A }
    rowRules:
      - id: name-required-len
        rule: "len(name) > 0"
        severity: warning
        message: "物品「{name}」名称为空"
  Chest:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: content, type: "ref<Item>" }
  SelfRef:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: parent, type: "ref<SelfRef>" }
`;
const ir: SchemaIr = loadSchema({ 's.yaml': SCHEMA_YAML }).ir;

function raw(items: Array<Record<string, unknown>>): RawRow[] {
  return items.map((json, i) => ({ json, line: i + 1 }));
}

it('T3.4：字段规则违规 → rule.field（error）', () => {
  const input: RawRowsByTable = new Map([['Item', raw([{ id: 1, name: 'x', qty: 200 }])]]);
  const errors = validateFull(ir, input);
  const ruleErrors = errors.filter((e) => e.ruleId === 'rule.field');
  expect(ruleErrors).toHaveLength(1);
  expect(ruleErrors[0]?.fieldPath).toBe('qty');
  expect(ruleErrors[0]?.message).toContain('qty >= 1');
});

it('T3.4：rowRules severity/message 模板（{name} 插值）', () => {
  const input: RawRowsByTable = new Map([['Item', raw([{ id: 1, name: '', qty: 1 }])]]);
  const errors = validateFull(ir, input);
  const rowRule = errors.find((e) => e.ruleId === 'rule.row:name-required-len');
  expect(rowRule).toBeDefined();
  expect(rowRule?.severity).toBe('warning');
  expect(rowRule?.message).toContain('「」名称为空');
});

it('T3.4：规则编译失败 → rule.compile（schema 域）', () => {
  const input: RawRowsByTable = new Map([['Item', raw([{ id: 1, name: 'x', qty: 1 }])]]);
  const brokenIr: SchemaIr = loadSchema({
    's.yaml': SCHEMA_YAML.replace('qty >= 1 && qty <= 99', 'qty >= 1 && nope > 0'),
  }).ir;
  const errors = validateFull(brokenIr, input);
  expect(errors.some((e) => e.ruleId === 'rule.compile')).toBe(true);
});

it('T3.5：跨表 FK 缺失 → fk.missing 定位在引用行', () => {
  const input: RawRowsByTable = new Map([
    ['Item', raw([{ id: 1, name: 'x', qty: 1 }])],
    ['Chest', raw([{ id: 100, content: 999 }])],
  ]);
  const errors = validateFull(ir, input);
  const fk = errors.filter((e) => e.ruleId === 'fk.missing');
  expect(fk).toHaveLength(1);
  expect(fk[0]?.table).toBe('Chest');
  expect(fk[0]?.rowKey).toBe('100');
  expect(fk[0]?.message).toContain('Item#999');
});

it('T3.5：自引用两遍法（先收主键集再查出边）与环安全', () => {
  const input: RawRowsByTable = new Map([
    [
      'SelfRef',
      raw([
        { id: 1, parent: 1 },
        { id: 2, parent: 1 },
        { id: 3, parent: 99 },
      ]),
    ],
  ]);
  const errors = validateFull(ir, input);
  const fk = errors.filter((e) => e.ruleId === 'fk.missing');
  expect(fk).toHaveLength(1);
  expect(fk[0]?.rowKey).toBe('3');
});

it('T3.5：合法引用零错误', () => {
  const input: RawRowsByTable = new Map([
    ['Item', raw([{ id: 1, name: 'x', qty: 1 }])],
    ['Chest', raw([{ id: 100, content: 1 }])],
    ['SelfRef', raw([{ id: 1, parent: 1 }])],
  ]);
  expect(validateFull(ir, input)).toEqual([]);
});
