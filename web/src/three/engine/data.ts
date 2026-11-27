// Catalog, slot and platform data for the build engine. Units are inches; +x points to the muzzle,
// +y up, +z is the right (ejection-port) side.

export type Platform = 'ar15' | 'ar10' | 'ak' | 'mp5' | 'pistol' | 'shotgun'
export type Mode = 'clay' | 'real' | 'cut' | 'xray' | 'blue'

/** A part in the parts catalog (short keys keep the file small). */
export interface CatPart {
  id: string
  s: string // slot
  pl: string // platform family: ar, a15, a10, r22, ak, mp5, sg, pg
  n: string
  p?: number
  w?: number // oz
  st?: string // muzzle style
  th?: string // thread
  mt?: string // mount system
  prot?: number // how far a muzzle device sticks out
  fit?: string
  src?: string
  [k: string]: unknown
}
/** An accessory (optic, light, suppressor, mount...) in the parts catalog. */
export interface CatAcc {
  id: string
  k: string
  n: string
  p?: number
  w?: number
  len?: number
  h?: number
  r?: number
  st?: string
  dia?: number
  bore?: string
  mt?: string
  rear?: string
  th?: string
  mag?: number
  lm?: number
  fp?: string
  fam?: string
  gives?: string
  src?: string
  [k: string]: unknown
}
export interface PartsCatalog { asof: string; src: string; parts: CatPart[]; acc: CatAcc[] }

export class Cat {
  readonly parts: CatPart[]
  readonly acc: CatAcc[]
  readonly PB: Record<string, CatPart>
  readonly AB: Record<string, CatAcc>
  readonly asof: string
  readonly src: string
  constructor(data: PartsCatalog) {
    this.parts = data.parts
    this.acc = data.acc
    this.asof = data.asof
    this.src = data.src
    this.PB = Object.fromEntries(data.parts.map((p) => [p.id, p]))
    this.AB = Object.fromEntries(data.acc.map((a) => [a.id, a]))
  }
  findP(slot: string, q: string): string | null {
    const ql = q.toLowerCase()
    return this.parts.find((p) => p.s === slot && p.n.toLowerCase().includes(ql))?.id ?? null
  }
  findA(k: string, q: string): string | null {
    const ql = q.toLowerCase()
    return this.acc.find((a) => a.k === k && a.n.toLowerCase().includes(ql))?.id ?? null
  }
}

export const PROT: Record<string, number> = { cage: 1.75, fh: 2.0, brake: 1.9, comp: 2.1, cap: 0.45, none: 0 }
/** Pistol devices are much shorter than rifle ones (a typical single-port comp adds about an inch). */
const PISTOL_PROT: Record<string, number> = { cage: 0.9, fh: 1.0, brake: 1.1, comp: 1.1, cap: 0.3, none: 0 }
export const MUZZLE_STYLES: Record<string, string> = { none: 'Bare / thread protector', cage: 'Birdcage flash hider', fh: 'Prong flash hider', comp: 'Compensator', brake: 'Muzzle brake', cap: 'Thread cap' }

export interface Muzzle { id: string | null; n: string; prot: number; r: number; mount: string; th: string; st: string; wt: number; p?: number }

/** The muzzle device drawn on the model: a catalog id, or a generic style for factory devices. */
export function mzOf(cat: Cat, id: string | null | undefined, cfg?: Cfg, pistol = false): Muzzle {
  const p = id ? cat.PB[id] : undefined
  if (!p) {
    const st = cfg?.muzzleStyle
    if (st && st !== 'none' && PROT[st] != null) {
      const th = cfg?.thread ?? ''
      const big = th.startsWith('5/8') || th.startsWith('14x1')
      return { id: null, n: MUZZLE_STYLES[st] ?? st, prot: pistol ? PISTOL_PROT[st] ?? 1 : PROT[st], r: pistol ? 0.42 : big ? 0.5 : 0.46, mount: 'thread', th: th || 'any', st, wt: 0 }
    }
    return { id: null, n: 'Bare muzzle', prot: 0, r: 0.32, mount: 'none', th: 'any', st: 'none', wt: 0 }
  }
  const big = (p.th || '').startsWith('5/8') || (p.th || '').startsWith('14x1')
  return { id: p.id, n: p.n, prot: p.prot ?? PROT[p.st || 'fh'] ?? 2, r: p.pl === 'pg' ? 0.42 : big ? 0.5 : 0.46, mount: p.mt || 'none', th: p.th || 'any', st: p.st || 'fh', wt: p.w || 0, p: p.p }
}

export const GASPORT: Record<string, number> = { pistol: 4, carbine: 7, mid: 9, rifle: 12 }
export const GASBAND: Record<string, [number, number]> = { pistol: [7, 10.5], carbine: [10.3, 16.1], mid: [12.5, 18.5], rifle: [18, 24] }
export const AR_STOCK: Record<string, { n: string; adj: boolean; travel: number }> = {
  sopmod: { n: 'SOPMOD-style', adj: true, travel: 3.25 }, ctr: { n: 'CTR-style', adj: true, travel: 3.25 }, m4: { n: 'Slim carbine', adj: true, travel: 3.25 },
  prs: { n: 'Precision', adj: true, travel: 2.0 }, a2: { n: 'Fixed rifle-length', adj: false, travel: 0 }, fixedc: { n: 'Fixed carbine', adj: false, travel: 0 },
  brace: { n: 'Pistol brace', adj: true, travel: 3.25 }, none: { n: 'Bare pistol buffer tube', adj: false, travel: 0 },
}
export const FIN: Record<string, string> = { black: '#2b2d30', fde: '#a68b66', odg: '#58603f', grey: '#6c7073', tungsten: '#5b5f63', bronze: '#6b5134', stainless: '#a9adb0' }
export const FINN: Record<string, string> = { black: 'Black anodized', fde: 'FDE / Desert Dirt', odg: 'OD green', grey: 'Sniper grey', tungsten: 'Tungsten', bronze: 'Burnt bronze', stainless: 'Stainless' }
/** A magazine body: length, depth and curve of a stick mag, or a drum (1 = single drum, 2 = twin drums). */
export interface MagDef { len: number; d: number; R: number; w: number; drum?: 1 | 2; dr?: number }
export const MAGS: Record<string, MagDef> = {
  // AR-15
  pmag10: { len: 3.9, d: 2.45, R: 24, w: 0.95 }, pmag20: { len: 5.6, d: 2.45, R: 24, w: 0.95 }, pmag30: { len: 7.3, d: 2.45, R: 24, w: 0.95 },
  pmag40: { len: 9.3, d: 2.45, R: 22, w: 0.95 }, pmag45: { len: 10.4, d: 2.45, R: 21, w: 0.95 },
  drum: { len: 4.2, d: 2.45, R: 0, w: 0.95, drum: 1, dr: 2.6 }, drum100: { len: 4.2, d: 2.45, R: 0, w: 0.95, drum: 2, dr: 2.3 },
  // AR-10 (SR-25 pattern)
  pmag10lr: { len: 4.2, d: 3.0, R: 70, w: 1.08 }, pmag20lr: { len: 6.4, d: 3.0, R: 70, w: 1.08 }, pmag25lr: { len: 7.4, d: 3.0, R: 60, w: 1.08 },
  pmag30lr: { len: 9.0, d: 3.0, R: 55, w: 1.08 }, drum50lr: { len: 4.6, d: 3.0, R: 0, w: 1.08, drum: 1, dr: 3.0 },
  // M&P15-22
  mp1522_10: { len: 3.6, d: 2.3, R: 26, w: 0.85 }, mp1522: { len: 6.8, d: 2.3, R: 26, w: 0.85 },
  // AK
  ak10: { len: 4.0, d: 2.65, R: 10.5, w: 1.05 }, ak30: { len: 8.4, d: 2.65, R: 10.5, w: 1.05 }, ak40: { len: 10.2, d: 2.65, R: 10.5, w: 1.05 },
  ak45: { len: 11.0, d: 2.65, R: 10.5, w: 1.05 }, drum75: { len: 4.6, d: 2.65, R: 0, w: 1.05, drum: 1, dr: 3.1 },
  // 9mm (Glock pattern, MP5)
  glock17: { len: 3.9, d: 1.45, R: 0, w: 1.0 }, glock33: { len: 6.4, d: 1.45, R: 0, w: 1.0 }, glock50: { len: 3.0, d: 1.45, R: 0, w: 1.0, drum: 1, dr: 2.2 },
  mp5_15: { len: 4.8, d: 1.45, R: 30, w: 1.0 }, mp5_30: { len: 8.6, d: 1.45, R: 30, w: 1.0 },
}
/** Magazines offered for each kind of gun: [body, name, rounds]. */
export type MagPreset = [string, string, number]
const MAG_PRESETS: Record<string, MagPreset[]> = {
  ar15: [['pmag10', '10-round', 10], ['pmag20', '20-round', 20], ['pmag30', '30-round', 30], ['pmag40', '40-round', 40], ['pmag45', '45-round', 45], ['drum', '60-round drum', 60], ['drum100', '100-round twin drum', 100]],
  ar10: [['pmag10lr', '10-round', 10], ['pmag20lr', '20-round', 20], ['pmag25lr', '25-round', 25], ['pmag30lr', '30-round', 30], ['drum50lr', '50-round drum', 50]],
  rimfire: [['mp1522_10', '10-round', 10], ['mp1522', '25-round', 25]],
  ak: [['ak10', '10-round', 10], ['ak30', '30-round', 30], ['ak40', '40-round', 40], ['ak45', '45-round (RPK)', 45], ['drum75', '75-round drum', 75]],
  glock: [['glock17', '17-round', 17], ['glock33', '33-round stick', 33], ['glock50', '50-round drum', 50]],
  mp5: [['mp5_15', '15-round', 15], ['mp5_30', '30-round', 30]],
}
/** The magazines that fit a gun, or [] when it doesn't use these (pistols, shotguns). */
export function magPresets(g: { platform?: string; rimfire?: boolean; caliber?: string; cfg?: Cfg }): MagPreset[] {
  const pf = g.platform
  if (pf === '1522' || (pf === 'ar15' && g.rimfire)) return MAG_PRESETS.rimfire
  if (pf === 'ak') return g.cfg?.mag?.startsWith('glock') || g.caliber === '9mm' ? MAG_PRESETS.glock : MAG_PRESETS.ak
  return MAG_PRESETS[pf ?? ''] ?? []
}
export const MAG_NAMES: Record<string, string> = Object.fromEntries(Object.values(MAG_PRESETS).flat().map(([k, n]) => [k, n]))
/** SAAMI / CIP nominal cartridge dimensions (in): overall length, case length, head and bullet diameter. */
export interface Cart { oal: number; cl: number; hd: number; bd: number; v: number; shell?: number }
export const CART: Record<string, Cart> = {
  '5.56 NATO': { oal: 2.26, cl: 1.76, hd: 0.378, bd: 0.224, v: 36 }, '.223 Rem': { oal: 2.26, cl: 1.76, hd: 0.378, bd: 0.224, v: 36 },
  '.300 BLK': { oal: 2.26, cl: 1.368, hd: 0.378, bd: 0.308, v: 26 }, '.308 Win': { oal: 2.8, cl: 2.015, hd: 0.473, bd: 0.308, v: 31 },
  '6.5 Creedmoor': { oal: 2.825, cl: 1.92, hd: 0.473, bd: 0.264, v: 32 }, '7.62x39': { oal: 2.2, cl: 1.524, hd: 0.447, bd: 0.311, v: 28 },
  '9mm': { oal: 1.169, cl: 0.754, hd: 0.394, bd: 0.355, v: 14 }, '.22 LR': { oal: 1.0, cl: 0.613, hd: 0.278, bd: 0.223, v: 14.4 },
  '.45 ACP': { oal: 1.275, cl: 0.898, hd: 0.48, bd: 0.452, v: 10.8 }, '12 ga': { oal: 2.75, cl: 2.75, hd: 0.8, bd: 0.73, v: 15.6, shell: 1 }, '5.7x28': { oal: 1.594, cl: 1.138, hd: 0.311, bd: 0.224, v: 24 },
}
export const KINDS: { g: string; items: [string, string][] }[] = [
  { g: 'Optics', items: [['reddot', 'Red dot sight'], ['holo', 'Holographic sight'], ['prism', 'Prism sight'], ['lpvo', 'LPVO'], ['scope', 'Rifle scope'], ['magn', 'Magnifier'], ['buis', 'Backup iron sights'], ['offset', 'Offset red dot'], ['riser', 'Optic riser'], ['pdot', 'Pistol micro red dot']] },
  { g: 'Lights and lasers', items: [['light', 'Weapon light (rifle)'], ['plight', 'Weapon light (pistol)'], ['laser', 'Laser / aiming device'], ['switch', 'Pressure switch']] },
  { g: 'Muzzle (NFA)', items: [['supp', 'Suppressor']] },
  { g: 'Handling', items: [['vfg', 'Foregrip'], ['stop', 'Hand stop'], ['bipod', 'Bipod'], ['sling', 'Sling']] },
]
export const KN: Record<string, string> = Object.fromEntries(KINDS.flatMap((g) => g.items))
export const HEIGHTS: [number, string][] = [[1.2, '1.20" low / direct'], [1.41, '1.41" absolute co-witness'], [1.5, '1.50"'], [1.54, '1.54" (30 mm cantilever)'], [1.57, '1.57" lower 1/3'], [1.63, '1.63" lower 1/3 (tall)'], [1.93, '1.93" heads-up'], [2.05, '2.05"'], [2.26, '2.26" over-gear'], [2.91, '2.91" GBRS']]
export const MOUNTSYS: Record<string, string> = { asr: 'SilencerCo ASR', keymo: 'Dead Air KeyMo', keymicro: 'Dead Air KeyMicro', xeno: 'Dead Air Xeno', xemax: 'Dead Air Xemax', surefire: 'SureFire SOCOM Fast-Attach', hux: 'HUXWRX QD', q: 'Q Fast-Attach (Cherry Bomb)', kac: 'KAC QDC', yhm: 'YHM Phantom/sRx QD', taper: 'Rugged taper', clutch: 'SIG Clutch-LOK', planb: 'Plan-B / Atlas taper', jk: 'JK taper', spr: 'Allen SPR collar', '3lug': '3-lug', thread: 'Direct thread', piston: 'Piston / booster (direct thread)', choke: 'Choke-thread mount', none: '—' }

/** The app's attachment types and the engine kind each one is drawn as. */
export const APP_TYPE_TO_KIND: Record<string, string> = {
  reddot: 'reddot', holo: 'holo', lpvo: 'lpvo', magnifier: 'magn', buis: 'buis', light: 'light', laser: 'laser', suppressor: 'supp',
  foregrip: 'vfg', handstop: 'stop', bipod: 'bipod', sling: 'sling', pistolOptic: 'pdot', pistolLight: 'plight',
}
/** Catalog accessory kinds the "Add attachment" picker offers for each app type. */
export const KIND_TO_APP_TYPE: Record<string, string> = {
  reddot: 'reddot', holo: 'holo', prism: 'reddot', lpvo: 'lpvo', scope: 'lpvo', magn: 'magnifier', buis: 'buis', offset: 'reddot', riser: 'reddot',
  light: 'light', plight: 'pistolLight', laser: 'laser', switch: 'light', supp: 'suppressor', vfg: 'foregrip', stop: 'handstop', bipod: 'bipod', sling: 'sling', pdot: 'pistolOptic',
}

// ---------- slots ----------
/** [slot, label, group, model key]: model key is the part of the 3D model the slot lights up. */
export type SlotDef = [string, string, 'upper' | 'lower' | 'furniture', string]
export const SLOTS: Record<string, SlotDef[]> = {
  ar: [['upper', 'Upper receiver', 'upper', 'upper'], ['barrel', 'Barrel', 'upper', 'barrel'], ['bcg', 'Bolt carrier group', 'upper', 'bcg'], ['ch', 'Charging handle', 'upper', 'ch'], ['hg', 'Handguard', 'upper', 'hg'], ['gasblock', 'Gas block', 'upper', 'gas'], ['gastube', 'Gas tube', 'upper', 'gas'], ['muzzle', 'Muzzle device', 'upper', 'muzzle'], ['dustcover', 'Ejection port cover', 'upper', 'dustcover'],
    ['lower', 'Lower receiver', 'lower', 'lower'], ['lpk', 'Lower parts kit', 'lower', 'lower'], ['trigger', 'Trigger', 'lower', 'trigger'], ['safety', 'Safety selector', 'lower', 'safety'], ['catch', 'Bolt catch', 'lower', 'catch'], ['magrel', 'Mag release', 'lower', 'lower'], ['pins', 'Pins', 'lower', 'lower'], ['tguard', 'Trigger guard', 'lower', 'lower'],
    ['tube', 'Buffer tube', 'lower', 'buffer'], ['buffer', 'Buffer', 'lower', 'buffer'], ['spring', 'Action spring', 'lower', 'buffer'], ['endplate', 'End plate / castle nut', 'lower', 'buffer'],
    ['stock', 'Stock / brace', 'furniture', 'stock'], ['grip', 'Pistol grip', 'furniture', 'grip'], ['mag', 'Magazine', 'furniture', 'mag']],
  ak: [['barrel', 'Barrel', 'upper', 'barrel'], ['muzzle', 'Muzzle device', 'upper', 'muzzle'], ['hg', 'Handguard', 'upper', 'hg'], ['upper', 'Dust cover', 'upper', 'upper'], ['bcg', 'Bolt carrier', 'upper', 'bcg'], ['ch', 'Charging handle', 'upper', 'bcg'], ['lower', 'Receiver', 'lower', 'lower'], ['trigger', 'Trigger group', 'lower', 'trigger'], ['safety', 'Safety lever', 'lower', 'safety'], ['stock', 'Stock / brace', 'furniture', 'stock'], ['grip', 'Pistol grip', 'furniture', 'grip'], ['mag', 'Magazine', 'furniture', 'mag']],
  mp5: [['upper', 'Receiver', 'upper', 'upper'], ['barrel', 'Barrel', 'upper', 'barrel'], ['bcg', 'Bolt group', 'upper', 'bcg'], ['ch', 'Cocking handle', 'upper', 'ch'], ['hg', 'Handguard', 'upper', 'hg'], ['muzzle', 'Muzzle device', 'upper', 'muzzle'], ['lower', 'Trigger group', 'lower', 'lower'], ['stock', 'Stock / brace', 'furniture', 'stock'], ['mag', 'Magazine', 'furniture', 'mag']],
  pistol: [['slide', 'Slide', 'upper', 'slide'], ['pbarrel', 'Barrel', 'upper', 'barrel'], ['muzzle', 'Compensator', 'upper', 'muzzle'], ['psights', 'Sights', 'upper', 'slide'], ['frame', 'Frame', 'lower', 'frame'], ['ptrigger', 'Trigger', 'lower', 'trigger'], ['pctl', 'Controls', 'lower', 'frame'], ['mag', 'Magazine', 'furniture', 'mag']],
  shotgun: [['lower', 'Receiver', 'lower', 'lower'], ['barrel', 'Barrel', 'upper', 'barrel'], ['muzzle', 'Choke', 'upper', 'muzzle'], ['bcg', 'Bolt', 'upper', 'bcg'], ['sgtube', 'Magazine tube', 'upper', 'tube'], ['hg', 'Forend', 'upper', 'hg'], ['trigger', 'Trigger group', 'lower', 'trigger'], ['stock', 'Stock', 'furniture', 'stock']],
}
/** Platform values the engine draws. "1522" (the M&P15-22) is drawn as a rimfire AR-15. */
export const enginePlatform = (p: string | undefined): Platform => (p === '1522' ? 'ar15' : (p as Platform))
export const famKey = (platform: string | undefined) => (platform === 'ar15' || platform === 'ar10' || platform === '1522' ? 'ar' : platform ?? 'ar')
export const slotsOf = (platform: string | undefined): SlotDef[] => SLOTS[famKey(platform)] ?? SLOTS.ar
/** Slots for a specific gun. A rimfire (blowback .22) AR has no buffer: the tube only holds the stock,
 *  and the recoil spring sits behind the bolt in the upper. */
export function slotsFor(platform: string | undefined, rimfire?: boolean): SlotDef[] {
  const s = slotsOf(platform)
  if (!(rimfire || platform === '1522') || famKey(platform) !== 'ar') return s
  return s.filter((d) => d[0] !== 'buffer').map((d): SlotDef =>
    d[0] === 'tube' ? ['tube', 'Stock tube (no buffer)', 'lower', 'buffer']
      : d[0] === 'spring' ? ['spring', 'Recoil spring (in the upper)', 'upper', 'bcg']
        : d[0] === 'bcg' ? ['bcg', 'Blowback bolt', 'upper', 'bcg'] : d)
}
export const slotDef = (platform: string | undefined, slot: string) => slotsOf(platform).find((s) => s[0] === slot)
export const PLATFORM_NAMES: Record<Platform, string> = { ar15: 'AR-15', ar10: 'AR-10', ak: 'AK-pattern', mp5: 'MP5-pattern', pistol: 'Striker pistol', shotgun: 'Semi-auto shotgun' }
export const PLATFORM_FAMILIES: Record<string, string> = { ar: 'Fits AR-15 and AR-10', a15: 'AR-15', a10: 'AR-10', r22: 'M&P15-22', ak: 'AK', mp5: 'MP5', sg: 'Shotgun', pg: 'Pistol' }

function fitOK(f: string | undefined, gf: string | undefined): boolean {
  if (!f) return true
  gf = gf || ''
  if (f === 'glock') return gf.startsWith('glock') || gf === 'dagger'
  if (f === 'glock19') return gf === 'glock19' || gf === 'dagger'
  return f === gf
}
export interface FitTarget { platform?: string; rimfire?: boolean; fit?: string }
/** Whether a catalog part fits this gun. `loose` lets AR-15 fire-control and furniture parts show on AR-10s. */
export function plOK(p: CatPart, g: FitTarget, loose = false): boolean {
  const pf = enginePlatform(g.platform), pl = p.pl
  if (g.platform === '1522') g = { ...g, rimfire: true }
  if (pl === 'ar') return pf === 'ar15' || pf === 'ar10'
  if (pl === 'a15') return (pf === 'ar15' && !g.rimfire) || (pf === 'ar10' && loose && ['trigger', 'grip', 'safety', 'catch', 'magrel', 'stock', 'tguard', 'lpk'].includes(p.s))
  if (pl === 'a10') return pf === 'ar10'
  if (pl === 'r22') return pf === 'ar15' && !!g.rimfire
  if (pl === 'ak') return pf === 'ak'
  if (pl === 'mp5') return pf === 'mp5'
  if (pl === 'sg') return pf === 'shotgun'
  if (pl === 'pg') return pf === 'pistol' && fitOK(p.fit, g.fit)
  return false
}

// ---------- engine-side gun ----------
/** Settings the model is drawn from. Different platforms use different keys. */
export interface Cfg {
  barrel?: number; gas?: string; gasAdj?: boolean; hg?: number; hgStyle?: string; hgFin?: string | null
  muzzle?: string | null; muzzleStyle?: string; pinned?: boolean; stock?: string; stockPos?: number
  finish?: string; furn?: string; mag?: string; magCap?: number; thread?: string; ch?: string; tube?: string | number
  polymer?: boolean; rail?: boolean; akGas?: boolean
  slide?: number; height?: number; frame?: string; metal?: boolean; threaded?: boolean; barrelFin?: string
  /** from the original model: slide lightening cuts, optic plate, no top rail on the handguard */
  cuts?: boolean; opticPlate?: boolean; hgTopRail?: boolean
  [k: string]: unknown
}
export interface BuildRow {
  slot: string
  label?: string
  name: string
  pid?: string | null
  note?: string
  source?: 'factory' | 'part' | 'upgrade'
  partId?: string
  price?: number | null
  listPrice?: number | null
  status?: 'owned' | 'planned'
  factory?: { name: string; pid?: string | null }
}
export interface EngAtt {
  id: string; k: string; n: string; cid: string | null; wt: number
  len: number; h: number; r?: number; st?: string; dia?: number; mt?: string; rear?: string; th?: string; mag?: number
  bore?: string; lm?: number; fp?: string
  pos: number | null; clock: number; mount: string | null; ad: string | null; sub: string | null
  /** true when the position was set by hand (not the default for its kind) */
  userPos?: boolean
  _lens?: [number, number, number]; _end?: number; _x0?: number
}
export interface EngGun {
  id: string; platform: Platform; rimfire?: boolean; fit?: string; caliber?: string; cfg: Cfg; build: BuildRow[]; atts: EngAtt[]
  /** Unloaded weight from the listing or your scale, when known (lb). */
  wtLb?: number | null
  wtSource?: 'scale' | 'listing' | 'estimate'
  /** Exact colours per material key from the original model (e.g. barrel: gold). */
  look?: Record<string, number>
}

const DEF_LEN: Record<string, number> = { lpvo: 10.4, scope: 12.5, magn: 4.2, holo: 3.8, prism: 3.3, light: 5.2, plight: 2.4, laser: 4.0, supp: 7.0, vfg: 1.4, stop: 1.8, bipod: 2.0, riser: 4.0, offset: 1.9, pdot: 1.85, switch: 1.2, buis: 1.6, reddot: 2.6 }
/** Typical weights (oz) for attachments typed in by hand. */
const DEF_WT: Record<string, number> = { lpvo: 17, scope: 24, magn: 11, holo: 11, prism: 10, light: 4.5, plight: 3.5, laser: 7, supp: 15, vfg: 2.5, stop: 1, bipod: 12, riser: 3, offset: 3, pdot: 1.5, switch: 1, buis: 3.5, reddot: 4, sling: 6 }
const DEF_H: Record<string, number> = { lpvo: 1.54, scope: 1.5, magn: 1.57, holo: 1.57, prism: 1.57, reddot: 1.57, pdot: 0.75, riser: 1 }

export function mkAtt(cat: Cat, id: string, k: string, name: string, cid: string | null): EngAtt {
  const c = (cid && cat.AB[cid]) || ({} as Partial<CatAcc>)
  const kind = c.k || k
  return {
    id, k: kind, n: name || c.n || 'Attachment', cid: cid || null, wt: c.w ?? DEF_WT[kind] ?? 4,
    len: c.len ?? DEF_LEN[kind] ?? 2, h: c.h ?? DEF_H[kind] ?? 1.5, r: c.r, st: c.st, dia: c.dia, mt: c.mt, rear: c.rear, th: c.th, mag: c.mag, bore: c.bore, lm: c.lm, fp: c.fp,
    pos: null, clock: kind === 'light' ? 2 : kind === 'laser' ? 11 : 0,
    mount: kind === 'lpvo' || kind === 'scope' ? cat.findA('omount', 'Aero Precision Ultralight') : null, ad: null,
    sub: kind === 'offset' ? cat.findA('pdot', 'Holosun 507C X2') : null,
  }
}
export const effH = (cat: Cat, a: EngAtt) => (a.mount && cat.AB[a.mount]?.h ? cat.AB[a.mount].h! : a.h)
