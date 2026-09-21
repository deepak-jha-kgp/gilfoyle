#!/usr/bin/env bash
# Set a fresh pod up. One command, about fifteen seconds.
#
#   LEMMA_POD_ID=<pod> ./setup.sh
#
# Imports every resource, names the pod, reads back what landed, and prints the
# GitHub authorization link a person has to open. It deliberately does NOT turn
# any automation on and does NOT put a single row in the queue: `dispatch-fixer`
# opens pull requests unattended, and an invented signal is worse than an empty
# list. Both are somebody's decision, made later and on purpose.
set -euo pipefail
cd "$(dirname "$0")"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID to the pod to set up}"
export LEMMA_POD_ID

# 1. The resources. No build and no --var: `apps/shipyard-app/source/` is built
#    output with no package.json, so the CLI uploads it as-is instead of running
#    npm against three VITE_LEMMA_* variables a fresh pod has never had.
lemma pods import .

# 2. The name, on its own, because it is the one step that can fail on its own.
#    Pod names are unique per organization, and --set-pod-meta applies metadata
#    FIRST -- so a second `gilfoyle` in the same org 409s and takes the whole
#    import down with it. Renaming from a directory holding only pod.json costs
#    four seconds and cannot cost anything else.
META="$(mktemp -d)"; trap 'rm -rf "$META"' EXIT
cp pod.json "$META/"
if ! lemma pods import "$META" --set-pod-meta >/dev/null 2>&1; then
  echo "note: could not rename the pod to 'gilfoyle' — the name is probably" >&2
  echo "      taken in this organization. Everything else imported fine." >&2
fi

# 3. What landed.
lemma pods describe

# 4. The one step that needs a person.
echo
echo "Connect GitHub — open this, authorize, then run ./wire-github.sh:"
lemma connectors connect-requests create github --output json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["authorization_url"])'
echo
echo "Until that is done the four inbound automations have no routing key and"
echo "cannot fire. All five are paused, which is how they should stay for now."
