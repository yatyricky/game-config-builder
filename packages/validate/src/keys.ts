// 主键唯一 / 字段唯一 / 行序检查（docs/04 §5.1 步骤「主键/唯一」与 §6 行序，T2.3）

import type { TableDef } from '@gcb/schema';
import type { ValidationError } from '@gcb/schema';
import { parseTypeString } from '@gcb/schema';
import type { TypedRow } from './rows.js';

function keyError(
  table: string,
  rowKey: string,
  fieldPath: string,
  ruleId: string,
  severity: 'error' | 'warning',
  message: string,
): ValidationError {
  return { table, rowKey, fieldPath, ruleId, severity, message };
}

/** 表主键的键类型（int → 数值序；string → 码点序），非法 schema 已由 checkSchema 报告 */
export function pkKindOf(table: TableDef): 'int' | 'string' {
  const pkField = table.fields.find((f) => f.name === table.primaryKey);
  if (!pkField) return 'int';
  const parsed = parseTypeString(pkField.type);
  return parsed.ok && parsed.ast.kind === 'primitive' && parsed.ast.name === 'string'
    ? 'string'
    : 'int';
}

export function pkLess(a: string, b: string, kind: 'int' | 'string'): boolean {
  if (kind === 'int') return Number(a) < Number(b);
  return a < b;
}

/** 主键重复、unique 字段重复、行序告警。重复行全部保留在 rows 中（不静默去重）。 */
export function checkKeys(table: TableDef, rows: TypedRow[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const kind = pkKindOf(table);
  const seenPk = new Map<string, number>(); // pk → 首次出现的行号
  for (const row of rows) {
    if (row.pk === '') continue;
    const firstLine = seenPk.get(row.pk);
    if (firstLine !== undefined) {
      errors.push(
        keyError(
          table.name,
          row.pk,
          table.primaryKey,
          'pk.duplicate',
          'error',
          `主键 ${row.pk} 重复（第 ${row.line} 行与第 ${firstLine} 行冲突）`,
        ),
      );
    } else {
      seenPk.set(row.pk, row.line);
    }
  }

  const uniqueFields = table.fields.filter((f) => f.unique === true);
  for (const field of uniqueFields) {
    const seen = new Map<string, number>();
    for (const row of rows) {
      const raw = row.row[field.name];
      if (raw === undefined) continue;
      const valueKey = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null;
      if (valueKey === null) continue;
      const firstLine = seen.get(valueKey);
      if (firstLine !== undefined) {
        errors.push(
          keyError(
            table.name,
            row.pk,
            field.name,
            'unique.duplicate',
            'error',
            `字段「${field.name}」的值 ${JSON.stringify(valueKey)} 重复（第 ${row.line} 行与第 ${firstLine} 行冲突）`,
          ),
        );
      } else {
        seen.set(valueKey, row.line);
      }
    }
  }

  let reportedOrder = false;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.pk === '' || curr.pk === '') continue;
    if (!pkLess(prev.pk, curr.pk, kind) && prev.pk !== curr.pk) {
      if (!reportedOrder) {
        errors.push(
          keyError(
            table.name,
            curr.pk,
            '',
            'pk.order',
            'warning',
            `行序未按主键升序（第 ${curr.line} 行起）；可运行 gcb validate --fix 修复`,
          ),
        );
        reportedOrder = true;
      }
    }
  }
  return errors;
}
