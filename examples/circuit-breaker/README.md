# GitClaw Circuit Breaker

This example watches GitClaw SDK events for runaway behavior, writes durable
evidence, and proposes a small git-native fix.

It is not a second runtime. GitClaw produces the `GCMessage` stream; the circuit
breaker normalizes that stream, analyzes it, and writes reviewable artifacts.

## Product Claim

This is a git-native circuit breaker for agent reliability. It turns a GitClaw
run into auditable evidence, detects runaway behavior from that evidence, and
proposes the smallest repo change that would make the agent less likely to
repeat the incident.

The idea is intentionally not reduced to "just tests" or "just a PR bot":

- fixture mode proves deterministic detector behavior without LLM variance
- live mode proves the same adapter observes real GitClaw SDK/provider events
- PR mode proves an intervention can leave the local machine as a human-reviewed git change
- calibration records keep the system honest after humans merge or reject interventions

## Start Here

Run the deterministic proof first:

```bash
examples/circuit-breaker/demo.sh
```

Then run a real SDK capture:

```bash
AGENT_DIR=./agents/assistant \
PROMPT="Use one or two tool calls to inspect this repo and summarize what changed." \
MAX_TOKENS=2048 \
examples/circuit-breaker/live-proof.sh
```

For a very cheap live-provider proof on free Groq quota, disable tools and cap
the response:

```bash
GROQ_API_KEY=... \
MODEL=groq:llama-3.3-70b-versatile \
PROMPT="Say ok in one short sentence." \
MAX_TOKENS=128 \
NO_TOOLS=1 \
examples/circuit-breaker/live-proof.sh
```

The shortest demo story is:

1. GitClaw emits a real `query()` SDK stream of `GCMessage` events.
2. The circuit breaker normalizes those events and writes session JSONL.
3. The detector cites exact event indexes when repeated low-progress tool calls appear.
4. The intervention writes YAML, a patch, and PR body text.
5. Optional PR proof sends that patch to GitHub for human review.

Cost anomaly is included, but v1's strongest proof is deterministic loop detection.
Calibration starts honest: pending human decisions are not counted as precision.

## Proof Matrix

| Proof | Command | What it proves |
|---|---|---|
| Deterministic incident | `examples/circuit-breaker/demo.sh` | loop detection, evidence indexes, intervention YAML, patch, PR body, calibration |
| Live SDK/provider capture | `MODEL=groq:llama-3.3-70b-versatile NO_TOOLS=1 MAX_TOKENS=128 examples/circuit-breaker/live-proof.sh` | real GitClaw `query()` stream and real provider usage captured into session JSONL |
| Real PR path | `GITHUB_REPO=OWNER/REPO examples/circuit-breaker/pr-proof.sh` | branch creation, target-file patching, PR creation/reuse, intervention record updated with PR URL |

See [PROOF.md](./PROOF.md) for the latest evidence run and exact artifact map.

## What It Proves

- Real SDK message shapes are adapted through `message-adapter.ts`
- Session evidence is written to `memory/circuit-breaker/sessions/*.jsonl`
- Tool-loop detection cites exact event indexes
- Interventions are saved as YAML records
- Dry-run mode writes a patch and PR body locally
- Cost spikes are warnings until enough baseline samples exist
- Statistical cost anomalies propose a targeted `RULES.md` cost guardrail
- Statistical anomaly samples are quarantined instead of poisoning clean baselines
- Calibration is regenerated from human-labeled intervention outcomes

## Fixture Mode

Fixture mode is deterministic regression evidence. It does not call an LLM.

One-command fixture demo:

```bash
examples/circuit-breaker/demo.sh
```

`demo.sh` also runs `verify-artifacts.ts` so the generated session JSONL,
intervention, patch, PR body, and calibration file are checked immediately.

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
  --model groq:llama-3.3-70b-versatile \
  --prompt "Research the same narrow topic until you have ten unique sources" \
  --session-id demo-live-run \
  --max-tokens 2048 \
  --dry-run
```

Dry-run mode writes local evidence and PR text. It does not open a GitHub PR.
`--max-tokens` caps the live proof run's assistant output; it does not change
fixture mode and does not make the detector depend on an LLM.
Use `--no-tools` when you only need to prove live provider usage capture without
sending the built-in tool schemas to a low free-tier TPM provider.

For repeatable live proof, use:

```bash
AGENT_DIR=./agents/research-agent \
PROMPT="Research the same narrow topic until you have ten unique sources" \
REQUIRE_INTERVENTION=1 \
MAX_TOKENS=2048 \
examples/circuit-breaker/live-proof.sh
```

Leave `REQUIRE_INTERVENTION=0` when you only need to prove live SDK capture.
Set it to `1` when the chosen agent/prompt is expected to produce an intervention.

## Live PR Mode

Live PR mode keeps the dry-run proof step, then uses the GitHub REST API to
create a branch, patch the target file, and open or reuse a PR.

```bash
# Set GITHUB_TOKEN in your shell or secret manager before running this.

node --experimental-strip-types examples/circuit-breaker/run.ts \
  --agent-dir ./agents/research-agent \
  --agent-name research-agent \
  --prompt "Research the same narrow topic until you have ten unique sources" \
  --session-id demo-live-run \
  --max-tokens 2048 \
  --open-pr \
  --github-repo YOUR_USERNAME/research-agent \
  --base-branch main
```

`--open-pr` cannot be combined with `--dry-run`. The runner first writes the
same local session, intervention, patch, and PR-body artifacts. Only after those
exist does it call GitHub.

For an explicit PR proof on a demo repository:

```bash
# Set GITHUB_TOKEN in your shell or secret manager before running this.
GITHUB_REPO=YOUR_USERNAME/research-agent \
AGENT_DIR=./agents/research-agent \
PROMPT="Research the same narrow topic until you have ten unique sources" \
MAX_TOKENS=2048 \
examples/circuit-breaker/pr-proof.sh
```

`pr-proof.sh` has an external side effect: it creates or reuses a real GitHub
branch and PR. Use a throwaway/demo repository when presenting this.

## Artifact Map

| Artifact | Meaning |
|---|---|
| `memory/circuit-breaker/sessions/<session-id>.jsonl` | captured normalized events with stable `eventIndex` values |
| `memory/circuit-breaker/interventions/<id>.yaml` | detector, severity, evidence window, and action metadata |
| `memory/circuit-breaker/interventions/<id>.yaml.patch.diff` | proposed unified patch for review; when target content is available, it is generated against that content |
| `memory/circuit-breaker/interventions/<id>.yaml.pr.md` | PR body with exact evidence |
| `memory/circuit-breaker/baselines/<key>.yaml` | cost baseline samples by agent, model, and rules hash |
| `memory/circuit-breaker/baselines/anomalies/*.yaml` | quarantined statistical anomaly samples awaiting human labeling |
| `memory/circuit-breaker/calibration.md` | pending/merged/rejected intervention accuracy summary |

`--agent-name` and `--rules-hash` can be passed explicitly. When omitted, the
runner preserves the live SDK session id when available, derives the agent name
from `--agent-dir`, derives the model from assistant usage when present, and
derives the rules hash from `RULES.md` when that file exists.

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
