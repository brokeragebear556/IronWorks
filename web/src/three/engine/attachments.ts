import * as T from 'three'
import { effH, type Cat, type EngAtt, type EngGun } from './data'
import { box, cylX, ext, type AddOpts, type Builder } from './geometry'
import type { Info } from './platforms'

const TOPK = ['reddot', 'holo', 'prism', 'lpvo', 'scope', 'magn', 'buis', 'offset', 'riser']

/** Where an attachment sits along the gun (x, inches from the chamber) when it hasn't been placed by hand. */
export function defaultPos(a: EngAtt, I: Info): number {
  if (I.pistol) {
    if (a.k === 'pdot') return I.railStart + 0.6
    if (a.k === 'plight' || a.k === 'light' || a.k === 'laser') return I.hgEnd - a.len
    return 0
  }
  const top = I.railStart
  switch (a.k) {
    case 'lpvo': case 'scope': return top + 0.2
    case 'reddot': case 'holo': case 'prism': return top + 1.2
    case 'magn': return top - 1.0
    case 'riser': return top + 1.0
    case 'buis': return top
    case 'offset': return top + 2.9
    case 'light': case 'plight': return I.hgEnd - a.len - 0.2
    case 'laser': return I.hgEnd - a.len - 0.3
    case 'switch': return I.hgStart + 1.0
    case 'vfg': return I.hgStart + (I.hgEnd - I.hgStart) * 0.45
    case 'stop': return I.hgEnd - 2.2
    case 'bipod': return I.hgEnd - 2.0
    default: return 0
  }
}
export const isTop = (k: string) => TOPK.includes(k)

export function riserUnder(g: EngGun, a: EngAtt, I: Info): number {
  const rs = g.atts.find((r) => r.k === 'riser' && r !== a)
  if (!rs || !['reddot', 'holo', 'magn', 'lpvo', 'prism', 'scope'].includes(a.k)) return 0
  const rp = rs.pos ?? defaultPos(rs, I), ap = a.pos ?? defaultPos(a, I)
  return ap < rp + rs.len && ap + a.len > rp ? rs.h || 1 : 0
}
export function suppMount(cat: Cat, a: EngAtt, g: EngGun) {
  const ad = a.ad ? cat.AB[a.ad] : undefined
  return { sys: ad ? ad.gives ?? 'thread' : a.mt || 'thread', th: ad?.th || a.th || g.cfg.thread }
}

export function buildAtt(g: EngGun, a: EngAtt, B: Builder, I: Info, cat: Cat) {
  const pos = a.pos ?? defaultPos(a, I)
  const o: AddOpts = { key: 'att:' + a.id, att: a.id, attK: a.k, grp: 'att', ex: [0, 7.5, 0] }, lbl = a.n
  if (I.pistol && a.k === 'pdot') o.ak = 'slide'
  const top = I.rail + riserUnder(g, a, I), h = effH(cat, a) || 1.5, cy = top + h
  const A = (geo: T.BufferGeometry, mat: string, x = 0, y = 0, z = 0, extra: AddOpts = {}) => B.add(geo, mat, { ...o, x, y, z, ...extra })
  if (a.k === 'reddot' || a.k === 'magn') {
    const L = a.len, st = a.st || 'tube'
    if (st === 'box' || st === 'mini' || st === 'open') {
      const bh = st === 'mini' ? 0.75 : 1.25, bw = st === 'mini' ? 1.0 : 1.3
      if (h - bh / 2 > 0.3) A(box(Math.min(L * 0.9, 2.2), h - bh / 2 - 0.05, 0.9), 'att', pos + L / 2, top + (h - bh / 2) / 2)
      const pts: [number, number][] = st === 'open'
        ? [[0, 0], [L, 0], [L, 0.3], [L - 0.15, bh + 0.2], [L - 0.35, bh + 0.2], [L - 0.4, 0.35], [0.2, 0.35], [0, 0.25]]
        : [[0, 0], [L, 0], [L, bh * 0.8], [L - 0.2, bh], [0.25, bh], [0, bh * 0.8]]
      A(ext(pts, bw, 0.06, st === 'open' ? null : [[[0.18, bh * 0.2], [L - 0.18, bh * 0.2], [L - 0.18, bh * 0.78], [0.18, bh * 0.78]]]), 'att', pos, cy - bh / 2, 0, { label: lbl, lab: 1 })
      A(box(0.03, bh * 0.55, bw * 0.8), 'glass', pos + L - (st === 'open' ? 0.3 : 0.12), cy + 0.05)
    } else {
      const r = a.r || (a.k === 'magn' ? 0.62 : 0.5)
      A(box(Math.min(L * 0.8, 2.2), Math.max(0.1, h - r * 0.5), 0.9), 'att', pos + L / 2, top + (h - r * 0.5) / 2 - 0.02)
      A(cylX(r, r * (a.k === 'magn' ? 0.9 : 1), L, 28), 'att', pos, cy, 0, { label: lbl, lab: 1 })
      A(cylX(r * 0.8, r * 0.8, 0.02), 'glass', pos + L + 0.005, cy)
      A(cylX(0.2, 0.2, 0.4), 'att', pos + L * 0.45, cy, r + 0.1)
    }
  } else if (a.k === 'holo') {
    A(box(a.len, 0.5, 1.3), 'att', pos + a.len / 2, top + 0.25)
    A(ext([[0, 0], [a.len, 0], [a.len, 2.1], [a.len - 0.3, 2.25], [0.3, 2.25], [0, 2.1], [0, 1.0], [0.2, 0.5]], 2.3, 0.08, [[[0.25, 0.95], [a.len - 0.25, 0.95], [a.len - 0.25, 1.95], [0.25, 1.95]]]), 'att', pos, top + 0.2, 0, { label: lbl, lab: 1 })
    A(box(0.03, 1.0, 1.5), 'glass', pos + a.len - 0.15, top + 1.45)
  } else if (a.k === 'prism') {
    const L = a.len, ob = (a.mag || 1) >= 3 ? 0.62 : 0.5
    A(box(Math.min(L * 0.7, 2.4), Math.max(0.1, h - 0.55), 0.95), 'att', pos + L / 2, top + (h - 0.55) / 2)
    A(ext([[0, -0.55], [L * 0.62, -0.55], [L * 0.62, 0.55], [0, 0.55]], 1.35, 0.1), 'att', pos, cy, 0, { label: lbl, lab: 1 })
    A(cylX(0.55, ob, L * 0.38, 24), 'att', pos + L * 0.62, cy)
    A(cylX(ob * 0.85, ob * 0.85, 0.02), 'glass', pos + L + 0.005, cy)
    A(new T.CylinderGeometry(0.3, 0.3, 0.35, 16), 'att', pos + L * 0.35, cy + 0.7)
  } else if (a.k === 'lpvo' || a.k === 'scope') {
    const L = a.len, x0 = pos, sc = a.k === 'scope', obR = sc ? ((a.mag || 9) > 12 ? 1.15 : 0.95) : 0.78
    A(cylX(0.92, 0.62, 3.0, 28), 'att', x0, cy, 0, { label: lbl, lab: 1 })
    A(cylX(0.59, 0.59, Math.max(1, L - 5.2)), 'att', x0 + 3.0, cy)
    A(cylX(0.6, obR, 1.0), 'att', x0 + L - 2.2, cy)
    A(cylX(obR, obR, 1.2), 'att', x0 + L - 1.2, cy)
    A(cylX(obR * 0.85, obR * 0.85, 0.02), 'glass', x0 + L + 0.005, cy)
    A(new T.CylinderGeometry(0.42, 0.42, 0.55, 20), 'att', x0 + L * 0.52, cy + 0.78)
    A(new T.CylinderGeometry(0.42, 0.42, 0.55, 20), 'att', x0 + L * 0.52, cy, 0.78, { rx: Math.PI / 2 })
    if (!sc) A(box(0.18, 0.7, 0.18), 'att', x0 + 2.4, cy + 0.1, -0.9)
    const mx = x0 + 3.3
    A(box(4.2, 0.42, 1.05), 'att', mx + 1.8, top + 0.21)
    ;[mx + 0.35, mx + 2.9].forEach((rx) => {
      A(box(0.65, Math.max(0.1, h - 0.5), 0.7), 'att', rx, top + (h - 0.5) / 2 + 0.15)
      A(cylX(0.74, 0.74, 0.65, 24), 'att', rx - 0.32, cy)
    })
  } else if (a.k === 'buis') {
    const show = !g.atts.some((x) => ['lpvo', 'scope'].includes(x.k)), hb = show ? 1.41 : 0.45, off = a.st === 'offset'
    const front = I.railEnd - 1.4, rear = I.railStart + 0.2
    if (off) {
      A(box(1.2, 0.5, 0.5), 'att', rear + 0.6, top + 0.3, 0.6, { label: 'Offset BUIS', lab: 1, rx: -Math.PI / 4 })
      A(box(1.0, 0.5, 0.5), 'att', front + 0.5, top + 0.3, 0.6, { rx: -Math.PI / 4 })
    } else {
      A(ext([[0, 0], [1.3, 0], [1.1, hb], [0.4, hb], [0.2, 0.35]], 0.62, 0.04), 'att', rear, top, 0, { label: show ? `${lbl} (deployed)` : `${lbl} (folded)`, lab: 1, ak: 'buisR' })
      A(ext([[0, 0], [1.1, 0], [0.8, hb + 0.1], [0.5, hb + 0.1], [0.2, 0.3]], 0.5, 0.04), 'att', front, top, 0, { ak: 'buisF' })
    }
  } else if (a.k === 'offset') {
    const m = A(box(1.9, 0.9, 0.8), 'att', pos + 0.95, top + 0.25 + 0.45 * Math.cos(Math.PI / 4), 0.55, { rx: -Math.PI / 4, label: (a.sub ? cat.AB[a.sub]?.n : null) || lbl, lab: 1 })
    m.userData.base.copy(m.position)
    A(box(1.1, 0.45, 0.4), 'att', pos + 0.95, top + 0.2, 0.3, { rx: -Math.PI / 4 })
  } else if (a.k === 'pdot') {
    A(ext([[0, 0], [a.len, 0], [a.len, 0.55], [a.len - 0.2, 0.75], [0.2, 0.75], [0, 0.45]], 1.0, 0.05, [[[0.25, 0.25], [a.len - 0.2, 0.25], [a.len - 0.2, 0.62], [0.25, 0.62]]]), 'att', pos, I.slideTop ?? top, 0, { label: lbl, lab: 1 })
  } else if (a.k === 'light' || a.k === 'plight' || a.k === 'laser') {
    if (I.pistol) {
      A(box(a.len, 0.75, 0.95), 'att', pos + a.len / 2, I.hgCy + 0.05, 0, { label: lbl, lab: 1 })
      A(cylX(0.35, 0.35, 0.02), 'glass', pos + a.len + 0.005, I.hgCy + 0.05, 0, { ak: 'lens' })
      a._lens = [pos + a.len, I.hgCy + 0.05, 0]
    } else if (a.k === 'laser') {
      const t = ((a.clock || 0) * Math.PI) / 6, rr2 = I.hgR + 0.55
      A(box(a.len, 1.1, 1.0), 'att', pos + a.len / 2, I.hgCy + rr2 * Math.cos(t), rr2 * Math.sin(t), { label: lbl, lab: 1, rx: -t })
      a._lens = [pos + a.len, I.hgCy + rr2 * Math.cos(t), rr2 * Math.sin(t)]
    } else {
      const t = ((a.clock || 0) * Math.PI) / 6, rr2 = I.hgR + 0.62, y = I.hgCy + rr2 * Math.cos(t), z = rr2 * Math.sin(t)
      A(cylX(0.5, 0.5, Math.max(0.6, a.len - 1.2)), 'att', pos, y, z, { label: lbl, lab: 1 })
      A(cylX(0.5, 0.6, 1.2), 'att', pos + Math.max(0.6, a.len - 1.2), y, z)
      A(cylX(0.55, 0.55, 0.02), 'glass', pos + a.len + 0.005, y, z)
      A(box(1.4, 0.5, 0.5), 'att', pos + a.len * 0.5, I.hgCy + (I.hgR + 0.2) * Math.cos(t), (I.hgR + 0.2) * Math.sin(t), { rx: -t })
      a._lens = [pos + a.len, y, z]
    }
  } else if (a.k === 'switch') {
    const t = (10 * Math.PI) / 6
    A(box(1.4, 0.25, 0.7), 'att', pos + 0.7, I.hgCy + (I.hgR + 0.12) * Math.cos(t), (I.hgR + 0.12) * Math.sin(t), { rx: -t, label: lbl, lab: 1 })
  } else if (a.k === 'vfg') {
    if (a.st === 'angled') A(ext([[-0.2, 0], [2.6, 0], [2.4, -0.3], [1.6, -0.75], [-0.1, -0.95], [-0.4, -0.5]], 1.0, 0.1), 'att', pos, I.hgCy - I.hgR, 0, { label: lbl, lab: 1 })
    else A(ext([[-0.55, 0], [0.55, 0], [0.5, -0.4], [0.42, -3.6], [0.2, -3.8], [-0.25, -3.8], [-0.45, -3.6], [-0.5, -0.4]], 1.05, 0.14), 'att', pos, I.hgCy - I.hgR, 0, { label: lbl, lab: 1 })
  } else if (a.k === 'stop') {
    A(ext([[0, 0], [1.8, 0], [1.6, -0.45], [0.4, -0.7], [0, -0.3]], 0.7, 0.08), 'att', pos, I.hgCy - I.hgR, 0, { label: lbl, lab: 1 })
  } else if (a.k === 'bipod') {
    A(box(2.0, 0.6, 1.4), 'att', pos + 1, I.hgCy - I.hgR - 0.3, 0, { label: lbl, lab: 1 })
    ;[-0.45, 0.45].forEach((z) => A(cylX(0.17, 0.15, 7.2), 'att', pos + 1.6, I.hgCy - I.hgR - 0.55, z, { ak: 'bipodLeg' }))
  } else if (a.k === 'riser') {
    A(box(a.len, (a.h || 1) - 0.12, 1.0), 'att', pos + a.len / 2, I.rail + ((a.h || 1) - 0.12) / 2, 0, { label: lbl, lab: 1 })
    B.rail(pos, pos + a.len, I.rail + (a.h || 1), { ...o })
  } else if (a.k === 'supp') {
    const m = suppMount(cat, a, g), qd = !['thread', 'piston', 'choke'].includes(m.sys)
    const x0 = qd ? I.muzzleX + 0.15 : I.muzzleX - 0.5, r = (a.dia || 1.5) / 2
    const so: AddOpts = { ...o, ak: 'supp', ex: [6, 0, 0] }
    B.add(cylX(r, r, a.len, 36), 'can', { ...so, x: x0, label: lbl, lab: 1 })
    ;[0.25, a.len - 0.55].forEach((dx) => B.add(cylX(r + 0.025, r + 0.025, 0.3, 36), 'can2', { ...so, x: x0 + dx }))
    B.add(cylX(r * 0.5, r * 0.5, 0.02), 'dark', { ...so, x: x0 + a.len + 0.005 })
    a._end = x0 + a.len
    a._x0 = x0
  } else if (a.k === 'sling') {
    const p0 = new T.Vector3(I.hgEnd - 2.2, I.hgCy - I.hgR - 0.1, -0.6), p3 = new T.Vector3(I.butt + 1.0, -2.6, -0.85)
    const curve = new T.CubicBezierCurve3(p0, new T.Vector3(p0.x - 4, -9.5, -0.9), new T.Vector3(p3.x + 6, -9, -1), p3)
    A(new T.TubeGeometry(curve, 60, 0.22, 8), 'sling', 0, 0, 0, { label: lbl, lab: 1, ex: [0, -6, 0] })
  }
}
