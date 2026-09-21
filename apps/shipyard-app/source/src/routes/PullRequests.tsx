import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, MessageSquare, X } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { useApp } from '../lib/app-context'
import {
  listPulls, loadPullDetail, mergeTimeline, prState, labelNames,
  type Comment, type PrFilter, type PullDetail, type PullRequest,
} from '../lib/github'
import { ago, cx, errText } from '../lib/util'
import { Empty, Failed, Skeletons, Working } from '../components/states'
import { Thread, startDiscussion } from '../components/Thread'
import { Markdown } from '../components/Markdown'
import { AgentPicker, askLabel, useAgentChoice } from '../components/AgentPicker'

const FILTERS: Array<[PrFilter, string]> = [
  ['open', 'Open'], ['merged', 'Merged'], ['closed', 'Closed'], ['all', 'All'],
]

export function PullRequests({ id, go }: { id: string | null; go: (to: string) => void }) {
  const { orgId, repo } = useApp()
  const [filter, setFilter] = useState<PrFilter>('open')
  const [rows, setRows] = useState<PullRequest[]>([])
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
      try { setRows(await listPulls(lemmaClient, orgId, repo, filter)) }
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

  const selected = useMemo(() => rows.find((p) => p.number === sel) ?? null, [rows, sel])

  const [detail, setDetail] = useState<PullDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  useEffect(() => {
    if (!orgId || !repo || !selected) { setDetail(null); return }
    let alive = true
    setDetail(null); setDetailLoading(true)
    void (async () => {
      const d = await loadPullDetail(lemmaClient, orgId, repo, selected.number, selected.head?.sha)
      if (!alive) return
      setDetail(d); setDetailLoading(false)
    })()
    return () => { alive = false }
  }, [orgId, repo, selected])

  if (!repo) {
    return <Empty title="No repository selected">
      Pick a repository in the sidebar. The list is every repository the pod's GitHub
      App installation can reach.
    </Empty>
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
            <PrDetail pr={selected}
              repo={repo}
              detail={detail}
              detailLoading={detailLoading}
              starting={starting}
              startError={startError}
              agent={agent}
              onAgentChange={setAgent}
              onClose={() => go('pulls')}
              onDiscuss={(seed) => void beginDiscussion(selected.number, seed)} />
          )}
        </div>
      </div>
    )
  }
  if (sel && !selected && !loading) {
    return (
      <Empty title={`#${sel} is not in this view`}
        action={<button className="btn" onClick={() => go('pulls')}>Back to pull requests</button>}>
        It may have been merged or closed since this link was made — try the All filter.
      </Empty>
    )
  }

  return (
    <>
      <header className="head">
        <h1>Pull requests</h1>
        <span className="count">{loading ? '…' : `${rows.length}${rows.length === 100 ? '+' : ''}`}</span>
        <span className="spacer" />
        <div className="filters" role="group" aria-label="Filter pull requests">
          {FILTERS.map(([k, label]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </header>
      <div className="body">
        <div className="list" role="listbox" aria-label="Pull requests">
          {loading && <Skeletons />}
          {!loading && error && (
            <Failed title="Couldn't read pull requests" detail={error}
              action={<button className="btn" onClick={load}>Try again</button>} />
          )}
          {!loading && !error && !rows.length && (
            <Empty title={`No ${filter === 'all' ? '' : filter} pull requests`}>
              Nothing matching in <span className="mono">{repo}</span>.
            </Empty>
          )}
          {!loading && !error && rows.map((p) => {
            const st = prState(p)
            const labels = labelNames(p.labels)
            return (
              <button key={p.id} className="row" role="option" aria-selected={sel === p.number}
                onClick={() => go(`pulls/${p.number}`)}>
                <span className={cx('dot', st)} aria-hidden="true" />
                <span>
                  <span className="title">{p.title}</span>
                  <span className="meta">
                    <span>#{p.number}</span><span className="sep">·</span>
                    <span>@{p.user?.login ?? 'unknown'}</span>
                    {p.head?.ref && <><span className="sep">·</span><span className="ell">{p.head.ref}</span></>}
                    {labels.length > 0 && <><span className="sep">·</span><span className="ell">{labels.join(', ')}</span></>}
                  </span>
                </span>
                <span className="right">
                  {typeof p.changed_files === 'number' && <span>{p.changed_files} files</span>}
                  <span className={`chip st-${st}`}>{st}</span>
                  <span className="when">{ago(p.updated_at)}</span>
                </span>
              </button>
            )
          })}
        </div>

      </div>
    </>
  )
}

function PrDetail({ pr, repo, detail, detailLoading, onClose, onDiscuss, starting, startError, agent, onAgentChange }: {
  pr: PullRequest; repo: string
  detail: PullDetail | null; detailLoading: boolean
  onClose: () => void; onDiscuss: (seed: string) => void
  starting: boolean; startError: string | null
  agent: string; onAgentChange: (name: string) => void
}) {
  const st = prState(pr)
  const timeline = detail ? mergeTimeline(detail) : []
  const failing = (detail?.checks ?? []).filter(
    (c) => c.conclusion && !['success', 'neutral', 'skipped'].includes(c.conclusion))
  const seed = [
    `Look at this pull request and tell me whether it is safe to merge, what it risks, and who should review it.`,
    ``,
    `Repository: ${repo}`,
    `PR #${pr.number}: ${pr.title}`,
    `State: ${st}${pr.merged_at ? ` (merged ${pr.merged_at})` : ''}`,
    `Author: @${pr.user?.login ?? 'unknown'}`,
    `Branch: ${pr.head?.ref ?? '?'} → ${pr.base?.ref ?? '?'}`,
    typeof pr.changed_files === 'number'
      ? `Size: ${pr.changed_files} files, +${pr.additions ?? 0} −${pr.deletions ?? 0}`
      : '',
    `URL: ${pr.html_url}`,
    ``,
    `Description:`,
    (pr.body ?? '(no description)').slice(0, 4000),
    ...(timeline.length ? ['', 'Conversation so far:',
      ...timeline.slice(-12).map((c) =>
        `@${c.user?.login ?? 'unknown'}${c.state && c.state !== 'COMMENTED' ? ` [${c.state}]` : ''}` +
        `${c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ''}` : ''}: ` +
        `${(c.body ?? '').slice(0, 600)}`)] : []),
    ...(failing.length ? ['', `Failing checks: ${failing.map((c) => c.name).join(', ')}`] : []),
  ].filter(Boolean).join('\n')

  return (
    <>
      <div className="d-head-page">
        <button className="page-back" onClick={onClose}>← Pull requests</button>
        <h2>{pr.title}</h2>
        <div className="d-sub">
          <span>#{pr.number}</span><span>·</span>
          <span>{st}</span><span>·</span>
          <span>@{pr.user?.login ?? 'unknown'}</span><span>·</span>
          <span>{ago(pr.updated_at)} ago</span>
        </div>
        <div className="d-actions">
          <button className="btn primary" onClick={() => onDiscuss(seed)} disabled={starting}>
            <MessageSquare size={15} /> {starting ? 'Opening\u2026' : askLabel(agent)}
          </button>
          <AgentPicker value={agent} onChange={onAgentChange} dropUp={false} />
          <a className="btn" href={pr.html_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Open on GitHub
          </a>
        </div>
        {startError && <div className="note err">{startError}</div>}
      </div>

      <div className="sect">
        <h3>Branch</h3>
        <div className="kv"><span className="k">Head</span><span className="v mono">{pr.head?.ref ?? '—'}</span></div>
        <div className="kv"><span className="k">Base</span><span className="v mono">{pr.base?.ref ?? '—'}</span></div>
        {typeof pr.changed_files === 'number' && (
          <div className="kv">
            <span className="k">Size</span>
            <span className="v mono">{pr.changed_files} files · +{pr.additions ?? 0} −{pr.deletions ?? 0}</span>
          </div>
        )}
        <div className="kv"><span className="k">Opened</span><span className="v mono">{pr.created_at.slice(0, 10)}</span></div>
        {pr.merged_at && <div className="kv"><span className="k">Merged</span><span className="v mono">{pr.merged_at.slice(0, 10)}</span></div>}
        {!pr.merged_at && pr.closed_at && <div className="kv"><span className="k">Closed</span><span className="v mono">{pr.closed_at.slice(0, 10)}</span></div>}
      </div>

      <div className="sect">
        <h3>Description</h3>
        {pr.body?.trim()
          ? <Markdown text={pr.body} />
          : <p className="prose" style={{ color: 'var(--ink-3)' }}>No description.</p>}
      </div>

      {detailLoading && (
        <div className="sect"><Working label="Reading the conversation" /></div>
      )}

      {detail && detail.checks.length > 0 && (
        <div className="sect">
          <h3>Checks · {failing.length ? `${failing.length} failing` : 'all green'}</h3>
          <div className="ledger">
            {detail.checks.slice(0, 40).map((c) => {
              const bad = c.conclusion && !['success', 'neutral', 'skipped'].includes(c.conclusion)
              const running = !c.conclusion
              return (
                <div className={`ev ${bad ? 'none' : running ? 'off' : ''}`} key={c.id}>
                  <i aria-hidden="true" style={bad
                    ? { background: 'var(--critical)', border: 'none' }
                    : running ? { background: 'var(--high)', border: 'none' } : undefined} />
                  <span className="src">{c.conclusion ?? c.status}</span>
                  <span className="val">
                    {c.html_url
                      ? <a href={c.html_url} target="_blank" rel="noopener noreferrer">{c.name}</a>
                      : c.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {detail && detail.files.length > 0 && (
        <div className="sect">
          <h3>Files · {detail.files.length}</h3>
          <div className="files">
            {detail.files.slice(0, 120).map((f) => (
              <div className="file" key={f.filename}>
                <span className="fname" title={f.filename}>{f.filename}</span>
                <span className="fdiff">
                  <span className="add">+{f.additions}</span>
                  <span className="del">−{f.deletions}</span>
                </span>
              </div>
            ))}
            {detail.files.length > 120 && (
              <p className="prose" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                …and {detail.files.length - 120} more.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="sect">
        <h3>Conversation · {timeline.length}</h3>
        {!detail && !detailLoading && (
          <p className="prose" style={{ color: 'var(--ink-3)' }}>Not loaded.</p>
        )}
        {detail && !timeline.length && (
          <p className="prose" style={{ color: 'var(--ink-3)' }}>Nobody has said anything yet.</p>
        )}
        <div className="timeline">
          {timeline.map((c) => <Remark key={`${c.id}-${c.submitted_at ?? c.created_at}`} c={c} />)}
        </div>
        {detail?.partial.length ? (
          <div className="note">
            Couldn&apos;t read {detail.partial.join(', ')} for this pull request — shown without them.
          </div>
        ) : null}
      </div>
    </>
  )
}

const REVIEW_STATE: Record<string, string> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', DISMISSED: 'dismissed',
}

function Remark({ c }: { c: Comment }) {
  const state = c.state && c.state !== 'COMMENTED' ? REVIEW_STATE[c.state] ?? c.state.toLowerCase() : null
  return (
    <div className="remark">
      <div className="rhead">
        <span className="who">@{c.user?.login ?? 'unknown'}</span>
        {state && (
          <span className={`chip ${c.state === 'APPROVED' ? 'st-open' : 'sev-high'}`}>{state}</span>
        )}
        {c.path && (
          <span className="where" title={c.path}>
            {c.path.split('/').pop()}{c.line ? `:${c.line}` : ''}
          </span>
        )}
        <span className="when">{ago(c.submitted_at ?? c.created_at)}</span>
      </div>
      {(c.body ?? '').trim() && <Markdown text={c.body as string} />}
    </div>
  )
}
