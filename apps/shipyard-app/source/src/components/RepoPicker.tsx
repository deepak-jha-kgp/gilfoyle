import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown, GitBranch } from 'lucide-react'
import { useApp } from '../lib/app-context'

export function RepoPicker() {
  const { repos, repo, setRepo, reposLoading, reposError } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 })

  useEffect(() => {
    if (!open) return
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 280) })
    const close = (e: MouseEvent) => {
      if (!btn.current?.contains(e.target as Node)) setOpen(false)
    }
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

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return repos.slice(0, 80)
    return repos.filter((r) => r.full_name.toLowerCase().includes(needle)).slice(0, 80)
  }, [repos, q])

  const [owner, name] = (repo ?? '/').split('/')

  return (
    <div className="repopick">
      <button ref={btn} onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}>
        <GitBranch size={15} style={{ flex: 'none', color: 'var(--ink-3)' }} />
        <span className="who">
          <b>{name || (reposLoading ? 'Loading repositories…' : 'No repository')}</b>
          <span>{owner || (reposError ? 'could not list repositories' : 'connect GitHub')}</span>
        </span>
        <ChevronsUpDown size={14} style={{ flex: 'none', color: 'var(--ink-3)' }} />
      </button>
      {open && (
        <div className="menu" role="listbox"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onClick={(e) => e.stopPropagation()}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Filter repositories" aria-label="Filter repositories" />
          {reposError && <div className="empty-note">{reposError}</div>}
          {!reposError && !shown.length && (
            <div className="empty-note">
              {reposLoading ? 'Loading…' : 'No repositories the GitHub App can reach.'}
            </div>
          )}
          {shown.map((r) => (
            <button key={r.id} role="option" aria-selected={r.full_name === repo}
              onClick={() => { setRepo(r.full_name); setOpen(false); setQ('') }}>
              {r.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
