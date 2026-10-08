import type { StructDef, TableRow } from './types.ts'
import { missingRequired } from './edit.ts'

/** 空记录：没有任何非 undefined 值（保存时自动删除，spec 2026-10-08 裁决） */
export function isEmptyRecord(row: TableRow): boolean {
  return !Object.values(row).some(v => v !== undefined)
}

/** 保存前压缩：删除空记录，其余保持原顺序 */
export function compactRows(rows: readonly TableRow[]): TableRow[] {
  return rows.filter(r => !isEmptyRecord(r))
}

export interface SaveIssue {
  /** 1-based 行号（压缩前行序） */
  row: number
  missing: string[]
}

/** 保存校验（spec 2026-10-08 裁决）：非空记录存在必填字段为空 → 无法保存；空记录不拦（压缩删除） */
export function validateRows(def: StructDef, rows: readonly TableRow[]): SaveIssue[] {
  const out: SaveIssue[] = []
  rows.forEach((r, i) => {
    if (isEmptyRecord(r)) return
    const missing = missingRequired(def, r).map(f => f.name)
    if (missing.length > 0) out.push({ row: i + 1, missing })
  })
  return out
}

/** JSONL 序列化：每记录一行 JSON，尾随换行；空表为空串 */
export function tableToJSONL(rows: readonly TableRow[]): string {
  if (rows.length === 0) return ''
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}
