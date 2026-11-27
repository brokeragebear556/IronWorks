import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { money, specLabel } from '../lib/format'
import type { RefreshResult } from '../types'

/** Re-runs the metadata providers and saves the latest price plus any missing specs.
 *  With no itemKey it refreshes the whole library. */
export function RefreshButton({ itemKey, label = 'Refresh metadata', className = 'btn' }: { itemKey?: string; label?: string; className?: string }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<RefreshResult[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setErr(null); setResults(null)
    try {
      const r = await api.refresh(itemKey)
      setResults(r)
      await Promise.all([qc.invalidateQueries({ queryKey: ['library'] }), qc.invalidateQueries({ queryKey: ['identify-history'] })])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const changed = (results ?? []).filter((r) => r.specsAdded.length || (r.price != null && r.price !== r.oldPrice))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row-actions">
        <button type="button" className={className} onClick={run} disabled={busy}
          title="Saves the latest price and fills in specs that are missing. Your own values are kept.">{busy ? 'Refreshing…' : label}</button>
        {results && <span className="note">{summary(results, !itemKey)}</span>}
      </div>
      {err && <p className="error">{err}</p>}
      {results && (itemKey ? results : changed).map((r) => (
        <div key={r.key} className="note">
          {!itemKey && <b style={{ color: 'var(--ink)' }}>{r.name}: </b>}
          {r.price != null && (r.price !== r.oldPrice ? <>price {r.oldPrice != null ? `${money(r.oldPrice)} → ` : ''}{money(r.price)}. </> : <>price unchanged at {money(r.price)}. </>)}
          {r.specsAdded.length > 0 && <>added {r.specsAdded.map(specLabel).join(', ')}.</>}
          {itemKey && r.sources === 0 && <>No provider found anything. Link a product page or save one into the scan folder.</>}
        </div>
      ))}
      {results?.some((r) => r.errors.length) && (
        <details className="note"><summary>{results.reduce((s, r) => s + r.errors.length, 0)} source(s) couldn't be read</summary>
          {results.flatMap((r) => r.errors.map((e, i) => <div key={r.key + i}>{r.name}: {e}</div>))}
        </details>
      )}
    </div>
  )
}

function summary(rs: RefreshResult[], all: boolean) {
  const prices = rs.filter((r) => r.price != null && r.price !== r.oldPrice).length
  const specs = rs.reduce((s, r) => s + r.specsAdded.length, 0)
  if (!all) return prices || specs ? 'Saved.' : 'Up to date.'
  return `Checked ${rs.length} items: ${prices} price${prices === 1 ? '' : 's'} updated, ${specs} spec${specs === 1 ? '' : 's'} added.`
}
