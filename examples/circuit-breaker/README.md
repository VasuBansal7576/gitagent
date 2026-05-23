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
- Statistical cost anomalies propose a targeted `agent.yaml` budget guardrail
- Calibration is regenerated from human-labeled intervention outcomes

## Fixture Mode

Fixture mode is deterministic regression evidence. It does not call an LLM.

One-command fixture demo:

```bash
examples/circuit-breaker/demo.sh
```

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
  --agent-name research-agent \
  --prompt "Research the same narrow topic until you have ten unique sources" \
  --session-id demo-live-run \
  --dry-run
```

Dry-run mode writes local evidence and PR text. It does not open a GitHub PR.

## Live PR Mode

Live PR mode keeps the dry-run proof step, then uses the GitHub REST API to
create a branch, patch the target file, and open or reuse a PR.

```bash
export GITHUB_TOKEN=ghp_...

node --experimental-strip-types examples/circuit-breaker/run.ts \
  --agent-dir ./agents/research-agent \
  --agent-name research-agent \
  --prompt "Research the same narrow topic until you have ten unique sources" \
  --session-id demo-live-run \
  --open-pr \
  --github-repo YOUR_USERNAME/research-agent \
  --base-branch main
```

`--open-pr` cannot be combined with `--dry-run`. The runner first writes the
same local session, intervention, patch, and PR-body artifacts. Only after those
exist does it call GitHub.

## Artifact Map

| Artifact | Meaning |
|---|---|
| `memory/circuit-breaker/sessions/<session-id>.jsonl` | captured normalized events with stable `eventIndex` values |
| `memory/circuit-breaker/interventions/<id>.yaml` | detector, severity, evidence window, and action metadata |
| `memory/circuit-breaker/interventions/<id>.yaml.patch.diff` | proposed patch for review |
| `memory/circuit-breaker/interventions/<id>.yaml.pr.md` | PR body with exact evidence |
| `memory/circuit-breaker/baselines/<key>.yaml` | cost baseline samples by agent, model, and rules hash |
| `memory/circuit-breaker/calibration.md` | pending/merged/rejected intervention accuracy summary |

`--agent-name` and `--rules-hash` can be passed explicitly. When omitted, the
runner derives the agent name from `--agent-dir`, the model from assistant usage,
and the rules hash from `RULES.md` when that file exists.

## GitHub Contract

Live PR mode requires a token with repository contents and pull request write
permission on the target repo. The writer uses GitHub REST endpoints for git
refs, repository contents, and pull requests. Secrets are read from environment
variables or CLI args and are never written into evidence artifacts.

## Trust Boundary

Fixture evidence proves deterministic detection behavior.

Live evidence proves the example can observe GitClaw SDK events from a real run.
Live PR mode proves the proposed fix can leave the local repo and become a
reviewable GitHub change.

Neither mode claims production interception. V1 is advisory: it detects,
records, and proposes a patch. A human reviews and merges any fix.
