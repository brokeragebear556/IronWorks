/* The 3D bench for full builds: renderer, smooth orbit camera, the five looks, exploded view
   with adjustable spread, leader-line labels, dimension lines, picking and highlighting,
   dragging parts by hand, and the Operate player. Framework-free; BuildViewer wraps it for React. */
import * as T from 'three'
import type { View } from '../../types'
import { buildGun, disposeGroup, type Built } from './assemble'
import type { Cat, EngGun, Mode } from './data'
import { cylX, type EMesh } from './geometry'
import { Materials, studioEnv, type Finishes } from './materials'
import { actionLabel, actionsFor, availWhy, freshState, mkPlan, staticPose, type Ev, type OpState, type Plan, type Pose } from './operate'
import { computeSpecs, fmtLen, type Specs, type Units } from './specs'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface StageOpts {
  mode: Mode; view: View; exploded: boolean; labels: boolean; attachments: boolean; spin: boolean
  /** exploded-view spread, 0.3 to 1.8 */ spread: number
  dims: boolean; move: boolean; operate: boolean; units: Units
}
export const DEFAULT_OPTS: StageOpts = { mode: 'real', view: 'full', exploded: false, labels: false, attachments: true, spin: false, spread: 1, dims: false, move: false, operate: false, units: 'in' }
export type CamPreset = 'iso' | 'right' | 'left' | 'top' | 'front'
const BG: Record<Mode, number> = { clay: 0x1d2024, real: 0x111316, cut: 0x111316, xray: 0x070d16, blue: 0x0d2342 }

/** What the Operate panel shows. */
export interface OpView {
  actions: { key: string; label: string; why: string | null; active: boolean }[]
  plan: { dur: number; ev: Ev[] } | null
  t: number; playing: boolean; dir: number; speed: number; loop: boolean
  phase: string; mag: string; chamber: boolean; safety: string
}
export type OpCmd =
  | { type: 'act'; act: string } | { type: 'toggle' } | { type: 'rev' } | { type: 'step'; dir: 1 | -1 } | { type: 'seek'; t: number }
  | { type: 'speed'; v: number } | { type: 'loop' } | { type: 'reset' }

interface Dyn {
  chamber: T.Group; feed: T.Group; spent: T.Group; live: T.Group; mag: T.Group[]; tube: T.Group[]
  follower: T.Mesh; mspring: T.Mesh; springKey: string
  bullet: T.Mesh; blen: number; flash: T.Mesh; gas: T.Mesh
  beam?: T.Mesh; beamBase?: [number, number, number]; laser?: T.Mesh; laserBase?: [number, number, number]
}

export class Stage {
  onPick: ((key: string | null) => void) | null = null
  onSpecs: ((s: Specs | null, built: Built | null) => void) | null = null
  onOp: ((v: OpView) => void) | null = null
  onMoved: ((n: number) => void) | null = null
  private R: T.WebGLRenderer
  private scene = new T.Scene()
  private cam = new T.PerspectiveCamera(28, 1, 0.3, 3000)
  private root = new T.Group()
  private dynGrp = new T.Group()
  private grid = new T.Group()
  private shadowPlane: T.Mesh<T.PlaneGeometry, T.ShadowMaterial>
  private hemi: T.HemisphereLight
  private dirL: T.DirectionalLight
  private env: T.Texture
  private mats = new Materials()
  private dmat = {
    brass: new T.MeshStandardMaterial({ color: '#c9a046', metalness: 0.9, roughness: 0.3, emissive: 0x2a1a00 }),
    copper: new T.MeshStandardMaterial({ color: '#b8733d', metalness: 0.85, roughness: 0.3, emissive: 0x220c00 }),
    hull: new T.MeshStandardMaterial({ color: '#b3261e', roughness: 0.6 }),
    flash: new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }),
    gas: new T.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }),
    beam: new T.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.14, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    laser: new T.MeshBasicMaterial({ color: 0x37ff6b, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false }),
    follower: new T.MeshStandardMaterial({ color: '#c4672b', roughness: 0.65 }),
    mspring: new T.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.8, roughness: 0.35 }),
  }
  private dyn: Dyn | null = null
  private hiCache = new Map<T.Material, T.Material>()
  private ray = new T.Raycaster()
  private built: Built | null = null
  private specs: Specs | null = null
  private opts: StageOpts = { ...DEFAULT_OPTS }
  private picked: string | null = null
  private orbit = { tgt: new T.Vector3(), r: 60, th: 0.55, ph: 1.2, gTgt: new T.Vector3(), gr: 60, gth: 0.55, gph: 1.2 }
  private need = 2
  private exT = 0
  private lastT = 0
  private raf = 0
  private ro: ResizeObserver
  private svg: SVGSVGElement
  private tags: HTMLDivElement
  private fitFor: string | null = null
  private dead = false
  private cleanup: (() => void)[] = []
  private host: HTMLElement
  private drag = new Map<string, T.Vector3>()
  private dragging: { key: string; plane: T.Plane; start: T.Vector3; off: T.Vector3 } | null = null
  // operate
  private ops: { gid: string | null; st: OpState | null; plan: Plan | null; t: number; playing: boolean; dir: number; speed: number; loop: boolean; lastEmit: number } =
    { gid: null, st: null, plan: null, t: 0, playing: false, dir: 1, speed: 0.01, loop: false, lastEmit: 0 }
  private pose: Pose | null = null

  constructor(host: HTMLElement, overlay: HTMLElement) {
    this.host = host
    const R = (this.R = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }))
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    R.toneMapping = T.ACESFilmicToneMapping
    R.toneMappingExposure = 1.05
    R.shadowMap.enabled = true
    R.shadowMap.type = T.PCFSoftShadowMap
    R.localClippingEnabled = true
    host.appendChild(R.domElement)
    // three r155+ lights are physically based: multiply the old intensities by π
    this.hemi = new T.HemisphereLight(0xffffff, 0x8a8780, 0.85 * Math.PI)
    this.scene.add(this.hemi)
    const d = (this.dirL = new T.DirectionalLight(0xffffff, 1.15 * Math.PI))
    d.position.set(14, 40, 26)
    d.castShadow = true
    d.shadow.mapSize.set(2048, 2048)
    Object.assign(d.shadow.camera, { left: -40, right: 40, top: 30, bottom: -30, near: 1, far: 120 })
    d.shadow.bias = -0.0004
    this.scene.add(d, d.target)
    const rim = new T.DirectionalLight(0xdfe8ff, 0.45 * Math.PI)
    rim.position.set(-20, 12, -30)
    this.scene.add(rim)
    this.env = studioEnv(R)
    this.mats.env = this.env
    this.scene.add(this.root)
    this.root.add(this.dynGrp)
    this.shadowPlane = new T.Mesh(new T.PlaneGeometry(400, 400), new T.ShadowMaterial({ opacity: 0.18 }))
    this.shadowPlane.rotation.x = -Math.PI / 2
    this.shadowPlane.receiveShadow = true
    this.scene.add(this.shadowPlane, this.grid)

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'eng-lines')
    this.tags = document.createElement('div')
    overlay.append(this.svg, this.tags)

    this.bindOrbit()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose() {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.cleanup.forEach((f) => f())
    this.clearModel()
    this.clearGrid()
    this.mats.dispose()
    Object.values(this.dmat).forEach((m) => m.dispose())
    this.hiCache.forEach((m) => m.dispose())
    this.env.dispose()
    this.shadowPlane.geometry.dispose()
    this.shadowPlane.material.dispose()
    this.R.dispose()
    this.R.domElement.remove()
    this.svg.remove()
    this.tags.remove()
  }

  // ---------- public ----------
  setGun(g: EngGun | null, cat: Cat, keepCamera: boolean) {
    this.clearModel()
    if (!g) { this.need = 2; this.specs = null; this.onSpecs?.(null, null); return }
    if (this.fitFor !== g.id) { this.drag.clear(); this.onMoved?.(0) }
    this.built = buildGun(g, cat, true)
    this.root.add(this.built.group)
    this.buildDyn()
    this.specs = computeSpecs(this.built, cat, true)
    this.onSpecs?.(this.specs, this.built)
    this.opOnRebuild()
    this.applyMode()
    if (!keepCamera || this.fitFor !== g.id) { this.fit(true); this.fitFor = g.id }
    this.place()
    this.need = 2
  }

  setOpts(o: Partial<StageOpts>) {
    const prev = this.opts
    this.opts = { ...prev, ...o }
    const n = this.opts
    if (n.mode !== prev.mode || n.view !== prev.view || n.attachments !== prev.attachments) this.applyMode()
    if (n.view !== prev.view || n.attachments !== prev.attachments || n.exploded !== prev.exploded || (n.exploded && n.spread !== prev.spread)) this.fit(false)
    if (n.operate !== prev.operate) {
      if (n.operate && this.built) this.pose = this.ops.plan ? this.ops.plan.pose(this.ops.t) : staticPose(this.ops.st!, this.built.info, this.built.gun)
      this.place()
      this.emitOp(true)
    }
    if (n.move !== prev.move && !n.move) this.dragging = null
    this.need = 2
  }

  highlight(key: string | null) {
    this.picked = key
    this.applyMode()
  }

  resetView() {
    this.orbit.gth = 0.55
    this.orbit.gph = 1.2
    this.fit(false)
  }

  camPreset(p: CamPreset) {
    const P: Record<CamPreset, [number, number]> = { iso: [0.55, 1.2], right: [0, 1.5], left: [Math.PI, 1.5], top: [0, 0.02], front: [Math.PI / 2, 1.45] }
    const [th, ph] = P[p]
    // turn the short way round
    const o = this.orbit, twoPi = Math.PI * 2
    o.gth = th + Math.round((o.gth - th) / twoPi) * twoPi
    o.gph = ph
    this.fit(false)
  }

  resetMoved() {
    this.drag.clear()
    this.onMoved?.(0)
    this.place()
    this.need = 2
  }

  /** Model keys of the parts drawn for this gun, so lists can mark what's on the model. */
  presentParts(): Set<string> {
    return new Set(this.built?.meshes.map((m) => m.userData.key) ?? [])
  }

  /** PNG of the current view. */
  snapshot(): string {
    this.render()
    return this.R.domElement.toDataURL('image/png')
  }

  // ---------- operate ----------
  op(cmd: OpCmd) {
    if (!this.built) return
    const O = this.ops, I = this.built.info, g = this.built.gun
    switch (cmd.type) {
      case 'act': {
        // an action that has started counts as done (a shot fired mid-cycle still uses its round)
        if (O.plan) O.st = O.t > 0 ? O.plan.end() : O.plan.S0
        if (availWhy(cmd.act, O.st!, I)) {
          O.plan = null; O.t = 0; O.playing = false
          this.pose = staticPose(O.st!, I, g)
          this.place(); this.need = 2; this.emitOp(true)
          return
        }
        O.plan = mkPlan(cmd.act, JSON.parse(JSON.stringify(O.st)), I, g)
        O.t = 0; O.dir = 1; O.playing = true; O.speed = O.plan.speed
        break
      }
      case 'toggle':
        if (!O.plan) return
        if (O.playing) O.playing = false
        else { if (O.dir > 0 && O.t >= O.plan.dur) O.t = 0; O.dir = 1; O.playing = true }
        break
      case 'rev':
        if (!O.plan) return
        if (O.t <= 0) O.t = O.plan.dur
        O.dir = -1; O.playing = true
        break
      case 'step':
        if (!O.plan) return
        O.playing = false
        O.t = clamp(O.t + cmd.dir * O.plan.dur / 200, 0, O.plan.dur)
        break
      case 'seek':
        if (!O.plan) return
        O.playing = false
        O.t = clamp(cmd.t, 0, O.plan.dur)
        break
      case 'speed': O.speed = cmd.v; break
      case 'loop':
        O.loop = !O.loop
        // turning loop on for an action that has finished plays it again
        if (O.loop && O.plan && !O.playing) { if (O.dir > 0 && O.t >= O.plan.dur) O.t = 0; O.playing = true }
        break
      case 'reset':
        O.st = freshState(g); O.plan = null; O.t = 0; O.playing = false
        break
    }
    this.pose = O.plan ? O.plan.pose(O.t) : staticPose(O.st!, I, g)
    this.place()
    this.need = 2
    this.emitOp(true)
  }

  private opOnRebuild() {
    if (!this.built) return
    const g = this.built.gun, O = this.ops
    if (O.gid !== g.id || !O.st) { O.gid = g.id; O.st = freshState(g); O.plan = null; O.t = 0; O.playing = false }
    if (O.plan) {
      O.plan = mkPlan(O.plan.act, O.plan.S0, this.built.info, g)
      O.t = Math.min(O.t, O.plan.dur)
    }
    this.pose = O.plan ? O.plan.pose(O.t) : staticPose(O.st, this.built.info, g)
    this.emitOp(true)
  }

  private emitOp(force = false) {
    if (!this.onOp || !this.built) return
    const now = performance.now()
    if (!force && now - this.ops.lastEmit < 50) return
    this.ops.lastEmit = now
    const O = this.ops, I = this.built.info, g = this.built.gun, p = O.plan
    const atEnd = p ? O.t >= p.dur - 1e-6 : true
    const S = p ? (atEnd ? p.end() : p.S0) : O.st!
    const P = this.pose, d = P?.dyn ?? {}
    const o = I.op as Record<string, unknown>
    const mag = o.type === 'sg' ? `Tube ${d.tubeN ?? S.tube}/${o.shellCap ?? 7}` : `Mag ${S.magIn || d.magN ? d.magN ?? S.mag : '—'}/${g.cfg.magCap || 30}`
    this.onOp({
      actions: actionsFor(I, g).map(([k, n]) => ({ key: k, label: actionLabel(k, n, S, I), why: availWhy(k, S, I), active: p?.act === k })),
      plan: p ? { dur: p.dur, ev: p.ev } : null,
      t: O.t, playing: O.playing, dir: O.dir, speed: O.speed, loop: O.loop,
      phase: P?.phase || (p ? '' : 'Ready'), mag, chamber: !!d.chamber, safety: S.safety,
    })
  }

  private tickOp(dt: number): boolean {
    const O = this.ops
    if (!this.opts.operate || !O.plan || !O.playing || !this.built) return false
    O.t += dt * 1000 * O.speed * O.dir
    const dur = O.plan.dur
    // wrap around when looping; only check the end we're moving towards (checking both made a
    // forward loop wrap to 0 and then immediately stop)
    if (O.dir > 0 && O.t >= dur) {
      if (O.loop) {
        // each pass carries on from where the last one ended: the next shot uses the next round
        const I = this.built.info, g = this.built.gun, act = O.plan.act
        O.st = O.plan.end()
        const empty = act === 'fire' && !O.st.chambered // the last round has gone: stop instead of dry-firing forever
        if (empty || availWhy(act, O.st, I)) {
          O.plan = null; O.t = 0; O.playing = false
          this.pose = staticPose(O.st, I, g)
          this.emitOp(true)
          return true
        }
        O.plan = mkPlan(act, JSON.parse(JSON.stringify(O.st)), I, g)
        O.t = O.t % dur
      } else { O.t = dur; O.playing = false }
    } else if (O.dir < 0 && O.t <= 0) {
      if (O.loop) O.t = dur + (O.t % dur)
      else { O.t = 0; O.playing = false }
    }
    this.pose = O.plan.pose(O.t)
    this.emitOp(!O.playing)
    return true
  }

  // ---------- model ----------
  private clearModel() {
    if (!this.built) return
    this.root.remove(this.built.group)
    this.built.meshes.forEach((m) => { if (m.userData.edges) m.userData.edges.geometry.dispose() })
    disposeGroup(this.built.group)
    this.built = null
    disposeGroup(this.dynGrp)
    this.dynGrp.clear()
    this.dyn = null
  }

  /** Cartridges, muzzle flash, gas puff, light beam and laser for the Operate player. */
  private buildDyn() {
    if (!this.built) return
    const I = this.built.info, c = I.op.cart, D = this.dmat
    const lathe = (pts: number[][]) => { const g = new T.LatheGeometry(pts.map((p) => new T.Vector2(p[0], p[1])), 24); g.rotateZ(-Math.PI / 2); return g }
    const hr = c.hd / 2, br = c.bd / 2
    let caseP: number[][]
    if (c.shell) caseP = [[0, 0], [hr, 0], [hr, 0.35], [hr * 0.94, 0.36], [hr * 0.94, c.cl], [0, c.cl]]
    else if (c.cl / c.hd > 3.2) caseP = [[0, 0], [hr * 0.98, 0], [hr, 0.03], [hr, 0.05], [hr * 0.82, 0.07], [hr * 0.82, 0.11], [hr * 0.98, 0.13], [hr * 0.95, c.cl * 0.78], [br + 0.03, c.cl * 0.86], [br + 0.025, c.cl], [0, c.cl]]
    else caseP = [[0, 0], [hr * 0.98, 0], [hr, 0.03], [hr, 0.05], [hr * 0.86, 0.07], [hr * 0.86, 0.1], [hr * 0.97, 0.12], [br + 0.02, c.cl], [0, c.cl]]
    const bl = c.shell ? 0.6 : Math.max(0.3, c.oal - c.cl + 0.18)
    const bulP = c.shell ? [[0, 0], [br * 0.9, 0], [br * 0.9, bl], [0, bl]] : [[0, 0], [br, 0], [br, bl * 0.45], [br * 0.82, bl * 0.72], [br * 0.45, bl * 0.92], [0, bl]]
    const cs = lathe(caseP), bu = lathe(bulP)
    const mk = (live: boolean) => {
      const grp = new T.Group()
      grp.add(new T.Mesh(cs, c.shell ? D.hull : D.brass))
      if (live && !c.shell) { const b = new T.Mesh(bu, D.copper); b.position.x = c.cl - 0.18; grp.add(b) }
      this.dynGrp.add(grp)
      return grp
    }
    // one cartridge for every round the magazine holds, so Operate shows the real count
    const cap = c.shell ? 0 : Math.min(150, Math.max(1, Number(this.built.gun.cfg.magCap) || 30))
    const o = I.op as unknown as Record<string, number>
    const fw = Math.max(0.3, (o.magW || 0.85) - 0.2)
    const follower = new T.Mesh(new T.BoxGeometry(Math.max(0.6, c.oal * 0.92), 0.14, fw), D.follower)
    const mspring = new T.Mesh(new T.BufferGeometry(), D.mspring)
    this.dynGrp.add(follower, mspring)
    const dyn: Dyn = {
      chamber: mk(true), feed: mk(true), spent: mk(false), live: mk(true), mag: Array.from({ length: cap }, () => mk(true)), tube: c.shell ? [0, 1, 2].map(() => mk(true)) : [],
      follower, mspring, springKey: '',
      bullet: new T.Mesh(bu, D.copper), blen: bl, flash: new T.Mesh(new T.SphereGeometry(1, 20, 12), D.flash), gas: new T.Mesh(new T.SphereGeometry(0.35, 14, 10), D.gas),
    }
    this.dynGrp.add(dyn.bullet, dyn.flash, dyn.gas)
    const g = this.built.gun
    const lt = g.atts.find((a) => a.k === 'light' || a.k === 'plight')
    if (lt?._lens) {
      const bg = new T.ConeGeometry(9, 70, 32, 1, true)
      bg.rotateZ(Math.PI / 2); bg.translate(35, 0, 0)
      dyn.beam = new T.Mesh(bg, D.beam); dyn.beamBase = lt._lens
      this.dynGrp.add(dyn.beam)
    }
    const lz = g.atts.find((a) => a.k === 'laser')
    if (lz?._lens) { dyn.laser = new T.Mesh(cylX(0.04, 0.04, 150, 8), D.laser); dyn.laserBase = lz._lens; this.dynGrp.add(dyn.laser) }
    this.dynGrp.children.forEach((m) => (m.visible = false))
    this.dyn = dyn
  }

  private finishes(): Finishes {
    const c = this.built?.gun.cfg ?? {}
    return { finish: (c.finish as string) || 'black', furn: (c.furn as string) || 'black', hgFin: (c.hgFin as string) || null, barrelFin: (c.barrelFin as string) || null, look: this.built?.gun.look }
  }

  private visible(m: EMesh) {
    const u = m.userData, isAtt = u.grp === 'att', v = this.opts.view
    if (isAtt && !this.opts.attachments) return false
    if (v === 'full') return true
    if (v === 'lower') return u.grp === 'lower'
    return u.grp === 'upper' || isAtt
  }

  private applyMode() {
    if (!this.built) return
    const mode = this.opts.mode, f = this.finishes(), real = mode === 'real' || mode === 'cut'
    for (const m of this.built.meshes) {
      const u = m.userData, isAtt = u.grp === 'att'
      let mat = this.mats.get(u.mat, mode, u.internal, isAtt, f)
      const sel = !!this.picked && u.key === this.picked
      if (sel) mat = this.highlighted(mat, mode)
      m.material = mat
      m.visible = this.visible(m)
      const wantEdges = (mode === 'blue' || mode === 'xray') && !u.inst
      if (wantEdges && !u.edges) {
        u.edges = new T.LineSegments(new T.EdgesGeometry(m.geometry, 28), this.mats.lines.blue)
        m.add(u.edges)
      }
      if (u.edges) {
        u.edges.visible = wantEdges
        u.edges.material = mode === 'xray' ? this.mats.lines.xray : this.mats.lines.blue
      }
      m.castShadow = (mode === 'real' || mode === 'clay' || mode === 'cut') && !u.internal
    }
    this.hemi.intensity = (real ? 0.25 : 0.85) * Math.PI
    this.dirL.intensity = (real ? 1.7 : 1.1) * Math.PI
    this.scene.environment = real ? this.env : null
    this.R.setClearColor(BG[mode])
    this.makeGrid(this.built.info.floor ?? -8, mode)
    this.host.classList.toggle('bp', mode === 'blue')
    this.need = 2
  }

  private highlighted(base: T.Material, mode: Mode): T.Material {
    let h = this.hiCache.get(base)
    if (h) return h
    h = base.clone()
    const s = h as T.MeshStandardMaterial
    if (s.emissive && mode !== 'xray') {
      s.emissive = new T.Color(mode === 'real' || mode === 'cut' ? 0x7a2a08 : 0xff5a1f)
      s.emissiveIntensity = mode === 'real' || mode === 'cut' ? 1 : 0.45
    } else {
      const b = h as T.MeshBasicMaterial
      b.color = new T.Color(0xffb347)
      b.opacity = 0.6
    }
    this.hiCache.set(base, h)
    return h
  }

  private clearGrid() {
    this.grid.children.forEach((g) => { const l = g as T.GridHelper; l.geometry.dispose(); (l.material as T.Material).dispose() })
    this.grid.clear()
  }

  private makeGrid(y: number, mode: Mode) {
    this.clearGrid()
    const col: [number, number, number] = mode === 'blue' ? [0xffffff, 0.16, 0.07] : mode === 'xray' ? [0x5fb4ff, 0.22, 0.08] : mode === 'real' || mode === 'cut' ? [0x9aa3ab, 0.22, 0.08] : [0x8d8b86, 0.3, 0.12]
    const mk = (size: number, div: number, op: number) => {
      const g = new T.GridHelper(size, div, col[0], col[0])
      const m = g.material as T.Material
      m.transparent = true
      m.opacity = op
      m.depthWrite = false
      g.position.y = y
      return g
    }
    this.grid.add(mk(160, 40, col[1]), mk(160, 160, col[2]))
    this.shadowPlane.position.y = y - 0.01
    this.shadowPlane.material.opacity = mode === 'real' || mode === 'cut' ? 0.38 : mode === 'clay' ? 0.2 : 0
  }

  // ---------- camera ----------
  private fit(snapNow: boolean) {
    if (!this.built) return
    const goal = this.opts.exploded ? this.opts.spread : 0, bb = new T.Box3()
    for (const m of this.built.meshes) {
      if (!m.visible) continue
      const cur = m.position.clone()
      m.position.copy(m.userData.base).addScaledVector(m.userData.ex, goal)
      m.updateMatrixWorld(true)
      bb.expandByObject(m)
      m.position.copy(cur)
      m.updateMatrixWorld(true)
    }
    if (bb.isEmpty()) return
    const c = bb.getCenter(new T.Vector3()), s = bb.getSize(new T.Vector3())
    const fov = (this.cam.fov * Math.PI) / 180, asp = Math.max(0.5, this.cam.aspect)
    const dist = Math.max(s.x / asp, s.y * 1.5) / (2 * Math.tan(fov / 2)) + s.z * 0.8 + 4
    this.orbit.gTgt.copy(c)
    this.orbit.gr = clamp(dist, 6, 600)
    if (snapNow) { this.orbit.tgt.copy(this.orbit.gTgt); this.orbit.r = this.orbit.gr; this.orbit.th = this.orbit.gth; this.orbit.ph = this.orbit.gph }
    this.need = 2
  }

  private focusOn(objs: T.Object3D[]) {
    const bb = new T.Box3()
    objs.forEach((m) => bb.expandByObject(m))
    if (bb.isEmpty()) return
    const c = bb.getCenter(new T.Vector3()), s = bb.getSize(new T.Vector3())
    this.orbit.gTgt.copy(c)
    this.orbit.gr = clamp(Math.max(s.x, s.y, s.z) * 3.2 + 4, 5, 300)
    this.need = 2
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (!w || !h) return
    this.R.setSize(w, h, false)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    this.need = 2
  }

  private bindOrbit() {
    const el = this.R.domElement, pts = new Map<number, { x: number; y: number }>(), o = this.orbit
    let lastD = 0, moved = 0, down: { x: number; y: number } | null = null, panMode = false, lastTap = 0
    const pan = (dx: number, dy: number) => {
      const k = o.r * 0.0016
      const right = new T.Vector3().setFromMatrixColumn(this.cam.matrix, 0), upv = new T.Vector3().setFromMatrixColumn(this.cam.matrix, 1)
      o.gTgt.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k)
    }
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, opt)
      this.cleanup.push(() => el.removeEventListener(t, f as EventListener))
    }
    on('contextmenu', (e) => e.preventDefault())
    on('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = 0
      down = { x: e.clientX, y: e.clientY }
      panMode = e.button === 2 || e.shiftKey || e.ctrlKey
      if (pts.size === 2) { const [a, b] = [...pts.values()]; lastD = Math.hypot(a.x - b.x, a.y - b.y); this.dragging = null }
      if (this.opts.spin) this.opts.spin = false
      if (this.opts.move && pts.size === 1 && !panMode) {
        const h = this.hitAt(e)
        if (h) {
          const key = (h.object as EMesh).userData.key
          const n = this.cam.getWorldDirection(new T.Vector3()).negate()
          this.dragging = { key, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, h.point), start: h.point.clone(), off: (this.drag.get(key) ?? new T.Vector3()).clone() }
        }
      }
    })
    on('pointermove', (e) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      if (this.dragging) {
        this.setRay(e)
        const q = new T.Vector3()
        if (this.ray.ray.intersectPlane(this.dragging.plane, q)) {
          this.drag.set(this.dragging.key, this.dragging.off.clone().add(q.sub(this.dragging.start)))
          this.place()
          this.need = 2
        }
        return
      }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], dd = Math.hypot(a.x - b.x, a.y - b.y)
        if (lastD) o.gr = clamp((o.gr * lastD) / dd, 4, 800)
        lastD = dd
        pan(dx / 2, dy / 2)
      } else if (panMode) pan(dx, dy)
      else { o.gth -= dx * 0.008; o.gph = clamp(o.gph - dy * 0.006, 0.02, Math.PI - 0.02) }
      this.need = 2
    })
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size < 2) lastD = 0
      const wasDrag = !!this.dragging && moved > 4
      if (this.dragging && wasDrag) this.onMoved?.(this.drag.size)
      this.dragging = null
      if (down && moved < 6 && e.type === 'pointerup' && !wasDrag) {
        const now = performance.now()
        if (now - lastTap < 320) this.dbl(e)
        else this.pick(e)
        lastTap = now
      }
      down = null
    }
    on('pointerup', up)
    on('pointercancel', up)
    on('wheel', (e) => { e.preventDefault(); o.gr = clamp(o.gr * Math.exp(e.deltaY * 0.0012), 4, 800); this.need = 2 }, { passive: false })
  }

  private setRay(e: PointerEvent) {
    const r = this.R.domElement.getBoundingClientRect()
    this.ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.cam)
  }

  private hitAt(e: PointerEvent): T.Intersection | null {
    if (!this.built) return null
    this.setRay(e)
    const seeInside = this.opts.mode === 'xray' || this.opts.mode === 'cut' || this.opts.exploded || this.opts.move
    return this.ray.intersectObjects(this.built.meshes.filter((m) => m.visible && !(m.userData.internal && !seeInside)), false)[0] ?? null
  }

  private pick(e: PointerEvent) {
    const h = this.hitAt(e)
    const key = h ? (h.object as EMesh).userData.key : null
    this.onPick?.(key && key === this.picked ? null : key)
  }

  private dbl(e: PointerEvent) {
    const h = this.hitAt(e)
    if (!h || !this.built) { this.fit(false); return }
    const key = (h.object as EMesh).userData.key
    if (this.opts.move && this.drag.has(key)) { this.drag.delete(key); this.onMoved?.(this.drag.size); this.place(); this.need = 2; return }
    this.focusOn(this.built.meshes.filter((m) => m.userData.key === key && m.visible))
  }

  // ---------- placement: rest + operate pose + explode + dragged ----------
  private place() {
    if (!this.built) return
    const P = this.opts.operate ? this.pose : null
    const v = new T.Vector3(), q1 = new T.Quaternion(), ax: Record<string, T.Vector3> = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) }
    const rotAbout = (p: T.Vector3, q: T.Quaternion, axis: string, ang: number, piv: number[]) => {
      q1.setFromAxisAngle(ax[axis], ang)
      p.sub(v.set(piv[0], piv[1], piv[2])).applyQuaternion(q1).add(v)
      q.premultiply(q1)
    }
    for (const m of this.built.meshes) {
      const u = m.userData, p = u.base.clone(), q = u.q0.clone()
      let sx = 1
      const A = P && (P.k[u.ak ?? ''] || (u.attK === 'supp' ? P.k.supp : undefined))
      if (A) {
        if (A.hide) p.y -= 1e4
        if (A.sx) { p.x = A.sx[1] + (p.x - A.sx[1]) * A.sx[0]; sx = A.sx[0] }
        if (A.rot) rotAbout(p, q, A.rot[0], A.rot[1], A.rot[2])
        if (A.d) p.add(v.set(A.d[0] || 0, A.d[1] || 0, A.d[2] || 0))
      }
      if (P?.up && (u.grp === 'upper' || (u.grp === 'att' && !u.noTake))) rotAbout(p, q, 'z', P.up[0], P.up[1])
      if (P?.slideOff && (u.ak === 'slide' || u.ak === 'barrel' || u.ak === 'striker' || u.key === 'spring' || u.attK === 'supp')) p.x += P.slideOff
      p.addScaledVector(u.ex, this.exT)
      const dg = this.drag.get(u.key)
      if (dg) p.add(dg)
      m.position.copy(p)
      m.quaternion.copy(q)
      m.scale.x = sx
    }
    this.placeDyn(P, rotAbout)
  }

  private placeDyn(P: Pose | null, rotAbout: (p: T.Vector3, q: T.Quaternion, axis: string, ang: number, piv: number[]) => void) {
    const D = this.dyn
    if (!D || !this.built) return
    this.dynGrp.children.forEach((m) => (m.visible = false))
    if (!this.opts.operate || !P || this.opts.exploded) return
    const d = P.dyn, I = this.built.info, o = I.op as Record<string, any>, c = I.op.cart // eslint-disable-line @typescript-eslint/no-explicit-any
    const show = (obj: T.Object3D, x: number, y: number, z: number, rz = 0, rx = 0, ry = 0) => { obj.visible = true; obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz) }
    if (d.chamber) show(D.chamber, o.chamberX + (d.chamberDx || 0), 0, 0)
    if (d.feed) show(D.feed, d.feed[0], d.feed[1], d.feed[2] || 0, d.feed[3] || 0)
    if (d.spent) { const s = d.spent as number[]; show(d.spent[6] ? D.live : D.spent, s[0], s[1], s[2], s[3] || 0, s[4] || 0, s[5] || 0) }
    if (d.bullet != null) { D.bullet.visible = true; D.bullet.position.set(d.bullet - D.blen, d.bulletY || 0, 0); D.bullet.rotation.set(0, 0, d.bulletRz || 0) }
    if (d.flash) {
      D.flash.visible = true
      D.flash.position.set(d.flash[0] + d.flash[1] * 1.2, d.flash[3] || 0, 0)
      D.flash.scale.set(d.flash[1] * 2.2, d.flash[1] * 0.9, d.flash[1] * 0.9)
      this.dmat.flash.opacity = d.flash[2]
    }
    if (d.gas) { D.gas.visible = true; D.gas.position.set(d.gas[0], d.gas[1], 0); D.gas.scale.setScalar(d.gas[2]) }
    if (D.beam && d.beam && D.beamBase) { D.beam.visible = true; D.beam.position.set(...D.beamBase) }
    if (D.laser && d.laser && D.laserBase) { D.laser.visible = true; D.laser.position.set(...D.laserBase) }
    const magAnim = P.k.mag
    if (o.type !== 'sg' && !magAnim?.hide && D.mag.length && d.magN != null) this.placeMag(Math.min(D.mag.length, Math.max(0, d.magN)), d.magRise || 0, (pv, qv) => {
      if (magAnim) { if (magAnim.rot) rotAbout(pv, qv, magAnim.rot[0], magAnim.rot[1], magAnim.rot[2]); if (magAnim.d) pv.add(new T.Vector3(magAnim.d[0] || 0, magAnim.d[1] || 0, magAnim.d[2] || 0)) }
    })
    D.tube.forEach((r, i) => { if (i < Math.min(3, d.tubeN || 0)) show(r, o.tubeX0 + 0.05 + i * (c.cl + 0.02) + (d.tubeShift || 0), o.tubeY, 0) })
    if (P.up) this.dynGrp.children.forEach((m) => { if (m.visible && m !== D.flash && m !== D.follower && m !== D.mspring && !D.mag.includes(m as T.Group)) { const pv = m.position.clone(), qv = m.quaternion.clone(); rotAbout(pv, qv, 'z', P.up![0], P.up![1]); m.position.copy(pv); m.quaternion.copy(qv) } })
    if (P.slideOff && D.chamber.visible) D.chamber.position.x += P.slideOff
  }

  /**
   * The rounds left in the magazine, with its follower and spring. A stick magazine holds a staggered
   * double stack whose pitch is set by how many rounds fit its length, so a full 30 reaches the floor plate
   * and the spring is squeezed short; as rounds are fired the stack shrinks and the spring stretches.
   * A drum fills its feed tower first, then winds the rest round the drum.
   */
  private placeMag(n: number, rise: number, move: (p: T.Vector3, q: T.Quaternion) => void) {
    const D = this.dyn!, I = this.built!.info, c = I.op.cart, o = I.op as unknown as Record<string, number> & { magAxis?: number[] }
    const cap = D.mag.length, hd = c.hd
    const curve = o.magCurve || 0, drum = o.magDrum || 0
    const stickLen = drum ? 2.3 : I.pistol ? (o.magLen || 4) - 0.75 : (o.magLen || 7.3) - 0.9
    const towerCap = drum ? Math.max(1, Math.floor(stickLen / (0.56 * hd))) : cap
    const pitch = Math.min(0.86 * hd, Math.max(0.42 * hd, stickLen / Math.min(cap, towerCap)))
    const zOff = Math.sqrt(Math.max(0, hd * hd - pitch * pitch)) / 2
    // a point s inches down the magazine's rear wall, and the angle a round there points at
    const along = (s: number): [number, number, number] => {
      if (I.pistol && o.magAxis) return [o.magRearX + o.magAxis[0] * s, o.magTopY + o.magAxis[1] * s, 0]
      if (curve) { const a = s / curve; return [o.magRearX + curve * (1 - Math.cos(a)), o.magTopY - curve * Math.sin(a), a] }
      return [o.magRearX, o.magTopY - s, 0]
    }
    const pv = new T.Vector3(), qv = new T.Quaternion(), e = new T.Euler()
    const put = (obj: T.Object3D, x: number, y: number, z: number, rz: number, ry = 0) => {
      pv.set(x, y, z); qv.setFromEuler(e.set(0, ry, rz)); move(pv, qv)
      obj.visible = true; obj.position.copy(pv); obj.quaternion.copy(qv)
    }
    // drum: rings of rounds lying along the drum's axis, filled from the outside in
    const yTop = o.magTopY + 0.12 + hd / 2, dr = o.magDr || 2.5
    const dcx = (o.magFront ?? o.magRearX + (o.magDepth || 2.4)) - (o.magDepth || 2.4) / 2, dcy = yTop - 3.0 - dr + 0.6
    const drumSlot = (j: number): [number, number, number] => {
      const per = drum === 2 ? 2 : 1, side = drum === 2 ? (j % 2 ? -1.25 : 1.25) : 0
      let k = Math.floor(j / per), rho = dr - 0.18 - hd / 2
      while (rho > hd) {
        const ring = Math.max(1, Math.floor((2 * Math.PI * rho) / (hd * 1.02)))
        if (k < ring) { const a = Math.PI / 2 - (k / ring) * Math.PI * 2; return [dcx + rho * Math.cos(a), dcy + rho * Math.sin(a), side] }
        k -= ring; rho -= hd * 0.95
      }
      return [dcx, dcy, side]
    }
    for (let i = 0; i < n; i++) {
      if (i < towerCap) {
        const s = (i - rise) * pitch, [x, y, a] = along(s)
        put(D.mag[i], x, y, (i % 2 ? -1 : 1) * zOff, a)
      } else {
        const [x, y, z] = drumSlot(i - towerCap)
        put(D.mag[i], x, y, z + c.oal / 2, 0, Math.PI / 2)
      }
    }
    if (drum && n > towerCap) return // the follower is down in the drum, wound by its clock spring
    // follower sits just under the lowest round; the spring runs from it to the floor plate
    const sF = n ? (n - 1 - rise) * pitch + hd / 2 + 0.07 : 0
    const floor = drum ? 2.6 : I.pistol ? (o.magLen || 4) - 0.45 : (o.magLen || 7.3) - 0.4 - hd / 2
    const sTop = Math.min(sF, floor - 0.25)
    const ctr = (s: number): [number, number, number] => { const [x, y, a] = along(s); return [x + Math.cos(a) * c.oal / 2, y + Math.sin(a) * c.oal / 2, a] }
    const [fx, fy, fa] = ctr(sTop)
    put(D.follower, fx, fy, 0, fa)
    const key = `${sTop.toFixed(2)}|${floor.toFixed(2)}`
    if (D.springKey !== key) {
      D.springKey = key
      const A = Math.min(c.oal * 0.4, Math.max(0.2, ((o.magDepth || 1.1) - 0.35) / 2)), B = Math.max(0.12, ((o.magW || 0.85) - 0.3) / 2)
      const turns = I.pistol ? 7 : drum ? 5 : 9, s0 = sTop + 0.08, s1 = floor
      const pts: T.Vector3[] = []
      const N = turns * 24
      for (let k = 0; k <= N; k++) {
        const t = k / N, th = t * turns * Math.PI * 2, [x, y, a] = ctr(s0 + (s1 - s0) * t)
        pts.push(new T.Vector3(x + Math.cos(a) * A * Math.sin(th), y + Math.sin(a) * A * Math.sin(th), B * Math.cos(th)))
      }
      D.mspring.geometry.dispose()
      D.mspring.geometry = new T.TubeGeometry(new T.CatmullRomCurve3(pts), N, 0.032, 5)
    }
    put(D.mspring, 0, 0, 0, 0)
  }

  private loop = (t: number) => {
    if (this.dead) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (t - this.lastT) / 1000)
    this.lastT = t
    const o = this.orbit
    if (this.opts.spin) { o.gth += dt * 0.45; this.need = 2 }
    const k = 1 - Math.pow(0.0008, dt)
    o.th += (o.gth - o.th) * k
    o.ph += (o.gph - o.ph) * k
    o.r += (o.gr - o.r) * k
    o.tgt.lerp(o.gTgt, k)
    if (Math.abs(o.gth - o.th) + Math.abs(o.gph - o.ph) + Math.abs(o.gr - o.r) + o.tgt.distanceTo(o.gTgt) > 0.001) this.need = Math.max(this.need, 1)
    let moved = false
    const exGoal = this.opts.exploded ? this.opts.spread : 0
    if (Math.abs(exGoal - this.exT) > 0.001) { this.exT += (exGoal - this.exT) * Math.min(1, dt * 7); moved = true }
    if (this.tickOp(dt)) moved = true
    if (moved) { this.place(); this.need = 2 }
    if (!this.need) return
    this.need--
    this.render()
    this.drawOverlay()
  }

  private render() {
    const o = this.orbit, sp = Math.sin(o.ph)
    this.cam.position.set(o.tgt.x + o.r * sp * Math.sin(o.th), o.tgt.y + o.r * Math.cos(o.ph), o.tgt.z + o.r * sp * Math.cos(o.th))
    this.cam.lookAt(o.tgt)
    this.cam.updateMatrixWorld()
    this.R.render(this.scene, this.cam)
  }

  private proj(v: T.Vector3) {
    const p = v.clone().project(this.cam)
    return { x: ((p.x + 1) / 2) * this.host.clientWidth, y: ((1 - p.y) / 2) * this.host.clientHeight, z: p.z }
  }

  /** Labels with leader lines, dimension lines with the balance point, and the Operate callout. */
  private drawOverlay() {
    let svg = '', html = ''
    const W = this.host.clientWidth, H = this.host.clientHeight
    const mode = this.opts.mode
    if (this.opts.labels && this.built) {
      const lineCol = mode === 'blue' ? '#ffffff' : '#ffb28f'
      const seen = new Set<string>(), items: { p: { x: number; y: number }; top: boolean; t: string; att: boolean; key: string }[] = []
      for (const m of this.built.meshes) {
        const u = m.userData
        if (!m.visible || !u.lab || !u.label || seen.has(u.key)) continue
        if (u.internal && !(mode === 'xray' || mode === 'cut') && !this.opts.exploded) continue
        seen.add(u.key)
        const b = new T.Box3().setFromObject(m), c = b.getCenter(new T.Vector3()), top = u.grp !== 'lower'
        const p = this.proj(new T.Vector3(c.x, top ? b.max.y : b.min.y, c.z))
        if (p.z > 1) continue
        items.push({ p, top, t: u.label, att: u.grp === 'att', key: u.key })
      }
      const tops = items.filter((i) => i.top), bots = items.filter((i) => !i.top)
      const baseT = clamp(Math.min(...tops.map((i) => i.p.y), H) - 34, 64, H), baseB = clamp(Math.max(...bots.map((i) => i.p.y), 0) + 34, 0, H - (this.opts.operate ? 170 : 40))
      ;([[tops, baseT, -1], [bots, baseB, 1]] as const).forEach(([arr, base, dir]) => {
        const lanes = [-1e9, -1e9, -1e9]
        ;[...arr].sort((a, b) => a.p.x - b.p.x).forEach((it) => {
          const w = it.t.length * (W < 600 ? 5.8 : 6.6) + (W < 600 ? 14 : 18)
          let x = clamp(it.p.x, w / 2 + 4, W - w / 2 - 4)
          let lane = lanes.findIndex((r) => r < x - w / 2 - 6)
          if (lane < 0) { lane = lanes.indexOf(Math.min(...lanes)); x = lanes[lane] + w / 2 + 6 }
          lanes[lane] = x + w / 2
          const y = clamp(base + dir * lane * 30, 14, H - 14)
          svg += `<line x1="${it.p.x}" y1="${it.p.y}" x2="${x}" y2="${y}" stroke="${lineCol}" stroke-width="1.2" opacity=".8"/><circle cx="${it.p.x}" cy="${it.p.y}" r="2.8" fill="${lineCol}"/>`
          html += `<div class="eng-tag${it.att ? ' att' : ''}${it.key === this.picked ? ' on' : ''}" style="left:${x}px;top:${y}px">${esc(it.t)}</div>`
        })
      })
    }
    if (this.opts.dims && this.built && this.specs && !this.opts.exploded) {
      const I = this.built.info, g = this.built.gun, u = this.opts.units, fl = (I.floor ?? -8) + 0.9
      const dim = (x0: number, x1: number, y: number, label: string, col = '#ff6b35') => {
        const a = this.proj(new T.Vector3(x0, y, 0)), b = this.proj(new T.Vector3(x1, y, 0))
        if (a.z > 1 || b.z > 1) return
        svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="1.6"/>`
        const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * 7, ny = Math.cos(ang) * 7
        ;[a, b].forEach((p) => { svg += `<line x1="${p.x - nx}" y1="${p.y - ny}" x2="${p.x + nx}" y2="${p.y + ny}" stroke="${col}" stroke-width="1.6"/>` })
        html += `<div class="eng-tag dim" style="left:${(a.x + b.x) / 2}px;top:${(a.y + b.y) / 2}px;border-color:${col}">${esc(label)}</div>`
      }
      dim(I.butt, I.devEnd, fl, `OAL ${fmtLen(I.devEnd - I.butt, u)}`)
      if (I.suppEnd && this.opts.attachments) dim(I.butt, Math.max(I.devEnd, I.suppEnd), fl - 2.2, `with suppressor ${fmtLen(Math.max(I.devEnd, I.suppEnd) - I.butt, u)}`, '#f2d98a')
      const optic = g.atts.some((a) => ['lpvo', 'holo', 'reddot', 'magn', 'prism', 'scope'].includes(a.k)) && this.opts.attachments
      const by = I.pistol ? (I.slideTop ?? 0.8) + 1.0 : I.rail + (optic ? 3.4 : 1.2)
      dim(0, I.muzzleX, by, `Barrel ${fmtLen(g.cfg.barrel ?? 0, u)}`, mode === 'blue' ? '#ffe08a' : '#1f9d6c')
      const bal = this.specs.balance
      if (bal) {
        const p = this.proj(new T.Vector3(bal.x, (I.floor ?? -8) + 0.05, 0))
        if (p.z < 1) {
          svg += `<path d="M${p.x} ${p.y - 12} l7 12 h-14z" fill="#ff6b35"/>`
          html += `<div class="eng-tag" style="left:${p.x}px;top:${p.y - 26}px">Balance ${fmtLen(Math.abs(bal.fromGrip), u)} ${bal.fromGrip >= 0 ? 'ahead of' : 'behind'} the trigger</div>`
        }
      }
    }
    if (this.opts.operate && this.pose?.callout && this.ops.plan && !this.opts.exploded) {
      const p = this.proj(new T.Vector3(...this.pose.callout.at))
      if (p.z < 1 && this.pose.callout.t) html += `<div class="eng-tag dim" style="left:${p.x}px;top:${p.y - 30}px">${esc(this.pose.callout.t)}</div>`
    }
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    this.svg.innerHTML = svg
    this.tags.innerHTML = html
  }
}
