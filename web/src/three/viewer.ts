/* The 3D bench: scene, camera, lights, display modes, labels, picking and the
   experimental photo projection. Framework-free so React only has to feed it state. */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Attachment, ModelDef, View } from '../types'
import { buildModel, explodeOffset, INSIDE_PARTS, LABEL_PARTS, type BuildSel, type MeshData } from './models'

export interface Looks { xray: boolean; shading: boolean; blueprint: boolean; exploded: boolean; labels: boolean }
export interface SkinGroup { half: string; urls: string[] }
export interface SceneInput {
  key: string
  model: ModelDef | null | undefined
  sel: BuildSel
  attachments: Attachment[]
  view: View | null // null = not splittable
  skin: { groups: SkinGroup[]; index: number; flip: Record<string, boolean>; isPistol: boolean } | null
}

const ACCENT = 0xd9a441
const PI = Math.PI // light intensities are physical since three r155

interface SkinTex { tex: THREE.CanvasTexture; thinRight: boolean }
const texCache = new Map<string, Promise<SkinTex>>()

function loadSkin(url: string): Promise<SkinTex> {
  const hit = texCache.get(url)
  if (hit) return hit
  const p = new Promise<SkinTex>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight
      const c = document.createElement('canvas'); c.width = W; c.height = H
      const x = c.getContext('2d', { willReadFrequently: true })!
      x.drawImage(img, 0, 0)
      const px = x.getImageData(0, 0, W, H).data
      const bg = (i: number) => px[i] > 228 && px[i + 1] > 228 && px[i + 2] > 228
      // the gun is the heaviest band of rows, then the heaviest band of columns inside it;
      // that skips logos and extra product shots separated by white space
      const heaviest = (counts: number[], gap: number) => {
        let best: { a: number; b: number; mass: number } | null = null
        let cur: { a: number; b: number; mass: number } | null = null
        let blank = 0
        counts.forEach((n, i) => {
          if (n > 0) { cur ??= { a: i, b: i, mass: 0 }; cur.b = i; cur.mass += n; blank = 0 }
          else if (cur && ++blank > gap) { if (!best || cur.mass > best.mass) best = cur; cur = null; blank = 0 }
        })
        if (cur && (!best || (cur as { mass: number }).mass > (best as { mass: number }).mass)) best = cur
        return best as { a: number; b: number; mass: number } | null
      }
      const rows = new Array<number>(H).fill(0)
      for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) if (!bg((y * W + i) * 4)) rows[y]++
      const rb = heaviest(rows, Math.max(2, Math.round(H * 0.02)))
      if (!rb) { reject(new Error('blank image')); return }
      const cols = new Array<number>(W).fill(0)
      for (let y = rb.a; y <= rb.b; y++) for (let i = 0; i < W; i++) if (!bg((y * W + i) * 4)) cols[i]++
      const cb = heaviest(cols, Math.max(2, Math.round(W * 0.03)))!
      const w = cb.b - cb.a + 1, h = rb.b - rb.a + 1
      const colMass = cols.slice(cb.a, cb.b + 1)
      const band = Math.max(1, Math.floor(w * 0.12))
      const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
      const o = document.createElement('canvas'); o.width = w; o.height = h
      const id = x.getImageData(cb.a, rb.a, w, h), q = id.data
      for (let i = 0; i < q.length; i += 4) if (q[i] > 228 && q[i + 1] > 228 && q[i + 2] > 228) { q[i] = 30; q[i + 1] = 31; q[i + 2] = 34 }
      o.getContext('2d')!.putImageData(id, 0, 0)
      const tex = new THREE.CanvasTexture(o)
      tex.colorSpace = THREE.SRGBColorSpace
      resolve({ tex, thinRight: avg(colMass.slice(w - band)) < avg(colMass.slice(0, band)) })
    }
    img.onerror = () => reject(new Error('Could not load ' + url))
    img.src = url
  })
  texCache.set(url, p)
  p.catch(() => texCache.delete(url))
  return p
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 1000)
  private controls: OrbitControls
  private hemi = new THREE.HemisphereLight(0xe9eef6, 0x2a2d33, 1.35 * PI)
  private key = new THREE.DirectionalLight(0xffffff, 1.3 * PI)
  private rim = new THREE.DirectionalLight(0xdfe6ff, 1.0 * PI)
  private ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.38 }))
  private grid: THREE.GridHelper | null = null
  private gridArgs: { s: THREE.Vector3; c: THREE.Vector3; y: number } | null = null
  private env: THREE.Texture | null = null
  private model: THREE.Group | null = null
  private looks: Looks = { xray: false, shading: false, blueprint: false, exploded: false, labels: false }
  private explodeNow = 0
  private userMoved = false
  private picked: string | null = null
  private labels: { part: string; el: HTMLDivElement; meshes: THREE.Mesh[] }[] = []
  private skinToken = 0
  private raf = 0
  private ro: ResizeObserver
  private down: [number, number] | null = null
  onPick: (part: string | null) => void = () => {}
  onSkinNote: (note: string, canMirror: boolean, canNext: boolean) => void = () => {}
  partLabel: (part: string) => string = (p) => p

  private host: HTMLElement
  private labelLayer: HTMLElement

  constructor(host: HTMLElement, labelLayer: HTMLElement) {
    this.host = host
    this.labelLayer = labelLayer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x111316)
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotateSpeed = 1.4
    this.controls.addEventListener('start', () => { this.userMoved = true })
    this.scene.add(this.hemi)
    this.key.position.set(6, 10, 12); this.scene.add(this.key); this.scene.add(this.key.target)
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02
    const fill = new THREE.DirectionalLight(0xffe2b0, 0.35 * PI); fill.position.set(-6, -3, 8); this.scene.add(fill)
    this.rim.position.set(-6, 9, -12); this.scene.add(this.rim)
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; this.ground.visible = false; this.scene.add(this.ground)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame() }
    loop()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.clearModel()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labelLayer.innerHTML = ''
  }

  // ---------- scene input ----------
  setScene(input: SceneInput, keepView: boolean) {
    this.clearModel()
    const built = buildModel(input.model, input.sel, input.attachments)
    const g = built ?? new THREE.Group()
    if (input.view && input.view !== 'full' && built) {
      const drop: THREE.Mesh[] = []
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.userData as MeshData).half !== input.view) drop.push(o as THREE.Mesh) })
      drop.forEach((o) => { o.parent?.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose() })
    }
    const standalone = !!g.userData.standalone
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) { const u = m.userData as MeshData; u.base = m.position.clone(); u.exp = explodeOffset(m, standalone) }
    })
    this.model = g
    this.setExplode(this.explodeNow)
    this.scene.add(g)
    if (!keepView) { this.userMoved = false; this.fit() }
    if (this.grid) this.grid.visible = !!built
    this.applyLooks()
    this.applySkin(input)
    return !!built
  }

  setLooks(l: Looks) {
    const explodeChanged = l.exploded !== this.looks.exploded
    const bpChanged = l.blueprint !== this.looks.blueprint
    this.looks = { ...l }
    if (bpChanged) this.makeGrid()
    this.applyLooks()
    if (explodeChanged && !this.userMoved) this.fit()
  }

  setSpin(on: boolean) { this.controls.autoRotate = on }
  resetView() { this.userMoved = false; this.fit() }

  highlight(part: string | null) {
    this.picked = part
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mt = m.material as THREE.MeshStandardMaterial
      if (!mt.emissive) return
      const on = !!part && (m.userData as MeshData).part === part
      mt.emissive.setHex(on ? ACCENT : 0)
      mt.emissiveIntensity = on ? 0.45 : 0
    })
    this.labels.forEach((L) => L.el.classList.toggle('on', L.part === part))
  }

  presentParts(): Set<string> {
    const s = new Set<string>()
    this.model?.traverse((o) => { if ((o as THREE.Mesh).isMesh) s.add((o.userData as MeshData).part) })
    return s
  }

  // ---------- internals ----------
  private clearModel() {
    if (!this.model) return
    this.scene.remove(this.model)
    this.model.traverse((o) => {
      const m = o as THREE.Mesh | THREE.LineSegments
      if ((m as THREE.Mesh).isMesh || (m as THREE.LineSegments).isLineSegments) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
        const mat0 = (m.userData as { mat0?: THREE.Material }).mat0
        mat0?.dispose()
      }
    })
    this.model = null
    this.labelLayer.innerHTML = ''
    this.labels = []
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.model && !this.userMoved) this.fit()
  }

  private setExplode(t: number) {
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh
      const u = m.userData as MeshData
      if (m.isMesh && u.base && u.exp) m.position.set(u.base.x + u.exp[0] * t, u.base.y + u.exp[1] * t, u.base.z + u.exp[2] * t)
    })
  }

  private fit() {
    if (!this.model || !this.model.children.length) { if (this.grid) this.grid.visible = false; this.ground.visible = false; return }
    this.setExplode(this.looks.exploded ? 1 : 0)
    this.model.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(this.model), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3())
    this.setExplode(this.explodeNow)
    const t = Math.tan((this.camera.fov * Math.PI) / 360)
    const d = Math.max(s.y / 2 / t, s.x / 2 / (t * this.camera.aspect)) * 1.2 + s.z
    this.camera.position.set(c.x + d * 0.28, c.y + d * 0.2, c.z + d)
    this.camera.near = d / 200; this.camera.far = d * 30; this.camera.updateProjectionMatrix()
    this.controls.target.copy(c); this.controls.update()
    this.gridArgs = { s, c, y: b.min.y - 0.4 }
    this.makeGrid()
    const r = Math.max(s.x, s.y, s.z) * 0.75 + 2
    this.key.target.position.copy(c)
    this.key.position.set(c.x + r * 0.5, c.y + r * 1.4, c.z + r * 0.9)
    Object.assign(this.key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: r * 5 })
    this.key.shadow.camera.updateProjectionMatrix()
    this.ground.position.y = b.min.y - 0.4
  }

  private makeGrid() {
    if (!this.gridArgs) return
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose() }
    const { s, c, y } = this.gridArgs
    const n = Math.ceil((Math.max(s.x, s.z) * 1.5) / 2) * 2 + 4
    this.grid = this.looks.blueprint ? new THREE.GridHelper(n, n, 0x3d6da3, 0x1c3d66) : new THREE.GridHelper(n, n, 0x3b4048, 0x22262b)
    this.grid.position.set(Math.round(c.x), y, 0)
    this.grid.visible = !!this.model?.children.length
    this.scene.add(this.grid)
  }

  private envMap() {
    if (this.env) return this.env
    const pm = new THREE.PMREMGenerator(this.renderer), s = new THREE.Scene()
    s.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0x2b2f35, side: THREE.BackSide })))
    const panel = (w: number, h: number, x: number, y: number, z: number, c: number) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }))
      p.position.set(x, y, z); p.lookAt(0, 0, 0); s.add(p)
    }
    panel(12, 4, 0, 9.5, 0, 0xffffff); panel(4, 7, 9.5, 2, 3, 0xfff1da); panel(4, 7, -9.5, 2, -3, 0xdbe6ff); panel(10, 2, 0, 1, -9.5, 0x8b9aad); panel(10, 2, 0, 1, 9.5, 0x5a6270)
    this.env = pm.fromScene(s, 0.04).texture
    pm.dispose()
    return this.env
  }

  private applyLooks() {
    const l = this.looks
    this.renderer.setClearColor(l.blueprint ? 0x0d2342 : 0x111316)
    const meshes: THREE.Mesh[] = []
    this.model?.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
    for (const o of meshes) {
      const u = o.userData as MeshData & { mat0?: THREE.Material; edges?: THREE.LineSegments }
      if (l.blueprint && !u.mat0) {
        u.mat0 = o.material as THREE.Material
        o.material = new THREE.MeshStandardMaterial({ color: 0x1a4d85, metalness: 0, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: u.mat0.side })
        u.edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), new THREE.LineBasicMaterial({ color: 0xcfe6ff }))
        o.add(u.edges)
      } else if (!l.blueprint && u.mat0) {
        ;(o.material as THREE.Material).dispose(); o.material = u.mat0; delete u.mat0
        if (u.edges) { o.remove(u.edges); u.edges.geometry.dispose(); (u.edges.material as THREE.Material).dispose(); delete u.edges }
      }
      const mt = o.material as THREE.MeshStandardMaterial
      if (l.blueprint) mt.opacity = l.xray && u.shell ? 0.06 : 0.35
      else if (u.shell) { mt.transparent = l.xray; mt.opacity = l.xray ? 0.14 : 1; mt.depthWrite = !l.xray }
    }
    const real = l.shading && !l.blueprint
    this.renderer.shadowMap.enabled = real
    this.renderer.toneMapping = real ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping
    this.renderer.toneMappingExposure = real ? 1.05 : 1
    this.scene.environment = real ? this.envMap() : null
    this.hemi.intensity = (real ? 0.5 : 1.35) * PI
    this.key.intensity = (real ? 1.7 : 1.3) * PI
    this.rim.intensity = (real ? 0.7 : 1.0) * PI
    this.key.castShadow = real
    this.ground.visible = real && !!this.model?.children.length
    for (const o of meshes) {
      o.castShadow = real; o.receiveShadow = real
      const mt = o.material as THREE.MeshStandardMaterial
      mt.envMapIntensity = 0.55
      mt.needsUpdate = true
    }
    this.buildLabels()
    this.highlight(this.picked)
  }

  private buildLabels() {
    this.labelLayer.innerHTML = ''
    this.labels = []
    if (!this.looks.labels || !this.model) return
    const groups = new Map<string, THREE.Mesh[]>()
    this.model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const p = (m.userData as MeshData).part
      if (!p || (!p.startsWith('att:') && !LABEL_PARTS.includes(p))) return
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      groups.set(p, [...(groups.get(p) ?? []), m])
    })
    for (const [part, meshes] of groups) {
      const el = document.createElement('div')
      el.className = 'lbl' + (part.startsWith('att:') ? ' att' : '')
      el.textContent = this.partLabel(part)
      el.addEventListener('click', () => this.onPick(part === this.picked ? null : part))
      this.labelLayer.appendChild(el)
      this.labels.push({ part, el, meshes })
    }
  }

  private tmp = new THREE.Vector3()
  private acc = new THREE.Vector3()
  private placeLabels() {
    if (!this.labels.length) return
    const w = this.host.clientWidth, h = this.host.clientHeight
    for (const L of this.labels) {
      this.acc.set(0, 0, 0)
      for (const m of L.meshes) { m.geometry.boundingBox!.getCenter(this.tmp); this.tmp.applyMatrix4(m.matrixWorld); this.acc.add(this.tmp) }
      this.acc.divideScalar(L.meshes.length).project(this.camera)
      if (this.acc.z > 1 || this.acc.z < -1) { L.el.style.display = 'none'; continue }
      L.el.style.display = ''
      L.el.style.transform = `translate(${((this.acc.x + 1) / 2) * w}px, ${((1 - this.acc.y) / 2) * h}px) translate(-50%, -50%)`
    }
  }

  private frame() {
    const target = this.looks.exploded ? 1 : 0
    if (Math.abs(this.explodeNow - target) > 0.001) {
      this.explodeNow += (target - this.explodeNow) * 0.14
      if (Math.abs(this.explodeNow - target) < 0.002) this.explodeNow = target
      this.setExplode(this.explodeNow)
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.placeLabels()
  }

  // ---------- picking ----------
  private ray = new THREE.Raycaster()
  private ptr = new THREE.Vector2()
  private onDown = (e: PointerEvent) => { this.down = [e.clientX, e.clientY] }
  private onUp = (e: PointerEvent) => {
    if (!this.model || !this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 6) return
    const r = this.renderer.domElement.getBoundingClientRect()
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.ptr, this.camera)
    const hits = this.ray.intersectObject(this.model, true).filter((x) => (x.object as THREE.Mesh).isMesh)
    const see = this.looks.xray || this.looks.blueprint
    const hit = see ? hits.find((x) => !(x.object.userData as MeshData).shell) ?? hits[0] : hits[0]
    this.onPick(hit ? (hit.object.userData as MeshData).part : null)
  }

  // ---------- experimental: photo on the model ----------
  private async applySkin(input: SceneInput) {
    const tok = ++this.skinToken
    const s = input.skin
    if (!s || !this.model || !this.model.children.length) { this.onSkinNote('', false, false); return }
    if (this.looks.blueprint) { this.onSkinNote('Photo is paused while Blueprint is on.', false, false); return }
    let groups = s.groups.filter((g) => g.urls.length)
    if (s.isPistol) {
      groups = groups.map((g) => ({ ...g, urls: g.urls.filter((u) => /side/i.test(decodeURIComponent(u.split('/').pop() ?? ''))) })).filter((g) => g.urls.length)
      if (!groups.length) { this.onSkinNote('This handgun\'s photo is taken at an angle, so it can\'t be laid on the model. Add a straight side-on photo with "side" in the file name.', false, false); return }
    }
    if (!groups.length) { this.onSkinNote('No photo for this view yet. Add one in the Photos tab.', false, false); return }
    this.onSkinNote('', true, groups.some((g) => g.urls.length > 1))
    for (const g of groups) {
      let skin: SkinTex
      try { skin = await loadSkin(g.urls[s.index % g.urls.length]) } catch { continue }
      if (tok !== this.skinToken || !this.model) return
      const meshes: THREE.Mesh[] = []
      this.model.traverse((o) => {
        const m = o as THREE.Mesh
        const u = m.userData as MeshData
        if (m.isMesh && !u.att && !INSIDE_PARTS.includes(u.part) && (g.half === 'full' || g.half === 'part' || u.half === g.half)) meshes.push(m)
      })
      const auto = g.half === 'lower' || s.isPistol ? false : !skin.thinRight
      this.project(meshes, skin.tex, auto !== !!s.flip[g.half])
    }
  }

  private project(meshes: THREE.Mesh[], tex: THREE.Texture, flip: boolean) {
    if (!meshes.length) return
    const box = new THREE.Box3(), v = new THREE.Vector3()
    const mats = meshes.map((o) => new THREE.Matrix4().compose((o.userData as MeshData).base ?? o.position, o.quaternion, o.scale))
    meshes.forEach((o, i) => { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox!.clone().applyMatrix4(mats[i])) })
    const min = box.min, size = box.getSize(new THREE.Vector3())
    meshes.forEach((o, i) => {
      const pos = o.geometry.attributes.position, uv = new Float32Array(pos.count * 2)
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(mats[i])
        let u = (v.x - min.x) / size.x
        if (flip) u = 1 - u
        uv[k * 2] = u; uv[k * 2 + 1] = (v.y - min.y) / size.y
      }
      o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      const mt = o.material as THREE.MeshStandardMaterial
      mt.map = tex
      mt.color.setHex(this.looks.shading ? 0xb4b4b4 : 0x8a8a8a)
      mt.metalness = Math.min(mt.metalness, 0.25)
      mt.roughness = Math.max(mt.roughness, 0.55)
      mt.needsUpdate = true
    })
  }
}
