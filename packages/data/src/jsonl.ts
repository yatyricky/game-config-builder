// JSONL 逐行解析（docs/04 §6，T2.1）。坏行不中断整表——错误逐条收集。

import type { ValidationError } from '@gcb/schema';
import type { RawRow } from '@gcb/validate';

export interface JsonlParseResult {
  rows: RawRow[];
  errors: ValidationError[];
}

/** content 为文件全文；空文件 = 0 行合法；文件尾恰好一个换行符由写入方保证，此处容忍 */
export function parseJsonl(tableName: string, content: string): JsonlParseResult {
  const rows: RawRow[] = [];
  const errors: ValidationError[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (trimmed === '') continue; // 空行（含文件尾换行产生的最后空串）跳过
    try {
      rows.push({ json: JSON.parse(trimmed), line: lineNo });
    } catch (err) {
      const brief = err instanceof Error ? err.message.split('\n')[0] : String(err);
      errors.push({
        table: tableName,
        rowKey: '',
        fieldPath: '',
        ruleId: 'data.jsonl.parse',
        severity: 'error',
        message: `第 ${lineNo} 行不是合法 JSON：${brief}`,
      });
    }
  }
  return { rows, errors };
}
