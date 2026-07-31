# Scale and recovery evidence

**Release id:** local-draft  
**Release sha:** 39a2a8d16217cbd23ec363e7312877ccc9116b87  
**Policy versions:** capability=bqc-0.3 · policyStore=-1 · routing=1 · sourceContent=1  
**Dataset hash:** e58684b3d10454c87c6afa05f425eae12440399565c872541a6558483d4d20b9  
**Dataset:** seed `perf-scale-v1` — 2 orgs / 20 properties / 500 reviews  
**Owner:** bozhidardenev  
**Generated at:** 2026-07-31T20:58:21.594Z  
**Generator:** `scripts/perf/write-scale-evidence.ts` (BQC-8.1 — measured ingestion, no templated results)

## Executed runs (measured)

Environment: `local` (harness: scripts/perf/load-test.ts; raw identifier-only data under `raw/`, ADR 0030).

| Scenario | Result | Duration | Samples     | Monitoring points | Key metrics                                                        | Assertions |
| -------- | ------ | -------- | ----------- | ----------------- | ------------------------------------------------------------------ | ---------- |
| `burst`  | PASS   | 5.0s     | 500 (0 err) | 5                 | achievedRatePerSec=99.03/s · targetRatePerSec=100/s · enqueued=500 | 5/5        |
| `steady` | PASS   | 10.0s    | 200 (0 err) | 10                | achievedRatePerSec=19.94/s · targetRatePerSec=20/s · enqueued=200  | 4/4        |

## Scenario matrix (§9.2)

| Id                    | Name                  | Description                                             | Status                              |
| --------------------- | --------------------- | ------------------------------------------------------- | ----------------------------------- |
| `steady`              | Steady arrival        | 20 review facts/sec for 30 minutes                      | PASS (measured — see Executed runs) |
| `burst`               | Burst                 | 100 reviews/sec for 60 seconds                          | PASS (measured — see Executed runs) |
| `drain`               | Backlog drain         | Inject a backlog, stop injection, measure time-to-empty | not executed in this environment    |
| `singlePropertyBurst` | Single-property burst | Concentrated updates with timestamp ties                | not executed in this environment    |
| `reconnect`           | Reconnect/import      | 100 properties with paged histories, staggered          | not executed in this environment    |
| `fleetDispatch`       | Fleet dispatch        | 5,000 due properties over 4 hours                       | not executed in this environment    |
| `dashboardMix`        | Dashboard mix         | Warm/cold 1/7/30/90-day property views                  | not executed in this environment    |
| `retention`           | Retention/deletion    | Expire and disconnect large properties during arrival   | not executed in this environment    |
| `reconciliation`      | Reconciliation        | 35-day rollup repair while traffic continues            | not executed in this environment    |

## Fault matrix (§9.3)

Fault executors land with BQC-8.4 (runtime fault matrix) and BQC-8.5 (region fault matrix); until then every fault row is honestly not executed.

| Id                     | Name                                  | Invariant                                       | Status                           |
| ---------------------- | ------------------------------------- | ----------------------------------------------- | -------------------------------- |
| `dbFailurePreCommit`   | Database failure before source commit | No orphan outbox rows; all commits are atomic   | not executed in this environment |
| `dbFailurePostCommit`  | Database failure after source commit  | Outbox relay catches up on restart              | not executed in this environment |
| `relayCrashAfterClaim` | Relay crash after claim               | Lease expires; rows re-claimed by next relay    | not executed in this environment |
| `relayCrashAfterRedis` | Relay crash after Redis add           | Duplicate possible but receipt dedup handles it | not executed in this environment |
| `redisUnavailable`     | Redis unavailable                     | Outbox accumulates; web stays healthy           | not executed in this environment |
| `workerSigterm`        | Worker SIGTERM during handler         | Job re-queued; outbox intact                    | not executed in this environment |
| `workerForceKill`      | Worker forced termination             | Outbox row unclaimed; job retried               | not executed in this environment |
| `duplicateEvents`      | Duplicate/out-of-order events         | Receipt dedup prevents duplicate processing     | not executed in this environment |
| `poisonPayload`        | Poison payload                        | Dead-lettered; other events unaffected          | not executed in this environment |
| `gbpRateLimit`         | GBP 429 rate limit                    | Backoff; no hammering                           | not executed in this environment |
| `cacheOutage`          | Cache outage and stampede             | Fallback to DB; bounded query load              | not executed in this environment |
| `lifecyclePurgeRace`   | Lifecycle purge racing sync           | No resurrection of purged content               | not executed in this environment |

## SLOs (from harness catalogue)

| Key                | Value |
| ------------------ | ----- |
| `steadyReviewRate` | 20    |
| `burstReviewRate`  | 100   |
| `burstDuration`    | 60    |
| `drainTimeout`     | 600   |
| `rpoTarget`        | 900   |
| `rtoTarget`        | 14400 |
| `dashboardP95`     | 500   |
| `dashboardColdP95` | 2000  |
| `maxQueueDepth`    | 10000 |
| `outboxLagP95`     | 5000  |
| `fleetProperties`  | 5000  |
| `fleetWindow`      | 4     |

## Health probes (BQR-6.1 / 6.2)

| Probe     | URL                       | Expected                                                              |
| --------- | ------------------------- | --------------------------------------------------------------------- |
| Liveness  | `GET /api/health/live`    | 200 `{ status: "ok" }`                                                |
| Readiness | `GET /api/health/ready`   | 200 when DB+Redis up; 503 degraded                                    |
| Combined  | `GET /api/health`         | Same as readiness (compat)                                            |
| Metrics   | `GET /api/health/metrics` | Outbox lag, queue depths, worker heartbeat (ops-token gated, BQC-7.2) |

## RPO / RTO

| Metric | Target             | Result                           | Evidence |
| ------ | ------------------ | -------------------------------- | -------- |
| RPO    | ≤ 900s (15 min)    | not executed in this environment | BQC-8.6  |
| RTO    | ≤ 14400s (4 hours) | not executed in this environment | BQC-8.6  |

## Raw data

Identifier-only performance data (ADR 0030 — no review text, PII, or tenant identifiers as content; probe/job ids are synthetic):

- `raw/burst.result.json`
- `raw/burst.raw.json`
- `raw/steady.result.json`
- `raw/steady.raw.json`

## Sign-off

- [x] Local harness execution recorded (2 scenario(s) measured)
- [ ] Full §9.2 scenario matrix executed at target scale (BQC-8.2/8.3)
- [ ] Fault matrix executed (BQC-8.4/8.5)
- [ ] RPO/RTO verified (BQC-8.6)
