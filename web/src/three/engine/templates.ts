// Starting points for "Add gun". Catalog builds fill every slot from the parts catalog (their
// prices add up to the gun's price); factory guns list what ships on them.
import { slotsFor, type BuildRow, type Cat, type Cfg, type Platform } from './data'

export interface Template {
  id: string
  name: string
  desc: string
  /** true: every catalog part is priced and counted; false: a factory gun whose price you enter. */
  catalogBuild: boolean
  make: (cat: Cat) => NewGun
}
export interface NewGun {
  name: string; short: string; type: 'rifle' | 'pistol'; platform: Platform; caliber: string; twist: string
  rimfire?: boolean; fit?: string; cfg: Cfg; spec: Record<string, string>; parts: Record<string, string | null>; notes?: Record<string, string>
  nfa?: string
}

/** One row per slot. Catalog ids become linked parts; anything else is a typed name. */
export function makeRows(cat: Cat, g: NewGun, catalogBuild: boolean, status: 'owned' | 'planned'): BuildRow[] {
  return slotsFor(g.platform, g.rimfire).map(([slot, label]) => {
    const v = g.parts[slot] ?? ''
    const p = v ? cat.PB[v] : undefined
    const note = g.notes?.[slot]
    if (p) {
      return catalogBuild
        ? { slot, label, name: p.n, pid: p.id, source: 'upgrade', listPrice: p.p ?? null, status, ...(note ? { note } : {}) }
        : { slot, label, name: p.n, pid: p.id, source: 'factory', factory: { name: p.n, pid: p.id }, ...(note ? { note } : {}) }
    }
    return { slot, label, name: v, source: 'factory', factory: { name: v }, ...(note ? { note } : {}) }
  })
}

function arDefault(cat: Cat) {
  const f = (s: string, q: string) => cat.findP(s, q)
  return {
    upper: f('upper', 'Aero Precision M4E1'), barrel: f('barrel', 'Ballistic Advantage 16" Hanson'), bcg: f('bcg', 'Toolcraft Black Nitride'), ch: f('ch', 'Mil-Spec Charging'),
    hg: f('hg', 'Aero Precision ATLAS'), gasblock: f('gasblock', 'Aero Precision Low Profile'), gastube: f('gastube', 'Aero Precision SS Gas Tube - Mid'), muzzle: f('muzzle', 'White Label Armory A2'),
    lower: f('lower', 'Aero Precision M4E1'), lpk: f('lpk', 'CMMG Complete'), trigger: f('trigger', 'ALG Defense ACT'), safety: f('safety', 'Mil-Spec Safety'), catch: f('catch', 'Magpul B.A.D.'),
    magrel: f('magrel', 'Magpul Enhanced'), tube: f('tube', 'BCM Mil-Spec Carbine'), buffer: f('buffer', 'H2 Buffer'), spring: f('spring', 'Sprinco Blue'), endplate: f('endplate', 'Ascend Armory Mod1'),
    stock: f('stock', 'Magpul CTR'), grip: f('grip', 'Magpul MOE-K2 Grip'), mag: f('mag', 'PMAG 30 AR/M4 Gen M3'),
  } as Record<string, string | null>
}
const AR_CFG: Cfg = { barrel: 16, gas: 'mid', gasAdj: false, hg: 15, hgStyle: 'mlok', pinned: false, stock: 'ctr', stockPos: 0.35, finish: 'black', furn: 'black', mag: 'pmag30', magCap: 30, thread: '1/2x28', ch: 'std', tube: 'carbine' }

function ar15(cat: Cat): NewGun {
  const d = arDefault(cat)
  return { name: 'AR-15 16" mid-length build', short: '5.56 rifle', type: 'rifle', platform: 'ar15', caliber: '5.56 NATO', twist: '1:7', cfg: { ...AR_CFG, muzzle: d.muzzle }, spec: {}, parts: d }
}
function g19(cat: Cat): NewGun {
  return {
    name: 'Glock 19 (Gen5 dimensions)', short: '9mm compact pistol', type: 'pistol', platform: 'pistol', caliber: '9mm', twist: '1:9.84', fit: 'glock19',
    cfg: { barrel: 4.02, slide: 7.28, height: 5.04, finish: 'black', frame: 'black', threaded: false, muzzle: null, thread: 'none', magCap: 15 },
    spec: { overallLength: '7.28"', weight: '23.65 oz (empty)' },
    parts: { slide: 'Glock 19 slide (factory)', pbarrel: '4.02" Marksman barrel (factory)', psights: 'Factory polymer', frame: 'Glock 19 frame (factory)', ptrigger: 'Factory flat-face', mag: cat.findP('mag', 'Glock OEM G19 15') },
  }
}
function ak(cat: Cat): NewGun {
  const f = (s: string, q: string) => cat.findP(s, q)
  return {
    name: 'AK-pattern rifle 16.3" 7.62x39', short: '7.62x39 rifle', type: 'rifle', platform: 'ak', caliber: '7.62x39', twist: '1:9.45',
    cfg: { barrel: 16.3, stock: 'fixed', furn: 'black', finish: 'black', muzzle: f('muzzle', 'AK slant brake'), thread: '14x1 LH', rail: true, mag: 'ak30', magCap: 30, akGas: true, hgStyle: 'poly' }, spec: {},
    parts: { barrel: '16.3" chrome-lined, 14x1 LH', muzzle: f('muzzle', 'AK slant brake'), hg: f('hg', 'Magpul MOE AKM'), upper: 'Railed dust cover', bcg: 'AKM-pattern carrier + bolt', ch: 'Factory', lower: 'Stamped 1 mm receiver', trigger: f('trigger', 'ALG Defense AKT-EL'), safety: 'Factory', stock: f('stock', 'Magpul MOE AK Stock'), grip: f('grip', 'Magpul MOE-K2 AK'), mag: f('mag', 'PMAG 30 AK/AKM') },
  }
}
const set = (g: NewGun, slot: string, v: string | null) => { g.parts = { ...g.parts, [slot]: v } }

export const TEMPLATES: Template[] = [
  { id: 'ar15', name: 'AR-15 rifle 16" (catalog parts)', desc: 'Every slot filled from the catalog, with prices', catalogBuild: true, make: ar15 },
  {
    id: 'ddm4v7', name: 'Daniel Defense DDM4 V7', desc: '16" mid · MFR XL 15 · factory complete', catalogBuild: false,
    make: (cat) => {
      const g = ar15(cat)
      Object.assign(g, { name: 'Daniel Defense DDM4 V7', short: '5.56 rifle, factory', spec: { overallLength: '32.25–35.5"', weight: '6.25 lb' } })
      g.cfg = { ...g.cfg, magCap: 32 }
      g.parts = { upper: 'Daniel Defense M4 upper (factory)', barrel: '16" CHF mil-spec, 1:7, M4 profile', bcg: cat.findP('bcg', 'Daniel Defense M16'), ch: 'Mil-spec (factory)', hg: 'DD MFR XL 15.0 M-LOK', gasblock: 'Pinned low-profile (factory)', gastube: 'Mid-length (factory)', muzzle: 'DD flash suppressor (factory)', lower: 'Daniel Defense lower (factory)', lpk: cat.findP('lpk', 'Daniel Defense LPK'), trigger: 'Mil-spec (factory)', stock: 'Daniel Defense buttstock (factory)', grip: 'Daniel Defense grip (factory)', mag: cat.findP('mag', 'Daniel Defense 32-Round') }
      return g
    },
  },
  {
    id: 'sbr115', name: 'AR-15 SBR 11.5"', desc: 'Carbine gas · needs an approved Form 1 before assembly', catalogBuild: true,
    make: (cat) => {
      const g = ar15(cat)
      Object.assign(g, { name: 'AR-15 11.5" SBR', short: '5.56 short-barreled rifle', nfa: 'Form 1' })
      g.cfg = { ...g.cfg, barrel: 11.5, gas: 'carbine', hg: 10.25, stock: 'sopmod' }
      set(g, 'barrel', cat.findP('barrel', 'BCM BFH 11.5')); set(g, 'hg', cat.findP('hg', 'NLA AR-15 M-LOK 10.25')); set(g, 'gastube', cat.findP('gastube', 'Aero Precision SS Gas Tube - Carbine')); set(g, 'stock', cat.findP('stock', 'B5 Systems Bravo'))
      return g
    },
  },
  {
    id: 'arp300', name: 'AR pistol 10.5" .300 BLK', desc: 'Pistol gas · bare buffer tube', catalogBuild: true,
    make: (cat) => {
      const g = ar15(cat)
      Object.assign(g, { name: 'AR pistol 10.5" .300 BLK', short: '.300 BLK pistol', caliber: '.300 BLK', twist: '1:8' })
      g.cfg = { ...g.cfg, barrel: 10.5, gas: 'pistol', hg: 9, stock: 'none', thread: '5/8x24', muzzle: cat.findP('muzzle', 'CMC A2 Flash Hider (5/8x24)') }
      set(g, 'barrel', cat.findP('barrel', 'Noveske 10.5" .300')); set(g, 'hg', cat.findP('hg', 'NLA AR-15 M-LOK 9"')); set(g, 'gastube', cat.findP('gastube', 'Aero Precision SS Gas Tube - Pistol'))
      set(g, 'muzzle', cat.findP('muzzle', 'CMC A2 Flash Hider (5/8x24)')); set(g, 'stock', cat.findP('stock', 'Bare pistol buffer tube')); set(g, 'mag', cat.findP('mag', 'PMAG 30 AR 300B'))
      return g
    },
  },
  {
    id: 'ar10', name: 'AR-10 18" .308', desc: 'DPMS-pattern large frame, catalog parts', catalogBuild: true,
    make: (cat) => {
      const f = (s: string, q: string) => cat.findP(s, q)
      return {
        name: 'AR-10 18" .308', short: '.308 rifle', type: 'rifle', platform: 'ar10', caliber: '.308 Win', twist: '1:10', spec: {},
        cfg: { ...AR_CFG, barrel: 18, gasAdj: true, muzzle: f('muzzle', 'CMC A2 Flash Hider (5/8x24)'), stock: 'sopmod', mag: 'pmag20lr', magCap: 20, thread: '5/8x24', ch: 'ambi' },
        parts: { upper: f('upper', 'Aero Precision M5 Assembled'), barrel: '18" .308, 1:10, mid-length, 5/8x24', bcg: f('bcg', 'Aero Precision .308'), ch: f('ch', 'Aero Precision AR10 BREACH'), hg: f('hg', 'NLA AR-10 M-LOK 15'), gasblock: f('gasblock', 'Aero Precision Adjustable'), gastube: f('gastube', 'Aero Precision SS Gas Tube - Mid'), muzzle: f('muzzle', 'CMC A2 Flash Hider (5/8x24)'), lower: f('lower', 'Aero Precision M5 Stripped'), lpk: f('lpk', 'Aero Precision M5 LPK'), trigger: f('trigger', 'TriggerTech AR-10'), safety: f('safety', 'Radian Talon'), tube: f('tube', 'BCM Mil-Spec Carbine'), buffer: f('buffer', 'Aero Precision .308 Carbine Buffer'), stock: f('stock', 'B5 Systems Enhanced SOPMOD'), grip: f('grip', 'B5 Systems Type 23'), mag: f('mag', 'PMAG 20 LR/SR') },
      }
    },
  },
  {
    id: 'mp1522', name: 'S&W M&P15-22 Sport', desc: '.22 LR trainer, factory complete', catalogBuild: false,
    make: (cat) => ({
      name: 'S&W M&P15-22 Sport', short: 'Factory complete .22 LR', type: 'rifle', platform: 'ar15', rimfire: true, caliber: '.22 LR', twist: '1:15', spec: { weight: '5.5 lb' },
      cfg: { ...AR_CFG, barrel: 16.5, gas: 'none', hg: 10, hgStyle: 'poly', muzzle: null, muzzleStyle: 'cage', stock: 'm4', stockPos: 0.3, mag: 'mp1522', magCap: 25, polymer: true },
      parts: { upper: 'Polymer upper (blowback .22 LR, factory)', barrel: '16.5" carbon steel, 1:15, 1/2x28', bcg: 'Blowback bolt assembly (factory)', ch: 'Factory', hg: 'Magpul MOE M-LOK (factory)', muzzle: 'A2-style flash hider (factory)', lower: 'Polymer lower (factory)', trigger: 'Factory single-stage', stock: '6-position stock (factory)', grip: 'Factory A2-style', mag: cat.findP('mag', 'M&P15-22 25-Round') },
    }),
  },
  { id: 'ak', name: 'AK-pattern rifle 16.3"', desc: '7.62x39 · railed dust cover', catalogBuild: false, make: ak },
  {
    id: 'akp', name: 'AK-pattern pistol 9mm (Draco-style)', desc: 'Glock-mag compatible', catalogBuild: false,
    make: (cat) => {
      const g = ak(cat)
      Object.assign(g, { name: 'AK-pattern pistol 11.14" 9mm (Draco-style)', short: 'AK-pattern pistol', caliber: '9mm', twist: '1:10' })
      g.cfg = { ...g.cfg, barrel: 11.14, stock: 'none', muzzle: null, muzzleStyle: 'cap', thread: '1/2x28', mag: 'glock33', magCap: 33, furn: 'wood', hgStyle: 'wood' }
      set(g, 'barrel', '11.14", 1/2x28'); set(g, 'muzzle', 'Thread protector (factory)'); set(g, 'stock', cat.findP('stock', 'None (pistol end cap)')); set(g, 'mag', cat.findP('mag', 'Glock OEM G17 33-Round')); set(g, 'hg', 'Wood handguard (factory)')
      return g
    },
  },
  {
    id: 'mp5', name: 'MP5-pattern 8.9" 9mm', desc: 'Roller-delayed PCC with brace', catalogBuild: false,
    make: (cat) => ({
      name: 'MP5-pattern 8.9" 9mm', short: 'Roller-delayed 9mm', type: 'rifle', platform: 'mp5', caliber: '9mm', twist: '1:10', spec: {},
      cfg: { barrel: 8.9, stock: 'brace', stockPos: 0, finish: 'black', furn: 'black', muzzle: cat.findP('muzzle', 'SilencerCo 3-Lug Muzzle Device'), thread: '1/2x28', mag: 'mp5_30', magCap: 30, hgStyle: 'slim' },
      parts: { upper: 'Stamped receiver + cocking tube', barrel: '8.9" 9mm, 3-lug + 1/2x28', bcg: 'Roller-delayed bolt + carrier', ch: cat.findP('ch', 'HKparts MP5'), hg: cat.findP('hg', 'Magpul SL Hand Guard'), muzzle: cat.findP('muzzle', 'SilencerCo 3-Lug Muzzle Device'), lower: 'Navy-style trigger pack', stock: cat.findP('stock', 'SB Tactical SBT5'), mag: cat.findP('mag', 'Elite Tactical Systems MP5') },
    }),
  },
  { id: 'g19', name: 'Glock 19 (Gen5 dimensions)', desc: 'Striker 9mm compact', catalogBuild: false, make: g19 },
  {
    id: 'mp9m', name: 'S&W PC M&P9 M2.0 Metal', desc: 'Striker 9mm full size', catalogBuild: false,
    make: (cat) => {
      const g = g19(cat)
      Object.assign(g, { name: 'S&W PC M&P9 M2.0 Metal', short: 'Factory complete pistol', fit: 'mp', spec: { overallLength: '7.4"' } })
      g.cfg = { ...g.cfg, barrel: 4.25, slide: 7.4, height: 5.5, metal: true, magCap: 17 }
      g.parts = { slide: 'Performance Center slide, optic-ready', pbarrel: '4.25" stainless, Armornite', psights: 'Factory', frame: 'Aluminum M2.0 Metal frame', ptrigger: 'PC flat-face trigger (factory)', mag: cat.findP('mag', 'M&P M2.0 Full Size 17') }
      return g
    },
  },
  {
    id: 'dagger', name: 'PSA Dagger Compact (threaded)', desc: 'Suppressor host', catalogBuild: false,
    make: (cat) => {
      const g = g19(cat)
      Object.assign(g, { name: 'PSA Dagger Compact (threaded)', short: 'Suppressor host', fit: 'dagger', spec: {} })
      g.cfg = { ...g.cfg, threaded: true, thread: '1/2x28', barrel: 4.5 }
      set(g, 'pbarrel', cat.findP('pbarrel', 'PSA Dagger Threaded')); set(g, 'slide', 'PSA Dagger slide (factory)'); set(g, 'frame', 'PSA Dagger frame')
      return g
    },
  },
  {
    id: 'sg', name: 'Semi-auto 12 ga 18.5"', desc: 'Tactical shotgun', catalogBuild: false,
    make: () => ({
      name: 'Semi-auto 12 ga 18.5"', short: 'Tactical shotgun', type: 'rifle', platform: 'shotgun', caliber: '12 ga', twist: 'smooth', spec: {},
      cfg: { barrel: 18.5, tube: 7, stock: 'fixed', finish: 'black', furn: 'black', muzzle: null, thread: 'none', magCap: 7 },
      parts: { lower: 'Aluminum receiver (factory)', barrel: '18.5" cylinder bore', bcg: 'Rotating bolt + carrier', sgtube: 'Extended magazine tube', hg: 'Polymer forend', trigger: 'Factory trigger group', stock: 'Factory stock' },
    }),
  },
]
