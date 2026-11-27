import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Built } from '../three/engine/assemble'
import type { Cat, EngGun } from '../three/engine/data'
import type { Specs } from '../three/engine/specs'
import { Stage, type OpView, type StageOpts } from '../three/engine/stage'

interface Props {
  gun: EngGun
  cat: Cat
  opts: StageOpts
  picked: string | null
  onPick: (key: string | null) => void
  onPresentParts: (keys: Set<string>) => void
  onSpecs?: (s: Specs | null, built: Built | null) => void
  onOp?: (v: OpView) => void
  onMoved?: (n: number) => void
  /** Receives the Stage for camera presets, Operate commands and so on. */
  onStage?: (s: Stage | null) => void
  resetSignal: number
}

/** React wrapper around the build engine's Stage. */
export function BuildViewer({ gun, cat, opts, picked, onPick, onPresentParts, onSpecs, onOp, onMoved, onStage, resetSignal }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const lastId = useRef<string | null>(null)
  const cb = useRef({ onPick, onPresentParts, onSpecs, onOp, onMoved, onStage })
  useLayoutEffect(() => { cb.current = { onPick, onPresentParts, onSpecs, onOp, onMoved, onStage } })

  useEffect(() => {
    const s = new Stage(host.current!, overlay.current!)
    s.onPick = (k) => cb.current.onPick(k)
    s.onSpecs = (v, b) => cb.current.onSpecs?.(v, b)
    s.onOp = (v) => cb.current.onOp?.(v)
    s.onMoved = (n) => cb.current.onMoved?.(n)
    stage.current = s
    cb.current.onStage?.(s)
    return () => { cb.current.onStage?.(null); s.dispose(); stage.current = null; lastId.current = null }
  }, [])

  const sig = JSON.stringify(gun)
  useEffect(() => {
    const s = stage.current
    if (!s) return
    s.setOpts(opts)
    s.setGun(gun, cat, lastId.current === gun.id)
    lastId.current = gun.id
    s.highlight(picked)
    cb.current.onPresentParts(s.presentParts())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, cat])

  useEffect(() => { stage.current?.setOpts(opts) }, [opts])
  useEffect(() => { stage.current?.highlight(picked) }, [picked])
  useEffect(() => { if (resetSignal) stage.current?.resetView() }, [resetSignal])

  return (
    <>
      <div ref={host} className={'stage' + (opts.move ? ' moving' : '')} />
      <div ref={overlay} className="labels eng-ov" aria-hidden="true" />
    </>
  )
}
