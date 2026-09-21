/** Which agent a thread should go to. The pod assistant is the default because
 *  it is the one that can both answer and act; the triager and fixer are there
 *  for when the job is squarely theirs. */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface AgentChoice { name: string; label: string; blurb: string }

/* `pod_default` is the wire name and stays the wire name — POD_DEFAULT is what
   the backend resolves. Gilfoyle is only what people call it. */
export const AGENTS: AgentChoice[] = [
  { name: 'pod_default', label: 'Gilfoyle',
    blurb: 'Answers, and can go and change code — clone, fix, open a pull request.' },
  { name: 'triager', label: 'Triager',
    blurb: 'Judges what something is and how much it matters. Never touches code.' },
  { name: 'fixer', label: 'Fixer',
    blurb: 'Reproduces, makes the smallest change, opens a pull request. Never merges.' },
]

const KEY = 'shipyard:agent'

export function useAgentChoice(): [string, (name: string) => void] {
  const [name, setName] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(KEY)
      return saved && AGENTS.some((a) => a.name === saved) ? saved : 'pod_default'
    } catch { return 'pod_default' }
  })
  const set = (next: string) => {
    setName(next)
    try { localStorage.setItem(KEY, next) } catch { /* private window */ }
  }
  return [name, set]
}

export function agentLabel(name: string): string {
  return AGENTS.find((a) => a.name === name)?.label ?? name
}

/** "Ask Gilfoyle", but "Ask the triager" — one is a name, the others are roles. */
export function askLabel(name: string): string {
  return name === 'pod_default'
    ? `Ask ${agentLabel(name)}`
    : `Ask the ${agentLabel(name).toLowerCase()}`
}

export function AgentPicker({ value, onChange, dropUp = true }: {
  value: string; onChange: (name: string) => void; dropUp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // A frame's delay, or the click that opened this closes it again.
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="agentpick" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}>
        <span className="who"><span className="pip" />{agentLabel(value)}</span>
        <ChevronDown size={13} style={{ color: 'var(--ink-3)' }} />
      </button>
      {open && (
        <div className={`agentmenu${dropUp ? '' : ' up'}`} role="listbox">
          {AGENTS.map((a) => (
            <button key={a.name} role="option" aria-selected={a.name === value}
              onClick={() => { onChange(a.name); setOpen(false) }}>
              <b>{a.label}</b><span>{a.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
