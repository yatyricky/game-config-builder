import type { StructDef, TableRow } from './types.ts'
import { missingRequired } from './edit.ts'

/** 空记录（裁决 2026-10-08）：所有值 undefined 或字符串 trim 后为空——保存时自动删除 */
export function isEmptyRecord(row: TableRow): boolean {
  return !Object.values(row).some(v => v !== undefined && !(typeof v === 'string' && v.trim() === ''))
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

export interface UniquenessIssue {
  field: string
  value: unknown
  /** 重复出现的 1-based 行号（压缩前行序） */
  rows: number[]
}

/** pk/unique 字段查重（裁决 2026-10-10，落定 G5 遗留）：非空值重复 → 阻止保存 */
export function validateUniqueness(def: StructDef, rows: readonly TableRow[]): UniquenessIssue[] {
  const out: UniquenessIssue[] = []
  for (const f of def.fields) {
    if (!f.pk && !f.unique) continue
    const seen = new Map<unknown, number[]>()
    rows.forEach((r, i) => {
      if (isEmptyRecord(r)) return
      const v = r[f.name]
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return
      const list = seen.get(v) ?? []
      list.push(i + 1)
      seen.set(v, list)
    })
    for (const [value, rowList] of seen) {
      if (rowList.length > 1) out.push({ field: f.name, value, rows: rowList })
    }
  }
  return out
}

/** JSONL 序列化：每记录一行 JSON，尾随换行；空表为空串 */
export function tableToJSONL(rows: readonly TableRow[]): string {
  if (rows.length === 0) return ''
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}
