import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BuildSheetDialog } from '../components/BuildSheetDialog'
import { Dialog } from '../components/Dialog'
import { HudGroup, HudMenu } from '../components/HudMenu'
import { buildSheet } from '../lib/buildSheet'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, useCatalog, useLibrary, useLogs, usePartsCatalog, useSettings, useTracked } from '../api'
import { BuildViewer } from '../components/BuildViewer'
import { AddAttachmentDialog, AddGunDialog, AddPartDialog } from '../components/dialogs'
import { Tree, type TreeSelection } from '../components/Tree'
import { Viewer3D } from '../components/Viewer3D'
import { findItem, viewName } from '../lib/format'
import { usePref } from '../lib/prefs'
import { toEngine } from '../three/engine/assemble'
import { slotsFor, type Mode } from '../three/engine/data'
import type { Specs, Units } from '../three/engine/specs'
import type { CamPreset, OpView, Stage, StageOpts } from '../three/engine/stage'
import { OperateDock } from '../components/OperateDock'
import { SpecsTab } from './gun/SpecsTab'
import { gunStats } from '../three/engine/stats'
import { ChecksTab } from './gun/ChecksTab'
import { RecordsTab } from './gun/RecordsTab'
import { roundStats } from '../lib/rounds'
import { nfaClass as classify, runChecks } from '../three/engine/checks'
import type { Built } from '../three/engine/assemble'
import { useUnits } from '../lib/units'
import { PART_NAMES } from '../three/models'
import type { Looks, SceneInput, SkinGroup } from '../three/viewer'
import type { Gun, View } from '../types'
import { AttachmentsTab } from './gun/AttachmentsTab'
import { BuildTab } from './gun/BuildTab'
import { LogTab } from './gun/LogTab'
import { MetadataTab } from './gun/MetadataTab'
import { OverviewTab } from './gun/OverviewTab'
import { PartsTab } from './gun/PartsTab'
import { PhotosTab } from './gun/PhotosTab'
import { PricesTab } from './gun/PricesTab'
import { chOptions, triggerOptions } from './gun/shared'

type Tab = 'overview' | 'parts' | 'attachments' | 'specs' | 'checks' | 'records' | 'photos' | 'log' | 'prices' | 'metadata'
const VIEWS: View[] = ['full', 'lower', 'upper']
const MODES: [Mode, string, string][] = [
  ['clay', 'Clay', 'Plain matte model, every part easy to read'],
  ['real', 'Realistic', 'Finishes, reflections and shadows'],
  ['cut', 'Cutaway', 'Cut down the middle to show the parts inside'],
  ['xray', 'X-ray', 'See-through receivers with the internals lit'],
  ['blue', 'Blueprint', 'Line drawing of every part'],
]
/** [keys, what it does, build-engine guns only] */
const SHORTCUTS: [string, string, boolean][] = [
  ['← →', 'Previous / next gun', false], ['1 – 5', 'Clay · Realistic · Cutaway · X-ray · Blueprint', true],
  ['E', 'Exploded', false], ['L', 'Labels', false], ['A', 'Attachments', false], ['D', 'Dimensions', true],
  ['O', 'Operate', true], ['M', 'Move parts', true], ['S', 'Spin', false], ['R', 'Reset view', false],
  ['F', 'Fire (in Operate)', true], ['Space', 'Play / pause (in Operate)', true], [', .', 'Step back / forward (in Operate)', true],
  ['Ctrl+Z', 'Undo the last change', false], ['?', 'Show this list', false],
]
const CAMS: [CamPreset, string, string][] = [['iso', '3/4', 'Three-quarter view'], ['right', 'R', 'Right side'], ['left', 'L', 'Left side'], ['top', 'Top', 'From above'], ['front', 'Front', 'Down the muzzle']]
/** Names for model parts that aren't a slot of their own. */
const EXTRA_KEYS: Record<string, string> = { gas: 'Gas block and tube', spring: 'Recoil spring', tube: 'Magazine tube', buffer: 'Buffer system', dustcover: 'Ejection port cover' }

export function GunPage() {
  const { gunId, partId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: lib, isLoading, error } = useLibrary()
  const { data: catalog } = useCatalog()
  const { data: settings } = useSettings()
  const { data: tracked } = useTracked()
  const { data: cat } = usePartsCatalog()
  const key = partId ? `${gunId}/${partId}` : gunId ?? ''
  const item = useMemo(() => (lib ? findItem(lib.guns, key) : null), [lib, key])
  const { data: logs } = useLogs(item?.kind === 'gun' ? item.gun.id : undefined)

  const view = (VIEWS.includes(params.get('view') as View) ? params.get('view') : 'full') as View
  const tab = (params.get('tab') ?? 'overview') as Tab
  const pickParam = params.get('pick')
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n }, { replace: true })

  const [looks, setLooks] = usePref<Looks & { attachments: boolean; photo: boolean; mode?: Mode; spread?: number; dims?: boolean; units?: Units; original?: boolean }>('looks', { xray: false, shading: false, blueprint: false, exploded: false, labels: false, attachments: true, photo: false, mode: 'real', spread: 1, dims: false, units: 'in' })
  const [operate, setOperate] = useState(false)
  const [move, setMove] = useState(false)
  const [moved, setMoved] = useState(0)
  const [specs, setSpecs] = useState<Specs | null>(null)
  const [built, setBuilt] = useState<Built | null>(null)
  const [opView, setOpView] = useState<OpView | null>(null)
  const stage = useRef<Stage | null>(null)
  const [flip, setFlip] = usePref<Record<string, boolean>>('photo-flip', {})
  const [spin, setSpin] = useState(false)
  const [reset, setReset] = useState(0)
  const [picked, setPicked] = useState<string | null>(pickParam)
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [trigSel, setTrigSel] = useState<Record<string, string>>({})
  const [chSel, setChSel] = useState<Record<string, string>>({})
  const [skinIdx, setSkinIdx] = useState<Record<string, number>>({})
  const [skin, setSkin] = useState({ note: '', canMirror: false, canNext: false })
  const [dialog, setDialog] = useState<null | 'gun' | 'part' | 'att'>(null)

  useEffect(() => { setPicked(pickParam) }, [key, pickParam])
  const [lastGun, setLastGun] = usePref<string>('last-gun', '')
  const curGunId = item?.gun.id
  useEffect(() => { if (curGunId) setLastGun(curGunId) }, [curGunId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showKeys, setShowKeys] = useState(false)
  const [sheet, setSheet] = useState<string | null>(null)
  const [actErr, setActErr] = useState<string | null>(null)
  const qc = useQueryClient()


  const photoProjection = !!settings?.experimental.photoProjection && looks.photo
  // Full guns with a build are drawn by the build engine; bought parts and the photo experiment use the older viewer.
  const engGun = useMemo(() => (item?.kind === 'gun' && cat && !photoProjection ? toEngine(item.gun, cat) : null), [item, cat, photoProjection])
  // "Original model": the hand-made model each gun started with, drawn by the older viewer
  const hasOriginal = item?.kind === 'gun' && !!item.gun.model
  const engView = engGun && !(looks.original && hasOriginal) ? engGun : null
  const mode: Mode = looks.mode ?? 'real'
  const [units, setUnits] = useUnits()
  const stageOpts: StageOpts = useMemo(() => ({
    mode, view, exploded: looks.exploded, labels: looks.labels, attachments: looks.attachments, spin,
    spread: looks.spread ?? 1, dims: !!looks.dims, move, operate, units,
  }), [mode, view, looks.exploded, looks.labels, looks.attachments, spin, looks.spread, looks.dims, move, operate, units])
  // fit and legal checks, recomputed whenever the model is rebuilt or the records/log change
  const curBuilt = built && item?.kind === 'gun' && built.gun.id === item.gun.id ? built : null
  const every = settings?.maintenanceRounds ?? 500
  const autoChecks = useMemo(() => {
    if (!curBuilt || !cat || item?.kind !== 'gun') return null
    const g = item.gun, st = roundStats(logs ?? []), row = (s: string) => g.build?.find((r) => r.slot === s)?.name ?? ''
    return runChecks(curBuilt, cat, {
      units, nfa: g.records?.nfa ?? null, attNfa: Object.fromEntries(g.attachments.map((a) => [a.id, a.nfa?.status])),
      sinceClean: st.since, cleanEvery: g.cleanEvery || every, slideText: `${g.name} ${row('slide')} ${row('psights')}`,
    })
  }, [curBuilt, cat, item, logs, units, every])
  const nfa = useMemo(() => (curBuilt ? classify(curBuilt) : null), [curBuilt])
  // game-style ratings for the Specs tab (built off-screen, so only when that tab is open)
  const gunStatsVal = useMemo(() => (engGun && cat && tab === 'specs' ? gunStats(engGun, cat) : null), [engGun, cat, tab])
  // keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === ' ' && t.closest('button')) return
      const guns = lib?.guns ?? []
      const cur = guns.findIndex((g) => g.id === item?.gun.id)
      const go = (d: number) => { if (guns.length) navigate(`/gun/${guns[(cur + d + guns.length) % guns.length].id}${tab !== 'overview' ? `?tab=${tab}` : ''}`) }
      const k = e.key
      let done = true
      if (k === 'ArrowLeft') go(-1)
      else if (k === 'ArrowRight') go(1)
      else if (k === '?') setShowKeys((s) => !s)
      else if (k === 'Escape' && (operate || move)) { setOperate(false); setMove(false) }
      else if (k === 'e' || k === 'E') setLooks((l) => ({ ...l, exploded: !l.exploded }))
      else if (k === 'l' || k === 'L') setLooks((l) => ({ ...l, labels: !l.labels }))
      else if (k === 'a' || k === 'A') setLooks((l) => ({ ...l, attachments: !l.attachments }))
      else if (k === 's' || k === 'S') setSpin((s) => !s)
      else if (k === 'r' || k === 'R') setReset((n) => n + 1)
      else if (engView && k >= '1' && k <= '5') setLooks((l) => ({ ...l, mode: MODES[Number(k) - 1][0] }))
      else if (engView && (k === 'd' || k === 'D')) setLooks((l) => ({ ...l, dims: !l.dims }))
      else if (engView && (k === 'o' || k === 'O')) setOperate((o) => !o)
      else if (engView && (k === 'm' || k === 'M')) setMove((m) => !m)
      else if (engView && operate && k === ' ') stage.current?.op({ type: 'toggle' })
      else if (engView && operate && k === ',') stage.current?.op({ type: 'step', dir: -1 })
      else if (engView && operate && k === '.') stage.current?.op({ type: 'step', dir: 1 })
      else if (engView && operate && (k === 'f' || k === 'F')) stage.current?.op({ type: 'act', act: 'fire' })
      else done = false
      if (done) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const trigOpts = item && catalog && !engGun ? triggerOptions(item, catalog) : []
  const chOpts = item && catalog && !engGun ? chOptions(item, catalog) : []
  const trig = trigOpts.find((t) => t.id === trigSel[key]) ?? trigOpts[0] ?? null
  const ch = chOpts.find((c) => c.id === chSel[key]) ?? chOpts[0] ?? null
  const splittable = item?.kind === 'gun' && (item.gun.model?.kind === 'rifle' || item.gun.model?.kind === 'pistol')

  const scene: SceneInput | null = useMemo(() => {
    if (!item) return null
    let skinIn: SceneInput['skin'] = null
    if (photoProjection) {
      let groups: SkinGroup[] = []
      if (item.kind === 'part') groups = [{ half: 'part', urls: item.data.photos }]
      else if (view === 'full' && item.gun.photos.full.length) groups = [{ half: 'full', urls: item.gun.photos.full }]
      else groups = (['lower', 'upper'] as const).filter((h) => view === 'full' || view === h).map((h) => ({ half: h, urls: item.gun.photos[h] }))
      skinIn = { groups, index: skinIdx[key] ?? 0, flip: Object.fromEntries(Object.entries(flip).filter(([k]) => k.startsWith(key + '|')).map(([k, v]) => [k.split('|')[1], v])), isPistol: item.gun.type === 'pistol' }
    }
    return {
      key,
      model: item.data.model ?? null,
      sel: { trigger: trig ? { color: trig.color, hammer: trig.hammer, style: trig.style } : null, chModel: ch?.model ?? null },
      attachments: item.kind === 'gun' && looks.attachments ? item.gun.attachments : [],
      view: splittable ? view : null,
      skin: skinIn,
    }
  }, [item, key, trig, ch, looks.attachments, view, splittable, photoProjection, skinIdx, flip])

  if (isLoading) return <div className="page-pad note">Loading library…</div>
  if (error) return <div className="page-pad error">{(error as Error).message}</div>
  if (!lib || !catalog) return null
  if (!item) {
    // Workbench with no gun chosen: reopen the last one you looked at
    const last = lib.guns.find((g) => g.id === lastGun) ?? lib.guns[0]
    return last ? <Navigate to={`/gun/${last.id}`} replace /> : <Navigate to="/" replace />
  }

  const gun: Gun = item.gun
  const slotDefs = engGun ? slotsFor(engGun.platform, engGun.rimfire) : []
  const partLabel = (p: string) => {
    if (p.startsWith('att:')) return gun.attachments.find((a) => 'att:' + a.id === p)?.name ?? 'Attachment'
    if (engGun) return slotDefs.find((d) => d[3] === p)?.[1] ?? EXTRA_KEYS[p] ?? p
    return PART_NAMES[p] ?? p
  }
  const pickDetail = (p: string) => {
    if (p.startsWith('att:')) {
      const a = gun.attachments.find((x) => 'att:' + x.id === p)
      return a ? `${catalog.attachments[a.type]?.name ?? a.type}${a.details ? '. ' + a.details : ''}` : ''
    }
    if (engGun) {
      const rows = slotDefs.filter((d) => d[3] === p).map((d) => ({ d, r: gun.build?.find((r) => r.slot === d[0]) })).filter((x) => x.r?.name)
      return rows.length ? rows.map(({ d, r }) => `${d[1]}: ${r!.name}${r!.source === 'upgrade' ? ` (${r!.status === 'owned' ? 'added' : 'planned'})` : ''}`).join(' · ') : 'Nothing recorded for this part yet. Pick it in the Build tab.'
    }
    for (const sec of Object.values(item.data.bom ?? {})) {
      const hits = (sec?.rows ?? []).filter((r) => r.part === p)
      if (hits.length) {
        if (p === 'trigger' && trig) return `${trig.installed ? 'Installed' : 'Previewing'}: ${trig.name}. ${trig.note ?? ''}`
        return hits.map((r) => (r.value ? `${r.label}: ${r.value}` : r.label)).join(' · ')
      }
    }
    if (p === 'fcg' || p === 'pins') return 'Inside the receiver. Turn on X-ray to see it. These parts get replaced in a trigger swap.'
    if (['gaskey', 'campin', 'bolt', 'extractor', 'carrier'].includes(p)) return 'Part of the bolt carrier group. Turn on X-ray or Exploded to see it.'
    return ''
  }
  const select = (s: TreeSelection) => {
    const [g, p] = s.key.split('/')
    const q = new URLSearchParams()
    if (s.view !== 'full') q.set('view', s.view)
    if (s.pick) { q.set('pick', s.pick); q.set('tab', 'attachments') } else if (tab !== 'overview') q.set('tab', tab)
    navigate(`/gun/${g}${p ? '/part/' + p : ''}${q.toString() ? '?' + q : ''}`)
    if (s.pick && !looks.attachments) setLooks((l) => ({ ...l, attachments: true }))
  }
  const toggle = (k: keyof typeof looks) => setLooks((l) => ({ ...l, [k]: !l[k] }))
  const trackedCount = (tracked ?? []).filter((t) => t.item_key === key).length
  const photoCount = item.kind === 'part' ? item.data.photos.length : VIEWS.reduce((s, v) => s + gun.photos[v].length, 0)
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'parts', label: engGun ? 'Build' : 'Parts' },
    ...(item.kind === 'gun' ? [{ id: 'attachments' as Tab, label: 'Attachments', count: gun.attachments.length }] : []),
    ...(engGun ? [{ id: 'specs' as Tab, label: 'Specs' }, { id: 'checks' as Tab, label: 'Checks', count: autoChecks?.filter((c) => c.lvl === 'fail').length }] : []),
    { id: 'photos', label: 'Photos', count: photoCount },
    ...(item.kind === 'gun' ? [{ id: 'log' as Tab, label: 'Log', count: logs?.length }, { id: 'records' as Tab, label: 'Records' }] : []),
    { id: 'prices', label: 'Prices', count: trackedCount },
    { id: 'metadata', label: 'Metadata' },
  ]

  return (
    <div className="bench">
      <Tree guns={lib.guns} attachmentTypeName={(t) => catalog.attachments[t]?.name ?? t}
        current={{ key, view, pick: picked?.startsWith('att:') ? picked : null }} onSelect={select} onAddGun={() => setDialog('gun')} />

      <section className="stage-wrap" aria-label="3D model">
        {engView && cat
          ? <BuildViewer gun={engView} cat={cat} opts={stageOpts} picked={picked} onPick={setPicked} onPresentParts={setPresent} resetSignal={reset}
              onSpecs={(s, b) => { setSpecs(s); setBuilt(b) }} onOp={setOpView} onMoved={setMoved} onStage={(s) => { stage.current = s }} />
          : scene && (
            <Viewer3D scene={scene} looks={looks} spin={spin} picked={picked} onPick={setPicked} onPresentParts={setPresent}
              partLabel={partLabel} resetSignal={reset} onSkinState={setSkin} />
          )}
        <div className="hud">
          {(splittable || engView) && (
            <div className="seg" role="group" aria-label="Show">
              {VIEWS.map((v) => <button key={v} type="button" className="btn" aria-pressed={view === v} onClick={() => setParam('view', v === 'full' ? null : v)}>{viewName(gun, v)}</button>)}
            </div>
          )}
          {engGun && (
            <label className="hud-select" title="How the model is drawn">
              <span className="sr-only">Look</span>
              <select className="input" value={engView ? mode : 'original'} onChange={(e) => {
                const v = e.target.value
                setLooks((l) => (v === 'original' ? { ...l, original: true } : { ...l, original: false, mode: v as Mode }))
              }}>
                {MODES.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
                {hasOriginal && <option value="original">Original model</option>}
              </select>
            </label>
          )}
          {engGun && <>
            {/* these need the new model; from Original model they switch back to it */}
            <button type="button" className="btn" aria-pressed={!!engView && operate} onClick={() => { if (!engView) { setLooks((l) => ({ ...l, original: false })); setOperate(true) } else setOperate(!operate) }} title="Fire, charge, lock back, change mags, take down, with a slow-motion timeline (O)">Operate</button>
            <button type="button" className="btn" aria-pressed={!!engView && !!looks.dims} onClick={() => setLooks((l) => ({ ...l, original: false, dims: engView ? !l.dims : true }))} title="Overall length, barrel length and balance point drawn on the model (D)">Dimensions</button>
          </>}
          <button type="button" className="btn" aria-pressed={looks.exploded} onClick={() => toggle('exploded')} title="Pull the parts apart (E)">Exploded</button>
          <button type="button" className="btn" aria-pressed={looks.labels} onClick={() => toggle('labels')} title="Name the main parts (L)">Labels</button>
          <HudMenu label="More" active={spin || move}>
            <HudGroup title="Show">
              {item.kind === 'gun' && <button type="button" className="btn small" aria-pressed={looks.attachments} onClick={() => toggle('attachments')}>Attachments</button>}
              <button type="button" className="btn small" aria-pressed={spin} onClick={() => setSpin(!spin)}>Spin</button>
              {engGun && <button type="button" className="btn small" aria-pressed={!!engView && move} title="Drag parts around by hand. Double-click a moved part to put it back"
                onClick={() => { if (!engView) { setLooks((l) => ({ ...l, original: false })); setMove(true) } else setMove(!move) }}>Move parts</button>}
              {moved > 0 && <button type="button" className="btn small" onClick={() => stage.current?.resetMoved()}>Put {moved} back</button>}
            </HudGroup>
            {engView && looks.exploded && (
              <HudGroup title="Explode spread">
                <input type="range" min={0.3} max={1.8} step={0.05} value={looks.spread ?? 1} onChange={(e) => setLooks((l) => ({ ...l, spread: Number(e.target.value) }))} aria-label="Explode spread" style={{ width: '100%', accentColor: 'var(--brass)' }} />
              </HudGroup>
            )}
            {!engView && (
              <HudGroup title="Look">
                <button type="button" className="btn small" aria-pressed={looks.xray} onClick={() => toggle('xray')}>X-ray</button>
                <button type="button" className="btn small" aria-pressed={looks.shading} onClick={() => toggle('shading')}>Shading</button>
                <button type="button" className="btn small" aria-pressed={looks.blueprint} onClick={() => toggle('blueprint')}>Blueprint</button>
              </HudGroup>
            )}
            <HudGroup title="Camera">
              {engView && CAMS.map(([c, label, tip]) => <button key={c} type="button" className="btn small" title={tip} onClick={() => stage.current?.camPreset(c)}>{label}</button>)}
              <button type="button" className="btn small" onClick={() => setReset((n) => n + 1)} title="Reset view (R)">Reset</button>
            </HudGroup>
            <HudGroup title="Units">
              {(['in', 'mm'] as const).map((u) => <button key={u} type="button" className="btn small" aria-pressed={units === u} onClick={() => setUnits(u)}>{u === 'in' ? 'Inches' : 'Millimetres'}</button>)}
            </HudGroup>
            {settings?.experimental.photoProjection && (
              <HudGroup title="Experimental">
                <button type="button" className="btn small" aria-pressed={looks.photo} onClick={() => toggle('photo')}>Photo on model</button>
                {photoProjection && skin.canNext && <button type="button" className="btn small" onClick={() => setSkinIdx((s) => ({ ...s, [key]: (s[key] ?? 0) + 1 }))}>Next photo</button>}
                {photoProjection && skin.canMirror && <button type="button" className="btn small" onClick={() => {
                  const halves = item.kind === 'part' ? ['part'] : view === 'full' && gun.photos.full.length ? ['full'] : (['lower', 'upper'] as const).filter((h) => view === 'full' || view === h)
                  setFlip((f) => { const n = { ...f }; halves.forEach((h) => { n[`${key}|${h}`] = !n[`${key}|${h}`] }); return n })
                }}>Mirror photo</button>}
              </HudGroup>
            )}
            <button type="button" className="btn small ghost" onClick={() => setShowKeys(true)}>Keyboard shortcuts (?)</button>
          </HudMenu>
        </div>
        {photoProjection && skin.note && <div className="stage-note">{skin.note}</div>}
        {engView && operate
          ? <OperateDock view={opView} send={(c) => stage.current?.op(c)} />
          : <div className="stage-hint">{move ? 'Move parts: drag a part · double-click it to put it back · Esc to finish' : 'Drag to rotate · scroll to zoom · right-drag to pan · click a part to name it · ? for shortcuts'}</div>}
      </section>

      <aside className="panel" aria-label="Details">
        <div className="panel-head">
          <h2>{item.data.name}</h2>
          <div className="src">{item.kind === 'part' ? `Part of ${gun.name}` : item.data.short}</div>
          {item.kind === 'gun' && (
            <div className="gun-actions">
              <button type="button" className="btn small" onClick={() => setSheet(buildSheet(gun, engGun ? specs : null, autoChecks, nfa, units))}>Build sheet</button>
              {engView && <button type="button" className="btn small" title="The 3D view as it is now, without labels" onClick={() => {
                const url = stage.current?.snapshot()
                if (!url) return
                const a = document.createElement('a')
                a.href = url; a.download = `${gun.id}.png`
                a.click()
              }}>Save image</button>}
              <button type="button" className="btn small" title="Copy this gun, e.g. to plan an upgrade without touching the original" onClick={async () => {
                setActErr(null)
                try { const r = await api.duplicateGun(gun.id); await qc.invalidateQueries({ queryKey: ['library'] }); navigate(`/gun/${r.id}`) } catch (e) { setActErr(e instanceof Error ? e.message : String(e)) }
              }}>Duplicate</button>
              {([-1, 1] as const).map((d) => {
                const ids = lib.guns.map((g) => g.id), i = ids.indexOf(gun.id), j = i + d
                return <button key={d} type="button" className="btn small" disabled={j < 0 || j >= ids.length} aria-label={d < 0 ? 'Move up in the list' : 'Move down in the list'} title={d < 0 ? 'Move up in the list' : 'Move down in the list'} onClick={async () => {
                  setActErr(null)
                  ;[ids[i], ids[j]] = [ids[j], ids[i]]
                  try { await api.setOrder(ids); await qc.invalidateQueries({ queryKey: ['library'] }) } catch (e) { setActErr(e instanceof Error ? e.message : String(e)) }
                }}>{d < 0 ? '↑' : '↓'}</button>
              })}
              <button type="button" className="btn small ghost" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)">Shortcuts</button>
            </div>
          )}
          {actErr && <p className="error">{actErr}</p>}
        </div>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setParam('tab', t.id === 'overview' ? null : t.id)}>
              {t.label}{t.count ? <span className="count">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="panel-body" role="tabpanel">
          <div className="pick">
            {picked ? <><b>{partLabel(picked)}</b><p>{pickDetail(picked)}</p></> : <p className="note" style={{ margin: 0 }}>Click a part on the model or a row in Parts to highlight it.</p>}
          </div>
          {tab === 'overview' && <OverviewTab item={item} trig={trig} trigOpts={trigOpts} onTrig={(id) => { setTrigSel((s) => ({ ...s, [key]: id })); setPicked('trigger') }}
            ch={ch} chOpts={chOpts} onCh={(id) => { setChSel((s) => ({ ...s, [key]: id })); setPicked('ch') }} />}
          {tab === 'parts' && (engGun && cat && item.kind === 'gun'
            ? <BuildTab gun={gun} cat={cat} picked={picked} present={present} onPick={setPicked} onAddPart={() => setDialog('part')} />
            : <PartsTab item={item} view={view} present={present} picked={picked} onPick={setPicked} trig={trig} ch={ch} onAddPart={() => setDialog('part')} />)}
          {tab === 'attachments' && item.kind === 'gun' && <AttachmentsTab gun={gun} catalog={catalog} shown={looks.attachments} present={present} picked={picked} onPick={setPicked}
            onAdd={() => setDialog('att')} onShow={() => setLooks((l) => ({ ...l, attachments: true }))} specs={engGun ? specs : null} cat={cat} units={units} />}
          {tab === 'specs' && engGun && <SpecsTab gun={gun} specs={specs} units={units} stats={gunStatsVal} />}
          {tab === 'checks' && engGun && <ChecksTab gun={gun} auto={autoChecks} />}
          {tab === 'records' && item.kind === 'gun' && <RecordsTab gun={gun} units={units} nfaClass={nfa} />}
          {tab === 'photos' && <PhotosTab item={item} />}
          {tab === 'log' && item.kind === 'gun' && <LogTab gun={gun} />}
          {tab === 'prices' && <PricesTab item={item} />}
          {tab === 'metadata' && <MetadataTab item={item} />}
        </div>
      </aside>

      <BuildSheetDialog open={sheet != null} text={sheet ?? ''} fileName={`${gun.id}-build-sheet.txt`} onClose={() => setSheet(null)} />
      <Dialog open={showKeys} title="Keyboard shortcuts" submitLabel="Close" onClose={() => setShowKeys(false)} onSubmit={() => setShowKeys(false)}>
        <div className="kbd-list">
          {SHORTCUTS.filter(([, , eng]) => !eng || engGun).map(([k, what]) => <Fragment key={k}><span><kbd>{k}</kbd></span><span>{what}</span></Fragment>)}
        </div>
      </Dialog>
      {cat && <AddGunDialog open={dialog === 'gun'} cat={cat} onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); navigate(`/gun/${id}`) }} />}
      <AddPartDialog gun={dialog === 'part' ? gun : null} onClose={() => setDialog(null)} onCreated={(k) => { setDialog(null); navigate(`/gun/${k.replace('/', '/part/')}`) }} />
      <AddAttachmentDialog gun={dialog === 'att' ? gun : null} catalog={catalog} cat={cat ?? null} onClose={() => setDialog(null)}
        onCreated={(g, a) => { setDialog(null); setLooks((l) => ({ ...l, attachments: true })); navigate(`/gun/${g}?tab=attachments&pick=att:${a}`) }} />
    </div>
  )
}
