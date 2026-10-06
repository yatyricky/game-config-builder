/**
 * spec 三态鼠标指针：工作区 = Excel 粗体空心十字 + 右下硬阴影；表头 = ⇩；行头 = ⇨。
 * Chrome 不支持 SVG cursor，用 canvas 绘制后转 PNG data URI，注入 CSS 变量。
 */

interface CursorSpec {
  width: number
  height: number
  hotspot: readonly [number, number]
  draw: (ctx: CanvasRenderingContext2D) => void
  fallback: string
}

/** 26x26 粗十字（臂宽 10，中心 13,13）路径，ox/oy 为偏移（画阴影用） */
function plusPath(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  ctx.beginPath()
  ctx.moveTo(8 + ox, oy)
  ctx.lineTo(18 + ox, oy)
  ctx.lineTo(18 + ox, 8 + oy)
  ctx.lineTo(21 + ox, 8 + oy)
  ctx.lineTo(21 + ox, 18 + oy)
  ctx.lineTo(18 + ox, 18 + oy)
  ctx.lineTo(18 + ox, 26 + oy)
  ctx.lineTo(8 + ox, 26 + oy)
  ctx.lineTo(8 + ox, 18 + oy)
  ctx.lineTo(5 + ox, 18 + oy)
  ctx.lineTo(5 + ox, 8 + oy)
  ctx.lineTo(8 + ox, 8 + oy)
  ctx.closePath()
}

function drawCross(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#8c8c8c'
  plusPath(ctx, 3, 3)
  ctx.fill()
  ctx.fillStyle = '#fff'
  plusPath(ctx, 0, 0)
  ctx.fill()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1
  plusPath(ctx, 0, 0)
  ctx.stroke()
}

function drawPolygon(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}

function drawArrow(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  ctx.fillStyle = '#8c8c8c'
  ctx.save()
  ctx.translate(2, 2)
  drawPolygon(ctx, pts)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  drawPolygon(ctx, pts)
  ctx.stroke()
  ctx.fillStyle = '#111'
  drawPolygon(ctx, pts)
  ctx.fill()
}

function drawDownArrow(ctx: CanvasRenderingContext2D): void {
  drawArrow(ctx, [
    [9, 2],
    [15, 2],
    [15, 10],
    [20, 10],
    [12, 21],
    [4, 10],
    [9, 10],
  ])
}

function drawRightArrow(ctx: CanvasRenderingContext2D): void {
  drawArrow(ctx, [
    [2, 9],
    [2, 15],
    [10, 15],
    [10, 20],
    [21, 12],
    [10, 4],
    [10, 9],
  ])
}

function makeCursor(spec: CursorSpec): string {
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return spec.fallback
  spec.draw(ctx)
  const [hx, hy] = spec.hotspot
  return `url(${canvas.toDataURL('image/png')}) ${hx} ${hy}, ${spec.fallback}`
}

/** 把三个指针写入 root 的 CSS 变量（--cursor-cell / --cursor-col / --cursor-row），幂等可重复调用 */
export function applyGridCursors(root: HTMLElement | null): void {
  if (!root) return
  root.style.setProperty(
    '--cursor-cell',
    makeCursor({ width: 30, height: 30, hotspot: [13, 13], draw: drawCross, fallback: 'cell' }),
  )
  root.style.setProperty(
    '--cursor-col',
    makeCursor({ width: 24, height: 24, hotspot: [12, 21], draw: drawDownArrow, fallback: 'default' }),
  )
  root.style.setProperty(
    '--cursor-row',
    makeCursor({ width: 24, height: 24, hotspot: [21, 12], draw: drawRightArrow, fallback: 'default' }),
  )
}
