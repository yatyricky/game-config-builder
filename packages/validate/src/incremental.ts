// 增量校验（docs/04 §5.6，T3.7）
// 编辑器端单行变更 ≤ 5ms（10⁵ 行规模）：依赖调用方维护的 IncrementalIndex（可选第 4 参，
// 缺省时每次调用重建——慢路径仅用于测试/一次性场景）。

import type { SchemaIr, TableDef, TypeAst, ValidationError } from '@gcb/schema';
import type { Row, TypedRow } from './rows.js';
import { buildRuleScope, compileRule } from './dsl.js';
import { resolveFieldAst } from './engine.js';

export interface ChangeSet {
  table: string;
  /** 受影响行的主键规范字符串 */
  keys: string[];
}

interface RefHit {
  fromTable: string;
  fromPk: string;
  fieldPath: string;
  target: string;
  targetPk: string;
}

/** 编辑器长驻的反向索引：pk 集合、行定位、引用入边、unique 计数 */
export interface IncrementalIndex {
  pkSets: Map<string, Set<string>>;
  byPk: Map<string, Map<string, TypedRow>>;
  pkCounts: Map<string, Map<string, number>>;
  /** `${table}:${field}` → 值 → 行数（unique 字段） */
  uniqueCounts: Map<string, Map<string, number>>;
  /** `${toTable}\u0000${targetPk}` → 引用命中列表 */
  refIndex: Map<string, RefHit[]>;
  /** `${fromTable}\u0000${fromPk}` → 该行产生的引用命中（用于移除） */
  refByRow: Map<string, RefHit[]>;
  upsertRow(table: TableDef, row: TypedRow, previous?: TypedRow): void;
  removeRow(table: TableDef, row: TypedRow): void;
}

export function buildIndex(ir: SchemaIr, rowsByTable: Map<string, TypedRow[]>): IncrementalIndex {
  const index: IncrementalIndex = {
    pkSets: new Map(),
    byPk: new Map(),
    pkCounts: new Map(),
    uniqueCounts: new Map(),
    refIndex: new Map(),
    refByRow: new Map(),
    upsertRow(table, row, previous) {
      // previous = 变更前的行快照（unique/引用按旧值清理；pk 未变时省略亦可）
      removeRowFromIndex(index, table, row.pk, previous ?? row);
      addRowToIndex(index, ir, table, row);
    },
    removeRow(table, row) {
      removeRowFromIndex(index, table, row.pk, row);
    },
  };
  for (const table of Object.values(ir.tables)) {
    index.pkSets.set(table.name, new Set());
    index.byPk.set(table.name, new Map());
    index.pkCounts.set(table.name, new Map());
    for (const field of table.fields) {
      if (field.unique === true) index.uniqueCounts.set(`${table.name}:${field.name}`, new Map());
    }
  }
  for (const [name, rows] of rowsByTable) {
    const table = ir.tables[name];
    if (table === undefined) continue;
    for (const row of rows) addRowToIndex(index, ir, table, row);
  }
  return index;
}

function rowUniqueValues(table: TableDef, row: TypedRow): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const field of table.fields) {
    if (field.unique !== true) continue;
    const raw = row.row[field.name];
    if (typeof raw === 'number' || typeof raw === 'string') out.push([field.name, String(raw)]);
  }
  return out;
}

function addRowToIndex(
  index: IncrementalIndex,
  ir: SchemaIr,
  table: TableDef,
  row: TypedRow,
): void {
  if (row.pk === '') return;
  index.pkSets.get(table.name)?.add(row.pk);
  index.byPk.get(table.name)?.set(row.pk, row);
  const counts = index.pkCounts.get(table.name);
  if (counts !== undefined) counts.set(row.pk, (counts.get(row.pk) ?? 0) + 1);
  for (const [fieldName, valueKey] of rowUniqueValues(table, row)) {
    const map = index.uniqueCounts.get(`${table.name}:${fieldName}`);
    if (map !== undefined) map.set(valueKey, (map.get(valueKey) ?? 0) + 1);
  }
  const hits: RefHit[] = [];
  walkRefsForIndex(ir, table, row, (target, targetPk, fieldPath) => {
    const hit: RefHit = { fromTable: table.name, fromPk: row.pk, fieldPath, target, targetPk };
    hits.push(hit);
    const key = `${target}\u0000${targetPk}`;
    const list = index.refIndex.get(key) ?? [];
    list.push(hit);
    index.refIndex.set(key, list);
  });
  if (hits.length > 0) index.refByRow.set(`${table.name}\u0000${row.pk}`, hits);
}

function removeRowFromIndex(
  index: IncrementalIndex,
  table: TableDef,
  pk: string,
  row: TypedRow,
): void {
  if (pk === '') return;
  index.pkSets.get(table.name)?.delete(pk);
  index.byPk.get(table.name)?.delete(pk);
  const counts = index.pkCounts.get(table.name);
  if (counts !== undefined) {
    const c = counts.get(pk) ?? 0;
    if (c <= 1) counts.delete(pk);
    else counts.set(pk, c - 1);
  }
  for (const [fieldName, valueKey] of rowUniqueValues(table, row)) {
    const map = index.uniqueCounts.get(`${table.name}:${fieldName}`);
    if (map !== undefined) {
      const c = map.get(valueKey) ?? 0;
      if (c <= 1) map.delete(valueKey);
      else map.set(valueKey, c - 1);
    }
  }
  const hitKey = `${table.name}\u0000${pk}`;
  const hits = index.refByRow.get(hitKey);
  if (hits !== undefined) {
    for (const hit of hits) {
      const key = `${hit.target}\u0000${hit.targetPk}`;
      const list = index.refIndex.get(key);
      if (list !== undefined) {
        const next = list.filter((h) => h !== hit);
        if (next.length === 0) index.refIndex.delete(key);
        else index.refIndex.set(key, next);
      }
    }
    index.refByRow.delete(hitKey);
  }
  void row;
}

function walkRefsForIndex(
  ir: SchemaIr,
  table: TableDef,
  row: TypedRow,
  visit: (target: string, targetPk: string, fieldPath: string) => void,
): void {
  // 与 engine.walkRefs 相同的遍历，但避免为索引构建重复分配闭包状态
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
        )
          return;
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

/** 对已类型化行重跑行内类型约束（值树 vs 类型 AST；加载期错误 unknown-field/required 不在此层） */
function retypeRow(ir: SchemaIr, table: TableDef, row: TypedRow): ValidationError[] {
  const errors: ValidationError[] = [];
  const where = `行 ${row.pk}`;
  const fail = (path: string, ruleId: string, message: string): void => {
    errors.push({
      table: table.name,
      rowKey: row.pk,
      fieldPath: path,
      ruleId,
      severity: 'error',
      message,
    });
  };
  const walk = (
    value: unknown,
    ast: TypeAst,
    field: { maxLength?: number; range?: [number, number] } | null,
    path: string,
  ): void => {
    if (value === undefined) return;
    switch (ast.kind) {
      case 'primitive': {
        if (ast.name === 'int' && typeof value === 'number' && field?.range) {
          const [min, max] = field.range;
          if (value < min || value > max)
            fail(
              path,
              'type.int.range',
              `${where}字段「${path}」的值 ${value} 超出范围 [${min}, ${max}]`,
            );
        }
        if (ast.name === 'float' && typeof value === 'number' && field?.range) {
          const [min, max] = field.range;
          if (value < min || value > max)
            fail(
              path,
              'type.float.range',
              `${where}字段「${path}」的值 ${value} 超出范围 [${min}, ${max}]`,
            );
        }
        if (
          (ast.name === 'string' || ast.name === 'text') &&
          typeof value === 'string' &&
          field?.maxLength !== undefined &&
          value.length > field.maxLength
        ) {
          fail(
            path,
            'type.string.max-length',
            `${where}字段「${path}」长度超过上限 ${field.maxLength}`,
          );
        }
        return;
      }
      case 'enum': {
        const enumDef = ir.enums[ast.enumName];
        if (
          enumDef !== undefined &&
          typeof value === 'string' &&
          !enumDef.values.some((v) => v.name === value)
        ) {
          fail(
            path,
            'enum.unknown-member',
            `${where}字段「${path}」的值不是枚举「${ast.enumName}」的成员`,
          );
        }
        return;
      }
      case 'struct': {
        const structDef = ir.structs[ast.structName];
        if (structDef === undefined) return;
        for (const f of structDef.fields) {
          const fast = resolveFieldAst(f.type);
          if (fast !== null) walk((value as Row)[f.name], fast, f, `${path}.${f.name}`);
        }
        return;
      }
      case 'list':
        if (Array.isArray(value))
          value.forEach((item, i) => walk(item, ast.element, null, `${path}.${i}`));
        return;
      case 'map':
        if (value instanceof Map) {
          for (const [key, item] of value) walk(item, ast.element, null, `${path}.${String(key)}`);
        }
        return;
      default:
        return;
    }
  };
  for (const field of table.fields) {
    const ast = resolveFieldAst(field.type);
    if (ast === null) continue;
    walk(row.row[field.name], ast, field, field.name);
  }
  return errors;
}

/**
 * §5.6 增量校验：只重算受影响规则——变更行的行内规则、所在表的 pk/unique 分组、
 * 出边 FK + 被删/改主键的入边 FK。不产出 pk.order（行序是文件层关注点）。
 */
export function validateIncremental(
  ir: SchemaIr,
  rowsByTable: Map<string, TypedRow[]>,
  changed: ChangeSet[],
  index?: IncrementalIndex,
): ValidationError[] {
  const idx = index ?? buildIndex(ir, rowsByTable);
  const errors: ValidationError[] = [];

  for (const change of changed) {
    const table = ir.tables[change.table];
    if (table === undefined) continue;
    const byPk = idx.byPk.get(change.table);
    if (byPk === undefined) continue;

    const changedRows: TypedRow[] = [];
    for (const key of change.keys) {
      const row = byPk.get(key);
      if (row !== undefined) changedRows.push(row);
    }

    // 1. 行内规则（类型约束重跑 + DSL 规则重求值）
    const scope = buildRuleScope(table, ir);
    const fieldRules: Array<{
      field: string;
      expr: string;
      evaluate: (row: TypedRow) => { violated: boolean; detail?: string };
    }> = [];
    for (const field of table.fields) {
      if (field.rule === undefined) continue;
      const compiled = compileRule(field.rule, scope);
      if (!compiled.ok) {
        errors.push({
          table: table.name,
          rowKey: '',
          fieldPath: field.name,
          ruleId: 'rule.compile',
          severity: 'error',
          message: `字段「${field.name}」的规则无法编译：${compiled.error}`,
        });
        continue;
      }
      const evaluate = compiled.rule.evaluate;
      fieldRules.push({
        field: field.name,
        expr: field.rule,
        evaluate: (r) => evaluate(r.row, pkNumberOrString(r)),
      });
    }
    const rowRules: Array<{
      id: string;
      severity: 'error' | 'warning';
      message?: string;
      evaluate: (row: TypedRow) => { violated: boolean; detail?: string };
    }> = [];
    for (const rule of table.rowRules ?? []) {
      const compiled = compileRule(rule.rule, scope);
      if (!compiled.ok) continue;
      const evaluate = compiled.rule.evaluate;
      const entry = {
        id: rule.id,
        severity: rule.severity ?? ('error' as const),
        evaluate: (r: TypedRow) => evaluate(r.row, pkNumberOrString(r)),
      };
      if (rule.message !== undefined) (entry as { message?: string }).message = rule.message;
      rowRules.push(entry);
    }

    for (const row of changedRows) {
      errors.push(...retypeRow(ir, table, row));
      for (const rule of fieldRules) {
        const result = rule.evaluate(row);
        if (!result.violated) continue;
        errors.push({
          table: table.name,
          rowKey: row.pk,
          fieldPath: rule.field,
          ruleId: 'rule.field',
          severity: 'error',
          message: `字段「${rule.field}」不满足规则「${rule.expr}」${result.detail !== undefined ? `（${result.detail}）` : ''}`,
        });
      }
      for (const rule of rowRules) {
        const result = rule.evaluate(row);
        if (!result.violated) continue;
        const template = rule.message ?? `规则「${rule.id}」未满足`;
        const message = template.replace(/\{([A-Za-z0-9_.]+)\}/g, (_m, name: string) => {
          const value = row.row[name];
          return value === undefined ? `{${name}}` : String(value);
        });
        errors.push({
          table: table.name,
          rowKey: row.pk,
          fieldPath: '',
          ruleId: `rule.row:${rule.id}`,
          severity: rule.severity,
          message: message + (result.detail !== undefined ? `（${result.detail}）` : ''),
        });
      }
    }

    // 2. pk / unique 分组（借索引 O(变更键)）
    const pkCounts = idx.pkCounts.get(change.table);
    if (pkCounts !== undefined) {
      for (const key of change.keys) {
        if ((pkCounts.get(key) ?? 0) > 1) {
          errors.push({
            table: table.name,
            rowKey: key,
            fieldPath: table.primaryKey,
            ruleId: 'pk.duplicate',
            severity: 'error',
            message: `主键 ${key} 重复`,
          });
        }
      }
    }
    for (const field of table.fields) {
      if (field.unique !== true) continue;
      const counts = idx.uniqueCounts.get(`${table.name}:${field.name}`);
      if (counts === undefined) continue;
      for (const row of changedRows) {
        const raw = row.row[field.name];
        if (typeof raw !== 'number' && typeof raw !== 'string') continue;
        if ((counts.get(String(raw)) ?? 0) > 1) {
          errors.push({
            table: table.name,
            rowKey: row.pk,
            fieldPath: field.name,
            ruleId: 'unique.duplicate',
            severity: 'error',
            message: `字段「${field.name}」的值 ${JSON.stringify(String(raw))} 重复`,
          });
        }
      }
    }

    // 3. 出边 FK：变更行引用的目标是否仍存在
    const removedPks = change.keys.filter((key) => !byPk.has(key));
    for (const row of changedRows) {
      walkRefsForIndex(ir, table, row, (target, targetPk, fieldPath) => {
        if (!idx.pkSets.get(target)?.has(targetPk)) {
          errors.push({
            table: table.name,
            rowKey: row.pk,
            fieldPath,
            ruleId: 'fk.missing',
            severity: 'error',
            message: `引用的目标不存在：${target}#${targetPk}`,
          });
        }
      });
    }
    // 4. 入边 FK：被删除/改主键的行，其引用方立即变红
    for (const removed of removedPks) {
      const hits = idx.refIndex.get(`${change.table}\u0000${removed}`);
      if (hits === undefined) continue;
      for (const hit of hits) {
        errors.push({
          table: hit.fromTable,
          rowKey: hit.fromPk,
          fieldPath: hit.fieldPath,
          ruleId: 'fk.missing',
          severity: 'error',
          message: `引用的目标不存在：${change.table}#${removed}`,
        });
      }
    }
  }
  return errors;
}

function pkNumberOrString(row: TypedRow): string | number {
  return /^-?\d+$/.test(row.pk) ? Number(row.pk) : row.pk;
}
