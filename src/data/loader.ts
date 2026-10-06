import { parseSchemas } from './schemaParser.ts'
import type { SchemaFileInput } from './schemaParser.ts'
import { parseJsonl } from './jsonl.ts'
import type { DirSource } from './dirSource.ts'
import type { Project, Table, ValidationIssue } from './types.ts'

export interface LoadResult {
  project: Project
  issues: ValidationIssue[]
}

/** 表名即类型名：工程根目录 X.json 是类型 X 的表格（spec 样例即此约定） */
export async function loadProject(source: DirSource): Promise<LoadResult> {
  const issues: ValidationIssue[] = []
  const rootEntries = await source.listDir('.')

  const schemaInputs: SchemaFileInput[] = []
  const hasSchemaDir = rootEntries.some(e => e.kind === 'dir' && e.name === 'schema')
  if (hasSchemaDir) {
    for (const e of await source.listDir('schema')) {
      if (e.kind !== 'file' || !e.name.endsWith('.json')) continue
      const file = `schema/${e.name}`
      try {
        schemaInputs.push({ file, json: JSON.parse(await source.readFile(file)) })
      } catch {
        issues.push({ file, message: 'JSON 解析失败' })
      }
    }
  } else {
    issues.push({ file: '.', message: '缺少 schema/ 目录' })
  }

  const { types, issues: schemaIssues } = parseSchemas(schemaInputs)
  issues.push(...schemaIssues)

  // 根目录 *.json 为表格；schema/、export/ 是目录，天然不参与
  const tables: Table[] = []
  for (const e of rootEntries) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue
    const name = e.name.slice(0, -'.json'.length)
    const { rows, issues: jsonlIssues } = parseJsonl(await source.readFile(e.name), e.name)
    issues.push(...jsonlIssues)
    const def = types.get(name)
    if (!def) {
      issues.push({ file: e.name, message: `表格 ${name} 没有对应的 struct 类型` })
    } else if (def.kind !== 'struct') {
      issues.push({ file: e.name, message: `表格类型 ${name} 是枚举，不能作为表格` })
    }
    tables.push({ name, rows })
  }

  return { project: { types, tables }, issues }
}
