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
| Executors           | `src/shared/testing/scenarios/executors.ts`  | Runnable capacity + lifecycle scenarios and the full fault registry; fault execution requires the controlled production runner       |
| Dataset             | `src/shared/testing/scale-dataset.ts`        | Deterministic plan (seed → ids/distributions), manifest hash, load/verify/clean                                                      |
| Evidence            | `src/shared/testing/scale-evidence.ts`       | Ingests measured results → reviewed markdown; fails closed                                                                           |
| Staging cell        | `src/shared/testing/staging-cell.ts`         | BQC-8.2: local production-shaped cell (DB, separate cache/queue Redis, stubs, prod web+worker, readiness, teardown)                  |
| External collectors | `src/shared/testing/external-collectors.ts`  | BQC-8.2: redis-cli INFO sampling; DB CPU/locks honestly not-collected (platform surface)                                             |
| CLIs                | `scripts/perf/`                              | Thin wiring only (outside tsconfig, per the ops-command precedent)                                                                   |

## Running scenarios locally

Export the app env (DATABASE*URL, REDIS_URL, QUEUE_REDIS_URL, BETTER_AUTH*\*, …) — the CLI boots
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
  (`createJobQueue` + catalogue `jobEnqueueOptions`) with run-unique job ids —
  targeting the seeded dataset's real properties with deterministic skew when
  `--seed` matches a loaded dataset, else synthetic identifier-only payloads;
- captures a monitoring time series (outbox age, queue depths, db pool,
  heartbeat, cache counters, reply-publication counts, degraded markers)
  driven by the run's own pacing, plus redis-cli INFO points when the binary
  is available (external collector);
- asserts its SLOs (required samples, error-free seam, achieved rate ≥ 80% of
  target, monitoring captured; drain adds time-to-empty ≤ timeout);
- **cleans up exactly the jobs it enqueued** (tracked ids), pass or fail;
- writes `<out>/<scenario>.result.json` (record + identity + SLO snapshot +
  collector coverage) and `<out>/<scenario>.raw.json` (identifier-only
  samples + monitoring series, ADR 0030) and exits 0 only when every
  assertion passed.

Fail-closed: unknown scenario/fault, a missing lifecycle seam, an unavailable
fault controller, missing/invalid env, missing QUEUE_REDIS_URL (or OPS_METRICS_TOKEN
with `--base-url`), unseeded DB for `dashboardMix` — all exit non-zero with a
clear message. `drain` without a worker honestly FAILS
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
- Distribution: geographically varied supported countries/timezones, all
  allocated to the one `us` beta cell, and ~30% of reviews on the top 5% of
  properties. Dormant-cell denial stays in focused routing tests rather than
  corrupting the production-shaped capacity dataset.
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

## The local staging cell (BQC-8.2)

`pnpm perf:cell` boots a full production-shaped cell on an isolated slice of
the developer machine (logic in `src/shared/testing/staging-cell.ts`, unit
tested hermetically):

```bash
pnpm perf:cell -- up [--skip-build] [--probe-org=<orgId>]   # boot (idempotent)
pnpm perf:cell -- status                                    # liveness report
pnpm perf:cell -- env                                       # export lines for perf:run / perf:seed-scale
pnpm perf:cell -- down                                      # stop; keep the database
pnpm perf:cell -- down --drop                               # stop; drop the cell database
# Optional: --cache-redis-url=redis://localhost:6380/9
#           --queue-redis-url=redis://localhost:6379/9
```

- **Database** `repkey_bqc8_cell` (create + ci.yml migration trio via
  `ensureTestDatabase`). The cell only ever touches `repkey_bqc8_*` names —
  `test`, `repkey_bqc05_baseline`, dev, and e2e databases are unreachable by
  construction, and `down --drop` re-checks the prefix before dropping.
- **Two Redis daemons, logical db 9** — cache/rate limiting defaults to
  `redis://localhost:6380/9`; BullMQ defaults to
  `redis://localhost:6379/9`. Separate ports are mandatory because logical
  database numbers are not resource or failure isolation. Queue keys never
  meet a dev:all worker on db 0.
- **Ports** 3100 (web) / 4150 (GBP stub) / 4151 (mail stub), walked past
  conflicts (dev:all on 3000, e2e stubs on 4100/4101) and recorded in the
  state file (`test-results/perf-cell/cell-state.json`).
- **Production builds** (`.output/server/index.mjs`, `dist-worker/index.js`)
  with `NODE_ENV=production` and deterministic, never-placeholder secrets
  (sha256 over a fixed label — restart-stable so a kept database keeps
  decrypting; the BQC-7.6 production boot guard passes). Provider endpoints
  are pinned at the cell stubs (the real adapters talk to the stub only);
  dotenv discovery is neutralized so a developer `.env` cannot leak in.
- **Readiness**: web `GET /api/health/started` 200; worker log line
  `BullMQ worker started on default queue` (bounded). Teardown:
  SIGTERM → 5s grace → SIGKILL, worker first, stubs last.
- **Worker schedules**: the capacity profile (the default) deliberately leaves
  `last_fetched_at` / `content_expires_at` NULL, so routine BQC-8.2 execution
  cannot erase its own 500,000-row fixture. The separate
  `--source-lifecycle` profile populates deterministic fetch clocks and content
  hashes. Its `retention` run deliberately has no lifecycle seam while Review
  apply is quarantined; the executor therefore fails closed instead of treating
  the report-only `purge-expired-reviews` compatibility job as erasure proof.
  An approved cutover harness must later inject the separate apply seam and
  prove zero expired rows and zero remaining canaries.

Typical execution session:

```bash
pnpm perf:cell -- up --probe-org=$(node -e "console.log('perf-org-…')" )
eval "$(pnpm perf:cell -- env)"       # arms database/cache/queue/ops variables
pnpm perf:seed-scale -- --orgs=100 --properties=5000 --reviews=500000 \
  --manifest=docs/release-evidence/beta/bqc8-local-candidate/scale-dataset.json
pnpm perf:seed-scale -- --verify --manifest=…/scale-dataset.json
pnpm perf:run -- --scenario=steady --duration-s=300 \
  --base-url=http://localhost:3100 --out=docs/release-evidence/beta/bqc8-local-candidate/raw
# … the rest of the capacity matrix …
pnpm perf:evidence -- --release-id=bqc8-local-candidate
pnpm perf:cell -- down                # or: down --drop
```

## BQC-8.2 capacity scenarios

Registered in `SCENARIO_EXECUTORS` (executors.ts); wired by `perf:run`:

| Scenario              | What it does                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `singlePropertyBurst` | Hot-property burst (default 100/s on ONE property) + steady background arrival (20/s); asserts hot samples land, background error-free, background ≥ 80% target (no starvation), queue depth ≤ SLO       |
| `reconnect`           | Baseline arrival → simulated provider outage (injection paused + marker, worker keeps draining) → catch-up burst of the missed arrivals → time-to-drain vs SLO; unique-id + no-loss reconciliation       |
| `fleetDispatch`       | One dispatch per seeded fleet target; measured dispatch rate + backlog shape; the 4h-window figure is a **labeled projection** from the measured rate, never presented as a measured wall-clock window   |
| `dashboardCold`       | Restarts the read path (fresh container → cold caches), measures first-N reads p95 vs the cold budget (2000ms)                                                                                           |
| `replyBurst`          | Human-use publication burst (default 25, paced 5/s): real claimable replies + run-scoped connection + GBP stub scope; publish→terminal p95 vs ADR 0038 10s. Fails closed (not-executed) without the seam |

Arrival jobs target the seeded dataset's real properties (`--seed`,
deterministic skew: ~30% of arrivals on the hot 5% slice). The probe org
(replyBurst's allowlisted org) is excluded from arrival targets; every other
org's sync jobs terminate at the BQC-3.2 dispatch gate (production beta
posture — the gate/routing/quarantine runtime is what 8.2 re-executes; the
GBP fetch layer is e2e territory, BQC-6.5).

### Thresholds (recorded BEFORE execution, §5)

Authority: `SLOS` + the scenario `slo` blocks in
`src/shared/testing/scenarios/catalogue.ts` (ADR 0038 numbers). Every run
record snapshots the thresholds it asserted against; a measured SLO failure
writes a FAIL record and fails the pack — thresholds are never tuned after
seeing results.

| Threshold                                  | Value        | Source    |
| ------------------------------------------ | ------------ | --------- |
| steady review arrival rate                 | 20/s         | catalogue |
| burst rate / duration                      | 100/s × 60s  | catalogue |
| backlog drain timeout                      | 600s         | catalogue |
| max queue depth (alert bound)              | 10,000       | catalogue |
| dashboard warm p95                         | 500ms        | ADR 0038  |
| dashboard cold p95 (first-N reads)         | 2,000ms      | catalogue |
| reply publish → terminal p95               | 10,000ms     | ADR 0038  |
| reply burst size (human-use)               | 25           | §8.2      |
| reconnect outage window / catch-up rate    | 30s / 100/s  | catalogue |
| hot-property burst rate / background floor | 100/s / ≥80% | catalogue |
| fleet dispatch window (projection bound)   | 4h / 5,000   | catalogue |

### External collectors and honest gaps

- **Redis memory/stats**: when a `redis-cli` binary is on PATH, every run
  also collects `INFO` (used_memory, peak, keyspace hits/misses,
  instantaneous ops — the §8.2 Redis memory + cache-hit evidence) into the
  raw series; the run record's `collectors.redisInfo` says `redis-cli`.
- **DB CPU/locks**: not app-readable and no local CLI surface — recorded as
  `not-collected-in-this-environment` in every run record (platform
  observability is the acceptance surface). DB connections come from the
  snapshot's `db.pool`; query time and lock contention are platform surfaces.
- **Queue oldest age**: the BullMQ depth projection carries counts
  (waiting/active/delayed/failed), not ages; outbox oldest age is in the
  series. Tenant fairness is asserted via bounded queue depth + drain
  behavior in this environment.
- A run record always states its coverage — a gap is never silent.

## BQC-8.2 execution transcript (local cell, 2026-08-01)

Cell: production web + worker builds, `repkey_bqc8_cell` (migration trio),
separate cache/queue Redis daemons on db 9, GBP/mail stubs, ports
3100/4150/4151. Dataset: 100 orgs /
5,000 properties / 500,000 reviews, seed `perf-scale-v1`, hash `5501350a…`
(verify: 7/7 checks). Pack: `docs/release-evidence/beta/bqc8-local-candidate/`
(read its `NOTES.md` for the fidelity contract — synthetic orgs have no
provider connections, so arrival jobs exercise the dispatch/retry path,
not provider ingest).

| Scenario                     | Result | Key measurements                                                                     |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------ |
| steady (300s @20/s)          | PASS   | 20.0/s achieved, 300 monitoring points, 0 errors                                     |
| burst (60s @100/s)           | PASS   | 6,000 unique ids / 6,000 accepted, no duplicates                                     |
| singlePropertyBurst          | PASS   | max waiting 6,946 vs 10,000 bound (tenant fairness)                                  |
| reconnect                    | PASS   | catch-up backlog drained in 220.0s vs 600s SLO                                       |
| fleetDispatch (5,000)        | PASS   | 45,210/s dispatch; PROJECTION 0.00h vs 4h window (labeled)                           |
| dashboardMix (warm)          | PASS   | p95 3.4ms vs 500ms budget                                                            |
| dashboardCold                | PASS   | p95 4.7ms vs 2,000ms budget (in-process container reset)                             |
| replyBurst (25 @ human pace) | PASS   | publish→terminal p95 4,833ms vs 10,000ms (ADR 0038), 25/25 terminal                  |
| drain (scale-down/up)        | PASS   | worker stopped → 500-job backlog → worker restarted mid-run → empty in 94.8s vs 600s |

Harness fixes proven by this run: `registerAllEventSchemas()` is now
idempotent (the cold-restart seam re-creates the container in-process);
the reply seam's `text[]`/`uuid[]` binds pass Postgres array literals
(raw sql templates expand JS arrays to records); `perf:cell` drops the
pnpm `--` separator before subcommand parsing.

Teardown: all four pids SIGTERM'd, zero leftovers, database kept
(`perf:cell -- down --drop` to remove).

## BQC-8.3+ staging executions

Lifecycle proof uses a separately identified dataset profile:

```bash
pnpm perf:seed-scale -- --source-lifecycle --orgs=100 --properties=5000 --reviews=500000 \
  --manifest=docs/release-evidence/beta/<release-id>/scale-dataset.json
pnpm perf:run -- --scenario=retention --out=docs/release-evidence/beta/<release-id>/raw
```

`retention` currently fails at `lifecycle harness configured`. That is the
required non-evidence posture until external shadow parity, restore proof, and
cutover approval admit a separate apply seam. Once admitted, it must clear every
expired fetch-clock row, account for every original expired row, prove the
canary set disappeared, and keep each sweep within its configured keyset bound.

Every BQC-8.4/8.5 fault has an executor. A staging operator supplies
`BQC8_FAULT_RUNNER=/absolute/path/to/controller`; the controller receives the
fault id as argv[1] and must emit one content-free JSON `FaultRunSummary`.
Missing, malformed, mismatched, or non-recovered controller output fails the
row and cannot become evidence. Use `pnpm perf:run -- --fault=<catalogue-id>`
to write the matching measured result and raw monitoring series.
