import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PART_NAMES } from '../three/models'
import { Viewer, type Looks, type SceneInput } from '../three/viewer'

interface Props {
  scene: SceneInput
  looks: Looks
  spin: boolean
  picked: string | null
  onPick: (part: string | null) => void
  onPresentParts: (parts: Set<string>) => void
  partLabel: (part: string) => string
  resetSignal: number
  onSkinState?: (s: { note: string; canMirror: boolean; canNext: boolean }) => void
}

/** React wrapper around the framework-free Viewer. */
export function Viewer3D({ scene, looks, spin, picked, onPick, onPresentParts, partLabel, resetSignal, onSkinState }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [hasModel, setHasModel] = useState(true)
  const lastKey = useRef<string | null>(null)
  const cb = useRef({ onPick, partLabel, onSkinState, onPresentParts })
  useLayoutEffect(() => { cb.current = { onPick, partLabel, onSkinState, onPresentParts } })

  useEffect(() => {
    const v = new Viewer(host.current!, labels.current!)
    v.onPick = (p) => cb.current.onPick(p)
    v.partLabel = (p) => cb.current.partLabel(p) || PART_NAMES[p] || p
    v.onSkinNote = (note, canMirror, canNext) => cb.current.onSkinState?.({ note, canMirror, canNext })
    viewer.current = v
    return () => { v.dispose(); viewer.current = null }
  }, [])

  // Rebuild the model when anything that changes its geometry or materials changes.
  const sceneSig = JSON.stringify([scene.key, scene.model, scene.sel, scene.attachments, scene.view, scene.skin, looks.blueprint && !!scene.skin])
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    v.setLooks(looks)
    const keep = lastKey.current === scene.key
    lastKey.current = scene.key
    setHasModel(v.setScene(scene, keep))
    cb.current.onPresentParts(v.presentParts())
    v.highlight(picked)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneSig])

  useEffect(() => { viewer.current?.setLooks(looks) }, [looks])
  useEffect(() => { viewer.current?.setSpin(spin) }, [spin])
  useEffect(() => { viewer.current?.highlight(picked) }, [picked])
  useEffect(() => { if (resetSignal) viewer.current?.resetView() }, [resetSignal])

  return (
    <>
      <div ref={host} className={'stage' + (looks.blueprint ? ' bp' : '')} />
      <div ref={labels} className="labels" aria-hidden="true" />
      {!hasModel && <div className="stage-empty">No 3D model for this item yet. Its details are in the panel.</div>}
    </>
  )
}
