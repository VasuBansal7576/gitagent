#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(mktemp -d /tmp/gitclaw-cb-demo-XXXXXX)}"

echo "[demo] artifact root: ${ROOT_DIR}"
echo "[demo] building GitClaw"
npm run build >/dev/null

echo "[demo] loop fixture: should write one intervention"
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --fixture examples/circuit-breaker/fixtures/search-loop-session.json \
  --dry-run \
  --root-dir "${ROOT_DIR}"

echo "[demo] normal fixture: should write evidence only"
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --fixture examples/circuit-breaker/fixtures/normal-session.json \
  --dry-run \
  --root-dir "${ROOT_DIR}"

echo "[demo] low-sample cost fixture: should warn but not open an intervention"
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --fixture examples/circuit-breaker/fixtures/cost-spike-session.json \
  --dry-run \
  --root-dir "${ROOT_DIR}"

echo "[demo] artifacts"
find "${ROOT_DIR}/memory/circuit-breaker" -type f | sort
