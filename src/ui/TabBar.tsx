import { useLayoutEffect, useRef, useState } from 'react'
import { useCtrlHeld } from './useCtrlHeld.ts'

interface TabBarProps {
  tables: string[]
  selected: string
  onSelect: (tab: string) => void
  onNew: () => void
}

interface BadgeSpot {
  key: string
  label: string
  x: number
  y: number
}

/** spec 底栏（2026-10-09 修订）：各表页签 + [+ 新建] 共享横向 scroll view（不冻结）。
 * 按住 Ctrl：快捷键徽记渲染在 fixed 覆盖层（测页签视口坐标定位）——与文档布局零关联；页签数字 = Ctrl+1.. 对应各表。 */
export function TabBar({ tables, selected, onSelect, onNew }: TabBarProps) {
  const ctrlHeld = useCtrlHeld()
  const btnRefs = useRef(new Map<string, HTMLButtonElement>())
  const [badges, setBadges] = useState<BadgeSpot[]>([])

  const setRef = (key: string) => (el: HTMLButtonElement | null): void => {
    if (el) btnRefs.current.set(key, el)
    else btnRefs.current.delete(key)
  }

  // Ctrl 按下：测量各页签视口坐标，徽记居中于页签上方 26px
  useLayoutEffect(() => {
    if (!ctrlHeld) {
      setBadges([])
      return
    }
    const spots: BadgeSpot[] = []
    const measure = (key: string, label: string): void => {
      const el = btnRefs.current.get(key)
      if (!el) return
      const r = el.getBoundingClientRect()
      spots.push({ key, label, x: r.left + r.width / 2, y: r.top - 26 })
    }
    tables.forEach((name, i) => measure(name, String(i + 1)))
    measure('+new', 'M')
    setBadges(spots)
  }, [ctrlHeld, tables])

  const tab = (key: string, label: string): React.ReactNode => (
    <button key={key} ref={setRef(key)} className={`tab${selected === key ? ' active' : ''}`} onClick={() => onSelect(key)}>
      {label}
    </button>
  )

  return (
    <div className="tabbar">
      <div className="tab-scroll">
        {tables.map(name => tab(name, name))}
        <button ref={setRef('+new')} className="tab-new" onClick={onNew} title="新建表格">
          +
        </button>
      </div>
      {badges.length > 0 && (
        <div className="kb-overlay">
          {badges.map(b => (
            <span key={b.key} className="kb-badge" style={{ left: b.x, top: b.y }}>
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
