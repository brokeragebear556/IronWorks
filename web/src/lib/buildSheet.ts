import type { CheckItem, NfaClass } from '../three/engine/checks'
import { slotsFor } from '../three/engine/data'
import { fmtLen, fmtWt, type Specs, type Units } from '../three/engine/specs'
import type { Gun } from '../types'
import { money } from './format'

const LVL: Record<string, string> = { fail: 'FIX', check: 'CHECK', warn: 'CHECK', info: 'NOTE', ok: 'OK' }

/** A plain-text build sheet: summary, every part by slot, attachments, prices and checks. */
export function buildSheet(gun: Gun, specs: Specs | null, checks: CheckItem[] | null, cls: NfaClass | null, units: Units): string {
  const L = (v: number) => fmtLen(v, units)
  const out: string[] = []
  out.push(`${gun.name}${gun.short ? ` — ${gun.short}` : ''}`)
  const head = [gun.caliber, cls?.cls, specs && `OAL ${L(specs.oal)} as set`, specs && `barrel ${L(specs.barrel)}`, specs && `${specs.wtEstimated ? '≈' : ''}${fmtWt(specs.wtTotal, units)}`].filter(Boolean)
  if (head.length) out.push(head.join(' · '))
  out.push(`Status: ${gun.pricing.status === 'planned' ? 'planned' : 'owned'}`)
  if (gun.build?.length) {
    out.push('', 'BUILD')
    for (const [slot, label] of slotsFor(gun.platform, gun.rimfire)) {
      const r = gun.build.find((x) => x.slot === slot)
      if (!r?.name) continue
      const extra = r.source === 'upgrade' ? ` [added, ${r.status ?? 'planned'}${(r.price ?? r.listPrice) != null ? `, ${money(r.price ?? r.listPrice ?? 0)}` : ''}]` : r.source === 'part' ? ' [bought part]' : ''
      out.push(`${label}: ${r.name}${extra}${r.note ? ` (${r.note})` : ''}`)
    }
  }
  if (gun.parts.length) {
    out.push('', 'BOUGHT FOR THIS GUN')
    for (const p of gun.parts) out.push(`${p.name}${p.price != null ? ` — ${money(p.price)}` : p.listPrice != null ? ` — ${money(p.listPrice)}` : ''}`)
  }
  if (gun.attachments.length) {
    out.push('', 'ATTACHMENTS')
    for (const a of gun.attachments) {
      const line = gun.pricing.lines.find((l) => l.kind === 'attachment' && l.id === a.id)
      out.push(`${line?.label ?? a.name}${line?.price != null ? ` — ${money(line.price)}` : ''} [${a.status ?? gun.pricing.status}]`)
    }
  }
  out.push('', 'PRICE', `Owned ${money(gun.pricing.owned)} · Planned ${money(gun.pricing.planned)} · Total ${money(gun.pricing.total)}${gun.pricing.missing ? ` · ${gun.pricing.missing} without a price` : ''}`)
  if (checks?.length || gun.checks?.length) {
    out.push('', 'CHECKS')
    for (const c of checks ?? []) out.push(`[${LVL[c.lvl]}] ${c.text}`)
    for (const c of gun.checks ?? []) out.push(`[${LVL[c.level] ?? 'NOTE'}] ${c.text} (your note)`)
  }
  out.push('', `Made with Ironworks, ${new Date().toISOString().slice(0, 10)}`)
  return out.join('\n')
}
