import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runCheckSchema, runCli } from '../src/main.js';

const DEMO_PROJECT = fileURLToPath(new URL('../../../examples/demo', import.meta.url));
const BROKEN_PROJECT = fileURLToPath(new URL('./fixtures/broken', import.meta.url));

it('demo 项目：check-schema 通过（T1.6 验收）', () => {
  const run = runCheckSchema(DEMO_PROJECT);
  expect(run.exitCode).toBe(0);
  expect(run.lines.join('\n')).toContain('校验通过');
  expect(run.lines.join('\n')).toContain('5 表');
});

it('破坏夹具：exit 1 且错误含文件名与行号（T1.6 验收）', () => {
  const run = runCheckSchema(BROKEN_PROJECT);
  expect(run.exitCode).toBe(1);
  const text = run.lines.join('\n');
  expect(text).toContain('Bad.yaml');
  expect(text).toMatch(/第 \d+ 行/);
  expect(text).toContain('schema.yaml-parse');
});

it('schema 目录不存在：exit 2（用法/IO 错误）', () => {
  const run = runCheckSchema('tests/fixtures/no-such-project');
  expect(run.exitCode).toBe(2);
});

it('runCli 端到端：demo → exit 0', async () => {
  const code = await runCli(['check-schema', DEMO_PROJECT]);
  expect(code).toBe(0);
});
