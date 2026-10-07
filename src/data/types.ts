/** spec：自定义类型的名称必须不能与 js 基础类型冲突 */
export const JS_PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'symbol',
  'bigint',
])

export interface EnumMember {
  name: string
  value: number
}

export interface EnumDef {
  kind: 'enum'
  name: string
  flags: boolean
  members: EnumMember[]
}

export interface FieldDef {
  name: string
  type: string
  pk?: boolean
  displayName?: string
  /** spec（2026-10-08 增补）：可带 default 属性；无 default 即必填（required） */
  default?: unknown
  map?: boolean
  keyType?: string
  valueType?: string
  array?: boolean
  elementType?: string
}

export interface StructDef {
  kind: 'struct'
  name: string
  fields: FieldDef[]
}

export type TypeDef = EnumDef | StructDef

export interface TableRow {
  [key: string]: unknown
}

export interface Table {
  /** SheetName，即文件名去掉 .json */
  name: string
  rows: TableRow[]
}

export interface Project {
  types: Map<string, TypeDef>
  tables: Table[]
}

export interface ValidationIssue {
  /** 相对工程根的文件路径 */
  file: string
  /** 定位（字段名、行号等） */
  at?: string
  message: string
}
