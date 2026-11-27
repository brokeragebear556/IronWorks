import * as T from 'three'
import type { Attachment, Gun } from '../../types'
import { buildAtt, isTop } from './attachments'
import { col } from '../models'
import { APP_TYPE_TO_KIND, enginePlatform, mkAtt, type Cat, type EngAtt, type EngGun, type Platform } from './data'
import { ctx, type EMesh } from './geometry'
import { buildAK, buildAR, buildMP5, buildPistol, buildSG, type Info } from './platforms'

export const ENGINE_PLATFORMS: Platform[] = ['ar15', 'ar10', 'ak', 'mp5', 'pistol', 'shotgun']

/** True when a gun has a build the engine can draw. */
export const hasBuild = (g: Gun) => !!g.cfg && ENGINE_PLATFORMS.includes(enginePlatform(g.platform))

const SIDE_CLOCK: Record<string, number> = { top: 0, right: 3, bottom: 6, left: 9 }
const POS_FRAC: Record<string, number> = { rear: 0.1, middle: 0.45, front: 0.85 }

/** The app's attachment, as the engine draws it. Magazines aren't drawn as attachments. */
export function engAtt(cat: Cat, a: Attachment): (EngAtt & { frac?: number }) | null {
  const cid = a.cid && cat.AB[a.cid] ? a.cid : null
  const k = cid ? cat.AB[cid].k : APP_TYPE_TO_KIND[a.type]
  if (!k || ['omount', 'smount'].includes(k)) return null
  const e: EngAtt & { frac?: number } = mkAtt(cat, a.id, k, a.name, cid)
  if (typeof a.pos === 'number') { e.pos = a.pos; e.userPos = true }
  else if (a.position && !isTop(k) && k !== 'supp' && k !== 'sling') e.frac = POS_FRAC[a.position]
  if (typeof a.clock === 'number') e.clock = a.clock
  else if (a.side && (k === 'light' || k === 'laser')) e.clock = SIDE_CLOCK[a.side]
  if (typeof a.h === 'number') e.h = a.h
  if (a.mount !== undefined) e.mount = a.mount
  if (a.ad !== undefined) e.ad = a.ad
  if (a.sub !== undefined) e.sub = a.sub
  return e
}

/** "4.80 lbs", "9 lb 10 oz", "23.65 oz" -> pounds. */
export function parseWeight(v: unknown): number | null {
  if (typeof v === 'number') return v > 0 ? v : null
  if (typeof v !== 'string') return null
  const s = v.toLowerCase()
  const lb = s.match(/([\d.]+)\s*(lb|lbs|pound)/), oz = s.match(/([\d.]+)\s*oz/)
  if (!lb && !oz) return null
  const n = (lb ? parseFloat(lb[1]) : 0) + (oz ? parseFloat(oz[1]) / 16 : 0)
  return n > 0 ? n : null
}

type Rec = Record<string, unknown>
/** Colours and details from the gun's original hand-made model (gun.json "model"), which match
 *  the real gun more closely than the generic finishes. The file itself is never changed. */
function originalLook(gun: Gun): { look: Record<string, number>; cfg: Rec; mbus: boolean } {
  const m = (gun.model ?? {}) as Rec, look: Record<string, number> = {}, cfg: Rec = {}
  const c = (v: unknown) => (v == null ? undefined : col(v))
  const put = (k: string, v: unknown) => { const n = c(v); if (n != null) look[k] = n }
  if (m.kind === 'pistol') {
    put('slide', m.slideColor ?? 'dlc')
    put('anod', m.frameColor ?? 'frame') // metal frame
    put('barrel', m.barrelColor)
    put('muzzle', m.compColor ?? (m.compensator ? '#1c1d20' : undefined))
    if (m.lighteningCuts) cfg.cuts = true
    if (m.optic) cfg.opticPlate = true
  }
  if (m.kind === 'rifle') {
    const f = (m.front ?? {}) as Rec, u = (m.upper ?? {}) as Rec
    if (f.barrelColor) put('barrel', f.barrelColor)
    if (f.muzzleColor) put('muzzle', f.muzzleColor)
    if (f.handguardColor && f.handguardColor !== 'anodized') { put('hgfin', f.handguardColor); cfg.hgFin = cfg.hgFin ?? 'custom' }
    if (u.bcgColor && u.bcgColor !== 'hardchrome') put('chrome', u.bcgColor)
    if (f.topRail === false) cfg.hgTopRail = false
  }
  const front = (m.front ?? {}) as Rec
  return { look, cfg, mbus: front.sights === 'mbus' && !gun.attachments.some((a) => a.type === 'buis') }
}

export function toEngine(gun: Gun, cat: Cat): EngGun | null {
  if (!hasBuild(gun)) return null
  const o = originalLook(gun)
  const atts = gun.attachments.map((a) => engAtt(cat, a)).filter((a): a is EngAtt => !!a)
  // factory sights from the original model (not an attachment, so not priced)
  if (o.mbus) atts.push({ ...mkAtt(cat, 'factory-mbus', 'buis', 'Magpul MBUS (factory)', cat.findA('buis', 'Magpul MBUS 3')), id: 'factory-mbus' })
  return {
    id: gun.id, platform: enginePlatform(gun.platform), rimfire: gun.rimfire || gun.platform === '1522', fit: gun.fit, caliber: gun.caliber,
    cfg: { ...(gun.cfg ?? {}), ...o.cfg, ...(gun.cfg?.hgFin ? { hgFin: gun.cfg.hgFin } : {}) }, build: gun.build ?? [], look: o.look,
    wtLb: gun.records?.scaleWeightLb || parseWeight(gun.specs?.weight),
    wtSource: gun.records?.scaleWeightLb ? 'scale' : parseWeight(gun.specs?.weight) ? 'listing' : 'estimate',
    atts,
  }
}

export interface Built { group: T.Group; meshes: EMesh[]; info: Info; gun: EngGun }

const BUILDERS = { ar15: buildAR, ar10: buildAR, ak: buildAK, mp5: buildMP5, pistol: buildPistol, shotgun: buildSG }

/** Builds the whole gun (and its attachments when `withAtts`) as a group of meshes in inches. */
export function buildGun(g: EngGun, cat: Cat, withAtts: boolean): Built {
  const group = new T.Group()
  const B = ctx(group)
  const info = (BUILDERS[g.platform] ?? buildAR)(g, B, cat)
  info.platform = g.platform
  if (withAtts) {
    for (const a of g.atts as (EngAtt & { frac?: number })[]) {
      if (a.pos == null && a.frac != null) a.pos = info.hgStart + Math.max(0, info.hgEnd - info.hgStart - a.len) * a.frac
      try { buildAtt(g, a, B, info, cat) } catch (e) { console.warn('attachment', a.n, e) }
    }
  }
  B.meshes.forEach((m) => { if (m.userData.attK === 'sling') m.userData.noTake = true })
  const bb = new T.Box3()
  B.meshes.forEach((m) => {
    if (m.userData.grp === 'att' && m.userData.attK !== 'supp') return
    m.updateMatrixWorld()
    bb.expandByObject(m)
  })
  info.bb = bb
  info.floor = Math.min(bb.min.y, -6.5) - 1.6
  const supp = withAtts ? g.atts.find((a) => a.k === 'supp') : undefined
  info.suppEnd = supp?._end ?? null
  // atts with a hand-set position (frac) keep it; record the rest as default for the specs panel
  for (const a of g.atts as (EngAtt & { frac?: number })[]) if (a.frac != null) a.userPos = false
  return { group, meshes: B.meshes, info, gun: g }
}

export function disposeGroup(group: T.Object3D) {
  group.traverse((o) => {
    const m = o as T.Mesh
    if (m.geometry) m.geometry.dispose()
  })
}
