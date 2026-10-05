// docs/04 §3.1 类型字符串的递归下降 parser 与全 IR 引用解析（T1.3）。
// 文法极小，手写实现——禁止用正则拆字符串（嵌套尖括号会错）。

import type { FieldDef, MapKeyTypeName, PrimitiveTypeName, SchemaIr, TypeAst } from './ir.js';
import type { ValidationError } from './errors.js';

export type TypeParseResult = { ok: true; ast: TypeAst } | { ok: false; message: string };

const PRIMITIVE_NAMES = ['bool', 'int', 'float', 'string', 'text'] as const;
const MAP_KEY_NAMES = ['int', 'string'] as const;

function isPrimitiveName(x: string): x is PrimitiveTypeName {
  return (PRIMITIVE_NAMES as readonly string[]).includes(x);
}

function isMapKeyName(x: string): x is MapKeyTypeName {
  return (MAP_KEY_NAMES as readonly string[]).includes(x);
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

interface Cursor {
  src: string;
  pos: number;
}

function skipWs(cursor: Cursor): void {
  while (cursor.pos < cursor.src.length && /\s/.test(cursor.src[cursor.pos] ?? '')) {
    cursor.pos++;
  }
}

function readIdent(cursor: Cursor): string | null {
  const start = cursor.src[cursor.pos];
  if (start === undefined || !IDENT_START.test(start)) return null;
  let end = cursor.pos + 1;
  while (end < cursor.src.length) {
    const part = cursor.src[end];
    if (part === undefined || !IDENT_PART.test(part)) break;
    end++;
  }
  const ident = cursor.src.slice(cursor.pos, end);
  cursor.pos = end;
  return ident;
}

function expectChar(cursor: Cursor, ch: string): string | null {
  skipWs(cursor);
  if (cursor.src[cursor.pos] !== ch) {
    return `期望「${ch}」（位置 ${cursor.pos}）`;
  }
  cursor.pos++;
  return null;
}

function parseTypeInner(cursor: Cursor): TypeParseResult {
  skipWs(cursor);
  const ident = readIdent(cursor);
  if (ident === null) {
    return { ok: false, message: `期望类型名（位置 ${cursor.pos}）` };
  }
  if (isPrimitiveName(ident)) {
    skipWs(cursor);
    if (cursor.src[cursor.pos] === '<') {
      return { ok: false, message: `基础类型「${ident}」不接受泛型参数` };
    }
    return { ok: true, ast: { kind: 'primitive', name: ident } };
  }
  switch (ident) {
    case 'enum':
    case 'struct':
    case 'ref':
    case 'union': {
      const openErr = expectChar(cursor, '<');
      if (openErr) return { ok: false, message: `「${ident}<…>」${openErr}` };
      skipWs(cursor);
      const name = readIdent(cursor);
      if (name === null) return { ok: false, message: `「${ident}<…>」期望类型名` };
      const closeErr = expectChar(cursor, '>');
      if (closeErr) return { ok: false, message: `「${ident}<…>」${closeErr}` };
      switch (ident) {
        case 'enum':
          return { ok: true, ast: { kind: 'enum', enumName: name } };
        case 'struct':
          return { ok: true, ast: { kind: 'struct', structName: name } };
        case 'ref':
          return { ok: true, ast: { kind: 'ref', tableName: name } };
        default:
          return { ok: true, ast: { kind: 'union', unionName: name } };
      }
    }
    case 'list': {
      const openErr = expectChar(cursor, '<');
      if (openErr) return { ok: false, message: `「list<…>」${openErr}` };
      const elem = parseTypeInner(cursor);
      if (!elem.ok) return elem;
      const closeErr = expectChar(cursor, '>');
      if (closeErr) return { ok: false, message: `「list<…>」${closeErr}` };
      return { ok: true, ast: { kind: 'list', element: elem.ast } };
    }
    case 'map': {
      const openErr = expectChar(cursor, '<');
      if (openErr) return { ok: false, message: `「map<…>」${openErr}` };
      skipWs(cursor);
      const key = readIdent(cursor);
      if (key === null || !isMapKeyName(key)) {
        return { ok: false, message: 'map 的键类型必须是 int 或 string' };
      }
      const commaErr = expectChar(cursor, ',');
      if (commaErr) return { ok: false, message: `「map<…>」${commaErr}` };
      const elem = parseTypeInner(cursor);
      if (!elem.ok) return elem;
      const closeErr = expectChar(cursor, '>');
      if (closeErr) return { ok: false, message: `「map<…>」${closeErr}` };
      return { ok: true, ast: { kind: 'map', key, element: elem.ast } };
    }
    default:
      return { ok: false, message: `未知类型「${ident}」` };
  }
}

/** 解析单个类型字符串（§3.1 文法）；语法层允许 list/map 任意嵌套，深度约束由 resolveTypes 报 schema.depth */
export function parseTypeString(src: string): TypeParseResult {
  const cursor: Cursor = { src, pos: 0 };
  const result = parseTypeInner(cursor);
  if (!result.ok) return result;
  skipWs(cursor);
  if (cursor.pos !== cursor.src.length) {
    return { ok: false, message: `类型字符串末尾有多余字符（位置 ${cursor.pos}）` };
  }
  return result;
}

// ---------- 全 IR 引用解析（两遍法的第二遍） ----------

interface TypeLocation {
  file: string;
  fieldPath: string;
  line: number;
}

interface NamespaceNames {
  enums: Set<string>;
  structs: Set<string>;
  unions: Set<string>;
  tables: Set<string>;
}

interface TypeEdges {
  structToStruct: Map<string, Set<string>>;
  structToUnion: Map<string, Set<string>>;
  unionToStruct: Map<string, Set<string>>;
}

function typeErr(loc: TypeLocation, ruleId: string, message: string): ValidationError {
  return {
    table: loc.file,
    rowKey: '',
    fieldPath: loc.fieldPath,
    ruleId,
    severity: 'error',
    message,
  };
}

function addEdge(map: Map<string, Set<string>>, from: string, to: string): void {
  const set = map.get(from) ?? new Set<string>();
  set.add(to);
  map.set(from, set);
}

/**
 * 解析 IR 中所有字段的类型字符串并校验：
 * - 引用存在性与类别（enum/struct/union 名必须指向同类；ref 只能指向 table）→ schema.bad-ref
 * - 集合嵌套深度 ≤ 1（list/map 元素不得再包含 list/map）→ schema.depth
 * - struct 直接或间接包含自身（含经 union 变体的链）→ schema.cycle
 * - 类型字符串语法 → schema.type-parse
 */
export function resolveTypes(ir: SchemaIr): ValidationError[] {
  const errors: ValidationError[] = [];
  const names: NamespaceNames = {
    enums: new Set(Object.keys(ir.enums)),
    structs: new Set(Object.keys(ir.structs)),
    unions: new Set(Object.keys(ir.unions)),
    tables: new Set(Object.keys(ir.tables)),
  };
  const edges: TypeEdges = {
    structToStruct: new Map(),
    structToUnion: new Map(),
    unionToStruct: new Map(),
  };

  const handleType = (
    ast: TypeAst,
    loc: TypeLocation,
    owner: { kind: 'struct' | 'table'; name: string },
    insideCollection: boolean,
  ): void => {
    switch (ast.kind) {
      case 'primitive':
        return;
      case 'enum':
        if (!names.enums.has(ast.enumName)) {
          errors.push(typeErr(loc, 'schema.bad-ref', `未知枚举「${ast.enumName}」`));
        }
        return;
      case 'struct': {
        if (!names.structs.has(ast.structName)) {
          errors.push(typeErr(loc, 'schema.bad-ref', `未知 struct「${ast.structName}」`));
          return;
        }
        if (owner.kind === 'struct') {
          addEdge(edges.structToStruct, owner.name, ast.structName);
        }
        return;
      }
      case 'union': {
        if (!names.unions.has(ast.unionName)) {
          errors.push(typeErr(loc, 'schema.bad-ref', `未知 union「${ast.unionName}」`));
          return;
        }
        if (owner.kind === 'struct') {
          addEdge(edges.structToUnion, owner.name, ast.unionName);
        }
        return;
      }
      case 'ref':
        if (!names.tables.has(ast.tableName)) {
          errors.push(
            typeErr(
              loc,
              'schema.bad-ref',
              `ref<${ast.tableName}> 必须指向表：ref 只能引用 table 的主键`,
            ),
          );
        }
        return;
      case 'list':
      case 'map': {
        if (insideCollection) {
          errors.push(
            typeErr(
              loc,
              'schema.depth',
              'list/map 的元素类型不得再包含 list/map（集合嵌套深度 ≤ 1）',
            ),
          );
          return;
        }
        handleType(ast.element, loc, owner, true);
        return;
      }
    }
  };

  const parseField = (field: FieldDef, owner: { kind: 'struct' | 'table'; name: string }): void => {
    const loc: TypeLocation = {
      file: field.source?.file ?? '',
      fieldPath: field.name,
      line: field.source?.line ?? 0,
    };
    const parsed = parseTypeString(field.type);
    if (!parsed.ok) {
      errors.push(
        typeErr(
          loc,
          'schema.type-parse',
          `字段「${field.name}」的类型字符串「${field.type}」非法：${parsed.message}`,
        ),
      );
      return;
    }
    handleType(parsed.ast, loc, owner, false);
  };

  for (const struct of Object.values(ir.structs)) {
    for (const field of struct.fields) parseField(field, { kind: 'struct', name: struct.name });
  }
  for (const table of Object.values(ir.tables)) {
    for (const field of table.fields) parseField(field, { kind: 'table', name: table.name });
  }
  for (const union of Object.values(ir.unions)) {
    for (const variant of union.variants) {
      if (!names.structs.has(variant.struct)) {
        errors.push({
          table: union.source?.file ?? '',
          rowKey: '',
          fieldPath: `variants.${variant.name}`,
          ruleId: 'schema.bad-ref',
          severity: 'error',
          message: `union「${union.name}」的变体「${variant.name}」指向未知 struct「${variant.struct}」`,
        });
        continue;
      }
      addEdge(edges.unionToStruct, union.name, variant.struct);
    }
  }

  detectCycles(ir, edges, errors);
  return errors;
}

/** struct/union 包含图上找环（union 视为透明节点：struct → union → 变体 struct 的链可成环） */
function detectCycles(ir: SchemaIr, edges: TypeEdges, errors: ValidationError[]): void {
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const name of Object.keys(ir.structs)) color.set(name, 0);
  for (const name of Object.keys(ir.unions)) color.set(name, 0);

  const successors = (node: string): string[] => {
    if (ir.structs[node] !== undefined) {
      return [...(edges.structToStruct.get(node) ?? []), ...(edges.structToUnion.get(node) ?? [])];
    }
    return [...(edges.unionToStruct.get(node) ?? [])];
  };

  const visit = (node: string, path: string[]): void => {
    color.set(node, GREY);
    path.push(node);
    for (const next of successors(node)) {
      const state = color.get(next) ?? 0;
      if (state === GREY) {
        const start = path.indexOf(next);
        const cyclePath = [...path.slice(start), next];
        const reportNode = cyclePath.find((x) => ir.structs[x] !== undefined) ?? next;
        const source = ir.structs[reportNode]?.source;
        errors.push({
          table: source?.file ?? '',
          rowKey: '',
          fieldPath: '',
          ruleId: 'schema.cycle',
          severity: 'error',
          message: `检测到循环嵌套：${cyclePath.join(' → ')}（struct 不得直接或间接包含自身）`,
        });
      } else if (state === 0) {
        visit(next, path);
      }
    }
    path.pop();
    color.set(node, BLACK);
  };

  for (const node of [...Object.keys(ir.structs), ...Object.keys(ir.unions)]) {
    if ((color.get(node) ?? 0) === 0) visit(node, []);
  }
}
