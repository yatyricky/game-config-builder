import { useMemo, useState } from 'react'
import { loadProject } from './data/loader.ts'
import type { LoadResult } from './data/loader.ts'
import { fsaSource } from './data/dirSource.ts'
import { Grid } from './grid/Grid.tsx'
import type { StructDef, Table } from './data/types.ts'
import './app.css'

/** showDirectoryPicker 尚未进入 TS DOM lib，按可选能力探测 */
interface PickerWindow {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

export function App() {
  const [result, setResult] = useState<LoadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [stress, setStress] = useState(false)

  const open = async (): Promise<void> => {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker
    if (!picker) {
      setError('此浏览器不支持 File System Access API')
      return
    }
    try {
      const handle = await picker()
      const r = await loadProject(fsaSource(handle))
      setResult(r)
      setSelected(r.project.tables[0]?.name ?? null)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const table = result?.project.tables.find(t => t.name === selected)
  const def = result?.project.types.get(selected ?? '')
  const structDef = def?.kind === 'struct' ? def : null
  const stressTable = useMemo(() => (stress ? makeStressTable() : null), [stress])

  return (
    <main id="app">
      {/* M1/M2 临时调试壳：M7 菜单落地后替换 */}
      <div className="toolbar">
        <button onClick={open}>打开工程</button>
        <button onClick={() => setStress(s => !s)}>{stress ? '退出压测' : '压测表(10万行)'}</button>
        {result && !stress && (
          <select value={selected ?? ''} onChange={e => setSelected(e.target.value)}>
            {result.project.tables.map(t => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {stress && stressTable ? (
        <div className="grid-area">
          <Grid table={stressTable.table} def={stressTable.def} />
        </div>
      ) : result ? (
        <>
          {result.issues.length > 0 && <pre className="issues">{summarize(result)}</pre>}
          {table && structDef ? (
            <div className="grid-area">
              <Grid table={table} def={structDef} />
            </div>
          ) : (
            <p>{selected ? `表格 ${selected} 缺少对应的 struct 类型` : '工程中没有表格'}</p>
          )}
        </>
      ) : (
        summarizeTypes(result)
      )}
    </main>
  )
}

function summarizeTypes(result: LoadResult | null): string {
  if (!result) return ''
  const types = [...result.project.types.values()].map(t =>
    t.kind === 'enum' ? `${t.name}(enum${t.flags ? ',flags' : ''})` : `${t.name}(struct,${t.fields.length}字段)`,
  )
  return `类型: ${types.join(', ') || '无'}\n表格: ${result.project.tables.map(t => `${t.name} ${t.rows.length}行`).join(', ') || '无'}`
}

function summarize(r: LoadResult): string {
  return r.issues.map(i => `${i.file}${i.at ? ` ${i.at}` : ''}: ${i.message}`).join('\n')
}

/** G3 主观验收压测表：10 万行、3 列（含一列 number 验证 NotImplemented 在虚拟滚动下同样成立） */
function makeStressTable(): { table: Table; def: StructDef } {
  const def: StructDef = {
    kind: 'struct',
    name: 'Stress',
    fields: [
      { name: 'ID', type: 'string', pk: true },
      { name: 'Name', type: 'string' },
      { name: 'Age', type: 'number' },
    ],
  }
  const rows: Table['rows'] = []
  for (let i = 1; i <= 100_000; i++) {
    rows.push({ ID: String(i).padStart(6, '0'), Name: `行 ${i}`, Age: i % 100 })
  }
  return { table: { name: 'Stress', rows }, def }
}
