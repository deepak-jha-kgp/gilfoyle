import { useCallback, useEffect, useState } from 'react'
import { lemmaClient } from '../lemma-client'
import { ago, errText, items } from '../lib/util'
import { Empty, Failed, Skeletons } from '../components/states'

interface Schedule {
  id: string; name: string; schedule_type: string
  agent_name?: string | null; workflow_name?: string | null
  instruction?: string | null; filter_instruction?: string | null
  is_active: boolean; config?: Record<string, unknown> | null
  last_fired_at?: string | null; last_fire_status?: string | null
  consecutive_failures?: number
}

function chips(s: Schedule): Array<[string, string]> {
  const c = s.config ?? {}
  const out: Array<[string, string]> = []
  if (s.schedule_type === 'WEBHOOK') {
    out.push(['source', String(c.source ?? '—')])
    out.push(['event', String(c.event ?? '—')])
    if (c.installation_id) out.push(['installation', String(c.installation_id)])
    out.push(['repos', c.repository_id ? String(c.repository_id) : 'all'])
  } else if (s.schedule_type === 'DATASTORE') {
    out.push(['table', String(c.table_name ?? '—')])
    out.push(['on', (Array.isArray(c.operations) ? c.operations : []).join(' + ').toLowerCase() || '—'])
    const when = c.when as Record<string, unknown> | undefined
    if (when) {
      out.push(['when', Object.entries(when).map(([k, v]) =>
        `${k} → ${v && typeof v === 'object'
          ? String((v as Record<string, unknown>).to ?? (v as Record<string, unknown>).equals ?? JSON.stringify(v))
          : String(v)}`).join(', ')])
    }
  } else {
    out.push(['cron', String(c.cron ?? c.scheduled_at ?? '—')])
    if (c.timezone) out.push(['zone', String(c.timezone)])
  }
  return out
}

export function Automations() {
  const [rows, setRows] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    void (async () => {
      try {
        const res = await lemmaClient.schedules.list({ limit: 100 })
        const order: Record<string, number> = { WEBHOOK: 0, DATASTORE: 1, TIME: 2 }
        setRows(items<Schedule>(res).sort((a, b) =>
          (order[a.schedule_type] - order[b.schedule_type]) || a.name.localeCompare(b.name)))
      } catch (e) { setError(errText(e)) }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(s: Schedule) {
    setBusy(s.id); setWriteError(null)
    try {
      await lemmaClient.schedules.update(s.id, { is_active: !s.is_active })
      setRows((cur) => cur.map((r) => (r.id === s.id ? { ...r, is_active: !s.is_active } : r)))
    } catch (e) {
      setWriteError(/403/.test(errText(e))
        ? 'You need permission to update schedules in this pod.' : errText(e))
    } finally { setBusy(null) }
  }

  const on = rows.filter((r) => r.is_active).length

  return (
    <>
      <header className="head">
        <h1>Automations</h1>
        <span className="count">{loading ? '…' : `${on} of ${rows.length} on`}</span>
      </header>
      <div className="list">
        <div className="cards">
          {loading && <Skeletons n={3} />}
          {error && <Failed title="Couldn't read automations" detail={error} />}
          {writeError && <div className="note err">{writeError}</div>}
          {!loading && !error && !rows.length && (
            <Empty title="No automations">
              An automation connects something happening — a webhook, a row changing, a
              time arriving — to an agent in this pod.
            </Empty>
          )}
          {rows.map((s) => (
            <article className="card2" key={s.id}>
              <div className="card2-head">
                <span className={`dot ${s.is_active ? 'open' : 'hollow'}`} aria-hidden="true" />
                <h2>{s.name}</h2>
                <span className="target">→ {s.agent_name ?? s.workflow_name ?? '—'}</span>
                <span className="sw">
                  <span className="lab">{s.is_active ? 'on' : 'paused'}</span>
                  <button role="switch" aria-checked={s.is_active} disabled={busy === s.id}
                    aria-label={`${s.is_active ? 'Pause' : 'Turn on'} ${s.name}`}
                    onClick={() => void toggle(s)}>
                    <span className="track-sw" />
                  </button>
                </span>
              </div>
              <div className="card2-body">
                <div className="trigger">
                  {chips(s).map(([k, v]) => (
                    <span className="chip" key={k}>
                      <span style={{ color: 'var(--ink-3)' }}>{k}</span>{v}
                    </span>
                  ))}
                </div>
                {s.instruction && (
                  <div className="block"><span className="k">Instructions</span><p>{s.instruction}</p></div>
                )}
                {s.filter_instruction && (
                  <div className="block"><span className="k">Only run when</span><p>{s.filter_instruction}</p></div>
                )}
              </div>
              <div className="card2-foot">
                <span>{s.schedule_type.toLowerCase()}</span>
                <span>{s.last_fired_at
                  ? `last fired ${ago(s.last_fired_at)} ago · ${String(s.last_fire_status ?? '—').toLowerCase()}`
                  : 'never fired'}</span>
                {Boolean(s.consecutive_failures) && <span>{s.consecutive_failures} failures in a row</span>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  )
}
