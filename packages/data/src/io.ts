// Node 侧 IO（@gcb/data 是 Node 专有包，AGENTS §7.1）

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SchemaIr, TableDef, ValidationError } from '@gcb/schema';
import type { TypedRow } from '@gcb/validate';
import { checkKeys, typeRows } from '@gcb/validate';
import { parseJsonl } from './jsonl.js';
import { normalizeTable } from './canonical.js';

export interface TableData {
  table: TableDef;
  rows: TypedRow[];
  /** 解析 + 类型化 + 键检查的全部错误（不含规则/FK——那是 validateFull 的职责） */
  errors: ValidationError[];
  /** 磁盘原始内容（文件不存在时为空串） */
  raw: string;
}

/** 读取并解析单个表文件：<dataDir>/<Table>.jsonl；文件不存在 = 空表（§6） */
export function loadTable(ir: SchemaIr, table: TableDef, dataDir: string): TableData {
  const file = join(dataDir, `${table.name}.jsonl`);
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const parsed = parseJsonl(table.name, raw);
  const typed = typeRows(table, ir, parsed.rows);
  const keyErrors = checkKeys(table, typed.rows);
  return {
    table,
    rows: typed.rows,
    errors: [...parsed.errors, ...typed.errors, ...keyErrors],
    raw,
  };
}

/** 规范化写盘：内容必须来自 normalizeTable（绕过即 bug，AGENTS/ADR-4） */
export function writeTableNormalized(dataDir: string, tableName: string, content: string): void {
  writeFileSync(join(dataDir, `${tableName}.jsonl`), content, 'utf8');
}

/** 行哈希（§5.5）：对规范化 JSON 行取 sha256；输入必须是 canonicalizeRow 的产物 */
export function rowHash(canonicalLine: string): string {
  return createHash('sha256').update(canonicalLine, 'utf8').digest('hex');
}

/** 单表的规范化内容便捷入口（--fix / server 保存共用） */
export function normalizedContent(ir: SchemaIr, table: TableDef, rows: TypedRow[]): string {
  return normalizeTable(table, ir, rows);
}
