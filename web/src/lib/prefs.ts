import { useCallback, useState } from 'react'

/** Per-browser preferences (display toggles, collapsed tree branches). Server-side
 *  settings live in /api/settings; this is only for view conveniences. */
export function usePref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = 'wb:' + key
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? { ...initial, ...JSON.parse(raw) } : initial
    } catch {
      return initial
    }
  })
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* storage may be blocked */ }
      return next
    })
  }, [storageKey])
  return [value, set]
}
