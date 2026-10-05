// 规范化序列化（docs/04 §6 / §5.5，T2.3）。
// canonicalizeRow 是全 workspace 唯一的规范 JSONL 字符串化实现（server/CLI 一律复用）。

import type { SchemaIr, TableDef, TypeAst } from '@gcb/schema';
import { parseTypeString } from '@gcb/schema';
import type { Row, RowValue, TypedRow } from '@gcb/validate';
import { pkKindOf } from '@gcb/validate';

/** float 规范形式：必须含 . 或 e（§3.2）；-0 归一为 0 */
export function formatFloat(value: number): string {
  const v = value === 0 ? 0 : value;
  const s = String(v);
  return /[.e]/.test(s) ? s : s + '.0';
}

interface SerCtx {
  ir: SchemaIr;
  resolveAst(type: string): TypeAst | null;
}

function serialize(value: RowValue, ast: TypeAst, ctx: SerCtx): string {
  switch (ast.kind) {
    case 'primitive':
      switch (ast.name) {
        case 'bool':
          return value ? 'true' : 'false';
        case 'int':
          return String(value);
        case 'float':
          return formatFloat(value as number);
        default:
          return JSON.stringify(value);
      }
    case 'enum':
    case 'ref':
      return typeof value === 'number' ? String(value) : JSON.stringify(value);
    case 'struct': {
      const structDef = ctx.ir.structs[ast.structName];
      if (structDef === undefined) return '{}';
      const parts: string[] = [];
      for (const field of structDef.fields) {
        const fast = ctx.resolveAst(field.type);
        const v = (value as Row)[field.name];
        if (fast === null || v === undefined) continue;
        parts.push(`${JSON.stringify(field.name)}:${serialize(v, fast, ctx)}`);
      }
      return `{${parts.join(',')}}`;
    }
    case 'list':
      return `[${(value as RowValue[]).map((v) => serialize(v, ast.element, ctx)).join(',')}]`;
    case 'map': {
      const keyKind = ast.key;
      const entries = [...(value as Map<string | number, RowValue>).entries()].map(([k, v]) => ({
        key: typeof k === 'number' ? String(k) : k,
        value: v,
      }));
      entries.sort((a, b) => {
        if (a.key === b.key) return 0;
        if (keyKind === 'int') return Number(a.key) - Number(b.key);
        return a.key < b.key ? -1 : 1;
      });
      return `{${entries.map((e) => `${JSON.stringify(e.key)}:${serialize(e.value, ast.element, ctx)}`).join(',')}}`;
    }
    case 'union': {
      const unionDef = ctx.ir.unions[ast.unionName];
      if (unionDef === undefined) return '{}';
      const obj = value as Record<string, RowValue>;
      const rawTag = obj[unionDef.tag];
      const variantName = typeof rawTag === 'string' ? rawTag : '';
      const variant = unionDef.variants.find((v) => v.name === variantName);
      const variantStruct = variant ? ctx.ir.structs[variant.struct] : undefined;
      const parts: string[] = [`${JSON.stringify(unionDef.tag)}:${JSON.stringify(variantName)}`];
      if (variantStruct !== undefined) {
        const inner = obj['value'] as Row | undefined;
        const subParts: string[] = [];
        for (const field of variantStruct.fields) {
          const fast = ctx.resolveAst(field.type);
          const v = inner === undefined ? undefined : inner[field.name];
          if (fast === null || v === undefined) continue;
          subParts.push(`${JSON.stringify(field.name)}:${serialize(v, fast, ctx)}`);
        }
        parts.push(`"value":{${subParts.join(',')}}`);
      }
      return `{${parts.join(',')}}`;
    }
  }
}

function makeSerCtx(ir: SchemaIr): SerCtx {
  const cache = new Map<string, TypeAst | null>();
  return {
    ir,
    resolveAst(type: string): TypeAst | null {
      const hit = cache.get(type);
      if (hit !== undefined) return hit;
      const parsed = parseTypeString(type);
      const ast = parsed.ok ? parsed.ast : null;
      cache.set(type, ast);
      return ast;
    },
  };
}

/**
 * 规范 JSONL 行：默认值填充后的完整行对象，键序 = schema 字段序（嵌套同理），
 * map 键 int 数值序 / string 码点序（§5.5 唯一实现点）。
 */
export function canonicalizeRow(table: TableDef, ir: SchemaIr, row: Row): string {
  const ctx = makeSerCtx(ir);
  const parts: string[] = [];
  for (const field of table.fields) {
    const ast = ctx.resolveAst(field.type);
    const value = row[field.name];
    if (ast === null || value === undefined) continue;
    parts.push(`${JSON.stringify(field.name)}:${serialize(value, ast, ctx)}`);
  }
  return `{${parts.join(',')}}`;
}

/** 整表规范化：主键排序（int 数值序 / string 码点序）+ 逐行 canonicalize + 尾换行；空表 = 空串 */
export function normalizeTable(table: TableDef, ir: SchemaIr, rows: TypedRow[]): string {
  const kind = pkKindOf(table);
  const sorted = [...rows].sort((a, b) => {
    if (a.pk === b.pk) return 0;
    if (kind === 'int') return Number(a.pk) - Number(b.pk);
    return a.pk < b.pk ? -1 : 1;
  });
  if (sorted.length === 0) return '';
  return sorted.map((r) => canonicalizeRow(table, ir, r.row)).join('\n') + '\n';
}
