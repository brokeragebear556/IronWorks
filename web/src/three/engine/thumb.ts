/* Still image of a build for its library card, from one shared offscreen renderer. */
import * as T from 'three'
import { buildGun, disposeGroup } from './assemble'
import type { Cat, EngGun } from './data'
import { Materials, studioEnv } from './materials'

let R: T.WebGLRenderer | null = null
let mats: Materials | null = null
const cache = new Map<string, string>()

export function buildThumbnail(g: EngGun, cat: Cat, withAtts: boolean, w = 640, h = 360): string {
  const key = JSON.stringify([g, withAtts, w, h])
  const hit = cache.get(key)
  if (hit) return hit
  if (!R) {
    R = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    R.setPixelRatio(1)
    R.setClearColor(0x1c2025)
    R.toneMapping = T.ACESFilmicToneMapping
    R.toneMappingExposure = 1.1
    mats = new Materials()
    mats.env = studioEnv(R)
  }
  R.setSize(w, h, false)
  const built = buildGun(g, cat, withAtts)
  const c = g.cfg
  const f = { finish: (c.finish as string) || 'black', furn: (c.furn as string) || 'black', hgFin: (c.hgFin as string) || null, barrelFin: (c.barrelFin as string) || null, look: g.look }
  built.meshes.forEach((m) => { m.material = mats!.get(m.userData.mat, 'real', m.userData.internal, m.userData.grp === 'att', f); m.visible = !m.userData.internal })
  const scene = new T.Scene()
  scene.environment = mats!.env
  scene.add(new T.HemisphereLight(0xffffff, 0x8a8780, 0.5 * Math.PI))
  const key1 = new T.DirectionalLight(0xffffff, 1.7 * Math.PI)
  key1.position.set(14, 40, 26)
  const rim = new T.DirectionalLight(0xdfe8ff, 0.6 * Math.PI)
  rim.position.set(-20, 12, -30)
  scene.add(key1, rim, built.group)
  built.group.updateMatrixWorld(true)
  const box = new T.Box3()
  built.meshes.forEach((m) => { if (m.visible) box.expandByObject(m) })
  const size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3())
  const cam = new T.PerspectiveCamera(28, w / h, 0.05, 1000)
  const tan = Math.tan((cam.fov * Math.PI) / 360)
  const d = Math.max(size.y / 2 / tan, size.x / 2 / (tan * cam.aspect)) * 1.08 + size.z
  // right side (ejection port), slightly from above and in front
  cam.position.set(ctr.x + d * 0.18, ctr.y + d * 0.12, ctr.z + d)
  cam.lookAt(ctr)
  cam.near = d / 200
  cam.far = d * 30
  cam.updateProjectionMatrix()
  R.render(scene, cam)
  const url = R.domElement.toDataURL('image/png')
  disposeGroup(built.group)
  cache.set(key, url)
  return url
}
