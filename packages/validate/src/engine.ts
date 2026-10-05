// 校验引擎（docs/04 §5.1 管线，T3.4/T3.5）
// validateFull = 类型化 → 主键/唯一 → 规则（DSL）→ FK 存在性 → 汇总

import { parseTypeString } from '@gcb/schema';
import type { FieldDef, SchemaIr, TableDef, TypeAst, ValidationError } from '@gcb/schema';
import type { RawRow, TypedRow } from './rows.js';
import { typeRows } from './rows.js';
import { checkKeys } from './keys.js';
import { buildRuleScope, compileRule } from './dsl.js';

export type RawRowsByTable = Map<string, RawRow[]>;
export type TypedRowsByTable = Map<string, TypedRow[]>;

function engineError(
  table: string,
  rowKey: string,
  fieldPath: string,
  ruleId: string,
  severity: 'error' | 'warning',
  message: string,
): ValidationError {
  return { table, rowKey, fieldPath, ruleId, severity, message };
}

/** 解析单个类型字符串（缓存） */
const astCache = new Map<string, TypeAst | null>();
export function resolveFieldAst(type: string): TypeAst | null {
  const hit = astCache.get(type);
  if (hit !== undefined) return hit;
  const parsed = parseTypeStringSafe(type);
  astCache.set(type, parsed);
  return parsed;
}

function parseTypeStringSafe(type: string): TypeAst | null {
  const parsed = parseTypeString(type);
  return parsed.ok ? parsed.ast : null;
}

/** §5.1 全量校验：输入为各表原始 JSONL 行 */
export function validateFull(ir: SchemaIr, rawByTable: RawRowsByTable): ValidationError[] {
  const errors: ValidationError[] = [];
  const typedByTable: TypedRowsByTable = new Map();

  for (const [name, raw] of rawByTable) {
    const table = ir.tables[name];
    if (table === undefined) continue;
    const typed = typeRows(table, ir, raw);
    typedByTable.set(name, typed.rows);
    errors.push(...typed.errors, ...checkKeys(table, typed.rows));
  }

  for (const table of Object.values(ir.tables)) {
    const rows = typedByTable.get(table.name) ?? [];
    runTableRules(ir, table, rows, errors);
  }

  errors.push(...checkForeignKeys(ir, typedByTable));
  return errors;
}

/** 规则求值（T3.4）：字段 rule（error）+ rowRules（声明 severity + 消息模板） */
function runTableRules(
  ir: SchemaIr,
  table: TableDef,
  rows: TypedRow[],
  errors: ValidationError[],
): void {
  if (rows.length === 0) return;
  const scope = buildRuleScope(table, ir);

  interface CompiledFieldRule {
    expr: string;
    field: FieldDef;
    evaluate: (row: TypedRow) => { violated: boolean; detail?: string };
  }
  const fieldRules: CompiledFieldRule[] = [];
  for (const field of table.fields) {
    if (field.rule === undefined) continue;
    const compiled = compileRule(field.rule, scope);
    if (!compiled.ok) {
      errors.push(
        engineError(
          table.name,
          '',
          field.name,
          'rule.compile',
          'error',
          `字段「${field.name}」的规则「${field.rule}」无法编译：${compiled.error}`,
        ),
      );
      continue;
    }
    const evaluate = compiled.rule.evaluate;
    fieldRules.push({ expr: field.rule, field, evaluate: (r) => evaluate(r.row, pkOf(r)) });
  }

  interface CompiledRowRule {
    id: string;
    severity: 'error' | 'warning';
    message?: string;
    evaluate: (row: TypedRow) => { violated: boolean; detail?: string };
  }
  const rowRules: CompiledRowRule[] = [];
  for (const rule of table.rowRules ?? []) {
    const compiled = compileRule(rule.rule, scope);
    if (!compiled.ok) {
      errors.push(
        engineError(
          table.name,
          '',
          '',
          'rule.compile',
          'error',
          `rowRule「${rule.id}」无法编译：${compiled.error}`,
        ),
      );
      continue;
    }
    const evaluate = compiled.rule.evaluate;
    const entry: CompiledRowRule = {
      id: rule.id,
      severity: rule.severity ?? 'error',
      evaluate: (r) => evaluate(r.row, pkOf(r)),
    };
    if (rule.message !== undefined) entry.message = rule.message;
    rowRules.push(entry);
  }

  for (const row of rows) {
    for (const rule of fieldRules) {
      const result = rule.evaluate(row);
      if (!result.violated) continue;
      errors.push(
        engineError(
          table.name,
          row.pk,
          rule.field.name,
          'rule.field',
          'error',
          `字段「${rule.field.name}」不满足规则「${rule.expr}」${result.detail !== undefined ? `（${result.detail}）` : ''}`,
        ),
      );
    }
    for (const rule of rowRules) {
      const result = rule.evaluate(row);
      if (!result.violated) continue;
      const template = rule.message ?? `规则「${rule.id}」未满足`;
      errors.push(
        engineError(
          table.name,
          row.pk,
          '',
          `rule.row:${rule.id}`,
          rule.severity,
          applyTemplate(template, row) +
            (result.detail !== undefined ? `（${result.detail}）` : ''),
        ),
      );
    }
  }
}

function pkOf(row: TypedRow): string | number {
  return /^-?\d+$/.test(row.pk) ? Number(row.pk) : row.pk;
}

function applyTemplate(template: string, row: TypedRow): string {
  return template.replace(/\{([A-Za-z0-9_.]+)\}/g, (_m, name: string) => {
    const value = row.row[name];
    if (value === undefined) return `{${name}}`;
    return typeof value === 'string' ? value : String(value);
  });
}

// ---------- FK 存在性（T3.5，§5.4） ----------

/** 遍历一行中全部 ref 值（含 struct/list/map/union 嵌套），对每个引用调用 visit */
export function walkRefs(
  ir: SchemaIr,
  table: TableDef,
  row: TypedRow,
  visit: (target: string, targetPk: string, fieldPath: string) => void,
): void {
  const walk = (value: unknown, ast: TypeAst, path: string): void => {
    if (value === undefined) return;
    switch (ast.kind) {
      case 'ref': {
        const pk =
          typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
        if (pk !== '') visit(ast.tableName, pk, path);
        return;
      }
      case 'struct': {
        const structDef = ir.structs[ast.structName];
        if (
          structDef === undefined ||
          value === null ||
          typeof value !== 'object' ||
          value instanceof Map
        ) {
          return;
        }
        for (const field of structDef.fields) {
          const fast = resolveFieldAst(field.type);
          if (fast !== null)
            walk((value as Record<string, unknown>)[field.name], fast, `${path}.${field.name}`);
        }
        return;
      }
      case 'list':
        if (Array.isArray(value))
          value.forEach((item, i) => walk(item, ast.element, `${path}.${i}`));
        return;
      case 'map':
        if (value instanceof Map) {
          for (const [key, item] of value) walk(item, ast.element, `${path}.${String(key)}`);
        }
        return;
      case 'union': {
        const unionDef = ir.unions[ast.unionName];
        if (
          unionDef === undefined ||
          value === null ||
          typeof value !== 'object' ||
          value instanceof Map
        )
          return;
        const obj = value as Record<string, unknown>;
        const variantName = obj[unionDef.tag];
        const variant =
          typeof variantName === 'string'
            ? unionDef.variants.find((v) => v.name === variantName)
            : undefined;
        const variantStruct = variant ? ir.structs[variant.struct] : undefined;
        if (variantStruct === undefined) return;
        const inner = obj['value'];
        if (inner === null || typeof inner !== 'object' || inner instanceof Map) return;
        for (const field of variantStruct.fields) {
          const fast = resolveFieldAst(field.type);
          if (fast !== null)
            walk(
              (inner as Record<string, unknown>)[field.name],
              fast,
              `${path}.value.${field.name}`,
            );
        }
        return;
      }
      default:
        return;
    }
  };
  for (const field of table.fields) {
    const ast = resolveFieldAst(field.type);
    if (ast !== null) walk(row.row[field.name], ast, field.name);
  }
}

/** FK 存在性：先收全库主键集合（两遍法），再查所有引用——同表自引用与环状 schema 天然安全 */
export function checkForeignKeys(ir: SchemaIr, typedByTable: TypedRowsByTable): ValidationError[] {
  const errors: ValidationError[] = [];
  const pkSets = new Map<string, Set<string>>();
  for (const [name, rows] of typedByTable) {
    pkSets.set(name, new Set(rows.map((r) => r.pk).filter((p) => p !== '')));
  }
  for (const [name, rows] of typedByTable) {
    const table = ir.tables[name];
    if (table === undefined) continue;
    for (const row of rows) {
      walkRefs(ir, table, row, (target, targetPk, fieldPath) => {
        const set = pkSets.get(target);
        if (set !== undefined && !set.has(targetPk)) {
          errors.push(
            engineError(
              name,
              row.pk,
              fieldPath,
              'fk.missing',
              'error',
              `引用的目标不存在：${target}#${targetPk}`,
            ),
          );
        }
      });
    }
  }
  return errors;
}
