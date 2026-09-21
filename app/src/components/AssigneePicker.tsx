/** Who is on a signal. A `USER` column holds a user id; this turns it into a
 *  person, and back again. */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, UserRound } from 'lucide-react'
import { displayName, initials, type Member } from '../lib/people'

export function AssigneePicker({ value, members, busy, onChange }: {
  value: string | null
  members: Member[]
  busy?: boolean
  onChange: (userId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = members.find((m) => m.userId === value)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="assignee" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={busy}
        aria-haspopup="listbox" aria-expanded={open}>
        {current
          ? <span className="avatar sm" aria-hidden="true">{initials(current)}</span>
          : <UserRound size={14} style={{ color: 'var(--ink-3)' }} />}
        <span>{busy ? 'Saving…' : current ? displayName(current) : 'Unassigned'}</span>
        <ChevronDown size={13} style={{ color: 'var(--ink-3)' }} />
      </button>
      {open && (
        <div className="assignee-menu" role="listbox">
          <button role="option" aria-selected={!value}
            onClick={() => { onChange(null); setOpen(false) }}>
            <span className="avatar sm" aria-hidden="true">—</span> Unassigned
          </button>
          {members.map((m) => (
            <button key={m.id} role="option" aria-selected={m.userId === value}
              onClick={() => { onChange(m.userId ?? null); setOpen(false) }}>
              <span className="avatar sm" aria-hidden="true">{initials(m)}</span>
              <span className="who">
                <b>{displayName(m)}</b>
                {m.email && <span>{m.email}</span>}
              </span>
            </button>
          ))}
          {!members.length && <div className="empty-note">No pod members to assign to.</div>}
        </div>
      )}
    </div>
  )
}
