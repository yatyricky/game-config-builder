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

/**
 * ADT 类型节点（2026-10-09 修订）：raw 引用标量或命名类型（enum/struct 均可，递归引用合法）；
 * array/map 可无限嵌套，如 map<string, array<map<string, array<number>>>>
 */
export type TypeNode =
  | { raw: string }
  | { array: true; elementType: TypeNode }
  | { map: true; keyType: TypeNode; valueType: TypeNode }

/** 递归类型标签（网格/剪贴板/设置卡片共用）：map<Effect,number>、array<map<string,number>> */
export function typeNodeLabel(node: TypeNode): string {
  if ('raw' in node) return node.raw
  if ('array' in node) return `array<${typeNodeLabel(node.elementType)}>`
  return `map<${typeNodeLabel(node.keyType)},${typeNodeLabel(node.valueType)}>`
}

/** 字段是否为顶层 string（M5 起 string 列可编辑，其余 NotImplemented） */
export function isStringType(node: TypeNode): boolean {
  return 'raw' in node && node.raw === 'string'
}

export interface EnumMember {
  name: string
  value: number
  displayName?: string
}

export interface EnumDef {
  kind: 'enum'
  name: string
  flags: boolean
  members: EnumMember[]
}

export interface FieldDef {
  name: string
  type: TypeNode
  pk?: boolean
  /** 查询索引元数据（pk 强制勾选）；无运行时行为（裁决 2026-10-10） */
  index?: boolean
  /** 唯一性约束：index/pk 强制勾选；保存数据时查重阻止（裁决 2026-10-10） */
  unique?: boolean
  /** 勾选后允许不填（裁决 2026-10-10：必填 = 无 default 且未 nullable） */
  nullable?: boolean
  displayName?: string
  /** spec（2026-10-08 增补）：可带 default 属性 */
  default?: unknown
  /** 分组标记，纯元数据（裁决 2026-10-10） */
  group?: boolean
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
