import { useEffect, useRef } from 'react'
import { typeNodeLabel } from '../data/types.ts'
import type { Project } from '../data/types.ts'

interface SettingsModalProps {
  project: Project
  onClose: () => void
}

/**
 * 设置 modal（裁决 2026-10-09）：不占工作表逻辑，弹出几乎占满工作表区的覆盖层。
 * M8a 为只读卡片渲染（一类型一卡片）；编辑与显式保存属 M8b。
 * Esc / × / Ctrl+, 关闭；打开时焦点移入 modal，网格键盘随之失效。
 */
export function SettingsModal({ project, onClose }: SettingsModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="设置">
        <header className="settings-header">
          <span className="settings-title">设置</span>
          <span className="settings-sub">类型定义（只读预览——编辑属下一期）</span>
          <button ref={closeRef} className="settings-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="settings-body">
          {[...project.types.values()].map(t => (
            <section key={t.name} className="settings-card">
              <header className="card-head">
                <span className="card-name">{t.name}</span>
                <span className="card-kind">
                  {t.kind === 'enum' ? 'enum' : 'struct'}
                  {t.kind === 'enum' && t.flags ? ' · flags' : ''}
                </span>
              </header>
              {t.kind === 'enum' ? (
                <div className="card-enum">
                  {t.members.map(m => (
                    <span key={m.name} className="enum-member">
                      {m.name} <em>= {m.value}</em>
                    </span>
                  ))}
                </div>
              ) : (
                <table className="card-fields">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>类型</th>
                      <th>属性</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.fields.map(f => (
                      <tr key={f.name}>
                        <td>{f.displayName ? `${f.displayName} (${f.name})` : f.name}</td>
                        <td className="type-label">{typeNodeLabel(f.type)}</td>
                        <td className="field-attrs">
                          {f.pk && <span className="attr">pk</span>}
                          {f.default !== undefined && <span className="attr">default={JSON.stringify(f.default)}</span>}
                          {f.displayName && <span className="attr">alias</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
