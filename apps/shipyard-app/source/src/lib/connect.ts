/** Starting a connector's OAuth round trip, the way the Lemma frontend does it.
 *
 *  Three things this gets right that the first attempt did not:
 *
 *  1. The response field is **`authorization_url`** — not `redirect_url`. Reading
 *     the wrong key meant the button opened nothing at all.
 *  2. Prefer **`auth_config_id`** when the organization already has an install for
 *     that connector; `connector_id` only creates or reuses a default.
 *  3. `return_to` accepts **only a rooted path inside the Lemma app** — the backend
 *     refuses a scheme or `//host` outright, as an open-redirect guard. A pod app
 *     lives on its own subdomain, so it can never be the return target and cannot
 *     receive the `postMessage` the first-party UI listens for.
 *
 *  Point (3) is why this polls. The first-party connectors page dropped polling
 *  when it gained the postMessage handshake; cross-origin, polling is what is
 *  left, and it is honest — it watches for the account to actually appear.
 */
import type { LemmaClient } from 'lemma-sdk'
import { items } from './util'

export interface Account {
  id: string
  connector_id: string
  status: string
  display_name?: string | null
  email?: string | null
}

export interface AuthConfig { id: string; connector_id: string; name?: string; kind?: string }

export interface KindSpec {
  kind?: string
  auth_scheme?: string
  system_default_available?: boolean
  credential_schema?: unknown
  install_config_schema?: unknown
}

export interface Connector { id: string; title?: string; icon?: string; kinds?: KindSpec[] }

/** Composio first, then whatever the connector leads with — the same order the
 *  first-party connectors page uses. */
export function primaryKind(connector: Connector | undefined): KindSpec | null {
  const kinds = connector?.kinds ?? []
  return kinds.find((k) => k.kind === 'composio') ?? kinds[0] ?? null
}

/** An API-key or no-auth kind has no authorization URL to send anybody to; it
 *  wants a credential typed into a form. PostHog is one of these. */
export function usesDirectCredentials(spec: KindSpec | null): boolean {
  if (!spec) return false
  return spec.auth_scheme === 'API_KEY' || spec.auth_scheme === 'NOAUTH'
    || Boolean(spec.credential_schema)
}

export function canConnectWithDefaults(spec: KindSpec | null): boolean {
  return Boolean(spec?.system_default_available) && !spec?.install_config_schema
}

/** Where the first-party connectors UI lives, derived from the injected config. */
export function lemmaConnectorsUrl(): string | null {
  const cfg = (window as { __LEMMA_CONFIG__?: { authUrl?: string; podId?: string } }).__LEMMA_CONFIG__
  // The host injects this when the app is served; under `vite dev` it is absent
  // and the SDK's own dev fallback is the only source.
  const authUrl = cfg?.authUrl ?? import.meta.env.VITE_LEMMA_AUTH_URL
  const podId = cfg?.podId ?? import.meta.env.VITE_LEMMA_POD_ID
  if (!authUrl) return null
  try {
    const origin = new URL(String(authUrl)).origin
    return podId ? `${origin}/pod/${podId}/connectors` : `${origin}/connectors`
  } catch { return null }
}

export function isConnected(a: Account | undefined): boolean {
  return String(a?.status ?? '').toUpperCase() === 'CONNECTED'
}

export async function listAccounts(client: LemmaClient, orgId: string): Promise<Account[]> {
  return items<Account>(await client.connectors.accounts.list(orgId, { limit: 200 }))
}

export async function listAuthConfigs(client: LemmaClient, orgId: string): Promise<AuthConfig[]> {
  try {
    return items<AuthConfig>(await client.connectors.authConfigs.list(orgId, { limit: 200 }))
  } catch {
    return []
  }
}

/** A new tab, no `noopener` features, falling back to this tab if it is blocked. */
export function openAuthorization(url: string): 'tab' | 'same-tab' {
  const opened = window.open(url, '_blank')
  if (opened) return 'tab'
  window.location.assign(url)
  return 'same-tab'
}

/** The install an OAuth round trip runs against, creating one if the
 *  organization has none.
 *
 *  This is the step the first attempt skipped. `connector_id` on a connect
 *  request does **not** create an install — it names one that must already
 *  exist — so with no auth config the request had nothing to authorize and
 *  came back without a URL.
 */
export async function ensureAuthConfig(
  client: LemmaClient, orgId: string, connector: Connector, existing: AuthConfig[],
): Promise<{ config: AuthConfig; createdHere: boolean }> {
  const found = existing.find((c) => c.connector_id === connector.id)
  if (found) return { config: found, createdHere: false }

  const spec = primaryKind(connector)
  if (!canConnectWithDefaults(spec)) {
    throw new Error(
      `${connector.title ?? connector.id} needs its own credentials before it can be connected. Set it up on Lemma's connectors page.`,
    )
  }
  const created = await client.connectors.enableApp(orgId, connector.id, {
    kind: spec?.kind,
    config_source: 'SYSTEM_DEFAULT',
  } as Parameters<typeof client.connectors.enableApp>[2])
  return { config: created as unknown as AuthConfig, createdHere: true }
}

export async function deleteAuthConfig(
  client: LemmaClient, orgId: string, name: string,
): Promise<void> {
  await client.connectors.authConfigs.delete(orgId, name)
}

export async function startConnect(
  client: LemmaClient, orgId: string, connectorId: string, authConfigId?: string,
): Promise<string> {
  const payload = authConfigId
    ? { auth_config_id: authConfigId }
    : { connector_id: connectorId }
  const res = await client.connectors.createConnectRequest(
    orgId,
    payload as Parameters<typeof client.connectors.createConnectRequest>[1],
  )
  const url = (res as { authorization_url?: string | null }).authorization_url
  if (!url) {
    throw new Error(
      'That connector did not return an authorization URL — it probably needs credentials entered rather than an OAuth round trip.',
    )
  }
  return url
}

/** Where to send somebody whose account authorized but is not installed. */
export async function startInstall(
  client: LemmaClient, orgId: string, accountId: string,
): Promise<string> {
  const res = await client.connectors.createInstallRequest(orgId, accountId)
  const url = (res as { authorization_url?: string | null }).authorization_url
  if (!url) throw new Error('No installation URL came back for that account.')
  return url
}

/** Watch for a connector to gain a connected account. Resolves true when it does. */
export function waitForConnection(
  client: LemmaClient, orgId: string, connectorId: string,
  { onTick, timeoutMs = 240_000, everyMs = 4000 }: {
    onTick?: (accounts: Account[]) => void
    timeoutMs?: number
    everyMs?: number
  } = {},
): { promise: Promise<boolean>; cancel: () => void } {
  let stop = false
  const cancel = () => { stop = true }
  const promise = (async () => {
    const until = Date.now() + timeoutMs
    while (!stop && Date.now() < until) {
      await new Promise((r) => setTimeout(r, everyMs))
      if (stop) return false
      try {
        const accounts = await listAccounts(client, orgId)
        onTick?.(accounts)
        if (accounts.some((a) => a.connector_id === connectorId && isConnected(a))) return true
      } catch { /* a blip mid-flow is not a failure of the flow */ }
    }
    return false
  })()
  return { promise, cancel }
}
