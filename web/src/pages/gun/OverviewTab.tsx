import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, useAction, usePlans, useValues } from '../../api'
import { ConfirmButton } from '../../components/ConfirmButton'
import { PricingCard } from '../../components/PricingCard'
import { RefreshButton } from '../../components/RefreshButton'
import { money, specLabel } from '../../lib/format'
import type { Item } from '../../types'
import { errMsg, type ChChoice, type TriggerChoice } from './shared'

interface Props {
  item: Item
  trig: TriggerChoice | null
  trigOpts: TriggerChoice[]
  onTrig: (id: string) => void
  ch: ChChoice | null
  chOpts: ChChoice[]
  onCh: (id: string) => void
}

export function OverviewTab({ item, trig, trigOpts, onTrig, ch, chOpts, onCh }: Props) {
  const navigate = useNavigate()
  const d = item.data
  const specs = Object.entries(d.specs ?? {}).filter(([, v]) => v !== undefined && v !== '')
  const { data: values } = useValues()
  const { data: plans } = usePlans()
  const value = item.kind === 'gun' ? values?.find((v) => v.gun_id === item.gun.id)?.value ?? null : null
  const [valueText, setValueText] = useState('')
  const [notes, setNotes] = useState(d.notes ?? '')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setValueText(value == null ? '' : String(value)) }, [value, item.key])
  useEffect(() => { setNotes(d.notes ?? '') }, [d.notes, item.key])

  const saveValue = useAction((v: number | null) => api.setValue(item.gun.id, v), [['values'], ['analytics']])
  const saveNotes = useAction((n: string) => api.patchGun(item.gun.id, { notes: n }), [['library']])
  const addPlan = useAction(api.addPlan, [['plans'], ['analytics']])
  const remove = useAction(async () => (item.kind === 'gun' ? api.removeGun(item.gun.id) : api.removePart(item.gun.id, item.partId)), [['library']])

  const planned = (optId: string) => plans?.some((p) => p.gun_id === item.gun.id && p.option_id === optId && !p.done)

  return (
    <>
      <div>
        <h3 className="section-title">Price and status <span>{item.kind === 'gun' ? 'gun + parts + attachments' : `counts toward ${item.gun.name}`}</span></h3>
        <PricingCard gun={item.gun} onlyLine={item.kind === 'part' ? { kind: 'part', id: item.partId } : undefined} />
      </div>
      {item.kind === 'gun' && trigOpts.length > 1 && trig && (
        <div>
          <label className="field">Trigger to preview
            <select className="input" value={trig.id} onChange={(e) => onTrig(e.target.value)}>
              {trigOpts.map((o) => <option key={o.id} value={o.id}>{o.installed ? 'Installed: ' : ''}{o.name}</option>)}
            </select>
          </label>
          <div className="row-actions" style={{ marginTop: 6 }}>
            <span className="mono" style={{ color: 'var(--brass)', fontSize: 12 }}>{trig.installed ? 'Installed' : trig.price}</span>
            {!trig.installed && (planned(trig.id)
              ? <span className="pill brass">In your upgrade plan</span>
              : <button type="button" className="btn small" disabled={addPlan.isPending} onClick={() => addPlan.mutate({ gun_id: item.gun.id, kind: 'trigger', option_id: trig.id, label: trig.name, est_cost: trig.cost ?? null })}>Add to upgrade plan</button>)}
          </div>
          {trig.note && <p className="note" style={{ marginTop: 4 }}>{trig.note}</p>}
        </div>
      )}
      {item.kind === 'gun' && chOpts.length > 1 && ch && (
        <div>
          <label className="field">Charging handle to preview
            <select className="input" value={ch.id} onChange={(e) => onCh(e.target.value)}>
              {chOpts.map((o) => <option key={o.id} value={o.id}>{o.installed ? 'Installed: ' : ''}{o.name}</option>)}
            </select>
          </label>
          <div className="row-actions" style={{ marginTop: 6 }}>
            <span className="mono" style={{ color: 'var(--brass)', fontSize: 12 }}>{ch.installed ? 'Installed' + (ch.price ? ', ' + ch.price : '') : ch.price}</span>
            {!ch.installed && (planned(ch.id)
              ? <span className="pill brass">In your upgrade plan</span>
              : <button type="button" className="btn small" onClick={() => addPlan.mutate({ gun_id: item.gun.id, kind: 'chargingHandle', option_id: ch.id, label: ch.name, est_cost: ch.cost ?? null })}>Add to upgrade plan</button>)}
          </div>
        </div>
      )}

      <div>
        <h3 className="section-title">Specs <span>{specs.length ? 'from metadata lookups and your edits' : ''}</span></h3>
        <div style={{ marginBottom: 8 }}><RefreshButton itemKey={item.key} className="btn small" /></div>
        {specs.length ? (
          <div className="rows">
            {specs.map(([k, v]) => (
              <div className="rowi" key={k}><span className="k">{specLabel(k)}</span><span className="v">{k === 'listPrice' ? money(Number(v)) : String(v)}</span><span /></div>
            ))}
          </div>
        ) : <p className="note">No specs yet. Use the Metadata tab to pull them from your saved pages or a product page.</p>}
      </div>

      {item.kind === 'gun' && (
        <div>
          <h3 className="section-title">Current value</h3>
          <div className="row-actions">
            <input className="input" style={{ maxWidth: 160 }} inputMode="decimal" placeholder="e.g. 1200" value={valueText} onChange={(e) => setValueText(e.target.value)} aria-label="Current value in USD" />
            <button type="button" className="btn" disabled={saveValue.isPending} onClick={async () => {
              setErr(null)
              const v = valueText.trim() === '' ? null : Number(valueText)
              if (v != null && (Number.isNaN(v) || v < 0)) { setErr('Enter the value as a number.'); return }
              try { await saveValue.mutateAsync(v) } catch (e) { setErr(errMsg(e)) }
            }}>Save value</button>
            {value != null && <span className="note">Saved: {money(value)}</span>}
          </div>
          <p className="note" style={{ marginTop: 4 }}>What you think it would sell for. Used on the dashboard against what you've spent.</p>
        </div>
      )}

      {d.checks && d.checks.length > 0 && (
        <div>
          <h3 className="section-title">Fit checks</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {d.checks.map((c, i) => <div className="check" key={i}><span className={'pill ' + (c.level === 'ok' ? 'ok' : 'warn')}>{c.level === 'ok' ? 'OK' : 'CHECK'}</span><span>{c.text}</span></div>)}
          </div>
        </div>
      )}

      {item.kind === 'gun' && (
        <div>
          <h3 className="section-title">Notes</h3>
          <textarea className="input" rows={3} style={{ width: '100%', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, color: 'var(--ink)' }} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          {notes !== (d.notes ?? '') && <div className="row-actions" style={{ marginTop: 6 }}><button type="button" className="btn" onClick={() => saveNotes.mutate(notes)}>Save notes</button></div>}
        </div>
      )}

      <div>
        <h3 className="section-title">Manage</h3>
        <div className="row-actions">
          <ConfirmButton confirm={`Move to guns/_removed`} onConfirm={async () => {
            try { await remove.mutateAsync(undefined); navigate(item.kind === 'part' ? `/gun/${item.gun.id}` : '/') } catch (e) { setErr(errMsg(e)) }
          }}>Remove {item.kind === 'gun' ? 'gun' : 'part'}</ConfirmButton>
        </div>
        {err && <p className="error" style={{ marginTop: 6 }}>{err}</p>}
        <p className="note" style={{ marginTop: 6 }}>To change any detail, edit <code>guns/{item.gun.id}/{item.kind === 'part' ? `parts/${item.partId}.json` : 'gun.json'}</code>. The page picks it up on the next refresh.</p>
      </div>
    </>
  )
}
