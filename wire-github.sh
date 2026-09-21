#!/usr/bin/env bash
# Route the four inbound automations at your GitHub App installation.
#
# Run this ONCE, after the GitHub account is connected. Until then the four
# webhook schedules exist, look correct, and can never fire: their `config` is
# `{source, event}` with no `installation_id`, so no delivery matches them.
#
# The installation id is not something anyone types. The backend derives the
# whole routing key -- {source, installation_id, event} -- from the connected
# account, but only on the CREATE path. Re-importing an existing schedule
# updates it without re-provisioning, so the four are deleted and made again.
# That is the whole trick, and it is why this is a script and not a flag.
set -euo pipefail
cd "$(dirname "$0")"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID}"
export LEMMA_POD_ID

WEBHOOKS=(ci-failure pr-opened pr-comment issue-opened)

ACCOUNT="${1:-$(lemma connectors accounts list --output json | python3 -c '
import json, sys
accounts = [
    a for a in json.load(sys.stdin).get("items", [])
    if a.get("connector_id") == "github" and a.get("status") == "CONNECTED"
]
if not accounts:
    sys.exit("no CONNECTED github account — authorize one first, then re-run")
print(accounts[0]["id"])
')}"
echo "github account: $ACCOUNT"

for name in "${WEBHOOKS[@]}"; do
  lemma schedules delete "$name" --yes >/dev/null 2>&1 || true
done

lemma pods import ./schedules --var "github_account=$ACCOUNT"

# Provisioning is the only thing that can have written the installation id, so
# read it back rather than trusting that the import printed "created".
lemma schedules list --output json | python3 -c '
import json, sys
rows = json.load(sys.stdin)["items"]
bad = [
    r["name"] for r in rows
    if r["schedule_type"] == "WEBHOOK" and not (r.get("config") or {}).get("installation_id")
]
for r in rows:
    key = (r.get("config") or {}).get("installation_id", "—")
    print(f"  {r['name']:<16} {r['schedule_type']:<10} installation={key}")
if bad:
    sys.exit("UNROUTED, and they will never fire: " + ", ".join(bad))
print("all four inbound automations are routed. They are still paused.")
'
