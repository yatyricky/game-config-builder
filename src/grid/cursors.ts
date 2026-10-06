/**
 * spec 三态鼠标指针（用户提供的 Excel 经典款参考图）：
 * - 工作区：白色粗十字 + 黑描边 + 右下橄榄绿硬阴影，热点居中
 * - 表头：黑色块状向下箭头（细橄榄绿描边），热点在箭尖
 * - 行头：黑色块状向右箭头，热点在箭尖
 * 注：现代 Excel（本机 EXCEL.EXE 资源提取）工作区指针是黑色四芒星且无阴影，
 * 与 spec「右下方硬阴影」不符，故按经典款手绘。提取脚本在 .tmp/parse-cursors.mjs 备查。
 * Chrome 不支持 SVG cursor，canvas → PNG data URI 注入 CSS 变量。
 */

const OLIVE_SHADOW = '#6e7e55'
const OLIVE_EDGE = '#96ab73'

type Pt = readonly [number, number]

const PLUS_PTS: Pt[] = [
  [8, 0], [16, 0], [16, 8], [24, 8], [24, 16], [16, 16], [16, 24], [8, 24], [8, 16], [0, 16], [0, 8], [8, 8],
]
const RIGHT_PTS: Pt[] = [[2, 10], [15, 10], [15, 5], [26, 13], [15, 21], [15, 16], [2, 16]]
const DOWN_PTS: Pt[] = [[10, 2], [16, 2], [16, 15], [21, 15], [13, 26], [5, 15], [10, 15]]

function polygon(ctx: CanvasRenderingContext2D, pts: Pt[], ox = 0, oy = 0): void {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + ox, y + oy) : ctx.lineTo(x + ox, y + oy)))
  ctx.closePath()
}

interface CursorDrawing {
  size: number
  hotspot: readonly [number, number]
  draw: (ctx: CanvasRenderingContext2D) => void
  fallback: string
}

function makeCursor(spec: CursorDrawing): string {
  const canvas = document.createElement('canvas')
  canvas.width = spec.size
  canvas.height = spec.size
  const ctx = canvas.getContext('2d')
  if (!ctx) return spec.fallback
  spec.draw(ctx)
  return `url(${canvas.toDataURL('image/png')}) ${spec.hotspot[0]} ${spec.hotspot[1]}, ${spec.fallback}`
}

const CELL_CURSOR: CursorDrawing = {
  size: 28,
  hotspot: [12, 12],
  fallback: 'cell',
  draw: ctx => {
    ctx.fillStyle = OLIVE_SHADOW
    polygon(ctx, PLUS_PTS, 2, 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    polygon(ctx, PLUS_PTS)
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    polygon(ctx, PLUS_PTS)
    ctx.stroke()
  },
}

const COL_CURSOR: CursorDrawing = {
  size: 28,
  hotspot: [13, 26],
  fallback: 'default',
  draw: ctx => {
    ctx.fillStyle = '#000'
    polygon(ctx, DOWN_PTS)
    ctx.fill()
    ctx.strokeStyle = OLIVE_EDGE
    ctx.lineWidth = 1
    polygon(ctx, DOWN_PTS)
    ctx.stroke()
  },
}

const ROW_CURSOR: CursorDrawing = {
  size: 28,
  hotspot: [26, 13],
  fallback: 'default',
  draw: ctx => {
    ctx.fillStyle = '#000'
    polygon(ctx, RIGHT_PTS)
    ctx.fill()
    ctx.strokeStyle = OLIVE_EDGE
    ctx.lineWidth = 1
    polygon(ctx, RIGHT_PTS)
    ctx.stroke()
  },
}

/** 把三个指针写入 root 的 CSS 变量（--cursor-cell / --cursor-col / --cursor-row），幂等可重复调用 */
export function applyGridCursors(root: HTMLElement | null): void {
  if (!root) return
  root.style.setProperty('--cursor-cell', makeCursor(CELL_CURSOR))
  root.style.setProperty('--cursor-col', makeCursor(COL_CURSOR))
  root.style.setProperty('--cursor-row', makeCursor(ROW_CURSOR))
}
