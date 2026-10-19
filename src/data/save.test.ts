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
  uniquenessViolations,
  validateRows,
} from './save.ts'
import type { EnumDef, Project, StructDef, TableRow, TypeDef } from './types.ts'

const def: StructDef = {
  kind: 'struct',
  name: 'Skill',
  tables: ['Skill'],
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

test('uniquenessViolations：同 schema 各表拼接查重，溯源到表+行（用户裁决 2026-10-16）', () => {
  const uniqDef: StructDef = {
    kind: 'struct',
    name: 'U',
    tables: ['A', 'B'],
    fields: [
      { name: 'ID', type: { raw: 'string' }, pk: true },
      { name: 'Code', type: { raw: 'string' }, unique: true },
      { name: 'N', type: { raw: 'number' } },
    ],
  }
  const issues = uniquenessViolations(uniqDef, [
    { name: 'A', rows: [{ ID: '1', Code: 'a' }, { ID: '2', Code: 'b' }, { ID: '2', Code: 'c' }] },
    { name: 'B', rows: [{ ID: '2', Code: 'b' }, { ID: '3', Code: 'x' }, {}] },
  ])
  assert.equal(issues.length, 2)
  const id = issues.find(i => i.field === 'ID')
  assert.deepEqual(id?.at, [
    { table: 'A', row: 2 },
    { table: 'A', row: 3 },
    { table: 'B', row: 1 },
  ])
  const code = issues.find(i => i.field === 'Code')
  assert.deepEqual(code?.at, [
    { table: 'A', row: 2 },
    { table: 'B', row: 1 },
  ])
})

test('uniquenessViolations：空记录与空白值跳过，全唯一返回空', () => {
  assert.deepEqual(
    uniquenessViolations(def, [
      { name: 'A', rows: [{ ID: '  ' }, {}] },
      { name: 'B', rows: [{ ID: '1' }, { ID: '2' }] },
    ]),
    [],
  )
})

test('tableViolations：合规返回 null，缺必填逐行报出', () => {
  assert.equal(tableViolations('Skill', def, [{ ID: '1', Name: 'x' }]), null)
  const v = tableViolations('Skill', def, [{ Name: 'x' }, { ID: '1' }, { ID: '1' }])
  assert.equal(v?.table, 'Skill')
  assert.equal(v?.missing.length, 3)
})

test('projectViolations：必填逐表，查重按 schema 分组合并（绑定经 tables 清单）', () => {
  const enumDef: EnumDef = { kind: 'enum', name: 'Kind', flags: false, members: [{ name: 'A', value: 1 }] }
  const effect: StructDef = { kind: 'struct', name: 'Effect', tables: ['A', 'B'], fields: def.fields }
  const project: Project = {
    types: new Map<string, TypeDef>([
      ['Effect', effect],
      ['Kind', enumDef],
    ]),
    tables: [
      { name: 'A', rows: [{ Name: 'x' }] },
      { name: 'B', rows: [{ ID: '1', Name: 'a' }, { ID: '1', Name: 'b' }] },
      { name: 'Kind', rows: [{ x: 1 }] },
      { name: 'Ghost', rows: [{ y: 1 }] },
    ],
  }
  const pv = projectViolations(project)
  assert.deepEqual(pv.missing, [{ table: 'A', missing: [{ row: 1, missing: ['ID'] }] }])
  assert.equal(pv.duplicates.length, 1)
  assert.equal(pv.duplicates[0].field, 'ID')
  assert.deepEqual(pv.duplicates[0].at, [
    { table: 'B', row: 1 },
    { table: 'B', row: 2 },
  ])
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

test('formatDuplicateIssue：跨表溯源文案', () => {
  assert.equal(
    formatDuplicateIssue({ field: 'ID', value: '1', at: [{ table: 'Effect', row: 2 }, { table: 'SpellCast', row: 1 }] }),
    '字段 ID 的值 "1" 在「Effect」第 2 行、「SpellCast」第 1 行重复',
  )
})
