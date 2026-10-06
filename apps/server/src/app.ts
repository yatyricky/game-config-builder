// GCB server（M8，docs/02 §7 API 面）：单人编辑 + 行哈希乐观并发（ADR-9）。
// 无 ws、无锁、无 presence——server 是薄 API 层，业务全在 packages。

import Fastify from 'fastify';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { checkSchema, type SchemaIr, type TableDef, type ValidationError } from '@gcb/schema';
import { loadSchemaDir } from '@gcb/schema/node';
import { typeRows, validateFull, type RawRow } from '@gcb/validate';
import {
  canonicalizeRow,
  loadTable,
  openIndex,
  parseJsonl,
  queryBackrefs,
  reindex,
  rowHash,
  schemaHash as sqliteSchemaHash,
  writeTableNormalized,
  normalizedContent,
  type Backref,
} from '@gcb/data';
import type { TypedRow } from '@gcb/validate';

export interface ServerDeps {
  ir: SchemaIr;
  projectDir: string;
  errors: ValidationError[];
}

export function loadProject(projectDir: string): ServerDeps {
  const schemaDir = join(projectDir, 'schema');
  const loaded = loadSchemaDir(schemaDir);
  const errors = [...loaded.errors, ...checkSchema(loaded.ir)];
  return { ir: loaded.ir, projectDir: resolve(projectDir), errors };
}

function readRawRows(file: string, tableName: string): RawRow[] {
  if (!existsSync(file)) return [];
  return parseJsonl(tableName, readFileSync(file, 'utf8')).rows;
}

export interface AppOptions {
  projectDir: string;
}

export async function buildApp(options: AppOptions) {
  const deps = loadProject(options.projectDir);
  const app = Fastify({ logger: false });

  let db: ReturnType<typeof openIndex> | null = null;
  const ensureIndex = (): ReturnType<typeof openIndex> => {
    if (db === null) {
      const dbPath = join(deps.projectDir, 'gcb.db');
      const stale =
        !existsSync(dbPath) ||
        (() => {
          try {
            const d = openIndex(dbPath);
            const row = d.prepare('SELECT schema_hash FROM tables LIMIT 1').get() as
              { schema_hash?: string } | undefined;
            const ok = row?.schema_hash === sqliteSchemaHash(deps.ir);
            d.close();
            return !ok;
          } catch {
            return true;
          }
        })();
      if (stale) reindex(deps.ir, deps.projectDir);
      db = openIndex(dbPath);
    }
    return db;
  };

  const typedOf = (tableName: string): { table: TableDef; rows: TypedRow[] } | null => {
    const table = deps.ir.tables[tableName];
    if (table === undefined) return null;
    const raw = readRawRows(join(deps.projectDir, 'data', `${tableName}.jsonl`), tableName);
    return { table, rows: typeRows(table, deps.ir, raw).rows };
  };

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/api/schema', async () => ({ ir: deps.ir, errors: deps.errors }));

  app.get('/api/tables/:table/rows', async (req, reply) => {
    const { table: tableName } = req.params as { table: string };
    const { offset = '0', limit = '100' } = req.query as { offset?: string; limit?: string };
    const data = typedOf(tableName);
    if (data === null)
      return reply.code(404).send({ errors: [{ message: `未知表 ${tableName}` }] });
    const { table, rows } = data;
    const start = Math.max(0, Number(offset) || 0);
    const end = Math.min(rows.length, start + Math.max(1, Number(limit) || 100));
    const page = rows.slice(start, end).map((r) => ({
      pk: r.pk,
      rowHash: rowHash(canonicalizeRow(table, deps.ir, r.row)),
      cells: table.fields.map((f) => r.row[f.name]),
    }));
    return {
      total: rows.length,
      offset: start,
      columns: table.fields.map((f) => f.name),
      displayField: table.displayField,
      rows: page,
    };
  });

  app.get('/api/tables/:table/rows/:pk', async (req, reply) => {
    const { table: tableName, pk } = req.params as { table: string; pk: string };
    const data = typedOf(tableName);
    if (data === null)
      return reply.code(404).send({ errors: [{ message: `未知表 ${tableName}` }] });
    const { table, rows } = data;
    const row = rows.find((r) => r.pk === pk);
    if (row === undefined)
      return reply.code(404).send({ errors: [{ message: `行不存在 ${tableName}#${pk}` }] });
    return {
      pk,
      rowHash: rowHash(canonicalizeRow(table, deps.ir, row.row)),
      row: row.row,
    };
  });

  app.get('/api/backrefs/:table/:pk', async (req, reply) => {
    const { table, pk } = req.params as { table: string; pk: string };
    try {
      const index = ensureIndex();
      const backrefs: Backref[] = queryBackrefs(index, table, pk);
      return { backrefs };
    } catch (err) {
      return reply.code(500).send({
        errors: [{ message: `索引查询失败：${err instanceof Error ? err.message : String(err)}` }],
      });
    }
  });

  // 保存（乐观并发，ADR-9）：baseRowHash 不符 → 409 + 当前行；校验失败 → 422
  app.put('/api/tables/:table/rows/:pk', async (req, reply) => {
    const { table: tableName, pk } = req.params as { table: string; pk: string };
    const body = req.body as { row?: Record<string, unknown>; baseRowHash?: string } | undefined;
    if (body?.row === undefined || typeof body.baseRowHash !== 'string') {
      return reply.code(400).send({ errors: [{ message: '需要 { row, baseRowHash }' }] });
    }
    const table = deps.ir.tables[tableName];
    if (table === undefined)
      return reply.code(404).send({ errors: [{ message: `未知表 ${tableName}` }] });

    const dataDir = join(deps.projectDir, 'data');
    const current = loadTable(deps.ir, table, dataDir);
    const existing = current.rows.find((r) => r.pk === pk);
    if (existing === undefined)
      return reply.code(404).send({ errors: [{ message: `行不存在 ${tableName}#${pk}` }] });
    const currentHash = rowHash(canonicalizeRow(table, deps.ir, existing.row));
    if (currentHash !== body.baseRowHash) {
      return reply
        .code(409)
        .send({ reason: 'stale', currentRow: existing.row, currentRowHash: currentHash });
    }

    // 类型化新行并校验（不信任客户端）；v1 保存固定主键（改主键 = 删 + 增，M11 行管理）
    const rawRows = readRawRows(join(dataDir, `${tableName}.jsonl`), tableName);
    const replaced = rawRows.map((r) => {
      const obj = (
        r.json !== null && typeof r.json === 'object' && !Array.isArray(r.json) ? r.json : {}
      ) as Record<string, unknown>;
      const objPk = obj[table.primaryKey];
      const key =
        typeof objPk === 'number' ? String(objPk) : typeof objPk === 'string' ? objPk : '';
      return key === pk
        ? { json: body.row as unknown, line: r.line }
        : { json: r.json, line: r.line };
    });
    const typed = typeRows(table, deps.ir, replaced);
    const rowErrors = typed.errors.filter((e) => e.severity === 'error');
    if (rowErrors.length > 0) return reply.code(422).send({ errors: rowErrors });

    // 全库校验（FK 等）
    const allRaw = new Map<string, RawRow[]>();
    for (const name of Object.keys(deps.ir.tables)) {
      allRaw.set(
        name,
        name === tableName ? replaced : readRawRows(join(dataDir, `${name}.jsonl`), name),
      );
    }
    const fullErrors = validateFull(deps.ir, allRaw).filter((e) => e.severity === 'error');
    if (fullErrors.length > 0) return reply.code(422).send({ errors: fullErrors });

    // 规范化落盘 + 索引失效（下次访问重建）
    writeTableNormalized(dataDir, tableName, normalizedContent(deps.ir, table, typed.rows));
    if (db !== null) {
      // 简化：任何保存后失效索引（下次访问整库重建；10⁵ 行量级秒级）
      db.close();
      db = null;
    }
    const saved = loadTable(deps.ir, table, dataDir).rows.find((r) => r.pk === pk);
    return {
      pk,
      rowHash: saved !== undefined ? rowHash(canonicalizeRow(table, deps.ir, saved.row)) : '',
    };
  });

  app.get('/api/search', async (req) => {
    const { q = '' } = req.query as { q?: string };
    const needle = q.toLowerCase();
    const hits: Array<{ table: string; pk: string; display: string }> = [];
    if (needle !== '') {
      for (const [name, table] of Object.entries(deps.ir.tables)) {
        if (table === undefined) continue;
        const data = typedOf(name);
        if (data === null) continue;
        for (const r of data.rows) {
          const display = String(r.row[table.displayField] ?? '');
          if (display.toLowerCase().includes(needle) || r.pk.includes(needle)) {
            hits.push({ table: name, pk: r.pk, display });
            if (hits.length >= 50) break;
          }
        }
        if (hits.length >= 50) break;
      }
    }
    return { hits };
  });

  app.addHook('onClose', async () => {
    db?.close();
  });

  return { app, deps };
}
