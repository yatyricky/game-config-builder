// Typed-row 模型与逐字段类型校验（docs/04 §3.2 / §5.1 步骤 2，T2.2）。
// 在 validate 包而非 data：validateFull/validateIncremental 需要这些类型，
// 依赖方向 data → validate 允许 data 复用；反向则成环。

import { parseTypeString } from '@gcb/schema';
import type { FieldDef, SchemaIr, StructDef, TableDef, TypeAst } from '@gcb/schema';
import type { ValidationError } from '@gcb/schema';

export interface StructValue {
  [key: string]: RowValue;
}

export type RowValue =
  | boolean
  | number
  | string
  | StructValue
  | RowValue[]
  | Map<string, RowValue>
  | Map<number, RowValue>;

export type Row = StructValue;

/** JSONL 解析产物（T2.1）：未类型化的原始 JSON 行 */
export interface RawRow {
  json: unknown;
  /** 1-based 文件行号 */
  line: number;
}

/** 类型化后的行：pk 为规范字符串（int → 十进制字符串，§5.3） */
export interface TypedRow {
  pk: string;
  row: Row;
  line: number;
}

/** 主键的运行时形态（int 表 → number；string 表 → string） */
export type RowPk = number | string;

export interface TypeRowsResult {
  rows: TypedRow[];
  errors: ValidationError[];
}

interface Ctx {
  ir: SchemaIr;
}

const SAFE_INT_MAX = Number.MAX_SAFE_INTEGER;

const astCache = new Map<string, TypeAst | null>();
function parseTypeCached(type: string): TypeAst | null {
  const hit = astCache.get(type);
  if (hit !== undefined) return hit;
  const result = parseTypeString(type);
  const ast = result.ok ? result.ast : null;
  astCache.set(type, ast);
  return ast;
}

function dataError(
  table: string,
  rowKey: string,
  fieldPath: string,
  ruleId: string,
  message: string,
): ValidationError {
  return { table, rowKey, fieldPath, ruleId, severity: 'error', message };
}

function preview(value: unknown): string {
  const s = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return s.length > 40 ? s.slice(0, 37) + '...' : s;
}

/** 类型化一张表的全部原始行（bad row 不中断整表，错误逐条收集） */
export function typeRows(table: TableDef, ir: SchemaIr, rawRows: RawRow[]): TypeRowsResult {
  const ctx: Ctx = { ir };
  const errors: ValidationError[] = [];
  const rows: TypedRow[] = [];
  const fieldNames = new Set(table.fields.map((f) => f.name));

  for (const raw of rawRows) {
    const where = `第 ${raw.line} 行`;
    if (raw.json === null || typeof raw.json !== 'object' || Array.isArray(raw.json)) {
      errors.push(
        dataError(
          table.name,
          '',
          '',
          'type.struct.parse',
          `${where}必须是对象（{...}），得到 ${preview(raw.json)}`,
        ),
      );
      continue;
    }
    const input = raw.json as Record<string, unknown>;
    const row: Row = {};

    for (const key of Object.keys(input)) {
      if (!fieldNames.has(key)) {
        errors.push(
          dataError(table.name, '', key, 'type.unknown-field', `${where}存在未知字段「${key}」`),
        );
      }
    }
    for (const field of table.fields) {
      const present = Object.prototype.hasOwnProperty.call(input, field.name);
      if (!present) {
        const filled = fillDefault(field, ctx, table.name, '', field.name, where, errors);
        if (filled !== undefined) row[field.name] = filled;
        continue;
      }
      const value = typeField(
        input[field.name],
        field,
        ctx,
        table.name,
        '',
        field.name,
        where,
        errors,
      );
      if (value !== undefined) row[field.name] = value;
    }

    const pkRaw = row[table.primaryKey];
    const pk = typeof pkRaw === 'number' ? String(pkRaw) : typeof pkRaw === 'string' ? pkRaw : '';
    if (pk === '') {
      errors.push(
        dataError(
          table.name,
          '',
          table.primaryKey,
          'required.missing',
          `${where}缺少主键「${table.primaryKey}」`,
        ),
      );
    }
    rows.push({ pk, row, line: raw.line });
  }
  return { rows, errors };
}

function fillDefault(
  field: FieldDef,
  ctx: Ctx,
  table: string,
  rowKey: string,
  basePath: string,
  where: string,
  errors: ValidationError[],
): RowValue | undefined {
  const ast = parseTypeCached(field.type);
  if (ast === null) return undefined; // type-parse 错误已在 schema 域报告
  if (ast.kind === 'list') return [];
  if (ast.kind === 'map') return new Map();
  if (field.default !== undefined) {
    return typeValue(field.default, ast, field, ctx, table, rowKey, basePath, where, errors);
  }
  errors.push(
    dataError(
      table,
      rowKey,
      basePath,
      'required.missing',
      `${where}字段「${basePath}」缺失且无默认值`,
    ),
  );
  return undefined;
}

function typeField(
  value: unknown,
  field: FieldDef,
  ctx: Ctx,
  table: string,
  rowKey: string,
  path: string,
  where: string,
  errors: ValidationError[],
): RowValue | undefined {
  const ast = parseTypeCached(field.type);
  if (ast === null) return undefined;
  return typeValue(value, ast, field, ctx, table, rowKey, path, where, errors);
}

function typeValue(
  value: unknown,
  ast: TypeAst,
  field: FieldDef | null,
  ctx: Ctx,
  table: string,
  rowKey: string,
  path: string,
  where: string,
  errors: ValidationError[],
): RowValue | undefined {
  const fail = (ruleId: string, message: string): undefined => {
    errors.push(dataError(table, rowKey, path, ruleId, message));
    return undefined;
  };

  switch (ast.kind) {
    case 'primitive':
      switch (ast.name) {
        case 'bool':
          return typeof value === 'boolean'
            ? value
            : fail('type.bool.parse', `${where}字段「${path}」应为布尔值，得到 ${preview(value)}`);
        case 'int': {
          if (
            typeof value !== 'number' ||
            !Number.isInteger(value) ||
            Math.abs(value) > SAFE_INT_MAX
          ) {
            return fail(
              'type.int.parse',
              `${where}字段「${path}」应为整数（|v| ≤ 2^53-1），得到 ${preview(value)}`,
            );
          }
          return checkRange(value, field, table, rowKey, path, where, errors, 'type.int.range');
        }
        case 'float': {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return fail(
              'type.float.parse',
              `${where}字段「${path}」应为有限数值，得到 ${preview(value)}`,
            );
          }
          return checkRange(
            value === 0 ? 0 : value,
            field,
            table,
            rowKey,
            path,
            where,
            errors,
            'type.float.range',
          );
        }
        case 'string':
        case 'text': {
          if (typeof value !== 'string') {
            return fail(
              `type.${ast.name}.parse`,
              `${where}字段「${path}」应为字符串，得到 ${preview(value)}`,
            );
          }
          const max = field?.maxLength;
          if (max !== undefined && value.length > max) {
            return fail(
              'type.string.max-length',
              `${where}字段「${path}」长度 ${value.length} 超过上限 ${max}`,
            );
          }
          return value;
        }
      }
      return fail('type.string.parse', `${where}字段「${path}」类型未知`);

    case 'enum': {
      const enumDef = ctx.ir.enums[ast.enumName];
      if (enumDef === undefined) {
        return fail(
          'enum.unknown-member',
          `${where}字段「${path}」引用了未知枚举「${ast.enumName}」`,
        );
      }
      if (typeof value !== 'string' || !enumDef.values.some((v) => v.name === value)) {
        return fail(
          'enum.unknown-member',
          `${where}字段「${path}」的值 ${preview(value)} 不是枚举「${ast.enumName}」的成员`,
        );
      }
      return value;
    }

    case 'ref': {
      const target = ctx.ir.tables[ast.tableName];
      if (target === undefined)
        return fail('type.ref.parse', `${where}字段「${path}」引用了未知的表「${ast.tableName}」`);
      const pkField = target.fields.find((f) => f.name === target.primaryKey);
      const pkAst = pkField ? parseTypeCached(pkField.type) : null;
      const wantsInt = pkAst?.kind === 'primitive' && pkAst.name === 'int';
      if (wantsInt) {
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          Math.abs(value) > SAFE_INT_MAX
        ) {
          return fail(
            'type.ref.parse',
            `${where}字段「${path}」应为表「${ast.tableName}」的整数主键，得到 ${preview(value)}`,
          );
        }
        return value;
      }
      if (typeof value !== 'string') {
        return fail(
          'type.ref.parse',
          `${where}字段「${path}」应为表「${ast.tableName}」的字符串主键，得到 ${preview(value)}`,
        );
      }
      return value;
    }

    case 'struct': {
      const structDef = ctx.ir.structs[ast.structName];
      if (structDef === undefined) {
        return fail(
          'type.struct.parse',
          `${where}字段「${path}」引用了未知 struct「${ast.structName}」`,
        );
      }
      return typeStructValue(value, structDef, ctx, table, rowKey, path, where, errors);
    }

    case 'list': {
      if (!Array.isArray(value)) {
        return fail('type.list.parse', `${where}字段「${path}」应为数组，得到 ${preview(value)}`);
      }
      const out: RowValue[] = [];
      let ok = true;
      value.forEach((item, i) => {
        const v = typeValue(
          item,
          ast.element,
          null,
          ctx,
          table,
          rowKey,
          `${path}.${i}`,
          where,
          errors,
        );
        if (v === undefined) ok = false;
        else out.push(v);
      });
      return ok ? out : undefined;
    }

    case 'map': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return fail(
          'type.map.parse',
          `${where}字段「${path}」应为对象（map），得到 ${preview(value)}`,
        );
      }
      const out = new Map<string | number, RowValue>();
      let ok = true;
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        let mapKey: string | number = key;
        if (ast.key === 'int') {
          const parsed = Number(key);
          if (!/^-?\d+$/.test(key) || !Number.isSafeInteger(parsed)) {
            errors.push(
              dataError(
                table,
                rowKey,
                `${path}.${key}`,
                'map.key.parse',
                `${where}字段「${path}」的键「${key}」无法解析为安全整数`,
              ),
            );
            ok = false;
            continue;
          }
          mapKey = parsed;
        }
        const v = typeValue(
          raw,
          ast.element,
          null,
          ctx,
          table,
          rowKey,
          `${path}.${key}`,
          where,
          errors,
        );
        if (v === undefined) ok = false;
        else out.set(mapKey, v);
      }
      return ok ? (out as RowValue) : undefined;
    }

    case 'union': {
      const unionDef = ctx.ir.unions[ast.unionName];
      if (
        unionDef === undefined ||
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return fail('union.shape', `${where}字段「${path}」不是合法的 union 编码`);
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length !== 2 || !keys.includes(unionDef.tag) || !keys.includes('value')) {
        return fail(
          'union.shape',
          `${where}字段「${path}」的 union 编码必须恰好为 {"${unionDef.tag}":"变体名","value":{...}}`,
        );
      }
      const variantName = obj[unionDef.tag];
      if (typeof variantName !== 'string') {
        return fail('union.shape', `${where}字段「${path}」的判别值必须是变体名字符串`);
      }
      const variant = unionDef.variants.find((v) => v.name === variantName);
      const variantStruct = variant ? ctx.ir.structs[variant.struct] : undefined;
      if (variantStruct === undefined) {
        return fail('union.shape', `${where}字段「${path}」的变体「${variantName}」不存在`);
      }
      const inner = typeStructValue(
        obj['value'],
        variantStruct,
        ctx,
        table,
        rowKey,
        `${path}.value`,
        where,
        errors,
      );
      if (inner === undefined) return undefined;
      const out: StructValue = {};
      out[unionDef.tag] = variantName;
      out['value'] = inner;
      return out;
    }
  }
}

function typeStructValue(
  value: unknown,
  structDef: StructDef,
  ctx: Ctx,
  table: string,
  rowKey: string,
  path: string,
  where: string,
  errors: ValidationError[],
): StructValue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(
      dataError(
        table,
        rowKey,
        path,
        'type.struct.parse',
        `${where}字段「${path}」应为对象（struct ${structDef.name}），得到 ${preview(value)}`,
      ),
    );
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const out: StructValue = {};
  let ok = true;
  const fieldNames = new Set(structDef.fields.map((f) => f.name));
  for (const key of Object.keys(input)) {
    if (!fieldNames.has(key)) {
      errors.push(
        dataError(
          table,
          rowKey,
          `${path}.${key}`,
          'type.unknown-field',
          `${where}字段「${path}」存在未知键「${key}」`,
        ),
      );
    }
  }
  for (const field of structDef.fields) {
    const subPath = `${path}.${field.name}`;
    if (!Object.prototype.hasOwnProperty.call(input, field.name)) {
      const filled = fillDefault(field, ctx, table, rowKey, subPath, where, errors);
      if (filled === undefined) ok = false;
      else out[field.name] = filled;
      continue;
    }
    const v = typeField(input[field.name], field, ctx, table, rowKey, subPath, where, errors);
    if (v === undefined) ok = false;
    else out[field.name] = v;
  }
  return ok ? out : undefined;
}

function checkRange(
  value: number,
  field: FieldDef | null,
  table: string,
  rowKey: string,
  path: string,
  where: string,
  errors: ValidationError[],
  ruleId: string,
): number {
  const range = field?.range;
  if (range && (value < range[0] || value > range[1])) {
    errors.push(
      dataError(
        table,
        rowKey,
        path,
        ruleId,
        `${where}字段「${path}」的值 ${value} 超出范围 [${range[0]}, ${range[1]}]`,
      ),
    );
  }
  return value;
}
