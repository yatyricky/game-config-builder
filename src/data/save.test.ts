import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compactRows,
  formatDuplicateIssue,
  formatMissingSummary,
  isEmptyRecord,
  projectViolations,
  tableToJSONL,
  tableViolations,
  validateRows,
  validateUniqueness,
} from './save.ts'
import type { EnumDef, Project, StructDef, TableRow, TypeDef } from './types.ts'

const def: StructDef = {
  kind: 'struct',
  name: 'Skill',
  fields: [
    { name: 'ID', type: { raw: 'string' }, pk: true },
    { name: 'Name', type: { raw: 'string' } },
    { name: 'Note', type: { raw: 'string' }, default: '' },
  ],
}

test('isEmptyRecord：无键或全 undefined 均为空', () => {
  assert.equal(isEmptyRecord({}), true)
  assert.equal(isEmptyRecord({ ID: undefined }), true)
  assert.equal(isEmptyRecord({ ID: '001' }), false)
  assert.equal(isEmptyRecord({ ID: undefined, Name: 'x' }), false)
})

test('compactRows：删除空记录并保持顺序', () => {
  const rows: TableRow[] = [{ ID: '001' }, {}, { ID: '002' }, { Note: undefined }]
  const next = compactRows(rows)
  assert.equal(next.length, 2)
  assert.equal(next[0].ID, '001')
  assert.equal(next[1].ID, '002')
  assert.equal(rows.length, 4)
})

test('validateRows：空记录不拦，缺必填按行报出', () => {
  const rows: TableRow[] = [
    { ID: '001', Name: 'x' },
    {},
    { ID: '002' },
    { Name: 'y', Note: 'n' },
  ]
  const issues = validateRows(def, rows)
  assert.equal(issues.length, 2)
  assert.equal(issues[0].row, 3)
  assert.deepEqual(issues[0].missing, ['Name'])
  assert.equal(issues[1].row, 4)
  assert.deepEqual(issues[1].missing, ['ID'])
})

test('validateRows：全部合规返回空', () => {
  const rows: TableRow[] = [
    { ID: '001', Name: 'x', Note: '' },
    { ID: '002', Name: 'y' },
  ]
  assert.deepEqual(validateRows(def, rows), [])
})

test('tableToJSONL：每行一个 JSON 带尾随换行', () => {
  const rows: TableRow[] = [{ ID: '001', Name: 'Damage' }, { ID: '002', Name: 'Heal' }]
  assert.equal(tableToJSONL(rows), '{"ID":"001","Name":"Damage"}\n{"ID":"002","Name":"Heal"}\n')
})

test('tableToJSONL：空表为空串，保留键序', () => {
  assert.equal(tableToJSONL([]), '')
  assert.equal(tableToJSONL([{ Name: 'x', ID: '001' }]), '{"Name":"x","ID":"001"}\n')
})

test('裁决：字符串 trim 后全空的记录保存时删除', () => {
  const rows: TableRow[] = [{ ID: '  ', Name: '   ' }, { ID: '001', Name: ' x ' }]
  const next = compactRows(rows)
  assert.equal(next.length, 1)
  assert.equal(next[0].ID, '001')
})

test('validateUniqueness：pk/unique 非空值重复报出，空值不查（裁决 2026-10-10）', () => {
  const uniqDef: StructDef = {
    kind: 'struct',
    name: 'U',
    fields: [
      { name: 'ID', type: { raw: 'string' }, pk: true },
      { name: 'Code', type: { raw: 'string' }, unique: true },
      { name: 'N', type: { raw: 'number' } },
    ],
  }
  const rows: TableRow[] = [
    { ID: '1', Code: 'a', N: 0 },
    { ID: '1', Code: 'b' },
    { ID: '', Code: 'b' },
    {},
  ]
  const issues = validateUniqueness(uniqDef, rows)
  assert.equal(issues.length, 2)
  const id = issues.find(i => i.field === 'ID')
  assert.deepEqual(id?.rows, [1, 2])
  const code = issues.find(i => i.field === 'Code')
  assert.deepEqual(code?.rows, [2, 3])
})

test('validateUniqueness：全唯一返回空', () => {
  const rows: TableRow[] = [{ ID: '1' }, { ID: '2' }]
  assert.deepEqual(validateUniqueness(def, rows), [])
})

test('tableViolations：合规返回 null，违规聚合必填与查重', () => {
  assert.equal(tableViolations('Skill', def, [{ ID: '1', Name: 'x' }]), null)
  const v = tableViolations('Skill', def, [{ Name: 'x' }, { ID: '1' }, { ID: '1' }])
  assert.equal(v?.table, 'Skill')
  assert.equal(v?.missing.length, 3)
  assert.deepEqual(v?.duplicates[0], { field: 'ID', value: '1', rows: [2, 3] })
})

test('projectViolations：跨表聚合，跳过 enum 与缺类型的表', () => {
  const enumDef: EnumDef = { kind: 'enum', name: 'Kind', flags: false, members: [{ name: 'A', value: 1 }] }
  const project: Project = {
    types: new Map<string, TypeDef>([
      ['Skill', def],
      ['Kind', enumDef],
    ]),
    tables: [
      { name: 'Skill', rows: [{ Name: 'x' }] },
      { name: 'Kind', rows: [{ x: 1 }] },
      { name: 'Ghost', rows: [{ y: 1 }] },
    ],
  }
  const vs = projectViolations(project)
  assert.equal(vs.length, 1)
  assert.equal(vs[0].table, 'Skill')
  assert.deepEqual(vs[0].missing, [{ row: 1, missing: ['ID'] }])
  assert.deepEqual(vs[0].duplicates, [])
})

test('formatMissingSummary：首条 + 「 等 N 行」后缀', () => {
  assert.equal(formatMissingSummary([{ row: 3, missing: ['Name'] }]), '第 3 行缺少必填：Name')
  assert.equal(
    formatMissingSummary([
      { row: 2, missing: ['ID'] },
      { row: 5, missing: ['ID', 'Name'] },
    ]),
    '第 2 行缺少必填：ID 等 2 行',
  )
})

test('formatDuplicateIssue：文案', () => {
  assert.equal(formatDuplicateIssue({ field: 'ID', value: '1', rows: [2, 3] }), '字段 ID 的值 "1" 在第 2、3 行重复')
})
