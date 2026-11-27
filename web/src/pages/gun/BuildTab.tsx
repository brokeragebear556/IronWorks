import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api'
import { CatalogPicker, type PickItem, type Picked } from '../../components/CatalogPicker'
import { money } from '../../lib/format'
import { fromIn, toIn, useUnits } from '../../lib/units'
import { partChips } from '../../three/engine/chips'
import {
  AR_STOCK, CART, enginePlatform, FINN, GASBAND, MUZZLE_STYLES, PLATFORM_NAMES, magPresets, plOK, slotsFor,
  type BuildRow, type Cat, type CatPart, type Cfg, type Platform,
} from '../../three/engine/data'
import type { Gun } from '../../types'
import { errMsg } from './shared'

/** Apply what a catalog part says about the build (barrel length, gas, thread...) to the model settings. */
function applyPatch(g: Gun, cfg: Cfg, p: CatPart): { cfg: Cfg; caliber?: string } {
  const next: Cfg = { ...cfg }
  let caliber: string | undefined
  const c = (p.c ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(c)) { if (k === 'caliber') caliber = String(v); else next[k] = v }
  if (p.s === 'mag' && typeof p.cap === 'number') next.magCap = p.cap
  if (p.s === 'muzzle') {
    next.muzzle = p.id
    if (g.platform === 'pistol' && !next.threaded) { next.threaded = true; next.thread = p.th || '1/2x28' }
  }
  if (p.s === 'pbarrel') { next.threaded = !!p.threaded; next.thread = p.threaded ? '1/2x28' : 'none'; if (!p.threaded) next.muzzle = null }
  if (typeof c.barrel === 'number' && !c.gas && (g.platform === 'ar15' || g.platform === 'ar10') && !g.rimfire) {
    const b = c.barrel, gas = String(next.gas ?? '')
    const ok = GASBAND[gas] && b >= GASBAND[gas][0] && b <= GASBAND[gas][1]
    if (!ok) next.gas = b < 10.3 ? 'pistol' : b < 14 ? 'carbine' : b < 18 ? 'mid' : 'rifle'
  }
  return { cfg: next, caliber }
}

type Opt = [string, string]
interface Knob { key: string; label: string; kind: 'num' | 'sel' | 'bool' | 'range'; opts?: Opt[]; min?: number; max?: number; step?: number; show?: (c: Cfg, g: Gun) => boolean; hint?: string }

const FIN_OPTS: Opt[] = Object.entries(FINN)
const FURN_OPTS: Opt[] = [['black', 'Black'], ['fde', 'FDE'], ['odg', 'OD green'], ['grey', 'Grey'], ['wood', 'Wood']]
const STYLE_OPTS: Opt[] = Object.entries(MUZZLE_STYLES)
const noCatMuzzle = (c: Cfg) => !c.muzzle

function knobs(pf: Platform, g: Gun): Knob[] {
  if (pf === 'ar15' || pf === 'ar10') return [
    { key: 'barrel', label: 'Barrel length (in)', kind: 'num', min: 5, max: 26, step: 0.5 },
    { key: 'gas', label: 'Gas system', kind: 'sel', opts: g.rimfire ? [['none', 'None (blowback)']] : [['pistol', 'Pistol'], ['carbine', 'Carbine'], ['mid', 'Mid-length'], ['rifle', 'Rifle']] },
    { key: 'hg', label: 'Handguard length (in)', kind: 'num', min: 4, max: 20, step: 0.25 },
    { key: 'hgStyle', label: 'Handguard style', kind: 'sel', opts: [['mlok', 'Free-float M-LOK'], ['quad', 'Quad rail'], ['poly', 'Polymer']] },
    { key: 'hgFin', label: 'Handguard finish', kind: 'sel', opts: [['', 'Same as the receiver'], ...FIN_OPTS] },
    { key: 'thread', label: 'Muzzle thread', kind: 'sel', opts: [['1/2x28', '1/2x28'], ['5/8x24', '5/8x24'], ['none', 'Not threaded']] },
    { key: 'muzzleStyle', label: 'Muzzle device shape', kind: 'sel', opts: STYLE_OPTS, show: noCatMuzzle, hint: 'Used when the muzzle device isn\'t picked from the catalog' },
    { key: 'pinned', label: 'Muzzle device pinned & welded', kind: 'bool' },
    { key: 'stock', label: 'Stock', kind: 'sel', opts: Object.entries(AR_STOCK).map(([k, s]) => [k, s.n]) },
    { key: 'stockPos', label: 'Stock position', kind: 'range', min: 0, max: 1, step: 0.2, show: (c) => !!AR_STOCK[c.stock ?? '']?.adj },
    { key: 'tube', label: 'Buffer tube', kind: 'sel', opts: [['carbine', 'Carbine (mil-spec)'], ['rifle', 'Rifle (A2)']] },
    { key: 'ch', label: 'Charging handle', kind: 'sel', opts: [['std', 'Standard latch'], ['ambi', 'Ambidextrous']] },
    { key: 'gasAdj', label: 'Adjustable gas block', kind: 'bool', show: () => !g.rimfire },
    { key: 'finish', label: 'Receiver finish', kind: 'sel', opts: FIN_OPTS },
    { key: 'furn', label: 'Furniture', kind: 'sel', opts: FURN_OPTS.filter(([k]) => k !== 'wood') },
    { key: 'polymer', label: 'Polymer receivers', kind: 'bool', show: () => !!g.rimfire },
  ]
  if (pf === 'ak') return [
    { key: 'barrel', label: 'Barrel length (in)', kind: 'num', min: 6, max: 24, step: 0.1 },
    { key: 'stock', label: 'Stock', kind: 'sel', opts: [['fixed', 'Fixed stock'], ['folder', 'Side folder'], ['brace', 'Brace'], ['none', 'None (pistol)']] },
    { key: 'hgStyle', label: 'Handguard', kind: 'sel', opts: [['poly', 'Polymer'], ['wood', 'Wood'], ['mlok', 'M-LOK aluminum']] },
    { key: 'rail', label: 'Railed dust cover', kind: 'bool' },
    { key: 'thread', label: 'Muzzle thread', kind: 'sel', opts: [['14x1 LH', '14x1 LH'], ['1/2x28', '1/2x28'], ['5/8x24', '5/8x24'], ['none', 'Not threaded']] },
    { key: 'muzzleStyle', label: 'Muzzle device shape', kind: 'sel', opts: STYLE_OPTS, show: noCatMuzzle },
    { key: 'finish', label: 'Receiver finish', kind: 'sel', opts: FIN_OPTS },
    { key: 'furn', label: 'Furniture', kind: 'sel', opts: FURN_OPTS },
  ]
  if (pf === 'mp5') return [
    { key: 'barrel', label: 'Barrel length (in)', kind: 'num', min: 4, max: 17, step: 0.1 },
    { key: 'stock', label: 'Stock / brace', kind: 'sel', opts: [['brace', 'Collapsing brace'], ['sl', 'Magpul SL stock'], ['none', 'End cap only']] },
    { key: 'stockPos', label: 'Stock position', kind: 'range', min: 0, max: 1, step: 0.25, show: (c) => c.stock !== 'none' },
    { key: 'hgStyle', label: 'Handguard', kind: 'sel', opts: [['slim', 'Slim polymer'], ['mlok', 'M-LOK aluminum']] },
    { key: 'muzzleStyle', label: 'Muzzle device shape', kind: 'sel', opts: STYLE_OPTS, show: noCatMuzzle },
    { key: 'finish', label: 'Receiver finish', kind: 'sel', opts: FIN_OPTS },
    { key: 'furn', label: 'Furniture', kind: 'sel', opts: FURN_OPTS },
  ]
  if (pf === 'pistol') return [
    { key: 'barrel', label: 'Barrel length (in)', kind: 'num', min: 2, max: 7, step: 0.01 },
    { key: 'slide', label: 'Slide length (in)', kind: 'num', min: 5, max: 10, step: 0.01 },
    { key: 'height', label: 'Height (in)', kind: 'num', min: 3.5, max: 7, step: 0.01 },
    { key: 'frame', label: 'Frame', kind: 'sel', opts: [['black', 'Black'], ['fde', 'FDE']] },
    { key: 'metal', label: 'Metal frame', kind: 'bool' },
    { key: 'threaded', label: 'Threaded barrel', kind: 'bool' },
    { key: 'thread', label: 'Muzzle thread', kind: 'sel', opts: [['1/2x28', '1/2x28'], ['M13.5x1 LH', 'M13.5x1 LH']], show: (c) => !!c.threaded },
    { key: 'muzzleStyle', label: 'Muzzle device shape', kind: 'sel', opts: STYLE_OPTS, show: (c) => !!c.threaded && !c.muzzle },
    { key: 'barrelFin', label: 'Barrel finish', kind: 'sel', opts: [['steel', 'Black / stainless'], ['gold', 'Gold (TiN / PVD)']] },
    { key: 'finish', label: 'Slide finish', kind: 'sel', opts: FIN_OPTS },
    { key: 'magCap', label: 'Magazine capacity', kind: 'num', min: 1, max: 50, step: 1 },
  ]
  return [
    { key: 'barrel', label: 'Barrel length (in)', kind: 'num', min: 10, max: 32, step: 0.5 },
    { key: 'tube', label: 'Tube capacity (rounds)', kind: 'num', min: 2, max: 12, step: 1 },
    { key: 'finish', label: 'Receiver finish', kind: 'sel', opts: FIN_OPTS },
    { key: 'furn', label: 'Furniture', kind: 'sel', opts: FURN_OPTS },
  ]
}

function NumField({ label, value, min, max, step, onCommit, disabled }: { label: string; value: number | undefined; min?: number; max?: number; step?: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [t, setT] = useState(value != null ? String(value) : '')
  const [bad, setBad] = useState(false)
  useEffect(() => { setT(value != null ? String(value) : ''); setBad(false) }, [value])
  const commit = () => {
    const n = Number(t)
    if (!t.trim() || !Number.isFinite(n) || (min != null && n < min) || (max != null && n > max)) { setBad(true); return }
    setBad(false)
    if (n !== value) onCommit(n)
  }
  return (
    <label className="field">{label}
      <input className="input num" inputMode="decimal" type="number" min={min} max={max} step={step} value={t} aria-invalid={bad} disabled={disabled}
        onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }} />
      {bad && <span className="hint" style={{ color: 'var(--bad)' }}>Between {min} and {max}</span>}
    </label>
  )
}

/** Magazine choice (10, 20, 30, 40, 45-round sticks and drums, depending on the gun) and how many
 *  rounds are loaded, limited to what that magazine holds. */
function MagPicker({ gun, cfg, busy, onSave, onCap }: { gun: Gun; cfg: Cfg; busy: boolean; onSave: (mag: string, cap: number) => void; onCap: (n: number) => void }) {
  const presets = magPresets({ ...gun, cfg })
  if (!presets.length) return null
  const cur = presets.find((p) => p[0] === cfg.mag) ?? presets.find((p) => p[2] === cfg.magCap) ?? presets[0]
  const limit = cur[2]
  const loaded = Math.min(cfg.magCap ?? limit, limit)
  return <>
    <label className="field">Magazine
      <select className="input" value={cur[0]} disabled={busy} onChange={(e) => { const p = presets.find((x) => x[0] === e.target.value)!; onSave(p[0], p[2]) }}>
        {presets.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      <span className="hint">Changes the magazine on the model and in Operate.</span>
    </label>
    <NumField label={`Rounds loaded (max ${limit})`} value={loaded} min={1} max={limit} step={1} disabled={busy} onCommit={(n) => onCap(Math.round(n))} />
  </>
}

const SOURCE_LABEL ={ factory: 'Factory', part: 'Bought part', upgrade: 'Added' } as const

interface Props {
  gun: Gun
  cat: Cat
  picked: string | null
  present: Set<string>
  onPick: (key: string | null) => void
  onAddPart: () => void
}

/** The build, slot by slot: model settings, every part with where it came from, and a catalog
 *  picker to change any slot. Added parts count toward the gun's price as owned or planned. */
export function BuildTab({ gun, cat, picked, present, onPick, onAddPart }: Props) {
  const qc = useQueryClient()
  const [units] = useUnits()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const pf: Platform = enginePlatform(gun.platform)
  const cfg = gun.cfg ?? {}
  const rows = gun.build ?? []
  const defs = slotsFor(gun.platform, gun.rimfire)

  const save = async (changes: Partial<Gun>) => {
    setErr(null); setBusy(true)
    try { await api.patchGun(gun.id, changes); await Promise.all([qc.invalidateQueries({ queryKey: ['library'] }), qc.invalidateQueries({ queryKey: ['analytics'] })]) }
    catch (e) { setErr(errMsg(e)) }
    finally { setBusy(false) }
  }
  const setCfg = (k: string, v: unknown) => save({ cfg: { ...cfg, [k]: v === '' ? null : v } })
  const rowOf = (s: string): BuildRow => rows.find((r) => r.slot === s) ?? { slot: s, label: defs.find((d) => d[0] === s)?.[1], name: '', source: 'factory' }
  const putRow = (r: BuildRow, extra: Partial<Gun> = {}) => {
    const has = rows.some((x) => x.slot === r.slot)
    const next = has ? rows.map((x) => (x.slot === r.slot ? r : x)) : [...rows, r]
    return save({ build: next, ...extra })
  }

  const choose = async (p: Picked) => {
    if (!slot) return
    const r = rowOf(slot)
    const factory = r.factory ?? (r.source === 'factory' || !r.source ? { name: r.name, ...(r.pid ? { pid: r.pid } : {}) } : undefined)
    const next: BuildRow = { slot, label: r.label ?? defs.find((d) => d[0] === slot)?.[1], name: p.name, pid: p.id, source: 'upgrade', status: p.status, listPrice: p.listPrice, ...(p.price != null ? { price: p.price } : {}), ...(r.note ? { note: r.note } : {}), ...(factory ? { factory } : {}) }
    const extra: Partial<Gun> = {}
    const cp = p.id ? cat.PB[p.id] : undefined
    if (cp) { const patch = applyPatch(gun, cfg, cp); extra.cfg = patch.cfg; if (patch.caliber) extra.caliber = patch.caliber }
    await putRow(next, extra)
    setSlot(null)
    const key = defs.find((d) => d[0] === slot)?.[3]
    if (key) onPick(key)
  }
  const toFactory = (r: BuildRow) => {
    const f = r.factory
    const next: BuildRow = { slot: r.slot, label: r.label, name: f?.name ?? '', source: 'factory', ...(f?.pid ? { pid: f.pid } : {}), ...(r.note ? { note: r.note } : {}), ...(f ? { factory: f } : {}) }
    const extra: Partial<Gun> = r.slot === 'muzzle' ? { cfg: { ...cfg, muzzle: f?.pid ?? null } } : {}
    return putRow(next, extra)
  }
  const setRowStatus = (r: BuildRow, status: 'owned' | 'planned') => putRow({ ...r, status })

  const added = rows.filter((r) => r.source === 'upgrade' && r.name)
  const sum = (st: string) => added.filter((r) => (r.status ?? 'planned') === st).reduce((s, r) => s + (r.price ?? r.listPrice ?? 0), 0)
  const groups: [string, string][] = pf === 'pistol' ? [['upper', 'Slide'], ['lower', 'Frame'], ['furniture', 'Magazine']] : [['upper', 'Upper'], ['lower', 'Lower'], ['furniture', 'Furniture']]
  const cur = slot ? rowOf(slot) : null
  const slotLabel = slot ? defs.find((d) => d[0] === slot)?.[1] ?? slot : ''
  const fitItems = (fit: boolean): PickItem[] => slot ? cat.parts.filter((p) => p.s === slot && plOK(p, gun, true) === fit).map((p) => ({ id: p.id, n: p.n, p: p.p, w: p.w, chips: partChips(p) })) : []
  const items = fitItems(true)

  return (
    <>
      <div className="build-head">
        <div><span className="note">Platform</span><b>{PLATFORM_NAMES[pf] ?? pf}{gun.rimfire ? ' (rimfire)' : ''}</b></div>
        <label className="field">Caliber
          <select className="input" value={gun.caliber ?? ''} disabled={busy} onChange={(e) => save({ caliber: e.target.value })}>
            {[...new Set([gun.caliber ?? '', ...Object.keys(CART)])].filter(Boolean).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="field">Twist<input className="input" defaultValue={gun.twist ?? ''} key={gun.twist} disabled={busy} onBlur={(e) => { if (e.target.value !== (gun.twist ?? '')) save({ twist: e.target.value.trim() }) }} /></label>
      </div>
      {added.length > 0 && (
        <p className="note" style={{ margin: '6px 0 10px' }}>
          Added parts: <b className="num">{money(sum('owned'))}</b> owned · <b className="num">{money(sum('planned'))}</b> planned. They're included in the gun's price.
        </p>
      )}

      <details className="build-cfg" open>
        <summary>Model settings</summary>
        <div className="grid2" style={{ marginTop: 8 }}>
          <MagPicker gun={gun} cfg={cfg} busy={busy} onSave={(mag, magCap) => save({ cfg: { ...cfg, mag, magCap } })} onCap={(n) => setCfg('magCap', n)} />
          {knobs(pf, gun).filter((k) => !k.show || k.show(cfg, gun)).map((k) => {
            const v = cfg[k.key]
            if (k.kind === 'num') {
              const raw = typeof v === 'number' ? v : v != null ? Number(v) : undefined
              if (k.label.includes('(in)') && units === 'mm') {
                const mm = (x: number | undefined) => (x == null ? undefined : fromIn(x, 'mm'))
                return <NumField key={k.key} label={k.label.replace('(in)', '(mm)')} value={mm(raw)} min={mm(k.min)} max={mm(k.max)} step={1} disabled={busy} onCommit={(n) => setCfg(k.key, Math.round(toIn(n, 'mm') * 1000) / 1000)} />
              }
              return <NumField key={k.key} label={k.label} value={raw} min={k.min} max={k.max} step={k.step} disabled={busy} onCommit={(n) => setCfg(k.key, n)} />
            }
            if (k.kind === 'bool') return <label key={k.key} className="check"><input type="checkbox" checked={!!v} disabled={busy} onChange={(e) => setCfg(k.key, e.target.checked)} /> {k.label}</label>
            if (k.kind === 'range') {
              const n = typeof v === 'number' ? v : 0.4
              return <label key={k.key} className="field wide">{k.label}: {Math.round(n / (k.step ?? 0.2)) + 1} of {Math.round(1 / (k.step ?? 0.2)) + 1}
                <input type="range" min={k.min} max={k.max} step={k.step} value={n} disabled={busy} onChange={(e) => setCfg(k.key, Number(e.target.value))} /></label>
            }
            return <label key={k.key} className="field">{k.label}
              <select className="input" value={v == null ? '' : String(v)} disabled={busy} onChange={(e) => setCfg(k.key, e.target.value)}>
                {k.opts!.map(([ov, on]) => <option key={ov} value={ov}>{on}</option>)}
              </select>{k.hint && <span className="hint">{k.hint}</span>}</label>
          })}
        </div>
      </details>

      {groups.map(([grp, title]) => {
        const ds = defs.filter((d) => d[2] === grp)
        if (!ds.length) return null
        return (
          <div key={grp}>
            <h3 className="section-title">{title}</h3>
            <div className="rows">
              {ds.map(([s, label, , key]) => {
                const r = rowOf(s)
                const on = picked === key
                const price = r.price ?? r.listPrice
                return (
                  <div key={s} className={'slot-row' + (on ? ' on' : '')}>
                    <button type="button" className="slot-main" aria-pressed={on} disabled={!present.has(key)} onClick={() => onPick(on ? null : key)} title={present.has(key) ? 'Show it on the model' : undefined}>
                      <span className="k">{label}</span>
                      <span className="v">{r.name || <span className="note">Not recorded</span>}
                        {r.note && <span className="note" style={{ display: 'block' }}>{r.note}</span>}
                        {r.source === 'upgrade' && r.factory?.name && <span className="note" style={{ display: 'block' }}>Replaces: {r.factory.name}</span>}
                      </span>
                    </button>
                    <span className="slot-side">
                      {r.source === 'part' && r.partId
                        ? <Link className="pill" to={`/gun/${gun.id}/part/${r.partId}`}>Bought part ›</Link>
                        : r.source === 'upgrade'
                          ? <>
                              <select className="input mini" aria-label={`Status of ${label}`} value={r.status ?? 'planned'} disabled={busy} onChange={(e) => setRowStatus(r, e.target.value as 'owned' | 'planned')}>
                                <option value="planned">Planned</option><option value="owned">Owned</option>
                              </select>
                              <span className="num mono">{price != null ? money(price) : '—'}</span>
                            </>
                          : r.name ? <span className="pill">{SOURCE_LABEL[r.source ?? 'factory']}</span> : null}
                      <button type="button" className="btn small" disabled={busy} onClick={() => setSlot(s)}>Change</button>
                      {r.source === 'upgrade' && <button type="button" className="btn small ghost" disabled={busy} onClick={() => toFactory(r)}>{r.factory?.name ? 'Undo' : 'Clear'}</button>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {err && <p className="error" style={{ marginTop: 6 }}>{err}</p>}

      <h3 className="section-title">Bought for this gun <span>{gun.parts.length || 'none yet'}</span></h3>
      {gun.parts.length > 0 && (
        <div className="rows">
          {gun.parts.map((p) => (
            <Link key={p.id} className="rowi" to={`/gun/${gun.id}/part/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="k">Part</span><span className="v">{p.name}<br /><span className="note">{p.short}</span></span><span className="mono" style={{ color: 'var(--brass)' }}>Open ›</span>
            </Link>
          ))}
        </div>
      )}
      <div className="row-actions" style={{ marginTop: 8 }}><button type="button" className="btn" onClick={onAddPart}>+ Add a part with photos and receipts</button></div>
      <p className="note" style={{ marginTop: 10 }}>Catalog prices and weights: {cat.src} ({cat.asof}).</p>

      <CatalogPicker open={!!slot} title={`Choose a ${slotLabel.toLowerCase()}`}
        note={`${items.length} options that fit this ${PLATFORM_NAMES[pf] ?? pf}${gun.rimfire ? ' (rimfire)' : ''}. Currently: ${cur?.name || 'not recorded'}.`}
        items={items} others={fitItems(false)} othersLabel="Also show parts for other platforms" current={cur?.pid ?? null}
        defaultStatus="planned" busy={busy} error={err} onClose={() => setSlot(null)} onPick={choose} />
    </>
  )
}
