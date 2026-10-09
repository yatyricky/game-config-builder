import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCellEdit, missingRequired, requiredFields } from './edit.ts'
import type { StructDef, TableRow } from './types.ts'

const def: StructDef = {
  kind: 'struct',
  name: 'Skill',
  fields: [
    { name: 'ID', type: { raw: 'string' }, pk: true },
    { name: 'Name', type: { raw: 'string' } },
    { name: 'Note', type: { raw: 'string' }, default: '' },
  ],
}

test('applyCellEdit 覆盖已有字段，写时复制', () => {
  const rows: TableRow[] = [
    { ID: '001', Name: 'Damage' },
    { ID: '002', Name: 'Heal' },
  ]
  const next = applyCellEdit(rows, 0, 'Name', 'Blast')
  assert.equal(next.length, 2)
  assert.equal(next[0].Name, 'Blast')
  assert.equal(next[0].ID, '001')
  assert.equal(next[1], rows[1])
  assert.equal(rows[0].Name, 'Damage')
})

test('applyCellEdit 越过末尾，稀疏补空记录', () => {
  const rows: TableRow[] = [{ ID: '001' }]
  const next = applyCellEdit(rows, 3, 'Name', 'x')
  assert.equal(next.length, 4)
  assert.deepEqual(next[1], {})
  assert.deepEqual(next[2], {})
  assert.equal(next[3].Name, 'x')
  assert.equal(rows.length, 1)
})

test('无 default 属性的字段为必填', () => {
  const req = requiredFields(def)
  assert.equal(req.length, 2)
  assert.equal(req[0].name, 'ID')
  assert.equal(req[1].name, 'Name')
})

test('必填缺失判定，undefined/null/空串', () => {
  const ok: TableRow = { ID: '001', Name: 'x', Note: '' }
  assert.equal(missingRequired(def, ok).length, 0)

  const noName: TableRow = { ID: '001', Note: 'n' }
  assert.equal(missingRequired(def, noName).length, 1)
  assert.equal(missingRequired(def, noName)[0].name, 'Name')

  const blank: TableRow = {}
  assert.equal(missingRequired(def, blank).length, 2)

  const nullId: TableRow = { ID: null, Name: 'x' }
  assert.equal(missingRequired(def, nullId).length, 1)
  assert.equal(missingRequired(def, nullId)[0].name, 'ID')
})

test('必填缺失：trim 空串算缺失', () => {
  const blankId: TableRow = { ID: '   ', Name: 'x' }
  const issues = missingRequired(def, blankId)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].name, 'ID')
})
