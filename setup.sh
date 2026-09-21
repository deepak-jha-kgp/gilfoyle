#!/usr/bin/env bash
# Set a fresh pod up, and tell whoever is watching what they can now do.
#
#   LEMMA_POD_ID=<pod> ./setup.sh
#
# About fifteen seconds. It does NOT turn an automation on and does NOT write a
# row: `dispatch-fixer` opens pull requests unattended, and an invented signal is
# worse than an empty list. Both are somebody's decision, made later and on
# purpose.
set -euo pipefail
cd "$(dirname "$0")"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID to the pod to set up}"
export LEMMA_POD_ID

# 1. The name, first and on its own.
#
#    First, because the email surfaces take their addresses from the pod's name
#    at the moment they are created -- rename afterwards and the pod is
#    `gilfoyle` while its inbox is still `whatever-made-this@`.
#
#    On its own, because `--set-pod-meta` applies metadata BEFORE any resource
#    and pod names are unique per organization: a second `gilfoyle` in the same
#    org is a 409 that would take the whole import down with it. Renaming from a
#    directory holding nothing but pod.json costs four seconds and can cost
#    nothing else.
META="$(mktemp -d)"; trap 'rm -rf "$META"' EXIT
cp pod.json "$META/"
if ! lemma pods import "$META" --set-pod-meta >/dev/null 2>&1; then
  echo "note: could not name this pod 'gilfoyle' — something else in this" >&2
  echo "      organization already is. Carrying on; nothing else depends on it." >&2
fi

# 2. Everything else. No build and no --var: `apps/shipyard-app/source/` is built
#    output with no package.json, so the CLI uploads it as-is instead of running
#    npm against three VITE_LEMMA_* variables a fresh pod has never had.
lemma pods import .

# 3. Read back what actually landed, and the addresses it was given.
APP_URL="$(lemma apps get shipyard-app --output json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url") or "the app")')"
AUTHORIZE="$(lemma connectors connect-requests create github --output json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["authorization_url"])')"
# The two agent surfaces are named for this pod, so they read `triager.gilfoyle@`.
# The assistant's is the pod's own address and predates the rename above -- it is
# listed last, as the catch-all it actually is.
INBOXES="$(lemma surfaces list --output json | python3 -c '
import json, sys
d = json.load(sys.stdin)
by = {}
for s in (d["items"] if isinstance(d, dict) else d):
    by[s["name"]] = (s.get("reach") or {}).get("email") or ""
rows = [(by.get("resend-triager"), "to have something triaged"),
        (by.get("resend-fixer"), "to ask for a change"),
        (by.get("resend-assistant"), "anything else")]
rows = [r for r in rows if r[0]]
pad = max([len(r[0]) for r in rows] or [0])
for i, row in enumerate(rows):
    label = "  Email it  " if i == 0 else "            "
    print(label + row[0].ljust(pad) + "  " + row[1])
')"

cat <<TXT

  gilfoyle is set up here.

  A red build, an issue or a pull request arrives; an agent works out what it is
  and how much it matters — checking how many people are actually hit before it
  calls anything urgent — and opens a pull request for the ones you mark. It
  never merges one.

  Open it   $APP_URL
$INBOXES
  Or just say it here.

  FIRST — nothing arrives until you do this.
  Connect GitHub, then run ./wire-github.sh

  $AUTHORIZE

  WHENEVER YOU LIKE

  Try it on a repository you already have: real failed builds, issues and pull
  requests out of its history, read by the real agent. Nothing in this pod is
  ever invented.

      ./seed/ingest.sh <owner/repo> 4        (needs the gh CLI signed in)

  Let it run unattended. All five automations are off, because one of them opens
  pull requests while nobody is watching.

      lemma schedules resume ci-failure      (and the rest, when you trust it)

  Invite the team by email, from the app's People page.

TXT
