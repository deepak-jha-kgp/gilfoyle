/** What every screen needs before it can ask a question: which organization the
 *  pod belongs to (connector calls are org-scoped) and which repository the
 *  person is looking at. Both are resolved once, here, so no route has to.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { lemmaClient } from '../lemma-client'
import { listRepos, type Repo } from './github'
import { errText } from './util'

const REPO_KEY = 'shipyard:repo'

export const WATCHED = ['signal', 'triage', 'pull_request'] as const
export type WatchedTable = (typeof WATCHED)[number]
export interface ChangeFrame {
  operation?: string
  record_id?: string
  payload?: Record<string, unknown>
}
export type ChangeHandler = (frame: ChangeFrame) => void

/** Connector ids with a CONNECTED account in this organization. The evidence
 *  ledger needs this: a triage row can only say what the agent *recorded*, and
 *  an agent that could not reach PostHog often writes nothing rather than a
 *  note — which rendered as "asked, nothing found" when the truth was that the
 *  pod has no PostHog account at all. */
interface AppContextValue {
  connected: Set<string>
  /** One WebSocket per table for the whole app, not one per screen. */
  live: string
  /** Register for row changes on a table. Returns an unsubscribe. */
  subscribe: (table: WatchedTable, handler: ChangeHandler) => () => void
  orgId: string | null
  orgError: string | null
  repos: Repo[]
  reposLoading: boolean
  reposError: string | null
  repo: string | null
  setRepo: (fullName: string) => void
  reloadRepos: () => void
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgError, setOrgError] = useState<string | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [reposError, setReposError] = useState<string | null>(null)
  const [repo, setRepoState] = useState<string | null>(() => {
    try { return localStorage.getItem(REPO_KEY) } catch { return null }
  })
  const [live, setLive] = useState('connecting')
  const [connected, setConnected] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!orgId) return
    let alive = true
    void (async () => {
      try {
        const res = await lemmaClient.connectors.accounts.list(orgId, { limit: 200 })
        const rows = (res as { items?: Array<{ connector_id?: string; status?: string }> }).items ?? []
        if (!alive) return
        setConnected(new Set(rows
          .filter((a) => String(a.status).toUpperCase() === 'CONNECTED')
          .map((a) => String(a.connector_id))))
      } catch { /* unknown stays unknown; the ledger says so */ }
    })()
    return () => { alive = false }
  }, [orgId])

  /* One socket per table for the whole app, multiplexed.
     Screens used to open their own, so `signal` had two connections — the rail's
     health dot and Signals' row deltas — each with its own reconnect. Handlers
     register here instead; the socket outlives any one screen, so switching
     routes no longer tears a connection down and builds it back up. */
  const listeners = useRef<Record<WatchedTable, Set<ChangeHandler>>>({
    signal: new Set(), triage: new Set(), pull_request: new Set(),
  })

  useEffect(() => {
    const handles = WATCHED.map((table) => {
      try {
        return lemmaClient.datastore.watchChanges({
          table,
          // Only `signal` reports health, or three sockets would race to set it.
          onStatus: table === 'signal' ? (s: string) => setLive(s) : undefined,
          onChange: (frame: ChangeFrame) => {
            listeners.current[table].forEach((fn) => fn(frame))
          },
        })
      } catch {
        if (table === 'signal') setLive('closed')
        return null
      }
    })
    return () => { handles.forEach((h) => { try { h?.close() } catch { /* gone */ } }) }
  }, [])

  const subscribe = useCallback((table: WatchedTable, handler: ChangeHandler) => {
    const set = listeners.current[table]
    set.add(handler)
    return () => { set.delete(handler) }
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const pod = await lemmaClient.pods.get(lemmaClient.podId as string)
        const id = (pod as { organization_id?: string }).organization_id ?? null
        if (!alive) return
        if (!id) setOrgError('This pod did not report an organization, so connector calls cannot be scoped.')
        setOrgId(id)
      } catch (e) {
        if (alive) setOrgError(errText(e))
      }
    })()
    return () => { alive = false }
  }, [])

  const reloadRepos = useCallback(() => {
    if (!orgId) return
    setReposLoading(true)
    setReposError(null)
    void (async () => {
      try {
        const rows = await listRepos(lemmaClient, orgId)
        rows.sort((a, b) => String(b.pushed_at ?? '').localeCompare(String(a.pushed_at ?? '')))
        setRepos(rows)
        // Only choose for them when they have not chosen, and only from
        // repositories that are actually reachable.
        setRepoState((cur) => (cur && rows.some((r) => r.full_name === cur)) ? cur : (rows[0]?.full_name ?? cur))
      } catch (e) {
        setReposError(errText(e))
      } finally {
        setReposLoading(false)
      }
    })()
  }, [orgId])

  useEffect(() => { reloadRepos() }, [reloadRepos])

  const setRepo = useCallback((fullName: string) => {
    setRepoState(fullName)
    try { localStorage.setItem(REPO_KEY, fullName) } catch { /* private window */ }
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    live, subscribe, connected, orgId, orgError, repos, reposLoading, reposError,
    repo, setRepo, reloadRepos,
  }), [live, subscribe, connected, orgId, orgError, repos, reposLoading, reposError,
    repo, setRepo, reloadRepos])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
