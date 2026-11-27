import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api, useLibrary } from '../api'

const FIELD_NAMES: Record<string, string> = { build: 'build', cfg: 'model settings', attachments: 'attachments', records: 'records', checks: 'notes', price: 'price', status: 'status', components: 'price', short: 'description', name: 'name', specs: 'specs', cleanEvery: 'cleaning interval', caliber: 'caliber', twist: 'twist', coverPhoto: 'card photo', notes: 'notes' }

/** Undo the last change to a gun or part file (Ctrl+Z). Every change keeps the previous file in guns/_history. */
export function UndoButton() {
  const qc = useQueryClient()
  const { dataUpdatedAt } = useLibrary()
  const { data } = useQuery({ queryKey: ['history', dataUpdatedAt], queryFn: api.lastChange })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const c = data?.change
  const what = c ? `${[...new Set(c.fields.map((f) => FIELD_NAMES[f] ?? f))].slice(0, 3).join(', ') || 'a change'}${c.part ? ' (part)' : ''} on ${c.gunName}` : ''

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.undo()
      setMsg(`Undone: ${r.gunName}`)
      await Promise.all(['library', 'analytics', 'history'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [busy, qc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); run() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t) }, [msg])

  return (
    <span className="row-actions" style={{ gap: 8 }}>
      {msg && <span className="note" role="status">{msg}</span>}
      <button type="button" className="btn" disabled={!c || busy} onClick={run} title={c ? `Undo ${what} (Ctrl+Z)` : 'Nothing to undo'}>Undo</button>
    </span>
  )
}
