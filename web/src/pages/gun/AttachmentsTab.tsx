import { useState } from 'react'
import { api, useAction } from '../../api'
import { ConfirmButton } from '../../components/ConfirmButton'
import { money } from '../../lib/format'
import type { Cat } from '../../three/engine/data'
import type { Specs, Units } from '../../three/engine/specs'
import type { Catalog, Gun } from '../../types'
import { Placement } from './Placement'
import { errMsg } from './shared'

interface Props {
  gun: Gun
  catalog: Catalog
  shown: boolean
  present: Set<string>
  picked: string | null
  onPick: (p: string | null) => void
  onAdd: () => void
  onShow: () => void
  /** Build-engine guns: measured placement for each attachment, for exact positioning. */
  specs?: Specs | null
  cat?: Cat | null
  units?: Units
}

export function AttachmentsTab({ gun, catalog, shown, present, picked, onPick, onAdd, onShow, specs, cat, units = 'in' }: Props) {
  const [err, setErr] = useState<string | null>(null)
  const remove = useAction((id: string) => api.removeAttachment(gun.id, id), [['library']])
  return (
    <>
      {!shown && gun.attachments.length > 0 && (
        <p className="note">Attachments are hidden on the model. <button type="button" className="btn small" onClick={onShow}>Show them</button></p>
      )}
      {gun.attachments.length === 0
        ? <div className="empty">No attachments yet. Add optics, lights, a suppressor, grips, a bipod, a sling or a magazine.</div>
        : (
          <div className="rows">
            {gun.attachments.map((a) => {
              const key = 'att:' + a.id
              const t = catalog.attachments[a.type]
              const where = [t?.positions && a.position, t?.sides && a.side && `${a.side} side`].filter(Boolean).join(', ')
              const can = present.has(key)
              return (
                <div key={a.id} className="rowi" style={can ? { cursor: 'pointer' } : undefined} aria-pressed={picked === key}
                  role={can ? 'button' : undefined} tabIndex={can ? 0 : undefined}
                  onKeyDown={(e) => { if (can && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(picked === key ? null : key) } }}
                  onClick={() => can && onPick(picked === key ? null : key)}>
                  <span className="k">{t?.name ?? a.type}</span>
                  <span className="v">
                    {a.name}{a.details ? ` · ${a.details}` : ''}{where && <span className="mono note"> ({where})</span>}
                    <span style={{ display: 'block', marginTop: 3 }}>
                      <span className={'pill ' + ((a.status ?? gun.pricing.status) === 'planned' ? 'planned' : 'ok')}>{(a.status ?? gun.pricing.status) === 'planned' ? 'Planned' : 'Owned'}</span>{' '}
                      <span className="note num">{a.price != null ? money(a.price) : 'no price'}</span>
                    </span>
                    {picked === key && cat && specs?.atts.find((p) => p.id === a.id) && (
                      <Placement gun={gun} att={a} place={specs.atts.find((p) => p.id === a.id)!} cat={cat} units={units} />
                    )}
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <ConfirmButton className="btn small danger" confirm="Remove" onConfirm={async () => {
                      setErr(null)
                      try { await remove.mutateAsync(a.id); if (picked === key) onPick(null) } catch (e) { setErr(errMsg(e)) }
                    }}>Remove</ConfirmButton>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      {err && <p className="error">{err}</p>}
      <div className="row-actions"><button type="button" className="btn primary" onClick={onAdd}>+ Add attachment</button></div>
      {specs && gun.attachments.length > 0 && <p className="note">Select an attachment to set exactly where it sits: rail slot, clock position, height and mount.</p>}
      <p className="note">Change prices and owned / planned status in the Overview tab's Price and status list. Removed attachments are kept in <code>guns/_removed/attachments</code>.</p>
    </>
  )
}
