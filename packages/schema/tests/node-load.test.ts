import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadSchemaDir } from '../src/node.js';

it('loadSchemaDir：读取 demo schema 目录（递归、posix 相对路径）', () => {
  const dir = fileURLToPath(new URL('../../../examples/demo/schema', import.meta.url));
  const result = loadSchemaDir(dir);
  expect(result.errors).toEqual([]);
  expect(Object.keys(result.ir.tables).sort()).toEqual([
    'Hero',
    'Item',
    'Material',
    'Skill',
    'Text',
  ]);
  const firstTable = result.ir.tables['Item'];
  expect(firstTable?.source?.file).toBe('Item.yaml');
  expect(firstTable?.source?.line).toBe(2);
});
