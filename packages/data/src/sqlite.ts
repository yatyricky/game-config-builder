// SQLite 派生索引（docs/04 §9，T3.6）。索引是缓存不是真相：可随时删除，gcb reindex 全量重建。

import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseTypeString } from '@gcb/schema';
import type { SchemaIr, TableDef, TypeAst } from '@gcb/schema';
import type { Row } from '@gcb/validate';
import Database from 'better-sqlite3';
import { canonicalizeRow } from './canonical.js';
import { loadTable, rowHash } from './io.js';

const DDL = `
CREATE TABLE IF NOT EXISTS tables(
  name TEXT PRIMARY KEY, pk_field TEXT NOT NULL, row_count INTEGER NOT NULL,
  schema_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rows(
  table_name TEXT NOT NULL, pk TEXT NOT NULL, row_hash TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (table_name, pk));
CREATE TABLE IF NOT EXISTS fk_edges(
  from_table TEXT NOT NULL, from_pk TEXT NOT NULL, from_field TEXT NOT NULL,
  to_table TEXT NOT NULL, to_pk TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fk_forward  ON fk_edges(from_table, from_pk);
CREATE INDEX IF NOT EXISTS idx_fk_backward ON fk_edges(to_table, to_pk);
`;

export interface Backref {
  fromTable: string;
  fromPk: string;
  fromField: string;
}

export function schemaHash(ir: SchemaIr): string {
  return createHash('sha256').update(JSON.stringify(ir), 'utf8').digest('hex');
}

/** 全量重建 <project>/gcb.db（先删旧库，保证幂等） */
export function reindex(
  ir: SchemaIr,
  projectDir: string,
): { tables: number; rows: number; edges: number } {
  const dbPath = join(projectDir, 'gcb.db');
  if (existsSync(dbPath)) rmSync(dbPath);
  const db = new Database(dbPath);
  try {
    db.exec(DDL);
    const hash = schemaHash(ir);
    const insertTable = db.prepare(
      'INSERT INTO tables(name, pk_field, row_count, schema_hash) VALUES (?,?,?,?)',
    );
    const insertRow = db.prepare(
      'INSERT INTO rows(table_name, pk, row_hash, json) VALUES (?,?,?,?)',
    );
    const insertEdge = db.prepare(
      'INSERT INTO fk_edges(from_table, from_pk, from_field, to_table, to_pk) VALUES (?,?,?,?,?)',
    );
    const dataDir = join(projectDir, 'data');

    let rowCount = 0;
    let edgeCount = 0;
    for (const tableName of Object.keys(ir.tables).sort()) {
      const table = ir.tables[tableName];
      if (table === undefined) continue;
      const data = loadTable(ir, table, dataDir);
      insertTable.run(table.name, table.primaryKey, data.rows.length, hash);
      for (const row of data.rows) {
        if (row.pk === '') continue;
        const canonical = canonicalizeRow(table, ir, row.row);
        insertRow.run(table.name, row.pk, rowHash(canonical), canonical);
        rowCount++;
        collectEdges(ir, table, row.row, (toTable, toPk, fromField) => {
          insertEdge.run(table.name, row.pk, fromField, toTable, toPk);
          edgeCount++;
        });
      }
    }
    return { tables: Object.keys(ir.tables).length, rows: rowCount, edges: edgeCount };
  } finally {
    db.close();
  }
}

function makeAstParser(): (type: string) => TypeAst | null {
  const cache = new Map<string, TypeAst | null>();
  return (type: string) => {
    const hit = cache.get(type);
    if (hit !== undefined) return hit;
    const parsed = parseTypeString(type);
    const ast = parsed.ok ? parsed.ast : null;
    cache.set(type, ast);
    return ast;
  };
}

function collectEdges(
  ir: SchemaIr,
  table: TableDef,
  row: Row,
  visit: (toTable: string, toPk: string, fromField: string) => void,
): void {
  const parseType = makeAstParser();
  const walk = (value: unknown, ast: TypeAst, path: string): void => {
    if (value === undefined) return;
    switch (ast.kind) {
      case 'ref': {
        const targetPk =
          typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
        if (targetPk !== '') visit(ast.tableName, targetPk, path);
        return;
      }
      case 'struct': {
        const structDef = ir.structs[ast.structName];
        if (
          structDef === undefined ||
          value === null ||
          typeof value !== 'object' ||
          value instanceof Map
        )
          return;
        for (const field of structDef.fields) {
          const fast = parseType(field.type);
          if (fast !== null)
            walk((value as Record<string, unknown>)[field.name], fast, `${path}.${field.name}`);
        }
        return;
      }
      case 'list':
        if (Array.isArray(value))
          value.forEach((item, i) => walk(item, ast.element, `${path}.${i}`));
        return;
      case 'map':
        if (value instanceof Map) {
          for (const [key, item] of value) walk(item, ast.element, `${path}.${String(key)}`);
        }
        return;
      case 'union': {
        const unionDef = ir.unions[ast.unionName];
        if (
          unionDef === undefined ||
          value === null ||
          typeof value !== 'object' ||
          value instanceof Map
        )
          return;
        const obj = value as Record<string, unknown>;
        const variantName = obj[unionDef.tag];
        const variant =
          typeof variantName === 'string'
            ? unionDef.variants.find((v) => v.name === variantName)
            : undefined;
        const variantStruct = variant ? ir.structs[variant.struct] : undefined;
        if (variantStruct === undefined) return;
        const inner = obj['value'];
        if (inner === null || typeof inner !== 'object' || inner instanceof Map) return;
        for (const field of variantStruct.fields) {
          const fast = parseType(field.type);
          if (fast !== null)
            walk(
              (inner as Record<string, unknown>)[field.name],
              fast,
              `${path}.value.${field.name}`,
            );
        }
        return;
      }
      default:
        return;
    }
  };
  for (const field of table.fields) {
    const ast = parseType(field.type);
    if (ast !== null) walk(row[field.name], ast, field.name);
  }
}

/** 反向引用查询（peek/删除保护的数据源，§9） */
export function queryBackrefs(db: Database.Database, table: string, pk: string): Backref[] {
  const stmt = db.prepare(
    'SELECT from_table, from_pk, from_field FROM fk_edges WHERE to_table = ? AND to_pk = ?',
  );
  const rows = stmt.all(table, pk) as Array<{
    from_table: string;
    from_pk: string;
    from_field: string;
  }>;
  return rows.map((r) => ({ fromTable: r.from_table, fromPk: r.from_pk, fromField: r.from_field }));
}

export function openIndex(dbPath: string): Database.Database {
  return new Database(dbPath);
}
