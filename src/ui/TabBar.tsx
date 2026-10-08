import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface TabBarProps {
  tables: string[]
  /** 'schemas' 或表名 */
  selected: string
  onSelect: (tab: string) => void
  onNew: () => void
}

/** spec 底栏：Schemas(第 1 个 sheet) | 各表页签（横向 scroll view，滚动条 4px）| [+新建表格] 冻结最右。
 * 按住 Ctrl：每个页签上方显示快捷键数字徽记（Ctrl+1=Schemas、Ctrl+2..=各表），+新建显示 N。 */
export function TabBar({ tables, selected, onSelect, onNew }: TabBarProps) {
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

  const tab = (key: string, index: number, label: ReactNode): ReactNode => (
    <button key={key} className={`tab${selected === key ? ' active' : ''}`} onClick={() => onSelect(key)}>
      {ctrlHeld && <span className="kb-badge">{index}</span>}
      {label}
    </button>
  )

  return (
    <div className={`tabbar${ctrlHeld ? ' show-badges' : ''}`}>
      <div className="tab-scroll">
        {tab('schemas', 1, 'Schemas')}
        {tables.map((name, i) => tab(name, i + 2, name))}
      </div>
      <button className="tab-new" onClick={onNew}>
        {wrap('+新建表格', 'M')}
      </button>
    </div>
  )
}
