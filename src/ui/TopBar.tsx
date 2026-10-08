import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { RecentEntry } from '../data/recents.ts'

/** 按住 Ctrl 时按钮上方显示快捷键徽标 */
function useCtrlHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setHeld(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setHeld(false)
    }
    const blur = (): void => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return held
}

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
}

/** spec 顶栏：GCB [路径下拉] [打开 Ctrl+O] [保存 Ctrl+S] [导出 Ctrl+E]；option value=id（同名目录可区分），定宽 */
export function TopBar({ current, recents, isDirty, onOpen, onReopen, onSave, onExport }: TopBarProps) {
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
      <HotButton label="打开" hotkey="Ctrl+O" onClick={onOpen} />
      <HotButton label={isDirty ? '保存 *' : '保存'} hotkey="Ctrl+S" onClick={onSave} disabled={!current} />
      <HotButton label="导出" hotkey="Ctrl+E" onClick={onExport} disabled={!current} />
    </div>
  )
}
