import { StatsCard } from '../../components/StatsCard'
import { fmtLen, fmtWt, type Specs, type Units } from '../../three/engine/specs'
import type { GunStats } from '../../three/engine/stats'
import type { Gun } from '../../types'

/** Measurements taken from the 3D model as it's configured. They update as you change the build. */
export function SpecsTab({ gun, specs, units, stats }: { gun: Gun; specs: Specs | null; units: Units; stats: GunStats | null }) {
  if (!specs) return <p className="note">Measuring the model…</p>
  const L = (v: number) => fmtLen(v, units), W = (v: number) => fmtWt(v, units)
  const s = specs, c = gun.cfg ?? {}
  const rows: [string, string][] = [
    ['Caliber', gun.caliber ?? '—'],
    ['Twist', gun.twist || '—'],
    ['Barrel', L(s.barrel) + (s.pinned ? ` (${L(s.effBarrel)} with the pinned & welded device)` : '')],
    ['Overall length', L(s.oal)],
    ...(Math.abs(s.oalMax - s.oalMin) > 0.01 ? [['Collapsed / extended', `${L(s.oalMin)} / ${L(s.oalMax)}`] as [string, string]] : []),
    ...(s.oalSupp ? [['With suppressor', L(s.oalSupp)] as [string, string], ['Suppressor adds', L(s.oalSupp - s.oal)] as [string, string]] : []),
    ['Height as configured', L(s.height)],
    ['Width as configured', L(s.width)],
    ...(c.thread ? [['Muzzle thread', String(c.thread)] as [string, string]] : []),
    ...(s.railLen ? [['Top rail', `${L(s.railLen)} · ${s.railSlots} slots`] as [string, string]] : []),
    ...(s.sightHeight ? [['Rail height over the bore', L(s.sightHeight)] as [string, string]] : []),
    ...(s.stockName ? [['Stock', s.stockName] as [string, string]] : []),
    ...(s.travel ? [['Bolt / slide travel', L(s.travel)] as [string, string]] : []),
    ...(s.action ? [['Action', s.action] as [string, string]] : []),
    ['Weight, unloaded', `${s.wtEstimated ? '≈ ' : ''}${W(s.wtBase)} (${s.wtSource === 'scale' ? 'your scale weight' : s.wtSource === 'listing' ? 'from the listing' : 'estimate for this kind of gun; add your scale weight in Records'})`],
    ['Attachments, with mounts', W(s.wtAtt)],
    ['Total as configured', `${s.wtEstimated ? '≈ ' : ''}${W(s.wtTotal)}`],
    ...(s.balance ? [['Balance point (estimate)', `${L(Math.abs(s.balance.fromGrip))} ${s.balance.fromGrip >= 0 ? 'ahead of' : 'behind'} the trigger`] as [string, string]] : []),
    ...(gun.specs?.overallLength ? [['Listed overall length', String(gun.specs.overallLength)] as [string, string]] : []),
  ]
  return (
    <>
      <StatsCard stats={stats} />
      <h3 className="section-title">Measured from the model <span>updates as you change the build</span></h3>
      <div className="rows">
        {rows.map(([k, v]) => <div key={k} className="rowi"><span className="k">{k}</span><span className="v">{v}</span><span /></div>)}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Lengths use published dimensions where known (barrel, rail pitch, M-LOK spacing, optic and suppressor lengths) and typical geometry elsewhere,
        so treat them as close, not exact. Turn on Dimensions on the model to see them drawn.
      </p>
    </>
  )
}
