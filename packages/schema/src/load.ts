import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import { schemaError, type ValidationError } from './errors.js';
import type {
  EnumDef,
  EnumValueDef,
  FieldDef,
  LiteralValue,
  RowRuleDef,
  SchemaIr,
  SourceRef,
  StructDef,
  TableDef,
  UnionDef,
  UnionVariantDef,
} from './ir.js';

/**
 * 纯函数加载器：把若干 schema YAML 文本合并为单一 IR（docs/04 §1/§2）。
 * 输入是「相对路径 → 文件内容」映射，不含任何 Node/DOM API——目录读取由
 * Node 侧包装器（T1.6，@gcb/schema/node）负责。
 *
 * 职责边界：本函数保证产出 IR 的**结构形状**成立（形状不合法的定义整体跳过并报错）；
 * 语义校验（引用存在性、命名、pk 指向等）属 checkSchema（T1.4）。
 *
 * 错误 ruleId：schema.yaml-parse / schema.unknown-key / schema.duplicate-name / schema.shape
 */
export interface LoadSchemaResult {
  ir: SchemaIr;
  errors: ValidationError[];
}

const TOP_KEYS = new Set(['enums', 'structs', 'unions', 'tables']);

const FIELD_KEYS = new Set([
  'name',
  'type',
  'default',
  'comment',
  'range',
  'maxLength',
  'unique',
  'rule',
]);

const ROW_RULE_KEYS = new Set(['id', 'rule', 'severity', 'message']);

export function loadSchema(files: Record<string, string>): LoadSchemaResult {
  const errors: ValidationError[] = [];
  const ir: SchemaIr = { enums: {}, structs: {}, unions: {}, tables: {} };
  const seenNames = new Set<string>();

  for (const path of Object.keys(files).sort()) {
    loadFile(path, files[path] ?? '', ir, errors, seenNames);
  }
  return { ir, errors };
}

function loadFile(
  path: string,
  content: string,
  ir: SchemaIr,
  errors: ValidationError[],
  seenNames: Set<string>,
): void {
  const doc = parseDocument(content);

  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const linePos = (err as { linePos?: Array<{ line: number }> }).linePos;
      const line = linePos?.[0]?.line ?? 0;
      const firstMessage = err.message.split('\n')[0] ?? err.message;
      errors.push(
        schemaError(path, 'schema.yaml-parse', `YAML 语法错误（第 ${line} 行）：${firstMessage}`),
      );
    }
    return;
  }

  const root = doc.contents;
  if (root == null) return; // 空文件 = 无定义，合法
  if (!isMap(root)) {
    errors.push(schemaError(path, 'schema.shape', 'schema 文件根节点必须是映射（键值对形式）'));
    return;
  }

  const lineAt = (offset: number | undefined): number =>
    offset === undefined ? 0 : offsetToLine(content, offset);

  for (const pair of root.items) {
    const topKey = scalarString(pair.key);
    if (topKey === null) {
      errors.push(schemaError(path, 'schema.shape', '顶层键必须是字符串'));
      continue;
    }
    if (!TOP_KEYS.has(topKey)) {
      errors.push(
        schemaError(
          path,
          'schema.unknown-key',
          `未知的顶层键「${topKey}」（第 ${lineAt(nodeStart(pair.key))} 行），允许：enums / structs / unions / tables`,
        ),
      );
      continue;
    }
    const block = pair.value;
    if (!isMap(block)) {
      errors.push(schemaError(path, 'schema.shape', `「${topKey}」必须是映射（类型名 → 定义）`));
      continue;
    }
    for (const defPair of block.items) {
      const name = scalarString(defPair.key);
      if (name === null || name === '') {
        errors.push(schemaError(path, 'schema.shape', `「${topKey}」中的定义名必须是字符串`));
        continue;
      }
      if (seenNames.has(name)) {
        errors.push(
          schemaError(
            path,
            'schema.duplicate-name',
            `类型名「${name}」重复定义（第 ${lineAt(nodeStart(defPair.key))} 行）；类型名全局唯一`,
          ),
        );
        continue;
      }
      const body = defPair.value;
      if (!isMap(body)) {
        errors.push(schemaError(path, 'schema.shape', `「${name}」的定义体必须是映射`));
        continue;
      }
      const source: SourceRef = { file: path, line: lineAt(nodeStart(defPair.key)) };
      const def = buildDef(topKey, name, body, path, source, lineAt, errors);
      if (def === null) continue;
      seenNames.add(name);
      switch (topKey) {
        case 'enums':
          ir.enums[name] = def as EnumDef;
          break;
        case 'structs':
          ir.structs[name] = def as StructDef;
          break;
        case 'unions':
          ir.unions[name] = def as UnionDef;
          break;
        case 'tables':
          ir.tables[name] = def as TableDef;
          break;
      }
    }
  }
}

function buildDef(
  topKey: string,
  name: string,
  body: YAMLMap,
  path: string,
  source: SourceRef,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): EnumDef | StructDef | UnionDef | TableDef | null {
  switch (topKey) {
    case 'enums':
      return buildEnum(name, body, path, source, lineAt, errors);
    case 'structs':
      return buildStruct(name, body, path, source, lineAt, errors);
    case 'unions':
      return buildUnion(name, body, path, source, lineAt, errors);
    case 'tables':
      return buildTable(name, body, path, source, lineAt, errors);
    default:
      return null;
  }
}

function buildEnum(
  name: string,
  body: YAMLMap,
  path: string,
  source: SourceRef,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): EnumDef | null {
  let ok = true;
  rejectUnknownKeys(body, new Set(['comment', 'values']), `枚举「${name}」`, path, lineAt, errors);
  const valuesNode = valueOf(body, 'values');
  const values: EnumValueDef[] = [];
  if (!isSeq(valuesNode)) {
    errors.push(
      schemaError(path, 'schema.shape', `枚举「${name}」缺少 values 列表（第 ${source.line} 行）`),
    );
    ok = false;
  } else {
    for (const item of valuesNode.items) {
      if (!isMap(item)) {
        errors.push(schemaError(path, 'schema.shape', `枚举「${name}」的 values 条目必须是映射`));
        ok = false;
        continue;
      }
      const vName = scalarString(valueOf(item, 'name'));
      const vValue = scalarNumber(valueOf(item, 'value'));
      if (vName === null || vValue === null) {
        errors.push(
          schemaError(
            path,
            'schema.shape',
            `枚举「${name}」的 values 条目需要 { name, value }（第 ${lineAt(nodeStart(item))} 行）`,
          ),
        );
        ok = false;
        continue;
      }
      values.push({ name: vName, value: vValue });
    }
  }
  if (!ok) return null;
  const def: EnumDef = { kind: 'enum', name, values, source };
  const comment = scalarString(valueOf(body, 'comment'));
  if (comment !== null) def.comment = comment;
  return def;
}

function buildStruct(
  name: string,
  body: YAMLMap,
  path: string,
  source: SourceRef,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): StructDef | null {
  let ok = true;
  rejectUnknownKeys(
    body,
    new Set(['comment', 'fields']),
    `struct「${name}」`,
    path,
    lineAt,
    errors,
  );
  const fields = buildFields(name, body, path, lineAt, errors);
  if (fields === null) ok = false;
  if (!ok) return null;
  const def: StructDef = { kind: 'struct', name, fields: fields ?? [], source };
  const comment = scalarString(valueOf(body, 'comment'));
  if (comment !== null) def.comment = comment;
  return def;
}

function buildUnion(
  name: string,
  body: YAMLMap,
  path: string,
  source: SourceRef,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): UnionDef | null {
  let ok = true;
  rejectUnknownKeys(
    body,
    new Set(['comment', 'tag', 'variants']),
    `union「${name}」`,
    path,
    lineAt,
    errors,
  );
  const tag = scalarString(valueOf(body, 'tag'));
  if (tag === null) {
    errors.push(
      schemaError(
        path,
        'schema.shape',
        `union「${name}」缺少 tag（判别字段名，第 ${source.line} 行）`,
      ),
    );
    ok = false;
  }
  const variantsNode = valueOf(body, 'variants');
  const variants: UnionVariantDef[] = [];
  if (!isSeq(variantsNode)) {
    errors.push(
      schemaError(
        path,
        'schema.shape',
        `union「${name}」缺少 variants 列表（第 ${source.line} 行）`,
      ),
    );
    ok = false;
  } else {
    for (const item of variantsNode.items) {
      if (!isMap(item)) {
        errors.push(
          schemaError(path, 'schema.shape', `union「${name}」的 variants 条目必须是映射`),
        );
        ok = false;
        continue;
      }
      const vName = scalarString(valueOf(item, 'name'));
      const vStruct = scalarString(valueOf(item, 'struct'));
      if (vName === null || vStruct === null) {
        errors.push(
          schemaError(
            path,
            'schema.shape',
            `union「${name}」的 variants 条目需要 { name, struct }（第 ${lineAt(nodeStart(item))} 行）`,
          ),
        );
        ok = false;
        continue;
      }
      variants.push({ name: vName, struct: vStruct });
    }
  }
  if (!ok) return null;
  const def: UnionDef = { kind: 'union', name, tag: tag ?? '', variants, source };
  const comment = scalarString(valueOf(body, 'comment'));
  if (comment !== null) def.comment = comment;
  return def;
}

function buildTable(
  name: string,
  body: YAMLMap,
  path: string,
  source: SourceRef,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): TableDef | null {
  let ok = true;
  rejectUnknownKeys(
    body,
    new Set(['comment', 'primaryKey', 'displayField', 'fields', 'rowRules']),
    `表「${name}」`,
    path,
    lineAt,
    errors,
  );
  const primaryKey = scalarString(valueOf(body, 'primaryKey'));
  const displayField = scalarString(valueOf(body, 'displayField'));
  if (primaryKey === null) {
    errors.push(
      schemaError(path, 'schema.shape', `表「${name}」缺少 primaryKey（第 ${source.line} 行）`),
    );
    ok = false;
  }
  if (displayField === null) {
    errors.push(
      schemaError(path, 'schema.shape', `表「${name}」缺少 displayField（第 ${source.line} 行）`),
    );
    ok = false;
  }
  const fields = buildFields(name, body, path, lineAt, errors);
  if (fields === null) ok = false;

  const rowRulesNode = valueOf(body, 'rowRules');
  let rowRules: RowRuleDef[] | undefined;
  if (rowRulesNode !== undefined) {
    if (!isSeq(rowRulesNode)) {
      errors.push(schemaError(path, 'schema.shape', `表「${name}」的 rowRules 必须是列表`));
      ok = false;
    } else {
      rowRules = [];
      for (const item of rowRulesNode.items) {
        const rule = buildRowRule(name, item, path, lineAt, errors);
        if (rule === null) {
          ok = false;
          continue;
        }
        rowRules.push(rule);
      }
    }
  }

  if (!ok) return null;
  const def: TableDef = {
    kind: 'table',
    name,
    primaryKey: primaryKey ?? '',
    displayField: displayField ?? '',
    fields: fields ?? [],
    source,
  };
  const comment = scalarString(valueOf(body, 'comment'));
  if (comment !== null) def.comment = comment;
  if (rowRules !== undefined) def.rowRules = rowRules;
  return def;
}

function buildRowRule(
  tableName: string,
  item: unknown,
  path: string,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): RowRuleDef | null {
  if (!isMap(item)) {
    errors.push(schemaError(path, 'schema.shape', `表「${tableName}」的 rowRules 条目必须是映射`));
    return null;
  }
  let ok = true;
  rejectUnknownKeys(
    item,
    ROW_RULE_KEYS,
    `表「${tableName}」的 rowRules 条目`,
    path,
    lineAt,
    errors,
  );
  const id = scalarString(valueOf(item, 'id'));
  const rule = scalarString(valueOf(item, 'rule'));
  if (id === null || rule === null) {
    errors.push(
      schemaError(
        path,
        'schema.shape',
        `表「${tableName}」的 rowRules 条目需要 { id, rule }（第 ${lineAt(nodeStart(item))} 行）`,
      ),
    );
    ok = false;
  }
  const severityRaw = scalarString(valueOf(item, 'severity'));
  if (severityRaw !== undefined && severityRaw !== 'error' && severityRaw !== 'warning') {
    errors.push(
      schemaError(
        path,
        'schema.shape',
        `表「${tableName}」的 rowRules.severity 必须是 error 或 warning，得到「${severityRaw}」`,
      ),
    );
    ok = false;
  }
  if (!ok) return null;
  const def: RowRuleDef = {
    id: id ?? '',
    rule: rule ?? '',
    severity: severityRaw === 'warning' ? 'warning' : 'error',
  };
  const message = scalarString(valueOf(item, 'message'));
  if (message !== null) def.message = message;
  return def;
}

/** fields 列表映射；任一字段形状不合法即返回 null（定义整体跳过） */
function buildFields(
  ownerName: string,
  body: YAMLMap,
  path: string,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): FieldDef[] | null {
  const fieldsNode = valueOf(body, 'fields');
  if (!isSeq(fieldsNode)) {
    errors.push(schemaError(path, 'schema.shape', `「${ownerName}」缺少 fields 列表`));
    return null;
  }
  const fields: FieldDef[] = [];
  let ok = true;
  for (const item of fieldsNode.items) {
    if (!isMap(item)) {
      errors.push(
        schemaError(
          path,
          'schema.shape',
          `「${ownerName}」的 fields 条目必须是映射（第 ${lineAt(nodeStart(item))} 行）`,
        ),
      );
      ok = false;
      continue;
    }
    rejectUnknownKeys(item, FIELD_KEYS, `「${ownerName}」的字段`, path, lineAt, errors);
    const name = scalarString(valueOf(item, 'name'));
    const type = scalarString(valueOf(item, 'type'));
    if (name === null || type === null) {
      errors.push(
        schemaError(
          path,
          'schema.shape',
          `「${ownerName}」的字段需要 { name, type }（第 ${lineAt(nodeStart(item))} 行）`,
        ),
      );
      ok = false;
      continue;
    }
    const field: FieldDef = {
      name,
      type,
      source: { file: path, line: lineAt(firstKeyStart(item)) },
    };
    const comment = scalarString(valueOf(item, 'comment'));
    if (comment !== null) field.comment = comment;
    const rule = scalarString(valueOf(item, 'rule'));
    if (rule !== null) field.rule = rule;
    const maxLength = scalarNumber(valueOf(item, 'maxLength'));
    if (maxLength !== null) field.maxLength = maxLength;
    const unique = scalarBool(valueOf(item, 'unique'));
    if (unique !== null) field.unique = unique;
    if (hasKey(item, 'default')) {
      const literal = nodeToLiteral(valueOf(item, 'default'));
      if (literal === undefined) {
        errors.push(
          schemaError(
            path,
            'schema.shape',
            `「${ownerName}.${name}」的 default 必须是标量或对象字面量（第 ${lineAt(nodeStart(item))} 行）`,
          ),
        );
        ok = false;
      } else {
        field.default = literal;
      }
    }
    if (hasKey(item, 'range')) {
      const range = tupleRange(valueOf(item, 'range'));
      if (range === null) {
        errors.push(
          schemaError(
            path,
            'schema.shape',
            `「${ownerName}.${name}」的 range 必须是 [min, max] 数值二元组（第 ${lineAt(nodeStart(item))} 行）`,
          ),
        );
        ok = false;
      } else {
        field.range = range;
      }
    }
    fields.push(field);
  }
  return ok ? fields : null;
}

// ---------- 节点工具 ----------

function offsetToLine(content: string, offset: number): number {
  let line = 1;
  const stop = Math.min(offset, content.length);
  for (let i = 0; i < stop; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** 从 yaml Node 上取 range[0]（起始偏移）；不依赖 lib 的类型导出，防御式读取 */
function nodeStart(node: unknown): number | undefined {
  if (node !== null && typeof node === 'object' && 'range' in node) {
    const range = (node as { range?: unknown }).range;
    if (Array.isArray(range) && typeof range[0] === 'number') return range[0];
  }
  return undefined;
}

function firstKeyStart(mapNode: YAMLMap): number | undefined {
  const first = mapNode.items[0];
  return first === undefined ? undefined : nodeStart(first.key);
}

function scalarString(node: unknown): string | null {
  return isScalar(node) && typeof node.value === 'string' ? node.value : null;
}

function scalarNumber(node: unknown): number | null {
  return isScalar(node) && typeof node.value === 'number' ? node.value : null;
}

function scalarBool(node: unknown): boolean | null {
  return isScalar(node) && typeof node.value === 'boolean' ? node.value : null;
}

function valueOf(mapNode: YAMLMap, key: string): unknown {
  for (const pair of mapNode.items) {
    if (scalarString(pair.key) === key) return pair.value;
  }
  return undefined;
}

function hasKey(mapNode: YAMLMap, key: string): boolean {
  return mapNode.items.some((pair) => scalarString(pair.key) === key);
}

function rejectUnknownKeys(
  mapNode: YAMLMap,
  allowed: Set<string>,
  owner: string,
  path: string,
  lineAt: (offset: number | undefined) => number,
  errors: ValidationError[],
): void {
  for (const pair of mapNode.items) {
    const key = scalarString(pair.key);
    if (key !== null && !allowed.has(key)) {
      errors.push(
        schemaError(
          path,
          'schema.unknown-key',
          `${owner}存在未知键「${key}」（第 ${lineAt(nodeStart(pair.key))} 行）`,
        ),
      );
    }
  }
}

function tupleRange(node: unknown): [number, number] | null {
  if (!isSeq(node) || node.items.length !== 2) return null;
  const min = node.items[0];
  const max = node.items[1];
  if (
    min === undefined ||
    max === undefined ||
    !isScalar(min) ||
    !isScalar(max) ||
    typeof min.value !== 'number' ||
    typeof max.value !== 'number'
  ) {
    return null;
  }
  return [min.value, max.value];
}

function nodeToLiteral(node: unknown): LiteralValue | undefined {
  if (isScalar(node)) {
    const v = node.value;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return undefined; // null 值视为未提供（显式 null 由 checkSchema 处理）
  }
  if (isMap(node)) {
    const out: { [key: string]: LiteralValue } = {};
    for (const pair of node.items) {
      const key = scalarString(pair.key);
      if (key === null) return undefined;
      const value = nodeToLiteral(pair.value);
      if (value === undefined) return undefined;
      out[key] = value;
    }
    return out;
  }
  return undefined;
}
