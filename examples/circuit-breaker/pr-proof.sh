#!/usr/bin/env bash
set -euo pipefail

AGENT_DIR="${AGENT_DIR:-${1:-examples/circuit-breaker/live-agent}}"
SESSION_ID="${SESSION_ID:-pr-proof-$(date -u +%Y%m%dT%H%M%SZ)}"
PROMPT="${PROMPT:-Stress-test the circuit breaker: read EVIDENCE.md four times with the exact same tool input before answering. Do not modify files.}"
BASE_BRANCH="${BASE_BRANCH:-main}"
MAX_TOKENS="${MAX_TOKENS:-2048}"
MODEL="${MODEL:-}"
BRANCH_NAME="${BRANCH_NAME:-}"

missing=()
if [[ -z "${GITHUB_REPO:-}" ]]; then
  missing+=("GITHUB_REPO=YOUR_USERNAME/gitclaw-demo-agent")
fi
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  missing+=("GITHUB_TOKEN")
fi
if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${GROQ_API_KEY:-}" && -z "${LYZR_API_KEY:-}" ]]; then
  missing+=("provider API key for the selected MODEL/agent")
fi
if (( ${#missing[@]} > 0 )); then
  echo "pr-proof runs a real GitClaw SDK capture and opens or reuses a real GitHub PR, so it requires: ${missing[*]}" >&2
  echo "Regression fixtures are not submission proof; run live-proof.sh only after provider credentials are available." >&2
  exit 1
fi
ROOT_DIR="${ROOT_DIR:-$(mktemp -d /tmp/gitclaw-cb-pr-XXXXXX)}"

echo "[pr-proof] artifact root: ${ROOT_DIR}"
echo "[pr-proof] target repo: ${GITHUB_REPO}"
echo "[pr-proof] mode: live SDK capture -> real GitHub PR"
echo "[pr-proof] max tokens: ${MAX_TOKENS}"
if [[ -n "${MODEL}" ]]; then echo "[pr-proof] model: ${MODEL}"; fi
npm run build >/dev/null

RUN_ARGS=(
  --agent-dir "${AGENT_DIR}"
  --prompt "${PROMPT}"
  --session-id "${SESSION_ID}"
  --max-tokens "${MAX_TOKENS}"
  --open-pr
  --github-repo "${GITHUB_REPO}"
  --base-branch "${BASE_BRANCH}"
  --root-dir "${ROOT_DIR}"
)

if [[ -n "${MODEL}" ]]; then
  RUN_ARGS+=(--model "${MODEL}")
fi

if [[ -n "${BRANCH_NAME}" ]]; then
  RUN_ARGS+=(--branch-name "${BRANCH_NAME}")
fi

node --experimental-strip-types examples/circuit-breaker/run.ts "${RUN_ARGS[@]}"

node --experimental-strip-types examples/circuit-breaker/verify-artifacts.ts \
  --root-dir "${ROOT_DIR}" \
  --session-id "${SESSION_ID}" \
  --expect-interventions 1 \
  --require-patch \
  --require-pr-body \
  --require-calibration

echo "[pr-proof] artifacts"
find "${ROOT_DIR}/memory/circuit-breaker" -type f | sort
