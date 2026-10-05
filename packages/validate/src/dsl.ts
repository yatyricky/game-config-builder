// 校验 DSL（docs/04 §4，T3.1-T3.3）
// 文法：EBNF 见 §4.1；类型检查 §4.2（编译期拒绝未定义标识符/类型不匹配）；
// 内置函数封闭集合 §4.3；求值错误（除零等）按违规处理。

import { parseTypeString } from '@gcb/schema';
import type { SchemaIr, TableDef, TypeAst } from '@gcb/schema';
import type { Row, RowPk, RowValue } from './rows.js';

// ---------- Token（T3.1） ----------

type Tok =
  | { t: 'num'; v: number; isFloat: boolean }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punct'; v: '(' | ')' | ',' };

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['<', '>', '+', '-', '*', '/', '%', '!']);
const KEYWORD_OPS = new Set(['and', 'or']);

function tokenize(src: string): { ok: true; tokens: Tok[] } | { ok: false; error: string } {
  const tokens: Tok[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const rest = src.slice(i);
      const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
      if (m === null) return { ok: false, error: `位置 ${i}：非法数字` };
      const text = m[0] ?? '';
      tokens.push({ t: 'num', v: Number(text), isFloat: /[.eE]/.test(text) });
      i += text.length;
      continue;
    }
    if (ch === '"') {
      i++;
      let out = '';
      let closed = false;
      while (i < len) {
        const c = src[i];
        if (c === undefined) break;
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === '\\') {
          const next = src[i + 1];
          if (next === 'n') out += '\n';
          else if (next === 't') out += '\t';
          else if (next === '"') out += '"';
          else if (next === '\\') out += '\\';
          else out += next ?? '';
          i += 2;
          continue;
        }
        out += c;
        i++;
      }
      if (!closed) return { ok: false, error: `位置 ${i}：字符串未闭合` };
      tokens.push({ t: 'str', v: out });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      // 标识符允许点号链（st.n）：一次读完整路径，parser 内再拆段
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
      const word = m?.[0] ?? '';
      if (KEYWORD_OPS.has(word)) tokens.push({ t: 'op', v: word });
      else tokens.push({ t: 'ident', v: word });
      i += word.length;
      continue;
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i));
      if (m === null) return { ok: false, error: `位置 ${i}：非法标识符` };
      tokens.push({ t: 'ident', v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ t: 'punct', v: ch });
      i++;
      continue;
    }
    return { ok: false, error: `位置 ${i}：非法字符「${ch}」` };
  }
  return { ok: true, tokens };
}

// ---------- AST 与解析（T3.2） ----------

export type BinOp =
  '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%' | '&&' | '||';

export type Expr =
  | { kind: 'num'; value: number; isFloat: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'pk' }
  | { kind: 'field'; path: string[] }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'not'; operand: Expr }
  | { kind: 'neg'; operand: Expr }
  | { kind: 'bin'; op: BinOp; left: Expr; right: Expr };

export interface ParsedExpr {
  ok: true;
  expr: Expr;
}
export interface ParseFailure {
  ok: false;
  error: string;
}

export function parseExpr(src: string): ParsedExpr | ParseFailure {
  const tokens = tokenize(src);
  if (!tokens.ok) return tokens;
  const cursor: Cursor = { tokens: tokens.tokens, pos: 0 };
  const result = parseOr(cursor);
  if (!result.ok) return result;
  if (cursor.pos !== cursor.tokens.length) {
    return { ok: false, error: `位置 ${cursor.pos}：表达式末尾有多余内容` };
  }
  return { ok: true, expr: result.expr };
}

interface Cursor {
  tokens: Tok[];
  pos: number;
}

function peek(cursor: Cursor): Tok | undefined {
  return cursor.tokens[cursor.pos];
}

function expectPunct(cursor: Cursor, ch: '(' | ')' | ','): string | null {
  const tok = peek(cursor);
  if (tok === undefined || tok.t !== 'punct' || tok.v !== ch) {
    return `期望「${ch}」`;
  }
  cursor.pos++;
  return null;
}

function parseOr(cursor: Cursor): ParsedExpr | ParseFailure {
  let left = parseAnd(cursor);
  if (!left.ok) return left;
  for (;;) {
    const tok = peek(cursor);
    if (tok === undefined || tok.t !== 'op' || (tok.v !== '||' && tok.v !== 'or')) break;
    cursor.pos++;
    const right = parseAnd(cursor);
    if (!right.ok) return right;
    left = { ok: true, expr: { kind: 'bin', op: '||', left: left.expr, right: right.expr } };
  }
  return left;
}

function parseAnd(cursor: Cursor): ParsedExpr | ParseFailure {
  let left = parseCmp(cursor);
  if (!left.ok) return left;
  for (;;) {
    const tok = peek(cursor);
    if (tok === undefined || tok.t !== 'op' || (tok.v !== '&&' && tok.v !== 'and')) break;
    cursor.pos++;
    const right = parseCmp(cursor);
    if (!right.ok) return right;
    left = { ok: true, expr: { kind: 'bin', op: '&&', left: left.expr, right: right.expr } };
  }
  return left;
}

const CMP_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);

function parseCmp(cursor: Cursor): ParsedExpr | ParseFailure {
  const left = parseAdd(cursor);
  if (!left.ok) return left;
  const tok = peek(cursor);
  if (tok === undefined || tok.t !== 'op' || !CMP_OPS.has(tok.v)) return left;
  const op = tok.v as BinOp;
  cursor.pos++;
  const right = parseAdd(cursor);
  if (!right.ok) return right;
  return { ok: true, expr: { kind: 'bin', op, left: left.expr, right: right.expr } };
}

function parseAdd(cursor: Cursor): ParsedExpr | ParseFailure {
  let left = parseMul(cursor);
  if (!left.ok) return left;
  for (;;) {
    const tok = peek(cursor);
    if (tok === undefined || tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) break;
    const op = tok.v as BinOp;
    cursor.pos++;
    const right = parseMul(cursor);
    if (!right.ok) return right;
    left = { ok: true, expr: { kind: 'bin', op, left: left.expr, right: right.expr } };
  }
  return left;
}

function parseMul(cursor: Cursor): ParsedExpr | ParseFailure {
  let left = parseUnary(cursor);
  if (!left.ok) return left;
  for (;;) {
    const tok = peek(cursor);
    if (tok === undefined || tok.t !== 'op' || (tok.v !== '*' && tok.v !== '/' && tok.v !== '%')) {
      break;
    }
    const op = tok.v as BinOp;
    cursor.pos++;
    const right = parseUnary(cursor);
    if (!right.ok) return right;
    left = { ok: true, expr: { kind: 'bin', op, left: left.expr, right: right.expr } };
  }
  return left;
}

function parseUnary(cursor: Cursor): ParsedExpr | ParseFailure {
  const tok = peek(cursor);
  if (tok !== undefined && tok.t === 'op' && (tok.v === '!' || tok.v === '-')) {
    cursor.pos++;
    const operand = parseUnary(cursor);
    if (!operand.ok) return operand;
    return tok.v === '!'
      ? { ok: true, expr: { kind: 'not', operand: operand.expr } }
      : { ok: true, expr: { kind: 'neg', operand: operand.expr } };
  }
  return parsePrimary(cursor);
}

const BUILTIN_NAMES = new Set(['len', 'contains', 'containsKey', 'abs', 'min', 'max', 'matches']);

function parsePrimary(cursor: Cursor): ParsedExpr | ParseFailure {
  const tok = peek(cursor);
  if (tok === undefined) return { ok: false, error: '表达式意外结束' };
  if (tok.t === 'num') {
    cursor.pos++;
    return { ok: true, expr: { kind: 'num', value: tok.v, isFloat: tok.isFloat } };
  }
  if (tok.t === 'str') {
    cursor.pos++;
    return { ok: true, expr: { kind: 'str', value: tok.v } };
  }
  if (tok.t === 'ident') {
    cursor.pos++;
    if (tok.v === 'true') return { ok: true, expr: { kind: 'bool', value: true } };
    if (tok.v === 'false') return { ok: true, expr: { kind: 'bool', value: false } };
    const next = peek(cursor);
    if (next !== undefined && next.t === 'punct' && next.v === '(') {
      if (!BUILTIN_NAMES.has(tok.v)) {
        return { ok: false, error: `未知函数「${tok.v}」` };
      }
      cursor.pos++;
      const args: Expr[] = [];
      const close = expectPunct(cursor, ')');
      if (close === null) return { ok: true, expr: { kind: 'call', name: tok.v, args } };
      for (;;) {
        const arg = parseOr(cursor);
        if (!arg.ok) return arg;
        args.push(arg.expr);
        const sep = peek(cursor);
        if (sep !== undefined && sep.t === 'punct' && sep.v === ',') {
          cursor.pos++;
          continue;
        }
        const endErr = expectPunct(cursor, ')');
        if (endErr !== null) return { ok: false, error: endErr };
        break;
      }
      return { ok: true, expr: { kind: 'call', name: tok.v, args } };
    }
    if (tok.v.startsWith('$')) {
      if (tok.v !== '$pk') return { ok: false, error: `未定义标识符「${tok.v}」` };
      return { ok: true, expr: { kind: 'pk' } };
    }
    return { ok: true, expr: { kind: 'field', path: tok.v.split('.') } };
  }
  if (tok.t === 'punct' && tok.v === '(') {
    cursor.pos++;
    const inner = parseOr(cursor);
    if (!inner.ok) return inner;
    const endErr = expectPunct(cursor, ')');
    if (endErr !== null) return { ok: false, error: endErr };
    return inner;
  }
  return { ok: false, error: `位置 ${cursor.pos}：意外的记号` };
}

// ---------- 类型检查（T3.3） ----------

export interface RuleScope {
  ir: SchemaIr;
  /** 表顶层字段 → 类型 AST */
  fields: Map<string, TypeAst>;
  /** 主键类型（int → VT int；string → VT string） */
  pkType: TypeAst | null;
}

export function buildRuleScope(table: TableDef, ir: SchemaIr): RuleScope {
  const fields = new Map<string, TypeAst>();
  for (const field of table.fields) {
    const parsed = parseTypeStringSafe(field.type);
    if (parsed !== null) fields.set(field.name, parsed);
  }
  const pkField = table.fields.find((f) => f.name === table.primaryKey);
  return {
    ir,
    fields,
    pkType: pkField ? parseTypeStringSafe(pkField.type) : null,
  };
}

function parseTypeStringSafe(type: string): TypeAst | null {
  const parsed = parseTypeString(type);
  return parsed.ok ? parsed.ast : null;
}

interface VT {
  base: 'bool' | 'int' | 'float' | 'string' | 'list' | 'map' | 'enum' | 'struct' | 'union';
  enumName?: string;
  elem?: VT;
  key?: 'int' | 'string';
  structName?: string;
}

const VT_BOOL: VT = { base: 'bool' };
const VT_INT: VT = { base: 'int' };
const VT_FLOAT: VT = { base: 'float' };
const VT_STRING: VT = { base: 'string' };

function astToVT(ast: TypeAst, ir: SchemaIr): VT {
  switch (ast.kind) {
    case 'primitive':
      if (ast.name === 'bool') return VT_BOOL;
      if (ast.name === 'int') return VT_INT;
      if (ast.name === 'float') return VT_FLOAT;
      return VT_STRING;
    case 'enum':
      return { base: 'enum', enumName: ast.enumName };
    case 'ref': {
      const target = ir.tables[ast.tableName];
      if (target === undefined) return VT_STRING;
      const pkField = target.fields.find((f) => f.name === target.primaryKey);
      const pkAst = pkField ? parseTypeStringSafe(pkField.type) : null;
      return pkAst?.kind === 'primitive' && pkAst.name === 'int' ? VT_INT : VT_STRING;
    }
    case 'list':
      return { base: 'list', elem: astToVT(ast.element, ir) };
    case 'map':
      return { base: 'map', key: ast.key, elem: astToVT(ast.element, ir) };
    case 'struct':
      return { base: 'struct', structName: ast.structName };
    case 'union':
      return { base: 'union' };
  }
}

function isNumeric(vt: VT): boolean {
  return vt.base === 'int' || vt.base === 'float';
}

function vtLabel(vt: VT): string {
  return vt.base;
}

function unifyEq(l: VT, r: VT): boolean {
  if (isNumeric(l) && isNumeric(r)) return true;
  if (l.base !== r.base) {
    // enum 与 string 按成员名（字符串）比较
    return (l.base === 'enum' && r.base === 'string') || (l.base === 'string' && r.base === 'enum');
  }
  if (l.base === 'enum' && r.base === 'enum') return l.enumName === r.enumName;
  return true;
}

/** ==/!= 的枚举成员补推：裸标识符不是字段、但另一侧是 enum 时，解析为该枚举成员（字符串） */
function inferWithEnumMembers(side: Expr, other: Expr, scope: RuleScope): InferOk | InferFail {
  const direct = infer(side, scope);
  if (direct.ok) return direct;
  if (side.kind !== 'field') return direct;
  const name = side.path[0] ?? '';
  if (scope.fields.has(name)) return direct;
  const otherVt = infer(other, scope);
  const enumName = otherVt.ok && otherVt.vt.base === 'enum' ? otherVt.vt.enumName : undefined;
  if (enumName === undefined) {
    return { ok: false, error: `未定义标识符「${name}」` };
  }
  const enumDef = scope.ir.enums[enumName];
  if (enumDef === undefined || !enumDef.values.some((v) => v.name === name)) {
    return { ok: false, error: `「${name}」既不是字段也不是枚举「${enumName}」的成员` };
  }
  return { ok: true, vt: VT_STRING };
}

interface InferOk {
  ok: true;
  vt: VT;
}
interface InferFail {
  ok: false;
  error: string;
}

function infer(expr: Expr, scope: RuleScope): InferOk | InferFail {
  const fail = (error: string): InferFail => ({ ok: false, error });
  switch (expr.kind) {
    case 'num':
      return { ok: true, vt: expr.isFloat ? VT_FLOAT : VT_INT };
    case 'str':
      return { ok: true, vt: VT_STRING };
    case 'bool':
      return { ok: true, vt: VT_BOOL };
    case 'pk':
      if (scope.pkType === null) return fail('$pk 在此上下文不可用');
      return { ok: true, vt: astToVT(scope.pkType, scope.ir) };
    case 'field': {
      let ast = scope.fields.get(expr.path[0] ?? '');
      if (ast === undefined) return fail(`未定义标识符「${expr.path[0] ?? ''}」`);
      for (let i = 1; i < expr.path.length; i++) {
        const seg = expr.path[i];
        if (ast === undefined || ast.kind !== 'struct') {
          return fail(`「${expr.path.slice(0, i).join('.')}」不可寻址（仅 struct 字段可点号导航）`);
        }
        const structDef = scope.ir.structs[ast.structName];
        const next = structDef?.fields.find((f) => f.name === seg);
        if (next === undefined) return fail(`struct 中不存在字段「${seg}」`);
        const nextAst = parseTypeStringSafe(next.type);
        if (nextAst === null) return fail(`字段「${seg}」类型非法`);
        ast = nextAst;
      }
      return { ok: true, vt: astToVT(ast, scope.ir) };
    }
    case 'not': {
      const inner = infer(expr.operand, scope);
      if (!inner.ok) return inner;
      if (inner.vt.base !== 'bool') return fail('! 要求布尔操作数');
      return { ok: true, vt: VT_BOOL };
    }
    case 'neg': {
      const inner = infer(expr.operand, scope);
      if (!inner.ok) return inner;
      if (!isNumeric(inner.vt)) return fail('- 要求数值操作数');
      return { ok: true, vt: inner.vt.base === 'float' ? VT_FLOAT : VT_INT };
    }
    case 'bin': {
      // ==/!= 允许一侧是「枚举成员名」裸标识符（§4.2）：先按成员语义补推，再常规推断
      const isEq = expr.op === '==' || expr.op === '!=';
      const l = isEq ? inferWithEnumMembers(expr.left, expr.right, scope) : infer(expr.left, scope);
      if (!l.ok) return l;
      const r = isEq
        ? inferWithEnumMembers(expr.right, expr.left, scope)
        : infer(expr.right, scope);
      if (!r.ok) return r;
      const lv = l.vt;
      const rv = r.vt;
      switch (expr.op) {
        case '&&':
        case '||':
          if (lv.base !== 'bool' || rv.base !== 'bool') return fail('&&/|| 要求布尔操作数');
          return { ok: true, vt: VT_BOOL };
        case '==':
        case '!=':
          if (!unifyEq(lv, rv))
            return fail(`类型不匹配：${vtLabel(lv)} 与 ${vtLabel(rv)} 不可比较`);
          return { ok: true, vt: VT_BOOL };
        case '<':
        case '<=':
        case '>':
        case '>=':
          if (!(
            (isNumeric(lv) && isNumeric(rv)) ||
            (lv.base === 'string' && rv.base === 'string')
          )) {
            return fail(`序比较要求两侧均为数值或字符串，得到 ${vtLabel(lv)} 与 ${vtLabel(rv)}`);
          }
          return { ok: true, vt: VT_BOOL };
        case '+':
        case '-':
        case '*':
        case '/':
        case '%':
          if (!isNumeric(lv) || !isNumeric(rv)) {
            return fail(`算术运算要求数值操作数，得到 ${vtLabel(lv)} 与 ${vtLabel(rv)}`);
          }
          return {
            ok: true,
            vt: expr.op === '/' || lv.base === 'float' || rv.base === 'float' ? VT_FLOAT : VT_INT,
          };
      }
      return fail('未知运算符');
    }
    case 'call':
      return inferCall(expr.name, expr.args, scope);
  }
}

function inferCall(name: string, args: Expr[], scope: RuleScope): InferOk | InferFail {
  const fail = (error: string): InferFail => ({ ok: false, error });
  const inferred: VT[] = [];
  for (const arg of args) {
    const r = infer(arg, scope);
    if (!r.ok) return r;
    inferred.push(r.vt);
  }
  switch (name) {
    case 'len': {
      if (inferred.length !== 1) return fail('len 需要 1 个参数');
      const vt = inferred[0];
      if (vt === undefined || (vt.base !== 'string' && vt.base !== 'list' && vt.base !== 'map')) {
        return fail('len 的参数必须是 string/list/map');
      }
      return { ok: true, vt: VT_INT };
    }
    case 'contains': {
      if (inferred.length !== 2) return fail('contains 需要 2 个参数');
      const list = inferred[0];
      const item = inferred[1];
      if (list === undefined || list.base !== 'list')
        return fail('contains 的第一个参数必须是 list');
      if (item === undefined || list.elem === undefined || !unifyEq(item, list.elem)) {
        return fail('contains 的第二参数类型与列表元素不匹配');
      }
      return { ok: true, vt: VT_BOOL };
    }
    case 'containsKey': {
      if (inferred.length !== 2) return fail('containsKey 需要 2 个参数');
      const map = inferred[0];
      const key = inferred[1];
      if (map === undefined || map.base !== 'map')
        return fail('containsKey 的第一个参数必须是 map');
      const want = map.key === 'int' ? 'int' : 'string';
      if (key === undefined || key.base !== want) {
        return fail(`containsKey 的键类型必须是 ${want}`);
      }
      return { ok: true, vt: VT_BOOL };
    }
    case 'abs': {
      if (inferred.length !== 1) return fail('abs 需要 1 个参数');
      const vt = inferred[0];
      if (vt === undefined || !isNumeric(vt)) return fail('abs 的参数必须是数值');
      return { ok: true, vt: vt.base === 'float' ? VT_FLOAT : VT_INT };
    }
    case 'min':
    case 'max': {
      if (inferred.length < 1) return fail(`${name} 至少需要 1 个参数`);
      if (inferred.some((vt) => !isNumeric(vt))) return fail(`${name} 的参数必须是数值`);
      return { ok: true, vt: inferred.some((vt) => vt.base === 'float') ? VT_FLOAT : VT_INT };
    }
    case 'matches': {
      if (inferred.length !== 2) return fail('matches 需要 2 个参数');
      if (inferred.some((vt) => vt.base !== 'string')) return fail('matches 的参数必须是字符串');
      return { ok: true, vt: VT_BOOL };
    }
    default:
      return fail(`未知函数「${name}」`);
  }
}

// ---------- 求值 ----------

type RV = boolean | number | string | RowValue[] | Map<string | number, RowValue>;

interface EvalCtx {
  row: Row;
  pk: RowPk;
}

type EvalResult = { ok: true; value: RV } | { ok: false; reason: string };

function evaluate(expr: Expr, ctx: EvalCtx, scope: RuleScope): EvalResult {
  const fail = (reason: string): EvalResult => ({ ok: false, reason });
  switch (expr.kind) {
    case 'num':
      return { ok: true, value: expr.value };
    case 'str':
      return { ok: true, value: expr.value };
    case 'bool':
      return { ok: true, value: expr.value };
    case 'pk':
      return { ok: true, value: ctx.pk };
    case 'field': {
      let current: unknown = ctx.row;
      for (const seg of expr.path) {
        if (current === null || typeof current !== 'object' || current instanceof Map) {
          return fail(`「${expr.path.join('.')}」不可求值`);
        }
        current = (current as Row)[seg];
      }
      if (
        typeof current === 'boolean' ||
        typeof current === 'number' ||
        typeof current === 'string'
      ) {
        return { ok: true, value: current };
      }
      if (Array.isArray(current)) return { ok: true, value: current };
      if (current instanceof Map) return { ok: true, value: current };
      return fail(`「${expr.path.join('.')}」的值不可用`);
    }
    case 'not': {
      const inner = evaluate(expr.operand, ctx, scope);
      if (!inner.ok) return inner;
      return { ok: true, value: !inner.value };
    }
    case 'neg': {
      const inner = evaluate(expr.operand, ctx, scope);
      if (!inner.ok) return inner;
      return { ok: true, value: -(inner.value as number) };
    }
    case 'bin':
      return evaluateBin(expr, ctx, scope);
    case 'call':
      return evaluateCall(expr, ctx, scope);
  }
}

function evaluateBin(
  expr: Extract<Expr, { kind: 'bin' }>,
  ctx: EvalCtx,
  scope: RuleScope,
): EvalResult {
  const fail = (reason: string): EvalResult => ({ ok: false, reason });
  if (expr.op === '&&') {
    const l = evaluate(expr.left, ctx, scope);
    if (!l.ok) return l;
    if (!l.value) return { ok: true, value: false };
    const r = evaluate(expr.right, ctx, scope);
    if (!r.ok) return r;
    return { ok: true, value: r.value };
  }
  if (expr.op === '||') {
    const l = evaluate(expr.left, ctx, scope);
    if (!l.ok) return l;
    if (l.value) return { ok: true, value: true };
    const r = evaluate(expr.right, ctx, scope);
    if (!r.ok) return r;
    return { ok: true, value: r.value };
  }
  const l = evaluate(expr.left, ctx, scope);
  if (!l.ok) return l;
  const r = evaluate(expr.right, ctx, scope);
  if (!r.ok) return r;
  const lv = l.value;
  const rv = r.value;
  switch (expr.op) {
    case '==':
      return { ok: true, value: lv === rv };
    case '!=':
      return { ok: true, value: lv !== rv };
    case '<':
      return { ok: true, value: (lv as number | string) < (rv as number | string) };
    case '<=':
      return { ok: true, value: (lv as number | string) <= (rv as number | string) };
    case '>':
      return { ok: true, value: (lv as number | string) > (rv as number | string) };
    case '>=':
      return { ok: true, value: (lv as number | string) >= (rv as number | string) };
    case '+':
      return { ok: true, value: (lv as number) + (rv as number) };
    case '-':
      return { ok: true, value: (lv as number) - (rv as number) };
    case '*':
      return { ok: true, value: (lv as number) * (rv as number) };
    case '/': {
      if (rv === 0) return fail('除数为 0');
      return { ok: true, value: (lv as number) / (rv as number) };
    }
    case '%': {
      if (rv === 0) return fail('取模除数为 0');
      return { ok: true, value: (lv as number) % (rv as number) };
    }
  }
  return fail('未知运算符');
}

const regexCache = new Map<string, RegExp>();

function evaluateCall(
  expr: Extract<Expr, { kind: 'call' }>,
  ctx: EvalCtx,
  scope: RuleScope,
): EvalResult {
  const fail = (reason: string): EvalResult => ({ ok: false, reason });
  const values: RV[] = [];
  for (const arg of expr.args) {
    const r = evaluate(arg, ctx, scope);
    if (!r.ok) return r;
    values.push(r.value);
  }
  switch (expr.name) {
    case 'len': {
      const v = values[0];
      if (typeof v === 'string') return { ok: true, value: v.length };
      if (Array.isArray(v)) return { ok: true, value: v.length };
      if (v instanceof Map) return { ok: true, value: v.size };
      return fail('len 的参数不可求长度');
    }
    case 'contains': {
      const list = values[0];
      const item = values[1];
      if (!Array.isArray(list)) return fail('contains 的第一个参数不是列表');
      return { ok: true, value: list.some((x) => x === item) };
    }
    case 'containsKey': {
      const map = values[0];
      const key = values[1];
      if (!(map instanceof Map)) return fail('containsKey 的第一个参数不是 map');
      return { ok: true, value: map.has(key as string | number) };
    }
    case 'abs':
      return { ok: true, value: Math.abs(values[0] as number) };
    case 'min':
      return { ok: true, value: Math.min(...(values as number[])) };
    case 'max':
      return { ok: true, value: Math.max(...(values as number[])) };
    case 'matches': {
      const pattern = values[1];
      if (typeof pattern !== 'string') return fail('matches 的模式必须是字符串');
      let regex = regexCache.get(pattern);
      if (regex === undefined) {
        regex = new RegExp(pattern);
        regexCache.set(pattern, regex);
      }
      return { ok: true, value: regex.test(values[0] as string) };
    }
    default:
      return fail(`未知函数「${expr.name}」`);
  }
}

// ---------- 编译入口 ----------

export interface Evaluation {
  violated: boolean;
  detail?: string;
}

export interface CompiledRule {
  evaluate(row: Row, pk: RowPk): Evaluation;
}

export type CompileResult = { ok: true; rule: CompiledRule } | { ok: false; error: string };

/** 编译前 AST 重写：==/!= 的「枚举成员裸标识符」→ 字符串字面量（§4.2），使运行时按成员名比较 */
function rewriteEnumMembers(expr: Expr, scope: RuleScope): Expr {
  switch (expr.kind) {
    case 'bin': {
      if (expr.op === '==' || expr.op === '!=') {
        const left = rewriteEnumMembers(expr.left, scope);
        const right = rewriteEnumMembers(expr.right, scope);
        const leftIsMember = isMemberIdent(left, scope);
        const rightIsMember = isMemberIdent(right, scope);
        if (leftIsMember && !rightIsMember) {
          const vt = infer(right, scope);
          const name = memberName(left);
          if (vt.ok && vt.vt.base === 'enum' && isEnumMember(name, vt.vt.enumName, scope)) {
            return { ...expr, left: { kind: 'str', value: name }, right };
          }
        }
        if (rightIsMember && !leftIsMember) {
          const vt = infer(left, scope);
          const name = memberName(right);
          if (vt.ok && vt.vt.base === 'enum' && isEnumMember(name, vt.vt.enumName, scope)) {
            return { ...expr, left, right: { kind: 'str', value: name } };
          }
        }
        return { ...expr, left, right };
      }
      return {
        ...expr,
        left: rewriteEnumMembers(expr.left, scope),
        right: rewriteEnumMembers(expr.right, scope),
      };
    }
    case 'not':
      return { ...expr, operand: rewriteEnumMembers(expr.operand, scope) };
    case 'neg':
      return { ...expr, operand: rewriteEnumMembers(expr.operand, scope) };
    case 'call':
      return { ...expr, args: expr.args.map((a) => rewriteEnumMembers(a, scope)) };
    default:
      return expr;
  }
}

function isEnumMember(name: string, enumName: string | undefined, scope: RuleScope): boolean {
  if (enumName === undefined) return false;
  const enumDef = scope.ir.enums[enumName];
  return enumDef !== undefined && enumDef.values.some((v) => v.name === name);
}

function isMemberIdent(e: Expr, scope: RuleScope): boolean {
  return e.kind === 'field' && e.path.length === 1 && !scope.fields.has(e.path[0] ?? '');
}

function memberName(e: Expr): string {
  return e.kind === 'field' ? (e.path[0] ?? '') : '';
}

/** 编译规则表达式：语法 + 静态类型检查；结果必须为布尔（§4.4） */
export function compileRule(expr: string, scope: RuleScope): CompileResult {
  const parsed = parseExpr(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const rewritten = rewriteEnumMembers(parsed.expr, scope);
  const inferred = infer(rewritten, scope);
  if (!inferred.ok) return { ok: false, error: inferred.error };
  if (inferred.vt.base !== 'bool') return { ok: false, error: '规则表达式必须求值为布尔' };
  return {
    ok: true,
    rule: {
      evaluate(row: Row, pk: RowPk): Evaluation {
        const result = evaluate(rewritten, { row, pk }, scope);
        if (!result.ok) return { violated: true, detail: result.reason };
        if (typeof result.value !== 'boolean')
          return { violated: true, detail: '规则结果不是布尔值' };
        return { violated: !result.value };
      },
    },
  };
}
