import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, useAction, useLogs, useSettings } from '../../api'
import { ConfirmButton } from '../../components/ConfirmButton'
import { LogDialog } from '../../components/dialogs'
import { CATEGORIES, LOG_KINDS } from '../../lib/labels'
import { count, money, shortDate, today } from '../../lib/format'
import { roundStats } from '../../lib/rounds'
import type { Gun, LogEntry, LogKind } from '../../types'

const KIND_PILL: Record<LogKind, string> = { purchase: 'brass', rounds: 'ok', range: 'ok', maintenance: '', malfunction: 'bad', part: 'planned', nfa: 'warn', note: '' }

/** Purchases, round counts, cleaning, malfunctions, part changes and paperwork for one gun. */
export function LogTab({ gun }: { gun: Gun }) {
  const { data: logs, isLoading, error } = useLogs(gun.id)
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{ entry: LogEntry | null } | null>(null)
  const [filter, setFilter] = useState<LogKind | 'all'>('all')
  const [ivText, setIvText] = useState<string | null>(null)
  const [ivErr, setIvErr] = useState<string | null>(null)
  const del = useAction(api.deleteLog, [['logs'], ['analytics']])
  const clean = useAction(() => api.addLog({ gun_id: gun.id, kind: 'maintenance', date: today(), title: 'Cleaned', amount: null, rounds: null, category: null, vendor: null, notes: '' }), [['logs'], ['analytics']])
  const list = (logs ?? []).filter((l) => filter === 'all' || l.kind === filter)
  const spent = (logs ?? []).reduce((s, l) => s + (l.kind === 'purchase' && l.amount ? l.amount : 0), 0)
  const st = roundStats(logs ?? [])
  const every = gun.cleanEvery || settings?.maintenanceRounds || 500
  const pct = Math.min(100, (st.since / every) * 100), due = st.since >= every
  const saveInterval = async () => {
    const t = (ivText ?? '').trim()
    setIvErr(null)
    const n = t === '' ? null : Math.round(Number(t))
    if (n != null && (!Number.isFinite(n) || n < 1)) { setIvErr('Enter a whole number of rounds.'); return }
    try { await api.patchGun(gun.id, { cleanEvery: n }); await Promise.all([qc.invalidateQueries({ queryKey: ['library'] }), qc.invalidateQueries({ queryKey: ['analytics'] })]); setIvText(null) }
    catch (e) { setIvErr(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <>
      <h3 className="section-title">Round count</h3>
      <div className="rows" style={{ marginBottom: 8 }}>
        <div className="rowi"><span className="k">Lifetime</span><span className="v num">{count(st.total)} rounds</span><span /></div>
        <div className="rowi"><span className="k">Since cleaning</span><span className="v num">{count(st.since)} rounds{st.lastClean ? <span className="note"> · last cleaned {shortDate(st.lastClean)}</span> : null}</span><span /></div>
        <div className="rowi"><span className="k">Malfunctions</span><span className="v num">{st.malf}</span><span /></div>
      </div>
      <div className={'meter' + (due ? ' due' : '')} role="meter" aria-valuemin={0} aria-valuemax={every} aria-valuenow={st.since} aria-label="Rounds since cleaning"><i style={{ width: `${pct}%` }} /></div>
      <div className="row-actions" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span className={due ? 'note' : 'note'} style={due ? { color: 'var(--warn)' } : undefined}>{due ? 'Cleaning due' : `${count(every - st.since)} rounds until cleaning`}</span>
        <span className="row-actions">
          <label className="note">Clean every
            <input className="input mini num" style={{ width: 80, marginLeft: 6 }} inputMode="numeric" value={ivText ?? String(gun.cleanEvery ?? '')} placeholder={String(settings?.maintenanceRounds ?? 500)}
              onChange={(e) => setIvText(e.target.value)} onBlur={() => ivText != null && saveInterval()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} aria-label="Rounds between cleanings" /> rounds
          </label>
          <button type="button" className="btn small" disabled={clean.isPending} onClick={() => clean.mutate(undefined)}>Log a cleaning today</button>
        </span>
      </div>
      {ivErr && <p className="error">{ivErr}</p>}

      <div className="row-actions" style={{ justifyContent: 'space-between', marginTop: 14 }}>
        <span className="note">Spent <b className="num" style={{ color: 'var(--ink)' }}>{money(spent)}</b></span>
        <button type="button" className="btn primary" onClick={() => setEditing({ entry: null })}>+ Add entry</button>
      </div>
      <div className="row-actions">
        <select className="input" style={{ maxWidth: 220 }} value={filter} onChange={(e) => setFilter(e.target.value as LogKind | 'all')} aria-label="Show">
          <option value="all">All entries</option>
          {Object.entries(LOG_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {isLoading && <p className="note">Loading…</p>}
      {error && <p className="error">{(error as Error).message}</p>}
      {!isLoading && list.length === 0 && <div className="empty">Nothing logged yet. Add purchases with receipts, round counts after the range, cleanings and NFA paperwork.</div>}
      {list.length > 0 && (
        <div className="rows">
          {list.map((l) => (
            <div key={l.id} className="rowi" style={{ gridTemplateColumns: '92px minmax(0,1fr) auto' }}>
              <span className="k">{shortDate(l.date)}</span>
              <span className="v">
                <span className={'pill ' + KIND_PILL[l.kind]}>{LOG_KINDS[l.kind]}</span>{' '}
                <b style={{ fontWeight: 600 }}>{l.title || (l.kind === 'rounds' ? 'Rounds fired' : '')}</b>
                <br />
                <span className="note">
                  {[l.amount != null && money(l.amount), l.rounds != null && `${count(l.rounds)} rounds`, l.category && CATEGORIES[l.category], l.vendor].filter(Boolean).join(' · ')}
                  {l.notes && <><br />{l.notes}</>}
                </span>
                {l.receipt && <><br /><a href={l.receipt} target="_blank" rel="noreferrer">View receipt</a></>}
              </span>
              <span className="row-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                <button type="button" className="btn small" onClick={() => setEditing({ entry: l })}>Edit</button>
                <ConfirmButton className="btn small danger" confirm="Delete" onConfirm={() => del.mutateAsync(l.id)}>Delete</ConfirmButton>
              </span>
            </div>
          ))}
        </div>
      )}
      <LogDialog gun={editing ? gun : null} entry={editing?.entry ?? null} onClose={() => setEditing(null)} />
    </>
  )
}
