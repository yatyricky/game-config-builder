// JSON target（docs/04 §8.2）：每表一个 { table, primaryKey, rows }，2 空格缩进。
// enum → int；ref → 原值；union → { "<tag>": "<Variant>", "value": {...} }；键序 = schema 字段序。

import { parseTypeString } from '@gcb/schema';
import type { SchemaIr, TableDef, TypeAst } from '@gcb/schema';
import type { Row, RowValue, TypedRow } from '@gcb/validate';
import type { ExportContext, OutputFile, TargetPlugin } from './plugin.js';

function toPlain(value: RowValue, ast: TypeAst, ir: SchemaIr): unknown {
  switch (ast.kind) {
    case 'primitive':
    case 'ref':
      return value;
    case 'enum': {
      const enumDef = ir.enums[ast.enumName];
      if (enumDef === undefined || typeof value !== 'string') return value;
      const member = enumDef.values.find((v) => v.name === value);
      return member ? member.value : value;
    }
    case 'struct': {
      const structDef = ir.structs[ast.structName];
      const out: Record<string, unknown> = {};
      if (structDef === undefined) return out;
      for (const field of structDef.fields) {
        const ast2 = parseTypeString(field.type);
        if (!ast2.ok) continue;
        out[field.name] = toPlain((value as Row)[field.name] as RowValue, ast2.ast, ir);
      }
      return out;
    }
    case 'list':
      return (value as RowValue[]).map((v) => toPlain(v, ast.element, ir));
    case 'map': {
      const entries = [...(value as Map<string | number, RowValue>).entries()];
      entries.sort((a, b) => {
        if (a[0] === b[0]) return 0;
        return ast.key === 'int' ? Number(a[0]) - Number(b[0]) : a[0] < b[0] ? -1 : 1;
      });
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) out[String(k)] = toPlain(v, ast.element, ir);
      return out;
    }
    case 'union': {
      const unionDef = ir.unions[ast.unionName];
      const obj = value as Record<string, RowValue>;
      const out: Record<string, unknown> = {};
      if (unionDef === undefined) return out;
      out[unionDef.tag] = obj[unionDef.tag];
      const variantName = obj[unionDef.tag];
      const variant =
        typeof variantName === 'string'
          ? unionDef.variants.find((v) => v.name === variantName)
          : undefined;
      const variantStruct = variant ? ir.structs[variant.struct] : undefined;
      const inner: Record<string, unknown> = {};
      if (variantStruct !== undefined) {
        const structValue = obj['value'] as Row;
        for (const field of variantStruct.fields) {
          const ast2 = parseTypeString(field.type);
          if (!ast2.ok) continue;
          inner[field.name] = toPlain(structValue[field.name] as RowValue, ast2.ast, ir);
        }
      }
      out['value'] = inner;
      return out;
    }
  }
}

function tableJson(table: TableDef, rows: TypedRow[], ir: SchemaIr): string {
  const plainRows = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of table.fields) {
      const parsed = parseTypeString(field.type);
      if (!parsed.ok) continue;
      out[field.name] = toPlain(row.row[field.name] as RowValue, parsed.ast, ir);
    }
    return out;
  });
  return (
    JSON.stringify({ table: table.name, primaryKey: table.primaryKey, rows: plainRows }, null, 2) +
    '\n'
  );
}

export const jsonTarget: TargetPlugin = {
  name: 'json',
  generate(ctx: ExportContext): OutputFile[] {
    const files: OutputFile[] = [];
    for (const tableName of Object.keys(ctx.ir.tables).sort()) {
      const table = ctx.ir.tables[tableName];
      if (table === undefined) continue;
      const rows = ctx.tables.get(tableName) ?? [];
      files.push({ path: `json/${tableName}.json`, content: tableJson(table, rows, ctx.ir) });
    }
    return files;
  },
};
