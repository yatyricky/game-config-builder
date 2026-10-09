import { useEffect, useRef, useState } from 'react'
import type { EnumDef, EnumMember, Project } from '../data/types.ts'
import { ENUM_MAX_FLAGS_MEMBERS, memberValueUsed, nextEnumValue, validateMemberDisplayName, validateMemberName, validateMemberValue } from '../data/schemaEdit.ts'
import type { MemberPatch } from '../data/schemaEdit.ts'

interface EnumMemberModalProps {
  def: EnumDef
  /** null = 新增成员 */
  member: EnumMember | null
  project: Project
  onSave: (patch: MemberPatch, originalName: string | null) => void
  onDelete: (memberName: string) => void
  onClose: () => void
}

/** 枚举成员弹窗：name/displayName/value 三重唯一（裁决 2026-10-10）；flags 值自动前值×2 不可改；新增受 30 上限约束 */
export function EnumMemberModal({ def, member, project, onSave, onDelete, onClose }: EnumMemberModalProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const originalName = member?.name ?? null
  const [name, setName] = useState(() => member?.name ?? '')
  const [displayName, setDisplayName] = useState(() => member?.displayName ?? '')
  const [valueStr, setValueStr] = useState(() =>
    member ? String(member.value) : String(nextEnumValue(def.members, def.flags)),
  )

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const valueDisabled = def.flags && originalName === null
  const limitBlocked = def.flags && originalName === null && def.members.length >= ENUM_MAX_FLAGS_MEMBERS

  const nameError = validateMemberName(name, def, originalName)
  const displayNameError = validateMemberDisplayName(displayName, def, originalName)
  const valueError = limitBlocked
    ? `flags 枚举成员已达 ${ENUM_MAX_FLAGS_MEMBERS} 上限，无法新增`
    : validateMemberValue(valueStr, def, originalName)
  const saveBlocked = nameError !== null || displayNameError !== null || valueError !== null

  const memberUsed = member !== null && memberValueUsed(project, def.name, member.value)

  return (
    <div className="modal-backdrop field-layer">
      <div className="form-modal" role="dialog" aria-label="编辑枚举成员">
        <header className="form-modal-head">
          <span>{originalName === null ? `新增成员 · ${def.name}` : `编辑成员 · ${def.name}.${originalName}`}</span>
          <button className="form-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="form-modal-body">
          <label className="form-row">
            <span className="form-label">名称</span>
            <input ref={nameRef} className={nameError ? 'invalid' : ''} value={name} onChange={e => setName(e.target.value)} />
            {nameError && <em className="form-error">{nameError}</em>}
          </label>
          <label className="form-row">
            <span className="form-label">displayName</span>
            <input
              className={displayNameError ? 'invalid' : ''}
              value={displayName}
              placeholder="可选"
              onChange={e => setDisplayName(e.target.value)}
            />
            {displayNameError && <em className="form-error">{displayNameError}</em>}
          </label>
          <label className="form-row">
            <span className="form-label">值</span>
            <input
              className={valueError ? 'invalid' : ''}
              value={valueStr}
              disabled={valueDisabled}
              onChange={e => setValueStr(e.target.value)}
            />
            {def.flags && originalName === null && <em className="form-hint">flags 模式：值自动 = 前值 × 2（首成员 = 1）</em>}
            {valueError && <em className="form-error">{valueError}</em>}
          </label>
        </div>
        <footer className="form-modal-foot">
          {originalName !== null && (
            <button
              className="danger"
              disabled={memberUsed}
              title={memberUsed ? '成员值已被表格数据使用，无法删除' : undefined}
              onClick={() => onDelete(originalName)}
            >
              删除
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={saveBlocked}
            onClick={() => onSave({ name: name.trim(), displayName: displayName.trim(), value: Number(valueStr) }, originalName)}
          >
            保存
          </button>
        </footer>
      </div>
    </div>
  )
}
