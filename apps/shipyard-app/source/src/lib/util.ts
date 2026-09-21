export function ago(iso?: string | null): string {
  if (!iso) return '—'
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (!isFinite(d)) return '—'
  if (d < 60) return `${Math.max(0, Math.floor(d))}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  if (d < 604800) return `${Math.floor(d / 86400)}d`
  return new Date(iso).toISOString().slice(5, 10)
}

/** Log-scaled, so 3 users and 340 users differ visibly and neither disappears. */
export function blastPct(n?: number | null): number {
  if (!n || n <= 0) return 0
  return Math.min(100, Math.max(8, ((Math.log10(n) + 1) / 4) * 100))
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** Records arrive flat or with columns under `.data`; callers should not care. */
export function field<T = unknown>(row: unknown, key: string): T | undefined {
  if (!row || typeof row !== 'object') return undefined
  const r = row as Record<string, unknown> & { data?: Record<string, unknown> }
  if (r.data && r.data[key] !== undefined) return r.data[key] as T
  return r[key] as T | undefined
}

export function rowId(row: unknown): string {
  const r = (row ?? {}) as Record<string, unknown>
  return String(r.id ?? r.record_id ?? '')
}

export function items<T>(resp: unknown): T[] {
  if (Array.isArray(resp)) return resp as T[]
  if (resp && typeof resp === 'object') {
    const r = resp as Record<string, unknown>
    if (Array.isArray(r.items)) return r.items as T[]
    if (Array.isArray(r.result)) return r.result as T[]
    if (Array.isArray(r.data)) return r.data as T[]
  }
  return []
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
