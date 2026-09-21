# Working in this repository

For anyone — person or agent — changing this pod for the first time.

This file is a map. The reasoning lives next to the thing it explains: how the pod
behaves is in [README.md](README.md), why the app looks the way it does is in
[apps/shipyard-app/DESIGN.md](apps/shipyard-app/DESIGN.md), and what each agent is
for is in its own `instruction.md`. Repeating any of it here would only let the two
copies drift.

## One outstanding task

**Rename the pod you imported this into, to `gilfoyle`.**

Importing a bundle does **not** rename the pod. `POST /pods/{pod_id}/bundle/imports`
applies resources into a pod that already exists, and the applier never touches pod
metadata — so `name` in [pod.json](pod.json) says `gilfoyle`, and the pod it landed
in is still called whatever created it. One call fixes that:

```
PUT /pods/{pod_id}   {"name": "gilfoyle"}
```

There is no CLI verb for it; from an SDK it is `pods.update(podId, { name: 'gilfoyle' })`.

Leave `shipyard-app` alone. An app's name is its upsert key *and* its public slug,
so renaming it strands whatever is already deployed at that URL.

**Then delete this section.** A task that stays in the file after it is done is a
task the next person does twice.

## What is here

| Path | What it is |
|---|---|
| `pod.json` | Pod metadata and the `${variables}` an import must resolve |
| `tables/` | `signal`, `triage`, `pull_request` — the pod's durable state |
| `agents/` | `triager`, `fixer`, `pod_default` (**Gilfoyle**). JSON carries the grants; `instruction.md` carries the judgement |
| `schedules/` | The five automations. Four inbound webhooks, one that dispatches the fixer |
| `surfaces/` | The email address each agent answers on. Created for you; here so a fresh import keeps them |
| `apps/shipyard-app/` | The React app. `DESIGN.md` beside it, source under `source/` |
| `seed/` | `ingest.sh` pulls **real** GitHub events and hands them to the triager |
| `payloads/` | One fixture for testing an agent by hand |

## This is a bundle, not a service

There is nothing to run. The unit of work is the directory: edit a file, import it,
test the layer you touched.

```bash
lemma pods create gilfoyle --description "Engineering signals in, reviewed changes out."
lemma pods import . --pod <pod> \
  --var github_account=<account-id> \
  --var github_installation=<installation-id>
```

Import upserts **by name**, so a resource's folder name is its primary key forever.
Renaming one creates a second resource and orphans the first; grants, schedules and
the app all reference resources by name.

Always `--dry-run` first. It is the only place a bad grant or a malformed schedule
is cheap to find.

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
diff.
