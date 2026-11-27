import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api, useAnalytics, useCatalog, useLibrary, usePartsCatalog } from '../api'
import { toEngine } from '../three/engine/assemble'
import type { Cat } from '../three/engine/data'
import { buildThumbnail } from '../three/engine/thumb'
import { AddGunDialog } from '../components/dialogs'
import { RefreshButton } from '../components/RefreshButton'
import { count, coverPhoto, money } from '../lib/format'
import { usePref } from '../lib/prefs'
import { modelThumbnail } from '../three/thumbnail'
import type { Catalog, Gun } from '../types'

type CardImage = 'photo' | 'model' | 'model-att'
const CARD_IMAGES: [CardImage, string][] = [['photo', 'Product photo'], ['model', '3D model'], ['model-att', '3D model with attachments']]

/** Renders 3D thumbnails after the cards are on screen, so the page never waits on WebGL. */
function useModelThumbs(guns: Gun[] | undefined, catalog: Catalog | undefined, cat: Cat | undefined, mode: CardImage) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  useEffect(() => {
    if (!guns || !catalog || !cat) return
    // In photo mode, guns without a photo (like the demo guns) show their 3D model instead.
    const todo = mode === 'photo' ? guns.filter((g) => !coverPhoto(g)) : guns
    if (!todo.length) return
    let cancelled = false
    const run = async () => {
      for (const g of todo) {
        await new Promise((r) => requestAnimationFrame(r))
        if (cancelled) return
        let url: string | null = null
        try {
          const eg = toEngine(g, cat), att = mode !== 'model'
          url = eg ? buildThumbnail(eg, cat, att) : modelThumbnail(g, catalog, att)
        } catch (e) { console.error(e) }
        setThumbs((t) => ({ ...t, [`${g.id}|${mode}`]: url }))
      }
    }
    run()
    return () => { cancelled = true }
  }, [guns, catalog, cat, mode])
  return (g: Gun) => thumbs[`${g.id}|${mode}`]
}

/** Home: every gun as a card, like a media library. */
export function LibraryPage() {
  const { data: lib, isLoading, error } = useLibrary()
  const { data: catalog } = useCatalog()
  const { data: stats } = useAnalytics()
  const { data: cat } = usePartsCatalog()
  const [adding, setAdding] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const qc = useQueryClient()
  const [prefs, setPrefs] = usePref<{ cardImage: CardImage }>('library', { cardImage: 'photo' })
  const navigate = useNavigate()
  const thumb = useModelThumbs(lib?.guns, catalog, cat, prefs.cardImage)
  const spent = new Map(stats?.money.byGun.map((g) => [g.id, g.spent]))
  const rounds = new Map(stats?.usage.byGun.map((g) => [g.id, g]))

  const image = (g: Gun) => {
    if (prefs.cardImage === 'photo') {
      const p = coverPhoto(g)
      if (p) return { src: p, model: false }
    }
    const t = thumb(g)
    if (t === undefined) return { src: '', model: true, loading: true }
    return t ? { src: t, model: true } : null
  }

  return (
    <div className="page-pad">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <p>{lib ? `${lib.guns.length} guns · ${lib.guns.reduce((s, g) => s + g.parts.length, 0)} parts · ${lib.guns.reduce((s, g) => s + g.attachments.length, 0)} attachments` : ' '}</p>
          {lib && (() => {
            const owned = lib.guns.reduce((s, g) => s + g.pricing.owned, 0)
            const planned = lib.guns.reduce((s, g) => s + g.pricing.planned, 0)
            const missing = lib.guns.reduce((s, g) => s + g.pricing.missing, 0)
            return (
              <div className="lib-totals">
                <span>Owned <b>{money(owned)}</b></span>
                <span>Planned <b>{money(planned)}</b></span>
                <span>Total <b>{money(owned + planned)}</b></span>
                {missing > 0 && <span className="pill warn" title="Open a gun's Overview to add the missing prices">{missing} item{missing > 1 ? 's' : ''} without a price</span>}
              </div>
            )
          })()}
        </div>
        <div className="row-actions" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ minWidth: 220 }}>Card image
            <select className="input" value={prefs.cardImage} onChange={(e) => setPrefs({ cardImage: e.target.value as CardImage })}>
              {CARD_IMAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button type="button" className="btn primary" style={{ marginTop: 20 }} onClick={() => setAdding(true)} disabled={!cat}>+ Add gun</button>
        </div>
      </div>
      <div className="card card-pad lib-tools" style={{ marginBottom: 14 }}>
        <div>
          <RefreshButton label="Refresh all metadata" />
          <p className="note" style={{ marginTop: 6 }}>Checks every gun and part against your saved pages and linked product pages, saves the latest prices and fills in missing specs.</p>
        </div>
        <div>
          <div className="row-actions">
            <a className="btn" href="/api/export.json" download>Export collection (.json)</a>
            <a className="btn" href="/api/export.csv" download>Export inventory (.csv)</a>
            <label className="btn" style={{ cursor: 'pointer' }}>Import (.json)
              <input type="file" accept="application/json,.json" hidden onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                setImportMsg(null)
                try {
                  const r = await api.importCollection(await f.text())
                  await Promise.all(['library', 'analytics', 'logs', 'values'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
                  setImportMsg({ ok: true, text: `Added ${r.created.length} gun${r.created.length === 1 ? '' : 's'}${r.logs ? ` and ${r.logs} log entries` : ''}. Nothing already here was changed.` })
                } catch (err) { setImportMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }) }
              }} />
            </label>
          </div>
          <p className="note" style={{ marginTop: 6 }}>The export has every gun, build, attachment, record and log entry. Photos and receipts stay in the <code>guns</code> folder. Importing adds the guns as new ones.</p>
          {importMsg && <p className={importMsg.ok ? 'note' : 'error'} role="status">{importMsg.text}</p>}
        </div>
      </div>
      {isLoading && <p className="note">Loading library…</p>}
      {error && <p className="error">{(error as Error).message}</p>}
      {lib && lib.guns.length === 0 && <div className="empty">No guns yet. Add one, or copy a folder into <code>guns/</code> and reload.</div>}
      <div className="lib-grid">
        {lib?.guns.map((g) => {
          const img = image(g)
          const u = rounds.get(g.id)
          const pr = g.pricing
          const extras = pr.lines.filter((l) => l.kind === 'part' || l.kind === 'upgrade' || l.kind === 'attachment').reduce((s, l) => s + (l.price ?? 0), 0)
          return (
            <Link key={g.id} to={`/gun/${g.id}`} className="card gun-card">
              <div className={'thumb' + (img?.model ? ' model' : '') + (img && img.src ? '' : ' none')}>
                {img?.src ? <img src={img.src} alt="" loading="lazy" /> : img && 'loading' in img ? 'Rendering…' : prefs.cardImage === 'photo' ? 'No photo yet' : 'No 3D model'}
              </div>
              <div className="body">
                <span className="title">{g.name}</span>
                <span className="sub">{g.short}</span>
                <span className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className={'pill ' + (pr.status === 'planned' ? 'planned' : 'ok')}>{pr.status === 'planned' ? 'Planned' : 'Owned'}</span>
                  <span style={{ textAlign: 'right' }}>
                    <b className="num" style={{ fontSize: 17 }}>{money(pr.total)}</b>
                    <span className="note" style={{ display: 'block' }}>
                      {extras > 0 ? `incl. ${money(extras)} parts & attachments` : 'gun only'}
                      {pr.planned > 0 && pr.owned > 0 ? ` · ${money(pr.planned)} planned` : ''}
                      {pr.missing > 0 ? ` · ${pr.missing} unpriced` : ''}
                    </span>
                  </span>
                </span>
                <span className="stats">
                  {spent.get(g.id) ? <span className="pill brass">{money(spent.get(g.id)!, true)} spent</span> : null}
                  {u?.rounds ? <span className="pill">{count(u.rounds)} rounds</span> : null}
                  {u?.cleaningDue && <span className="pill warn">Cleaning due</span>}
                  {g.parts.length > 0 && <span className="pill">{g.parts.length} part{g.parts.length > 1 ? 's' : ''}</span>}
                  {g.attachments.length > 0 && <span className="pill">{g.attachments.length} attachment{g.attachments.length > 1 ? 's' : ''}</span>}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
      {cat && <AddGunDialog open={adding} cat={cat} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); navigate(`/gun/${id}`) }} />}
    </div>
  )
}
