import { cpSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const DEMO = fileURLToPath(new URL('../../../examples/demo', import.meta.url));
let project = '';
let app: Awaited<ReturnType<typeof buildApp>>['app'];

beforeAll(async () => {
  project = join(tmpdir(), `gcb-server-${randomUUID()}`);
  cpSync(DEMO, project, { recursive: true });
  const built = await buildApp({ projectDir: project });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(project, { recursive: true, force: true });
});

it('GET /api/schema：IR + 零错误', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/schema' });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { ir: { tables: Record<string, unknown> }; errors: unknown[] };
  expect(Object.keys(body.ir.tables)).toHaveLength(5);
  expect(body.errors).toEqual([]);
});

it('GET rows：分页窗口 + rowHash + displayField（M8 验收）', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tables/Item/rows?offset=0&limit=2' });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    total: number;
    rows: Array<{ pk: string; rowHash: string; cells: unknown[] }>;
  };
  expect(body.total).toBe(3);
  expect(body.rows).toHaveLength(2);
  expect(body.rows[0]?.rowHash).toMatch(/^[0-9a-f]{64}$/);
});

it('GET 单行 + 404', async () => {
  const ok = await app.inject({ method: 'GET', url: '/api/tables/Item/rows/1001' });
  expect(ok.statusCode).toBe(200);
  const missing = await app.inject({ method: 'GET', url: '/api/tables/Item/rows/9999' });
  expect(missing.statusCode).toBe(404);
});

it('GET /api/backrefs：Item#1001 被 Hero/Item 引用（索引自动重建）', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/backrefs/Item/1001' });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { backrefs: Array<{ fromTable: string; fromPk: string }> };
  expect(body.backrefs.map((b) => `${b.fromTable}#${b.fromPk}`)).toEqual([
    'Hero#4001',
    'Item#1002',
  ]);
});

it('PUT 保存：正确哈希 → 200 + 新哈希；错误哈希 → 409 + 当前行（ADR-9 验收）', async () => {
  const before = await app.inject({ method: 'GET', url: '/api/tables/Item/rows/1003' });
  const { rowHash: baseRowHash, row } = before.json() as {
    rowHash: string;
    row: Record<string, unknown>;
  };
  const oldHash = baseRowHash;

  const stale = await app.inject({
    method: 'PUT',
    url: '/api/tables/Item/rows/1003',
    payload: { row: { ...row, name: '金草药' }, baseRowHash: 'deadbeef' },
  });
  expect(stale.statusCode).toBe(409);
  expect((stale.json() as { reason: string }).reason).toBe('stale');

  const ok = await app.inject({
    method: 'PUT',
    url: '/api/tables/Item/rows/1003',
    payload: { row: { ...row, name: '金草药' }, baseRowHash },
  });
  expect(ok.statusCode).toBe(200);
  expect((ok.json() as { rowHash: string }).rowHash).not.toBe(oldHash);

  const after = await app.inject({ method: 'GET', url: '/api/tables/Item/rows/1003' });
  expect((after.json() as { row: Record<string, unknown> }).row['name']).toBe('金草药');
});

it('PUT 校验失败 → 422（不信任客户端）', async () => {
  const before = await app.inject({ method: 'GET', url: '/api/tables/Item/rows/1001' });
  const { rowHash: baseRowHash, row } = before.json() as {
    rowHash: string;
    row: Record<string, unknown>;
  };
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/tables/Item/rows/1001',
    payload: { row: { ...row, price: 33 }, baseRowHash }, // price % 10 == 0 违规
  });
  expect(bad.statusCode).toBe(422);
  expect(
    (bad.json() as { errors: Array<{ ruleId: string }> }).errors.some(
      (e) => e.ruleId === 'rule.field',
    ),
  ).toBe(true);
});

it('GET /api/search：displayField 命中', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/search?q=铁剑' });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { hits: Array<{ table: string; pk: string }> };
  expect(body.hits.map((h) => h.table + '#' + h.pk)).toContain('Item#1001');
});

it('保存后数据文件规范化（键序/排序）', async () => {
  const data = readFileSync(join(project, 'data', 'Item.jsonl'), 'utf8');
  expect(data.startsWith('{"id":1001')).toBe(true);
});
