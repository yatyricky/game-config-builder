import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { TypeDef, TypeNode, Project } from '../data/types.ts'
import { typeNodeLabel } from '../data/types.ts'
import { canDeleteType } from '../data/schemaEdit.ts'
import { ConstraintIcons } from './constraintIcons.tsx'

export interface SettingsActions {
  newType: () => void
  deleteType: (name: string) => void
  /** fieldName=null 表示新增 */
  editField: (typeName: string, fieldName: string | null) => void
  /** memberName=null 表示新增 */
  editMember: (enumName: string, memberName: string | null) => void
  editEnumCard: (enumName: string) => void
}

interface SettingsModalProps {
  project: Project
  /** 工程目录名——布局持久化的 key（FSA 唯一稳定标识；同名目录共享布局） */
  projectName: string
  actions: SettingsActions
  onClose: () => void
}

/** 布局常量——行高/表头高须与 .er-row / .er-head css 保持一致（同 grid ROW_HEIGHT 约定） */
const CARD_W = 280
const HEADER_H = 36
const ROW_H = 30
const H_GAP = 140
const V_GAP = 24
const PAD = 24
const ZOOM_MIN = 0.1
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1

interface Pos {
  x: number
  y: number
}

interface CardGeo {
  def: TypeDef
  w: number
  h: number
  /** 字段/成员名 → 卡片内 y 中心 */
  rowY: Map<string, number>
  /** 连线目标锚点（pk 字段行；无 pk 用表头中心） */
  anchorY: number
}

interface Edge {
  x1: number
  y1: number
  x2: number
  y2: number
  /** 回边/自环走右侧外绕 */
  back: boolean
}

const layoutKey = (name: string): string => `gcb.er-layout.${name}`

function loadLayout(name: string): { pos: Record<string, Pos>; zoom: number } | null {
  if (!name) return null
  try {
    const raw = localStorage.getItem(layoutKey(name))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { pos?: Record<string, Pos>; zoom?: number }
    return { pos: parsed.pos ?? {}, zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 1 }
  } catch {
    return null
  }
}

function saveLayout(name: string, pos: Map<string, Pos>, zoom: number): void {
  if (!name) return
  const out: Record<string, Pos> = {}
  for (const [k, v] of pos) out[k] = v
  localStorage.setItem(layoutKey(name), JSON.stringify({ pos: out, zoom }))
}

/** 收集类型节点树内全部命名类型引用（任意深度，去重） */
function refsOf(node: TypeNode, out: Set<string>): void {
  if ('raw' in node) {
    out.add(node.raw)
    return
  }
  if ('array' in node) {
    refsOf(node.elementType, out)
    return
  }
  refsOf(node.keyType, out)
  refsOf(node.valueType, out)
}

/** 分层自动布局（初始/缺省位置）：仅按 struct→struct 引用分层，被引用者在左；enum 无引用落第 0 列 */
function autoLayout(types: Map<string, TypeDef>): Map<string, Pos> {
  const level = new Map<string, number>()
  const resolving = new Set<string>()
  const levelOf = (name: string): number => {
    const memo = level.get(name)
    if (memo !== undefined) return memo
    if (resolving.has(name)) return 0 // 环兜底
    resolving.add(name)
    const def = types.get(name)
    let lv = 0
    if (def?.kind === 'struct') {
      for (const f of def.fields) {
        const refs = new Set<string>()
        refsOf(f.type, refs)
        for (const r of refs) {
          if (r === name) continue
          const target = types.get(r)
          if (target?.kind !== 'struct') continue // enum 不参与连线与分层
          lv = Math.max(lv, levelOf(r) + 1)
        }
      }
    }
    resolving.delete(name)
    level.set(name, lv)
    return lv
  }
  for (const name of types.keys()) levelOf(name)

  const columns = new Map<number, string[]>()
  for (const name of types.keys()) {
    const lv = level.get(name) ?? 0
    const col = columns.get(lv) ?? []
    col.push(name)
    columns.set(lv, col)
  }

  const pos = new Map<string, Pos>()
  for (const [lv, names] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    let y = PAD
    const x = PAD + lv * (CARD_W + H_GAP)
    for (const name of names) {
      const def = types.get(name)
      if (!def) continue
      pos.set(name, { x, y })
      y += HEADER_H + rowCountOf(def) * ROW_H + V_GAP
    }
  }
  return pos
}

function rowCountOf(def: TypeDef): number {
  return def.kind === 'enum' ? def.members.length : def.fields.length
}
/**
 * 设置 modal（裁决 2026-10-09/10）：ER 式卡片节点图——一类型一卡片，字段引用连线到目标 struct 的 pk 行
 * （enum 不连线；仅简单连线无箭头）。卡片可拖拽，位置与缩放按工程目录名持久化；分层布局作缺省。
 * 编辑与显式保存属 M8b。
 */
export function SettingsModal({ project, projectName, actions, onClose }: SettingsModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const geo = useMemo(() => {
    const m = new Map<string, CardGeo>()
    for (const [name, def] of project.types) {
      const rowY = new Map<string, number>()
      const items = def.kind === 'enum' ? def.members.map(x => x.name) : def.fields.map(f => f.name)
      items.forEach((n, i) => rowY.set(n, HEADER_H + i * ROW_H + ROW_H / 2))
      let anchorY = HEADER_H / 2
      if (def.kind === 'struct') {
        const pk = def.fields.findIndex(f => f.pk)
        if (pk >= 0) anchorY = HEADER_H + pk * ROW_H + ROW_H / 2
      }
      m.set(name, { def, w: CARD_W, h: HEADER_H + rowCountOf(def) * ROW_H, rowY, anchorY })
    }
    return m
  }, [project.types])
  const [positions, setPositions] = useState<Map<string, Pos>>(() => {
    const auto = autoLayout(project.types)
    const stored = loadLayout(projectName)
    if (!stored) return auto
    for (const [name, p] of auto) {
      if (!stored.pos[name]) stored.pos[name] = p
    }
    const merged = new Map<string, Pos>()
    for (const name of project.types.keys()) merged.set(name, stored.pos[name] ?? { x: PAD, y: PAD })
    return merged
  })
  const [zoom, setZoom] = useState(() => loadLayout(projectName)?.zoom ?? 1)
  const [drag, setDrag] = useState<{ name: string; startX: number; startY: number; orig: Pos } | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // 编辑期间新建的类型补缺省位置（编辑器在 modal 开着时落盘新类型）
  useEffect(() => {
    setPositions(prev => {
      let changed = false
      const next = new Map(prev)
      for (const name of project.types.keys()) {
        if (!next.has(name)) {
          next.set(name, { x: PAD + (next.size % 3) * (CARD_W + H_GAP), y: PAD + Math.floor(next.size / 3) * 240 })
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [project.types])

  const persist = (nextPos: Map<string, Pos>, nextZoom: number): void => {
    setPositions(nextPos)
    setZoom(nextZoom)
    saveLayout(projectName, nextPos, nextZoom)
  }

  // 拖拽（delta ÷ zoom 换算画布坐标）
  const onCardDown = (name: string) => (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return
    const orig = positions.get(name)
    if (!orig) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ name, startX: e.clientX, startY: e.clientY, orig })
  }
  const onCardMove = (e: ReactPointerEvent<HTMLElement>): void => {
    if (!drag) return
    const x = drag.orig.x + (e.clientX - drag.startX) / zoom
    const y = drag.orig.y + (e.clientY - drag.startY) / zoom
    setPositions(prev => new Map(prev).set(drag.name, { x, y }))
  }
  const onCardUp = (e: ReactPointerEvent<HTMLElement>): void => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag(null)
    saveLayout(projectName, positions, zoom)
  }

  const setZoomTo = (z: number): void => {
    persist(positions, Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10)))
  }
  const resetLayout = (): void => {
    localStorage.removeItem(layoutKey(projectName))
    setPositions(autoLayout(project.types))
    setZoom(1)
  }

  // 画布尺寸随卡片拖动外扩
  const { width, height } = useMemo(() => {
    let w = 0
    let h = 0
    for (const [name, p] of positions) {
      const g = geo.get(name)
      if (!g) continue
      w = Math.max(w, p.x + g.w)
      h = Math.max(h, p.y + g.h)
    }
    return { width: w + PAD, height: h + PAD }
  }, [positions, geo])

  /** 连线：仅 struct 字段内的 struct 引用（enum 引用不画），目标锚 pk 行 */
  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    for (const [name, p] of positions) {
      const g = geo.get(name)
      if (!g || g.def.kind !== 'struct') continue
      for (const f of g.def.fields) {
        const refs = new Set<string>()
        refsOf(f.type, refs)
        for (const r of refs) {
          const target = project.types.get(r)
          if (r === name || target?.kind !== 'struct') continue
          const tg = geo.get(r)
          const tp = positions.get(r)
          if (!tg || !tp) continue
          const fromY = p.y + (g.rowY.get(f.name) ?? g.anchorY)
          const forward = tp.x >= p.x + g.w
          out.push({
            x1: p.x + g.w,
            y1: fromY,
            x2: forward ? tp.x : tp.x + tg.w,
            y2: tp.y + tg.anchorY,
            back: !forward,
          })
        }
        if (refs.has(name)) {
          // 自环（递归类型）：右侧外绕回自身锚点
          out.push({
            x1: p.x + g.w,
            y1: p.y + (g.rowY.get(f.name) ?? g.anchorY),
            x2: p.x + g.w,
            y2: p.y + g.anchorY,
            back: true,
          })
        }
      }
    }
    return out
  }, [positions, geo, project.types])

  /** 悬停 title：完整字段信息（名称 + 类型标签 + 约束全称，与行内图标一一对应） */
  const rowTitle = (f: FieldDef): string => {
    const parts: string[] = []
    if (f.pk) parts.push('主键')
    if (f.index) parts.push('索引')
    if (f.unique) parts.push('唯一')
    if (f.nullable) parts.push('可空')
    if (f.default !== undefined) parts.push(`默认值=${JSON.stringify(f.default)}`)
    if (f.group) parts.push('分组')
    const badge = parts.length > 0 ? '  ' + parts.map(p => `(${p})`).join('') : ''
    return `${f.name} ${typeNodeLabel(f.type)}${badge}`
  }

  const edgePath = (e: Edge): string => {
    const dx = e.back ? 90 : Math.max(50, (e.x2 - e.x1) / 2)
    return `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - (e.back ? -dx : dx)} ${e.y2}, ${e.x2} ${e.y2}`
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="设置">
        <header className="settings-header">
          <span className="settings-title">设置</span>
          <span className="settings-sub">类型关系图（连线 = 字段引用 → 目标类型 pk；点击字段行编辑）</span>
          <span className="er-zoombar">
            <button onClick={actions.newType}>添加卡片</button>
            <button onClick={() => setZoomTo(zoom - ZOOM_STEP)} aria-label="缩小">−</button>
            <span className="zoom-value">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoomTo(zoom + ZOOM_STEP)} aria-label="放大">＋</button>
            <button className="zoom-reset" onClick={resetLayout}>重置布局</button>
          </span>
          <button ref={closeRef} className="settings-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="er-scroll">
          <div className="er-zoom" style={{ width: width * zoom, height: height * zoom }}>
            <div className="er-canvas" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
              <svg className="er-edges" width={width} height={height}>
                {edges.map((e, i) => (
                  <path key={i} d={edgePath(e)} />
                ))}
              </svg>
              {[...positions.entries()].map(([name, p]) => {
                const g = geo.get(name)
                if (!g) return null
                const d = g.def
                const deletable = canDeleteType(project, name)
                const stop = (e: ReactPointerEvent<HTMLElement>): void => e.stopPropagation()
                return (
                  <section
                    key={name}
                    className={`er-card${drag?.name === name ? ' dragging' : ''}${d.kind === 'struct' && !d.fields.some(f => f.pk) ? ' no-pk' : ''}`}
                    style={{ left: p.x, top: p.y, width: g.w }}
                  >
                    <header
                      className="er-head"
                      onPointerDown={onCardDown(name)}
                      onPointerMove={onCardMove}
                      onPointerUp={onCardUp}
                      onPointerCancel={onCardUp}
                    >
                      <span className="er-head-main">
                        <span className="card-name">{name}</span>
                        <span className="card-kind">
                          {d.kind === 'enum' ? 'enum' : 'struct'}
                          {d.kind === 'enum' && d.flags ? ' · flags' : ''}
                        </span>
                      </span>
                      <span className="er-head-actions">
                        {d.kind === 'enum' && (
                          <button className="er-icon-btn" title="编辑卡片" onPointerDown={stop} onClick={() => actions.editEnumCard(name)}>
                            ✎
                          </button>
                        )}
                        <button
                          className="er-icon-btn"
                          title={d.kind === 'enum' ? '新增成员' : '新增字段'}
                          onPointerDown={stop}
                          onClick={() => (d.kind === 'enum' ? actions.editMember(name, null) : actions.editField(name, null))}
                        >
                          ＋
                        </button>
                        {deletable && (
                          <button className="er-icon-btn danger" title="删除类型（无引用、无数据）" onPointerDown={stop} onClick={() => actions.deleteType(name)}>
                            🗑
                          </button>
                        )}
                      </span>
                    </header>
                    {d.kind === 'enum'
                      ? d.members.map(m => (
                          <div key={m.name} className="er-row clickable" onClick={() => actions.editMember(name, m.name)}>
                            <span className="er-row-main">
                              <span className="er-row-name">{m.name}</span>
                              {m.displayName && <span className="type-label">{m.displayName}</span>}
                            </span>
                            <span className="er-row-badges">
                              <span className="attr">{m.value}</span>
                            </span>
                          </div>
                        ))
                      : d.fields.map(f => (
                          <div key={f.name} className="er-row clickable" title={rowTitle(f)} onClick={() => actions.editField(name, f.name)}>
                            <span className="er-row-main">
                              <span className="er-row-name">{f.name}</span>
                              <span className="type-label">{typeNodeLabel(f.type)}</span>
                            </span>
                            <ConstraintIcons field={f} />
                          </div>
                        ))}
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
