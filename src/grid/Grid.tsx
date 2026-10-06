import { useEffect, useMemo, useRef, useState } from 'react'
import type { StructDef, Table } from '../data/types.ts'
import { ROW_HEADER_WIDTH, ROW_HEIGHT, canvasHeight, layoutColumns, totalWidth, visibleRows } from './layout.ts'
import { formatCell } from './format.ts'
import './grid.css'

interface GridProps {
  table: Table
  def: StructDef
}

/**
 * 只读网格（M2）：冻结表头与行头 + 行虚拟滚动。
 * 结构：viewport（滚动容器）> header（sticky top）+ canvas（相对定位）> row（absolute top）> cell。
 * 行头与未来冻结列靠 position:sticky left 定位。
 */
export function Grid({ table, def }: GridProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewportH(el.clientHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const rowCount = table.rows.length + 10
  const cols = useMemo(() => layoutColumns(def.fields), [def.fields])
  const width = totalWidth(def.fields.length)
  const { start, end } = visibleRows(scrollTop, viewportH, rowCount)

  const rows = []
  for (let i = start; i < end; i++) {
    const record = table.rows[i]
    const cells = cols.map(c => {
      const view = formatCell(c.field, record?.[c.field.name])
      const title = view.kind === 'text' ? view.text : undefined
      return (
        <div key={c.field.name} className={`cell ${view.kind}`} style={{ width: c.width }} title={title}>
          {view.kind === 'text' ? view.text : view.kind === 'notimpl' ? 'NotImplemented' : ''}
        </div>
      )
    })
    rows.push(
      <div key={i} className="grid-row" style={{ top: i * ROW_HEIGHT, width }}>
        <div className="cell row-head">{i + 1}</div>
        {cells}
      </div>,
    )
  }

  return (
    <div className="grid-viewport" ref={viewportRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      <div className="grid-header" style={{ width }}>
        <div className="cell corner" style={{ width: ROW_HEADER_WIDTH }} />
        {cols.map(c => (
          <div
            key={c.field.name}
            className="cell col-head"
            style={{ width: c.width }}
            title={c.field.displayName ?? c.field.name}
          >
            {c.field.displayName ?? c.field.name}
          </div>
        ))}
      </div>
      <div className="grid-canvas" style={{ width, height: canvasHeight(rowCount) }}>
        {rows}
      </div>
    </div>
  )
}
