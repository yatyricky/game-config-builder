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
  meta: { type: 'struct', name: 'Effect' }, tables: ['Effect'],
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
  const bad = { meta: { type: 'struct', name: 'Bad' }, tables: ['Bad'], fields: [{ name: 'ID', type: { raw: 'number' }, pk: true }] }
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
  const bad = { meta: { type: 'struct', name: 'Bad' }, tables: ['Bad'], fields: [{ name: 'X', type: { raw: 'Weapon' } }] }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Weapon')))
})

test('map/array 子类型引用校验', () => {
  const bad = {
    meta: { type: 'struct', name: 'Bad' }, tables: ['Bad'],
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
  const a = { meta: { type: 'struct', name: 'A' }, tables: ['A'], fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }, { name: 'b', type: { raw: 'B' } }] }
  const b = { meta: { type: 'struct', name: 'B' }, tables: ['B'], fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }] }
  const { issues } = parseSchemas([
    { file: 'schema/A.json', json: a },
    { file: 'schema/B.json', json: b },
  ])
  assert.deepEqual(issues, [])
})

// ---- M8a：ADT 类型节点 ----

test('ADT：深嵌套类型解析合法（map<string, array<map<string, array<number>>>>）', () => {
  const deep = {
    meta: { type: 'struct', name: 'Deep' }, tables: ['Deep'],
    fields: [
      { name: 'ID', type: { raw: 'string' }, pk: true },
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
  const tree = { meta: { type: 'struct', name: 'Node' }, tables: ['Node'], fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }, { name: 'children', type: { array: true, elementType: { raw: 'Node' } } }] }
  const { issues } = parseSchemas([{ file: 'schema/Node.json', json: tree }])
  assert.deepEqual(issues, [])
})

test('ADT：嵌套节点内的悬空引用报错', () => {
  const bad = {
    meta: { type: 'struct', name: 'Bad' }, tables: ['Bad'],
    fields: [{ name: 'M', type: { array: true, elementType: { map: true, keyType: { raw: 'string' }, valueType: { raw: 'Ghost' } } } }],
  }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('Ghost')))
})

test('ADT：type 节点结构非法报错（如 array 缺 elementType）', () => {
  const bad = { meta: { type: 'struct', name: 'Bad' }, tables: ['Bad'], fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }, { name: 'X', type: { array: true } }] }
  const { types, issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.length > 0)
  const def = types.get('Bad')
  // 非法 X 字段被跳过，仅剩合法的 ID
  if (def?.kind === 'struct') assert.equal(def.fields.length, 1)
})


test('校验：struct 缺少 pk 字段报 issue（裁决 2026-10-10）', () => {
  const noPk = { meta: { type: 'struct', name: 'NoPk' }, tables: ['NoPk'], fields: [{ name: 'X', type: { raw: 'string' } }] }
  const { issues } = parseSchemas([{ file: 'schema/NoPk.json', json: noPk }])
  assert.ok(issues.some(i => i.message.includes('缺少 pk')))
})

test('校验：tables 清单一等公民——缺失/非法报 issue，跨类型冲突报 issue（2026-10-16 裁决）', () => {
  const missing = { meta: { type: 'struct', name: 'NoTables' }, fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }] }
  const noTables = parseSchemas([{ file: 't1', json: missing }])
  assert.ok(noTables.issues.some(i => i.message.includes('tables')))
  assert.equal(noTables.types.size, 0)
  const invalid = {
    meta: { type: 'struct', name: 'BadTables' },
    tables: ['A', ''],
    fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }],
  }
  assert.ok(parseSchemas([{ file: 't2', json: invalid }]).issues.some(i => i.message.includes('tables')))
  const cross = [
    { file: 'a', json: { meta: { type: 'struct', name: 'X' }, tables: ['T'], fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }] } },
    { file: 'b', json: { meta: { type: 'struct', name: 'Y' }, tables: ['T'], fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }] } },
  ]
  assert.ok(parseSchemas(cross).issues.some(i => i.message.includes('同时被')))
})

test('校验：枚举成员 name/displayName/value 重复报 issue（裁决 2026-10-10）', () => {
  const dupName = { meta: { type: 'enum', name: 'E1' }, enums: [{ name: 'A', value: 1 }, { name: 'A', value: 2 }] }
  assert.ok(parseSchemas([{ file: 'e1', json: dupName }]).issues.some(i => i.message.includes('成员名重复')))
  const dupValue = { meta: { type: 'enum', name: 'E2' }, enums: [{ name: 'A', value: 1 }, { name: 'B', value: 1 }] }
  assert.ok(parseSchemas([{ file: 'e2', json: dupValue }]).issues.some(i => i.message.includes('成员值重复')))
  const dupDn = {
    meta: { type: 'enum', name: 'E3' },
    enums: [
      { name: 'A', value: 1, displayName: '火' },
      { name: 'B', value: 2, displayName: '火' },
    ],
  }
  assert.ok(parseSchemas([{ file: 'e3', json: dupDn }]).issues.some(i => i.message.includes('displayName 重复')))
})

test('校验：map 键不允许 array/map 复合类型（裁决 2026-10-10）', () => {
  const bad = {
    meta: { type: 'struct', name: 'Bad' }, tables: ['Bad'],
    fields: [
      { name: 'ID', type: { raw: 'string' }, pk: true },
      { name: 'M', type: { map: true, keyType: { array: true, elementType: { raw: 'string' } }, valueType: { raw: 'number' } } },
    ],
  }
  const { issues } = parseSchemas([{ file: 'schema/Bad.json', json: bad }])
  assert.ok(issues.some(i => i.message.includes('map 键不允许')))
})
