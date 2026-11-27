import { useEffect, useState } from 'react'
import { api, useAction } from '../api'
import type { Catalog, Gun, LogEntry, LogKind } from '../types'
import { Dialog } from './Dialog'
import { today } from '../lib/format'
import { CATEGORIES, LOG_KINDS } from '../lib/labels'
import { money } from '../lib/format'
import { accChips } from '../three/engine/chips'
import { KIND_TO_APP_TYPE, KINDS, type Cat } from '../three/engine/data'
import { makeRows, TEMPLATES } from '../three/engine/templates'
import { CatalogPicker, type PickItem, type Picked } from './CatalogPicker'

const parseLines = (text: string, fields: 2 | 3) =>
  text.split(/\r?\n/).map((l) => l.split('|').map((s) => s.trim())).filter((p) => p.length >= 2 && p.some(Boolean))
    .map((p) => (fields === 3 ? (p.length >= 3 ? [p[0], p[1], p.slice(2).join(' | ')] : ['Lower', p[0], p[1]]) : [p[0], p.slice(1).join(' | ')]))

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** '' -> null (no price); a valid number -> number; anything else -> undefined (invalid). */
function parsePrice(text: string): number | null | undefined {
  const t = text.trim().replace(/[$,]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/* ---------------- add gun ---------------- */
/** New guns start from a template: a catalog build (every slot priced) or a factory gun. */
export function AddGunDialog({ open, cat, onClose, onCreated }: { open: boolean; cat: Cat; onClose: () => void; onCreated: (id: string) => void }) {
  const [tpl, setTpl] = useState(TEMPLATES[0].id)
  const [f, setF] = useState({ name: '', short: '', status: 'owned', price: '' })
  const [err, setErr] = useState<string | null>(null)
  const create = useAction(api.createGun, [['library'], ['analytics']])
  useEffect(() => { if (open) { setTpl(TEMPLATES[0].id); setF({ name: '', short: '', status: 'owned', price: '' }); setErr(null) } }, [open])
  const t = TEMPLATES.find((x) => x.id === tpl) ?? TEMPLATES[0]
  const preview = t.make(cat)
  const partsTotal = t.catalogBuild ? makeRows(cat, preview, true, 'owned').reduce((s, r) => s + (r.listPrice ?? 0), 0) : 0
  const submit = async () => {
    setErr(null)
    const price = parsePrice(f.price)
    if (price === undefined) { setErr('Enter the price as a number, like 1299.99.'); return }
    const g = t.make(cat)
    const status = f.status as 'owned' | 'planned'
    const body: Record<string, unknown> = {
      name: f.name.trim() || g.name, short: f.short.trim() || g.short, type: g.type, platform: g.platform, caliber: g.caliber, twist: g.twist,
      ...(g.rimfire ? { rimfire: true } : {}), ...(g.fit ? { fit: g.fit } : {}), cfg: g.cfg, build: makeRows(cat, g, t.catalogBuild, status),
      sources: [], bom: {}, attachments: [], links: [], specs: { caliber: g.caliber, ...g.spec }, status,
      checks: g.nfa ? [{ level: 'warn', text: `This configuration needs an approved ${g.nfa} before it's assembled.` }] : [],
      ...(g.platform === 'pistol' ? { views: { lower: 'Frame', upper: 'Slide' } } : {}),
      // a catalog build's price is the sum of its parts; a factory gun has its own price
      ...(t.catalogBuild ? { price: price ?? 0 } : { price }),
    }
    try { const r = await create.mutateAsync(body as Partial<Gun>); onCreated(r.id) } catch (e) { setErr(msg(e)) }
  }
  return (
    <Dialog open={open} title="Add a gun" note={<>Creates a folder in <code>guns/</code>. Change any part afterwards in the Build tab.</>} submitLabel="Create gun" busy={create.isPending} error={err} onClose={onClose} onSubmit={submit}>
      <div className="grid2">
        <div className="field wide">Start from
          <div className="tpl-list" role="radiogroup" aria-label="Start from">
            {TEMPLATES.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={x.id === tpl} className="tpl" onClick={() => setTpl(x.id)}>
                <b>{x.name}</b><span>{x.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="field wide">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={preview.name} /></label>
        <label className="field wide">Short description<input value={f.short} onChange={(e) => setF({ ...f, short: e.target.value })} placeholder={preview.short} /></label>
        <label className="field">Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="owned">Owned</option><option value="planned">Planned to buy</option></select></label>
        {t.catalogBuild
          ? <p className="note" style={{ alignSelf: 'end' }}>Parts from the catalog add up to <b className="num">{money(partsTotal)}</b>. Each part's price and status can be changed later.</p>
          : <label className="field">Price (USD)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="optional" /></label>}
      </div>
    </Dialog>
  )
}

/* ---------------- add part ---------------- */
export function AddPartDialog({ gun, onClose, onCreated }: { gun: Gun | null; onClose: () => void; onCreated: (key: string) => void }) {
  const blank = { name: '', short: '', kind: '', color: 'nitride', from: '', rows: '', url: '', price: '', status: 'owned' }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState<string | null>(null)
  const create = useAction((p: { gunId: string; body: Record<string, unknown> }) => api.createPart(p.gunId, p.body), [['library']])
  useEffect(() => { if (gun) { setF(blank); setErr(null) } }, [gun]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const submit = async () => {
    if (!gun) return
    if (!f.name.trim()) { setErr('Give the part a name.'); return }
    const price = parsePrice(f.price)
    if (price === undefined) { setErr('Enter the price as a number, like 67.96.'); return }
    const rows = parseLines(f.rows, 2).map(([label, value]) => ({ part: '', label, value }))
    const body = {
      name: f.name.trim(), short: f.short.trim() || 'Bought separately', order: gun.parts.length + 1, sources: [], price, status: f.status,
      model: f.kind ? { kind: f.kind, color: f.color } : null, bom: { part: { title: 'Part', from: f.from.trim(), rows } }, checks: [],
      specs: {}, links: f.url.trim() ? [{ url: f.url.trim(), label: 'Product page' }] : [],
    }
    try { const r = await create.mutateAsync({ gunId: gun.id, body }); onCreated(`${gun.id}/${r.id}`) } catch (e) { setErr(msg(e)) }
  }
  return (
    <Dialog open={!!gun} title="Add a part" note={gun && <>Adds a file to <code>guns/{gun.id}/parts/</code> and shows it under {gun.name}.</>} submitLabel="Add part" busy={create.isPending} error={err} onClose={onClose} onSubmit={submit}>
      <div className="grid2">
        <label className="field wide">Part name<input value={f.name} onChange={set('name')} placeholder="e.g. Geissele Super 42 spring" autoFocus /></label>
        <label className="field wide">Short description<input value={f.short} onChange={set('short')} placeholder="e.g. Bought separately" /></label>
        <label className="field">3D model<select value={f.kind} onChange={set('kind')}>
          <option value="">None (list only)</option><option value="bcg">Bolt carrier group</option><option value="chargingHandle">Charging handle</option>
        </select></label>
        <label className="field">Finish<select value={f.color} onChange={set('color')}>
          <option value="nitride">Nitride black</option><option value="parkerized">Parkerized</option><option value="hardchrome">Hard chrome</option><option value="dlc">DLC black</option><option value="ddc">Desert Dirt Color</option>
        </select></label>
        <label className="field">Price (USD)<input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="optional" /></label>
        <label className="field">Status<select value={f.status} onChange={set('status')}><option value="owned">Owned</option><option value="planned">Planned to buy</option></select></label>
        <label className="field wide">Where it came from<input value={f.from} onChange={set('from')} placeholder="e.g. the store or website" /></label>
        <label className="field wide">Product page (optional)<input value={f.url} onChange={set('url')} placeholder="https://…" /><span className="hint">Used by the Product page lookup and price tracking.</span></label>
        <label className="field wide">Details, one per line: <span className="mono">Label | Detail</span>
          <textarea rows={3} value={f.rows} onChange={set('rows')} placeholder={'Material | 9310 steel\nFinish | Nitride'} /></label>
      </div>
    </Dialog>
  )
}

/* ---------------- add attachment ---------------- */
export function AddAttachmentDialog({ gun, catalog, cat, onClose, onCreated }: { gun: Gun | null; catalog: Catalog; cat: Cat | null; onClose: () => void; onCreated: (gunId: string, attId: string) => void }) {
  const isPistol = gun?.model?.kind === 'pistol' || gun?.platform === 'pistol'
  const [picking, setPicking] = useState(false)
  const [kind, setKind] = useState('')
  const kinds = KINDS.map((g) => ({ ...g, items: g.items.filter(([k]) => (isPistol ? ['pdot', 'plight', 'laser', 'supp'] : ['pdot', 'plight']).includes(k) === isPistol) })).filter((g) => g.items.length)
  const pickKind = kind || kinds[0]?.items[0]?.[0] || 'reddot'
  const accItems: PickItem[] = cat ? cat.acc.filter((a) => a.k === pickKind).map((a) => ({ id: a.id, n: a.n, p: a.p, w: a.w, chips: accChips(a) })) : []
  const addFromCatalog = async (p: Picked) => {
    if (!gun) return
    const a = p.id && cat ? cat.AB[p.id] : undefined
    const type = KIND_TO_APP_TYPE[a?.k ?? pickKind] ?? 'reddot'
    const at = catalog.attachments[type]
    const body: Record<string, unknown> = { type, name: p.name, details: '', color: 'black', price: p.price ?? p.listPrice, status: p.status, ...(p.id ? { cid: p.id } : {}) }
    if (at?.positions) body.position = ['laser', 'light', 'foregrip', 'bipod'].includes(type) ? 'front' : 'rear'
    if (at?.sides) body.side = 'right'
    try { const r = await add.mutateAsync({ gunId: gun.id, body }); setPicking(false); onCreated(gun.id, r.id) } catch (e) { setErr(msg(e)) }
  }
  const types = Object.entries(catalog.attachments).filter(([, t]) => t.for === 'any' || t.for === (isPistol ? 'pistol' : 'rifle'))
  const groups = [...new Set(types.map(([, t]) => t.group))]
  const [f, setF] = useState({ type: '', name: '', details: '', position: 'rear', side: 'right', color: 'black', price: '', status: 'owned' })
  const [err, setErr] = useState<string | null>(null)
  const add = useAction((p: { gunId: string; body: Record<string, unknown> }) => api.addAttachment(p.gunId, p.body), [['library'], ['analytics']])
  useEffect(() => { if (gun) { setF({ type: types[0]?.[0] ?? '', name: '', details: '', position: 'rear', side: 'right', color: 'black', price: '', status: 'owned' }); setErr(null) } }, [gun]) // eslint-disable-line react-hooks/exhaustive-deps
  const t = catalog.attachments[f.type]
  const setType = (type: string) => setF((p) => ({ ...p, type, position: ['laser', 'light', 'foregrip', 'bipod'].includes(type) ? 'front' : 'rear' }))
  const submit = async () => {
    if (!gun || !t) return
    const price = parsePrice(f.price)
    if (price === undefined) { setErr('Enter the price as a number, like 349.99.'); return }
    const body: Record<string, unknown> = { type: f.type, name: f.name.trim() || t.example || t.name, details: f.details.trim(), color: f.color, price, status: f.status }
    if (t.positions) body.position = f.position
    if (t.sides) body.side = f.side
    try { const r = await add.mutateAsync({ gunId: gun.id, body }); onCreated(gun.id, r.id) } catch (e) { setErr(msg(e)) }
  }
  return (
    <>
    <Dialog open={!!gun} title="Add an attachment" note={gun && <>Saved in <code>guns/{gun.id}/gun.json</code> and drawn on {gun.name}.</>} submitLabel="Add attachment" busy={add.isPending} error={err} onClose={onClose} onSubmit={submit}>
      {cat && (
        <div className="row-actions" style={{ margin: '4px 0 12px' }}>
          <button type="button" className="btn primary" onClick={() => setPicking(true)}>Choose from the catalog ({cat.acc.length} items)</button>
          <span className="note">or describe it yourself below</span>
        </div>
      )}
      <div className="grid2">
        <label className="field wide">Type<select value={f.type} onChange={(e) => setType(e.target.value)}>
          {groups.map((g) => <optgroup key={g} label={g}>{types.filter(([, x]) => x.group === g).map(([k, x]) => <option key={k} value={k}>{x.name}</option>)}</optgroup>)}
        </select></label>
        <label className="field wide">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t?.example ? 'e.g. ' + t.example : ''} autoFocus /></label>
        <label className="field wide">Details<input value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="e.g. 2 MOA dot, LaRue LT660 mount, $780" /></label>
        {t?.positions && <label className="field">Where on the rail<select value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}>
          <option value="rear">Rear</option><option value="middle">Middle</option><option value="front">Front</option></select></label>}
        {t?.sides && <label className="field">Side<select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
          <option value="right">Right</option><option value="left">Left</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>}
        <label className="field">Finish<select value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })}>
          {Object.entries(catalog.attachmentFinishes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Price (USD)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="optional" /></label>
        <label className="field">Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="owned">Owned</option><option value="planned">Planned to buy</option></select></label>
      </div>
    </Dialog>
    <CatalogPicker open={picking} title="Choose an attachment" submitLabel="Add attachment" defaultStatus="planned"
      note={`Prices and sizes from ${cat?.src ?? 'the catalog'}. Sizes are used to draw it on the model.`}
      header={<label className="field" style={{ marginBottom: 8 }}>Type<select className="input" value={pickKind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((g) => <optgroup key={g.g} label={g.g}>{g.items.map(([k, n]) => <option key={k} value={k}>{n} ({cat?.acc.filter((a) => a.k === k).length ?? 0})</option>)}</optgroup>)}
      </select></label>}
      items={accItems} busy={add.isPending} error={err} onClose={() => setPicking(false)} onPick={addFromCatalog} />
    </>
  )
}

/* ---------------- log entry ---------------- */

export function LogDialog({ gun, entry, onClose }: { gun: Gun | null; entry: LogEntry | null; onClose: () => void }) {
  const init = () => ({
    kind: (entry?.kind ?? 'purchase') as LogKind, date: entry?.date ?? today(), title: entry?.title ?? '', amount: entry?.amount?.toString() ?? '',
    rounds: entry?.rounds?.toString() ?? '', category: entry?.category ?? 'part', vendor: entry?.vendor ?? '', notes: entry?.notes ?? '',
  })
  const [f, setF] = useState(init)
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = useAction(async () => {
    const body = {
      gun_id: gun!.id, kind: f.kind, date: f.date, title: f.title.trim(),
      amount: f.amount === '' ? null : Number(f.amount), rounds: f.rounds === '' ? null : Math.round(Number(f.rounds)),
      category: f.kind === 'purchase' ? f.category : null, vendor: f.vendor.trim() || null, notes: f.notes.trim(),
    }
    if (body.amount != null && (Number.isNaN(body.amount) || body.amount < 0)) throw new Error('Enter the amount as a number, like 89.99.')
    if (body.rounds != null && (Number.isNaN(body.rounds) || body.rounds < 0)) throw new Error('Enter the round count as a whole number.')
    const id = entry ? (await api.editLog(entry.id, body), entry.id) : (await api.addLog(body)).id
    if (file) await api.uploadReceipt(id, file)
  }, [['logs'], ['analytics']])
  useEffect(() => { if (gun) { setF(init()); setFile(null); setErr(null) } }, [gun, entry]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const submit = async () => {
    setErr(null); setBusy(true)
    try { await save.mutateAsync(undefined); onClose() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const showAmount = f.kind === 'purchase' || f.kind === 'nfa' || f.kind === 'maintenance' || f.kind === 'part'
  const showRounds = f.kind === 'rounds' || f.kind === 'range'
  return (
    <Dialog open={!!gun} title={entry ? 'Edit log entry' : 'Add to the log'} note={gun?.name} submitLabel={entry ? 'Save' : 'Add entry'} busy={busy} error={err} onClose={onClose} onSubmit={submit}>
      <div className="grid2">
        <label className="field">What<select value={f.kind} onChange={set('kind')}>{Object.entries(LOG_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Date<input type="date" value={f.date} onChange={set('date')} required /></label>
        <label className="field wide">Title<input value={f.title} onChange={set('title')} placeholder={f.kind === 'purchase' ? 'e.g. LaRue MBT-2S trigger' : f.kind === 'nfa' ? 'e.g. Form 1 submitted' : f.kind === 'malfunction' ? 'e.g. Failure to feed, mag 2' : f.kind === 'part' ? 'e.g. Swapped in the LaRue MBT-2S' : 'e.g. Zeroed the LPVO'} autoFocus /></label>
        {showAmount && <label className="field">Amount (USD)<input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="0.00" /></label>}
        {f.kind === 'purchase' && <label className="field">Category<select value={f.category} onChange={set('category')}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
        {f.kind === 'purchase' && <label className="field">Vendor<input value={f.vendor} onChange={set('vendor')} placeholder="e.g. Palmetto State Armory" /></label>}
        {showRounds && <label className="field">Rounds<input inputMode="numeric" value={f.rounds} onChange={set('rounds')} placeholder="e.g. 200" /></label>}
        <label className="field wide">Notes<textarea rows={3} value={f.notes} onChange={set('notes')} /></label>
        <label className="field wide">Receipt or document (optional)<input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="hint">Saved in guns/{gun?.id}/receipts/{entry?.receipt ? '. Replaces the current one.' : ''}</span></label>
      </div>
    </Dialog>
  )
}

/* ---------------- track a price ---------------- */
export function TrackDialog({ open, itemKey, defaultLabel, defaultUrl, onClose }: { open: boolean; itemKey: string; defaultLabel: string; defaultUrl: string; onClose: () => void }) {
  const [f, setF] = useState({ label: defaultLabel, url: defaultUrl, target: '' })
  const [err, setErr] = useState<string | null>(null)
  const add = useAction(api.addTracked, [['tracked'], ['analytics']])
  useEffect(() => { if (open) { setF({ label: defaultLabel, url: defaultUrl, target: '' }); setErr(null) } }, [open, defaultLabel, defaultUrl])
  const submit = async () => {
    setErr(null)
    const target = f.target === '' ? null : Number(f.target)
    if (target != null && (Number.isNaN(target) || target < 0)) { setErr('Enter the alert price as a number.'); return }
    try {
      const r = await add.mutateAsync({ item_key: itemKey, label: f.label, url: f.url.trim(), target_price: target })
      if (!r.ok && r.error) { setErr(`Saved, but the first check failed: ${r.error}`); return }
      onClose()
    } catch (e) { setErr(msg(e)) }
  }
  return (
    <Dialog open={open} title="Track a price" note="The page is re-checked on the schedule in Settings, and every check is kept for the price history." submitLabel="Start tracking" busy={add.isPending} error={err} onClose={onClose} onSubmit={submit}>
      <div className="grid2">
        <label className="field wide">Name<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} autoFocus /></label>
        <label className="field wide">Product page<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></label>
        <label className="field">Alert me at or below (USD)<input inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="optional" /></label>
      </div>
    </Dialog>
  )
}
