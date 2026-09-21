# gilfoyle

Engineering signals in, reviewed changes out.

A GitHub Actions run fails. Seconds later it is in the queue with a verdict —
`regression · critical` — a blast radius of **340 users** taken from PostHog, and a
two-sentence cause. You press **Fix it**. A pull request appears, with a branch and a
link. Nobody typed anything.

The thing that makes it worth running is not the automation; plenty of tools open a
pull request from a failing build. It is that the verdict carries **evidence the repo
cannot supply** — how many real people hit this, whether money moved through it,
whether it has happened before — and the app shows a source that could not be asked
differently from one that answered zero.

---

## How it works

Four steps, and a person in the middle of them.

```
  GitHub / Sentry / Linear
            │
            │  a webhook lands
            ▼
   ┌─────────────────────┐
   │  automation         │   a fast model reads "only run when"
   │  (schedule)         │   and drops most events before
   └─────────┬───────────┘   anything expensive starts
             ▼
   ┌─────────────────────┐   writes `signal` (what arrived)
   │  triager            │   and `triage` (what it means),
   │  reads, never writes│   after asking PostHog / Sentry /
   │  code               │   BigQuery how much it matters
   └─────────┬───────────┘
             ▼
   ┌─────────────────────┐
   │  a person decides   │   Fix it · Escalate · Watch · Close
   └─────────┬───────────┘
             │  action becomes "fix"
             ▼
   ┌─────────────────────┐   reproduces it, makes the smallest
   │  fixer              │   change, runs the repo's own checks,
   │  writes code, never │   opens a pull request
   │  merges             │
   └─────────────────────┘
```

**1. An event arrives.** Four `WEBHOOK` schedules listen on the pod's GitHub App —
`workflow_run`, `pull_request`, `issue_comment`, `issues`. Each carries a
`filter_instruction`: a natural-language predicate a fast model evaluates *per
event*, before the agent is woken. A CI failure on a dependabot branch is dropped
here and never costs a run.

**2. The triager judges it.** It writes one `signal` row (deduplicated on
`external_id`, so a redelivered webhook cannot open a second) and one `triage` row:
verdict, severity, confidence, a two-sentence cause. Before deciding severity it
goes and gets evidence the repository cannot supply — how many distinct users hit
this in PostHog, whether Sentry has seen the signature before, whether BigQuery says
money moved through the broken path.

**3. A person decides.** Every signal carries exactly one decision. The triager sets
an opening position; you overrule it whenever it is wrong. Nothing else in the pod
acts on a signal until this is set.

**4. The fixer opens a pull request.** `dispatch-fixer` is a `DATASTORE` schedule
watching `triage` for `action` becoming `"fix"` — `to`, not `equals`, so it fires on
the write that *made* it fix rather than on every later edit. The app's **Fix it**
button does nothing else: it sets one field. A human and the triager reach the fixer
through the same door.

### What makes it worth running

A tool that opens a pull request from a failing build is not hard to build. What is
hard is knowing whether the build is worth fixing, and that is a question the
repository cannot answer.

So the pod's one real claim is about **evidence**, and the app is built to keep it
honest. Three states, never collapsed into two:

| | means |
|---|---|
| **no account connected** | the pod cannot reach that source. A setup gap, not a finding. |
| **asked, nothing found** | reachable, consulted, empty. |
| a number | it was asked and it answered. |

`blast_radius` is `null` when it could not be measured and `0` when nobody was
affected, and those render differently. An agent that reports zero for a question it
never asked is worse than an agent that says nothing.

### Why two agents

The triager runs on **every** event and cannot touch code. The fixer touches code
and runs only on a **decision**. Collapsing them into one capable agent would be
simpler, and would remove the reason to trust either: the thing that reads
everything would also be the thing that can change everything, on its own schedule,
unattended.

The same rule runs underneath the whole pod. Every agent starts with access to
nothing and is granted resources explicitly by name — and a run does the
intersection of the agent's grants and the **invoking person's** own access, so an
agent never reaches further than the person it acts for.

## Resources

| Kind | Name | What it is |
|---|---|---|
| table | `signal` | One row per inbound event. Shared. `external_id` is unique, so a redelivered webhook cannot open a second row. |
| table | `triage` | The verdict on one signal. Setting `action` to `fix` is what dispatches the fixer. |
| table | `pull_request` | Changes the pod opened, and ones it watches because a signal named them. |
| agent | `triager` | Decides what a signal is and how much it matters. Reads PostHog / BigQuery / Sentry / Linear. **Never touches code.** |
| agent | `fixer` | Reproduces, changes the smallest thing, opens a pull request. Never merges, never pushes to a default branch. |
| agent | `pod_default` | **Gilfoyle** in the app — what the home composer talks to. Answers *and* acts: reads the queue, and can clone, fix and open a pull request. |
| schedule | `ci-failure` | GitHub `workflow_run` → `triager` |
| schedule | `pr-opened` | GitHub `pull_request` → `triager` |
| schedule | `pr-comment` | GitHub `issue_comment` → `triager` |
| schedule | `issue-opened` | GitHub `issues` → `triager` |
| schedule | `dispatch-fixer` | `triage` row where `action` becomes `fix` → `fixer` |
| table | `signal.assignee` | A `USER` column: who owns a signal. Added after the first import — see below. |
| app | `shipyard-app` | React (Vite). Signals · Conversations · Automations · Pull requests · Issues · Connections. Design spec in `apps/shipyard-app/DESIGN.md`. |

**The two agents are split on purpose.** The triager runs on every event; the fixer
runs only on the ones the triager (or a person) marks. That split is the cost control
and the safety story at once — the thing that reads everything cannot write code, and
the thing that writes code only wakes on a decision.

**`dispatch-fixer` is the hinge.** The app's **Fix it** button does one thing: it sets
`triage.action = "fix"`. The schedule does the rest. A human and the triager reach the
fixer through exactly the same door.

## Setting it up

The quickest path is [SETUP-PROMPT.md](SETUP-PROMPT.md): a prompt to hand a fresh
pod's agent that walks the whole thing, and doubles as a runbook if you would
rather do it yourself.

### By hand

Import never creates the pod, and connectors never travel in a bundle.

From this repository, straight into a pod that already exists — which is how this
is meant to be used, including into a pod created for somebody the first time they
message Lemma:

```
POST /pods/{pod_id}/bundle/imports
{ "kind": "GITHUB", "repo_url": "https://github.com/deepak-jha-kgp/gilfoyle" }
```

Poll until `AWAITING_CONFIRMATION`, read the plan, then apply it. **The import does
not name the pod** — see the task at the top of [AGENTS.md](AGENTS.md).

Or from a local clone:

```bash
lemma pods create gilfoyle --description "Engineering signals in, reviewed changes out."
lemma pods import . --pod <pod> \
  --var github_account=<account-id> \
  --var github_installation=<installation-id>
```

### 1. Connect GitHub — required

The four webhook automations route on `{source, installation_id, event}`. The
installation id is read off the connected GitHub account; find both with:

```bash
lemma connectors accounts list --json | grep -i github
```

> **The trap this bundle is shaped around.** Omit `--var github_account=...` and the
> import **silently drops `account_id`**: the schedule is created, reports success, and
> looks correct in `schedules get` — but has no routing key and can never fire. And
> `config` is replaced wholesale on every update, so a bundle carrying only
> `{"source": "github"}` strips the installation id back off on the next re-import.
>
> That is why `config` here carries the **whole** routing key with the installation as
> a variable. Do not "simplify" it back to just `source`.
>
> Check it landed, and check again after any re-import:
> ```bash
> lemma schedules list --json | grep installation_id
> ```
> A WEBHOOK schedule whose `config` is only `{"source": "github"}` is a dud. Re-importing
> with the variables does **not** repair one — provisioning runs only on create, so
> delete those schedules and import again.

### 2. Grant the pod assistant — it ships with nothing

`pod_default` is created with the pod and holds **zero grants and no toolsets**, so
the "assistant" can read nothing and do nothing until you fix that. The bundle
carries its definition, but **import does not apply its grants** (it is a
system-created agent), so apply them directly after import:

```bash
lemma agents permissions add pod_default \
  signal:read,write triage:read,write pull_request:read,write \
  connector:github:use connector:posthog:use connector:sentry:use \
  connector:linear:use connector:googlebigquery:use \
  agent:triager:execute agent:fixer:execute
lemma agents permissions get pod_default     # expect 10 grants, not 0
```

### 3. Connect the evidence sources — optional, and the reason to bother

`posthog`, `sentry`, `linear` and `googlebigquery` are already granted to the
`triager`. Connect an account and it starts using them; leave one out and it records
the gap in `missing_evidence` rather than inventing a number, and the app's evidence
ledger shows that source as **not consulted**.

```bash
lemma connectors auth-configs list
lemma connectors accounts create ...    # per provider; see the connectors reference
```

Without PostHog the pod still works. It just triages the way everything else does —
on the text of the report alone.

### 4. Fill it with real work

There is no seed data and there is deliberately no fixture generator. `ingest.sh`
pulls **real** events out of a repository with `gh`, shapes each one into the webhook
payload the matching automation would deliver, and hands it to the triager:

```bash
LEMMA_POD_ID=<pod> ./seed/ingest.sh lemma-work/lemma-platform 4
```

It takes the most recent failed run **per workflow** (ten identical coverage failures
teach the triager nothing the first one didn't), the open issues, and the open pull
requests. Every field comes from `gh`; the only thing `build_payloads.py` invents is
the envelope GitHub would have wrapped around it.

Use it to fill a fresh pod, or to re-run the triager over history after changing its
instruction — which is the cheapest way to tell whether an instruction edit actually
improved the verdicts.

### 5. Turn the automations on

**They import paused, deliberately** — they fire on a real GitHub installation, and
nothing should start running against someone's repositories because an import
succeeded. Turn them on from the app's Automations view, or:

```bash
lemma schedules resume ci-failure
lemma schedules resume dispatch-fixer
```

`dispatch-fixer` is the one to think about: with it on, marking a triage `fix`
wakes an agent that will open a pull request without anyone watching.

## Verifying it

Bottom-up, in build order:

```bash
# tables
lemma query run "select status, count(*) from signal group by status"

# agents — the triager on a real payload
lemma agents chat triager "$(cat payloads/workflow_run.failure.json)"
#   expect: one new `signal` row, one `triage` row, status -> triaged

# the hinge: mark a triage for fixing and confirm the fixer wakes
lemma records update triage <triage-id> --data '{"action":"fix"}'
lemma conversations list --agent fixer        # a run should appear
lemma schedules get dispatch-fixer            # last_fire_status: TRIGGERED

# schedules — after a real CI failure on a connected repo
lemma schedules get ci-failure                # last_fired_at, last_fire_status
```

`last_fire_status` distinguishes `TRIGGERED` from `FILTERED` (the "only run when"
predicate said no) from `ERROR`. Read it before reading logs.

### End to end

Push a failing build to a repository the GitHub account covers → a `signal` appears in
the app within seconds → it carries a verdict and a blast radius → press **Fix it** →
a `pull_request` row appears at `drafting`, then `open`, with a branch and a link.

## The app

```bash
cd apps/shipyard-app/source
npm install
npm run dev                          # auto-authenticated as whoever the CLI is
lemma apps deploy shipyard-app . --yes
```

Nine routes. **Code** is the home composer — a message there opens a thread with
whichever agent is selected, Gilfoyle by default. **Signals**, **Conversations** and
**Automations** read the pod;
**Pull requests** and **Issues** read GitHub live through the connector, scoped to
the repository picked in the sidebar; **Connections** shows what the pod can
actually reach and starts an OAuth request for what it cannot; **How it works**
explains the loop against live state — a paused automation says so there — and
**People** invites by email straight into the org and this pod.

Opening a pull request loads the whole of it — checks, files changed, and the full
conversation (comments, reviews and inline review comments on one timeline). Issues
load their comments. From any of them, or from a signal, you can **start a
conversation** seeded with that context, including the last dozen remarks and any
failing check names. The thread streams the agent's tool calls as it works, so a
three-minute review is legible instead of a spinner.

Dark and light on **GitHub's Primer palette**, switched from the rail and
remembered; the stored choice is applied in `index.html` before first paint. Inter
for prose, JetBrains Mono for anything machine-generated.

Detail is a route, not a drawer — `#/pulls/764`, `#/signals/<id>` — so every view is
linkable. `@` in any composer pulls an open pull request or issue in by number and
sends its title, state, author and body along with the message.

Three things worth knowing before changing it, all in `DESIGN.md` in full:

- **GitHub has no "merged" state.** A merged PR is closed with a merge date. The
  Merged filter asks for `closed` and splits on `merged_at`.
- **`conversations.messages.send` does not return until the agent's turn ends.**
  Await it and the UI hangs for minutes. `startDiscussion` returns as soon as the
  conversation exists and hands the send back for error reporting only.
- **Each part of a pull request's detail fails on its own.** A repository can refuse
  check runs and still return comments; what failed is named rather than missing.
- **Comment bodies go through `marked` + DOMPurify, never a hand-rolled parser.**
  A bot review is GFM tables, `<details>` sections and `<img>` badges; rendering it
  naively produces a wall of angle brackets.
- **A connect request needs an auth config to exist first.** `connector_id` names
  an install, it does not create one — with none the request 404s as
  *"Connector not found"*. Create it with `authConfigs.create(... SYSTEM_DEFAULT)`
  first, and delete it again if the connect then fails.
- **An `API_KEY` connector has no authorization URL** — PostHog is one, and no
  payload makes a redirect appear.
- **A connect request returns `authorization_url`, and `return_to` must be a rooted
  path inside the Lemma app** — so a pod app cannot be the OAuth callback target and
  has to watch for the account instead of being handed the result.
- **`conversations.messages.list(id, {limit: 1})` returns the NEWEST message.** To
  read a run's wake payload — which is how a triage row is matched to the agent
  working on it — ask for `before_sequence: 1`.
- **The evidence ledger reads connection state, not just the triage row.** A source
  with no connected account says *no account connected*; an agent that could not
  reach PostHog writes nothing, and calling that "asked, nothing found" would claim
  an answer that was never possible.

## Known limits

- **Slack cannot trigger an automation.** Surface messages reach an agent as a
  conversation; schedule webhooks accept only `composio` and `github`. A Slack triage
  automation needs a `SlackWebhookSource` plugin in the platform first.
- **No pull-request *review* events.** `issue_comment` covers top-level PR comments;
  `pull_request_review` and `pull_request_review_comment` are not in the platform's
  supported set, so inline review threads are invisible to `pr-comment`.
- **No run ceiling.** Nothing caps how often an automation may fire. With `pr-opened`
  on a busy installation that is a real cost, and the `filter_instruction` gate is
  itself a model call per event. Scope the triggers to one repository (add
  `repository_id` to a schedule's `config`) before turning them on widely.
- **Agent runs need LLM budget.** A run that hits the org's monthly cap fails with
  `429 USAGE_LIMIT_EXCEEDED` and the schedule records `ERROR`.

## Layout

```
AGENTS.md                      how to work in this repo, and what breaks
pod.json                       metadata + the ${variables} an import resolves
tables/{signal,triage,pull_request}/
agents/{triager,fixer,pod_default}/    JSON carries permissions.grants
schedules/{ci-failure,pr-opened,pr-comment,issue-opened,dispatch-fixer}/
surfaces/resend-*/             the email address each agent answers on
apps/shipyard-app/             DESIGN.md + source/ (React + Vite)
seed/ingest.sh                 pulls real GitHub events and triages them
seed/build_payloads.py         shapes `gh` output into webhook payloads
payloads/                      one fixture for testing an agent by hand
```

## A note on the names

Three things are nearly the same word, on purpose and not:

| | |
|---|---|
| **gilfoyle** | the pod — everything in this repository |
| **Gilfoyle** | the assistant inside it (`pod_default` on the wire) |
| **shipyard-app** | the app. Its name is its public slug, so it keeps the older one rather than stranding a deployed URL |

## Built with

[Lemma](https://lemma.work) — pods, agents, schedules and apps. The whole thing is
this directory: `lemma pods import .` and it exists.
