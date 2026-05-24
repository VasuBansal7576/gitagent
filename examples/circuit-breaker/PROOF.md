# Circuit Breaker Proof Report

Date: 2026-05-24
Branch: `codex/circuit-breaker`

## What Was Proven

The circuit breaker has three proof paths. They are separate on purpose:

| Proof path | Evidence | Result |
|---|---|---|
| Deterministic detector proof | `examples/circuit-breaker/demo.sh` | Passed; loop fixture produced one intervention, normal fixture produced none, low-sample cost fixture stayed advisory |
| Live SDK/provider proof | `examples/circuit-breaker/live-proof.sh` with Groq | Passed; real `query()` stream produced assistant usage evidence with `provider: groq` and `stopReason: stop` |
| Real GitHub PR proof | GitHub REST PR writer | Passed; opened `https://github.com/VasuBansal7576/gitagent/pull/1` |

This combination is the product proof:

1. The detector is deterministic and regression-testable.
2. The adapter observes real GitClaw SDK messages from a live provider run.
3. The intervention path can produce a real human-reviewable GitHub PR.

## Latest Evidence

### Fixture Incident

Command:

```bash
examples/circuit-breaker/demo.sh
```

Observed result:

- loop fixture wrote `memory/circuit-breaker/sessions/search-loop-session.jsonl`
- loop fixture wrote one `tool-loop-v1` intervention
- loop fixture wrote a unified patch and PR body
- normal fixture wrote session evidence only
- low-sample cost fixture wrote an absolute budget warning only
- artifact verification passed

### Live Provider Capture

Command shape:

```bash
MODEL=groq:llama-3.3-70b-versatile \
PROMPT="Say ok in one short sentence." \
MAX_TOKENS=128 \
NO_TOOLS=1 \
examples/circuit-breaker/live-proof.sh
```

Verified event:

```json
{
  "type": "assistant_usage",
  "model": "llama-3.3-70b-versatile",
  "provider": "groq",
  "inputTokens": 820,
  "outputTokens": 3,
  "totalTokens": 823,
  "costUsd": 0.00048617,
  "stopReason": "stop"
}
```

This proves the circuit breaker can capture a real GitClaw SDK/provider run
without relying on fixture-only evidence.

### GitHub PR Intervention

PR: `https://github.com/VasuBansal7576/gitagent/pull/1`

Observed result:

- branch: `circuit-breaker/2026-05-24T11-14-38.724Z-github-pr-fixture-20260524T111438Z-tool-loop-v1`
- target: `RULES.md`
- commit: `6ce2fa0`
- PR title: `circuit-breaker: add guardrail for search_docs loop`
- status: open

The PR was created from deterministic incident evidence. That is intentional:
the PR proof validates the external intervention machinery without depending on
LLM randomness during a presentation.

## Trust Boundary

What this project claims:

- detects repeated low-progress tool loops from normalized GitClaw SDK events
- records event-indexed evidence under `memory/circuit-breaker/`
- classifies cost behavior without poisoning baselines with anomalies
- writes an intervention YAML, unified patch, PR body, and calibration summary
- can open a real GitHub PR after local artifact verification passes

What it does not claim:

- automatic production blocking
- automatic merge
- statistically meaningful precision before human-labeled outcomes exist
- live loop reproduction on every provider prompt

V1 is an advisory circuit breaker: observe, detect, record, propose. Humans
still review and merge.

## Final Gates

The current branch has passed:

- `npm run build`
- `npm test`
- `examples/circuit-breaker/demo.sh`
- Groq `examples/circuit-breaker/live-proof.sh`
- GitHub PR proof
- `git diff --check`
- `npm audit --json`
- `npm audit signatures`
- `npm pack --dry-run`
