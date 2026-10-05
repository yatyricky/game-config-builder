import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadSchema } from '../src/index.js';

const FIXTURE: Record<string, string> = {
  'Item.yaml': `tables:
  Item:
    comment: 物品表
    primaryKey: id
    displayField: name
    fields:
      - name: id
        type: int
        range: [1, 999999]
      - name: name
        type: string
        maxLength: 64
      - name: quality
        type: "enum<ItemQuality>"
        default: White
      - name: rewards
        type: "list<struct<RewardItem>>"
      - { name: attrs, type: "map<string, float>" }
      - name: onUse
        type: "union<SkillEffect>"

unions:
  SkillEffect:
    comment: 技能效果（tag 多态）
    tag: effectType
    variants:
      - { name: Damage, struct: DamageParams }
      - { name: Heal, struct: HealParams }
`,
  'types.yaml': `enums:
  ItemQuality:
    comment: 物品品质
    values:
      - { name: White, value: 0 }
      - { name: Green, value: 1 }

structs:
  RewardItem:
    comment: 奖励项
    fields:
      - { name: itemId, type: "ref<Item>" }
      - { name: count, type: int, default: 1, range: [1, 9999] }
  DamageParams:
    fields:
      - { name: power, type: int, range: [0, 999999] }
  HealParams:
    fields:
      - { name: heal, type: int, range: [1, 999999] }
`,
};

const goldenPath = fileURLToPath(new URL('./__goldens__/load-schema.json', import.meta.url));

it('多文件合并加载：IR 与 golden 一致且无错误', () => {
  const result = loadSchema(FIXTURE);
  expect(result.errors).toEqual([]);

  if (process.env['UPDATE_GOLDENS']) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, JSON.stringify(result.ir, null, 2) + '\n');
  }
  const golden: unknown = JSON.parse(readFileSync(goldenPath, 'utf8'));
  expect(result.ir).toEqual(golden);
});

it('空输入：空 IR、零错误', () => {
  const result = loadSchema({});
  expect(result.errors).toEqual([]);
  expect(result.ir).toEqual({ enums: {}, structs: {}, unions: {}, tables: {} });
});

it('坏缩进：schema.yaml-parse 错误带行号', () => {
  const result = loadSchema({
    'Bad.yaml': 'tables:\n  Item:\n    primaryKey: id\n   fields: []\n',
  });
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.ruleId).toBe('schema.yaml-parse');
  expect(result.errors[0]?.table).toBe('Bad.yaml');
  expect(result.errors[0]?.message).toMatch(/第 \d+ 行/);
  expect(result.ir.tables['Item']).toBeUndefined();
});

it('未知顶层键：报错而非忽略', () => {
  const result = loadSchema({ 'X.yaml': 'widgets:\n  Foo: {}\n' });
  expect(result.errors[0]?.ruleId).toBe('schema.unknown-key');
  expect(result.errors[0]?.message).toContain('widgets');
});

it('定义内未知键：报错而非忽略', () => {
  const result = loadSchema({
    'X.yaml': 'enums:\n  E:\n    values:\n      - { name: A, value: 0 }\n    bogus: 1\n',
  });
  expect(result.errors.map((e) => e.ruleId)).toContain('schema.unknown-key');
  expect(result.errors[0]?.message).toContain('bogus');
});

it('跨文件重复类型名：schema.duplicate-name', () => {
  const a = 'enums:\n  E:\n    values:\n      - { name: A, value: 0 }\n';
  const result = loadSchema({ 'A.yaml': a, 'B.yaml': a });
  expect(result.errors[0]?.ruleId).toBe('schema.duplicate-name');
  expect(result.errors[0]?.table).toBe('B.yaml');
});

it('形状不合法：枚举缺 values → 报错且定义被跳过', () => {
  const result = loadSchema({ 'X.yaml': 'enums:\n  E:\n    comment: 没有值\n' });
  expect(result.errors[0]?.ruleId).toBe('schema.shape');
  expect(result.ir.enums['E']).toBeUndefined();
});

it('字段缺 type：报错且所在定义被跳过', () => {
  const result = loadSchema({
    'X.yaml': 'structs:\n  S:\n    fields:\n      - { name: a }\n',
  });
  expect(result.errors[0]?.ruleId).toBe('schema.shape');
  expect(result.ir.structs['S']).toBeUndefined();
});
