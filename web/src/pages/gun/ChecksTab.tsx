import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api'
import { ConfirmButton } from '../../components/ConfirmButton'
import type { CheckItem, Level } from '../../three/engine/checks'
import type { Check, Gun } from '../../types'
import { errMsg } from './shared'

const LVL: Record<Level | 'warn', [string, string]> = { fail: ['FIX', 'bad'], check: ['CHECK', 'warn'], warn: ['CHECK', 'warn'], info: ['NOTE', ''], ok: ['OK', 'ok'] }

/** Automatic fit and legal checks for the build as configured, plus your own notes and verifications. */
export function ChecksTab({ gun, auto }: { gun: Gun; auto: CheckItem[] | null }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [level, setLevel] = useState<Check['level']>('check')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const mine = gun.checks ?? []
  const save = async (checks: Check[]) => {
    setErr(null); setBusy(true)
    try { await api.patchGun(gun.id, { checks }); await qc.invalidateQueries({ queryKey: ['library'] }); return true }
    catch (e) { setErr(errMsg(e)); return false }
    finally { setBusy(false) }
  }
  const counts = auto ? (['fail', 'check', 'info', 'ok'] as Level[]).map((l) => [l, auto.filter((c) => c.lvl === l).length] as const).filter(([, n]) => n) : []

  return (
    <>
      <h3 className="section-title">Automatic checks <span>{counts.map(([l, n]) => `${n} ${LVL[l][0].toLowerCase()}`).join(' · ') || 'recomputed as you change the build'}</span></h3>
      {!auto ? <p className="note">Waiting for the model…</p> : auto.length === 0 ? <div className="empty">Nothing to flag.</div> : (
        <div className="chk-list">
          {auto.map((c, i) => (
            <div key={i} className="chk">
              <span className={'pill ' + LVL[c.lvl][1]}>{LVL[c.lvl][0]}</span>
              <div>{c.text}{c.why && <small>{c.why}</small>}</div>
            </div>
          ))}
        </div>
      )}
      <p className="note" style={{ marginTop: 6 }}>Federal rules only, as guidance. State and local laws vary and change; check them before you build or buy.</p>

      <h3 className="section-title" style={{ marginTop: 16 }}>Your notes and verifications <span>{mine.length || ''}</span></h3>
      {mine.length > 0 && (
        <div className="chk-list">
          {mine.map((c, i) => (
            <div key={i} className="chk">
              <select className="input mini" aria-label="Level" value={c.level === 'warn' ? 'check' : c.level} disabled={busy}
                onChange={(e) => save(mine.map((x, j) => (j === i ? { ...x, level: e.target.value as Check['level'] } : x)))}>
                <option value="ok">OK</option><option value="check">Check</option><option value="fail">Fix</option><option value="info">Note</option>
              </select>
              <div>{c.text}</div>
              <ConfirmButton className="btn small ghost" confirm="Delete" onConfirm={() => save(mine.filter((_, j) => j !== i))}>Delete</ConfirmButton>
            </div>
          ))}
        </div>
      )}
      <form className="row-actions" style={{ marginTop: 8, alignItems: 'flex-end' }} onSubmit={async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        if (await save([...mine, { level, text: text.trim() }])) setText('')
      }}>
        <label className="field" style={{ flex: 1 }}>Add a note<input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Confirmed the trigger pin size is .154&quot;" /></label>
        <select className="input mini" aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value as Check['level'])}>
          <option value="ok">OK</option><option value="check">Check</option><option value="fail">Fix</option><option value="info">Note</option>
        </select>
        <button type="submit" className="btn" disabled={busy || !text.trim()}>Add</button>
      </form>
      {err && <p className="error">{err}</p>}
    </>
  )
}
