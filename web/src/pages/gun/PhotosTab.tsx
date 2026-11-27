import { useRef, useState } from 'react'
import { api, useAction } from '../../api'
import { Lightbox } from '../../components/Lightbox'
import { coverPhoto, viewName } from '../../lib/format'
import type { Item, View } from '../../types'
import { errMsg } from './shared'

const VIEWS: View[] = ['full', 'lower', 'upper']

/** Photos grouped by full gun / lower / upper (or the part), with a zoomable viewer. */
export function PhotosTab({ item }: { item: Item }) {
  const groups: { target: string; title: string; photos: string[] }[] = item.kind === 'part'
    ? [{ target: `part:${item.partId}`, title: 'This part', photos: item.data.photos }]
    : VIEWS.map((v) => ({ target: v, title: viewName(item.gun, v), photos: item.gun.photos[v] }))
  const [open, setOpen] = useState<{ group: number; index: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<string>('full')
  const upload = useAction((p: { target: string; file: File }) => api.uploadPhoto(item.gun.id, p.target, p.file), [['library']])
  const remove = useAction((url: string) => api.removePhoto(item.gun.id, url), [['library']])
  const setCover = useAction((url: string) => api.patchGun(item.gun.id, { coverPhoto: url }), [['library']])
  const cover = item.kind === 'gun' ? coverPhoto(item.gun) : null

  const pickFile = (target: string) => { pending.current = target; fileRef.current?.click() }
  const g = open ? groups[open.group] : null

  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={async (e) => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ''
        setErr(null)
        for (const file of files) {
          if (file.size > 15_000_000) { setErr(`${file.name} is over 15 MB.`); continue }
          try { await upload.mutateAsync({ target: pending.current, file }) } catch (x) { setErr(errMsg(x)) }
        }
      }} />
      {groups.map((grp, gi) => (
        <div className="photo-group" key={grp.target}>
          <h3 className="section-title">{grp.title} <span>{grp.photos.length} photo{grp.photos.length === 1 ? '' : 's'}</span></h3>
          {grp.photos.length > 0 && (
            <div className="photo-grid">
              {grp.photos.map((p, i) => {
                const isCover = item.kind === 'gun' && cover === p
                return (
                  <div className="photo-tile-wrap" key={p}>
                    <button type="button" className="photo-tile" onClick={() => setOpen({ group: gi, index: i })} aria-label={`Open ${grp.title} photo ${i + 1}`}>
                      <img src={p} alt="" loading="lazy" />
                    </button>
                    {item.kind === 'gun' && (
                      <button type="button" className={'star' + (isCover ? ' on' : '')} aria-pressed={isCover}
                        title={isCover ? 'This is the library photo. Click to go back to the default.' : 'Use as the library photo'}
                        aria-label="Use as the library photo" disabled={setCover.isPending}
                        onClick={() => setCover.mutate(isCover ? '' : p)}>★</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className="row-actions">
            <button type="button" className="btn small" disabled={upload.isPending} onClick={() => pickFile(grp.target)}>+ Add photo{grp.target === 'full' || grp.target.startsWith('part:') ? '' : ` of the ${grp.title.toLowerCase()}`}</button>
          </div>
        </div>
      ))}
      {upload.isPending && <p className="note">Uploading…</p>}
      {err && <p className="error">{err}</p>}
      <p className="note">
        {item.kind === 'gun' && <>The ★ photo is the one shown on the library card when it's set to Product photo. </>}
        Photos are stored in <code>guns/{item.gun.id}/photos/</code>. You can also drop image files there directly.
      </p>
      {open && g && g.photos.length > 0 && (
        <Lightbox
          photos={g.photos}
          index={Math.min(open.index, g.photos.length - 1)}
          title={`${item.data.name} — ${g.title}`}
          onIndex={(i) => setOpen({ ...open, index: i })}
          onClose={() => setOpen(null)}
          onRemove={async (url) => {
            try { await remove.mutateAsync(url); if (g.photos.length <= 1) setOpen(null) } catch (x) { setErr(errMsg(x)); setOpen(null) }
          }}
        />
      )}
    </>
  )
}
