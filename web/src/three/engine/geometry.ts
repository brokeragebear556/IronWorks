import * as T from 'three'

// Geometry helpers. Profiles are drawn in the x/y plane (side view) and extruded across z.

export type P2 = [number, number]

export function shp(pts: P2[]): T.Shape {
  const s = new T.Shape()
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])))
  return s
}
/** Side profile extruded to `depth`, centred on z = 0, with a small bevel. */
export function ext(pts: P2[], depth: number, bev = 0.03, holes?: P2[][] | null): T.BufferGeometry {
  const s = shp(pts)
  holes?.forEach((h) => {
    const p = new T.Path()
    h.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])))
    s.holes.push(p)
  })
  const d = Math.max(0.01, depth - 2 * bev)
  const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 10 })
  g.translate(0, 0, -d / 2)
  return g
}
/** Cross-section (y/z) extruded along +x for `len`. */
export function extX(sec: P2[], len: number): T.BufferGeometry {
  const g = new T.ExtrudeGeometry(shp(sec), { depth: len, bevelEnabled: false, curveSegments: 12 })
  g.rotateY(Math.PI / 2)
  return g
}
/** Cylinder along +x from 0 to len (r0 at the rear, r1 at the front). */
export function cylX(r0: number, r1: number, len: number, seg = 28, open = false): T.BufferGeometry {
  const g = new T.CylinderGeometry(r1, r0, len, seg, 1, open)
  g.rotateZ(-Math.PI / 2)
  g.translate(len / 2, 0, 0)
  return g
}
export const box = (w: number, h: number, d: number) => new T.BoxGeometry(w, h, d)
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 10): P2[] {
  const o: P2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return o
}
export function rr(x0: number, y0: number, x1: number, y1: number, r: number): P2[] {
  return [...arc(x1 - r, y0 + r, r, -Math.PI / 2, 0, 4), ...arc(x1 - r, y1 - r, r, 0, Math.PI / 2, 4), ...arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, 4), ...arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, 4)]
}
export function octSec(a: number, cy = 0): P2[] {
  const r = a / Math.cos(Math.PI / 8), o: P2[] = []
  for (let i = 0; i < 8; i++) {
    const t = Math.PI / 8 + (i * Math.PI) / 4
    o.push([r * Math.cos(t), cy + r * Math.sin(t)])
  }
  return o
}
export class Helix extends T.Curve<T.Vector3> {
  x0: number; len: number; r: number; turns: number
  constructor(x0: number, len: number, r: number, turns: number) {
    super()
    this.x0 = x0; this.len = len; this.r = r; this.turns = turns
  }
  getPoint(t: number, o = new T.Vector3()) {
    const a = t * this.turns * Math.PI * 2
    return o.set(this.x0 + t * this.len, this.r * Math.sin(a), this.r * Math.cos(a))
  }
}

// ---------- builder context ----------
export type Grp = 'upper' | 'lower' | 'att'
export interface MeshUser {
  mat: string
  key: string
  ak: string | null
  label: string | null | undefined
  grp: Grp
  ex: T.Vector3
  lab: boolean
  internal: boolean
  att: string | null
  attK: string | null
  inst?: boolean
  base: T.Vector3
  q0: T.Quaternion
  edges?: T.LineSegments
  noTake?: boolean
}
export type EMesh = T.Mesh & { userData: MeshUser }
export interface AddOpts {
  key?: string; ak?: string | null; label?: string | null; grp?: Grp; ex?: number[]; lab?: boolean | number; internal?: boolean | number
  att?: string | null; attK?: string | null; x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; mat?: string
}
export interface Builder {
  meshes: EMesh[]
  add(geom: T.BufferGeometry, mat: string, o?: AddOpts): EMesh
  inst(geom: T.BufferGeometry, mat: string, mats: T.Matrix4[], o: AddOpts): EMesh
  rail(x0: number, x1: number, top: number, o: AddOpts, z?: number, width?: number, rot?: number, cy?: number): number
}
const PLACEHOLDER = new T.MeshBasicMaterial()

export function ctx(grp: T.Group): Builder {
  const meshes: EMesh[] = []
  const user = (mat: string, o: AddOpts): MeshUser => ({
    mat, key: o.key || 'misc', ak: o.ak || null, label: o.label, grp: o.grp || 'upper', ex: new T.Vector3(...((o.ex || [0, 0, 0]) as [number, number, number])),
    lab: !!o.lab, internal: !!o.internal, att: o.att || null, attK: o.attK || null, base: new T.Vector3(), q0: new T.Quaternion(),
  })
  const B: Builder = {
    meshes,
    add(geom, mat, o = {}) {
      const m = new T.Mesh(geom, PLACEHOLDER) as unknown as EMesh
      m.userData = user(mat, o)
      m.position.set(o.x || 0, o.y || 0, o.z || 0)
      if (o.rx) m.rotation.x = o.rx
      if (o.ry) m.rotation.y = o.ry
      if (o.rz) m.rotation.z = o.rz
      m.userData.base = m.position.clone()
      m.userData.q0 = m.quaternion.clone()
      m.castShadow = !o.internal
      grp.add(m)
      meshes.push(m)
      return m
    },
    inst(geom, mat, mats, o) {
      const m = new T.InstancedMesh(geom, PLACEHOLDER, mats.length) as unknown as EMesh & T.InstancedMesh
      mats.forEach((mx, i) => m.setMatrixAt(i, mx))
      m.userData = { ...user(mat, o), label: null, lab: false, inst: true }
      m.castShadow = true
      grp.add(m)
      meshes.push(m)
      return m
    },
    rail(x0, x1, top, o, z = 0, width = 0.835, rot = 0, cy = 0) {
      const n = Math.max(1, Math.floor((x1 - x0 - 0.1) / 0.394))
      const mats: T.Matrix4[] = []
      const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), rot)
      for (let i = 0; i < n; i++) {
        const p = new T.Vector3(x0 + 0.15 + i * 0.394 + 0.094, top - 0.07, 0)
        if (rot) { p.y -= cy; p.applyQuaternion(q); p.y += cy }
        p.z += z
        mats.push(new T.Matrix4().compose(p, q, new T.Vector3(1, 1, 1)))
      }
      B.inst(box(0.188, 0.14, width), o.mat || 'anod', mats, o)
      const base = B.add(box(x1 - x0, 0.2, width * 0.82), o.mat || 'anod', { ...o, x: (x0 + x1) / 2, y: top - 0.24, z, lab: false })
      if (rot) {
        const p = new T.Vector3(0, top - 0.24 - cy, 0).applyQuaternion(q)
        base.position.set((x0 + x1) / 2, cy + p.y, z + p.z)
        base.rotation.x = rot
        base.userData.base = base.position.clone()
        base.userData.q0 = base.quaternion.clone()
      }
      return n
    },
  }
  return B
}
