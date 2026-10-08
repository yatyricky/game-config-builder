interface TabBarProps {
  tables: string[]
  /** 'schemas' 或表名 */
  selected: string
  onSelect: (tab: string) => void
  onNew: () => void
}

/** spec 底栏：Schemas | 各表页签（横向 scroll view，滚动条 4px）| [+新建表格] 被挤到最右端后冻结显示 */
export function TabBar({ tables, selected, onSelect, onNew }: TabBarProps) {
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
        +新建表格
      </button>
    </div>
  )
}
