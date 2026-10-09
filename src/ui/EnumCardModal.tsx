import { useEffect, useRef, useState } from 'react'
import type { EnumDef } from '../data/types.ts'
import { isPowersOfTwo } from '../data/schemaEdit.ts'

interface EnumCardModalProps {
  def: EnumDef
  isUsed: boolean
  onSave: (patch: { name: string; flags: boolean }) => void
  onClose: () => void
}

/** 枚举卡片编辑（写字图标）：名称（无引用可改）；flags（被使用且值非 2^n 序列时不可勾选，其他自由切换） */
export function EnumCardModal({ def, isUsed, onSave, onClose }: EnumCardModalProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(def.name)
  const [flags, setFlags] = useState(def.flags)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const cannotCheckFlags = isUsed && !isPowersOfTwo(def.members)
  const flagsDisabled = cannotCheckFlags && !def.flags

  return (
    <div className="modal-backdrop field-layer">
      <div className="form-modal" role="dialog" aria-label="编辑枚举卡片">
        <header className="form-modal-head">
          <span>编辑卡片 · {def.name}</span>
          <button className="form-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="form-modal-body">
          <label className="form-row">
            <span className="form-label">名称</span>
            <input
              ref={nameRef}
              value={name}
              disabled={isUsed}
              title={isUsed ? '已被其他类型引用，名称不可修改' : undefined}
              onChange={e => setName(e.target.value)}
            />
          </label>
          <div className="form-row">
            <span className="form-label">flags</span>
            <label className="check" title={flagsDisabled ? '已被使用且值非 2 的幂序列，无法勾选 flags' : undefined}>
              <input type="checkbox" checked={flags} disabled={flagsDisabled} onChange={e => setFlags(e.target.checked)} /> 位标志枚举
            </label>
          </div>
        </div>
        {isUsed && <div className="form-lock-bar">已被其他类型引用，名称不可修改</div>}
        <footer className="form-modal-foot">
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={isUsed ? false : name.trim() === '' || name.trim() !== name} onClick={() => onSave({ name: name.trim(), flags })}>
            保存
          </button>
        </footer>
      </div>
    </div>
  )
}
