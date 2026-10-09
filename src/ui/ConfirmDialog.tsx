import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
}

/** 二次确认弹窗（最顶层）：Esc=取消；Esc 栈由 App 统一分发，本组件不监听 */
export function ConfirmDialog({ title, message, confirmText = '确认', onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
  }, [])
  return (
    <div className="modal-backdrop confirm-layer" onClick={onCancel}>
      <div className="form-modal" onClick={e => e.stopPropagation()} role="alertdialog" aria-label={title}>
        <header className="form-modal-head">
          <span>{title}</span>
        </header>
        <div className="form-modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <footer className="form-modal-foot">
          <button onClick={onCancel}>取消</button>
          <button ref={confirmRef} className="primary" onClick={onConfirm}>
            {confirmText}
          </button>
        </footer>
      </div>
    </div>
  )
}
