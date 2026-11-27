import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { money } from '../lib/format'
import type { Gun, PriceLine, Status } from '../types'

const KIND: Record<PriceLine['kind'], string> = { base: 'Gun', component: 'Built from', part: 'Part', upgrade: 'Added part', attachment: 'Attachment' }

/** Everything that makes up a gun's price, with owned / planned status on every line.
 *  Prices typed here override the list price found by Refresh metadata. */
export function PricingCard({ gun, onlyLine }: { gun: Gun; onlyLine?: { kind: PriceLine['kind']; id: string } }) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const p = gun.pricing
  const lines = onlyLine ? p.lines.filter((l) => l.kind === onlyLine.kind && l.id === onlyLine.id) : p.lines

  const save = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true)
    try { await fn(); await Promise.all([qc.invalidateQueries({ queryKey: ['library'] }), qc.invalidateQueries({ queryKey: ['analytics'] })]) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const update = (l: PriceLine, change: { price?: number | null; status?: Status }) => save(async () => {
    if (l.kind === 'base') {
      if ('status' in change) await setGunStatus(change.status!)
      if ('price' in change) await api.patchGun(gun.id, { price: change.price })
    } else if (l.kind === 'component') {
      const comps = (gun.components ?? []).map((c, i) => (String(i) === l.id ? { ...c, ...change } : c))
      await api.patchGun(gun.id, { components: comps })
    } else if (l.kind === 'part') {
      await api.patchPart(gun.id, l.id, change)
    } else if (l.kind === 'upgrade') {
      const build = (gun.build ?? []).map((r) => (r.slot === l.id ? { ...r, ...change } : r))
      await api.patchGun(gun.id, { build })
    } else {
      await api.patchAttachment(gun.id, l.id, change)
    }
  })

  const setGunStatus = async (s: Status) => {
    const changes: Partial<Gun> = { status: s }
    if (gun.components?.length) changes.components = gun.components.map((c) => ({ ...c, status: s }))
    await api.patchGun(gun.id, changes)
  }

  return (
    <div>
      {!onlyLine && (
        <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <label className="field" style={{ minWidth: 200 }}>This gun is
            <select className="input" value={p.status} disabled={busy} onChange={(e) => save(() => setGunStatus(e.target.value as Status))}>
              <option value="owned">Owned</option><option value="planned">Planned to buy</option>
            </select>
          </label>
          <div style={{ textAlign: 'right' }}>
            <div className="mono num" style={{ fontSize: 20, fontWeight: 600 }}>{money(p.total)}</div>
            <div className="note">{money(p.owned)} owned{p.planned ? ` · ${money(p.planned)} planned` : ''}</div>
          </div>
        </div>
      )}
      <div className="rows">
        {lines.map((l) => <PriceRow key={l.kind + l.id} line={l} busy={busy} onChange={(c) => update(l, c)} />)}
      </div>
      {!onlyLine && p.missing > 0 && <p className="note" style={{ marginTop: 6 }}>{p.missing} item{p.missing > 1 ? 's have' : ' has'} no price yet, so the total is low. Type a price or use Refresh metadata.</p>}
      {err && <p className="error" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  )
}

function PriceRow({ line, busy, onChange }: { line: PriceLine; busy: boolean; onChange: (c: { price?: number | null; status?: Status }) => void }) {
  const [text, setText] = useState(line.priceSource === 'set' && line.price != null ? String(line.price) : '')
  const [bad, setBad] = useState(false)
  useEffect(() => { setText(line.priceSource === 'set' && line.price != null ? String(line.price) : '') }, [line.price, line.priceSource])
  const commit = () => {
    const t = text.trim().replace(/[$,]/g, '')
    const current = line.priceSource === 'set' ? line.price : null
    const v = t === '' ? null : Number(t)
    if (v != null && (Number.isNaN(v) || v < 0)) { setBad(true); return }
    setBad(false)
    if (v !== current) onChange({ price: v })
  }
  return (
    <div className="rowi price-row">
      <span className="k">{KIND[line.kind]}</span>
      <span className="v">
        {line.label}
        <span className="note" style={{ display: 'block' }}>
          {line.priceSource === 'list' ? `List price ${money(line.price)} from your saved pages` : line.priceSource === 'catalog' ? `Catalog price ${money(line.price)}` : line.priceSource === 'none' ? 'No price yet' : 'Your price'}
        </span>
      </span>
      <span className="price-ctl">
        <input className="input num" inputMode="decimal" aria-label={`Price of ${line.label}`} aria-invalid={bad}
          placeholder={(line.priceSource === 'list' || line.priceSource === 'catalog') && line.price != null ? String(line.price) : '0.00'} value={text} disabled={busy}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <select className="input" aria-label={`Status of ${line.label}`} value={line.status} disabled={busy} onChange={(e) => onChange({ status: e.target.value as Status })}>
          <option value="owned">Owned</option><option value="planned">Planned</option>
        </select>
      </span>
    </div>
  )
}
