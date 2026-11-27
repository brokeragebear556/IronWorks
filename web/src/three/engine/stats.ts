/* Game-style ratings (0–100) for a build, computed from what's on it: caliber and barrel length,
   weight, length, balance, trigger, muzzle device, optics and grips. They're illustrative scores for
   comparing setups, not ballistic data. Each stat is also worked out for the gun's factory setup
   (factory parts, no attachments) so changes show as + / − against it. */
import { buildGun, disposeGroup } from './assemble'
import { MAGS, type Cat, type EngAtt, type EngGun } from './data'
import { computeSpecs, type Specs } from './specs'

export type StatKey = 'damage' | 'fireRate' | 'range' | 'accuracy' | 'control' | 'mobility' | 'handling'
export interface StatSet { values: Record<StatKey, number>; capacity: number }
export interface GunStats { now: StatSet; factory: StatSet; notes: string[] }

export const STAT_LABELS: Record<StatKey, string> = {
  damage: 'Damage', fireRate: 'Fire rate', range: 'Range', accuracy: 'Accuracy', control: 'Recoil control', mobility: 'Mobility', handling: 'Handling',
}
export const STAT_HELP: Record<StatKey, string> = {
  damage: 'Muzzle energy for the caliber at this barrel length',
  fireRate: 'How fast it can be fired accurately: trigger reset, recoil and action',
  range: 'Effective range from velocity, plus magnified or red-dot optics',
  accuracy: 'Barrel length, trigger, free-float handguard, optics and support',
  control: 'Felt recoil from caliber and weight, less what the muzzle device, stock and grips take off',
  mobility: 'Weight and overall length: how easy it is to carry and move with',
  handling: 'Weight out in front of the grip: how quickly it swings and settles on target',
}
/** The five on the radar chart. */
export const RADAR: StatKey[] = ['damage', 'range', 'accuracy', 'control', 'mobility']

// caliber: [muzzle energy ft-lb at the reference barrel, reference barrel in, effective range yd, recoil ft-lb in a 7 lb gun]
const CAL: Record<string, [number, number, number, number]> = {
  '5.56 NATO': [1300, 16, 500, 1.3], '.223 Rem': [1250, 16, 450, 1.3], '.300 BLK': [1050, 16, 300, 2.2], '.308 Win': [2600, 20, 800, 16],
  '6.5 Creedmoor': [2400, 24, 1000, 12], '7.62x39': [1500, 16, 350, 5], '9mm': [400, 4.5, 75, 4.5], '.22 LR': [110, 16, 150, 0.1],
  '.45 ACP': [400, 5, 60, 6], '12 ga': [2400, 18.5, 50, 25], '5.7x28': [300, 16, 150, 0.6],
}
const clamp = (v: number) => Math.max(1, Math.min(100, Math.round(v)))
const ln = Math.log

function triggerTier(name: string): number {
  const n = name.toLowerCase()
  if (/two-stage|2-stage|ssa|mbt|larue|geissele|timney|rise|triggertech|hiperfire|match|performance center|\bpc\b|tuned|apex|flat/.test(n)) return 1
  if (/mil-spec|milspec|factory single|gritty/.test(n)) return -1
  return 0
}

interface Inputs {
  g: EngGun; specs: Specs; atts: EngAtt[]; trigger: string
  /** cage, fh, comp, brake, cap or none */
  mzStyle: string
}

function rate({ g, specs, atts, trigger, mzStyle }: Inputs): StatSet {
  const c = g.cfg, pistol = g.platform === 'pistol', bl = c.barrel ?? 16
  const [E0, ref, R0, rec0] = CAL[g.caliber ?? ''] ?? CAL['5.56 NATO']
  const has = (...k: string[]) => atts.some((a) => k.includes(a.k))
  const supp = has('supp'), magnified = has('lpvo', 'scope', 'magn') || atts.some((a) => a.k === 'prism' && (a.mag ?? 1) > 1), dot = has('reddot', 'holo', 'prism', 'pdot', 'offset')
  const tier = triggerTier(trigger)
  const wtLb = specs.wtTotal / 16

  // damage: energy scales roughly with the square root of barrel length around the reference
  const E = E0 * Math.sqrt(Math.max(0.3, bl / ref))
  const damage = (100 * ln(E / 40)) / ln(5000 / 40)

  // range: velocity, then optics
  let R = R0 * Math.pow(Math.max(0.3, bl / ref), 0.25)
  if (magnified) R *= 1.4
  else if (dot) R *= 1.1
  const range = (100 * ln(R / 25)) / ln(1200 / 25)

  // recoil: heavier guns kick less; comps and cans take some off; stocks help
  let recoil = rec0 * (7 / Math.max(1, wtLb))
  if (pistol) recoil = rec0 * (1.6 / Math.max(0.8, wtLb))
  const st = mzStyle
  if (st === 'comp' || st === 'brake') recoil *= 0.68
  else if (st === 'fh' || st === 'cage') recoil *= 0.95
  if (supp) recoil *= 0.8
  const stocked = !pistol && c.stock && !['none'].includes(c.stock)
  let control = 100 - 22 * ln(1 + recoil * 2)
  if (stocked) control += 6
  if (has('vfg', 'stop')) control += 4
  if (has('bipod')) control += 3

  // accuracy
  let accuracy = ({ ar15: 66, ar10: 70, ak: 52, mp5: 58, pistol: 46, shotgun: 34 } as Record<string, number>)[g.platform] ?? 60
  accuracy += Math.max(-8, Math.min(10, (bl - ref) * (pistol ? 3 : 0.8)))
  accuracy += tier > 0 ? 8 : tier < 0 ? -3 : 0
  if (!pistol && (c.hgStyle === 'mlok' || c.hgStyle === 'quad')) accuracy += 4
  if (magnified) accuracy += 10
  else if (dot) accuracy += 6
  if (has('bipod')) accuracy += 6
  if (g.rimfire) accuracy += 4
  accuracy += (control - 50) * 0.08

  // practical fire rate
  let fireRate = pistol ? 70 : g.platform === 'shotgun' ? 40 : 58
  if (g.rimfire) fireRate += 14
  fireRate += tier > 0 ? 9 : tier < 0 ? -3 : 0
  fireRate += (control - 50) * 0.3

  // mobility and handling
  // a loaded drum or long stick mag is heavy and bulky
  const mag = MAGS[c.mag ?? '']
  const magPenalty = mag?.drum === 2 ? 10 : mag?.drum ? 7 : mag && mag.len >= 9 ? 3 : 0
  const mobility = 100 - magPenalty - (wtLb - 1.4) * 7.5 - Math.max(0, specs.oal - 18) * 1.1 - (specs.oalSupp ? (specs.oalSupp - specs.oal) * 1.1 : 0)
  const moment = specs.balance ? wtLb * Math.abs(specs.balance.fromGrip) : wtLb * 4
  const handling = 100 - moment * (pistol ? 3 : 1.25) - (magnified ? 4 : 0)

  return {
    values: { damage: clamp(damage), fireRate: clamp(fireRate), range: clamp(range), accuracy: clamp(accuracy), control: clamp(control), mobility: clamp(mobility), handling: clamp(handling) },
    capacity: c.magCap ?? 30,
  }
}

/** Ratings for the build as configured, and for its factory setup. */
export function gunStats(g: EngGun, cat: Cat): GunStats {
  const trig = (rows: EngGun['build'], factory: boolean) => {
    const r = rows.find((x) => x.slot === 'trigger' || x.slot === 'ptrigger')
    return (factory ? r?.factory?.name ?? (r?.source === 'upgrade' ? '' : r?.name) : r?.name) ?? ''
  }
  const measure = (eg: EngGun, withAtts: boolean) => {
    const b = buildGun(eg, cat, withAtts)
    try { return computeSpecs(b, cat, withAtts) } finally { disposeGroup(b.group) }
  }
  const nowSpecs = measure(g, true)
  const base: EngGun = { ...g, atts: [] }
  const baseSpecs = measure(base, false)
  const mz = g.cfg.muzzle ? cat.PB[g.cfg.muzzle]?.st ?? 'fh' : g.cfg.muzzleStyle ?? 'none'
  return {
    now: rate({ g, specs: nowSpecs, atts: g.atts, trigger: trig(g.build, false), mzStyle: mz }),
    factory: rate({ g: base, specs: baseSpecs, atts: [], trigger: trig(g.build, true), mzStyle: mz }),
    notes: [],
  }
}

/** 0–100 score on the 5-point scale (1.0–5.0). */
export const toFive = (v: number) => Math.round((1 + (4 * v) / 100) * 10) / 10
