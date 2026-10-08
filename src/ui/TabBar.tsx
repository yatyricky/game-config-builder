import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/** 按住 Ctrl 时「+新建表格」上方显示快捷键徽标 */
export function TabBar({ tables, selected, onSelect, onNew }: { tables: string[]; selected: string; onSelect: (tab: string) => void; onNew: () => void }) {
  const [ctrlHeld, setCtrlHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setCtrlHeld(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setCtrlHeld(false)
    }
    const blur = (): void => setCtrlHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const wrap = (label: ReactNode, hotkey: string): ReactNode => (
    <span className="hot-wrap">
      {ctrlHeld && <span className="kb-badge">{hotkey}</span>}
      {label}
    </span>
  )

  return (
    <div className="tabbar">
      <div className="tab-scroll">
        <button className={`tab${selected === 'schemas' ? ' active' : ''}`} onClick={() => onSelect('schemas')}>
          Schemas
        </button>
        {tables.map(name => (
          <button key={name} className={`tab${selected === name ? ' active' : ''}`} onClick={() => onSelect(name)}>
            {name}
          </button>
        ))}
      </div>
      <button className="tab-new" onClick={onNew}>
        {wrap('+新建表格', 'Ctrl+N')}
      </button>
    </div>
  )
}
