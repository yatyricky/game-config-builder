import { useEffect, useState } from 'react'

/** 按住 Ctrl（松开/窗口失焦即复位） */
export function useCtrlHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setHeld(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setHeld(false)
    }
    const blur = (): void => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return held
}
