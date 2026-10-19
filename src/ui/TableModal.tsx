import { useEffect, useMemo, useRef, useState } from 'react'
import type { StructDef, TypeDef } from '../data/types.ts'
import { nextTableName, validateTableName } from '../data/schemaEdit.ts'

interface TableModalProps {
  mode: 'create' | 'edit'
  types: Map<string, TypeDef>
  /** 现有全部表格文件名（重名校验；改名排除自身由调用方处理——本组件只读它做唯一性检查前的排除） */
  tableNames: readonly string[]
  /** edit 模式必传：当前表名与其类型（schema 锁定） */
  initial?: { name: string; type: string }
  onSubmit: (name: string, type: string) => void
  /** 仅 edit 模式传入；App 层负责二次确认 */
  onDelete?: () => void
  onClose: () => void
}

/** 新建/编辑表格（用户裁决 2026-10-16）：create 选 struct 类型 + 文件名（默认类型名，重名自增 Effect2…）；
 * edit 的 schema 锁定，仅可改表名与删除。 */
export function TableModal({ mode, types, tableNames, initial, onSubmit, onDelete, onClose }: TableModalProps) {
  const structTypes = useMemo(
    () =>
      [...types.values()]
        .filter((t): t is StructDef => t.kind === 'struct')
        .map(t => t.name)
        .sort((a, b) => a.localeCompare(b)),
    [types],
  )
  const defaultType = initial?.type ?? structTypes[0] ?? ''
  const [type, setType] = useState(defaultType)
  const [name, setName] = useState(initial?.name ?? nextTableName(defaultType, tableNames))
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const nameError = validateTableName(name, type, tableNames, types)

  return (
    <div className="modal-backdrop field-layer">
      <div className="form-modal" role="dialog" aria-label={mode === 'create' ? '新建表格' : '编辑表格'}>
        <header className="form-modal-head">
          <span>{mode === 'create' ? '新建表格' : '编辑表格'}</span>
          <button className="form-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="form-modal-body">
          <div className="form-row">
            <span className="form-label">类型</span>
            <div className="form-control">
              {mode === 'create' ? (
                <select
                  value={type}
                  onChange={e => {
                    setType(e.target.value)
                    setName(nextTableName(e.target.value, tableNames))
                  }}
                >
                  {structTypes.map(t => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="form-hint">{type}（schema 锁定）</span>
              )}
            </div>
          </div>
          <label className="form-row">
            <span className="form-label">表格文件名</span>
            <div className="form-control">
              <input
                ref={nameRef}
                className={name !== '' && nameError ? 'invalid' : ''}
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {name !== '' && nameError && <em className="form-error">{nameError}</em>}
            </div>
          </label>
        </div>
        <footer className="form-modal-foot">
          {mode === 'edit' && onDelete && (
            <button className="danger" onClick={onDelete}>
              删除表格
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={nameError !== null}
            onClick={() => onSubmit(name, type)}
          >
            确定
          </button>
        </footer>
      </div>
    </div>
  )
}
