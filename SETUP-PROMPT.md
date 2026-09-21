# The setup prompt

Paste the block below into a **fresh pod's chat**. It is written for the agent to
carry out, and it stops and asks wherever a human genuinely has to act.

## Before you paste it

A pod's assistant ships with **no toolsets and no grants** — it cannot run a shell
or read a table, so it cannot do any of this as delivered. Give it a shell once, as
a pod admin:

```bash
lemma agents permissions add pod_default \
  signal:read,write triage:read,write pull_request:read,write \
  connector:github:use agent:triager:execute agent:fixer:execute
```

…and set its toolsets to include `WORKSPACE_CLI`. If you would rather not, run the
steps yourself from a terminal — the prompt doubles as a runbook.

---

```
Set this pod up as Gilfoyle: an engineering triage pod. Everything you need is a
public repository. Work through it in order, verify each step before the next, and
stop and tell me whenever something needs me rather than guessing.

1. IMPORT
   Import https://github.com/deepak-jha-kgp/gilfoyle into this pod.

     POST /pods/{pod_id}/bundle/imports
       { "kind": "GITHUB", "repo_url": "https://github.com/deepak-jha-kgp/gilfoyle" }

   Poll the status endpoint until AWAITING_CONFIRMATION, read the plan back to me
   in one short paragraph, then apply it. Variables go on the APPLY call, not the
   start call:

     POST /pods/{pod_id}/bundle/imports/{import_id}/apply
       { "variables": { ... } }

   Two of the three variables need a connected GitHub account, which does not
   exist yet. So: apply now WITHOUT github_account or github_installation, and
   expect the four webhook automations to import unrouted. That is fine and
   expected — step 5 fixes them. Do not invent values for them.

2. NAME THE POD
   Importing does not rename a pod. Set it yourself:

     PUT /pods/{pod_id}   { "name": "gilfoyle" }

   Then read AGENTS.md in the repo, do what its "One outstanding task" section
   says if anything is left, and note that the section asks to be deleted.

3. GIVE THE ASSISTANT ITS GRANTS
   Bundle import does NOT apply pod_default's grants — it is created with the pod,
   so the applier skips it. Grant them explicitly:

     signal:read,write  triage:read,write  pull_request:read,write
     connector:github:use  connector:posthog:use  connector:sentry:use
     connector:linear:use  connector:googlebigquery:use
     agent:triager:execute  agent:fixer:execute

   Verify: `lemma agents permissions get pod_default` should show 10 grants, not 0.

4. CHECK THE SHAPE
   Confirm the pod now has: tables signal, triage, pull_request; agents triager,
   fixer, pod_default; five schedules; the app. Run `lemma pods doctor` and tell me
   anything it reports beyond "no pinned runtime" warnings.

5. GITHUB — THIS ONE NEEDS ME
   Nothing works until a GitHub account is connected, and that is an OAuth round
   trip I have to complete. Give me the link, wait, then:
     - read the installation id off the connected account,
     - DELETE and re-import the four webhook schedules (ci-failure, pr-opened,
       pr-comment, issue-opened) supplying github_account and github_installation.
   Delete-and-recreate, not update: provisioning only runs when a schedule is
   created, so updating one leaves it unrouted.
   Verify each one's config has an installation_id. A schedule whose config is only
   {"source": "github"} can never fire.

6. FILL IT WITH REAL WORK
   Run seed/ingest.sh against a repository I name. It pulls real failed CI runs,
   real open issues and real open pull requests and triages them with the live
   agent.

   Never invent signals. No sample rows, no made-up blast radii, no placeholder
   verdicts. An empty queue is honest; a fabricated one is not.

7. LEAVE THE AUTOMATIONS PAUSED
   They fire on my real GitHub installation and dispatch-fixer opens pull requests
   unattended. Tell me they are paused and where to turn them on. Do not turn them
   on yourself.

8. REPORT
   Tell me in a few lines: what exists now, what is connected, what is still
   paused, and anything you could not finish and why. Be specific about what you
   did not verify.
```
