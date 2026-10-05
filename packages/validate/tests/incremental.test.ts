import type { SchemaIr } from '@gcb/schema';
import { loadSchema } from '@gcb/schema';
import { expect, it } from 'vitest';
import {
  buildIndex,
  typeRows,
  validateFull,
  validateIncremental,
  type RawRow,
  type RawRowsByTable,
  type TypedRow,
} from '../src/index.js';

const SCHEMA_YAML = `structs:
  S:
    fields:
      - { name: n, type: int }
tables:
  Item:
    primaryKey: id
    displayField: name
    fields:
      - { name: id, type: int }
      - { name: name, type: string }
      - { name: qty, type: int, rule: "qty >= 1" }
      - { name: box, type: "ref<Box>" }
  Box:
    primaryKey: id
    displayField: id
    fields:
      - { name: id, type: int }
      - { name: code, type: string, unique: true }
`;
const ir: SchemaIr = loadSchema({ 's.yaml': SCHEMA_YAML }).ir;

function raw(items: Array<Record<string, unknown>>): RawRow[] {
  return items.map((json, i) => ({ json, line: i + 1 }));
}

function seedTables(): Map<string, TypedRow[]> {
  const rawByTable: RawRowsByTable = new Map([
    [
      'Item',
      raw([
        { id: 1, name: 'a', qty: 1, box: 10 },
        { id: 2, name: 'b', qty: 2, box: 10 },
      ]),
    ],
    [
      'Box',
      raw([
        { id: 10, code: 'X' },
        { id: 11, code: 'Y' },
      ]),
    ],
  ]);
  const typed = new Map<string, TypedRow[]>();
  for (const [name, rows] of rawByTable) {
    const table = ir.tables[name];
    if (table === undefined) throw new Error('缺表');
    typed.set(name, typeRows(table, ir, rows).rows);
  }
  return typed;
}

it('正确性：编辑数值触发 rule 违规（增量与全量一致）', () => {
  const tables = seedTables();
  const index = buildIndex(ir, tables);
  const items = tables.get('Item');
  if (items === undefined) throw new Error('缺 Item');
  const row1 = items.find((r) => r.pk === '1');
  if (row1 === undefined) throw new Error('缺行');
  row1.row['qty'] = 0; // 违反 qty >= 1
  const errors = validateIncremental(ir, tables, [{ table: 'Item', keys: ['1'] }], index);
  expect(errors.some((e) => e.ruleId === 'rule.field' && e.rowKey === '1')).toBe(true);
  // 与全量对账：该行相关错误一致
  const full = validateFull(ir, toRaw(tables));
  expect(errors.filter((e) => e.ruleId !== 'pk.order')).toEqual(
    full.filter((e) => e.ruleId !== 'pk.order'),
  );
});

it('正确性：删除被引用 Box → 引用方 fk.missing（入边）', () => {
  const tables = seedTables();
  const index = buildIndex(ir, tables);
  const boxes = tables.get('Box');
  if (boxes === undefined) throw new Error('缺 Box');
  const box10 = boxes.find((r) => r.pk === '10');
  if (box10 === undefined) throw new Error('缺行');
  // 从数据集中删除 box 10 并同步索引
  tables.set(
    'Box',
    boxes.filter((r) => r.pk !== '10'),
  );
  index.removeRow(ir.tables['Box'] as NonNullable<SchemaIr['tables'][string]>, box10);
  const errors = validateIncremental(ir, tables, [{ table: 'Box', keys: ['10'] }], index);
  const fk = errors.filter((e) => e.ruleId === 'fk.missing');
  expect(fk).toHaveLength(2); // Item 1 与 Item 2 都引用 box 10
  for (const e of fk) expect(e.message).toContain('Box#10');
});

it('正确性：pk 重复与 unique 重复经索引检出', () => {
  const tables = seedTables();
  const index = buildIndex(ir, tables);
  const boxes = tables.get('Box');
  if (boxes === undefined) throw new Error('缺 Box');
  const box11 = boxes.find((r) => r.pk === '11');
  if (box11 === undefined) throw new Error('缺行');
  const previous: TypedRow = { ...box11, row: { ...box11.row } }; // 旧值快照
  box11.row['code'] = 'X'; // 与 box 10 的 unique code 冲突
  const boxTable = ir.tables['Box'];
  if (boxTable === undefined) throw new Error('缺表');
  index.upsertRow(boxTable, box11, previous); // 编辑器契约：变更后同步索引（带旧值）
  const errors = validateIncremental(ir, tables, [{ table: 'Box', keys: ['11'] }], index);
  expect(errors.some((e) => e.ruleId === 'unique.duplicate')).toBe(true);
});

it('性能：10⁵ 行规模单行变更 ≤ 5ms（T3.7 验收，超时即红）', () => {
  const items: RawRow[] = [];
  const boxes: RawRow[] = [];
  for (let i = 1; i <= 100000; i++) {
    items.push({ json: { id: i, name: `n${i}`, qty: 1, box: 10 }, line: i });
  }
  boxes.push({ json: { id: 10, code: 'X' }, line: 1 });
  const rawByTable: RawRowsByTable = new Map([
    ['Item', items],
    ['Box', boxes],
  ]);
  const typed = new Map<string, TypedRow[]>();
  for (const [name, rows] of rawByTable) {
    const table = ir.tables[name];
    if (table === undefined) throw new Error('缺表');
    typed.set(name, typeRows(table, ir, rows).rows);
  }
  const index = buildIndex(ir, typed);
  const row50000 = typed.get('Item')?.find((r) => r.pk === '50000');
  if (row50000 === undefined) throw new Error('缺行');
  row50000.row['qty'] = 3; // 仍合法；走完整增量路径
  // 预热 JIT
  validateIncremental(ir, typed, [{ table: 'Item', keys: ['50000'] }], index);
  const start = performance.now();
  const errors = validateIncremental(ir, typed, [{ table: 'Item', keys: ['50000'] }], index);
  const elapsed = performance.now() - start;
  expect(errors).toEqual([]);
  expect(elapsed).toBeLessThan(5);
});

function toRaw(tables: Map<string, TypedRow[]>): RawRowsByTable {
  const out: RawRowsByTable = new Map();
  for (const [name, rows] of tables) {
    out.set(
      name,
      rows.map((r, i) => ({ json: structuredCloneCompat(r.row), line: i + 1 })),
    );
  }
  return out;
}

function structuredCloneCompat(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, mapReplacer));
}

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) out[String(k)] = v;
    return out;
  }
  return value;
}
