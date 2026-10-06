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

/** 图形定义的基准空间（多边形坐标以此为准），渲染时整体缩放到目标尺寸 */
const BASE = 28
/** 目标 CSS 尺寸：28 缩小 20% */
const CSS_SIZE = 22
/** 超采样倍率：先高分辨率绘制再降采样，斜边更干净 */
const SUPERSAMPLE = 2

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
  hotspot: readonly [number, number]
  draw: (ctx: CanvasRenderingContext2D) => void
  fallback: string
}

function makeCursor(spec: CursorDrawing): string {
  const px = CSS_SIZE
  const k = CSS_SIZE / BASE
  // 超采样画布：目标位图 × SUPERSAMPLE，再高质量降采样
  const ss = px * SUPERSAMPLE
  const canvas = document.createElement('canvas')
  canvas.width = ss
  canvas.height = ss
  const ctx = canvas.getContext('2d')
  if (!ctx) return spec.fallback
  ctx.scale(k * SUPERSAMPLE, k * SUPERSAMPLE)
  spec.draw(ctx)
  const out = document.createElement('canvas')
  out.width = px
  out.height = px
  const octx = out.getContext('2d')
  if (!octx) return spec.fallback
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(canvas, 0, 0, px, px)
  const hx = Math.round(spec.hotspot[0] * k)
  const hy = Math.round(spec.hotspot[1] * k)
  return `url(${out.toDataURL('image/png')}) ${hx} ${hy}, ${spec.fallback}`
}

const CELL_CURSOR: CursorDrawing = {
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
    ctx.lineWidth = 1.4
    polygon(ctx, PLUS_PTS)
    ctx.stroke()
  },
}

const COL_CURSOR: CursorDrawing = {
  hotspot: [13, 26],
  fallback: 'default',
  draw: ctx => {
    ctx.fillStyle = '#000'
    polygon(ctx, DOWN_PTS)
    ctx.fill()
    ctx.strokeStyle = OLIVE_EDGE
    ctx.lineWidth = 1.2
    polygon(ctx, DOWN_PTS)
    ctx.stroke()
  },
}

const ROW_CURSOR: CursorDrawing = {
  hotspot: [26, 13],
  fallback: 'default',
  draw: ctx => {
    ctx.fillStyle = '#000'
    polygon(ctx, RIGHT_PTS)
    ctx.fill()
    ctx.strokeStyle = OLIVE_EDGE
    ctx.lineWidth = 1.2
    polygon(ctx, RIGHT_PTS)
    ctx.stroke()
  },
}

/** 把三个指针写入 root 的 CSS 变量（--cursor-cell / --cursor-col / --cursor-row），幂等可重复调用。
 * 位图按 CSS 尺寸输出（实测 Chrome 将 cursor 位图按 CSS 像素解释，DPR 放大会反而变大）；清晰度靠超采样降采样。 */
export function applyGridCursors(root: HTMLElement | null): void {
  if (!root) return
  root.style.setProperty('--cursor-cell', makeCursor(CELL_CURSOR))
  root.style.setProperty('--cursor-col', makeCursor(COL_CURSOR))
  root.style.setProperty('--cursor-row', makeCursor(ROW_CURSOR))
}
