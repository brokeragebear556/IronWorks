import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Analytics, Catalog, Gun, Library, LogEntry, LookupResult, Plan, PricePoint, ProviderInfo, RefreshResult, Settings, Tracked,
} from './types'
import { Cat, type PartsCatalog } from './three/engine/data'

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError("Can't reach the Ironworks server. Is it running?")
  }
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  if (!res.ok) {
    const b = body as { error?: unknown; detail?: unknown } | null
    let msg = `Request failed (${res.status})`
    if (b && typeof b.error === 'string') msg = b.error
    else if (b && Array.isArray(b.detail)) msg = b.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('. ')
    throw new ApiError(msg)
  }
  return body as T
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data),
})

const enc = encodeURIComponent

export const api = {
  library: () => request<Library>('/api/library'),
  catalog: () => request<Catalog>('/api/catalog'),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('/api/settings', json('PUT', s)),
  providers: () => request<ProviderInfo[]>('/api/providers'),
  unmatched: () => request<{ folder: string; files: string[] }>('/api/library/unmatched'),

  createGun: (g: Partial<Gun>) => request<{ id: string }>('/api/guns', json('POST', g)),
  patchGun: (id: string, changes: Partial<Gun>) => request<Gun>(`/api/guns/${enc(id)}`, json('PATCH', changes)),
  removeGun: (id: string) => request<{ movedTo: string }>(`/api/guns/${enc(id)}`, { method: 'DELETE' }),
  createPart: (gunId: string, p: Record<string, unknown>) => request<{ id: string }>(`/api/guns/${enc(gunId)}/parts`, json('POST', p)),
  patchPart: (gunId: string, partId: string, changes: Record<string, unknown>) => request<{ ok: boolean }>(`/api/guns/${enc(gunId)}/parts/${enc(partId)}`, json('PATCH', changes)),
  patchAttachment: (gunId: string, attId: string, changes: Record<string, unknown>) => request<{ ok: boolean }>(`/api/guns/${enc(gunId)}/attachments/${enc(attId)}`, json('PATCH', changes)),
  removePart: (gunId: string, partId: string) => request<{ movedTo: string }>(`/api/guns/${enc(gunId)}/parts/${enc(partId)}`, { method: 'DELETE' }),
  addAttachment: (gunId: string, a: Record<string, unknown>) => request<{ id: string }>(`/api/guns/${enc(gunId)}/attachments`, json('POST', a)),
  removeAttachment: (gunId: string, attId: string) => request<{ movedTo: string }>(`/api/guns/${enc(gunId)}/attachments/${enc(attId)}`, { method: 'DELETE' }),
  uploadPhoto: (gunId: string, target: string, file: File) => {
    const fd = new FormData()
    fd.append('target', target)
    fd.append('file', file)
    return request<{ url: string }>(`/api/guns/${enc(gunId)}/photos`, { method: 'POST', body: fd })
  },
  removePhoto: (gunId: string, url: string) => request<{ movedTo: string }>(`/api/guns/${enc(gunId)}/photos/remove`, json('POST', { url })),

  identify: (key: string, url?: string) => request<LookupResult[]>('/api/identify', json('POST', { key, url })),
  refresh: (key?: string) => request<RefreshResult[]>('/api/refresh', json('POST', { key: key ?? null })),
  identifyUpload: (key: string, file: File) => {
    const fd = new FormData()
    fd.append('key', key)
    fd.append('file', file)
    return request<LookupResult[]>('/api/identify/upload', { method: 'POST', body: fd })
  },
  identifyHistory: (key: string) => request<LookupResult[]>(`/api/identify/history?key=${enc(key)}`),
  applyMetadata: (body: { key: string; resultId: number; fields: string[]; specs: string[]; images: string[]; imageTarget?: string }) =>
    request<{ ok: boolean; photos: string[] }>('/api/identify/apply', json('POST', body)),

  logs: (gunId?: string) => request<LogEntry[]>(gunId ? `/api/logs?gun_id=${enc(gunId)}` : '/api/logs'),
  addLog: (l: Omit<LogEntry, 'id' | 'receipt'>) => request<{ id: number }>('/api/logs', json('POST', l)),
  editLog: (id: number, l: Omit<LogEntry, 'id' | 'receipt'>) => request<{ ok: boolean }>(`/api/logs/${id}`, json('PUT', l)),
  deleteLog: (id: number) => request<{ ok: boolean }>(`/api/logs/${id}`, { method: 'DELETE' }),
  uploadReceipt: (id: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ url: string }>(`/api/logs/${id}/receipt`, { method: 'POST', body: fd })
  },
  values: () => request<{ gun_id: string; value: number }[]>('/api/values'),
  setValue: (gunId: string, value: number | null) => request<{ ok: boolean }>(`/api/guns/${enc(gunId)}/value`, json('PUT', { value })),

  tracked: () => request<Tracked[]>('/api/tracked'),
  addTracked: (t: { item_key: string; label: string; url: string; target_price: number | null }) =>
    request<{ id: number; ok: boolean; error?: string }>('/api/tracked', json('POST', t)),
  patchTracked: (id: number, t: Partial<Pick<Tracked, 'target_price' | 'enabled' | 'label'>>) => request<{ ok: boolean }>(`/api/tracked/${id}`, json('PATCH', t)),
  deleteTracked: (id: number) => request<{ ok: boolean }>(`/api/tracked/${id}`, { method: 'DELETE' }),
  checkTracked: (id: number) => request<{ ok: boolean; error?: string; price?: number }>(`/api/tracked/${id}/check`, { method: 'POST' }),
  priceHistory: (id: number) => request<PricePoint[]>(`/api/tracked/${id}/history`),

  plans: () => request<Plan[]>('/api/plans'),
  addPlan: (p: Omit<Plan, 'id' | 'done' | 'created_at'>) => request<{ id: number }>('/api/plans', json('POST', p)),
  patchPlan: (id: number, done: boolean) => request<{ ok: boolean }>(`/api/plans/${id}`, json('PATCH', { done })),
  deletePlan: (id: number) => request<{ ok: boolean }>(`/api/plans/${id}`, { method: 'DELETE' }),

  analytics: () => request<Analytics>('/api/analytics'),
  network: () => request<{ lan: boolean; hasPassword: boolean; listening: string; restartNeeded: boolean; port: number; addresses: string[]; thisComputer: boolean }>('/api/network'),

  duplicateGun: (id: string) => request<{ id: string }>(`/api/guns/${enc(id)}/duplicate`, { method: 'POST' }),
  setOrder: (ids: string[]) => request<{ ok: boolean }>('/api/library/order', json('PUT', { ids })),
  lastChange: () => request<{ change: LastChange | null }>('/api/history/last'),
  undo: () => request<LastChange>('/api/history/undo', { method: 'POST' }),
  importCollection: (text: string) => request<{ created: string[]; logs: number }>('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text }),
}

export interface LastChange { gunId: string; gunName: string; file: string; at: string; fields: string[]; part: boolean }

// ---------- react-query hooks ----------
export const useLibrary = () => useQuery({ queryKey: ['library'], queryFn: api.library })
export const useCatalog = () => useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: Infinity })
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: api.settings })
/** The parts catalog, indexed for lookups. */
export const usePartsCatalog = () => useQuery({ queryKey: ['parts-catalog'], queryFn: async () => new Cat(await request<PartsCatalog>('/api/parts-catalog')), staleTime: Infinity })
export const useLogs = (gunId?: string) => useQuery({ queryKey: ['logs', gunId ?? 'all'], queryFn: () => api.logs(gunId) })
export const useTracked = () => useQuery({ queryKey: ['tracked'], queryFn: api.tracked })
export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: api.plans })
export const useValues = () => useQuery({ queryKey: ['values'], queryFn: api.values })
export const useAnalytics = () => useQuery({ queryKey: ['analytics'], queryFn: api.analytics })

/** A mutation that refreshes the listed queries when it succeeds. */
export function useAction<A, R>(fn: (args: A) => Promise<R>, invalidate: string[][]) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  })
}
