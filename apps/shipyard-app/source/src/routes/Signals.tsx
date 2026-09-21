import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, MessageSquare, X } from 'lucide-react'
import { useCurrentUser } from 'lemma-sdk/react'
import { lemmaClient } from '../lemma-client'
import { useApp, type ChangeFrame } from '../lib/app-context'
import { isWorking, useFixerRuns, type FixerRun } from '../lib/fixer-runs'
import { displayName, initials, usePodMembers, type Member } from '../lib/people'
import { AssigneePicker } from '../components/AssigneePicker'
import { ago, blastPct, cx, errText, field, items, rowId } from '../lib/util'
import { Empty, Failed, Skeletons } from '../components/states'
import { Thread, startDiscussion } from '../components/Thread'
import { AgentPicker, askLabel, useAgentChoice } from '../components/AgentPicker'

type Row = Record<string, unknown> & { data?: Record<string, unknown> }
type Filter = 'all' | 'mine' | 'open' | 'fix' | 'critical' | 'high'
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'], ['mine', 'Mine'], ['open', 'Needs triage'], ['fix', 'For fixing'],
  ['critical', 'Critical'], ['high', 'High'],
]
const ACTIONS: Array<[string, string]> = [
  ['fix', 'Fix it'], ['escalate', 'Escalate'], ['watch', 'Watch'], ['close', 'Close'],
]

export function Signals({ id, go }: { id: string | null; go: (to: string) => void }) {
  const [signals, setSignals] = useState<Row[]>([])
  const [triage, setTriage] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [chat, setChat] = useState<{ id: string; conversationId: string; agent: string } | null>(null)
  const [agent, setAgent] = useAgentChoice()
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [dispatchOn, setDispatchOn] = useState<boolean | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    void (async () => {
      try {
        const [s, t, sch] = await Promise.all([
          lemmaClient.records.list('signal', { limit: 200, sort: [{ field: 'created_at', direction: 'desc' }] }),
          lemmaClient.records.list('triage', { limit: 400 }),
          lemmaClient.schedules.list({ limit: 50 }),
        ])
        setSignals(items<Row>(s))
        setTotal(Number((s as { total?: number }).total ?? items<Row>(s).length))
        setTriage(items<Row>(t))
        const d = items<{ name?: string; is_active?: boolean }>(sch).find((x) => x.name === 'dispatch-fixer')
        setDispatchOn(d ? Boolean(d.is_active) : null)
      } catch (e) { setError(errText(e)) }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => { load() }, [load])

  /* Live, without re-fetching the world. A schedule writing one row used to
     trigger three list calls and re-render every row in the queue, which is
     what made the screen flicker. Merge the delta in place, keyed by id, over
     the app's shared socket rather than opening another one. */
  const { subscribe, connected } = useApp()
  const { members, byUserId } = usePodMembers()
  const { user } = useCurrentUser({ client: lemmaClient })
  const meId = (user as { id?: string } | undefined)?.id ?? null
  const [assigning, setAssigning] = useState<string | null>(null)
  const anyFixing = useMemo(
    () => triage.some((r) => field(r, 'action') === 'fix'), [triage])
  const { runs: fixerRuns, refresh: refreshRuns } = useFixerRuns(anyFixing)
  useEffect(() => {
    const apply = (set: React.Dispatch<React.SetStateAction<Row[]>>) => (frame: ChangeFrame) => {
      const id = frame.record_id
      if (!id) return
      set((cur) => {
        if (frame.operation === 'delete') return cur.filter((r) => rowId(r) !== id)
        const at = cur.findIndex((r) => rowId(r) === id)
        const next = { ...(frame.payload ?? {}), id } as Row
        if (at === -1) return [next, ...cur]
        const copy = cur.slice()
        copy[at] = { ...copy[at], ...next }
        return copy
      })
    }
    const offSignal = subscribe('signal', apply(setSignals))
    const offTriage = subscribe('triage', apply(setTriage))
    return () => { offSignal(); offTriage() }
  }, [subscribe])

  const triageFor = useCallback(
    (signalId: string) => triage.find((t) => field<string>(t, 'signal_id') === signalId) ?? null,
    [triage],
  )

  const rows = useMemo(() => {
    const open = signals.filter((s) => ['new', 'triaging'].includes(String(field(s, 'status'))))
    const rest = signals.filter((s) => !['new', 'triaging'].includes(String(field(s, 'status'))))
    const all = [...open, ...rest]
    if (filter === 'all') return all
    if (filter === 'mine') return all.filter((s) => meId && field(s, 'assignee') === meId)
    if (filter === 'open') return open
    if (filter === 'fix') return all.filter((s) => field(triageFor(rowId(s)), 'action') === 'fix')
    return all.filter((s) => field(triageFor(rowId(s)), 'severity') === filter)
  }, [signals, filter, triageFor, meId])

  async function beginDiscussion(key: string, seed: string) {
    setStarting(true); setStartError(null)
    try {
      const { conversationId, sent } = await startDiscussion(agent, seed)
      setChat({ id: key, conversationId, agent })
      // The turn can take minutes; only its failure is worth reporting here.
      void sent.catch((e: unknown) => setStartError(errText(e)))
    } catch (e) {
      setStartError(errText(e))
    } finally {
      setStarting(false)
    }
  }

  const sel = id
  const selected = useMemo(() => signals.find((s) => rowId(s) === sel) ?? null, [signals, sel])

  async function assign(signalId: string, userId: string | null) {
    setAssigning(signalId); setWriteError(null)
    try {
      await lemmaClient.records.update('signal', signalId, { assignee: userId })
      setSignals((cur) => cur.map((r) => (rowId(r) === signalId
        ? { ...r, ...(r.data ? { data: { ...(r.data as object), assignee: userId } } : { assignee: userId }) }
        : r)))
    } catch (e) {
      setWriteError(/column|assignee/i.test(errText(e))
        ? 'This pod\'s signal table has no `assignee` column yet — add it with `lemma tables add-column signal assignee --type USER`.'
        : errText(e))
    } finally { setAssigning(null) }
  }

  async function setAction(triageId: string, action: string) {
    setBusy(action); setWriteError(null)
    try {
      await lemmaClient.records.update('triage', triageId, { action })
      setTriage((cur) => cur.map((r) => (rowId(r) === triageId
        ? { ...r, ...(r.data ? { data: { ...(r.data as object), action } } : { action }) }
        : r)))
      // The decision just changed; whatever picks it up is new.
      window.setTimeout(refreshRuns, 2500)
    } catch (e) {
      setWriteError(/403/.test(errText(e))
        ? 'You need write access to the triage table to change this.'
        : errText(e))
    } finally { setBusy(null) }
  }

  if (sel && selected) {
    return (
      <div className={`page${chat ? ' chat' : ''}`}>
        <div className="page-inner">
          {chat ? (
            <>
              <div className="chat-head">
                <button className="page-back" onClick={() => setChat(null)}>← Signal</button>
                <h2 style={{ fontSize: 20 }}>Asking about this signal</h2>
                <div className="d-sub"><span>{String(field(selected, 'title'))}</span></div>
              </div>
              <Thread agentName={chat.agent} conversationId={chat.conversationId} />
            </>
          ) : (
            <SignalDetail
              signal={selected}
              triage={triageFor(rowId(selected))}
              dispatchOn={dispatchOn}
              busy={busy}
              writeError={writeError}
              starting={starting}
              startError={startError}
              agent={agent}
              onAgentChange={setAgent}
              connected={connected}
              members={members}
              assigning={assigning === rowId(selected)}
              onAssign={(uid) => void assign(rowId(selected), uid)}
              run={fixerRuns.get(rowId(triageFor(rowId(selected)) ?? {}))}
              onOpenRun={(cid) => go(`conversations/${cid}`)}
              onClose={() => go('signals')}
              onAction={setAction}
              onDiscuss={(seed) => void beginDiscussion(rowId(selected), seed)}
            />
          )}
        </div>
      </div>
    )
  }
  if (sel && !selected && !loading) {
    return <Empty title="That signal is gone" action={
      <button className="btn" onClick={() => go('signals')}>Back to signals</button>
    }>It may have been deleted since this link was made.</Empty>
  }

  return (
    <>
      <header className="head">
        <h1>Signals</h1>
        <span className="count">
          {loading ? '…' : total > signals.length ? `${rows.length} of ${total}` : `${rows.length}`}
        </span>
        <span className="spacer" />
        <div className="filters" role="group" aria-label="Filter signals">
          {FILTERS.map(([k, label]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </header>
      <div className="body">
        <div className="list" role="listbox" aria-label="Signals">
          {loading && <Skeletons />}
          {!loading && error && <Failed title="Couldn't read signals" detail={error}
            action={<button className="btn" onClick={load}>Try again</button>} />}
          {!loading && !error && !rows.length && (
            <Empty title="Nothing in the queue">
              A signal lands when an automation fires. Turn one on, or run{' '}
              <span className="mono">seed/ingest.sh</span> to triage real GitHub history.
            </Empty>
          )}
          {!loading && !error && rows.map((s) => {
            const id = rowId(s)
            const t = triageFor(id)
            const untriaged = ['new', 'triaging'].includes(String(field(s, 'status')))
            const blast = field<number>(t, 'blast_radius')
            return (
              <button key={id} className="row" role="option" aria-selected={sel === id}
                onClick={() => go(`signals/${id}`)}>
                <span className={cx('dot', untriaged ? 'hollow' : String(field(t, 'severity') ?? 'low'))} aria-hidden="true" />
                <span>
                  <span className="title">{String(field(s, 'title') ?? 'untitled')}</span>
                  <span className="meta">
                    <span>{String(field(s, 'source') ?? '')}</span><span className="sep">·</span>
                    <span>{String(field(s, 'kind') ?? '')}</span>
                    {Boolean(field(s, 'repo')) && <><span className="sep">·</span><span className="ell">{String(field(s, 'repo'))}</span></>}
                  </span>
                </span>
                <span className="right">
                  {(() => {
                    const who = byUserId.get(String(field(s, 'assignee') ?? ''))
                    return who
                      ? <span className="who-chip" title={displayName(who)}>
                          <span className="avatar sm" aria-hidden="true">{initials(who)}</span>
                        </span>
                      : null
                  })()}
                  {field(t, 'action') === 'fix' && (
                    isWorking(fixerRuns.get(rowId(t)))
                      ? <span className="onit working" title="An agent is working on this">
                          <span className="spin" />fixer
                        </span>
                      : <span className="onit" title="Marked for fixing">for fixing</span>
                  )}
                  {typeof blast === 'number' && blast > 0 && (
                    <span className="blast">
                      <span className="track"><span className="fill" style={{ width: `${blastPct(blast)}%` }} /></span>
                      <span className="n">{blast} users</span>
                    </span>
                  )}
                  <span className={t ? `chip sev-${String(field(t, 'severity'))}` : 'chip'}>
                    {t ? `${String(field(t, 'verdict'))} · ${String(field(t, 'severity'))}` : String(field(s, 'status'))}
                  </span>
                  <span className="when">{ago(String(field(s, 'received_at') ?? (s as { created_at?: string }).created_at ?? ''))}</span>
                </span>
              </button>
            )
          })}
        </div>

      </div>
    </>
  )
}

/** evidence key → label → the connector id whose account decides whether the
 *  agent could have asked at all. `prior_signals` is the pod's own table, so it
 *  is always reachable. */
const SOURCES: Array<[string, string, string | null]> = [
  ['posthog', 'PostHog', 'posthog'],
  ['sentry', 'Sentry', 'sentry'],
  ['bigquery', 'BigQuery', 'googlebigquery'],
  ['prior_signals', 'Prior signals', null],
]

function SignalDetail({ signal, triage, dispatchOn, busy, writeError, starting, startError, agent, onAgentChange, connected, members, assigning, onAssign, run, onOpenRun, onClose, onAction, onDiscuss }: {
  signal: Row; triage: Row | null; dispatchOn: boolean | null
  busy: string | null; writeError: string | null
  starting: boolean; startError: string | null
  agent: string; onAgentChange: (name: string) => void
  connected: Set<string>
  members: Member[]; assigning: boolean; onAssign: (userId: string | null) => void
  run: FixerRun | undefined; onOpenRun: (conversationId: string) => void
  onClose: () => void; onAction: (triageId: string, action: string) => void
  onDiscuss: (seed: string) => void
}) {
  const url = field<string>(signal, 'external_url')
  const blast = field<number>(triage, 'blast_radius')
  const action = String(field(triage, 'action') ?? '')

  let evidence: Record<string, unknown> = {}
  const raw = field(triage, 'evidence')
  if (typeof raw === 'string') { try { evidence = JSON.parse(raw) } catch { evidence = {} } }
  else if (raw && typeof raw === 'object') evidence = raw as Record<string, unknown>

  const seed = [
    `About this signal in the pod:`,
    ``,
    `Title: ${field(signal, 'title')}`,
    `Source: ${field(signal, 'source')} · ${field(signal, 'kind')}`,
    field(signal, 'repo') ? `Repository: ${field(signal, 'repo')}` : '',
    url ? `URL: ${url}` : '',
    triage ? `Your verdict: ${field(triage, 'verdict')} · ${field(triage, 'severity')} · action ${action}` : 'Not triaged yet.',
    triage ? `Your summary: ${field(triage, 'summary')}` : '',
    ``,
    `Explain your reasoning, and tell me what you would need to be more certain.`,
  ].filter(Boolean).join('\n')

  return (
    <>
      <div className="d-head-page">
        <button className="page-back" onClick={onClose}>← Signals</button>
        <h2>{String(field(signal, 'title') ?? '')}</h2>
        <div className="d-sub">
          <span>{String(field(signal, 'source') ?? '')}</span><span>·</span>
          <span>{String(field(signal, 'kind') ?? '')}</span>
          {Boolean(field(signal, 'repo')) && <><span>·</span><span>{String(field(signal, 'repo'))}</span></>}
          {Boolean(field(signal, 'actor')) && <><span>·</span><span>@{String(field(signal, 'actor'))}</span></>}
        </div>
        <div className="d-actions">
          <button className="btn primary" onClick={() => onDiscuss(seed)} disabled={starting}>
            <MessageSquare size={15} /> {starting ? 'Opening\u2026' : askLabel(agent)}
          </button>
          <AgentPicker value={agent} onChange={onAgentChange} dropUp={false} />
          {url && (
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> Open on {String(field(signal, 'source'))}
            </a>
          )}
        </div>
        {startError && <div className="note err">{startError}</div>}
      </div>

      <div className="sect owner-row">
        <h3>Owner</h3>
        <AssigneePicker
          value={(field<string>(signal, 'assignee') ?? null) || null}
          members={members}
          busy={assigning}
          onChange={onAssign}
        />
        {Boolean(field(triage, 'suggested_owner')) && (
          <p className="prose" style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 10 }}>
            The triager suggested <span className="mono">@{String(field(triage, 'suggested_owner'))}</span> from the repository&apos;s history.
          </p>
        )}
      </div>

      {Boolean(field(signal, 'body')) && (
        <div className="sect"><h3>Event</h3><div className="log">{String(field(signal, 'body'))}</div></div>
      )}

      {!triage ? (
        <div className="sect">
          <h3>Triage</h3>
          <p className="prose" style={{ color: 'var(--ink-2)' }}>
            {field(signal, 'status') === 'triaging'
              ? 'The triager is working on this one.' : 'Not triaged yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="sect">
            <h3>Verdict</h3>
            <div className="verdict">
              <span className={`chip sev-${String(field(triage, 'severity'))}`}>
                {`${String(field(triage, 'verdict'))} · ${String(field(triage, 'severity'))}`}
              </span>
              {typeof field(triage, 'confidence') === 'number' && (
                <span className="chip">confidence {Math.round(Number(field(triage, 'confidence')) * 100)}%</span>
              )}
              <span className={`chip act-${action}`}>{action}</span>
            </div>
            <p className="prose">{String(field(triage, 'summary') ?? '')}</p>
            <div className={cx('blast-lg', blast == null && 'unknown')}>
              <div className="lab">
                <span>Blast radius</span>
                <span>{blast == null ? 'not measured' : 'users in 24h'}</span>
              </div>
              <div className="big">{blast == null ? '—' : String(blast)}</div>
              <div className="track">
                {blast != null && (
                  <span style={{ display: 'block', height: '100%', width: `${blastPct(blast)}%`,
                    background: 'var(--accent)', borderRadius: 3 }} />
                )}
              </div>
            </div>
          </div>

          <div className="sect">
            <h3>Evidence</h3>
            <div className="ledger">
              {SOURCES.map(([key, label, connectorId]) => {
                const reachable = !connectorId || connected.has(connectorId)
                const asked = Object.prototype.hasOwnProperty.call(evidence, key)
                const val = evidence[key]
                const has = asked && val != null && !(Array.isArray(val) && !val.length)
                /* Reachability outranks whatever the row says. An agent with no
                   PostHog account usually records nothing, and calling that
                   "asked, nothing found" states that a question was answered
                   when it was never askable. */
                const text = !reachable
                  ? 'no account connected'
                  : has
                    ? (Array.isArray(val) ? `${val.length} related signal${val.length === 1 ? '' : 's'}` : String(val))
                    : asked ? 'asked, nothing found' : 'not consulted'
                const cls = !reachable ? 'off' : has ? '' : 'none'
                return (
                  <div className={cx('ev', cls)} key={key}>
                    <i aria-hidden="true" />
                    <span className="src">{label}</span>
                    <span className="val">{text}</span>
                  </div>
                )
              })}
            </div>
            {Boolean(field(triage, 'missing_evidence')) && (
              <div className="note">{String(field(triage, 'missing_evidence'))}</div>
            )}
          </div>

          {Boolean(field(triage, 'reproduction')) && (
            <div className="sect"><h3>Reproduction</h3>
              <div className="log">{String(field(triage, 'reproduction'))}</div></div>
          )}

          <div className="sect">
            <h3>Decision</h3>
            <div className="actions" role="group" aria-label="Decision">
              {ACTIONS.map(([key, label]) => {
                const on = action === key
                return (
                  <button key={key} data-act={key} aria-pressed={on}
                    disabled={Boolean(busy) || on}
                    title={on ? `Current decision: ${label}` : `Change decision to ${label}`}
                    onClick={() => onAction(rowId(triage), key)}>
                    {busy === key ? 'Saving…' : label}
                  </button>
                )
              })}
            </div>
            {action === 'fix' && dispatchOn === false && (
              <div className="note">
                Marked for fixing, but <span className="mono">dispatch-fixer</span> is paused,
                so nothing will wake. Turn it on under Automations.
              </div>
            )}
            {action === 'fix' && dispatchOn !== false && (
              run ? (
                <div className={`note run ${isWorking(run) ? 'live' : ''}`}>
                  {isWorking(run) ? <span className="spin" /> : null}
                  <span>
                    {isWorking(run)
                      ? 'The fixer is working on this now.'
                      : `The fixer ran on this — ${run.status.toLowerCase()}.`}
                  </span>
                  <button onClick={() => onOpenRun(run.conversationId)}>Open the run</button>
                </div>
              ) : (
                <div className="note">The fixer wakes on this. Watch Pull requests for the change.</div>
              )
            )}
            {writeError && <div className="note err">{writeError}</div>}
          </div>
        </>
      )}
    </>
  )
}
