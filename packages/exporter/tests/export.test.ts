import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '@gcb/schema';
import type { SchemaIr, TableDef } from '@gcb/schema';
import { loadSchemaDir } from '@gcb/schema/node';
import { typeRows, type RawRow } from '@gcb/validate';
import { expect, it } from 'vitest';
import { csharpTarget, jsonTarget, luaTarget } from '../src/index.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));
const GOLDEN = fileURLToPath(new URL('./__goldens__/export', import.meta.url));

function loadDemoContext() {
  const ir = loadSchemaDir(join(DEMO, 'schema')).ir;
  const tables = new Map<string, ReturnType<typeof typeRows>['rows']>();
  for (const [name, table] of Object.entries(ir.tables)) {
    if (table === undefined) continue;
    const file = join(DEMO, 'data', `${name}.jsonl`);
    const raw: RawRow[] = existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l, i) => ({ json: JSON.parse(l) as unknown, line: i + 1 }))
      : [];
    tables.set(name, typeRows(table, ir, raw).rows);
  }
  return { ir, tables };
}

function collect(files: Array<{ path: string; content: string }>): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

function tableOf(ir: SchemaIr, name: string): TableDef {
  const t = ir.tables[name];
  if (t === undefined) throw new Error(`缺表 ${name}`);
  return t;
}

it('T4.6：json/lua/csharp 三 target golden 全锁定 + 确定性（两次生成字节一致）', () => {
  const { ir, tables } = loadDemoContext();
  const runs = [
    jsonTarget.generate({ ir, tables }),
    jsonTarget.generate({ ir, tables }),
    luaTarget.generate({ ir, tables }),
    csharpTarget({ namespace: 'GameConfig' }).generate({ ir, tables }),
  ];
  const update = process.env['UPDATE_GOLDENS'] !== undefined;
  for (let i = 0; i < runs.length; i++) {
    const files = collect(runs[i] ?? []);
    for (const [path, content] of files) {
      const goldenPath = join(GOLDEN, `${i}`, path);
      if (update) {
        mkdirSync(dirname(goldenPath), { recursive: true });
        writeFileSync(goldenPath, content, 'utf8');
        continue;
      }
      expect(existsSync(goldenPath), `缺 golden：${i}/${path}`).toBe(true);
      expect(readFileSync(goldenPath, 'utf8'), `golden 漂移：${i}/${path}`).toBe(content);
    }
  }
});

it('T4.2：JSON 产物枚举转 int、union 判别式、map 键排序（抽查 Skill/Item）', () => {
  const { ir, tables } = loadDemoContext();
  const files = collect(jsonTarget.generate({ ir, tables }));
  const skill = files.get('json/Skill.json') ?? '';
  expect(skill).toContain('"effectType": "Damage"');
  expect(skill).toContain('"element": 1');
  const item = files.get('json/Item.json') ?? '';
  expect(item).toContain('"quality": 0');
  expect(item).toContain('"craftFrom": 2001');
});

it('T4.3：Lua 转义（引号/反斜杠/换行/制表）', () => {
  // 用字符码构造输入/期望，避免多层转义歧义
  const BS = String.fromCharCode(92);
  const NL = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);
  const inputValue = ['a"', 'b', BS, 'c', NL, 'd', TAB, 'e'].join('');
  const expectedLine = [
    '  s = "a',
    BS + '"',
    'b',
    BS + BS,
    'c',
    BS + 'n',
    'd',
    BS + 't',
    'e",',
  ].join('');

  const ir = loadSchema({
    'm.yaml': [
      'tables:',
      '  Esc:',
      '    primaryKey: key',
      '    displayField: key',
      '    fields:',
      '      - { name: key, type: string }',
      '      - { name: s, type: string }',
    ].join('\n'),
  }).ir;
  const table = tableOf(ir, 'Esc');
  const raw: RawRow[] = [{ json: { key: 'k', s: inputValue }, line: 1 }];
  const rows = typeRows(table, ir, raw).rows;
  const out = luaTarget.generate({ ir, tables: new Map([['Esc', rows]]) });
  const content = out.find((f) => f.path === 'lua/Esc.lua')?.content ?? '';
  expect(content).toContain(expectedLine);
});

it('T4.4：C# 命名映射（camelCase → PascalCase 属性）', () => {
  const { ir, tables } = loadDemoContext();
  const files = collect(csharpTarget({ namespace: 'GameConfig' }).generate({ ir, tables }));
  const reward = files.get('csharp/RewardItem.cs') ?? '';
  expect(reward).toContain('public int ItemId { get; set; }');
  expect(reward).toContain('public int Count { get; set; }');
  const union = files.get('csharp/SkillEffect.cs') ?? '';
  expect(union).toContain('public abstract class SkillEffect');
  expect(union).toContain('public sealed class SkillEffectDamage : SkillEffect');
});
