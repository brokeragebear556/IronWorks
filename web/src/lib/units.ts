import { useQueryClient } from '@tanstack/react-query'
import { api, useSettings } from '../api'
import type { Units } from '../three/engine/specs'
import type { Settings } from '../types'

/** Inches or millimetres for every length (and pounds or kilograms for weights), saved in Settings. */
export function useUnits(): [Units, (u: Units) => void] {
  const { data } = useSettings()
  const qc = useQueryClient()
  const units: Units = data?.units ?? 'in'
  const set = (u: Units) => {
    qc.setQueryData<Settings>(['settings'], (s) => (s ? { ...s, units: u } : s))
    api.saveSettings({ units: u }).catch(() => qc.invalidateQueries({ queryKey: ['settings'] }))
  }
  return [units, set]
}

/** Length entered in the current units -> inches, and back. */
export const toIn = (v: number, u: Units) => (u === 'mm' ? v / 25.4 : v)
export const fromIn = (v: number, u: Units) => (u === 'mm' ? Math.round(v * 25.4 * 10) / 10 : v)
