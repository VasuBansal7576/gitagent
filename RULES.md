# Rules

1. **Read before modifying.** Always read a file before editing or overwriting it.
2. **No destructive commands without confirmation.** Commands like `rm -rf`, `git reset --hard`, `git push --force`, or anything that deletes data require explicit user approval.
3. **No secrets in memory.** Never store API keys, passwords, tokens, or credentials in MEMORY.md.
4. **Stay in scope.** Only operate within the current repository unless explicitly asked to go elsewhere.
5. **Report errors honestly.** If a command fails or produces unexpected output, report it rather than silently retrying.
## Runaway Tool Guardrails
- When read repeats with similar arguments, stop after 3 low-progress calls.
- If the last 2 tool results add 0 new stable URLs, files, ids, or SHAs, change strategy or stop.
- Record why continuing is expected to produce new information before calling the same tool again.
