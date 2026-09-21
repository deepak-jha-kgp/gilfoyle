#!/usr/bin/env bash
# Rebuild the app and publish its output as the bundle's app source.
#
# `apps/shipyard-app/source/` is a **prebuilt static site**, not a Vite project,
# and that is the whole reason a fresh pod is set up in seconds: the CLI's app
# tier is chosen by what it finds there. A `package.json` means "Vite" — npm
# install, npm build, and three required VITE_LEMMA_* env vars, none of which a
# fresh pod has. An `index.html` with no `package.json` means "static": uploaded
# as-is, no build, no env. The bundle ships the second one.
#
# Nothing pod-specific may be baked in. The host injects window.__LEMMA_CONFIG__
# at serve time, so the same bytes serve any pod on any server — but Vite WOULD
# inline a VITE_LEMMA_POD_ID if one were in the environment, and this repo is
# public. Hence `env -u`: the build runs with those unset no matter what is in
# your shell or in a .env.local you forgot about.
set -euo pipefail
cd "$(dirname "$0")"
OUT="../apps/shipyard-app/source"

[ -d node_modules ] || npm ci
env -u VITE_LEMMA_API_URL -u VITE_LEMMA_AUTH_URL -u VITE_LEMMA_POD_ID \
    -u VITE_LEMMA_APP_NAME -u VITE_LEMMA_APP_BASE_PATH \
    npm run build

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R dist/. "$OUT"/

# A pod id or an internal host in the shipped bundle would be published to a
# public repository, so fail loudly rather than commit one.
if grep -rqE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|asur\.work' "$OUT"; then
  echo "refusing: build output contains a uuid or an internal host" >&2
  exit 1
fi
echo "wrote $OUT"
