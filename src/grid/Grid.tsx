import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { StructDef, Table } from '../data/types.ts'
import { COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, canvasHeight, layoutColumns, totalWidth, visibleRows } from './layout.ts'
import { formatCell } from './format.ts'
import { DEFAULT_FOCUS, moveFocus, navKeyOf } from './selection.ts'
import type { Focus } from './selection.ts'
import { applyGridCursors } from './cursors.ts'
import './grid.css'

interface GridProps {
  table: Table
  def: StructDef
}

/**
 * 只读网格（M2 渲染 + M3 单选导航）。
 * 结构：viewport（滚动容器，tabIndex 接键盘）> header（sticky top）+ canvas（相对定位）> row（absolute top）> cell。
 * 行头与未来冻结列靠 position:sticky left 定位。
 */
export function Grid({ table, def }: GridProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [focus, setFocus] = useState<Focus>(DEFAULT_FOCUS)

  useEffect(() => {
    applyGridCursors(document.documentElement)
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewportH(el.clientHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 焦点滚入视口：垂直贴边；水平补偿 sticky 行头的遮挡（行头恒占视口左侧 48px）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const top = focus.row * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight

    const contentLeft = ROW_HEADER_WIDTH + focus.col * COL_WIDTH
    const contentRight = contentLeft + COL_WIDTH
    const minScroll = Math.max(0, contentRight - el.clientWidth)
    const maxScroll = Math.max(0, contentLeft - ROW_HEADER_WIDTH)
    if (el.scrollLeft < minScroll) el.scrollLeft = minScroll
    else if (el.scrollLeft > maxScroll) el.scrollLeft = maxScroll
  }, [focus])

  const rowCount = table.rows.length + 10
  const colCount = def.fields.length
  const cols = useMemo(() => layoutColumns(def.fields), [def.fields])
  const width = totalWidth(def.fields.length)
  const { start, end } = visibleRows(scrollTop, viewportH, rowCount)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = navKeyOf(e.key, e.shiftKey)
    if (!key) return
    // 导航键一律阻断原生行为：方向键的滚动、Tab 的焦点跳转
    e.preventDefault()
    setFocus(f => moveFocus(f, key, rowCount, colCount))
  }

  const select = (row: number, col: number): void => {
    setFocus({ row, col })
    viewportRef.current?.focus()
  }

  const rows = []
  for (let i = start; i < end; i++) {
    const record = table.rows[i]
    const cells = cols.map((c, cIdx) => {
      const view = formatCell(c.field, record?.[c.field.name])
      const title = view.kind === 'text' ? view.text : undefined
      const isFocus = i === focus.row && cIdx === focus.col
      return (
        <div
          key={c.field.name}
          className={`cell ${view.kind}${isFocus ? ' focused' : ''}`}
          style={{ width: c.width }}
          title={title}
          onClick={() => select(i, cIdx)}
        >
          {view.kind === 'text' ? view.text : view.kind === 'notimpl' ? 'NotImplemented' : ''}
        </div>
      )
    })
    rows.push(
      <div key={i} className="grid-row" style={{ top: i * ROW_HEIGHT, width }}>
        <div className="cell row-head" style={{ width: ROW_HEADER_WIDTH }}>{i + 1}</div>
        {cells}
      </div>,
    )
  }

  return (
    <div className="grid-viewport" ref={viewportRef} tabIndex={0} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
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
