/* 3D model builders. Turn the `model` block of a gun.json or part into a THREE.Group.
   Units are inches. +x points toward the muzzle, +y is up.
   +z is the gun's LEFT side (safety, bolt catch, charging-handle latch);
   -z is the RIGHT side (ejection port, forward assist, mag release button). */
import * as THREE from 'three'
import type { Attachment, ModelDef } from '../types'

export const COLORS: Record<string, number> = {
  anodized: 0x202226, polymer: 0x1c1d1f, ddc: 0x8a7a63, fde: 0x8f7a5c, odgreen: 0x474c37, grey: 0x55595e,
  nitride: 0x17181a, hardchrome: 0xb9bdc3, parkerized: 0x2a2b2d, dlc: 0x141518, steel: 0x9aa0a7,
  gold: 0xc99f45, frame: 0x1f2124, dark: 0x0b0c0e,
}
type Finish = { m: number; r: number }
const FINISH: Record<string, Finish> = { matte: { m: 0.35, r: 0.7 }, cerakote: { m: 0.12, r: 0.75 }, polymer: { m: 0.05, r: 0.82 } }
const POLY = FINISH.polymer

export function col(v: unknown, fallback = 0x55585d): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    if (v.startsWith('#')) return parseInt(v.slice(1), 16)
    if (COLORS[v] != null) return COLORS[v]
  }
  return fallback
}
const fin = (name: unknown): Finish | null => (typeof name === 'string' && FINISH[name]) || null

export type Half = 'lower' | 'upper' | 'mag' | 'part'
export interface MeshData {
  part: string
  shell: boolean
  half: Half
  att?: string
  base?: THREE.Vector3
  exp?: [number, number, number]
}

let HALF: Half = 'lower'
type Mat = THREE.MeshStandardMaterial
type P2 = [number, number]

function mat(c: number, o?: Partial<Finish> | null): Mat {
  return new THREE.MeshStandardMaterial({ color: c, metalness: o?.m ?? 0.45, roughness: o?.r ?? 0.5 })
}
function tag<T extends THREE.Mesh>(me: T, part: string, opts?: { shell?: boolean; half?: Half } | null): T {
  me.userData = { part, shell: !!opts?.shell, half: opts?.half ?? HALF } satisfies MeshData
  return me
}
function shape(pts: P2[]) {
  const s = new THREE.Shape()
  s.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1])
  s.closePath()
  return s
}
function path(pts: P2[]) {
  const p = new THREE.Path()
  p.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1])
  p.closePath()
  return p
}
function ext(pts: P2[], depth: number, m: Mat, part: string, opts?: { shell?: boolean; half?: Half } | null, holes?: P2[][]) {
  const s = shape(pts)
  holes?.forEach((h) => s.holes.push(path(h)))
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: Math.min(0.04, depth * 0.2), bevelSize: 0.025, bevelSegments: 2, curveSegments: 8 })
  g.translate(0, 0, -depth / 2)
  return tag(new THREE.Mesh(g, m.clone()), part, opts)
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, m: Mat, part: string, opts?: { shell?: boolean; half?: Half }) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m.clone())
  me.position.set(x, y, z)
  return tag(me, part, opts)
}
function cylX(r: number, len: number, x0: number, y: number, z: number, m: Mat, part: string, opts?: { shell?: boolean; half?: Half }, seg = 28) {
  const g = new THREE.CylinderGeometry(r, r, len, seg)
  g.rotateZ(Math.PI / 2)
  const me = new THREE.Mesh(g, m.clone())
  me.position.set(x0 + len / 2, y, z)
  return tag(me, part, opts)
}
function cylZ(r: number, len: number, x: number, y: number, z: number, m: Mat, part: string) {
  const g = new THREE.CylinderGeometry(r, r, len, 20)
  g.rotateX(Math.PI / 2)
  const me = new THREE.Mesh(g, m.clone())
  me.position.set(x, y, z)
  return tag(me, part)
}
function cylY(r: number, len: number, x: number, y: number, z: number, m: Mat, part: string) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), m.clone())
  me.position.set(x, y, z)
  return tag(me, part)
}

/* ---------- AR lower ---------- */
const TRIG_CURVED: P2[] = [[-0.1, -0.95], [-0.5, -0.95], [-0.55, -1.35], [-0.72, -1.62], [-0.95, -1.82], [-0.82, -1.88], [-0.5, -1.73], [-0.3, -1.5], [-0.15, -1.25]]
const TRIG_FLAT: P2[] = [[-0.12, -0.95], [-0.52, -0.95], [-0.58, -1.86], [-0.36, -1.86], [-0.3, -1.35]]

interface TriggerLook { color: number; hammer: number | null; style: 'curved' | 'flat' }
interface LowerOpts { color: number; finish: Finish | null; grip: string; stock: string; ambiSafety: boolean; ambiBR: boolean; mag?: string; trigger: TriggerLook }

function buildLower(g: THREE.Group, o: LowerOpts) {
  HALF = 'lower'
  const M = mat(o.color, o.finish)
  g.add(ext([[-3.6, 0], [4.0, 0], [4.0, -0.9], [3.7, -0.9], [3.7, -2.7], [0.7, -2.7], [0.7, -1.15], [-3.0, -1.15], [-3.6, -0.55]], 0.9, M, 'lower', { shell: true }))
  g.add(ext([[-3.6, 0], [-3.6, 1.05], [-4.0, 1.05], [-4.0, 0]], 0.9, M, 'lower', { shell: true }))
  g.add(ext([[0.75, -1.05], [0.62, -2.12], [-1.72, -2.12], [-1.72, -1.05]], 0.5, M, 'guard', null, [[[0.48, -1.2], [0.42, -1.95], [-1.52, -1.95], [-1.52, -1.2]]]))
  const gm = mat(COLORS.polymer, POLY)
  const gp: P2[] = o.grip === 'b5'
    ? [[-1.45, -1.1], [-3.05, -1.05], [-4.35, -4.7], [-4.1, -5.0], [-3.0, -5.05], [-2.8, -4.6], [-2.4, -3.6], [-2.45, -3.0], [-2.1, -2.4], [-1.7, -1.6]]
    : [[-1.5, -1.1], [-3.0, -1.05], [-4.25, -4.6], [-4.0, -4.9], [-3.05, -4.95], [-2.3, -2.6], [-1.75, -1.6]]
  g.add(ext(gp, 1.0, gm, 'grip'))
  const t = o.trigger
  const tm = mat(t.color, { m: 0.75, r: 0.32 })
  const hm = mat(t.hammer ?? COLORS.steel, { m: 0.75, r: 0.35 })
  g.add(ext(t.style === 'flat' ? TRIG_FLAT : TRIG_CURVED, 0.22, tm, 'trigger'))
  g.add(ext([[-0.12, -0.2], [-0.55, -0.2], [-0.55, -1.0], [-0.12, -1.0]], 0.24, tm, 'trigger'))
  g.add(ext([[-1.75, -0.95], [-1.15, -0.95], [-0.95, -0.5], [-1.05, -0.12], [-1.35, -0.12], [-1.6, -0.5]], 0.3, hm, 'fcg'))
  g.add(ext([[-1.0, -0.3], [-0.15, -0.3], [-0.15, -0.42], [-1.0, -0.42]], 0.18, hm, 'fcg'))
  const pm = mat(COLORS.steel, { m: 0.8, r: 0.3 })
  g.add(cylZ(0.075, 0.98, -0.38, -0.72, 0, pm, 'pins'))
  g.add(cylZ(0.075, 0.98, -1.38, -0.72, 0, pm, 'pins'))
  const sm = mat(COLORS.dlc, { m: 0.6, r: 0.4 })
  g.add(cylZ(0.2, 1.0, -1.9, -0.5, 0, sm, 'safety'))
  const lever = box(0.75, 0.13, 0.07, -2.2, -0.42, 0.52, sm, 'safety'); lever.rotation.z = 0.35; g.add(lever)
  if (o.ambiSafety) { const l2 = box(0.55, 0.13, 0.07, -2.1, -0.45, -0.52, sm, 'safety'); l2.rotation.z = 0.35; g.add(l2) }
  const dk = mat(COLORS.dark, { m: 0.5, r: 0.5 })
  g.add(cylZ(0.17, 0.25, 1.05, -0.8, -0.5, dk, 'magrel'))
  g.add(box(0.35, 0.75, 0.08, 0.45, -0.55, 0.48, dk, 'boltcatch'))
  if (o.ambiBR) g.add(box(0.7, 0.22, 0.08, 1.0, -1.0, -0.48, dk, 'boltcatch'))
  g.add(cylZ(0.12, 1.05, 3.75, -0.5, 0, pm, 'pivot'))
  g.add(cylZ(0.12, 1.05, -3.25, -0.25, 0, pm, 'pivot'))
  g.add(cylX(0.58, 7.3, -11.3, 0.55, 0, mat(COLORS.anodized, { m: 0.5, r: 0.45 }), 'tube'))
  g.add(cylX(0.72, 0.28, -4.3, 0.55, 0, mat(COLORS.steel, { m: 0.7, r: 0.35 }), 'tube'))
  const st = mat(COLORS.polymer, POLY)
  if (o.stock === 'sopmod') {
    g.add(ext([[-7.2, 1.2], [-10.9, 1.38], [-11.35, 1.33], [-11.4, -2.0], [-10.8, -2.15], [-9.0, -0.5], [-7.2, -0.5]], 1.55, st, 'stock'))
    g.add(box(0.35, 3.4, 1.6, -11.55, -0.35, 0, mat(0x18191b, { m: 0, r: 0.95 }), 'stock'))
  } else if (o.stock === 'car') {
    g.add(ext([[-7.4, 1.0], [-10.8, 1.08], [-11.05, 1.0], [-11.05, -2.0], [-10.6, -2.05], [-8.6, -0.45], [-7.4, -0.42]], 1.05, st, 'stock'))
  } else {
    g.add(cylX(0.62, 0.22, -11.52, 0.55, 0, mat(COLORS.anodized, { m: 0.5, r: 0.45 }), 'tube'))
  }
  if (o.mag === '22') g.add(ext([[1.2, -2.55], [3.3, -2.55], [3.45, -8.4], [1.5, -8.6]], 0.62, mat(COLORS.polymer, POLY), 'mag', { half: 'mag' }))
}

/* ---------- AR upper ---------- */
function buildBCG(g: THREE.Group, dx: number, dy: number, color?: number) {
  const n = mat(color ?? COLORS.nitride, { m: 0.6, r: 0.36 })
  g.add(cylX(0.42, 5.0, -3.0 + dx, dy, 0, n, 'carrier'))
  g.add(box(1.75, 0.32, 0.3, 0.35 + dx, 0.56 + dy, 0, n, 'gaskey'))
  g.add(cylX(0.1, 0.9, 1.2 + dx, 0.6 + dy, 0, n, 'gaskey'))
  g.add(cylY(0.11, 0.24, 0.95 + dx, 0.44 + dy, 0, mat(COLORS.steel, { m: 0.8, r: 0.3 }), 'campin'))
  for (let i = 0; i < 9; i++) g.add(box(0.07, 0.32, 0.05, -1.9 + i * 0.17 + dx, dy, -0.41, mat(COLORS.dark, { m: 0.5, r: 0.5 }), 'carrier'))
  g.add(cylX(0.29, 1.0, 2.0 + dx, dy, 0, n, 'bolt'))
  const lg = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 7); lg.rotateZ(Math.PI / 2)
  const lug = new THREE.Mesh(lg, n.clone()); lug.position.set(3.12 + dx, dy, 0); g.add(tag(lug, 'bolt'))
  g.add(box(0.9, 0.1, 0.08, 2.6 + dx, dy, -0.3, mat(COLORS.steel, { m: 0.8, r: 0.3 }), 'extractor'))
}
function buildCH(g: THREE.Group, type: string) {
  const c = ({ raptor: COLORS.dlc, raptorlt: COLORS.dlc, airborne: COLORS.ddc } as Record<string, number>)[type] ?? COLORS.parkerized
  const m = mat(c, { m: 0.5, r: 0.5 })
  g.add(box(3.6, 0.18, 0.3, -2.0, 1.08, 0, m, 'ch'))
  if (type === 'raptor' || type === 'raptorlt') {
    g.add(ext([[-3.65, 0.94], [-3.65, 1.24], [-4.05, 1.24], [-4.15, 0.94]], 2.4, m, 'ch'))
  } else {
    g.add(box(0.4, 0.28, 1.5, -3.86, 1.08, 0, m, 'ch'))
    g.add(box(type === 'airborne' ? 0.65 : 0.5, 0.2, type === 'airborne' ? 0.55 : 0.42, -3.8, 1.08, 0.9, m, 'ch'))
  }
}
interface UpperOpts { color: number; finish: Finish | null; ch: string; bcg: boolean; bcgColor: number; noFA: boolean; boltOnly: boolean }
function buildUpper(g: THREE.Group, o: UpperOpts) {
  HALF = 'upper'
  const M = mat(o.color, o.finish)
  g.add(ext([[-3.6, 0], [4.4, 0], [4.4, 1.3], [-3.6, 1.3]], 0.95, M, 'upper', { shell: true }))
  g.add(box(8.0, 0.2, 0.84, 0.4, 1.4, 0, M, 'rail'))
  for (let x = -3.4; x <= 4.25; x += 0.394) g.add(box(0.2, 0.13, 0.84, x, 1.565, 0, M, 'rail'))
  const portCol = new THREE.Color(o.color).multiplyScalar(0.55).getHex()
  g.add(box(2.5, 0.62, 0.04, 1.6, 0.66, -0.5, mat(portCol, { m: 0.3, r: 0.6 }), 'port'))
  if (!o.noFA) { g.add(cylZ(0.24, 0.55, -0.75, 0.9, -0.62, M, 'fa')); g.add(box(0.8, 0.4, 0.25, -0.4, 0.85, -0.55, M, 'upper')) }
  if (o.ch) buildCH(g, o.ch)
  if (o.bcg) buildBCG(g, -0.15, 0.65, o.bcgColor)
  if (o.boltOnly) g.add(cylX(0.38, 4.2, -2.6, 0.65, 0, mat(COLORS.steel, { m: 0.7, r: 0.4 }), 'bolt22'))
}
interface FrontOpts { barrel: number; hg: number; gas: number; noGas: boolean; hgColor: number; hgFinish: Finish | null; muzzle: string; br?: number; mr?: number; topRail: boolean; mbus: boolean; barrelColor: number | null; muzzleColor: number | null }
export interface Anchors { kind: 'rifle' | 'pistol'; railY?: number; big?: boolean; hgStart?: number; hgEnd?: number; by: number; flat?: number; muzzleEnd: number; topRail?: boolean; slideTop?: number; opticX?: number }

function buildFront(g: THREE.Group, o: FrontOpts) {
  HALF = 'upper'
  const by = 0.62, r = 0.72, x0 = 4.4, bx = 3.3
  g.add(cylX(o.br || 0.3, o.barrel, bx, by, 0, mat(o.barrelColor ?? 0x232427, { m: 0.6, r: 0.4 }), 'barrel'))
  g.add(cylX(0.62, 0.7, x0, by, 0, mat(COLORS.anodized), 'barrel'))
  if (!o.noGas) {
    const gx = bx + Math.min(o.gas, o.hg - 0.6)
    g.add(box(0.75, 0.62, 0.68, gx, by + 0.05, 0, mat(COLORS.parkerized, { m: 0.6, r: 0.45 }), 'gasblock'))
    g.add(cylX(0.06, Math.max(0.1, gx - 3.0), 3.0, by + 0.43, 0, mat(COLORS.steel, { m: 0.8, r: 0.3 }), 'gasblock'))
  }
  const hm = mat(o.hgColor, o.hgFinish ?? { m: 0.4, r: 0.55 })
  const hg = new THREE.CylinderGeometry(r, r, o.hg, 8, 1, true); hg.rotateZ(Math.PI / 2); hg.rotateX(Math.PI / 8)
  const hgMat = hm.clone(); hgMat.side = THREE.DoubleSide
  const hgm = new THREE.Mesh(hg, hgMat); hgm.position.set(x0 + o.hg / 2, by, 0); g.add(tag(hgm, 'handguard', { shell: true }))
  const flat = r * Math.cos(Math.PI / 8)
  if (o.topRail) {
    g.add(box(o.hg, 0.2, 0.84, x0 + o.hg / 2, 1.4, 0, hm, 'handguard'))
    for (let x = x0 + 0.2; x <= x0 + o.hg - 0.15; x += 0.394) g.add(box(0.2, 0.13, 0.84, x, 1.565, 0, hm, 'handguard'))
  } else {
    g.add(box(o.hg, 0.16, 0.6, x0 + o.hg / 2, by + flat + 0.06, 0, hm, 'handguard'))
  }
  const sm = mat(0x0c0d0f, { m: 0.2, r: 0.8 })
  for (let x = x0 + 0.9; x + 1.1 < x0 + o.hg - 0.3; x += 1.7) {
    ;[1, -1].forEach((s) => g.add(box(1.1, 0.28, 0.03, x + 0.55, by, s * (flat + 0.005), sm, 'handguard')))
    g.add(box(1.1, 0.03, 0.28, x + 0.55, by - flat - 0.005, 0, sm, 'handguard'))
  }
  const end = bx + o.barrel
  const mm = mat(o.muzzleColor ?? 0x1c1d20, { m: 0.6, r: 0.45 })
  if (o.muzzle === 'a2') {
    const mr = o.mr || 0.4
    g.add(cylX(mr, 2.0, end - 0.25, by, 0, mm, 'muzzle'))
    for (let i = 0; i < 3; i++) g.add(box(1.1, 0.06, 0.18, end + 0.9, by + mr - 0.02, (i - 1) * 0.2, sm, 'muzzle'))
  } else if (o.muzzle === 'sf4p') {
    g.add(cylX(0.5, 0.6, end - 0.3, by, 0, mm, 'muzzle'))
    g.add(cylX(0.45, 1.9, end + 0.3, by, 0, mm, 'muzzle'))
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4
      const sl = box(1.3, 0.12, 0.12, end + 1.45, by + Math.sin(a) * 0.42, Math.cos(a) * 0.42, sm, 'muzzle'); sl.rotation.x = a; g.add(sl)
    }
  } else if (o.muzzle === 'comp') {
    g.add(cylX(0.5, 2.4, end - 0.3, by, 0, mm, 'muzzle'))
    for (let i = 0; i < 3; i++) g.add(box(0.28, 0.42, 1.04, end + 0.5 + i * 0.55, by, 0, sm, 'muzzle'))
  }
  if (o.mbus) {
    const dk = mat(COLORS.polymer, POLY)
    const f = ext([[0, 0], [0.9, 0], [0.75, 0.55], [0.15, 0.55]], 0.6, dk, 'sights'); f.position.set(x0 + o.hg - 1.0, 1.63, 0); g.add(f)
    const r2 = ext([[0, 0], [0.9, 0], [0.75, 0.5], [0.15, 0.5]], 0.7, dk, 'sights'); r2.position.set(-3.4, 1.63, 0); g.add(r2)
  }
  const muzzleEnd = ({ a2: end + 1.75, sf4p: end + 2.2, comp: end + 2.1 } as Record<string, number>)[o.muzzle] ?? end
  return { hgStart: x0, hgEnd: x0 + o.hg, by, flat, muzzleEnd, topRail: o.topRail }
}

export interface TriggerSel { color?: string; hammer?: string; style?: 'curved' | 'flat' }
export interface BuildSel { trigger?: TriggerSel | null; chModel?: string | null }

type Dict = Record<string, unknown>
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)

function rifle(m: ModelDef, sel: BuildSel) {
  const L = (m.lower ?? {}) as Dict, U = (m.upper ?? {}) as Dict, F = (m.front ?? {}) as Dict
  const k = num(m.scale, 1)
  const t = sel.trigger ?? {}
  const g = new THREE.Group()
  buildLower(g, {
    color: col(L.color ?? 'anodized'), finish: fin(L.finish), grip: String(L.grip ?? 'a2'), stock: String(L.stock ?? 'none'),
    ambiSafety: !!L.ambiSafety, ambiBR: !!L.ambiBoltRelease, mag: L.magazine as string | undefined,
    trigger: { color: col(t.color, COLORS.steel), hammer: t.hammer ? col(t.hammer) : null, style: t.style ?? 'curved' },
  })
  const blowback = U.bolt === 'blowback'
  buildUpper(g, {
    color: col(U.color ?? L.color ?? 'anodized'), finish: fin(U.finish ?? L.finish), ch: sel.chModel || String(U.chargingHandle ?? 'mil'),
    bcg: !blowback && U.bcg !== false, bcgColor: col(U.bcgColor ?? 'nitride'), noFA: U.forwardAssist === false, boltOnly: blowback,
  })
  const barrel = num(F.barrel, 16), hgLen = num(F.handguard, Math.max(4, barrel - 3))
  const gas = F.gas == null ? barrel * 0.5 : num(F.gas, 0)
  const fa = buildFront(g, {
    barrel: barrel / k, hg: hgLen / k, gas: gas / k, noGas: gas === 0,
    hgColor: col(F.handguardColor ?? U.color ?? 'anodized'), hgFinish: fin(F.handguardFinish ?? U.finish),
    muzzle: String(F.muzzle ?? 'a2'), br: F.barrelRadius as number | undefined, mr: F.muzzleRadius as number | undefined,
    topRail: F.topRail !== false, mbus: F.sights === 'mbus',
    barrelColor: F.barrelColor ? col(F.barrelColor) : null, muzzleColor: F.muzzleColor ? col(F.muzzleColor) : null,
  })
  g.userData.anchors = { kind: 'rifle', railY: 1.63, big: k > 1.05, ...fa } satisfies Anchors
  g.scale.setScalar(k)
  return g
}

/* ---------- pistol: "lower" = frame, "upper" = slide group ---------- */
function pistol(m: ModelDef) {
  const g = new THREE.Group()
  const sl = mat(col(m.slideColor ?? 'dlc'), { m: 0.55, r: 0.4 }), au = mat(col(m.barrelColor ?? 'steel'), { m: 0.95, r: 0.28 })
  const fr = mat(col(m.frameColor ?? 'frame'), { m: 0.5, r: 0.5 }), dk = mat(COLORS.dark, { m: 0.3, r: 0.7 }), cm = mat(col(m.compColor ?? '#1c1d20'), { m: 0.6, r: 0.45 })
  HALF = 'upper'
  g.add(ext([[-3.55, 0], [3.2, 0], [3.2, 0.95], [2.95, 1.15], [-3.3, 1.15], [-3.55, 0.9]], 0.98, sl, 'slide', { shell: true }))
  for (let i = 0; i < 7; i++) [1, -1].forEach((s) => g.add(box(0.07, 0.75, 0.03, -3.25 + i * 0.16, 0.55, s * 0.53, dk, 'slide')))
  if (m.lighteningCuts) for (let i = 0; i < 3; i++) [1, -1].forEach((s) => g.add(box(0.42, 0.2, 0.03, 1.35 + i * 0.55, 0.82, s * 0.53, au, 'pbarrel')))
  if (m.optic) g.add(box(1.3, 0.05, 0.7, -2.05, 1.18, 0, dk, 'optic'))
  g.add(box(1.45, 0.06, 0.62, 0.45, 1.17, 0.04, au, 'pbarrel'))
  g.add(cylX(0.27, 3.6, -0.2, 0.62, 0, au, 'pbarrel'))
  if (m.compensator) {
    g.add(ext([[3.25, 0.08], [4.55, 0.08], [4.55, 1.0], [3.25, 1.0]], 0.95, cm, 'comp'))
    for (let i = 0; i < 3; i++) g.add(box(0.14, 0.04, 0.42, 3.6 + i * 0.3, 1.04, 0, dk, 'comp'))
    g.add(cylX(0.22, 0.02, 4.57, 0.62, 0, dk, 'comp'))
  }
  g.add(box(0.35, 0.22, 0.8, -3.12, 1.26, 0, dk, 'sights'))
  g.add(box(0.16, 0.2, 0.12, 2.7, 1.25, 0, dk, 'sights'))
  HALF = 'lower'
  g.add(ext([[3.15, 0.02], [-3.45, 0.02], [-3.6, -0.35], [-4.55, -4.55], [-4.45, -4.75], [-2.55, -4.85], [-2.45, -4.6], [-1.75, -1.2], [-1.6, -1.75], [0.45, -1.75], [0.75, -0.75], [3.15, -0.75]], 1.12, fr, 'frame', { shell: true }, [[[-1.35, -0.62], [0.3, -0.62], [0.2, -1.55], [-1.35, -1.55]]]))
  for (let x = 1.3; x < 3.0; x += 0.394) g.add(box(0.2, 0.12, 0.8, x, -0.82, 0, fr, 'frame'))
  g.add(ext([[-0.3, -0.45], [-0.72, -0.45], [-0.75, -1.32], [-0.5, -1.32], [-0.42, -0.9]], 0.24, mat(COLORS.dlc, { m: 0.7, r: 0.35 }), 'trigger'))
  g.add(box(1.05, 0.13, 0.06, -0.55, -0.12, 0.6, dk, 'sstop'))
  g.add(box(0.3, 0.26, 0.06, 0.95, -0.3, 0.6, dk, 'takedown'))
  g.add(box(1.65, 0.26, 1.0, -3.55, -4.95, 0, dk, 'mag', { half: 'mag' }))
  g.userData.anchors = { kind: 'pistol', by: 0.62, slideTop: 1.15, opticX: -2.05, railY: -0.82, muzzleEnd: m.compensator ? 4.57 : 3.4 } satisfies Anchors
  return g
}
function bcgPart(m: ModelDef) { HALF = 'part'; const g = new THREE.Group(); buildBCG(g, 0, 0, col(m.color ?? 'nitride')); return g }
function chPart(m: ModelDef) {
  HALF = 'part'
  const g = new THREE.Group(), mm = mat(col(m.color ?? 'parkerized'), { m: 0.5, r: 0.5 })
  g.add(box(6.8, 0.28, 0.36, 3.1, 0, 0, mm, 'chshaft'))
  g.add(box(5.4, 0.08, 0.2, 3.4, -0.15, 0, mat(COLORS.dark, { m: 0.3, r: 0.7 }), 'chshaft'))
  g.add(box(0.45, 0.36, 1.7, -0.45, 0, 0, mm, 'chhandle'))
  g.add(box(0.7, 0.15, 0.45, -0.25, 0.05, 0.82, mm, 'chlatch'))
  g.add(box(0.5, 0.48, 0.36, 6.25, -0.12, 0, mm, 'chshaft'))
  return g
}

/* ---------- attachments ---------- */
const ATT_COLORS: Record<string, number> = { black: 0x1a1b1d, fde: 0x8f7a5c, ddc: 0x8a7a63, odgreen: 0x474c37, grey: 0x55595e }
const ATT_HALF: Record<string, Half> = { magazine: 'mag', sling: 'lower', pistolLight: 'lower' }
const lensMat = () => new THREE.MeshStandardMaterial({ color: 0x2c6db8, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.75 })

function attachOne(g: THREE.Group, A: Anchors, a: Attachment) {
  const key = 'att:' + a.id, type = a.type
  HALF = ATT_HALF[type] ?? 'upper'
  const M = mat(ATT_COLORS[a.color ?? 'black'] ?? ATT_COLORS.black, { m: 0.45, r: 0.5 }), dk = mat(0x0d0e10, { m: 0.3, r: 0.6 }), L = lensMat()
  const add = <T extends THREE.Mesh>(me: T): T => { (me.userData as MeshData).part = key; (me.userData as MeshData).att = type; g.add(me); return me }
  const pos = a.position ?? 'rear'
  const pick = (r: number, mid: number, f: number) => (pos === 'front' ? f : pos === 'middle' ? mid : r)
  if (A.kind === 'pistol') {
    const st = A.slideTop!, ox = A.opticX!, ry = A.railY!
    if (type === 'pistolOptic') {
      add(box(1.55, 0.22, 0.92, ox, st + 0.13, 0, M, key))
      add(ext([[0, 0], [1.45, 0], [1.25, 0.85], [0.35, 0.85]], 0.92, M, key, null, [[[0.25, 0.12], [1.2, 0.12], [1.05, 0.7], [0.42, 0.7]]])).position.set(ox - 0.72, st + 0.22, 0)
      add(box(0.04, 0.55, 0.62, ox + 0.2, st + 0.62, 0, L, key))
    } else if (type === 'pistolLight') {
      add(box(2.4, 0.95, 1.05, 2.05, ry - 0.6, 0, M, key))
      add(cylX(0.38, 0.2, 3.25, ry - 0.6, 0, mat(0xd8dde4, { m: 0.9, r: 0.15 }), key))
    } else if (type === 'suppressor') {
      add(cylX(0.62, 6.2, A.muzzleEnd - 0.1, A.by, 0, M, key))
      add(cylX(0.66, 0.35, A.muzzleEnd - 0.1, A.by, 0, M, key))
      add(cylX(0.16, 0.02, A.muzzleEnd + 6.11, A.by, 0, dk, key))
    }
    return
  }
  const R = A.railY!, hs = A.hgStart!, he = A.hgEnd!, mid = (hs + he) / 2, by = A.by, fl = A.flat!
  const railFront = A.topRail ? he : 4.25
  if (type === 'reddot') {
    const x = pick(-0.4, 2.0, railFront - 2.5)
    add(box(1.5, 0.55, 0.82, x, R + 0.27, 0, M, key))
    add(cylX(0.56, 1.7, x - 0.85, R + 1.08, 0, M, key))
    add(cylZ(0.18, 0.3, x, R + 1.08, 0.6, M, key)); add(cylY(0.18, 0.3, x, R + 1.7, 0, M, key))
    add(cylX(0.48, 0.03, x + 0.86, R + 1.08, 0, L, key))
  } else if (type === 'holo') {
    const x = pick(-0.6, 1.8, railFront - 2.5)
    add(box(2.7, 0.5, 1.25, x, R + 0.25, 0, M, key))
    ;[1, -1].forEach((s) => add(box(2.7, 1.15, 0.13, x, R + 1.05, s * 0.56, M, key)))
    add(box(2.7, 0.16, 1.25, x, R + 1.62, 0, M, key))
    add(box(0.04, 1.0, 1.0, x + 0.35, R + 1.05, 0, L, key))
    add(box(0.9, 0.45, 0.9, x - 1.0, R + 0.75, 0, M, key))
  } else if (type === 'lpvo') {
    const x = pick(0.4, 2.2, railFront - 4.5), cy = R + 1.55
    add(box(4.2, 0.45, 0.82, x, R + 0.22, 0, M, key))
    ;[-1.25, 1.25].forEach((dx) => { add(box(0.5, 0.9, 0.5, x + dx, R + 0.85, 0, M, key)); add(cylX(0.62, 0.5, x + dx - 0.25, cy, 0, M, key)) })
    add(cylX(0.5, 6.4, x - 3.2, cy, 0, M, key))
    add(cylX(0.74, 2.0, x - 5.0, cy, 0, M, key))
    add(cylX(0.7, 1.6, x + 3.0, cy, 0, M, key))
    add(cylX(0.62, 0.03, x + 4.61, cy, 0, L, key))
    add(cylY(0.36, 0.55, x, cy + 0.72, 0, M, key)); add(cylZ(0.36, 0.55, x, cy, -0.72, M, key))
    add(cylZ(0.18, 0.9, x - 4.4, cy, 0.6, M, key))
  } else if (type === 'magnifier') {
    const x = pick(-2.7, -0.6, railFront - 5)
    add(box(1.4, 0.5, 0.82, x, R + 0.25, 0, M, key))
    add(box(0.5, 0.7, 0.5, x, R + 0.7, 0.5, M, key))
    add(cylX(0.55, 2.9, x - 1.45, R + 1.08, 0, M, key))
    add(cylX(0.47, 0.03, x + 1.46, R + 1.08, 0, L, key))
  } else if (type === 'buis') {
    const fx = railFront - 1.0
    add(ext([[0, 0], [0.9, 0], [0.75, 0.62], [0.15, 0.62]], 0.62, M, key)).position.set(fx, R, 0)
    add(box(0.08, 0.55, 0.08, fx + 0.45, R + 0.85, 0, M, key))
    add(ext([[0, 0], [0.9, 0], [0.75, 0.62], [0.15, 0.62]], 0.7, M, key)).position.set(-3.4, R, 0)
    add(box(0.12, 0.4, 0.4, -2.95, R + 0.85, 0, M, key))
  } else if (type === 'light') {
    const x = pick(hs + 1.0, mid - 1.4, he - 2.7), side = a.side ?? 'right'
    let y = by, z = 0
    if (side === 'right') z = -(fl + 0.62); else if (side === 'left') z = fl + 0.62; else if (side === 'bottom') y = by - fl - 0.62; else y = R + 0.62
    add(cylX(0.55, 3.6, x - 1.8, y, z, M, key))
    add(cylX(0.68, 0.7, x + 1.6, y, z, M, key))
    add(cylX(0.6, 0.03, x + 2.31, y, z, mat(0xe6eaf0, { m: 0.9, r: 0.12 }), key))
    const lr = side === 'right' || side === 'left'
    const mz = side === 'right' ? -(fl + 0.2) : side === 'left' ? fl + 0.2 : 0
    const my = side === 'bottom' ? by - fl - 0.2 : side === 'top' ? R + 0.15 : by
    add(box(1.0, lr ? 0.5 : 0.3, lr ? 0.4 : 0.5, x, my, mz, M, key))
  } else if (type === 'laser') {
    const x = pick(hs + 1.8, mid, railFront - 2.2)
    add(box(3.4, 1.2, 1.45, x, R + 0.65, 0, M, key))
    add(cylX(0.22, 0.05, x + 1.7, R + 0.95, 0.35, L, key))
    add(cylX(0.22, 0.05, x + 1.7, R + 0.95, -0.35, mat(0xb03030, { m: 0.6, r: 0.2 }), key))
    add(cylY(0.2, 0.25, x - 0.6, R + 1.37, 0, M, key))
  } else if (type === 'suppressor') {
    const r = A.big ? 0.82 : 0.76, len = A.big ? 7.2 : 6.3
    add(cylX(r, len, A.muzzleEnd - 1.8, by, 0, M, key))
    add(cylX(r + 0.05, 0.45, A.muzzleEnd - 1.8, by, 0, M, key))
    add(cylX(0.22, 0.02, A.muzzleEnd - 1.8 + len + 0.01, by, 0, dk, key))
  } else if (type === 'foregrip') {
    const x = pick(hs + 1.6, mid, he - 2.4)
    add(box(1.6, 0.3, 0.6, x, by - fl - 0.15, 0, M, key))
    add(cylY(0.45, 3.6, x, by - fl - 2.0, 0, M, key))
    add(cylY(0.5, 0.25, x, by - fl - 3.85, 0, M, key))
  } else if (type === 'handstop') {
    const x = pick(hs + 1.4, mid, he - 1.5)
    add(ext([[0, 0], [2.0, 0], [1.75, -0.4], [0.4, -1.1], [0.1, -1.1]], 0.7, M, key)).position.set(x - 1.0, by - fl, 0)
  } else if (type === 'bipod') {
    const x = pick(mid, he - 2.0, he - 1.0)
    add(box(1.6, 0.55, 1.3, x, by - fl - 0.3, 0, M, key))
    ;[1, -1].forEach((s) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 6.4, 12), M.clone())
      leg.position.set(x + 0.2, by - fl - 3.6, s * 1.5); leg.rotation.x = s * 0.42; add(tag(leg, key))
      add(cylY(0.22, 0.2, x + 0.2, by - fl - 6.55, s * 2.85, dk, key))
    })
  } else if (type === 'sling') {
    add(cylZ(0.3, 0.35, -4.15, 0.55, 0.75, mat(0x2c2e31, { m: 0.7, r: 0.35 }), key))
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-4.15, 0.3, 0.95), new THREE.Vector3(-3.2, -3.8, 1.1), new THREE.Vector3(1.5, -6.6, 1.15),
      new THREE.Vector3(he - 6, -4.6, 1.1), new THREE.Vector3(he - 1.6, by - 0.2, fl + 0.3)])
    add(tag(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.13, 8, false), mat(ATT_COLORS[a.color ?? ''] ?? 0x30332f, { m: 0, r: 0.95 })), key))
    add(box(0.6, 0.35, 0.35, he - 1.6, by, fl + 0.15, mat(0x2c2e31, { m: 0.7, r: 0.35 }), key))
  } else if (type === 'magazine') {
    const pts: P2[] = A.big ? [[0.85, -2.55], [3.6, -2.55], [3.9, -6.9], [1.25, -7.1]]
      : [[0.85, -2.55], [3.55, -2.55], [3.75, -4.5], [4.3, -7.5], [4.45, -9.25], [1.7, -9.55], [1.4, -7.5], [0.95, -4.5]]
    add(ext(pts, A.big ? 0.95 : 0.85, mat(ATT_COLORS[a.color ?? ''] ?? 0x1c1d1f, POLY), key))
  }
}

/* ---------- exploded view offsets (model units) ---------- */
type V3 = [number, number, number]
const EXPLODE: Record<string, V3> = {
  upper: [0, 2.6, 0], rail: [0, 2.6, 0], port: [0, 2.6, 0], fa: [0, 2.6, 0], barrel: [0, 2.6, 0], gasblock: [0, 2.6, 0], handguard: [0, 2.6, 0], muzzle: [3, 2.6, 0], sights: [0, 2.6, 0],
  ch: [-3.5, 4.8, 0], carrier: [-1, 5.6, 0], gaskey: [-1, 6.4, 0], campin: [-1, 6.6, 0], bolt: [0.5, 5.6, 0], extractor: [0.5, 5.6, -1], bolt22: [-1, 5.6, 0],
  trigger: [0, -3, 0], fcg: [-0.3, -2.2, 0], pins: [0, -1.2, 2.4], safety: [0, 0, 2.6], magrel: [0, 0, -2.2], boltcatch: [0, 0, 2], pivot: [0, 0, 2.6], grip: [-1, -3.2, 0], guard: [0, -1.6, 0], tube: [-2.8, 0, 0], stock: [-5.5, 0, 0], mag: [0, -5, 0],
  slide: [0, 2.6, 0], pbarrel: [0, 4.6, 0], comp: [3, 2.6, 0], optic: [0, 2.6, 0], frame: [0, 0, 0], sstop: [0, 0, 2.2], takedown: [0, 0, 2.2],
}
const EXPLODE_ATT: Record<string, V3> = { reddot: [0, 5.2, 0], holo: [0, 5.2, 0], lpvo: [0, 5.6, 0], magnifier: [-1, 5.2, 0], buis: [0, 4.6, 0], laser: [0, 5.2, 0], light: [0, 2.6, 0], suppressor: [7, 2.6, 0], foregrip: [0, 0.6, 0], handstop: [0, 0.6, 0], bipod: [0, 0.2, 0], sling: [0, -3, 0], magazine: [0, -5, 0], pistolOptic: [0, 4.2, 0], pistolLight: [0, -2.4, 0] }
const EXPLODE_PART: Record<string, V3> = { bolt: [2.2, 0, 0], campin: [0, 1.6, 0], gaskey: [0, 1.3, 0], extractor: [2.2, 0, -1], chlatch: [0, 0, 1.6] }

export function explodeOffset(mesh: THREE.Mesh, standalone: boolean): V3 {
  const u = mesh.userData as MeshData
  if (u.att) {
    const o = EXPLODE_ATT[u.att] ?? [0, 2, 0]
    return u.att === 'light' && mesh.position.z !== 0 ? [o[0], o[1], o[2] + Math.sign(mesh.position.z) * 2] : o
  }
  if (standalone) return EXPLODE_PART[u.part] ?? [0, 0, 0]
  return EXPLODE[u.part] ?? [0, 0, 0]
}

/** Returns null when the item has no 3D model. */
export function buildModel(model: ModelDef | null | undefined, sel: BuildSel, attachments: Attachment[]): THREE.Group | null {
  if (!model || !model.kind) return null
  let g: THREE.Group
  switch (model.kind) {
    case 'rifle': g = rifle(model, sel); break
    case 'pistol': g = pistol(model); break
    case 'bcg': g = bcgPart(model); g.userData.standalone = true; break
    case 'chargingHandle': g = chPart(model); g.userData.standalone = true; break
    default: return null
  }
  const A = g.userData.anchors as Anchors | undefined
  if (A) attachments.forEach((a) => { try { attachOne(g, A, a) } catch (e) { console.error('Attachment failed', a, e) } })
  return g
}

export const PART_NAMES: Record<string, string> = {
  lower: 'Lower receiver', upper: 'Upper receiver', grip: 'Pistol grip', trigger: 'Trigger', guard: 'Trigger guard', fcg: 'Hammer and disconnector',
  pins: 'Trigger and hammer pins', safety: 'Safety selector', magrel: 'Magazine release', boltcatch: 'Bolt catch / release', pivot: 'Pivot and takedown pins',
  tube: 'Buffer tube and castle nut', stock: 'Stock', mag: 'Magazine', rail: 'Top rail', port: 'Ejection port and dust cover', fa: 'Forward assist',
  ch: 'Charging handle', carrier: 'Bolt carrier', gaskey: 'Gas key', campin: 'Cam pin', bolt: 'Bolt', bolt22: '.22 LR blowback bolt', extractor: 'Extractor',
  barrel: 'Barrel and barrel nut', gasblock: 'Gas block and gas tube', handguard: 'Handguard', muzzle: 'Muzzle device', sights: 'Sights', slide: 'Slide',
  frame: 'Frame and accessory rail', pbarrel: 'Barrel', comp: 'Compensator', optic: 'Optic-ready cover plate', sstop: 'Slide stop', takedown: 'Takedown lever',
  chshaft: 'Charging handle body', chhandle: 'Handle', chlatch: 'Latch',
}

export const LABEL_PARTS = ['lower', 'upper', 'trigger', 'grip', 'stock', 'tube', 'barrel', 'handguard', 'muzzle', 'ch', 'carrier', 'bolt22', 'mag', 'safety', 'sights', 'slide', 'frame', 'pbarrel', 'comp', 'optic', 'gaskey', 'bolt', 'chhandle', 'chlatch']
export const INSIDE_PARTS = ['carrier', 'gaskey', 'campin', 'bolt', 'extractor', 'fcg', 'pins', 'bolt22']
