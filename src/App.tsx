import { useState } from 'react'
import { loadProject } from './data/loader.ts'
import type { LoadResult } from './data/loader.ts'
import { fsaSource } from './data/dirSource.ts'

/** showDirectoryPicker 尚未进入 TS DOM lib，按可选能力探测 */
interface PickerWindow {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

export function App() {
  const [result, setResult] = useState<LoadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = async (): Promise<void> => {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker
    if (!picker) {
      setError('此浏览器不支持 File System Access API')
      return
    }
    try {
      const handle = await picker()
      setResult(await loadProject(fsaSource(handle)))
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <main id="app">
      {/* M1 临时调试入口，M2 起由真实网格替代 */}
      <button onClick={open}>打开工程</button>
      {error && <p>{error}</p>}
      {result && <pre>{summarize(result)}</pre>}
    </main>
  )
}

function summarize(r: LoadResult): string {
  const lines: string[] = []
  const types = [...r.project.types.values()].map(t => {
    if (t.kind === 'enum') return `${t.name}(enum${t.flags ? ',flags' : ''})`
    return `${t.name}(struct,${t.fields.length}字段)`
  })
  lines.push(`类型: ${types.join(', ') || '无'}`)
  lines.push(`表格: ${r.project.tables.map(t => `${t.name} ${t.rows.length}行`).join(', ') || '无'}`)
  if (r.issues.length === 0) {
    lines.push('问题: 无')
  } else {
    lines.push('问题:')
    for (const i of r.issues) lines.push(`  ${i.file}${i.at ? ` ${i.at}` : ''}: ${i.message}`)
  }
  return lines.join('\n')
}
