import test from 'node:test'
import assert from 'node:assert/strict'
import { compactRows, isEmptyRecord, tableToJSONL, validateRows } from './save.ts'
import type { StructDef, TableRow } from './types.ts'

const def: StructDef = {
  kind: 'struct',
  name: 'Skill',
  fields: [
    { name: 'ID', type: 'string', pk: true },
    { name: 'Name', type: 'string' },
    { name: 'Note', type: 'string', default: '' },
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
