import type { FieldDef, StructDef, TableRow } from './types.ts'

/**
 * 单元格编辑提交（纯函数，写时复制）：
 * 返回新 rows 数组；目标行越过末尾时用空记录 {} 补齐（稀疏新增，保存时压缩属 M7）。
 */
export function applyCellEdit(rows: readonly TableRow[], rowIndex: number, fieldName: string, value: string): TableRow[] {
  const next = rows.slice()
  while (next.length <= rowIndex) next.push({})
  next[rowIndex] = { ...next[rowIndex], [fieldName]: value }
  return next
}

/** 必填字段：无 default 属性的字段（spec 2026-10-08 增补） */
export function requiredFields(def: StructDef): FieldDef[] {
  return def.fields.filter(f => f.default === undefined)
}

/** 行内缺失的必填字段（undefined/null/空串都算空） */
export function missingRequired(def: StructDef, row: TableRow): FieldDef[] {
  return requiredFields(def).filter(f => {
    const v = row[f.name]
    return v === undefined || v === null || v === ''
  })
}
