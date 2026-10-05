import { expect, it } from 'vitest';
import type { SchemaIr, TypeAst } from '../src/index.js';

/**
 * T1.1 验收：docs/04 §2.1 示例的全部构造必须可被 IR 表达。
 * 主断言在编译期（satisfies，typecheck 红 = 卡片失败）；运行期断言守护夹具完整性。
 */
const demoSchema = {
  enums: {
    ItemQuality: {
      kind: 'enum',
      name: 'ItemQuality',
      comment: '物品品质',
      values: [
        { name: 'White', value: 0 },
        { name: 'Green', value: 1 },
        { name: 'Blue', value: 2 },
        { name: 'Purple', value: 3 },
      ],
    },
  },
  structs: {
    RewardItem: {
      kind: 'struct',
      name: 'RewardItem',
      comment: '奖励项',
      fields: [
        { name: 'itemId', type: 'ref<Item>', rule: 'count <= 10 || itemId != 9001' },
        { name: 'count', type: 'int', default: 1, range: [1, 9999] },
      ],
    },
    DamageParams: {
      kind: 'struct',
      name: 'DamageParams',
      fields: [
        { name: 'power', type: 'int', range: [0, 999999] },
        { name: 'element', type: 'enum<ItemQuality>', default: 'White' },
      ],
    },
    HealParams: {
      kind: 'struct',
      name: 'HealParams',
      fields: [{ name: 'heal', type: 'int', range: [1, 999999] }],
    },
  },
  unions: {
    SkillEffect: {
      kind: 'union',
      name: 'SkillEffect',
      comment: '技能效果（tag 多态）',
      tag: 'effectType',
      variants: [
        { name: 'Damage', struct: 'DamageParams' },
        { name: 'Heal', struct: 'HealParams' },
      ],
    },
  },
  tables: {
    Item: {
      kind: 'table',
      name: 'Item',
      comment: '物品表',
      primaryKey: 'id',
      displayField: 'name',
      fields: [
        { name: 'id', type: 'int', range: [1, 999999] },
        { name: 'name', type: 'string', maxLength: 64 },
        { name: 'quality', type: 'enum<ItemQuality>', default: 'White' },
        { name: 'price', type: 'int', default: 0, rule: 'price >= 0 && price % 10 == 0' },
        { name: 'rewards', type: 'list<struct<RewardItem>>' },
        { name: 'attrs', type: 'map<string, float>' },
        { name: 'onUse', type: 'union<SkillEffect>' },
      ],
      rowRules: [
        {
          id: 'price-quality',
          rule: '(quality == White) || (price > 0)',
          severity: 'warning',
          message: '非白品物品应定价',
        },
      ],
    },
  },
} satisfies SchemaIr;

/** §3.1 类型字符串 AST：覆盖全部 kind（含 struct 字段里的 ref 构造） */
const demoFieldTypes = {
  id: { kind: 'primitive', name: 'int' },
  name: { kind: 'primitive', name: 'string' },
  quality: { kind: 'enum', enumName: 'ItemQuality' },
  price: { kind: 'primitive', name: 'float' },
  rewards: { kind: 'list', element: { kind: 'struct', structName: 'RewardItem' } },
  attrs: { kind: 'map', key: 'string', element: { kind: 'primitive', name: 'float' } },
  onUse: { kind: 'union', unionName: 'SkillEffect' },
  itemId: { kind: 'ref', tableName: 'Item' },
} satisfies Record<string, TypeAst>;

it('§2.1 示例全部构造可被 SchemaIr 表达', () => {
  expect(Object.keys(demoSchema.enums)).toEqual(['ItemQuality']);
  expect(Object.keys(demoSchema.structs)).toEqual(['RewardItem', 'DamageParams', 'HealParams']);
  expect(Object.keys(demoSchema.unions)).toEqual(['SkillEffect']);
  expect(Object.keys(demoSchema.tables)).toEqual(['Item']);
  expect(demoSchema.tables['Item']?.fields).toHaveLength(7);
  expect(demoSchema.enums['ItemQuality']?.values).toHaveLength(4);
});

it('TypeAst 覆盖全部 kind', () => {
  const kinds = new Set<TypeAst['kind']>();
  const collect = (ast: TypeAst): void => {
    kinds.add(ast.kind);
    if (ast.kind === 'list' || ast.kind === 'map') collect(ast.element);
  };
  Object.values(demoFieldTypes).forEach(collect);
  expect([...kinds].sort()).toEqual(
    ['enum', 'list', 'map', 'primitive', 'ref', 'struct', 'union'].sort(),
  );
});
