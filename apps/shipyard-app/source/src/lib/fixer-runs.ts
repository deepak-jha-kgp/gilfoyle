/** Which agent run is working on which triage row.
 *
 *  Nothing links them directly: a schedule-triggered conversation carries
 *  `metadata.schedule_name` but not the record that woke it. The record id is in
 *  the opening message — the wake payload — so the map is built by reading the
 *  first message of the recent `dispatch-fixer` conversations, once, and reused
 *  for every row on screen.
 *
 *  Bounded on purpose: the newest few runs are the ones anybody is still asking
 *  about, and a page that opens N requests per row is worse than one that
 *  occasionally misses an old link.
 */
import { useCallback, useEffect, useState } from 'react'
import { lemmaClient } from '../lemma-client'
import { items } from './util'

const SCHEDULE = 'dispatch-fixer'
const MAX_LOOKUPS = 12
/** A uuid anywhere in the wake payload. The triage id is one of them. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export interface FixerRun {
  conversationId: string
  status: string
  startedAt: string | null
}

interface Convo {
  id: string
  status?: string | null
  created_at?: string | null
  metadata?: { schedule_name?: string } | null
}

export function useFixerRuns(enabled: boolean): {
  runs: Map<string, FixerRun>
  refresh: () => void
} {
  const [runs, setRuns] = useState<Map<string, FixerRun>>(() => new Map())

  const load = useCallback(() => {
    if (!enabled) return
    let alive = true
    void (async () => {
      try {
        const convos = items<Convo>(await lemmaClient.conversations.list({ limit: 50 }))
          .filter((c) => c.metadata?.schedule_name === SCHEDULE)
          .slice(0, MAX_LOOKUPS)
        const next = new Map<string, FixerRun>()
        await Promise.all(convos.map(async (c) => {
          try {
            /* `limit: 1` returns the *newest* message, which is a tool frame with
               no text. `before_sequence: 1` is the only way to ask for sequence 0
               — the wake payload — without pulling the whole transcript. */
            const page = await lemmaClient.conversations.messages.list(c.id, {
              limit: 2, before_sequence: 1,
            })
            const first = items<{ text?: string; content?: string }>(page)[0]
            const body = String(first?.text ?? first?.content ?? '')
            for (const id of body.match(UUID) ?? []) {
              // Newest wins: a row fixed twice should point at the current run.
              const seen = next.get(id.toLowerCase())
              if (!seen || String(c.created_at ?? '') > String(seen.startedAt ?? '')) {
                next.set(id.toLowerCase(), {
                  conversationId: c.id,
                  status: String(c.status ?? 'unknown'),
                  startedAt: c.created_at ?? null,
                })
              }
            }
          } catch { /* one unreadable run must not lose the rest */ }
        }))
        if (alive) setRuns(next)
      } catch { /* the link is a nicety; the queue works without it */ }
    })()
    return () => { alive = false }
  }, [enabled])

  useEffect(() => { load() }, [load])
  return { runs, refresh: load }
}

export function isWorking(run: FixerRun | undefined): boolean {
  return Boolean(run && ['RUNNING', 'QUEUED', 'WAITING'].includes(run.status.toUpperCase()))
}
