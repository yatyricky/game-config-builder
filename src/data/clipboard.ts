import type { FieldDef, StructDef, TableRow } from './types.ts'

export interface ClipboardCell {
  type: string
  value: unknown
}

export type ClipboardContent = ClipboardCell[][]

export interface SelectionBounds {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}

/** spec：隐式转换表；未注册的跨类型路径在粘贴时报错并阻断 */
const conversions = new Map<string, (v: unknown) => unknown>()

const conversionKey = (from: string, to: string): string => `${from}→${to}`

export function defineImplicitConversion(from: string, to: string, fn: (v: unknown) => unknown): void {
  conversions.set(conversionKey(from, to), fn)
}

// spec 示例种子：number→string 已定义；string→number 未定义（粘贴报错阻断）
defineImplicitConversion('number', 'string', v => String(v))

/** 字段的数据类型标签：标量用 type；map/array 用组合标签（同标签恒等粘贴） */
export function fieldTypeOf(f: FieldDef): string {
  if (f.map) return `map<${f.keyType ?? ''},${f.valueType ?? ''}>`
  if (f.array) return `array<${f.elementType ?? ''}>`
  return f.type
}

/** ctrl+c：选中区（矩阵或单格）的值快照；缺值单元格 value 为 undefined */
export function buildClipboard(rows: readonly TableRow[], def: StructDef, bounds: SelectionBounds): ClipboardContent {
  const out: ClipboardContent = []
  for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
    const line: ClipboardCell[] = []
    for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
      const f = def.fields[c]
      line.push({ type: fieldTypeOf(f), value: rows[r]?.[f.name] })
    }
    out.push(line)
  }
  return out
}

export interface PasteWrite {
  row: number
  fieldName: string
  value: unknown
}

export type PastePlan = { status: 'ok'; writes: PasteWrite[] } | { status: 'error'; message: string }

/**
 * ctrl+v 规划写入（纯函数，裁决 2026-10-08）：
 * - 目标 1x1：完整剪切板从该格起贴一次（越工作区裁剪）
 * - 目标 >1x1：须容纳剪切板（宽高均 ≥），否则报错阻断；容纳时以完整瓦片 tiling 填充（不足一整块的边缘不动）
 * - 单元格：值 undefined 原样写（清空）；同类型恒等；跨类型查转换表，未注册报错并整体阻断
 */
export function planPaste(
  clipboard: ClipboardContent,
  target: SelectionBounds,
  def: StructDef,
  rowCount: number,
  colCount: number,
): PastePlan {
  const clipH = clipboard.length
  const clipW = clipboard[0]?.length ?? 0
  if (clipH === 0 || clipW === 0) return { status: 'error', message: '剪切板为空' }

  const single = target.rowStart === target.rowEnd && target.colStart === target.colEnd
  const targetW = target.colEnd - target.colStart + 1
  const targetH = target.rowEnd - target.rowStart + 1
  let tilesX = 1
  let tilesY = 1
  if (!single) {
    if (targetW < clipW || targetH < clipH) {
      return { status: 'error', message: `目标选区 ${targetW}×${targetH} 无法容纳剪切板 ${clipW}×${clipH}，粘贴已阻断` }
    }
    tilesX = Math.floor(targetW / clipW)
    tilesY = Math.floor(targetH / clipH)
  }

  const writes: PasteWrite[] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      for (let y = 0; y < clipH; y++) {
        for (let x = 0; x < clipW; x++) {
          const row = target.rowStart + ty * clipH + y
          const col = target.colStart + tx * clipW + x
          if (row >= rowCount || col >= colCount) continue
          const cell = clipboard[y][x]
          const field = def.fields[col]
          const toType = fieldTypeOf(field)
          let value: unknown
          if (cell.value === undefined) {
            value = undefined
          } else if (cell.type === toType) {
            value = cell.value
          } else {
            const fn = conversions.get(conversionKey(cell.type, toType))
            if (!fn) return { status: 'error', message: `${cell.type} → ${toType} 未定义隐式转换，粘贴已阻断` }
            value = fn(cell.value)
          }
          writes.push({ row, fieldName: field.name, value })
        }
      }
    }
  }
  return { status: 'ok', writes }
}
