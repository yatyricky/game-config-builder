import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addField,
  addMember,
  canDeleteField,
  canDeleteType,
  canEditFieldType,
  canToggleFlags,
  createEnumType,
  createStructType,
  isPowersOfTwo,
  memberValueUsed,
  nextEnumValue,
  nextFieldName,
  pkLockState,
  removeField,
  removeMember,
  renameFieldCascade,
  serializeEnum,
  serializeStruct,
  typeReferenced,
  updateField,
  updateMember,
  validateFieldName,
  validateMemberDisplayName,
  validateMemberName,
  validateMemberValue,
  validateTypeName,
} from './schemaEdit.ts'
import type { EnumDef, Project, StructDef, TableRow, TypeDef } from './types.ts'

const school: EnumDef = {
  kind: 'enum',
  name: 'School',
  flags: true,
  members: [
    { name: 'Fire', value: 1 },
    { name: 'Earth', value: 2 },
    { name: 'Air', value: 4 },
    { name: 'Water', value: 8 },
  ],
}

const skill: StructDef = {
  kind: 'struct',
  name: 'Skill',
  fields: [
    { name: 'ID', type: { raw: 'string' }, pk: true, index: true, unique: true },
    { name: 'Name', type: { raw: 'string' } },
    { name: 'School', type: { raw: 'School' } },
    { name: 'Effects', type: { map: true, keyType: { raw: 'string' }, valueType: { raw: 'number' } } },
  ],
}

const project: Project = {
  types: new Map<string, TypeDef>([
    ['School', school],
    ['Skill', skill],
  ]),
  tables: [{ name: 'Skill', rows: [{ ID: '0001', Name: 'Strike', School: 6 }] }],
}

test('validateTypeName：空/冲突/重复', () => {
  assert.ok(validateTypeName('  ', project.types))
  assert.ok(validateTypeName('string', project.types))
  assert.ok(validateTypeName('School', project.types))
  assert.equal(validateTypeName('Weapon', project.types), null)
  assert.ok(validateTypeName(' Weapon ', project.types))
})

test('validateFieldName：空/重复（排除自身）', () => {
  assert.ok(validateFieldName('', skill, null))
  assert.ok(validateFieldName('ID', skill, null))
  assert.equal(validateFieldName('ID', skill, 'ID'), null)
  assert.ok(validateFieldName(' Name ', skill, 'Name'))
})

test('validateMember 三重唯一（name/displayName/value，均排除自身）', () => {
  const e: EnumDef = { kind: 'enum', name: 'E', flags: false, members: [{ name: 'A', value: 1, displayName: '甲' }, { name: 'B', value: 2 }] }
  assert.ok(validateMemberName('A', e, null))
  assert.equal(validateMemberName('A', e, 'A'), null)
  assert.ok(validateMemberDisplayName('甲', e, null))
  assert.equal(validateMemberDisplayName('乙', e, null), null)
  assert.equal(validateMemberDisplayName('', e, null), null)
  assert.ok(validateMemberValue('1', e, null))
  assert.ok(validateMemberValue('x', e, null))
  assert.equal(validateMemberValue('3', e, null), null)
  assert.equal(validateMemberValue('1', e, 'A'), null)
})

test('typeReferenced：任意深度引用；自引用不算', () => {
  assert.equal(typeReferenced(project.types, 'School'), true)
  assert.equal(typeReferenced(project.types, 'Skill'), false)
})

test('canDeleteType：无引用+无数据才可删', () => {
  assert.equal(canDeleteType(project, 'School'), false) // 被引用
  assert.equal(canDeleteType(project, 'Skill'), false) // 有数据
  const noTable: Project = { types: new Map([['X', skill]]), tables: [] }
  assert.equal(canDeleteType(noTable, 'X'), true) // 无引用 + 无表
  const emptyTableOnly: Project = { types: new Map([['X', skill]]), tables: [{ name: 'X', rows: [] }] }
  assert.equal(canDeleteType(emptyTableOnly, 'X'), true) // 表存在但压缩后 0 行 → 视为无数据
})

test('字段使用判定：used → 删除/改类型锁定', () => {
  const rows: TableRow[] = [{ ID: '1', Name: 'x' }, { ID: '2' }]
  assert.equal(canDeleteField(rows, 'Name'), false)
  assert.equal(canDeleteField(rows, 'School'), true)
  assert.equal(canEditFieldType(rows, 'Name'), false)
})

test('pkLockState：三重锁定矩阵', () => {
  // 自由态：struct 无任何 pk、字段 raw:string、类型无引用无表
  const pkless: StructDef = { kind: 'struct', name: 'P', fields: [{ name: 'ID', type: { raw: 'string' } }] }
  const free: Project = { types: new Map([['P', pkless]]), tables: [] }
  assert.deepEqual(pkLockState(pkless, pkless.fields[0]!, free), { locked: false, reason: null })
  // 已有其他 pk → 锁
  assert.equal(pkLockState(skill, skill.fields[1]!, project).reason, '本类型已有其他 pk 字段')
  // project 中 Skill 存在同名表 → 锁
  assert.equal(pkLockState(skill, skill.fields[0]!, { types: new Map([['Skill', skill]]), tables: [{ name: 'Skill', rows: [] }] } as Project).reason, '本类型存在同名表格数据，pk 不可变更')
  // 类型非 raw:string → 锁
  const numStruct: StructDef = { kind: 'struct', name: 'Q', fields: [{ name: 'N', type: { raw: 'number' } }] }
  assert.equal(pkLockState(numStruct, numStruct.fields[0]!, free).reason, 'pk 字段类型必须为 string')
  // 被引用 → 锁（Holder 引用 P）
  const holderRef: Project = {
    types: new Map<string, TypeDef>([
      ['P', pkless],
      ['Holder', { kind: 'struct', name: 'Holder', fields: [{ name: 'ID', type: { raw: 'string' }, pk: true }, { name: 's', type: { raw: 'P' } }] }],
    ]),
    tables: [],
  }
  assert.equal(pkLockState(pkless, pkless.fields[0]!, holderRef).reason, '本类型已被其他类型引用，pk 不可变更')
  // 存在同名表 → 锁
  const tableProject: Project = { types: new Map<string, TypeDef>([['P', pkless]]), tables: [{ name: 'P', rows: [] }] }
  assert.equal(pkLockState(pkless, pkless.fields[0]!, tableProject).reason, '本类型存在同名表格数据，pk 不可变更')
})

test('flags：2^n 判定/切换/下一个值/30 上限', () => {
  assert.equal(isPowersOfTwo(school.members), true)
  assert.equal(isPowersOfTwo([{ value: 3 }, { value: 4 }]), false)
  assert.equal(canToggleFlags(school, true), true)
  assert.equal(canToggleFlags({ ...school, members: [{ name: 'A', value: 3 }] }, true), false)
  assert.equal(nextEnumValue([], true), 1)
  assert.equal(nextEnumValue([], false), 0)
  assert.equal(nextEnumValue([{ value: 8 }], true), 16)
  assert.equal(nextEnumValue([{ value: 5 }], false), 6)
})

test('memberValueUsed：直连字段扫描', () => {
  assert.equal(memberValueUsed(project, 'School', 6), true)
  assert.equal(memberValueUsed(project, 'School', 99), false)
})

test('字段 CRUD：pk→index→unique 强制链 + default 去留', () => {
  const updated = updateField(skill, 'Name', { name: 'Label', pk: true, hasDefault: false })
  const f = updated.fields.find(x => x.name === 'Label')!
  assert.equal(f.pk, true)
  assert.equal(f.index, true)
  assert.equal(f.unique, true)
  const withIndex = addField(skill, { name: 'N', index: true })
  assert.equal(withIndex.fields.at(-1)?.unique, true)
  assert.equal(withIndex.fields.at(-1)?.index, true)
  assert.equal(withIndex.fields.at(-1)?.pk, undefined)
  const withDefault = addField(skill, { name: 'D', hasDefault: true, default: 0 })
  assert.equal(withDefault.fields.at(-1)?.default, 0)
  const removed = removeField(updated, 'Label')
  assert.equal(removed.fields.some(x => x.name === 'Label'), false)
})

test('renameFieldCascade：改键与冲突', () => {
  const rows: TableRow[] = [{ ID: '1', Name: 'x' }, { ID: '2' }]
  const ok = renameFieldCascade(rows, 'Name', 'Label')
  assert.equal(ok.conflict, false)
  assert.deepEqual(ok.rows, [{ ID: '1', Label: 'x' }, { ID: '2' }])
  const bad = renameFieldCascade(rows, 'Name', 'ID')
  assert.equal(bad.conflict, true)
  assert.equal(rows[0].Name, 'x')
})

test('成员 CRUD 与枚举类型创建', () => {
  const added = addMember(school, { name: 'Void', value: 16, displayName: '虚' })
  assert.equal(added.members.length, 5)
  const updated = updateMember(school, 'Fire', { name: 'FIRE', value: 1 })
  assert.equal(updated.members[0]?.name, 'FIRE')
  const removed = removeMember(school, 'Air')
  assert.equal(removed.members.length, 3)
  const st = createStructType('Item')
  assert.equal(st.fields[0]?.name, 'ID')
  assert.equal(st.fields[0]?.pk, true)
  const en = createEnumType('Elem', true)
  assert.equal(en.flags, true)
  assert.equal(en.members.length, 0)
  assert.equal(nextFieldName(skill), 'field1')
})

test('序列化往返：ADT 形态 + 键序 + 强制链落盘', () => {
  const s = serializeStruct(skill)
  assert.ok(s.includes('"type": {'))
  assert.ok(s.includes('"raw": "School"'))
  assert.ok(s.includes('"pk": true'))
  const e = serializeEnum(school)
  assert.ok(e.includes('"flags": true'))
  assert.ok(e.includes('"value": 8'))
})
