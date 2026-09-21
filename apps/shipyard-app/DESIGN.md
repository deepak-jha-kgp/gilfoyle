# Shipyard — app design

A React (Vite) app served into the pod. Six routes, two data worlds: what the pod
knows (its own tables and schedules) and what GitHub knows (read live through the
connector, never a token in the browser).

## Experience thesis

For **the engineer on duty**, this app turns **a stream of GitHub events** into
**one decision per item — fix it, escalate it, discuss it, or let it go** by
**showing the agent's verdict next to the evidence it gathered, and letting you
argue with it in the same pane.**

## Hero moment

Open a pull request. Press **Discuss with triager**. The thread opens immediately
and you watch the agent work — `→ run connector operation`, `→ pod read file`,
its own reasoning in grey — then it answers with something specific enough to act
on. You never left the list.

## Routes

| Route | Reads | Writes |
|---|---|---|
| **Ask** *(home)* | live counts from `signal` / `triage` / `pull_request` | opens a thread with the chosen agent |
| **Signals** | `signal` + `triage` tables, live over the table WebSocket | `triage.action` (the Fix it button) |
| **Conversations** | pod conversations | opens new threads |
| **Automations** | `schedule` | `is_active` (pause / resume) |
| **Pull requests** | GitHub `pulls_list` via the connector — open / merged / closed / all | opens a thread seeded with the PR |
| **Issues** | GitHub `issues_list_for_repo` — open / closed / all | opens a thread seeded with the issue |
| **Connections** | org connector accounts + catalog | starts an OAuth connect request |

**GitHub has no "merged" state.** A merged pull request is closed with a merge
date, so the Merged filter asks for `closed` and separates on `merged_at` — the
alternative is a filter that is quietly wrong.

**The repository picker** lists what the connected account can reach, remembers the
choice in `localStorage`, and is the scope for both GitHub routes. It asks
`repos_list_for_authenticated_user` first: the installation-scoped listing is the
more honest set, but a user-scoped App token refuses it outright, and asking anyway
put a 403 in the console on every load.

## Who you are talking to

Every thread picks its agent, and the default is **Gilfoyle** — the one that can
both answer and act. `pod_default` stays the wire name (`POD_DEFAULT` is what the
backend resolves); Gilfoyle is only what people call it. The copy follows suit:
*Ask Gilfoyle*, but *ask the triager* — one is a name, the others are roles. The triager and fixer are there when the job is
squarely theirs. The choice is remembered per browser.

This only works because `pod_default` was given grants: it ships with **zero**, so
out of the box the "assistant" can read nothing and do nothing. It now holds the
three tables, the five connectors, `WORKSPACE_CLI`, and `agent.execute` on the
other two — which is what lets it clone a repository and open a pull request when
asked.

## Starting a conversation

Creating the thread is the **click's** job, never a render effect's. Two reasons,
both learned the hard way:

- An effect that posts a message is torn down and re-run by StrictMode, and the
  first send dies half-way with *"signal is aborted without reason"*.
- `conversations.messages.send` does not resolve until the agent's **whole turn
  ends**. Awaiting it leaves the button saying "Opening…" for minutes with the
  thread the person asked for still not on screen.

So `startDiscussion` creates the conversation, fires the opening message **without
awaiting it**, and returns the id. The thread mounts, then polls `resumeIfRunning`
— a run started outside the hook is invisible to it otherwise, and the person
would see their own message and no sign of life.

## Showing the work

A turn emits `THINKING` / `TOOL_CALL` / `TOOL_RETURN` / `TEXT`. Only rendering the
prose leaves a spinner sitting there for minutes. Tool calls render as muted trace
lines (`→ run connector operation`) and reasoning as muted italics; `TOOL_RETURN`
is dropped — it is the payload, not the step.

## Visual direction

**Primer — GitHub's own palette.** This app sits next to GitHub all day, and
inventing a second set of answers to "what does red mean" helps nobody. Dark is
Primer dark (canvas `#0d1117`, rail `#010409`, border `#3d444d`); light is Primer
light (`#ffffff` / `#f6f8fa` / `#d1d9e0`). Status colours are theirs too: open and
success `#3fb950`, danger `#f85149`, attention `#d29922`, done/merged `#a371f7`,
link `#4493f8`. Primary buttons use Primer's green `#238636`.

Type is **Inter** for prose and **JetBrains Mono** for anything machine-generated —
ids, repos, branches, counts, timestamps, event names. You can tell at a glance
which parts a person wrote. **Nothing is heavier than weight 500**, including
rendered agent Markdown, where `**bold**` becomes brighter ink rather than a
heavier face.

**Primer is flat, and so is this.** No card shadows, no gradient canvas, no sheen —
borders and space do the work. Chips are borderless pills. List rows separate with
a hairline rather than each being its own framed box, because a queue of forty
cards is a queue nobody can scan.

Two signature elements carry the argument:
- **The blast meter** — log-scaled, so 3 users and 340 users differ visibly and
  neither disappears. Absent from a row when there is no number to show.
- **The evidence ledger** — and it must not lie. See below.

## The ledger has to be true

A triage row records what the agent *recorded*, which is not the same as what it
could have asked. An agent with no PostHog account usually writes nothing at all,
and the ledger rendered that absence as *"asked, nothing found"* — stating that a
question had been answered when it was never askable.

So reachability now outranks the row. The app holds the set of connector ids with a
**CONNECTED** account in the organization, and any source outside it reads **"no
account connected"** regardless of what the triage says. Three states, in order of
authority:

1. **no account connected** — the pod cannot reach it. A setup gap, not a finding.
2. **asked, nothing found** — reachable, consulted, empty.
3. the answer itself.

## Everything is a page

Detail is a **route**, not a drawer: `#/pulls/764`, `#/issues/171`,
`#/signals/<id>`, `#/conversations/<id>`. A 560px overlay was the wrong shape for a
pull request with forty check runs and a real argument in it, and it made every
detail unlinkable. Pages are an 880px column, **left-aligned rather than centred** — centring inside
the space left over by a 248px rail pushes content to the middle of a wide screen
and leaves a void beside the nav, and the list views start right after the rail, so
a detail that doesn't reads as a different app. With a back control; a number that is
no longer in the current filter says so and offers the way back rather than
silently showing the list.

## Rendering what other people wrote

Comment bodies are **GitHub-flavoured Markdown written by strangers and bots**, not
the tidy prose an agent produces. A CodeRabbit review is GFM tables, fenced blocks,
a dozen `<details>` sections, `<img>` badges and a pile of `<!-- -->` machine
markers. A hand-rolled renderer that handled paragraphs, bullets and `code` turned
that into a wall of literal angle brackets.

So: `marked` parses it and **DOMPurify sanitises the result** against a tag
allow-list before it reaches the DOM. That is what makes `dangerouslySetInnerHTML`
defensible here — the content is untrusted by definition, and an allow-list
sanitiser is the standard answer rather than a hope. `<script>`, `<style>`,
`<iframe>`, `<form>`, inline handlers and `target` are all refused; `<details>`,
tables, `<pre>` and images are kept because GitHub renders them and people rely on
them. HTML comments are stripped, since GitHub hides them too.

Anything over ~2200 characters clamps with a fade and a **Show more** — a single
bot comment is otherwise most of a screen.

## The decision control

Four segments in one bordered group, not four loose buttons. The previous version
showed the **current** value greyed-out and disabled beside a solid green button for
a *different* action, which said the opposite of the truth: the palest thing in the
row was the answer.

Now the current value is the loudest — filled, full-strength ink, an accent underline
— and `fix` keeps accent-coloured text while it is merely *available*, because it is
the one that wakes an agent. State and the ways to change it live in the same object,
so they cannot contradict.

## People

**One invitation does both jobs.** `organizations.invitations.invite` takes a
`pod_id` and a `pod_role` alongside the organization role, so an email address
becomes an organization member *and* a member of this pod in a single call — an
invitation that landed somebody in the organization but not the pod would leave
them staring at somebody else's workspace. Anybody already in the organization
skips the email entirely: `podMembers.add` takes their `organization_member_id`.

Roles are described in the terms this app uses rather than by name alone, because
`POD_EDITOR` does not tell anybody whether they can set a decision.

**The two endpoints disagree about almost every field**, and reading either as the
other is how this page first rendered a column of *"Someone"*:

| | pod members | organization members |
|---|---|---|
| id | `pod_member_id` | `id` |
| name | `user_name` | `user.first_name` + `user.last_name` |
| email | `user_email` | `user.email` |
| role | `roles[]` | `role` |

So both are normalised into one `Member` at the edge, and a person with no name
falls back to their email **once** — printing it as the name *and* the subtitle was
the other half of the noise.

**People run through the work, not beside it:**

- **Ownership.** `signal.assignee` is a `USER` column — on `signal` rather than
  `triage`, deliberately: a signal nobody has triaged yet is exactly the kind
  somebody should be able to claim, and it has no triage row to hang an owner off.
  The list shows a face, the detail shows a picker, and **Mine** is a filter.
- **The triager's guess stays a guess.** `suggested_owner` is a GitHub login the
  agent inferred from the repository's history. It is shown next to the real
  assignee as a suggestion, never written into it.
- **`@` names people too.** The mention list leads with pod members on a bare `@`,
  because that is what the character means everywhere else. A named person travels
  with the message as a name *and* an address, so the agent can actually reach them
  rather than guess at one.
- **Home counts what is yours** before it counts what is anybody's.

The whole point of the role ladder is that it is also the ceiling on the agents: a
run does the intersection of the workload's grants and the invoking member's own
access, so who somebody is decides how far Gilfoyle gets on their behalf.

## Reading a turn

A turn emits `THINKING` / `TOOL_CALL` / `TOOL_RETURN` / `TEXT`. Prose gets a bubble;
reasoning and tool calls are **trace**, grouped into one run beside a rule rather
than a stack of loose blocks — a three-minute turn otherwise reads as twenty
unrelated messages. `TOOL_RETURN` is dropped: it is the payload, not the step. The
same tool twice in a row collapses to `→ pod get records ×2`, and a reasoning step
over 280 characters clamps to four lines until clicked.

A schedule-triggered run opens with prose **and** the raw row event appended. The
test is therefore not "is this message JSON" but "does a JSON object hang off the
end of it": the instruction stays visible, the event folds behind **Trigger
payload**.

**A chat page owns the viewport.** One scroll, not two — the page used to scroll
*and* the thread inside it scrolled, so the transcript fought the page and the
composer floated mid-document.

## Who is working on it

Nothing links a triage row to the run fixing it: a schedule-triggered conversation
carries `metadata.schedule_name` but not the record that woke it. The record id is
in the wake payload, so the map is built by reading the **first** message of the
recent `dispatch-fixer` conversations — and `limit: 1` returns the *newest* message,
which is a tool frame with no text, so the fetch is `before_sequence: 1`.

The result is a row that says `fixer` with a spinner while something is on it, and a
detail that says *"The fixer is working on this now"* with **Open the run**. Bounded
to the newest dozen runs: a page that opens a request per row is worse than one that
occasionally misses an old link.

## Connecting a connector

This mirrors the first-party page (`lemma-frontend/components/connectors/connectors-view.tsx`).
Three things the first attempt got wrong:

1. **A connect request needs an `auth_config_id`, and one has to exist first.**
   `connector_id` on a connect request names an install that must already be there —
   it does not create one. With no install the request answers
   `404 Connector 'sentry' not found`, which reads like a missing connector and is
   really a missing *install*. The fix is the step the first attempt skipped:
   `authConfigs.create({ connector_id, kind, config_source: 'SYSTEM_DEFAULT' })`
   (what `enableApp` does), then connect against that id.
2. **The response field is `authorization_url`**, not `redirect_url`. Reading the
   wrong key meant the button opened nothing even once the request succeeded.
3. **`return_to` accepts only a rooted path inside the Lemma app.** The backend
   refuses a scheme or `//host` outright — an open-redirect guard — so a pod app on
   its own subdomain can *never* be the callback target, and can never receive the
   `postMessage` the first-party page listens for.

That last point is why this **polls**. The first-party UI dropped polling when it gained the
postMessage handshake; cross-origin, polling is what is left, and it is honest — it
watches for the account to actually appear, for four minutes, then says so.

### Not every connector is an OAuth redirect

A kind whose `auth_scheme` is `API_KEY` or `NOAUTH` has **no authorization URL at
all** — it wants a secret typed into a form. In this pod that is PostHog, and
pressing Connect on it could never have worked whatever the payload said. The card
says *Needs an API key* and points at the first-party connectors page rather than
growing a box for somebody's credentials.

Of the five: GitHub is `http`/OAUTH2, BigQuery, Sentry and Linear are
`composio`/OAUTH2, PostHog is `composio`/API_KEY.

An install created for a connect that then fails is **deleted again**. One with no
accounts on it has nothing to lose, and leaving it is worse than nothing: the name
is taken, so even retrying is refused while the connector reads as enabled.

An account that authorized but never installed takes the **install** leg
(`createInstallRequest`) rather than another authorization: a GitHub App's user token
reaches no repository until the App is on it.

### Cards that line up

`align-self: stretch` on the card and `margin-top: auto` on its action row. Without
the first, each card is only as tall as its own text; without the second, a two-line
description pushes its button below the one beside it. Both were missing, which is
why the grid looked ragged.

## How it works, in the app

The flow lives at `#/how`, under Setup. It reads **live state** where live state is
the honest answer — an automation that is paused says so there, because a diagram
claiming events arrive when nothing is listening is worse than no diagram. Each
evidence source shows whether it actually has a connected account.

## Mentioning work

`@` in any composer — home or a thread — offers the open pull requests and issues
in the selected repository. Picking one inserts `#764` and attaches the **item
itself**: title, state, author and body travel with the message, so the agent gets
the thing rather than a number it would have to go and look up. Picked items show
as removable chips under the composer.

## A pull request, whole

The list is a summary; the detail is the actual thing. Opening one loads its
**checks**, **files changed**, and the full **conversation** — top-level comments,
reviews, and inline review comments merged onto one timeline in the order they
happened, with the file and line a remark hangs off.

Each part is fetched independently and allowed to fail on its own: a repository can
refuse check runs while happily returning comments, and losing the page because one
call 403'd would be worse than showing the three that worked. What failed is named
at the bottom of the conversation rather than silently missing.

The seed sent to an agent carries that conversation too — the last dozen remarks and
any failing check names. Asking about a pull request without the argument people are
having on it is asking about the wrong thing.

## States

Skeletons match the final row geometry. Empty states name what is absent and the
next valid action. A 403 says it is a grant problem; an account-resolution failure
points at Connections. A paused `dispatch-fixer` is called out inline on the Fix it
button, because marking something for fixing when nothing will wake is a lie by
omission.

## Responsive

1240px: the detail becomes an overlay. 820px: the rail becomes a scrolling top bar,
rows stack, filters scroll horizontally, the detail is full-screen with a back
control. No horizontal page overflow at 375px.
