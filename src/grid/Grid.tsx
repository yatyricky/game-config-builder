import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { isStringType } from '../data/types.ts'
import type { StructDef, Table } from '../data/types.ts'
import { COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, canvasHeight, layoutColumns, totalWidth, visibleRows } from './layout.ts'
import { formatCell } from './format.ts'
import { DEFAULT_SELECTION, focusToMatrixOrigin, isInSelection, navKeyOf, navigate, rectBetween, singleAt } from './selection.ts'
import type { Focus, Selection } from './selection.ts'
import { buildClipboard, planPaste } from '../data/clipboard.ts'
import type { ClipboardContent, PasteWrite, SelectionBounds } from '../data/clipboard.ts'
import { applyGridCursors } from './cursors.ts'
import './grid.css'

interface GridProps {
  table: Table
  def: StructDef
  /** 编辑提交（M5 写内存；写盘属 M7） */
  onEditCell?: (row: number, fieldName: string, value: string) => void
  /** 粘贴批量写入 */
  onApplyWrites?: (writes: PasteWrite[]) => void
  /** 粘贴失败提示（null=清除） */
  onPasteError?: (message: string) => void
}

interface DragState {
  mode: 'cell' | 'col' | 'row'
  start: Focus
}

interface EditingCell {
  row: number
  col: number
  value: string
}

/**
 * 网格（M2 渲染 + M3 单选 + M4 多选 + M5 编辑态）。
 * 结构：viewport（滚动容器，tabIndex 接键盘）> header（sticky top）+ canvas（相对定位）> row（absolute top）> cell。
 * 编辑态（仅 string 字段）：双击 / F2 / 导航态直接键入（含 IME）进入；Enter/Tab 系提交后执行导航态行为；Esc 取消。
 */
export function Grid({ table, def, onEditCell, onApplyWrites, onPasteError }: GridProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 剪切板（应用内值快照 + 源选区；跑马灯渲染依赖它，故用 state） */
  const [clipboard, setClipboard] = useState<{ content: ClipboardContent; source: SelectionBounds } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)

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

  const isStringField = (col: number): boolean => isStringType(def.fields[col].type)

  const cellString = (row: number, col: number): string => {
    const v = table.rows[row]?.[def.fields[col].name]
    return typeof v === 'string' ? v : ''
  }

  /** 进入编辑态（仅 string 字段；spec：其他类型 NotImplemented）。裁决：进入编辑前清除剪切板 */
  const enterEdit = (row: number, col: number): void => {
    if (!isStringField(col)) return
    setClipboard(null)
    setEditing({ row, col, value: cellString(row, col) })
  }

  /** 提交当前编辑。返回是否成功（M5 阶段 string 恒合法；非法拦截钩子留待后续扩展） */
  const commitEdit = (): boolean => {
    if (!editing) return true
    onEditCell?.(editing.row, def.fields[editing.col].name, editing.value)
    setEditing(null)
    return true
  }

  const focusViewport = (): void => {
    viewportRef.current?.focus()
  }

  // ---- 剪切板（应用内值快照；写盘/系统剪切板集成属 M7+） ----
  const copySelection = (): void => {
    setClipboard({ content: buildClipboard(table.rows, def, selection), source: selection })
  }

  const pasteAtSelection = (): void => {
    if (!clipboard) return
    const plan = planPaste(clipboard.content, selection, def, rowCount, colCount, clipboard.source)
    if (plan.status === 'error') {
      onPasteError?.(plan.message)
      return
    }
    onApplyWrites?.(plan.writes)
  }

  // ---- 键盘：导航态（viewport 级） ----
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (editing) return // 编辑态按键由输入框处理
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        copySelection()
        return
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        pasteAtSelection()
        return
      }
    }
    // Delete：清除选区内全部单元格内容（写 undefined，走批量写入通路→防抖保存）
    if (e.key === 'Delete' && !editing) {
      e.preventDefault()
      const writes: PasteWrite[] = []
      for (let r = selection.rowStart; r <= selection.rowEnd; r++) {
        for (let c = selection.colStart; c <= selection.colEnd; c++) {
          writes.push({ row: r, fieldName: def.fields[c].name, value: undefined })
        }
      }
      if (writes.length > 0) onApplyWrites?.(writes)
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      enterEdit(selection.focus.row, selection.focus.col)
      return
    }
    // spec：导航态 string 焦点可直接键入（含 IME）进入编辑态且不消费本次键盘事件——
    // 同步挂载输入框并聚焦，让默认文本插入 / IME 组合落在输入框上
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    const ime = e.key === 'Process' || e.nativeEvent.isComposing || e.keyCode === 229
    if ((printable || ime) && isStringField(selection.focus.col)) {
      // 裁决：进入编辑前清除剪切板；同步挂载并聚焦输入框，让默认文本插入 / IME 组合落在输入框上
      flushSync(() => {
        setClipboard(null)
        setEditing({ row: selection.focus.row, col: selection.focus.col, value: '' })
      })
      inputRef.current?.focus()
      return
    }
    const key = navKeyOf(e.key, e.shiftKey)
    if (!key) return
    // 导航键一律阻断原生行为：方向键的滚动、Tab 的焦点跳转
    e.preventDefault()
    setSelection(s => navigate(s, key, rowCount, colCount))
  }

  // ---- 键盘：编辑态（输入框级） ----
  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      // 取消编辑，恢复原值回导航态
      e.preventDefault()
      setEditing(null)
      focusViewport()
      return
    }
    const key = navKeyOf(e.key, e.shiftKey)
    if (key === 'Enter' || key === 'ShiftEnter' || key === 'Tab' || key === 'ShiftTab') {
      // 提交内容，切换导航态，然后执行该按键导航态的行为
      e.preventDefault()
      commitEdit()
      setSelection(s => navigate(s, key, rowCount, colCount))
      focusViewport()
      return
    }
    // 编辑态方向键只操作编辑控件：上下键移动 caret 到文本首/尾；左右键走默认
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      inputRef.current?.setSelectionRange(0, 0)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const len = inputRef.current?.value.length ?? 0
      inputRef.current?.setSelectionRange(len, len)
      return
    }
  }

  // ---- 鼠标：编辑中点击任何选择目标，先提交再选中（非法时忽略点击，M5 阶段恒合法） ----
  const beginDrag = (): boolean => {
    if (editing && !commitEdit()) return false
    return true
  }

  const startCellDrag = (row: number, col: number) => (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (!beginDrag()) return
    setSelection(singleAt({ row, col }))
    setDrag({ mode: 'cell', start: { row, col } })
    focusViewport()
  }
  const extendCell = (row: number, col: number) => (): void => {
    if (drag?.mode !== 'cell') return
    setSelection(rectBetween(drag.start, { row, col }))
  }
  const startColDrag = (col: number) => (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (!beginDrag()) return
    setSelection({ rowStart: 0, rowEnd: rowCount - 1, colStart: col, colEnd: col, focus: { row: rowCount - 1, col } })
    setDrag({ mode: 'col', start: { row: 0, col } })
    focusViewport()
  }
  const extendCol = (col: number) => (): void => {
    if (drag?.mode !== 'col') return
    setSelection(rectBetween({ row: 0, col: drag.start.col }, { row: rowCount - 1, col }))
  }
  const startRowDrag = (row: number) => (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (!beginDrag()) return
    setSelection({ rowStart: row, rowEnd: row, colStart: 0, colEnd: colCount - 1, focus: { row, col: colCount - 1 } })
    setDrag({ mode: 'row', start: { row, col: 0 } })
    focusViewport()
  }
  const extendRow = (row: number) => (): void => {
    if (drag?.mode !== 'row') return
    setSelection(rectBetween({ row: drag.start.row, col: 0 }, { row, col: colCount - 1 }))
  }

  const rows = []
  for (let i = start; i < end; i++) {
    const record = table.rows[i]
    const cells = cols.map((c, cIdx) => {
      const view = formatCell(c.field, record?.[c.field.name])
      const title = view.kind === 'text' ? view.text : undefined
      const inSel = isInSelection(selection, i, cIdx)
      const isFocus = i === selection.focus.row && cIdx === selection.focus.col
      const isEditingThis = editing !== null && editing.row === i && editing.col === cIdx
      return (
        <div
          key={c.field.name}
          className={`cell${inSel && !isFocus ? ' selected' : ''}${isFocus ? ' focused' : ''}`}
          style={{ width: c.width }}
          title={title}
          onMouseDown={startCellDrag(i, cIdx)}
          onMouseEnter={extendCell(i, cIdx)}
          onDoubleClick={() => enterEdit(i, cIdx)}
        >
          {isEditingThis && editing ? (
            <input
              ref={inputRef}
              className="cell-input"
              value={editing.value}
              autoFocus
              onChange={e => setEditing(prev => (prev ? { ...prev, value: e.target.value } : prev))}
              onKeyDown={onInputKeyDown}
              onMouseDown={e => e.stopPropagation()}
            />
          ) : view.kind === 'text' ? (
            view.text
          ) : view.kind === 'notimpl' ? (
            'NotImplemented'
          ) : (
            ''
          )}
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
        {clipboard && (
          <svg
            className="copy-marquee"
            style={{
              left: ROW_HEADER_WIDTH + clipboard.source.colStart * COL_WIDTH,
              top: clipboard.source.rowStart * ROW_HEIGHT,
              width: (clipboard.source.colEnd - clipboard.source.colStart + 1) * COL_WIDTH,
              height: (clipboard.source.rowEnd - clipboard.source.rowStart + 1) * ROW_HEIGHT,
            }}
          >
            <rect />
          </svg>
        )}
      </div>
    </div>
  )
}
