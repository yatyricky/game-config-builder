import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadProject } from './loader.ts'
import { nodeSource } from './nodeSource.ts'

const TMP = '.tmp/loader-test'

async function withTmpCopy(fn: (dir: string) => Promise<void>): Promise<void> {
  await rm(TMP, { recursive: true, force: true })
  await cp('sample', TMP, { recursive: true })
  try {
    await fn(TMP)
  } finally {
    await rm(TMP, { recursive: true, force: true })
  }
}

test('sample 工程全量解析（对照 spec 样例）', async () => {
  const { project, issues } = await loadProject(nodeSource('sample'))
  assert.deepEqual(issues, [])
  assert.equal(project.types.size, 3)

  const skill = project.types.get('Skill')
  assert.equal(skill?.kind, 'struct')
  if (skill?.kind === 'struct') {
    const effects = skill.fields.find(f => f.name === 'Effects')
    assert.equal(effects?.map, true)
    assert.equal(effects?.keyType, 'Effect')
    assert.equal(effects?.valueType, 'number')
    const lvl = skill.fields.find(f => f.name === 'LevelRequirements')
    assert.equal(lvl?.array, true)
    assert.equal(lvl?.elementType, 'number')
    assert.equal(lvl?.displayName, 'LvlReq')
  }

  const byName = new Map(project.tables.map(t => [t.name, t]))
  assert.deepEqual(byName.get('Effect')?.rows, [
    { ID: '001', Name: 'Damage', FuncName: 'EffectDamage' },
    { ID: '002', Name: 'Heal', FuncName: 'EffectHeal' },
    { ID: '003', Name: 'Stun', FuncName: 'EffectStun' },
  ])
  assert.deepEqual(byName.get('Skill')?.rows, [
    { ID: '0001', Name: 'Strike', School: 6, Effects: { '001': 20 }, LevelRequirements: [1, 3, 6] },
    { ID: '0002', Name: 'Meditation', School: 8, Effects: { '002': 30, '003': 2 }, LevelRequirements: [1, 4, 15] },
  ])
})

test('缺少 schema/ 目录报错', async () => {
  await withTmpCopy(async dir => {
    await rm(join(dir, 'schema'), { recursive: true })
    const { issues } = await loadProject(nodeSource(dir))
    assert.ok(issues.some(i => i.message.includes('schema/')))
  })
})

test('根目录未知类型的表格报错', async () => {
  await withTmpCopy(async dir => {
    await writeFile(join(dir, 'Foo.json'), '{"ID": "1"}\n', 'utf8')
    const { issues } = await loadProject(nodeSource(dir))
    assert.ok(issues.some(i => i.message.includes('Foo')))
  })
})

test('枚举类型不能作为表格', async () => {
  await withTmpCopy(async dir => {
    await writeFile(join(dir, 'School.json'), '{"x": 1}\n', 'utf8')
    const { issues } = await loadProject(nodeSource(dir))
    assert.ok(issues.some(i => i.message.includes('枚举')))
  })
})

test('schema 文件 JSON 损坏报错', async () => {
  await withTmpCopy(async dir => {
    await writeFile(join(dir, 'schema', 'Skill.json'), '{ broken', 'utf8')
    const { issues } = await loadProject(nodeSource(dir))
    assert.ok(issues.some(i => i.file === 'schema/Skill.json' && i.message === 'JSON 解析失败'))
  })
})

test('表格 JSONL 坏行报错带行号', async () => {
  await withTmpCopy(async dir => {
    await writeFile(join(dir, 'Skill.json'), '{"ID": "0001"}\nbroken\n', 'utf8')
    const { issues } = await loadProject(nodeSource(dir))
    assert.ok(issues.some(i => i.file === 'Skill.json' && i.at === '第 2 行'))
  })
})
