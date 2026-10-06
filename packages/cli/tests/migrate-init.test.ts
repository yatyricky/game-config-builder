import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runCheckSchema, runExportCli, runInit, runMigrateCli, runValidate } from '../src/main.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));

it('T5.4：init 后 check-schema / validate / export 三连通过（验收）', () => {
  const dir = join(tmpdir(), `gcb-init-${randomUUID()}`);
  try {
    const init = runInit(dir);
    expect(init.exitCode).toBe(0);
    expect(runCheckSchema(dir).exitCode).toBe(0);
    expect(runValidate(dir, false).exitCode).toBe(0);
    const out = join(dir, 'export');
    expect(runExportCli(dir, ['json', 'lua', 'csharp'], out).exitCode).toBe(0);
    // 拒绝重复 init
    expect(runInit(dir).exitCode).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('T5.3：rename-field 迁移——数据键重写 + 状态记录 + 幂等（验收）', () => {
  const project = join(tmpdir(), `gcb-mig-${randomUUID()}`);
  cpSync(DEMO, project, { recursive: true });
  try {
    // §10 顺序：先加迁移 → 改 schema → migrate
    mkdirSync(join(project, 'migrations'), { recursive: true });
    writeFileSync(
      join(project, 'migrations', '0001-rename-tier.yaml'),
      ['kind: rename-field', 'table: Material', 'from: tier', 'to: level'].join('\n') + '\n',
      'utf8',
    );
    const schemaPath = join(project, 'schema', 'Material.yaml');
    const schema = readFileSync(schemaPath, 'utf8');
    writeFileSync(schemaPath, schema.replace('name: tier', 'name: level'), 'utf8');

    const first = runMigrateCli(project);
    expect(first.exitCode).toBe(0);
    expect(first.lines.join('\n')).toContain('✓ 已应用 0001-rename-tier');

    const data = readFileSync(join(project, 'data', 'Material.jsonl'), 'utf8');
    expect(data).toContain('"level":2');
    expect(data).not.toContain('"tier"');
    expect(readFileSync(join(project, '.gcb-state.json'), 'utf8')).toContain('0001-rename-tier');

    // 幂等：再跑一次 = 无待应用
    const second = runMigrateCli(project);
    expect(second.lines.join('\n')).toContain('无待应用迁移');
    // 迁移后项目仍全绿
    expect(runValidate(project, false).exitCode).toBe(0);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

it('T5.3：retype-field 失败行全列后中止，零写入（验收）', () => {
  const project = join(tmpdir(), `gcb-mig2-${randomUUID()}`);
  cpSync(DEMO, project, { recursive: true });
  try {
    mkdirSync(join(project, 'migrations'), { recursive: true });
    writeFileSync(
      join(project, 'migrations', '0002-retype-name.yaml'),
      ['kind: retype-field', 'table: Material', 'field: name', 'from: string', 'to: int'].join(
        '\n',
      ) + '\n',
      'utf8',
    );
    const schemaPath = join(project, 'schema', 'Material.yaml');
    const schema = readFileSync(schemaPath, 'utf8');
    writeFileSync(
      schemaPath,
      schema.replace('type: string, maxLength: 64, unique: true', 'type: int'),
      'utf8',
    );

    const result = runMigrateCli(project);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('中止');
    // 全部失败行都列出（3 行 name 均不可转 int）
    expect(result.errors.filter((e) => e.ruleId === 'migrate.retype-failed')).toHaveLength(3);
    // 零写入：数据文件未动
    const data = readFileSync(join(project, 'data', 'Material.jsonl'), 'utf8');
    expect(data).toContain('"name"');
    expect(existsSync(join(project, '.gcb-state.json'))).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
