/** Pod members, and getting somebody new into the pod.
 *
 *  One invitation does both jobs: `invitations.invite` takes a `pod_id` and a
 *  `pod_role` alongside the organization role, so inviting somebody by email
 *  puts them in the organization *and* this pod in a single call. Adding an
 *  existing organization member is the other path — no email, no round trip,
 *  they are already here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { lemmaClient } from '../lemma-client'
import { errText, items } from './util'

export const POD_ROLES = ['POD_ADMIN', 'POD_EDITOR', 'POD_USER', 'POD_VIEWER'] as const
export type PodRole = (typeof POD_ROLES)[number]

/** What each role can actually do, in the terms this app uses. */
export const ROLE_BLURB: Record<PodRole, string> = {
  POD_ADMIN: 'Everything, including deleting things and managing people.',
  POD_EDITOR: 'Change automations, agents and the app. Cannot delete or manage people.',
  POD_USER: 'Work the queue: set decisions, talk to the agents, run things.',
  POD_VIEWER: 'Read the queue and the changes. Cannot decide anything.',
}

/** One shape, because the two endpoints disagree about almost every field.
 *
 *  A pod member is `{pod_member_id, user_id, user_email, user_name, roles}`.
 *  An organization member is `{id, user_id, role, user: {email, first_name,
 *  last_name}}` — identity nested one level down. Reading either as the other
 *  is why this page rendered a column of "Someone".
 */
export interface Member {
  /** The pod membership id, for role changes and removal. Absent in the org list. */
  id: string
  /** The organization membership id — what `podMembers.add` wants. */
  orgMemberId?: string
  userId: string | null
  email: string | null
  name: string | null
  role: PodRole | null
  orgRole?: string | null
}

interface RawPodMember {
  pod_member_id?: string; id?: string; user_id?: string | null
  email?: string | null; user_email?: string | null; user_name?: string | null
  roles?: string[] | null; role?: string | null
}

interface RawOrgMember {
  id?: string; user_id?: string | null; role?: string | null
  user?: { email?: string | null; first_name?: string | null; last_name?: string | null } | null
}

function fullName(first?: string | null, last?: string | null): string | null {
  const joined = [first, last].filter(Boolean).join(' ').trim()
  return joined || null
}

export function fromPodMember(r: RawPodMember): Member {
  return {
    id: String(r.pod_member_id ?? r.id ?? ''),
    userId: r.user_id ?? null,
    email: r.user_email ?? r.email ?? null,
    name: r.user_name ?? null,
    role: normalizeRole(r.roles?.[0] ?? r.role),
  }
}

export function fromOrgMember(r: RawOrgMember): Member {
  return {
    id: String(r.id ?? ''),
    orgMemberId: String(r.id ?? ''),
    userId: r.user_id ?? null,
    email: r.user?.email ?? null,
    name: fullName(r.user?.first_name, r.user?.last_name),
    role: null,
    orgRole: r.role ?? null,
  }
}

function normalizeRole(raw: string | null | undefined): PodRole {
  return (POD_ROLES as readonly string[]).includes(String(raw)) ? raw as PodRole : 'POD_USER'
}

/** A name if we have one, an email if not — never a placeholder. */
export function displayName(m: Member | undefined | null): string {
  if (!m) return 'Unassigned'
  return m.name || m.email || 'Unknown person'
}

export function initials(m: Member | undefined | null): string {
  if (!m) return '—'
  const source = m.name || m.email || '?'
  const parts = source.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
    || source[0].toUpperCase()
}

export function roleOf(m: Member | undefined | null): PodRole {
  return m?.role ?? 'POD_USER'
}

export function usePodMembers() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    void (async () => {
      try {
        const raw = items<RawPodMember>(
          await lemmaClient.podMembers.list(lemmaClient.podId as string, { limit: 200 }))
        setMembers(raw.map(fromPodMember))
      } catch (e) { setError(errText(e)) }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => { load() }, [load])

  /** user_id -> member, so a `USER` column can be rendered as a person. */
  const byUserId = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of members) if (m.userId) map.set(m.userId, m)
    return map
  }, [members])

  return { members, byUserId, loading, error, refresh: load }
}

export async function inviteByEmail(
  orgId: string, email: string, podRole: PodRole, orgRole = 'ORG_MEMBER',
): Promise<void> {
  await lemmaClient.organizations.invitations.invite(orgId, {
    email: email.trim(),
    role: orgRole,
    // Both in one call: an invitation that lands them in the organization but
    // not this pod would leave them staring at somebody else's workspace.
    pod_id: lemmaClient.podId as string,
    pod_role: podRole,
  } as Parameters<typeof lemmaClient.organizations.invitations.invite>[1])
}

export async function addExistingMember(orgMemberId: string, role: PodRole): Promise<void> {
  await lemmaClient.podMembers.add(lemmaClient.podId as string, {
    organization_member_id: orgMemberId,
    roles: [role],
  })
}

export async function setRole(podMemberId: string, role: PodRole): Promise<void> {
  await lemmaClient.podMembers.updateRole(
    lemmaClient.podId as string, podMemberId, role as Parameters<typeof lemmaClient.podMembers.updateRole>[2],
  )
}

export async function removeMember(podMemberId: string): Promise<void> {
  await lemmaClient.podMembers.remove(lemmaClient.podId as string, podMemberId)
}
