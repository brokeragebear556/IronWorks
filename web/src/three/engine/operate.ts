/* Operation engine: how each action moves the parts, as a timeline of poses.
   Illustrative cycle-of-operation timing: distances in inches, time in ms. Ported from the
   single-file workbench. Poses name parts by their animation key (mesh userData.ak). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EngGun } from './data'
import { defaultPos } from './attachments'
import type { Info } from './platforms'

export interface OpState {
  chambered: boolean; mag: number; magIn: boolean; locked: boolean; hammer: 'cocked' | 'down'; safety: 'fire' | 'safe'
  light: boolean; laser: boolean; taken: boolean; suppOn: boolean; fold: boolean; stockD: number; portOpen: boolean; tube: number
  buisDown?: boolean; bipod?: boolean
}
export interface Anim { d?: number[]; rot?: [string, number, number[]] | null; sx?: [number, number]; hide?: boolean }
export interface Dyn {
  chamber?: boolean; chamberDx?: number; feed?: number[] | null; spent?: (number | boolean)[]; bullet?: number; bulletY?: number; bulletRz?: number
  flash?: number[]; gas?: number[]; beam?: boolean; laser?: boolean; magN?: number; magRise?: number; tubeN?: number; tubeShift?: number
}
export interface Pose { k: Record<string, Anim>; dyn: Dyn; phase: string; st: OpState; up?: [number, number[]]; slideOff?: number | null; callout?: { t: string; at: [number, number, number] } }
export type Ev = [number, string]
export interface Plan { act: string; S0: OpState; dur: number; ev: Ev[]; speed: number; pose: (t: number) => Pose; end: () => OpState }

const EZ = { in: (t: number) => t * t, out: (t: number) => 1 - (1 - t) * (1 - t), io: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2), lin: (t: number) => t }
type Ease = keyof typeof EZ
const seg = (t: number, a: number, b: number, e: Ease = 'lin') => (t <= a ? 0 : t >= b ? 1 : EZ[e]((t - a) / (b - a)))
const lerp = (a: number, b: number, f: number) => a + (b - a) * f
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const DEG = Math.PI / 180
const GRAV = 0.000386
const cloneS = (s: OpState): OpState => JSON.parse(JSON.stringify(s))

export function freshState(g: EngGun): OpState {
  const tube = typeof g.cfg.tube === 'number' ? g.cfg.tube : 7
  return { chambered: true, mag: g.cfg.magCap || 30, magIn: true, locked: false, hammer: 'cocked', safety: 'fire', light: false, laser: false, taken: false, suppOn: true, fold: false, stockD: 0, portOpen: false, tube }
}
export const phaseAt = (ev: Ev[], tt: number) => { let p = ev[0] ? ev[0][1] : ''; for (const e of ev) if (tt >= e[0]) p = e[1]; return p }

/** The resting pose for a gun state (bolt locked, mag out, safety on...). */
export function staticPose(S: OpState, I: Info, g: EngGun): Pose {
  const o = I.op as any, k: Record<string, Anim> = {}, P: Pose = { k, dyn: {}, phase: '', st: S }
  if (!o) return P
  const t = o.type
  if (['ar', 'blow', 'mp5', 'ak', 'sg'].includes(t)) {
    const d = S.locked ? o.lockD : 0, b = Math.max(0, d - (o.dU || 0))
    k.carrier = { d: [-d, 0, 0] }; k.bolt = { d: [-b, 0, 0] }
    k.buffer = { d: [-d, 0, 0] }
    if (o.spring) k.spring = { sx: [clamp((o.spring.len - d) / o.spring.len, 0.12, 1), o.spring.x0] }
    if (o.hammer) k.hammer = { rot: ['z', (S.hammer === 'down' ? -12 : 60) * DEG, [o.hammer[0], o.hammer[1], 0]] }
    if (o.ejHinge && S.portOpen) k.ejcover = { rot: ['x', 100 * DEG, o.ejHinge] }
    if (o.catchP && S.locked) k.catch = { rot: ['z', 16 * DEG, [o.catchP[0], o.catchP[1], 0]] }
    if (t === 'mp5' && S.locked) k.ch = { d: [-o.lockD, 0, 0] }
  }
  if (t === 'pistol') {
    const s = S.locked ? o.D - 0.15 : 0, B = g.cfg.barrel ?? 4
    k.slide = { d: [-s, 0, 0] }
    k.barrel = s > o.dU ? { rot: ['z', o.tilt * DEG, [o.barrelPiv[0], o.barrelPiv[1], 0]], d: [-o.dU, 0, 0] } : { d: [-s, 0, 0] }
    k.supp = k.barrel
    if (S.locked) k.sstop = { rot: ['z', 12 * DEG, [o.sstop[0], o.sstop[1], 0]] }
    k.rspring = { sx: [clamp((B - 0.8 - s) / (B - 0.8), 0.3, 1), 0.2] }
    k.striker = { d: [-s, 0, 0] }
  }
  if (o.safety) {
    const ang = t === 'ak' ? (S.safety === 'safe' ? 0 : -18 * DEG) : S.safety === 'safe' ? 0 : 90 * DEG
    k.safety = { rot: ['z', ang, [o.safety[0], o.safety[1], t === 'ak' ? 0.62 : -0.72]] }
  }
  if (!S.magIn) k.mag = { hide: true }
  if (S.taken && o.take) P.up = [-24 * DEG, [o.take[0], o.take[1], 0]]
  if (S.taken && t === 'pistol') P.slideOff = 9
  if (S.fold && o.stockHinge) k.stock = { rot: ['y', -Math.PI * 0.98, [o.stockHinge[0], 0, o.stockHinge[1]]] }
  if (S.stockD) k.stock = { d: [S.stockD, 0, 0] }
  if (!S.suppOn) k.supp = { hide: true }
  if (S.bipod) {
    const bp = g.atts.find((x) => x.k === 'bipod')
    if (bp) k.bipodLeg = { rot: ['z', -88 * DEG, [(bp.pos ?? defaultPos(bp, I)) + 1.6, I.hgCy - I.hgR - 0.55, 0]] }
  }
  if (S.buisDown) { k.buisR = { rot: ['z', 80 * DEG, [I.railStart + 0.2 + 1.3, I.rail, 0]] }; k.buisF = { rot: ['z', -80 * DEG, [I.railEnd - 1.4, I.rail, 0]] } }
  P.dyn = { chamber: S.chambered, magN: S.magIn ? S.mag : 0, beam: S.light, laser: S.laser, tubeN: t === 'sg' ? S.tube : 0 }
  return P
}

/** The actions this gun can do, with labels. */
export function actionsFor(I: Info, g: EngGun): [string, string][] {
  const o = I.op as any
  if (!o) return []
  const t = o.type, pf = I.platform, isAR = pf === 'ar15' || pf === 'ar10'
  const base: [string, string][] = [['fire', 'Fire'], ['charge', t === 'pistol' ? 'Rack slide' : t === 'mp5' ? 'Charge (cocking handle)' : 'Charge']]
  if (isAR || t === 'pistol' || t === 'sg') base.push(['lock', t === 'pistol' ? 'Lock slide back' : 'Lock bolt back'], ['release', t === 'pistol' ? 'Slide release' : 'Bolt release'])
  if (t === 'mp5') base.push(['lock', 'Lock handle in notch'], ['slap', 'HK slap'])
  if (t !== 'sg') base.push(['magswap', 'Mag change'], ['magdrop', 'Drop mag'], ['magin', 'Insert mag'])
  else base.push(['load', 'Load tube'])
  if (o.safety) base.push(['safety', 'Safety'])
  if (isAR && o.take) base.push(['takedown', 'Takedown (pivot)'], ['strip', 'Field strip BCG'])
  if (t === 'pistol') base.push(['takedown', 'Takedown'])
  if (pf === 'ak') base.push(['strip', 'Field strip'])
  if (I.stockTravel) base.push(['stock', 'Adjust stock'])
  if (g.cfg.stock === 'folder') base.push(['fold', 'Fold stock'])
  if (g.atts.some((a) => a.k === 'light' || a.k === 'plight')) base.push(['light', 'Light'])
  if (g.atts.some((a) => a.k === 'laser')) base.push(['laser', 'Laser'])
  if (g.atts.some((a) => a.k === 'supp')) base.push(['supp', 'Suppressor on/off'])
  if (g.atts.some((a) => a.k === 'buis')) base.push(['buis', 'Flip BUIS'])
  if (g.atts.some((a) => a.k === 'bipod')) base.push(['bipod', 'Deploy bipod'])
  return base
}

/** Why an action can't run right now, or null. */
export function availWhy(act: string, S: OpState, I: Info): string | null {
  if (S.taken && !['takedown', 'strip'].includes(act)) return 'Close the action first'
  if (act === 'release' && !S.locked) return 'Not locked back'
  if (act === 'lock' && S.locked) return 'Already locked back'
  if (act === 'magin' && S.magIn) return 'Mag already inserted'
  if (act === 'magdrop' && !S.magIn) return 'No mag inserted'
  if (act === 'strip' && I.platform !== 'ak' && !S.taken) return 'Open the upper first (Takedown)'
  if (act === 'slap' && !S.locked) return 'Lock the cocking handle in its notch first'
  return null
}

export function actionLabel(k: string, n: string, S: OpState, I: Info) {
  if (k === 'safety') return S.safety === 'safe' ? 'Safety to Fire' : 'Safety to Safe'
  if (k === 'takedown') return S.taken ? (I.pistol ? 'Reassemble' : 'Close upper') : n
  if (k === 'light') return S.light ? 'Light off' : 'Light on'
  if (k === 'laser') return S.laser ? 'Laser off' : 'Laser on'
  if (k === 'fold') return S.fold ? 'Unfold stock' : 'Fold stock'
  if (k === 'supp') return S.suppOn ? 'Remove suppressor' : 'Mount suppressor'
  if (k === 'buis') return S.buisDown ? 'Raise BUIS' : 'Fold BUIS'
  if (k === 'bipod') return S.bipod ? 'Stow bipod' : 'Deploy bipod'
  return n
}

export function mkPlan(act: string, S0: OpState, I: Info, g: EngGun): Plan {
  const o = I.op as any, t = o.type, c = o.cart, P0 = () => staticPose(S0, I, g)
  const plan: Plan = { act, S0, dur: 1000, ev: [], speed: 1, pose: () => P0(), end: () => cloneS(S0) }
  const ejectFlight = (P: Pose, thr: number, bAt: (x: number) => number, tEj: number, tt: number, live: boolean) => {
    if (tt < tEj) { const b = bAt(tt); P.dyn.spent = [-b, 0, 0, 0, 0, 0, live]; return }
    const tau = tt - tEj, b0 = thr
    P.dyn.spent = [-b0 - 0.02 * tau, 0.05 * tau - 0.5 * GRAV * tau * tau * 30, (o.ejectDir || 1) * (o.portZ + 0.17 * tau), 0.06 * tau, 0.35 * tau, 0.03 * tau, live]
  }
  const feedPose = (P: Pose, b: number, rearX: number = o.magRearX) => {
    const f = clamp(1 - b / Math.max(0.2, -rearX), 0, 1)
    P.dyn.feed = [lerp(rearX, 0, f), lerp(o.magTopY, 0, EZ.out(f)), 0, (I.pistol ? 6 : 9) * DEG * Math.sin(Math.PI * f)]
    return f
  }
  const callout = (P: Pose, txt: string, x: number, y: number) => { P.callout = { t: txt, at: [x, y, 0] } }
  const B = g.cfg.barrel ?? 16

  // ---------------- FIRE ----------------
  if (act === 'fire') {
    const pistol = t === 'pistol'
    const can = S0.chambered && !S0.locked && S0.safety !== 'safe' && S0.hammer !== 'down'
    const v = c.v * (B < 11 && !pistol ? 0.9 : 1)
    plan.speed = 0.01
    if (!can) {
      const why = S0.safety === 'safe' ? 'Safety engaged: trigger blocked' : S0.locked ? 'Bolt locked open: release it first' : S0.hammer === 'down' ? 'Hammer or striker down: charge to re-cock' : 'Click: chamber empty'
      const blocked = S0.safety === 'safe'
      plan.dur = 40; plan.speed = 0.05; plan.ev = [[0, 'Trigger pressed'], [6, why]]
      plan.pose = (tt) => {
        const P = P0(); P.phase = why
        const pull = blocked ? -2 : -10
        if (o.trig) P.k.trigger = { rot: ['z', pull * DEG * seg(tt, 0, 3) * (1 - seg(tt, 24, 34)), [o.trig[0], o.trig[1], 0]] }
        if (!blocked && o.hammer && S0.hammer === 'cocked') P.k.hammer = { rot: ['z', (60 - 72 * seg(tt, 3, 8, 'in')) * DEG, [o.hammer[0], o.hammer[1], 0]] }
        callout(P, why, o.trig ? o.trig[0] : 0, -2.5)
        return P
      }
      plan.end = () => { const S = cloneS(S0); if (!blocked && !S0.locked && S0.hammer === 'cocked') S.hammer = 'down'; return S }
      return plan
    }
    if (pistol) {
      const tS = 1.2, tI = 1.6, tExit = tI + B / (0.67 * v), D = o.D, dU = o.dU
      const fed = S0.magIn && S0.mag > 0, hold = !fed && S0.magIn, stopD = hold ? D - 0.15 : 0
      const tR0 = tI + 0.05, tR1 = tI + 0.6, tR2 = tI + 6.0, tR3 = tR2 + 0.6, tBat = tR3 + 8.5, tL = hold ? tR3 + 7 : tBat
      const s = (tt: number) => (tt < tR0 ? 0 : tt < tR1 ? dU * seg(tt, tR0, tR1, 'in') : tt < tR2 ? dU + (D - dU) * seg(tt, tR1, tR2, 'out') : tt < tR3 ? D : tt < tL ? D - (D - stopD) * seg(tt, tR3, tL, 'in') : stopD)
      const thr = c.cl + 0.3
      let tEj = tR2
      for (let x = tR1; x < tR2; x += 0.02) if (s(x) >= thr) { tEj = x; break }
      let tFeed = tL
      for (let x = tR3; x < tL; x += 0.02) if (s(x) <= -o.magRearX) { tFeed = x; break }
      const tReset = tL + 10
      plan.dur = tReset + 4
      plan.ev = [[0, 'Trigger break'], [tS, 'Striker released'], [tI, 'Ignition'], [tExit, 'Bullet exits'], [tR1, 'Barrel unlocks (tilt)'], [tEj, 'Ejection'], [tR2, 'Slide full rear'], ...(fed ? [[tFeed, 'Strips next round'] as Ev] : []), [tL, hold ? 'Slide locks open (empty)' : 'Returns to battery'], [tReset, 'Trigger reset']]
      plan.pose = (tt) => {
        const P = P0(), sv = s(tt)
        P.dyn.chamber = false
        P.k.slide = { d: [-sv, 0, 0] }
        P.k.barrel = sv > dU ? { rot: ['z', o.tilt * DEG * clamp((sv - dU) / 0.25, 0, 1), [o.barrelPiv[0], o.barrelPiv[1], 0]], d: [-dU, 0, 0] } : { d: [-sv, 0, 0] }
        P.k.supp = P.k.barrel
        P.k.rspring = { sx: [clamp((B - 0.8 - sv) / (B - 0.8), 0.3, 1), 0.2] }
        P.k.trigger = { rot: ['z', -8 * DEG * (seg(tt, 0, tS) * (1 - seg(tt, tReset, tReset + 2))), [o.trig[0], o.trig[1], 0]] }
        P.k.striker = { d: [-sv + 0.12 * seg(tt, tS, tI) * (1 - seg(tt, tR1, tR2)), 0, 0] }
        if (tt < tI) P.dyn.chamber = true
        if (tt >= tI && tt < tExit + 40 / v) { const xf = tt < tExit ? c.oal + (B - c.oal) * Math.pow((tt - tI) / (tExit - tI), 1.6) : B + v * (tt - tExit); P.dyn.bullet = xf + (sv > dU ? 0 : -sv) }
        const sup = !!I.suppEnd && S0.suppOn, fx = sup ? I.suppEnd! : I.devEnd
        if (tt >= tExit && tt < tExit + 1.1) { const k2 = seg(tt, tExit, tExit + 0.25) * (1 - seg(tt, tExit + 0.3, tExit + 1.1)); P.dyn.flash = [fx, (sup ? 0.3 : 0.8) * Math.max(0.05, k2), 0.9 * k2] }
        if (tt >= tI) ejectFlight(P, thr, (x) => Math.min(s(x), thr), tEj, tt, false)
        let mag = S0.mag
        if (fed && tt >= tFeed && tt < tL + 0.01) { const f = feedPose(P, sv); if (f > 0.35) mag = S0.mag - 1 }
        else if (fed && tt >= tL) { P.dyn.chamber = true; mag = S0.mag - 1 }
        P.dyn.magN = S0.magIn ? mag : 0
        if (hold && tt > tR3) P.k.sstop = { rot: ['z', 12 * DEG * seg(tt, tR3, tR3 + 2), [o.sstop[0], o.sstop[1], 0]] }
        P.phase = phaseAt(plan.ev, tt)
        callout(P, P.phase, sv > 0.05 ? -sv + 0.5 : 0, 1.6)
        return P
      }
      plan.end = () => Object.assign(cloneS(S0), { chambered: fed, mag: fed ? S0.mag - 1 : S0.mag, locked: hold, hammer: 'cocked' as const })
      return plan
    }
    // rifles, PCCs, shotguns
    const tH = t === 'ak' ? 5.5 : 4.2, tI = tH + 0.4, tExit = tI + B / (0.67 * v)
    const tPort = o.gasX ? tI + o.gasX / (0.67 * v) : null
    const dU = o.dU, D = o.D
    const tU = t === 'blow' ? tI + 0.2 : t === 'mp5' ? tI + 0.1 : t === 'sg' ? tI + 0.8 : (tPort ?? tI) + 0.3
    const vR = t === 'ak' ? 0.2 : t === 'sg' ? 0.16 : t === 'blow' ? 0.22 : 0.19, vF = t === 'ak' ? 0.17 : 0.15
    const tUe = tU + (dU ? (t === 'ak' ? 1.6 : 1.0) : 0), tB = tUe + (D - dU) / vR, tBd = tB + 1.4
    const holdCapable = t === 'ar' || t === 'sg' || (t === 'blow' && g.rimfire)
    const fed = t === 'sg' ? S0.tube > 0 : S0.magIn && S0.mag > 0, hold = !!holdCapable && !fed && (t === 'sg' || S0.magIn), stopD = hold ? o.lockD : 0
    const tBat = tBd + (D - Math.max(dU, stopD)) / vF, tL = hold ? tBat : tBat + (dU ? 0.8 : 0.2), tReset = tL + 14
    plan.dur = tReset + 4
    const d = (tt: number) => (tt < tU ? 0 : tt < tUe ? dU * seg(tt, tU, tUe, 'in') : tt < tB ? dU + (D - dU) * seg(tt, tUe, tB, 'out') : tt < tBd ? D : tt < tBat ? D - (D - Math.max(dU, stopD)) * seg(tt, tBd, tBat, 'in') : !hold && tt < tL ? dU * (1 - seg(tt, tBat, tL, 'out')) : hold ? stopD : 0)
    const bOf = (tt: number) => Math.max(0, d(tt) - dU)
    const thr = c.cl + 0.35
    let tEj = tB
    for (let x = tUe; x < tB; x += 0.02) if (bOf(x) >= thr) { tEj = x; break }
    let tFeed = tL, tCock = tB
    for (let x = tBd; x < tBat; x += 0.02) if (bOf(x) <= -o.magRearX) { tFeed = x; break }
    for (let x = tU; x < tB; x += 0.02) if (d(x) >= 2.2) { tCock = x; break }
    plan.ev = [[0, 'Trigger break'], [tH, 'Hammer strikes firing pin'], [tI, 'Ignition'], ...(tPort ? [[tPort, 'Bullet passes gas port'] as Ev] : []), [tExit, 'Bullet exits muzzle'], [tU, dU ? 'Carrier unlocks bolt' : 'Bolt moves rearward'], ...(dU ? [[tUe, 'Bolt unlocked, extraction'] as Ev] : []), [tEj, 'Ejection'], [tB, t === 'sg' ? 'Bolt full rear' : t === 'blow' ? 'Bolt reaches full rear (recoil spring compressed)' : t === 'ak' ? 'Carrier hits the rear trunnion' : t === 'mp5' ? 'Bolt full rear' : 'Buffer bottoms out'], ...(fed ? [[tFeed, t === 'sg' ? 'Shell lifted and fed' : 'Strips next round'] as Ev] : []), [tL, hold ? 'Bolt locks open (empty)' : 'Locked, in battery'], [tReset, 'Trigger reset']]
    plan.pose = (tt) => {
      const P = P0(), dv = d(tt), b = Math.max(0, dv - dU)
      P.k.carrier = { d: [-dv, 0, 0] }
      P.k.bolt = { d: [-b, 0, 0], rot: dU ? ['x', o.rot * DEG * clamp(dv / dU, 0, 1), [0, 0, 0]] : null }
      if (o.spring) { P.k.buffer = { d: [-dv, 0, 0] }; P.k.spring = { sx: [clamp((o.spring.len - dv) / o.spring.len, 0.12, 1), o.spring.x0] } }
      if (!S0.portOpen && o.ejHinge) P.k.ejcover = { rot: ['x', 100 * DEG * seg(tt, tU, tU + 1.2), o.ejHinge] }
      let ham = 60
      if (tt < 0.3) ham = 60
      else if (tt < tH) ham = 60 - 72 * seg(tt, 0.3, tH, 'in')
      else if (tt < tCock) ham = -12 + 74 * clamp((dv - 0.6) / 1.6, 0, 1)
      else ham = tt < tReset ? 63 : 60
      if (o.hammer) P.k.hammer = { rot: ['z', ham * DEG, [o.hammer[0], o.hammer[1], 0]] }
      if (o.trig) P.k.trigger = { rot: ['z', -10 * DEG * seg(tt, 0, 0.3) * (1 - seg(tt, tReset, tReset + 3)), [o.trig[0], o.trig[1], 0]] }
      P.dyn.chamber = tt < tI
      if (tt >= tI && tt < tExit + 60 / v) P.dyn.bullet = tt < tExit ? c.oal + (B - c.oal) * Math.pow((tt - tI) / (tExit - tI), 1.6) : B + v * (tt - tExit)
      if (tPort && tt >= tPort && tt < tPort + 2.5) P.dyn.gas = [o.gasX, t === 'ak' ? 0.82 : 0.66, 0.5 + 1.2 * seg(tt, tPort, tPort + 0.6) * (1 - seg(tt, tPort + 1, tPort + 2.5))]
      const sup = !!I.suppEnd && S0.suppOn, fx = sup ? I.suppEnd! : I.devEnd
      if (tt >= tExit && tt < tExit + 1.3) { const k2 = seg(tt, tExit, tExit + 0.25) * (1 - seg(tt, tExit + 0.35, tExit + 1.3)); P.dyn.flash = [fx, (sup ? 0.35 : t === 'sg' ? 1.5 : 1.0) * Math.max(0.05, k2), 0.9 * k2] }
      if (tt >= tI) ejectFlight(P, thr, (x) => Math.min(bOf(x), thr), tEj, tt, false)
      let mag = S0.mag, tube = S0.tube
      if (t === 'sg') {
        if (fed) {
          if (tt >= tB && tt < tBd + 2) { const f = seg(tt, tB, tBd + 2); P.dyn.feed = [lerp(o.tubeX0, -(D - dU) + 0.05, f), o.tubeY, 0, 0]; tube = S0.tube - 1 }
          else if (tt >= tBd + 2 && tt < tFeed + 0.01) { P.dyn.feed = [-(D - dU) + 0.05, lerp(o.tubeY, 0, seg(tt, tBd + 2, tFeed)), 0, 0]; tube = S0.tube - 1 }
          else if (tt >= tFeed && tt < tL) { P.dyn.feed = [-b, 0, 0, 0]; tube = S0.tube - 1 }
          else if (tt >= tL) { P.dyn.chamber = true; tube = S0.tube - 1 }
        }
        P.dyn.tubeN = tube
      } else {
        if (fed && tt >= tFeed && tt < tL) { const f = feedPose(P, b); if (f > 0.35) mag = S0.mag - 1 }
        else if (fed && tt >= tL) { P.dyn.chamber = true; mag = S0.mag - 1 }
        P.dyn.magN = S0.magIn ? mag : 0
      }
      if (hold && o.catchP && tt > tBd) P.k.catch = { rot: ['z', 16 * DEG * seg(tt, tBd, tBd + 1.5), [o.catchP[0], o.catchP[1], 0]] }
      P.phase = phaseAt(plan.ev, tt)
      callout(P, P.phase, tt < tI ? (o.hammer ? o.hammer[0] : -3) : tt < tExit ? Math.min(B, 4 + ((tt - tI) / (tExit - tI)) * B) : -b - 1, tt < tI ? -2.6 : 1.9)
      return P
    }
    plan.end = () => Object.assign(cloneS(S0), t === 'sg'
      ? { chambered: fed, tube: fed ? S0.tube - 1 : S0.tube, locked: hold, hammer: 'cocked' as const, portOpen: true }
      : { chambered: fed, mag: fed ? S0.mag - 1 : S0.mag, locked: hold, hammer: 'cocked' as const, portOpen: true })
    return plan
  }

  // ---------------- MANUAL CYCLING ----------------
  if (['charge', 'lock', 'release', 'slap'].includes(act)) {
    const pistol = t === 'pistol', D = o.D, dU = o.dU || 0, lockD = pistol ? o.D - 0.15 : o.lockD
    const from = S0.locked ? lockD : 0, live = S0.chambered
    const fed = act !== 'lock' && (t === 'sg' ? S0.tube > 0 : S0.magIn && S0.mag > 0)
    const holdEnd = act === 'lock'
    let pts: [number, number][]
    if (act === 'charge') pts = [[0, from], [180, from], [560, D], [700, D], [745, holdEnd ? lockD : 0]]
    else if (act === 'lock') pts = [[0, from], [160, from], [520, D], [640, D], [700, lockD]]
    else if (act === 'release') pts = [[0, from], [220, from], [258, 0]]
    else pts = [[0, from], [180, from], [215, 0]]
    if (act === 'lock' && t === 'mp5') pts = [[0, from], [160, from], [520, o.chTravel], [640, o.chTravel], [720, lockD]]
    else if (act === 'charge' && t === 'mp5') pts = [[0, from], [180, from], [560, o.chTravel], [700, o.chTravel], [745, 0]]
    const dur = pts[pts.length - 1][0] + 160
    plan.dur = dur; plan.speed = 0.5
    const dAt = (tt: number) => {
      for (let i = 1; i < pts.length; i++) {
        if (tt <= pts[i][0]) { const [t0, d0] = pts[i - 1], [t1, d1] = pts[i]; return lerp(d0, d1, seg(tt, t0, t1, d1 < d0 ? 'in' : 'io')) }
      }
      return pts[pts.length - 1][1]
    }
    const ret = pts.findIndex((p, i) => i > 0 && p[1] < pts[i - 1][1]), tRet = ret > 0 ? pts[ret - 1][0] : dur
    const thr = c.cl + 0.35
    let tEj: number | null = null
    for (let x = 0; x < dur; x += 0.5) if (Math.max(0, dAt(x) - dU) >= thr) { tEj = x; break }
    let tFeed: number | null = null
    for (let x = tRet; x < dur; x += 0.25) if (Math.max(0, dAt(x) - dU) <= -o.magRearX) { tFeed = x; break }
    const lbl = ({ charge: pistol ? 'Rack' : 'Charging handle', lock: 'Lock back', release: 'Release', slap: 'Slap' } as Record<string, string>)[act]
    plan.ev = [[0, 'Start'], ...(act === 'charge' || act === 'lock' ? [[pts[1][0], pistol ? 'Slide moving' : 'Pulling handle'] as Ev] : []), ...(live && tEj != null ? [[tEj, 'Live round ejected'] as Ev] : []), ...(act === 'lock' ? [[560, 'Bolt catch / slide stop engaged'] as Ev] : []), [tRet, act === 'lock' ? 'Held open' : 'Released: the spring drives it forward'], ...(fed && tFeed != null && !holdEnd ? [[tFeed, 'Strips a round from the mag'] as Ev] : []), [dur - 160, holdEnd ? 'Locked open' : 'In battery']]
    if (act === 'charge' && t === 'mp5') plan.ev.push([560, 'Handle can be locked in the notch for the HK slap'])
    plan.ev.sort((a, b) => a[0] - b[0])
    plan.pose = (tt) => {
      const P = P0(), dv = dAt(tt), b = Math.max(0, dv - dU)
      if (pistol) {
        P.k.slide = { d: [-dv, 0, 0] }
        P.k.barrel = dv > dU ? { rot: ['z', o.tilt * DEG * clamp((dv - dU) / 0.25, 0, 1), [o.barrelPiv[0], o.barrelPiv[1], 0]], d: [-dU, 0, 0] } : { d: [-dv, 0, 0] }
        P.k.supp = P.k.barrel
        P.k.rspring = { sx: [clamp((B - 0.8 - dv) / (B - 0.8), 0.3, 1), 0.2] }
        P.k.striker = { d: [-dv, 0, 0] }
      } else {
        P.k.carrier = { d: [-dv, 0, 0] }
        P.k.bolt = { d: [-b, 0, 0], rot: dU ? ['x', o.rot * DEG * clamp(dv / dU, 0, 1), [0, 0, 0]] : null }
        if (o.spring) { P.k.buffer = { d: [-dv, 0, 0] }; P.k.spring = { sx: [clamp((o.spring.len - dv) / o.spring.len, 0.12, 1), o.spring.x0] } }
        const chD = t === 'ar' || t === 'blow' ? (tt < tRet ? dv : Math.max(0, dv)) : 0
        if ((t === 'ar' || t === 'blow') && o.ejHinge) {
          if (act !== 'release') P.k.ch = { d: [-(act === 'lock' && tt > 640 ? Math.max(0, lerp(dv, 0, seg(tt, 640, 700))) : chD), 0, 0] }
          if (!S0.portOpen) P.k.ejcover = { rot: ['x', 100 * DEG * seg(dv, 0.05, 0.4), o.ejHinge] }
        }
        if (t === 'mp5') P.k.ch = { d: [-dv, 0, 0] }
        if (o.hammer && dv > 0.6) P.k.hammer = { rot: ['z', Math.max(S0.hammer === 'down' ? -12 : 60, -12 + 74 * clamp((dv - 0.6) / 1.6, 0, 1)) * DEG, [o.hammer[0], o.hammer[1], 0]] }
        else if (o.hammer && S0.hammer !== 'down') P.k.hammer = { rot: ['z', 60 * DEG, [o.hammer[0], o.hammer[1], 0]] }
        if (o.catchP && (act === 'lock' ? tt > 520 : act === 'release' ? tt < 220 : false)) P.k.catch = { rot: ['z', 16 * DEG, [o.catchP[0], o.catchP[1], 0]] }
      }
      if (pistol && (act === 'lock' ? tt > 520 : act === 'release' ? tt < 220 : false)) P.k.sstop = { rot: ['z', 12 * DEG, [o.sstop[0], o.sstop[1], 0]] }
      P.dyn.chamber = live && (tEj == null || tt < tEj - 40)
      if (live && tEj != null) {
        if (tt >= tEj - 40 && tt < tEj) P.dyn.spent = [-Math.min(b, thr), 0, 0, 0, 0, 0, true]
        else if (tt >= tEj) { const tau = (tt - tEj) / 12; P.dyn.spent = [-thr - 0.02 * tau, 0.05 * tau - GRAV * 30 * 0.5 * tau * tau, (o.portZ || 0.5) + 0.17 * tau, 0.06 * tau, 0.35 * tau, 0, true] }
      }
      let mag = S0.mag, tube = S0.tube
      if (fed && !holdEnd && tFeed != null && tt >= tFeed) {
        if (t === 'sg') { P.dyn.feed = [-b, lerp(o.tubeY, 0, seg(tt, tFeed, tFeed + 20)), 0, 0]; tube--; if (b < 0.02) { P.dyn.feed = null; P.dyn.chamber = true } }
        else { const f = feedPose(P, b); if (f > 0.35) mag--; if (f >= 0.999) { P.dyn.feed = null; P.dyn.chamber = true } }
      }
      P.dyn.magN = S0.magIn ? mag : 0
      if (t === 'sg') P.dyn.tubeN = tube
      P.phase = phaseAt(plan.ev, tt)
      callout(P, lbl + ': ' + P.phase, pistol ? -dv : o.take ? -dv - 6 : -dv - 3, 1.9)
      return P
    }
    plan.end = () => {
      const S = cloneS(S0)
      S.hammer = 'cocked'; S.portOpen = true
      if (holdEnd) { S.locked = true; if (live) S.chambered = false; return S }
      S.locked = false
      if (act === 'charge' && live) S.chambered = false
      if (fed) { S.chambered = true; if (t === 'sg') S.tube--; else S.mag-- }
      return S
    }
    return plan
  }

  // ---------------- MAGAZINE ----------------
  if (act === 'magswap' || act === 'magdrop' || act === 'magin') {
    const pistol = t === 'pistol', drop = act !== 'magin' && S0.magIn, ins = act !== 'magdrop'
    const tDrop0 = 80, tDrop1 = 380, tIn0 = drop ? 520 : 100, tIn1 = tIn0 + 650, tSeat = tIn1 + 90
    plan.dur = ins ? tSeat + 150 : tDrop1 + 100; plan.speed = 0.5
    const rock = o.magRock, axis = pistol ? o.magAxis : [0, -1]
    plan.ev = [[0, 'Press the release'], ...(drop ? [[tDrop0, 'Mag falls free'] as Ev] : []), ...(ins ? [[tIn0, 'New mag indexed'], [tIn1, 'Seated'], [tSeat, 'Click: catch engaged']] as Ev[] : [])]
    plan.pose = (tt) => {
      const P = P0()
      P.dyn.magN = S0.magIn ? S0.mag : 0
      if (drop && tt < tIn0) {
        const tau = Math.max(0, tt - tDrop0), fall = 0.5 * GRAV * tau * tau * 4 + (tt > tDrop0 ? 0.2 : 0)
        if (rock) { const r = seg(tt, 0, tDrop0 + 60); P.k.mag = { rot: ['z', 22 * DEG * r, [o.magFront, -0.6, 0]], d: [0, -fall * seg(tt, tDrop0 + 60, tDrop1), 0] } }
        else P.k.mag = { d: [axis[0] * fall, axis[1] * fall, 0] }
        if (tt > tDrop1) P.k.mag = { hide: true }
      } else if (ins && tt >= tIn0) {
        P.dyn.magN = g.cfg.magCap || 30
        const f = seg(tt, tIn0, tIn1, 'out'), off = (1 - f) * 7 + (tt < tSeat ? 0.12 * (1 - seg(tt, tIn1, tSeat)) : 0)
        if (rock) P.k.mag = { rot: ['z', 22 * DEG * (1 - seg(tt, tIn1 - 200, tSeat)), [o.magFront, -0.6, 0]], d: [0, -off * 0.8, 0] }
        else P.k.mag = { d: [axis[0] * off, axis[1] * off, 0] }
      } else if (!S0.magIn) P.k.mag = { hide: true }
      P.phase = phaseAt(plan.ev, tt)
      callout(P, P.phase, pistol ? o.magRearX : (o.magFront || 0) - 1, pistol ? -4 : -6)
      return P
    }
    plan.end = () => Object.assign(cloneS(S0), { magIn: ins, mag: ins ? g.cfg.magCap || 30 : 0 })
    return plan
  }
  if (act === 'load') {
    const cap = o.shellCap || 7, n = cap - S0.tube
    plan.dur = Math.max(1, n) * 450 + 200; plan.speed = 1
    plan.ev = [[0, 'Thumb shells into the loading port'], [plan.dur - 200, `Tube full (${cap})`]]
    plan.pose = (tt) => { const P = P0(); P.dyn.tubeN = Math.min(cap, S0.tube + Math.floor(tt / 450)); P.phase = phaseAt(plan.ev, tt); return P }
    plan.end = () => Object.assign(cloneS(S0), { tube: cap })
    return plan
  }

  // ---------------- TAKEDOWN / STRIP ----------------
  if (act === 'takedown') {
    const opening = !S0.taken
    plan.speed = 0.5
    if (t === 'pistol') {
      plan.dur = 1500
      plan.ev = opening ? [[0, 'Slide back slightly'], [260, 'Pull the takedown tabs'], [420, 'Slide and barrel run forward off the frame'], [1400, 'Separated']] : [[0, 'Slide onto the frame rails'], [1100, 'Slide back to battery'], [1400, 'Reassembled']]
      plan.pose = (tt) => {
        const P = P0()
        const off = opening ? 9 * seg(tt, 420, 1400, 'io') : 9 * (1 - seg(tt, 0, 1100, 'io'))
        const nudge = opening ? 0.12 * seg(tt, 0, 200) * (1 - seg(tt, 260, 420)) : 0
        P.slideOff = off - nudge
        P.dyn.chamber = false
        P.phase = phaseAt(plan.ev, tt)
        callout(P, P.phase, 2 + off, 1.8)
        return P
      }
    } else {
      plan.dur = 1300
      plan.ev = opening ? [[0, 'Push the rear takedown pin'], [300, 'Upper pivots on the front pin'], [1200, 'Open']] : [[0, 'Close the upper'], [900, 'Push the takedown pin in'], [1200, 'Closed']]
      plan.pose = (tt) => {
        const P = P0()
        const a = opening ? seg(tt, 300, 1200, 'io') : 1 - seg(tt, 0, 900, 'io')
        P.up = [-24 * DEG * a, [o.take[0], o.take[1], 0]]
        P.phase = phaseAt(plan.ev, tt)
        callout(P, P.phase, o.take[0] - 3, -2.4)
        return P
      }
    }
    plan.end = () => Object.assign(cloneS(S0), { taken: opening })
    return plan
  }
  if (act === 'strip') {
    const ak = I.platform === 'ak'
    plan.dur = 2600; plan.speed = 0.5
    plan.ev = ak ? [[0, 'Press the recoil spring guide, lift the dust cover'], [700, 'Carrier back and up'], [1600, 'Bolt carrier out'], [2400, 'Reverse to reassemble']] : [[0, 'Pull the charging handle'], [500, 'Bolt carrier group slides out the rear'], [1500, 'Charging handle drops out'], [2400, 'Reverse to reassemble']]
    plan.pose = (tt) => {
      const P = P0(), out = seg(tt, 0, 1300, 'io') * (1 - seg(tt, 1800, 2500, 'io'))
      if (ak) { P.k.cover = { d: [-3 * seg(tt, 0, 600), 3.2 * seg(tt, 100, 600), 0] }; P.k.carrier = { d: [-9 * out, 1.6 * seg(tt, 600, 1000) * (1 - seg(tt, 1800, 2400)), 0] }; P.k.bolt = P.k.carrier }
      else {
        P.up = [-24 * DEG, [o.take[0], o.take[1], 0]]
        P.k.carrier = { d: [-9 * out, 0, 0] }; P.k.bolt = P.k.carrier
        P.k.ch = { d: [-(4 + 5 * seg(tt, 900, 1500)) * Math.min(1, out * 1.6), -1.0 * seg(tt, 1100, 1500) * (1 - seg(tt, 1800, 2200)), 0] }
      }
      P.dyn.chamber = false
      P.phase = phaseAt(plan.ev, tt)
      callout(P, P.phase, -9 * out - 3, 2.6)
      return P
    }
    plan.end = () => cloneS(S0)
    return plan
  }

  // ---------------- CONTROLS / ACCESSORIES ----------------
  const toggleAnim = (dur: number, ev: Ev[], fn: (P: Pose, tt: number) => void, endFn: () => OpState) => {
    plan.dur = dur; plan.speed = 1; plan.ev = ev
    plan.pose = (tt) => { const P = P0(); P.phase = phaseAt(plan.ev, tt); fn(P, tt); return P }
    plan.end = endFn
    return plan
  }
  if (act === 'safety') {
    const toSafe = S0.safety !== 'safe', a0 = t === 'ak' ? (toSafe ? -18 : 0) : toSafe ? 90 : 0, a1 = t === 'ak' ? (toSafe ? 0 : -18) : toSafe ? 0 : 90
    return toggleAnim(320, [[0, toSafe ? 'Selector to SAFE' : 'Selector to FIRE'], [250, toSafe ? 'Safe' : 'Fire']],
      (P, tt) => { P.k.safety = { rot: ['z', lerp(a0, a1, seg(tt, 0, 250, 'io')) * DEG, [o.safety[0], o.safety[1], t === 'ak' ? 0.62 : -0.72]] }; callout(P, P.phase, o.safety[0], -2) },
      () => Object.assign(cloneS(S0), { safety: toSafe ? 'safe' as const : 'fire' as const }))
  }
  if (act === 'stock') {
    const tr = I.stockTravel || 3, ext = (g.cfg.stockPos ?? 0.4) * tr, cur = S0.stockD || 0, to = cur ? 0 : ext > 0.1 ? ext : -tr
    return toggleAnim(700, [[0, 'Lift the stock lever'], [650, to > 0 ? 'Fully collapsed' : to < 0 ? 'Fully extended' : 'Back to the set position']],
      (P, tt) => { P.k.stock = { d: [lerp(cur, to, seg(tt, 100, 650, 'io')), 0, 0] } }, () => Object.assign(cloneS(S0), { stockD: to }))
  }
  if (act === 'fold') {
    const f0 = S0.fold
    return toggleAnim(900, [[0, 'Press the folding button'], [850, f0 ? 'Locked open' : 'Folded']],
      (P, tt) => { const a = f0 ? 1 - seg(tt, 100, 850, 'io') : seg(tt, 100, 850, 'io'); P.k.stock = { rot: ['y', -Math.PI * 0.98 * a, [o.stockHinge[0], 0, o.stockHinge[1]]] } },
      () => Object.assign(cloneS(S0), { fold: !f0 }))
  }
  if (act === 'light') return toggleAnim(240, [[0, S0.light ? 'Release the switch' : 'Press the switch'], [60, S0.light ? 'Off' : 'On, constant']], (P, tt) => { P.dyn.beam = S0.light ? tt < 60 : tt >= 60 }, () => Object.assign(cloneS(S0), { light: !S0.light }))
  if (act === 'laser') return toggleAnim(240, [[0, 'Activate the laser'], [60, S0.laser ? 'Off' : 'On']], (P, tt) => { P.dyn.laser = S0.laser ? tt < 60 : tt >= 60 }, () => Object.assign(cloneS(S0), { laser: !S0.laser }))
  if (act === 'supp') {
    const on = S0.suppOn, supp = g.atts.find((a) => a.k === 'supp'), len = supp?.len || 7
    return toggleAnim(1800, [[0, on ? 'Unlock the mount' : 'Index the can'], [300, on ? 'Unthread / pull forward' : 'Thread / seat'], [1500, on ? 'Removed' : 'Locked on']],
      (P, tt) => { const a = on ? seg(tt, 300, 1500, 'io') : 1 - seg(tt, 0, 1300, 'io'); P.k.supp = { d: [a * (len + 3), 0, 0], rot: ['x', a * 6 * Math.PI, [0, 0, 0]], hide: on && tt > 1600 } },
      () => Object.assign(cloneS(S0), { suppOn: !on }))
  }
  if (act === 'buis') {
    const fold = !S0.buisDown
    return toggleAnim(500, [[0, 'Flip the sights'], [400, fold ? 'Folded' : 'Deployed']], (P, tt) => {
      const a = (fold ? seg(tt, 0, 400) : 1 - seg(tt, 0, 400)) * -80 * DEG
      P.k.buisR = { rot: ['z', -a, [I.railStart + 0.2 + 1.3, I.rail, 0]] }
      P.k.buisF = { rot: ['z', a, [I.railEnd - 1.4, I.rail, 0]] }
    }, () => Object.assign(cloneS(S0), { buisDown: fold }))
  }
  if (act === 'bipod') {
    const dep = !S0.bipod, bp = g.atts.find((x) => x.k === 'bipod')
    const px = (bp ? bp.pos ?? defaultPos(bp, I) : 0) + 1.6
    return toggleAnim(700, [[0, 'Pull the legs'], [600, dep ? 'Deployed' : 'Stowed']], (P, tt) => {
      const a = (dep ? seg(tt, 0, 600, 'io') : 1 - seg(tt, 0, 600, 'io')) * -88 * DEG
      P.k.bipodLeg = { rot: ['z', a, [px, I.hgCy - I.hgR - 0.55, 0]] }
    }, () => Object.assign(cloneS(S0), { bipod: dep }))
  }
  return plan
}

export const fmtT = (t: number, dur: number) => (dur >= 200 ? `${(t / 1000).toFixed(3)} s` : `${t.toFixed(2)} ms`)
