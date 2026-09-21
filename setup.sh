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

# 2. Everything else. No build and no --var: `apps/shipyard-app/source/` is built
#    output with no package.json, so the CLI uploads it as-is instead of running
#    npm against three VITE_LEMMA_* variables a fresh pod has never had.
#
#    Quietly. Whoever is reading the other end of this is a person who asked for
#    a thing, not an operator watching a deploy; sixteen rows of "created" is a
#    build log, and pasting one at somebody is not an introduction. The log is
#    kept, so it is there if anything goes wrong or anybody asks.
#
#    The app's slug is named explicitly, because it is globally unique across
#    every pod on the server and the CLI's own fallback is the pod id's first
#    EIGHT hex characters -- which two pods created in the same moment share.
#    When that collides the app step 409s and takes the whole import with it,
#    schedules and grants included. The id's tail is random, so use that.
SLUG="shipyard-app-$(printf '%s' "${LEMMA_POD_ID//-/}" | tail -c 12)"
LOG="$(mktemp)"
echo "setting up — about fifteen seconds"
# One call when the pod's name is free. `--set-pod-meta` applies metadata before
# any resource, so the email surfaces are created already carrying the new name --
# and if the name is taken it is a 409 that aborts in seconds, before anything
# exists, which is why the fallback is a plain re-import rather than a repair.
if ! lemma pods import . --set-pod-meta --var "shipyard_app_slug=$SLUG" >"$LOG" 2>&1; then
  if grep -q 'POD_CONFLICT' "$LOG"; then
    echo "note: could not name this pod 'gilfoyle' — something else in this" >&2
    echo "      organization already is. Importing without the rename." >&2
    if ! lemma pods import . --var "shipyard_app_slug=$SLUG" >"$LOG" 2>&1; then
      echo "the import failed. Full output:" >&2; cat "$LOG" >&2; exit 1
    fi
  else
    echo "the import failed. Full output:" >&2; cat "$LOG" >&2; exit 1
  fi
fi

# The importer applies grants LAST -- after schedules, after surfaces, after
# files. Anything that fails in between takes them with it and leaves workloads
# granted nothing at all: an import that printed "created" for every resource
# and a pod that cannot do a single thing. That is not hypothetical; it happened
# on a pod whose own email surface was named slightly differently from this
# bundle's, and it cost somebody six minutes of reading CLI source to work out
# why. So read the grants back, and put them back from the bundle if they are
# missing. `--from-bundle` exists for exactly this.
for kind in agents functions; do
  [ -d "$kind" ] || continue
  for dir in "$kind"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    have="$(lemma "$kind" permissions get "$name" --output json 2>/dev/null \
      | python3 -c 'import json,sys
try: print(len(json.load(sys.stdin).get("grants") or []))
except Exception: print(-1)' 2>/dev/null || echo -1)"
    if [ "$have" = "0" ]; then
      echo "note: $name imported with no grants — restoring them from the bundle" >&2
      lemma "$kind" permissions replace "$name" --from-bundle "$dir" >/dev/null 2>&1 || true
    fi
  done
done

# 3. Read back what landed, and the addresses it was given. These are all
#    independent, so they go at once rather than one after another.
# A fresh organization has no auth config for GitHub, and a connect request against a
# connector nobody has installed comes back `404 CONNECTOR_NOT_FOUND` -- which
# reads like the platform does not support it. It does. `auth-configs create`
# installs the platform's own OAuth app (SYSTEM_DEFAULT: no client id, no secret,
# nobody types anything), and the very same request then returns a real
# authorization URL. Somebody lost a setup to that 404, so try, install, retry.
github_authorize() {
  local out
  out="$(lemma connectors connect-requests create github --output json 2>/dev/null || true)"
  if ! printf '%s' "$out" | grep -q authorization_url; then
    lemma connectors auth-configs create github >/dev/null 2>&1 || true
    out="$(lemma connectors connect-requests create github --output json 2>/dev/null || true)"
  fi
  printf '%s' "$out"
}

D="$(mktemp -d)"
lemma apps get shipyard-app --output json >"$D/app"  2>/dev/null &
lemma surfaces list --output json         >"$D/surf" 2>/dev/null &
github_authorize >"$D/cr" 2>/dev/null &
wait

APP_URL="$(python3 -c '
import json, sys
try: print(json.load(open(sys.argv[1])).get("url") or "the app")
except Exception: print("the app")
' "$D/app")"
AUTHORIZE="$(python3 -c '
import json, sys
try: print(json.load(open(sys.argv[1]))["authorization_url"])
except Exception: print("(no authorization url came back — start one from the connectors page)")
' "$D/cr")"
# The two agent surfaces are named for this pod, so they read `triager.gilfoyle@`.
# The assistant's is the pod's own address and predates the rename above -- it is
# listed last, as the catch-all it actually is.
INBOXES="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
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
except Exception: pass
' "$D/surf")"
rm -rf "$D"

# `seed/ingest.sh` reads a repository with the `gh` CLI. Offering that to somebody
# whose workspace has no GitHub login is offering them a failure, so find out
# first and leave the lines out rather than promise it.
SEED_LINE="  · fill it from a repo you already have — I pull the real failures,"
SEED_LINE2="    issues and pull requests out of its history and read them for you"
SEED_LINE3="    (a few minutes, and nothing in the queue is ever made up)"
if ! gh auth status >/dev/null 2>&1; then SEED_LINE=""; SEED_LINE2=""; SEED_LINE3=""; fi

cat <<TXT

────────────────────────────────────────────────────────────────────────────
 FOR YOU, NOT FOR THEM. Say the following in your own words, as one short
 message in prose. No command, no code block, no bullet characters if the
 channel does not render them, no copy of this frame. They are very likely
 on a phone, and they did not ask for a terminal.
 (Import log, if anything looks wrong: $LOG)

 When they come back, YOU run the thing — never hand them a command:
   they authorized GitHub  ->  ./wire-github.sh   (from this checkout; keep it)
   they named a repository ->  ./seed/ingest.sh <owner/repo> 4
   they said turn it on    ->  lemma schedules resume <name>, one at a time,
                               and say plainly that dispatch-fixer is the one
                               that opens pull requests unattended.
────────────────────────────────────────────────────────────────────────────

  Gilfoyle is set up, and watching nothing yet.

  What it will do: a red build, a new issue or a new pull request comes in from
  GitHub, and it works out what the thing actually is and how much it matters —
  including how many people are really affected, before it calls anything
  urgent. For the ones you pick, it drafts the fix as a pull request. It never
  merges anything.

  The one part only you can do is connect GitHub:

  $AUTHORIZE

  After that, just talk to me here. Worth saying:

  · show me what's broken
$SEED_LINE
$SEED_LINE2
$SEED_LINE3
  · start watching by itself — everything is switched off until you say so,
    because one of these opens pull requests while nobody is looking

  There is a board as well:
  $APP_URL

  And it answers on email:
$INBOXES

TXT
