import { useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

export interface NoticeItem {
  id: string
  kind: 'error' | 'info'
  text: string
}

interface NoticesProps {
  items: NoticeItem[]
  onClose: (id: string) => void
}

const STACK_GAP = 8
/** 重叠模式下每张旧卡露出的顶部条宽 */
const PEEK = 36

/**
 * 右下角通知卡片（裁决 2026-10-08）：扑克牌堆叠——
 * 卡片高度永不改变；useLayoutEffect 测量实际高度后纯 JS 计算 z-index 与 bottom 偏移：
 * 最新卡 bottom=0、z 最高；旧卡依次上移，空间充足时步进=前卡高+gap，
 * 总高超出容器（30vh）时步进钳制为 PEEK（后卡只露出顶部一条边），整摞不超容器。
 * 仅点 × 关闭，不自动关闭。
 */
export function Notices({ items, onClose }: NoticesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [layout, setLayout] = useState<{ bottom: number; zIndex: number }[]>([])

  // items 变化（新增/关闭）后测量重排：最新卡锚底，旧卡向上步进；
  // 自然步进会超出容器时切换扑克重叠（每张只露出 PEEK 条），并硬保底不出容器
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const containerH = container.clientHeight
    const heights = cardRefs.current.map(el => el?.offsetHeight ?? 0)
    const bottoms: number[] = []
    let prevBottom = 0
    let prevHeight = 0
    items.forEach((_, i) => {
      const h = heights[i] ?? 0
      if (i === 0) {
        bottoms.push(0)
      } else {
        const natural = prevBottom + prevHeight + STACK_GAP
        let bottom = natural
        if (bottom + h > containerH) bottom = Math.max(0, Math.min(prevBottom + PEEK, containerH - h))
        bottoms.push(bottom)
      }
      prevBottom = bottoms[i]
      prevHeight = h
    })
    // 最新卡 z 最高（渲染顺序最新在前，z 递减）
    setLayout(bottoms.map((bottom, i) => ({ bottom, zIndex: items.length - i })))
  }, [items])

  if (items.length === 0) return null

  const close = (id: string) => (e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    onClose(id)
  }

  return (
    <div className="notices" ref={containerRef}>
      {items.map((n, i) => {
        const pos = layout[i]
        return (
          <div
            key={n.id}
            ref={el => {
              cardRefs.current[i] = el
            }}
            className={`notice-card ${n.kind}`}
            style={{
              bottom: pos?.bottom ?? 0,
              zIndex: pos?.zIndex ?? i,
            }}
            title={n.text}
          >
            <button className="notice-close" onClick={close(n.id)} aria-label="关闭">
              ×
            </button>
            <div className="notice-text">{n.text}</div>
          </div>
        )
      })}
    </div>
  )
}
