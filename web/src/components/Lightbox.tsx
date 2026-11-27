import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  photos: string[]
  index: number
  title: string
  onIndex: (i: number) => void
  onClose: () => void
  onRemove?: (url: string) => void
}

const MIN = 0.05, MAX = 8

/** Full-screen photo viewer: wheel or buttons to zoom (in and out), drag to pan,
 *  double-click to switch between fit and 100%, arrow keys to change photo. */
export function Lightbox({ photos, index, title, onIndex, onClose, onRemove }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [t, setT] = useState({ s: 1, x: 0, y: 0 })
  const [fitScale, setFitScale] = useState(1)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [armed, setArmed] = useState(false)
  const url = photos[index]

  const fit = useCallback(() => {
    const el = stage.current
    if (!el || !nat) return
    const s = Math.min(el.clientWidth / nat.w, el.clientHeight / nat.h) * 0.94
    setFitScale(s)
    setT({ s, x: -(nat.w * s) / 2, y: -(nat.h * s) / 2 })
  }, [nat])

  useEffect(() => { fit() }, [fit])
  useEffect(() => { setNat(null); setArmed(false) }, [url])
  useEffect(() => {
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  // zoom keeping the point under (cx, cy) fixed; cx/cy are relative to the stage centre
  const zoomAt = useCallback((factor: number, cx = 0, cy = 0) => {
    setT((p) => {
      const s = Math.min(MAX, Math.max(MIN, p.s * factor))
      const k = s / p.s
      return { s, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }
    })
  }, [])

  const actual = useCallback(() => {
    if (!nat) return
    setT({ s: 1, x: -nat.w / 2, y: -nat.h / 2 })
  }, [nat])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && photos.length > 1) onIndex((index + 1) % photos.length)
      else if (e.key === 'ArrowLeft' && photos.length > 1) onIndex((index - 1 + photos.length) % photos.length)
      else if (e.key === '+' || e.key === '=') zoomAt(1.25)
      else if (e.key === '-' || e.key === '_') zoomAt(0.8)
      else if (e.key === '0') fit()
      else if (e.key === '1') actual()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, onClose, onIndex, zoomAt, fit, actual])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const pct = Math.round(t.s * 100)
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={title}>
      <div className="lb-bar">
        <span className="title">{title} · {index + 1} of {photos.length} · {decodeURIComponent(url.split('/').pop() ?? '')}</span>
        <button type="button" className="btn" onClick={() => zoomAt(0.8)} aria-label="Zoom out">−</button>
        <span className="mono num" style={{ minWidth: 48, textAlign: 'center' }}>{pct}%</span>
        <button type="button" className="btn" onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
        <button type="button" className="btn" onClick={fit} aria-pressed={Math.abs(t.s - fitScale) < 0.001}>Fit</button>
        <button type="button" className="btn" onClick={actual} aria-pressed={t.s === 1}>100%</button>
        {onRemove && (armed
          ? <button type="button" className="btn danger" onClick={() => onRemove(url)}>Move to _removed</button>
          : <button type="button" className="btn danger" onClick={() => setArmed(true)}>Remove photo</button>)}
        <a className="btn" href={url} target="_blank" rel="noreferrer">Open file</a>
        <button type="button" className="btn primary" onClick={onClose}>Close</button>
      </div>
      <div
        ref={stage}
        className={'lb-stage' + (dragging ? ' dragging' : '')}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }; setDragging(true) }}
        onPointerMove={(e) => { const d = drag.current; if (d) setT((p) => ({ ...p, x: d.tx + e.clientX - d.x, y: d.ty + e.clientY - d.y })) }}
        onPointerUp={() => { drag.current = null; setDragging(false) }}
        onPointerCancel={() => { drag.current = null; setDragging(false) }}
        onDoubleClick={() => (Math.abs(t.s - fitScale) < 0.001 ? actual() : fit())}
      >
        <img
          src={url}
          alt={`${title}, photo ${index + 1}`}
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, visibility: nat ? 'visible' : 'hidden' }}
        />
        {photos.length > 1 && <>
          <button type="button" className="btn lb-nav prev" onPointerDown={(e) => e.stopPropagation()} onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous photo">‹</button>
          <button type="button" className="btn lb-nav next" onPointerDown={(e) => e.stopPropagation()} onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo">›</button>
        </>}
      </div>
      {photos.length > 1 && (
        <div className="lb-strip">
          {photos.map((p, i) => (
            <button type="button" key={p} aria-current={i === index} aria-label={`Photo ${i + 1}`} onClick={() => onIndex(i)}><img src={p} alt="" /></button>
          ))}
        </div>
      )}
    </div>
  )
}
