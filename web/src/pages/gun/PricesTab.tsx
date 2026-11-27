import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useAction, useTracked } from '../../api'
import { ConfirmButton } from '../../components/ConfirmButton'
import { TrackDialog } from '../../components/dialogs'
import { money, shortDate } from '../../lib/format'
import type { Item, Tracked } from '../../types'
import { errMsg } from './shared'

export function PriceChart({ t }: { t: Tracked }) {
  const { data } = useQuery({ queryKey: ['history', t.id, t.last_checked], queryFn: () => api.priceHistory(t.id) })
  const points = (data ?? []).filter((p) => p.price != null).map((p) => ({ date: p.checked_at.slice(0, 10), price: p.price }))
  if (points.length < 2) return <p className="note">{points.length === 1 ? `One check so far: ${money(points[0].price)}. The chart appears after the next check.` : 'No prices recorded yet.'}</p>
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#2a2e35" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#9097a1', fontSize: 11 }} stroke="#2a2e35" />
          <YAxis tick={{ fill: '#9097a1', fontSize: 11 }} stroke="#2a2e35" width={56} tickFormatter={(v: number) => money(v, true)} domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#171a1e', border: '1px solid #2a2e35', borderRadius: 6 }} formatter={(v) => money(Number(v))} />
          {t.target_price != null && <ReferenceLine y={t.target_price} stroke="#7fbf8a" strokeDasharray="4 4" label={{ value: 'alert', fill: '#7fbf8a', fontSize: 11, position: 'insideTopRight' }} />}
          <Line type="stepAfter" dataKey="price" stroke="#d9a441" strokeWidth={2} dot={{ r: 2.5, fill: '#d9a441' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TrackedCard({ t }: { t: Tracked }) {
  const [msg, setMsg] = useState<string | null>(null)
  const check = useAction(() => api.checkTracked(t.id), [['tracked'], ['analytics']])
  const del = useAction(() => api.deleteTracked(t.id), [['tracked'], ['analytics']])
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <b>{t.label}</b>
        {t.belowTarget && <span className="pill ok">At or below your alert price</span>}
      </div>
      <a href={t.url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{t.url}</a>
      <div className="row-actions note">
        <span>Latest <b className="num" style={{ color: 'var(--ink)' }}>{t.latest ? money(t.latest.price) : '—'}</b></span>
        <span>Lowest <b className="num" style={{ color: 'var(--ink)' }}>{money(t.lowest)}</b></span>
        <span>Alert {money(t.target_price)}</span>
        {t.latest?.in_stock != null && <span className={'pill ' + (t.latest.in_stock ? 'ok' : 'warn')}>{t.latest.in_stock ? 'In stock' : 'Out of stock'}</span>}
      </div>
      <PriceChart t={t} />
      <div className="row-actions">
        <span className="note">Last checked {shortDate(t.last_checked)}</span>
        {t.last_error && <span className="pill bad" title={t.last_error}>Last check failed</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn small" disabled={check.isPending} onClick={async () => {
          setMsg(null)
          try { const r = await check.mutateAsync(undefined); setMsg(r.ok ? `Now ${money(r.price ?? null)}` : r.error ?? 'Check failed') } catch (e) { setMsg(errMsg(e)) }
        }}>{check.isPending ? 'Checking…' : 'Check now'}</button>
        <ConfirmButton className="btn small danger" confirm="Stop tracking" onConfirm={() => del.mutateAsync(undefined)}>Remove</ConfirmButton>
      </div>
      {msg && <p className="note">{msg}</p>}
      {t.last_error && <p className="error">{t.last_error}</p>}
    </div>
  )
}

export function PricesTab({ item }: { item: Item }) {
  const { data: tracked } = useTracked()
  const [open, setOpen] = useState(false)
  const mine = (tracked ?? []).filter((t) => t.item_key === item.key)
  const firstUrl = item.data.links?.[0]?.url ?? ''
  return (
    <>
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <span className="note">Tracked pages are re-checked automatically. Set the schedule in Settings.</span>
        <button type="button" className="btn primary" onClick={() => setOpen(true)}>+ Track a price</button>
      </div>
      {mine.length === 0 && <div className="empty">Not tracking any prices for this yet. Track the product page of something you own (to follow its value) or want (to get an alert).</div>}
      {mine.map((t) => <TrackedCard key={t.id} t={t} />)}
      <TrackDialog open={open} itemKey={item.key} defaultLabel={item.data.name} defaultUrl={firstUrl} onClose={() => setOpen(false)} />
    </>
  )
}
