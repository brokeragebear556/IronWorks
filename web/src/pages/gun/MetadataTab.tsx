import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api'
import { RefreshButton } from '../../components/RefreshButton'
import { money, shortDate, specLabel } from '../../lib/format'
import type { Item, LookupResult } from '../../types'
import { errMsg } from './shared'

const PROVIDER_NAMES: Record<string, string> = { local_files: 'Local files', product_page: 'Product page', wikidata: 'Wikidata' }

/** Jellyfin-style "Identify": run the enabled providers, review what they found, apply what you want. */
export function MetadataTab({ item }: { item: Item }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [results, setResults] = useState<LookupResult[] | null>(null)
  const { data: history } = useQuery({ queryKey: ['identify-history', item.key], queryFn: () => api.identifyHistory(item.key) })
  const shown = results ?? []

  const run = async () => {
    setErr(null); setBusy(true)
    try {
      setResults(await api.identify(item.key, url.trim() || undefined))
      qc.invalidateQueries({ queryKey: ['identify-history', item.key] })
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  const [dragOver, setDragOver] = useState(false)
  const upload = async (file: File) => {
    setErr(null); setBusy(true)
    try {
      setResults(await api.identifyUpload(item.key, file))
      qc.invalidateQueries({ queryKey: ['identify-history', item.key] })
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <>
      <div>
        <h3 className="section-title">Refresh</h3>
        <p className="note" style={{ marginBottom: 8 }}>Re-checks every source and saves the latest price, plus any specs this {item.kind} doesn't have yet. Your own values are kept.</p>
        <RefreshButton itemKey={item.key} />
      </div>
      <div>
        <h3 className="section-title">Look up details</h3>
        <p className="note" style={{ marginBottom: 8 }}>
          Runs the metadata providers turned on in <Link to="/settings/providers">Settings</Link>: your saved pages and PDFs,
          any product page linked to this {item.kind}{item.kind === 'gun' ? ', and Wikidata (free model facts, no prices)' : ''}. Paste another product page to check it too. Nothing changes until you apply it.
        </p>
        <div className="row-actions">
          <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Optional: https://… product page" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Product page address" />
          <button type="button" className="btn primary" disabled={busy} onClick={run}>{busy ? 'Looking up…' : 'Look up'}</button>
        </div>
        {err && <p className="error" style={{ marginTop: 6 }}>{err}</p>}
      </div>
      <div>
        <h3 className="section-title">Add from a saved page</h3>
        <p className="note" style={{ marginBottom: 8 }}>
          Many stores block automatic lookups. Open the product page in your browser, press <b>Ctrl+S</b> to save it
          (or download the spec sheet PDF), then drop the file here. Its price, specs and photos are read straight away,
          and the file is kept in your scan folder so Refresh can use it again.
        </p>
        <label className={'drop' + (dragOver ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f) }}>
          <input type="file" accept=".html,.htm,.pdf,text/html,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
          {busy ? 'Reading…' : 'Drop a saved .html page or PDF here, or click to choose one'}
        </label>
      </div>

      {results && shown.length === 0 && <div className="empty">No provider found anything. Save the product page into your scan folder, or paste its address above.</div>}
      {shown.map((r) => <ResultCard key={r.id} item={item} r={r} />)}

      {(item.data.links?.length ?? 0) > 0 && (
        <div>
          <h3 className="section-title">Linked product pages</h3>
          <div className="rows">{item.data.links!.map((l) => <div key={l.url} className="rowi"><span className="k">{l.label ?? 'Page'}</span><a className="v" href={l.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{l.url}</a><span /></div>)}</div>
        </div>
      )}
      {(item.data.sources?.length ?? 0) > 0 && (
        <div>
          <h3 className="section-title">Saved files</h3>
          <div className="rows">{item.data.sources!.map((s) => <div key={s} className="rowi"><span className="k">File</span><span className="v mono" style={{ fontSize: 12 }}>{s}</span><span /></div>)}</div>
        </div>
      )}
      {!results && history && history.length > 0 && (
        <div>
          <h3 className="section-title">Earlier lookups <span>{history.length}</span></h3>
          {history.slice(0, 6).map((r) => <ResultCard key={r.id} item={item} r={r} compact />)}
        </div>
      )}
    </>
  )
}

function ResultCard({ item, r, compact }: { item: Item; r: LookupResult; compact?: boolean }) {
  const qc = useQueryClient()
  const d = r.data
  const [fields, setFields] = useState<Set<string>>(new Set(['brand', 'sku', 'price', ...(r.provider === 'local_files' ? ['source'] : ['url'])]))
  const [specs, setSpecs] = useState<Set<string>>(() => new Set(Object.keys(d?.specs ?? {}).filter((k) => !(item.data.specs ?? {})[k])))
  const [imgs, setImgs] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('full')
  const [open, setOpen] = useState(!compact)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toggle = (set: Set<string>, fn: (s: Set<string>) => void, k: string) => {
    const n = new Set(set)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    fn(n)
  }

  const apply = async () => {
    setErr(null); setMsg(null); setBusy(true)
    try {
      const res = await api.applyMetadata({ key: item.key, resultId: r.id, fields: [...fields], specs: [...specs], images: [...imgs], imageTarget: target })
      await qc.invalidateQueries({ queryKey: ['library'] })
      setMsg(`Applied.${res.photos.length ? ` Saved ${res.photos.length} photo${res.photos.length > 1 ? 's' : ''}.` : ''}`)
      setImgs(new Set())
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  const fieldRows: [string, string, string | null][] = d ? [
    ['brand', 'Brand', d.brand], ['sku', 'SKU', d.sku], ['price', 'List price', d.price != null ? money(d.price) + (d.inStock == null ? '' : d.inStock ? ' (in stock)' : ' (out of stock)') : null],
    ['url', 'Link the product page', r.provider === 'product_page' ? d.url : null], ['source', 'Link this saved file', r.provider === 'local_files' ? r.source : null],
    ['name', 'Rename to', d.name],
  ] : []

  return (
    <div className="card result">
      <div className="result-head">
        <span className="pill brass">{PROVIDER_NAMES[r.provider] ?? r.provider}</span>
        {r.provider === 'wikidata' && d?.url
          ? <a className="src" href={d.url} target="_blank" rel="noreferrer">{r.source}</a>
          : <span className="src">{r.source}</span>}
        {r.confidence < 1 && <span className="pill">match {Math.round(r.confidence * 100)}%</span>}
        <span className="note">{shortDate(r.fetchedAt)}</span>
        {compact && <button type="button" className="btn small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Review'}</button>}
      </div>
      {r.error && <p className="error">{r.error}</p>}
      {d && open && <>
        {d.name && <b>{d.name}</b>}
        {r.provider === 'wikidata' && <p className="note">{d.specLines.map(([, v]) => v).join(' · ')}{d.specLines.length ? ' · ' : ''}Facts about the model in general; check them against your own gun.</p>}
        <div className="opt-list">
          {fieldRows.filter(([, , v]) => v).map(([k, label, v]) => (
            <label key={k}><input type="checkbox" checked={fields.has(k)} onChange={() => toggle(fields, setFields, k)} /><span><span className="note">{label}:</span> {v}</span></label>
          ))}
        </div>
        {Object.keys(d.specs).length > 0 && <>
          <h3 className="section-title" style={{ marginTop: 4 }}>Specs found <span>tick to save</span></h3>
          <div className="opt-list">
            {Object.entries(d.specs).map(([k, v]) => (
              <label key={k}><input type="checkbox" checked={specs.has(k)} onChange={() => toggle(specs, setSpecs, k)} />
                <span><span className="note">{specLabel(k)}:</span> {v}{(item.data.specs ?? {})[k] && String((item.data.specs ?? {})[k]) !== v ? <span className="note"> (now: {String((item.data.specs ?? {})[k])})</span> : null}</span></label>
            ))}
          </div>
        </>}
        {d.images.length > 0 && <>
          <h3 className="section-title" style={{ marginTop: 4 }}>Photos <span>tick to save a copy</span></h3>
          <div className="thumb-picks">
            {d.images.map((u) => (
              <label key={u} className={'thumb-pick' + (imgs.has(u) ? ' on' : '')}>
                <input type="checkbox" checked={imgs.has(u)} onChange={() => toggle(imgs, setImgs, u)} aria-label="Save this photo" />
                <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </label>
            ))}
          </div>
          {item.kind === 'gun' && imgs.size > 0 && (
            <label className="field" style={{ maxWidth: 220 }}>Save photos as
              <select value={target} onChange={(e) => setTarget(e.target.value)}><option value="full">Full gun</option><option value="lower">Lower</option><option value="upper">Upper</option></select>
            </label>
          )}
        </>}
        <div className="row-actions">
          <button type="button" className="btn primary" disabled={busy || (!fields.size && !specs.size && !imgs.size)} onClick={apply}>{busy ? 'Applying…' : 'Apply selected'}</button>
          {msg && <span className="note">{msg}</span>}
        </div>
        {err && <p className="error">{err}</p>}
      </>}
    </div>
  )
}
