import type { TypeNode } from '../data/types.ts'

interface TypeNodeEditorProps {
  value: TypeNode
  onChange: (n: TypeNode) => void
  /** 可引用的命名类型（enum + 有 pk 的 struct + 自身） */
  names: string[]
  disabled?: boolean
}

function kindKey(node: TypeNode): string {
  if ('raw' in node) return `raw:${node.raw}`
  if ('array' in node) return 'array'
  return 'map'
}

/** 递归级联下拉：一级选 kind（标量/命名类型/array/map），容器类型展开子级编辑器。
 * asKey=true 时仅允许标量与命名引用——array/map 复合节点禁止做 map 键（裁决 2026-10-10）。 */
export function TypeNodeEditor({ value, onChange, names, disabled, asKey = false }: TypeNodeEditorProps & { asKey?: boolean }) {
  const options = [
    { key: 'raw:string', label: 'string' },
    { key: 'raw:number', label: 'number' },
    { key: 'raw:boolean', label: 'boolean' },
    ...names.map(n => ({ key: `raw:${n}`, label: n })),
    ...(asKey ? [] : [
      { key: 'array', label: 'array<…>' },
      { key: 'map', label: 'map<…,…>' },
    ]),
  ]
  return (
    <div className="type-node-editor">
      <select
        value={kindKey(value)}
        disabled={disabled}
        onChange={e => {
          const k = e.target.value
          if (k === 'array') onChange({ array: true, elementType: { raw: 'number' } })
          else if (k === 'map') onChange({ map: true, keyType: { raw: 'string' }, valueType: { raw: 'number' } })
          else onChange({ raw: k.slice('raw:'.length) })
        }}
      >
        {options.map(o => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {'array' in value && (
        <div className="type-node-child">
          <span className="type-node-label">元素</span>
          <TypeNodeEditor
            value={value.elementType}
            onChange={el => onChange({ array: true, elementType: el })}
            names={names}
            disabled={disabled}
          />
        </div>
      )}
      {'map' in value && (
        <div className="type-node-children">
          <div className="type-node-child">
            <span className="type-node-label">键</span>
            <TypeNodeEditor
              value={value.keyType}
              onChange={k => onChange({ map: true, keyType: k, valueType: value.valueType })}
              names={names}
              disabled={disabled}
              asKey
            />
          </div>
          <div className="type-node-child">
            <span className="type-node-label">值</span>
            <TypeNodeEditor
              value={value.valueType}
              onChange={v => onChange({ map: true, keyType: value.keyType, valueType: v })}
              names={names}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  )
}
