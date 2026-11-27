import { fmtT } from '../three/engine/operate'
import type { OpCmd, OpView } from '../three/engine/stage'

const SPEEDS: [number, string][] = [[1, '1× real'], [0.5, '½×'], [0.25, '¼×'], [0.1, '0.1×'], [0.05, '0.05×'], [0.01, '0.01×'], [0.002, '0.002×']]

/** The Operate player: pick an action, then play, scrub or step through it. Fire plays the real
 *  cycle (a few milliseconds) slowed to 0.01× by default. */
export function OperateDock({ view, send }: { view: OpView | null; send: (c: OpCmd) => void }) {
  if (!view) return null
  const p = view.plan
  const cur = p ? p.ev.filter((e) => view.t >= e[0]).length - 1 : -1
  return (
    <div className="op-dock" role="region" aria-label="Operate">
      <div className="op-acts">
        {view.actions.map((a) => (
          <button key={a.key} type="button" className="btn small" aria-pressed={a.active} disabled={!!a.why} title={a.why ?? undefined} onClick={() => send({ type: 'act', act: a.key })}>{a.label}</button>
        ))}
        <button type="button" className="btn small ghost" title="Full magazine, round chambered, safety off" onClick={() => send({ type: 'reset' })}>Reset gun</button>
      </div>
      <div className="op-row">
        <button type="button" className="btn small" aria-label="Play backward" aria-pressed={view.playing && view.dir < 0} disabled={!p} onClick={() => send({ type: 'rev' })}>◀</button>
        <button type="button" className="btn small" aria-label={view.playing ? 'Pause' : 'Play'} aria-pressed={view.playing && view.dir > 0} disabled={!p} onClick={() => send({ type: 'toggle' })}>{view.playing ? '❚❚' : '▶'}</button>
        <button type="button" className="btn small" aria-label="Step back" disabled={!p} onClick={() => send({ type: 'step', dir: -1 })}>‹</button>
        <button type="button" className="btn small" aria-label="Step forward" disabled={!p} onClick={() => send({ type: 'step', dir: 1 })}>›</button>
        <div className="op-track">
          {p && <div className="op-marks">{p.ev.map((e, i) => <i key={i} style={{ left: `${(e[0] / p.dur) * 100}%` }} title={e[1]} />)}</div>}
          <input type="range" min={0} max={1} step={0.0001} value={p ? view.t / p.dur : 0} disabled={!p} aria-label="Timeline"
            onChange={(e) => p && send({ type: 'seek', t: Number(e.target.value) * p.dur })} />
        </div>
        <span className="mono op-time">{p ? `${fmtT(view.t, p.dur)} / ${fmtT(p.dur, p.dur)}` : '—'}</span>
        <select className="input mini" aria-label="Playback speed" value={String(view.speed)} onChange={(e) => send({ type: 'speed', v: Number(e.target.value) })}>
          {SPEEDS.map(([v, n]) => <option key={v} value={String(v)}>{n}</option>)}
          {!SPEEDS.some(([v]) => v === view.speed) && <option value={String(view.speed)}>{view.speed}×</option>}
        </select>
        <button type="button" className="btn small" aria-label="Loop" aria-pressed={view.loop} onClick={() => send({ type: 'loop' })}>⟲</button>
      </div>
      <div className="op-events">
        {p ? p.ev.map((e, i) => (
          <button key={i} type="button" className={'op-ev' + (i === cur ? ' on' : '')} onClick={() => send({ type: 'seek', t: e[0] })}>{fmtT(e[0], p.dur)} · {e[1]}</button>
        )) : <span className="note">Pick an action above. Fire plays the full cycle at 0.01× speed.</span>}
      </div>
      <div className="op-status">
        <b>{view.phase}</b>
        <span className="pill">{view.mag}</span>
        <span className="pill">Chamber: {view.chamber ? 'loaded' : 'empty'}</span>
        <span className="pill">Safety: {view.safety}</span>
        {p && <span className="pill">{p.dur < 200 ? `Real cycle ${p.dur.toFixed(1)} ms` : 'Human-paced'}</span>}
      </div>
    </div>
  )
}
