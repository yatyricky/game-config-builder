import { cpSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runValidate } from '../src/main.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));
const BROKEN = fileURLToPath(new URL('../../../examples/broken', import.meta.url));

it('demo：数据校验 0 错误 0 警告（T2.5 验收）', () => {
  const run = runValidate(DEMO, false);
  expect(run.lines.join('\n')).toContain('✓ 数据校验通过：5 表，0 错误 0 警告');
  expect(run.exitCode).toBe(0);
});

it('broken：实际错误与 expected.json 逐条双向比对（T2.5 验收）', () => {
  const run = runValidate(BROKEN, false);
  expect(run.exitCode).toBe(1);
  const expected = JSON.parse(readFileSync(join(BROKEN, 'expected.json'), 'utf8')) as Array<{
    table: string;
    ruleId: string;
    fieldPath: string;
  }>;
  const actual = run.errors.map((e) => ({
    table: e.table,
    ruleId: e.ruleId.split(':').shift() ?? e.ruleId,
    fieldPath: e.fieldPath,
  }));
  const key = (x: { table: string; ruleId: string; fieldPath: string }) =>
    `${x.table}|${x.ruleId}|${x.fieldPath}`;
  const expectedSet = new Set(expected.map(key));
  const actualSet = new Set(actual.map(key));
  const missing = [...expectedSet].filter((k) => !actualSet.has(k));
  const extra = [...actualSet].filter((k) => !expectedSet.has(k));
  expect(missing, '期望但未报出的错误').toEqual([]);
  expect(extra, '未期望的多余错误').toEqual([]);
});

it('--fix：修复 pk.order 后复查告警清零（T2.4 验收）', () => {
  const temp = join(tmpdir(), `gcb-fix-test-${randomUUID()}`);
  cpSync(BROKEN, temp, { recursive: true });
  try {
    const before = runValidate(temp, true);
    expect(before.lines.join('\n')).toContain('--fix：已规范化重写');
    const after = runValidate(temp, false);
    expect(after.errors.filter((e) => e.ruleId === 'pk.order')).toHaveLength(0);
    // 数据错误仍应存在（--fix 不修类型错误）
    expect(after.exitCode).toBe(1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
