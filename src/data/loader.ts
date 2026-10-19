import { parseSchemas } from './schemaParser.ts'
import type { SchemaFileInput } from './schemaParser.ts'
import { parseJsonl } from './jsonl.ts'
import { sortTables, tableTypeIndex } from './types.ts'
import type { DirSource } from './dirSource.ts'
import type { Project, Table, ValidationIssue } from './types.ts'

export interface LoadResult {
  project: Project
  issues: ValidationIssue[]
}

/** 表格文件 ↔ 类型的绑定以 schema 的 tables 清单为唯一信任源；根目录 *.json 为表格数据（spec 样例即此约定） */
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

  const idx = tableTypeIndex(types)
  const tables: Table[] = []
  for (const e of rootEntries) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue
    const name = e.name.slice(0, -'.json'.length)
    const { rows, issues: jsonlIssues } = parseJsonl(await source.readFile(e.name), e.name)
    issues.push(...jsonlIssues)
    if (!idx.has(name)) {
      issues.push({ file: e.name, message: `表格 ${name} 没有对应的 struct 类型` })
    }
    tables.push({ name, rows })
  }

  // 表序：schema 分组 → 文件名字母序，页签与 Ctrl+1..9 对应关系稳定
  return { project: { types, tables: sortTables(tables, idx) }, issues }
}
