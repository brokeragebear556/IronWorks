import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A toolbar button that opens a small panel of less-used controls. Closes on Esc or a click outside. */
export function HudMenu({ label, children, active }: { label: string; children: ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="hud-menu" ref={ref}>
      <button type="button" className="btn" aria-haspopup="true" aria-expanded={open} aria-pressed={!!active} onClick={() => setOpen(!open)}>{label} ▾</button>
      {open && <div className="hud-panel">{children}</div>}
    </div>
  )
}

/** A titled group of controls inside a HudMenu. */
export const HudGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="hud-group"><span className="hud-group-title">{title}</span><div className="hud-group-body">{children}</div></div>
)
