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

## 2. `simulate` (Simulation) — FIXED; the original diagnosis was wrong

**Superseded.** This section previously read "unsatisfiable in the harness, correct
about production", and argued that because inbox items are created by an outbox
consumer, and the relay only runs in `src/worker/index.ts` behind
`OUTBOX_DISPATCHER_ENABLED`, `review.created` never reached the projection and the
invariant "cannot be satisfied by construction".

Half of that is true and half of it is not, and the false half is the load-bearing
half. The **durable** consumer path is genuinely absent: `createSimulationContainer`
never calls `registerOutboxConsumers`, whose only caller is `src/worker/index.ts`.
But the **in-process bus** path IS wired: `registerInboxHandlers` runs
unconditionally during container construction and attaches the `review.created`
handler whenever the cutover state is not `switch`, and the default is record-only.
The simulation container's own header says it uses the real event bus so handlers
fire synchronously. The handler was attached and was being called.

The real cause was a fixture bug, and it was hidden by two nested swallows.
`scenario/builder.server.ts` seeded every review with `sourceRevision: 0` and
`analysisSequence: 0`. `sourceEpoch` is legitimately 0-based — migration 0060
relaxed the AI-plane CHECK to `>= 0` — but `reviewCreated` asserts that
`sourceRevision` and `analysisSequence` are **positive**, and
`review-command-store` takes the sequence from a DB sequence it asserts is `> 0`
before attaching it. So `reviewRepo.upsert` committed the review and the
`reviewCreated(...)` constructor then threw `sourceRevision must be a positive safe
integer`. A bare `catch { /* idempotent */ }` in the builder discarded it, and
`on-review-created` only logs its own failures — so the sole surviving symptom was
126 persisted reviews with no inbox item, reported five minutes later by the
invariant with no cause attached.

Fix: seed `sourceRevision: 1` / `analysisSequence: 1`, and replace the bare catch
with the `logger.warn` the reply path in the same function already had. Verified
locally with the exact command CI runs — `pnpm seed -- --invariants` now exits 0
with `All invariant checks passed (no error-level violations)`; the remaining
`sla-consistency` and `no-orphaned-jobs` items are warnings, which `scripts/seed.ts`
tolerates by design.

The lesson worth keeping: the invariant was right about production **and** right
about the harness. It was the only check that noticed, and the previous conclusion
would have retired or worked around it.

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
