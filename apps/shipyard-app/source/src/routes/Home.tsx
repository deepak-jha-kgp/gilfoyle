import { useCallback, useEffect, useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { errText, field, items } from '../lib/util'
import { startDiscussion } from '../components/Thread'
import { AgentPicker, agentLabel, useAgentChoice } from '../components/AgentPicker'
import {
  MentionList, mentionContext, useMentionInput, useMentionables,
} from '../components/Mentions'
import { useApp } from '../lib/app-context'
import { useCurrentUser } from 'lemma-sdk/react'

type Row = Record<string, unknown>

export function Home({ go, onOpenConversation }: {
  go: (to: string) => void
  onOpenConversation: (id: string) => void
}) {
  const [agent, setAgent] = useAgentChoice()
  const { orgId, repo } = useApp()
  const { user } = useCurrentUser({ client: lemmaClient })
  const meId = (user as { id?: string } | undefined)?.id ?? null
  const mentionables = useMentionables(orgId, repo)
  const mention = useMentionInput(mentionables)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ mine: number; triage: number; fix: number; prs: number } | null>(null)
  useEffect(() => { mention.ref.current?.focus() }, [mention.ref])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [s, t, p] = await Promise.all([
          lemmaClient.records.list('signal', { limit: 200 }),
          lemmaClient.records.list('triage', { limit: 400 }),
          lemmaClient.records.list('pull_request', { limit: 200 }),
        ])
        if (!live) return
        const signals = items<Row>(s)
        setCounts({
          mine: meId ? signals.filter((r) => field(r, 'assignee') === meId).length : 0,
          triage: signals.filter((r) => ['new', 'triaging'].includes(String(field(r, 'status')))).length,
          fix: items<Row>(t).filter((r) => field(r, 'action') === 'fix').length,
          prs: items<Row>(p).filter((r) => ['drafting', 'open', 'checks_failing', 'checks_passing']
            .includes(String(field(r, 'state')))).length,
        })
      } catch { if (live) setCounts(null) }
    })()
    return () => { live = false }
  }, [meId])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true); setError(null)
    try {
      const { conversationId, sent } = await startDiscussion(
        agent, text + mentionContext(mention.picked))
      setDraft('')
      mention.setPicked([])
      void sent.catch((e: unknown) => setError(errText(e)))
      onOpenConversation(conversationId)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }, [draft, busy, agent, onOpenConversation, mention])

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`
  }

  return (
    <div className="home">
      <div className="home-inner">
        <div>
          <h1>What needs doing?</h1>
          <p className="lede">
            {agent === 'pod_default'
              ? 'Gilfoyle reads the queue and this org’s repositories — and opens a pull request when you ask.'
              : `Talking to the ${agentLabel(agent).toLowerCase()}.`}
          </p>
        </div>

        <div className="composer-card">
          {mention.open && (
            <MentionList rows={mention.matches} active={mention.active}
              onPick={(m) => mention.pick(m, draft, setDraft)} />
          )}
          <textarea
            ref={mention.ref}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); grow(e.target); mention.onChange(e.target) }}
            onKeyDown={(e) => {
              if (mention.onKeyDown(e, draft, setDraft)) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault(); void send()
              }
            }}
            placeholder="Ask about the queue, a failing check — or @ a pull request or issue."
            aria-label="Message the agent"
          />
          {mention.picked.length > 0 && (
            <div className="picked">
              {mention.picked.map((m) => (
                <span className="p" key={`${m.kind}-${m.number ?? m.handle}`}>
                  {m.kind === 'person' ? `@${m.title}` : `#${m.number}`}
                  <button aria-label={`Remove ${m.kind === 'person' ? m.title : `#${m.number}`}`}
                    onClick={() => mention.setPicked((cur) =>
                      cur.filter((c) => !(c.kind === m.kind && c.number === m.number && c.handle === m.handle)))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-bar">
            <AgentPicker value={agent} onChange={setAgent} />
            <span className="hint">↵ to send</span>
            <button className="btn primary" onClick={() => void send()} disabled={!draft.trim() || busy}>
              <SendHorizontal size={15} /> {busy ? 'Opening…' : 'Send'}
            </button>
          </div>
        </div>

        {error && <div className="note err">{error}</div>}

        {counts && (
          <div className="waiting">
            <button onClick={() => go('signals')}>
              <div className={`n ${counts.mine ? '' : 'zero'}`}>{counts.mine}</div>
              <div className="l">assigned to you</div>
            </button>
            <button onClick={() => go('signals')}>
              <div className={`n ${counts.triage ? 'hot' : 'zero'}`}>{counts.triage}</div>
              <div className="l">waiting on triage</div>
            </button>
            <button onClick={() => go('signals')}>
              <div className={`n ${counts.fix ? 'hot' : 'zero'}`}>{counts.fix}</div>
              <div className="l">marked for fixing</div>
            </button>
            <button onClick={() => go('pulls')}>
              <div className={`n ${counts.prs ? '' : 'zero'}`}>{counts.prs}</div>
              <div className="l">changes in flight</div>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
