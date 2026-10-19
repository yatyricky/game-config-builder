import { useLayoutEffect, useRef, useState } from 'react'
import { useCtrlHeld } from './useCtrlHeld.ts'

export interface Tab {
  /** 磁盘文件名（去掉 .json），选区/编辑/新建的唯一标识 */
  name: string
  /** 展示名：文件名不含 schema 名时追加 -<schema>（仅显示，磁盘名不受影响） */
  label: string
}

interface TabBarProps {
  tabs: Tab[]
  selected: string
  onSelect: (tab: string) => void
  onEdit: (name: string) => void
  onNew: () => void
}

interface BadgeSpot {
  key: string
  label: string
  x: number
  y: number
}

/** spec 左侧表栏（2026-10-16 裁决，原底栏 2026-10-09）：各表页签 + [+ 新建] 共享纵向 scroll view（不冻结）。
 * 页签 hover 显现 ✎ 编辑入口（不触发选表）。按住 Ctrl：快捷键徽记渲染在 fixed 覆盖层（测页签视口坐标定位）——
 * 与文档布局零关联；页签数字 = Ctrl+1.. 对应各表。 */
export function TabBar({ tabs, selected, onSelect, onEdit, onNew }: TabBarProps) {
  const ctrlHeld = useCtrlHeld()
  const btnRefs = useRef(new Map<string, HTMLButtonElement>())
  const [badges, setBadges] = useState<BadgeSpot[]>([])

  const setRef = (key: string) => (el: HTMLButtonElement | null): void => {
    if (el) btnRefs.current.set(key, el)
    else btnRefs.current.delete(key)
  }

  // Ctrl 按下：测量各页签视口坐标，徽记垂直居中于页签行、悬浮其右侧（配合 overlay 的 translate(-50%,-50%) 中心定位）
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
      spots.push({ key, label, x: r.right - 32, y: r.top + r.height / 2 })
    }
    tabs.forEach((t, i) => measure(t.name, String(i + 1)))
    measure('+new', 'M')
    setBadges(spots)
  }, [ctrlHeld, tabs])

  const tab = (t: Tab): React.ReactNode => (
    <button
      key={t.name}
      ref={setRef(t.name)}
      className={`tab${selected === t.name ? ' active' : ''}`}
      onClick={() => onSelect(t.name)}
      title={t.label}
    >
      <span className="tab-label">{t.label}</span>
      <span
        className="tab-edit"
        title="编辑表格"
        onClick={e => {
          e.stopPropagation()
          onEdit(t.name)
        }}
      >
        ✎
      </span>
    </button>
  )

  return (
    <div className="tabbar">
      <div className="tab-scroll">
        {tabs.map(tab)}
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
