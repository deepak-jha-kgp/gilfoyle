/** A live conversation with a pod agent.
 *
 *  The conversation is created by whoever opened this — see `startDiscussion`
 *  below — so nothing here sends on mount. That matters: an effect that posts a
 *  message is torn down and re-run by StrictMode, and the first send is aborted
 *  half-way with "signal is aborted without reason".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConversationMessages } from 'lemma-sdk/react'
import { SendHorizontal, Square } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { errText } from '../lib/util'
import { agentLabel } from './AgentPicker'
import { Markdown } from './Markdown'
import { MentionList, mentionContext, useMentionInput, useMentionables } from './Mentions'
import { useApp } from '../lib/app-context'
import { Working } from './states'

export interface ThreadProps {
  agentName: string
  conversationId: string | null
}

/** Open a thread with `agentName` and post the opening message.
 *
 *  Returns as soon as the conversation exists, because `messages.send` does not
 *  resolve until the agent's whole turn ends — awaiting it would leave the
 *  button saying "Opening…" for as long as the agent works, with the thread
 *  the person asked for still not on screen. The send is handed back so the
 *  caller can report a failure without blocking on a success.
 */
export async function startDiscussion(
  agentName: string, seed: string,
): Promise<{ conversationId: string; sent: Promise<unknown> }> {
  const convo = await lemmaClient.conversations.create({
    agent_name: agentName,
    pod_id: lemmaClient.podId as string,
  })
  const conversationId = (convo as { id?: string }).id
  if (!conversationId) throw new Error('The server created a conversation without an id.')
  const sent = lemmaClient.conversations.messages.send(conversationId, { content: seed })
  return { conversationId, sent }
}

export function Thread({ agentName, conversationId }: ThreadProps) {
  const thread = useConversationMessages({
    client: lemmaClient,
    podId: lemmaClient.podId as string,
    agentName,
    conversationId,
    enabled: Boolean(conversationId),
    autoLoad: true,
    autoResume: true,
  })
  const { orgId, repo } = useApp()
  const mentionables = useMentionables(orgId, repo)
  const mention = useMentionInput(mentionables)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  /* The run was started outside this hook — `startDiscussion` posts the opening
     message itself — so the hook has no reason to think anything is in flight
     and would sit showing the person's own message with no sign of life.
     `expectRun` makes it keep asking for a few seconds rather than concluding
     from one read that the conversation is idle. */
  const resumed = useRef<string | null>(null)
  useEffect(() => {
    if (!conversationId || resumed.current === conversationId) return
    resumed.current = conversationId
    // This hook's `resumeIfRunning` takes no options, and one read right after
    // the send can still see an idle conversation, so ask a few times.
    let tries = 0
    const poll = () => {
      void thread.resumeIfRunning(conversationId)
        .then((running) => {
          if (!running && ++tries < 6) setTimeout(poll, 1500)
        })
        .catch(() => { /* nothing running is an answer, not a failure */ })
    }
    poll()
  }, [conversationId, thread])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.messages.length, thread.streamingText])

  async function send() {
    const text = draft.trim()
    if (!text || !conversationId || thread.isRunning) return
    setDraft('')
    setSendError(null)
    const withContext = text + mentionContext(mention.picked)
    mention.setPicked([])
    try {
      await thread.sendMessage(withContext, { conversationId })
    } catch (e) {
      setSendError(errText(e))
      setDraft(text)
    }
  }

  /* A turn emits THINKING / TOOL_CALL / TOOL_RETURN / TEXT. Prose gets a bubble;
     reasoning and tool calls are *trace* and get grouped into one run rather than
     a stack of loose blocks, because a long turn otherwise reads as twenty
     unrelated messages. TOOL_RETURN is dropped — it is the payload, not the step. */
  type Msg = {
    id?: string; role?: string; kind?: string; text?: string; content?: string
    tool_name?: string; metadata?: { tool_name?: string } | null
  }
  type Item =
    | { type: 'msg'; key: string; role: string; text: string }
    | { type: 'trace'; key: string; steps: Array<{ kind: 'think' | 'tool'; text: string; times: number }> }

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    ;(thread.messages as Msg[]).forEach((m, i) => {
      const kind = String(m.kind ?? '').toUpperCase()
      const role = String(m.role ?? 'assistant')
      const key = m.id ?? `i${i}`
      if (kind === 'TOOL_RETURN') return

      if (role === 'user' || kind === 'TEXT' || kind === '') {
        const text = String(m.text ?? m.content ?? '')
        if (!text.trim()) return
        out.push({ type: 'msg', key, role, text })
        return
      }
      if (kind !== 'THINKING' && kind !== 'TOOL_CALL') return

      const step = kind === 'TOOL_CALL'
        ? { kind: 'tool' as const, text: String(m.tool_name ?? m.metadata?.tool_name ?? 'a tool').replace(/_/g, ' '), times: 1 }
        : { kind: 'think' as const, text: String(m.text ?? '').trim(), times: 1 }
      if (step.kind === 'think' && !step.text) return

      const last = out[out.length - 1]
      if (last && last.type === 'trace') {
        const prev = last.steps[last.steps.length - 1]
        // "pod get records" twice in a row is one step that happened twice.
        if (prev && prev.kind === step.kind && prev.text === step.text) prev.times += 1
        else last.steps.push(step)
      } else {
        out.push({ type: 'trace', key, steps: [step] })
      }
    })
    return out
  }, [thread.messages])

  return (
    <div className="thread">
      <div className="thread-scroll" ref={scroller}>
        {thread.isLoading && <Working label="Loading the thread" />}
        {!thread.isLoading && !items.length && !thread.streamingText && !thread.isRunning && (
          <p style={{ color: 'var(--ink-3)', fontSize: 13.5 }}>
            {agentName === 'pod_default' ? `Ask ${agentLabel(agentName)}` : `Ask the ${agentLabel(agentName).toLowerCase()}`} about this. It can read the pod&apos;s tables and reach GitHub
            through the pod&apos;s connected account.
          </p>
        )}
        {items.map((item) => item.type === 'msg'
          ? <Bubble key={item.key} role={item.role} text={item.text} agentName={agentName} />
          : (
            <div className="trace" key={item.key}>
              {item.steps.map((s, i) => <Step key={i} step={s} />)}
            </div>
          ))}
        {thread.streamingText && (
          <div className="msg">
            <span className="who">{agentLabel(agentName)}</span>
            <div className="bubble">{thread.streamingText}</div>
          </div>
        )}
        {thread.isRunning && !thread.streamingText && <Working label={`${agentLabel(agentName)} is working`} />}
        {(sendError || thread.error) && (
          <div className="note err">{sendError ?? errText(thread.error)}</div>
        )}
      </div>
      <div className="composer">
        {mention.open && (
          <MentionList rows={mention.matches} active={mention.active}
            onPick={(m) => mention.pick(m, draft, setDraft)} />
        )}
        <textarea
          ref={mention.ref}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); mention.onChange(e.target) }}
          onKeyDown={(e) => {
            if (mention.onKeyDown(e, draft, setDraft)) return
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
          }}
          placeholder={`Message ${agentLabel(agentName)}\u2026`}
          aria-label={`Message ${agentLabel(agentName)}`}
          rows={1}
        />
        {thread.isRunning ? (
          <button className="btn" onClick={() => void thread.stop()} title="Stop">
            <Square size={14} /> Stop
          </button>
        ) : (
          <button className="btn primary" onClick={() => void send()}
            disabled={!draft.trim() || !conversationId}>
            <SendHorizontal size={15} /> Send
          </button>
        )}
      </div>
    </div>
  )
}

/** A schedule-triggered run opens with prose *and* the raw row event appended:
 *
 *      The schedule "dispatch-fixer" started this run.
 *      What to do: ...
 *      { "payload": { ...forty lines... } }
 *
 *  So the test is not "is this message JSON" — it is "does a JSON object hang off
 *  the end of it". Split there: the instruction is the part a person reads, the
 *  event is the part they open when they want it.
 */
function splitPayload(text: string): { prose: string; payload: string | null } {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trimEnd() !== '{') continue
    const tail = lines.slice(i).join('\n').trim()
    if (!tail.endsWith('}')) continue
    try {
      const parsed: unknown = JSON.parse(tail)
      // Only worth folding when it is actually bulky.
      if (tail.length < 200) return { prose: text, payload: null }
      return {
        prose: lines.slice(0, i).join('\n').trim(),
        payload: JSON.stringify(parsed, null, 2),
      }
    } catch { /* not the start of the object; keep looking */ }
  }
  return { prose: text, payload: null }
}

function Bubble({ role, text, agentName }: { role: string; text: string; agentName: string }) {
  const mine = role === 'user'
  const { prose, payload } = mine ? splitPayload(text) : { prose: text, payload: null }
  return (
    <>
      {prose.trim() && (
        <div className={`msg ${mine ? 'me' : ''}`}>
          <span className="who">{mine ? 'You' : agentLabel(agentName)}</span>
          <div className="bubble">{mine ? prose : <Markdown text={prose} />}</div>
        </div>
      )}
      {payload && (
        <details className="payload">
          <summary>Trigger payload</summary>
          <pre>{payload}</pre>
        </details>
      )}
    </>
  )
}

/** One line of trace. A reasoning step can run to several paragraphs, which
 *  buries the tool calls around it, so long ones clamp and open on click. */
function Step({ step }: { step: { kind: 'think' | 'tool'; text: string; times: number } }) {
  const [open, setOpen] = useState(false)
  const long = step.kind === 'think' && step.text.length > 280
  return (
    <div
      className={`step ${step.kind}${long ? ' long' : ''}${open ? ' open' : ''}`}
      onClick={long ? () => setOpen((v) => !v) : undefined}
      role={long ? 'button' : undefined}
      tabIndex={long ? 0 : undefined}
      onKeyDown={long ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) }
      } : undefined}
      title={long && !open ? 'Show the whole thought' : undefined}
    >
      {step.kind === 'tool' ? `→ ${step.text}` : step.text}
      {step.times > 1 && <span className="times"> ×{step.times}</span>}
    </div>
  )
}
