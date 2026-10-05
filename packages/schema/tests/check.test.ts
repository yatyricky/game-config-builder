import { expect, it } from 'vitest';
import { checkSchema, loadSchema } from '../src/index.js';

/** 负夹具：返回指定 ruleId 的错误集合 */
function errorsOf(yaml: string): ReturnType<typeof checkSchema> {
  const loaded = loadSchema({ 'X.yaml': yaml });
  return checkSchema(loaded.ir);
}

function ruleIdsOf(yaml: string): string[] {
  return errorsOf(yaml).map((e) => e.ruleId);
}

it('§2.1 完整合法示例：零错误（正夹具）', () => {
  const yaml = `enums:
  ItemQuality:
    values:
      - { name: White, value: 0 }
      - { name: Green, value: 1 }
structs:
  RewardItem:
    fields:
      - { name: itemId, type: "ref<Item>", rule: "count <= 10 || itemId != 9001" }
      - { name: count, type: int, default: 1, range: [1, 9999] }
  DamageParams:
    fields:
      - { name: power, type: int, range: [0, 999999] }
  HealParams:
    fields:
      - { name: heal, type: int, range: [1, 999999] }
      - { name: cure, type: bool, default: false }
unions:
  SkillEffect:
    tag: effectType
    variants:
      - { name: Damage, struct: DamageParams }
      - { name: Heal, struct: HealParams }
tables:
  Item:
    primaryKey: id
    displayField: name
    fields:
      - { name: id, type: int, range: [1, 999999] }
      - { name: name, type: string, maxLength: 64 }
      - { name: quality, type: "enum<ItemQuality>", default: White }
      - { name: price, type: int, default: 0, rule: "price >= 0 && price % 10 == 0" }
      - { name: rewards, type: "list<struct<RewardItem>>" }
      - { name: attrs, type: "map<string, float>" }
      - { name: onUse, type: "union<SkillEffect>" }
    rowRules:
      - { id: price-quality, rule: "(quality == White) || (price > 0)", severity: warning }
`;
  expect(errorsOf(yaml)).toEqual([]);
});

it('primaryKey 不存在：schema.primary-key（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: nope
    displayField: name
    fields:
      - { name: id, type: int }
      - { name: name, type: string }
`);
  expect(ids).toContain('schema.primary-key');
});

it('primaryKey 类型非法（float 主键）：schema.primary-key（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: name
    fields:
      - { name: id, type: float }
      - { name: name, type: string }
`);
  expect(ids).toContain('schema.primary-key');
});

it('string 主键合法（正）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: key
    displayField: key
    fields:
      - { name: key, type: string }
`);
  expect(ids).not.toContain('schema.primary-key');
});

it('displayField 不存在：schema.display-field（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: ghost
    fields:
      - { name: id, type: int }
`);
  expect(ids).toContain('schema.display-field');
});

it('enum 成员名重复与值重复：schema.enum-member（负）', () => {
  const errors = errorsOf(`enums:
  E:
    values:
      - { name: A, value: 0 }
      - { name: A, value: 0 }
      - { name: B, value: 0 }
`);
  const memberErrors = errors.filter((e) => e.ruleId === 'schema.enum-member');
  expect(memberErrors.some((e) => e.message.includes('成员名'))).toBe(true);
  expect(memberErrors.some((e) => e.message.includes('成员值'))).toBe(true);
});

it('enum 成员值非整数：schema.enum-member（负）', () => {
  const ids = ruleIdsOf(`enums:
  E:
    values:
      - { name: A, value: 0.5 }
`);
  expect(ids).toContain('schema.enum-member');
});

it('range min>max：schema.range（负）；正常 range 无错（正）', () => {
  const bad = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int, range: [10, 1] }
`);
  expect(bad).toContain('schema.range');

  const good = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int, range: [1, 10] }
`);
  expect(good).not.toContain('schema.range');
});

it('类型名非 PascalCase：schema.naming（负）', () => {
  const ids = ruleIdsOf(`enums:
  bad_name:
    values:
      - { name: A, value: 0 }
`);
  expect(ids).toContain('schema.naming');
});

it('字段名含空格：schema.naming（负，§2.1 故意示例）', () => {
  const ids = ruleIdsOf(`structs:
  HealParams:
    fields:
      - { name: "cure Poison", type: bool }
`);
  expect(ids).toContain('schema.naming');
});

it('字段名保留字 value：schema.naming（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: value, type: int }
      - { name: id, type: int }
`);
  expect(ids).toContain('schema.naming');
});

it('union tag 非 camelCase：schema.naming（负）', () => {
  const ids = ruleIdsOf(`unions:
  U:
    tag: Effect Type
    variants:
      - { name: V, struct: S }
structs:
  S:
    fields:
      - { name: a, type: int }
`);
  expect(ids).toContain('schema.naming');
});

it('rowRule id 非 kebab-case：schema.naming（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
    rowRules:
      - { id: Price Quality, rule: "id > 0" }
`);
  expect(ids).toContain('schema.naming');
});

it('range 用在 string 字段：schema.field-key（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: s, type: string, range: [1, 2] }
`);
  expect(ids).toContain('schema.field-key');
});

it('maxLength 用在 int 字段：schema.field-key（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int, maxLength: 5 }
`);
  expect(ids).toContain('schema.field-key');
});

it('unique 声明在 struct 字段：schema.field-key（负）；表顶层合法（正）', () => {
  const bad = ruleIdsOf(`structs:
  S:
    fields:
      - { name: a, type: int, unique: true }
`);
  expect(bad).toContain('schema.field-key');

  const good = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: code, type: string, unique: true }
`);
  expect(good).not.toContain('schema.field-key');
});

it('rule 用在 list 字段：schema.field-key（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: tags, type: "list<string>", rule: "len(tags) < 3" }
`);
  expect(ids).toContain('schema.field-key');
});

it('default 用在 map 字段：schema.field-key（负）', () => {
  const ids = ruleIdsOf(`tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: m, type: "map<string, int>", default: {} }
`);
  expect(ids).toContain('schema.field-key');
});

it('ref 指向非表仍由 checkSchema 汇总（组合 resolveTypes）', () => {
  const ids = ruleIdsOf(`enums:
  E:
    values:
      - { name: A, value: 0 }
tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: r, type: "ref<E>" }
`);
  expect(ids).toContain('schema.bad-ref');
});
