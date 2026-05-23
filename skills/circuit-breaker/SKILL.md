---
name: circuit-breaker
description: Analyze GitClaw SDK events for tool loops, low-progress behavior, and cost spikes, then write auditable intervention evidence.
---

# Circuit Breaker

Use this skill when reviewing a GitClaw run for runaway behavior.

## Inputs

- A GitClaw `GCMessage` stream or captured session JSONL
- Current `RULES.md`
- Relevant `skills/<name>/SKILL.md` files
- Prior baselines in `memory/circuit-breaker/baselines/`

## Outputs

- Session evidence in `memory/circuit-breaker/sessions/`
- One intervention YAML record when a detector fires
- A targeted dry-run patch and PR body
- No intervention when evidence is below threshold

## Rules

- Use GitClaw SDK events as the source of truth.
- Do not run a second agent runtime.
- Cite exact session event indexes in every intervention.
- Do not call text-only similarity a high-confidence loop.
- Do not call cost a statistical anomaly without enough baseline samples.
