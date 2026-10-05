import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { checkSchema, loadSchema } from '../src/index.js';

const DEMO_SCHEMA_DIR = fileURLToPath(new URL('../../../examples/demo/schema', import.meta.url));
const goldenPath = fileURLToPath(new URL('./__goldens__/schema-ir.json', import.meta.url));

function readYamlFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, readYamlFiles(full));
    } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
      const rel = relative(dir, full).split(sep).join('/');
      out[rel] = readFileSync(full, 'utf8');
    }
  }
  return out;
}

it('demo schema：checkSchema 零错误', () => {
  const result = loadSchema(readYamlFiles(DEMO_SCHEMA_DIR));
  expect(result.errors).toEqual([]);
  expect(checkSchema(result.ir)).toEqual([]);
});

it('demo schema：加载 IR 与 golden 一致（docs/05 T1.5 验收）', () => {
  const result = loadSchema(readYamlFiles(DEMO_SCHEMA_DIR));
  if (process.env['UPDATE_GOLDENS']) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, JSON.stringify(result.ir, null, 2) + '\n');
  }
  const golden: unknown = JSON.parse(readFileSync(goldenPath, 'utf8'));
  expect(result.ir).toEqual(golden);
});
