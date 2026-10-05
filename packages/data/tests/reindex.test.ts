import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadSchemaDir } from '@gcb/schema/node';
import { openIndex, queryBackrefs, reindex, schemaHash } from '../src/index.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));
const DB = join(DEMO, 'gcb.db');

it('reindex：fk_edges 行数 = demo 全库 ref 出边数；幂等重建（T3.6 验收）', () => {
  const ir = loadSchemaDir(join(DEMO, 'schema')).ir;
  const result1 = reindex(ir, DEMO);
  // ref 边：Item.craftFrom ×3 + Item1002.rewards.itemId ×1 + Hero4001.equipment ×2
  //        + Hero4001.skillIds ×2 + Hero4002.skillIds ×1 = 9
  expect(result1.rows).toBe(12);
  expect(result1.edges).toBe(9);
  expect(result1.tables).toBe(5);

  const second = reindex(ir, DEMO);
  expect(second).toEqual(result1);
  expect(existsSync(DB)).toBe(true);
});

it('queryBackrefs：道具与技能的反向引用清单', () => {
  const ir = loadSchemaDir(join(DEMO, 'schema')).ir;
  reindex(ir, DEMO);
  const db = openIndex(DB);
  try {
    expect(queryBackrefs(db, 'Item', '1001')).toEqual([
      { fromTable: 'Hero', fromPk: '4001', fromField: 'equipment.1' },
      { fromTable: 'Item', fromPk: '1002', fromField: 'rewards.0.itemId' },
    ]);
    const heroBackrefs = queryBackrefs(db, 'Skill', '3002');
    expect(heroBackrefs.map((b) => `${b.fromTable}#${b.fromPk}`)).toEqual([
      'Hero#4001',
      'Hero#4002',
    ]);
  } finally {
    db.close();
  }
});

it('schemaHash 稳定', () => {
  const ir = loadSchemaDir(join(DEMO, 'schema')).ir;
  expect(schemaHash(ir)).toBe(schemaHash(loadSchemaDir(join(DEMO, 'schema')).ir));
});

it('清理：测试不留 gcb.db', () => {
  if (existsSync(DB)) rmSync(DB);
  expect(existsSync(DB)).toBe(false);
});
