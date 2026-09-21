# Working in this repository

For anyone — person or agent — changing this pod for the first time.

This file is a map. The reasoning lives next to the thing it explains: how the pod
behaves is in [README.md](README.md), why the app looks the way it does is in
[apps/shipyard-app/DESIGN.md](apps/shipyard-app/DESIGN.md), and what each agent is
for is in its own `instruction.md`. Repeating any of it here would only let the two
copies drift.

## Setting a fresh pod up

Two commands, and the second one is somebody else's.

```bash
git clone --depth 1 https://github.com/deepak-jha-kgp/gilfoyle && cd gilfoyle
export LEMMA_POD_ID=<pod>     # already set inside a pod's own workspace
./setup.sh            # ~15s: everything, then what to tell the person
# ... they authorize ...
./wire-github.sh      # gives the four inbound automations their routing key
```

Measured end to end on a fresh pod: 15 seconds. `setup.sh` finishes by printing
the orientation a person needs — the app's address, the three inboxes, the GitHub
link, and what is worth doing next — so hand that on as printed rather than
writing your own. Read [setup.sh](setup.sh) rather than reproducing it by hand:
it is short, and every line is there because doing it some other way was slower
or wrong.

**There is nothing to build and no variable to resolve.** The app under
`apps/shipyard-app/source/` is already built, so the import uploads it as-is —
no `npm`, and none of the three `VITE_LEMMA_*` variables a Vite project would
demand and a fresh pod could not supply. Do not skip ahead to `npm install`:
it is the slowest wrong turn available, and there is no `package.json` there to
run it against. The bundle's `${variables}` are all optional; leave them
unresolved and the app takes a pod-suffixed slug, which is fine.

**The rename is a separate import on purpose.** `--set-pod-meta` is the only way
to name the pod from the CLI, and it applies metadata *first* — so in an
organization that already has a `gilfoyle`, a `409 POD_CONFLICT` takes the entire
import down with it before a single table is created. `setup.sh` imports the
resources first and then renames from a directory holding nothing but `pod.json`,
which costs four seconds and cannot cost anything else.

**Four automations land unrouted, and that is expected.** `ci-failure`,
`pr-opened`, `pr-comment` and `issue-opened` route on a GitHub App installation
that does not exist until somebody authorizes one, so they are created with
`{source, event}` and no `installation_id`. They cannot fire. `wire-github.sh`
deletes and re-creates them once an account is connected, which is the only path
that provisions a routing key. All five schedules import **paused**; leave them
that way until a person says otherwise, because `dispatch-fixer` opens pull
requests unattended.

**What "verified" means here: reading the pod back.** `lemma pods describe` (which
`setup.sh` already ran), `lemma schedules list`, `lemma agents permissions get
triager`. Not a browser — the app puts a Lemma sign-in in front of every visitor,
that session belongs to a person, and trying to get past it is a long walk to
nowhere. Not a widget either. Report in plain text.

## What is here

| Path | What it is |
|---|---|
| `pod.json` | Pod metadata and the `${variables}` an import must resolve |
| `tables/` | `signal`, `triage`, `pull_request` — the pod's durable state |
| `agents/` | `triager` and `fixer`. JSON carries the grants; `instruction.md` carries the judgement. **Gilfoyle** — the pod's own assistant — is not here: its toolsets and instruction are fixed at run time and cannot be configured from a bundle |
| `schedules/` | The five automations. Four inbound webhooks, one that dispatches the fixer |
| `surfaces/` | The email address each agent answers on. Created for you; here so a fresh import keeps them |
| `apps/shipyard-app/` | The app as it ships. `source/` is **built output**, uploaded as-is — that is what makes an import fast. `DESIGN.md` beside it |
| `app/` | The React project that output is built from. `./app/build.sh` rebuilds it and rewrites `apps/shipyard-app/source/`. Editing the app means editing here |
| `setup.sh` | Sets a fresh pod up end to end: name, import, then the orientation to hand the person |
| `wire-github.sh` | Run once, after a GitHub account is connected: gives the four inbound automations their routing key |
| `seed/` | `ingest.sh` pulls **real** GitHub events and hands them to the triager |
| `payloads/` | One fixture for testing an agent by hand |

## This is a bundle, not a service

There is nothing to run. The unit of work is the directory: edit a file, import it,
test the layer you touched.

```bash
lemma pods create gilfoyle --description "Engineering signals in, reviewed changes out."
lemma pods import . --pod <pod> --set-pod-meta \
  --var github_account=<account-id> \
  --var github_installation=<installation-id>
```

Both `--var`s are optional and neither is needed for a first import — see
[Setting a fresh pod up](#setting-a-fresh-pod-up). They matter on a *re*-import
of a pod whose automations already work, because that is the one that would
otherwise strip the routing key back off.

Import upserts **by name**, so a resource's folder name is its primary key forever.
Renaming one creates a second resource and orphans the first; grants, schedules and
the app all reference resources by name.

`--dry-run` first when you have **edited** the bundle: it is the cheapest place to
find a bad grant or a malformed schedule. Not on a first import of an unmodified
checkout — there is nothing there that the import itself will not tell you, and a
second pass is a second upload of the app.

## Five things that are easy to get wrong

**Names in `permissions.grants` are the whole security model.** An agent is created
with access to *nothing*. Import **replaces** its grants with whatever the JSON
says, so deleting a line revokes it. A grant is a ceiling on the agent, never a
promotion for the person: a run does the intersection of the agent's grants and the
invoking member's own access.

**Not everything round-trips.** Connector accounts and auth configs are runtime
state and never travel in a bundle — neither do table rows or file contents.
`pod_default`'s grants do not apply on import either, because it is created with
the pod; the README has the command.

**A webhook schedule's `config` is replaced wholesale on every import.** It has to
carry the *whole* routing key — `source`, `event` and `installation_id` — or a
re-import silently strips the routing off a working automation and leaves something
that looks correct and can never fire. Do not "simplify" it back to `source`.

**The two agents are split on purpose.** The triager runs on every event and cannot
touch code; the fixer touches code and only runs on a decision. Collapsing them
would be simpler and would remove the reason to trust either.

**The evidence must stay honest.** A source the pod cannot reach is *not connected*,
never a zero. If you change how evidence is read, keep those distinguishable — it is
the one claim this pod makes that a simpler tool cannot.

## Before you change an agent's instruction

Re-run it over history rather than guessing:

```bash
LEMMA_POD_ID=<pod> ./seed/ingest.sh <owner/repo> 4
```

That pulls real failed runs, open issues and open pull requests and triages them
with the live agent. Comparing the verdicts before and after an edit is the only
cheap way to tell whether an instruction change actually improved anything.

**Never seed fabricated rows.** An earlier version of this pod shipped invented
signals with invented blast radii; it demoed well and taught nothing, because every
number in it was a number somebody made up.

## Verifying a change

Bottom-up, in the order the layers depend on each other — tables, then agents, then
schedules, then the app. The commands are in [README.md](README.md#verifying-it).
A change to the app is verified in a browser against real data, not by reading the
diff — by whoever *changed* it, in their own signed-in browser. Setting a pod up is
not changing the app, and an agent has no session to do it with.
