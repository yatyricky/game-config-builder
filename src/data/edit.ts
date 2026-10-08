import type { FieldDef, StructDef, TableRow } from './types.ts'

/**
 * 单元格写入提交（纯函数，写时复制）：
 * 返回新 rows 数组；目标行越过末尾时用空记录 {} 补齐（稀疏新增，保存时压缩属 M7）。
 * value 为 unknown：键盘编辑传 string，粘贴可传任意单元格值（number/map/…/undefined=清空）。
 */
export function applyCellEdit(rows: readonly TableRow[], rowIndex: number, fieldName: string, value: unknown): TableRow[] {
  const next = rows.slice()
  while (next.length <= rowIndex) next.push({})
  next[rowIndex] = { ...next[rowIndex], [fieldName]: value }
  return next
}

/** 必填字段：无 default 属性的字段（spec 2026-10-08 增补） */
export function requiredFields(def: StructDef): FieldDef[] {
  return def.fields.filter(f => f.default === undefined)
}

/** 必填缺失判定：undefined/null/trim 后空串（裁决 2026-10-08：空白串不绕过校验） */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** 行内缺失的必填字段 */
export function missingRequired(def: StructDef, row: TableRow): FieldDef[] {
  return requiredFields(def).filter(f => isBlank(row[f.name]))
}
