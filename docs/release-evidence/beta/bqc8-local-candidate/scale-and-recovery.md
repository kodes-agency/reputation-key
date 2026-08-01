# Scale and recovery evidence

**Release id:** bqc8-local-candidate  
**Release sha:** f5d5f6ed9ca096239983a0507bcce9dba742781d  
**Policy versions:** capability=bqc-0.3 · policyStore=-1 · routing=1 · sourceContent=1  
**Dataset hash:** 5501350a55aab0a5f4a8ddd744e6eab437ada1c8bae2e2dc57beeeabe030e96b  
**Dataset:** seed `perf-scale-v1` — 100 orgs / 5000 properties / 500000 reviews  
**Owner:** bozhidardenev  
**Generated at:** 2026-08-01T09:33:44.977Z  
**Generator:** `scripts/perf/write-scale-evidence.ts` (BQC-8.1 — measured ingestion, no templated results)

## Executed runs (measured)

Environment: `local` (harness: scripts/perf/load-test.ts; raw identifier-only data under `raw/`, ADR 0030).

| Scenario              | Result | Duration | Samples       | Monitoring points | Key metrics                                                                                 | Assertions |
| --------------------- | ------ | -------- | ------------- | ----------------- | ------------------------------------------------------------------------------------------- | ---------- |
| `burst`               | PASS   | 60.5s    | 6000 (0 err)  | 60                | achievedRatePerSec=99.2/s · targetRatePerSec=100/s · enqueued=6000                          | 5/5        |
| `dashboardCold`       | PASS   | 0.1s     | 20 (0 err)    | 2                 | reads=20 · readP95=4.74ms                                                                   | 4/4        |
| `dashboardMix`        | PASS   | 15.5s    | 23628 (0 err) | 16                | reads=23628 · readP95=3.45ms                                                                | 4/4        |
| `drain`               | PASS   | 94.9s    | 500 (0 err)   | 91                | backlogSize=500 · drainMs=94787.3ms · remainingWaiting=0                                    | 4/4        |
| `fleetDispatch`       | PASS   | 4.6s     | 5000 (0 err)  | 4                 | dispatchRatePerSec=45210.29/s · projectedWindowS=0.1s                                       | 4/4        |
| `reconnect`           | PASS   | 286.1s   | 1200 (0 err)  | 273               | remainingWaiting=0 · catchUpDrainMs=220002.3ms                                              | 7/7        |
| `replyBurst`          | PASS   | 5.1s     | 50 (0 err)    | 1                 | publishP95=4833.28ms · published=25                                                         | 5/5        |
| `singlePropertyBurst` | PASS   | 60.6s    | 7200 (0 err)  | 60                | backgroundAchievedRatePerSec=19.81/s · hotAchievedRatePerSec=99.03/s · maxQueueWaiting=6946 | 6/6        |
| `steady`              | PASS   | 300.5s   | 6000 (0 err)  | 300               | achievedRatePerSec=19.97/s · targetRatePerSec=20/s · enqueued=6000                          | 4/4        |

## Scenario matrix (§9.2)

| Id                    | Name                    | Description                                                                                        | Status                              |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `steady`              | Steady arrival          | 20 review facts/sec for 30 minutes                                                                 | PASS (measured — see Executed runs) |
| `burst`               | Burst                   | 100 reviews/sec for 60 seconds                                                                     | PASS (measured — see Executed runs) |
| `drain`               | Backlog drain           | Inject a backlog, stop injection, measure time-to-empty                                            | PASS (measured — see Executed runs) |
| `singlePropertyBurst` | Single-property burst   | Burst concentrated on ONE hot property while steady background arrival continues on the fleet      | PASS (measured — see Executed runs) |
| `reconnect`           | Reconnect/import        | Simulated provider outage (injection paused, worker live), then reconnect catch-up burst and drain | PASS (measured — see Executed runs) |
| `fleetDispatch`       | Fleet dispatch          | Dispatch refresh-due work for the whole seeded fleet; measured rate + LABELED 4h-window projection | PASS (measured — see Executed runs) |
| `dashboardMix`        | Dashboard mix           | Warm/cold 1/7/30/90-day property views                                                             | PASS (measured — see Executed runs) |
| `dashboardCold`       | Dashboard cold start    | First-N reads through a freshly restarted read path (cache cold start)                             | PASS (measured — see Executed runs) |
| `replyBurst`          | Reply publication burst | A human-use burst of reply publications; publish → terminal p95 (ADR 0038)                         | PASS (measured — see Executed runs) |
| `retention`           | Retention/deletion      | Expire and disconnect large properties during arrival                                              | not executed in this environment    |
| `reconciliation`      | Reconciliation          | 35-day rollup repair while traffic continues                                                       | not executed in this environment    |

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

| Key                       | Value |
| ------------------------- | ----- |
| `steadyReviewRate`        | 20    |
| `burstReviewRate`         | 100   |
| `burstDuration`           | 60    |
| `drainTimeout`            | 600   |
| `rpoTarget`               | 900   |
| `rtoTarget`               | 14400 |
| `dashboardP95`            | 500   |
| `dashboardColdP95`        | 2000  |
| `maxQueueDepth`           | 10000 |
| `outboxLagP95`            | 5000  |
| `fleetProperties`         | 5000  |
| `fleetWindow`             | 4     |
| `replyPublishTerminalP95` | 10000 |
| `replyBurstSize`          | 25    |
| `reconnectOutage`         | 30    |
| `hotPropertyBurstRate`    | 100   |
| `backgroundRateFloor`     | 0.8   |

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
- `raw/dashboardCold.result.json`
- `raw/dashboardCold.raw.json`
- `raw/dashboardMix.result.json`
- `raw/dashboardMix.raw.json`
- `raw/drain.result.json`
- `raw/drain.raw.json`
- `raw/fleetDispatch.result.json`
- `raw/fleetDispatch.raw.json`
- `raw/reconnect.result.json`
- `raw/reconnect.raw.json`
- `raw/replyBurst.result.json`
- `raw/replyBurst.raw.json`
- `raw/singlePropertyBurst.result.json`
- `raw/singlePropertyBurst.raw.json`
- `raw/steady.result.json`
- `raw/steady.raw.json`

## Sign-off

- [x] Local harness execution recorded (9 scenario(s) measured)
- [ ] Full §9.2 scenario matrix executed at target scale (BQC-8.2/8.3)
- [ ] Fault matrix executed (BQC-8.4/8.5)
- [ ] RPO/RTO verified (BQC-8.6)
