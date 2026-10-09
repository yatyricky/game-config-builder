import { JS_PRIMITIVE_TYPES, isStringType } from './types.ts'
import type { EnumDef, FieldDef, StructDef, TypeDef, TypeNode, ValidationIssue } from './types.ts'

export interface SchemaFileInput {
  file: string
  json: unknown
}

export interface SchemaParseResult {
  types: Map<string, TypeDef>
  issues: ValidationIssue[]
}

const SCALAR_TYPES = new Set(['string', 'number', 'boolean'])

/**
 * 合并解析 schema/*.json（2026-10-09 修订为 ADT 类型节点）。只执行 spec 明说的校验：
 * pk 必须为 string、自定义类型名不得与 js 基础类型冲突、类型引用必须存在（递归节点内同样校验）。
 */
export function parseSchemas(files: SchemaFileInput[]): SchemaParseResult {
  const types = new Map<string, TypeDef>()
  const issues: ValidationIssue[] = []
  const structs: { file: string; def: StructDef }[] = []

  for (const { file, json } of files) {
    const def = toTypeDef(file, json, issues)
    if (!def) continue
    if (JS_PRIMITIVE_TYPES.has(def.name)) {
      issues.push({ file, message: `自定义类型名 ${def.name} 与 js 基础类型冲突` })
      continue
    }
    if (types.has(def.name)) {
      issues.push({ file, message: `类型 ${def.name} 重复定义` })
      continue
    }
    types.set(def.name, def)
    if (def.kind === 'struct') structs.push({ file, def })
  }

  // 引用校验放在合并后：类型允许跨文件、前向引用、递归引用（数据合法性由 JSON 本身承载）
  const checkRef = (node: TypeNode, file: string, at: string): void => {
    if ('raw' in node) {
      if (!SCALAR_TYPES.has(node.raw) && !types.has(node.raw)) {
        issues.push({ file, at, message: `引用不存在的类型 ${node.raw}` })
      }
      return
    }
    if ('array' in node) {
      checkRef(node.elementType, file, `${at}[]`)
      return
    }
    checkRef(node.keyType, file, `${at}{key}`)
    checkRef(node.valueType, file, `${at}{value}`)
  }
  for (const { file, def } of structs) {
    for (const f of def.fields) {
      const at = `${def.name}.${f.name}`
      if (f.pk && !isStringType(f.type)) {
        issues.push({ file, at, message: 'pk 字段必须为 string' })
      }
      checkRef(f.type, file, at)
    }
    // 裁决 2026-10-10：struct 必须有 pk——无 pk 不可被表格使用、不可被其他节点引用
    if (!def.fields.some(f => f.pk)) {
      issues.push({ file, at: def.name, message: `struct ${def.name} 缺少 pk 字段` })
    }
  }

  return { types, issues }
}

function toTypeDef(file: string, json: unknown, issues: ValidationIssue[]): TypeDef | null {
  if (!isObj(json)) {
    issues.push({ file, message: 'schema 根必须是对象' })
    return null
  }
  const meta = json['meta']
  if (!isObj(meta)) {
    issues.push({ file, message: '缺少 meta' })
    return null
  }
  const name = meta['name']
  const kind = meta['type']
  if (typeof name !== 'string' || (kind !== 'enum' && kind !== 'struct')) {
    issues.push({ file, message: 'meta 需要 { type: "enum" | "struct", name: string }' })
    return null
  }

  if (kind === 'enum') {
    const enums = json['enums']
    if (!Array.isArray(enums)) {
      issues.push({ file, message: `枚举 ${name} 缺少 enums 数组` })
      return null
    }
    const members = []
    const seenName = new Set<string>()
    const seenDisplayName = new Set<string>()
    const seenValue = new Set<number>()
    for (const m of enums) {
      if (isObj(m) && typeof m['name'] === 'string' && typeof m['value'] === 'number') {
        const dn = typeof m['displayName'] === 'string' ? m['displayName'] : undefined
        // 裁决 2026-10-10：成员 name/displayName/value 三重唯一
        if (seenName.has(m['name'])) {
          issues.push({ file, message: `枚举 ${name} 成员名重复：${m['name']}` })
          return null
        }
        if (dn !== undefined && dn !== '' && seenDisplayName.has(dn)) {
          issues.push({ file, message: `枚举 ${name} 成员 displayName 重复：${dn}` })
          return null
        }
        if (seenValue.has(m['value'])) {
          issues.push({ file, message: `枚举 ${name} 成员值重复：${m['value']}` })
          return null
        }
        seenName.add(m['name'])
        if (dn !== undefined && dn !== '') seenDisplayName.add(dn)
        seenValue.add(m['value'])
        members.push(dn !== undefined ? { name: m['name'], value: m['value'], displayName: dn } : { name: m['name'], value: m['value'] })
      } else {
        issues.push({ file, message: `枚举 ${name} 的成员必须是 { name: string, value: number }` })
        return null
      }
    }
    const def: EnumDef = { kind, name, flags: meta['flags'] === true, members }
    return def
  }

  const fieldsJson = json['fields']
  if (!Array.isArray(fieldsJson)) {
    issues.push({ file, message: `struct ${name} 缺少 fields 数组` })
    return null
  }
  const fields: FieldDef[] = []
  for (const fj of fieldsJson) {
    if (!isObj(fj) || typeof fj['name'] !== 'string') {
      issues.push({ file, message: `struct ${name} 的字段必须是含 name 的对象` })
      continue
    }
    const type = toTypeNode(fj['type'], file, `${name}.${fj['name'] as string}`, issues)
    if (!type) continue
    const f: FieldDef = { name: fj['name'], type }
    if (fj['pk'] === true) f.pk = true
    if (fj['index'] === true) f.index = true
    if (fj['unique'] === true) f.unique = true
    if (fj['nullable'] === true) f.nullable = true
    if (typeof fj['displayName'] === 'string') f.displayName = fj['displayName']
    if ('default' in fj) f.default = fj['default']
    if (fj['group'] === true) f.group = true
    fields.push(f)
  }
  const def: StructDef = { kind, name, fields }
  return def
}

/** 递归解析 ADT 类型节点：{raw} | {array,elementType} | {map,keyType,valueType}；无法解析时记 issue 返回 null */
function toTypeNode(v: unknown, file: string, at: string, issues: ValidationIssue[]): TypeNode | null {
  if (!isObj(v)) {
    issues.push({ file, at, message: 'type 必须是 {raw} | {array,elementType} | {map,keyType,valueType} 节点' })
    return null
  }
  if (typeof v['raw'] === 'string') return { raw: v['raw'] }
  if (v['array'] === true) {
    const el = toTypeNode(v['elementType'], file, `${at}[]`, issues)
    if (!el) return null
    return { array: true, elementType: el }
  }
  if (v['map'] === true) {
    const k = toTypeNode(v['keyType'], file, `${at}{key}`, issues)
    const val = toTypeNode(v['valueType'], file, `${at}{value}`, issues)
    if (!k || !val) return null
    return { map: true, keyType: k, valueType: val }
  }
  issues.push({ file, at, message: 'type 需要 {raw} | {array,elementType} | {map,keyType,valueType}' })
  return null
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
