# GitClaw Circuit Breaker - Native Build Plan

Status: design note for this GitClaw fork
Date: 2026-05-23

## 0. What This Is

Build a small GitClaw-native circuit breaker that detects runaway agent behavior and proposes a repo change through a pull request.

The point is not to build a second agent runtime. GitClaw is already the runtime. This project should prove that a GitClaw session can be observed, scored, and corrected using the same git-native primitives the project already supports:

- `agent.yaml`
- `SOUL.md`
- `RULES.md`
- `skills/<name>/SKILL.md`
- `memory/`
- hooks
- SDK message events
- session cost telemetry
- branches and pull requests

The hiring signal is simple: "I used GitAgent/GitClaw as intended, found a real failure mode, and built a small guardrail that leaves auditable evidence."

## 1. Why The Original Plan Changed

The previous plan was too large and not native enough. It described two custom Python repositories, a hand-written LLM loop, Tavily search, custom memory artifacts, custom baseline generation, and custom GitHub PR logic. That made the project look like a separate agent framework rather than a GitAgent/GitClaw extension.

These are the fixes applied in this version:

| Old plan problem | Fix in this plan |
|---|---|
| Custom `runner.py` acted like a fake GitClaw runtime | Use GitClaw CLI/SDK as the runtime |
| Flat `skills/research.md` structure | Use `skills/<name>/SKILL.md` with frontmatter |
| Two repos before proving one useful loop | Start with one example/plugin inside this fork |
| Deliberately broken demo agent was required | Use a reproducible demo scenario, but the guard works on real GitClaw events |
| Baseline was updated before anomaly detection | Detect against prior baseline first; update baseline only after classification |
| `--dry-run` was referenced where no parser supported it | Define dry-run only for the circuit breaker command |
| "Predictive/calibrated" claims were ahead of evidence | Call it detection plus intervention until enough labeled outcomes exist |
| PR claims sounded hard to trust | Keep PR body evidence-based and small |

## 2. Project Shape

Add a focused example under this fork:

```text
gitagent/
  docs/
    circuit-breaker-plan.md
  examples/
    circuit-breaker/
      README.md
      run.ts
      message-adapter.ts
      detector.ts
      evidence-writer.ts
      patch-planner.ts
      fixtures/
        search-loop-session.json
        cost-spike-session.json
        normal-session.json
        malformed-session.json
      expected/
        loop-intervention.md
  skills/
    circuit-breaker/
      SKILL.md
      scripts/
        analyze-session.ts
  memory/
    circuit-breaker/
      baselines/
      interventions/
      calibration.md
```

This keeps the demo inside the actual GitClaw fork and makes it obvious that the implementation extends the framework instead of replacing it.

## 3. Native Architecture

### Runtime

Use the GitClaw SDK as the primary runtime surface. The CLI can be a wrapper for
the demo command, but detection should be built around the SDK `GCMessage`
stream. Do not build a new model loop.

The circuit breaker should observe these existing surfaces:

- SDK message stream: `tool_use`, `tool_result`, `assistant`, `system`
- usage/cost data already exposed on assistant messages
- programmatic hooks such as `preToolUse` for optional blocking
- script hooks such as `pre_tool_use` when a file-based example is better
- git state from the working repo
- existing `memory/` for durable records

The implementation spine should be:

```text
real GitClaw run
  -> GCMessage stream
  -> message-adapter.ts
  -> memory/circuit-breaker/sessions/<session-id>.jsonl
  -> detector.ts
  -> memory/circuit-breaker/interventions/<id>.yaml
  -> patch-planner.ts
  -> dry-run patch or PR body
```

This is the product proof chain. If any link is missing, the demo becomes less
trustworthy.

### SDK Event Contract

Do not guess the message shape. The detector must import the real exported SDK
type and normalize from that type:

```ts
import type { GCMessage } from "../../src/sdk-types.js";
```

Current required fields from `GCMessage`:

| Message type | Required fields for this project |
|---|---|
| `assistant` | `model`, `provider`, `stopReason`, `usage.totalTokens`, `usage.costUsd`, `usage.inputTokens`, `usage.outputTokens` |
| `tool_use` | `toolCallId`, `toolName`, `args` |
| `tool_result` | `toolCallId`, `toolName`, `content`, `isError` |
| `system` | `subtype`, `content`, `metadata.sessionId` when present |

Important naming detail: this repo uses `toolCallId`, not `tool_use_id`.

The implementation should add a tiny adapter module, for example
`examples/circuit-breaker/message-adapter.ts`, that converts `GCMessage` into a
detector-owned event shape:

```ts
type CircuitBreakerEvent =
  | {
      type: "tool_use";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      content: string;
      isError: boolean;
    }
  | {
      type: "assistant_usage";
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      stopReason: string;
    };
```

All detection code should consume only `CircuitBreakerEvent`, not raw
`GCMessage`. This creates one narrow place to update if the SDK evolves.

Every persisted event should include:

```ts
{
  sessionId: string;
  eventIndex: number;
  observedAt: string;
  event: CircuitBreakerEvent;
}
```

The intervention record must cite `eventIndex` values from the session JSONL, so
a reviewer can trace the detection back to exact run evidence.

Add tests that fail loudly if the SDK shape drifts:

- compile-time type test imports `GCMessage` and passes representative messages
  through the adapter
- runtime fixture test asserts `toolCallId`, `toolName`, `args`, and
  `usage.totalTokens`/`usage.costUsd` are preserved
- malformed fixture test asserts missing required fields throw a clear error
  instead of producing a false negative

This is the main handoff risk. Nail it before polishing README/demo copy.

### Detection Boundary

The first version should be post-run or near-real-time advisory, not a full hard
kill switch. It must still produce a concrete patch proposal; "advisory" means
it does not stop the live run, not that it only prints warnings.

Good v1 behavior:

1. Observe a GitClaw run.
2. Detect repeated tool calls, low state progress, or cost spikes.
3. Write an intervention record to `memory/circuit-breaker/interventions/`.
4. Generate a narrow patch against `RULES.md`, `agent.yaml`, or a relevant
   `skills/<name>/SKILL.md`.
5. In dry-run mode, save the patch and PR body locally.
6. In live PR mode, open a reviewable PR from a branch.

Avoid claiming live interception until the hook path is implemented and tested.

## 4. Detection Rules

### P0: Tool Loop

Detect when the same tool is called repeatedly with nearly identical arguments while results stop changing.

Inputs:

- consecutive `tool_use` events
- matching `toolName`
- matching `toolCallId` pairs between `tool_use` and `tool_result`
- normalized argument similarity
- result delta from `tool_result`
- configurable window size

Default rule:

```yaml
id: tool-loop-v1
tool_window: 3
arg_similarity_threshold: 0.90
min_result_delta: 0.05
action: propose_rule_patch
```

Evidence to save:

- session id
- session event log path
- event indexes for the matched `tool_use` and `tool_result` events
- tool name
- normalized args for the matched window
- result delta
- confidence score
- exact proposed patch

### Result Delta

Do not leave `result_delta` fuzzy. V1 uses deterministic structured-item
progress.

For each matched `tool_result`, parse `content` as JSON when possible and
extract stable identifiers from these keys anywhere in the object:

- `url`
- `uri`
- `href`
- `path`
- `file`
- `id`
- `sha`

If JSON parsing fails, extract URLs and absolute or repo-relative file paths from
plain text. Normalize values by trimming whitespace, lowercasing URL hostnames,
removing URL fragments, and dropping obvious timestamp/cache query parameters
such as `utm_*`, `ts`, `timestamp`, and `cache_bust`.

For a loop window:

```text
window_items = all normalized result items in the window
new_items = window_items not seen before the window
result_delta = new_items.size / max(1, window_items.size)
```

The tool-loop detector can fire only when:

- args are similar enough,
- `result_delta` is below threshold,
- and the matched `tool_use` events have paired `tool_result` events.

If no stable result items can be extracted, set `result_delta: unknown`. Do not
fire the primary P0 rule from text similarity alone. In that case, require a
secondary signal such as repeated identical args plus cost growth or max-window
iteration count, and label the finding `medium` confidence.

### P1: Cost Spike

Detect when a session cost is meaningfully above prior clean sessions for the same agent and model.

Important correction: compare against the previous baseline before writing the new sample.

Baseline key:

```text
agent_name + model + rules_hash
```

Default rule:

```yaml
id: cost-spike-v1
min_baseline_samples: 5
multiplier_over_p95: 3
absolute_floor_usd: 1.00
action: propose_budget_guardrail
```

If there are fewer than five baseline samples, do not call it a statistical anomaly. Call it an "absolute budget warning" only if it crosses the floor.

Cost spike is supporting evidence in the five-minute demo, not the main proof.
The main proof should be the deterministic tool-loop detector because it works
with one captured run. Cost baselines become stronger after repeated real runs.

### P2: No Progress

Detect when an agent keeps responding or using tools while the repo diff, memory state, or task result does not materially change.

This is advisory-only in v1. It can be written into the intervention record, but
it must not open a PR by itself because it is easier to false-positive.

## 5. Intervention Records

Write one YAML record per intervention:

```yaml
id: 2026-05-23T11-20-00Z-tool-loop-v1
session_id: gitclaw/session-abc123
agent: research-agent
model: anthropic:claude-sonnet-4-5-20250929
rules_hash: abc12345
detector: tool-loop-v1
severity: high
evidence:
  session_event_log: memory/circuit-breaker/sessions/session-abc123.jsonl
  event_indexes: [12, 13, 16, 17, 20, 21]
  tool: search_docs
  window_size: 3
  arg_similarity: 0.94
  result_delta: 0.00
action:
  type: pull_request
  status: dry_run
  pr_url: null
  patch_target: RULES.md
human_decision: null
created_at: 2026-05-23T11:20:00Z
```

This keeps calibration honest. A record is evidence, not a victory lap.

## 6. PR Behavior

The PR should be narrow and reviewable.

Allowed patch targets:

- `RULES.md`
- `skills/<affected-skill>/SKILL.md`
- `agent.yaml` runtime limits if appropriate
- `hooks/hooks.yaml` only if the project already uses hooks

Do not push directly to `main`.

The patch must be targeted to the failure surface:

| Finding | Preferred patch target | Example patch |
|---|---|---|
| repeated search/read/list tool with low result delta | affected `skills/<name>/SKILL.md` or `RULES.md` | add max attempts and stop after two zero-new-result calls |
| repeated shell/file tool with same args | `RULES.md` or hook config | require changing search strategy after repeated identical command output |
| cost spike with no loop | `agent.yaml` | lower `max_tokens`, add budget warning, or switch to cheaper model if repo policy allows |
| dangerous or high-blast-radius tool | existing hook config | add `pre_tool_use` block or require approval |

Avoid canned patches. The PR body should show why the selected file is the right
place for the fix.

PR body should include:

- what fired
- exact evidence window
- why this is risky
- proposed change
- how to test
- whether this was dry-run or live

Avoid oversized claims like "predictive precision" until enough human decisions exist.

## 7. Example Skill

Target skill path:

```text
skills/circuit-breaker/SKILL.md
```

The skill should be small:

```markdown
---
name: circuit-breaker
description: Analyze GitClaw session events for tool loops, no-progress behavior, and cost spikes.
---

# Circuit Breaker

Use this skill when reviewing a GitClaw run for runaway behavior.

## Inputs

- Session event log or SDK message stream
- Current `RULES.md`
- Relevant skill files
- Prior baselines in `memory/circuit-breaker/baselines/`

## Output

- One intervention YAML record when a rule fires
- A concise PR body when `--open-pr` is enabled
- No PR when evidence is below threshold
```

## 8. CLI/Example Command

The example can be run in fixture mode or live mode.

```bash
# Fixture mode for repeatable review
npm run build
node dist/examples/circuit-breaker/run.js \
  --fixture examples/circuit-breaker/fixtures/search-loop-session.json \
  --dry-run

# Live mode around a real GitClaw run
node dist/examples/circuit-breaker/run.js \
  --agent-dir ./agents/research-agent \
  --prompt "Research the same narrow topic until you have ten unique sources" \
  --dry-run
```

`--dry-run` means write the intervention record and PR body locally, but do not open a GitHub PR.

`--open-pr` can be added only after dry-run evidence is correct.

## 9. Validation Checklist

Before showing this as an assignment/demo:

- `npm install` succeeds
- `npm run build` succeeds
- existing tests still pass
- adapter tests prove `GCMessage` fields map into `CircuitBreakerEvent`
- malformed event fixtures fail loudly with clear schema errors
- live mode writes `memory/circuit-breaker/sessions/<session-id>.jsonl`
- fixture mode produces exactly one intervention for the loop fixture
- fixture mode produces no intervention for a normal fixture
- live dry-run writes an intervention record under `memory/circuit-breaker/interventions/`
- intervention records cite exact session event indexes
- baseline is read before it is updated
- cost spike is not presented as statistical unless baseline sample count is sufficient
- secrets are never written to git
- PR patch is targeted to the failure surface and touches only intended files
- README explains fixture evidence versus live evidence

## 10. Demo Script

Five-minute demo:

1. Open this GitClaw fork and show the circuit breaker example.
2. Run live dry-run around a GitClaw session and show the captured session JSONL.
3. Show deterministic detection with exact event indexes.
4. Show the intervention YAML in `memory/circuit-breaker/interventions/`.
5. Show the generated targeted patch and PR body.
6. Run fixture mode briefly to show regression coverage.
7. Say: "The agent did not need a dashboard. The repo captured the behavior, the detector wrote evidence, and the fix is reviewable like code."

## 11. What Not To Build In V1

Do not build these until the small version works:

- a second standalone runtime
- a second repository
- a custom Python LLM loop
- Tavily/web-search dependency just for the demo
- statistical calibration without enough labeled outcomes
- automatic merging
- production claims
- a dashboard

## 12. Success Criteria

The project is successful when a reviewer can see:

- it runs inside the actual GitClaw fork
- it uses GitClaw events, hooks, memory, or SDK surfaces
- it detects one real class of failure
- it writes durable evidence
- it proposes a small git-native fix
- the demo can be repeated without secret keys in the repo

That is enough. Keep it sharp.

## 13. Implementation Order

Build as vertical slices, not layer-by-layer.

1. Adapter slice: import `GCMessage`, normalize to `CircuitBreakerEvent`, and
   test valid plus malformed messages.
2. Evidence slice: capture or replay messages into
   `memory/circuit-breaker/sessions/<session-id>.jsonl` with stable event
   indexes.
3. Tool-loop slice: detect one repeated-tool window with deterministic
   structured-item `result_delta`.
4. Intervention slice: write one YAML record that cites session event indexes.
5. Patch slice: generate a targeted patch and PR body in dry-run mode.
6. Live PR slice: only after dry-run proof is correct, create a branch and open
   a PR.
7. Cost-baseline slice: add baseline reading/updating after the loop detector is
   already demonstrable.

This order keeps every step demoable and prevents the project from becoming a
large unfinished platform.
