#!/usr/bin/env bash
# Pull REAL events out of a GitHub repository and hand each to the triager, in
# the same shape the `ci-failure` / `issue-opened` / `pr-opened` automations
# deliver. Nothing here is invented: every field comes from `gh`.
#
#   LEMMA_POD_ID=<pod> ./seed/ingest.sh [owner/repo] [how-many-of-each]
#
# Use it to fill a fresh pod with real work, or to re-run the triager over
# history after changing its instruction.
set -euo pipefail
REPO="${1:-lemma-work/lemma-platform}"
N="${2:-4}"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID}"
export LEMMA_POD_ID

DIR="$(cd "$(dirname "$0")/.." && pwd)/payloads/real"
mkdir -p "$DIR"

python3 "$(dirname "$0")/build_payloads.py" "$REPO" "$N" "$DIR"

shopt -s nullglob
for f in "$DIR"/*.json; do
  echo "→ $(basename "$f")"
  ok=""
  for attempt in 1 2 3; do
    if lemma agents chat triager "$(cat "$f")" >/dev/null 2>&1; then ok=1; break; fi
    echo "  attempt $attempt failed; retrying"
    sleep 20
  done
  [ -n "$ok" ] && echo "  triaged" || echo "  GAVE UP — run it by hand to see why"
done

lemma query run "select s.source, s.kind, t.verdict, t.severity, t.action
                 from signal s left join triage t on t.signal_id = s.id
                 order by s.received_at desc"
