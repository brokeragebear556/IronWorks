import type { LogKind } from '../types'

export const LOG_KINDS: Record<LogKind, string> = { purchase: 'Purchase', rounds: 'Rounds fired', range: 'Range session', maintenance: 'Cleaning / maintenance', malfunction: 'Malfunction', part: 'Part change', nfa: 'NFA / paperwork', note: 'Note' }
export const CATEGORIES: Record<string, string> = { gun: 'Complete gun', lower: 'Lower', upper: 'Upper', part: 'Parts', optic: 'Optics', attachment: 'Attachments', ammo: 'Ammo', accessory: 'Accessories', service: 'Gunsmith / service', tax: 'Tax / fees', other: 'Other' }
