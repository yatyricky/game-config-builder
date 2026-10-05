import type { SchemaIr } from '@gcb/schema';
import { loadSchema } from '@gcb/schema';
import { expect, it } from 'vitest';
import { buildRuleScope, compileRule, parseExpr } from '../src/index.js';

const SCHEMA_YAML = `enums:
  E:
    values:
      - { name: A, value: 0 }
      - { name: B, value: 1 }
structs:
  S:
    fields:
      - { name: n, type: int }
tables:
  T:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: b, type: bool }
      - { name: i, type: int }
      - { name: f, type: float }
      - { name: s, type: string }
      - { name: e, type: "enum<E>" }
      - { name: st, type: "struct<S>" }
      - { name: l, type: "list<int>" }
      - { name: m, type: "map<string, int>" }
`;
const ir: SchemaIr = loadSchema({ 's.yaml': SCHEMA_YAML }).ir;
const table = ir.tables['T'];
if (table === undefined) throw new Error('夹具缺表');
const scope = buildRuleScope(table, ir);

function compile(expr: string) {
  return compileRule(expr, scope);
}

function evalOf(expr: string, row: Record<string, unknown>, pk: string | number = 1) {
  const compiled = compile(expr);
  if (!compiled.ok) throw new Error(`编译失败：${compiled.error}`);
  return compiled.rule.evaluate(row as never, pk);
}

// ---------- 解析与优先级 ----------

it('优先级：&& 高于 ||，* 高于 +（AST 结构断言）', () => {
  const r1 = parseExpr('a || b && c');
  expect(r1.ok).toBe(true);
  if (r1.ok) {
    expect(r1.expr.kind === 'bin' && r1.expr.op).toBe('||');
  }
  const r2 = parseExpr('1 + 2 * 3');
  expect(r2.ok).toBe(true);
  if (r2.ok) {
    expect(r2.expr.kind === 'bin' && r2.expr.op).toBe('+');
  }
  const r3 = parseExpr('(1 + 2) * 3');
  expect(r3.ok).toBe(true);
  if (r3.ok) {
    expect(r3.expr.kind === 'bin' && r3.expr.op).toBe('*');
  }
});

it('and/or 关键字等价 &&/||', () => {
  expect(compile('true and false').ok).toBe(true);
  expect(compile('true or false').ok).toBe(true);
});

it('语法错误：未闭合括号/非法字符/多余尾随', () => {
  expect(compile('(1 || 2').ok).toBe(false);
  expect(compile('1 # 2').ok).toBe(false);
  expect(compile('1 1').ok).toBe(false);
});

// ---------- 编译期类型检查 ----------

it('未定义标识符拒绝', () => {
  const result = compile('nope > 1');
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain('未定义');
});

it('字符串参与算术拒绝（name + 1）', () => {
  const result = compile('s + 1');
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain('数值');
});

it('&& 要求布尔（负）', () => {
  expect(compile('i && b').ok).toBe(false);
});

it('序比较要求同域：int vs string 拒绝', () => {
  expect(compile('i < s').ok).toBe(false);
});

it('枚举成员解析：e == A（正）', () => {
  expect(compile('e == A').ok).toBe(true);
});

it('枚举成员不存在（负）', () => {
  const result = compile('e == Z');
  expect(result.ok).toBe(false);
});

it('$pk 可用；规则必须为布尔（负）', () => {
  expect(compile('$pk > 0').ok).toBe(true);
  expect(compile('i + 1').ok).toBe(false);
});

it('struct 点号导航；集合不可直接寻址', () => {
  expect(compile('st.n >= 0').ok).toBe(true);
  expect(compile('l.n > 1').ok).toBe(false);
});

// ---------- 内置函数 ----------

it('len/contains/containsKey/abs/min/max/matches 全覆盖', () => {
  expect(compile('len(s) > 0').ok).toBe(true);
  expect(compile('len(l) >= 0').ok).toBe(true);
  expect(compile('len(m) >= 0').ok).toBe(true);
  expect(compile('contains(l, 1)').ok).toBe(true);
  expect(compile('contains(l, "x")').ok).toBe(false); // 元素类型不匹配
  expect(compile('containsKey(m, "k")').ok).toBe(true);
  expect(compile('abs(i) >= 0').ok).toBe(true);
  expect(compile('min(i, 3) >= 0').ok).toBe(true);
  expect(compile('max(i, 3.5) > 0').ok).toBe(true);
  expect(compile('matches(s, "^a")').ok).toBe(true);
  expect(compile('len(i) > 0').ok).toBe(false);
});

// ---------- 求值语义 ----------

const ROW = {
  id: 7,
  b: true,
  i: 6,
  f: 2.5,
  s: 'abc',
  e: 'A',
  st: { n: 3 },
  l: [1, 2, 3],
  m: new Map([['k', 5]]),
};

it('规则为真 → 未违规；为假 → 违规', () => {
  expect(evalOf('i > 5', ROW).violated).toBe(false);
  expect(evalOf('i > 6', ROW).violated).toBe(true);
});

it('除零按违规处理（§4.2）', () => {
  const result = evalOf('i / 0 > 1', ROW);
  expect(result.violated).toBe(true);
  expect(result.detail).toContain('除数');
});

it('% 取模与 matches 正则', () => {
  expect(evalOf('i % 2 == 0', ROW).violated).toBe(false);
  expect(evalOf('matches(s, "^ab")', ROW).violated).toBe(false);
  expect(evalOf('matches(s, "^ba")', ROW).violated).toBe(true);
});

it('contains/containsKey/len 运行时', () => {
  expect(evalOf('contains(l, 2)', ROW).violated).toBe(false);
  expect(evalOf('contains(l, 9)', ROW).violated).toBe(true);
  expect(evalOf('containsKey(m, "k")', ROW).violated).toBe(false);
  expect(evalOf('len(l) == 3', ROW).violated).toBe(false);
  expect(evalOf('len(m) == 1', ROW).violated).toBe(false);
  expect(evalOf('len(s) == 3', ROW).violated).toBe(false);
});

it('$pk 求值（int 主键数值比较）', () => {
  expect(evalOf('$pk == 7', ROW, 7).violated).toBe(false);
  expect(evalOf('$pk == 7', ROW, 1).violated).toBe(true);
});

it('枚举比较运行时（成员名即存储值）', () => {
  expect(evalOf('e == A', ROW).violated).toBe(false);
  expect(evalOf('e == B', ROW).violated).toBe(true);
});
