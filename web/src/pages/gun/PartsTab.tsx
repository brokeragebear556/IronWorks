import { Link } from 'react-router'
import type { Item, View } from '../../types'
import type { ChChoice, TriggerChoice } from './shared'

interface Props {
  item: Item
  view: View
  present: Set<string>
  picked: string | null
  onPick: (p: string | null) => void
  trig: TriggerChoice | null
  ch: ChChoice | null
  onAddPart: () => void
}

/** The build sheet: every part from the saved pages, split by lower and upper. */
export function PartsTab({ item, view, present, picked, onPick, trig, ch, onAddPart }: Props) {
  const bom = item.data.bom ?? {}
  return (
    <>
      {Object.entries(bom).map(([secKey, sec]) => {
        if (!sec?.rows) return null
        const dim = item.kind === 'gun' && view !== 'full' && (secKey === 'lower' || secKey === 'upper') && view !== secKey
        return (
          <div key={secKey}>
            <h3 className="section-title">{sec.title} parts <span>{sec.from}</span></h3>
            <div className={'rows' + (dim ? ' dim' : '')}>
              {sec.rows.map((r, i) => {
                let v = r.value
                if (r.part === 'trigger' && trig && !trig.installed) v = `Previewing: ${trig.name} (installed: ${v})`
                if (r.part === 'ch' && ch && !ch.installed) v = `Previewing: ${ch.name} (installed: ${v})`
                const can = !!r.part && present.has(r.part)
                const inner = <><span className="k">{r.label}</span><span className="v">{v || '—'}</span><span /></>
                return can
                  ? <button type="button" key={i} className="rowi" aria-pressed={picked === r.part} onClick={() => onPick(picked === r.part ? null : r.part)}>{inner}</button>
                  : <div key={i} className="rowi">{inner}</div>
              })}
            </div>
          </div>
        )
      })}
      {item.kind === 'gun' && (
        <div>
          <h3 className="section-title">Bought for this gun <span>{item.gun.parts.length || 'none yet'}</span></h3>
          {item.gun.parts.length > 0 && (
            <div className="rows">
              {item.gun.parts.map((p) => (
                <Link key={p.id} className="rowi" to={`/gun/${item.gun.id}/part/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="k">Part</span><span className="v">{p.name}<br /><span className="note">{p.short}</span></span><span className="mono" style={{ color: 'var(--brass)' }}>Open ›</span>
                </Link>
              ))}
            </div>
          )}
          <div className="row-actions" style={{ marginTop: 8 }}><button type="button" className="btn" onClick={onAddPart}>+ Add a part</button></div>
        </div>
      )}
    </>
  )
}
