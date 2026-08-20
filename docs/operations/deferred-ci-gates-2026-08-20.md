# Deferred CI gates — 2026-08-20

Three gates are red on `feat/bqc-8-3-lifecycle-at-scale` at merge time. All three
predate this branch's work or are running for the first time. Each is recorded
here with its measured cause so none is rediscovered from scratch.

## 1. `audit` (Fallow) — pre-existing, measured

Failing before the first commit of this session. Measured against baseline
`7d47b1fe` (this branch minus its 12 commits, plus the entry-point fix):

| metric                   | baseline                | with this branch |
| ------------------------ | ----------------------- | ---------------- |
| dead code                | 165                     | 168              |
| complexity findings      | 188 (max cyclomatic 74) | 216 (peak 105)   |
| duplication clone groups | 587                     | 674              |

The gate was already failing at baseline, so it does not gate this merge. This
branch does worsen all three numbers and that is owned, not excused: nine service
binaries built by `tsup` were absent from the Fallow entry-point list, so dead-code
analysis treated every one of them as unreachable. That config gap is fixed on this
branch (`b6243e71`); the remaining delta is real debt.

## 2. `simulate` (Simulation) — unsatisfiable in the harness, correct about production

`scripts/seed.ts --invariants` runs the `review-inbox-consistency` checker, which
asserts every review has a corresponding inbox item. Inbox items are created by an
**outbox consumer**, and the outbox relay only runs in `src/worker/index.ts` behind
`OUTBOX_DISPATCHER_ENABLED`. The simulation container never registers those
consumers, so `review.created` never reaches the projection and the invariant
cannot be satisfied by construction.

The invariant is right about production. The harness cannot meet it. Fixing it means
either registering the consumers in the simulation container or driving the relay
explicitly — a harness change, not a product change. This workflow is new on this
branch and has never passed on `main`.

## 3. `beta-acceptance` — structurally over budget

First real execution. Two setup defects found and fixed today:

- `EACCES mkdir /artifacts/perf` — the perf-runner image runs as `USER node` (uid 1000) while the host artifact directory was created by the CI runner user. Fixed
  by `chmod`-ing `perfArtifacts` at creation, mirroring the existing `e2eArtifacts`
  precedent (`aebe2cf3`).
- `ECONNREFUSED localhost:5432` — the job declared no service containers, but
  `beta:smoke`'s quality phase reaches `pnpm test:integration` before it brings any
  Compose stack up. Fixed by giving the job the same digest-pinned postgres and
  redis services `check` uses (`80c31886`).

It now gets past both and runs, but does not finish. Measured attempts, all still
inside `Run authoritative local beta smoke`:

| commit     | elapsed | outcome                          |
| ---------- | ------- | -------------------------------- |
| `6f6f7c82` | 14 min  | failed — no database             |
| `fb511047` | 42 min  | cancelled (superseded)           |
| `60d86561` | 71 min  | cancelled (superseded)           |
| `80c31886` | 112 min | cancelled at the 120 min ceiling |

That single step runs 12 quality gates (`run-quality-gate.ts`) plus 8 acceptance
phases (`smoke.ts`), including both Playwright projects and five Compose
lifecycles. Its five `needs` — `check`, `docker`, `storybook`, `storybook-test`,
`e2e` — have already proven the first 12 by the time it starts, so most of the
budget is spent re-proving passed work.

Two ways forward, deliberately not chosen unilaterally because they change what the
authoritative gate asserts:

1. Keep only the beta-profile Compose phases and drop the re-run of the dependency
   gates. Fastest; weakens the "one hermetic run proves everything" property.
2. Raise `timeout-minutes` past the real cost and accept a ~2.5h gate.

Contributing factor now fixed: no workflow declared a `concurrency` group, so three
runs executed simultaneously on superseded commits and starved each other
(`04699e4a`).
