# Scale & recovery harness (BQC-8.1)

Executable load/fault scenario harnesses and the deterministic scale dataset.
This document covers local usage; BQC-8.2+ run the same harnesses at target
scale in staging.

## Components

| Piece               | Where                                        | What it is                                                                                                                           |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Measurement library | `src/shared/testing/perf.ts`                 | Percentiles (linear interpolation between closest ranks), summaries, bounded-concurrency probe runner, raw sample store              |
| Monitoring capture  | `src/shared/testing/ops-snapshot-capture.ts` | Time series of the BQC-7.3 OperationsSnapshot — `viaContainer` (in-process) or `viaHttp` (`GET /api/health/metrics` + `x-ops-token`) |
| Catalogue           | `src/shared/testing/scenarios/catalogue.ts`  | SLOs, §9.2 scenarios, §9.3 faults, result contracts — the single source of truth                                                     |
| Executors           | `src/shared/testing/scenarios/executors.ts`  | Runnable `steady` / `burst` / `dashboardMix` / `drain`; empty fault registry for 8.4/8.5                                             |
| Dataset             | `src/shared/testing/scale-dataset.ts`        | Deterministic plan (seed → ids/distributions), manifest hash, load/verify/clean                                                      |
| Evidence            | `src/shared/testing/scale-evidence.ts`       | Ingests measured results → reviewed markdown; fails closed                                                                           |
| CLIs                | `scripts/perf/`                              | Thin wiring only (outside tsconfig, per the ops-command precedent)                                                                   |

## Running scenarios locally

Export the app env (DATABASE*URL, REDIS_URL, BETTER_AUTH*\*, …) — the CLI boots
the real composition container, so monitoring reads the same snapshot the
metrics route serves.

```bash
pnpm perf:catalog                                        # print the catalogue
pnpm perf:run -- --scenario=steady --duration-s=30       # 20/s paced enqueue (default rate)
pnpm perf:run -- --scenario=burst  --duration-s=60       # 100/s catalogue burst
pnpm perf:run -- --scenario=dashboardMix --duration-s=15 # concurrent reads via getDashboardData
pnpm perf:run -- --scenario=drain  --backlog=100 --timeout-s=600
pnpm perf:run -- --scenario=steady --base-url=http://localhost:3000  # HTTP monitoring (needs OPS_METRICS_TOKEN)
```

What a run does:

- paces `sync-property-reviews` enqueues through the BQC-3 producer contract
  (`createJobQueue` + catalogue `jobEnqueueOptions`) with synthetic,
  identifier-only payloads and run-unique job ids;
- captures a monitoring time series (outbox age, queue depths, db pool,
  heartbeat, degraded markers) driven by the run's own pacing;
- asserts its SLOs (required samples, error-free seam, achieved rate ≥ 80% of
  target, monitoring captured; drain adds time-to-empty ≤ timeout);
- **cleans up exactly the jobs it enqueued** (tracked ids), pass or fail;
- writes `<out>/<scenario>.result.json` (record + identity + SLO snapshot)
  and `<out>/<scenario>.raw.json` (identifier-only samples + monitoring
  series, ADR 0030) and exits 0 only when every assertion passed.

Fail-closed: unknown scenario/fault, catalogue entry without an executor
(faults until 8.4/8.5), missing/invalid env, missing REDIS_URL (or
OPS_METRICS_TOKEN with `--base-url`), unseeded DB for `dashboardMix` — all
exit non-zero with a clear message. `drain` without a worker honestly FAILS
(`drained_within_timeout`) rather than fabricating a drain time.

## The deterministic dataset

```bash
pnpm perf:seed-scale -- --orgs=100 --properties=5000 --reviews=500000   # load
pnpm perf:seed-scale -- --dry-run                                       # plan + hash only
pnpm perf:seed-scale -- --verify                                        # prove DB == plan (exit 1 on drift)
pnpm perf:seed-scale -- --clean                                         # delete EXACTLY this dataset
pnpm perf:seed-scale -- --clean --dry-run                               # count what would go
```

- Same `--seed` + same shape ⇒ byte-identical manifest hash (sha256 over the
  canonical row stream: deterministic v5-shaped uuids, per-kind Park-Miller
  LCG distributions). The hash is the dataset's identity in evidence packs.
- `--base-time` anchors `reviewed_at`/`expires_at` at load time; it is NOT
  part of the hash (identity and structure are deterministic; wall-clock is
  environment-relative).
- Distribution: US-heavy with denied `europe`/`global` cells (the BQC-4
  routing proofs need them) and ~30% of reviews on the top 5% of properties.
- `--verify` checks exact table counts, property org/region integrity, the
  exact per-property review distribution, skew bounds, and the manifest hash.
- `--clean` deletes by recomputed exact ids in FK order — never a
  delete-all (contrast `scripts/cleanup-all.ts`).

## Evidence ingestion

```bash
pnpm perf:evidence                      # local-draft pack from local-draft/raw
pnpm perf:evidence -- --release-id=rc-2026-08-01 --results=path/to/results
```

The ingester requires at least one executed result, validates every result
(zero samples / empty monitoring / unknown scenario / mixed release
shas → exit 1, no markdown), requires the raw time-series sibling, the
dataset manifest, and a release sha (flag → RELEASE_SHA → git). It writes
`docs/release-evidence/beta/<release-id>/scale-and-recovery.md` plus
`raw/` copies, marks executed rows PASS/FAIL from the records and everything
else "not executed in this environment", and exits 1 when an executed
scenario violated its SLO (the failing summary is the evidence of failure).

## For 8.2+ (staging executions)

- Point `arrivalJob` at real seeded properties for genuine arrival load.
- Register fault executors in `FAULT_EXECUTORS` (executors.ts) — the CLI
  dispatch + fail-closed path already exists.
- `--base-url` mode polls a booted environment's metrics endpoint; container
  mode covers DB/queue-only assertions.
