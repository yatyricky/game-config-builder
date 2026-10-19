import type { Project, StructDef, TableRow } from './types.ts'
import { tableTypeIndex } from './types.ts'
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

export interface TableViolation {
  table: string
  missing: SaveIssue[]
}

/** 单表校验：必填缺失（pk/unique 为同 schema 合并查重语义，见 uniquenessViolations）；全合规返回 null */
export function tableViolations(name: string, def: StructDef, rows: readonly TableRow[]): TableViolation | null {
  const missing = validateRows(def, rows)
  return missing.length === 0 ? null : { table: name, missing }
}

export interface UniquenessSource {
  /** 来源表格文件名 */
  table: string
  /** 压缩前 1-based 行号 */
  row: number
}

export interface UniquenessIssue {
  field: string
  value: unknown
  /** 重复出现的全部来源，可溯源 */
  at: UniquenessSource[]
}

/** 同 schema 合并查重（用户裁决 2026-10-16）：各表行拼接后对 pk/unique 查重；空记录与空白值不参与 */
export function uniquenessViolations(
  def: StructDef,
  tables: readonly { name: string; rows: readonly TableRow[] }[],
): UniquenessIssue[] {
  const out: UniquenessIssue[] = []
  for (const f of def.fields) {
    if (!f.pk && !f.unique) continue
    const seen = new Map<unknown, UniquenessSource[]>()
    for (const t of tables) {
      t.rows.forEach((r, i) => {
        if (isEmptyRecord(r)) return
        const v = r[f.name]
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return
        const list = seen.get(v) ?? []
        list.push({ table: t.name, row: i + 1 })
        seen.set(v, list)
      })
    }
    for (const [value, at] of seen) {
      if (at.length > 1) out.push({ field: f.name, value, at })
    }
  }
  return out
}

export interface ProjectViolations {
  /** 必填缺失，逐表 */
  missing: TableViolation[]
  /** pk/unique 查重，按 schema 分组合并 */
  duplicates: UniquenessIssue[]
}

/** 全工程校验：必填逐表；pk/unique 按 schema 分组合并查重（表→类型经 tables 清单索引） */
export function projectViolations(project: Project): ProjectViolations {
  const idx = tableTypeIndex(project.types)
  const missing: TableViolation[] = []
  const groups = new Map<string, { name: string; rows: readonly TableRow[] }[]>()
  for (const t of project.tables) {
    const typeName = idx.get(t.name)
    if (typeName === undefined) continue
    const def = project.types.get(typeName)
    if (!def || def.kind !== 'struct') continue
    const v = tableViolations(t.name, def, t.rows)
    if (v) missing.push(v)
    const list = groups.get(typeName) ?? []
    list.push(t)
    groups.set(typeName, list)
  }
  const duplicates: UniquenessIssue[] = []
  for (const [typeName, group] of groups) {
    const def = project.types.get(typeName)
    if (!def || def.kind !== 'struct') continue
    duplicates.push(...uniquenessViolations(def, group))
  }
  return { missing, duplicates }
}

/** 首条缺必填 + 「 等 N 行」后缀；表名前缀由调用方自行拼 */
export function formatMissingSummary(issues: SaveIssue[]): string {
  const first = issues[0]
  const more = issues.length > 1 ? ` 等 ${issues.length} 行` : ''
  return `第 ${first.row} 行缺少必填：${first.missing.join('、')}${more}`
}

/** 单条查重文案（跨表溯源） */
export function formatDuplicateIssue(u: UniquenessIssue): string {
  return `字段 ${u.field} 的值 ${JSON.stringify(u.value)} 在${u.at.map(a => `「${a.table}」第 ${a.row} 行`).join('、')}重复`
}

/** JSONL 序列化：每记录一行 JSON，尾随换行；空表为空串 */
export function tableToJSONL(rows: readonly TableRow[]): string {
  if (rows.length === 0) return ''
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}
