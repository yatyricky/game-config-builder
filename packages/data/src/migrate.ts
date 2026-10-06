// 迁移 v0（docs/04 §10，T5.3）：显式迁移文件 + .gcb-state.json；失败行全列后中止，不部分应用。
// 顺序约定（§10）：先加迁移 → 改 schema → 跑 gcb migrate（迁移只动数据与状态，schema 由人提交）。

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SchemaIr, ValidationError } from '@gcb/schema';
import { typeRows } from '@gcb/validate';
import { parseJsonl } from './jsonl.js';
import { normalizeTable } from './canonical.js';
import { reindex } from './sqlite.js';

export type MigrationOp =
  | { kind: 'rename-field'; table: string; from: string; to: string }
  | { kind: 'retype-field'; table: string; field: string; from: string; to: string };

export interface Migration {
  id: string;
  op: MigrationOp;
}

export interface MigrateResult {
  exitCode: number;
  lines: string[];
  applied: string[];
  errors: ValidationError[];
}

export function loadMigrations(dir: string): Migration[] {
  if (!existsSync(dir)) return [];
  const out: Migration[] = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()) {
    const raw = parseYaml(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
    const id = name.replace(/\.(yaml|yml)$/, '');
    if (raw['kind'] === 'rename-field') {
      out.push({
        id,
        op: {
          kind: 'rename-field',
          table: String(raw['table']),
          from: String(raw['from']),
          to: String(raw['to']),
        },
      });
    } else if (raw['kind'] === 'retype-field') {
      out.push({
        id,
        op: {
          kind: 'retype-field',
          table: String(raw['table']),
          field: String(raw['field']),
          from: String(raw['from']),
          to: String(raw['to']),
        },
      });
    }
    // 未知 kind：v0 忽略（由使用者自查）；规范外迁移类型应走 ADR
  }
  return out;
}

export function runMigrations(ir: SchemaIr, projectDir: string): MigrateResult {
  const migrationsDir = join(projectDir, 'migrations');
  const dataDir = join(projectDir, 'data');
  const statePath = join(projectDir, '.gcb-state.json');
  const state: { applied: string[] } = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as { applied: string[] })
    : { applied: [] };
  const applied = [...state.applied];
  const errors: ValidationError[] = [];
  const lines: string[] = [];
  const migrations = loadMigrations(migrationsDir);
  let aborted = false;

  for (const migration of migrations) {
    if (applied.includes(migration.id)) continue;
    const table = ir.tables[migration.op.table];
    if (table === undefined) {
      errors.push({
        table: migration.op.table,
        rowKey: '',
        fieldPath: '',
        ruleId: 'migrate.unknown-table',
        severity: 'error',
        message: `迁移 ${migration.id}：未知表「${migration.op.table}」`,
      });
      aborted = true;
      break;
    }
    const file = join(dataDir, `${table.name}.jsonl`);
    const rawRows = existsSync(file) ? parseJsonl(table.name, readFileSync(file, 'utf8')).rows : [];
    let rowFailed = false;

    const updatedRows = rawRows.map(({ json, line }) => {
      if (json === null || typeof json !== 'object' || Array.isArray(json)) return { json, line };
      const obj = { ...(json as Record<string, unknown>) };
      if (migration.op.kind === 'rename-field') {
        if (Object.prototype.hasOwnProperty.call(obj, migration.op.from)) {
          // 键重写：解构剔除旧键（eslint no-dynamic-delete）
          const { [migration.op.from]: oldValue, ...rest } = obj;
          void oldValue;
          rest[migration.op.to] = oldValue;
          return { json: rest, line };
        }
      } else if (Object.prototype.hasOwnProperty.call(obj, migration.op.field)) {
        const converted = convertValue(obj[migration.op.field], migration.op.from, migration.op.to);
        if (converted.ok) {
          obj[migration.op.field] = converted.value;
        } else {
          errors.push({
            table: table.name,
            rowKey: String(obj[table.primaryKey] ?? ''),
            fieldPath: migration.op.field,
            ruleId: 'migrate.retype-failed',
            severity: 'error',
            message: `迁移 ${migration.id}：第 ${line} 行字段「${migration.op.field}」无法从 ${migration.op.from} 转换为 ${migration.op.to}（值 ${JSON.stringify(obj[migration.op.field])}）`,
          });
          rowFailed = true;
        }
      }
      return { json: obj, line };
    });

    if (rowFailed) {
      lines.push(`✗ 迁移 ${migration.id} 中止（失败行已全部列出，未写入）`);
      aborted = true;
      break;
    }
    const typed = typeRows(table, ir, updatedRows);
    if (typed.errors.some((e) => e.severity === 'error')) {
      for (const e of typed.errors) {
        errors.push({ ...e, message: `迁移 ${migration.id}：${e.message}` });
      }
      lines.push(`✗ 迁移 ${migration.id} 中止（数据与 schema 不匹配，未写入）`);
      aborted = true;
      break;
    }
    writeFileSync(file, normalizeTable(table, ir, typed.rows), 'utf8');
    applied.push(migration.id);
    lines.push(`✓ 已应用 ${migration.id}`);
  }

  writeFileSync(statePath, JSON.stringify({ applied }, null, 2) + '\n', 'utf8');
  if (!aborted && applied.length > state.applied.length) {
    try {
      const index = reindex(ir, projectDir);
      lines.push(`✓ 索引已重建：${index.rows} 行 / ${index.edges} 条引用边`);
    } catch {
      // gcb.db 不可写不阻断迁移（索引可随时重建）
    }
  }
  if (errors.length > 0) return { exitCode: 1, lines, applied, errors };
  if (applied.length === state.applied.length && migrations.length === applied.length) {
    lines.unshift('无待应用迁移');
  }
  return { exitCode: 0, lines, applied, errors };
}

function convertValue(
  value: unknown,
  from: string,
  to: string,
): { ok: true; value: unknown } | { ok: false } {
  if (from === to) return { ok: true, value };
  const numericFrom = from === 'int' || from === 'float';
  const numericTo = to === 'int' || to === 'float';
  if (numericFrom && numericTo) {
    if (to === 'int') {
      if (typeof value === 'number' && Number.isInteger(value)) return { ok: true, value };
      return { ok: false };
    }
    return typeof value === 'number' ? { ok: true, value } : { ok: false };
  }
  if (from === 'int' && to === 'string') {
    return typeof value === 'number' ? { ok: true, value: String(value) } : { ok: false };
  }
  if (from === 'string' && to === 'int') {
    if (typeof value === 'string' && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
      return { ok: true, value: Number(value) };
    }
    return { ok: false };
  }
  if (from === 'string' && to === 'float') {
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return { ok: true, value: Number(value) };
    }
    return { ok: false };
  }
  return { ok: false };
}
