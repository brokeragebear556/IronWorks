import { usePref } from '../lib/prefs'
import { RADAR, STAT_HELP, STAT_LABELS, toFive, type GunStats, type StatKey } from '../three/engine/stats'

const BARS: StatKey[] = ['damage', 'fireRate', 'range', 'accuracy', 'control', 'mobility', 'handling']

/** Ratings for the build, as a 5-point radar chart or as game-style stat bars, compared with the
 *  gun's factory setup. */
export function StatsCard({ stats }: { stats: GunStats | null }) {
  const [view, setView] = usePref<'chart' | 'bars'>('stats-view', 'chart')
  if (!stats) return <p className="note">Working out the stats…</p>
  const changed = BARS.some((k) => stats.now.values[k] !== stats.factory.values[k])
  return (
    <div className="stats-card">
      <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Stats</h3>
        <div className="seg" role="group" aria-label="Stats view">
          <button type="button" className="btn small" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
          <button type="button" className="btn small" aria-pressed={view === 'bars'} onClick={() => setView('bars')}>Stat bars</button>
        </div>
      </div>
      {view === 'chart' ? <Radar stats={stats} changed={changed} /> : <Bars stats={stats} />}
      <p className="note" style={{ marginTop: 8 }}>
        Game-style ratings worked out from the build (caliber, barrel, weight, balance, trigger, muzzle device, optics and grips) to compare setups.
        They aren't ballistic measurements.{changed ? ' Compared with the factory setup: factory parts and no attachments.' : ''}
      </p>
    </div>
  )
}

/** Five axes on a 1–5 scale. Rings mark each whole point. */
function Radar({ stats, changed }: { stats: GunStats; changed: boolean }) {
  const W = 320, H = 290, cx = W / 2, cy = 150, R = 100
  const n = RADAR.length
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i: number, five: number) => {
    const r = ((five - 0) / 5) * R
    return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))] as const
  }
  const poly = (vals: Record<StatKey, number>) => RADAR.map((k, i) => pt(i, toFive(vals[k])).join(',')).join(' ')
  return (
    <figure className="radar" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stats on a 1 to 5 scale: ${RADAR.map((k) => `${STAT_LABELS[k]} ${toFive(stats.now.values[k])}`).join(', ')}`}>
        {[1, 2, 3, 4, 5].map((ring) => (
          <polygon key={ring} points={RADAR.map((_, i) => pt(i, ring).join(',')).join(' ')} className="radar-ring" />
        ))}
        {RADAR.map((_, i) => { const [x, y] = pt(i, 5); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="radar-spoke" /> })}
        {[1, 3, 5].map((ring) => { const [x, y] = pt(0, ring); return <text key={ring} x={x + 4} y={y + 3} className="radar-tick">{ring}</text> })}
        {changed && <polygon points={poly(stats.factory.values)} className="radar-base" />}
        <polygon points={poly(stats.now.values)} className="radar-now" />
        {RADAR.map((k, i) => {
          const v = toFive(stats.now.values[k]), [x, y] = pt(i, v)
          const [lx, ly] = pt(i, 6.05)
          const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end'
          return (
            <g key={k}>
              {/* larger invisible hit target for the hover tooltip */}
              <circle cx={x} cy={y} r={12} fill="transparent"><title>{`${STAT_LABELS[k]}: ${v} of 5${changed ? ` (factory ${toFive(stats.factory.values[k])})` : ''}. ${STAT_HELP[k]}`}</title></circle>
              <circle cx={x} cy={y} r={4} className="radar-dot" pointerEvents="none" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="radar-label">
                {STAT_LABELS[k]} <tspan className="radar-val">{v.toFixed(1)}</tspan>
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="stat-legend">
        <span><i className="sw now" />This build</span>
        {changed && <span><i className="sw base" />Factory setup</span>}
        <span className="note">Scale 1–5</span>
      </figcaption>
    </figure>
  )
}

/** Game-style stat window: a bar per stat out of 100, with the change from factory. */
function Bars({ stats }: { stats: GunStats }) {
  return (
    <div className="stat-bars" role="table" aria-label="Stats out of 100">
      {BARS.map((k) => {
        const v = stats.now.values[k], b = stats.factory.values[k], d = v - b
        return (
          <div key={k} className="stat-row" role="row" title={STAT_HELP[k]}>
            <span className="stat-name" role="rowheader">{STAT_LABELS[k]}</span>
            <span className="stat-track" role="cell" aria-label={`${v} out of 100${d ? `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} from factory` : ''}`}>
              <span className="stat-fill" style={{ width: `${Math.min(v, b)}%` }} />
              {d > 0 && <span className="stat-gain" style={{ left: `${b}%`, width: `${d}%` }} />}
              {d < 0 && <span className="stat-loss" style={{ left: `${v}%`, width: `${-d}%` }} />}
              {[20, 40, 60, 80].map((t) => <i key={t} className="stat-tick" style={{ left: `${t}%` }} />)}
            </span>
            <span className="stat-num num" role="cell">{v}</span>
            <span className={'stat-delta num' + (d > 0 ? ' up' : d < 0 ? ' down' : '')} role="cell">{d > 0 ? `▲ +${d}` : d < 0 ? `▼ ${d}` : ''}</span>
          </div>
        )
      })}
      <div className="stat-row" role="row">
        <span className="stat-name" role="rowheader">Magazine</span>
        <span role="cell" className="note">{stats.now.capacity} rounds</span>
        <span role="cell" /><span role="cell" />
      </div>
    </div>
  )
}
