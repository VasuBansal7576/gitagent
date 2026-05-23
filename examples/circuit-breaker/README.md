# GitClaw Circuit Breaker

This example watches GitClaw SDK events for runaway behavior, writes durable
evidence, and proposes a small git-native fix.

It is not a second runtime. GitClaw produces the `GCMessage` stream; the circuit
breaker normalizes that stream, analyzes it, and writes reviewable artifacts.

## What It Proves

- Real SDK message shapes are adapted through `message-adapter.ts`
- Session evidence is written to `memory/circuit-breaker/sessions/*.jsonl`
- Tool-loop detection cites exact event indexes
- Interventions are saved as YAML records
- Dry-run mode writes a patch and PR body locally
- Cost spikes are warnings until enough baseline samples exist

## Fixture Mode

Fixture mode is deterministic regression evidence. It does not call an LLM.

```bash
npm run build
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --fixture examples/circuit-breaker/fixtures/search-loop-session.json \
  --dry-run
```

Expected result:

- one session JSONL under `memory/circuit-breaker/sessions/`
- one intervention YAML under `memory/circuit-breaker/interventions/`
- one `.patch.diff`
- one `.pr.md`

Normal fixture:

```bash
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --fixture examples/circuit-breaker/fixtures/normal-session.json \
  --dry-run
```

Expected result: session evidence only, no intervention.

Malformed fixture:

```bash
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --fixture examples/circuit-breaker/fixtures/malformed-session.json \
  --dry-run
```

Expected result: clear schema error, no silent false negative.

## Live Dry-Run Mode

Live mode captures a real GitClaw SDK run. This is the product proof path.

```bash
npm run build
node --experimental-strip-types examples/circuit-breaker/run.ts \
  --agent-dir ./agents/research-agent \
  --prompt "Research the same narrow topic until you have ten unique sources" \
  --session-id demo-live-run \
  --dry-run
```

Dry-run mode writes local evidence and PR text. It does not open a GitHub PR.

## Artifact Map

| Artifact | Meaning |
|---|---|
| `memory/circuit-breaker/sessions/<session-id>.jsonl` | captured normalized events with stable `eventIndex` values |
| `memory/circuit-breaker/interventions/<id>.yaml` | detector, severity, evidence window, and action metadata |
| `memory/circuit-breaker/interventions/<id>.yaml.patch.diff` | proposed patch for review |
| `memory/circuit-breaker/interventions/<id>.yaml.pr.md` | PR body with exact evidence |
| `memory/circuit-breaker/baselines/<key>.yaml` | cost baseline samples by agent, model, and rules hash |

## Trust Boundary

Fixture evidence proves deterministic detection behavior.

Live evidence proves the example can observe GitClaw SDK events from a real run.

Neither mode claims production interception. V1 is advisory: it detects,
records, and proposes a patch. A human reviews and merges any fix.
