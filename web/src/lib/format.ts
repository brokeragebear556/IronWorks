import type { Gun, Item, View } from '../types'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const money = (n: number | null | undefined, whole = false) => (n == null ? '—' : (whole ? usd0 : usd).format(n))
export const count = (n: number) => new Intl.NumberFormat('en-US').format(n)
export const today = () => new Date().toISOString().slice(0, 10)
export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function findItem(guns: Gun[], key: string | undefined): Item | null {
  if (!key) return null
  const [gunId, partId] = key.split('/')
  const gun = guns.find((g) => g.id === gunId)
  if (!gun) return null
  if (!partId) return { kind: 'gun', key: gun.id, gun, data: gun }
  const part = gun.parts.find((p) => p.id === partId)
  return part ? { kind: 'part', key, gun, data: part, partId } : null
}

export function viewName(gun: Gun, v: View) {
  if (v === 'full') return 'Full gun'
  return gun.views?.[v] ?? (v === 'lower' ? 'Lower' : 'Upper')
}

/** The first photo that represents a gun on its library card. */
export function coverPhoto(gun: Gun): string | null {
  const all = [...gun.photos.full, ...gun.photos.upper, ...gun.photos.lower]
  if (gun.coverPhoto && all.includes(gun.coverPhoto)) return gun.coverPhoto
  return all[0] ?? null
}

export const SPEC_LABELS: Record<string, string> = {
  brand: 'Brand', sku: 'SKU', mpn: 'MPN', upc: 'UPC', model: 'Model', platform: 'Platform', caliber: 'Caliber',
  barrelLength: 'Barrel length', barrel: 'Barrel', twist: 'Twist', gasSystem: 'Gas system', gasBlock: 'Gas block',
  muzzle: 'Muzzle', thread: 'Thread', handguard: 'Handguard', bcg: 'Bolt carrier', chargingHandle: 'Charging handle',
  trigger: 'Trigger', safety: 'Safety', stock: 'Stock', grip: 'Grip', bufferTube: 'Buffer tube', buffer: 'Buffer',
  bufferSpring: 'Buffer spring', finish: 'Finish', material: 'Material', capacity: 'Capacity', weight: 'Weight',
  overallLength: 'Overall length', manufacturer: 'Manufacturer', height: 'Height', muzzleVelocity: 'Muzzle velocity',
  rateOfFire: 'Rate of fire', countryOfOrigin: 'Country of origin', introduced: 'Introduced', sights: 'Sights', action: 'Action', listPrice: 'List price', listPriceDate: 'List price checked',
}
export const specLabel = (k: string) => SPEC_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
