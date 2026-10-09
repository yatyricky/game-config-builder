import { JS_PRIMITIVE_TYPES } from './types.ts'
import type { EnumDef, FieldDef, Project, StructDef, TableRow, TypeDef, TypeNode } from './types.ts'
import { compactRows } from './save.ts'

// ---- 校验（返回 null=通过，否则错误消息；供弹窗红框与测试共用） ----

export function validateTypeName(name: string, types: Map<string, TypeDef>): string | null {
  const n = name.trim()
  if (n === '') return '名称不能为空'
  if (n !== name) return '名称首尾不能有空白'
  if (JS_PRIMITIVE_TYPES.has(n)) return `名称 ${n} 与 js 基础类型冲突`
  if (types.has(n)) return `类型 ${n} 已存在`
  return null
}

export function validateFieldName(name: string, def: StructDef, originalName: string | null): string | null {
  const n = name.trim()
  if (n === '') return '名称不能为空'
  if (n !== name) return '名称首尾不能有空白'
  const dup = def.fields.some(f => f.name === n && f.name !== originalName)
  if (dup) return `字段 ${n} 已存在`
  return null
}

export function validateMemberName(name: string, def: EnumDef, originalName: string | null): string | null {
  const n = name.trim()
  if (n === '') return '名称不能为空'
  if (n !== name) return '名称首尾不能有空白'
  const dup = def.members.some(m => m.name === n && m.name !== originalName)
  if (dup) return `成员 ${n} 已存在`
  return null
}

/** displayName 可选：非空时不得与本枚举其他成员的 displayName 重复 */
export function validateMemberDisplayName(dn: string, def: EnumDef, originalName: string | null): string | null {
  const n = dn.trim()
  if (n === '') return null
  const dup = def.members.some(m => m.displayName === n && m.name !== originalName)
  if (dup) return `displayName ${n} 已存在`
  return null
}

export function validateMemberValue(valueStr: string, def: EnumDef, originalName: string | null): string | null {
  if (valueStr.trim() === '') return '值不能为空'
  const v = Number(valueStr)
  if (!Number.isFinite(v) || !Number.isInteger(v)) return '值必须是整数'
  const dup = def.members.some(m => m.value === v && m.name !== originalName)
  if (dup) return `值 ${v} 已存在`
  return null
}

// ---- 判定（防呆矩阵） ----

/** 字段在表格数据中被使用：任意行存在该键且值非 undefined（数据里 undefined 键视同未用） */
export function fieldUsedInData(rows: readonly TableRow[], fieldName: string): boolean {
  return rows.some(r => r[fieldName] !== undefined)
}

/** 类型被其他节点引用（字段类型树内任意深度 raw 引用；自引用不算"他节点"） */
export function typeReferenced(types: Map<string, TypeDef>, name: string): boolean {
  const refs = (node: TypeNode, out: Set<string>): void => {
    if ('raw' in node) {
      out.add(node.raw)
      return
    }
    if ('array' in node) {
      refs(node.elementType, out)
      return
    }
    refs(node.keyType, out)
    refs(node.valueType, out)
  }
  for (const [tname, def] of types) {
    if (tname === name || def.kind !== 'struct') continue
    for (const f of def.fields) {
      const out = new Set<string>()
      refs(f.type, out)
      if (out.has(name)) return true
    }
  }
  return false
}

/** 类型有数据：存在同名表且压缩后非 0 行 */
export function typeHasData(project: Project, name: string): boolean {
  const t = project.tables.find(x => x.name === name)
  return !!t && compactRows(t.rows).length > 0
}

export function canDeleteType(project: Project, name: string): boolean {
  return !typeReferenced(project.types, name) && !typeHasData(project, name)
}

export function canDeleteField(rows: readonly TableRow[], fieldName: string): boolean {
  return !fieldUsedInData(rows, fieldName)
}

export function canEditFieldType(rows: readonly TableRow[], fieldName: string): boolean {
  return !fieldUsedInData(rows, fieldName)
}

export interface PkLockState {
  /** 被锁（disabled）与锁定原因（null=可切换） */
  locked: boolean
  reason: string | null
}

export function pkLockState(def: StructDef, field: FieldDef, project: Project): PkLockState {
  if (def.fields.some(f => f.pk && f.name !== field.name)) {
    return { locked: true, reason: '本类型已有其他 pk 字段' }
  }
  if (!('raw' in field.type) || field.type.raw !== 'string') {
    return { locked: true, reason: 'pk 字段类型必须为 string' }
  }
  const name = def.name
  if (typeReferenced(project.types, name)) {
    return { locked: true, reason: '本类型已被其他类型引用，pk 不可变更' }
  }
  if (project.tables.some(t => t.name === name)) {
    return { locked: true, reason: '本类型存在同名表格数据，pk 不可变更' }
  }
  return { locked: false, reason: null }
}

// ---- flags / 枚举值规则 ----

export function isPowersOfTwo(members: readonly { value: number }[]): boolean {
  return members.every(m => m.value > 0 && (m.value & (m.value - 1)) === 0)
}

/** flags 切换：被使用且值非 2^n 序列 → 不可勾选；其他自由（裁决 2026-10-10） */
export function canToggleFlags(def: EnumDef, isUsed: boolean): boolean {
  if (!isUsed) return true
  return isPowersOfTwo(def.members)
}

/** 新增值：flags → 前值×2（首=1）；非 flags → 前值+1（首=0，可手改） */
export function nextEnumValue(members: readonly { value: number }[], flags: boolean): number {
  if (members.length === 0) return flags ? 1 : 0
  const last = members[members.length - 1]?.value ?? 0
  return flags ? last * 2 : last + 1
}

export const ENUM_MAX_FLAGS_MEMBERS = 30

/** 成员值被任何表数据使用（直连 raw<枚举> 字段；容器内嵌套引用不扫，注释留痕） */
export function memberValueUsed(project: Project, enumName: string, value: number): boolean {
  for (const def of project.types.values()) {
    if (def.kind !== 'struct') continue
    for (const f of def.fields) {
      if (!('raw' in f.type) || f.type.raw !== enumName) continue
      const table = project.tables.find(t => t.name === def.name)
      if (!table) continue
      if (table.rows.some(r => r[f.name] === value)) return true
    }
  }
  return false
}

// ---- CRUD（不可变） ----

/** pk→index→unique 强制链 */
function normalizeAttrs(f: FieldDef): FieldDef {
  const next = { ...f }
  if (next.pk) {
    next.index = true
    next.unique = true
  } else if (next.index) {
    next.unique = true
  }
  if (!next.pk) delete next.pk
  if (!next.index) delete next.index
  if (!next.unique) delete next.unique
  if (!next.nullable) delete next.nullable
  if (!next.group) delete next.group
  return next
}

export interface FieldPatch {
  name: string
  displayName?: string
  type?: TypeNode
  pk?: boolean
  index?: boolean
  unique?: boolean
  nullable?: boolean
  group?: boolean
  default?: unknown
  hasDefault?: boolean
}

/** 更新字段（按 name 定位原字段；normalize 强制链；default 按 hasDefault 决定去留） */
export function updateField(def: StructDef, originalName: string, p: FieldPatch): StructDef {
  const fields = def.fields.map(f => {
    if (f.name !== originalName) return f
    const next: FieldDef = { name: p.name, type: p.type ?? f.type }
    if (p.pk) next.pk = true
    if (p.index || p.pk) next.index = true
    if (p.unique || p.index || p.pk) next.unique = true
    if (p.nullable) next.nullable = true
    if (p.group) next.group = true
    if (typeof p.displayName === 'string' && p.displayName.trim() !== '') next.displayName = p.displayName.trim()
    if (p.hasDefault === true) next.default = p.default
    return normalizeAttrs(next)
  })
  return { ...def, fields }
}

export function addField(def: StructDef, p: FieldPatch): StructDef {
  const f: FieldDef = { name: p.name, type: p.type ?? { raw: 'string' } }
  if (p.pk) f.pk = true
  if (p.index || p.pk) f.index = true
  if (p.unique || p.index || p.pk) f.unique = true
  if (p.nullable) f.nullable = true
  if (p.group) f.group = true
  if (typeof p.displayName === 'string' && p.displayName.trim() !== '') f.displayName = p.displayName.trim()
  if (p.hasDefault === true) f.default = p.default
  return { ...def, fields: [...def.fields, normalizeAttrs(f)] }
}

export function removeField(def: StructDef, fieldName: string): StructDef {
  return { ...def, fields: def.fields.filter(f => f.name !== fieldName) }
}

/** 字段改名级联数据键：目标键已存在 → conflict（调用方阻止保存，防合并污染） */
export function renameFieldCascade(rows: readonly TableRow[], oldName: string, newName: string): { rows: TableRow[]; conflict: boolean } {
  const conflict = rows.some(r => r[newName] !== undefined && r[oldName] !== undefined)
  const next = rows.map(r => {
    if (!(oldName in r)) return r
    const copy: TableRow = { ...r }
    delete copy[oldName]
    copy[newName] = r[oldName]
    return copy
  })
  return { rows: next, conflict }
}

export interface MemberPatch {
  name: string
  displayName?: string
  value: number
}

export function updateMember(def: EnumDef, originalName: string, p: MemberPatch): EnumDef {
  const members = def.members.map(m => {
    if (m.name !== originalName) return m
    const next: typeof m = { name: p.name, value: p.value }
    if (p.displayName && p.displayName.trim() !== '') next.displayName = p.displayName.trim()
    return next
  })
  return { ...def, members }
}

export function addMember(def: EnumDef, p: MemberPatch): EnumDef {
  const m: EnumDef['members'][number] = { name: p.name, value: p.value }
  if (p.displayName && p.displayName.trim() !== '') m.displayName = p.displayName.trim()
  return { ...def, members: [...def.members, m] }
}

export function removeMember(def: EnumDef, memberName: string): EnumDef {
  return { ...def, members: def.members.filter(m => m.name !== memberName) }
}

// ---- 类型级 ----

export function createStructType(name: string): StructDef {
  return { kind: 'struct', name, fields: [{ name: 'ID', type: { raw: 'string' }, pk: true, index: true, unique: true }] }
}

export function createEnumType(name: string, flags: boolean): EnumDef {
  return { kind: 'enum', name, flags, members: [] }
}

/** 新字段缺省名：field<N>（N 取首个不冲突序号） */
export function nextFieldName(def: StructDef): string {
  let i = 1
  while (def.fields.some(f => f.name === `field${i}`)) i++
  return `field${i}`
}

// ---- 序列化（4 空格缩进，与 sample 一致；键序固定） ----

function typeNodeToJson(node: TypeNode): Record<string, unknown> {
  if ('raw' in node) return { raw: node.raw }
  if ('array' in node) return { array: true, elementType: typeNodeToJson(node.elementType) }
  return { map: true, keyType: typeNodeToJson(node.keyType), valueType: typeNodeToJson(node.valueType) }
}

function fieldToJson(f: FieldDef): Record<string, unknown> {
  const o: Record<string, unknown> = { name: f.name, type: typeNodeToJson(f.type) }
  if (f.pk) o['pk'] = true
  if (f.index) o['index'] = true
  if (f.unique) o['unique'] = true
  if (f.nullable) o['nullable'] = true
  if (f.displayName) o['displayName'] = f.displayName
  if (f.default !== undefined) o['default'] = f.default
  if (f.group) o['group'] = true
  return o
}

export function serializeStruct(def: StructDef): string {
  const json = { meta: { type: 'struct', name: def.name }, fields: def.fields.map(fieldToJson) }
  return JSON.stringify(json, null, 4) + '\n'
}

export function serializeEnum(def: EnumDef): string {
  const meta: Record<string, unknown> = { type: 'enum', name: def.name }
  if (def.flags) meta['flags'] = true
  const members = def.members.map(m => {
    const o: Record<string, unknown> = { name: m.name, value: m.value }
    if (m.displayName) o['displayName'] = m.displayName
    return o
  })
  return JSON.stringify({ meta, enums: members }, null, 4) + '\n'
}
