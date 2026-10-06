import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSchemas } from './schemaParser.ts'

const school = {
  meta: { type: 'enum', name: 'School', flags: true },
  enums: [
    { name: 'Fire', value: 1 },
    { name: 'Earth', value: 2 },
  ],
}
const effect = {
  meta: { type: 'struct', name: 'Effect' },
  fields: [
    { name: 'ID', type: 'string', pk: true },
    { name: 'Name', type: 'string' },
  ],
}

test('合法 schema 合并', () => {
  const { types, issues } = parseSchemas([
    { file: 'schema/School.json', json: school },
    { file: 'schema/Effect.json', json: effect },
  ])
  assert.deepEqual(issues, [])
  assert.equal(types.size, 2)
  const e = types.get('School')
  assert.equal(e?.kind, 'enum')
  if (e?.kind === 'enum') {
    assert.equal(e.flags, true)
    assert.deepEqual(e.members, [
      { name: 'Fire', value: 1 },
      { name: 'Earth', value: 2 },
    ])
  }
  assert.equal(types.get('Effect')?.kind, 'struct')
})

test('pk 字段必须为 string', () => {
  const bad = { meta: { type: 'struct', name: 'Bad' }, fields: [{ name: 'ID', type: 'number', pk: true }] }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('pk')))
})

test('自定义类型名不得与 js 基础类型冲突', () => {
  const bad = { meta: { type: 'enum', name: 'string' }, enums: [] }
  const { types, issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('基础类型')))
  assert.equal(types.size, 0)
})

test('引用不存在的类型', () => {
  const bad = { meta: { type: 'struct', name: 'Bad' }, fields: [{ name: 'X', type: 'Weapon' }] }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Weapon')))
})

test('map/array 子类型引用校验', () => {
  const bad = {
    meta: { type: 'struct', name: 'Bad' },
    fields: [
      { name: 'M', map: true, keyType: 'string', valueType: 'Nope' },
      { name: 'A', array: true, elementType: 'AlsoNope' },
    ],
  }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Nope')))
  assert.ok(issues.some(i => i.message.includes('AlsoNope')))
})

test('跨文件前向引用合法', () => {
  const a = { meta: { type: 'struct', name: 'A' }, fields: [{ name: 'b', type: 'B' }] }
  const b = { meta: { type: 'struct', name: 'B' }, fields: [] }
  const { issues } = parseSchemas([
    { file: 'schema/A.json', json: a },
    { file: 'schema/B.json', json: b },
  ])
  assert.deepEqual(issues, [])
})
