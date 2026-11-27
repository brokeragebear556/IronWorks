import type { Catalog, ChOption, Item, TriggerOption } from '../../types'

export type TriggerChoice = TriggerOption & { id: string; installed: boolean }
export type ChChoice = ChOption & { id: string; installed: boolean }

export function triggerOptions(item: Item, catalog: Catalog): TriggerChoice[] {
  if (item.kind !== 'gun') return []
  const ids = item.gun.upgrades?.triggers ?? []
  return ids.filter((id) => catalog.triggers[id]).map((id, i) => ({ ...catalog.triggers[id], id, installed: i === 0 }))
}

export function chOptions(item: Item, catalog: Catalog): ChChoice[] {
  if (item.kind !== 'gun') return []
  const ids = item.gun.upgrades?.chargingHandles ?? []
  return ids.filter((id) => catalog.chargingHandles[id]).map((id, i) => ({ ...catalog.chargingHandles[id], id, installed: i === 0 }))
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
