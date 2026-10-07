import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { StructDef, Table } from '../data/types.ts'
import { COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, canvasHeight, layoutColumns, totalWidth, visibleRows } from './layout.ts'
import { formatCell } from './format.ts'
import { DEFAULT_SELECTION, extendTo, focusToMatrixOrigin, isInSelection, navKeyOf, navigate, singleAt } from './selection.ts'
import type { Focus, Selection } from './selection.ts'
import { applyGridCursors } from './cursors.ts'
import './grid.css'

interface GridProps {
  table: Table
  def: StructDef
}

interface DragState {
  mode: 'cell' | 'col' | 'row'
  start: Focus
}

/**
 * 网格（M2 渲染 + M3 单选 + M4 多选）。
 * 结构：viewport（滚动容器，tabIndex 接键盘）> header（sticky top）+ canvas（相对定位）> row（absolute top）> cell。
 * 行头靠 position:sticky left 定位；选择模型见 selection.ts（显式范围 + 焦点，纯函数）。
 */
export function Grid({ table, def }: GridProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION)
  const [drag, setDrag] = useState<DragState | null>(null)

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

  // 拖拽收尾：网格外释放 mouseup 也要结束，并把矩阵焦点归位首行首列
  useEffect(() => {
    if (!drag) return
    const up = () => {
      setDrag(null)
      setSelection(focusToMatrixOrigin)
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [drag])

  // 焦点滚入视口：垂直贴边；水平补偿 sticky 行头的遮挡（行头恒占视口左侧 48px）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const top = selection.focus.row * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight

    const contentLeft = ROW_HEADER_WIDTH + selection.focus.col * COL_WIDTH
    const contentRight = contentLeft + COL_WIDTH
    const minScroll = Math.max(0, contentRight - el.clientWidth)
    const maxScroll = Math.max(0, contentLeft - ROW_HEADER_WIDTH)
    if (el.scrollLeft < minScroll) el.scrollLeft = minScroll
    else if (el.scrollLeft > maxScroll) el.scrollLeft = maxScroll
  }, [selection])

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
    setSelection(s => navigate(s, key, rowCount, colCount))
  }

  const focusViewport = (): void => viewportRef.current?.focus()

  const startCellDrag = (row: number, col: number) => (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setSelection(singleAt({ row, col }))
    setDrag({ mode: 'cell', start: { row, col } })
    focusViewport()
  }
  const extendCell = (row: number, col: number) => (): void => {
    if (drag?.mode !== 'cell') return
    setSelection(s => extendTo(s, { row, col }))
  }
  const startColDrag = (col: number) => (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setSelection({ rowStart: 0, rowEnd: rowCount - 1, colStart: col, colEnd: col, focus: { row: rowCount - 1, col } })
    setDrag({ mode: 'col', start: { row: 0, col } })
    focusViewport()
  }
  const extendCol = (col: number) => (): void => {
    if (drag?.mode !== 'col') return
    setSelection(s => extendTo(s, { row: rowCount - 1, col }))
  }
  const startRowDrag = (row: number) => (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setSelection({ rowStart: row, rowEnd: row, colStart: 0, colEnd: colCount - 1, focus: { row, col: colCount - 1 } })
    setDrag({ mode: 'row', start: { row, col: 0 } })
    focusViewport()
  }
  const extendRow = (row: number) => (): void => {
    if (drag?.mode !== 'row') return
    setSelection(s => extendTo(s, { row, col: colCount - 1 }))
  }

  const rows = []
  for (let i = start; i < end; i++) {
    const record = table.rows[i]
    const cells = cols.map((c, cIdx) => {
      const view = formatCell(c.field, record?.[c.field.name])
      const title = view.kind === 'text' ? view.text : undefined
      const inSel = isInSelection(selection, i, cIdx)
      const isFocus = i === selection.focus.row && cIdx === selection.focus.col
      return (
        <div
          key={c.field.name}
          className={`cell${inSel && !isFocus ? ' selected' : ''}${isFocus ? ' focused' : ''}`}
          style={{ width: c.width }}
          title={title}
          onMouseDown={startCellDrag(i, cIdx)}
          onMouseEnter={extendCell(i, cIdx)}
        >
          {view.kind === 'text' ? view.text : view.kind === 'notimpl' ? 'NotImplemented' : ''}
        </div>
      )
    })
    rows.push(
      <div key={i} className="grid-row" style={{ top: i * ROW_HEIGHT, width }}>
        <div
          className="cell row-head"
          style={{ width: ROW_HEADER_WIDTH }}
          onMouseDown={startRowDrag(i)}
          onMouseEnter={extendRow(i)}
        >
          {i + 1}
        </div>
        {cells}
      </div>,
    )
  }

  return (
    <div className="grid-viewport" ref={viewportRef} tabIndex={0} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      <div className="grid-header" style={{ width }}>
        <div className="cell corner" style={{ width: ROW_HEADER_WIDTH }} />
        {cols.map((c, cIdx) => (
          <div
            key={c.field.name}
            className="cell col-head"
            style={{ width: c.width }}
            title={c.field.displayName ?? c.field.name}
            onMouseDown={startColDrag(cIdx)}
            onMouseEnter={extendCol(cIdx)}
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
