import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, useValues } from '../../api'
import { money } from '../../lib/format'
import type { NfaClass } from '../../three/engine/checks'
import type { Units } from '../../three/engine/specs'
import type { Attachment, Gun, NfaRecord, Records } from '../../types'
import { errMsg } from './shared'

const NFA_ITEMS: [string, string][] = [['none', 'Not an NFA item'], ['sbr', 'Short-barreled rifle (SBR)'], ['sbs', 'Short-barreled shotgun (SBS)'], ['aow', 'Any other weapon (AOW)'], ['mg', 'Machine gun'], ['dd', 'Destructive device']]
const STATUSES: [string, string][] = [['', 'Not recorded'], ['planned', 'Planned, not filed'], ['pending', 'Filed, pending'], ['approved', 'Approved'], ['denied', 'Denied'], ['transferred', 'Transferred out']]

interface Props { gun: Gun; units: Units; nfaClass: NfaClass | null }

/** Identity, acquisition and NFA paperwork. Saved in the gun's own gun.json on this computer. */
export function RecordsTab({ gun, units, nfaClass }: Props) {
  const qc = useQueryClient()
  const { data: values } = useValues()
  const value = values?.find((v) => v.gun_id === gun.id)?.value ?? null
  const init = () => {
    const r = gun.records ?? {}
    return {
      mfr: r.mfr ?? (gun.specs?.brand as string | undefined) ?? '', serial: r.serial ?? '', acquired: r.acquired ?? '', source: r.source ?? '', paid: r.paid ?? '', notes: r.notes ?? '',
      weight: r.scaleWeightLb ? String(units === 'mm' ? Math.round(r.scaleWeightLb * 453.592) / 1000 : r.scaleWeightLb) : '',
      value: value == null ? '' : String(value),
      nfa: { item: r.nfa?.item ?? 'none', form: r.nfa?.form ?? '', status: r.nfa?.status ?? '', ctl: r.nfa?.ctl ?? '', filed: r.nfa?.filed ?? '', approved: r.nfa?.approved ?? '' },
      cans: Object.fromEntries(gun.attachments.filter(isCan).map((a) => [a.id, { serial: a.serial ?? '', status: a.nfa?.status ?? '', ctl: a.nfa?.ctl ?? '', filed: a.nfa?.filed ?? '', approved: a.nfa?.approved ?? '' }])),
    }
  }
  const [f, setF] = useState(init)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { setF(init()); setMsg(null) }, [gun.id, value, units]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const setN = (k: keyof NfaRecord) => (e: { target: { value: string } }) => setF((p) => ({ ...p, nfa: { ...p.nfa, [k]: e.target.value } }))
  const setCan = (id: string, k: string, v: string) => setF((p) => ({ ...p, cans: { ...p.cans, [id]: { ...p.cans[id], [k]: v } } }))

  const save = async () => {
    setMsg(null)
    const num = (t: string) => { const s = t.trim().replace(/[$,]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : undefined }
    const w = num(f.weight), val = num(f.value), paid = num(f.paid)
    if (w === undefined || (w != null && w <= 0)) { setMsg({ ok: false, text: `Enter the scale weight in ${units === 'mm' ? 'kilograms' : 'pounds'}, like ${units === 'mm' ? '2.9' : '6.4'}.` }); return }
    if (val === undefined || paid === undefined) { setMsg({ ok: false, text: 'Enter prices as numbers, like 1299.99.' }); return }
    const records: Records = {
      mfr: f.mfr.trim(), serial: f.serial.trim(), acquired: f.acquired, source: f.source.trim(), paid: paid == null ? '' : String(paid), notes: f.notes,
      scaleWeightLb: w == null ? null : units === 'mm' ? Math.round((w / 0.453592) * 100) / 100 : w,
      nfa: f.nfa.item === 'none' && !f.nfa.status ? null : { ...f.nfa },
    }
    setBusy(true)
    try {
      await api.patchGun(gun.id, { records })
      for (const a of gun.attachments.filter(isCan)) {
        const c = f.cans[a.id]
        await api.patchAttachment(gun.id, a.id, { serial: c.serial.trim() || null, nfa: { status: c.status, ctl: c.ctl, filed: c.filed, approved: c.approved } })
      }
      if (val !== value) await api.setValue(gun.id, val)
      await Promise.all(['library', 'values', 'analytics'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      setMsg({ ok: true, text: 'Saved.' })
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }) }
    finally { setBusy(false) }
  }
  const cans = gun.attachments.filter(isCan)

  return (
    <form onSubmit={(e) => { e.preventDefault(); save() }}>
      <h3 className="section-title">Identity</h3>
      <div className="grid2">
        <label className="field">Manufacturer<input className="input" value={f.mfr} onChange={set('mfr')} /></label>
        <label className="field">Serial number<input className="input" value={f.serial} onChange={set('serial')} autoComplete="off" /><span className="hint">Kept only in this gun's folder on this computer.</span></label>
        <label className="field">Caliber<input className="input" value={gun.caliber ?? (gun.specs?.caliber as string | undefined) ?? ''} disabled /><span className="hint">Change it in the Build tab.</span></label>
        <label className="field">Twist<input className="input" value={gun.twist ?? ''} disabled /></label>
      </div>

      <h3 className="section-title" style={{ marginTop: 16 }}>Acquisition and value</h3>
      <div className="grid2">
        <label className="field">Acquired<input className="input" type="date" value={f.acquired} onChange={set('acquired')} /></label>
        <label className="field">From (dealer or FFL)<input className="input" value={f.source} onChange={set('source')} /></label>
        <label className="field">Price paid (USD)<input className="input num" inputMode="decimal" value={f.paid} onChange={set('paid')} placeholder={gun.pricing.total ? `listed ${money(gun.pricing.total)}` : ''} /></label>
        <label className="field">Current value (USD)<input className="input num" inputMode="decimal" value={f.value} onChange={set('value')} /><span className="hint">Used for value vs spent on the Dashboard.</span></label>
        <label className="field">Scale weight, unloaded ({units === 'mm' ? 'kg' : 'lb'})<input className="input num" inputMode="decimal" value={f.weight} onChange={set('weight')} /><span className="hint">Replaces the listed or estimated weight in Specs.</span></label>
      </div>

      <h3 className="section-title" style={{ marginTop: 16 }}>NFA record {nfaClass && <span>this setup: {nfaClass.cls}</span>}</h3>
      {nfaClass?.nfa && f.nfa.item === 'none' && <p className="note" style={{ color: 'var(--warn)' }}>The current build classifies as {nfaClass.cls}. Record the form and its status below.</p>}
      <div className="grid2">
        <label className="field">Item<select className="input" value={f.nfa.item} onChange={setN('item')}>{NFA_ITEMS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Form<select className="input" value={f.nfa.form} onChange={setN('form')}><option value="">—</option><option>Form 1</option><option>Form 4</option><option>Form 3</option><option>Form 5</option></select></label>
        <label className="field">Status<select className="input" value={f.nfa.status} onChange={setN('status')}>{STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Control / eForm number<input className="input" value={f.nfa.ctl} onChange={setN('ctl')} /></label>
        <label className="field">Filed<input className="input" type="date" value={f.nfa.filed} onChange={setN('filed')} /></label>
        <label className="field">Approved<input className="input" type="date" value={f.nfa.approved} onChange={setN('approved')} /></label>
      </div>

      {cans.length > 0 && <>
        <h3 className="section-title" style={{ marginTop: 16 }}>Suppressors</h3>
        {cans.map((a) => (
          <div key={a.id} className="grid2" style={{ marginBottom: 10 }}>
            <b className="wide">{a.name}</b>
            <label className="field">Serial<input className="input" value={f.cans[a.id].serial} onChange={(e) => setCan(a.id, 'serial', e.target.value)} autoComplete="off" /></label>
            <label className="field">Form 4 status<select className="input" value={f.cans[a.id].status} onChange={(e) => setCan(a.id, 'status', e.target.value)}>{STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">Filed<input className="input" type="date" value={f.cans[a.id].filed} onChange={(e) => setCan(a.id, 'filed', e.target.value)} /></label>
            <label className="field">Approved<input className="input" type="date" value={f.cans[a.id].approved} onChange={(e) => setCan(a.id, 'approved', e.target.value)} /></label>
            <label className="field wide">Control / eForm number<input className="input" value={f.cans[a.id].ctl} onChange={(e) => setCan(a.id, 'ctl', e.target.value)} /></label>
          </div>
        ))}
      </>}

      <label className="field" style={{ marginTop: 12 }}>Notes<textarea className="input" rows={3} value={f.notes} onChange={set('notes')} /></label>
      <div className="row-actions" style={{ marginTop: 10 }}>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save records'}</button>
        {msg && <span className={msg.ok ? 'note' : 'error'} role="status">{msg.text}</span>}
      </div>
    </form>
  )
}

const isCan = (a: Attachment) => a.type === 'suppressor'
