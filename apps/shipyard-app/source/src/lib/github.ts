/** GitHub, reached through the pod's connector — never a token in the browser.
 *
 *  Every call is `connectors.operations.execute` on the org's `github` install,
 *  running as the signed-in user's connected account. If they have not connected
 *  one, the call fails with an account-resolution error and the UI says so
 *  rather than showing an empty list, which would read as "no pull requests".
 */
import type { LemmaClient } from 'lemma-sdk'
import { items } from './util'

const AUTH_CONFIG = 'github'

export interface Repo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  default_branch: string
  pushed_at?: string
}

export interface PullRequest {
  id: number
  number: number
  title: string
  body?: string | null
  state: 'open' | 'closed'
  draft?: boolean
  merged_at?: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  html_url: string
  user?: { login: string } | null
  head?: { ref: string; sha?: string } | null
  base?: { ref: string } | null
  labels?: Array<{ name: string }>
  comments?: number
  additions?: number
  deletions?: number
  changed_files?: number
}

export interface Issue {
  id: number
  number: number
  title: string
  body?: string | null
  state: 'open' | 'closed'
  state_reason?: string | null
  created_at: string
  updated_at: string
  closed_at?: string | null
  html_url: string
  user?: { login: string } | null
  labels?: Array<{ name: string } | string>
  comments?: number
  pull_request?: unknown
}

export type PrFilter = 'open' | 'closed' | 'merged' | 'all'

async function exec<T>(
  client: LemmaClient,
  organizationId: string,
  operation: string,
  payload: Record<string, unknown>,
): Promise<T[]> {
  const res = await client.connectors.operations.execute(
    { organizationId, authConfigName: AUTH_CONFIG },
    operation,
    payload,
  )
  return items<T>((res as { result?: unknown })?.result ?? res)
}

export async function listRepos(client: LemmaClient, organizationId: string): Promise<Repo[]> {
  // The user-scoped listing first, because it is the one every install
  // answers. `apps_list_repos_accessible_to_installation` is the narrower and
  // more honest set — exactly what the pod can act on — but a GitHub App whose
  // token is user-scoped refuses it outright, and asking anyway put a 403 in
  // the console on every single load.
  try {
    return await exec<Repo>(client, organizationId, 'repos_list_for_authenticated_user',
      { per_page: 100, sort: 'pushed', direction: 'desc' })
  } catch (first) {
    try {
      return await exec<Repo>(client, organizationId,
        'apps_list_repos_accessible_to_installation', { per_page: 100 })
    } catch {
      throw first
    }
  }
}

export async function listPulls(
  client: LemmaClient, organizationId: string, repo: string, filter: PrFilter,
): Promise<PullRequest[]> {
  const [owner, name] = repo.split('/')
  // GitHub has no "merged" state — a merged PR is closed with a merge date.
  // Ask for closed and separate them here, or the filter would silently be wrong.
  const state = filter === 'merged' ? 'closed' : filter
  const rows = await exec<PullRequest>(client, organizationId, 'pulls_list', {
    owner, repo: name, state, per_page: 100, sort: 'updated', direction: 'desc',
  })
  if (filter === 'merged') return rows.filter((p) => Boolean(p.merged_at))
  if (filter === 'closed') return rows.filter((p) => !p.merged_at)
  return rows
}

export async function listIssues(
  client: LemmaClient, organizationId: string, repo: string, state: 'open' | 'closed' | 'all',
): Promise<Issue[]> {
  const [owner, name] = repo.split('/')
  const rows = await exec<Issue>(client, organizationId, 'issues_list_for_repo', {
    owner, repo: name, state, per_page: 100, sort: 'updated', direction: 'desc',
  })
  // GitHub's issues endpoint returns pull requests too. They have their own page.
  return rows.filter((i) => !i.pull_request)
}

export function prState(p: PullRequest): 'open' | 'merged' | 'closed' | 'draft' {
  if (p.merged_at) return 'merged'
  if (p.state === 'closed') return 'closed'
  if (p.draft) return 'draft'
  return 'open'
}

export function labelNames(labels?: Array<{ name: string } | string>): string[] {
  if (!labels) return []
  return labels.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean)
}


/* ---------- the rest of a pull request / issue ---------- */

export interface Comment {
  id: number
  body?: string | null
  created_at: string
  user?: { login: string } | null
  html_url?: string
  /** Set on review comments: which file and line the remark is attached to. */
  path?: string | null
  line?: number | null
  /** Set on reviews: APPROVED / CHANGES_REQUESTED / COMMENTED. */
  state?: string | null
  submitted_at?: string | null
}

export interface ChangedFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
}

export interface CheckRun {
  id: number
  name: string
  status: string
  conclusion?: string | null
  html_url?: string | null
  started_at?: string | null
  completed_at?: string | null
}

/** Everything under a pull request, gathered in one pass.
 *
 *  Each part fails independently: a repository can refuse check runs while
 *  happily returning comments, and losing the whole page because one call 403'd
 *  would be worse than showing the three that worked.
 */
export interface PullDetail {
  comments: Comment[]
  reviews: Comment[]
  reviewComments: Comment[]
  files: ChangedFile[]
  checks: CheckRun[]
  partial: string[]
}

async function attempt<T>(
  label: string, run: () => Promise<T[]>, failures: string[],
): Promise<T[]> {
  try {
    return await run()
  } catch {
    failures.push(label)
    return []
  }
}

export async function loadPullDetail(
  client: LemmaClient, organizationId: string, repo: string, number: number, headSha?: string,
): Promise<PullDetail> {
  const [owner, name] = repo.split('/')
  const base = { owner, repo: name, per_page: 100 }
  const partial: string[] = []
  const [comments, reviews, reviewComments, files, checks] = await Promise.all([
    // A pull request is an issue as far as top-level comments are concerned.
    attempt('comments', () => exec<Comment>(client, organizationId, 'issues_list_comments',
      { ...base, issue_number: number }), partial),
    attempt('reviews', () => exec<Comment>(client, organizationId, 'pulls_list_reviews',
      { ...base, pull_number: number }), partial),
    attempt('review comments', () => exec<Comment>(client, organizationId, 'pulls_list_review_comments',
      { ...base, pull_number: number }), partial),
    attempt('files', () => exec<ChangedFile>(client, organizationId, 'pulls_list_files',
      { ...base, pull_number: number }), partial),
    headSha
      ? attempt('checks', async () => {
          const res = await client.connectors.operations.execute(
            { organizationId, authConfigName: AUTH_CONFIG }, 'checks_list_for_ref',
            { ...base, ref: headSha },
          )
          const payload = (res as { result?: { check_runs?: CheckRun[] } })?.result
          return payload?.check_runs ?? []
        }, partial)
      : Promise.resolve([] as CheckRun[]),
  ])
  return { comments, reviews, reviewComments, files, checks, partial }
}

export async function loadIssueComments(
  client: LemmaClient, organizationId: string, repo: string, number: number,
): Promise<{ comments: Comment[]; partial: string[] }> {
  const [owner, name] = repo.split('/')
  const partial: string[] = []
  const comments = await attempt('comments', () => exec<Comment>(
    client, organizationId, 'issues_list_comments',
    { owner, repo: name, issue_number: number, per_page: 100 }), partial)
  return { comments, partial }
}

/** Reviews, review comments and plain comments on one timeline, oldest first —
 *  the order the conversation actually happened in. */
export function mergeTimeline(d: PullDetail): Comment[] {
  const all = [...d.comments, ...d.reviews, ...d.reviewComments]
    .filter((c) => (c.body ?? '').trim() || (c.state && c.state !== 'COMMENTED'))
  return all.sort((a, b) =>
    String(a.submitted_at ?? a.created_at ?? '').localeCompare(String(b.submitted_at ?? b.created_at ?? '')))
}
