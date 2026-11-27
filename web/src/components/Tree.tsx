import type { Gun, View } from '../types'
import { usePref } from '../lib/prefs'

export interface TreeSelection { key: string; view: View; pick: string | null }

interface Props {
  guns: Gun[]
  attachmentTypeName: (type: string) => string
  current: TreeSelection | null
  onSelect: (sel: TreeSelection) => void
  onAddGun: () => void
}

const Caret = ({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) => (
  <button type="button" className="caret" aria-expanded={open} aria-label={(open ? 'Collapse ' : 'Expand ') + label} onClick={onClick}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </button>
)

/** The library tree: each gun, with the lower/upper it was built from, the parts bought
 *  for it and its attachments nested underneath. Branches can be collapsed. */
export function Tree({ guns, attachmentTypeName, current, onSelect, onAddGun }: Props) {
  const [closed, setClosed] = usePref<Record<string, boolean>>('collapsed', {})
  const setAll = (open: boolean) => setClosed(Object.fromEntries(guns.map((g) => [g.id, !open])))

  return (
    <nav className="tree" aria-label="Guns and parts">
      <div className="tree-head">
        <span>Complete guns</span>
        <span>
          <button type="button" onClick={() => setAll(true)}>Expand all</button>
          <button type="button" onClick={() => setAll(false)}>Collapse all</button>
        </span>
      </div>
      {guns.map((g, i) => {
        const planned = (kind: string, id: string) => g.pricing.lines.some((l) => l.kind === kind && l.id === id && l.status === 'planned')
        const kids = [
          ...(g.children ?? []).map((c) => ({ id: `v:${c.view}`, n0: '↳', name: c.name, short: c.short ?? '', sel: { key: g.id, view: (c.view ?? 'full') as View, pick: null } })),
          ...g.parts.map((p) => ({ id: `p:${p.id}`, n0: '↳', name: p.name, short: (planned('part', p.id) ? 'Planned · ' : '') + (p.short ?? ''), sel: { key: `${g.id}/${p.id}`, view: 'full' as View, pick: null } })),
          ...g.attachments.map((a) => ({ id: `a:${a.id}`, n0: '+', name: a.name, short: (planned('attachment', a.id) ? 'Planned · ' : '') + 'Attachment · ' + attachmentTypeName(a.type), sel: { key: g.id, view: 'full' as View, pick: 'att:' + a.id } })),
        ]
        const open = !closed[g.id]
        const gunCurrent = !!current && current.key === g.id && !current.pick && current.view === 'full'
        return (
          <div key={g.id}>
            <div className="node-row">
              <button type="button" className="item" aria-current={gunCurrent} onClick={() => onSelect({ key: g.id, view: 'full', pick: null })}>
                <span className="n0">{i + 1}</span>
                <span className="t"><span className="n">{g.name}</span><span className="s">{g.pricing.status === 'planned' ? 'Planned · ' : ''}{g.short}</span></span>
              </button>
              {kids.length > 0 && <Caret open={open} label={g.name} onClick={() => setClosed((c) => ({ ...c, [g.id]: open }))} />}
            </div>
            {kids.length > 0 && open && (
              <div className="kids">
                {kids.map((k) => {
                  const cur = !!current && current.key === k.sel.key && (
                    k.id.startsWith('v:') ? current.view === k.sel.view && !current.pick
                      : k.id.startsWith('a:') ? current.pick === k.sel.pick
                        : true)
                  return (
                    <button type="button" key={k.id} className="item sub" aria-current={cur} onClick={() => onSelect(k.sel)}>
                      <span className="n0">{k.n0}</span>
                      <span className="t"><span className="n">{k.name}</span><span className="s">{k.short}</span></span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="add-gun" onClick={onAddGun}>+ Add gun</button>
    </nav>
  )
}
