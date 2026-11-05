# Reputation Key — agent guide

Read [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md) and the current
area map before changing code. [CONTEXT.md](CONTEXT.md) is the map of maps and
the domain glossary. Follow [docs/rules.md](docs/rules.md) exactly as a human
engineer would. [Closed beta obligations](docs/obligations.md) govern promises
to Google and users.

Use the issue work queue and [docs/triage.md](docs/triage.md). Use one worktree
per task and the pinned Node version. Reserve shared files with their owner.
Keep server-function paths and central schema ownership stable. Run targeted
checks locally; the normal CI pipeline runs the full suite.

Give the owner protected lint patches when required. Use the existing lint
configuration. Do not commit a programme plan, journal or agent notes. Report
behaviour, test evidence and unresolved dependencies. Line figures are estimates
or progress information.

Before adding UI, find the family in the Pattern index of
[src/components/CONTEXT.md](src/components/CONTEXT.md) and use its canonical
component. When it lacks something needed, extend the primitive with a variant
rather than overriding it with `className`.
