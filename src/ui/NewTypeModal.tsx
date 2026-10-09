import { useEffect, useRef, useState } from 'react'
import type { TypeDef } from '../data/types.ts'
import { validateTypeName } from '../data/schemaEdit.ts'

interface NewTypeModalProps {
  types: Map<string, TypeDef>
  /** 用户点确定后由 App 弹二次确认再创建 */
  onSubmit: (name: string, kind: 'struct' | 'enum', flags: boolean) => void
  onClose: () => void
}

/** 新建类型：名称 + struct/enum 下拉（默认 struct）+ enum→flags checkbox；重名/冲突/空 → 红框 */
export function NewTypeModal({ types, onSubmit, onClose }: NewTypeModalProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'struct' | 'enum'>('struct')
  const [flags, setFlags] = useState(false)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const nameError = validateTypeName(name, types)

  return (
    <div className="modal-backdrop field-layer">
      <div className="form-modal" role="dialog" aria-label="新建类型">
        <header className="form-modal-head">
          <span>新建类型</span>
          <button className="form-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="form-modal-body">
          <label className="form-row">
            <span className="form-label">名称</span>
            <input ref={nameRef} className={name !== '' && nameError ? 'invalid' : ''} value={name} onChange={e => setName(e.target.value)} />
            {name !== '' && nameError && <em className="form-error">{nameError}</em>}
          </label>
          <div className="form-row">
            <span className="form-label">类型</span>
            <select value={kind} onChange={e => setKind(e.target.value === 'enum' ? 'enum' : 'struct')}>
              <option value="struct">struct</option>
              <option value="enum">enum</option>
            </select>
          </div>
          {kind === 'enum' && (
            <div className="form-row">
              <span className="form-label">flags</span>
              <label className="check">
                <input type="checkbox" checked={flags} onChange={e => setFlags(e.target.checked)} /> 位标志枚举
              </label>
            </div>
          )}
        </div>
        <footer className="form-modal-foot">
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={nameError !== null} onClick={() => onSubmit(name, kind, flags)}>
            确定
          </button>
        </footer>
      </div>
    </div>
  )
}
