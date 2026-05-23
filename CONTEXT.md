# Project Context

## Domain Terms

- **Circuit Breaker**: GitClaw-native example that observes `GCMessage` runs, writes evidence, detects runaway behavior, and proposes reviewable fixes.
- **Session Evidence**: JSONL records under `memory/circuit-breaker/sessions/` containing normalized events with stable `sessionId` and `eventIndex` values.
- **Run Identity**: agent name, model, and rules hash used to key baselines and intervention records.
- **Run Lifecycle**: ordered execution flow that persists session evidence, analyzes detector signals, writes interventions, opens optional PRs, and regenerates calibration.
- **Intervention**: YAML record under `memory/circuit-breaker/interventions/` that cites evidence and describes the proposed action.
- **Patch Plan**: reviewable fix proposal containing target file, patch text, PR body, and the content transformation used by live PR mode.
- **Calibration**: markdown summary generated from intervention records and human decisions; pending records are not counted as wins.
