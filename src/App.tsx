import { useEffect, useMemo, useRef, useState } from 'react'
import { loadProject } from './data/loader.ts'
import type { LoadResult } from './data/loader.ts'
import { fsaDeleteFile, fsaSource, fsaWriteFile } from './data/dirSource.ts'
import { applyCellEdit } from './data/edit.ts'
import {
  compactRows,
  formatDuplicateIssue,
  formatMissingSummary,
  projectViolations,
  tableToJSONL,
  tableViolations,
  uniquenessViolations,
} from './data/save.ts'
import {
  addField,
  addMember,
  createEnumType,
  createStructType,
  removeField,
  removeMember,
  renameFieldCascade,
  serializeEnum,
  serializeStruct,
  updateField,
  updateMember,
} from './data/schemaEdit.ts'
import type { FieldPatch, MemberPatch } from './data/schemaEdit.ts'
import type { PasteWrite } from './data/clipboard.ts'
import { getHandleById, loadRecentEntries, putHandle, rememberRecent } from './data/recents.ts'
import type { RecentEntry } from './data/recents.ts'
import { Grid } from './grid/Grid.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { TabBar } from './ui/TabBar.tsx'
import { SettingsModal } from './ui/SettingsModal.tsx'
import { FieldEditModal } from './ui/FieldEditModal.tsx'
import { TableModal } from './ui/TableModal.tsx'
import { EnumMemberModal } from './ui/EnumMemberModal.tsx'
import { EnumCardModal } from './ui/EnumCardModal.tsx'
import { NewTypeModal } from './ui/NewTypeModal.tsx'
import { ConfirmDialog } from './ui/ConfirmDialog.tsx'
import { Notices } from './ui/Notices.tsx'
import type { NoticeItem } from './ui/Notices.tsx'
import type { Project, StructDef, TableRow, TypeDef } from './data/types.ts'
import { sortTables, tableTypeIndex } from './data/types.ts'
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
  const [selectedTab, setSelectedTab] = useState<string>('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fieldEdit, setFieldEdit] = useState<{ type: string; field: string | null } | null>(null)
  const [memberEdit, setMemberEdit] = useState<{ enumName: string; member: string | null } | null>(null)
  const [enumCardEdit, setEnumCardEdit] = useState<string | null>(null)
  const [newTypeOpen, setNewTypeOpen] = useState(false)
  const [tableModal, setTableModal] = useState<{ mode: 'create' } | { mode: 'edit'; name: string } | null>(null)
  const [confirmState, setConfirmState] = useState<{ message: string; action: () => void } | null>(null)
  const [dirty, setDirty] = useState<Record<string, true>>({})
  const [notices, setNotices] = useState<NoticeItem[]>([])
  const saveTimer = useRef<number | null>(null)

  const stateRef = useRef({ dirHandle, result, dirty })
  stateRef.current = { dirHandle, result, dirty }

  /** 表→类型绑定：schema tables 清单的派生索引（唯一信任源在 schema 文件，这里按需重算） */
  const tableIdx = useMemo(() => (result ? tableTypeIndex(result.project.types) : new Map<string, string>()), [result])

  const pushNotice = (kind: NoticeItem['kind'], text: string): void => {
    setNotices(xs => [{ id: crypto.randomUUID(), kind, text }, ...xs])
  }

  /** 保存（裁决：自动保存静默吞错；手动保存失败弹通知）。silent=true 供防抖自动路径 */
  const doSave = async (silent: boolean): Promise<void> => {
    const { dirHandle: dh, result: r, dirty: d } = stateRef.current
    if (!dh || !r) return
    const names = Object.keys(d)
    if (names.length === 0) return
    const idx = tableTypeIndex(r.project.types)

    // 必填：逐 dirty 表
    for (const name of names) {
      const typeName = idx.get(name)
      const def = typeName !== undefined ? r.project.types.get(typeName) : undefined
      const table = r.project.tables.find(t => t.name === name)
      if (!def || def.kind !== 'struct' || !table) continue
      const v = tableViolations(name, def, table.rows)
      if (!v) continue
      if (silent) return
      pushNotice('error', `无法保存「${name}」${formatMissingSummary(v.missing)}`)
      return
    }
    // pk/unique：按 schema 分组，同类型全部表（含未脏兄弟表）合并查重（用户裁决 2026-10-16）
    const dirtyTypes = new Set(names.map(n => idx.get(n)).filter((t): t is string => t !== undefined))
    for (const typeName of dirtyTypes) {
      const def = r.project.types.get(typeName)
      if (!def || def.kind !== 'struct') continue
      const dup = uniquenessViolations(def, r.project.tables.filter(t => idx.get(t.name) === typeName))[0]
      if (!dup) continue
      if (silent) return
      pushNotice('error', `无法保存：${formatDuplicateIssue(dup)}`)
      return
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
      setSelectedTab(r.project.tables[0]?.name ?? '')
      setSettingsOpen(false)
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

  // Esc 栈：confirm > 字段/成员/卡片/新建 > 设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (confirmState) setConfirmState(null)
      else if (fieldEdit) setFieldEdit(null)
      else if (memberEdit) setMemberEdit(null)
      else if (enumCardEdit) setEnumCardEdit(null)
      else if (newTypeOpen) setNewTypeOpen(false)
      else if (tableModal) setTableModal(null)
      else if (settingsOpen) setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmState, fieldEdit, memberEdit, enumCardEdit, newTypeOpen, tableModal, settingsOpen])

  const updateProject = (fn: (p: Project) => Project): void => {
    setResult(prev => (prev ? { ...prev, project: fn(prev.project) } : prev))
  }

  const handleFieldSave = (patch: FieldPatch, originalName: string | null): void => {
    if (!dirHandle || !result || !fieldEdit) return
    const def = result.project.types.get(fieldEdit.type)
    if (!def || def.kind !== 'struct') return
    const write = async (): Promise<void> => {
      try {
        const idx = tableTypeIndex(result.project.types)
        const sameType = result.project.tables.filter(t => idx.get(t.name) === def.name)
        let cascaded: { name: string; rows: TableRow[] }[] | null = null
        const renamed = originalName !== null && originalName !== patch.name
        if (renamed) {
          cascaded = []
          for (const t of sameType) {
            const r = renameFieldCascade(t.rows, originalName, patch.name)
            if (r.conflict) {
              pushNotice('error', `无法改名：表格「${t.name}」数据中已存在键「${patch.name}」，会产生合并污染`)
              return
            }
            cascaded.push({ name: t.name, rows: r.rows })
          }
        }
        const nextDef = originalName === null ? addField(def, patch) : updateField(def, originalName, patch)
        await fsaWriteFile(dirHandle, `schema/${def.name}.json`, serializeStruct(nextDef))
        if (cascaded !== null) {
          for (const c of cascaded) {
            await fsaWriteFile(dirHandle, `${c.name}.json`, tableToJSONL(compactRows(c.rows)))
          }
        }
        const nextTypes = new Map(result.project.types).set(def.name, nextDef)
        const cas = cascaded
        const nextTables =
          cas !== null
            ? result.project.tables.map(t => {
                const c = cas.find(x => x.name === t.name)
                return c ? { ...t, rows: c.rows } : t
              })
            : result.project.tables
        updateProject(p => ({ ...p, types: nextTypes, tables: nextTables }))
        // 字段保存后全量校验（纯内存）：必填逐表提醒；pk/unique 按 schema 合并查重并溯源（用户裁决 2026-10-16）
        const pv = projectViolations({ types: nextTypes, tables: nextTables })
        for (const v of pv.missing) {
          pushNotice('error', `「${v.table}」${formatMissingSummary(v.missing)}`)
        }
        for (const u of pv.duplicates) {
          pushNotice('error', formatDuplicateIssue(u))
        }
        setFieldEdit(null)
      } catch (e) {
        pushNotice('error', `字段保存失败：${String(e)}`)
      }
    }
    if (originalName === null) {
      setConfirmState({ message: `字段「${patch.name}」一旦选定，后期改名需要级联修改数据，确认创建？`, action: () => void write() })
    } else {
      void write()
    }
  }

  const handleFieldDelete = (fieldName: string): void => {
    if (!dirHandle || !result || !fieldEdit) return
    const def = result.project.types.get(fieldEdit.type)
    if (!def || def.kind !== 'struct') return
    const nextDef = removeField(def, fieldName)
    void (async () => {
      try {
        await fsaWriteFile(dirHandle, `schema/${def.name}.json`, serializeStruct(nextDef))
        updateProject(p => ({ ...p, types: new Map(p.types).set(def.name, nextDef) }))
        setFieldEdit(null)
      } catch (e) {
        pushNotice('error', `字段删除失败：${String(e)}`)
      }
    })()
  }

  const handleMemberSave = (patch: MemberPatch, originalName: string | null): void => {
    if (!dirHandle || !result || !memberEdit) return
    const def = result.project.types.get(memberEdit.enumName)
    if (!def || def.kind !== 'enum') return
    const write = async (): Promise<void> => {
      try {
        const nextDef = originalName === null ? addMember(def, patch) : updateMember(def, originalName, patch)
        await fsaWriteFile(dirHandle, `schema/${def.name}.json`, serializeEnum(nextDef))
        updateProject(p => ({ ...p, types: new Map(p.types).set(def.name, nextDef) }))
        setMemberEdit(null)
      } catch (e) {
        pushNotice('error', `成员保存失败：${String(e)}`)
      }
    }
    if (originalName === null) {
      setConfirmState({ message: `成员「${patch.name}」（${patch.value}）一旦选定后期难改，确认创建？`, action: () => void write() })
    } else {
      void write()
    }
  }

  const handleMemberDelete = (memberName: string): void => {
    if (!dirHandle || !result || !memberEdit) return
    const def = result.project.types.get(memberEdit.enumName)
    if (!def || def.kind !== 'enum') return
    const nextDef = removeMember(def, memberName)
    void (async () => {
      try {
        await fsaWriteFile(dirHandle, `schema/${def.name}.json`, serializeEnum(nextDef))
        updateProject(p => ({ ...p, types: new Map(p.types).set(def.name, nextDef) }))
        setMemberEdit(null)
      } catch (e) {
        pushNotice('error', `成员删除失败：${String(e)}`)
      }
    })()
  }

  const handleEnumCardSave = (patch: { name: string; flags: boolean }): void => {
    if (!dirHandle || !result || !enumCardEdit) return
    const def = result.project.types.get(enumCardEdit)
    if (!def || def.kind !== 'enum') return
    void (async () => {
      try {
        const nextDef = { ...def, name: patch.name, flags: patch.flags }
        if (patch.name !== def.name) {
          await fsaWriteFile(dirHandle, `schema/${patch.name}.json`, serializeEnum(nextDef))
          await fsaDeleteFile(dirHandle, `schema/${def.name}.json`)
        } else {
          await fsaWriteFile(dirHandle, `schema/${def.name}.json`, serializeEnum(nextDef))
        }
        updateProject(p => {
          const types = new Map(p.types)
          types.delete(def.name)
          types.set(patch.name, nextDef)
          return { ...p, types }
        })
        setEnumCardEdit(null)
      } catch (e) {
        pushNotice('error', `卡片保存失败：${String(e)}`)
      }
    })()
  }

  const handleNewTypeSubmit = (name: string, kind: 'struct' | 'enum', flags: boolean): void => {
    if (!dirHandle) return
    setConfirmState({
      message: `类型「${name}」一旦选定，被引用或产生数据后将不可改名，确认创建？`,
      action: () => {
        void (async () => {
          try {
            const def: TypeDef = kind === 'struct' ? createStructType(name) : createEnumType(name, flags)
            const content = def.kind === 'struct' ? serializeStruct(def) : serializeEnum(def)
            await fsaWriteFile(dirHandle, `schema/${name}.json`, content)
            updateProject(p => ({ ...p, types: new Map(p.types).set(name, def) }))
            setNewTypeOpen(false)
          } catch (e) {
            pushNotice('error', `类型创建失败：${String(e)}`)
          }
        })()
      },
    })
  }

  const handleDeleteType = (name: string): void => {
    if (!dirHandle || !result) return
    void (async () => {
      try {
        const idx = tableTypeIndex(result.project.types)
        const owned = result.project.tables.filter(t => idx.get(t.name) === name)
        await fsaDeleteFile(dirHandle, `schema/${name}.json`)
        // canDeleteType 已保证该类型全部表格无数据，数据文件一并清理
        for (const t of owned) await fsaDeleteFile(dirHandle, `${t.name}.json`)
        updateProject(p => {
          const types = new Map(p.types)
          types.delete(name)
          return { ...p, types, tables: p.tables.filter(t => idx.get(t.name) !== name) }
        })
        setDirty(prev => {
          const next = { ...prev }
          for (const t of owned) delete next[t.name]
          return next
        })
        if (selectedTab === name || owned.some(t => t.name === selectedTab)) {
          setSelectedTab(result.project.tables.find(t => idx.get(t.name) !== name)?.name ?? '')
        }
      } catch (e) {
        pushNotice('error', `类型删除失败：${String(e)}`)
      }
    })()
  }

  const handleTableSubmit = (name: string, type: string): void => {
    if (!dirHandle || !result || !tableModal) return
    if (tableModal.mode === 'create') void createTable(name, type)
    else void renameTable(tableModal.name, name, type)
  }

  /** 新建表格：空数据文件 + schema 清单追加；表名可后期改，无需二次确认 */
  const createTable = async (name: string, type: string): Promise<void> => {
    const def = result?.project.types.get(type)
    if (!dirHandle || !result || !def || def.kind !== 'struct') return
    const nextDef: StructDef = { ...def, tables: [...def.tables, name] }
    try {
      await fsaWriteFile(dirHandle, `${name}.json`, '')
      await fsaWriteFile(dirHandle, `schema/${type}.json`, serializeStruct(nextDef))
      updateProject(p => {
        const types = new Map(p.types).set(type, nextDef)
        return { types, tables: sortTables([...p.tables, { name, rows: [] }], tableTypeIndex(types)) }
      })
      setSelectedTab(name)
      setTableModal(null)
    } catch (e) {
      pushNotice('error', `新建表格失败：${String(e)}`)
    }
  }

  /** 表格改名：数据文件迁移 + schema 清单改名；dirty 键随迁防脏标记丢失 */
  const renameTable = async (oldName: string, newName: string, type: string): Promise<void> => {
    if (!dirHandle || !result) return
    if (oldName === newName) {
      setTableModal(null)
      return
    }
    const def = result.project.types.get(type)
    const table = result.project.tables.find(t => t.name === oldName)
    if (!def || def.kind !== 'struct' || !table) return
    const nextDef: StructDef = { ...def, tables: def.tables.map(t => (t === oldName ? newName : t)) }
    try {
      await fsaWriteFile(dirHandle, `${newName}.json`, tableToJSONL(table.rows))
      await fsaDeleteFile(dirHandle, `${oldName}.json`)
      await fsaWriteFile(dirHandle, `schema/${type}.json`, serializeStruct(nextDef))
      updateProject(p => {
        const types = new Map(p.types).set(type, nextDef)
        return {
          types,
          tables: sortTables(p.tables.map(t => (t.name === oldName ? { ...t, name: newName } : t)), tableTypeIndex(types)),
        }
      })
      setDirty(prev => {
        if (!prev[oldName]) return prev
        const next = { ...prev }
        delete next[oldName]
        next[newName] = true
        return next
      })
      if (selectedTab === oldName) setSelectedTab(newName)
      setTableModal(null)
    } catch (e) {
      pushNotice('error', `表格改名失败：${String(e)}`)
    }
  }

  const handleTableDelete = async (name: string): Promise<void> => {
    if (!dirHandle || !result) return
    const type = tableIdx.get(name)
    const def = type !== undefined ? result.project.types.get(type) : undefined
    if (type === undefined || !def || def.kind !== 'struct') return
    const nextDef: StructDef = { ...def, tables: def.tables.filter(t => t !== name) }
    try {
      await fsaDeleteFile(dirHandle, `${name}.json`)
      await fsaWriteFile(dirHandle, `schema/${type}.json`, serializeStruct(nextDef))
      updateProject(p => {
        const types = new Map(p.types).set(type, nextDef)
        return { types, tables: p.tables.filter(t => t.name !== name) }
      })
      setDirty(prev => {
        if (!prev[name]) return prev
        const next = { ...prev }
        delete next[name]
        return next
      })
      if (selectedTab === name) setSelectedTab(result.project.tables.find(t => t.name !== name)?.name ?? '')
      setTableModal(null)
    } catch (e) {
      pushNotice('error', `表格删除失败：${String(e)}`)
    }
  }

  // 全局快捷键（ref 取最新回调）
  const hotkeysRef = useRef({
    save: saveNow,
    open: (): void => void open(),
    exportCsv: (): void => pushNotice('info', '导出：NotImplemented（spec 待定义）'),
    newTable: (): void => {
      if (!stateRef.current.result) {
        pushNotice('error', '请先打开工程')
        return
      }
      setTableModal({ mode: 'create' })
    },
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
    newTable: (): void => {
      if (!stateRef.current.result) {
        pushNotice('error', '请先打开工程')
        return
      }
      setTableModal({ mode: 'create' })
    },
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
        setSettingsOpen(o => !o)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        h.selectSheet(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const table = result?.project.tables.find(t => t.name === selectedTab)
  const selectedType = table !== undefined ? tableIdx.get(table.name) : undefined
  const def = selectedType !== undefined ? result?.project.types.get(selectedType) : undefined
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
        onSchemas={() => setSettingsOpen(true)}
      />
      <div className="main-row">
      {projectOpen && (
        <TabBar
          tabs={result.project.tables.map(t => {
            const type = tableIdx.get(t.name)
            return { name: t.name, label: type !== undefined && !t.name.includes(type) ? `${t.name}-${type}` : t.name }
          })}
          selected={selectedTab}
          onSelect={setSelectedTab}
          onEdit={name => setTableModal({ mode: 'edit', name })}
          onNew={() => setTableModal({ mode: 'create' })}
        />
      )}
        <div className="content">
          {projectOpen ? (
            table && structDef ? (
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
              <p className="placeholder">{selectedTab ? `表格 ${selectedTab} 缺少对应的 struct 类型` : '工程中没有表格'}</p>
            )
          ) : (
            <p className="placeholder">点击「打开」选择一个配置工程目录</p>
          )}
        </div>
      </div>
      {settingsOpen && result && (
        <SettingsModal
          project={result.project}
          projectName={current?.name ?? ''}
          onClose={() => setSettingsOpen(false)}
          actions={{
            newType: () => setNewTypeOpen(true),
            deleteType: handleDeleteType,
            editField: (t, f) => setFieldEdit({ type: t, field: f }),
            editMember: (e, m) => setMemberEdit({ enumName: e, member: m }),
            editEnumCard: e => setEnumCardEdit(e),
          }}
        />
      )}
      {result && tableModal && (() => {
        const editName = tableModal.mode === 'edit' ? tableModal.name : null
        return (
          <TableModal
            mode={tableModal.mode}
            types={result.project.types}
            tableNames={result.project.tables.map(t => t.name)}
            initial={editName !== null ? { name: editName, type: tableIdx.get(editName) ?? '' } : undefined}
            onSubmit={handleTableSubmit}
            onDelete={
              editName !== null
                ? () =>
                    setConfirmState({
                      message: `删除表格「${editName}」将同时删除数据文件，不可恢复。确认删除？`,
                      action: () => void handleTableDelete(editName),
                    })
                : undefined
            }
            onClose={() => setTableModal(null)}
          />
        )
      })()}
      {settingsOpen && result && fieldEdit && (() => {
        const def = result.project.types.get(fieldEdit.type)
        if (!def || def.kind !== 'struct') return null
        const field = fieldEdit.field ? def.fields.find(f => f.name === fieldEdit.field) ?? null : null
        return (
          <FieldEditModal
            def={def}
            field={field}
            project={result.project}
            onSave={handleFieldSave}
            onDelete={handleFieldDelete}
            onClose={() => setFieldEdit(null)}
          />
        )
      })()}
      {settingsOpen && result && memberEdit && (() => {
        const def = result.project.types.get(memberEdit.enumName)
        if (!def || def.kind !== 'enum') return null
        const member = memberEdit.member ? def.members.find(m => m.name === memberEdit.member) ?? null : null
        return (
          <EnumMemberModal
            def={def}
            member={member}
            project={result.project}
            onSave={handleMemberSave}
            onDelete={handleMemberDelete}
            onClose={() => setMemberEdit(null)}
          />
        )
      })()}
      {settingsOpen && result && enumCardEdit && (() => {
        const def = result.project.types.get(enumCardEdit)
        if (!def || def.kind !== 'enum') return null
        const isUsed = [...result.project.types.values()].some(t =>
          t.kind === 'struct' && t.name !== def.name &&
          t.fields.some(f => JSON.stringify(f.type).includes(`"raw":"${def.name}"`)),
        )
        return <EnumCardModal def={def} isUsed={isUsed} onSave={handleEnumCardSave} onClose={() => setEnumCardEdit(null)} />
      })()}
      {settingsOpen && newTypeOpen && result && (
        <NewTypeModal types={result.project.types} onSubmit={handleNewTypeSubmit} onClose={() => setNewTypeOpen(false)} />
      )}
      {confirmState && (
        <ConfirmDialog
          title="二次确认"
          message={confirmState.message}
          onConfirm={() => {
            const action = confirmState.action
            setConfirmState(null)
            action()
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      <Notices items={notices} onClose={id => setNotices(xs => xs.filter(x => x.id !== id))} />
    </main>
  )
}
