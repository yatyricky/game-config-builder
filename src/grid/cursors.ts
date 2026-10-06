/**
 * spec 三态鼠标指针。位图提取自本机 EXCEL.EXE 的 RT_CURSOR 资源（.tmp/parse-cursors.mjs 导出 hex）：
 * - 工作区：Excel 标志性四芒星——三角臂尖 + 中心白菱形，黑描边白填充，热点居中（grpI256，15,15）
 * - 表头：Office 向下箭头，热点在箭尖（grpI340，13,24；原图底部带拖拽虚线框，属其它语义，解码时裁除）
 * - 行头：向下箭头旋转 90° 生成，热点随变换
 * 位图语义：1bpp，XOR 位 0=白 1=黑；AND 位 1=透明；行序自下而上。
 * Chrome 不支持 SVG cursor，统一 canvas → PNG data URI 注入 CSS 变量。
 */

const SIZE = 32

interface CursorBits {
  hotspot: readonly [number, number]
  xor: string
  and: string
}

const STAR: CursorBits = {
  hotspot: [15, 15],
  xor: '000000000000000000000000000180000002400000042000000810000010080000200400003ffc0000c003000140028002400240044182200842421010442208104422080842421004418220024002400140028000c00300003ffc00002004000010080000081000000420000002400000018000000000000000000000000000',
  and: 'fffffffffffffffffffffffffffe7ffffffc3ffffff81ffffff00fffffe007ffffc003ffffc003ffff3ffcfffe3ffc7ffc3ffc3ff83e7c1ff03c3c0fe0381c07e0381c07f03c3c0ff83e7c1ffc3ffc3ffe3ffc7fff3ffcffffc003ffffc003ffffe007fffff00ffffff81ffffffc3ffffffe7fffffffffffffffffffffffffff',
}

const DOWN_ARROW: CursorBits = {
  hotspot: [13, 24],
  xor: '000000000000000000000000000000000000000000000000000000000000000000000000001a0000007b000000ef800000dfc00000bfe000007ff000003ff800001ffc00000ffe000007fe000003fe000001fc000000f80000000000000000000000000000000000000000000000000000000000000000000000000000000',
  and: 'fffffffffffffffffffffffffffffffffffbffffffdb7fffffeeffffffffffffffee7fffffc03fffff001ffffe000ffffe0007fffe0003ffff0001ffff8000ffffc000ffffe000fffff000fffff800fffffc01fffffe03ffffff07ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
}

/** 底部裁除的行数：向下箭头原图最下 8 行是拖拽虚线框 */
const ARROW_STRIP_BOTTOM = 8

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 1bpp 位图 → ImageData；行序自下而上；stripBottom 裁除底部 n 行 */
function bitsToImageData(ctx: CanvasRenderingContext2D, bits: CursorBits, stripBottom = 0): ImageData {
  const xor = hexToBytes(bits.xor)
  const and = hexToBytes(bits.and)
  const img = ctx.createImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) {
    const srcRow = SIZE - 1 - y
    if (srcRow < stripBottom) continue
    for (let x = 0; x < SIZE; x++) {
      const byte = (x / 8) | 0
      const mask = 7 - (x % 8)
      const xorBit = (xor[srcRow * 4 + byte] >> mask) & 1
      const andBit = (and[srcRow * 4 + byte] >> mask) & 1
      const i = (y * SIZE + x) * 4
      if (andBit) continue // 透明
      const v = xorBit ? 0 : 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  return img
}

/** 旋转 90° 使箭尖朝右：(x,y) → (y, SIZE-1-x)，热点 (hx,hy) → (hy, SIZE-1-hx) */
function rotateToRight(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  hotspot: readonly [number, number],
): { data: ImageData; hotspot: readonly [number, number] } {
  const out = ctx.createImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const src = (y * SIZE + x) * 4
      const dst = (x * SIZE + (SIZE - 1 - y)) * 4
      out.data[dst] = img.data[src]
      out.data[dst + 1] = img.data[src + 1]
      out.data[dst + 2] = img.data[src + 2]
      out.data[dst + 3] = img.data[src + 3]
    }
  }
  return { data: out, hotspot: [hotspot[1], SIZE - 1 - hotspot[0]] as const }
}

function makeCursor(
  draw: (ctx: CanvasRenderingContext2D) => { data: ImageData; hotspot: readonly [number, number] },
  fallback: string,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return fallback
  const { data, hotspot } = draw(ctx)
  ctx.putImageData(data, 0, 0)
  return `url(${canvas.toDataURL('image/png')}) ${hotspot[0]} ${hotspot[1]}, ${fallback}`
}

/** 把三个指针写入 root 的 CSS 变量（--cursor-cell / --cursor-col / --cursor-row），幂等可重复调用 */
export function applyGridCursors(root: HTMLElement | null): void {
  if (!root) return
  root.style.setProperty(
    '--cursor-cell',
    makeCursor(ctx => ({ data: bitsToImageData(ctx, STAR), hotspot: STAR.hotspot }), 'cell'),
  )
  root.style.setProperty(
    '--cursor-col',
    makeCursor(ctx => ({ data: bitsToImageData(ctx, DOWN_ARROW, ARROW_STRIP_BOTTOM), hotspot: DOWN_ARROW.hotspot }), 'default'),
  )
  root.style.setProperty(
    '--cursor-row',
    makeCursor(ctx => rotateToRight(ctx, bitsToImageData(ctx, DOWN_ARROW, ARROW_STRIP_BOTTOM), DOWN_ARROW.hotspot), 'default'),
  )
}
