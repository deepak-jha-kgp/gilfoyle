/** `@` in a composer pulls a pull request or issue in by number.
 *
 *  The mention is not decoration: the picked item's title, state, author and
 *  body travel with the message, so the agent gets the thing itself rather than
 *  a number it would have to go and look up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lemmaClient } from '../lemma-client'
import { listIssues, listPulls, type Issue, type PullRequest } from '../lib/github'
import { displayName, usePodMembers } from '../lib/people'

export interface Mentionable {
  kind: 'pr' | 'issue' | 'person'
  /** The number for a PR or issue; people have none. */
  number?: number
  title: string
  state?: string
  author?: string
  url?: string
  body?: string
  /** People only: how the agent should address them. */
  handle?: string
  userId?: string
}

/** Everything mentionable: the open work in this repository, and the people in
 *  the pod. A message that names a colleague should carry who they actually are,
 *  so the agent can reach them rather than guess at a name. */
export function useMentionables(orgId: string | null, repo: string | null) {
  const [rows, setRows] = useState<Mentionable[]>([])
  const { members } = usePodMembers()
  useEffect(() => {
    if (!orgId || !repo) { setRows([]); return }
    let alive = true
    void (async () => {
      const [prs, issues] = await Promise.all([
        listPulls(lemmaClient, orgId, repo, 'open').catch(() => [] as PullRequest[]),
        listIssues(lemmaClient, orgId, repo, 'open').catch(() => [] as Issue[]),
      ])
      if (!alive) return
      setRows([
        ...prs.map((p): Mentionable => ({
          kind: 'pr', number: p.number, title: p.title, state: p.draft ? 'draft' : 'open',
          author: p.user?.login ?? 'unknown', url: p.html_url, body: p.body ?? '',
        })),
        ...issues.map((i): Mentionable => ({
          kind: 'issue', number: i.number, title: i.title, state: i.state,
          author: i.user?.login ?? 'unknown', url: i.html_url, body: i.body ?? '',
        })),
      ])
    })()
    return () => { alive = false }
  }, [orgId, repo])

  return useMemo(() => [
    ...members.map((m): Mentionable => ({
      kind: 'person',
      title: displayName(m),
      handle: m.email ?? displayName(m),
      userId: m.userId ?? undefined,
    })),
    ...rows,
  ], [members, rows])
}

/** The `@…` token the caret currently sits in, if any. */
export function activeMention(value: string, caret: number): { query: string; from: number } | null {
  const upto = value.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at === -1) return null
  // Only when `@` starts a word, and only while the token has no space in it.
  if (at > 0 && !/\s/.test(upto[at - 1])) return null
  const query = upto.slice(at + 1)
  if (/\s/.test(query)) return null
  return { query, from: at }
}

export function matchMentions(rows: Mentionable[], query: string): Mentionable[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    // People first on a bare `@`: that is what the character means everywhere else.
    return [...rows].sort((a, b) => (a.kind === 'person' ? -1 : 0) - (b.kind === 'person' ? -1 : 0)).slice(0, 8)
  }
  return rows.filter((r) =>
    (r.number !== undefined && String(r.number).startsWith(q))
    || r.title.toLowerCase().includes(q)
    || (r.handle ?? '').toLowerCase().includes(q),
  ).slice(0, 8)
}

/** What gets appended to the message so the agent has the item, not just a number. */
export function mentionContext(picked: Mentionable[]): string {
  if (!picked.length) return ''
  const people = picked.filter((m) => m.kind === 'person')
  const work = picked.filter((m) => m.kind !== 'person')
  const blocks: string[] = []
  if (people.length) {
    blocks.push(['People named in this message (pod members you can reach with your',
      'messaging tools — do not invent an address):',
      ...people.map((m) => `- ${m.title}${m.handle ? ` <${m.handle}>` : ''}`)].join('\n'))
  }
  if (work.length) {
    blocks.push(['Referenced:', ...work.map((m) => [
      `${m.kind === 'pr' ? 'PR' : 'Issue'} #${m.number}: ${m.title}`,
      `State: ${m.state} · @${m.author}`,
      `URL: ${m.url}`,
      (m.body ?? '').trim() ? `Body: ${(m.body ?? '').slice(0, 2500)}` : '',
    ].filter(Boolean).join('\n'))].join('\n\n'))
  }
  return `\n\n${blocks.join('\n\n')}`
}

export function MentionList({ rows, active, onPick }: {
  rows: Mentionable[]; active: number; onPick: (m: Mentionable) => void
}) {
  if (!rows.length) return null
  return (
    <div className="mentions" role="listbox" aria-label="Pull requests and issues">
      {rows.map((m, i) => (
        <button key={`${m.kind}-${m.number ?? m.handle}`} role="option" aria-selected={i === active}
          className={i === active ? 'on' : undefined}
          onMouseDown={(e) => { e.preventDefault(); onPick(m) }}>
          <span className={`mk ${m.kind}`}>
            {m.kind === 'pr' ? 'PR' : m.kind === 'issue' ? 'IS' : '@'}
          </span>
          {m.number !== undefined && <span className="num">#{m.number}</span>}
          <span className="ttl">{m.title}</span>
        </button>
      ))}
    </div>
  )
}

/** Shared behaviour for a textarea that supports `@`. */
export function useMentionInput(rows: Mentionable[]) {
  const [picked, setPicked] = useState<Mentionable[]>([])
  const [query, setQuery] = useState<{ query: string; from: number } | null>(null)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  const matches = useMemo(
    () => (query ? matchMentions(rows, query.query) : []),
    [rows, query],
  )

  useEffect(() => { setActive(0) }, [query?.query])

  const onChange = useCallback((el: HTMLTextAreaElement) => {
    setQuery(activeMention(el.value, el.selectionStart ?? el.value.length))
  }, [])

  const pick = useCallback((m: Mentionable, value: string, setValue: (v: string) => void) => {
    if (!query) return
    const caret = ref.current?.selectionStart ?? value.length
    const token = m.kind === 'person' ? `@${m.title}` : `#${m.number}`
    const next = `${value.slice(0, query.from)}${token} ${value.slice(caret)}`
    setValue(next)
    setPicked((cur) => (cur.some((c) => c.kind === m.kind && c.number === m.number && c.handle === m.handle)
      ? cur : [...cur, m]))
    setQuery(null)
    queueMicrotask(() => {
      const el = ref.current
      if (!el) return
      const at = query.from + token.length + 1
      el.focus(); el.setSelectionRange(at, at)
    })
  }, [query])

  /** True when the key was consumed by the mention list. */
  const onKeyDown = useCallback((e: React.KeyboardEvent, value: string, setValue: (v: string) => void) => {
    if (!query || !matches.length) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active], value, setValue); return true }
    if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return true }
    return false
  }, [query, matches, active, pick])

  return { ref, matches, active, picked, setPicked, onChange, onKeyDown, pick, open: Boolean(query) }
}
