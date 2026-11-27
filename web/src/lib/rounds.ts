import type { LogEntry } from '../types'

/** Rounds fired, rounds since the last cleaning and malfunctions, from the log (oldest first). */
export function roundStats(logs: LogEntry[]) {
  let total = 0, since = 0, malf = 0
  let lastClean: string | null = null
  for (const l of [...logs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))) {
    if ((l.kind === 'rounds' || l.kind === 'range') && l.rounds) { total += l.rounds; since += l.rounds }
    if (l.kind === 'maintenance') { since = 0; lastClean = l.date }
    if (l.kind === 'malfunction') malf++
  }
  return { total, since, malf, lastClean }
}
