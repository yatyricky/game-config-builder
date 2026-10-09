import type { ReactNode } from 'react'
import { useCtrlHeld } from './useCtrlHeld.ts'
import type { RecentEntry } from '../data/recents.ts'

function HotButton({ label, hotkey, onClick, disabled }: { label: ReactNode; hotkey: string; onClick: () => void; disabled?: boolean }) {
  const ctrlHeld = useCtrlHeld()
  return (
    <span className="hot-wrap">
      {ctrlHeld && <span className="kb-badge below">{hotkey}</span>}
      <button onClick={onClick} disabled={disabled}>
        {label}
      </button>
    </span>
  )
}

interface TopBarProps {
  /** 当前打开工程的条目（含唯一 id；FSA 只暴露目录名） */
  current: RecentEntry | null
  recents: RecentEntry[]
  isDirty: boolean
  onOpen: () => void
  onReopen: (id: string) => void
  onSave: () => void
  onExport: () => void
  onSchemas: () => void
}

/** spec 顶栏（2026-10-09 修订）：GCB [路径下拉] [打开 Ctrl+O] [保存 Ctrl+S] [导出 Ctrl+E] [Schemas Ctrl+,]；option value=id（同名目录可区分），定宽 */
export function TopBar({ current, recents, isDirty, onOpen, onReopen, onSave, onExport, onSchemas }: TopBarProps) {
  const extra = current && !recents.some(r => r.id === current.id) ? [current] : []
  return (
    <div className="topbar">
      <span className="brand">GCB</span>
      <select
        className="path-select"
        value={current?.id ?? ''}
        onChange={e => {
          if (e.target.value && e.target.value !== current?.id) onReopen(e.target.value)
        }}
      >
        {!current && <option value="">未打开工程</option>}
        {[...extra, ...recents].map(r => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <HotButton label="打开" hotkey="O" onClick={onOpen} />
      <HotButton label={isDirty ? '保存 *' : '保存'} hotkey="S" onClick={onSave} disabled={!current} />
      <HotButton label="导出" hotkey="E" onClick={onExport} disabled={!current} />
      <HotButton label="Schemas" hotkey="," onClick={onSchemas} disabled={!current} />
    </div>
  )
}
