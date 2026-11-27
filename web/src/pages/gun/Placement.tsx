import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { money } from '../../lib/format'
import { HEIGHTS, MOUNTSYS, type Cat } from '../../three/engine/data'
import { fmtLen, type AttPlace, type Units } from '../../three/engine/specs'
import type { Attachment, Gun } from '../../types'
import { errMsg } from './shared'

const CLOCKS: [number, string][] = [[0, "12 o'clock (top)"], [1, "1 o'clock"], [2, "2 o'clock"], [3, "3 o'clock (right)"], [9, "9 o'clock (left)"], [10, "10 o'clock"], [11, "11 o'clock"]]

/** Exact placement for one attachment: rail position (in Picatinny slots), clock position,
 *  optic height, mount, offset dot and suppressor adapter. Saved to the attachment in gun.json. */
export function Placement({ gun, att, place, cat, units }: { gun: Gun; att: Attachment; place: AttPlace; cat: Cat; units: Units }) {
  const qc = useQueryClient()
  const [pos, setPos] = useState(place.pos)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setPos(place.pos) }, [place.pos])
  const save = async (changes: Record<string, unknown>) => {
    setErr(null); setBusy(true)
    try { await api.patchAttachment(gun.id, att.id, changes); await Promise.all([qc.invalidateQueries({ queryKey: ['library'] }), qc.invalidateQueries({ queryKey: ['analytics'] })]) }
    catch (e) { setErr(errMsg(e)) }
    finally { setBusy(false) }
  }
  const commitPos = () => { if (Math.abs(pos - place.pos) > 0.001) save({ pos: Math.round(pos * 1000) / 1000 }) }
  const k = place.k, scoped = k === 'lpvo' || k === 'scope'
  const mountOpts = cat.acc.filter((x) => x.k === 'omount' && (scoped ? x.for === 'lpvo' : x.for !== 'lpvo'))
  const mount = att.mount ? cat.AB[att.mount] : undefined
  const supp = att.cid ? cat.AB[att.cid] : undefined
  const fam = supp?.rear
  const adapters = fam && fam !== 'fixed' ? cat.acc.filter((x) => x.k === 'smount' && x.fam === fam) : []
  const hasControls = place.railable || ['lpvo', 'scope', 'reddot', 'holo', 'prism', 'magn', 'offset', 'light', 'laser', 'switch', 'supp'].includes(k)
  if (!hasControls) return null
  const origin = place.pos - place.dist // rear of the top rail, or the front of the receiver
  const dist = pos - origin
  const slotNote = place.onTop ? ` · Picatinny slot ${Math.max(1, Math.round((dist + (scoped ? 3.3 : 0)) / 0.394) + 1)}` : ''

  return (
    <div className="placement" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {place.railable && (
        <label className="field wide">
          <span>Position: {fmtLen(dist, units)} from the {place.from}{slotNote}</span>
          <input type="range" min={place.lo} max={place.hi} step={0.394} value={pos} disabled={busy} aria-label={`Position of ${att.name}`}
            onChange={(e) => setPos(Number(e.target.value))} onPointerUp={commitPos} onKeyUp={commitPos} onBlur={commitPos} />
          {place.set && <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => save({ pos: null })}>Back to the usual spot</button>}
        </label>
      )}
      {scoped && (
        <label className="field wide">Mount / rings{mount ? ` · ${mount.h ?? ''}" centreline · ${money(mount.p ?? 0)}` : ''}
          <select className="input" value={att.mount ?? ''} disabled={busy} onChange={(e) => save({ mount: e.target.value || null })}>
            <option value="">None chosen</option>
            {mountOpts.map((x) => <option key={x.id} value={x.id}>{x.n}{x.h ? ` · ${x.h}"` : ''} · {money(x.p ?? 0)}</option>)}
          </select>
        </label>
      )}
      {['reddot', 'holo', 'prism', 'magn'].includes(k) && (
        <label className="field">Optic height over the rail
          <select className="input" value={String(mount?.h ?? place.h)} disabled={busy || !!mount?.h} title={mount?.h ? 'Set by the mount' : undefined} onChange={(e) => save({ h: Number(e.target.value) })}>
            {[...new Set([...HEIGHTS.map(([v]) => v), mount?.h ?? place.h])].sort((a, b) => a - b).map((v) => <option key={v} value={String(v)}>{HEIGHTS.find(([h]) => h === v)?.[1] ?? `${v}"`}</option>)}
          </select>
        </label>
      )}
      {k === 'reddot' && (
        <label className="field">Mount
          <select className="input" value={att.mount ?? ''} disabled={busy} onChange={(e) => save({ mount: e.target.value || null })}>
            <option value="">Included / integral</option>
            {mountOpts.map((x) => <option key={x.id} value={x.id}>{x.n}{x.h ? ` · ${x.h}"` : ''} · {money(x.p ?? 0)}</option>)}
          </select>
        </label>
      )}
      {k === 'offset' && (
        <label className="field wide">Dot on the offset mount
          <select className="input" value={att.sub ?? ''} disabled={busy} onChange={(e) => save({ sub: e.target.value || null })}>
            <option value="">None</option>
            {cat.acc.filter((x) => x.k === 'pdot').map((x) => <option key={x.id} value={x.id}>{x.n}{x.fp ? ` · ${x.fp}` : ''} · {money(x.p ?? 0)}</option>)}
          </select>
        </label>
      )}
      {['light', 'laser', 'switch'].includes(k) && !gun.platform?.startsWith('pistol') && (
        <label className="field">Clock position
          <select className="input" value={String(att.clock ?? (k === 'light' ? 2 : k === 'laser' ? 11 : 0))} disabled={busy} onChange={(e) => save({ clock: Number(e.target.value) })}>
            {CLOCKS.map(([v, n]) => <option key={v} value={String(v)}>{n}</option>)}
          </select>
        </label>
      )}
      {k === 'supp' && (
        <label className="field wide">Mount{supp?.mt ? ` · native ${MOUNTSYS[supp.mt] ?? supp.mt}` : ''}{fam ? ` · ${fam} rear` : ''}
          {adapters.length ? (
            <select className="input" value={att.ad ?? ''} disabled={busy} onChange={(e) => save({ ad: e.target.value || null })}>
              <option value="">None chosen</option>
              {adapters.map((x) => <option key={x.id} value={x.id}>{x.n} → {MOUNTSYS[x.gives ?? ''] ?? x.gives}{x.th ? ` ${x.th}` : ''} · {money(x.p ?? 0)}</option>)}
            </select>
          ) : <span className="note">{fam === 'fixed' ? 'Fixed rear mount' : supp ? 'The can sets its own mount' : 'Pick the can from the catalog to choose a mount'}</span>}
        </label>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  )
}
