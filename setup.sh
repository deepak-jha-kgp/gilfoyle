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
if ! lemma pods import . --var "shipyard_app_slug=$SLUG" >"$LOG" 2>&1; then
  echo "the import failed. Full output:" >&2
  cat "$LOG" >&2
  exit 1
fi

# 3. Read back what landed, and the addresses it was given.
APP_URL="$(lemma apps get shipyard-app --output json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url") or "")')"
AUTHORIZE="$(lemma connectors connect-requests create github --output json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["authorization_url"])')"
read -r MAIL_TRIAGER MAIL_FIXER MAIL_POD <<<"$(lemma surfaces list --output json | python3 -c '
import json, sys
d = json.load(sys.stdin)
by = {}
for s in (d["items"] if isinstance(d, dict) else d):
    by[s["name"]] = (s.get("reach") or {}).get("email") or "-"
print(by.get("resend-triager","-"), by.get("resend-fixer","-"), by.get("resend-assistant","-"))
')"

# `seed/ingest.sh` reads a repository with the `gh` CLI. Offering it to somebody
# whose workspace has no GitHub login is offering them a failure, so find out
# first and leave the line out rather than promise it.
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
  and you can forward anything to $MAIL_TRIAGER to have it
  looked at. ($MAIL_FIXER asks for a change;
  $MAIL_POD reaches me.)

TXT
