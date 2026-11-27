import { useEffect, useState, type ReactNode } from 'react'

/** Two-step button for actions that move or delete things: first click arms it. */
export function ConfirmButton({ children, confirm, onConfirm, className = 'btn danger', disabled }: {
  children: ReactNode
  confirm: ReactNode
  onConfirm: () => void | Promise<unknown>
  className?: string
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(t)
  }, [armed])
  if (!armed) return <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>{children}</button>
  return (
    <span className="row-actions">
      <button type="button" className={className} disabled={busy} onClick={async () => {
        setBusy(true)
        try { await onConfirm() } finally { setBusy(false); setArmed(false) }
      }}>{confirm}</button>
      <button type="button" className="btn ghost" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  )
}
