// Short facts shown next to catalog items in the picker.
import { MOUNTSYS, PLATFORM_FAMILIES, type CatAcc, type CatPart } from './data'

const STYLE_NAMES: Record<string, string> = { cage: 'Birdcage', fh: 'Flash hider', comp: 'Comp', brake: 'Brake', cap: 'Thread cap', none: 'Bare' }
const ST_NAMES: Record<string, string> = { tube: 'Tube', box: 'Enclosed', mini: 'Micro', open: 'Open reflex', angled: 'Angled', vert: 'Vertical', offset: 'Offset' }

export function partChips(p: CatPart): string[] {
  const o: string[] = []
  if (PLATFORM_FAMILIES[p.pl]) o.push(PLATFORM_FAMILIES[p.pl])
  if (p.st && STYLE_NAMES[p.st]) o.push(STYLE_NAMES[p.st])
  if (p.th) o.push(p.th)
  if (p.fit) o.push('fits ' + p.fit)
  const c = p.c as Record<string, unknown> | undefined
  if (c?.barrel) o.push(`${c.barrel}"`)
  if (c?.gas) o.push(`${c.gas} gas`)
  if (c?.caliber) o.push(String(c.caliber))
  return o
}

export function accChips(a: CatAcc): string[] {
  const o: string[] = []
  if (a.len) o.push(`${a.len}" long`)
  if (a.h && ['reddot', 'holo', 'prism', 'magn', 'riser'].includes(a.k)) o.push(`${a.h}" height`)
  if (a.mag) o.push(`${a.mag}×`)
  if (a.lm) o.push(`${a.lm} lm`)
  if (a.bore) o.push(`${a.bore} bore`)
  if (a.dia) o.push(`⌀${a.dia}"`)
  if (a.mt && a.k === 'supp') o.push(MOUNTSYS[a.mt] ?? a.mt)
  if (a.fp) o.push(a.fp)
  if (a.st && ST_NAMES[a.st]) o.push(ST_NAMES[a.st])
  return o
}
