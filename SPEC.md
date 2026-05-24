# SPEC: GitClaw Circuit Breaker

Source: `docs/circuit-breaker-plan.md`

## §G

Build a GitClaw-native circuit breaker example that captures real SDK events, detects runaway agent behavior, writes auditable evidence, and proposes targeted git-native fixes.

## §C

- C1: SDK-first. Use `GCMessage` from `src/sdk-types.ts` as the primary runtime surface.
- C2: CLI is only a wrapper. Do not build a second agent runtime or custom model loop.
- C3: Fixtures prove regression behavior. Live/captured SDK events prove product reality.
- C4: Detector consumes normalized `CircuitBreakerEvent`, not raw `GCMessage`.
- C5: Persisted evidence must be traceable by `sessionId` and `eventIndex`.
- C6: P0 tool-loop detection must use paired `tool_use` and `tool_result` events.
- C7: `result_delta` must be deterministic. Text-only similarity cannot fire high-confidence P0 alone.
- C8: Cost baseline is read before any clean current run is written into it; statistical anomalies are quarantined until human labeling.
- C9: Cost spike is statistical only when `sample_count >= 5`; otherwise it is an absolute budget warning.
- C10: No-progress is advisory-only in v1 and cannot open a PR by itself.
- C11: Dry-run writes local artifacts and PR body. Live PR mode runs only after dry-run proof passes.
- C12: Patch plans must target the failure surface. No canned one-size patches.
- C13: Secrets and API keys are never written to git.
- C14: V1 avoids production claims, dashboards, automatic merge, Tavily/demo dependency, and second repo.
- C15: Verification must include `npm run build` and `npm test`.
- C16: Live proof runs are cost-bounded with an explicit assistant output cap; fixture detection remains LLM-free.

## §I

| id | surface | contract |
|---|---|---|
| I.sdk | `src/sdk-types.ts` | source type `GCMessage`; required fields: `toolCallId`, `toolName`, `args`, result `content`, `isError`; assistant usage is optional but preserved when present |
| I.adapter | `examples/circuit-breaker/message-adapter.ts` | exports `CircuitBreakerEvent`, `PersistedCircuitBreakerEvent`, and adapter funcs from `GCMessage` to normalized events |
| I.evidence | `examples/circuit-breaker/evidence-writer.ts` | writes/reads `memory/circuit-breaker/sessions/<session-id>.jsonl` with stable event indexes |
| I.delta | `examples/circuit-breaker/detector.ts` | extracts stable result ids and computes deterministic `result_delta` |
| I.detector | `examples/circuit-breaker/detector.ts` | analyzes normalized events and returns findings/interventions with evidence indexes |
| I.patch | `examples/circuit-breaker/patch-planner.ts` | maps findings to targeted patch plan, dry-run patch text, and PR body |
| I.github | `examples/circuit-breaker/github-pr-writer.ts` | uses GitHub REST refs, contents, and pulls APIs to create/reuse reviewable PRs |
| I.calibration | `examples/circuit-breaker/calibration.ts` | regenerates `memory/circuit-breaker/calibration.md` from intervention YAML outcomes |
| I.identity | `examples/circuit-breaker/run-identity.ts` | derives agent name, model, and rules hash from run context |
| I.lifecycle | `examples/circuit-breaker/run-lifecycle.ts` | owns ordered run execution: evidence, analysis, intervention, optional PR, calibration |
| I.cli | `examples/circuit-breaker/run.ts` | supports `--fixture`, `--agent-dir`, `--prompt`, `--max-tokens`, `--dry-run`, `--open-pr` |
| I.proof | `examples/circuit-breaker/verify-artifacts.ts`, `demo.sh`, `live-proof.sh`, `pr-proof.sh` | verifies generated evidence and gives reviewers repeatable fixture, live, and optional PR proof paths |
| I.proof-report | `examples/circuit-breaker/PROOF.md` | reviewer-facing proof report with latest fixture, live provider, PR, trust-boundary, and gate evidence |
| I.skill | `skills/circuit-breaker/SKILL.md` | GitClaw skill with frontmatter and small input/output contract |
| I.memory | `memory/circuit-breaker/` | durable `sessions/`, `interventions/`, clean `baselines/`, quarantined baseline anomalies, and `calibration.md` artifacts |
| I.tests | `test/` or `examples/circuit-breaker/*.test.ts` | Node test runner tests for adapter, evidence, detector, patch planner, CLI fixtures |

## §V

- V1: Adapter imports the real `GCMessage` type from `src/sdk-types.ts`.
- V2: Adapter preserves `toolCallId`, `toolName`, `args`, `content`, `isError`, and preserves `usage.totalTokens` plus `usage.costUsd` when assistant usage is present.
- V3: Malformed required SDK fields throw clear schema errors; valid assistant messages without usage are ignored for cost analysis instead of failing loop detection.
- V4: Every persisted event has `sessionId`, monotonic `eventIndex`, `observedAt`, and normalized `event`.
- V5: Session JSONL can be replayed into the detector without loss of evidence indexes.
- V6: Tool-loop detector only fires high-confidence P0 when repeated `tool_use` events have paired `tool_result` events.
- V7: Argument similarity threshold defaults to `0.90` and window size defaults to `3`.
- V8: Result delta extracts stable ids from JSON keys `url`, `uri`, `href`, `path`, `file`, `id`, and `sha`.
- V9: Result delta text fallback extracts URLs and file paths, normalizes URL hostnames, drops fragments, and strips cache/tracking params.
- V10: If no stable result ids exist, `result_delta` is `unknown`; primary P0 cannot fire from text similarity alone.
- V11: Loop intervention records cite the session JSONL path and exact event indexes.
- V12: Baseline anomaly detection reads prior baseline before updating; clean runs update the baseline, but statistical anomalies are quarantined outside the clean baseline.
- V13: Statistical cost anomaly requires at least five baseline samples.
- V14: No-progress finding is advisory-only and cannot produce a PR action by itself.
- V15: Patch planner chooses target from finding type: skill/rules for repeated low-delta tools, `RULES.md` for pure cost unless runtime budget enforcement exists, hook config for dangerous tools.
- V16: Dry-run writes intervention YAML and PR body/patch locally without network writes.
- V17: Live PR mode creates a branch and PR only after dry-run validation is green.
- V18: Fixture loop run produces exactly one intervention; normal fixture produces none; malformed fixture fails loudly.
- V19: README distinguishes fixture evidence from live/captured SDK evidence.
- V20: `npm run build` and `npm test` pass before demo.
- V21: Live PR mode uses `GITHUB_TOKEN` plus `--github-repo OWNER/REPO`, creates/reuses a branch, patches only the planned target file, opens/reuses a PR, and rewrites the intervention record with the PR URL.
- V22: Calibration is regenerated from intervention records; pending decisions are not counted as true or false positives, and precision is `N/A` until at least one human decision exists.
- V23: Cost anomaly interventions are PR-capable only when the classification is statistical (`sample_count >= 5`); absolute budget warnings remain non-PR evidence.
- V24: Run identity uses explicit CLI values when provided, preserves live SDK session id when available, otherwise derives agent name from `agentDir`, model from assistant usage when present, and rules hash from `RULES.md` when available.
- V25: `run.ts` remains a CLI/capture wrapper; run ordering invariants live in `run-lifecycle.ts`.
- V26: Demo proof scripts run artifact verification; reviewers can see fixture evidence, real SDK capture evidence, and optional real PR evidence without reading implementation first.
- V27: Live proof and PR proof paths expose `--max-tokens`/`MAX_TOKENS`; the SDK/CLI applies a conservative default output cap when no agent or call-specific cap is set.
- V28: Reviewer-facing docs present fixture detector proof, live SDK/provider proof, and real PR proof as one product chain, with explicit trust boundaries and no production overclaims.

## §T

| id | status | task | cites |
|---|---|---|---|
| T1 | x | Implement adapter slice with `CircuitBreakerEvent`, persisted event type, valid fixtures, malformed fixtures, and adapter tests | V1,V2,V3,I.sdk,I.adapter,I.tests |
| T2 | x | Implement evidence slice to write/read session JSONL with stable event indexes and replay support | V4,V5,I.evidence,I.memory,I.tests |
| T3 | x | Implement deterministic result-id extraction and `result_delta` calculation | V8,V9,V10,I.delta,I.tests |
| T4 | x | Implement P0 tool-loop detector over normalized events with paired result checks and confidence output | V6,V7,V10,V11,I.detector,I.tests |
| T5 | x | Implement intervention writer that saves YAML records under `memory/circuit-breaker/interventions/` | V11,V16,I.detector,I.memory,I.tests |
| T6 | x | Implement targeted patch planner and dry-run PR body generation | V15,V16,I.patch,I.tests |
| T7 | x | Implement fixture CLI path for loop, normal, cost, and malformed sessions | V18,I.cli,I.evidence,I.detector,I.patch,I.tests |
| T8 | x | Implement live SDK capture path from GitClaw query to session JSONL and dry-run intervention | V1,V4,V5,V16,I.sdk,I.cli,I.evidence |
| T9 | x | Add `skills/circuit-breaker/SKILL.md` with frontmatter and concise input/output contract | C1,C2,I.skill |
| T10 | x | Implement cost baseline read/update and cost-warning/anomaly classification | V12,V13,I.detector,I.memory,I.tests |
| T11 | x | Add README/demo docs with exact commands, artifact map, live-vs-fixture trust boundary, and no production overclaims | V19,C14,I.cli,I.memory |
| T12 | x | Run final validation: `npm run build`, `npm test`, fixture loop, normal fixture, live dry-run, and artifact inspection | V18,V20,I.tests,I.cli,I.memory |
| T13 | x | Implement live GitHub PR mode after local dry-run artifacts exist, with mocked REST-contract tests and README commands | V17,V21,I.github,I.cli,I.tests |
| T14 | x | Implement honest calibration.md generation from intervention YAML records and wire it into runner outputs | V22,I.calibration,I.memory,I.cli,I.tests |
| T15 | x | Promote statistical cost anomalies into targeted `RULES.md` interventions while keeping low-sample warnings advisory and quarantining anomalous samples | V12,V13,V15,V23,I.patch,I.cli,I.tests |
| T16 | x | Add a one-command fixture demo script that builds, runs loop/normal/cost evidence paths, and prints generated artifacts | V18,V19,V20,I.cli,I.memory |
| T17 | x | TDD hardening pass for adapter errors, normalized result-delta loops, mixed-tool detector windows, malformed fixture atomicity, and idempotent patch planning | V3,V6,V8,V9,V16,I.adapter,I.detector,I.patch,I.cli,I.tests |
| T18 | x | Deepen architecture around run lifecycle, run identity, detector-specific interventions, patch-plan content application, and a thinner GitHub adapter | V21,V24,V25,I.identity,I.lifecycle,I.github,I.patch,I.tests |
| T19 | x | Add proof scripts and artifact verification so fixture, live, and optional PR demos have checked evidence paths | V19,V21,V26,I.proof,I.tests |
| T20 | x | Add LLM cost guardrails: shared default max token cap, per-call proof caps, and tests/docs for explicit output limits | C16,V27,I.cli,I.tests |
| T21 | x | Add reviewer-facing proof report and top-level README entry so the product proof is visible without reading the implementation first | V19,V28,I.proof-report |

## §B

| id | date | cause | fix |
|---|---|---|---|
