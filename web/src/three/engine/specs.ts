/* Measurements taken from the built model: lengths, rail space, weight and balance point,
   plus where each attachment sits and how far it can slide. Units: inches and ounces. */
import * as T from 'three'
import type { Built } from './assemble'
import { defaultPos, isTop } from './attachments'
import { AR_STOCK, type Cat, type EngAtt, type EngGun } from './data'
import type { Info } from './platforms'

const DENS: Record<string, number> = { steel: 1, barrel: 1, muzzle: 1, chrome: 1, spring: 1, anod: 0.42, ch: 0.42, hgfin: 0.42, slide: 1, poly: 0.18, fdep: 0.18, furn: 0.2, wood: 0.33, mag: 0.2, dark: 0.3, rubber: 0.2 }
const CLASS_LB: Record<string, number> = { ar15: 6.6, ar10: 9.4, ak: 7.6, mp5: 6.0, pistol: 1.5, shotgun: 6.4 }
export const ACTION_NAMES: Record<string, string> = { ar: 'Direct impingement, rotating bolt', blow: 'Straight blowback', ak: 'Long-stroke piston, rotating bolt', mp5: 'Roller-delayed blowback', pistol: 'Short recoil, tilting barrel', sg: 'Gas-operated, rotating bolt' }
const RAILK = ['reddot', 'holo', 'prism', 'lpvo', 'scope', 'magn', 'offset', 'riser', 'light', 'laser', 'switch', 'vfg', 'stop', 'bipod', 'plight', 'pdot']

export interface AttPlace {
  id: string; k: string; pos: number; set: boolean; onTop: boolean; railable: boolean
  /** slider range for `pos` */ lo: number; hi: number
  /** Picatinny slot number for top-rail items */ slot: number | null
  /** where the position is measured from, and the distance */ from: string; dist: number
  wt: number; h: number
}
export interface Specs {
  oal: number; oalMin: number; oalMax: number; oalSupp: number | null
  height: number; width: number
  barrel: number; effBarrel: number; pinned: boolean
  railLen: number | null; railSlots: number | null; sightHeight: number | null
  travel: number | null; action: string | null
  wtBase: number; wtAtt: number; wtTotal: number; wtEstimated: boolean; wtSource: 'scale' | 'listing' | 'estimate'
  balance: { x: number; fromGrip: number } | null
  stockName: string | null
  atts: AttPlace[]
  info: { railStart: number; railEnd: number; hgStart: number; hgEnd: number; pistol: boolean }
}

export function attWeight(cat: Cat, a: EngAtt): number {
  const scoped = a.k === 'lpvo' || a.k === 'scope'
  const mount = a.mount ? cat.AB[a.mount] : undefined
  return (a.wt || 0) + (mount ? mount.w || (scoped ? 5 : 0) : scoped ? 5 : 0) + (a.ad ? cat.AB[a.ad]?.w || 0 : 0) + (a.sub ? cat.AB[a.sub]?.w || 0 : 0)
}

function places(g: EngGun, I: Info, cat: Cat): AttPlace[] {
  return g.atts.map((a) => {
    const pos = a.pos ?? defaultPos(a, I), top = isTop(a.k) && a.k !== 'buis', scoped = a.k === 'lpvo' || a.k === 'scope'
    const railable = (!I.pistol || ['pdot', 'plight', 'light', 'laser'].includes(a.k)) && RAILK.includes(a.k) && !(I.pistol && a.k === 'pdot')
    const lo = top ? I.railStart - (scoped ? 3.6 : 1.5) : I.hgStart
    const hi = Math.max(lo + 0.1, top ? I.railEnd - (scoped ? 7.5 : a.len) : I.hgEnd - Math.min(a.len, 2))
    const slot = top ? Math.max(1, Math.round((pos + (scoped ? 3.3 : 0) - I.railStart) / 0.394) + 1) : null
    const h = a.mount && cat.AB[a.mount]?.h ? cat.AB[a.mount].h! : a.h
    return { id: a.id, k: a.k, pos, set: !!a.userPos, onTop: top, railable, lo, hi, slot, from: top ? 'rear of the top rail' : 'front of the receiver', dist: pos - (top ? I.railStart : I.hgStart), wt: attWeight(cat, a), h }
  })
}

export function computeSpecs(b: Built, cat: Cat, withAtts: boolean): Specs {
  const { info: I, gun: g, meshes } = b
  const c = g.cfg, o = I.op as Record<string, unknown>
  const pinned = !!c.pinned && I.md.prot > 0
  const bb = I.bb ?? new T.Box3()
  const sz = bb.getSize(new T.Vector3())
  // weight: listing/scale weight, or a class estimate
  const est = !g.wtLb
  const wtBase = g.wtLb ? g.wtLb * 16 : (CLASS_LB[g.platform] ?? 7) * 16 * (g.rimfire ? 0.83 : 1)
  const wtAtt = withAtts ? g.atts.reduce((s, a) => s + attWeight(cat, a), 0) : 0
  // balance: volume-weighted centre of the gun's own parts, scaled to its weight, plus attachments
  let sw = 0, sx = 0
  for (const m of meshes) {
    if (m.userData.grp === 'att' || m.userData.inst) continue
    const box = new T.Box3().setFromObject(m), s = box.getSize(new T.Vector3())
    const v = s.x * s.y * s.z * (DENS[m.userData.mat] ?? 0.4)
    sw += v
    sx += v * box.getCenter(new T.Vector3()).x
  }
  let balance: Specs['balance'] = null
  if (sw) {
    let tw = wtBase, tx = wtBase * (sx / sw)
    if (withAtts) for (const a of g.atts) {
      const ms = meshes.filter((m) => m.userData.att === a.id)
      if (!ms.length) continue
      const box = new T.Box3()
      ms.forEach((m) => box.expandByObject(m))
      const wt = attWeight(cat, a)
      tw += wt
      tx += wt * box.getCenter(new T.Vector3()).x
    }
    const x = tx / tw
    balance = { x, fromGrip: x - I.gripX }
  }
  const ar = g.platform === 'ar15' || g.platform === 'ar10'
  const railLen = I.pistol || I.noRail ? null : I.railEnd - I.railStart
  return {
    oal: I.devEnd - I.butt, oalMin: I.devEnd - I.buttMax, oalMax: I.devEnd - I.buttMin,
    oalSupp: withAtts && I.suppEnd ? Math.max(I.devEnd, I.suppEnd) - I.butt : null,
    height: sz.y, width: sz.z,
    barrel: c.barrel ?? 0, effBarrel: (c.barrel ?? 0) + (pinned ? I.md.prot : 0), pinned,
    railLen, railSlots: railLen ? Math.floor(railLen / 0.394) : null, sightHeight: ar ? I.rail : null,
    travel: typeof o.D === 'number' ? o.D : null, action: ACTION_NAMES[String(o.type)] ?? null,
    wtBase, wtAtt, wtTotal: wtBase + wtAtt, wtEstimated: est, wtSource: est ? 'estimate' : g.wtSource ?? 'listing',
    balance,
    stockName: ar ? AR_STOCK[c.stock ?? '']?.n ?? null : null,
    atts: places(g, I, cat),
    info: { railStart: I.railStart, railEnd: I.railEnd, hgStart: I.hgStart, hgEnd: I.hgEnd, pistol: !!I.pistol },
  }
}

// ---------- units ----------
export type Units = 'in' | 'mm'
export const fmtLen = (v: number, u: Units) => (u === 'mm' ? `${(v * 25.4).toFixed(v * 25.4 < 100 ? 1 : 0)} mm` : `${(+v).toFixed(2).replace(/\.?0+$/, '')}"`)
export const fmtWt = (oz: number, u: Units) => (u === 'mm'
  ? oz * 28.3495 >= 1000 ? `${((oz * 28.3495) / 1000).toFixed(2)} kg` : `${(oz * 28.3495).toFixed(0)} g`
  : oz >= 16 ? `${Math.floor(oz / 16)} lb ${(oz % 16).toFixed(1)} oz` : `${oz.toFixed(1)} oz`)
