import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCell } from './format.ts'
import type { FieldDef } from '../data/types.ts'

const str: FieldDef = { name: 'Name', type: 'string' }
const num: FieldDef = { name: 'Age', type: 'number' }
const enumF: FieldDef = { name: 'School', type: 'School' }
const mapF: FieldDef = { name: 'Effects', type: '', map: true, keyType: 'Effect', valueType: 'number' }
const arrF: FieldDef = { name: 'LvlReq', type: '', array: true, elementType: 'number' }

test('string 字段直出文本', () => {
  assert.deepEqual(formatCell(str, 'Strike'), { kind: 'text', text: 'Strike' })
  // 空串是合法值
  assert.deepEqual(formatCell(str, ''), { kind: 'text', text: '' })
})

test('非 string 字段一律 NotImplemented', () => {
  assert.deepEqual(formatCell(num, 6), { kind: 'notimpl' })
  assert.deepEqual(formatCell(enumF, 6), { kind: 'notimpl' })
  assert.deepEqual(formatCell(mapF, { '001': 20 }), { kind: 'notimpl' })
  assert.deepEqual(formatCell(arrF, [1, 3, 6]), { kind: 'notimpl' })
})

test('0 与 false 是合法值，不误判为空', () => {
  assert.deepEqual(formatCell(num, 0), { kind: 'notimpl' })
  assert.deepEqual(formatCell(str, 0), { kind: 'text', text: '0' })
})

test('缺值（undefined/null）空白', () => {
  assert.deepEqual(formatCell(str, undefined), { kind: 'blank' })
  assert.deepEqual(formatCell(num, null), { kind: 'blank' })
  assert.deepEqual(formatCell(mapF, undefined), { kind: 'blank' })
})
