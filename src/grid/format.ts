import { isStringType } from '../data/types.ts'
import type { FieldDef } from '../data/types.ts'

export type CellView =
  | { kind: 'text'; text: string }
  | { kind: 'notimpl' }
  | { kind: 'blank' }

/**
 * M2 渲染规则：顶层 string 字段直出；其余（number/enum/嵌套 ADT）NotImplemented 占位（G6 裁决）；
 * 缺值空白。0、false、空串是合法值，只有 undefined/null 算缺。
 */
export function formatCell(field: FieldDef, value: unknown): CellView {
  if (value === undefined || value === null) return { kind: 'blank' }
  if (isStringType(field.type)) {
    return { kind: 'text', text: String(value) }
  }
  return { kind: 'notimpl' }
}
