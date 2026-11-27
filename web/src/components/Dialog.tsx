import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'

interface Props {
  open: boolean
  title: string
  note?: ReactNode
  submitLabel: string
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
  wide?: boolean
}

/** A modal form built on the native <dialog> element (focus trap, Esc to close). */
export function Dialog({ open, title, note, submitLabel, busy, error, onClose, onSubmit, children, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const submit = (e: FormEvent) => { e.preventDefault(); if (!busy) onSubmit() }
  return (
    <dialog ref={ref} className={'dlg' + (wide ? ' wide' : '')} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose() }}>
      {open && (
        <form onSubmit={submit} noValidate>
          <h2>{title}</h2>
          {note && <p className="note">{note}</p>}
          {children}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Working…' : submitLabel}</button>
          </div>
        </form>
      )}
    </dialog>
  )
}
