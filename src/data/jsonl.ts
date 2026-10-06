import type { TableRow, ValidationIssue } from './types.ts'

export interface JsonlParseResult {
  rows: TableRow[]
  issues: ValidationIssue[]
}

export function parseJsonl(text: string, file: string): JsonlParseResult {
  const rows: TableRow[] = []
  const issues: ValidationIssue[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        issues.push({ file, at: `第 ${i + 1} 行`, message: '记录必须是 JSON 对象' })
        continue
      }
      rows.push(parsed as TableRow)
    } catch {
      issues.push({ file, at: `第 ${i + 1} 行`, message: 'JSON 解析失败' })
    }
  }
  return { rows, issues }
}
