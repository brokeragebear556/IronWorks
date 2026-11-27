// Shapes of the data the server returns. Mirrors gun.json and the SQLite tables.
import type { BuildRow, Cfg } from './three/engine/data'
export type { BuildRow, Cfg }

export type View = 'full' | 'lower' | 'upper'

export interface BomRow { part: string; label: string; value: string }
export interface BomSection { title: string; from?: string; rows: BomRow[] }
export interface Check { level: 'ok' | 'warn' | 'check' | 'fail' | 'info'; text: string }
export interface Link { url: string; label?: string }

export type Status = 'owned' | 'planned'

export interface Attachment {
  id: string
  type: string
  name: string
  details?: string
  position?: 'rear' | 'middle' | 'front'
  side?: 'right' | 'left' | 'top' | 'bottom'
  color?: string
  price?: number | null
  status?: Status
  /** Accessory id in the parts catalog, when picked from it. */
  cid?: string | null
  /** Exact placement, set in the build editor: inches from the chamber, and clock position for side-mounted lights. */
  pos?: number | null
  clock?: number | null
  /** Optical centreline over the rail (in), for red dots and magnifiers without a catalog mount. */
  h?: number | null
  mount?: string | null
  ad?: string | null
  sub?: string | null
  /** suppressors: serial and Form 4 */
  serial?: string | null
  nfa?: NfaRecord | null
}

export interface Component { name: string; price?: number | null; listPrice?: number; status?: Status; source?: string }

export interface PriceLine {
  kind: 'base' | 'component' | 'part' | 'upgrade' | 'attachment'
  id: string
  label: string
  price: number | null
  priceSource: 'set' | 'list' | 'catalog' | 'none'
  status: Status
}
export interface Pricing { status: Status; lines: PriceLine[]; owned: number; planned: number; total: number; missing: number }

export interface ModelDef {
  kind: 'rifle' | 'pistol' | 'bcg' | 'chargingHandle'
  [key: string]: unknown
}

export interface Specs { [key: string]: string | number | undefined }

export interface Part {
  id: string
  name: string
  short?: string
  order?: number
  sources?: string[]
  model?: ModelDef | null
  bom?: Record<string, BomSection>
  checks?: Check[]
  photos: string[]
  specs: Specs
  links: Link[]
  notes?: string
  status?: Status
  price?: number | null
  listPrice?: number
}

export interface Gun {
  id: string
  name: string
  short?: string
  order?: number
  type?: 'rifle' | 'pistol'
  platform?: string
  sources?: string[]
  children?: { name: string; short?: string; view?: View }[]
  views?: Partial<Record<View, string>>
  model?: ModelDef | null
  upgrades?: { triggers?: string[]; chargingHandles?: string[] }
  bom?: Record<string, BomSection>
  checks?: Check[]
  attachments: Attachment[]
  photos: Record<View, string[]>
  parts: Part[]
  specs: Specs
  links: Link[]
  notes?: string
  coverPhoto?: string
  status?: Status
  price?: number | null
  listPrice?: number
  components?: Component[]
  pricing: Pricing
  // the build: what the 3D model is drawn from, slot by slot
  caliber?: string
  twist?: string
  rimfire?: boolean
  fit?: string
  cfg?: Cfg
  build?: BuildRow[]
  records?: Records
  /** rounds between cleanings; the setting in Settings → General when not set */
  cleanEvery?: number | null
}

export interface NfaRecord { item?: string; status?: string; form?: string; ctl?: string; filed?: string; approved?: string }
/** Identity, acquisition and paperwork. Kept in gun.json on this computer only. */
export interface Records {
  mfr?: string; serial?: string; acquired?: string; source?: string; paid?: string; notes?: string
  scaleWeightLb?: number | null
  nfa?: NfaRecord | null
}

export interface Library { guns: Gun[]; errors: string[] }

export interface RefreshResult {
  key: string
  name: string
  sources: number
  price: number | null
  oldPrice: number | null
  priceFrom: string | null
  specsAdded: string[]
  errors: string[]
}

export interface TriggerOption { name: string; price?: string; cost?: number; color: string; hammer?: string; style: 'curved' | 'flat'; note?: string }
export interface ChOption { name: string; price?: string; cost?: number; model: string }
export interface AttachmentType { name: string; group: string; for: 'rifle' | 'pistol' | 'any'; example?: string; positions?: boolean; sides?: boolean }

export interface Catalog {
  triggers: Record<string, TriggerOption>
  triggerUpgrades: Record<string, string[]>
  chargingHandles: Record<string, ChOption>
  finishes: Record<string, string>
  muzzles: Record<string, string>
  attachments: Record<string, AttachmentType>
  attachmentFinishes: Record<string, string>
}

export interface Settings {
  scanFolder: string
  providers: { id: string; enabled: boolean }[]
  /** your email or web address, sent to Wikidata as its robot policy asks */
  wikidataContact?: string
  priceTracking: { enabled: boolean; intervalHours: number }
  maintenanceRounds: number
  units: 'in' | 'mm'
  /** other devices on your network (the password itself never comes back from the server) */
  network: { lan: boolean; hasPassword: boolean }
  experimental: { photoProjection: boolean }
}

export interface ProviderInfo { id: string; name: string; description: string; enabled: boolean }

export interface ProductData {
  name: string | null
  brand: string | null
  sku: string | null
  price: number | null
  currency: string | null
  inStock: boolean | null
  images: string[]
  specs: Record<string, string>
  specLines: [string, string][]
  url: string | null
}

export interface LookupResult {
  id: number
  provider: string
  source: string
  confidence: number
  fetchedAt: string
  data?: ProductData
  error?: string
}

export type LogKind = 'purchase' | 'rounds' | 'maintenance' | 'range' | 'nfa' | 'note' | 'malfunction' | 'part'
export interface LogEntry {
  id: number
  gun_id: string
  kind: LogKind
  date: string
  title: string
  amount: number | null
  rounds: number | null
  category: string | null
  vendor: string | null
  notes: string
  receipt: string | null
}

export interface Tracked {
  id: number
  item_key: string
  label: string
  url: string
  target_price: number | null
  enabled: number
  last_checked: string | null
  last_error: string | null
  latest: { price: number; currency: string; in_stock: number | null; checked_at: string } | null
  lowest: number | null
  belowTarget: boolean
}

export interface PricePoint { checked_at: string; price: number | null; currency: string | null; in_stock: number | null }

export interface Plan { id: number; gun_id: string; kind: string; option_id: string | null; label: string; est_cost: number | null; done: number; created_at: string }

export interface Analytics {
  money: {
    totalSpent: number
    totalValue: number | null
    spentOnValued: number | null
    byGun: { id: string; name: string; spent: number; value: number | null }[]
    byCategory: { category: string; amount: number }[]
    byMonth: { month: string; amount: number }[]
  }
  usage: {
    maintenanceRounds: number
    totalRounds: number
    byGun: { id: string; name: string; rounds: number; sinceCleaning: number; cleanEvery: number; cleaningDue: boolean; malfunctions: number; lastUsed: string | null; lastCleaned: string | null }[]
    byMonth: Record<string, number | string>[]
  }
  prices: { tracked: Tracked[]; alerts: Tracked[] }
  cost: {
    owned: number
    planned: number
    total: number
    ownedGuns: number
    plannedGuns: number
    missingPrices: number
    byGun: { id: string; name: string; status: Status; gun: number; parts: number; attachments: number; owned: number; planned: number; total: number; missing: number }[]
    plannedItems: { gunId: string; gun: string; label: string; kind: string; price: number | null }[]
  }
  overview: {
    guns: number
    parts: number
    attachments: number
    byPlatform: { label: string; count: number }[]
    byCaliber: { label: string; count: number }[]
    byMaker: { label: string; count: number }[]
    plans: Plan[]
    plannedCost: number
  }
}

/** A selectable thing in the library: a gun, or a part bought for a gun. */
export type Item =
  | { kind: 'gun'; key: string; gun: Gun; data: Gun }
  | { kind: 'part'; key: string; gun: Gun; data: Part; partId: string }
