import { useEffect, useMemo, useState } from 'react'
import { money } from '../lib/format'
import { Dialog } from './Dialog'

export interface PickItem { id: string; n: string; p?: number; w?: number; chips: string[] }
export interface Picked { id: string | null; name: string; price: number | null; listPrice: number | null; status: 'owned' | 'planned' }

const SORTS: [string, string][] = [['pop', 'Catalog order'], ['p', 'Price: low to high'], ['-p', 'Price: high to low'], ['w', 'Weight: light first'], ['n', 'Name']]

function sortBy(arr: PickItem[], k: string) {
  const a = [...arr]
  if (k === 'p') a.sort((x, y) => (x.p ?? 1e9) - (y.p ?? 1e9))
  if (k === '-p') a.sort((x, y) => (y.p ?? -1) - (x.p ?? -1))
  if (k === 'w') a.sort((x, y) => (x.w ?? 1e9) - (y.w ?? 1e9))
  if (k === 'n') a.sort((x, y) => x.n.localeCompare(y.n))
  return a
}

interface Props {
  open: boolean
  title: string
  note?: React.ReactNode
  items: PickItem[]
  /** Parts that don't normally fit, shown only when asked for. */
  others?: PickItem[]
  othersLabel?: string
  current?: string | null
  defaultStatus?: 'owned' | 'planned'
  /** Extra controls (type selector, etc.) above the list. */
  header?: React.ReactNode
  submitLabel?: string
  busy?: boolean
  error?: string | null
  onClose: () => void
  onPick: (p: Picked) => void
}

/** Search the parts catalog, sort by price or weight, and choose a part, or type one that isn't listed. */
export function CatalogPicker({ open, title, note, items, others, othersLabel, current, defaultStatus = 'planned', header, submitLabel = 'Use this part', busy, error, onClose, onPick }: Props) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('pop')
  const [showOthers, setShowOthers] = useState(false)
  const [pick, setPick] = useState<string | null>(current ?? null)
  const [custom, setCustom] = useState({ name: '', price: '' })
  const [status, setStatus] = useState(defaultStatus)
  const [price, setPrice] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (open) { setQ(''); setSort('pop'); setShowOthers(false); setPick(current ?? null); setCustom({ name: '', price: '' }); setStatus(defaultStatus); setPrice(''); setErr(null) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pool = showOthers && others ? others : items
  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return sortBy(pool.filter((it) => terms.every((t) => (it.n + ' ' + it.chips.join(' ')).toLowerCase().includes(t))), sort)
  }, [pool, q, sort])
  const shown = list.slice(0, 160)
  const chosen = pick ? [...items, ...(others ?? [])].find((i) => i.id === pick) : undefined

  const submit = (direct?: typeof chosen) => {
    setErr(null)
    const num = (t: string) => { const s = t.trim().replace(/[$,]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : undefined }
    if (direct) {
      const p = num(price)
      if (p === undefined) { setErr('Enter the price as a number, like 89.99.'); return }
      onPick({ id: direct.id, name: direct.n, price: p, listPrice: direct.p ?? null, status })
      return
    }
    if (custom.name.trim()) {
      const p = num(custom.price)
      if (p === undefined) { setErr('Enter the price as a number, like 89.99.'); return }
      onPick({ id: null, name: custom.name.trim(), price: p, listPrice: null, status })
      return
    }
    if (!chosen) { setErr('Choose a part from the list, or type one that isn\'t listed.'); return }
    const p = num(price)
    if (p === undefined) { setErr('Enter the price as a number, like 89.99.'); return }
    onPick({ id: chosen.id, name: chosen.n, price: p, listPrice: chosen.p ?? null, status })
  }

  return (
    <Dialog open={open} title={title} note={note} submitLabel={submitLabel} busy={busy} error={err ?? error ?? null} onClose={onClose} onSubmit={() => submit()} wide>
      {header}
      <div className="picker-bar">
        <input className="input" type="search" placeholder="Search by name, brand, thread…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} aria-label="Search the catalog" autoFocus />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      {others && others.length > 0 && (
        <label className="check" style={{ margin: '6px 0' }}><input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} /> {othersLabel ?? 'Show parts for other platforms'}</label>
      )}
      <div className="picker-list" role="listbox" aria-label="Catalog parts">
        {shown.length === 0 && <p className="note" style={{ padding: 10 }}>Nothing matches. Try fewer words, or type the part below.</p>}
        {shown.map((it) => (
          <button key={it.id} type="button" role="option" aria-selected={pick === it.id} className="pick-item" onClick={() => { setPick(it.id); setCustom({ name: '', price: '' }) }} onDoubleClick={() => { if (!busy) submit(it) }} title="Double-click to use this part">
            <span className="pn">{it.n}{it.id === current && <span className="pill" style={{ marginLeft: 6 }}>current</span>}</span>
            <span className="pc">{it.chips.map((c) => <span key={c} className="pill">{c}</span>)}</span>
            <span className="pp num">{it.p != null ? money(it.p) : '—'}{it.w ? <span className="note">{it.w} oz</span> : null}</span>
          </button>
        ))}
        {list.length > shown.length && <p className="note" style={{ padding: 8 }}>{list.length - shown.length} more. Search to narrow the list.</p>}
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value as 'owned' | 'planned')}><option value="planned">Planned to buy</option><option value="owned">Owned</option></select></label>
        <label className="field">Your price (USD)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={chosen?.p != null ? `catalog ${money(chosen.p)}` : 'optional'} disabled={!!custom.name.trim()} /></label>
        <label className="field">Or type a part that isn't listed<input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="e.g. Geissele SSA-E X" /></label>
        <label className="field">Its price (USD)<input inputMode="decimal" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} placeholder="optional" disabled={!custom.name.trim()} /></label>
      </div>
    </Dialog>
  )
}
