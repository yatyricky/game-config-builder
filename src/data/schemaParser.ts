import { JS_PRIMITIVE_TYPES } from './types.ts'
import type { EnumDef, FieldDef, StructDef, TypeDef, ValidationIssue } from './types.ts'

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
 * 合并解析 schema/*.json。只执行 spec 明说的校验：
 * pk 必须为 string、自定义类型名不得与 js 基础类型冲突、类型引用必须存在。
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

  // 引用校验放在合并后：类型允许跨文件、前向引用
  const checkRef = (file: string, at: string, type: string | undefined): void => {
    if (!type) {
      issues.push({ file, at, message: '缺少类型声明' })
    } else if (!SCALAR_TYPES.has(type) && !types.has(type)) {
      issues.push({ file, at, message: `引用不存在的类型 ${type}` })
    }
  }
  for (const { file, def } of structs) {
    for (const f of def.fields) {
      const at = `${def.name}.${f.name}`
      if (f.pk && f.type !== 'string') {
        issues.push({ file, at, message: 'pk 字段必须为 string' })
      }
      // 普通字段用 type；map/array 字段用各自的子类型，不要求 type
      if (!f.map && !f.array) {
        checkRef(file, at, f.type)
      }
      if (f.map) {
        checkRef(file, `${at}(key)`, f.keyType)
        checkRef(file, `${at}(value)`, f.valueType)
      }
      if (f.array) {
        checkRef(file, `${at}(element)`, f.elementType)
      }
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
    for (const m of enums) {
      if (isObj(m) && typeof m['name'] === 'string' && typeof m['value'] === 'number') {
        members.push({ name: m['name'], value: m['value'] })
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
      return null
    }
    fields.push(toField(fj))
  }
  const def: StructDef = { kind, name, fields }
  return def
}

function toField(fj: Record<string, unknown>): FieldDef {
  const f: FieldDef = {
    name: fj['name'] as string,
    type: typeof fj['type'] === 'string' ? fj['type'] : '',
  }
  if (fj['pk'] === true) f.pk = true
  if (typeof fj['displayName'] === 'string') f.displayName = fj['displayName']
  if (fj['map'] === true) f.map = true
  if (typeof fj['keyType'] === 'string') f.keyType = fj['keyType']
  if (typeof fj['valueType'] === 'string') f.valueType = fj['valueType']
  if (fj['array'] === true) f.array = true
  if (typeof fj['elementType'] === 'string') f.elementType = fj['elementType']
  return f
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
