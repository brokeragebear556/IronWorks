/* Renders a still image of a gun's 3D model for its library card. One shared offscreen
   renderer is reused, and results are cached by everything that changes the picture. */
import * as THREE from 'three'
import type { Catalog, Gun } from '../types'
import { buildModel } from './models'

const PI = Math.PI
let renderer: THREE.WebGLRenderer | null = null
const cache = new Map<string, string>()

function getRenderer(w: number, h: number) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setClearColor(0x1c2025)
  }
  renderer.setSize(w, h, false)
  return renderer
}

function dispose(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
  })
}

/** Returns a PNG data URL, or null when the gun has no 3D model. */
export function modelThumbnail(gun: Gun, catalog: Catalog, withAttachments: boolean, w = 640, h = 360): string | null {
  const trigId = gun.upgrades?.triggers?.[0]
  const chId = gun.upgrades?.chargingHandles?.[0]
  const t = trigId ? catalog.triggers[trigId] : undefined
  const sel = { trigger: t ? { color: t.color, hammer: t.hammer, style: t.style } : null, chModel: chId ? catalog.chargingHandles[chId]?.model ?? null : null }
  const atts = withAttachments ? gun.attachments : []
  const key = JSON.stringify([gun.model, sel, atts, w, h])
  const hit = cache.get(key)
  if (hit) return hit

  const g = buildModel(gun.model, sel, atts)
  if (!g) return null
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe9eef6, 0x2a2d33, 1.35 * PI))
  const key1 = new THREE.DirectionalLight(0xffffff, 1.3 * PI); key1.position.set(6, 10, 12); scene.add(key1)
  const fill = new THREE.DirectionalLight(0xffe2b0, 0.35 * PI); fill.position.set(-6, -3, 8); scene.add(fill)
  const rim = new THREE.DirectionalLight(0xdfe6ff, 1.0 * PI); rim.position.set(-6, 9, -12); scene.add(rim)
  scene.add(g)
  g.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(g)
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.05, 1000)
  const tan = Math.tan((cam.fov * PI) / 360)
  const d = Math.max(size.y / 2 / tan, size.x / 2 / (tan * cam.aspect)) * 1.08 + size.z
  cam.position.set(c.x + d * 0.18, c.y + d * 0.12, c.z + d)
  cam.lookAt(c)
  cam.near = d / 200; cam.far = d * 30; cam.updateProjectionMatrix()

  const r = getRenderer(w, h)
  r.render(scene, cam)
  const url = r.domElement.toDataURL('image/png')
  dispose(g)
  cache.set(key, url)
  return url
}
