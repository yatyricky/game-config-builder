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
    { name: 'ID', type: { raw: 'string' }, pk: true },
    { name: 'Name', type: { raw: 'string' } },
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
  const bad = { meta: { type: 'struct', name: 'Bad' }, fields: [{ name: 'ID', type: { raw: 'number' }, pk: true }] }
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
  const bad = { meta: { type: 'struct', name: 'Bad' }, fields: [{ name: 'X', type: { raw: 'Weapon' } }] }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Weapon')))
})

test('map/array 子类型引用校验', () => {
  const bad = {
    meta: { type: 'struct', name: 'Bad' },
    fields: [
      { name: 'M', type: { map: true, keyType: { raw: 'string' }, valueType: { raw: 'Nope' } } },
      { name: 'A', type: { array: true, elementType: { raw: 'AlsoNope' } } },
    ],
  }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Nope')))
  assert.ok(issues.some(i => i.message.includes('AlsoNope')))
})

test('跨文件前向引用合法', () => {
  const a = { meta: { type: 'struct', name: 'A' }, fields: [{ name: 'b', type: { raw: 'B' } }] }
  const b = { meta: { type: 'struct', name: 'B' }, fields: [] }
  const { issues } = parseSchemas([
    { file: 'schema/A.json', json: a },
    { file: 'schema/B.json', json: b },
  ])
  assert.deepEqual(issues, [])
})

// ---- M8a：ADT 类型节点 ----

test('ADT：深嵌套类型解析合法（map<string, array<map<string, array<number>>>>）', () => {
  const deep = {
    meta: { type: 'struct', name: 'Deep' },
    fields: [
      {
        name: 'Grid',
        type: {
          map: true,
          keyType: { raw: 'string' },
          valueType: {
            array: true,
            elementType: { map: true, keyType: { raw: 'string' }, valueType: { array: true, elementType: { raw: 'number' } } },
          },
        },
      },
    ],
  }
  const { types, issues } = parseSchemas([{ file: 'schema/Deep.json', json: deep }])
  assert.deepEqual(issues, [])
  const f = (types.get('Deep') as { kind: string; fields: { type: unknown }[] }).fields[0]
  assert.deepEqual(f.type, deep.fields[0].type)
})

test('ADT：递归类型引用合法（struct 引用自身）', () => {
  const tree = { meta: { type: 'struct', name: 'Node' }, fields: [{ name: 'children', type: { array: true, elementType: { raw: 'Node' } } }] }
  const { issues } = parseSchemas([{ file: 'schema/Node.json', json: tree }])
  assert.deepEqual(issues, [])
})

test('ADT：嵌套节点内的悬空引用报错', () => {
  const bad = {
    meta: { type: 'struct', name: 'Bad' },
    fields: [{ name: 'M', type: { array: true, elementType: { map: true, keyType: { raw: 'string' }, valueType: { raw: 'Ghost' } } } }],
  }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Ghost')))
})

test('ADT：type 节点结构非法报错（如 array 缺 elementType）', () => {
  const bad = { meta: { type: 'struct', name: 'Bad' }, fields: [{ name: 'X', type: { array: true } }] }
  const { types, issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.length > 0)
  const def = types.get('Bad')
  if (def?.kind === 'struct') assert.equal(def.fields.length, 0)
})
