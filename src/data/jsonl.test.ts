import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonl } from './jsonl.ts'

test('逐行解析，空行跳过', () => {
  const text = '{"ID": "001", "Name": "Damage"}\n\n{"ID": "002", "Name": "Heal"}\n'
  const { rows, issues } = parseJsonl(text, 'Effect.json')
  assert.deepEqual(issues, [])
  assert.deepEqual(rows, [
    { ID: '001', Name: 'Damage' },
    { ID: '002', Name: 'Heal' },
  ])
})

test('坏行报错带行号', () => {
  const text = '{"ID": "001"}\n{"ID": broken\n'
  const { rows, issues } = parseJsonl(text, 'Effect.json')
  assert.equal(rows.length, 1)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].at, '第 2 行')
  assert.equal(issues[0].message, 'JSON 解析失败')
})

test('非对象记录报错', () => {
  const { rows, issues } = parseJsonl('[1, 2]\n', 'Effect.json')
  assert.equal(rows.length, 0)
  assert.equal(issues[0].at, '第 1 行')
  assert.equal(issues[0].message, '记录必须是 JSON 对象')
})
