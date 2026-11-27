import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, useParams } from 'react-router'
import { api, useSettings } from '../api'
import type { ProviderInfo, Settings } from '../types'

const SECTIONS = [
  ['general', 'General'],
  ['network', 'Network'],
  ['providers', 'Metadata providers'],
  ['library', 'Library scan'],
  ['prices', 'Price tracking'],
  ['experimental', 'Experimental'],
] as const

function useSave() {
  const qc = useQueryClient()
  const [state, setState] = useState<{ busy: boolean; msg: string | null; err: string | null }>({ busy: false, msg: null, err: null })
  const save = async (s: Partial<Settings>, msg = 'Saved.') => {
    setState({ busy: true, msg: null, err: null })
    try {
      const next = await api.saveSettings(s)
      qc.setQueryData(['settings'], next)
      await qc.invalidateQueries({ queryKey: ['providers'] })
      await qc.invalidateQueries({ queryKey: ['analytics'] })
      setState({ busy: false, msg, err: null })
    } catch (e) {
      setState({ busy: false, msg: null, err: e instanceof Error ? e.message : String(e) })
    }
  }
  const setErr = (err: string) => setState({ busy: false, msg: null, err })
  return { ...state, save, setErr }
}

const Status = ({ msg, err }: { msg: string | null; err: string | null }) => (
  <>{msg && <span className="note">{msg}</span>}{err && <p className="error">{err}</p>}</>
)

export function SettingsPage() {
  const { section = 'general' } = useParams()
  const { data: settings } = useSettings()
  if (!SECTIONS.some(([id]) => id === section)) return <Navigate to="/settings" replace />
  return (
    <div className="page-pad">
      <div className="page-head"><div><h1>Settings</h1><p>Saved on this computer in <code>data/ironworks.db</code>.</p></div></div>
      <div className="settings">
        <nav aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <NavLink key={id} to={id === 'general' ? '/settings' : `/settings/${id}`} end className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}
        </nav>
        {settings && (
          <section>
            {section === 'general' && <General s={settings} />}
            {section === 'network' && <Network s={settings} />}
            {section === 'providers' && <Providers s={settings} />}
            {section === 'library' && <LibraryScan s={settings} />}
            {section === 'prices' && <Prices s={settings} />}
            {section === 'experimental' && <Experimental s={settings} />}
          </section>
        )}
      </div>
    </div>
  )
}

function General({ s }: { s: Settings }) {
  const [rounds, setRounds] = useState(String(s.maintenanceRounds))
  const st = useSave()
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 className="section-title">Maintenance</h2>
      <label className="field" style={{ maxWidth: 260 }}>Clean every (rounds)
        <input inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
        <span className="hint">The default for every gun. Set a different interval for one gun in its Log tab.</span>
      </label>
      <label className="field" style={{ maxWidth: 260 }}>Units
        <select className="input" value={s.units ?? 'in'} disabled={st.busy} onChange={(e) => st.save({ units: e.target.value as Settings['units'] })}>
          <option value="in">Inches and pounds</option><option value="mm">Millimetres and kilograms</option>
        </select>
        <span className="hint">Used for every length and weight: the model, Specs, Checks, Build and Records.</span>
      </label>
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={st.busy} onClick={() => {
          const n = Math.round(Number(rounds))
          if (!Number.isFinite(n) || n < 1) { setRounds(String(s.maintenanceRounds)); return }
          st.save({ maintenanceRounds: n })
        }}>Save</button>
        <Status msg={st.msg} err={st.err} />
      </div>
    </div>
  )
}

function WikidataContact({ s }: { s: Settings }) {
  const [v, setV] = useState(s.wikidataContact ?? '')
  const st = useSave()
  return (
    <div style={{ marginTop: 8 }}>
      <label className="field" style={{ maxWidth: 420 }}>Your contact for Wikidata
        <div className="row-actions" style={{ marginTop: 0 }}>
          <input className="input" style={{ flex: 1 }} placeholder="you@example.com or https://…" value={v} onChange={(e) => setV(e.target.value)} />
          <button type="button" className="btn" disabled={st.busy || v.trim() === (s.wikidataContact ?? '')} onClick={() => st.save({ wikidataContact: v.trim() })}>Save</button>
        </div>
        <span className="hint">
          Wikidata refuses lookups from apps that don't say how to reach whoever runs them. This is sent only to Wikidata,
          with each lookup, and stays in your local settings (never in exports or the repo).
          {!s.wikidataContact && <b> Needed before Wikidata lookups work.</b>}
        </span>
      </label>
      <Status msg={st.msg} err={st.err} />
    </div>
  )
}

function Providers({ s }: { s: Settings }) {
  const { data: infos } = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const [list, setList] = useState(s.providers)
  useEffect(() => setList(s.providers), [s.providers])
  const st = useSave()
  const info = (id: string): ProviderInfo | undefined => infos?.find((p) => p.id === id)
  const move = (i: number, d: number) => setList((l) => { const n = [...l]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n })
  const dirty = JSON.stringify(list) !== JSON.stringify(s.providers)
  return (
    <>
      <p className="note">Providers run in this order when you use <b>Look up</b> on a gun or part. Each one finds details from a different source; you choose what to apply.</p>
      {list.map((p, i) => (
        <div className="card provider" key={p.id}>
          <div className="order">
            <button type="button" className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
            <button type="button" className="btn small" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
          </div>
          <div><b>{info(p.id)?.name ?? p.id}</b><p className="note">{info(p.id)?.description}</p>{p.id === 'wikidata' && <WikidataContact s={s} />}</div>
          <label className="toggle"><input type="checkbox" aria-label={`Use ${info(p.id)?.name ?? p.id}`} checked={p.enabled} onChange={(e) => setList((l) => l.map((x) => (x.id === p.id ? { ...x, enabled: e.target.checked } : x)))} />{p.enabled ? 'On' : 'Off'}</label>
        </div>
      ))}
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={!dirty || st.busy} onClick={() => st.save({ providers: list })}>Save providers</button>
        <Status msg={st.msg} err={st.err} />
      </div>
      <div className="card card-pad">
        <h2 className="section-title">Price tracking</h2>
        <p className="note">Uses the product page reader on a schedule. Its settings are under Price tracking.</p>
      </div>
    </>
  )
}

function LibraryScan({ s }: { s: Settings }) {
  const [folder, setFolder] = useState(s.scanFolder)
  const st = useSave()
  const { data, refetch, isFetching } = useQuery({ queryKey: ['unmatched'], queryFn: api.unmatched })
  return (
    <>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className="section-title">Scan folder</h2>
        <label className="field">Folder with saved product pages and PDFs
          <input value={folder} onChange={(e) => setFolder(e.target.value)} />
          <span className="hint">The Local files provider reads .html and .pdf files here. Save a product page from your browser (Ctrl+S) into this folder to add it.</span>
        </label>
        <div className="row-actions">
          <button type="button" className="btn primary" disabled={st.busy || folder === s.scanFolder} onClick={async () => { await st.save({ scanFolder: folder }); refetch() }}>Save folder</button>
          <Status msg={st.msg} err={st.err} />
        </div>
      </div>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="section-title">Files not linked to any gun <span><button type="button" className="btn small" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Scanning…' : 'Scan now'}</button></span></h2>
        {data && data.files.length === 0 && <p className="note">Every saved page and PDF in {data.folder} is linked to a gun or part.</p>}
        {data && data.files.length > 0 && (
          <>
            <p className="note">Open the gun these belong to and use Metadata → Look up; tick "Link this saved file" to attach one.</p>
            <div className="rows">{data.files.map((f) => <div className="rowi" key={f}><span className="k">File</span><span className="v mono" style={{ fontSize: 12 }}>{f}</span><span /></div>)}</div>
          </>
        )}
      </div>
    </>
  )
}

function Prices({ s }: { s: Settings }) {
  const [enabled, setEnabled] = useState(s.priceTracking.enabled)
  const [hours, setHours] = useState(String(s.priceTracking.intervalHours))
  const st = useSave()
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 className="section-title">Automatic checks</h2>
      <label className="toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Re-check tracked prices automatically while the workbench is running</label>
      <label className="field" style={{ maxWidth: 260 }}>Check every (hours)
        <input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
        <span className="hint">Each tracked page is fetched at most this often. 24 hours is polite to the stores.</span>
      </label>
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={st.busy} onClick={() => {
          const h = Math.round(Number(hours))
          if (!Number.isFinite(h) || h < 1) { setHours(String(s.priceTracking.intervalHours)); return }
          st.save({ priceTracking: { enabled, intervalHours: h } })
        }}>Save</button>
        <Status msg={st.msg} err={st.err} />
      </div>
      <p className="note">Some stores block automated requests. When a check fails, the reason shows on the tracked item, and you can save the page into your scan folder instead.</p>
    </div>
  )
}

function Experimental({ s }: { s: Settings }) {
  const st = useSave()
  return (
    <>
      <p className="note">Features that work but aren't finished. Turn them on to try them.</p>
      <div className="card provider" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
        <div>
          <b>Photo on model</b><span className="exp-badge">EXPERIMENTAL</span>
          <p className="note">Adds a Photo button above the 3D model that lays each gun's product photo over the model's side, with Next photo and Mirror photo controls.
            Works best with straight side-on photos on a plain background. Angled handgun photos are skipped.</p>
        </div>
        <label className="toggle"><input type="checkbox" aria-label="Photo on model" checked={s.experimental.photoProjection} disabled={st.busy}
          onChange={(e) => st.save({ experimental: { photoProjection: e.target.checked } }, e.target.checked ? 'Turned on. Use the Photo button above the model.' : 'Turned off.')} />{s.experimental.photoProjection ? 'On' : 'Off'}</label>
      </div>
      <Status msg={st.msg} err={st.err} />
    </>
  )
}

/** Let other devices on your network open Ironworks (like Jellyfin), behind a password. */
function Network({ s }: { s: Settings }) {
  const { data: net, refetch } = useQuery({ queryKey: ['network'], queryFn: api.network })
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const st = useSave()
  const n = s.network
  const savePw = async () => {
    if (pw.length < 8) { st.setErr('Use a password of at least 8 characters.'); return }
    if (pw !== pw2) { st.setErr("The two passwords don't match."); return }
    await st.save({ network: { password: pw } } as unknown as Partial<Settings>, 'Password saved. Anyone signed in on another device has to sign in again.')
    setPw(''); setPw2(''); refetch()
  }
  const setLan = async (lan: boolean) => { await st.save({ network: { lan } } as unknown as Partial<Settings>, lan ? 'Network access is on.' : 'Network access is off.'); refetch() }
  if (net && !net.thisComputer) {
    return <div className="card card-pad"><h2 className="section-title">Network</h2><p className="note">Network access can only be changed on the computer running Ironworks.</p></div>
  }
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 className="section-title">Other devices on your network</h2>
      <p className="note">
        Like Jellyfin: phones, tablets and other computers on the same Wi-Fi or network can open Ironworks in a browser.
        They sign in with a password; this computer never needs it. Anyone signed in can see and change everything, including serial numbers and NFA records,
        so only turn this on for a network you trust. It's never reachable from the internet unless you set that up on your router.
      </p>
      <div className="grid2" style={{ maxWidth: 520 }}>
        <label className="field">{n.hasPassword ? 'New password' : 'Password'}<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field">Repeat it<input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
      </div>
      <div className="row-actions">
        <button type="button" className="btn" disabled={st.busy || !pw} onClick={savePw}>{n.hasPassword ? 'Change password' : 'Set password'}</button>
        {n.hasPassword ? <span className="note">A password is set.</span> : <span className="note">Set a password first.</span>}
      </div>
      <label className="toggle"><input type="checkbox" checked={n.lan} disabled={st.busy || !n.hasPassword} onChange={(e) => setLan(e.target.checked)} />Let other devices on my network open Ironworks</label>
      {net?.restartNeeded && (
        <p className="pill warn" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>
          Restart Ironworks to apply this: close its window (or press Ctrl+C) and start it again.
        </p>
      )}
      {n.lan && net && !net.restartNeeded && (
        <div>
          <p className="note" style={{ marginBottom: 4 }}>Open one of these on the other device:</p>
          {net.addresses.length ? net.addresses.map((a) => <div key={a} className="mono" style={{ fontSize: 15 }}>{a}</div>) : <p className="note">No network address found. Is this computer connected to a network?</p>}
          <p className="note" style={{ marginTop: 6 }}>
            The first time, Windows may ask whether Python can use the network: allow it for <b>private networks</b> only.
            On Linux, if a firewall is on, allow port {net.port} (for example <code>sudo ufw allow {net.port}/tcp</code>).
          </p>
        </div>
      )}
      <Status msg={st.msg} err={st.err} />
    </div>
  )
}
