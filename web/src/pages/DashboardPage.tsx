import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useAction, useAnalytics, useLibrary } from '../api'
import { ConfirmButton } from '../components/ConfirmButton'
import { count, money, shortDate } from '../lib/format'
import { TrackedCard } from './gun/PricesTab'

const SERIES = ['#d9a441', '#6fa8dc', '#7fbf8a', '#c27ba0', '#e07a6a', '#9aa0a7', '#b5a06b', '#5fb3b3']
const axis = { tick: { fill: '#9097a1', fontSize: 11 }, stroke: '#2a2e35' }
const tip = { contentStyle: { background: '#171a1e', border: '1px solid #2a2e35', borderRadius: 6, color: '#e6e8eb' }, itemStyle: { color: '#e6e8eb' } }

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="card kpi"><div className="l">{label}</div><div className="v">{value}</div>{detail && <div className="d">{detail}</div>}</div>
}

/** Collection analytics: money, usage, price tracking and an overview. */
export function DashboardPage() {
  const { data: a, isLoading, error } = useAnalytics()
  const { data: lib } = useLibrary()
  const togglePlan = useAction((p: { id: number; done: boolean }) => api.patchPlan(p.id, p.done), [['analytics'], ['plans']])
  const delPlan = useAction(api.deletePlan, [['analytics'], ['plans']])
  if (isLoading) return <div className="page-pad note">Loading…</div>
  if (error || !a) return <div className="page-pad error">{(error as Error)?.message ?? 'Could not load analytics.'}</div>
  const gunName = (id: string) => lib?.guns.find((g) => g.id === id)?.name ?? id
  const m = a.money, u = a.usage, o = a.overview, c = a.cost
  const gain = m.totalValue != null && m.spentOnValued != null ? m.totalValue - m.spentOnValued : null
  const gunNames = Object.keys(Object.assign({}, ...u.byMonth.map(({ month: _m, ...rest }) => rest)))
  const noMoney = m.totalSpent === 0, noRounds = u.totalRounds === 0

  return (
    <div className="page-pad">
      <div className="page-head">
        <div><h1>Dashboard</h1><p>Built from your log entries, saved values and price tracking.</p></div>
      </div>

      <div className="kpis">
        <Kpi label="Collection (owned)" value={money(c.owned, true)} detail={`${c.ownedGuns} owned gun${c.ownedGuns === 1 ? '' : 's'}, with parts and attachments`} />
        <Kpi label="Planned purchases" value={money(c.planned, true)} detail={`${c.plannedItems.length} item${c.plannedItems.length === 1 ? '' : 's'}${c.plannedGuns ? `, incl. ${c.plannedGuns} gun${c.plannedGuns > 1 ? 's' : ''}` : ''}`} />
        <Kpi label="Owned + planned" value={money(c.total, true)} detail={c.missingPrices ? `${c.missingPrices} item(s) still without a price` : 'Every item has a price'} />
        <Kpi label="Total spent" value={money(m.totalSpent, true)} detail={noMoney ? 'Add purchases in each gun\'s Log tab' : `${m.byCategory.length} categories`} />
        <Kpi label="Current value" value={m.totalValue != null ? money(m.totalValue, true) : '—'} detail={gain != null ? `${gain >= 0 ? '+' : ''}${money(gain, true)} vs. paid for those guns` : 'Set values in each gun\'s Overview'} />
        <Kpi label="Rounds fired" value={count(u.totalRounds)} detail={`${u.byGun.filter((g) => g.cleaningDue).length} gun(s) due for cleaning`} />
        <Kpi label="Planned upgrades" value={money(o.plannedCost, true)} detail={`${o.plans.filter((p) => !p.done).length} open`} />
        <Kpi label="Price alerts" value={String(a.prices.alerts.length)} detail={`${a.prices.tracked.length} pages tracked`} />
        <Kpi label="Collection" value={`${o.guns} guns`} detail={`${o.parts} parts · ${o.attachments} attachments`} />
      </div>

      <div className="dash-grid">
        <section className="card card-pad wide">
          <h2 className="section-title">What each gun costs <span>gun + parts + attachments, from your prices and saved pages</span></h2>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Gun</th><th>Status</th><th className="r">Gun</th><th className="r">Parts</th><th className="r">Attachments</th><th className="r">Owned</th><th className="r">Planned</th><th className="r">Total</th></tr></thead>
            <tbody>
              {c.byGun.map((g) => (
                <tr key={g.id}>
                  <td><Link to={`/gun/${g.id}`}>{g.name}</Link>{g.missing > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>{g.missing} unpriced</span>}</td>
                  <td><span className={'pill ' + (g.status === 'planned' ? 'planned' : 'ok')}>{g.status === 'planned' ? 'Planned' : 'Owned'}</span></td>
                  <td className="r">{money(g.gun)}</td><td className="r">{money(g.parts)}</td><td className="r">{money(g.attachments)}</td>
                  <td className="r">{money(g.owned)}</td><td className="r">{money(g.planned)}</td><td className="r"><b>{money(g.total)}</b></td>
                </tr>
              ))}
              <tr>
                <td><b>Collection</b></td><td />
                <td className="r">{money(c.byGun.reduce((s, g) => s + g.gun, 0))}</td>
                <td className="r">{money(c.byGun.reduce((s, g) => s + g.parts, 0))}</td>
                <td className="r">{money(c.byGun.reduce((s, g) => s + g.attachments, 0))}</td>
                <td className="r"><b>{money(c.owned)}</b></td><td className="r"><b>{money(c.planned)}</b></td><td className="r"><b>{money(c.total)}</b></td>
              </tr>
            </tbody>
          </table></div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Owned vs planned per gun</h2>
          <div className="chart-box"><ResponsiveContainer>
            <BarChart data={c.byGun} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke="#2a2e35" horizontal={false} />
              <XAxis type="number" {...axis} tickFormatter={(v: number) => money(v, true)} />
              <YAxis type="category" dataKey="name" {...axis} width={150} />
              <Tooltip {...tip} formatter={(v) => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="owned" name="Owned" stackId="c" fill="#7fbf8a" />
              <Bar dataKey="planned" name="Planned" stackId="c" fill="#6fa8dc" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer></div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Planned purchases <span>{money(c.planned)}</span></h2>
          {c.plannedItems.length === 0 ? <p className="note">Nothing marked as planned. Set a gun, part or attachment to Planned in its Overview tab.</p> : (
            <div className="rows">{c.plannedItems.map((p, i) => (
              <Link key={i} className="rowi" to={`/gun/${p.gunId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="k">{p.kind === 'base' || p.kind === 'component' ? 'Gun' : p.kind === 'part' ? 'Part' : 'Attachment'}</span>
                <span className="v">{p.label}<br /><span className="note">{p.gun}</span></span>
                <span className="num">{money(p.price)}</span>
              </Link>
            ))}</div>
          )}
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Spent per gun</h2>
          {noMoney ? <p className="note">No purchases logged yet.</p> : (
            <div className="chart-box"><ResponsiveContainer>
              <BarChart data={m.byGun.filter((g) => g.spent || g.value)} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke="#2a2e35" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={(v: number) => money(v, true)} />
                <YAxis type="category" dataKey="name" {...axis} width={150} tick={{ ...axis.tick, width: 150 }} />
                <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="spent" name="Spent" fill="#d9a441" radius={[0, 3, 3, 0]} />
                <Bar dataKey="value" name="Value" fill="#6fa8dc" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          )}
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Spent by category</h2>
          {noMoney ? <p className="note">No purchases logged yet.</p> : (
            <div className="chart-box"><ResponsiveContainer>
              <PieChart>
                <Pie data={m.byCategory} dataKey="amount" nameKey="category" innerRadius="52%" outerRadius="80%" paddingAngle={2} stroke="none">
                  {m.byCategory.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                </Pie>
                <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer></div>
          )}
        </section>

        <section className="card card-pad wide">
          <h2 className="section-title">Spending over time</h2>
          {noMoney ? <p className="note">No purchases logged yet.</p> : (
            <div className="chart-box"><ResponsiveContainer>
              <BarChart data={m.byMonth}>
                <CartesianGrid stroke="#2a2e35" vertical={false} />
                <XAxis dataKey="month" {...axis} />
                <YAxis {...axis} tickFormatter={(v: number) => money(v, true)} width={64} />
                <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                <Bar dataKey="amount" name="Spent" fill="#d9a441" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          )}
        </section>

        <section className="card card-pad wide">
          <h2 className="section-title">Rounds per month</h2>
          {noRounds ? <p className="note">No rounds logged yet. Add a range session or rounds fired in a gun's Log tab.</p> : (
            <div className="chart-box"><ResponsiveContainer>
              <BarChart data={u.byMonth}>
                <CartesianGrid stroke="#2a2e35" vertical={false} />
                <XAxis dataKey="month" {...axis} />
                <YAxis {...axis} width={48} />
                <Tooltip {...tip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {gunNames.map((n, i) => <Bar key={n} dataKey={n} stackId="r" fill={SERIES[i % SERIES.length]} />)}
              </BarChart>
            </ResponsiveContainer></div>
          )}
        </section>

        <section className="card card-pad wide">
          <h2 className="section-title">Usage and maintenance <span>clean every {count(u.maintenanceRounds)} rounds</span></h2>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Gun</th><th className="r">Rounds</th><th className="r">Since cleaning</th><th>Last used</th><th>Last cleaned</th><th /></tr></thead>
            <tbody>{u.byGun.map((g) => (
              <tr key={g.id}>
                <td><Link to={`/gun/${g.id}?tab=log`}>{g.name}</Link></td>
                <td className="r">{count(g.rounds)}</td><td className="r">{count(g.sinceCleaning)}</td>
                <td>{shortDate(g.lastUsed)}</td><td>{shortDate(g.lastCleaned)}</td>
                <td>{g.cleaningDue ? <span className="pill warn">Cleaning due</span> : g.rounds ? <span className="pill ok">OK</span> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Upgrade plan <span>{money(o.plannedCost)} open</span></h2>
          {o.plans.length === 0 ? <p className="note">Nothing planned. Preview a trigger or charging handle on a gun and choose "Add to upgrade plan".</p> : (
            <div className="rows">{o.plans.map((p) => (
              <div className="rowi" key={p.id} style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
                <input type="checkbox" checked={!!p.done} onChange={(e) => togglePlan.mutate({ id: p.id, done: e.target.checked })} aria-label={`Done: ${p.label}`} />
                <span className="v" style={p.done ? { textDecoration: 'line-through', color: 'var(--mute)' } : undefined}>{p.label}<br /><span className="note">{gunName(p.gun_id)} · {money(p.est_cost)}</span></span>
                <ConfirmButton className="btn small danger" confirm="Remove" onConfirm={() => delPlan.mutateAsync(p.id)}>Remove</ConfirmButton>
              </div>
            ))}</div>
          )}
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Collection overview</h2>
          {[['Platform', o.byPlatform], ['Caliber', o.byCaliber], ['Maker', o.byMaker]].map(([title, rows]) => (
            <div key={title as string} style={{ marginBottom: 10 }}>
              <div className="note" style={{ marginBottom: 4 }}>{title as string}</div>
              <div className="row-actions">{(rows as { label: string; count: number }[]).map((r) => <span key={r.label} className="pill">{r.label} · {r.count}</span>)}</div>
            </div>
          ))}
          <p className="note">Caliber and maker come from each gun's specs. Fill them with the Metadata tab.</p>
        </section>

        <section className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="section-title">Price tracking <span>{a.prices.alerts.length} at or below alert price</span></h2>
          {a.prices.tracked.length === 0 ? <div className="empty">No pages tracked yet. Open a gun or part, go to Prices and track its product page.</div>
            : <div className="dash-grid">{a.prices.tracked.map((t) => <TrackedCard key={t.id} t={t} />)}</div>}
        </section>
      </div>
    </div>
  )
}
