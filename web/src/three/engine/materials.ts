import * as T from 'three'
import { FIN, type Mode } from './data'

/** A soft studio environment (a dim room with a few big light panels) for reflections. */
export function studioEnv(R: T.WebGLRenderer): T.Texture {
  const pm = new T.PMREMGenerator(R), es = new T.Scene()
  es.add(new T.Mesh(new T.BoxGeometry(100, 100, 100), new T.MeshBasicMaterial({ color: 0x2a2c2f, side: T.BackSide })))
  ;([[0, 45, 0, 60, 60, 1.6], [-48, 10, 0, 30, 60, 1.0], [48, 14, 10, 30, 50, 0.8], [0, 10, -48, 70, 30, 0.55]] as const).forEach(([x, y, z, w, h, i]) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(i, i, i), side: T.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    es.add(m)
  })
  const tex = pm.fromScene(es, 0.04).texture
  pm.dispose()
  es.traverse((o) => { const m = o as T.Mesh; if (m.geometry) { m.geometry.dispose(); (m.material as T.Material).dispose() } })
  return tex
}

export interface Finishes { finish: string; furn: string; hgFin: string | null; barrelFin: string | null; look?: Record<string, number> }

/** Physically based colours for each material key in Realistic and Cutaway. [colour, metalness, roughness] */
function realParams(key: string, f: Finishes): [string, number, number] {
  const F = FIN[f.finish] || FIN.black
  const Fu = f.furn === 'wood' ? '#7a4a25' : FIN[f.furn] || FIN.black
  switch (key) {
    case 'anod': case 'ch': return [F, 0.35, 0.55]
    case 'hgfin': return [FIN[f.hgFin ?? ''] || F, 0.12, 0.7]
    case 'slide': return [F, 0.45, 0.45]
    case 'poly': return ['#161719', 0, 0.8]
    case 'fdep': return ['#a68b66', 0, 0.78]
    case 'furn': return [Fu, 0, f.furn === 'wood' ? 0.55 : 0.82]
    case 'wood': return ['#6e4120', 0, 0.55]
    case 'barrel': return f.barrelFin === 'gold' ? ['#c9a046', 0.9, 0.3] : ['#2c2e31', 0.65, 0.42]
    case 'steel': case 'muzzle': return ['#2c2e31', 0.65, 0.42]
    case 'chrome': return ['#c7cacd', 0.95, 0.2]
    case 'spring': return ['#9da1a6', 0.9, 0.3]
    case 'dark': return ['#0b0c0d', 0.1, 0.8]
    case 'mag': return ['#141516', 0, 0.75]
    case 'att': return ['#18191b', 0.35, 0.55]
    case 'can': return ['#26282b', 0.15, 0.66]
    case 'can2': return ['#33363a', 0.3, 0.5]
    case 'glass': return ['#5d8fb3', 0.2, 0.05]
    case 'rubber': return ['#161616', 0, 0.95]
    case 'sling': return ['#4a4b3e', 0, 0.95]
    default: return ['#333333', 0.3, 0.5]
  }
}

/** Material cache for one stage. Materials depend on the look, whether the part is inside the
 *  receiver, whether it's an attachment and the gun's finishes. */
export class Materials {
  private cache = new Map<string, T.Material>()
  readonly clip = [new T.Plane(new T.Vector3(0, 0, -1), 0.001)]
  env: T.Texture | null = null

  get(key: string, mode: Mode, internal: boolean, isAtt: boolean, f: Finishes): T.Material {
    const id = [key, mode, internal ? 1 : 0, isAtt ? 1 : 0, f.finish, f.furn, f.hgFin, f.barrelFin, f.look?.[key] ?? ''].join('|')
    let m = this.cache.get(id)
    if (m) return m
    if (mode === 'clay') {
      const c = isAtt ? (key === 'glass' ? 0x9bb7c9 : 0xe3c766) : internal ? 0xb9bec4 : key === 'dark' ? 0x8f8d87 : key === 'glass' ? 0x9bb7c9 : 0xd3d0c9
      m = new T.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0 })
    } else if (mode === 'real' || mode === 'cut') {
      const [col, metal, rough] = realParams(key, f)
      const own = isAtt ? undefined : f.look?.[key] // colour from the original model, if it gave one
      const gold = own === 0xc99f45
      const s = new T.MeshStandardMaterial({ color: own ?? col, metalness: gold ? 0.92 : metal, roughness: gold ? 0.28 : rough, envMap: this.env, envMapIntensity: 0.8 })
      if (key === 'glass') { s.transparent = true; s.opacity = 0.55; s.emissive = new T.Color('#16324a') }
      if (mode === 'cut') {
        if (internal) s.emissive = new T.Color(0x3a1c08)
        else { s.clippingPlanes = this.clip; s.side = T.DoubleSide; s.clipShadows = true }
      }
      m = s
    } else if (mode === 'xray') {
      m = internal
        ? new T.MeshStandardMaterial({ color: 0xff7a3d, emissive: 0x6b2208, roughness: 0.5, metalness: 0.2 })
        : new T.MeshBasicMaterial({ color: isAtt ? 0xffd479 : 0x58b8ff, transparent: true, opacity: isAtt ? 0.16 : 0.1, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide })
    } else {
      m = new T.MeshBasicMaterial({ color: isAtt ? 0x3c6fb0 : 0x2a64a8, transparent: true, opacity: 0.45, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
    }
    this.cache.set(id, m)
    return m
  }

  readonly lines = {
    blue: new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    xray: new T.LineBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.35, depthWrite: false }),
  }

  dispose() {
    this.cache.forEach((m) => m.dispose())
    this.cache.clear()
    this.lines.blue.dispose()
    this.lines.xray.dispose()
  }
}
