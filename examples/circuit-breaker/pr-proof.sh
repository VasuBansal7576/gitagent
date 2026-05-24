#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is required for PR proof" >&2
  exit 1
fi

if [[ -z "${GITHUB_REPO:-}" ]]; then
  echo "GITHUB_REPO is required, for example: GITHUB_REPO=YOUR_USERNAME/research-agent" >&2
  exit 1
fi

ROOT_DIR="${ROOT_DIR:-$(mktemp -d /tmp/gitclaw-cb-pr-XXXXXX)}"
AGENT_DIR="${AGENT_DIR:-${1:-./agents/assistant}}"
SESSION_ID="${SESSION_ID:-pr-proof-$(date -u +%Y%m%dT%H%M%SZ)}"
PROMPT="${PROMPT:-Research this repo narrowly and stop if repeated tool calls stop producing new evidence.}"
BASE_BRANCH="${BASE_BRANCH:-main}"
MAX_TOKENS="${MAX_TOKENS:-2048}"

echo "[pr-proof] artifact root: ${ROOT_DIR}"
echo "[pr-proof] target repo: ${GITHUB_REPO}"
echo "[pr-proof] max tokens: ${MAX_TOKENS}"
echo "[pr-proof] this creates or reuses a real GitHub branch and PR"
npm run build >/dev/null

node --experimental-strip-types examples/circuit-breaker/run.ts \
  --agent-dir "${AGENT_DIR}" \
  --prompt "${PROMPT}" \
  --session-id "${SESSION_ID}" \
  --max-tokens "${MAX_TOKENS}" \
  --open-pr \
  --github-repo "${GITHUB_REPO}" \
  --base-branch "${BASE_BRANCH}" \
  --root-dir "${ROOT_DIR}"

node --experimental-strip-types examples/circuit-breaker/verify-artifacts.ts \
  --root-dir "${ROOT_DIR}" \
  --session-id "${SESSION_ID}" \
  --expect-interventions 1 \
  --require-patch \
  --require-pr-body \
  --require-calibration

echo "[pr-proof] artifacts"
find "${ROOT_DIR}/memory/circuit-breaker" -type f | sort
