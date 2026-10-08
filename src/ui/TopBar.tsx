interface TopBarProps {
  projectName: string | null
  recents: string[]
  onOpen: () => void
  onReopen: (name: string) => void
  onSave: () => void
  onExport: () => void
}

/** spec 菜单顶栏：GCB [路径下拉 ▼] [打开] [保存] [导出]；下拉展示当前工程与近期名单（FSA 只暴露目录名） */
export function TopBar({ projectName, recents, onOpen, onReopen, onSave, onExport }: TopBarProps) {
  return (
    <div className="topbar">
      <span className="brand">GCB</span>
      <select
        className="path-select"
        value={projectName ?? ''}
        onChange={e => {
          const v = e.target.value
          if (v && v !== projectName) onReopen(v)
        }}
      >
        {!projectName && <option value="">未打开工程</option>}
        {projectName && <option value={projectName}>{projectName}</option>}
        {recents.filter(n => n !== projectName).map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button onClick={onOpen}>打开</button>
      <button onClick={onSave}>保存</button>
      <button onClick={onExport}>导出</button>
    </div>
  )
}
