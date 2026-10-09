import { useEffect, useRef, useState } from 'react'
import { loadProject } from './data/loader.ts'
import type { LoadResult } from './data/loader.ts'
import { fsaSource, fsaWriteFile } from './data/dirSource.ts'
import { applyCellEdit } from './data/edit.ts'
import { compactRows, tableToJSONL, validateRows } from './data/save.ts'
import type { PasteWrite } from './data/clipboard.ts'
import { getHandleById, loadRecentEntries, putHandle, rememberRecent } from './data/recents.ts'
import type { RecentEntry } from './data/recents.ts'
import { Grid } from './grid/Grid.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { TabBar } from './ui/TabBar.tsx'
import { Notices } from './ui/Notices.tsx'
import type { NoticeItem } from './ui/Notices.tsx'
import type { TableRow } from './data/types.ts'
import './theme.css'
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
  const [current, setCurrent] = useState<RecentEntry | null>(null)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [recents, setRecents] = useState<RecentEntry[]>(() => loadRecentEntries())
  const [selectedTab, setSelectedTab] = useState<string>('schemas')
  const [dirty, setDirty] = useState<Record<string, true>>({})
  const [notices, setNotices] = useState<NoticeItem[]>([])
  const saveTimer = useRef<number | null>(null)

  const stateRef = useRef({ dirHandle, result, dirty })
  stateRef.current = { dirHandle, result, dirty }

  const pushNotice = (kind: NoticeItem['kind'], text: string): void => {
    setNotices(xs => [{ id: crypto.randomUUID(), kind, text }, ...xs])
  }

  /** 保存（裁决：自动保存静默吞错；手动保存失败弹通知）。silent=true 供防抖自动路径 */
  const doSave = async (silent: boolean): Promise<void> => {
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
        if (silent) return
        const first = issues[0]
        const more = issues.length > 1 ? ` 等 ${issues.length} 行` : ''
        pushNotice('error', `无法保存「${name}」第 ${first.row} 行缺少必填：${first.missing.join('、')}${more}`)
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
    } catch (e) {
      if (!silent) pushNotice('error', `写盘失败：${String(e)}`)
    }
  }

  const markDirty = (name: string): void => {
    setDirty(d => (d[name] ? d : { ...d, [name]: true }))
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void doSave(true)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  /** 保存按钮 / Ctrl+S：flush 防抖立即写（手动路径，失败弹通知） */
  const saveNow = (): void => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    void doSave(false)
  }

  // 有未保存改动时刷新/关闭弹警告
  useEffect(() => {
    if (Object.keys(dirty).length === 0) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const adoptHandle = async (handle: FileSystemDirectoryHandle, id: string, name: string): Promise<void> => {
    try {
      const r = await loadProject(fsaSource(handle))
      setResult(r)
      setDirHandle(handle)
      setCurrent({ id, name })
      setSelectedTab(r.project.tables[0]?.name ?? 'schemas')
      setDirty({})
      // 打开时间倒排：置顶并回写
      setRecents(rememberRecent(id, name))
      await putHandle(id, handle)
      if (r.issues.length > 0) {
        pushNotice('error', r.issues.map(i => `${i.file}${i.at ? ` ${i.at}` : ''}: ${i.message}`).join('\n'))
      }
    } catch (e) {
      pushNotice('error', String(e))
    }
  }

  const open = async (): Promise<void> => {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker
    if (!picker) {
      pushNotice('error', '此浏览器不支持 File System Access API')
      return
    }
    try {
      const handle = await picker({ mode: 'readwrite' })
      await adoptHandle(handle, crypto.randomUUID(), handle.name)
    } catch (e) {
      pushNotice('error', String(e))
    }
  }

  /** 近期工程一键重开：句柄出 IndexedDB + 补一次授权；成功即置顶 */
  const reopen = async (id: string): Promise<void> => {
    const entry = recents.find(r => r.id === id)
    try {
      const handle = await getHandleById(id)
      if (!handle) {
        pushNotice('error', `未找到「${entry?.name ?? id}」的目录句柄，请用「打开」重新选择`)
        return
      }
      if ((await requestReadWrite(handle)) !== 'granted') {
        pushNotice('error', `「${entry?.name ?? id}」的访问权限被拒绝`)
        return
      }
      await adoptHandle(handle, id, entry?.name ?? handle.name)
    } catch (e) {
      pushNotice('error', String(e))
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

  // 全局快捷键（ref 取最新回调）
  const hotkeysRef = useRef({
    save: saveNow,
    open: (): void => void open(),
    exportCsv: (): void => pushNotice('info', '导出：NotImplemented（spec 待定义）'),
    newTable: (): void => pushNotice('info', '新建表格：NotImplemented（依赖 schema 编辑，spec 待定）'),
    selectSheet: (n: number): void => {
      const r = stateRef.current.result
      const name = r?.project.tables[n - 1]?.name
      if (name) setSelectedTab(name)
    },
  })
  hotkeysRef.current = {
    save: saveNow,
    open: (): void => void open(),
    exportCsv: (): void => pushNotice('info', '导出：NotImplemented（spec 待定义）'),
    newTable: (): void => pushNotice('info', '新建表格：NotImplemented（依赖 schema 编辑，spec 待定）'),
    selectSheet: (n: number): void => {
      const r = stateRef.current.result
      const name = r?.project.tables[n - 1]?.name
      if (name) setSelectedTab(name)
    },
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const h = hotkeysRef.current
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        h.save()
      } else if (key === 'o') {
        e.preventDefault()
        h.open()
      } else if (key === 'e') {
        e.preventDefault()
        h.exportCsv()
      } else if (key === 'm') {
        e.preventDefault()
        h.newTable()
      } else if (key === ',') {
        e.preventDefault()
        setSelectedTab('schemas')
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        h.selectSheet(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const table = result?.project.tables.find(t => t.name === selectedTab)
  const def = result?.project.types.get(selectedTab)
  const structDef = def?.kind === 'struct' ? def : null
  const projectOpen = dirHandle !== null && result !== null
  const isDirty = Object.keys(dirty).length > 0

  return (
    <main id="app">
      <TopBar
        current={current}
        recents={recents}
        isDirty={isDirty}
        onOpen={open}
        onReopen={id => void reopen(id)}
        onSave={saveNow}
        onExport={() => pushNotice('info', '导出：NotImplemented（spec 待定义）')}
        onSchemas={() => setSelectedTab('schemas')}
      />
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
                onPasteError={msg => pushNotice('error', msg)}
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
          onNew={() => pushNotice('info', '新建表格：NotImplemented（依赖 schema 编辑，spec 待定）')}
        />
      )}
      <Notices items={notices} onClose={id => setNotices(xs => xs.filter(x => x.id !== id))} />
    </main>
  )
}
