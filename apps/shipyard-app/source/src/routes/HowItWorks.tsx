/** The loop, in one page. Written because the app shows a queue, a set of
 *  automations and two agents without ever saying how they connect — and the
 *  connection is the whole product.
 *
 *  It reads live state where live state is the honest answer: an automation that
 *  is paused says so here, because a diagram claiming events arrive when nothing
 *  is listening is worse than no diagram.
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Radio, ShieldCheck, Wrench } from 'lucide-react'
import { lemmaClient } from '../lemma-client'
import { useApp } from '../lib/app-context'
import { errText, items } from '../lib/util'

interface Schedule { id: string; name: string; schedule_type: string; is_active: boolean }

const EVIDENCE: Array<[string, string, string]> = [
  ['posthog', 'PostHog', 'how many real people hit it'],
  ['sentry', 'Sentry', 'whether it is live, and since when'],
  ['googlebigquery', 'BigQuery', 'whether money moved through it'],
  ['linear', 'Linear', 'issues raised outside GitHub'],
]

export function HowItWorks({ go }: { go: (to: string) => void }) {
  const { connected } = useApp()
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void (async () => {
      try { setSchedules(items<Schedule>(await lemmaClient.schedules.list({ limit: 100 }))) }
      catch (e) { setError(errText(e)) }
    })()
  }, [])
  useEffect(() => { load() }, [load])

  const inbound = (schedules ?? []).filter((s) => s.schedule_type === 'WEBHOOK')
  const inboundOn = inbound.filter((s) => s.is_active).length
  const dispatch = (schedules ?? []).find((s) => s.name === 'dispatch-fixer')

  return (
    <>
      <header className="head"><h1>How it works</h1></header>
      <div className="page">
        <div className="page-inner how">
          <p className="lede">
            Four steps. An event arrives, an agent judges it with evidence, a person
            decides, and a second agent does the work. The two agents are kept apart
            on purpose — the one that reads everything cannot change anything.
          </p>

          <ol className="flow">
            <li>
              <span className="n">1</span>
              <div>
                <h3><Radio size={15} /> Something happens</h3>
                <p>
                  A CI run goes red, a pull request opens, someone files an issue. The
                  pod&apos;s GitHub App sends it to an <b>automation</b>, and a fast model
                  <em>&ldquo;only run when&rdquo;</em>{' '}
                  before anything expensive starts. Most events are dropped here.
                </p>
                <p className={inboundOn ? 'state on' : 'state off'}>
                  {schedules === null ? 'Reading automations…'
                    : inboundOn
                      ? `${inboundOn} of ${inbound.length} inbound automations are on.`
                      : `All ${inbound.length} inbound automations are paused — nothing is arriving on its own.`}
                  {' '}
                  <button onClick={() => go('automations')}>Automations</button>
                </p>
              </div>
            </li>

            <li>
              <span className="n">2</span>
              <div>
                <h3><ShieldCheck size={15} /> The triager judges it</h3>
                <p>
                  It writes a <b>signal</b> (what arrived) and a <b>triage</b> (what it
                  means): a verdict, a severity, and how sure it is. Before deciding
                  severity it goes and gets evidence the repository cannot supply —
                  that is the part worth paying for.
                </p>
                <div className="ev-grid">
                  {EVIDENCE.map(([id, label, why]) => (
                    <div className={`ev-card ${connected.has(id) ? 'on' : 'off'}`} key={id}>
                      <b>{label}</b>
                      <span>{why}</span>
                      <em>{connected.has(id) ? 'connected' : 'no account'}</em>
                    </div>
                  ))}
                </div>
                <p className="state off">
                  A source with no account is recorded as <em>no account connected</em>,
                  never as a zero — the difference between &ldquo;nobody is affected&rdquo;
                  and &ldquo;we never asked&rdquo; is the whole point.
                  {' '}
                  <button onClick={() => go('connections')}>Connections</button>
                </p>
              </div>
            </li>

            <li>
              <span className="n">3</span>
              <div>
                <h3><ArrowRight size={15} /> You decide</h3>
                <p>
                  Every signal carries one decision: <b>Fix it</b>, <b>Escalate</b>, <b>Watch</b> or <b>Close</b>. The triager sets an opening position and
                  you overrule it whenever it is wrong. Nothing else in the pod acts on
                  a signal until this is set.
                </p>
                <p>
                  A signal also carries an <b>owner</b>. Assigning one is how the queue
                  stops being everybody&apos;s and starts being somebody&apos;s — and an
                  agent acting for that person never reaches further than they could
                  themselves.
                </p>
                <p className="state on">
                  <button onClick={() => go('signals')}>Signals</button>
                  {' · '}
                  <button onClick={() => go('people')}>People</button>
                </p>
              </div>
            </li>

            <li>
              <span className="n">4</span>
              <div>
                <h3><Wrench size={15} /> The fixer opens a pull request</h3>
                <p>
                  Setting a decision to <b>Fix it</b> is the only thing that wakes it —
                  from the app or from the triager, through the same door. It reproduces
                  the problem first, makes the smallest change, runs the repository&apos;s
                  own checks, and opens a pull request. It never merges and never pushes
                  to a default branch.
                </p>
                <p className={dispatch?.is_active ? 'state on' : 'state off'}>
                  {dispatch === undefined ? 'Reading automations…'
                    : dispatch?.is_active
                      ? 'dispatch-fixer is on — marking a signal for fixing starts a run.'
                      : 'dispatch-fixer is paused — marking a signal for fixing records the decision, but nothing will wake.'}
                  {' '}
                  <button onClick={() => go('automations')}>Automations</button>
                </p>
              </div>
            </li>
          </ol>

          <div className="how-note">
            <h3>Two rules underneath</h3>
            <p>
              <b>Nothing has access by default.</b> Each agent reaches only the tables
              and connectors it was granted by name, and only ever as far as the person
              who invoked it could reach themselves.
            </p>
            <p>
              <b>Reading and writing are different jobs.</b> The triager runs on every
              event and cannot touch code. The fixer touches code and only runs on a
              decision. Gilfoyle can do both, and only when you ask.
            </p>
          </div>

          {error && <div className="note err">{error}</div>}
        </div>
      </div>
    </>
  )
}
