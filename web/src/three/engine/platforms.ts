import * as T from 'three'
import { AR_STOCK, CART, GASPORT, MAGS, mzOf, type Cart, type Cat, type EngGun, type MagDef, type Muzzle } from './data'
import { arc, box, cylX, ext, extX, Helix, octSec, rr, type AddOpts, type Builder, type P2 } from './geometry'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Where things are on the built model: rails, handguard, muzzle, butt, and data the
 *  operation animations use. */
export interface Info {
  rail: number; railStart: number; railEnd: number; hgStart: number; hgEnd: number; hgCy: number; hgR: number
  muzzleX: number; devEnd: number; butt: number; buttMin: number; buttMax: number; gripX: number; md: Muzzle; recRear: number
  stockTravel?: number; noRail?: boolean; pistol?: boolean; slideTop?: number; height?: number
  op: Record<string, unknown> & { type: string; cart: Cart }
  // filled in after building
  platform?: string; bb?: T.Box3; floor?: number; suppEnd?: number | null
}

export function stockGeom(t: string): T.BufferGeometry {
  const pts: Record<string, P2[]> = {
    sopmod: [[0, 1.25], [0, -4.15], [0.95, -4.25], [2.9, -1.25], [6.6, -0.82], [6.9, -0.5], [6.9, 0.82], [6.2, 1.05], [2.6, 1.42], [0.5, 1.5]],
    ctr: [[0, 1.1], [0, -4.0], [0.9, -4.1], [2.6, -1.0], [6.4, -0.7], [6.7, -0.4], [6.7, 0.78], [2.6, 1.0], [0.5, 1.2]],
    m4: [[0, 1.05], [0, -3.9], [0.8, -4.0], [2.3, -0.95], [6.3, -0.65], [6.6, -0.4], [6.6, 0.75], [2.5, 0.95], [0.5, 1.1]],
    fixedc: [[0, 1.1], [0, -4.0], [0.9, -4.1], [2.6, -1.0], [6.6, -0.7], [6.9, -0.4], [6.9, 0.78], [2.6, 1.0], [0.5, 1.2]],
    brace: [[0, 1.0], [0, -3.6], [0.7, -3.7], [2.4, -1.0], [6.5, -0.7], [6.8, -0.4], [6.8, 0.8], [2.6, 1.05], [0.4, 1.15]],
    prs: [[0, 1.6], [0, -4.6], [1.2, -4.6], [3.4, -1.6], [8.4, -0.9], [8.8, -0.5], [8.8, 0.9], [4.0, 1.55], [3.4, 1.85], [0.4, 1.85]],
    a2: [[0, 1.05], [0, -4.35], [0.7, -4.4], [9.6, -0.85], [10.0, -0.65], [10.0, 0.7], [0.6, 1.15]],
  }
  return ext(pts[t] ?? [[0, 1], [0, -3.8], [6.5, -0.6], [6.5, 0.7]], t === 'sopmod' ? 1.75 : t === 'prs' ? 1.7 : 1.45, 0.1)
}

export function magGeom(xFront: number, yTop: number, mg: MagDef): T.BufferGeometry[] {
  if (mg.drum) {
    // feed tower into the magwell, then one drum, or two drums side by side (twin drum)
    const r = mg.dr ?? 2.6, neckH = 3.0
    const n = ext([[xFront, yTop], [xFront - mg.d, yTop], [xFront - mg.d, yTop - neckH], [xFront, yTop - neckH]], mg.w, 0.04)
    const cx = xFront - mg.d / 2, cy = yTop - neckH - r + 0.6
    const drum = (depth: number, z: number) => {
      const g = new T.CylinderGeometry(r, r, depth, 36)
      g.rotateX(Math.PI / 2)
      g.translate(cx, cy, z)
      return g
    }
    return mg.drum === 2 ? [n, drum(2.0, 1.25), drum(2.0, -1.25)] : [n, drum(Math.max(2.4, r * 1.25), 0)]
  }
  const N = 16, F: P2[] = [], Bk: P2[] = []
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * mg.len
    let fx: number, fy: number, bx: number, by: number
    if (!mg.R) { fx = xFront; fy = yTop - s; bx = xFront - mg.d; by = fy }
    else {
      const a = s / mg.R
      fx = xFront + mg.R * (1 - Math.cos(a)); fy = yTop - mg.R * Math.sin(a)
      const Rb = mg.R + mg.d
      bx = xFront - mg.d + Rb * (1 - Math.cos(a)); by = yTop - Rb * Math.sin(a)
    }
    F.push([fx, fy]); Bk.push([bx, by])
  }
  const last = F[N], lb = Bk[N]
  const pad: P2[] = [[last[0] + 0.12, last[1] - 0.05], [last[0] + 0.05, last[1] - 0.32], [lb[0] - 0.05, lb[1] - 0.32], [lb[0] - 0.1, lb[1] - 0.05]]
  return [ext([...F, ...pad, ...Bk.reverse()], mg.w, 0.06)]
}

export function addMuzzle(B: Builder, md: Muzzle, x: number, o: AddOpts) {
  if (!md || md.st === 'none' || !md.prot) return
  const L = md.prot + 0.5, x0 = x - 0.5
  if (md.st === 'cage') {
    B.add(cylX(md.r, md.r * 0.92, L), 'steel', { x: x0, ...o })
    for (let i = 0; i < 5; i++) B.add(box(L * 0.55, 0.06, md.r * 2.02), 'dark', { ...o, lab: 0, label: null, x: x0 + L * 0.55, y: 0, rx: (i * Math.PI) / 5 })
  } else if (md.st === 'comp' || md.st === 'brake') {
    B.add(cylX(md.r, md.r, L, 8), 'muzzle', { x: x0, ...o })
    for (let i = 0; i < 3; i++) B.add(box(0.2, md.r * 1.6, md.r * 2.06), 'dark', { ...o, lab: 0, label: null, x: x0 + 0.75 + i * 0.45 })
  } else if (md.st === 'fh') {
    B.add(cylX(md.r, md.r, L * 0.55, 24), 'steel', { x: x0, ...o })
    B.add(cylX(md.r * 0.9, md.r * 0.82, L * 0.45, 6), 'steel', { ...o, lab: 0, label: null, x: x0 + L * 0.55 })
  } else B.add(cylX(md.r, md.r * 0.97, L, 24), 'steel', { x: x0, ...o })
}
const mzLabel = (md: Muzzle) => md.n.split(' (')[0]
const rowName = (g: EngGun, slot: string) => g.build.find((r) => r.slot === slot)?.name || ''

// ---------- AR-15 / AR-10 ----------
/** Rear of the short .22 blowback bolt (inches; the chamber is at 0). */
const RIM_BOLT_X = -3.5

export function buildAR(g: EngGun, B: Builder, cat: Cat): Info {
  const c = g.cfg, big = g.platform === 'ar10', k = big ? 1.1 : 1, ky = big ? 1.08 : 1
  const xr = -5.9 * k, xf = big ? 1.25 : 1.1, rail = big ? 1.32 : 1.215, low0 = -0.62 * ky, Wd = big ? 1.12 : 1.0
  const fin = 'anod', bl = c.barrel ?? 16, poly = !!g.rimfire && c.polymer !== false
  const U: AddOpts = { grp: 'upper', ex: [0, 3.2, 0] }, Lw: AddOpts = { grp: 'lower', ex: [0, -1.2, 0] }
  B.add(ext([[xr, low0], [xf, low0], [xf, 0.55], [xf - 0.2, rail - 0.22], [xr + 0.3, rail - 0.22], [xr, 0.7]], Wd, 0.04), poly ? 'poly' : fin, { key: 'upper', label: 'Upper receiver', lab: 1, ...U })
  B.rail(xr + 0.05, xf, rail, { key: 'upper', ...U })
  if (!g.rimfire || c.forwardAssist) {
    B.add(cylX(0.27, 0.27, 1.35), fin, { key: 'upper', x: xr + 0.35, y: 0.28, z: Wd / 2 + 0.12, ...U })
    B.add(cylX(0.2, 0.2, 0.35), 'dark', { key: 'upper', x: xr + 0.1, y: 0.28, z: Wd / 2 + 0.12, ...U })
  }
  const portX0 = -3.4 * k, portX1 = -0.6 * k
  B.add(box(portX1 - portX0, 0.62, 0.05), fin, { key: 'dustcover', ak: 'ejcover', x: (portX0 + portX1) / 2, y: 0.12 - 0.31, z: Wd / 2 + 0.03, ...U }).geometry.translate(0, 0.31, 0)
  B.add(box(portX1 - portX0 - 0.1, 0.5, 0.02), 'dark', { key: 'upper', x: (portX0 + portX1) / 2, y: 0.12, z: Wd / 2 + 0.005, internal: 0, ...U })
  B.add(ext([[0, 0], [0.6, 0], [0.6, 0.55], [0.15, 0.55]], 0.34, 0.02), fin, { key: 'upper', x: -4.0 * k, y: 0.3, z: Wd / 2 + 0.1, ...U })
  const chW = c.ch === 'ambi' ? 2.3 : 1.55
  B.add(ext([[0, -0.12], [0.75, -0.12], [0.75, 0.12], [0, 0.12]], chW, 0.05), 'ch', { key: 'ch', ak: 'ch', label: 'Charging handle', grp: 'upper', ex: [-3.5, 5.5, 0], lab: 1, x: xr - 0.55, y: rail - 0.45 })
  B.add(box(6.2 * k, 0.16, 0.3), 'steel', { key: 'ch', ak: 'ch', grp: 'upper', ex: [-3.5, 5.5, 0], x: xr + 2.6 * k, y: rail - 0.45, internal: 1 })
  // BCG: carrier + gas key + bolt (lugs, cam pin)
  const cr = big ? 0.5 : 0.45, cx0 = -6.35 * k, BC: AddOpts = { grp: 'upper', ex: [-2.6, 7.6, 0], internal: 1 }
  // a .22 blowback bolt is short and stays in the upper; an AR carrier runs back into the buffer tube
  const boltX = g.rimfire ? RIM_BOLT_X : cx0
  B.add(cylX(cr, cr, -0.85 - boltX), g.rimfire ? 'steel' : 'chrome', { key: 'bcg', ak: 'carrier', label: g.rimfire ? 'Blowback bolt' : 'Bolt carrier group', lab: 1, x: boltX, ...BC })
  if (!g.rimfire) {
    B.add(box(1.6, 0.32, 0.32), 'chrome', { key: 'bcg', ak: 'carrier', x: -3.3 * k, y: cr + 0.1, ...BC })
    B.add(box(0.9, 0.1, 0.12), 'dark', { key: 'bcg', ak: 'carrier', x: -1.7, y: cr - 0.01, z: 0, ...BC })
  }
  B.add(cylX(0.29, 0.29, 2.2), 'chrome', { key: 'bcg', ak: 'bolt', x: -2.2, ...BC })
  if (!g.rimfire) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      B.add(box(0.22, 0.1, 0.12), 'chrome', { key: 'bcg', ak: 'bolt', x: -0.12, y: 0.33 * Math.cos(a), z: 0.33 * Math.sin(a), rx: -a, ...BC })
    }
    B.add(cylX(0.09, 0.09, 0.1), 'steel', { key: 'bcg', ak: 'bolt', x: -1.45, ...BC }).geometry.rotateZ(Math.PI / 2)
    B.add(new T.CylinderGeometry(0.1, 0.1, 0.55, 10), 'steel', { key: 'bcg', ak: 'bolt', x: -1.4, y: 0.45, ...BC })
  }
  // barrel
  const thR = (c.thread || '').startsWith('5/8') ? 0.3125 : 0.25
  const gp = c.gas && c.gas !== 'none' ? xf + (GASPORT[c.gas] ?? 9) : null
  const br1 = 0.375, br2 = big ? 0.36 : 0.31, BR: AddOpts = { grp: 'upper', ex: [2.5, 4.6, 0] }
  B.add(cylX(0.52, 0.52, 1.6), 'steel', { key: 'barrel', x: -0.55, internal: 1, ...BR })
  B.add(cylX(0.66, 0.66, 0.95), 'anod', { key: 'barrel', x: xf, internal: 1, ...BR })
  const bx0 = xf + 0.95, mid = gp ? Math.min(gp + 0.75, bl - 1) : bx0 + 4
  B.add(cylX(br1, br1, mid - bx0), 'barrel', { key: 'barrel', label: 'Barrel', lab: 1, x: bx0, ...BR })
  B.add(cylX(br2, br2, Math.max(0.1, bl - 0.55 - mid)), 'barrel', { key: 'barrel', x: mid, ...BR })
  if (c.thread && c.thread !== 'none') B.add(cylX(thR, thR, 0.55), 'barrel', { key: 'barrel', x: bl - 0.55, ...BR })
  else B.add(cylX(br2, br2, 0.55), 'barrel', { key: 'barrel', x: bl - 0.55, ...BR })
  if (gp) {
    B.add(ext(rr(-0.5, -0.5, 0.5, 0.78, 0.12), 1.0, 0.03), 'steel', { key: 'gas', label: c.gasAdj ? 'Adjustable gas block' : 'Gas block', lab: 1, grp: 'upper', ex: [2.5, 3.2, 0], x: gp, ry: Math.PI / 2 })
    if (c.gasAdj) B.add(cylX(0.09, 0.09, 0.12), 'chrome', { key: 'gas', grp: 'upper', ex: [2.5, 3.2, 0], x: gp + 0.5, y: 0.62 })
    B.add(cylX(0.09, 0.09, gp - (xf - 1.2) - 0.2), 'steel', { key: 'gas', grp: 'upper', ex: [2.5, 3.2, 0], x: xf - 1.2, y: 0.66, internal: 1 })
  }
  const hx = xf + 0.04, hl = c.hg ?? 15, hcy = 0.2, ha = 0.86, HG: AddOpts = { grp: 'upper', ex: [1.0, 6.0, 0] }
  const hm = c.hgFin ? 'hgfin' : 'anod'
  if (c.hgStyle === 'poly') {
    B.add(extX(octSec(ha, hcy).map((p) => [p[0] * 1.03, p[1]] as [number, number]), hl), 'poly', { key: 'hg', label: 'Handguard', lab: 1, x: hx, ...HG })
  } else if (c.hgStyle === 'quad') {
    B.add(extX(octSec(ha * 0.92, hcy), hl), hm, { key: 'hg', label: 'Quad rail', lab: 1, x: hx, ...HG })
    B.rail(hx, hx + hl, rail, { key: 'hg', mat: hm, ...HG })
    ;[Math.PI / 2, -Math.PI / 2, Math.PI].forEach((rt) => B.rail(hx, hx + hl, rail, { key: 'hg', mat: hm, ...HG }, 0, 0.835, rt, hcy))
  } else {
    B.add(extX(octSec(ha, hcy), hl), hm, { key: 'hg', label: 'Handguard', lab: 1, x: hx, ...HG })
    if (c.hgTopRail !== false) B.rail(hx, hx + hl, rail, { key: 'hg', mat: hm, ...HG })
    const mats: T.Matrix4[] = [], n = Math.floor((hl - 0.9) / 1.575)
    ;[Math.PI / 2, Math.PI * 0.75, Math.PI, Math.PI * 1.25, Math.PI * 1.5].forEach((t) => {
      for (let i = 0; i < n; i++) {
        const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), t)
        const p = new T.Vector3(hx + 0.6 + i * 1.575 + 0.63, ha + 0.005, 0).applyAxisAngle(new T.Vector3(1, 0, 0), t)
        p.y += hcy
        mats.push(new T.Matrix4().compose(p, q, new T.Vector3(1, 1, 1)))
      }
    })
    if (mats.length) B.inst(box(1.26, 0.03, 0.275), 'dark', mats, { key: 'hg', ...HG })
  }
  const md = mzOf(cat, c.muzzle, c)
  addMuzzle(B, md, bl, { key: 'muzzle', label: rowName(g, 'muzzle') || mzLabel(md), lab: 1, grp: 'upper', ex: [5.2, 2.6, 0] })
  // lower
  const LP: P2[] = [[1.15, -0.62], [1.15, -1.05], [1.0, -1.2], [1.05, -2.85], [0.85, -3.02], [-1.85, -3.02], [-1.95, -2.6], [-2.2, -2.3], [-2.25, -3.15], [-4.3, -3.05], [-4.45, -2.2], [-5.75, -1.95], [-6.05, -1.5], [-6.6, -1.2], [-6.6, 0.62], [-5.95, 0.62], [-5.95, -0.62]]
  const tg: P2[] = [[-2.4, -2.35], [-4.15, -2.35], [-4.1, -2.88], [-2.42, -2.95]]
  const lx = big ? xf - 1.15 * k : 0, sc = (p: P2): P2 => [p[0] * k + lx, p[1] * ky]
  B.add(ext(LP.map(sc), big ? 1.32 : 1.22, 0.05, [tg.map(sc)]), poly ? 'poly' : fin, { key: 'lower', label: 'Lower receiver', lab: 1, ...Lw })
  B.add(cylX(0.16, 0.16, 0.1), 'dark', { key: 'lower', x: 0.55 * k + lx, y: -1.55 * ky, z: 0.66, ...Lw })
  const safX = -4.7 * k + lx, safY = -1.3 * ky
  B.add(ext([[-0.06, -0.06], [0.42, -0.06], [0.42, 0.06], [-0.06, 0.06]], 0.2, 0.02), fin, { key: 'safety', ak: 'safety', x: safX, y: safY, z: -0.72, ...Lw })
  B.add(cylX(0.17, 0.17, 0.05, 16), fin, { key: 'safety', ak: 'safety', x: safX - 0.03, y: safY, z: -0.66, ...Lw }).geometry.rotateY(Math.PI / 2)
  const ctX = -0.8 * k + lx, ctY = -0.85 * ky
  B.add(ext([[-0.55, -0.3], [0.45, -0.12], [0.5, 0.12], [-0.5, 0.1]], 0.1, 0.01), 'dark', { key: 'catch', ak: 'catch', x: ctX, y: ctY, z: -0.66, ...Lw })
  const trX = -2.85 * k + lx, trY = -1.9 * ky
  B.add(ext([[0, 0], [-0.22, 0], [-0.38, -0.55], [-0.3, -0.98], [-0.16, -0.98], [-0.22, -0.55]], 0.25, 0.02), poly ? 'steel' : 'dark', { key: 'trigger', ak: 'trigger', label: 'Trigger', lab: 1, grp: 'lower', ex: [0, -4.2, 0], x: trX, y: trY })
  const hmX = -3.6 * k + lx, hmY = -1.55 * ky
  B.add(ext([[-0.3, 0], [0.25, 0], [0.35, 0.75], [0.05, 1.0], [-0.25, 0.7]], 0.3, 0.02), 'steel', { key: 'trigger', ak: 'hammer', label: 'Hammer', grp: 'lower', ex: [0, -4.2, 0], x: hmX, y: hmY, internal: 1 })
  const gpts = ([[-4.42, -2.05], [-5.95, -1.9], [-6.3, -2.25], [-7.2, -5.55], [-6.5, -6.0], [-5.95, -5.85], [-4.75, -2.85]] as P2[]).map(sc)
  B.add(ext(gpts, 1.15, 0.1), 'furn', { key: 'grip', label: 'Pistol grip', lab: 1, grp: 'lower', ex: [-1.2, -3.6, 0] })
  const mg = MAGS[c.mag ?? ''] ?? MAGS.pmag30, mfx = 1.0 * k + lx - 0.15, mtop = -1.4 * ky
  magGeom(mfx, mtop, mg).forEach((geo, i) => B.add(geo, 'mag', { key: 'mag', ak: 'mag', label: i ? null : 'Magazine', lab: !i, grp: 'lower', ex: [0.6, -4.6, 0] }))
  // buffer system (centerfire) or stock tube only (rimfire blowback: the recoil spring lives in the upper)
  const tR = big ? 0.6 : 0.574, tx0 = -6.6 * k + lx
  const tlen = c.stock === 'a2' || c.tube === 'rifle' ? 9.8 : c.stock === 'none' ? 6.1 : 7.0
  const tubeLabel = g.rimfire ? 'Stock tube (no buffer)' : c.stock === 'none' ? 'Pistol buffer tube' : 'Buffer tube'
  B.add(cylX(tR, tR, tlen), 'anod', { key: 'buffer', label: tubeLabel, lab: c.stock === 'none' || g.rimfire ? 1 : 0, grp: 'lower', ex: [-1.8, 0, 0], x: tx0 - tlen })
  B.add(cylX(0.74, 0.74, 0.32, 16), 'anod', { key: 'buffer', grp: 'lower', ex: [-1.8, 0, 0], x: tx0 - 0.38 })
  B.add(cylX(0.86, 0.86, 0.06), 'steel', { key: 'buffer', grp: 'lower', ex: [-1.8, 0, 0], x: tx0 - 0.06 })
  if (c.stock === 'none') B.add(cylX(0.62, 0.62, 0.3), 'rubber', { key: 'buffer', grp: 'lower', ex: [-1.8, 0, 0], x: tx0 - tlen - 0.3 })
  let spX0: number, spLen: number
  if (g.rimfire) {
    // .22 blowback: guide rod and recoil spring behind the bolt, inside the upper receiver
    spX0 = xr + 0.15
    spLen = RIM_BOLT_X - spX0
    B.add(cylX(0.07, 0.07, spLen + 0.6), 'steel', { key: 'bcg', label: 'Recoil spring guide rod', grp: 'upper', ex: [-2.6, 7.6, 0], internal: 1, x: spX0 })
    B.add(new T.TubeGeometry(new Helix(spX0, spLen, 0.2, Math.round(spLen * 10)), 240, 0.03, 6), 'spring', { key: 'bcg', ak: 'spring', label: 'Recoil spring', grp: 'upper', ex: [-2.6, 7.6, 0], internal: 1 })
  } else {
    const bufL = 3.25
    B.add(cylX(0.47, 0.47, bufL), 'steel', { key: 'buffer', ak: 'buffer', label: 'Buffer', grp: 'lower', ex: [-2, -5, 0], internal: 1, x: tx0 - 0.3 - bufL })
    spX0 = tx0 - tlen + 0.2
    spLen = Math.max(1.2, tlen - 0.5 - bufL - 0.2)
    B.add(new T.TubeGeometry(new Helix(spX0, spLen, 0.4, Math.round(spLen * 9)), 360, 0.045, 6), 'spring', { key: 'buffer', ak: 'spring', label: 'Action spring', grp: 'lower', ex: [-2, -6.2, 0], internal: 1 })
  }
  const tRear = tx0 - tlen
  let butt = tRear, bmin = tRear, bmax = tRear
  const st = AR_STOCK[c.stock ?? 'none'] ?? AR_STOCK.none
  if (c.stock !== 'none') {
    if (st.adj) { bmax = tRear + 0.12; bmin = bmax - st.travel; butt = bmax - st.travel * clamp(c.stockPos ?? 0.4, 0, 1) }
    else butt = bmin = bmax = tRear - 0.1
    B.add(stockGeom(c.stock ?? 'ctr'), 'furn', { key: 'stock', ak: 'stock', label: rowName(g, 'stock') || st.n, lab: 1, grp: 'lower', ex: [-3.4, -0.4, 0], x: butt })
  }
  const cart = CART[g.caliber ?? ''] ?? CART['5.56 NATO']
  const D = big ? 4.0 : g.rimfire ? 2.2 : tlen > 9 ? 3.6 : 3.2
  return {
    rail, railStart: xr + 0.05, railEnd: hx + hl, hgStart: hx, hgEnd: hx + hl, hgCy: hcy, hgR: ha, muzzleX: bl, devEnd: bl + md.prot, butt, buttMin: bmin, buttMax: bmax, gripX: -2.9 * k + lx, md, recRear: xr, stockTravel: st.travel || 0,
    op: {
      type: g.rimfire ? 'blow' : 'ar', D, dU: g.rimfire ? 0 : 0.3, rot: 22.5, lockD: D - 0.55, cart, gasX: gp, ejX: (portX0 + portX1) / 2, portZ: Wd / 2 + 0.03, ejHinge: [(portX0 + portX1) / 2, 0.12 - 0.31, Wd / 2 + 0.03],
      magFront: mfx, magRearX: mfx - mg.d + 0.12, magTopY: mtop - 0.12 - cart.hd / 2, magDepth: mg.d, magW: mg.w, magCurve: mg.R || 0, magLen: mg.len, magDrum: mg.drum || 0, magDr: mg.dr || 0,
      hammer: [hmX, hmY + 0.08], trig: [trX - 0.1, trY + 0.02], catchP: [ctX - 0.45, ctY], safety: [safX, safY], take: [xf - 0.2, low0 - 0.25], spring: { x0: spX0, len: spLen }, chTravel: D + 0.2, ejectDir: 1, chamberX: 0,
    },
  }
}

// ---------- AK ----------
export function buildAK(g: EngGun, B: Builder, cat: Cat): Info {
  const c = g.cfg, bl = c.barrel ?? 16.3, furn = c.furn === 'wood' || c.hgStyle === 'wood' ? 'wood' : 'furn', blow = g.caliber === '9mm'
  const Lw: AddOpts = { grp: 'lower', ex: [0, -1.2, 0] }, U: AddOpts = { grp: 'upper', ex: [0, 3.4, 0] }
  B.add(ext([[-7.9, -1.0], [1.95, -1.0], [1.95, 0.55], [-7.9, 0.55]], 1.14, 0.03), 'anod', { key: 'lower', label: 'Receiver', lab: 1, ...Lw })
  B.add(ext([[0, 0], [2.0, 0], [2.0, 0.6], [0.2, 0.6]], 1.1, 0.03), 'anod', { key: 'lower', x: 1.9, y: -0.2, ...Lw })
  B.add(extX([...arc(0, 0.52, 0.56, 0, Math.PI, 16), [-0.56, 0.45], [0.56, 0.45]], 9.3), 'anod', { key: 'upper', ak: 'cover', label: 'Dust cover', lab: 1, x: -7.75, ...U })
  const railTop = 1.08 + 0.2
  if (c.rail) B.rail(-6.8, 1.2, railTop, { key: 'upper', ak: 'cover', ...U })
  const BC: AddOpts = { grp: 'upper', ex: [-1, 5.6, 0] }
  B.add(box(0.9, 0.45, 0.5), 'steel', { key: 'bcg', ak: 'carrier', x: -1.7, y: 0.15, z: 0.82, label: 'Charging handle', lab: 1, ...BC })
  B.add(cylX(0.42, 0.42, 6.2), 'steel', { key: 'bcg', ak: 'carrier', label: 'Bolt carrier', lab: 1, x: -7.4, y: 0.05, internal: 1, ...BC })
  B.add(cylX(0.3, 0.3, 1.6), 'chrome', { key: 'bcg', ak: 'bolt', x: -1.6, internal: 1, ...BC })
  ;[0, Math.PI].forEach((a) => B.add(box(0.3, 0.14, 0.16), 'chrome', { key: 'bcg', ak: 'bolt', x: -0.18, y: 0.3 * Math.cos(a), z: 0.3 * Math.sin(a), internal: 1, ...BC }))
  B.add(cylX(0.32, 0.32, 1.0), 'steel', { key: 'barrel', x: -0.3, internal: 1, grp: 'upper', ex: [2.5, 5, 0] })
  B.add(cylX(0.36, 0.33, bl - 2.2), 'barrel', { key: 'barrel', label: 'Barrel', lab: 1, grp: 'upper', ex: [2.5, 5.0, 0], x: 2.2 })
  const gb = Math.min(bl - 1.6, 9.3)
  if (c.akGas !== false && !blow) {
    B.add(cylX(0.17, 0.17, gb - 1.2), 'steel', { key: 'bcg', ak: 'carrier', x: -1.2 + 0.1, y: 0.82, internal: 1, ...BC })
    B.add(cylX(0.34, 0.34, gb - 3.0), 'steel', { key: 'gas', grp: 'upper', ex: [1.5, 6.2, 0], x: 3.0, y: 0.82 })
    B.add(box(1.2, 1.3, 0.9), 'steel', { key: 'gas', label: 'Gas block', lab: 1, grp: 'upper', ex: [1.5, 6.2, 0], x: gb + 0.3, y: 0.4 })
    B.add(extX(rr(-0.55, 0.45, 0.55, 1.25, 0.25), gb - 3.6), furn, { key: 'gas', grp: 'upper', ex: [1.5, 6.2, 0], x: 3.1 })
  }
  B.add(ext([[0, -0.02], [0.9, -0.02], [1.2, 0.32], [0.2, 0.45]], 0.7, 0.03), 'steel', { key: 'lower', grp: 'lower', ex: [0, -1.2, 0], x: 2.2, y: 0.55 })
  B.add(box(0.7, 1.2, 0.55), 'steel', { key: 'barrel', grp: 'upper', ex: [2.5, 5, 0], x: bl - 0.9, y: 0.35 })
  const hgL = Math.min(gb - 2.6, bl - 3.2)
  if (c.hgStyle === 'mlok' || c.hgStyle === 'quad') B.add(extX(octSec(0.95, 0.2), hgL + 1.4), 'anod', { key: 'hg', label: 'Handguard', lab: 1, grp: 'upper', ex: [1, 6, 0], x: 2.6 })
  else B.add(extX([...arc(0, 0, 0.95, -Math.PI * 0.1, -Math.PI * 0.9, 14), ...arc(0, 0, 0.7, -Math.PI * 0.85, -Math.PI * 0.15, 10)].map((p) => [p[0], p[1] + 0.25] as P2), hgL), furn, { key: 'hg', label: 'Handguard', lab: 1, grp: 'upper', ex: [1, 6, 0], x: 2.6 })
  B.add(box(0.5, 0.4, 1.25), 'steel', { key: 'hg', grp: 'upper', ex: [1, 6, 0], x: 2.45, y: -0.35 })
  const md = mzOf(cat, c.muzzle, c)
  addMuzzle(B, md, bl, { key: 'muzzle', label: rowName(g, 'muzzle') || mzLabel(md), lab: 1, grp: 'upper', ex: [5.2, 2.6, 0] })
  B.add(ext([[-0.2, -1.0], [0.2, -1.0], [0.1, -1.65], [-2.6, -1.6], [-2.6, -1.0], [-2.3, -1.0], [-2.3, -1.45], [-0.1, -1.45]], 0.35, 0.02), 'steel', { key: 'lower', x: -2.3, ...Lw })
  B.add(ext([[0, 0], [-0.2, 0], [-0.35, -0.5], [-0.25, -0.85], [-0.13, -0.85], [-0.2, -0.5]], 0.22, 0.02), 'dark', { key: 'trigger', ak: 'trigger', label: 'Trigger', lab: 1, grp: 'lower', ex: [0, -4.2, 0], x: -3.35, y: -0.9 })
  B.add(ext([[-0.25, 0], [0.2, 0], [0.3, 0.6], [0.05, 0.8], [-0.2, 0.55]], 0.3, 0.02), 'steel', { key: 'trigger', ak: 'hammer', label: 'Hammer', grp: 'lower', ex: [0, -4.2, 0], x: -4.3, y: -0.85, internal: 1 })
  B.add(ext([[-4.0, -1.0], [-5.1, -1.0], [-6.2, -4.7], [-5.3, -4.95], [-4.4, -1.9]], 1.15, 0.1), 'furn', { key: 'grip', label: 'Pistol grip', lab: 1, grp: 'lower', ex: [-1.2, -3.6, 0] })
  B.add(ext([[0, -0.08], [5.6, -0.13], [5.6, 0.27], [0, 0.22]], 0.08, 0.01), 'steel', { key: 'safety', ak: 'safety', label: 'Safety lever', x: -6.6, y: -0.15, z: 0.62, ...Lw })
  const mg = MAGS[c.mag ?? ''] ?? MAGS.ak30, isG = !!c.mag?.startsWith('glock'), mfx = isG ? 0.35 : 1.6
  magGeom(mfx, -0.6, mg).forEach((geo, i) => B.add(geo, 'mag', { key: 'mag', ak: 'mag', label: i ? null : 'Magazine', lab: !i, grp: 'lower', ex: [0.6, -4.6, 0] }))
  let butt = -7.9, bmin = butt, bmax = butt
  if (c.stock === 'fixed') {
    butt = bmin = bmax = -7.9 - 9.6
    B.add(ext([[0, -3.3], [0, 1.0], [0.6, 1.05], [9.6, 0.45], [9.6, -1.0], [8.9, -1.1], [0.7, -3.4]], 1.4, 0.12), furn, { key: 'stock', ak: 'stock', label: rowName(g, 'stock') || 'Stock', lab: 1, grp: 'lower', ex: [-3.4, -0.4, 0], x: butt, y: -0.2 })
  } else if (c.stock === 'folder') {
    butt = bmin = bmax = -7.9 - 9.3
    B.add(ext([[0, -2.8], [0, 0.8], [0.5, 0.8], [0.5, -0.3], [8.6, -0.1], [9.3, 0.3], [9.3, -0.7], [0.5, -2.3], [0.5, -2.8]], 0.9, 0.05), 'anod', { key: 'stock', ak: 'stock', label: 'Side folder', lab: 1, grp: 'lower', ex: [-3.4, -0.4, 0], x: butt })
  } else if (c.stock === 'brace') {
    butt = bmin = bmax = -7.9 - 7.0
    B.add(cylX(0.55, 0.55, 6.4), 'anod', { key: 'stock', ak: 'stock', grp: 'lower', ex: [-3.4, -0.4, 0], x: butt + 0.6 })
    B.add(stockGeom('brace'), 'furn', { key: 'stock', ak: 'stock', label: 'Brace', lab: 1, grp: 'lower', ex: [-3.4, -0.4, 0], x: butt })
  } else B.add(ext([[0, -0.9], [0.5, -0.9], [0.5, 0.5], [0, 0.5]], 0.9, 0.05), 'steel', { key: 'lower', x: -8.4, ...Lw })
  if (c.stock === 'none') butt = bmin = bmax = -8.4
  const cart = CART[g.caliber ?? ''] ?? CART['7.62x39']
  return {
    rail: c.rail ? railTop : 1.08, railStart: -6.8, railEnd: c.rail ? 1.2 : -6.8, hgStart: 2.6, hgEnd: 2.6 + hgL, hgCy: 0.25, hgR: 0.95, muzzleX: bl, devEnd: bl + md.prot, butt, buttMin: bmin, buttMax: bmax, gripX: -3.5, md, recRear: -7.9, noRail: !c.rail,
    op: {
      type: blow ? 'blow' : 'ak', D: blow ? 3.2 : 4.4, dU: blow ? 0 : 0.35, rot: 35, lockD: 3.8, cart, gasX: blow ? null : gb, ejX: -2.0, portZ: 0.6, magFront: mfx, magRearX: mfx - mg.d + 0.12, magTopY: -0.6 - 0.12 - cart.hd / 2, magDepth: mg.d, magW: mg.w, magCurve: mg.R || 0, magLen: mg.len, magDrum: mg.drum || 0, magDr: mg.dr || 0, magRock: !isG,
      hammer: [-4.3, -0.8], trig: [-3.45, -0.88], safety: [-6.6, 0.05], take: null, stockHinge: [-7.9, 0.6], chTravel: 4.4, chamberX: 0, rail: railTop,
    },
  }
}

// ---------- MP5 ----------
export function buildMP5(g: EngGun, B: Builder, cat: Cat): Info {
  const c = g.cfg, bl = c.barrel ?? 8.9, U: AddOpts = { grp: 'upper', ex: [0, 3.2, 0] }, Lw: AddOpts = { grp: 'lower', ex: [0, -1.8, 0] }
  const rx0 = -9.3, rx1 = 1.4
  B.add(extX(rr(-0.6, -0.75, 0.6, 0.62, 0.3), rx1 - rx0), 'anod', { key: 'upper', label: 'Receiver', lab: 1, x: rx0, ...U })
  B.add(cylX(0.32, 0.32, 7.4), 'anod', { key: 'upper', label: 'Cocking tube', x: rx1 - 0.1, y: 0.95, ...U })
  B.add(ext([[0, -0.15], [0.15, -0.15], [0.15, 0.15], [0, 0.15]], 1.25, 0.02), 'steel', { key: 'ch', ak: 'ch', label: 'Cocking handle', lab: 1, x: rx1 + 3.2, y: 1.0, z: -0.2, ...U })
  B.rail(-6.8, -0.2, 1.3, { key: 'upper', mat: 'anod', ...U })
  B.add(ext([[0, 0.62], [0.8, 0.62], [0.7, 1.45], [0.1, 1.45]], 0.6, 0.03), 'steel', { key: 'upper', x: -8.6, ...U })
  B.add(extX([...arc(0, 1.25, 0.4, 0, Math.PI, 12), [-0.4, 0.7], [0.4, 0.7]], 0.6), 'steel', { key: 'upper', x: rx1 + 6.6, ...U })
  B.add(cylX(0.5, 0.5, 6.2), 'chrome', { key: 'bcg', ak: 'carrier', label: 'Bolt carrier', lab: 1, grp: 'upper', ex: [-2.5, 6, 0], internal: 1, x: -7.4 })
  B.add(cylX(0.36, 0.36, 1.2), 'chrome', { key: 'bcg', ak: 'bolt', grp: 'upper', ex: [-2.5, 6, 0], internal: 1, x: -1.2 })
  ;[-1, 1].forEach((s) => B.add(new T.CylinderGeometry(0.12, 0.12, 0.2, 10), 'steel', { key: 'bcg', ak: 'bolt', label: 'Locking rollers', grp: 'upper', ex: [-2.5, 6, 0], internal: 1, x: -0.7, z: s * 0.42, rx: Math.PI / 2 }))
  B.add(cylX(0.36, 0.34, bl - 0.4), 'barrel', { key: 'barrel', label: 'Barrel', lab: 1, grp: 'upper', ex: [2.6, 4.8, 0], x: 0.4 })
  const hgL = Math.min(6.3, bl - 1.6)
  B.add(extX(c.hgStyle === 'mlok' ? octSec(0.95, 0.2) : rr(-0.85, -1.0, 0.85, 0.7, 0.35), hgL), c.hgStyle === 'mlok' ? 'anod' : 'furn', { key: 'hg', label: 'Handguard', lab: 1, grp: 'upper', ex: [1, 5.6, 0], x: rx1 + 0.2 })
  const md = mzOf(cat, c.muzzle, c)
  addMuzzle(B, md, bl, { key: 'muzzle', label: rowName(g, 'muzzle') || mzLabel(md), lab: 1, grp: 'upper', ex: [5.2, 2.6, 0] })
  B.add(ext([[-1.1, -0.7], [1.2, -0.7], [1.1, -2.0], [-1.0, -2.0]], 1.05, 0.04), 'anod', { key: 'lower', label: 'Magwell', x: -0.3, ...Lw })
  B.add(ext([[-2.6, -0.75], [-7.4, -0.75], [-7.6, -1.3], [-8.2, -5.0], [-7.2, -5.3], [-6.4, -2.1], [-4.4, -2.0], [-4.3, -2.9], [-2.7, -2.95], [-2.5, -1.4]], 1.25, 0.06, [[[-2.85, -1.85], [-4.15, -1.85], [-4.15, -2.65], [-2.9, -2.65]]]), 'furn', { key: 'lower', label: 'Trigger group', lab: 1, grp: 'lower', ex: [0, -2.2, 0] })
  B.add(ext([[0, 0], [-0.2, 0], [-0.33, -0.5], [-0.24, -0.8], [-0.12, -0.8], [-0.18, -0.5]], 0.22, 0.02), 'dark', { key: 'trigger', ak: 'trigger', label: 'Trigger', lab: 1, grp: 'lower', ex: [0, -4.4, 0], x: -3.1, y: -1.75 })
  B.add(ext([[-0.25, 0], [0.2, 0], [0.3, 0.6], [0.05, 0.8], [-0.2, 0.55]], 0.3, 0.02), 'steel', { key: 'trigger', ak: 'hammer', label: 'Hammer', grp: 'lower', ex: [0, -4.2, 0], x: -4.0, y: -1.45, internal: 1 })
  const mg = MAGS[c.mag ?? ''] ?? MAGS.mp5_30
  magGeom(0.75, -1.0, mg).forEach((geo, i) => B.add(geo, 'mag', { key: 'mag', ak: 'mag', label: i ? null : 'Magazine', lab: !i, grp: 'lower', ex: [0.6, -4.6, 0] }))
  let butt = rx0 - 0.2, bmin = butt, bmax = butt
  if (c.stock !== 'none') {
    const tr = 3.0
    bmax = rx0 - 7.4; bmin = bmax - tr; butt = bmax - tr * clamp(c.stockPos ?? 0, 0, 1)
    ;[0.45, -0.45].forEach((z) => B.add(cylX(0.22, 0.22, 7.6), 'steel', { key: 'stock', ak: 'stock', grp: 'lower', ex: [-3.4, -0.4, 0], x: butt + 0.4, y: 0.4, z }))
    B.add(ext(c.stock === 'sl' ? [[0, 1.0], [0, -3.6], [0.8, -3.7], [1.4, -1.2], [1.4, 1.0]] : [[0, 0.9], [0, -3.4], [0.6, -3.5], [1.0, -1.0], [1.0, 0.9]], 1.4, 0.08), 'furn', { key: 'stock', ak: 'stock', label: c.stock === 'sl' ? 'Magpul SL stock' : 'Collapsing brace', lab: 1, grp: 'lower', ex: [-3.4, -0.4, 0], x: butt })
  } else B.add(ext([[0, -0.7], [0.4, -0.7], [0.4, 0.6], [0, 0.6]], 1.1, 0.05), 'anod', { key: 'lower', x: rx0 - 0.4, ...Lw })
  const cart = CART[g.caliber ?? ''] ?? CART['9mm']
  return {
    rail: 1.3, railStart: -6.8, railEnd: -0.2, hgStart: rx1 + 0.2, hgEnd: rx1 + 0.2 + hgL, hgCy: c.hgStyle === 'mlok' ? 0.2 : -0.15, hgR: 0.9, muzzleX: bl, devEnd: bl + md.prot, butt, buttMin: bmin, buttMax: bmax, gripX: -3.4, md, recRear: rx0, stockTravel: c.stock === 'none' ? 0 : 3.0,
    op: {
      type: 'mp5', D: 3.6, dU: 0.12, rot: 0, lockD: 3.0, cart, gasX: null, ejX: -1.6, portZ: 0.62, magFront: 0.75, magRearX: 0.75 - mg.d + 0.1, magTopY: -1.0 - 0.12 - cart.hd / 2, magDepth: mg.d, magW: mg.w, magCurve: mg.R || 0, magLen: mg.len, magDrum: mg.drum || 0, magDr: mg.dr || 0,
      hammer: [-4.0, -1.37], trig: [-3.2, -1.73], take: null, chTravel: 3.6, chamberX: 0, chLock: true,
    },
  }
}

// ---------- striker pistol ----------
export function buildPistol(g: EngGun, B: Builder, cat: Cat): Info {
  const c = g.cfg, bl = c.barrel ?? 4.02, sl = c.slide || 7.28, h = c.height || 5.04
  const sx1 = bl + 0.26, sx0 = sx1 - sl, sTop = 0.78, sBot = -0.4
  const U: AddOpts = { grp: 'upper', ex: [0, 2.0, 0], ak: 'slide' }, Lw: AddOpts = { grp: 'lower', ex: [0, -0.8, 0] }
  // Performance Center lightening cuts: windows through the slide that show the barrel
  const cuts: P2[][] = c.cuts ? [0, 1, 2].map((i) => { const x0 = sx1 - 3.55 + i * 0.55; return [[x0, 0.02], [x0 + 0.42, 0.02], [x0 + 0.42, 0.5], [x0, 0.5]] as P2[] }) : []
  B.add(ext([[sx0, sBot], [sx1, sBot], [sx1, sTop - 0.12], [sx1 - 0.15, sTop], [sx0 + 0.1, sTop], [sx0, sTop - 0.1]], 1.0, 0.06, cuts.length ? cuts : null), 'slide', { key: 'slide', label: 'Slide', lab: 1, ...U })
  if (c.opticPlate) B.add(box(1.3, 0.06, 0.72), 'dark', { key: 'slide', label: 'Optic-ready cover plate', x: sx0 + 1.45, y: sTop + 0.03, ...U })
  for (let i = 0; i < 7; i++) {
    B.add(box(0.07, 0.8, 1.03), 'dark', { key: 'slide', x: sx0 + 0.35 + i * 0.18, y: 0.18, ...U })
    B.add(box(0.07, 0.55, 1.03), 'dark', { key: 'slide', x: sx1 - 1.6 + i * 0.17, y: 0.12, ...U })
  }
  B.add(box(1.5, 0.5, 0.06), 'dark', { key: 'slide', x: -0.2, y: 0.3, z: 0.51, ...U })
  B.add(box(0.12, 0.22, 0.14), 'dark', { key: 'slide', x: sx1 - 0.3, y: sTop + 0.1, ...U })
  B.add(box(0.2, 0.2, 0.42), 'dark', { key: 'slide', x: sx0 + 0.35, y: sTop + 0.1, ...U })
  B.add(cylX(0.08, 0.08, 1.6), 'steel', { ...U, key: 'slide', ak: 'striker', label: 'Striker', x: sx0 + 0.25, y: 0, internal: 1 })
  const prot = c.threaded ? 0.55 : 0
  // A gold or other coloured barrel shows through the ejection port, so draw it outside the slide's x-ray set.
  B.add(cylX(0.3, 0.3, bl + 0.4 + prot), 'barrel', { key: 'barrel', ak: 'barrel', label: 'Barrel', lab: 1, grp: 'upper', ex: [1.5, 3.6, 0], x: -0.4, internal: !c.threaded && !c.cuts })
  B.add(box(1.0, 0.55, 0.7), 'barrel', { key: 'barrel', ak: 'barrel', grp: 'upper', ex: [1.5, 3.6, 0], x: -0.05, y: 0.28, internal: 1 })
  B.add(cylX(0.2, 0.2, bl - 0.8), 'spring', { key: 'spring', ak: 'rspring', label: 'Recoil spring', grp: 'upper', ex: [1, -2.2, 0], internal: 1, x: 0.2, y: -0.55 })
  const md = c.threaded ? mzOf(cat, c.muzzle, c, true) : mzOf(cat, null)
  if (c.threaded && md.st !== 'none') addMuzzle(B, md, bl + prot, { key: 'muzzle', ak: 'barrel', label: rowName(g, 'muzzle') || mzLabel(md), lab: 1, grp: 'upper', ex: [3, 3, 0] })
  const ga = (22 * Math.PI) / 180, gl = h - 1.25, gx = sx0 + 1.2
  const gb: P2 = [gx - Math.sin(ga) * gl, -0.95 - Math.cos(ga) * gl]
  B.add(ext([[sx1 - 0.05, -0.4], [sx1 - 0.05, -0.98], [0.65, -0.98], [0.5, -1.08], [0.35, -1.95], [-0.25, -2.0], [-1.0, -1.95], [-1.1, -1.25], [gx + 0.62, -1.25], [gb[0] + 1.3, gb[1] + 0.12], [gb[0] + 1.25, gb[1] - 0.12], [gb[0] - 0.45, gb[1] - 0.12], [gb[0] - 0.42, gb[1] + 0.25], [sx0 - 0.1, -0.95], [sx0 - 0.35, -0.62], [sx0 + 0.1, -0.4]], 1.18, 0.08, [[[0.25, -1.1], [-1.0, -1.15], [-0.95, -1.8], [-0.2, -1.85], [0.2, -1.6]]]), c.frame === 'fde' ? 'fdep' : c.metal ? 'anod' : 'poly', { key: 'frame', label: 'Frame', lab: 1, grp: 'lower', ex: [0, -1.2, 0] })
  B.rail(0.8, sx1 - 0.35, -0.81, { key: 'frame', mat: c.metal ? 'anod' : 'poly', ...Lw }, 0, 0.75, Math.PI, -0.98)
  B.add(ext([[0, 0], [-0.15, 0], [-0.27, -0.45], [-0.2, -0.7], [-0.1, -0.7], [-0.13, -0.45]], 0.26, 0.02), 'dark', { key: 'trigger', ak: 'trigger', label: 'Trigger', lab: 1, grp: 'lower', ex: [0, -2.4, 0], x: -0.35, y: -1.1 })
  B.add(box(0.9, 0.14, 0.1), 'dark', { key: 'frame', ak: 'sstop', label: 'Slide stop', grp: 'lower', ex: [0, -1.2, 0], x: -0.15, y: -0.5, z: -0.62 })
  // magazine body inside the grip + base pad
  const mlen = gl + 0.25, mAxis = [-Math.sin(ga), -Math.cos(ga)], mTop: P2 = [gx + 0.35, -0.75]
  const mgeo = new T.BoxGeometry(1.1, mlen, 0.85)
  mgeo.translate(0, -mlen / 2, 0)
  mgeo.rotateZ(-ga)
  B.add(mgeo, 'mag', { key: 'mag', ak: 'mag', label: 'Magazine', grp: 'lower', ex: [0, -2.8, 0], x: mTop[0], y: mTop[1], internal: 1 })
  B.add(ext([[0, 0], [1.25, 0], [1.25, -0.35], [0, -0.35]], 1.12, 0.03), 'poly', { key: 'mag', ak: 'mag', label: 'Magazine base', lab: 1, grp: 'lower', ex: [0, -2.8, 0], x: gb[0] - 0.2, y: gb[1] - 0.05, rz: -ga * 0.2 })
  const cart = CART[g.caliber ?? ''] ?? CART['9mm']
  return {
    pistol: true, rail: sTop, railStart: sx0 + 0.5, railEnd: sx0 + 2.4, slideTop: sTop, hgStart: 0.8, hgEnd: sx1 - 0.35, hgCy: -1.55, hgR: 0.25, muzzleX: bl + prot, devEnd: bl + prot + (c.threaded ? md.prot : 0) + 0.05, butt: sx0 - 0.15, buttMin: sx0 - 0.15, buttMax: sx0 - 0.15, gripX: -0.4, md, recRear: sx0, height: h,
    op: { type: 'pistol', D: 1.75, dU: 0.12, tilt: 3.5, cart, ejX: -0.2, portZ: 0.52, barrelPiv: [bl - 0.3, 0], magTop: mTop, magAxis: mAxis, magRearX: mTop[0] - 0.62, magTopY: -0.85, magLen: mlen, magW: 0.85, magDepth: 1.1, trig: [-0.4, -1.08], sstop: [-0.55, -0.5], striker: [sx0 + 0.25, 1.6], chamberX: 0, magAng: ga },
  }
}

// ---------- semi-auto shotgun ----------
export function buildSG(g: EngGun, B: Builder, cat: Cat): Info {
  const c = g.cfg, bl = c.barrel ?? 18.5, Lw: AddOpts = { grp: 'lower', ex: [0, -1.2, 0] }
  B.add(ext([[-4.2, -1.2], [3.6, -1.2], [3.9, -0.9], [3.9, 0.7], [3.4, 1.0], [-3.9, 1.0], [-4.2, 0.6]], 1.3, 0.08, [[[1.0, -1.2], [3.0, -1.2], [3.0, -1.0], [1.0, -1.0]]]), 'anod', { key: 'lower', label: 'Receiver', lab: 1, grp: 'lower', ex: [0, -1, 0] })
  B.rail(-3.6, 3.3, 1.3, { key: 'lower', ...Lw })
  B.add(box(0.9, 0.5, 0.45), 'steel', { key: 'bcg', ak: 'carrier', label: 'Charging handle', lab: 1, grp: 'upper', ex: [-1, 4, 0], x: 0.3, y: 0.1, z: 0.85 })
  B.add(cylX(0.58, 0.58, 6.0), 'chrome', { key: 'bcg', ak: 'carrier', label: 'Bolt + carrier', grp: 'upper', ex: [-1, 4, 0], internal: 1, x: -6.0 })
  B.add(cylX(0.42, 0.42, 1.0), 'chrome', { key: 'bcg', ak: 'bolt', grp: 'upper', ex: [-1, 4, 0], internal: 1, x: -1.0 })
  B.add(cylX(0.46, 0.43, bl), 'barrel', { key: 'barrel', label: 'Barrel', lab: 1, grp: 'upper', ex: [2, 4.2, 0], x: 0 })
  const tubeN = typeof c.tube === 'number' ? c.tube : Number(c.tube) || 7
  const te = 3.9 + 7.6 + tubeN * 0.62
  B.add(cylX(0.5, 0.5, te - 3.9), 'steel', { key: 'tube', label: 'Magazine tube', lab: 1, grp: 'upper', ex: [2, -2.4, 0], x: 3.9, y: -0.98 })
  B.add(extX(rr(-0.82, -1.65, 0.82, -0.2, 0.45), 7.2), 'furn', { key: 'hg', label: 'Forend', lab: 1, grp: 'upper', ex: [1, -4, 0], x: 4.2 })
  B.add(ext([[-0.4, 0.48], [0.4, 0.48], [0.3, 1.05], [-0.3, 1.05]], 0.6, 0.04), 'steel', { key: 'barrel', grp: 'upper', ex: [2, 4.2, 0], x: bl - 0.8 })
  B.add(ext([[-2.6, -1.2], [-0.2, -1.2], [-0.3, -1.85], [-2.55, -1.8]], 0.4, 0.03, [[[-2.35, -1.35], [-0.45, -1.35], [-0.5, -1.68], [-2.32, -1.65]]]), 'poly', { key: 'trigger', ...Lw })
  B.add(ext([[0, 0], [-0.18, 0], [-0.3, -0.48], [-0.22, -0.72], [-0.1, -0.72], [-0.15, -0.48]], 0.24, 0.02), 'dark', { key: 'trigger', ak: 'trigger', label: 'Trigger', lab: 1, grp: 'lower', ex: [0, -3.6, 0], x: -0.8, y: -1.0 })
  B.add(ext([[-0.25, 0], [0.2, 0], [0.3, 0.6], [0.05, 0.8], [-0.2, 0.55]], 0.3, 0.02), 'steel', { key: 'trigger', ak: 'hammer', label: 'Hammer', grp: 'lower', ex: [0, -4.2, 0], x: -2.1, y: -1.0, internal: 1 })
  const butt = -4.2 - 10.8
  B.add(ext([[0, -4.6], [0, 1.0], [0.8, 1.1], [10.6, 0.75], [10.8, 0.6], [10.8, -0.95], [9.9, -1.35], [9.2, -4.3], [8.3, -4.5], [7.6, -2.0], [1.0, -4.7]], 1.6, 0.14), 'furn', { key: 'stock', label: rowName(g, 'stock') || 'Stock', lab: 1, grp: 'lower', ex: [-3.4, -0.4, 0], x: butt, y: 0.2 })
  const md = mzOf(cat, c.muzzle, c)
  return {
    rail: 1.3, railStart: -3.6, railEnd: 3.3, hgStart: 4.2, hgEnd: 11.4, hgCy: -0.95, hgR: 0.85, muzzleX: bl, devEnd: bl, butt, buttMin: butt, buttMax: butt, gripX: -0.9, md, recRear: -4.2,
    op: { type: 'sg', D: 3.0, dU: 0.2, rot: 30, lockD: 2.6, cart: CART['12 ga'], gasX: null, ejX: -1.4, portZ: 0.66, tubeY: -0.98, tubeX0: 3.9, tubeEnd: te, magRearX: -0.9, magTopY: -0.98, hammer: [-2.1, -0.9], trig: [-0.9, -0.98], take: null, chTravel: 3.0, chamberX: 0, shellCap: tubeN },
  }
}
