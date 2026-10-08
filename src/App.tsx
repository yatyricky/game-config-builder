import { useEffect, useRef, useState } from 'react'
import { loadProject } from './data/loader.ts'
import type { LoadResult } from './data/loader.ts'
import { fsaSource, fsaWriteFile } from './data/dirSource.ts'
import { applyCellEdit } from './data/edit.ts'
import { compactRows, tableToJSONL, validateRows } from './data/save.ts'
import type { PasteWrite } from './data/clipboard.ts'
import { getHandle, loadRecentNames, putHandle, rememberRecentName } from './data/recents.ts'
import { Grid } from './grid/Grid.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { TabBar } from './ui/TabBar.tsx'
import type { TableRow } from './data/types.ts'
import './app.css'

interface PickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

const AUTOSAVE_DEBOUNCE_MS = 1000

/** requestPermission 尚未进入 TS DOM lib 的 FileSystemDirectoryHandle 类型 */
type WritableDirHandle = FileSystemDirectoryHandle & {
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

function requestReadWrite(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (handle as WritableDirHandle).requestPermission({ mode: 'readwrite' })
}

export function App() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>(() => loadRecentNames())
  const [selectedTab, setSelectedTab] = useState<string>('schemas')
  const [dirty, setDirty] = useState<Record<string, true>>({})
  const saveTimer = useRef<number | null>(null)

  // doSave 经定时器触发，用 ref 取最新状态避免闭包过期
  const stateRef = useRef({ dirHandle, result, dirty })
  stateRef.current = { dirHandle, result, dirty }

  /** 自动保存（裁决：防抖 1s；必填缺失阻止保存；空记录压缩并回写前端；写盘经 FSA） */
  const doSave = async (): Promise<void> => {
    const { dirHandle: dh, result: r, dirty: d } = stateRef.current
    if (!dh || !r) return
    const names = Object.keys(d)
    if (names.length === 0) return

    for (const name of names) {
      const def = r.project.types.get(name)
      const table = r.project.tables.find(t => t.name === name)
      if (!def || def.kind !== 'struct' || !table) continue
      const issues = validateRows(def, table.rows)
      if (issues.length > 0) {
        const first = issues[0]
        const more = issues.length > 1 ? ` 等 ${issues.length} 行` : ''
        setSaveError(`无法保存「${name}」第 ${first.row} 行缺少必填：${first.missing.join('、')}${more}`)
        return
      }
    }

    try {
      const compacted: Record<string, TableRow[]> = {}
      for (const name of names) {
        const table = r.project.tables.find(t => t.name === name)
        if (!table) continue
        const rows = compactRows(table.rows)
        compacted[name] = rows
        await fsaWriteFile(dh, `${name}.json`, tableToJSONL(rows))
      }
      setResult(prev => {
        if (!prev) return prev
        return {
          ...prev,
          project: {
            ...prev.project,
            tables: prev.project.tables.map(t => (compacted[t.name] ? { ...t, rows: compacted[t.name] } : t)),
          },
        }
      })
      setDirty(prev => {
        const next = { ...prev }
        for (const name of names) delete next[name]
        return next
      })
      setSaveError(null)
    } catch (e) {
      setSaveError(`写盘失败：${String(e)}`)
    }
  }

  const markDirty = (name: string): void => {
    setDirty(d => (d[name] ? d : { ...d, [name]: true }))
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void doSave()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  /** 保存按钮 = flush 防抖立即写盘 */
  const saveNow = (): void => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    void doSave()
  }

  // 裁决：有未保存改动时刷新/关闭弹警告
  useEffect(() => {
    if (Object.keys(dirty).length === 0) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const adoptHandle = async (handle: FileSystemDirectoryHandle): Promise<void> => {
    try {
      const r = await loadProject(fsaSource(handle))
      setResult(r)
      setDirHandle(handle)
      setSelectedTab(r.project.tables[0]?.name ?? 'schemas')
      setDirty({})
      setSaveError(null)
      setPasteError(null)
      setMessage(null)
      setError(r.issues.length > 0 ? r.issues.map(i => `${i.file}${i.at ? ` ${i.at}` : ''}: ${i.message}`).join('\n') : null)
      setRecents(rememberRecentName(handle.name))
      await putHandle(handle.name, handle)
    } catch (e) {
      setError(String(e))
    }
  }

  const open = async (): Promise<void> => {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker
    if (!picker) {
      setError('此浏览器不支持 File System Access API')
      return
    }
    try {
      const handle = await picker({ mode: 'readwrite' })
      await adoptHandle(handle)
    } catch (e) {
      setError(String(e))
    }
  }

  /** 近期工程一键重开：句柄出 IndexedDB + 补一次授权 */
  const reopen = async (name: string): Promise<void> => {
    try {
      const handle = await getHandle(name)
      if (!handle) {
        setError(`未找到「${name}」的目录句柄，请用「打开」重新选择`)
        return
      }
      if ((await requestReadWrite(handle)) !== 'granted') {
        setError(`「${name}」的访问权限被拒绝`)
        return
      }
      await adoptHandle(handle)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleEditCell = (tableName: string, row: number, fieldName: string, value: string): void => {
    setResult(prev => {
      if (!prev) return prev
      return {
        ...prev,
        project: {
          ...prev.project,
          tables: prev.project.tables.map(t =>
            t.name === tableName ? { ...t, rows: applyCellEdit(t.rows, row, fieldName, value) } : t,
          ),
        },
      }
    })
    markDirty(tableName)
  }

  /** M6：粘贴批量写入（同一写时复制通路） */
  const handleApplyWrites = (tableName: string, writes: PasteWrite[]): void => {
    const apply = (rows: TableRow[]): TableRow[] =>
      writes.reduce((acc, w) => applyCellEdit(acc, w.row, w.fieldName, w.value), rows)
    setResult(prev => {
      if (!prev) return prev
      return {
        ...prev,
        project: {
          ...prev.project,
          tables: prev.project.tables.map(t => (t.name === tableName ? { ...t, rows: apply(t.rows) } : t)),
        },
      }
    })
    markDirty(tableName)
  }

  const table = result?.project.tables.find(t => t.name === selectedTab)
  const def = result?.project.types.get(selectedTab)
  const structDef = def?.kind === 'struct' ? def : null
  const projectOpen = dirHandle !== null && result !== null

  return (
    <main id="app">
      <TopBar
        projectName={dirHandle?.name ?? null}
        recents={recents}
        onOpen={open}
        onReopen={reopen}
        onSave={saveNow}
        onExport={() => setMessage('导出：NotImplemented（spec 待定义）')}
      />
      {error && <p className="error">{error}</p>}
      {saveError && <p className="error">{saveError}</p>}
      {pasteError && <p className="error">{pasteError}</p>}
      {message && <p className="notice">{message}</p>}
      <div className="content">
        {projectOpen ? (
          selectedTab !== 'schemas' && table && structDef ? (
            <div className="grid-area">
              <Grid
                key={table.name}
                table={table}
                def={structDef}
                onEditCell={(row, fieldName, value) => handleEditCell(table.name, row, fieldName, value)}
                onApplyWrites={writes => handleApplyWrites(table.name, writes)}
                onPasteError={setPasteError}
              />
            </div>
          ) : (
            <p className="placeholder">
              {selectedTab === 'schemas' ? 'Schemas：schema 编辑待定（spec）' : `表格 ${selectedTab} 缺少对应的 struct 类型`}
            </p>
          )
        ) : (
          <p className="placeholder">点击「打开」选择一个配置工程目录</p>
        )}
      </div>
      {projectOpen && (
        <TabBar
          tables={result.project.tables.map(t => t.name)}
          selected={selectedTab}
          onSelect={setSelectedTab}
          onNew={() => setMessage('新建表格：NotImplemented（依赖 schema 编辑，spec 待定）')}
        />
      )}
    </main>
  )
}
