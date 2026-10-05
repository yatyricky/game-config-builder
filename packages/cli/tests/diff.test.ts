import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runDiff, runExportCli } from '../src/main.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));

it('T5.2：A/B 两份导出的行级/字段级 diff 报告（golden 锁定）', () => {
  const dirA = join(tmpdir(), `gcb-diff-a-${Date.now()}`);
  const dirB = join(tmpdir(), `gcb-diff-b-${Date.now()}`);
  const project = join(tmpdir(), `gcb-diff-proj-${Date.now()}`);
  cpSync(DEMO, project, { recursive: true });
  try {
    expect(runExportCli(project, ['json'], dirA).exitCode).toBe(0);

    // 修改：改 Material 一行字段、加一行 Item、删一行 Text
    const material = readFileSync(join(project, 'data', 'Material.jsonl'), 'utf8');
    writeFileSync(
      join(project, 'data', 'Material.jsonl'),
      material.replace('"tier":2', '"tier":5') + '{"id":2004,"name":"秘银"}\n',
      'utf8',
    );
    const text = readFileSync(join(project, 'data', 'Text.jsonl'), 'utf8');
    writeFileSync(
      join(project, 'data', 'Text.jsonl'),
      text
        .split('\n')
        .filter((l) => !l.includes('ui.start'))
        .join('\n') + '\n',
      'utf8',
    );
    expect(runExportCli(project, ['json'], dirB).exitCode).toBe(0);

    const run = runDiff(dirA, dirB);
    expect(run.exitCode).toBe(0);
    const report = run.report;

    const expected = [
      '## Material',
      '- 新增：#2004',
      '- 变更 #2002：tier: 2 → 5',
      '## Text',
      '- 删除：#ui.start',
    ];
    for (const line of expected) {
      expect(report).toContain(line);
    }
    expect(report).toContain('共 3 处行级变更');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

it('T5.2：无变更 → 报告「无变更」', () => {
  const dirA = join(tmpdir(), `gcb-diff-same-${Date.now()}`);
  try {
    expect(runExportCli(DEMO, ['json'], dirA).exitCode).toBe(0);
    const run = runDiff(dirA, dirA);
    expect(run.report).toContain('无变更');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
  }
});
