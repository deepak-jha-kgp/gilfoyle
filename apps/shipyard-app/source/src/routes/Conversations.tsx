import { useCallback, useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { ago, cx, errText, items } from '../lib/util'
import { agentLabel } from '../components/AgentPicker'
import { Empty, Failed, Skeletons } from '../components/states'
import { Thread, startDiscussion } from '../components/Thread'

interface Convo {
  id: string; title?: string | null; agent_name?: string | null
  /* The list never carries `agent_name` — only `agent_id` — so resolving the
     name takes the pod's agent list. Falling back to a hard-coded agent made
     every thread claim to be the triager, including ones that were not. */
  agent_id?: string | null
  status?: string | null; updated_at?: string | null; created_at?: string | null
}

const AGENTS = ['triager', 'fixer']

export function Conversations({ id, go }: { id: string | null; go: (to: string) => void }) {
  const [rows, setRows] = useState<Convo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sel = id
  const [starting, setStarting] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [agentById, setAgentById] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = items<{ id?: string; name?: string }>(await lemmaClient.agents.list())
        if (!alive) return
        const map: Record<string, string> = {}
        for (const a of list) if (a.id && a.name) map[a.id] = a.name
        setAgentById(map)
      } catch { /* the name is a nicety; the thread works without it */ }
    })()
    return () => { alive = false }
  }, [])

  const nameFor = (c?: Convo | null) =>
    c?.agent_name ?? (c?.agent_id ? agentById[c.agent_id] : undefined) ?? 'pod_default'

  const load = useCallback(() => {
    setLoading(true); setError(null)
    void (async () => {
      try {
        /* A conversation that was opened and never used has no title and no
           real status. Note the SDK rewrites a null status to "waiting" on the
           way through, so testing the raw field is not enough — that is why an
           earlier filter here silently kept everything. */
        const all = items<Convo>(await lemmaClient.conversations.list({ limit: 100 }))
        const used = (c: Convo) =>
          Boolean(c.title) || (Boolean(c.status) && c.status !== 'waiting')
        setRows(all.filter(used))
      }
      catch (e) { setError(errText(e)) }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => { load() }, [load])


  async function begin(agent: string) {
    setStarting(agent); setStartError(null)
    try {
      const { conversationId, sent } = await startDiscussion(
        agent, 'What is worth my attention in this pod right now?')
      go(`conversations/${conversationId}`)
      void sent.catch((e: unknown) => setStartError(errText(e)))
      load()
    } catch (e) {
      setStartError(errText(e))
    } finally {
      setStarting(null)
    }
  }

  if (sel) {
    const convo = rows.find((r) => r.id === sel)
    return (
      <div className="page chat">
        <div className="page-inner">
          <div className="chat-head">
            <button className="page-back" onClick={() => go('conversations')}>← Conversations</button>
            <h2 style={{ fontSize: 20 }}>{convo?.title || 'Conversation'}</h2>
            <div className="d-sub">
              <span>{agentLabel(nameFor(convo))}</span>
              {convo?.status && <><span>·</span><span>{convo.status.toLowerCase()}</span></>}
            </div>
          </div>
          <Thread key={sel} agentName={nameFor(convo)} conversationId={sel} />
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="head">
        <h1>Conversations</h1>
        <span className="count">{loading ? '…' : rows.length}</span>
        <span className="spacer" />
        <div className="filters">
          {AGENTS.map((a) => (
            <button key={a} disabled={Boolean(starting)}
              onClick={() => void begin(a)}>
              <MessageSquarePlus size={13} style={{ marginRight: 6, display: 'inline' }} />
              {starting === a ? 'Opening…' : `New with ${a}`}
            </button>
          ))}
        </div>
      </header>
      <div className="body">
        <div className="list" role="listbox" aria-label="Conversations">
          {loading && <Skeletons />}
          {error && <Failed title="Couldn't read conversations" detail={error} />}
          {startError && <div className="note err" style={{ margin: 20 }}>{startError}</div>}
          {!loading && !error && !rows.length && (
            <Empty title="No conversations yet">
              Start one from a pull request, an issue, or a signal — the agent gets that
              context as its first message.
            </Empty>
          )}
          {rows.map((c) => (
            <button key={c.id} className="row" role="option" aria-selected={sel === c.id}
              onClick={() => go(`conversations/${c.id}`)}>
              <span className={cx('dot', c.status === 'RUNNING' ? 'open' : 'low')} aria-hidden="true" />
              <span>
                <span className="title">{c.title || 'Untitled conversation'}</span>
                <span className="meta">
                  <span>{agentLabel(nameFor(c))}</span>
                  {c.status && <><span className="sep">·</span><span>{c.status.toLowerCase()}</span></>}
                </span>
              </span>
              <span className="right">
                <span className="when">{ago(c.updated_at ?? c.created_at)}</span>
              </span>
            </button>
          ))}
        </div>

      </div>
    </>
  )
}
