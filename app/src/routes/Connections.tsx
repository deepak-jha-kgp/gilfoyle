/** What the pod can actually reach, and the round trip to fix what it cannot.
 *
 *  The connect flow mirrors the first-party connectors page (see
 *  `lemma-frontend/components/connectors/connectors-view.tsx`) with one forced
 *  difference: `return_to` only accepts a rooted path inside the Lemma app, so a
 *  pod app on its own subdomain can never be the callback target and never
 *  receives the `postMessage` that page listens for. It watches for the account
 *  instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Plug, RefreshCw } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { useApp } from '../lib/app-context'
import { errText, items } from '../lib/util'
import {
  canConnectWithDefaults, deleteAuthConfig, ensureAuthConfig, isConnected,
  lemmaConnectorsUrl, listAccounts, listAuthConfigs, openAuthorization, primaryKind,
  startConnect, startInstall, usesDirectCredentials, waitForConnection,
  type Account, type AuthConfig, type Connector,
} from '../lib/connect'
import { Failed, Working } from '../components/states'

/** The connectors this pod's agents hold grants for. The rest of the catalog is
 *  noise on this page. */
const USED: Array<[string, string]> = [
  ['github', "Repositories, pull requests, issues — and the fixer's checkout"],
  ['posthog', 'How many real people a signal affects'],
  ['sentry', 'Whether it is live, and since when'],
  ['googlebigquery', 'Whether money moved through the broken path'],
  ['linear', 'Issues raised outside GitHub'],
]

type Phase = { connectorId: string; note: string; link?: string | null } | null

export function Connections() {
  const { orgId, orgError } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [configs, setConfigs] = useState<AuthConfig[]>([])
  const [catalog, setCatalog] = useState<Record<string, Connector>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>(null)
  const watching = useRef<{ cancel: () => void } | null>(null)

  const load = useCallback(() => {
    if (!orgId) return
    setLoading(true); setError(null)
    void (async () => {
      try {
        const [acc, cfg, cons] = await Promise.all([
          listAccounts(lemmaClient, orgId),
          listAuthConfigs(lemmaClient, orgId),
          lemmaClient.connectors.list({ limit: 200 }),
        ])
        setAccounts(acc)
        setConfigs(cfg)
        const map: Record<string, Connector> = {}
        for (const c of items<Connector>(cons)) map[c.id] = c
        setCatalog(map)
      } catch (e) { setError(errText(e)) }
      finally { setLoading(false) }
    })()
  }, [orgId])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { watching.current?.cancel() }, [])

  const accountFor = (id: string) => accounts.find((a) => a.connector_id === id)

  async function connect(connectorId: string) {
    if (!orgId) return
    const connector = catalog[connectorId]
    const spec = primaryKind(connector)

    /* An API-key kind has no authorization URL to open — it wants a secret typed
       into a form. PostHog is one. Rather than build a box for somebody's key,
       say what it needs and hand them the page that already does it properly. */
    if (usesDirectCredentials(spec)) {
      const url = lemmaConnectorsUrl()
      setPhase({
        connectorId,
        note: `${connector?.title ?? connectorId} signs in with an API key rather than a redirect, so it has to be set up where the key can be entered.`,
        link: url,
      })
      return
    }
    if (connector && !catalog[connectorId]?.kinds?.length) {
      setPhase({ connectorId, note: 'This connector has no usable sign-in method in this deployment.' })
      return
    }

    setBusy(connectorId); setPhase(null)
    watching.current?.cancel()
    let created: AuthConfig | null = null
    try {
      const account = accountFor(connectorId)
      const needsInstall = account
        && ['INSTALL_REQUIRED', 'PENDING_INSTALL'].includes(String(account.status).toUpperCase())

      let url: string
      if (needsInstall && account) {
        url = await startInstall(lemmaClient, orgId, account.id)
      } else {
        if (!connector) throw new Error('That connector is not in this deployment’s catalog.')
        const { config, createdHere } = await ensureAuthConfig(lemmaClient, orgId, connector, configs)
        if (createdHere) created = config
        url = await startConnect(lemmaClient, orgId, connectorId, config.id)
      }

      const where = openAuthorization(url)
      if (where === 'same-tab') return

      setPhase({
        connectorId,
        note: 'Finish in the new tab. This page is watching for the account and will update on its own.',
      })
      const watcher = waitForConnection(lemmaClient, orgId, connectorId, { onTick: setAccounts })
      watching.current = watcher
      const ok = await watcher.promise
      setPhase(ok
        ? { connectorId, note: 'Connected.' }
        : { connectorId, note: 'Still not connected. If you finished in the other tab, press Refresh.' })
      load()
    } catch (e) {
      /* An install created moments ago with no accounts on it has nothing to
         lose, and leaving it behind is worse than nothing: the name is taken, so
         even retrying is refused while the connector reads as enabled. */
      if (created?.name) {
        try { await deleteAuthConfig(lemmaClient, orgId, created.name) } catch { /* the original error is what matters */ }
      }
      setPhase({ connectorId, note: errText(e) })
    } finally { setBusy(null) }
  }

  if (orgError) return <Failed title="No organization context" detail={orgError} />

  const connectedCount = accounts.filter(isConnected).length

  return (
    <>
      <header className="head">
        <h1>Connections</h1>
        <span className="count">{loading ? '…' : `${connectedCount} connected`}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>
      <div className="page">
        <div className="page-inner conns">
          {loading && <Working label="Reading connected accounts" />}
          {error && <Failed title="Couldn't read connections" detail={error} />}

          {!loading && !error && (
            <>
              <p className="lede">
                Gilfoyle and the triager hold a grant for every one of these. A source
                with no connected account shows as <em>no account connected</em> on a
                signal&apos;s evidence — never as a zero.
              </p>

              <div className="conn-grid">
                {USED.map(([id, why]) => {
                  const account = accountFor(id)
                  const status = String(account?.status ?? '').toUpperCase()
                  const ok = isConnected(account)
                  const meta = catalog[id]
                  const active = phase?.connectorId === id
                  return (
                    <div className="conn" key={id}>
                      <div className="top">
                        {meta?.icon
                          ? <img src={meta.icon} alt="" />
                          : <span className="ico-fallback" aria-hidden="true" />}
                        <span className="who">
                          <span className="nm">{meta?.title ?? id}</span>
                          <span className="sub">
                            {account?.display_name || account?.email || id}
                          </span>
                        </span>
                        <span className={`st ${ok ? 'ok' : account ? 'warn' : 'off'}`}>
                          {ok ? 'connected'
                            : account ? status.toLowerCase().replace(/_/g, ' ')
                            : 'not connected'}
                        </span>
                      </div>
                      <p className="why">{why}</p>
                      <div className="act">
                        {!ok && (
                          <button className="btn sm" onClick={() => void connect(id)}
                            disabled={busy === id}>
                            <Plug size={14} />
                            {busy === id
                              ? 'Opening…'
                              : usesDirectCredentials(primaryKind(catalog[id]))
                                ? 'Needs an API key'
                                : account ? 'Reconnect' : 'Connect'}
                          </button>
                        )}
                        {active && (
                          <p className="phase">
                            {phase?.note}
                            {phase?.link && (
                              <>
                                {' '}
                                <a href={phase.link} target="_blank" rel="noopener noreferrer">
                                  Open connectors <ExternalLink size={11} style={{ display: 'inline' }} />
                                </a>
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {accounts.length > 0 && (
                <>
                  <h2 className="sect-label">Every account in this organization</h2>
                  <div className="conn-grid">
                    {accounts.map((a) => {
                      const meta = catalog[a.connector_id]
                      return (
                        <div className="conn slim" key={a.id}>
                          <div className="top">
                            {meta?.icon
                              ? <img src={meta.icon} alt="" />
                              : <span className="ico-fallback" aria-hidden="true" />}
                            <span className="who">
                              <span className="nm">{meta?.title ?? a.connector_id}</span>
                              <span className="sub">
                                {a.display_name || a.email || a.id.slice(0, 8)}
                              </span>
                            </span>
                            <span className={`st ${isConnected(a) ? 'ok' : 'warn'}`}>
                              {String(a.status).toLowerCase().replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              <p className="foot-note">
                Connecting opens the provider in a new tab. The round trip has to end on
                Lemma&apos;s own domain — the backend refuses any other return path — so
                this page watches for the account rather than being handed the result.{' '}
                <a href="https://docs.lemma.work" target="_blank" rel="noopener noreferrer">
                  Connector docs <ExternalLink size={12} style={{ display: 'inline' }} />
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
