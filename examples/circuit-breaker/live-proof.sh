#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(mktemp -d /tmp/gitclaw-cb-live-XXXXXX)}"
AGENT_DIR="${AGENT_DIR:-${1:-./agents/assistant}}"
SESSION_ID="${SESSION_ID:-live-proof-$(date -u +%Y%m%dT%H%M%SZ)}"
PROMPT="${PROMPT:-Use one or two tool calls to inspect this repo and summarize what changed.}"
REQUIRE_INTERVENTION="${REQUIRE_INTERVENTION:-0}"
MAX_TOKENS="${MAX_TOKENS:-2048}"
MODEL="${MODEL:-}"
NO_TOOLS="${NO_TOOLS:-0}"

echo "[live-proof] artifact root: ${ROOT_DIR}"
echo "[live-proof] agent dir: ${AGENT_DIR}"
echo "[live-proof] session id: ${SESSION_ID}"
echo "[live-proof] max tokens: ${MAX_TOKENS}"
if [[ -n "${MODEL}" ]]; then echo "[live-proof] model: ${MODEL}"; fi
echo "[live-proof] building GitClaw"
npm run build >/dev/null

RUN_ARGS=(
  --agent-dir "${AGENT_DIR}"
  --prompt "${PROMPT}"
  --session-id "${SESSION_ID}"
  --max-tokens "${MAX_TOKENS}"
  --dry-run
  --root-dir "${ROOT_DIR}"
)

if [[ -n "${MODEL}" ]]; then
  RUN_ARGS+=(--model "${MODEL}")
fi

if [[ "${NO_TOOLS}" == "1" ]]; then
  RUN_ARGS+=(--no-tools)
fi

node --experimental-strip-types examples/circuit-breaker/run.ts "${RUN_ARGS[@]}"

VERIFY_ARGS=(
  --root-dir "${ROOT_DIR}"
  --session-id "${SESSION_ID}"
  --require-calibration
)

if [[ "${REQUIRE_INTERVENTION}" == "1" ]]; then
  VERIFY_ARGS+=(--expect-interventions 1 --require-patch --require-pr-body)
fi

echo "[live-proof] verifying artifacts"
node --experimental-strip-types examples/circuit-breaker/verify-artifacts.ts "${VERIFY_ARGS[@]}"

echo "[live-proof] artifacts"
find "${ROOT_DIR}/memory/circuit-breaker" -type f | sort
