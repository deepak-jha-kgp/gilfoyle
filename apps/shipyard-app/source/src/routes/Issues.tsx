import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, MessageSquare, X } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { useApp } from '../lib/app-context'
import { listIssues, loadIssueComments, labelNames, type Comment, type Issue } from '../lib/github'
import { ago, cx, errText } from '../lib/util'
import { Empty, Failed, Skeletons, Working } from '../components/states'
import { Thread, startDiscussion } from '../components/Thread'
import { Markdown } from '../components/Markdown'
import { AgentPicker, askLabel, useAgentChoice } from '../components/AgentPicker'

type IssueFilter = 'open' | 'closed' | 'all'
const FILTERS: Array<[IssueFilter, string]> = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']]

export function Issues({ id, go }: { id: string | null; go: (to: string) => void }) {
  const { orgId, repo } = useApp()
  const [filter, setFilter] = useState<IssueFilter>('open')
  const [rows, setRows] = useState<Issue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chat, setChat] = useState<{ number: number; conversationId: string; agent: string } | null>(null)
  const [agent, setAgent] = useAgentChoice()
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!orgId || !repo) return
    setLoading(true); setError(null)
    void (async () => {
      try { setRows(await listIssues(lemmaClient, orgId, repo, filter)) }
      catch (e) { setError(errText(e)); setRows([]) }
      finally { setLoading(false) }
    })()
  }, [orgId, repo, filter])

  useEffect(() => { setChat(null); load() }, [load])

  const sel = id ? Number(id) : null

  async function beginDiscussion(key: number, seed: string) {
    setStarting(true); setStartError(null)
    try {
      const { conversationId, sent } = await startDiscussion(agent, seed)
      setChat({ number: key, conversationId, agent })
      // The turn can take minutes; only its failure is worth reporting here.
      void sent.catch((e: unknown) => setStartError(errText(e)))
    } catch (e) {
      setStartError(errText(e))
    } finally {
      setStarting(false)
    }
  }

  const selected = useMemo(() => rows.find((i) => i.number === sel) ?? null, [rows, sel])

  const [comments, setComments] = useState<Comment[] | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  useEffect(() => {
    if (!orgId || !repo || !selected) { setComments(null); return }
    let alive = true
    setComments(null); setCommentsLoading(true)
    void (async () => {
      const { comments: got } = await loadIssueComments(lemmaClient, orgId, repo, selected.number)
      if (!alive) return
      setComments(got); setCommentsLoading(false)
    })()
    return () => { alive = false }
  }, [orgId, repo, selected])

  if (!repo) {
    return <Empty title="No repository selected">Pick a repository in the sidebar.</Empty>
  }

  if (sel && selected) {
    return (
      <div className={`page${chat ? ' chat' : ''}`}>
        <div className="page-inner">
          {chat && chat.number === selected.number ? (
            <>
              <div className="chat-head">
                <button className="page-back" onClick={() => setChat(null)}>← #{selected.number}</button>
                <h2 style={{ fontSize: 20 }}>Asking about #{selected.number}</h2>
                <div className="d-sub"><span>{selected.title}</span></div>
              </div>
              <Thread agentName={chat.agent} conversationId={chat.conversationId} />
            </>
          ) : (
            <IssueDetail issue={selected} repo={repo}
              comments={comments} commentsLoading={commentsLoading}
              starting={starting} startError={startError}
              agent={agent} onAgentChange={setAgent}
              onClose={() => go('issues')}
              onDiscuss={(seed) => void beginDiscussion(selected.number, seed)} />
          )}
        </div>
      </div>
    )
  }
  if (sel && !selected && !loading) {
    return <Empty title={`#${sel} is not in this list`} action={
      <button className="btn" onClick={() => go('issues')}>Back to issues</button>
    }>Try the All filter, or a different repository.</Empty>
  }

  return (
    <>
      <header className="head">
        <h1>Issues</h1>
        <span className="count">{loading ? '…' : `${rows.length}${rows.length === 100 ? '+' : ''}`}</span>
        <span className="spacer" />
        <div className="filters" role="group" aria-label="Filter issues">
          {FILTERS.map(([k, label]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </header>
      <div className="body">
        <div className="list" role="listbox" aria-label="Issues">
          {loading && <Skeletons />}
          {!loading && error && (
            <Failed title="Couldn't read issues" detail={error}
              action={<button className="btn" onClick={load}>Try again</button>} />
          )}
          {!loading && !error && !rows.length && (
            <Empty title={`No ${filter === 'all' ? '' : filter} issues`}>
              Nothing matching in <span className="mono">{repo}</span>.
            </Empty>
          )}
          {!loading && !error && rows.map((i) => {
            const labels = labelNames(i.labels)
            return (
              <button key={i.id} className="row" role="option" aria-selected={sel === i.number}
                onClick={() => go(`issues/${i.number}`)}>
                <span className={cx('dot', i.state === 'open' ? 'open' : 'closed')} aria-hidden="true" />
                <span>
                  <span className="title">{i.title}</span>
                  <span className="meta">
                    <span>#{i.number}</span><span className="sep">·</span>
                    <span>@{i.user?.login ?? 'unknown'}</span>
                    {labels.length > 0 && <><span className="sep">·</span><span className="ell">{labels.join(', ')}</span></>}
                  </span>
                </span>
                <span className="right">
                  {typeof i.comments === 'number' && i.comments > 0 && <span>{i.comments} comments</span>}
                  <span className={`chip st-${i.state === 'open' ? 'open' : 'closed'}`}>{i.state}</span>
                  <span className="when">{ago(i.updated_at)}</span>
                </span>
              </button>
            )
          })}
        </div>

      </div>
    </>
  )
}

function IssueDetail({ issue, repo, comments, commentsLoading, onClose, onDiscuss, starting, startError, agent, onAgentChange }: {
  issue: Issue; repo: string
  comments: Comment[] | null; commentsLoading: boolean
  onClose: () => void; onDiscuss: (seed: string) => void
  starting: boolean; startError: string | null
  agent: string; onAgentChange: (name: string) => void
}) {
  const labels = labelNames(issue.labels)
  const seed = [
    `Triage this issue: decide what it actually is, how much it matters, and what should happen next.`,
    ``,
    `Repository: ${repo}`,
    `Issue #${issue.number}: ${issue.title}`,
    `State: ${issue.state}${issue.state_reason ? ` (${issue.state_reason})` : ''}`,
    `Author: @${issue.user?.login ?? 'unknown'}`,
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    `URL: ${issue.html_url}`,
    ``,
    `Body:`,
    (issue.body ?? '(no body)').slice(0, 4000),
    ...((comments ?? []).length ? ['', 'Comments so far:',
      ...(comments ?? []).slice(-12).map((c) =>
        `@${c.user?.login ?? 'unknown'}: ${(c.body ?? '').slice(0, 600)}`)] : []),
  ].filter(Boolean).join('\n')

  return (
    <>
      <div className="d-head-page">
        <button className="page-back" onClick={onClose}>← Issues</button>
        <h2>{issue.title}</h2>
        <div className="d-sub">
          <span>#{issue.number}</span><span>·</span>
          <span>{issue.state}</span><span>·</span>
          <span>@{issue.user?.login ?? 'unknown'}</span><span>·</span>
          <span>{ago(issue.updated_at)} ago</span>
        </div>
        <div className="d-actions">
          <button className="btn primary" onClick={() => onDiscuss(seed)} disabled={starting}>
            <MessageSquare size={15} /> {starting ? 'Opening\u2026' : askLabel(agent)}
          </button>
          <AgentPicker value={agent} onChange={onAgentChange} dropUp={false} />
          <a className="btn" href={issue.html_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Open on GitHub
          </a>
        </div>
        {startError && <div className="note err">{startError}</div>}
      </div>

      {labels.length > 0 && (
        <div className="sect">
          <h3>Labels</h3>
          <div className="trigger">{labels.map((l) => <span className="chip" key={l}>{l}</span>)}</div>
        </div>
      )}

      <div className="sect">
        <h3>Body</h3>
        {issue.body?.trim()
          ? <Markdown text={issue.body} />
          : <p className="prose" style={{ color: 'var(--ink-3)' }}>No body.</p>}
      </div>

      <div className="sect">
        <h3>Comments · {comments?.length ?? 0}</h3>
        {commentsLoading && <Working label="Reading the comments" />}
        {comments && !comments.length && (
          <p className="prose" style={{ color: 'var(--ink-3)' }}>Nobody has replied.</p>
        )}
        <div className="timeline">
          {(comments ?? []).map((c) => (
            <div className="remark" key={c.id}>
              <div className="rhead">
                <span className="who">@{c.user?.login ?? 'unknown'}</span>
                <span className="when">{ago(c.created_at)}</span>
              </div>
              {(c.body ?? '').trim() && <Markdown text={c.body as string} />}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
