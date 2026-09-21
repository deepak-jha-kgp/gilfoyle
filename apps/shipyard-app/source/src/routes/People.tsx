import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mail, RefreshCw, UserPlus, X } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { useApp } from '../lib/app-context'
import { errText, items } from '../lib/util'
import {
  POD_ROLES, ROLE_BLURB, addExistingMember, displayName, fromOrgMember, initials,
  inviteByEmail, removeMember, roleOf, setRole, usePodMembers,
  type Member, type PodRole,
} from '../lib/people'
import { Empty, Failed, Skeletons } from '../components/states'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function People() {
  const { orgId } = useApp()
  const { members, loading, error, refresh } = usePodMembers()
  const [orgMembers, setOrgMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRoleChoice] = useState<PodRole>('POD_USER')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const loadOrg = useCallback(() => {
    if (!orgId) return
    void (async () => {
      try {
        const raw = items<Parameters<typeof fromOrgMember>[0]>(
          await lemmaClient.organizations.members.list(orgId, { limit: 200 }))
        setOrgMembers(raw.map(fromOrgMember))
      } catch { /* the invite path does not need this list */ }
    })()
  }, [orgId])
  useEffect(() => { loadOrg() }, [loadOrg])

  /** People already in the organization but not in this pod — no email needed. */
  const addable = useMemo(() => {
    const here = new Set(members.map((m) => m.userId).filter(Boolean))
    return orgMembers.filter((m) => m.userId && !here.has(m.userId))
  }, [orgMembers, members])

  async function invite() {
    const value = email.trim()
    if (!EMAIL.test(value)) {
      setNote({ kind: 'err', text: 'That does not look like an email address.' })
      return
    }
    if (!orgId) { setNote({ kind: 'err', text: 'No organization context.' }); return }
    setBusy(true); setNote(null)
    try {
      await inviteByEmail(orgId, value, role)
      setEmail('')
      setNote({ kind: 'ok', text: `Invited ${value}. They get an email, and land in this pod when they accept.` })
      refresh()
    } catch (e) {
      setNote({ kind: 'err', text: errText(e) })
    } finally { setBusy(false) }
  }

  async function addHere(m: Member) {
    const id = m.orgMemberId ?? m.id
    setRowBusy(id); setNote(null)
    try {
      await addExistingMember(id, role)
      setNote({ kind: 'ok', text: `${displayName(m)} added to the pod.` })
      refresh(); loadOrg()
    } catch (e) { setNote({ kind: 'err', text: errText(e) }) }
    finally { setRowBusy(null) }
  }

  async function changeRole(m: Member, next: PodRole) {
    setRowBusy(m.id); setNote(null)
    try { await setRole(m.id, next); refresh() }
    catch (e) { setNote({ kind: 'err', text: errText(e) }) }
    finally { setRowBusy(null) }
  }

  async function drop(m: Member) {
    setRowBusy(m.id); setNote(null)
    try {
      await removeMember(m.id)
      setNote({ kind: 'ok', text: `${displayName(m)} removed from the pod.` })
      refresh(); loadOrg()
    } catch (e) { setNote({ kind: 'err', text: errText(e) }) }
    finally { setRowBusy(null) }
  }

  return (
    <>
      <header className="head">
        <h1>People</h1>
        <span className="count">{loading ? '…' : `${members.length} in this pod`}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { refresh(); loadOrg() }} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>
      <div className="page">
        <div className="page-inner people">
          <p className="lede">
            Everyone here sees the same queue. What they can <em>do</em> with it is their
            role — and an agent acting for somebody never reaches further than they could
            themselves.
          </p>

          <div className="invite">
            <div className="invite-row">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void invite() }}
                placeholder="Invite by email…"
                type="email"
                autoComplete="off"
                aria-label="Email address to invite"
              />
              <select value={role} onChange={(e) => setRoleChoice(e.target.value as PodRole)}
                aria-label="Pod role">
                {POD_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace('POD_', '').toLowerCase()}</option>
                ))}
              </select>
              <button className="btn primary" onClick={() => void invite()} disabled={busy}>
                <Mail size={15} /> {busy ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            <p className="role-hint">{ROLE_BLURB[role]}</p>
            {note && <div className={`note ${note.kind === 'err' ? 'err' : ''}`}>{note.text}</div>}
          </div>

          {error && <Failed title="Couldn't read the members" detail={error} />}
          {loading && <Skeletons n={3} />}

          {!loading && !error && (
            <>
              <h2 className="sect-label">In this pod</h2>
              {!members.length && <Empty title="Nobody yet">Invite someone above.</Empty>}
              <div className="people-list">
                {members.map((m) => (
                  <div className="person" key={m.id}>
                    <span className="avatar" aria-hidden="true">{initials(m)}</span>
                    <span className="who">
                      <span className="nm">{displayName(m)}</span>
                      {m.name && m.email && <span className="sub">{m.email}</span>}
                    </span>
                    <select
                      className="role-select"
                      value={roleOf(m)}
                      disabled={rowBusy === m.id}
                      onChange={(e) => void changeRole(m, e.target.value as PodRole)}
                      aria-label={`Role for ${displayName(m)}`}
                    >
                      {POD_ROLES.map((r) => (
                        <option key={r} value={r}>{r.replace('POD_', '').toLowerCase()}</option>
                      ))}
                    </select>
                    <button className="drop" onClick={() => void drop(m)} disabled={rowBusy === m.id}
                      aria-label={`Remove ${displayName(m)}`} title="Remove from this pod">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {addable.length > 0 && (
                <>
                  <h2 className="sect-label">Already in the organization</h2>
                  <p className="role-hint" style={{ marginBottom: 12 }}>
                    These people can be added straight away — no invitation to accept.
                  </p>
                  <div className="people-list">
                    {addable.map((m) => (
                      <div className="person" key={m.id}>
                        <span className="avatar" aria-hidden="true">{initials(m)}</span>
                        <span className="who">
                          <span className="nm">{displayName(m)}</span>
                          {m.name && m.email && <span className="sub">{m.email}</span>}
                        </span>
                        <button className="btn sm" onClick={() => void addHere(m)}
                          disabled={rowBusy === (m.orgMemberId ?? m.id)}>
                          <UserPlus size={14} /> Add to pod
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
