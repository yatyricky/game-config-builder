import { useEffect, useRef, useState } from 'react'
import type { FieldDef, Project, StructDef, TypeNode } from '../data/types.ts'
import {
  canDeleteField,
  canEditFieldType,
  nextFieldName,
  pkLockState,
  validateFieldName,
} from '../data/schemaEdit.ts'
import type { FieldPatch } from '../data/schemaEdit.ts'
import { TypeNodeEditor } from './TypeNodeEditor.tsx'

interface FieldEditModalProps {
  def: StructDef
  /** null = 新增字段 */
  field: FieldDef | null
  project: Project
  onSave: (patch: FieldPatch, originalName: string | null) => void
  onDelete: (fieldName: string) => void
  onClose: () => void
}

/** 可引用的命名类型：enum + 有 pk 的 struct + 自身（pk-less struct 不可被引用） */
function selectableNames(project: Project, selfName: string): string[] {
  const out: string[] = []
  for (const [name, def] of project.types) {
    if (def.kind === 'enum') out.push(name)
    else if (name === selfName || def.fields.some(f => f.pk)) out.push(name)
  }
  return out
}

/** 字段编辑弹窗（M8b-1 裁决 2026-10-10）：名称/displayName/default（仅基础类型）/类型树级联/pk/index/unique/nullable/group；底部删除+保存 */
export function FieldEditModal({ def, field, project, onSave, onDelete, onClose }: FieldEditModalProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const originalName = field?.name ?? null
  const rows = project.tables.find(t => t.name === def.name)?.rows ?? []

  const [name, setName] = useState(() => (field ? field.name : nextFieldName(def)))
  const [displayName, setDisplayName] = useState(() => field?.displayName ?? '')
  const [type, setType] = useState<TypeNode>(() => field?.type ?? { raw: 'string' })
  const [pk, setPk] = useState(() => field?.pk === true)
  const [index, setIndex] = useState(() => field?.index === true)
  const [unique, setUnique] = useState(() => field?.unique === true)
  const [nullable, setNullable] = useState(() => field?.nullable === true)
  const [group, setGroup] = useState(() => field?.group === true)
  const [hasDefault, setHasDefault] = useState(() => field?.default !== undefined)
  const [defaultStr, setDefaultStr] = useState(() => (typeof field?.default === 'string' ? field.default : ''))
  const [defaultBool, setDefaultBool] = useState(() => field?.default === true)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const isScalar = 'raw' in type && (type.raw === 'string' || type.raw === 'number' || type.raw === 'boolean')
  const scalarKind = isScalar && 'raw' in type ? type.raw : null

  // 校验
  const usedLocked = originalName !== null && !canEditFieldType(rows, originalName)
  const nameError = validateFieldName(name, def, originalName) ?? (name !== originalName && rows.some(r => r[name] !== undefined) ? `「${name}」已存在于表格数据中，改名会导致合并污染` : null)
  const typeLocked = usedLocked
  const pseudo: FieldDef = { name, type }
  const pkLock = pkLockState(def, pseudo, project)
  // 已是 pk 的字段：锁定即不可取消；非 pk 字段：锁定即不可勾选（同一 disabled 语义）
  const pkCheckboxDisabled = pkLock.locked
  const indexChecked = pk || index
  const indexDisabled = pk
  const uniqueChecked = indexChecked || unique
  const uniqueDisabled = indexChecked
  const lockReasons: string[] = []
  if (usedLocked) {
    lockReasons.push('字段已被表格数据使用：名称与类型锁定，删除不可用（先清空该列数据可解锁）')
  } else if (pkLock.locked && pkLock.reason) {
    lockReasons.push(pkLock.reason)
  }

  let defaultError: string | null = null
  if (hasDefault && scalarKind === 'number' && (defaultStr.trim() === '' || !Number.isFinite(Number(defaultStr)))) {
    defaultError = 'number 默认值必须填写且为数字'
  }
  const saveBlocked = nameError !== null || defaultError !== null

  const buildPatch = (): FieldPatch => ({
    name: name.trim(),
    displayName,
    type,
    pk,
    index,
    unique,
    nullable,
    group,
    hasDefault: hasDefault && isScalar,
    default:
      hasDefault && isScalar
        ? scalarKind === 'string'
          ? defaultStr.trim()
          : scalarKind === 'number'
            ? Number(defaultStr)
            : defaultBool
        : undefined,
  })

  return (
    <div className="modal-backdrop field-layer">
      <div className="form-modal wide" role="dialog" aria-label="编辑字段">
        <header className="form-modal-head">
          <span>{originalName === null ? `新增字段 · ${def.name}` : `编辑字段 · ${def.name}.${originalName}`}</span>
          <button className="form-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="form-modal-body">
          <label className="form-row">
            <span className="form-label">字段名称</span>
            <input
              ref={nameRef}
              className={nameError ? 'invalid' : ''}
              value={name}
              disabled={usedLocked}
              title={usedLocked ? '字段已被表格数据使用，名称不可修改' : undefined}
              onChange={e => setName(e.target.value)}
            />
            {nameError && <em className="form-error">{nameError}</em>}
          </label>
          <label className="form-row">
            <span className="form-label">displayName</span>
            <input value={displayName} placeholder="可选，仅显示在表格表头" onChange={e => setDisplayName(e.target.value)} />
          </label>
          <div className="form-row">
            <span className="form-label">类型</span>
            <div className="form-control">
              <TypeNodeEditor
                value={type}
                onChange={setType}
                names={selectableNames(project, def.name)}
                disabled={typeLocked}
              />

            </div>
          </div>
          <div className="form-row">
            <span className="form-label">default</span>
            <div className="form-control">
              {isScalar ? (
                <>
                  <label className="check">
                    <input type="checkbox" checked={hasDefault} onChange={e => setHasDefault(e.target.checked)} /> 使用默认值
                  </label>
                  {hasDefault && scalarKind === 'string' && (
                    <input value={defaultStr} placeholder="留空 = 空字符串（永 trim）" onChange={e => setDefaultStr(e.target.value)} />
                  )}
                  {hasDefault && scalarKind === 'number' && (
                    <>
                      <input className={defaultError ? 'invalid' : ''} value={defaultStr} placeholder="必填数字" onChange={e => setDefaultStr(e.target.value)} />
                      {defaultError && <em className="form-error">{defaultError}</em>}
                    </>
                  )}
                  {hasDefault && scalarKind === 'boolean' && (
                    <select value={defaultBool ? 'true' : 'false'} onChange={e => setDefaultBool(e.target.value === 'true')}>
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  )}
                </>
              ) : (
                <em className="form-hint">仅基础类型可设默认值；array/map 隐式 [] / {'{}'}，命名类型引用无默认</em>
              )}
            </div>
          </div>
          <div className="form-row">
            <span className="form-label">约束</span>
            <div className="form-control check-group">
              <label className="check" title={pkLock.reason ?? undefined}>
                <input type="checkbox" checked={pk} disabled={pkCheckboxDisabled} onChange={e => setPk(e.target.checked)} /> pk
              </label>
              <label className="check" title={pk ? 'pk 字段强制 index' : undefined}>
                <input type="checkbox" checked={indexChecked} disabled={indexDisabled} onChange={e => setIndex(e.target.checked)} /> index
              </label>
              <label className="check" title={indexChecked ? 'index 字段强制 unique' : undefined}>
                <input type="checkbox" checked={uniqueChecked} disabled={uniqueDisabled} onChange={e => setUnique(e.target.checked)} /> unique
              </label>
              <label className="check">
                <input type="checkbox" checked={nullable} onChange={e => setNullable(e.target.checked)} /> null（允许不填）
              </label>
              <label className="check">
                <input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} /> group
              </label>
            </div>
          </div>
        </div>
        {lockReasons.length > 0 && (
          <div className="form-lock-bar">
            {lockReasons.map(r => (
              <div key={r}>{r}</div>
            ))}
          </div>
        )}
        <footer className="form-modal-foot">
          {originalName !== null && (
            <button
              className="danger"
              disabled={!canDeleteField(rows, originalName)}
              title={canDeleteField(rows, originalName) ? undefined : '字段已被表格数据使用，无法删除'}
              onClick={() => onDelete(originalName)}
            >
              删除
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={saveBlocked} onClick={() => onSave(buildPatch(), originalName)}>
            保存
          </button>
        </footer>
      </div>
    </div>
  )
}
