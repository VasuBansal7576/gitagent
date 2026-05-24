# Circuit Breaker Proof Report

Date: 2026-05-24
Branch: `codex/circuit-breaker`

## Proof Boundary

The circuit breaker has regression checks and submission proof. They are
separate on purpose.

| Proof path | Evidence | Result |
|---|---|---|
| Regression detector check | `examples/circuit-breaker/demo.sh` | Passed; useful for repeatability, not submission proof |
| Live SDK/provider proof | `examples/circuit-breaker/live-proof.sh` with Groq credentials | Passed; real `query()` stream produced repeated real `read` calls and one intervention |
| Live GitHub PR proof | `examples/circuit-breaker/pr-proof.sh` with Groq credentials, `GITHUB_TOKEN`, and `GITHUB_REPO` | Passed; opened `https://github.com/VasuBansal7576/gitagent/pull/2` |

This is the product proof:

1. The detector remains regression-testable.
2. The adapter observes real GitClaw SDK messages from a live provider run.
3. A real detected intervention can produce a real human-reviewable GitHub PR.

For the subsystem architecture, component boundaries, design decisions, risk
register, and reviewer checklist, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Latest Evidence

### Regression Incident

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

This is regression evidence only. It is not counted as final submission proof.

### Live Provider Capture

Command:

```bash
GROQ_API_KEY=<from local env> \
MODEL=groq:llama-3.3-70b-versatile \
AGENT_DIR=examples/circuit-breaker/live-agent \
PROMPT="Stress-test the circuit breaker: read EVIDENCE.md four times with the exact same tool input before answering. Do not modify files." \
MAX_TOKENS=2048 \
REQUIRE_INTERVENTION=1 \
examples/circuit-breaker/live-proof.sh
```

Observed result:

- session: `live-proof-20260524T152019Z`
- normalized events: `10`
- finding count: `1`
- provider/model: `groq:llama-3.3-70b-versatile`
- live tool: `read`
- artifact verification passed

This proves the circuit breaker can capture a real GitClaw SDK/provider run
without relying on fixture-only evidence.

### Live GitHub PR Intervention

Command:

```bash
GROQ_API_KEY=<from local env> \
GITHUB_TOKEN=<from gh auth token> \
GITHUB_REPO=VasuBansal7576/gitagent \
MODEL=groq:llama-3.3-70b-versatile \
MAX_TOKENS=2048 \
examples/circuit-breaker/pr-proof.sh
```

PR: `https://github.com/VasuBansal7576/gitagent/pull/2`

Observed result:

- session: `pr-proof-20260524T152037Z`
- normalized events: `10`
- branch: `circuit-breaker/2026-05-24T15-20-41.286Z-pr-proof-20260524T152037Z-tool-loop-v1`
- target: `RULES.md`
- commit: `e4de36711c4e313465875fc35981fc6fa7b9a7b8`
- PR title: `circuit-breaker: add guardrail for read loop`
- status: open
- artifact verification passed

This check proves the GitHub writer can create a branch, update `RULES.md`, and
open a PR from a live SDK/provider run.

## Trust Boundary

What this project claims:

- detects repeated low-progress tool loops from normalized GitClaw SDK events
- records event-indexed evidence under `memory/circuit-breaker/`
- classifies cost behavior without poisoning baselines with anomalies
- writes an intervention YAML, unified patch, PR body, and calibration summary
- can open a real GitHub PR after a live run produces an intervention and local artifact verification passes

What it does not claim:

- automatic production blocking
- automatic merge
- statistically meaningful precision before human-labeled outcomes exist
- live loop reproduction on every provider prompt
- fixture evidence as final submission proof

V1 is an advisory circuit breaker: observe, detect, record, propose. Humans
still review and merge.

## Final Gates

Current local regression/build gates:

- `npm run build`
- `npm test`
- `examples/circuit-breaker/demo.sh`
- `git diff --check`
- `npm pack --dry-run`
- no PR when evidence is below threshold

Real-only submission gates passed:

- `examples/circuit-breaker/live-proof.sh` with a real Groq provider key
- `examples/circuit-breaker/pr-proof.sh` with a real Groq provider key, `GITHUB_TOKEN`, and `GITHUB_REPO`
